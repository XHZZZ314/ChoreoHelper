// 工作台回归：执行真实控制器重绘，界面变化不得伪造编舞内容变化。
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const app = fs.readFileSync((process.env.CHOREO_UI_SOURCE || __dirname) + '/choreo-app.js', 'utf8');
// OVERHAUL 批 C 第六步迁移：render/renderToolbar/ChoreoDock/toolbarMenu/toggleMusicPanel 已随
// RENDER 外壳搬到 choreo-app-render.js——涉面切片改读拆分件；CHOREO_UI_SOURCE 指旧目录时仍读
// 旧 choreo-app.js（旧树这些函数在主件），对拍红测语义不变。保留区函数仍从主件切片。
const renderApp = process.env.CHOREO_UI_SOURCE ? app : fs.readFileSync((process.env.CHOREO_UI_SOURCE || __dirname) + '/choreo-app-render.js', 'utf8');
const root = { appendChild() {}, innerHTML: '' };
const ctx = {
  store: { appReady: true, _tlRev: 7 }, window: {},
  document: { getElementById: id => id === 'root' ? root : null, querySelector: () => null },
  ChoreoGroupMove: { refresh() {} }, el: () => ({ appendChild() {} }),
  timelineWindow: () => ({}), renderToolbar: () => ({}), renderSidebar: () => ({}),
  renderTimelineArea: () => ({}), renderMacroPanel: () => ({}), renderBottomBar: () => ({}),
  renderRuler() {}, updatePlayhead() {}, updateTimeDisplay() {}, _applySideOpen() {},
  scheduleRealtimeCheck() {}, updateCheckBadge() {}
};
vm.createContext(ctx);
vm.runInContext(renderApp.slice(renderApp.indexOf('function render(){'), renderApp.indexOf('function renderToolbar(){')), ctx);
ctx.render(); ctx.render();
assert.equal(ctx.store._tlRev, 7, '仅重绘界面不得递增 3D 内容版本');
console.log('workspace: view-only render preserves timeline revision');

// 真实内容提交 / 撤销 / 重做仍推进版本，界面重绘不影响撤销栈。
function fn(name) { const a=app.indexOf('function '+name+'('); return app.slice(a,app.indexOf('\nfunction ',a+1)); }
function fnR(name) { const a=renderApp.indexOf('function '+name+'('); return renderApp.slice(a,renderApp.indexOf('\nfunction ',a+1)); }
ctx.store.dancers=[{actionClips:[]}]; ctx.store.globalLyrics=[]; ctx.store.markers=[];
ctx.store.history=[];ctx.store.historyIdx=-1;ctx.store._tlRevision=1;ctx.store.previewTarget='web';
ctx.persistProject=()=>{};ctx.updateTotalDuration=()=>{};
for(const name of ['bumpTimelineRev','saveHistory','undo','redo'])vm.runInContext(fn(name),ctx);
ctx.saveHistory();assert.equal(ctx.store._tlRev,8);
ctx.store.dancers[0].actionClips.push({id:'a',start:1,duration:2});ctx.saveHistory();
assert.equal(ctx.store._tlRev,9);ctx.undo();assert.equal(ctx.store._tlRev,10);
assert.equal(ctx.store.dancers[0].actionClips.length,0);ctx.redo();assert.equal(ctx.store._tlRev,11);
assert.equal(ctx.store.dancers[0].actionClips.length,1);
ctx.ChoreoDocWire={loadProjection:()=>({proj:{dancers:[{actionClips:[]}],globalLyrics:[]},rev:4}),unknownTopKeys:()=>({})};
ctx.recalcNextClipId=()=>{};
vm.runInContext(fn('applyProjectContent'),ctx);ctx.applyProjectContent({});
assert.equal(ctx.store._tlRev,12);assert.equal(ctx.store._docRev,4);
console.log('workspace: edit/undo/redo still invalidate 3D contents');

// 使用具有移动语义的 DOM 替身执行真实 toolbar/dock，验证节点与功能没有因收纳丢失。
class Element {
  constructor(tag,cls='',text='') { this.tagName=tag;this.className=cls;this.textContent=text;this.children=[];this.style={};this.moves=0; }
  get classList(){const self=this;return {
    contains(c){return self.className.split(' ').includes(c)},
    add(c){this.toggle(c,true)},
    toggle(c,on){let a=self.className.split(' ').filter(Boolean);a=a.filter(x=>x!==c);if(on)a.push(c);self.className=a.join(' ')}
  }}
  appendChild(n){if(n.parentNode)n.parentNode.removeChild(n);n.parentNode=this;this.children.push(n);n.moves++;return n}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;return n}
  addEventListener(){}
  get firstChild(){return this.children[0]||null}
  setAttribute(k,v){this[k]=v}
}
const elements={}, ui={...ctx,window:{ChoreoDock:{floating:false}},el:(...args)=>new Element(...args),
  document:{body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>elements[id]||null,addEventListener(){}},
  gameActorIdx:()=>0,fmtTime:()=> '00:00',updatePlaybackButton(){},
  store:{appReady:true,dancers:[{name:'舞者1'}],dancerCount:1,speed:1,history:[],historyIdx:0,previewTarget:'web'},
  localStorage:{setItem(){}},calls:[]};
// P4-B 旧↔新：旧列表含 toggleFilePop；新=「📂 文件」菜单收编进项目中心，函数已移除。
// P4-C 旧↔新：旧列表含 toggleAdvPop（⋯ 高级弹层）与资源/视图菜单内按钮（资料库/录制/双人直连）；
// 新=顶栏「工具」1 击直达工具中心（showToolsCenter），高级 6 项与资料库/录制/双人面在分页内，
// 顶栏只留工具/2D 舞台/音乐/歌词直达入口。
for(const name of ['togglePlay','stopPlay','switchPreviewTarget','toggleSidebar','undo','redo','showCheckModal','showLyricsModal','showToolsCenter','showProjectModal','probeGame','setDancerCount'])
  ui[name]=()=>ui.calls.push(name);
vm.createContext(ui);
let windowRefreshes=0;ui.markWindowDirty=()=>windowRefreshes++;
vm.runInContext(fnR('toggleMusicPanel')+'\n'+fnR('toolbarMenu')+ '\n'+fnR('renderToolbar'),ui);
const toolbar=ui.renderToolbar();
function all(n){return [n,...n.children.flatMap(all)]}
const nodes=all(toolbar), buttons=nodes.filter(n=>n.tagName==='button');
// B8 旧↔新：旧列表含「2D 舞台」；新行为=旧 2D 舞台降级进工具中心·高级工具页（R1 批 B8/§3 专家入口），
// 顶栏不再承担该日常入口。
for(const label of ['网页播放','游戏演出','工具','歌词','3D预览','音乐','属性'])
  assert(buttons.some(n=>n.textContent.includes(label)), '保留入口: '+label);
// P4-C 旧↔新：资料库/录制/双人直连/高级不再平铺在顶栏（菜单与按钮收编进工具中心），
// 工具中心分页内 1 击可达；歌词按范围决定保持顶栏 1 击。
for(const label of ['资料库','录制动作','双人直连','⋯ 高级'])
  assert(!buttons.some(n=>n.textContent.includes(label)), 'P4-C：旧菜单入口已收编，不再平铺: '+label);
assert(!buttons.some(n=>n.textContent.includes('2D 舞台')), 'B8：2D 舞台已降级进高级工具页，不再平铺顶栏');
assert(!nodes.some(n=>n.className&&String(n.className).includes('toolbar-menu')&&/资源|视图/.test(all(n).map(x=>x.textContent).join(''))),'P4-C：资源/视图菜单已移除');
// B8 旧↔新：旧断言要求 stageBtn 在顶栏；新行为=stageBtn 移至 buildAdvancedToolsPage（高级工具页）。
for(const id of ['playBtn','propBtn','toolsBtn','musicBtn','btnCheck'])assert.equal(nodes.filter(n=>n.id===id).length,1,id);
assert(!nodes.some(n=>n.id==='stageBtn'),'B8：stageBtn 已移至工具中心·高级工具页，不在顶栏');
// P4-B 旧↔新：旧断言要求 fileBtn 存在；新行为=「📂 文件」菜单收编进项目中心，顶栏不再有 fileBtn。
assert(!nodes.some(n=>n.id==='fileBtn'),'P4-B：文件按钮已收编，不应再出现 fileBtn');
// P4-C 旧↔新：旧断言要求 advBtn 存在；新行为=「⋯ 高级」收编进工具中心高级工具页，顶栏不再有 advBtn。
assert(!nodes.some(n=>n.id==='advBtn'),'P4-C：高级按钮已收编，不应再出现 advBtn');
buttons.find(n=>n.textContent.includes('工具')).onclick();assert.deepEqual(ui.calls,['showToolsCenter']);
assert.equal(toolbar.children.length,2,'导航和播放两组');
for(const width of [606,909,1000,1400]){
  ui.window.innerWidth=width;
  const responsive=ui.renderToolbar(),row=responsive.children[1],descendants=all(responsive);
  for(const label of ['网页播放','游戏演出'])assert(row.children.some(n=>n.textContent.includes(label)),'主操作始终直接可见 '+label);
  const settings=row.children.find(n=>n.className.includes('rehearsal-settings'));
  assert.equal(!!settings,width<=1000,'仅窄屏收纳设置');
  if(settings){assert(all(settings).some(n=>n.textContent.includes('3D预览')));assert(all(settings).some(n=>n.tagName==='input'&&n.type==='range'),'保留速度控制');}
  assert.equal(descendants.filter(n=>n.id==='playBtn').length,1,'不得复制播放入口');
}
ui.window.innerWidth=1400;
ui.store.dancerCount=3;ui.window.confirm=()=>false;
buttons.find(n=>n.textContent==='1').onclick();assert.deepEqual(ui.calls,['showToolsCenter'],'取消减员不改编排');
ui.window.confirm=()=>true;buttons.find(n=>n.textContent==='1').onclick();assert.equal(ui.calls.at(-1),'setDancerCount');
vm.runInContext(renderApp.slice(renderApp.indexOf('window.ChoreoDock={'), renderApp.indexOf('function toolbarMenu(')),ui);
for(const id of ['editorFrame','musicDock','previewDock','musicPanel','p3dPanel'])elements[id]=new Element('div');
elements.p3dPanel.classList.add('open');
ui.window.ChoreoDock.layout();
assert.equal(elements.musicPanel.parentNode,elements.musicDock);
assert.equal(elements.p3dPanel.parentNode,elements.previewDock);
for(let i=0;i<100;i++)ui.window.ChoreoDock.layout();
assert.equal(elements.musicPanel.moves,1,'布局刷新不反复拆卸音频');
assert.equal(elements.p3dPanel.moves,1,'布局刷新不反复拆卸3D');
assert(elements.editorFrame.classList.contains('preview-open'));
assert.equal(windowRefreshes,1,'打开预览仅请求一次窗口刷新');
elements.p3dPanel.classList.toggle('open',false);ui.window.ChoreoDock.layout();
assert(!elements.editorFrame.classList.contains('preview-open'));
assert.equal(windowRefreshes,2,'关闭预览补齐变宽的时间轴');
ui.ChoreoDock=ui.window.ChoreoDock;ui.toggleMusicPanel();assert(!elements.editorFrame.classList.contains('music-open'));
ui.toggleMusicPanel();assert(elements.editorFrame.classList.contains('music-open'));
ui.ChoreoDock.floating=true;ui.ChoreoDock.layout();
assert.equal(elements.p3dPanel.parentNode,ui.document.body);assert(!elements.p3dPanel.classList.contains('docked'));
ui.ChoreoDock.floating=false;ui.ChoreoDock.layout();
assert.equal(elements.p3dPanel.parentNode,elements.previewDock);assert(elements.p3dPanel.classList.contains('docked'));
console.log('workspace: toolbar reachability, stable media docking and visibility passed');
