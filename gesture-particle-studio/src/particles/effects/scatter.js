import { flow, rand, randRange } from '../../core/math.js';

/** 四散飞舞：大量彩色粒子从掌心向四周飘起，弱重力，缓慢漂移闪烁 */
export default {
  create(p) {
    const acc = new Map();
    return {
      update(e, dt) {
        for (const s of e.slots) {
          const w = s.used ? s.weights.scatter || 0 : 0;
          const a = s.anchors;
          if (w < 0.01 || !a?.palm) continue;
          let n = (acc.get(s.index) || 0) + p.rate * w * e.rateScale * dt * (0.7 + 0.6 * s.intensity);
          while (n >= 1) {
            n--;
            const src = Math.random() < 0.6 ? a.palm : a.tips[Math.floor(Math.random() * 5)];
            const ang = Math.PI / 2 + rand(-1.5, 1.5);
            const sp = randRange(p.speed) * s.radiusScale;
            const i = e.spawn(this.index, s.index, src.x + rand(-0.06, 0.06), src.y + rand(-0.06, 0.06), Math.cos(ang) * sp, Math.sin(ang) * sp, randRange(p.life), randRange(p.size), rand(0, 360), rand(0.5, 1), 0.3);
            e.aux1[i] = rand(0.5, 1.5);
          }
          acc.set(s.index, n);
        }
      },
      integrate(e, i, dt, t) {
        const [fx, fy] = flow(e.px[i] * 2, e.py[i] * 2, t + e.seed[i]);
        const d = Math.exp(-p.drag * dt);
        e.vx[i] = e.vx[i] * d + fx * p.wander * dt;
        e.vy[i] = e.vy[i] * d + (fy * p.wander + p.gravity) * dt;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
        e.white[i] = 0.25 + 0.35 * Math.max(0, Math.sin(t * p.twinkle * e.aux1[i] + e.seed[i]));
      },
    };
  },
};
