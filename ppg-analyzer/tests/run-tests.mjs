/**
 * 离线算法测试：node tests/run-tests.mjs
 */
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../js/config.js';
import { PPGProcessor } from '../js/pipeline.js';
import { designButterworthBandpass, sosFreqResponse, filtfilt } from '../js/dsp/filters.js';
import { periodogram, bandPower } from '../js/dsp/spectrum.js';
import { timeDomain } from '../js/dsp/hrv.js';
import { makeCameraFrames } from './synthetic.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('✔', name); } catch (e) { failed++; console.error('✘', name, '\n ', e.message); }
}

test('Butterworth 带通：-3 dB 截止点与通带增益', () => {
  const sos = designButterworthBandpass(0.5, 4, 30, 4);
  const g = (f) => 20 * Math.log10(sosFreqResponse(sos, f, 30));
  assert.ok(Math.abs(g(1.5)) < 0.5, `通带 1.5Hz 增益 ${g(1.5)}`);
  assert.ok(Math.abs(g(0.5) + 3) < 0.6, `0.5Hz 处 ${g(0.5)} dB`);
  assert.ok(Math.abs(g(4) + 3) < 0.6, `4Hz 处 ${g(4)} dB`);
  assert.ok(g(0.1) < -40, `0.1Hz 阻带 ${g(0.1)}`);
  assert.ok(g(10) < -30, `10Hz 阻带 ${g(10)}`);
});

test('filtfilt 零相位：正弦峰位置不偏移', () => {
  const fs = 30, f = 1.2, n = 300;
  const x = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i / fs));
  const y = filtfilt(designButterworthBandpass(0.5, 4, fs, 4), x);
  let lag = 0, best = -Infinity;
  for (let L = -5; L <= 5; L++) {
    let s = 0; for (let i = 50; i < 250; i++) s += x[i] * y[i + L];
    if (s > best) { best = s; lag = L; }
  }
  assert.equal(lag, 0);
});

test('周期图 Parseval：功率积分 ≈ 方差', () => {
  const fs = 4, n = 512;
  const x = Array.from({ length: n }, (_, i) => 3 * Math.sin(2 * Math.PI * 0.25 * i / fs));
  const { f, p } = periodogram(x, fs);
  const pw = bandPower(f, p, 0, 2);
  assert.ok(Math.abs(pw - 4.5) / 4.5 < 0.05, `功率 ${pw}，期望 4.5`);
});

for (const detector of ['elgendi', 'localMax']) {
  test(`端到端（${detector}）：合成 PPG 心率与 HRV`, () => {
    const cfg = { ...DEFAULT_CONFIG, detector };
    const { frames, beats } = makeCameraFrames({ duration: 150, hr: 72 });
    const proc = new PPGProcessor(cfg);
    let nextTick = 0, last;
    for (const fr of frames) {
      proc.push(fr.t, fr.r, fr.g, fr.b);
      if (fr.t >= nextTick) { last = proc.process(); nextTick += 0.2; }
    }
    const { hrv, beats: det } = proc.summary();
    const truthIbi = [];
    for (let i = 1; i < beats.length; i++) truthIbi.push((beats[i] - beats[i - 1]) * 1000);
    const truth = timeDomain(truthIbi);
    console.log(`   检出间期 ${det.length}/${truthIbi.length}，伪迹率 ${(hrv.artifactRate * 100).toFixed(1)}%`);
    console.log(`   HR ${hrv.meanHR.toFixed(2)} vs ${truth.meanHR.toFixed(2)} | SDNN ${hrv.sdnn.toFixed(1)} vs ${truth.sdnn.toFixed(1)} | RMSSD ${hrv.rmssd.toFixed(1)} vs ${truth.rmssd.toFixed(1)} | LF/HF ${hrv.lfhf.toFixed(2)} | SQI ${last.sqi.toFixed(2)}`);
    assert.ok(Math.abs(hrv.meanHR - truth.meanHR) < 1, 'HR 误差 < 1 bpm');
    assert.ok(Math.abs(hrv.sdnn - truth.sdnn) / truth.sdnn < 0.1, 'SDNN 误差 < 10%');
    assert.ok(Math.abs(hrv.rmssd - truth.rmssd) / truth.rmssd < 0.2, 'RMSSD 误差 < 20%');
    assert.ok(hrv.artifactRate < 0.05, '伪迹率 < 5%');
    assert.ok(det.length >= truthIbi.length * 0.9, '漏检 < 10%');
    assert.ok(last.sqi > 0.5, 'SQI > 0.5');
  });
}

test('无手指（暗画面）时不产生心搏', () => {
  const proc = new PPGProcessor(DEFAULT_CONFIG);
  for (let t = 0; t < 20; t += 1 / 30) { proc.push(t, 20 + Math.random(), 18, 15); proc.process(); }
  assert.equal(proc.beats.length, 0);
});

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
