/* 一次性调试：无头 Chrome 跑 dist clip-check.html，打印标题和日志（用完即删） */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const PAGE_URL = 'http://localhost:48795/clip-check.html';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, err } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      }
    };
  }
  send(method, params) {
    return this.ready.then(() => new Promise((ok, err) => {
      const id = ++this.id;
      this.pending.set(id, { ok, err });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    }));
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'PAGE-ERR: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text);
    return r.result ? r.result.value : undefined;
  }
}

(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-ccdbg-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, PAGE_URL,
  ], { stdio: 'ignore', windowsHide: true });
  const kill = () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  try {
    let wsUrl = null;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      await sleep(300);
      try {
        const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        const t = list.find((x) => x.type === 'page' && x.url.startsWith('file:'));
        if (t) wsUrl = t.webSocketDebuggerUrl;
      } catch (e) {}
    }
    if (!wsUrl) throw new Error('找不到页面 target');
    const cdp = new Cdp(wsUrl);
    await cdp.send('Runtime.enable');
    // 等结果标题（PASS/FAIL）或超时
    let title = '';
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      title = await cdp.evaluate('document.title').catch((e) => 'EVAL-ERR ' + e.message);
      if (/CLIP-PASS|CLIP-FAIL/.test(title)) break;
    }
    console.log('TITLE:', title);
    // 打印日志尾部 + 抓 iframe 内的状态
    const log = await cdp.evaluate("document.getElementById('log').textContent");
    console.log('LOG-TAIL:\n' + log.split('\n').slice(-25).join('\n'));
    const inner = await cdp.evaluate("(function(){try{var w=document.getElementById('f').contentWindow;return 'innerTitle='+w.document.title}catch(e){return 'inner-err '+e.message}})()");
    console.log(inner);
  } finally {
    kill();
  }
})().catch((e) => { console.error('DBG-FAIL:', e.message); process.exit(1); });
