/* choreo-document.js —— 规范演出文档模块（WP-5-DOC 第一增量，纯逻辑层）
这个文件是干嘛的：
  WP-5 要把「编舞项目」升级成设计文档（DESIGN-performance-script-v1.md）定义的规范演出文档：
  整数毫秒、稳定 ID、assetRef、timelineRevision、显式轨道/事件类型、版本化能力要求。
  现状问题（2026-08-31 已在 node 里实测复现）：choreo-app.js 的 projectRecord/applyProjectContent/
  exportProject/importProject 都用固定字段清单重建数据——content 上的未知字段（未来版本写入的
  timing/stage 等）在读→写一轮后被静默丢弃；舞者 id 是数组位置；时间是浮点秒。
  本模块是纯经典脚本（无 DOM/fetch/IndexedDB），拥有 schema、归一化、幂等迁移、结构校验、
  未知字段无损保留和确定性序列化；UI 与仓储「之后」才消费它（backlog：先模块+测试，后接线）。
分层与版本约定（重要）：
  - 记录层 schemaVersion（choreo-projects.js 的 2）和文档层 schemaVersion（本文档的 2）是两个
    互不读取的层。文档识别靠结构（schemaVersion 数字 + tracks/performers 数组），不靠记录层版本号。
  - 文档 schemaVersion 从 2 起（设计文档 §2 示例）：旧草稿/WP-3 content 都视为迁移源（v1 世代）。
    未来版本号 >2 的文档按「尽量保留」处理：归一化不动它，校验给提示，绝不降级改写。
无损保留的两条通道：
  - 规范文档上的未知字段：归一化原位深保留（顶层与各段一视同仁）；
  - 迁移进来的旧数据：已知字段逐项映射到规范字段；旧实体上不认识的键收进对应实体 _extra
    （迁移期保留字段，编译器必须忽略）；旧 content 顶层未知键收进文档级 _extra，
    toLegacyContent 投影时原样摊回去——旧项目 round-trip 不丢键。
幂等与确定性：
  - 迁移全程不取 Date.now/Math.random：ID 从旧实体身份推导（ev-<旧clipId>、actor-<旧舞者id>、
    tr-<i>-<type>、mk-<i>），缺 ID 的标记按序号补——同一输入迁移两遍字节一致。
  - 迁移只读输入（先深拷贝），失败抛错时原文件保持原样（设计文档 §14）。
  - serialize 递归按键名排序后紧凑输出：同一文档无论键序怎样搅过，字节都一致。
  - 事件按 startMs 稳定排序（并列保持原数组序——数组序不是身份，身份在 id）。
六轨无损通道（TASK-20260901-SIX-TRACK-ROUNDTRIP，v0.8 编辑门 E1 的持久化半场）：
  WP-5-WIRE 只承诺了 motion/lyrics 两类轨；本增量把六类轨全部接进投影回路，规则仍然只有一条：
  「投影表达不了的规范数据，整体冻结、原样带回，绝不静默丢弃」——
  - 轨道：泳道装不下的轨（ability/movement/facing/cue、悬空/停用轨）逐轨冻结进 _doc.extraTracks，
    迁移时经 normalizeTrack 原样回 doc.tracks；泳道轨上无 legacyLane 的文档原生事件照常投影
    （motion→actionClips、lyrics→lyricClips），事件字段由 _doc 载体带回；
  - 事件：旧 clip 形状表达不了的规范字段（kind/enabled/locked/notes/assetRef/createdWith/playMode/
    points… 及未知扩展键）整体冻结在 clip._doc 上，迁移时原样摊回事件顶层；事件 id 只有在
    「ev-<数字>」推导形状之外才进载体，往返后稳定 ID 不漂移；
    「带 legacyLane 且全部字段都等于无载体迁移重建默认值」的纯旧事件免载体——重迁移按原默认值
    逐键重建，旧项目保存形状不添 _doc 膨胀块（test-document §13 / library-verify proj 锁定）；
  - 舞者：规范 start 出场点与 notes 以同名键随舞者往返（DANCER_KNOWN_KEYS 收编）；
    角色档案绑定 profileId 同为同名键往返（CHARACTER-ASSETS-P1：非空字符串才是绑定，
    缺省/空串/非字符串不构成绑定，仍走 _extra 未知键通道）；
  - 文档段：timing/stage/capabilities/metadata/view/schemaVersion(>2) 中「迁移重建不出来」的部分
    冻结进 content._doc（能从投影原样重建的默认段不进载体，旧项目投影形状不变）。
  保留名清单：_extra、legacyLane（迁移期）、_doc（投影期）——旧数据恰带同名键时按保留名语义处理，
  行为确定性但不保证逐字节保留该同名键本身。
node 单测：web\test-document.js（不依赖浏览器）。
*/
(function () {
  'use strict';

  var SCHEMA_VERSION = 2;
  var MODULE_TAG = '0.7.1-wp5doc'; // createdWith / metadata.createdWith 的取值（确定性常量，勿改成动态时间）
  var TRACK_TYPES = ['motion', 'ability', 'movement', 'facing', 'cue', 'lyrics'];
  var EVENT_KINDS = ['motion', 'ability', 'movement', 'facing', 'cue', 'lyrics'];
  var SNAP_MODES = ['time', 'beat', 'action', 'off'];
  // 已知能力名（设计文档 §13 口径的子集，可扩充；未知能力名只给提示不报错）
  var KNOWN_CAPABILITIES = ['movement-control', 'ability-execution', 'web-3d-preview', 'game-preview', 'x1-input-v1'];

  function ChoreoDocumentError(code, message) {
    var e = new Error(message);
    e.name = 'ChoreoDocumentError'; e.code = code;
    return e;
  }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.round(x) === x; }
  function toIntMs(seconds) { // 浮点秒 → 整数毫秒（非数值/负值收 0，由调用方补问题条目）
    var n = typeof seconds === 'number' && isFinite(seconds) ? Math.round(seconds * 1000) : 0;
    return n > 0 ? n : 0;
  }
  function fromIntMs(ms) { return (isInt(ms) ? ms : 0) / 1000; }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function strOr(v, dft) { return typeof v === 'string' ? v : dft; }
  function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); } // 载体「默认段免冻结」比较用（结构plain、无循环引用）

  // ---------- 确定性 ID ----------
  // 随机 ID 只给 create() 兜底用；迁移路径一律用身份推导 ID（幂等要求）
  function newId(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function uniqueId(base, used) { // 旧数据被手工改坏出现重号时，确定性加后缀去重
    if (!used[base]) { used[base] = true; return base; }
    var n = 2;
    while (used[base + '-' + n]) n++;
    var id = base + '-' + n; used[id] = true; return id;
  }
  function numericSuffix(evId) { // 'ev-37' → 37（迁移事件保旧数值 clip id）；其余返回 null
    var m = /^ev-(\d+)$/.exec(String(evId || ''));
    return m ? Number(m[1]) : null;
  }

  // 段级归一化的无损通道（2026-08-31 审计 P2）：已知键重建后，把源对象上重建时没带的
  // 未知键原位并回去——timing/stage/metadata/performer.view 整体重建曾静默丢掉嵌套未知键，
  // 违反「规范文档未知字段原位深保留，顶层与各段一视同仁」的本模块不变量。
  function keepUnknown(src, rebuilt) {
    if (isObj(src)) {
      Object.keys(src).forEach(function (k) {
        if (!(k in rebuilt)) rebuilt[k] = clone(src[k]);
      });
    }
    return rebuilt;
  }

  // ---------- 深拷贝 + 未知键拆取 ----------
  // knownKeys 之外 的键收进 _extra（迁移期无损通道）；没有未知键时不产生 _extra（确定性）
  function splitUnknown(src, knownKeys) {
    var extra = null, out = {};
    Object.keys(src).forEach(function (k) {
      if (knownKeys.indexOf(k) >= 0) out[k] = src[k];
      else { if (!extra) extra = {}; extra[k] = clone(src[k]); }
    });
    return { known: out, extra: extra };
  }

  // ---------- 归一化（幂等：规范文档过多少遍都一样，未知字段原位保留） ----------
  function normalizeTrack(tr, idx, usedIds, issues) {
    var out = isObj(tr) ? clone(tr) : {};
    if (typeof out.id !== 'string' || !out.id) { out.id = uniqueId('tr-' + idx, usedIds); }
    else { out.id = uniqueId(out.id, usedIds); }
    if (TRACK_TYPES.indexOf(out.type) < 0) {
      out.enabled = false;     // 未识别的轨道类型：原值保留、停用并提示，绝不静默删除（设计文档 §2）
      if (issues) issues.push({ level: 'warning', code: 'W_UNKNOWN_TRACK_TYPE', path: 'tracks[' + idx + ']', message: '未识别的轨道类型「' + String(out.type) + '」，已停用保留（不会删除）' });
    } else if (out.enabled !== false) { out.enabled = true; }
    if (out.locked !== true) out.locked = false;
    out.notes = strOr(out.notes, '');
    if (out.performerId !== null && typeof out.performerId !== 'string') out.performerId = null;
    if (!Array.isArray(out.events)) out.events = [];
    out.events = out.events.filter(isObj).map(function (ev, ei) { return normalizeEvent(ev, issues, 'tr' + idx + '-e' + ei); })
      .sort(function (a, b) { return a.startMs - b.startMs; }); // 稳定排序：并列保持原序
    return out;
  }
  function normalizeEvent(ev, issues, idPrefix) {
    var out = clone(ev);
    if ((typeof out.id !== 'string' || !out.id) && ['ability', 'movement', 'facing'].indexOf(out.kind) < 0 && !Object.prototype.hasOwnProperty.call(out, 'x1'))
      out.id = (idPrefix || 'ev') + '-noid'; // 旧数据确定性兜底；X1 缺失身份原样保留给编译器拒绝
    if (EVENT_KINDS.indexOf(out.kind) < 0) {
      out.enabled = false;
      if (issues) issues.push({ level: 'warning', code: 'W_UNKNOWN_EVENT_KIND', path: 'events/' + out.id, message: '未识别的事件类型「' + String(out.kind) + '」，已停用保留（不会删除）' });
    }
    if (out.enabled !== false) out.enabled = true;
    if (out.locked !== true) out.locked = false;
    out.notes = strOr(out.notes, '');
    // X1 执行输入不补时刻、不四舍五入；保留错误原值给编译器明确拒绝。
    if (['ability', 'movement', 'facing'].indexOf(out.kind) < 0 && !Object.prototype.hasOwnProperty.call(out, 'x1')) {
      var st = typeof out.startMs === 'number' && isFinite(out.startMs) ? Math.round(out.startMs) : 0;
      var du = typeof out.durationMs === 'number' && isFinite(out.durationMs) ? Math.round(out.durationMs) : 0;
      out.startMs = st > 0 ? st : 0; out.durationMs = du > 0 ? du : 0;
    }
    if (out.assetRef !== undefined && out.assetRef !== null && !isObj(out.assetRef)) out.assetRef = null;
    if (isObj(out.assetRef)) {
      out.assetRef = keepUnknown(out.assetRef, { kind: strOr(out.assetRef.kind, 'clip'), id: strOr(out.assetRef.id, '') });
    }
    out.createdWith = strOr(out.createdWith, MODULE_TAG);
    return out;
  }
  function normalizePerformer(p, idx, usedIds, strictIdentity) {
    var out = isObj(p) ? clone(p) : {};
    if (!strictIdentity) {
      if (typeof out.id !== 'string' || !out.id) { out.id = uniqueId('actor-' + idx, usedIds); }
      else { out.id = uniqueId(out.id, usedIds); }
    }
    out.name = strOr(out.name, '舞者 ' + (idx + 1));
    out.color = strOr(out.color, '#7eb3ff');
    out.notes = strOr(out.notes, '');
    out.job = out.job === undefined ? null : strOr(out.job, null);
    var v = isObj(out.view) ? out.view : {};
    out.view = keepUnknown(v, {
      solo: v.solo === true, mute: v.mute === true,
      collapsed: v.collapsed === true, laneScale: typeof v.laneScale === 'number' && isFinite(v.laneScale) && v.laneScale > 0 ? v.laneScale : 1,
    });
    // 出场点/朝向（设计文档 §5 + M2-START-FORMATION §2）：旧数据没有 → 保持缺失，
    // 由校验给提示；显式原点 {0,0,0} 是合法 start；非对象/缺键/多键/非数值/非有限一律按
    // 缺失删键（与 validate 的 H_MISSING_START 同口径，旧无 start 形状字节稳定）。
    if (isObj(out.start)) {
      var _sx = out.start.x, _sz = out.start.z, _sy = out.start.yawDeg;
      var _sk = Object.keys(out.start);
      if (_sk.length === 3 && _sk.indexOf('x') >= 0 && _sk.indexOf('z') >= 0 && _sk.indexOf('yawDeg') >= 0
        && typeof _sx === 'number' && isFinite(_sx) && typeof _sz === 'number' && isFinite(_sz)
        && typeof _sy === 'number' && isFinite(_sy)) {
        out.start = { x: _sx, z: _sz, yawDeg: _sy };
      } else { delete out.start; }
    } else if ('start' in out) { delete out.start; }
    return out;
  }
  function normalize(doc, issues) {
    if (!isObj(doc)) throw ChoreoDocumentError('E_NOT_OBJECT', '演出文档必须是 JSON 对象');
    var out = clone(doc); // 输入只读：全部先深拷贝（迁移失败原文件不动）
    if (!isInt(out.schemaVersion) || out.schemaVersion < SCHEMA_VERSION) out.schemaVersion = SCHEMA_VERSION;
    // 版本 >2（未来文档）：不降级不改写，归一化只补结构默认值；校验给提示
    out.projectId = strOr(out.projectId, '');
    out.name = strOr(out.name, '未命名演出');
    var du = isInt(out.durationMs) ? out.durationMs : (typeof out.durationMs === 'number' && isFinite(out.durationMs) ? Math.round(out.durationMs) : 0);
    out.durationMs = du > 0 ? du : 300000;
    var t = isObj(out.timing) ? out.timing : {};
    out.timing = keepUnknown(t, {
      bpmMap: Array.isArray(t.bpmMap) ? t.bpmMap.filter(isObj) : [],
      timeSignatureMap: Array.isArray(t.timeSignatureMap) ? t.timeSignatureMap.filter(isObj) : [],
      audioOffsetMs: isInt(t.audioOffsetMs) ? t.audioOffsetMs : 0,
      countInBars: isInt(t.countInBars) ? t.countInBars : 0,
      snapMode: SNAP_MODES.indexOf(t.snapMode) >= 0 ? t.snapMode : 'time',
      audioRef: isObj(t.audioRef) ? keepUnknown(t.audioRef, { kind: strOr(t.audioRef.kind, 'audio'), id: strOr(t.audioRef.id, ''), fingerprint: strOr(t.audioRef.fingerprint, '') }) : null,
    });
    var sg = isObj(out.stage) ? out.stage : {};
    out.stage = keepUnknown(sg, { originCalibrated: sg.originCalibrated === true, stageYawDeg: typeof sg.stageYawDeg === 'number' && isFinite(sg.stageYawDeg) ? sg.stageYawDeg : 0 });
    var usedIds = {};
    if (!Array.isArray(out.performers)) out.performers = [];
    out.performers = out.performers.filter(isObj).map(function (p, i) { return normalizePerformer(p, i, usedIds, Object.prototype.hasOwnProperty.call(out, 'x1')); });
    var usedTr = {};
    if (!Array.isArray(out.tracks)) out.tracks = [];
    out.tracks = out.tracks.filter(isObj).map(function (tr, i) { return normalizeTrack(tr, i, usedTr, issues); });
    if (!Array.isArray(out.lyrics)) out.lyrics = [];
    out.lyrics = out.lyrics.filter(isObj).map(function (ev, li) { return normalizeEvent(ev, issues, 'lyr-e' + li); })
      .sort(function (a, b) { return a.startMs - b.startMs; });
    var usedMk = {};
    if (!Array.isArray(out.markers)) out.markers = [];
    out.markers = out.markers.filter(isObj).map(function (m, i) {
      var o = clone(m);
      // LOOSE-ENDS L1：旧项目数字 id 按「原数字」稳定派生（位置无关，删改序后不变）；
      // 缺 id/非数值仍按数组序补 mk-<i>，字符串 id 分支与去重顺序零改动
      if (typeof o.id === 'number' && isFinite(o.id)) { o.id = uniqueId('mk-' + String(o.id), usedMk); }
      else if (typeof o.id !== 'string' || !o.id) { o.id = uniqueId('mk-' + i, usedMk); }
      else { o.id = uniqueId(o.id, usedMk); }
      var ms = typeof o.tMs === 'number' && isFinite(o.tMs) ? Math.round(o.tMs) : 0;
      o.tMs = ms > 0 ? ms : 0;
      o.name = strOr(o.name, '标记');
      return o;
    });
    if (Object.prototype.hasOwnProperty.call(out, 'x1')) {
      // X1 中所有显式能力要求都保留原值；不能提前补版本、丢坏条目或删除未来字段。
      if (!Object.prototype.hasOwnProperty.call(out, 'capabilities')) out.capabilities = [];
    } else {
      if (!Array.isArray(out.capabilities)) out.capabilities = [];
      out.capabilities = out.capabilities.filter(isObj).map(function (c) {
        if (c.name === 'x1-input-v1') return clone(c);
        return keepUnknown(c, { name: strOr(c.name, ''), minProtocol: isInt(c.minProtocol) ? c.minProtocol : 1 });
      });
    }
    var tr2 = isInt(out.timelineRevision) ? out.timelineRevision : Math.round(Number(out.timelineRevision) || 0);
    out.timelineRevision = tr2 >= 1 ? tr2 : 1;
    var md = isObj(out.metadata) ? out.metadata : {};
    out.metadata = keepUnknown(md, { createdWith: strOr(md.createdWith, MODULE_TAG), migratedFrom: md.migratedFrom === undefined ? null : strOr(md.migratedFrom, null), notes: strOr(md.notes, '') });
    if (!isObj(out.view)) out.view = {};
    return out;
  }

  // ---------- 旧数据迁移（WP-3 content / 旧 5 字段草稿 → 规范文档） ----------
  // CLIP_KNOWN_KEYS 含 _doc：投影期规范字段载体是保留名，不进事件 _extra（六轨无损通道）
  var CLIP_KNOWN_KEYS = ['id', 'start', 'duration', 'data', '_doc'];
  // 舞者规范 start（出场点 §5）与 notes 以同名键随舞者往返；v0.7 旧数据没有这两个键，行为不变
  var DANCER_KNOWN_KEYS = ['id', 'name', 'color', 'switchClips', 'actionClips', 'lyricClips', 'clips', 'currentJob', 'collapsed', 'laneScale', 'solo', 'mute', 'notes', 'start'];
  var MARKER_KNOWN_KEYS = ['id', 't', 'name'];
  // content 顶层里「映射回规范文档」的键清单（_doc=投影期载体）：这些键不进文档 _extra。
  // 与 choreo-docwire 的 KNOWN_CONTENT_KEYS（应用商店原生 6 键）刻意不同：_doc 对应用透明，
  // 经 store.contentExtra 往返；测试锁定两份清单的差集恰为 _doc
  var KNOWN_CONTENT_KEYS = ['dancers', 'globalLyrics', 'dancerCount', 'showLyricMacro', 'totalDuration', 'markers', '_doc'];
  // 事件 → clip 投影时必须排除的键（各自有通道）：id/startMs/durationMs 走 clip 三键、
  // data 整体冻结、_extra 原样摊回；其余规范字段（含 legacyLane）全部进 _doc 载体
  var CLIP_CARRIER_EXCLUDE = ['id', 'startMs', 'durationMs', 'data', '_extra'];
  function clipToEvent(c, kind, legacyLane, usedEv, issues, path) {
    if (!isObj(c)) return null;
    var su = splitUnknown(c, CLIP_KNOWN_KEYS);
    var dc = isObj(c._doc) ? c._doc : null; // 投影期冻结的规范字段载体（六轨无损通道）
    // 事件身份：优先用载体带回的原生 id（稳定 ID 往返不漂移），否则按旧数值 clip id 推导
    var nativeId = dc && typeof dc.id === 'string' && dc.id ? dc.id : null;
    var id = uniqueId(nativeId || ('ev-' + (typeof c.id === 'number' || typeof c.id === 'string' ? c.id : 'x')), usedEv);
    var ev = {
      id: id, kind: kind,
      startMs: toIntMs(c.start), durationMs: toIntMs(c.duration),
    };
    if (!dc) {
      // 纯旧数据（无载体）：既有迁移语义——已知字段逐项映射，缺省补默认值
      ev.enabled = true; ev.locked = false; ev.notes = '';
      ev.assetRef = { kind: 'clip', id: 'legacyclip-' + c.id }; // 迁移期文档内引用（库级稳定引用由后续增量替换）
      ev.createdWith = MODULE_TAG;
      ev.legacyLane = legacyLane;  // 迁移期保留字段：旧数据出自哪条泳道（投影回旧格式靠它）
      ev.data = isObj(c.data) ? clone(c.data) : {}; // 旧 data 整体冻结保留（name/command/category/isJobSwitch…）
      if (kind === 'motion') {
        ev.clipId = 'legacyclip-' + c.id;   // 设计文档 §7 动作事件专用字段
        ev.command = strOr(c.data && c.data.command, '');
        ev.playMode = 'once';               // 旧数据没有循环信息，默认单次
        ev.rootMotionMode = 'inPlace';      // 设计文档 §11 默认原位，防双位移
      }
      if (kind === 'lyrics') {
        ev.text = strOr(c.data && c.data.name, '');
        ev.command = strOr(c.data && c.data.command, '');
      }
    } else {
      // 载体摊回（六轨无损）：规范字段原样回事件顶层；载体没带的键保持原样缺失，绝不补默认值
      // （id 上面已按身份推导去重，不在此覆盖）
      if (isObj(c.data)) ev.data = clone(c.data);
      Object.keys(dc).forEach(function (k) { if (k !== 'id') ev[k] = clone(dc[k]); });
    }
    if (su.extra) ev._extra = su.extra;   // 旧 clip 上不认识的键原样保留（两条分支一致）
    if (!dc && c._doc !== undefined) {
      // 畸形 _doc（非对象）：进 _extra 保底，不静默丢弃
      if (!ev._extra) ev._extra = {};
      ev._extra._doc = clone(c._doc);
    }
    if (typeof c.start !== 'number' || !isFinite(c.start)) issues.push({ level: 'warning', code: 'W_BAD_LEGACY_TIME', path: path + '/' + id, message: '第「' + id + '」条旧记录的开始时刻不是数值，已按 0 处理' });
    return ev;
  }
  function migrateContent(content, opts, source, issues) {
    if (!isObj(content)) throw ChoreoDocumentError('E_BAD_CONTENT', '项目内容必须是 JSON 对象（收到 ' + (content === null ? 'null' : typeof content) + '）');
    if (!Array.isArray(content.dancers)) throw ChoreoDocumentError('E_NO_DANCERS', '项目内容缺少有效的 dancers 数组，无法识别为可迁移的旧格式');
    var doc = {
      schemaVersion: SCHEMA_VERSION,
      projectId: strOr(opts && opts.projectId, '') || newId('proj'),
      name: strOr(opts && opts.name, '') || '未命名演出',
      durationMs: toIntMs(content.totalDuration || 300) || 300000,
      timing: { bpmMap: [], timeSignatureMap: [], audioOffsetMs: 0, countInBars: 0, snapMode: 'time', audioRef: null },
      stage: { originCalibrated: false, stageYawDeg: 0 },
      performers: [], tracks: [], lyrics: [], markers: [],
      capabilities: [], timelineRevision: 1,
      metadata: { createdWith: MODULE_TAG, migratedFrom: source, notes: '' },
      view: { showLyricMacro: content.showLyricMacro === true },
    };
    var usedEv = {}, usedPid = {}, usedMk = {}, usedTr = {};
    // 投影期载体提前取：泳道轨元数据（自定义轨 id/locked/notes）在重建泳道轨时就要用
    var dc = isObj(content._doc) ? content._doc : null;
    var laneQ = {};
    if (dc && Array.isArray(dc.laneTracks)) dc.laneTracks.filter(isObj).forEach(function (m) {
      var k = strOr(m.performerId, '') + '|' + strOr(m.type, '');
      (laneQ[k] = laneQ[k] || []).push(m);
    });
    function laneMeta(pid, type) { var q = laneQ[pid + '|' + type]; return q && q.length ? q.shift() : null; }
    (content.dancers || []).forEach(function (d, i) {
      if (!isObj(d)) { issues.push({ level: 'warning', code: 'W_BAD_DANCER', path: 'dancers[' + i + ']', message: '第 ' + (i + 1) + ' 个舞者数据不完整，已跳过' }); return; }
      var du = splitUnknown(d, DANCER_KNOWN_KEYS);
      var legacyDancerId = typeof d.id === 'number' ? d.id : i;
      var carriedPid = dc && isObj(dc.performerIds) && Object.prototype.hasOwnProperty.call(dc.performerIds, String(legacyDancerId))
        ? dc.performerIds[String(legacyDancerId)] : undefined;
      if (carriedPid !== undefined && (typeof carriedPid !== 'string' || !carriedPid.trim()))
        throw ChoreoDocumentError('E_PERFORMER_ID', '演员身份载体无效，不能补造 X1 所属演员');
      if (carriedPid !== undefined && usedPid[carriedPid])
        throw ChoreoDocumentError('E_PERFORMER_ID', '演员身份载体重复，不能为 X1 重命名演员');
      var pid = uniqueId(carriedPid === undefined ? 'actor-' + legacyDancerId : carriedPid, usedPid);
      var perf = {
        id: pid, name: strOr(d.name, '舞者 ' + (i + 1)), color: strOr(d.color, '#7eb3ff'), notes: strOr(d.notes, ''),
        job: d.currentJob === undefined ? null : strOr(d.currentJob, null),
        view: { solo: d.solo === true, mute: d.mute === true, collapsed: d.collapsed === true, laneScale: typeof d.laneScale === 'number' && isFinite(d.laneScale) && d.laneScale > 0 ? d.laneScale : 1 },
      };
      // 规范出场点（§5 + M2 §2）随舞者往返：仅恰为三有限数值才保留原值，
      // 其余（非对象/缺键/多键/非数值/非有限）按缺失处理，旧无 start 形状不变。
      if (isObj(d.start)) {
        var _mx = d.start.x, _mz = d.start.z, _my = d.start.yawDeg;
        var _mk = Object.keys(d.start);
        if (_mk.length === 3 && _mk.indexOf('x') >= 0 && _mk.indexOf('z') >= 0 && _mk.indexOf('yawDeg') >= 0
          && typeof _mx === 'number' && isFinite(_mx) && typeof _mz === 'number' && isFinite(_mz)
          && typeof _my === 'number' && isFinite(_my)) {
          perf.start = { x: _mx, z: _mz, yawDeg: _my };
        }
      }
      // 角色档案绑定（CHARACTER-ASSETS-P1）：非空字符串 profileId 以同名键进规范舞者
      // （从 _extra 未知键通道摘出）；缺省/空串/非字符串不构成绑定，仍走 _extra 原通道
      if (typeof d.profileId === 'string' && d.profileId) {
        perf.profileId = d.profileId;
        if (du.extra) { delete du.extra.profileId; if (!Object.keys(du.extra).length) delete du.extra; }
      }
      if (du.extra) perf._extra = du.extra;
      doc.performers.push(perf);
      var sw = Array.isArray(d.switchClips) ? d.switchClips : [];
      var ac = Array.isArray(d.actionClips) ? d.actionClips : (Array.isArray(d.clips) ? d.clips : []);
      var lc = Array.isArray(d.lyricClips) ? d.lyricClips : [];
      if (sw.length || ac.length) {
        var mm = laneMeta(pid, 'motion'); // 载体带回的泳道轨元数据：自定义轨 id/locked/notes 往返不漂移
        var mt = {
          id: uniqueId(mm && typeof mm.id === 'string' && mm.id ? mm.id : 'tr-' + i + '-motion', usedTr),
          type: 'motion', performerId: pid, enabled: true,
          locked: mm ? mm.locked === true : false, notes: mm ? strOr(mm.notes, '') : '', events: [],
        };
        sw.forEach(function (c) { var ev = clipToEvent(c, 'motion', 'switch', usedEv, issues, 'dancers[' + i + '].switchClips'); if (ev) mt.events.push(ev); });
        ac.forEach(function (c) { var ev = clipToEvent(c, 'motion', 'action', usedEv, issues, 'dancers[' + i + '].actionClips'); if (ev) mt.events.push(ev); });
        mt.events.sort(function (a, b) { return a.startMs - b.startMs; });
        usedTr[mt.id] = true;
        doc.tracks.push(mt);
      }
      if (lc.length) {
        var lm = laneMeta(pid, 'lyrics');
        var lt = {
          id: uniqueId(lm && typeof lm.id === 'string' && lm.id ? lm.id : 'tr-' + i + '-lyrics', usedTr),
          type: 'lyrics', performerId: pid, enabled: true,
          locked: lm ? lm.locked === true : false, notes: lm ? strOr(lm.notes, '') : '', events: [],
        };
        lc.forEach(function (c) { var ev = clipToEvent(c, 'lyrics', 'lyric', usedEv, issues, 'dancers[' + i + '].lyricClips'); if (ev) lt.events.push(ev); });
        lt.events.sort(function (a, b) { return a.startMs - b.startMs; });
        usedTr[lt.id] = true;
        doc.tracks.push(lt);
      }
    });
    var gl = Array.isArray(content.globalLyrics) ? content.globalLyrics : [];
    gl.forEach(function (c) { var ev = clipToEvent(c, 'lyrics', 'globalLyric', usedEv, issues, 'globalLyrics'); if (ev) doc.lyrics.push(ev); });
    doc.lyrics.sort(function (a, b) { return a.startMs - b.startMs; });
    (Array.isArray(content.markers) ? content.markers : []).forEach(function (m, i) {
      if (!isObj(m)) return;
      var mu = splitUnknown(m, MARKER_KNOWN_KEYS);
      // LOOSE-ENDS L1：数字 id 同「mk-<原数字>」口径（与 normalize 一致，位置无关）
      var mid = typeof m.id === 'number' && isFinite(m.id) ? 'mk-' + String(m.id) : (typeof m.id === 'string' && m.id ? m.id : 'mk-' + i);
      var mk = { id: uniqueId(mid, usedMk), tMs: toIntMs(m.t), name: strOr(m.name, '标记') };
      if (mu.extra) mk._extra = mu.extra;
      doc.markers.push(mk);
    });
    doc.markers.sort(function (a, b) { return a.tMs - b.tMs; });
    // 旧 content 顶层未知键（未来版本写入的 timing/stage 等）→ 文档级 _extra（无损通道）；
    // _doc 是投影期载体（KNOWN_CONTENT_KEYS），走下方「规范段摊回」，绝不进 _extra
    var cu = splitUnknown(content, KNOWN_CONTENT_KEYS);
    if (cu.extra) doc._extra = cu.extra;
    // 投影期载体摊回（六轨无损）：泳道外的轨、文档段默认值重建不出来的部分，原样回规范位置
    if (dc) {
      // 原位未知顶层键先回顶层，并把同名键从 _extra 里摘掉（_extra 摊回的 content 键与它同键时以原位为准）
      if (isObj(dc.topUnknown)) Object.keys(dc.topUnknown).forEach(function (k) {
        doc[k] = clone(dc.topUnknown[k]);
        if (isObj(doc._extra)) { delete doc._extra[k]; if (!Object.keys(doc._extra).length) delete doc._extra; }
      });
      if (isObj(dc.timing)) doc.timing = clone(dc.timing);
      if (isObj(dc.stage)) doc.stage = clone(dc.stage);
      if (Array.isArray(dc.capabilities) || (Object.prototype.hasOwnProperty.call(doc, 'x1') && Object.prototype.hasOwnProperty.call(dc, 'capabilities')))
        doc.capabilities = clone(dc.capabilities);
      if (isObj(dc.metadata)) doc.metadata = clone(dc.metadata);
      if (isObj(dc.view)) doc.view = clone(dc.view);
      if (isInt(dc.schemaVersion) && dc.schemaVersion >= SCHEMA_VERSION) doc.schemaVersion = dc.schemaVersion; // 未来版本只升不降（§15）
      if (Array.isArray(dc.extraTracks)) dc.extraTracks.filter(isObj).forEach(function (t) {
        doc.tracks.push(normalizeTrack(clone(t), doc.tracks.length, usedTr, issues)); // 过 normalizeTrack：畸形轨补默认值/去重，规范轨逐字节不变
      });
    }
    return doc;
  }

  // ---------- 入口：识别 → 迁移/归一化 → 校验 ----------
  function looksLikeDocument(x) {
    return isObj(x) && typeof x.schemaVersion === 'number' && (Array.isArray(x.tracks) || Array.isArray(x.performers));
  }
  // 自动识别三种输入：规范文档 / WP-3 项目记录 {id,name,content} / 旧 5 字段草稿。
  // 返回 {doc, issues, source}；致命畸形抛 ChoreoDocumentError（调用方保住原文件）。
  function ensureDocument(input, opts) {
    var issues = [];
    if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
      throw ChoreoDocumentError('E_NOT_OBJECT', '演出数据必须是 JSON 对象（收到 ' + (input === null ? 'null' : typeof input) + '）');
    }
    if (looksLikeDocument(input)) {
      return { doc: normalize(input, issues), issues: issues, source: 'document' };
    }
    if (input.content !== undefined && (input.id !== undefined || input.name !== undefined)) {
      var sub = ensureDocument(input.content, { projectId: input.id, name: input.name });
      sub.source = 'project';
      return sub;
    }
    if (input.dancers !== undefined) { // 带 dancers 键但坏了的内容也走迁移，拿到更明确的中文错误
      var source = Array.isArray(input.markers) ? 'project' : 'draft'; // 有 markers=WP-3 schema2，否则更旧的草稿
      var doc = migrateContent(input, opts, source, issues);
      return { doc: doc, issues: issues, source: source };
    }
    throw ChoreoDocumentError('E_UNRECOGNIZED', '无法识别的数据格式：既不是规范演出文档，也不是可迁移的旧项目/草稿');
  }
  function fromProject(record, opts) {
    if (!isObj(record)) throw ChoreoDocumentError('E_BAD_RECORD', '项目记录必须是 JSON 对象');
    var o = {};
    if (opts) Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.projectId = record.id; o.name = record.name;
    return ensureDocument(record.content, o);
  }
  function fromDraft(draft, opts) {
    if (!isObj(draft) || !Array.isArray(draft.dancers)) throw ChoreoDocumentError('E_BAD_DRAFT', '旧草稿无效：缺少 dancers 数组');
    return ensureDocument(draft, opts);
  }
  function create(opts) {
    opts = opts || {};
    var doc = {
      schemaVersion: SCHEMA_VERSION,
      projectId: strOr(opts.projectId, '') || newId('proj'),
      name: strOr(opts.name, '') || '未命名演出',
      durationMs: isInt(opts.durationMs) && opts.durationMs > 0 ? opts.durationMs : 300000,
      timing: { bpmMap: [], timeSignatureMap: [], audioOffsetMs: 0, countInBars: 0, snapMode: 'time', audioRef: null },
      stage: { originCalibrated: false, stageYawDeg: 0 },
      performers: [], tracks: [], lyrics: [], markers: [],
      capabilities: [], timelineRevision: 1,
      metadata: { createdWith: MODULE_TAG, migratedFrom: null, notes: '' },
      view: {},
    };
    (Array.isArray(opts.performers) ? opts.performers : []).forEach(function (spec, i) {
      var pid = 'actor-' + i;
      doc.performers.push({
        id: pid, name: strOr(spec && spec.name, '舞者 ' + (i + 1)), color: strOr(spec && spec.color, '#7eb3ff'),
        notes: strOr(spec && spec.notes, ''), job: spec && spec.job ? strOr(spec.job, null) : null,
        view: { solo: false, mute: false, collapsed: false, laneScale: 1 },
      });
      doc.tracks.push({ id: 'tr-' + i + '-motion', type: 'motion', performerId: pid, enabled: true, locked: false, notes: '', events: [] });
      doc.tracks.push({ id: 'tr-' + i + '-lyrics', type: 'lyrics', performerId: pid, enabled: true, locked: false, notes: '', events: [] });
    });
    return doc;
  }

  // ---------- 结构校验（冲突级体检仍归 choreo-check.js，这里只管 schema 层） ----------
  function validate(doc) {
    var issues = [];
    if (!isObj(doc)) { issues.push({ level: 'error', code: 'E_NOT_OBJECT', path: '', message: '演出文档必须是 JSON 对象' }); return issues; }
    if (!isInt(doc.schemaVersion)) issues.push({ level: 'error', code: 'E_SCHEMA_BAD', path: 'schemaVersion', message: 'schemaVersion 必须是整数' });
    else if (doc.schemaVersion > SCHEMA_VERSION) issues.push({ level: 'hint', code: 'H_SCHEMA_FUTURE', path: 'schemaVersion', message: '文档版本（' + doc.schemaVersion + '）比当前程序新，已按当前版本尽量保留，不会改写' });
    if (!doc.projectId) issues.push({ level: 'warning', code: 'W_EMPTY_PROJECT_ID', path: 'projectId', message: '文档缺少 projectId，保存前需要补上' });
    if (!isInt(doc.durationMs) || doc.durationMs < 0) issues.push({ level: 'error', code: 'E_DURATION_BAD', path: 'durationMs', message: 'durationMs 必须是不小于 0 的整数毫秒' });
    else if (doc.durationMs < 300000) issues.push({ level: 'hint', code: 'H_DURATION_SHORT', path: 'durationMs', message: '轨道时长不足 300 秒，编辑器会按 300 秒显示' });
    var pids = {};
    (doc.performers || []).forEach(function (p, i) {
      if (!p || typeof p.id !== 'string' || !p.id) issues.push({ level: 'error', code: 'E_ID_MISSING', path: 'performers[' + i + '].id', message: '舞者缺少稳定 ID' });
      else if (pids[p.id]) issues.push({ level: 'error', code: 'E_DUP_ID', path: 'performers[' + i + '].id', message: '舞者 ID「' + p.id + '」重复' });
      else pids[p.id] = true;
      // M2-START-FORMATION：显式原点 {0,0,0} 是合法 start，不再报缺失；只有 truly 缺失才 hint。
      if (!isObj(p.start)) issues.push({ level: 'hint', code: 'H_MISSING_START', path: 'performers[' + i + ']', message: '舞者「' + (p && p.name) + '」还没有出场点，游戏执行前需要在游戏里校准' });
    });
    var tids = {};
    (doc.tracks || []).forEach(function (t, i) {
      if (!t || typeof t.id !== 'string' || !t.id) { issues.push({ level: 'error', code: 'E_ID_MISSING', path: 'tracks[' + i + '].id', message: '轨道缺少稳定 ID' }); }
      else if (tids[t.id]) issues.push({ level: 'error', code: 'E_DUP_ID', path: 'tracks[' + i + '].id', message: '轨道 ID「' + t.id + '」重复' });
      else tids[t.id] = true;
      if (t && t.performerId !== null && !pids[t.performerId]) issues.push({ level: 'warning', code: 'W_ORPHAN_TRACK', path: 'tracks[' + i + ']', message: '轨道「' + (t && t.id) + '」指向不存在的舞者（悬空引用，编译前需处理）' });
      var eids = {};
      ((t && t.events) || []).forEach(function (ev, j) {
        if (!ev || typeof ev.id !== 'string' || !ev.id) { issues.push({ level: 'error', code: 'E_ID_MISSING', path: 'tracks[' + i + '].events[' + j + '].id', message: '事件缺少稳定 ID' }); return; }
        if (eids[ev.id]) issues.push({ level: 'error', code: 'E_DUP_ID', path: 'tracks[' + i + '].events[' + j + '].id', message: '事件 ID「' + ev.id + '」重复' });
        else eids[ev.id] = true;
        if (!isInt(ev.startMs) || ev.startMs < 0) issues.push({ level: 'error', code: 'E_MS_BAD', path: 'tracks[' + i + '].events[' + j + '].startMs', message: '事件的开始时刻必须是整数毫秒' });
        if (!isInt(ev.durationMs) || ev.durationMs < 0) issues.push({ level: 'error', code: 'E_MS_BAD', path: 'tracks[' + i + '].events[' + j + '].durationMs', message: '事件的时长必须是整数毫秒' });
        if (ev.assetRef && (typeof ev.assetRef.kind !== 'string' || typeof ev.assetRef.id !== 'string' || !ev.assetRef.id)) issues.push({ level: 'error', code: 'E_ASSETREF_SHAPE', path: 'tracks[' + i + '].events[' + j + '].assetRef', message: 'assetRef 必须是 {kind, id} 且 id 非空' });
      });
    });
    (doc.lyrics || []).forEach(function (ev, j) {
      if (!ev || typeof ev.id !== 'string' || !ev.id) issues.push({ level: 'error', code: 'E_ID_MISSING', path: 'lyrics[' + j + '].id', message: '歌词事件缺少稳定 ID' });
      if (ev && (!isInt(ev.startMs) || ev.startMs < 0)) issues.push({ level: 'error', code: 'E_MS_BAD', path: 'lyrics[' + j + '].startMs', message: '歌词事件的开始时刻必须是整数毫秒' });
    });
    var mids = {};
    (doc.markers || []).forEach(function (m, i) {
      if (!m || typeof m.id !== 'string' || !m.id) { issues.push({ level: 'error', code: 'E_ID_MISSING', path: 'markers[' + i + '].id', message: '标记缺少稳定 ID' }); return; }
      if (mids[m.id]) issues.push({ level: 'error', code: 'E_DUP_ID', path: 'markers[' + i + '].id', message: '标记 ID「' + m.id + '」重复' });
      else mids[m.id] = true;
      if (!isInt(m.tMs) || m.tMs < 0) issues.push({ level: 'error', code: 'E_MS_BAD', path: 'markers[' + i + '].tMs', message: '标记时刻必须是整数毫秒' });
    });
    if (Object.prototype.hasOwnProperty.call(doc, 'x1') && !Array.isArray(doc.capabilities))
      issues.push({ level: 'error', code: 'E_CAP_SHAPE', path: 'capabilities', message: '能力要求必须是数组，不能丢弃后装载' });
    (Array.isArray(doc.capabilities) ? doc.capabilities : []).forEach(function (c, i) {
      if (!c || typeof c.name !== 'string' || !c.name) issues.push({ level: 'error', code: 'E_CAPS_SHAPE', path: 'capabilities[' + i + ']', message: '能力要求必须有非空 name' });
      else if (!isInt(c.minProtocol) || c.minProtocol < 1) issues.push({ level: 'error', code: 'E_CAPS_SHAPE', path: 'capabilities[' + i + '].minProtocol', message: '能力「' + c.name + '」的 minProtocol 必须是正整数' });
      else if (KNOWN_CAPABILITIES.indexOf(c.name) < 0) issues.push({ level: 'hint', code: 'H_CAPS_UNKNOWN', path: 'capabilities[' + i + '].name', message: '未识别的能力要求「' + c.name + '」，已保留' });
    });
    return issues;
  }

  // ---------- 投影：规范文档 → 当前 UI 能直接吃的 WP-3 content ----------
  // 数值 id 来自迁移事件的后缀（ev-<旧clipId>）；文档原生事件缺数值 id 时按 nextNum() 发号（确定性）
  // 事件投影时规范字段载体（六轨无损）：排除各自有通道的键后整体冻结进 clip._doc；
  // 非「ev-<数字>」推导形状的事件 id 一并进载体（稳定 ID 往返不漂移）
  // 纯旧形状免载体：带 legacyLane 且全部规范字段都等于「无载体 clip 迁移重建默认值」的事件
  // 不产 _doc——重迁移按同一套默认值逐键重建（逐字节等价），旧项目保存形状不添膨胀块；
  // 文档原生事件（无 legacyLane）不适用（重建会注入 legacyLane 等默认键），仍走完整载体
  var PURE_LEGACY_KEYS = ['kind', 'enabled', 'locked', 'notes', 'createdWith', 'assetRef', 'legacyLane',
    'clipId', 'command', 'playMode', 'rootMotionMode', 'text'];
  function legacyDefaultsMatch(ev, kind, legacyLane, c) {
    if (typeof ev.legacyLane !== 'string' || ev.legacyLane !== legacyLane) return false;
    if (numericSuffix(ev.id) === null) return false; // 原生 id 形状：载体必须带 id
    if (!isObj(ev.data)) return false;               // 无载体重建会补 data:{}，非对象不等价
    var d = c.data || {};
    function eq(k, v) { return eqJson(ev[k], v); }
    if (!eq('kind', kind) || !eq('enabled', true) || !eq('locked', false) || !eq('notes', '')) return false;
    if (!eq('createdWith', MODULE_TAG)) return false;
    if (!eq('assetRef', { kind: 'clip', id: 'legacyclip-' + c.id })) return false;
    if (kind === 'motion') {
      if (!eq('clipId', 'legacyclip-' + c.id) || !eq('command', strOr(d.command, ''))
        || !eq('playMode', 'once') || !eq('rootMotionMode', 'inPlace')) return false;
      if ('text' in ev) return false; // 重建不会设 text：带自定义 text 的不算纯旧
    } else {
      if (!eq('text', strOr(d.name, '')) || !eq('command', strOr(d.command, ''))) return false;
      if ('clipId' in ev || 'playMode' in ev || 'rootMotionMode' in ev) return false;
    }
    // 通道键与已核对键之外只要还有任何键（未知扩展键/未来键），都必须走载体
    return Object.keys(ev).every(function (k) {
      return CLIP_CARRIER_EXCLUDE.indexOf(k) >= 0 || PURE_LEGACY_KEYS.indexOf(k) >= 0;
    });
  }
  function docCarrierOf(ev, kind, legacyLane, c) {
    if (legacyDefaultsMatch(ev, kind, legacyLane, c)) return null;
    var out = null;
    function put(k, v) { if (!out) out = {}; out[k] = v; }
    Object.keys(ev).forEach(function (k) {
      if (CLIP_CARRIER_EXCLUDE.indexOf(k) >= 0) return;
      put(k, clone(ev[k]));
    });
    if (typeof ev.id === 'string' && ev.id && numericSuffix(ev.id) === null) put('id', ev.id);
    return out;
  }
  function eventToClip(ev, nextNum, kind, legacyLane) {
    var n = numericSuffix(ev.id);
    var c = {
      id: n !== null ? n : (typeof nextNum === 'function' ? nextNum() : 0),
      start: fromIntMs(ev.startMs), duration: fromIntMs(ev.durationMs),
    };
    if (isObj(ev.data)) c.data = clone(ev.data); // 旧 data 冻结块；原生事件没有 data 时不补空块（往返不添键）
    if (ev._extra) Object.keys(ev._extra).forEach(function (k) { c[k] = clone(ev._extra[k]); });
    var dc = docCarrierOf(ev, kind, legacyLane, c);
    if (dc) c._doc = dc; // 保留名 _doc：与 _extra 摊回的同名键冲突时以载体为准（确定性）
    return c;
  }
  function toLegacyContent(doc) {
    if (!isObj(doc)) throw ChoreoDocumentError('E_NOT_OBJECT', '演出文档必须是 JSON 对象');
    var content = {};
    // 先登记投影里已占用的数值 clip id，给缺后缀的原生事件按序发号（不与迁移 id 冲突，且确定）
    var usedNum = {};
    function noteNum(ev) { var n = numericSuffix(ev.id); if (n !== null) usedNum[n] = true; }
    (doc.tracks || []).forEach(function (t) { ((t && t.events) || []).forEach(noteNum); });
    (doc.lyrics || []).forEach(noteNum);
    function nextNum() { var n = 1; while (usedNum[n]) n++; usedNum[n] = true; return n; }
    // 未知 canonical 顶层键 + 迁移期 _extra 先摊进去（已知字段后写覆盖，键不丢）；
    // 顶层未知键同时登记进 topUnknown 载体——迁移时原位回文档顶层（「原位深保留」不挪窝），
    // 与 _extra 摊回的键相区分：legacy 项目的 _extra 键留在 _extra，canonical 原生键回顶层
    var topUnknown = {};
    function spreadUnknown(obj) {
      Object.keys(obj).forEach(function (k) {
        if (k === '_extra') { if (isObj(obj._extra)) Object.keys(obj._extra).forEach(function (k2) { content[k2] = clone(obj._extra[k2]); }); return; }
        if (KNOWN_TOP_KEYS.indexOf(k) < 0) { content[k] = clone(obj[k]); topUnknown[k] = clone(obj[k]); }
      });
    }
    var KNOWN_TOP_KEYS = ['schemaVersion', 'projectId', 'name', 'durationMs', 'timing', 'stage', 'performers', 'tracks', 'lyrics', 'markers', 'capabilities', 'timelineRevision', 'metadata', 'view', '_extra'];
    spreadUnknown(doc);
    // 泳道投影的准入判定（六轨无损）：只有「启用的 motion/lyrics 轨且归属现存舞者」才走泳道；
    // 其余轨（ability/movement/facing/cue、悬空轨、停用轨）整体冻结进 _doc.extraTracks 原样往返
    function laneProjected(t) {
      if (!isObj(t) || t.enabled === false) return false;
      if (t.type !== 'motion' && t.type !== 'lyrics') return false;
      return (doc.performers || []).some(function (p) { return isObj(p) && p.id === t.performerId; });
    }
    var extraTracks = [];
    var dancers = (doc.performers || []).map(function (p, i) {
      var d = {
        id: i, name: p.name, color: p.color,
        switchClips: [], actionClips: [], lyricClips: [],
        currentJob: p.job === undefined ? null : p.job,
        collapsed: !!(p.view && p.view.collapsed), laneScale: (p.view && p.view.laneScale) || 1,
        solo: !!(p.view && p.view.solo), mute: !!(p.view && p.view.mute),
      };
      if (p.notes) d.notes = p.notes;             // 规范 notes 非空时随舞者往返（空串不添键，旧投影形状不变）
      if (isObj(p.start)) d.start = clone(p.start); // 规范出场点（§5）随舞者往返
      if (typeof p.profileId === 'string' && p.profileId) d.profileId = p.profileId; // 角色档案绑定（CHARACTER-ASSETS-P1）同名键随舞者往返
      if (p._extra) Object.keys(p._extra).forEach(function (k) { d[k] = clone(p._extra[k]); });
      (doc.tracks || []).forEach(function (t) {
        if (!isObj(t) || t.performerId !== p.id || t.enabled === false) return;
        if (t.type === 'motion') t.events.forEach(function (ev) {
          if (ev.enabled === false) return; // 停用事件不回投影（旧格式没有停用语义）
          if (ev.legacyLane === 'switch') d.switchClips.push(eventToClip(ev, nextNum, 'motion', 'switch'));
          else if (ev.legacyLane === 'action') d.actionClips.push(eventToClip(ev, nextNum, 'motion', 'action'));
        });
        else if (t.type === 'lyrics') t.events.forEach(function (ev) {
          if (ev.enabled === false) return;
          if (ev.legacyLane === 'lyric') d.lyricClips.push(eventToClip(ev, nextNum, 'lyrics', 'lyric'));
        });
      });
      return d;
    });
    // 文档原生事件（无 legacyLane）的兜底：motion 轨进 actionClips、lyrics 轨进 lyricClips，
    // 规范字段经 _doc 载体随 clip 往返（接线增量再收窄契约）
    (doc.tracks || []).forEach(function (t) {
      if (!isObj(t) || t.enabled === false) return;
      if (t.type !== 'motion' && t.type !== 'lyrics') return;
      var pi = -1;
      (doc.performers || []).forEach(function (p, i) { if (p.id === t.performerId) pi = i; });
      if (pi < 0) return;
      t.events.forEach(function (ev) {
        if (!isObj(ev) || ev.enabled === false || ev.legacyLane) return;
        if (t.type === 'motion') dancers[pi].actionClips.push(eventToClip(ev, nextNum, 'motion', 'action'));
        else dancers[pi].lyricClips.push(eventToClip(ev, nextNum, 'lyrics', 'lyric'));
      });
    });
    (doc.tracks || []).forEach(function (t) { if (!laneProjected(t)) extraTracks.push(clone(t)); });
    // 泳道轨元数据冻结：仅当轨 id/locked/notes 与「重建默认值」不同才记（默认轨不添载体，旧投影形状不变）。
    // 同一舞者同一类型多条泳道轨会被投影合并进同一泳道（既有语义），此处按 doc 顺序逐轨记录，
    // 重建时按队列消费——单轨/泳道的常规形状逐字节还原
    var laneTracksMeta = [];
    var perfIndex = {};
    (doc.performers || []).forEach(function (p, i) { if (isObj(p) && p.id !== undefined) perfIndex[p.id] = i; });
    (doc.tracks || []).forEach(function (t) {
      if (!laneProjected(t)) return;
      var defId = 'tr-' + perfIndex[t.performerId] + '-' + t.type;
      if (t.id === defId && t.locked !== true && !t.notes) return;
      laneTracksMeta.push({ id: t.id, type: t.type, performerId: t.performerId, locked: t.locked === true, notes: strOr(t.notes, '') });
    });
    var carr = laneTracksMeta.length ? { laneTracks: laneTracksMeta } : {};
    // 原生演员 ID 是 X1 绑定与目标观察的稳定键，不能在投影保存时按数组位置重新命名。
    // 只有旧投影重建不了的 ID 才进入载体；纯旧 actor-N 数据不增加字段。
    var performerIds = {};
    (doc.performers || []).forEach(function (p, i) { if (p.id !== 'actor-' + i) performerIds[String(i)] = p.id; });
    if (Object.keys(performerIds).length) carr.performerIds = performerIds;
    content.dancers = dancers;
    content.globalLyrics = (doc.lyrics || []).filter(function (ev) { return ev.enabled !== false; })
      .map(function (ev) { return eventToClip(ev, nextNum, 'lyrics', 'globalLyric'); });
    content.dancerCount = dancers.length;
    content.showLyricMacro = !!(doc.view && doc.view.showLyricMacro);
    content.totalDuration = fromIntMs(doc.durationMs);
    content.markers = (doc.markers || []).map(function (m) {
      var mk = { id: m.id, t: fromIntMs(m.tMs), name: m.name };
      if (m._extra) Object.keys(m._extra).forEach(function (k) { mk[k] = clone(m._extra[k]); });
      return mk;
    });
    // 文档段载体（六轨无损）：只冻结「迁移重建不出来」的部分——默认段/空段不进载体，
    // 旧项目的投影形状与内容保持字节不变；_doc 整体为空时不添键
    if (!eqJson(doc.timing, { bpmMap: [], timeSignatureMap: [], audioOffsetMs: 0, countInBars: 0, snapMode: 'time', audioRef: null })) carr.timing = clone(doc.timing);
    if (!eqJson(doc.stage, { originCalibrated: false, stageYawDeg: 0 })) carr.stage = clone(doc.stage);
    if ((doc.capabilities || []).length || (Object.prototype.hasOwnProperty.call(doc, 'x1') && !Array.isArray(doc.capabilities)))
      carr.capabilities = clone(doc.capabilities);
    if (!eqJson(doc.metadata, { createdWith: MODULE_TAG, migratedFrom: 'project', notes: '' })) carr.metadata = clone(doc.metadata);
    if (!eqJson(doc.view, { showLyricMacro: !!(doc.view && doc.view.showLyricMacro) })) carr.view = clone(doc.view);
    if (Object.keys(topUnknown).length) carr.topUnknown = topUnknown; // 原位未知顶层键（与 _extra 摊回键分流）
    if (isInt(doc.schemaVersion) && doc.schemaVersion > SCHEMA_VERSION) carr.schemaVersion = doc.schemaVersion; // 未来版本只升不降（§15）
    if (extraTracks.length) carr.extraTracks = extraTracks;
    if (Object.keys(carr).length) content._doc = carr;
    return content;
  }

  // ---------- 修订号与确定性序列化 ----------
  function bumpTimelineRevision(doc) {
    if (!isObj(doc)) throw ChoreoDocumentError('E_NOT_OBJECT', '演出文档必须是 JSON 对象');
    doc.timelineRevision = (isInt(doc.timelineRevision) ? doc.timelineRevision : 0) + 1;
    return doc.timelineRevision;
  }
  // 确定性序列化：递归按键名（UTF-16 码元序）排序后紧凑输出——同一文档字节恒定
  function canonicalize(x) {
    if (Array.isArray(x)) return x.map(canonicalize);
    if (isObj(x)) {
      var out = {};
      Object.keys(x).sort().forEach(function (k) { out[k] = canonicalize(x[k]); });
      return out;
    }
    return x;
  }
  function serialize(doc) { return JSON.stringify(canonicalize(doc)); }
  function parse(text) {
    var v;
    try { v = JSON.parse(text); } catch (e) { throw ChoreoDocumentError('E_PARSE', '文件不是有效的 JSON：' + e.message); }
    return ensureDocument(v);
  }

  var API = {
    SCHEMA_VERSION: SCHEMA_VERSION, MODULE_TAG: MODULE_TAG,
    TRACK_TYPES: TRACK_TYPES, EVENT_KINDS: EVENT_KINDS, KNOWN_CAPABILITIES: KNOWN_CAPABILITIES,
    KNOWN_CONTENT_KEYS: KNOWN_CONTENT_KEYS, // 迁移层已知 content 键（docwire 的同名清单 + _doc；测试锁定差集）
    ChoreoDocumentError: ChoreoDocumentError,
    newId: newId,
    create: create, fromDraft: fromDraft, fromProject: fromProject,
    ensureDocument: ensureDocument, normalize: normalize, validate: validate,
    toLegacyContent: toLegacyContent,
    bumpTimelineRevision: bumpTimelineRevision,
    serialize: serialize, parse: parse,
    // 测试注入口：暴露内部纯函数（node 单测用；产品代码别绕过入口直接调）
    _internal: { migrateContent: migrateContent, clipToEvent: clipToEvent, eventToClip: eventToClip, docCarrierOf: docCarrierOf, splitUnknown: splitUnknown, canonicalize: canonicalize, toIntMs: toIntMs, fromIntMs: fromIntMs },
  };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoDocument = API;
})();
