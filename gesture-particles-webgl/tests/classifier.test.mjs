// 手势规则单元测试：node tests/classifier.test.mjs
// 用合成的 21 关键点（手腕在原点、手指朝上，单位 px）验证每条规则。
import { CONFIG } from '../config/config.js';
import { registerBuiltinGestures, extractFeatures, classify } from '../src/gesture/classifier.js';

registerBuiltinGestures();
const X = [null, -25, 0, 25, 48]; // 食/中/无名/小指根部 x

function finger(i, state) {
  const bx = X[i];
  if (state === 'ext') return [{ x: bx, y: -100 }, { x: bx, y: -140 }, { x: bx, y: -165 }, { x: bx, y: -190 }];
  return [{ x: bx, y: -100 }, { x: bx, y: -128 }, { x: bx + 2, y: -104 }, { x: bx + 3, y: -84 }];
}
function thumb(state) {
  if (state === 'ext') return [{ x: -30, y: -30 }, { x: -55, y: -55 }, { x: -75, y: -75 }, { x: -95, y: -95 }];
  return [{ x: -25, y: -30 }, { x: -35, y: -55 }, { x: -20, y: -75 }, { x: -5, y: -88 }];
}
function hand(t, f) {
  const lm = [{ x: 0, y: 0 }, ...thumb(t)];
  for (let i = 1; i <= 4; i++) lm.push(...finger(i, f[i - 1]));
  return lm.map((p) => ({ ...p, z: 0 }));
}
function pinchHand() {
  const lm = hand('ext', ['ext', 'ext', 'ext', 'ext']);
  Object.assign(lm[5], { x: -25, y: -100 }); Object.assign(lm[6], { x: -38, y: -132 });
  Object.assign(lm[7], { x: -45, y: -148 }); Object.assign(lm[8], { x: -50, y: -158 });
  Object.assign(lm[4], { x: -54, y: -150 }); Object.assign(lm[3], { x: -60, y: -110 });
  return lm;
}
// 掌心朝上：用世界坐标（手平放、手指朝向摄像头远处），法线竖直
const worldUp = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
worldUp[5] = { x: -0.02, y: 0, z: 0.08 }; worldUp[17] = { x: 0.04, y: 0, z: 0.07 };

const cases = [
  ['OPEN_PALM', hand('ext', ['ext', 'ext', 'ext', 'ext'])],
  ['FIST', hand('fold', ['curl', 'curl', 'curl', 'curl'])],
  ['POINT', hand('fold', ['ext', 'curl', 'curl', 'curl'])],
  ['PINCH', pinchHand()],
  ['PALM_UP', hand('ext', ['ext', 'ext', 'ext', 'ext']), worldUp, 'Left'],
  ['UNKNOWN', hand('fold', ['ext', 'ext', 'ext', 'curl'])],
];

let fail = 0;
for (const [want, lm, world, label] of cases) {
  const f = extractFeatures(lm, world || null, label || 'Left', CONFIG, 'NONE');
  const got = classify(f, CONFIG);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '✔' : '✘'} 期望 ${want.padEnd(9)} 得到 ${got.padEnd(9)} 伸直=${f.ext.map((e) => (e ? 1 : 0)).join('')} 捏合比=${f.pinchRatio.toFixed(2)} 掌心↑=${f.palmUpScore.toFixed(2)}`);
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
