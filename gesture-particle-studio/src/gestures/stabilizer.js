/** 防抖：候选状态需持续 debounceMs 才切换；unknown 在 unknownHoldMs 内保持上一个状态。 */
export class Stabilizer {
  constructor(cfg) {
    this.cfg = cfg;
    this.state = 'none';
    this.candidate = null;
    this.since = 0;
    this.lastKnown = 0;
  }

  update(raw, now) {
    const prev = this.state;
    if (raw === 'unknown') {
      if (now - this.lastKnown < this.cfg.unknownHoldMs) return { state: this.state, changed: false, prev };
      raw = 'none';
    } else {
      this.lastKnown = now;
    }
    if (raw === this.state) {
      this.candidate = null;
      return { state: this.state, changed: false, prev };
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = now;
    }
    const wait = this.cfg.debounceOverrides?.[raw] ?? this.cfg.debounceMs;
    if (now - this.since >= wait) {
      this.state = raw;
      this.candidate = null;
      return { state: raw, changed: true, prev };
    }
    return { state: this.state, changed: false, prev };
  }
}
