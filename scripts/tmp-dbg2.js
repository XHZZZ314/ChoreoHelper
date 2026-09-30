// 临时调试：THREE 可用性探针（验收完即删）
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-dbg2-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page'); if (target) break; await sleep(300); }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok) => { ws.onopen = ok; });
    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { ok, err } = pend.get(m.id); pend.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); } };
    const send = (method, params) => new Promise((ok, err) => { const i2 = ++id; pend.set(i2, { ok, err }); ws.send(JSON.stringify({ id: i2, method, params: params || {} })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception || {}).description; return r.result ? r.result.value : undefined; };
    await send('Page.enable');
    await send('Page.navigate', { url: PAGE_URL });
    await sleep(8000);
    console.log('href:', await ev('location.href'));
    console.log('typeof THREE:', await ev('typeof THREE'));
    console.log('typeof window.THREE:', await ev('typeof window.THREE'));
    console.log('ready:', await ev('(function(){try{return JSON.stringify(window.__p3dDebug&&__p3dDebug().ready)}catch(e){return "err:"+e.message}})()'));
    console.log('status:', await ev('(document.querySelector(".p3d-status")||{textContent:"none"}).textContent'));
    console.log('scripts:', await ev('[].map.call(document.scripts,function(s){return s.src||"inline"}).join(" | ")'));
  } finally { try { proc.kill(); } catch (e) {} try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }
})();
