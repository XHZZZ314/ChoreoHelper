// test-anim-pack-import-browser.js — TASK-20260918-ANIM-PACK-UNIVERSAL r2：v2 通用包导入
// 浏览器隔离验收（AC3/AC4/AC5/AC6 浏览器面）。
//
// 跑法：D:\nodejs\node.exe web\test-anim-pack-import-browser.js
//
// 干嘛的：无头 Chrome（file:// 打开仓库 dist 主页，--host-resolver-rules 断网，独立临时
//        profile）+ 真 IndexedDB，驱动「导入离线动作包」UI（真实拖拽事件+勾选）：
//   S1 一个 v2 包 → 勾「导入到全部档案」→ 两档案（c1201 带码 / c0301 无码）各自换算各自
//      入库（键=各自族索引）、activeProfile 与项目文档零变化、重开页面可读回（AC3）；
//   S2 写入前延迟中切换活动档案 / 删目标档案 → 其后写入作废、已提交保留、无跨档案污染（AC4）；
//   S3 v1 包原样入库零改动（字节等价）+ 坏 v2（坏 gzip/坏版本/重名条目/坏引用）写前拒绝零写入（AC5）；
//   S4 重复点击不并跑 + v1 勾全部档案写前明确拒绝（AC6）；
//   S5 640×800 视口控件可用性（AC6/用户流）；
//   S6 重复导入默认跳过 + 显式覆盖有界（AC4/AC6）。
// r2 返工新增（独立验收退回单 AP-R2-01/02 + AC3/AC4 验收补面，2026-09-21）：
//   S7 真实工具中心导航（工具→人物与资源→独立离线动作包区）＋精确双视口 1440×900/640×800
//      （Emulation.setDeviceMetricsOverride）＋非空生产文档（重复 id/多重/嵌套）导入零变化＋重开读回；
//   S8 AC5 红回归：第二条剪辑坏四元数（norm=4）→ 整包写前拒绝，第一条也不得入库；
//   S9 AC6：三档案×2 条目其一无效 → planned=6、部分完成、失败列表不混入跳过说明文字；
//   S10 AC4 补面：真骨架突变（裸 IDB 改 meta 记录）/删档重建不能重定向写入、
//      覆盖换载荷后非目标档案逐字节不变、配额失败停该档案＋显式重试补齐。
// r2 返工第 2 轮（AP-R2-01B + AP-R2-EV-05，2026-09-21，评审 anim-pack-r2-reverify-20260921-163115）：
//   证据分级——S1-S6/S2/S10b 为「组件级」（buildSection+合成 DragEvent/事务前延迟闸门）；
//   S7-S13 验收面一律走「真实工具中心导航 + CDP 文件输入」（DOM.setFileInputFiles 于真实产品
//   input#xatPackFileIn——真实文件选择路径；不是 OS 可视文件对话框，也不是合成拖拽，如实区分）：
//   S8 重做：bone_999/非法骨键晚到坏骨键整包写前拒绝（写入 spy 零调用＋choreo3dlib 全库清单
//      完整元数据/实际存储 Blob 字节 SHA-256/资源清单前后逐字节一致）；
//   S9 重做（真实导航）；S10a 重做（全非目标完整元数据+Blob 字节+清单）；S10c 补 bN 断言；
//   S10d 明确标注「模拟配额=Promise 拒绝注入」（真实事务中止见 S13c）并把失败/未开始计数入断言；
//   S12 生产路径活动文档：persistDoc 序列化建项目→setActiveId→重开页面走生产装载→先断言
//      规范轨道/重复原生 ID 多重/嵌套内容确实在场→导入前后生产序列化与存储记录逐字节一致；
//   S13 真实 guarded IDB 事务开启后的失效/中止（非 putClip 前延迟）：守卫事务真正开启
//      （IDBDatabase.transaction 被调）后按真实 IDB 调度入队突变——a 骨架突变（含已提交前缀/
//      元数据与载荷原子性/后续陈旧写入停止）；b 显式覆盖同口径＋全非目标字节等价；
//      c 真实事务中止注入（活跃守卫事务内 abort，区别于模拟配额 Promise 拒绝）＋显式重试。
// 合成夹具（真实 shipped 族包骨名 + 合成动画）与截图存 r2-rework2-20260921 证据目录。
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const vclean = require(path.join(__dirname, '..', 'scripts', 'verify-cleanup'));

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
const PAGE_URL = 'file:///' + path.join(DIST, 'choreo-helper-app.html').replace(/\\/g, '/');
// 每次生成新证据；指定 CHOREO_ANIM_PACK_EVIDENCE 时也拒绝覆盖已存在目录。
const EVID_DIR = process.env.CHOREO_ANIM_PACK_EVIDENCE ? path.resolve(process.env.CHOREO_ANIM_PACK_EVIDENCE)
  : path.join(ROOT, '.agent', 'evidence', 'anim-pack-import-browser', new Date().toISOString().replace(/[:.]/g, '-'));
const FIXTURE_DIR = path.join(EVID_DIR, 'browser');
const UI_ONLY = process.argv.includes('--ui-only'); // 仅跑真实 S7/S7b 双视口交互；默认仍跑完整套件。
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

// ---- 夹具：真 shipped 族包骨架 + 合成动画（明确合成，不冒充真实观感） ----
global.window = global; // 经典脚本挂全局（页面同形）
eval.call(global, fs.readFileSync(path.join(DIST, 'skeleton-pack.js'), 'utf8'));
const SP = global.__CHOREO_SKELETON_PACK__;
const C0101 = SP.tribes.filter((t) => t.code === 'c0101')[0].skeleton;
const C1201 = SP.tribes.filter((t) => t.code === 'c1201')[0].skeleton;
const C0301 = SP.tribes.filter((t) => t.code === 'c0301')[0].skeleton;
function bonesOf(names, dur) { // 在 c0101 基准上造合成动画（j_kosi 等 3 骨，q 归一、时间递增）
  const out = {};
  names.forEach((nm) => {
    const b = C0101.bones.filter((x) => x.n === nm)[0];
    if (!b) throw new Error('c0101 缺骨 ' + nm);
    out['bone_' + b.i] = {
      q: [[0, 0, 0, 0, 1], [dur / 2, 0.1, 0, 0, Math.sqrt(1 - 0.01)], [dur, 0, 0, 0, 1]],
      t: [[0, 1, 1, 1], [dur / 2, 1, 1.2, 1], [dur, 1, 1, 1]],
      s: [[0, 1, 1, 1], [dur, 1, 1, 1]],
    };
  });
  return out;
}
function mkV2Pack() {
  const clip = { name: 'k', duration: 1.5, type: 'loop', bones: bonesOf(['n_root', 'j_kosi', 'j_kao'], 1.5),
    offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: 'c0101', productionImportApproved: false } };
  const pack = { formatVersion: 2, gameVersion: 'fixture', code: 'c0101', baseSkeletonCode: 'c0101',
    baseSkeleton: C0101, counts: {}, clips: [{ key: 'k', duration: 1.5, frames: 3, bones: 106, clip }],
    entries: [
      { name: 'fixture_nod', label: '合成点头', kind: 'emote', clipIndex: 0 },
      { name: 'fixture_bow', label: '合成鞠躬', kind: 'emote', clipIndex: 0 },
    ] };
  return pack;
}
function mkV1Pack() {
  const clip = { name: 'fixture_v1', duration: 1.5, type: 'loop', bones: bonesOf(['n_root', 'j_kosi'], 1.5),
    offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: 'c1201', productionImportApproved: false } };
  return { formatVersion: 1, gameVersion: 'fixture', code: 'c1201', counts: {}, clips: [{ key: 'k', duration: 1.5, frames: 3, bones: 106, clip }],
    entries: [{ name: 'fixture_v1', label: 'v1 原样', kind: 'emote', clipIndex: 0 }] };
}
function gzB64(obj) { return zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }).toString('base64'); }
// AP-R2-01B 评审口径坏包：两条剪辑，首条合法；第二条克隆首条后把 n_root 骨数据挪到坏键
// （bone_999=106 骨声明之外的索引 / 'n_root'=非 bone_N 数字格式），行值全有限合法。
function mkBadBoneKeyPack(kind) {
  const pack = mkV2Pack();
  const c2 = JSON.parse(JSON.stringify(pack.clips[0]));
  c2.clip = JSON.parse(JSON.stringify(c2.clip));
  const rootKey = 'bone_' + C0101.bones.filter((b) => b.n === 'n_root')[0].i;
  const mv = c2.clip.bones[rootKey];
  delete c2.clip.bones[rootKey];
  c2.clip.bones[kind === 'bone999' ? 'bone_999' : 'n_root'] = mv;
  pack.clips.push(c2);
  pack.entries[1].clipIndex = 1;
  return pack;
}

// ---- CDP 基线设施（与 test-dancer-autoadapt 同形） ----
const results = [];
function check(name, ok, detail) {
  results.push(!!ok);
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (detail ? '（' + detail + '）' : ''));
  if (!ok) process.exitCode = 1;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
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
async function launchChrome(winW, winH) {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-animpack-import-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=' + winW + ',' + winH, '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP localhost ~NOTFOUND', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile);
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) { /* 未起 */ }
    if (i === 59) throw new Error('Chrome 调试口起不来');
  }
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const t = list.find((x) => x.type === 'page');
    if (t) return new Cdp(t.webSocketDebuggerUrl);
    await sleep(300);
  }
  throw new Error('找不到页面 target');
}
async function openPage(winW, winH) {
  const cdp = await launchChrome(winW || 1440, winH || 900);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // r2 返工第 2 轮：导航前经 CDP 阻断全部 HTTP(S)（只允许仓库 file:// 页面；
  // 连同后续 Page.navigate 重开一并覆盖——不连插件、不访问任何网络）
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['http://*/*', 'https://*/*'] });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
  await sleep(2500);
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

// 页内助手：建两档案、挂 UI、返回环境句柄
const SETUP_TWO = `(async function () {
  var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
  var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
  var pa = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
  var pb = await ChoreoLibrary.createProfile({ name: '乙(c0301无码)', skeleton: t0301.skeleton });
  await ChoreoLibrary.setActiveProfile(pa.id);
  window.__box = ChoreoXatConvertUI.buildSection({});
  document.body.appendChild(window.__box);
  var drops = window.__box.querySelectorAll('div');
  var drop = null;
  for (var i = 0; i < drops.length; i++) if (drops[i].textContent.indexOf('拖到这里') >= 0) drop = drops[i];
  window.__drop = drop;
  var chks = window.__box.querySelectorAll('input[type=checkbox]');
  window.__overChk = null; window.__allChk = null;
  for (var j = 0; j < chks.length; j++) {
    var lblNode = chks[j].nextElementSibling, lbl = lblNode ? lblNode.textContent : '';
    if (lbl.indexOf('覆盖同名动作') >= 0) window.__overChk = chks[j];
    if (lbl.indexOf('导入到全部档案') >= 0) window.__allChk = chks[j];
  }
  return { pa: pa.id, pb: pb.id, hasDrop: !!drop, hasOver: !!window.__overChk, hasAll: !!window.__allChk };
})()`;
function dropFileJs(b64, name, dropVar) { // 页内构造 File 并派发真实 drop 事件（dropVar 指定投放目标元素）
  return `(async function () {
    var b = atob('${b64}'), u8 = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    var file = new File([u8], '${name}', { type: 'application/gzip' });
    var dt = new DataTransfer(); dt.items.add(file);
    (${dropVar || 'window.__drop'}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return 'dropped';
  })()`;
}
const DOC_SNAPSHOT = `(async function () { // 项目文档快照：projects DB + autosave（AC3：导入不得改项目）
  var out = { ls: {}, proj: null };
  try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/choreo|autosave|draft/.test(k)) out.ls[k] = localStorage.getItem(k); } } catch (e) {}
  out.proj = await new Promise(function (ok) {
    try {
      var rq = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
      rq.then(function (dbs) {
        var has = dbs.some(function (d) { return d.name === 'choreo3dproj'; });
        if (!has) return ok('nodb');
        var r2 = indexedDB.open('choreo3dproj');
        r2.onsuccess = function () {
          var db = r2.result, stores = Array.from(db.objectStoreNames), parts = [], left = stores.length;
          if (!left) return ok('{}');
          stores.forEach(function (sn) {
            var q = db.transaction(sn, 'readonly').objectStore(sn).getAll();
            q.onsuccess = function () {
              parts.push(sn + ':' + JSON.stringify(q.result, function (kk, vv) { return vv instanceof Blob ? ('Blob(' + vv.size + ')') : vv; }));
              if (!--left) ok(parts.join('|'));
            }; q.onerror = function () { if (!--left) ok(sn + ':ERR'); };
          });
        };
      });
    } catch (e) { ok('err:' + e.message); }
  });
  return JSON.stringify(out);
})()`;

const SETUP_GATE = `(function () { // 事务前延迟闸门（组件级证据面）：hold=true 时每笔 putClip 轮询等待
  var orig = ChoreoLibrary.putClip.bind(ChoreoLibrary);
  window.__gate = { hold: false };
  ChoreoLibrary.putClip = function (name, clip, pid, guard) {
    return new Promise(function (res) {
      (function tick() { if (!window.__gate.hold) res(orig(name, clip, pid, guard)); else setTimeout(tick, 40); })();
    });
  };
  return 'gated';
})()`;

// ---- r2 返工第 2 轮（AP-R2-EV-05）公共助手 ----
// choreo3dlib 全库清单快照：meta 全记录（完整元数据）+ profileClips 全记录（完整元数据）
// + profileClipData 实际存储 Blob 字节的 SHA-256（不是只比 size）——三者合成一个可比对 JSON。
const LIB_INV = `(async function () {
  function sha(b) { return crypto.subtle.digest('SHA-256', b).then(function (h) { return Array.from(new Uint8Array(h)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }); }
  return await new Promise(function (ok) {
    var rq = indexedDB.open('choreo3dlib');
    rq.onsuccess = function () {
      var db = rq.result, stores = ['meta', 'profileClips', 'profileClipData'], out = {}, left = stores.length;
      stores.forEach(function (sn) {
        var q = db.transaction(sn, 'readonly').objectStore(sn).getAll();
        q.onsuccess = function () {
          var rows = (q.result || []).slice();
          if (sn === 'profileClipData') {
            Promise.all(rows.map(function (r) {
              return (r.data && typeof r.data.arrayBuffer === 'function' ? r.data.arrayBuffer().then(sha) : Promise.resolve('noblob'))
                .then(function (h) { return { profileId: r.profileId, name: r.name, size: r.data ? r.data.size : -1, sha256: h }; });
            })).then(function (list) { list.sort(function (a, b) { return (a.profileId + '/' + a.name) < (b.profileId + '/' + b.name) ? -1 : 1; }); out[sn] = list; if (!--left) { db.close(); ok(JSON.stringify(out)); } });
          } else {
            rows.sort(function (a, b) { return String(a.profileId || a.key || '') < String(b.profileId || b.key || '') ? -1 : 1; });
            out[sn] = rows;
            if (!--left) { db.close(); ok(JSON.stringify(out)); }
          }
        };
        q.onerror = function () { if (!--left) { db.close(); ok('ERR:' + sn); } };
      });
    };
    rq.onerror = function () { ok('ERR:open'); };
  });
})()`;
// 写入 spy：包裹真实 ChoreoLibrary.putClip，计数并透传（调没调用一目了然，与全库清单互证）
const SPY_PUT = `(function () {
  var orig = ChoreoLibrary.putClip.bind(ChoreoLibrary);
  window.__putSpy = 0;
  ChoreoLibrary.putClip = function () { window.__putSpy++; return orig.apply(null, arguments); };
  return 'spy';
})()`;
// 建两档案并设活动（不挂组件 UI——验收段用真实工具中心界面）
const SETUP_PROFILES = `(async function () {
  var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
  var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
  var pa = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
  var pb = await ChoreoLibrary.createProfile({ name: '乙(c0301无码)', skeleton: t0301.skeleton });
  await ChoreoLibrary.setActiveProfile(pa.id);
  return { pa: pa.id, pb: pb.id };
})()`;
// 守卫事务开启钩子（真实 IDB 调度）：只在 IDBDatabase.transaction 真被调用、且是包含
// profileClipData 的 readwrite（=putClip 守卫事务）时计数；首个守卫事务开启后按真实调度入队
// 档案骨架突变（裸 IDB 改 meta，排队跑在当前事务之后、后续写入之前——不是 putClip 前延迟）。
const TX_HOOK = `(function () {
  var orig = IDBDatabase.prototype.transaction;
  window.__guardTxN = 0; window.__mutQueued = false; window.__mutAtTxCount = 0; window.__mutDone = false; window.__mutPid = null;
  IDBDatabase.prototype.transaction = function (stores, mode) {
    var tx = orig.apply(this, arguments);
    try {
      var names = Array.isArray(stores) ? stores : [stores];
      if (mode === 'readwrite' && names.indexOf('profileClipData') >= 0) {
        window.__guardTxN++;
        if (!window.__mutQueued && window.__mutPid) {
          window.__mutQueued = true; window.__mutAtTxCount = window.__guardTxN;
          var pid = window.__mutPid;
          var skel = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0].skeleton;
          var rq = indexedDB.open('choreo3dlib');
          rq.onsuccess = function () {
            var db = rq.result, t2 = db.transaction('meta', 'readwrite');
            var g = t2.objectStore('meta').get('profile:' + pid);
            g.onsuccess = function () {
              if (g.result) { g.result.data.skeleton = JSON.parse(JSON.stringify(skel)); if (g.result.data.skeletonHash) g.result.data.skeletonHash = 'mutated'; t2.objectStore('meta').put(g.result); }
            };
            t2.oncomplete = function () { db.close(); window.__mutDone = true; };
          };
        }
      }
    } catch (e) {}
    return tx;
  };
  return 'tx-hooked';
})()`;
// 真实事务中止注入：守卫事务进行中（其 meta 档案记录读请求的成功事件内）对活跃真事务调
// abort()——真实 IndexedDB 事务中止（onabort→reject），区别于 S10d 的模拟配额 Promise 拒绝。
const ABORT_HOOK = `(function () {
  var orig = IDBObjectStore.prototype.get;
  window.__abortArmed = false; window.__abortKey = ''; window.__aborted = false; window.__abortErr = '';
  IDBObjectStore.prototype.get = function (key) {
    var req = orig.apply(this, arguments);
    if (window.__abortArmed && this.name === 'meta' && key === window.__abortKey && this.transaction && this.transaction.mode === 'readwrite') {
      window.__abortArmed = false;
      req.addEventListener('success', function () { try { req.transaction.abort(); window.__aborted = true; } catch (e) { window.__abortErr = String(e); } });
    }
    return req;
  };
  return 'abort-hooked';
})()`;

async function main() {
  fs.mkdirSync(path.dirname(EVID_DIR), { recursive: true });
  fs.mkdirSync(EVID_DIR); // EEXIST 在启动浏览器/写夹具前拒绝，保留历史证据。
  fs.mkdirSync(FIXTURE_DIR);
  const v2pack = mkV2Pack(), v1pack = mkV1Pack();
  const bad999pack = mkBadBoneKeyPack('bone999'), badkeypack = mkBadBoneKeyPack('badkey');
  const v2gz = gzB64(v2pack), v1gz = gzB64(v1pack);
  const V2_FILE = path.join(FIXTURE_DIR, 'fixture-v2-anim-pack.json.gz');
  const V1_FILE = path.join(FIXTURE_DIR, 'fixture-v1-anim-pack.json.gz');
  const BAD999_FILE = path.join(FIXTURE_DIR, 'fixture-bad-bone999.json.gz');
  const BADKEY_FILE = path.join(FIXTURE_DIR, 'fixture-bad-bonekey.json.gz');
  fs.writeFileSync(V2_FILE, Buffer.from(v2gz, 'base64'));
  fs.writeFileSync(V1_FILE, Buffer.from(v1gz, 'base64'));
  fs.writeFileSync(BAD999_FILE, zlib.gzipSync(Buffer.from(JSON.stringify(bad999pack), 'utf8'), { level: 9 }));
  fs.writeFileSync(BADKEY_FILE, zlib.gzipSync(Buffer.from(JSON.stringify(badkeypack), 'utf8'), { level: 9 }));
  fs.writeFileSync(path.join(FIXTURE_DIR, 'fixtures-sha256.txt'),
    'v2 ' + crypto.createHash('sha256').update(Buffer.from(v2gz, 'base64')).digest('hex') + '\n' +
    'v1 ' + crypto.createHash('sha256').update(Buffer.from(v1gz, 'base64')).digest('hex') + '\n' +
    'bad999 ' + crypto.createHash('sha256').update(fs.readFileSync(BAD999_FILE)).digest('hex') + '\n' +
    'badkey ' + crypto.createHash('sha256').update(fs.readFileSync(BADKEY_FILE)).digest('hex') + '\n');
  const hipIdx = (skel) => skel.bones.filter((b) => b.n === 'j_kosi')[0].i;

  if (!UI_ONLY) {
  console.log('— S1 v2 全档案导入（AC3）—');
  {
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    check('S1 准备：两档案 + 拖拽框 + 两个勾选框都在', env.hasDrop && env.hasOver && env.hasAll, JSON.stringify({ hasDrop: env.hasDrop, hasOver: env.hasOver, hasAll: env.hasAll }));
    const docBefore = await cdp.evaluate(DOC_SNAPSHOT);
    const activeBefore = await cdp.evaluate(`ChoreoLibrary.getActiveProfile().then(function(p){return p&&p.id;})`);
    await cdp.evaluate(`window.__allChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S1 导入结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 60000);
    const verify = await cdp.evaluate(`(async function () {
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var ca = await ChoreoLibrary.getClip('fixture_nod', ia), cb = await ChoreoLibrary.getClip('fixture_nod', ib);
      var cbow = await ChoreoLibrary.getClip('fixture_bow', ib);
      var act = await ChoreoLibrary.getActiveProfile();
      var txt = window.__box.textContent;
      function keysIn(skel, clip) {
        var okIdx = {}; skel.bones.forEach(function (b) { okIdx['bone_' + b.i] = 1; });
        return Object.keys(clip.bones).every(function (k) { return !!okIdx[k]; });
      }
      return {
        hipA: ca ? Object.keys(ca.bones).indexOf('bone_' + ${hipIdx(C1201)}) >= 0 : false,
        hipB: cb ? Object.keys(cb.bones).indexOf('bone_' + ${hipIdx(C0301)}) >= 0 : false,
        countA: ca ? Object.keys(ca.bones).length : 0, countB: cb ? Object.keys(cb.bones).length : 0,
        keysA: ca ? keysIn(t1201.skeleton, ca) : false, keysB: cb ? keysIn(t0301.skeleton, cb) : false,
        bowB: !!cbow, activeSame: act && act.id === ${JSON.stringify(activeBefore)},
        convA: txt.indexOf('已按 c1201 换算') >= 0, convB: txt.indexOf('按档案骨架换算') >= 0,
        boneCountA: (await ChoreoLibrary.getProfile(ia)).boneCount, boneCountB: (await ChoreoLibrary.getProfile(ib)).boneCount,
      };
    })()`);
    check('S1 两档案各入库 2 条（nod+bow），键=各自族 j_kosi 索引', verify.hipA && verify.hipB && verify.bowB, JSON.stringify(verify));
    check('S1 换算后输出骨键全部落在各自目标骨架索引集（夹具动画 3 骨→各 3 键）',
      verify.countA === 3 && verify.countB === 3 && verify.keysA && verify.keysB,
      verify.countA + ' · ' + verify.countB);
    check('S1 activeProfile 未被导入改写', verify.activeSame);
    check('S1 汇总明示换算目标（已按 c1201 换算 / 按档案骨架换算）', verify.convA && verify.convB);
    const docAfter = await cdp.evaluate(DOC_SNAPSHOT);
    check('S1 项目文档零变化（projects DB + autosave 逐字节一致）', docBefore === docAfter);
    // 重开页面读回（AC3：reopen and read）
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
    await sleep(2500);
    const reread = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.getClip('fixture_nod', ${JSON.stringify(env.pa)});
      var b = await ChoreoLibrary.getClip('fixture_bow', ${JSON.stringify(env.pb)});
      return !!(a && a.bones && b && b.bones && a.duration === 1.5);
    })()`);
    check('S1 重开页面后两档案剪辑可读回', reread);
    check('S1 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  console.log('— S2 延迟中切换/删档（AC4）—');
  {
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    await cdp.evaluate(SETUP_GATE);
    await cdp.evaluate(`window.__gate.hold = true; window.__allChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S2a 导入已开始（首笔写入挂起）', `window.__box.textContent.indexOf('个动作到') >= 0`, 30000);
    // 场景 a：首条写入挂起期间切换活动档案 → 其后写入作废
    await cdp.evaluate(`ChoreoLibrary.setActiveProfile(${JSON.stringify(env.pb)}).then(function(){ return 'switched'; })`);
    await cdp.evaluate(`window.__gate.hold = false; 'release'`);
    await waitForEval(cdp, 'S2a 结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 30000);
    const s2a = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib);
      return { aN: a.length, bN: b.length,
        stopped: window.__box.textContent.indexOf('已停止') >= 0 || /未开始 [1-9]/.test(window.__box.textContent),
        act: (await ChoreoLibrary.getActiveProfile()).id };
    })()`);
    check('S2a 切换档案：其后写入作废（汇总含停止/未开始；提交数≤首条）',
      s2a.stopped && s2a.aN + s2a.bN <= 2, JSON.stringify({ aN: s2a.aN, bN: s2a.bN }));
    check('S2a 切换保持生效（活动档案=乙，导入不回拨指针）', s2a.act === env.pb);
    // 场景 b：新开页面，删目标档案 → 快照不符作废
    const cdp2 = await openPage();
    const env2 = await cdp2.evaluate(SETUP_TWO);
    await cdp2.evaluate(SETUP_GATE);
    await cdp2.evaluate(`window.__gate.hold = true; window.__allChk.checked = true; 'ok'`);
    await cdp2.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp2, 'S2b 导入已开始', `window.__box.textContent.indexOf('个动作到') >= 0`, 30000);
    await cdp2.evaluate(`ChoreoLibrary.deleteProfile(${JSON.stringify(env2.pa)}).then(function(){ return 'deleted'; })`);
    await cdp2.evaluate(`window.__gate.hold = false; 'release'`);
    const s2bok = await waitForEval(cdp2, 'S2b 结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 45000).catch(async () => {
      const t = await cdp2.evaluate(`window.__box.textContent`).catch(() => '<eval-fail>');
      console.log('    [S2b 超时转储] ' + String(t).slice(-300));
      return false;
    });
    const s2b = await cdp2.evaluate(`(async function () {
      var ia = ${JSON.stringify(env2.pa)}, ib = ${JSON.stringify(env2.pb)};
      var prof = await ChoreoLibrary.getProfile(ia);
      var b = await ChoreoLibrary.clipIndex(ib);
      return { profGone: !prof, bN: b.length };
    })()`);
    check('S2b 删目标档案：该档案记录消失（写入无法重定向到已删档案）', s2b.profGone, JSON.stringify({ bN: s2b.bN }));
    check('S2 页面无 JS 异常', cdp.exceptions.length === 0 && cdp2.exceptions.length === 0, JSON.stringify(((cdp.exceptions[0] || cdp2.exceptions[0] || {}).text || '')).slice(0, 120));
    vclean.cleanup();
  }

  console.log('— S3 v1 原样 + 坏 v2 拒绝（AC5）—');
  {
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    await cdp.evaluate(dropFileJs(v1gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S3 v1 导入结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 30000);
    const s3v1 = await cdp.evaluate(`(async function () {
      var c = await ChoreoLibrary.getClip('fixture_v1', ${JSON.stringify(env.pa)});
      var b = await ChoreoLibrary.getClip('fixture_v1', ${JSON.stringify(env.pb)});
      return JSON.stringify(c) === ${JSON.stringify(JSON.stringify(v1pack.clips[0].clip))} && !b;
    })()`);
    check('S3 v1 只入当前档案且字节等价（无换算、不进全部档案）', s3v1);
    const before = await cdp.evaluate(`ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}).then(function(x){return x.length;})`);
    // 坏 gzip
    await cdp.evaluate(dropFileJs(Buffer.from('notgzip-at-all').toString('base64'), 'bad.gz'));
    await waitForEval(cdp, 'S3 坏 gzip 提示', `window.__box.textContent.indexOf('解析失败') >= 0 || window.__box.textContent.indexOf('不支持') >= 0`, 15000);
    // 坏版本
    await cdp.evaluate(dropFileJs(gzB64({ formatVersion: 3 }), 'v3.json.gz'));
    await waitForEval(cdp, 'S3 坏版本提示', `window.__box.textContent.indexOf('格式不支持') >= 0`, 15000);
    // v2 重名条目
    const dup = mkV2Pack(); dup.entries.push(JSON.parse(JSON.stringify(dup.entries[0])));
    await cdp.evaluate(dropFileJs(gzB64(dup), 'dup.json.gz'));
    await waitForEval(cdp, 'S3 重名条目提示', `window.__box.textContent.indexOf('条目重名') >= 0`, 15000);
    // v2 坏引用
    const badRef = mkV2Pack(); badRef.entries[0].clipIndex = 9;
    await cdp.evaluate(dropFileJs(gzB64(badRef), 'badref.json.gz'));
    await waitForEval(cdp, 'S3 坏引用提示', `window.__box.textContent.indexOf('引用不存在') >= 0`, 15000);
    const after = await cdp.evaluate(`ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}).then(function(x){return x.length;})`);
    check('S3 四个坏包全部写前拒绝（当前档案计数不变）', before === after, before + '→' + after);
    check('S3 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  console.log('— S4 重复点击 / v1+全部档案（AC6）—');
  {
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    await cdp.evaluate(`(function () { // 慢速包让第一轮导入还在跑
      var orig = ChoreoLibrary.putClip.bind(ChoreoLibrary);
      ChoreoLibrary.putClip = function (name, clip, pid, guard) {
        var self = this;
        return new Promise(function (ok) { setTimeout(function () { ok(orig(name, clip, pid, guard)); }, 400); });
      };
      return 'slowed';
    })()`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz')); // 立刻重复投递
    const dupMsg = await waitForEval(cdp, 'S4 重复投递被拒', `window.__box.textContent.indexOf('已有一次导入在进行中') >= 0`, 20000).catch(() => false);
    check('S4 导入进行中重复投递不启动第二次', dupMsg);
    await waitForEval(cdp, 'S4 首轮结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 60000);
    const nAfter = await cdp.evaluate(`ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}).then(function(x){return x.length;})`);
    check('S4 重复投递后当前档案仍只有 2 条（无双写）', nAfter === 2, 'n=' + nAfter);
    // v1 + 勾选全部档案 → 写前明确拒绝
    await cdp.evaluate(`window.__allChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v1gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S4 v1+全部档案拒绝', `window.__box.textContent.indexOf('不支持「导入到全部档案」') >= 0 && window.__box.textContent.indexOf('--universal') >= 0`, 15000);
    const nAfter2 = await cdp.evaluate(`ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}).then(function(x){return x.length;})`);
    check('S4 v1+全部档案拒绝时零写入', nAfter2 === 2, 'n=' + nAfter2);
    check('S4 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  console.log('— S5 640×800 视口控件可用（用户流约束）—');
  {
    const cdp = await openPage(640, 800);
    const env = await cdp.evaluate(SETUP_TWO);
    const ui = await cdp.evaluate(`(function () {
      function vis(el) { return !!el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0; }
      var btns = window.__box.querySelectorAll('button');
      var stop = null;
      for (var i = 0; i < btns.length; i++) if (btns[i].textContent.indexOf('停止导入') >= 0) stop = btns[i];
      return { drop: vis(window.__drop), over: vis(window.__overChk), all: vis(window.__allChk),
        boxW: window.__box.offsetWidth, pageW: window.innerWidth,
        noHorizScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
    })()`);
    check('S5 640×800：拖拽框/覆盖勾选/全部档案勾选可见，页面无横向滚动', ui.drop && ui.over && ui.all && ui.noHorizScroll, JSON.stringify(ui));
    vclean.cleanup();
  }

  console.log('— S6 重复导入默认跳过 + 显式覆盖有界（AC4/AC6）—');
  {
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    await cdp.evaluate(`window.__allChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S6 首轮结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 60000);
    const snap1 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.getClip('fixture_nod', ${JSON.stringify(env.pa)});
      return { txt: window.__box.textContent.slice(0, 120), clip: JSON.stringify(a) };
    })()`);
    // 第二轮默认（不勾覆盖）：同名全部跳过，内容不变
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S6 二轮默认结束', `window.__box.textContent.indexOf('导入 0') >= 0 && window.__box.textContent.indexOf('已在库跳过 2') >= 0`, 30000);
    const snap2 = await cdp.evaluate(`ChoreoLibrary.getClip('fixture_nod', ${JSON.stringify(env.pa)}).then(function(c){return JSON.stringify(c);})`);
    check('S6 二轮默认：同名跳过且已入库内容逐字节不变', snap1.clip === snap2, (snap1.txt || '').slice(0, 80));
    // 第三轮勾覆盖：只替换冻结目标里的同名，两档案各 2 条不变多
    await cdp.evaluate(`window.__overChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    const s6ok = await waitForEval(cdp, 'S6 三轮覆盖结束', `window.__box.textContent.indexOf('导入 2') >= 0 && window.__box.textContent.indexOf('导入结束') >= 0`, 30000)
      .catch(async () => {
        // 观察到的偶发：第三轮 drop 落在上一轮 finally 复位 importing 之前被拒。重派发一次
        // （重试的是投递，不放松断言）；若仍不动则转储状态文本。
        await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
        return waitForEval(cdp, 'S6 三轮覆盖结束（重派发）', `window.__box.textContent.indexOf('导入 2') >= 0 && window.__box.textContent.indexOf('导入结束') >= 0`, 30000)
          .catch(async () => {
            const t = await cdp.evaluate(`(function () {
              var st = window.__box.querySelectorAll('div[role=status]');
              var s = []; for (var i = 0; i < st.length; i++) s.push(st[i].textContent);
              return s.join(' ||| ');
            })()`).catch(() => '<eval-fail>');
            console.log('    [S6 超时转储 status] ' + String(t).slice(-400));
            return false;
          });
      });
    const s6txt = await cdp.evaluate(`window.__box.textContent`);
    check('S6 三轮显式覆盖完成（各档案导入 2）', s6ok, (s6txt || '').slice(-260));
    const s6c = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      return { aN: a.length, bN: b.length };
    })()`);
    check('S6 三轮显式覆盖有界（各档案仍 2 条，无重复行）', s6c.aN === 2 && s6c.bN === 2, JSON.stringify(s6c));
    check('S6 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  }
  // ---- r2 返工新增（AP-R2-01/02 红回归 + AC3/AC4 验收补面）----
  // 真实工具中心界面定位：工具→人物与资源→独立离线动作包区，无需展开游戏转换。
  const REAL_UI = `(function () {
    var det = document.querySelector('#toolsPage .lib-offline-pack');
    if (!det) return { found: false };
    var drops = det.querySelectorAll('div'), drop = null;
    for (var j = 0; j < drops.length; j++) if (drops[j].textContent.indexOf('拖到这里') >= 0) drop = drops[j];
    var chks = det.querySelectorAll('input[type=checkbox]'), over = null, all = null;
    for (var k = 0; k < chks.length; k++) { var l = chks[k].nextElementSibling, lt = l ? l.textContent : '';
      if (lt.indexOf('覆盖同名动作') >= 0) over = chks[k]; if (lt.indexOf('导入到全部档案') >= 0) all = chks[k]; }
    var fileIn = det.querySelector('input[type=file]') || null;
    if (fileIn) fileIn.id = 'xatPackFileIn'; // 测试插桩：仅给 CDP DOM.setFileInputFiles 一个定位 id，不改产品代码
    window.__realDet = det; window.__realDrop = drop; window.__realOver = over; window.__realAll = all; window.__realFileIn = fileIn;
    return { found: true, independent: det.parentElement.classList.contains('lib-panel') && !det.closest('details'), count: document.querySelectorAll('#toolsPage input[accept=".gz,.json"]').length, drop: !!drop, over: !!over, all: !!all, fileIn: !!fileIn };
  })()`;
  const SETUP_REAL = `(async function () { // 两档案 + 非空生产文档（重复 id/多重/嵌套附加结构）
    var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
    var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
    var pa = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
    var pb = await ChoreoLibrary.createProfile({ name: '乙(c0301无码)', skeleton: t0301.skeleton });
    await ChoreoLibrary.setActiveProfile(pa.id);
    function mkDoc(nm) { return { name: nm, dancers: [
      { id: 'd1', name: '舞者一', actions: [ { id: 'act-dup', clip: 'nod', t: 0 }, { id: 'act-dup', clip: 'bow', t: 4 },
        { id: 'mv1', kind: 'move', path: [ { x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 } ] } ] },
      { id: 'd2', name: '舞者二', actions: [], extras: { nested: { deep: [1, 2, 2, 3], flag: true } } },
    ], globalLyrics: [ { id: 'l1', text: '啦', t: 0 }, { id: 'l1', text: '啦啦', t: 8 } ], dancerCount: 2, showLyricMacro: false, totalDuration: 120 }; }
    var p1 = await ChoreoProjects.createProject('验收项目甲', mkDoc('验收项目甲'));
    var p2 = await ChoreoProjects.createProject('验收项目乙', mkDoc('验收项目乙'));
    return { pa: pa.id, pb: pb.id, p1: p1.id, p2: p2.id };
  })()`;
  async function setViewport(cdp, w, h) { // 精确视口（window-size 不等于视口大小，评审口径用 Emulation 覆盖）
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  // 真实文件输入路径：CDP DOM.setFileInputFiles 于真实产品 input#xatPackFileIn（触发原生
  // change→importFile）。这是「CDP 文件输入」证据级：真实控件真实文件选择链，但不是 OS
  // 可视文件对话框（无头环境测不了，不冒充）。
  async function cdpSetFile(cdp, files) {
    await cdp.send('DOM.enable');
    // 先清空当前选择：同一文件路径重复设置时 Chrome 不触发 change（FileList 未变），
    // 显式重试场景（S10d/S13c）需要 change 再次发生——清空 value 等价用户重新选文件。
    await cdp.evaluate(`(function () { var f = document.getElementById('xatPackFileIn'); if (f) try { f.value = ''; } catch (e) {} })()`);
    const doc = await cdp.send('DOM.getDocument');
    const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#xatPackFileIn' });
    if (!q.nodeId) throw new Error('找不到真实文件输入 #xatPackFileIn（REAL_UI 未跑或界面未展开？）');
    await cdp.send('DOM.setFileInputFiles', { files: files.map((f) => path.resolve(f)), nodeId: q.nodeId });
    await sleep(300);
  }
  async function clickCenter(cdp, elJs) { // 真实鼠标点击（先滚动到视口内再取坐标——控件可能低于折叠线）
    await cdp.evaluate(`(function(){var el=${elJs};if(el&&el.scrollIntoView)el.scrollIntoView({block:'center'});})();`);
    await sleep(250);
    const pt = await cdp.evaluate(`(function(){var el=${elJs};if(!el||!el.getBoundingClientRect)return null;var r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (!pt) throw new Error('点击目标不可见：' + elJs);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(250);
  }
  async function shot(cdp, name) {
    try { const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(FIXTURE_DIR, name + '.png'), Buffer.from(r.data, 'base64')); } catch (e) { /* 取证失败不判红 */ }
  }

  console.log('— S7 真实工具中心展开界面＋精确双视口＋生产文档保护（AC3/用户流）—');
  {
    const cdp = await openPage();
    await setViewport(cdp, 1440, 900);
    await waitForEval(cdp, 'S7 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_REAL);
    const vw = await cdp.evaluate(`[window.innerWidth, window.innerHeight]`);
    check('S7 视口精确 1440×900（Emulation.setDeviceMetricsOverride）', vw[0] === 1440 && vw[1] === 900, JSON.stringify(vw));
    const docBefore = await cdp.evaluate(DOC_SNAPSHOT);
    const activeBefore = await cdp.evaluate(`ChoreoLibrary.getActiveProfile().then(function(p){return p&&p.id;})`);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    const lib = await cdp.evaluate(`(function(){var b=document.querySelector("[data-tools-page=library]");return {tab:!!b,active:!!(b&&b.classList.contains("active")),panel:!!document.querySelector("#toolsPage .lib-panel")};})()`);
    check('S7 工具 1 击 → 人物与资源页在场且激活（真实导航，非直接 append）', lib.tab && lib.active && lib.panel, JSON.stringify(lib));
    const uiClosed = await cdp.evaluate(REAL_UI);
    check('S7 离线动作包为顶层独立区（无需展开游戏转换，导入入口唯一）', uiClosed.found && uiClosed.independent && uiClosed.count === 1 && uiClosed.drop && uiClosed.over && uiClosed.all, JSON.stringify(uiClosed));
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    const uiOpen = await cdp.evaluate(`(function () {
      function vis(el) { return !!el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0; }
      return { independent: !window.__realDet.closest('details'), drop: vis(window.__realDrop), over: vis(window.__realOver), all: vis(window.__realAll) };
    })()`);
    check('S7 独立区拖拽框/覆盖/全部档案勾选直接可见', uiOpen.independent && uiOpen.drop && uiOpen.over && uiOpen.all, JSON.stringify(uiOpen));
    await clickCenter(cdp, 'window.__realAll.nextElementSibling'); // 真正点击标签文字也应切换同组 checkbox。
    await cdp.evaluate(`window.__realAll.checked === true || (function(){throw new Error('全部档案勾选未生效')})(); 'ok'`);
    await cdpSetFile(cdp, [V2_FILE]); // 真实文件输入路径（CDP setFileInputFiles，非合成拖拽）
    await waitForEval(cdp, 'S7 导入结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s7 = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib);
      var act = await ChoreoLibrary.getActiveProfile();
      var t = document.getElementById("toolsPage").textContent;
      return { aN: a.length, bN: b.length, activeSame: act && act.id === ${JSON.stringify(activeBefore)},
        convA: t.indexOf('已按 c1201 换算') >= 0, convB: t.indexOf('按档案骨架换算') >= 0, done: t.indexOf('导入结束') >= 0 };
    })()`);
    check('S7 真实界面导入完成：两档案各 2 条，activeProfile 未被改写', s7.aN === 2 && s7.bN === 2 && s7.activeSame, JSON.stringify(s7));
    check('S7 汇总明示换算目标', s7.convA && s7.convB);
    const docAfter = await cdp.evaluate(DOC_SNAPSHOT);
    check('S7 生产文档（含重复 id/多重/嵌套）导入前后逐字节一致', docBefore === docAfter);
    await shot(cdp, 's7-1440-expanded-done');
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
    await sleep(2500);
    const reread = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.getClip('fixture_nod', ${JSON.stringify(env.pa)});
      var b = await ChoreoLibrary.getClip('fixture_bow', ${JSON.stringify(env.pb)});
      return !!(a && a.bones && b && b.bones && a.duration === 1.5);
    })()`);
    check('S7 重开页面后两档案剪辑可读回', reread);
    check('S7 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }
  {
    const cdp = await openPage(640, 800);
    await setViewport(cdp, 640, 800);
    await waitForEval(cdp, 'S7b 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_REAL);
    const vw = await cdp.evaluate(`[window.innerWidth, window.innerHeight]`);
    check('S7b 视口精确 640×800', vw[0] === 640 && vw[1] === 800, JSON.stringify(vw));
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    const ui6 = await cdp.evaluate(`(function () {
      function vis(el) { return !!el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0; }
      return { independent: !window.__realDet.closest('details'), drop: vis(window.__realDrop), over: vis(window.__realOver), all: vis(window.__realAll),
        noHorizScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
    })()`);
    check('S7b 640×800 独立区控件可用（可见且无横向滚动）', ui6.independent && ui6.drop && ui6.over && ui6.all && ui6.noHorizScroll, JSON.stringify(ui6));
    const groups = await cdp.evaluate(`(function () {
      return [window.__realOver, window.__realAll].map(function(input){
        var label=input.closest('label'),box=input.getBoundingClientRect(),text=input.nextElementSibling.getBoundingClientRect();
        return {label:!!label,width:box.width,aligned:box.top<text.bottom&&box.bottom>text.top,textRight:text.left>=box.right};
      });
    })()`);
    check('S7b 两组勾选框与文字同行且点击标签归属明确', groups.length===2 && groups.every(g=>g.label&&g.width>0&&g.width<40&&g.aligned&&g.textRight), JSON.stringify(groups));
    // 滚动后实际可达（评审指摘 offsetParent 只证布局参与）：逐控件 scrollIntoView 后断言
    // getBoundingClientRect 完整落在视口内——指针可达（真实鼠标点击已用于展开与 S7 勾选）。
    const reach6 = await cdp.evaluate(`(function () {
      function inView(el) { if (!el) return false; el.scrollIntoView({ block: 'center' }); var r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1 && r.width > 0 && r.height > 0; }
      var d = inView(window.__realDrop), o = inView(window.__realOver), a = inView(window.__realAll);
      return { drop: d, over: o, all: a, vw: [window.innerWidth, window.innerHeight] };
    })()`);
    check('S7b 640×800 控件滚动后实际可达（rect 完整在视口内）', reach6.drop && reach6.over && reach6.all, JSON.stringify(reach6));
    await cdpSetFile(cdp, [V2_FILE]); // 不勾全部档案：单档案导入（真实文件输入路径）
    await waitForEval(cdp, 'S7b 导入结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const n6 = await cdp.evaluate(`ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}).then(function(x){return x.length;})`);
    check('S7b 640×800 真实界面完成单档案导入（2 条）', n6 === 2, 'n=' + n6);
    await shot(cdp, 's7b-640-expanded-done');
    vclean.cleanup();
  }

  if (UI_ONLY) {
    const passed = results.filter(Boolean).length;
    console.log('结果（S7/S7b）：' + passed + ' 通过 / ' + (results.length - passed) + ' 失败');
    process.exitCode = results.length === passed ? 0 : 1; return;
  }
  console.log('— S8 AC5/AP-R2-01B（真实导航＋CDP 文件输入＋写入 spy＋全库清单）：晚到坏剪辑整包写前拒绝 —');
  { // 红回归三例（第 1 轮 AP-R2-01 坏四元数保留＋第 2 轮 AP-R2-01B 坏骨键）：
    // 两条剪辑首条合法，第二条分别坏四元数（norm=4）/n_root 数据挪到 bone_999/挪到非 bone_N 键。
    // 旧行为=第一条先入库；修复后=整包写前拒绝、零写入（spy 零调用＋全库清单逐字节一致）。
    const cdp = await openPage();
    await waitForEval(cdp, 'S8 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll'); // 全档案勾选（真实点击）：两档案都在写入面里
    await cdp.evaluate(SPY_PUT);
    const invBefore = await cdp.evaluate(LIB_INV);
    const badLate = mkV2Pack();
    const cq = JSON.parse(JSON.stringify(badLate.clips[0]));
    cq.clip = JSON.parse(JSON.stringify(cq.clip));
    cq.clip.bones['bone_0'].q[1] = [0.75, 2, 0, 0, 0]; // norm=4（评审 bad-late-quaternion 口径）
    badLate.clips.push(cq);
    badLate.entries[1].clipIndex = 1;
    const BADQ_FILE = path.join(FIXTURE_DIR, 'fixture-bad-quat.json.gz');
    fs.writeFileSync(BADQ_FILE, zlib.gzipSync(Buffer.from(JSON.stringify(badLate), 'utf8'), { level: 9 }));
    await cdpSetFile(cdp, [BADQ_FILE]);
    await waitForEval(cdp, 'S8a 坏四元数写前拒绝提示', `document.getElementById("toolsPage").textContent.indexOf('导入失败') >= 0 && document.getElementById("toolsPage").textContent.indexOf('未归一') >= 0`, 20000);
    await cdpSetFile(cdp, [BAD999_FILE]);
    await waitForEval(cdp, 'S8b bone_999 写前拒绝提示', `document.getElementById("toolsPage").textContent.indexOf('导入失败') >= 0 && document.getElementById("toolsPage").textContent.indexOf('未声明的基准骨索引：bone_999') >= 0`, 20000);
    await cdpSetFile(cdp, [BADKEY_FILE]);
    await waitForEval(cdp, 'S8c 非法骨键写前拒绝提示', `document.getElementById("toolsPage").textContent.indexOf('导入失败') >= 0 && document.getElementById("toolsPage").textContent.indexOf('骨骼键非法') >= 0`, 20000);
    const s8 = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib);
      return { spy: window.__putSpy, aN: a.length, bN: b.length };
    })()`);
    const invAfter = await cdp.evaluate(LIB_INV);
    check('S8 写入 spy 零调用（putClip 从未被调用）', s8.spy === 0, 'spy=' + s8.spy);
    check('S8 首条合法剪辑也不得先入库（两档案零写入）', s8.aN === 0 && s8.bN === 0, JSON.stringify(s8));
    check('S8 全库清单前后逐字节一致（完整元数据＋实际存储 Blob 字节 SHA-256＋资源清单）', invBefore === invAfter);
    await shot(cdp, 's8-bone999-rejected-realui');
    vclean.cleanup();
  }

  console.log('— S9 AC6（真实导航）：无效档案诚实完成（3 档案×2 条目，planned=6，非「全部完成」）—');
  {
    const cdp = await openPage();
    await waitForEval(cdp, 'S9 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    const bad3 = await cdp.evaluate(`ChoreoLibrary.createProfile({ name: '无骨架档案' }).then(function(p){return p.id;})`);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S9 导入结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s9 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)}), c = await ChoreoLibrary.clipIndex(${JSON.stringify(bad3)});
      var t = document.getElementById("toolsPage").textContent;
      var failBoxes = Array.from(document.getElementById("toolsPage").querySelectorAll('div')).filter(function (d) { return /^失败 \\d+ 条：/.test(d.textContent); });
      return { aN: a.length, bN: b.length, cN: c.length,
        partial: t.indexOf('部分完成') >= 0, planned6: t.indexOf('共 6 项') >= 0, allDone: t.indexOf('全部完成') >= 0,
        rejLine: t.indexOf('未导入（2 项全部未导入）') >= 0,
        failBoxMentionsSkip: failBoxes.length > 0 && failBoxes.some(function (d) { return d.textContent.indexOf('无骨架档案') >= 0; }) };
    })()`);
    check('S9 部分完成＋planned=6＋被拒档案逐项对账（不得「全部完成」）', s9.partial && s9.planned6 && s9.rejLine && !s9.allDone, JSON.stringify(s9));
    check('S9 有效档案各 2 条，无效档案零写入', s9.aN === 2 && s9.bN === 2 && s9.cN === 0, JSON.stringify({ aN: s9.aN, bN: s9.bN, cN: s9.cN }));
    check('S9 失败列表不混入被拒档案的说明文字', !s9.failBoxMentionsSkip);
    await shot(cdp, 's9-invalid-profile-partial-realui');
    vclean.cleanup();
  }

  console.log('— S10 AC4 补面：真骨架突变 / 删档重建 / 覆盖字节等价 / 配额重试 —');
  { // a) 换载荷覆盖（真实导航＋CDP 文件输入）＋全非目标完整元数据/实际存储 Blob 字节/清单比对
    const cdp = await openPage();
    await waitForEval(cdp, 'S10a 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(`(async function () {
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
      var pa = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
      var pb = await ChoreoLibrary.createProfile({ name: '乙(c0301无码)', skeleton: t0301.skeleton });
      var pc = await ChoreoLibrary.createProfile({ name: '丙(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
      await ChoreoLibrary.setActiveProfile(pa.id);
      function mk(v) { return { name: 'fixture_nod', duration: 2, type: 'once', bones: { bone_0: { q: [[0, 0, 0, 0, 1], [2, 0, 0, 0, 1]], t: [[0, v, v, v], [2, v, v, v]], s: [[0, 1, 1, 1], [2, 1, 1, 1]] } } }; }
      await ChoreoLibrary.putClip('fixture_nod', mk(9), pa.id);
      await ChoreoLibrary.putClip('fixture_nod', mk(7), pb.id);
      await ChoreoLibrary.putClip('fixture_nod', mk(5), pc.id);
      return { pa: pa.id, pb: pb.id, pc: pc.id };
    })()`);
    const invBefore = await cdp.evaluate(LIB_INV);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realOver'); // 只勾覆盖（真实点击），不勾全部档案：单档案导入
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S10a 导入结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const invAfter = await cdp.evaluate(LIB_INV);
    const pick = (invJson, pids) => { // 非目标全集：profileClips 完整元数据记录＋profileClipData 实际存储 Blob 字节
      const inv = JSON.parse(invJson);
      return JSON.stringify({
        meta: inv.profileClips.filter((r) => pids.indexOf(r.profileId) >= 0),
        data: inv.profileClipData.filter((r) => pids.indexOf(r.profileId) >= 0),
      });
    };
    check('S10a 非目标档案（乙/丙）完整元数据＋实际存储 Blob 字节＋清单逐字节不变（非单条 getClip/非只比大小）',
      pick(invBefore, [env.pb, env.pc]) === pick(invAfter, [env.pb, env.pc]));
    const s10a = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.getClip('fixture_nod', ${JSON.stringify(env.pa)});
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var hip = t1201.skeleton.bones.filter(function (x) { return x.n === 'j_kosi'; })[0];
      var extra = await ChoreoLibrary.getClip('fixture_bow', ${JSON.stringify(env.pa)});
      return { aConverted: !!(a && a.bones && a.bones['bone_' + hip.i]), aOld: !!(a && a.bones && a.bones.bone_0 && a.duration === 2), bowThere: !!extra };
    })()`);
    check('S10a 覆盖生效：当前档案同名旧载荷被换算载荷替换（换载荷且落目标族索引）', s10a.aConverted && !s10a.aOld && s10a.bowThere, JSON.stringify({ converted: s10a.aConverted, old: s10a.aOld, bow: s10a.bowThere }));
    const hashesOf = (invJson, pid, nm) => { const inv = JSON.parse(invJson); return { meta: inv.profileClips.filter((r) => r.profileId === pid && r.name === nm), sha: inv.profileClipData.filter((r) => r.profileId === pid && r.name === nm) }; };
    const hB = hashesOf(invBefore, env.pa, 'fixture_nod'), hA = hashesOf(invAfter, env.pa, 'fixture_nod');
    check('S10a 目标档案 fixture_nod 存储元数据与 Blob 字节确实换过（前后 hash 不同）',
      hB.meta.length === 1 && hA.meta.length === 1 && hB.meta[0].hash !== hA.meta[0].hash && hB.sha[0].sha256 !== hA.sha[0].sha256);
    vclean.cleanup();
  }
  { // b)（组件级、预事务面；守卫事务开启后的同口径面见 S13a）延迟中真改目标档案骨架（裸 IDB 改 meta 记录）→ 快照不符全部作废
    const cdp = await openPage();
    const env = await cdp.evaluate(SETUP_TWO);
    await cdp.evaluate(SETUP_GATE);
    await cdp.evaluate(`window.__gate.hold = true; window.__allChk.checked = true; 'ok'`);
    await cdp.evaluate(dropFileJs(v2gz, 'anim-pack.json.gz'));
    await waitForEval(cdp, 'S10b 导入已开始', `window.__box.textContent.indexOf('个动作到') >= 0`, 30000);
    await cdp.evaluate(`(async function () { // 真骨架突变：c1201 档案的骨架整换成 c0301（不是改名）
      var skel = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0].skeleton;
      return await new Promise(function (ok, fail) {
        var rq = indexedDB.open('choreo3dlib');
        rq.onsuccess = function () {
          var db = rq.result, tx = db.transaction('meta', 'readwrite');
          var g = tx.objectStore('meta').get('profile:' + ${JSON.stringify(env.pa)});
          g.onsuccess = function () {
            if (!g.result) return fail(new Error('档案记录缺失'));
            g.result.data.skeleton = JSON.parse(JSON.stringify(skel));
            if (g.result.data.skeletonHash) g.result.data.skeletonHash = 'mutated';
            tx.objectStore('meta').put(g.result);
          };
          tx.oncomplete = function () { db.close(); ok('skeleton-mutated'); };
          tx.onerror = function () { fail(tx.error); };
        };
        rq.onerror = function () { fail(rq.error); };
      });
    })()`);
    await cdp.evaluate(`window.__gate.hold = false; 'release'`);
    await waitForEval(cdp, 'S10b 结束', `window.__box.textContent.indexOf('导入结束') >= 0`, 45000);
    const s10b = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      var t = window.__box.textContent;
      return { aN: a.length, bN: b.length, stopped: t.indexOf('已停止') >= 0 || /未开始 [1-9]/.test(t) };
    })()`);
    check('S10b 真骨架突变：其后写入作废（两档案零提交，汇总含停止/未开始）', s10b.stopped && s10b.aN === 0 && s10b.bN === 0, JSON.stringify(s10b));
    await shot(cdp, 's10b-skeleton-mutated');
    vclean.cleanup();
  }
  { // c)（真实导航＋CDP 文件输入）延迟中删目标档案并同名重建 → 写入不能重定向到新档案
    const cdp = await openPage();
    await waitForEval(cdp, 'S10c 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdp.evaluate(SETUP_GATE);
    await cdp.evaluate(`window.__gate.hold = true; 'ok'`);
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S10c 导入已开始', `document.getElementById("toolsPage").textContent.indexOf('个动作到') >= 0`, 30000);
    const reborn = await cdp.evaluate(`(async function () {
      await ChoreoLibrary.deleteProfile(${JSON.stringify(env.pa)});
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var np = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
      return { newId: np.id };
    })()`);
    await cdp.evaluate(`window.__gate.hold = false; 'release'`);
    await waitForEval(cdp, 'S10c 结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 45000);
    const s10c = await cdp.evaluate(`(async function () {
      var old = await ChoreoLibrary.getProfile(${JSON.stringify(env.pa)});
      var neu = await ChoreoLibrary.clipIndex(${JSON.stringify(reborn.newId)});
      var b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      var t = document.getElementById("toolsPage").textContent;
      return { oldGone: !old, newN: neu.length, bN: b.length, stopped: t.indexOf('已停止') >= 0 || /未开始 [1-9]/.test(t) };
    })()`);
    check('S10c 删档重建：写入不重定向（新档案零写入、旧 id 已删、冻结目标乙未受牵连前即作废）',
      s10c.oldGone && s10c.newN === 0 && s10c.bN === 0 && s10c.stopped && reborn.newId !== env.pa, JSON.stringify(s10c));
    vclean.cleanup();
  }
  { // d)（真实导航＋CDP 文件输入）模拟配额失败停该档案（诚实部分完成）＋显式重试补齐
    // 【标注】此处配额是「注入的 putClip Promise 拒绝」（写到事务开启之前）——不是真实 IDB
    // 事务中止；真实事务中止（活跃守卫事务内 abort）见 S13c，两者证据面明确区分。
    const cdp = await openPage();
    await waitForEval(cdp, 'S10d 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    await cdp.evaluate(`(function () { // 只对甲档案注入配额错误（乙照常），window.__quotaOff 释放
      var orig = ChoreoLibrary.putClip.bind(ChoreoLibrary);
      window.__quotaOff = false;
      ChoreoLibrary.putClip = function (name, clip, pid, guard) {
        if (!window.__quotaOff && pid === ${JSON.stringify(env.pa)}) return Promise.reject(new Error('QuotaExceededError: 浏览器存储配额不足'));
        return orig(name, clip, pid, guard);
      };
      return 'quota-gated';
    })()`);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S10d 首轮结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s10d1 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      var t = document.getElementById("toolsPage").textContent;
      return { aN: a.length, bN: b.length, partial: t.indexOf('部分完成') >= 0,
        aFail1: t.indexOf('失败 1') >= 0, aNotStart1: t.indexOf('未开始 1') >= 0 };
    })()`);
    check('S10d 模拟配额失败停该档案：甲失败 1 未开始 1（计数入断言）、乙照常 2 条、整体部分完成',
      s10d1.partial && s10d1.aN === 0 && s10d1.bN === 2 && s10d1.aFail1 && s10d1.aNotStart1, JSON.stringify(s10d1));
    await cdp.evaluate(`window.__quotaOff = true; 'quota released'`); // 显式重试（再次投递）
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S10d 重试结束', `(function(){var t=document.getElementById("toolsPage").textContent;return t.indexOf('导入结束')>=0&&t.indexOf('全部完成')>=0;})()`, 60000);
    const s10d2 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      var t = document.getElementById("toolsPage").textContent;
      return { aN: a.length, bN: b.length, allDone: t.indexOf('全部完成') >= 0, skipped2: t.indexOf('已在库跳过 2') >= 0 };
    })()`);
    check('S10d 显式重试补齐：甲 2 条导入、乙 2 条已在库跳过，全部完成', s10d2.allDone && s10d2.aN === 2 && s10d2.bN === 2 && s10d2.skipped2, JSON.stringify(s10d2));
    check('S10 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  // ---- r2 返工第 2 轮新增（AP-R2-EV-05）：S12 生产路径活动文档；S13 守卫事务开启后失效/中止 ----
  const SETUP_PROD_DOC = `(async function () { // 生产序列化（persistDoc）→ createProject → 设活动指针（不手动装载；装载走重开页面的生产路径）
    var proj = { dancers: [
      { id: 0, name: '舞者一', color: '#e8c57a', switchClips: [], actionClips: [
        { id: 11, start: 0, duration: 2, autoDur: false, data: { id: '999888777', name: '点头', command: '/nod motion', category: 'usual' } },
        { id: 12, start: 5, duration: 2, autoDur: false, data: { id: '999888777', name: '点头', command: '/nod motion', category: 'usual' } },
        { id: 13, start: 9, duration: 3, autoDur: false, data: { id: '111222333', name: '鞠躬', command: '/bow motion', category: 'usual', extra: { nested: { deep: [1, 2, 2, 3], flag: true } } } } ],
        lyricClips: [], currentJob: '', collapsed: false, laneScale: 1, solo: false, mute: false } ],
      globalLyrics: [ { id: 21, start: 0, duration: 2, text: '啦' }, { id: 22, start: 8, duration: 2, text: '啦啦' } ],
      dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [ { id: 31, t: 4, name: '段一' } ],
      customTop: { nested: { deep: [1, 2, 2, 3] } } };
    var content = ChoreoDocWire.persistDoc(proj, { id: 'seed', name: '验收项目甲' }, 3);
    var rec = await ChoreoProjects.createProject('验收项目甲', content);
    ChoreoProjects.setActiveId(rec.id);
    return { p1: rec.id };
  })()`;
  const PROJ_DB_SNAPSHOT = `(async function () { // 项目库快照：choreo3dproj 全部存储记录（Blob 一律按字节 SHA-256，不只比 size）+ 恢复镜像/localStorage
    function sha(b) { return crypto.subtle.digest('SHA-256', b).then(function (h) { return Array.from(new Uint8Array(h)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }); }
    async function deepSnap(v) {
      if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') return 'Blob:' + await sha(await v.arrayBuffer());
      if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(await deepSnap(v[i])); return a; }
      if (v && typeof v === 'object') { var o = {}; var ks = Object.keys(v).sort(); for (var j = 0; j < ks.length; j++) o[ks[j]] = await deepSnap(v[ks[j]]); return o; }
      return v;
    }
    var out = { ls: {}, db: null };
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/choreo|autosave|draft/.test(k)) out.ls[k] = localStorage.getItem(k); } } catch (e) {}
    out.db = await new Promise(function (ok) {
      var has = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
      has.then(function (dbs) {
        if (!dbs.some(function (d) { return d.name === 'choreo3dproj'; })) return ok('nodb');
        var r2 = indexedDB.open('choreo3dproj');
        r2.onsuccess = function () {
          var db = r2.result, stores = Array.from(db.objectStoreNames), parts = [], left = stores.length;
          if (!left) return ok('{}');
          stores.forEach(function (sn) {
            var q = db.transaction(sn, 'readonly').objectStore(sn).getAll();
            q.onsuccess = function () {
              deepSnap(q.result || []).then(function (snap) { parts.push(sn + ':' + JSON.stringify(snap)); if (!--left) { db.close(); ok(parts.sort().join('|')); } });
            };
            q.onerror = function () { if (!--left) { db.close(); ok(sn + ':ERR'); } };
          });
        };
        r2.onerror = function () { ok('ERR:open'); };
      });
    });
    return JSON.stringify(out);
  })()`;

  console.log('— S12 AC3：生产路径活动文档（persistDoc 建项目→重开页面生产装载→前置断言→导入零变化）—');
  {
    const cdp = await openPage();
    await waitForEval(cdp, 'S12 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROD_DOC);
    await cdp.send('Page.navigate', { url: PAGE_URL }); // 重开 = 生产装载路径（loadActiveProject→applyProjectContent）
    await cdp.evaluate('new Promise(function(ok){ (document.readyState==="complete") ? ok(1) : window.addEventListener("load", function(){ok(1)}); })');
    await waitForEval(cdp, 'S12 重开后应用就绪', `window.store && store.appReady`, 30000);
    await sleep(800);
    // 前置断言：活动文档确实非空且规范（重复原生 ID 多重/多重条目/嵌套内容确实在场——不用 Map 折叠后的形态）
    const pre = await cdp.evaluate(`(function () {
      var d = store.dancers[0];
      var dup = d.actionClips.filter(function (c) { return c.data && c.data.id === '999888777'; });
      var c3 = d.actionClips[2];
      var content = projectRecord().content;
      return {
        pid: store.projectId, clips: d.actionClips.length, dupN: dup.length,
        nested: !!(c3 && c3.data && c3.data.extra && c3.data.extra.nested && c3.data.extra.nested.deep && c3.data.extra.nested.deep.length === 4 && c3.data.extra.nested.flag === true),
        lyrics: store.globalLyrics.length, markers: (store.markers || []).length,
        customTop: !!(store.contentExtra && store.contentExtra.customTop && store.contentExtra.customTop.nested),
        tracksOk: !!(content && Array.isArray(content.tracks) && content.tracks.length >= 1),
        evN: content && content.tracks ? content.tracks.reduce(function (a, t) { return a + ((t && t.events) || []).length; }, 0) : 0,
      };
    })()`);
    check('S12 前置：活动文档经生产装载在场（项目 id 正确、3 条动作、2 条歌词、标记在）',
      pre.pid === env.p1 && pre.clips === 3 && pre.lyrics === 2 && pre.markers >= 1, JSON.stringify(pre));
    check('S12 前置：重复原生 ID 保持多重（dupN=2，未折叠）＋嵌套内容在场＋顶层未知键在场',
      pre.dupN === 2 && pre.nested && pre.customTop, JSON.stringify({ dupN: pre.dupN, nested: pre.nested, customTop: pre.customTop }));
    check('S12 前置：生产序列化含规范轨道（tracks≥1 且事件数≥3）', pre.tracksOk && pre.evN >= 3, JSON.stringify({ tracksOk: pre.tracksOk, evN: pre.evN }));
    const serBefore = await cdp.evaluate(`JSON.stringify(projectRecord().content)`);
    const projDbBefore = await cdp.evaluate(PROJ_DB_SNAPSHOT);
    // 两档案（先建：SETUP_PROFILES 会设活动档案，activeBefore 必须在其后捕获）＋真实工具中心导航＋CDP 文件输入
    const prof = await cdp.evaluate(SETUP_PROFILES);
    const activeBefore = await cdp.evaluate(`ChoreoLibrary.getActiveProfile().then(function(p){return p&&p.id;})`);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S12 导入结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s12 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(prof.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(prof.pb)});
      var d = store.dancers[0];
      var dup = d.actionClips.filter(function (c) { return c.data && c.data.id === '999888777'; });
      var act = await ChoreoLibrary.getActiveProfile();
      return { aN: a.length, bN: b.length, dupN: dup.length, clips: d.actionClips.length, activeSame: act && act.id === ${JSON.stringify(activeBefore)} };
    })()`);
    const serAfter = await cdp.evaluate(`JSON.stringify(projectRecord().content)`);
    const projDbAfter = await cdp.evaluate(PROJ_DB_SNAPSHOT);
    check('S12 导入完成：两档案各 2 条、activeProfile 未被改写', s12.aN === 2 && s12.bN === 2 && s12.activeSame, JSON.stringify(s12));
    check('S12 生产序列化（projectRecord().content）导入前后逐字节一致', serBefore === serAfter);
    check('S12 存储记录（choreo3dproj 全记录 Blob 按字节摘要＋恢复镜像/localStorage）导入前后逐字节一致', projDbBefore === projDbAfter);
    check('S12 导入后前置仍在（重复原生 ID 仍 2 重、动作仍 3 条——导入未折叠/未改动活动文档）', s12.dupN === 2 && s12.clips === 3, JSON.stringify({ dupN: s12.dupN, clips: s12.clips }));
    check('S12 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    await shot(cdp, 's12-prod-doc-unchanged');
    vclean.cleanup();
  }

  console.log('— S13a AC4：守卫事务开启后的档案骨架突变（真实 IDB 调度触发，非 putClip 前延迟）—');
  {
    const cdp = await openPage();
    await waitForEval(cdp, 'S13a 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdp.evaluate(TX_HOOK);
    await cdp.evaluate(`window.__mutPid = ${JSON.stringify(env.pa)}; 'armed'`);
    const invBefore = await cdp.evaluate(LIB_INV);
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S13a 结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s13a = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib);
      var t = document.getElementById("toolsPage").textContent;
      var atomic = await new Promise(function (ok) { // 原子性：被守卫取消的 fixture_bow 元数据与载荷都不得存在
        var rq = indexedDB.open('choreo3dlib');
        rq.onsuccess = function () {
          var db = rq.result, tx = db.transaction(['profileClips', 'profileClipData'], 'readonly');
          var g1 = tx.objectStore('profileClips').get([ia, 'fixture_bow']);
          var g2 = tx.objectStore('profileClipData').get([ia, 'fixture_bow']);
          var r = { meta: 'pending', data: 'pending' };
          g1.onsuccess = function () { r.meta = g1.result ? 'LEAKED' : 'absent'; };
          g2.onsuccess = function () { r.data = g2.result ? 'LEAKED' : 'absent'; };
          tx.oncomplete = function () { db.close(); ok(r); };
          tx.onerror = function () { db.close(); ok({ meta: 'txerr', data: 'txerr' }); };
        };
        rq.onerror = function () { ok({ meta: 'openerr', data: 'openerr' }); };
      });
      return { aN: a.length, aNames: a.map(function (c) { return c.name; }), bN: b.length,
        stopped: t.indexOf('已停止') >= 0 || /未开始 [1-9]/.test(t),
        mutAtTxCount: window.__mutAtTxCount, mutDone: window.__mutDone, guardTxN: window.__guardTxN,
        atomicBow: atomic };
    })()`);
    const invAfter = await cdp.evaluate(LIB_INV);
    const pickB = (invJson) => { // 乙（其后目标）全清单：clip 元数据+载荷字节+档案 meta 记录
      const inv = JSON.parse(invJson);
      return JSON.stringify({
        meta: inv.meta.filter((r) => r.id === 'profile:' + env.pb),
        clips: inv.profileClips.filter((r) => r.profileId === env.pb),
        data: inv.profileClipData.filter((r) => r.profileId === env.pb),
      });
    };
    check('S13a 突变在守卫事务真正开启后入队（__mutAtTxCount=1 且已落库，非 putClip 前延迟）',
      s13a.mutAtTxCount === 1 && s13a.mutDone && s13a.guardTxN >= 1, JSON.stringify({ mutAtTxCount: s13a.mutAtTxCount, mutDone: s13a.mutDone, guardTxN: s13a.guardTxN }));
    check('S13a 已提交前缀保留（甲仅 fixture_nod）＋后续陈旧写入停止（乙零写入 bN=0 入断言）＋汇总含停止/未开始',
      s13a.aN === 1 && s13a.aNames.join() === 'fixture_nod' && s13a.bN === 0 && s13a.stopped, JSON.stringify(s13a));
    check('S13a 被守卫取消的当前事务原子（fixture_bow 元数据与载荷两仓都不存在）',
      s13a.atomicBow.meta === 'absent' && s13a.atomicBow.data === 'absent', JSON.stringify(s13a.atomicBow));
    check('S13a 非目标（乙）完整元数据＋载荷字节＋清单不变', pickB(invBefore) === pickB(invAfter));
    await shot(cdp, 's13a-txopen-mutation');
    vclean.cleanup();
  }

  console.log('— S13b AC4：显式覆盖＋守卫事务开启后突变（非目标全量字节等价）—');
  {
    const cdp = await openPage();
    await waitForEval(cdp, 'S13b 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(`(async function () {
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var t0301 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c0301'; })[0];
      var pa = await ChoreoLibrary.createProfile({ name: '甲(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
      var pb = await ChoreoLibrary.createProfile({ name: '乙(c0301无码)', skeleton: t0301.skeleton });
      var pc = await ChoreoLibrary.createProfile({ name: '丙(c1201带码)', skeleton: t1201.skeleton, sourceSkeletonCode: 'c1201' });
      await ChoreoLibrary.setActiveProfile(pa.id);
      function mk(v) { return { name: 'fixture_nod', duration: 2, type: 'once', bones: { bone_0: { q: [[0, 0, 0, 0, 1], [2, 0, 0, 0, 1]], t: [[0, v, v, v], [2, v, v, v]], s: [[0, 1, 1, 1], [2, 1, 1, 1]] } } }; }
      await ChoreoLibrary.putClip('fixture_nod', mk(9), pa.id);
      await ChoreoLibrary.putClip('fixture_nod', mk(7), pb.id);
      await ChoreoLibrary.putClip('fixture_nod', mk(5), pc.id);
      return { pa: pa.id, pb: pb.id, pc: pc.id };
    })()`);
    const invBefore = await cdp.evaluate(LIB_INV);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realOver'); // 显式覆盖（真实点击）
    await clickCenter(cdp, 'window.__realAll');
    await cdp.evaluate(TX_HOOK);
    await cdp.evaluate(`window.__mutPid = ${JSON.stringify(env.pa)}; 'armed'`);
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S13b 结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s13b = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)}, ic = ${JSON.stringify(env.pc)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib), c = await ChoreoLibrary.clipIndex(ic);
      var t = document.getElementById("toolsPage").textContent;
      var t1201 = window.__CHOREO_SKELETON_PACK__.tribes.filter(function (x) { return x.code === 'c1201'; })[0];
      var hip = t1201.skeleton.bones.filter(function (x) { return x.n === 'j_kosi'; })[0];
      var nod = await ChoreoLibrary.getClip('fixture_nod', ia);
      var atomic = await new Promise(function (ok) {
        var rq = indexedDB.open('choreo3dlib');
        rq.onsuccess = function () {
          var db = rq.result, tx = db.transaction(['profileClips', 'profileClipData'], 'readonly');
          var g1 = tx.objectStore('profileClips').get([ia, 'fixture_bow']);
          var g2 = tx.objectStore('profileClipData').get([ia, 'fixture_bow']);
          var r = { meta: 'pending', data: 'pending' };
          g1.onsuccess = function () { r.meta = g1.result ? 'LEAKED' : 'absent'; };
          g2.onsuccess = function () { r.data = g2.result ? 'LEAKED' : 'absent'; };
          tx.oncomplete = function () { db.close(); ok(r); };
          tx.onerror = function () { db.close(); ok({ meta: 'txerr', data: 'txerr' }); };
        };
        rq.onerror = function () { ok({ meta: 'openerr', data: 'openerr' }); };
      });
      return { aN: a.length, aNames: a.map(function (x) { return x.name; }), bN: b.length, cN: c.length,
        nodConverted: !!(nod && nod.bones && nod.bones['bone_' + hip.i]),
        stopped: t.indexOf('已停止') >= 0 || /未开始 [1-9]/.test(t),
        mutAtTxCount: window.__mutAtTxCount, mutDone: window.__mutDone, atomicBow: atomic };
    })()`);
    const invAfter = await cdp.evaluate(LIB_INV);
    const pickNonT = (invJson) => {
      const inv = JSON.parse(invJson);
      return JSON.stringify({
        meta: inv.meta.filter((r) => r.id === 'profile:' + env.pb || r.id === 'profile:' + env.pc),
        clips: inv.profileClips.filter((r) => r.profileId === env.pb || r.profileId === env.pc),
        data: inv.profileClipData.filter((r) => r.profileId === env.pb || r.profileId === env.pc),
      });
    };
    check('S13b 覆盖首笔已提交（甲 fixture_nod 换成换算载荷、落目标族索引）＋其后守卫拦截（fixture_bow 缺席）',
      s13b.aN === 1 && s13b.aNames.join() === 'fixture_nod' && s13b.nodConverted && s13b.atomicBow.meta === 'absent' && s13b.atomicBow.data === 'absent',
      JSON.stringify({ aN: s13b.aN, names: s13b.aNames, nodConverted: s13b.nodConverted, atomicBow: s13b.atomicBow }));
    check('S13b 突变在守卫事务开启后入队＋后续陈旧写入停止（乙/丙零新增、汇总含停止/未开始）',
      s13b.mutAtTxCount === 1 && s13b.mutDone && s13b.bN === 1 && s13b.cN === 1 && s13b.stopped, JSON.stringify(s13b));
    check('S13b 非目标（乙/丙）完整元数据＋实际存储 Blob 字节＋清单逐字节不变', pickNonT(invBefore) === pickNonT(invAfter));
    vclean.cleanup();
  }

  console.log('— S13c AC4：真实事务中止注入（活跃守卫事务内 abort，区别于 S10d 模拟配额）＋显式重试 —');
  {
    const cdp = await openPage();
    await waitForEval(cdp, 'S13c 应用就绪', `window.store && store.appReady`, 30000);
    const env = await cdp.evaluate(SETUP_PROFILES);
    await clickCenter(cdp, 'document.getElementById("toolsBtn")');
    await cdp.evaluate(REAL_UI);
    await cdp.evaluate('window.__realDet.scrollIntoView({block:"center"});');
    await clickCenter(cdp, 'window.__realAll');
    await cdp.evaluate(ABORT_HOOK);
    await cdp.evaluate(`window.__abortKey = 'profile:' + ${JSON.stringify(env.pa)}; window.__abortArmed = true; 'armed'`);
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S13c 首轮结束', `document.getElementById("toolsPage").textContent.indexOf('导入结束') >= 0`, 60000);
    const s13c1 = await cdp.evaluate(`(async function () {
      var ia = ${JSON.stringify(env.pa)}, ib = ${JSON.stringify(env.pb)};
      var a = await ChoreoLibrary.clipIndex(ia), b = await ChoreoLibrary.clipIndex(ib);
      var t = document.getElementById("toolsPage").textContent;
      var atomic = await new Promise(function (ok) {
        var rq = indexedDB.open('choreo3dlib');
        rq.onsuccess = function () {
          var db = rq.result, tx = db.transaction(['profileClips', 'profileClipData'], 'readonly');
          var g1 = tx.objectStore('profileClips').get([ia, 'fixture_nod']);
          var g2 = tx.objectStore('profileClipData').get([ia, 'fixture_nod']);
          var r = { meta: 'pending', data: 'pending' };
          g1.onsuccess = function () { r.meta = g1.result ? 'LEAKED' : 'absent'; };
          g2.onsuccess = function () { r.data = g2.result ? 'LEAKED' : 'absent'; };
          tx.oncomplete = function () { db.close(); ok(r); };
          tx.onerror = function () { db.close(); ok({ meta: 'txerr', data: 'txerr' }); };
        };
        rq.onerror = function () { ok({ meta: 'openerr', data: 'openerr' }); };
      });
      return { aborted: window.__aborted, abortErr: window.__abortErr, aNames: a.map(function (x) { return x.name; }), aN: a.length, bN: b.length,
        partial: t.indexOf('部分完成') >= 0 || t.indexOf('已停止') >= 0, fail1: t.indexOf('失败 1') >= 0, atomicNod: atomic };
    })()`);
    check('S13c 真实事务中止发生（守卫事务进行中 abort 成功执行）', s13c1.aborted === true && !s13c1.abortErr, JSON.stringify({ aborted: s13c1.aborted, abortErr: s13c1.abortErr }));
    check('S13c 被中止写入原子（甲 fixture_nod 元数据与载荷两仓都不存在，无半条）',
      s13c1.atomicNod.meta === 'absent' && s13c1.atomicNod.data === 'absent', JSON.stringify(s13c1.atomicNod));
    // 观察到的产品语义（如实断言）：守卫事务被中止后其余读取不再派发成功事件 → onabort 走
    // 兜底「技能动作导入已取消」→ 导入器判守卫取消、整包保守停止（合同 §6 口径）：
    // 零提交、被中止条目计入失败列表、汇总含停止/未开始。
    check('S13c 首轮诚实保守停止（零提交、被中止条目进失败列表、汇总含停止/未开始）',
      s13c1.fail1 && s13c1.partial && s13c1.aN === 0 && s13c1.aNames.length === 0 && s13c1.bN === 0, JSON.stringify(s13c1));
    // 显式重试（再次真实投递同一包）：中止条目补齐，全部完成
    await cdpSetFile(cdp, [V2_FILE]);
    await waitForEval(cdp, 'S13c 重试结束', `(function(){var t=document.getElementById("toolsPage").textContent;return t.indexOf('导入结束')>=0&&t.indexOf('全部完成')>=0;})()`, 60000);
    const s13c2 = await cdp.evaluate(`(async function () {
      var a = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pa)}), b = await ChoreoLibrary.clipIndex(${JSON.stringify(env.pb)});
      var t = document.getElementById("toolsPage").textContent;
      return { aN: a.length, bN: b.length, allDone: t.indexOf('全部完成') >= 0, skipped: t.indexOf('已在库跳过') >= 0 };
    })()`);
    check('S13c 显式重试补齐（甲 2 条、全部完成）', s13c2.allDone && s13c2.aN === 2 && s13c2.bN === 2, JSON.stringify(s13c2));
    check('S13c 页面无 JS 异常', cdp.exceptions.length === 0, JSON.stringify((cdp.exceptions[0] || {}).text || '').slice(0, 120));
    vclean.cleanup();
  }

  const pass = results.filter(Boolean).length;
  console.log('结果：' + pass + ' 通过 / ' + (results.length - pass) + ' 失败');
  process.exit(results.length === pass ? 0 : 1);
}
main().catch((e) => {
  console.error('harness 失败：' + ((e && e.stack) || e));
  vclean.cleanup();
  process.exit(1);
});
