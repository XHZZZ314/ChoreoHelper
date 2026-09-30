// B7a 整段推迟/提前（表 A/T6）：真实 app 切片＋编辑/技能/走位模块与隔离 DOM；浏览器可用性另验。
// 覆盖：入口与取值（默认窗=所选片段并集、0.5 步进、播放中拒绝）；四类同步事务（片段/技能＋所选舞者
// [a,b] 走位/朝向 t6Shift，锚点三枚、冲突覆盖/取消、影响范围分区如实预告、无「窗外采样不变」）；
// 表 A T6 数值例双侧采样（稀疏/覆盖删/负位移/双轴/朝向 yaw）；拒绝面逐条（Δ=0、非 0.5 步进、a<0、
// b≤a、窗后、>500、锁定/停用/外来轨、提前出 0、脏会话、预检源过期）；一次确认→一次写入＋一次
// saveHistory（快照复原四类）；片段侧冲突＝既有整组平移口径（不阻断、只提示，moveGroup 对拍钉住）。
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
// B7A_SOURCE 指向保存的旧文件目录时对拍红测（仅 choreo-app.js 从那里读，其余模块不变＝当前字节）。
const appSrc=()=>fs.readFileSync(path.join(process.env.B7A_SOURCE||__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..setLoopPoint 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读
// （尾标记 setLoopPoint 留在 choreo-app.js，改为切到件尾）；B7A_SOURCE 旧目录仍读旧 app.js 两标记切片。
const txSrc=()=>process.env.B7A_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第五步迁移：showCtxMenu 已随时间轴渲染块搬到 choreo-app-timeline.js——WIRE 右键菜单切片
// 从拆分件读；B7A_SOURCE 旧目录仍读旧 app.js（旧树 showCtxMenu 在主件）。
const uiSrc=()=>process.env.B7A_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-timeline.js'),'utf8');
// 批 C 第六步迁移：buildCmdkCommands 已随 RENDER 外壳搬到 choreo-app-render.js——命令面板切片从拆分件读；
// B7A_SOURCE 旧目录仍读旧 app.js（旧树 buildCmdkCommands 在主件）。
const cmdkSrc=()=>process.env.B7A_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-render.js'),'utf8');
function fixture(n=2){
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-ability-plan.js'),'utf8'),f.ctx,{filename:'choreo-ability-plan.js'});
  // 切片：edContent..setLoopPoint（含 B5 事务与 B7a 整段平移事务；showCtxMenu/命令面板接线由 WIRE 静态断言）。
  const tx=txSrc();
  const a=tx.indexOf('function edContent(){'),b=tx.indexOf('function setLoopPoint(');
  assert.ok(a>0,'tx slice start');
  vm.runInContext(tx.slice(a,b>a?b:undefined),f.ctx,{filename:'choreo-app-b7a-slice'});
  f.confirms=[];f.confirmResult=true;
  f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
  f.ctx.window.confirm=f.ctx.confirm;
  f.prompts=[];f.promptQueue=[];f.onPrompt=null;
  f.ctx.prompt=function(msg,def){const v=f.promptQueue.shift();if(f.onPrompt)f.onPrompt(msg,v);f.prompts.push(String(msg)+'｜默认:'+String(def));return v===undefined?null:v};
  f.ctx.window.prompt=f.ctx.prompt;
  f.skillSel=[];
  f.ctx.ChoreoAbilityUI={selection:()=>f.skillSel,clearSelection(){}};
  return f;
}
function addSkill(f,startMs,durMs,id,performer){
  const t={id:'ab-'+id,type:'ability',performerId:performer||'actor-1',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',events:[]};
  t.events.push({id,kind:'ability',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',startMs,durationMs:durMs,sourceRef:{kind:'action',id:'120'},data:{rehearsalAbility:{version:1,actionId:'120',name:'技能 '+id,castMs:1000,presentationMs:durMs-1000,target:{kind:'party',performerId:'actor-2'},animation:'not-connected',gameOutput:false}}});
  f.store.contentExtra._doc.extraTracks.push(t);
}
function setFacing(f,rows,di=0){
  const P=f.M;
  P.install(f.store,P.edit(f.store,di,{movement:P.nodes(f.store,di).movement,facing:rows.map(([t,yaw])=>({time:String(t),yaw:String(yaw)}))},'b7af'+di));
}
function sel(...clips){clips.forEach(c=>c.selected=true)}
function realHistory(f){ // 真实 saveHistory 同构快照（含 abilityTracks/stageTracks）：证一步撤销复原全部类型
  f.snaps=[];
  f.ctx.saveHistory=function(){
    const s=JSON.parse(JSON.stringify({dancers:f.store.dancers,globalLyrics:f.store.globalLyrics,markers:f.store.markers,showLyricMacro:f.store.showLyricMacro}));
    if(f.ctx.ChoreoAbilityPlan)s.abilityTracks=f.ctx.ChoreoAbilityPlan.snapshot(f.store);
    if(f.ctx.ChoreoStageMotion)s.stageTracks=f.M.snapshot(f.store);
    f.snaps.push(JSON.parse(JSON.stringify(s)));f.history.push(1);
  };
}
const fullBytes=f=>JSON.stringify({d:f.store.dancers,g:f.store.globalLyrics,m:f.store.markers,e:f.store.contentExtra&&f.store.contentExtra._doc&&f.store.contentExtra._doc.extraTracks});
// 事务经克隆候选安装：提交后 store.dancers 已被整体替换，断言一律从 store 重读（旧对象引用是安装前快照）。
const dClip=(f,di=0,i=0)=>f.store.dancers[di].actionClips[i];
const mvNodes=(f,di=0)=>j(f.M.nodes(f.store,di).movement.map(v=>[Number(v.time),Number(v.x),Number(v.z)]));
const fcNodes=(f,di=0)=>j(f.M.nodes(f.store,di).facing.map(v=>[Number(v.time),Number(v.yaw)]));

// ---------- 0. 接线（红＝B7a 前无入口/无函数） ----------
test('WIRE-1 右键菜单/命令面板有「整段推迟/提前…」且分派 shiftSegmentTime',()=>{
  const src=uiSrc(),cmdk=cmdkSrc();
  const m=src.indexOf('function showCtxMenu(');
  assert.ok(m>0,'showCtxMenu 在源内');
  const menu=src.slice(m,m+4000);
  assert.match(menu,/整段推迟\/提前/,'右键菜单项');
  assert.match(menu,/it\.act==='shiftSeg'\)shiftSegmentTime\(\)/,'分派调用');
  const p=cmdk.indexOf('function buildCmdkCommands(');
  assert.ok(p>0);
  assert.match(cmdk.slice(p,p+3000),/整段推迟\/提前（多选）/,'命令面板项');
});
test('WIRE-2 切片导出 shiftSegmentTime/buildShiftTimeTransaction',()=>{
  const f=fixture(1);
  assert.equal(typeof f.ctx.shiftSegmentTime,'function');
  assert.equal(typeof f.ctx.buildShiftTimeTransaction,'function');
});

// ---------- 1. 入口与取值 ----------
test('SH-1 默认源窗＝所选片段并集跨度（跨舞者并集），窗口可输入修改',()=>{
  const f=fixture(2);
  const c0=f.clip(2,2),c1={id:18,start:6,duration:3,data:{name:'B'}};f.store.dancers[1].actionClips.push(c1);
  sel(c0,c1);f.promptQueue=['2~9','1'];
  f.ctx.shiftSegmentTime();
  assert.equal(f.prompts.length,2);
  assert.match(f.prompts[0],/2~9/,'默认并集跨度 2~9 预填');
  assert.match(f.prompts[1],/0\.5 步进/);
  assert.equal(f.confirms.length,1,'一次确认');
  near(dClip(f,0).start,3);near(dClip(f,1).start,7);
});
test('SH-2 播放中拒绝并提示请先暂停（零写入零确认）',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);f.store.isPlaying=true;
  const before=fullBytes(f);
  f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/请先暂停/.test(m)));
  assert.equal(f.prompts.length,0);assert.equal(f.confirms.length,0);assert.equal(f.history.length,0);
  assert.equal(fullBytes(f),before);
});
test('SH-3 无选择＝如实提示零写入零确认',()=>{
  const f=fixture(1);const before=fullBytes(f);
  f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/先选中/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(fullBytes(f),before);
});

// ---------- 2. 四类同步（最小场景①：两人延后两拍） ----------
test('SH-4 两人延后两拍＝片段/技能/走位/朝向四类同步＋一次确认一次 saveHistory＋一步撤销快照复原',()=>{
  const f=fixture(2);realHistory(f);
  const c0=f.clip(2,2),c1={id:18,start:2,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c1);
  f.setPath([[3,3,0],[10,10,0]],0);f.setPath([[3,1,0]],1);setFacing(f,[[4,40]],0);
  addSkill(f,2500,2000,'e1');f.skillSel=['e1'];
  sel(c0,c1);
  f.ctx.saveHistory(); // 种一步前状态快照（真实链路：撤销回到上一快照）
  const before=fullBytes(f);
  const beforeS={m0:f.sample(3,0).x,y0:f.sample(4,0).yawDeg,m1:f.sample(3,1).x};
  f.promptQueue=['2~4','2'];
  f.ctx.shiftSegmentTime();
  assert.equal(f.confirms.length,1,'恰好一次确认');
  assert.equal(f.history.length,2,'恰好一次 saveHistory（种１＋本批１）');
  const prev=f.confirms[0];
  assert.match(prev,/整段推迟/);assert.match(prev,/动作 2/);assert.match(prev,/技能[^\n]*1/);
  assert.match(prev,/Synthetic 1/);assert.match(prev,/Synthetic 2/);
  assert.match(prev,/锚点 3/);assert.match(prev,/保持段/);assert.match(prev,/平移段/);assert.match(prev,/窗后重连/);
  assert.match(prev,/终态/); // 舞者2 末节点在窗内→终态变化如实
  assert.ok(!/窗外采样不变/.test(prev),'不得出现「窗外采样不变」');
  near(dClip(f,0).start,4);near(dClip(f,1).start,4,'两人片段同步 +2');
  const A=f.ctx.ChoreoAbilityPlan;
  assert.equal(A.rows(f.store).find(r=>r.event.id==='e1').event.startMs,4500,'技能同步 +2s');
  assert.deepEqual(mvNodes(f,0),[[2,2,0],[4,2,0],[5,3,0],[6,4,0],[10,10,0]],'舞者1 走位 T6');
  assert.deepEqual(fcNodes(f,0),[[2,20],[4,20],[6,40]],'舞者1 朝向按 yaw T6');
  assert.deepEqual(mvNodes(f,1),[[2,0.667,0],[4,0.667,0],[5,1,0],[6,1,0]],'舞者2 走位 T6');
  // 平移段采样＝原窗内采样（形状保持）
  near(f.sample(5,0).x,beforeS.m0);near(f.sample(6,0).yawDeg,beforeS.y0);near(f.sample(5,1).x,beforeS.m1);
  // 一步撤销：上一快照复原全部四类（dancers/歌词/标记＋abilityTracks＋stageTracks）
  const pre=f.snaps[0],preFull=JSON.parse(before);
  assert.deepEqual(pre.dancers,preFull.d,'片段回到 +2 前');
  assert.deepEqual(pre.stageTracks,preFull.e.filter(t=>f.M.owned(t)),'走位/朝向轨道回到 T6 前');
  assert.deepEqual(pre.abilityTracks,preFull.e.filter(t=>f.ctx.ChoreoAbilityPlan.owned(t)),'技能回到 +2 前');
  assert.equal(fullBytes(f)!==before,true,'确有写入');
});

// ---------- 3. 表 A T6 数值例（R4 §三；双侧＝变换前后都经真实产品采样） ----------
test('SH-5 稀疏 10(10) 平移 [2,4]+2：得 2(2),4(2),6(4),10(10) 且 t5=原 t3=3',()=>{
  const f=fixture(1);f.setPath([[10,10,0]]);const c=f.clip(2,2);sel(c);
  const before3=f.sample(3).x;near(before3,3,'变换前 t3=3');
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  assert.deepEqual(mvNodes(f),[[2,2,0],[4,2,0],[6,4,0],[10,10,0]]);
  near(f.sample(5).x,3,'变换后 t5=原 t3');
  assert.equal(f.history.length,1);
});
test('SH-6 x=t 1..8 平移 [2,4]+2 覆盖删 5、6：节点 [[1,1],[2,2],[4,2],[5,3],[6,4],[7,7],[8,8]]，t5=原 t3=3；取消分支零写入',()=>{
  const f=fixture(1);f.setPath(Array.from({length:8},(_,i)=>[i+1,i+1,0]));const c=f.clip(2,2);sel(c);
  const before3=f.sample(3).x;near(before3,3);
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  assert.equal(f.confirms.length,1,'冲突并入同一次确认（预告即冲突对话框）');
  assert.match(f.confirms[0],/冲突/);assert.match(f.confirms[0],/5/);assert.match(f.confirms[0],/6/);
  assert.match(f.confirms[0],/覆盖/,'覆盖=删清单内节点');
  assert.deepEqual(mvNodes(f),[[1,1,0],[2,2,0],[4,2,0],[5,3,0],[6,4,0],[7,7,0],[8,8,0]]);
  near(f.sample(5).x,3,'t5=原 t3=3');
  // 取消分支：字节零写入零历史
  const g=fixture(1);g.setPath(Array.from({length:8},(_,i)=>[i+1,i+1,0]));const cg=g.clip(2,2);sel(cg);
  const before=fullBytes(g);g.promptQueue=['2~4','2'];g.confirmResult=false;
  g.ctx.shiftSegmentTime();
  assert.equal(fullBytes(g),before,'取消＝整状态字节不变');assert.equal(g.history.length,0);
  assert.ok(g.toasts.some(m=>/取消/.test(m)));
});
test('SH-7 负位移 [4,6]−1 覆盖删 3：t3.5=原 t4.5=4.5、t≤2 精确、t2.5 落窗前重连段（已预告）',()=>{
  const f=fixture(1);f.setPath(Array.from({length:8},(_,i)=>[i+1,i+1,0]));const c=f.clip(4,2);sel(c);
  const before45=f.sample(4.5).x,before15=f.sample(1.5).x,before25=f.sample(2.5).x;
  near(before45,4.5);near(before15,1.5);near(before25,2.5);
  f.promptQueue=['4~6','-1'];f.ctx.shiftSegmentTime();
  assert.match(f.confirms[0],/冲突/);assert.match(f.confirms[0],/3/);assert.match(f.confirms[0],/覆盖/);
  assert.match(f.confirms[0],/窗前重连/,'Δ<0 窗前重连段如实预告');
  assert.match(f.confirms[0],/t≤t_prev|前缀/,'保留节点前缀保证如实');
  assert.deepEqual(mvNodes(f),[[1,1,0],[2,2,0],[3,4,0],[4,5,0],[5,6,0],[6,6,0],[7,7,0],[8,8,0]]);
  near(f.sample(3.5).x,4.5,'平移段 t3.5=原 t4.5');
  near(f.sample(1.5).x,1.5,'t≤2 精确');
  near(f.sample(2.5).x,3.0,'t2.5 落窗前重连段（必变，已预告）');
  assert.notEqual(f.sample(2.5).x,before25);
});
test('SH-8 稀疏非零 Z 双轴 [3,5]+1.5 于 12(9,−6)',()=>{
  const f=fixture(1);f.setPath([[12,9,-6]]);const c=f.clip(3,2);sel(c);
  f.promptQueue=['3~5','1.5'];f.ctx.shiftSegmentTime();
  assert.deepEqual(mvNodes(f),[[3,2.25,-1.5],[4.5,2.25,-1.5],[6.5,3.75,-2.5],[12,9,-6]]);
  near(f.sample(12).x,9);near(f.sample(12).z,-6,'末点后＝保持值');
});
test('SH-9 朝向轨按 yaw 同表真实执行（movement 空不建轨；afterEnd 侧原字节保持）',()=>{
  const f=fixture(1);setFacing(f,[[10,10]]);const c=f.clip(2,2);sel(c);
  const before3=f.sample(3).yawDeg;near(before3,3);
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  assert.deepEqual(fcNodes(f),[[2,2],[4,2],[6,4],[10,10]],'朝向 yaw T6');
  near(f.sample(5).yawDeg,3,'t5=原 t3');
  assert.equal(f.M.rows(f.store).filter(t=>t.type==='movement').length,0,'无走位轨不新建');
  // 反向：走位在窗内平移、朝向整体在窗前已结束（afterEnd 容忍不动）→朝向轨原字节保留（R5-07）
  const g=fixture(1);g.setPath([[3,3,0],[10,10,0]]);setFacing(g,[[1,30]]);const cg=g.clip(2,2);sel(cg);
  const faceBytes=JSON.stringify(g.M.tracks(g.store).find(t=>t.type==='facing'));
  g.promptQueue=['2~4','2'];g.ctx.shiftSegmentTime();
  assert.match(g.confirms[0],/朝向：窗口在末节点之后（不动）/,'如实预告');
  assert.equal(JSON.stringify(g.M.tracks(g.store).find(t=>t.type==='facing')),faceBytes,'未变一侧保留原字节');
  assert.deepEqual(mvNodes(g),[[2,2,0],[4,2,0],[5,3,0],[6,4,0],[10,10,0]],'走位照常 T6');
});

// ---------- 4. 冲突对话框（覆盖/取消；多舞者全部点名） ----------
test('SH-10 多舞者冲突全部点名（走位＋朝向），覆盖分支一次提交',()=>{
  const f=fixture(2);
  f.setPath([[2,2,0],[5,5,0]],0);f.setPath([[9,9,0]],1);setFacing(f,[[4,40]],1);
  const c0=f.clip(1,1),c1={id:18,start:1,duration:1,data:{name:'B'}};f.store.dancers[1].actionClips.push(c1);
  sel(c0,c1);
  f.promptQueue=['1~3','2'];f.ctx.shiftSegmentTime();
  assert.equal(f.confirms.length,1);
  assert.match(f.confirms[0],/Synthetic 1[^\n]*走位[^\n]*5/,'舞者1 走位冲突点名');
  assert.match(f.confirms[0],/Synthetic 2[^\n]*朝向[^\n]*4/,'舞者2 朝向冲突点名');
  assert.match(f.confirms[0],/覆盖/);
  // 覆盖＝删清单内节点：舞者1 走位 5s 处只剩窗末锚点值 3（原 5(5) 已删）；survivors 9 保留
  const at5=mvNodes(f,0).find(n=>n[0]===5);
  assert.ok(at5,'5s 处存在节点');near(at5[1],3,'5s 冲突节点被删，仅存锚点 (5,Q(3))');
  assert.deepEqual(mvNodes(f,0),[[1,1,0],[3,1,0],[4,2,0],[5,3,0]]);
  assert.deepEqual(fcNodes(f,1),[[1,10],[3,10],[5,30]],'朝向冲突节点 4(40) 被删');
  assert.ok(mvNodes(f,1).some(n=>n[0]===9));
  assert.equal(f.history.length,1);
});

// ---------- 5. 拒绝面逐条（全部零写入；除注明外零确认） ----------
test('SH-11 Δ=0 零位移提示',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);f.setPath([[5,5,0]]);
  const before=fullBytes(f);f.promptQueue=['2~4','0'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/零位移/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SH-12 非 0.5 步进拒绝',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);f.setPath([[5,5,0]]);
  const before=fullBytes(f);f.promptQueue=['2~4','0.3'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/0\.5/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(fullBytes(f),before);
});
test('SH-13 a<0 拒绝',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);
  const before=fullBytes(f);f.promptQueue=['-1~4','2'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/a.*0|起点.*0/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(fullBytes(f),before);
});
test('SH-14 b≤a 拒绝',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);
  const before=fullBytes(f);f.promptQueue=['4~4','2'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/b>a|b.*a/.test(m)));
  assert.equal(f.confirms.length,0);assert.equal(fullBytes(f),before);
});
test('SH-15 窗口整体在末节点之后：该舞者如实不动（片段仍移）；纯会话无内容可动＝no-op',()=>{
  const f=fixture(1);f.setPath([[10,10,0]]);const c=f.clip(2,2);sel(c);
  f.promptQueue=['20~30','2'];f.ctx.shiftSegmentTime();
  assert.match(f.confirms[0],/末节点之后（不动）/);
  assert.deepEqual(mvNodes(f),[[10,10,0]],'窗后走位字节不动');
  near(dClip(f).start,4,'片段照常 +2');
  // no-op：仅同处走位会话（干净、无节点）入摘要→无片段/技能/轨道改动
  const g=fixture(1);const cg=g.clip(2,2);g.UI.openSamePlace(0,cg); // 不选中片段：摘要只含窗口级走位
  cg.selected=false;
  const before=fullBytes(g);g.promptQueue=['2~4','2'];
  g.ctx.shiftSegmentTime();
  assert.equal(g.confirms.length,0,'no-op 零确认');
  assert.ok(g.toasts.some(m=>/没有需要|未做改动/.test(m)));
  assert.equal(fullBytes(g),before);
});
test('SH-16 最终 501 拒绝零写入；500 合法（R5-02 最终列表口径）',()=>{
  const mk=(count)=>{const f=fixture(1);f.setPath(Array.from({length:count},(_,i)=>[i+1,i+1,0]));const c=f.clip(1,1);sel(c);return f};
  // 窗口放在末节点处：冲突区 (b,b+Δ] 落在末节点之后→无冲突，最终数＝N+3（纯锚点增量）
  const f=mk(498);const before=fullBytes(f);f.promptQueue=['497.5~498.5','2'];
  f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/500/.test(m)),'501 提交前拒绝并点名');
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
  const g=mk(497);g.promptQueue=['496.5~497.5','2'];g.ctx.shiftSegmentTime();
  assert.equal(g.history.length,1,'497+3=500 合法');
  assert.equal(g.M.nodes(g.store,0).movement.length,500);
});
test('SH-17 锁定/停用/外来轨＝原状态克隆拒绝，整批零写入',()=>{
  for(const kind of ['locked','disabled','foreign']){
    const f=fixture(1);f.setPath([[3,3,0],[8,8,0]]);const c=f.clip(2,2);sel(c);
    const t=f.M.tracks(f.store)[0];
    if(kind==='locked')t.locked=true;else if(kind==='disabled')t.enabled=false;
    else f.M.tracks(f.store).push({id:'foreign',type:'movement',performerId:'actor-1',events:[{enabled:true}]});
    const before=fullBytes(f);f.promptQueue=['2~4','2'];
    f.ctx.shiftSegmentTime();
    assert.equal(f.confirms.length,0);
    assert.ok(f.toasts.some(m=>/锁定|停用|其他走位/.test(m)),kind+' 拒绝点名');
    assert.equal(fullBytes(f),before,kind+' 整批零写入（片段也不移）');
  }
});
test('SH-18 脏走位/朝向会话拒绝（先应用或取消）',()=>{
  const f=fixture(1);f.setPath([[6,6,0]]);const c=f.clip(2,2);sel(c);
  f.UI.openSamePlace(0,c);f.UI.pickSamePlace(9,0); // 未应用的窗口草稿
  const before=fullBytes(f);
  f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/应用.*取消|取消.*应用/.test(m)));
  assert.equal(f.prompts.length,0);assert.equal(fullBytes(f),before);
});
test('SH-19 预检源过期须重新操作（交互期间状态变化→零写入）',()=>{
  const f=fixture(1);f.setPath([[5,5,0]]);const c=f.clip(2,2);sel(c);
  const before=fullBytes(f);
  f.onPrompt=function(){f.store.markers.push({id:'mk9',t:99})}; // 交互中状态被改
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/状态已变化|重新操作/.test(m)));
  assert.equal(f.confirms.length,0,'零确认');
  // 写回交互前状态：整体未提交（标记是测试注入，移除后与 before 比对）
  f.store.markers=f.store.markers.filter(m=>m.id!=='mk9');
  assert.equal(fullBytes(f),before);
});
test('SH-20 取消确认＝整状态字节不变（含技能/走位/朝向）',()=>{
  const f=fixture(1);f.setPath([[3,3,0],[10,10,0]]);setFacing(f,[[4,40]]);
  const c=f.clip(2,2);sel(c);addSkill(f,2500,2000,'e1');f.skillSel=['e1'];
  const before=fullBytes(f);f.promptQueue=['2~4','2'];f.confirmResult=false;
  f.ctx.shiftSegmentTime();
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('SH-21 提前出 0 秒：片段点名整批拒绝；纯走位锚点出负同样拒绝',()=>{
  const f=fixture(1);const c=f.clip(1,2);sel(c);
  const before=fullBytes(f);f.promptQueue=['1~3','-2'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/片段.*0 秒|早于 0/.test(m)),'片段点名');
  assert.equal(fullBytes(f),before);
  const g=fixture(1);g.setPath([[2,2,0],[4,4,0]]);const cg=g.clip(4,2);sel(cg); // 片段 4-2=2 合法
  const b2=fullBytes(g);g.promptQueue=['1~3','-2'];
  g.ctx.shiftSegmentTime();
  assert.ok(g.toasts.some(m=>/走位/.test(m)),'走位锚点负时刻经产品解析器拒绝');
  assert.equal(fullBytes(g),b2,'整批零写入');
});
test('SH-22 技能提前出 0 秒点名整批拒绝',()=>{
  const f=fixture(1);const c=f.clip(4,2);sel(c);addSkill(f,1000,1000,'e1');f.skillSel=['e1'];
  const before=fullBytes(f);f.promptQueue=['2~4','-2'];f.ctx.shiftSegmentTime();
  assert.ok(f.toasts.some(m=>/技能.*0 秒|技能.*早于 0/.test(m)));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});

// ---------- 6. 片段侧冲突＝既有整组平移口径（不阻断、只提示；moveGroup 对拍钉住） ----------
test('SH-23 目标位与未选中片段同轨重叠＝提示不阻断；结果与 CE.moveGroup 对拍一致',()=>{
  const f=fixture(1);
  const c=f.clip(2,2);sel(c);const other=f.clip(3,2);other.selected=false;
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  assert.match(f.confirms[0],/重叠/,'预告提示重叠');
  assert.match(f.confirms[0],/不阻断/,'沿用整组平移口径（不自动让位）');
  near(dClip(f,0,0).start,4);near(dClip(f,0,1).start,3,'未选中片段不让位（粘贴 makeRoom 口径不适用）');
});
test('SH-23b moveGroup 对拍：选中条 +2 与 moveGroup([{clip}],2,total) 同结果',()=>{
  const f=fixture(1);const c=f.clip(2,2);sel(c);
  f.promptQueue=['2~4','2'];f.ctx.shiftSegmentTime();
  const CEp=f.ctx.ChoreoEdit.pure;
  const par={dancers:[{actionClips:[{id:17,start:2,duration:2,data:{name:'Synthetic action'}}]}],globalLyrics:[],markers:[]};
  CEp.moveGroup([{clip:par.dancers[0].actionClips[0]}],2,300);
  assert.equal(par.dancers[0].actionClips[0].start,dClip(f).start,'与既有整组平移同结果');
});

// ---------- 7. 预告如实（影响范围＝源窗∪目标窗∪重连∪尾段；无「窗外采样不变」） ----------
test('SH-24 预告含影响范围分区与方向性保证、锚点数、终态；无「窗外采样不变」',()=>{
  const f=fixture(1);f.setPath([[2,2,0],[3,3,0],[10,10,0]]);const c=f.clip(2,2);sel(c);
  f.promptQueue=['2~3','2'];f.ctx.shiftSegmentTime();
  const prev=f.confirms[0];
  assert.match(prev,/保持段 \[2→4\]/);
  assert.match(prev,/平移段 \[4→5\]/);
  assert.match(prev,/窗后重连 \[5→10\]/);
  assert.match(prev,/锚点 3/);
  assert.match(prev,/t<a 采样不变/,'Δ>0 方向性保证如实');
  assert.ok(!/窗外采样不变/.test(prev));
});
test('SH-25 无后节点：窗后重连至 END＋终态预告（Δ>0）',()=>{
  const f=fixture(1);f.setPath([[2,2,0],[3,3,0]]);const c=f.clip(2,2);sel(c);
  f.promptQueue=['2~3','2'];f.ctx.shiftSegmentTime();
  assert.match(f.confirms[0],/窗后重连 \[5→END\]/);
  assert.match(f.confirms[0],/终态/);
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
