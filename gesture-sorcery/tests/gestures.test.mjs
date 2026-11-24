import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console };
vm.createContext(ctx);
for (const f of ['utils', 'gestures', 'synth']) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx);
const { classify, Stabilizer } = ctx.SG.Gestures;
const { makeHand } = ctx.SG.Synth;

for (const g of ['open', 'fist', 'point', 'v', 'rock', 'pinch']) {
  for (const rot of [-0.5, 0, 0.5]) {
    for (const s of [60, 160]) {
      test(`识别 ${g} rot=${rot} size=${s}`, () => {
        assert.equal(classify(makeHand(400, 300, g, s, rot), false).gesture, g);
      });
    }
  }
}

test('防抖：需要连续帧确认', () => {
  const st = new Stabilizer(3, 2);
  assert.equal(st.push('point'), 'none');
  assert.equal(st.push('point'), 'none');
  assert.equal(st.push('point'), 'point');
  assert.equal(st.push('fist'), 'point');
  assert.equal(st.push('fist'), 'fist');
});
