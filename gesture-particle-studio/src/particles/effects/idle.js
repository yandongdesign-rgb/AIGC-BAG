import { flow, rand, randRange } from '../../core/math.js';

/** 待机背景粒子流：全屏缓慢流动，手掌附近被轻推开 */
export default {
  create(p) {
    let acc = 0;
    return {
      update(e, dt, t, ctx) {
        acc += p.rate * e.rateScale * dt * (0.5 + 0.5 * e.calm);
        const { w, h } = e.bounds;
        while (acc >= 1) {
          acc--;
          e.spawn(this.index, 0, rand(-w, w), rand(-h, h), 0, 0, randRange(p.life), randRange(p.size), randRange(p.hue), p.alpha * rand(0.4, 1), 0);
        }
        this.repel = ctx.palms;
      },
      integrate(e, i, dt, t) {
        const [fx, fy] = flow(e.px[i] * 1.3, e.py[i] * 1.3, t * 0.6);
        let ax = fx * p.speed - e.vx[i];
        let ay = fy * p.speed - e.vy[i];
        const palms = this.repel;
        if (palms) {
          for (const q of palms) {
            const dx = e.px[i] - q.x;
            const dy = e.py[i] - q.y;
            const d2 = dx * dx + dy * dy + 0.01;
            if (d2 < 0.25) {
              ax += (dx / d2) * 0.08;
              ay += (dy / d2) * 0.08;
            }
          }
        }
        e.vx[i] += ax * dt * 1.5;
        e.vy[i] += ay * dt * 1.5;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
      },
    };
  },
};
