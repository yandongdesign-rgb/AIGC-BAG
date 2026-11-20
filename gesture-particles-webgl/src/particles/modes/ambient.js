/** 待机背景粒子流 + 无手时“缓慢回落” */
import { Mode } from '../mode.js';
import { rand, randRange, pick } from '../../core/math.js';
import { KIND } from '../pool.js';

export class AmbientMode extends Mode {
  update(dt, _h, w) {
    const { pool, W, H, theme } = this.ctx, p = this.p;
    const idle = this.ctx.idleLevel;
    const n = this.count(p.rate * (0.35 + 0.65 * idle) * w, dt);
    for (let i = 0; i < n; i++) {
      const c = pick(theme.ambient);
      pool.emit({
        x: rand(0, W), y: rand(0, H),
        vx: rand(-1, 1) * p.speed, vy: rand(-1, 1) * p.speed,
        life: randRange(p.life), size: randRange(p.size), size1: randRange(p.size) * 0.6,
        color: c, alpha: randRange(p.alpha) * (0.5 + 0.5 * idle),
        drag: 0.8, kind: KIND.TURB,
      });
    }
    // 无手：所有特效粒子受弱重力缓慢回落、减速
    if (this.ctx.handsCount === 0 && this.ctx.idleTime > 0.15) {
      const g = p.fallGravity * dt, damp = Math.exp(-0.9 * dt);
      for (let i = 0; i < pool.count; i++) {
        if (pool.kind[i] === KIND.TURB) continue;
        pool.vx[i] *= damp;
        pool.vy[i] = pool.vy[i] * damp + g;
      }
    }
  }
}
