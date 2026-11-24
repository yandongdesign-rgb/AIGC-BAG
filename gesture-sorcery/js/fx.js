// Canvas 2D 特效：冲击波、闪电、光束、光晕、法球、法阵，以及屏幕震动/闪光
(function () {
  const SG = window.SG;
  const U = SG.U;
  const TAU = Math.PI * 2;

  function strokePath(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // 生成一条带分叉的闪电
  function makeBolt(x1, y1, x2, y2, opt) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const depth = len > 500 ? 7 : len > 200 ? 6 : 5;
    const main = U.boltPath(x1, y1, x2, y2, len * (opt.jitter || 0.22), depth);
    const branches = [];
    const nb = opt.branches !== undefined ? opt.branches : 3;
    for (let b = 0; b < nb; b++) {
      const i = 2 + ((Math.random() * (main.length - 4)) | 0);
      const p = main[i], q = main[Math.min(main.length - 1, i + 2)];
      const ang = Math.atan2(q.y - p.y, q.x - p.x) + U.rand(-0.9, 0.9);
      const bl = len * U.rand(0.15, 0.4);
      branches.push(U.boltPath(p.x, p.y, p.x + Math.cos(ang) * bl, p.y + Math.sin(ang) * bl, bl * 0.3, depth - 2));
    }
    return { main, branches };
  }

  function drawBolt(ctx, bolt, color, width, alpha, dark) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const all = [bolt.main, ...bolt.branches];
    if (dark) {
      ctx.strokeStyle = `rgba(0,0,0,${0.92 * alpha})`;
      all.forEach((p, i) => { ctx.lineWidth = (i ? 0.5 : 1) * width * 2.2; strokePath(ctx, p); });
      return;
    }
    const passes = [[7, 0.07], [3.2, 0.22], [1.4, 0.7]];
    for (const [w, a] of passes) {
      ctx.strokeStyle = U.rgba(color, a * alpha);
      all.forEach((p, i) => { ctx.lineWidth = w * width * (i ? 0.55 : 1); strokePath(ctx, p); });
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * alpha})`;
    all.forEach((p, i) => { ctx.lineWidth = width * (i ? 0.4 : 0.7); strokePath(ctx, p); });
  }

  function glow(ctx, x, y, r, color, a, core) {
    if (r <= 0 || a <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, U.rgba(core || color, a));
    g.addColorStop(0.25, U.rgba(color, a * 0.6));
    g.addColorStop(0.6, U.rgba(color, a * 0.18));
    g.addColorStop(1, U.rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // 程序化符文（每个符文由几段笔画组成）
  const GLYPHS = [];
  for (let i = 0; i < 48; i++) {
    const strokes = [], n = 2 + ((Math.random() * 3) | 0);
    for (let s = 0; s < n; s++) {
      const pts = [], m = 2 + ((Math.random() * 2) | 0);
      for (let k = 0; k < m; k++) pts.push([U.rand(-0.5, 0.5), U.rand(-0.5, 0.5)]);
      strokes.push(pts);
    }
    if (Math.random() < 0.4) strokes.push('o');
    GLYPHS.push(strokes);
  }
  function drawGlyph(ctx, gi, x, y, s, rot) {
    const gl = GLYPHS[gi % GLYPHS.length];
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.beginPath();
    for (const st of gl) {
      if (st === 'o') { ctx.moveTo(0.18, 0); ctx.arc(0, 0, 0.18, 0, TAU); continue; }
      ctx.moveTo(st[0][0], st[0][1]);
      for (let k = 1; k < st.length; k++) ctx.lineTo(st[k][0], st[k][1]);
    }
    ctx.restore();
    ctx.stroke();
  }

  class FX {
    constructor() { this.items = []; }
    add(e) { this.items.push(e); return e; }
    ring(x, y, o) { return this.add(Object.assign({ type: 'ring', x, y, t: 0, life: 0.6, r0: 10, r1: 300, width: 6, color: [1, 1, 1] }, o)); }
    bolt(x1, y1, x2, y2, o) { o = o || {}; return this.add(Object.assign({ type: 'bolt', t: 0, life: 0.12, width: 2, color: [0.6, 0.8, 1], b: makeBolt(x1, y1, x2, y2, o) }, o)); }
    rays(x, y, o) {
      o = Object.assign({ count: 60, len: 600, life: 0.9, color: [1, 1, 1], width: 2, speed: 1 }, o);
      const rays = [];
      for (let i = 0; i < o.count; i++) rays.push({ a: Math.random() * TAU, l: U.rand(0.3, 1) * o.len, s: U.rand(0.6, 1.4), w: U.rand(0.4, 1.4) });
      return this.add(Object.assign({ type: 'rays', x, y, t: 0, list: rays }, o));
    }
    glow(x, y, o) { return this.add(Object.assign({ type: 'glow', x, y, t: 0, life: 0.5, r: 200, color: [1, 1, 1], a: 0.8 }, o)); }
    blast(x, y, o) { return this.add(Object.assign({ type: 'blast', x, y, t: 0, life: 1.3, r: 1500, color: [0.75, 0.3, 1] }, o)); }

    update(dt) {
      for (const e of this.items) e.t += dt;
      this.items = this.items.filter((e) => e.t < e.life);
    }

    draw(ctx, dark) {
      for (const e of this.items) {
        const p = e.t / e.life, inv = 1 - p;
        if (e.type === 'ring') {
          const r = U.lerp(e.r0, e.r1, U.easeOutCubic(p));
          ctx.lineWidth = e.width * 4 * inv + 1; ctx.strokeStyle = U.rgba(e.color, 0.18 * inv);
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.stroke();
          ctx.lineWidth = e.width * inv + 0.5; ctx.strokeStyle = U.rgba(U.mixRGB(e.color, [1, 1, 1], 0.5), 0.85 * inv);
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.stroke();
          if (e.dark) { dark.lineWidth = e.width * 1.6 * inv; dark.strokeStyle = `rgba(0,0,0,${0.7 * inv})`; dark.beginPath(); dark.arc(e.x, e.y, r * 0.96, 0, TAU); dark.stroke(); }
        } else if (e.type === 'bolt') {
          const a = (inv > 0.5 ? 1 : inv * 2) * (Math.random() < 0.15 ? 0.4 : 1);
          if (e.dark) drawBolt(dark, e.b, e.color, e.width, a, true);
          drawBolt(ctx, e.b, e.color, e.width, a * (e.dark ? 0.8 : 1), false);
        } else if (e.type === 'rays') {
          ctx.lineCap = 'round';
          for (const r of e.list) {
            const d0 = (e.inner || 20) + e.len * 1.6 * e.speed * r.s * U.easeOutCubic(p);
            const d1 = d0 + r.l * inv;
            const cx = Math.cos(r.a), cy = Math.sin(r.a);
            const g = ctx.createLinearGradient(e.x + cx * d0, e.y + cy * d0, e.x + cx * d1, e.y + cy * d1);
            g.addColorStop(0, U.rgba(e.color, 0)); g.addColorStop(0.6, U.rgba(e.color, 0.7 * inv)); g.addColorStop(1, `rgba(255,255,255,${0.9 * inv})`);
            ctx.strokeStyle = g; ctx.lineWidth = e.width * r.w;
            ctx.beginPath(); ctx.moveTo(e.x + cx * d0, e.y + cy * d0); ctx.lineTo(e.x + cx * d1, e.y + cy * d1); ctx.stroke();
          }
        } else if (e.type === 'glow') {
          glow(ctx, e.x, e.y, e.r * (0.6 + 0.4 * U.easeOutCubic(p)), e.color, e.a * inv, [1, 1, 1]);
        } else if (e.type === 'blast') {
          const r = e.r * U.easeOutExpo(Math.min(1, p * 1.4));
          const a = p < 0.15 ? 1 : Math.max(0, 1 - (p - 0.15) / 0.85);
          glow(ctx, e.x, e.y, Math.max(1, r), e.color, 0.85 * a, [1, 0.95, 1]);
          ctx.lineWidth = 30 * a + 2; ctx.strokeStyle = U.rgba([1, 0.85, 1], 0.6 * a);
          ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(1, r * 0.7), 0, TAU); ctx.stroke();
          ctx.lineWidth = 90 * a; ctx.strokeStyle = U.rgba(e.color, 0.25 * a);
          ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(1, r * 0.72), 0, TAU); ctx.stroke();
        }
      }
    }
  }

  // 法球：赫/苍/茈
  function drawOrb(ctx, x, y, r, pal, t, k) {
    if (k <= 0.01) return;
    const R = r * (0.92 + 0.08 * Math.sin(t * 17)) * k;
    glow(ctx, x, y, R * 5.5, pal.glow, 0.33 * k);
    glow(ctx, x, y, R * 2.2, pal.main, 0.75 * k, pal.core);
    // 变形光弧
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const rr = R * (1.05 + i * 0.16), sp = (i % 2 ? -1 : 1) * (2.2 + i * 0.9) * (pal.spin || 1);
      const a0 = t * sp + i * 1.7, span = 1.1 + 0.7 * Math.sin(t * 3 + i);
      ctx.strokeStyle = U.rgba(i % 2 ? pal.main : pal.core, 0.75 * k);
      ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath(); ctx.arc(x, y, rr, a0, a0 + span); ctx.stroke();
    }
    // 内核
    const g = ctx.createRadialGradient(x - R * 0.2, y - R * 0.2, 0, x, y, R);
    g.addColorStop(0, `rgba(255,255,255,${k})`);
    g.addColorStop(0.45, U.rgba(pal.core, 0.95 * k));
    g.addColorStop(0.85, U.rgba(pal.main, 0.8 * k));
    g.addColorStop(1, U.rgba(pal.main, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    // 横向镜头光斑
    const fl = ctx.createLinearGradient(x - R * 9, y, x + R * 9, y);
    fl.addColorStop(0, U.rgba(pal.glow, 0)); fl.addColorStop(0.5, U.rgba(pal.core, 0.55 * k)); fl.addColorStop(1, U.rgba(pal.glow, 0));
    ctx.fillStyle = fl; ctx.fillRect(x - R * 9, y - R * 0.05 - 1, R * 18, R * 0.1 + 2);
  }

  // 法阵
  function drawCircle(ctx, x, y, R, t, k, col, col2) {
    if (k <= 0.01) return;
    const a = k;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    glow(ctx, x, y, R * 1.5, col, 0.18 * a);
    const ringS = (r, w, al, c) => { ctx.lineWidth = w; ctx.strokeStyle = U.rgba(c || col, al * a); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); };
    const Rk = R * (0.7 + 0.3 * U.easeOutCubic(Math.min(1, k * 1.2)));
    ringS(Rk, 5, 0.14); ringS(Rk, 1.8, 0.95); ringS(Rk * 0.92, 1.2, 0.7); ringS(Rk * 0.62, 1.4, 0.8, col2); ringS(Rk * 0.3, 1.2, 0.8);
    // 符文带
    ctx.lineWidth = 1.4; ctx.strokeStyle = U.rgba(col, 0.95 * a);
    const n = 24, rot = t * 0.35;
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * TAU;
      drawGlyph(ctx, i * 7 + 3, x + Math.cos(ang) * Rk * 0.78, y + Math.sin(ang) * Rk * 0.78, Rk * 0.11, ang + Math.PI / 2);
    }
    // 六芒星
    ctx.lineWidth = 1.6; ctx.strokeStyle = U.rgba(col2, 0.9 * a);
    for (let s = 0; s < 2; s++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const ang = -t * 0.5 + s * Math.PI / 3 + (i / 3) * TAU;
        const px = x + Math.cos(ang) * Rk * 0.62, py = y + Math.sin(ang) * Rk * 0.62;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    // 刻度
    ctx.lineWidth = 1; ctx.strokeStyle = U.rgba(col, 0.6 * a);
    ctx.beginPath();
    for (let i = 0; i < 72; i++) {
      const ang = -t * 0.2 + (i / 72) * TAU, l = i % 6 === 0 ? 0.09 : 0.04;
      ctx.moveTo(x + Math.cos(ang) * Rk * 0.92, y + Math.sin(ang) * Rk * 0.92);
      ctx.lineTo(x + Math.cos(ang) * Rk * (0.92 - l), y + Math.sin(ang) * Rk * (0.92 - l));
    }
    ctx.stroke();
    // 轨道节点
    for (let i = 0; i < 6; i++) {
      const ang = t * 1.2 + (i / 6) * TAU;
      glow(ctx, x + Math.cos(ang) * Rk * 1.08, y + Math.sin(ang) * Rk * 1.08, Rk * 0.09, col2, 0.9 * a, [1, 1, 1]);
    }
    ctx.restore();
  }

  // 舞台：震动、闪光、反相、摄像头滤镜
  class Stage {
    constructor(el, flashEl, invertEl, video) {
      this.el = el; this.flashEl = flashEl; this.invertEl = invertEl; this.video = video;
      this.shakeAmt = 0; this.flashA = 0; this.flashDecay = 3; this.invertT = 0; this.pulse = 0; this.pulseHue = 0; this.dim = 0; this.camVisible = true;
    }
    shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
    flash(color, a, decay) { this.flashEl.style.background = color; this.flashA = Math.max(this.flashA, a); this.flashDecay = decay || 3; }
    invert(sec) { this.invertT = Math.max(this.invertT, sec); }
    videoPulse(a, hue) { this.pulse = Math.max(this.pulse, a); this.pulseHue = hue || 0; }
    update(dt) {
      this.shakeAmt *= Math.exp(-dt * 6);
      const s = this.shakeAmt;
      this.el.style.transform = s > 0.3 ? `translate(${U.rand(-s, s).toFixed(1)}px,${U.rand(-s, s).toFixed(1)}px) rotate(${U.rand(-s, s) * 0.02}deg)` : '';
      this.flashA *= Math.exp(-dt * this.flashDecay);
      this.flashEl.style.opacity = this.flashA > 0.01 ? this.flashA.toFixed(3) : 0;
      this.invertT -= dt;
      this.invertEl.style.opacity = this.invertT > 0 ? 1 : 0;
      this.pulse *= Math.exp(-dt * 3);
      const b = 0.72 * (1 - 0.75 * this.dim) + this.pulse * 1.2;
      this.video.style.filter = `brightness(${b.toFixed(3)}) contrast(${(1.1 + this.pulse * 0.5).toFixed(2)}) saturate(${(0.85 - 0.5 * this.dim + this.pulse).toFixed(2)})${this.pulse > 0.05 ? ` hue-rotate(${(this.pulseHue * this.pulse).toFixed(0)}deg)` : ''}`;
      this.video.style.opacity = this.camVisible ? 1 : 0;
    }
  }

  SG.FX = FX; SG.Stage = Stage;
  SG.Draw = { glow, drawOrb, drawCircle, drawBolt, makeBolt, drawGlyph };
})();
