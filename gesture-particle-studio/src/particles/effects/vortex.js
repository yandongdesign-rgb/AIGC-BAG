import { lerp, rand, randRange } from '../../core/math.js';

/**
 * 漩涡：粒子以极坐标绕锚点旋转（内快外慢的吸积盘），逐渐被吸入；锚点移动时整盘跟随。
 * aux1 = 半径，aux2 = 角度。槽位权重消失时粒子转为自由运动，带着切向速度甩出。
 */
export default {
  create(p) {
    let acc = new Map();
    return {
      update(e, dt) {
        for (const s of e.slots) {
          const w = s.used ? s.weights.vortex || 0 : 0;
          const a = s.anchors;
          if (w < 0.01 || !a?.vortex) continue;
          const R = (a.vortexRadius ?? p.radius) * s.radiusScale;
          let n = (acc.get(s.index) || 0) + p.rate * w * e.rateScale * dt * (0.7 + 0.5 * s.intensity);
          while (n >= 1) {
            n--;
            const outer = Math.random() < 0.22;
            const r = outer ? R * rand(1.5, 2.3) : R * (0.25 + 0.9 * Math.sqrt(Math.random()));
            const th = Math.random() * Math.PI * 2;
            const i = e.spawn(this.index, s.index, a.vortex.x, a.vortex.y, 0, 0, randRange(p.life), randRange(p.size), 0, outer ? 0.6 : 0.95, 0);
            e.aux1[i] = r;
            e.aux2[i] = th;
          }
          acc.set(s.index, n);
        }
      },
      integrate(e, i, dt, t) {
        const s = e.slots[e.slot[i]];
        const w = s.used ? s.weights.vortex || 0 : 0;
        const a = s.anchors;
        if (w < 0.05 || !a?.vortex) {
          e.release(i);
          return;
        }
        const R = (a.vortexRadius ?? p.radius) * s.radiusScale;
        let r = e.aux1[i];
        const om = p.spin * Math.sqrt(R / Math.max(r, 0.02)) * (0.6 + 0.4 * w);
        e.aux2[i] += om * dt;
        r -= p.inflow * dt * (1 + (R / Math.max(r, 0.02)) * 0.4) * (r > R * 1.2 ? 4 : 1);
        if (r < 0.012) {
          e.life[i] = 0;
          return;
        }
        e.aux1[i] = r;
        const th = e.aux2[i];
        const wob = Math.sin(th * 3 + e.seed[i]) * 0.012;
        const nx = a.vortex.x + Math.cos(th) * (r + wob);
        const ny = a.vortex.y + Math.sin(th) * (r + wob) * p.tilt;
        e.vx[i] = (nx - e.px[i]) / Math.max(dt, 1e-3);
        e.vy[i] = (ny - e.py[i]) / Math.max(dt, 1e-3);
        e.px[i] = nx;
        e.py[i] = ny;
        const k = Math.min(1, r / R);
        e.hue[i] = lerp(p.hueInner, p.hueOuter, k);
        e.white[i] = Math.max(0, 0.85 - k * 1.1);
      },
    };
  },
};
