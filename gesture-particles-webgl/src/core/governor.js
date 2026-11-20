/** 性能调速器：帧率持续偏低自动降档（粒子发射量 / 上限 / 渲染分辨率 / 辉光），恢复后升档 */
export class PerfGovernor {
  constructor(cfg, onChange) {
    this.cfg = cfg.performance;
    this.onChange = onChange;
    this.level = this.cfg.startLevel;
    this.auto = this.cfg.autoDegrade;
    this.fps = 60; this.lowT = 0; this.highT = 0; this.warm = 0;
  }
  get current() { return this.cfg.levels[this.level]; }
  set(level, manual = false) {
    this.level = Math.max(0, Math.min(this.cfg.levels.length - 1, level));
    if (manual) this.auto = false;
    this.lowT = this.highT = 0;
    this.onChange(this.current, this.level);
  }
  tick(dt) {
    if (dt <= 0) return;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.warm += dt;
    if (!this.auto || this.warm < 2) return; // 启动前 2 秒不判定
    const c = this.cfg;
    this.lowT = this.fps < c.targetFps ? this.lowT + dt : 0;
    this.highT = this.fps > c.upFps ? this.highT + dt : 0;
    if (this.lowT > c.downAfter && this.level < c.levels.length - 1) this.set(this.level + 1);
    else if (this.highT > c.upAfter && this.level > 0) this.set(this.level - 1);
  }
}
