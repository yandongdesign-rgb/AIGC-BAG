import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classify } from '../src/gestures/classifier.js';
import { extractFeatures } from '../src/gestures/features.js';
import { GestureInterpreter } from '../src/gestures/interpreter.js';
import { Stabilizer } from '../src/gestures/stabilizer.js';
import { buildHand } from '../src/tracking/handModel.js';

const cfg = JSON.parse(readFileSync(new URL('../public/config/recognition.json', import.meta.url)));
const aspect = 16 / 9;

function rawClass(pose, opts = {}, ctx = {}) {
  const h = buildHand({ pose, aspect, ...opts });
  const f = extractFeatures(h.landmarks, { aspect, label: h.handedness, cfg });
  return classify(f, h.landmarks, { prev: 'none', mem: {}, now: 0, rise: 0, cfg, ...ctx });
}

const variants = [];
for (const actualRight of [true, false])
  for (const roll of [-25, 0, 25])
    for (const scale of [0.14, 0.3]) variants.push({ actualRight, roll, scale, center: { x: 0.4, y: 0.55 } });

for (const pose of ['open_palm', 'fist', 'point', 'pinch']) {
  test(`静态手势 ${pose} 在左右手 / 旋转 / 远近下稳定识别`, () => {
    for (const v of variants) assert.equal(rawClass(pose, v), pose, JSON.stringify(v));
  });
}

test('掌心朝上 + 上移 → palm_up；不上移时保持 open/未知', () => {
  for (const v of variants) {
    assert.equal(rawClass('palm_up', v, { rise: 1.0 }), 'palm_up', JSON.stringify(v));
    assert.notEqual(rawClass('palm_up', v, { rise: 0 }), 'palm_up');
  }
});

test('掌心朝前快速上抬 → palm_up 兜底；朝前慢速 → open_palm', () => {
  assert.equal(rawClass('open_palm', {}, { rise: 2.0 }), 'palm_up');
  assert.equal(rawClass('open_palm', {}, { rise: 0.6 }), 'open_palm');
});

test('掌心朝下上抬不触发 palm_up', () => {
  assert.notEqual(rawClass('palm_up', { pitch: 72 }, { rise: 1.0 }), 'palm_up');
});

test('半握手 → unknown', () => {
  assert.equal(rawClass('relaxed'), 'unknown');
});

test('防抖：短暂抖动不切换，持续后切换', () => {
  const s = new Stabilizer(cfg.stabilizer);
  s.update('open_palm', 0);
  s.update('open_palm', 200);
  assert.equal(s.state, 'open_palm');
  s.update('point', 220);
  s.update('open_palm', 260);
  assert.equal(s.state, 'open_palm');
  s.update('point', 300);
  const r = s.update('point', 300 + cfg.stabilizer.debounceMs + 1);
  assert.equal(r.state, 'point');
  assert.ok(r.changed);
});

test('解释器：握拳产生进入事件，双手距离映射到 0~1，丢手后回到 none', () => {
  const it = new GestureInterpreter(cfg);
  let t = 0;
  let frame;
  for (let i = 0; i < 20; i++, t += 33) {
    frame = it.update([buildHand({ pose: 'fist', aspect })], t, aspect);
  }
  assert.equal(frame.hands[0].state, 'fist');
  const near = [buildHand({ center: { x: 0.45, y: 0.5 }, aspect }), buildHand({ center: { x: 0.55, y: 0.5 }, actualRight: false, aspect })];
  const far = [buildHand({ center: { x: 0.1, y: 0.5 }, aspect }), buildHand({ center: { x: 0.9, y: 0.5 }, actualRight: false, aspect })];
  frame = it.update(near, (t += 33), aspect);
  const tNear = frame.dual.t;
  frame = it.update(far, (t += 33), aspect);
  assert.ok(frame.dual.active);
  assert.ok(frame.dual.t > tNear);
  let ev = [];
  for (let i = 0; i < 20; i++) ev = ev.concat(it.update([], (t += 33), aspect).events);
  assert.ok(ev.some((e) => e.state === 'none'));
  assert.equal(it.slots.size, 0);
});
