/** 通用数学 / 颜色工具 */
(function (global) {
  'use strict';

  const U = {
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp(a, b, t) { return a + (b - a) * t; },
    invLerp(a, b, v) { return b === a ? 0 : U.clamp((v - a) / (b - a), 0, 1); },
    rand(a, b) { return a + Math.random() * (b - a); },
    randInt(a, b) { return Math.floor(U.rand(a, b + 1)); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    smoothstep(t) { t = U.clamp(t, 0, 1); return t * t * (3 - 2 * t); },
    // 指数平滑：与帧率无关的趋近系数
    approachCoeff(tau, dt) { return 1 - Math.exp(-dt / Math.max(0.001, tau)); },

    dist2(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    },
    dist3(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz * 0.36);
    },

    /** 返回 ∠ABC（以 B 为顶点），使用带 z 权重的三维向量 */
    angleAt(a, b, c) {
      const v1x = a.x - b.x, v1y = a.y - b.y, v1z = ((a.z || 0) - (b.z || 0)) * 0.6;
      const v2x = c.x - b.x, v2y = c.y - b.y, v2z = ((c.z || 0) - (b.z || 0)) * 0.6;
      const dot = v1x * v2x + v1y * v2y + v1z * v2z;
      const m1 = Math.hypot(v1x, v1y, v1z), m2 = Math.hypot(v2x, v2y, v2z);
      if (m1 < 1e-6 || m2 < 1e-6) return 0;
      return Math.acos(U.clamp(dot / (m1 * m2), -1, 1)) * 180 / Math.PI;
    },

    /** HSV → RGB，h 单位度，s/v ∈ [0,1]，返回 0..1 的 {r,g,b} */
    hsv(h, s, v) {
      h = ((h % 360) + 360) % 360;
      const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }
      return { r: r + m, g: g + m, b: b + m };
    },

    hexToRgb(hex) {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
      return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    },

    /** 折线抖动：生成从 a 到 b 的锯齿点列 */
    jaggedPath(a, b, segments, jitter) {
      const pts = [];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const env = Math.sin(Math.PI * t);
        const off = (i === 0 || i === segments) ? 0 : U.rand(-jitter, jitter) * env;
        pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
      }
      return pts;
    },

    formatMs(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + ' ms'; }
  };

  global.GPUtils = U;
})(window);
