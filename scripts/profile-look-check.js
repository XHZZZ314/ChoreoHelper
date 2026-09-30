// 临时验收脚本（验证完可删）：真游戏在线场景验证「角色档案」流程——
// 空库 + 游戏新角色（106骨）→ 应自动建档、部署位老模型因不兼容被拒、面板显示替身+提示
// 用法：D:\nodejs\node.exe scripts\profile-look-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const vclean = require('./verify-cleanup'); // HYGIENE(AC-11)：四条退出路径统一清理临时 profile

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map();
    this.onEvent = null; // 拦截等场景用
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
      else if (m.method && this.onEvent) this.onEvent(m);
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((ok, err) => { this.pending.set(id, { ok, err }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}

async function main() {
  const exe = CHROME.find((p) => fs.existsSync(p));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-profcheck-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1500,950', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profileDir); // Ctrl+C/未捕获异常/强杀也由公共清理模块兜底（正常路径仍走 finally）
  let cdp;
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} if (i === 59) throw new Error('Chrome 起不来'); }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page'); if (target) break; await sleep(300); }
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.ready;
    // 模拟"游戏里换成了带尾巴的新角色"：拦截 /export/skeleton，回 101 骨快照 + 5 根尾巴骨（位移拉大模拟异体型）
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://localhost:48795/export/skeleton', stage: 'Request' }] });
    let intercepted = false;
    cdp.onEvent = (m) => {
      if (m.method === 'Fetch.requestPaused' && !intercepted) {
        intercepted = true;
        (async () => {
          const snapSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'skeleton-snapshot.js'), 'utf8');
          const snap = JSON.parse(snapSrc.match(/window\.__CHOREO_SKELETON_SNAPSHOT__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
          if (!process.argv[2]) { // 不带参数=模拟异体型（加尾巴骨）；带 compat=原样快照（与部署位真模型同身型）
            const tail = ['n_sippo_a', 'n_sippo_b', 'n_sippo_c', 'n_sippo_d', 'n_sippo_e'];
            tail.forEach((n, i) => {
              snap.bones.push({ i: snap.count + i, n, p: 0, t: [0, 0.5 + i * 0.1, 0.05], q: [0, 0, 0, 1] });
            });
            snap.count = snap.bones.length;
          }
          const body = JSON.stringify(snap);
          await cdp.send('Fetch.fulfillRequest', {
            requestId: m.params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: Buffer.from(body).toString('base64'),
          });
        })().catch(() => {});
      }
    };
    const t0 = Date.now();
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: PAGE_URL }); // 拦截挂好才放页面进来，保证 /export/skeleton 被接住
    for (;;) {
      const st = await cdp.evaluate('(function(){ try { var d=window.__p3dDebug(); return d && d.ready ? JSON.stringify({profile:d.profile,mismatch:d.mismatch,modelNote:d.modelNote,offline:d.offline,status:document.querySelector(".p3d-status").textContent,miss:document.querySelector(".p3d-miss").textContent}) : null; } catch(e){ return null; } })()').catch(() => null);
      if (st) { console.log('面板状态:', JSON.stringify(JSON.parse(st), null, 1)); break; }
      if (Date.now() - t0 > 45000) throw new Error('等 3D 面板就绪超时');
      await sleep(500);
    }
    const profs = await cdp.evaluate('ChoreoLibrary.listProfiles().then(p=>JSON.stringify(p))');
    console.log('档案清单:', profs);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'profile-check.tmp.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图已存 profile-check.tmp.png');
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
    if (cdp && cdp.ws) try { cdp.ws.close(); } catch (e) {}
  }
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
