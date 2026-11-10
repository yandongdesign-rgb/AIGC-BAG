// 天气：晴/多云/阴/雨/暴风雨/海雾，风、雨滴、闪电、彩虹
import * as THREE from 'three';
import { lerp, clamp, noise2 } from './noise.js';
import { WORLD_SIZE, CAVE } from './world.js';

export const PRESETS = {
  clear: { label: '晴朗', icon: '☀️', cover: 0.12, dark: 0, rain: 0, wind: 0.25, fog: 0 },
  cloudy: { label: '多云', icon: '⛅', cover: 0.5, dark: 0.05, rain: 0, wind: 0.42, fog: 0.04 },
  overcast: { label: '乌云密布', icon: '☁️', cover: 0.9, dark: 0.45, rain: 0, wind: 0.6, fog: 0.12 },
  rain: { label: '下雨', icon: '🌧️', cover: 0.95, dark: 0.5, rain: 0.55, wind: 0.55, fog: 0.25 },
  storm: { label: '暴风雨', icon: '⛈️', cover: 1, dark: 0.9, rain: 1, wind: 1.1, fog: 0.35, lightning: true },
  fog: { label: '海雾', icon: '🌫️', cover: 0.45, dark: 0.1, rain: 0, wind: 0.08, fog: 1 },
};
const NEXT = {
  clear: ['clear', 'cloudy', 'cloudy', 'fog'], cloudy: ['clear', 'overcast', 'cloudy', 'rain'],
  overcast: ['rain', 'storm', 'cloudy'], rain: ['overcast', 'cloudy', 'storm', 'clear'],
  storm: ['rain', 'overcast'], fog: ['clear', 'cloudy'],
};

const rainVert = /* glsl */`
uniform vec3 uCam; uniform float uTime, uSpeed, uBox, uH, uWorld; uniform vec2 uWindV;
uniform sampler2D uHeight;
attribute float aEnd;
varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uTime * uSpeed * (0.85 + fract(p.x*7.3)*0.3), uH);
  float fallT = (uH - p.y) / uSpeed;
  p.xz += uWindV * fallT;
  p.xz = mod(p.xz - uCam.xz + uBox*0.5, uBox) - uBox*0.5 + uCam.xz;
  p.y += uCam.y - uH*0.35;
  vec3 vel = normalize(vec3(uWindV.x, -uSpeed, uWindV.y));
  p -= vel * aEnd * 0.55;
  float th = texture2D(uHeight, p.xz/uWorld + 0.5).r;
  vA = (p.y < max(th, 0.0)) ? 0.0 : 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */`
uniform float uBright; varying float vA;
void main(){ if (vA < 0.5) discard; gl_FragColor = vec4(vec3(0.75,0.8,0.88)*uBright, 0.32); }`;

export class Weather {
  constructor(scene, heightTex) {
    this.scene = scene;
    this.mode = 'auto'; this.presetKey = 'clear';
    const p = PRESETS.clear;
    Object.assign(this, { cover: p.cover, dark: p.dark, rain: p.rain, wind: p.wind, fog: p.fog });
    this.flash = 0; this.rainbow = 0; this.windAng = 0.6; this.windVec = new THREE.Vector2();
    this.timer = 120; this.lightningT = 6; this.prevRainPeak = 0; this.rainbowT = 0;
    this.strikes = [];

    const N = 9000, pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    const B = 46, H = 28;
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * B, y = Math.random() * H, z = (Math.random() - 0.5) * B;
      pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainU = {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSpeed: { value: 16 }, uBox: { value: B }, uH: { value: H },
      uWorld: { value: WORLD_SIZE }, uWindV: { value: new THREE.Vector2() }, uHeight: { value: heightTex }, uBright: { value: 1 },
    };
    this.rainMesh = new THREE.LineSegments(geo, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false }));
    this.rainMesh.frustumCulled = false; this.rainN = N;
    scene.add(this.rainMesh);

    this.boltMat = new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1, fog: false });
  }
  set(key) { this.mode = key === 'auto' ? 'auto' : 'manual'; if (key !== 'auto') this.presetKey = key; this.timer = 150 + Math.random() * 120; }
  get preset() { return PRESETS[this.presetKey]; }

  strike(game, near = false) {
    const pl = game.player.pos, a = Math.random() * 6.28, d = near ? 40 + Math.random() * 60 : 120 + Math.random() * 500;
    const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
    const ground = Math.max(0, game.terrain.getHeight(x, z));
    const pts = []; let px = x + (Math.random() - 0.5) * 40, py = 260, pz = z + (Math.random() - 0.5) * 40;
    const segs = 22;
    for (let i = 0; i < segs; i++) {
      const t = (i + 1) / segs;
      const nx = lerp(px, x, 0.25) + (Math.random() - 0.5) * 18 * (1 - t), ny = lerp(260, ground, t), nz = lerp(pz, z, 0.25) + (Math.random() - 0.5) * 18 * (1 - t);
      pts.push(px, py, pz, nx, ny, nz);
      if (Math.random() < 0.25) pts.push(nx, ny, nz, nx + (Math.random() - 0.5) * 30, ny - 15 - Math.random() * 20, nz + (Math.random() - 0.5) * 30);
      px = nx; py = ny; pz = nz;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineSegments(g, this.boltMat.clone()); m.frustumCulled = false; this.scene.add(m);
    this.strikes.push({ m, t: 0 });
    this.flash = 1;
    game.audio.thunder(d, Math.max(0.2, d / 340));
    if (ground <= 0.01) game.effects.splash(new THREE.Vector3(x, 0, z), 2);
    game.events.emit('lightning', d);
  }

  update(dt, game) {
    // 自动天气转换
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer < 0) {
        const opts = NEXT[this.presetKey];
        this.presetKey = opts[Math.floor(Math.random() * opts.length)];
        this.timer = (this.presetKey === 'storm' ? 90 : 120) + Math.random() * 140;
        game.events.emit('weather', this.presetKey);
      }
    }
    const P = this.preset, k = Math.min(1, dt / 22), kr = Math.min(1, dt / 12);
    this.cover = lerp(this.cover, P.cover, k); this.dark = lerp(this.dark, P.dark, k);
    this.rain = lerp(this.rain, P.rain, this.rain < P.rain ? k * 0.7 : kr); this.fog = lerp(this.fog, P.fog, k * 0.6);
    const gust = 0.85 + 0.3 * noise2(game.time * 0.08, 3.3) + 0.15 * Math.sin(game.time * 0.9);
    this.wind = lerp(this.wind, P.wind * gust, Math.min(1, dt * 0.4));
    this.windAng += noise2(game.time * 0.01, 9.1) * dt * 0.02;
    this.windVec.set(Math.cos(this.windAng), Math.sin(this.windAng)).multiplyScalar(this.wind * 9);

    // 彩虹：雨后转晴且太阳不太高
    if (this.rain > 0.4) this.prevRainPeak = 1;
    if (this.prevRainPeak && this.rain < 0.12 && P.rain === 0) { this.rainbowT = 70; this.prevRainPeak = 0; game.events.emit('rainbowStart'); }
    this.rainbowT -= dt;
    const e = game.sky.state.elev;
    const rbTarget = this.rainbowT > 0 && e > 0.02 && e < 0.7 && this.cover < 0.85 ? 1 : 0;
    this.rainbow = lerp(this.rainbow, rbTarget, Math.min(1, dt * 0.3));

    // 闪电
    if (P.lightning && this.dark > 0.6) {
      this.lightningT -= dt;
      if (this.lightningT < 0) { this.lightningT = 3 + Math.random() * 9; this.strike(game, Math.random() < 0.15); }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.flash > 0.3 && Math.random() < 0.1) this.flash = 0.9; // 闪烁
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i]; s.t += dt;
      s.m.material.opacity = s.t < 0.35 ? (Math.random() < 0.7 ? 1 : 0.2) : 0;
      if (s.t > 0.4) { this.scene.remove(s.m); s.m.geometry.dispose(); this.strikes.splice(i, 1); }
    }

    // 雨
    const u = this.rainU, cp = game.camera.position;
    u.uCam.value.copy(cp); u.uTime.value = game.time; u.uWindV.value.copy(this.windVec);
    u.uBright.value = game.sky.state.lightCol.r * 0.9 + 0.15 + this.flash;
    this.rainMesh.geometry.setDrawRange(0, Math.floor(this.rainN * 2 * clamp(this.rain, 0, 1)));
    this.rainMesh.visible = this.rain > 0.02;
  }
}
