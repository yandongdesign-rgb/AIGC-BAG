import { clamp, damp, flow } from '../core/math.js';
import { effectRegistry } from './effects/index.js';

export const MAX_PARTICLES = 60000;

/**
 * 粒子池 + 特效调度。
 * - 池化：固定容量的 TypedArray，环形分配，零 GC。
 * - 槽位（slot）：每只手 / 双手中点各一个槽位，保存锚点与每种特效的平滑权重。
 * - 特效插件（effects/）负责生成、积分、绘制条带；权重在 transitionSeconds 内插值，可叠加。
 */
export class FxEngine {
  constructor(cfg, mapping) {
    this.cfg = cfg;
    this.mapping = mapping;
    this.cap = MAX_PARTICLES;
    this.limit = MAX_PARTICLES;
    const F = (n = 1) => new Float32Array(MAX_PARTICLES * n);
    Object.assign(this, {
      px: F(), py: F(), vx: F(), vy: F(), life: F(), maxLife: F(), size: F(), hue: F(),
      alpha: F(), white: F(), aux1: F(), aux2: F(), seed: F(),
      mode: new Uint8Array(MAX_PARTICLES), slot: new Uint8Array(MAX_PARTICLES),
    });
    for (let i = 0; i < MAX_PARTICLES; i++) this.seed[i] = Math.random() * 1000;
    this.aPos = F(3);
    this.aData = F(4);
    this.cursor = 0;
    this.alive = 0;
    this.time = 0;
    this.flash = 0;
    this.calm = 1;
    this.bounds = { w: 1.78, h: 1 };
    this.events = [];
    this.slots = Array.from({ length: 4 }, (_, i) => this._newSlot(i));
    this.slotByKey = new Map();
    this.effects = effectRegistry.list().map((def, index) => {
      const fx = def.create(cfg.effects[def.id] || {}, this);
      return { id: def.id, index, ...fx };
    });
    this.byId = Object.fromEntries(this.effects.map((e) => [e.id, e]));
  }

  _newSlot(i) {
    return { index: i, key: null, weights: {}, targets: {}, anchors: null, state: 'none', intensity: 0, radiusScale: 1, used: false };
  }

  /** 每帧由主循环调用：key 对应一只手或 'dual'；effects 为 [{id, weight}] */
  setSlot(key, { effects, anchors, state, intensity = 1, radiusScale = 1 }) {
    let s = this.slotByKey.get(key);
    if (!s) {
      s = this.slots.find((x) => !x.used);
      if (!s) return null;
      Object.assign(s, this._newSlot(s.index), { key, used: true });
      this.slotByKey.set(key, s);
    }
    s.targets = {};
    for (const e of effects) s.targets[e.id] = Math.max(s.targets[e.id] || 0, e.weight ?? 1);
    s.prevAnchors = s.anchors;
    s.anchors = anchors;
    s.state = state;
    s.intensity = intensity;
    s.radiusScale = radiusScale;
    s.seen = true;
    return s;
  }

  trigger(key, effectId, extra = {}) {
    const s = this.slotByKey.get(key);
    const fx = this.byId[effectId];
    if (s && fx?.onEnter) fx.onEnter(this, s, extra);
  }

  /** 分配一个粒子（池满时覆盖最旧的环形位置） */
  spawn(mode, slot, x, y, vx, vy, life, size, hue, alpha = 1, white = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    this.mode[i] = mode;
    this.slot[i] = slot;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.hue[i] = hue;
    this.alpha[i] = alpha;
    this.white[i] = white;
    return i;
  }

  /** 发射率倍率：随画质档位自动缩放 */
  get rateScale() {
    return clamp(this.limit / 30000, 0.35, 2);
  }

  setLimit(n) {
    n = clamp(Math.floor(n), 2000, MAX_PARTICLES);
    if (n < this.limit) for (let i = n; i < this.limit; i++) this.life[i] = 0;
    this.limit = n;
    if (this.cursor >= n) this.cursor = 0;
  }

  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    const tr = clamp(this.mapping.transitionSeconds ?? 0.45, 0.3, 0.6);
    this.events.length = 0;

    let anyHand = false;
    for (const s of this.slots) {
      if (!s.used) continue;
      if (!s.seen) s.targets = {};
      s.seen = false;
      let total = 0;
      for (const fx of this.effects) {
        const w = damp(s.weights[fx.id] || 0, s.targets[fx.id] || 0, tr, dt);
        s.weights[fx.id] = w < 0.002 && !s.targets[fx.id] ? 0 : w;
        total += s.weights[fx.id];
      }
      if (Object.keys(s.targets).length) anyHand = true;
      if (total === 0 && !Object.keys(s.targets).length) {
        this.slotByKey.delete(s.key);
        s.used = false;
      }
    }
    this.calm = damp(this.calm, anyHand ? 0 : 1, 1.2, dt);
    this.flash = damp(this.flash, 0, 0.35, dt);

    for (const fx of this.effects) fx.update?.(this, dt, t, ctx);

    const { px, py, vx, vy, life, maxLife, mode, aPos, aData } = this;
    const fxs = this.effects;
    const calm = this.calm;
    const idleIdx = this.byId.idle?.index ?? -1;
    const settle = (this.cfg.effects.idle?.settle ?? 0.8) * calm * dt;
    let alive = 0;
    for (let i = 0; i < this.limit; i++) {
      if (life[i] <= 0) {
        if (aData[i * 4 + 2] !== 0) aData[i * 4 + 2] = 0;
        continue;
      }
      life[i] -= dt;
      const m = mode[i];
      fxs[m].integrate(this, i, dt, t);
      if (calm > 0.01 && m !== idleIdx) {
        // 无手时：所有粒子缓慢回落并融入待机流场
        const [fx, fy] = flow(px[i], py[i], t);
        vx[i] += (fx * 0.05 - vx[i]) * settle;
        vy[i] += (fy * 0.05 - 0.04 - vy[i]) * settle;
        life[i] -= dt * calm * 0.6;
      }
      if (life[i] <= 0) {
        aData[i * 4 + 2] = 0;
        continue;
      }
      alive++;
      const k = life[i] / maxLife[i];
      const fade = Math.min(1, k * 4) * Math.min(1, (1 - k) * 12 + 0.15);
      aPos[i * 3] = px[i];
      aPos[i * 3 + 1] = py[i];
      aData[i * 4] = this.hue[i];
      aData[i * 4 + 1] = this.alpha[i] * fade;
      aData[i * 4 + 2] = this.size[i] * (0.45 + 0.55 * k);
      aData[i * 4 + 3] = this.white[i];
    }
    this.alive = alive;
  }

  drawStrips(batch) {
    for (const fx of this.effects) fx.draw?.(this, batch);
  }

  /** 释放粒子：转为通用自由运动模式 */
  release(i) {
    this.mode[i] = this.byId.free.index;
  }
}
