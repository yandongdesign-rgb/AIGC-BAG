// 手部状态管理：屏幕映射、平滑、速度、手势防抖、身份跟踪
(function () {
  const SG = window.SG;
  const U = SG.U;
  let nextId = 1;

  class HandManager {
    constructor(cfg) { this.cfg = cfg; this.hands = []; }

    // frames: [{lm:[{x,y,z}] 屏幕像素, gesture?:string(演示模式直接给定)}]
    update(frames, dt, now, H) {
      const tc = this.cfg.tracking, gc = this.cfg.gesture;
      const used = new Set();
      for (const f of frames) {
        const palm = palmOf(f.lm);
        let best = null, bd = Infinity;
        for (const h of this.hands) {
          if (used.has(h)) continue;
          const d = U.dist(h.palm, palm);
          if (d < bd) { bd = d; best = h; }
        }
        if (!best || bd > H * 0.45) {
          best = { id: nextId++, lm: f.lm.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 })), stab: new SG.Gestures.Stabilizer(gc.stableFrames, gc.fastFrames), gesture: 'none', prev: 'none', since: now, born: now, vx: 0, vy: 0, speed: 0, sizeRate: 0, pinch: false, lastFist: -1e9, palm };
          best.size = sizeOf(best.lm);
          this.hands.push(best);
        }
        used.add(best);
        const h = best;
        // 平滑（运动越快跟随越快）
        const k = 1 - Math.exp(-tc.smoothing * dt * (1 + Math.min(3, U.dist(h.palm, palm) / 40)));
        for (let i = 0; i < 21; i++) {
          const a = h.lm[i], b = f.lm[i];
          a.x += (b.x - a.x) * k; a.y += (b.y - a.y) * k; a.z += ((b.z || 0) - a.z) * k;
        }
        const np = palmOf(h.lm), ns = sizeOf(h.lm);
        if (dt > 0) {
          const ivx = (np.x - h.palm.x) / dt, ivy = (np.y - h.palm.y) / dt;
          h.vx = U.damp(h.vx, ivx, 18, dt); h.vy = U.damp(h.vy, ivy, 18, dt);
          h.sizeRate = U.damp(h.sizeRate, (ns - h.size) / (h.size * dt), 14, dt);
        }
        h.palm = np; h.size = ns;
        h.speed = Math.hypot(h.vx, h.vy) / H;
        let g = f.gesture;
        if (!g) {
          const c = SG.Gestures.classify(h.lm, h.pinch, gc);
          h.pinch = c.pinch;
          g = h.stab.push(c.gesture);
        }
        if (g !== h.gesture) { h.prev = h.gesture; h.gesture = g; h.since = now; }
        if (g === 'fist') h.lastFist = now;
        h.seen = now;
        h.present = true;
        computeTips(h);
      }
      for (const h of this.hands) if (!used.has(h)) h.present = false;
      this.hands = this.hands.filter((h) => h.present || now - h.seen < tc.lostGraceMs);
      return this.hands;
    }
  }

  function palmOf(lm) {
    return { x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 };
  }
  function sizeOf(lm) { return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 1; }
  function computeTips(h) {
    const lm = h.lm;
    h.tips = { thumb: lm[4], index: lm[8], middle: lm[12], ring: lm[16], pinky: lm[20] };
    h.pinchPt = U.mid(lm[4], lm[8]);
    const d = U.norm(lm[8].x - lm[5].x, lm[8].y - lm[5].y);
    h.indexDir = d;
    h.up = U.norm(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
  }

  SG.HandManager = HandManager;
  SG.HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
})();
