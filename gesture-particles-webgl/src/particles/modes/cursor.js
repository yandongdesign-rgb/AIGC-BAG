/** 未识别手势：掌心一点柔光 + 少量星点，提示“手已被跟踪” */
import { Mode } from '../mode.js';
import { rand } from '../../core/math.js';

export class CursorMode extends Mode {
  update(dt, h, w) {
    if (!h || h.frozen) return;
    const { pool, theme } = this.ctx;
    pool.emit({ x: h.palm.x, y: h.palm.y, life: 0.05, size: 30 * w, size1: 24, color: theme.ambient[0], alpha: 0.35 * w, drag: 0 });
    const n = this.count(this.p.rate * w, dt);
    for (let i = 0; i < n; i++) {
      const t = h.tips[(Math.random() * 5) | 0];
      pool.emit({ x: t.x, y: t.y, vx: rand(-15, 15), vy: rand(-15, 15), life: rand(0.3, 0.7), size: rand(1.5, 3), size1: 0.3, color: theme.ambient[1], alpha: 0.7 * w, drag: 1 });
    }
  }
}
