import { buildHand } from './handModel.js';

/**
 * 演示模式：无摄像头时用合成的 21 关键点手驱动完整管线。
 * auto：自动巡演全部手势；manual：数字键选手势，鼠标控制位置。
 */
const TOUR = [
  { id: 'open_palm', dur: 4.5 },
  { id: 'fist', dur: 4.5 },
  { id: 'point', dur: 4.5 },
  { id: 'pinch', dur: 4.5 },
  { id: 'palm_up', dur: 4.5 },
  { id: 'dual', dur: 5 },
  { id: 'none', dur: 3 },
];
export const DEMO_KEYS = { 1: 'open_palm', 2: 'fist', 3: 'point', 4: 'pinch', 5: 'palm_up', 6: 'dual', 0: 'none' };

export class SimulatedHands {
  constructor() {
    this.mode = 'auto';
    this.t = 0;
    this.segT = 0;
    this.seg = 0;
    this.manual = 'open_palm';
    this.mouse = { x: 0.5, y: 0.5 };
    this.hold = false; // true：自动运动但锁定当前手势（录屏 / 截图用）
  }

  get current() {
    return this.mode === 'auto' ? TOUR[this.seg].id : this.manual;
  }

  jump(id) {
    const i = TOUR.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.seg = i;
      this.segT = 0;
    }
  }

  update(dt, aspect) {
    this.t += dt;
    this.segT += dt;
    if (this.mode === 'auto' && !this.hold && this.segT > TOUR[this.seg].dur) {
      this.seg = (this.seg + 1) % TOUR.length;
      this.segT = 0;
    }
    const id = this.current;
    const s = this.segT;
    const t = this.t;
    const auto = this.mode === 'auto';
    const base = auto ? null : this.mouse;
    const hand = (pose, u, v, extra = {}) =>
      buildHand({ pose, center: { x: 1 - u, y: v }, scale: 0.24, aspect, jitter: 0.0015, actualRight: true, ...extra });

    switch (id) {
      case 'open_palm': {
        const u = base ? base.x : 0.5 + 0.28 * Math.sin(t * 1.3);
        const v = base ? base.y : 0.5 + 0.17 * Math.sin(t * 2.6);
        return [hand('open_palm', u, v, { roll: 12 * Math.sin(t * 1.3) })];
      }
      case 'fist': {
        const phase = s % 1.8;
        const pose = phase < 0.7 ? 'open_palm' : 'fist';
        const u = base ? base.x : 0.5 + 0.12 * Math.sin(t * 0.8);
        const v = base ? base.y : 0.52;
        return [hand(pose, u, v)];
      }
      case 'point': {
        const u = base ? base.x : 0.35 + 0.08 * Math.sin(t * 1.1);
        const v = base ? base.y : 0.6 + 0.08 * Math.sin(t * 1.7);
        return [hand('point', u, v, { roll: -60 + 25 * Math.sin(t * 1.2) })];
      }
      case 'pinch': {
        const u = base ? base.x : 0.5 + 0.18 * Math.cos(t * 1.1);
        const v = base ? base.y : 0.55 + 0.12 * Math.sin(t * 1.1);
        return [hand('pinch', u, v, { roll: -15 })];
      }
      case 'palm_up': {
        const k = (s % 2.6) / 2.6;
        const u = base ? base.x : 0.5 + 0.1 * Math.sin(t * 0.7);
        const v = base ? base.y + 0.1 - 0.2 * k : 0.85 - 0.45 * k;
        return [hand('palm_up', u, v)];
      }
      case 'dual': {
        const spread = base ? Math.abs(base.x - 0.5) + 0.06 : 0.07 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.4));
        const v = base ? base.y : 0.55;
        return [
          hand('open_palm', 0.5 - spread, v, { actualRight: false, roll: -15 }),
          hand('open_palm', 0.5 + spread, v, { roll: 15 }),
        ];
      }
      default:
        return [];
    }
  }
}
