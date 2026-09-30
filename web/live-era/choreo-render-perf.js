// 渲染性能纯模块：统一渲染时钟（单 rAF 链 + 脏标记 + 一次脏检查刷帧）与时间轴横向窗口化
// （visibleRange/visibleClips/visibleTicks）。纯状态、无 DOM、无网络、无 store，node 可直接单测。
'use strict';
(function () {
  var DEFAULT_OVERSCAN_SEC = 2; // 可见窗口左右各多取的秒数（默认 2s）
  var MAX_TICKS = 20000;        // 刻度硬上限：任何异常入参都不会把渲染拖死

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { return isNum(v) ? v : d; }
  function pos(v, d) { return isNum(v) && v > 0 ? v : d; }

  // —— 统一渲染时钟 ——
  // 同一时刻最多一个待触发 rAF；一帧内的 N 次 requestFrame() 只产生一次回调；
  // commit() 只在值真的变了才落 DOM（值相同 → 零写入）。
  function createClock(opts) {
    opts = opts || {};
    var rafCall = typeof opts.requestAnimationFrame === 'function' ? opts.requestAnimationFrame : null;
    var cafCall = typeof opts.cancelAnimationFrame === 'function' ? opts.cancelAnimationFrame : null;
    var onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null;
    var onFlush = typeof opts.onFlush === 'function' ? opts.onFlush : null;
    var rafId = null, frameCount = 0, writes = 0, running = false;
    var dirty = Object.create(null), dirtyKeys = [], committed = Object.create(null);

    function schedule() {
      if (rafId !== null) return rafId; // 已有待触发帧：绝不排第二条链
      if (!rafCall) return null;
      rafId = rafCall(tick);
      return rafId;
    }
    function tick() {
      rafId = null;
      frameCount++;
      if (onFrame) onFrame(frameCount);
      flush();
      if (running) schedule();
    }
    function mark(key) { if (!dirty[key]) { dirty[key] = true; dirtyKeys.push(key); } return true; }
    function isDirty(key) { return !!dirty[key]; }
    function clearDirty() { for (var i = 0; i < dirtyKeys.length; i++) delete dirty[dirtyKeys[i]]; dirtyKeys.length = 0; }
    // 脏检查写入：与上次落盘值相同则完全不调用 apply（零 DOM 写入）
    function commit(key, value, apply) {
      if (key in committed && committed[key] === value) return false;
      committed[key] = value;
      writes++;
      if (apply) apply(value);
      return true;
    }
    function flush() {
      if (onFlush) onFlush();
      clearDirty();
      return writes;
    }
    return {
      requestFrame: schedule,
      start: function () { if (running) return false; running = true; schedule(); return true; },
      stop: function () { var had = rafId !== null; running = false; if (had && cafCall) cafCall(rafId); rafId = null; return had; },
      flush: flush,
      pendingRaf: function () { return rafId === null ? 0 : 1; },
      rafId: function () { return rafId; },
      isRunning: function () { return running; },
      frameCount: function () { return frameCount; },
      mark: mark, dirty: isDirty, clearDirty: clearDirty,
      commit: commit,
      committed: function (key) { return committed[key]; },
      forget: function (key) { delete committed[key]; },
      writeCount: function () { return writes; },
      reset: function () { clearDirty(); committed = Object.create(null); writes = 0; frameCount = 0; }
    };
  }

  // —— 时间轴横向窗口 ——
  // 轨道内片段的 x 起点是 t*pps，画布坐标还要加标签列宽，所以可见时间窗是
  // [(scrollLeft-LABEL_W)/pps, (scrollLeft+viewportPx-LABEL_W)/pps]，两侧再各加 overscanSec。
  function visibleRange(o) {
    o = o || {};
    var pps = pos(o.pps, 1);
    var labelW = num(o.labelW, 0);
    var scrollLeft = num(o.scrollLeft, 0);
    var viewportPx = Math.max(0, num(o.viewportPx, 0));
    var overscanSec = Math.max(0, num(o.overscanSec, DEFAULT_OVERSCAN_SEC));
    var rawStart = (scrollLeft - labelW) / pps, rawEnd = (scrollLeft + viewportPx - labelW) / pps;
    var start = rawStart - overscanSec, end = rawEnd + overscanSec;
    if (start < 0) start = 0;
    if (end < start) end = start;
    // startRaw/endRaw 是没加 overscan 的严格可见窗口：片段用加过余量的 start/end，刻度用严格窗口
    return { start: start, end: end, startRaw: rawStart, endRaw: rawEnd, pps: pps, overscanSec: overscanSec, viewportPx: viewportPx };
  }

  // 手势（拖动/拉长）期间 suspended=true：整段手势都不裁剪，被拖的节点不会被中途移除
  function visibleClips(clips, range, o) {
    o = o || {};
    var list = clips || [];
    if (o.suspended) return list.slice();
    var r = range || visibleRange({});
    var s = num(r.start, 0), e = num(r.end, 0);
    if (!(e > s)) return [];
    return list.filter(function (c) {
      if (!c) return false;
      var st = num(c.start, 0), dur = num(c.duration, 0);
      var en = st + (dur > 0 ? dur : 0);
      return en > s && st < e;
    });
  }

  // 刻度按 minor 网格对齐（k*minor），与旧的累加循环同一套落点；总数只跟视口有关，与项目总长无关
  function visibleTicks(range, o) {
    o = o || {};
    var r = range || visibleRange({});
    var minor = pos(o.minorSec, 1);
    var major = pos(o.majorSec, minor * 5);
    var total = Math.max(0, num(o.totalDuration, 0));
    // 刻度按严格可见窗口生成（不需要 overscan 余量），条数只跟视口有关
    var s = Math.max(0, num(r.startRaw, num(r.start, 0))), e = num(r.endRaw, num(r.end, s));
    if (o.suspended || !(e > s)) e = total; // 不裁剪：铺满整个项目
    if (e < s) e = s;
    var out = [], first = Math.ceil(s / minor - 1e-9), last = Math.floor(e / minor + 1e-9);
    var eps = Math.max(1e-6, major * 1e-6);
    for (var k = first; k <= last && out.length < MAX_TICKS; k++) {
      var t = k * minor;
      if (t < 0) continue;
      if (total > 0 && t > total + 1e-9) break;
      out.push({ t: t, major: (t % major) < eps || (major - (t % major)) < eps });
    }
    return out;
  }

  var API = {
    DEFAULT_OVERSCAN_SEC: DEFAULT_OVERSCAN_SEC,
    createClock: createClock,
    visibleRange: visibleRange,
    visibleClips: visibleClips,
    visibleTicks: visibleTicks
  };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoRenderPerf = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})();
