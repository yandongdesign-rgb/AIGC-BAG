/**
 * WebGL2 渲染器
 *  1) 累积缓冲：每帧按 trailPersistence 衰减 → 产生光带残影
 *  2) 粒子：实例化软光点，加色混合（发光叠加）
 *  3) Bloom：1/4 分辨率可分离高斯模糊 ×2 次
 *  4) 合成：背景渐变 + 色调映射 + 闪光 + 屏幕震动 + 暗角 + 抖动去色带
 */
const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const VS_PARTICLE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 iPos;
layout(location=2) in float iSize;
layout(location=3) in vec4 iColor;
uniform vec2 uRes; uniform float uScale;
out vec2 vUv; out vec4 vColor;
void main(){
  vUv = aCorner;
  vColor = iColor;
  vec2 p = iPos*uScale + aCorner * iSize * uScale;
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0., 1.);
}`;

const FS_PARTICLE = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vColor; out vec4 o;
void main(){
  float d = length(vUv);
  if(d>1.0) discard;
  float core = smoothstep(0.45, 0.0, d);
  float glow = exp(-d*d*5.5);
  float a = (core*0.85 + glow*0.55) * vColor.a;
  o = vec4(vColor.rgb * a, 1.0);
}`;

const FS_FADE = `#version 300 es
precision mediump float; uniform vec4 uColor; out vec4 o;
void main(){ o = uColor; }`;

const FS_COPY = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){
  vec2 t = 1.0/vec2(textureSize(uTex,0));
  vec3 c = texture(uTex, vUv + t*vec2(-1,-1)).rgb + texture(uTex, vUv + t*vec2(1,-1)).rgb
         + texture(uTex, vUv + t*vec2(-1,1)).rgb + texture(uTex, vUv + t*vec2(1,1)).rgb;
  o = vec4(c*0.25, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec2 t = uDir/vec2(textureSize(uTex,0));
  vec3 c = texture(uTex,vUv).rgb*0.227027;
  c += (texture(uTex,vUv+t*1.3846).rgb + texture(uTex,vUv-t*1.3846).rgb)*0.316216;
  c += (texture(uTex,vUv+t*3.2308).rgb + texture(uTex,vUv-t*3.2308).rgb)*0.070270;
  o = vec4(c,1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float; in vec2 vUv;
uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uBloomK, uExposure, uFlash, uTime, uUseBloom;
uniform vec2 uShake; uniform vec3 uBg0, uBg1, uFlashColor;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv = vUv + uShake;
  vec3 scene = texture(uScene, uv).rgb;
  vec3 bloom = uUseBloom > 0.5 ? texture(uBloom, uv).rgb : vec3(0.);
  vec3 c = scene + bloom * uBloomK + uFlashColor * uFlash;
  c = 1.0 - exp(-c * uExposure);
  float r = length(vUv - 0.5);
  vec3 bg = mix(uBg0, uBg1, smoothstep(0.0, 0.75, r));
  c = bg + c * (1.0 - bg);
  c *= 1.0 - smoothstep(0.55, 1.0, r) * 0.35;
  c += (hash(vUv*1000.0 + uTime) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('浏览器不支持 WebGL2');
    this.gl = gl;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    this.renderScale = 1;
    this.useBloom = true;
    this.fx = { flash: 0, flashColor: [1, 1, 1], shake: 0 };

    this.pParticle = program(gl, VS_PARTICLE, FS_PARTICLE);
    this.pFade = program(gl, VS_QUAD, FS_FADE);
    this.pCopy = program(gl, VS_QUAD, FS_COPY);
    this.pBlur = program(gl, VS_QUAD, FS_BLUR);
    this.pComp = program(gl, VS_QUAD, FS_COMPOSITE);

    // 全屏三角形
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 粒子实例化
    this.pVao = gl.createVertexArray();
    gl.bindVertexArray(this.pVao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
    this.instCap = 0;
    const st = 7 * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, st, 8); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 12); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    this.resize();
  }

  makeRT(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatRT) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h };
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(devicePixelRatio || 1, this.cfg.render.maxDPR);
    this.W = innerWidth; this.H = innerHeight;
    const k = dpr * this.renderScale;
    const w = Math.max(2, Math.round(this.W * k)), h = Math.max(2, Math.round(this.H * k));
    this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
    this.pxScale = k;
    for (const rt of [this.scene, this.b1, this.b2]) if (rt) { gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fb); }
    this.scene = this.makeRT(w, h);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.b1 = this.makeRT(bw, bh);
    this.b2 = this.makeRT(bw, bh);
  }

  setQuality(level) {
    this.useBloom = level.bloom;
    if (Math.abs(level.renderScale - this.renderScale) > 1e-3) { this.renderScale = level.renderScale; this.resize(); }
  }

  bindRT(rt) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fb : null); gl.viewport(0, 0, rt ? rt.w : this.canvas.width, rt ? rt.h : this.canvas.height); }
  drawQuad() { const gl = this.gl; gl.bindVertexArray(this.quadVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  render(pool, theme, dt, time) {
    const gl = this.gl, R = this.cfg.render;
    // ---- 1. 残影衰减 ----
    this.bindRT(this.scene);
    gl.enable(gl.BLEND);
    const keep = Math.pow(R.trailPersistence, dt * 60);
    gl.useProgram(this.pFade.p);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(this.pFade.u.uColor, 0, 0, 0, 1 - keep);
    this.drawQuad();
    if (!this.floatRT) { // 8 位缓冲需减去一个小常数，避免残影“卡住”
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform4f(this.pFade.u.uColor, 1.5 / 255, 1.5 / 255, 1.5 / 255, 0);
      this.drawQuad();
      gl.blendEquation(gl.FUNC_ADD);
    }

    // ---- 2. 粒子（加色混合） ----
    const n = pool.renderCount;
    if (n > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.pParticle.p);
      gl.uniform2f(this.pParticle.u.uRes, this.scene.w, this.scene.h);
      gl.uniform1f(this.pParticle.u.uScale, this.pxScale);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      const bytes = n * 7 * 4;
      if (bytes > this.instCap) { this.instCap = Math.max(bytes, this.instCap * 2); gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pool.render, 0, n * 7);
      gl.bindVertexArray(this.pVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.disable(gl.BLEND);

    // ---- 3. Bloom ----
    if (this.useBloom) {
      this.bindRT(this.b1); gl.useProgram(this.pCopy.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.pCopy.u.uTex, 0); this.drawQuad();
      gl.useProgram(this.pBlur.p); gl.uniform1i(this.pBlur.u.uTex, 0);
      for (let i = 0; i < 2; i++) {
        const r = 1 + i * 1.5;
        this.bindRT(this.b2); gl.bindTexture(gl.TEXTURE_2D, this.b1.tex); gl.uniform2f(this.pBlur.u.uDir, r, 0); this.drawQuad();
        this.bindRT(this.b1); gl.bindTexture(gl.TEXTURE_2D, this.b2.tex); gl.uniform2f(this.pBlur.u.uDir, 0, r); this.drawQuad();
      }
    }

    // ---- 4. 合成到屏幕 ----
    const fx = this.fx;
    fx.flash *= Math.exp(-dt * 9);
    fx.shake *= Math.exp(-dt * 10);
    const sh = fx.shake;
    this.bindRT(null);
    const c = this.pComp;
    gl.useProgram(c.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(c.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.b1.tex); gl.uniform1i(c.u.uBloom, 1);
    gl.uniform1f(c.u.uBloomK, R.bloom);
    gl.uniform1f(c.u.uUseBloom, this.useBloom ? 1 : 0);
    gl.uniform1f(c.u.uExposure, R.exposure);
    gl.uniform1f(c.u.uFlash, fx.flash);
    gl.uniform3fv(c.u.uFlashColor, fx.flashColor);
    gl.uniform1f(c.u.uTime, time % 100);
    gl.uniform2f(c.u.uShake, ((Math.random() - 0.5) * sh) / this.W, ((Math.random() - 0.5) * sh) / this.H);
    gl.uniform3fv(c.u.uBg0, theme.bg[0]);
    gl.uniform3fv(c.u.uBg1, theme.bg[1]);
    this.drawQuad();
    gl.activeTexture(gl.TEXTURE0);
  }

  flash(amount, color = [1, 1, 1]) { this.fx.flash = Math.min(1.5, this.fx.flash + amount); this.fx.flashColor = color; }
  shake(px) { this.fx.shake = Math.max(this.fx.shake, px); }
}
