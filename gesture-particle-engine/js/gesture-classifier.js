/**
 * 手势分类器（规则版 + 可插拔模型接口）
 * 输入：HandTracker 输出的 21 点数据
 * 输出：{ state, prevState, changedAt, hands[], fingertips[], palmCenters[], pinchPoint, fistCenter,
 *        dual: {distance, norm, axis}, confidence, metrics }
 */
(function (global) {
  'use strict';

  const U = global.GPUtils;
  const L = global.GP_LANDMARK_INDEX;

  const FINGERS = [
    { name: 'index', mcp: L.INDEX_MCP, pip: L.INDEX_PIP, dip: L.INDEX_DIP, tip: L.INDEX_TIP },
    { name: 'middle', mcp: L.MIDDLE_MCP, pip: L.MIDDLE_PIP, dip: L.MIDDLE_DIP, tip: L.MIDDLE_TIP },
    { name: 'ring', mcp: L.RING_MCP, pip: L.RING_PIP, dip: L.RING_DIP, tip: L.RING_TIP },
    { name: 'pinky', mcp: L.PINKY_MCP, pip: L.PINKY_PIP, dip: L.PINKY_DIP, tip: L.PINKY_TIP }
  ];

  class GestureClassifier {
    constructor(config) {
      this.config = config;
      this.state = 'IDLE';
      this.prevState = 'IDLE';
      this.stateChangedAt = performance.now();
      this._pending = 'IDLE';
      this._pendingSince = performance.now();
      this._smoothed = [];
      this._history = [];
      this._liftFrames = 0;
      this.customClassifier = null;
    }

    setConfig(cfg) { this.config = cfg; }

    /** 预留：加载外部模型分类器。接口为 classify(hands, metrics) → {state, confidence} */
    async loadCustomClassifier(url) {
      if (!url) return false;
      try {
        const mod = await import(/* webpackIgnore: true */ url);
        const Ctor = mod.default || mod.GestureModel;
        this.customClassifier = new Ctor();
        if (this.customClassifier.init) await this.customClassifier.init();
        return true;
      } catch (e) {
        console.warn('[classifier] 自定义分类器加载失败，回退规则判定:', e);
        return false;
      }
    }

    _smoothHands(hands) {
      const a = this.config.smoothing == null ? 0.45 : this.config.smoothing;
      const out = [];
      for (let i = 0; i < hands.length; i++) {
        const cur = hands[i].landmarks;
        let prev = this._smoothed[i];
        if (!prev || prev.length !== cur.length) {
          prev = cur.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
        } else {
          prev = cur.map((p, j) => ({
            x: U.lerp(prev[j].x, p.x, a),
            y: U.lerp(prev[j].y, p.y, a),
            z: U.lerp(prev[j].z, p.z || 0, a)
          }));
        }
        this._smoothed[i] = prev;
        out.push({ ...hands[i], landmarks: prev });
      }
      this._smoothed.length = hands.length;
      return out;
    }

    _analyzeHand(hand, index, dt, now) {
      const lm = hand.landmarks;
      const cfg = this.config;
      const handSize = Math.max(0.04, U.dist2(lm[L.WRIST], lm[L.MIDDLE_MCP]) * 1.85);

      const fingers = FINGERS.map(f => {
        const ang = U.angleAt(lm[f.mcp], lm[f.pip], lm[f.tip]);
        const ext = ang >= (cfg.fingerExtendedAngle || 150);
        return { name: f.name, angle: ang, extended: ext, tip: lm[f.tip], pip: lm[f.pip], mcp: lm[f.mcp] };
      });

      const thumbAngle = U.angleAt(lm[L.THUMB_MCP], lm[L.THUMB_IP], lm[L.THUMB_TIP]);
      const thumbSpread = U.dist2(lm[L.THUMB_TIP], lm[L.PINKY_MCP]) / handSize;
      const thumbExt = thumbAngle >= (cfg.thumbExtendedAngle || 148) ||
        thumbSpread >= (cfg.thumbSpreadRatio || 1.02);

      const extended = fingers.filter(f => f.extended).length;
      const pinchRaw = U.dist3(lm[L.THUMB_TIP], lm[L.INDEX_TIP]) / handSize;

      // 垂直速度：图像坐标 y 向下为正，故取反使“上抬”为正
      let hist = this._history[index];
      if (!hist) { hist = []; this._history[index] = hist; }
      hist.push({ t: now, y: hand.center.y });
      const windowMs = (cfg.velocityWindow || 0.22) * 1000;
      while (hist.length > 2 && now - hist[0].t > windowMs) hist.shift();
      let vy = 0;
      if (hist.length >= 2) {
        const a = hist[0], b = hist[hist.length - 1];
        const d = (b.t - a.t) / 1000;
        if (d > 0.01) vy = (a.y - b.y) / d;
      }

      const fistCenter = {
        x: (lm[L.MIDDLE_MCP].x + lm[L.WRIST].x) / 2,
        y: (lm[L.MIDDLE_MCP].y + lm[L.WRIST].y) / 2
      };

      return {
        landmarks: lm,
        handedness: hand.handedness,
        score: hand.score,
        center: hand.center,
        handSize, fingers, thumbExt, thumbAngle, extended,
        pinchRatio: pinchRaw, vy,
        palm: { x: (lm[L.WRIST].x + lm[L.MIDDLE_MCP].x) / 2, y: (lm[L.WRIST].y + lm[L.MIDDLE_MCP].y) / 2 },
        fistCenter,
        fingertips: [L.THUMB_TIP, L.INDEX_TIP, L.MIDDLE_TIP, L.RING_TIP, L.PINKY_TIP].map(i => lm[i])
      };
    }

    classify(frame, dt) {
      const cfg = this.config;
      const now = performance.now();
      const hands = this._smoothHands(frame.hands || []);
      const analyzed = hands
        .filter(h => (h.score || 0.9) >= (cfg.minConfidence || 0.55))
        .map((h, i) => this._analyzeHand(h, i, dt, now));
      this._history.length = analyzed.length;

      // Demo 模式直接给出目标状态，便于稳定演示（仍输出完整指标供粒子层使用）
      const demoOverride = frame.source === 'demo' && frame.demoState ? frame.demoState : null;
      let candidate = 'IDLE';
      let confidence = 0.9;

      if (demoOverride) {
        candidate = demoOverride;
      } else if (analyzed.length >= 2) {
        candidate = 'DUAL';
        confidence = Math.min(analyzed[0].score, analyzed[1].score);
      } else if (analyzed.length === 1) {
        const h = analyzed[0];
        const wasPinch = this.state === 'PINCH';
        const pinchEnter = cfg.pinchRatio || 0.32;
        const pinchExit = cfg.pinchReleaseRatio || 0.42;
        const isPinch = wasPinch ? h.pinchRatio < pinchExit : h.pinchRatio < pinchEnter;
        const fistMax = cfg.fistMaxExtended == null ? 1 : cfg.fistMaxExtended;
        const openNeed = cfg.extendedCountForOpen || 4;

        const indexExt = h.fingers[0].extended;
        const othersExt = h.fingers.slice(1).some(f => f.extended);

        if (isPinch) { candidate = 'PINCH'; confidence = U.invLerp(pinchExit, pinchEnter * 0.4, h.pinchRatio); }
        else if (h.extended <= fistMax && !h.thumbExt) { candidate = 'FIST'; confidence = 1 - h.extended / 5; }
        else if (indexExt && !othersExt) { candidate = 'POINT'; confidence = 0.9; }
        else if (h.vy > (cfg.liftVelocity || 0.42)) {
          this._liftFrames++;
          if (this._liftFrames >= (cfg.liftHoldFrames || 3)) candidate = 'LIFT';
        } else { this._liftFrames = Math.max(0, this._liftFrames - 1); }

        if (candidate === 'IDLE' && h.extended >= openNeed) candidate = 'OPEN';
        confidence = Math.max(0.35, confidence * (0.6 + 0.4 * h.score));
      } else {
        this._liftFrames = 0;
      }

      // 状态保持稳定一段时间后才切换（防抖）
      if (candidate !== this._pending) {
        this._pending = candidate;
        this._pendingSince = now;
      }
      if (this.state !== this._pending && now - this._pendingSince >= (cfg.stateHoldMs || 110)) {
        this.prevState = this.state;
        this.state = this._pending;
        this.stateChangedAt = now;
      }

      // 自定义模型接口（若已加载，可覆盖规则结果）
      if (this.customClassifier) {
        try {
          const r = this.customClassifier.classify(analyzed, { dt, now });
          if (r && r.state && r.state !== this.state) {
            this.prevState = this.state;
            this.state = r.state;
            this.stateChangedAt = now;
            confidence = r.confidence != null ? r.confidence : confidence;
          }
        } catch (e) { console.warn('[classifier] 自定义分类异常:', e); }
      }

      const fingertips = [];
      analyzed.forEach(h => h.fingertips.forEach(p => fingertips.push(p)));
      const pinchPoint = analyzed.length
        ? { x: (analyzed[0].landmarks[L.THUMB_TIP].x + analyzed[0].landmarks[L.INDEX_TIP].x) / 2,
            y: (analyzed[0].landmarks[L.THUMB_TIP].y + analyzed[0].landmarks[L.INDEX_TIP].y) / 2 }
        : { x: 0.5, y: 0.5 };

      let dual = { distance: 0, norm: 0, axis: { x: 1, y: 0 } };
      if (analyzed.length >= 2) {
        const a = analyzed[0].center, b = analyzed[1].center;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        dual = { distance: d, norm: U.invLerp(0.1, 0.6, d), axis: { x: dx / d, y: dy / d } };
      }

      return {
        state: this.state,
        prevState: this.prevState,
        stateChangedAt: this.stateChangedAt,
        justChanged: this.state !== this.prevState && now - this.stateChangedAt < 40,
        hands: analyzed,
        fingertips,
        pinchPoint,
        fistCenter: analyzed.length ? analyzed[0].fistCenter : { x: 0.5, y: 0.5 },
        palmCenters: analyzed.map(h => h.palm),
        dual,
        confidence,
        metrics: analyzed[0] || null,
        timestamp: now
      };
    }
  }

  global.GPGestureClassifier = GestureClassifier;
})(window);
