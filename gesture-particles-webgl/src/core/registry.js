/**
 * 插件注册中心：手势 / 粒子模式 / 音效层 三类扩展点。
 *
 *   registerGesture({ id, priority, test(features, cfg) => boolean })
 *   registerMode(id, ModeClass)        // ModeClass 继承 src/particles/mode.js 的 Mode
 *   registerSound(id, SoundLayerClass) // 继承 src/audio/layer.js 的 SoundLayer
 *
 * 优先级 priority 越大越先判定；内置手势优先级见 src/gesture/classifier.js
 */
const gestures = [];
const modes = new Map();
const sounds = new Map();

export const Registry = {
  registerGesture(def) {
    const i = gestures.findIndex((g) => g.id === def.id);
    if (i >= 0) gestures.splice(i, 1);
    gestures.push({ priority: 0, ...def });
    gestures.sort((a, b) => b.priority - a.priority);
  },
  registerMode(id, cls) { modes.set(id, cls); },
  registerSound(id, cls) { sounds.set(id, cls); },

  get gestures() { return gestures; },
  getMode(id) { return modes.get(id); },
  getSound(id) { return sounds.get(id); },
  soundIds() { return [...sounds.keys()]; },
  modeIds() { return [...modes.keys()]; },
};
