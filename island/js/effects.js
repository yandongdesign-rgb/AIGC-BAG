// 粒子特效：水花、沙尘、火焰、水波纹、脚印
import * as THREE from 'three';

function spriteTex() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d'); const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.baseSize = new Float32Array(max); this.grow = new Float32Array(max);
    this.rgb = new Float32Array(max * 3); this.alpha0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: spriteTex() }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard;
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(p, v, life, size, color, alpha = 1, grav = 9.8, grow = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life; this.maxLife[i] = life; this.baseSize[i] = size; this.grav[i] = grav; this.grow[i] = grow;
    this.rgb.set([color.r, color.g, color.b], i * 3); this.alpha0[i] = alpha;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.swap(i, --this.n); i--; continue; }
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= 0.985; this.vel[k + 2] *= 0.985;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.size[i] = this.baseSize[i] * (1 + (1 - t) * this.grow[i]);
      this.col[i * 4] = this.rgb[k]; this.col[i * 4 + 1] = this.rgb[k + 1]; this.col[i * 4 + 2] = this.rgb[k + 2];
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.5);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
  }
  swap(a, b) {
    const arr3 = [this.pos, this.vel, this.rgb];
    for (const A of arr3) for (let c = 0; c < 3; c++) A[a * 3 + c] = A[b * 3 + c];
    for (const A of [this.life, this.maxLife, this.grav, this.baseSize, this.grow, this.alpha0]) A[a] = A[b];
  }
}

export class Effects {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain;
    this.soft = new ParticlePool(scene, 2500, false);
    this.glow = new ParticlePool(scene, 1200, true);
    // 水波纹
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    this.ripples = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 3; scene.add(m); this.ripples.push({ m, t: 0, life: 1, max: 1 });
    }
    // 脚印
    const fpTex = (() => {
      const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
      g.fillStyle = 'rgba(80,60,35,0.75)';
      g.beginPath(); g.ellipse(32, 38, 11, 19, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(22 + i * 5, 14 - Math.abs(i - 1.5) * 2, 3, 0, Math.PI * 2); g.fill(); }
      return new THREE.CanvasTexture(cv);
    })();
    const fpGeo = new THREE.PlaneGeometry(0.16, 0.26); fpGeo.rotateX(-Math.PI / 2);
    this.prints = []; this.printIdx = 0;
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(fpGeo, new THREE.MeshBasicMaterial({ map: fpTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false; scene.add(m); this.prints.push({ m, age: 0 });
    }
    this._v = new THREE.Vector3(); this._c = new THREE.Color();
  }
  splash(p, strength = 1) {
    const v = this._v, c = this._c.setRGB(0.85, 0.93, 1);
    const n = Math.floor(10 + strength * 25);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * strength * 1.6;
      v.set(Math.cos(a) * s, (2 + Math.random() * 3) * Math.min(1.6, 0.6 + strength), Math.sin(a) * s);
      this.soft.spawn(p, v, 0.6 + Math.random() * 0.5, 0.05 + Math.random() * 0.08 * strength, c, 0.9);
    }
    this.ripple(p, 1.5 + strength * 2, 1.6);
  }
  ripple(p, size = 2, life = 1.5) {
    const r = this.ripples.find((r) => !r.m.visible) || this.ripples[0];
    r.m.visible = true; r.t = 0; r.life = life; r.max = size; r.m.position.set(p.x, 0.06, p.z);
  }
  sandPuff(p, strength = 1) {
    const v = this._v, c = this._c.setRGB(0.85, 0.76, 0.58);
    for (let i = 0; i < 8 * strength + 4; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.2 * strength;
      v.set(Math.cos(a) * s, 0.5 + Math.random() * 1.5 * strength, Math.sin(a) * s);
      this.soft.spawn(p, v, 0.5 + Math.random() * 0.4, 0.08 + Math.random() * 0.1, c, 0.6, 4, 2);
    }
  }
  fire(p, power = 1) {
    const v = this._v, c = this._c;
    for (let i = 0; i < 3 * power; i++) {
      v.set((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 1.2 * power, (Math.random() - 0.5) * 0.3);
      c.setHSL(0.03 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.1);
      this._p = this._p || new THREE.Vector3();
      this._p.set(p.x + (Math.random() - 0.5) * 0.5, p.y + 0.15, p.z + (Math.random() - 0.5) * 0.5);
      this.glow.spawn(this._p, v, 0.45 + Math.random() * 0.45, 0.25 + Math.random() * 0.25 * power, c, 0.8, -0.5, -0.6);
    }
    if (Math.random() < 0.15 * power) { // 火星
      v.set((Math.random() - 0.5) * 1, 2 + Math.random() * 2, (Math.random() - 0.5) * 1);
      this.glow.spawn(p, v, 1.2, 0.04, c.setRGB(1, 0.7, 0.3), 1, 0.3);
    }
    if (Math.random() < 0.3) { // 烟
      v.set((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3);
      this._p.set(p.x, p.y + 1.2, p.z);
      this.soft.spawn(this._p, v, 2.5, 0.3, c.setRGB(0.4, 0.4, 0.42), 0.18, -0.1, 3);
    }
  }
  footprint(x, z, yaw, side) {
    const fp = this.prints[this.printIdx++ % this.prints.length];
    const ox = Math.cos(yaw) * 0.12 * side, oz = -Math.sin(yaw) * 0.12 * side;
    const px = x + ox, pz = z + oz;
    fp.m.position.set(px, this.terrain.getHeight(px, pz) + 0.02, pz);
    fp.m.rotation.set(0, yaw, 0); fp.m.scale.set(side, 1, 1);
    fp.m.visible = true; fp.age = 0; fp.m.material.opacity = 0.55;
  }
  update(dt, rain) {
    this.soft.update(dt); this.glow.update(dt);
    for (const r of this.ripples) if (r.m.visible) {
      r.t += dt; const k = r.t / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.2 + k * r.max); r.m.material.opacity = (1 - k) * 0.5;
    }
    for (const f of this.prints) if (f.m.visible) {
      f.age += dt * (1 + rain * 6 + (f.m.position.y < 1.0 ? 4 : 0));
      const o = 0.55 * (1 - f.age / 90);
      if (o <= 0) f.m.visible = false; else f.m.material.opacity = o;
    }
  }
}
