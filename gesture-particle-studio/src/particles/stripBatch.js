/** 动态条带批处理：光带、电弧等宽度可变的折线 → 一次 draw call 的三角形 */
export class StripBatch {
  constructor(maxVerts = 90000) {
    this.max = maxVerts;
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 4);
    this.n = 0;
    this.hueShift = 0;
    this.sat = 1;
  }

  begin() {
    this.n = 0;
  }

  hsl(h, s, l, a) {
    h = ((((h + this.hueShift) % 360) + 360) % 360) / 360;
    s *= this.sat;
    const k = (n) => (n + h * 12) % 12;
    const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4), a];
  }

  _v(x, y, c) {
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = 0;
    this.col.set(c, i * 4);
  }

  /**
   * @param pts [{x,y,...}]
   * @param width (u, pt) => 宽度，u 从 0（起点/最旧）到 1（终点/最新）
   * @param color (u, pt) => [r,g,b,a]
   */
  strip(pts, width, color) {
    const m = pts.length;
    if (m < 2 || this.n + (m - 1) * 6 > this.max) return;
    let pl = null;
    let pr = null;
    let pc = null;
    for (let i = 0; i < m; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(m - 1, i + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      const u = i / (m - 1);
      const hw = width(u, pts[i]) / 2;
      const c = color(u, pts[i]);
      const L = [pts[i].x - ty * hw, pts[i].y + tx * hw];
      const R = [pts[i].x + ty * hw, pts[i].y - tx * hw];
      if (pl) {
        this._v(pl[0], pl[1], pc);
        this._v(pr[0], pr[1], pc);
        this._v(L[0], L[1], c);
        this._v(pr[0], pr[1], pc);
        this._v(R[0], R[1], c);
        this._v(L[0], L[1], c);
      }
      pl = L;
      pr = R;
      pc = c;
    }
  }
}
