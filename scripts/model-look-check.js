// 临时诊断脚本（用完可删）：游戏在线场景打开主页，等 3D 面板就绪后截图 + 导出引擎状态，
// 用来亲眼确认「模型变样」的实际表现。用法：D:\nodejs\node.exe scripts\model-look-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); // node ≥22 全局 WebSocket
    this.id = 0; this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  async connect() { await this.ready; }
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
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-look-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1500,950', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, PAGE_URL], { stdio: 'ignore', windowsHide: true });
  let cdp;
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} if (i === 59) throw new Error('Chrome 起不来'); }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page' && x.url.startsWith('file:')); if (target) break; await sleep(300); }
    if (!target) throw new Error('找不到页面');
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.evaluate('window.__p3dDebug ? 1 : 0');
    // 等面板就绪（模型加载完）
    const t0 = Date.now();
    for (;;) {
      const st = await cdp.evaluate('(function(){ try { var d=window.__p3dDebug(); return d && d.ready ? JSON.stringify(d) : null; } catch(e){ return null; } })()').catch(() => null);
      if (st) { console.log('面板状态:', st); break; }
      if (Date.now() - t0 > 45000) throw new Error('等 3D 面板就绪超时');
      await sleep(500);
    }
    await sleep(2500); // 让 tick 跑几帧
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(__dirname, '..', 'model-look.tmp.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('截图已存:', out);
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    if (cdp && cdp.ws) try { cdp.ws.close(); } catch (e) {}
  }
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
