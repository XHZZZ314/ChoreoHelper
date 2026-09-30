// 一次性验证脚本（验证完删除）：FIX-1 AUD-012 网页端失败提示
// 游戏在线时无头打开真实主页 → 切游戏模式 → 空时间轴点播放 →
// 断言：不进播放态 + 弹「游戏没动」中文提示（服务端现在回 400+中文，旧版是 200 假成功）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vclean = require('./verify-cleanup'); // HYGIENE(AC-11)：四条退出路径统一清理临时 profile

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
  .find((p) => fs.existsSync(p));
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
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
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}

(async () => {
  const exe = CHROME;
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-fix1web-'));
  const proc = spawn(exe, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, PAGE_URL,
  ], { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile); // Ctrl+C/未捕获异常/强杀也由公共清理模块兜底（正常路径仍走下面 finally 的 kill()）
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

    // 等编辑器就绪 + 插件连接（游戏在线，probeGame 应成功）
    for (let i = 0; i < 60; i++) {
      const okState = await cdp.evaluate("typeof store!=='undefined' && store.appReady && store.gameConnected").catch(() => null);
      if (okState) break;
      await sleep(500);
      if (i === 59) throw new Error('等待 appReady+gameConnected 超时');
    }
    const conn = await cdp.evaluate("store.gameConnected + '/' + (store.pairToken||'')");
    console.log('  连接状态: gameConnected/pairToken =', conn);

    // 种配对码（配对头必需，否则 403 而不是我们要测的 400）
    await cdp.evaluate("store.pairToken=normToken('3YMZ2KZM');undefined");

    // 空时间轴（新开 profile 无草稿 → 默认空项目）走游戏模式播放
    // showToast 先包一层记录所有消息（自动同步等后台提示会顶掉 #toast 文本，不能只看最终值）
    await cdp.evaluate("window.__toasts=[];var _st=showToast;showToast=function(m){window.__toasts.push(String(m));_st(m)};store.previewTarget='game'; gameStartPlay(); undefined");
    await sleep(2500);

    const isPlaying = await cdp.evaluate("store.isPlaying");
    const toasts = await cdp.evaluate("(window.__toasts||[]).join(' | ')");
    const okPlaying = isPlaying === false;
    const okToast = toasts.indexOf('游戏没动') >= 0;
    console.log((okPlaying ? '  ✔ ' : '  ✘ ') + '空时间轴播放后不进播放态（isPlaying=' + isPlaying + '）');
    console.log((okToast ? '  ✔ ' : '  ✘ ') + '弹出中文失败提示（toasts="' + toasts.slice(0, 200) + '"）');
    console.log((okPlaying && okToast) ? 'FIX1-WEB-PASS' : 'FIX1-WEB-FAIL');
  } finally {
    kill();
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
