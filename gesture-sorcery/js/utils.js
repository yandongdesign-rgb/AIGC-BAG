(function () {
  const U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  U.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  U.easeInCubic = (t) => t * t * t;
  U.mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  U.norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  U.hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  U.rgba = (c, a) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
  U.mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // 一维平滑值噪声，用于火焰与能量抖动
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = Math.random();
  U.noise1 = (x) => {
    const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
    return perm[i & 511] * (1 - t) + perm[(i + 1) & 511] * t;
  };

  // 中点位移闪电路径
  U.boltPath = (x1, y1, x2, y2, jitter, depth) => {
    let pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    let off = jitter;
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const nx = -(b.y - a.y), ny = b.x - a.x, l = Math.hypot(nx, ny) || 1;
        const o = (Math.random() * 2 - 1) * off;
        next.push({ x: mx + (nx / l) * o, y: my + (ny / l) * o }, b);
      }
      pts = next;
      off *= 0.52;
    }
    return pts;
  };

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SG = root.SG || {};
  root.SG.U = U;
})();
