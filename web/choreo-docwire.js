/* choreo-docwire.js —— 文档接线层（WP-5-WIRE 第二增量，纯逻辑层）
这个文件是干嘛的：
  把 choreo-app.js 的持久化链路接到 web/choreo-document.js 的规范演出文档上，修掉
  2026-08-31 红基线复现的三类丢失：①装载→保存往返丢 content 顶层未知键（timing/stage）；
  ②导入按数组位置重编号 clip，毁掉文件里的数值 id 身份；③导出白名单丢舞者扩展键/职业。
  原则是「仓储存文档、UI 编辑投影」：装载=任意持久形态→文档→投影回 WP-3 content；
  保存=投影（含未知键载体）→文档。choreo-app.js 只做字段搬运，转换/校验/幂等都在这里
  （可 node 单测，web\test-docwire.js）。
无损通道怎么闭环：
  - 装载：文档级 _extra 里的未知顶层键被 toLegacyContent 摊回投影顶层 → unknownTopKeys
    收进 store.contentExtra；保存时 persistDoc 原样带回 → 迁移进 _extra。旧项目 round-trip 不丢键。
  - 事件/舞者/标记级未知键由文档模块自己的 _extra 通道保住（test-document §12 已冻结真实形状）。
修订号约定（与设计文档 §2 timelineRevision 对齐）：
  - 装载播种 rev=文档里的 timelineRevision；choreo-app.js 的 bumpTimelineRev 随每次内容变化
    同时递增会话修订（store._tlRevision，游戏协议）与持久修订（store._docRev）；保存时把
    _docRev 写进文档。装载本身不推进持久修订——种子在 bump 之后重写。
legacyLane/_extra 陈旧快照策略（设计文档 §15）：
  - 持久文档永远是「当前投影的确定性迁移」，不是上一份文档的增量更新——每次保存重新迁移，
    legacyLane 从泳道归属重新推导、未知键从 contentExtra 原样回填，不存在陈旧快照。
  - 六轨无损（TASK-20260901-SIX-TRACK-ROUNDTRIP）：泳道外的轨（ability/movement/facing/cue、
    悬空/停用轨）经 toLegacyContent 冻结进 content._doc.extraTracks，保存时原样回 doc.tracks；
    事件规范字段经 clip._doc 载体、文档段经 _doc.{timing,stage,capabilities,metadata,view,
    schemaVersion,topUnknown,laneTracks} 原位往返——投影/迁移细节都在 choreo-document.js，
    本层对 _doc 载体透明（它经 unknownTopKeys→contentExtra→保存原样回投影，应用零感知）。
  - 导入门（AC-1 畸形夹具）：规范文档里出现无法识别的轨道类型 → 拒绝导入并给出带路径的中文
    错误（存储数据不受影响）；装载路径（loadProjection）仍按设计文档 §2 停用保留不删——
    自动恢复不挡启动，显式导入必须人看得见问题。
降级与容错：模块与 choreo-document.js 由 shell 按序加载（test-shell 断言），不做运行时降级；
  loadProjection 对坏记录兜底空项目+warning（绝不挡启动），导入路径的错误如实抛中文提示。
*/
(function () {
  'use strict';

  var KNOWN_CONTENT_KEYS = ['dancers', 'globalLyrics', 'dancerCount', 'showLyricMacro', 'totalDuration', 'markers'];
  // 注意：迁移层已知清单（ChoreoDocument.KNOWN_CONTENT_KEYS）= 本清单 + '_doc'（载体对应用透明，
  // 不进应用的原生 6 键，也不会落进文档 _extra）；test-docwire 锁定两份清单的差集恰为 '_doc'

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function emptyProject() { return { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [] }; }

  // 编辑投影表达不了的规范字段留在会话载体里；保存时按稳定身份合并。
  // 载体不进入最终文档，不复制资源，也不把旧事件覆盖到已经编辑的事件上。
  function carryDocument(proj, doc) {
    var rebuilt = ChoreoDocument.ensureDocument(proj).doc;
    var keys = ['performers', 'tracks', 'lyrics', 'markers'];
    if (keys.every(function (k) { return ChoreoDocument.serialize(rebuilt[k]) === ChoreoDocument.serialize(doc[k]); })) return proj;
    proj._doc = proj._doc || {};
    proj._doc.roundTrip = {};
    keys.forEach(function (k) { proj._doc.roundTrip[k] = clone(doc[k]); });
    return proj;
  }
  function restoreDocument(doc, base) {
    if (!isObj(base)) return doc;
    function merge(old, current) { return Object.assign({}, clone(old || {}), current); }
    doc.performers = doc.performers.map(function (p) {
      var old = base.performers.find(function (q) { return q.id === p.id; });
      var out = merge(old, p); out.view = merge(old && old.view, p.view);
      ['start','profileId'].forEach(function(k){if(!(k in p))delete out[k]});
      return out;
    });
    doc.markers = doc.markers.map(function (m) { return merge(base.markers.find(function (q) { return q.id === m.id; }), m); });
    var projected = function (t) { return t.enabled !== false && (t.type === 'motion' || t.type === 'lyrics') && base.performers.some(function (p) { return p.id === t.performerId; }); };
    var used = new Set(), tracks = [];
    base.tracks.forEach(function (old) {
      if (!projected(old)) {
        var intact = doc.tracks.find(function (t) { return t.id === old.id; });
        if (intact) { tracks.push(intact); used.add(intact); } return;
      }
      if (!doc.performers.some(function (p) { return p.id === old.performerId; })) return;
      var group = doc.tracks.filter(function (t) { return t.type === old.type && t.performerId === old.performerId && t.enabled !== false; });
      var events = [];
      old.events.forEach(function (e) {
        if (e.enabled === false) { events.push(clone(e)); return; }
        group.forEach(function (t) { t.events.forEach(function (v) { if (v.id === e.id) events.push(v); }); });
      });
      var first = base.tracks.find(function (t) { return projected(t) && t.type === old.type && t.performerId === old.performerId; });
      if (first === old) group.forEach(function (t) { t.events.forEach(function (e) {
        if (!base.tracks.some(function (b) { return b.type === old.type && b.performerId === old.performerId && b.events.some(function (v) { return v.id === e.id; }); })) events.push(e);
      }); });
      group.forEach(function (t) { used.add(t); });
      tracks.push(Object.assign({}, clone(old), { events: events.sort(function (a,b) { return a.startMs-b.startMs; }) }));
    });
    doc.tracks.forEach(function (t) { if (!used.has(t)) tracks.push(t); });
    doc.tracks = tracks;
    base.lyrics.forEach(function (e) { if (e.enabled === false && !doc.lyrics.some(function (v) { return v.id === e.id; })) doc.lyrics.push(clone(e)); });
    doc.lyrics.sort(function (a,b) { return a.startMs-b.startMs; });
    return doc;
  }
  // 显式文件导入先校验原始数据；不能先归一化再把损坏值当成有效默认值。
  function validateFile(data, legacySanitize) {
    if (!isObj(data)) throw new Error('文件不是有效的项目 JSON 对象');
    if (data.content !== undefined && (data.id !== undefined || data.name !== undefined)) {
      if (data.schemaVersion !== undefined && data.schemaVersion !== 2) throw new Error('不支持的项目记录版本');
      return validateFile(data.content, legacySanitize);
    }
    var canonical = 'schemaVersion' in data || 'tracks' in data || 'performers' in data;
    if (!canonical) {
      if (data.version !== undefined && data.version !== '5.0' && data.version !== 5) throw new Error('不支持的旧项目版本');
      if (legacySanitize) legacySanitize(data);
      return;
    }
    if (data.schemaVersion !== ChoreoDocument.SCHEMA_VERSION) throw new Error('不支持的项目文件版本：'+data.schemaVersion);
    ['performers','tracks','lyrics','markers'].forEach(function (k) {
      if ((k === 'lyrics' || k === 'markers') && data[k] === undefined) return;
      if (!Array.isArray(data[k]) || data[k].some(function (v) { return !isObj(v); })) throw new Error(k+' 必须是对象数组');
    });
    data.tracks.forEach(function (t) { if (!Array.isArray(t.events) || t.events.some(function (e) { return !isObj(e); })) throw new Error('轨道 events 必须是对象数组'); });
    var errs = ChoreoDocument.validate(data).filter(function (i) { return i.level === 'error'; });
    if (errs.length) throw new Error('工程文件结构有问题：'+errs[0].path+' '+errs[0].message);
    (data.lyrics || []).forEach(function (e) { if (!Number.isInteger(e.durationMs) || e.durationMs < 0) throw new Error('歌词 durationMs 必须是非负整数'); });
  }

  // ---------- 装载：任意持久形态 → {proj, rev, doc, source, warning?} ----------
  // proj = 当前 UI 的 WP-3 content（未知顶层键原样带回）；rev = 文档修订号（装载种子）
  function loadProjection(ct) {
    if (!isObj(ct) || Object.keys(ct).length === 0) return { proj: emptyProject(), rev: 1, doc: null, source: 'empty' }; // 无内容=新空项目（静默，旧行为）
    var det;
    try { det = ChoreoDocument.ensureDocument(ct); } // 规范文档/记录内容/旧草稿自动识别；识别不出抛错走兜底
    catch (e) { return { proj: emptyProject(), rev: 1, doc: null, warning: (e && e.message) || '项目数据无法识别' }; }
    var proj = carryDocument(ChoreoDocument.toLegacyContent(det.doc), det.doc);
    if (typeof ChoreoMusic !== 'undefined') ChoreoMusic.sanitizeImportMusic(proj);
    return { proj: proj, rev: det.doc.timelineRevision, doc: det.doc, source: det.source };
  }

  // ---------- 保存：store 投影（6 已知字段 + contentExtra 未知键）→ 规范文档 ----------
  // meta 带 {id,name} 时走记录形态识别，projectId/name 随记录身份进文档；rev 是携带的持久修订号
  function persistDoc(proj, meta, rev) {
    var input = proj;
    if (meta && (meta.id !== undefined || meta.name !== undefined)) input = { id: meta.id, name: meta.name, content: proj };
    var det = ChoreoDocument.ensureDocument(input);
    var r = Math.floor(Number(rev));
    det.doc.timelineRevision = r >= 1 ? r : 1;
    return restoreDocument(det.doc, proj && proj._doc && proj._doc.roundTrip);
  }

  // ---------- 投影顶层未知键收集（存 store.contentExtra，保存时原样回文档 _extra） ----------
  function unknownTopKeys(proj) {
    var out = {};
    Object.keys(proj || {}).forEach(function (k) {
      if (KNOWN_CONTENT_KEYS.indexOf(k) < 0) out[k] = clone(proj[k]);
    });
    return out;
  }

  // ---------- 导入：规范文档导出 / 旧 v5.0 导出文件 → 投影 ----------
  // 旧形态先按原口径过 legacySanitize（AUD-002 的既定拒绝语义：start:'x' 这类非法值必须在
  // 迁移把时间收 0 之前就拒掉，clip-check §20 冻结此契约），文档形态走文档校验+投影校验；
  // clip 数值 id 来自文档迁移保号（ev-<旧id>），不再按数组位置重编号
  function importProjection(data, legacySanitize) {
    validateFile(data, legacySanitize);
    var det = ChoreoDocument.ensureDocument(data);
    // AC-1 畸形导入防线：无法识别的轨道类型在入口就拒绝（带路径中文报错），存储数据零改动；
    // （装载路径仍停用保留——设计文档 §2「绝不静默删除」，只有显式导入要求人先看见问题）
    var unknownTrack = (det.issues || []).filter(function (i) { return i.code === 'W_UNKNOWN_TRACK_TYPE'; });
    if (unknownTrack.length) throw new Error('工程文件里有无法识别的轨道类型，已拒绝导入：' + unknownTrack[0].message);
    var errs = ChoreoDocument.validate(det.doc).filter(function (i) { return i.level === 'error'; });
    if (errs.length) throw new Error('工程文件结构有问题：' + errs[0].message);
    var proj = carryDocument(ChoreoDocument.toLegacyContent(det.doc), det.doc);
    if (typeof ChoreoMusic !== 'undefined') ChoreoMusic.sanitizeImportMusic(proj);
    if (typeof legacySanitize === 'function') legacySanitize(proj);
    return { proj: proj, rev: det.doc.timelineRevision, doc: det.doc, source: det.source };
  }

  var API = {
    loadProjection: loadProjection,
    persistDoc: persistDoc,
    unknownTopKeys: unknownTopKeys,
    importProjection: importProjection,
    KNOWN_CONTENT_KEYS: KNOWN_CONTENT_KEYS,
  };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoDocWire = API;
})();
