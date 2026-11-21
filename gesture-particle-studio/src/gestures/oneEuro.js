/** One Euro 滤波：低速时强平滑去抖，高速时低延迟跟手。 */
class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}
const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.03, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = new LowPass();
    this.dx = new LowPass();
    this.prev = null;
  }
  filter(value, dt) {
    if (this.prev === null || dt <= 0) {
      this.prev = value;
      this.x.filter(value, 1);
      return value;
    }
    const d = this.dx.filter((value - this.prev) / dt, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(d);
    this.prev = value;
    return this.x.filter(value, alpha(cutoff, dt));
  }
}

export class LandmarkFilter {
  constructor(cfg) {
    this.f = Array.from({ length: 63 }, () => new OneEuro(cfg));
  }
  apply(lm, dt) {
    return lm.map((p, i) => ({
      x: this.f[i * 3].filter(p.x, dt),
      y: this.f[i * 3 + 1].filter(p.y, dt),
      z: this.f[i * 3 + 2].filter(p.z || 0, dt),
    }));
  }
}
