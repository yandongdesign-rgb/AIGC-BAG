/** 掌心上抬 → 四散飞舞：大量彩色粒子向四周漂浮，弱重力、缓慢飘散、闪烁 */
import { Mode } from '../mode.js';
import { rand, randRange, pick, clamp, TAU } from '../../core/math.js';
import { KIND } from '../pool.js';

export class ScatterMode extends Mode {
  constructor(...a) { super(...a); this.chime = 0; }

  update(dt, h, w) {
    if (!h) return;
    const { pool, theme } = this.ctx, p = this.p;
    const lift = clamp(h.liftSpeed / 2);
    const n = this.count(p.rate * w * (0.6 + 0.8 * lift) * (h.frozen ? 0.15 : 1), dt);
    const s = h.handSize;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = randRange(p.speed);
      pool.emit({
        x: h.palm.x + rand(-1, 1) * s * 0.9, y: h.palm.y + rand(-0.4, 0.3) * s,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - randRange(p.upward) * (1 + lift),
        life: randRange(p.life), size: randRange(p.size), size1: rand(0.5, 2),
        color: pick(theme.scatter), color1: pick(theme.scatter), alpha: rand(0.45, 0.9) * w,
        drag: p.drag, grav: p.gravity, kind: Math.random() < 0.6 ? KIND.TURB : KIND.TWINKLE,
      });
    }
    this.ctx.audioParams.scatter = Math.max(this.ctx.audioParams.scatter || 0, w);
    this.chime -= dt;
    if (this.chime <= 0 && w > 0.2 && !h.frozen) {
      this.chime = rand(0.12, 0.42) / (0.6 + lift);
      this.ctx.sound('scatter', 'chime', { intensity: w * (0.6 + 0.4 * lift), x: h.palm.x / this.ctx.W });
    }
  }
}
