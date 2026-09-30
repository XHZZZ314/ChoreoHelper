// B4 主俯视图节点直拖（含行内微调）：真实 UI/引擎/编辑模块与隔离 DOM；浏览器可用性另验（不冒充）。
// 覆盖：拖动/行内微调一律改草稿（表 B S1→S2、S2 内不落库、S3 禁止）；拖动期冻结画布变换；
// 释放后未应用计数/3D 已保存值标注常驻；选中身份（对象引用）与删除预告共存；应用一次提交回 S1、
// 取消重取 baseline 会话保持；0.01 米量化与回原量化点零改动；播放中拒绝；8 舞者只动会话舞者。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
// B4_SOURCE 指向保存的旧文件目录时可对拍红测（workbench 与 stage-motion-ui 都从那里读）。
vm.runInContext(base.replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B4_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B4_SOURCE,n)")+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const wbSrc=()=>fs.readFileSync(path.join(process.env.B4_SOURCE||__dirname,'choreo-workbench.js'),'utf8');
const tableInput=(f,label)=>sandbox.flatten(f.host).find(n=>n['aria-label']===label);
const rowOf=n=>{for(let p=n&&n.parentNode;p;p=p.parentNode)if(p.tag==='tr')return p;return null};

// 记录型 document 监听：让 workbench 拖动接线（mousemove/mouseup）可被测试驱动。
function wire(f){const L=f._L={};f.ctx.document.addEventListener=(t,fn)=>{(L[t]=L[t]||[]).push(fn)};f.ctx.document.removeEventListener=(t,fn)=>{L[t]=(L[t]||[]).filter(x=>x!==fn)};return f}
// 载入 workbench 并暴露 __topMouseDown（与 B1 的 __topClick 同法，产品面不变）。
function dragWorkbench(f){
  vm.runInContext(wbSrc().replace('var api = {','globalThis.__topClick=topClick;globalThis.__topMouseDown=topMouseDown; var api = {'),f.ctx,{filename:'choreo-workbench.js'});
  return f.ctx.ChoreoWorkbench;
}
// 世界坐标 → 画布客户端坐标（与 topWorldAt 同一映射；夹具画布 400×400 无边框）。
function atWorld(f,x,z){const t=f.ctx.ChoreoWorkbench.topViewTransform();return {button:0,clientX:t.w/2+x*t.sc,clientY:t.h/2+z*t.sc,preventDefault(){}}}

// ---------- 1. 拖动＝改草稿（S1→S2 不落库）；画布即时变形；释放后未应用计数/3D 标注/数值表一致 ----------
test('B4-1 drag edits draft only: no store write, canvas deforms live, node identity kept',()=>{
 const f=wire(sandbox.makeFixture(2));f.setPath([[2,0,0],[4,4,4],[6,8,0]]);f.UI.selectMotion(0);f.mount();
 const w=dragWorkbench(f);w.drawTop();const saved=JSON.stringify(f.store);
 assert.equal(f.UI.nodeAt(4,4,.3),1,'节点手柄命中（会话舞者）');
 assert.equal(f.UI.nodeAt(9,9,.3),-1,'空白处不命中');
 assert.equal(f.UI.dragNodeStart(1).ok,true);
 assert.equal(JSON.stringify(f.store),saved,'拖起/拖动零落库');
 const sel=f.UI.selectionDetail()[0];assert.equal(sel.level,'node');assert.equal(sel.nodeIndex,1);assert.equal(sel.node.x,'4');
 f.calls.length=0;assert.equal(f.UI.dragNodeMove(5,5),true);
 const d=f.UI.selectionDetail()[0];assert.equal(d.node.x,'5','选中身份（草稿对象引用）随就地改动同步');
 const tr=w.topViewTransform();
 assert.ok(f.calls.some(c=>c.op==='lineTo'&&Math.abs(c.args[0]-(tr.w/2+5*tr.sc))<1e-6&&Math.abs(c.args[1]-(tr.h/2+5*tr.sc))<1e-6),'拖动期间草稿实时画线（画布即时变形）');
 assert.equal(JSON.stringify(f.store),saved,'拖动零落库');
 assert.equal(f.UI.dragNodeEnd().moved,true);
 f.mount();
 assert.match(f.find('wbMotionDirty').textContent,/未应用 1 处/,'释放后未应用计数');
 assert.match(f.find('wbMotion3dNote').textContent,/已保存值/,'3D 已保存值标注');
 assert.match(f.find('wbMotion3dNote').textContent,/应用后同步/);
 assert.equal(tableInput(f,'路径节点2 X 米').value,'5','数值表与拖动同草稿');
 assert.equal(f.history.length,0,'未应用前零历史');
 assert.equal(JSON.stringify(f.store),saved,'释放后仍零落库');
});

// ---------- 2. 指针接线＋拖动期冻结变换＋释放解冻＋click 抑制 ----------
test('B4-1 pointer wiring freezes canvas transform during drag, unfreezes on release',()=>{
 const f=wire(sandbox.makeFixture());f.setPath([[4,4,4]]);f.UI.selectMotion(0);f.mount();
 const w=dragWorkbench(f);w.drawTop();const tr0=w.topViewTransform();
 f.ctx.__topMouseDown(atWorld(f,4,4));
 assert.ok(f._L.mousemove&&f._L.mousemove.length===1&&f._L.mouseup&&f._L.mouseup.length===1,'拖动监听接线');
 f.top.clientWidth=800;f.top.clientHeight=800; // 拖动中宿主尺寸变化：不得重拟合
 f._L.mousemove[0](atWorld(f,5,5));w.drawTop();
 assert.equal(w.topViewTransform().w,400,'拖动期间画布变换冻结（sc/w/h 不变）');
 assert.equal(w.topViewTransform().sc,tr0.sc);
 f.mount();assert.equal(tableInput(f,'路径节点1 X 米').value,'5');
 f._L.mouseup[0]({});
 f.mount();assert.match(f.find('wbMotionDirty').textContent,/未应用 1 处/);
 w.drawTop();assert.equal(w.topViewTransform().w,800,'释放后恢复自适应（解冻）');
 const st1=f.UI.sessionState().status;
 f.ctx.__topClick(atWorld(f,5,5)); // 释放点紧随的 click：已由节点手势处理，不得重复选点
 assert.equal(f.UI.sessionState().status,st1,'紧随 click 被吞掉（不覆盖拖动状态）');
});

// ---------- 3. 回原量化点零改动；0.01 米量化 ----------
test('B4 quantization: release at original quantized point is a no-op, 0.01 m grid',()=>{
 const f=sandbox.makeFixture();f.setPath([[4,4,4]]);f.UI.selectMotion(0);f.mount();
 assert.equal(f.UI.dragNodeStart(0).ok,true);
 f.UI.dragNodeMove(4.004,4.004); // 量化回原点（4.00,4.00）
 assert.equal(f.UI.dragNodeEnd().moved,false);
 f.mount();assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致','回原量化点＝零改动（S1）');
 const g=sandbox.makeFixture();g.setPath([[4,4,4]]);g.UI.selectMotion(0);g.mount();
 g.UI.dragNodeStart(0);g.UI.dragNodeMove(4.567,4);
 assert.equal(g.UI.dragNodeEnd().moved,true);
 g.mount();assert.equal(tableInput(g,'路径节点1 X 米').value,'4.57','按 0.01 米量化');
 assert.match(g.find('wbMotionDirty').textContent,/未应用 1 处/);
});

// ---------- 4. 应用＝整份草稿一次 P.edit+install+saveHistory 回 S1；取消＝重取 baseline 会话保持 ----------
test('B4-2 apply commits the whole draft once back to S1; re-apply is a no-op',()=>{
 const f=sandbox.makeFixture();f.setPath([[2,0,0],[4,4,4],[6,8,0]]);f.UI.selectMotion(0);f.mount();
 let inp=tableInput(f,'路径节点1 X 米');inp.value='3';inp.oninput({target:inp}); // 行内微调（S2，同草稿）
 f.UI.dragNodeStart(2);f.UI.dragNodeMove(9,1);f.UI.dragNodeEnd(); // 拖另一节点
 f.mount();
 assert.match(f.find('wbMotionDirty').textContent,/未应用 2 处/,'行内微调＋拖动同一份草稿计数');
 f.find('wbMotionApply').onclick();
 assert.equal(f.history.length,1,'一次提交一次撤销');
 const mv=f.M.nodes(f.store,0).movement;
 assert.equal(mv[0].x,'3');assert.equal(mv[2].x,'9');assert.equal(mv[2].z,'1');
 assert.equal(f.UI.sessionActive(),true,'应用后回 S1（会话保持）');
 f.mount();assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致');
 assert.equal(f.find('wbMotion3dNote').textContent,'','干净态无 3D 标注');
 f.find('wbMotionApply').onclick();
 assert.equal(f.history.length,1,'与已保存一致时不重复保存');
});
test('B4-2 cancel re-baselines keeping the session, zero write',()=>{
 const f=sandbox.makeFixture();f.setPath([[4,4,4]]);f.UI.selectMotion(0);f.mount();
 f.UI.dragNodeStart(0);f.UI.dragNodeMove(5,5);f.UI.dragNodeEnd();f.mount();
 f.find('wbMotionCancel').onclick();
 assert.equal(f.M.nodes(f.store,0).movement[0].x,'4','取消＝重取 baseline，保存值不动');
 assert.equal(f.UI.sessionState().di,0,'会话与选择保持');
 assert.equal(f.history.length,0);
 f.mount();assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致');
 assert.equal(tableInput(f,'路径节点1 X 米').value,'4','数值表随取消还原');
});

// ---------- 5. 删除预告/选中身份与拖动共存；pickTopNode 既有口径不回退 ----------
test('B4-2 delete preview and selection coexist with drag; pickTopNode unchanged',()=>{
 const f=sandbox.makeFixture();f.setPath([[2,0,0],[4,4,4],[6,8,0]]);f.UI.selectMotion(0);
 f.UI.pickTopNode(4,4,.3);
 assert.match(f.UI.sessionState().status,/走位节点 2/,'点选节点反馈保留 B2/B3 口径');
 assert.match(f.UI.sessionState().status,/重连/,'选中即见删除后连线预告');
 assert.equal(f.UI.dragNodeStart(1).ok,true);
 f.UI.dragNodeMove(5,5);
 f.calls.length=0;f.UI.drawSelected(f.g,(x,z)=>({sx:x,sy:z}));
 assert.ok(f.calls.some((c,i)=>c.op==='moveTo'&&c.args[0]===0&&c.args[1]===0&&f.calls[i+1]&&f.calls[i+1].op==='lineTo'&&f.calls[i+1].args[0]===8&&f.calls[i+1].args[1]===0),'删除后连线预览（prev 0,0→next 8,0）仍画');
 assert.ok(f.calls.some(c=>c.op==='strokeRect'&&c.args[0]===0),'被选拖动节点红框仍画');
 f.UI.dragNodeEnd();f.mount();
 assert.ok(f.find('wbMotionDelNode'),'「删除选中节点」入口仍在');
 f.UI.pickTopNode(0,0,.3);
 assert.match(f.UI.sessionState().status,/走位节点 1/,'拖动后仍可点选其他节点');
});

// ---------- 6. S3：数值表非法输入→拖动禁止、应用禁落库；修正后恢复 ----------
test('B4-3 illegal numeric input (S3) forbids drag and apply; fixing restores drag',()=>{
 const f=sandbox.makeFixture();f.setPath([[2,0,0],[4,4,4]]);f.UI.selectMotion(0);f.mount();
 let inp=tableInput(f,'路径节点2 X 米');inp.value='NaN';inp.oninput({target:inp});
 const saved=JSON.stringify(f.store);
 assert.equal(f.UI.nodeAt(4,4,.3),1,'S3 期命中仍可用（overlay 保留上一有效位置）');
 assert.equal(f.UI.dragNodeStart(1).ok,false,'S3 拖动禁止');
 assert.match(f.UI.sessionState().status,/非法输入/,'提示先修正输入或取消');
 assert.match(f.UI.sessionState().status,/取消修改|修正/);
 assert.equal(f.UI.dragNodeMove(5,5),false,'无拖动会话');
 f.mount();assert.equal(tableInput(f,'路径节点2 X 米').value,'NaN','草稿未被拖动污染');
 f.find('wbMotionApply').onclick();
 assert.equal(f.history.length,0,'S3 应用禁落库');
 assert.equal(JSON.stringify(f.store),saved);
 assert.match(f.find('wbMotionStatus').textContent,/数字|非法|须/,'应用被产品校验拒绝并提示');
 inp=tableInput(f,'路径节点2 X 米');inp.value='5';inp.oninput({target:inp}); // 修正→S2
 assert.equal(f.UI.dragNodeStart(0).ok,true,'修正后拖动恢复');
 f.UI.dragNodeMove(1,1);f.UI.dragNodeEnd();
 f.mount();assert.match(f.find('wbMotionDirty').textContent,/未应用 2 处/);
});

// ---------- 7. 播放中拒绝并提示 ----------
test('B4 playing refuses drag start with a pause prompt, no listeners',()=>{
 const f=wire(sandbox.makeFixture());f.setPath([[4,4,4]]);f.UI.selectMotion(0);f.mount();
 const w=dragWorkbench(f);w.drawTop();
 f.store.isPlaying=true;
 const saved2=JSON.stringify(f.store);
 assert.equal(f.UI.dragNodeStart(0).ok,false,'播放中拖动拒绝');
 assert.match(f.UI.sessionState().status,/暂停/,'提示先暂停');
 f.ctx.__topMouseDown(atWorld(f,4,4));
 assert.ok(!f._L.mousemove,'拒绝时不接拖动监听');
 const sel=f.UI.selectionDetail()[0];
 assert.equal(sel.level,'node','播放中点选查看仍允许');
 assert.equal(JSON.stringify(f.store),saved2,'零写入');
 f.store.isPlaying=false;
 assert.equal(f.UI.dragNodeStart(0).ok,true,'暂停后可拖');
});

// ---------- 8. 8 舞者多路径：只动当前会话舞者的节点 ----------
test('B4 eight dancers: only the session dancer has node handles',()=>{
 const f=wire(sandbox.makeFixture(8));for(let i=0;i<8;i++)f.setPath([[5,5,5]],i);
 f.setPath([[8,8,8]],3);
 f.UI.selectMotion(0);f.mount();
 const w=dragWorkbench(f);w.drawTop();
 assert.equal(f.UI.nodeAt(5,5,.3),0,'命中＝会话舞者（与他人同点节点无关）');
 assert.equal(f.UI.nodeAt(8,8,.3),-1,'他人节点无手柄');
 f.ctx.__topMouseDown(atWorld(f,8,8));
 assert.ok(!f._L.mousemove,'他人节点不启动拖动');
 assert.equal(f.M.nodes(f.store,3).movement[0].x,'8','他人轨道不动');
 const t3=JSON.stringify(f.M.tracks(f.store,3));
 f.ctx.__topMouseDown(atWorld(f,5,5));f._L.mousemove[0](atWorld(f,6,6));f._L.mouseup[0]({});
 assert.equal(f.M.nodes(f.store,3).movement[0].x,'8');
 assert.equal(JSON.stringify(f.M.tracks(f.store,3)),t3,'拖动只改会话舞者草稿（他人保存轨字节不动）');
 f.mount();assert.equal(tableInput(f,'路径节点1 X 米').value,'6');
});

// ---------- 9. 朝向会话无俯视手柄；同处走位点选优先于节点手柄 ----------
test('B4 facing session has no top-view handles; same-place pick outranks node drag',()=>{
 const f=wire(sandbox.makeFixture());f.setPath([[4,4,4]]);
 f.UI.openFacing(0);
 assert.equal(f.UI.nodeAt(4,4,.3),-1,'朝向节点无俯视拾取面（B3 登记口径）');
 f.UI.clearSelection();
 const clip=f.clip();f.UI.selectMotion(0);f.UI.openSamePlace(0,clip); // B9 机械注释迁移（旧↔新并列）：旧＝两链并存（beginSession 会收同处走位，故后开）；新＝同处走位复用同舞者会话成窗口快捷段（同一草稿面），俯视点击仍优先点目的地
 const w=dragWorkbench(f);w.drawTop();
 assert.equal(f.UI.nodeAt(4,4,.3),0);
 f.ctx.__topMouseDown(atWorld(f,4,4));
 assert.ok(!f._L.mousemove,'同处走位点选优先（R1 §2 ①），不启动节点拖动');
 f.ctx.__topClick(atWorld(f,3,3));
 assert.equal(f.UI.samePlaceState().dest.x,3,'点击进入同处走位点目的地');
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));process.exitCode=fail?1:0;
