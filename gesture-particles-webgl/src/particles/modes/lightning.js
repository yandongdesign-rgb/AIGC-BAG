/** 食指指向 → 闪电：指尖到目标点的锯齿电弧（中点位移法）+ 随机分叉；
 *  若另一只手在场且未指向，电弧连接到另一只手的掌心。 */
import { Mode } from '../mode.js';
import { rand, randRange, clamp } from '../../core/math.js';
import { KIND } from '../pool.js';

function displace(a, b, depth, rough) {
  let pts = [a, b];
  let len = Math.hypot(b.x - a.x, b.y - a.y) * rough;
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * len;
      next.push({ x: (p.x + q.x) / 2 - (dy / l) * off, y: (p.y + q.y) / 2 + (dx / l) * off }, q);
    }
    pts = next; len *= 0.52;
  }
  return pts;
}

export class LightningMode extends Mode {
  constructor(...a) { super(...a); this.timer = 0; }

  onEnter() { this.timer = 0; }

  aimPoint(h, w) {
    const { W, H } = this.ctx;
    const other = this.ctx.otherHand(h.slot);
    if (other && other.gesture !== 'POINT') return { x: other.palm.x, y: other.palm.y, linked: true };
    const reach = this.p.reach * Math.min(W, H) * (0.3 + 0.7 * w);
    return {
      x: clamp(h.indexTip.x + h.indexDir.x * reach, 0, W),
      y: clamp(h.indexTip.y + h.indexDir.y * reach, 0, H),
    };
  }

  update(dt, h, w) {
    if (!h) return;
    const { pool, theme } = this.ctx;
    const tip = h.indexTip;
    // 指尖电火花
    const n = this.count(140 * w, dt);
    for (let i = 0; i < n; i++) {
      pool.emit({ x: tip.x, y: tip.y, vx: rand(-260, 260), vy: rand(-260, 260), life: rand(0.05, 0.16), size: rand(1.2, 2.6), color: theme.lightning[0], color1: theme.lightning[1], alpha: w, drag: 6, kind: KIND.FLICKER });
    }
    if (!h.frozen) pool.emit({ x: tip.x, y: tip.y, life: 0.05, size: 26 * w, size1: 18, color: theme.lightning[1], alpha: 0.45 * w, drag: 0 });

    this.timer -= dt;
    if (this.timer <= 0 && w > 0.05) {
      this.timer = randRange(this.p.interval) / (0.4 + 0.6 * w);
      const tg = this.aimPoint(h, w);
      this.bolt(tip, tg, w);
      this.ctx.sound('lightning', 'zap', { intensity: w, x: tg.x / this.ctx.W, linked: !!tg.linked });
    }
    this.ctx.audioParams.lightning = Math.max(this.ctx.audioParams.lightning || 0, w);
  }

  bolt(a, b, w) {
    const p = this.p;
    const main = displace(a, b, p.depth, p.roughness);
    this.draw(main, 0, w);
    // 分叉
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const branches = Math.random() < p.branchChance ? 1 + ((Math.random() * 3) | 0) : 0;
    for (let k = 0; k < branches; k++) {
      const j = Math.floor(rand(0.15, 0.8) * (main.length - 1));
      const s = main[j], e = main[j + 1];
      let ang = Math.atan2(e.y - s.y, e.x - s.x) + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 1.0);
      const bl = L * rand(0.18, 0.42);
      const end = { x: s.x + Math.cos(ang) * bl, y: s.y + Math.sin(ang) * bl };
      const sub = displace(s, end, p.depth - 2, p.roughness * 1.2);
      this.draw(sub, 1, w);
      if (Math.random() < 0.4) {
        const m = sub[(sub.length * 0.5) | 0];
        ang += rand(-0.9, 0.9);
        const e2 = { x: m.x + Math.cos(ang) * bl * 0.5, y: m.y + Math.sin(ang) * bl * 0.5 };
        this.draw(displace(m, e2, p.depth - 3, p.roughness * 1.3), 2, w);
      }
    }
    // 落点冲击光
    const { pool, theme } = this.ctx;
    pool.emit({ x: b.x, y: b.y, life: 0.12, size: 40 * w, size1: 10, color: theme.lightning[0], color1: theme.lightning[1], alpha: 0.6 * w, drag: 0 });
    for (let i = 0; i < 10 * w; i++) pool.emit({ x: b.x, y: b.y, vx: rand(-400, 400), vy: rand(-400, 200), life: rand(0.15, 0.4), size: 2, size1: 0.3, color: theme.lightning[0], color1: theme.lightning[1], alpha: w, drag: 3, grav: 600 });
  }

  draw(pts, lvl, w) {
    const { pool, theme } = this.ctx, p = this.p;
    const sizeK = [1, 0.6, 0.4][lvl], aK = [1, 0.65, 0.45][lvl];
    const core = theme.lightning[0], glow = theme.lightning[1];
    let gi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], e = pts[i + 1];
      const L = Math.hypot(e.x - s.x, e.y - s.y);
      const n = Math.max(1, Math.ceil(L / p.coreSpacing));
      for (let k = 0; k < n; k++) {
        const t = k / n, x = s.x + (e.x - s.x) * t, y = s.y + (e.y - s.y) * t;
        pool.emit({ x, y, life: rand(0.06, 0.12), size: p.coreSize * sizeK, size1: p.coreSize * sizeK * 0.6, color: core, alpha: aK * w, drag: 0, kind: KIND.FLICKER });
        if (gi++ % 4 === 0) pool.emit({ x, y, life: rand(0.08, 0.14), size: p.glowSize * sizeK, size1: p.glowSize * sizeK * 0.5, color: glow, alpha: 0.16 * aK * w, drag: 0 });
      }
    }
  }
}
