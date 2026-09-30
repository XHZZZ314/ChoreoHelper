/* choreo-stage-ui.js —— 起始站位编辑对话框（M2-START-FORMATION，DOM 适配层）
这个文件是干嘛的：
  给每位舞者编辑规范 start {x,z,yawDeg}（米制，M1 Y-up：前 +Z，侧 +X，上 +Y）。
  纯 DOM 经典脚本（无 fetch/IndexedDB/ESM，file:// 可用）：输入校验与写入走
  ChoreoEdit.pure（setDancerStart/clearDancerStart），落盘与撤销走 choreo-app.js 的
  saveHistory/persistProject/bumpTimelineRev；3D 放置由 preview3d.js 按同一纯口径渲染。
  常驻中文提示：起始站位只用于网页预览，当前游戏执行不用它（协议 v1 performers 仅 id/name）。
*/
(function () {
  'use strict';
  var NOTICE = '起始站位与朝向已保存，用于网页预览；当前游戏执行不使用（游戏内以骨骼动作为准，未做地图校准）。';
  var FIELD_HINT = 'X/Z 为米（左右/前后），朝向 0° 朝前（+Z），90° 朝右（+X）。留空/非数字/无穷大不可保存。';

  function store() { return (typeof window !== 'undefined' && window.store) || null; }
  function edit() { return (typeof window !== 'undefined' && window.ChoreoEdit && window.ChoreoEdit.pure) || null; }
  function isPlaying() { var s = store(), m = window.ChoreoMusicUI && window.ChoreoMusicUI.webState(); return !!((s && s.isPlaying) || (m && m.playing && !m.paused)); }

  var bg_dlg_invoker = null;
  function noticeText() { return NOTICE; }

  // 缺舞者/越界：零写入零抛错（AC-2），调用方 toast 提示即可。
  function openStartDialog(di) {
    var s = store(), CE = edit();
    if (!s || !CE) return false;
    var d = (s.dancers || [])[di];
    if (!d || typeof d !== 'object') {
      if (typeof window.showToast === 'function') window.showToast('这位舞者已不存在，未做任何修改');
      return false;
    }
    closeStartDialog();
    try { bg_dlg_invoker = document.activeElement || null; } catch (e0) {}
    var playing = isPlaying();
    var originalProject = s.projectId, originalDancers = s.dancers, originalStart = JSON.stringify(d.start);
    function currentTarget() {
      if (store() !== s || s.projectId !== originalProject || s.dancers !== originalDancers || s.dancers[di] !== d || JSON.stringify(d.start) !== originalStart) { showErr('项目、舞者或站位已变化，请关闭后重新编辑'); return false; }
      return !isPlaying();
    }
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = 'startFormationModal';
    var box = document.createElement('div');
    box.className = 'modal start-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', d.name + '起始站位');
    var h = document.createElement('h3');
    h.textContent = d.name + ' · 起始站位';
    box.appendChild(h);
    // TASK-20260918-PLAYER-UX-SIMPLIFY A2：两段固定说明默认折叠（text 检查走 textContent 不受折叠影响）。
    var note = document.createElement('details');
    note.className = 'start-notes';
    var noteSum = document.createElement('summary');
    noteSum.textContent = '字段说明 ▸';
    noteSum.style.cursor = 'pointer';
    note.appendChild(noteSum);
    var noteDiv = document.createElement('div');
    noteDiv.className = 'start-notice';
    noteDiv.textContent = NOTICE;
    note.appendChild(noteDiv);
    var hint = document.createElement('div');
    hint.className = 'start-hint';
    hint.textContent = FIELD_HINT;
    note.appendChild(hint);
    box.appendChild(note);
    function row(labelText, key, val) {
      var wrap = document.createElement('label');
      wrap.className = 'start-row';
      var sp = document.createElement('span');
      sp.textContent = labelText;
      wrap.appendChild(sp);
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.dataset.field = key;
      inp.value = (val === undefined || val === null) ? '' : String(val);
      inp.disabled = playing;
      if (playing) inp.setAttribute('aria-disabled', 'true');
      wrap.appendChild(inp);
      box.appendChild(wrap);
      return inp;
    }
    var cur = (d.start && typeof d.start === 'object') ? d.start : null;
    var ix = row('X（米，右 +）', 'x', cur ? cur.x : '');
    var iz = row('Z（米，前 +）', 'z', cur ? cur.z : '');
    var iy = row('朝向（度，0 朝前 +Z）', 'yawDeg', cur ? cur.yawDeg : '');
    var err = document.createElement('div');
    err.className = 'start-err';
    err.style.display = 'none';
    box.appendChild(err);
    function showErr(t) { err.textContent = t; err.style.display = ''; }
    function hideErr() { err.textContent = ''; err.style.display = 'none'; }
    var acts = document.createElement('div');
    acts.className = 'modal-act';
    function mkBtn(txt, title, fn, primary) {
      var b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.textContent = txt;
      b.title = title;
      b.disabled = playing;
      if (playing) b.setAttribute('aria-disabled', 'true');
      b.onclick = function () {
        if (isPlaying()) return; // 播放中点击 no-op（AC-2，双目标一致禁用）
        fn();
      };
      acts.appendChild(b);
      return b;
    }
    function doApply() {
      hideErr();
      if (!currentTarget()) return;
      var r = CE.setDancerStart(s.dancers, di, ix.value, iz.value, iy.value);
      if (!r || !r.ok) {
        showErr('输入无效，未保存：请填写有限数字（空/非数字/无穷大不可用）。');
        return;
      }
      if (!r.changed) { closeStartDialog(); return; } // 同值零写入零历史
      if (typeof window.saveHistory === 'function') window.saveHistory();
      if (typeof window.render === 'function') window.render();
      if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (e) {} }
      closeStartDialog();
      if (typeof window.showToast === 'function') window.showToast('已保存' + d.name + '起始站位（网页预览用）');
    }
    function doClear() {
      hideErr();
      if (!currentTarget()) return;
      var r = CE.clearDancerStart(s.dancers, di);
      if (!r || !r.ok) { closeStartDialog(); return; }
      if (!r.changed) { closeStartDialog(); return; }
      if (typeof window.saveHistory === 'function') window.saveHistory();
      if (typeof window.render === 'function') window.render();
      if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (e) {} }
      closeStartDialog();
      if (typeof window.showToast === 'function') window.showToast('已清除' + d.name + '起始站位（恢复自动排布）');
    }
    mkBtn('应用', '保存起始站位（Enter）', doApply, true);
    mkBtn('清除', '删除起始站位，恢复自动排布', doClear, false);
    var bCancel = mkBtn('取消', '不保存关闭（Esc）', function () { closeStartDialog(); }, false);
    box.appendChild(acts);
    bg.appendChild(box);
    document.body.appendChild(bg);
    // 键盘：Enter 应用，Escape 取消；Tab 天然在三个 input 与按钮间流转。
    bg._keyHandler = function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); if (!isPlaying()) doApply(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeStartDialog(); }
    };
    try { document.addEventListener('keydown', bg._keyHandler, true); } catch (e) {}
    try { window.addEventListener('keydown', bg._keyHandler, true); } catch (e2) {}
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeStartDialog(); });
    // 打开即聚焦第一输入（窄视口可用，焦点可达）。
    try { ix.focus(); ix.select(); } catch (e) {}
    // 供 offline-verify 的确定性钩子：最后一轮 Apply 获胜（快速连点即多次 doApply）。
    bg._apply = doApply;
    bg._clear = doClear;
    bg._cancel = function () { closeStartDialog(); };
    void bCancel;
    return true;
  }

  function closeStartDialog() {
    var bg = document.getElementById('startFormationModal');
    if (!bg) return;
    if (bg._keyHandler) {
      try { document.removeEventListener('keydown', bg._keyHandler, true); } catch (e) {}
      try { window.removeEventListener('keydown', bg._keyHandler, true); } catch (e2) {}
    }
    if (bg.parentNode) bg.parentNode.removeChild(bg);
    try {
      if (bg_dlg_invoker && document.contains(bg_dlg_invoker) && bg_dlg_invoker.focus) bg_dlg_invoker.focus();
    } catch (e3) {}
    bg_dlg_invoker = null;
  }

  // ---------- 2D 舞台拖拽（TASK-20260906-M2-STAGE-DRAG） ----------
  // 中文 2D 舞台：placementFor 唯一放置源；+X 屏右，+Z 屏上，单 scale；
  // 拖拽 ghost 本地，释放单事务提交（setDancerStart 一次 + saveHistory 一次）；
  // 存储坐标永不按视口钳制；手势期变换冻结，resize 取消。
  var STAGE_NOTICE = NOTICE + ' 协议 v1 游戏演出包省略起始站位（仅网页预览使用）。';
  var _stageInvoker = null;

  function stagePlacements() {
    var s = store(), CE = edit();
    if (!s || !CE) return [];
    var ds = s.dancers || [];
    var out = [];
    for (var i = 0; i < ds.length; i++) {
      try { out.push(CE.placementFor(ds, i)); } catch (e) { out.push(null); }
    }
    return out;
  }
  function stagePoints(placements) {
    return (placements || []).filter(function (p) {
      return !!p && typeof p.x === 'number' && isFinite(p.x) && typeof p.z === 'number' && isFinite(p.z);
    }).map(function (p) { return { x: p.x, z: p.z }; });
  }
  function stageSurfaceSize(surface) {
    try {
      var r = surface.getBoundingClientRect();
      var bl = surface.clientLeft || 0, bt = surface.clientTop || 0;
      return { w: surface.clientWidth || 0, h: surface.clientHeight || 0, rect: r, bl: bl, bt: bt };
    } catch (e) { return { w: 0, h: 0, rect: null, bl: 0, bt: 0 }; }
  }
  function setDisabled(nodes, disabled) {
    (nodes || []).forEach(function (n) {
      if (!n) return;
      try {
        n.disabled = !!disabled;
        if (disabled) n.setAttribute('aria-disabled', 'true');
        else n.removeAttribute('aria-disabled');
      } catch (e) {}
    });
  }
  function clearPending(bg, hideGhost) {
    if (!bg) return;
    bg._pending = null;
    if (hideGhost !== false) {
      try {
        var g = bg.querySelector('.stage-ghost');
        if (g) {
          g.style.display = 'none';
          try { g.removeAttribute('data-yaw'); } catch (e2) {}
          var ga = g.querySelector('.stage-ghost-arrow');
          if (ga) { try { ga.removeAttribute('data-yaw'); } catch (e3) {} }
        }
      } catch (e) {}
    }
  }
  function cancelPending(bg) {
    if (!bg || !bg._pending) return false;
    var wasPath = bg._pending.kind === 'pathnode';
    clearPending(bg, true);
    if (wasPath) { try { refreshStageMarkers(bg); } catch (e) {} } // C：路径节点取消时还原视觉
    return true;
  }
  function refreshStageMarkers(bg) {
    var s = store(), CE = edit();
    if (!bg || !s || !CE) return;
    var surface = bg.querySelector('#stageSurface');
    var scaleEl = bg.querySelector('.stage-scale');
    var emptyEl = bg.querySelector('.stage-empty');
    if (!surface) return;
    var size = stageSurfaceSize(surface);
    var placements = stagePlacements();
    var fitPts = stagePoints(placements);
    if (bg._pathMode) { var pdi = stageSelDi(bg); fitPts = fitPts.concat(stagePathPoints(pdi)); } // C：路径态视野纳入选中舞者路径
    var t = CE.computeStageTransform(size.w, size.h, fitPts);
    bg._transform = t || null;
    var invalid = (!s.dancers || !s.dancers.length || !t);
    if (emptyEl) {
      if (!s.dancers || !s.dancers.length) {
        emptyEl.textContent = '暂无舞者，舞台不可编辑（先添加舞者）。';
        emptyEl.style.display = '';
      } else if (!t) {
        emptyEl.textContent = '舞台尺寸无效，暂不可编辑（调整窗口后重试）。';
        emptyEl.style.display = '';
      } else { emptyEl.textContent = ''; emptyEl.style.display = 'none'; }
    }
    if (scaleEl) {
      if (t) {
        var pxm = Math.round(t.scale * 10) / 10;
        var pad2 = (CE && typeof CE.STAGE_PAD === 'number' && isFinite(CE.STAGE_PAD)) ? CE.STAGE_PAD : 24;
        var spanM = Math.round(((t.viewW - 2 * pad2) / t.scale) * 10) / 10;
        scaleEl.textContent = '比例 ' + pxm + ' 像素/米 · 横向可见约 ' + spanM + ' 米 · +X 向右 · +Z 向上 · 原点已标记';
      } else {
        scaleEl.textContent = '比例不可用';
      }
    }
    var layer = surface.querySelector('.stage-markers');
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    // 原点标记（世界 0,0）
    var org = surface.querySelector('.stage-origin');
    if (org && t) {
      var op = CE.stageWorldToScreen(0, 0, t);
      if (op) {
        org.style.display = '';
        org.style.left = (op.sx - 5) + 'px';
        org.style.top = (op.sy - 5) + 'px';
      } else org.style.display = 'none';
    } else if (org) org.style.display = 'none';
    var playing = isPlaying();
    var ctrls = [];
    for (var i = 0; i < (s.dancers || []).length; i++) {
      (function (di) {
        var d = s.dancers[di];
        var p = placements[di];
        if (!p) return;
        var sp = t ? CE.stageWorldToScreen(p.x, p.z, t) : null;
        var mk = document.createElement('button');
        mk.type = 'button';
        mk.className = 'stage-marker';
        mk.dataset.di = String(di);
        var nm = (d && typeof d.name === 'string') ? d.name : ('舞者' + (di + 1));
        mk.textContent = nm; // 文本节点：标记类名字符串按惰性文本渲染
        mk.setAttribute('aria-label', nm);
        mk.title = nm + '起始站位（拖拽移动 X/Z，拖旋转手柄改朝向，数字框也可编辑）';
        if (sp) { mk.style.left = (sp.sx - 14) + 'px'; mk.style.top = (sp.sy - 14) + 'px'; }
        var ar = document.createElement('span');
        ar.className = 'stage-arrow';
        ar.setAttribute('aria-hidden', 'true');
        var yaw = (typeof p.yawDeg === 'number' && isFinite(p.yawDeg)) ? p.yawDeg : 0;
        ar.style.transform = 'rotate(' + yaw + 'deg)';
        ar.dataset.yaw = String(yaw);
        mk.appendChild(ar);
        if (playing || !t) { mk.disabled = true; mk.setAttribute('aria-disabled', 'true'); }
        mk.addEventListener('pointerdown', function (e) { stagePointerDown(e, bg, di); });
        mk.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            stageSelect(bg, di, true);
          }
        });
        layer.appendChild(mk);
        ctrls.push(mk);
        // M2-STAGE-YAW：每标记一个旋转手柄（中文可访问名，命中目标与标记体分离）。
        // 卫星式：手柄中心 = 标记中心 + R*(sin yaw, -cos yaw)，静止角等于存储 yaw（缺失为 0）1 度内，
        // 与 facing 箭头 rotate(yaw) 同口径；tabIndex=-1 不抢 Tab，数字框仍是键盘替代。
        (function () {
          var yh = document.createElement('button');
          yh.type = 'button';
          yh.className = 'stage-yaw';
          yh.dataset.di = String(di);
          yh.textContent = '⟳';
          yh.setAttribute('aria-label', nm + '朝向旋转手柄（拖拽旋转朝向）');
          yh.title = nm + '朝向拖拽旋转（X/Z 不变）';
          yh.tabIndex = -1;
          yh.dataset.yaw = String(yaw);
          yh.style.transform = 'rotate(' + yaw + 'deg)';
          if (sp) {
            var rad = yaw * Math.PI / 180;
            var hx = sp.sx + 26 * Math.sin(rad), hy = sp.sy - 26 * Math.cos(rad);
            yh.style.left = (hx - 9) + 'px';
            yh.style.top = (hy - 9) + 'px';
          }
          if (playing || !t) { yh.disabled = true; yh.setAttribute('aria-disabled', 'true'); }
          yh.addEventListener('pointerdown', function (e) {
            try { if (e.stopPropagation) e.stopPropagation(); } catch (ee) {}
            stageYawPointerDown(e, bg, di);
          });
          layer.appendChild(yh);
          ctrls.push(yh);
        })();
      })(i);
    }
    bg._markerCtrls = ctrls;
    if (bg._pathMode) buildStagePath(bg, stageSelDi(bg));
    applyStageDisabled(bg);
  }
  function applyStageDisabled(bg) {
    var s = store();
    if (!bg) return;
    var playing = isPlaying();
    var invalid = !bg._transform || !s || !(s.dancers || []).length;
    var dis = playing || invalid;
    var nodes = [];
    try {
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-marker')));
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-yaw')));
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-list')));
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-num')));
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-apply')));
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-quick'))); // B2 快捷行随禁用口径
      nodes = nodes.concat([].slice.call(bg.querySelectorAll('.stage-pathnode'))); // C 路径节点随禁用口径
    } catch (e) {}
    setDisabled(nodes, dis);
  }
  function stageSelect(bg, di, focus) {
    if (!bg) return;
    var s = store();
    if (!s || !(s.dancers || [])[di]) return;
    try {
      var sel = bg.querySelector('.stage-list');
      if (sel) sel.value = String(di);
      var ixs = bg.querySelector('.stage-ix'), izs = bg.querySelector('.stage-iz'), iys = bg.querySelector('.stage-iy');
      var d = s.dancers[di];
      var cur = (d && d.start && typeof d.start === 'object') ? d.start : null;
      if (ixs) ixs.value = cur ? String(cur.x) : '';
      if (izs) izs.value = cur ? String(cur.z) : '';
      if (iys) iys.value = cur ? String(cur.yawDeg) : '';
      var mks = bg.querySelectorAll('.stage-marker');
      for (var i = 0; i < mks.length; i++) {
        if (mks[i].dataset.di === String(di)) mks[i].classList.add('sel');
        else mks[i].classList.remove('sel');
      }
      if (focus) {
        var mk = bg.querySelector('.stage-marker[data-di="' + di + '"]');
        if (mk) { try { mk.focus(); } catch (e) {} }
      }
    } catch (e) {}
  }
  function stagePointerDown(e, bg, di) {
    try {
      if (!bg || !e) return;
      // M2-STAGE-YAW：手柄目标不进 x/z 手势（手柄有自己的 yaw 手势，命中分离）
      try {
        if (e.target && e.target.closest && e.target.closest('.stage-yaw')) return;
        if (e.target && e.target.classList && e.target.classList.contains('stage-yaw')) return;
      } catch (ee0) {}
      if (isPlaying()) return; // 播放中只读 no-op
      var s = store(), CE = edit();
      if (!s || !CE || !bg._transform) return;
      if (bg._pending) return; // 单手势：已有挂起则忽略新的 pointerdown
      var ds = s.dancers || [];
      var d = ds[di];
      if (!d || typeof d !== 'object') return;
      var surface = bg.querySelector('#stageSurface');
      if (!surface) return;
      var rect = null;
      try { rect = surface.getBoundingClientRect(); } catch (err) { return; }
      var cbl = 0, cbt = 0, cw = 0, chh = 0;
      try { cbl = surface.clientLeft || 0; cbt = surface.clientTop || 0; cw = surface.clientWidth || 0; chh = surface.clientHeight || 0; } catch (err2) {}
      if (!rect || !(cw > 0) || !(chh > 0)) return;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      var frozen = { scale: bg._transform.scale, originX: bg._transform.originX, originY: bg._transform.originY, viewW: bg._transform.viewW, viewH: bg._transform.viewH };
      var startJson = ('start' in d && d.start !== undefined) ? JSON.stringify(d.start) : 'null';
      var pl = null;
      try { pl = CE.placementFor(ds, di); } catch (err2) { pl = null; }
      // MF-1：记录按下屏坐标（与 move/up 同一 rect 基准），release ≤2px 视为无位移点击严格 no-op
      var pressSx = e.clientX - (rect.left + cbl), pressSy = e.clientY - (rect.top + cbt);
      bg._pending = {
        kind: 'xz', pointerId: pid, di: di, dancer: d,
        dancersRef: ds, dancersLen: ds.length, projectId: s.projectId,
        origStartJson: startJson,
        fallback: pl ? { x: pl.x, z: pl.z } : null,
        origYaw: (CE.hasExplicitStart(d) && isFinite(d.start.yawDeg)) ? d.start.yawDeg : 0,
        hadExplicit: !!(CE.hasExplicitStart && CE.hasExplicitStart(d)),
        transform: frozen,
        rect: { left: rect.left + cbl, top: rect.top + cbt, width: cw, height: chh },
        pressSx: pressSx, pressSy: pressSy,
      };
      bg._lastDownTransform = JSON.parse(JSON.stringify(frozen));
      try {
        if (e.target && e.target.setPointerCapture) { try { e.target.setPointerCapture(pid); } catch (ee) {} }
      } catch (e3) {}
      try { e.preventDefault(); } catch (e4) {}
    } catch (err) {}
  }
  function stagePointerMove(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending) return;
      var pd = bg._pending;
      if (pd.kind === 'yaw') return; // yaw 手势由 stageYawPointerMove 驱动
      if (pd.kind === 'pathnode') return; // C：路径节点手势由 stagePathPointerMove 驱动
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return; // 其他 pointerId 不能驱动
      if (isPlaying()) { cancelPending(bg); return; }
      var CE = edit();
      if (!CE) return;
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      var w = CE.stageScreenToWorld(sx, sy, pd.transform);
      var ghost = bg.querySelector('.stage-ghost');
      if (!w || !isFinite(w.x) || !isFinite(w.z)) {
        if (ghost) ghost.style.display = 'none';
        bg._pending.invalid = true;
        return;
      }
      bg._pending.invalid = false;
      bg._pending.lastWorld = { x: w.x, z: w.z };
      var sp = CE.stageWorldToScreen(w.x, w.z, pd.transform);
      if (ghost && sp) {
        ghost.style.display = '';
        ghost.style.left = (sp.sx - 14) + 'px';
        ghost.style.top = (sp.sy - 14) + 'px';
      }
    } catch (err) {}
  }
  function stagePointerUp(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending) return;
      var pd = bg._pending;
      if (pd.kind === 'yaw') return; // yaw 手势由 stageYawPointerUp 提交
      if (pd.kind === 'pathnode') return; // C：路径节点手势由 stagePathPointerUp 提交
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return; // 其他 pointerId 不能提交
      var CE = edit(), s = store();
      function done() { clearPending(bg, true); }
      if (!s || !CE) { done(); return; }
      // 释放点在表面外 → 取消（零写入）
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      // MF-1：无位移点击严格 no-op（press→release 屏距 ≤2px，直接取消，不依赖世界量化）
      if (isFinite(sx) && isFinite(sy) && isFinite(pd.pressSx) && isFinite(pd.pressSy)) {
        var ddx = sx - pd.pressSx, ddy = sy - pd.pressSy;
        if ((ddx * ddx + ddy * ddy) <= 4) { done(); return; }
      }
      if (!(sx >= 0 && sy >= 0 && sx <= pd.rect.width && sy <= pd.rect.height)) { done(); return; }
      if (isPlaying()) { done(); return; } // 播放开始 → 取消
      // 工程替换 / 舞者增删 / 重排 / 并发改动 → 取消（按对象身份重解，不写替换舞者）
      if (s.projectId !== pd.projectId) { done(); return; }
      var ds = s.dancers || [];
      if (ds !== pd.dancersRef || ds.length !== pd.dancersLen) { done(); return; }
      var idx = ds.indexOf(pd.dancer);
      if (idx < 0 || idx !== pd.di) { done(); return; }
      var curJson = ('start' in pd.dancer && pd.dancer.start !== undefined) ? JSON.stringify(pd.dancer.start) : 'null';
      if (curJson !== pd.origStartJson) { done(); return; }
      var w = CE.stageScreenToWorld(sx, sy, pd.transform);
      if (!w || !isFinite(w.x) || !isFinite(w.z)) { done(); return; }
      var dec = CE.stageCommitDecision(
        pd.hadExplicit ? pd.dancer.start : null,
        pd.fallback, w.x, w.z);
      if (!dec || !dec.commit) { done(); return; } // 未动/回原量化点/非有限 → 零历史
      bg._lastCommitTransform = { scale: pd.transform.scale, originX: pd.transform.originX, originY: pd.transform.originY, viewW: pd.transform.viewW, viewH: pd.transform.viewH };
      // 单事务提交：一次纯校验 + 一次 saveHistory（内含一次 persist）+ 刷新
      var r = CE.setDancerStart(ds, idx, dec.x, dec.z, pd.hadExplicit ? pd.origYaw : 0);
      if (!r || !r.ok || !r.changed) { done(); return; }
      if (typeof window.saveHistory === 'function') window.saveHistory();
      else { done(); return; }
      if (typeof window.render === 'function') { try { window.render(); } catch (ee) {} }
      if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (ee2) {} }
      // render() 重建 #root 但舞台浮层在 body 上存活；重刷标记到已提交位置
      try {
        var bg2 = document.getElementById('stageDragModal');
        if (bg2) { refreshStageMarkers(bg2); stageSelect(bg2, idx, false); }
      } catch (ee3) {}
      if (typeof window.showToast === 'function') {
        try { window.showToast('已拖拽保存' + (((s.dancers || [])[idx] || {}).name || '') + '起始站位（网页预览用）'); } catch (ee4) {}
      }
      done();
    } catch (err) {
      try { var bgb = document.getElementById('stageDragModal'); if (bgb) clearPending(bgb, true); } catch (e2) {}
    }
  }
  function stageCancelEvent() {
    try {
      var bg = document.getElementById('stageDragModal');
      if (bg && bg._pending) cancelPending(bg);
    } catch (e) {}
  }
  // ---------- 朝向拖拽手势（TASK-20260909-M2-STAGE-YAW） ----------
  // 复用 x/z 单 _pending 骨架（冻结变换、一次释放事务、完整取消矩阵），kind='yaw' 区分；
  // 移动期只更新本地 ghost 箭头旋转，规范 dancers 深相等；释放按指针角定 yaw，x/z 严格保留。
  function yawMarkerCenter(pl, transform, CE) {
    try {
      if (!pl || !transform || !CE) return null;
      var sp = CE.stageWorldToScreen(pl.x, pl.z, transform);
      return sp ? { x: sp.sx, y: sp.sy } : null;
    } catch (e) { return null; }
  }
  function ensureYawGhostArrow(bg) {
    try {
      var g = bg ? bg.querySelector('.stage-ghost') : null;
      if (!g) return null;
      var ga = g.querySelector('.stage-ghost-arrow');
      if (!ga) {
        ga = document.createElement('span');
        ga.className = 'stage-ghost-arrow';
        ga.setAttribute('aria-hidden', 'true');
        g.appendChild(ga);
      }
      return ga;
    } catch (e) { return null; }
  }
  function stageYawPointerDown(e, bg, di) {
    try {
      if (!bg || !e) return;
      if (isPlaying()) return; // 播放中只读 no-op
      var s = store(), CE = edit();
      if (!s || !CE || !bg._transform) return;
      if (!CE.stageYawFromPointer || !CE.stageYawCommitDecision || !CE.quantStageYaw) return;
      if (bg._pending) return; // 单手势：已有挂起则忽略
      var ds = s.dancers || [];
      var d = ds[di];
      if (!d || typeof d !== 'object') return;
      var surface = bg.querySelector('#stageSurface');
      if (!surface) return;
      var rect = null;
      try { rect = surface.getBoundingClientRect(); } catch (err) { return; }
      var cbl = 0, cbt = 0, cw = 0, chh = 0;
      try { cbl = surface.clientLeft || 0; cbt = surface.clientTop || 0; cw = surface.clientWidth || 0; chh = surface.clientHeight || 0; } catch (err2) {}
      if (!rect || !(cw > 0) || !(chh > 0)) return;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      var frozen = { scale: bg._transform.scale, originX: bg._transform.originX, originY: bg._transform.originY, viewW: bg._transform.viewW, viewH: bg._transform.viewH };
      var startJson = ('start' in d && d.start !== undefined) ? JSON.stringify(d.start) : 'null';
      var pl = null;
      try { pl = CE.placementFor(ds, di); } catch (err3) { pl = null; }
      if (!pl || !isFinite(pl.x) || !isFinite(pl.z)) return;
      var center = yawMarkerCenter(pl, frozen, CE);
      if (!center) return;
      var pressSx = e.clientX - (rect.left + cbl), pressSy = e.clientY - (rect.top + cbt);
      bg._pending = {
        kind: 'yaw', pointerId: pid, di: di, dancer: d,
        dancersRef: ds, dancersLen: ds.length, projectId: s.projectId,
        origStartJson: startJson,
        fallback: { x: pl.x, z: pl.z },
        origYaw: (CE.hasExplicitStart(d) && isFinite(d.start.yawDeg)) ? d.start.yawDeg : 0,
        hadExplicit: !!(CE.hasExplicitStart && CE.hasExplicitStart(d)),
        origX: (CE.hasExplicitStart(d) && isFinite(d.start.x)) ? d.start.x : pl.x,
        origZ: (CE.hasExplicitStart(d) && isFinite(d.start.z)) ? d.start.z : pl.z,
        transform: frozen, center: center,
        rect: { left: rect.left + cbl, top: rect.top + cbt, width: cw, height: chh },
        pressSx: pressSx, pressSy: pressSy,
      };
      bg._lastDownTransform = JSON.parse(JSON.stringify(frozen));
      try {
        if (e.target && e.target.setPointerCapture) { try { e.target.setPointerCapture(pid); } catch (ee) {} }
      } catch (e3) {}
      try { e.preventDefault(); } catch (e4) {}
    } catch (err) {}
  }
  function stageYawPointerMove(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending) return;
      var pd = bg._pending;
      if (pd.kind !== 'yaw') return; // x/z 手势不动
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return;
      if (isPlaying()) { cancelPending(bg); return; }
      var CE = edit();
      if (!CE || !CE.stageYawFromPointer || !CE.quantStageYaw) return;
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      var raw = CE.stageYawFromPointer(pd.center.x, pd.center.y, sx, sy);
      var ghost = bg.querySelector('.stage-ghost');
      if (!isFinite(raw)) {
        if (ghost) ghost.style.display = 'none';
        bg._pending.invalid = true;
        return;
      }
      bg._pending.invalid = false;
      var q = CE.quantStageYaw(raw);
      if (!isFinite(q)) {
        if (ghost) ghost.style.display = 'none';
        bg._pending.invalid = true;
        return;
      }
      bg._pending.lastYaw = q;
      bg._pending.lastRawYaw = raw;
      // 本地 ghost 箭头旋转预览（规范 dancers 不动）
      var ga = ensureYawGhostArrow(bg);
      if (ghost) {
        ghost.style.display = 'flex';
        ghost.style.left = (pd.center.x - 14) + 'px';
        ghost.style.top = (pd.center.y - 14) + 'px';
        try { ghost.setAttribute('data-yaw', String(q)); } catch (ee) {}
      }
      if (ga) {
        ga.style.transform = 'rotate(' + q + 'deg)';
        try { ga.setAttribute('data-yaw', String(q)); } catch (ee2) {}
      }
    } catch (err) {}
  }
  function stageYawPointerUp(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending) return;
      var pd = bg._pending;
      if (pd.kind !== 'yaw') return;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return;
      var CE = edit(), s = store();
      function done() { clearPending(bg, true); }
      if (!s || !CE || !CE.stageYawFromPointer || !CE.stageYawCommitDecision) { done(); return; }
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      // 无位移点击严格 no-op（≤2px）
      if (isFinite(sx) && isFinite(sy) && isFinite(pd.pressSx) && isFinite(pd.pressSy)) {
        var ddx = sx - pd.pressSx, ddy = sy - pd.pressSy;
        if ((ddx * ddx + ddy * ddy) <= 4) { done(); return; }
      }
      if (!(sx >= 0 && sy >= 0 && sx <= pd.rect.width && sy <= pd.rect.height)) { done(); return; }
      if (isPlaying()) { done(); return; }
      if (s.projectId !== pd.projectId) { done(); return; }
      var ds = s.dancers || [];
      if (ds !== pd.dancersRef || ds.length !== pd.dancersLen) { done(); return; }
      var idx = ds.indexOf(pd.dancer);
      if (idx < 0 || idx !== pd.di) { done(); return; }
      var curJson = ('start' in pd.dancer && pd.dancer.start !== undefined) ? JSON.stringify(pd.dancer.start) : 'null';
      if (curJson !== pd.origStartJson) { done(); return; }
      var raw = CE.stageYawFromPointer(pd.center.x, pd.center.y, sx, sy);
      if (!isFinite(raw)) { done(); return; }
      var dec = CE.stageYawCommitDecision(pd.hadExplicit ? pd.dancer.start : null, raw);
      if (!dec || !dec.commit) { done(); return; } // 未动/回原量化点/非有限 → 零历史
      bg._lastCommitTransform = { scale: pd.transform.scale, originX: pd.transform.originX, originY: pd.transform.originY, viewW: pd.transform.viewW, viewH: pd.transform.viewH };
      // 单事务提交：一次纯校验 + 一次 saveHistory（内含一次 persist）+ 刷新；x/z 严格保留
      var cx = pd.hadExplicit ? pd.origX : pd.fallback.x;
      var cz = pd.hadExplicit ? pd.origZ : pd.fallback.z;
      var r = CE.setDancerStart(ds, idx, cx, cz, dec.yaw);
      if (!r || !r.ok || !r.changed) { done(); return; }
      if (typeof window.saveHistory === 'function') window.saveHistory();
      else { done(); return; }
      if (typeof window.render === 'function') { try { window.render(); } catch (ee) {} }
      if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (ee2) {} }
      try {
        var bg2 = document.getElementById('stageDragModal');
        if (bg2) { refreshStageMarkers(bg2); stageSelect(bg2, idx, false); }
      } catch (ee3) {}
      if (typeof window.showToast === 'function') {
        try { window.showToast('已旋转保存' + (((s.dancers || [])[idx] || {}).name || '') + '朝向（网页预览用）'); } catch (ee4) {}
      }
      done();
    } catch (err) {
      try { var bgb = document.getElementById('stageDragModal'); if (bgb) clearPending(bgb, true); } catch (e2) {}
    }
  }
  // TASK-20260918-PLAYER-UX-SIMPLIFY B2：2D 舞台一键原地转向/前进 3 秒——直接写走位/朝向轨
  // （ChoreoStageMotion.edit/install + 一次 saveHistory），与「走位 / 朝向」面板同一份数据。
  function stageMotionValues(di) {
    var s = store(), P = window.ChoreoStageMotion;
    if (!s || !P) return null;
    try { return P.nodes(s, di); } catch (e) { if (window.showToast) window.showToast(e.message); return null; }
  }
  function stageMotionCommit(di, values) {
    var s = store(), P = window.ChoreoStageMotion;
    if (!s || !P) return false;
    var all = P.edit(s, di, values, 'stage-quick-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    P.install(s, all);
    if (typeof window.saveHistory === 'function') window.saveHistory();
    else return false;
    if (typeof window.render === 'function') { try { window.render(); } catch (e) {} }
    if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (e2) {} }
    var bg2 = document.getElementById('stageDragModal');
    if (bg2) { refreshStageMarkers(bg2); stageSelect(bg2, di, false); }
    return true;
  }
  function stageQuickTurn(bg, di, deg) {
    try {
      if (isPlaying()) return;
      var values = stageMotionValues(di);
      if (!values) return;
      var last = values.facing[values.facing.length - 1];
      if (last && Number(last.yaw) === deg) { window.showToast('末尾朝向节点已是 ' + deg + '°，不再重复添加'); return; }
      values.facing.push({ time: String(last ? Number(last.time) + 2 : 2), yaw: String(deg) });
      if (!stageMotionCommit(di, values)) return;
      window.showToast('已添加原地转向 ' + deg + '°（一次撤销；精确值在「走位 / 朝向」面板改）');
    } catch (e) { if (window.showToast) window.showToast('未写入：' + e.message); }
  }
  function stageQuickAdvance(bg, di) {
    try {
      if (isPlaying()) return;
      var s = store(), P = window.ChoreoStageMotion;
      var values = stageMotionValues(di);
      if (!values || !s || !P) return;
      var last = values.movement[values.movement.length - 1];
      var t = last ? Number(last.time) + 3 : 3, atMs = last ? Math.round(Number(last.time) * 1000) : 0;
      var CE = edit();
      var live = CE ? CE.placementFor(s.dancers, di) : null;
      if (!live) return;
      var p = P.sample(s, di, atMs, live), rad = p.yawDeg * Math.PI / 180;
      values.movement.push({ time: String(t), x: String(Math.round((p.x + Math.sin(rad) * 1.5) * 100) / 100), z: String(Math.round((p.z + Math.cos(rad) * 1.5) * 100) / 100) });
      if (!stageMotionCommit(di, values)) return;
      window.showToast('已前进 3 秒·约 1.5 米（当前朝向，一次撤销；精确值在「走位 / 朝向」面板改）');
    } catch (e) { if (window.showToast) window.showToast('未写入：' + e.message); }
  }
  // ---------- 2D 走位路径直编（TASK-20260918-PLAYER-UX-SIMPLIFY C） ----------
  // 编辑态默认关；开启后只显示当前选中舞者的走位路径（起点+节点+连线）：
  // 点画布空白=按播放头时刻加节点；拖节点=释放单事务改位置（冻结变换）；点选节点=行内微调时刻/删除。
  // 全部写入走 ChoreoStageMotion.nodes/edit/install + 一次 saveHistory（单次撤销），不新增数据格式/协议。
  function stageSelDi(bg) {
    try {
      var sel = bg.querySelector('.stage-list');
      var di = sel ? parseInt(sel.value, 10) : NaN;
      return isFinite(di) ? di : 0;
    } catch (e) { return 0; }
  }
  function stagePathPoints(di) {
    var s = store(), P = window.ChoreoStageMotion;
    if (!s || !P) return [];
    try {
      return P.nodes(s, di).movement.map(function (v) { return { x: Number(v.x), z: Number(v.z) }; });
    } catch (e) { return []; }
  }
  function buildStagePath(bg, di) {
    var s = store(), P = window.ChoreoStageMotion, CE = edit();
    if (!bg || !s || !P || !CE || !bg._transform) return;
    var old = bg.querySelector('.stage-path-layer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var surface = bg.querySelector('#stageSurface');
    if (!surface) return;
    var values;
    try { values = P.nodes(s, di); } catch (e) { if (window.showToast) window.showToast(e.message); return; }
    var layer = document.createElement('div');
    layer.className = 'stage-path-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    layer.appendChild(svg);
    var pl = null;
    try { pl = CE.placementFor(s.dancers, di); } catch (e0) {}
    var pts = [];
    if (pl) pts.push({ x: pl.x, z: pl.z, start: true });
    values.movement.forEach(function (v, i) { pts.push({ x: Number(v.x), z: Number(v.z), i: i }); });
    var screen = pts.map(function (p) { return CE.stageWorldToScreen(p.x, p.z, bg._transform); });
    var poly = document.createElementNS(svgNS, 'polyline');
    if (screen.length >= 2) {
      poly.setAttribute('points', screen.map(function (q) { return Math.round(q.sx) + ',' + Math.round(q.sy); }).join(' '));
    }
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#71c9b4');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-dasharray', '6 4');
    svg.appendChild(poly);
    bg._pathPoly = poly;
    bg._pathScreen = screen;
    var playing = isPlaying();
    values.movement.forEach(function (v, idx) {
      var q = screen[idx + 1];
      if (!q) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'stage-pathnode' + (bg._pathSel === idx ? ' sel' : '');
      b.dataset.idx = String(idx);
      b.setAttribute('aria-label', '路径节点' + (idx + 1) + ' ' + v.time + '秒 ' + (v.move === 'run' ? '跑步' : '走路') + ' 拖动改位置');
      b.title = '节点' + (idx + 1) + ' · ' + v.time + ' 秒 · (' + v.x + ', ' + v.z + ') 米 · ' + (v.move === 'run' ? '跑步' : '走路') + ' · 拖动改位置；点按选中后可微调时刻、走/跑或删除';
      b.style.left = (q.sx - 7) + 'px';
      b.style.top = (q.sy - 7) + 'px';
      if (playing) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      b.addEventListener('pointerdown', function (e) { stagePathPointerDown(e, bg, di, idx); });
      layer.appendChild(b);
    });
    surface.appendChild(layer);
  }
  function updatePathEditRow(bg) {
    var row = bg.querySelector('.stage-path-edit');
    if (!row) return;
    var show = !!(bg._pathMode && bg._pathSel !== null && bg._pathSel !== undefined);
    row.style.display = show ? '' : 'none';
    if (!show) return;
    var di = stageSelDi(bg), idx = bg._pathSel;
    var values = stageMotionValues(di);
    var v = values && values.movement[idx];
    if (!v) { bg._pathSel = null; row.style.display = 'none'; return; }
    var input = row.querySelector('.stage-path-time');
    input.value = v.time;
    input.dataset.di = String(di); input.dataset.idx = String(idx);
    var moveSel = row.querySelector('.stage-path-move');
    if (moveSel) moveSel.value = v.move === 'run' ? 'run' : 'walk';
    row.querySelector('.stage-path-xy').textContent = '节点' + (idx + 1) + ' · X ' + v.x + ' / Z ' + v.z + ' 米 · ' + (v.move === 'run' ? '跑步' : '走路');
  }
  function addStagePathNode(bg, di, sx, sy) {
    try {
      if (isPlaying()) return;
      var s = store(), P = window.ChoreoStageMotion, CE = edit();
      if (!s || !P || !CE || !bg._transform) return;
      var w = CE.stageScreenToWorld(sx, sy, bg._transform);
      if (!w || !isFinite(w.x) || !isFinite(w.z)) return;
      var values = stageMotionValues(di);
      if (!values) return;
      var t = Math.round(s.currentTime * 1000) / 1000;
      if (!(t > 0)) { window.showToast('播放头在 0 秒：请先把播放头移过 0 秒再点画布加节点（到达时刻须大于 0 且严格递增）'); return; }
      var list = values.movement, at = list.length, i;
      for (i = 0; i < list.length; i++) { if (Number(list[i].time) > t) { at = i; break; } }
      if ((at > 0 && Number(list[at - 1].time) === t) || (at < list.length && Number(list[at].time) === t)) {
        window.showToast(t + ' 秒已有同刻节点：请把播放头移到其他时刻，或选中该节点微调'); return;
      }
      list.splice(at, 0, { time: String(t), x: String(CE.quantStage(w.x)), z: String(CE.quantStage(w.z)) });
      stageMotionCommit(di, values);
      bg._pathSel = at;
      refreshStageMarkers(bg);
      updatePathEditRow(bg);
      window.showToast('已在 ' + t + ' 秒添加路径节点（默认走路，一次撤销；拖动节点改位置，点按选中后微调时刻、走/跑或删除）');
    } catch (e) { if (window.showToast) window.showToast('未写入：' + e.message); }
  }
  function stagePathPointerDown(e, bg, di, idx) {
    try {
      if (!bg || !e) return;
      if (isPlaying()) return;
      var s = store(), CE = edit();
      if (!s || !CE || !bg._transform) return;
      if (bg._pending) return;
      var surface = bg.querySelector('#stageSurface');
      if (!surface) return;
      var rect = null;
      try { rect = surface.getBoundingClientRect(); } catch (err) { return; }
      var cbl = surface.clientLeft || 0, cbt = surface.clientTop || 0, cw = surface.clientWidth || 0, ch = surface.clientHeight || 0;
      if (!rect || !(cw > 0) || !(ch > 0)) return;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      var frozen = { scale: bg._transform.scale, originX: bg._transform.originX, originY: bg._transform.originY, viewW: bg._transform.viewW, viewH: bg._transform.viewH };
      bg._pending = {
        kind: 'pathnode', pointerId: pid, di: di, idx: idx,
        projectId: s.projectId, dancersRef: s.dancers,
        transform: frozen,
        rect: { left: rect.left + cbl, top: rect.top + cbt, width: cw, height: ch },
        pressSx: e.clientX - (rect.left + cbl), pressSy: e.clientY - (rect.top + cbt),
      };
      try { if (e.target && e.target.setPointerCapture) { try { e.target.setPointerCapture(pid); } catch (ee) {} } } catch (e3) {}
      try { e.preventDefault(); } catch (e4) {}
    } catch (err) {}
  }
  function stagePathPointerMove(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending || bg._pending.kind !== 'pathnode') return;
      var pd = bg._pending;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return;
      if (isPlaying()) { clearPathPending(bg); return; }
      var CE = edit();
      if (!CE) return;
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      var w = CE.stageScreenToWorld(sx, sy, pd.transform);
      if (!w || !isFinite(w.x) || !isFinite(w.z)) return;
      pd.last = { x: w.x, z: w.z };
      var q = CE.stageWorldToScreen(w.x, w.z, pd.transform);
      if (!q) return;
      var nodeBtn = bg.querySelector('.stage-pathnode[data-idx="' + pd.idx + '"]');
      if (nodeBtn) { nodeBtn.style.left = (q.sx - 7) + 'px'; nodeBtn.style.top = (q.sy - 7) + 'px'; }
      var screen = (bg._pathScreen || []).slice();
      if (screen.length > pd.idx + 1) screen[pd.idx + 1] = q;
      if (bg._pathPoly && screen.length >= 2) {
        bg._pathPoly.setAttribute('points', screen.map(function (p) { return Math.round(p.sx) + ',' + Math.round(p.sy); }).join(' '));
      }
    } catch (err) {}
  }
  function clearPathPending(bg) {
    if (!bg) return;
    bg._pending = null;
    try { refreshStageMarkers(bg); } catch (e) {}
  }
  function stagePathPointerUp(e) {
    try {
      var bg = document.getElementById('stageDragModal');
      if (!bg || !bg._pending || bg._pending.kind !== 'pathnode') return;
      var pd = bg._pending;
      var pid = (e.pointerId === undefined || e.pointerId === null) ? 1 : e.pointerId;
      if (pid !== pd.pointerId) return;
      var s = store(), CE = edit(), P = window.ChoreoStageMotion;
      function done(select) {
        bg._pending = null;
        if (select) {
          bg._pathSel = pd.idx;
          refreshStageMarkers(bg);
          updatePathEditRow(bg);
        } else { refreshStageMarkers(bg); }
      }
      if (!s || !CE || !P) { done(false); return; }
      var sx = e.clientX - pd.rect.left, sy = e.clientY - pd.rect.top;
      if (isFinite(sx) && isFinite(sy) && isFinite(pd.pressSx) && isFinite(pd.pressSy)) {
        var ddx = sx - pd.pressSx, ddy = sy - pd.pressSy;
        if ((ddx * ddx + ddy * ddy) <= 4) { done(true); return; } // 无位移点按＝选中该节点
      }
      if (!(sx >= 0 && sy >= 0 && sx <= pd.rect.width && sy <= pd.rect.height)) { done(false); return; }
      if (isPlaying()) { done(false); return; }
      if (s.projectId !== pd.projectId || s.dancers !== pd.dancersRef) { done(false); return; }
      if (!pd.last) { done(false); return; }
      var values;
      try { values = P.nodes(s, pd.di); } catch (err) { done(false); return; }
      var v = values.movement[pd.idx];
      if (!v) { done(false); return; }
      var nx = CE.quantStage(pd.last.x), nz = CE.quantStage(pd.last.z);
      if (Number(v.x) === nx && Number(v.z) === nz) { done(true); return; } // 回原量化点零历史
      v.x = String(nx); v.z = String(nz);
      try {
        stageMotionCommit(pd.di, values);
        bg._pathSel = pd.idx;
        refreshStageMarkers(bg);
        updatePathEditRow(bg);
        bg._pending = null;
      } catch (err) {
        bg._pending = null;
        if (window.showToast) window.showToast('未写入：' + err.message);
        refreshStageMarkers(bg);
      }
    } catch (err) {
      try { clearPathPending(document.getElementById('stageDragModal')); } catch (e2) {}
    }
  }
  function openStage(invoker) {
    var s = store(), CE = edit();
    if (!s || !CE) return false;
    closeStage(true);
    try { _stageInvoker = invoker || document.activeElement || null; } catch (e) { _stageInvoker = null; }
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = 'stageDragModal';
    var box = document.createElement('div');
    box.className = 'modal stage-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '2D 舞台起始站位拖拽');
    var h = document.createElement('h3');
    h.textContent = '2D 舞台 · 起始站位拖拽';
    box.appendChild(h);
    var note = document.createElement('div');
    note.className = 'stage-notice';
    note.textContent = STAGE_NOTICE;
    box.appendChild(note);
    var rowTop = document.createElement('div');
    rowTop.className = 'stage-toprow';
    var lab = document.createElement('label');
    lab.className = 'stage-pick';
    var labSp = document.createElement('span');
    labSp.textContent = '舞者';
    lab.appendChild(labSp);
    var sel = document.createElement('select');
    sel.className = 'stage-list';
    sel.setAttribute('aria-label', '舞者列表');
    (s.dancers || []).forEach(function (d, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = (d && typeof d.name === 'string') ? d.name : ('舞者' + (i + 1));
      sel.appendChild(o);
    });
    sel.onchange = function () {
      var di = parseInt(sel.value, 10);
      if (isFinite(di)) stageSelect(bg, di, true);
      if (bg._pathMode) { bg._pathSel = null; try { refreshStageMarkers(bg); } catch (e) {} updatePathEditRow(bg); } // C：切舞者即切换显示路径
    };
    lab.appendChild(sel);
    rowTop.appendChild(lab);
    // B2 快捷行：所选舞者一键原地转向 / 前进 3 秒（读当前下拉选择）
    var quickRow = document.createElement('div');
    quickRow.className = 'stage-quickrow';
    quickRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:6px 0';
    var quickLab = document.createElement('span');
    quickLab.textContent = '快捷：';
    quickRow.appendChild(quickLab);
    [0, 90, 180, 270].forEach(function (deg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn stage-quick';
      b.textContent = '原地转 ' + deg + '°';
      b.title = '给所选舞者末尾朝向节点 +2 秒（无则 2 秒）原地转向 ' + deg + '°；一次撤销';
      b.onclick = function () { var di = parseInt(sel.value, 10); if (isFinite(di)) stageQuickTurn(bg, di, deg); };
      quickRow.appendChild(b);
    });
    var bAdv = document.createElement('button');
    bAdv.type = 'button';
    bAdv.className = 'btn stage-quick';
    bAdv.textContent = '前进 3 秒（当前朝向）';
    bAdv.title = '末尾路径节点 +3 秒（无则 3 秒），沿该时刻朝向前进约 1.5 米；一次撤销';
    bAdv.onclick = function () { var di = parseInt(sel.value, 10); if (isFinite(di)) stageQuickAdvance(bg, di); };
    quickRow.appendChild(bAdv);
    // C：走位路径编辑态开关（默认关；开启后点画布=按播放头时刻加节点）
    var bPath = document.createElement('button');
    bPath.type = 'button';
    bPath.className = 'btn stage-quick stage-pathtoggle';
    bPath.textContent = '✎ 走位路径';
    bPath.title = '开启后：先把播放头移到某秒，再点画布即在该时刻加路径节点（默认走路）；拖节点改位置；点按选中节点后可微调时刻、走/跑或删除。只显示当前选中舞者的路径；每步一次撤销。网页预览不区分走/跑动画，模式用于游戏内执行';
    bPath.onclick = function () {
      bg._pathMode = !bg._pathMode;
      bPath.setAttribute('aria-pressed', bg._pathMode ? 'true' : 'false');
      bPath.style.background = bg._pathMode ? 'var(--accent)' : '';
      bg._pathSel = null;
      try { refreshStageMarkers(bg); } catch (e) {}
      updatePathEditRow(bg);
      if (typeof window.showToast === 'function' && bg._pathMode) window.showToast('走位路径编辑：先移播放头，再点画布加节点（默认走路）；拖动改位置；点按选中后微调时刻、走/跑或删除');
    };
    quickRow.appendChild(bPath);
    rowTop.appendChild(quickRow);
    var scaleEl = document.createElement('div');
    scaleEl.className = 'stage-scale';
    scaleEl.textContent = '比例不可用';
    rowTop.appendChild(scaleEl);
    box.appendChild(rowTop);
    var surface = document.createElement('div');
    surface.id = 'stageSurface';
    surface.className = 'stage-surface';
    surface.setAttribute('role', 'application');
    surface.setAttribute('aria-label', '2D 舞台表面：+X 向右，+Z 向上');
    surface.setAttribute('tabindex', '0');
    var markers = document.createElement('div');
    markers.className = 'stage-markers';
    surface.appendChild(markers);
    var org = document.createElement('div');
    org.className = 'stage-origin';
    org.title = '原点 (0,0)';
    org.setAttribute('aria-hidden', 'true');
    surface.appendChild(org);
    var ghost = document.createElement('div');
    ghost.className = 'stage-ghost';
    ghost.style.display = 'none';
    ghost.setAttribute('aria-hidden', 'true');
    surface.appendChild(ghost);
    box.appendChild(surface);
    // C：点画布空白＝按播放头时刻加路径节点（仅路径编辑态；命中标记/手柄/节点等按钮不加）
    surface.addEventListener('click', function (e) {
      if (!bg._pathMode || isPlaying()) return;
      var tg = e.target;
      if (!tg) return;
      if (tg.closest && tg.closest('button')) return;
      var ok = tg === surface
        || (tg.classList && (tg.classList.contains('stage-markers') || tg.classList.contains('stage-path-layer')))
        || (tg.tagName && tg.tagName.toLowerCase() === 'svg');
      if (!ok) return;
      var di = parseInt(sel.value, 10);
      if (!isFinite(di)) return;
      var r2 = surface.getBoundingClientRect();
      var sx = e.clientX - (r2.left + (surface.clientLeft || 0));
      var sy = e.clientY - (r2.top + (surface.clientTop || 0));
      addStagePathNode(bg, di, sx, sy);
    });
    // C：选中节点的行内微调行（时刻秒 + 删除；默认隐藏）
    var pathEdit = document.createElement('div');
    pathEdit.className = 'stage-path-edit';
    pathEdit.style.cssText = 'display:none;margin:6px 0;flex-wrap:wrap;gap:6px;align-items:center';
    var pathXy = document.createElement('span');
    pathXy.className = 'stage-path-xy';
    pathXy.style.cssText = 'font-size:12px;color:var(--text-2)';
    pathEdit.appendChild(pathXy);
    var pathTimeWrap = document.createElement('label');
    pathTimeWrap.className = 'stage-numwrap';
    var pathTimeSp = document.createElement('span');
    pathTimeSp.textContent = '时刻(秒)';
    pathTimeWrap.appendChild(pathTimeSp);
    var pathTime = document.createElement('input');
    pathTime.type = 'text';
    pathTime.inputMode = 'decimal';
    pathTime.className = 'stage-num stage-path-time';
    pathTime.setAttribute('aria-label', '路径节点时刻（秒）');
    pathTimeWrap.appendChild(pathTime);
    pathEdit.appendChild(pathTimeWrap);
    // TASK-20260919-PATH-LOCOMOTION：选中节点的走/跑选择（默认走路）；change 即单事务提交（一次撤销）。
    var pathMoveWrap = document.createElement('label');
    pathMoveWrap.className = 'stage-numwrap';
    var pathMoveSp = document.createElement('span');
    pathMoveSp.textContent = '移动';
    pathMoveWrap.appendChild(pathMoveSp);
    var pathMove = document.createElement('select');
    pathMove.className = 'stage-num stage-path-move';
    pathMove.setAttribute('aria-label', '路径节点移动模式');
    [['walk', '走路'], ['run', '跑步']].forEach(function (o) {
      var op = document.createElement('option');
      op.textContent = o[1]; op.value = o[0];
      pathMove.appendChild(op);
    });
    pathMove.title = '走路=慢速步行；跑步=快速跑动。游戏整场按各节点自动切换步态；网页预览按时刻插值位置，不区分走/跑动画';
    pathMove.onchange = function () {
      if (isPlaying()) return;
      var di = parseInt(pathTime.dataset.di, 10), idx = parseInt(pathTime.dataset.idx, 10);
      if (!isFinite(di) || !isFinite(idx)) return;
      try {
        var values = stageMotionValues(di);
        if (!values || !values.movement[idx]) return;
        if (pathMove.value === 'run') values.movement[idx].move = 'run';
        else delete values.movement[idx].move;
        stageMotionCommit(di, values);
        bg._pathSel = idx;
        refreshStageMarkers(bg);
        updatePathEditRow(bg);
        if (typeof window.showToast === 'function') window.showToast(pathMove.value === 'run' ? '节点已改为跑步（一次撤销）' : '节点已改为走路（一次撤销）');
      } catch (err) { if (window.showToast) window.showToast('未写入：' + err.message); }
    };
    pathMoveWrap.appendChild(pathMove);
    pathEdit.appendChild(pathMoveWrap);
    var bTimeApply = document.createElement('button');
    bTimeApply.type = 'button';
    bTimeApply.className = 'btn stage-quick';
    bTimeApply.textContent = '应用时刻';
    bTimeApply.onclick = function () {
      if (isPlaying()) return;
      var di = parseInt(pathTime.dataset.di, 10), idx = parseInt(pathTime.dataset.idx, 10);
      if (!isFinite(di) || !isFinite(idx)) return;
      try {
        var values = stageMotionValues(di);
        if (!values || !values.movement[idx]) return;
        values.movement[idx].time = String(pathTime.value).trim();
        stageMotionCommit(di, values);
        bg._pathSel = idx;
        refreshStageMarkers(bg);
        updatePathEditRow(bg);
      } catch (err) { if (window.showToast) window.showToast('未写入：' + err.message); }
    };
    pathEdit.appendChild(bTimeApply);
    var bNodeDel = document.createElement('button');
    bNodeDel.type = 'button';
    bNodeDel.className = 'btn stage-quick';
    bNodeDel.textContent = '删除节点';
    bNodeDel.onclick = function () {
      if (isPlaying()) return;
      var di = parseInt(pathTime.dataset.di, 10), idx = parseInt(pathTime.dataset.idx, 10);
      if (!isFinite(di) || !isFinite(idx)) return;
      try {
        var values = stageMotionValues(di);
        if (!values || !values.movement[idx]) return;
        values.movement.splice(idx, 1);
        stageMotionCommit(di, values);
        bg._pathSel = null;
        refreshStageMarkers(bg);
        updatePathEditRow(bg);
        if (typeof window.showToast === 'function') window.showToast('已删除节点（一次撤销）');
      } catch (err) { if (window.showToast) window.showToast('未写入：' + err.message); }
    };
    pathEdit.appendChild(bNodeDel);
    box.appendChild(pathEdit);
    var emptyEl = document.createElement('div');
    emptyEl.className = 'stage-empty';
    emptyEl.style.display = 'none';
    box.appendChild(emptyEl);
    // 键盘替代：舞者下拉 + X/Z/Yaw 数字框（与既有对话框同校验口径）
    // TASK-20260918-PLAYER-UX-SIMPLIFY A2：数值区默认折叠（拖拽为主路径），class/id 不变保住测试与禁用口径。
    var numsFold = document.createElement('details');
    numsFold.className = 'stage-nums-fold';
    var numsSum = document.createElement('summary');
    numsSum.textContent = '数字编辑（精确值） ▸';
    numsSum.style.cursor = 'pointer';
    numsFold.appendChild(numsSum);
    var numRow = document.createElement('div');
    numRow.className = 'stage-nums';
    numsFold.appendChild(numRow);
    box.appendChild(numsFold);    function numField(key, labelText) {
      var w = document.createElement('label');
      w.className = 'stage-numwrap';
      var sp = document.createElement('span');
      sp.textContent = labelText;
      w.appendChild(sp);
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.className = 'stage-num';
      inp.dataset.field = key;
      if (key === 'x') inp.classList.add('stage-ix');
      if (key === 'z') inp.classList.add('stage-iz');
      if (key === 'yawDeg') inp.classList.add('stage-iy');
      inp.classList.add('stage-num-key');
      inp.setAttribute('aria-label', labelText);
      w.appendChild(inp);
      numRow.appendChild(w);
      return inp;
    }
    var ix = numField('x', 'X（米，右 +）');
    var iz = numField('z', 'Z（米，前 +）');
    var iy = numField('yawDeg', '朝向（度，0 朝前 +Z）');
    var bApply = document.createElement('button');
    bApply.type = 'button';
    bApply.className = 'btn primary stage-apply';
    bApply.textContent = '应用数字';
    bApply.title = '用数字框保存所选舞者起始站位（Enter）';
    bApply.onclick = function () {
      if (isPlaying()) return;
      var di = parseInt(sel.value, 10);
      if (!isFinite(di)) return;
      var r = CE.setDancerStart(s.dancers, di, ix.value, iz.value, iy.value);
      if (!r || !r.ok) {
        if (typeof window.showToast === 'function') window.showToast('输入无效，未保存：请填写有限数字。');
        return;
      }
      if (!r.changed) return;
      if (typeof window.saveHistory === 'function') window.saveHistory();
      if (typeof window.render === 'function') window.render();
      if (window.__p3dRefreshPlacement) { try { window.__p3dRefreshPlacement(); } catch (e) {} }
      var bg2 = document.getElementById('stageDragModal');
      if (bg2) { refreshStageMarkers(bg2); stageSelect(bg2, di, false); }
    };
    [ix, iz, iy].forEach(function (inp) {
      inp.addEventListener('keydown', function (ev) {
        if (!ev) return;
        if (ev.key === 'Enter') { ev.preventDefault(); if (!isPlaying()) bApply.click(); }
        else if (ev.key === 'Escape') {
          ev.preventDefault(); ev.stopPropagation();
          try {
            if (document.getElementById('startFormationModal')) return;
          } catch (e) {}
          var bgr = document.getElementById('stageDragModal');
          if (bgr && bgr._pending) { try { bgr._pending = null; var gh = bgr.querySelector('.stage-ghost'); if (gh) gh.style.display = 'none'; } catch (ee) {} }
        }
      });
    });
    numRow.appendChild(bApply);
    var acts = document.createElement('div');
    acts.className = 'modal-act';
    var bNum = document.createElement('button');
    bNum.type = 'button';
    bNum.className = 'btn stage-numedit';
    bNum.textContent = '数字编辑';
    bNum.title = '打开所选舞者的数字对话框（键盘替代）';
    bNum.onclick = function () {
      if (isPlaying()) return;
      var di = parseInt(sel.value, 10);
      if (!isFinite(di)) return;
      if (window.ChoreoStageUI && window.ChoreoStageUI.openStartDialog) window.ChoreoStageUI.openStartDialog(di);
    };
    acts.appendChild(bNum);
    var bClose = document.createElement('button');
    bClose.type = 'button';
    bClose.className = 'btn stage-close';
    bClose.textContent = '关闭（Esc）';
    bClose.title = '关闭 2D 舞台（Esc）';
    bClose.onclick = function () { closeStage(false); };
    acts.appendChild(bClose);
    box.appendChild(acts);
    bg.appendChild(box);
    document.body.appendChild(bg);
    bg._pending = null;
    bg._transform = null;
    bg._pathMode = false;
    bg._pathSel = null;
    bPath.setAttribute('aria-pressed', 'false');
    // 手势期全局监听（捕获阶段，保证合成事件与真实事件同口径）
    bg._onMove = function (ev) { stagePointerMove(ev); stageYawPointerMove(ev); stagePathPointerMove(ev); };
    bg._onUp = function (ev) { stagePointerUp(ev); stageYawPointerUp(ev); stagePathPointerUp(ev); };
    bg._onCancel = function () { stageCancelEvent(); };
    bg._onBlur = function () { stageCancelEvent(); };
    bg._onResize = function () {
      var bgr = document.getElementById('stageDragModal');
      if (bgr && bgr._pending) stageCancelEvent();
      else if (bgr) { try { refreshStageMarkers(bgr); } catch (e) {} }
    };
    bg._keyHandler = function (ev) {
      if (!ev || ev.key !== 'Escape') return;
      // Escape 只关顶层：数字对话框在上时让它先关
      try {
        if (document.getElementById('startFormationModal')) return;
      } catch (e) {}
      ev.preventDefault();
      if (bg._pending) cancelPending(bg);
      else closeStage(false);
    };
    bg._onLostCapture = function () { stageCancelEvent(); };
    try { window.addEventListener('pointermove', bg._onMove, true); } catch (e) {}
    try { window.addEventListener('pointerup', bg._onUp, true); } catch (e2) {}
    try { window.addEventListener('pointercancel', bg._onCancel, true); } catch (e3) {}
    try { window.addEventListener('blur', bg._onBlur, true); } catch (e4) {}
    try { window.addEventListener('resize', bg._onResize, true); } catch (e5) {}
    try { document.addEventListener('keydown', bg._keyHandler, true); } catch (e6) {}
    try { window.addEventListener('keydown', bg._keyHandler, true); } catch (e7) {}
    try { surface.addEventListener('lostpointercapture', bg._onLostCapture, true); } catch (e8) {}
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) closeStage(false); });
    refreshStageMarkers(bg);
    stageSelect(bg, 0, false);
    applyStageDisabled(bg);
    // 打开即聚焦舞者列表（键盘可达起点）
    try {
      var firstSel = bg.querySelector('.stage-list');
      if (firstSel && !firstSel.disabled) firstSel.focus();
      else bClose.focus();
    } catch (e9) {}
    return true;
  }
  function closeStage(silent) {
    var bg = document.getElementById('stageDragModal');
    if (!bg) return;
    if (bg._onMove) { try { window.removeEventListener('pointermove', bg._onMove, true); } catch (e) {} }
    if (bg._onUp) { try { window.removeEventListener('pointerup', bg._onUp, true); } catch (e2) {} }
    if (bg._onCancel) { try { window.removeEventListener('pointercancel', bg._onCancel, true); } catch (e3) {} }
    if (bg._onBlur) { try { window.removeEventListener('blur', bg._onBlur, true); } catch (e4) {} }
    if (bg._onResize) { try { window.removeEventListener('resize', bg._onResize, true); } catch (e5) {} }
    if (bg._keyHandler) {
      try { document.removeEventListener('keydown', bg._keyHandler, true); } catch (e6) {}
      try { window.removeEventListener('keydown', bg._keyHandler, true); } catch (e7) {}
    }
    if (bg.parentNode) bg.parentNode.removeChild(bg);
    if (!silent) {
      try {
        if (_stageInvoker && document.contains(_stageInvoker) && _stageInvoker.focus) _stageInvoker.focus();
      } catch (e8) {}
      _stageInvoker = null;
    }
  }

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoStageUI = { openStartDialog: openStartDialog, closeStartDialog: closeStartDialog, noticeText: noticeText, NOTICE: NOTICE, openStage: openStage, closeStage: closeStage, STAGE_NOTICE: STAGE_NOTICE, stageYawPointerDown: stageYawPointerDown, stageYawPointerMove: stageYawPointerMove, stageYawPointerUp: stageYawPointerUp };
})();
