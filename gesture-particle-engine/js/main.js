/**
 * 主程序：整合手部追踪 → 手势分类 → 粒子引擎 → 音效引擎 → 渲染 / UI / 录制
 */
(function (global) {
  'use strict';

  const U = global.GPUtils;
  const L = global.GP_LANDMARK_INDEX;

  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
  ];

  const App = {
    ready: false,
    lastTime: 0,
    fps: 60,
    frames: 0,
    fpsSince: 0,
    lastUi: 0,
    lastState: 'IDLE',
    lastZap: 0,
    lastChime: 0,
    density: 1,
    theme: null,
    recorder: null,
    recordChunks: [],
    recordCanvas: null,
    recordCtx: null,
    toastTimer: 0
  };

  const $ = id => document.getElementById(id);

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(App.toastTimer);
    App.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function buildGestureList() {
    const list = $('gestureList');
    list.innerHTML = '';
    (GPConfig.mapping.gestures || []).forEach(g => {
      const li = document.createElement('li');
      li.dataset.state = g.id;
      li.style.setProperty('--c', g.accent || '#48e0c0');
      const fx = (g.effects || []).map(e => e.mode).join('+');
      li.innerHTML = '<span class="dot"></span><span>' + (g.label || g.id) + '</span><span class="fx">' + fx + '</span>';
      list.appendChild(li);
    });
  }

  function applyTheme(key) {
    const themes = GPConfig.particles.themes || {};
    App.theme = themes[key] || themes.midnight || { background: '#050912', hueShift: 0 };
    document.documentElement.style.setProperty('--bg', App.theme.background);
    if (App.engine) App.engine.setTheme(App.theme);
  }

  function setBanner(state) {
    const g = (GPConfig.mapping.gestures || []).find(x => x.id === state) || {};
    $('bannerTitle').textContent = g.label || state;
    $('bannerHint').textContent = g.hint || '';
    document.querySelector('.status-accent').style.background = g.accent || '#48e0c0';
    document.querySelector('.status-accent').style.boxShadow = '0 0 14px ' + (g.accent || '#48e0c0');
    $('statState').textContent = state;
  }

  function updateGestureHighlight(state) {
    document.querySelectorAll('#gestureList li').forEach(li => {
      li.classList.toggle('active', li.dataset.state === state);
    });
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, GPConfig.particles.global.maxPixelRatio || 2);
    App.w = w; App.h = h; App.dpr = dpr;
    App.renderer.resize(w, h, dpr);
    App.engine.resize(w, h);
    const sc = $('skeleton');
    sc.width = 448; sc.height = 336;
  }

  function drawSkeleton(gesture) {
    const sc = $('skeleton');
    const ctx = sc.getContext('2d');
    ctx.clearRect(0, 0, sc.width, sc.height);
    if (!$('chkSkeleton').checked || !gesture.hands.length) return;
    const w = sc.width, h = sc.height;
    ctx.lineWidth = 2;
    gesture.hands.forEach((hand, hi) => {
      const color = hi === 0 ? 'rgba(80,240,210,.95)' : 'rgba(255,130,200,.95)';
      ctx.strokeStyle = color; ctx.fillStyle = color;
      const pt = i => {
        const p = hand.landmarks[i];
        return { x: (1 - p.x) * w, y: p.y * h };
      };
      HAND_CONNECTIONS.forEach(([a, b]) => {
        const p = pt(a), q = pt(b);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      });
      [0, 4, 8, 12, 16, 20].forEach(i => {
        const p = pt(i);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
      });
    });
  }

  function onStateChange(gesture) {
    const state = gesture.state;
    const mapping = (GPConfig.mapping.gestures || []).find(g => g.id === state);
    if (!mapping) return;

    const targets = {};
    (mapping.effects || []).forEach(e => { targets[e.mode] = e.weight; });
    Object.keys(App.engine.targets).forEach(m => { if (targets[m] == null) targets[m] = 0; });
    App.engine.setTargets(targets);

    App.audio.setState(state, gesture);
    App.audio.transition(App.lastState, state);
    const intensity = state === 'DUAL' ? 0.5 + gesture.dual.norm * 0.5
      : U.clamp(gesture.confidence || 0.8, 0.5, 1);
    App.audio.trigger(mapping.sound && mapping.sound.trigger, intensity);

    if (state === 'FIST') App.engine.trigger('BURST', gesture, intensity);
    if (state === 'POINT') App.engine.trigger('LIGHTNING', gesture, 0.8);

    setBanner(state);
    updateGestureHighlight(state);
    App.lastState = state;
  }

  function updateStats(now) {
    if (now - App.lastUi < 180) return;
    App.lastUi = now;
    $('statFps').textContent = App.fps.toFixed(0) + ' fps';
    $('statParticles').textContent = App.engine.count.toLocaleString();
    $('statQuality').textContent = Math.round(App.engine.quality * 100) + '%';
    $('statRenderer').textContent = App.renderer.name;
    $('statLatency').textContent = (App.tracker.demo ? U.formatMs(App.frameWorkMs)
      : U.formatMs(App.tracker.latencyMs));
    $('statConfidence').textContent = Math.round((App.lastGesture.confidence || 0) * 100) + '%';
  }

  function drawRecordStats() {
    if (!App.recorder) return;
    const ctx = App.recordCtx;
    const w = App.recordCanvas.width, h = App.recordCanvas.height;
    ctx.drawImage($('particleCanvas'), 0, 0, w, h);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('GESTURE PARTICLE ENGINE  ·  DEMO', 24, 38);
    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(120,235,215,.95)';
    ctx.fillText('FPS ' + App.fps.toFixed(0) + '   PARTICLES ' + App.engine.count +
      '   LATENCY ' + U.formatMs(App.tracker.demo ? App.frameWorkMs : App.tracker.latencyMs), 24, 68);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const t0 = performance.now();
    const dt = App.lastTime ? Math.min((now - App.lastTime) / 1000, 0.05) : 0.016;
    App.lastTime = now;

    App.frames++;
    if (now - App.fpsSince >= 500) {
      App.fps = App.frames * 1000 / (now - App.fpsSince);
      App.frames = 0; App.fpsSince = now;
    }

    const frame = App.tracker.update(dt);
    const gesture = App.classifier.classify(frame, dt);
    App.lastGesture = gesture;
    if (gesture.state !== App.lastState) onStateChange(gesture);

    App.audio.update(dt, gesture);
    App.engine.autoQuality(App.fps, dt);
    App.engine.update(dt, gesture);

    // 周期音效（即使状态未切换）
    if (gesture.state === 'POINT' && now - App.lastZap > 380) {
      App.audio.trigger('zap', 0.3); App.lastZap = now;
    }
    if (gesture.state === 'LIFT' && now - App.lastChime > 1100) {
      App.audio.trigger('chime', 0.42); App.lastChime = now;
    }

    const count = App.engine.pool.buildVertices(App.engine.hueShift);
    App.renderer.beginFrame(App.theme.background, GPConfig.particles.global.fadeAlpha);
    App.renderer.draw(App.engine.pool.vertices, count);

    drawSkeleton(gesture);
    drawRecordStats();
    App.frameWorkMs = performance.now() - t0;
    updateStats(now);
  }

  async function startCamera() {
    try {
      await App.audio.init();
      App.audio.setVolume(Number($('rngVolume').value) / 100);
      await App.tracker.init($('cam'));
      App.tracker.setDemo(false);
      await App.tracker.start();
      $('camMode').textContent = 'LIVE';
      $('cameraPanel').classList.remove('hidden');
      $('intro').classList.add('hidden');
      toast('摄像头已启动，做出手势试试');
    } catch (e) {
      console.error(e);
      toast('摄像头启动失败：' + e.message + '（可先用演示模式）');
    }
  }

  async function startDemo() {
    await App.audio.init().catch(() => {});
    App.audio.setVolume(Number($('rngVolume').value) / 100);
    App.tracker.setDemo(true);
    App.tracker.running = true;
    $('camMode').textContent = 'DEMO';
    $('intro').classList.add('hidden');
    toast('演示模式：7 种状态每 3.2 秒自动轮播');
  }

  function toggleRecord() {
    if (App.recorder && App.recorder.state === 'recording') {
      App.recorder.stop();
      $('btnRecord').textContent = '● 录制 WebM';
      return;
    }
    const cv = document.createElement('canvas');
    cv.width = Math.round(App.w * Math.min(App.dpr, 1.5));
    cv.height = Math.round(App.h * Math.min(App.dpr, 1.5));
    App.recordCanvas = cv;
    App.recordCtx = cv.getContext('2d');
    const vStream = cv.captureStream(30);
    const aStream = App.audio.getRecordStream ? App.audio.getRecordStream() : null;
    const tracks = vStream.getVideoTracks().concat(aStream ? aStream.getAudioTracks() : []);
    const stream = new MediaStream(tracks);
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    try {
      App.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4500000 });
    } catch (e) { toast('当前浏览器不支持录制: ' + e.message); return; }
    App.recordChunks = [];
    App.recorder.ondataavailable = e => { if (e.data.size) App.recordChunks.push(e.data); };
    App.recorder.onstop = () => {
      const blob = new Blob(App.recordChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gesture-particles-' + Date.now() + '.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('录屏已保存（含 FPS 与延迟标注）');
    };
    App.recorder.start(200);
    $('btnRecord').textContent = '■ 停止录制';
    toast('开始录制：画面将标注 FPS 与延迟');
  }

  /** 供自动化 / 扩展调用：录制指定时长的 WebM Blob（画面叠加 FPS 与延迟） */
  App.captureRecording = function (ms) {
    return new Promise((resolve, reject) => {
      try {
        const cv = document.createElement('canvas');
        cv.width = Math.round(App.w * Math.min(App.dpr, 1.5));
        cv.height = Math.round(App.h * Math.min(App.dpr, 1.5));
        App.recordCanvas = cv;
        App.recordCtx = cv.getContext('2d');
        const vStream = cv.captureStream(30);
        const aStream = App.audio.getRecordStream ? App.audio.getRecordStream() : null;
        const tracks = vStream.getVideoTracks().concat(aStream ? aStream.getAudioTracks() : []);
        let mime = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
        const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 4500000 });
        const chunks = [];
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          App.recorder = null; App.recordCanvas = null;
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
        App.recorder = rec;
        rec.start(200);
        setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, ms || 5000);
      } catch (e) { reject(e); }
    });
  };

  function wireUI() {
    $('btnStart').addEventListener('click', startCamera);
    $('introStart').addEventListener('click', startCamera);
    $('btnDemo').addEventListener('click', startDemo);
    $('introDemo').addEventListener('click', startDemo);
    $('camClose').addEventListener('click', () => $('cameraPanel').classList.add('hidden'));

    $('chkCamera').addEventListener('change', e => $('cameraPanel').classList.toggle('hidden', !e.target.checked));
    $('chkOverlay').addEventListener('change', e => {
      ['topbar', 'gesturePanel', 'controlPanel', 'statusBanner'].forEach(id => $(id).classList.toggle('hidden', !e.target.checked));
    });
    $('chkAudio').addEventListener('change', e => App.audio.setEnabled(e.target.checked));
    $('rngVolume').addEventListener('input', e => {
      $('lblVolume').textContent = e.target.value + '%';
      App.audio.setVolume(Number(e.target.value) / 100);
    });
    $('rngDensity').addEventListener('input', e => {
      App.density = Number(e.target.value) / 100;
      $('lblDensity').textContent = e.target.value + '%';
      App.engine.setQuality(App.density);
    });
    $('selTheme').addEventListener('change', e => applyTheme(e.target.value));
    $('btnReload').addEventListener('click', async () => {
      await global.reloadConfig();
      buildGestureList();
      App.engine.setConfig(GPConfig.particles);
      App.classifier.setConfig(GPConfig.recognition);
      App.audio.cfg = GPConfig.mapping;
      applyTheme($('selTheme').value);
      toast('配置已重新加载');
    });
    $('btnRecord').addEventListener('click', toggleRecord);
    window.addEventListener('resize', resize);
  }

  async function init() {
    await global.loadConfig();
    buildGestureList();
    applyTheme('midnight');

    const canvas = $('particleCanvas');
    App.renderer = global.GPCreateRenderer(canvas, false);
    App.engine = new global.GPParticleEngine(GPConfig.particles, canvas);
    App.classifier = new global.GPGestureClassifier(GPConfig.recognition);
    App.audio = new global.GPAudioEngine(GPConfig.mapping);
    App.tracker = new global.GPHandTracker(GPConfig.recognition);
    App.tracker.onResults = () => {};

    resize();
    wireUI();
    App.ready = true;
    global.GPApp = App;

    if (GPConfig.recognition.customClassifierUrl) {
      App.classifier.loadCustomClassifier(GPConfig.recognition.customClassifierUrl);
    }

    requestAnimationFrame(loop);

    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') {
      startDemo();
      if (params.get('autostart') === '1') $('intro').classList.add('hidden');
    }
    if (!global.GPHandTracker.scriptsReady()) {
      console.warn('[app] MediaPipe CDN 未就绪：摄像头模式不可用，演示模式仍可运行。');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
