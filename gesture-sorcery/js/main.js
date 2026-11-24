// 入口：初始化各模块、主循环、界面与快捷键
(function () {
  const SG = window.SG;
  const CFG = SG.CONFIG;
  const $ = (id) => document.getElementById(id);
  const video = $('cam'), glCanvas = $('gl'), fxCanvas = $('fx'), darkCanvas = $('dark');
  const fxCtx = fxCanvas.getContext('2d'), darkCtx = darkCanvas.getContext('2d');

  const pool = new SG.ParticlePool(CFG.particles.max);
  let gl;
  try { gl = new SG.GLRenderer(glCanvas, CFG.particles.max); } catch (e) { alert('当前浏览器不支持 WebGL2，请使用最新版 Chrome / Edge。'); throw e; }
  const fx = new SG.FX();
  const stage = new SG.Stage($('stage'), $('flash'), $('invert'), video);
  const audio = new SG.AudioFX(CFG.audio);
  const hands = new SG.HandManager(CFG);
  const tracker = new SG.Tracker(CFG.tracking);
  const demo = new SG.Demo();

  // ---------- 界面 ----------
  const titleEl = $('title');
  let titleTimer = 0;
  const ui = {
    title(text, sub, cls) {
      titleEl.className = '';
      void titleEl.offsetWidth;
      titleEl.innerHTML = `<div class="t">${text}</div><div class="s">${sub || ''}</div>`;
      titleEl.className = 'show ' + (cls || '');
      clearTimeout(titleTimer);
      titleTimer = setTimeout(() => { titleEl.className = ''; }, 2300);
    },
  };
  const spells = new SG.Spells({ pool, fx, stage, audio, cfg: CFG, ui });

  const bar = $('spellbar');
  const cards = {};
  for (const s of SG.SPELLS) {
    const el = document.createElement('div');
    el.className = 'card'; el.dataset.id = s.id;
    el.innerHTML = `<div class="ic">${s.icon}</div><div class="nm">${s.name}</div><div class="hw">${s.how}</div>`;
    bar.appendChild(el); cards[s.id] = el;
  }

  let W = 0, H = 0, DPR = 1;
  function resize() {
    W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
    gl.resize(W, H, DPR);
    const d2 = Math.min(1.5, DPR);
    for (const [c, ctx] of [[fxCanvas, fxCtx], [darkCanvas, darkCtx]]) { c.width = Math.round(W * d2); c.height = Math.round(H * d2); ctx.setTransform(d2, 0, 0, d2, 0, 0); }
    pool.W = W; pool.H = H;
  }
  addEventListener('resize', resize);
  resize();
  pool.spawnDust(CFG.particles.dust);

  // ---------- 摄像头映射 ----------
  function mapLm(lm) {
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const sc = Math.max(W / vw, H / vh), dw = vw * sc, dh = vh * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
    return lm.map((p) => ({ x: ox + (1 - p.x) * dw, y: oy + p.y * dh, z: p.z * dw }));
  }

  let mode = 'idle', camFrames = [];
  const hud = $('hud');
  let fps = 60, last = performance.now(), hudT = 0, lowT = 0, highT = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;

    if (mode === 'camera') {
      const r = tracker.detect(now);
      if (r) camFrames = r.map((h) => ({ lm: mapLm(h.lm) }));
    }
    let frames = mode === 'camera' ? camFrames.slice() : [];
    if (mode !== 'camera' || demo.busy) frames = frames.concat(demo.frames(dt, now, W, H));
    const hs = hands.update(frames, dt, now, H);
    spells.update(hs, dt, now, W, H);
    pool.update(dt); fx.update(dt); stage.update(dt);

    gl.render(pool, spells.dustBoost || 1);
    fxCtx.clearRect(0, 0, W, H); darkCtx.clearRect(0, 0, W, H);
    fxCtx.globalCompositeOperation = 'lighter';
    spells.draw(fxCtx, darkCtx);
    fx.draw(fxCtx, darkCtx);
    fxCtx.globalCompositeOperation = 'source-over';

    // 自适应画质
    if (fps < 40) { lowT += dt; highT = 0; } else if (fps > 56) { highT += dt; lowT = 0; } else { lowT = highT = 0; }
    if (lowT > 1.5) { pool.budget = Math.max(0.35, pool.budget - 0.15); lowT = 0; }
    if (highT > 3) { pool.budget = Math.min(1, pool.budget + 0.1); highT = 0; }

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.25;
      for (const id in cards) cards[id].classList.toggle('on', spells.active.has(id));
      const g = hs.filter((h) => h.present).map((h) => GN[h.gesture] || h.gesture).join(' / ') || '—';
      hud.innerHTML = `<b>${mode === 'camera' ? '摄像头' : demo.auto ? '自动演示' : '键盘演示'}</b> · ${fps.toFixed(0)} FPS · 粒子 ${pool.n}` +
        (mode === 'camera' ? ` · 识别 ${tracker.ms.toFixed(1)}ms (${tracker.delegate})` : '') + `<br>手势：${g}`;
    }
    window.sorceryMetrics = { fps, particles: pool.n, hands: hs.length, gestures: hs.map((h) => h.gesture), active: [...spells.active], mode };
  }
  const GN = { open: '✋张开', fist: '✊握拳', point: '☝️食指', v: '✌️剑指', rock: '🤘', pinch: '🤏捏合', none: '…' };

  // ---------- 启动流程 ----------
  const intro = $('intro'), loading = $('loading'), errEl = $('err');
  function enter(m) {
    mode = m; intro.classList.add('hide');
    document.body.classList.toggle('nocam', m !== 'camera');
    $('hint').classList.toggle('show', m !== 'camera');
  }
  $('btn-cam').onclick = async () => {
    audio.init();
    errEl.textContent = '';
    loading.classList.add('show');
    try {
      await tracker.load((p, t) => { $('bar-in').style.width = (p * 100).toFixed(0) + '%'; $('load-text').textContent = t; });
      $('load-text').textContent = '请求摄像头权限…';
      await tracker.startCamera(video);
      loading.classList.remove('show');
      enter('camera');
    } catch (e) {
      console.error(e);
      loading.classList.remove('show');
      errEl.textContent = '启动失败：' + (e && e.name === 'NotAllowedError' ? '摄像头权限被拒绝' : e && e.name === 'NotFoundError' ? '未找到摄像头' : (e && e.message) || e) + '。可以先用「键盘演示」体验。';
    }
  };
  $('btn-demo').onclick = () => { audio.init(); enter('demo'); };
  $('btn-auto').onclick = () => { audio.init(); enter('demo'); demo.toggleAuto(); };

  addEventListener('pointermove', (e) => demo.onMouse(e.clientX, e.clientY, performance.now()));
  addEventListener('pointerdown', () => audio.init());
  addEventListener('dblclick', () => toggleFull());
  function toggleFull() { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); }
  const toggles = {
    m: () => setBtn('b-music', audio.toggleMusic()),
    b: () => { stage.camVisible = !stage.camVisible; setBtn('b-cam', stage.camVisible); },
    k: () => { spells.showSkeleton = !spells.showSkeleton; setBtn('b-skel', spells.showSkeleton); },
    h: () => document.body.classList.toggle('zen'),
    f: toggleFull,
    a: () => { if (mode === 'idle') { audio.init(); enter('demo'); } setBtn('b-auto', demo.toggleAuto()); },
    '/': () => $('help').classList.toggle('show'),
  };
  function setBtn(id, on) { $(id).classList.toggle('off', !on); }
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if ('123456789'.includes(k) && k.length === 1) { if (mode === 'idle') { audio.init(); enter('demo'); } demo.keyDown(k); return; }
    if (toggles[k]) toggles[k]();
    if (k === '?' ) toggles['/']();
  });
  addEventListener('keyup', (e) => demo.keyUp(e.key.toLowerCase()));
  $('b-music').onclick = () => { audio.init(); toggles.m(); };
  $('b-cam').onclick = toggles.b; $('b-skel').onclick = toggles.k; $('b-full').onclick = toggleFull; $('b-help').onclick = toggles['/'];
  $('b-auto').onclick = toggles.a;
  $('help').onclick = () => $('help').classList.remove('show');

  const q = new URLSearchParams(location.search);
  if (q.has('demo')) { enter('demo'); if (q.get('demo') === 'auto') setBtn('b-auto', demo.toggleAuto()); }
  if (q.has('zen')) document.body.classList.add('zen');
  requestAnimationFrame(loop);
  window.__sorcery = { spells, demo, pool, audio, hands, tracker };
})();
