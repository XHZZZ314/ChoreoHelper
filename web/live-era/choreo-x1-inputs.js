// 校验并冻结正式 X1 输入；每项执行要求与身份都必须显式提供，不把网页声明当成游戏观测。
(function (root) {
  'use strict';
  var CAPABILITY = 'x1-input-v1';
  var CONDITIONS = ['jobMatches', 'levelMeets', 'targetValid', 'notCasting', 'cooldownReady', 'movementAllowed', 'controllable'];
  var KINDS = ['ability', 'movement', 'facing'];
  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function own(v, k) { return Object.prototype.hasOwnProperty.call(v, k); }
  function fail(label, why) { var e = new Error(label + '：' + why); e.code = 'E_X1_INPUT'; throw e; }
  function exact(v, keys, label) {
    if (!obj(v) || Object.keys(v).length !== keys.length || !keys.every(function (k) { return own(v, k); }))
      fail(label, '字段缺失或包含未知字段，不能猜测执行输入');
  }
  function str(v, label) {
    if (typeof v !== 'string' || !v.trim() || v.length > 256 || /[\x00-\x1f]/.test(v)) fail(label, '必须是明确的非空身份');
  }
  function finite(v, label, positive) {
    if (typeof v !== 'number' || !Number.isFinite(v) || (positive && v <= 0)) fail(label, positive ? '必须是有限正数' : '必须是有限数值');
  }
  function integer(v, label, min, max) {
    if (!Number.isSafeInteger(v) || v < min || v > max) fail(label, '必须是范围内的整数');
  }
  function decimal(v, label, max) {
    if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v) || v.length > max.length || (v.length === max.length && v > max))
      fail(label, '必须是无前导零的正十进制身份字符串');
  }
  function freeze(v) { if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { freeze(v[k]); }); Object.freeze(v); } return v; }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function validateEvent(kind, x, ev) {
    var label = '事件「' + (ev && ev.id || '') + '」X1';
    if (KINDS.indexOf(kind) < 0) { if (x !== undefined) fail(label, '这个事件类型不能携带 X1 执行输入'); return; }
    if (!obj(x)) fail(label, '缺少带版本的完整执行输入，请补齐后再装载');
    var keys = ['version', 'failurePolicy'];
    if (kind === 'ability') keys = keys.concat(['actionId', 'requiredJobId', 'requiredLevel', 'targetId', 'requiredConditions']);
    if (kind === 'movement') keys = keys.concat(['points', 'locomotion', 'arrivalToleranceM', 'maxCorrectionM']);
    var modes = { fixedAngle: ['fixedAngleDeg'], alongPath: [], transition: ['transitionFromDeg', 'transitionToDeg'],
      stageCenter: ['stageCenterX', 'stageCenterZ'], otherActor: ['otherActorTargetId'] };
    if (kind === 'facing') {
      if (!own(modes, x.mode)) fail(label, '未知朝向模式');
      keys = keys.concat(['mode'], modes[x.mode]);
    }
    exact(x, keys, label);
    if (x.version !== 1) fail(label, '只支持输入版本 1，不能忽略未来版本');
    if (x.failurePolicy !== 'skip' && x.failurePolicy !== 'stopShow') fail(label, '失败策略只支持 skip 或 stopShow，必须明确选择');
    str(ev.id, label + '事件 ID'); str(ev.performerId, label + '所属演员');
    integer(ev.startMs, label + '起点', 0, Number.MAX_SAFE_INTEGER);
    integer(ev.durationMs, label + '时长', kind === 'ability' ? 0 : 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(ev.startMs + ev.durationMs)) fail(label, '结束时刻超出整数范围');
    if (kind === 'ability') {
      decimal(x.actionId, label + '技能 ID', '2147483647');
      decimal(x.requiredJobId, label + '职业 ID', '4294967295');
      decimal(x.targetId, label + '目标 ID', '18446744073709551615');
      integer(x.requiredLevel, label + '等级要求', 1, 100);
      if (!Array.isArray(x.requiredConditions) || x.requiredConditions.length !== CONDITIONS.length ||
          !CONDITIONS.every(function (c) { return x.requiredConditions.indexOf(c) >= 0; }))
        fail(label, '必须声明全部七项运行时条件；不能提供满足值或省略未知条件');
    }
    if (kind === 'movement') {
      if (x.locomotion !== 'walk' && x.locomotion !== 'run') fail(label, '步态必须明确为 walk 或 run');
      finite(x.arrivalToleranceM, label + '到达容差', true); finite(x.maxCorrectionM, label + '修正上限', true);
      if (!Array.isArray(x.points) || x.points.length < 2 || x.points.length > 5000) fail(label, '路径必须包含 2 至 5000 个已采样路点');
      var last = -1;
      Array.from(x.points).forEach(function (p) {
        exact(p, ['tMs', 'x', 'z'], label + '路点'); integer(p.tMs, label + '路点时刻', 0, ev.durationMs);
        finite(p.x, label + '路点 x'); finite(p.z, label + '路点 z');
        if (p.tMs <= last) fail(label, '路点时刻必须严格递增'); last = p.tMs;
      });
      if (x.points[0].tMs !== 0 || last !== ev.durationMs) fail(label, '路径首尾时刻必须覆盖整个事件，不能补造路点');
    }
    if (kind === 'facing') modes[x.mode].forEach(function (k) {
      if (k === 'otherActorTargetId') str(x[k], label + '目标演员'); else finite(x[k], label + k);
    });
    if (kind === 'facing' && x.mode === 'transition' && !Number.isFinite(x.transitionToDeg - x.transitionFromDeg))
      fail(label, '过渡朝向的角度差超出有限范围');
    return x;
  }
  function validatePackage(x, events) {
    var active = events.filter(function (e) { return KINDS.indexOf(e.kind) >= 0; });
    events.forEach(function (e) { validateEvent(e.kind, e.x1, e); });
    if (x === undefined && !active.length) return;
    if (!active.length) fail('X1 整包输入', '没有对应技能、路径或朝向事件，不能装载空登记');
    exact(x, ['version', 'bindings'], 'X1 整包身份');
    if (x.version !== 1) fail('X1 整包身份', '只支持输入版本 1');
    if (!Array.isArray(x.bindings) || x.bindings.length < 1 || x.bindings.length > 64) fail('X1 整包身份', '必须提供明确演员绑定');
    var bindings = Object.create(null), actors = Object.create(null);
    Array.from(x.bindings).forEach(function (b) {
      exact(b, ['performerId', 'actorId', 'territoryId', 'stage'], 'X1 演员绑定');
      str(b.performerId, 'X1 演员 ID'); decimal(b.actorId, 'X1 游戏角色 ID', '18446744073709551615');
      integer(b.territoryId, 'X1 区域 ID', 1, 4294967295);
      exact(b.stage, ['id', 'originX', 'originZ', 'yawDeg'], 'X1 舞台身份'); str(b.stage.id, 'X1 舞台 ID');
      ['originX', 'originZ', 'yawDeg'].forEach(function (k) { finite(b.stage[k], 'X1 舞台 ' + k); });
      if (bindings[b.performerId] || actors[b.actorId]) fail('X1 演员绑定', '演员或游戏角色身份重复');
      bindings[b.performerId] = b; actors[b.actorId] = true;
    });
    active.forEach(function (e) {
      var b = bindings[e.performerId];
      if (!b) fail('事件「' + e.id + '」', '缺少所属演员的明确游戏角色和舞台绑定');
      function world(x, z) {
        var angle = (b.stage.yawDeg % 360) * Math.PI / 180;
        finite(x * Math.cos(angle) + z * Math.sin(angle) + b.stage.originX, 'X1 舞台到游戏 x 变换');
        finite(-x * Math.sin(angle) + z * Math.cos(angle) + b.stage.originZ, 'X1 舞台到游戏 z 变换');
      }
      if (e.kind === 'movement') e.x1.points.forEach(function (p, i, points) {
        world(p.x, p.z);
        if (i) { var dx = p.x - points[i - 1].x, dz = p.z - points[i - 1].z; finite(dx * dx + dz * dz, 'X1 路径段距离'); }
      });
      if (e.kind === 'facing' && e.x1.mode === 'stageCenter') world(e.x1.stageCenterX, e.x1.stageCenterZ);
      if (e.kind === 'facing' && e.x1.mode === 'otherActor') {
        var t = bindings[e.x1.otherActorTargetId];
        if (!t || t === b) fail('事件「' + e.id + '」', '他演员朝向需要另一个明确绑定的演员');
        if (t.territoryId !== b.territoryId || ['id', 'originX', 'originZ', 'yawDeg'].some(function (k) { return t.stage[k] !== b.stage[k]; }))
          fail('事件「' + e.id + '」', '目标演员必须属于同一区域和同一舞台变换');
      }
    });
    return x;
  }
  function checkCapabilities(pkg, caps) {
    if (!pkg || pkg.x1 === undefined) return { ok: true };
    var names = caps && caps.capabilities;
    if (!caps || caps.protocolVersion !== 1 || !Array.isArray(names) || names.indexOf(CAPABILITY) < 0)
      return { ok: false, code: 'E_X1_CAPABILITY', error: '当前插件未声明 X1 输入版本 1，不能发送技能、路径或朝向登记。' };
    return { ok: true };
  }
  root.ChoreoX1Inputs = { VERSION: 1, CAPABILITY: CAPABILITY, CONDITIONS: Object.freeze(CONDITIONS.slice()),
    isKind: function (kind) { return KINDS.indexOf(kind) >= 0; }, validateEvent: validateEvent, validatePackage: validatePackage,
    snapshotEvent: function (kind, x, ev) { validateEvent(kind, x, ev); return x === undefined ? undefined : freeze(copy(x)); },
    snapshotPackage: function (x, events) { validatePackage(x, events); return x === undefined ? undefined : freeze(copy(x)); },
    checkCapabilities: checkCapabilities };
})(typeof window !== 'undefined' ? window : globalThis);
