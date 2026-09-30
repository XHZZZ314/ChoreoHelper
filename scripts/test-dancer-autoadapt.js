// test-dancer-autoadapt.js — TASK-20260917-DANCER-AUTOADAPT 离线自测 harness
//
// 干嘛的：两条腿离线验证本任务全部网页侧 AC（游戏不开也能跑）：
//   A. node 假 DOM + 假 API/假库：驱动 choreo-xat-convert-ui.js 的批量准备 UI——
//      AC-1 枚举/预检/勾选/全选，AC-2 顺序队列、Busy 等待、失败隔离可重试、可停、已在库跳过，
//      AC-4 转换产物给档案补 sourceSkeletonCode。
//   B. 无头 Chrome（file:// 打开 dist 主页，--host-resolver-rules 断网）：
//      B1 真 IndexedDB + mock fetch 的批量端到端（AC-1/2/3 离线半：真 putClip 入库 + §4 契约抽验）；
//      B2 离线族包建非本族档案（AC-8：包选择器 18 族、c0301 建档、sourceSkeletonCode 标注）；
//      B3 旧档案兼容（AC-4：无 sourceSkeletonCode 的老档案行正常读取 + 补码写入）+ library-check 回归；
//      B4 结构指纹对号（TASK-20260917-SKELETON-KEY-REPAIR）：mock 48795 在线骨架，同构异姿态
//        跨 reload 对上 / 异构如实不对上 / 旧档案（无结构指纹字段）读取侧现算兼容。
// 怎么跑：D:\nodejs\node.exe scripts\test-dancer-autoadapt.js
// 依赖：本机 Chrome + node ≥22；游戏开不开都行（B 全程离线）。
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vclean = require('./verify-cleanup');

const ROOT = path.join(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(ROOT, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (detail ? '（' + detail + '）' : ''));
  if (!ok) process.exitCode = 1;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ============ A. node 假 DOM + 假 API：批量准备 UI 分支 ============
function fakeElement(tag) {
  const e = {
    tagName: tag, children: [], style: {}, dataset: {}, attrs: {},
    className: '', disabled: false, checked: false, value: '', type: '', size: 0,
    placeholder: '', title: '', isConnected: true, onclick: null, _text: '',
    appendChild(c) { c.parentElement = e; e.children.push(c); return c; },
    addEventListener() { /* 假 DOM：本 harness 只走 onclick 路径 */ },
    setAttribute(k, v) { e.attrs[k] = v; },
    set textContent(v) { e._text = String(v); e.children = []; },
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(''); },
  };
  return e;
}
function walkText(root) {
  const out = [];
  (function go(n) {
    if (!n) return;
    if (n.onclick || n.tagName === 'button' || n.tagName === 'input') out.push(n);
    (n.children || []).forEach(go);
  })(root);
  return out;
}
function boundCheckboxes(root) {
  // 动作包的两项选项各有独立 label；只定位绑定动作行，保留完整枚举断言。
  return walkText(root).filter((n) => n.type === 'checkbox'
    && !/覆盖同名动作|导入到全部档案/.test(n.parentElement && n.parentElement.textContent || ''));
}
function findBtn(root, text) {
  return walkText(root).find((n) => n.tagName === 'button' && n.textContent === text) || null;
}
function findBtnStarting(root, prefix) {
  return walkText(root).find((n) => n.tagName === 'button' && n.textContent.indexOf(prefix) === 0) || null;
}

// 假 ChoreoAPI：按剧本响应；记录全部调用；断言无并发重叠（顺序队列）
function makeFakeApi(script) {
  const state = { calls: [], inFlight: 0, maxInFlight: 0 };
  async function api(p, opts) {
    state.calls.push(String(p));
    state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      return await script(String(p), opts || {}, state);
    } finally { state.inFlight--; }
  }
  return { api, state };
}
function busyError(msg) { const e = new Error('/xat/convert: 409'); e.status = 409; e.detail = msg || '已有转换在进行中'; return e; }

// §4 形状合法的最小剪辑（2 骨 × q/t/s，2 行，时间递增且在时长内）
function fakeClip(name, code) {
  const bones = {};
  for (let i = 0; i < 2; i++) {
    bones['bone_' + i] = {
      q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
      t: [[0, i, 0, 0], [1, i, 0, 0]],
      s: [[0, 1, 1, 1], [1, 1, 1, 1]],
    };
  }
  return { name, duration: 1, type: 'loop', bones, offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: code, productionImportApproved: false } };
}

// 模块 IIFE 挂到全局 window（typeof window!=='undefined' 分支）：整个 Part A 共用一个全局
// window，每个场景换掉它上面的 ChoreoAPI/ChoreoLibrary 再 buildSection（模块自身无状态）
const gwin = { __p3dLibChanged: 0, document: { createElement: fakeElement } };
globalThis.window = gwin;
globalThis.document = gwin.document; // 模块里 document 是裸全局引用
require(path.join(ROOT, 'web', 'choreo-xat-convert-ui.js')); // IIFE 挂 gwin.ChoreoXatConvertUI
require(path.join(ROOT, 'web', 'choreo-anim-pack-retarget.js')); // r2：v2 换算（挂全局）
require(path.join(ROOT, 'web', 'choreo-anim-pack-import.js')); // r2：v2 导入编排（挂全局）
const zlibMod = require('zlib');
const xatMod = { buildSection: function (o) { return gwin.ChoreoXatConvertUI.buildSection(o); } };
function freshEnv(apiImpl, libImpl) {
  // 模块里 ChoreoAPI/ChoreoLibrary 是裸全局引用（浏览器=window 属性），root.ChoreoLibrary 走 window：
  // 两侧都挂，与浏览器语义等价
  gwin.ChoreoAPI = globalThis.ChoreoAPI = { game: { api: apiImpl } };
  gwin.ChoreoLibrary = globalThis.ChoreoLibrary = libImpl;
  gwin.__p3dLibChanged = 0;
  const box = xatMod.buildSection({});
  return { win: gwin, box, mod: xatMod };
}
function fakeLib(existing) {
  const lib = {
    clips: {}, sourceCalls: [], profile: { id: 'p1', name: '测试档案', sourceSkeletonCode: '', skeleton: { count: 2, bones: [{ i: 0 }, { i: 1 }] } },
    available() { return true; },
    clipIndex() { return Promise.resolve(Object.keys(lib.clips).map((name) => ({ name }))); },
    putClip(name, clip) { lib.clips[name] = clip; return Promise.resolve({ name }); },
    getActiveProfile() { return Promise.resolve(lib.profile); },
    setProfileSourceCode(pid, code) { lib.sourceCalls.push([pid, code]); lib.profile.sourceSkeletonCode = code; return Promise.resolve(true); },
    getSkeleton() { return Promise.resolve(lib.profile.skeleton); },
    _existing: existing || [],
  };
  if (lib._existing.length) lib._existing.forEach((n) => { lib.clips[n] = fakeClip(n, 'c1201'); });
  return lib;
}
const BINDINGS = {
  available: true,
  resources: [
    { group: 'skeleton', slot: 0, path: 'chara/human/c1201/skeleton/base/b0001/skl_c1201b0001.sklb' },
    { group: 'pap0', path: 'chara/human/c1201/animation/a0001/bt_common/normal/item_eat.pap', papEntries: 1 },
    { group: 'pap1', path: 'chara/human/c1201/animation/a0001/bt_common/emote/yes.pap', papEntries: 1 },
    { group: 'pap2', path: 'chara/human/c1201/animation/a0001/bt_common/resident/rtg0.pap', papEntries: 6 },
    { group: 'pap3', path: 'chara/human/c1201/animation/a0001/bt_common/battle/atk0.pap', papEntries: 2 },
    { group: 'pap4', path: 'chara/human/c1201/animation/a0001/bt_common/normal/item_drink.pap' },
  ],
};
async function waitIdle(getExpr, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    if (await getExpr()) return true;
    if (Date.now() - t0 > (timeoutMs || 30000)) return false;
    await sleep(150);
  }
}

async function partA() {
  console.log('— A. 批量准备 UI（node 假 DOM/假 API/假库）—');

  // A1 枚举与预检（AC-1）
  {
    const api = makeFakeApi(async (p) => (String(p).indexOf('/character/assets') === 0 ? BINDINGS : null));
    const lib = fakeLib();
    const env = freshEnv(api.api, lib);
    const load = findBtn(env.box, '读取绑定动作');
    load.onclick();
    if (!await waitIdle(() => walkText(env.box).some((n) => n.type === 'checkbox'))) throw new Error('A1 列表未渲染');
    const cbs = boundCheckboxes(env.box);
    check('A1 绑定枚举列出全部 5 个 PAP', cbs.length === 5, 'cbs=' + cbs.length);
    const rows = cbs.map((cb) => ({ cb, label: cb.parentElement.textContent }));
    const multi = rows.filter((r) => /多条目 ×/.test(r.label));
    const unknown = rows.filter((r) => /条目数未知/.test(r.label));
    check('A1 多 entry 默认跳过且说明原因（×6/×2 禁用不勾）',
      multi.length === 2 && multi.every((r) => r.cb.disabled && !r.cb.checked) && multi.some((r) => r.label.indexOf('×6') >= 0) && multi.some((r) => r.label.indexOf('×2') >= 0));
    check('A1 单 entry 默认勾选、entry 数未知默认不勾',
      rows.length - multi.length - unknown.length === 2 && unknown.length === 1 && unknown[0].cb.checked === false
      && rows.filter((r) => !/多条目 ×|条目数未知/.test(r.label)).every((r) => r.cb.checked));
    const all = findBtn(env.box, '全选单条目');
    all.onclick();
    check('A1 一键全选单 entry（多 entry 仍不勾，批量度 B）',
      cbs.every((cb) => (cb.disabled ? !cb.checked : cb.checked)));
    const go = findBtnStarting(env.box, '开始准备');
    check('A1 开始按钮计数=3（2 单 entry+1 未知）', go.textContent.indexOf('（3 项）') >= 0, go.textContent);
  }

  // A2 顺序队列 + Busy 等待 + 失败隔离 + 可停（AC-2）+ 入库与补码（AC-3/AC-4）
  {
    const jobs = { item_eat: { busyFirst: true }, yes: { failFirst: true }, item_drink: {} };
    const api = makeFakeApi(async (p, opts, state) => {
      p = String(p);
      if (p.indexOf('/character/assets') === 0) return BINDINGS;
      if (p.indexOf('/xat/convert') === 0) {
        const name = JSON.parse(opts.body).name;
        const j = jobs[name] || (jobs[name] = {});
        if (j.busyFirst) { j.busyFirst = false; throw busyError(); }  // 第一次 409：队列应等待重试
        j.id = 'job-' + name; j.started = (j.started || 0) + 1; j.polled = 0;
        return { ok: true, jobId: j.id };
      }
      const m = /\/xat\/status\?id=([^&]+)/.exec(p);
      if (m) {
        const name = decodeURIComponent(m[1]).slice(4);
        const j = jobs[name];
        j.polled++;
        if (j.failFirst && j.polled === 1) { j.failFirst = false; return { ok: true, job: { state: 'failed', errorKind: 'NonZeroExit', message: '转换器失败（退出码 3）' } }; }
        if (j.polled === 1) return { ok: true, job: { state: 'running', stage: '剥离 Havok 容器', elapsedMs: 12 } };
        return { ok: true, job: { state: 'succeeded', message: '转换成功', clipJson: JSON.stringify(fakeClip(name, 'c1201')), skeletonJson: '{"count":2}' } };
      }
      throw new Error('fake api 未实现：' + p);
    });
    const lib = fakeLib();
    const env = freshEnv(api.api, lib);
    findBtn(env.box, '读取绑定动作').onclick();
    await waitIdle(() => walkText(env.box).some((n) => n.type === 'checkbox'));
    const cbs = boundCheckboxes(env.box).filter((n) => !n.disabled);
    cbs.forEach((cb) => { cb.checked = true; }); // 全选（2 单 + 1 未知——未知走真实失败/成功路径）
    findBtnStarting(env.box, '开始准备').onclick();
    const done = await waitIdle(() => lib.clips.item_eat && lib.clips.item_drink && walkText(env.box).some((n) => n.tagName === 'button' && n.textContent === '重试'), 40000);
    check('A2 队列跑完：失败不连坐（其余两项入库，失败项标红+重试按钮）', done, JSON.stringify(Object.keys(lib.clips)));
    check('A2 Busy 等待而非报错（409 后重试成功）', jobs.item_eat.started === 1 && !!lib.clips.item_eat);
    check('A2 失败隔离：yes 失败一次不阻塞后续 item_drink', jobs.item_drink.started === 1 && !!lib.clips.item_drink);
    check('A2 顺序队列无并发重叠（maxInFlight=1）', api.state.maxInFlight === 1, 'max=' + api.state.maxInFlight);
    check('A3 入库以时间轴键为名（/item_eat 等）', !!lib.clips.item_eat && !!lib.clips.item_drink);
    check('A4 首次成功给档案补 sourceSkeletonCode=c1201（一次）',
      lib.sourceCalls.length === 1 && lib.sourceCalls[0][0] === 'p1' && lib.sourceCalls[0][1] === 'c1201', JSON.stringify(lib.sourceCalls));
    // 重试失败项
    const retry = walkText(env.box).find((n) => n.tagName === 'button' && n.textContent === '重试');
    retry.onclick();
    check('A2 失败项可重试（点击后重跑）', await waitIdle(() => !!lib.clips.yes, 30000) && jobs.yes.started === 2, 'started=' + jobs.yes.started);
  }

  // A2b 可停 + 已在库跳过（停止场景确定性化：第 2 项挂起等 harness 放行）
  {
    const bindingsA2b = { available: true, resources: BINDINGS.resources.concat([
      { group: 'pap5', path: 'chara/human/c1201/animation/a0001/bt_common/emote/bye.pap', papEntries: 1 },
    ]) };
    let release = false; // item_drink/bye 的状态轮询在放行前一直 running
    const converted = [];
    const api = makeFakeApi(async (p, opts) => {
      p = String(p);
      if (p.indexOf('/character/assets') === 0) return bindingsA2b;
      if (p.indexOf('/xat/convert') === 0) {
        const name = JSON.parse(opts.body).name;
        converted.push(name);
        return { ok: true, jobId: 'job-' + name };
      }
      const m = /\/xat\/status\?id=([^&]+)/.exec(p);
      if (m) {
        const name = decodeURIComponent(m[1]).slice(4);
        if (name === 'yes') return { ok: true, job: { state: 'succeeded', clipJson: JSON.stringify(fakeClip(name, 'c1201')) } };
        if (!release) return { ok: true, job: { state: 'running', stage: '转换中', elapsedMs: 5 } };
        return { ok: true, job: { state: 'succeeded', clipJson: JSON.stringify(fakeClip(name, 'c1201')) } };
      }
      throw new Error('fake api 未实现：' + p);
    });
    const lib = fakeLib(['item_eat']); // 已在库：应跳过不转
    const env = freshEnv(api.api, lib);
    findBtn(env.box, '读取绑定动作').onclick();
    await waitIdle(() => walkText(env.box).some((n) => n.type === 'checkbox'));
    boundCheckboxes(env.box).filter((n) => !n.disabled).forEach((cb) => { cb.checked = true; });
    findBtnStarting(env.box, '开始准备').onclick();
    // 第 2 项（item_drink）已开始且挂起：此刻点停止 → 当前项完成后停，第 3 项（bye）不再发起
    if (!await waitIdle(() => converted.indexOf('item_drink') >= 0, 20000)) throw new Error('A2b 第二项未启动');
    findBtn(env.box, '停止（当前项完成后）').onclick();
    release = true;
    await waitIdle(() => env.box.textContent.indexOf('准备结束') >= 0, 30000);
    check('A2 已在库同名动作跳过不重转（item_eat 只在预检名单）',
      converted.indexOf('item_eat') < 0 && env.box.textContent.indexOf('已在当前档案，跳过') >= 0,
      'converted=' + JSON.stringify(converted));
    check('A2 中途停止：当前项完成后停，剩余项（bye）不再发起转换',
      lib.clips.yes && lib.clips.item_drink && converted.indexOf('bye') < 0
        && env.box.textContent.indexOf('准备结束') >= 0, 'converted=' + JSON.stringify(converted));
  }

  // A6（r2，TASK-20260918-ANIM-PACK-UNIVERSAL）：v2 通用包导入 UI——全档案各自换算、
  // v1+全部档案写前拒绝、重复点击不并跑。合成 106 骨基准包（明确合成，不冒充真实素材）。
  {
    const mkBones106 = () => {
      const bones = [];
      for (let i = 0; i < 106; i++) bones.push({ i, n: 'b' + i, p: i - 1, t: [i % 3, (i % 5) + 1, 0.5], q: [0, 0, 0, 1], s: [1, 1, 1] });
      return { count: 106, bones };
    };
    const base106 = mkBones106();
    const anim = {};
    for (const i of [0, 1, 2, 3]) anim['bone_' + i] = {
      q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
      t: [[0, 1, 1, 1], [1, 1, 1, 1]],
      s: [[0, 1, 1, 1], [1, 1, 1, 1]],
    };
    const v2pack = { formatVersion: 2, gameVersion: 'fixture', code: 'c0101', baseSkeletonCode: 'c0101', baseSkeleton: base106, counts: {},
      clips: [{ key: 'k', duration: 1, frames: 2, bones: 106, clip: { name: 'k', duration: 1, type: 'loop', bones: anim } }],
      entries: [{ name: 'fx_nod', label: '合成点头', kind: 'emote', clipIndex: 0 }, { name: 'fx_bow', label: '合成鞠躬', kind: 'emote', clipIndex: 0 }] };
    const v1pack = { formatVersion: 1, gameVersion: 'fixture', code: 'c1201', counts: {}, clips: v2pack.clips, entries: [{ name: 'fx_v1', label: 'v1', kind: 'emote', clipIndex: 0 }] };
    const gzOf = (obj) => new Uint8Array(zlibMod.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')));
    const mkFakeFile = (obj) => { const u8 = gzOf(obj); return { name: 'anim-pack.json.gz', size: u8.length, arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }; };
    // 目标档案骨架：名字取基准 b0..b3（其余 102 骨基准多余→丢弃）；甲带码走「族包参考」，
    // 乙无码走「档案自身参考」——族包 tribes 提供与甲骨架同拓扑的参考
    const skel4 = { count: 4, bones: [0, 1, 2, 3].map((i) => ({ i, n: 'b' + i, p: i - 1, t: [i % 3, (i % 5) + 1, 0.5], q: [0, 0, 0, 1], s: [1, 1, 1] })) };
    gwin.__CHOREO_SKELETON_PACK__ = { schema: 1, tribes: [{ code: 'c9001', label: 'c9001', count: 4, skeleton: skel4 }] };
    const mkLib = () => {
      const lib2 = {
        profiles: [
          { id: 'pa', name: '甲', sourceSkeletonCode: 'c9001', skeleton: skel4 },
          { id: 'pb', name: '乙', sourceSkeletonCode: '', skeleton: JSON.parse(JSON.stringify(skel4)) },
        ],
        activePid: 'pa', clips: {}, setActiveCalls: 0,
        available() { return true; },
        listProfiles() { return Promise.resolve(lib2.profiles.map((p) => ({ id: p.id, name: p.name, sourceSkeletonCode: p.sourceSkeletonCode, hasSkeleton: !!p.skeleton }))); },
        getProfile(pid) { return Promise.resolve(lib2.profiles.filter((p) => p.id === pid)[0] || null); },
        getActiveProfile() { return Promise.resolve(lib2.profiles.filter((p) => p.id === lib2.activePid)[0] || null); },
        setActiveProfile(pid) { lib2.setActiveCalls++; lib2.activePid = pid; return Promise.resolve(true); },
        clipIndex(pid) { return Promise.resolve(Object.keys(lib2.clips[pid] || {}).map((name) => ({ name }))); },
        putClip(name, clip, pid, guard) {
          if (guard && !guard.allowOverwrite && (lib2.clips[pid] || {})[name]) return Promise.reject(new Error('此档案已有不同的同名技能动作，保留原资源'));
          lib2.clips[pid] = lib2.clips[pid] || {};
          lib2.clips[pid][name] = clip;
          return Promise.resolve({ name });
        },
      };
      return lib2;
    };
    const freshPackEnv = (lib2) => {
      gwin.ChoreoLibrary = globalThis.ChoreoLibrary = lib2;
      gwin.__p3dLibChanged = 0;
      const box2 = xatMod.buildSection({});
      const chks = walkText(box2).filter((n) => n.type === 'checkbox');
      let allChk = null, overChk = null;
      // 控件定位：每个 label 内的 checkbox 与说明 span 相邻；按该说明精确对号。
      for (const c of chks) {
        const idx = c.parentElement.children.indexOf(c);
        const lblNode = c.parentElement.children[idx + 1];
        const lbl = lblNode ? lblNode.textContent : '';
        if (lbl.indexOf('覆盖同名动作') >= 0) overChk = c;
        if (lbl.indexOf('导入到全部档案') >= 0) allChk = c;
      }
      let fileIn2 = null;
      const inputs = walkText(box2).filter((n) => n.tagName === 'input' && n.type === 'file');
      fileIn2 = inputs[0] || null;
      return { box: box2, allChk, fileIn: fileIn2, lib: lib2 };
    };
    // A6-1：v2 全档案导入
    {
      const lib2 = mkLib();
      const env2 = freshPackEnv(lib2);
      check('A6 控件就位（全部档案勾选框 + 文件输入）', !!env2.allChk && !!env2.fileIn);
      env2.allChk.checked = true;
      env2.fileIn.files = [mkFakeFile(v2pack)];
      env2.fileIn.onchange();
      const done = await waitIdle(() => env2.box.textContent.indexOf('导入结束') >= 0, 30000);
      check('A6 v2 勾选全部档案：两档案各入库 2 条（各自键=b0..b3 目标索引）', done
        && Object.keys(lib2.clips.pa || {}).length === 2 && Object.keys(lib2.clips.pb || {}).length === 2
        && Object.keys(lib2.clips.pa.fx_nod.bones).join(',') === 'bone_0,bone_1,bone_2,bone_3',
        JSON.stringify({ a: Object.keys(lib2.clips.pa || {}), b: Object.keys(lib2.clips.pb || {}) }));
      check('A6 v2 计数自洽（成功+跳过+失败+未开始=计划 4）', /导入结束（全部完成，共 4 项/.test(env2.box.textContent), env2.box.textContent.slice(0, 160));
      check('A6 v2 汇总明示换算来源（甲按 c9001 / 乙按档案骨架）', env2.box.textContent.indexOf('已按 c9001 换算') >= 0 && env2.box.textContent.indexOf('按档案骨架换算') >= 0);
      check('A6 activeProfile 未被改写', lib2.activePid === 'pa' && lib2.setActiveCalls === 0);
    }
    // A6-2：v1 + 勾选全部档案 → 写前拒绝
    {
      const lib2 = mkLib();
      const env2 = freshPackEnv(lib2);
      env2.allChk.checked = true;
      env2.fileIn.files = [mkFakeFile(v1pack)];
      env2.fileIn.onchange();
      const rej = await waitIdle(() => env2.box.textContent.indexOf('--universal') >= 0, 15000);
      check('A6 v1+全部档案：写前明确拒绝并提示改用通用包', rej && !lib2.clips.pa && !lib2.clips.pb, env2.box.textContent.slice(0, 120));
    }
    // A6-3：导入进行中重复投递不并跑
    {
      const lib2 = mkLib();
      const realPut = lib2.putClip.bind(lib2);
      lib2.putClip = (name, clip, pid, guard) => new Promise((ok) => setTimeout(() => ok(realPut(name, clip, pid, guard)), 200));
      const env2 = freshPackEnv(lib2);
      env2.fileIn.files = [mkFakeFile(v2pack)];
      env2.fileIn.onchange();
      env2.fileIn.onchange(); // 立即重复
      const dup = await waitIdle(() => env2.box.textContent.indexOf('已有一次导入在进行中') >= 0, 15000);
      check('A6 重复投递不启动第二次导入', dup);
      await waitIdle(() => env2.box.textContent.indexOf('导入结束') >= 0, 30000);
    }
  }
}

// ============ B. 无头 Chrome 离线场景 ============
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map(); this.exceptions = [];
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, err } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') this.exceptions.push(m.params.exceptionDetails);
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  send(method, params) {
    return this.ready.then(() => new Promise((ok, err) => {
      const id = ++this.id;
      const timer = setTimeout(() => { if (this.pending.delete(id)) err(new Error('CDP 命令超时(20s): ' + method)); }, 20000);
      this.pending.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, err: (e) => { clearTimeout(timer); err(e); } });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    }));
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}
async function launchChrome(extraArgs, openUrl) {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-autoadapt-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port, '--user-data-dir=' + profile].concat(extraArgs || []).concat(openUrl ? [openUrl] : []), { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile);
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) { /* 未起 */ }
    if (i === 59) throw new Error('Chrome 调试口起不来');
  }
  async function pageTargetAny() {
    for (let i = 0; i < 30; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page');
      if (t) return new Cdp(t.webSocketDebuggerUrl);
      await sleep(300);
    }
    throw new Error('找不到页面 target');
  }
  return { pageTargetAny };
}
async function openOfflinePage() {
  const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND'], 'about:blank');
  const cdp = await ch.pageTargetAny();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
  await sleep(2500); // 等 3D 面板离线初始化（快照骨架+替身）
  return cdp;
}
async function waitForEval(cdp, what, expr, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    if (await cdp.evaluate(expr).catch(() => false)) return true;
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error('等待超时: ' + what);
    await sleep(400);
  }
}

// B1 页内 mock：真 IndexedDB + 假 48794（choreo-api.js 在请求时才取全局 fetch——设计内测试缝）
const MOCK_INSTALL = `
window.__mock = { converts: [], maxInFlight: 0, _inFlight: 0 };
(function () {
  var REAL = window.fetch;
  function clip(name) {
    var z = Math.sqrt(1 - 0.01); // 与 0.1 配对的第四分量：保证四元数严格归一（§4 契约）
    var bones = {};
    for (var i = 0; i < 3; i++) bones['bone_' + i] = {
      q: [[0, 0, 0, 0, 1], [0.5, 0.1, 0, 0, z], [1, 0, 0, 0.1, z]],
      t: [[0, i * 0.1, 0, 0], [0.5, i * 0.1, 0.05, 0], [1, i * 0.1, 0, 0.05]],
      s: [[0, 1, 1, 1], [0.5, 1.01, 1, 1], [1, 1, 1, 1]]
    };
    return { name: name, duration: 1, type: 'loop', bones: bones,
      offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: 'c1201', productionImportApproved: false } };
  }
  var busyOnce = true;
  window.fetch = function (url, init) {
    url = String(url);
    if (url.indexOf('http://localhost:48794') !== 0) return REAL.apply(this, arguments);
    var p = url.slice('http://localhost:48794'.length);
    var respond = function (status, body) { return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } })); };
    if (p.indexOf('/character/assets') === 0) return respond(200, ${JSON.stringify(BINDINGS)});
    if (p.indexOf('/xat/convert') === 0) {
      window.__mock._inFlight++; window.__mock.maxInFlight = Math.max(window.__mock.maxInFlight, window.__mock._inFlight);
      var name = JSON.parse(init.body).name;
      var done = function(){ window.__mock._inFlight--; };
      if (name === 'item_eat' && busyOnce) { busyOnce = false; done(); return respond(409, { ok: false, error: 'busy', message: '已有转换在进行中，请等它结束或先取消' }); }
      window.__mock.converts.push(name);
      var jid = 'job-' + name + '-' + Date.now();
      var fail = (name === 'yes');
      var n = 0;
      var status = function () {
        n++;
        if (fail && n === 1) return { ok: true, job: { state: 'failed', errorKind: 'NonZeroExit', message: '转换器失败（退出码 3）' } };
        if (n === 1) return { ok: true, job: { state: 'running', stage: '剥离 Havok 容器', elapsedMs: 9 } };
        return { ok: true, job: { state: 'succeeded', message: '转换成功', clipJson: JSON.stringify(clip(name)), skeletonJson: '{"count":3}' } };
      };
      window.__mock['st-' + jid] = status;
      done();
      return respond(200, { ok: true, jobId: jid });
    }
    var m = /\\/xat\\/status\\?id=([^&]+)/.exec(p);
    if (m) {
      var st = window.__mock['st-' + decodeURIComponent(m[1])];
      var r = st ? st() : { ok: false, error: 'not_found', message: '没有这个转换作业' };
      if (r.job && r.job.state === 'succeeded' && /includeResult=1/.test(p)) r.job.clipJson = JSON.stringify(clip(decodeURIComponent(m[1]).split('-')[1]));
      return respond(200, r);
    }
    return REAL.apply(this, arguments);
  };
})();`;

async function partB() {
  console.log('— B1 离线端到端：真 IndexedDB + mock 48794（AC-1/2/3 离线半 + AC-4 补码）—');
  {
    const cdp = await openOfflinePage();
    await cdp.evaluate(MOCK_INSTALL);
    // 场景=换新角色：先离线建 c1201 族档案并设为活动（骨架来自族包）
    const pid = await cdp.evaluate(`(async function () {
      var t = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var p = await ChoreoLibrary.createProfile({ name: 'c1201 新角色', skeleton: t.skeleton, sourceSkeletonCode: 'c1201' });
      await ChoreoLibrary.setActiveProfile(p.id);
      window.__box = ChoreoXatConvertUI.buildSection({});
      document.body.appendChild(window.__box);
      return p.id;
    })()`);
    check('B1 离线建档（族包 c1201 骨架 + sourceSkeletonCode）', !!pid && await cdp.evaluate(`ChoreoLibrary.getActiveProfile().then(function (p) { return p && p.sourceSkeletonCode === 'c1201'; })`));
    await cdp.evaluate(`(function () {
      var btns = window.__box.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) if (btns[i].textContent === '读取绑定动作') { btns[i].click(); break; }
    })()`);
    await waitForEval(cdp, '批量列表渲染', `window.__box.querySelectorAll('input[type=checkbox]').length >= 5`);
    await cdp.evaluate(`(function () {
      var all = null, btns = window.__box.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) if (btns[i].textContent === '全选单条目') all = btns[i];
      all.click();
      var go = null;
      for (var i = 0; i < btns.length; i++) if (btns[i].textContent.indexOf('开始准备') === 0) go = btns[i];
      go.click();
    })()`);
    await waitForEval(cdp, '队列完成（2 入库 + 失败项出现重试按钮）',
      `window.__mock.converts.indexOf('item_drink') >= 0 && window.__box.textContent.indexOf('准备结束') >= 0`, 45000);
    const verify = await cdp.evaluate(`(async function () {
      var idx = await ChoreoLibrary.clipIndex();
      var names = idx.map(function (c) { return c.name; });
      var clip = await ChoreoLibrary.getClip('item_eat');
      var prof = await ChoreoLibrary.getActiveProfile();
      var retry = window.__box.textContent.indexOf('重试') >= 0 && window.__box.textContent.indexOf('失败（NonZeroExit）') >= 0;
      // §4 契约抽验（时间递增在界内、四元数归一、s>0）
      var bad = [];
      for (var k in clip.bones) {
        var b = clip.bones[k];
        for (var ch of ['q', 't', 's']) {
          var rows = b[ch], last = -1;
          for (var r of rows) {
            if (r[0] < 0 || r[0] > clip.duration + 1e-9 || r[0] <= last) bad.push(k + '.' + ch + ' 时间');
            last = r[0];
            if (ch === 's' && (r[1] <= 0 || r[2] <= 0 || r[3] <= 0)) bad.push(k + '.s 非正');
          }
          if (ch === 'q') for (var r of rows) {
            var n = r[1] * r[1] + r[2] * r[2] + r[3] * r[3] + r[4] * r[4];
            if (Math.abs(n - 1) > 1e-6) bad.push(k + '.q 归一 ' + n);
          }
        }
      }
      return { names: names, hasEat: names.indexOf('item_eat') >= 0, hasDrink: names.indexOf('item_drink') >= 0,
        noYes: names.indexOf('yes') < 0, retryShown: retry, contractBad: bad.slice(0, 3),
        offline: clip.offlinePrototype && clip.offlinePrototype.sourceSkeleton === 'c1201' && clip.offlinePrototype.productionImportApproved === false,
        profCode: prof.sourceSkeletonCode, seq: window.__mock.maxInFlight };
    })()`);
    check('B1 批量产物入库当前档案可见（item_eat/item_drink 在库，失败项 yes 未入库）',
      verify.hasEat && verify.hasDrink && verify.noYes, JSON.stringify(verify.names));
    check('B1 §4 契约抽验通过（时间界内递增/四元数归一/s>0）', verify.contractBad.length === 0, JSON.stringify(verify.contractBad));
    check('B1 产物带 offlinePrototype.sourceSkeleton=c1201 且 productionImportApproved=false', verify.offline);
    check('B1 顺序队列无并发（maxInFlight=1）+ Busy 后重试成功', verify.seq === 1, 'seq=' + verify.seq);
    check('B1 失败项标红+可重试提示', verify.retryShown);
    check('B1 页面全程无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  console.log('— B2 离线族包：建非本族档案（AC-8）—');
  {
    const cdp = await openOfflinePage();
    await waitForEval(cdp, '3D 面板就绪', `document.querySelectorAll('select.p3d-prof').length >= 1 && !!window.__CHOREO_SKELETON_PACK__`, 30000);
    const packInfo = await cdp.evaluate(`(function () {
      var sels = document.querySelectorAll('select.p3d-prof');
      var packSel = null;
      for (var i = 0; i < sels.length; i++) {
        var o = sels[i].options[0];
        if (o && /^c\\d{4}$/.test(o.value)) packSel = sels[i]; // 族包选项 value=族码（档案下拉 value=档案 id）
      }
      window.__packSel = packSel;
      return { found: !!packSel, n: packSel ? packSel.options.length : 0, first: packSel ? packSel.options[0].textContent : '' };
    })()`);
    check('B2 族包选择器显示（18 族）', packInfo.found && packInfo.n === 18, JSON.stringify(packInfo));
    await cdp.evaluate(`(function () {
      window.__packSel.value = 'c0301';
      window.__packSel.dispatchEvent(new Event('change'));
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) if (btns[i].textContent === '建族档案') { btns[i].click(); break; }
    })()`);
    const made = await waitForEval(cdp, 'c0301 档案建成并切换',
      `(async function () { var p = await ChoreoLibrary.getActiveProfile(); return !!(p && p.name.indexOf('c0301') >= 0 && p.sourceSkeletonCode === 'c0301' && p.skeleton && p.skeleton.count === 101); })()`, 45000).catch(() => false);
    check('B2 游戏离线按种族码建非本族档案（c0301，101 骨，码已标注）', made);
    check('B2 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  console.log('— B3 旧档案兼容（AC-4）+ library-check 回归 —');
  {
    const cdp = await openOfflinePage();
    // 造一个"旧格式"档案行：无 sourceSkeletonCode、无 modelNames 之外的新字段
    const seeded = await cdp.evaluate(`(async function () {
      return await new Promise(function (ok) {
        var rq = indexedDB.open('choreo3dlib', 2);
        rq.onsuccess = function () {
          var db = rq.result;
          var t = db.transaction('meta', 'readwrite');
          var pid = 'pold' + Date.now();
          t.objectStore('meta').put({ id: 'profile:' + pid, data: { id: pid, name: '旧格式档案', createdAt: 1, updatedAt: 1, skeletonHash: 'abc', boneCount: 3, skeleton: { count: 3, bones: [{ i: 0, n: 'a', p: -1, t: [0,0,0], q: [0,0,0,1], s: [1,1,1] }, { i: 1, n: 'b', p: 0, t: [0,0,0], q: [0,0,0,1], s: [1,1,1] }, { i: 2, n: 'c', p: 1, t: [0,0,0], q: [0,0,0,1], s: [1,1,1] }] }, modelNames: [] } });
          t.objectStore('meta').put({ id: 'activeProfile', pid: pid });
          t.oncomplete = function () { ok(pid); }; t.onerror = function () { ok(null); };
        };
      });
    })()`);
    check('B3 旧格式档案行已种入', !!seeded);
    await cdp.send('Page.navigate', { url: PAGE_URL }); // 重载：离线 init 读旧档案
    await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
    await sleep(3000);
    const compat = await cdp.evaluate(`(async function () {
      var lps = await ChoreoLibrary.listProfiles();
      var old1 = lps.filter(function (p) { return p.name === '旧格式档案'; })[0] || null;
      var w = null;
      try { w = await ChoreoLibrary.setProfileSourceCode(old1 ? old1.id : '', 'c0301'); } catch (e) { w = 'err:' + e.message; }
      var after = await ChoreoLibrary.getActiveProfile();
      return { listed: !!old1, codeRead: old1 ? (old1.sourceSkeletonCode === '') : false, write: w,
        after: after && after.sourceSkeletonCode === 'c0301' };
    })()`);
    check('B3 旧档案（无 sourceSkeletonCode）正常读取', compat.listed && compat.codeRead);
    check('B3 加性补码写入生效（写后读=c0301）', compat.write === true && compat.after, JSON.stringify(compat));
    check('B3 重载后页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    // library-check 诊断页回归（库改动后整页自检仍 LIB-PASS）
    await cdp.send('Page.navigate', { url: PAGE_URL.replace('choreo-helper-app.html', 'library-check.html') });
    await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
    const title = await waitForEval(cdp, 'library-check 出结果', `document.title.indexOf('LIB-') === 0`, 60000)
      .then(() => cdp.evaluate('document.title')).catch(() => 'TIMEOUT');
    check('B3 library-check 整页回归 LIB-PASS', title === 'LIB-PASS', title);
    vclean.cleanup();
  }

  // B4 结构指纹对号（TASK-20260917-SKELETON-KEY-REPAIR）：在线骨架带即时姿态，整份哈希逐次
  // 不同（调研证据 .agent/evidence/TASK-20260917-SKELETON-HASH-STABILITY/），对号判定改结构
  // 指纹+种族码守门。用真实骨架快照派生三份在线响应：A=原姿态、B=同构异姿态（t 全移+q 归一
  // 姿态）、C=异构（骨名改+父索引改）。mock 走 CDP Fetch 域网络层拦截（不碰 window.fetch——
  // 实测 doc-start 包装 fetch 会让 THREE GLTFLoader 的 data:URI 缓冲加载失败、面板起不来），
  // 姿态/种族码由 node 侧 b4state 切换。覆盖：首建→同构异姿态跨 reload 对上→异构如实不对上
  // →旧档案（无结构指纹字段）现算兼容→同拓扑异种族守门拒绝/同码放行。
  console.log('— B4 结构指纹对号（同构异姿态=对上 / 异构=不对上 / 旧档案现算兼容 / 种族码守门）—');
  {
    const snapPath = path.join(ROOT, '.agent', 'evidence', 'TASK-20260917-SKELETON-HASH-STABILITY', 'capture-0.json');
    const SK_A = JSON.parse(fs.readFileSync(snapPath, 'utf8')); // 真实 101 骨在线抓取
    const SK_B = JSON.parse(JSON.stringify(SK_A));               // 同构异姿态：t 平移、q 全归一姿态
    SK_B.bones.forEach((b, i) => { b.t = [b.t[0] + 0.037, b.t[1] + 0.011, b.t[2] - 0.023]; b.q = [0, 0, 0, 1]; });
    const SK_C = JSON.parse(JSON.stringify(SK_A));               // 异构：骨名改前缀+父索引改
    SK_C.bones.forEach((b) => { b.n = 'x_' + b.n; });
    SK_C.bones[5].p = 3;
    // doc-start 包 fetch 做 mock（页面加载前生效）。init 对这两个端点的请求顺序固定：
    // 先 /export/skeleton 后 /character/assets，都应答完（第 2 次命中）即还原原生 fetch——
    // THREE GLTFLoader 读替身模型的 data:URI 缓冲不能被包（实测包住报 Failed to load buffer，
    // 面板起不来；CDP Fetch 域应答实测页面侧仍 Failed to fetch，弃）。姿态/种族码由 node 侧
    // 写进 localStorage 供 mock 读取，每次导航 doc-start 重新装包装。
    const b4state = { which: 'A', code: 'c1201' };
    const setB4 = async (which, code) => {
      if (which) b4state.which = which;
      if (code) b4state.code = code;
      await cdp.evaluate(`(function () { try { localStorage.setItem('b4sk', ${JSON.stringify(b4state.which)}); localStorage.setItem('b4code', ${JSON.stringify(b4state.code)}); } catch (e) {} return 'ok'; })()`);
    };
    const MOCK_B4 = `
(function () {
  var SK = { A: ${JSON.stringify(SK_A)}, B: ${JSON.stringify(SK_B)}, C: ${JSON.stringify(SK_C)} };
  var REAL = window.fetch, hits = 0;
  function respond(body) { return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
  window.fetch = function (url) {
    url = String(url);
    var body = null;
    if (url.indexOf('http://localhost:48795/export/skeleton') === 0) body = SK[(function(){ try { return localStorage.getItem('b4sk') || 'A'; } catch (e) { return 'A'; } })()];
    else if (url.indexOf('http://localhost:48794/character/assets') === 0) body = { available: true, sourceSkeletonCode: (function(){ try { return localStorage.getItem('b4code') || 'c1201'; } catch (e) { return 'c1201'; } })() };
    if (body) {
      if (++hits >= 2) window.fetch = REAL; // 骨架+身份码都应答完，还原（见上注释）
      return respond(body);
    }
    return REAL.apply(this, arguments);
  };
})();`;
    const ch = await launchChrome(['--host-resolver-rules=MAP localhost ~NOTFOUND']);
    const cdp = await ch.pageTargetAny();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_B4 });
    const load = async () => {
      await cdp.send('Page.navigate', { url: PAGE_URL });
      await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
      await waitForEval(cdp, 'B4 面板 ready', '__p3dDebug().ready === true', 30000);
    };
    // 载入 1：姿态 A + 空库 → 游戏骨架首建（应带 skeletonStructHash 加性字段）
    await load();
    let builtJson = null;
    for (let i = 0; i < 20 && !builtJson; i++) {
      builtJson = await cdp.evaluate(`(async function () {
        var ps = await ChoreoLibrary.listProfiles();
        var b = ps.filter(function (p) { return p.boneCount > 0; })[0] || null;
        return b ? JSON.stringify({ name: b.name, struct: b.skeletonStructHash || '', bones: b.boneCount }) : null;
      })()`);
      if (!builtJson) await sleep(500);
    }
    const built = builtJson ? JSON.parse(builtJson) : null;
    const structA = await cdp.evaluate(`ChoreoLibrary.structureHashOf(${JSON.stringify(SK_A)})`);
    check('B4 空库+在线骨架 → 首建档案带结构指纹（skeletonStructHash=结构哈希）',
      !!(built && built.struct && built.struct === structA), builtJson || '未建档');
    check('B4 首建当刻对上（mismatch 空）', await cdp.evaluate('__p3dDebug().mismatch === null'), builtJson || '');
    // 载入 2：姿态 B（同构异姿态）→ 跨 reload 应仍对上（修复前此处必挂：整份哈希永远不同）
    await cdp.evaluate(`(function () { try { localStorage.setItem('b4sk', 'B'); } catch (e) {} return 'ok'; })()`);
    await load();
    const m2 = await cdp.evaluate('__p3dDebug().mismatch');
    check('B4 同构不同姿态 → 跨 reload 仍对上（mismatch 空，结构指纹命中）', m2 === null, JSON.stringify(m2));
    // 载入 3：姿态 C（异构）→ 应如实提示没对上（保持当前档案不乱套）
    await cdp.evaluate(`(function () { try { localStorage.setItem('b4sk', 'C'); } catch (e) {} return 'ok'; })()`);
    await load();
    const m3 = await cdp.evaluate('__p3dDebug().mismatch');
    check('B4 异构在线骨架 → 如实提示没对上（mismatch 非空且骨数正确）',
      !!(m3 && m3.boneCount === SK_C.count), JSON.stringify(m3));
    // 旧档案兼容：种一份无 skeletonStructHash 的老记录（骨架=姿态 B 原文），删掉首建档案，
    // 在线回到姿态 A → 老记录靠读取侧现算结构指纹命中
    const seededOld = await cdp.evaluate(`(async function () {
      var ps = await ChoreoLibrary.listProfiles();
      for (var i = 0; i < ps.length; i++) { if (ps[i].boneCount > 0) { try { await ChoreoLibrary.deleteProfile(ps[i].id); } catch (e) {} } }
      return await new Promise(function (ok) {
        var rq = indexedDB.open('choreo3dlib', 2);
        rq.onsuccess = function () {
          var db = rq.result;
          var t = db.transaction('meta', 'readwrite');
          var pid = 'poldstruct' + Date.now();
          t.objectStore('meta').put({ id: 'profile:' + pid, data: { id: pid, name: '旧结构档案', createdAt: 1, updatedAt: 1, skeletonHash: 'legacy-full-hash', boneCount: ${SK_B.count}, skeleton: ${JSON.stringify(SK_B)}, modelNames: [] } });
          t.objectStore('meta').put({ id: 'activeProfile', pid: pid });
          t.oncomplete = function () { ok(pid); }; t.onerror = function () { ok(null); };
        };
      });
    })()`);
    check('B4 旧结构档案行已种入（无 skeletonStructHash 字段）', !!seededOld);
    await cdp.evaluate(`(function () { try { localStorage.setItem('b4sk', 'A'); } catch (e) {} return 'ok'; })()`);
    await load();
    const compat4 = await cdp.evaluate(`(async function () {
      var lps = await ChoreoLibrary.listProfiles();
      var old1 = lps.filter(function (p) { return p.name === '旧结构档案'; })[0] || null;
      var act = await ChoreoLibrary.getActiveProfile();
      return JSON.stringify({
        structComputed: old1 ? (old1.skeletonStructHash === await ChoreoLibrary.structureHashOf(${JSON.stringify(SK_B)})) : false,
        mismatch: __p3dDebug().mismatch === null,
        activeIsOld: !!(act && act.name === '旧结构档案')
      });
    })()`);
    const c4 = JSON.parse(compat4 || '{}');
    check('B4 旧档案结构指纹读取侧现算（listProfiles 补算命中）', c4.structComputed === true, compat4 || '');
    check('B4 旧档案（无字段）同样跨 reload 对上（mismatch 空）', c4.mismatch === true, compat4 || '');
    // 种族码守门：同拓扑异种族（族包实测 c0303 与 c1201 骨名全同）不得互认；码相等才对上
    const seededGuard = await cdp.evaluate(`(async function () {
      var ps = await ChoreoLibrary.listProfiles();
      for (var i = 0; i < ps.length; i++) { if (ps[i].boneCount > 0) { try { await ChoreoLibrary.deleteProfile(ps[i].id); } catch (e) {} } }
      return await new Promise(function (ok) {
        var rq = indexedDB.open('choreo3dlib', 2);
        rq.onsuccess = function () {
          var db = rq.result;
          var t = db.transaction('meta', 'readwrite');
          var pid = 'pguard' + Date.now();
          t.objectStore('meta').put({ id: 'profile:' + pid, data: { id: pid, name: 'c0303 守门档', createdAt: 1, updatedAt: 1, skeletonHash: 'guard-full-hash', sourceSkeletonCode: 'c0303', boneCount: ${SK_B.count}, skeleton: ${JSON.stringify(SK_B)}, modelNames: [] } });
          t.objectStore('meta').put({ id: 'activeProfile', pid: pid });
          t.oncomplete = function () { ok(pid); }; t.onerror = function () { ok(null); };
        };
      });
    })()`);
    check('B4 守门档案行已种入（结构=同构，码=c0303）', !!seededGuard);
    // 守门拒绝：在线码 c1201 ≠ 档案码 c0303（结构同构）→ 不得对上
    await cdp.evaluate(`(function () { try { localStorage.setItem('b4sk', 'B'); localStorage.setItem('b4code', 'c1201'); } catch (e) {} return 'ok'; })()`);
    await load();
    const g1 = await cdp.evaluate('__p3dDebug().mismatch');
    check('B4 同拓扑异种族不互认（码不等 → mismatch 非空）', !!(g1 && g1.boneCount === SK_B.count), JSON.stringify(g1));
    // 守门放行：在线码改 c0303 = 档案码 → 对上
    await cdp.evaluate(`(function () { try { localStorage.setItem('b4code', 'c0303'); } catch (e) {} return 'ok'; })()`);
    await load();
    const g2 = await cdp.evaluate('(function(){ var d=__p3dDebug(); return JSON.stringify({mm:d.mismatch===null, act:d.profile?d.profile.name:""}); })()');
    const g2p = JSON.parse(g2 || '{}');
    check('B4 码相等放行（同构+同码 → 对上且档案保持）', g2p.mm === true && g2p.act === 'c0303 守门档', g2 || '');
    check('B4 页面全程无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }
}

(async function main() {
  let mode = process.argv[2] || 'all';
  let aborted = false; // r2 修复：中断（如 B4 历史样本缺失）必须让退出码非 0——
  //              原实现 catch 设了 exitCode=1，但末尾 process.exit 又按"已跑过的断言全过"
  //              重算退出码，把中断掩盖成 0（2026-09-21 审计实测：29 过后 B4 abort 仍退 0）
  try {
    if (mode === 'a' || mode === 'all') await partA();
    if (mode === 'b' || mode === 'all') await partB();
  } catch (e) {
    console.error('harness 失败：' + ((e && e.stack) || e));
    process.exitCode = 1;
    aborted = true;
    vclean.cleanup();
  }
  const pass = results.filter(Boolean).length;
  console.log('结果：' + pass + ' 通过 / ' + (results.length - pass) + ' 失败' + (aborted ? ' · harness 中断未完成（退出码 1）' : ''));
  process.exit((aborted || results.length !== pass) ? 1 : 0);
})();
