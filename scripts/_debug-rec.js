// _debug-rec.js — 临时调试脚本（用完即删）：复现 rec 场景 ③+④，查"单条重录"为何超时
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
// 直接借 library-verify.js 的设施不方便（它是自执行 main），这里最小复制 launchChrome+CDP+mock
const { spawn } = require('child_process');
const http = require('http');

const REPO = path.join(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(REPO, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const MOCK_PORT = 48798;
const CLIPS = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'ChoreoExports', 'clips');
const DIST = path.join(REPO, 'web', 'dist', 'ChoreoHelper');

function makeClip(name, dur, isStatic) {
  const q = isStatic
    ? [[0, .1, .2, .3, .9], [1, .1, .2, .3, .9], [2, .1, .2, .3, .9]]
    : [[0, .1, .2, .3, .9], [1, .4, .25, .35, .85], [2, .1, .2, .3, .9]];
  return { name: name, duration: dur, type: dur >= 19 ? 'loop' : 'once',
    bones: { bone_46: { q: q, t: [[0, 0, 1.4, 0]] }, bone_2: { q: [[0, 0, 0, 0, 1]], t: [[0, 0.02, 0.4, 0]] } } };
}
const stats = { clips: [], walkresets: 0, previews: [], staticNames: new Set(['recstat']) };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    if (u.pathname === '/export/list') {
      const clips = fs.readdirSync(CLIPS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ clips }));
    } else if (u.pathname === '/export/clip') {
      let cmd = ''; try { cmd = String(JSON.parse(body).command || ''); } catch (e) {}
      stats.clips.push(cmd);
      const name = cmd.trim().replace(/^\//, '').replace(/ motion$/, '');
      let dur = 3.0; if (name === 'doze') dur = 2.0; if (name === 'golddance') dur = 19.2;
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(makeClip(name, dur, stats.staticNames.has(name))));
    } else if (u.pathname === '/export/walkreset') { stats.walkresets++; res.end('{}'); }
    else if (u.pathname === '/preview') { stats.previews.push(body); res.end('{"ok":true}'); }
    else if (u.pathname === '/health') { res.end('{"status":"ok"}'); }
    else if (u.pathname === '/export/skeleton') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(fs.readFileSync(path.join(DIST, 'skeleton-snapshot.js'), 'utf8').match(/__CHOREO_SKELETON_SNAPSHOT__\s*=\s*([\s\S]*);/)[1]); }
    else if (u.pathname === '/actions/emotes') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ emotes: JSON.parse(fs.readFileSync(path.join(DIST, 'catalog-snapshot.js'), 'utf8').match(/__CHOREO_CATALOG__\s*=\s*([\s\S]*);/)[1]).emotes })); }
    else if (u.pathname === '/actions/races') { res.end('{"races":[]}'); }
    else if (u.pathname === '/actions') { res.end('{"actions":[]}'); }
    else if (u.pathname === '/classjobs') { res.end('{"classJobs":[]}'); }
    else if (u.pathname === '/actions/measured-durations') { res.end('{"durations":{}}'); }
    else if (u.pathname === '/gpose/state') { res.end('{"gpose":false}'); }
    else if (u.pathname.startsWith('/export/')) { res.end('{"error":"unknown"}'); }
    else {
      const p = path.normalize(path.join(DIST, u.pathname.replace(/^\/+/, '')));
      if (p.startsWith(DIST) && fs.existsSync(p)) { res.end(fs.readFileSync(p)); } else { res.statusCode = 404; res.end(); }
    }
  });
});

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.exceptions = [];
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') { this.exceptions.push(m.params.exceptionDetails); console.log('[页面异常]', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); }
      else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  on(m, h) { this.handlers.set(m, h); }
  send(method, params) { return this.ready.then(() => new Promise((ok, err) => { const id = ++this.id; this.pending.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); })); }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

(async () => {
  await new Promise((ok) => server.listen(MOCK_PORT, '127.0.0.1', ok));
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 23000 + Math.floor(Math.random() * 9000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-dbgrec-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--disable-extensions', '--window-size=1400,900',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, PAGE_URL], { stdio: 'ignore', windowsHide: true });
  try {
    let cdp;
    for (let i = 0; i < 60 && !cdp; i++) {
      await sleep(300);
      try {
        const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        const t = list.find((x) => x.type === 'page' && x.url.startsWith('file:'));
        if (t) cdp = new Cdp(t.webSocketDebuggerUrl);
      } catch (e) {}
    }
    if (!cdp) throw new Error('Chrome 起不来');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://localhost:48795/*' }, { urlPattern: '*://localhost:48794/*' }] });
    cdp.on('Fetch.requestPaused', (p) => {
      const url = p.request.url.replace(':48795/', ':' + MOCK_PORT + '/').replace(':48794/', ':' + MOCK_PORT + '/');
      cdp.send('Fetch.continueRequest', { requestId: p.requestId, url }).catch(() => {});
    });
    // 等就绪
    for (let i = 0; i < 60; i++) { const ok = await cdp.evaluate('window.store && store.appReady').catch(() => false); if (ok) break; await sleep(400); }
    console.log('页面就绪');
    // ③ 核心会话（同 rec 场景）
    await cdp.evaluate(`recStart('pick',[{cmd:'/bow motion',cname:'a',b:'bow'},{cmd:'/doze motion',cname:'a',b:'doze'},{cmd:'/golddance motion',cname:'a',b:'golddance'},{cmd:'/recstat motion',cname:'a',b:'recstat'}])`);
    for (let i = 0; i < 120; i++) {
      const d = await cdp.evaluate('(function(){var d=__recDebug();return JSON.stringify({r:d.running,f:d.session&&d.session.finished})})');
      if (d === '{"r":false,"f":true}') break;
      await sleep(500);
    }
    console.log('会话③结束. previews=', stats.previews, 'walkresets=', stats.walkresets, 'clips=', stats.clips);
    // ④ 重录
    await cdp.evaluate('showRecModal()'); await sleep(500);
    console.log('模态文字片段:', String(await cdp.evaluate('document.querySelector(\'.modal\').textContent')).slice(0, 400));
    stats.staticNames.delete('recstat');
    const clicked = await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='重录'});if(b){b.click();return true}return false})()`);
    console.log('点击重录:', clicked);
    for (let i = 0; i < 30; i++) {
      const d = await cdp.evaluate('(function(){var d=__recDebug();return JSON.stringify({r:d.running,f:d.session&&d.session.finished,items:d.session?d.session.items.map(function(it){return it.name+":"+it.status+":"+it.tries}):null})})');
      console.log('  poll', i, d);
      if (d.indexOf('"f":true') >= 0 && d.indexOf('"r":false') >= 0) break;
      await sleep(1000);
    }
    console.log('异常数:', cdp.exceptions.length);
  } finally {
    try { proc.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();
