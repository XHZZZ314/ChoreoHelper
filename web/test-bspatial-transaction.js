// B-SPATIAL-2 件①事务层：真实 app 切片（edContent..setLoopPoint，含 B-SPATIAL-2 整组变换块）＋编辑/技能/走位
// 模块与隔离 DOM。覆盖：入口与分派（右键/命令面板/对话框）、选择分派并集（片段/技能/走位会话）、数值例
// （镜像两轴/旋转 90/枢轴组包围盒中心/等距首尾保持）、隐式起始位固化计数与恰三键形态、锁定/停用/外来轨
// 整批拒绝点名、取消/播放中/脏会话/状态过期＝字节级零写入、恰好一次 saveHistory、R5-07 未变侧原字节、
// 跨舞者安装不误伤、↶ 一步恢复。BSPATIAL_SOURCE 指向 before 目录时可对拍红测（app 与 stage-motion 从那里读）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps,msg)=>{if(typeof eps!=='number'){msg=eps;eps=1e-9}assert.ok(Math.abs(a-b)<=eps,(msg?msg+'：':'')+`${a} != ${b}`)};
const j=v=>JSON.parse(JSON.stringify(v));
const appSrc=()=>fs.readFileSync(path.join(process.env.BSPATIAL_SOURCE||__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..setLoopPoint 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读
// （尾标记 setLoopPoint 留在 choreo-app.js，改为切到件尾）；BSPATIAL_SOURCE 旧目录仍读旧 app.js 两标记切片。
const txSrc=()=>process.env.BSPATIAL_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第五步迁移：showCtxMenu 已随时间轴渲染块搬到 choreo-app-timeline.js——WIRE 右键菜单切片
// 从拆分件读；BSPATIAL_SOURCE 旧目录仍读旧 app.js（旧树 showCtxMenu 在主件）。
// 批 C 第六步迁移：buildCmdkCommands 已随 RENDER 外壳搬到 choreo-app-render.js——命令面板切片从拆分件读；
// BSPATIAL_SOURCE 旧目录仍读旧 app.js（旧树 buildCmdkCommands 在主件）。
const uiSrc=()=>process.env.BSPATIAL_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-timeline.js'),'utf8');
const cmdkSrc=()=>process.env.BSPATIAL_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-render.js'),'utf8');
function fixture(n=2){
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  f.ctx.document.createTextNode=function(t){return {tag:'#text',textContent:String(t),children:[],parentNode:null,remove(){},classList:{add(){},remove(){},toggle(){}}}};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  if(process.env.BSPATIAL_SOURCE){ // 本批触件按 before 字节重放（choreo-edit/ability-plan 是零改动锚点，仍读当前字节）
    vm.runInContext(fs.readFileSync(path.join(process.env.BSPATIAL_SOURCE,'choreo-stage-motion.js'),'utf8'),f.ctx,{filename:'before-choreo-stage-motion.js'});
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-ability-plan.js'),'utf8'),f.ctx,{filename:'choreo-ability-plan.js'});
  const tx=txSrc();
  const a=tx.indexOf('function edContent(){'),b=tx.indexOf('function setLoopPoint(');
  assert.ok(a>0,'tx slice start');
  vm.runInContext(tx.slice(a,b>a?b:undefined),f.ctx,{filename:'choreo-app-bspatial-slice'});
  f.M=f.ctx.ChoreoStageMotion;
  f.confirms=[];f.confirmResult=true;
  f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
  f.ctx.window.confirm=f.ctx.confirm;
  f.skillSel=[];
  f.ctx.ChoreoAbilityUI={selection:()=>f.skillSel,clearSelection(){}};
  return f;
}
function addSkill(f,startMs,durMs,id,performer){
  const t={id:'ab-'+id,type:'ability',performerId:performer||'actor-1',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',events:[]};
  t.events.push({id,kind:'ability',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',startMs,durationMs:durMs,sourceRef:{kind:'action',id:'120'},data:{rehearsalAbility:{version:1,actionId:'120',name:'技能 '+id,castMs:1000,presentationMs:durMs-1000,target:{kind:'party',performerId:'actor-2'},animation:'not-connected',gameOutput:false}}});
  f.store.contentExtra._doc.extraTracks.push(t);
  return t;
}
function setFacing(f,rows,di=0){
  const P=f.M;
  P.install(f.store,P.edit(f.store,di,{movement:P.nodes(f.store,di).movement,facing:rows.map(([t,yaw])=>({time:String(t),yaw:String(yaw)}))},'bspt'+di));
}
const sel=(...clips)=>clips.forEach(c=>c.selected=true);
function realHistory(f){ // 真实 saveHistory 同构快照（含 stageTracks）：证一步撤销复原全部类型
  f.snaps=[];
  f.ctx.saveHistory=function(){
    const s=JSON.parse(JSON.stringify({dancers:f.store.dancers,globalLyrics:f.store.globalLyrics,markers:f.store.markers,showLyricMacro:f.store.showLyricMacro}));
    if(f.ctx.ChoreoAbilityPlan)s.abilityTracks=f.ctx.ChoreoAbilityPlan.snapshot(f.store);
    if(f.ctx.ChoreoStageMotion)s.stageTracks=f.M.snapshot(f.store);
    f.snaps.push(JSON.parse(JSON.stringify(s)));f.history.push(1);
  };
}
const fullBytes=f=>JSON.stringify({d:f.store.dancers,g:f.store.globalLyrics,m:f.store.markers,e:f.store.contentExtra&&f.store.contentExtra._doc&&f.store.contentExtra._doc.extraTracks});
const dClip=(f,di=0,i=0)=>f.store.dancers[di].actionClips[i];
const mvNodes=(f,di=0)=>j(f.M.nodes(f.store,di).movement.map(v=>[Number(v.time),Number(v.x),Number(v.z)]));
const fcNodes=(f,di=0)=>j(f.M.nodes(f.store,di).facing.map(v=>[Number(v.time),Number(v.yaw)]));
const tr=(f,spec)=>f.ctx.buildSpatialTransaction(f.ctx.selectionSummary(),spec);
// 对话框链路（入口＝真实 spatialTransform；类型/枢轴经真实控件改；确定＝真实按钮）
function openDlg(f,spec){
  f.ctx.spatialTransform();
  const dlg=f.find('bspatialDlg');assert.ok(dlg,'对话框已开');
  const type=f.find('bspatialType');
  if(type.value!==spec.type){type.value=spec.type;type.onchange()}
  if(spec.pivot==='origin'){
    const pr=f.find('bspatialPivot-origin');assert.ok(pr,'枢轴单选在位');
    if(!pr.checked){pr.checked=true;pr.onchange()}
  }
  return {dlg:dlg,prev:f.find('bspatialPrev'),ok:f.find('bspatialOk'),cancel:f.find('bspatialCancel'),type:type,note:f.find('bspatialPivotNote')};
}
function run(f,spec){ // 打开→预览→确定；返回预览文字（提交后对话框已移除）
  const u=openDlg(f,spec);
  assert.ok(!u.ok.disabled,'对话框预检通过：'+u.prev.textContent);
  const preview=u.prev.textContent;
  u.ok.onclick();
  return {preview:preview};
}

// ---------- 0. 接线（红＝B-SPATIAL-2 前无入口/无函数） ----------
test('WIRE-1 右键菜单/命令面板有「整组变换…」且分派 spatialTransform',()=>{
  const src=uiSrc(),cmdk=cmdkSrc();
  const m=src.indexOf('function showCtxMenu(');
  assert.ok(m>0,'showCtxMenu 在源内');
  const menu=src.slice(m,m+4500);
  assert.match(menu,/整组变换/,'右键菜单项');
  assert.match(menu,/it\.act==='spatial'\)spatialTransform\(\)/,'分派调用');
  const p=cmdk.indexOf('function buildCmdkCommands(');
  assert.ok(p>0);
  assert.match(cmdk.slice(p,p+3400),/整组变换（镜像\/旋转\/等距）/,'命令面板项');
});
test('WIRE-2 切片导出 buildSpatialTransaction/spatialTransform/BSPATIAL_TYPES/bspatialPivotPoint',()=>{
  const f=fixture(1);
  assert.equal(typeof f.ctx.spatialTransform,'function');
  assert.equal(typeof f.ctx.buildSpatialTransaction,'function');
  assert.equal(typeof f.ctx.bspatialPivotPoint,'function');
  assert.equal(f.ctx.BSPATIAL_TYPES.mirrorX,'左右镜像（翻 X 坐标）');
  assert.equal(f.ctx.BSPATIAL_TYPES.equiX,'沿 X 轴等距（起始位）');
});

// ---------- 1. 选择分派与入口守卫 ----------
test('SP-1 选择分派＝片段 di ∪ 技能 owner di（B7a 并集式）；未选舞者零改动',()=>{
  const f=fixture(3);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.store.dancers[1].start={x:2,z:0,yawDeg:0};f.store.dancers[2].start={x:5,z:5,yawDeg:7};
  const c0=f.clip(2,2);f.store.dancers[1].actionClips.push({id:18,start:2,duration:2,data:{name:'B'}});
  addSkill(f,2500,2000,'e1','actor-1');
  sel(c0,dClip(f,1));f.skillSel=['e1'];
  const t=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(!t.refuse&&!t.noop,JSON.stringify(t.refuse||t.noop));
  assert.equal(t.counts.dancers,2,'舞者 0 与 1 入集合（技能 owner 与片段 di 重合，不重复计数）');
  assert.equal(t.counts.clips,2);assert.equal(t.counts.skills,1);
  assert.deepEqual(j(t.affectedDis),[0,1]);
  t.commit();
  assert.equal(f.store.dancers[0].start.x,-1);assert.equal(f.store.dancers[1].start.x,-2);
  assert.deepEqual(j(f.store.dancers[2].start),{x:5,z:5,yawDeg:7},'未选舞者零改动');
  assert.equal(f.history.length,0,'事务构建器不写历史（历史＝入口一次，见 SP-17）');
});
test('SP-1b 无选择＝如实提示零写入零历史零确认',()=>{
  const f=fixture(1);const before=fullBytes(f);
  f.ctx.spatialTransform();
  assert.ok(f.toasts.some(m=>/先选中要变换的内容/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(f.history.length,0);assert.equal(fullBytes(f),before);
});
test('SP-1c 走位/朝向会话 di 入集合（仅会话选择也可变换）',()=>{
  const f=fixture(1);f.store.dancers[0].start={x:1,z:0,yawDeg:0};
  f.setPath([[2,1,0]]);const c=f.clip(2,2);
  f.UI.selectMotion(0);c.selected=false; // 摘要只含走位会话对象
  const t=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(!t.refuse&&!t.noop,JSON.stringify(t.refuse||t.noop));
  assert.deepEqual(j(t.affectedDis),[0]);
  t.commit();
  assert.equal(f.store.dancers[0].start.x,-1);assert.deepEqual(mvNodes(f),[ [2,-1,0] ]);
});

// ---------- 2. 数值例（合同场景表；双侧＝提交后从 store 重读） ----------
test('SP-2 翻 X 枢轴原点：(1,2)/yaw90 → (−1,2)/−90；走位与朝向同步',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:1,z:2,yawDeg:90};
  f.setPath([[2,1,2]]);setFacing(f,[[2,90]]);
  const c=f.clip(2,2);sel(c);
  run(f,{type:'mirrorX',pivot:'origin'});
  assert.deepEqual(j(f.store.dancers[0].start),{x:-1,z:2,yawDeg:-90});
  assert.deepEqual(mvNodes(f),[[2,-1,2]]);assert.deepEqual(fcNodes(f),[[2,-90]]);
  assert.equal(f.history.length,1,'恰好一次 saveHistory');
});
test('SP-3 翻 Z 枢轴原点：(1,2)/yaw0 → (1,−2)/180',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:1,z:2,yawDeg:0};
  f.setPath([[2,1,2]]);setFacing(f,[[2,0]]);
  sel(f.clip(2,2));
  run(f,{type:'mirrorZ',pivot:'origin'});
  assert.deepEqual(j(f.store.dancers[0].start),{x:1,z:-2,yawDeg:180});
  assert.deepEqual(mvNodes(f),[[2,1,-2]]);assert.deepEqual(fcNodes(f),[[2,180]]);
});
test('SP-4 旋转 90 绕原点：(0,1)/yaw0 → (1,0)/90',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:0,z:1,yawDeg:0};
  f.setPath([[2,0,1]]);setFacing(f,[[2,0]]);
  sel(f.clip(2,2));
  run(f,{type:'rot90',pivot:'origin'});
  assert.deepEqual(j(f.store.dancers[0].start),{x:1,z:0,yawDeg:90});
  assert.deepEqual(mvNodes(f),[[2,1,0]]);assert.deepEqual(fcNodes(f),[[2,90]]);
});
test('SP-5 枢轴默认＝组包围盒中心：x=1 与 x=3 两人互换、yaw0 保持 0',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.store.dancers[1].start={x:3,z:0,yawDeg:0};
  sel(f.clip(2,2),(()=>{const c={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);return c})());
  const t=run(f,{type:'mirrorX',pivot:'group'});
  assert.match(t.preview,/组包围盒中心/);
  assert.deepEqual(j(f.store.dancers[0].start),{x:3,z:0,yawDeg:0});
  assert.deepEqual(j(f.store.dancers[1].start),{x:1,z:0,yawDeg:0});
});
test('SP-6 隐式起始位固化：写恰三键、按厘米量化、预览单列计数',()=>{
  const f=fixture(2);
  delete f.store.dancers[0].start; // 隐式＝索引等距 (−0.575, 0)
  f.store.dancers[1].start={x:5,z:5,yawDeg:0};
  sel(f.clip(2,2));
  const t=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(!t.refuse&&!t.noop,JSON.stringify(t.refuse||t.noop));
  assert.equal(t.counts.implicit,1);assert.equal(t.counts.starts,1);
  assert.match(t.preview,/隐式固化 1 处/);assert.match(t.preview,/原为隐式，将固化/);
  t.commit();
  const s=f.store.dancers[0].start;
  assert.equal(Object.keys(s).length,3,'恰三键形态');
  assert.equal(JSON.stringify(s),'{"x":0.57,"z":0,"yawDeg":0}','量化到厘米/整度（quantStage 口径：0.575→0.57）');
});
test('SP-7 等距 3 人 X=[0,1,3]→[0,1.5,3]：首尾字节不变、Z 不动、走位节点零改动',()=>{
  const f=fixture(3);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};
  f.store.dancers[1].start={x:1,z:2,yawDeg:30};
  f.store.dancers[2].start={x:3,z:-1,yawDeg:90};
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'2',x:'9',z:'9'}],facing:[]},'sp7')); // 中间人有走位轨
  const first=JSON.stringify(f.store.dancers[0].start),last=JSON.stringify(f.store.dancers[2].start);
  sel(f.clip(2,2),(()=>{const c={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);return c})(),(()=>{const c={id:19,start:2,duration:2,data:{name:'C'}};f.store.dancers[2].actionClips.push(c);return c})());
  const t=tr(f,{type:'equiX',pivot:'group'}); // 构建器读计数（零写入）
  assert.ok(!t.refuse&&!t.noop,JSON.stringify(t.refuse||t.noop));
  assert.equal(t.counts.starts,1);assert.equal(t.counts.mv,0,'等距不碰走位节点');assert.equal(t.counts.fc,0);
  assert.match(t.preview,/不使用枢轴/);
  run(f,{type:'equiX',pivot:'group'}); // 真实入口提交
  assert.equal(f.history.length,1,'恰好一次 saveHistory');
  assert.deepEqual(j(f.store.dancers[1].start),{x:1.5,z:2,yawDeg:30});
  assert.equal(JSON.stringify(f.store.dancers[0].start),first,'首字节不变');
  assert.equal(JSON.stringify(f.store.dancers[2].start),last,'尾字节不变');
  assert.deepEqual(mvNodes(f,1),[[2,9,9]],'走位轨零改动');
});
test('SP-8 等距 <3 人＝如实 no-op 零写入零历史',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};f.store.dancers[1].start={x:3,z:0,yawDeg:0};
  sel(f.clip(2,2));
  const before=fullBytes(f);
  const t=tr(f,{type:'equiX',pivot:'group'});
  assert.ok(t.noop&&/不足 3 位/.test(t.noop),JSON.stringify(t));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SP-18 变换后无实际变化＝no-op 零写入（镜像自身位置）',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};
  sel(f.clip(2,2));
  const before=fullBytes(f);
  const t=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(t.noop&&/没有实际变化/.test(t.noop),JSON.stringify(t));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SP-19 变换不改节点数：500 节点镜像通过（R5-02 上限兜底不新增超界）',()=>{
  const f=fixture(1);
  f.setPath(Array.from({length:500},(_,i)=>[i+1,i+1,0]));
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};
  sel(f.clip(1,1));
  run(f,{type:'mirrorX',pivot:'origin'});
  assert.equal(f.M.nodes(f.store,0).movement.length,500);
  assert.equal(mvNodes(f,0)[0][1],-1);assert.equal(mvNodes(f,0)[499][1],-500);
});

// ---------- 3. 拒绝面（整批零写入并点名） ----------
test('SP-9 锁定/停用/外来轨＝整批拒绝点名，其他舞者也不动',()=>{
  for(const kind of ['locked','disabled','foreign']){
    const f=fixture(2);
    f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.store.dancers[1].start={x:3,z:0,yawDeg:0};
    f.setPath([[2,1,0]],0);
    const t=f.M.tracks(f.store)[0];
    if(kind==='locked')t.locked=true;
    else if(kind==='disabled')t.enabled=false;
    else f.M.tracks(f.store).push({id:'foreign',type:'movement',performerId:'actor-1',events:[{enabled:true}]});
    sel(f.clip(2,2),(()=>{const c={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);return c})());
    const before=fullBytes(f);
    const r=tr(f,{type:'mirrorX',pivot:'origin'});
    assert.ok(r.refuse,kind+' 应拒绝');
    assert.match(r.refuse,/Synthetic 1[^\n]*走位/,'点名舞者与类型');
    assert.match(r.refuse,/锁定|停用|其他走位/);
    assert.equal(fullBytes(f),before,kind+' 整批零写入（舞者 1 也不动）');
    assert.equal(f.history.length,0);
  }
});
test('SP-10 对话框取消＝字节零写入零历史',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.setPath([[2,1,0]]);sel(f.clip(2,2));
  const before=fullBytes(f);
  const u=openDlg(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(!u.ok.disabled,'预览通过＝确定可用');
  u.cancel.onclick();
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
  assert.ok(f.toasts.some(m=>/已取消，未做任何改动/.test(m)));
});
test('SP-11 播放中拒绝（入口提示＋事务拒绝）零写入',()=>{
  const f=fixture(1);f.store.dancers[0].start={x:1,z:0,yawDeg:0};sel(f.clip(2,2));
  f.store.isPlaying=true;
  const before=fullBytes(f);
  f.ctx.spatialTransform();
  assert.ok(f.toasts.some(m=>/请先暂停再整组变换/.test(m)));
  assert.ok(!f.find('bspatialDlg'),'零对话框');
  const r=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(r.refuse&&/播放中/.test(r.refuse));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SP-12 脏走位/朝向会话拒绝（先应用或取消）零写入',()=>{
  const f=fixture(1);f.setPath([[6,6,0]]);const c=f.clip(2,2);sel(c);
  f.UI.openSamePlace(0,c);f.UI.pickSamePlace(9,0); // 未应用的窗口草稿
  const before=fullBytes(f);
  f.ctx.spatialTransform();
  assert.ok(f.toasts.some(m=>/应用.*取消|取消.*应用/.test(m)));
  assert.ok(!f.find('bspatialDlg'),'零对话框');
  const r=tr(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(r.refuse&&/未应用修改/.test(r.refuse));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SP-13 状态过期须重新操作（预览后状态变化→确定零写入）',()=>{
  const f=fixture(1);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.setPath([[2,1,0]]);sel(f.clip(2,2));
  const before=fullBytes(f);
  const u=openDlg(f,{type:'mirrorX',pivot:'origin'});
  assert.ok(!u.ok.disabled,'预检通过');
  f.store.markers.push({id:'mk9',t:99}); // 交互期间状态被改
  u.ok.onclick();
  assert.match(f.find('bspatialPrev').textContent,/状态已变化/);
  assert.equal(f.history.length,0);
  f.store.markers=f.store.markers.filter(m=>m.id!=='mk9');
  assert.equal(fullBytes(f),before,'整状态字节不变');
});

// ---------- 4. 一次写入＋恰好一次 saveHistory＋一步撤销＋R5-07 ----------
test('SP-14 一次确认→一次写入＋恰好一次 saveHistory；↶ 一步复原（片段/走位/朝向/起始位）',()=>{
  const f=fixture(2);realHistory(f);
  f.store.dancers[0].start={x:1,z:2,yawDeg:90};f.store.dancers[1].start={x:4,z:0,yawDeg:0};
  f.setPath([[2,1,2],[6,3,4]],0);setFacing(f,[[2,90]],0);
  const c0=f.clip(2,2),c1={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c1);
  sel(c0,c1);
  f.ctx.saveHistory(); // 种一步前状态快照
  const before=fullBytes(f);
  run(f,{type:'mirrorX',pivot:'origin'});
  assert.equal(f.history.length,2,'恰好一次 saveHistory（种 1＋本批 1）');
  assert.equal(fullBytes(f)!==before,true,'确有写入');
  const pre=f.snaps[0],preFull=JSON.parse(before);
  assert.deepEqual(pre.dancers,preFull.d,'dancers 回到变换前');
  assert.deepEqual(pre.stageTracks,preFull.e.filter(t=>f.M.owned(t)),'走位/朝向轨道回到变换前');
  assert.deepEqual(j(f.store.dancers[0].start),{x:-1,z:2,yawDeg:-90});
});
test('SP-15 R5-07 未变侧原字节：仅走位轨的舞者不新建朝向轨；身份侧朝向保留扩展字段',()=>{
  // (a) 仅走位：变换后不产生朝向轨
  const f=fixture(1);f.setPath([[2,1,0]]);f.store.dancers[0].start={x:1,z:0,yawDeg:0};
  sel(f.clip(2,2));
  run(f,{type:'mirrorX',pivot:'origin'});
  assert.equal(f.M.tracks(f.store).filter(t=>t.type==='facing').length,0,'不因镜像新建朝向轨');
  assert.deepEqual(mvNodes(f),[[2,-1,0]]);
  // (b) 朝向 yaw0 在翻 X 下身份（0→−0→'0'）：朝向轨原字节（含扩展字段）保留
  const g=fixture(1);
  g.store.dancers[0].start={x:1,z:0,yawDeg:0};
  g.setPath([[2,1,0]]);setFacing(g,[[2,0]]);
  const faceTrack=g.M.tracks(g.store).find(t=>t.type==='facing');
  faceTrack.events[0].data.stageMotion.points[0].custom={keep:1};
  const faceBytes=JSON.stringify(faceTrack);
  sel(g.clip(2,2));
  const t=tr(g,{type:'mirrorX',pivot:'origin'});
  assert.ok(!t.refuse&&!t.noop,JSON.stringify(t.refuse||t.noop));
  t.commit();
  assert.equal(JSON.stringify(g.M.tracks(g.store).find(t2=>t2.type==='facing')),faceBytes,'身份侧保留原字节（含嵌套扩展）');
  assert.deepEqual(mvNodes(g),[[2,-1,0]],'走位侧照常变换');
});
test('SP-16 跨舞者安装不误伤：舞者0 仅走位、舞者1 仅朝向，各自变换且互不新建',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.store.dancers[1].start={x:3,z:0,yawDeg:0};
  f.setPath([[2,1,0]],0);setFacing(f,[[2,90]],1);
  sel(f.clip(2,2),(()=>{const c={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);return c})());
  run(f,{type:'mirrorX',pivot:'origin'});
  assert.deepEqual(mvNodes(f,0),[[2,-1,0]]);assert.deepEqual(fcNodes(f,1),[[2,-90]]);
  assert.equal(f.M.tracks(f.store).filter(t=>t.type==='facing'&&t.performerId==='actor-1').length,0,'舞者0 不新建朝向轨');
  assert.equal(f.M.tracks(f.store).filter(t=>t.type==='movement'&&t.performerId==='actor-2').length,0,'舞者1 不新建走位轨');
});

// ---------- 5. 对话框链路（类型/枢轴/预览计数/确定） ----------
test('SP-17 对话框：预览计数与每舞者一行、类型切换重算、等距枢轴说明、确定＝写入＋撤销',()=>{
  const f=fixture(3);realHistory(f);
  f.store.dancers[0].start={x:1,z:0,yawDeg:0};f.store.dancers[1].start={x:3,z:0,yawDeg:0};f.store.dancers[2].start={x:6,z:0,yawDeg:0};
  f.setPath([[2,1,0]],0);setFacing(f,[[2,90]],0);
  const cs=[f.clip(2,2)];
  for(const [i,id] of [[1,18],[2,19]]){const c={id,start:2,duration:2,data:{name:'B'+id}};f.store.dancers[i].actionClips.push(c);cs.push(c)}
  sel(...cs);
  f.ctx.saveHistory();
  const before=fullBytes(f);
  const u=openDlg(f,{type:'mirrorX',pivot:'origin'});
  const prev=u.prev.textContent;
  assert.match(prev,/整组变换：左右镜像（翻 X 坐标）/);
  assert.match(prev,/受影响舞者 3 位/);
  assert.match(prev,/起始位 3 处（其中隐式固化 0 处）；走位节点 1 个；朝向节点 1 个/);
  assert.match(prev,/舞者 Synthetic 1：起始位/);
  assert.match(prev,/舞者 Synthetic 2：起始位/);
  assert.match(prev,/一次写入，↶ 可一次撤销/);
  u.type.value='equiX';u.type.onchange();
  assert.equal(u.note.textContent,'（等距不使用枢轴）');
  assert.match(u.prev.textContent,/沿 X 轴等距（起始位）/);
  assert.match(u.prev.textContent,/起始位 1 处（其中隐式固化 0 处）；走位节点 0 个；朝向节点 0 个/);
  u.type.value='mirrorX';u.type.onchange();
  assert.equal(u.note.textContent,'');
  assert.ok(!u.ok.disabled,'切回镜像后预检通过');
  u.ok.onclick();
  assert.equal(f.history.length,2,'恰好一次 saveHistory（种 1＋本批 1）');
  assert.deepEqual(j(f.store.dancers[0].start),{x:-1,z:0,yawDeg:0});
  assert.deepEqual(j(f.store.dancers[1].start),{x:-3,z:0,yawDeg:0});
  assert.deepEqual(j(f.store.dancers[2].start),{x:-6,z:0,yawDeg:0});
  assert.deepEqual(mvNodes(f,0),[[2,-1,0]]);assert.deepEqual(fcNodes(f,0),[[2,-90]]);
  const pre=f.snaps[0],preFull=JSON.parse(before);
  assert.deepEqual(pre.dancers,preFull.d,'一步撤销回到变换前');
  assert.deepEqual(pre.stageTracks,preFull.e.filter(t=>f.M.owned(t)));
  assert.ok(f.toasts.some(m=>/已整组变换/.test(m)));
  assert.ok(!f.find('bspatialDlg'),'提交后对话框关闭');
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
