// 生成可独立运行的下载包 dist/gesture-sorcery.zip
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const files = ['index.html', 'README.md', 'screenshot.jpg', 'start.cmd', 'start.sh', 'css', 'js'];
mkdirSync('dist', { recursive: true });
rmSync('dist/gesture-sorcery.zip', { force: true });
execFileSync('sh', ['-c', `mkdir -p dist/stage && rm -rf dist/stage/gesture-sorcery && mkdir dist/stage/gesture-sorcery && cp -r ${files.join(' ')} dist/stage/gesture-sorcery/ && cd dist/stage && zip -qr9 ../gesture-sorcery.zip gesture-sorcery && cd .. && rm -rf stage`], { stdio: 'inherit' });
console.log('dist/gesture-sorcery.zip');
