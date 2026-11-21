/**
 * 可插拔注册表：手势规则、粒子特效、音效层都通过它接入。
 * register(id, impl) 即可新增，无需修改引擎代码；映射关系由 public/config/*.json 决定。
 */
export function createRegistry(kind) {
  const items = new Map();
  return {
    kind,
    register(id, impl) {
      items.set(id, { id, ...impl });
      return this;
    },
    get(id) {
      return items.get(id);
    },
    has(id) {
      return items.has(id);
    },
    list() {
      return [...items.values()];
    },
    ids() {
      return [...items.keys()];
    },
  };
}
