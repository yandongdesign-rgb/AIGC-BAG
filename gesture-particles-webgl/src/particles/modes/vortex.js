/** 拇指食指捏合 → 漩涡：粒子绕捏合点高速旋转成吸积盘，影响范围内所有粒子被卷入吸收 */
import { Mode } from '../mode.js';
import { rand, randRange, paletteAt, TAU } from '../../core/math.js';

export class VortexMode extends Mode {
  onEnter(h) {
    this.hold = 0;
    if (h) this.c = { x: h.pinch.x, y: h.pinch.y };
    this.ctx.sound('vortex', 'suck', {});
  }

  update(dt, h, w) {
    if (!h) return;
    const { pool, theme } = this.ctx, p = this.p;
    if (!this.c) this.c = { x: h.pinch.x, y: h.pinch.y };
    this.hold = (this.hold || 0) + dt * (this.target ? 1 : -2);
    // 中心平滑跟随
    this.c.x += (h.pinch.x - this.c.x) * Math.min(1, dt * 18);
    this.c.y += (h.pinch.y - this.c.y) * Math.min(1, dt * 18);
    const c = this.c;
    const R = p.radius * h.handSize * this.ctx.dualScale * (0.35 + 0.65 * w);
    const spin = 1 + Math.min(Math.max(this.hold, 0), 3) * p.spinUp;
    const omega = p.omega * spin;
    const ap = this.ctx.audioParams;
    ap.vortex = Math.max(ap.vortex || 0, w);
    ap.vortexSpin = Math.max(ap.vortexSpin || 0, spin);
    ap.vortexSize = this.ctx.dualScale;

    // 发射：外圈出生，带切向速度
    // 三条旋臂 + 随机散布，形成星系/吸积盘结构
    this.arm = (this.arm || 0) + omega * dt * 0.35;
    const n = this.count(p.rate * w, dt);
    for (let i = 0; i < n; i++) {
      const r = R * rand(0.6, 2.2);
      const a = Math.random() < 0.7 ? this.arm + ((i % 3) * TAU) / 3 + (r / R) * 1.4 + rand(-0.25, 0.25) : rand(0, TAU);
      const vt = omega * R * Math.sqrt(R / r);
      const glow = i % 5 === 0;
      pool.emit({
        x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r,
        vx: -Math.sin(a) * vt, vy: Math.cos(a) * vt,
        life: randRange(p.life), size: glow ? rand(9, 14) : rand(2.4, 5), size1: glow ? 4 : 1.5,
        color: paletteAt(theme.vortex, Math.min(1, (r / R - 0.6) / 1.6)), color1: theme.vortex[0],
        alpha: (glow ? 0.18 : rand(0.7, 1)) * w, drag: 0,
      });
    }

    // 力场：切向旋转 + 向心吸入，过近被吞噬
    const infl = R * p.influence, infl2 = infl * infl, kill = R * 0.1, hot = theme.vortex[0];
    const X = pool.x, Y = pool.y, VX = pool.vx, VY = pool.vy;
    for (let i = 0; i < pool.count; i++) {
      const dx = X[i] - c.x, dy = Y[i] - c.y, d2 = dx * dx + dy * dy;
      if (d2 > infl2) continue;
      const r = Math.sqrt(d2) || 1;
      if (r < kill) { pool.kill(i); continue; }
      const fall = w * (1 - r / infl);
      // 角速度上限：保证每帧转角 ≤ 0.12rad，避免低帧率下显式积分把粒子“甩出去”
      const angV = Math.min((omega * R * Math.min(2.4, Math.sqrt(R / r))) / r, omega * 3, 0.12 / dt);
      const vt = angV * r;
      // 越靠内吸入越慢 → 粒子在内圈堆积成亮盘
      const vin = p.inflow * Math.min(1.6, Math.sqrt(r / R)) + 10;
      const tx = -dy / r, ty = dx / r, nx = -dx / r, ny = -dy / r;
      const dvx = tx * vt + nx * vin, dvy = ty * vt + ny * vin;
      const k = Math.min(1, 4 * fall * dt * 2.2);
      VX[i] += (dvx - VX[i]) * k;
      VY[i] += (dvy - VY[i]) * k;
      // 径向投影：预测下一帧位置，把半径校正到“缓慢内旋”的目标值（消除显式积分外漂，任意帧率稳定）
      const px = dx + VX[i] * dt, py = dy + VY[i] * dt, rp = Math.hypot(px, py) || 1;
      const blend = Math.min(1, fall * 3);
      const rt = rp + (Math.max(kill * 0.5, r - vin * dt) - rp) * blend;
      VX[i] = (px * (rt / rp) - dx) / dt;
      VY[i] = (py * (rt / rp) - dy) / dt;
      // 吸积盘内圈：减缓衰老 + 颜色向“炽热核心色”过渡，越靠近中心越亮
      if (r < R * 1.3) {
        const heat = (1 - r / (R * 1.3)) * w;
        pool.life[i] = Math.max(0, pool.life[i] - dt * 0.75 * heat);
        const m = Math.min(1, heat * dt * 5);
        pool.r[i] += (hot[0] - pool.r[i]) * m; pool.g[i] += (hot[1] - pool.g[i]) * m; pool.b[i] += (hot[2] - pool.b[i]) * m;
        pool.r1[i] = pool.r[i]; pool.g1[i] = pool.g[i]; pool.b1[i] = pool.b[i];
      }
    }
    // 核心光
    if (!h.frozen) pool.emit({ x: c.x, y: c.y, life: 0.05, size: R * 0.55, size1: R * 0.4, color: theme.vortex[0], alpha: 0.28 * w, drag: 0 });
  }
}
