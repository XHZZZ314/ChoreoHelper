// 工作台壳（TASK-20260919-UI-OVERHAUL P1-A）：空态三入口、按顺序添加/插在这里、等待带、
// 舞台 3D/俯视标签与只读俯视预览。纯视图+会话状态模块：不读写项目存储、不发请求、不改数据
// 模型；编舞数据写入一律回到 choreo-app.js 的既有编辑路径（addClip/saveHistory/render）。
// B4 主俯视图节点直拖接线：节点手柄命中→ChoreoStageMotionUI 拖动 API（改草稿不落库）；
// 拖动期间冻结画布变换（指针映射与绘制共用同一冻结变换，不重拟合）；节点手势吞掉紧随的 click。
// B6 视图约定与拟合（HF-09/HF-10）：默认拟合＝全员真实起始位＋当前舞者可见时间窗内走位＋窗口
// 两端必采样＋已选对象舞者播放头采样（各绑各 di/起点；窗外节点不参与；不钳制不改 authored 坐标）；
// 三视图态（跟随窗口/适应全部/手动，当前态可见）；主俯视图两面常驻方向标注（+X 右、+Z 下＝观众侧）。
(function () {
  'use strict';
  function store() { return (typeof window !== 'undefined' && window.store) || null; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function snap05(t) { return Math.round(Number(t) * 2) / 2; }
  function fmt(t) { return (Math.round(Number(t) * 10) / 10).toFixed(1) + 's'; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // 会话级壳状态：insertAt=插在这里的选定时刻（秒，0.5 吸附）；appendWait=接着添加的等待值；
  // rehearsal=定位排练记录的循环区间（只用于“停止即退出循环”，不持久化、不进项目）。
  var S = { started: false, insertAt: null, appendWait: 0, tab: '3d', layout: lsGet('choreo_wb_layout', 'timeline'), rehearsal: null };
  var _topView = { sc: 1, w: 0, h: 0, maxAbs: 1, panX: 0, panZ: 0 };
  var _topFrozen = false; // B4：节点拖动期间冻结俯视变换（sc/w/h 不重算），杜绝边拖边重采样/抖动
  var _nodeGesture = false; // B4：节点手势（选中/拖动）已处理时吞掉紧随的 click，避免重复选点
  var _topMode = 'window'; // B6 三视图态：跟随窗口（默认）｜适应全部｜手动（缩放/平移后进入）
  var _topForce = true;    // B6：下次绘制强制重拟合（开窗/解冻/显式按钮）
  var _topInSession = false; // B6：会话开闭沿各重算一次；会话稳态不重拟合（防画面跳动）

  function actionClips(d) { return ((d && d.actionClips) || []).slice().sort(function (a, b) { return a.start - b.start; }); }
  function lastActionEnd(d) {
    var end = 0; actionClips(d).forEach(function (c) { var e = c.start + c.duration; if (e > end) end = e; }); return end;
  }
  // P2：侧栏正在看技能（技能总表/职业页）时，落点预告按技能轨末尾播报，不用动作轨落点误导
  function isSkillTab(s) {
    var t = (s || {}).activeTab || '';
    return t === 'skill-all' || String(t).indexOf('job-') === 0;
  }
  function skillClips(di) {
    var s = store(); if (!s || !window.ChoreoAbilityPlan) return [];
    var who = ChoreoAbilityPlan.pid(s, di); if (!who) return [];
    return ChoreoAbilityPlan.rows(s).filter(function (r) { return r.source === who; });
  }
  function lastSkillEnd(di) {
    var end = 0; skillClips(di).forEach(function (r) { var e = r.event.startMs + r.event.durationMs; if (e > end) end = e; });
    return end / 1000;
  }

  // ---------- 空态三入口 ----------
  function beginWorkbench() { S.started = true; }
  function startFromMacro() {
    S.started = true;
    var s = store(); if (s) { s.macroCollapsed = false; s.macroFullscreen = false; }
  }
  function noteLoaded(hasContent) { S.started = !!hasContent; S.insertAt = null; S.rehearsal = null; } // 换项目/装载后：有内容直接进工作台，空项目回到空态
  function emptyState(opts) {
    var box = el('div', 'wb-empty'); box.id = 'wbEmpty';
    box.appendChild(el('h2', 'wb-empty-title', '这里用来排一场演出'));
    box.appendChild(el('p', 'wb-empty-lead', '按顺序添加动作，在时间轴上调整先后和间隔，在舞台上看效果。也可以从你已经写好的宏开始。'));
    var choices = el('div', 'wb-empty-choices');
    function card(title, small, btnText, btnId, fn) {
      var c = el('div', 'wb-empty-card');
      c.appendChild(el('b', '', title));
      c.appendChild(el('small', '', small));
      var b = el('button', 'btn primary', btnText); b.type = 'button'; b.id = btnId;
      b.onclick = fn; c.appendChild(b); return c;
    }
    choices.appendChild(card('从零开始', '按顺序接着添加，不用先想好时刻', '添加第一个动作', 'wbEmptyStart', function () { opts.onScratch(); }));
    choices.appendChild(card('从已有宏开始', '粘贴宏，先预览再应用', '粘贴我的宏', 'wbEmptyMacro', function () { opts.onMacro(); }));
    choices.appendChild(card('打开旧项目', '已有内容直接可见，不会改数据', '打开旧项目', 'wbEmptyOpen', function () { opts.onOpen(); }));
    box.appendChild(choices);
    return box;
  }

  // ---------- 接着添加 / 插在这里 ----------
  // 首条旅程 J3：预告是一句完整的话（上一条开始/编排/结束＋等待＋新落点＋开始相隔）；
  // 数值必须读现有规划的实际结果（snap05 0.5 秒吸附），不能只写请求值。
  function landingText(s) {
    s = s || store(); if (!s) return '';
    var di = s.selectedDancer, d = s.dancers[di]; if (!d) return '';
    if (S.insertAt != null) return '落点预告：插在 ' + fmt(S.insertAt) + '；动作与技能都落在所选时刻（重叠时按现有顺延规则并提示）';
    var w = Math.max(0, Number(S.appendWait) || 0);
    if (isSkillTab(s)) { // P2：技能与动作同一锚点语义，但各自轨末尾独立，预告必须如实说技能轨
      var sEnd = lastSkillEnd(di);
      if (!skillClips(di).length) return '技能落点预告：第一个技能从 0.0s 开始（技能轨与动作轨各自独立）';
      return '技能落点预告：上一个技能 ' + fmt(sEnd) + ' 结束，' + (w > 0 ? ('等待 ' + fmt(w) + ' 后') : '') + '新技能从 ' + fmt(sEnd + w) + ' 开始';
    }
    var clips = actionClips(d);
    // J3/添加到全部：多舞者各轨末尾可能不同，预告只代表当前舞者，必须说明
    var allNote = (s.addToAll && s.dancers && s.dancers.length > 1)
      ? '；添加到全部舞者时各舞者按自己的轨末尾落位，这里只是当前舞者的预告' : '';
    if (!clips.length) return '落点预告：第一个动作从 0.0s 开始' + allNote;
    // 上一条＝结束最晚的动作（与 lastActionEnd 同一口径）
    var prev = clips[0], end = prev.start + prev.duration;
    clips.forEach(function (c) { var e = c.start + c.duration; if (e > end) { end = e; prev = c; } });
    var start = snap05(end + w);
    var msg = '落点预告：上一个动作「' + ((prev.data && prev.data.name) || '动作') + '」从 ' + fmt(prev.start) + ' 开始、编排 ' + fmt(end - prev.start) + '、到 ' + fmt(end) + ' 结束；'
      + (w > 0 ? ('等待 ' + fmt(w) + ' 后，') : '紧接着，')
      + '新动作从 ' + fmt(start) + ' 开始（两条开始相隔 ' + fmt(start - prev.start) + '）';
    var raw = end + w;
    if (Math.abs(snap05(raw) - raw) > 1e-9) msg += '；' + fmt(raw) + ' 已按现有 0.5 秒规则对齐，实际空隙 ' + fmt(start - end);
    return msg + allNote;
  }
  function setAppendWait(v) {
    if (v == null || String(v).trim() === '' || !isFinite(Number(v)) || Number(v) < 0) return false;
    S.appendWait = Number(v);
    var lp = document.getElementById('wbLanding'); if (lp) lp.textContent = landingText();
  }
  function setInsertAt(t) {
    if (!isFinite(t) || t < 0) return;
    S.insertAt = snap05(t);
    if (typeof window.refreshWorkbenchBars === 'function') window.refreshWorkbenchBars();
  }
  function clearInsert() {
    if (S.insertAt == null) return false;
    S.insertAt = null;
    if (typeof window.refreshWorkbenchBars === 'function') window.refreshWorkbenchBars();
    return true;
  }
  function consumeInsert() { var t = S.insertAt; if (t != null) S.insertAt = null; return t; }
  function addBar(opts) {
    if (!store()) return null;
    var bar = el('div', 'wb-addbar'); bar.id = 'wbAddBar';
    var skillMode = isSkillTab(store());
    var target = store().dancers[store().selectedDancer];
    // J2：添加目标直接写「下一条」——与下方「正在修改」区互相独立，两区不回写
    var targetLabel = el('span', 'wb-add-target', '下一条添加到：' + (store().addToAll ? '全部舞者' : target ? target.name : '未选择舞者'));
    targetLabel.id = 'wbAddTarget'; bar.appendChild(targetLabel);
    if (S.insertAt == null) {
      var b = el('button', 'btn primary', skillMode ? '＋ 接着添加技能' : '＋ 接着添加动作'); b.type = 'button'; b.setAttribute('data-wb', 'add-next');
      b.title = skillMode
        ? '从左侧技能列表点一个技能：它会排在当前舞者技能轨末尾＋等待值（与动作轨各自独立）'
        : '从左侧动作库点一个动作：它会接在当前舞者动作轨末尾，与上一条结束相隔下面设置的秒数（默认 0）';
      b.onclick = function () { opts.onAddNext(); }; bar.appendChild(b);
      // J2：等待字段点名「添加时」，与下方「这条开始前」区分对象；只影响以后添加，不一次性消费
      var lab = el('label', 'wb-field', '添加时：与上一条结束相隔');
      lab.title = '这个间隔只用于之后从左侧添加的动作，不改已排好的动作，也不是用一次就清零';
      var wi = el('input', ''); wi.type = 'number'; wi.min = '0'; wi.step = '0.5'; wi.id = 'wbWaitInput'; wi.value = String(S.appendWait);
      wi.setAttribute('aria-label', '添加时与上一条结束相隔（秒）');
      var waitError = el('span', '', '');waitError.id = 'wbWaitError';waitError.setAttribute('role', 'status');
      wi.setAttribute('aria-describedby', 'wbWaitError');
      function validWait() { return wi.value.trim() !== '' && isFinite(Number(wi.value)) && Number(wi.value) >= 0; }
      wi.oninput = function () {
        var valid = validWait();wi.setAttribute('aria-invalid', valid ? 'false' : 'true');
        waitError.textContent = valid ? '' : '请输入大于或等于 0 的有限秒数；当前间隔仍为 ' + S.appendWait + ' 秒。';
        if (valid) opts.onWaitChange(Number(wi.value));
      };
      wi.onblur = function () {
        if (validWait()) return;
        wi.value = String(S.appendWait);wi.setAttribute('aria-invalid', 'false');
        waitError.textContent = '输入无效，已保留原间隔 ' + S.appendWait + ' 秒。';
      };
      wi.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault();wi.onblur();wi.blur(); } };
      lab.appendChild(wi); lab.appendChild(el('span', '', '秒')); bar.appendChild(lab);bar.appendChild(waitError);
    } else {
      var bi = el('button', 'btn primary', '＋ 插在这里（T）'); bi.type = 'button'; bi.setAttribute('data-wb', 'insert');
      bi.title = '从左侧点一个动作或技能：它会插在所选时刻（0.5 秒吸附）';
      bi.onclick = function () { opts.onInsert(); }; bar.appendChild(bi);
      var lb = el('span', 'wb-insert-label', '已选时刻 ' + fmt(S.insertAt) + '，将插在这里'); lb.setAttribute('role', 'status'); bar.appendChild(lb);
      var bb = el('button', 'btn', '改回接着添加'); bb.type = 'button'; bb.setAttribute('data-wb', 'back-append');
      bb.onclick = function () { opts.onBack(); }; bar.appendChild(bb);
    }
    var lp = el('span', 'wb-landing', landingText()); lp.id = 'wbLanding'; lp.setAttribute('role', 'status');
    bar.appendChild(lp);
    var mb = el('button', 'btn', '从已有宏开始…'); mb.type = 'button'; mb.id = 'wbMacroStart';
    mb.setAttribute('data-wb', 'macro-start');
    mb.title = '粘贴游戏宏：先逐行预览识别，确认后再应用到时间轴；不支持的行保留原文备查';
    mb.onclick = function () { if (opts.onMacro) opts.onMacro(); };
    bar.appendChild(mb);
    return bar;
  }

  // ---------- 宏原文备注（不支持的行，按当前舞者独立可查） ----------
  function macroNotesArea(notes) {
    if (!notes || !notes.length) return null;
    var fold = document.createElement('details'); fold.className = 'wb-macro-notes'; fold.id = 'wbMacroNotes';
    var sum = document.createElement('summary');
    sum.textContent = '宏原文备注（' + notes.length + ' 行不支持，保留原文）';
    fold.appendChild(sum);
    var list = el('div', 'wb-macro-notes-list');
    notes.forEach(function (n) {
      var row = el('div', 'wb-macro-note');
      row.appendChild(el('code', 'wb-macro-note-tx', n.text));
      row.appendChild(el('span', 'wb-macro-note-why', n.why || ''));
      list.appendChild(row);
    });
    fold.appendChild(list);
    return fold;
  }

  // ---------- 定位排练这一段（循环区间复用 loopA/B；停止即退出由控制器调用） ----------
  function startRehearsal(a, b) { S.rehearsal = { a: a, b: b }; }
  function rehearsalActive() { return !!S.rehearsal; }
  function rehearsalRange() { return S.rehearsal ? { a: S.rehearsal.a, b: S.rehearsal.b } : null; }
  function exitRehearsal() { S.rehearsal = null; }
  // 停止时若循环区间仍是定位排练记录的区间，就退出循环（手工改过 A/B 则不动）
  function rehearsalStopped() {
    if (!S.rehearsal) return false;
    var s = store(), same = !!(s && s.loopA === S.rehearsal.a && s.loopB === S.rehearsal.b);
    S.rehearsal = null;
    return same;
  }

  // ---------- 等待带（动作轨相邻片段之间的 end-to-end 空隙，不等于动作时长） ----------
  function appendWaitBands(body, dancer) {
    if (!body || !dancer) return;
    var s = store(); if (!s) return;
    var clips = actionClips(dancer);
    for (var i = 1; i < clips.length; i++) {
      var prev = clips[i - 1], cur = clips[i];
      var gap = cur.start - (prev.start + prev.duration);
      if (gap <= 0.01) continue;
      var band = el('div', 'wait-band', '等待 ' + fmt(gap) + ' 秒');
      band.style.left = ((prev.start + prev.duration) * s.pps) + 'px';
      band.style.width = Math.max(6, gap * s.pps) + 'px';
      band.title = '这是两个动作之间的等待间隔（改它只改后面动作的开始时刻，不改任何动作时长）。点一下选中后面的动作。';
      band.setAttribute('data-wb-band', String(cur.id));
      band.onmousedown = function (e) { e.stopPropagation(); };
      band.onclick = (function (next) {
        return function (e) {
          e.stopPropagation();
          if (typeof window.selectClipOnly === 'function') window.selectClipOnly(next);
          if (typeof window.refreshSelection === 'function') window.refreshSelection();
          var inp = document.getElementById('wbCtxWait'); if (inp) { inp.focus(); if (inp.select) inp.select(); }
        };
      })(cur);
      body.appendChild(band);
    }
  }

  // ---------- 舞台面板：3D/俯视标签、布局占比、只读俯视预览 ----------
  function setLayout(l) {
    S.layout = (l === 'stage' || l === 'balance') ? l : 'timeline';
    lsSet('choreo_wb_layout', S.layout); applyLayout();
  }
  function applyLayout() {
    var frame = document.getElementById('editorFrame'); if (!frame) return;
    frame.classList.remove('wb-layout-timeline', 'wb-layout-balance', 'wb-layout-stage');
    frame.classList.add('wb-layout-' + S.layout);
    Array.prototype.forEach.call(document.querySelectorAll('[data-wb-layout]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-wb-layout') === S.layout);
    });
    if (S.tab === 'top') drawTop();
  }
  function setTab(t) {
    if (t !== 'top' && window.ChoreoStageUI && ChoreoStageUI.startPosActive && ChoreoStageUI.startPosActive()) ChoreoStageUI.cancelStartPosition();
    S.tab = (t === 'top') ? 'top' : '3d'; syncStage();
  }
  function syncStage() {
    syncHistorySelection();
    var dock = document.getElementById('previewDock'); if (!dock) return;
    dock.classList.toggle('wb-top', S.tab === 'top');
    var t3 = document.getElementById('wbTab3d'), tt = document.getElementById('wbTabTop');
    if (t3) { t3.classList.toggle('on', S.tab === '3d'); t3.setAttribute('aria-selected', S.tab === '3d' ? 'true' : 'false'); }
    if (tt) { tt.classList.toggle('on', S.tab === 'top'); tt.setAttribute('aria-selected', S.tab === 'top' ? 'true' : 'false'); }
    var host = document.getElementById('wbTopHost');
    if (host) {
      var wasHidden = host.hidden;
      host.hidden = (S.tab !== 'top');
      // B6：开窗（俯视图重新显示）时重算一次；手动态保持用户视图（仅「重新拟合」退出）
      if (S.tab === 'top' && wasHidden && _topMode !== 'manual') _topForce = true;
    }
    var p3d = document.getElementById('p3dPanel');
    var open = !!(p3d && p3d.classList.contains('open'));
    var empty = document.getElementById('wb3dEmpty'); if (empty) empty.style.display = (S.tab === '3d' && !open) ? '' : 'none';
    if (S.tab === 'top') drawTop();
  }
  // 历史快照由 app 唯一维护；这里只观察同一历史栈的游标移动，恢复舞者/类型提示，不新增历史数据。
  var historyView=null,historyFocus=[];
  function syncHistorySelection(){
    var s=store();if(!s||!s.history)return;
    var old=historyView,cur=s.history[s.historyIdx];
    if(old&&old.project===s.projectId&&old.history===s.history&&old.index!==s.historyIdx&&old.dancers!==s.dancers&&cur){
      var before=old.snapshot;historyFocus=[];
      function add(di,kind){if(di<0||!s.dancers[di])return;if(!historyFocus.some(function(v){return v.di===di&&v.kind===kind}))historyFocus.push({di:di,kind:kind})}
      ['actionClips','switchClips','lyricClips'].forEach(function(k,ki){
        (s.dancers||[]).forEach(function(d,di){if(JSON.stringify((before.dancers[di]||{})[k])!==JSON.stringify((cur.dancers[di]||{})[k]))add(di,['动作','切换','台词'][ki])});
      });
      ['abilityTracks','stageTracks'].forEach(function(k){
        var a=before[k]||[],b=cur[k]||[];
        a.concat(b).forEach(function(t){
          var left=a.filter(function(v){return v.performerId===t.performerId&&v.type===t.type}),right=b.filter(function(v){return v.performerId===t.performerId&&v.type===t.type});
          if(JSON.stringify(left)===JSON.stringify(right))return;
          for(var di=0;di<s.dancers.length;di++)if(window.ChoreoStageMotion&&ChoreoStageMotion.pid(s,di)===t.performerId)add(di,t.type==='movement'?'走位':t.type==='facing'?'独立朝向':'技能');
        });
      });
      if(historyFocus.length)s.selectedDancer=historyFocus[0].di;
    }else if(!old||old.project!==s.projectId||old.history!==s.history||old.dancers!==s.dancers){historyFocus=[]}
    historyView={project:s.projectId,history:s.history,index:s.historyIdx,dancers:s.dancers,snapshot:cur};
    var host=document.getElementById('wbCtxHost'),badge=document.getElementById('wbHistorySelection');
    if(!historyFocus.length){if(badge)badge.remove();return}
    if(host){if(!badge){badge=el('div','wb-ctx-field');badge.id='wbHistorySelection';badge.setAttribute('role','status');badge.style.cssText='border:2px solid #ffd091;padding:4px 8px;color:#ffd091';host.appendChild(badge)}badge.textContent='撤销 / 重做 · '+historyFocus.map(function(v){return s.dancers[v.di].name+' · '+v.kind}).join('；')}
  }
  function initStage() {
    var dock = document.getElementById('previewDock'); if (!dock) return;
    // B6：时间轴滚窗→俯视图跟随重算（捕获型监听挂在 document 上，#timelineWrap 整树重建也不丢）
    if (!topTimelineScroll.__wired && document.addEventListener) {
      topTimelineScroll.__wired = true;
      try { document.addEventListener('scroll', topTimelineScroll, true); } catch (e) {}
    }
    if (!document.getElementById('wbStageHead')) {
      var head = el('div', 'wb-stage-head'); head.id = 'wbStageHead';
      head.appendChild(el('span', 'wb-stage-title', '舞台'));
      var seg = el('div', 'wb-layout'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '布局占比');
      [['timeline', '时间轴为主'], ['balance', '均衡'], ['stage', '舞台为主']].forEach(function (p) {
        var b = el('button', 'btn small', p[1]); b.type = 'button'; b.setAttribute('data-wb-layout', p[0]);
        b.onclick = function () { setLayout(p[0]); }; seg.appendChild(b);
      });
      head.appendChild(seg); dock.appendChild(head);
      var tabs = el('div', 'wb-stage-tabs'); tabs.setAttribute('role', 'tablist');
      var t3 = el('button', 'btn small on', '3D 预览'); t3.type = 'button'; t3.id = 'wbTab3d'; t3.setAttribute('role', 'tab');
      t3.onclick = function () { setTab('3d'); };
      var tt = el('button', 'btn small', '俯视图'); tt.type = 'button'; tt.id = 'wbTabTop'; tt.setAttribute('role', 'tab');
      tt.onclick = function () { setTab('top'); };
      tabs.appendChild(t3); tabs.appendChild(tt); dock.appendChild(tabs);
      var host = el('div', 'wb-top-host'); host.id = 'wbTopHost'; host.hidden = true;
      var cv = document.createElement('canvas'); cv.id = 'wbTopView'; cv.className = 'wb-top-view';
      cv.setAttribute('aria-label', '俯视图：舞者站位与走位');
      cv.onclick = topClick;
      // P3：起始位置会话期支持按住拖动（“俯视拖点”）；B4：走位会话节点手柄直拖（见 topMouseDown）；
      // B6：滚轮＝缩放（进入手动态，光标下世界点不动）
      cv.onmousedown = topMouseDown;
      cv.onwheel = function (ev) { topWheel(ev); };
      host.appendChild(cv);
      host.appendChild(el('div', 'wb-top-hint', '点舞者可切换当前舞者；站位与走位仅用于网页预览'));
      dock.appendChild(host);
      var empty = el('div', 'wb-3d-empty'); empty.id = 'wb3dEmpty';
      empty.appendChild(el('span', '', '3D 预览未打开'));
      var bOpen = el('button', 'btn small', '打开 3D 预览'); bOpen.type = 'button'; bOpen.id = 'wbOpen3d';
      bOpen.onclick = function () { if (window.__togglePreview3D) window.__togglePreview3D(); syncStage(); };
      empty.appendChild(bOpen); dock.appendChild(empty);
    }
    // 工具栏/命令面板切 3D 面板后同步占位；p3dPanel 的开关类变化也要反映到标签页。
    if (window.__togglePreview3D && !window.__togglePreview3D.__wbWrapped) {
      var orig = window.__togglePreview3D;
      window.__togglePreview3D = function () { var r = orig.apply(this, arguments); syncStage(); return r; };
      window.__togglePreview3D.__wbWrapped = true;
    }
    var p3d = document.getElementById('p3dPanel');
    if (p3d && typeof MutationObserver === 'function' && !p3d.__wbObserved) {
      p3d.__wbObserved = true;
      new MutationObserver(function () { syncStage(); }).observe(p3d, { attributes: true, attributeFilter: ['class'] });
    }
    applyLayout(); syncStage();
  }
  function dancerBase(di) {
    var s = store();
    if (window.ChoreoEdit && ChoreoEdit.pure && ChoreoEdit.pure.placementFor) {
      var p = ChoreoEdit.pure.placementFor(s.dancers, di); if (p) return p;
    }
    var d = (s && s.dancers[di]) || {};
    return { x: 0, z: 0, yawDeg: 0 };
  }
  function dancerPos(di, t) {
    var base = dancerBase(di);
    if (window.ChoreoStageMotion && ChoreoStageMotion.sample) {
      try { var p = ChoreoStageMotion.sample(store(), di, Math.max(0, t || 0) * 1000, base); return { x: p.x, z: p.z, yawDeg: p.yawDeg }; } catch (e) {}
    }
    return base;
  }
  function selectedClipDancer() {
    var s = store(), c = s && s.selectedClip; if (!c) return -1;
    for (var di = 0; di < s.dancers.length; di++) {
      var d = s.dancers[di];
      if ((d.actionClips || []).indexOf(c) >= 0 || (d.switchClips || []).indexOf(c) >= 0 || (d.lyricClips || []).indexOf(c) >= 0) return di;
    }
    return -1;
  }
  // ---------- B6 视图约定与拟合（R2 §七＋R4 §七真实口径） ----------
  // 可见时间窗 [wA,wB]：与 ChoreoRenderPerf.visibleRange 同口径（[(scrollLeft-labelW)/pps, …]），
  // labelW 与产品 LABEL_W 常量一致（普通 112 / 窄 64）；无时间轴容器时回退全时段。
  function topLabelWidth() {
    try { return (document.body && document.body.classList && document.body.classList.contains && document.body.classList.contains('narrow')) ? 64 : 112; } catch (e) { return 112; }
  }
  function topWindow() {
    var s = store();
    var pps = (s && Number(s.pps) > 0) ? Number(s.pps) : 60;
    var wrap = null;
    try { wrap = document.getElementById('timelineWrap'); } catch (e) {}
    if (wrap && Number(wrap.clientWidth) > 0) {
      var lw = topLabelWidth(), sl = Number(wrap.scrollLeft) || 0;
      var a = (sl - lw) / pps, b = (sl + Number(wrap.clientWidth) - lw) / pps;
      if (!isFinite(a) || a < 0) a = 0;
      if (!isFinite(b) || b < a) b = a;
      return { a: a, b: b };
    }
    return { a: 0, b: Math.max(Number(s && s.totalDuration) || 0, 30) };
  }
  // 会话（起始位置/同处走位/就地走位编辑）稳态不重拟合；开/闭沿各重算一次
  function topSessionActive() {
    if (window.ChoreoStageUI && ChoreoStageUI.startPosActive && ChoreoStageUI.startPosActive()) return true;
    var m = window.ChoreoStageMotionUI;
    if (m && m.samePlaceActive && m.samePlaceActive()) return true;
    if (m && m.sessionState && m.sessionState()) return true;
    return false;
  }
  // 拟合集合：全员真实起始位（placementFor：显式起点或索引等距）＋当前舞者窗内走位节点＋
  // 窗口两端必采样 P(wA)/P(wB)（经产品 M.sample 绑定当前舞者 di 与起点；末点后＝保持值、
  // 空路径＝起始位）＋已选对象所属舞者在播放头的采样位（各绑各的 di/起点，N21/N22 口径）。
  // 窗外节点不参与；适应全部＝全员全时段（原口径）；不钳制、不改 authored 坐标。
  function topFitPoints() {
    var s = store(), i, pts = [];
    for (i = 0; i < s.dancers.length; i++) pts.push(dancerBase(i));
    if (_topMode === 'all') {
      if (window.ChoreoStageMotion && ChoreoStageMotion.extentPoints) {
        for (i = 0; i < s.dancers.length; i++) {
          try { pts = pts.concat(ChoreoStageMotion.extentPoints(s, i, dancerBase(i))); } catch (e) {}
        }
      }
      return pts;
    }
    var cur = (s.selectedDancer >= 0 && s.selectedDancer < s.dancers.length) ? s.selectedDancer : 0;
    var win = topWindow();
    if (window.ChoreoStageMotion && ChoreoStageMotion.nodes) {
      try {
        ChoreoStageMotion.nodes(s, cur).movement.forEach(function (n) {
          var t = Number(n.time);
          if (t >= win.a && t <= win.b) pts.push({ x: Number(n.x), z: Number(n.z) });
        });
      } catch (e) {}
    }
    pts.push(dancerPos(cur, win.a));
    pts.push(dancerPos(cur, win.b));
    var selDi = selectedClipDancer();
    if (selDi >= 0) pts.push(dancerPos(selDi, s.currentTime || 0));
    return pts;
  }
  // 视图态行：当前态可见＋「适应全部」「重新拟合」入口（适应全部＝切全员全时段；
  // 重新拟合＝退出手动回到跟随窗口）。drawTop 内惰性建栏，任意宿主构建顺序都成立。
  function syncTopViewBar() {
    var host = document.getElementById('wbTopHost'); if (!host) return;
    var bar = document.getElementById('wbTopViewBar');
    if (!bar) {
      bar = el('div', 'wb-top-viewbar'); bar.id = 'wbTopViewBar';
      // B8：布局样式收编 .wb-top-viewbar 设计令牌类（choreo-helper-app.css，逐字等价；闭 B6 批外登记）
      var st = el('span', ''); st.id = 'wbTopViewState'; st.setAttribute('role', 'status'); bar.appendChild(st);
      var fa = el('button', 'btn small', '适应全部'); fa.type = 'button'; fa.id = 'wbTopFitAll';
      fa.title = '把全体舞者全时段的所有走位都纳入视野';
      fa.onclick = function () { topFitAll(); }; bar.appendChild(fa);
      var rf = el('button', 'btn small', '重新拟合'); rf.type = 'button'; rf.id = 'wbTopRefit';
      rf.title = '退出手动缩放/平移，回到跟随当前时间窗的默认视野';
      rf.onclick = function () { topRefit(); }; bar.appendChild(rf);
      var kids = host.children || [], hint = null;
      for (var k = 0; k < kids.length; k++) if (kids[k].className === 'wb-top-hint') { hint = kids[k]; break; }
      host.insertBefore(bar, hint);
    }
    var st2 = document.getElementById('wbTopViewState');
    var name = _topMode === 'window' ? '跟随窗口' : (_topMode === 'all' ? '适应全部' : '手动');
    var tx = '视图：' + name;
    if (_topMode === 'window') { try { var win = topWindow(); tx += '（' + (Math.round(win.a * 10) / 10).toFixed(1) + '–' + (Math.round(win.b * 10) / 10).toFixed(1) + 's）'; } catch (e) {} }
    if (st2 && st2.textContent !== tx) st2.textContent = tx;
    var fa2 = document.getElementById('wbTopFitAll'), rf2 = document.getElementById('wbTopRefit');
    if (fa2 && fa2.classList && fa2.classList.toggle) fa2.classList.toggle('on', _topMode === 'all');
    if (rf2 && rf2.classList && rf2.classList.toggle) rf2.classList.toggle('on', _topMode === 'manual');
  }
  function topFitAll() { _topMode = 'all'; _topForce = true; syncTopViewBar(); drawTop(); }
  function topRefit() { _topMode = 'window'; _topForce = true; syncTopViewBar(); drawTop(); }
  // 手动态滚轮缩放：光标下的世界点保持在原屏幕位（进入手动态）
  function topWheel(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!(_topView.sc > 0) || !(_topView.w > 0)) return;
    var f = (e && e.deltaY < 0) ? 1.15 : 1 / 1.15;
    var ns = Math.min(5000, Math.max(0.02, _topView.sc * f));
    var wpt = topWorldAt(e), panX, panZ;
    if (wpt && isFinite(wpt.fx)) {
      panX = wpt.fx * _topView.w - _topView.w / 2 - wpt.x * ns;
      panZ = wpt.fy * _topView.h - _topView.h / 2 - wpt.z * ns;
    } else {
      panX = (_topView.panX || 0) * (ns / _topView.sc);
      panZ = (_topView.panZ || 0) * (ns / _topView.sc);
    }
    _topMode = 'manual';
    _topView.sc = ns; _topView.panX = panX; _topView.panZ = panZ;
    syncTopViewBar(); drawTop();
  }
  // 手动态平移（屏幕像素增量；由空白拖动手势或测试驱动）
  function topPanBy(dx, dy) {
    if (!isFinite(dx) || !isFinite(dy)) return;
    _topMode = 'manual';
    _topView.panX = (_topView.panX || 0) + dx;
    _topView.panZ = (_topView.panZ || 0) + dy;
    syncTopViewBar(); drawTop();
  }
  function drawTop() {
    var cv = document.getElementById('wbTopView'), host = document.getElementById('wbTopHost');
    if (!cv || !host || host.hidden) return;
    var s = store(); if (!s) return;
    // B4：拖动期间冻结变换——画布尺寸与 sc/maxAbs 都沿用冻结值，指针映射（topWorldAt）与绘制同源。
    var frozen = _topFrozen && _topView.sc > 0;
    var w = frozen ? _topView.w : (host.clientWidth || 0), h = frozen ? _topView.h : (host.clientHeight || 0);
    if (w < 24 || h < 24) return;
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, w, h);
    var sc, maxAbs, i;
    if (!frozen) {
      // B6：跟随窗口/适应全部在无会话稳态下随绘制重算（滚窗/切对象/内容变化自然触发）；
      // 会话稳态不重拟合（开闭沿各重算一次）；手动/拖动冻结保持现值。
      var sess = topSessionActive();
      // 手动态保持用户视图（开窗沿/解冻/滚窗都不冲掉平移缩放，仅「重新拟合/适应全部」按钮退出）；
      // 会话开闭沿各重算一次（开窗），会话稳态冻结，无会话时跟随窗口/适应全部随绘制重算。
      var refit = _topForce || _topView.w < 24 || (_topMode !== 'manual' && (sess !== _topInSession || !sess));
      _topInSession = sess;
      if (refit) {
        var pts = topFitPoints();
        maxAbs = 1;
        pts.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.z)); });
        sc = Math.min(w, h) / (2 * (maxAbs + 1.5));
        _topView = { sc: sc, w: w, h: h, maxAbs: maxAbs, panX: 0, panZ: 0 };
        _topForce = false;
      } else { sc = _topView.sc; maxAbs = _topView.maxAbs; _topView.w = w; _topView.h = h; }
    } else { sc = _topView.sc; maxAbs = _topView.maxAbs; }
    var ox = w / 2 + (_topView.panX || 0), oz = h / 2 + (_topView.panZ || 0);
    g.strokeStyle = '#233446'; g.lineWidth = 1;
    for (var m = -Math.ceil(maxAbs + 1); m <= maxAbs + 1; m += 2) {
      g.beginPath(); g.moveTo(ox + m * sc, 0); g.lineTo(ox + m * sc, h); g.stroke();
      g.beginPath(); g.moveTo(0, oz + m * sc); g.lineTo(w, oz + m * sc); g.stroke();
    }
    g.strokeStyle = '#3a5773'; g.strokeRect(ox - 10 * sc, oz - 10 * sc, 20 * sc, 20 * sc);
    var cur = (s.selectedDancer >= 0 && s.selectedDancer < s.dancers.length) ? s.selectedDancer : 0;
    var selDi = selectedClipDancer();
    var motionDraft = window.ChoreoStageMotionUI && ChoreoStageMotionUI.sessionState ? ChoreoStageMotionUI.sessionState() : null;
    for (i = 0; i < s.dancers.length; i++) {
      var d = s.dancers[i], base2 = dancerBase(i), pos = dancerPos(i, s.currentTime || 0);
      g.strokeStyle = (d.color || '#8ab4f8') + '88'; g.lineWidth = 1.5;
      if (!(motionDraft && motionDraft.kind === 'motion' && motionDraft.di === i) && window.ChoreoStageMotion && ChoreoStageMotion.extentPoints) {
        var ext = []; try { ext = ChoreoStageMotion.extentPoints(s, i, base2); } catch (e) { ext = []; }
        if (ext.length) {
          g.beginPath(); g.moveTo(ox + base2.x * sc, oz + base2.z * sc);
          ext.forEach(function (p) { g.lineTo(ox + p.x * sc, oz + p.z * sc); });
          g.stroke();
        }
      }
      var X = ox + pos.x * sc, Y = oz + pos.z * sc;
      g.beginPath(); g.arc(X, Y, i === cur ? 9 : 7, 0, Math.PI * 2); g.fillStyle = d.color || '#8ab4f8'; g.fill();
      if (i === cur) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(X, Y, 12, 0, Math.PI * 2); g.stroke(); }
      if (i === selDi) {
        g.strokeStyle = '#8ab4f8'; g.setLineDash([4, 3]);
        g.beginPath(); g.arc(X, Y, 16, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      g.fillStyle = '#c9d7e2'; g.font = '12px sans-serif'; g.fillText(d.name || ('舞者' + (i + 1)), X + 12, Y + 4);
    }
    // P1-C：同处走位会话叠加（出发点/目的地/虚线），由会话方绘制
    if (window.ChoreoStageMotionUI && ChoreoStageMotionUI.drawSamePlace) {
      try { ChoreoStageMotionUI.drawSamePlace(g, function (px, pz) { return { sx: ox + px * sc, sy: oz + pz * sc }; }); } catch (err) {}
    }
    // P3：选中的走位线高亮（含节点序号/时刻），随后是起始位置会话草稿
    if (window.ChoreoStageMotionUI && ChoreoStageMotionUI.drawSelected) {
      try { ChoreoStageMotionUI.drawSelected(g, function (px, pz) { return { sx: ox + px * sc, sy: oz + pz * sc }; }); } catch (err) {}
    }
    if (window.ChoreoStageUI && ChoreoStageUI.drawStartPosition) {
      try { ChoreoStageUI.drawStartPosition(g, function (px, pz) { return { sx: ox + px * sc, sy: oz + pz * sc }; }); } catch (err) {}
    }
    // HF-09 方向常驻标注（B6）：+X 屏幕右、+Z 屏幕下方＝观众侧（与 3D 预览默认机位一致）；
    // 两面（舞台后方/观众席）常驻，任何视图态/会话/拖动都画；只画标注，永不改持久化坐标。
    g.fillStyle = '#9fc1e0'; g.font = '11px sans-serif'; g.textAlign = 'center';
    g.fillText('舞台后方', w / 2, 12);
    g.fillText('观众席', w / 2, h - 6);
    g.textAlign = 'left';
    syncTopViewBar();
  }
  function tickTop() { if (S.tab !== 'top') return; var host = document.getElementById('wbTopHost'); if (!host || host.hidden) return; drawTop(); }
  // B6：时间轴滚窗触发俯视重算（跟随窗口态）
  function topTimelineScroll(e) {
    if (S.tab !== 'top') return;
    var t = e && e.target;
    if (t && t.id === 'timelineWrap') drawTop();
  }
  // B4：节点拖动期冻结/解冻画布变换（解冻后立即按当前内容重拟合一次；B6：手动态保持用户视图不强制重算）
  function freezeTopTransform() { if (_topView.sc > 0) _topFrozen = true; }
  function unfreezeTopTransform() { if (!_topFrozen) return; _topFrozen = false; if (_topMode !== 'manual') _topForce = true; drawTop(); }
  // 俯视按下接线：①起始站位会话拖点（P3，最高优先）→②同处走位点选让位（topClick 处理，R1 §2 ①）
  // →③走位会话节点手柄直拖（B4：命中即选中并启动草稿拖动；播放中/草稿非法时提示并拒绝）
  // →④空白按住拖动＝平移视图（B6：进入手动态；位移≥4px 才平移并吞掉随后的 click，小位移仍走点选）。
  function topMouseDown(e) {
    if (e.button !== 0) return;
    _nodeGesture = false;
    if (window.ChoreoStageUI && ChoreoStageUI.startPosActive && ChoreoStageUI.startPosActive()) {
      e.preventDefault();
      var move = function (ev) { var w = topWorldAt(ev); if (w) ChoreoStageUI.pickStartPos(w.x, w.z); };
      var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      var w0 = topWorldAt(e); if (w0) ChoreoStageUI.pickStartPos(w0.x, w0.z);
      return;
    }
    var motion = window.ChoreoStageMotionUI;
    if (motion && motion.samePlaceActive && motion.samePlaceActive()) return; // 同处走位会话：点击＝点目的地，不平移
    var hit = topWorldAt(e); if (!hit) return;
    if (motion && motion.nodeAt && _topView.sc) {
      var idx = motion.nodeAt(hit.x, hit.z, 8 / _topView.sc);
      if (idx >= 0) {
        var st = motion.dragNodeStart(idx); // 选中先行（点按＝选中并出行内微调行）；拒绝态已提示
        if (!st) return;
        _nodeGesture = true; // 选中/拖动已处理：吞掉紧随的 click（topClick），不重复选点
        if (!st.ok) return;
        e.preventDefault();
        freezeTopTransform();
        var dragMove = function (ev) { var w = topWorldAt(ev); if (w) motion.dragNodeMove(w.x, w.z); };
        var dragUp = function () {
          document.removeEventListener('mousemove', dragMove); document.removeEventListener('mouseup', dragUp);
          motion.dragNodeEnd();
          unfreezeTopTransform();
        };
        document.addEventListener('mousemove', dragMove); document.addEventListener('mouseup', dragUp);
        return;
      }
    }
    // B6：空白拖动＝平移（进入手动态）；阈值内小位移不平移、click 照常选点
    e.preventDefault();
    var px0 = e.clientX, py0 = e.clientY, panned = false;
    var panMove = function (ev) {
      if (!panned) { if (Math.hypot(ev.clientX - px0, ev.clientY - py0) < 4) return; panned = true; _nodeGesture = true; }
      topPanBy(ev.clientX - px0, ev.clientY - py0);
      px0 = ev.clientX; py0 = ev.clientY;
    };
    var panUp = function () {
      document.removeEventListener('mousemove', panMove); document.removeEventListener('mouseup', panUp);
    };
    document.addEventListener('mousemove', panMove); document.addEventListener('mouseup', panUp);
  }
  function topWorldAt(e) {
    var s = store(); if (!s || !_topView.sc) return null;
    var cv = document.getElementById('wbTopView'); if (!cv) return null;
    var r = cv.getBoundingClientRect();
    // 画布有边框：点击按内容盒映射（扣除边框宽），否则边缘落点带 ~1px 系统偏差
    // （首条旅程 J5 复核发现：画布变矮后该偏差被放大到 0.01 米级，超出量化容差）
    var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(cv) : null;
    var bw = function (k) { return cs ? (parseFloat(cs[k]) || 0) : 0; };
    var iw = r.width - bw('borderLeftWidth') - bw('borderRightWidth');
    var ih = r.height - bw('borderTopWidth') - bw('borderBottomWidth');
    // 画布属性尺寸（整数）与 CSS 盒（可为小数）不严格相等：按比例映射，避免点击坐标整体偏移
    var fx = (e.clientX - (r.left + bw('borderLeftWidth'))) / (iw || 1), fy = (e.clientY - (r.top + bw('borderTopWidth'))) / (ih || 1);
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    // B6：映射含平移量（手动态/拖动冻结共用同一变换）
    return {
      x: (fx * _topView.w - (_topView.w / 2 + (_topView.panX || 0))) / _topView.sc,
      z: (fy * _topView.h - (_topView.h / 2 + (_topView.panZ || 0))) / _topView.sc,
      fx: fx, fy: fy
    };
  }
  function topClick(e) {
    if (_nodeGesture) { _nodeGesture = false; return; } // B4：节点手势（选中/拖动）已处理，吞掉紧随的 click
    var w = topWorldAt(e); if (!w) return;
    var x = w.x, z = w.z;
    // P3：起始位置会话期，俯视点击=放起点（最高优先；拖拽见 initStage 的 mousedown 接线）
    if (window.ChoreoStageUI && ChoreoStageUI.startPosActive && ChoreoStageUI.startPosActive()) {
      try { ChoreoStageUI.pickStartPos(x, z); } catch (err) {}
      return;
    }
    // P1-C：同处走位会话期，俯视点击=点目的地（不再是选人；时间轴上下文保持不变）
    if (window.ChoreoStageMotionUI && ChoreoStageMotionUI.samePlaceActive && ChoreoStageMotionUI.samePlaceActive()) {
      try { ChoreoStageMotionUI.pickSamePlace(x, z); } catch (err) {}
      return;
    }
    // B2：会话节点 > 舞者标记 > 路径线；每层先当前舞者，再在同点命中集合循环。
    var s = store(); if (!s) return;
    var tol = _topView.sc > 0 ? 12 / _topView.sc : 0;
    var motion = window.ChoreoStageMotionUI;
    if (tol > 0 && motion && motion.pickTopNode && motion.pickTopNode(x,z,6/_topView.sc)) return;
    var hits = [];
    for (var i = 0; i < s.dancers.length; i++) {
      var p = dancerPos(i, s.currentTime || 0), d = Math.hypot(p.x - x, p.z - z);
      if (d < tol) hits.push(i);
    }
    var best = motion && motion.cycleHit ? motion.cycleHit('marker',x,z,tol,hits) : hits[0];
    if (best == null || best < 0) { if (tol > 0 && motion && motion.pickTopPath) motion.pickTopPath(x,z,tol); return; }
    s.selectedDancer = best;
    // O-1：同点多命中给可见反馈（命中数＋当前舞者＋再点切换）；单命中不打扰；
    // 循环顺序/容差/会话优先链不变（toast 是应用侧全局，无头环境缺省跳过）。
    if (hits.length > 1 && typeof window.showToast === 'function')
      window.showToast('同点 ' + hits.length + ' 位舞者，当前：' + ((s.dancers[best] && s.dancers[best].name) || ('舞者' + (best + 1))) + '（再点切换）');
    if (typeof window.render === 'function') window.render(); else drawTop();
  }

  // 原生 modal 位于 top layer；提升 z-index 无效。移动同一个停止条，保留事件与状态。
  var safetyDialogs = [], safetyBar = null, safetyHome = null, safetyObserver = null;
  function showSafetyDialog(box) {
    if (!safetyBar) safetyBar = document.querySelector('.immediate-stop-bar');
    if (!safetyBar) { box.showModal(); return; }
    if (!safetyHome) {
      safetyHome = document.createComment('immediate-stop-home');
      safetyBar.parentNode.insertBefore(safetyHome, safetyBar);
    }
    function restore() {
      safetyDialogs = safetyDialogs.filter(function (d) { return d.isConnected && d.open; });
      var top = safetyDialogs[safetyDialogs.length - 1];
      var parent = top || safetyHome.parentNode;
      if (parent && safetyBar.parentNode !== parent) {
        if (top) top.appendChild(safetyBar); else parent.insertBefore(safetyBar, safetyHome.nextSibling);
      }
      if (!top && safetyObserver) { safetyObserver.disconnect(); safetyObserver = null; }
    }
    box.classList.add('wb-safe-dialog');
    box.showModal(); safetyDialogs.push(box); box.appendChild(safetyBar);
    box.addEventListener('close', restore, { once: true });
    if (!safetyObserver) {
      safetyObserver = new MutationObserver(restore);
      safetyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }
  }

  var api = {
    showSafetyDialog: showSafetyDialog,
    emptyState: emptyState, addBar: addBar, appendWaitBands: appendWaitBands, macroNotesArea: macroNotesArea,
    beginWorkbench: beginWorkbench, startFromMacro: startFromMacro, noteLoaded: noteLoaded,
    showEmpty: function () { return !S.started; }, started: function () { return S.started; },
    insertAt: function () { return S.insertAt; }, setInsertAt: setInsertAt, clearInsert: clearInsert, consumeInsert: consumeInsert,
    appendWait: function () { return S.appendWait; }, setAppendWait: setAppendWait, landingText: landingText,
    startRehearsal: startRehearsal, rehearsalActive: rehearsalActive, rehearsalRange: rehearsalRange,
    exitRehearsal: exitRehearsal, rehearsalStopped: rehearsalStopped,
    initStage: initStage, syncStage: syncStage, drawTop: drawTop, tickTop: tickTop, setTab: setTab,
    topViewTransform: function () { return { sc: _topView.sc, w: _topView.w, h: _topView.h, panX: _topView.panX || 0, panZ: _topView.panZ || 0 }; },
    topViewMode: function () { return _topMode; },
    topWindow: topWindow, topFitAll: topFitAll, topRefit: topRefit, topWheel: topWheel, topPanBy: topPanBy,
    setLayout: setLayout, layout: function () { return S.layout; }, state: S
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ChoreoWorkbench = api;
})();
