/* choreo-edit.js —— 时间轴编辑基础纯函数层（WP-3 第二增量，v0.7）
这个文件是干嘛的：
  「多选/框选/复制粘贴/批量平移/对齐/插入删除时间/段落标记/独奏静音」这些编辑操作里
  所有能离开 DOM 单独测的数据变换，全部收进这里。主页控制器（choreo-app.js）负责
  按钮/鼠标/键盘和渲染，3D 面板（preview3d.js）只用 isMuted 过滤静音舞者；
  node 单测 web\test-edit.js 直接 require 本文件跑纯函数。
  约定：content = { dancers, globalLyrics, markers }；dancers[i] 有 switchClips /
  actionClips / lyricClips 三轨；clip = { id, start, duration, autoDur?, data, selected? }；
  markers = [{ id, t, name }]。函数一律原地修改传入对象并返回它/统计，UI 一行调用、测试好断言。
无依赖，经典脚本 IIFE（file:// 双击可用），挂 window.ChoreoEdit / globalThis.ChoreoEdit。
*/
(function () {
  'use strict';

  var TRACKS = ['switch', 'action', 'lyric'];
  var EPS = 1e-9;

  // 全项目统一的 0.5 秒量化（拖动/微调/插入删除时长同口径）
  function q05(x) { return Math.round(x * 2) / 2; }

  // ---------- 遍历/选中 ----------
  // 依次回调每个 clip：cb(clip, di, track)。track: 'switch'|'action'|'lyric'|'global'（global=全局歌词轨，di=-1）
  function eachClip(content, cb) {
    var ds = (content && content.dancers) || [];
    for (var di = 0; di < ds.length; di++) {
      var d = ds[di];
      for (var i = 0; i < TRACKS.length; i++) {
        var arr = d[TRACKS[i] + 'Clips'] || [];
        for (var k = 0; k < arr.length; k++) cb(arr[k], di, TRACKS[i]);
      }
    }
    var gl = (content && content.globalLyrics) || [];
    for (var g = 0; g < gl.length; g++) cb(gl[g], -1, 'global');
  }
  // 收集所有选中条：[{clip, di, track}]
  function collectSelected(content) {
    var out = [];
    eachClip(content, function (c, di, tt) { if (c.selected) out.push({ clip: c, di: di, track: tt }); });
    return out;
  }
  function clearSelection(content) {
    var n = 0;
    eachClip(content, function (c) { if (c.selected) { c.selected = false; n++; } });
    return n;
  }
  function selectAll(content) {
    var n = 0;
    eachClip(content, function (c) { if (!c.selected) { c.selected = true; n++; } });
    return n;
  }

  // ---------- 批量平移 / 对齐 ----------
  // 整组平移（AUD-008）：先按全组最早 start / 最晚 end 算一个公共允许 delta，整组一起钳制——
  // 任何条触边时整组一起停，两两相对间距保持不变（旧版逐条钳制会把间距压扁）。
  // delta 的 0.5s 量化由调用方负责（拖动路径已吸附+量化）。返回实际应用的 delta。
  function moveGroup(items, delta, totalDuration) {
    items = items || [];
    if (!items.length || !(delta > 0 || delta < 0)) return 0;
    var minS = Infinity, maxE = -Infinity;
    items.forEach(function (it) {
      var c = it.clip || it;
      if (c.start < minS) minS = c.start;
      if (c.start + c.duration > maxE) maxE = c.start + c.duration;
    });
    var lo = -minS, hi = (totalDuration || 1e15) - maxE;
    if (delta < lo) delta = lo;
    if (delta > hi) delta = hi;
    items.forEach(function (it) { (it.clip || it).start += delta; });
    return delta;
  }
  // 旧入口（语义收敛到 moveGroup）：delta 统一 0.5s 量化一次后整组平移
  function batchMove(items, delta, totalDuration) {
    return moveGroup(items, q05(delta || 0), totalDuration);
  }
  // 选中条起点统一对齐到 t（保持各自时长；跨舞者"齐奏"入口）
  function alignStarts(items, t) {
    (items || []).forEach(function (it) { (it.clip || it).start = t; });
    return (items || []).length;
  }

  // ---------- 插入 / 删除时间（作用全体舞者三轨 + 全局歌词 + 段落标记） ----------
  // 在 t 处插入 delta 秒空隙：start>=t 的条目整体右移（正好跨在 t 上的条目不动，后面会留出 delta 空隙）
  function insertTime(content, t, delta) {
    eachClip(content, function (c) { if (c.start >= t - EPS) c.start += delta; });
    ((content && content.markers) || []).forEach(function (mk) { if (mk.t >= t - EPS) mk.t += delta; });
    return content;
  }
  // 删除 [t0, t1)：区间内删除；整段跨区间的缩短；起点在区间内的截到 t0（不够 0.5s 的也删）；
  // 终点落在区间内（起点在左侧）的截到 t0 结束（AUD-007 补的漏项，同样 0.5s 规则）；
  // 后面的整体左移。标记：落在区间内的并到 t0，之后的左移。返回移除条数。
  function deleteTime(content, t0, t1) {
    var span = t1 - t0;
    if (!(span > 0)) return { removed: 0 };
    var removed = 0;
    function one(arr) {
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i], e = c.start + c.duration;
        if (c.start >= t0 - EPS && e <= t1 + EPS) { removed++; continue; }              // 完全在区间内
        if (c.start < t0 - EPS && e > t1 + EPS) { c.duration -= span; c.autoDur = false; out.push(c); continue; } // 整段横跨
        if (c.start >= t0 - EPS && c.start < t1 - EPS) {                                // 起点落在区间内
          if (e - t1 < 0.5 - EPS) { removed++; continue; }                              // 剩余不足 0.5s，删
          c.start = t0; c.duration = e - t1; c.autoDur = false; out.push(c); continue;
        }
        if (e > t0 + EPS && e <= t1 + EPS) {                                            // 终点落在区间内（起点在左侧）
          if (t0 - c.start < 0.5 - EPS) { removed++; continue; }                        // 截后不足 0.5s，删
          c.duration = t0 - c.start; c.autoDur = false; out.push(c); continue;
        }
        if (c.start >= t1 - EPS) { c.start -= span; out.push(c); continue; }            // 在区间之后，左移
        out.push(c);                                                                    // 在区间之前，不动
      }
      arr.length = 0; for (var j = 0; j < out.length; j++) arr[j] = out[j];
      return arr;
    }
    var ds = (content && content.dancers) || [];
    for (var di = 0; di < ds.length; di++) {
      for (var i = 0; i < TRACKS.length; i++) one(ds[di][TRACKS[i] + 'Clips'] || []);
    }
    one((content && content.globalLyrics) || []);
    ((content && content.markers) || []).forEach(function (mk) {
      if (mk.t >= t0 - EPS && mk.t < t1 - EPS) mk.t = t0;
      else if (mk.t >= t1 - EPS) mk.t -= span;
    });
    return { removed: removed };
  }

  // ---------- B5 插/删时间预告（纯计数，不修改内容；与 insertTime/deleteTime 同分支口径） ----------
  function insertTimePreview(content, t, delta) {
    var n = { action: 0, switch: 0, lyric: 0, globalLyric: 0, markers: 0 };
    eachClip(content, function (c, di, tt) {
      if (c.start >= t - EPS) { if (tt === 'global') n.globalLyric++; else n[tt]++; }
    });
    ((content && content.markers) || []).forEach(function (mk) { if (mk.t >= t - EPS) n.markers++; });
    return n;
  }
  function deleteTimePreview(content, t0, t1) {
    var n = { removed: 0, shortened: 0, shifted: 0, markers: 0 };
    function one(arr) {
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i], e = c.start + c.duration;
        if (c.start >= t0 - EPS && e <= t1 + EPS) { n.removed++; continue; }               // 完全在区间内
        if (c.start < t0 - EPS && e > t1 + EPS) { n.shortened++; continue; }               // 整段横跨
        if (c.start >= t0 - EPS && c.start < t1 - EPS) {                                   // 起点落在区间内
          if (e - t1 < 0.5 - EPS) n.removed++; else n.shortened++;
          continue;
        }
        if (e > t0 + EPS && e <= t1 + EPS) {                                               // 终点落在区间内（起点在左侧）
          if (t0 - c.start < 0.5 - EPS) n.removed++; else n.shortened++;
          continue;
        }
        if (c.start >= t1 - EPS) { n.shifted++; continue; }                                // 在区间之后，左移
      }
    }
    var ds = (content && content.dancers) || [];
    for (var di = 0; di < ds.length; di++) {
      for (var i = 0; i < TRACKS.length; i++) one(ds[di][TRACKS[i] + 'Clips'] || []);
    }
    one((content && content.globalLyrics) || []);
    ((content && content.markers) || []).forEach(function (mk) {
      if (mk.t >= t0 - EPS) n.markers++;                                                   // 窗内并到 t0＋其后左移都算调整
    });
    return n;
  }

  // ---------- 复制 / 粘贴 ----------
  // entries: collectSelected 的返回值。序列化成可粘贴的剪贴板（rel=相对最早条的偏移，data 深拷贝）
  function serializeSelection(entries) {
    var min = Infinity;
    (entries || []).forEach(function (it) { if (it.clip.start < min) min = it.clip.start; });
    if (!isFinite(min)) min = 0;
    var items = (entries || []).map(function (it) {
      // 复制时冻结规范载体和未知扩展；只有落位、身份与选中状态在粘贴时重新决定。
      var extra = JSON.parse(JSON.stringify(it.clip));
      ['id', 'start', 'duration', 'autoDur', 'data', 'selected'].forEach(function (k) { delete extra[k]; });
      return {
        di: it.di, track: it.track,
        rel: it.clip.start - min,
        duration: it.clip.duration,
        autoDur: it.clip.autoDur === true,
        data: JSON.parse(JSON.stringify(it.clip.data || {})),
        extra: extra,
      };
    });
    return { minStart: min, items: items };
  }
  // ---------- 腾位（复制/粘贴防重叠的公共件） ----------
  // 在 arr 里为 [t, t+span) 腾出空位：start>=t 的整体右移 span（保持相互间距）；
  // 横跨 t 的条目截断到 t 结束（截完不足 0.5s 直接删）。腾完位再放新内容，同轨绝不重叠。
  // 返回 {shifted, truncated, removed} 供提示与测试。
  function makeRoom(arr, t, span) {
    var out = { shifted: 0, truncated: 0, removed: 0 };
    if (!(span > 0) || !arr) return out;
    var keep = [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i], e = c.start + c.duration;
      if (e <= t + EPS) { keep.push(c); continue; }                                        // 完全在腾位区之前：不动
      if (c.start >= t - EPS) { c.start += span; out.shifted++; keep.push(c); continue; }  // 在腾位区及之后：右移
      var nd = t - c.start;                                                                // 横跨 t：截到 t 为止
      if (nd < 0.5 - EPS) { out.removed++; continue; }
      c.duration = nd; c.autoDur = false; out.truncated++; keep.push(c);
    }
    arr.length = 0; for (var j = 0; j < keep.length; j++) arr[j] = keep[j];
    return out;
  }
  // 把剪贴板粘到 t：新 id（allocId 由调用方给，主页用 store.nextClipId++）、同舞者同轨、
  // 全局歌词回全局轨。粘贴前先对每个目标轨道 makeRoom 腾出 [t, t+span) 空位——现有动作整体
  // 右移、横跨播放头的截断，粘贴后同轨零重叠（2026-08-29 主人拍板的口径）。
  // 粘贴条是显式时长（autoDur 不继承"待实测"状态）。返回新建的 clip 数组。
  function pasteItems(cbItems, content, t, allocId) {
    var items = (cbItems && cbItems.items) || [];
    function arrFor(it) {
      if (it.track === 'global') return content.globalLyrics || (content.globalLyrics = []);
      var d = (content.dancers || [])[it.di];
      if (!d) return null;
      return d[it.track + 'Clips'] || (d[it.track + 'Clips'] = []);
    }
    // 第一遍：按目标轨道分组，算各组要腾的空位（=该组粘贴内容的最大跨度）
    var groups = [];
    items.forEach(function (it) {
      var arr = arrFor(it);
      if (!arr) return;
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].arr === arr) { g = groups[i]; break; }
      if (!g) { g = { arr: arr, span: 0 }; groups.push(g); }
      if (it.rel + it.duration > g.span) g.span = it.rel + it.duration;
    });
    groups.forEach(function (g) { makeRoom(g.arr, t, g.span); });
    // 第二遍：落粘贴条
    var created = [];
    items.forEach(function (it) {
      var arr = arrFor(it);
      if (!arr) return;
      var c = Object.assign(JSON.parse(JSON.stringify(it.extra || {})), {
        id: allocId(), start: Math.max(0, t + it.rel), duration: it.duration,
        autoDur: false, data: JSON.parse(JSON.stringify(it.data)), selected: false,
      });
      // 副本由新 clip id 生成新事件身份；其余动作引用、语义及扩展保持原样。
      if (c._doc && typeof c._doc === 'object' && !Array.isArray(c._doc)) delete c._doc.id;
      arr.push(c); created.push(c);
    });
    return created;
  }

  // ---------- 整轨复制（TASK-20260831-MULTI-DANCER-EDIT） ----------
  // 把 srcIdx 舞者的三条轨一次性深拷贝到 dstIdx 舞者（一次性复制，不是实时镜像）。
  // 口径：start/duration/autoDur 与整个 data（含未知/_extra 键）原样带走；每条 clip 发新 id
  // （allocId 由调用方给，主页用 store.nextClipId++）；currentJob 跟源舞者走；克隆不带选中态；
  // name/color/solo/mute/collapsed/laneScale 等每舞者视图/状态字段一律不动。
  // 源为空 / 源=目标 / 下标越界 / allocId 缺失 → 返回 null 且不改任何东西（UI 层负责提示与确认）。
  function copyDancerTracks(dancers, srcIdx, dstIdx, allocId) {
    var ds = dancers || [];
    var src = ds[srcIdx], dst = ds[dstIdx];
    if (!src || !dst || srcIdx === dstIdx || typeof allocId !== 'function') return null;
    var hasClip = false;
    for (var i = 0; i < TRACKS.length; i++) if ((src[TRACKS[i] + 'Clips'] || []).length) hasClip = true;
    if (!hasClip) return null;
    for (var t = 0; t < TRACKS.length; t++) {
      var key = TRACKS[t] + 'Clips';
      var clones = JSON.parse(JSON.stringify(src[key] || []));
      for (var k = 0; k < clones.length; k++) {
        clones[k].id = allocId(); clones[k].selected = false;
        // 清除源事件身份，副本由新 clip id 派生；其余载体内容完整保留。
        if (clones[k]._doc && typeof clones[k]._doc === 'object' && !Array.isArray(clones[k]._doc)) delete clones[k]._doc.id;
      }
      dst[key] = clones;
    }
    dst.currentJob = src.currentJob || '';
    return dst;
  }

  // ---------- B7b 舞段复制：类型化剪贴板纯辅助 ----------
  // 八类内容类型（表 C）：未知类型＝落库前整批拒绝点名，绝不静默丢弃。
  var PHRASE_KINDS = ['movement', 'facing', 'skill', 'action', 'switch', 'lyric', 'globalLyric', 'marker'];
  // R5-05 ID 分配器：对既有 id 与剪贴板源 id 共同避让；事务期保留全部新 id（连续分配不复用）。
  function allocIdFactory(existingIds) {
    var used = {}, max = 0;
    (existingIds || []).forEach(function (v) {
      if (typeof v === 'number' && isFinite(v)) { used[v] = true; if (v > max) max = v; }
    });
    var next = max + 1;
    return function () { while (used[next]) next++; used[next] = true; return next; };
  }
  // 现存数字 clip id 清单（三轨＋全局歌词；标记是字符串 id 另一命名空间，不混入）。
  function existingClipIds(content) {
    var out = [];
    eachClip(content, function (c) { out.push(c.id); });
    return out;
  }
  // 跨落点片段收集（一切有时长对象·片段侧：三轨＋全局歌词；start<t<start+duration）——技能侧由
  // ability-plan 行另行收集（时长＝咏唱+表现提示为产品不变量，不参与截断）。
  function collectCrossingClips(content, t) {
    var out = [];
    eachClip(content, function (c, di, tt) {
      if (c.start < t - EPS && c.start + c.duration > t + EPS)
        out.push({ di: di, track: tt, name: (c.data && c.data.name) || ('clip ' + c.id), start: c.start, end: c.start + c.duration });
    });
    return out;
  }

  // ---------- 添加到全部舞者：落位规划（只读） ----------
  // 「添加到全部舞者」开关的齐奏口径：所有在场舞者在同一请求起点 st 插入同一条动作，
  // 每位按既有 per-dancer 规则（planActionPlacement：切职业 0.5s 结束于动作开始、冲突顺延）各算一份；
  // 某舞者自己轨道冲突时只有那一位被顺延（deferred），其他舞者保持请求起点，既有条永不移动。
  // needSwitch 按每位舞者自己的 currentJob 判定（与 addClip 同口径，jobMap 缺该职业则不切）。
  // 只读输入，不改任何轨道；返回按舞者下标对齐的规划数组（空槽位 null 占位）。
  function planMultiActionPlacement(dancers, st, dur, item, jobMap) {
    var ds = dancers || [];
    var out = [];
    for (var di = 0; di < ds.length; di++) {
      var d = ds[di];
      if (!d) { out.push(null); continue; }
      var needSwitch = !!(item && item.jobName && item.jobName !== d.currentJob && jobMap && jobMap[item.jobId]);
      var plan = planActionPlacement(d.switchClips, d.actionClips, st, dur, needSwitch);
      out.push({ di: di, needSwitch: needSwitch, st: plan.st, swStart: plan.swStart, swDur: plan.swDur, deferred: plan.st !== st });
    }
    return out;
  }

  // ---------- 段落标记 ----------
  // id 要跨会话唯一（标记随项目持久化），所以和时间戳拼接，与 ChoreoProjects.pure.newId 同套路
  function newMarkerId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function addMarker(markers, t, name, id) {
    var mk = { id: id || newMarkerId(), t: t, name: name || '标记' };
    (markers || (markers = [])).push(mk);
    sortMarkers(markers);
    return mk;
  }
  function removeMarker(markers, id) {
    var arr = markers || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { arr.splice(i, 1); return true; }
    return false;
  }
  function updateMarker(markers, id, patch) {
    var arr = markers || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) {
      if (patch && typeof patch.t === 'number') arr[i].t = patch.t;
      if (patch && typeof patch.name === 'string') arr[i].name = patch.name;
      sortMarkers(arr);
      return arr[i];
    }
    return null;
  }
  function sortMarkers(markers) {
    (markers || []).sort(function (a, b) { return a.t - b.t || String(a.name).localeCompare(String(b.name)); });
    return markers;
  }

  // ---------- 独奏 / 静音 ----------
  // 口径：静音 = 自己 mute，或「有人独奏且自己不是独奏」。旧数据没有这两个字段按 false 算。
  function anySolo(dancers) {
    return (dancers || []).some(function (d) { return !!d && !!d.solo; });
  }
  function isMuted(dancers, di) {
    var d = (dancers || [])[di];
    if (!d) return false;
    return !!d.mute || (anySolo(dancers) && !d.solo);
  }
  function mutedMap(dancers) {
    var m = {};
    (dancers || []).forEach(function (d, di) { if (isMuted(dancers, di)) m[di] = true; });
    return m;
  }

  // ---------- 实测时长自动校正（AUD-015） ----------
  // 插件预览/播放积累的实测时长回填：autoDur（未被手动调过）且命令有实测值的 clip，
  // 时长改成实测值并锁定 autoDur。就地修改 dancers，返回修正条数。
  // 落盘由主页调用方负责（refreshMeasured 里随后 persistProject）；这是程序自动修正，
  // 不进用户撤销栈，避免异步结果打断正在进行的撤销
  function applyMeasuredDurations(dancers, measured) {
    var fixed = 0;
    (dancers || []).forEach(function (d) {
      ['actionClips', 'switchClips'].forEach(function (k) {
        ((d && d[k]) || []).forEach(function (c) {
          var m = c && c.autoDur && c.data && c.data.command && measured && measured[c.data.command];
          if (m && Math.abs(c.duration - m) > 0.01) { c.duration = m; c.autoDur = false; fixed++; }
        });
      });
    });
    return fixed;
  }

  // ---------- 自动切职业落位（AUD-010） ----------
  // 口径：切职业条占 0.5 秒、恰好在动作开始 st 时结束（与宏生成 <wait.0.5> 的口径一致，
  // 旧版持续 1 秒盖到 st+0.5，体检必报自造红错）。落位规则：
  //   ① 切职业窗口 [st-0.5, st) 与动作轨（跨轨）或切职业轨（同轨）冲突 → 动作连同切职业
  //      一起顺延到冲突结束 +0.5（切职业永远向前伸 0.5，所以补 0.5 才放得下）；
  //   ② 动作窗口 [st, st+dur) 与切职业轨（跨轨）冲突 → 沿用旧 +0.05 顺延（原 conflictEnd 语义）；
  //   ③ st<0.5 时动作推到 0.5，让切职业放得下。
  // 只读输入两条轨道数组，返回 {st, swStart, swDur}；needSwitch=false 时 swStart/swDur=0。
  function planActionPlacement(switchClips, actionClips, st, dur, needSwitch) {
    var TOL = 0.01;
    function overlapEnd(arr, ns, ne) { // 与 [ns,ne) 相交的条目的最晚结束时刻（无则 0；0.01 容差同主页 conflictEnd）
      var ret = 0;
      (arr || []).forEach(function (c) {
        var e = c.start + c.duration;
        if (ns < e - TOL && ne > c.start + TOL && e > ret) ret = e;
      });
      return ret;
    }
    st = st || 0;
    if (needSwitch && st < 0.5) st = 0.5;
    for (var guard = 0; guard < 60; guard++) {
      if (needSwitch) {
        var ce2 = Math.max(overlapEnd(actionClips, st - 0.5, st), overlapEnd(switchClips, st - 0.5, st));
        if (ce2 > 0) { st = ce2 + 0.5; continue; }
      }
      var ce = overlapEnd(switchClips, st, st + dur);
      if (ce > 0) { st = ce + 0.05; continue; }
      break;
    }
    return { st: st, swStart: needSwitch ? st - 0.5 : 0, swDur: needSwitch ? 0.5 : 0 };
  }

  // ---------- 游戏播放 payload ----------
  // 与主页 gameStartPlay 原组装逻辑逐字段一致（id/actorId/start/duration/command/type/name）。
  // 过滤口径二选一：默认按 isMutedFn 过滤整名舞者（网页排练/检查方全量视角）；
  // 给了 previewActor（舞者下标）则只发这一位——ACTOR（2026-08-31）：游戏内只有一位本地
  // 角色，payload 混多人会把所有事件执行在同一个角色上互相搅；显式选中的预览舞者不受
  // 独奏/静音影响（那是网页排练口径）。全局歌词是全体共享的，不受三者影响。按 start 排好。
  // actorId（FIX-B/AUD2-004）：舞者下标，全局歌词=-1——事件带演员维度，seek 侧按演员分组不互相覆盖。
  function buildGameClips(dancers, globalLyrics, isMutedFn, previewActor) {
    var all = [];
    (dancers || []).forEach(function (d, di) {
      if (typeof previewActor === 'number' && previewActor >= 0) {
        if (di !== previewActor) return; // 指定预览舞者：只发这一位（越界下标=无人入选，只剩全局歌词）
      } else if (isMutedFn && isMutedFn(dancers, di)) return; // 未指定：静音舞者三条轨全跳过
      ['switchClips', 'actionClips', 'lyricClips'].forEach(function (k) {
        var type = k === 'switchClips' ? 'switch' : k === 'actionClips' ? 'action' : 'lyric';
        (d[k] || []).forEach(function (c) {
          all.push({ id: c.id, actorId: di, start: c.start, duration: c.duration, command: (c.data && c.data.command) || '', type: type, name: (c.data && c.data.name) || '' });
        });
      });
    });
    (globalLyrics || []).forEach(function (c) {
      all.push({ id: c.id, actorId: -1, start: c.start, duration: c.duration, command: (c.data && c.data.command) || '', type: 'lyric', name: (c.data && c.data.name) || '' });
    });
    all.sort(function (a, b) { return a.start - b.start; });
    return all;
  }

  // ---------- 宏口径（FIX-4/AUD-013：宏导出和体检共用同一份事件归一化/行数估算，防两套估算漂移） ----------
  // macroEvents：把一个舞者的三轨（+开歌词宏时的全局歌词）合成 generateMacro 同款事件列表。
  // 顺序与 generateMacro 原组装口径逐字一致：同刻按 switch→action→舞者歌词→全局歌词（稳定排序），
  // 全局歌词去重规则同 generateMacro（0.15s 内同刻、同名已在舞者歌词轨的不再输出）
  function macroEvents(dancer, globalLyrics, showLyricMacro) {
    var d = dancer;
    if (!d) return [];
    var all = [];
    (d.switchClips || []).forEach(function (c) { all.push({ clip: c, type: 'switch' }); });
    (d.actionClips || []).forEach(function (c) { all.push({ clip: c, type: 'action' }); });
    (d.lyricClips || []).forEach(function (c) { all.push({ clip: c, type: 'lyric' }); });
    if (showLyricMacro) {
      var lcs = d.lyricClips || [];
      (globalLyrics || []).forEach(function (c) {
        var dup = false;
        for (var li = 0; li < lcs.length; li++) {
          var lc = lcs[li];
          if (Math.abs(lc.start - c.start) < 0.15 && lc.data && c.data && lc.data.name === c.data.name) { dup = true; break; }
        }
        if (!dup) all.push({ clip: c, type: 'lyric' });
      });
    }
    all.sort(function (a, b) { return a.clip.start - b.clip.start; });
    return all;
  }

  // macroLineEstimate：按 generateMacro 的出行规则估算宏行数（不含 /echo 标题和 /nextmacro 分页行）。
  // 每个事件一行（歌词没文字不出行）；职业切换只来自用户明确放置的切换条。
  // 保留 jobMap 参数兼容旧调用方，但不能再凭它估算不存在的自动切职业行。
  function macroLineEstimate(events, jobMap) {
    var lines = 0, switchLines = 0;
    (events || []).forEach(function (item) {
      var c = item.clip;
      var cmd = (c.data && c.data.command) || '';
      if (item.type === 'switch') {
        lines++;
      } else if (item.type === 'lyric') {
        if (!cmd && c.data && c.data.name) cmd = '/say ' + c.data.name;
        if (cmd) lines++;
      } else {
        lines++;
      }
    });
    return { lines: lines, switchLines: switchLines, clipLines: lines - switchLines };
  }

  // ---------- GAMECLOCK：游戏模式时钟跟随纯函数（TASK-20260831） ----------
  // 目标：游戏模式播放时网页播放头跟着插件权威时钟走（网页 rAF 本地钟与插件钟天然不同步）。
  // 非目标（AUD2-002 结论不变）：不建游戏→网页的逐骨实时姿态流——同步机制只有时钟跟随。
  // 用法：轮询 /playback/status（仅 game 模式 + statusV2 能力位），每次新样本过 followAccept；
  // 两个轮询之间每帧用 followProject 外推。本地钟在轮询失败/暂停时自然接管（行为与旧版一致）。
  var FOLLOW_RESYNC_SEC = 0.12; // 显示位置与插件时间差超过它才硬切（阈值内以外推连续优先，微差被吸收）

  // 新样本接入：sample={time,stampMs,stampAgeMs,speed,playing}（stampAgeMs=收到时载荷已过去的毫秒）。
  // prev={stamp,display} 上一次接受的状态。返回 {accepted, local, resync, base, stamp}：
  // 无效/非有限/越界输入一律 accepted:false 且不抛；stamp 不大于 prev.stamp 视为旧样本丢弃；
  // playing=false 交还本地时钟（local:true）；|prev.display - 插件 time| > 阈值 → resync 硬切。
  function followAccept(prev, sample) {
    var prevDisplay = prev && isFinite(prev.display) ? prev.display : null;
    function keep(extra) {
      var r = { accepted: false, local: false, resync: false, base: null, stamp: (prev && isFinite(prev.stamp)) ? prev.stamp : null, display: prevDisplay };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }
    if (!sample || typeof sample !== 'object') return keep();
    var t = Number(sample.time), stamp = Number(sample.stampMs), ageMs = Number(sample.stampAgeMs), speed = Number(sample.speed);
    if (!isFinite(t) || !isFinite(stamp) || !isFinite(ageMs) || ageMs < 0 || ageMs > 60000) return keep();
    if (prev && isFinite(prev.stamp) && stamp <= prev.stamp) return keep(); // 乱序/重复样本
    if (!isFinite(speed) || speed <= 0) speed = 1;
    speed = Math.min(4, Math.max(0.1, speed));
    if (sample.playing === false) return keep({ local: true }); // 暂停：控制权还给本地钟
    var resync = prevDisplay !== null && Math.abs(prevDisplay - t) > FOLLOW_RESYNC_SEC;
    return {
      accepted: true, local: false, resync: resync,
      stamp: stamp, display: resync ? t : prevDisplay,
      base: { time: t, ageMs: ageMs, speed: speed },
    };
  }

  // 两个轮询之间的显示时刻外推：base=followAccept 给的 base（加 recvSec 收到时刻），
  // nowSec=performance.now()/1000。display = 插件样本时间 + (载荷龄+本地流逝)×速度。
  // 无效输入返回 null（调用方退回本地钟推进），绝不抛。
  function followProject(base, nowSec) {
    if (!base || typeof base !== 'object') return null;
    var t = Number(base.time), ageMs = Number(base.ageMs), speed = Number(base.speed), recv = Number(base.recvSec);
    if (!isFinite(t) || !isFinite(ageMs) || ageMs < 0 || !isFinite(speed) || speed <= 0 || !isFinite(recv)) return null;
    var el = Number(nowSec) - recv;
    if (!isFinite(el) || el < 0) el = 0;
    return t + (ageMs / 1000 + el) * speed;
  }

  // 能力位判断：caps=/capabilities JSON，name=能力名。畸形输入一律 false（不抛）。
  function hasCap(caps, name) {
    return !!(caps && typeof caps === 'object' && Array.isArray(caps.capabilities) && caps.capabilities.indexOf(name) >= 0);
  }

  // ---------- 角色档案绑定解析（TASK-20260903-CHARACTER-ASSETS-P1-BIND） ----------
  // 纯函数：dancers（store.dancers / 文档舞者投影）× 已知档案 id 清单 × 活动档案 id →
  // 按舞者顺序对齐的只读绑定视图 [{index, state, binding, profileId}]。口径（设计文档 §1/§5）：
  //   缺键/空串/非字符串 profileId → 不是绑定，解析到 activeProfileId，state='default'
  //     （没有活动档案时 state='none'，解析为空）；
  //   非空字符串且在 knownProfileIds → state='bound'，解析到该 id 本身；
  //   非空字符串但不在清单 → state='missing'，解析为空，绝不静默回落 activeProfileId。
  // 不改入参、不碰资料库/DOM/全局状态；等输入等输出（3D 面板观察口与 node 单测共用）。
  function resolveBindings(dancers, knownProfileIds, activeProfileId) {
    var known = knownProfileIds || [];
    var act = typeof activeProfileId === 'string' && activeProfileId ? activeProfileId : null;
    return (dancers || []).map(function (d, i) {
      var ref = (d && typeof d === 'object' && typeof d.profileId === 'string' && d.profileId) ? d.profileId : null;
      if (ref) {
        // indexOf 而非对象键查表：'__proto__'/'toString' 这类名字不能经原型链误判为已知
        return known.indexOf(ref) >= 0
          ? { index: i, state: 'bound', binding: ref, profileId: ref }
          : { index: i, state: 'missing', binding: ref, profileId: null };
      }
      return act
        ? { index: i, state: 'default', binding: null, profileId: act }
        : { index: i, state: 'none', binding: null, profileId: null };
    });
  }

  // ---------- 绑定写入 + 多母版渲染规划（TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW） ----------
  // 设定/清除一位舞者的档案绑定（与 resolveBindings 同口径）：空串/null/undefined → 清除
  //（delete 键，回到 P1 无绑定形状）；已知 id → 写同名字符串；其他（未知/非字符串/原型键名）
  // → 拒绝返回 null 零改动。返回被改的舞者或 null；不改别的字段、不动其他舞者。
  function setDancerBinding(dancers, di, profileId, knownProfileIds) {
    var d = (dancers || [])[di];
    if (!d || typeof d !== 'object') return null;
    if (profileId === '' || profileId === null || profileId === undefined) {
      if ('profileId' in d) delete d.profileId;
      return d;
    }
    if (typeof profileId !== 'string') return null;
    // indexOf 判定：非数组/原型键名都不能经原型链误判为已知
    if (!knownProfileIds || knownProfileIds.indexOf(profileId) < 0) return null;
    d.profileId = profileId;
    return d;
  }

  // 外观身份（TASK-20260907-APPEARANCE-DEFECT-REPAIR）：同骨架异外观必须分母版。
  // 内容口径优先 P4 SHA-256（modelHashes/modelHash 由预览侧经 getProfileFileInfo 取到后传入，
  // 与资料库去重同源，同字节异名仍同键）；缺哈希时退到模型清单+总字节。纯函数，不改入参。
  function appearanceId(rec) {
    var r = (rec && typeof rec === 'object') ? rec : {};
    if (Object.prototype.toString.call(r.modelHashes) === '[object Array]' && r.modelHashes.length) {
      return 'h:' + r.modelHashes.slice().sort().join(',');
    }
    if (typeof r.modelHash === 'string' && r.modelHash) return 'h:' + r.modelHash;
    var names = (Object.prototype.toString.call(r.modelNames) === '[object Array]') ? r.modelNames.slice().sort() : [];
    var size = (typeof r.modelSize === 'number' && isFinite(r.modelSize)) ? r.modelSize : 0;
    return 'n:' + names.join(',') + '#' + size;
  }
  // 母版键：骨架指纹 + 外观身份（同档同字节仍同键共享；异外观/异骨架分键；替身键不变）。
  function masterKeyFor(skeletonHash, rec) {
    return skeletonHash + '|' + appearanceId(rec);
  }
  // 多母版渲染规划器（P3 / AC-1，母版身份于本修复扩展为「骨架指纹 + 外观身份」）：
  // 在 resolveBindings 输出上叠加规划。输入/输出形状与旧版一致，唯 masterKey 由裸指纹
  // 变为指纹+外观复合键；masters 条目新增 appearanceId。同外观舞者仍归并共享。
  // 口径：缺绑定/无活动/悬空/无骨架 → 替身母版+原因类；有骨架无模型 → 自己的外观母版
  // + no-model（部署位真模型仍可接手，AC-7 单母版行为不被破坏）。纯函数，等输入等输出。
  // onlineFingerprint=在线骨架「结构指纹」（TASK-20260917-SKELETON-KEY-REPAIR：在线骨架带
  // 即时姿态，整份指纹逐次不同，online/onlineUpgradable 一律比结构指纹）。
  function planRender(dancers, knownProfileIds, activeProfileId, profileRecords, onlineFingerprint) {
    var recs = {};
    (profileRecords || []).forEach(function (r) {
      if (r && typeof r === 'object' && typeof r.id === 'string' && r.id) recs[r.id] = r;
    });
    var base = resolveBindings(dancers, knownProfileIds, activeProfileId);
    var STANDIN = 'standin';
    var masters = {}, order = [];
    function ensureMaster(key, rec) {
      if (!masters[key]) {
        masters[key] = {
          key: key, profileId: key === STANDIN ? null : rec.id, profileIds: [],
          skeletonHash: key === STANDIN ? null : (rec.skeletonHash || null),
          skeletonStructHash: key === STANDIN ? null : (rec.skeletonStructHash || null),
          appearanceId: key === STANDIN ? null : appearanceId(rec),
          boneCount: key === STANDIN ? null : (rec.boneCount || 0),
          onlineUpgradable: false, dancers: []
        };
        order.push(key);
      }
      var m = masters[key];
      if (key !== STANDIN && m.profileIds.indexOf(rec.id) < 0) m.profileIds.push(rec.id);
      return m;
    }
    var entries = base.map(function (b) {
      if (!b) return { index: -1, state: 'none', binding: null, profileId: null, skeletonHash: null, masterKey: STANDIN, reason: 'no-active-profile', online: false };
      var rec = b.profileId ? (recs[b.profileId] || null) : null;
      var reason = null, key = STANDIN, fp = null;
      if (b.state === 'missing') reason = 'missing-profile';
      else if (!b.profileId) reason = 'no-active-profile';
      else if (!rec) reason = 'missing-profile';
      else if (!rec.hasSkeleton) reason = 'no-skeleton';
      else if (!(typeof rec.skeletonHash === 'string' && rec.skeletonHash)) reason = 'no-skeleton';
      else {
        key = masterKeyFor(rec.skeletonHash, rec);
        fp = rec.skeletonHash;
        if (!((rec.modelNames || []).length)) reason = 'no-model';
      }
      var m = ensureMaster(key, rec || { id: '' });
      m.dancers.push(b.index);
      var fp2 = (rec && rec.skeletonStructHash) || null;
      return {
        index: b.index, state: b.state, binding: b.binding, profileId: b.profileId,
        skeletonHash: fp, skeletonStructHash: fp2, masterKey: key, reason: reason,
        online: !!(onlineFingerprint && fp2 && onlineFingerprint === fp2)
      };
    });
    if (onlineFingerprint) {
      Object.keys(masters).forEach(function (k) {
        if (masters[k].skeletonStructHash && masters[k].skeletonStructHash === onlineFingerprint) masters[k].onlineUpgradable = true;
      });
    }
    return { standinKey: STANDIN, entries: entries, masterKeys: order.slice(), masters: masters };
  }

  // 档案集合变化判定（P3 / AC-9）：通知入口快照的旧已知 id 与新清单比较；
  // 任一增删即需整体重建。顺序无关（集合语义），纯函数供面板与单测共用。
  function profilesChangedNeedsRebuild(oldIds, newIds) {
    var a = ((oldIds || []).slice().sort()).join(','), b = ((newIds || []).slice().sort()).join(',');
    return a !== b;
  }

  // ---------- 起始站位/朝向（M2-START-FORMATION / AC-1·AC-2·AC-3） ----------
  // 坐标约定（docs/DESIGN-m2-start-formation.md §2）：米制 x（左右 +X）/ z（前后 +Z，
  // 前 +Z），y 不碰；start 是与播放头/整数 ms 时间轴无关的静态项目放置；零 yaw 朝 +Z，
  // 正 yaw 把 +Z 转向 +X，90 度朝 +X；前向=(sin yaw,0,cos yaw)；stageYawDeg 永不参与，
  // 不合成 originCalibrated。存储原样保留用户输入的有限数值（含负/大角度，不包络归一）。
  var START_SPACING = 1.15; // 与 preview3d.js SPACING 同值：缺 start 的索引等距 fallback
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function isStartObj(s) { return !!s && typeof s === 'object' && !Array.isArray(s); }
  // 显式 start 判定：仅当恰为 {x,z,yawDeg} 三有限数值（多键/缺键/非数值/非有限一律按缺失算，
  // 与 choreo-document.js 归一化同口径，显式原点 {0,0,0} 是合法 start）。
  function hasExplicitStart(dancer) {
    if (!dancer || typeof dancer !== 'object') return false;
    var s = dancer.start;
    if (!isStartObj(s)) return false;
    var ks = Object.keys(s);
    if (ks.length !== 3) return false;
    if (ks.indexOf('x') < 0 || ks.indexOf('z') < 0 || ks.indexOf('yawDeg') < 0) return false;
    return isFiniteNum(s.x) && isFiniteNum(s.z) && isFiniteNum(s.yawDeg);
  }
  // 单字段解析：空串/null/undefined/纯空白=blank；其余经 Number() 非有限=invalid。
  function parseStartField(raw) {
    if (raw === null || raw === undefined) return { ok: false, code: 'blank' };
    if (typeof raw === 'number') return isFinite(raw) ? { ok: true, value: raw } : { ok: false, code: 'invalid' };
    var t = String(raw).trim();
    if (!t) return { ok: false, code: 'blank' };
    var n = Number(t);
    if (!isFinite(n)) return { ok: false, code: 'invalid' };
    return { ok: true, value: n };
  }
  function validateStartInput(xRaw, zRaw, yawRaw) {
    var px = parseStartField(xRaw), pz = parseStartField(zRaw), py = parseStartField(yawRaw);
    if (!px.ok) return { ok: false, field: 'x', code: px.code };
    if (!pz.ok) return { ok: false, field: 'z', code: pz.code };
    if (!py.ok) return { ok: false, field: 'yawDeg', code: py.code };
    return { ok: true, value: { x: px.value, z: pz.value, yawDeg: py.value } };
  }
  // 前向向量（独立 oracle 口径，测试用自写 sin/cos 对拍，不复用本函数做期望）。
  function startForward(yawDeg) {
    if (!isFiniteNum(yawDeg)) return null;
    var r = yawDeg * Math.PI / 180;
    return [Math.sin(r), 0, Math.cos(r)];
  }
  // 纯写入：只改 dancers[di].start；非法/缺舞者零写入；同值零写入。
  function setDancerStart(dancers, di, xRaw, zRaw, yawRaw) {
    var ds = dancers || [];
    var d = ds[di];
    if (!d || typeof d !== 'object') return { ok: false, reason: 'missing-dancer' };
    var v = validateStartInput(xRaw, zRaw, yawRaw);
    if (!v.ok) return { ok: false, field: v.field, code: v.code };
    var cur = d.start;
    if (isStartObj(cur) && cur.x === v.value.x && cur.z === v.value.z && cur.yawDeg === v.value.yawDeg
      && Object.keys(cur).length === 3) return { ok: true, changed: false, value: { x: cur.x, z: cur.z, yawDeg: cur.yawDeg } };
    d.start = { x: v.value.x, z: v.value.z, yawDeg: v.value.yawDeg };
    return { ok: true, changed: true, value: { x: v.value.x, z: v.value.z, yawDeg: v.value.yawDeg } };
  }
  function clearDancerStart(dancers, di) {
    var ds = dancers || [];
    var d = ds[di];
    if (!d || typeof d !== 'object') return { ok: false, reason: 'missing-dancer' };
    if (!('start' in d) || d.start === undefined) return { ok: true, changed: false };
    // 已是缺失形态（含非对象/畸形）也视为一次清除：删键恢复“无 start”形状
    delete d.start;
    return { ok: true, changed: true };
  }
  // 放置解算（web 3D 用，preview3d.js 同口径消费）：显式→(x,baseY,z)+yaw；缺失→索引等距。
  function placementFor(dancers, di) {
    var ds = dancers || [];
    var d = ds[di];
    if (!d || typeof d !== 'object') return null;
    if (hasExplicitStart(d)) {
      return { x: d.start.x, z: d.start.z, yawDeg: d.start.yawDeg, hasStart: true, forward: startForward(d.start.yawDeg) };
    }
    var n = ds.length;
    return { x: (di - (n - 1) / 2) * START_SPACING, z: 0, yawDeg: 0, hasStart: false, forward: [0, 0, 1] };
  }
  // ---------- 2D 舞台拖拽坐标变换（TASK-20260906-M2-STAGE-DRAG） ----------
  // 约定：米制；+X 屏右，+Z 屏上；单 scale 双轴相等；存储坐标永不按视口钳制；
  // placementFor 是唯一放置源；自动适配为纯函数，不改项目。
  var STAGE_QUANT = 0.01; // 舞台拖拽落位量化（厘米）：回原量化点即 no-op，不产生历史
  var STAGE_PAD = 24; // 自动适配内边距（px）
  var STAGE_FALLBACK_SPAN = 4; // 单点/重合时的默认视野跨度（米），保证 scale 有限
  var STAGE_REFERENCE_SPAN = 10; // 参照跨度（米）：横向最小可见世界跨度，上限 scale<=drawableWidth/10
  function quantStage(v) {
    if (!isFiniteNum(v)) return NaN;
    var q = Math.round(v * 100) / 100;
    return q === 0 ? 0 : q; // 去 -0，保持 JSON 稳定
  }
  // 计算适配变换：viewW/viewH 为表面 CSS 像素；points 为 [{x,z}] 有限点集。
  // 返回 {scale, originX, originY, viewW, viewH} 或 null（空/缺失/非有限/零尺寸不可编辑）。
  function computeStageTransform(viewW, viewH, points, pad) {
    if (!isFiniteNum(viewW) || !isFiniteNum(viewH) || !(viewW > 0) || !(viewH > 0)) return null;
    var pts = (points || []).filter(function (p) {
      return !!p && isFiniteNum(p.x) && isFiniteNum(p.z);
    });
    if (!pts.length) return null;
    var p = (typeof pad === 'number' && isFinite(pad) && pad >= 0) ? pad : STAGE_PAD;
    if (!(viewW > p * 2) || !(viewH > p * 2)) return null;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pts.forEach(function (pt) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    });
    var spanX = maxX - minX, spanZ = maxZ - minZ;
    if (!(spanX > 1e-9)) spanX = STAGE_FALLBACK_SPAN;
    if (!(spanZ > 1e-9)) spanZ = STAGE_FALLBACK_SPAN;
    var s = Math.min((viewW - p * 2) / spanX, (viewH - p * 2) / spanZ);
    var cap = (viewW - p * 2) / STAGE_REFERENCE_SPAN;
    if (s > cap) s = cap;
    if (!isFiniteNum(s) || !(s > 0)) return null;
    var extraX = (viewW - p * 2) - spanX * s;
    var extraZ = (viewH - p * 2) - spanZ * s;
    return {
      scale: s,
      originX: p + extraX / 2 - minX * s,
      originY: viewH - p - extraZ / 2 + minZ * s,
      viewW: viewW, viewH: viewH
    };
  }
  function stageWorldToScreen(x, z, t) {
    if (!isFiniteNum(x) || !isFiniteNum(z) || !t || !isFiniteNum(t.scale) || !(t.scale > 0)) return null;
    if (!isFiniteNum(t.originX) || !isFiniteNum(t.originY)) return null;
    return { sx: t.originX + x * t.scale, sy: t.originY - z * t.scale };
  }
  function stageScreenToWorld(sx, sy, t) {
    if (!isFiniteNum(sx) || !isFiniteNum(sy) || !t || !isFiniteNum(t.scale) || !(t.scale > 0)) return null;
    if (!isFiniteNum(t.originX) || !isFiniteNum(t.originY)) return null;
    return { x: (sx - t.originX) / t.scale, z: (t.originY - sy) / t.scale };
  }
  function stageTransformEqual(a, b) {
    if (!a || !b) return false;
    return a.scale === b.scale && a.originX === b.originX && a.originY === b.originY
      && a.viewW === b.viewW && a.viewH === b.viewH;
  }
  // 拖拽提交判定（纯）：orig 为原始 start 对象或 null/缺失；fallback 为缺失时的索引等距 {x,z}；
  // nx/nz 为指针解算的原始世界坐标（未量化）。返回 {commit, x, z, reason}：
  // 非有限→no-op；量化后与原始（显式取 start / 缺失取 fallback）相等→no-op；否则 commit 量化值。
  function stageCommitDecision(origStart, fallback, nx, nz) {
    if (!isFiniteNum(nx) || !isFiniteNum(nz)) return { commit: false, reason: 'non-finite' };
    var qx = quantStage(nx), qz = quantStage(nz);
    if (!isFiniteNum(qx) || !isFiniteNum(qz)) return { commit: false, reason: 'non-finite' };
    var base = null;
    if (isStartObj(origStart) && isFiniteNum(origStart.x) && isFiniteNum(origStart.z)
      && Object.keys(origStart).length === 3 && isFiniteNum(origStart.yawDeg)) {
      base = { x: quantStage(origStart.x), z: quantStage(origStart.z) };
    } else if (fallback && isFiniteNum(fallback.x) && isFiniteNum(fallback.z)) {
      base = { x: quantStage(fallback.x), z: quantStage(fallback.z) };
    }
    if (base && qx === base.x && qz === base.z) return { commit: false, reason: 'unchanged' };
    return { commit: true, x: qx, z: qz, reason: 'changed' };
  }
  // ---------- 2D 舞台朝向拖拽（TASK-20260909-M2-STAGE-YAW） ----------
  // 约定：米制不变；零 yaw 朝 +Z（屏上），正 yaw 把 +Z 转向 +X（屏右）；
  // 指针角 yaw = atan2(sx-cx, cy-sy)（度），与 facing 箭头 rotate(yaw) 同口径；
  // 存储原样保留有限数值（不包络归一，不钳制到视图范围）；数字编辑不量化，拖拽经一位小数？不——
  // 本增量拖拽量化为整度（STAGE_YAW_QUANT=1），模块变更记录声明，数值编辑保持未量化。
  var STAGE_YAW_QUANT = 1; // 朝向拖拽落位量化（度）：回原量化点即 no-op，不产生历史
  var STAGE_YAW_DEAD_PX = 1; // 中心死区半径（px）：标记盒经布局吸附（1/64px）后恰落中心释放实测残差约 0.01px，1e-6px 级阈值会误算成 ±90° 幽灵提交；1px 内按不可定角处理，正常拖拽以数十 px 计，不受影响
  function quantStageYaw(v) {
    if (!isFiniteNum(v)) return NaN;
    var q = Math.round(v / STAGE_YAW_QUANT) * STAGE_YAW_QUANT;
    if (!isFinite(q)) return NaN;
    return q === 0 ? 0 : q; // 去 -0，保持 JSON 稳定；不做包络归一（450 仍 450）
  }
  // 指针屏坐标→朝向（度）：(cx,cy) 为标记中心屏坐标，(sx,sy) 为指针屏坐标（同一表面基准）。
  // 返回有限 yawDeg，或 NaN（非有限输入/零向量不可定角，调用方按 no-op 处理）。
  function stageYawFromPointer(cx, cy, sx, sy) {
    if (!isFiniteNum(cx) || !isFiniteNum(cy) || !isFiniteNum(sx) || !isFiniteNum(sy)) return NaN;
    var dx = sx - cx, dy = cy - sy; // dy：屏上为正（+Z 向）
    if (!(dx * dx + dy * dy > STAGE_YAW_DEAD_PX * STAGE_YAW_DEAD_PX)) return NaN; // 中心死区内（含恰落中心）不可定角
    var deg = Math.atan2(dx, dy) * 180 / Math.PI;
    if (!isFinite(deg)) return NaN;
    return deg;
  }
  // 朝向拖拽提交判定（纯）：origStart 为原始 start 对象或 null/缺失；pointerYaw 为指针解算的原始 yaw（未量化）。
  // 返回 {commit, yaw, reason}：非有限→no-op；量化后与原始（显式取 yawDeg / 缺失取 0）相等→no-op；否则 commit 量化值。
  // x/z 由调用方严格保留（显式取原值，缺失取 fallback），本函数只定 yaw。
  function stageYawCommitDecision(origStart, pointerYaw) {
    if (!isFiniteNum(pointerYaw)) return { commit: false, reason: 'non-finite' };
    var q = quantStageYaw(pointerYaw);
    if (!isFiniteNum(q)) return { commit: false, reason: 'non-finite' };
    var base = 0;
    if (isStartObj(origStart) && isFiniteNum(origStart.yawDeg)
      && Object.keys(origStart).length === 3 && isFiniteNum(origStart.x) && isFiniteNum(origStart.z)) {
      base = quantStageYaw(origStart.yawDeg);
    } else {
      base = quantStageYaw(0);
    }
    if (!isFiniteNum(base)) base = 0;
    if (q === base) return { commit: false, reason: 'unchanged' };
    return { commit: true, yaw: q, reason: 'changed' };
  }

  // 放置签名（preview tick 窄刷新用）：长度+每位显式值，缺失记 '-'。
  function startSig(dancers) {
    var ds = dancers || [];
    return ds.length + '|' + ds.map(function (d) {
      return hasExplicitStart(d) ? (d.start.x + ',' + d.start.z + ',' + d.start.yawDeg) : '-';
    }).join('|');
  }

  var API = { pure: {
    q05: q05, TRACKS: TRACKS,
    eachClip: eachClip, collectSelected: collectSelected, clearSelection: clearSelection, selectAll: selectAll,
    batchMove: batchMove, moveGroup: moveGroup, alignStarts: alignStarts, insertTime: insertTime, deleteTime: deleteTime,
    insertTimePreview: insertTimePreview, deleteTimePreview: deleteTimePreview,
    planActionPlacement: planActionPlacement,
    serializeSelection: serializeSelection, makeRoom: makeRoom, pasteItems: pasteItems,
    PHRASE_KINDS: PHRASE_KINDS, allocIdFactory: allocIdFactory, existingClipIds: existingClipIds, collectCrossingClips: collectCrossingClips,
    newMarkerId: newMarkerId, addMarker: addMarker, removeMarker: removeMarker, updateMarker: updateMarker, sortMarkers: sortMarkers,
    anySolo: anySolo, isMuted: isMuted, mutedMap: mutedMap,
    buildGameClips: buildGameClips,
    copyDancerTracks: copyDancerTracks, planMultiActionPlacement: planMultiActionPlacement,
    applyMeasuredDurations: applyMeasuredDurations,
    macroEvents: macroEvents, macroLineEstimate: macroLineEstimate,
    followAccept: followAccept, followProject: followProject, hasCap: hasCap, FOLLOW_RESYNC_SEC: FOLLOW_RESYNC_SEC,
    resolveBindings: resolveBindings,
    setDancerBinding: setDancerBinding, planRender: planRender,
    appearanceId: appearanceId, masterKeyFor: masterKeyFor,
    profilesChangedNeedsRebuild: profilesChangedNeedsRebuild,
    START_SPACING: START_SPACING,
    hasExplicitStart: hasExplicitStart, parseStartField: parseStartField,
    validateStartInput: validateStartInput, startForward: startForward,
    setDancerStart: setDancerStart, clearDancerStart: clearDancerStart,
    placementFor: placementFor, startSig: startSig,
    STAGE_QUANT: STAGE_QUANT, STAGE_PAD: STAGE_PAD, STAGE_FALLBACK_SPAN: STAGE_FALLBACK_SPAN, STAGE_REFERENCE_SPAN: STAGE_REFERENCE_SPAN,
    quantStage: quantStage, computeStageTransform: computeStageTransform,
    stageWorldToScreen: stageWorldToScreen, stageScreenToWorld: stageScreenToWorld,
    stageTransformEqual: stageTransformEqual, stageCommitDecision: stageCommitDecision,
    STAGE_YAW_QUANT: STAGE_YAW_QUANT, STAGE_YAW_DEAD_PX: STAGE_YAW_DEAD_PX, quantStageYaw: quantStageYaw,
    stageYawFromPointer: stageYawFromPointer, stageYawCommitDecision: stageYawCommitDecision,
  } };

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoEdit = API;
})();
