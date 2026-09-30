/* fix4-debug-p3d2.js —— 一次性调试：从导航前监听网络失败/console，看模型加载为何回退替身（用完即删） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE_URL = 'file:///D:/choreohelper/web/dist/ChoreoHelper/choreo-helper-app.html';

class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); this.h = new Map(); this.ex = [];
    this.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const { ok, err } = this.p.get(m.id); this.p.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); } else if (m.method && this.h.has(m.method)) this.h.get(m.method)(m.params); };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; }); }
  on(m, h) { this.h.set(m, h); }
  send(method, params) { return this.ready.then(() => new Promise((ok, err) => { const id = ++this.id; this.p.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); })); }
  async evaluate(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result ? r.result.value : undefined; }
}
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
(async () => {
  const port = 29800 + Math.floor(Math.random() * 1500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p3d3-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  await sleep(2500);
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const cdp = new Cdp(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  const events = [];
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  cdp.on('Runtime.consoleAPICalled', p => { const t = (p.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' '); events.push('[console.' + p.type + '] ' + t.slice(0, 250)); });
  cdp.on('Runtime.exceptionThrown', p => { events.push('[exception] ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text).slice(0, 250)); });
  const reqUrl = {};
  cdp.on('Network.requestWillBeSent', p => {
    reqUrl[p.requestId] = p.request.url;
    const h = p.request.headers || {};
    const o = h.Origin || h.origin || '';
    if (/model|skeleton|export|48795|48794/.test(p.request.url)) events.push('[req ' + p.requestId + '] ' + p.request.method + ' ' + p.request.url.slice(0, 110) + (o ? ' Origin=' + o : ' Origin=(无)'));
  });
  cdp.on('Network.loadingFailed', p => { events.push('[netfail ' + p.requestId + '] err=' + p.errorText + ' cors=' + JSON.stringify(p.corsErrorStatus || null) + ' url=' + String(reqUrl[p.requestId] || '?').slice(0, 110)); });
  cdp.on('Network.responseReceived', p => { const u = p.response.url; if (/model|skeleton|export/.test(u)) events.push('[resp ' + p.response.status + '] ' + u.slice(0, 120)); });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  // 注入 fetch/GLTFLoader 记录器（导航后再补注也行——10s 探针会反复 init）
  await cdp.evaluate(`(function(){
    window.__netLog=[];
    if(!window.__origFetch){window.__origFetch=window.fetch;
      window.fetch=function(u,o){return window.__origFetch(u,o).then(function(r){
        try{var s=String(u);if((s.indexOf('48795')>=0||s.indexOf('model')>=0)&&s.indexOf('getclip')<0)window.__netLog.push('fetch '+r.status+' '+s.slice(0,90)+' ct='+r.headers.get('content-type'));}catch(e){}
        return r;},function(e){try{var s=String(u);if(s.indexOf('getclip')<0)window.__netLog.push('fetch-THROW '+s.slice(0,90)+' '+(e&&e.message));}catch(x){}throw e;});};}
    var n=0;var t=setInterval(function(){n++;
      var G=(window.THREE&&THREE.GLTFLoader)||(window.GLTFLoader);
      if(G&&G.prototype&&!G.prototype.__patched){G.prototype.__patched=true;
        var op=G.prototype.parse;G.prototype.parse=function(){var a=arguments;
          window.__netLog.push('parse called');
          return op.apply(this,a).then(function(v){window.__netLog.push('parse OK');return v;},function(e){window.__netLog.push('parse FAIL: '+(e&&e.message));throw e;});};
        clearInterval(t);}
      if(n>120)clearInterval(t);},250);
  })()`);
  const readLog = async () => { try { return await cdp.evaluate('(window.__netLog||[]).slice(-14).join("\\n")'); } catch (e) { return 'log-eval-err'; } };
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const st = await cdp.evaluate(`(function(){var d=window.__p3dDebug?__p3dDebug():null;var s=document.querySelector('.p3d-status');return JSON.stringify({sec:Math.round(performance.now()/1000),ready:d&&d.ready,offline:d&&d.offline,stat:s?s.textContent.slice(0,60):'',gameC:store.gameConnected})})()`);
    console.log('sample:', st);
    if (i === 4) console.log('--- netLog ---\n' + await readLog());
  }
  console.log('--- events ---');
  events.forEach(e => console.log(e));
  proc.kill();
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(0); }, 500);
})().catch(e => { console.error('DBG-FAIL', e); process.exit(1); });
