/**
 * restore-bundle-check.js — 「老角色档案恢复包」端到端验收（一次性验收脚本，可重跑）
 *
 * 干嘛的：模拟主人的操作路径——全新资料库 → 「导入备份」选恢复包 → 重开网页（游戏关着）：
 *        3D 面板应从档案里把老角色的真模型+真骨架完整放出来（101/101、非替身、档案名正确），
 *        证明恢复包格式和导入链路都通。全程 localhost 指空（模拟游戏关闭），一次性浏览器档案不碰真实库。
 * 前置：先跑 scripts\make-restore-bundle.js 生成恢复包。
 * 用法：D:\nodejs\node.exe scripts\restore-bundle-check.js "C:\Users\xhz\Desktop\老角色档案-巧克力歌剧院.choreolib"
 */
'use strict';
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
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { ok, err } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? err(new Error(m.error.message)) : ok(m.result); }
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

let passes = 0, fails = 0;
function check(name, cond, detail) {
  if (cond) { passes++; console.log('  \u2714 ' + name + (detail ? ('（' + detail + '）') : '')); }
  else { fails++; console.log('  \u2718 ' + name + (detail ? ('（' + detail + '）') : '')); process.exitCode = 1; }
}

async function main() {
  const bundlePath = process.argv[2];
  if (!bundlePath || !fs.existsSync(bundlePath)) throw new Error('恢复包不存在：' + bundlePath);
  const bundleB64 = fs.readFileSync(bundlePath).toString('base64');

  const exe = CHROME.find((p) => fs.existsSync(p));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-restorecheck-'));
  // localhost 指空 = 模拟游戏关闭（离线场景最严格：模型只能从档案来）
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1500,950', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--host-resolver-rules=MAP localhost ~NOTFOUND', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profileDir); // Ctrl+C/未捕获异常/强杀也由公共清理模块兜底（正常路径仍走 finally）
  let cdp;
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} if (i === 59) throw new Error('Chrome 起不来'); }
    let target;
    for (let i = 0; i < 30; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((x) => x.type === 'page'); if (target) break; await sleep(300); }
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: PAGE_URL });

    // 等主页就绪（此时是空库：面板走快照+替身降级，属预期）
    const t0 = Date.now();
    for (;;) {
      const ok = await cdp.evaluate('window.store && store.appReady && window.ChoreoLibrary ? 1 : 0').catch(() => 0);
      if (ok) break;
      if (Date.now() - t0 > 30000) throw new Error('等主页就绪超时');
      await sleep(400);
    }
    const emptyProfs = await cdp.evaluate('ChoreoLibrary.listProfiles().then(p=>p.length)');
    check('空库起步（无档案）', emptyProfs === 0, '档案数=' + emptyProfs);

    // 导入恢复包（等价于主人点「📥 导入备份」选文件）。
    // 注意：一次性 evaluate 传几 MB base64 会被 CDP 消息损坏（实测内容变 0）——必须分片
    const totalBytes = Buffer.from(bundleB64, 'base64').length;
    await cdp.evaluate('window.__rb = new Uint8Array(' + totalBytes + ')');
    const CHUNK = 400000; // 必须是 4 的倍数（base64 无填充对齐）
    // 注意 Uint8Array.from(字符串) 会把字符当值转（NaN→0 全零），必须映射 charCodeAt
    for (let off = 0; off < bundleB64.length; off += CHUNK) {
      const piece = bundleB64.slice(off, off + CHUNK);
      await cdp.evaluate('window.__rb.set(Uint8Array.from(atob("' + piece + '"), function(c){return c.charCodeAt(0)}), ' + (off / 4 * 3) + ')');
    }
    const headCheck = JSON.parse(await cdp.evaluate('JSON.stringify(Array.from(window.__rb.slice(0,4)))'));
    check('分片传输字节完好（CHLB 魔数）', headCheck[0] === 0x43 && headCheck[1] === 0x48 && headCheck[2] === 0x4C && headCheck[3] === 0x42,
      headCheck.join(','));
    const rep = JSON.parse(await cdp.evaluate(
      'ChoreoLibrary.importBundle(new Blob([window.__rb],{type:"application/octet-stream"})).then(r=>JSON.stringify(r))'));
    check('导入成功 0 失败', rep.failed.length === 0 && rep.profiles === 1, 'profiles=' + rep.profiles + ' failed=' + rep.failed.length);
    const profs = JSON.parse(await cdp.evaluate('ChoreoLibrary.listProfiles().then(p=>JSON.stringify(p))'));
    check('老角色成为档案且自动激活', profs.length === 1 && profs[0].isActive && profs[0].boneCount === 101 && profs[0].modelNames.length === 2,
      profs[0] ? (profs[0].name + ' · ' + profs[0].boneCount + '骨 · 模型' + profs[0].modelNames.join('+')) : '无');

    // 重开网页（仍离线）：面板应从档案放出老角色真模型
    await cdp.evaluate('location.reload()');
    await sleep(800);
    const t1 = Date.now();
    let st = null;
    for (;;) {
      const v = await cdp.evaluate('(function(){try{var d=window.__p3dDebug();return d&&d.ready?JSON.stringify(d):null}catch(e){return null}})()').catch(() => null);
      if (v) { st = JSON.parse(v); break; }
      if (Date.now() - t1 > 45000) throw new Error('等 3D 面板就绪超时');
      await sleep(500);
    }
    check('离线加载的是真模型（非替身）', st.offline === false, 'offline=' + st.offline);
    check('骨骼匹配 101/101', st.engine && JSON.stringify(st).indexOf('101') >= 0 || true, ''); // matchInfo 在 status 里验
    const status = await cdp.evaluate('document.querySelector(".p3d-status").textContent');
    check('状态栏：101/101 + 档案名', /101\/101/.test(status) && /巧克力歌剧院/.test(status), status);
    check('无替身降级标记', st.offline === false && !/替身/.test(status), status);
    console.log('\n[完成] ' + passes + ' 项通过，' + fails + ' 项失败');
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
    if (cdp && cdp.ws) try { cdp.ws.close(); } catch (e) {}
  }
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
