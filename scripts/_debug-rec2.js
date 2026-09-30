// _debug-rec2.js — 临时调试（用完即删）：聚焦"单条重录"为何不完成
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
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
  return { name, duration: dur, type: dur >= 19 ? 'loop' : 'once',
    bones: { bone_46: { q: q, t: [[0, 0, 1.4, 0]] }, bone_2: { q: [[0, 0, 0, 0, 1]], t: [[0, 0.02, 0.4, 0]] } } };
}
const stats = { clips: [], staticNames: new Set(['recstat']) };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (u.pathname === '/export/list') {
      const clips = fs.readdirSync(CLIPS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      res.end(JSON.stringify({ clips }));
    } else if (u.pathname === '/export/clip') {
      let cmd = ''; try { cmd = String(JSON.parse(body).command || ''); } catch (e) {}
      stats.clips.push(cmd);
      const name = cmd.trim().replace(/^\//, '').replace(/ motion$/, '');
      res.end(JSON.stringify(makeClip(name, 3.0, stats.staticNames.has(name))));
    } else if (u.pathname === '/export/walkreset') { res.end('{}'); }
    else if (u.pathname === '/preview') { res.end('{"ok":true}'); }
    else if (u.pathname === '/health') { res.end('{"status":"ok"}'); }
    else if (u.pathname === '/export/skeleton') { res.end(fs.readFileSync(path.join(DIST, 'skeleton-snapshot.js'), 'utf8').match(/__CHOREO_SKELETON_SNAPSHOT__\s*=\s*([\s\S]*);/)[1]); }
    else if (u.pathname === '/actions/emotes') { res.end(JSON.stringify({ emotes: JSON.parse(fs.readFileSync(path.join(DIST, 'catalog-snapshot.js'), 'utf8').match(/__CHOREO_CATALOG__\s*=\s*([\s\S]*);/)[1]).emotes })); }
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
      else if (m.method === 'Runtime.exceptionThrown') { this.exceptions.push(m.params.exceptionDetails); console.log('[页面异常]', JSON.stringify(m.params.exceptionDetails).slice(0, 400)); }
      else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  on(m, h) { this.handlers.set(m, h); }
  send(method, params) { return this.ready.then(() => new Promise((ok, err) => { const id = ++this.id; this.pending.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); })); }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
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
    for (let i = 0; i < 60; i++) { if (await cdp.evaluate('window.store && store.appReady').catch(() => false)) break; await sleep(400); }
    console.log('== 页面就绪，跑会话③（只两条，快）');
    await cdp.evaluate(`recStart('pick',[{cmd:'/bow motion',cname:'a',b:'bow'},{cmd:'/recstat motion',cname:'a',b:'recstat'}])`);
    let fin = false;
    for (let i = 0; i < 100 && !fin; i++) {
      fin = await cdp.evaluate('!__recDebug().running && __recDebug().session && __recDebug().session.finished===true').catch(() => false);
      if (!fin) await sleep(300);
    }
    console.log('③ finished=', fin, 'POST:', stats.clips.join(' | '));
    await cdp.evaluate('showRecModal()'); await sleep(400);
    stats.staticNames.clear();
    console.log('重录按钮找到:', await cdp.evaluate(`!!Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='重录'})`));
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='重录'});if(b)b.click()})()`);
    for (let i = 0; i < 25; i++) {
      const running = await cdp.evaluate('__recDebug().running').catch((e) => 'ERR:' + e.message);
      const finished = await cdp.evaluate('__recDebug().session && __recDebug().session.finished').catch((e) => 'ERR:' + e.message);
      const items = await cdp.evaluate('JSON.stringify(__recDebug().session.items.map(function(it){return it.name+":"+it.status+"/"+it.tries}))').catch((e) => 'ERR:' + e.message);
      const manifest = await cdp.evaluate('JSON.parse(localStorage.getItem("choreo_recSession")||"null") ? "有" : "无"').catch((e) => 'ERR:' + e.message);
      console.log(`poll${i} running=${running} finished=${finished} items=${items} manifest=${manifest}`);
      if (running === false && finished === true) { console.log('== 重录完成'); break; }
      await sleep(1000);
    }
    console.log('异常数:', cdp.exceptions.length);
  } finally {
    try { proc.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();
