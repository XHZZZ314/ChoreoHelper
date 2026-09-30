// 临时调试：modelswitch 场景前置阶段的面板状态观察（验收完即删）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.onEvent = null;
    this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') console.log('PAGE-EXC:', JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text)); };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; }); }
  send(method, params) { const id = ++this.id; return new Promise((ok, err) => { this.pending.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async evaluate(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text)); return r.result ? r.result.value : undefined; }
}
(async () => {
  const exe = CHROME.find((p) => fs.existsSync(p));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-dbg-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,900', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page'); if (target) break; await sleep(300); }
    const cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.ready;
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const snapSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'skeleton-snapshot.js'), 'utf8');
    const snap = JSON.parse(snapSrc.match(/window\.__CHOREO_SKELETON_SNAPSHOT__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const standinSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'standin-model.js'), 'utf8');
    const standin = JSON.parse(standinSrc.match(/window\.__CHOREO_STANDIN_MODEL__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const deployModel = JSON.parse(JSON.stringify(standin));
    if (deployModel.materials && deployModel.materials[0]) deployModel.materials[0].name = 'deployVariant';
    await cdp.send('Fetch.enable', { patterns: [
      { urlPattern: '*://localhost:48795/export/skeleton', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.gltf', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.glb', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/list', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/getclip*', stage: 'Request' },
    ] });
    const hits = [];
    cdp.onEvent = (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const u = m.params.request.url;
      hits.push(u);
      const fulfill = (code, ctype, body) => cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: code,
        responseHeaders: [{ name: 'Content-Type', value: ctype }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(body).toString('base64') }).catch((e) => console.log('fulfill err', e.message));
      (async () => {
        if (u.indexOf('/export/skeleton') >= 0) await fulfill(200, 'application/json', JSON.stringify(snap));
        else if (u.endsWith('/model.glb')) await fulfill(404, 'application/json', '{"error":"none"}');
        else if (u.endsWith('/model.gltf')) await fulfill(200, 'model/gltf', JSON.stringify(deployModel));
        else if (u.indexOf('/export/list') >= 0) await fulfill(200, 'application/json', '{"clips":[]}');
        else await fulfill(200, 'application/json', '{"error":"none"}');
      })().catch((e) => console.log('handler err', e.message));
    };
    await cdp.send('Page.navigate', { url: PAGE_URL });
    for (let i = 0; i < 40; i++) {
      await sleep(1500);
      const st = await cdp.evaluate('(function(){ try { if (!window.__p3dDebug) return "no debug hook yet"; var d = __p3dDebug(); return JSON.stringify({ ready: d.ready, offline: d.offline, profile: d.profile, mismatch: d.mismatch, note: d.modelNote, status: (document.querySelector(".p3d-status")||{}).textContent }); } catch (e) { return "err " + e.message; } })()').catch((e) => 'eval err ' + e.message);
      console.log(i, st);
      if (st && st.indexOf('"ready":true') >= 0) break;
    }
    console.log('intercepted:', hits.slice(0, 12));
    const profs = await cdp.evaluate('ChoreoLibrary.listProfiles().then(p => JSON.stringify(p))').catch((e) => 'err ' + e.message);
    console.log('profiles:', profs);
  } finally { try { proc.kill(); } catch (e) {} try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }
})();
