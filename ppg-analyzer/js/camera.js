/**
 * 后置摄像头采集：每帧计算中心 ROI 的 R/G/B 均值
 * 优先使用 requestVideoFrameCallback（真实帧时间戳），否则退化为 requestAnimationFrame + 去重
 */

export class CameraSource {
  constructor(videoEl) {
    this.video = videoEl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 40;
    this.canvas.height = 30;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.running = false;
    this.torchOn = false;
    this.onFrame = null; // (t_seconds, r, g, b) => void
    this.roiRatio = 0.5;
  }

  async start({ torch = true, roiRatio = 0.5 } = {}) {
    this.roiRatio = roiRatio;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问，请使用 HTTPS 打开，并使用新版 Chrome / Safari / 微信内置浏览器');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.track = this.stream.getVideoTracks()[0];
    if (torch) await this.setTorch(true);
    this.running = true;
    this._loop();
  }

  /** 闪光灯：Android Chrome 支持；iOS Safari 多数版本不支持，会静默失败 */
  async setTorch(on) {
    try {
      const caps = this.track?.getCapabilities?.() || {};
      if (!caps.torch) { this.torchOn = false; return false; }
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      this.torchOn = on;
      return true;
    } catch (_) {
      this.torchOn = false;
      return false;
    }
  }

  get torchSupported() {
    try { return !!this.track?.getCapabilities?.().torch; } catch (_) { return false; }
  }

  _sample(tSec) {
    const { video, ctx, canvas } = this;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const rw = vw * this.roiRatio, rh = vh * this.roiRatio;
    ctx.drawImage(video, (vw - rw) / 2, (vh - rh) / 2, rw, rh, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    this.onFrame?.(tSec, r / n, g / n, b / n);
  }

  _loop() {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const cb = (now, meta) => {
        if (!this.running) return;
        // captureTime 为传感器采集时刻（若可用），更准确
        const ts = (meta.captureTime ?? meta.expectedDisplayTime ?? now) / 1000;
        this._sample(ts);
        this.video.requestVideoFrameCallback(cb);
      };
      this.video.requestVideoFrameCallback(cb);
    } else {
      let lastVT = -1;
      const cb = () => {
        if (!this.running) return;
        if (this.video.currentTime !== lastVT) {
          lastVT = this.video.currentTime;
          this._sample(performance.now() / 1000);
        }
        requestAnimationFrame(cb);
      };
      requestAnimationFrame(cb);
    }
  }

  stop() {
    this.running = false;
    if (this.torchOn) this.setTorch(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
