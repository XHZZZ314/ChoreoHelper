// 将双人直连界面接入当前项目和本机配对接口；准备期间阻止其他网页功能抢占游戏。
(function (root) {
  'use strict';
  var panel = null, locked = false, activeWrites = 0, ownedLoad = null, loading = false, loadGeneration = 0;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, ID = /^[0-9a-f]{32}$/;
  var originalGameApi = ChoreoAPI.game.api;
  function must(value, message) { if (!value) throw new Error(message); }
  function blocked() { return new Error('本机已为双人演出准备，请先在双人面板停止本机演出。'); }
  function guard(fn, preview) {
    return function (path, options) {
      var endpoint = new URL(String(path), 'http://127.0.0.1').pathname.toLowerCase();
      var writing = preview || endpoint === '/debug/poke' || options && String(options.method || 'GET').toUpperCase() === 'POST';
      if (!writing || path === '/auth/session' || endpoint === '/control/stop') return fn.apply(this, arguments);
      if (locked) return Promise.reject(blocked());
      activeWrites++;
      var value;
      try { value = fn.apply(this, arguments); } catch (error) { activeWrites--; throw error; }
      return Promise.resolve(value).finally(function () { activeWrites--; });
    };
  }
  ChoreoAPI.game.api = guard(ChoreoAPI.game.api);
  ChoreoAPI.game.preview = guard(ChoreoAPI.game.preview, true);
  ChoreoAPI.game.raw = guard(ChoreoAPI.game.raw);
  ChoreoAPI.export.api = guard(ChoreoAPI.export.api);
  ChoreoAPI.export.raw = guard(ChoreoAPI.export.raw);
  ChoreoAPI.export.rawUrl = guard(ChoreoAPI.export.rawUrl);
  root.__choreoGameControlLocked = function () { return locked; };
  function busy() {
    return activeWrites > 0 || store.isPlaying || typeof _recRunning !== 'undefined' && _recRunning ||
      typeof _verRunning !== 'undefined' && _verRunning;
  }
  function read(path) { return originalGameApi(path, { timeoutMs: 5000 }); }
  function post(path, body) {
    return originalGameApi(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), timeoutMs: 6000 });
  }
  function compileCurrent() {
    var compiled = ChoreoShowCompiler.compile(projectRecord());
    if (!compiled.ok) {
      var error = compiled.issues.find(function (i) { return i.level === 'error'; });
      throw new Error(error ? error.message : '当前编排无法用于演出。');
    }
    return compiled.pkg;
  }
  function cancelLocalLoad() { loadGeneration++; if (ownedLoad) ownedLoad.cancelling = true; }
  root.ensembleStopNow = function (musicResult) {
    if (!panel) { cancelLocalLoad(); return Promise.resolve(); }
    return panel.stop({ audioStopResult: musicResult && musicResult.ensembleResult }).then(function () {
      must(!panel.getState().locked, "双人演出停止尚未确认，请重试");
    });
  };
  root.openEnsemblePanel = function () {
    if (!panel) panel = ChoreoEnsembleUI.create({
      getCompiledProject: compileCurrent, getBusy: busy,
      music: root.ChoreoMusicUI && root.ChoreoMusicUI.ensemble,
      onLockChange: function (value) { locked = value; },
      onCancelLocal: cancelLocalLoad,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      api: {
        load: async function (pkg) {
          must(!ownedLoad && !loading, '上次装载尚未安全取消，请先重试本机停止。');
          loading = true; var generation = loadGeneration;
          try {
            try {
              var caps = await read('/capabilities');
              must(generation === loadGeneration, '本次准备已取消，没有发送装载。');
              if (!caps || caps.protocolVersion !== 1 || !Array.isArray(caps.capabilities) ||
                  caps.capabilities.indexOf('scheduledStartV1') < 0 || caps.capabilities.indexOf('ownedShowLoadV1') < 0)
                throw new Error('游戏插件需要更新并重载，才支持双人定时开演。');
              if (pkg && pkg.x1 !== undefined) {
                must(root.ChoreoX1Inputs, 'X1 输入校验模块未加载，请保存项目后重新打开页面。');
                var inputCapability = root.ChoreoX1Inputs.checkCapabilities(pkg, caps);
                must(inputCapability.ok, inputCapability.error);
              }
              var states = await Promise.all([read('/shows/clock'), read('/playback/status')]);
              must(generation === loadGeneration, '本次准备已取消，没有发送装载。');
              if (!states[0] || !states[1] || typeof states[1].playing !== 'boolean' || !states[0].state)
                throw new Error('无法确认游戏当前是否空闲，请检查插件连接。');
              if (['idle', 'loaded', 'completed', 'stopped'].indexOf(states[0].state) < 0 || states[1].playing === true)
                throw new Error('游戏里已有演出或预览，请先停止后再准备双人演出。');
              var nonce = root.crypto.randomUUID();
              must(UUID.test(nonce), '无法生成本次装载身份。');
            } catch (error) { error.noMutation = true; throw error; }
            // 必须在 POST 前私有保存；任何失败回包都不能代替该 nonce 的安全取消确认。
            var attempt = ownedLoad = { clientLoadId: nonce, packageId: '', armId: '', startId: '', cancelling: false };
            var loaded = await post('/shows/load', { package: pkg, onlyIfIdle: true, protocolVersion: 1, clientLoadId: nonce });
            must(ownedLoad === attempt && !attempt.cancelling, '本次装载已取消，忽略迟到的回包。');
            must(loaded && loaded.state === 'loaded' && loaded.clientLoadId === nonce && typeof loaded.packageId === 'string' && ID.test(loaded.packageId), '插件没有确认本次装载身份。');
            attempt.packageId = loaded.packageId;
            return loaded;
          } finally { loading = false; }
        },
        arm: async function (request) {
          var attempt = ownedLoad;
          must(attempt && !attempt.cancelling && attempt.packageId && !attempt.armId && request &&
            request.protocolVersion === 1 && request.packageId === attempt.packageId, '本次装载身份已改变，不能就绪。');
          var armed = await post('/shows/arm-owned', { protocolVersion: 1, packageId: attempt.packageId, clientLoadId: attempt.clientLoadId });
          must(ownedLoad === attempt && !attempt.cancelling, '本次准备已取消，忽略迟到的就绪回包。');
          must(armed && armed.state === 'armed' && armed.clientLoadId === attempt.clientLoadId && armed.packageId === attempt.packageId && typeof armed.armId === 'string' && ID.test(armed.armId), '插件没有确认本次就绪身份。');
          attempt.armId = armed.armId;
          return armed;
        },
        clock: function () { return read('/shows/clock'); },
        schedule: async function (request) {
          var attempt = ownedLoad;
          must(attempt && !attempt.cancelling && attempt.armId && !attempt.startId && request && request.protocolVersion === 1 &&
            request.packageId === attempt.packageId && request.armId === attempt.armId && typeof request.startId === 'string' && UUID.test(request.startId), '本次预约身份已改变或已使用。');
          attempt.startId = request.startId;
          var scheduled = await post('/shows/schedule', request);
          must(ownedLoad === attempt && !attempt.cancelling, '本次预约已取消。');
          must(scheduled && scheduled.state === 'countdown' && scheduled.packageId === attempt.packageId &&
            scheduled.armId === attempt.armId && scheduled.startId === attempt.startId, '插件没有确认本次预约身份。');
          return scheduled;
        },
        stop: async function (request) {
          var attempt = ownedLoad; request = request || {};
          must(attempt, '本页没有待取消的装载。');
          ['clientLoadId', 'packageId', 'armId', 'startId'].forEach(function (key) {
            must(!request[key] || request[key] === attempt[key], '停止身份与本页装载不一致。');
          });
          attempt.cancelling = true;
          var body = { protocolVersion: 1, clientLoadId: attempt.clientLoadId };
          if (attempt.packageId) body.packageId = attempt.packageId;
          if (attempt.armId) body.armId = attempt.armId;
          var stopped = await post('/shows/stop-owned', body);
          must(stopped && stopped.state === 'stopped' && stopped.clientLoadId === attempt.clientLoadId &&
            typeof stopped.matchedCurrent === 'boolean' && stopped.safe === true, '插件尚未确认本次装载已安全取消，请重试本机停止。');
          if (ownedLoad === attempt) ownedLoad = null;
          return stopped;
        }
      }
    });
    panel.open();
  };
})(window);
