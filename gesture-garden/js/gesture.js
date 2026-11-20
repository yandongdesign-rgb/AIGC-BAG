/**
 * HandTracker —— 摄像头 + MediaPipe Hands + 手势分类
 *
 * 低延迟策略：
 *   1. 640×480 输入 + lite 模型（modelComplexity 0），单手检测；
 *   2. 使用 requestVideoFrameCallback 在每个新视频帧到达时立即送检，不经过额外缓冲；
 *   3. 推理进行中则丢弃新帧（永不排队，避免延迟累积）；
 *   4. 仅需连续 2 帧一致即确认手势（≈ 1 帧间隔 + 推理时间）。
 * “响应延迟”= 新手势首次出现的那一帧送检时刻 → 手势被确认的时刻，实时显示在 HUD 中。
 */
(function () {
  const { clamp } = GG.util;

  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
  ];

  /**
   * 基于关键点几何关系的手势分类（与左右手、远近无关）
   * 以“手腕→中指根”的距离作为手掌尺度做归一化。
   * @returns {{gesture: 'open'|'fist'|'neutral', openness: number}}
   */
  function classify(lm, aspect) {
    const px = (i) => lm[i].x * aspect;
    const py = (i) => lm[i].y;
    const dist = (a, b) => Math.hypot(px(a) - px(b), py(a) - py(b));
    const palm = dist(0, 9) || 1e-6;

    // [指尖, PIP 关节]
    const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
    let extended = 0;
    let ratioSum = 0;
    for (const [tip, pip] of fingers) {
      const dt = dist(tip, 0);
      const dp = dist(pip, 0);
      const r = dt / palm; // 伸直 ≈ 1.8~2.1，弯曲 ≈ 0.8~1.2
      ratioSum += r;
      if (dt > dp * 1.12 && r > 1.4) extended++;
    }
    const avg = ratioSum / 4;
    const thumbOut = dist(4, 17) / palm > 1.0 && dist(4, 5) / palm > 0.45;
    const openness = clamp((avg - 1.05) / (1.85 - 1.05));

    let gesture = 'neutral';
    if (extended >= 4 || (extended === 3 && thumbOut && avg > 1.6)) gesture = 'open';
    else if (extended === 0 && avg < 1.35) gesture = 'fist';
    return { gesture, openness };
  }

  class HandTracker {
    /**
     * @param {object} opts
     * @param {HTMLVideoElement} opts.video
     * @param {HTMLCanvasElement} opts.overlay  关键点绘制画布
     * @param {(g:string, info:object)=>void} opts.onGesture  手势确认切换时回调
     * @param {(info:object)=>void} opts.onFrame  每帧结果回调
     */
    constructor({ video, overlay, onGesture, onFrame }) {
      this.cfg = GG.config;
      this.video = video;
      this.overlay = overlay;
      this.octx = overlay.getContext('2d');
      this.onGesture = onGesture || (() => {});
      this.onFrame = onFrame || (() => {});
      this.running = false;
      this.busy = false;

      this.current = 'none';
      this.candidate = 'none';
      this.candCount = 0;
      this.candSince = 0;
      this.openness = 0;

      this.inferMs = 0;
      this.lastLatency = null;
      this.fps = 0;
      this._fpsCount = 0;
      this._fpsT = performance.now();
    }

    async start(onStatus = () => {}) {
      if (typeof window.Hands !== 'function') {
        throw new Error('MediaPipe Hands 脚本未能加载，请检查网络连接（需访问 cdn.jsdelivr.net）。');
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器不支持摄像头访问（getUserMedia）。');
      }

      onStatus('正在请求摄像头权限…');
      const cam = this.cfg.camera;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: cam.width },
          height: { ideal: cam.height },
          frameRate: { ideal: cam.frameRate },
        },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.aspect = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
      this.overlay.width = this.video.videoWidth || cam.width;
      this.overlay.height = this.video.videoHeight || cam.height;

      onStatus('正在加载手势模型…');
      const mp = this.cfg.mediapipe;
      this.hands = new window.Hands({ locateFile: (f) => mp.cdn + f });
      this.hands.setOptions({
        maxNumHands: mp.maxNumHands,
        modelComplexity: mp.modelComplexity,
        minDetectionConfidence: mp.minDetectionConfidence,
        minTrackingConfidence: mp.minTrackingConfidence,
        selfieMode: true, // 镜像，使关键点与镜像显示的预览画面一致
      });
      this.hands.onResults((res) => this._onResults(res));
      await this.hands.initialize();
      // 预热一帧，避免首次推理的编译开销计入交互
      await this.hands.send({ image: this.video });

      this.running = true;
      this._requestFrame();
      onStatus('ready');
    }

    stop() {
      this.running = false;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    }

    _requestFrame() {
      if (!this.running) return;
      if (this.video.requestVideoFrameCallback) {
        this.video.requestVideoFrameCallback(() => this._onVideoFrame());
      } else {
        requestAnimationFrame(() => this._onVideoFrame());
      }
    }

    _onVideoFrame() {
      if (!this.running) return;
      this._requestFrame();
      if (this.busy) return; // 推理未完成：丢帧，不排队
      if (!this.video.requestVideoFrameCallback) {
        if (this.video.currentTime === this._lastVT) return;
        this._lastVT = this.video.currentTime;
      }
      this._process();
    }

    async _process() {
      this.busy = true;
      this._sentAt = performance.now();
      try {
        await this.hands.send({ image: this.video });
      } catch (e) {
        console.warn('[gesture] send failed', e);
      } finally {
        this.busy = false;
      }
    }

    _onResults(res) {
      if (!this.running) return; // 预热帧
      const now = performance.now();
      this.inferMs = this.inferMs ? this.inferMs * 0.8 + (now - this._sentAt) * 0.2 : now - this._sentAt;

      this._fpsCount++;
      if (now - this._fpsT >= 1000) {
        this.fps = (this._fpsCount * 1000) / (now - this._fpsT);
        this._fpsCount = 0;
        this._fpsT = now;
      }

      const lms = res.multiHandLandmarks && res.multiHandLandmarks[0];
      let g = 'none';
      if (lms) {
        const c = classify(lms, this.aspect);
        g = c.gesture;
        this.openness = this.openness * 0.5 + c.openness * 0.5;
      }

      // 防抖：连续 N 帧一致才切换
      if (g === this.candidate) {
        this.candCount++;
      } else {
        this.candidate = g;
        this.candCount = 1;
        this.candSince = this._sentAt;
      }
      const need = g === 'none' ? this.cfg.gesture.lostFrames : this.cfg.gesture.stableFrames;
      if (this.candCount >= need && g !== this.current) {
        this.current = g;
        this.lastLatency = now - this.candSince;
        this.onGesture(g, { latency: this.lastLatency });
      }

      this._drawOverlay(lms);
      this.onFrame({
        gesture: this.current,
        raw: g,
        openness: this.openness,
        inferMs: this.inferMs,
        latency: this.lastLatency,
        fps: this.fps,
      });
    }

    _drawOverlay(lms) {
      const ctx = this.octx;
      const W = this.overlay.width;
      const H = this.overlay.height;
      ctx.clearRect(0, 0, W, H);
      if (!lms) return;
      const color = this.current === 'open' ? '#F3E3C3' : this.current === 'fist' ? '#E3B8AE' : '#E8EEE2';
      ctx.lineWidth = Math.max(2, W / 200);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lms[a].x * W, lms[a].y * H);
        ctx.lineTo(lms[b].x * W, lms[b].y * H);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (const p of lms) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, Math.max(2.5, W / 150), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  GG.HandTracker = HandTracker;
  GG.classifyHand = classify;
})();
