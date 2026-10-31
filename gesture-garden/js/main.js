/**
 * 入口：组装 Garden / HandTracker / AmbientMusic，处理 UI、键盘、全屏与渲染循环。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = GG.config;

  const el = {
    canvas: $('garden'), warmth: $('warmth'), status: $('status'), statusText: $('statusText'),
    metrics: $('metrics'), hint: $('hint'), intro: $('intro'), introNote: $('introNote'),
    btnStart: $('btnStart'), btnDemo: $('btnDemo'), btnMusic: $('btnMusic'), volume: $('volume'),
    btnFist: $('btnFist'), btnCam: $('btnCam'), btnFull: $('btnFull'),
    preview: $('preview'), video: $('video'), landmarks: $('landmarks'), previewCaption: $('previewCaption'),
    toast: $('toast'),
  };

  const garden = new GG.Garden(el.canvas);
  const music = new GG.AmbientMusic(CFG.music);

  const state = {
    started: false,
    camera: false,
    handGesture: 'none',  // 来自摄像头
    keyGesture: null,     // 键盘模拟（优先）
    openness: 1,
    fistMode: CFG.garden.fistMode,
    noHandSince: performance.now(),
    lastInfo: null,
  };

  // ---------------------------------------------------------------- 手势 → 花园
  const GESTURE_LABEL = {
    open: '张开手掌 · 生长绽放',
    fist: () => (state.fistMode === 'close' ? '握拳 · 收拢' : '握拳 · 暂停'),
    neutral: '手势过渡 · 静止',
    none: '未检测到手 · 静止',
  };

  function applyGesture() {
    const g = state.keyGesture || state.handGesture;
    let mode = 'pause';
    if (g === 'open') mode = 'grow';
    else if (g === 'fist') mode = state.fistMode === 'close' ? 'close' : 'pause';
    garden.setMode(mode, state.keyGesture ? 1 : state.openness);

    const label = GESTURE_LABEL[g];
    el.statusText.textContent = state.started ? (typeof label === 'function' ? label() : label) : '等待开始';
    el.status.dataset.state = g;
    if (g !== 'none') state.noHandSince = 0;
    else if (!state.noHandSince) state.noHandSince = performance.now();
  }

  // ---------------------------------------------------------------- 启动
  async function startWithCamera() {
    el.btnStart.disabled = true;
    el.btnDemo.disabled = true;
    startMusic();
    const tracker = new GG.HandTracker({
      video: el.video,
      overlay: el.landmarks,
      onGesture: (g) => { state.handGesture = g; applyGesture(); },
      onFrame: (info) => { state.openness = info.openness; state.lastInfo = info; if (info.gesture === 'open') applyGesture(); },
    });
    try {
      await tracker.start((msg) => {
        if (msg !== 'ready') el.btnStart.textContent = msg;
      });
      state.camera = true;
      el.previewCaption.textContent = '实时手势';
      enterGarden();
      toast('摄像头已就绪 · 张开手掌试试看');
    } catch (err) {
      console.error(err);
      const msg = err && err.name === 'NotAllowedError' ? '摄像头权限被拒绝，可在地址栏重新授权。' : (err.message || String(err));
      el.introNote.innerHTML = `<span class="err">无法启用手势识别：${msg}</span><br/>你仍可使用键盘演示模式体验。`;
      el.btnStart.textContent = '重试';
      el.btnStart.disabled = false;
      el.btnDemo.disabled = false;
      tracker.stop();
    }
  }

  function startDemo() {
    startMusic();
    el.previewCaption.textContent = '键盘演示模式';
    el.preview.classList.add('off');
    el.btnCam.setAttribute('aria-pressed', 'false');
    enterGarden();
    toast('按住 ↑ 让花开放，按住 ↓ 让花收拢');
  }

  function enterGarden() {
    state.started = true;
    el.intro.classList.add('hidden');
    document.body.classList.add('started');
    applyGesture();
  }

  function startMusic() {
    music.start().then(syncMusicBtn).catch((e) => console.warn('[music]', e));
    syncMusicBtn();
  }

  function syncMusicBtn() {
    el.btnMusic.setAttribute('aria-pressed', String(music.isPlaying));
  }

  // ---------------------------------------------------------------- 控件
  el.btnStart.addEventListener('click', startWithCamera);
  el.btnDemo.addEventListener('click', startDemo);
  el.btnMusic.addEventListener('click', () => { music.toggle(); syncMusicBtn(); });
  el.volume.value = CFG.music.volume;
  el.volume.addEventListener('input', () => music.setVolume(parseFloat(el.volume.value)));
  el.btnFist.addEventListener('click', toggleFistMode);
  el.btnCam.addEventListener('click', togglePreview);
  el.btnFull.addEventListener('click', toggleFullscreen);
  el.canvas.addEventListener('dblclick', toggleFullscreen);

  function toggleFistMode() {
    state.fistMode = state.fistMode === 'close' ? 'pause' : 'close';
    el.btnFist.textContent = state.fistMode === 'close' ? '握拳 · 收拢' : '握拳 · 暂停';
    toast(state.fistMode === 'close' ? '握拳：花朵收拢、回归土壤' : '握拳：花园暂停');
    applyGesture();
  }

  function togglePreview() {
    const off = el.preview.classList.toggle('off');
    el.btnCam.setAttribute('aria-pressed', String(!off));
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case 'ArrowUp': state.keyGesture = 'open'; applyGesture(); e.preventDefault(); break;
      case 'ArrowDown': state.keyGesture = 'fist'; applyGesture(); e.preventDefault(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'm': case 'M': if (state.started) { music.toggle(); syncMusicBtn(); } break;
      case 'g': case 'G': toggleFistMode(); break;
      case 'v': case 'V': togglePreview(); break;
      case 'h': case 'H': document.body.classList.toggle('zen'); break;
      case 'Enter': if (!state.started) startWithCamera(); break;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { state.keyGesture = null; applyGesture(); }
  });

  // 闲置自动隐藏界面与鼠标（适合全屏展示）
  let idleTimer = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (state.started) document.body.classList.add('idle'); }, 3500);
  }
  ['mousemove', 'mousedown', 'keydown'].forEach((ev) => document.addEventListener(ev, wake));
  wake();

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- 提示语
  function updateHint() {
    let text = '';
    if (state.started) {
      const g = state.keyGesture || state.handGesture;
      const noHandFor = state.noHandSince ? performance.now() - state.noHandSince : 0;
      if (state.camera && g === 'none' && noHandFor > 2500) text = '将手掌置于摄像头前';
      else if (g !== 'open' && garden.T < 0.12) text = '张开手掌，唤醒花园';
      else if (g === 'open' && garden.T >= 0.999) text = '花园已盛开 · 握拳让花朵收拢';
      else if (g === 'fist' && state.fistMode === 'close' && garden.T <= 0.001) text = '花园已安睡 · 张开手掌重新唤醒';
    }
    if (el.hint.textContent !== text) {
      el.hint.classList.toggle('show', !!text);
      if (text) el.hint.textContent = text;
    }
  }

  // ---------------------------------------------------------------- 主循环
  let last = performance.now();
  let hudT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    garden.update(dt);
    garden.draw();
    music.setEnergy(garden.bloomLevel);
    el.warmth.style.opacity = (garden.bloomLevel * 0.9).toFixed(3);

    hudT += dt;
    if (hudT > 0.25) {
      hudT = 0;
      const i = state.lastInfo;
      if (i) {
        const lat = i.latency != null ? Math.round(i.latency) : '--';
        const over = i.latency != null && i.latency > CFG.gesture.latencyBudgetMs;
        el.metrics.innerHTML = `识别 ${Math.round(i.inferMs)} ms · 响应 <b class="${over ? 'warn' : ''}">${lat} ms</b> · ${Math.round(i.fps)} fps`;
      } else if (state.started) {
        el.metrics.textContent = '键盘演示模式';
      }
      updateHint();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 依赖检查
  if (typeof window.Hands !== 'function') {
    el.introNote.innerHTML += '<br/><span class="err">⚠ MediaPipe 未加载（可能离线），可先使用键盘演示模式。</span>';
  }
})();
