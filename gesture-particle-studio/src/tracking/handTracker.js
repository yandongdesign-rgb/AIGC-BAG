import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;

async function reachable(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') || '').includes('text/html');
  } catch {
    return false;
  }
}

/** MediaPipe Hand Landmarker（VIDEO 模式，21 关键点，最多 2 只手） */
export class HandTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.inferMs = 0;
    this.captureTime = null;
    this.frameCaptureTime = null;
    this.delegate = null;
  }

  async init(onStatus = () => {}) {
    const m = this.cfg.mediapipe;
    const localWasm = `${BASE}${m.wasmPath}`;
    const wasm = (await reachable(`${localWasm}/vision_wasm_internal.js`)) ? localWasm : m.wasmFallbackUrl;
    const localModel = `${BASE}${m.modelPath}`;
    const model = (await reachable(localModel)) ? localModel : m.modelFallbackUrl;
    onStatus(`加载 MediaPipe（${wasm === localWasm ? '本地' : 'CDN'}）…`);
    const fileset = await FilesetResolver.forVisionTasks(wasm);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numHands: this.cfg.maxHands,
      minHandDetectionConfidence: m.minHandDetectionConfidence,
      minHandPresenceConfidence: m.minHandPresenceConfidence,
      minTrackingConfidence: m.minTrackingConfidence,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts(m.delegate));
      this.delegate = m.delegate;
    } catch (err) {
      console.warn('GPU delegate 失败，回退 CPU', err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.delegate = 'CPU';
    }
  }

  async startCamera(video) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    this.aspect = video.videoWidth / video.videoHeight;
    if ('requestVideoFrameCallback' in video) {
      const onFrame = (_, meta) => {
        this.captureTime = meta.captureTime ?? null;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
    return stream;
  }

  /** 有新视频帧时推理；返回 null 表示没有新帧 */
  detect(video, now) {
    if (!this.landmarker || video.readyState < 2 || video.currentTime === this.lastVideoTime) return null;
    if (this._lastRun && now - this._lastRun < 1000 / this.cfg.maxInferenceFps - 1) return null;
    this._lastRun = now;
    this.lastVideoTime = video.currentTime;
    this.frameCaptureTime = this.captureTime;
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(video, now);
    this.inferMs = performance.now() - t0;
    return (res.landmarks || []).map((lm, i) => {
      const h = res.handedness?.[i]?.[0] || res.handednesses?.[i]?.[0];
      return { landmarks: lm, handedness: h?.categoryName || 'Left', score: h?.score ?? 1 };
    });
  }
}
