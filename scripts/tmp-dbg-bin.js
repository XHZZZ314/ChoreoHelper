// 临时诊断：bin 写库链路排查（验收完即删）。真插件在线场景。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
(async () => {
  const exe = CHROME.find((p) => fs.existsSync(p));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-dbg3-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, PAGE_URL], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page'); if (target) break; await sleep(300); }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { ok, err } = pend.get(m.id); pend.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); } };
    const send = (method, params) => new Promise((ok, err) => { const i2 = ++id; pend.set(i2, { ok, err }); ws.send(JSON.stringify({ id: i2, method, params: params || {} })); });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text);
      return r.result ? r.result.value : undefined;
    };
    await send('Runtime.enable');
    console.log('等面板就绪…');
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const ready = await ev('(function(){try{return !!(window.__p3dDebug&&__p3dDebug().ready)}catch(e){return false}})()');
      if (ready) break;
    }
    console.log('profile:', await ev('(function(){try{var d=__p3dDebug();return JSON.stringify(d.profile)}catch(e){return "err"}})()'));
    console.log('note:', await ev('__p3dDebug().modelNote'));
    // 手动查部署位 model.bin 响应
    console.log('bin fetch:', await ev('fetch("http://localhost:48795/model.bin").then(function(r){return "status="+r.status+" ct="+r.headers.get("content-type")+" len="+r.headers.get("content-length")}).catch(function(e){return "ERR:"+e.message})'));
    // 查档案里已有的文件
    console.log('files:', await ev('ChoreoLibrary.getActiveProfile().then(function(p){var pid=p.id;return Promise.all([ChoreoLibrary.getProfileFileInfo(pid,"model.gltf"),ChoreoLibrary.getProfileFileInfo(pid,"model.bin")]).then(function(x){return JSON.stringify({gltf:!!x[0],gltfSize:x[0]&&x[0].size,bin:!!x[1],binSize:x[1]&&x[1].size})})}).catch(function(e){return "ERR:"+e.message})'));
    // 手动走一遍 bin 写入（与 preview3d 相同逻辑）
    console.log('manual bin write:', await ev(
      'fetch("http://localhost:48795/model.bin").then(function(r){if(!r.ok)return "http "+r.status;var ct=r.headers.get("content-type")||"";if(ct.indexOf("application/json")>=0)return "json ct";return r.blob()})' +
      '.then(function(b){if(typeof b==="string")return b;return b.arrayBuffer().then(function(bb){var pid="";return ChoreoLibrary.getActiveProfile().then(function(p){pid=p.id;return ChoreoLibrary.putProfileFile(pid,"model.bin",new Blob([bb]))}).then(function(){return "written bytes="+bb.byteLength+" to "+pid}).catch(function(e){return "PUT ERR:"+(e&&(e.message||e))})})})' +
      '.catch(function(e){return "ERR:"+(e&&(e.message||e))})', 
    ));
    console.log('files after:', await ev('ChoreoLibrary.getActiveProfile().then(function(p){var pid=p.id;return ChoreoLibrary.getProfileFileInfo(pid,"model.bin").then(function(x){return JSON.stringify({bin:!!x,binSize:x&&x.size,binHash:x&&x.hash&&x.hash.slice(0,8)})})})'));
  } finally { try { proc.kill(); } catch (e) {} try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }
})();
