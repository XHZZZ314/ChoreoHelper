// 音乐节拍地基层：本地音频参照时钟、单一全局偏移与手动节拍目标（REQ-SPEC-009 首增量，纯逻辑层）。
'use strict';
(function () {
  var OFFSET_MIN = -3600000, OFFSET_MAX = 3600000, BPM_MIN = 1, BPM_MAX = 600;
  var SPEED_MIN = 0.25, SPEED_MAX = 2, LOOP_MIN_MS = 500, PROJ_DEFAULT_MS = 300000;
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.round(x) === x; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function zh(s) { return s; }
  // —— 时钟：T=A-O；媒体位置是唯一推进源，rAF/可见性补偿不得叠加时间 ——
  function mapMediaToTimeline(aMs, oMs) { return aMs - oMs; }
  function mapTimelineToMedia(sMs, oMs, durMs) {
    var a = sMs + oMs; if (!(a > 0)) a = 0; if (a === 0) a = 0;
    return clamp(a, 0, Math.max(0, durMs || 0));
  }
  function visibleTime(tMs, projMs) { return clamp(tMs, 0, Math.max(0, projMs || 0)); }
  // —— 校验：非法中文报错且调用方保留原值 ——
  function validateOffset(v) {
    if (typeof v === 'string') { if (v.trim() === '') return { ok: false, error: zh('偏移不能为空，请输入整数毫秒') }; if (!/^[+-]?\d+$/.test(v.trim())) return { ok: false, error: zh('偏移必须是整数毫秒（-3600000～3600000）') }; v = Number(v); }
    if (!isInt(v)) return { ok: false, error: zh('偏移必须是整数毫秒（-3600000～3600000）') };
    if (v < OFFSET_MIN || v > OFFSET_MAX) return { ok: false, error: zh('偏移超出范围（-3600000～3600000 毫秒）') };
    return { ok: true, value: v };
  }
  function validateBpm(v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { ok: true, value: null };
    var n = typeof v === 'string' ? Number(v) : v;
    if (!isNum(n)) return { ok: false, error: zh('BPM 必须是 1～600 的数字，清空则关闭节拍标记') };
    if (n < BPM_MIN || n > BPM_MAX) return { ok: false, error: zh('BPM 超出范围（1～600）') };
    return { ok: true, value: n };
  }
  function validateAnchor(v, durMs) {
    if (typeof v === 'string') { if (v.trim() === '') return { ok: false, error: zh('首拍锚点不能为空') }; if (!/^[+-]?\d+$/.test(v.trim())) return { ok: false, error: zh('首拍锚点必须是整数毫秒') }; v = Number(v); }
    if (!isInt(v) || v < 0) return { ok: false, error: zh('首拍锚点必须是不小于 0 的整数毫秒') };
    if (isNum(durMs) && v > Math.floor(durMs)) return { ok: false, error: zh('首拍锚点超出音频时长') };
    return { ok: true, value: v };
  }
  // —— 节拍：audio=H+n·60000/BPM，timeline=audio-O；只渲染双界内 ——
  function beatAudioMs(n, bpm, h) { return h + n * 60000 / bpm; }
  function beatTimelineMs(n, bpm, h, oMs) { return beatAudioMs(n, bpm, h) - oMs; }
  function visibleBeats(bpm, h, oMs, durMs, projMs, max) {
    if (bpm === null || bpm === undefined) return [];
    var out = [], step = 60000 / bpm, cap = max || 4096, n = 0;
    while (n < cap) { var a = h + n * step; if (a > durMs + 1e-9) break; var t = a - oMs; out.push({ n: n, index: n + 1, audioMs: a, timelineMs: t, render: t >= 0 && t <= projMs }); n++; }
    return out;
  }
  // —— 持久化：设置+不透明指纹经 contentExtra.music 往返；富时序零触碰 ——
  function defaultSettings() { return { offsetMs: 0, bpm: null, anchorMs: 0 }; }
  function sanitizeSettings(raw) {
    raw = raw || {};
    var o = ('offsetMs' in raw) ? validateOffset(raw.offsetMs) : { ok: true, value: 0 };
    if (!o.ok) return { ok: false, error: o.error };
    var b = ('bpm' in raw) ? validateBpm(raw.bpm) : { ok: true, value: null };
    if (!b.ok) return { ok: false, error: b.error };
    var h = ('anchorMs' in raw) ? validateAnchor(raw.anchorMs, null) : { ok: true, value: 0 };
    if (!h.ok) return { ok: false, error: h.error };
    return { ok: true, settings: { offsetMs: o.value, bpm: b.value, anchorMs: h.value } };
  }
  // music.v2 激活已支持的编辑字段；文档 timing 载体仍原样保留，不启用预备拍。
  function validateArrangement(raw) {
    var t = (typeof window !== 'undefined' ? window : globalThis).ChoreoMusicTiming;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !t) throw new Error('音乐编排格式无效');
    var tempo = t.validateTempoMap(raw.tempoMap), meter = t.validateMeterMap(raw.meterMap);
    if (!tempo.ok || !meter.ok) throw new Error((!tempo.ok ? tempo : meter).error);
    if (t.SNAP_MODES.indexOf(raw.snapMode) < 0) throw new Error('音乐吸附选择无效');
    return { tempoMap: tempo.map, meterMap: meter.map, snapMode: raw.snapMode };
  }
  function readProjectMusic(raw) {
    var empty = { tempoMap: [], meterMap: [], snapMode: 'time' };
    if (raw === undefined || raw === null) return { settings: defaultSettings(), ref: null, arrangement: empty };
    if (typeof raw !== 'object' || Array.isArray(raw) || (raw.v !== undefined && raw.v !== 1 && raw.v !== 2)) throw new Error('音乐版本或格式不受支持');
    if (raw.settings !== undefined && (!raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings))) throw new Error('音乐设置必须是对象');
    var s = sanitizeSettings(raw.settings || {});
    if (!s.ok) throw new Error(s.error);
    var ref = raw.ref;
    if (ref !== null && ref !== undefined) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref) || typeof ref.fingerprint !== 'string' || !ref.fingerprint.trim()) throw new Error('音乐引用指纹无效');
      if (ref.durationMs !== undefined && (!isInt(ref.durationMs) || ref.durationMs <= 0)) throw new Error('音乐引用时长无效');
      if (ref.size !== undefined && (!isInt(ref.size) || ref.size <= 0)) throw new Error('音乐引用大小无效');
      if (ref.name !== undefined && (typeof ref.name !== 'string' || ref.name.length > 255 || /[\\/]/.test(ref.name))) throw new Error('音乐引用文件名无效');
      if (ref.durationMs !== undefined && s.settings.anchorMs > ref.durationMs) throw new Error('首拍锚点超出音频时长');
    }
    return { settings: s.settings, ref: ref || null, arrangement: raw.v === 2 ? validateArrangement(raw.arrangement) : empty };
  }
  function coerceLoadedMusic(raw) {
    if (!raw || !raw.settings) return { settings: defaultSettings(), ref: (raw && raw.ref) || null, disabled: false, notice: '' };
    var s = sanitizeSettings(raw.settings);
    if (s.ok) return { settings: s.settings, ref: raw.ref || null, disabled: false, notice: '' };
    return { settings: defaultSettings(), ref: null, disabled: true, notice: zh('音乐设置不受支持，已停用音乐（' + s.error + '），修正后可重新启用；普通编辑不受影响。') };
  }
  function writeMusicKey(extra, settings, ref, arrangement) {
    var checked = arrangement ? validateArrangement(arrangement) : null;
    extra = extra || {};
    extra.music = { v: 1, settings: { offsetMs: settings.offsetMs, bpm: settings.bpm === undefined ? null : settings.bpm, anchorMs: settings.anchorMs }, ref: ref && ref.fingerprint ? { fingerprint: String(ref.fingerprint) } : null };
    if (arrangement) {
      extra.music.v = 2; extra.music.arrangement = checked;
      if (ref) ['name', 'size', 'durationMs'].forEach(function (k) { if (ref[k] !== undefined) extra.music.ref[k] = ref[k]; });
    }
    return extra;
  }
  function readMusicKey(extra) { return extra ? extra.music : null; }
  function sanitizeImportMusic(proj) {
    try { return readProjectMusic(readMusicKey(proj)); }
    catch (e) { throw new Error('音乐设置无效，已拒绝装载：' + e.message + '（当前项目未改动）'); }
  }
  function fnv(str) { var h2 = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h2 ^= str.charCodeAt(i); h2 = (h2 * 0x01000193) >>> 0; } return ('0000000' + h2.toString(16)).slice(-8); }
  function fingerprintBytes(arr) { var s = ''; for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i] & 255); return fnv(s + '|' + arr.length); }
  function composeFingerprint(o) { o = o || {}; return 'm1-' + fnv(o.size + '|' + o.durationMs + '|' + o.head + '|' + o.tail); }
  function matchRef(stored, cand) { if (!cand || !cand.fingerprint) return 'missing'; return (stored && stored.fingerprint === cand.fingerprint) ? 'match' : 'replace'; }
  function disposeRef(ref, revoker) { if (ref && ref.objectUrl && !ref._revoked) { ref._revoked = true; revoker(ref.objectUrl); } return { ok: true }; }
  // —— 边界：变速只设 rate；循环 B-A≥500 且映射端点双界内 ——
  function validSpeed(r) { return isNum(r) && r >= SPEED_MIN && r <= SPEED_MAX; }
  function checkLoop(aMs, bMs, oMs, durMs) {
    if (!isNum(aMs) || !isNum(bMs) || aMs < 0 || bMs < 0) return { ok: false, error: zh('循环起止必须是不小于 0 的毫秒数') };
    if (bMs - aMs < LOOP_MIN_MS) return { ok: false, error: zh('循环长度至少 500 毫秒（B-A≥500）') };
    var A = aMs + oMs, B = bMs + oMs;
    if (!(A >= 0) || !(B <= durMs)) return { ok: false, error: zh('循环映射端点超出音频范围，请修正后再试') };
    return { ok: true };
  }
  // —— 游戏：单显式启动；fromTime 采样一次；只认 status=playing ——
  function buildStartBody(o) { o = o || {}; return { clips: o.clips, revision: o.revision, fromTime: o.fromTimeSec, speed: o.speed }; }
  function interpretStartResponse(d) {
    if (d && !d.error && d.status === 'playing') return { ok: true };
    if (d && d.error) return { ok: false, error: zh('插件拒绝播放：' + (d.message || d.error)) };
    return { ok: false, error: zh('插件返回异常，未开始播放') };
  }
  function statusZh(e) {
    if (!e) return zh('游戏播放失败');
    if (e.detail) return zh('游戏没动：' + e.detail);
    if (e.status) return zh('游戏没动：插件拒绝了这次播放（' + e.status + '）');
    if (e.transport) return zh('网络超时或断开，远端状态未知：请在游戏中手动停止后再点停止重试');
    return zh('游戏播放失败：' + (e.message || '未知错误'));
  }
  function createController(env) {
    env = env || {};
    var now = env.now || function () { return Date.now(); };
    // 项目域令牌：UI 可注入 projectNow，使布防后的异步续体（计数/启动/游戏分发）在跨项目后一律作废。
    var projectNow = env.projectNow || null;
    function sameProject(token) { return !projectNow || token === null || projectNow() === token; }
    function timingMod() { var g = (typeof window !== 'undefined' && window.ChoreoMusicTiming) || globalThis.ChoreoMusicTiming || null; return g; }
    var _timer = env.timer || null;
    function later(fn, ms) { try { return _timer && _timer.set ? _timer.set(fn, ms) : setTimeout(fn, ms); } catch (e) { return setTimeout(fn, ms); } }
    function clearLater(id) { try { if (_timer && _timer.clear) _timer.clear(id); else clearTimeout(id); } catch (e) { try { clearTimeout(id); } catch (e2) {} } }
    var S = { session: 0, mode: 'idle', displayMs: 0, projDur: PROJ_DEFAULT_MS, stoppedOrigin: false, ended: false, paused: false,
      settings: defaultSettings(), rate: 1, loop: null, attached: null, gameCtx: null,
      gameIssued: false, gameConfirmed: false, gameUnknown: false, needStopRetry: false,
      settling: false, stopPending: 0, pendingSession: null, armed: false, needsPlay: false, waitDispatch: false, endedStopSent: false,      lastError: null, lastRttMs: null, startsIssued: 0, stopsIssued: 0,
      count: { enabled: false, bars: 0 }, sessionTempo: [], sessionMeter: [], countTimers: [], countResolve: null, mediaPending: 0 };
    function media() { return typeof env.media === 'function' ? env.media() : (env.media || null); }
    function net() { return env.net || null; }
    function curA() { var m = media(); return m ? m.currentMs() : 0; }
    function dur() { var m = media(); return m ? m.durationMs() : 0; }
    function curT() { return mapMediaToTimeline(curA(), S.settings.offsetMs); }
    function gameActive() { return S.mode === 'game' || S.mode === 'gameWait' || S.gameIssued || S.settling; }
    function loopValid() { return !!S.loop && checkLoop(S.loop.aMs, S.loop.bMs, S.settings.offsetMs, dur()).ok; }
    function stopReq() {
      var n = net(); S.stopsIssued++;
      if (!n) { S.gameIssued = false; S.gameConfirmed = false; return Promise.resolve({ ok: true }); }
      S.stopPending++;
      return n.stop().then(function () { S.stopPending--; S.gameIssued = false; S.gameConfirmed = false; return { ok: true }; }, function (e) {
        S.stopPending--; S.gameUnknown = true; S.needStopRetry = true;
        S.lastError = statusZh({ transport: true, message: (e && e.message) || '' }); return { failed: true };
      });
    }
    function pauseBoth() {
      cancelCount();
      var m = media(); if (m) m.pause();
      S.session++; S.armed = false; S.mode = 'idle'; S.paused = true; S.waitDispatch = false;
      if (S.gameIssued || S.settling) stopReq(); else S.gameConfirmed = false;
      return { ok: true };
    }
    function endPause() {
      cancelCount();
      var m = media(); if (m) m.pause();
      S.displayMs = visibleTime(curT(), S.projDur);
      S.ended = true; S.stoppedOrigin = false; S.paused = false; S.waitDispatch = false; S.mode = 'idle';
      if (S.gameIssued && !S.endedStopSent) { S.endedStopSent = true; stopReq(); }
      return { ok: true };
    }
    function dispatchStart(my, pj) {
      var m = media(), n = net(), g = S.gameCtx || { clips: [], revision: 0 };
      var fromSec = Math.max(0, curA() - S.settings.offsetMs) / 1000;
      var body = buildStartBody({ clips: g.clips, revision: g.revision, fromTimeSec: fromSec, speed: S.rate });
      S.startsIssued++; S.gameIssued = true; S.settling = true; S.waitDispatch = false; S.pendingSession = my;
      var t0 = now();
      var p = n.start(body).then(function (resp) {
        if (my !== S.session || !sameProject(pj)) {
          var r = interpretStartResponse(resp);
          if (!r.ok) { S.armed = false; S.settling = false; S.pendingSession = null; S.gameIssued = false; return { stale: true }; }
          return stopReq().then(function () { S.armed = false; S.settling = false; S.pendingSession = null; S.gameConfirmed = false; return { stale: true }; }, function () { S.armed = false; S.settling = false; S.pendingSession = null; S.gameConfirmed = false; return { stale: true }; });
        }
        S.armed = false; S.settling = false; S.pendingSession = null;
        var r2 = interpretStartResponse(resp);
        if (r2.ok) { S.mode = 'game'; S.gameConfirmed = true; S.lastRttMs = now() - t0; return { ok: true, mode: 'game', rttMs: S.lastRttMs }; }
        S.gameIssued = false; if (m) m.pause(); S.lastError = r2.error; S.mode = 'idle'; return { failed: true, error: r2.error };
      }, function (e) {
        if (my !== S.session || !sameProject(pj)) {
          S.armed = false; S.settling = false; S.pendingSession = null;
          if (e && (e.transport || /timeout|超时|断开/i.test(e.message || ''))) { S.gameUnknown = true; S.needStopRetry = true; S.lastError = statusZh({ transport: true }); }
          return { stale: true };
        }
        S.armed = false; S.settling = false; S.pendingSession = null; S.gameIssued = false; if (m) m.pause(); S.mode = 'idle';
        if (e && (e.transport || /timeout|超时|断开|timed out/i.test((e && e.message) || ''))) { S.gameUnknown = true; S.needStopRetry = true; S.lastError = statusZh({ transport: true }); }
        else S.lastError = statusZh(e);
        return { failed: true, error: S.lastError };
      });
      p.catch(function () {});
      return p;
    }
    // —— 会话内预备拍：可取消的墙钟准备阶段，媒体启动后仍由媒体独自推进 ——
    function cancelCount(result) {
      for (var i = 0; i < S.countTimers.length; i++) clearLater(S.countTimers[i]);
      S.countTimers = [];
      if (S.countResolve) { var f = S.countResolve; S.countResolve = null; try { f(result || { cancelled: true }); } catch (e) {} }
      if (S.mode === 'countin') S.mode = 'idle';
      return { ok: true };
    }
    function launchWeb(my, pj) {
      var m = media();
      S.mediaPending++;
      return m.play().then(function () {
        S.mediaPending--;
        if (my !== S.session || !sameProject(pj)) { m.pause(); return { stale: true }; }
        S.armed = false;
        S.mode = 'web'; return { ok: true, mode: 'web' };
      }, function (e) { S.mediaPending--; if (my !== S.session || !sameProject(pj)) return { stale: true }; S.armed = false; return { failed: true, error: zh('音频播放失败：' + ((e && e.message) || '未知错误')) }; });
    }
    function startCount(my, pj) {
      var TM = timingMod();
      if (!TM) { S.armed = false; return Promise.resolve({ failed: true, error: zh('节拍模块未加载，无法预备拍（普通播放不受影响）') }); }
      var startA = curA(), tempo = TM.resolveTempoAt(S.sessionTempo, startA, S.settings.bpm);
      var beats = TM.isEmptyTempoMap(S.sessionTempo) ? TM.scalarBeats(tempo.bpm, S.settings.anchorMs, S.settings.offsetMs, dur(), S.projDur) : TM.evaluateTempoBeats(S.sessionTempo, S.settings.anchorMs, S.settings.offsetMs, dur(), S.projDur);
      var idx = 0;
      if (beats) for (var i = 0; i < beats.length; i++) if (beats[i].audioMs <= startA + 1e-9) idx = i;
      var meter = TM.resolveMeterAt(S.sessionMeter, idx);
      var sched = TM.computeCountInSchedule({ bars: S.count.bars, bpm: tempo.bpm, n: meter.n, d: meter.d });
      if (!sched.ok) { S.armed = false; return Promise.resolve({ blocked: 'countin', error: sched.error }); }
      S.mode = 'countin';
      return new Promise(function (resolve) {
        S.countResolve = resolve;
        sched.clicks.forEach(function (c) {
          S.countTimers.push(later(function () {
            if (my !== S.session || S.mode !== 'countin' || !sameProject(pj)) return;
            if (env.onCountBeat) { try { env.onCountBeat(c); } catch (e) {} }
          }, c.offsetMs));
        });
        S.countTimers.push(later(function () {
          if (!sameProject(pj)) { cancelCount({ cancelled: true, reason: 'project' }); return; }
          if (my !== S.session || S.mode !== 'countin') return;
          S.countTimers = []; S.countResolve = null;
          launchWeb(my, pj).then(function (r) { if (r && !r.stale) r.counted = true; resolve(r); });
        }, sched.totalMs));
      });
    }
    function playInternal(game, retain, skipCount) {
      if (!S.attached) return Promise.resolve({ noop: 'no-music' });
      if (S.mediaPending) return Promise.resolve({ blocked: 'media-pending', error: zh('上一次音频启动尚未结束，请稍候再试') });
      if (S.settling && S.pendingSession === S.session) return Promise.resolve({ deduped: true });
      if (S.settling || S.stopPending > 0) return Promise.resolve({ blocked: 'settling', error: zh('上一次游戏启动尚未结束，请稍候再试') });
      if (S.gameUnknown || S.needStopRetry) return Promise.resolve({ blocked: 'unknown', error: zh('游戏远端状态未知：请在游戏中手动停止，再点停止重试，之后才能重开') });
      if (S.loop && !loopValid()) return Promise.resolve({ blocked: 'loop', error: zh('循环区间无效，无法开始音乐播放，请修正后再试') });
      if (S.mode === 'countin') cancelCount();
      else if (S.mode !== 'idle') return Promise.resolve({ deduped: true });
      var m = media(); S.session++; var my = S.session; S.armed = true;
      var pj = projectNow ? projectNow() : null;
      var fromZero = S.stoppedOrigin || S.ended;      S.ended = false; S.needsPlay = false; S.paused = false; S.lastError = null; S.endedStopSent = false;
      if (fromZero) { if (m) m.setCurrentMs(0); S.displayMs = 0; }
      S.stoppedOrigin = false;
      if (m) m.setRate(S.rate);
      if (!game && !skipCount && S.count.enabled) return startCount(my, pj);
      var countNote = (!game || !S.count.enabled) ? null : zh('游戏模式不支持预备拍，已按原方式直接启动（网页试听可用预备拍）');
      if (!game) return launchWeb(my, pj);
      var n = net();
      if (!n) { S.armed = false; return Promise.resolve({ failed: true, error: zh('游戏通道不可用：未连接插件，只能网页试听') }); }
      S.gameCtx = { clips: game.clips, revision: game.revision, project: pj };
      S.mediaPending++;
      return m.play().then(function () {
        S.mediaPending--;
        if (my !== S.session || !sameProject(pj)) { m.pause(); return { stale: true }; }
        if (curT() < 0) { S.mode = 'gameWait'; S.waitDispatch = true; return { ok: true, mode: 'gameWait', waiting: true, notice: countNote }; }
        var p = dispatchStart(my, pj);
        if (countNote) return p.then(function (r) { if (r && !r.stale) r.notice = countNote; return r; });
        return p;
      }, function (e) { S.mediaPending--; if (my !== S.session || !sameProject(pj)) return { stale: true }; S.armed = false; return { failed: true, error: zh('音频播放失败，未发起游戏启动：' + ((e && e.message) || '未知错误')) }; });
    }
    return {
      state: function () { return { mode: S.mode, session: S.session, paused: S.paused, displayMs: S.displayMs, settings: { offsetMs: S.settings.offsetMs, bpm: S.settings.bpm, anchorMs: S.settings.anchorMs }, rate: S.rate, loop: S.loop ? { aMs: S.loop.aMs, bMs: S.loop.bMs } : null, attached: S.attached ? { fingerprint: S.attached.fingerprint, durationMs: S.attached.durationMs } : null, gameConfirmed: S.gameConfirmed, gameUnknown: S.gameUnknown, needStopRetry: S.needStopRetry, needsPlay: S.needsPlay, ended: S.ended, stoppedOrigin: S.stoppedOrigin, lastError: S.lastError, lastRttMs: S.lastRttMs, startsIssued: S.startsIssued, stopsIssued: S.stopsIssued, countIn: { enabled: S.count.enabled, bars: S.count.bars }, sessionTempo: S.sessionTempo.length, sessionMeter: S.sessionMeter.length }; },
      attach: function (ref) {
        cancelCount();
        if (!ref || typeof ref.fingerprint !== 'string' || !ref.fingerprint || !isNum(ref.durationMs) || !(ref.durationMs > 0)) return { ok: false, error: zh('音频不可用：时长为零或无法解码，已保留原引用') };
        S.session++; S.armed = false; S.attached = { fingerprint: ref.fingerprint, durationMs: ref.durationMs };
        S.mode = 'idle'; S.displayMs = 0; S.ended = false; S.stoppedOrigin = false; S.paused = false; S.needsPlay = false;
        S.gameIssued = false; S.gameConfirmed = false; S.waitDispatch = false; S.gameCtx = null; S.lastError = null;
        return { ok: true };
      },
      detach: function () { cancelCount(); S.session++; S.armed = false; S.attached = null; S.mode = 'idle'; S.displayMs = 0; S.ended = false; S.stoppedOrigin = false; S.paused = false; S.needsPlay = false; S.gameIssued = false; S.gameConfirmed = false; S.waitDispatch = false; S.gameCtx = null; return { ok: true }; },
      setSettings: function (patch) {
        patch = patch || {}; var next = { offsetMs: S.settings.offsetMs, bpm: S.settings.bpm, anchorMs: S.settings.anchorMs }, keys = ['offsetMs', 'bpm', 'anchorMs'], i, r;
        for (i = 0; i < keys.length; i++) {
          if (!(keys[i] in patch)) continue;
          r = keys[i] === 'offsetMs' ? validateOffset(patch.offsetMs) : keys[i] === 'bpm' ? validateBpm(patch.bpm) : validateAnchor(patch.anchorMs, S.attached ? S.attached.durationMs : null);
          if (!r.ok) return { ok: false, error: r.error };
          next[keys[i]] = r.value;
        }
        S.settings = next;
        if (S.mode !== 'idle') { pauseBoth(); S.needsPlay = true; return { ok: true, paused: true }; }
        return { ok: true, paused: false };
      },
      setSessionTiming: function (patch) {
        var TM = timingMod();
        if (!TM) return { ok: false, error: zh('节拍模块未加载，会话时序不可用（普通播放不受影响）') };
        patch = patch || {};
        var nt = S.sessionTempo, nm = S.sessionMeter, r;
        if ('tempoMap' in patch) { r = TM.validateTempoMap(patch.tempoMap); if (!r.ok) return r; nt = r.map; }
        if ('meterMap' in patch) { r = TM.validateMeterMap(patch.meterMap); if (!r.ok) return r; nm = r.map; }
        S.sessionTempo = nt; S.sessionMeter = nm;
        return { ok: true };
      },
      setCountIn: function (sel) {
        var TM = timingMod();
        if (!TM) return { ok: false, error: zh('节拍模块未加载，预备拍不可用（普通播放不受影响）') };
        var r = TM.validateCountIn(sel);
        if (!r.ok) return r;
        S.count = r.sel;
        if (S.mode === 'countin') cancelCount();
        return { ok: true };
      },
      setRate: function (r) {
        if (!validSpeed(r)) return { ok: false, error: zh('速度超出范围（0.25～2）') };
        var m = media(); if (m) m.setRate(r); S.rate = r;
        if (gameActive()) { pauseBoth(); S.needsPlay = true; return { ok: true, paused: true }; }
        return { ok: true, paused: false };
      },
      setLoop: function (aMs, bMs) {
        if (aMs === null && bMs === null) { S.loop = null; return { ok: true }; }
        if (!S.attached) return { ok: false, error: zh('先选择音频再设置循环') };
        var r = checkLoop(aMs, bMs, S.settings.offsetMs, dur());
        if (!r.ok) return r;
        S.loop = { aMs: aMs, bMs: bMs }; return { ok: true };
      },
      play: function (game) { return playInternal(game || null, false, false); },
      resume: function (game) { return playInternal(game || null, true, true); },
      pause: function () { return pauseBoth(); },
      stop: function () {
        if (!S.armed && S.mode === 'idle' && !S.gameIssued && !S.settling && S.stopPending === 0 && curA() === 0 && S.displayMs === 0) return { ok: true, already: true };
        cancelCount();
        S.armed = false; S.session++; var m = media(); if (m) { m.pause(); m.setCurrentMs(0); }
        S.displayMs = 0; S.mode = 'idle'; S.ended = false; S.stoppedOrigin = true; S.paused = false; S.needsPlay = false;
        S.waitDispatch = false; S.gameConfirmed = false;
        if (S.gameIssued || S.settling) stopReq();
        return { ok: true };
      },
      stopRetry: function () {
        if (!S.needStopRetry && !S.gameUnknown) return Promise.resolve({ ok: true, nothing: true });
        return stopReq().then(function (r) {
          if (r.failed) return { failed: true, error: S.lastError };
          S.gameUnknown = false; S.needStopRetry = false; S.gameConfirmed = false; S.lastError = null; return { ok: true };
        });
      },
      seek: function (sMs) {
        if (!S.attached) return { noop: 'no-music' };
        var m = media(), A = mapTimelineToMedia(sMs, S.settings.offsetMs, dur());
        if (m) m.setCurrentMs(A);
        S.displayMs = visibleTime(A - S.settings.offsetMs, S.projDur); S.ended = false; S.stoppedOrigin = false;
        if (gameActive() || S.armed) { pauseBoth(); S.needsPlay = true; return { ok: true, paused: true }; }
        return { ok: true, paused: false };
      },
      onTick: function (projMs) {
        var p = projMs || S.projDur, m = media();
        if (S.mode === 'web' && m) {
          var A = m.currentMs(), t = A - S.settings.offsetMs;
          if (S.loop && loopValid() && t >= S.loop.bMs) { m.setCurrentMs(S.loop.aMs + S.settings.offsetMs); S.displayMs = visibleTime(S.loop.aMs, p); }
          else { S.displayMs = visibleTime(t, p); if (t >= p || A >= dur()) endPause(); }
        } else if (S.mode === 'gameWait') { if (curT() >= 0) dispatchStart(S.session, S.gameCtx ? S.gameCtx.project : null); }
        else if (S.mode === 'game' && m) {
          var A2 = m.currentMs(), t2 = A2 - S.settings.offsetMs;
          S.displayMs = visibleTime(t2, p);
          if (A2 >= dur() || t2 >= p) endPause();
        }
        return { ok: true };
      },
      onMediaEnded: function () { if (S.attached) endPause(); return { ok: true }; },
      onHidden: function () { if (S.mode === 'countin') { cancelCount(); return { ok: true, aborted: true }; } if (gameActive()) { pauseBoth(); S.gameConfirmed = false; S.needsPlay = true; return { ok: true, aborted: true }; } return { ok: true, unchanged: true }; },
      onStall: function () { if (gameActive()) { pauseBoth(); S.gameConfirmed = false; S.needsPlay = true; return { ok: true, aborted: true }; } return { ok: true, atA: curA() }; },
      onMediaError: function () { if (gameActive()) { pauseBoth(); S.gameConfirmed = false; S.needsPlay = true; return { ok: true, aborted: true }; } return { ok: true, atA: curA() }; },
      onProjectSwitch: function () { cancelCount(); S.session++; S.armed = false; var m = media(); if (m) m.pause(); if (S.gameIssued || S.settling) stopReq(); S.mode = 'idle'; S.gameConfirmed = false; S.waitDispatch = false; return { ok: true }; },
      sampleStatus: function () {
        var n = net(); if (!n) return Promise.resolve({ ok: false, error: zh('无游戏通道') });
        var my = S.session;
        return n.status().then(function (s) {
          if (my !== S.session) return { stale: true };
          if (!s || typeof s !== 'object' || typeof s.status !== 'string') return { ignored: true };
          if (s.status === 'playing' && !s.error && S.mode === 'game') S.gameConfirmed = true;
          return { ok: true };
        }, function (e) { return { failed: true, error: (e && e.message) || '状态采样失败' }; });
      },
    };
  }
  var API = { OFFSET_MIN: OFFSET_MIN, OFFSET_MAX: OFFSET_MAX, BPM_MIN: BPM_MIN, BPM_MAX: BPM_MAX,
    SPEED_MIN: SPEED_MIN, SPEED_MAX: SPEED_MAX, LOOP_MIN_MS: LOOP_MIN_MS,
    mapMediaToTimeline: mapMediaToTimeline, mapTimelineToMedia: mapTimelineToMedia, visibleTime: visibleTime,
    validateOffset: validateOffset, validateBpm: validateBpm, validateAnchor: validateAnchor,
    beatAudioMs: beatAudioMs, beatTimelineMs: beatTimelineMs, visibleBeats: visibleBeats,
    defaultSettings: defaultSettings, sanitizeSettings: sanitizeSettings, coerceLoadedMusic: coerceLoadedMusic,
    readProjectMusic: readProjectMusic, validateArrangement: validateArrangement, writeMusicKey: writeMusicKey, readMusicKey: readMusicKey, sanitizeImportMusic: sanitizeImportMusic,
    fingerprintBytes: fingerprintBytes, composeFingerprint: composeFingerprint, matchRef: matchRef, disposeRef: disposeRef,
    validSpeed: validSpeed, checkLoop: checkLoop, buildStartBody: buildStartBody,
    interpretStartResponse: interpretStartResponse, createController: createController };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoMusic = API;
})();
