const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert(scripts.length > 0, 'No inline script found');
const code = scripts[scripts.length - 1][1];

const noop = () => {};
const gradient = { addColorStop: noop };
const ctx = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
  measureText: () => ({ width: 50 }),
}, {
  get: (o, k) => (k in o ? o[k] : noop),
  set: (o, k, v) => ((o[k] = v), true),
});
const mkNode = () => ({
  style: { setProperty: noop },
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop },
  addEventListener: noop,
  querySelectorAll: () => [],
  getContext: () => ctx,
  textContent: '',
});
const nodes = {};
const sandbox = {
  console, Math, Set, Uint8Array, ArrayBuffer, Object, String, Number, Array,
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: noop, requestAnimationFrame: noop,
  setInterval: noop, setTimeout: noop,
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  window: {},
  document: {
    querySelector: s => nodes[s] || (nodes[s] = mkNode()),
    querySelectorAll: () => [],
    createElement: () => mkNode(),
    addEventListener: noop,
    hidden: false,
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

vm.runInContext(`
  startMatch('2p');
  // Advance past intro to fight phase
  for (let i = 0; i < 150; i++) step(0.016);
  if (game.phase !== 'fight') throw new Error('Expected fight phase, got ' + game.phase);

  const [p1, p2] = fighters;
  if (p1.cid !== 'human' || p2.cid !== 'lizard') throw new Error('Expected human vs lizard');

  // Forward & backward movement (via real keyboard state)
  const x0 = p1.x;
  keys.add('KeyD');
  for (let i = 0; i < 10; i++) step(0.016);
  if (p1.x <= x0) throw new Error('Forward walk failed');
  keys.delete('KeyD');

  const x1 = p1.x;
  keys.add('KeyA');
  for (let i = 0; i < 10; i++) step(0.016);
  if (p1.x >= x1) throw new Error('Backward walk failed');
  keys.delete('KeyA');

  // Crouch
  keys.add('KeyS');
  step(0.016);
  if (!isCrouching(p1)) throw new Error('Crouch failed');
  keys.delete('KeyS');
  step(0.016);

  // Jump & land
  keys.add('KeyW');
  step(0.016);
  keys.delete('KeyW');
  if (p1.grounded || p1.y >= GROUND) throw new Error('Jump failed');
  for (let i = 0; i < 80; i++) step(0.016);
  if (!p1.grounded) throw new Error('Landing failed');

  // Punch hit
  p1.x = 800; p2.x = 868;
  const hp0 = p2.hp;
  press(p1, 'punch');
  for (let i = 0; i < 12; i++) step(0.016);
  if (p2.hp >= hp0) throw new Error('Punch hit failed');

  // Kick hit
  for (let i = 0; i < 30; i++) step(0.016);
  p1.x = 800; p2.x = 885;
  const hp1 = p2.hp;
  press(p1, 'kick');
  for (let i = 0; i < 18; i++) step(0.016);
  if (p2.hp >= hp1) throw new Error('Kick hit failed');

  // Ranged energy wave spawn & hit
  for (let i = 0; i < 40; i++) step(0.016);
  p1.x = 600; p2.x = 950; p1.cd = 0;
  const hp2 = p2.hp;
  press(p1, 'wave');
  let spawned = false;
  for (let i = 0; i < 80; i++) {
    step(0.016);
    if (projectiles.length > 0) spawned = true;
  }
  if (!spawned) throw new Error('Wave projectile did not spawn');
  if (p2.hp >= hp2) throw new Error('Wave projectile did not hit opponent');

  // KO + English KO voice trigger
  p2.hp = 5; p1.x = 800; p2.x = 868;
  for (let i = 0; i < 30; i++) step(0.016);
  press(p1, 'punch');
  for (let i = 0; i < 20; i++) step(0.016);
  if (game.phase !== 'ko') throw new Error('KO phase not triggered');
  if (!AU.log.includes('voice:ko')) throw new Error('English KO voice not triggered');
  if (!game.banner || game.banner.text !== 'K.O.') throw new Error('KO banner missing');

  draw();
  console.log('PASS: human vs lizard, walk, crouch, jump/land, punch, kick, energy wave, KO + English KO voice.');
`, sandbox);
