// 合成手部关键点：用于键盘/自动演示与单元测试
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const SG = (root.SG = root.SG || {});
  const MCP = { index: [-0.22, -0.42], middle: [-0.02, -0.45], ring: [0.17, -0.42], pinky: [0.33, -0.35] };
  const LEN = { index: 1, middle: 1.1, ring: 1, pinky: 0.8 };
  const SPREAD = { index: -0.12, middle: 0, ring: 0.1, pinky: 0.22 };
  const EXT = { open: ['index', 'middle', 'ring', 'pinky', 'thumb'], fist: [], point: ['index'], v: ['index', 'middle'], rock: ['index', 'pinky', 'thumb'], none: ['index', 'middle', 'ring'], pinch: ['middle', 'ring', 'pinky'] };

  function makeHand(x, y, gesture, s, rot) {
    const ext = EXT[gesture] || [];
    const L = new Array(21);
    L[0] = [0, 0.55];
    if (gesture === 'pinch') { L[1] = [-0.25, 0.4]; L[2] = [-0.45, 0.15]; L[3] = [-0.55, -0.2]; L[4] = [-0.47, -0.6]; }
    else if (ext.includes('thumb')) { L[1] = [-0.25, 0.4]; L[2] = [-0.45, 0.2]; L[3] = [-0.62, 0.02]; L[4] = [-0.76, -0.14]; }
    else { L[1] = [-0.25, 0.4]; L[2] = [-0.32, 0.18]; L[3] = [-0.16, 0.02]; L[4] = [0.0, -0.02]; }
    const base = { index: 5, middle: 9, ring: 13, pinky: 17 };
    for (const f in base) {
      const b = base[f], m = MCP[f];
      L[b] = m.slice();
      if (gesture === 'pinch' && f === 'index') { L[b + 1] = [-0.3, -0.75]; L[b + 2] = [-0.4, -0.8]; L[b + 3] = [-0.46, -0.66]; continue; }
      if (ext.includes(f)) {
        const ang = SPREAD[f], l = LEN[f];
        for (let k = 1; k <= 3; k++) { const d = [0.4, 0.65, 0.85][k - 1] * l; L[b + k] = [m[0] + Math.sin(ang) * d, m[1] - Math.cos(ang) * d]; }
      } else {
        L[b + 1] = [m[0], m[1] - 0.22]; L[b + 2] = [m[0] + 0.02, m[1] - 0.08]; L[b + 3] = [m[0] + 0.03, m[1] + 0.12];
      }
    }
    const c = Math.cos(rot || 0), sn = Math.sin(rot || 0);
    return L.map(([lx, ly], i) => {
      ly += 0.25;
      return { x: x + (lx * c - ly * sn) * s, y: y + (lx * sn + ly * c) * s, z: (i % 4 === 0 ? -0.02 : 0) * s };
    });
  }

  SG.Synth = { makeHand };
})();
