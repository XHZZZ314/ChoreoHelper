// 会话内音乐时序纯模块：波形峰值/分段速度/拍号/预备拍/吸附与会话栈（REQ-SPEC-009 第二增量，会话有效不落盘）。
'use strict';
(function () {
  var LIMITS = { maxFileBytes: 67108864, maxDurationMs: 900000, maxChannels: 2, maxPeakBuckets: 4096, maxPaintTargets: 2048, maxSegments: 128, bpmMin: 1, bpmMax: 600, numMin: 1, numMax: 12, denoms: [1, 2, 4, 8, 16], countInMin: 1, countInMax: 4, snapThresholdSec: 0.3, sessionUndoMax: 50 };
  var SNAP_MODES = ['time', 'beat', 'action', 'off'];
  var EPS = 1e-9;
  function zh(s) { return s; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.round(x) === x; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toInt(v) { if (typeof v === 'string' && v.trim() !== '') v = Number(v); return v; }
  // —— 波形：选择校验（中文、原子）/峰值分桶/像素映射 ——
  function validateAudioSelection(meta) {
    meta = meta || {};
    var size = meta.sizeBytes;
    if (!isNum(size) || !(size > 0)) return { ok: false, error: zh('音频文件无效，已保留原引用（原有时序不受影响）') };
    if (size > LIMITS.maxFileBytes) return { ok: false, error: zh('音频文件过大（超过64MiB），已保留原引用（原有时序不受影响）') };
    if (typeof meta.mime === 'string' && meta.mime !== '' && meta.mime.indexOf('audio/') !== 0) return { ok: false, error: zh('不支持的音频格式，已保留原引用（原有时序不受影响）') };
    if (meta.durationMs !== null && meta.durationMs !== undefined) {
      if (!isNum(meta.durationMs) || !(meta.durationMs > 0)) return { ok: false, error: zh('音频无法解码，已保留原引用（原有时序不受影响）') };
      if (meta.durationMs > LIMITS.maxDurationMs) return { ok: false, error: zh('音频过长（超过15分钟），已保留原引用（原有时序不受影响）') };
    }
    if (meta.channels !== null && meta.channels !== undefined && (!isInt(meta.channels) || meta.channels < 1 || meta.channels > LIMITS.maxChannels)) return { ok: false, error: zh('仅支持单声道或立体声，已保留原引用（原有时序不受影响）') };
    return { ok: true };
  }
  function computePeaks(channels, bucketCount) {
    if (!channels || !channels.length || !channels[0] || !channels[0].length) return { peaks: [], buckets: 0 };
    var n = channels[0].length, buckets = Math.min(Math.max(1, Math.floor(bucketCount) || 1), LIMITS.maxPeakBuckets), peaks = [];
    for (var b = 0; b < buckets; b++) {
      var s0 = Math.floor(b * n / buckets), s1 = Math.max(s0 + 1, Math.floor((b + 1) * n / buckets)), pk = 0;
      for (var c = 0; c < channels.length; c++) { var ch = channels[c]; if (!ch) continue; for (var s = s0; s < s1 && s < ch.length; s++) { var v = Math.abs(ch[s]); if (v > pk) pk = v; } }
      peaks.push(pk > 1 ? 1 : pk);
    }
    return { peaks: peaks, buckets: buckets };
  }
  function timelineToPixel(tMs, projMs, widthPx) { if (!(projMs > 0) || !isNum(widthPx)) return 0; return tMs / projMs * widthPx; }
  function audioToPixel(aMs, offsetMs, projMs, widthPx) { return timelineToPixel(aMs - offsetMs, projMs, widthPx); }
  function createWaveformStore() {
    var generation = 0, peaks = [], fingerprint = null, decoding = false;
    return {
      state: function () { return { generation: generation, peaks: peaks, buckets: peaks.length, hasPeaks: peaks.length > 0, decoding: decoding, fingerprint: fingerprint }; },
      select: function (meta) { var r = validateAudioSelection(meta); if (!r.ok) return r; generation++; decoding = false; peaks = []; fingerprint = null; return { ok: true, gen: generation }; },
      beginDecode: function (gen) { if (gen !== generation) return { ok: false, stale: true }; if (decoding) return { ok: false, error: zh('解码已在进行，请等待完成（原有时序不受影响）') }; decoding = true; return { ok: true }; },
      completeDecode: function (gen, info) {
        if (gen !== generation) return { ok: false, stale: true };
        info = info || {};
        var r = validateAudioSelection({ sizeBytes: 1, durationMs: info.durationMs, channels: info.channels, mime: 'audio/x' });
        if (!r.ok) { decoding = false; return r; }
        var p = computePeaks(info.channelData, LIMITS.maxPeakBuckets);
        decoding = false; peaks = p.peaks; fingerprint = info.fingerprint || null;
        return { ok: true, buckets: p.buckets };
      },
      remove: function () { generation++; decoding = false; peaks = []; fingerprint = null; return { ok: true }; }
    };
  }
  // —— 分段速度：音频域起点毫秒/四分音符BPM，锚点H为相位零点，跨段保持相位 ——
  function validateTempoMap(entries) {
    if (!Array.isArray(entries)) return { ok: false, error: zh('速度映射必须是数组（已保留原映射）') };
    if (entries.length > LIMITS.maxSegments) return { ok: false, error: zh('速度分段过多（最多128段，已保留原映射）') };
    var out = [], prev = -1;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e !== 'object') return { ok: false, error: zh('第' + (i + 1) + '段不是对象（已保留原映射）') };
      if (!isInt(e.startMs) || e.startMs < 0) return { ok: false, error: zh('第' + (i + 1) + '段起点必须是不小于0的整数毫秒（已保留原映射）') };
      if (!isNum(e.bpm) || e.bpm < LIMITS.bpmMin || e.bpm > LIMITS.bpmMax) return { ok: false, error: zh('第' + (i + 1) + '段BPM必须是1～600的数字（已保留原映射）') };
      if (e.startMs <= prev) return { ok: false, error: zh('速度分段起点必须严格递增（已保留原映射）') };
      prev = e.startMs; out.push({ startMs: e.startMs, bpm: e.bpm });
    }
    return { ok: true, map: out };
  }
  function isEmptyTempoMap(map) { return !map || !map.length; }
  function segIndexAt(segs, a) { var idx = 0; for (var i = 0; i < segs.length; i++) if (segs[i].startMs <= a + EPS) idx = i; return idx; }
  function evalBeats(segs, anchorMs, offsetMs, durMs, projMs, max) {
    var cap = max || 4096, beats = [];
    if (!(durMs > 0) || anchorMs > durMs + EPS) return beats;
    function push(a, idx, si) { var t = a - offsetMs; beats.push({ index: idx, audioMs: a, timelineMs: t, render: t >= 0 && t <= projMs, segment: si }); }
    var si = segIndexAt(segs, anchorMs), last = anchorMs;
    push(last, 0, si);
    while (beats.length < cap) {
      var period = 60000 / segs[si].bpm, nextB = si + 1 < segs.length ? segs[si + 1].startMs : Infinity, cand = last + period, nb;
      if (nextB <= cand + EPS && nextB !== Infinity) {
        if (nextB > durMs + EPS) break;
        if (Math.abs(nextB - cand) <= EPS) { last = nextB; si++; push(last, beats.length, si); }
        else { var phase = (nextB - last) / period, np = 60000 / segs[si + 1].bpm; si++; nb = nextB + (1 - phase) * np; if (nb > durMs + EPS) break; last = nb; push(last, beats.length, si); }
      } else { if (cand > durMs + EPS) break; last = cand; push(last, beats.length, si); }
    }
    return beats;
  }
  function evaluateTempoBeats(map, anchorMs, offsetMs, durMs, projMs, max) {
    if (isEmptyTempoMap(map)) return null;
    var r = validateTempoMap(map);
    if (!r.ok) return null;
    return evalBeats(r.map, anchorMs, offsetMs, durMs, projMs, max);
  }
  function scalarBeats(bpm, anchorMs, offsetMs, durMs, projMs, max) {
    if (bpm === null || bpm === undefined) return [];
    var cap = max || 4096, out = [], step = 60000 / bpm, n = 0;
    while (n < cap) { var a = anchorMs + n * step; if (a > durMs + EPS) break; var t = a - offsetMs; out.push({ index: n, audioMs: a, timelineMs: t, render: t >= 0 && t <= projMs, segment: 0 }); n++; }
    return out;
  }
  function resolveTempoAt(map, audioMs, scalarBpm) {
    if (!isEmptyTempoMap(map)) { var r = validateTempoMap(map); if (r.ok) { var segs = r.map, s = segs[segIndexAt(segs, audioMs)]; return { bpm: s.bpm, segment: segIndexAt(segs, audioMs) }; } }
    return { bpm: (isNum(scalarBpm) ? scalarBpm : null), segment: -1 };
  }
  // —— 拍号：条目锚定拍序号，变更加在既有小节线上；分母控制计数与成组 ——
  function validateMeterMap(entries) {
    if (!Array.isArray(entries)) return { ok: false, error: zh('拍号映射必须是数组（已保留原映射）') };
    if (entries.length > LIMITS.maxSegments) return { ok: false, error: zh('拍号分段过多（最多128段，已保留原映射）') };
    var out = [], prev = -1;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e !== 'object') return { ok: false, error: zh('第' + (i + 1) + '段不是对象（已保留原映射）') };
      if (!isInt(e.startBeat) || e.startBeat < 0) return { ok: false, error: zh('第' + (i + 1) + '段起始拍必须是不小于0的整数（已保留原映射）') };
      if (!isInt(e.n) || e.n < LIMITS.numMin || e.n > LIMITS.numMax) return { ok: false, error: zh('第' + (i + 1) + '段拍号分子必须是1～12的整数（已保留原映射）') };
      if (LIMITS.denoms.indexOf(e.d) < 0) return { ok: false, error: zh('第' + (i + 1) + '段拍号分母必须是1/2/4/8/16（已保留原映射）') };
      if (e.startBeat <= prev) return { ok: false, error: zh('拍号分段起始拍必须严格递增（已保留原映射）') };
      prev = e.startBeat; out.push({ startBeat: e.startBeat, n: e.n, d: e.d });
    }
    if (out.length && out[0].startBeat !== 0) return { ok: false, error: zh('首个拍号必须从第0拍开始（已保留原映射）') };
    return { ok: true, map: out };
  }
  function beatsPerBar(seg) { return seg.n * 4 / seg.d; }
  function resolveMeterAt(map, beatIndex) {
    var r = validateMeterMap(map || []);
    if (r.ok && r.map.length) { var cur = r.map[0]; for (var i = 0; i < r.map.length; i++) if (r.map[i].startBeat <= beatIndex) cur = r.map[i]; return { startBeat: cur.startBeat, n: cur.n, d: cur.d }; }
    return { startBeat: 0, n: 4, d: 4 };
  }
  function computeBars(beatAudioList, meterMap) {
    var r = validateMeterMap(meterMap || []);
    var segs = r.ok && r.map.length ? r.map : [{ startBeat: 0, n: 4, d: 4 }];
    var bars = [], labels = [], si = 0, barNo = 1, barStart = 0, quarters = 0;
    bars.push({ bar: 1, startBeat: 0, startAudioMs: beatAudioList.length ? beatAudioList[0] : 0, n: segs[0].n, d: segs[0].d });
    for (var i = 0; i < beatAudioList.length; i++) {
      var atSeg = si;
      for (var k = 0; k < segs.length; k++) if (segs[k].startBeat <= i) atSeg = k;
      if (atSeg !== si && i > 0) { si = atSeg; barNo++; barStart = i; quarters = 0; bars.push({ bar: barNo, startBeat: i, startAudioMs: beatAudioList[i], n: segs[si].n, d: segs[si].d }); }
      else if (quarters + EPS >= beatsPerBar(segs[si]) && i > barStart) { barNo++; barStart = i; quarters = 0; bars.push({ bar: barNo, startBeat: i, startAudioMs: beatAudioList[i], n: segs[si].n, d: segs[si].d }); }
      labels.push({ bar: barNo, beat: quarters + 1 });
      quarters += 1;
    }
    return { bars: bars, labels: labels };
  }
  function isBarBoundary(beatIndex, bars) {
    if (beatIndex === 0) return true;
    for (var i = 0; i < bars.length; i++) if (bars[i].startBeat === beatIndex) return true;
    return false;
  }
  // —— 预备拍：纯调度（墙钟偏移），节拍缺失不编造 ——
  function validateCountIn(sel) {
    sel = sel || {};
    if (sel.enabled !== true) return { ok: true, sel: { enabled: false, bars: 0 } };
    var b = toInt(sel.bars);
    if (!isInt(b) || b < LIMITS.countInMin || b > LIMITS.countInMax) return { ok: false, error: zh('预备拍小节数必须是1～4的整数（已保留原设置）') };
    return { ok: true, sel: { enabled: true, bars: b } };
  }
  function computeCountInSchedule(o) {
    o = o || {};
    var b = toInt(o.bars);
    if (!isInt(b) || b < 1) return { ok: false, error: zh('预备拍小节数无效，无法排期（原有时序不受影响）') };
    if (!isNum(o.bpm) || o.bpm < LIMITS.bpmMin || o.bpm > LIMITS.bpmMax) return { ok: false, error: zh('设置BPM后才能预备拍（原有时序不受影响）') };
    var n = o.n, d = o.d;
    if (!isInt(n) || n < 1 || LIMITS.denoms.indexOf(d) < 0) return { ok: false, error: zh('预备拍拍号无效，无法排期（原有时序不受影响）') };
    var spacing = 60000 / o.bpm * 4 / d, total = b * n, clicks = [];
    for (var k = 0; k < total; k++) clicks.push({ offsetMs: k * spacing, bar: Math.floor(k / n) + 1, beat: k % n + 1, label: '第' + (Math.floor(k / n) + 1) + '小节第' + (k % n + 1) + '拍' });
    return { ok: true, clicks: clicks, totalMs: total * spacing, totalClicks: total, spacingMs: spacing };
  }
  // —— 会话栈：瞬态速度/拍号/预备拍/吸附选择，本地撤销，永不进项目历史 ——
  function createTimingSession() {
    var S = { tempoMap: [], meterMap: [], countIn: { enabled: false, bars: 0 }, snapMode: 'time', version: 0 }, undo = [], redo = [];
    function push(kind, before) { undo.push({ kind: kind, before: before, after: clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }) }); if (undo.length > LIMITS.sessionUndoMax) undo.shift(); redo = []; S.version++; }
    function apply(snap) { S.tempoMap = clone(snap.tempoMap); S.meterMap = clone(snap.meterMap); S.countIn = clone(snap.countIn); S.snapMode = snap.snapMode; }
    return {
      snapshot: function () { return { tempoMap: clone(S.tempoMap), meterMap: clone(S.meterMap), countIn: clone(S.countIn), snapMode: S.snapMode, version: S.version }; },
      canUndo: function () { return undo.length > 0; },
      canRedo: function () { return redo.length > 0; },
      setTempoMap: function (map) { var r = validateTempoMap(map); if (!r.ok) return r; var before = clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }); S.tempoMap = r.map; push('tempo', before); return { ok: true }; },
      setMeterMap: function (map) { var r = validateMeterMap(map); if (!r.ok) return r; var before = clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }); S.meterMap = r.map; push('meter', before); return { ok: true }; },
      setMeterMapChecked: function (beats, map) {
        var r = validateMeterMap(map);
        if (!r.ok) return r;
        var cur = S.meterMap.length ? S.meterMap : [{ startBeat: 0, n: 4, d: 4 }];
        var bars = computeBars(beats || [], cur).bars, bad = -1;
        for (var i = 0; i < r.map.length; i++) if (r.map[i].startBeat > 0 && !isBarBoundary(r.map[i].startBeat, bars)) { bad = r.map[i].startBeat; break; }
        if (bad >= 0) return { ok: false, error: zh('拍号只能落在现有小节线上（第' + (bad + 1) + '拍不是小节线，已保留原映射）') };
        var before = clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }); S.meterMap = r.map; push('meter', before); return { ok: true };
      },
      setCountIn: function (sel) { var r = validateCountIn(sel); if (!r.ok) return r; var before = clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }); S.countIn = r.sel; push('countin', before); return { ok: true }; },
      setSnapMode: function (m) { if (SNAP_MODES.indexOf(m) < 0) return { ok: false, error: zh('吸附模式必须是时间/拍点/动作/关闭之一（已保留原选择）') }; var before = clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }); S.snapMode = m; push('snap', before); return { ok: true }; },
      undo: function () { if (!undo.length) return { ok: false, error: zh('没有可撤销的会话修改') }; var e = undo.pop(); redo.push({ kind: e.kind, before: clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }), after: e.after }); apply(e.before); S.version++; return { ok: true, kind: e.kind }; },
      redo: function () { if (!redo.length) return { ok: false, error: zh('没有可重做的会话修改') }; var e = redo.pop(); undo.push({ kind: e.kind, before: clone({ tempoMap: S.tempoMap, meterMap: S.meterMap, countIn: S.countIn, snapMode: S.snapMode }), after: e.after }); apply(e.after); S.version++; return { ok: true, kind: e.kind }; },
      reset: function () { S.tempoMap = []; S.meterMap = []; S.countIn = { enabled: false, bars: 0 }; S.snapMode = 'time'; undo = []; redo = []; S.version++; return { ok: true }; }
    };
  }
  // —— 吸附：提交边等于有效拍点仅当距离严格小于阈值，等距取更早 ——
  function beatTargetsSec(o) {
    o = o || {};
    var beats = isEmptyTempoMap(o.tempoMap) ? scalarBeats(o.bpm, o.anchorMs || 0, o.offsetMs || 0, o.durMs || 0, o.projMs || 0) : evaluateTempoBeats(o.tempoMap, o.anchorMs || 0, o.offsetMs || 0, o.durMs || 0, o.projMs || 0);
    if (!beats) beats = [];
    return beats.filter(function (b) { return b.render; }).map(function (b) { return b.timelineMs / 1000; });
  }
  function snapBeatEdge(tSec, targetsSec, thresholdSec) {
    var th = isNum(thresholdSec) && thresholdSec > 0 ? thresholdSec : LIMITS.snapThresholdSec;
    var list = (targetsSec || []).slice().sort(function (a, b) { return a - b; });
    var best = null, bestD = th;
    for (var i = 0; i < list.length; i++) { var d = Math.abs(list[i] - tSec); if (d < bestD) { bestD = d; best = list[i]; } }
    if (best === null) return { snapped: false };
    return { snapped: true, target: best };
  }
  var API = { LIMITS: LIMITS, SNAP_MODES: SNAP_MODES.slice(),
    validateAudioSelection: validateAudioSelection, computePeaks: computePeaks,
    timelineToPixel: timelineToPixel, audioToPixel: audioToPixel, createWaveformStore: createWaveformStore,
    validateTempoMap: validateTempoMap, isEmptyTempoMap: isEmptyTempoMap, evaluateTempoBeats: evaluateTempoBeats,
    scalarBeats: scalarBeats, resolveTempoAt: resolveTempoAt,
    validateMeterMap: validateMeterMap, computeBars: computeBars, isBarBoundary: isBarBoundary, resolveMeterAt: resolveMeterAt,
    validateCountIn: validateCountIn, computeCountInSchedule: computeCountInSchedule, createTimingSession: createTimingSession,
    beatTargetsSec: beatTargetsSec, snapBeatEdge: snapBeatEdge };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoMusicTiming = API;
})();
