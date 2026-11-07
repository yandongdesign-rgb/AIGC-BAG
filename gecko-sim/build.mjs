// Inline three.js into the simulator so the output is a single offline-ready HTML file.
import {readFileSync, writeFileSync} from 'node:fs';
const dir = new URL('.', import.meta.url);
const three = readFileSync(new URL('vendor/three.min.js', dir), 'utf8');
if (/<\/script/i.test(three)) throw new Error('three.min.js contains </script>');
const src = readFileSync(new URL('src/gecko.html', dir), 'utf8');
const out = src.replace('/*__THREE__*/', () => three);
writeFileSync(new URL('Gekko-GX4-Simulator.html', dir), out);
console.log('built Gekko-GX4-Simulator.html', (out.length / 1024).toFixed(0) + ' KB');
