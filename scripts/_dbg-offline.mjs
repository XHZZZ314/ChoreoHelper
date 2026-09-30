// _dbg-offline.mjs — 临时调试脚本（用完删）：离线场景下 3D 面板为什么没就绪
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 23456, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-dbg-'));
const url = 'file:///D:/choreohelper/web/dist/ChoreoHelper/choreo-helper-app.html';
const proc = spawn(exe, ['--headless=new', '--no-first-run', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--host-resolver-rules=MAP localhost ~NOTFOUND', url],
  { stdio: 'ignore', windowsHide: true });
await sleep(2500);
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const t = list.find(x => x.type === 'page' && x.url.startsWith('file:'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pends = new Map(); const logs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pends.has(m.id)) { const { ok } = pends.get(m.id); pends.delete(m.id); ok(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled')
    logs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
  else if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text).slice(0, 500));
};
await new Promise(ok => ws.onopen = ok);
const send = (method, params) => new Promise(ok => { const i = ++id; pends.set(i, { ok }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
await send('Runtime.enable');
await sleep(10000);
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
console.log('status :', await ev('document.querySelector(".p3d-status") ? document.querySelector(".p3d-status").textContent : "无面板元素"'));
console.log('debug  :', JSON.stringify(await ev('window.__p3dDebug ? { ready: __p3dDebug().ready, offline: __p3dDebug().offline } : "无"')));
console.log('THREE? :', await ev('typeof window.THREE + " / GLTFLoader=" + (window.THREE && typeof window.THREE.GLTFLoader) + " / clone=" + (window.THREE && typeof window.THREE.clone)'));
console.log('快照?  :', await ev('typeof window.__CHOREO_SKELETON_SNAPSHOT__ + " / standin=" + typeof window.__CHOREO_STANDIN_MODEL__'));
console.log('--- 页面日志/异常 ---'); logs.forEach(l => console.log(l));
try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(0);
