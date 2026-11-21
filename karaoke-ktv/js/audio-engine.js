/**
 * ============================================================
 *  音频控制模块（AudioEngine）—— 基于原生 Web Audio API
 *
 *  信号链：
 *   [原唱 AudioBuffer] → origGain ┐
 *   [伴奏 AudioBuffer] → accGain  ┴→ musicBus → 升降调 → musicVol(伴奏音量) ┬→ master(总音量) → 扬声器
 *                                                                           └→ recBus(录音)
 *   [麦克风] → 高通 → 压缩 → micVol(麦克风音量) → 干声 + 混响 → micOut ┬→ monitor(监听开关) → master
 *                                                                     └→ recBus(录音)
 *  原唱/伴奏是两条独立音轨同步播放，切换时交叉淡入淡出（非简单降音量）。
 * ============================================================
 */
(function (global) {
  'use strict';

  const FADE = 0.18; // 原唱/伴奏切换淡变时长（秒）

  /** 把各种来源（data URL / Blob / ArrayBuffer / 路径）转成 ArrayBuffer */
  async function toArrayBuffer(src) {
    if (!src) throw new Error('音频源为空');
    if (src instanceof ArrayBuffer) return src.slice(0);
    if (src instanceof Blob) return await src.arrayBuffer();
    if (typeof src === 'string' && src.startsWith('data:')) {
      const b64 = src.slice(src.indexOf(',') + 1);
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    }
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.status);
      return await res.arrayBuffer();
    } catch (e) {
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', src); xhr.responseType = 'arraybuffer';
        xhr.onload = () => (xhr.status === 0 || xhr.status === 200) && xhr.response ? resolve(xhr.response) : reject(new Error('load fail'));
        xhr.onerror = () => reject(new Error(
          '无法读取音频文件：' + src + '\n浏览器禁止本地页面直接读取文件路径，请使用「上传歌曲」导入，或使用「导出歌曲包」生成 .js 歌曲包。'));
        xhr.send();
      });
    }
  }

  class AudioEngine extends EventTarget {
    constructor() {
      super();
      this.ctx = null;
      this.buffers = null;        // { original, instrumental, instrumentalKind }
      this.sources = [];
      this.playing = false;
      this.offset = 0;            // 暂停时的播放位置
      this.startAt = 0;           // ctx 时间基准
      this.playToken = 0;
      this.vocalMode = 'original';// original | accompaniment
      this.semitones = 0;
      this.vol = { master: 0.85, music: 0.9, mic: 0.8 };
      this.muted = false;
      this.mic = { stream: null, source: null, enabled: false, monitor: true, reverb: 0.35, echoCancel: true };
      this.recorder = null;
      this.decodeCache = new Map();
    }

    /** 必须在用户手势中调用（浏览器自动播放策略） */
    async init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

      this.origGain = g(1);
      this.accGain = g(0);
      this.musicBus = g(1);
      this.musicVol = g(this.vol.music);
      this.master = g(this.vol.master);
      this.outAnalyser = ctx.createAnalyser();
      this.outAnalyser.fftSize = 512;
      this.recBus = g(1);
      this.recDest = ctx.createMediaStreamDestination();

      this.pitch = await global.KTVPitch.createPitchShifterNode(ctx);
      this.origGain.connect(this.musicBus);
      this.accGain.connect(this.musicBus);
      this.musicBus.connect(this.pitch.input);
      this.pitch.output.connect(this.musicVol);
      this.musicVol.connect(this.master);
      this.musicVol.connect(this.recBus);
      this.master.connect(this.outAnalyser);
      this.outAnalyser.connect(ctx.destination);
      this.recBus.connect(this.recDest);

      // 麦克风链路（麦克风开启时接入 micIn）
      this.micIn = g(1);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -22; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.2;
      this.micAnalyser = ctx.createAnalyser(); this.micAnalyser.fftSize = 2048;
      this.micVol = g(this.vol.mic * 1.4);
      this.micDry = g(1);
      this.micWet = g(this.mic.reverb);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._makeImpulse(2.2, 2.8);
      this.micOut = g(1);
      this.monitor = g(this.mic.monitor ? 1 : 0);
      this.micIn.connect(hp); hp.connect(comp); comp.connect(this.micAnalyser);
      comp.connect(this.micVol);
      this.micVol.connect(this.micDry); this.micDry.connect(this.micOut);
      this.micVol.connect(this.reverb); this.reverb.connect(this.micWet); this.micWet.connect(this.micOut);
      this.micOut.connect(this.monitor); this.monitor.connect(this.master);
      this.micOut.connect(this.recBus);
      this.pitch.setSemitones(this.semitones);
      this._applyMaster();
    }

    /** KTV 混响脉冲响应（指数衰减噪声） */
    _makeImpulse(seconds, decay) {
      const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
      const buf = this.ctx.createBuffer(2, len, rate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < rate * 0.015 ? 0 : 1);
      }
      return buf;
    }

    async decode(src, cacheKey) {
      if (cacheKey && this.decodeCache.has(cacheKey)) return this.decodeCache.get(cacheKey);
      const p = toArrayBuffer(src).then((ab) => this.ctx.decodeAudioData(ab));
      if (cacheKey) {
        this.decodeCache.set(cacheKey, p);
        p.catch(() => this.decodeCache.delete(cacheKey));
        // 只缓存最近几首，避免内存过大
        while (this.decodeCache.size > 6) this.decodeCache.delete(this.decodeCache.keys().next().value);
      }
      return p;
    }

    /** 无独立伴奏时：用声道相减（中置人声消除）生成"消音伴奏"，并保留低频 */
    async makeVocalRemoved(buffer) {
      if (buffer.numberOfChannels < 2) return null;
      const off = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
      const src = off.createBufferSource(); src.buffer = buffer;
      const split = off.createChannelSplitter(2), merge = off.createChannelMerger(2);
      const l = off.createGain(), r = off.createGain(); l.gain.value = 1; r.gain.value = -1;
      const side = off.createGain();
      src.connect(split); split.connect(l, 0); split.connect(r, 1); l.connect(side); r.connect(side);
      side.connect(merge, 0, 0); side.connect(merge, 0, 1);
      const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const lpg = off.createGain(); lpg.gain.value = 0.8;
      src.connect(lp); lp.connect(lpg); lpg.connect(merge, 0, 0); lpg.connect(merge, 0, 1);
      merge.connect(off.destination);
      src.start();
      return await off.startRendering();
    }

    /** 加载歌曲（song 对象由曲库模块提供） */
    async load(song) {
      await this.init();
      this.stop();
      const original = await this.decode(song.original, song.id + ':o');
      let instrumental = null, kind = 'track';
      if (song.instrumental) instrumental = await this.decode(song.instrumental, song.id + ':i');
      else { instrumental = await this.makeVocalRemoved(original); kind = instrumental ? 'removed' : 'none'; }
      this.buffers = { original, instrumental, instrumentalKind: kind };
      this.offset = 0;
      return this.buffers;
    }

    /** 预加载下一首，减少切歌等待 */
    preload(song) {
      if (!this.ctx || !song) return;
      this.decode(song.original, song.id + ':o').catch(() => {});
      if (song.instrumental) this.decode(song.instrumental, song.id + ':i').catch(() => {});
    }

    get duration() { return this.buffers ? this.buffers.original.duration : 0; }
    get currentTime() {
      if (!this.buffers) return 0;
      const t = this.playing ? this.ctx.currentTime - this.startAt : this.offset;
      return Math.max(0, Math.min(t, this.duration));
    }

    play(at) {
      if (!this.buffers) return;
      if (typeof at === 'number') this.offset = at;
      this._stopSources();
      const token = ++this.playToken;
      const when = this.ctx.currentTime + 0.03;
      const mk = (buf, dest) => {
        if (!buf) return null;
        const s = this.ctx.createBufferSource();
        s.buffer = buf; s.connect(dest); s.start(when, Math.min(this.offset, buf.duration - 0.01));
        return s;
      };
      const so = mk(this.buffers.original, this.origGain);
      const si = mk(this.buffers.instrumental, this.accGain);
      this.sources = [so, si].filter(Boolean);
      so.onended = () => {
        if (token !== this.playToken || !this.playing) return;
        this.playing = false; this.offset = this.duration;
        this.dispatchEvent(new Event('ended'));
      };
      this.startAt = when - this.offset;
      this.playing = true;
      this._applyVocalMode(true);
      this.dispatchEvent(new Event('state'));
    }

    pause() {
      if (!this.playing) return;
      this.offset = this.currentTime;
      this.playing = false;
      this._stopSources();
      this.dispatchEvent(new Event('state'));
    }

    toggle() { this.playing ? this.pause() : this.play(); }
    seek(t) {
      t = Math.max(0, Math.min(t, this.duration - 0.05));
      if (this.playing) this.play(t); else this.offset = t;
      this.dispatchEvent(new Event('state'));
    }
    stop() {
      this.playToken++;
      this._stopSources();
      this.playing = false; this.offset = 0;
      this.dispatchEvent(new Event('state'));
    }
    _stopSources() {
      this.sources.forEach((s) => { try { s.onended = null; s.stop(); s.disconnect(); } catch (e) {} });
      this.sources = [];
    }

    /* ---------------- 原唱 / 伴奏 ---------------- */
    hasAccompaniment() { return !!(this.buffers && this.buffers.instrumental); }
    setVocalMode(mode) {
      if (mode === 'accompaniment' && this.buffers && !this.buffers.instrumental) return false;
      this.vocalMode = mode;
      this._applyVocalMode(false);
      this.dispatchEvent(new Event('state'));
      return true;
    }
    _applyVocalMode(instant) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const acc = this.vocalMode === 'accompaniment' && this.buffers && this.buffers.instrumental;
      const set = (p, v) => {
        p.cancelScheduledValues(t);
        if (instant) p.setValueAtTime(v, t);
        else { p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + FADE); }
      };
      set(this.origGain.gain, acc ? 0 : 1);
      set(this.accGain.gain, acc ? 1 : 0);
    }

    /* ---------------- 音量 / 静音 / 升降调 ---------------- */
    _ramp(param, v) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + 0.06);
    }
    _applyMaster() { if (this.master) this._ramp(this.master.gain, this.muted ? 0 : this.vol.master); }
    setVolume(kind, v) {
      this.vol[kind] = v;
      if (!this.ctx) return;
      if (kind === 'master') this._applyMaster();
      if (kind === 'music') this._ramp(this.musicVol.gain, v);
      if (kind === 'mic') this._ramp(this.micVol.gain, v * 1.4);
    }
    setMuted(m) { this.muted = m; this._applyMaster(); this.dispatchEvent(new Event('state')); }
    setSemitones(n) {
      this.semitones = Math.max(-6, Math.min(6, n));
      if (this.pitch) this.pitch.setSemitones(this.semitones);
      this.dispatchEvent(new Event('state'));
      return this.semitones;
    }

    /* ---------------- 麦克风 ---------------- */
    async enableMic() {
      await this.init();
      if (this.mic.enabled) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('当前浏览器不支持麦克风采集');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.mic.echoCancel, noiseSuppression: this.mic.echoCancel,
          autoGainControl: false, channelCount: 1, latency: 0,
        },
      });
      this.mic.stream = stream;
      this.mic.source = this.ctx.createMediaStreamSource(stream);
      this.mic.source.connect(this.micIn);
      this.mic.enabled = true;
      this.dispatchEvent(new Event('state'));
    }
    disableMic() {
      if (!this.mic.enabled) return;
      try { this.mic.source.disconnect(); } catch (e) {}
      this.mic.stream.getTracks().forEach((t) => t.stop());
      this.mic.stream = null; this.mic.source = null; this.mic.enabled = false;
      this.dispatchEvent(new Event('state'));
    }
    async setEchoCancel(on) {
      this.mic.echoCancel = on;
      if (this.mic.enabled) { this.disableMic(); await this.enableMic(); }
    }
    setMonitor(on) {
      this.mic.monitor = on;
      if (this.monitor) this._ramp(this.monitor.gain, on ? 1 : 0);
      this.dispatchEvent(new Event('state'));
    }
    setReverb(v) { this.mic.reverb = v; if (this.micWet) this._ramp(this.micWet.gain, v); }

    /** 麦克风电平（0~1）+ 简易基频检测，用于打分和电平表 */
    readMic() {
      if (!this.mic.enabled) return { rms: 0, pitch: 0 };
      const a = this.micAnalyser;
      const buf = this._micBuf || (this._micBuf = new Float32Array(a.fftSize));
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      return { rms, pitch: rms > 0.01 ? this._detectPitch(buf) : 0 };
    }
    _detectPitch(buf) {
      const sr = this.ctx.sampleRate, n = buf.length;
      const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 75);
      let best = 0, bestLag = 0, e0 = 0;
      for (let i = 0; i < n; i++) e0 += buf[i] * buf[i];
      for (let lag = minLag; lag < maxLag; lag += 2) {
        let c = 0;
        for (let i = 0; i < n - lag; i += 2) c += buf[i] * buf[i + lag];
        if (c > best) { best = c; bestLag = lag; }
      }
      const clarity = best / (e0 / 2 + 1e-9);
      return clarity > 0.45 && bestLag ? sr / bestLag : 0;
    }
    readOutputLevel() {
      if (!this.outAnalyser) return 0;
      const a = this.outAnalyser;
      const buf = this._outBuf || (this._outBuf = new Uint8Array(a.frequencyBinCount));
      a.getByteFrequencyData(buf);
      return buf;
    }

    /* ---------------- 录音 ---------------- */
    get recording() { return !!(this.recorder && this.recorder.state === 'recording'); }
    async startRecording() {
      await this.init();
      if (this.recording) return;
      const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = types.find((t) => global.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      if (!global.MediaRecorder) throw new Error('当前浏览器不支持录音（MediaRecorder）');
      const rec = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      this._recDone = new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }));
      });
      rec.start(1000);
      this.recorder = rec;
      this.recStartedAt = performance.now();
      this.dispatchEvent(new Event('state'));
    }
    async stopRecording() {
      if (!this.recording) return null;
      this.recorder.stop();
      const blob = await this._recDone;
      const dur = (performance.now() - this.recStartedAt) / 1000;
      this.recorder = null;
      this.dispatchEvent(new Event('state'));
      return { blob, duration: dur };
    }

    /** 把录音（webm/ogg）解码后编码为 16bit WAV，方便任何播放器收听 */
    async toWav(blob) {
      await this.init();
      const buf = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      const ch = Math.min(2, buf.numberOfChannels), len = buf.length, sr = buf.sampleRate;
      const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
      const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true);
      dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * ch * 2, true);
      const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
      let o = 44;
      for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      }
      return new Blob([dv], { type: 'audio/wav' });
    }
  }

  global.KTVAudio = { AudioEngine, toArrayBuffer };
})(window);
