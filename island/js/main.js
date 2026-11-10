// 潮汐之岛 · 主程序：场景组装、玩家、输入（手势/键鼠/触屏）、交互、HUD、成就
import * as THREE from 'three';
import { Terrain, makeRockMaterial, CAVE, isSheltered, inCaveRoof, caveCeiling, caveMask } from './world.js';
import { SkySystem } from './sky.js';
import { Ocean } from './ocean.js';
import { Vegetation, windU, buildRockGeo } from './vegetation.js';
import { ItemSystem, TYPES, Item } from './items.js';
import { Birds, SeaLife, Butterflies, Fireflies } from './creatures.js';
import { Weather, PRESETS } from './weather.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { GestureInput, GESTURE_LABEL } from './gesture.js';
import { clamp, lerp, mulberry32 } from './noise.js';

const $ = (id) => document.getElementById(id);
const loadMsg = $('loadMsg');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- 事件 ----------
class Events { constructor() { this.h = {}; } on(n, f) { (this.h[n] ||= []).push(f); } emit(n, ...a) { (this.h[n] || []).forEach((f) => f(...a)); } }

// ---------- 渲染器 ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 6000);
camera.rotation.order = 'YXZ';
scene.add(camera);
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

const game = { events: new Events(), time: 0, scene, camera, renderer };
window.__game = game;
let ready = false;

// ---------- 玩家 ----------
class Player {
  constructor() {
    this.pos = new THREE.Vector3(18, 0, 62); this.yaw = 0.25; this.pitch = -0.05; this.vy = 0; this.onGround = true;
    this.speed = 0; this.sitting = false; this.swimming = false; this.eye = 1.65; this.bob = 0; this.stepAcc = 0; this.side = 1;
    this.wet = 0; this.vel = new THREE.Vector3(); this.inCave = false;
  }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  update(dt, inp) {
    const T = game.terrain;
    this.yaw += inp.turn * dt + inp.lookX; this.pitch = clamp(this.pitch + inp.pitchRate * dt + inp.lookY, -1.35, 1.35);
    const f = this.forward(_v1), r = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = _v3.set(0, 0, 0).addScaledVector(f, inp.z).addScaledVector(r, inp.x);
    const moving = dir.lengthSq() > 0.01;
    if (moving && this.sitting) this.stand();
    if (this.sitting) dir.set(0, 0, 0);
    const ground0 = T.getHeight(this.pos.x, this.pos.z);
    this.swimming = ground0 < -1.15;
    let spd = this.swimming ? 2.2 : inp.run ? 8.5 : 4.3;
    if (this.inCave) spd = Math.min(spd, 3.4);
    if (!this.swimming && ground0 < -0.3) spd *= 0.6; // 涉水
    if (T.surface(this.pos.x, this.pos.z) === 'sand' && !this.swimming) spd *= 0.92;
    if (dir.lengthSq() > 1) dir.normalize();
    const want = _v4.copy(dir).multiplyScalar(spd);
    const acc = this.onGround || this.swimming ? 10 : 2;
    this.vel.x = lerp(this.vel.x, want.x, Math.min(1, dt * acc)); this.vel.z = lerp(this.vel.z, want.z, Math.min(1, dt * acc));
    const step = Math.hypot(this.vel.x, this.vel.z) * dt;
    const tryMove = (nx, nz) => {
      if (Math.hypot(nx, nz) > 300) return false;
      const h1 = T.getHeight(nx, nz), h0 = T.getHeight(this.pos.x, this.pos.z), d = Math.hypot(nx - this.pos.x, nz - this.pos.z) || 1e-6;
      if (h1 > h0 + 0.05 && (h1 - h0) / d > 1.25 && h1 > 0) return false; // 太陡（崖壁）
      if (inCaveRoof(nx, nz) && caveCeiling(nx, nz) - h1 < 2.0) return false; // 洞内低矮处
      this.pos.x = nx; this.pos.z = nz; return true;
    };
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (!tryMove(nx, nz)) { if (!tryMove(nx, this.pos.z)) { if (!tryMove(this.pos.x, nz)) { this.vel.x *= 0.2; this.vel.z *= 0.2; } } }
    // 障碍物
    for (const o of game.veg.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z, rr = o.r + 0.3, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && (!o.rock || this.pos.y < o.top - 0.3)) { const d = Math.sqrt(d2) || 1; this.pos.x = o.x + dx / d * rr; this.pos.z = o.z + dz / d * rr; }
    }
    // 垂直
    const ground = T.getHeight(this.pos.x, this.pos.z);
    if (this.swimming) {
      const wy = game.ocean.heightAt(this.pos.x, this.pos.z, -ground);
      this.pos.y = lerp(this.pos.y, wy - 1.3, Math.min(1, dt * 4)); this.vy = 0; this.onGround = false;
      if (!this.wasSwim) { game.audio.sfx('splash', 0.6); game.effects.splash(this.pos.clone().setY(0), 0.8); game.events.emit('swim'); }
    } else {
      if (inp.jump && this.onGround) { this.vy = 5.4; this.onGround = false; game.audio.sfx('jump', 0.8); }
      this.vy -= 16 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        if (!this.onGround && this.vy < -4) { game.audio.step(this.surfaceHere(), 1.3); if (this.surfaceHere() === 'sand') game.effects.sandPuff(this.pos, 0.6); }
        this.pos.y = ground; this.vy = 0; this.onGround = true;
      } else if (this.pos.y > ground + 0.05 && this.vy === 0) this.onGround = false;
      if (this.onGround) this.pos.y = ground;
      if (inCaveRoof(this.pos.x, this.pos.z)) { const c = caveCeiling(this.pos.x, this.pos.z) - 0.25; if (this.pos.y + this.eye > c) { this.pos.y = Math.max(ground, c - this.eye); if (this.vy > 0) this.vy = 0; } }
    }
    this.wasSwim = this.swimming;
    this.speed = step / Math.max(dt, 1e-4);
    // 脚步
    if ((this.onGround || this.swimming) && step > 0.001) {
      this.stepAcc += step; this.bob += step * 2.3;
      if (this.stepAcc > (inp.run ? 1.0 : 0.72)) {
        this.stepAcc = 0; this.side *= -1;
        const s = this.swimming ? 'water' : ground < -0.1 ? 'water' : this.surfaceHere();
        if (!this.swimming || Math.random() < 0.6) game.audio.step(s, inp.run ? 1.1 : 0.8);
        if (s === 'sand') game.effects.footprint(this.pos.x, this.pos.z, this.yaw, this.side);
        if (s === 'water') game.effects.ripple(this.pos, 1.2, 1.2);
      }
    }
    const eyeT = this.sitting ? 0.85 : this.swimming ? 1.65 : 1.65;
    this.eye = lerp(this.eye, eyeT, Math.min(1, dt * 4));
    const bobY = this.onGround && !this.sitting ? Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.speed / 4) : this.swimming ? Math.sin(game.time * 2) * 0.05 : 0;
    camera.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.006 * Math.min(1, this.speed / 4) + game.shake * (Math.random() - 0.5) * 0.04);
    this.inCave = isSheltered(this.pos.x, this.pos.z);
  }
  surfaceHere() { return game.terrain.surface(this.pos.x, this.pos.z); }
  sit() { this.sitting = true; $('sitBadge').style.display = 'block'; toast('🧘 你坐了下来，看潮起潮落。螃蟹们也不那么怕你了。'); }
  stand() { this.sitting = false; $('sitBadge').style.display = 'none'; }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

// ---------- HUD 工具 ----------
function toast(msg, cls = '', ms = 3800) {
  const el = document.createElement('div'); el.className = 'toast glass ' + cls; el.textContent = msg;
  const box = $('toasts'); box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, ms);
}
const achieved = new Set();
let store = {};
try { store = JSON.parse(localStorage.getItem('tideIsland') || '{}'); } catch (e) { store = {}; }
(store.ach || []).forEach((a) => achieved.add(a));
function save() { try { localStorage.setItem('tideIsland', JSON.stringify({ ach: [...achieved], bag: game.bag })); } catch (e) { /* 忽略 */ } }
function achieve(id, text) {
  if (achieved.has(id)) return;
  achieved.add(id); toast('🏅 成就达成：' + text, 'ach', 5000); game.audio.chime(); save();
}

// ---------- 初始化世界 ----------
async function build() {
  loadMsg.textContent = '正在塑造地形与崖壁…'; await nextFrame();
  const terrain = game.terrain = new Terrain();
  scene.add(terrain.buildMesh());
  const rockMat = makeRockMaterial();
  scene.add(terrain.buildCaveRoof(rockMat));
  const heightTex = terrain.heightTexture();

  loadMsg.textContent = '正在铺开天空与大海…'; await nextFrame();
  game.sky = new SkySystem(scene);
  game.ocean = new Ocean(scene, heightTex);
  game.weather = new Weather(scene, heightTex);
  game.effects = new Effects(scene, terrain);
  game.audio = new AudioEngine();

  loadMsg.textContent = '正在种下椰子树与热带植物…'; await nextFrame();
  game.veg = new Vegetation(scene, terrain, rockMat);
  loadMsg.textContent = '正在放出螃蟹与海鸥…'; await nextFrame();
  game.items = new ItemSystem(scene, terrain, game.veg);
  game.birds = new Birds(scene, terrain, game.veg.rockPerches);
  game.sea = new SeaLife(scene, terrain);
  game.butterflies = new Butterflies(scene, game.veg.flowerSpots);
  game.fireflies = new Fireflies(scene, terrain, new THREE.Vector3(0, 6, 0));
  buildCave(rockMat);
  game.player = new Player();
  game.player.pos.y = terrain.getHeight(game.player.pos.x, game.player.pos.z);
  game.bag = store.bag || {};
  game.tod = 15.0; game.timeScale = 1; game.shake = 0;
  game.minimap = terrain.minimapImage(170);
  setupUI();
  loadMsg.textContent = '海岛已就绪 ✓ 选择一种方式开始';
  ['startGesture', 'startMouse'].forEach((id) => ($(id).disabled = false));
  ready = true;
}

// ---------- 山洞：篝火、水晶、钟乳石 ----------
function buildCave(rockMat) {
  const cf = CAVE.campfire.clone(); cf.y = game.terrain.getHeight(cf.x, cf.z);
  const g = new THREE.Group(); g.position.copy(cf);
  const rng = mulberry32(3);
  const stoneGeo = buildRockGeo(rng, 1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, m = new THREE.Mesh(stoneGeo, rockMat);
    m.position.set(Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55); m.scale.setScalar(0.15 + rng() * 0.06); m.castShadow = true; g.add(m);
  }
  const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 });
  const emberMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xff4400, emissiveIntensity: 0, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6), i % 2 ? logMat : emberMat);
    m.rotation.set(Math.PI / 2 - 0.5, (i / 4) * Math.PI * 2, 0); m.position.y = 0.18; m.castShadow = true; g.add(m);
  }
  scene.add(g);
  const light = new THREE.PointLight(0xff8a3a, 0, 22, 1.6); light.position.copy(cf).add(new THREE.Vector3(0, 0.8, 0)); scene.add(light);
  game.fire = { pos: cf, lit: false, boost: 0, light, emberMat };
  // 水晶
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x8fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
  const crystalMat2 = crystalMat.clone(); crystalMat2.color.set(0xd6a8ff); crystalMat2.emissive.set(0x9a4dff);
  const cbase = new THREE.Vector3(CAVE.x, CAVE.floorY, CAVE.faceZ - CAVE.depth + 4);
  for (let i = 0, n = 0; i < 200 && n < 16; i++) {
    const x = cbase.x + (rng() - 0.5) * 5, z = cbase.z + (rng() - 0.5) * 2.5;
    if (caveMask(x, z) < 0.95) continue; n++;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), i % 3 ? crystalMat : crystalMat2);
    m.position.set(x, game.terrain.getHeight(x, z) + 0.2, z); m.scale.set(0.5 + rng(), 1.5 + rng() * 2.5, 0.5 + rng());
    m.rotation.set((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6); scene.add(m);
  }
  const cl = new THREE.PointLight(0x66ccff, 3, 9, 1.6); cl.position.copy(cbase).add(new THREE.Vector3(0, 1.2, 0)); scene.add(cl);
  game.crystal = cbase;
  // 钟乳石
  const stMat = rockMat;
  for (let i = 0; i < 26; i++) {
    const x = CAVE.x + (rng() - 0.5) * CAVE.halfW * 1.6, z = CAVE.faceZ - CAVE.roofFront - 1 - rng() * (CAVE.depth - 4);
    const h = 0.3 + rng() * 1.1, m = new THREE.Mesh(new THREE.ConeGeometry(0.08 + rng() * 0.12, h, 6), stMat);
    m.rotation.x = Math.PI; m.position.set(x, caveCeiling(x, z) - h / 2 + 0.15, z); scene.add(m);
  }
}

// ---------- 交互动作 ----------
const raycaster = new THREE.Raycaster();
const reticle = { x: 0.5, y: 0.5 }; // 屏幕归一化
let hover = null, holding = null, charge = -1;

function reticleRay() {
  raycaster.setFromCamera(new THREE.Vector2(reticle.x * 2 - 1, -(reticle.y * 2 - 1)), camera);
  return raycaster.ray;
}
function holdPoint(out) {
  const ray = reticleRay();
  out.copy(ray.origin).addScaledVector(ray.direction, 0.75);
  out.y -= 0.12;
  return out;
}
function pickUp() {
  if (holding) return;
  const P = game.player;
  if (hover) {
    holding = hover; hover.setHighlight(false); hover.state = 'held'; hover.thrown = false;
    if (hover.ai) hover.ai.hidden = 0;
    game.audio.sfx(hover.type === 'crab' ? 'crab' : 'pick', 0.9);
    const msg = { shell: '捡到一枚扇贝壳。扁扁的，适合打水漂！', conch: '捡到一只海螺。🤟/E 吹响它，或者放到耳边听海。', starfish: '捡到一只海星。', stone: '一块扁平的鹅卵石——朝海面低角度用力扔出去试试打水漂。', coconut: '一颗椰子。🤟/E 可以喝椰子汁。', stick: '一根浮木。可以在沙滩上画画，或者给山洞里的篝火添柴。', bottle: '一个漂流瓶！里面好像有信。🤟/E 打开。', crab: '抓到一只小螃蟹！它的腿在乱蹬… 🤟/E 放生' }[holding.type];
    toast(TYPES[holding.type].icon + ' ' + msg);
    game.events.emit('pick', holding);
    hover = null;
    return;
  }
  const palm = game.items.nearestPalm(P.pos, 2.3);
  if (palm) { if (!game.items.shakePalm(palm, game, 1)) toast('🌴 你摇了摇椰子树，树上已经没有椰子了。'); else { game.shake = 0.6; achieve('shake', '摇落椰子'); } }
}
function throwHeld(power, aimDir) {
  if (!holding) return;
  const it = holding; holding = null;
  const origin = holdPoint(new THREE.Vector3());
  const dir = (aimDir || reticleRay().direction).clone();
  dir.y += 0.1 + power * 0.08; dir.normalize();
  const speed = lerp(5, 30, power);
  const vel = dir.multiplyScalar(speed).add(game.player.vel);
  game.items.throwItem(it, origin, vel);
  game.audio.sfx('throw', 0.4 + power * 0.6);
  if (power > 0.5) game.birds.scatter(origin.clone().addScaledVector(dir, 20), 25);
  game.events.emit('throw', it, power);
}
function dropHeld() {
  if (!holding) return;
  const it = holding; holding = null;
  const p = holdPoint(new THREE.Vector3());
  game.items.throwItem(it, p, game.player.forward(new THREE.Vector3()).multiplyScalar(0.8));
  it.thrown = false; game.audio.sfx('drop', 0.6);
}
function useAction() {
  const P = game.player, F = game.fire;
  const nearFire = P.pos.distanceTo(F.pos) < 3.2;
  if (holding) {
    const it = holding;
    switch (it.type) {
      case 'conch':
        game.audio.conch(); game.birds.call(P.pos); toast('🐌 呜——海螺的号角声在海湾回荡，海鸥被吸引过来了！'); achieve('conch', '吹响海螺号角'); return;
      case 'shell': game.audio.sfx('shell', 0.8); toast('🐚 你把贝壳贴在耳边，听见了遥远的海声。'); return;
      case 'bottle':
        if (it.note) { game.audio.sfx('cork', 0.8); showNote(it.note); it.note = null; achieve('bottle', '读到漂流瓶里的信'); }
        else toast('🍾 空瓶子。把它扔回大海，让它漂向远方吧。');
        return;
      case 'coconut':
        game.audio.sfx('drink', 0.8); toast('🥥 咕嘟咕嘟——清甜的椰子汁！'); game.items.remove(it); holding = null; achieve('coconut', '喝到新鲜椰子汁'); return;
      case 'stick':
        if (nearFire) { feedFire(it); return; }
        if (P.surfaceHere() === 'sand') { drawHeart(); toast('🪵 你用浮木在沙滩上画了一颗心 ❤'); achieve('heart', '沙滩上的爱心'); return; }
        toast('🪵 在沙滩上可以用它画画；靠近山洞里的篝火可以添柴。'); return;
      case 'crab':
        holding = null; it.state = 'fly'; it.pos.copy(holdPoint(new THREE.Vector3())); it.vel.set(0, 0.5, 0); toast('🦀 你把小螃蟹放生了，它横着跑远了。'); achieve('release', '放生小螃蟹'); return;
      default:
        toast(TYPES[it.type].icon + ' 试试把它扔出去，或者 👎/Q 收进背包。'); return;
    }
  }
  if (nearFire && !F.lit) {
    const has = (game.bag.stick || 0) > 0;
    if (has) { game.bag.stick--; renderBag(); lightFire(); }
    else toast('🔥 需要一根干柴/浮木才能生火（洞里就有几根，捡起来再靠近火堆）。');
    return;
  }
  const palm = game.items.nearestPalm(P.pos, 2.3);
  if (palm) { if (game.items.shakePalm(palm, game, 1)) { game.shake = 0.6; achieve('shake', '摇落椰子'); } return; }
  game.birds.call(P.pos); game.audio.kalimbaSfx(game.audio.ctx.currentTime, 1568, 0.06); game.audio.kalimbaSfx(game.audio.ctx.currentTime + 0.15, 2093, 0.06);
  toast('🎵 你吹了声口哨，附近的海鸥围着你盘旋起来。');
}
function feedFire(it) {
  if (it) { game.items.remove(it); if (holding === it) holding = null; }
  if (!game.fire.lit) lightFire(); else { game.fire.boost = 1; game.audio.sfx('ignite', 0.5); toast('🔥 添了一根柴，火更旺了。'); }
}
function lightFire() {
  game.fire.lit = true; game.fire.boost = 1; game.audio.sfx('ignite', 0.9);
  toast('🔥 篝火噼啪作响，山洞里暖和起来了。'); achieve('fire', '点燃山洞篝火');
}
function drawHeart() {
  const P = game.player, f = P.forward(new THREE.Vector3());
  const cx = P.pos.x + f.x * 2, cz = P.pos.z + f.z * 2;
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3) / 16 * 0.7, hz = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 * 0.7;
    const x = cx + hx * Math.cos(P.yaw) + hz * Math.sin(P.yaw), z = cz - hx * Math.sin(P.yaw) + hz * Math.cos(P.yaw);
    game.effects.footprint(x, z, t, 1);
  }
}
function storeHeld() {
  if (!holding) { if (game.player.sitting) game.player.stand(); else game.player.sit(); return; }
  if (holding.type === 'crab') { toast('🦀 螃蟹不想进背包… 🤟/E 放生它吧。'); return; }
  const t = holding.type; game.bag[t] = (game.bag[t] || 0) + 1;
  game.items.remove(holding); holding = null; game.audio.sfx('store', 0.8); renderBag(); save();
  toast(`🎒 ${TYPES[t].icon} ${TYPES[t].name} 已收进背包（${game.bag[t]}）`);
  if (game.bag.shell >= 10) achieve('shell10', '贝壳收藏家（10 枚贝壳）');
  const kinds = ['shell', 'conch', 'starfish', 'stone', 'coconut', 'stick', 'bottle'].filter((k) => game.bag[k] > 0).length;
  if (kinds >= 6) achieve('collector', '海岛博物学家（6 种收藏）');
}
function takeOut(type) {
  if (holding || !(game.bag[type] > 0)) { if (holding) toast('手里已经拿着东西了'); return; }
  game.bag[type]--; renderBag(); save();
  const it = game.items.add(type, holdPoint(new THREE.Vector3()), 'held');
  holding = it; game.audio.sfx('pick', 0.7);
}
let photoPending = false;
function takePhoto() { photoPending = true; }
function finishPhoto() {
  photoPending = false;
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  const img = document.createElement('img'); img.src = url; img.title = '点击下载';
  img.onclick = () => { const a = document.createElement('a'); a.href = url; a.download = `潮汐之岛-${Date.now()}.jpg`; a.click(); };
  const box = $('photos'); box.appendChild(img); while (box.children.length > 4) box.firstChild.remove();
  const fl = $('flash'); fl.style.transition = 'none'; fl.style.opacity = 0.85; requestAnimationFrame(() => { fl.style.transition = 'opacity .6s'; fl.style.opacity = 0; });
  game.audio.sfx('shutter', 0.9);
  toast('📷 咔嚓！照片已保存在左下角（点击可下载）');
  achieve('photo', '海岛摄影师');
  const e = game.sky.state.elev; if (e > -0.05 && e < 0.12) achieve('sunsetPhoto', '捕捉晨昏的光');
  if (game.weather.rainbow > 0.4) achieve('rainbowPhoto', '拍下彩虹');
}
function jump() { game.input.jumpQueued = true; }
function showNote(text) {
  const n = $('note'); n.innerHTML = text + '<small>（点击任意处或移动即可收起）</small>'; n.style.display = 'block';
  clearTimeout(showNote.t); showNote.t = setTimeout(() => (n.style.display = 'none'), 12000);
}
$('note').addEventListener('click', () => ($('note').style.display = 'none'));

// ---------- 事件 → 成就/提示 ----------
function setupEvents() {
  const E = game.events;
  E.on('pick', (it) => { achieve('pick', '第一次拾取'); if (it.type === 'crab') achieve('crab', '徒手抓螃蟹'); });
  E.on('skip', (n) => { if (n >= 3) achieve('skip3', '打水漂 ×3'); if (n >= 6) achieve('skip6', '水漂大师 ×6'); });
  E.on('skipDone', (n) => toast(`🪨 打水漂：跳了 ${n} 下！${n >= 5 ? '太厉害了！' : ''}`));
  E.on('coconutDrop', () => game.audio.sfx('thunk', 0.4));
  E.on('hitPalm', () => { toast('🎯 击中椰子树！椰子掉下来了。'); achieve('hitPalm', '神射手：砸落椰子'); });
  E.on('swim', () => achieve('swim', '下海游泳'));
  E.on('bottleGone', () => toast('🍾 漂流瓶随着洋流漂向了远方……'));
  E.on('rainbowStart', () => setTimeout(() => game.weather.rainbow > 0.3 && toast('🌈 雨停了——背对太阳看看，天边出现了彩虹！'), 8000));
  E.on('weather', (k) => {
    const m = { storm: '⛈ 暴风雨要来了！快去北边崖壁下的山洞避一避。', rain: '🌧 下雨了。', fog: '🌫 海雾弥漫开来……', clear: '☀️ 天放晴了。', overcast: '☁️ 乌云压了过来，风越来越大。', cloudy: '⛅ 云朵慢慢飘来。' };
    toast(m[k]);
  });
  E.on('throw', (it, p) => { if (p > 0.85) achieve('strong', '大力投手'); });
}

// ---------- 输入：键鼠 ----------
const keys = {};
game.input = { jumpQueued: false };
let mode = 'mouse', locked = false, mouseDX = 0, mouseDY = 0;
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (!started) return;
    keys[e.code] = true;
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyE': useAction(); break;
      case 'KeyQ': storeHeld(); break;
      case 'KeyC': game.player.sitting ? game.player.stand() : game.player.sit(); break;
      case 'Space': jump(); e.preventDefault(); break;
      case 'KeyP': takePhoto(); break;
      case 'KeyF': if (holding) throwHeld(0.7); else pickUp(); break;
      case 'KeyG': dropHeld(); break;
      case 'KeyM': toast(game.audio.toggleMusic() ? '🎵 音乐开' : '🔇 音乐关'); break;
      case 'KeyT': cycleSpeed(); break;
      case 'KeyH': toggleHelp(); break;
      case 'KeyN': $('minimap').style.display = $('minimap').style.display === 'none' ? '' : 'none'; break;
      case 'Tab': togglePanel(); e.preventDefault(); break;
      case 'Digit0': setWeather('auto'); break;
      default: {
        const wk = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog'];
        const m = e.code.match(/^Digit([1-6])$/); if (m) setWeather(wk[+m[1] - 1]);
      }
    }
  });
  window.addEventListener('keyup', (e) => (keys[e.code] = false));
  canvas.addEventListener('mousedown', (e) => {
    if (!started) return;
    if (!locked && mode === 'mouse' && !isTouch) { canvas.requestPointerLock?.(); }
    if (e.button === 0) { if (holding) { charge = 0; } else pickUp(); }
    if (e.button === 2) dropHeld();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0 && charge >= 0) { throwHeld(clamp(charge / 1.1, 0.1, 1)); charge = -1; } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => (locked = document.pointerLockElement === canvas));
  window.addEventListener('mousemove', (e) => { if (locked) { mouseDX += e.movementX; mouseDY += e.movementY; } });
}

// ---------- 输入：触屏 ----------
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const touch = { jx: 0, jy: 0, jid: null, lid: null, lx: 0, ly: 0, grabT: -1 };
function setupTouch() {
  if (!isTouch) return;
  $('touch').style.display = 'block';
  const joy = $('joy'), knob = joy.querySelector('i');
  const jr = () => joy.getBoundingClientRect();
  joy.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touch.jid = t.identifier; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.jid) {
        const r = jr(), dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const m = Math.min(1, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
        touch.jx = Math.cos(a) * m; touch.jy = Math.sin(a) * m;
        knob.style.transform = `translate(${touch.jx * 36}px, ${touch.jy * 36}px)`;
      } else if (t.identifier === touch.lid) {
        mouseDX += (t.clientX - touch.lx) * 1.6; mouseDY += (t.clientY - touch.ly) * 1.6; touch.lx = t.clientX; touch.ly = t.clientY;
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.jid) { touch.jid = null; touch.jx = touch.jy = 0; knob.style.transform = ''; }
      if (t.identifier === touch.lid) touch.lid = null;
    }
  });
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (touch.lid === null) { touch.lid = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
  }, { passive: true });
  document.querySelectorAll('#touch .tb').forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (act === 'grab') { if (holding) charge = 0; else pickUp(); }
      if (act === 'use') useAction(); if (act === 'jump') jump(); if (act === 'store') storeHeld(); if (act === 'photo') takePhoto();
    }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); if (act === 'grab' && charge >= 0) { throwHeld(clamp(charge / 1.1, 0.1, 1)); charge = -1; } });
  });
}

// ---------- 输入：手势 ----------
let gesture = null, gestureCooldown = 0, suppressWalk = 0, gripType = null;
function gestureIntent(now, inp) {
  const G = gesture; if (!G || !G.ready) return;
  G.update(now);
  const g = G.stable, sm = G.smooth;
  $('gestureLbl').textContent = G.primary ? (GESTURE_LABEL[g] || g) : '✋ 请把手举到摄像头前';
  if (!G.primary) return;
  // 准星跟随手
  const aimX = g === 'point' || g === 'pinch' ? sm.ix : sm.x, aimY = g === 'point' || g === 'pinch' ? sm.iy : sm.y;
  reticle.x = clamp((aimX - 0.15) / 0.7, 0.03, 0.97); reticle.y = clamp((aimY - 0.12) / 0.7, 0.03, 0.97);
  // 转向：手偏离中心
  if (g === 'palm' || g === 'run' || g === 'point' || (holding && (g === 'fist' || g === 'pinch'))) {
    const dx = sm.x - 0.5, dy = sm.y - 0.48;
    if (Math.abs(dx) > 0.12) inp.turn += -(dx - Math.sign(dx) * 0.12) * 4.0;
    if (Math.abs(dy) > 0.15) inp.pitchRate += -(dy - Math.sign(dy) * 0.15) * 2.4;
  }
  if ((g === 'palm' || g === 'run') && suppressWalk <= 0) { inp.z = 1; inp.run = g === 'run'; }
  const changed = G.consumeChange();
  // 抓取
  if (!holding && changed && (g === 'pinch' || g === 'fist')) { pickUp(); gripType = g; }
  // 松手 = 投掷
  if (holding && g === 'palm' && changed) {
    const v = G.velocity();
    if (v.mag > 0.7) {
      const power = clamp((v.mag - 0.7) / 3.2, 0.15, 1);
      const dir = reticleRay().direction.clone();
      dir.y += clamp(-v.y * 0.12, -0.1, 0.35);
      throwHeld(power, dir.normalize());
    } else dropHeld();
    suppressWalk = 0.7;
  }
  // 单次手势动作
  if (changed) G.pending = g;
  if (G.pending && G.stable === G.pending && G.heldFor(now) > 220 && gestureCooldown <= 0) {
    const p = G.pending; G.pending = null;
    if (p === 'victory') { takePhoto(); gestureCooldown = 1.5; }
    else if (p === 'thumbUp') { jump(); gestureCooldown = 0.8; }
    else if (p === 'thumbDown') { storeHeld(); gestureCooldown = 1.2; }
    else if (p === 'love') { useAction(); gestureCooldown = 1.5; }
  }
}

// ---------- UI ----------
let started = false;
const SPEEDS = [{ k: 0, l: '⏸ 暂停' }, { k: 1, l: '1×' }, { k: 8, l: '8×' }, { k: 60, l: '60×' }];
function setupUI() {
  const wx = $('wxBtns');
  const all = [['auto', '🔄 自动'], ...Object.entries(PRESETS).map(([k, p]) => [k, p.icon + ' ' + p.label])];
  all.forEach(([k, l]) => { const b = document.createElement('button'); b.textContent = l; b.dataset.k = k; b.onclick = () => setWeather(k); wx.appendChild(b); });
  const sp = $('speedBtns');
  SPEEDS.forEach((s) => { const b = document.createElement('button'); b.textContent = s.l; b.dataset.k = s.k; b.onclick = () => setSpeed(s.k); sp.appendChild(b); });
  $('todSlider').oninput = (e) => (game.tod = +e.target.value);
  $('panelBtn').onclick = togglePanel;
  $('helpBtn').onclick = toggleHelp;
  $('volMusic').oninput = (e) => game.audio.setVolume('music', +e.target.value);
  $('volAmb').oninput = (e) => game.audio.setVolume('amb', +e.target.value);
  $('volSfx').oninput = (e) => game.audio.setVolume('sfx', +e.target.value);
  $('qLow').onclick = () => setQuality(false); $('qHigh').onclick = () => setQuality(true);
  $('help').innerHTML = `<b>键鼠</b>：WASD 移动 · Shift 奔跑 · 鼠标看 · 空格 跳<br/>
    左键 拾取；拿着时<b>按住左键蓄力，松开投掷</b>；右键/G 放下<br/>
    E 使用（吹海螺/喝椰子/开漂流瓶/生火/摇椰子树/吹口哨）<br/>
    Q 收进背包（空手=坐下）· C 坐下 · P 拍照<br/>
    1-6 切换天气 · 0 自动 · T 时间流速 · M 音乐 · Tab 面板 · H 帮助<br/>
    <b>手势</b>：🖐 前进（手偏左右=转向，偏上下=抬头低头）· 🖐🖐 奔跑<br/>
    ☝️ 瞄准/转向 · 🤏/✊ 拾取 · 拿着时张开手并<b>向前甩</b>=投掷<br/>
    ✌️ 拍照 · 👍 跳 · 👎 收进背包/坐下 · 🤟 使用<br/>
    <b>小技巧</b>：扁石头低角度扔向海面能打水漂；坐下不动螃蟹会靠近；暴风雨时去北面崖壁下的山洞，点起篝火；雨后背对太阳找彩虹；用石头砸椰子树。`;
  renderBag(); refreshPanel();
}
function togglePanel() { const p = $('panel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; if (document.pointerLockElement) document.exitPointerLock(); }
function toggleHelp() { const p = $('help'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; }
function setWeather(k) { game.weather.set(k); refreshPanel(); toast(k === 'auto' ? '🔄 天气：自动变化' : `${PRESETS[k].icon} 天气切换为：${PRESETS[k].label}`); }
function setSpeed(k) { game.timeScale = k; refreshPanel(); }
function cycleSpeed() { const i = SPEEDS.findIndex((s) => s.k === game.timeScale); setSpeed(SPEEDS[(i + 1) % SPEEDS.length].k); toast('⏱ 时间流速：' + SPEEDS[(i + 1) % SPEEDS.length].l); }
function setQuality(hi) {
  renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio, 1.75) : 0.8);
  game.sky.sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024); game.sky.sun.shadow.map?.dispose(); game.sky.sun.shadow.map = null;
  $('qLow').classList.toggle('on', !hi); $('qHigh').classList.toggle('on', hi);
}
function refreshPanel() {
  document.querySelectorAll('#wxBtns button').forEach((b) => b.classList.toggle('on', (game.weather.mode === 'auto' ? 'auto' : game.weather.presetKey) === b.dataset.k));
  document.querySelectorAll('#speedBtns button').forEach((b) => b.classList.toggle('on', +b.dataset.k === game.timeScale));
}
function renderBag() {
  const bag = $('bag'); bag.innerHTML = '';
  const entries = Object.entries(game.bag).filter(([, n]) => n > 0);
  if (!entries.length) { bag.innerHTML = '<span class="empty">🎒 背包是空的 · 拾起物品后 👎/Q 收进背包</span>'; return; }
  for (const [t, n] of entries) {
    const s = document.createElement('div'); s.className = 'slot'; s.title = '点击取出';
    s.innerHTML = `<b>${TYPES[t].icon}</b>${TYPES[t].name} ×${n}`; s.onclick = () => takeOut(t); bag.appendChild(s);
  }
}
function drawMinimap() {
  const cv = $('minimap'), g = cv.getContext('2d'), S = cv.width, R = 230, P = game.player;
  g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 6.28); g.clip();
  g.fillStyle = '#123b52'; g.fillRect(0, 0, S, S); g.drawImage(game.minimap, 0, 0, S, S);
  const toMap = (x, z) => [(x / R + 1) / 2 * S, (z / R + 1) / 2 * S];
  const [cx, cz] = toMap(CAVE.x, CAVE.faceZ); g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText(game.fire.lit ? '🔥' : '🕳', cx, cz + 4);
  const [px, pz] = toMap(P.pos.x, P.pos.z);
  g.translate(px, pz); g.rotate(-P.yaw); g.fillStyle = '#fff'; g.strokeStyle = '#000';
  g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
const drops = [];
function updateDrops(dt, intensity) {
  const box = $('drops');
  if (intensity > 0.05 && Math.random() < intensity * dt * 14 && drops.length < 40) {
    const d = document.createElement('div'); d.className = 'drop'; const s = 8 + Math.random() * 26;
    Object.assign(d.style, { width: s + 'px', height: s * 1.1 + 'px', left: Math.random() * 100 + '%', top: Math.random() * 90 + '%', opacity: 0.9 });
    box.appendChild(d); drops.push({ d, t: 2 + Math.random() * 3 });
  }
  for (let i = drops.length - 1; i >= 0; i--) {
    const o = drops[i]; o.t -= dt;
    if (o.t < 1.5 && !o.f) { o.f = 1; o.d.style.opacity = 0; o.d.style.transform = 'translateY(30px) scale(.8)'; }
    if (o.t < 0) { o.d.remove(); drops.splice(i, 1); }
  }
}

// ---------- 启动 ----------
async function start(useGesture) {
  if (!ready) return;
  game.audio.start();
  $('start').style.display = 'none'; $('hud').classList.add('on'); started = true;
  setupEvents();
  toast('🏝 欢迎来到潮汐之岛。北面的崖壁下有一个山洞。按 H 查看操作。', '', 6000);
  if (useGesture) {
    mode = 'gesture'; $('camwrap').style.display = 'block'; $('reticle').classList.add('hand');
    gesture = new GestureInput($('video'), $('handCanvas'));
    try { await gesture.init((m) => ($('gestureLbl').textContent = m)); toast('🖐 手势已就绪：张开手掌前进，捏合拾取，甩手投掷'); }
    catch (e) { console.error(e); gesture = null; mode = 'mouse'; $('camwrap').style.display = 'none'; $('reticle').classList.remove('hand'); toast('⚠️ 无法启用摄像头/手势模型，已切换为键鼠模式（' + (e.message || e) + '）', '', 7000); }
  } else if (!isTouch) toast('🖱 点击画面锁定鼠标视角；左键拾取，按住左键蓄力投掷。');
}
$('startGesture').onclick = () => start(true);
$('startMouse').onclick = () => start(false);
['startGesture', 'startMouse'].forEach((id) => ($(id).disabled = true));
setupKeyboard(); setupTouch();

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let hudT = 0, caveT = 0, wasInCave = false, sunsetSeen = false, crystalSeen = false, lastHour = -1, prevNight = 0;
function loop() {
  requestAnimationFrame(loop);
  if (!ready) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  game.time += dt;
  const P = game.player, W = game.weather;

  // 时间
  const ts = game.timeScale * (P.sitting ? 40 : 1);
  game.tod = (game.tod + dt * ts * (24 / 1200)) % 24;

  // 输入
  const inp = { x: 0, z: 0, run: false, turn: 0, pitchRate: 0, lookX: 0, lookY: 0, jump: false };
  if (started) {
    if (keys.KeyW || keys.ArrowUp) inp.z += 1; if (keys.KeyS || keys.ArrowDown) inp.z -= 1;
    if (keys.KeyA) inp.x -= 1; if (keys.KeyD) inp.x += 1;
    if (keys.ArrowLeft) inp.turn += 1.8; if (keys.ArrowRight) inp.turn -= 1.8;
    inp.run = keys.ShiftLeft || keys.ShiftRight;
    inp.x += touch.jx; inp.z -= touch.jy;
    inp.lookX = -mouseDX * 0.0022; inp.lookY = -mouseDY * 0.0022; mouseDX = mouseDY = 0;
    if (mode !== 'gesture') { reticle.x = 0.5; reticle.y = 0.5; }
    gestureCooldown -= dt; suppressWalk -= dt;
    if (mode === 'gesture') gestureIntent(now, inp);
    inp.jump = game.input.jumpQueued; game.input.jumpQueued = false;
    if (charge >= 0) charge += dt;
  } else {
    // 开始界面：缓慢环视
    inp.turn = 0.05;
  }
  P.update(dt, inp);
  if ((inp.z || inp.x) && $('note').style.display === 'block' && game.time - (showNote.at || 0) > 1) $('note').style.display = 'none';

  // 世界系统
  windU.uTime.value = game.time; windU.uWind.value = W.wind; windU.uWindDir.value.set(Math.cos(W.windAng), Math.sin(W.windAng));
  W.update(dt, game);
  game.sky.update(dt, game.tod, W, camera, game.time);
  if (P.inCave) game.sky.hemi.intensity *= 0.35; // 洞内遮蔽
  game.ocean.update(game.time, camera, game.sky, W);
  game.items.update(dt, game);
  game.birds.update(dt, game);
  game.sea.update(dt, game);
  game.butterflies.update(dt, game);
  game.fireflies.update(dt, game);
  game.effects.update(dt, W.rain);
  game.shake = Math.max(0, game.shake - dt * 2);
  renderer.toneMappingExposure = 0.85 + game.sky.state.night * 0.35;
  // 地面湿润
  game.terrain.wetUniform.value = lerp(game.terrain.wetUniform.value, W.rain > 0.15 ? 1 : 0, dt * (W.rain > 0.15 ? 0.05 : 0.012));

  // 篝火
  const F = game.fire;
  const fireDist = P.pos.distanceTo(F.pos);
  if (F.lit) {
    F.boost = Math.max(0, F.boost - dt * 0.05);
    const pw = 1 + F.boost * 1.5;
    game.effects.fire(F.pos, pw * Math.min(1, dt * 60));
    F.light.intensity = (14 + Math.sin(game.time * 13) * 2.5 + Math.sin(game.time * 31) * 1.5 + Math.random() * 2) * pw;
    F.emberMat.emissiveIntensity = 1.5 + Math.sin(game.time * 5) * 0.4;
  }
  // 手中物体
  if (holding) {
    const hp = holdPoint(_v1);
    holding.pos.copy(hp); holding.mesh.position.copy(hp);
    holding.mesh.rotation.y = P.yaw + (holding.type === 'crab' ? Math.PI : 0.6); holding.mesh.rotation.x = holding.type === 'crab' ? 0.4 : 0.3;
    game.items.animateHeld(holding, game.time);
    $('holding').style.display = 'block';
    $('holding').textContent = `手中：${TYPES[holding.type].icon} ${TYPES[holding.type].name} · ${mode === 'gesture' ? '张开手甩出=投掷 · 🤟使用 · 👎收起' : '按住左键蓄力投掷 · E 使用 · Q 收起 · 右键放下'}`;
  } else $('holding').style.display = 'none';
  // 瞄准目标
  if (started) {
    const t = holding ? null : game.items.findTarget(reticleRay(), 6.5);
    if (t !== hover) { hover?.setHighlight(false); hover = t; hover?.setHighlight(true); }
    const rt = $('reticle');
    rt.style.left = reticle.x * 100 + '%'; rt.style.top = reticle.y * 100 + '%';
    rt.classList.toggle('target', !!hover);
    const hint = $('hint');
    if (hover) { hint.style.display = 'block'; hint.style.left = reticle.x * 100 + '%'; hint.style.top = `calc(${reticle.y * 100}% + 34px)`; hint.textContent = `${TYPES[hover.type].icon} ${TYPES[hover.type].name} · ${mode === 'gesture' ? '🤏 捏合拾取' : '左键拾取'}`; }
    else if (!holding && game.items.nearestPalm(P.pos, 2.3)) { hint.style.display = 'block'; hint.style.left = '50%'; hint.style.top = 'calc(50% + 34px)'; hint.textContent = '🌴 摇一摇椰子树（E / 🤟）'; }
    else if (!holding && fireDist < 3.2 && !F.lit) { hint.style.display = 'block'; hint.style.left = '50%'; hint.style.top = 'calc(50% + 34px)'; hint.textContent = '🔥 生火（E / 🤟，需要一根浮木）'; }
    else hint.style.display = 'none';
    const pw = $('power'); pw.style.display = charge >= 0 ? 'block' : 'none'; if (charge >= 0) pw.firstChild.style.width = clamp(charge / 1.1, 0, 1) * 100 + '%';
  }

  // 湿身
  const outsideRain = W.rain * (P.inCave ? 0 : 1);
  if (P.swimming) P.wet = 1;
  P.wet = clamp(P.wet + outsideRain * dt * 0.05 - dt * (0.004 + game.sky.state.day * 0.006 * (1 - W.cover)) - (F.lit && fireDist < 5 ? dt * 0.06 : 0), 0, 1);
  updateDrops(dt, started ? outsideRain * (P.pitch > -0.3 ? 1 : 0.3) : 0);

  // 成就与提示
  if (started) {
    if (P.inCave && !wasInCave) toast('🪨 你走进了崖壁下的山洞——风雨进不来，这里很安全。' + (F.lit ? '' : '洞里有一堆没点燃的篝火。'));
    if (P.inCave && W.rain > 0.5) { caveT += dt; if (caveT > 15) achieve('shelter', '在山洞里躲过风雨'); } else caveT = 0;
    wasInCave = P.inCave;
    if (!crystalSeen && P.pos.distanceTo(game.crystal) < 5) { crystalSeen = true; toast('💎 山洞深处，一簇发光的水晶静静闪烁。'); achieve('crystal', '发现洞穴水晶'); }
    if (P.pos.y > 30) achieve('cliff', '登上崖顶，俯瞰全岛');
    if (W.rainbow > 0.6) achieve('rainbow', '雨后彩虹');
    const e = game.sky.state.elev, hr = Math.floor(game.tod);
    if (game.tod > 17 && e < 0.06 && e > -0.03 && !sunsetSeen && W.cover < 0.8) { sunsetSeen = true; toast('🌅 太阳正沉入海平线……'); achieve('sunset', '看一场海上日落'); }
    if (game.tod > 5 && game.tod < 7 && e > -0.02 && e < 0.05 && W.cover < 0.8) achieve('sunrise', '迎接海上日出');
    if (game.tod > 12) sunsetSeen = sunsetSeen && game.tod > 17; else sunsetSeen = false;
    if (game.sky.state.night > 0.95 && W.cover < 0.3 && P.pitch > 0.5) achieve('stars', '仰望星空');
    if (prevNight < 0.5 && game.sky.state.night >= 0.5) toast('🌙 夜幕降临，萤火虫在丛林里亮起。');
    prevNight = game.sky.state.night;
    if (P.sitting) for (const it of game.items.items) if (it.type === 'crab' && it.state === 'rest' && it.pos.distanceTo(P.pos) < 1.6) { achieve('crabFriend', '螃蟹的朋友'); break; }
    lastHour = hr;
  }

  // 音频
  game.audio.update(dt, {
    listener: { x: P.pos.x, z: P.pos.z, yaw: P.yaw }, coastDist: game.terrain.coastDistance(P.pos.x, P.pos.z), wave: game.ocean.u.uWave.value,
    wind: W.wind, rain: W.rain, inCave: P.inCave, fireNear: F.lit ? clamp(1 - fireDist / 12, 0, 1) : 0, night: game.sky.state.night, day: game.sky.state.day,
    storm: W.dark, swimming: P.swimming, moving: clamp(P.speed / 2, 0, 1), height: P.pos.y,
  });

  // HUD（降频）
  hudT -= dt;
  if (hudT < 0 && started) {
    hudT = 0.2;
    const h = Math.floor(game.tod), m = Math.floor((game.tod - h) * 60);
    const icon = game.tod >= 5 && game.tod < 7 ? '🌅' : game.tod >= 17 && game.tod < 19 ? '🌇' : game.sky.state.night > 0.5 ? '🌙' : '☀️';
    $('clock').textContent = `${icon} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const pr = W.preset;
    $('weatherLbl').textContent = `${pr.icon} ${pr.label}${W.mode === 'auto' ? '（自动）' : ''} · 风力 ${Math.round(W.wind * 10)} 级${W.rainbow > 0.3 ? ' · 🌈' : ''}`;
    const place = P.inCave ? '🪨 山洞（安全避险）' : P.swimming ? '🌊 海里游泳' : P.pos.y > 28 ? '⛰ 崖顶' : P.surfaceHere() === 'sand' ? '🏖 沙滩' : P.surfaceHere() === 'rock' ? '🪨 岩石' : '🌴 热带丛林';
    $('placeLbl').textContent = place + (P.sitting ? ' · 🧘 坐着' : '');
    $('wetBar').style.width = P.wet * 100 + '%';
    $('todLbl').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (document.activeElement !== $('todSlider')) $('todSlider').value = game.tod;
    drawMinimap();
  }

  renderer.render(scene, camera);
  if (photoPending) finishPhoto();
}

window.__dbg = { pickUp, throwHeld, useAction, storeHeld, takePhoto, takeOut, get holding() { return holding; }, get hover() { return hover; }, reticle };
build().catch((e) => { console.error(e); loadMsg.textContent = '初始化失败：' + e.message; });
loop();
