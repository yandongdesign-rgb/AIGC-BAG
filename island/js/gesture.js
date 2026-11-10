// 手势识别：MediaPipe GestureRecognizer（摄像头） → 语义手势 + 掌心/指尖位置 + 手速
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const MAP = { Open_Palm: 'palm', Closed_Fist: 'fist', Pointing_Up: 'point', Victory: 'victory', Thumb_Up: 'thumbUp', Thumb_Down: 'thumbDown', ILoveYou: 'love', None: 'none' };
export const GESTURE_LABEL = {
  palm: '🖐 张开手掌 · 前进', fist: '✊ 握拳 · 停下/握住', point: '☝️ 食指 · 瞄准/转向', pinch: '🤏 捏合 · 拾取',
  victory: '✌️ 剪刀手 · 拍照', thumbUp: '👍 点赞 · 跳跃', thumbDown: '👎 倒赞 · 收进背包/坐下', love: '🤟 摇滚手势 · 使用/呼唤海鸥', none: '…', run: '🖐🖐 双手张开 · 奔跑',
};

export class GestureInput {
  constructor(video, canvas) {
    this.video = video; this.canvas = canvas; this.g = canvas.getContext('2d');
    this.ready = false; this.hands = []; this.primary = null; this.lastT = 0;
    this.stable = 'none'; this.cand = 'none'; this.candT = 0; this.since = 0;
    this.hist = []; // 掌心轨迹 {t,x,y,s}
    this.smooth = { x: 0.5, y: 0.5, ix: 0.5, iy: 0.5 };
  }
  async init(onStatus) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不允许访问摄像头：请通过 https 或 http://localhost 打开');
    onStatus?.('正在请求摄像头权限…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = stream; await this.video.play();
    onStatus?.('正在加载手势识别模型（约 8MB）…');
    const { GestureRecognizer, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { this.rec = await GestureRecognizer.createFromOptions(fileset, opts('GPU')); }
    catch (e) { this.rec = await GestureRecognizer.createFromOptions(fileset, opts('CPU')); }
    this.ready = true; onStatus?.('手势已就绪');
  }
  update(now) {
    if (!this.ready || this.video.readyState < 2) return;
    if (now - this.lastT < 33) return; // ~30fps
    this.lastT = now;
    let res;
    try { res = this.rec.recognizeForVideo(this.video, now); } catch (e) { return; }
    this.hands = (res.landmarks || []).map((lm, i) => {
      const cat = res.gestures?.[i]?.[0];
      const P = (k) => ({ x: 1 - lm[k].x, y: lm[k].y }); // 镜像
      const wrist = P(0), mid = P(9), thumb = P(4), index = P(8);
      const scale = Math.hypot(wrist.x - mid.x, wrist.y - mid.y) || 0.1;
      const pinchD = Math.hypot(thumb.x - index.x, thumb.y - index.y) / scale;
      let g = MAP[cat?.categoryName] || 'none';
      // 捏合：拇指食指尖相碰，且其余手指不是全握
      if (pinchD < 0.33 && g !== 'fist') g = 'pinch';
      const palm = { x: (P(0).x + P(5).x + P(17).x + P(9).x) / 4, y: (P(0).y + P(5).y + P(17).y + P(9).y) / 4 };
      return { g, score: cat?.score || 0, lm, palm, index, scale, handed: res.handedness?.[i]?.[0]?.categoryName };
    });
    // 主手：面积最大
    this.primary = this.hands.slice().sort((a, b) => b.scale - a.scale)[0] || null;
    let g = this.primary ? this.primary.g : 'none';
    if (this.hands.length === 2 && this.hands.every((h) => h.g === 'palm')) g = 'run';
    // 防抖：持续 2 帧才切换（捏合/握拳更灵敏）
    if (g === this.cand) this.candT++; else { this.cand = g; this.candT = 1; }
    const need = g === 'pinch' || g === 'fist' || g === 'palm' ? 2 : 4;
    if (this.candT >= need && this.stable !== g) { this.prevStable = this.stable; this.stable = g; this.since = now; this.changed = true; }
    if (this.primary) {
      const k = 0.5;
      this.smooth.x += (this.primary.palm.x - this.smooth.x) * k; this.smooth.y += (this.primary.palm.y - this.smooth.y) * k;
      this.smooth.ix += (this.primary.index.x - this.smooth.ix) * k; this.smooth.iy += (this.primary.index.y - this.smooth.iy) * k;
      this.hist.push({ t: now, x: this.primary.palm.x, y: this.primary.palm.y, s: this.primary.scale });
    }
    while (this.hist.length && now - this.hist[0].t > 220) this.hist.shift();
    this.draw();
  }
  // 最近 ~0.2s 的手部速度（归一化坐标/秒；z 为靠近镜头的速度）
  velocity() {
    const h = this.hist; if (h.length < 2) return { x: 0, y: 0, z: 0, mag: 0 };
    const a = h[0], b = h[h.length - 1], dt = Math.max(0.03, (b.t - a.t) / 1000);
    const v = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.s - a.s) / dt * 3 };
    v.mag = Math.hypot(v.x, v.y, v.z); return v;
  }
  consumeChange() { const c = this.changed; this.changed = false; return c; }
  heldFor(now) { return now - this.since; }
  draw() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.save(); g.scale(-1, 1); g.translate(-W, 0); g.drawImage(this.video, 0, 0, W, H); g.restore();
    g.fillStyle = 'rgba(0,20,40,0.25)'; g.fillRect(0, 0, W, H);
    const bones = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    for (const hand of this.hands) {
      const pt = (k) => [(1 - hand.lm[k].x) * W, hand.lm[k].y * H];
      g.strokeStyle = hand === this.primary ? '#7ff5d4' : '#9fc4ff'; g.lineWidth = 2;
      for (const [a, b] of bones) { const [x1, y1] = pt(a), [x2, y2] = pt(b); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      g.fillStyle = '#fff';
      for (let k = 0; k < 21; k++) { const [x, y] = pt(k); g.beginPath(); g.arc(x, y, k === 8 || k === 4 ? 3.5 : 2, 0, 6.28); g.fill(); }
    }
    // 死区示意
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([4, 4]);
    g.strokeRect(W * 0.38, H * 0.33, W * 0.24, H * 0.3); g.setLineDash([]);
  }
}
