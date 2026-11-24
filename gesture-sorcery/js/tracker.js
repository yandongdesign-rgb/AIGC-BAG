// MediaPipe Hand Landmarker：离线加载（模型与 WASM 以 base64 打包，支持 file:// 双击运行）
(function () {
  const SG = window.SG;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(); s.onerror = () => reject(new Error('无法加载 ' + src));
      document.head.appendChild(s);
    });
  }
  async function b64ToBytes(b64, type) {
    const res = await fetch(`data:${type};base64,${b64}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  class Tracker {
    constructor(cfg) { this.cfg = cfg; this.landmarker = null; this.lastVideoTime = -1; this.ms = 0; this.delegate = ''; }

    async load(progress) {
      const step = (p, t) => progress && progress(p, t);
      step(0.05, '加载识别引擎…');
      if (!window.MPVision) await loadScript('js/vendor/vision_bundle.js');
      if (!window.__SorceryModuleFactory) await loadScript('js/vendor/vision_wasm_internal.js');
      step(0.25, '加载 WebAssembly（约 9 MB）…');
      if (!window.SORCERY_WASM_B64) await loadScript('js/vendor/wasm-pack.js');
      step(0.55, '加载手部模型（约 7.5 MB）…');
      if (!window.SORCERY_MODEL_B64) await loadScript('js/vendor/model-pack.js');
      step(0.75, '解码…');
      const wasm = await b64ToBytes(window.SORCERY_WASM_B64, 'application/wasm');
      const model = await b64ToBytes(window.SORCERY_MODEL_B64, 'application/octet-stream');
      window.SORCERY_WASM_B64 = window.SORCERY_MODEL_B64 = null; // 释放内存
      const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
      // 加载器脚本已通过 <script> 注入，这里给 MediaPipe 一个空脚本，避免它以 CORS 方式再次请求本地文件
      const fileset = { wasmLoaderPath: 'data:text/javascript,void 0', wasmBinaryPath: wasmUrl };
      const { HandLandmarker } = window.MPVision;
      const opts = (delegate) => ({
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numHands: this.cfg.numHands,
        minHandDetectionConfidence: this.cfg.minDetection,
        minHandPresenceConfidence: this.cfg.minPresence,
        minTrackingConfidence: this.cfg.minTracking,
      });
      step(0.85, '初始化 GPU 推理…');
      for (const delegate of ['GPU', 'CPU']) {
        try {
          window.ModuleFactory = window.__SorceryModuleFactory;
          this.landmarker = await HandLandmarker.createFromOptions(fileset, opts(delegate));
          this.delegate = delegate;
          break;
        } catch (e) {
          console.warn('HandLandmarker 初始化失败（' + delegate + '）', e);
          if (delegate === 'CPU') throw e;
        }
      }
      step(1, '模型就绪');
    }

    async startCamera(video) {
      const c = SG.CONFIG.camera;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: c.width }, height: { ideal: c.height }, frameRate: { ideal: c.fps }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      this.video = video;
    }

    detect(now) {
      const v = this.video;
      if (!this.landmarker || !v || v.readyState < 2) return null;
      if (v.currentTime === this.lastVideoTime) return null;
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      const r = this.landmarker.detectForVideo(v, now);
      this.ms = this.ms * 0.85 + (performance.now() - t0) * 0.15;
      const out = [];
      if (r && r.landmarks) for (let i = 0; i < r.landmarks.length; i++) out.push({ lm: r.landmarks[i], label: r.handedness && r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].categoryName : '' });
      return out;
    }
  }

  SG.Tracker = Tracker;
})();
