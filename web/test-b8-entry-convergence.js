// B8 入口收敛（R1 批 B8＋§3）：走位入口收敛为「主俯视图直拖＋就地编辑」双日常入口；
// 旧浮窗/旧 2D 舞台降级为专家入口（能力不删、不再承担日常任务）。
// 断言面：①顶栏不再有 2D 舞台按钮（renderToolbar 真执行）；②工具中心「高级工具」页收编该入口
// 且接线同一 openStage（能力不删）；③走位轨 lane 的旧浮窗直达按钮如实标注「旧版浮窗」。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const srcDir = process.env.B8_SOURCE || __dirname;
const app = fs.readFileSync(path.join(srcDir, 'choreo-app.js'), 'utf8');
// OVERHAUL 批 C 第六步迁移：render/renderToolbar/buildAdvancedToolsPage/toggleMusicPanel/toolbarMenu
// 已随 RENDER 外壳搬到 choreo-app-render.js——涉面切片与 vm 源改读拆分件；B8_SOURCE 指向旧文件
// 目录时仍读旧 choreo-app.js（旧树这些函数在主件），对拍红测语义不变。
const renderApp = process.env.B8_SOURCE ? app : fs.readFileSync(path.join(srcDir, 'choreo-app-render.js'), 'utf8');
const motionUi = fs.readFileSync(path.join(srcDir, 'choreo-stage-motion-ui.js'), 'utf8');

let pass = 0, fail = 0;
function test(n, fn) { try { fn(); console.log('PASS ' + n); pass++; } catch (e) { fail++; console.log('FAIL ' + n + '\n' + e.stack); } }

// renderToolbar 真执行 harness（沿 test-ui-workspace.js 先例）
class Element {
  constructor(tag, cls = '', text = '') { this.tagName = tag; this.className = cls; this.textContent = text; this.children = []; this.style = {}; }
  get classList() { const self = this; return { contains: c => self.className.split(' ').includes(c), add(c) { this.toggle(c, true); }, toggle(c, on) { let a = self.className.split(' ').filter(Boolean).filter(x => x !== c); if (on) a.push(c); self.className = a.join(' '); } }; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; return n; }
  addEventListener() { }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this[k] = v; }
}
const elements = {};
const ctx = {
  store: { appReady: true, _tlRev: 7 }, window: {},
  document: { getElementById: id => id === 'root' ? { appendChild() { }, innerHTML: '' } : null, querySelector: () => null },
  ChoreoGroupMove: { refresh() { } }, el: (...args) => new Element(...args),
  timelineWindow: () => ({}), renderToolbar: () => ({}), renderSidebar: () => ({}), renderTimelineArea: () => ({}),
  renderMacroPanel: () => ({}), renderBottomBar: () => ({}), renderRuler() { }, updatePlayhead() { }, updateTimeDisplay() { }, _applySideOpen() { },
  scheduleRealtimeCheck() { }, updateCheckBadge() { },
};
vm.createContext(ctx);
vm.runInContext(renderApp.slice(renderApp.indexOf('function render(){'), renderApp.indexOf('function renderToolbar(){')), ctx);
function fn(name) { const a = renderApp.indexOf('function ' + name + '('); return renderApp.slice(a, renderApp.indexOf('\nfunction ', a + 1)); }
const ui = {
  ...ctx, window: { ChoreoDock: { floating: false } },
  document: { body: new Element('body'), createElement: tag => new Element(tag), getElementById: id => elements[id] || null, addEventListener() { } },
  gameActorIdx: () => 0, fmtTime: () => '00:00', updatePlaybackButton() { },
  store: { appReady: true, dancers: [{ name: '舞者1' }], dancerCount: 1, speed: 1, history: [], historyIdx: 0, previewTarget: 'web' },
  localStorage: { setItem() { } }, calls: [],
};
for (const name of ['togglePlay', 'stopPlay', 'switchPreviewTarget', 'toggleSidebar', 'undo', 'redo', 'showCheckModal', 'showLyricsModal', 'showToolsCenter', 'showProjectModal', 'probeGame', 'setDancerCount', 'toggleMusicPanel', 'showProjectModal']) ui[name] = () => ui.calls.push(name);
vm.createContext(ui);
vm.runInContext(fn('toggleMusicPanel') + '\n' + fn('toolbarMenu') + '\n' + fn('renderToolbar'), ui);
function all(n) { return [n, ...n.children.flatMap(all)]; }

// ---------- ENT-1 顶栏收敛：2D 舞台不再承担日常入口 ----------
test('ENT-1 顶栏无「2D 舞台」按钮（B8 旧↔新：旧断言要求在场，新=降级为专家入口）', () => {
  const toolbar = ui.renderToolbar();
  const buttons = all(toolbar).filter(n => n.tagName === 'button');
  assert.ok(!buttons.some(n => n.textContent.includes('2D 舞台')), '顶栏不应再有 2D 舞台日常入口');
  assert.ok(!all(toolbar).some(n => n.id === 'stageBtn'), 'stageBtn 不在顶栏');
});
// ---------- ENT-2 高级工具页收编（能力不删、接线同一 openStage） ----------
test('ENT-2 工具中心·高级工具页收编 2D 舞台入口（同一 openStage 接线＋专家标注）', () => {
  const advIdx = renderApp.indexOf('function buildAdvancedToolsPage');
  const adv = renderApp.slice(advIdx, renderApp.indexOf('\nfunction ', advIdx + 10));   // 只取该函数体
  assert.ok(adv.includes("id='stageBtn'"), 'stageBtn 落在高级工具页');
  assert.ok(adv.includes('ChoreoStageUI.openStage'), '同一 openStage 接线（能力不删）');
  assert.ok(adv.includes('专家'), '入口标注专家性质');
  const tbIdx = renderApp.indexOf('function renderToolbar');
  const tb = renderApp.slice(tbIdx, renderApp.indexOf('\nfunction ', tbIdx + 10));
  assert.ok(!tb.includes("'2D \\u821E\\u53F0'") && !tb.includes("'2D 舞台'"), '工具栏构建段不再创建 2D 舞台按钮');
});
// ---------- ENT-3 旧浮窗直达按钮如实标注（lane 内「＋编排路径节点」开的是旧版浮窗） ----------
test('ENT-3 走位轨 lane 旧浮窗直达按钮标注「旧版浮窗」（语义零变化，仅如实标注）', () => {
  const lane = motionUi.slice(motionUi.indexOf('function lane('));
  const btn = lane.slice(0, lane.indexOf('function') + 2000);
  assert.ok(/button\('＋[^']*旧版浮窗[^']*'/.test(lane), 'lane 按钮文案含「旧版浮窗」标注');
  assert.ok(lane.includes('open(di)'), '接线不变（仍开旧版浮窗）');
});
// ---------- ENT-4 双日常入口在位（既有能力锚点，不得因收敛回退） ----------
test('ENT-4 双日常入口锚点在位：主俯视图节点直拖（workbench）＋就地编辑（motion-ui 会话栏）', () => {
  const wb = fs.readFileSync(path.join(srcDir, 'choreo-workbench.js'), 'utf8');
  assert.ok(wb.includes('topMouseDown'), '主俯视图直拖在位（B4）');
  assert.ok(motionUi.includes('selectMotion') && motionUi.includes('wbMotionApply'), '就地编辑会话栏在位（P3/B3）');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
