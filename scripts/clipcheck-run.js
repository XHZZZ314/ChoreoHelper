/* clipcheck-run.js —— 无头 Chrome 跑诊断验收页（clip-check.html / mode-check.html 等），可重复
这个文件是干嘛的：
  以前跑 clip-check 要手工开无头 Chrome 看标题；本脚本把它自动化：
  启动隔离 profile 的无头 Chrome → 打开指定验收页 → 轮询 document.title 直到出现
  PASS / FAIL（CLIP-PASS、MODE-PASS、CLIP-FAIL:n 等）→ 打印页面日志正文 → 退出码=失败数。
  默认跑【游戏目录部署位】的 clip-check.html——顺带验证部署位文件真的换新了（WP-3b 的教训：
  不能只看 PASS 字样，要确认跑的是新页面）。
用法：
  D:\nodejs\node.exe scripts\clipcheck-run.js                        （默认：游戏目录 clip-check）
  D:\nodejs\node.exe scripts\clipcheck-run.js web\dist\ChoreoHelper\mode-check.html   （指定页）
  D:\nodejs\node.exe scripts\clipcheck-run.js --scenario multidancer （场景模式：直接在本地
     dist 双胞胎的真实主页上跑注册好的交互场景，不经验收页；隔离 profile 无用户数据）
  参数也可以是完整 file:// URL。
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const vclean = require('./verify-cleanup'); // 四条退出路径清理 + 启动清扫上次残留（见文件头注释）
const GAME_DIR = 'D:\\Program Files\\上海数龙科技有限公司\\最终幻想XIV\\game\\dist\\ChoreoHelper';

const argvAll = process.argv.slice(2);
let scenarioName = null;
const scIdx = argvAll.indexOf('--scenario');
if (scIdx >= 0) { scenarioName = argvAll[scIdx + 1]; argvAll.splice(scIdx, 2); }
const arg = argvAll[0];
let url;
if (scenarioName) url = null; // 场景模式：页面由场景注册表决定
else if (!arg) url = 'file:///' + path.join(GAME_DIR, 'clip-check.html').replace(/\\/g, '/');
else if (/^file:\/\//.test(arg) || /^http/.test(arg)) url = arg;
else url = 'file:///' + path.resolve(arg).replace(/\\/g, '/');

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, err } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      }
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  send(method, params) {
    // HYGIENE(AC-10)：每条 CDP 命令 15s 硬超时——Chrome 不回包（崩溃/卡死）时明确报错退出，
    // 不再无限悬挂；正常命令远低于该上限，零影响
    return this.ready.then(() => new Promise((ok, err) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) err(new Error('CDP 命令超时(15s): ' + method));
      }, 15000);
      this.pending.set(id, {
        ok: (v) => { clearTimeout(timer); ok(v); },
        err: (e) => { clearTimeout(timer); err(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    }));
  }
  async evaluate(expr, awaitPromise) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// —— 场景注册表（--scenario <名字>）：在隔离 profile 的无头 Chrome 里打开本地 dist 双胞胎的
// 真实主页，等 appReady 后注入场景函数跑交互断言。场景函数必须自包含（toString 后注入页面，
// 不许引用本文件闭包）；页面是本地仓库双胞胎，绝不写两个 live 部署根。
// multidancer（TASK-20260831-MULTI-DANCER-EDIT）：整轨复制（确认/取消/一步撤销）+
// 添加到全部舞者（真实 .act-item 点击、齐奏同刻、按职业切职业、冲突只顺延自己、一步撤销）+
// 单舞者等价性（AC-3/4/5/6/7 的浏览器证据）。
function multidancerScenario() {
  return (async function () {
    var passes = 0, fails = 0, log = [];
    try { return await run(); }
    catch (e) { // 断言中途炸掉也要把已收集的日志带回来
      fails++;
      log.push('  ✘ 场景异常：' + (e && e.message ? e.message : String(e)));
      return { passes: passes, fails: fails, log: log };
    }
    function L(t) { log.push(t); }
    function ok(name, cond, detail) {
      if (cond) { passes++; log.push('  ✔ ' + name + (detail ? '（' + detail + '）' : '')); }
      else { fails++; log.push('  ✘ ' + name + (detail ? '（' + detail + '）' : '')); }
    }
    async function run() {
    function firstByName(di, name) {
      var d = window.store.dancers[di];
      return d.actionClips.filter(function (c) { return c.data.name === name; })[0] || null;
    }
    function snapAllClips() { // 全项目既有条：id -> start/duration/所在轨（不依赖 id 顺序）
      var m = {};
      window.store.dancers.forEach(function (d) {
        ['switchClips', 'actionClips', 'lyricClips'].forEach(function (k) {
          (d[k] || []).forEach(function (c) { m[c.id] = c.start + '/' + c.duration + '/' + k; });
        });
      });
      return m;
    }
    var w = window, s = w.store, doc = w.document;
    var ITEM = { name: '测试动作', command: '/test_md', category: 'usual', jobName: '骑士', jobId: 'T1', duration: 2 };

    // —— 准备：三位舞者，舞者1 三轨齐全，职业各不相同
    w.setDancerCount(3);
    s.dancers[0].currentJob = '骑士';
    s.dancers[0].switchClips.push({ id: s.nextClipId++, start: 0, duration: 0.5, autoDur: false, data: { name: '切换: 骑士', command: '/jobchange T1', category: '切换', isJobSwitch: true, jobName: '骑士', jobId: 'T1' } });
    s.dancers[0].actionClips.push({ id: s.nextClipId++, start: 5, duration: 3, autoDur: false, data: { name: '挥剑', command: '/sword', category: 'usual' } });
    s.dancers[0].lyricClips.push({ id: s.nextClipId++, start: 12, duration: 3, autoDur: false, data: { name: '台词', command: '/y hi', category: 'lyric', isLyric: true } });
    s.dancers[1].currentJob = '武僧';
    s.dancers[2].currentJob = '';
    s.jobMap = { T1: { name: '骑士', command: '/jobchange T1' }, T2: { name: '武僧', command: '/jobchange T2' } };
    w.render();

    L('== 复制入口与菜单 ==');
    var copyBtns = doc.querySelectorAll('#lanes .dancer-grp .dh-copy');
    ok('每位舞者行头有 ⧉ 复制入口', copyBtns.length === 3, '实际=' + copyBtns.length);
    copyBtns[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    var ctx = doc.getElementById('ctxMenu');
    ok('点舞者3 的 ⧉ 弹出菜单且列 2 个源（自己不出现）',
      ctx.classList.contains('show') && ctx.querySelectorAll('.ctx-it').length === 2
      && ctx.textContent.indexOf('舞者3') < 0, '项数=' + ctx.querySelectorAll('.ctx-it').length);
    ctx.classList.remove('show');

    L('== AC-3 确认对话框：取消零改动 / 确认整体替换 ==');
    s.dancers[1].actionClips.push({ id: s.nextClipId++, start: 0, duration: 2, autoDur: false, data: { name: '已有', command: '/old', category: 'usual' } });
    w.render();
    var snapD1 = JSON.stringify(s.dancers[1]);
    var confirmBak = w.confirm, askedText = null;
    w.confirm = function (msg) { askedText = msg; return false; };
    w.copyDancerTracksFrom(1, 0);
    ok('AC-3 非空目标弹确认（提示会替换）', !!askedText && askedText.indexOf('替换') >= 0, askedText || '没弹');
    ok('AC-3 取消后目标零改动', JSON.stringify(s.dancers[1]) === snapD1);
    w.confirm = function () { return true; };
    var snapSrc = JSON.stringify(s.dancers[0]);
    w.copyDancerTracksFrom(1, 0);
    var d1 = s.dancers[1];
    ok('AC-1 确认后三轨=源深拷贝（条数 1/1/1，start/duration/data 一致，fresh id）',
      d1.switchClips.length === 1 && d1.actionClips.length === 1 && d1.lyricClips.length === 1
      && d1.actionClips[0].id !== s.dancers[0].actionClips[0].id
      && d1.actionClips[0].start === 5 && d1.actionClips[0].duration === 3 && d1.actionClips[0].data.name === '挥剑'
      && d1.switchClips[0].start === 0 && d1.lyricClips[0].start === 12 && d1.lyricClips[0].data.command === '/y hi');
    ok('AC-1 currentJob 跟源（武僧→骑士）', d1.currentJob === '骑士');
    ok('AC-1 源零改动', JSON.stringify(s.dancers[0]) === snapSrc);
    var nameD1 = d1.name, muteD1 = d1.mute;
    ok('AC-1 目标的名字/静音等自身状态不动', nameD1 === '舞者2' && muteD1 === d1.mute);

    L('== AC-7a 一步撤销整次复制 ==');
    s.dancers[1] = JSON.parse(snapD1); // 先复原到复制前的「已有」状态（AC-3 段的确认复制留着摊）
    var snapBeforeCopy = JSON.stringify(s.dancers[1]);
    s.history = []; s.historyIdx = -1;
    w.saveHistory(); // 基线=复制前（舞者2 只有「已有」）
    w.copyDancerTracksFrom(1, 0);
    ok('前置：复制已发生', firstByName(1, '挥剑') !== null);
    w.undo();
    ok('AC-7 一次 undo 整步还原复制', JSON.stringify(s.dancers[1]) === snapBeforeCopy,
      '现在=' + JSON.stringify(s.dancers[1].actionClips.map(function (c) { return c.data.name; })));

    L('== AC-4 添加到全部舞者：真实侧栏点击 → 齐奏同刻 + 按各职业切职业 ==');
    s.actions.unshift(ITEM); // 放最前：skill-all 只列 slice(0,400)，目录快照满员时 push 到尾部会被截掉
    s.activeTab = 'skill-all';
    var cb = doc.querySelector('.act-list input[type=checkbox]');
    ok('侧栏出现「添加到全部舞者」开关', !!cb);
    if (cb) cb.click();
    ok('开关置位（会话级）', s.addToAll === true);
    w.render();
    var actItems = Array.prototype.filter.call(doc.querySelectorAll('.act-item'), function (n) {
      return n.querySelector('.ai-name').textContent === '测试动作';
    });
    ok('侧栏找到测试动作', actItems.length === 1, '实际=' + actItems.length);
    actItems[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // selectedDancer=0 → st=舞者1动作轨末=8
    var a0 = firstByName(0, '测试动作'), a1 = firstByName(1, '测试动作'), a2 = firstByName(2, '测试动作');
    ok('AC-4 三位舞者同一时刻（8s）拿到动作', !!a0 && !!a1 && !!a2 && a0.start === 8 && a1.start === 8 && a2.start === 8,
      '实际=' + [a0, a1, a2].map(function (c) { return c ? c.start : '无'; }).join('/'));
    ok('AC-4 自动切职业按各自职业：舞者1 不切，舞者2/3 各插 0.5s 切职业（结束于动作开始）',
      s.dancers[0].switchClips.length === 1
      && s.dancers[1].switchClips.length === 1 && s.dancers[1].switchClips[0].start === 7.5 && s.dancers[1].switchClips[0].duration === 0.5 && s.dancers[1].switchClips[0].data.isJobSwitch
      && s.dancers[2].switchClips.length === 1 && s.dancers[2].switchClips[0].start === 7.5);
    ok('AC-4 切职业后 currentJob 归骑士', s.dancers[1].currentJob === '骑士' && s.dancers[2].currentJob === '骑士');

    L('== AC-5 冲突只顺延自己：其余保持请求起点，既有条零变化，toast 点名 ==');
    s.dancers[2].currentJob = '武僧'; // 再制造一位要切职业的
    s.dancers[2].actionClips.push({ id: s.nextClipId++, start: 6, duration: 8, autoDur: false, data: { name: '长条', command: '/long', category: 'usual' } }); // 压住 [7.5,8) 切职业窗
    w.render();
    var before5 = snapAllClips();
    var st5 = (function () { // 请求起点=选中舞者（舞者1）动作轨末端，与点击路径同口径
      var lastEnd = 0;
      s.dancers[0].actionClips.forEach(function (c) { var e2 = c.start + c.duration; if (e2 > lastEnd) lastEnd = e2; });
      return lastEnd;
    })();
    actItems = Array.prototype.filter.call(doc.querySelectorAll('.act-item'), function (n) {
      return n.querySelector('.ai-name').textContent === '测试动作';
    });
    actItems[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    var lastOf = function (di) { // 取这一轮新加的（最后一条）测试动作
      var arr = s.dancers[di].actionClips.filter(function (c) { return c.data.name === '测试动作'; });
      return arr[arr.length - 1] || null;
    };
    var b0 = lastOf(0), b1 = lastOf(1), b2 = lastOf(2);
    ok('AC-5 空闲舞者保持请求起点（' + st5 + 's），冲突舞者（舞者3）顺延', !!b0 && !!b1 && !!b2 && b0.start === st5 && b1.start === st5 && b2.start > st5,
      '实际=' + [b0, b1, b2].map(function (c) { return c ? c.start : '无'; }).join('/'));
    var after5 = snapAllClips();
    var moved = Object.keys(before5).filter(function (id) { return after5[id] !== before5[id]; });
    ok('AC-5 既有条 start/duration 零变化（id 级比对）', moved.length === 0, '变动=' + moved.join(','));
    ok('AC-5 toast 点名顺延舞者', doc.getElementById('toast').textContent.indexOf('舞者3') >= 0,
      doc.getElementById('toast').textContent);

    L('== AC-7b 一步撤销整次添加到全部 ==');
    var snapB4 = JSON.stringify(s.dancers);
    s.history = []; s.historyIdx = -1;
    w.saveHistory();
    actItems = Array.prototype.filter.call(doc.querySelectorAll('.act-item'), function (n) {
      return n.querySelector('.ai-name').textContent === '测试动作';
    });
    actItems[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    ok('前置：三位舞者又各得一条', !!firstByName(0, '测试动作') && !!firstByName(1, '测试动作') && !!firstByName(2, '测试动作'));
    w.undo();
    ok('AC-7 一次 undo 整步还原添加到全部', JSON.stringify(s.dancers) === snapB4);

    L('== AC-6 单舞者等价：开关开 = 现有单舞者添加逐字段一致 ==');
    w.setDancerCount(1);
    function resetSolo() {
      s.dancers[0].switchClips = []; s.dancers[0].actionClips = []; s.dancers[0].lyricClips = [];
      s.dancers[0].currentJob = ''; s.globalLyrics = []; s.markers = []; s.selectedClip = null;
    }
    function soloResult() { // 结果快照：不含 id（两次运行 id 必然不同）
      var d = s.dancers[0];
      return JSON.stringify({
        sw: d.switchClips.map(function (c) { return [c.start, c.duration, c.data.isJobSwitch, c.data.jobName]; }),
        ac: d.actionClips.map(function (c) { return [c.start, c.duration, c.autoDur, c.data.name, c.data.command, c.data.jobName]; }),
        job: d.currentJob,
      });
    }
    resetSolo(); s.addToAll = false; w.render();
    actItems = Array.prototype.filter.call(doc.querySelectorAll('.act-item'), function (n) {
      return n.querySelector('.ai-name').textContent === '测试动作';
    });
    actItems[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    var soloOff = soloResult();
    resetSolo(); s.addToAll = true; w.render();
    actItems = Array.prototype.filter.call(doc.querySelectorAll('.act-item'), function (n) {
      return n.querySelector('.ai-name').textContent === '测试动作';
    });
    actItems[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    var soloOn = soloResult();
    ok('AC-6 单舞者 + 开关开：切职业/动作落位逐字段一致（含 autoDur 与 0 秒起点让位）', soloOff === soloOn,
      soloOff + ' vs ' + soloOn);

    w.confirm = confirmBak;
    return { passes: passes, fails: fails, log: log };
    }
  })();
}

const SCENARIOS = {
  multidancer: {
    page: path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html'),
    ready: '!!(window.store&&store.appReady&&document.querySelector(".act-list"))',
    script: multidancerScenario,
  },
};

(async function main() {
  const scenario = scenarioName ? SCENARIOS[scenarioName] : null;
  if (scenarioName && !scenario) throw new Error('未知场景：' + scenarioName + '（可用：' + Object.keys(SCENARIOS).join(', ') + '）');
  if (scenario) url = 'file:///' + path.resolve(scenario.page).replace(/\\/g, '/');
  const swept = vclean.sweepAll();
  if (swept) console.log('[verify-cleanup] 启动清扫：清掉上次残留 ' + swept + ' 个临时目录');
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcheck-run-'));
  const proc = spawn(exe, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    // file:// 父页要跨源读 iframe（w.store）——没有这个 flag 验收页永远等不到主页就绪
    '--allow-file-access-from-files',
    '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, url,
  ], { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile); // 登记：正常/Ctrl+C/异常/exit 四条路径都会清
  const kill = () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  try {
    let targets = null;
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/json/version');
        if (r.ok) { targets = true; break; }
      } catch (e) { /* 还没起来 */ }
    }
    if (!targets) throw new Error('Chrome 调试口起不来');
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page' && decodeURIComponent(x.url).replace(/\/$/, '') === decodeURIComponent(url));
      if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
      await sleep(300);
    }
    if (!wsUrl) throw new Error('找不到页面 target：' + url);
    const cdp = new Cdp(wsUrl);
    if (scenario) {
      // 场景模式：等真实主页就绪（appReady + 侧栏），注入自包含场景函数跑断言
      let ready = false;
      for (let i = 0; i < 240 && !ready; i++) {
        ready = await cdp.evaluate(scenario.ready).catch(() => false);
        if (!ready) await sleep(500);
      }
      if (!ready) throw new Error('主页未就绪（appReady/侧栏超时）');
      const res = await cdp.evaluate('(' + scenario.script.toString() + ')()', true);
      const out = res && res.log ? res : { passes: 0, fails: 1, log: ['场景未返回结果：' + JSON.stringify(res)] };
      out.log.forEach((line) => console.log(line));
      console.log('[scenario:' + scenarioName + '] ' + out.passes + ' 过 / ' + out.fails + ' 败');
      process.exitCode = out.fails ? 1 : 0;
      return;
    }
    // 等标题置位（各验收页结束时写 PASS/FAIL），最长 4 分钟
    const title = await (async () => {
      for (let i = 0; i < 480; i++) {
        const v = await cdp.evaluate('document.title').catch(() => null);
        if (v && /PASS|FAIL/.test(v)) return v;
        await sleep(500);
      }
      throw new Error('等待超时：标题一直没置位（页面没跑完？）');
    })();
    console.log('标题: ' + title);
    const log = await cdp.evaluate('(document.getElementById("log")||document.body).textContent').catch(() => '(取不到日志)');
    console.log(log);
    process.exitCode = /FAIL/.test(title) ? 1 : 0;
  } finally { kill(); }
})().catch((e) => { console.error('[clipcheck-run] ' + e.message); process.exitCode = 1; });
