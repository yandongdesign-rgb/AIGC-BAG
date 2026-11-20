/** One-Euro 滤波器：低速时强平滑、高速时低延迟，适合手部关键点去抖 */
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.prev = null;
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.prev = null; }
  filter(v, dt) {
    if (dt <= 0) dt = 1 / 60;
    const d = this.prev === null ? 0 : (v - this.prev) / dt;
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    this.prev = v;
    return this.x.filter(v, alpha(cutoff, dt));
  }
}

/** 21 关键点 × xyz 的滤波器组 */
export class LandmarkFilter {
  constructor(opts) { this.opts = opts; this.f = Array.from({ length: 63 }, () => new OneEuro(opts)); }
  reset() { this.f.forEach((f) => f.reset()); }
  apply(lms, dt) {
    return lms.map((p, i) => ({
      x: this.f[i * 3].filter(p.x, dt),
      y: this.f[i * 3 + 1].filter(p.y, dt),
      z: this.f[i * 3 + 2].filter(p.z || 0, dt),
    }));
  }
}
