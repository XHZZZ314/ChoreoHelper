// offline-verify.js — 阶段 2「网页脱离插件启动」的可重复验收脚本（无头 Chrome + CDP）
//
// 干嘛的：用无头 Chrome 实测三个场景（游戏实际在线与否都不影响跑）：
//   offline     模拟游戏关闭（--host-resolver-rules 把 localhost 解析指空），file:// 双击打开主页：
//               编辑器渲染、草稿恢复、目录来自内置快照、3D 面板自动开且显示替身模型、网页播放可用
//   online      file:// 打开主页但游戏在线：连接成功、目录来自线上、真模型真骨架就绪
//   transition  同一页面先断网（CDP 屏蔽 48794/48795）再放开：连接状态自动刷新、
//               快照目录升级成线上目录、3D 面板从替身自动升级真模型、全程不丢草稿
//   mode-check / clip-check  两个既有诊断页回归（标题含 PASS 即过）
//   initrace   3D 面板初始化挂起时切档案：过期 init 必须作废、新 init 接管（FIX-I/PREVIEW-1）
// 怎么跑：D:\nodejs\node.exe scripts\offline-verify.js            （全部场景）
//        D:\nodejs\node.exe scripts\offline-verify.js offline     （只跑单个场景）
// 依赖：本机 Chrome（默认装在 Program Files）；node ≥22（用全局 WebSocket）；游戏开不开都行。

'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vclean = require('./verify-cleanup'); // 四条退出路径清理 + 启动清扫上次残留（见文件头注释）

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const PAGE_URL = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');

// SEC-1：48795 私有读要配对码。[online]/[transition] 打的是真插件，脚本从本机
// pairing.json（首次生成后永久不变）读真码，在页面任何脚本跑起来之前种进 localStorage
// ——等价主人粘过一次码的日常环境。码只进本机临时浏览器配置，绝不写进日志/文档。
function readPairingCode() {
  try {
    const p = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).code || '';
  } catch (e) { return ''; }
}

// 跟真实使用一致的样例草稿：1 舞者 + /bow 动作条（2s 起 3s 长）
const SAMPLE_DRAFT = {
  dancers: [{
    id: 0, name: '舞者 1', color: '#7eb3ff', switchClips: [], collapsed: false, laneScale: 1, currentJob: null,
    actionClips: [{ id: 1, start: 2, duration: 3, autoDur: false, data: { id: 0, name: '鞠躬', command: '/bow', category: 'usual', jobName: '', jobId: 0, jobAbbr: '' } }],
    lyricClips: [],
  }],
  dancerCount: 1, showLyricMacro: false, totalDuration: 300,
};

// ---------- 极简 CDP 客户端 ----------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.exceptions = [];
    this.onEvent = null; // modelswitch 场景用：Fetch.requestPaused 等事件的分发口
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, err } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails);
      } else if (m.method && this.onEvent) {
        this.onEvent(m);
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
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function waitFor(cdp, what, expr, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    const v = await cdp.evaluate(expr).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时(' + (timeoutMs / 1000) + 's): ' + what);
    await sleep(intervalMs || 400);
  }
}

// ---------- 无头 Chrome 实例 ----------
async function launchChrome(extraArgs, openUrl) {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome（找过 Program Files 两个位置）');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-verify-'));
  const args = [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
  ].concat(extraArgs || []);
  if (openUrl) args.push(openUrl);
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile); // 登记：正常/Ctrl+C/异常/exit 四条路径都会清（finally 只是常规路径）
  // 等调试口就绪
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) break;
    } catch (e) { /* 还没起来 */ }
    if (i === 59) { kill(); throw new Error('Chrome 调试口起不来'); }
  }
  async function pageTarget() {
    for (let i = 0; i < 30; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page' && (x.url.startsWith('file:') || x.url.startsWith('http://localhost:48795/')));
      if (t) return new Cdp(t.webSocketDebuggerUrl);
      await sleep(300);
    }
    throw new Error('找不到页面 target');
  }
  // 不限起始 URL 的页面 target（about:blank 也算）：配合 addScriptToEvaluateOnNewDocument +
  // Page.navigate，让配对码种子赶在页面任何脚本之前生效
  async function pageTargetAny() {
    for (let i = 0; i < 30; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page');
      if (t) return new Cdp(t.webSocketDebuggerUrl);
      await sleep(300);
    }
    throw new Error('找不到页面 target');
  }
  function kill() {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  return { pageTarget, pageTargetAny, kill, port };
}

// ---------- 断言工具 ----------
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (detail ? '（' + detail + '）' : ''));
  if (!ok) process.exitCode = 1;
}

// 载入样例草稿并重载（WP-3 起经页面钩子把草稿造成项目再刷新——直接灌 choreo_draft 会被迁移标志挡住）
async function seedDraftAndReload(cdp) {
  await cdp.send('Page.enable');
  await waitFor(cdp, '编辑器就绪(灌种子前)', 'window.store && store.appReady && window.__projTest', 20000);
  await cdp.evaluate('window.__projTest.seedFromDraft(' + JSON.stringify(SAMPLE_DRAFT) + ')');
  await cdp.evaluate('location.reload()');
}

// ---------- 各场景 ----------
async function scenarioOffline() {
  console.log('[offline] 模拟游戏关闭（localhost 指空）+ file:// 双击打开主页');
  const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND'], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    check('编辑器渲染（动作面板存在）', await cdp.evaluate('!!document.querySelector(\'.act-list\')'));
    check('草稿恢复（/bow 动作条回来了）', await cdp.evaluate('store.dancers[0].actionClips.length===1'));
    check('游戏状态=未连接', await cdp.evaluate('store.gameConnected===false'));
    check('目录来自内置快照', await cdp.evaluate('store.catalogFromSnapshot===true'), await cdp.evaluate('store.emotes.length') + ' 表情');
    const d = await waitFor(cdp, '3D 面板就绪（替身模型）', 'window.__p3dDebug && __p3dDebug().ready', 45000, 500);
    check('3D 面板自动打开且就绪', !!d);
    check('3D 处于离线降级（替身模型+快照骨架）', await cdp.evaluate('__p3dDebug().offline===true'));
    const st = await cdp.evaluate('document.querySelector(\'.p3d-status\').textContent');
    check('骨架匹配 101/101（快照+替身）', /101\/101/.test(st), st);
    // 网页播放：起播→播放头走→停止归零
    // HYGIENE(AC-2)：#playOverlay 稳态播放期零 childList 改写（脏检查缓存生效），
    // 条目集合变化（进入/离开边界）时恰整一次重写。样例条 /bow 在 2~5s 活跃。
    // 观察口挂在 body 上过滤 target 为 #playOverlay 的记录：render() 会重建该节点，
    // 起播后 ~800ms 的体检 render 会换一次节点，等它过去（t≥1.4）再挂观察、从零计数
    check('网页播放立即起播', await cdp.evaluate('togglePlay(); store.previewTarget + \'/\' + store.isPlaying') === 'web/true');
    await waitFor(cdp, '起播初期动静过去（体检 render 落定）', 'store.currentTime>=1.4 && store.isPlaying', 8000, 100);
    await cdp.evaluate('(function(){window.__poMut={n:0};new MutationObserver(function(muts){'
      + 'for(var i=0;i<muts.length;i++){var tn=muts[i].target;if(tn&&tn.id===\'playOverlay\')window.__poMut.n++}})'
      + '.observe(document.body,{childList:true,subtree:true});return 1})()');
    const baseMut = await cdp.evaluate('window.__poMut.n');
    await waitFor(cdp, '进入条目活跃区间（/bow 2~5s）', 'store.currentTime>=2.35 && store.isPlaying', 8000, 100);
    const t1 = await cdp.evaluate('store.currentTime');
    check('播放头在走', t1 > 1.5, 't=' + t1.toFixed(2) + 's');
    const enterMut = await cdp.evaluate('window.__poMut.n - ' + baseMut); // 进入边界恰一次重写
    const shownHtml = await cdp.evaluate('document.getElementById(\'playOverlay\').innerHTML');
    const shownItems = await cdp.evaluate('document.querySelectorAll(\'#playOverlay .po-item\').length');
    const expName = await cdp.evaluate('store.dancers[0].actionClips[0].data.name');
    check('进入边界恰一次重写', enterMut === 1, 'mutations=' + enterMut);
    check('活跃条目展示与旧实现一致（1 条 .po-item，含舞者名与条目名）',
      shownItems === 1 && shownHtml.indexOf('舞者 1') >= 0 && shownHtml.indexOf(expName) >= 0,
      shownItems + ' 条 · ' + expName);
    await waitFor(cdp, '稳态窗口结束（≥4.7s，条目集合不变）', 'store.currentTime>=4.7', 8000, 100);
    const steadyMut = await cdp.evaluate('window.__poMut.n - ' + baseMut);
    check('稳态播放零 childList 改写（60+ tick 不重写 DOM）', steadyMut === enterMut, enterMut + ' → ' + steadyMut);
    await waitFor(cdp, '越过离开边界（≥5.4s）', 'store.currentTime>=5.4', 8000, 100);
    await sleep(250); // 离开边界那一 tick 落定
    const exitMut = await cdp.evaluate('window.__poMut.n - ' + baseMut);
    const emptyShown = await cdp.evaluate('!!document.querySelector(\'#playOverlay .po-empty\')');
    check('离开边界恰一次重写并回到空态', exitMut === steadyMut + 1 && emptyShown === true, steadyMut + ' → ' + exitMut);
    await sleep(900);
    const exitSteadyMut = await cdp.evaluate('window.__poMut.n - ' + baseMut);
    check('离开后稳态同样零改写', exitSteadyMut === exitMut, exitMut + ' → ' + exitSteadyMut);
    await cdp.evaluate('stopPlay()');
    check('停止归零', await cdp.evaluate('store.currentTime') === 0);
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// OPT-2（AUD-018/020）：3D 面板性能与 GPU 生命周期。离线场景即可跑（替身模型）：
//   ① 静止时间轴连续 ~600 帧，引擎时间轴重排次数必须为 0（旧实现每帧全量重建）
//   ② 改一次内容 → 重排恰好发生；再静止 → 又是 0
//   ③ 连续 20 次 hardReset→init，GPU geometry/texture 计数不线性增长（dispose 生效）
async function scenarioPerf() {
  console.log('[perf] 3D 面板：静止时间轴零重排 + 20 次 reset GPU 资源不增长');
  const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND'], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '3D 面板就绪（替身模型）', 'window.__p3dDebug && __p3dDebug().ready', 45000, 500);
    await sleep(2000); // 等开局的探针/同步动静过去，从静止态开始采样
    const r0 = await cdp.evaluate('__p3dDebug().tlRebuilds');
    await sleep(2200); // ~130+ 帧 @60fps，覆盖 600 帧断言的等价窗口（无头帧率更低）
    const r1 = await cdp.evaluate('__p3dDebug().tlRebuilds');
    check('静止时间轴重排次数不增长（AUD-018 dirty 标记）', r1 - r0 === 0, r0 + ' → ' + r1);
    // 改一次内容（加一条动作 + render + bumpTimelineRev）→ 应重排；随后等实时体检（render
    // 后 800ms 防抖）的描边 render 也稳定，再确认真正静止 → 不再增长。
    // render() 不再自带 _tlRev++（界面重绘≠内容变化），补调产品自己的内容变化信号
    await cdp.evaluate('(function(){store.dancers[0].actionClips.push({id:store.nextClipId++,start:10,duration:2,autoDur:false,data:{name:"测",command:"/bow",category:"usual"}});bumpTimelineRev();render()})()');
    await sleep(2500);
    const r2 = await cdp.evaluate('__p3dDebug().tlRebuilds');
    check('内容变化后重排发生（编辑+体检描边 ≤3 次）', r2 - r1 >= 1 && r2 - r1 <= 3, r1 + ' → ' + r2);
    await sleep(1500);
    const r3 = await cdp.evaluate('__p3dDebug().tlRebuilds');
    check('改完后静止又归零增长', r3 - r2 === 0, r2 + ' → ' + r3);
    // AUD-020：连续 reset，GPU 计数不线性增长
    const g0 = await cdp.evaluate('(__p3dReset(), null)');
    await waitFor(cdp, 'reset#1 就绪', 'window.__p3dDebug && __p3dDebug().ready', 45000, 500);
    const gpu0 = await cdp.evaluate('__p3dDebug().gpu');
    for (let i = 2; i <= 20; i++) {
      await cdp.evaluate('__p3dReset()');
      await waitFor(cdp, 'reset#' + i + ' 就绪', 'window.__p3dDebug && __p3dDebug().ready', 45000, 500);
    }
    const gpuN = await cdp.evaluate('__p3dDebug().gpu');
    check('20 次 reset 后 GPU geometry 计数不增长（dispose 生效）',
      gpuN.geometries <= gpu0.geometries + 30, gpu0.geometries + ' → ' + gpuN.geometries);
    check('20 次 reset 后 GPU texture 计数不增长',
      gpuN.textures <= gpu0.textures + 30, gpu0.textures + ' → ' + gpuN.textures);
    // AUD2-012：12→1→12 舞者反复增减——局部删除路径也要 dispose（旧版只 scene.remove 不释放）
    const baseG = await cdp.evaluate('__p3dDebug().gpu');
    const growTo12 = '(function(){while(store.dancers.length<12)store.dancers.push({id:store.dancers.length,name:"d"+store.dancers.length,color:"#5dde8e",switchClips:[],actionClips:[],lyricClips:[],collapsed:false,laneScale:1,currentJob:null,solo:false,mute:false});store.dancerCount=12;render()})()';
    const shrinkTo1 = '(function(){while(store.dancers.length>1)store.dancers.pop();store.dancerCount=1;render()})()';
    for (let i = 0; i < 20; i++) {
      await cdp.evaluate(growTo12);
      await waitFor(cdp, '扩到 12 舞者#' + (i + 1), '__p3dDebug().rigs===12', 20000, 150);
      await cdp.evaluate(shrinkTo1);
      await waitFor(cdp, '缩回 1 舞者#' + (i + 1), '__p3dDebug().rigs===1', 20000, 150);
    }
    await sleep(400); // 等最后一帧渲染落定，GPU 计数稳定
    const cycG = await cdp.evaluate('__p3dDebug().gpu');
    check('12→1→12 舞者×20 后 GPU geometry 回稳（局部 dispose 生效）',
      cycG.geometries <= baseG.geometries + 30, baseG.geometries + ' → ' + cycG.geometries);
    check('12→1→12 舞者×20 后 GPU texture 回稳',
      cycG.textures <= baseG.textures + 30, baseG.textures + ' → ' + cycG.textures);
    // AUD2-012：标签页隐藏 → 渲染循环显式停止；恢复 → 立即重启（页内覆写 document.hidden 模拟，
    // 只验证 preview3d 自身的监听逻辑；rAF 隐藏时被浏览器挂起是浏览器行为，不在断言范围）
    await cdp.evaluate('(function(){Object.defineProperty(document,"hidden",{get:function(){return true},configurable:true});document.dispatchEvent(new Event("visibilitychange"));return 1})()');
    await sleep(300);
    check('标签页隐藏后渲染循环停止', await cdp.evaluate('__p3dDebug().tickOn') === false);
    await cdp.evaluate('(function(){Object.defineProperty(document,"hidden",{get:function(){return false},configurable:true});document.dispatchEvent(new Event("visibilitychange"));return 1})()');
    await sleep(200);
    check('恢复可见后渲染循环立即重启', await cdp.evaluate('__p3dDebug().tickOn') === true);
    // AUD2-012：DPR 封顶 2——3x 缩放下 renderer 像素比不超过 2（重载页面重建 renderer 实测）
    await cdp.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 3, width: 1400, height: 900, mobile: false });
    await cdp.evaluate('location.reload()');
    await waitFor(cdp, '编辑器就绪(DPR)', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '3D 面板就绪(DPR)', 'window.__p3dDebug && __p3dDebug().ready', 45000, 500);
    const dprHi = await cdp.evaluate('__p3dDebug().dpr');
    check('高 DPR 屏封顶 2（3x 缩放实测）', dprHi === 2, 'dpr=' + dprHi);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    check('全程无 JS 异常（含 reset 链路）', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// OPT-F（AUD2-012）：档案 A→B→A 切换的模型链路计数。CDP Fetch 拦截喂出「游戏骨架 A/B +
// 部署位模型 + 动作清单」，页面真跑 hardReset→init→loadModel：
//   骨架 A = 快照 101 骨（档案「角色 1」自动对号）；骨架 B = 快照+5 尾巴骨 106（档案「档案B」）
//   部署位 model.gltf = 替身改材质名（A 兼容被采用；对 B 明确不兼容→走档案模型）
//   档案B 自带 model.glb = 替身+5 尾巴节点（与 B 骨架兼容）
// 基线（优化前）每轮都重新 fetch/parse/hash/写库；验收：第二轮 A、第二轮 B parse=0、
// 写库=0、digest≤2（TASK-20260917-SKELETON-KEY-REPAIR 后骨架对号改结构指纹，每轮合法
// digest=整份诊断指纹 1 + 在线结构指纹 1；档案骨架结构指纹由库存 skeletonStructHash
// 播种缓存、模型 hash 0 次），并记录每轮耗时（先测量再优化，交接留前后数字）
async function scenarioModelSwitch() {
  console.log('[modelswitch] 档案 A→B→A→B：模型 fetch/parse/hash/写库 计数（AUD2-012）');
  // localhost 指空 + Fetch 拦截喂包（library-verify 同款手法）：场景封闭，不碰真插件；
  // 模块导入必失败 → 页面走经典库路径 → window.THREE 可计数包装
  const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND'], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const snapSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'skeleton-snapshot.js'), 'utf8');
    const snap = JSON.parse(snapSrc.match(/window\.__CHOREO_SKELETON_SNAPSHOT__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const standinSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'standin-model.js'), 'utf8');
    const standin = JSON.parse(standinSrc.match(/window\.__CHOREO_STANDIN_MODEL__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const skelB = JSON.parse(JSON.stringify(snap));
    ['a', 'b', 'c', 'd', 'e'].forEach((n, i) => { skelB.bones.push({ i: skelB.count + i, n: 'n_sippo_' + n, p: 0, t: [0, 0.5 + i * 0.1, 0.05], q: [0, 0, 0, 1] }); });
    skelB.count = skelB.bones.length;
    const modelB = JSON.parse(JSON.stringify(standin));
    for (let i = 0; i < 5; i++) {
      modelB.nodes.push({ name: 'n_sippo_' + ['a', 'b', 'c', 'd', 'e'][i], translation: [0, 0.5 + i * 0.1, 0.05], children: [] });
      if (modelB.skins && modelB.skins[0]) modelB.skins[0].joints.push(modelB.nodes.length - 1);
      // 节点必须挂进场景树，checkModelCompat 的 traverse 才看得到（挂 skins 不够）
      modelB.scenes[modelB.scene].nodes.push(modelB.nodes.length - 1);
    }
    const deployModel = JSON.parse(JSON.stringify(standin)); // 材质名改掉 = ≠内置替身（走真部署位路径）
    if (deployModel.materials && deployModel.materials[0]) deployModel.materials[0].name = 'deployVariant';

    let skelCurrent = 'A';
    const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64');
    await cdp.send('Fetch.enable', { patterns: [
      { urlPattern: '*://localhost:48795/export/skeleton', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.gltf', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.glb', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.bin', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/list', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/getclip*', stage: 'Request' },
    ] });
    cdp.onEvent = (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const u = m.params.request.url;
      const fulfill = (code, ctype, body) => cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: code,
        responseHeaders: [{ name: 'Content-Type', value: ctype }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: b64(body) }).catch(() => {});
      (async () => {
        if (u.indexOf('/export/skeleton') >= 0) await fulfill(200, 'application/json', JSON.stringify(skelCurrent === 'A' ? snap : skelB));
        else if (u.endsWith('/model.glb')) await fulfill(404, 'application/json', '{"error":"none"}');
        else if (u.endsWith('/model.gltf')) await fulfill(200, 'model/gltf', JSON.stringify(deployModel));
        else if (u.endsWith('/model.bin')) await fulfill(404, 'application/json', '{"error":"none"}');
        else if (u.indexOf('/export/list') >= 0) await fulfill(200, 'application/json', '{"clips":[]}');
        else await fulfill(200, 'application/json', '{"error":"none"}');
      })().catch(() => {});
    };

    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '3D 面板就绪（档案角色 1）', 'window.__p3dDebug && __p3dDebug().ready && __p3dDebug().profile && __p3dDebug().profile.name==="角色 1"', 60000, 500);
    // 造档案B（骨架 B + 自带兼容模型），然后才装计数器（建档的 hash 不计入）
    await cdp.evaluate('ChoreoLibrary.createProfile({ name: "档案B", skeleton: ' + JSON.stringify(skelB) +
      ', files: [{ name: "model.glb", blob: new Blob([JSON.stringify(' + JSON.stringify(modelB) + ')]) }] }).then(function(p){ return p.id; })');
    await cdp.evaluate('(function(){ window.__cnt = { parse: 0, digest: 0, put: 0 };' +
      'var P = THREE.GLTFLoader.prototype.parse; THREE.GLTFLoader.prototype.parse = function(){ __cnt.parse++; return P.apply(this, arguments); };' +
      'var D = SubtleCrypto.prototype.digest; SubtleCrypto.prototype.digest = function(){ __cnt.digest++; return D.apply(this, arguments); };' +
      'var W = ChoreoLibrary.putProfileFile; ChoreoLibrary.putProfileFile = function(){ __cnt.put++; return W.apply(this, arguments); };' +
      'return "counters on"; })()');

    const doSwitch = async (who, wantName) => {
      skelCurrent = who;
      const c0 = JSON.parse(await cdp.evaluate('JSON.stringify(window.__cnt)'));
      const t0 = Date.now();
      await cdp.evaluate('__p3dReset()');
      await waitFor(cdp, '切到「' + wantName + '」就绪', 'window.__p3dDebug && __p3dDebug().ready && __p3dDebug().profile && __p3dDebug().profile.name==="' + wantName + '"', 60000, 400);
      const ms = Date.now() - t0;
      const c1 = JSON.parse(await cdp.evaluate('JSON.stringify(window.__cnt)'));
      return { parse: c1.parse - c0.parse, digest: c1.digest - c0.digest, put: c1.put - c0.put, ms };
    };
    const B1 = await doSwitch('B', '档案B');
    const A2 = await doSwitch('A', '角色 1');
    const B2 = await doSwitch('B', '档案B');
    console.log('    计数（parse/digest/写库/耗时ms）：B1=' + JSON.stringify(B1) + ' A2=' + JSON.stringify(A2) + ' B2=' + JSON.stringify(B2));
    check('第二轮 A 不重新 parse 模型（AUD2-012 会话缓存）', A2.parse === 0, 'parse=' + A2.parse);
    check('第二轮 A 不重复写档案模型库', A2.put === 0, 'put=' + A2.put);
    check('第二轮 A 只剩骨架对号 hash（整份诊断1+结构指纹1）', A2.digest <= 2, 'digest=' + A2.digest);
    check('第二轮 B 不重新 parse 模型（兼容结论+档案模型都缓存）', B2.parse === 0, 'parse=' + B2.parse);
    check('第二轮 B 只剩骨架对号 hash（整份诊断1+结构指纹1）', B2.digest <= 2, 'digest=' + B2.digest);
    check('全程无 JS 异常（档案切换链路）', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// FIX-I/PREVIEW-1：init 进行中再次切档案（stale init 竞态）。真实入口：面板就绪后下拉里才有
// 档案可选，所以竞态发生在"第二次切换"——init#2（切到档案B）还挂在被 CDP 延迟 1100ms 的
// 部署位 model.gltf 请求上时，再切回角色 1（内部是 setActiveProfile→hardReset→init#3）。验收点：
//   ① ready 必须尽快恢复 true：修复后 hardReset 作废过期 init 并放行 init#3；修复前 init#3 被
//      initing 拒绝、过期 init#2 在已清空的状态上崩溃，面板死于「初始化失败」且无人重试
//   ② 恢复后档案=角色 1、骨架匹配 101/101（必须是最后一次切换的代次，不能停在档案B/过期状态）
//   /export/list 回 503 把 10s 自动升级探针关掉：不许"探针救活"掩盖竞态，恢复必须来自切换本身
async function scenarioInitRace() {
  console.log('[initrace] init#2 挂起时再切档案：过期 init 作废、新 init 接管（FIX-I/PREVIEW-1）');
  const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND'], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const snapSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'skeleton-snapshot.js'), 'utf8');
    const snap = JSON.parse(snapSrc.match(/window\.__CHOREO_SKELETON_SNAPSHOT__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const standinSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'standin-model.js'), 'utf8');
    const standin = JSON.parse(standinSrc.match(/window\.__CHOREO_STANDIN_MODEL__\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
    const skelB = JSON.parse(JSON.stringify(snap));
    ['a', 'b', 'c', 'd', 'e'].forEach((n, i) => { skelB.bones.push({ i: skelB.count + i, n: 'n_sippo_' + n, p: 0, t: [0, 0.5 + i * 0.1, 0.05], q: [0, 0, 0, 1] }); });
    skelB.count = skelB.bones.length;
    const modelB = JSON.parse(JSON.stringify(standin));
    for (let i = 0; i < 5; i++) {
      modelB.nodes.push({ name: 'n_sippo_' + ['a', 'b', 'c', 'd', 'e'][i], translation: [0, 0.5 + i * 0.1, 0.05], children: [] });
      if (modelB.skins && modelB.skins[0]) modelB.skins[0].joints.push(modelB.nodes.length - 1);
      modelB.scenes[modelB.scene].nodes.push(modelB.nodes.length - 1);
    }
    const deployModel = JSON.parse(JSON.stringify(standin)); // ≠内置替身（材质改名）→ 走真部署位路径
    if (deployModel.materials && deployModel.materials[0]) deployModel.materials[0].name = 'deployVariant';

    let skelCurrent = 'A';
    const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64');
    const PATTERNS = [
      { urlPattern: '*://localhost:48795/export/skeleton', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.gltf', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.glb', stage: 'Request' },
      { urlPattern: '*://localhost:48795/model.bin', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/list', stage: 'Request' },
      { urlPattern: '*://localhost:48795/export/getclip*', stage: 'Request' },
    ];
    // 每次 新文档 都在页面脚本之前装 model.gltf 计数器（跨重载、无时序依赖）：
    // init#1 计 1、init#2 计 2、init#3 计 3
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
      '(function(){ window.__mg = 0; var F = window.fetch;' +
      ' window.fetch = function(){ if (String(arguments[0]).indexOf("/model.gltf") >= 0) window.__mg++; return F.apply(this, arguments); }; })()' });
    cdp.onEvent = (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const u = m.params.request.url;
      const fulfill = (code, ctype, body) => cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: code,
        responseHeaders: [{ name: 'Content-Type', value: ctype }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: b64(body) }).catch(() => {});
      (async () => {
        if (u.indexOf('/export/skeleton') >= 0) await fulfill(200, 'application/json', JSON.stringify(skelCurrent === 'A' ? snap : skelB));
        else if (u.endsWith('/model.gltf')) {
          await sleep(1100); // 挂住当前 init 代次：竞争窗口 = 这 1.1s，下一次切换必须落在里面
          await fulfill(200, 'model/gltf', JSON.stringify(deployModel));
        } else if (u.endsWith('/model.glb')) await fulfill(404, 'application/json', '{"error":"none"}');
        else if (u.endsWith('/model.bin')) await fulfill(404, 'application/json', '{"error":"none"}');
        else if (u.indexOf('/export/list') >= 0) await fulfill(503, 'application/json', '{"error":"busy"}'); // 关掉 10s 探针的自动升级
        else await fulfill(200, 'application/json', '{"error":"none"}');
      })().catch(() => {});
    };

    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await cdp.send('Fetch.enable', { patterns: PATTERNS }); // init#1 已按无拦截跑完（替身基线）；从这里起拦截 init#2/#3
    // 两套档案都由本脚本预建（骨架不同、档案B 带兼容模型）：init#1 就绪后下拉里两个都能选
    await cdp.evaluate('Promise.all([' +
      'ChoreoLibrary.createProfile({ name: "角色 1", skeleton: ' + JSON.stringify(snap) + ' }),' +
      'ChoreoLibrary.createProfile({ name: "档案B", skeleton: ' + JSON.stringify(skelB) +
      ', files: [{ name: "model.glb", blob: new Blob([JSON.stringify(' + JSON.stringify(modelB) + ')]) }] })' +
      ']).then(function(ps){ window.__profA = ps[0].id; window.__profB = ps[1].id; return ps.length; })');
    await cdp.evaluate('window.__p3dProfilesChanged()'); // 产品钩子：档案增删后刷新下拉（init#1 已就绪时）
    await waitFor(cdp, 'init#1 就绪（替身基线）', 'window.__p3dDebug && __p3dDebug().ready', 45000, 300);
    // 基线断言等刷新落定再落锤：__p3dProfilesChanged 里的 refreshKnownProfiles 是 IDB 异步往返，
    // 立即断言会在重负载下撞在刷新中途（GATE-R2 升级记录实测）→ 有界等「2 个 option」的确定性
    // 状态（超时 20s fail-closed），断言本身与阈值（恰好 2）不变
    // DANCER-AUTOADAPT 后离线族包下拉（packSel）复用 .p3d-prof 类——断言只数档案下拉
    // （DOM 里第一个 .p3d-prof，与下方 switchTo 取的是同一个），不再跨下拉计数
    await waitFor(cdp, '基线下拉刷新完成（档案下拉出现两套档案）', '(document.querySelector(".p3d-prof")||{options:[]}).options.length===2', 20000, 200).catch(() => null);
    check('基线：init#1 就绪且下拉含两套档案', (await cdp.evaluate('(document.querySelector(".p3d-prof")||{options:[]}).options.length')) === 2);
    const switchTo = async (wantId) => cdp.evaluate('(function(){var s=document.querySelector(".p3d-prof");' +
      'for(var i=0;i<s.options.length;i++){if(s.options[i].value==="' + wantId + '"){s.selectedIndex=i;break;}}' +
      's.dispatchEvent(new Event("change"));return s.value;})()');
    // 切#1 → init#2：骨架换成 B，init#2 会对号到档案B，然后挂在延迟 1100ms 的 model.gltf 上
    skelCurrent = 'B';
    await switchTo(await cdp.evaluate('window.__profB'));
    await waitFor(cdp, 'init#2 已发出被延迟的 model.gltf 请求（竞争窗口打开）', 'window.__mg >= 2', 30000, 100);
    check('init#2 已挂起在 model.gltf 请求（竞争窗口打开）', (await cdp.evaluate('window.__mg')) === 2, '__mg=' + await cdp.evaluate('window.__mg'));
    // 窗口内切#2 → init#3：修复后接管并就绪；修复前被 initing 拒绝，过期 init#2 崩在清空状态上
    skelCurrent = 'A';
    await switchTo(await cdp.evaluate('ChoreoLibrary.listProfiles().then(function(l){var a=l.filter(function(p){return p.name==="角色 1";})[0];return a.id;})'));
    const ready = await waitFor(cdp, '切#2 后 3D 面板重新就绪（不许死在初始化失败上）',
      'window.__p3dDebug && __p3dDebug().ready', 20000, 250).catch(() => null);
    check('init 挂起时再切档案：面板重新就绪（过期 init 作废、新 init 接管）', !!ready);
    check('就绪后档案=角色 1（最后一次切换的代次，不是停在档案B）', await cdp.evaluate('__p3dDebug().profile && __p3dDebug().profile.name') === '角色 1',
      String(await cdp.evaluate('__p3dDebug().profile && __p3dDebug().profile.name')));
    const st2 = await cdp.evaluate('document.querySelector(".p3d-status").textContent');
    check('骨架匹配 101/101（角色 1 的骨架，不是 106 的过期骨架）', /101\/101/.test(st2), st2);
    check('状态栏不是「初始化失败」', st2.indexOf('初始化失败') < 0, st2);
    check('全程无 JS 异常（含过期 init 链路）', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

async function scenarioOnline() {
  console.log('[online] file:// 打开主页、游戏在线：应连上并加载线上目录+真模型');
  const ch = await launchChrome([], null);
  try {
    const cdp = await seedPairAndNavigate(ch);
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '游戏连接成功', 'store.gameConnected===true', 20000);
    check('目录来自线上（非快照）', await cdp.evaluate('store.catalogFromSnapshot===false'), await cdp.evaluate('store.emotes.length') + ' 表情');
    await waitFor(cdp, '3D 面板就绪（真模型）', 'window.__p3dDebug && __p3dDebug().ready && !__p3dDebug().offline', 60000, 500);
    check('3D 在线模式（真模型+真骨架）', await cdp.evaluate('__p3dDebug().offline===false'));
    const st = await cdp.evaluate('document.querySelector(\'.p3d-status\').textContent');
    check('骨架匹配 101/101（真模型）', /101\/101/.test(st), st);
    check('草稿在', await cdp.evaluate('store.dancers[0].actionClips.length===1'));
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// SEC-1 配对种子：真插件场景共用——本机 pairing.json 读真码，页面任何脚本跑起来之前种进
// localStorage（每次新文档都会重种，seedDraftAndReload 的 reload 之后依然有效）
async function seedPairAndNavigate(ch) {
  const cdp = await ch.pageTargetAny();
  const code = readPairingCode();
  if (!code) console.log('  [warn] 本机没读到 pairing.json（%APPDATA%\\XIVLauncherCN\\pluginConfigs\\ChoreoHelper），配对场景会因 403 失败');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
    'try{localStorage.setItem(\'choreo_pairToken\',' + JSON.stringify(code) + ')}catch(e){}' });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await sleep(500);
  return cdp;
}

async function scenarioTransition() {
  console.log('[transition] 同一页面：先屏蔽双端口（模拟游戏没开）→ 放开 → 自动恢复');
  const ch = await launchChrome([], null);
  try {
    const cdp = await seedPairAndNavigate(ch);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*localhost:48794*', '*localhost:48795*'] });
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '离线快照目录生效', 'store.catalogFromSnapshot===true', 20000);
    await waitFor(cdp, '3D 面板离线降级就绪', 'window.__p3dDebug && __p3dDebug().ready && __p3dDebug().offline', 45000, 500);
    check('开局是离线状态', await cdp.evaluate('store.gameConnected===false'));
    // 放开屏蔽 = 游戏中途启动
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await waitFor(cdp, '连接状态自动刷新（15s 监视器）', 'store.gameConnected===true', 25000, 500);
    // 目录升级在 probeGame 里拉完 emotes 后才置位（比 gameConnected 晚一步），立即断言是竞态误报
    await waitFor(cdp, '目录自动升级成线上版', 'store.catalogFromSnapshot===false', 20000, 300);
    check('目录自动升级成线上版', await cdp.evaluate('store.catalogFromSnapshot===false'));
    await waitFor(cdp, '3D 面板自动升级真模型（10s 轻探）', 'window.__p3dDebug && __p3dDebug().ready && !__p3dDebug().offline', 40000, 500);
    check('全程不丢草稿', await cdp.evaluate('store.dancers[0].actionClips.length===1'));
  } finally { ch.kill(); }
}

// 诊断页回归：等「终态标题」而不是只轮询 PASS 标记。诊断页健康时总会落终态（PASS/FAIL），
// 但重负载下页内链路可能瞬时挂死或中途异常，120s 内标题从未落终态（GATE-R2 实测两次）。
// 策略：PASS → 过；FAIL 终态或 45s 无终态 → 整页重载重试（≤2 次，瞬时竞态自愈）；
// 重试用尽仍 FAIL → 带页面日志尾部快速失败；整体 120s 兜底超时保持不变（fail-closed，点名方法）。
const DIAG_STALL_MS = 45000;
const DIAG_RELOADS = 2;
async function scenarioDiag(name, file, passMark) {
  console.log('[' + name + '] 诊断页回归 ' + file);
  let online = false;
  try { const r = await fetch('http://localhost:48795/' + file, { signal: AbortSignal.timeout(2000) }); online = r.ok; } catch (e) {}
  console.log('  [plugin] harness 自报 48795 插件在线: ' + (online ? '是' : '否'));
  const ch = await launchChrome([], 'http://localhost:48795/' + file);
  try {
    const cdp = await ch.pageTarget();
    const failMark = passMark.replace('PASS', 'FAIL');
    const t0 = Date.now();
    let reloads = 0, attemptT0 = Date.now();
    for (;;) {
      const title = await cdp.evaluate('document.title').catch(() => null);
      if (typeof title === 'string' && title.indexOf(passMark) >= 0) {
        check(name + ' 回归通过', true, title + (reloads ? '（重载 ' + reloads + ' 次后）' : ''));
        return;
      }
      const failed = typeof title === 'string' && title.indexOf(failMark) >= 0;
      const stalled = Date.now() - attemptT0 > DIAG_STALL_MS;
      if ((failed || stalled) && reloads < DIAG_RELOADS && Date.now() - t0 < 105000) {
        reloads++; attemptT0 = Date.now();
        console.log('  [retry] 标题未落 ' + passMark + '（' + title + '），整页重载第 ' + reloads + ' 次');
        await cdp.evaluate('location.reload()').catch(() => {});
        await sleep(500);
        continue;
      }
      if (failed) { // 重试用尽仍是终态失败：带日志尾部快速失败（不傻等 120s），fail-closed 不变
        const log = await cdp.evaluate('(document.getElementById("log")||document.body).textContent').catch(() => '');
        check(name + ' 回归通过', false, '终态 ' + title + ' · 日志尾: ' + String(log || '').slice(-300).replace(/\s+/g, ' '));
        return;
      }
      if (Date.now() - t0 > 120000) throw new Error('等待超时(120s): 诊断结果（标题）');
      await sleep(800);
    }
  } finally { ch.kill(); }
}

// ---------- 入口 ----------
(async function main() {
  { const swept = vclean.sweepAll(); if (swept) console.log('[verify-cleanup] 启动清扫：清掉上次残留 ' + swept + ' 个临时目录'); }
  const which = process.argv[2] || 'all';
  const run = {
    'offline': [scenarioOffline], 'online': [scenarioOnline], 'transition': [scenarioTransition],
    'perf': [scenarioPerf], 'modelswitch': [scenarioModelSwitch], 'initrace': [scenarioInitRace],
    'mode-check': [() => scenarioDiag('mode-check', 'mode-check.html', 'MODE-PASS')],
    'clip-check': [() => scenarioDiag('clip-check', 'clip-check.html', 'CLIP-PASS')],
    'all': [scenarioOffline, scenarioPerf, scenarioModelSwitch, scenarioInitRace, scenarioOnline, scenarioTransition,
      () => scenarioDiag('mode-check', 'mode-check.html', 'MODE-PASS'),
      () => scenarioDiag('clip-check', 'clip-check.html', 'CLIP-PASS')],
  }[which];
  if (!run) { console.error('用法: node offline-verify.js [offline|online|transition|perf|modelswitch|initrace|mode-check|clip-check|all]'); process.exit(2); }
  for (const s of run) {
    try { await s(); }
    catch (e) { check('场景执行失败：' + e.message, false); }
  }
  const pass = results.filter(Boolean).length;
  console.log('\n结果：' + pass + ' 通过 / ' + (results.length - pass) + ' 失败');
  process.exit(process.exitCode ? 1 : 0);
})();
