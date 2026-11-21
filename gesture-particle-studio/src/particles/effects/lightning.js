import { rand } from '../../core/math.js';

/** 中点位移生成锯齿折线 */
function bolt(ax, ay, bx, by, segments, jag) {
  let pts = [{ x: ax, y: ay }, { x: bx, y: by }];
  const len = Math.hypot(bx - ax, by - ay);
  let amp = jag * len;
  while (pts.length < segments) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const o = rand(-1, 1) * amp;
      next.push({ x: (a.x + b.x) / 2 + (-dy / l) * o, y: (a.y + b.y) / 2 + (dx / l) * o }, b);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}

/** 闪电：食指指尖 → 目标点（指向方向或另一只手）的锯齿电弧，随机分叉、频闪 */
export default {
  create(p) {
    const bolts = new Map(); // slot -> {main, branches, at, flick}
    let sparks = 0;
    return {
      update(e, dt, t) {
        for (const s of e.slots) {
          const w = s.used ? s.weights.lightning || 0 : 0;
          const a = s.anchors;
          if (w < 0.01 || !a?.indexTip) {
            bolts.delete(s.index);
            continue;
          }
          let b = bolts.get(s.index);
          if (!b || t - b.at > p.refreshMs / 1000) {
            const L = p.length * s.radiusScale * (0.8 + 0.4 * s.intensity);
            let tx;
            let ty;
            if (a.target) {
              tx = a.target.x;
              ty = a.target.y;
            } else {
              const ang = Math.atan2(a.indexDir.y, a.indexDir.x) + rand(-0.12, 0.12);
              tx = a.indexTip.x + Math.cos(ang) * L;
              ty = a.indexTip.y + Math.sin(ang) * L;
            }
            const main = bolt(a.indexTip.x, a.indexTip.y, tx, ty, p.segments, p.jag);
            const branches = [];
            for (let j = 0; j < p.branches; j++) {
              if (Math.random() > p.branchChance) continue;
              const from = main[Math.floor(rand(0.2, 0.8) * main.length)];
              const ang = Math.atan2(ty - a.indexTip.y, tx - a.indexTip.x) + rand(-0.9, 0.9);
              const bl = Math.hypot(tx - a.indexTip.x, ty - a.indexTip.y) * rand(0.2, 0.45);
              branches.push(bolt(from.x, from.y, from.x + Math.cos(ang) * bl, from.y + Math.sin(ang) * bl, 8, p.jag));
            }
            b = { main, branches, at: t, flick: rand(0.55, 1), end: { x: tx, y: ty } };
            bolts.set(s.index, b);
            e.events.push({ type: 'zap', slot: s.index, intensity: w });
          }
          sparks += p.sparkRate * w * dt * e.rateScale;
          while (sparks >= 1) {
            sparks--;
            const atEnd = Math.random() < 0.55;
            const q = atEnd ? b.end : b.main[Math.floor(Math.random() * b.main.length)];
            const ang = Math.random() * Math.PI * 2;
            const sp = rand(0.3, 1.4);
            e.spawn(this.index, s.index, q.x, q.y, Math.cos(ang) * sp, Math.sin(ang) * sp, rand(0.15, 0.45), rand(1.5, 3.5), p.hue + rand(-15, 25), 1, 0.75);
          }
        }
      },
      integrate(e, i, dt) {
        const d = Math.exp(-3 * dt);
        e.vx[i] *= d;
        e.vy[i] = e.vy[i] * d - 1.2 * dt;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
      },
      draw(e, batch) {
        for (const [slot, b] of bolts) {
          const w = (e.slots[slot].weights.lightning || 0) * b.flick;
          const glow = batch.hsl(p.hue, 0.9, 0.6, 0.35 * w);
          const core = [0.85, 0.95, 1, w];
          batch.strip(b.main, () => p.glowWidth * w, () => glow);
          batch.strip(b.main, () => p.coreWidth * (0.6 + w), () => core);
          for (const br of b.branches) {
            batch.strip(br, (u) => p.glowWidth * 0.5 * w * (1 - u * 0.7), () => glow);
            batch.strip(br, (u) => p.coreWidth * 0.6 * (1 - u * 0.7), () => core);
          }
        }
      },
    };
  },
};
