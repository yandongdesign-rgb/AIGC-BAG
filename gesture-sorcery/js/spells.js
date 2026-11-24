// 法术系统：根据手势状态驱动 9 种法术的粒子、2D 特效、屏幕效果与音效
(function () {
  const SG = window.SG;
  const U = SG.U, D = SG.Draw, PF = SG.PF;
  const TAU = Math.PI * 2;

  const PAL = {
    red: { main: [1, 0.16, 0.08], core: [1, 0.72, 0.42], glow: [1, 0.08, 0.04] },
    blue: { main: [0.18, 0.52, 1], core: [0.72, 0.92, 1], glow: [0.08, 0.28, 1], spin: -1 },
    purple: { main: [0.72, 0.22, 1], core: [0.98, 0.75, 1], glow: [0.55, 0.08, 1] },
  };
  const C = {
    gold: [1, 0.8, 0.36], cyan: [0.45, 0.9, 1], zap: [0.55, 0.78, 1], crimson: [1, 0.06, 0.14],
    ghost: [0.6, 1, 0.9], ghost2: [0.05, 0.45, 0.75], white: [1, 1, 1], magenta: [1, 0.3, 0.9], violet: [0.6, 0.2, 1],
  };
  const TRAIL = { point: PAL.red.main, pinch: PAL.blue.main, v: C.zap, rock: C.ghost, open: C.gold, fist: C.crimson, none: [0.7, 0.75, 1] };

  SG.SPELLS = [
    { id: 'red', name: '术式 · 赫', en: 'RED', icon: '☝️', how: '只伸食指' },
    { id: 'blue', name: '术式 · 苍', en: 'BLUE', icon: '🤏', how: '拇指食指捏合' },
    { id: 'purple', name: '虚式 · 茈', en: 'HOLLOW PURPLE', icon: '☝️🤏', how: '赫 + 苍 双手靠拢，再张开手掌释放' },
    { id: 'burst', name: '闪爆', en: 'FLASH BURST', icon: '✊→✋', how: '握拳蓄力，猛然张开' },
    { id: 'blackflash', name: '黑闪', en: 'BLACK FLASH', icon: '✊💨', how: '握拳快速出拳 / 挥拳' },
    { id: 'lightning', name: '雷霆万钧', en: 'THUNDER', icon: '✌️', how: '剑指（食指+中指），双手可连弧' },
    { id: 'flame', name: '幽冥狐火', en: 'FOXFIRE', icon: '🤘', how: '食指+小指（摇滚手势）' },
    { id: 'circle', name: '天穹法阵', en: 'ARCANE SEAL', icon: '✋', how: '张开手掌' },
    { id: 'domain', name: '领域展开 · 无量空处', en: 'DOMAIN EXPANSION', icon: '🙌', how: '双手张开保持 1 秒' },
  ];

  const cnt = (rate, dt) => Math.floor(rate * dt + Math.random());

  class Spells {
    constructor(env) {
      Object.assign(this, env); // pool, fx, stage, audio, cfg, ui
      this.st = new Map();
      this.purple = null;
      this.domain = null;
      this.domainHold = 0;
      this.cool = { purple: 0, domain: 0 };
      this.timers = [];
      this.t = 0;
      this.lastCast = {};
      this.active = new Set();
      this.showSkeleton = true;
      this.hands = [];
    }

    S(h) {
      let s = this.st.get(h.id);
      if (!s) { s = { red: { k: 0, on: false, x: 0, y: 0 }, blue: { k: 0, on: false, x: 0, y: 0 }, circle: 0, circleOn: false, flame: 0, flameOn: false, zap: 0, zapT: 0, strikeT: 1, charge: 0, fistT: -1e9, lastBlack: -1e9, g: 'none' }; this.st.set(h.id, s); }
      return s;
    }
    later(sec, fn) { this.timers.push({ t: sec, fn }); }
    cast(id) { this.lastCast[id] = this.t; }

    update(hands, dt, now, W, H) {
      this.t += dt; this.W = W; this.H = H; this.hands = hands;
      const cfg = this.cfg.spells, pool = this.pool;
      const fields = [];
      for (const k in this.cool) this.cool[k] -= dt;
      for (const tm of this.timers) { tm.t -= dt; if (tm.t <= 0) tm.fn(); }
      this.timers = this.timers.filter((tm) => tm.t > 0);
      for (const id of this.st.keys()) if (!hands.find((h) => h.id === id)) this.st.delete(id);

      let loopRed = 0, loopBlue = 0, loopCharge = 0, chargeP = 0, loopZap = 0, loopFlame = 0, loopCircle = 0, redP = 0;
      const act = this.active; act.clear();

      for (const h of hands) {
        const s = this.S(h);
        const g = h.present ? h.gesture : s.g;
        s.g = g;
        const inPurple = this.purple && this.purple.ids.includes(h.id);
        const sz = h.size;

        // ---- 赫 ----
        const wantRed = g === 'point' && !inPurple && this.cool.purple <= 0;
        s.red.k = U.damp(s.red.k, wantRed ? 1 : 0, wantRed ? 9 : 7, dt);
        if (wantRed && !s.red.on) { s.red.on = true; this.audio.play('igniteRed'); this.fx.ring(h.tips.index.x, h.tips.index.y, { r0: 5, r1: sz * 1.6, life: 0.4, color: PAL.red.main, width: 4 }); }
        if (!wantRed && s.red.k < 0.05) s.red.on = false;
        if (s.red.k > 0.02) {
          const r = s.red;
          r.x = h.tips.index.x + h.indexDir.x * sz * 0.38; r.y = h.tips.index.y + h.indexDir.y * sz * 0.38;
          r.r = sz * 0.3;
          const n = cnt(260 * r.k, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU, rr = r.r * U.rand(1, 1.6), sp = U.rand(120, 320);
            pool.emit({ x: r.x + Math.cos(a) * rr, y: r.y + Math.sin(a) * rr, vx: -Math.sin(a) * sp + Math.cos(a) * 80, vy: Math.cos(a) * sp + Math.sin(a) * 80,
              life: U.rand(0.3, 0.8), size: U.rand(3, 8), size2: 0.5, color: [1, 0.45, 0.15], color2: [0.8, 0.02, 0.02], drag: 1.5, flags: PF.HOT });
          }
          if (Math.random() < dt * 6 * r.k) { const a = Math.random() * TAU; this.fx.bolt(r.x, r.y, r.x + Math.cos(a) * r.r * 3, r.y + Math.sin(a) * r.r * 3, { color: PAL.red.main, width: 1.2, life: 0.08, branches: 1 }); }
          fields.push({ x: r.x, y: r.y, strength: -3800 * r.k, radius: sz * 0.9, swirl: 0.5 });
          loopRed = Math.max(loopRed, r.k); redP = Math.max(redP, r.k);
          act.add('red');
        }

        // ---- 苍 ----
        const wantBlue = g === 'pinch' && !inPurple && this.cool.purple <= 0;
        s.blue.k = U.damp(s.blue.k, wantBlue ? 1 : 0, wantBlue ? 9 : 7, dt);
        if (wantBlue && !s.blue.on) { s.blue.on = true; this.audio.play('igniteBlue'); this.fx.ring(h.pinchPt.x, h.pinchPt.y, { r0: sz * 2, r1: 5, life: 0.45, color: PAL.blue.main, width: 4 }); }
        if (!wantBlue && s.blue.k < 0.05) s.blue.on = false;
        if (s.blue.k > 0.02) {
          const b = s.blue;
          b.x = h.pinchPt.x; b.y = h.pinchPt.y - sz * 0.25; b.r = sz * 0.26;
          const n = cnt(320 * b.k, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU, rr = b.r * U.rand(3, 7), sp = U.rand(150, 380);
            pool.emit({ x: b.x + Math.cos(a) * rr, y: b.y + Math.sin(a) * rr, vx: -Math.sin(a) * sp - Math.cos(a) * sp * 0.4, vy: Math.cos(a) * sp - Math.sin(a) * sp * 0.4,
              life: U.rand(0.8, 1.6), size: U.rand(2, 5), size2: 4, color: [0.35, 0.65, 1], color2: [0.85, 0.95, 1], drag: 0.8, flags: PF.FIELD });
          }
          fields.push({ x: b.x, y: b.y, strength: 5200 * b.k, radius: sz * 1.2, swirl: 1.6, sink: b.r * 0.6 });
          loopBlue = Math.max(loopBlue, b.k);
          act.add('blue');
        }

        // ---- 握拳蓄力 / 闪爆 ----
        if (g === 'fist' && !inPurple) {
          s.charge = Math.min(1, s.charge + dt / 1.1); s.fistT = now;
          const n = cnt(140 + 260 * s.charge, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU, dd = sz * U.rand(1.5, 3.2), tt = 0.3;
            pool.emit({ x: h.palm.x + Math.cos(a) * dd, y: h.palm.y + Math.sin(a) * dd, vx: -Math.cos(a) * dd / tt + h.vx, vy: -Math.sin(a) * dd / tt + h.vy,
              life: tt, size: U.rand(1.5, 4), size2: 3, color: [1, 0.9, 0.6], color2: [1, 0.6, 0.2], flags: 0 });
          }
          loopCharge = Math.max(loopCharge, s.charge); chargeP = Math.max(chargeP, s.charge);
        } else if (g === 'open' && s.charge > cfg.burstMinCharge && now - s.fistT < 650 && !inPurple) {
          this.burst(h.palm.x, h.palm.y, 0.35 + s.charge * 0.85, sz);
          s.charge = 0;
        } else if (now - s.fistT > 650 || inPurple) s.charge = 0;

        // ---- 黑闪 ----
        if (h.present && (g === 'fist' || now - h.lastFist < 250) && now - h.born > 350 && now - s.lastBlack > cfg.blackFlashCooldown * 1000 &&
            (h.speed > cfg.blackFlashSpeed || h.sizeRate > 2.6)) {
          s.lastBlack = now; s.charge = 0;
          this.blackFlash(h.palm.x + h.vx * 0.04, h.palm.y + h.vy * 0.04, sz);
        }

        // ---- 雷霆 ----
        const wantZap = g === 'v';
        s.zap = U.damp(s.zap, wantZap ? 1 : 0, 10, dt);
        if (s.zap > 0.05) {
          s.zapT -= dt;
          const ti = h.tips.index, tm = h.tips.middle;
          const dir = U.norm((ti.x + tm.x) / 2 - h.palm.x, (ti.y + tm.y) / 2 - h.palm.y);
          if (s.zapT <= 0 && wantZap) {
            s.zapT = U.rand(0.035, 0.07);
            for (const tp of [ti, tm]) {
              const L = sz * U.rand(1.6, 4.2), off = U.rand(-1, 1) * sz * 1.4;
              this.fx.bolt(tp.x, tp.y, tp.x + dir.x * L - dir.y * off, tp.y + dir.y * L + dir.x * off, { color: C.zap, width: U.rand(1.2, 2.2), life: U.rand(0.06, 0.12), branches: 2 });
            }
            this.fx.bolt(ti.x, ti.y, tm.x, tm.y, { color: [0.8, 0.9, 1], width: 1, life: 0.06, branches: 0, jitter: 0.5 });
            for (const o of hands) {
              if (o === h || !o.present) continue;
              const d = U.dist(o.tips.index, ti);
              if (d < W * 0.85 && (o.gesture === 'v' || Math.random() < 0.25)) this.fx.bolt(ti.x, ti.y, o.tips.index.x, o.tips.index.y, { color: [0.7, 0.6, 1], width: 2.6, life: 0.09, branches: 4, jitter: 0.18 });
            }
          }
          const n = cnt(120 * s.zap, dt);
          for (let i = 0; i < n; i++) {
            const tp = Math.random() < 0.5 ? ti : tm, a = Math.random() * TAU, sp = U.rand(100, 600);
            pool.emit({ x: tp.x, y: tp.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.15, 0.4), size: U.rand(1.5, 3.5), color: [0.8, 0.9, 1], color2: C.zap, drag: 4, gravity: 300, flags: PF.HOT });
          }
          s.strikeT -= dt;
          if (s.strikeT <= 0 && wantZap) {
            s.strikeT = U.rand(0.7, 1.6);
            const ang = Math.atan2(dir.y, dir.x) + U.rand(-0.7, 0.7), L = Math.max(W, H);
            this.fx.bolt(ti.x, ti.y, ti.x + Math.cos(ang) * L, ti.y + Math.sin(ang) * L, { color: [0.6, 0.75, 1], width: 3.6, life: 0.28, branches: 7, jitter: 0.2 });
            this.fx.glow(ti.x, ti.y, { r: sz * 3, color: C.zap, life: 0.25, a: 0.8 });
            this.stage.flash('#bcd8ff', 0.22, 9); this.stage.shake(7);
            this.audio.play('thunder', 1);
          }
          loopZap = Math.max(loopZap, s.zap);
          act.add('lightning');
        }

        // ---- 幽冥狐火 ----
        const wantFlame = g === 'rock';
        s.flame = U.damp(s.flame, wantFlame ? 1 : 0, 8, dt);
        if (wantFlame && !s.flameOn) { s.flameOn = true; this.audio.play('flameOn'); }
        if (!wantFlame && s.flame < 0.05) s.flameOn = false;
        if (s.flame > 0.03) {
          const em = [[h.tips.index, 1], [h.tips.pinky, 0.85], [h.palm, 1.4]];
          for (const [p, m] of em) {
            const n = cnt(150 * s.flame * m, dt);
            for (let i = 0; i < n; i++) {
              pool.emit({ x: p.x + U.rand(-0.12, 0.12) * sz, y: p.y + U.rand(-0.1, 0.1) * sz, vx: U.rand(-40, 40) + h.vx * 0.3, vy: U.rand(-200, -420) + h.vy * 0.3,
                life: U.rand(0.45, 0.9), size: U.rand(0.16, 0.3) * sz * m, size2: 2, color: C.ghost, color2: C.ghost2, alpha: 0.55, drag: 1.2, flags: PF.TURB | PF.HOT });
            }
          }
          if (Math.random() < dt * 40 * s.flame) pool.emit({ x: h.palm.x + U.rand(-1, 1) * sz * 0.5, y: h.palm.y, vx: U.rand(-60, 60), vy: U.rand(-80, -220), life: U.rand(1, 2), size: U.rand(2, 4), color: [0.7, 1, 0.9], color2: [0.1, 0.7, 0.9], drag: 0.5, gravity: -40, flags: PF.FLICKER | PF.TURB });
          loopFlame = Math.max(loopFlame, s.flame);
          act.add('flame');
        }

        // ---- 天穹法阵 ----
        const wantCircle = g === 'open' && !inPurple;
        s.circle = U.damp(s.circle, wantCircle ? 1 : 0, wantCircle ? 4 : 6, dt);
        if (wantCircle && !s.circleOn) { s.circleOn = true; this.audio.play('circle'); }
        if (!wantCircle && s.circle < 0.05) s.circleOn = false;
        if (s.circle > 0.03) {
          const R = sz * 1.9, n = cnt(70 * s.circle, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            pool.emit({ x: h.palm.x + Math.cos(a) * R, y: h.palm.y + Math.sin(a) * R, vx: -Math.sin(a) * 40, vy: U.rand(-60, -140), life: U.rand(0.8, 1.6), size: U.rand(2, 4.5), color: C.gold, color2: C.cyan, flags: PF.FLICKER });
          }
          loopCircle = Math.max(loopCircle, s.circle);
          act.add('circle');
        }

        // ---- 指尖拖尾 ----
        if (h.present && h.speed > 0.35) {
          const n = cnt(220 * Math.min(3, h.speed), dt), col = TRAIL[g] || TRAIL.none;
          for (let i = 0; i < n; i++) pool.emit({ x: h.tips.index.x + U.rand(-3, 3), y: h.tips.index.y + U.rand(-3, 3), vx: U.rand(-30, 30), vy: U.rand(-30, 30), life: U.rand(0.3, 0.7), size: U.rand(2, 4.5), size2: 0.5, color: col, flags: PF.HOT });
        }
      }

      this.updatePurple(hands, dt, now, fields);
      this.updateDomain(hands, dt, now, fields);

      pool.fields = fields;
      const A = this.audio;
      A.setLoop('red', loopRed, redP); A.setLoop('blue', loopBlue); A.setLoop('charge', loopCharge, chargeP);
      A.setLoop('zap', loopZap); A.setLoop('flame', loopFlame); A.setLoop('circle', loopCircle);
      A.setLoop('purple', this.purple ? Math.min(1, this.purple.t * 2) : 0, this.purple ? this.purple.charge : 0);
      for (const id in this.lastCast) if (this.t - this.lastCast[id] < 1.2) act.add(id);
      if (this.purple) act.add('purple');
      if (this.domain || this.domainHold > 0.1) act.add('domain');
      if (hands.some((h) => this.S(h).charge > 0.05)) act.add('burst');
    }

    // ---------------- 虚式 · 茈 ----------------
    updatePurple(hands, dt, now, fields) {
      const cfg = this.cfg.spells;
      if (!this.purple && this.cool.purple <= 0) {
        for (const a of hands) for (const b of hands) {
          if (a === b) continue;
          const sa = this.S(a), sb = this.S(b);
          if (sa.red.k > 0.6 && sb.blue.k > 0.6) {
            const d = Math.hypot(sa.red.x - sb.blue.x, sa.red.y - sb.blue.y);
            if (d < cfg.fuseDistance * (a.size + b.size) * 0.5 + 40) {
              const x = (sa.red.x + sb.blue.x) / 2, y = (sa.red.y + sb.blue.y) / 2;
              this.purple = { x, y, ids: [a.id, b.id], t: 0, charge: 0, lost: 0, size: (a.size + b.size) / 2 };
              this.audio.play('fuse');
              this.fx.ring(x, y, { r0: 5, r1: this.purple.size * 4, life: 0.6, color: PAL.purple.main, width: 8 });
              this.fx.glow(x, y, { r: this.purple.size * 4, color: PAL.purple.main, life: 0.5, a: 0.9 });
              this.stage.flash('#c79bff', 0.3, 5); this.stage.shake(8);
              for (let i = 0; i < 400; i++) { const ang = Math.random() * TAU, sp = U.rand(100, 700); this.pool.emit({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: U.rand(0.4, 1), size: U.rand(2, 5), color: i % 2 ? PAL.red.core : PAL.blue.core, color2: PAL.purple.main, drag: 2.5, flags: PF.HOT }); }
              this.ui.title('茈', 'FUSION', 'purple small');
              return;
            }
          }
        }
        return;
      }
      const p = this.purple;
      if (!p) return;
      p.t += dt;
      const a = hands.find((h) => h.id === p.ids[0] && h.present), b = hands.find((h) => h.id === p.ids[1] && h.present);
      if (a && b) {
        p.lost = 0;
        const ta = { x: a.palm.x + a.up.x * a.size * 0.9, y: a.palm.y + a.up.y * a.size * 0.9 };
        const tb = { x: b.palm.x + b.up.x * b.size * 0.9, y: b.palm.y + b.up.y * b.size * 0.9 };
        const m = U.mid(ta, tb);
        p.x = U.damp(p.x, m.x, 10, dt); p.y = U.damp(p.y, m.y, 10, dt);
        p.size = (a.size + b.size) / 2;
      } else {
        p.lost += dt;
        if (p.lost > 0.9) { this.dissipate(); return; }
      }
      p.charge = Math.min(1, p.charge + dt / 1.6);
      const opener = [a, b].find((h) => h && h.gesture === 'open');
      if ((opener && p.charge > 0.3) || p.t > 9) { this.releasePurple(); return; }
      const r = p.size * (0.36 + 0.3 * p.charge);
      p.r = r;
      // 红蓝双螺旋汇入
      const n = cnt(500, dt);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * TAU, rr = r * U.rand(2.5, 5), red = i % 2 === 0, sp = U.rand(200, 500) * (red ? 1 : -1);
        this.pool.emit({ x: p.x + Math.cos(ang) * rr, y: p.y + Math.sin(ang) * rr, vx: -Math.sin(ang) * sp - Math.cos(ang) * 150, vy: Math.cos(ang) * sp - Math.sin(ang) * 150,
          life: U.rand(0.5, 1), size: U.rand(2, 5), size2: 1, color: red ? PAL.red.core : PAL.blue.core, color2: PAL.purple.core, drag: 0.6, flags: PF.FIELD });
      }
      if (Math.random() < dt * 14) { const ang = Math.random() * TAU; this.fx.bolt(p.x, p.y, p.x + Math.cos(ang) * r * U.rand(1.6, 3.4), p.y + Math.sin(ang) * r * U.rand(1.6, 3.4), { color: PAL.purple.main, width: 1.8, life: 0.1, branches: 2 }); }
      fields.push({ x: p.x, y: p.y, strength: 6000, radius: p.size * 1.3, swirl: 2.2, sink: r * 0.7 });
      this.stage.shake(1.5 + 3 * p.charge);
    }

    dissipate() {
      const p = this.purple; this.purple = null;
      this.audio.play('dissipate');
      for (let i = 0; i < 300; i++) { const a = Math.random() * TAU, sp = U.rand(40, 300); this.pool.emit({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.5, 1.2), size: U.rand(2, 4), color: PAL.purple.core, color2: PAL.purple.main, drag: 2 }); }
    }

    releasePurple() {
      const p = this.purple; this.purple = null;
      const x = p.x, y = p.y, W = this.W, H = this.H, R = Math.hypot(W, H);
      this.cool.purple = 1.2;
      this.cast('purple');
      this.audio.play('purpleRelease');
      this.stage.flash('#efdcff', 0.95, 1.5); this.stage.shake(42); this.stage.videoPulse(1.3, 70);
      this.fx.blast(x, y, { r: R * 1.1, life: 1.7, color: [0.72, 0.25, 1] });
      this.fx.rays(x, y, { count: 280, len: R * 0.45, life: 1.5, color: [0.86, 0.5, 1], width: 2.4, speed: 1.2, inner: p.size });
      this.fx.ring(x, y, { r0: p.size, r1: R, life: 1.0, color: PAL.purple.main, width: 16 });
      this.fx.ring(x, y, { r0: p.size, r1: R * 0.7, life: 0.8, color: [1, 0.85, 1], width: 8 });
      this.later(0.18, () => this.fx.ring(x, y, { r0: p.size * 2, r1: R * 1.3, life: 1.3, color: C.magenta, width: 12 }));
      const bolts = (k) => { for (let i = 0; i < k; i++) { const a = Math.random() * TAU, L = R * U.rand(0.35, 0.8); this.fx.bolt(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, { color: [0.85, 0.45, 1], width: U.rand(2.5, 5), life: U.rand(0.25, 0.6), branches: 5, jitter: 0.2 }); } };
      bolts(16); this.later(0.22, () => bolts(10)); this.later(0.5, () => bolts(6));
      const cols = [C.magenta, C.violet, C.white, [0.5, 0.8, 1], PAL.purple.core];
      for (let i = 0; i < 6500; i++) {
        const a = Math.random() * TAU, sp = Math.pow(Math.random(), 0.6) * 3400 + 200;
        this.pool.emit({ x: x + Math.cos(a) * p.size * 0.3, y: y + Math.sin(a) * p.size * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.8, 2.6), size: U.rand(2, 7), size2: 0.6, color: U.pick(cols), color2: C.violet, drag: U.rand(1, 2.6), flags: PF.HOT | PF.FIELD });
      }
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * TAU, sp = U.rand(100, 900);
        this.pool.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.5, 1.2), size: U.rand(40, 110), size2: 10, color: PAL.purple.main, alpha: 0.18, drag: 2 });
      }
      this.later(0.6, () => { for (let i = 0; i < 900; i++) this.pool.emit({ x: Math.random() * W, y: Math.random() * H, vx: U.rand(-40, 40), vy: U.rand(-90, -20), life: U.rand(1.5, 3.5), size: U.rand(1.5, 4), color: PAL.purple.core, color2: C.violet, flags: PF.FLICKER | PF.TURB }); });
      this.ui.title('虚式「茈」', 'HOLLOW PURPLE', 'purple');
    }

    // ---------------- 闪爆 ----------------
    burst(x, y, power, sz) {
      this.cast('burst');
      this.audio.play('burst', power);
      this.stage.flash('#fff3dc', 0.6 * power, 4); this.stage.shake(18 * power); this.stage.videoPulse(0.7 * power, 25);
      this.fx.ring(x, y, { r0: sz * 0.3, r1: sz * 8 * power, life: 0.75, color: C.gold, width: 10 });
      this.fx.ring(x, y, { r0: sz * 0.2, r1: sz * 5 * power, life: 0.55, color: C.cyan, width: 6 });
      this.later(0.08, () => this.fx.ring(x, y, { r0: sz * 0.5, r1: sz * 11 * power, life: 0.9, color: [1, 0.55, 0.25], width: 5 }));
      this.fx.glow(x, y, { r: sz * 7 * power, color: C.gold, life: 0.45, a: 1 });
      this.fx.rays(x, y, { count: 70, len: sz * 5 * power, life: 0.75, color: C.gold, width: 2.2, inner: sz * 0.4 });
      const n = (1600 * power) | 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = U.rand(150, 1900) * Math.sqrt(power);
        this.pool.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.5, 1.7), size: U.rand(2, 6), size2: 0.5, color: [1, 0.9, 0.55], color2: [1, 0.3, 0.08], drag: U.rand(1.6, 3), gravity: 160, flags: PF.HOT });
      }
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * TAU, sp = U.rand(60, 400);
        this.pool.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.3, 0.7), size: U.rand(30, 80) * power, size2: 5, color: [1, 0.7, 0.3], alpha: 0.2, drag: 3 });
      }
      if (power > 0.95) this.ui.title('闪爆', 'FLASH BURST', 'gold');
    }

    // ---------------- 黑闪 ----------------
    blackFlash(x, y, sz) {
      this.cast('blackflash');
      this.audio.play('blackFlash');
      this.stage.invert(0.09); this.stage.shake(28); this.stage.flash('#ff1530', 0.3, 6);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, L = sz * U.rand(2.5, 7);
        this.fx.bolt(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, { color: C.crimson, width: U.rand(4, 7), life: U.rand(0.25, 0.45), dark: true, branches: 4, jitter: 0.32 });
      }
      this.fx.ring(x, y, { r0: sz * 0.3, r1: sz * 6, life: 0.5, color: C.crimson, width: 12, dark: true });
      this.fx.glow(x, y, { r: sz * 4, color: C.crimson, life: 0.35, a: 0.9 });
      for (let i = 0; i < 700; i++) {
        const a = Math.random() * TAU, sp = U.rand(250, 1600);
        this.pool.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.25, 0.8), size: U.rand(2, 5), size2: 0.5, color: [1, 0.25, 0.3], color2: [0.5, 0, 0.05], drag: 3.5, flags: PF.HOT });
      }
      this.ui.title('黑闪', 'BLACK FLASH', 'black');
    }

    // ---------------- 领域展开 ----------------
    updateDomain(hands, dt, now, fields) {
      const cfg = this.cfg.spells;
      const opens = hands.filter((h) => h.present && h.gesture === 'open');
      if (!this.domain && this.cool.domain <= 0 && opens.length >= 2 && !this.purple) {
        if (this.domainHold === 0) this.audio.play('domainStart');
        this.domainHold += dt;
        this.holdPts = [opens[0].palm, opens[1].palm];
        if (this.domainHold >= cfg.domainHold) this.startDomain(U.mid(opens[0].palm, opens[1].palm));
      } else this.domainHold = Math.max(0, this.domainHold - dt * 3);

      const d = this.domain;
      if (!d) { this.stage.dim = U.damp(this.stage.dim, 0, 4, dt); this.audio.setLoop('domain', 0); this.audio.duck(0); this.dustBoost = 1; return; }
      d.t += dt;
      const dur = cfg.domainDuration;
      d.a = d.t < 0.9 ? U.easeOutCubic(d.t / 0.9) : d.t > dur - 1.2 ? Math.max(0, (dur - d.t) / 1.2) : 1;
      this.stage.dim = d.a;
      this.dustBoost = 1 + 2.5 * d.a;
      d.cx = U.damp(d.cx, this.W / 2, 1.5, dt); d.cy = U.damp(d.cy, this.H / 2, 1.5, dt);
      const f = Math.min(this.W, this.H);
      for (const s of d.stars) {
        s.pz = s.z; s.z -= dt * s.sp * (0.6 + 1.4 * d.a);
        if (s.z < 0.05) { s.x = U.rand(-1, 1) * 1.5; s.y = U.rand(-1, 1) * 1.5; s.z = s.pz = U.rand(1.5, 3); }
      }
      this.audio.setLoop('domain', d.a); this.audio.duck(0.85 * d.a);
      fields.push({ x: d.cx, y: d.cy, strength: 900 * d.a, radius: f * 0.35, swirl: 3 });
      if (Math.random() < dt * 3 * d.a) {
        const a = Math.random() * TAU, r0 = f * 0.12, r1 = f * U.rand(0.5, 0.9);
        this.fx.bolt(d.cx + Math.cos(a) * r0, d.cy + Math.sin(a) * r0, d.cx + Math.cos(a) * r1, d.cy + Math.sin(a) * r1, { color: [0.6, 0.85, 1], width: 1.6, life: 0.15, branches: 2 });
      }
      if (d.t >= dur) { this.domain = null; this.cool.domain = 2; this.audio.play('domainEnd'); }
    }

    startDomain(c) {
      this.domainHold = 0;
      const stars = [];
      for (let i = 0; i < 700; i++) { const z = U.rand(0.1, 3); stars.push({ x: U.rand(-1, 1) * 1.5, y: U.rand(-1, 1) * 1.5, z, pz: z, sp: U.rand(0.5, 1.4), c: U.pick([[1, 1, 1], [0.6, 0.85, 1], [0.8, 0.65, 1], [0.5, 1, 0.95]]) }); }
      this.domain = { t: 0, a: 0, ox: c.x, oy: c.y, cx: c.x, cy: c.y, stars };
      this.cast('domain');
      this.audio.play('domain');
      this.stage.flash('#ffffff', 0.9, 2.2); this.stage.shake(30);
      const R = Math.hypot(this.W, this.H);
      this.fx.ring(c.x, c.y, { r0: 10, r1: R, life: 1.1, color: [0.6, 0.85, 1], width: 20 });
      this.fx.rays(c.x, c.y, { count: 160, len: R * 0.4, life: 1.2, color: [0.65, 0.85, 1], width: 2 });
      for (let i = 0; i < 2500; i++) { const a = Math.random() * TAU, sp = U.rand(200, 2600); this.pool.emit({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(0.8, 2), size: U.rand(2, 5), color: [0.8, 0.92, 1], color2: [0.45, 0.4, 1], drag: 1.5, flags: PF.HOT }); }
      this.ui.title('领域展开', '无量空处 · UNLIMITED VOID', 'domain');
    }

    // ---------------- 绘制 ----------------
    draw(ctx, dark) {
      const t = this.t, W = this.W, H = this.H;
      const d = this.domain;
      if (d) {
        const R = Math.hypot(W, H) * U.easeOutCubic(Math.min(1, d.t / 0.9));
        const g = dark.createRadialGradient(d.ox, d.oy, 0, d.ox, d.oy, Math.max(1, R));
        g.addColorStop(0, `rgba(6,4,28,${0.9 * d.a})`); g.addColorStop(0.7, `rgba(2,2,14,${0.94 * d.a})`); g.addColorStop(1, `rgba(0,0,6,${0.97 * d.a})`);
        dark.fillStyle = g; dark.beginPath(); dark.arc(d.ox, d.oy, Math.max(1, R), 0, TAU); dark.fill();
        if (d.t < 1) { ctx.lineWidth = 14; ctx.strokeStyle = U.rgba([0.7, 0.9, 1], 0.8 * (1 - d.t)); ctx.beginPath(); ctx.arc(d.ox, d.oy, Math.max(1, R), 0, TAU); ctx.stroke(); }
        const f = Math.min(W, H);
        ctx.lineCap = 'round';
        for (const s of d.stars) {
          const x1 = d.cx + (s.x / s.pz) * f * 0.5, y1 = d.cy + (s.y / s.pz) * f * 0.5;
          const x2 = d.cx + (s.x / s.z) * f * 0.5, y2 = d.cy + (s.y / s.z) * f * 0.5;
          const br = Math.min(1, (3 - s.z) / 2) * d.a;
          ctx.strokeStyle = U.rgba(s.c, br); ctx.lineWidth = Math.max(0.6, 2.4 / s.z);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 + (x2 - x1) * 2, y2 + (y2 - y1) * 2); ctx.stroke();
        }
        D.drawCircle(ctx, d.cx, d.cy, f * 0.42, t * 0.6, 0.55 * d.a, [0.55, 0.8, 1], [0.8, 0.6, 1]);
        D.drawCircle(ctx, d.cx, d.cy, f * 0.24, -t * 1.1, 0.7 * d.a, [0.8, 0.65, 1], [0.5, 1, 0.95]);
        D.glow(ctx, d.cx, d.cy, f * 0.16, [0.4, 0.6, 1], 0.7 * d.a, [1, 1, 1]);
        ctx.lineWidth = 3; ctx.strokeStyle = U.rgba([0.9, 0.95, 1], 0.9 * d.a);
        ctx.beginPath(); ctx.arc(d.cx, d.cy, f * 0.055 * (1 + 0.08 * Math.sin(t * 6)), 0, TAU); ctx.stroke();
      }
      if (this.domainHold > 0.02 && this.holdPts) {
        const k = Math.min(1, this.domainHold / this.cfg.spells.domainHold);
        const [a, b] = this.holdPts, m = U.mid(a, b);
        ctx.lineWidth = 2 + 6 * k; ctx.strokeStyle = U.rgba([0.6, 0.85, 1], 0.2 + 0.5 * k);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (Math.random() < 0.5) this.fx.bolt(a.x, a.y, b.x, b.y, { color: [0.6, 0.85, 1], width: 1.4 + 2 * k, life: 0.06, branches: 2 });
        const rr = Math.max(4, U.dist(a, b) * 0.5 * (1 - k));
        ctx.lineWidth = 3; ctx.strokeStyle = U.rgba([0.8, 0.9, 1], 0.8 * k);
        ctx.beginPath(); ctx.arc(m.x, m.y, rr, 0, TAU); ctx.stroke();
        D.glow(ctx, m.x, m.y, 60 + 120 * k, [0.5, 0.7, 1], 0.6 * k, [1, 1, 1]);
      }

      for (const h of this.hands) {
        const s = this.S(h), sz = h.size;
        if (s.circle > 0.02) D.drawCircle(ctx, h.palm.x, h.palm.y, sz * 1.9, t, s.circle, C.gold, C.cyan);
        if (s.flame > 0.02) D.glow(ctx, h.palm.x, h.palm.y - sz * 0.3, sz * 2.2, C.ghost2, 0.35 * s.flame, C.ghost);
        if (s.zap > 0.02) { D.glow(ctx, h.tips.index.x, h.tips.index.y, sz * 0.9, C.zap, 0.7 * s.zap, [1, 1, 1]); D.glow(ctx, h.tips.middle.x, h.tips.middle.y, sz * 0.9, C.zap, 0.7 * s.zap, [1, 1, 1]); }
        if (s.charge > 0.02) {
          const fl = 0.8 + 0.2 * Math.sin(t * 40);
          D.glow(ctx, h.palm.x, h.palm.y, sz * (0.7 + 1.6 * s.charge) * fl, C.gold, 0.3 + 0.5 * s.charge, [1, 1, 1]);
          ctx.lineWidth = 2; ctx.strokeStyle = U.rgba(C.gold, 0.8 * s.charge);
          ctx.beginPath(); ctx.arc(h.palm.x, h.palm.y, sz * (1.8 - s.charge), t * 8, t * 8 + TAU * s.charge); ctx.stroke();
        }
        if (s.red.k > 0.02) D.drawOrb(ctx, s.red.x, s.red.y, s.red.r, PAL.red, t, s.red.k);
        if (s.blue.k > 0.02) D.drawOrb(ctx, s.blue.x, s.blue.y, s.blue.r, PAL.blue, t, s.blue.k);
      }
      const p = this.purple;
      if (p && p.r) {
        D.drawOrb(ctx, p.x, p.y, p.r, PAL.purple, t * 1.5, Math.min(1, p.t * 3));
        ctx.lineWidth = 2; ctx.strokeStyle = U.rgba(PAL.purple.core, 0.6);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (2.6 - 1.2 * p.charge), 0, TAU * p.charge); ctx.stroke();
      }

      if (this.showSkeleton) {
        ctx.lineWidth = 1.5;
        for (const h of this.hands) {
          if (!h.present) continue;
          const col = TRAIL[h.gesture] || TRAIL.none;
          ctx.strokeStyle = U.rgba(col, 0.45);
          ctx.beginPath();
          for (const [i, j] of SG.HAND_LINKS) { ctx.moveTo(h.lm[i].x, h.lm[i].y); ctx.lineTo(h.lm[j].x, h.lm[j].y); }
          ctx.stroke();
          ctx.fillStyle = U.rgba(col, 0.8);
          for (const i of [4, 8, 12, 16, 20]) { ctx.beginPath(); ctx.arc(h.lm[i].x, h.lm[i].y, 3, 0, TAU); ctx.fill(); }
        }
      }
    }
  }

  SG.Spells = Spells;
})();
