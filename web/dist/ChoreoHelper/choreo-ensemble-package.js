/* choreo-ensemble-package.js —— 从已编译演出中拆出单个演员内容，用 SHA-256 校验并冻结；不读素材或联网。 */
(function () {
  'use strict';
  var MAX_BYTES = 1048576, MAX_EVENTS = 5000;
  var KINDS = ['motion', 'ability', 'movement', 'facing', 'cue', 'lyrics'];
  var PACKAGE_KEYS = ['protocolVersion', 'compiler', 'projectId', 'name', 'durationMs', 'timelineRevision', 'projectHash', 'performers', 'events', 'capabilities'];
  var EVENT_KEYS = ['id', 'performerId', 'kind', 'startMs', 'durationMs', 'command', 'name', 'playMode'];
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function exact(v, keys, label) {
    if (!obj(v) || Object.keys(v).length !== keys.length || !keys.every(function (k) { return Object.prototype.hasOwnProperty.call(v, k); }))
      fail('shape', label + '字段不完整或含未知字段，请重新编译。');
  }
  function str(v, max, nonempty, label) {
    if (typeof v !== 'string' || v.length > max || (nonempty && !v.trim()) || /[\u0000]/.test(v)) fail('string', label + '无效。');
    return v;
  }
  function number(v, min, label) { if (!Number.isSafeInteger(v) || v < min) fail('number', label + '必须是有效整数。'); return v; }
  function actorId(v, empty) { str(v, 256, !empty, '演员 ID'); if (/[\x00-\x1f]/.test(v)) fail('actor', '演员 ID 含控制字符。'); return v; }
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (obj(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function freeze(v) { if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { freeze(v[k]); }); Object.freeze(v); } return v; }
  function utf8(text) {
    if (typeof TextEncoder === 'undefined') fail('crypto-unavailable', '当前浏览器缺少文本编码支持，请升级浏览器。');
    return new TextEncoder().encode(text);
  }
  function snapshot(v) {
    var text;
    try { text = JSON.stringify(v); } catch (e) { fail('shape', '演出内容无法序列化。'); }
    if (typeof text !== 'string' || utf8(text).length > MAX_BYTES) fail('size', '演出内容为空或超过 1 MiB 上限。');
    return JSON.parse(text);
  }
  async function sha256(value) {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.subtle || typeof c.subtle.digest !== 'function') fail('crypto-unavailable', '当前浏览器无法进行 SHA-256 校验，不能准备多人演出。');
    var bytes = utf8(canonical(value));
    if (bytes.length > MAX_BYTES) fail('size', '演出内容超过 1 MiB 上限。');
    var digest = new Uint8Array(await c.subtle.digest('SHA-256', bytes));
    return 'sha256:' + Array.prototype.map.call(digest, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function digest(value) { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value); }
  function validatePackage(p) {
    var hasX1 = Object.prototype.hasOwnProperty.call(p, 'x1');
    exact(p, hasX1 ? PACKAGE_KEYS.concat(['x1']) : PACKAGE_KEYS, '编译演出'); number(p.protocolVersion, 1, '协议版本');
    if (p.protocolVersion !== 1) fail('protocol', '目前多人拆分只支持演出协议 1，不能忽略新协议字段。');
    str(p.compiler, 128, true, '编译器'); str(p.projectId, 256, true, '项目 ID'); str(p.name, 256, false, '演出名称');
    str(p.projectHash, 128, false, '原项目摘要'); number(p.durationMs, 0, '演出时长'); number(p.timelineRevision, 1, '编排版本');
    if (!Array.isArray(p.performers) || p.performers.length < 1 || p.performers.length > 64) fail('performers', '演员列表无效。');
    var actors = Object.create(null), ids = Object.create(null);
    p.performers.forEach(function (a) {
      exact(a, ['id', 'name'], '演员'); actorId(a.id, false); str(a.name, 256, false, '演员名');
      if (actors[a.id]) fail('duplicate-actor', '演员 ID 重复。'); actors[a.id] = true;
    });
    if (!Array.isArray(p.events) || p.events.length > MAX_EVENTS) fail('events', '事件列表超过上限或格式无效。');
    p.events.forEach(function (e) {
      exact(e, Object.prototype.hasOwnProperty.call(e, 'x1') ? EVENT_KEYS.concat(['x1']) : EVENT_KEYS, '事件'); str(e.id, 256, true, '事件 ID'); actorId(e.performerId, true);
      if (ids[e.id]) fail('duplicate-event', '事件 ID 重复。'); ids[e.id] = true;
      if (KINDS.indexOf(e.kind) < 0) fail('kind', '演出包含未知事件类型。');
      if (e.performerId ? !actors[e.performerId] : ['cue', 'lyrics'].indexOf(e.kind) < 0) fail('actor', '事件演员归属无效。');
      number(e.startMs, 0, '事件起点'); number(e.durationMs, 0, '事件时长');
      if (!Number.isSafeInteger(e.startMs + e.durationMs) || e.startMs + e.durationMs > p.durationMs) fail('time', '事件超出演出时长。');
      str(e.command, 4096, false, '命令'); str(e.name, 4096, false, '事件名'); str(e.playMode, 64, false, '播放方式');
    });
    if (!Array.isArray(p.capabilities) || p.capabilities.length > 64) fail('capabilities', '能力要求无效。');
    var caps = Object.create(null);
    p.capabilities.forEach(function (c) {
      exact(c, ['name', 'minProtocol'], '能力'); str(c.name, 128, true, '能力名称'); number(c.minProtocol, 1, '能力协议');
      if (caps[c.name]) fail('capabilities', '能力要求重复。'); caps[c.name] = true;
    });
    if (caps['x1-input-v1'] && !hasX1) fail('x1-capability', 'X1 能力声明缺少对应的完整执行输入和绑定。');
    if (hasX1 || p.events.some(function (e) { return ['ability', 'movement', 'facing'].indexOf(e.kind) >= 0 || Object.prototype.hasOwnProperty.call(e, 'x1'); })) {
      var X1 = (typeof window !== 'undefined' ? window : globalThis).ChoreoX1Inputs;
      if (!X1) fail('x1-module', '缺少 X1 输入校验模块，请完整更新网页。');
      X1.validatePackage(p.x1, p.events);
      if (!caps[X1.CAPABILITY] || !p.capabilities.some(function (c) { return c.name === X1.CAPABILITY && c.minProtocol === 1; }))
        fail('x1-capability', '演出必须声明 X1 输入版本 1 的能力要求。');
    }
    return p;
  }
  function bodyOf(e) {
    return { ensembleProtocolVersion: e.ensembleProtocolVersion, actorId: e.actorId,
      includeGlobalLyrics: e.includeGlobalLyrics, includeGlobalCues: e.includeGlobalCues,
      source: e.source, package: e.package };
  }
  function validateEnvelope(e) {
    exact(e, ['ensembleProtocolVersion', 'actorId', 'includeGlobalLyrics', 'includeGlobalCues', 'source', 'package', 'digest'], '多人演出');
    if (e.ensembleProtocolVersion !== 1) fail('protocol', '多人演出协议不兼容。');
    str(e.actorId, 256, true, '演员 ID');
    if (typeof e.includeGlobalLyrics !== 'boolean' || typeof e.includeGlobalCues !== 'boolean') fail('global-choice', '必须明确选择是否发送原歌词及公共提示。');
    if (!digest(e.digest)) fail('digest', '多人演出摘要无效。');
    exact(e.source, ['projectId', 'timelineRevision', 'compiledDigest'], '来源身份');
    if (!digest(e.source.compiledDigest)) fail('digest', '完整编排摘要无效。');
    validatePackage(e.package);
    if (e.source.projectId !== e.package.projectId || e.source.timelineRevision !== e.package.timelineRevision) fail('source', '多人演出的来源版本不一致。');
    if (e.package.performers.length !== 1 || e.package.performers[0].id !== e.actorId) fail('actor', '多人演出只能属于指定的一位演员。');
    e.package.events.forEach(function (ev) {
      if (ev.performerId && ev.performerId !== e.actorId) fail('foreign-event', '多人演出混入了其他演员的事件。');
      if (!ev.performerId && ((ev.kind === 'lyrics' && !e.includeGlobalLyrics) || (ev.kind === 'cue' && !e.includeGlobalCues)))
        fail('global-choice', '多人演出包含本人未选择发送的原歌词或公共提示。');
    });
    return e;
  }
  function failure(e) { return { ok: false, code: e && e.code || 'invalid', error: e && e.message || '演出校验失败。' }; }
  async function create(compiled, options) {
    try {
      // 在第一个 await 之前复制并校验，避免编排在哈希计算途中变化。
      var p = validatePackage(snapshot(compiled)); options = snapshot(options);
      if (!obj(options) || typeof options.includeGlobalLyrics !== 'boolean') fail('global-choice', '请本人明确选择是否发送歌曲原歌词。');
      var actorId = str(options.actorId, 256, true, '演员 ID'), actor = p.performers.find(function (a) { return a.id === actorId; });
      if (!actor) fail('actor', '这份编排没有指定的演员。');
      var hasGlobalCue = p.events.some(function (e) { return !e.performerId && e.kind === 'cue'; });
      if ((hasGlobalCue || options.includeGlobalCues !== undefined) && typeof options.includeGlobalCues !== 'boolean') fail('global-cue-choice', '编排包含公共提示，请明确选择是否执行。');
      var cues = options.includeGlobalCues === true, lyrics = options.includeGlobalLyrics;
      var sourceDigest = await sha256(p);
      var ownPackage = Object.assign({}, p, { performers: [actor], events: p.events.filter(function (e) {
        return e.performerId === actorId || (!e.performerId && ((e.kind === 'lyrics' && lyrics) || (e.kind === 'cue' && cues)));
      }) });
      validatePackage(ownPackage); // 拆分后的事件/绑定关系也必须成立，不能输出只能靠丢参数通过的包。
      // 保留原编译包所有声明的能力；当前编译器尚未区分全局要求与按演员推导的要求，不能静默削弱。
      var body = { ensembleProtocolVersion: 1, actorId: actorId, includeGlobalLyrics: lyrics, includeGlobalCues: cues,
        source: { projectId: p.projectId, timelineRevision: p.timelineRevision, compiledDigest: sourceDigest }, package: ownPackage };
      var result = Object.assign({}, body, { digest: await sha256(body) });
      return { ok: true, envelope: freeze(result), digest: result.digest, package: result.package };
    } catch (e) { return failure(e); }
  }
  async function verify(envelope, expected) {
    try {
      var e = validateEnvelope(snapshot(envelope)), want = expected == null ? {} : snapshot(expected);
      if (!obj(want)) fail('expected', '本机待校验的演出身份无效。');
      if (want.actorId !== undefined && want.actorId !== e.actorId) fail('actor', '这份演出分配给其他演员。');
      if (want.digest !== undefined && want.digest !== e.digest) fail('digest', '演出内容与本机确认的版本不同。');
      if (want.sourceDigest !== undefined && want.sourceDigest !== e.source.compiledDigest) fail('source', '演员演出不属于已确认的完整编排。');
      if (await sha256(bodyOf(e)) !== e.digest) fail('tampered', '演出校验失败：内容已改变，请重新准备。');
      return { ok: true, envelope: freeze(e), digest: e.digest, package: e.package };
    } catch (e) { return failure(e); }
  }
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoEnsemblePackage = { VERSION: 1, MAX_BYTES: MAX_BYTES, create: create, verify: verify, isDigest: digest };
})();
