/* choreo-check.js —— 编舞体检规则引擎（WP-4，v0.7；FIX-4 收口）
这个文件是干嘛的：
  对当前编舞项目做一次自动体检，找出"播不出来/播不好看/导不出宏"的问题：
  动作缺录、动作时长超出或没播满循环、姿态类动作之后角色僵在坐/躺、同通道动作条重叠
  （嵌套重叠也抓）、动作与当前骨架指纹不一致（P4 起按舞者绑定档案逐位比对）、动作只在
  别的角色档案命名空间（P4，附显式复制入口）、宏 <wait> 的 0.5 秒量化漂移、宏行数超单槽
  上限、资料库缺骨架、在线骨架指纹不一致、网页/插件协议与能力不匹配。
  全部规则是纯函数，输入 content + ctx、输出问题列表，
  主页控制器（choreo-app.js）只负责「🩺 体检」按钮、弹窗展示和点击跳转；
  node 单测 web\test-check.js 直接 require 本文件跑纯函数（需先 require choreo-edit.js——
  宏检查和宏导出共用 ChoreoEdit.pure.macroEvents/macroLineEstimate 同一份口径）。
  约定：content = { dancers, globalLyrics, markers }（与 choreo-edit.js 同口径）；
  ctx 由主页异步预取后传入（资料库索引/骨架状态/实测时长/配对握手/歌词宏开关等），测试时手工造。
  问题项 = { level:'red'|'yellow'|'info', rule, di, clipId, t, message }，
  di=-1 表示全局轨；t 是建议跳转的时间点；列表按 t 升序。
无依赖（宏规则软依赖 ChoreoEdit），经典脚本 IIFE（file:// 双击可用），挂 window.ChoreoCheck / globalThis.ChoreoCheck。
*/
(function () {
  'use strict';

  var TRACKS = ['switch', 'action', 'lyric'];
  var EPS = 1e-9;
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // 姿态类动作名单（与主页录制中心 REC_POSTURE、scripts\batch-record.js 的 POSTURE 同一份口径）：
  // 这些动作播完后角色会保持坐/躺/跪，只有角色移动或下一个动作能复位
  var POSTURE_NAMES = ['sit', 'groundsit', 'doze', 'kneel', 'playdead', 'pose', 'lounge', 'grovel', 'winded', 'situps', 'savortea'];

  // 与 preview3d.js 的 cmdToName 完全同规则（也即 ExportServer.cs 的保存命名）：
  // 去头斜杠、斜杠换下划线。体检结论必须和 3D 面板实际拉取的名字一致
  function cmdToName(cmd) {
    var s = String(cmd || '').trim();
    s = s.replace(/^\//, '').replace(/\//g, '_');
    return s;
  }

  // ctx 归一化：任何字段缺失都给出安全默认值，规则函数不用再判空
  function normCtx(ctx) {
    var c = ctx || {};
    var idx = {};
    if (c.libraryIndex && c.libraryIndex.length) {
      c.libraryIndex.forEach(function (e) {
        if (e && e.name) idx[e.name] = { duration: e.duration || 0, type: e.type || 'once', skeletonHash: e.skeletonHash || null };
      });
    }
    var posture = {};
    (c.postureNames || POSTURE_NAMES).forEach(function (n) { posture[n] = true; });
    return {
      library: idx,                       // 资料库动作索引（名字 → {duration,type,skeletonHash}）；空对象=查不了（不误报缺录）
      hasLibrary: !!c.libraryIndex,       // 资料库本身可用吗（不可用时缺录规则静默跳过）
      hasSkeleton: !!c.hasSkeleton,
      skeletonHash: c.skeletonHash || null,
      onlineSkeletonHash: c.onlineSkeletonHash || null, // 仅插件在线时才有：/export/skeleton 的 hash
      measuredDur: c.measuredDur || {},   // 插件实测时长（键=带斜杠命令），时长规则的辅助参考
      postureSet: posture,
      jobMap: c.jobMap || {},
      capsOk: c.capsOk !== false,         // 旧调用方不传时按"没问题"算，不误报
      pluginProbed: !!c.pluginProbed,     // 确实探测过插件吗（没探测过不评能力）
      pluginCaps: c.pluginCaps || null,
      protocolVersion: c.protocolVersion || 1,
      showLyricMacro: !!c.showLyricMacro, // 主页歌词宏开关：开着时宏检查要把全局歌词算进来（AUD-013）
      totalDuration: c.totalDuration || 0,
      // CHARACTER-ASSETS-P4：逐档案命名空间数据（体检 UI 预取；老调用方不带=逐档案
      // 规则静默回老口径，绝不误报）。profileClips=pid→{名:{duration,type,skeletonHash}}；
      // bindings=每舞者解析到的档案 id（resolveBindings 同口径，null=悬空/无档案）；
      // profileMeta=pid→{name,skeletonHash,boneCount}
      profileClips: c.profileClipIndex || null,
      bindings: c.dancerBindings || null,
      profileMeta: c.profileMeta || null,
    };
  }

  function mkIssue(level, rule, di, clipId, t, message, pid) {
    var o = { level: level, rule: rule, di: di, clipId: clipId || null, t: Math.round(t * 100) / 100, message: message };
    if (pid) o.pid = pid; // 冲突对方条（实时体检把两条都描边；跳转仍用 clipId）
    return o;
  }

  // ---------- 规则 1：动作缺录（黄） ----------
  // 时间轴动作条引用的动作在本地资料库里没有。表情类 29 条是主人指示不录的，引用了照样报——
  // 播放端（preview3d）就是显示"未录制"，体检口径与之一致。
  // P4：带逐档案数据时按「舞者绑定的档案命名空间」判定（绑定/缺省=活动档案同口径）；
  // 只在别的档案有的 → 规则 11 带复制入口去报，这里不重复
  function checkMissing(content, ctx, out) {
    if (!ctx.hasLibrary) return;
    (content.dancers || []).forEach(function (d, di) {
      ((d && d.actionClips) || []).forEach(function (c) {
        var name = cmdToName(c.data && c.data.command);
        if (!name) return;
        var ns = (ctx.bindings && ctx.bindings[di] && ctx.profileClips) ? (ctx.profileClips[ctx.bindings[di]] || {}) : null;
        if (ns) {
          if (ns[name]) return;
          for (var p2 in (ctx.profileClips || {})) {
            if (p2 !== ctx.bindings[di] && p2 !== '__pending__' && ctx.profileClips[p2][name]) return; // 规则 11 报
          }
          out.push(mkIssue('yellow', 'missing-clip', di, c.id, c.start,
            '舞者' + (di + 1) + ' 的动作「' + ((c.data && c.data.name) || name) + '」还没录进资料库，网页 3D 和游戏播放放不出这条'));
        } else if (!ctx.library[name]) {
          out.push(mkIssue('yellow', 'missing-clip', di, c.id, c.start,
            '舞者' + (di + 1) + ' 的动作「' + ((c.data && c.data.name) || name) + '」还没录进资料库，网页 3D 和游戏播放放不出这条'));
        }
      });
    });
  }

  // ---------- 规则 2：动作时长不足/超出（黄） ----------
  // once 动作条拖得比录制数据长 → 超出部分末帧定格；loop 动作条比循环周期短 → 一圈没跳完就被切走。
  function checkDuration(content, ctx, out) {
    if (!ctx.hasLibrary) return;
    (content.dancers || []).forEach(function (d, di) {
      ((d && d.actionClips) || []).forEach(function (c) {
        var name = cmdToName(c.data && c.data.command);
        if (!name) return;
        var lib = ctx.library[name];
        if (!lib || !(lib.duration > 0)) return;
        if (lib.type === 'loop') {
          if (c.duration < lib.duration - 0.05) {
            out.push(mkIssue('yellow', 'loop-too-short', di, c.id, c.start,
              '舞者' + (di + 1) + ' 的循环舞「' + ((c.data && c.data.name) || name) + '」条长 ' + c.duration.toFixed(1) + 's 不足一个循环 ' + lib.duration.toFixed(1) + 's，一圈没跳完就切走'));
          }
        } else if (c.duration > lib.duration + 0.1) {
          out.push(mkIssue('yellow', 'overrun', di, c.id, c.start + lib.duration,
            '舞者' + (di + 1) + ' 的动作「' + ((c.data && c.data.name) || name) + '」条长 ' + c.duration.toFixed(1) + 's 超过录制的 ' + lib.duration.toFixed(1) + 's，超出部分会定格在最后一帧'));
        }
      });
    });
  }

  // ---------- 规则 3：姿态类动作未复位（提示） ----------
  // 姿态类（坐/躺/跪等）播完后角色保持原姿势；如果它是该舞者动作轨的最后一条、
  // 而整场演出在它之后还有 10 秒以上的内容，提醒安排后续动作或复位。
  function checkPosture(content, ctx, out) {
    var totalEnd = 0;
    eachClipAll(content, function (c) { var e = c.start + c.duration; if (e > totalEnd) totalEnd = e; });
    (content.dancers || []).forEach(function (d, di) {
      var arr = ((d && d.actionClips) || []).slice().sort(function (a, b) { return a.start - b.start; });
      if (!arr.length) return;
      var last = arr[arr.length - 1];
      var name = cmdToName(last.data && last.data.command);
      if (!name || !ctx.postureSet[name]) return;
      var end = last.start + last.duration;
      if (totalEnd - end > 10) {
        out.push(mkIssue('info', 'posture-uncleared', di, last.id, end,
          '舞者' + (di + 1) + ' 最后一条是姿态类动作「' + ((last.data && last.data.name) || name) + '」，之后 ' + (totalEnd - end).toFixed(0) + 's 内没有新动作——角色会一直保持坐/躺/跪，需要在之后安排动作（或拖动角色）复位'));
      }
    });
  }

  // 遍历所有 clip（含全局歌词），只用于求整场时间末端
  function eachClipAll(content, cb) {
    (content.dancers || []).forEach(function (d) {
      TRACKS.forEach(function (tt) { ((d && d[tt + 'Clips']) || []).forEach(function (c) { cb(c); }); });
    });
    ((content && content.globalLyrics) || []).forEach(cb);
  }

  // ---------- 规则 4：同通道重叠（红） ----------
  // 同轨两条时间上压住 = 红；switch 轨与 action 轨互相压住也是红（游戏里切职业同样占用
  // 动作通道，主页 conflictEnd 既有语义）。歌词轨内部压住只提示（多条台词同刻播宏会合并，不炸）。
  // AUD-009：同轨改用"已开始条目的最晚结束"扫描——每条只要在某个更早开始的条目结束前开始
  // 就算重叠，长条包住多个短条的嵌套/多层嵌套都能抓到；每条冲突条目至多报一次，不刷屏
  function checkOverlap(content, ctx, out) {
    function scanPair(di, prev, cur, level, labelA, labelB, clipId, t, pid) {
      out.push(mkIssue(level, 'overlap', di, clipId, t,
        '舞者' + (di + 1) + ' ' + labelA + '与' + labelB + '时间重叠，游戏内会互相抢通道，请错开', pid));
    }
    (content.dancers || []).forEach(function (d, di) {
      if (!d) return;
      // 同轨：起点排序，维护当前最晚结束及其来源条目（相接不算重叠，0.01 容差）
      TRACKS.forEach(function (tt) {
        var arr = ((d[tt + 'Clips']) || []).slice().sort(function (a, b) { return a.start - b.start; });
        var maxEnd = null, maxEndClip = null;
        for (var i = 0; i < arr.length; i++) {
          var cur = arr[i];
          if (maxEndClip && cur.start < maxEnd - 0.01) {
            scanPair(di, maxEndClip, cur, tt === 'lyric' ? 'info' : 'red',
              '「' + trackLabel(tt) + '轨」两条动作条', '（' + fmtClip(maxEndClip) + ' 和 ' + fmtClip(cur) + '）',
              cur.id, cur.start, maxEndClip.id);
          }
          var end = cur.start + cur.duration;
          if (maxEnd === null || end > maxEnd) { maxEnd = end; maxEndClip = cur; }
        }
      });
      // 跨轨：switch 与 action 互斥（沿用主页 conflictEnd 的 0.01 容差口径）
      var sw = d.switchClips || [], ac = d.actionClips || [];
      for (var i = 0; i < sw.length; i++) for (var k = 0; k < ac.length; k++) {
        var s = sw[i], a = ac[k];
        if (a.start < s.start + s.duration - 0.01 && a.start + a.duration > s.start + 0.01) {
          scanPair(di, s, a, 'red', '切职业条「' + fmtClip(s) + '」', '动作条「' + fmtClip(a) + '」', a.id, a.start, s.id);
        }
      }
    });
  }
  function trackLabel(tt) { return tt === 'switch' ? '切职业' : tt === 'action' ? '动作' : '台词'; }
  function fmtClip(c) { return ((c.data && c.data.name) || '#' + c.id) + '@' + c.start.toFixed(1) + 's'; }

  // ---------- 规则 5：宏量化漂移（提示） ----------
  // 宏 <wait.X> 只有 0.5s 粒度（generateMacro 的 fmtWait 四舍五入到 0.5s），且间隔 <0.5s
  // 连 wait 都不输出（直接吃掉）。按 generateMacro 同样的 0.1s 分组口径，检查相邻组间隔。
  // AUD-013：事件口径和宏导出走同一份 ChoreoEdit.pure.macroEvents——主页开着歌词宏时
  // 全局歌词也会进宏，检查必须把它算进去，否则漏报
  function macroEventsOf(content, ctx, d) {
    var EP = (typeof ChoreoEdit !== 'undefined') && ChoreoEdit && ChoreoEdit.pure;
    if (!EP || !EP.macroEvents) return null; // 共享口径层没加载（产品里 choreo-edit.js 先于本文件加载）
    return EP.macroEvents(d, content.globalLyrics, !!ctx.showLyricMacro);
  }
  function checkMacroQuantize(content, ctx, out) {
    (content.dancers || []).forEach(function (d, di) {
      if (!d) return;
      var ev = macroEventsOf(content, ctx, d);
      if (!ev) return;
      var starts = [];
      ev.forEach(function (e) { starts.push(e.clip.start); });
      starts.sort(function (a, b) { return a - b; });
      // 0.1s 内的起点算同一组（与 generateMacro 分组一致）
      var groups = [];
      starts.forEach(function (t) {
        if (!groups.length || t - groups[groups.length - 1] > 0.1) groups.push(t);
      });
      for (var i = 1; i < groups.length; i++) {
        var gap = groups[i] - groups[i - 1];
        if (gap < 0.5 - EPS) {
          out.push(mkIssue('info', 'macro-gap-lost', di, null, groups[i],
            '舞者' + (di + 1) + ' 在 ' + groups[i].toFixed(1) + 's 处的动作间隔只有 ' + gap.toFixed(1) + 's，导出宏时这个间隔会被吃掉（<wait> 最小 0.5s），游戏里会比网页快'));
        } else if (Math.abs(gap / 0.5 - Math.round(gap / 0.5)) > 0.05) {
          out.push(mkIssue('info', 'macro-drift', di, null, groups[i],
            '舞者' + (di + 1) + ' 在 ' + groups[i].toFixed(1) + 's 处的动作间隔 ' + gap.toFixed(2) + 's 不是 0.5s 整数倍，导出宏会四舍五入成 ' + (Math.round(gap * 2) / 2).toFixed(1) + 's，游戏里会慢慢和网页对不上'));
        }
      }
    });
  }

  // ---------- 规则 6：宏行数超单槽上限（提示） ----------
  // 行数估算走 ChoreoEdit.pure.macroLineEstimate（和 generateMacro 逐字同口径：每个事件一行、
  // 歌词没文字不出行、动作换职业且 jobMap 里有才插一行切职业），不再各算各的（AUD-013）
  function checkMacroLines(content, ctx, out) {
    (content.dancers || []).forEach(function (d, di) {
      if (!d) return;
      var ev = macroEventsOf(content, ctx, d);
      if (!ev) return;
      var EP = ChoreoEdit.pure;
      var est = EP.macroLineEstimate(ev, ctx.jobMap);
      var total = est.lines + 1; // +1 行 /echo 标题
      if (est.lines > 14) {
        out.push(mkIssue('info', 'macro-pages', di, null, 0,
          '舞者' + (di + 1) + ' 的导出宏约 ' + total + ' 行（含标题行），超过游戏单宏槽 15 行上限，会自动用 /nextmacro 分页成 ' + Math.ceil(est.lines / 14) + ' 页（能连续执行，属正常现象）'));
      }
    });
  }

  // ---------- 规则 7：骨架资料（红/黄） ----------
  // 没有骨架 = 网页 3D 无法正确驱动任何动作（red）；在线取得的骨架指纹和资料库里的不一致
  // = 换过角色/种族，旧动作可能错位（yellow）。
  // 模型指纹说明（FIX-4/AUD-013）：资料库已给每个模型文件记 SHA-256 指纹（choreo-library.js
  // putModelFile/getModelFiles），但体检时刻没有第二个可信来源可和它比对——模型换装只影响
  // 外观网格、不影响骨骼动画正确性；影响动画正确性的骨架变化已由本规则和规则 9 覆盖。
  // 所以模型指纹只做元数据留档，不出报告（可解释的"无法确认"，不误报）。
  function checkSkeleton(content, ctx, out) {
    if (!ctx.hasSkeleton) {
      out.push(mkIssue('red', 'no-skeleton', -1, null, 0,
        '资料库里没有参考骨架：网页 3D 播不了动作。开着游戏打开一次本页会自动存进来，或在「📦 资料库」里导入备份'));
    } else if (ctx.skeletonHash && ctx.onlineSkeletonHash && ctx.skeletonHash !== ctx.onlineSkeletonHash) {
      out.push(mkIssue('yellow', 'skeleton-mismatch', -1, null, 0,
        '游戏里当前的骨架和正在使用的角色档案不一致（可能换了种族/外形）——3D 面板已拒绝错配套用；可在 3D 预览面板切换角色档案、点「采用游戏角色」建新档案，或重录动作'));
    }
  }

  // ---------- 规则 8：动作与当前骨架的指纹（黄，FIX-4/AUD-013 新增） ----------
  // choreo-library.js 每次写动作时把"当时的骨架指纹"盖在动作元数据上（skeletonHash）。
  // 时间轴引用的动作若是在另一个骨架（换过种族/外形）下录的，播放会错位——报黄。
  // P4：带逐档案数据时按「舞者绑定档案」的指纹比对（design §7：逐舞者报错位）；
  // 老调用方不带逐档案数据 → 按活动档案指纹（原口径不动）。
  // 旧数据没盖过指纹 → 证据不足不报（无法确认），绝不误报。
  function checkClipSkeleton(content, ctx, out) {
    if (!ctx.hasLibrary) return;
    (content.dancers || []).forEach(function (d, di) {
      if (!d) return;
      var pid = (ctx.bindings && ctx.bindings[di]) || null;
      var perDancer = !!(pid && ctx.profileClips && ctx.profileMeta && ctx.profileMeta[pid]);
      var fp = perDancer ? (ctx.profileMeta[pid].skeletonHash || null) : ctx.skeletonHash;
      if (!fp) return;
      var ns = perDancer ? (ctx.profileClips[pid] || {}) : null;
      ((d && d.actionClips) || []).forEach(function (c) {
        var name = cmdToName(c.data && c.data.command);
        if (!name) return;
        var lib = ns ? ns[name] : ctx.library[name];
        if (!lib || !lib.skeletonHash) return; // 录制时没绑定骨架指纹 → 无法确认
        if (lib.skeletonHash !== fp) {
          out.push(mkIssue('yellow', 'clip-skeleton-mismatch', di, c.id, c.start,
            '舞者' + (di + 1) + ' 的动作「' + ((c.data && c.data.name) || name) + '」是在另一个角色体型（骨架指纹不同）下录进资料库的，当前档案下播放可能错位——建议重录，或在 3D 预览面板切回录制时用的角色档案'));
        }
      });
    });
  }

  // ---------- 规则 11：动作只在别的档案命名空间（黄，CHARACTER-ASSETS-P4） ----------
  // 舞者绑定的档案缺这条动作、别的档案有 → 3D 预览里这位舞者整位回落替身（绝不跨
  // 档案借用，preview3d 同口径）。报告附复制入口信息（copyFrom/copyTo/clipName/名称）：
  // 「显式按舞者复制」是唯一跨档案通道（choreo-check-ui 的确认弹窗 →
  // ChoreoLibrary.copyClipToProfile）。缺逐档案数据时整条静默（老调用方不误报）。
  // 待归档区（__pending__）不算「别的档案」——那是认领流程的事
  function checkNamespacedClips(content, ctx, out) {
    if (!ctx.hasLibrary || !ctx.profileClips || !ctx.bindings) return;
    (content.dancers || []).forEach(function (d, di) {
      if (!d) return;
      var pid = ctx.bindings[di];
      if (!pid) return; // 悬空/无档案：规则 1/预览提示管，不猜
      var own = ctx.profileClips[pid] || {};
      var seen = {};
      ((d && d.actionClips) || []).forEach(function (c) {
        var name = cmdToName(c.data && c.data.command);
        if (!name || seen[name]) return;
        seen[name] = true;
        if (own[name]) return;
        var src = null;
        for (var p2 in ctx.profileClips) {
          if (p2 === pid || p2 === '__pending__') continue;
          if (ctx.profileClips[p2][name]) { src = p2; break; }
        }
        if (!src) return; // 哪都没有 → 规则 1 缺录口径
        var srcName = (ctx.profileMeta && ctx.profileMeta[src] && ctx.profileMeta[src].name) || '其他档案';
        var dstName = (ctx.profileMeta && ctx.profileMeta[pid] && ctx.profileMeta[pid].name) || '他的档案';
        var it = mkIssue('yellow', 'missing-clip-ns', di, c.id, c.start,
          '舞者' + (di + 1) + ' 的动作「' + ((c.data && c.data.name) || name) + '」不在他绑定的档案「' + dstName + '」里（只在档案「' + srcName + '」里有），3D 预览里这位舞者会用替身显示，不会借用别的档案的动作');
        it.copyFrom = src; it.copyTo = pid; it.clipName = name;
        it.copyFromName = srcName; it.copyToName = dstName;
        out.push(it);
      });
    });
  }

  // ---------- 规则 9：网页/插件能力不匹配（提示/黄） ----------
  // 网页正常工作所需的插件能力（与插件 /capabilities.capabilities 清单对应；gpose 可选不算）
  var REQUIRED_CAPS = ['playback', 'seek', 'freeze', 'recording', 'walkreset', 'library-sync'];
  function checkCaps(content, ctx, out) {
    if (!ctx.pluginProbed) return;
    if (!ctx.capsOk) {
      // AUD-013：旧插件实际走兼容模式（写请求不带配对头也能用），旧文案"写接口会被拒"与行为矛盾
      out.push(mkIssue('info', 'caps-old-plugin', -1, null, 0,
        '游戏插件版本较旧（0.6.6 及以前），没有能力握手和配对机制——网页会走兼容模式继续工作，但缺少新版的安全保护，建议更新插件'));
      return;
    }
    var pc = ctx.pluginCaps;
    if (pc && typeof pc.protocolVersion === 'number') {
      if (pc.protocolVersion > ctx.protocolVersion) {
        // 插件新、网页旧：协议向后兼容时功能照用，属"提醒升级"
        out.push(mkIssue('info', 'caps-new-plugin', -1, null, 0,
          '插件的协议版本（' + pc.protocolVersion + '）比网页（' + ctx.protocolVersion + '）新，部分新功能网页用不上——建议更新网页'));
      } else if (pc.protocolVersion < ctx.protocolVersion) {
        // 网页新、插件旧：语义可能对不上，属"必须升级插件"
        out.push(mkIssue('yellow', 'caps-protocol-old', -1, null, 0,
          '插件的协议版本（' + pc.protocolVersion + '）比网页（' + ctx.protocolVersion + '）旧，部分功能语义可能对不上——请升级游戏内插件后再排练/导出'));
      }
    }
    // 能力清单逐项比对：缺能力 = 功能少（可兼容），如实指出缺哪些
    if (pc && pc.capabilities) {
      var have = {};
      (Array.isArray(pc.capabilities) ? pc.capabilities : []).forEach(function (c) { have[c] = true; });
      var missing = REQUIRED_CAPS.filter(function (c) { return !have[c]; });
      if (missing.length) {
        out.push(mkIssue('yellow', 'caps-missing', -1, null, 0,
          '插件缺少网页需要的能力：' + missing.join('、') + '——相关功能不可用，请升级游戏内插件'));
      }
    }
  }

  // ---------- 规则 10：暂不支持执行的事件类型（能力报告，info） ----------
  // 六轨无损后（TASK-20260901-SIX-TRACK-ROUNDTRIP），ability/movement/facing 事件随项目完整保留，
  // 但插件目前只执行 motion/cue/lyrics。这里按类型点名+计数，让主人在编译演出包前知道
  // 哪些内容会被插件拒绝——绝不静默丢弃。数据来源：投影冻结轨（content._doc.extraTracks，
  // 产品页体检入口不带载体时回退读控制器 store.contentExtra 的同一份）+ 泳道 clip 的 _doc 载体
  var PLUGIN_EXECUTABLE = { motion: true, cue: true, lyrics: true };
  function checkUnsupportedKinds(content, ctx, out) {
    var counts = {}, firstT = {};
    function note(k, tSec) {
      if (PLUGIN_EXECUTABLE[k]) return;
      counts[k] = (counts[k] || 0) + 1;
      if (firstT[k] === undefined || tSec < firstT[k]) firstT[k] = tSec;
    }
    var src = null;
    if (isObj(content) && isObj(content._doc) && Array.isArray(content._doc.extraTracks)) src = content._doc.extraTracks;
    if (!src) { // 产品页体检 content 不带 _doc 载体——回退读控制器 store 的同一份冻结数据
      try {
        var s = (typeof store !== 'undefined' && store) || (typeof window !== 'undefined' && window.store);
        if (s && isObj(s.contentExtra) && isObj(s.contentExtra._doc) && Array.isArray(s.contentExtra._doc.extraTracks)) src = s.contentExtra._doc.extraTracks;
      } catch (e) { /* 无控制器环境（node 纯函数）：跳过回退 */ }
    }
    (src || []).forEach(function (t) {
      if (!t || t.enabled === false || !Array.isArray(t.events)) return;
      t.events.forEach(function (ev) {
        if (!ev || ev.enabled === false) return;
        note(String(ev.kind || ''), (Number(ev.startMs) || 0) / 1000);
      });
    });
    (content.dancers || []).forEach(function (d) { // 泳道 clip 上偶发的未支持类型（_doc.kind 载体）
      if (!d) return;
      TRACKS.forEach(function (tt) {
        ((d && d[tt + 'Clips']) || []).forEach(function (c) {
          if (c && isObj(c._doc) && c._doc.kind) note(String(c._doc.kind), Number(c.start) || 0);
        });
      });
    });
    Object.keys(counts).sort().forEach(function (k) {
      out.push(mkIssue('info', 'unsupported-kind', -1, null, firstT[k],
        '「' + k + '」类事件共 ' + counts[k] + ' 条：编排数据会完整保留，但当前游戏插件还没有对应的执行器，编译演出包会被插件拒绝——等该执行器上线后再排练游戏内执行'));
    });
  }

  // ---------- 汇总入口 ----------
  // check(content, ctx) → 问题列表（按 t 升序，同时刻按 di）。纯函数：不改 content。
  function check(content, ctx) {
    var c = normCtx(ctx);
    var out = [];
    checkSkeleton(content, c, out);
    checkCaps(content, c, out);
    checkUnsupportedKinds(content, c, out);
    var gear = (typeof window !== 'undefined' ? window : globalThis).ChoreoGearset;
    (content.dancers || []).forEach(function(d, di) {
      (d.switchClips || []).forEach(function(clip) {
        var result = gear ? gear.resolveSwitch(clip.data) : {ok:false,error:'套装校验模块未加载，请完整更新网页；切换条目仍保留。'};
        out.push(mkIssue(result.ok ? 'yellow' : 'red', 'gearset', di, clip.id, clip.start,
          result.ok ? '编号或名称未核实。' + gear.PREVIEW_NOTICE : result.error));
      });
    });
    checkMissing(content, c, out);
    checkDuration(content, c, out);
    checkPosture(content, c, out);
    checkOverlap(content, c, out);
    checkClipSkeleton(content, c, out);
    checkNamespacedClips(content, c, out);
    checkMacroQuantize(content, c, out);
    checkMacroLines(content, c, out);
    out.sort(function (a, b) { return a.t - b.t || a.di - b.di || String(a.rule).localeCompare(String(b.rule)); });
    return out;
  }

  var API = {
    pure: {
      cmdToName: cmdToName,
      POSTURE_NAMES: POSTURE_NAMES,
      REQUIRED_CAPS: REQUIRED_CAPS,
      PLUGIN_EXECUTABLE: PLUGIN_EXECUTABLE,
      check: check,
      checkMissing: checkMissing, checkDuration: checkDuration, checkPosture: checkPosture,
      checkOverlap: checkOverlap, checkMacroQuantize: checkMacroQuantize, checkMacroLines: checkMacroLines,
      checkSkeleton: checkSkeleton, checkClipSkeleton: checkClipSkeleton, checkCaps: checkCaps,
      checkNamespacedClips: checkNamespacedClips,
      checkUnsupportedKinds: checkUnsupportedKinds, normCtx: normCtx,
    }
  };

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoCheck = API;
})();
