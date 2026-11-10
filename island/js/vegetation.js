// 热带植被：椰子树、蕨类、芭蕉、扶桑花、草丛、丛林树、礁石（含风吹摇摆着色器）
import * as THREE from 'three';
import { mulberry32, noise2, smoothstep, clamp, lerp } from './noise.js';
import { CAVE, caveMask, cliffFactor } from './world.js';

export const windU = { uTime: { value: 0 }, uWind: { value: 0.3 }, uWindDir: { value: new THREE.Vector2(1, 0) } };

export function applyWind(mat, bend, flutter) {
  const local = { uBend: { value: bend }, uFlutter: { value: flutter } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, windU, local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uWind, uBend, uFlutter; uniform vec2 uWindDir; attribute float aFlex;')
      .replace('#include <project_vertex>', `
        mat4 wIM = mat4(1.0);
        #ifdef USE_INSTANCING
        wIM = instanceMatrix;
        #endif
        vec4 wp = modelMatrix * wIM * vec4(transformed, 1.0);
        vec3 org = (modelMatrix * wIM * vec4(0.0,0.0,0.0,1.0)).xyz;
        float hh = max(wp.y - org.y, 0.0);
        float ph = org.x*0.05 + org.z*0.07;
        float gust = sin(uTime*1.3 + ph)*0.5 + 0.6 + sin(uTime*0.37 + ph*2.0)*0.3;
        wp.xz += uWindDir * gust * uWind * uBend * hh * hh;
        wp.xyz += vec3(sin(uTime*7.0 + wp.x*1.7 + wp.z*1.3), sin(uTime*9.0 + wp.z*2.1)*0.6, cos(uTime*6.3 + wp.z*1.9)) * aFlex * uFlutter * (0.25 + uWind);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'wind';
  return mat;
}
// JS 端同样的摇摆（让椰子跟随树冠）
export function windOffset(org, hh, bend, out) {
  const ph = org.x * 0.05 + org.z * 0.07, t = windU.uTime.value;
  const gust = Math.sin(t * 1.3 + ph) * 0.5 + 0.6 + Math.sin(t * 0.37 + ph * 2) * 0.3;
  const k = gust * windU.uWind.value * bend * hh * hh;
  return out.set(windU.uWindDir.value.x * k, 0, windU.uWindDir.value.y * k);
}

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 椰子叶纹理
const frondTex = () => canvasTex(128, 512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const v = 0.04 + i / 72;
    const y = h - v * h, len = Math.sin(Math.min(1, v * 1.15) * Math.PI) * w * 0.5 + 4;
    const hue = 95 + Math.random() * 25, l = 26 + Math.random() * 14;
    g.strokeStyle = `hsl(${hue},55%,${l}%)`; g.lineWidth = 3.2;
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(w / 2, y);
      g.quadraticCurveTo(w / 2 + s * len * 0.5, y - 10, w / 2 + s * len, y - 26 - Math.random() * 6); g.stroke();
    }
  }
  g.strokeStyle = '#6b6a2c'; g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
});
const fernTex = () => canvasTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.translate(w / 2, h);
  for (let f = 0; f < 3; f++) {
    g.save(); g.rotate((f - 1) * 0.25);
    for (let i = 0; i < 26; i++) {
      const y = -i * 9 - 10, len = Math.sin((i / 26) * Math.PI) * 50 + 6;
      g.fillStyle = `hsl(${100 + Math.random() * 25},50%,${36 + Math.random() * 14}%)`;
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * len / 2, y - 4, len / 2, 3.2, s * -0.35, 0, Math.PI * 2); g.fill(); }
    }
    g.strokeStyle = '#3f5a1c'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -240); g.stroke();
    g.restore();
  }
});
const leafTex = () => canvasTex(128, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#2f6b1e'); grd.addColorStop(0.5, '#4f9a2a'); grd.addColorStop(1, '#2f6b1e');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(w / 2, h);
  g.bezierCurveTo(-10, h * 0.7, 0, h * 0.15, w / 2, 0);
  g.bezierCurveTo(w, h * 0.15, w + 10, h * 0.7, w / 2, h); g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) { const y = 30 + Math.random() * (h - 60), s = Math.random() < 0.5 ? 0 : w; g.fillRect(Math.min(s, w - 30), y, 30, 1.5); }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#c9d77a'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 4); g.stroke();
  g.strokeStyle = 'rgba(200,220,120,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 18; i++) { const y = 20 + i * 13; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(6, y - 18); g.moveTo(w / 2, y); g.lineTo(w - 6, y - 18); g.stroke(); }
});

class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.f = []; this.idx = []; }
  v(x, y, z, u, v, col, flex) { this.p.push(x, y, z); this.uv.push(u, v); this.c.push(col.r, col.g, col.b); this.f.push(flex); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.f, 1));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}
// 可变半径的管道（树干、海螺共用）
export function variableTube(centerFn, radiusFn, segs, radial, colorFn, flexFn = () => 0) {
  const b = new GeoBuilder();
  const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = centerFn(t), c2 = centerFn(Math.min(1, t + 0.01)), c1 = centerFn(Math.max(0, t - 0.01));
    tan.subVectors(c2, c1).normalize();
    nrm.crossVectors(tan, Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    bin.crossVectors(tan, nrm).normalize();
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      b.v(c.x + (nrm.x * ca + bin.x * sa) * r, c.y + (nrm.y * ca + bin.y * sa) * r, c.z + (nrm.z * ca + bin.z * sa) * r, j / radial, t, colorFn(t, a), flexFn(t));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, bb = a + radial + 1;
    b.tri(a, bb, a + 1); b.tri(a + 1, bb, bb + 1);
  }
  return b.build();
}

function buildPalm(rng) {
  const H = 7 + rng() * 4, lean = 0.12 + rng() * 0.3;
  const curve = (t) => new THREE.Vector3(Math.pow(t, 1.8) * H * lean, t * H, 0);
  const brown = new THREE.Color(), dark = new THREE.Color(0.30, 0.22, 0.15), light = new THREE.Color(0.55, 0.45, 0.33);
  const trunk = variableTube(curve, (t) => 0.27 * (1 - t * 0.35) + (Math.sin(t * H * 6.3) > 0.7 ? 0.02 : 0), 22, 8,
    (t) => brown.lerpColors(light, dark, Math.sin(t * H * 6.3) > 0.6 ? 0.8 : 0.2 + Math.random() * 0.1).clone());
  const crown = curve(1);
  const b = new GeoBuilder(); const white = new THREE.Color(1, 1, 1);
  const nF = 9 + Math.floor(rng() * 4);
  for (let f = 0; f < nF; f++) {
    const th = (f / nF) * Math.PI * 2 + rng() * 0.4, el = 0.25 + rng() * 0.6, L = 3.8 + rng() * 1.6, droop = 0.9 + rng() * 0.6;
    const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const N = 10, base = b.p.length / 3;
    for (let k = 0; k <= N; k++) {
      const s = k / N;
      const pos = crown.clone().addScaledVector(dir, s * L * Math.cos(el)).add(new THREE.Vector3(0, s * L * Math.sin(el) - droop * s * s * L * 0.75, 0));
      const wd = Math.sin(Math.min(1, s * 1.15 + 0.05) * Math.PI) * 0.75 + 0.05;
      const fold = -0.18 * wd;
      b.v(pos.x - side.x * wd, pos.y + fold, pos.z - side.z * wd, 0, s, white, s);
      b.v(pos.x, pos.y, pos.z, 0.5, s, white, s);
      b.v(pos.x + side.x * wd, pos.y + fold, pos.z + side.z * wd, 1, s, white, s);
    }
    for (let k = 0; k < N; k++) {
      const a = base + k * 3, c = a + 3;
      b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1); b.tri(a + 1, c + 1, a + 2); b.tri(a + 2, c + 1, c + 2);
    }
  }
  return { trunk, fronds: b.build(), crown, height: H };
}

function buildGrassTuft(rng) {
  const b = new GeoBuilder(); const c0 = new THREE.Color(0.16, 0.30, 0.08), c1 = new THREE.Color(0.55, 0.68, 0.25);
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2, h = 0.35 + rng() * 0.45, bend = 0.1 + rng() * 0.2, w = 0.045;
    const dx = Math.cos(a), dz = Math.sin(a), ox = (rng() - 0.5) * 0.25, oz = (rng() - 0.5) * 0.25;
    const base = b.p.length / 3;
    for (let k = 0; k <= 2; k++) {
      const t = k / 2, ww = w * (1 - t * 0.85);
      const x = ox + dx * bend * t * t, z = oz + dz * bend * t * t, y = h * t;
      const col = new THREE.Color().lerpColors(c0, c1, t);
      b.v(x - dz * ww, y, z + dx * ww, 0, t, col, t * t);
      b.v(x + dz * ww, y, z - dx * ww, 1, t, col, t * t);
    }
    for (let k = 0; k < 2; k++) { const a0 = base + k * 2; b.tri(a0, a0 + 2, a0 + 1); b.tri(a0 + 1, a0 + 2, a0 + 3); }
  }
  return b.build();
}

function crossedPlanes(n, w, h, flexTop = 1, tilt = 0) {
  const b = new GeoBuilder(); const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const base = b.p.length / 3;
    b.v(-dx, 0, -dz, 0, 0, white, 0); b.v(dx, 0, dz, 1, 0, white, 0);
    b.v(-dx, h, -dz + tilt, 0, 1, white, flexTop); b.v(dx, h, dz + tilt, 1, 1, white, flexTop);
    b.tri(base, base + 1, base + 2); b.tri(base + 1, base + 3, base + 2);
  }
  return b.build();
}

function buildBanana(rng) {
  const b = new GeoBuilder(); const white = new THREE.Color(1, 1, 1);
  const nL = 6;
  for (let l = 0; l < nL; l++) {
    const th = (l / nL) * Math.PI * 2 + rng() * 0.5, L = 1.6 + rng() * 0.6, el = 0.9 + rng() * 0.4, W = 0.45;
    const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const stem = 0.9 + rng() * 0.6, N = 8, base = b.p.length / 3;
    for (let k = 0; k <= N; k++) {
      const s = k / N;
      const pos = new THREE.Vector3(0, stem, 0).addScaledVector(dir, s * L * Math.cos(el) + s * 0.3).add(new THREE.Vector3(0, s * L * Math.sin(el) * (1 - s * 0.9), 0));
      b.v(pos.x - side.x * W, pos.y - 0.06, pos.z - side.z * W, 0, s, white, s);
      b.v(pos.x + side.x * W, pos.y - 0.06, pos.z + side.z * W, 1, s, white, s);
    }
    for (let k = 0; k < N; k++) { const a = base + k * 2; b.tri(a, a + 2, a + 1); b.tri(a + 1, a + 2, a + 3); }
  }
  return b.build();
}

function buildFlower() {
  const b = new GeoBuilder(); const white = new THREE.Color(1, 1, 1), yel = new THREE.Color(1, 0.9, 0.3);
  const c = b.v(0, 0.02, 0, 0.5, 0.5, yel, 0.5);
  const N = 5;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, a1 = a - 0.5, a2 = a + 0.5;
    const p1 = b.v(Math.cos(a1) * 0.06, 0.03, Math.sin(a1) * 0.06, 0, 0, white, 0.5);
    const p2 = b.v(Math.cos(a) * 0.13, 0.07, Math.sin(a) * 0.13, 0, 0, white, 0.6);
    const p3 = b.v(Math.cos(a2) * 0.06, 0.03, Math.sin(a2) * 0.06, 0, 0, white, 0.5);
    b.tri(c, p1, p2); b.tri(c, p2, p3);
  }
  // 花蕊
  const s0 = b.v(0, 0, 0.005, 0, 0, yel, 0.5), s1 = b.v(0, 0.14, 0.03, 0, 0, yel, 0.7), s2 = b.v(0.01, 0, -0.005, 0, 0, yel, 0.5);
  b.tri(s0, s1, s2);
  return b.build();
}

function buildJungleTree(rng) {
  const H = 5 + rng() * 4;
  const trunk = variableTube((t) => new THREE.Vector3(Math.sin(t * 3) * 0.3, t * H, 0), (t) => 0.32 * (1 - t * 0.5), 10, 7,
    () => new THREE.Color(0.36, 0.28, 0.2));
  const crowns = [];
  const b = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.IcosahedronGeometry(1.4 + rng() * 1.1, 1);
    g.translate((rng() - 0.5) * 3, H + (rng() - 0.3) * 1.6, (rng() - 0.5) * 3);
    const col = new THREE.Color().setHSL(0.27 + rng() * 0.06, 0.55, 0.22 + rng() * 0.1);
    const n = g.attributes.position.count, cols = new Float32Array(n * 3), fl = new Float32Array(n).fill(0.4);
    for (let k = 0; k < n; k++) { const v = 0.85 + Math.random() * 0.3; cols[k * 3] = col.r * v; cols[k * 3 + 1] = col.g * v; cols[k * 3 + 2] = col.b * v; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.setAttribute('aFlex', new THREE.BufferAttribute(fl, 1));
    crowns.push(g);
  }
  return { trunk, crown: mergeSimple(crowns), height: H };
}
function mergeSimple(geos) {
  const attrs = ['position', 'normal', 'color', 'aFlex'];
  const out = new THREE.BufferGeometry();
  for (const a of attrs) {
    const size = geos[0].attributes[a].itemSize; let len = 0;
    geos.forEach((g) => (len += g.attributes[a].array.length));
    const arr = new Float32Array(len); let o = 0;
    geos.forEach((g) => { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; });
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export function buildRockGeo(rng, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position; const ox = rng() * 100;
  for (let k = 0; k < p.count; k++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, k);
    const n = 1 + noise2(v.x * 1.6 + ox, v.y * 1.6 + v.z) * 0.25 + noise2(v.z * 4 + ox, v.x * 4) * 0.06;
    v.multiplyScalar(n); v.y *= 0.65; p.setXYZ(k, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Vegetation {
  constructor(scene, terrain, rockMat) {
    this.scene = scene; this.terrain = terrain; this.palms = []; this.obstacles = []; this.flowerSpots = [];
    const rng = mulberry32(42);
    const T = terrain;
    const free = (x, z, rad) => !this.obstacles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + rad) ** 2);
    const nearCave = (x, z) => Math.hypot(x - CAVE.x, z - (CAVE.faceZ + 4)) < 13 || caveMask(x, z) > 0.01;
    const dummy = new THREE.Object3D();

    // —— 椰子树 ——
    const palmVariants = [0, 1, 2, 3].map(() => buildPalm(rng));
    const ftex = frondTex();
    const trunkMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0.012, 0);
    const frondMat = applyWind(new THREE.MeshStandardMaterial({ map: ftex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), 0.012, 0.07);
    const palmSpots = [];
    for (let i = 0; i < 2000 && palmSpots.length < 85; i++) {
      const p = T.randomSpot((x, z, h) => h > 0.9 && h < (rng() < 0.75 ? 4.5 : 16) && T.slope(x, z) < 0.25 && !nearCave(x, z) && free(x, z, 3.5), rng, 30);
      if (p) { palmSpots.push(p); this.obstacles.push({ x: p.x, z: p.z, r: 0.45, h: 9, palm: true }); }
    }
    palmVariants.forEach((v, vi) => {
      const spots = palmSpots.filter((_, i) => i % 4 === vi);
      const tm = new THREE.InstancedMesh(v.trunk, trunkMat, spots.length), fm = new THREE.InstancedMesh(v.fronds, frondMat, spots.length);
      tm.castShadow = fm.castShadow = true; tm.receiveShadow = fm.receiveShadow = true;
      spots.forEach((p, i) => {
        const s = 0.85 + rng() * 0.35, ry = rng() * Math.PI * 2;
        dummy.position.set(p.x, p.y - 0.2, p.z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
        tm.setMatrixAt(i, dummy.matrix); fm.setMatrixAt(i, dummy.matrix);
        const crown = v.crown.clone().applyMatrix4(dummy.matrix);
        const ob = this.obstacles.find((o) => o.x === p.x && o.z === p.z); ob.h = v.height * s;
        this.palms.push({ pos: p.clone(), crown, height: crown.y - p.y, ob, shakeT: 0 });
      });
      scene.add(tm, fm);
    });

    // —— 丛林树 ——
    const jt = [0, 1, 2].map(() => buildJungleTree(rng));
    const jtTrunk = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.004, 0);
    const jtCrown = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), 0.004, 0.04);
    jt.forEach((v) => {
      const spots = [];
      for (let i = 0; i < 400 && spots.length < 22; i++) {
        const p = T.randomSpot((x, z, h) => h > 5 && h < 15 && T.slope(x, z) < 0.3 && !nearCave(x, z) && free(x, z, 4), rng, 30);
        if (p) { spots.push(p); this.obstacles.push({ x: p.x, z: p.z, r: 0.5, h: 7 }); }
      }
      const tm = new THREE.InstancedMesh(v.trunk, jtTrunk, spots.length), cm = new THREE.InstancedMesh(v.crown, jtCrown, spots.length);
      tm.castShadow = cm.castShadow = true; tm.receiveShadow = cm.receiveShadow = true;
      spots.forEach((p, i) => {
        const s = 0.8 + rng() * 0.5; dummy.position.set(p.x, p.y - 0.2, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
        tm.setMatrixAt(i, dummy.matrix); cm.setMatrixAt(i, dummy.matrix);
      });
      scene.add(tm, cm);
    });

    // —— 草丛 ——
    const grassGeo = buildGrassTuft(rng);
    const grassMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), 0.25, 0.05);
    const GN = 14000; const gm = new THREE.InstancedMesh(grassGeo, grassMat, GN); let gi = 0;
    const gc = new THREE.Color();
    for (let i = 0; i < GN * 3 && gi < GN; i++) {
      const p = T.randomSpot((x, z, h) => h > 3.2 && T.surface(x, z) === 'grass' && caveMask(x, z) < 0.01, rng, 10, 230);
      if (!p) continue;
      const s = 0.7 + rng() * 0.8; dummy.position.set(p.x, p.y - 0.05, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(s, s * (0.7 + rng() * 0.6), s); dummy.updateMatrix();
      gm.setMatrixAt(gi, dummy.matrix); gm.setColorAt(gi, gc.setHSL(0.22 + rng() * 0.08, 0.5, 0.45 + rng() * 0.25)); gi++;
    }
    gm.count = gi; gm.receiveShadow = true; scene.add(gm);

    // —— 蕨类 ——
    const fernGeo = crossedPlanes(3, 1.6, 1.1, 1, 0.15);
    const fernMat = applyWind(new THREE.MeshStandardMaterial({ map: fernTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), 0.06, 0.06);
    const FN = 900; const fm = new THREE.InstancedMesh(fernGeo, fernMat, FN); let fi = 0;
    for (let i = 0; i < FN * 3 && fi < FN; i++) {
      const p = T.randomSpot((x, z, h) => h > 3.5 && T.surface(x, z) === 'grass' && !nearCave(x, z) && free(x, z, 0.5), rng, 10, 230);
      if (!p) continue;
      const s = 0.7 + rng() * 0.9; dummy.position.set(p.x, p.y - 0.05, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      fm.setMatrixAt(fi, dummy.matrix); fm.setColorAt(fi, gc.setHSL(0.25, 0.3, 0.6 + rng() * 0.4)); fi++;
      if (rng() < 0.35) this.flowerSpots.push(new THREE.Vector3(p.x + (rng() - 0.5), p.y + 0.6 + rng() * 0.4, p.z + (rng() - 0.5)));
    }
    fm.count = fi; fm.castShadow = true; fm.receiveShadow = true; scene.add(fm);

    // —— 芭蕉 / 宽叶植物 ——
    const banGeo = buildBanana(rng);
    const banMat = applyWind(new THREE.MeshStandardMaterial({ map: leafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }), 0.08, 0.05);
    const BN = 220; const bm = new THREE.InstancedMesh(banGeo, banMat, BN); let bi = 0;
    for (let i = 0; i < BN * 4 && bi < BN; i++) {
      const p = T.randomSpot((x, z, h) => h > 3.6 && h < 16 && T.surface(x, z) === 'grass' && !nearCave(x, z) && free(x, z, 1), rng, 10, 220);
      if (!p) continue;
      const s = 0.8 + rng() * 0.8; dummy.position.set(p.x, p.y - 0.05, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      bm.setMatrixAt(bi, dummy.matrix); bm.setColorAt(bi, gc.setHSL(0.25, 0.3, 0.75 + rng() * 0.25)); bi++;
    }
    bm.count = bi; bm.castShadow = true; bm.receiveShadow = true; scene.add(bm);

    // —— 扶桑花 ——
    const flGeo = buildFlower();
    const flMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x220000, emissiveIntensity: 0.2 }), 0.06, 0.03);
    const flowerColors = [0xff3355, 0xff6a3d, 0xffd23f, 0xff7fbf, 0xffffff, 0xd14cff];
    const FLN = 600; const flm = new THREE.InstancedMesh(flGeo, flMat, FLN); let li = 0;
    for (let i = 0; i < FLN * 3 && li < FLN; i++) {
      const p = T.randomSpot((x, z, h) => h > 3 && T.surface(x, z) === 'grass' && caveMask(x, z) < 0.01, rng, 10, 230);
      if (!p) continue;
      const s = 0.8 + rng() * 0.8; dummy.position.set(p.x, p.y + 0.3 + rng() * 0.5, p.z);
      dummy.rotation.set((rng() - 0.5) * 0.8, rng() * 6.28, (rng() - 0.5) * 0.8); dummy.scale.setScalar(s); dummy.updateMatrix();
      flm.setMatrixAt(li, dummy.matrix); flm.setColorAt(li, gc.set(flowerColors[Math.floor(rng() * flowerColors.length)])); li++;
      if (rng() < 0.2) this.flowerSpots.push(dummy.position.clone());
    }
    flm.count = li; scene.add(flm);

    // —— 礁石 ——
    const rockGeos = [0, 1, 2, 3].map(() => buildRockGeo(rng));
    rockGeos.forEach((geo, ri) => {
      const RN = 60; const rm = new THREE.InstancedMesh(geo, rockMat, RN); let k = 0;
      for (let i = 0; i < RN * 6 && k < RN; i++) {
        const type = rng();
        const p = T.randomSpot((x, z, h) => {
          if (nearCave(x, z) && type > 0.2) return false;
          if (type < 0.45) return h > -2.5 && h < 1.2; // 岸边礁石
          if (type < 0.75) return cliffFactor(x, z) > 0.05 && cliffFactor(x, z) < 0.6 && h < 12; // 崖脚
          return h > 3 && T.slope(x, z) < 0.4;
        }, rng, 10);
        if (!p) continue;
        const s = type < 0.45 ? 0.6 + rng() * 2.2 : type < 0.75 ? 1.2 + rng() * 3 : 0.3 + rng() * 1.2;
        dummy.position.set(p.x, p.y - s * 0.15, p.z); dummy.rotation.set(rng() * 0.4, rng() * 6.28, rng() * 0.4); dummy.scale.set(s, s * (0.6 + rng() * 0.6), s * (0.7 + rng() * 0.6)); dummy.updateMatrix();
        rm.setMatrixAt(k++, dummy.matrix);
        if (s > 0.8) this.obstacles.push({ x: p.x, z: p.z, r: s * 0.85, h: s, rock: true, top: p.y + s * 0.5 });
        if (type < 0.45 && s > 1.2) (this.rockPerches ||= []).push(new THREE.Vector3(p.x, p.y + s * 0.45, p.z));
      }
      rm.count = k; rm.castShadow = true; rm.receiveShadow = true; scene.add(rm);
    });
  }
}
