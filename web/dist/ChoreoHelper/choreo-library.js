/**
 * choreo-library.js — 编舞助手「本地 3D 资料库」（阶段 3）
 *
 * 干嘛的：把骨架、动作 clip、角色模型、动作目录存进浏览器本地（IndexedDB），
 *        游戏关掉以后网页照样能取到这些资料离线播放。所有存进来的动作 JSON
 *        用 gzip 无损压缩（浏览器原生 CompressionStream），264 条实测
 *        1178MB → 约 124MB（10.5%）；不支持压缩的老浏览器会存原始数据并如实标记。
 *
 * 谁用它：preview3d.js（骨架/模型/动作 缓存优先，插件在线时补拉）、
 *        编舞主页（动作目录离线兜底 + 资料库备份窗口）。它自己不碰任何页面 DOM。
 *
 * 角色档案（2026-08-30 新增）：「模型 + 骨架」打包成一套有名字的档案，库内可存多套、
 *        可切换（换角色/换种族不再静默套错骨架——事故见 CONTINUITY 2026-08-30）。
 *        存储复用现有仓（不升 IndexedDB 版本）：档案本体存 meta 仓（id='profile:<pid>'，
 *        骨架原文内联），模型文件存 files 仓（键 'pfile:<pid>:<文件名>'），
 *        活动档案指针存 meta（id='activeProfile'）。旧单套数据首次访问时自动迁移成
 *        「默认角色」档案，旧 API（getSkeleton/putModelFile…）全部变成"活动档案"的
 *        薄封装，老调用点行为不变。
 *
 * 备份格式（CHLB v2，二进制；v1 只读兼容导入）：
 *   [0..3]  魔数 "CHLB"
 *   [4..7]  格式版本号（u32 小端）
 *   [8..11] 头部 JSON 字节长度（u32 小端）
 *   [12..]  头部 JSON（补空格对齐到 64 字节，含每段数据的偏移/长度/哈希）
 *   之后    依次是各条 gzip 动作数据、模型文件的原始字节
 *   v2 头部里每条动作带 profileId/skeletonHash（逐动作归属，FIX-D/AUD2-009）、
 *   每个模型文件带内容 hash；v2 导入先全包 preflight（结构/hash/骨架关系/gltf↔bin
 *   完整性）全部通过才写库，坏包一个字节都不动现有资料。
 *
 * 动作按角色隔离（FIX-D/AUD2-008）：动作身份 = (profileId, 动作名)，存 profileClips/
 * profileClipData 两仓（IndexedDB v2，复合键）。旧全局 clips/clipdata 仓首次访问时
 * 按骨架指纹迁移：唯一匹配档案 → 迁过去；没指纹/对不上/多套同指纹 → 进「待归档」区
 * （profileId='__pending__'），主人在资料库窗口选档案认领，绝不静默绑到活动档案。
 *
 * 内容寻址复用 + 命名空间收口（CHARACTER-ASSETS-P4）：相同 SHA-256 的模型字节全库
 *        只存一份——载荷行存 files 仓（键 'mblob:<hash>'，本包声明的 pfile 内容寻址
 *        后继键族），各档案 pfile:<pid>:<名> 行降为引用行（ref=hash，不再内嵌字节；
 *        旧内联行照常可读）。删档案/换装导入时按「幸存引用行实算」回收失引载荷，
 *        不存计数器（重复共享/增删循环不漂移、不留孤儿）。跨档案用动作只有一条显式
 *        通道 copyClipToProfile（体检报告里主人确认后才调用）；读接口绝不跨档案借用。
 *
 * 角色分享包 .choreochar（CHARACTER-ASSETS-P5，DESIGN §3/§11）：一套档案点对点分享——
 *        骨架原文 + 该档案的模型文件字节 + 该档案命名空间的全部动作，打成一个自包含
 *        二进制包（魔数 "CHRC"、格式版本自成体系从 1 起，与 CHLB 备份互不误读）。
 *        导出只读一次性打包（零写入、不留分享草稿行）；导入先全包校验（信封/哈希/
 *        骨架指纹/动作内容/gltf 配套/重名/零字节）后单事务收养——任何失败或取消都
 *        一个字节不写。收养永远新档案 id、撞名本地改名、活动指针不动、模型字节走
 *        P4 内容寻址复用。不进包（构造上排除）：其他档案的行、待归档动作、全局动作
 *        目录、工程/歌词/音频、配对/会话/凭据、绝对路径、本机配置；也不引入任何
 *        账号/云端/上传端点——传输就是主人自己的文件交换。
 *
 * 注意：这是经典脚本（file:// 离线入口禁 ES 模块），整个文件包在一个 IIFE 里，
 *      只把 window.ChoreoLibrary 暴露出去——经典脚本共享全局作用域，不能污染别人。
 */

(function () {
  'use strict';

  var DB_NAME = 'choreo3dlib';
  var DB_VERSION = 2;
  var BUNDLE_MAGIC = [0x43, 0x48, 0x4C, 0x42];   // "CHLB"
  var BUNDLE_VERSION = 2;
  var SCHEMA_VERSION = 1;
  var SHARE_MAGIC = [0x43, 0x48, 0x52, 0x43];    // "CHRC"：.choreochar 角色分享包魔数（与 CHLB 备份互斥）
  var SHARE_VERSION = 1;                          // .choreochar 格式版本（自成体系，从 1 起）
  var PENDING_PID = '__pending__';  // 「待归档动作」虚拟档案：迁移/导入时归属不明的动作先放这里

  var _db = null;            // 已打开的连接
  var _dbName = DB_NAME;    // useDb() 可换库名（诊断页用独立测试库，不碰真实资料）
  var _txBackend = null;    // AUD-004 测试注入口：node 单测用假 IndexedDB 事务后端替代真库，传 null 恢复

  // ============ 基础工具 ============

  function available() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; }
  }

  function useDb(name) {
    if (_db && _db.name !== name) { try { _db.close(); } catch (e) {} _db = null; }
    _dbName = name || DB_NAME;
    _profEnsured = null;   // 换库（诊断页独立测试库）：档案迁移状态按新库重来
    _clipsMigrated = null; // 动作迁移同理
  }

  // AUD-004：node 单测注入口（window.ChoreoLibrary.useBackend(fn) / useBackend(null) 恢复）。
  // fn(stores, mode) 返回一个 IDBTransaction 形状的对象；只在测试环境用，产品不传
  function useBackend(fn) { _txBackend = fn; _profEnsured = null; _clipsMigrated = null; }

  function open() {
    if (_db) return Promise.resolve(_db);
    if (!available()) return Promise.reject(new Error('此浏览器不支持 IndexedDB，本地资料库不可用'));
    return new Promise(function (ok, err) {
      var rq = indexedDB.open(_dbName, DB_VERSION);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('clipdata')) db.createObjectStore('clipdata', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        // v2（FIX-D/AUD2-008）：动作按档案隔离的复合键仓；旧 clips/clipdata 保留做迁移源
        if (!db.objectStoreNames.contains('profileClips')) db.createObjectStore('profileClips', { keyPath: ['profileId', 'name'] });
        if (!db.objectStoreNames.contains('profileClipData')) db.createObjectStore('profileClipData', { keyPath: ['profileId', 'name'] });
      };
      rq.onsuccess = function () {
        _db = rq.result;
        _db.onversionchange = function () { try { _db.close(); } catch (e) {} _db = null; };
        repairOrphans(_db); // AUD-004：每次连接顺手清理历史半条记录（老版本双事务写入可能留下）
        ok(_db);
      };
      rq.onerror = function () { err(rq.error || new Error('资料库打开失败')); };
    });
  }

  function tx(stores, mode) {
    if (_txBackend) return Promise.resolve(_txBackend(stores, mode || 'readonly'));
    return open().then(function (db) {
      return db.transaction(stores, mode || 'readonly');
    });
  }

  function reqDone(r) {
    return new Promise(function (ok, err) {
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { err(r.error || new Error('资料库读写失败')); };
    });
  }

  function putOne(store, value) {
    return tx([store], 'readwrite').then(function (t) { return reqDone(t.objectStore(store).put(value)); });
  }

  // AUD-004：多条记录在同一个 readwrite 事务里提交，等 transaction complete 才算成功——
  // 任一条失败整组回滚，杜绝"元数据进了、数据没进"的幽灵动作（IndexedDB 单事务天然原子）
  function putManyAtomic(ops) {
    return tx(ops.map(function (o) { return o.store; }), 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        t.onabort = function () { err(t.error || new Error('资料库事务被中止，本次写入没有保存')); };
        try {
          ops.forEach(function (o) { t.objectStore(o.store).put(o.value); });
        } catch (e) {
          try { t.abort(); } catch (e2) {}
          return; // abort 后由 onabort 统一报错
        }
        t.oncomplete = function () { ok(); };
      });
    });
  }

  function getOne(store, key) {
    return tx([store], 'readonly').then(function (t) { return reqDone(t.objectStore(store).get(key)); })
      .then(function (v) { return v === undefined ? null : v; });
  }

  // AUD-004：孤儿修复——有元数据没数据、有数据没元数据的半条记录一律清掉。
  // 只按主键对比，不读大数据本体；清不动就静默放过（下次打开再试），绝不因此挡住资料库使用
  function repairOrphans(db) {
    try {
      var t1 = db.transaction(['clips', 'clipdata'], 'readonly');
      var r1 = t1.objectStore('clips').getAll();
      var r2 = t1.objectStore('clipdata').getAllKeys();
      var t3 = db.transaction(['profileClips', 'profileClipData'], 'readonly');
      var r3 = t3.objectStore('profileClips').getAll();
      var r4 = t3.objectStore('profileClipData').getAllKeys();
      t1.oncomplete = function () {
        try {
          var metaNames = {}, dataNames = {}, n = 0;
          (r1.result || []).forEach(function (r) { metaNames[r.name] = true; });
          (r2.result || []).forEach(function (k) { dataNames[k] = true; });
          var t2 = db.transaction(['clips', 'clipdata'], 'readwrite');
          (r1.result || []).forEach(function (r) { if (!dataNames[r.name]) { t2.objectStore('clips').delete(r.name); n++; } });
          (r2.result || []).forEach(function (k) { if (!metaNames[k]) { t2.objectStore('clipdata').delete(k); n++; } });
          t2.oncomplete = function () { if (n) console.info('ChoreoLibrary：清理了 ' + n + ' 条不完整的动作记录'); };
        } catch (e) {}
      };
      // v2 复合键仓同样的半条清理（键是 [profileId, name]）
      t3.oncomplete = function () {
        try {
          var pmeta = {}, pdata = {}, n2 = 0;
          (r3.result || []).forEach(function (r) { pmeta[r.profileId + '\u0000' + r.name] = true; });
          (r4.result || []).forEach(function (k) { pdata[k[0] + '\u0000' + k[1]] = true; });
          var t4 = db.transaction(['profileClips', 'profileClipData'], 'readwrite');
          (r3.result || []).forEach(function (r) { if (!pdata[r.profileId + '\u0000' + r.name]) t4.objectStore('profileClips').delete([r.profileId, r.name]); });
          (r4.result || []).forEach(function (k) { if (!pmeta[k[0] + '\u0000' + k[1]]) t4.objectStore('profileClipData').delete(k); });
        } catch (e) {}
      };
    } catch (e) {}
  }

  // ============ 压缩 / 哈希 ============

  function canGzip() { return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'; }

  function gzipBytes(u8) {
    if (!canGzip()) return Promise.resolve({ blob: new Blob([u8]), enc: 'raw' });
    return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
      .then(function (b) { return { blob: b, enc: 'gzip' }; });
  }

  function gunzipToText(blob, enc) {
    if (enc === 'raw' || !canGzip()) {
      if (enc === 'gzip') return Promise.reject(new Error('此浏览器不支持解压 gzip，动作数据读不出来'));
      return blob.text();
    }
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }

  function sha256Hex(u8) {
    if (!(typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest)) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', u8).then(function (d) {
      var b = new Uint8Array(d), s = '';
      for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s;
    });
  }

  function canonBytes(obj) {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  // 对外暴露的规范化哈希（WP-4 体检用：在线拉到的骨架和资料库缓存骨架算同一把 hash 比对）
  function hashObject(obj) { return sha256Hex(canonBytes(obj)); }

  // 结构指纹（TASK-20260917-SKELETON-KEY-REPAIR）：只含骨数+骨名+父索引，与姿态（t/q）无关。
  // 在线 /export/skeleton 返回的是抓取瞬间的动画姿态，整份哈希每次都变（证据
  // .agent/evidence/TASK-20260917-SKELETON-HASH-STABILITY/）；"这套档案是不是这副骨架"的
  // 对号判定因此改用结构指纹，整份哈希只留给字节级场景（备份校验等）。
  // 注意：sha256Hex 走 crypto.subtle 是异步的，本函数返回 Promise<string>，调用处须 await。
  async function structureHashOf(skel) {
    if (!skel || !skel.bones || !skel.count) return '';
    return sha256Hex(canonBytes({
      count: skel.count,
      bones: skel.bones.map(function (b) { return { i: b.i, n: b.n, p: b.p }; })
    }));
  }

  // ============ 角色档案（模型+骨架 成套管理，2026-08-30） ============

  var LEGACY_FILE_NAMES = ['model.glb', 'model.gltf', 'model.bin']; // 迁移前的旧模型文件键名
  // 迁移只跑一次（成功后缓存；失败即清除、下次访问重试——LIB-1：一次瞬时 IndexedDB/配额故障
  // 不能把迁移 promise 毒化到页面关闭。useDb/useBackend 换库/换测试后端时照旧作废）
  var _profEnsured = null;
  var _clipsMigrated = null;

  function profKey(pid) { return 'profile:' + pid; }
  function pfileKey(pid, name) { return 'pfile:' + pid + ':' + name; }
  function newPid() { return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  // ============ 模型字节内容寻址复用（CHARACTER-ASSETS-P4，DESIGN §8） ============
  // 相同字节的模型文件全库只存一份：载荷行 mblob:<sha256>（files 仓，本包声明的
  // 内容寻址后继键族），各档案的 pfile:<pid>:<名> 行是引用行（ref=hash + mime/size/hash
  // 元数据，不内嵌字节）。旧内联行（有 data 无 ref）照常可读，下次写入自然并入复用
  function mblobKey(hash) { return 'mblob:' + hash; }

  // 载荷回收：survivors=本次事务提交后将幸存的 files 行快照；凡没有任何幸存 pfile
  // 引用行指向的 mblob 载荷行一律删掉（extraKeep=本次新写入的 hash）。引用按行实算、
  // 不存计数器——并发共享/反复增删不会漂移；旧内联行自持字节，不构成对载荷行的引用
  function gcBlobRows(t, survivors, extraKeep) {
    var keep = {};
    (extraKeep || []).forEach(function (h) { keep[h] = true; });
    var blobs = [];
    (survivors || []).forEach(function (r) {
      var n = String((r && r.name) || '');
      if (n.indexOf('pfile:') === 0 && r.ref) keep[r.ref] = true;
      else if (n.indexOf('mblob:') === 0) blobs.push(r);
    });
    blobs.forEach(function (b) {
      if (!keep[String(b.name).slice(6)]) t.objectStore('files').delete(b.name);
    });
  }

  function txDone(t) {
    return new Promise(function (ok, err) {
      t.oncomplete = function () { ok(); };
      t.onabort = function () { err(t.error || new Error('资料库事务被中止')); };
    });
  }

  // 旧单套数据 → 「默认角色」档案。只在库里一套档案都没有时跑一次；
  // 模型文件搬进档案命名空间（不复制，112MB 不翻倍），旧骨架/旧模型键清掉
  function ensureProfiles() {
    if (_profEnsured) return _profEnsured;
    var p = (async function () {
      var all = await tx(['meta'], 'readonly').then(function (t) { return reqDone(t.objectStore('meta').getAll()); });
      var has = (all || []).some(function (r) { return r && r.id && String(r.id).indexOf('profile:') === 0; });
      if (has) return;
      var skelRec = (all || []).filter(function (r) { return r && r.id === 'skeleton'; })[0] || null;
      var files = await tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); });
      var legacyFiles = (files || []).filter(function (f) { return LEGACY_FILE_NAMES.indexOf(f.name) >= 0; });
      if (!skelRec && !legacyFiles.length) return; // 空库/全新安装：等第一次在线建档，不凭空造档案
      var pid = newPid();
      // LIB-2：老库的 skeleton 记录可能没有 hash 字段（更老版本落库的）——建档时就按原文算真指纹，
      // 别把空指纹写进档案，否则自家 v2 备份会被 preflight 误判成"备份可能被篡改"
      var skelHash = skelRec ? ((skelRec.hash || '') || (skelRec.data ? await hashObject(skelRec.data) : '')) : '';
      var ops = [{
        store: 'meta', value: {
          id: profKey(pid), data: {
            id: pid, name: '默认角色', createdAt: Date.now(), updatedAt: Date.now(),
            skeletonHash: skelHash, boneCount: skelRec ? (skelRec.boneCount || 0) : 0,
            skeleton: skelRec ? skelRec.data : null, modelNames: legacyFiles.map(function (f) { return f.name; })
          }
        }
      }, { store: 'meta', value: { id: 'activeProfile', pid: pid } }];
      legacyFiles.forEach(function (f) {
        ops.push({ store: 'files', value: { name: pfileKey(pid, f.name), mime: f.mime, size: f.size, data: f.data, hash: f.hash || '', updatedAt: f.updatedAt } });
      });
      await putManyAtomic(ops);
      try { // 搬迁后清旧键（失败无害：旧键只是多余副本，下次访问不影响档案读取）
        var t2 = await tx(['meta', 'files'], 'readwrite');
        t2.objectStore('meta').delete('skeleton');
        LEGACY_FILE_NAMES.forEach(function (n) { t2.objectStore('files').delete(n); });
        await txDone(t2);
      } catch (e) { /* 清不掉就算了 */ }
    })();
    _profEnsured = p;
    p.catch(function () { if (_profEnsured === p) _profEnsured = null; }); // LIB-1：拒绝不缓存，下次重试
    return p;
  }

  // FIX-D/AUD2-008：旧全局 clips/clipdata 仓 → 档案仓迁移。
  // 每条动作按元数据的骨架指纹对号：唯一匹配档案 → 迁入该档案；没指纹/对不上/
  // 多套同指纹 → 进「待归档」区（PENDING_PID），绝不静默绑到当前活动档案。
  // 单条动作的"搬入新仓+删旧仓"在同一个事务里：失败旧数据原样保留，下次重试（幂等）。
  // 所有 clip API 和 stats/exportBundle 开头都 await ensureClips()，所以旧数据在首次
  // 使用时自动迁完，不需要专门的升级按钮。
  function ensureClips() {
    if (_clipsMigrated) return _clipsMigrated;
    var p = (async function () {
      await ensureProfiles();
      var t1 = await tx(['clips', 'clipdata'], 'readonly');
      // 两个读请求同步发且同步挂回调（同 repairOrphans 的写法）：真 IDB 和假后端都兼容
      var p1 = reqDone(t1.objectStore('clips').getAll());
      var p2 = reqDone(t1.objectStore('clipdata').getAllKeys());
      var metas = await p1;
      var dataKeys = await p2;
      var haveData = {};
      (dataKeys || []).forEach(function (k) { haveData[k] = true; });
      var todo = (metas || []).filter(function (m) { return m && m.name && haveData[m.name]; });
      if (!todo.length) return;
      var lp = await loadProfiles();
      var byHash = {};  // 指纹 → [档案id]；多于一个=不唯一，进待归档
      lp.list.forEach(function (p) {
        var h = p.skeletonHash || '';
        if (!h) return;
        (byHash[h] = byHash[h] || []).push(p.id);
      });
      var moved = 0, pending = 0;
      for (var i = 0; i < todo.length; i++) {
        var m = todo[i];
        var cands = m.skeletonHash ? (byHash[m.skeletonHash] || []) : [];
        var pid = cands.length === 1 ? cands[0] : PENDING_PID;
        if (cands.length === 1) moved++; else pending++;
        await moveLegacyClip(m, pid);
      }
      // 迁移记录（版本+数量，主人问起来有账可查；失败不挡使用）
      try {
        var prev = await getOne('meta', 'clipMigration');
        var rec = prev || { id: 'clipMigration', version: 2, moved: 0, pending: 0 };
        rec.moved = (rec.moved || 0) + moved;
        rec.pending = Math.max(rec.pending || 0, 0) + pending;
        rec.at = Date.now();
        await putOne('meta', rec);
      } catch (e) { /* 记不了账就算了 */ }
      if (moved || pending) console.info('ChoreoLibrary：旧动作迁移完成——归入档案 ' + moved + ' 条，待归档 ' + pending + ' 条');
    })();
    _clipsMigrated = p;
    p.catch(function () { if (_clipsMigrated === p) _clipsMigrated = null; }); // LIB-1：拒绝不缓存，下次重试
    return p;
  }

  // 单条旧动作搬家：读旧数据 → 写档案仓两行 → 删旧仓两行，一个事务。失败整体回滚
  function moveLegacyClip(m, pid) {
    return tx(['clips', 'clipdata', 'profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        t.onabort = function () { err(t.error || new Error('迁移事务被中止')); };
        var g = t.objectStore('clipdata').get(m.name);
        g.onsuccess = function () {
          var d = g.result;
          if (!d) { ok(false); return; }
          try {
            t.objectStore('profileClips').put({
              profileId: pid, name: m.name, type: m.type || 'once', duration: m.duration || 0,
              hash: m.hash || '', skeletonHash: pid === PENDING_PID ? '' : (m.skeletonHash || ''),
              enc: m.enc, sizeRaw: m.sizeRaw || 0, sizeEnc: m.sizeEnc || 0, updatedAt: m.updatedAt || Date.now()
            });
            t.objectStore('profileClipData').put({ profileId: pid, name: m.name, data: d.data });
            t.objectStore('clips').delete(m.name);
            t.objectStore('clipdata').delete(m.name);
          } catch (e) { try { t.abort(); } catch (e2) {} return; }
          t.oncomplete = function () { ok(true); };
        };
        g.onerror = function () { err(g.error || new Error('迁移读取失败')); };
      });
    });
  }

  async function loadProfiles() {
    await ensureProfiles();
    var all = await tx(['meta'], 'readonly').then(function (t) { return reqDone(t.objectStore('meta').getAll()); });
    var list = (all || []).filter(function (r) { return r && r.id && String(r.id).indexOf('profile:') === 0; })
      .map(function (r) { return r.data; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    // LIB-2：存量"有骨架原文但指纹为空"的档案（老版本程序落库的）读到这里按原文回填并落库，
    // 导出/preflight/动作对号全拿真实指纹；防篡改不受影响（录了指纹且对不上照旧拒绝）
    var dirty = [];
    for (var hi = 0; hi < list.length; hi++) {
      var hp = list[hi];
      if (hp.skeleton && !hp.skeletonHash) {
        var hh = await hashObject(hp.skeleton);
        if (hh) { hp.skeletonHash = hh; dirty.push({ store: 'meta', value: { id: profKey(hp.id), data: hp } }); }
      }
    }
    if (dirty.length) { try { await putManyAtomic(dirty); } catch (e) { /* 回填失败无害：下次读取再试 */ } }
    var act = (all || []).filter(function (r) { return r && r.id === 'activeProfile'; })[0] || null;
    var activeId = act ? act.pid : (list.length ? list[0].id : null);
    if (!act && list.length) { // 指针丢了（如清空到一半）：修复到第一个档案
      putOne('meta', { id: 'activeProfile', pid: activeId }).catch(function () {});
    }
    return { list: list, activeId: activeId };
  }

  // 对外：档案列表（不含骨架原文，含模型文件占用）。isActive 标出当前档案
  async function listProfiles() {
    var lp = await loadProfiles();
    var rows = await tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); });
    var sizeOf = {};
    (rows || []).forEach(function (f) {
      if (String(f.name).indexOf('pfile:') !== 0) return;
      var pid = String(f.name).split(':')[1];
      sizeOf[pid] = (sizeOf[pid] || 0) + (f.size || 0);
    });
    // 旧档案没有 skeletonStructHash 字段时按骨架原文现算（只读不回写，读到哪算到哪；
    // structureHashOf 异步，先逐条算完再进同步 map）
    var structHashes = [];
    for (var si = 0; si < lp.list.length; si++) {
      var sp = lp.list[si];
      structHashes.push(sp.skeletonStructHash || (sp.skeleton ? await structureHashOf(sp.skeleton) : ''));
    }
    return lp.list.map(function (p, idx) {
      return {
        id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
        skeletonHash: p.skeletonHash || '',
        skeletonStructHash: structHashes[idx] || '',
        boneCount: p.boneCount || 0, hasSkeleton: !!p.skeleton,
        sourceSkeletonCode: p.sourceSkeletonCode || '',
        modelNames: (p.modelNames || []).slice(), modelSize: sizeOf[p.id] || 0,
        isActive: p.id === lp.activeId
      };
    });
  }

  async function getActiveProfile() {
    var lp = await loadProfiles();
    if (!lp.activeId) return null;
    for (var i = 0; i < lp.list.length; i++) if (lp.list[i].id === lp.activeId) return lp.list[i];
    return null;
  }

  // CHARACTER-ASSETS-P3：按 id 读整份档案记录（含内联骨架原文）——3D 预览为绑定到
  // 非活动档案的舞者建「额外母版」用。只读：查不到返回 null，绝不建档/切换/写库
  function getProfile(pid) {
    if (!pid || typeof pid !== 'string') return Promise.resolve(null);
    return loadProfiles().then(function (lp) {
      for (var i = 0; i < lp.list.length; i++) if (lp.list[i].id === pid) return lp.list[i];
      return null;
    });
  }

  function setActiveProfile(pid) {
    return loadProfiles().then(function (lp) {
      var hit = lp.list.some(function (p) { return p.id === pid; });
      if (!hit) return Promise.reject(new Error('档案不存在：' + pid));
      return putOne('meta', { id: 'activeProfile', pid: pid });
    });
  }

  // 快捷外观导入：只复制强骨架身份完全相同、逐条内容哈希通过的动作快照。
  async function prepareProfileClipCopy(sourcePid, targetHash, targetPid) {
    await ensureClips();
    var snapshot = await tx(['meta', 'profileClips', 'profileClipData'], 'readonly').then(function (t) {
      return Promise.all([
        reqDone(t.objectStore('meta').get(profKey(sourcePid))),
        reqDone(t.objectStore('profileClips').getAll()),
        reqDone(t.objectStore('profileClipData').getAll())
      ]);
    });
    var source = snapshot[0] && snapshot[0].data;
    if (!source || !source.skeleton || !targetHash || source.skeletonHash !== targetHash || await hashObject(source.skeleton) !== targetHash)
      throw new Error('原角色的骨架身份不一致，未复制动作或保存新档案');
    function ordered(rows) { return rows.filter(function (row) { return row.profileId === sourcePid; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); }
    var metadata = ordered(snapshot[1]), payloads = ordered(snapshot[2]), byName = Object.create(null), ops = [];
    payloads.forEach(function (row) { byName[row.name] = row; });
    if (payloads.length !== metadata.length) throw new Error('原角色的动作清单与内容不完整，未保存新档案');
    var profileText = JSON.stringify(source), metadataText = JSON.stringify(metadata);
    var payloadShape = JSON.stringify(payloads.map(function (row) { return [row.name, row.data && row.data.size, row.data && row.data.type]; }));
    for (var i = 0; i < metadata.length; i++) {
      var row = metadata[i], payload = byName[row.name];
      if (!row.name || !payload || !payload.data || row.skeletonHash !== targetHash || !/^[a-f0-9]{64}$/.test(row.hash || ''))
        throw new Error('动作「' + (row.name || '未命名') + '」缺少可靠的骨架身份或内容，未保存新档案');
      var clip;
      try { clip = JSON.parse(await gunzipToText(payload.data, row.enc)); }
      catch (e) { throw new Error('动作「' + row.name + '」无法读取，未保存新档案'); }
      if (!clip || !clip.bones || await hashObject(clip) !== row.hash)
        throw new Error('动作「' + row.name + '」内容校验不符，未保存新档案');
      var copied = JSON.parse(JSON.stringify(row));
      copied.profileId = targetPid; copied.updatedAt = Date.now();
      ops.push({ store: 'profileClips', value: copied });
      // Blob 是不可变快照；最终写入不再从活动源档案取未校验的字节。
      ops.push({ store: 'profileClipData', value: { profileId: targetPid, name: row.name, data: payload.data } });
    }
    return { sourcePid: sourcePid, profileText: profileText, metadataText: metadataText, payloadShape: payloadShape, ops: ops, count: metadata.length };
  }
  function putProfileImportAtomic(ops, copy) {
    if (!copy) return putManyAtomic(ops);
    return tx(['meta', 'files', 'profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        var failure = null, count = 0, values = [];
        t.onabort = function () { err(failure || t.error || new Error('资料库事务被中止，新模型和动作均未保存')); };
        t.oncomplete = function () { ok(); };
        function abort(message) { failure = new Error(message); try { t.abort(); } catch (e) { err(failure); } }
        var requests = [t.objectStore('meta').get(profKey(copy.sourcePid)), t.objectStore('profileClips').getAll(), t.objectStore('profileClipData').getAll()];
        requests.forEach(function (request, index) {
          request.onerror = function () { abort('原角色动作读取失败，新档案未保存'); };
          request.onsuccess = function () {
            values[index] = request.result;
            if (++count !== requests.length) return;
            function ordered(rows) { return rows.filter(function (row) { return row.profileId === copy.sourcePid; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); }
            var profileText = JSON.stringify(values[0] && values[0].data), metadataText = JSON.stringify(ordered(values[1]));
            var payloadShape = JSON.stringify(ordered(values[2]).map(function (row) { return [row.name, row.data && row.data.size, row.data && row.data.type]; }));
            if (profileText !== copy.profileText || metadataText !== copy.metadataText || payloadShape !== copy.payloadShape) {
              abort('导入期间原角色或动作已改变，请重试；新模型和动作均未保存'); return;
            }
            try { ops.concat(copy.ops).forEach(function (op) { t.objectStore(op.store).put(op.value); }); }
            catch (e) { abort('模型和动作保存失败，本次导入没有保存'); }
          };
        });
      });
    });
  }

  // 建档案。opts = { name, skeleton, files:[{name,blob}], copyClipsFrom? }；骨架原文内联进档案记录，
  // 模型文件按 P4 内容寻址入 files 仓（载荷行 mblob:<hash> + 档案引用行，同内容不重存）。
  // 骨架和文件同一事务提交
  async function createProfile(opts) {
    opts = opts || {};
    await ensureProfiles();
    var pid = newPid();
    var skeleton = opts.skeleton || null;
    var hash = skeleton ? await hashObject(skeleton) : '';
    // 结构指纹与整份指纹同存：对号判定用结构指纹（加性字段，旧档案缺它时读取侧现算兼容）
    var structHash = skeleton ? await structureHashOf(skeleton) : '';
    var clipCopy = opts.copyClipsFrom ? await prepareProfileClipCopy(opts.copyClipsFrom, hash, pid) : null;
    var ops = [];
    for (var i = 0; i < (opts.files || []).length; i++) {
      var f = opts.files[i];
      if (!f || !f.name || !f.blob) continue;
      var buf = await f.blob.arrayBuffer().catch(function () { return new ArrayBuffer(0); });
      var fh = buf.byteLength ? await sha256Hex(new Uint8Array(buf)) : '';
      ops.push({ store: 'files', value: { name: mblobKey(fh), data: f.blob, hash: fh, updatedAt: Date.now() } });
      ops.push({ store: 'files', value: { name: pfileKey(pid, f.name), ref: fh, hash: fh, mime: f.blob.type || 'application/octet-stream', size: f.blob.size, updatedAt: Date.now() } });
    }
    ops.push({
      store: 'meta', value: {
        id: profKey(pid), data: {
          id: pid, name: (opts.name || '角色') + '', createdAt: Date.now(), updatedAt: Date.now(),
          skeletonHash: hash, skeletonStructHash: structHash, boneCount: skeleton ? (skeleton.count || 0) : 0,
          // DANCER-AUTOADAPT（AC-4）：来源骨架种族码（cXXXX），加性字段——旧档案没有它
          // 照常读取；只做展示对号，不参与哈希匹配判定
          sourceSkeletonCode: validSourceCode(opts.sourceSkeletonCode) || '',
          skeleton: skeleton, modelNames: (opts.files || []).map(function (f) { return f.name; })
        }
      }
    });
    await putProfileImportAtomic(ops, clipCopy);
    var lp2 = await loadProfiles();
    if (!lp2.activeId) await setActiveProfile(pid).catch(function () {}); // 第一套档案自动成为活动档案
    var out = null;
    lp2.list.forEach(function (p) { if (p.id === pid) out = p; });
    if (out && clipCopy) out = Object.assign({}, out, { copiedClipCount: clipCopy.count }); // 回执字段，不写进档案存储。
    return out;
  }

  function renameProfile(pid, name) {
    return loadProfiles().then(function (lp) {
      var p = null;
      lp.list.forEach(function (x) { if (x.id === pid) p = x; });
      if (!p) return Promise.reject(new Error('档案不存在：' + pid));
      p.name = (name || '').trim() || p.name;
      p.updatedAt = Date.now();
      return putOne('meta', { id: profKey(pid), data: p });
    });
  }

  // DANCER-AUTOADAPT（AC-4）：补写档案的来源骨架种族码（cXXXX，来自转换产物/身份读取）。
  // 加性字段：只在码合法且与现值不同时写；无骨架的空壳档案不标（对号以骨架为准，空码如实为空）
  function validSourceCode(code) { return /^c\d{4}$/.test(String(code || '')) ? String(code) : ''; }
  async function setProfileSourceCode(pid, code) {
    code = validSourceCode(code);
    if (!code) return false;
    var lp = await loadProfiles();
    var p = null;
    lp.list.forEach(function (x) { if (x.id === pid) p = x; });
    if (!p) return Promise.reject(new Error('档案不存在：' + pid));
    if (!p.skeleton) return false;
    if ((p.sourceSkeletonCode || '') === code) return false;
    p.sourceSkeletonCode = code;
    p.updatedAt = Date.now();
    await putOne('meta', { id: profKey(pid), data: p });
    return true;
  }

  function deleteProfile(pid) {
    return (async function () {
      var lp = await loadProfiles();
      var hit = lp.list.some(function (p) { return p.id === pid; });
      if (!hit) return Promise.reject(new Error('档案不存在：' + pid));
      return tx(['meta', 'files'], 'readwrite').then(function (t) {
        return new Promise(function (ok, err) {
          t.onabort = function () { err(t.error || new Error('资料库事务被中止')); };
          var rowsReq = t.objectStore('files').getAll();
          rowsReq.onerror = function () { err(rowsReq.error || new Error('资料库读取失败')); };
          rowsReq.onsuccess = function () {
            try {
              var prefix = 'pfile:' + pid + ':';
              var survivors = [];
              (rowsReq.result || []).forEach(function (r) {
                var n = String(r.name);
                if (n.indexOf(prefix) === 0) t.objectStore('files').delete(n);
                else survivors.push(r); // P4：幸存引用行实算——只有这套档案引用的载荷一并回收
              });
              t.objectStore('meta').delete(profKey(pid));
              if (lp.activeId === pid) {
                var next = null;
                lp.list.forEach(function (p) { if (p.id !== pid && !next) next = p.id; });
                if (next) t.objectStore('meta').put({ id: 'activeProfile', pid: next });
                else t.objectStore('meta').delete('activeProfile');
              }
              gcBlobRows(t, survivors, []);
            } catch (e) { try { t.abort(); } catch (e2) {} return; }
            t.oncomplete = function () { ok(true); };
          };
        });
      });
    })();
  }

  // 档案作用域的模型文件读写（预览/导入共用；写入顺手更新档案的 modelNames 清单）。
  // P4：pfile 行是内容寻址引用行——读字节时顺藤去 mblob:<hash> 载荷行取 data；
  // 旧内联行（无 ref）直接用自身 data。载荷行缺失（理论不该发生）如实返回 null
  async function getProfileFile(pid, name) {
    var rec = await getOne('files', pfileKey(pid, name));
    if (!rec) return null;
    if (rec.ref) {
      var pay = await getOne('files', mblobKey(rec.ref));
      return pay ? pay.data : null;
    }
    return rec.data || null;
  }

  // 带元数据版（FIX-D/AUD2-009）：预览加载档案模型前用 hash 验完整性
  //（hash/mime/size 取自引用行——与载荷行同源同值，读路径不额外算哈希）
  async function getProfileFileInfo(pid, name) {
    var rec = await getOne('files', pfileKey(pid, name));
    if (!rec) return null;
    var data = rec.data || null;
    if (rec.ref) {
      var pay = await getOne('files', mblobKey(rec.ref));
      data = pay ? pay.data : null;
    }
    return { data: data, hash: rec.hash || '', mime: rec.mime || '', size: rec.size || 0 };
  }

  // 档案作用域的模型文件写入（P4：内容寻址复用）：字节只进 mblob:<hash> 载荷行（库内
  // 已有同内容载荷就不重写、保原 updatedAt——重复导入幂等），pfile:<pid>:<名> 行是引用行。
  // 单事务内「读 files 全表→读档案→写载荷/引用行→更新 modelNames→回收失引载荷」，
  // gltf/bin 两个文件并发回写也不会互相覆盖清单（2026-08-30 实测抓到的竞态），
  // 也不会留下没人引用的孤儿载荷。空名/非字符串名/空文件（0 字节）拒绝，零写入
  function putProfileFile(pid, name, blob) {
    if (!name || typeof name !== 'string') return Promise.reject(new Error('模型文件名或内容为空'));
    if (!blob || !blob.size) return Promise.reject(new Error('「' + name + '」是空文件（0 字节），不能入库'));
    return blob.arrayBuffer().catch(function () { return new ArrayBuffer(0); }).then(function (buf) {
      return sha256Hex(new Uint8Array(buf));
    }).then(function (hash) {
      return tx(['files', 'meta'], 'readwrite').then(function (t) {
        return new Promise(function (ok, err) {
          t.onabort = function () { err(t.error || new Error('资料库事务被中止，本次写入没有保存')); };
          var getReq = t.objectStore('meta').get(profKey(pid));
          getReq.onerror = function () { err(getReq.error || new Error('资料库读取失败')); };
          getReq.onsuccess = function () {
            var p = getReq.result && getReq.result.data;
            if (!p) { try { t.abort(); } catch (e2) {} return; }
            var gRows = t.objectStore('files').getAll();
            gRows.onerror = function () { err(gRows.error || new Error('资料库读取失败')); };
            gRows.onsuccess = function () {
              var rows = gRows.result || [];
              var payByHash = {};
              rows.forEach(function (r) { if (String(r.name).indexOf('mblob:') === 0) payByHash[String(r.name).slice(6)] = r; });
              try {
                if (!payByHash[hash]) t.objectStore('files').put({ name: mblobKey(hash), data: blob, hash: hash, updatedAt: Date.now() });
                t.objectStore('files').put({ name: pfileKey(pid, name), ref: hash, hash: hash, mime: blob.type || 'application/octet-stream', size: blob.size, updatedAt: Date.now() });
                if ((p.modelNames || []).indexOf(name) < 0) { p.modelNames = (p.modelNames || []).concat([name]); p.updatedAt = Date.now(); }
                t.objectStore('meta').put({ id: profKey(pid), data: p });
                // 本行换到新 hash 后旧 hash 可能没人引用了：按幸存引用实算回收
                gcBlobRows(t, rows.filter(function (r) { return String(r.name) !== pfileKey(pid, name); }), [hash]);
              } catch (e) { try { t.abort(); } catch (e2) {} return; }
              t.oncomplete = function () { ok(); };
            };
          };
        });
      });
    });
  }

  // ============ 页内直接导入模型套装（CHARACTER-ASSETS-P2） ============
  // 一次导入=对目标档案模型文件的整体替换：选中文件按「原始文件名」存成 pfile:<pid>:<name>
  // （与今日模型缓存同一个键形状），入库即算 SHA-256 指纹；旧模型文件行、档案 modelNames
  // 在同一个读写事务里一次换齐（all-or-nothing：校验不过零写入，事务中止旧套装原样保留）。
  // 校验全部先于任何写入：
  //   · 一套里必须恰好一个模型文档——一个 .glb，或一个 .gltf（+它引用的全部配套文件）；
  //     没有 / 两个以上 / 又 glb 又 gltf 都拒绝
  //   · 任何 0 字节文件拒绝（点名）
  //   · .glb 首四字节必须是 GLB 魔数 "glTF"
  //   · .gltf 必须能 JSON 解析；外部 buffer 的 uri 取「最后一段路径、去掉 query」的基名
  //     （与 CHLB v2 preflight 同款规则，data: 内嵌豁免），每个基名都必须在本次选中的文件里
  //     ——档案里已有同名配套文件也不算数（同一操作规则）
  // 返回 { pid, entry, names, files:[{name,hash,size}] }；entry=入口模型文件名（.glb 或 .gltf），
  // 预览按"清单里唯一 .glb，否则唯一 .gltf"同一口径解析，CHLB v2 往返后清单不变即入口不变
  async function importModelSet(pid, files) {
    if (!pid) throw new Error('没有指定要导入到的角色档案');
    var picked = [];
    (files || []).forEach(function (f) {
      if (f && f.name && f.blob) picked.push({ name: String(f.name), blob: f.blob });
    });
    if (!picked.length) throw new Error('没有选择任何模型文件');
    var docs = picked.filter(function (p) { return /\.glb$/i.test(p.name) || /\.gltf$/i.test(p.name); });
    if (!docs.length) {
      throw new Error('所选文件里没有 .glb 或 .gltf 模型文件（要选一个模型文件，或模型加它的配套 .bin 一起选）');
    }
    if (docs.length > 1) {
      throw new Error('一次只能导入一个模型文件（.glb 或 .gltf），本次选到了 ' + docs.length +
        ' 个：' + docs.map(function (d) { return '「' + d.name + '」'; }).join(''));
    }
    var entry = docs[0];
    for (var i = 0; i < picked.length; i++) {
      if (!picked[i].blob.size) throw new Error('「' + picked[i].name + '」是空文件（0 字节），无法导入');
    }
    var entryBytes = new Uint8Array(await entry.blob.arrayBuffer());
    if (/\.glb$/i.test(entry.name)) {
      if (entryBytes.length < 4 || entryBytes[0] !== 0x67 || entryBytes[1] !== 0x6C ||
          entryBytes[2] !== 0x54 || entryBytes[3] !== 0x46) {
        throw new Error('「' + entry.name + '」不是有效的 GLB 文件（文件头不是 glTF 魔数）');
      }
    } else {
      var doc = null;
      try { doc = JSON.parse(new TextDecoder().decode(entryBytes)); } catch (e) { doc = null; }
      if (!doc || typeof doc !== 'object') throw new Error('「' + entry.name + '」不是有效的 glTF 文件（JSON 解析失败）');
      var byName = {};
      picked.forEach(function (p) { byName[p.name] = true; });
      (doc.buffers || []).forEach(function (b) {
        var uri = (b && b.uri) || '';
        if (!uri || uri.indexOf('data:') === 0) return;
        var base = String(uri).split('/').pop().split('?')[0];
        if (!base || byName[base]) return;
        throw new Error('「' + entry.name + '」引用的外部文件「' + base + '」不在本次选择的文件里（模型不成套，需要把配套文件一起选上）');
      });
    }
    // 入库指纹先算好（读写事务里不再夹异步运算）；入口文件的字节已读过，直接复用
    var hashed = [];
    for (var h = 0; h < picked.length; h++) {
      var u8 = picked[h] === entry ? entryBytes : new Uint8Array(await picked[h].blob.arrayBuffer());
      hashed.push({ name: picked[h].name, blob: picked[h].blob, size: picked[h].blob.size, hash: await sha256Hex(u8) });
    }
    return await tx(['files', 'meta'], 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        t.onabort = function () { err(t.error || new Error('资料库事务被中止，本次导入没有保存')); };
        var gProf = t.objectStore('meta').get(profKey(pid));
        var gRows = t.objectStore('files').getAll();
        gProf.onerror = function () { err(gProf.error || new Error('资料库读取失败')); };
        gRows.onerror = function () { err(gRows.error || new Error('资料库读取失败')); };
        gRows.onsuccess = function () {
          var rec = gProf.result && gProf.result.data;
          if (!rec) { err(new Error('档案不存在：' + pid)); try { t.abort(); } catch (e2) {} return; }
          var prefix = 'pfile:' + pid + ':';
          var rows = gRows.result || [];
          var payByHash = {};   // P4：库内已有的内容寻址载荷（同内容不重写，幂等）
          rows.forEach(function (r) { if (String(r.name).indexOf('mblob:') === 0) payByHash[String(r.name).slice(6)] = r; });
          var keep = {};
          hashed.forEach(function (x) { keep[x.name] = true; });
          var survivors = [];
          try {
            rows.forEach(function (r) {
              var n = String(r.name);
              if (n.indexOf(prefix) === 0) {
                if (!keep[n.slice(prefix.length)]) t.objectStore('files').delete(n);
              } else survivors.push(r); // 本档案 pfile 行全排除（保留名也会换成新引用行）
            });
            hashed.forEach(function (x) {
              if (!payByHash[x.hash]) t.objectStore('files').put({ name: mblobKey(x.hash), data: x.blob, hash: x.hash, updatedAt: Date.now() });
              t.objectStore('files').put({
                name: pfileKey(pid, x.name), ref: x.hash, hash: x.hash,
                mime: x.blob.type || 'application/octet-stream', size: x.size, updatedAt: Date.now()
              });
            });
            rec.modelNames = hashed.map(function (x) { return x.name; });
            rec.updatedAt = Date.now();
            t.objectStore('meta').put({ id: profKey(pid), data: rec });
            gcBlobRows(t, survivors, hashed.map(function (x) { return x.hash; }));
          } catch (e) { try { t.abort(); } catch (e2) {} err(e); return; }
          t.oncomplete = function () {
            ok({
              pid: pid, entry: entry.name, names: hashed.map(function (x) { return x.name; }),
              files: hashed.map(function (x) { return { name: x.name, hash: x.hash, size: x.size }; })
            });
          };
        };
      });
    });
  }

  // ============ 骨架 / 目录 / 模型文件（旧 API：现在都指向"活动档案"） ============

  function getSkeleton() {
    return getActiveProfile().then(function (p) { return p && p.skeleton ? p.skeleton : null; });
  }

  // 旧语义"把在线骨架存进来"现在=自动对号：已有同骨架的档案就用它（没活动指针时指过去），
  // 没有就建新档案并切过去。返回 {id, matched}。preview3d 的建档/切换走更细的新 API，
  // 这里主要服务备份导入和旧调用点
  async function putSkeleton(skel) {
    if (!skel || !skel.bones || !skel.count) return Promise.reject(new Error('骨架数据不完整，没有存'));
    var hash = await hashObject(skel);
    var lp = await loadProfiles();
    var match = null;
    lp.list.forEach(function (p) { if (!match && p.skeletonHash === hash) match = p; });
    if (match) {
      match.skeleton = skel; match.skeletonHash = hash; match.boneCount = skel.count; match.updatedAt = Date.now();
      await putOne('meta', { id: profKey(match.id), data: match });
      if (!lp.activeId) await setActiveProfile(match.id).catch(function () {});
      return { id: match.id, matched: true };
    }
    var np = await createProfile({ name: '角色 ' + (lp.list.length + 1), skeleton: skel });
    await setActiveProfile(np.id).catch(function () {});
    return { id: np.id, matched: false };
  }

  function getSkeletonInfo() {
    return getActiveProfile().then(function (p) {
      return p && p.skeleton ? { hash: p.skeletonHash || '', boneCount: p.boneCount || (p.skeleton.count || 0), updatedAt: p.updatedAt } : null;
    });
  }

  function getCatalog() {
    return getOne('meta', 'catalog').then(function (rec) { return rec ? rec.data : null; });
  }

  function putCatalog(cat, options) {
    if (!cat || !cat.emotes || !cat.emotes.length) return Promise.resolve(false);
    return tx(['meta'], 'readwrite').then(function(t){
      return new Promise(function(resolve,reject){
        var signal=options&&options.signal;
        function abort(){try{t.abort()}catch(e){}}
        function cleanup(){if(signal)signal.removeEventListener('abort',abort)}
        t.oncomplete=function(){cleanup();resolve(true)};
        t.onabort=t.onerror=function(){cleanup();reject(t.error||new Error('目录保存取消或失败，保留上次有效目录'))};
        if(signal){signal.addEventListener('abort',abort);if(signal.aborted){abort();return}}
        t.objectStore('meta').put({id:'catalog',data:cat,updatedAt:Date.now()});
      });
    });
  }

  // 旧 API：模型文件读写指向"活动档案"的命名空间（没有活动档案时自动建一个空档案兜底）
  async function activePidOrNew() {
    var p = await getActiveProfile();
    if (p) return p.id;
    var np = await createProfile({ name: '默认角色' });
    return np.id;
  }

  function putModelFile(name, blob) {
    return activePidOrNew().then(function (pid) { return putProfileFile(pid, name, blob); });
  }

  function getModelFile(name) {
    return getActiveProfile().then(function (p) { return p ? getProfileFile(p.id, name) : Promise.resolve(null); });
  }

  function getModelFiles() {
    return getActiveProfile().then(function (p) {
      if (!p) return Promise.resolve([]);
      var prefix = 'pfile:' + p.id + ':';
      return tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); })
        .then(function (rows) {
          return (rows || []).filter(function (r) { return String(r.name).indexOf(prefix) === 0; })
            .map(function (r) { return { name: String(r.name).slice(prefix.length), size: r.size, hash: r.hash || '', updatedAt: r.updatedAt }; })
            .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        });
    });
  }

  function deleteModelFiles() {
    return (async function () {
      var p = await getActiveProfile();
      if (!p) return false;
      var prefix = 'pfile:' + p.id + ':';
      var rows = await tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); });
      var t = await tx(['files', 'meta'], 'readwrite');
      var survivors = [];
      (rows || []).forEach(function (r) {
        if (String(r.name).indexOf(prefix) === 0) t.objectStore('files').delete(r.name);
        else survivors.push(r); // P4：失引载荷一并回收，清空模型不留孤儿字节
      });
      gcBlobRows(t, survivors, []);
      p.modelNames = []; p.updatedAt = Date.now();
      t.objectStore('meta').put({ id: profKey(p.id), data: p });
      await txDone(t);
      return true;
    })();
  }

  // ============ 动作 clip（FIX-D/AUD2-008：按角色档案隔离） ============
  // 动作身份 = (profileId, 动作名)。所有 API 的 pid 参数省略时解析为当前活动档案
  // （旧调用点零改动）；读 API 在没有活动档案时返回空/不建档，写 API 会自动建
  // 「默认角色」兜底（老行为）。写入时把"目标档案"的骨架指纹盖在元数据上。

  // 存原始 clip JSON（录制文件原样），用参考骨架补齐发生在 preview3d 注册时——
  // 这样换了骨架以后库里的动作还能按新骨架重新补齐，不会把补齐结果焊死在数据里
  async function putClip(name, clipObj, pid, guard) {
    // P4（AC-2）：空名/非字符串名直接拒绝（中文原因、零写入）——复合键语义下键形状必须可判
    if (!name || typeof name !== 'string') return Promise.reject(new Error('动作名不能为空'));
    if (!clipObj || !clipObj.bones) return Promise.reject(new Error('动作数据不完整：' + name));
    await ensureClips();
    var target = pid || await activePidOrNew();
    var u8 = canonBytes(clipObj);
    var hash = await sha256Hex(u8);
    var gz = await gzipBytes(u8);
    var prof = await getOne('meta', profKey(target));
    var p = prof && prof.data;
    // FIX-4/AUD-013 惯例：写入时把"目标档案的骨架指纹"盖在动作元数据上（clip↔骨架绑定），
    // 体检拿它发现"动作是在别的角色外形下录的"。档案没骨架时留空——不误报
    var stamp = p && p.skeleton ? (p.skeletonHash || '') : '';
    // AUD-004：元数据和数据同一个事务提交（atomic），不会再出现"索引里有、内容读不出"的半条
    var clipOps = [
      {
        store: 'profileClips',
        value: {
          profileId: target, name: name, type: clipObj.type || 'once', duration: clipObj.duration || 0,
          hash: hash, skeletonHash: stamp, enc: gz.enc, sizeRaw: u8.length, sizeEnc: gz.blob.size, updatedAt: Date.now()
        }
      },
      { store: 'profileClipData', value: { profileId: target, name: name, data: gz.blob } }
    ];
    if (guard) {
      // 技能资源显式导入：核对同一档案快照和会话，不覆盖已有同名私人动作。
      // r2（TASK-20260918-ANIM-PACK-UNIVERSAL）加性扩展：guard.allowOverwrite=true 时允许
      // 覆盖冻结目标里的同名剪辑。原守卫在此硬性取消（"已有不同的同名技能动作，保留原
      // 资源"）且无任何开关可绕——通用动作包「显式覆盖同名」无法在旧语义下表达，故按合同
      // 以向后兼容的 opt-in 开关扩展：旧调用方不传 allowOverwrite，行为与原先逐字节一致。
      var transaction = await tx(['meta', 'profileClips', 'profileClipData'], 'readwrite');
      await new Promise(function(resolve, reject) {
        var reason, values = [], remaining = guard.activeProfileId ? 3 : 2;
        transaction.onabort = function() { reject(reason || transaction.error || new Error('技能动作导入已取消')); };
        transaction.oncomplete = resolve;
        function cancel(message) { reason = new Error(message); transaction.abort(); }
        var reads = [transaction.objectStore('meta').get(profKey(target)), transaction.objectStore('profileClips').get([target, name])];
        if (guard.activeProfileId) reads.push(transaction.objectStore('meta').get('activeProfile'));
        reads.forEach(function(req, i) {
          req.onsuccess = function() {
            values[i] = req.result;
            if (--remaining) return;
            try {
              if (!guard.current() || JSON.stringify(values[0] && values[0].data) !== guard.profileText) return cancel('项目、舞者或角色档案已变化，技能动作未保存');
              if (guard.activeProfileId && (!values[2] || values[2].pid !== guard.activeProfileId)) return cancel('活动角色档案已变化，技能动作未保存');
              if (values[1]) {
                if (values[1].hash === hash && values[1].skeletonHash === stamp) return;
                if (!guard.allowOverwrite) return cancel('此档案已有不同的同名技能动作，保留原资源');
              }
              clipOps.forEach(function(op) { transaction.objectStore(op.store).put(op.value); });
            } catch(e) { cancel(e.message); }
          };
        });
      });
    } else await putManyAtomic(clipOps);
    return { name: name, sizeEnc: gz.blob.size, sizeRaw: u8.length, enc: gz.enc };
  }

  async function getClip(name, pid) {
    try {
      await ensureClips();
      var p = pid || null;
      if (!p) { var act = await getActiveProfile(); p = act ? act.id : null; }
      if (!p) return null;
      var r = await Promise.all([getOne('profileClips', [p, name]), getOne('profileClipData', [p, name])]);
      var meta = r[0], data = r[1];
      if (!meta || !data) return null;
      var txt = await gunzipToText(data.data, meta.enc);
      try { return JSON.parse(txt); } catch (e) { return null; }
    } catch (e) { return null; }
  }

  async function deleteClip(name, pid) {
    await ensureClips();
    var p = pid || null;
    if (!p) { var act = await getActiveProfile(); p = act ? act.id : null; }
    if (!p) return false;
    await tx(['profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      t.objectStore('profileClips').delete([p, name]);
      return reqDone(t.objectStore('profileClipData').delete([p, name]));
    });
    return true;
  }

  // 某个档案（缺省=活动档案）的动作索引。体检缺录/健康检查/预览缓存全都走这里，
  // 天然就是"当前档案"口径
  async function clipIndex(pid) {
    await ensureClips();
    var p = pid || null;
    if (!p) { var act = await getActiveProfile(); p = act ? act.id : null; }
    if (!p) return [];
    var rows = await tx(['profileClips'], 'readonly').then(function (t) { return reqDone(t.objectStore('profileClips').getAll()); });
    return (rows || [])
      .filter(function (r) { return r.profileId === p; })
      .map(function (r) {
        return { name: r.name, type: r.type, duration: r.duration, hash: r.hash, skeletonHash: r.skeletonHash || '', enc: r.enc, sizeRaw: r.sizeRaw, sizeEnc: r.sizeEnc, updatedAt: r.updatedAt };
      })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  }

  // 「待归档动作」索引：旧数据迁移/备份导入时归属不明的动作都在这里，
  // 等主人在资料库窗口选档案认领
  function pendingClipIndex() { return clipIndex(PENDING_PID); }

  // P4：全档案动作索引（一次 getAll 按 profileId 分组）——体检逐档案缺录判定和
  // 3D 预览「同名动作只在别的档案」检测共用。只读元数据，不碰数据仓
  async function allClipIndex() {
    await ensureClips();
    var rows = await tx(['profileClips'], 'readonly').then(function (t) { return reqDone(t.objectStore('profileClips').getAll()); });
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.profileId) return;
      (out[r.profileId] = out[r.profileId] || []).push({
        name: r.name, type: r.type, duration: r.duration, hash: r.hash,
        skeletonHash: r.skeletonHash || '', enc: r.enc, sizeRaw: r.sizeRaw, sizeEnc: r.sizeEnc, updatedAt: r.updatedAt
      });
    });
    for (var p in out) out[p].sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return out;
  }

  // 把待归档动作认领到某套档案：归属写入 + 盖上该档案的骨架指纹，单条一个原子事务。
  // 返回实际归档的动作名列表
  async function assignPendingClips(names, pid) {
    if (!names || !names.length) return [];
    if (!pid || pid === PENDING_PID) throw new Error('请先选择要归档到的角色档案');
    await ensureClips();
    var prof = await getOne('meta', profKey(pid));
    var p = prof && prof.data;
    if (!p) throw new Error('档案不存在：' + pid);
    var stamp = p.skeleton ? (p.skeletonHash || '') : '';
    var moved = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var done = await tx(['profileClips', 'profileClipData'], 'readwrite').then(function (t) {
        return new Promise(function (ok, err) {
          t.onabort = function () { err(t.error || new Error('归档事务被中止')); };
          var gm = t.objectStore('profileClips').get([PENDING_PID, name]);
          gm.onsuccess = function () {
            var gd = t.objectStore('profileClipData').get([PENDING_PID, name]);
            gd.onsuccess = function () {
              if (!gm.result || !gd.result) { ok(false); return; }
              try {
                var m = gm.result;
                t.objectStore('profileClips').put({
                  profileId: pid, name: name, type: m.type, duration: m.duration, hash: m.hash,
                  skeletonHash: stamp, enc: m.enc, sizeRaw: m.sizeRaw, sizeEnc: m.sizeEnc, updatedAt: Date.now()
                });
                t.objectStore('profileClipData').put({ profileId: pid, name: name, data: gd.result.data });
                t.objectStore('profileClips').delete([PENDING_PID, name]);
                t.objectStore('profileClipData').delete([PENDING_PID, name]);
              } catch (e) { try { t.abort(); } catch (e2) {} return; }
              t.oncomplete = function () { ok(true); };
            };
            gd.onerror = function () { err(gd.error || new Error('归档读取失败')); };
          };
          gm.onerror = function () { err(gm.error || new Error('归档读取失败')); };
        });
      });
      if (done) moved.push(name);
    }
    return moved;
  }

  // P4（AC-3）：唯一跨档案动作通道——把一条动作显式复制进目标档案的命名空间。
  // 源档案两行（元数据+数据）字节原样不动；目标行在同一个事务里写入，指纹按
  // 「目标档案」重新盖章（不沿用源档案指纹，复制后体检按目标档案口径重新审视）。
  // 「取消」由上层确认弹窗承担——不调用本函数就是零写入
  async function copyClipToProfile(name, fromPid, toPid) {
    if (!name || typeof name !== 'string') throw new Error('动作名不能为空');
    if (fromPid === toPid) throw new Error('源档案和目标档案不能是同一套');
    await ensureClips();
    var lp = await loadProfiles();
    var dst = null, srcName = null;
    lp.list.forEach(function (p) {
      if (p.id === fromPid) srcName = p.name || fromPid;
      if (p.id === toPid) dst = p;
    });
    if (dst === null || srcName === null) throw new Error('源档案或目标档案不存在');
    var stamp = dst.skeleton ? (dst.skeletonHash || '') : '';
    return tx(['profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        t.onabort = function () { err(t.error || new Error('资料库事务被中止，本次复制没有保存')); };
        var gm = t.objectStore('profileClips').get([fromPid, name]);
        gm.onerror = function () { err(gm.error || new Error('复制读取失败')); };
        gm.onsuccess = function () {
          if (!gm.result) {
            err(new Error('档案「' + srcName + '」里没有动作「' + name + '」'));
            try { t.abort(); } catch (e2) {}
            return;
          }
          var gd = t.objectStore('profileClipData').get([fromPid, name]);
          gd.onerror = function () { err(gd.error || new Error('复制读取失败')); };
          gd.onsuccess = function () {
            if (!gd.result) {
              err(new Error('动作「' + name + '」的数据缺失，复制中止'));
              try { t.abort(); } catch (e2) {}
              return;
            }
            var m = gm.result;
            try {
              t.objectStore('profileClips').put({
                profileId: toPid, name: name, type: m.type, duration: m.duration, hash: m.hash,
                skeletonHash: stamp, enc: m.enc, sizeRaw: m.sizeRaw, sizeEnc: m.sizeEnc, updatedAt: Date.now()
              });
              t.objectStore('profileClipData').put({ profileId: toPid, name: name, data: gd.result.data });
            } catch (e) { try { t.abort(); } catch (e2) {} return; }
            t.oncomplete = function () { ok(true); };
          };
        };
      });
    });
  }

  function hasClips(names, pid) {
    return clipIndex(pid).then(function (idx) {
      var set = {};
      idx.forEach(function (c) { set[c.name] = true; });
      return names.map(function (n) { return !!set[n]; });
    });
  }

  // ============ 资料档 / 统计 ============

  function stats() {
    return ensureClips().then(function () {
      return Promise.all([
        allClipIndex(),
        getActiveProfile(),
        getOne('meta', 'catalog'),
        listProfiles()
      ]);
    }).then(async function (r) {
      var byProfile = r[0], p = r[1], cat = r[2], profs = r[3] || [];
      var idx = p ? (byProfile[p.id] || []) : [], pend = byProfile[PENDING_PID] || [];
      var sizeEnc = 0, sizeRaw = 0;
      idx.forEach(function (c) { sizeEnc += c.sizeEnc || 0; sizeRaw += c.sizeRaw || 0; });
      var modelSize = 0, modelNames = [];
      if (p) profs.forEach(function (x) { if (x.id === p.id) { modelSize = x.modelSize; modelNames = x.modelNames; } });
      return {
        idbAvailable: available(),
        gzip: canGzip(),
        clips: idx.length,
        pendingClips: pend.length,
        sizeEnc: sizeEnc, sizeRaw: sizeRaw,
        skeleton: !!(p && p.skeleton), skeletonHash: p ? (p.skeletonHash || '') : '', boneCount: p ? (p.boneCount || 0) : 0,
        catalog: !!cat,
        modelFiles: modelNames,
        modelSize: modelSize,
        profileCount: profs.length,
        profiles: profs.map(function (x) {
          return { id: x.id, name: x.name, skeletonHash: x.skeletonHash || '', boneCount: x.boneCount, hasSkeleton: x.hasSkeleton, sourceSkeletonCode: x.sourceSkeletonCode || '', modelNames: x.modelNames, modelSize: x.modelSize, isActive: x.isActive, clips: byProfile[x.id] || [] };
        }),
        profile: p ? {
          id: p.id, name: p.name, skeletonHash: p.skeletonHash || '',
          sourceSkeletonCode: p.sourceSkeletonCode || '',
          boneCount: p.boneCount || 0, createdAt: p.createdAt, updatedAt: p.updatedAt
        } : null
      };
    });
  }

  function clear() {
    return tx(['meta', 'clips', 'clipdata', 'files', 'profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      var stores = ['meta', 'clips', 'clipdata', 'files', 'profileClips', 'profileClipData'];
      var ps = stores.map(function (s) { return reqDone(t.objectStore(s).clear()); });
      return Promise.all(ps);
    });
  }

  // ============ 备份：导出 / 导入 ============

  function u32le(v) {
    return new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  }

  // 导出整个资料库（全部角色档案 + 目录 + 全部动作 + 模型文件）成一个 CHLB 文件。
  // 骨架/目录是十几~几百 KB 的小东西直接内嵌原文，让备份自包含（能搬到别的电脑）；
  // 动作和模型全程只搬运 Blob 引用，不把上百 MB 读进内存。
  // v2（FIX-D/AUD2-009）：每条动作带 profileId/skeletonHash（逐动作归属），每个模型文件
  // 带内容 hash；待归档动作也导出（profileId='__pending__'，导入后仍是待归档）。
  // 兼容：header.skeleton 仍写"活动档案"的骨架（老版本程序导入新备份能拿到主骨架），
  // header.profiles 是档案完整清单
  async function exportBundle(onProgress) {
    await ensureClips();
    var lp = await loadProfiles();
    var active = null;
    lp.list.forEach(function (p) { if (p.id === lp.activeId) active = p; });
    return Promise.all([
      getOne('meta', 'catalog'),
      tx(['profileClips'], 'readonly').then(function (t) { return reqDone(t.objectStore('profileClips').getAll()); }),
      tx(['profileClipData'], 'readonly').then(function (t) { return reqDone(t.objectStore('profileClipData').getAll()); }),
      tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); })
    ]).then(function (r) {
      var catRec = r[0], clipRows = r[1] || [], dataRows = r[2] || [], fileRows = r[3] || [];
      var dataByKey = {};
      dataRows.forEach(function (d) { dataByKey[d.profileId + '\u0000' + d.name] = d.data; });
      // P4：files 仓的内容寻址载荷行（mblob:*）不重复导出——按档案 pfile 引用行展开成
      // 实际字节（引用行 → 载荷行 data；旧内联行自带 data），备份保持自包含、形状不变
      var payByHash = {};
      fileRows.forEach(function (f) { if (String(f.name).indexOf('mblob:') === 0) payByHash[String(f.name).slice(6)] = f; });
      var parts = [];   // [{kind:'skel'|'pskel'|'catalog'|'clip'|'file', name, blob, meta}]
      if (active && active.skeleton) parts.push({ kind: 'skel', name: 'skeleton.json', blob: new Blob([canonBytes(active.skeleton)]), meta: { hash: active.skeletonHash, boneCount: active.boneCount } });
      lp.list.forEach(function (p) {
        if (p.skeleton) parts.push({ kind: 'pskel', name: 'profile-' + p.id + '.json', blob: new Blob([canonBytes(p.skeleton)]), meta: { pid: p.id, pname: p.name, hash: p.skeletonHash, boneCount: p.boneCount } });
      });
      if (catRec) parts.push({ kind: 'catalog', name: 'catalog.json', blob: new Blob([canonBytes(catRec.data)]), meta: catRec });
      clipRows.forEach(function (m) {
        var data = dataByKey[m.profileId + '\u0000' + m.name];
        if (data) parts.push({ kind: 'clip', name: m.name, blob: data, meta: m });
      });
      fileRows.forEach(function (f) {
        if (String(f.name).indexOf('mblob:') === 0) return;
        var data = f.ref ? (payByHash[f.ref] ? payByHash[f.ref].data : null) : (f.data || null);
        if (data) parts.push({ kind: 'file', name: f.name, blob: data, meta: f });
      });

      // 头部偏移要用「补空格对齐 64 字节」的固定长度算，保证一遍就稳定
      var headerLen = 64, header, i;
      for (i = 0; i < 8; i++) {
        header = buildHeader(parts, headerLen);
        var need = new TextEncoder().encode(JSON.stringify(header)).length;
        if (need <= headerLen) break;
        headerLen = Math.ceil((need + 1) / 64) * 64;
      }
      var headerBytes = new TextEncoder().encode(JSON.stringify(header));
      var pad = new Uint8Array(headerLen - headerBytes.length);
      for (i = 0; i < pad.length; i++) pad[i] = 0x20;
      var head = new Uint8Array(12);
      head.set(BUNDLE_MAGIC, 0);
      head.set(u32le(BUNDLE_VERSION), 4);
      head.set(u32le(headerLen), 8);

      var blobParts = [head, headerBytes, pad];
      parts.forEach(function (p) { blobParts.push(p.blob); });
      if (onProgress) onProgress({ phase: 'done', clips: parts.filter(function (p) { return p.kind === 'clip'; }).length });
      return new Blob(blobParts, { type: 'application/octet-stream' });
    });
  }

  function buildHeader(parts, headerLen) {
    var off = 12 + headerLen;
    var skelEntry = null, catEntry = null, clipEntries = [], fileEntries = [], profEntries = [];
    parts.forEach(function (p) {
      var entry = { name: p.name, offset: off, len: p.blob.size };
      if (p.kind === 'clip') {
        entry.profileId = p.meta.profileId;             // v2：逐动作归属
        entry.skeletonHash = p.meta.skeletonHash || ''; // v2：录制时的骨架指纹
        entry.enc = p.meta.enc; entry.hash = p.meta.hash; entry.sizeRaw = p.meta.sizeRaw;
        entry.type = p.meta.type; entry.duration = p.meta.duration; entry.updatedAt = p.meta.updatedAt;
        clipEntries.push(entry);
      } else if (p.kind === 'file') {
        entry.profileId = String(p.meta.name).match(/^pfile:([^:]+):/) ? String(p.meta.name).split(':')[1] : '';
        entry.mime = p.meta.mime; entry.hash = p.meta.hash || ''; entry.updatedAt = p.meta.updatedAt; // v2：文件内容 hash
        fileEntries.push(entry);
      } else if (p.kind === 'skel') {
        entry.hash = p.meta.hash || ''; entry.boneCount = p.meta.boneCount || 0;
        skelEntry = entry;
      } else if (p.kind === 'pskel') {
        entry.hash = p.meta.hash || ''; entry.boneCount = p.meta.boneCount || 0;
        profEntries.push({ id: p.meta.pid, name: p.meta.pname, skeletonHash: p.meta.hash || '', boneCount: p.meta.boneCount || 0, skeleton: entry });
      } else if (p.kind === 'catalog') {
        catEntry = entry;
      }
      off += p.blob.size;
    });
    var h = {
      formatVersion: BUNDLE_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: Date.now(),
      clips: clipEntries, files: fileEntries
    };
    if (skelEntry) { h.skeleton = { hash: skelEntry.hash, boneCount: skelEntry.boneCount, offset: skelEntry.offset, len: skelEntry.len }; }
    if (catEntry) { h.catalog = { offset: catEntry.offset, len: catEntry.len }; }
    if (profEntries.length) {
      h.profiles = profEntries.map(function (p) {
        return { id: p.id, name: p.name, skeletonHash: p.skeletonHash, boneCount: p.boneCount, skeleton: { offset: p.skeleton.offset, len: p.skeleton.len } };
      });
    }
    return h;
  }

  // AUD-004：备份里的一条动作写入前过三关——解压、JSON 结构（必须有 bones）、SHA-256 与头内 hash 比对。
  // 头里没 hash（老备份）就用现算的，照样写；hash 对不上直接抛错，那条不进库
  function verifyClipBlob(blob, e) {
    return gunzipToText(blob, e.enc).then(function (txt) {
      var clip;
      try { clip = JSON.parse(txt); } catch (err) { throw new Error('动作数据损坏（解压后不是有效 JSON）'); }
      if (!clip || !clip.bones) throw new Error('动作数据缺 bones 字段（结构不对）');
      var u8 = canonBytes(clip);
      return sha256Hex(u8).then(function (h) {
        if (e.hash && h !== e.hash) throw new Error('哈希校验不符（内容与备份清单对不上，文件可能损坏）');
        return { hash: e.hash || h, sizeRaw: e.sizeRaw || u8.length };
      });
    });
  }

  // v2 preflight：全包数据在写库前全部验证——每条动作解压+结构+hash、每个模型文件 hash、
  // 每套档案骨架原文与头内指纹一致、gltf 引用的外部 bin 必须同档案自带。
  // 任何一项不过就抛错：整个导入拒绝，现有资料库一个字节都不动
  async function preflightV2(file, header) {
    for (var pi = 0; pi < (header.profiles || []).length; pi++) {
      var bp = header.profiles[pi];
      if (!bp.skeleton || bp.skeleton.offset === undefined) continue;
      var txt = await file.slice(bp.skeleton.offset, bp.skeleton.offset + bp.skeleton.len).text();
      var skel;
      try { skel = JSON.parse(txt); } catch (e) { throw new Error('档案「' + (bp.name || bp.id) + '」的骨架数据损坏'); }
      var h = await hashObject(skel);
      // LIB-2：老版本程序导出的备份头里可能没录档案指纹（空）——没有可比对的指纹就按原文放行
      // （导入时会按内容算出真指纹建档），只有"录了指纹且对不上"才算篡改
      if (bp.skeletonHash && h !== bp.skeletonHash) throw new Error('档案「' + (bp.name || bp.id) + '」的骨架指纹与内容对不上（备份可能被篡改）');
    }
    for (var ci = 0; ci < (header.clips || []).length; ci++) {
      var e = header.clips[ci];
      try {
        await verifyClipBlob(file.slice(e.offset, e.offset + e.len), e);
      } catch (err) {
        throw new Error('动作「' + e.name + '」' + ((err && err.message) || '校验失败'));
      }
    }
    var filesByPid = {};
    (header.files || []).forEach(function (f) {
      var m = String(f.name).match(/^pfile:([^:]+):(.+)$/);
      var pid = (f.profileId || (m && m[1]) || '_bare_');
      var fn = m ? m[2] : f.name;
      (filesByPid[pid] = filesByPid[pid] || []).push({ entry: f, fname: fn });
    });
    for (var pid in filesByPid) {
      var group = filesByPid[pid];
      for (var i = 0; i < group.length; i++) {
        var g = group[i];
        if (g.entry.hash) {
          var buf = new Uint8Array(await file.slice(g.entry.offset, g.entry.offset + g.entry.len).arrayBuffer());
          var fh = await sha256Hex(buf);
          if (!fh || fh !== g.entry.hash) throw new Error('模型文件「' + g.fname + '」内容与备份清单对不上（文件可能损坏）');
        }
      }
      // gltf 引用的外部 buffer 必须能在同一档案内解析（典型：model.gltf ↔ model.bin 成套）
      var names = {};
      group.forEach(function (g2) { names[g2.fname] = true; });
      for (var j = 0; j < group.length; j++) {
        var gj = group[j];
        if (!/\.gltf$/i.test(gj.fname)) continue;
        var jtxt;
        try { jtxt = await file.slice(gj.entry.offset, gj.entry.offset + gj.entry.len).text(); } catch (e3) { continue; }
        var doc;
        try { doc = JSON.parse(jtxt); } catch (e4) { throw new Error('模型文件「' + gj.fname + '」不是有效 glTF'); }
        (doc && doc.buffers || []).forEach(function (b) {
          var uri = (b && b.uri) || '';
          if (!uri || uri.indexOf('data:') === 0) return;
          var base = String(uri).split('/').pop().split('?')[0];
          if (!names[base]) throw new Error('档案内「' + gj.fname + '」引用的外部文件「' + base + '」不在备份里（模型不成套）');
        });
      }
    }
    // LIB-3：目录段也要在写库前解析+形状检查——旧代码里坏目录会拖到"档案/动作都写完了"
    // 才在导入链里炸出来，且错误被当成动作/导入失败报出去。这里先验，不过就整体拒绝
    if (header.catalog && header.catalog.offset !== undefined) {
      var catTxt = await file.slice(header.catalog.offset, header.catalog.offset + header.catalog.len).text();
      var cat;
      try { cat = JSON.parse(catTxt); } catch (e) { throw new Error('目录数据损坏（备份里的目录段不是有效 JSON）'); }
      if (!cat || typeof cat !== 'object' || Array.isArray(cat) || !Array.isArray(cat.emotes)) {
        throw new Error('目录数据结构不对（缺 emotes 表情清单）');
      }
    }
  }

  // 导入备份：先验魔数/版本/长度/数据段越界（v2 再做全包 preflight），全部合格才开始写；
  // 校验过程汇报进度，随后单事务提交。拒绝/取消/中止时现有资料库原样不动。
  // 档案口径（FIX-D/AUD2-009）：
  //   v2 —— 每条动作按头内 profileId 对号（备份档案→本机档案映射）；
  //         复用需原身份且无内容冲突，或唯一完整资产匹配；未知动作归属进入待归档
  //   v1 —— 只读兼容：备份里只有一套档案 → 动作归入它；多套 → 动作进待归档（绝不统一盖某副骨架）
  async function importBundle(file, opts) {
    opts = opts || {};
    if (!file) return Promise.reject(new Error('没有选择备份文件'));
    var header = await file.slice(0, 12).arrayBuffer().then(function (headBuf) {
      var head = new Uint8Array(headBuf);
      if (head.length < 12 || head[0] !== 0x43 || head[1] !== 0x48 || head[2] !== 0x4C || head[3] !== 0x42) {
        throw new Error('这不是编舞资料库备份文件（文件头不对）');
      }
      var dv = new DataView(headBuf);
      var ver = dv.getUint32(4, true);
      if (ver !== 1 && ver !== BUNDLE_VERSION) throw new Error('备份格式版本不支持（文件 v' + ver + '，本程序支持 v1/' + BUNDLE_VERSION + '）');
      var headerLen = dv.getUint32(8, true);
      if (headerLen <= 0 || 12 + headerLen > file.size) throw new Error('备份文件不完整（头部长度对不上）');
      return file.slice(12, 12 + headerLen).text().then(function (t) { return { h: JSON.parse(t), ver: ver }; });
    }).then(function (parsed) {
      var h = parsed.h;
      if (!h || typeof h !== 'object') throw new Error('备份头部读不出来（文件可能损坏）');
      // 每段数据的落点都要在文件范围内
      var entries = (h.clips || []).concat(h.files || []);
      if (h.skeleton && h.skeleton.offset !== undefined) entries.push({ name: 'skeleton.json', offset: h.skeleton.offset, len: h.skeleton.len });
      if (h.catalog && h.catalog.offset !== undefined) entries.push({ name: 'catalog.json', offset: h.catalog.offset, len: h.catalog.len });
      (h.profiles || []).forEach(function (p) {
        if (p.skeleton && p.skeleton.offset !== undefined) entries.push({ name: 'profile-' + p.id + '.json', offset: p.skeleton.offset, len: p.skeleton.len });
      });
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!Number.isSafeInteger(e.offset) || !Number.isSafeInteger(e.len) || e.offset < 0 || e.len < 0 || e.offset + e.len > file.size) {
          throw new Error('备份文件不完整（「' + e.name + '」的数据段越界）');
        }
      }
      h.__bundleVersion = parsed.ver;
      return h;
    });

    // v2：全包 preflight（先验后写，坏包零写入）
    if (header.__bundleVersion >= 2) await preflightV2(file, header);

    // 全部解析和校验完成后才进入一个事务；任何中止/取消都不留下半套资料。
    var started = Date.now(), prepared = [], clips = [], files = [], catalog = null;
    var report = { clips: 0, files: 0, profiles: 0, pending: 0, failed: [], elapsedMs: 0, profileMap: {} };
    function cancelled() { if (opts.shouldCancel && opts.shouldCancel()) throw new Error('已取消导入（没有写入任何数据）'); }
    function progress() { cancelled(); if (opts.onProgress) opts.onProgress({ phase: 'validate', done: clips.length + files.length, total: (header.clips || []).length + (header.files || []).length }); cancelled(); }
    cancelled();
    var sourceProfiles = header.profiles || [];
    if (!sourceProfiles.length && header.skeleton) sourceProfiles = [{ id: '', name: '导入角色', skeleton: header.skeleton, skeletonHash: header.skeleton.hash }];
    var seenProfiles = Object.create(null);
    for (var pi = 0; pi < sourceProfiles.length; pi++) {
      var bp = sourceProfiles[pi];
      if (!bp.skeleton) continue;
      if (seenProfiles[bp.id || '']) throw new Error('备份档案身份重复');
      seenProfiles[bp.id || ''] = true;
      var skel = JSON.parse(await file.slice(bp.skeleton.offset, bp.skeleton.offset + bp.skeleton.len).text());
      var sh = await hashObject(skel);
      if (bp.skeletonHash && bp.skeletonHash !== sh) throw new Error('备份骨架指纹与内容不符');
      prepared.push({ sourceId: bp.id || '', name: bp.name || '导入角色', skeleton: skel, skeletonHash: sh });
    }
    var seenClips = Object.create(null), seenFiles = Object.create(null);
    for (var ci = 0; ci < (header.clips || []).length; ci++) {
      var ce = header.clips[ci], ck = (ce.profileId || '') + '\u0000' + ce.name;
      if (typeof ce.name !== 'string' || !ce.name || seenClips[ck]) throw new Error('备份动作名字缺失或重复');
      seenClips[ck] = true;
      var cb = file.slice(ce.offset, ce.offset + ce.len);
      try { var cv = await verifyClipBlob(cb, ce); clips.push({ entry: ce, blob: cb, hash: cv.hash, sizeRaw: cv.sizeRaw }); }
      catch (e) { if (header.__bundleVersion >= 2) throw e; report.failed.push({ name: ce.name, reason: e.message }); }
      progress();
    }
    // 老 v1 仍返回逐条错误，但一条失败就整包零写入。
    if (report.failed.length) return report;
    for (var fi = 0; fi < (header.files || []).length; fi++) {
      var fe = header.files[fi], match = /^pfile:([^:]+):(.+)$/.exec(fe.name);
      var sourceId = fe.profileId || (match && match[1]) || (prepared[0] && prepared[0].sourceId) || '';
      var fn = match ? match[2] : fe.name, fk = sourceId + '\u0000' + fn;
      if (typeof fn !== 'string' || !fn || seenFiles[fk] || (match && fe.profileId && match[1] !== fe.profileId)) throw new Error('备份模型名字或档案归属不合法');
      seenFiles[fk] = true;
      var fb = file.slice(fe.offset, fe.offset + fe.len), fh = await sha256Hex(new Uint8Array(await fb.arrayBuffer()));
      if (fe.hash && fe.hash !== fh) throw new Error('模型文件「' + fn + '」校验失败');
      if (!prepared.some(function (p) { return p.sourceId === sourceId; })) throw new Error('模型文件「' + fn + '」缺少所属骨架档案');
      files.push({ sourceId: sourceId, name: fn, blob: fb, hash: fh, mime: fe.mime }); progress();
    }
    if (header.catalog) {
      catalog = JSON.parse(await file.slice(header.catalog.offset, header.catalog.offset + header.catalog.len).text());
      if (!catalog || !Array.isArray(catalog.emotes)) throw new Error('目录数据结构不对（缺 emotes 表情清单）');
    }
    cancelled();
    return tx(['meta', 'files', 'profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      return new Promise(function (resolve, reject) {
        var failure;
        t.onabort = function () { reject(failure || t.error || new Error('资料库事务被中止，本次恢复没有保存')); };
        var mr = t.objectStore('meta').getAll(), fr = t.objectStore('files').getAll(), cr = t.objectStore('profileClips').getAll();
        cr.onsuccess = function () {
          try {
            cancelled();
            var meta = mr.result || [], oldFiles = fr.result || [], oldClips = cr.result || [];
            var existing = meta.filter(function (r) { return String(r.id).indexOf('profile:') === 0; }).map(function (r) { return r.data; });
            var ids = Object.create(null), mapped = Object.create(null), now = Date.now();
            existing.forEach(function (p) { ids[p.id] = true; });
            function clipSource(c) {
              if (header.__bundleVersion < 2) return sourceProfiles.length === 1 ? prepared[0].sourceId : null;
              return c.entry.profileId === PENDING_PID ? null : c.entry.profileId;
            }
            prepared.forEach(function (p) {
              var pf = files.filter(function (f) { return f.sourceId === p.sourceId; });
              var pc = clips.filter(function (c) { return clipSource(c) === p.sourceId; });
              function sameAssets(q) {
                if (q.skeletonHash !== p.skeletonHash) return false;
                var qf = oldFiles.filter(function (f) { return String(f.name).indexOf('pfile:' + q.id + ':') === 0; });
                var qc = oldClips.filter(function (c) { return c.profileId === q.id; });
                return qf.length === pf.length && qc.length === pc.length && pf.every(function (f) { return qf.some(function (x) { return x.name === pfileKey(q.id, f.name) && x.hash === f.hash; }); }) && pc.every(function (c) { return qc.some(function (x) { return x.name === c.entry.name && x.hash === c.hash && x.skeletonHash === (c.entry.skeletonHash || p.skeletonHash); }); });
              }
              var hit = existing.find(function (q) { return p.sourceId && q.id === p.sourceId; });
              if (hit) {
                // 原 id 可补缺件，已有同键字节不同则整包拒绝，绝不覆盖另一个人的资产。
                if (hit.skeletonHash !== p.skeletonHash || pf.some(function (f) { return oldFiles.some(function (x) { return x.name === pfileKey(hit.id,f.name) && x.hash !== f.hash; }); }) || pc.some(function (c) { return oldClips.some(function (x) { return x.profileId === hit.id && x.name === c.entry.name && (x.hash !== c.hash || x.skeletonHash !== (c.entry.skeletonHash || p.skeletonHash)); }); })) throw new Error('档案身份冲突：本机同一标识的资产不同；请使用角色包导入为新档案并明确重新关联');
              } else {
                var matches = existing.filter(sameAssets);
                if (matches.length === 1) hit = matches[0];
              }
              var pid = hit ? hit.id : p.sourceId;
              if (!hit && (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pid) || ids[pid] || pid === PENDING_PID)) { do { pid = newPid(); } while (ids[pid]); }
              ids[pid] = true; mapped[p.sourceId] = pid; report.profileMap[p.sourceId] = pid;
              p.targetId = pid;
              if (!hit) report.profiles++;
              var modelNames = hit ? (hit.modelNames || []).slice() : [];
              pf.forEach(function (f) { if (modelNames.indexOf(f.name) < 0) modelNames.push(f.name); });
              if (!hit || !hit.skeleton || modelNames.length !== (hit.modelNames || []).length) t.objectStore('meta').put({ id: profKey(pid), data: Object.assign({}, hit || {}, { id: pid, name: hit ? hit.name : p.name, createdAt: hit ? hit.createdAt : now, updatedAt: now, skeletonHash: p.skeletonHash, boneCount: p.skeleton.count || 0, skeleton: p.skeleton, modelNames: modelNames }) });
            });
            clips.forEach(function (c) {
              var ce = c.entry, pid = mapped[clipSource(c)] || PENDING_PID;
              // 未知归属不以骨架、名字或活动档案猜测；保留在待归档区。
              var prof = prepared.find(function (p) { return p.targetId === pid; });
              var stamp = pid === PENDING_PID ? '' : (ce.skeletonHash || prof.skeletonHash);
              var old = oldClips.find(function (x) { return x.profileId === pid && x.name === ce.name; });
              if (old && (old.hash !== c.hash || old.skeletonHash !== stamp)) throw new Error('动作「' + ce.name + '」与本机同名资产不同，恢复已取消');
              if (!old) {
                t.objectStore('profileClips').put({ profileId: pid, name: ce.name, type: ce.type || 'once', duration: ce.duration || 0, hash: c.hash, skeletonHash: stamp, enc: ce.enc, sizeRaw: c.sizeRaw, sizeEnc: c.blob.size, updatedAt: ce.updatedAt || now });
                t.objectStore('profileClipData').put({ profileId: pid, name: ce.name, data: c.blob });
              }
              report.clips++; if (pid === PENDING_PID) report.pending++;
            });
            files.forEach(function (f) {
              var key = pfileKey(mapped[f.sourceId], f.name);
              if (!oldFiles.some(function (x) { return x.name === key; })) {
                if (!oldFiles.some(function (x) { return x.name === mblobKey(f.hash); })) t.objectStore('files').put({ name: mblobKey(f.hash), data: f.blob, hash: f.hash, updatedAt: now });
                t.objectStore('files').put({ name: key, ref: f.hash, hash: f.hash, mime: f.mime || 'application/octet-stream', size: f.blob.size, updatedAt: now });
              }
              report.files++;
            });
            if (catalog && !meta.some(function (r) { return r.id === 'catalog'; })) t.objectStore('meta').put({ id: 'catalog', data: catalog, updatedAt: now });
            if (!meta.some(function (r) { return r.id === 'activeProfile' && r.pid; }) && prepared.length) t.objectStore('meta').put({ id: 'activeProfile', pid: prepared[0].targetId });
            cancelled();
          } catch (e) { failure = e; try { t.abort(); } catch (alreadyAborted) {} }
        };
        t.oncomplete = function () { report.elapsedMs = Date.now() - started; resolve(report); };
      });
    });
  }

  // ============ .choreochar 角色分享包（CHARACTER-ASSETS-P5，DESIGN §3/§11） ============
  // 信封与 CHLB v2 同款套路：12 字节头（魔数 "CHRC" + u32 格式版本 + u32 头部长度）、
  // 补空格对齐 64 字节的头部 JSON、然后依次是骨架 JSON / 模型文件原始字节 / gzip 动作数据。
  // 头部里：一个档案身份块（名字 + skeletonHash/boneCount + 骨架段 offset/len）、
  // 模型文件清单（裸文件名 + mime + SHA-256 + offset/len）、动作清单（名字/类型/时长/
  // hash/enc/sizeRaw/sizeEnc + offset/len）——随包的「目录切片」就是这份动作元数据本身。

  // 导出一个档案的 .choreochar（只读一次性打包）：恰好一套档案的骨架原文、该档案的
  // 模型文件字节（引用行→载荷行展开，包自包含）、该档案命名空间的全部动作（元数据+
  // gzip 数据）。构造上排除（设计 §11）：其他档案的行、待归档动作（__pending__）、
  // 全局动作目录、工程/歌词/音频、配对/会话/凭据、绝对路径、本机配置。
  // 三类拒绝（中文原因、零写入）：未知 pid、「待归档」虚拟档案、没有骨架的档案
  async function createSharePackage(pid) {
    if (!pid || typeof pid !== 'string') throw new Error('没有指定要导出的角色档案');
    if (pid === PENDING_PID) throw new Error('「待归档」不是角色档案，不能导出角色包');
    await ensureClips();
    var lp = await loadProfiles();
    var prof = null;
    lp.list.forEach(function (p) { if (p.id === pid) prof = p; });
    if (!prof) throw new Error('档案不存在：' + pid);
    if (!prof.skeleton || !prof.skeletonHash) throw new Error('档案「' + (prof.name || pid) + '」没有骨架，不能导出角色包');
    var clipMetas = ((await allClipIndex())[pid]) || [];
    var dataRows = await tx(['profileClipData'], 'readonly').then(function (t) { return reqDone(t.objectStore('profileClipData').getAll()); });
    var dataByName = {};
    (dataRows || []).forEach(function (d) { if (d && d.profileId === pid) dataByName[d.name] = d.data; });
    var fileRows = await tx(['files'], 'readonly').then(function (t) { return reqDone(t.objectStore('files').getAll()); });
    var payByHash = {};
    (fileRows || []).forEach(function (f) { if (String(f.name).indexOf('mblob:') === 0) payByHash[String(f.name).slice(6)] = f; });
    var prefix = 'pfile:' + pid + ':';
    var fileParts = [];
    (fileRows || []).forEach(function (f) {
      var n = String(f.name);
      if (n.indexOf(prefix) !== 0) return; // 只带这套档案的模型文件（mblob 载荷行/别家引用行不带）
      var data = f.ref ? (payByHash[f.ref] ? payByHash[f.ref].data : null) : (f.data || null);
      if (!data) return; // 引用在、字节丢（理论不该发生）：如实少这一件，不凭空造
      fileParts.push({ name: n.slice(prefix.length), mime: f.mime || 'application/octet-stream', hash: f.hash || '', blob: data });
    });
    var clipParts = [];
    clipMetas.forEach(function (m) {
      if (m.skeletonHash && m.skeletonHash !== prof.skeletonHash) throw new Error('动作「' + m.name + '」骨架不兼容，不能导出后改盖人物指纹');
      var data = dataByName[m.name];
      if (!data) return; // 半条动作（理论被 repairOrphans 清过）：如实少这条
      clipParts.push({
        name: m.name, type: m.type, duration: m.duration, hash: m.hash, enc: m.enc,
        sizeRaw: m.sizeRaw, sizeEnc: m.sizeEnc, updatedAt: m.updatedAt, blob: data
      });
    });
    var skelBlob = new Blob([canonBytes(prof.skeleton)]);
    // 头部偏移与 CHLB 同款两轮定长（补空格对齐 64 字节，一遍算稳）
    var headerLen = 64, header, i;
    for (i = 0; i < 8; i++) {
      header = buildShareHeader(prof, skelBlob, fileParts, clipParts, headerLen);
      var need = new TextEncoder().encode(JSON.stringify(header)).length;
      if (need <= headerLen) break;
      headerLen = Math.ceil((need + 1) / 64) * 64;
    }
    var headerBytes = new TextEncoder().encode(JSON.stringify(header));
    var pad = new Uint8Array(headerLen - headerBytes.length);
    for (i = 0; i < pad.length; i++) pad[i] = 0x20;
    var headU8 = new Uint8Array(12);
    headU8.set(SHARE_MAGIC, 0);
    headU8.set(u32le(SHARE_VERSION), 4);
    headU8.set(u32le(headerLen), 8);
    var blobParts = [headU8, headerBytes, pad, skelBlob];
    fileParts.forEach(function (p) { blobParts.push(p.blob); });
    clipParts.forEach(function (p) { blobParts.push(p.blob); });
    return new Blob(blobParts, { type: 'application/octet-stream' });
  }

  function buildShareHeader(prof, skelBlob, fileParts, clipParts, headerLen) {
    var off = 12 + headerLen;
    var skelEntry = { offset: off, len: skelBlob.size };
    off += skelBlob.size;
    var files = fileParts.map(function (p) {
      var e = { name: p.name, mime: p.mime, hash: p.hash, offset: off, len: p.blob.size };
      off += p.blob.size;
      return e;
    });
    var clips = clipParts.map(function (p) {
      var e = {
        name: p.name, type: p.type || 'once', duration: p.duration || 0, hash: p.hash || '',
        enc: p.enc, sizeRaw: p.sizeRaw || 0, sizeEnc: p.sizeEnc || 0, updatedAt: p.updatedAt || Date.now(),
        offset: off, len: p.blob.size
      };
      off += p.blob.size;
      return e;
    });
    return {
      formatVersion: SHARE_VERSION, createdAt: Date.now(),
      profile: {
        name: (prof.name || '角色') + '', skeletonHash: prof.skeletonHash,
        boneCount: prof.boneCount || 0, skeleton: skelEntry
      },
      files: files, clips: clips
    };
  }

  // 导入 .choreochar：先全包校验、后单事务收养（验证前零写入——设计 §3「validate
  // before adopt」）。校验每类独立中文原因：魔数/版本/头部、数据段越界、档案身份块
  // 缺失、动作/模型缺名或非字符串名、动作/模型重名、骨架指纹与内容不符、模型文件
  // hash 不符、零字节模型段、gltf 引用的外部 buffer 不在包内、动作解压后非 JSON/
  // 缺 bones/hash 不符。收养规则（设计 §3）：永远新档案 id（绝不并进同指纹档案）、
  // 显示名撞名时本地改名（不动原档案）、活动档案指针不动、动作全部盖新档案指纹进
  // 其命名空间、模型字节走 P4 内容寻址复用（载荷行+引用行）。取消点在校验全过之后、
  // 动笔之前（取消=零写入）；写库是 meta/files/profileClips/profileClipData 一个事务，
  // 中止即整体回滚（无半套档案、无孤儿载荷、无 modelNames 裸条）。
  async function importSharePackage(file, opts) {
    opts = opts || {};
    if (!file) throw new Error('没有选择角色包文件');
    var headBuf = await file.slice(0, 12).arrayBuffer();
    var head = new Uint8Array(headBuf);
    if (head.length < 12 || head[0] !== SHARE_MAGIC[0] || head[1] !== SHARE_MAGIC[1] ||
        head[2] !== SHARE_MAGIC[2] || head[3] !== SHARE_MAGIC[3]) {
      if (head.length >= 4 && head[0] === BUNDLE_MAGIC[0] && head[1] === BUNDLE_MAGIC[1] &&
          head[2] === BUNDLE_MAGIC[2] && head[3] === BUNDLE_MAGIC[3]) {
        throw new Error('这是资料库备份文件（.choreolib），不是角色分享包——请用「导入备份」入口');
      }
      throw new Error('这不是角色分享包（.choreochar）文件（文件头不对）');
    }
    var dv = new DataView(headBuf);
    var ver = dv.getUint32(4, true);
    if (ver !== SHARE_VERSION) throw new Error('角色包格式版本不支持（文件 v' + ver + '，本程序支持 v' + SHARE_VERSION + '）');
    var headerLen = dv.getUint32(8, true);
    if (headerLen <= 0 || 12 + headerLen > file.size) throw new Error('角色包文件不完整（头部长度对不上）');
    var header;
    try { header = JSON.parse(await file.slice(12, 12 + headerLen).text()); }
    catch (e) { throw new Error('角色包头部读不出来（文件可能损坏）'); }
    if (!header || typeof header !== 'object') throw new Error('角色包头部读不出来（文件可能损坏）');
    var hp = header.profile;
    if (!hp || typeof hp !== 'object' || !hp.name || typeof hp.name !== 'string' ||
        !hp.skeletonHash || typeof hp.skeletonHash !== 'string' || !hp.skeleton || typeof hp.skeleton !== 'object') {
      throw new Error('角色包缺少档案身份信息（名字或骨架指纹不完整）');
    }
    var fileEntries = header.files, clipEntries = header.clips;
    if (!Array.isArray(fileEntries) || !Array.isArray(clipEntries)) throw new Error('角色包清单不完整（模型/动作清单缺失）');
    // 每段数据的落点都要在文件范围内（含骨架段）
    var entries = [{ name: 'skeleton.json', offset: hp.skeleton.offset, len: hp.skeleton.len }]
      .concat(fileEntries, clipEntries);
    for (var bi = 0; bi < entries.length; bi++) {
      var be = entries[bi];
      var bname = (be && be.name !== undefined) ? be.name : '清单第 ' + (bi + 1) + ' 段';
      if (!be || !Number.isSafeInteger(be.offset) || !Number.isSafeInteger(be.len) ||
          be.offset < 0 || be.len < 0 || be.offset + be.len > file.size) {
        throw new Error('角色包文件不完整（「' + bname + '」的数据段越界）');
      }
    }
    // 名字合法性与重名（一个包只收养一套档案，重名无处安放）
    var clipNames = {}, fileNames = {};
    clipEntries.forEach(function (c) {
      if (!c || !c.name || typeof c.name !== 'string') throw new Error('角色包里有动作缺少名字或名字不是文本（清单不合法）');
      if (!c.hash || typeof c.hash !== 'string') throw new Error('动作「' + c.name + '」缺内容指纹（清单不合法）');
      if (clipNames[c.name]) throw new Error('角色包里动作重名：「' + c.name + '」');
      clipNames[c.name] = true;
    });
    fileEntries.forEach(function (f) {
      if (!f || !f.name || typeof f.name !== 'string') throw new Error('角色包里有模型文件缺少名字或名字不是文本（清单不合法）');
      if (!f.len) throw new Error('模型文件「' + f.name + '」是空文件（0 字节），不能导入');
      if (!f.hash || typeof f.hash !== 'string') throw new Error('模型文件「' + f.name + '」缺内容指纹（清单不合法）');
      if (fileNames[f.name]) throw new Error('角色包里模型文件重名：「' + f.name + '」');
      fileNames[f.name] = true;
    });
    var total = clipEntries.length + fileEntries.length + 1;
    var done = 0;
    function tick() { done++; if (opts.onProgress) opts.onProgress({ phase: 'validate', done: done, total: total }); }
    tick();
    // 骨架段：解析 + 指纹与内容比对（防篡改：录了指纹就必须对上）
    var skelTxt = await file.slice(hp.skeleton.offset, hp.skeleton.offset + hp.skeleton.len).text();
    var skel;
    try { skel = JSON.parse(skelTxt); } catch (e) { throw new Error('档案「' + hp.name + '」的骨架数据损坏'); }
    var skelHash = await hashObject(skel);
    if (!skelHash || skelHash !== hp.skeletonHash) {
      throw new Error('档案「' + hp.name + '」的骨架指纹与内容对不上（角色包可能被篡改）');
    }
    // 模型文件：逐件 SHA-256 比对 + gltf 外部 buffer 基名成套检查（与 P2/CHLB preflight 同款规则）
    var pkgNames = {};
    fileEntries.forEach(function (f) { pkgNames[f.name] = true; });
    for (var fi = 0; fi < fileEntries.length; fi++) {
      var fe = fileEntries[fi];
      var fbuf = new Uint8Array(await file.slice(fe.offset, fe.offset + fe.len).arrayBuffer());
      var fh = await sha256Hex(fbuf);
      if (!fh || fh !== fe.hash) throw new Error('模型文件「' + fe.name + '」内容与角色包清单对不上（文件可能损坏）');
      if (/\.gltf$/i.test(fe.name)) {
        var doc;
        try { doc = JSON.parse(new TextDecoder().decode(fbuf)); } catch (e) { throw new Error('模型文件「' + fe.name + '」不是有效 glTF'); }
        (doc && doc.buffers || []).forEach(function (b) {
          var uri = (b && b.uri) || '';
          if (!uri || uri.indexOf('data:') === 0) return;
          var base = String(uri).split('/').pop().split('?')[0];
          if (!base || pkgNames[base]) return;
          throw new Error('角色包里「' + fe.name + '」引用的外部文件「' + base + '」不在包里（模型不成套）');
        });
      }
      tick();
    }
    // 动作：逐条解压验 JSON 结构 + 重算 SHA-256 与清单比对（复用 CHLB 的 verifyClipBlob）
    for (var ci = 0; ci < clipEntries.length; ci++) {
      var ce = clipEntries[ci];
      try { await verifyClipBlob(file.slice(ce.offset, ce.offset + ce.len), ce); }
      catch (err) { throw new Error('动作「' + ce.name + '」' + ((err && err.message) || '校验失败')); }
      tick();
    }
    // 取消点：校验全过后、动笔前（取消=零写入）
    if (opts.shouldCancel && opts.shouldCancel()) throw new Error('已取消导入（没有写入任何数据）');
    // 一事务收养：档案行 + 模型载荷/引用行 + 动作元数据/数据行，全成或全无
    return tx(['meta', 'files', 'profileClips', 'profileClipData'], 'readwrite').then(function (t) {
      return new Promise(function (ok, err) {
        t.onabort = function () { err(t.error || new Error('资料库事务被中止，本次导入没有保存')); };
        var gMeta = t.objectStore('meta').getAll();
        var gRows = t.objectStore('files').getAll();
        gMeta.onerror = function () { err(gMeta.error || new Error('资料库读取失败')); };
        gRows.onerror = function () { err(gRows.error || new Error('资料库读取失败')); };
        gRows.onsuccess = function () {
          if (opts.shouldCancel && opts.shouldCancel()) { t.abort(); return; }
          var ids = {}, names = {};
          (gMeta.result || []).forEach(function (r) {
            if (r && r.id && String(r.id).indexOf('profile:') === 0 && r.data) { ids[r.data.id] = true; names[r.data.name] = true; }
          });
          var payByHash = {};
          (gRows.result || []).forEach(function (r) { if (String(r.name).indexOf('mblob:') === 0) payByHash[String(r.name).slice(6)] = r; });
          var pid, name, now;
          try {
            pid = newPid();
            while (ids[pid] || pid === PENDING_PID) pid = newPid(); // 永远新 id：不复用、不并档
            name = hp.name;
            for (var n = 2; names[name]; n++) name = hp.name + '（' + n + '）'; // 撞名本地改名，原档案不动
            now = Date.now();
            fileEntries.forEach(function (fe) {
              if (!payByHash[fe.hash]) t.objectStore('files').put({ name: mblobKey(fe.hash), data: file.slice(fe.offset, fe.offset + fe.len), hash: fe.hash, updatedAt: now });
              t.objectStore('files').put({ name: pfileKey(pid, fe.name), ref: fe.hash, hash: fe.hash, mime: fe.mime || 'application/octet-stream', size: fe.len, updatedAt: now });
            });
            clipEntries.forEach(function (ce) {
              t.objectStore('profileClips').put({
                profileId: pid, name: ce.name, type: ce.type || 'once', duration: ce.duration || 0,
                hash: ce.hash, skeletonHash: skelHash, enc: ce.enc, sizeRaw: ce.sizeRaw || 0, sizeEnc: ce.len, updatedAt: ce.updatedAt || now
              });
              t.objectStore('profileClipData').put({ profileId: pid, name: ce.name, data: file.slice(ce.offset, ce.offset + ce.len) });
            });
            t.objectStore('meta').put({
              id: profKey(pid), data: {
                id: pid, name: name, createdAt: now, updatedAt: now,
                skeletonHash: skelHash, boneCount: (skel && skel.count) || hp.boneCount || 0,
                skeleton: skel, modelNames: fileEntries.map(function (fe) { return fe.name; })
              }
            });
          } catch (e) { try { t.abort(); } catch (e2) {} return; } // abort 后由 onabort 统一报错
          t.oncomplete = function () {
            if (opts.onProgress) opts.onProgress({ phase: 'done', done: total, total: total });
            ok({ pid: pid, name: name, clips: clipEntries.length, files: fileEntries.length });
          };
        };
      });
    });
  }

  // ============ 从插件导入动作（在线时用） ============

  // 把 48795 已录制的动作拉进本地资料库。names 省略 = 全部；force=true 时已有的也重新拉；
  // qcFn(name, clip) 可选质检回调（阶段 4）：返回 {ok:false, reason} 的不进库（防静止坏数据混进来）
  // ARCH-2：HTTP 出口统一走 choreo-api.js 48795 高层 api（配对码头/JSON/状态映射都在客户端；
  // 诊断页单独加载本模块时不会调到这里，且那时 ChoreoAPI 未加载会被上面的守卫拦下）
  function syncFromPlugin(opts) {
    opts = opts || {};
    if (typeof ChoreoAPI === 'undefined') {
      return Promise.reject(new Error('API 客户端未加载（choreo-api.js）'));
    }
    var client = ChoreoAPI.export;
    var report = { total: 0, imported: 0, skipped: 0, failed: [], sizeEnc: 0, sizeRaw: 0, elapsedMs: 0, cancelled: false };
    var t0 = Date.now();
    // 非 2xx 响应（含 403 未配对）：与拆分前同语「插件（48795）没有响应」；网络/解析失败照原样抛
    return client.api('/export/list').catch(function (e) {
      if (e && e.status) throw new Error('插件（48795）没有响应');
      throw e;
    }).then(function (j) {
      var names = (j && j.clips) || [];
      if (opts.names && opts.names.length) {
        var want = {};
        opts.names.forEach(function (n) { want[n] = true; });
        names = names.filter(function (n) { return want[n]; });
      }
      report.total = names.length;
      return clipIndex().then(function (idx) {
        var have = {};
        idx.forEach(function (c) { have[c.name] = true; });
        var targets = names.filter(function (n) { return opts.force || !have[n]; });
        report.skipped = names.length - targets.length;
        return targets;
      });
    }).then(function (targets) {
      var chain = Promise.resolve();
      targets.forEach(function (n, i) {
        chain = chain.then(function () {
          if (opts.shouldCancel && opts.shouldCancel()) { report.cancelled = true; throw new Error('__STOP__'); }
          if (opts.onProgress) opts.onProgress({ done: i, total: targets.length, name: n });
          return client.api('/export/getclip?name=' + encodeURIComponent(n)).then(function (clip) {
              if (!clip || !clip.bones || clip.error) throw new Error(clip && clip.error ? clip.error : '动作数据无效');
              if (opts.qcFn) {
                var qc = opts.qcFn(n, clip);
                if (qc && !qc.ok) throw new Error(qc.reason || '质检未通过');
              }
              return putClip(n, clip);
            }).then(function (meta) {
              report.imported++;
              report.sizeEnc += meta.sizeEnc;
              report.sizeRaw += meta.sizeRaw;
            }).catch(function (err) {
              if ((err && err.message) === '__STOP__') throw err;
              // 非 2xx 的客户端错误按插件「error」短码取词（与拆分前解析 body 同语）；其余用异常文本
              report.failed.push({ name: n, reason: (err && err.body && err.body.error) || (err && err.message) || String(err) });
            });
        });
      });
      return chain;
    }).then(function () {
      report.elapsedMs = Date.now() - t0;
      return report;
    });
  }

  // ============ 导出 API ============

  window.ChoreoLibrary = {
    available: available,
    useDb: useDb,
    useBackend: useBackend,
    repairOrphans: repairOrphans,
    stats: stats,
    clear: clear,
    getSkeleton: getSkeleton,
    putSkeleton: putSkeleton,
    getSkeletonInfo: getSkeletonInfo,
    getCatalog: getCatalog,
    putCatalog: putCatalog,
    getClip: getClip,
    putClip: putClip,
    deleteClip: deleteClip,
    clipIndex: clipIndex,
    pendingClipIndex: pendingClipIndex,
    allClipIndex: allClipIndex,
    copyClipToProfile: copyClipToProfile,
    assignPendingClips: assignPendingClips,
    hasClips: hasClips,
    hashObject: hashObject,
    structureHashOf: structureHashOf,
    getModelFiles: getModelFiles,
    getModelFile: getModelFile,
    putModelFile: putModelFile,
    deleteModelFiles: deleteModelFiles,
    listProfiles: listProfiles,
    createProfile: createProfile,
    setProfileSourceCode: setProfileSourceCode,
    deleteProfile: deleteProfile,
    renameProfile: renameProfile,
    getActiveProfile: getActiveProfile,
    getProfile: getProfile,
    setActiveProfile: setActiveProfile,
    getProfileFile: getProfileFile,
    getProfileFileInfo: getProfileFileInfo,
    putProfileFile: putProfileFile,
    importModelSet: importModelSet,
    exportBundle: exportBundle,
    importBundle: importBundle,
    createSharePackage: createSharePackage,
    importSharePackage: importSharePackage,
    syncFromPlugin: syncFromPlugin
  };
})();
