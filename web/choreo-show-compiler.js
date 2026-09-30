/* choreo-show-compiler.js —— ShowCompiler：规范演出文档 → 演出包（EXEC-CORE 第一增量，纯逻辑层）
这个文件是干嘛的：
  设计文档（docs/DESIGN-game-executor.md §1）定死的执行流程：网页体检并编译 → 一次性上传演出包
  → 插件二次校验 → 玩家点击开始 → 插件本地时钟执行。本模块负责第一步：把规范演出文档
  （choreo-document.js 的 canonical document，自动识别旧项目/草稿输入）编译成插件演出包：
  整数毫秒、每条事件带演员归属、按 startMs+优先级排序、能力要求清单、确定性 projectHash。
  之后的插件侧二次校验在 C#（src/ShowValidator.cs），执行在 ShowRunner——本模块不插手。
口径约定（与插件两侧对齐，测试冻结）：
  - 输出协议 version 1（插件 ShowProtocol.SupportedVersion 同源）；事件字段只保留协议字段，
    迁移期保留字段（_extra/legacyLane/旧 data 块）绝不进包（设计文档 §15：编译器必须忽略）。
  - 命令取事件顶层 command（迁移事件由文档模块从旧 data.command 提升），再兜底 data.command；
    动作事件空命令只给警告——插件会用更精确的中文理由拒绝，不在这里重复判定。
  - X1 技能/路径/朝向必须携带完整的版本 1 输入和演员/舞台绑定；缺失时拒绝编译，原项目保留。
    能力要求同时声明 x1-input-v1；实际游戏观测与执行准入仍由插件判断。
  - 优先级排序与插件 EventScheduler.PriorityOf 一致：facing > movement > ability > motion > cue > lyrics。
  - 确定性：不取 Date.now/Math.random；hash 对规范化文档做 FNV-1a；同文档无论键序如何字节一致。
纯经典脚本（无 DOM/fetch/IndexedDB），node 单测：web\test-showcompiler.js。
*/
(function () {
  'use strict';

  var PROTOCOL_VERSION = 1;
  var MODULE_TAG = '0.7.1-execcore'; // compiler 标识（确定性常量，勿改成动态时间）
  var KIND_PRIORITY = { facing: 0, movement: 1, ability: 2, motion: 3, cue: 4, lyrics: 5 };
  var EXECUTABLE_KINDS = { motion: 1, ability: 1, movement: 1, facing: 1 }; // 会驱动角色/需要执行器
  var CAPABILITY_FOR_KIND = { ability: 'ability-execution', movement: 'movement-control', facing: 'movement-control' };

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.round(x) === x; }
  function intMs(v) { var n = typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; return n > 0 ? n : 0; }
  function strOr(v, dft) { return typeof v === 'string' ? v : (dft || ''); }

  // 键名排序的规范化（ChoreoDocument 不在场时的兜底；在场时优先用它的 serialize）
  function canonicalize(x) {
    if (Array.isArray(x)) return x.map(canonicalize);
    if (isObj(x)) {
      var out = {};
      Object.keys(x).sort().forEach(function (k) { out[k] = canonicalize(x[k]); });
      return out;
    }
    return x;
  }
  function canonicalJson(doc) {
    if (typeof window !== 'undefined' && window.ChoreoDocument) return window.ChoreoDocument.serialize(doc);
    if (typeof globalThis !== 'undefined' && globalThis.ChoreoDocument) return globalThis.ChoreoDocument.serialize(doc);
    return JSON.stringify(canonicalize(doc));
  }
  // FNV-1a 32 位：provenance 摘要（检测「是不是同一份文档编译的」），不是安全哈希
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function eventOf(ev, kind, performerId) {
    var command = strOr(ev.command, '');
    if (!command && isObj(ev.data)) command = strOr(ev.data.command, ''); // 迁移兜底（正常已被文档模块提升）
    var name = strOr(ev.name, isObj(ev.data) ? strOr(ev.data.name, '') : '');
    var out = {
      id: strOr(ev.id, ''),
      performerId: performerId,
      kind: kind,
      startMs: intMs(ev.startMs),
      durationMs: intMs(ev.durationMs),
      command: command,
      name: name,
      playMode: strOr(ev.playMode, kind === 'motion' ? 'once' : ''),
    };
    if (['ability', 'movement', 'facing'].indexOf(kind) >= 0) {
      // 不让通用的旧数据取整/补零逻辑修复正式执行输入。
      out.startMs = ev.startMs; out.durationMs = ev.durationMs;
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'x1')) out.x1 = ev.x1;
    return out;
  }

  /// 编译入口。input：规范文档 / WP-3 项目记录 {id,name,content} / 旧草稿（经文档模块自动识别迁移）。
  /// 返回 {ok, pkg, issues, docSource}；结构性不可能（可执行事件缺演员归属）才 ok:false。
  function compile(input) {
    var issues = [];
    var doc = input;
    var docSource = 'raw';
    var CD = (typeof window !== 'undefined' ? window.ChoreoDocument : globalThis.ChoreoDocument);
    var X1 = (typeof window !== 'undefined' ? window.ChoreoX1Inputs : globalThis.ChoreoX1Inputs);
    if (CD) {
      try {
        var ensured = CD.ensureDocument(input);
        doc = ensured.doc;
        docSource = ensured.source;
      } catch (e) {
        return { ok: false, pkg: null, docSource: 'invalid', issues: [{ level: 'error', code: 'E_INPUT', message: '无法识别的演出数据：' + (e && e.message ? e.message : e) }] };
      }
    }
    if (!isObj(doc)) return { ok: false, pkg: null, docSource: 'invalid', issues: [{ level: 'error', code: 'E_INPUT', message: '演出数据必须是 JSON 对象' }] };
    // 文档层会停用未知类型以保住文件；正式 X1 编译不能把它当成「用户明确停用」后静默漏项。
    (Array.isArray(doc.tracks) ? doc.tracks : []).forEach(function (track) {
      if (!isObj(track)) return;
      (Array.isArray(track.events) ? track.events : []).forEach(function (ev) {
        if (!isObj(ev) || !Object.prototype.hasOwnProperty.call(ev, 'x1')) return;
        if (KIND_PRIORITY[track.type] === undefined || KIND_PRIORITY[ev.kind] === undefined)
          issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 事件「' + (ev.id || '') + '」的轨道或事件类型未知，不能跳过后装载剩余内容' });
      });
    });

    var perfIds = Object.create(null);
    var performers = [];
    (Array.isArray(doc.performers) ? doc.performers : []).forEach(function (p) {
      if (!isObj(p) || typeof p.id !== 'string' || !p.id.trim()) {
        if (Object.prototype.hasOwnProperty.call(doc, 'x1')) issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 演员缺少明确身份，不能补造 ID' });
        return;
      }
      if (perfIds[p.id]) issues.push({ level: 'error', code: 'E_X1_INPUT', message: '演员 ID「' + p.id + '」重复，不能重命名后执行' });
      perfIds[p.id] = true;
      performers.push({ id: p.id, name: strOr(p.name, '') });
    });

    var events = [];
    var capsNeeded = {};
    var maxEnd = 0;
    var eventIds = Object.create(null);

    function pushEvent(ev, kind, performerId) {
      if (!isObj(ev)) return;
      if (KIND_PRIORITY[kind] === undefined) {
        issues.push({ level: 'warning', code: 'W_KIND_UNKNOWN', message: '未识别的事件类型「' + String(kind) + '」已跳过（不会编译进演出包）' });
        return;
      }
      if (ev.enabled === false) return; // 停用事件不编译
      var e = eventOf(ev, kind, performerId || '');
      if (ev.legacyLane === 'switch' || /^\s*\/(?:gs|gearset|job)(?:\s|$)/i.test(e.command)) {
        issues.push({ level: 'error', code: 'E_SWITCH_UNSUPPORTED', message: '切换条目「' + e.id + '」仍保留，但演出执行尚不支持装备套装切换；请保留项目并导出 /gs 宏供手动使用。旧 /job 须由用户明确填写套装编号。' });
      }
      if (!e.id) { issues.push({ level: 'error', code: 'E_EVENT_ID', message: '事件缺少稳定 id，请重新保存项目后再编译' }); return; }
      if (eventIds[e.id]) { issues.push({ level: 'error', code: 'E_EVENT_ID', message: '事件 ID「' + e.id + '」重复，不能登记执行输入' }); return; }
      eventIds[e.id] = true;
      if (['ability', 'movement', 'facing'].indexOf(kind) >= 0 || Object.prototype.hasOwnProperty.call(e, 'x1')) {
        try {
          if (!X1) throw new Error('缺少 X1 输入校验模块，请完整更新网页后重试');
          e.x1 = X1.snapshotEvent(kind, e.x1, e);
        } catch (err) { issues.push({ level: 'error', code: 'E_X1_INPUT', message: err.message }); }
      }
      if (EXECUTABLE_KINDS[kind] && !e.performerId) {
        issues.push({ level: 'error', code: 'E_NO_PERFORMER', message: '事件「' + e.id + '」属于需要执行器的类型（' + kind + '）但轨道没有归属舞者' });
      }
      if (e.performerId && !perfIds[e.performerId]) {
        issues.push({ level: 'error', code: 'E_ORPHAN_PERFORMER', message: '事件「' + e.id + '」指向不存在的舞者「' + e.performerId + '」（悬空引用，请重新保存项目后再编译）' });
      }
      if (kind === 'motion' && !e.command) {
        issues.push({ level: 'warning', code: 'W_EMPTY_COMMAND', message: '动作事件「' + e.id + '」没有命令（插件会拒绝装载，先补动作或删掉该条）' });
      }
      if (CAPABILITY_FOR_KIND[kind]) capsNeeded[CAPABILITY_FOR_KIND[kind]] = true;
      maxEnd = Math.max(maxEnd, e.startMs + e.durationMs);
      events.push(e);
    }

    (Array.isArray(doc.tracks) ? doc.tracks : []).forEach(function (track) {
      if (!isObj(track) || track.enabled === false) return; // 未识别/停用轨道不编译
      var pid = strOr(track.performerId, '');
      (Array.isArray(track.events) ? track.events : []).forEach(function (ev) {
        pushEvent(ev, isObj(ev) ? ev.kind : track.type, pid);
      });
    });
    (Array.isArray(doc.lyrics) ? doc.lyrics : []).forEach(function (ev) { pushEvent(ev, 'lyrics', ''); });
    var x1Package;
    var strictX1Capabilities = Object.prototype.hasOwnProperty.call(doc, 'x1') || events.some(function (e) { return ['ability', 'movement', 'facing'].indexOf(e.kind) >= 0; });
    if (strictX1Capabilities) {
      if (!Array.isArray(doc.capabilities)) issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 能力要求必须是数组，不能忽略错误的声明' });
      var declaredNames = Object.create(null);
      (Array.isArray(doc.capabilities) ? doc.capabilities : []).forEach(function (c) {
        if (!isObj(c) || Object.keys(c).sort().join(',') !== 'minProtocol,name' || typeof c.name !== 'string' || !c.name.trim() || !Number.isSafeInteger(c.minProtocol) || c.minProtocol < 1) {
          issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 每项能力必须完整声明 name 和正整数 minProtocol，不能补默认值或忽略未知字段' }); return;
        }
        if (declaredNames[c.name]) issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 能力「' + c.name + '」重复，不能合并后忽略冲突' });
        declaredNames[c.name] = true;
        if (['motion', 'cue', 'lyrics', 'movement-control', 'ability-execution', 'web-3d-preview', 'game-preview', 'x1-input-v1'].indexOf(c.name) < 0)
          issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 包声明未知能力「' + c.name + '」，不能忽略' });
        if (c.minProtocol > PROTOCOL_VERSION)
          issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 能力「' + c.name + '」要求版本 ' + c.minProtocol + '，当前只支持版本 ' + PROTOCOL_VERSION + '，不能降低要求' });
      });
    }
    var declaredX1 = (Array.isArray(doc.capabilities) ? doc.capabilities : []).filter(function (c) { return isObj(c) && c.name === 'x1-input-v1'; });
    if (declaredX1.length > 1 || declaredX1.some(function (c) { return Object.keys(c).sort().join(',') !== 'minProtocol,name' || c.minProtocol !== 1; }))
      issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 能力必须明确声明唯一的版本 1，不能降低要求或忽略未知字段' });
    if (Object.prototype.hasOwnProperty.call(doc, 'x1') || events.some(function (e) { return ['ability', 'movement', 'facing'].indexOf(e.kind) >= 0; })) {
      capsNeeded['x1-input-v1'] = true;
      try {
        if (!X1) throw new Error('缺少 X1 输入校验模块，请完整更新网页后重试');
        x1Package = X1.snapshotPackage(doc.x1, events);
      } catch (err) { issues.push({ level: 'error', code: 'E_X1_INPUT', message: err.message }); }
    }
    if (declaredX1.length && x1Package === undefined)
      issues.push({ level: 'error', code: 'E_X1_INPUT', message: 'X1 能力声明缺少对应的完整执行输入和绑定' });

    // 稳定排序：startMs 升序 → 优先级（与插件调度一致）→ 编译序
    events.forEach(function (e, i) { e._ord = i; });
    events.sort(function (a, b) {
      return a.startMs !== b.startMs ? a.startMs - b.startMs
        : (KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]) || (a._ord - b._ord);
    });
    events.forEach(function (e) { delete e._ord; });

    var capabilities = [];
    var capSeen = {};
    Object.keys(capsNeeded).sort().forEach(function (name) {
      capabilities.push({ name: name, minProtocol: 1 });
      capSeen[name] = true;
    });
    (Array.isArray(doc.capabilities) ? doc.capabilities : []).forEach(function (c) {
      if (!isObj(c) || !c.name) return;
      if (capSeen[c.name]) {
        if (strictX1Capabilities && Number.isSafeInteger(c.minProtocol) && c.minProtocol >= 1) {
          capabilities.forEach(function (derived) { if (derived.name === c.name) derived.minProtocol = Math.max(derived.minProtocol, c.minProtocol); });
        }
        return;
      }
      capSeen[c.name] = true;
      capabilities.push({ name: strOr(c.name), minProtocol: strictX1Capabilities ? c.minProtocol : (isInt(c.minProtocol) && c.minProtocol >= 1 ? c.minProtocol : 1) });
    });

    var durationMs = isInt(doc.durationMs) && doc.durationMs > 0 ? doc.durationMs : 0;
    if (maxEnd > durationMs) durationMs = maxEnd; // 事件必须落在声明时长里（插件会校验）

    var pkg = {
      protocolVersion: PROTOCOL_VERSION,
      compiler: MODULE_TAG,
      projectId: strOr(doc.projectId, ''),
      name: strOr(doc.name, ''),
      durationMs: durationMs,
      timelineRevision: isInt(doc.timelineRevision) && doc.timelineRevision >= 1 ? doc.timelineRevision : 1,
      projectHash: fnv1a(canonicalJson(doc)),
      performers: performers,
      events: events,
      capabilities: capabilities,
    };
    if (x1Package !== undefined) pkg.x1 = x1Package;
    var ok = !issues.some(function (i2) { return i2.level === 'error'; });
    return { ok: ok, pkg: pkg, issues: issues, docSource: docSource };
  }

  var API = { PROTOCOL_VERSION: PROTOCOL_VERSION, MODULE_TAG: MODULE_TAG, KIND_PRIORITY: KIND_PRIORITY, compile: compile };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoShowCompiler = API;
})();
