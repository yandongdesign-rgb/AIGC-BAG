/**
 * Garden —— 花园场景：背景、植物布局、全局生长时间轴、粒子。
 *
 * 状态机：
 *   mode = 'grow'   张开手掌：T 前进（茎叶生长 → 花朵绽放），O → 1（花瓣张开）
 *   mode = 'close'  握拳收拢：O 迅速 → 0（花瓣立即收拢，保证即时反馈），随后 T 回退（植株缩回土壤）
 *   mode = 'pause'  暂停：T、O 保持不变，植物仅随风轻摆
 */
(function () {
  const U = GG.util;
  const { TAU, clamp, lerp, mulberry32, mixHex, rgba, range, pick } = U;
  const P = GG.plants;
  const CFG = GG.config.garden;
  const PAL = GG.config.palette;

  class Garden {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bg = document.createElement('canvas');
      this.mode = 'pause';
      this.intensity = 1;
      this.T = CFG.initialT;
      this.O = 1;
      this.time = 0;
      this.plants = [];
      this.particles = [];
      this.motes = [];
      this.bloomLevel = 0;
      this.growthLevel = 0;
      this.sprite = this._makeSprite();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setMode(mode, intensity = 1) {
      this.mode = mode;
      this.intensity = clamp(intensity);
    }

    // ---------------------------------------------------------------- 尺寸 / 布局
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, CFG.maxDpr);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this._renderBackground();
      this._layout();
      this._initMotes();
    }

    _layout() {
      const { w, h } = this;
      const r = mulberry32(20241031);
      const unit = Math.min(1.35, Math.max(0.6, h / 900));
      const plants = [];
      const types = [
        [P.Daisy, 0.3], [P.Tulip, 0.17], [P.Lavender, 0.17],
        [P.Allium, 0.11], [P.Fern, 0.13], [P.Leafy, 0.12],
      ];
      const pickType = () => {
        let v = r();
        for (const [T, wgt] of types) { if ((v -= wgt) <= 0) return T; }
        return P.Daisy;
      };

      const delayOf = (x) => Math.min(0.36, Math.abs(x / w - 0.5) * 0.62 + r() * 0.08);
      const SPAN = 0.6;

      // 主体花卉：三层景深
      const n = Math.round(clamp(w / 58, 14, 40));
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * w + range(r, -0.45, 0.45) * (w / n);
        const depth = r();
        const Type = pickType();
        const baseY = h * lerp(0.79, 0.985, depth);
        const scale = lerp(0.62, 1.12, depth) * unit;
        const maxH = baseY - h * 0.16;
        const H = Math.min(maxH, h * range(r, 0.22, 0.44) * lerp(0.7, 1.05, depth));
        plants.push(new Type({
          x, baseY, H, scale, depth,
          delay: delayOf(x), span: SPAN,
          seed: Math.floor(r() * 1e9),
          fogT: (1 - depth) * 0.5,
        }));
      }

      // 草丛：前景与远景
      const g = Math.round(clamp(w / 45, 18, 54));
      for (let i = 0; i < g; i++) {
        const x = range(r, -0.02, 1.02) * w;
        const front = r() < 0.65;
        const depth = front ? range(r, 0.85, 1.05) : range(r, 0.05, 0.4);
        plants.push(new P.Grass({
          x,
          baseY: h * lerp(0.79, 0.99, Math.min(depth, 1)) + (front ? 6 : 0),
          H: h * range(r, 0.05, 0.12) * lerp(0.6, 1.1, depth),
          scale: lerp(0.62, 1.12, depth) * unit,
          depth,
          delay: delayOf(x) * 0.5,
          span: 0.5,
          seed: Math.floor(r() * 1e9),
          fogT: clamp((1 - depth) * 0.5, 0, 0.5),
        }));
      }

      plants.sort((a, b) => a.depth - b.depth);
      this.plants = plants;
      this.flowering = plants.filter((p) => p.hasFlower);
    }

    // ---------------------------------------------------------------- 背景（离屏缓存）
    _renderBackground() {
      const { w, h, dpr } = this;
      const c = this.bg;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const sky = ctx.createLinearGradient(0, 0, 0, h);
      PAL.sky.forEach((col, i) => sky.addColorStop(i / (PAL.sky.length - 1), col));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // 柔光
      const sun = ctx.createRadialGradient(w * 0.7, h * 0.2, 0, w * 0.7, h * 0.2, Math.max(w, h) * 0.55);
      sun.addColorStop(0, 'rgba(252, 240, 220, 0.75)');
      sun.addColorStop(0.35, 'rgba(250, 238, 218, 0.25)');
      sun.addColorStop(1, 'rgba(250, 238, 218, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      // 远山层叠
      const r = mulberry32(77);
      const hillBase = [0.6, 0.68, 0.75];
      PAL.hills.forEach((col, li) => {
        const ph = [r() * TAU, r() * TAU, r() * TAU];
        const amp = h * (0.035 - li * 0.006);
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 10; x += 10) {
          const t = x / w;
          const y = h * hillBase[li]
            - amp * Math.sin(t * 2.2 * Math.PI + ph[0])
            - amp * 0.5 * Math.sin(t * 5.1 * Math.PI + ph[1])
            - amp * 0.25 * Math.sin(t * 11 * Math.PI + ph[2]);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        // 层间薄雾
        const mist = ctx.createLinearGradient(0, h * (hillBase[li] - 0.05), 0, h * (hillBase[li] + 0.06));
        mist.addColorStop(0, 'rgba(240, 241, 234, 0)');
        mist.addColorStop(1, 'rgba(240, 241, 234, 0.35)');
        ctx.fillStyle = mist;
        ctx.fillRect(0, h * (hillBase[li] - 0.05), w, h * 0.11);
      });

      // 地面
      const groundY = h * 0.78;
      const gr = ctx.createLinearGradient(0, groundY, 0, h);
      gr.addColorStop(0, rgba(PAL.ground[0], 0));
      gr.addColorStop(0.25, rgba(PAL.ground[0], 0.9));
      gr.addColorStop(1, PAL.ground[1]);
      ctx.fillStyle = gr;
      ctx.fillRect(0, groundY, w, h - groundY);
    }

    _makeSprite() {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255, 250, 236, 1)');
      grd.addColorStop(0.4, 'rgba(255, 248, 230, 0.45)');
      grd.addColorStop(1, 'rgba(255, 248, 230, 0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return c;
    }

    _initMotes() {
      const r = mulberry32(5);
      const count = Math.round(clamp((this.w * this.h) / 50000, 18, 48));
      this.motes = Array.from({ length: count }, () => ({
        x: r() * this.w,
        y: r() * this.h * 0.85,
        r: r() < 0.2 ? range(r, 14, 32) : range(r, 2, 7),
        a: range(r, 0.12, 0.4),
        vy: -range(r, 2, 8),
        ph: r() * TAU,
      }));
    }

    // ---------------------------------------------------------------- 更新
    update(dt) {
      this.time += dt;
      const k = 0.55 + 0.45 * this.intensity;

      if (this.mode === 'grow') {
        this.O = Math.min(1, this.O + dt * CFG.unfoldSpeed);
        this.T = Math.min(1, this.T + dt * CFG.growSpeed * k);
      } else if (this.mode === 'close') {
        const prevO = this.O;
        this.O = Math.max(0, this.O - dt * CFG.foldSpeed);
        if (this.O < 0.55) this.T = Math.max(0, this.T - dt * CFG.retractSpeed);
        if (prevO > this.O) this._shedPetals(dt);
      }

      let bloomSum = 0;
      let growSum = 0;
      for (const p of this.plants) {
        p.update(this.T, this.O, this.time);
        growSum += p.growth;
      }
      for (const p of this.flowering) bloomSum += p.bloom;
      this.bloomLevel = this.flowering.length ? bloomSum / this.flowering.length : 0;
      this.growthLevel = growSum / this.plants.length;

      if (this.mode === 'grow') this._emitPollen(dt);
      this._updateParticles(dt);
      this._updateMotes(dt);
    }

    _emitPollen(dt) {
      if (this.particles.length > 260) return;
      for (const p of this.flowering) {
        if (p.bloom < 0.6 || Math.random() > dt * 0.9 * p.bloom) continue;
        const e = p.emitPoint();
        this.particles.push({
          kind: 'pollen',
          x: e.x + range(Math.random, -8, 8),
          y: e.y + range(Math.random, -8, 4),
          vx: range(Math.random, -6, 6),
          vy: -range(Math.random, 10, 26),
          r: range(Math.random, 1.4, 3.2) * p.scale,
          life: 0,
          max: range(Math.random, 3, 6),
          ph: Math.random() * TAU,
        });
      }
    }

    _shedPetals(dt) {
      if (this.particles.length > 260) return;
      for (const p of this.flowering) {
        if (p.bloom < 0.15 || !p.petal || Math.random() > dt * 1.4) continue;
        const e = p.emitPoint();
        this.particles.push({
          kind: 'petal',
          x: e.x, y: e.y,
          vx: range(Math.random, -14, 14),
          vy: range(Math.random, 6, 20),
          r: range(Math.random, 4, 7) * p.scale,
          rot: Math.random() * TAU,
          vr: range(Math.random, -2, 2),
          color: p.petal,
          life: 0,
          max: range(Math.random, 2.5, 4),
          ph: Math.random() * TAU,
        });
      }
    }

    _updateParticles(dt) {
      const t = this.time;
      const arr = this.particles;
      for (let i = arr.length - 1; i >= 0; i--) {
        const q = arr[i];
        q.life += dt;
        if (q.life > q.max || q.y > this.h + 20 || q.y < -20) { arr.splice(i, 1); continue; }
        q.x += (q.vx + Math.sin(t * 1.3 + q.ph) * 10) * dt;
        q.y += q.vy * dt;
        if (q.kind === 'petal') { q.rot += q.vr * dt; q.vy += 6 * dt; }
      }
    }

    _updateMotes(dt) {
      for (const m of this.motes) {
        m.y += m.vy * dt;
        m.x += Math.sin(this.time * 0.3 + m.ph) * 6 * dt;
        if (m.y < -40) { m.y = this.h * 0.9; m.x = Math.random() * this.w; }
      }
    }

    // ---------------------------------------------------------------- 绘制
    draw() {
      const { ctx, dpr, w, h } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 浮动光斑（随盛开程度变亮）
      const glow = 0.55 + 0.75 * this.bloomLevel;
      for (const m of this.motes) {
        const tw = 0.6 + 0.4 * Math.sin(this.time * 0.8 + m.ph);
        ctx.globalAlpha = clamp(m.a * tw * glow);
        ctx.drawImage(this.sprite, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      }
      ctx.globalAlpha = 1;

      // 植物：由远及近
      for (const p of this.plants) p.draw(ctx, this.time);

      // 粒子
      for (const q of this.particles) {
        const fade = Math.min(1, q.life / 0.5, (q.max - q.life) / 0.8);
        if (q.kind === 'pollen') {
          ctx.globalAlpha = clamp(fade * 0.9);
          const s = q.r * 3.2;
          ctx.drawImage(this.sprite, q.x - s, q.y - s, s * 2, s * 2);
        } else {
          ctx.globalAlpha = clamp(fade * 0.85);
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, q.r, q.r * 0.45, 0, 0, TAU);
          ctx.fillStyle = q.color;
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;

      // 前景地面薄雾，柔化植株根部
      const fg = ctx.createLinearGradient(0, h * 0.94, 0, h);
      fg.addColorStop(0, 'rgba(198, 206, 184, 0)');
      fg.addColorStop(1, 'rgba(176, 188, 160, 0.55)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, h * 0.94, w, h * 0.06);
    }
  }

  GG.Garden = Garden;
})();
