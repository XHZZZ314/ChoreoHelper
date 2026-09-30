/* fix4-debug-p3d3.js —— 一次性调试：页面内用经典 GLTFLoader 手动 parse 部署位真模型（用完即删） */
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
  send(method, params) { return this.ready.then(() => new Promise((ok, err) => { const id = ++this.id; this.p.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); })); }
  async evaluate(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : undefined; }
}
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
(async () => {
  const port = 29600 + Math.floor(Math.random() * 1500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p3d4-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, PAGE_URL], { stdio: 'ignore', windowsHide: true });
  await sleep(4000);
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const cdp = new Cdp(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  const expr = `(async function(){
    var log=[];
    function loadClassic(src){return new Promise(function(ok,err){var t=document.createElement('script');t.src=src;t.onload=function(){ok()};t.onerror=function(){err(new Error('script load fail '+src))};document.head.appendChild(t);});}
    try{
      await loadClassic('http://localhost:48795/libs-classic/three.classic.js');
      await loadClassic('http://localhost:48795/libs-classic/BufferGeometryUtils.classic.js');
      await loadClassic('http://localhost:48795/libs-classic/GLTFLoader.classic.js');
      log.push('classic libs OK, THREE.GLTFLoader='+(window.THREE&&THREE.GLTFLoader?'Y':'N'));
      var res=await fetch('http://localhost:48795/model.gltf');
      var buf=await res.arrayBuffer();
      log.push('gltf bytes='+buf.byteLength);
      var loader=new THREE.GLTFLoader();
      var gltf=await new Promise(function(ok,err){loader.parse(buf,'http://localhost:48795/',ok,err)});
      log.push('parse OK');
      var hasSkin=false;gltf.scene.traverse(function(o){if(o.isSkinnedMesh)hasSkin=true});
      log.push('hasSkin='+hasSkin+' children='+gltf.scene.children.length);
    }catch(e){log.push('FAIL: '+(e&&e.message)+' | stack: '+String(e&&e.stack||'').slice(0,300));}
    return log.join('\\n');
  })()`;
  const out = await cdp.evaluate(expr);
  console.log(out);
  const st = await cdp.evaluate(`(function(){var d=window.__p3dDebug?__p3dDebug():null;var s=document.querySelector('.p3d-status');return JSON.stringify({ready:d&&d.ready,offline:d&&d.offline,stat:s?s.textContent.slice(0,70):''})})()`);
  console.log('panel:', st);
  proc.kill();
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(0); }, 500);
})().catch(e => { console.error('DBG-FAIL', e.message || e); process.exit(1); });
