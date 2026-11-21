export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randRange = (r) => r[0] + Math.random() * (r[1] - r[0]);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 帧率无关的指数趋近：在 seconds 秒内完成约 95% */
export const damp = (current, target, seconds, dt) =>
  lerp(current, target, 1 - Math.exp((-3 * dt) / Math.max(seconds, 1e-3)));

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
export const len = (v) => Math.hypot(v.x, v.y, v.z || 0);
export const dist = (a, b) => len(sub(a, b));
export const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const normalize = (v) => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l, z: (v.z || 0) / l };
};
/** 以 b 为顶点的夹角（度） */
export const angleAt = (a, b, c) => {
  const u = normalize(sub(a, b));
  const w = normalize(sub(c, b));
  return (Math.acos(clamp(dot(u, w), -1, 1)) * 180) / Math.PI;
};

/** 便宜的平滑伪噪声，用于漂浮流场 */
export function flow(x, y, t) {
  const a = Math.sin(x * 1.7 + t * 0.31) + Math.sin(y * 2.3 - t * 0.23) * 0.6;
  const b = Math.cos(y * 1.9 - t * 0.27) + Math.cos(x * 2.1 + t * 0.19) * 0.6;
  return [Math.cos(a * 1.4) * 0.6 + Math.sin(b) * 0.4, Math.sin(b * 1.3) * 0.6 - Math.cos(a) * 0.4];
}
