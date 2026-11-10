// 可拾取物品：贝壳、海螺、海星、鹅卵石、椰子、浮木、漂流瓶、螃蟹；以及抛掷物理
import * as THREE from 'three';
import { mulberry32, clamp, lerp } from './noise.js';
import { variableTube, windOffset } from './vegetation.js';
import { CAVE, inCaveRoof, caveCeiling } from './world.js';

export const TYPES = {
  shell: { name: '扇贝壳', icon: '🐚', r: 0.07, floats: false, skip: true, rest: 0.25, sizeK: 1 },
  conch: { name: '海螺', icon: '🐌', r: 0.11, floats: false, skip: false, rest: 0.2 },
  starfish: { name: '海星', icon: '⭐', r: 0.08, floats: false, skip: true, rest: 0.15 },
  stone: { name: '扁平鹅卵石', icon: '🪨', r: 0.05, floats: false, skip: true, rest: 0.35 },
  coconut: { name: '椰子', icon: '🥥', r: 0.13, floats: true, skip: false, rest: 0.3 },
  stick: { name: '浮木', icon: '🪵', r: 0.08, floats: true, skip: false, rest: 0.25 },
  bottle: { name: '漂流瓶', icon: '🍾', r: 0.08, floats: true, skip: false, rest: 0.3 },
  crab: { name: '小螃蟹', icon: '🦀', r: 0.1, floats: false, skip: false, rest: 0.2 },
};

const NOTES = [
  '“给捡到这只瓶子的人：愿你的每一次日落都有人陪你看。” —— 一个远方的水手',
  '“我在北纬某处，把今天最好的风装进了瓶子里。”',
  '“如果你听见海螺里的海声，那是我在说你好。”',
  '“岛的北面崖壁下有个洞，暴风雨来时去那里，点一堆火。”',
  '“扔一颗扁石头，数一数它在海面跳了几下——我的纪录是 7 次。”',
  '“慢一点走，螃蟹会到你身边来。坐下来，它们就不怕了。”',
  '“雨后，背对太阳，也许你会看见彩虹。”',
  '“夜里抬头看，流星会替你记住愿望。”',
];

let rng = mulberry32(99);
const geos = {};
function shellGeo() {
  const b = []; const idx = []; const R = 6, A = 16;
  for (let i = 0; i <= R; i++) for (let j = 0; j <= A; j++) {
    const r = i / R, a = (j / A - 0.5) * 2.4;
    const ridge = 1 + 0.12 * Math.cos(a * 16);
    b.push(Math.sin(a) * r * ridge, (1 - r * r) * 0.28 * ridge + 0.02, Math.cos(a) * r * ridge - 0.3);
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < A; j++) { const a = i * (A + 1) + j, c = a + A + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b, 3)); g.setIndex(idx);
  g.scale(0.08, 0.08, 0.08); g.computeVertexNormals(); return g;
}
function conchGeo() {
  const turns = 4.2;
  const center = (t) => { const th = t * turns * Math.PI * 2, rr = 0.004 + 0.045 * Math.pow(t, 1.5); return new THREE.Vector3(Math.cos(th) * rr, 0.16 * (1 - t) - 0.02, Math.sin(th) * rr); };
  const c1 = new THREE.Color(0.96, 0.88, 0.75), c2 = new THREE.Color(0.9, 0.5, 0.3);
  const g = variableTube(center, (t) => 0.003 + 0.055 * Math.pow(t, 1.7), 80, 12, (t, a) => new THREE.Color().lerpColors(c1, c2, (Math.sin(a * 3 + t * 40) * 0.5 + 0.5) * 0.6 * t + (a > 2.5 && a < 3.8 ? 0.4 * t : 0)));
  g.rotateZ(Math.PI / 2.4);
  return g;
}
function starGeo() {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 === 0 ? 0.1 : 0.038; i === 0 ? s.moveTo(Math.cos(a) * r, Math.sin(a) * r) : s.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); return g;
}
function bottleGroup() {
  const pts = [[0, 0], [0.04, 0], [0.045, 0.01], [0.045, 0.16], [0.03, 0.2], [0.015, 0.23], [0.015, 0.27]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ color: 0x5fb08a, transparent: true, opacity: 0.45, roughness: 0.08, metalness: 0.1 }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x9a6a3a }));
  cork.position.y = 0.275;
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xf2e6c8 }));
  paper.position.y = 0.08;
  const g = new THREE.Group(); g.add(glass, cork, paper);
  g.children.forEach((c) => { c.position.y -= 0.13; c.castShadow = true; });
  g.rotation.z = Math.PI / 2;
  const w = new THREE.Group(); w.add(g); return w;
}
export function buildCrab() {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd8451f, roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xc23d1a, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), shellMat); body.scale.set(1.35, 0.5, 1); body.position.y = 0.07; g.add(body);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05), legMat); stalk.position.set(s * 0.03, 0.11, 0.06); g.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeM); eye.position.set(s * 0.03, 0.14, 0.06); g.add(eye);
  }
  const legs = [], claws = [];
  const legGeo = new THREE.CylinderGeometry(0.007, 0.005, 0.11); legGeo.translate(0, -0.055, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.1, 0.07, -0.035 + i * 0.035);
    const leg = new THREE.Mesh(legGeo, legMat); leg.rotation.z = s * 1.0; pivot.add(leg); g.add(pivot);
    legs.push({ pivot, s, i });
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.07, 0.08, 0.08);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.06), legMat); a.rotation.x = Math.PI / 2; a.position.z = 0.03; arm.add(a);
    const pincer = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), shellMat); pincer.scale.set(0.8, 0.6, 1.3); pincer.position.z = 0.07; arm.add(pincer);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.04), shellMat); jaw.position.set(s * -0.012, -0.012, 0.095); arm.add(jaw);
    arm.rotation.y = -s * 0.5; g.add(arm); claws.push({ arm, jaw, s });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legs, claws };
  return g;
}

function makeMesh(type) {
  const shellColors = [0xf6c7b6, 0xf2e1c4, 0xf4a26b, 0xfff4e6, 0xe8a1b8];
  let m;
  switch (type) {
    case 'shell': m = new THREE.Mesh(geos.shell ||= shellGeo(), new THREE.MeshStandardMaterial({ color: shellColors[Math.floor(rng() * shellColors.length)], roughness: 0.5, side: THREE.DoubleSide })); break;
    case 'conch': m = new THREE.Mesh(geos.conch ||= conchGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })); break;
    case 'starfish': m = new THREE.Mesh(geos.star ||= starGeo(), new THREE.MeshStandardMaterial({ color: [0xff7a3d, 0xe8504a, 0xf6a23c][Math.floor(rng() * 3)], roughness: 0.8 })); break;
    case 'stone': { const g = new THREE.IcosahedronGeometry(0.055, 1); g.scale(1, 0.38, 0.8); m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.08, 0.35 + rng() * 0.3), roughness: 0.7, flatShading: true })); break; }
    case 'coconut': { const g = geos.coco ||= (() => { const s = new THREE.SphereGeometry(0.13, 14, 10); s.scale(1, 1.15, 1); return s; })(); m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: rng() < 0.5 ? 0x6b4a2b : 0x7a8a35, roughness: 0.8 })); break; }
    case 'stick': { const g = new THREE.CylinderGeometry(0.03, 0.045, 0.9 + rng() * 0.5, 7, 4); const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) + Math.sin(p.getY(k) * 3) * 0.04); g.computeVertexNormals(); g.rotateZ(Math.PI / 2); m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb4a58c, roughness: 0.95 })); break; }
    case 'bottle': m = bottleGroup(); break;
    case 'crab': m = buildCrab(); break;
  }
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return m;
}

export class Item {
  constructor(type, pos) {
    this.type = type; this.def = TYPES[type]; this.mesh = makeMesh(type);
    this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.spin = new THREE.Vector3();
    this.state = 'rest'; this.skips = 0; this.age = 0; this.bob = Math.random() * 10;
    this.mesh.position.copy(pos); this.mesh.rotation.y = Math.random() * Math.PI * 2;
    if (type === 'bottle') this.note = NOTES[Math.floor(Math.random() * NOTES.length)];
    // 螃蟹 AI
    if (type === 'crab') { this.ai = { mode: 'idle', t: Math.random() * 3, target: new THREE.Vector3(), speed: 0, phase: 0, hidden: 0 }; }
  }
  setHighlight(on) {
    if (this._hl === on) return; this._hl = on;
    this.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) { o.material.emissive.setHex(on ? 0x664422 : 0x000000); } });
  }
}

export class ItemSystem {
  constructor(scene, terrain, vegetation) {
    this.scene = scene; this.terrain = terrain; this.veg = vegetation; this.items = [];
    this.respawnT = 0;
    const T = terrain;
    const beach = (x, z, h) => h > 0.15 && h < 2.6 && T.slope(x, z) < 0.2;
    const spawnN = (type, n, pred) => { for (let i = 0; i < n; i++) { const p = T.randomSpot(pred); if (p) this.add(type, p); } };
    spawnN('shell', 34, beach);
    spawnN('conch', 8, beach);
    spawnN('starfish', 12, (x, z, h) => h > -0.6 && h < 1.2);
    spawnN('stone', 24, (x, z, h) => h > 0.05 && h < 2.2);
    spawnN('stick', 10, beach);
    spawnN('bottle', 2, (x, z, h) => h > 0.1 && h < 1.0);
    spawnN('crab', 16, beach);
    // 洞里放几根干柴
    for (let i = 0; i < 3; i++) this.add('stick', new THREE.Vector3(CAVE.x - 3 + i * 0.8, CAVE.floorY, CAVE.faceZ - 7 - i * 0.5));
    // 树下的椰子与树上的椰子
    for (const palm of vegetation.palms) {
      if (Math.random() < 0.45) { const a = Math.random() * 6.28, d = 1 + Math.random() * 2; this.add('coconut', new THREE.Vector3(palm.pos.x + Math.cos(a) * d, 0, palm.pos.z + Math.sin(a) * d)); }
      if (Math.random() < 0.7) {
        const n = 2 + Math.floor(Math.random() * 3); palm.coconuts = [];
        for (let k = 0; k < n; k++) {
          const a = (k / n) * 6.28 + Math.random(), off = new THREE.Vector3(Math.cos(a) * 0.28, -0.35 - Math.random() * 0.2, Math.sin(a) * 0.28);
          const it = this.add('coconut', palm.crown.clone().add(off), 'attached');
          it.palm = palm; it.anchor = palm.crown.clone().add(off); palm.coconuts.push(it);
        }
      }
    }
  }
  add(type, pos, state = 'rest') {
    const it = new Item(type, pos);
    it.state = state;
    if (state === 'rest') this.settle(it);
    this.scene.add(it.mesh); this.items.push(it);
    return it;
  }
  remove(it) { this.scene.remove(it.mesh); this.items.splice(this.items.indexOf(it), 1); }
  settle(it) {
    const h = this.terrain.getHeight(it.pos.x, it.pos.z);
    it.pos.y = h + (it.type === 'coconut' ? 0.12 : it.type === 'crab' ? 0 : it.type === 'stick' || it.type === 'bottle' ? 0.05 : 0.01);
    it.mesh.position.copy(it.pos);
    if (it.type !== 'crab') { it.mesh.rotation.x = 0; it.mesh.rotation.z = 0; }
    const n = this.terrain.getNormal(it.pos.x, it.pos.z);
    if (it.type !== 'crab') it.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28));
  }

  // 沿视线寻找最近可拾取物
  findTarget(ray, maxDist = 6) {
    let best = null, bestScore = Infinity;
    const tmp = new THREE.Vector3();
    for (const it of this.items) {
      if (it.state === 'held' || it.state === 'attached' || it.state === 'sunk' || (it.ai && it.ai.hidden > 0)) continue;
      tmp.subVectors(it.pos, ray.origin);
      const t = tmp.dot(ray.direction);
      if (t < 0.3 || t > maxDist) continue;
      const perp = tmp.addScaledVector(ray.direction, -t).length();
      const tol = it.def.r + 0.22 + t * 0.045;
      if (perp > tol) continue;
      const score = perp / tol + t * 0.08;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
  nearestPalm(p, maxD) {
    let best = null, bd = maxD;
    for (const palm of this.veg.palms) { const d = Math.hypot(palm.pos.x - p.x, palm.pos.z - p.z); if (d < bd) { bd = d; best = palm; } }
    return best;
  }
  shakePalm(palm, game, strength = 1) {
    if (!palm.coconuts || !palm.coconuts.length) return false;
    const n = strength > 1 ? palm.coconuts.length : 1;
    for (let i = 0; i < n && palm.coconuts.length; i++) {
      const c = palm.coconuts.pop();
      c.state = 'fly'; c.vel.set((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5); c.spin.set(Math.random() * 4, 0, Math.random() * 4);
    }
    game.audio.sfx('rustle', 0.8);
    game.events.emit('coconutDrop');
    return true;
  }
  throwItem(it, origin, vel) {
    it.state = 'fly'; it.pos.copy(origin); it.vel.copy(vel); it.skips = 0; it.thrown = true;
    it.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
    if (it.def.skip) it.spin.set(0, 18, 0); // 打水漂的石头水平旋转
    it.mesh.visible = true;
  }

  update(dt, game) {
    const T = this.terrain, ocean = game.ocean, W = game.weather, tmpN = new THREE.Vector3(), sway = new THREE.Vector3();
    for (let idx = this.items.length - 1; idx >= 0; idx--) {
      const it = this.items[idx]; it.age += dt;
      const p = it.pos, v = it.vel, r = it.def.r;
      if (it.state === 'attached') {
        windOffset(it.palm.pos, it.anchor.y - it.palm.pos.y, 0.012, sway);
        it.mesh.position.copy(it.anchor).add(sway);
        it.pos.copy(it.mesh.position);
        continue;
      }
      if (it.state === 'held') continue;
      const ground = T.getHeight(p.x, p.z);
      const depth = -ground;
      if (it.state === 'fly') {
        v.y -= 9.8 * dt;
        if (it.def.floats || it.type === 'bottle') { v.x += W.windVec.x * dt * 0.08; v.z += W.windVec.y * dt * 0.08; }
        p.addScaledVector(v, dt);
        it.mesh.rotation.x += it.spin.x * dt; it.mesh.rotation.y += it.spin.y * dt; it.mesh.rotation.z += it.spin.z * dt;
        // 洞顶
        if (inCaveRoof(p.x, p.z) && p.y > caveCeiling(p.x, p.z) - r && p.y < 30) { p.y = caveCeiling(p.x, p.z) - r; v.y = -Math.abs(v.y) * 0.3; }
        // 树干与礁石
        for (const o of this.veg.obstacles) {
          const dx = p.x - o.x, dz = p.z - o.z, d2 = dx * dx + dz * dz, rr = o.r + r;
          if (d2 < rr * rr && p.y < T.getHeight(o.x, o.z) + o.h) {
            const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d, vn = v.x * nx + v.z * nz;
            if (vn < 0) {
              v.x -= 1.6 * vn * nx; v.z -= 1.6 * vn * nz; v.multiplyScalar(0.6);
              game.audio.sfx(o.palm ? 'thunk' : 'clack', clamp(-vn / 10, 0.2, 1));
              if (o.palm && it.thrown) { const palm = this.veg.palms.find((pp) => pp.ob === o); if (palm && this.shakePalm(palm, game, -vn > 8 ? 2 : 1)) game.events.emit('hitPalm'); }
            }
            p.x = o.x + nx * rr; p.z = o.z + nz * rr;
          }
        }
        const wy = depth > 0 ? ocean.heightAt(p.x, p.z, depth) : -99;
        if (depth > 0.05 && p.y - r * 0.5 < wy) {
          const hs = Math.hypot(v.x, v.z);
          if (it.def.skip && hs > 6 && -v.y < hs * 0.42 && it.skips < 12 && depth > 0.4) {
            it.skips++; v.y = Math.abs(v.y) * 0.55 + 0.6 + hs * 0.04; v.x *= 0.84; v.z *= 0.84; p.y = wy + r;
            game.effects.splash(p, 0.25); game.audio.sfx('plip', 0.6, p); game.events.emit('skip', it.skips);
          } else {
            game.effects.splash(p, clamp(Math.hypot(hs, v.y) / 10, 0.3, 1.6));
            game.audio.sfx('splash', clamp(Math.hypot(hs, v.y) / 14, 0.2, 1), p);
            if (it.skips > 0) game.events.emit('skipDone', it.skips);
            if (it.type === 'crab') { it.state = 'rest'; it.ai.mode = 'swim'; v.set(0, 0, 0); }
            else if (it.def.floats) { it.state = 'float'; v.multiplyScalar(0.15); v.y = 0; }
            else { it.state = 'sink'; v.multiplyScalar(0.08); }
            it.thrown = false;
          }
        } else if (p.y - r < ground) {
          T.getNormal(p.x, p.z, tmpN);
          const vn = v.dot(tmpN), speed = v.length();
          if (vn < 0) v.addScaledVector(tmpN, -(1 + it.def.rest) * vn);
          v.multiplyScalar(0.62); p.y = ground + r;
          if (speed > 2.5) {
            const surf = T.surface(p.x, p.z);
            game.audio.sfx(surf === 'sand' ? 'thudSoft' : 'thud', clamp(speed / 14, 0.15, 1), p);
            if (surf === 'sand') game.effects.sandPuff(p, clamp(speed / 10, 0.3, 1.2));
            if (it.skips > 0) { game.events.emit('skipDone', it.skips); it.skips = 0; }
          }
          if (speed < 1.2) {
            it.state = 'rest'; it.thrown = false; this.settle(it);
            if (it.type === 'crab') { it.ai.mode = 'flee'; it.ai.t = 2; game.events.emit('crabLand'); }
            game.events.emit('landed', it);
          }
        }
        it.mesh.position.copy(p);
        if (p.y < -40 || Math.hypot(p.x, p.z) > 600) this.remove(it);
      } else if (it.state === 'float') {
        const wy = ocean.heightAt(p.x, p.z, depth);
        it.bob += dt;
        v.x = lerp(v.x, W.windVec.x * 0.05 + Math.cos(it.bob * 0.3) * 0.1, dt * 0.5);
        v.z = lerp(v.z, W.windVec.y * 0.05 + Math.sin(it.bob * 0.27) * 0.1, dt * 0.5);
        p.x += v.x * dt; p.z += v.z * dt; p.y = wy + 0.02;
        it.mesh.position.copy(p);
        it.mesh.rotation.x = Math.sin(it.bob * 1.3) * 0.25; it.mesh.rotation.z = Math.cos(it.bob * 1.1) * 0.25; it.mesh.rotation.y += dt * 0.1;
        if (depth < 0.05) { it.state = 'rest'; this.settle(it); }
        if (Math.hypot(p.x, p.z) > 330) { if (it.type === 'bottle') game.events.emit('bottleGone'); this.remove(it); }
      } else if (it.state === 'sink') {
        p.y -= dt * 0.9; p.x += v.x * dt; p.z += v.z * dt; v.multiplyScalar(0.95);
        it.mesh.rotation.x += dt * 0.5;
        if (p.y <= ground + r * 0.3) { it.state = 'rest'; this.settle(it); }
        it.mesh.position.copy(p);
      } else if (it.state === 'rest' && it.ai) {
        this.crabAI(it, dt, game);
      }
      // 远离的东西（沉在深海）回收
      if (it.state === 'rest' && ground < -6 && it.type !== 'crab') this.remove(it);
    }

    // 潮水冲上来新的贝壳
    this.respawnT -= dt;
    if (this.respawnT < 0) {
      this.respawnT = 25;
      const count = (t) => this.items.filter((i) => i.type === t).length;
      const pp = game.player.pos;
      const spot = () => T.randomSpot((x, z, h) => h > 0.15 && h < 1.2 && Math.hypot(x - pp.x, z - pp.z) > 25);
      if (count('shell') < 30) { const s = spot(); if (s) this.add('shell', s); }
      if (count('stone') < 18) { const s = spot(); if (s) this.add('stone', s); }
      if (count('starfish') < 8) { const s = spot(); if (s) this.add('starfish', s); }
      if (count('conch') < 5) { const s = spot(); if (s) this.add('conch', s); }
      if (count('bottle') < 1 && Math.random() < 0.4) { const s = spot(); if (s) { this.add('bottle', s); } }
      if (count('crab') < 14) { const s = T.randomSpot((x, z, h) => h > 0.3 && h < 2.4 && Math.hypot(x - pp.x, z - pp.z) > 20); if (s) this.add('crab', s); }
    }
  }

  crabAI(it, dt, game) {
    const ai = it.ai, T = this.terrain, p = it.pos, pl = game.player;
    const ud = it.mesh.userData;
    if (ai.hidden > 0) { // 钻进沙里
      ai.hidden -= dt; it.mesh.visible = ai.hidden < 0.01;
      if (ai.hidden <= 0) { it.mesh.visible = true; ai.mode = 'idle'; game.effects.sandPuff(p, 0.5); }
      return;
    }
    const dPl = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
    const scary = pl.sitting ? 1.2 : pl.speed > 5 ? 7 : 4.5;
    if (dPl < scary && ai.mode !== 'flee' && ai.mode !== 'swim') { ai.mode = 'flee'; ai.t = 2.5 + Math.random(); game.audio.sfx('crab', 0.4, p); }
    if (game.weather.rain > 0.5 && ai.mode !== 'swim' && Math.random() < dt * 0.05) { ai.hidden = 25 + Math.random() * 20; game.effects.sandPuff(p, 0.6); return; }
    let dir = null;
    ai.t -= dt;
    if (ai.mode === 'idle') {
      ai.speed = 0;
      if (ai.t < 0) {
        // 坐着不动时，螃蟹会好奇地靠近
        if (pl.sitting && dPl < 14 && Math.random() < 0.6) ai.target.set(pl.pos.x + (Math.random() - 0.5) * 2, 0, pl.pos.z + (Math.random() - 0.5) * 2);
        else { const a = Math.random() * 6.28, d = 1 + Math.random() * 5; ai.target.set(p.x + Math.cos(a) * d, 0, p.z + Math.sin(a) * d); }
        const th = T.getHeight(ai.target.x, ai.target.z);
        if (th > -0.3 && th < 3) { ai.mode = 'walk'; ai.t = 6; } else ai.t = 0.5;
      }
    } else if (ai.mode === 'walk') {
      dir = new THREE.Vector3(ai.target.x - p.x, 0, ai.target.z - p.z);
      ai.speed = 0.55;
      if (dir.length() < (pl.sitting ? 1.0 : 0.2) || ai.t < 0) { ai.mode = 'idle'; ai.t = 1 + Math.random() * 4; dir = null; }
    } else if (ai.mode === 'flee') {
      dir = new THREE.Vector3(p.x - pl.pos.x, 0, p.z - pl.pos.z);
      ai.speed = 2.4;
      if (ai.t < 0) { ai.mode = 'idle'; ai.t = 2; if (Math.random() < 0.35) { ai.hidden = 12 + Math.random() * 15; game.effects.sandPuff(p, 0.5); } }
    } else if (ai.mode === 'swim') {
      // 水下慢慢走回岸边
      const ang = Math.atan2(p.z, p.x);
      dir = new THREE.Vector3(-Math.cos(ang), 0, -Math.sin(ang));
      ai.speed = 0.7;
      if (T.getHeight(p.x, p.z) > 0.3) { ai.mode = 'idle'; ai.t = 1; }
    }
    if (dir && dir.lengthSq() > 1e-4) {
      dir.normalize();
      const nx = p.x + dir.x * ai.speed * dt, nz = p.z + dir.z * ai.speed * dt, nh = T.getHeight(nx, nz);
      if ((nh < 3.2 && T.slope(nx, nz) < 0.4) || ai.mode === 'swim') { p.x = nx; p.z = nz; } else { ai.mode = 'idle'; ai.t = 0.3; }
      // 横着走：身体侧面朝向移动方向
      const yaw = Math.atan2(dir.x, dir.z) + Math.PI / 2;
      let dy = yaw - it.mesh.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      it.mesh.rotation.y += dy * Math.min(1, dt * 6);
    }
    p.y = T.getHeight(p.x, p.z);
    it.mesh.position.copy(p);
    // 腿部动画
    ai.phase += dt * (ai.speed > 0 ? 10 + ai.speed * 8 : 0);
    for (const L of ud.legs) L.pivot.rotation.x = Math.sin(ai.phase + L.i * 2 + (L.s > 0 ? 1 : 0)) * 0.5 * (ai.speed > 0 ? 1 : 0);
    for (const C of ud.claws) C.jaw.rotation.y = Math.sin(it.age * 3 + C.s) * 0.3;
  }
  // 手上的螃蟹乱动
  animateHeld(it, t) {
    if (it.type !== 'crab') return;
    for (const L of it.mesh.userData.legs) L.pivot.rotation.x = Math.sin(t * 22 + L.i * 2) * 0.7;
    for (const C of it.mesh.userData.claws) { C.arm.rotation.x = Math.sin(t * 8 + C.s) * 0.5; C.jaw.rotation.y = Math.sin(t * 15) * 0.5; }
  }
}
