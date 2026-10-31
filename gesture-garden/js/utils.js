/** 通用数学 / 颜色 / 随机工具 */
(function () {
  const TAU = Math.PI * 2;

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  /** 可复现的伪随机数（每次 resize 布局一致） */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /** 颜色混合，返回 rgb() 字符串 */
  function mix(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }

  /** 混合后仍返回 hex，便于再次混合 */
  function mixHex(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    const to = (v) => Math.round(v).toString(16).padStart(2, '0');
    return '#' + to(lerp(a[0], b[0], t)) + to(lerp(a[1], b[1], t)) + to(lerp(a[2], b[2], t));
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const range = (rng, a, b) => a + (b - a) * rng();

  GG.util = { TAU, clamp, lerp, easeOutCubic, easeInOutSine, smoothstep, mulberry32, hexToRgb, mix, mixHex, rgba, pick, range };
})();
