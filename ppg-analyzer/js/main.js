/**
 * 界面胶水层：摄像头 → PPGProcessor → 图表 / 指标 / 解读
 * 算法本身都在 js/dsp 与 js/pipeline.js 中，这里不包含信号处理逻辑。
 */

import { loadConfig, saveConfig, resetConfig, PARAM_SCHEMA } from './config.js';
import { CameraSource } from './camera.js';
import { PPGProcessor } from './pipeline.js';
import { drawWave, drawTacho, drawPoincare, drawPSD } from './ui/charts.js';
import { runAnalyzers, registerAnalyzer } from './analysis/insight.js';
import { registerFilter } from './dsp/filters.js';
import { registerDetector } from './dsp/peaks.js';
import { registerFeature } from './dsp/hrv.js';

const $ = (id) => document.getElementById(id);
let cfg = loadConfig();
const processor = new PPGProcessor(cfg);
const camera = new CameraSource($('video'));
let running = false;
let lastT = -Infinity;
let lastBeatCount = 0;
let lastHRVUpdate = 0;
let autoStopSec = 0;
let live = null;

// 在浏览器控制台中可直接调用，方便课堂实验：PPGLab.registerFilter(...)
window.PPGLab = { processor, get config() { return cfg; }, registerFilter, registerDetector, registerFeature, registerAnalyzer };

// ---------------- 采集 ----------------
camera.onFrame = (t, r, g, b) => {
  if (!running || t <= lastT) return; // 保证时间戳单调
  lastT = t;
  processor.push(t, r, g, b);
};

async function start() {
  processor.setConfig(cfg);
  processor.reset();
  lastT = -Infinity; lastBeatCount = 0; lastHRVUpdate = 0;
  autoStopSec = Number($('duration').value);
  $('insights').innerHTML = '<p class="muted">测量中…</p>';
  try {
    await camera.start({ torch: cfg.torch, roiRatio: cfg.roiRatio });
  } catch (e) {
    showFinger(cameraError(e), false);
    return;
  }
  running = true;
  $('btnStart').textContent = '停止';
  $('btnStart').classList.add('stop');
  $('btnExport').disabled = true;
  $('torchState').textContent = camera.torchOn ? '闪光灯 开' : (camera.torchSupported ? '闪光灯 关' : '无闪光灯·请在明亮处');
  requestAnimationFrame(tick);
}

async function stop() {
  running = false;
  camera.stop();
  $('btnStart').textContent = '重新测量';
  $('btnStart').classList.remove('stop');
  $('btnExport').disabled = processor.raw.length === 0;
  const { hrv } = processor.summary();
  renderHRV(hrv, true);
  const items = await runAnalyzers({ hrv, live, cfg });
  $('insights').innerHTML = items.length
    ? items.map((i) => `<div class="insight ${i.level}"><div class="t">${i.title}</div><div class="d">${i.text}</div></div>`).join('')
    : '<p class="muted">有效心搏太少，无法生成解读。请重新测量。</p>';
}

function cameraError(e) {
  if (e?.name === 'NotAllowedError') return '摄像头权限被拒绝：请在浏览器设置中允许访问摄像头';
  if (e?.name === 'NotFoundError') return '未找到摄像头';
  if (!window.isSecureContext) return '需要通过 HTTPS（或 localhost）打开本页面才能使用摄像头';
  return '摄像头启动失败：' + (e?.message || e);
}

// ---------------- 刷新循环（约 10 Hz 分析） ----------------
let lastProc = 0;
function tick(now) {
  if (!running) return;
  if (now - lastProc > 100) {
    lastProc = now;
    live = processor.process();
    render(live);
    if (autoStopSec && live.elapsed >= autoStopSec) { stop(); return; }
  }
  requestAnimationFrame(tick);
}

function showFinger(msg, ok) {
  const el = $('fingerMsg');
  el.textContent = msg;
  el.className = 'finger-msg ' + (ok ? 'ok' : 'bad');
}

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '--');

function render(s) {
  showFinger(s.finger.msg, s.finger.ok);
  const sec = Math.floor(s.elapsed);
  $('timer').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` + (autoStopSec ? ` / ${autoStopSec}s` : '');
  if (s.fpsActual) $('fps').textContent = `${s.fpsActual.toFixed(0)} fps`;
  if (!s.ready) { drawWave($('waveCanvas'), null); return; }

  $('sqiFill').style.width = `${Math.round(s.sqi * 100)}%`;
  $('sqiVal').textContent = s.sqi.toFixed(2);
  $('hr').textContent = s.good ? fmt(s.hr) : '--';
  $('ppi').textContent = s.good ? fmt(s.ppi) : '--';
  $('pi').textContent = fmt(s.pi, 2);
  $('beatCount').textContent = s.validCount;

  if (s.validCount !== lastBeatCount) {
    lastBeatCount = s.validCount;
    const el = document.querySelector('.metric.big');
    el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat');
  }

  drawWave($('waveCanvas'), s.t, s.x, s.peaks.idx, cfg.windowSec);
  drawTacho($('tachoCanvas'), s.beats);

  if (s.elapsed - lastHRVUpdate > 1) {
    lastHRVUpdate = s.elapsed;
    renderHRV(processor.summary().hrv, false);
  }
}

// ---------------- HRV 面板 ----------------
const HRV_ITEMS = [
  ['MeanNN', 'meanNN', 'ms', 0],
  ['SDNN', 'sdnn', 'ms', 1],
  ['RMSSD', 'rmssd', 'ms', 1],
  ['pNN50', 'pnn50', '%', 1],
  ['SD1', 'sd1', 'ms', 1],
  ['SD2', 'sd2', 'ms', 1],
  ['LF/HF', 'lfhf', '', 2],
  ['LFnu', 'lfnu', '', 1],
  ['HFnu', 'hfnu', '', 1],
  ['LF', 'lf', 'ms²', 0],
  ['HF', 'hf', 'ms²', 0],
  ['上升时间', 'riseTime', 'ms', 0],
];

function renderHRV(h, final) {
  $('hrvGrid').innerHTML = HRV_ITEMS.map(([k, key, u, d]) =>
    `<div class="hrv-item"><div class="k">${k}</div><div class="v">${fmt(h[key], d)}<small>${u}</small></div></div>`).join('');
  const dur = Math.round(h.duration || 0);
  $('hrvHint').textContent = `${final ? '全程' : '实时'} · ${h.n || 0} 个间期 · ${dur}s` + (h.durationOk ? '' : ' · 频域需 ≥120s');
  const nn = processor.summary().beats.filter((b) => b.valid).map((b) => b.ibi);
  drawPoincare($('poincareCanvas'), nn);
  drawPSD($('psdCanvas'), h.psd, cfg);
}

// ---------------- 参数面板（由 PARAM_SCHEMA 自动生成） ----------------
function buildSettings() {
  let html = '', group = '';
  for (const p of PARAM_SCHEMA) {
    if (p.group !== group) { group = p.group; html += `<div class="group-title">${group}</div>`; }
    const v = cfg[p.key];
    let input;
    if (p.type === 'select') {
      input = `<select data-key="${p.key}">${p.options.map((o) => `<option ${String(o) === String(v) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else if (p.type === 'boolean') {
      input = `<input type="checkbox" data-key="${p.key}" ${v ? 'checked' : ''} />`;
    } else {
      input = `<input type="number" inputmode="decimal" data-key="${p.key}" value="${v}" step="${p.step}" min="${p.min}" max="${p.max}" />`;
    }
    html += `<div class="param"><label>${p.label}<code>${p.key}</code></label>${input}</div>`;
  }
  $('settingsBody').innerHTML = html;
}

$('settingsBody').addEventListener('change', (e) => {
  const el = e.target;
  const key = el.dataset.key;
  if (!key) return;
  const schema = PARAM_SCHEMA.find((p) => p.key === key);
  let v;
  if (schema.type === 'boolean') v = el.checked;
  else if (schema.type === 'number') { v = parseFloat(el.value); if (!Number.isFinite(v)) return; }
  else v = typeof cfg[key] === 'number' ? Number(el.value) : el.value;
  cfg = { ...cfg, [key]: v };
  saveConfig(cfg);
  processor.setConfig(cfg);
  if (key === 'roiRatio') camera.roiRatio = v;
  if (key === 'torch' && running) camera.setTorch(v);
  updateFilterDesc();
});

$('btnReset').addEventListener('click', () => {
  cfg = resetConfig();
  processor.setConfig(cfg);
  buildSettings();
  updateFilterDesc();
});

function updateFilterDesc() {
  $('filterDesc').textContent = `${cfg.filterOrder} 阶 Butterworth ${cfg.lowCut}–${cfg.highCut} Hz · ${cfg.detector}`;
}

$('btnSettings').addEventListener('click', () => { buildSettings(); $('settings').showModal(); });
$('btnStart').addEventListener('click', () => (running ? stop() : start()));
$('btnExport').addEventListener('click', () => {
  const blob = new Blob([processor.toCSV()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ppg_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });

updateFilterDesc();
drawWave($('waveCanvas'), null);
drawTacho($('tachoCanvas'), null);
renderHRV({}, false);
