import { rand, randRange } from '../../core/math.js';

/** 闪爆：握拳瞬间由拳心向外冲击（主爆 + 火花 + 冲击环），握住时冒火星 */
export default {
  create(p) {
    let embers = 0;
    return {
      onEnter(e, s, { intensity = 1 } = {}) {
        const c = s.anchors?.palm;
        if (!c) return;
        const k = s.radiusScale * (0.75 + 0.5 * intensity);
        const q = Math.min(1.6, e.rateScale);
        const n = Math.floor(p.count * q);
        for (let j = 0; j < n; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = randRange(p.speed) * Math.sqrt(Math.random()) * k;
          const hot = sp / (p.speed[1] * k);
          e.spawn(this.index, s.index, c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, randRange(p.life), randRange(p.size), randRange(p.hue), 1, 0.15 + hot * 0.7);
        }
        for (let j = 0; j < p.sparks * q; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(2.2, 4.2) * k;
          e.spawn(this.index, s.index, c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.25, 0.7), rand(1.5, 3), 45, 1, 0.9);
        }
        for (let j = 0; j < p.ring; j++) {
          const a = (j / p.ring) * Math.PI * 2;
          const sp = 1.7 * k;
          e.spawn(this.index, s.index, c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.55, 4, 30, 0.9, 0.85);
        }
        e.flash = Math.max(e.flash, p.flash * (0.7 + 0.3 * intensity));
        e.events.push({ type: 'burst', slot: s.index, intensity });
      },
      update(e, dt) {
        for (const s of e.slots) {
          const w = s.used ? s.weights.burst || 0 : 0;
          if (w < 0.05 || !s.anchors?.palm) continue;
          embers += p.emberRate * w * dt * e.rateScale;
          const c = s.anchors.palm;
          while (embers >= 1) {
            embers--;
            const a = Math.random() * Math.PI * 2;
            const r = rand(0.03, 0.1) * s.radiusScale;
            e.spawn(this.index, s.index, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, Math.cos(a) * 0.15, rand(0.1, 0.5), rand(0.4, 0.9), rand(2, 4), rand(10, 40), 0.8 * w, 0.4);
          }
        }
      },
      integrate(e, i, dt) {
        const d = Math.exp(-p.drag * dt);
        e.vx[i] *= d;
        e.vy[i] = e.vy[i] * d + p.gravity * dt;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
        e.white[i] *= Math.exp(-2.2 * dt);
      },
    };
  },
};
