export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randRange = (r) => r[0] + Math.random() * (r[1] - r[0]);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
export function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function sub3(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
export function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function norm3(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
/** 以 b 为顶点的夹角（度），180 = 三点共线伸直 */
export function angleAt(a, b, c) {
  const u = sub3(a, b), v = sub3(c, b);
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / ((Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z)) || 1);
  return (Math.acos(clamp(d, -1, 1)) * 180) / Math.PI;
}

/** 调色板取色：在多个颜色之间插值，t∈[0,1] */
export function paletteAt(pal, t) {
  if (pal.length === 1) return pal[0];
  const f = clamp(t) * (pal.length - 1);
  const i = Math.min(pal.length - 2, f | 0), k = f - i;
  const a = pal[i], b = pal[i + 1];
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** 廉价流场：返回角度（用于环境/飘散粒子湍流） */
export function flowAngle(x, y, t) {
  return (
    Math.sin(x * 0.0041 + t * 0.31) * 1.7 +
    Math.cos(y * 0.0053 - t * 0.23) * 1.7 +
    Math.sin((x + y) * 0.0027 + t * 0.11) * 1.3
  );
}
