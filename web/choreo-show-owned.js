// 管理单机 X1 演出装载身份与定向生命周期；晚回包不能重新采用已取消场次，未知失败保留停止重试。
(function (root) {
  'use strict';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var ID = /^[0-9a-f]{32}$/;
  function must(v, message) { if (!v) throw new Error(message); }
  function create(options) {
    var api = options.api, randomUUID = options.randomUUID, now = options.now;
    var owned = null, loading = false, generation = 0, lastStop = null, recovering = false, cleanupBlocked = false;
    function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    function read(path) { return api(path, { timeoutMs: 5000 }); }
    function current(a) { must(owned === a && !a.cancelling, '本次演出已取消或改变，已忽略迟到回包。'); }
    function nonce() { var n = randomUUID(); must(typeof n === 'string' && UUID.test(n), '无法生成明确的演出请求身份。'); return n; }
    function identity(n) { return typeof n === 'string' && ID.test(n); }
    async function load(pkg, expectedInstanceId) {
      must(!owned && !loading && !recovering && !cleanupBlocked, '上次演出装载尚未安全停止，请先重新连接检查，或重试停止。');
      loading = true; lastStop = null; var ticket = ++generation;
      try {
        var snapshot = JSON.parse(JSON.stringify(pkg));
        root.ChoreoX1Inputs.validatePackage(snapshot.x1, snapshot.events);
        var caps = await read('/capabilities');
        must(!expectedInstanceId || caps.pluginInstanceId === expectedInstanceId, '审阅后插件会话已变化，请重新连接并审阅，未发送登记。');
        var capability = root.ChoreoX1Inputs.checkCapabilities(snapshot, caps);
        must(capability.ok, capability.error);
        must(caps && Array.isArray(caps.capabilities) && ['ownedShowLoadV1', 'scheduledStartV1'].every(function (c) { return caps.capabilities.indexOf(c) >= 0; }), '插件缺少定向装载或预约开演能力，请更新并重载。');
        var state = await Promise.all([read('/shows/clock'), read('/playback/status')]);
        must(state[0] && ['idle', 'loaded', 'completed', 'stopped'].indexOf(state[0].state) >= 0 &&
          state[1] && state[1].playing === false, '游戏里已有演出或预览，或无法确认空闲，不能准备 X1。');
        must(ticket === generation, '本次准备已取消，没有发送装载。');
        var attempt = owned = { instanceId: caps.pluginInstanceId || '', clientLoadId: nonce(), packageId: '', armId: '', startId: '', cancelling: false, arming: false, starting: false, stopping: null };
        var loaded;
        try { loaded = await post('/shows/load', Object.assign({ protocolVersion: 1, clientLoadId: attempt.clientLoadId, onlyIfIdle: true, package: snapshot },
          caps.pluginInstanceId ? {pluginInstanceId:caps.pluginInstanceId} : {})); }
        catch (error) {
          // 后端仅在 nonce 已封存、保证不能迟到采用时签回 noMutation；HTTP 错误码本身不证明零写入。
          if (owned === attempt && error && error.body && error.body.noMutation === true && error.body.clientLoadId === attempt.clientLoadId) {
            owned = null; error.noMutation = true;
          }
          throw error;
        }
        current(attempt);
        must(loaded && loaded.state === 'loaded' && loaded.clientLoadId === attempt.clientLoadId && identity(loaded.packageId), '插件未确认本次装载身份，请停止后重试。');
        attempt.packageId = loaded.packageId;
        return loaded;
      } finally { loading = false; }
    }
    async function arm() {
      var a = owned;
      must(a && !a.cancelling && a.packageId && !a.armId && !a.arming, '本次演出尚未装载、已就绪或正在处理，请先确认状态。');
      a.arming = true;
      try {
        var result = await post('/shows/arm-owned', { protocolVersion: 1, clientLoadId: a.clientLoadId, packageId: a.packageId });
        current(a);
        must(result && result.state === 'armed' && result.clientLoadId === a.clientLoadId && result.packageId === a.packageId && identity(result.armId), '插件未确认本次就绪身份，请停止后重试。');
        a.armId = result.armId; return result;
      } finally { a.arming = false; }
    }
    async function start(countdownMs) {
      var a = owned;
      must(a && !a.cancelling && a.armId && !a.startId && !a.starting, '本次演出尚未就绪或已经预约，不能重复开始。');
      must(Number.isSafeInteger(countdownMs) && countdownMs >= 1500 && countdownMs <= 10000, '倒计时时间无效。');
      a.starting = true;
      try {
        var sent = now(), clock = await read('/shows/clock'), elapsed = now() - sent;
        current(a);
        must(Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 1000, '本机计时回复过慢，请重新开始。');
        must(clock && clock.protocolVersion === 1 && clock.state === 'armed' && clock.clientLoadId === a.clientLoadId &&
          clock.packageId === a.packageId && clock.armId === a.armId && Number.isSafeInteger(clock.serverMonoMs) && clock.serverMonoMs >= 0,
        '插件时钟或演出身份已改变，不能预约旧场次。');
        var deadline = Math.round(clock.serverMonoMs + elapsed + countdownMs);
        must(Number.isSafeInteger(deadline), '插件时钟超出有效范围。');
        a.startId = nonce();
        var result = await post('/shows/schedule', { protocolVersion: 1, packageId: a.packageId, armId: a.armId, startId: a.startId, deadlineMonoMs: deadline });
        current(a);
        must(result && result.state === 'countdown' && result.packageId === a.packageId && result.armId === a.armId && result.startId === a.startId,
          '插件未确认本次预约身份，请停止后重试。');
        return result;
      } finally { a.starting = false; }
    }
    function stop() {
      var a = owned; generation++;
      if (!a) return Promise.resolve(lastStop || { state: 'stopped', safe: true, noMutation: true });
      a.cancelling = true;
      if (a.stopping) return a.stopping;
      var body = { protocolVersion: 1, clientLoadId: a.clientLoadId };
      if (a.packageId) body.packageId = a.packageId;
      if (a.armId) body.armId = a.armId;
      a.stopping = post('/shows/stop-owned', body).then(function (result) {
        must(result && result.state === 'stopped' && result.safe === true && typeof result.matchedCurrent === 'boolean' && result.clientLoadId === a.clientLoadId,
          '插件尚未确认本次演出安全停止，请重试停止。');
        if (owned === a) { owned = null; lastStop = result; cleanupBlocked = false; }
        return result;
      }).finally(function () { a.stopping = null; });
      return a.stopping;
    }
    async function reconnect() {
      must(!loading && !recovering, '登记或连接检查正在处理，请勿重复操作。');
      recovering = true; var ticket = generation, a = owned;
      try {
        var caps = await read('/capabilities');
        must(caps.app === 'ChoreoHelper' && caps.protocolVersion === 1 && typeof caps.pluginInstanceId === 'string' && caps.pluginInstanceId && Array.isArray(caps.capabilities) && caps.capabilities.includes('stageRecoveryV1'), '插件版本或恢复能力不匹配，请更新并重载；旧登记未被清除。');
        var values = await Promise.all([read('/shows/status'), read('/x1/status'), read('/playback/status'), read('/shows/clock')]);
        var end = await read('/capabilities');
        must(ticket === generation && owned === a && caps.pluginInstanceId === end.pluginInstanceId, '连接检查期间会话或请求变化，旧回包已失效，请重新连接。');
        var show=values[0], input=values[1], playback=values[2], clock=values[3], output=input.outputOwnership;
        if(show.cleanupFailed || input.cleanupFailed || output?.previewCleanupFailed || ['coordinateFeedback','cameraPreparation','automaticPreparation','referenceDiagnostic'].some(k=>input[k]?.cleanupFailed)) cleanupBlocked=true;
        must(!cleanupBlocked, '清理失败尚未确认；请明确重试立即停止，不能按普通断线绕过。');
        var busy = !['idle','loaded','completed','stopped','faulted'].includes(show.state) || playback.playing !== false || input.stageRequestPending !== false ||
          input.unconfirmedHeldKeys !== false || !output || output.inputLeaseHeld !== false || output.exclusiveOwner != null || output.legacyLeases !== 0 ||
          ['coordinateFeedback','cameraPreparation','automaticPreparation','referenceDiagnostic'].some(k=>!input[k] || input[k].active || input[k].ownsInput);
        var changed=!!(a && a.instanceId && a.instanceId!==caps.pluginInstanceId);
        if(changed) {
          must(!busy && input.executionEnabled === false, '插件会话已变化，但执行或输入仍在进行；旧登记保留，不自动停止或接管。');
          generation++; owned=null; lastStop=null;
        }
        return {caps,show,input,clock,busy,changed,owned:!!owned};
      } finally { recovering=false; }
    }
    async function stopStage() {
      var a=owned, ticket=generation;
      if(!a) return stop();
      // 原网页登记与游戏内明确确认是不同身份；只沿当前映射定向停止，旧 nonce 的语义不变。
      var snapshot=await reconnect();
      if(snapshot.changed) return {safe:true,changed:true,matchedCurrent:false};
      must(owned===a && ticket===generation,'停止检查期间请求已变化，未停止新场次。');
      var mapping=snapshot.show.stageMapping;
      if(mapping && mapping.sourcePackageId===a.packageId && mapping.sourceClientLoadId===a.clientLoadId){
        must(snapshot.clock.packageId===mapping.packageId && snapshot.clock.clientLoadId===mapping.clientLoadId,'映射与当前登记身份不匹配，未停止其他场次。');
        must(identity(mapping.packageId) && UUID.test(mapping.clientLoadId),'映射身份无效，未发送停止。');
        a.cancelling=true; generation++;
        owned=Object.assign({},a,{packageId:mapping.packageId,clientLoadId:mapping.clientLoadId,armId:'',cancelling:false,stopping:null});
      }
      return stop();
    }
    return { load: load, arm: arm, start: start, stop: stop, stopStage: stopStage, reconnect: reconnect,
      cancelLocal: function () { generation++; if (owned) owned.cancelling = true; },
      confirmGlobalStop: function () { generation++; if (owned && owned.cancelling) owned = null; cleanupBlocked=false; },
      active: function () { return loading || owned !== null; },
      state: function () { return { generation: generation, loading: loading, owned: !!owned, cancelling: !!(owned && owned.cancelling),
        instanceId: owned && owned.instanceId || '', clientLoadId: owned && owned.clientLoadId || '', cleanupBlocked: cleanupBlocked,
        packageId: owned && owned.packageId || '', armId: owned && owned.armId || '' }; } };
  }
  root.ChoreoShowOwned = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
