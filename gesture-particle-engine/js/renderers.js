/**
 * 双渲染器：WebGL 点精灵（主）/ Canvas2D 辉光贴图（降级）
 * 共用接口：resize / beginFrame / draw(vertices, count) / dispose
 */
(function (global) {
  'use strict';

  const STRIDE = global.GP_STRIDE || 8;
  const U = global.GPUtils;

  function parseHex(hex) {
    try {
      const c = U.hexToRgb(hex || '#050912');
      return [c.r, c.g, c.b];
    } catch (e) { return [0.02, 0.035, 0.07]; }
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    }
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    }
    return p;
  }

  class WebGLRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const opts = { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
      this.gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!this.gl) throw new Error('WebGL 不可用');
      const gl = this.gl;

      this.pointProgram = program(gl, `
        attribute vec2 aPos;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform vec2 uRes;
        uniform float uDpr;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 clip = (aPos / uRes) * 2.0 - 1.0;
          gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
          gl_PointSize = max(1.5, aSize * uDpr * 2.0);
          vColor = aColor;
          vAlpha = aAlpha;
        }`, `
        precision mediump float;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.35);
          float core = pow(1.0 - smoothstep(0.0, 0.5, r), 2.5);
          vec3 col = vColor * 1.25 + core * 0.7;
          gl_FragColor = vec4(col, min(1.0, a * vAlpha * 1.15));
        }`);

      this.fadeProgram = program(gl, `
        attribute vec2 aPos;
        void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`, `
        precision mediump float;
        uniform vec4 uColor;
        void main() { gl_FragColor = uColor; }`);

      this.pAttr = {
        pos: gl.getAttribLocation(this.pointProgram, 'aPos'),
        color: gl.getAttribLocation(this.pointProgram, 'aColor'),
        size: gl.getAttribLocation(this.pointProgram, 'aSize'),
        alpha: gl.getAttribLocation(this.pointProgram, 'aAlpha')
      };
      this.pUni = {
        res: gl.getUniformLocation(this.pointProgram, 'uRes'),
        dpr: gl.getUniformLocation(this.pointProgram, 'uDpr')
      };
      this.fAttr = gl.getAttribLocation(this.fadeProgram, 'aPos');
      this.fUni = gl.getUniformLocation(this.fadeProgram, 'uColor');

      this.pointBuffer = gl.createBuffer();
      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      this.name = 'WebGL';
    }

    resize(w, h, dpr) {
      const gl = this.gl;
      this.w = w; this.h = h; this.dpr = dpr;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw; this.canvas.height = ph;
      }
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0.02, 0.035, 0.07, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    beginFrame(bg, fadeAlpha) {
      const gl = this.gl;
      const c = parseHex(bg);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fadeProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.fAttr);
      gl.vertexAttribPointer(this.fAttr, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.fUni, c[0], c[1], c[2], fadeAlpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.pointProgram);
      gl.uniform2f(this.pUni.res, this.w, this.h);
      gl.uniform1f(this.pUni.dpr, this.dpr);
      const stride = STRIDE * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
      gl.enableVertexAttribArray(this.pAttr.pos);
      gl.vertexAttribPointer(this.pAttr.pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.pAttr.color);
      gl.vertexAttribPointer(this.pAttr.color, 3, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(this.pAttr.size);
      gl.vertexAttribPointer(this.pAttr.size, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(this.pAttr.alpha);
      gl.vertexAttribPointer(this.pAttr.alpha, 1, gl.FLOAT, false, stride, 24);
    }

    draw(vertices, count) {
      if (!count) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    dispose() {
      const gl = this.gl;
      gl.deleteBuffer(this.pointBuffer);
      gl.deleteBuffer(this.quadBuffer);
      gl.deleteProgram(this.pointProgram);
      gl.deleteProgram(this.fadeProgram);
    }
  }

  class CanvasRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      if (!this.ctx) throw new Error('Canvas2D 不可用');
      this.sprites = [];
      const buckets = 48;
      for (let i = 0; i < buckets; i++) {
        const s = document.createElement('canvas');
        s.width = s.height = 64;
        const c = s.getContext('2d');
        const hue = i * (360 / buckets);
        const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.98)');
        g.addColorStop(0.18, 'hsla(' + hue + ',100%,76%,0.92)');
        g.addColorStop(0.5, 'hsla(' + hue + ',100%,60%,0.36)');
        g.addColorStop(1, 'hsla(' + hue + ',100%,50%,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 64, 64);
        this.sprites.push(s);
      }
      this.name = 'Canvas2D';
    }

    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw; this.canvas.height = ph;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.fillStyle = '#050912';
      this.ctx.fillRect(0, 0, w, h);
    }

    beginFrame(bg, fadeAlpha) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      const c = parseHex(bg);
      ctx.fillStyle = 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + fadeAlpha + ')';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';
    }

    draw(vertices, count) {
      const ctx = this.ctx;
      const sprites = this.sprites;
      for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        const size = vertices[o + 5] * 2.6;
        const alpha = U.clamp(vertices[o + 6], 0, 1);
        let hue = vertices[o + 7] % 360;
        if (hue < 0) hue += 360;
        const bucket = Math.min(47, (hue * 48 / 360) | 0);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[bucket], vertices[o] - size / 2, vertices[o + 1] - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    dispose() { this.sprites.length = 0; }
  }

  function createRenderer(canvas, preferCanvas) {
    if (!preferCanvas) {
      try { return new WebGLRenderer(canvas); }
      catch (e) { console.warn('[renderer] WebGL 初始化失败，降级 Canvas2D:', e.message); }
    }
    return new CanvasRenderer(canvas);
  }

  global.GPWebGLRenderer = WebGLRenderer;
  global.GPCanvasRenderer = CanvasRenderer;
  global.GPCreateRenderer = createRenderer;
})(window);
