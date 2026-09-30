// 一键停止网页播放与本机自动操作；等待真实停止确认，失败保留重试入口。
(function (root) {
  'use strict';
  var pending = null, state = 'idle';
  function view(next, message) {
    state = next;
    var button = document.getElementById('immediateStop');
    var line = document.getElementById('immediateStopStatus');
    if (button) { button.textContent = next === 'stopping' ? '正在停止…' : next === 'failed' ? '重试停止' : '■ 立即停止'; button.setAttribute('aria-busy', String(next === 'stopping')); }
    if (line) { line.textContent = message; line.dataset.state = next; }
  }
  function stopNow() {
    if (pending) return pending;
    var localErrors = [], localTasks = [], musicResult;
    view('stopping', '正在停止网页播放和本机操作…');
    function local(name, fn) {
      function checked(value) { if (value && (value.ok === false || value.failed === true)) throw new Error(name); }
      try { var value = fn(); if (value && value.then) localTasks.push(Promise.resolve(value).then(checked).catch(function () { localErrors.push(name); })); else checked(value); }
      catch (error) { localErrors.push(name); }
    }
    // 同一点击内先切断本页继续输出的回调，不等待网络。
    local('网页播放', function () { root.stopLocalPlaybackNow(); });
    local('录制与审核', function () { if (root.recordingStopNow) root.recordingStopNow(); });
    local('音乐', function () { if (root.ChoreoMusicUI && root.ChoreoMusicUI.stopNow) { musicResult = root.ChoreoMusicUI.stopNow(); return musicResult; } });
    local('演出登记', function () { if (root.showExecCancelLocal) root.showExecCancelLocal(); });
    local('双人演出', function () { if (root.ensembleStopNow) return root.ensembleStopNow(musicResult); });
    var request;
    try {
      root.ChoreoAPI.cancelGameWrites();
      root.ChoreoAPI.setOutputBlocked(true);
      request = root.ChoreoAPI.game.api('/control/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (error) { request = Promise.reject(error); }
    pending = Promise.resolve(request).then(async function (result) {
      var generation = result && result.generation, deadline = Date.now() + 4000;
      if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('停止确认不完整');
      // 这里只复读状态；清理失败不会被自动重试。
      while (result && result.state === 'stopping' && Date.now() < deadline) {
        await new Promise(function (resolve) { root.setTimeout(resolve, 100); });
        result = await root.ChoreoAPI.game.api('/control/status', { timeoutMs: 1000 });
        if (!result || !Number.isSafeInteger(result.generation) || result.generation < generation) throw new Error('停止确认已过期，请重试');
      }
      if (!result || result.ok !== true || result.state !== 'stopped') throw new Error(result && result.message || '插件尚未确认停止');
      var timer;
      try { await Promise.race([Promise.all(localTasks), new Promise(function (_, reject) { timer = root.setTimeout(function () { reject(new Error('网页任务取消尚未确认')); }, 4000); })]); }
      finally { root.clearTimeout(timer); }
      if (localErrors.length) throw new Error(localErrors.join('、') + '尚未确认停止');
      if (root.showExecConfirmGlobalStop) root.showExecConfirmGlobalStop();
      root.ChoreoAPI.setOutputBlocked(false);
      view('stopped', '已停止');
      return result;
    }).catch(function (error) {
      var why = error && (error.detail || error.message) || '连接失败';
      if (error && error.status === 404) why = '请更新并重载插件';
      view('failed', '停止未确认，请重试：' + why);
      return { ok: false, state: 'failed', message: why };
    }).finally(function () { pending = null; });
    return pending;
  }
  root.ChoreoStop = { stop: stopNow, state: function () { return state; } };
  var button = document.getElementById('immediateStop');
  if (button) button.addEventListener('click', stopNow);
})(window);
