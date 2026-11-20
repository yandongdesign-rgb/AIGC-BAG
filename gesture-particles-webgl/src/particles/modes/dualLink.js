/** 双手 → 能量连接流：两掌之间粒子往返流动，中点能量球大小随距离变化 */
import { Mode } from '../mode.js';
import { rand, randRange, paletteAt } from '../../core/math.js';

export class DualLinkMode extends Mode {
  update(dt, _h, w) {
    const hands = this.ctx.presentHands;
    if (hands.length >= 2) this.last = [{ ...hands[0].palm }, { ...hands[1].palm }];
    if (!this.last) return;
    const [a, b] = this.last;
    const { pool, theme, time } = this.ctx, p = this.p;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const close = 1 - this.ctx.dualNorm; // 越近越亮
    const n = this.count(p.rate * w * (0.6 + close), dt);
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const bend = Math.sin(t * Math.PI) * Math.sin(time * 3 + t * 6) * d * 0.12;
      const dir = Math.random() < 0.5 ? 1 : -1, sp = rand(120, 320);
      pool.emit({
        x: a.x + dx * t + nx * bend, y: a.y + dy * t + ny * bend,
        vx: (dx / d) * sp * dir + rand(-20, 20), vy: (dy / d) * sp * dir + rand(-20, 20),
        life: randRange(p.life), size: rand(1.5, 3.5), size1: 0.5,
        color: paletteAt(theme.link, t), alpha: rand(0.5, 0.9) * w, drag: 1.2,
      });
    }
    pool.emit({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, life: 0.05, size: 18 + 60 * close, size1: 14, color: paletteAt(theme.link, 0.5), alpha: 0.3 * w, drag: 0 });
  }
}
