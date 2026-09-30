// B8 旧 2D 舞台 +Z 翻转对齐（R2 §七方向唯一约定；属主 2026-09-23 拍板「翻转对齐」，非豁免）：
// +X 屏幕右、+Z 屏幕下方＝观众侧，与主俯视图/3D 预览一致；翻转只改显示映射层，
// 持久化坐标（dancers.start / 走位·朝向轨）永不因方向工作改动。真实产品模块 + 内存 DOM；
// B8_SOURCE 指向保存的旧文件目录时可对拍红测（choreo-stage-ui.js 从那里读）。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const dir = p => path.join(process.env.B8_SOURCE || __dirname, p);

// 内存 DOM：比 b1 fixture 多 事件监听/closest/querySelectorAll/firstChild，够 openStage 全链路。
function flat(n) { return [n, ...n.children.flatMap(flat)]; }
function matches(n, q) {
  if (q[0] === '#') return n.id === q.slice(1);
  if (q[0] === '.') return String(n.className || '').split(' ').includes(q.slice(1));
  return n.tagName === q;
}
// 测试侧复合查询（产品代码只用简单选择器；测试断言用 flat 遍历避免选择器引擎）
const qAll = (root, cls, attrK, attrV) => flat(root).filter(n =>
  String(n.className || '').split(' ').includes(cls) && (!attrK || String(n.dataset && n.dataset[attrK]) === String(attrV)));
const q1 = (root, cls, attrK, attrV) => qAll(root, cls, attrK, attrV)[0] || null;
function element(tag) {
  const e = {
    tagName: tag, children: [], style: {}, dataset: {}, value: '', textContent: '', className: '', open: false, hidden: false, disabled: false,
    _ls: {},
    clientWidth: 400, clientHeight: 400, clientLeft: 0, clientTop: 0,
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); this.children.push(n); n.parentNode = this; return n; },
    removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; return n; },
    get firstChild() { return this.children[0] || null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    querySelector(q) { return flat(this).find(n => matches(n, q)) || null; },
    querySelectorAll(q) { return flat(this).filter(n => matches(n, q)); },
    closest(q) { let n = this; while (n) { if (matches(n, q)) return n; n = n.parentNode; } return null; },
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) { (this._ls[t] || []).forEach(fn => fn(Object.assign({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, setPointerCapture() {} }, ev))); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {},
  };
  return e;
}
function fixture(count) {
  const body = element('body'), calls = [], toasts = [], history = [];
  const store = {
    projectId: 'b8-flip', currentTime: 3, selectedDancer: 0, pps: 60, isPlaying: false, globalLyrics: [], markers: [],
    dancers: Array.from({ length: count }, (_, i) => ({ id: i + 1, name: '舞者' + (i + 1), start: { x: 0, z: 0, yawDeg: 0 }, actionClips: [], switchClips: [], lyricClips: [] })),
    contentExtra: { _doc: { extraTracks: [] } },
  };
  const ctx = {
    store, history, toasts,
    document: {
      body, createElement: element, createElementNS: (ns, tag) => element(tag),
      getElementById: id => flat(body).find(n => n.id === id) || null,
      querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
      get activeElement() { return null; }, contains: () => true,
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    saveHistory() { history.push(1); }, render() {}, showToast: m => toasts.push(m), refreshWorkbenchBars() {},
    addEventListener() {}, removeEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['choreo-edit.js', 'choreo-stage-motion.js', 'choreo-stage-ui.js']) {
    vm.runInContext(fs.readFileSync(dir(f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, store, body, history, toasts };
}
// 400×400 舞台表面（element 默认尺寸即 400×400，openStage 初始刷新即可用）。
function openStageWith(f) {
  assert.equal(f.ctx.ChoreoStageUI.openStage(null), true);
  const bg = f.ctx.document.getElementById('stageDragModal');
  const surface = bg.querySelector('#stageSurface');
  return { bg, surface };
}
const num = s => parseFloat(String(s).replace(/px$/, ''));
let pass = 0, fail = 0;
function test(n, fn) { try { fn(); console.log('PASS ' + n); pass++; } catch (e) { fail++; console.log('FAIL ' + n + '\n' + e.stack); } }

// ---------- 翻转后方向约定（红基线：当前 +Z 向上） ----------
test('FLIP-1 +Z 画在屏幕下方（z=+4 舞者 DOM top 大于 z=-4）', () => {
  const f = fixture(2); f.store.dancers[0].start = { x: 0, z: 4, yawDeg: 0 }; f.store.dancers[1].start = { x: 0, z: -4, yawDeg: 0 };
  const { bg } = openStageWith(f);
  const m0 = q1(bg, 'stage-marker', 'di', 0), m1 = q1(bg, 'stage-marker', 'di', 1);
  assert.ok(num(m0.style.top) > num(m1.style.top), `z=+4 应在 z=-4 下方：top0=${m0.style.top} top1=${m1.style.top}`);
});
test('FLIP-2 朝向箭头角度＝镜像口径（yaw0→rotate(180deg)、yaw90→90、yaw180→0）', () => {
  const f = fixture(3);
  f.store.dancers[0].start.yawDeg = 0; f.store.dancers[1].start.yawDeg = 90; f.store.dancers[2].start.yawDeg = 180;
  const { bg } = openStageWith(f);
  const a0 = q1(q1(bg, 'stage-marker', 'di', 0), 'stage-arrow');
  const a1 = q1(q1(bg, 'stage-marker', 'di', 1), 'stage-arrow');
  const a2 = q1(q1(bg, 'stage-marker', 'di', 2), 'stage-arrow');
  assert.equal(a0.style.transform, 'rotate(180deg)');
  assert.equal(a1.style.transform, 'rotate(90deg)');
  assert.equal(a2.style.transform, 'rotate(0deg)');
});
test('FLIP-3 yaw 卫星手柄在朝向侧（yaw0 手柄中心在标记中心下方 26px）', () => {
  const f = fixture(1); f.store.dancers[0].start = { x: 0, z: 0, yawDeg: 0 };
  const { bg } = openStageWith(f);
  const mk = q1(bg, 'stage-marker', 'di', 0), yh = q1(bg, 'stage-yaw', 'di', 0);
  const dy = (num(yh.style.top) + 9) - (num(mk.style.top) + 14);   // 手柄 18px/标记 28px → 各取中心
  assert.ok(Math.abs(dy - 26) < 1.5, `手柄中心应在标记中心下方 26px，实测 ${dy}`);
});
test('FLIP-4 方向文案如实（比例行与 aria-label 均为 +Z 向下＝观众席侧）', () => {
  const f = fixture(1);
  const { bg, surface } = openStageWith(f);
  const scale = bg.querySelector('.stage-scale');
  assert.ok(scale.textContent.includes('+Z 向下'), '比例行应说明 +Z 向下（观众席侧）：' + scale.textContent);
  assert.ok(String(surface['aria-label']).includes('+Z 向下'), 'surface aria-label：' + surface['aria-label']);
  assert.ok(!scale.textContent.includes('+Z 向上'));
});
// ---------- 事件→世界映射（翻转只改显示层；写库值按翻转几何） ----------
test('FLIP-5 x/z 拖拽释放按翻转映射写库（DOM 下侧＝+Z），一次 saveHistory', () => {
  const f = fixture(1);
  const { bg, surface } = openStageWith(f);
  const CE = f.ctx.ChoreoEdit.pure, t = bg._transform;
  const mk = q1(bg, 'stage-marker', 'di', 0);
  mk.dispatch('pointerdown', { pointerId: 1, clientX: 150, clientY: 140 });
  assert.ok(bg._pending && bg._pending.kind === 'xz');
  bg._onMove({ pointerId: 1, clientX: 120, clientY: 100 });           // 拖到表面左上（DOM 上侧）
  bg._onUp({ pointerId: 1, clientX: 120, clientY: 100 });
  const syCE = t.viewH - 100, wCE = CE.stageScreenToWorld(120, syCE, t);  // DOM(120,100)＝CE(120,300)
  const s = f.store.dancers[0].start;
  assert.equal(s.x, CE.quantStage(wCE.x));
  assert.equal(s.z, CE.quantStage(wCE.z));
  assert.ok(s.z < 0, `DOM 上侧应为 -Z，实测 z=${s.z}`);
  assert.equal(f.history.length, 1, '单事务一次撤销');
});
test('FLIP-6 朝向拖拽：手柄拖到标记正下方＝+Z＝yaw 0（红基线为 180）', () => {
  const f = fixture(1); f.store.dancers[0].start = { x: 0, z: 0, yawDeg: 90 };   // 起始 90°：拖到 0° 才有真实变更
  const { bg } = openStageWith(f);
  const mk = q1(bg, 'stage-marker', 'di', 0), yh = q1(bg, 'stage-yaw', 'di', 0);
  const cx = num(mk.style.left) + 14, cy = num(mk.style.top) + 14;
  yh.dispatch('pointerdown', { pointerId: 2, clientX: cx, clientY: cy });
  bg._onMove({ pointerId: 2, clientX: cx, clientY: cy + 60 });
  const ga = q1(bg, 'stage-ghost-arrow');
  bg._onUp({ pointerId: 2, clientX: cx, clientY: cy + 60 });
  assert.equal(Math.round(f.store.dancers[0].start.yawDeg), 0, '屏幕正下方＝观众席＝yaw 0');
  assert.equal(f.history.length, 1);
  assert.ok(ga, 'ghost 箭头在场');
});
test('FLIP-7 纯打开/刷新零写入（持久化坐标不因方向工作改动）', () => {
  const f = fixture(2);
  f.store.dancers[1].start = { x: 3, z: -2, yawDeg: 45 };
  f.ctx.ChoreoStageMotion.install(f.store, f.ctx.ChoreoStageMotion.edit(f.store, 1, { movement: [{ time: '2', x: '1', z: '3' }], facing: [{ time: '4', yaw: '90' }] }, 'b8-flip-7'));
  const snap = JSON.stringify({ d: f.store.dancers, x: f.store.contentExtra });
  const { bg } = openStageWith(f);
  bg._onResize(); bg._onResize();                                   // 刷新走 transform 重算路径
  assert.equal(JSON.stringify({ d: f.store.dancers, x: f.store.contentExtra }), snap);
  assert.equal(f.history.length, 0);
});
test('FLIP-8 路径层翻转（z=+3 节点画在起点下方；折线 y 坐标同口径）', () => {
  const f = fixture(1);
  f.ctx.ChoreoStageMotion.install(f.store, f.ctx.ChoreoStageMotion.edit(f.store, 0, { movement: [{ time: '2', x: '0', z: '3' }], facing: [] }, 'b8-flip-8'));
  const { bg, surface } = openStageWith(f);
  const tgl = q1(bg, 'stage-pathtoggle'); tgl.onclick();
  const node = q1(bg, 'stage-pathnode', 'idx', 0);
  const org = q1(bg, 'stage-origin');
  assert.ok(num(node.style.top) > num(org.style.top), `z=+3 节点应在原点(0,0)下方：node=${node.style.top} org=${org.style.top}`);
  const pts = bg._pathPoly.getAttribute('points').split(' ').map(p => p.split(',').map(Number));
  assert.ok(pts[1][1] > pts[0][1], `折线第二点(z=+3)应在第一点(起点 z=0)下方：${bg._pathPoly.getAttribute('points')}`);
});
// ---------- 既有能力面（翻转不得破坏） ----------
test('KEEP-1 起始位/朝向纯函数与主俯视图投影不受翻转影响（CE 旧约定保持）', () => {
  const CE = fixture(1).ctx.ChoreoEdit.pure;
  const t = CE.computeStageTransform(400, 400, [{ x: -4, z: -4 }, { x: 4, z: 4 }]);
  const up = CE.stageWorldToScreen(0, 4, t), down = CE.stageWorldToScreen(0, -4, t);
  assert.ok(up.sy < down.sy, 'CE 纯层保持旧约定（+Z 屏幕上）——翻转只在 stage-ui 显示层');
});
test('KEEP-2 主俯视图（workbench）+Z 约定不被本批触碰（源码级）', () => {
  const wb = fs.readFileSync(path.join(process.env.B8_SOURCE || __dirname, 'choreo-workbench.js'), 'utf8');
  assert.ok(wb.includes('观众席'), '主俯视图常驻方向标注仍在（B6）');
  assert.ok(!wb.includes('stageDomY'), '翻转助手不进 workbench');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
