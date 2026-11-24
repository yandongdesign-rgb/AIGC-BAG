// WebGL2 叠加混合点精灵渲染器（带简易泛光）
(function () {
  const SG = window.SG;
  const VS = `#version 300 es
  in vec2 a_pos; in float a_size; in vec4 a_col;
  uniform vec2 u_res; uniform float u_dpr; uniform float u_scale;
  out vec4 v_col;
  void main(){
    vec2 p = a_pos * u_scale / u_res * 2.0 - 1.0;
    gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
    gl_PointSize = max(1.0, a_size * u_dpr * u_scale);
    v_col = a_col;
  }`;
  const FS = `#version 300 es
  precision mediump float;
  in vec4 v_col; out vec4 o;
  void main(){
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(q, q);
    if (d2 > 1.0) discard;
    float core = exp(-d2 * 16.0);
    float halo = exp(-d2 * 3.2) * (1.0 - d2);
    vec3 c = v_col.rgb * (halo * 0.75 + core) + vec3(core * 0.55);
    o = vec4(c * v_col.a, 1.0);
  }`;
  // 泛光：降采样 + 两次模糊后叠加
  const QVS = `#version 300 es
  in vec2 a_q; out vec2 v_uv;
  void main(){ v_uv = a_q * 0.5 + 0.5; gl_Position = vec4(a_q, 0.0, 1.0); }`;
  const BLUR = `#version 300 es
  precision mediump float;
  in vec2 v_uv; uniform sampler2D u_t; uniform vec2 u_dir; out vec4 o;
  void main(){
    vec3 c = texture(u_t, v_uv).rgb * 0.227;
    c += texture(u_t, v_uv + u_dir * 1.385).rgb * 0.316;
    c += texture(u_t, v_uv - u_dir * 1.385).rgb * 0.316;
    c += texture(u_t, v_uv + u_dir * 3.231).rgb * 0.07;
    c += texture(u_t, v_uv - u_dir * 3.231).rgb * 0.07;
    o = vec4(c, 1.0);
  }`;
  const COPY = `#version 300 es
  precision mediump float;
  in vec2 v_uv; uniform sampler2D u_t; uniform float u_k; out vec4 o;
  void main(){ o = vec4(texture(u_t, v_uv).rgb * u_k, 1.0); }`;

  function prog(gl, vs, fs) {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  class GLRenderer {
    constructor(canvas, max) {
      this.canvas = canvas;
      const gl = (this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false }));
      if (!gl) throw new Error('WebGL2 不可用');
      this.p = prog(gl, VS, FS);
      this.pb = prog(gl, QVS, BLUR);
      this.pc = prog(gl, QVS, COPY);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, max * 28, gl.DYNAMIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const loc = (n) => gl.getAttribLocation(this.p, n);
      gl.enableVertexAttribArray(loc('a_pos')); gl.vertexAttribPointer(loc('a_pos'), 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(loc('a_size')); gl.vertexAttribPointer(loc('a_size'), 1, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(loc('a_col')); gl.vertexAttribPointer(loc('a_col'), 4, gl.FLOAT, false, 28, 12);
      this.qvao = gl.createVertexArray();
      gl.bindVertexArray(this.qvao);
      const qb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      for (const p of [this.pb, this.pc]) { const l = gl.getAttribLocation(p, 'a_q'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); }
      gl.bindVertexArray(null);
      this.u = {
        res: gl.getUniformLocation(this.p, 'u_res'), dpr: gl.getUniformLocation(this.p, 'u_dpr'), scale: gl.getUniformLocation(this.p, 'u_scale'),
        bt: gl.getUniformLocation(this.pb, 'u_t'), bdir: gl.getUniformLocation(this.pb, 'u_dir'),
        ct: gl.getUniformLocation(this.pc, 'u_t'), ck: gl.getUniformLocation(this.pc, 'u_k'),
      };
      this.bloom = 0.9;
      this.fbos = [];
    }

    makeFbo(w, h) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { f, t, w, h };
    }

    resize(W, H, dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
      const bw = Math.max(64, Math.round(W / 4)), bh = Math.max(64, Math.round(H / 4));
      const gl = this.gl;
      for (const o of this.fbos) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); }
      this.fbos = [this.makeFbo(bw, bh), this.makeFbo(bw, bh)];
    }

    drawPoints(count, data, w, h, scale) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!count) return;
      gl.useProgram(this.p);
      gl.uniform2f(this.u.res, this.W * scale, this.H * scale);
      gl.uniform1f(this.u.dpr, scale === 1 ? this.dpr : 1);
      gl.uniform1f(this.u.scale, scale);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    render(pool, boost) {
      const gl = this.gl;
      const count = pool.write(boost);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pool.gpu, 0, count * 7);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const [A, B] = this.fbos;
      // 1) 低分辨率渲染用于泛光
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.f);
      this.drawPoints(count, pool.gpu, A.w, A.h, A.w / this.W);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.qvao);
      gl.useProgram(this.pb);
      gl.uniform1i(this.u.bt, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (let k = 0; k < 2; k++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B.f); gl.bindTexture(gl.TEXTURE_2D, A.t);
        gl.uniform2f(this.u.bdir, (1 + k) / A.w, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.f); gl.bindTexture(gl.TEXTURE_2D, B.t);
        gl.uniform2f(this.u.bdir, 0, (1 + k) / A.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // 2) 全分辨率粒子 + 泛光叠加
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      this.drawPoints(count, pool.gpu, this.canvas.width, this.canvas.height, 1);
      gl.bindVertexArray(this.qvao);
      gl.useProgram(this.pc);
      gl.bindTexture(gl.TEXTURE_2D, A.t);
      gl.uniform1i(this.u.ct, 0);
      gl.uniform1f(this.u.ck, this.bloom);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return count;
    }
  }

  SG.GLRenderer = GLRenderer;
})();
