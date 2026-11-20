/**
 * 摄像头 + MediaPipe HandLandmarker（21 关键点、左右手、置信度）
 * 输出两个 HandState 槽位（slot 0 / 1），并做：关键点滤波 → 特征提取 → 规则分类 → 防抖。
 */
import { LandmarkFilter } from '../core/filters.js';
import { extractFeatures, classify, GestureStabilizer } from '../gesture/classifier.js';
import { createHandSlot, updateKinematics, setGesture, fillFromLandmarks } from './handState.js';
import { dist2 } from '../core/math.js';

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

export class HandTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.slots = [createHandSlot(0), createHandSlot(1)];
    this.filters = [new LandmarkFilter(cfg.tracking.smoothing), new LandmarkFilter(cfg.tracking.smoothing)];
    this.stabs = [new GestureStabilizer(cfg), new GestureStabilizer(cfg)];
    this.video = null;
    this.lastVideoTime = -1;
    this.detectMs = 0;
    this.captureTime = 0;      // 当前帧的摄像头采集时刻（performance.now 时基）
    this.processedCapture = 0; // 最近一次已处理帧的采集时刻
    this.events = [];          // 手势切换事件
    this.source = 'camera';
  }

  async init(onStatus = () => {}) {
    const t = this.cfg.tracking;
    let paths = t;
    if (await exists(t.localVendor.modelPath)) { paths = t.localVendor; onStatus('使用本地 vendor 依赖'); }
    onStatus('加载 MediaPipe 模块…');
    const vision = await import(/* @vite-ignore */ paths.modulePath);
    const fileset = await vision.FilesetResolver.forVisionTasks(paths.wasmPath);
    onStatus('加载手部模型…');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: paths.modelPath, delegate },
      runningMode: 'VIDEO',
      numHands: t.numHands,
      minHandDetectionConfidence: t.minDetectionConfidence,
      minHandPresenceConfidence: t.minPresenceConfidence,
      minTrackingConfidence: t.minTrackingConfidence,
    });
    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts(t.delegate));
    } catch (e) {
      console.warn('GPU delegate 失败，回退 CPU', e);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  async startCamera(video) {
    const c = this.cfg.camera;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: c.width }, height: { ideal: c.height }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    this.video = video;
    // 用 requestVideoFrameCallback 拿到真实采集时间，用于测量端到端延迟
    if ('requestVideoFrameCallback' in video) {
      const cb = (now, meta) => {
        this.captureTime = meta.captureTime || meta.presentationTime || now;
        video.requestVideoFrameCallback(cb);
      };
      video.requestVideoFrameCallback(cb);
    }
  }

  /** 屏幕映射：cover 适配 + 中心区域扩展 + 镜像 */
  mapper(W, H) {
    const v = this.video, m = this.cfg.tracking.inputMargin, mirror = this.cfg.camera.mirror;
    const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    return (p) => {
      let nx = mirror ? 1 - p.x : p.x;
      nx = (nx - m) / (1 - 2 * m);
      const ny = (p.y - m) / (1 - 2 * m);
      return { x: ox + nx * vw * s, y: oy + ny * vh * s, z: (p.z || 0) * vw * s };
    };
  }

  /** 每个渲染帧调用；有新视频帧才做检测 */
  update(now, dt, W, H) {
    this.events.length = 0;
    const v = this.video;
    if (!v || !this.landmarker || v.readyState < 2) return this.slots;
    if (v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      const res = this.landmarker.detectForVideo(v, now);
      this.detectMs = performance.now() - t0;
      this.lastResult = res;
      this.newFrame = true;
      this.processedCapture = this.captureTime || t0;
      this.frameDt = this._lastDetect ? (t0 - this._lastDetect) / 1000 : 1 / 30;
      this._lastDetect = t0;
      this.ingest(res, now, W, H);
    }
    // 丢失判定
    for (let i = 0; i < 2; i++) {
      const h = this.slots[i];
      if (h.present && (now - h.lastSeen) / 1000 > this.cfg.tracking.lostTimeout) {
        h.present = false; h._prevPalm = null;
        this.filters[i].reset(); this.stabs[i].reset();
        if (setGesture(h, 'NONE', now)) this.events.push({ slot: i, from: h.prevGesture, to: 'NONE' });
      }
    }
    return this.slots;
  }

  ingest(res, now, W, H) {
    const map = this.mapper(W, H);
    const hands = (res.landmarks || []).map((lm, i) => {
      const hd = res.handednesses?.[i]?.[0] || res.handedness?.[i]?.[0];
      return { px: lm.map(map), world: res.worldLandmarks?.[i], label: hd?.categoryName || '', score: hd?.score ?? 1 };
    }).filter((h) => h.score >= this.cfg.tracking.minDetectionConfidence * 0.8);

    // 槽位分配：按与上一帧手掌位置的最近距离贪心匹配，保证左右手不“串号”
    const used = new Set();
    const assign = [];
    for (const hand of hands) {
      let best = -1, bd = Infinity;
      for (let s = 0; s < 2; s++) {
        if (used.has(s)) continue;
        const slot = this.slots[s];
        const d = slot.present ? dist2(slot.palm, hand.px[9]) : 1e6 + s;
        if (d < bd) { bd = d; best = s; }
      }
      if (best >= 0) { used.add(best); assign.push([best, hand]); }
    }

    const dt = Math.min(0.1, this.frameDt || 1 / 30);
    for (const [s, hand] of assign) {
      const h = this.slots[s];
      if (!h.present) { this.filters[s].reset(); h._prevPalm = null; }
      const lm = this.filters[s].apply(hand.px, dt);
      const f = extractFeatures(lm, hand.world, hand.label, this.cfg, h.rawGesture);
      fillFromLandmarks(h, lm, f);
      updateKinematics(h, dt);
      f.liftSpeed = h.liftSpeed;
      h.rawGesture = classify(f, this.cfg);
      const stable = this.stabs[s].push(h.rawGesture);
      h.present = true; h.lastSeen = now; h.label = hand.label; h.confidence = hand.score;
      if (setGesture(h, stable, now)) this.events.push({ slot: s, from: h.prevGesture, to: stable });
    }
  }

  stop() { this.video?.srcObject?.getTracks().forEach((t) => t.stop()); }
}
