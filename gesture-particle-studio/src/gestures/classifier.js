import { createRegistry } from '../core/registry.js';

/**
 * 规则分类器：按 priority 从小到大依次判定，第一个命中的规则即为结果。
 * 新手势：gestureRules.register('my_gesture', { priority, test(f, ctx) { ... } })
 * 并在 public/config/gestures.json 的 gestures 中加入同名条目绑定特效/音效。
 *
 * ctx: { prev, mem, now, rise, cfg }，rise 为掌心向上速度（掌长/秒）。
 */
export const gestureRules = createRegistry('gesture');

gestureRules
  .register('pinch', {
    priority: 10,
    test: (f, { prev, cfg }) => {
      const thr = prev === 'pinch' ? cfg.pinch.exit : cfg.pinch.enter;
      return f.pinchRatio < thr && f.indexReach > cfg.pinch.minIndexReach;
    },
  })
  .register('fist', {
    priority: 20,
    test: (f) => f.extendedCount === 0 && !f.thumbOpen,
  })
  .register('point', {
    priority: 30,
    test: (f) => f.extended[0] && !f.extended[1] && !f.extended[2] && !f.extended[3],
  })
  .register('palm_up', {
    priority: 40,
    test: (f, { prev, mem, now, rise, cfg }) => {
      if (f.extendedCount < 4) return false;
      const c = cfg.palmUp;
      const facingUp = f.normalUp > (prev === 'palm_up' ? c.normalUpExit : c.normalUp);
      if (!c.requireRise) return facingUp;
      const rising = rise > c.riseSpeed;
      if ((rising && facingUp) || (c.riseOnlyFallback && rise > c.riseOnlySpeed) || (prev === 'palm_up' && facingUp)) {
        mem.palmUpUntil = now + c.holdMs;
      }
      return now < (mem.palmUpUntil || 0);
    },
  })
  .register('open_palm', {
    priority: 50,
    test: (f, { cfg }) => f.extendedCount >= 4 && f.thumbOpen && f.spreadRatio > cfg.open.minSpreadRatio,
  });

let modelClassifier = null;

/**
 * 预留模型分类接口：fn(landmarks, features) => { id, confidence } | null
 * 在 recognition.json 中把 classifier 设为 "model" 即启用；返回 null 时回退到规则。
 */
export function setModelClassifier(fn) {
  modelClassifier = fn;
}

export function classify(features, landmarks, ctx) {
  if (ctx.cfg.classifier === 'model' && modelClassifier) {
    const r = modelClassifier(landmarks, features);
    if (r && r.id) return r.id;
  }
  const rules = gestureRules.list().sort((a, b) => a.priority - b.priority);
  for (const rule of rules) if (rule.test(features, ctx)) return rule.id;
  return 'unknown';
}
