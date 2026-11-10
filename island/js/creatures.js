// 生物：海鸥、跃出水面的鱼与海豚、蝴蝶、萤火虫
import * as THREE from 'three';
import { clamp, lerp } from './noise.js';

function buildGull() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), white); body.scale.set(0.85, 0.8, 2.2); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), white); head.position.set(0, 0.06, 0.25); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 6), new THREE.MeshStandardMaterial({ color: 0xf2b630 })); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.05, 0.34); g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), grey); tail.rotation.x = -Math.PI / 2; tail.scale.set(1, 1, 0.3); tail.position.set(0, 0.01, -0.3); g.add(tail);
  const wingGeo = (tip) => {
    const s = new THREE.Shape(); s.moveTo(0, 0.1); s.lineTo(0.55, 0.06); s.lineTo(0.55, -0.12); s.lineTo(0, -0.14);
    const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
    return geo;
  };
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x222428, side: THREE.DoubleSide });
  const wings = [];
  for (const sd of [-1, 1]) {
    const inner = new THREE.Group(); inner.position.set(sd * 0.06, 0.03, 0.02); inner.scale.x = sd;
    const im = new THREE.Mesh(wingGeo(), grey); inner.add(im);
    const outer = new THREE.Group(); outer.position.x = 0.55; inner.add(outer);
    const om = new THREE.Mesh(wingGeo(), grey); om.scale.set(0.8, 1, 0.8); outer.add(om);
    const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.14), tipMat); tip.rotation.x = -Math.PI / 2; tip.position.set(0.5, 0, -0.02); outer.add(tip);
    g.add(inner); wings.push({ inner, outer, sd });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.wings = wings;
  return g;
}

export class Birds {
  constructor(scene, terrain, perches) {
    this.scene = scene; this.terrain = terrain; this.list = [];
    this.perches = perches && perches.length ? perches : [new THREE.Vector3(120, 1, 0)];
    for (let i = 0; i < 16; i++) {
      const m = buildGull(); m.scale.setScalar(1.6); scene.add(m);
      const b = {
        m, pos: new THREE.Vector3((Math.random() - 0.5) * 300, 25 + Math.random() * 25, (Math.random() - 0.5) * 300),
        vel: new THREE.Vector3(), mode: 'soar', t: 10 + Math.random() * 30, flap: Math.random() * 10, flapAmt: 0,
        center: new THREE.Vector3((Math.random() - 0.5) * 180, 0, (Math.random() - 0.5) * 180), radius: 30 + Math.random() * 60,
        ang: Math.random() * 6.28, alt: 18 + Math.random() * 30, dir: Math.random() < 0.5 ? 1 : -1, speedK: 0.8 + Math.random() * 0.4,
        callT: 3 + Math.random() * 15, perch: null,
      };
      this.list.push(b);
    }
    this.callT = 0;
  }
  scatter(p, radius = 15) {
    for (const b of this.list) if (b.pos.distanceTo(p) < radius) { b.mode = 'flee'; b.t = 4; b.vel.subVectors(b.pos, p).setY(4).normalize().multiplyScalar(12); }
  }
  call(player) { this.callT = 25; this.callCenter = player; }
  update(dt, game) {
    const W = game.weather, sky = game.sky, pl = game.player;
    const storm = W.dark > 0.6, night = sky.state.night > 0.7;
    this.callT -= dt;
    for (const b of this.list) {
      b.t -= dt;
      const target = new THREE.Vector3();
      if (b.mode === 'perch') {
        b.flapAmt = lerp(b.flapAmt, 0, dt * 5);
        if (pl.pos.distanceTo(b.pos) < (pl.speed > 5 ? 14 : 8) || b.t < 0 || storm) {
          b.mode = 'soar'; b.vel.set(0, 6, 0); game.audio.sfx('flap', 0.5, b.pos); b.t = 20 + Math.random() * 40;
        }
        b.m.position.copy(b.pos); b.m.rotation.x = 0;
        b.m.rotation.y += Math.sin(game.time * 0.5 + b.ang) * dt * 0.5;
        this.pose(b, dt);
        continue;
      }
      if (b.mode === 'flee') {
        target.copy(b.pos).add(b.vel);
        if (b.t < 0) b.mode = 'soar';
      } else if (storm || night) {
        // 风暴/夜晚：飞向远方或回崖顶
        const a = Math.atan2(b.pos.z, b.pos.x);
        target.set(Math.cos(a) * 500, 60, Math.sin(a) * 500);
      } else if (this.callT > 0) {
        b.ang += dt * 0.6 * b.dir * b.speedK;
        const cp = pl.pos;
        target.set(cp.x + Math.cos(b.ang) * (6 + (b.radius % 6)), cp.y + 7 + (b.alt % 5), cp.z + Math.sin(b.ang) * (6 + (b.radius % 6)));
      } else if (b.mode === 'land') {
        target.copy(b.perch).add(new THREE.Vector3(0, 0.25, 0));
        if (b.pos.distanceTo(target) < 0.8) { b.mode = 'perch'; b.pos.copy(target); b.t = 15 + Math.random() * 30; b.vel.set(0, 0, 0); continue; }
      } else {
        b.ang += dt * (6 / b.radius) * b.dir * b.speedK * (1 + W.wind * 0.3);
        target.set(b.center.x + Math.cos(b.ang) * b.radius, b.alt + Math.sin(game.time * 0.2 + b.radius) * 4, b.center.z + Math.sin(b.ang) * b.radius);
        if (b.t < 0) {
          if (Math.random() < 0.4) { b.mode = 'land'; b.perch = this.perches[Math.floor(Math.random() * this.perches.length)]; }
          else { b.center.set((Math.random() - 0.5) * 200, 0, (Math.random() - 0.5) * 200); b.radius = 30 + Math.random() * 60; }
          b.t = 20 + Math.random() * 30;
        }
      }
      const desired = target.sub(b.pos);
      const dist = desired.length();
      const spd = b.mode === 'land' ? clamp(dist * 0.8, 2, 9) : b.mode === 'flee' ? 14 : 9 * b.speedK;
      desired.normalize().multiplyScalar(spd);
      // 风会把鸟吹偏
      desired.x += W.windVec.x * 0.12; desired.z += W.windVec.y * 0.12;
      b.vel.lerp(desired, Math.min(1, dt * 1.5));
      b.pos.addScaledVector(b.vel, dt);
      const gh = this.terrain.getHeight(b.pos.x, b.pos.z);
      if (b.mode !== 'land' && b.pos.y < Math.max(gh, 0) + 4) b.pos.y = lerp(b.pos.y, Math.max(gh, 0) + 4, dt * 3);
      b.m.position.copy(b.pos);
      const yaw = Math.atan2(b.vel.x, b.vel.z);
      b.m.rotation.order = 'YXZ'; b.m.rotation.y = yaw;
      b.m.rotation.x = -clamp(b.vel.y / 12, -0.5, 0.5);
      // 转弯侧倾
      const turn = b.dir * (b.mode === 'soar' ? 0.35 : 0.1);
      b.m.rotation.z = lerp(b.m.rotation.z, turn, dt * 2);
      const climbing = b.vel.y > 0.6 || b.mode === 'flee' || b.mode === 'land' || W.wind > 0.8;
      b.flapAmt = lerp(b.flapAmt, climbing ? 1 : 0.12 + 0.12 * Math.sin(game.time * 0.3 + b.radius), dt * 3);
      this.pose(b, dt);
      // 叫声
      b.callT -= dt;
      if (b.callT < 0) { b.callT = 6 + Math.random() * 18; const d = b.pos.distanceTo(pl.pos); if (d < 90 && !night) game.audio.gull(clamp(1 - d / 90, 0, 1), b.pos); }
    }
  }
  pose(b, dt) {
    b.flap += dt * (6 + b.flapAmt * 6);
    const s = Math.sin(b.flap) * b.flapAmt;
    const fold = b.mode === 'perch' ? 1 : 0;
    for (const w of b.m.userData.wings) {
      w.inner.rotation.z = w.sd * (fold ? -0.1 : s * 0.7 + 0.1);
      w.inner.rotation.y = w.sd * (fold ? 1.4 : 0);
      w.outer.rotation.z = fold ? 0 : s * 0.5 - 0.05;
      w.outer.rotation.y = fold ? 1.2 : 0;
    }
  }
}

// 跃出水面的鱼 / 远处的海豚
export class SeaLife {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain; this.active = []; this.t = 4;
    const fishMat = new THREE.MeshStandardMaterial({ color: 0xc8d6e0, metalness: 0.6, roughness: 0.3 });
    const dolMat = new THREE.MeshStandardMaterial({ color: 0x6d7f8f, roughness: 0.4 });
    this.makeFish = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), fishMat); m.scale.set(0.4, 0.7, 2); return m; };
    this.makeDolphin = () => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), dolMat); b.scale.set(0.8, 0.8, 3.2); g.add(b);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 4), dolMat); fin.position.set(0, 0.42, -0.1); fin.rotation.x = -0.4; fin.scale.z = 0.3; g.add(fin);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.25), dolMat); tail.position.z = -1.3; g.add(tail);
      return g;
    };
  }
  spawnJump(game, kind) {
    const pl = game.player.pos;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * 6.28, d = kind === 'dolphin' ? 80 + Math.random() * 160 : 20 + Math.random() * 70;
      const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
      if (this.terrain.getHeight(x, z) > (kind === 'dolphin' ? -8 : -2)) continue;
      const n = kind === 'dolphin' ? 2 + Math.floor(Math.random() * 3) : 1;
      const dir = Math.random() * 6.28;
      for (let i = 0; i < n; i++) {
        const m = kind === 'dolphin' ? this.makeDolphin() : this.makeFish();
        this.scene.add(m);
        this.active.push({ m, kind, x: x + i * 2.5 * Math.cos(dir + 1.5), z: z + i * 2.5 * Math.sin(dir + 1.5), dir, t: -i * 0.35, dur: kind === 'dolphin' ? 1.6 : 0.8, h: kind === 'dolphin' ? 2.2 : 0.9, len: kind === 'dolphin' ? 7 : 2.2, splashed: 0 });
      }
      return;
    }
  }
  update(dt, game) {
    this.t -= dt;
    if (this.t < 0) {
      this.t = 5 + Math.random() * 10;
      const k = Math.random() < 0.25 && game.sky.state.day > 0.5 && game.weather.dark < 0.5 ? 'dolphin' : 'fish';
      this.spawnJump(game, k);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]; f.t += dt;
      if (f.t < 0) { f.m.visible = false; continue; }
      f.m.visible = true;
      const k = f.t / f.dur;
      const along = (k - 0.5) * f.len;
      const x = f.x + Math.cos(f.dir) * along, z = f.z + Math.sin(f.dir) * along, y = Math.sin(k * Math.PI) * f.h - 0.3;
      f.m.position.set(x, y, z);
      f.m.rotation.order = 'YXZ'; f.m.rotation.y = Math.atan2(Math.cos(f.dir), Math.sin(f.dir));
      f.m.rotation.x = -Math.cos(k * Math.PI) * 0.9;
      if (f.splashed === 0 && k > 0.02) { f.splashed = 1; game.effects.splash(f.m.position, f.kind === 'dolphin' ? 1.2 : 0.4); this.sound(game, f, 0.5); }
      if (f.splashed === 1 && k > 0.95) { f.splashed = 2; game.effects.splash(f.m.position, f.kind === 'dolphin' ? 1.4 : 0.5); this.sound(game, f, 0.7); }
      if (k > 1) { this.scene.remove(f.m); this.active.splice(i, 1); }
    }
  }
  sound(game, f, v) { const d = f.m.position.distanceTo(game.player.pos); if (d < 120) game.audio.sfx('splash', v * clamp(1 - d / 120, 0, 1) * (f.kind === 'dolphin' ? 1 : 0.5), f.m.position); }
}

// 蝴蝶
export class Butterflies {
  constructor(scene, spots) {
    this.list = [];
    const cols = [0xffa62b, 0x4fc3f7, 0xfff176, 0xff6fb5, 0xffffff];
    const geo = new THREE.PlaneGeometry(0.1, 0.08); geo.translate(0.05, 0, 0);
    for (let i = 0; i < 26 && spots.length; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide });
      const g = new THREE.Group(); const L = new THREE.Mesh(geo, mat), R = new THREE.Mesh(geo, mat); R.scale.x = -1;
      g.add(L, R); scene.add(g);
      const home = spots[Math.floor(Math.random() * spots.length)].clone();
      this.list.push({ g, L, R, home, pos: home.clone(), ph: Math.random() * 10, target: home.clone(), t: 0 });
    }
  }
  update(dt, game) {
    const vis = game.sky.state.day > 0.6 && game.weather.rain < 0.2;
    for (const b of this.list) {
      b.g.visible = vis; if (!vis) continue;
      b.t -= dt; b.ph += dt * 22;
      if (b.t < 0) { b.t = 1 + Math.random() * 2; b.target.copy(b.home).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 1.5, (Math.random() - 0.5) * 4)); }
      b.pos.lerp(b.target, dt * 0.8);
      b.pos.y += Math.sin(b.ph * 0.2) * dt * 0.3;
      b.g.position.copy(b.pos);
      b.g.rotation.y = Math.atan2(b.target.x - b.pos.x, b.target.z - b.pos.z) + Math.PI / 2;
      const f = Math.sin(b.ph) * 1.1; b.L.rotation.y = f; b.R.rotation.y = -f;
    }
  }
}

// 萤火虫
export class Fireflies {
  constructor(scene, terrain, around) {
    const N = 260; this.N = N;
    this.base = new Float32Array(N * 3); this.pos = new Float32Array(N * 3); this.ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let p = null;
      for (let k = 0; k < 30 && !p; k++) p = terrain.randomSpot((x, z, h) => h > 3.5 && h < 16 && terrain.surface(x, z) === 'grass', Math.random, 5, 200);
      if (!p) p = around.clone();
      this.base.set([p.x, p.y + 0.6 + Math.random() * 1.8, p.z], i * 3); this.ph[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aPh', new THREE.BufferAttribute(this.ph, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uVis: { value: 0 } },
      vertexShader: `attribute float aPh; uniform float uTime; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vA = pow(max(sin(uTime*1.7 + aPh),0.0), 3.0); gl_PointSize = 150.0/ -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uVis; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vec3(0.75,1.0,0.35)*a*vA*uVis*1.5, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; scene.add(this.points);
  }
  update(dt, game) {
    const vis = clamp(game.sky.state.night * 1.3 - game.weather.rain * 1.5, 0, 1);
    this.mat.uniforms.uVis.value = vis; this.mat.uniforms.uTime.value = game.time;
    this.points.visible = vis > 0.01;
    if (!this.points.visible) return;
    const t = game.time;
    for (let i = 0; i < this.N; i++) {
      const k = i * 3, ph = this.ph[i];
      this.pos[k] = this.base[k] + Math.sin(t * 0.3 + ph) * 1.5;
      this.pos[k + 1] = this.base[k + 1] + Math.sin(t * 0.5 + ph * 2) * 0.5;
      this.pos[k + 2] = this.base[k + 2] + Math.cos(t * 0.27 + ph) * 1.5;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
