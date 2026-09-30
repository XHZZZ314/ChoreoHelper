// 音乐面板接线层：本地音频选择/播放/偏移节拍中文面板（REQ-SPEC-009 首增量，body 级悬浮面板）。
'use strict';
(function () {
  var M = (typeof window !== 'undefined' && window.ChoreoMusic) || globalThis.ChoreoMusic || null;
  function store() { return (typeof window !== 'undefined' && window.store) || null; }
  function api() { return (typeof window !== 'undefined' && window.apiFetch) || null; }
  function toast(m) { try { if (window.showToast) window.showToast(m); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  // MUSIC-EDITOR（会话内时序）：纯模块会话单例 + 波形代际存储，编排随项目保存，波形与预备拍仍是会话态。
  function TM() { try { return (typeof window !== 'undefined' && window.ChoreoMusicTiming) || globalThis.ChoreoMusicTiming || null; } catch (e) { return null; } }
  function session() { var t = TM(); if (!t) return null; if (!t.session) t.session = t.createTimingSession(); return t.session; }
  var wave = null, lastCountBeat = null, lastPid = undefined, clickCtx = null;
  function waveStore() { var t = TM(); if (!t) return null; if (!wave) wave = t.createWaveformStore(); return wave; }
  function clickTick() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      clickCtx = clickCtx || new AC();
      var o = clickCtx.createOscillator(), g = clickCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.12; o.connect(g); g.connect(clickCtx.destination);
      o.start(); o.stop(clickCtx.currentTime + 0.07);
    } catch (e) {}
  }
  function mkMedia(a) { return { durationMs: function () { return isFinite(a.duration) ? Math.round(a.duration * 1000) : 0; }, currentMs: function () { return Math.round(a.currentTime * 1000); }, setCurrentMs: function (x) { try { a.currentTime = Math.max(0, x) / 1000; } catch (e) {} }, setRate: function (r) { try { a.playbackRate = r; } catch (e) {} }, play: function () { try { var p = a.play(); return p && p.catch ? p : Promise.resolve(); } catch (e) { return Promise.reject(e); } }, pause: function () { try { a.pause(); } catch (e) {} } }; }
  function musicWrite(url, body) {
    var f = api(); if (!f) return url === '/playback/stop' ? Promise.resolve({ status: 'stopped' }) : Promise.reject(new Error('no api'));
    ordinaryNetPending++;
    try { return Promise.resolve(f(url, body)).finally(function () { ordinaryNetPending--; }); }
    catch (e) { ordinaryNetPending--; return Promise.reject(e); }
  }
  function mkNet() { return { start: function (b) { return musicWrite('/playback/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); }, stop: function () { return musicWrite('/playback/stop', { method: 'POST' }); }, status: function () { var f = api(); return f ? f('/playback/status') : Promise.reject(new Error('no api')); } }; }
  function legacyFpOf(file, durMs) {
    return new Promise(function (ok) {
      function done(x, y) { try { ok(M.composeFingerprint({ size: file.size, durationMs: durMs, head: x, tail: y })); } catch (e) { ok('m1-' + file.size + '-' + durMs); } }
      try {
        var fr1 = new FileReader();
        fr1.onload = function () { var x = M.fingerprintBytes(new Uint8Array(fr1.result)); var fr2 = new FileReader(); fr2.onload = function () { done(x, M.fingerprintBytes(new Uint8Array(fr2.result))); }; fr2.onerror = function () { done(x, 'e'); }; fr2.readAsArrayBuffer(file.slice(Math.max(0, file.size - 65536), file.size)); };
        fr1.onerror = function () { done('e', 'e'); }; fr1.readAsArrayBuffer(file.slice(0, 65536));
      } catch (e) { done('e', 'e'); }
    });
  }
  async function fpOf(file, durMs) {
    var bytes = await file.arrayBuffer();
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return { fingerprint: 'sha256-' + Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''), legacyFingerprint: await legacyFpOf(file, durMs) };
  }
  var ctl = null, audio = null, objUrl = null, curFp = null, savedRef = null;
  // 玩家明确选择的本次无音乐排练；不写项目，停止/换项目/重选歌曲即撤销。
  var webWithoutMusic = false;
  // P4-A（#37）：底部「音乐」区默认收起成一条 slim 栏；仅记住用户显式的展开/收起选择，
  // 选择音频文件即自动展开（setOpen(true)），不把自动展开误记为用户偏好以外的默认态。
  var musicOpen = false;
  function readOpenPref() { try { return localStorage.getItem('choreo_music_open') === '1'; } catch (e) { return false; } }
  function setOpen(open, remember) {
    musicOpen = !!open;
    var body = $('musicBody'), tg = $('musicToggle');
    if (body) body.hidden = !musicOpen;
    if (tg) {
      tg.textContent = musicOpen ? '音乐 ▾' : '音乐 ▸';
      tg.setAttribute('aria-expanded', String(musicOpen));
      tg.title = musicOpen ? '收起音乐区（保留这一条入口）' : '展开音乐区（播放 / 节拍 / 设置）';
    }
    if (remember) { try { localStorage.setItem('choreo_music_open', musicOpen ? '1' : '0'); } catch (e) {} }
    if (window.ChoreoDock) window.ChoreoDock.layout();
  }
  function toggleOpen() { setOpen(!musicOpen, true); return musicOpen; }
  var lastExtra = null, loadGeneration = 0, pendingAudio = null, pendingUrl = null;
  function cancelSelection() {
    loadGeneration++;
    if (pendingAudio) { pendingAudio.oncanplay = pendingAudio.onerror = null; pendingAudio.removeAttribute('src'); pendingAudio.load(); pendingAudio = null; }
    if (pendingUrl) { URL.revokeObjectURL(pendingUrl); pendingUrl = null; }
    var rb = $('musicReplace'); if (rb) rb.remove();
  }
  function currentProject() { var s = store(); return lastPid === pidNow() && lastExtra === (s && s.contentExtra); }
  function syncProject() { if (!currentProject()) projectLoaded(); }
  function projectLoaded() {
    if (!ctl) return;
    webWithoutMusic = false;
    var s = store(), loaded = M.readProjectMusic(s && s.contentExtra && s.contentExtra.music);
    cancelSelection(); ensemble.stop(); ctl.onProjectSwitch(); ctl.detach();
    selectedFile = null; selectedPid = null; curFp = null; savedRef = loaded.ref;
    if (objUrl) URL.revokeObjectURL(objUrl); objUrl = null;
    audio.removeAttribute('src'); audio.load();
    lastPid = pidNow(); lastExtra = s && s.contentExtra;
    var ws = waveStore(); if (ws) ws.remove();
    var se = session(); se.reset(); se.setTempoMap(loaded.arrangement.tempoMap); se.setMeterMap(loaded.arrangement.meterMap); se.setSnapMode(loaded.arrangement.snapMode);
    ctl.setSettings(loaded.settings);
    $('musicBpm').value = loaded.settings.bpm == null ? '' : String(loaded.settings.bpm);
    $('musicOffset').value = String(loaded.settings.offsetMs); $('musicAnchor').value = String(loaded.settings.anchorMs);
    $('musicTempo').value = loaded.arrangement.tempoMap.map(function (e) { return e.startMs + ':' + e.bpm; }).join(',');
    $('musicMeter').value = loaded.arrangement.meterMap.map(function (e) { return e.startBeat + ':' + e.n + '/' + e.d; }).join(',');
    $('musicSnap').value = loaded.arrangement.snapMode; $('musicCountOn').checked = false; $('musicCountBars').value = '1';
    $('musicFile').value = ''; $('musicErr').textContent = ''; $('musicWaveMeta').textContent = '';
    if (s) s.currentTime = 0;
    pushSession(); refresh();
  }
  // File 只保留在闭包；不写项目、不暴露路径/对象 URL，也不交给合奏网络模块。
  var selectedFile = null, selectedPid = null, ensembleAudio = null, ensembleDisposed = false;
  var ordinaryPending = 0, ordinaryNetPending = 0;
  var ordinaryControls = ['musicFile', 'musicPlay', 'musicPause', 'musicResume', 'musicStop', 'musicDetach',
    'musicSeek', 'musicSeekGo', 'musicOffset', 'musicBpm', 'musicAnchor', 'musicTempo', 'musicMeter',
    'musicCountOn', 'musicCountBars', 'musicSnap', 'musicSessionReset', 'musicReplace'];
  function ensembleOwns() { return !!(ensembleAudio && ensembleAudio.state().owned); }
  function ordinaryBlocked() {
    if (!ensembleOwns()) return false;
    toast('合奏音频已占用音乐控制，请先在合奏面板停止'); return true;
  }
  function ordinaryBusy() {
    var st = ctl && ctl.state();
    return !!(pendingAudio || ordinaryPending || ordinaryNetPending || (audio && !audio.paused) ||
      (st && (st.mode !== 'idle' || st.gameConfirmed || st.gameUnknown || st.needStopRetry)));
  }
  function ensembleSelection() {
    if (!ctl || pendingAudio || !selectedFile || selectedPid !== pidNow() || !currentProject()) return null;
    return { file: selectedFile, projectId: selectedPid, offsetMs: ctl.state().settings.offsetMs };
  }
  function ensembleError(code, message) { var e = new Error(message); e.code = code; return e; }
  function ensembleController() {
    if (ensembleDisposed) throw ensembleError('DISPOSED', '本地合奏音频已关闭');
    if (!ensembleAudio) {
      var a = root.ChoreoEnsembleAudio;
      if (!a) throw ensembleError('AUDIO_UNAVAILABLE', '合奏音频模块未加载');
      ensembleAudio = a.createController({ getSelection: ensembleSelection, isOrdinaryPlaying: ordinaryBusy });
    }
    return ensembleAudio;
  }
  // prepare 必须由 Ready 点击直接调用；返回的凭据只在本页保留，schedule 必须传回同一对象。
  var ensemble = {
    prepare: function () {
      try {
        var s = ensembleSelection();
        if (!s) throw ensembleError('FILE_INVALID', '先在音乐面板选择并确认本地音频');
        var p = ensembleController().prepare(s.file, s.offsetMs, s.projectId);
        refresh();
        return p.finally(function () { refresh(); });
      } catch (e) { return Promise.reject(e); }
    },
    schedule: function (deadlineMs, prepared) { return ensembleController().schedule(deadlineMs, prepared); },
    isCurrent: function (prepared) { return !!(ensembleAudio && ensembleAudio.isCurrent(prepared)); },
    stop: function () { var r = ensembleAudio ? ensembleAudio.stop() : { ok: true }; if (ctl) refresh(); return r; },
    dispose: function () { ensembleDisposed = true; var r = ensembleAudio ? ensembleAudio.dispose() : { ok: true }; if (ctl) refresh(); return r; },
    state: function () { return ensembleAudio ? ensembleAudio.state() : { phase: ensembleDisposed ? 'disposed' : 'idle', owned: false, disposed: ensembleDisposed, generation: 0, ready: false, durationMs: 0, offsetMs: null }; },
    snapshot: function () { var st = ensemble.state(), busy = ordinaryBusy(); return Object.assign({}, st, { attached: !!ensembleSelection(), ordinaryBusy: busy, busy: busy || st.owned }); },
    hasSelection: function () { return !!ensembleSelection(); }
  };
  function pidNow() { var s = store(); return s ? s.projectId : null; }
  function speedNow() { var s = store(), r = s && +s.speed; return (r >= 0.25 && r <= 2) ? r : 1; }
  function projMs() { var s = store(); return Math.max(1, Math.round(((s && s.totalDuration) || 300) * 1000)); }
  function persist() {
    var s = store(); if (!s || !ctl || !currentProject()) return;
    s.contentExtra = s.contentExtra || {}; lastExtra = s.contentExtra;
    var previous = s.contentExtra.music;
    M.writeMusicKey(s.contentExtra, ctl.state().settings, savedRef, session().snapshot());
    // 保留扩展的未知键，但不让旧活动字段覆盖已验证的新值。
    if (previous) Object.keys(previous).forEach(function (k) { if (!(k in s.contentExtra.music)) s.contentExtra.music[k] = previous[k]; });
    if (window.bumpTimelineRev) window.bumpTimelineRev();
    if (window.persistProject) window.persistProject();
  }
  function snapshot() { var st = ctl ? ctl.state() : null; var t = TM(), se = t && t.session ? t.session.snapshot() : null, wv = wave ? wave.state() : null; return { attached: !!selectedFile && currentProject(), fingerprint: curFp, savedRef: savedRef, durationMs: audio && isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0, audioA: audio ? Math.round(audio.currentTime * 1000) : 0, displayMs: st ? st.displayMs : 0, mode: st ? st.mode : 'idle', settings: st ? st.settings : null, netStarts: st ? st.startsIssued : 0, netStops: st ? st.stopsIssued : 0, lastError: st ? st.lastError : null, session: se ? { tempo: se.tempoMap.length, meter: se.meterMap.length, countIn: se.countIn, snapMode: se.snapMode } : null, wave: wv ? { buckets: wv.buckets, generation: wv.generation } : null }; }
  function sessionBeats(st, dur) {
    var t = TM(), se = session();
    if (t && se && se.snapshot().tempoMap.length) {
      var s = se.snapshot(), ev = t.evaluateTempoBeats(s.tempoMap, st.settings.anchorMs, st.settings.offsetMs, dur, projMs(), 512);
      return (ev || []).filter(function (b) { return b.render; }).slice(0, 64);
    }
    return null;
  }
  function refresh() {
    var st = ctl.state(), dur = snapshot().durationMs;
    if (window.updatePlaybackButton) window.updatePlaybackButton();
    $('musicMeta').textContent = curFp ? ((selectedFile && selectedFile.name || '本地音频') + ' · ' + (dur / 1000).toFixed(1) + ' 秒') : (savedRef ? '请选择原音频：' + (savedRef.name || '本项目的歌曲') + '（已保留编排）' : '未选择音乐，可进行无音乐排练');
    var mini = $('musicMiniStatus');
    if (mini) mini.textContent = curFp ? ((selectedFile && selectedFile.name || '本地音频') + ' · ' + (dur / 1000).toFixed(1) + ' 秒') : (savedRef ? '本项目已保留歌曲引用，选择原音频后核对' : '未选择音乐，可进行无音乐排练');
    $('musicTime').textContent = '时间 ' + (isWebWithoutMusic() ? Math.round(store().currentTime * 1000) : st.displayMs) + 'ms / ' + projMs() + 'ms';
    var t = st.mode === 'countin' ? ('预备拍中' + (lastCountBeat ? ' · ' + lastCountBeat.label : '') + '…') : st.mode === 'game' ? '游戏中' : st.mode === 'gameWait' ? '等待预卷…' : st.mode === 'web' ? '网页排练中' : st.paused ? '已暂停' : '已停止';
    if (st.lastRttMs != null) t += ' · 往返 ' + st.lastRttMs + 'ms（非分发精度）';
    if (st.gameUnknown) t += ' · 远端未知：请游戏中手动停止后点停止重试';
    if (st.lastError) t += ' · ' + st.lastError;
    if (isWebWithoutMusic()) t = (store().isPlaying ? '正在' : '已暂停') + '无音乐网页排练（原歌曲引用保留）';
    if (ensembleOwns()) t = ensembleAudio.state().phase === 'faulted' ? '合奏音频停止未确认，请在合奏面板重试停止' : '合奏音频已占用（请在合奏面板停止）';
    $('musicStatus').textContent = t;
    var hasAudio = !!selectedFile && currentProject();
    $('musicWave').hidden = !hasAudio;
    $('musicTime').hidden = !hasAudio;
    $('musicStatus').hidden = !hasAudio && !savedRef && !pendingAudio && st.mode === 'idle' && !st.lastError && !st.gameUnknown && !ensembleOwns() && !isWebWithoutMusic();
    ordinaryControls.forEach(function (id) { var el = $(id); if (el) el.disabled = ensembleOwns(); });
    // 只表达现有播放状态，不改时钟或停止/重试协议。无音乐排练沿用主播放状态。
    var withoutMusic = isWebWithoutMusic(), musicRunning = withoutMusic ? !!store().isPlaying : st.mode !== 'idle';
    var musicPaused = withoutMusic ? !store().isPlaying : st.paused;
    var canStartMusic = withoutMusic || (hasAudio && !!curFp && !!objUrl);
    var musicBusy = ensembleOwns() || !!pendingAudio || ordinaryPending > 0 || ordinaryNetPending > 0;
    $('musicPlay').disabled = musicBusy || !canStartMusic || musicRunning || musicPaused;
    $('musicPause').disabled = ensembleOwns() || !musicRunning;
    $('musicResume').disabled = musicBusy || !canStartMusic || !musicPaused;
    $('musicStop').title = st.needStopRetry || st.gameUnknown ? '重试确认游戏端已停止' : '停止并回到开头；可随时再次确认停止';
    var beats = sessionBeats(st, dur) || ((st.settings.bpm == null || !curFp) ? [] : M.visibleBeats(st.settings.bpm, st.settings.anchorMs, st.settings.offsetMs, dur, projMs(), 512).filter(function (b) { return b.render; }).slice(0, 64));
    var html = '';
    beats.forEach(function (b) { html += '<div class="mbeat-row">第' + b.index + '拍 · ' + b.timelineMs + 'ms</div>'; });
    var beatList = $('musicBeats'), strip = $('musicStrip');
    // 显示时钟每 50ms 采样，静态节拍 DOM 仅在内容或时间比例改变时重建。
    var beatKey = html + '|' + projMs();
    if (beatList.__beatKey !== beatKey) {
      beatList.__beatKey = beatKey;
      beatList.innerHTML = html || '<div class="mbeat-empty">无节拍标记（设置 BPM 后显示）</div>';
      strip.innerHTML = '';
      beats.forEach(function (b) { var d = document.createElement('span'); d.className = 'mbeat'; d.setAttribute('data-tl', b.timelineMs); d.style.left = (b.timelineMs / projMs() * 100) + '%'; strip.appendChild(d); });
    }
    try {
      var se0 = session() ? session().snapshot() : null;
      if ($('musicSessionTag')) $('musicSessionTag').textContent = (se0 && (se0.tempoMap.length || se0.meterMap.length || se0.countIn.enabled || se0.snapMode !== 'time')) ? '编排随项目自动保存（预备拍不保存）' : '编排随项目自动保存';
      if (ctl.state().mode !== 'countin') lastCountBeat = null;
    } catch (e) {}
    if (hasAudio) drawWave();
  }
  function drawWave() {
    var cv = $('musicWave'); if (!cv || cv.hidden || !cv.getContext || !ctl) return;
    try {
      var t = TM(), ws = waveStore(), ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height;
      var st = ctl.state(), dur = snapshot().durationMs || 0, proj = projMs();
      var zoom = 1; try { zoom = Math.max(1, +$('musicZoom').value || 1); } catch (e) {}
      var winW = Math.max(1, proj / zoom);
      var win0 = Math.max(0, Math.min(Math.max(0, proj - winW), st.displayMs - winW / 4));
      var peaks = ws ? ws.state().peaks : [], n = peaks.length, cap = t ? t.LIMITS.maxPaintTargets : 2048;
      var paintKey = [W,Hh,st.displayMs,dur,proj,zoom,st.settings.offsetMs].join('|');
      if (cv.__paintKey === paintKey && cv.__peaks === peaks) return;
      cv.__paintKey = paintKey; cv.__peaks = peaks;
      ctx.clearRect(0, 0, W, Hh);
      if (dur > 0 && n) {
        ctx.fillStyle = '#888';
        var cols = Math.min(W, cap);
        for (var x = 0; x < cols; x++) {
          var a0 = win0 + x / cols * winW + st.settings.offsetMs, a1 = win0 + (x + 1) / cols * winW + st.settings.offsetMs;
          var i0 = Math.max(0, Math.floor(a0 / dur * n)), i1 = Math.min(n - 1, Math.ceil(a1 / dur * n)), pk = 0;
          for (var i = i0; i <= i1; i++) if (peaks[i] > pk) pk = peaks[i];
          var h = Math.max(1, pk * Hh / 2), px = Math.floor(x * W / cols);
          ctx.fillRect(px, Hh / 2 - h, 1, h * 2);
        }
      }
      var pxx = Math.round((st.displayMs - win0) / winW * W);
      ctx.fillStyle = '#f66'; ctx.fillRect(pxx, 0, 1, Hh);
    } catch (e) {}
  }
  function decodeForWave(f, gen, durMs) {
    var ws = waveStore(); if (!ws) return;
    var pid = pidNow(), extra = lastExtra;
    var b = ws.beginDecode(gen);
    if (!b.ok) { if (b.error && pidNow() === pid && $('musicWaveMeta')) $('musicWaveMeta').textContent = b.error; return; }
    // 陈旧代际/陈旧项目的解码结果一律静默：峰值与中文错误都不进当前页（r3 竞态契约）。
    function current() { try { return pidNow() === pid && lastExtra === extra && currentProject() && ws.state().generation === gen; } catch (e) { return false; } }
    function fail(m) { if (!current()) return; try { ws.completeDecode(gen, { durationMs: 0, channels: 1, channelData: [] }); } catch (e) {} if (m && current() && $('musicWaveMeta')) $('musicWaveMeta').textContent = m; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { fail('波形不可用（浏览器不支持解码），节拍与播放不受影响'); return; }
      var rd = new FileReader();
      rd.onload = function () {
        if (!current()) return;
        try {
          clickCtx = clickCtx || new AC();
          var p = clickCtx.decodeAudioData(rd.result.slice(0));
          if (p && p.then) p.then(function (buf) {
            if (!current()) return;
            var arr = []; for (var i = 0; i < buf.numberOfChannels; i++) { try { arr.push(buf.getChannelData(i)); } catch (e) {} }
            var r = ws.completeDecode(gen, { durationMs: durMs, channels: buf.numberOfChannels, channelData: arr, fingerprint: curFp });
            if (!r.ok && !r.stale && current() && $('musicWaveMeta')) $('musicWaveMeta').textContent = r.error || '';
            if ($('musicWaveMeta') && r.ok) $('musicWaveMeta').textContent = '';
            drawWave(); refresh();
          }, function () { fail('音频无法解码，已保留原引用'); });
          else fail('');
        } catch (e) { fail(''); }
      };
      rd.onerror = function () { if (pidNow() === pid) fail('音频无法解码，已保留原引用'); };
      rd.readAsArrayBuffer(f);
    } catch (e) { fail(''); }
  }
  function loopMs() { var s = store(); if (!s || s.loopA == null || s.loopB == null) return null; return { a: Math.round(s.loopA * 1000), b: Math.round(s.loopB * 1000) }; }
  function gameArg() { var s = store(); if (!s || s.previewTarget !== 'game') return null; return { clips: (window.buildGamePayloadClips && window.buildGamePayloadClips()) || [], revision: s._tlRevision || 1 }; }
  async function onPlay(resume) {
    syncProject(); if (ordinaryBlocked()) return;
    if (isWebWithoutMusic()) { if (!store().isPlaying && window.startPlay) window.startPlay(); refresh(); return; }
    if (pendingAudio) { toast('音频正在核对，请完成选择后播放'); return; }
    ordinaryPending++;
    var playGeneration = loadGeneration, playExtra = lastExtra, playSession = null;
    function current() { return playGeneration === loadGeneration && playExtra === lastExtra && currentProject() && (playSession === null || playSession === ctl.state().session); }
    try {
      if (!curFp || !objUrl) { toast('先选择本地音频再播放'); return; }
      if (store() && store().isPlaying) {
        if (store().previewTarget === 'game') { toast('请先停止时间线播放，再开始音乐排练'); return; }
        if (window.pausePlay) window.pausePlay();
      }
      webWithoutMusic = false;
      ctl.setRate(speedNow());
      var lp = loopMs(); ctl.setLoop(lp ? lp.a : null, lp ? lp.b : null);
      pushSession();
      var g = gameArg();
      if (g && !g.clips.length) { toast('游戏没动：预览舞者名下没有可播放的条目'); return; }
      var request = resume === true ? ctl.resume(g) : ctl.play(g);
      playSession = ctl.state().session;
      refresh();
      var r = await request;
      if (!current()) return;
      if (r && (r.failed || r.blocked)) toast(r.error);
      if (r && r.notice) toast(r.notice);
    } catch (e) { if (!current()) return; var m = '播放失败：' + ((e && e.message) || e); try { $('musicErr').textContent = m; } catch (e2) {} toast(m); }
    finally { ordinaryPending--; }
    if (current()) refresh();
  }
  // 统一入口只接管网页音乐排练；无引用项目和其他模式沿用原控制。
  function webState() {
    var s = store();
    if (isWebWithoutMusic()) return null;
    if (!ctl || !s || s.previewTarget === 'game' || !currentProject() || !(savedRef || selectedFile || pendingAudio)) return null;
    var st = ctl.state();
    return { playing: st.mode === 'web' || st.mode === 'countin', paused: st.paused, pending: ordinaryPending > 0 && !st.paused && !st.stoppedOrigin };
  }
  function pauseMusic() {
    if (isWebWithoutMusic()) { if (window.pausePlay) window.pausePlay(); refresh(); return; }
    if (ctl.state().mode === 'web') ctl.onTick(projMs());
    ctl.pause(); publishMusicTime(); refresh();
  }
  function stopMusic() {
    webWithoutMusic = false;
    cancelSelection(); ctl.stop(); publishMusicTime(); refresh();
  }
  function isWebWithoutMusic() { var s = store(); return !!(webWithoutMusic && s && s.previewTarget !== 'game' && currentProject()); }
  function chooseFile() {
    syncProject(); if (ordinaryBlocked()) return;
    var input = $('musicFile'); if (input) { input.focus(); input.click(); }
  }
  function rehearseWithoutMusic() {
    var s = store(); if (!ctl || !s || s.previewTarget === 'game') return false;
    syncProject(); if (ordinaryBlocked()) return false;
    if (window.__choreoGameControlLocked && window.__choreoGameControlLocked()) { toast('请先在双人面板停止本机演出，再开始预览'); return false; }
    stopMusic(); webWithoutMusic = true;
    if (!s.isPlaying && window.startPlay) window.startPlay();
    toast('本次无音乐网页排练，原歌曲引用保留；停止后恢复原选择'); refresh(); return true;
  }
  function rehearsalStatus() {
    syncProject();
    return { attached: !!selectedFile && currentProject(), hasReference: !!savedRef, selecting: !!pendingAudio, withoutMusic: isWebWithoutMusic() };
  }
  function webControl(action) {
    var s = store(); if (!ctl || !s || s.previewTarget === 'game') return false;
    syncProject();
    if (isWebWithoutMusic()) { if (action === 'stop') stopMusic(); return false; }
    if (!webState()) return false;
    if (ordinaryBlocked()) return true;
    if (action === 'stop') { stopMusic(); return true; }
    if (action === 'pause') { pauseMusic(); return true; }
    var st = webState();
    if (action === 'toggle' && (st.playing || st.pending)) { pauseMusic(); return true; }
    if (window.__choreoGameControlLocked && window.__choreoGameControlLocked()) { toast('请先在双人面板停止本机演出，再开始预览'); return true; }
    if (pendingAudio || !selectedFile) {
      toast(pendingAudio ? '音频正在核对，请完成选择后播放' : '请重新选择本项目的原音频，核对后再播放');
      if (window.showCheckModal) window.showCheckModal();
      else if (!pendingAudio) chooseFile();
      return true;
    }
    onPlay(st.paused); return true;
  }
  // —— 会话编辑：速度/拍号/预备拍/吸附选择（全部会话有效，pushSession 原子下发） ——
  function pushSession() {
    try {
      var t = TM(), se = session(); if (!t || !se || !ctl) return;
      var s = se.snapshot();
      ctl.setSessionTiming({ tempoMap: s.tempoMap, meterMap: s.meterMap });
      ctl.setCountIn(s.countIn);
      publishTargets();
    } catch (e) {}
  }
  function publishTargets() {
    try {
      var t = TM(), se = session(); if (!t || !se || !ctl) return;
      var s = se.snapshot(), st = ctl.state();
      window.ChoreoBeatTargets = { mode: s.snapMode, targets: t.beatTargetsSec({ tempoMap: s.tempoMap, bpm: st.settings.bpm, anchorMs: st.settings.anchorMs, offsetMs: st.settings.offsetMs, durMs: snapshot().durationMs, projMs: projMs() }), revision: s.version };
    } catch (e) {}
  }
  function parseTempo(str) {
    str = (str || '').trim(); if (!str) return [];
    var out = [];
    var parts = str.split(',');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(':');
      if (kv.length !== 2) return null;
      var a = Number(kv[0]), b = Number(kv[1]);
      if (!isFinite(a) || Math.round(a) !== a || a < 0 || !isFinite(b)) return null;
      out.push({ startMs: a, bpm: b });
    }
    return out;
  }
  function parseMeter(str) {
    str = (str || '').trim(); if (!str) return [];
    var t = TM(), out = [], parts = str.split(',');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(':');
      if (kv.length !== 2 || !t) return null;
      var nd = kv[1].split('/');
      if (nd.length !== 2) return null;
      var sb = Number(kv[0]), n = Number(nd[0]), d = Number(nd[1]);
      if (!isFinite(sb) || Math.round(sb) !== sb || sb < 0 || !isFinite(n) || !isFinite(d)) return null;
      out.push({ startBeat: sb, n: n, d: d });
    }
    return out;
  }
  function currentBeatAudio() {
    var t = TM(), se = session(); if (!t || !se || !ctl) return null;
    var s = se.snapshot(), st = ctl.state(), dur = snapshot().durationMs;
    var beats = t.isEmptyTempoMap(s.tempoMap) ? t.scalarBeats(st.settings.bpm, st.settings.anchorMs, st.settings.offsetMs, dur, projMs()) : t.evaluateTempoBeats(s.tempoMap, st.settings.anchorMs, st.settings.offsetMs, dur, projMs());
    return beats ? beats.map(function (b) { return b.audioMs; }) : null;
  }
  function editTempo() {
    var m = parseTempo($('musicTempo').value), se = session();
    if (m === null || !se) { $('musicErr').textContent = '速度格式应为“毫秒:速度”，多段用逗号分隔（如 250:120,2250:60），清空则恢复标量'; return; }
    var r = se.setTempoMap(m);
    if (!r.ok) { $('musicErr').textContent = r.error; return; }
    $('musicErr').textContent = ''; pushSession(); persist(); refresh();
  }
  function editMeter() {
    var m = parseMeter($('musicMeter').value), se = session();
    if (m === null || !se) { $('musicErr').textContent = '拍号格式应为“拍:分子/分母”，多段用逗号分隔（如 0:4/4,4:3/4），清空则恢复 4/4'; return; }
    var beats = currentBeatAudio();
    if (!beats || !beats.length) { $('musicErr').textContent = '先设置速度/BPM 并选择音频，再改拍号（拍号只能落在现有小节线上）'; return; }
    var r = se.setMeterMapChecked(beats, m);
    if (!r.ok) { $('musicErr').textContent = r.error; return; }
    $('musicErr').textContent = ''; pushSession(); persist(); refresh();
  }
  function editCount() {
    var se = session(); if (!se) return;
    var r = se.setCountIn({ enabled: !!$('musicCountOn').checked, bars: +$('musicCountBars').value || 0 });
    if (!r.ok) { $('musicErr').textContent = r.error; return; }
    $('musicErr').textContent = ''; pushSession(); refresh();
  }
  function resetSession() {
    var se = session(); if (se) se.reset();
    try { $('musicTempo').value = ''; $('musicMeter').value = ''; $('musicCountOn').checked = false; $('musicCountBars').value = '1'; $('musicSnap').value = 'time'; $('musicErr').textContent = ''; } catch (e) {}
    if (ctl) { ctl.setSessionTiming({ tempoMap: [], meterMap: [] }); ctl.setCountIn({ enabled: false }); }
    publishTargets(); persist(); refresh();
  }
  // 仅当前音乐的显式操作发布定位；idle 轮询不能抢占独立网页播放或手动拖动。
  function publishMusicTime() {
    var s = store();
    if (!s || !currentProject() || !selectedFile || selectedPid !== pidNow() || ensembleOwns() || s.isPlaying) return;
    s.currentTime = ctl.state().displayMs / 1000;
    if (window.updatePlayhead) window.updatePlayhead();
    if (window.updateTimeDisplay) window.updateTimeDisplay();
  }
  // 返回是否已接管定位；复用媒体映射与归属检查，不启动播放或改写编排。
  function seekFromTimeline(seconds) {
    var s = store();
    if (isWebWithoutMusic()) return false;
    if (!ctl || !s || s.previewTarget === 'game' || !isFinite(seconds) || seconds < 0) return false;
    if (ordinaryBlocked()) return true;
    if (pendingAudio || ordinaryPending) { toast('请先完成音乐操作，再定位时间轴'); return true; }
    if (s.isPlaying || !currentProject() || !selectedFile || selectedPid !== pidNow()) return false;
    var r = ctl.seek(Math.round(seconds * 1000));
    if (r && r.ok) publishMusicTime();
    refresh();
    return true;
  }
  function mount() {
    if (!M || typeof document === 'undefined' || document.getElementById('musicPanel')) return false;
    var panel = document.createElement('div'); panel.id = 'musicPanel'; panel.className = 'music-panel';
    // P4-A（#37/#38）：面板顶部新增收起条（music-bar），正文收进 music-body；复杂节拍参数（速度/拍号/
    // 预备拍/吸附/缩放）收「设置」折叠。控件 ID 与事件接线全部沿用，不复制控件、不改媒体时钟。
    panel.innerHTML = '<div class="music-bar" id="musicBar"><button id="musicToggle" type="button" class="btn">音乐 ▾</button><span id="musicMiniStatus" class="music-meta">未选择音乐</span><button id="musicChoose" type="button" class="btn">选择音乐文件…</button></div><div class="music-title">音乐排练（本地）</div><input id="musicFile" type="file" accept="audio/*"><div id="musicMeta" class="music-meta">未选择音频（原有时序不受影响）</div><div class="music-row"><button id="musicPlay" class="btn primary">播放</button><button id="musicPause" class="btn">暂停</button><button id="musicResume" class="btn">继续</button><button id="musicStop" class="btn danger">停止</button><button id="musicDetach" class="btn">移除</button></div><div id="musicTime" class="music-meta">时间 0ms</div><div class="music-row"><label>跳到<input id="musicSeek" type="number" min="0" step="100" value="0">ms</label><button id="musicSeekGo" class="btn">跳转</button></div><div class="music-row"><label>偏移ms<input id="musicOffset" type="number" step="1" value="0"></label><label>BPM<input id="musicBpm" type="text" placeholder="空=无标记"></label><label>首拍ms<input id="musicAnchor" type="number" step="1" value="0"></label></div><div id="musicErr" class="music-err"></div><div id="musicStatus" class="music-meta">已停止</div><div id="musicStrip" class="music-strip"></div><div id="musicBeats" class="music-beats"></div><canvas id="musicWave" width="300" height="48" class="music-wave"></canvas><div id="musicWaveMeta" class="music-meta"></div><div class="music-row"><label>缩放<select id="musicZoom"><option value="1">全部</option><option value="2">2x</option><option value="4">4x</option></select></label><span id="musicSessionTag" class="music-meta">编排随项目自动保存</span><button id="musicSessionReset" class="btn">重置速度/拍号/吸附</button></div><div class="music-row"><label>速度<input id="musicTempo" type="text" placeholder="250:120,2250:60"></label></div><div class="music-row"><label>拍号<input id="musicMeter" type="text" placeholder="0:4/4,4:3/4"></label></div><div class="music-row"><label><input id="musicCountOn" type="checkbox">预备拍</label><label>小节<input id="musicCountBars" type="number" min="1" max="4" value="1"></label><label>吸附<select id="musicSnap"><option value="time">时间</option><option value="beat">拍点</option><option value="action">动作</option><option value="off">关闭</option></select></label></div>';
    var bar = panel.querySelector('.music-bar');
    var summary=document.createElement('div');summary.className='music-summary';
    var settings=document.createElement('details');settings.className='music-settings';settings.id='musicSettings';
    var caption=document.createElement('summary');caption.textContent='设置';caption.title='复杂节拍参数：速度/拍号/预备拍/吸附/缩放（全部保留）';settings.appendChild(caption);
    var bodyEl=document.createElement('div');bodyEl.className='music-body';bodyEl.id='musicBody';
    // 使用现有节点，不复制控件、不改变原有事件 ID 与媒体时钟。
    var nodes=Array.prototype.slice.call(panel.children).filter(function(n){return n!==bar});
    nodes.forEach(function(n){
      if(n.className==='music-title'||n.id==='musicFile'||n.id==='musicMeta'||n.id==='musicTime')summary.appendChild(n);
      else if(n.querySelector&&(n.querySelector('#musicTempo')||n.querySelector('#musicMeter')||n.querySelector('#musicCountOn')||n.querySelector('#musicZoom')))settings.appendChild(n);
      else bodyEl.appendChild(n);
    });
    bodyEl.insertBefore(summary,bodyEl.firstChild);bodyEl.appendChild(settings);
    panel.appendChild(bodyEl);
    document.body.appendChild(panel);
    setOpen(readOpenPref()); // P4-A：默认收起；只回放用户显式选择
    if (window.ChoreoDock) window.ChoreoDock.layout(); // P3：挂载后即参与右下角停靠（3D 面板开着时挪到它左边）
    // 捕获阶段同时拦截点击、键盘引起的 change 和脚本派发，普通控制不干扰已占用的音频。
    function guardOrdinary(e) {
      syncProject();
      if (ordinaryControls.indexOf(e.target && e.target.id) < 0 || !ordinaryBlocked()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.target.id === 'musicOffset') e.target.value = String(ctl.state().settings.offsetMs);
    }
    panel.addEventListener('click', guardOrdinary, true);
    panel.addEventListener('change', guardOrdinary, true);
    audio = document.createElement('audio'); audio.preload = 'auto'; panel.appendChild(audio);
    ctl = M.createController({ media: function () { return mkMedia(audio); }, net: mkNet(), now: function () { return Date.now(); }, projectNow: pidNow, onCountBeat: function (c) { lastCountBeat = c; try { clickTick(); } catch (e) {} refresh(); } });
    projectLoaded();
    $('musicToggle').addEventListener('click', function () { toggleOpen(); });
    $('musicChoose').addEventListener('click', chooseFile);
    $('musicFile').addEventListener('change', function () {
      var f = $('musicFile').files && $('musicFile').files[0]; if (!f) return;
      setOpen(true, true); // P4-A（#37）：选文件即展开音乐区
      var t = TM(), valid = t.validateAudioSelection({ sizeBytes: f.size, mime: f.type || '' });
      if (!valid.ok) { $('musicErr').textContent = valid.error; return; }
      cancelSelection(); ctl.stop(); ensemble.stop(); waveStore().remove();
      var my = loadGeneration, extra = lastExtra, pid = pidNow(), candidate = document.createElement('audio');
      candidate.preload = 'auto'; var url = URL.createObjectURL(f); pendingAudio = candidate; pendingUrl = url;
      function current() { return my === loadGeneration && lastExtra === extra && pidNow() === pid && currentProject(); }
      function fail(message) { if (!current()) return; cancelSelection(); $('musicErr').textContent = message; refresh(); }
      candidate.oncanplay = async function () {
        candidate.oncanplay = null;
        if (!current()) return;
        try {
          var dur = Math.round(candidate.duration * 1000), v = t.validateAudioSelection({ sizeBytes: f.size, mime: f.type || '', durationMs: dur });
          if (!v.ok) { fail(v.error); return; }
          var fp = await fpOf(f, dur); if (!current()) return;
          function accept() {
            if (!current() || ordinaryBlocked()) return;
            var v = M.validateAnchor(ctl.state().settings.anchorMs, dur);
            if (!v.ok) { fail(v.error); return; }
            ctl.stop(); var r = ctl.attach({ fingerprint: fp.fingerprint, durationMs: dur });
            if (!r.ok) { fail(r.error); return; }
            var old = audio; audio = candidate; candidate.onerror = null; pendingAudio = null; pendingUrl = null;
            if (objUrl) URL.revokeObjectURL(objUrl); objUrl = url; old.pause(); old.removeAttribute('src'); old.load(); old.remove(); panel.appendChild(audio); bindMedia(audio);
            curFp = fp.fingerprint; savedRef = { fingerprint: curFp, size: f.size, durationMs: dur }; selectedFile = f; selectedPid = pid;
            if (webWithoutMusic && store() && store().isPlaying && window.pausePlay) window.pausePlay();
            webWithoutMusic = false;
            var rb = $('musicReplace'); if (rb) rb.remove(); $('musicErr').textContent = '';
            var ws = waveStore(), sel = ws.select({ sizeBytes: f.size, mime: f.type || '' });
            persist(); decodeForWave(f, sel.gen, dur); publishTargets(); refresh();
          }
          if (savedRef && savedRef.fingerprint !== fp.fingerprint) {
            var legacyMatch = savedRef.fingerprint === fp.legacyFingerprint;
            $('musicErr').textContent = legacyMatch ? '旧引用只有抽样指纹，无法核对完整内容；请确认是原音频后升级引用' : '音频内容不匹配，原引用和编排保留；确认换歌才点“替换”';
            var btn = document.createElement('button'); btn.id = 'musicReplace'; btn.className = 'btn danger'; btn.textContent = legacyMatch ? '确认原音频' : '替换'; btn.onclick = accept; panel.appendChild(btn); refresh();
          } else accept();
        } catch (e) { fail('音频内容核对失败，已保留原引用：' + e.message); }
      };
      candidate.onerror = function () { fail('音频无法解码，已保留原引用'); }; candidate.src = url;
    });
    function editSetting(patch) { var r = ctl.setSettings(patch); if (!r.ok) { $('musicErr').textContent = r.error; return; } $('musicErr').textContent = ''; persist(); publishTargets(); refresh(); if (r.paused) toast('已暂停，点继续显式恢复'); }
    $('musicOffset').addEventListener('change', function () { editSetting({ offsetMs: $('musicOffset').value }); });
    $('musicBpm').addEventListener('change', function () { editSetting({ bpm: $('musicBpm').value }); });
    $('musicAnchor').addEventListener('change', function () { editSetting({ anchorMs: $('musicAnchor').value }); });
    $('musicTempo').addEventListener('change', editTempo);
    $('musicMeter').addEventListener('change', editMeter);
    $('musicCountOn').addEventListener('change', editCount);
    $('musicCountBars').addEventListener('change', editCount);
    $('musicSnap').addEventListener('change', function () { var se = session(); if (!se) return; var r = se.setSnapMode($('musicSnap').value); if (!r.ok) { $('musicErr').textContent = r.error; return; } $('musicErr').textContent = ''; publishTargets(); persist(); refresh(); });
    $('musicSessionReset').addEventListener('click', resetSession);
    $('musicZoom').addEventListener('change', function () { drawWave(); });
    $('musicDetach').addEventListener('click', function () { var ws = waveStore(); if (ws) ws.remove(); if ($('musicWaveMeta')) $('musicWaveMeta').textContent = ''; });
    $('musicPlay').addEventListener('click', onPlay);
    $('musicPause').addEventListener('click', pauseMusic);
    $('musicResume').addEventListener('click', function () { return onPlay(true); });
    $('musicStop').addEventListener('click', async function () {
      if (isWebWithoutMusic()) { if (window.stopPlay) window.stopPlay(); refresh(); return; }
      var st = ctl.state();
      if (st.needStopRetry || st.gameUnknown) {
        var retried = await ctl.stopRetry(); if (retried.failed) toast(retried.error);
      } else { stopMusic(); }
      refresh();
    });
    $('musicDetach').addEventListener('click', function () { cancelSelection(); ensemble.stop(); ctl.stop(); selectedFile = null; selectedPid = null; ctl.detach(); curFp = null; savedRef = null; if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} objUrl = null; } try { audio.removeAttribute('src'); audio.load(); } catch (e) {} persist(); refresh(); });
    $('musicSeekGo').addEventListener('click', function () {
      if (isWebWithoutMusic()) { if (window.seekTimelinePosition) window.seekTimelinePosition(Math.max(0, +$('musicSeek').value || 0) / 1000); refresh(); return; }
      var r = ctl.seek(+$('musicSeek').value || 0); if (r && r.ok) publishMusicTime(); if (r && r.paused) toast('游戏侧已暂停，点播放显式恢复'); refresh();
    });
    function bindMedia(a) {
      [['ended', 'onMediaEnded'], ['error', 'onMediaError'], ['waiting', 'onStall'], ['stalled', 'onStall']].forEach(function (pair) {
        a.addEventListener(pair[0], function () { if (a !== audio || !selectedFile || !currentProject()) return; ctl[pair[1]](); refresh(); });
      });
    }
    bindMedia(audio);
    document.addEventListener('visibilitychange', function () { if (document.hidden) { ctl.onHidden(); refresh(); } });
    // 50ms 采样显示：映射公式不变，仅缩短显示滞后以稳合浏览器 ±100ms 采样容差。
    var tick = setInterval(function () {
      try {
        syncProject();
        if (!ensembleOwns()) ctl.onTick(projMs());
        var st = ctl.state(), s = store();
        if (s && (st.mode === 'web' || st.mode === 'game')) { s.currentTime = st.displayMs / 1000; if (window.updatePlayhead) window.updatePlayhead(); if (window.updateTimeDisplay) window.updateTimeDisplay(); }
        refresh();
      } catch (e) {}
    }, 50);
    if (tick && tick.unref) tick.unref();
    if (root.addEventListener) root.addEventListener('pagehide', function () { ensemble.stop(); });
    pushSession();
    refresh();
    return true;
  }
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoMusicUI = { mount: mount, projectLoaded: projectLoaded, seekFromTimeline: seekFromTimeline, webControl: webControl, webState: webState, chooseFile: chooseFile, rehearsalStatus: rehearsalStatus, rehearseWithoutMusic: rehearseWithoutMusic, isWebWithoutMusic: isWebWithoutMusic, toggleOpen: toggleOpen, isOpen: function () { return musicOpen; }, stopNow: function () {
    var errors = [], ensembleResult;
    try { if (ctl) stopMusic(); } catch (e) { errors.push('音乐停止失败'); }
    try { ensembleResult = ensemble.stop(); if (ensembleResult && ensembleResult.ok === false) errors.push('双人音频停止失败'); }
    catch (e) { ensembleResult = { ok: false, message: '双人音频停止失败' }; errors.push('双人音频停止失败'); }
    if (ctl) refresh();
    return { ok: errors.length === 0, errors: errors, ensembleResult: ensembleResult };
  }, ensemble: ensemble, debug: { snapshot: snapshot } };
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();
