// 手势识别：纯函数 classify(landmarks) + Stabilizer 防抖
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const SG = (root.SG = root.SG || {});
  const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  const cosAt = (a, b, c) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = (b.z || 0) - (a.z || 0);
    const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z || 0) - (b.z || 0);
    return (ux * vx + uy * vy + uz * vz) / ((Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)) || 1);
  };

  // lm: 21 个点，x/y/z 使用同一尺度（像素）
  function classify(lm, prevPinch, cfg) {
    cfg = cfg || { pinchOn: 0.32, pinchOff: 0.46 };
    const wrist = lm[0];
    const palm = d3(wrist, lm[9]) || 1;
    const ext = {};
    for (const k in FINGERS) {
      const [m, p, , t] = FINGERS[k];
      const straight = cosAt(lm[m], lm[p], lm[t]) > 0.45;
      const far = d3(wrist, lm[t]) > d3(wrist, lm[p]) * 1.12;
      ext[k] = straight && far;
    }
    ext.thumb = d3(lm[4], lm[5]) > 0.55 * palm && cosAt(lm[2], lm[3], lm[4]) > 0.55;
    const pinchRatio = d3(lm[4], lm[8]) / palm;
    const indexOut = d3(wrist, lm[8]) / palm > 0.85;
    const pinch = indexOut && pinchRatio < (prevPinch ? cfg.pinchOff : cfg.pinchOn);
    const n = (ext.index ? 1 : 0) + (ext.middle ? 1 : 0) + (ext.ring ? 1 : 0) + (ext.pinky ? 1 : 0);

    let g = 'none';
    if (pinch) g = 'pinch';
    else if (n >= 4) g = 'open';
    else if (n === 0) g = 'fist';
    else if (ext.index && !ext.middle && !ext.ring && !ext.pinky) g = 'point';
    else if (ext.index && ext.middle && !ext.ring && !ext.pinky) g = 'v';
    else if (ext.index && ext.pinky && !ext.middle && !ext.ring) g = 'rock';
    return { gesture: g, ext, pinch: g === 'pinch', pinchRatio, palm };
  }

  class Stabilizer {
    constructor(frames, fast) { this.frames = frames || 3; this.fast = fast || 2; this.stable = 'none'; this.cand = 'none'; this.count = 0; }
    push(raw) {
      if (raw === this.cand) this.count++; else { this.cand = raw; this.count = 1; }
      const need = raw === 'fist' || raw === 'open' ? this.fast : this.frames;
      if (this.count >= need) this.stable = raw;
      return this.stable;
    }
  }

  SG.Gestures = { classify, Stabilizer };
})();
