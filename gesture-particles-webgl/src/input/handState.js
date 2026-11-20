/**
 * HandState：输入层（摄像头 / 模拟器）统一输出给特效层的数据结构。
 * 所有坐标均为屏幕 CSS 像素。
 */
export function createHandSlot(slot) {
  return {
    slot,
    present: false,
    lastSeen: -1,
    label: '',
    confidence: 0,
    gesture: 'NONE',
    rawGesture: 'NONE',
    prevGesture: 'NONE',
    gestureSince: 0,
    palm: { x: 0, y: 0 },
    tips: [0, 1, 2, 3, 4].map(() => ({ x: 0, y: 0 })),
    indexTip: { x: 0, y: 0 },
    indexDir: { x: 0, y: -1 },
    pinch: { x: 0, y: 0 },
    pinchRatio: 1,
    handSize: 120,
    vel: { x: 0, y: 0 },
    speed: 0,
    liftSpeed: 0,
    palmUpScore: 0,
    lm: null,
    _prevPalm: null,
  };
}

/** 根据新的手掌位置更新速度（平滑） */
export function updateKinematics(h, dt) {
  if (h._prevPalm && dt > 0) {
    const vx = (h.palm.x - h._prevPalm.x) / dt;
    const vy = (h.palm.y - h._prevPalm.y) / dt;
    h.vel.x += (vx - h.vel.x) * 0.35;
    h.vel.y += (vy - h.vel.y) * 0.35;
  }
  h._prevPalm = { x: h.palm.x, y: h.palm.y };
  h.speed = Math.hypot(h.vel.x, h.vel.y);
  h.liftSpeed = -h.vel.y / (h.handSize || 1);
}

export function setGesture(h, g, now) {
  if (g !== h.gesture) {
    h.prevGesture = h.gesture;
    h.gesture = g;
    h.gestureSince = now;
    return true;
  }
  return false;
}

/** 从像素关键点填充 HandState 的几何字段 */
export function fillFromLandmarks(h, lm, f) {
  h.lm = lm;
  h.handSize = f.handSize;
  h.palm.x = f.palm.x; h.palm.y = f.palm.y;
  const tipIds = [4, 8, 12, 16, 20];
  tipIds.forEach((id, i) => { h.tips[i].x = lm[id].x; h.tips[i].y = lm[id].y; });
  h.indexTip.x = lm[8].x; h.indexTip.y = lm[8].y;
  // 食指方向：用 PIP→TIP（比 MCP→TIP 更贴近手指实际指向）
  let dx = lm[8].x - lm[6].x, dy = lm[8].y - lm[6].y;
  const l = Math.hypot(dx, dy) || 1;
  h.indexDir.x = dx / l; h.indexDir.y = dy / l;
  h.pinch.x = f.pinchPoint.x; h.pinch.y = f.pinchPoint.y;
  h.pinchRatio = f.pinchRatio;
  h.palmUpScore = f.palmUpScore;
}
