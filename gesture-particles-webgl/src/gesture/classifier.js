/**
 * 基于 21 个关键点的几何规则手势分类。
 *
 * 关键点编号（MediaPipe Hands）：
 *   0 手腕 | 拇指 1-4 | 食指 5-8 | 中指 9-12 | 无名指 13-16 | 小指 17-20
 *
 * 每个手势是一条注册到 Registry 的规则 { id, priority, test(f, cfg) }，
 * 按优先级依次判定，第一个命中者胜出；全部未命中 → UNKNOWN。
 * 若要换成模型分类：注册一个高优先级规则，在 test 里调用你的模型即可（见 README “扩展”）。
 */
import { Registry } from '../core/registry.js';
import { dist3, angleAt, sub3, cross, norm3, clamp } from '../core/math.js';

const FINGERS = [
  // [mcp, pip, dip, tip]
  [1, 2, 3, 4],     // 拇指（cmc, mcp, ip, tip）
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * 提取手势特征。
 * @param lm       像素坐标关键点（已镜像、已滤波），含 z
 * @param world    世界坐标关键点（米，可为空）
 * @param label    MediaPipe handedness 标签
 */
export function extractFeatures(lm, world, label, cfg, prev) {
  const g = cfg.gestures;
  const handSize = dist3(lm[0], lm[9]) || 1;
  const palm = centroid(lm, [0, 5, 9, 13, 17]);

  // 四指（食指~小指）伸直 / 弯曲
  const ext = [], curl = [];
  for (let i = 1; i < 5; i++) {
    const [mcp, pip, , tip] = FINGERS[i];
    const dTip = dist3(lm[0], lm[tip]);
    const dPip = dist3(lm[0], lm[pip]);
    const ang = angleAt(lm[mcp], lm[pip], lm[tip]);
    ext[i] = dTip > dPip * g.fingerExtendRatio && ang > g.straightAngle;
    curl[i] = dTip < dPip * g.fingerCurlRatio || ang < 100;
  }
  // 拇指：指尖离中指根部足够远且基本伸直
  const thumbOut = dist3(lm[4], lm[9]) / handSize;
  ext[0] = thumbOut > g.thumbExtendRatio && angleAt(lm[2], lm[3], lm[4]) > 135;
  curl[0] = !ext[0];

  // 捏合
  const pinchRatio = dist3(lm[4], lm[8]) / handSize;
  const pinchPoint = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
  const pinchAway = dist3(pinchPoint, palm) / handSize; // 捏合点远离掌心（区分握拳）

  // 掌心法线（用世界坐标更稳；不镜像，以保持左右手手性）
  const src = world && world.length === 21 ? world : null;
  let palmUpScore = 0, normal = { x: 0, y: 0, z: 1 };
  if (src) {
    normal = norm3(cross(sub3(src[5], src[0]), sub3(src[17], src[0])));
    // 未镜像输入下，MediaPipe 的 'Left' 实际对应用户右手
    let s = label === 'Left' ? 1 : -1;
    if (g.palmUp.invertNormal) s = -s;
    palmUpScore = s * normal.y;
  }

  return {
    lm, handSize, palm, ext, curl, thumbOut, pinchRatio, pinchPoint, pinchAway,
    palmUpScore, normal, prevGesture: prev || 'NONE',
    extCount: ext.slice(1).filter(Boolean).length,
    liftSpeed: 0, // 由 tracker 填入（手掌尺寸/秒，向上为正）
  };
}

function centroid(lm, ids) {
  let x = 0, y = 0, z = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; z += lm[i].z || 0; }
  return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
}

/** 返回第一个命中的手势 id */
export function classify(f, cfg) {
  for (const rule of Registry.gestures) {
    try { if (rule.test(f, cfg)) return rule.id; } catch (e) { /* 插件出错不影响主流程 */ }
  }
  return 'UNKNOWN';
}

// ---------------- 内置 5 种单手手势 ----------------
export function registerBuiltinGestures() {
  Registry.registerGesture({
    id: 'PINCH', priority: 50,
    test(f, cfg) {
      const g = cfg.gestures;
      const thr = f.prevGesture === 'PINCH' ? g.pinchReleaseRatio : g.pinchRatio;
      return f.pinchRatio < thr && f.pinchAway > 0.55;
    },
  });
  Registry.registerGesture({
    id: 'FIST', priority: 40,
    test(f) { return f.curl[1] && f.curl[2] && f.curl[3] && f.curl[4]; },
  });
  Registry.registerGesture({
    id: 'POINT', priority: 30,
    test(f) { return f.ext[1] && !f.ext[2] && f.curl[3] && f.curl[4]; },
  });
  Registry.registerGesture({
    id: 'PALM_UP', priority: 25,
    test(f, cfg) {
      if (f.extCount < 4) return false;
      const p = cfg.gestures.palmUp;
      const byOri = f.palmUpScore > p.normalThreshold;
      const byLift = f.liftSpeed > p.liftSpeed;
      if (p.mode === 'lift') return byLift;
      if (p.mode === 'either') return byOri || byLift;
      return byOri;
    },
  });
  Registry.registerGesture({
    id: 'OPEN_PALM', priority: 20,
    test(f) { return f.extCount === 4 && (f.ext[0] || f.thumbOut > 0.5); },
  });
}

/** 时间防抖：滑动窗口投票 */
export class GestureStabilizer {
  constructor(cfg) { this.cfg = cfg; this.hist = []; this.stable = 'NONE'; }
  reset() { this.hist = []; this.stable = 'NONE'; }
  push(raw) {
    const { windowFrames, minVotes } = this.cfg.gestures.stabilizer;
    this.hist.push(raw);
    if (this.hist.length > windowFrames) this.hist.shift();
    if (raw === this.stable) return this.stable;
    let votes = 0;
    for (const h of this.hist) if (h === raw) votes++;
    // 握拳要“瞬间”触发爆炸：降低票数门槛
    const need = raw === 'FIST' ? Math.max(2, minVotes - 1) : minVotes;
    if (votes >= need) this.stable = raw;
    return this.stable;
  }
}

export const clampScore = (v) => clamp(v, -1, 1);
