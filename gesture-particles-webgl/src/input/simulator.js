/**
 * 无摄像头时的输入模拟器（同样输出 HandState）
 *  - 鼠标/触摸 = 手掌位置；数字键切换手势
 *  - ?demo=1 自动演示脚本（用于录屏、展台循环播放）
 */
import { createHandSlot, updateKinematics, setGesture } from './handState.js';

const FAN = [ // [角度°(屏幕坐标，-90 为正上), 长度(×手掌尺寸)]
  [-150, 0.95], [-112, 1.3], [-90, 1.4], [-70, 1.28], [-50, 1.05],
];

/** 根据手势生成一只“虚拟手”的几何 */
function shapeHand(h, g, rot, t) {
  const s = h.handSize, p = h.palm;
  const wob = Math.sin(t * 7.3 + h.slot) * 0.04;
  const ext = {
    OPEN_PALM: [1, 1, 1, 1, 1], PALM_UP: [1, 1, 1, 1, 1], FIST: [0.35, 0.4, 0.4, 0.4, 0.4],
    POINT: [0.45, 1.35, 0.4, 0.4, 0.4], PINCH: [0.8, 0.9, 1, 1, 1], VICTORY: [0.45, 1.3, 1.3, 0.4, 0.4],
    UNKNOWN: [0.7, 0.8, 0.8, 0.7, 0.6], NONE: [1, 1, 1, 1, 1],
  }[g] || [1, 1, 1, 1, 1];
  FAN.forEach(([a, len], i) => {
    const ang = ((a + rot) * Math.PI) / 180 + wob;
    const L = len * ext[i] * s;
    h.tips[i].x = p.x + Math.cos(ang) * L;
    h.tips[i].y = p.y + Math.sin(ang) * L;
  });
  if (g === 'PINCH') {
    const ang = ((-125 + rot) * Math.PI) / 180;
    const q = { x: p.x + Math.cos(ang) * 0.95 * s, y: p.y + Math.sin(ang) * 0.95 * s };
    h.tips[0] = { ...q }; h.tips[1] = { x: q.x + 2, y: q.y + 2 };
  }
  h.indexTip.x = h.tips[1].x; h.indexTip.y = h.tips[1].y;
  const ia = ((-112 + rot) * Math.PI) / 180;
  h.indexDir.x = Math.cos(ia); h.indexDir.y = Math.sin(ia);
  h.pinch.x = (h.tips[0].x + h.tips[1].x) / 2; h.pinch.y = (h.tips[0].y + h.tips[1].y) / 2;
  h.pinchRatio = g === 'PINCH' ? 0.1 : 0.8;
  h.palmUpScore = g === 'PALM_UP' ? 0.9 : 0;
}

const KEYMAP = { Digit1: 'OPEN_PALM', Digit2: 'FIST', Digit3: 'POINT', Digit4: 'PINCH', Digit5: 'PALM_UP', Digit7: 'VICTORY', Digit0: 'NONE' };

export class Simulator {
  constructor(cfg, { demo = false } = {}) {
    this.cfg = cfg;
    this.demo = demo;
    this.source = demo ? 'demo' : 'mouse';
    this.slots = [createHandSlot(0), createHandSlot(1)];
    this.events = [];
    this.detectMs = 0;
    this.mouse = { x: innerWidth * 0.5, y: innerHeight * 0.55 };
    this.want = ['OPEN_PALM', 'OPEN_PALM'];
    this.second = false;
    // ?demoStart=秒：从时间轴某处开始（录屏截图用）
    this.t0 = performance.now() - (+new URLSearchParams(location.search).get('demoStart') || 0) * 1000;
    if (!demo) this.bind();
  }

  bind() {
    const mv = (e) => { const p = e.touches ? e.touches[0] : e; this.mouse.x = p.clientX; this.mouse.y = p.clientY; };
    addEventListener('pointermove', mv);
    addEventListener('touchmove', mv, { passive: true });
    addEventListener('keydown', (e) => {
      const g = KEYMAP[e.code];
      if (g) { this.want[e.shiftKey ? 1 : 0] = g; if (!e.shiftKey && !this.second) this.want[1] = g; }
      if (e.code === 'Digit6') this.second = !this.second;
    });
    // 鼠标按下 = 握拳，松开恢复（方便快速测试爆炸）
    addEventListener('pointerdown', (e) => { if (e.target.tagName === 'CANVAS') { this._held = this.want[0]; this.want[0] = 'FIST'; } });
    addEventListener('pointerup', () => { if (this._held) { this.want[0] = this._held; this._held = null; } });
  }

  /** 自动演示脚本：返回 [手A手势, 手B手势|null, 位置A, 位置B, 旋转] */
  script(t, W, H) {
    const T = t % 34;
    const cx = W / 2, cy = H / 2;
    const fig8 = (k, sx = 0.32, sy = 0.22) => ({ x: cx + Math.sin(k) * W * sx, y: cy + Math.sin(k * 2) * H * sy });
    if (T < 4) return ['OPEN_PALM', null, fig8(T * 1.6), null, Math.sin(T * 3) * 15];
    if (T < 8.5) {
      const seq = [[4, 'FIST'], [5.1, 'OPEN_PALM'], [5.6, 'FIST'], [6.6, 'OPEN_PALM'], [7.0, 'FIST']];
      let g = 'FIST'; for (const [s, gg] of seq) if (T >= s) g = gg;
      const k = Math.floor((T - 4) / 1.0);
      const pts = [[0.35, 0.5], [0.62, 0.42], [0.5, 0.6], [0.4, 0.38], [0.6, 0.58]];
      const q = pts[k % pts.length];
      return [g, null, { x: W * q[0], y: H * q[1] }, null, 0];
    }
    if (T < 12.5) return ['POINT', null, { x: cx - W * 0.15 + Math.sin(T) * 60, y: cy + H * 0.18 }, null, Math.sin(T * 0.9) * 55 + 20];
    if (T < 16.5) return ['PINCH', null, { x: cx + Math.cos(T * 1.2) * W * 0.18, y: cy + Math.sin(T * 1.2) * H * 0.15 }, null, 0];
    if (T < 20.5) { const k = (T - 16.5) / 4; return ['PALM_UP', null, { x: cx + Math.sin(T) * 80, y: H * (0.85 - 0.4 * k) }, null, 0]; }
    if (T < 24.5) {
      const d = W * (0.12 + 0.18 * (0.5 + 0.5 * Math.sin((T - 20.5) * 1.6)));
      return ['PINCH', 'PINCH', { x: cx - d, y: cy }, { x: cx + d, y: cy }, 0];
    }
    if (T < 28.5) return ['POINT', 'OPEN_PALM', { x: W * 0.28, y: cy + 40 + Math.sin(T * 2) * 40 }, { x: W * 0.72 + Math.sin(T * 2.2) * 60, y: cy - 30 + Math.cos(T * 1.7) * 70 }, 60];
    if (T < 31) return ['NONE', null, { x: cx, y: cy }, null, 0];
    return ['VICTORY', null, { x: cx + Math.sin(T * 2) * 120, y: cy }, null, 0];
  }

  update(now, dt, W, H) {
    this.events.length = 0;
    const t = (now - this.t0) / 1000;
    window.__demoT = t; // 供录屏脚本对齐时间轴
    let gA, gB, pA, pB, rot = 0;
    if (this.demo) {
      [gA, gB, pA, pB, rot] = this.script(t, W, H);
    } else {
      gA = this.want[0]; pA = this.mouse;
      if (this.second) { gB = this.want[1]; pB = { x: W - this.mouse.x, y: this.mouse.y }; }
      rot = gA === 'POINT' ? (this.mouse.x / W - 0.5) * 110 : 0;
    }
    const plan = [[gA, pA, rot], [gB, pB, gB === 'POINT' ? -rot : 0]];
    plan.forEach(([g, p, r], i) => {
      const h = this.slots[i];
      const present = g && g !== 'NONE';
      if (!present) {
        if (h.present) { h.present = false; h._prevPalm = null; }
        if (setGesture(h, 'NONE', now)) this.events.push({ slot: i, from: h.prevGesture, to: 'NONE' });
        return;
      }
      h.present = true; h.confidence = 1; h.label = i ? 'Right' : 'Left';
      h.handSize = Math.min(W, H) * 0.13;
      h.palm.x += (p.x - h.palm.x) * (h._prevPalm ? 0.35 : 1);
      h.palm.y += (p.y - h.palm.y) * (h._prevPalm ? 0.35 : 1);
      updateKinematics(h, dt);
      shapeHand(h, g, r, t);
      h.rawGesture = g;
      if (setGesture(h, g, now)) this.events.push({ slot: i, from: h.prevGesture, to: g });
    });
    return this.slots;
  }
}
