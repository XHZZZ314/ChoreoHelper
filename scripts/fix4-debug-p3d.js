/* fix4-debug-p3d.js —— 一次性调试：游戏在线时 3D 面板为什么没就绪（用完即删） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REPO = path.join(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(REPO, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.exceptions = [];
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') this.exceptions.push(m.params.exceptionDetails);
      else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  on(m, h) { this.handlers.set(m, h); }
  send(method, params) {
    return this.ready.then(() => new Promise((ok, err) => {
      const id = ++this.id; this.pending.set(id, { ok, err });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    }));
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
(async () => {
  const port = 29000 + Math.floor(Math.random() * 5000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fix4p3d-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, PAGE_URL,
  ], { stdio: 'ignore', windowsHide: true });
  await sleep(2500);
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  const logs = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    try {
      const txt = (p.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      logs.push(p.type + ': ' + txt.slice(0, 220));
    } catch (e) { }
  });
  for (let i = 0; i < 8; i++) {
    await sleep(5000);
    const st = await cdp.evaluate(`(function(){
      var d = window.__p3dDebug ? __p3dDebug() : null;
      var stat = document.querySelector('.p3d-status');
      return JSON.stringify({t:i, ready:d&&d.ready, offline:d&&d.offline, status:stat?stat.textContent:'(无状态栏)',
        gameC:store.gameConnected, caps:store.capsOk});
    })()`).catch(e => 'EVAL-ERR ' + e.message);
    console.log(st);
  }
  const r1 = await cdp.evaluate(`fetch('http://localhost:48795/model.gltf').then(r=>r.status+' ct='+r.headers.get('content-type')+' len='+r.headers.get('content-length')).catch(e=>'FETCH-ERR '+e.message)`);
  console.log('gltf fetch:', r1);
  const r3 = await cdp.evaluate(`fetch('http://localhost:48795/model.gltf').then(r=>r.arrayBuffer()).then(b=>'bytes='+b.byteLength+' head='+new TextDecoder().decode(new Uint8Array(b.slice(0,60)))).catch(e=>'FETCH-ERR '+e.message)`);
  console.log('gltf body:', r3);
  const r4 = await cdp.evaluate(`JSON.stringify({ready:(__p3dDebug()||{}).ready,offline:(__p3dDebug()||{}).offline,stat:(document.querySelector('.p3d-status')||{}).textContent,gameC:store.gameConnected,caps:store.capsOk})`);
  console.log('panel:', r4);
  const r5 = await cdp.evaluate(`JSON.stringify(typeof ChoreoLibrary!=='undefined'&&ChoreoLibrary.available()?ChoreoLibrary.stats:null)`);
  console.log('lib available:', r5);
  const st = await cdp.evaluate(`ChoreoLibrary&&ChoreoLibrary.available()?ChoreoLibrary.stats().then(function(s){return JSON.stringify({clips:s.clips,skeleton:s.skeleton,modelFiles:s.modelFiles})}):'n/a'`);
  console.log('lib stats:', st);
  console.log('exceptions:', cdp.exceptions.length, cdp.exceptions.slice(0, 3).map(e => ((e.exceptionDetails && e.exceptionDetails.exception && e.exceptionDetails.exception.description) || '').slice(0, 300)).join(' | '));
  console.log('--- console log ---');
  logs.forEach(l => console.log(l));
  proc.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  process.exit(0);
})().catch((e) => { console.error('调试脚本失败:', e); process.exit(1); });
