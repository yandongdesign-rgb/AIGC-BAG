import { AudioEngine } from './audio/engine.js';
import { loadConfig } from './core/config.js';
import { clamp, damp } from './core/math.js';
import { GestureInterpreter } from './gestures/interpreter.js';
import { FxEngine } from './particles/engine.js';
import { FxRenderer } from './particles/renderer.js';
import { HandTracker } from './tracking/handTracker.js';
import { DEMO_KEYS, SimulatedHands } from './tracking/simulatedHands.js';
import { Hud } from './ui/hud.js';
import { Recorder } from './ui/recorder.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const cfg = await loadConfig();
const G = cfg.gestures;
let renderer;
try {
  renderer = new FxRenderer($('#fx'), cfg.particles);
} catch (err) {
  $('#start').innerHTML = '<h2>无法创建 WebGL</h2><p>请使用最新版 Chrome / Edge，并在浏览器设置中开启“使用硬件加速”。</p>';
  throw err;
}
const engine = new FxEngine(cfg.particles, G);
const interp = new GestureInterpreter(cfg.recognition);
const audio = new AudioEngine(cfg.audio);
const tracker = new HandTracker(cfg.recognition);
const sim = new SimulatedHands();
const hud = new Hud($('#hud'), $('#gesture'), G);
const recorder = new Recorder($('#fx'), () => hud.lines());

const state = {
  source: 'idle',
  showVideo: true,
  showSkeleton: params.has('skeleton'),
  autoQuality: cfg.particles.quality.autoDegrade,
  qualityIndex: Math.min(Number(params.get('quality') ?? cfg.particles.quality.start), cfg.particles.quality.levels.length - 1),
  frame: { hands: [], dual: { active: false }, events: [] },
  speeds: new Map(),
  fps: 60,
  frameMs: 16,
  latencyMs: 0,
  fpsWindow: [],
  goodWindows: 0,
};

// ---------- 主题 / 画质 ----------
function setTheme(id) {
  const th = cfg.particles.themes[id] || Object.values(cfg.particles.themes)[0];
  renderer.setTheme(th);
  document.body.style.background = th.background;
  $('#theme').value = id;
}
function setQuality(i, reason = '') {
  const levels = cfg.particles.quality.levels;
  state.qualityIndex = clamp(i, 0, levels.length - 1);
  const lv = levels[state.qualityIndex];
  renderer.setQuality(lv);
  engine.setLimit(lv.maxParticles);
  $('#quality').value = String(state.qualityIndex);
  $('#limit').value = String(engine.limit);
  $('#limitVal').textContent = engine.limit;
  if (reason) hud.toast(`画质 → ${lv.name}（${reason}）`);
}

// ---------- 输入源 ----------
async function startCamera() {
  hideStart();
  await audio.start().catch(() => {});
  try {
    status('正在初始化手部模型…');
    if (!tracker.landmarker) await tracker.init(status);
    status('请求摄像头权限…');
    await tracker.startCamera($('#cam'));
    renderer.setVideo($('#cam'));
    renderer.videoMesh.visible = state.showVideo;
    state.source = 'camera';
    hud.toast(`摄像头已启动 · 推理 ${tracker.delegate}`);
    status('');
  } catch (err) {
    console.error(err);
    hud.toast(`摄像头不可用：${err.message || err.name}，已切换演示模式`, 4000);
    startDemo();
  }
  syncButtons();
}
async function startDemo() {
  hideStart();
  audio.start().catch(() => {});
  tracker.stop($('#cam'));
  state.source = 'demo';
  renderer.videoMesh.visible = false;
  renderer.videoAspect = null;
  renderer.resize();
  syncButtons();
}
function hideStart() {
  $('#start').classList.add('hidden');
}
function status(msg) {
  $('#status').textContent = msg;
}
function syncButtons() {
  document.querySelectorAll('[data-act=camera]').forEach((b) => b.classList.toggle('active', state.source === 'camera'));
  document.querySelectorAll('[data-act=demo]').forEach((b) => b.classList.toggle('active', state.source === 'demo'));
  $('#demoRow').style.display = state.source === 'demo' ? '' : 'none';
}

// ---------- 帧映射：手 → 特效槽位 / 音效层 ----------
function anchorsFor(h, frame) {
  const W = (i) => renderer.toWorld(h.landmarks[i]);
  const tips = [4, 8, 12, 16, 20].map(W);
  const palm = renderer.toWorld(h.features.center);
  const i5 = W(5);
  const d = { x: tips[1].x - i5.x, y: tips[1].y - i5.y };
  const l = Math.hypot(d.x, d.y) || 1;
  const other = frame.hands.find((o) => o !== h && !o.lost);
  return {
    tips,
    palm,
    indexTip: tips[1],
    indexDir: { x: d.x / l, y: d.y / l },
    vortex: { x: (tips[0].x + tips[1].x) / 2, y: (tips[0].y + tips[1].y) / 2 },
    trailTips: h.state === 'point' ? [1] : [0, 1, 2, 3, 4],
    target: other ? renderer.toWorld(other.features.center) : null,
  };
}

function applyFrame(frame, dt) {
  const dual = frame.dual;
  const dc = G.dual;
  const radiusScale = dual.active ? dc.radiusScale[0] + (dc.radiusScale[1] - dc.radiusScale[0]) * dual.t : 1;
  const levels = {};
  const bump = (id, v) => (levels[id] = Math.max(levels[id] || 0, v));
  let maxSpeed = 0;
  let maxIntensity = 0;
  const palms = [];

  for (const h of frame.hands) {
    const a = anchorsFor(h, frame);
    palms.push(a.palm);
    const prev = state.speeds.get(h.key);
    const sp = prev?.palm ? Math.hypot(a.palm.x - prev.palm.x, a.palm.y - prev.palm.y) / Math.max(dt, 1e-3) : 0;
    const speed = damp(prev?.speed || 0, h.lost ? 0 : sp, 0.15, dt);
    state.speeds.set(h.key, { palm: a.palm, speed });
    const intensity = clamp(0.35 + speed / 1.6 + Math.max(0, h.rise) * 0.2, 0, 1.2);
    maxSpeed = Math.max(maxSpeed, speed);
    maxIntensity = Math.max(maxIntensity, intensity);
    h.intensity = intensity;
    const def = G.gestures[h.state] || G.gestures.none;
    engine.setSlot(h.key, { effects: h.lost ? [] : def.effects, anchors: a, state: h.state, intensity, radiusScale });
    if (!h.lost) for (const s of def.sounds) bump(s.id, (s.level ?? 1) * (0.55 + 0.45 * Math.min(intensity, 1)));
  }
  for (const key of state.speeds.keys()) if (!frame.hands.some((h) => h.key === key)) state.speeds.delete(key);

  if (dual.active) {
    const mid = renderer.toWorld(dual.mid);
    const [a, b] = frame.hands.filter((h) => !h.lost).map((h) => renderer.toWorld(h.features.center));
    const half = Math.hypot(a.x - b.x, a.y - b.y) / 2;
    engine.setSlot('dual', { effects: dc.effects, anchors: { vortex: mid, vortexRadius: half * 0.75, palm: mid, tips: [mid, mid, mid, mid, mid] }, state: 'dual', intensity: maxIntensity, radiusScale: 1 });
    for (const s of dc.sounds) bump(s.id, s.level ?? 1);
  }

  // 状态切换事件：进入特效 + 进入音效 + 过渡音
  for (const ev of frame.events) {
    const def = G.gestures[ev.state];
    const h = frame.hands.find((x) => x.key === ev.key);
    const intensity = h?.intensity ?? 1;
    if (def?.onEnter) {
      if (def.onEnter.effect) engine.trigger(ev.key, def.onEnter.effect, { intensity });
      if (def.onEnter.sound) audio.trigger(def.onEnter.sound, { intensity });
    }
    if (ev.state !== 'none' && G.transitionSound) audio.trigger(G.transitionSound, {});
  }

  for (const e of G.idle.sounds) bump(e.id, (e.level ?? 1) * (0.25 + 0.75 * engine.calm));
  const [lo, hi] = dc.pitchHz;
  const pitchHz = lo * Math.pow(hi / lo, 1 - (dual.t || 0));
  return { levels, audioParams: { speed: maxSpeed, intensity: maxIntensity, pitchHz }, palms };
}

// ---------- 主循环 ----------
let last = performance.now();
let lastHud = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 1 / 240, 1 / 15);
  last = now;
  const t0 = performance.now();

  let hands = null;
  let detectMs = 0;
  let videoAspect = renderer.aspect;
  if (state.source === 'camera') {
    const td = performance.now();
    hands = tracker.detect($('#cam'), now);
    if (hands) detectMs = performance.now() - td;
    videoAspect = tracker.aspect;
  } else if (state.source === 'demo') {
    hands = sim.update(dt, videoAspect);
  }
  if (hands) state.frame = interp.update(hands, now, videoAspect);
  else if (state.source === 'idle') state.frame = interp.update([], now, videoAspect);
  else state.frame = { ...state.frame, events: [] };

  const frame = state.frame;
  const { levels, audioParams, palms } = applyFrame(frame, dt);
  engine.bounds = { w: renderer.aspect, h: 1 };
  engine.update(dt, { palms });
  for (const ev of engine.events) if (ev.type === 'zap') audio.trigger('electric', { intensity: ev.intensity });
  audio.update(levels, audioParams, dt);
  renderer.setSkeleton(frame.hands, state.showSkeleton);
  renderer.render(engine);
  recorder.tick();

  // 性能统计 & 自动降级
  const work = performance.now() - t0;
  state.frameMs = damp(state.frameMs, work, 0.5, dt);
  state.fps = damp(state.fps, 1 / dt, 0.5, dt);
  if (state.source === 'camera') {
    const cap = tracker.frameCaptureTime;
    state.latencyMs = cap ? damp(state.latencyMs, performance.now() - cap, 0.4, dt) : damp(state.latencyMs, tracker.inferMs + work - detectMs, 0.4, dt);
  } else state.latencyMs = damp(state.latencyMs, work, 0.4, dt);
  qualityGovernor(now, dt);

  if (now - lastHud > 200) {
    lastHud = now;
    const m = metrics();
    window.__metrics = m;
    hud.update(m, frame, state.source === 'demo' ? sim : null);
  }
}

function qualityGovernor(now, dt) {
  const q = cfg.particles.quality;
  state.fpsWindow.push(1 / dt);
  if (!state.windowStart) state.windowStart = now;
  if (now - state.windowStart < q.windowSec * 1000) return;
  const avg = state.fpsWindow.reduce((a, b) => a + b, 0) / state.fpsWindow.length;
  state.fpsWindow = [];
  state.windowStart = now;
  if (!state.autoQuality || document.hidden) return;
  if (avg < q.minFps && state.qualityIndex > 0) {
    state.goodWindows = 0;
    setQuality(state.qualityIndex - 1, `平均 ${avg.toFixed(0)} FPS 低于 ${q.minFps}`);
  } else if (avg > q.recoverFps && state.qualityIndex < q.levels.length - 1) {
    if (++state.goodWindows >= 3) {
      state.goodWindows = 0;
      setQuality(state.qualityIndex + 1, `平均 ${avg.toFixed(0)} FPS`);
    }
  } else state.goodWindows = 0;
}

function metrics() {
  const lv = cfg.particles.quality.levels[state.qualityIndex];
  const db = audio.peak > 0 ? 20 * Math.log10(audio.peak) : -Infinity;
  return {
    source: state.source,
    fps: state.fps,
    frameMs: state.frameMs,
    inferMs: state.source === 'camera' ? tracker.inferMs : 0,
    latencyMs: state.latencyMs,
    latencyKind: state.source === 'camera' ? (tracker.frameCaptureTime ? '采集→渲染' : '推理+渲染') : '模拟+渲染',
    alive: engine.alive,
    limit: engine.limit,
    quality: lv.name,
    bloom: lv.bloom,
    peakDb: db,
    clips: audio.clips,
    audio: audio.ready ? audio.ctx.state : 'off',
    hands: state.frame.hands.map((h) => ({ side: h.side, state: h.state, score: h.score, lost: h.lost })),
    dual: state.frame.dual.active ? state.frame.dual.t : null,
    demo: state.source === 'demo' ? sim.current : null,
  };
}

// ---------- 控制台 ----------
function buildPanel() {
  const th = $('#theme');
  for (const [id, t] of Object.entries(cfg.particles.themes)) th.add(new Option(t.label || id, id));
  th.onchange = () => setTheme(th.value);
  const q = $('#quality');
  cfg.particles.quality.levels.forEach((lv, i) => q.add(new Option(`${lv.name}（${lv.maxParticles} 粒子${lv.bloom ? ' · 辉光' : ''}）`, String(i))));
  q.onchange = () => setQuality(Number(q.value));
  $('#autoQuality').checked = state.autoQuality;
  $('#autoQuality').onchange = (e) => (state.autoQuality = e.target.checked);
  $('#limit').oninput = (e) => {
    engine.setLimit(Number(e.target.value));
    $('#limitVal').textContent = engine.limit;
  };
  $('#volume').value = String(cfg.audio.masterVolume);
  $('#volume').oninput = (e) => audio.setMasterVolume(Number(e.target.value));
  const lay = $('#layers');
  for (const [id, l] of Object.entries(cfg.audio.layers)) {
    const el = document.createElement('label');
    el.className = 'chk';
    el.innerHTML = `<input type="checkbox" ${l.enabled !== false ? 'checked' : ''}/> ${l.label || id}`;
    el.querySelector('input').onchange = (e) => audio.setEnabled(id, e.target.checked);
    lay.append(el);
  }
  $('#showVideo').onchange = (e) => {
    state.showVideo = e.target.checked;
    renderer.videoMesh.visible = state.showVideo && state.source === 'camera';
  };
  $('#showSkeleton').checked = state.showSkeleton;
  $('#showSkeleton').onchange = (e) => (state.showSkeleton = e.target.checked);
  $('#demoAuto').onchange = (e) => (sim.mode = e.target.checked ? 'auto' : 'manual');
  document.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'camera') startCamera();
      if (act === 'demo') startDemo();
      if (act === 'shot') recorder.screenshot();
      if (act === 'rec') recorder.record(10, audio.streamDest?.stream).then(() => hud.toast('录屏已保存'));
    };
  });

  const legend = $('#legend');
  const keyOf = Object.fromEntries(Object.entries(DEMO_KEYS).map(([k, v]) => [v, k]));
  const rows = [...Object.entries(G.gestures).filter(([id]) => id !== 'none'), ['dual', G.dual], ['none', G.gestures.none]];
  for (const [id, g] of rows) {
    const fx = g.effects.map((e) => e.id).join(' + ') || '待机粒子流';
    legend.insertAdjacentHTML('beforeend', `<tr><td>${g.label}</td><td>${g.rule}</td><td>${fx}</td><td><kbd>${keyOf[id] ?? ''}</kbd></td></tr>`);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'h' || e.key === 'H') $('#panel').classList.toggle('hidden');
    if (e.key === 'v' || e.key === 'V') $('#showVideo').click();
    if (e.key === 'k' || e.key === 'K') $('#showSkeleton').click();
    if (DEMO_KEYS[e.key] && state.source === 'demo') {
      sim.mode = 'manual';
      sim.manual = DEMO_KEYS[e.key];
      $('#demoAuto').checked = false;
    }
    if ((e.key === 'a' || e.key === 'A') && state.source === 'demo') {
      sim.mode = 'auto';
      $('#demoAuto').checked = true;
    }
  });
  window.addEventListener('pointermove', (e) => {
    sim.mouse = { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
  });
}

buildPanel();
setTheme(params.get('theme') || cfg.particles.theme);
setQuality(state.qualityIndex);
syncButtons();
if (params.has('hidepanel')) $('#panel').classList.add('hidden');
if (params.has('demo')) {
  startDemo();
  if (params.get('demo') && params.get('demo') !== '1') {
    const id = params.get('demo');
    if (params.has('manual')) {
      sim.mode = 'manual';
      sim.manual = id;
      $('#demoAuto').checked = false;
    } else {
      sim.jump(id);
      sim.hold = params.has('lock');
    }
  }
}
requestAnimationFrame(loop);
window.__app = { cfg, engine, renderer, audio, interp, sim, state, recorder, startDemo, startCamera, setQuality, setTheme };
