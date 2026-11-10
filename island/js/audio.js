// 程序化音频：生成式背景音乐 + 海浪/风/雨/虫鸣环境声 + 各种音效（全部由 WebAudio 实时合成）
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = {
  day: [
    { root: 48, notes: [60, 64, 67, 71, 74] },   // Cmaj9
    { root: 45, notes: [57, 60, 64, 67, 71] },   // Am9
    { root: 41, notes: [57, 60, 64, 65, 69] },   // Fmaj7
    { root: 43, notes: [55, 60, 62, 64, 67] },   // G6sus
  ],
  night: [
    { root: 45, notes: [57, 60, 64, 67, 71] },   // Am9
    { root: 41, notes: [53, 57, 60, 64, 69] },   // Fmaj7
    { root: 38, notes: [50, 57, 60, 62, 65] },   // Dm9
    { root: 40, notes: [52, 55, 59, 62, 67] },   // Em7
  ],
  storm: [
    { root: 38, notes: [50, 53, 57, 62] },        // Dm
    { root: 46, notes: [50, 53, 58, 62] },        // Bb
    { root: 43, notes: [50, 55, 58, 62] },        // Gm
    { root: 45, notes: [49, 52, 57, 61] },        // A
  ],
};
const PENTA = { day: [0, 2, 4, 7, 9], night: [0, 2, 3, 7, 9], storm: [0, 2, 3, 7, 8] };
const KEYROOT = { day: 72, night: 69, storm: 62 };

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.musicOn = true; this.listener = { x: 0, z: 0, yaw: 0 }; this.ksCache = new Map(); }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.makeIR(3.8);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.5; this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.42; this.musicBus.connect(this.master);
    this.musicRev = ctx.createGain(); this.musicRev.gain.value = 0.6; this.musicBus.connect(this.musicRev); this.musicRev.connect(this.reverb);
    this.delay = ctx.createDelay(2); this.delay.delayTime.value = 0.59;
    const fb = ctx.createGain(); fb.gain.value = 0.33; const dlp = ctx.createBiquadFilter(); dlp.frequency.value = 2500;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay); dlp.connect(this.musicBus);
    this.ambFilter = ctx.createBiquadFilter(); this.ambFilter.type = 'lowpass'; this.ambFilter.frequency.value = 18000;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.85; this.ambBus.connect(this.ambFilter); this.ambFilter.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    const sfxRev = ctx.createGain(); sfxRev.gain.value = 0.18; this.sfxBus.connect(sfxRev); sfxRev.connect(this.reverb);
    this.sfxRev = sfxRev;

    this.white = this.noiseBuffer(3, 'white'); this.brown = this.noiseBuffer(5, 'brown'); this.pink = this.noiseBuffer(4, 'pink');
    // 环境声层
    this.ocean = this.loop(this.brown, 'lowpass', 520, 0.7);
    this.surf = this.loop(this.pink, 'bandpass', 1400, 0.6);
    this.windL = this.loop(this.pink, 'bandpass', 500, 1.4);
    this.windLow = this.loop(this.brown, 'lowpass', 180, 0.7);
    this.rainL = this.loop(this.white, 'highpass', 1200, 0.5);
    this.rainLow = this.loop(this.pink, 'lowpass', 900, 0.5);
    this.fireL = this.loop(this.brown, 'lowpass', 350, 0.8);
    this.swimL = this.loop(this.pink, 'bandpass', 700, 1.2);
    this.ready = true;
    this.mood = 'day'; this.bar = 0; this.beat = 0; this.nextT = ctx.currentTime + 0.3; this.melNote = 2;
    this.bpm = 78; this.chordIdx = 0;
    this.sched = setInterval(() => this.schedule(), 60);
    this.crickT = 0; this.tweetT = 2; this.crackT = 0;
  }
  setVolume(kind, v) { if (!this.ready) return; ({ master: this.master, music: this.musicBus, amb: this.ambBus, sfx: this.sfxBus })[kind].gain.value = v; }
  toggleMusic() { this.musicOn = !this.musicOn; if (this.ready) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.42 : 0, this.ctx.currentTime, 0.5); return this.musicOn; }

  makeIR(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8) * (i < 200 ? i / 200 : 1); }
    return b;
  }
  noiseBuffer(sec, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    }
    return b;
  }
  loop(buf, type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner();
    src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.ambBus); src.start(ctx.currentTime + Math.random());
    return { src, f, g, pan };
  }
  setL(l, v, tc = 0.15) { l.g.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, tc); }

  // 每帧更新环境声
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.listener = s.listener;
    const near = Math.max(0, 1 - Math.max(0, s.coastDist + 4) / 70);
    const surge = Math.pow((Math.sin(t * 0.84 + Math.sin(t * 0.13) * 2) + 1) / 2, 2);
    const shelter = s.inCave ? 0.35 : 1;
    this.setL(this.ocean, (0.08 + near * (0.35 + 0.55 * surge)) * (0.7 + s.wave * 0.6) * shelter, 0.3);
    this.setL(this.surf, near * Math.pow(surge, 3) * 0.45 * (0.6 + s.wave) * shelter, 0.2);
    this.surf.f.frequency.setTargetAtTime(900 + surge * 1400, t, 0.3);
    const wind = s.wind * (0.8 + 0.3 * Math.sin(t * 0.5) + 0.2 * Math.sin(t * 1.7));
    this.setL(this.windL, Math.pow(Math.max(0, wind), 1.6) * 0.22 * (s.inCave ? 0.4 : 1) + (s.inCave ? 0.02 : 0), 0.3);
    this.windL.f.frequency.setTargetAtTime(350 + wind * 600 + Math.sin(t * 0.7) * 150, t, 0.4);
    this.setL(this.windLow, Math.pow(Math.max(0, wind), 2) * 0.25 + s.height * 0.004, 0.4);
    this.setL(this.rainL, s.rain * 0.22 * (s.inCave ? 0.6 : 1), 0.4);
    this.setL(this.rainLow, s.rain * 0.3, 0.4);
    this.ambFilter.frequency.setTargetAtTime(s.inCave ? 1400 : 18000, t, 0.4);
    this.setL(this.fireL, s.fireNear * 0.35, 0.3);
    this.setL(this.swimL, s.swimming ? 0.25 * s.moving : 0, 0.15);
    this.revGain.gain.setTargetAtTime(s.inCave ? 1.0 : 0.5, t, 0.5);
    this.sfxRev.gain.setTargetAtTime(s.inCave ? 0.8 : 0.18, t, 0.5);
    // 篝火噼啪
    if (s.fireNear > 0.05) { this.crackT -= dt; if (this.crackT < 0) { this.crackT = Math.random() * 0.25; this.click(0.06 + Math.random() * 0.25 * s.fireNear, 1500 + Math.random() * 3000); } }
    // 夜晚虫鸣
    if (s.night > 0.5 && s.rain < 0.3 && !s.inCave) { this.crickT -= dt; if (this.crickT < 0) { this.crickT = 0.35 + Math.random() * 0.6; this.cricket(0.035 * s.night * (s.coastDist < -15 ? 1 : 0.5)); } }
    // 白天林中鸟鸣
    if (s.day > 0.6 && s.rain < 0.2 && s.coastDist < -20 && !s.inCave) { this.tweetT -= dt; if (this.tweetT < 0) { this.tweetT = 1.5 + Math.random() * 5; this.tweet(0.06 + Math.random() * 0.05); } }
    // 音乐情绪
    this.mood = s.storm > 0.6 ? 'storm' : s.night > 0.6 ? 'night' : 'day';
    this.bpm = this.mood === 'night' ? 62 : this.mood === 'storm' ? 70 : 80;
  }

  // ---------- 生成式音乐 ----------
  schedule() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    while (this.nextT < ctx.currentTime + 0.25) { this.playStep(this.nextT); this.advance(); }
  }
  advance() {
    const sixteenth = 60 / this.bpm / 4;
    this.nextT += sixteenth; this.beat++;
    if (this.beat >= 16) { this.beat = 0; this.bar++; if (this.bar % 2 === 0) this.chordIdx = (this.chordIdx + 1) % 4; }
  }
  playStep(t) {
    if (!this.musicOn) return;
    const mood = this.mood, ch = CHORDS[mood][this.chordIdx], b = this.beat, s16 = 60 / this.bpm / 4;
    const swing = (b % 4 === 2) ? s16 * 0.28 : 0;
    // 和弦铺底（两小节一次）
    if (b === 0 && this.bar % 2 === 0) for (const n of ch.notes.slice(0, 4)) this.pad(t, mtof(n), s16 * 32 + 0.5, mood === 'storm' ? 0.03 : 0.035);
    // 低音
    if (b === 0) this.bass(t, mtof(ch.root), mood === 'night' ? 0.16 : 0.2);
    if (b === 10 && mood === 'day') this.bass(t, mtof(ch.root + 7 - 12 + 12), 0.1);
    // 尤克里里扫弦（白天）
    if (mood === 'day' && (b === 4 || b === 12 || (b === 14 && Math.random() < 0.4))) this.strum(t + swing, ch.notes.slice(0, 4), b === 14 ? 0.05 : 0.08, b === 12);
    // 沙锤
    if (mood === 'day' && b % 2 === 0) this.shaker(t + swing, b % 4 === 0 ? 0.012 : 0.022);
    // 卡林巴旋律
    const prob = mood === 'day' ? 0.32 : mood === 'night' ? 0.2 : 0.14;
    if (b % 2 === 0 && Math.random() < prob) {
      this.melNote = Math.max(0, Math.min(9, this.melNote + Math.floor(Math.random() * 5) - 2));
      const sc = PENTA[mood], oct = Math.floor(this.melNote / 5), deg = sc[this.melNote % 5];
      const n = KEYROOT[mood] + deg + oct * 12 - (mood === 'night' ? 12 : 0);
      if (mood === 'night' && Math.random() < 0.5) this.pluck(t + swing, n, 0.07); else this.kalimba(t + swing, mtof(n), 0.09);
    }
  }
  env(g, t, a, peak, dur, rel) {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0, t + a + dur, rel);
  }
  pad(t, f, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = this.mood === 'night' ? 700 : 1300; lp.Q.value = 0.5;
    for (const [type, det] of [['triangle', -6], ['sine', 5], ['sawtooth', 9]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = type === 'sawtooth' ? 0.12 : 0.5;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 4);
    }
    lp.connect(g); g.connect(this.musicBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 1.8); g.gain.setValueAtTime(vol, t + dur - 1); g.gain.linearRampToValueAtTime(0, t + dur + 2.5);
  }
  bass(t, f, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2; const g2 = ctx.createGain(); g2.gain.value = 0.15;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.musicBus);
    this.env(g, t, 0.02, vol, 0.2, 0.6); o.start(t); o2.start(t); o.stop(t + 4); o2.stop(t + 4);
  }
  kalimba(t, f, vol) {
    const ctx = this.ctx, g = ctx.createGain();
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 5.4; const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.musicBus); g.connect(this.delay);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.8);
    o.start(t); o2.start(t); o.stop(t + 2); o2.stop(t + 2);
  }
  ksBuffer(midi) {
    if (this.ksCache.has(midi)) return this.ksCache.get(midi);
    const sr = this.ctx.sampleRate, f = mtof(midi), N = Math.round(sr / f), len = Math.floor(sr * 2.2);
    const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.5 + w * 0.5; d[i] = prev; }
    const damp = 0.4962 + Math.min(0.0035, f / 200000);
    for (let i = N; i < len; i++) d[i] = (d[i - N] + d[i - N + 1 < i ? i - N + 1 : i - N]) * damp;
    this.ksCache.set(midi, b); return b;
  }
  pluck(t, midi, vol) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.ksBuffer(midi);
    const g = ctx.createGain(); g.gain.value = vol; const lp = ctx.createBiquadFilter(); lp.frequency.value = 3200;
    src.connect(lp); lp.connect(g); g.connect(this.musicBus); g.connect(this.delay); src.start(t);
  }
  strum(t, notes, vol, down) {
    const order = down ? notes : [...notes].reverse();
    order.forEach((n, i) => this.pluck(t + i * 0.018, n, vol * (1 - i * 0.08)));
  }
  shaker(t, vol) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.white;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); src.connect(hp); hp.connect(g); g.connect(this.musicBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
    src.start(t, Math.random() * 2, 0.12);
  }

  // ---------- 音效 ----------
  panFor(pos) {
    if (!pos) return { pan: 0, vol: 1 };
    const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz) || 1;
    const pan = (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d; // 与右方向点积
    return { pan: Math.max(-1, Math.min(1, pan)), vol: 1 / (1 + d / 18) };
  }
  out(vol, pos) {
    const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner();
    const pv = this.panFor(pos); p.pan.value = pv.pan * 0.8; g.gain.value = vol * pv.vol;
    g.connect(p); p.connect(this.sfxBus); return g;
  }
  noiseHit(t, vol, type, freq, q, dur, out, freqEnd) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.start(t, Math.random() * 2, dur + 0.05);
  }
  tone(t, type, f0, f1, dur, vol, out, attack = 0.005) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  click(vol, f) { const t = this.ctx.currentTime; this.noiseHit(t, vol, 'bandpass', f, 2, 0.03, this.out(1)); }
  cricket(vol) {
    const t = this.ctx.currentTime, out = this.out(vol, { x: this.listener.x + (Math.random() - 0.5) * 30, z: this.listener.z + (Math.random() - 0.5) * 30 });
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) this.tone(t + i * 0.045, 'sine', f, null, 0.03, 1, out, 0.003);
  }
  tweet(vol) {
    const t = this.ctx.currentTime, out = this.out(vol, { x: this.listener.x + (Math.random() - 0.5) * 40, z: this.listener.z + (Math.random() - 0.5) * 40 });
    const n = 2 + Math.floor(Math.random() * 5), base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) this.tone(t + i * 0.11, 'sine', base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.6), 0.08, 1, out);
  }
  gull(vol, pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, out = this.out(vol * 0.5, pos);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.32, o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(1100, tt); o.frequency.linearRampToValueAtTime(1550, tt + 0.06); o.frequency.exponentialRampToValueAtTime(900, tt + 0.26);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 2.5;
      const g = ctx.createGain(); o.connect(bp); bp.connect(g); g.connect(out);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.5, tt + 0.03); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.28);
      o.start(tt); o.stop(tt + 0.3);
    }
  }
  thunder(dist, delay) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, vol = 1.2 / (1 + dist / 160);
    const out = this.out(1);
    if (dist < 150) this.noiseHit(t, vol * 0.8, 'highpass', 1500, 0.7, 0.35, out);
    const src = ctx.createBufferSource(); src.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(dist < 150 ? 1600 : 700, t); lp.frequency.exponentialRampToValueAtTime(90, t + 5);
    const g = ctx.createGain(); src.connect(lp); lp.connect(g); g.connect(out); g.connect(this.reverb);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 2, t + 0.12);
    for (let i = 1; i < 6; i++) g.gain.linearRampToValueAtTime(vol * (2 - i * 0.3) * (0.5 + Math.random() * 0.6), t + i * 0.55 + Math.random() * 0.3);
    g.gain.linearRampToValueAtTime(0, t + 6);
    src.start(t, Math.random() * 3, 6.5);
  }
  conch() {
    const ctx = this.ctx, t = ctx.currentTime, out = this.out(0.5);
    for (const [f, v] of [[196, 0.5], [294, 0.25], [392, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.94, t); o.frequency.linearRampToValueAtTime(f, t + 0.4);
      const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = f * 0.008; vib.connect(vg); vg.connect(o.frequency);
      const lp = ctx.createBiquadFilter(); lp.frequency.value = 900; lp.Q.value = 1.5;
      const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(out); g.connect(this.reverb);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.35); g.gain.setValueAtTime(v, t + 2.0); g.gain.linearRampToValueAtTime(0, t + 2.8);
      o.start(t); vib.start(t); o.stop(t + 3); vib.stop(t + 3);
    }
  }
  chime() {
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this.kalimbaSfx(t + i * 0.09, mtof(n), 0.12));
  }
  kalimbaSfx(t, f, vol) { const out = this.out(1); this.tone(t, 'sine', f, null, 1.2, vol, out); this.tone(t, 'sine', f * 4, null, 0.15, vol * 0.2, out); }
  step(surface, vol = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.out(vol * 0.9);
    if (surface === 'sand') { this.noiseHit(t, 0.12, 'lowpass', 1100, 0.7, 0.14, out); this.noiseHit(t + 0.03, 0.06, 'bandpass', 3000, 1, 0.08, out); }
    else if (surface === 'grass') { this.noiseHit(t, 0.08, 'bandpass', 2600, 0.8, 0.12, out); this.noiseHit(t + 0.02, 0.05, 'highpass', 5000, 0.8, 0.07, out); }
    else if (surface === 'rock') { this.tone(t, 'sine', 160, 90, 0.07, 0.15, out); this.noiseHit(t, 0.06, 'bandpass', 1800, 2, 0.05, out); }
    else if (surface === 'water') { this.noiseHit(t, 0.14, 'bandpass', 900, 1.2, 0.25, out, 400); this.tone(t + 0.05, 'sine', 500, 900, 0.08, 0.03, out); }
  }
  sfx(name, vol = 1, pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.out(vol, pos);
    switch (name) {
      case 'pick': this.tone(t, 'sine', 520, 980, 0.12, 0.25, out); this.tone(t + 0.05, 'triangle', 1300, null, 0.1, 0.06, out); break;
      case 'drop': this.tone(t, 'sine', 600, 300, 0.12, 0.15, out); break;
      case 'throw': this.noiseHit(t, 0.35 * vol, 'bandpass', 500, 1.2, 0.35, out, 2600); break;
      case 'splash': this.noiseHit(t, 0.5, 'lowpass', 2500, 0.6, 0.6, out, 300); for (let i = 0; i < 4; i++) this.tone(t + 0.05 + Math.random() * 0.25, 'sine', 600 + Math.random() * 900, 1500 + Math.random() * 800, 0.06, 0.05, out); break;
      case 'plip': this.tone(t, 'sine', 1400, 600, 0.09, 0.3, out); this.noiseHit(t, 0.15, 'highpass', 3000, 0.8, 0.06, out); break;
      case 'thud': this.tone(t, 'sine', 140, 60, 0.15, 0.4, out); this.noiseHit(t, 0.15, 'bandpass', 900, 1, 0.08, out); break;
      case 'thudSoft': this.noiseHit(t, 0.25, 'lowpass', 600, 0.7, 0.18, out); break;
      case 'clack': this.tone(t, 'square', 900, 400, 0.04, 0.15, out); this.noiseHit(t, 0.2, 'bandpass', 2500, 3, 0.05, out); break;
      case 'thunk': this.tone(t, 'sine', 220, 110, 0.18, 0.45, out); this.tone(t, 'triangle', 330, 160, 0.12, 0.15, out); break;
      case 'rustle': for (let i = 0; i < 6; i++) this.noiseHit(t + i * 0.07, 0.15, 'highpass', 3500, 0.6, 0.18, out); break;
      case 'crab': for (let i = 0; i < 5; i++) this.noiseHit(t + i * 0.035, 0.18, 'bandpass', 4000, 6, 0.02, out); break;
      case 'flap': for (let i = 0; i < 5; i++) this.noiseHit(t + i * 0.12, 0.2, 'lowpass', 800, 1, 0.08, out); break;
      case 'shutter': this.noiseHit(t, 0.4, 'highpass', 2000, 1, 0.04, out); this.noiseHit(t + 0.09, 0.3, 'highpass', 3000, 1, 0.05, out); this.tone(t, 'square', 1800, null, 0.02, 0.05, out); break;
      case 'jump': this.noiseHit(t, 0.12, 'lowpass', 900, 0.7, 0.12, out); break;
      case 'drink': for (let i = 0; i < 4; i++) this.tone(t + i * 0.28, 'sine', 300, 180, 0.15, 0.25, out); break;
      case 'ignite': this.noiseHit(t, 0.4, 'bandpass', 600, 0.5, 1.2, out, 2000); this.tone(t, 'sine', 80, 120, 1.0, 0.2, out, 0.3); break;
      case 'store': this.tone(t, 'sine', 880, 1320, 0.1, 0.18, out); this.tone(t + 0.08, 'sine', 1320, 1760, 0.12, 0.12, out); break;
      case 'cork': this.tone(t, 'sine', 700, 200, 0.06, 0.4, out); this.noiseHit(t, 0.2, 'highpass', 2000, 1, 0.04, out); break;
      case 'ui': this.tone(t, 'sine', 900, null, 0.05, 0.1, out); break;
      case 'shell': this.noiseHit(t, 0.25, 'bandpass', 600, 0.6, 2.5, out, 900); break; // 海螺里的海声
      case 'wave': this.noiseHit(t, 0.3, 'lowpass', 1200, 0.6, 1.6, out, 300); break;
    }
  }
}
