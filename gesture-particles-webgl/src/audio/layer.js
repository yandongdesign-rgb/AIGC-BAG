/**
 * 音效层基类。新增音效：继承 SoundLayer，实现
 *   start()                         创建常驻节点（持续音）
 *   update(dt, weight, params)      每帧更新（weight = 对应特效的淡入淡出权重）
 *   trigger(event, params)          一次性音效（爆炸、电弧……）
 * 然后 Registry.registerSound('myLayer', MyLayer)，并在 config.mapping 里引用。
 *
 * 所有增益变化都用 setTargetAtTime 平滑，避免“咔哒”杂音。
 */
export class SoundLayer {
  constructor(engine, cfg) {
    this.e = engine;
    this.ac = engine.ac;
    this.cfg = cfg;
    this.enabled = cfg.enabled !== false;
    this.out = this.ac.createGain();
    this.out.gain.value = this.enabled ? cfg.volume ?? 0.7 : 0;
    this.out.connect(engine.bus);
    this.send = this.ac.createGain();
    this.send.gain.value = cfg.reverb ?? 0.3;
    this.out.connect(this.send);
    this.send.connect(engine.reverbIn);
  }
  setEnabled(on) {
    this.enabled = on;
    this.out.gain.setTargetAtTime(on ? this.cfg.volume ?? 0.7 : 0, this.ac.currentTime, 0.08);
  }
  start() {}
  update(dt, weight, params) {}
  trigger(event, params) {}

  // ---------- 工具 ----------
  get now() { return this.ac.currentTime; }
  gain(v = 0, dest = this.out) { const g = this.ac.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  /** tunable=true 的振荡器会跟随“双手距离音高” */
  osc(type, freq, dest, tunable = false) {
    const o = this.ac.createOscillator(); o.type = type; o.frequency.value = freq;
    if (dest) o.connect(dest);
    if (tunable) this.e.tunables.push(o.detune);
    return o;
  }
  filter(type, freq, Q = 1, dest) {
    const f = this.ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    if (dest) f.connect(dest);
    return f;
  }
  noise(kind = 'white', loop = true, dest) {
    const s = this.ac.createBufferSource();
    s.buffer = kind === 'brown' ? this.e.brownBuf : this.e.noiseBuf;
    s.loop = loop;
    if (!loop) s.loopStart = Math.random();
    if (dest) s.connect(dest);
    return s;
  }
  panner(x = 0.5, dest = this.out) {
    const p = this.ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, (x * 2 - 1) * 0.6)); p.connect(dest); return p;
  }
  /** 平滑设置参数 */
  to(param, v, tau = 0.08) { param.setTargetAtTime(v, this.now, tau); }
  /** 冲击包络：0 → peak（attack）→ 指数衰减（decay） */
  env(param, t, attack, peak, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
}
