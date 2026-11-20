/**
 * 粒子引擎：SoA 对象池 + 多模式发射器 + 参数插值过渡 + 自动降级
 * 顶点缓冲布局（每个粒子 8 float）：x, y, r, g, b, size, alpha, hue
 */
(function (global) {
  'use strict';

  const U = global.GPUtils;
  const STRIDE = 8;

  class ParticlePool {
    constructor(capacity) {
      this.cap = capacity;
      const n = capacity;
      const F = () => new Float32Array(n);
      this.alive = new Uint8Array(n);
      this.x = F(); this.y = F(); this.vx = F(); this.vy = F();
      this.life = F(); this.maxLife = F(); this.size = F();
      this.r = F(); this.g = F(); this.b = F(); this.alpha0 = F();
      this.drag = F(); this.grav = F(); this.hue = F(); this.kind = new Uint8Array(n);
      this.active = new Int32Array(n); this.slot = new Int32Array(n); this.activeCount = 0;
      this.free = new Int32Array(n); this.freeCount = n;
      for (let i = 0; i < n; i++) this.free[i] = n - 1 - i;
      this.vertices = new Float32Array(n * STRIDE);
    }

    spawn(o) {
      if (this.freeCount <= 0) return -1;
      const i = this.free[--this.freeCount];
      this.alive[i] = 1;
      this.slot[i] = this.activeCount;
      this.active[this.activeCount++] = i;
      this.x[i] = o.x; this.y[i] = o.y;
      this.vx[i] = o.vx; this.vy[i] = o.vy;
      this.life[i] = o.life; this.maxLife[i] = o.life;
      this.size[i] = o.size;
      this.r[i] = o.r; this.g[i] = o.g; this.b[i] = o.b;
      this.alpha0[i] = o.alpha == null ? 1 : o.alpha;
      this.drag[i] = o.drag == null ? 0.97 : o.drag;
      this.grav[i] = o.gravity || 0;
      this.hue[i] = o.hue || 0;
      this.kind[i] = o.kind || 0;
      return i;
    }

    kill(i) {
      if (!this.alive[i]) return;
      const pos = this.slot[i];
      const last = this.active[--this.activeCount];
      this.active[pos] = last;
      this.slot[last] = pos;
      this.alive[i] = 0;
      this.free[this.freeCount++] = i;
    }

    clear() {
      for (let k = 0; k < this.activeCount; k++) this.alive[this.active[k]] = 0;
      this.activeCount = 0;
      this.freeCount = this.cap;
      for (let i = 0; i < this.cap; i++) { this.free[i] = this.cap - 1 - i; this.slot[i] = i; }
    }

    update(dt, globalGravity, vortexCenter, swirlAccel) {
      let k = 0;
      const dtc = Math.min(dt, 0.05);
      while (k < this.activeCount) {
        const i = this.active[k];
        let l = this.life[i] - dtc;
        if (l <= 0) { this.kill(i); continue; }
        this.life[i] = l;

        const d = Math.pow(this.drag[i], dtc * 60);
        this.vx[i] *= d;
        this.vy[i] *= d;
        this.vy[i] += (this.grav[i] + globalGravity * 0.35) * dtc;

        if (this.kind[i] === 1 && vortexCenter) {
          const dx = vortexCenter.x - this.x[i];
          const dy = vortexCenter.y - this.y[i];
          const dist = Math.hypot(dx, dy) || 1;
          const nx = dx / dist, ny = dy / dist;
          // 切向加速度 + 轻微向心保持（形成吸积盘而非直线坠落）
          this.vx[i] += (-ny * swirlAccel + nx * 28) * dtc;
          this.vy[i] += (nx * swirlAccel + ny * 28) * dtc;
        }

        this.x[i] += this.vx[i] * dtc;
        this.y[i] += this.vy[i] * dtc;
        k++;
      }
    }

    buildVertices(hueShift) {
      const v = this.vertices;
      let out = 0;
      for (let k = 0; k < this.activeCount; k++) {
        const i = this.active[k];
        const t = this.life[i] / this.maxLife[i];
        const a = this.alpha0[i] * Math.pow(t, 0.62);
        const o = out * STRIDE;
        v[o] = this.x[i]; v[o + 1] = this.y[i];
        v[o + 2] = this.r[i]; v[o + 3] = this.g[i]; v[o + 4] = this.b[i];
        v[o + 5] = this.size[i] * (0.55 + 0.45 * t);
        v[o + 6] = a;
        v[o + 7] = this.hue[i] + hueShift;
        out++;
      }
      return out;
    }
  }

  class ParticleEngine {
    constructor(config, canvas) {
      this.canvas = canvas;
      this.pool = null;
      this.weights = { IDLE: 1, TRAIL: 0, BURST: 0, LIGHTNING: 0, VORTEX: 0, SCATTER: 0 };
      this.targets = Object.assign({}, this.weights);
      this.time = 0;
      this.autoScale = 1;
      this.userScale = 1;
      this.hueShift = 0;
      this.width = 1; this.height = 1;
      this._emitAcc = {};
      this._lastTips = [];
      this._boltTimer = 0;
      this._burstPuffTimer = 0;
      this._vortexCenter = null;
      this._lastFistCenter = null;
      this._lowFpsTime = 0;
      this._highFpsTime = 0;
      this.setConfig(config);
    }

    get quality() { return this.autoScale * this.userScale; }

    setQuality(q) { this.userScale = U.clamp(q, 0.3, 1); }

    setConfig(config) {
      this.config = config;
      const g = config.global;
      if (!this.pool || this.pool.cap !== g.capacity) this.pool = new ParticlePool(g.capacity);
      this.tau = g.transitionTau || 0.18;
      this.globalGravity = g.gravity || 0;
    }

    resize(w, h) { this.width = w; this.height = h; }

    toPx(p) {
      // 摄像头预览做了镜像，故对 x 取反以与画面一致
      return { x: (1 - p.x) * this.width, y: p.y * this.height };
    }

    setTargets(targets) { this.targets = Object.assign({}, this.weights, targets || {}); }

    setTheme(theme) {
      this.hueShift = theme && typeof theme.hueShift === 'number' ? theme.hueShift : 0;
    }

    autoQuality(fps, dt) {
      const g = this.config.global;
      const minF = g.minFps || 30, targetF = g.targetFps || 45;
      if (fps < minF) { this._lowFpsTime += dt; this._highFpsTime = 0; }
      else if (fps > targetF) { this._highFpsTime += dt; this._lowFpsTime = 0; }
      else { this._lowFpsTime = this._highFpsTime = 0; }
      if (this._lowFpsTime > 0.8) { this.autoScale = Math.max(0.35, this.autoScale - 0.12); this._lowFpsTime = 0; }
      if (this._highFpsTime > 2.5) { this.autoScale = Math.min(1, this.autoScale + 0.05); this._highFpsTime = 0; }
    }

    _emit(key, rate, perFrameFn, dt) {
      const scaled = rate * this.quality * dt * (this.weights[key] || 0);
      let n = Math.floor(scaled);
      if (Math.random() < scaled - n) n++;
      for (let i = 0; i < n && this.pool.activeCount < this.config.global.maxCount; i++) perFrameFn();
    }

    _color(cfg, hueOverride) {
      const hue = hueOverride != null ? hueOverride : U.rand(cfg.hue[0], cfg.hue[1]);
      const c = U.hsv(hue, cfg.saturation == null ? 0.9 : cfg.saturation,
        cfg.lightness == null ? 0.65 : cfg.lightness);
      return { hue, ...c };
    }

    _spawn(cfg, x, y, vx, vy, hueOverride, alphaOverride, kind) {
      const c = this._color(cfg, hueOverride);
      return this.pool.spawn({
        x, y, vx, vy,
        life: U.rand(cfg.life[0], cfg.life[1]),
        size: U.rand(cfg.size[0], cfg.size[1]),
        r: c.r, g: c.g, b: c.b, hue: c.hue,
        alpha: alphaOverride == null ? cfg.alpha : alphaOverride,
        drag: cfg.drag, gravity: cfg.gravity || 0, kind: kind || 0
      });
    }

    update(dt, gesture) {
      this.time += dt;
      const a = U.approachCoeff(this.tau, dt);
      for (const k in this.weights) this.weights[k] += (this.targets[k] - this.weights[k]) * a;

      const modes = this.config.modes;
      const w = this.weights;
      const gx = gesture || { fingertips: [], palmCenters: [], dual: { norm: 0 } };

      // 待机背景流
      if (modes.IDLE && w.IDLE > 0.01) {
        const m = modes.IDLE;
        this._emit('IDLE', m.emitRate, () => {
          this._spawn(m, U.rand(0, this.width), this.height + 12,
            U.rand(-m.speed[0], m.speed[0]), -U.rand(m.speed[0], m.speed[1]));
        }, dt);
      }

      // 指尖拖尾 + 缎带插值
      if (modes.TRAIL && w.TRAIL > 0.01) {
        const m = modes.TRAIL;
        const tips = gx.fingertips.slice(0, 10).map(p => this.toPx(p));
        const perTip = Math.max(1, Math.floor(tips.length));
        if (tips.length !== this._lastTips.length) this._lastTips = tips.map(t => ({ x: t.x, y: t.y }));
        this._emit('TRAIL', m.emitRate, () => {
          const j = Math.floor(Math.random() * perTip);
          const tip = tips[j] || { x: this.width / 2, y: this.height / 2 };
          const last = this._lastTips[j] || tip;
          const sub = m.ribbonSubSteps || 1;
          const f = Math.random();
          const x = U.lerp(last.x, tip.x, f), y = U.lerp(last.y, tip.y, f);
          const hue = U.rand(m.hue[0], m.hue[1]) + (m.hueDrift || 0) * Math.sin(this.time * 0.9 + j * 0.7);
          this._spawn(m, x + U.rand(-3, 3), y + U.rand(-3, 3),
            (tip.x - last.x) * 0.35 + U.rand(-m.speed[0], m.speed[0]),
            (tip.y - last.y) * 0.35 + U.rand(-m.speed[0], m.speed[1]), hue);
        }, dt);
        tips.forEach((t, j) => { this._lastTips[j] = { x: t.x, y: t.y }; });
        this._lastTips.length = tips.length;
      }

      // 闪爆（持续余烬）
      if (modes.BURST && w.BURST > 0.01) {
        const m = modes.BURST;
        const c = this.toPx(gx.fistCenter || { x: 0.5, y: 0.5 });
        this._burstPuffTimer -= dt;
        if (this._burstPuffTimer <= 0) {
          this._burstPuffTimer = 0.42;
          for (let i = 0; i < Math.floor(110 * w.BURST * this.quality); i++) {
            const ang = U.rand(0, Math.PI * 2);
            const sp = U.rand(m.speed[0], m.speed[1]) * 0.75;
            this._spawn(m, c.x, c.y, Math.cos(ang) * sp, Math.sin(ang) * sp,
              U.rand(m.hue[0], m.hue[1]), 1);
          }
        }
        this._emit('BURST', m.emitRate, () => {
          const ang = U.rand(0, Math.PI * 2), sp = U.rand(m.speed[0], m.speed[1]) * 0.28;
          this._spawn(m, c.x + Math.cos(ang) * 8, c.y + Math.sin(ang) * 8,
            Math.cos(ang) * sp, Math.sin(ang) * sp);
        }, dt);
      }

      // 闪电（指尖 → 前方锯齿电弧）
      if (modes.LIGHTNING && w.LIGHTNING > 0.01) {
        const m = modes.LIGHTNING;
        this._boltTimer -= dt;
        if (this._boltTimer <= 0 && gx.hands && gx.hands.length) {
          this._boltTimer = (m.boltInterval || 0.11) / Math.max(0.2, w.LIGHTNING);
          this._makeBolt(gx.hands[0], m);
        }
      }

      // 漩涡
      if (modes.VORTEX && w.VORTEX > 0.01) {
        const m = modes.VORTEX;
        const base = gx.state === 'DUAL' && gx.palmCenters.length >= 2
          ? { x: (gx.palmCenters[0].x + gx.palmCenters[1].x) / 2,
              y: (gx.palmCenters[0].y + gx.palmCenters[1].y) / 2 }
          : (gx.pinchPoint || { x: 0.5, y: 0.5 });
        const c = this.toPx(base);
        this._vortexCenter = c;
        const scale = gx.state === 'DUAL' ? U.lerp(0.7, 1.9, gx.dual.norm || 0) : 1;
        this._emit('VORTEX', m.emitRate, () => {
          const ang = U.rand(0, Math.PI * 2);
          const rad = U.rand(m.innerRadius, m.outerRadius) * scale;
          const x = c.x + Math.cos(ang) * rad, y = c.y + Math.sin(ang) * rad;
          const sp = U.rand(m.speed[0], m.speed[1]);
          const tangential = m.tangential == null ? 1 : m.tangential;
          const inward = m.inward == null ? 0.32 : m.inward;
          this._spawn(m, x, y,
            -Math.sin(ang) * sp * tangential - Math.cos(ang) * sp * inward,
            Math.cos(ang) * sp * tangential - Math.sin(ang) * sp * inward,
            undefined, undefined, 1);
        }, dt);
      } else {
        this._vortexCenter = null;
      }

      // 四散飞舞
      if (modes.SCATTER && w.SCATTER > 0.01) {
        const m = modes.SCATTER;
        const palms = gx.palmCenters.length ? gx.palmCenters : [{ x: 0.5, y: 0.6 }];
        this._emit('SCATTER', m.emitRate, () => {
          const src = this.toPx(palms[Math.floor(Math.random() * palms.length)]);
          const ang = U.rand(0, Math.PI * 2);
          const sp = U.rand(m.speed[0], m.speed[1]);
          const up = m.upwardBias == null ? 0.85 : m.upwardBias;
          const wind = m.wind || 0;
          this._spawn(m, src.x + U.rand(-24, 24), src.y + U.rand(-16, 16),
            Math.cos(ang) * sp * (1 - up) + wind * Math.sin(this.time * 0.6),
            Math.sin(ang) * sp * (1 - up) - sp * up);
        }, dt);
      }

      this.pool.update(dt, this.globalGravity, this._vortexCenter,
        (modes.VORTEX && modes.VORTEX.swirlAccel) || 140);
    }

    _makeBolt(hand, m) {
      const tip = hand.fingertips[1] || hand.center;
      const pip = hand.landmarks[global.GP_LANDMARK_INDEX.INDEX_PIP] || tip;
      let dx = tip.x - pip.x, dy = tip.y - pip.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const a = this.toPx(tip);
      const length = (m.boltLength || 0.34) * Math.min(this.width, this.height);
      const b = { x: a.x + dx * length, y: a.y + dy * length };
      const paths = [U.jaggedPath(a, b, m.boltSegments || 15, m.boltJitter || 26)];
      if (Math.random() < (m.branchChance || 0.55)) {
        const idx = U.randInt(3, paths[0].length - 3);
        const start = paths[0][idx];
        const branchEnd = { x: start.x + U.rand(-0.6, 0.6) * length * 0.4, y: start.y + U.rand(-0.9, 0.2) * length * 0.4 };
        paths.push(U.jaggedPath(start, branchEnd, 7, 16));
      }
      paths.forEach(path => {
        for (let i = 0; i < path.length - 1; i++) {
          for (let s = 0; s < 4; s++) {
            const t = Math.random();
            const x = U.lerp(path[i].x, path[i + 1].x, t);
            const y = U.lerp(path[i].y, path[i + 1].y, t);
            const c = this._color(m);
            this.pool.spawn({
              x, y, vx: U.rand(-m.speed[0], m.speed[0]), vy: U.rand(-m.speed[0], m.speed[1]),
              life: U.rand(m.life[0], m.life[1]), size: U.rand(m.size[0], m.size[1]),
              r: c.r, g: c.g, b: c.b, hue: c.hue, alpha: m.alpha,
              drag: m.drag, gravity: 0
            });
          }
        }
      });
    }

    /** 触发一次性特效（由主程序在状态切换 / 节拍时调用） */
    trigger(name, gesture, intensity) {
      const m = this.config.modes[name];
      if (!m) return;
      const w = this.weights[name] || 1;
      const factor = (intensity == null ? 1 : intensity) * Math.max(0.4, w);
      if (name === 'BURST') {
        const c = this.toPx(gesture.fistCenter || { x: 0.5, y: 0.5 });
        const count = Math.floor((m.burstCount || 460) * factor * this.quality);
        for (let i = 0; i < count; i++) {
          const ang = U.rand(0, Math.PI * 2);
          const spark = Math.random() < (m.sparkRatio || 0.28);
          const sp = U.rand(m.speed[0], m.speed[1]) * (spark ? 1.25 : 0.8);
          const hue = spark ? U.rand(40, 60) : U.rand(m.hue[0], m.hue[1]);
          this._spawn(m, c.x + Math.cos(ang) * 6, c.y + Math.sin(ang) * 6,
            Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1);
        }
      } else if (name === 'LIGHTNING' && gesture.hands && gesture.hands.length) {
        this._makeBolt(gesture.hands[0], m);
      }
    }

    get count() { return this.pool.activeCount; }
  }

  global.GPParticleEngine = ParticleEngine;
  global.GP_STRIDE = STRIDE;
})(window);
