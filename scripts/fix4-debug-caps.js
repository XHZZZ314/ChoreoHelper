/* fix4-debug-caps.js —— 一次性调试脚本：file:// 页 + CDP 改写下 capsOk 为什么没置上（用完即删） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REPO = path.join(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(REPO, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const MOCK_PORT = 48797;

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
  // 起 mock（借 library-verify 的 startMock 不行——它在 main 里；直接内联一个最小探测：假设 mock 由调用方先起）
  const port = 21000 + Math.floor(Math.random() * 8000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fix4dbg-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, PAGE_URL,
  ], { stdio: 'ignore', windowsHide: true });
  await sleep(2500);
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  const patterns = [
    { urlPattern: '*://localhost:48795/*', requestStage: 'Request' },
    { urlPattern: '*://localhost:48794/*', requestStage: 'Request' },
  ];
  await cdp.send('Fetch.enable', { patterns });
  cdp.on('Fetch.requestPaused', (p) => {
    const url = p.request.url.replace(':48795/', ':' + MOCK_PORT + '/').replace(':48794/', ':' + MOCK_PORT + '/');
    console.log('[rewrite]', p.request.url, '->', url);
    cdp.send('Fetch.continueRequest', { requestId: p.requestId, url }).catch(() => { });
  });
  await sleep(8000);
  const dbg = await cdp.evaluate(`JSON.stringify({
    appReady: window.store && store.appReady,
    gameConnected: window.store && store.gameConnected,
    exportConnected: window.store && store.exportConnected,
    capsOk: window.store && store.capsOk,
    pluginCaps: window.store && store.pluginCaps,
  })`);
  console.log('store state:', dbg);
  const caps = await cdp.evaluate(`fetch('http://localhost:48794/capabilities').then(function(r){return r.text()}).catch(function(e){return 'FETCH-ERR: '+e.message})`);
  console.log('page fetch /capabilities:', caps);
  console.log('exceptions:', cdp.exceptions.length, cdp.exceptions.slice(0, 3).map(e => e.exceptionDetails ? e.exceptionDetails.text : e.text).join(' | '));
  proc.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  process.exit(0);
})().catch((e) => { console.error('调试脚本失败:', e); process.exit(1); });
