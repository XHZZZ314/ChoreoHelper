// test-wp3-browser.js —— WP-3 v0.7 项目中心与编辑基础：file:// 真浏览器演练探针（TASK-20260928-WP3-PROJECT-CENTER）
// 这个文件是干嘛的：
//   在一次性抛弃式 profile 上，用真实 Chrome（headless=new + CDP）走完 WP-3 的属主旅程并逐项打点：
//   §M 旧草稿 choreo_draft 首次打开无损迁移（含逐字节备份）；§C 项目中心新建/改名/复制/删除/最近列表；
//   §V 版本快照与恢复；§X 异常关机恢复（确定性崩溃余态构造＋真实 taskkill 硬杀双证据）；
//   §E 编辑基础真实交互（撤销重做/多选/框选/复制粘贴/整组平移/对齐/插删时间/A-B 循环/段落标记/独奏静音）。
//   页面加载前经 Page.addScriptToEvaluateOnNewDocument 预置旧草稿（早于应用脚本）；
//   HTTP(S) 全阻断（WP-3 不依赖网络）；证据目录由 CHOREO_WP3_EVIDENCE 指定且必须不存在。
// 运行：CHOREO_WP3_EVIDENCE=<全新目录> D:/nodejs/node.exe web/test-wp3-browser.js
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const equal = require('node:util').isDeepStrictEqual;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const evidence = process.env.CHOREO_WP3_EVIDENCE;
assert.ok(evidence, '需要 CHOREO_WP3_EVIDENCE=<全新目录> 指定证据目录');
assert.ok(!fs.existsSync(evidence), '证据目录必须不存在，由探针自建：' + evidence);
const profile = path.join(evidence, 'throwaway-profile');
const daily = path.resolve(__dirname, 'dist/ChoreoHelper/choreo-helper-app.html');
const json = (name, value) => fs.writeFileSync(path.join(evidence, name + '.json'), JSON.stringify(value, null, 2));

// ---------- 合成旧草稿（真实结构：动作双片段＋全局歌词＋设置，区别于默认项目以便判无损） ----------
const draft = {
  dancers: [{ id: 0, name: '舞者 1',
    actionClips: [
      { id: 7, start: 0, duration: 3, data: { name: '鞠躬', command: '/bow motion', category: 'usual' } },
      { id: 8, start: 10, duration: 4, data: { name: '挥手', command: '/wave motion', category: 'usual' } }],
    switchClips: [], lyricClips: [] }],
  globalLyrics: [{ id: 9, start: 1, duration: 2, data: { name: '啦啦啦', command: '/y 啦啦啦', category: 'lyric', isLyric: true } }],
  dancerCount: 1, showLyricMacro: true, totalDuration: 420 };
const draftRaw = JSON.stringify(draft);
// 业务级内容投影（对比用；文档模块投影后的 _doc 等内部键不属于业务内容）
const BIZ = `(ct)=>({d:(ct.dancers||[]).map(x=>({id:x.id,name:x.name,
 a:(x.actionClips||[]).map(c=>[c.id,+c.start.toFixed(3),+c.duration.toFixed(3),c.data&&c.data.command,c.data&&c.data.name]).sort((p,q)=>p[0]-q[0]),
 s:(x.switchClips||[]).length,l:(x.lyricClips||[]).map(c=>[c.id,+c.start.toFixed(3)]),solo:!!x.solo,mute:!!x.mute})),
 g:(ct.globalLyrics||[]).map(c=>[c.id,+c.start.toFixed(3),+c.duration.toFixed(3),c.data&&c.data.command,c.data&&c.data.name]).sort((p,q)=>p[0]-q[0]),
 lm:!!ct.showLyricMacro,td:ct.totalDuration,dc:ct.dancerCount,
 mk:(ct.markers||[]).map(m=>[+m.t.toFixed(3),m.name]).sort((p,q)=>p[0]-q[0])})`;
const expectedBiz = {
  d: [{ id: 0, name: '舞者 1',
    a: [[7, 0, 3, '/bow motion', '鞠躬'], [8, 10, 4, '/wave motion', '挥手']],
    s: 0, l: [], solo: false, mute: false }],
  g: [[9, 1, 2, '/y 啦啦啦', '啦啦啦']], lm: true, td: 420, dc: 1, mk: [] };

// ---------- CDP 骨架（同 test-time-input / test-standin-pin 约定） ----------
let chrome, ws, seq = 0; const dialogQueue = []; const dialogs = []; const pending = new Map(); const methodOf = new Map(); let errors = []; const checks = [];
process.on('unhandledRejection', e => { console.error('UNHANDLED-REJECTION', e && e.stack || e); errors.push({ unhandled: String(e && e.message || e) }); });
function willDialog(...answers) { dialogQueue.length = 0; dialogQueue.push(...answers); }
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); methodOf.delete(id); reject(Error('CDP timeout ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); methodOf.set(id, method); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true, replMode: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function until(expression) {
  for (let i = 0; i < 200; i++) { if (await ev(expression).catch(() => false)) return; await sleep(100); }
  throw Error('Wait ' + expression);
}
async function softUntil(expression, tries = 30) {
  for (let i = 0; i < tries; i++) { if (await ev(expression).catch(() => false)) return true; await sleep(100); }
  return false;
}
async function key(k, opts = {}) {
  const code = opts.code || (k.length === 1 ? 'Key' + k.toUpperCase() : k);
  const vk = opts.vk || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Delete: 46, ArrowRight: 39, ArrowLeft: 37 }[k] || k.toUpperCase().charCodeAt(0)));
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: opts.modifiers || 0 });
  await sleep(150);
}
async function mouse(type, x, y, extra = {}) { try { await send('Input.dispatchMouseEvent', { type, x, y, button: extra.button || 'left', clickCount: extra.clickCount || 1, modifiers: extra.modifiers || 0, buttons: extra.buttons != null ? extra.buttons : (type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0) }); } catch (e) { console.error('MOUSE-FAIL', type, 'x=' + x, 'y=' + y, JSON.stringify(extra), e.message); throw e; } }
async function centerOf(locatorJs) {
  return ev(`(()=>{const e=${locatorJs};if(!e||!e.isConnected)throw Error('目标不存在');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
}
async function clickAt(p, extra = {}) { await mouse('mousePressed', p.x, p.y, extra); await mouse('mouseReleased', p.x, p.y, extra); await sleep(150); }
async function click(selector, index = 0) { const p = await centerOf(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]`); await clickAt(p); }
async function clickBtnText(text, scopeJs = 'document') {
  const p = await centerOf(`(()=>{const bs=[...${scopeJs}.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.offsetParent!==null);if(!bs.length)throw Error('找不到按钮「${text}」');return bs[0]})()`);
  await clickAt(p);
}
// 项目中心列表行内按钮：行内项目名（加粗 <b>）匹配，向上爬到含目标按钮的行容器再点击
async function clickRowBtn(name, btn) {
  const p = await centerOf(`(()=>{let n=[...document.querySelectorAll('#projectCenterModal b')].find(b=>b.textContent===${JSON.stringify(name)});if(!n)throw Error('找不到项目行「${name}」');
    while(n&&![...n.children].some(c=>c.tagName==='BUTTON'&&c.textContent.trim()===${JSON.stringify(btn)}))n=n.parentElement;
    const b=n&&[...n.children].find(c=>c.tagName==='BUTTON'&&c.textContent.trim()===${JSON.stringify(btn)});
    if(!b)throw Error('行内无按钮「${btn}」');return b})()`);
  await clickAt(p, { }); await sleep(250);
}
// 传输区行内按钮（A/B/✕/⚑+ 同一行；以 ⚑+ 为锚避免与别处 ✕ 撞文本）
async function loopBarBtn(text) {
  const p = await centerOf(`(()=>{const anchor=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='⚑+'&&b.offsetParent!==null);if(!anchor)throw Error('找不到传输区 ⚑+ 锚');const b=[...anchor.parentNode.children].find(x=>x.tagName==='BUTTON'&&x.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('传输区无按钮「${text}」');return b})()`);
  await clickAt(p);
}
async function openAdvancedTools() { // 已开则不重复点开（防 toggle 关闭）
  if (!await ev('!!document.getElementById("toolsPage")')) await click('#toolsBtn');
  await until('document.getElementById("toolsPage")');
  await click('[data-tools-page=advanced]');
  await until('document.querySelectorAll("#toolsPage button").length>=6');
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
function check(name, ok, detail) { checks.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '（' + detail + '）' : '')); }
function toasts() { return ev('window.__toasts||[]'); }

// ---------- 启动/关闭（每次 open 都重新预置旧草稿——同值覆写无害；重开不复迁由迁移标志保证） ----------
const SEED_JS = `(function(){try{localStorage.setItem('choreo_draft',${JSON.stringify(draftRaw)});}catch(e){}
 var iv=setInterval(function(){if(typeof window.showToast==='function'&&!window.__stw){window.__stw=1;clearInterval(iv);var o=window.showToast;
  window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(String(m));return o(m)};}},40);})();`;
async function open() {
  fs.mkdirSync(profile, { recursive: true });
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  assert.ok(exe, '找不到 Chrome');
  chrome = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1600,1100',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, '--host-resolver-rules=MAP localhost ~NOTFOUND', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', fs.openSync(path.join(evidence, 'chrome-stderr.log'), 'a')] });
  let target; for (let i = 0; i < 300 && !target; i++) {
    try { const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; target = (await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) })).json()).find(t => t.type === 'page'); } catch { }
    if (!target) await sleep(100);
  }
  assert.ok(target, 'CDP 目标页未就绪');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = e => {
    const m = JSON.parse(e.data), p = pending.get(m.id);
    if (p) { pending.delete(m.id); clearTimeout(p.timer); if (m.error) { console.error('CDP-ERR', methodOf.get(m.id), m.error.message); methodOf.delete(m.id); p.reject(Error(m.error.message)); } else { methodOf.delete(m.id); p.resolve(m.result); } }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params);
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params); const a = dialogQueue.shift(); if (!a) throw Error('未预期的对话框: ' + m.params.message); send('Page.handleJavaScriptDialog', a).catch(er => errors.push({ dialog: er.message })); }
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send('Runtime.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_JS });
  await send('Page.navigate', { url: pathToFileURL(daily).href });
  await until('window.store&&store.appReady');
  await ev('document.querySelector(".p3d-close")?.click();window.biz=' + BIZ + ';window.__snap=()=>biz(store);undefined');
  await sleep(400);
}
async function closeGraceful() {
  if (!chrome) return; const child = chrome, done = child.exitCode !== null ? Promise.resolve() : new Promise(r => child.once('exit', r));
  send('Browser.close').catch(() => { }); await Promise.race([done, sleep(15000)]); assert.notEqual(child.exitCode, null, '浏览器完整退出');
  for (const p of pending.values()) { clearTimeout(p.timer); p.resolve({}); } pending.clear(); ws.close(); chrome = null; await sleep(400);
}
async function closeHard() { // 真实硬杀：taskkill /T /F 杀整棵进程树（模拟异常关机/断电）
  if (!chrome) return; const child = chrome; const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(r => { tk.on('exit', r); }); await sleep(600);
  for (const p of pending.values()) { clearTimeout(p.timer); p.resolve({}); } pending.clear(); try { ws.close(); } catch { } chrome = null; await sleep(400);
}

// ---------- §E 辅助 ----------
// 注意：裸 DOMRect 经 CDP returnByValue 会序列化成 {}（属性在原型上），必须手工组普通对象
function clipRectJs(clipId) { return `(()=>{const n=(_clipNodes[${clipId}]||[]).find(n=>n.isConnected);if(!n)throw Error('片段节点缺失 id=${clipId}');const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`; }
async function clickClip(clipId, modifiers = 0) { const r = await ev(clipRectJs(clipId)); await clickAt({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, { modifiers }); }
async function selCount() { return ev('ChoreoEdit.pure.collectSelected(store).length'); }
async function byCmd(cmd) { return ev(`store.dancers.flatMap(d=>d.actionClips||[]).filter(c=>c.data&&c.data.command===${JSON.stringify(cmd)}).map(c=>({id:c.id,start:c.start,dur:c.duration}))`); }

(async () => {
  try {
    // ================= §M 旧草稿迁移 =================
    await open();
    const list0 = await ev('await ChoreoProjects.listProjects()');
    check('M1 迁移后恰好 1 个项目且名为「我的编舞」', list0.length === 1 && list0[0].name === '我的编舞', JSON.stringify(list0.map(p => p.name)));
    const m2 = await ev('({pid:store.projectId,proName:store.projectName,biz:__snap()})');
    check('M2 装载内容与旧草稿业务级逐项一致（舞者/片段/歌词/设置）', equal(m2.biz, expectedBiz) && m2.proName === '我的编舞' && m2.pid === list0[0].id);
    if (!equal(m2.biz, expectedBiz)) json('m2-mismatch', { actual: m2.biz, expected: expectedBiz });
    const m3 = await ev(`({raw:localStorage.getItem('choreo_draft'),bak:localStorage.getItem('choreo_draft_backup_20260829'),flag:localStorage.getItem('choreo_migrated_v1')})`);
    check('M3 旧草稿原文保留且备份键逐字节等于原文', m3.raw === draftRaw && m3.bak === draftRaw, m3.raw === draftRaw ? '原文在' : '原文丢失');
    check('M4 迁移标志 choreo_migrated_v1 置位', m3.flag === '1');
    const vs0 = await ev('await ChoreoProjects.listVersions(store.projectId)');
    check('M5 存在「迁移自旧草稿」版本快照', vs0.some(v => v.label === '迁移自旧草稿'), JSON.stringify(vs0.map(v => v.label)));
    await softUntil('(window.__toasts||[]).some(t=>t.includes("已把旧草稿迁移成项目"))', 40);
    check('M6 首开出现迁移提示 toast（含备份说明）', (await toasts()).some(t => t.includes('已把旧草稿迁移成项目') && t.includes('原草稿已自动备份')), JSON.stringify(await toasts()));
    await shot('m-migrated');
    await closeGraceful(); await open();
    const list1 = await ev('await ChoreoProjects.listProjects()');
    const migAgain = (await toasts()).filter(t => t.includes('已把旧草稿迁移成项目')).length;
    check('M7 重开不复迁（仍 1 项目、无第二次迁移提示、内容稳定）', list1.length === 1 && migAgain === 0 && equal(await ev('__snap()'), expectedBiz));
    json('m-state', { list1, toasts: await toasts(), biz: await ev('__snap()') });

    // ================= §C 项目中心 CRUD＋最近 =================
    await clickBtnText('📁 项目');
    await until('document.getElementById("projectCenterModal")');
    check('C1 顶栏「📁 项目」打开项目中心', true);
    willDialog({ accept: true, promptText: 'WP3验证B' });
    await clickBtnText('➕ 新建项目', 'document.getElementById("projectCenterModal")');
    assert.equal(dialogQueue.length, 0, '新建 prompt 已被真实处理');
    await until('(window.__toasts||[]).some(t=>t.includes("已新建「WP3验证B」"))');
    check('C2 新建项目「WP3验证B」并接管当前编排', await ev('store.projectName') === 'WP3验证B');
    const c2list = await ev('await ChoreoProjects.listProjects()');
    check('C2b 列表 2 个项目', c2list.length === 2, JSON.stringify(c2list.map(p => p.name)));
    await clickBtnText('📁 项目'); await until('document.getElementById("projectCenterModal")');
    willDialog({ accept: true, promptText: 'WP3验证B改' });
    await clickRowBtn('WP3验证B', '改名');
    assert.equal(dialogQueue.length, 0, '改名 prompt 已被真实处理');
    await until('(window.__toasts||[]).some(t=>t.includes("已改名"))&&store.projectName==="WP3验证B改"');
    check('C3 改名生效（记录与当前编排同步）', true);
    await clickRowBtn('WP3验证B改', '复制');
    await until('(window.__toasts||[]).some(t=>t.includes("已复制一份"))');
    const c4 = await ev('(await ChoreoProjects.listProjects())');
    const copyRow = c4.find(p => p.name === 'WP3验证B改 副本');
    check('C4 复制出「WP3验证B改 副本」且 id 独立', !!copyRow && copyRow.id !== await ev('store.projectId'));
    check('C5 最近列表按 updatedAt 新→旧（副本最新在首）', c4[0].name === 'WP3验证B改 副本', JSON.stringify(c4.map(p => p.name)));
    await shot('c-list');
    willDialog({ accept: false });
    await clickRowBtn('WP3验证B改 副本', '删除');
    assert.equal(dialogQueue.length, 0, '删除取消 confirm 已被真实处理');
    await sleep(600);
    check('C6 删除确认框取消 → 项目仍在', (await ev('await ChoreoProjects.listProjects()')).some(p => p.name === 'WP3验证B改 副本'));
    willDialog({ accept: true });
    await clickRowBtn('WP3验证B改 副本', '删除');
    await until('(window.__toasts||[]).some(t=>t.includes("已删除"))');
    check('C7 确认删除后列表不再含副本', !(await ev('await ChoreoProjects.listProjects()')).some(p => p.name === 'WP3验证B改 副本'));
    const delId = await ev('store.projectId'); const keepId = list1[0].id;
    willDialog({ accept: true });
    await clickRowBtn('WP3验证B改', '删除');
    await until('(window.__toasts||[]).some(t=>t.includes("已删除"))&&store.projectId==='.concat(JSON.stringify(keepId)));
    const c8 = await ev('({pid:store.projectId,list:await ChoreoProjects.listProjects()})');
    check('C8 删除当前项目自动切到最近项目且不复活', c8.pid === keepId && !c8.list.some(p => p.id === delId) && c8.list.length === 1, JSON.stringify(c8.list.map(p => p.name)));
    await softUntil(`!(await ChoreoProjects.listProjects()).some(p=>p.id===${JSON.stringify(delId)})`, 20); // 等 IDB 删除事务落地＋tombstone 记账完成，再测复活拦截
    await sleep(300);
    const resurrect = await ev(`(await ChoreoProjects.saveActive({id:${JSON.stringify(delId)},name:"x",content:{dancers:[],globalLyrics:[]},updatedAt:Date.now()}))`);
    const c9list = await ev('await ChoreoProjects.listProjects()');
    check('C9 tombstone 拦截已删项目被自动保存复活', resurrect === false && !c9list.some(p => p.id === delId), 'saveActive=' + JSON.stringify(resurrect) + ' ids=' + JSON.stringify(c9list.map(p => p.id)) + ' delId=' + delId);
    await ev('document.getElementById("projectCenterClose").click()'); await sleep(200);

    // ================= §V 版本快照与恢复（在迁移项目上） =================
    const vBase = await ev('__snap()');
    await clickBtnText('📁 项目'); await until('document.getElementById("projectCenterModal")');
    await ev('document.getElementById("projectHistoryFold").open=true');
    await ev('document.getElementById("projectVersionLabel").value="WP3验证版本"');
    await clickBtnText('💾 给当前项目存个版本', 'document.getElementById("projectCenterModal")');
    await until('document.getElementById("projectVersionStatus").textContent.includes("已保存「WP3验证版本」")');
    const v1 = await ev('await ChoreoProjects.listVersions(store.projectId)');
    check('V1 手动存版本（带备注）进历史列表', v1.some(v => v.label === 'WP3验证版本'), JSON.stringify(v1.map(v => v.label)));
    await ev('store.dancers[0].actionClips.push({id:store.nextClipId++,start:100,duration:2,data:{name:"版本探针",command:"/v1 motion",category:"usual"}});saveHistory();render()');
    await sleep(400);
    check('V2 编辑后内容偏离版本快照', !equal(await ev('__snap()'), vBase));
    const vSnapAt = v1.find(v => v.label === 'WP3验证版本').savedAt;
    const vSnapBiz = await ev(`(window.__bizAny=window.__bizAny||(ct=>biz(ChoreoDocWire.loadProjection(JSON.parse(JSON.stringify(ct||{}))).proj)))((await ChoreoProjects.getVersion(store.projectId,${JSON.stringify(vSnapAt)})).content)`);
    check('V2b 版本快照内容＝存档时内容（经文档投影后业务级一致）', equal(vSnapBiz, vBase));
    if (!equal(vSnapBiz, vBase)) json('v2b-mismatch', { expected: vBase, actual: vSnapBiz, v1 });
    willDialog({ accept: true });
    const rp = await centerOf(`(()=>{const f=document.getElementById("projectHistoryFold");const b=[...f.querySelectorAll("button")].find(x=>x.textContent.trim()==="恢复到此版本");if(!b)throw Error("无恢复按钮");return b})()`);
    await clickAt(rp); await sleep(400);
    await until('(window.__toasts||[]).some(t=>t.includes("已恢复"))');
    check('V3 恢复到该版本：内容业务级回到快照', equal(await ev('__snap()'), vBase));
    const v3 = await ev('await ChoreoProjects.listVersions(store.projectId)');
    check('V4 恢复前自动存档「恢复版本前自动保存」', v3.some(v => v.label === '恢复版本前自动保存'));
    const sats = v3.map(v => v.savedAt);
    check('V5 版本列表新→旧排序', sats.every((s, i) => i === 0 || sats[i - 1] >= s));
    await shot('v-versions');
    await ev('document.getElementById("projectCenterClose")?.click()'); await sleep(200);

    // ================= §X 异常关机恢复 =================
    const xOldStr = await ev('JSON.stringify(projectRecord().content)');
    await ev('store.dancers[0].actionClips.push({id:store.nextClipId++,start:120,duration:2,data:{name:"崩溃探针",command:"/x1 motion",category:"usual"}});saveHistory();render()');
    await sleep(500);
    const x1 = await ev('({m:JSON.parse(localStorage.getItem("choreo_autosave")||"null"),pid:store.projectId,rec:(await (window.__readRec=window.__readRec||((pid)=>new Promise((res,rej)=>{const rq=indexedDB.open("choreo3dproj");rq.onsuccess=()=>{const db=rq.result;const g=db.transaction("projects").objectStore("projects").get(pid);g.onsuccess=()=>{db.close();res(g.result)};g.onerror=()=>{db.close();rej(g.error)}};rq.onerror=()=>rej(rq.error)})))(store.projectId))})');
    const mirrorHas = x1.m && x1.m.projectId === x1.pid && JSON.stringify(x1.m.content).includes('崩溃探针');
    check('X1 编辑后 localStorage 镜像持有最新内容且不旧于记录', mirrorHas && x1.m.savedAt >= x1.rec.updatedAt);
    // X2 确定性崩溃余态：IDB 记录回拨为旧内容（= 上次 IDB 未写完就关机），镜像保持最新 → 重开按镜像恢复
    await ev(`window.__xOldC=${JSON.stringify(xOldStr)}`);
    await ev(`(async()=>{const pid=store.projectId;const older=JSON.parse(window.__xOldC);
      const rq=indexedDB.open('choreo3dproj');const db=await new Promise((res,rej)=>{rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error)});
      const tx=db.transaction('projects','readwrite');
      tx.objectStore('projects').get(pid).onsuccess=e=>{const rec=e.target.result;rec.content=older;rec.updatedAt=Date.now()-60000;tx.objectStore('projects').put(rec)};
      await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});db.close()})()`);
    await closeGraceful(); await open();
    await softUntil('(await ChoreoProjects.listVersions(store.projectId)).some(v=>v.label==="异常关闭自动恢复")', 40);
    await softUntil('(window.__toasts||[]).some(t=>t.includes("没正常关闭"))', 80); // 恢复 toast 在开页 +4.5s
    const x2 = await ev('({biz:__snap(),vs:await ChoreoProjects.listVersions(store.projectId),toasts:window.__toasts||[]})');
    check('X2 崩溃余态重开：按镜像恢复最新内容', JSON.stringify(x2.biz).includes('崩溃探针'));
    check('X2b 自动存「异常关闭自动恢复」版本', x2.vs.some(v => v.label === '异常关闭自动恢复'));
    check('X2c 出现恢复提示 toast', x2.toasts.some(t => t.includes('没正常关闭') && t.includes('恢复到最近的编辑')));
    // X3 真实硬杀：编辑 → 500ms 落盘余量 → taskkill /T /F → 重开最新编辑仍在
    await ev('store.dancers[0].actionClips.push({id:store.nextClipId++,start:130,duration:2,data:{name:"硬杀探针",command:"/x2 motion",category:"usual"}});saveHistory();render()');
    await sleep(500);
    await closeHard(); await open();
    const x3 = await ev('({biz:__snap(),toasts:window.__toasts||[],n:(await ChoreoProjects.listProjects()).length})');
    const hardOk = JSON.stringify(x3.biz).includes('硬杀探针') && JSON.stringify(x3.biz).includes('崩溃探针');
    check('X3 真实硬杀（taskkill /T /F）后重开最新编辑仍在', hardOk, x3.toasts.some(t => t.includes('没正常关闭')) ? '走镜像恢复分支' : '走 IDB 已写完分支');
    check('X4 硬杀重开项目数不受影响', x3.n === 1, String(x3.n));
    await shot('x-after-hardkill');
    json('x-state', { x2toasts: x2.toasts, x3toasts: x3.toasts });

    // ================= §E 编辑基础（专用合成项目） =================
    const rec = await ev('(await ChoreoProjects.createProject("WP3编辑基础"))');
    await ev(`await switchProject(${JSON.stringify(rec.id)})`);
    await ev(`(function(){store.dancers=[
      {id:0,name:'WP3甲',actionClips:[],switchClips:[],lyricClips:[]},
      {id:1,name:'WP3乙',actionClips:[],switchClips:[],lyricClips:[]}];
     store.dancerCount=2;store.globalLyrics=[];store.markers=[];store.totalDuration=300;
     store.loopA=store.loopB=null;store.currentTime=0;clearClipSelection();store.selectedClip=null;
     window.mk=(start,dur,nm,cmd)=>({id:store.nextClipId++,start:start,duration:dur,data:{name:nm,command:cmd,category:'usual'}});
     store.dancers[0].actionClips=[mk(10,3,'甲A','/a1 motion'),mk(20,3,'甲B','/b1 motion'),mk(30,3,'甲C','/c1 motion')];
     store.dancers[1].actionClips=[mk(15,3,'乙D','/d1 motion')];
     recalcNextClipId();saveHistory();render();store.pps=20;render();document.getElementById('timelineWrap').scrollLeft=0;})()`);
    await sleep(300);
    const clips = await ev('store.dancers[0].actionClips.map(c=>({id:c.id,n:c.data.name}))');
    const [A, B, C] = clips.map(c => c.id);
    await ev('seekTimelinePosition(0)');
    console.log('E1DBG', JSON.stringify(await ev(`(()=>{const r=${clipRectJs(A)};return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},vw:{w:innerWidth,h:innerHeight}}})()`)));
    // E1 删除键 + 撤销 + 重做
    await clickClip(A);
    check('E1a 单击选中片段', await ev('store.selectedClip&&store.selectedClip.id') === A);
    await key('Delete', { code: 'Delete', vk: 46 });
    check('E1b Delete 键删除片段', (await byCmd('/a1 motion')).length === 0);
    await key('z', { modifiers: 2 });
    check('E1c Ctrl+Z 撤销恢复片段', (await byCmd('/a1 motion')).length === 1);
    await key('y', { modifiers: 2 });
    check('E1d Ctrl+Y 重做再次删除', (await byCmd('/a1 motion')).length === 0);
    await key('z', { modifiers: 2 });
    // E2 Ctrl+点击加选
    await ev('clearClipSelection()'); await clickClip(B);
    await clickClip(C, 2);
    check('E2 Ctrl+点击加选到 2 条', await selCount() === 2, '选中 ' + (await selCount()) + ' 条');
    // E3 框选：轨道空白处按下拖动。起手必须在首片段之前的纯 lane-body——
    // 相邻片段之间的空隙被 P1-A「等待带」(.wait-band) 占据，它点按=选中后一动作，设计上不做框选起手
    await ev('clearClipSelection()');
    const gap = await ev(`(()=>{const ra=${clipRectJs(A)},rc=${clipRectJs(C)};return {x1:Math.max(ra.x-40,16),y:ra.y+ra.h/2,x2:rc.x+rc.w+20}})()`);
    await ev('window.__mdLog=[];const c=document.getElementById("timelineCanvas");if(c)c.addEventListener("mousedown",e=>__mdLog.push({t:String(e.target.className),x:e.clientX,y:e.clientY}),true)');
    await mouse('mousePressed', gap.x1, gap.y); await sleep(80);
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', gap.x1 + (gap.x2 - gap.x1) * i / 6, gap.y, { buttons: 1 });
    await sleep(120); await mouse('mouseReleased', gap.x2, gap.y); await sleep(300);
    const boxN = await selCount();
    console.log('E3DBG', JSON.stringify(await ev(`({log:window.__mdLog,el:(()=>{const el=document.elementFromPoint(${gap.x1},${gap.y});return el?{tag:el.tagName,cls:String(el.className)}:null})()})`)));
    check('E3 轨道空白拖动框选 ≥2 条（含 toast）', boxN >= 2 && (await toasts()).some(t => t.includes('框选了')), '选中 ' + boxN + ' 条');
    await shot('e-marquee');
    // E4 复制粘贴（类型化剪贴板走 B7b 对话框）
    await ev('clearClipSelection()'); await clickClip(B); await clickClip(C, 2);
    const beforeB = (await byCmd('/b1 motion')).length, beforeC = (await byCmd('/c1 motion')).length;
    await key('c', { modifiers: 2 });
    check('E4a Ctrl+C 复制提示', (await toasts()).some(t => t.includes('已复制')));
    await key('v', { modifiers: 2 });
    await until('document.getElementById("b7bPasteDlg")');
    const okEnabled = await softUntil('!document.getElementById("b7bPasteOk").disabled', 40);
    await shot('e-paste-dialog');
    if (okEnabled) await click('#b7bPasteOk');
    await softUntil('(window.__toasts||[]).some(t=>t.includes("已粘贴"))', 40);
    check('E4b 粘贴对话框确认后副本落地（B/C 各 +1）', okEnabled && (await byCmd('/b1 motion')).length === beforeB + 1 && (await byCmd('/c1 motion')).length === beforeC + 1);
    await key('z', { modifiers: 2 });
    check('E4c 粘贴可一次撤销', (await byCmd('/b1 motion')).length === beforeB);
    // E5 方向键整组平移
    await ev('clearClipSelection()'); await clickClip(B); await clickClip(C, 2);
    const pre = (await byCmd('/b1 motion')).concat(await byCmd('/c1 motion'));
    await key('ArrowRight', { code: 'ArrowRight', vk: 39 });
    const post = (await byCmd('/b1 motion')).concat(await byCmd('/c1 motion'));
    const moved = post.every((c, i) => Math.abs(c.start - (pre[i].start + 0.5)) < 1e-9);
    const spacing = Math.abs((post[1].start - post[0].start) - (pre[1].start - pre[0].start)) < 1e-9;
    check('E5 方向键整组平移 0.5s 且间距保持', moved && spacing);
    await key('z', { modifiers: 2 });
    // E6 右键「对齐到播放头」
    await ev('clearClipSelection()'); await clickClip(B); await clickClip(C, 2);
    await ev('seekTimelinePosition(25)');
    const r6 = await ev(clipRectJs(B));
    await clickAt({ x: r6.x + r6.w / 2, y: r6.y + r6.h / 2 }, { button: 'right' });
    const menuShown = await softUntil('document.getElementById("ctxMenu").classList.contains("show")', 15);
    const hasAlign = menuShown ? await ev(`[...document.getElementById("ctxMenu").querySelectorAll(".ctx-it")].some(x=>x.textContent.includes("对齐到播放头"))`) : false;
    if (hasAlign) await ev(`[...document.getElementById("ctxMenu").querySelectorAll(".ctx-it")].find(x=>x.textContent.includes("对齐到播放头")).click()`);
    else await ev('alignSelectionToPlayhead()');
    await sleep(300);
    const starts = (await byCmd('/b1 motion')).concat(await byCmd('/c1 motion')).map(c => c.start);
    check('E6 所选条起点对齐到播放头 25s' + (hasAlign ? '' : '（右键菜单缺项，走同函数入口——登记）'), starts.every(s => Math.abs(s - 25) < 1e-9), JSON.stringify(starts));
    await key('z', { modifiers: 2 });
    // E7 插入时间（工具页高级按钮，prompt 输入 2 秒）
    await ev('store.markers=[{id:"mk-e7",t:28,name:"插入前标记"}];saveHistory();render()');
    await ev('seekTimelinePosition(5)');
    const preE7 = await ev('({b:store.dancers[0].actionClips.map(c=>c.start),m:store.markers.map(x=>x.t)})');
    await openAdvancedTools();
    willDialog({ accept: true, promptText: '2' }, { accept: true }); // 插入时间：时长 prompt ＋ 预检确认两步
    await click('#toolsPage button', 4);
    await sleep(600);
    const postE7 = await ev('({b:store.dancers[0].actionClips.map(c=>c.start),m:store.markers.map(x=>x.t)})');
    check('E7 播放头插入 2s：≥5s 片段与标记整体后移', postE7.b.every((s, i) => Math.abs(s - (preE7.b[i] + 2)) < 1e-9) && Math.abs(postE7.m[0] - (preE7.m[0] + 2)) < 1e-9, JSON.stringify({ preE7, postE7 }));
    await key('z', { modifiers: 2 });
    // E8 删除时段（区间恰覆盖乙D）
    await ev('seekTimelinePosition(15)');
    await openAdvancedTools();
    willDialog({ accept: true, promptText: '3' }, { accept: true }); // 删除时段同样两步
    await click('#toolsPage button', 5);
    await sleep(600);
    check('E8 删除 [15,18] 时段：乙D 移除、甲组不动', (await byCmd('/d1 motion')).length === 0 && (await byCmd('/a1 motion')).length === 1 && (await byCmd('/b1 motion')).length === 1);
    await key('z', { modifiers: 2 });
    // E9 A/B 循环
    await ev('seekTimelinePosition(10)'); await loopBarBtn('A');
    check('E9a 设 A 点后 B 未设（循环未生效）', (await ev('store.loopA')) === 10 && !(await ev('edHasLoop()')));
    await ev('seekTimelinePosition(20)'); await loopBarBtn('B');
    check('E9b A=10 B=20 循环生效', (await ev('edHasLoop()')) === true && (await ev('store.loopA')) === 10 && (await ev('store.loopB')) === 20);
    await loopBarBtn('✕');
    check('E9c ✕ 清除循环', (await ev('edHasLoop()')) === false && (await ev('store.loopA')) === null);
    // E10 段落标记
    await ev('seekTimelinePosition(12)'); await loopBarBtn('⚑+');
    const mkE10 = await ev('store.markers.find(m=>Math.abs(m.t-12)<1e-9)||null'); // 标记按时间排序插入，不能取 last
    const flagVis = await ev(`[...document.querySelectorAll('[title]')].some(e=>e.title.includes(${JSON.stringify(mkE10 && mkE10.name || '')}+' @'))`);
    check('E10a ⚑+ 在播放头加标记（store＋标尺旗标可见）', !!mkE10 && mkE10.t === 12 && flagVis, JSON.stringify(mkE10));
    const flagP = await centerOf(`(()=>{const el=[...document.querySelectorAll('[title]')].find(e=>e.title.includes(${JSON.stringify(mkE10 && mkE10.name || '')}+' @'));if(!el)throw Error('旗标节点缺失');return el})()`);
    await clickAt(flagP, { button: 'right' });
    const mkMenu = await softUntil('document.getElementById("ctxMenu").classList.contains("show")', 15);
    willDialog({ accept: true, promptText: '副歌' });
    await ev(`[...document.getElementById("ctxMenu").querySelectorAll(".ctx-it")].find(x=>x.textContent.includes("改名")).click()`);
    await sleep(300);
    check('E10b 旗标右键改名生效', mkMenu && (await ev('store.markers.some(m=>m.name==="副歌")')));
    // E11 独奏/静音
    await ev('store.dancers.forEach(d=>{d.solo=false;d.mute=false});saveHistory();render()');
    const soloBtn1 = `[...document.querySelectorAll("button")].filter(b=>b.textContent.trim()==="只看这位")[1]`;
    const p1 = await centerOf(soloBtn1); await clickAt(p1); await sleep(250);
    const e11a = await ev('({s1:store.dancers[1].solo,m0:edIsMuted(0),m1:edIsMuted(1),lane:!!document.querySelector(".muted-lane")})');
    check('E11a 舞者 1「只看这位」：其余按静音口径＋轨道调暗', e11a.s1 === true && e11a.m0 === true && e11a.m1 === false && e11a.lane, JSON.stringify(e11a));
    await clickAt(p1); await sleep(200); // 再点取消
    const muteBtn0 = `[...document.querySelectorAll("button")].filter(b=>b.textContent.trim()==="暂时隐藏这位")[0]`;
    const q0 = await centerOf(muteBtn0); await clickAt(q0); await sleep(250);
    const e11b = await ev('({mu0:store.dancers[0].mute,m0:edIsMuted(0),lane:!!document.querySelector(".muted-lane"),rec:ChoreoDocWire.loadProjection(JSON.parse(JSON.stringify(projectRecord().content))).proj.dancers[0].mute})');
    check('E11b 「暂时隐藏这位」：静音生效且随项目保存', e11b.mu0 === true && e11b.m0 === true && e11b.lane && e11b.rec === true, JSON.stringify(e11b));
    await clickAt(q0); await sleep(200); // 取消
    // E12 收尾：A/B 会话级不进项目、标记进项目
    const e12 = await ev('(function(){const pr=projectRecord().content;const pj=ChoreoDocWire.loadProjection(JSON.parse(JSON.stringify(pr))).proj;return {noLoop:!("loopA"in pr)&&!("loopB"in pr),mkInDoc:(pj.markers||[]).length}})()');
    check('E12 标记随项目保存、A/B 循环不进项目文件', e12.noLoop && e12.mkInDoc >= 1, JSON.stringify(e12));
    await shot('e-final');

    check('Z1 全程页面零未捕获异常', errors.length === 0, errors.length ? JSON.stringify(errors.slice(0, 3)) : '');
    json('checks', checks); json('dialogs', dialogs.map(d => ({ type: d.type, message: d.message }))); json('toasts-all', await toasts());
    await closeGraceful();
    const failed = checks.filter(c => !c.ok).length;
    console.log(`结果：${checks.length - failed} 通过 / ${failed} 失败`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('FATAL', err && err.stack || err);
    try { json('checks', checks); json('fatal', String(err && err.stack || err)); await shot('fatal'); } catch { }
    try { await closeGraceful(); } catch { }
    process.exit(1);
  }
})();
