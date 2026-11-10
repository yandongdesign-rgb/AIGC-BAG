// 海洋：Gerstner 波浪、浅水透明、岸边浪花、日光反射
import * as THREE from 'three';
import { WORLD_SIZE, H_MIN, H_MAX } from './world.js';

const WAVES = [
  { a: 0.0, L: 62, A: 0.50, Q: 0.35 },
  { a: 0.55, L: 33, A: 0.30, Q: 0.40 },
  { a: -0.7, L: 19, A: 0.17, Q: 0.45 },
  { a: 1.4, L: 9.5, A: 0.07, Q: 0.5 },
  { a: -2.0, L: 5.6, A: 0.035, Q: 0.5 },
];

const common = /* glsl */`
uniform float uTime, uWave, uWindAng, uWorld;
uniform sampler2D uHeight;
float terrainH(vec2 xz){ vec2 uv = xz / uWorld + 0.5; return texture2D(uHeight, uv).r; }
`;

function waveGLSL() {
  let s = '';
  WAVES.forEach((w, i) => {
    const k = (2 * Math.PI / w.L).toFixed(5), c = Math.sqrt(9.8 / (2 * Math.PI / w.L)).toFixed(5);
    s += `{ float ang = uWindAng + ${w.a.toFixed(3)}; vec2 D = vec2(cos(ang), sin(ang));
      float A = ${w.A.toFixed(4)} * amp; float f = ${k} * (dot(D, p0) - ${c} * uTime);
      float cf = cos(f), sf = sin(f);
      disp.x += ${w.Q} * A * D.x * cf; disp.z += ${w.Q} * A * D.y * cf; disp.y += A * sf;
      nrm.x -= D.x * ${k} * A * cf; nrm.z -= D.y * ${k} * A * cf; nrm.y -= ${w.Q} * ${k} * A * sf; crest += sf * A; }\n`;
  });
  return s;
}

const vert = /* glsl */`
${common}
varying vec3 vWorld; varying vec3 vN; varying float vCrest;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p0 = wp.xz;
  float depth = -terrainH(p0);
  float amp = uWave * (0.25 + 0.75 * smoothstep(0.0, 6.0, depth));
  vec3 disp = vec3(0.0); vec3 nrm = vec3(0.0, 1.0, 0.0); float crest = 0.0;
  #ifndef FAR
  ${waveGLSL()}
  #endif
  wp.xyz += disp;
  vWorld = wp.xyz; vN = normalize(nrm); vCrest = crest / max(uWave, 0.05);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */`
${common}
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uLightCol, uFogColor, uCloudCol;
uniform float uSunInt, uCover, uFogDensity, uStorm, uRain;
varying vec3 vWorld; varying vec3 vN; varying float vCrest;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
void main(){
  vec3 N = vN;
  // 细小涟漪
  vec2 q = vWorld.xz * 0.6;
  float t = uTime;
  vec2 r1 = vec2(sin(q.x*1.3 + t*1.7 + sin(q.y*0.7)), cos(q.y*1.1 - t*1.3 + sin(q.x*0.9)));
  vec2 r2 = vec2(sin(q.y*3.1 - t*2.3), cos(q.x*2.7 + t*2.1));
  N = normalize(N + vec3(r1.x + r2.x*0.5, 0.0, r1.y + r2.y*0.5) * (0.035 + uRain*0.05));
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 skyC = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  skyC = mix(skyC, uCloudCol, uCover * 0.6);
  float spec = pow(max(dot(R, uSunDir), 0.0), 260.0) * uSunInt * 3.0 * (1.0 - uCover*0.8);
  spec += pow(max(dot(R, uSunDir), 0.0), 30.0) * uSunInt * 0.08;
  float th = terrainH(vWorld.xz);
  float depth = max(0.0, vWorld.y - th);
  vec3 shallow = vec3(0.10, 0.62, 0.58), deep = vec3(0.008, 0.10, 0.20);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 10.0, depth));
  // 波峰透光
  float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * smoothstep(0.0, 0.8, vCrest) * 0.6;
  body = (body + vec3(0.05, 0.4, 0.35) * sss) * uLightCol * (1.0 - uStorm * 0.45);
  vec3 col = mix(body, skyC, fres * 0.9) + uSunColor * spec;
  // 浪花
  float n = vnoise(vWorld.xz * 1.8 + vec2(t*0.4, -t*0.3)) * 0.6 + vnoise(vWorld.xz * 5.0 - t*0.6) * 0.4;
  float band = 0.5 + 0.5 * sin(depth * 5.0 - t * 2.0 + n * 2.5);
  float shore = smoothstep(1.4, 0.05, depth) * smoothstep(0.35, 0.75, band * n + 0.25);
  float edge = smoothstep(0.25, 0.0, depth);
  float crestF = smoothstep(0.45, 1.0, vCrest) * smoothstep(0.55, 0.8, n) * (0.25 + uStorm);
  float foam = clamp(shore + edge * 0.7 + crestF, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.95, 0.97) * (uLightCol * 0.9 + 0.05), foam * 0.85);
  float alpha = clamp(smoothstep(0.0, 2.2, depth) + fres * 0.5 + foam, 0.0, 1.0);
  #ifdef FAR
  alpha = 1.0;
  #endif
  // 雾
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ocean {
  constructor(scene, heightTex) {
    this.u = {
      uTime: { value: 0 }, uWave: { value: 0.4 }, uWindAng: { value: 0.6 }, uWorld: { value: WORLD_SIZE },
      uHeight: { value: heightTex }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uLightCol: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() }, uSunInt: { value: 1 },
      uCover: { value: 0 }, uFogDensity: { value: 0.002 }, uStorm: { value: 0 }, uRain: { value: 0 },
    };
    const mk = (far) => new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: vert, fragmentShader: frag, transparent: !far,
      defines: far ? { FAR: 1 } : {}, depthWrite: true,
    });
    this.cell = 4;
    const geo = new THREE.PlaneGeometry(1600, 1600, 400, 400); geo.rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(geo, mk(false)); this.near.frustumCulled = false; this.near.renderOrder = 2;
    const ring = new THREE.RingGeometry(700, 9000, 64, 6); ring.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(ring, mk(true)); this.far.frustumCulled = false; this.far.position.y = -0.4;
    scene.add(this.near, this.far);
  }
  update(time, camera, sky, w) {
    const u = this.u, su = sky.u;
    u.uTime.value = time;
    u.uWave.value = 0.22 + w.wind * 0.75 + w.dark * 0.5;
    u.uWindAng.value = w.windAng;
    u.uSunDir.value.copy(su.uSunDir.value); u.uSunColor.value.copy(su.uSunColor.value);
    u.uZenith.value.copy(su.uZenith.value); u.uHorizon.value.copy(su.uHorizon.value);
    u.uLightCol.value.copy(sky.state.lightCol);
    u.uFogColor.value.copy(sky.fog.color); u.uFogDensity.value = sky.fog.density;
    u.uCloudCol.value.copy(su.uCloudBase.value);
    u.uSunInt.value = sky.state.sunInt; u.uCover.value = w.cover; u.uStorm.value = w.dark; u.uRain.value = w.rain;
    const c = this.cell;
    this.near.position.set(Math.round(camera.position.x / c) * c, 0, Math.round(camera.position.z / c) * c);
    this.far.position.x = camera.position.x; this.far.position.z = camera.position.z;
  }
  // CPU 端水面高度（用于漂浮/游泳）
  heightAt(x, z, depth = 10) {
    const amp = this.u.uWave.value * (0.25 + 0.75 * Math.min(1, Math.max(0, depth / 6)));
    const t = this.u.uTime.value, wa = this.u.uWindAng.value;
    let y = 0;
    for (const w of WAVES) {
      const ang = wa + w.a, k = 2 * Math.PI / w.L, c = Math.sqrt(9.8 / k);
      y += w.A * amp * Math.sin(k * (Math.cos(ang) * x + Math.sin(ang) * z - c * t));
    }
    return y;
  }
}
