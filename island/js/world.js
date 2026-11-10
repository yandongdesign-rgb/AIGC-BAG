// 地形：海岛高度场、崖壁、山洞、地表类型、高度纹理
import * as THREE from 'three';
import { noise2, fbm2, smoothstep, lerp, clamp, mulberry32 } from './noise.js';

export const WORLD_SIZE = 640;
export const GRID = 448;
export const H_MIN = -30, H_MAX = 50;
export const CLIFF = { cx: 10, cz: -100, ax: 72, az: 52 };
// 山洞：崖壁南侧面向海岛中心
export const CAVE = { x: 10, faceZ: -48, halfW: 5.5, depth: 19, floorY: 5.2, ceilH: 6.8, roofFront: 3.6 };
CAVE.campfire = new THREE.Vector3(CAVE.x + 1.5, CAVE.floorY, CAVE.faceZ - 11);

function profile(rr) {
  if (rr < 122) return 2.8 + (122 - rr) * 0.03;
  if (rr < 150) return (150 - rr) * 0.1;
  if (rr < 170) return -(rr - 150) * 0.1;
  return Math.max(-22, -2 - (rr - 170) * 0.25);
}

export function caveMask(x, z) {
  const vv = CAVE.faceZ - z;
  if (vv < -3) return 0;
  const u = (x - CAVE.x) / CAVE.halfW;
  const v = Math.max(0, vv) / CAVE.depth;
  return smoothstep(1.0, 0.82, u * u + v * v);
}

export function cliffFactor(x, z) {
  const dx = (x - CLIFF.cx) / CLIFF.ax, dz = (z - CLIFF.cz) / CLIFF.az;
  const nearCave = Math.exp(-((x - CAVE.x) ** 2 + (z - CAVE.faceZ) ** 2) / 250);
  const s = 1 - Math.hypot(dx, dz) + fbm2(x * 0.028, z * 0.028, 3) * 0.13 * (1 - nearCave);
  const east = smoothstep(0.35, 0.85, dx) * smoothstep(0.75, 0.1, Math.abs(dz));
  const w = lerp(0.065, 0.72, east);
  return smoothstep(0, w, s);
}

export function heightFn(x, z, withCave = true) {
  const r = Math.hypot(x, z);
  const rr = r + fbm2(x * 0.0045 + 3.1, z * 0.0045 - 1.7, 4) * 38;
  let h = profile(rr);
  const inland = smoothstep(125, 85, rr);
  const approach = smoothstep(26, 9, Math.hypot(x - CAVE.x, z - (CAVE.faceZ + 5)));
  h += (fbm2(x * 0.012 + 11, z * 0.012, 5) * 0.5 + 0.45) * 9 * inland;
  const beach = smoothstep(112, 126, rr) * smoothstep(160, 148, rr);
  h += fbm2(x * 0.06, z * 0.06, 2) * 0.35 * beach;
  h += noise2(x * 0.17, z * 0.17) * 0.07;
  h = lerp(h, CAVE.floorY + noise2(x * 0.3, z * 0.3) * 0.05, approach);
  const c = cliffFactor(x, z);
  if (c > 0) {
    const top = 35 + fbm2(x * 0.02 + 7, z * 0.02, 3) * 4 + noise2(x * 0.2, z * 0.2) * 0.15;
    h = lerp(h, Math.max(h, top), c);
  }
  if (withCave) {
    const m = caveMask(x, z);
    if (m > 0) h = lerp(h, CAVE.floorY + noise2(x * 0.5, z * 0.5) * 0.06, m);
  }
  return h;
}

// 洞顶高度（洞内拱形）
export function caveCeiling(x, z) {
  const u = (x - CAVE.x) / CAVE.halfW;
  const v = (CAVE.faceZ - z) / CAVE.depth;
  return CAVE.floorY + CAVE.ceilH - 2.6 * u * u - Math.max(0, v) * 1.6 - Math.abs(noise2(x * 0.6, z * 0.6)) * 0.7;
}
export function inCaveRoof(x, z) {
  const v = CAVE.faceZ - z;
  return Math.abs(x - CAVE.x) < CAVE.halfW + 0.5 && v > CAVE.roofFront && v < CAVE.depth + 2;
}
export function isSheltered(x, z) {
  return caveMask(x, z) > 0.4 && (CAVE.faceZ - z) > CAVE.roofFront + 0.8;
}

export class Terrain {
  constructor() {
    const n = GRID, step = WORLD_SIZE / (n - 1);
    this.step = step;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -WORLD_SIZE / 2 + j * step;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_SIZE / 2 + i * step;
        this.heights[j * n + i] = heightFn(x, z);
      }
    }
    this.computeCoast();
  }
  getHeight(x, z) {
    const n = GRID;
    const fx = clamp((x + WORLD_SIZE / 2) / this.step, 0, n - 1.001);
    const fz = clamp((z + WORLD_SIZE / 2) / this.step, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.8;
    const hx = this.getHeight(x + e, z) - this.getHeight(x - e, z);
    const hz = this.getHeight(x, z + e) - this.getHeight(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
  slope(x, z) { return 1 - this.getNormal(x, z, _n).y; }
  surface(x, z) {
    const h = this.getHeight(x, z);
    if (h < -0.15) return 'water';
    if (caveMask(x, z) > 0.3) return 'rock';
    const s = this.slope(x, z);
    if (s > 0.35) return 'rock';
    if (h < 2.9 + noise2(x * 0.08, z * 0.08) * 0.6) return 'sand';
    return 'grass';
  }
  computeCoast() {
    this.coast = new Float32Array(360);
    for (let a = 0; a < 360; a++) {
      const ang = (a / 360) * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang);
      let last = 0;
      for (let r = 0; r < 300; r += 1) if (heightFn(cx * r, cz * r, false) > 0) last = r;
      this.coast[a] = last;
    }
  }
  coastDistance(x, z) {
    let a = Math.round(((Math.atan2(z, x) / (Math.PI * 2)) * 360 + 360)) % 360;
    return Math.hypot(x, z) - this.coast[a];
  }

  buildMesh() {
    const n = GRID;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.heights[k]);
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), tmp = new THREE.Color();
    const SAND = new THREE.Color(0.93, 0.84, 0.64), WET = new THREE.Color(0.70, 0.60, 0.44),
      UNDER = new THREE.Color(0.80, 0.74, 0.55), GRASS1 = new THREE.Color(0.28, 0.46, 0.14),
      GRASS2 = new THREE.Color(0.45, 0.56, 0.2), SOIL = new THREE.Color(0.32, 0.27, 0.18),
      ROCK1 = new THREE.Color(0.44, 0.40, 0.36), ROCK2 = new THREE.Color(0.58, 0.53, 0.47);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const slope = 1 - nor.getY(k);
      const nz = noise2(x * 0.08, z * 0.08), nz2 = noise2(x * 0.5, z * 0.5);
      if (y < -0.2) {
        c.copy(UNDER).multiplyScalar(clamp(1 + y * 0.035, 0.45, 1));
      } else {
        const sandLine = 2.9 + nz * 0.6;
        // 沙 → 草
        c.copy(y < 0.55 ? WET : SAND);
        if (y >= 0.55 && y < 0.9) c.lerpColors(WET, SAND, (y - 0.55) / 0.35);
        const g = smoothstep(sandLine - 0.3, sandLine + 0.5, y);
        if (g > 0) {
          tmp.lerpColors(GRASS1, GRASS2, clamp(nz * 0.7 + 0.5 + nz2 * 0.2, 0, 1));
          if (nz2 > 0.45) tmp.lerp(SOIL, 0.5);
          c.lerp(tmp, g);
        }
        // 岩石
        const rk = smoothstep(0.28, 0.5, slope) + caveMask(x, z);
        if (rk > 0) {
          tmp.lerpColors(ROCK1, ROCK2, clamp(0.5 + Math.sin(y * 1.6 + nz * 3) * 0.35 + nz2 * 0.2, 0, 1));
          c.lerp(tmp, clamp(rk, 0, 1));
        }
      }
      c.multiplyScalar(0.94 + nz2 * 0.08);
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const detail = makeDetailTexture();
    detail.repeat.set(220, 220);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detail });
    this.wetUniform = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = this.wetUniform;
      sh.fragmentShader = 'uniform float uWet;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= (1.0 - 0.3*uWet);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.38, uWet*0.75);');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  // 洞顶岩块：填补崖壁上方，底面为拱形洞顶
  buildCaveRoof(rockMat) {
    const W = (CAVE.halfW + 1.8) * 2, zFront = CAVE.faceZ - CAVE.roofFront, zBack = CAVE.faceZ - CAVE.depth - 2.5;
    const geo = new THREE.BoxGeometry(1, 1, 1, 28, 6, 36);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const bx = p.getX(k), by = p.getY(k), bz = p.getZ(k);
      const x = CAVE.x + bx * W;
      let z = lerp(zBack, zFront, bz + 0.5);
      const bottom = caveCeiling(x, z) - 0.05;
      const top = heightFn(x, z, false) + 0.25;
      let y = lerp(bottom, top, by + 0.5);
      if (bz > 0.49) z += noise2(x * 0.7, y * 0.7) * 0.25 - 0.1;
      p.setXYZ(k, x, y, z);
    }
    geo.computeVertexNormals();
    // 与地形岩石同色的顶点色
    const cols = new Float32Array(p.count * 3), c = new THREE.Color();
    const R1 = new THREE.Color(0.44, 0.40, 0.36), R2 = new THREE.Color(0.58, 0.53, 0.47);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const nz = noise2(x * 0.08, z * 0.08), nz2 = noise2(x * 0.5, z * 0.5);
      c.lerpColors(R1, R2, clamp(0.5 + Math.sin(y * 1.6 + nz * 3) * 0.35 + nz2 * 0.2, 0, 1)).multiplyScalar(0.94 + nz2 * 0.08);
      cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  heightTexture(size = 384) {
    const data = new Uint16Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -WORLD_SIZE / 2 + (i / (size - 1)) * WORLD_SIZE;
      const z = -WORLD_SIZE / 2 + (j / (size - 1)) * WORLD_SIZE;
      let h = this.getHeight(x, z);
      if (inCaveRoof(x, z)) h = 40; // 屋顶下不下雨
      data[j * size + i] = THREE.DataUtils.toHalfFloat(h);
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // 随机找满足条件的位置
  randomSpot(pred, rng = Math.random, tries = 400, range = 300) {
    for (let t = 0; t < tries; t++) {
      const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
      const h = this.getHeight(x, z);
      if (pred(x, z, h)) return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  minimapImage(size = 180) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'); const img = g.createImageData(size, size);
    const R = 230;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i / size * 2 - 1) * R, z = (j / size * 2 - 1) * R;
      const h = this.getHeight(x, z); let r, gg, b, a = 255;
      if (h < 0) { const d = clamp(-h / 18, 0, 1); r = 40 - d * 30; gg = 170 - d * 110; b = 190 - d * 60; a = 150; }
      else if (h < 2.9) { r = 236; gg = 214; b = 160; }
      else if (h > 18) { const k = clamp((h - 18) / 20, 0, 1); r = 120 - k * 10; gg = 125 - k * 15; b = 100; }
      else { r = 70; gg = 130; b = 60; }
      const o = (j * size + i) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}
const _n = new THREE.Vector3();

function makeDetailTexture() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d'); const img = g.createImageData(s, s);
  const r = mulberry32(5);
  for (let k = 0; k < s * s; k++) {
    const v = 215 + r() * 40;
    img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeRockMaterial() {
  const tex = (() => {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d'); const img = g.createImageData(s, s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const n = fbm2(i * 0.05, j * 0.05, 5) * 0.5 + 0.5, st = Math.sin(j * 0.25 + n * 6) * 0.08;
      const v = clamp(0.72 + n * 0.28 + st, 0, 1) * 255;
      const o = (j * s + i) * 4; img.data[o] = v * 1.04; img.data[o + 1] = v * 0.97; img.data[o + 2] = v * 0.88; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9b0a4, map: tex, roughness: 0.95 });
  // 三向投影，避免拉伸
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriW; varying vec3 vTriN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vec4 tw = modelMatrix * vec4(transformed,1.0);\n#ifdef USE_INSTANCING\n tw = modelMatrix * instanceMatrix * vec4(transformed,1.0);\n#endif\n vTriW = tw.xyz; vTriN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriW; varying vec3 vTriN;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(vTriN), vec3(4.0)); bw /= (bw.x+bw.y+bw.z);
        vec3 tx = texture2D(map, vTriW.zy*0.18).rgb, ty = texture2D(map, vTriW.xz*0.18).rgb, tz = texture2D(map, vTriW.xy*0.18).rgb;
        diffuseColor.rgb *= tx*bw.x + ty*bw.y + tz*bw.z;`);
  };
  return mat;
}
