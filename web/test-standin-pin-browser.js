// TASK-20260924-LOOSE-ENDS 替身时间线钉住探针（REQ-02「维持现状不改」的永久测试）：
// 属主 2026-09-24 原话「维持现状不改」——替身（档案骨架有效但无模型 / 全局无档案）不上
// 引擎时间轴＝preview3d clipScopeFor/applySkillMotion/rebuildTimeline 的既有 excluded 语义。
// 本探针只用真实控件（项目中心新建项目＋原生 prompt、真实点动作库、真实键盘改绑定下拉），
// 一次性抛弃式 profile、HTTP(S) 全阻断（含 localhost）、file:// 仓内 dist 入口；
// 断言＝面板如实（替身示意分层文案＋人物模型计数不伪报＋缺模型导入指引在场）＋
// 引擎时间轴无替身舞者条目。钉现状：对 before 字节预期绿；≥3 遍逐字相同（2026-09-22 规则）。
// 运行：CHOREO_LOOSE_ENDS_EVIDENCE=<全新目录> node web/test-standin-pin-browser.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), { spawn } = require('child_process');
const evidence = process.env.CHOREO_LOOSE_ENDS_EVIDENCE;
assert.ok(evidence && !fs.existsSync(evidence), '证据目录必须不存在，由探针自建：' + (evidence || '(未设置 CHOREO_LOOSE_ENDS_EVIDENCE)'));
fs.mkdirSync(evidence, { recursive: true });
const entry = path.resolve(__dirname, 'dist/ChoreoHelper/choreo-helper-app.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chrome = null, ws = null, seq = 0; const pending = new Map(), checks = [], errors = [], requests = [], dialogs = [], steps = [];
let expectedPrompt = null;
function json(n, v) { fs.writeFileSync(path.join(evidence, n + '.json'), JSON.stringify(v, null, 1)); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 25000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
// 含 await 的异步表达式走非 replMode（CDP replMode 下 async IIFE 结果丢失为 {}，本机实测）
async function evx(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: false }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { for (let i = 0; i < 250; i++) { if (await ev(expression).catch(() => false)) return; await sleep(100); } throw Error('Wait ' + expression); }
function check(n, ok, d) { checks.push({ name: n, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) throw Error(n + ' ' + (d || '')); }
function step(name, data) { steps.push(Object.assign({ step: name }, data || {})); }
async function route(p) { const u = new URL(p.request.url); requests.push({ host: u.host, path: u.pathname }); await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); }
async function shot(n) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(evidence, n + '.png'), Buffer.from(r.data, 'base64')); }
async function clickAt(p) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 }); await sleep(180); }
async function click(sel) { const p = await ev(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});if(!n)throw Error('Missing '+${JSON.stringify(sel)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`); await clickAt(p); return p; }
async function button(text, scope = 'body') { const p = await ev(`(()=>{const n=Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(n=>n.textContent.includes(${JSON.stringify(text)}));if(!n)throw Error('button missing '+${JSON.stringify(text)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`); await clickAt(p); }
async function key(k, code, vk) { for (const t of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type: t, key: k, code, windowsVirtualKeyCode: vk }); await sleep(90); }
// 真实控件改 select 值（object-edit/bspatial 探针同法：真实点击后聚焦＋真实键盘；重试至目标值）
async function selectValue(sel, want) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await click(sel);
    await ev(`(function(){var s=document.querySelector(${JSON.stringify(sel)});if(s&&document.activeElement!==s)s.focus();return true})()`);
    const cur = await ev(`document.querySelector(${JSON.stringify(sel)}).value`);
    const opts = await ev(`Array.from(document.querySelector(${JSON.stringify(sel)}).options).map(o=>o.value)`);
    const need = opts.indexOf(want) - opts.indexOf(cur);
    for (let i = 0; i < Math.abs(need); i++) await key(need > 0 ? 'ArrowDown' : 'ArrowUp', need > 0 ? 'ArrowDown' : 'ArrowUp', need > 0 ? 40 : 38);
    await key('Enter', 'Enter', 13);
    if (await ev(`document.querySelector(${JSON.stringify(sel)}).value`) === want) return true;
  }
  return false;
}
async function open() {
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync); assert.ok(exe);
  const profile = path.join(evidence, 'throwaway-profile'); fs.mkdirSync(profile, { recursive: true });
  chrome = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1500,900', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--host-resolver-rules=MAP localhost ~NOTFOUND', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', fs.openSync(path.join(evidence, 'chrome-stderr.log'), 'a')] });
  let target; for (let i = 0; i < 300 && !target; i++) { try { const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; target = (await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) })).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(100); }
  assert.ok(target);
  ws = new WebSocket(target.webSocketDebuggerUrl); ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); if (m.method === 'Fetch.requestPaused') route(m).catch(() => {}); if (m.method === 'Page.javascriptDialogOpening') { dialogs.push({ message: m.params.message, type: m.params.type }); if (expectedPrompt !== null) { const text = expectedPrompt; expectedPrompt = null; send('Page.handleJavaScriptDialog', { accept: true, promptText: text }).catch(e2 => errors.push({ dialog: e2.message })); } else send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }); await send('Fetch.enable', { patterns: [{ urlPattern: 'http://' }, { urlPattern: 'https://' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: require('node:url').pathToFileURL(entry).href }); await until('window.store&&store.appReady');
}
async function close() { if (!chrome) return; const p = chrome, done = p.exitCode !== null ? Promise.resolve() : new Promise(r => p.once('exit', r)); send('Browser.close').catch(() => {}); await Promise.race([done, sleep(15000)]); for (const q of pending.values()) { clearTimeout(q.timer); q.resolve({}); } pending.clear(); ws.close(); chrome = null; }
const p3dStatus = () => ev('(document.querySelector(".p3d-status")||{textContent:""}).textContent');
const p3dMiss = () => ev('(document.querySelector(".p3d-miss")||{textContent:"",title:""}).textContent+"|"+((document.querySelector(".p3d-miss")||{title:""}).title||"")');
const tlEntries = () => ev('(function(){var D=window.__p3dDebug&&window.__p3dDebug();if(!D||!D.engine)return null;return (D.engine.timeline||[]).map(function(e){return e.char+":"+e.clipName+"@"+e.start})})()');
(async () => { try {
  await open();
  // ---------- 真实控件准备：新建合成项目（原生 prompt 协议）＋舞者二＋两位舞者各放一条动作 ----------
  await button('项目', '.toolbar-nav'); await until('!!document.getElementById("projectCenterModal")');
  expectedPrompt = '合成观察—替身钉住'; await button('新建项目', '#projectCenterModal');
  await until('store.projectName==="合成观察—替身钉住"&&!document.getElementById("projectCenterModal")');
  await click('#wbEmptyStart'); await until('document.querySelector(".tl-area")&&document.getElementById("wbAddBar")');
  await click('#wbAddDancer'); await until('store.dancers.length===2');
  await until('document.querySelectorAll(".act-item .ai-name").length>0');
  await click('.add-all-row input'); await until('document.getElementById("wbAddTarget").textContent.indexOf("下一条添加到：全部舞者")===0');
  await click('.act-item .ai-name'); await until('store.dancers[0].actionClips.length===1&&store.dancers[1].actionClips.length===1');
  await click('.add-all-row input'); await until('document.getElementById("wbAddTarget").textContent.indexOf("下一条添加到：全部舞者")<0');
  step('prep', { dancers: 2, clips: '2x1', note: '真实控件：项目中心新建（原生 prompt）＋添加舞者＋动作库「添加到全部舞者」' });

  // ---------- 场景 B：全局替身（无档案/无绑定）→ 引擎时间轴无条目、面板如实 ----------
  await click('#wbTab3d'); await until('document.getElementById("wbTopHost").hidden===true');
  if (!(await ev('!!document.querySelector(".p3d-status")'))) { await click('#wbOpen3d').catch(async () => { await button('打开 3D 预览', '#previewDock'); }); }
  for (let i = 0; i < 120; i++) { if ((await p3dStatus()).includes('就绪（')) break; await sleep(500); }
  const stB = await p3dStatus();
  step('sceneB-status', { status: stB.slice(0, 300) });
  check('SP-1 全局替身：就绪状态行到场（就绪（…）', stB.includes('就绪（'));
  check('SP-2 全局替身：分层文案含「替身示意」「只承诺站位」「时间轴」三子串（FJ-06 基线）',
    stB.includes('替身示意') && stB.includes('只承诺站位') && stB.includes('时间轴'));
  check('SP-3 全局替身：人物模型计数如实为 0（不伪报真模型）、替身在场（状态行按最近一次母版重建计數，加人后待重建＝既有行为）',
    stB.includes('人物模型 0') && stB.includes('替身') && !/人物模型 [1-9]/.test(stB));
  const tlB = await tlEntries();
  check('SP-4 全局替身：引擎时间轴无任何舞者动作条目（timeline.length=0）', Array.isArray(tlB) && tlB.length === 0, JSON.stringify(tlB));
  const dbgB = await ev('(function(){var D=__p3dDebug();return {offline:D.offline,chars:D.chars,rigs:D.rigs,src:D.masters.perDancer.map(function(p){return p.source})}})()');
  check('SP-5 全局替身：每舞者母版来源 standin（usedStandin 回落）、离线降级如实、替身站位可见（rigs>0）',
    dbgB.offline === true && dbgB.src.every(s => s === 'standin') && dbgB.rigs >= 2, JSON.stringify(dbgB));
  await shot('s1-global-standin'); step('sceneB', { timeline: 0, rigs: dbgB.rigs, real: 0 });

  // ---------- 场景 A：播种「有骨架、无模型」档案（隔离合成资料）→ 真实键盘绑定 ----------
  const seed = await evx('(async function(){try{var lib=window.ChoreoLibrary;if(!lib||!lib.available())return {error:"library-unavailable"};var snap=window.__CHOREO_SKELETON_SNAPSHOT__;if(!snap||!snap.bones||!snap.count)return {error:"snapshot-missing"};var p=await lib.createProfile({name:"合成替身档案—无模型",skeleton:snap});return {pid:p&&p.id,name:p&&p.name,modelNames:(p&&p.modelNames)||[],boneCount:snap.count}}catch(e){return {error:String(e&&e.message||e)}}})()');
  step('seed', { seed: seed, note: '合成资料播种（隔离）：内置骨架快照、无模型文件经 ChoreoLibrary 真实建档；非真实素材、非游戏结果' });
  if (!seed || !seed.pid) throw Error('播种失败：' + JSON.stringify(seed));
  check('SP-6 合成档案＝有骨架、零模型文件（modelNames 空）', seed.modelNames.length === 0 && seed.boneCount > 0, JSON.stringify(seed));
  await ev('window.__p3dProfilesChanged&&window.__p3dProfilesChanged();true');   // 资料库窗口同款通知：绑定下拉数据源＋面板重建
  await until('Array.from(document.querySelectorAll(".dh-prof")[0].options).some(function(o){return o.value===' + JSON.stringify(seed.pid) + '})');
  const bound = await selectValue('.dh-prof', seed.pid);
  check('SP-7 真实键盘绑定舞者1→该档案（select 值与 store.dancers[0].profileId 均命中）',
    bound === true && await ev('store.dancers[0].profileId') === seed.pid);
  for (let i = 0; i < 120; i++) { const r = await ev('(function(){var D=__p3dDebug();var p=D.masters.perDancer[0]||{};return p.reason==="no-model"&&p.source==="standin"})()'); if (r) break; await sleep(500); }
  const dbgA = await ev('(function(){var D=__p3dDebug();var p=D.masters.perDancer;return {offline:D.offline,chars:D.chars,rigs:D.rigs,per:p.map(function(x){return {profileId:x.profileId,source:x.source,reason:x.reason}}),notices:D.notices.map(function(n){return n?{text:n.text,tip:n.tip}:null})}})()');
  check('SP-8 绑定替身：舞者1 解析档案=该 pid、母版来源 standin（骨架有效但无模型回落）、reason=no-model；舞者2 跟随活动档案同口径',
    dbgA.per[0].profileId === seed.pid && dbgA.per[0].source === 'standin' && dbgA.per[0].reason === 'no-model' && dbgA.per[1].source === 'standin',
    JSON.stringify(dbgA.per));
  const tlA = await tlEntries();
  check('SP-9 绑定替身：引擎时间轴仍无该舞者动作条目（含舞者2，timeline.length=0）', Array.isArray(tlA) && tlA.length === 0, JSON.stringify(tlA));
  const n0 = dbgA.notices[0];
  check('SP-10 每舞者提示点名舞者（舞者「…」）＋「没有模型文件…用替身显示」如实',
    !!n0 && /舞者「.+」/.test(n0.text) && n0.text.includes('没有模型文件') && n0.text.includes('用替身显示'), n0 && n0.text);
  check('SP-11 缺模型提示含导入模型指引（「导入模型」＋刷新）', !!n0 && n0.tip.includes('导入模型') && n0.tip.includes('刷新'), n0 && n0.tip);
  for (let i = 0; i < 60; i++) { const s = await p3dStatus(); if (s.includes('替身示意') && s.includes('人物模型 0')) break; await sleep(500); }
  const stA = await p3dStatus();
  check('SP-12 绑定后状态行仍替身示意＋人物模型 0（绑定不伪报真模型；重建后替身计数=舞者数）',
    stA.includes('替身示意') && stA.includes('人物模型 0') && !/人物模型 [1-9]/.test(stA) && stA.includes('替身 2'));
  const missA = await p3dMiss();
  check('SP-13 面板缺模型提示落进 DOM（.p3d-miss 含舞者1/没有模型文件；title 含导入模型指引）',
    missA.includes('没有模型文件') && missA.includes('导入模型'), missA.slice(0, 160));
  await shot('s2-bound-standin'); step('sceneA', { timeline: 0, per: dbgA.per.length, reason: dbgA.per[0].reason });

  // ---------- 收口 ----------
  check('SP-14 全程零未捕获 JS 异常', errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  check('SP-15 零网络请求（HTTP(S) 全阻断；面板探活失败在 DNS 层，不产生请求记录——b10/OBS-FIX 同实证口径）',
    requests.length === 0, JSON.stringify(requests.slice(0, 3)));
  const crypto = require('crypto'); const hashes = {};
  for (const f of ['preview3d.js', 'choreo-engine.js', 'choreo-document.js']) {
    const h = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    hashes[f] = { source: h(path.resolve(__dirname, f)), dist: h(path.resolve(__dirname, 'dist/ChoreoHelper', f)) };
    check('SP-16 源=dist 逐字节孪生 ' + f, hashes[f].source === hashes[f].dist);
  }
  json('checks', checks); json('steps', steps); json('errors', errors.map(x => JSON.stringify(x).slice(0, 300))); json('requests', requests); json('dialogs', dialogs); json('hashes', hashes);
  console.log('\nStandinPin: ' + checks.length + '/' + checks.length + ' checks passed; errors=' + errors.length + '; requests=' + requests.length);
} catch (e) {
  json('failure', { message: e.message, stack: String(e.stack || '').slice(0, 600) }); json('checks', checks); json('steps', steps); json('errors', errors.map(x => JSON.stringify(x).slice(0, 300))); json('requests', requests);
  console.error(e); process.exitCode = 1; if (ws) await shot('failure').catch(() => {});
} finally { await close(); } })();
