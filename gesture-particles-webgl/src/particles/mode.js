/**
 * 粒子模式基类。新增模式：继承 Mode，实现 onEnter / onExit / update，然后
 *   Registry.registerMode('myMode', MyMode)
 * 并在 config.mapping 里把某个手势指向 'myMode'。
 *
 * ctx（共享上下文）提供：
 *   pool       粒子池（pool.emit({...})）
 *   renderer   渲染器（renderer.flash() / renderer.shake()）
 *   sound(layer, event, params)  触发音效事件
 *   theme      当前配色   W/H 屏幕尺寸   time 秒
 *   quality    当前性能档位 { emission, ... }
 *   dualScale  双手距离缩放系数（单手时 = 1）
 *   otherHand(slot)  另一只手（不存在返回 null）
 *   audioParams 写入给音效层的实时参数
 */
export class Mode {
  constructor(ctx, params, key) {
    this.ctx = ctx;
    this.p = params || {};
    this.key = key;
    this.weight = 0;   // 0~1 平滑过渡后的权重（参数插值用它）
    this.target = 0;
    this.hand = null;
    this.activeTime = 0;
    this._acc = 0;
  }
  /** 手势进入时调用一次 */
  onEnter(hand) {}
  /** 手势离开时调用一次（之后仍会以递减权重继续 update 直到淡出） */
  onExit(hand) {}
  /** 每帧调用。w = 缓动后的权重（0~1） */
  update(dt, hand, w) {}

  /** 按“每秒数量”计算本帧应发射个数（自动乘性能档位系数） */
  count(perSec, dt) {
    this._acc += perSec * dt * this.ctx.quality.emission;
    const n = Math.floor(this._acc);
    this._acc -= n;
    return n;
  }
}

/** 管理所有模式实例的激活 / 淡入淡出 / 叠加 */
export class ModeManager {
  constructor(ctx, registry, cfg) {
    this.ctx = ctx; this.registry = registry; this.cfg = cfg;
    this.instances = new Map();
  }

  /**
   * desired: Map<key, { modeId, hand }>
   * key 形如 'trail@0'（每只手一份实例）、'ambient@g'（全局）
   */
  update(dt, desired) {
    const { fadeIn, fadeOut } = this.cfg.transition;
    for (const [key, d] of desired) {
      let inst = this.instances.get(key);
      if (!inst) {
        const Cls = this.registry.getMode(d.modeId);
        if (!Cls) continue;
        inst = new Cls(this.ctx, this.cfg.particles[d.modeId], key);
        inst.modeId = d.modeId;
        this.instances.set(key, inst);
      }
      if (inst.target === 0) { inst.target = 1; inst.activeTime = 0; inst.onEnter(d.hand); }
      inst.hand = d.hand;
    }
    for (const [key, inst] of this.instances) {
      if (!desired.has(key) && inst.target === 1) {
        inst.target = 0;
        inst.onExit(inst.hand);
        inst.hand = inst.hand ? snapshot(inst.hand) : null; // 冻结最后位置用于淡出
      }
      const rate = inst.target > inst.weight ? 1 / fadeIn : 1 / fadeOut;
      inst.weight += Math.sign(inst.target - inst.weight) * Math.min(Math.abs(inst.target - inst.weight), rate * dt);
      if (inst.weight <= 0 && inst.target === 0) continue;
      inst.activeTime += dt;
      const w = inst.weight * inst.weight * (3 - 2 * inst.weight); // smoothstep 缓动
      inst.update(dt, inst.hand, w);
    }
  }

  /** 每个模式当前权重（供 HUD / 音效） */
  weights() {
    const out = {};
    for (const inst of this.instances.values()) out[inst.modeId] = Math.max(out[inst.modeId] || 0, inst.weight);
    return out;
  }
}

function snapshot(h) {
  return {
    ...h,
    palm: { ...h.palm }, tips: h.tips.map((t) => ({ ...t })), indexTip: { ...h.indexTip },
    indexDir: { ...h.indexDir }, pinch: { ...h.pinch }, vel: { x: 0, y: 0 }, speed: 0, lm: null, frozen: true,
  };
}
