/** 手掌张开 → 拖尾：五个指尖牵引彩色光带（沿运动路径插值发射，保证连续） */
import { Mode } from '../mode.js';
import { rand, randRange, clamp, paletteAt } from '../../core/math.js';

export class TrailMode extends Mode {
  onEnter(h) { this.prev = h.tips.map((t) => ({ x: t.x, y: t.y })); }

  update(dt, h, w) {
    if (!h) return;
    const { pool, theme, time, quality } = this.ctx, p = this.p;
    if (!this.prev) this.onEnter(h);
    const speedN = clamp(h.speed / (h.handSize * 6));
    this.ctx.audioParams.trailSpeed = Math.max(this.ctx.audioParams.trailSpeed || 0, speedN * w);
    for (const f of p.fingers) {
      const a = this.prev[f], b = h.tips[f];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > h.handSize * 4) { a.x = b.x; a.y = b.y; continue; } // 跳变：不连线
      const n = Math.min(90, Math.floor((p.basePerFrame + d / p.spacing) * w * quality.emission + Math.random()));
      const hue = (f * 0.21 + time * 0.07) % 1;
      const c0 = paletteAt(theme.trail, hue), c1 = paletteAt(theme.trail, (hue + 0.35) % 1);
      const fvx = dt > 0 ? dx / dt : 0, fvy = dt > 0 ? dy / dt : 0;
      for (let i = 0; i < n; i++) {
        const t = (i + Math.random()) / Math.max(1, n);
        pool.emit({
          x: a.x + dx * t + rand(-1.5, 1.5), y: a.y + dy * t + rand(-1.5, 1.5),
          vx: fvx * 0.06 + rand(-18, 18), vy: fvy * 0.06 + rand(-18, 18),
          life: randRange(p.life) * (0.7 + 0.5 * w), size: randRange(p.size) * (0.75 + 0.6 * speedN) * w, size1: 0.4,
          color: c0, color1: c1, alpha: p.alpha * w, drag: p.drag,
        });
      }
      // 指尖辉光头
      if (!h.frozen) pool.emit({ x: b.x, y: b.y, life: 0.06, size: p.headGlow * w * (0.8 + speedN * 0.5), size1: p.headGlow * 0.6, color: c0, alpha: 0.32 * w, drag: 0 });
      a.x = b.x; a.y = b.y;
    }
  }
}
