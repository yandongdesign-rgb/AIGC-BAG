/**
 * 合成 21 关键点手部模型：用于「演示模式」和单元测试。
 * 产出与 MediaPipe 相同格式的数据（原始帧归一化坐标 + handedness 标签），
 * 因此演示模式下同样经过真实的识别 → 分类 → 防抖 → 特效管线。
 */
const deg = Math.PI / 180;

export const POSES = {
  open_palm: { curls: [0, 0, 0, 0], spread: 1, thumb: 'open', pitch: 0 },
  fist: { curls: [1, 1, 1, 1], spread: 0.2, thumb: 'closed', pitch: 0 },
  point: { curls: [0, 1, 1, 1], spread: 0.3, thumb: 'closed', pitch: 0 },
  pinch: { curls: [0.4, 0.15, 0.2, 0.25], spread: 0.6, thumb: 'pinch', pitch: 0 },
  palm_up: { curls: [0.02, 0.02, 0.02, 0.02], spread: 0.35, thumb: 'open', pitch: -72 },
  relaxed: { curls: [0.45, 0.55, 0.6, 0.65], spread: 0.4, thumb: 'half', pitch: 0 },
};

const MCP = [
  [0.32, -0.92],
  [0.08, -1.0],
  [-0.14, -0.95],
  [-0.33, -0.83],
];
const SEG = [
  [0.42, 0.25, 0.2],
  [0.46, 0.29, 0.21],
  [0.43, 0.27, 0.2],
  [0.33, 0.2, 0.18],
];
const SPREAD = [12, 0, -10, -22];

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function localHand(pose) {
  const pts = new Array(21);
  pts[0] = [0, 0, 0];
  const tips = [];
  for (let f = 0; f < 4; f++) {
    const curl = pose.curls[f];
    const a = SPREAD[f] * pose.spread * deg;
    const d0 = [Math.sin(a), -Math.cos(a), 0];
    let p = [MCP[f][0], MCP[f][1], 0];
    const base = 5 + f * 4;
    pts[base] = p;
    const bends = [80, 100, 75];
    let phi = 0;
    for (let j = 0; j < 3; j++) {
      phi += curl * bends[j] * deg;
      const d = [d0[0] * Math.cos(phi), d0[1] * Math.cos(phi), -Math.sin(phi)];
      p = add(p, d, SEG[f][j]);
      pts[base + j + 1] = p;
    }
    tips.push(p);
  }
  const cmc = [0.2, -0.2, -0.05];
  pts[1] = cmc;
  if (pose.thumb === 'open' || pose.thumb === 'half') {
    const open = pose.thumb === 'open';
    const d = open ? [0.72, -0.68, -0.12] : [0.35, -0.8, -0.45];
    const l = Math.hypot(...d);
    const u = d.map((v) => v / l);
    pts[2] = add(cmc, u, 0.33);
    pts[3] = add(pts[2], u, 0.3);
    pts[4] = add(pts[3], u, 0.25);
  } else if (pose.thumb === 'closed') {
    pts[2] = [0.3, -0.45, -0.25];
    pts[3] = [0.28, -0.65, -0.45];
    pts[4] = [0.12, -0.8, -0.52];
  } else {
    const tip = add(tips[0], [0.02, 0.02, -0.02]);
    pts[4] = tip;
    pts[2] = add(lerp3(cmc, tip, 0.38), [0.14, 0, -0.06]);
    pts[3] = add(lerp3(cmc, tip, 0.7), [0.09, 0, -0.04]);
  }
  return pts;
}

/**
 * @param {object} o
 * @param {keyof POSES|object} o.pose
 * @param {{x:number,y:number}} o.center 掌心位置（原始帧归一化坐标）
 * @param {number} o.scale 掌长（以画面高度为单位）
 * @param {boolean} o.actualRight 是否用户右手
 * @param {number} o.roll 画面内旋转（度）
 * @param {number} o.pitch 额外俯仰（度），掌心朝上约 -70
 * @param {number} o.aspect 宽/高
 * @param {number} o.jitter 噪声幅度（归一化坐标）
 */
export function buildHand({
  pose = 'open_palm',
  center = { x: 0.5, y: 0.5 },
  scale = 0.22,
  actualRight = true,
  roll = 0,
  pitch,
  yaw = 0,
  aspect = 16 / 9,
  jitter = 0,
  score = 0.95,
} = {}) {
  const P = typeof pose === 'string' ? POSES[pose] : pose;
  const pts = localHand(P);
  const pr = (pitch ?? P.pitch) * deg;
  const rr = roll * deg;
  const yr = yaw * deg;
  const mirror = actualRight ? 1 : -1;
  // 以掌心（约 0.45 掌长处）为旋转中心
  const pc = [0.0, -0.55, 0];
  const out = pts.map(([x0, y0, z0]) => {
    let x = (x0 - pc[0]) * mirror;
    let y = y0 - pc[1];
    let z = z0 - pc[2];
    [x, y] = [x * Math.cos(rr) - y * Math.sin(rr), x * Math.sin(rr) + y * Math.cos(rr)];
    [y, z] = [y * Math.cos(pr) - z * Math.sin(pr), y * Math.sin(pr) + z * Math.cos(pr)];
    [x, z] = [x * Math.cos(yr) + z * Math.sin(yr), -x * Math.sin(yr) + z * Math.cos(yr)];
    const j = () => (Math.random() - 0.5) * 2 * jitter;
    return {
      x: center.x + (x * scale) / aspect + j(),
      y: center.y + y * scale + j(),
      z: (z * scale) / aspect,
    };
  });
  return { landmarks: out, handedness: actualRight ? 'Left' : 'Right', score };
}
