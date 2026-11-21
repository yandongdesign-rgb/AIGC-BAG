import { angleAt, cross, dist, normalize, sub } from '../core/math.js';

export const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
export const TIPS = [4, 8, 12, 16, 20];

/**
 * MediaPipe 的 handedness 假设输入是镜像（自拍）画面；我们送入的是原始摄像头帧，
 * 所以标签 "Left" 实际是用户的右手。flip 用于不同设备/输入方式的手动校正。
 */
export const isActualRight = (label, flip = false) => (label === 'Left') !== flip;

/**
 * 从 21 个关键点提取几何特征（全部按掌长归一化）。
 * @param {{x:number,y:number,z:number}[]} lm 原始帧归一化坐标
 * @param {object} o { aspect, label, cfg }
 */
export function extractFeatures(lm, { aspect = 16 / 9, label = 'Left', cfg }) {
  const p = lm.map((q) => ({ x: q.x * aspect, y: q.y, z: (q.z || 0) * aspect }));
  const palm = dist(p[0], p[9]) || 1e-6;

  const extended = FINGERS.map(([mcp, pip, dip, tip]) => {
    const straight = Math.min(angleAt(p[mcp], p[pip], p[dip]), angleAt(p[pip], p[dip], p[tip]));
    const reach = dist(p[0], p[tip]) / Math.max(dist(p[0], p[pip]), 1e-6);
    return straight > cfg.finger.extendAngle && reach > cfg.finger.extendReach;
  });
  const extendedCount = extended.filter(Boolean).length;

  const thumbRatio = dist(p[4], p[9]) / palm;
  const thumbAngle = angleAt(p[2], p[3], p[4]);
  const thumbOpen = thumbRatio > cfg.thumb.openRatio && thumbAngle > cfg.thumb.ipAngle;

  const spreadRatio = dist(p[8], p[20]) / Math.max(dist(p[5], p[17]), 1e-6);
  const pinchRatio = dist(p[4], p[8]) / palm;
  const indexReach = dist(p[0], p[8]) / palm;

  const sign = isActualRight(label, cfg.flipPalmNormal) ? 1 : -1;
  const n = normalize(cross(sub(p[5], p[0]), sub(p[17], p[0])));
  const normal = { x: n.x * sign, y: n.y * sign, z: n.z * sign };

  const ids = [0, 5, 9, 13, 17];
  const center = ids.reduce(
    (acc, i) => ({ x: acc.x + lm[i].x / ids.length, y: acc.y + lm[i].y / ids.length }),
    { x: 0, y: 0 },
  );

  return {
    palm,
    palmImage: palm,
    extended,
    extendedCount,
    thumbOpen,
    thumbRatio,
    spreadRatio,
    pinchRatio,
    indexReach,
    normal,
    normalUp: -normal.y,
    facingCamera: -normal.z,
    center,
  };
}
