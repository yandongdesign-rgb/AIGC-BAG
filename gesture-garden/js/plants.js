/**
 * 植物定义：所有花卉 / 绿植均为程序化绘制（Canvas 2D），无图片资源。
 *
 * 每株植物通过两个归一化量驱动：
 *   growth  0~1  茎叶生长进度
 *   bloom   0~1  花朵绽放程度
 * 它们由花园的全局时间轴 T（生长）与 O（花瓣开合）换算而来，见 Plant.progress()。
 *
 * 类型：Daisy（波斯菊）· Tulip（郁金香）· Lavender（薰衣草穗）· Allium（大花葱）
 *      Fern（蕨，卷芽舒展）· Leafy（阔叶绿植）· Grass（草丛）
 */
(function () {
  const U = GG.util;
  const { TAU, clamp, lerp, easeOutCubic, easeInOutSine, smoothstep, mulberry32, mixHex, rgba, pick, range } = U;
  const PAL = GG.config.palette;

  // ------------------------------------------------------------------ 绘图小工具
  function leafPath(ctx, len, wid) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.42, -wid, len, 0);
    ctx.quadraticCurveTo(len * 0.42, wid, 0, 0);
  }

  function drawLeaf(ctx, x, y, angle, len, wid, fill, vein, veins = 0) {
    if (len < 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    leafPath(ctx, len, wid);
    ctx.fillStyle = fill;
    ctx.fill();
    if (vein && len > 8) {
      ctx.strokeStyle = vein;
      ctx.lineWidth = Math.max(0.6, len * 0.018);
      ctx.beginPath();
      ctx.moveTo(len * 0.04, 0);
      ctx.lineTo(len * 0.86, 0);
      for (let i = 1; i <= veins; i++) {
        const px = (len * 0.8 * i) / (veins + 1);
        const w = wid * 0.62 * Math.sin((Math.PI * px) / len);
        ctx.moveTo(px, 0);
        ctx.lineTo(px + len * 0.12, -w);
        ctx.moveTo(px, 0);
        ctx.lineTo(px + len * 0.12, w);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function petalPath(ctx, L, W) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(W, -L * 0.25, W * 0.92, -L * 0.85, 0, -L);
    ctx.bezierCurveTo(-W * 0.92, -L * 0.85, -W, -L * 0.25, 0, 0);
  }

  // ------------------------------------------------------------------ 基类
  class Plant {
    constructor(o) {
      Object.assign(this, o); // x, baseY, H, scale, depth, delay, span, seed, fogT
      this.rng = mulberry32(o.seed);
      const r = this.rng;
      this.phase = r() * TAU;
      this.lean = range(r, -0.14, 0.14);
      this.bend = range(r, -0.16, 0.16);
      this.growth = 0;
      this.bloom = 0;
      this.local = 0;
      this.hasFlower = true;
      this.head = { x: this.x, y: this.baseY, angle: -Math.PI / 2 };
      this.P0 = { x: 0, y: 0 };
      this.P1 = { x: 0, y: 0 };
      this.P2 = { x: 0, y: 0 };
      this.stemColor = this.fog(pick(r, PAL.stem));
      this.leaves = [];
      this.setup(r);
    }

    /** 根据景深与雾色混合，营造空气透视 */
    fog(hex) { return mixHex(hex, PAL.fog, this.fogT); }

    setup() {}

    /** 全局时间轴 → 本株的生长 / 绽放进度（带错峰延迟） */
    progress(T, O) {
      this.local = clamp((T - this.delay) / this.span);
      this.growth = easeOutCubic(clamp(this.local / 0.7));
      this.bloom = easeInOutSine(clamp((this.local - 0.5) / 0.5)) * O;
    }

    wind(time) {
      return Math.sin(time * 0.55 + this.x * 0.0035) * 0.65 + Math.sin(time * 1.7 + this.phase) * 0.35;
    }

    update(T, O, time) {
      this.progress(T, O);
      const H = this.H;
      const sway = this.wind(time) * H * 0.035 * (0.3 + 0.7 * this.growth);
      this.P0.x = this.x; this.P0.y = this.baseY;
      this.P1.x = this.x + this.bend * H + sway * 0.45; this.P1.y = this.baseY - H * 0.55;
      this.P2.x = this.x + this.lean * H + sway; this.P2.y = this.baseY - H;
      const g = Math.max(this.growth, 0.0001);
      const p = this.qpt(g);
      const d = this.qtan(g);
      this.head.x = p.x;
      this.head.y = p.y;
      this.head.angle = Math.atan2(d.y, d.x);
    }

    qpt(t) {
      const { P0, P1, P2 } = this;
      const mt = 1 - t;
      return {
        x: mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x,
        y: mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y,
      };
    }

    qtan(t) {
      const { P0, P1, P2 } = this;
      return {
        x: 2 * (1 - t) * (P1.x - P0.x) + 2 * t * (P2.x - P1.x),
        y: 2 * (1 - t) * (P1.y - P0.y) + 2 * t * (P2.y - P1.y),
      };
    }

    /** 渐细的茎：沿二次贝塞尔采样，左右偏移法线后填充 */
    drawStem(ctx, width) {
      const g = this.growth;
      if (g < 0.003) return;
      const n = 18;
      const left = [];
      const right = [];
      for (let i = 0; i <= n; i++) {
        const t = (g * i) / n;
        const p = this.qpt(t);
        const d = this.qtan(t);
        const l = Math.hypot(d.x, d.y) || 1;
        const nx = -d.y / l;
        const ny = d.x / l;
        const w = width * (1 - 0.55 * (i / n)) * 0.5;
        left.push(p.x + nx * w, p.y + ny * w);
        right.push(p.x - nx * w, p.y - ny * w);
      }
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
      for (let i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
      ctx.closePath();
      ctx.fillStyle = this.stemColor;
      ctx.fill();
    }

    /** 茎上的叶片：茎长过叶位后才长出 */
    drawStemLeaves(ctx, time) {
      for (const lf of this.leaves) {
        if (this.growth <= lf.f) continue;
        const k = easeOutCubic(clamp((this.growth - lf.f) / 0.25));
        const p = this.qpt(lf.f);
        const d = this.qtan(lf.f);
        const a = Math.atan2(d.y, d.x) + lf.side * (lf.spread + 0.08 * Math.sin(time * 1.3 + this.phase + lf.f * 6));
        drawLeaf(ctx, p.x, p.y, a, lf.len * k, lf.wid * k, lf.color, lf.vein, lf.veins || 0);
      }
    }

    addStemLeaves(r, count, from, to, lenR, widR) {
      for (let i = 0; i < count; i++) {
        const f = lerp(from, to, count === 1 ? 0.5 : i / (count - 1)) + range(r, -0.03, 0.03);
        const len = range(r, lenR[0], lenR[1]) * this.scale;
        const color = this.fog(pick(r, PAL.leaf));
        this.leaves.push({
          f,
          side: i % 2 === 0 ? 1 : -1,
          spread: range(r, 0.75, 1.15),
          len,
          wid: len * range(r, widR[0], widR[1]),
          color,
          vein: rgba(mixHex(color, '#ffffff', 0.35), 0.45),
        });
      }
    }

    /** 花粉粒子发射点 */
    emitPoint() { return this.head; }

    draw(ctx, time) {
      if (this.growth < 0.003) return;
      this.drawStem(ctx, this.stemWidth);
      this.drawStemLeaves(ctx, time);
      this.drawHead(ctx, time);
    }

    drawHead() {}

    /** 花萼：花苞阶段可见的绿色托片 */
    drawSepals(ctx, s, color) {
      for (let i = -1; i <= 1; i += 2) {
        ctx.save();
        ctx.rotate(i * 0.55);
        petalPath(ctx, s * 0.42, s * 0.12);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------ 波斯菊 / 雏菊
  class Daisy extends Plant {
    setup(r) {
      this.stemWidth = 4 * this.scale;
      this.n = Math.floor(range(r, 9, 14));
      this.headSize = range(r, 26, 40) * this.scale;
      const pal = PAL.petals[pick(r, ['rose', 'blush', 'cream', 'lavender', 'peach', 'mist'])];
      this.petal = this.fog(pal[0]);
      this.petalDeep = this.fog(pal[1]);
      this.center = this.fog(pick(r, PAL.center));
      this.centerDot = mixHex(this.center, '#5d4a2e', 0.25);
      this.sepal = this.fog(PAL.leaf[1]);
      // 预排序：外侧（盛开后朝下）的花瓣先画
      this.order = Array.from({ length: this.n }, (_, i) => i).sort(
        (a, b) => Math.abs((b / this.n) * TAU - Math.PI) - Math.abs((a / this.n) * TAU - Math.PI)
      );
      this.twist = r() * TAU;
      this.addStemLeaves(r, Math.floor(range(r, 2, 4)), 0.16, 0.55, [30, 48], [0.24, 0.34]);
    }

    drawHead(ctx, time) {
      const appear = smoothstep(0.42, 0.8, this.growth);
      if (appear <= 0) return;
      const b = this.bloom;
      const s = this.headSize * appear;
      const { x, y, angle } = this.head;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.scale(1, lerp(1, 0.84, b));
      this.drawSepals(ctx, s, this.sepal);

      const L = s * (0.62 + 0.38 * b);
      const W = s * 0.24 * (0.5 + 0.5 * b);
      const breathe = 1 + 0.025 * Math.sin(time * 1.2 + this.phase) * b;
      for (const i of this.order) {
        const theta = (i / this.n) * TAU;
        const a = (theta - Math.PI) * b + 0.12 * b * Math.sin(this.twist + i);
        ctx.save();
        ctx.rotate(a);
        petalPath(ctx, L * breathe, W);
        ctx.fillStyle = this.petal;
        ctx.fill();
        petalPath(ctx, L * 0.48, W * 0.6);
        ctx.fillStyle = rgba(this.petalDeep, 0.55);
        ctx.fill();
        ctx.restore();
      }

      if (b > 0.08) {
        const cr = s * (0.08 + 0.13 * b);
        ctx.globalAlpha = smoothstep(0.08, 0.4, b);
        ctx.beginPath();
        ctx.arc(0, 0, cr, 0, TAU);
        ctx.fillStyle = this.center;
        ctx.fill();
        ctx.fillStyle = this.centerDot;
        for (let k = 0; k < 7; k++) {
          const a = k * 2.399 + this.twist;
          const rr = cr * 0.55 * Math.sqrt((k + 0.5) / 7);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, cr * 0.13, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ 郁金香
  class Tulip extends Plant {
    setup(r) {
      this.stemWidth = 4.4 * this.scale;
      this.lean *= 0.5;
      this.headSize = range(r, 28, 38) * this.scale;
      const pal = PAL.petals[pick(r, ['rose', 'peach', 'cream', 'blush', 'mauve'])];
      this.petal = this.fog(pal[0]);
      this.petalBack = this.fog(pal[1]);
      this.highlight = rgba(mixHex(pal[0], '#ffffff', 0.5), 0.35);
      // 郁金香的长带状叶从基部长出
      for (let i = 0; i < 2; i++) {
        const len = range(r, 70, 105) * this.scale;
        const color = this.fog(pick(r, PAL.leaf));
        this.leaves.push({ f: 0.04 + i * 0.06, side: i ? -1 : 1, spread: range(r, 0.3, 0.55), len, wid: len * 0.15, color, vein: null });
      }
    }

    drawHead(ctx, time) {
      const appear = smoothstep(0.45, 0.85, this.growth);
      if (appear <= 0) return;
      const b = this.bloom;
      const s = this.headSize * appear;
      const { x, y, angle } = this.head;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      const open = lerp(0.05, 0.62, b) * (1 + 0.04 * Math.sin(time + this.phase));
      const L = s * (1.0 + 0.18 * b);
      const W = s * 0.44;
      const petals = [
        { dx: 0, rot: 0, c: this.petalBack },
        { dx: -s * 0.1, rot: -open * 1.15, c: this.petalBack },
        { dx: s * 0.1, rot: open * 1.15, c: this.petalBack },
        { dx: -s * 0.06, rot: -open * 0.5, c: this.petal },
        { dx: s * 0.06, rot: open * 0.5, c: this.petal },
      ];
      for (const p of petals) {
        ctx.save();
        ctx.translate(p.dx, 0);
        ctx.rotate(p.rot);
        petalPath(ctx, L, W);
        ctx.fillStyle = p.c;
        ctx.fill();
        petalPath(ctx, L * 0.7, W * 0.25);
        ctx.fillStyle = this.highlight;
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ 薰衣草 / 穗状花序
  class Lavender extends Plant {
    setup(r) {
      this.stemWidth = 3 * this.scale;
      this.H *= 1.08;
      this.K = Math.floor(range(r, 12, 18));
      this.floret = range(r, 8, 11) * this.scale;
      const pal = PAL.petals[pick(r, ['lavender', 'lavender', 'mauve', 'mist'])];
      this.petal = this.fog(pal[0]);
      this.petalDeep = this.fog(pal[1]);
      this.bud = this.fog('#9DAE8E');
      this.addStemLeaves(r, 4, 0.06, 0.4, [24, 38], [0.12, 0.18]);
    }

    emitPoint() { return this.qpt(Math.max(0.5, this.growth * 0.85)); }

    drawHead(ctx, time) {
      const g = this.growth;
      const b = this.bloom;
      for (let k = 0; k < this.K; k++) {
        const f = lerp(0.52, 0.995, k / (this.K - 1));
        if (g < f) break;
        const appear = smoothstep(f, f + 0.1, g);
        const bk = clamp(b * 1.6 - (k / this.K) * 0.6);
        const p = this.qpt(f);
        const d = this.qtan(f);
        const a = Math.atan2(d.y, d.x);
        const size = this.floret * (1 - 0.45 * (k / this.K)) * appear;
        const side = k % 2 ? 1 : -1;
        const off = size * 0.45 * (0.5 + 0.5 * bk);
        const px = p.x + Math.cos(a + side * Math.PI / 2) * off;
        const py = p.y + Math.sin(a + side * Math.PI / 2) * off;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + side * (0.35 + 0.35 * bk));
        ctx.beginPath();
        ctx.ellipse(0, 0, size * (0.55 + 0.45 * bk), size * (0.38 + 0.22 * bk), 0, 0, TAU);
        ctx.fillStyle = bk < 0.5 ? U.mix(this.bud, this.petalDeep, bk * 2) : U.mix(this.petalDeep, this.petal, (bk - 0.5) * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------ 大花葱（球状花序）
  class Allium extends Plant {
    setup(r) {
      this.stemWidth = 3.2 * this.scale;
      this.lean *= 0.6;
      this.H *= 1.1;
      this.R = range(r, 30, 44) * this.scale;
      const pal = PAL.petals[pick(r, ['mauve', 'lavender', 'blush'])];
      this.petal = this.fog(pal[0]);
      this.petalDeep = this.fog(pal[1]);
      this.light = mixHex(this.petal, '#ffffff', 0.35);
      this.bud = this.fog('#A9B79A');
      this.florets = [];
      for (let i = 0; i < 46; i++) {
        const a = i * 2.39996 + r();
        const rr = Math.sqrt((i + 0.5) / 46);
        this.florets.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, z: r() });
      }
      this.florets.sort((p, q) => p.z - q.z);
      for (let i = 0; i < 2; i++) {
        const len = range(r, 60, 88) * this.scale;
        this.leaves.push({ f: 0.03 + i * 0.05, side: i ? -1 : 1, spread: range(r, 0.45, 0.7), len, wid: len * 0.1, color: this.fog(pick(r, PAL.leaf)), vein: null });
      }
    }

    drawHead(ctx, time) {
      const appear = smoothstep(0.5, 0.88, this.growth);
      if (appear <= 0) return;
      const b = this.bloom;
      const { x, y, angle } = this.head;
      const R = this.R * appear * (0.38 + 0.62 * b);
      const cx = x + Math.cos(angle) * R * 0.8;
      const cy = y + Math.sin(angle) * R * 0.8;
      // 纸质花苞
      if (b < 0.4) {
        ctx.save();
        ctx.globalAlpha = 1 - b / 0.4;
        ctx.translate(x, y);
        ctx.rotate(angle + Math.PI / 2);
        petalPath(ctx, this.R * appear * 0.95, this.R * appear * 0.42);
        ctx.fillStyle = U.mix(this.bud, this.petalDeep, b * 1.5);
        ctx.fill();
        ctx.restore();
      }
      if (b <= 0.05) return;
      ctx.globalAlpha = smoothstep(0.05, 0.4, b);
      const fs = this.R * 0.13 * (0.35 + 0.65 * b);
      const pulse = 1 + 0.03 * Math.sin(time * 1.1 + this.phase);
      for (const f of this.florets) {
        const px = cx + f.x * R * pulse;
        const py = cy + f.y * R * 0.94 * pulse;
        ctx.beginPath();
        ctx.arc(px, py, fs, 0, TAU);
        ctx.fillStyle = f.z > 0.6 ? this.light : f.z > 0.25 ? this.petal : this.petalDeep;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ 蕨：卷芽舒展
  class Fern extends Plant {
    setup(r) {
      this.hasFlower = false;
      const n = Math.floor(range(r, 4, 7));
      this.fronds = [];
      for (let i = 0; i < n; i++) {
        const off = lerp(-0.95, 0.95, n === 1 ? 0.5 : i / (n - 1)) + range(r, -0.12, 0.12);
        this.fronds.push({
          base: -Math.PI / 2 + off,
          dir: off >= 0 ? 1 : -1,
          len: this.H * range(r, 0.4, 0.62) * (1 - 0.25 * Math.abs(off)),
          delay: Math.abs(off) * 0.12 + r() * 0.08,
          color: this.fog(pick(r, PAL.leaf)),
        });
      }
      this.fronds.sort((a, b) => a.delay - b.delay).reverse(); // 外侧叶先画（在后面）
      this.spine = this.fog(PAL.stem[2]);
      this._O = 1;
    }

    progress(T, O) {
      super.progress(T, O);
      this._O = O;
    }

    update(T, O, time) {
      this.progress(T, O);
      this.sway = this.wind(time);
    }

    emitPoint() { return { x: this.x, y: this.baseY - this.H * 0.5 * this.growth }; }

    draw(ctx) {
      if (this.growth < 0.003) return;
      const M = 16;
      const leafletBase = 20 * this.scale;
      for (const fr of this.fronds) {
        const g = clamp(this.growth * 1.2 - fr.delay) * (0.72 + 0.28 * this._O);
        if (g <= 0.01) continue;
        const seg = (fr.len / M) * (0.25 + 0.75 * g);
        let a = fr.base + this.sway * 0.06;
        let px = this.x;
        let py = this.baseY;
        const curl = 1.5 * Math.pow(1 - g, 1.3);
        const pts = [[px, py, a]];
        for (let k = 0; k < M; k++) {
          a += fr.dir * (0.03 + curl * Math.pow(k / M, 2)) + this.sway * 0.004;
          px += Math.cos(a) * seg;
          py += Math.sin(a) * seg;
          pts.push([px, py, a]);
        }
        // 主轴
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.strokeStyle = this.spine;
        ctx.lineWidth = 2.2 * this.scale;
        ctx.lineCap = 'round';
        ctx.stroke();
        // 小羽片
        const lg = smoothstep(0.15, 0.95, g);
        if (lg <= 0) continue;
        for (let k = 1; k < M - 1; k++) {
          const size = leafletBase * Math.pow(1 - k / M, 0.75) * lg;
          const [x, y, ang] = pts[k];
          drawLeaf(ctx, x, y, ang - 1.05, size, size * 0.34, fr.color, null);
          drawLeaf(ctx, x, y, ang + 1.05, size, size * 0.34, fr.color, null);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 阔叶绿植
  class Leafy extends Plant {
    setup(r) {
      this.hasFlower = false;
      const n = Math.floor(range(r, 4, 7));
      this.blades = [];
      for (let i = 0; i < n; i++) {
        const off = lerp(-1.05, 1.05, i / (n - 1)) + range(r, -0.1, 0.1);
        const len = range(r, 55, 90) * this.scale;
        const color = this.fog(pick(r, PAL.leaf));
        this.blades.push({
          off,
          petiole: this.H * range(r, 0.3, 0.55) * (1 - 0.3 * Math.abs(off)),
          len,
          wid: len * range(r, 0.36, 0.46),
          delay: (1 - Math.abs(off)) * 0.1 + r() * 0.1,
          color,
          vein: rgba(mixHex(color, '#ffffff', 0.4), 0.5),
        });
      }
      this.blades.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
    }

    update(T, O, time) {
      this.progress(T, O);
      this.sway = this.wind(time);
    }

    emitPoint() { return { x: this.x, y: this.baseY - this.H * 0.4 * this.growth }; }

    draw(ctx, time) {
      if (this.growth < 0.003) return;
      for (const bl of this.blades) {
        const g = clamp(this.growth * 1.25 - bl.delay);
        if (g <= 0.01) continue;
        const a = -Math.PI / 2 + bl.off * (0.75 + 0.25 * g) + this.sway * 0.05;
        const len = bl.petiole * g;
        const ex = this.x + Math.cos(a) * len;
        const ey = this.baseY + Math.sin(a) * len;
        const cx = this.x + Math.cos(a - bl.off * 0.25) * len * 0.5;
        const cy = this.baseY + Math.sin(a - bl.off * 0.25) * len * 0.5;
        ctx.beginPath();
        ctx.moveTo(this.x, this.baseY);
        ctx.quadraticCurveTo(cx, cy, ex, ey);
        ctx.strokeStyle = this.stemColor;
        ctx.lineWidth = 2.8 * this.scale;
        ctx.lineCap = 'round';
        ctx.stroke();
        const unfurl = easeOutCubic(clamp((g - 0.25) / 0.75));
        const leafA = a + bl.off * 0.3 + Math.sin(time * 1.1 + this.phase + bl.off) * 0.05;
        drawLeaf(ctx, ex, ey, leafA, bl.len * (0.3 + 0.7 * g), bl.wid * (0.12 + 0.88 * unfurl), bl.color, bl.vein, 3);
      }
    }
  }

  // ------------------------------------------------------------------ 草丛
  class Grass extends Plant {
    setup(r) {
      this.hasFlower = false;
      const n = Math.floor(range(r, 5, 10));
      this.blades = [];
      for (let i = 0; i < n; i++) {
        this.blades.push({
          dx: range(r, -14, 14) * this.scale,
          h: this.H * range(r, 0.45, 1),
          lean: range(r, -0.35, 0.35),
          w: range(r, 2.2, 3.6) * this.scale,
          color: this.fog(pick(r, PAL.leaf.concat(PAL.stem))),
          ph: r() * TAU,
        });
      }
    }

    update(T, O, time) {
      this.progress(T, O);
      this.time = time;
    }

    draw(ctx) {
      const g = this.growth;
      if (g < 0.003) return;
      const t = this.time;
      for (const bl of this.blades) {
        const h = bl.h * g;
        const bx = this.x + bl.dx;
        const by = this.baseY;
        const sway = (Math.sin(t * 0.9 + bx * 0.01) * 0.6 + Math.sin(t * 2.1 + bl.ph) * 0.4) * h * 0.12;
        const tx = bx + bl.lean * h + sway;
        const ty = by - h;
        const cx = bx + bl.lean * h * 0.25 + sway * 0.3;
        const cy = by - h * 0.6;
        ctx.beginPath();
        ctx.moveTo(bx - bl.w, by);
        ctx.quadraticCurveTo(cx - bl.w * 0.4, cy, tx, ty);
        ctx.quadraticCurveTo(cx + bl.w * 0.4, cy, bx + bl.w, by);
        ctx.closePath();
        ctx.fillStyle = bl.color;
        ctx.fill();
      }
    }
  }

  GG.plants = { Plant, Daisy, Tulip, Lavender, Allium, Fern, Leafy, Grass, drawLeaf, petalPath };
})();
