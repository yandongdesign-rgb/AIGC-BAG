import { rand, randRange } from '../../core/math.js';

/** 拖尾：指尖出生点 + 彩色光带（条带渲染）；渐变衰减 */
export default {
  create(p) {
    const hist = new Map(); // slotIndex -> [tipIdx] -> [{x,y,t}]
    const acc = new Map();
    return {
      update(e, dt, t) {
        for (const s of e.slots) {
          const w = s.used ? s.weights.trail || 0 : 0;
          if (!hist.has(s.index)) hist.set(s.index, [[], [], [], [], []]);
          const H = hist.get(s.index);
          for (const arr of H) while (arr.length && t - arr[0].t > p.ribbon.seconds) arr.shift();
          if (w < 0.01 || !s.anchors?.tips) continue;
          const tips = s.anchors.tips;
          const prev = s.prevAnchors?.tips || tips;
          const mask = s.anchors.trailTips || [0, 1, 2, 3, 4];
          for (const k of mask) {
            const a = tips[k];
            H[k].push({ x: a.x, y: a.y, t, w });
            const key = s.index * 8 + k;
            let n = (acc.get(key) || 0) + p.ratePerTip * w * e.rateScale * dt * (0.6 + s.intensity * 0.6);
            const b = prev[k];
            const vx = (a.x - b.x) / Math.max(dt, 1e-3);
            const vy = (a.y - b.y) / Math.max(dt, 1e-3);
            while (n >= 1) {
              n--;
              const u = Math.random();
              const hue = (t * p.hueSpeed + k * 55 + rand(-12, 12)) % 360;
              e.spawn(
                this.index, s.index,
                b.x + (a.x - b.x) * u + rand(-1, 1) * p.jitter * 0.3,
                b.y + (a.y - b.y) * u + rand(-1, 1) * p.jitter * 0.3,
                vx * p.inherit + rand(-1, 1) * p.jitter, vy * p.inherit + rand(-1, 1) * p.jitter,
                randRange(p.life), randRange(p.size), hue, 0.9 * Math.min(1, w * 1.4), Math.random() < 0.15 ? 0.7 : 0.1,
              );
            }
            acc.set(key, n);
          }
        }
        this.hist = hist;
        this.t = t;
      },
      integrate(e, i, dt) {
        const d = Math.exp(-p.drag * dt);
        e.vx[i] *= d;
        e.vy[i] *= d;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
      },
      draw(e, batch) {
        const t = this.t;
        for (const H of hist.values()) {
          H.forEach((pts, k) => {
            if (pts.length < 2) return;
            const hueBase = (t * p.hueSpeed + k * 55) % 360;
            batch.strip(pts, (u, q) => p.ribbon.width * q.w * (0.15 + 0.85 * u), (u, q) => batch.hsl(hueBase - (1 - u) * 60, 0.9, 0.55, u * u * 0.85 * q.w));
            batch.strip(pts, (u, q) => p.ribbon.width * 0.25 * q.w * u, (u, q) => [1, 1, 1, u * u * 0.9 * q.w]);
          });
        }
      },
    };
  },
};
