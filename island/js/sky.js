// 天空：昼夜循环、太阳月亮、云层、星空、彩虹、闪电照亮
import * as THREE from 'three';
import { smoothstep, lerp, clamp } from './noise.js';

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const DAY_Z = srgb(0.20, 0.45, 0.88), DAY_H = srgb(0.66, 0.83, 0.96);
const SET_Z = srgb(0.24, 0.30, 0.58), SET_H = srgb(1.0, 0.56, 0.30);
const NIGHT_Z = srgb(0.006, 0.012, 0.035), NIGHT_H = srgb(0.03, 0.05, 0.10);
const SUN_HI = srgb(1.0, 0.96, 0.9), SUN_LO = srgb(1.0, 0.5, 0.22), MOON = srgb(0.55, 0.65, 0.95);

const vert = /* glsl */`
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // 永远在最远处
}`;
const frag = /* glsl */`
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uSunColor, uCloudLit, uCloudBase, uFogColor;
uniform float uCover, uTime, uStar, uLightning, uRainbow, uFog, uSunVis, uMoonPhase;
uniform vec2 uWindOff;
varying vec3 vDir;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0,4,2),6.0)-3.0)-1.0, 0.0, 1.0); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(1.0 - clamp(h, 0.0, 1.0), 2.6);
  vec3 col = mix(uZenith, uHorizon, t);
  if (h < 0.0) col = uHorizon * 0.85;
  // 星空
  if (uStar > 0.01 && h > 0.0) {
    vec3 q = d * 260.0; vec3 cell = floor(q); float r = hash3(cell);
    if (r > 0.985) {
      vec3 c = cell + 0.5 + (vec3(hash3(cell+1.3), hash3(cell+2.7), hash3(cell+4.1)) - 0.5)*0.6;
      float dd = length(q - c);
      float tw = 0.6 + 0.4*sin(uTime*(2.0+r*30.0) + r*100.0);
      col += vec3(0.9,0.95,1.0) * smoothstep(0.35, 0.0, dd) * uStar * tw * (r-0.985)*90.0;
    }
    // 银河
    float band = exp(-pow(dot(d, normalize(vec3(0.3,0.2,1.0)))*4.0, 2.0));
    col += vec3(0.25,0.27,0.4) * band * fbm(d.xy*8.0+d.z*3.0) * uStar * 0.25;
  }
  // 太阳
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0)*0.22 + pow(sd, 90.0)*0.6) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 30.0 * uSunVis * (1.0 - uCover*0.85);
  // 月亮
  float md = dot(d, uMoonDir);
  if (md > 0.9990) {
    vec3 mc = vec3(0.85,0.88,0.95) * (0.75 + 0.25*vnoise(d.xy*900.0)) * smoothstep(0.9990, 0.99925, md);
    col = mix(col, mc*2.0, uStar*1.1*smoothstep(0.9990,0.99925,md));
  }
  col += vec3(0.5,0.6,0.9) * pow(max(md,0.0), 300.0) * uStar * 0.6;
  // 彩虹
  if (uRainbow > 0.01 && h > -0.02) {
    float ang = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
    float b = (ang - 0.705) / 0.045;
    if (b > 0.0 && b < 1.0) {
      vec3 rc = hue(b*0.8);
      col += rc * sin(b*3.14159) * uRainbow * 0.35 * smoothstep(-0.02, 0.15, h);
    }
  }
  // 云层
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.1) * 0.9 + uWindOff;
    float n = fbm(p) * 0.72 + fbm(p*2.7 + 3.0 - uWindOff*0.3) * 0.28;
    float thr = mix(0.70, 0.2, uCover);
    float dens = smoothstep(thr, thr + 0.22, n) * smoothstep(0.0, 0.16, h);
    float sunAmt = pow(max(dot(d, uSunDir), 0.0), 5.0);
    float thick = smoothstep(thr, thr + 0.5, n);
    vec3 cc = mix(uCloudLit, uCloudBase, thick) + uSunColor * sunAmt * 0.6 * (1.0 - thick*0.7) * uSunVis;
    cc += vec3(0.75,0.8,1.0) * uLightning * (0.6 + thick);
    col = mix(col, cc, dens);
    // 阴天整体变灰
    col = mix(col, uCloudBase*1.15 + vec3(0.6,0.65,0.8)*uLightning, smoothstep(0.6, 1.0, uCover)*0.75*smoothstep(-0.05,0.3,h));
  }
  // 雾
  col = mix(col, uFogColor, clamp(uFog * (1.0 - smoothstep(0.0, 0.5, h)) , 0.0, 1.0));
  col += vec3(0.6,0.65,0.9) * uLightning * 0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkySystem {
  constructor(scene) {
    this.u = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() },
      uCloudBase: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() },
      uCover: { value: 0.2 }, uTime: { value: 0 }, uStar: { value: 0 }, uLightning: { value: 0 },
      uRainbow: { value: 0 }, uFog: { value: 0 }, uSunVis: { value: 1 }, uMoonPhase: { value: 0 },
      uWindOff: { value: new THREE.Vector2() },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a5a, 1);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xaaccee, 0.0015);
    scene.fog = this.fog;

    // 公开给水面等使用的状态
    this.state = { sunDir: new THREE.Vector3(), elev: 0, day: 1, night: 0, sunInt: 1, ambient: new THREE.Color(), lightCol: new THREE.Color() };
    this.windOff = new THREE.Vector2();
    this.shooting = makeShootingStar(scene);
  }

  update(dt, tod, w, camera, time) {
    const u = this.u, S = this.state;
    const a = ((tod - 6) / 24) * Math.PI * 2;
    const sunDir = S.sunDir.set(Math.cos(a), Math.sin(a) * 0.9, Math.sin(a) * 0.42).normalize();
    const e = sunDir.y; S.elev = e;
    u.uSunDir.value.copy(sunDir);
    const ma = a + Math.PI + 0.25;
    u.uMoonDir.value.set(Math.cos(ma), Math.sin(ma) * 0.85, Math.sin(ma) * 0.3 + 0.25).normalize();

    const tSet = 1 - smoothstep(0.0, 0.32, e);
    const night = smoothstep(0.06, -0.2, e);
    S.night = night; S.day = 1 - night;
    const Z = u.uZenith.value.copy(DAY_Z).lerp(SET_Z, tSet * 0.8).lerp(NIGHT_Z, night);
    const H = u.uHorizon.value.copy(DAY_H).lerp(SET_H, tSet * (1 - smoothstep(-0.05, -0.2, e))).lerp(NIGHT_H, night);
    // 阴雨天压暗
    const dark = 1 - w.cover * 0.35 - w.dark * 0.45;
    const grey = (c) => { const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15; return c.lerp(new THREE.Color(l, l * 1.02, l * 1.08), w.cover * 0.6).multiplyScalar(dark); };
    grey(Z); grey(H);
    const sunC = u.uSunColor.value.copy(SUN_HI).lerp(SUN_LO, tSet);
    u.uSunVis.value = smoothstep(-0.06, 0.02, e);
    const dayB = S.day * (0.35 + 0.65 * smoothstep(-0.05, 0.3, e));
    u.uCloudLit.value.setRGB(1, 1, 1).lerp(sunC, tSet * 0.6).multiplyScalar(dayB * (1 - w.dark * 0.55) + 0.025);
    u.uCloudBase.value.setRGB(0.55, 0.58, 0.64).multiplyScalar(dayB * (1 - w.dark * 0.7) + 0.02);
    u.uCover.value = w.cover;
    u.uStar.value = night * (1 - w.cover * 0.95);
    u.uLightning.value = w.flash;
    u.uRainbow.value = w.rainbow;
    u.uFog.value = clamp(w.fog * 0.9 + w.rain * 0.3, 0, 1);
    u.uTime.value = time;
    this.windOff.x += w.windVec.x * dt * 0.0016; this.windOff.y += w.windVec.y * dt * 0.0016;
    u.uWindOff.value.copy(this.windOff);

    // 雾色
    const fogC = u.uFogColor.value.copy(H).lerp(Z, 0.15).multiplyScalar(0.95);
    fogC.lerp(new THREE.Color(0.6, 0.62, 0.66).multiplyScalar(dayB + 0.02), w.fog * 0.5);
    this.fog.color.copy(fogC);
    this.fog.density = 0.0011 + w.fog * 0.016 + w.rain * 0.0045;

    // 光照：白天太阳，夜晚月光
    const sunVis = smoothstep(-0.04, 0.1, e);
    const lightDir = e > -0.02 ? sunDir : u.uMoonDir.value;
    const cloudK = 1 - w.cover * 0.7 - w.dark * 0.2;
    if (e > -0.02) {
      this.sun.color.copy(sunC);
      this.sun.intensity = sunVis * 3.4 * cloudK;
    } else {
      this.sun.color.copy(MOON);
      this.sun.intensity = night * 0.35 * (1 - w.cover * 0.8);
    }
    S.sunInt = this.sun.intensity;
    const cp = camera.position;
    this.sun.position.set(cp.x + lightDir.x * 200, cp.y + Math.max(lightDir.y, 0.05) * 200, cp.z + lightDir.z * 200);
    this.sun.target.position.set(cp.x, cp.y, cp.z);
    this.hemi.color.copy(Z).lerp(H, 0.5);
    this.hemi.groundColor.setRGB(0.45, 0.4, 0.3).multiplyScalar(dayB + 0.04);
    this.hemi.intensity = 0.35 + dayB * 1.0 + night * 0.25 + w.flash * 3;
    S.lightCol.setRGB(1, 1, 1).multiplyScalar(dayB * (1 - w.dark * 0.5) + 0.05 + w.flash * 0.6);
    this.mesh.position.copy(cp);

    this.shooting.update(dt, night * (1 - w.cover), cp);
  }
}

function makeShootingStar(scene) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0, 0, 0], 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false });
  const line = new THREE.Line(geo, mat); line.frustumCulled = false; line.visible = false;
  scene.add(line);
  let t = 0, life = 0, next = 8, start = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    update(dt, vis, cp) {
      next -= dt;
      if (!line.visible && next < 0 && vis > 0.5) {
        line.visible = true; t = 0; life = 0.9;
        const az = Math.random() * Math.PI * 2;
        start.set(Math.cos(az) * 900, 500 + Math.random() * 300, Math.sin(az) * 900);
        dir.set(-Math.cos(az + 0.6), -0.35, -Math.sin(az + 0.6)).normalize();
        next = 6 + Math.random() * 14;
      }
      if (line.visible) {
        t += dt; const k = t / life;
        const head = start.clone().addScaledVector(dir, k * 700).add(cp);
        const tail = head.clone().addScaledVector(dir, -120);
        const p = geo.attributes.position; p.setXYZ(0, head.x, head.y, head.z); p.setXYZ(1, tail.x, tail.y, tail.z); p.needsUpdate = true;
        mat.opacity = Math.sin(k * Math.PI);
        if (k >= 1) line.visible = false;
      }
    }
  };
}
