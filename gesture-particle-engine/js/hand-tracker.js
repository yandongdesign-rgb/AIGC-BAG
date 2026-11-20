/**
 * 手部追踪模块
 * - 真实模式：MediaPipe Hands → 21 关节点 / 左右手 / 置信度
 * - Demo 模式：程序化合成同样的 21 点数据结构，便于无摄像头演示、截图、录屏
 * 对外统一输出：{ hands: [{ landmarks[21]{x,y,z}, handedness, score, center }], timestamp, source }
 */
(function (global) {
  'use strict';

  const U = global.GPUtils;
  const LM = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
  };

  class HandTracker {
    constructor(config) {
      this.config = config;
      this.video = null;
      this.hands = null;
      this.camera = null;
      this.running = false;
      this.demo = false;
      this.demoTime = 0;
      this.demoSequence = ['OPEN', 'FIST', 'POINT', 'PINCH', 'LIFT', 'DUAL', 'IDLE'];
      this.demoIndex = 0;
      this.demoStateTimer = 0;
      this.demoStateDuration = 3.2;
      this.lastResult = { hands: [], timestamp: performance.now(), source: 'demo' };
      this.onResults = null;
      this.latencyMs = 0;
    }

    async init(videoEl) {
      this.video = videoEl;
      const cfg = this.config;

      if (typeof window.Hands !== 'function') {
        throw new Error('MediaPipe Hands 未加载，请检查网络或 CDN 地址');
      }

      this.hands = new window.Hands({
        locateFile: file => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + file
      });
      this.hands.setOptions({
        maxNumHands: cfg.maxHands || 2,
        modelComplexity: cfg.modelComplexity != null ? cfg.modelComplexity : 1,
        minDetectionConfidence: cfg.minConfidence || 0.55,
        minTrackingConfidence: cfg.minConfidence || 0.55,
        selfieMode: !!(cfg.handednessMirror !== false)
      });
      this.hands.onResults(res => this._handleResults(res));

      if (typeof window.Camera === 'function') {
        this.camera = new window.Camera(videoEl, {
          onFrame: async () => {
            if (!this.running || this.demo) return;
            const t0 = performance.now();
            await this.hands.send({ image: videoEl });
            this.latencyMs = performance.now() - t0;
          },
          width: cfg.resizeWidth || 640,
          height: cfg.resizeHeight || 480
        });
      }
      return this;
    }

    async start() {
      this.running = true;
      if (this.demo) return this;
      if (this.camera) {
        await this.camera.start();
      } else if (this.hands && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // camera_utils 未加载时的手动采集回退
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: this.config.resizeWidth || 640, height: this.config.resizeHeight || 480 },
          audio: false
        });
        this.video.srcObject = stream;
        await this.video.play();
        const tick = async () => {
          if (!this.running || this.demo) return;
          const t0 = performance.now();
          try { await this.hands.send({ image: this.video }); } catch (e) { console.warn('[tracker] send 失败:', e); }
          this.latencyMs = performance.now() - t0;
          this._manualRaf = requestAnimationFrame(tick);
        };
        this._manualRaf = requestAnimationFrame(tick);
      }
      return this;
    }

    stop() {
      this.running = false;
      if (this._manualRaf) { cancelAnimationFrame(this._manualRaf); this._manualRaf = null; }
      if (this.camera && typeof this.camera.stop === 'function') this.camera.stop();
      if (this.video && this.video.srcObject) {
        this.video.srcObject.getTracks().forEach(t => t.stop());
        this.video.srcObject = null;
      }
    }

    setDemo(enabled) {
      this.demo = !!enabled;
      if (this.demo) {
        if (this.camera && typeof this.camera.stop === 'function') this.camera.stop();
        if (this._manualRaf) { cancelAnimationFrame(this._manualRaf); this._manualRaf = null; }
        if (this.video && this.video.srcObject) {
          this.video.srcObject.getTracks().forEach(t => t.stop());
          this.video.srcObject = null;
        }
      }
      this.demoTime = 0;
      this.demoIndex = 0;
      this.demoStateTimer = 0;
      return this;
    }

    _handleResults(res) {
      const out = [];
      const lms = res.multiHandLandmarks || [];
      const info = res.multiHandedness || [];
      for (let i = 0; i < lms.length; i++) {
        const pts = lms[i];
        if (!pts || pts.length < 21) continue;
        const score = info[i] ? (info[i].score || 0) : 0.9;
        let center = { x: 0, y: 0, z: 0 };
        for (const p of pts) { center.x += p.x; center.y += p.y; center.z += (p.z || 0); }
        center.x /= 21; center.y /= 21; center.z /= 21;
        out.push({
          landmarks: pts,
          handedness: info[i] && info[i].label ? info[i].label : 'Unknown',
          score,
          center
        });
      }
      const packaged = { hands: out, timestamp: performance.now(), source: 'camera' };
      this.lastResult = packaged;
      if (this.onResults) this.onResults(packaged);
    }

    /** 每帧调用；Demo 模式下生成合成手部数据 */
    update(dt) {
      if (!this.demo || !this.running) return this.lastResult;
      this.demoTime += dt;
      this.demoStateTimer += dt;
      if (this.demoStateTimer >= this.demoStateDuration) {
        this.demoStateTimer = 0;
        this.demoIndex = (this.demoIndex + 1) % this.demoSequence.length;
      }
      const state = this.demoSequence[this.demoIndex];
      const t = this.demoTime;
      const hands = [];

      if (state !== 'IDLE') {
        const cx = 0.5 + 0.13 * Math.sin(t * 0.55);
        const cy = 0.56 + 0.06 * Math.cos(t * 0.7) - (state === 'LIFT' ? U.clamp(this.demoStateTimer - 0.4, 0, 2) * 0.11 : 0);
        const extended = {
          index: state === 'OPEN' || state === 'LIFT' || state === 'PINCH' || state === 'POINT',
          middle: state === 'OPEN' || state === 'LIFT',
          ring: state === 'OPEN' || state === 'LIFT',
          pinky: state === 'OPEN' || state === 'LIFT'
        };
        const thumbExt = state === 'OPEN' || state === 'LIFT' || state === 'PINCH';
        hands.push(this._syntheticHand(cx, cy, 0.19, extended, thumbExt, state === 'PINCH', 'Left', t));

        if (state === 'DUAL') {
          const gap = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.1));
          hands.push(this._syntheticHand(U.clamp(cx + gap, 0.15, 0.85), cy + 0.02, 0.17,
            { index: true, middle: true, ring: true, pinky: true }, true, false, 'Right', t * 1.2));
        }
      }

      this.lastResult = {
        hands,
        timestamp: performance.now(),
        source: 'demo',
        demoState: state
      };
      if (this.onResults) this.onResults(this.lastResult);
      return this.lastResult;
    }

    _syntheticHand(cx, cy, size, ext, thumbExt, pinch, handedness, t) {
      const pts = new Array(21);
      const p = (i, x, y, z) => { pts[i] = { x: U.clamp(x, 0.02, 0.98), y: U.clamp(y, 0.02, 0.98), z: z || 0 }; };
      const wobble = Math.sin(t * 2.3) * size * 0.012;

      p(LM.WRIST, cx, cy + size * 0.42, 0);
      p(LM.THUMB_CMC, cx - size * 0.32, cy + size * 0.22, 0.01);
      p(LM.THUMB_MCP, cx - size * 0.42, cy + size * 0.04, 0.02);
      p(LM.THUMB_IP, cx - size * 0.5, cy - size * 0.08, 0.03);
      p(LM.THUMB_TIP, thumbExt ? cx - size * 0.62 : cx - size * 0.16,
        thumbExt ? cy - size * 0.2 : cy - size * 0.1, 0.04);

      const fingers = [
        { mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, dip: LM.INDEX_DIP, tip: LM.INDEX_TIP, dx: -0.27, k: 1.0 },
        { mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, dip: LM.MIDDLE_DIP, tip: LM.MIDDLE_TIP, dx: -0.08, k: 1.1 },
        { mcp: LM.RING_MCP, pip: LM.RING_PIP, dip: LM.RING_DIP, tip: LM.RING_TIP, dx: 0.1, k: 1.0 },
        { mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, dip: LM.PINKY_DIP, tip: LM.PINKY_TIP, dx: 0.26, k: 0.85 }
      ];
      fingers.forEach((f, idx) => {
        const bx = cx + size * f.dx, by = cy;
        const isExt = ext[['index', 'middle', 'ring', 'pinky'][idx]];
        p(f.mcp, bx, by, 0);
        if (isExt) {
          p(f.pip, bx + wobble, by - size * 0.23 * f.k, 0.01);
          p(f.dip, bx + wobble * 1.4, by - size * 0.4 * f.k, 0.02);
          p(f.tip, bx + wobble * 1.8, by - size * 0.56 * f.k, 0.03);
        } else {
          p(f.pip, bx, by - size * 0.2, 0.01);
          p(f.dip, bx + size * 0.05, by - size * 0.04, 0.02);
          p(f.tip, bx + size * 0.12, by + size * 0.08, 0.03);
        }
      });

      if (pinch) {
        const a = pts[LM.THUMB_TIP], b = pts[LM.INDEX_TIP];
        a.x = cx - size * 0.16; a.y = cy - size * 0.16;
        b.x = cx - size * 0.16 + size * 0.035; b.y = cy - size * 0.16 - size * 0.02;
      }

      let center = { x: 0, y: 0, z: 0 };
      for (const q of pts) { center.x += q.x; center.y += q.y; center.z += q.z; }
      center.x /= 21; center.y /= 21; center.z /= 21;
      return { landmarks: pts, handedness, score: 0.97, center };
    }

    /** 等待 MediaPipe 脚本就绪（HTML 中通过 script 标签引入） */
    static scriptsReady() {
      return !!(window.Hands && window.Camera);
    }
  }

  global.GPHandTracker = HandTracker;
  global.GP_LANDMARK_INDEX = LM;
})(window);
