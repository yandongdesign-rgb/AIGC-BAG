/**
 * 主程序：输入(摄像头/模拟) → 手势状态 → 模式管理(过渡/叠加) → 粒子模拟 → WebGL 渲染 → 音效
 */
import { CONFIG } from '../config/config.js';
import { Registry } from './core/registry.js';
import * as math from './core/math.js';
import { PerfGovernor } from './core/governor.js';
import { registerBuiltinGestures } from './gesture/classifier.js';
import { registerBuiltinModes } from './particles/modes/index.js';
import { registerBuiltinSounds } from './audio/layers.js';
import { ParticlePool, KIND } from './particles/pool.js';
import { Mode, ModeManager } from './particles/mode.js';
import { SoundLayer } from './audio/layer.js';
import { AudioEngine } from './audio/engine.js';
import { Renderer } from './render/renderer.js';
import { Simulator } from './input/simulator.js';
import { HandTracker } from './input/handTracker.js';
import { createHandSlot } from './input/handState.js';
import { Hud } from './ui/hud.js';

const { clamp, lerp, dist2 } = math;
const cfg = CONFIG;
const qs = new URLSearchParams(location.search);
if (qs.get('theme') && cfg.themes[qs.get('theme')]) cfg.render.theme = qs.get('theme');
if (qs.get('quality')) { cfg.performance.startLevel = +qs.get('quality'); cfg.performance.autoDegrade = false; }

// ---------- 注册内置 + 加载插件 ----------
registerBuiltinGestures();
registerBuiltinModes();
registerBuiltinSounds();
for (const p of cfg.plugins) {
  try {
    const m = await import(new URL(p, document.baseURI).href);
    m.default?.({ Registry, Mode, SoundLayer, KIND, math, config: cfg });
  } catch (e) { console.warn('插件加载失败', p, e); }
}

// ---------- 核心对象 ----------
const canvas = document.getElementById('stage');
const video = document.getElementById('cam');
const skel = document.getElementById('skel');
const previewBox = document.getElementById('preview');
let renderer;
try { renderer = new Renderer(canvas, cfg); } catch (e) { document.getElementById('status').textContent = '❌ ' + e.message; throw e; }
const pool = new ParticlePool(cfg.particles.maxParticles);
const audio = new AudioEngine(cfg);
let theme = cfg.themes[cfg.render.theme];

const NullInput = { source: '待机', slots: [createHandSlot(0), createHandSlot(1)], events: [], detectMs: 0, update() { return this.slots; } };
let input = NullInput;

const ctx = {
  pool, renderer, cfg, theme, W: innerWidth, H: innerHeight, time: 0,
  quality: cfg.performance.levels[cfg.performance.startLevel],
  dualScale: 1, dualNorm: 0.5, idleLevel: 1, idleTime: 0, handsCount: 0, presentHands: [],
  audioParams: {},
  otherHand(slot) { return this.presentHands.find((h) => h.slot !== slot) || null; },
  sound(id, ev, p) { audio.trigger(id, ev, p); },
};
const manager = new ModeManager(ctx, Registry, cfg);
const governor = new PerfGovernor(cfg, (lvl) => {
  ctx.quality = lvl; pool.limit = Math.min(pool.capacity, lvl.maxParticles); renderer.setQuality(lvl);
  hud.show(`画质：${lvl.name}`);
});

const hud = new Hud(cfg, {
  setTheme: (k) => setTheme(k),
  setVolume: (v) => { cfg.audio.masterVolume = v; audio.setMaster(v); },
  setLayer: (id, on) => audio.setEnabled(id, on),
});
governor.set(cfg.performance.startLevel);
if (!cfg.performance.autoDegrade) governor.auto = false;

function setTheme(k) {
  theme = ctx.theme = cfg.themes[k]; cfg.render.theme = k; hud.syncTheme(k); hud.show(`主题：${theme.name}`);
}

addEventListener('resize', () => renderer.resize());

// ---------- 启动流程 ----------
const overlay = document.getElementById('start');
const status = (t) => (document.getElementById('status').textContent = t);

async function startAudio() { try { await audio.start(); } catch (e) { console.warn('音频启动失败', e); } }

async function startCamera() {
  await startAudio();
  status('请求摄像头权限…');
  try {
    const tr = new HandTracker(cfg);
    await tr.init(status);
    status('打开摄像头…');
    await tr.startCamera(video);
    input = tr;
    overlay.classList.add('hidden');
    previewBox.classList.toggle('hidden', !cfg.camera.showPreview);
    hud.show('摄像头模式：伸出手试试 🖐');
  } catch (e) {
    console.error(e);
    status(`摄像头/模型加载失败（${e.message || e}）→ 已切换到鼠标模拟模式`);
    setTimeout(() => startSim(false), 1800);
  }
}
async function startSim(demo) {
  await startAudio();
  input = new Simulator(cfg, { demo });
  overlay.classList.add('hidden');
  hud.show(demo ? '自动演示模式' : '鼠标模拟：移动鼠标=手掌，1-5/7 切换手势，6 双手，按住左键=握拳', 3500);
}
document.getElementById('btn-cam').onclick = startCamera;
document.getElementById('btn-sim').onclick = () => startSim(false);
document.getElementById('btn-demo').onclick = () => startSim(true);
if (qs.get('demo')) startSim(true);
addEventListener('pointerdown', () => audio.ac?.state === 'suspended' && audio.ac.resume());

// ---------- 快捷键 ----------
const themeKeys = Object.keys(cfg.themes);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.code) {
    case 'KeyH': document.body.classList.toggle('nohud'); break;
    case 'KeyC': previewBox.classList.toggle('hidden'); break;
    case 'KeyP': document.getElementById('panel').classList.toggle('hidden'); break;
    case 'KeyT': setTheme(themeKeys[(themeKeys.indexOf(cfg.render.theme) + 1) % themeKeys.length]); break;
    case 'KeyQ': governor.set((governor.level + 1) % cfg.performance.levels.length, true); break;
    case 'KeyA': governor.auto = !governor.auto; hud.show(`自动降级：${governor.auto ? '开' : '关'}`); break;
    case 'KeyM': { const v = audio._muted ? cfg.audio.masterVolume : 0; audio._muted = !audio._muted; audio.setMaster(v); hud.show(audio._muted ? '静音' : '取消静音'); break; }
    case 'KeyF': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); break;
  }
});

// ---------- 主循环 ----------
let last = performance.now();
let latency = 0, frameMs = 0;
window.__dbg = { manager, ctx, pool };
const stats = (window.__stats = { frames: 0, fps: 0, frameMs: 0, latency: 0, detectMs: 0, particles: 0, quality: '' });

function soundWeights(modeW) {
  const out = {};
  const entries = [...Object.values(cfg.mapping), cfg.dual, cfg.idle];
  for (const e of entries) {
    let w = 0; for (const m of e.modes) w = Math.max(w, modeW[m] || 0);
    for (const s of e.sounds) out[s] = Math.max(out[s] || 0, w);
  }
  return out;
}

function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  const rawDt = Math.max(0.0001, (now - last) / 1000); // 真实帧间隔（用于统计帧率）
  const dt = Math.min(rawDt, 0.05);                    // 模拟步长上限，防止卡顿时粒子“瞬移”
  last = now;
  ctx.time += dt;
  const W = (ctx.W = renderer.W), H = (ctx.H = renderer.H);
  for (const k in ctx.audioParams) ctx.audioParams[k] = 0;

  // 1) 输入
  const slots = input.update(now, dt, W, H);
  const present = slots.filter((s) => s.present);
  ctx.presentHands = present;
  ctx.handsCount = present.length;
  ctx.idleTime = present.length ? 0 : ctx.idleTime + dt;
  ctx.idleLevel += ((present.length ? 0.25 : 1) - ctx.idleLevel) * Math.min(1, dt * 1.5);

  // 2) 双手距离 → 缩放
  let dualTarget = 1;
  if (present.length >= 2) {
    const d = dist2(present[0].palm, present[1].palm) / W;
    ctx.dualNorm = clamp((d - cfg.dual.minDist) / (cfg.dual.maxDist - cfg.dual.minDist));
    dualTarget = lerp(cfg.dual.minScale, cfg.dual.maxScale, ctx.dualNorm);
  }
  ctx.dualScale += (dualTarget - ctx.dualScale) * Math.min(1, dt * 8);

  // 3) 手势切换事件 → 过渡音
  for (const ev of input.events) if (ev.to !== ev.from) audio.trigger('transition', 'switch', ev);

  // 4) 期望激活的模式
  const desired = new Map();
  for (const m of cfg.idle.modes) desired.set(`${m}@g`, { modeId: m, hand: null });
  for (const h of present) {
    const map = cfg.mapping[h.gesture];
    if (map) for (const m of map.modes) desired.set(`${m}@${h.slot}`, { modeId: m, hand: h });
  }
  if (present.length >= 2) for (const m of cfg.dual.modes) desired.set(`${m}@g`, { modeId: m, hand: null });
  manager.update(dt, desired);

  // 5) 模拟 + 渲染
  pool.update(dt, ctx.time, W, H);
  renderer.render(pool, theme, dt, ctx.time);

  // 6) 音效
  const ap = ctx.audioParams;
  ap.idle = ctx.idleLevel; ap.dualNorm = ctx.dualNorm; ap.dualActive = present.length >= 2 ? 1 : 0;
  audio.update(dt, soundWeights(manager.weights()), ap);

  // 7) 统计
  governor.tick(rawDt);
  frameMs += (performance.now() - t0 - frameMs) * 0.1;
  if (input.newFrame && input.processedCapture) {
    input.newFrame = false;
    const l = performance.now() - input.processedCapture;
    if (l > 0 && l < 1000) latency += (l - latency) * 0.15;
    if (!previewBox.classList.contains('hidden')) hud.drawSkeleton(skel, video, input.lastResult);
  }
  stats.frames++;
  Object.assign(stats, { fps: governor.fps, frameMs, latency, detectMs: input.detectMs, particles: pool.count, quality: governor.current.name, source: input.source });
  hud.update(dt, {
    fps: governor.fps, frameMs, detectMs: input.detectMs || 0, latency: input === NullInput || input instanceof Simulator ? 0 : latency,
    particles: pool.count, limit: pool.limit, quality: governor.current.name, auto: governor.auto,
    source: { camera: '摄像头', mouse: '鼠标模拟', demo: '自动演示' }[input.source] || input.source,
    audio: audio.started ? (audio.ac.state === 'running' ? '开' : '待激活(点击)') : '未启动',
    peak: audio.peakDb, hands: present, slots,
  });
}
requestAnimationFrame(frame);
