/**
 * 零依赖静态服务器。
 * 摄像头 API 要求安全上下文：localhost 被浏览器视为安全来源，因此本地用本服务器即可。
 * 用法：node server.js [端口]   默认 8080
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);
  } catch (_) {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // 归一化并阻止目录穿越
  const resolved = path.resolve(ROOT, '.' + pathname);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // 单页应用式回退：非静态资源请求回到 index.html
      if (!path.extname(pathname)) {
        fs.readFile(path.join(ROOT, 'index.html'), (e, data) => {
          if (e) { res.writeHead(404).end('Not Found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(data);
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found: ' + pathname);
      }
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(resolved).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('手势粒子引擎已启动:  http://localhost:' + PORT);
  console.log('Demo 模式（无需摄像头）: http://localhost:' + PORT + '/?demo=1&autostart=1');
});
