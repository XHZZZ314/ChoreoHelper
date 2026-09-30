/**
 * preview3d-cam.js — 3D 预览面板的「视图层」（M1：面板尺寸 / 相机 / 视角预设 / 手势）
 *
 * 干嘛的：OVERHAUL 批 B 从 preview3d.js 拆出的第一块——相机/取景控制整体搬家，代码逐字
 *        保留（只把对 preview3d 模块私有状态的闭包读改成 host 访问器读，行为不变）。
 * 怎么接：经典脚本、window 全局、file:// 兼容；必须在 preview3d.js 之前加载。
 *        preview3d.js 调 Preview3DCam.create(host) 拿唯一实例（host 提供 THREE/camera/
 *        canvas/panel/ready/rigs/spacing 的实时读与 dancerCount/resizeCanvas 两个回调）。
 * 状态归属：视图状态（viewTarget/viewDist/viewPreset/viewMax/viewGesture/viewW/viewH…）
 *        全部本模块私有（INV-1 不变），只经返回的 api 给 preview3d 消费与
 *        window.__p3dDebug().view 只读外露（INV-7 口径不变）。
 */
(function () {
  'use strict';

  function create(host) {
    // ---- M1 视图状态：面板尺寸 / 相机 / 视角预设 ----
    // INV-1：以下全部模块私有。不写 window.store、projectRecord()、工程库、撤销栈、
    // localStorage 或 URL hash，只经 window.__p3dDebug().view 只读外露。
    // M1 视图约定（M2~M4 必须沿用，见模块变更记录）：Y 轴向上，焦点 (0, 0.8, 0)，
    // 半径 R(n) = 2.6 + (n - 1) * 1.035（= 现有 layoutDancers 的 2.6 + (n-1)*SPACING*0.9），
    // 正视=+Z（与今天默认取景逐位一致）、侧视=+X、顶视=+Y 且 up=(0,0,-1)（正上方 up 退化）、
    // 自由=+Z 标准透视（手动操作后即为所指示状态）。
    var VIEW_CAM_Y = 1.05;        // 默认机位高度（与旧 layoutDancers 的 position.y 一致）
    var VIEW_TARGET_Y = 0.8;      // 默认焦点高度（与旧 layoutDancers 的 lookAt 一致）
    var VIEW_MIN_DIST = 0.6, VIEW_MAX_DIST = 60;           // INV-3：距离夹取
    var VIEW_MIN_POLAR = 0.05, VIEW_MAX_POLAR = 3.091536;  // INV-3：极角夹取
    var VIEW_MIN_W = 320, VIEW_MIN_H = 260, VIEW_MARGIN = 14; // viewContract.panelBounds
    var VIEW_ORBIT_K = 0.0075;    // 每 CSS 像素的轨道弧度
    var VIEW_ZOOM_K = 0.0012;     // 每 deltaY 的指数缩放系数
    var VIEW_PAN_FIT = 0.9;       // 聚焦后包围盒占屏比（留 10% 边距）
    var viewTarget = null, viewUp = null;                // THREE.Vector3，建场景后创建
    var viewDist = 2.6, viewTheta = 0, viewPhi = 1.5;    // 以焦点为原点的球坐标
    var viewPreset = 'free', viewMax = false, viewGesture = null;
    var viewW = 340, viewH = 440;   // 面板内容框尺寸（CSS 像素），与旧 340x440 一致
    var viewDefaultPending = false; // 首次加载后按实际人物包围盒取景一次
    var viewCamReady = false;       // 首次就绪后才允许落默认取景（INV-5）
    var viewEls = { maxBtn: null, resizeEl: null, viewBtns: {} };
    var viewWired = false;          // INV-4：监听器/观察者每面板实例只装一次
    var viewRO = null;

    // ============ M1：3D 工作区视图层（面板尺寸 / 相机 / 预设） ============
    // 全部状态模块私有（INV-1），只通过 window.__p3dDebug().view 只读外露（INV-7）。
    function viewRadius(n) { return 2.6 + (n - 1) * host.spacing * 0.9; }

    function ensureViewVecs() {
      if (!host.THREE) return false;
      if (!viewTarget) viewTarget = new host.THREE.Vector3(0, VIEW_TARGET_Y, 0);
      if (!viewUp) viewUp = new host.THREE.Vector3(0, 1, 0);
      return true;
    }

    // 所有夹取集中在这里：距离、极角、焦点有限性（INV-3 / AC-2「所有数值有限」）
    function clampView() {
      if (!viewTarget || !isFinite(viewTarget.x) || !isFinite(viewTarget.y) || !isFinite(viewTarget.z)) {
        if (!ensureViewVecs()) return;
        viewTarget.set(0, VIEW_TARGET_Y, 0);
      }
      if (!isFinite(viewDist)) viewDist = VIEW_MIN_DIST;
      viewDist = Math.min(VIEW_MAX_DIST, Math.max(VIEW_MIN_DIST, viewDist));
      if (!isFinite(viewPhi)) viewPhi = Math.PI / 2;
      viewPhi = Math.min(VIEW_MAX_POLAR, Math.max(VIEW_MIN_POLAR, viewPhi));
      if (!isFinite(viewTheta)) viewTheta = 0;
    }

    function applyCameraRaw() {
      var camera = host.camera;
      if (!camera || !ensureViewVecs()) return;
      var sp = Math.sin(viewPhi);
      camera.position.set(
        viewTarget.x + viewDist * sp * Math.sin(viewTheta),
        viewTarget.y + viewDist * Math.cos(viewPhi),
        viewTarget.z + viewDist * sp * Math.cos(viewTheta));
      camera.up.copy(viewUp);
      camera.lookAt(viewTarget);
      camera.updateMatrixWorld(true);
    }

    function applyCamera() { clampView(); applyCameraRaw(); }

    // 预设/复位：按 viewContract 精确落位（不走手势夹取，顶视的极角 0 是契约要求）
    function setPreset(name) {
      var camera = host.camera;
      if (!camera || !ensureViewVecs()) return;   // 也供「首次就绪落默认取景」在 ready 前置调用
      endGesture();
      var r = viewRadius(host.rigs.length || host.dancerCount() || 1);
      viewTarget.set(0, VIEW_TARGET_Y, 0);
      if (name === 'top') viewUp.set(0, 0, -1); else viewUp.set(0, 1, 0);
      var px = 0, py = VIEW_CAM_Y, pz = 0;
      if (name === 'side') px = r;
      else if (name === 'top') py = VIEW_CAM_Y + r;
      else pz = r;                                   // front / free / reset
      var ox = px - viewTarget.x, oy = py - viewTarget.y, oz = pz - viewTarget.z;
      viewDist = Math.sqrt(ox * ox + oy * oy + oz * oz) || VIEW_MIN_DIST;
      viewPhi = Math.acos(Math.min(1, Math.max(-1, oy / viewDist)));
      viewTheta = Math.atan2(ox, oz);
      viewPreset = (name === 'front' || name === 'side' || name === 'top') ? name : 'free';
      applyCameraRaw();
    }

    function doViewAction(name) {
      if (!host.ready) return;
      if (name === 'focus' || name === 'path') focusView(name === 'path'); else setPreset(name);
    }

    // 聚焦：把全部可见舞者的世界包围盒装进画面，只改距离和焦点，方向/up 不变（AC-6/AC-7）
    function focusView(includePath) {
      var camera = host.camera, THREE = host.THREE;
      if (!camera || !host.ready || !ensureViewVecs()) return;
      endGesture();
      var box = null;
      for (var i = 0; i < host.rigs.length; i++) {
        var g = host.rigs[i].group;
        if (!g || g.visible === false) continue;
        var b = new THREE.Box3().setFromObject(g);
        if (b.isEmpty()) continue;
        if (![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(isFinite)) continue;
        if (!box) box = b; else box.union(b);
      }
      if (includePath && box && window.ChoreoStageMotion && window.store) {
        host.rigs.forEach(function(r,di) {
          var base = window.ChoreoEdit.pure.placementFor(window.store.dancers,di);
          window.ChoreoStageMotion.extentPoints(window.store,di,base).forEach(function(p) {
            box.expandByPoint(new THREE.Vector3(p.x-1.2, r.baseY, p.z-1.2));
            box.expandByPoint(new THREE.Vector3(p.x+1.2, r.baseY+2, p.z+1.2));
          });
        });
      }
      if (!box) return;                    // 0 舞者：静默不动相机（AC-7）
      var c = box.getCenter(new THREE.Vector3());
      var dir = new THREE.Vector3().copy(camera.position).sub(viewTarget);
      if (dir.lengthSq() < 1e-12) dir.set(0, 0.25, 1);
      dir.normalize();
      var d = fitDistance(box, c, dir);
      viewTarget.copy(c);
      viewDist = Math.min(VIEW_MAX_DIST, Math.max(VIEW_MIN_DIST, d));
      viewPhi = Math.acos(Math.min(1, Math.max(-1, dir.y)));
      viewTheta = Math.atan2(dir.x, dir.z);
      viewPreset = 'free';
      applyCameraRaw();
    }

    // 二分/比例迭代：找一个距离，让包围盒 8 个角的 NDC 最大值落在 VIEW_PAN_FIT 附近
    function fitDistance(box, center, dir) {
      var camera = host.camera, THREE = host.THREE;
      var mn = box.min, mx = box.max, corners = [], i;
      for (i = 0; i < 8; i++) {
        corners.push(new THREE.Vector3((i & 1) ? mx.x : mn.x, (i & 2) ? mx.y : mn.y, (i & 4) ? mx.z : mn.z));
      }
      var savedPos = camera.position.clone(), savedUp = camera.up.clone();
      var d = Math.min(VIEW_MAX_DIST, Math.max(VIEW_MIN_DIST, viewDist || 2.6));
      var pt = new THREE.Vector3();
      for (var it = 0; it < 40; it++) {
        camera.position.set(center.x + dir.x * d, center.y + dir.y * d, center.z + dir.z * d);
        camera.up.copy(viewUp);
        camera.lookAt(center);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
        var m = 0;
        for (i = 0; i < 8; i++) {
          pt.copy(corners[i]).project(camera);
          if (!isFinite(pt.x) || !isFinite(pt.y)) continue;
          m = Math.max(m, Math.abs(pt.x), Math.abs(pt.y));
        }
        if (!(m > 0)) break;
        var want = m / VIEW_PAN_FIT;
        if (Math.abs(want - 1) < 0.002) break;
        var nd = Math.min(VIEW_MAX_DIST, Math.max(VIEW_MIN_DIST, d * want));
        if (nd === d) break;
        d = nd;
      }
      camera.position.copy(savedPos);
      camera.up.copy(savedUp);
      camera.updateMatrixWorld(true);
      return d;
    }

    // 可见舞者世界包围盒 + 其 8 角在当前相机下的 NDC 极值（AC-7 验收口，纯读取）
    function fitSnapshot() {
      var camera = host.camera, THREE = host.THREE;
      if (!camera || !THREE || !host.rigs.length) return { empty: true, maxAbs: 0 };
      var box = null;
      for (var i = 0; i < host.rigs.length; i++) {
        var g = host.rigs[i].group;
        if (!g || g.visible === false) continue;
        var b = new THREE.Box3().setFromObject(g);
        if (b.isEmpty() || ![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(isFinite)) continue;
        if (!box) box = b; else box.union(b);
      }
      if (!box) return { empty: true, maxAbs: 0 };
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      var m = 0, pt = new THREE.Vector3();
      for (var k = 0; k < 8; k++) {
        pt.set((k & 1) ? box.max.x : box.min.x, (k & 2) ? box.max.y : box.min.y, (k & 4) ? box.max.z : box.min.z);
        pt.project(camera);
        if (!isFinite(pt.x) || !isFinite(pt.y)) continue;
        m = Math.max(m, Math.abs(pt.x), Math.abs(pt.y));
      }
      return {
        empty: false, maxAbs: m,
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z }
      };
    }

    // 平移：相机与焦点同向等距移动 → 距离不变、方向不变（AC-4）
    function panBy(dx, dy) {
      var camera = host.camera, THREE = host.THREE;
      if (!camera) return;
      var cv = host.canvas;
      var h = cv ? (cv.clientHeight || 1) : 1;
      if (h < 1) h = 1;
      var perPx = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * viewDist / h;
      if (!isFinite(perPx)) return;
      var right = new THREE.Vector3(), upv = new THREE.Vector3(), fwd = new THREE.Vector3();
      camera.matrixWorld.extractBasis(right, upv, fwd);
      viewTarget.addScaledVector(right, -dx * perPx).addScaledVector(upv, dy * perPx);
      var lim = 1e4;
      viewTarget.set(Math.max(-lim, Math.min(lim, viewTarget.x)),
                     Math.max(-lim, Math.min(lim, viewTarget.y)),
                     Math.max(-lim, Math.min(lim, viewTarget.z)));
    }

    // ---- 面板尺寸 ----
    function clampSize(w, h) {
      var maxW = window.innerWidth - (VIEW_MARGIN * 2 + 2);   // +2 = 左右 1px 边框
      var maxH = window.innerHeight - (VIEW_MARGIN * 2 + 2);
      if (!(maxW >= VIEW_MIN_W)) maxW = VIEW_MIN_W;
      if (!(maxH >= VIEW_MIN_H)) maxH = VIEW_MIN_H;
      var nw = Math.round(w), nh = Math.round(h);
      if (!isFinite(nw)) nw = VIEW_MIN_W;
      if (!isFinite(nh)) nh = VIEW_MIN_H;
      return { w: Math.min(maxW, Math.max(VIEW_MIN_W, nw)), h: Math.min(maxH, Math.max(VIEW_MIN_H, nh)) };
    }

    function setPanelSize(w, h) {
      if (viewMax) return;
      var c = clampSize(w, h);
      viewW = c.w; viewH = c.h;
      applyPanelBounds();
      if (window.ChoreoDock) window.ChoreoDock.layout(); // P3：尺寸变了，停靠的音乐面板跟着挪
    }

    function applyPanelBounds() {
      var pn = host.panel;
      if (!pn) return;
      if (viewMax) {
        var stopBar = document.querySelector('.immediate-stop-bar');
        var top = stopBar ? Math.max(0, stopBar.getBoundingClientRect().bottom) : 0;
        pn.style.top = top + 'px';
        pn.style.width = window.innerWidth + 'px';
        pn.style.height = Math.max(1, window.innerHeight - top) + 'px';
      } else {
        pn.style.top = '';
        pn.style.width = viewW + 'px';
        pn.style.height = viewH + 'px';
      }
      host.resizeCanvas();
      if (window.ChoreoDock) window.ChoreoDock.layout(); // P3：面板边界落定后重排右下角停靠
    }

    function setMaximized(on) {
      var pn = host.panel;
      if (!pn) return;
      var want = !!on;
      if (want !== viewMax) {
        viewMax = want;
        endGesture();
        pn.classList.toggle('maximized', viewMax);
      }
      applyPanelBounds();
      syncViewControls();
      if (window.ChoreoDock) window.ChoreoDock.layout(); // P3：最大化时音乐面板回右下角，还原时再靠过来
    }

    // ---- 控件可用性/文案（AC-10：中文 title + 可访问名；未就绪时禁用） ----
    function syncViewControls() {
      var dis = !host.ready;
      var list = [viewEls.maxBtn, viewEls.resizeEl];
      for (var k in viewEls.viewBtns) list.push(viewEls.viewBtns[k]);
      list.forEach(function (el) { if (el) el.disabled = dis; });
      if (viewEls.maxBtn) {
        var t = viewMax ? '还原 3D 工作区（Esc 也可以还原）' : '最大化 3D 工作区（Esc 还原）';
        viewEls.maxBtn.title = t;
        viewEls.maxBtn.setAttribute('aria-label', t);
        viewEls.maxBtn.textContent = viewMax ? '⤡' : '⛶';
      }
      if (viewEls.resizeEl) viewEls.resizeEl.style.display = viewMax ? 'none' : '';
    }

    // ---- 手势（INV-6：同一时刻最多一个手势；第二个指针忽略） ----
    function endGesture() { viewGesture = null; }

    function onCanvasPointerDown(e) {
      if (!host.ready || !host.camera || viewGesture) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      var mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      viewGesture = { mode: mode, pointerId: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
      e.preventDefault();
    }

    function onResizePointerDown(e) {
      var pn = host.panel;
      if (!host.ready || viewMax || viewGesture || (pn && pn.classList.contains('docked'))) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      viewGesture = { mode: 'resize', pointerId: e.pointerId, x: e.clientX, y: e.clientY,
                      x0: e.clientX, y0: e.clientY, w: viewW, h: viewH };
      e.preventDefault();
    }

    function onPointerMove(e) {
      var g = viewGesture;
      if (!g || e.pointerId !== g.pointerId) return;
      var nx = isFinite(e.clientX) ? e.clientX : g.x;
      var ny = isFinite(e.clientY) ? e.clientY : g.y;
      var ddx = nx - g.x, ddy = ny - g.y;
      g.x = nx; g.y = ny;
      if (g.mode === 'resize') { setPanelSize(g.w - (nx - g.x0), g.h - (ny - g.y0)); return; }
      viewPreset = 'free';
      if (g.mode === 'orbit') { viewTheta += ddx * VIEW_ORBIT_K; viewPhi += ddy * VIEW_ORBIT_K; }
      else panBy(ddx, ddy);
      applyCamera();
    }

    function onPointerUp(e) {
      if (!viewGesture || (e && e.pointerId !== viewGesture.pointerId)) return;
      endGesture();
    }

    function onPointerCancel() { endGesture(); }

    function onCanvasWheel(e) {
      if (!host.ready || !host.camera) return;
      e.preventDefault();
      var dy = isFinite(e.deltaY) ? e.deltaY : 0;
      viewDist = viewDist * Math.exp(dy * VIEW_ZOOM_K);
      viewPreset = 'free';
      applyCamera();
    }

    // 只在画布上按下的手势才吃掉右键菜单（AC-4）
    function onCanvasContextMenu(e) { e.preventDefault(); }

    function onWindowResize() {
      if (viewMax) applyPanelBounds(); else setPanelSize(viewW, viewH);
    }

    function onKeyDown(e) {
      var pn = host.panel;
      if (e.key !== 'Escape') return;
      if (viewGesture) { endGesture(); return; }          // AC-5
      if (!viewMax) return;
      var a = document.activeElement;
      if (a === pn || (pn && a && pn.contains(a))) setMaximized(false);  // AC-3
    }

    // INV-4：这些监听器和观察者随面板实例只装一次，开关面板/改尺寸都不会重装
    function wireViewEvents() {
      var pn = host.panel, cv = host.canvas;
      if (viewWired || !pn || !cv) return;
      viewWired = true;
      cv.addEventListener('pointerdown', onCanvasPointerDown);
      cv.addEventListener('contextmenu', onCanvasContextMenu);
      cv.addEventListener('wheel', onCanvasWheel, { passive: false });
      viewEls.resizeEl.addEventListener('pointerdown', onResizePointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('blur', endGesture);
      window.addEventListener('resize', onWindowResize);
      window.addEventListener('keydown', onKeyDown);
      if (typeof ResizeObserver === 'function') {
        viewRO = new ResizeObserver(function () { host.resizeCanvas(); });
        viewRO.observe(cv);
      }
    }

    // 首次就绪才落默认取景（正视/自由同一套几何，与旧行为逐位一致）
    function ensureDefaultFraming() {
      if (viewCamReady || !host.camera || !host.THREE) return;
      viewCamReady = true;
      setPreset('free');
      if (host.ready) focusView(false); else viewDefaultPending = true;
    }

    var api = {
      viewEls: viewEls,
      endGesture: endGesture,
      setPreset: setPreset,
      focusView: focusView,
      doViewAction: doViewAction,
      setMaximized: setMaximized,
      applyPanelBounds: applyPanelBounds,
      syncViewControls: syncViewControls,
      wireViewEvents: wireViewEvents,
      fitSnapshot: fitSnapshot,
      ensureDefaultFraming: ensureDefaultFraming,
      gestureInfo: function () { return viewGesture ? { mode: viewGesture.mode, pointerId: viewGesture.pointerId } : null; }
    };
    Object.defineProperty(api, 'viewPreset', { get: function () { return viewPreset; } });
    Object.defineProperty(api, 'viewMax', { get: function () { return viewMax; } });
    Object.defineProperty(api, 'viewTarget', { get: function () { return viewTarget; } });
    Object.defineProperty(api, 'viewDefaultPending', {
      get: function () { return viewDefaultPending; },
      set: function (v) { viewDefaultPending = v; }
    });
    return api;
  }

  window.Preview3DCam = { create: create };
})();
