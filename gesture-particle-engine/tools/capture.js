/**
 * 零依赖自动化截图 / 录屏工具（Node ≥ 22，使用内置 WebSocket）
 * 用法：node tools/capture.js [截图延时ms] [录屏时长ms]
 * 输出：docs/screenshot-demo.png、docs/recording-demo.webm
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9233;
const URL = process.env.GP_URL || 'http://localhost:8080/?demo=1&autostart=1';
const WAIT = Number(process.argv[2] || 7000);
const RECORD = Number(process.argv[3] || 6000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.onopen = () => resolve({
      ws,
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      async evaluate(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise, userGesture: true
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
        return r.result.value;
      }
    });
    ws.onerror = reject;
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(JSON.stringify(m.error)));
        else p.res(m.result);
      }
    };
  });
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = path.join(ROOT, '.edge-capture-profile');
  const browser = spawn(EDGE, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-gpu-sandbox', '--hide-scrollbars',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--window-size=1440,900', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    let targets;
    for (let i = 0; i < 60; i++) {
      try {
        targets = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
        const page = targets.find(t => t.type === 'page');
        if (page) { cdp = await connect(page.webSocketDebuggerUrl); break; }
      } catch (_) {}
      await sleep(250);
    }
    if (!cdp) throw new Error('无法连接无头浏览器调试端口');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: URL });
    await sleep(1200);
    if (process.env.GP_STATE_INDEX != null) {
      const idx = Number(process.env.GP_STATE_INDEX);
      await cdp.evaluate(`(function(){const t=window.GPApp && window.GPApp.tracker; if(t){t.demoIndex=${idx}; t.demoStateTimer=0;} return t ? t.demoSequence[t.demoIndex] : null;})()`);
      console.log('强制演示状态索引:', idx);
    }
    console.log('页面已加载，等待 ' + WAIT + ' ms 让粒子动效稳定…');
    await sleep(WAIT);

    const stats = await cdp.evaluate(`(() => {
      const a = window.GPApp;
      return a ? {
        state: a.lastState, fps: +a.fps.toFixed(1), particles: a.engine.count,
        latencyMs: +a.frameWorkMs.toFixed(2), renderer: a.renderer.name,
        quality: +a.engine.quality.toFixed(2), introHidden: document.getElementById('intro').classList.contains('hidden')
      } : { error: 'GPApp 未初始化' };
    })()`);
    console.log('运行指标:', JSON.stringify(stats));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const shotName = process.env.GP_SHOT || 'screenshot-demo.png';
    fs.writeFileSync(path.join(DOCS, shotName), Buffer.from(shot.data, 'base64'));
    console.log('截图已保存: docs/' + shotName);

    if (process.env.GP_NO_RECORD === '1') {
      console.log('跳过录制');
      return;
    }
    console.log('开始录制 ' + RECORD + ' ms…');
    const b64 = await cdp.evaluate(`(async () => {
      const blob = await window.GPApp.captureRecording(${RECORD});
      return await new Promise(resolve => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.readAsDataURL(blob);
      });
    })()`, true);
    fs.writeFileSync(path.join(DOCS, 'recording-demo.webm'), Buffer.from(b64, 'base64'));
    const size = fs.statSync(path.join(DOCS, 'recording-demo.webm')).size;
    console.log('录屏已保存: docs/recording-demo.webm (' + (size / 1024).toFixed(0) + ' KB)');
    fs.writeFileSync(path.join(DOCS, 'demo-metrics.json'), JSON.stringify({ ...stats, recordedMs: RECORD, screenshot: 'screenshot-demo.png', recording: 'recording-demo.webm' }, null, 2));
  } catch (e) {
    console.error('捕获失败:', e);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (_) {}
    browser.kill();
  }
})();
