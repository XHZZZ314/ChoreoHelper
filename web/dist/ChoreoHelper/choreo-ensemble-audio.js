// 多人演出的本地音频：显式准备、单调截止时间、私有文件与可取消的单音源。
(function (root) {
  'use strict';
  // 与音乐面板现有资源/偏移上限一致；不依赖 DOM、网络或普通游戏播放控制器。
  var LIMITS = Object.freeze({ maxFileBytes: 67108864, maxDurationMs: 900000, maxOffsetMs: 3600000, minLeadMs: 100, maxLeadMs: 30000 });
  function error(code, message) { var e = new Error(message); e.code = code; return e; }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function createController(env) {
    env = env || {};
    var AC = env.AudioContext || root.AudioContext || root.webkitAudioContext;
    var FileType = env.File || root.File;
    var now = env.now || function () { return root.performance.now(); };
    var context = null, source = null, sourceStarted = false, operation = null, buffer = null, token = null;
    var generation = 0, phase = 'idle', disposed = false, owned = false, lastNow = -1;
    function state() {
      return Object.freeze({ phase: phase, owned: owned, disposed: disposed, generation: generation,
        ready: phase === 'ready', durationMs: token ? token.durationMs : 0, offsetMs: token ? token.offsetMs : null });
    }
    function clear(nextPhase) { operation = null; buffer = null; token = null; owned = false; phase = disposed ? 'disposed' : nextPhase; }
    function stop() {
      generation++;
      if (operation) operation.cancel();
      operation = null; buffer = null; token = null;
      if (source) {
        var stopped = !sourceStarted;
        if (sourceStarted) { try { source.stop(); stopped = true; } catch (e) {} }
        try { source.disconnect(); } catch (e) {}
        // 停止未确认时保留锁；onended、关闭上下文或再次成功停止才能解除。
        if (!stopped && (!context || context.state !== 'closed')) {
          phase = 'faulted'; owned = true;
          return { ok: false, code: 'STOP_FAILED', error: '本地音频停止未确认，请重试停止' };
        }
        source.onended = null; source = null; sourceStarted = false;
      }
      clear('idle');
      return { ok: true };
    }
    function checkOrdinary() {
      if (env.isOrdinaryPlaying && env.isOrdinaryPlaying()) throw error('MUSIC_BUSY', '普通音乐正在播放或启动，请先停止后再准备合奏');
    }
    function selectionMatches(op) {
      if (!env.getSelection) return true;
      var s = env.getSelection();
      return !!s && s.file === op.file && s.projectId === op.projectId && s.offsetMs === op.offsetMs;
    }
    function checkOperation(op) {
      if (disposed) throw error('DISPOSED', '本地合奏音频已关闭');
      if (operation !== op || op.generation !== generation) throw error('STALE', '音频准备已取消，请重新点击准备');
      if (!selectionMatches(op)) throw error('STALE', '音频、项目或偏移已变化，请重新点击准备');
      checkOrdinary();
    }
    function requireRunning() {
      if (!context || context.state !== 'running') throw error('CONTEXT_NOT_RUNNING', '音频上下文未运行，请重新点击准备');
    }
    function readNow() {
      var n = now();
      if (!finite(n) || n < 0 || n < lastNow) throw error('CLOCK_INVALID', '浏览器单调时钟无效，请重新打开页面');
      lastNow = n; return n;
    }
    function validateFile(file, offsetMs) {
      if (!FileType || !(file instanceof FileType) || typeof file.arrayBuffer !== 'function' ||
          !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > LIMITS.maxFileBytes ||
          (file.type && file.type.indexOf('audio/') !== 0)) throw error('FILE_INVALID', '请选择有效的本地音频文件（不超过64MiB）');
      if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > LIMITS.maxOffsetMs) throw error('OFFSET_INVALID', '音频偏移须为正负3600000以内的整数毫秒');
    }
    function validateBuffer(b, offsetMs) {
      if (!b || !finite(b.duration) || b.duration <= 0 || b.duration * 1000 > LIMITS.maxDurationMs ||
          !Number.isSafeInteger(b.length) || b.length <= 0 || !finite(b.sampleRate) || b.sampleRate <= 0 ||
          !Number.isInteger(b.numberOfChannels) || b.numberOfChannels < 1 || b.numberOfChannels > 2) {
        throw error('DURATION_INVALID', '音频时长或声道无效（最多15分钟，单声道或立体声）');
      }
      if (offsetMs >= b.duration * 1000) throw error('OFFSET_INVALID', '音频偏移已到达或超过文件末尾');
    }
    async function prepare(file, offsetMs, projectId) {
      if (disposed) throw error('DISPOSED', '本地合奏音频已关闭');
      var stopped = stop();
      if (!stopped.ok) throw error(stopped.code, stopped.error);
      validateFile(file, offsetMs); checkOrdinary();
      var rejectCancel;
      var cancelled = new Promise(function (_, reject) { rejectCancel = reject; });
      cancelled.catch(function () {});
      var op = { file: file, offsetMs: offsetMs, projectId: projectId, generation: generation,
        cancel: function () { rejectCancel(error('STALE', '音频准备已取消，请重新点击准备')); } };
      operation = op; owned = true; phase = 'preparing';
      function wait(p) { return Promise.race([p, cancelled]); }
      try {
        checkOperation(op);
        if (!context) {
          if (!AC) throw error('AUDIO_UNAVAILABLE', '浏览器不支持本地合奏音频');
          context = new AC();
          context.onstatechange = function () {
            if (context.state !== 'running' && owned && phase !== 'preparing') stop();
          };
        }
        // 必须在 Ready 的点击调用栈里 resume，之前没有任何 await 或文件读取。
        var resumed = context.resume();
        await wait(resumed);
        checkOperation(op); requireRunning();
        var bytes;
        try { bytes = await wait(file.arrayBuffer()); }
        catch (e) { checkOperation(op); throw error('READ_FAILED', '本地音频读取失败，请重新选择文件'); }
        checkOperation(op); requireRunning();
        if (!bytes || bytes.byteLength !== file.size) throw error('FILE_INVALID', '本地音频内容为空或不完整');
        var decoded;
        try { decoded = await wait(context.decodeAudioData(bytes)); }
        catch (e) { checkOperation(op); throw error('DECODE_FAILED', '本地音频无法解码，请选择浏览器支持的音频'); }
        checkOperation(op); requireRunning(); validateBuffer(decoded, offsetMs);
        buffer = decoded;
        token = Object.freeze({ generation: generation, durationMs: decoded.duration * 1000, offsetMs: offsetMs });
        phase = 'ready';
        return token;
      } catch (e) {
        if (operation === op) stop();
        if (e && typeof e.code === 'string') throw e;
        throw error('PREPARE_FAILED', '音频准备失败，请在本页重新点击准备');
      }
    }
    function isCurrent(prepared) {
      if (!prepared || prepared !== token || !operation || disposed) return false;
      try { checkOperation(operation); requireRunning(); return phase === 'ready' || phase === 'scheduled'; }
      catch (e) { stop(); return false; }
    }
    function schedule(deadlineMs, prepared) {
      // 必须传回原对象，旧 Ready 回调不能调度新一代音频，也不能取消新一代音频。
      if (!prepared || prepared !== token || !operation || disposed) throw error(disposed ? 'DISPOSED' : 'STALE', '音频准备凭据已失效，请重新点击准备');
      if (phase === 'scheduled' || source) throw error('ALREADY_SCHEDULED', '本次音频已经安排播放');
      try {
        checkOperation(operation); requireRunning(); validateBuffer(buffer, operation.offsetMs);
        function timing() {
          var browserNow = readNow(), lead = deadlineMs - browserNow;
          if (!finite(deadlineMs) || !finite(lead) || lead < LIMITS.minLeadMs) throw error('DEADLINE_TOO_NEAR', '开演时间已过或太近，请重新准备');
          if (lead > LIMITS.maxLeadMs) throw error('DEADLINE_TOO_FAR', '开演时间超过30秒，请重新准备');
          var audioNow = context.currentTime;
          if (!finite(audioNow) || audioNow < 0) throw error('CLOCK_INVALID', '音频时钟无效，请重新准备');
          return { when: audioNow + (lead + Math.max(0, -operation.offsetMs)) / 1000, offset: Math.max(0, operation.offsetMs) / 1000 };
        }
        timing();
        source = context.createBufferSource();
        var ownSource = source;
        source.buffer = buffer; source.loop = false;
        source.onended = function () {
          if (source !== ownSource) return;
          try { ownSource.disconnect(); } catch (e) {}
          ownSource.onended = null; source = null; sourceStarted = false; clear('completed');
        };
        source.connect(context.destination);
        // 创建/连接后重采样并再检查；绝不让 WebAudio 把过期 start 钳成“现在就播”。
        checkOperation(operation); requireRunning();
        var t = timing();
        source.start(t.when, t.offset); sourceStarted = true; phase = 'scheduled';
        return Object.freeze({ ok: true, deadlineMs: deadlineMs, audioStartTime: t.when, offsetSeconds: t.offset, generation: generation });
      } catch (e) {
        var r = stop();
        if (!r.ok) throw error(r.code, r.error);
        if (e && typeof e.code === 'string') throw e;
        throw error('SCHEDULE_FAILED', '本地音频调度失败，请重新准备');
      }
    }
    function dispose() {
      disposed = true;
      var r = stop();
      if (context && context.state !== 'closed') {
        try { Promise.resolve(context.close()).then(function () { if (context.state === 'closed') stop(); }, function () {}); } catch (e) {}
      }
      return r;
    }
    return { prepare: prepare, schedule: schedule, isCurrent: isCurrent, stop: stop, dispose: dispose, state: state };
  }
  var api = { createController: createController, LIMITS: LIMITS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoreoEnsembleAudio = api;
})(typeof window === 'object' ? window : globalThis);
