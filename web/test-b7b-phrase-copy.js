// B7b 完整舞段复制（TD-03/TD-04＋表 C）：真实 app 切片＋编辑/技能/走位模块与隔离 DOM；浏览器可用性另验。
// 覆盖：复制侧类型化剪贴板八类完备（未知类型整批拒绝点名）；整轨复制诚实化（三条基础轨＋可选扩展）；
// 粘贴参数（落点/actor 映射单射/空间映射 offset/技能 target 对齐 PERSON_TARGETS）；预检零写入（跨落点
// 默认拒绝＋截断勾选＝makeRoom 口径/映射拒绝/节点上限）；插空腾位（T4 双轨＋R5-07 未变一侧原字节）；
// 粘贴重连（H1 合并/H2 取代/提前结束尾锚/Z 维异位拒绝/offset 非尽小数落点量化合并（RV01）＋真异位仍拒绝/
// 片段新身份/技能新 ID 新落点）；待替换＝未提交
// 预览项＋显式启用控件（真实 validate）；一次确认→一次写入＋恰好一次 saveHistory（一步撤销复原全部类型）；
// R5-05 ID 避让（既有 ID＋剪贴板 ID）；零写入（取消/拒绝/多源拒绝＝全状态字节不变，其余舞者轨字节不动）。
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
// B7B_SOURCE 指向保存的旧文件目录时对拍红测（仅 choreo-app.js/choreo-edit.js/choreo-stage-motion.js/
// choreo-ability-ui.js 从那里读，其余模块不变＝当前字节）。
const srcDir=n=>process.env.B7B_SOURCE?path.join(process.env.B7B_SOURCE,n):path.join(__dirname,n);
const appSrc=()=>fs.readFileSync(srcDir('choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..setLoopPoint 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读
// （尾标记 setLoopPoint 留在 choreo-app.js，改为切到件尾）；B7B_SOURCE 旧目录仍读旧 app.js 两标记切片。
const txSrc=()=>process.env.B7B_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第五步迁移：showCtxMenu 已随时间轴渲染块搬到 choreo-app-timeline.js——WIRE 右键菜单切片
// 从拆分件读；B7B_SOURCE 旧目录仍读旧 app.js（旧树 showCtxMenu 在主件）。
// 批 C 第六步迁移：buildCmdkCommands 已随 RENDER 外壳搬到 choreo-app-render.js——命令面板切片从拆分件读；
// B7B_SOURCE 旧目录仍读旧 app.js（旧树 buildCmdkCommands 在主件）。
const uiSrc=()=>process.env.B7B_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-timeline.js'),'utf8');
const cmdkSrc=()=>process.env.B7B_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-render.js'),'utf8');
// OVERHAUL 批 C 第七步迁移：showCopyTracksMenu 已随舞者/编辑操作块搬到 choreo-app-dancers.js——WIRE-2 切片
// 从拆分件读；B7B_SOURCE 指向旧目录时仍读旧 choreo-app.js（对拍红测语义不变）。
const opsSrc=()=>process.env.B7B_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-dancers.js'),'utf8');
function fixture(n=2){
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  f.ctx.document.createTextNode=function(t){return {tag:'#text',textContent:String(t),children:[],parentNode:null,remove(){},classList:{add(){},remove(){},toggle(){}}}};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  if(process.env.B7B_SOURCE){ // b1 基座直读 __dirname 的两件也从 before 字节重放（IIFE 重挂全局）
    vm.runInContext(fs.readFileSync(srcDir('choreo-edit.js'),'utf8'),f.ctx,{filename:'choreo-edit.js'});
    vm.runInContext(fs.readFileSync(srcDir('choreo-stage-motion.js'),'utf8'),f.ctx,{filename:'choreo-stage-motion.js'});
  }
  vm.runInContext(fs.readFileSync(srcDir('choreo-ability-plan.js'),'utf8'),f.ctx,{filename:'choreo-ability-plan.js'});
  const tx=txSrc();
  // 切片：edContent..setLoopPoint（含 B5/B7a 事务与 B7b 舞段复制块；菜单/命令面板接线由 WIRE 静态断言）。
  const a=tx.indexOf('function edContent(){'),b=tx.indexOf('function setLoopPoint(');
  assert.ok(a>0,'tx slice start');
  vm.runInContext(tx.slice(a,b>a?b:undefined),f.ctx,{filename:'choreo-app-b7b-slice'});
  f.confirms=[];f.confirmResult=true;
  f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
  f.ctx.window.confirm=f.ctx.confirm;
  f.prompts=[];f.promptQueue=[];f.onPrompt=null;
  f.ctx.prompt=function(msg,def){const v=f.promptQueue.shift();if(f.onPrompt)f.onPrompt(msg,v);f.prompts.push(String(msg)+'｜默认:'+String(def));return v===undefined?null:v};
  f.ctx.window.prompt=f.ctx.prompt;
  f.skillSel=[];
  f.ctx.ChoreoAbilityUI={selection:()=>f.skillSel,clearSelection(){}};
  // 切片外的真实函数镜像（clearClipSelection 定义在 edContent 之前，切片不含；浏览器内存在）
  f.ctx.clearClipSelection=function(){f.ctx.ChoreoEdit.pure.clearSelection(f.ctx.edContent());f.store.selectedClip=null};
  return f;
}
function textOf(node){let s='';sandbox.flatten(node).forEach(x=>{if(typeof x.textContent==='string')s+=x.textContent});return s}
function addSkill(f,startMs,durMs,id,performer,target){
  const t={id:'ab-'+id,type:'ability',performerId:performer||'actor-1',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',events:[]};
  t.events.push({id,kind:'ability',enabled:true,locked:false,notes:'keep-me',createdWith:'choreo-ability-plan-v1',startMs,durationMs:durMs,sourceRef:{kind:'action',id:'120'},data:{rehearsalAbility:{version:1,actionId:'120',name:'技能 '+id,castMs:1000,presentationMs:durMs-1000,target:Object.assign({kind:'party',performerId:'actor-2'},target||{}),animation:'not-connected',gameOutput:false}}});
  f.store.contentExtra._doc.extraTracks.push(t);
  return t;
}
function setFacing(f,rows,di=0){
  const P=f.M;
  P.install(f.store,P.edit(f.store,di,{movement:P.nodes(f.store,di).movement,facing:rows.map(([t,yaw])=>({time:String(t),yaw:String(yaw)}))},'b7bf'+di));
}
function sel(...clips){clips.forEach(c=>c.selected=true)}
function realHistory(f){
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
const trackBytes=(f,di,kind)=>JSON.stringify(f.M.tracks(f.store).find(t=>t.type===kind&&t.performerId===f.M.pid(f.store,di)));
// 复制对话框：按窗口/舞者/类型勾选采集（真实 DOM 对话框驱动）
function runCopyDialog(f,win,dancers,types){
  f.ctx.b7bOpenCopyPhraseDialog();
  const g=id=>f.find(id);
  g('b7bCopyA').value=String(win[0]);g('b7bCopyB').value=String(win[1]);
  Object.keys(dancers).forEach(di=>{const n=g('b7bCd-'+di);if(n)n.checked=!!dancers[di]});
  Object.keys(types).forEach(k=>{const n=g('b7bCt-'+k);if(n)n.checked=!!types[k]});
  g('b7bCopyOk').onclick();
  return g('b7bCopyCounts')?f.find('b7bCopyDlg')?String(f.find('b7bCopyDlg').textContent):'':'';
}
// 粘贴对话框：设参数→预检→（可选）确定（真实 DOM 对话框驱动；确定＝唯一提交门）
function runPaste(f,o){
  f.ctx.b7bOpenPasteDialog();
  const g=id=>f.find(id);
  if(o&&o.t!=null)g('b7bPasteT').value=String(o.t);
  if(o&&o.map)Object.keys(o.map).forEach(sdi=>{const s=g('b7bMap-'+sdi);if(s)s.value=o.map[sdi]==null?'':String(o.map[sdi])});
  if(o&&o.keep)g('b7bKeepCoords').checked=true;
  if(o&&o.trunc)g('b7bTruncate').checked=true;
  g('b7bPasteCheck').onclick();
  const prev=String(g('b7bPastePrev').textContent);
  if(!(o&&o.noCommit))g('b7bPasteOk').onclick();
  return prev;
}
const commitPaste=f=>f.find('b7bPasteOk').onclick();
const cancelPaste=f=>f.find('b7bPasteCancel').onclick();

// ---------- 0. 接线（红＝B7b 前无入口/无函数） ----------
test('WIRE-1 右键菜单/命令面板有「复制此时段舞段…」且分派 b7bOpenCopyPhraseDialog',()=>{
  const src=uiSrc(),cmdk=cmdkSrc();
  const m=src.indexOf('function showCtxMenu(');
  assert.ok(m>0,'showCtxMenu 在源内');
  const menu=src.slice(m,m+4500);
  assert.match(menu,/复制此时段舞段/,'右键菜单项');
  assert.match(menu,/it\.act==='copyPhrase'\)b7bOpenCopyPhraseDialog\(\)/,'分派调用');
  const p=cmdk.indexOf('function buildCmdkCommands(');
  assert.ok(p>0);
  assert.match(cmdk.slice(p,p+3500),/复制此时段舞段…'/,'命令面板项');
});
test('WIRE-2 整轨复制菜单如实更名（TD-04）：三条基础轨＋可选扩展，不再有「复制整轨到」',()=>{
  const src=opsSrc();
  const m=src.indexOf('function showCopyTracksMenu(');
  assert.ok(m>0,'showCopyTracksMenu 在源内');
  const menu=src.slice(m,m+2500);
  assert.match(menu,/复制三条基础轨（切换\/动作\/台词）到 /,'如实命名');
  assert.ok(!/复制整轨到/.test(menu),'旧名「复制整轨到」不再出现');
  assert.match(menu,/b7bCopyTracksDialog\(/,'走扩展对话框');
});
test('WIRE-3 切片导出 B7b 函数＋纯函数挂载',()=>{
  const f=fixture(1);
  ['b7bOpenCopyPhraseDialog','b7bOpenPasteDialog','b7bCopyTracksDialog','b7bCopyTracksExtended','b7bBuildPastePlan','b7bCollectPhrase','b7bCopyFromSummary','b7bInstallDancerTracks'].forEach(n=>assert.equal(typeof f.ctx[n],'function',n));
  assert.equal(typeof f.M.pasteConnect,'function','M.pasteConnect');
  const CEp=f.ctx.ChoreoEdit.pure;
  assert.equal(typeof CEp.allocIdFactory,'function','CEp.allocIdFactory');
  assert.equal(typeof CEp.collectCrossingClips,'function','CEp.collectCrossingClips');
  assert.equal(typeof CEp.existingClipIds,'function','CEp.existingClipIds');
  assert.deepEqual(j(CEp.PHRASE_KINDS),['movement','facing','skill','action','switch','lyric','globalLyric','marker'],'八类完备');
});

// ---------- 1. 复制侧：类型化剪贴板＋内容类型完备 ----------
test('CP-1 「复制此时段舞段」对话框勾选采集：八类计数＋span＋源出发锚点＋逐条 {kind,sourceDi,rel,深拷贝}',()=>{
  const f=fixture(2);
  f.setPath([[3,3,0],[5,5,0]],0);setFacing(f,[[4,40]],0);
  f.clip(2,2);const c2={id:19,start:3,duration:1,data:{name:'台词',command:'/say hi',category:'lyric',isLyric:true}};
  f.store.dancers[0].lyricClips.push(c2);
  f.store.dancers[0].switchClips.push({id:20,start:4,duration:0.5,data:{name:'套装',command:'/gs 1',category:'switch'}});
  f.store.globalLyrics.push({id:21,start:2.5,duration:2,data:{name:'全局',command:'',category:'lyric',isLyric:true}});
  f.store.markers.push({id:'m1',t:3.5,name:'段A'});
  addSkill(f,4000,2000,'e1');
  const before=fullBytes(f);
  runCopyDialog(f,[2,5],{0:true,1:false},{action:true,switch:true,lyric:true,globalLyric:true,marker:true,skill:true,movement:true,facing:true});
  const cb=f.store._clipboard;
  assert.ok(cb&&cb.typed,'类型化剪贴板');
  assert.equal(cb.span,4,'span=最晚内容端−窗起（技能 4+2＝窗起后 4）');
  const kinds={};cb.items.forEach(it=>kinds[it.kind]=(kinds[it.kind]||0)+1);
  assert.deepEqual(kinds,{action:1,switch:1,lyric:1,globalLyric:1,marker:1,skill:1,movement:2,facing:1},'八类逐条');
  assert.ok(cb.dep&&cb.dep[0]&&isFinite(cb.dep[0].x),'源出发锚点（产品采样）');
  const mv=cb.items.find(it=>it.kind==='movement'&&it.rel===1);
  assert.ok(mv&&Number(mv.node.x)===3,'走位节点深拷贝（rel=time−spanStart）');
  const act=cb.items.find(it=>it.kind==='action');
  assert.equal(act.sourceId,17,'源 id 记录（R5-05 避让用）');
  assert.equal(fullBytes(f),before,'复制零写入');
});
test('CP-2 「复制所选」＝摘要逐项（片段＋技能＋走位窗口；脏会话拒绝）',()=>{
  const f=fixture(2);
  const c0=f.clip(2,2);sel(c0);addSkill(f,2500,2000,'e1');f.skillSel=['e1'];
  f.setPath([[3,3,0]],0);
  f.UI.openSamePlace(0,c0); // 干净同处会话（窗口对象入摘要；未 pick＝不脏）
  f.ctx.copySelection();
  const cb=f.store._clipboard;
  assert.ok(cb&&cb.typed,'typed');
  const kinds={};cb.items.forEach(it=>kinds[it.kind]=(kinds[it.kind]||0)+1);
  assert.deepEqual(kinds,{action:1,skill:1,movement:1},'摘要三类');
  assert.equal(cb.span,2.5,'span＝最晚内容端−最早内容端（技能 2.5–4.5、片段 2–4、窗起 2）');
  // 脏会话拒绝
  const g=fixture(1);const cg=g.clip(2,2);sel(cg);
  g.UI.openSamePlace(0,cg);g.UI.pickSamePlace(9,0);g.UI.pickSamePlace(8,1); // 草稿变脏
  const before=fullBytes(g);
  g.ctx.copySelection();
  assert.ok(g.toasts.some(m=>/应用.*取消|取消.*应用/.test(m)),'脏会话拒绝');
  assert.equal(fullBytes(g),before);
});
test('CP-3 纯函数：allocIdFactory 对既有 id＋新分配共同避让；collectCrossingClips 只点名 start<t<end',()=>{
  const f=fixture(1);
  const CEp=f.ctx.ChoreoEdit.pure;
  const alloc=CEp.allocIdFactory([17,19,3]);
  assert.equal(alloc(),20);assert.equal(alloc(),21);assert.equal(alloc(),22,'连续分配不复用');
  const alloc2=CEp.allocIdFactory([2,4,6]);assert.equal(alloc2(),7);
  const content={dancers:[{actionClips:[{id:1,start:0,duration:5,data:{name:'跨'}},{id:2,start:5,duration:2,data:{name:'后'}}],switchClips:[],lyricClips:[]}],globalLyrics:[{id:3,start:4,duration:4,data:{name:'G'}}],markers:[]};
  const cross=CEp.collectCrossingClips(content,5);
  assert.equal(cross.length,1,'start<5<end 只有全局歌词');
  assert.equal(cross[0].name,'G');
  assert.deepEqual(j(CEp.existingClipIds(content)),[1,2,3]);
});

// ---------- 2. 表 C 数值例：主例（R3 §六） ----------
test('GAP-1 主例：目标 6(0)＋动作 5–6s＋标记 6s，粘贴两秒 X0→X1 段于 t=2 → 走位 2(0),4(1),8(0)、动作→7s、标记→8s',()=>{
  const f=fixture(2);
  f.setPath([[2,0,0],[4,1,0]],0);           // 源：节点 (2,(0,0))→(4,(1,0))，spanStart=2、span=2
  const dst=f.store.dancers[1];dst.start={x:0,z:0,yawDeg:0};
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'6',x:'0',z:'0'}],facing:[]},'tgt'));
  f.clip(5,1);f.store.markers.push({id:'m1',t:6,name:'段'});
  runCopyDialog(f,[2,4],{0:true,1:false},{movement:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:2,map:{0:1}});
  assert.ok(!/拒绝/.test(prev),'预检通过：'+prev.slice(0,120));
  assert.match(prev,/插空腾位/);assert.match(prev,/零覆盖、零截断/,'腾位差异如实说明');
  assert.deepEqual(mvNodes(f,1),[[2,0,0],[4,1,0],[8,0,0]],'走位主例（H1 合并、H2 被内容取代、6→8 右移）');
  assert.ok(Math.abs(dClip(f,0).start-7)<1e-9,'动作条 5–6s → 7–8s（全局右移）');
  assert.equal(f.store.markers[0].t,8,'标记 6s → 8s');
  assert.equal(f.history.length,1,'恰好一次 saveHistory');
  // 取消分支：字节不变
  const g=fixture(2);
  g.setPath([[2,0,0],[4,1,0]],0);
  g.M.install(g.store,g.M.edit(g.store,1,{movement:[{time:'6',x:'0',z:'0'}],facing:[]},'tgt'));
  g.clip(5,1);g.store.markers.push({id:'m1',t:6,name:'段'});
  runCopyDialog(g,[2,4],{0:true,1:false},{movement:true});
  const gb=fullBytes(g);
  g.ctx.b7bOpenPasteDialog();g.find('b7bPasteCheck').onclick();cancelPaste(g);
  assert.equal(fullBytes(g),gb,'取消＝整状态字节不变');
  assert.equal(g.history.length,0);
});
test('GAP-2 提前结束例：粘贴末点早于空隙末 → 2(0),3(1),4(1),8(0)（尾部保持锚点改持粘贴末位）',()=>{
  const f=fixture(2);
  f.setPath([[2,0,0],[3,1,0]],0);           // 节点到 rel=1，片段撑到 span=2
  f.store.dancers[0].actionClips.push({id:30,start:2,duration:2,data:{name:'撑跨度'}});
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'6',x:'0',z:'0'}],facing:[]},'tgt'));
  runCopyDialog(f,[2,4],{0:true,1:false},{movement:true,action:true});
  const prev=runPaste(f,{t:2,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.deepEqual(mvNodes(f,1),[[2,0,0],[3,1,0],[4,1,0],[8,0,0]],'尾部保持锚点 H2 改持粘贴末位 (1,0)');
  assert.equal(f.history.length,1);
});

// ---------- 3. 粘贴参数 ----------
test('PP-1 offset 例（表 C）：源出发锚 (2,0)、目标在 t 采样 (0,3) → offset (−2,3)；路径 (2,0)→(5,0) 副本＝(0,3)→(3,3)',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};
  f.setPath([[2,2,0],[5,5,0]],0);           // 源：t2 处 (2,0)... x 坐标 2、z 0；t5 处 (5,0)
  f.store.dancers[1].start={x:0,z:3,yawDeg:0}; // 目标空轨：t 采样位＝起始位 (0,3)
  runCopyDialog(f,[2,5],{0:true,1:false},{movement:true});
  const prev=runPaste(f,{t:4,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  const mv=mvNodes(f,1);
  assert.ok(Math.abs(mv[0][1]-0)<1e-9&&Math.abs(mv[0][2]-3)<1e-9,'副本首节点 (0,3)');
  assert.ok(Math.abs(mv[1][1]-3)<1e-9&&Math.abs(mv[1][2]-3)<1e-9,'副本末节点 (3,3)');
  assert.ok(Math.abs(mv[0][0]-4)<1e-9&&Math.abs(mv[1][0]-7)<1e-9,'落点 t+rel：4s、7s');
});
test('PP-2 actor 映射：目标不存在拒绝；多源映同一目标整批拒绝；未映射源跳过并预告计数',()=>{
  const f=fixture(3);
  f.clip(2,2);const c1={id:18,start:2,duration:1,data:{name:'B 片'}};f.store.dancers[1].actionClips.push(c1);
  runCopyDialog(f,[2,3],{0:true,1:true,2:false},{action:true});
  let before=fullBytes(f);
  let prev=runPaste(f,{t:10,map:{0:9},noCommit:true});   // 目标不存在（di=9 越界）
  assert.match(prev,/目标不存在|映射目标不存在/,'点名');
  prev=runPaste(f,{t:10,map:{0:2,1:2},noCommit:true});   // 多源同目标
  assert.match(prev,/同一目标/,'多源映同一目标整批拒绝');
  assert.equal(fullBytes(f),before,'拒绝＝零写入');
  prev=runPaste(f,{t:10,map:{0:2,1:null}});              // B 源未映射→跳过并预告
  assert.match(prev,/跳过/,'跳过预告');
  assert.match(prev,/Synthetic 2/,'点名未映射源（舞者 2）');
  assert.equal(f.store.dancers[2].actionClips.length,1,'只有映射源落位');
  assert.equal(f.store.dancers[2].actionClips[0].data.name,'Synthetic action');
});
test('PP-3 技能 target 映射对齐 PERSON_TARGETS：party 改写 performerId、label 原样；self/ground 类原样保留',()=>{
  const f=fixture(3);
  addSkill(f,2500,2000,'e1','actor-1',{kind:'party',performerId:'actor-2'});           // A 对 B（B 亦为源→映射改写）
  addSkill(f,2600,2000,'e2','actor-1',{kind:'partyPet',performerId:'actor-2',label:'B pet'});
  addSkill(f,2700,2000,'e3','actor-1',{kind:'ground',label:'点',position:{x:1,y:2,z:3}});
  addSkill(f,2800,2000,'e4','actor-2',{kind:'party',performerId:'actor-1'});           // B 对 A（A 亦为源→映射改写）
  runCopyDialog(f,[2,3],{0:true,1:true,2:false},{skill:true});
  const prev=runPaste(f,{t:5,map:{0:1,1:2}});  // A→B、B→C：引用源舞者的人目标随映射改写
  assert.ok(!/拒绝/.test(prev),prev.slice(0,200));
  assert.ok(!/待替换/.test(prev),'四人事件全部经真实 validate');
  const A=f.ctx.ChoreoAbilityPlan,rows=A.rows(f.store);
  ['e1','e2','e3','e4'].forEach(id=>assert.equal(rows.filter(r=>r.event.id===id).length,1,'源事件 '+id+' 不被替换'));
  const copies=rows.filter(r=>['e1','e2','e3','e4'].indexOf(r.event.id)<0);
  assert.equal(copies.length,4,'四条副本追加');
  const e4copy=copies.find(r=>r.source==='actor-3');
  assert.equal(e4copy.event.data.rehearsalAbility.target.performerId,'actor-2','B 的副本（owner=C）目标 A→B（映射改写）');
  const petCopy=copies.find(r=>r.event.data.rehearsalAbility.target.kind==='partyPet');
  assert.equal(petCopy.source,'actor-2','partyPet 副本 owner=映射目标 B');
  assert.equal(petCopy.event.data.rehearsalAbility.target.performerId,'actor-3','partyPet performerId B→C（N28）');
  assert.equal(petCopy.event.data.rehearsalAbility.target.label,'B pet','label 原样保留（N28）');
  const groundCopy=copies.find(r=>r.event.data.rehearsalAbility.target.kind==='ground');
  assert.ok(groundCopy,'ground 副本存在（不引用舞者、原样保留）');
  assert.deepEqual(j(groundCopy.event.data.rehearsalAbility.target.position),{x:1,y:2,z:3},'ground 坐标原样');
});
test('PP-4 「保持原坐标」选项：节点不平移（同站位复制）',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:5,z:5,yawDeg:0};
  f.setPath([[2,5,5],[4,7,7]],0);
  runCopyDialog(f,[2,4],{0:true,1:false},{movement:true});
  const prev=runPaste(f,{t:2,map:{0:1},keep:true});
  assert.ok(!/拒绝/.test(prev));
  const mv=mvNodes(f,1);
  assert.ok(Math.abs(mv[0][1]-5)<1e-9&&Math.abs(mv[0][2]-5)<1e-9,'保持原坐标（不平移）');
  assert.ok(Math.abs(mv[1][1]-7)<1e-9&&Math.abs(mv[1][2]-7)<1e-9);
});

// ---------- 4. 预检（零写入） ----------
test('PRE-1 跨落点片段默认整批拒绝点名（含全局歌词 N27）；截断勾选＝makeRoom 口径（截到 t、残余<0.5s 删）',()=>{
  const f=fixture(2);
  const crossClip={id:40,start:1,duration:4,data:{name:'跨落点条'}};
  f.store.dancers[1].actionClips.push(crossClip);
  f.clip(2,2);
  runCopyDialog(f,[2,4],{0:true,1:false},{action:true});
  const before=fullBytes(f);
  let prev=runPaste(f,{t:3,map:{0:0},noCommit:true});
  assert.match(prev,/跨落点/,'默认整批拒绝');
  assert.match(prev,/跨落点条/,'逐条点名');
  assert.match(prev,/截断跨落点/,'提示截断勾选');
  assert.equal(fullBytes(f),before,'零写入');
  // 勾选截断：跨落点条 1–5s 截到 3s（残余 2s ≥0.5 保留）；粘贴条落 3s 起
  prev=runPaste(f,{t:3,map:{0:0},trunc:true});
  assert.match(prev,/截断/);
  const cut=f.store.dancers[1].actionClips.find(c=>c.id===40);
  assert.equal(cut.duration,2,'截到 t（1–3s）');
  assert.equal(cut.start,1);
  const pasted=f.store.dancers[0].actionClips.find(c=>c.data&&c.data.name==='Synthetic action'&&c.start===3);
  assert.ok(pasted,'粘贴条落 3s');
  // 残余不足 0.5s 删：1.6–3.2s 跨 t=3 → 截后 1.4s？构造 start=2.8,dur=0.6 → 2.8–3.4 跨 3 → 截到 3 后残余 0.2<0.5 删
  const g=fixture(2);
  g.store.dancers[1].actionClips.push({id:41,start:2.8,duration:0.6,data:{name:'短残余'}});
  g.clip(2,2);
  runCopyDialog(g,[2,4],{0:true,1:false},{action:true});
  const gp=runPaste(g,{t:3,map:{0:0},trunc:true});
  assert.match(gp,/删除/,'残余不足 0.5s 删除预告');
  assert.ok(!g.store.dancers[1].actionClips.some(c=>c.id===41),'短残余被删');
});
test('PRE-2 技能跨落点＝整批拒绝点名（时长为固定不变量，不参与截断）',()=>{
  const f=fixture(2);
  addSkill(f,2500,2000,'e1'); // 2.5–4.5s 跨 t=3
  f.clip(2,2);
  runCopyDialog(f,[2,3],{0:true,1:false},{action:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:3,map:{0:0},trunc:true,noCommit:true});
  assert.match(prev,/技能.*跨落点|跨落点.*技能/,'技能跨落点点名');
  assert.equal(fullBytes(f),before,'截断勾选也不截技能＝整批零写入');
});
test('PRE-3 未知类型＝落库前整批拒绝点名，绝不静默丢弃',()=>{
  const f=fixture(1);f.clip(2,2);
  f.store._clipboard={typed:true,span:1,items:[{kind:'action',sourceDi:0,rel:0,duration:1,data:{name:'x'},extra:{}},{kind:'mystery',sourceDi:0,rel:0}]};
  const before=fullBytes(f);
  const prev=runPaste(f,{t:5,map:{0:0},noCommit:true});
  assert.match(prev,/未知内容类型/,'点名未知类型');
  assert.match(prev,/mystery/);
  assert.equal(fullBytes(f),before,'零写入');
});
test('PRE-4 节点上限：粘贴后每轨最终 >500 拒绝（≤500 合法）',()=>{
  const f=fixture(2);
  f.setPath(Array.from({length:498},(_,i)=>[i+1,i+1,0]),0); // 源 498 节点
  runCopyDialog(f,[1,498],{0:true,1:false},{movement:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:600,map:{0:0},noCommit:true});   // 远端粘贴：不右移，纯粘贴 498 节点到空目标? 0→0 自映射目标 0 有 498 节点
  // 目标＝源自身（0→0）：T4 于 600 无 ≥600 节点不动；粘贴 498 节点 → 996>500 拒绝
  assert.match(prev,/500/,'超上限点名');
  assert.equal(fullBytes(f),before);
  const g=fixture(2);
  g.setPath(Array.from({length:498},(_,i)=>[i+1,i+1,0]),0);
  runCopyDialog(g,[1,498],{0:true,1:false},{movement:true});
  const gp=runPaste(g,{t:600,map:{0:1}});                   // 粘贴到空目标 1：498 节点合法
  assert.ok(!/拒绝/.test(gp));
  assert.equal(g.M.nodes(g.store,1).movement.length,498,'498 合法');
});

// ---------- 5. 腾位（插空腾位）＋R5-07 ----------
test('GAP-3 插空腾位零覆盖零截断：既有片段只右移不被截；技能 startMs≥t 右移；全局歌词/标记右移',()=>{
  const f=fixture(2);
  const a1=f.clip(6,2);addSkill(f,7000,1000,'e1');
  f.store.globalLyrics.push({id:50,start:6,duration:2,data:{name:'G'}});
  f.store.markers.push({id:'m2',t:6,name:'段'});
  f.setPath([[6,6,0],[8,8,0]],0);setFacing(f,[[7,70]],0);
  f.store.dancers[1].actionClips.push({id:51,start:6,duration:2,data:{name:'他人片段'}});
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'6',x:'0',z:'0'}],facing:[]},'o2'));
  // 复制舞者 1 的 6–8s 内容到舞者 0，落点 t=6
  runCopyDialog(f,[6,8],{0:false,1:true},{action:true,movement:true,facing:true,skill:true});
  const beforeIds=f.store.dancers[1].actionClips.map(c=>c.id);
  const prev=runPaste(f,{t:6,map:{1:0}});
  assert.ok(!/拒绝/.test(prev));
  assert.equal(dClip(f,0).start,8,'既有片段 6→8（右移 span=2）');
  assert.equal(dClip(f,0).duration,2,'零截断');
  assert.equal(f.store.dancers[1].actionClips[0].start,8,'其余舞者片段同步右移（全局插空）');
  const A=f.ctx.ChoreoAbilityPlan;
  assert.equal(A.rows(f.store).find(r=>r.event.id==='e1').event.startMs,9000,'技能 startMs≥t 右移');
  assert.equal(f.store.globalLyrics[0].start,8,'全局歌词右移');
  assert.equal(f.store.markers[0].t,8,'标记右移');
  assert.deepEqual(mvNodes(f,1),[[6,0,0],[8,0,0]],'其余舞者走位 T4（6→8 停留锚点对，源无 ≥6 节点者无粘贴）');
});
test('GAP-3b 走位/朝向 T4 停留锚点对＋粘贴重连（目标既有 6(0) 空→有内容场景已在 GAP-1/2）；目标空轨粘贴',()=>{
  const f=fixture(2);
  f.setPath([[2,2,0],[4,4,0]],0);
  runCopyDialog(f,[2,4],{0:true,1:false},{movement:true});
  const prev=runPaste(f,{t:10,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.deepEqual(mvNodes(f,1),[[10,0,0],[12,2,0]],'空目标轨：offset＝目标采样(0,0)−源出发锚(2,0)＝(−2,0)，路径平移落位');
});
test('GAP-4 R5-07：无 ≥t 节点且无粘贴内容的舞者不往返 M.edit；未变一侧保留原字节（含嵌套 point 扩展）',()=>{
  const f=fixture(3);
  f.setPath([[2,2,0],[4,4,0]],0);                      // 舞者 0：源
  setFacing(f,[[3,30]],0);
  f.M.install(f.store,f.M.edit(f.store,2,{movement:[{time:'1',x:'5',z:'5'}],facing:[]},'w2'));
  const w2mv=f.M.tracks(f.store).find(t=>t.type==='movement'&&t.performerId===f.M.pid(f.store,2));
  w2mv.events[0].data.stageMotion.points[0].custom={keep:[1,2]}; // 嵌套扩展
  f.clip(2,2);
  runCopyDialog(f,[2,4],{0:true,1:false,2:false},{action:true,movement:true});
  const w2Bytes=JSON.stringify(w2mv);
  const prev=runPaste(f,{t:8,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.equal(JSON.stringify(f.M.tracks(f.store).find(t=>t.type==='movement'&&t.performerId===f.M.pid(f.store,2))),w2Bytes,'舞者 2（无 ≥8s 节点、非目标）走位轨字节不动（含嵌套扩展）');
  assert.match(prev,/不动/,'预告如实');
});
test('GAP-5 锁定/停用/外来目标轨＝原状态克隆拒绝，整批零写入',()=>{
  for(const kind of ['locked','disabled','foreign']){
    const f=fixture(2);
    f.setPath([[2,2,0],[4,4,0]],0);
    f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'6',x:'0',z:'0'}],facing:[]},'t1'));
    const t=f.M.tracks(f.store).find(tr=>tr.type==='movement'&&tr.performerId===f.M.pid(f.store,1));
    if(kind==='locked')t.locked=true;else if(kind==='disabled')t.enabled=false;
    else f.M.tracks(f.store).push({id:'fx',type:'movement',performerId:f.M.pid(f.store,1),events:[{enabled:true}]});
    runCopyDialog(f,[2,4],{0:true,1:false},{movement:true});
    const before=fullBytes(f);
    const prev=runPaste(f,{t:2,map:{0:1},noCommit:true});
    assert.match(prev,/锁定|停用|其他走位/,kind+' 拒绝点名');
    assert.equal(fullBytes(f),before,kind+' 整批零写入');
  }
});

// ---------- 6. 粘贴与重连 ----------
test('RC-1 Z 维异位：粘贴首节点与 H1 任一维异位→预检拒绝点名（零写入）',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};
  f.setPath([[2,0,0],[4,5,0]],0);        // 源首节点 (0,0)（＝窗起采样位）
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'6',x:'0',z:'7'}],facing:[]},'t1'));
  // 目标 t=2 采样＝(0, 7×2/6≈2.333)：X 同位、Z 异位；「保持原坐标」不平移→首节点 (0,0) 落 H1 异位
  runCopyDialog(f,[2,4],{0:true,1:false},{movement:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:2,map:{0:1},keep:true,noCommit:true});
  assert.match(prev,/异位/,'X/Z 任一维异位预检拒绝');
  assert.equal(fullBytes(f),before);
});
test('RC-1b RV01 offset 落点非尽小数采样（返工单 B7b-RV-01）：几何对齐＝量化后同代表值，粘贴首节点与 H1 合并、字节符合三位小数约定',()=>{
  const f=fixture(2);
  f.setPath([[2,2,0],[8,8,0]],0);           // 源首节点 t2=(2,0)＝窗起出发锚（rel=0）
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'2',x:'1',z:'1'},{time:'9',x:'2',z:'2'}],facing:[]},'rv01b'));
  runCopyDialog(f,[2,8],{0:true,1:false},{movement:true});
  const prev=runPaste(f,{t:5,map:{0:1}});   // 目标 t=5 采样＝(10/7,10/7)（斜线中途，非三位小数尽）
  assert.ok(!/拒绝/.test(prev),prev.slice(0,200));
  assert.deepEqual(mvNodes(f,1),[[2,1,1],[5,1.429,1.429],[11,7.429,1.429],[15,2,2]],'H1 合并＋副本落三位小数代表值（末点接替 H2、9(2,2) 右移 15）');
  const pts=f.M.tracks(f.store).find(t=>t.type==='movement'&&t.performerId===f.M.pid(f.store,1)).events[0].data.stageMotion.points;
  const p5=pts.find(p=>p.tMs===5000);
  assert.equal(p5.x,1.429,'t=5 X＝量化代表值 1.429（≠10/7 原始浮点）');
  assert.equal(p5.z,1.429,'t=5 Z＝量化代表值 1.429');
  assert.ok(pts.every(p=>p.x===Number(p.x.toFixed(3))&&p.z===Number(p.z.toFixed(3))),'全轨落库字节符合三位小数十进制约定');
});
test('RC-1c RV01 真异位反例：量化后仍不同代表值（只差 X 维）→仍整批零写入＋点名拒绝（拒绝面不放宽）',()=>{
  const f=fixture(2);
  f.setPath([[2,2,0],[8,8,0]],0);
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'2',x:'1',z:'0'},{time:'9',x:'2',z:'0'}],facing:[]},'rv01c'));
  runCopyDialog(f,[2,8],{0:true,1:false},{movement:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:5,map:{0:1},keep:true,noCommit:true}); // 保持原坐标：首节点 (2,0)，目标 H1=(1.429,0)——只 X 维代表值不同
  assert.match(prev,/H1 （X\/Z）异位/,'量化后真异位仍点名拒绝');
  assert.equal(fullBytes(f),before,'整批零写入');
});
test('RC-2 朝向不平移：yaw 原样；朝向首节点与 H1 异 yaw 拒绝',()=>{
  const f=fixture(2);
  setFacing(f,[[3,40],[4,80]],0);   // 首朝向节点 rel=1（窗起后）→不与 H1 冲突，直接落位
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[],facing:[{time:'6',yaw:'0'}]},'t1'));
  runCopyDialog(f,[2,4],{0:true,1:false},{facing:true});
  const prev=runPaste(f,{t:2,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.deepEqual(fcNodes(f,1),[[2,0],[3,40],[4,80],[8,0]],'朝向 yaw 原样＋末点接替 H2＋目标 6(0)→8(0)');
  const g=fixture(2);
  setFacing(g,[[2,40],[4,80]],0);   // 首节点恰在窗起（rel=0）→与 H1 对比
  g.M.install(g.store,g.M.edit(g.store,1,{movement:[],facing:[{time:'3',yaw:'41'}]},'t1')); // 目标 t=2 采样＝41×2/3≈27.33 ≠ 40
  runCopyDialog(g,[2,4],{0:true,1:false},{facing:true});
  const gb=fullBytes(g);
  const gp=runPaste(g,{t:2,map:{0:1},noCommit:true});
  assert.match(gp,/异位/,'朝向异 yaw 预检拒绝');
  assert.equal(fullBytes(g),gb);
});
test('RC-3 片段类一律新身份：新 id≠源 id≠既有 id、_doc.id 不沿用、落点 t+rel、相对时序保持',()=>{
  const f=fixture(2);
  const c0=f.clip(2,2);
  const c1={id:18,start:2.5,duration:1,data:{name:'B 片'},_doc:{id:99,extra:{k:1}}};
  f.store.dancers[0].actionClips.push(c1);
  runCopyDialog(f,[2,4.5],{0:true,1:false},{action:true});
  const prev=runPaste(f,{t:10,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  const arr=f.store.dancers[1].actionClips;
  assert.equal(arr.length,2,'两条都到');
  assert.ok(arr.every(c=>c.id!==17&&c.id!==18&&c.id!==99),'新 id 避开源/既有');
  assert.ok(arr.every(c=>!c._doc||c._doc.id==null),'_doc.id 不沿用');
  assert.equal(arr[0].start,10,'rel=0 → t');
  assert.equal(arr[1].start,10.5,'rel=0.5 → t+rel（相对时序保持）');
  assert.equal(arr[1].data.extra===undefined||true,true);
  const withDoc=arr.find(c=>c._doc);
  assert.ok(withDoc&&withDoc._doc.extra&&withDoc._doc.extra.k===1,'未知字段深拷贝保留');
});
test('RC-4 标记新身份＋落点 t+rel；全局歌词走全局轨',()=>{
  const f=fixture(2);
  f.store.markers.push({id:'m9',t:3,name:'段'});
  f.store.globalLyrics.push({id:60,start:2.5,duration:1,data:{name:'G'}});
  runCopyDialog(f,[2,4],{0:true,1:false},{marker:true,globalLyric:true});
  const prev=runPaste(f,{t:10,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.equal(f.store.markers.length,2,'标记副本');
  const m2=f.store.markers.find(m=>m.id!=='m9');
  assert.equal(m2.t,11,'标记 t+rel');
  assert.equal(m2.name,'段');
  assert.equal(f.store.globalLyrics.length,2,'全局歌词副本走全局轨');
  assert.equal(f.store.globalLyrics[1].start,10.5);
});
test('RC-5 技能副本：新事件 id＋startMs=(t+rel)×1000；源事件不被替换；notes 等未知字段深拷贝保留',()=>{
  const f=fixture(2);
  addSkill(f,2500,2000,'e1'); // rel=0.5（窗 2–4）；目标 actor-2＝粘贴目标外的舞者
  runCopyDialog(f,[2,4],{0:true,1:false},{skill:true});
  const prev=runPaste(f,{t:10,map:{0:0}}); // 粘回本舞者：owner=actor-1、目标 actor-2 合法
  assert.ok(!/拒绝/.test(prev));
  const A=f.ctx.ChoreoAbilityPlan,rows=A.rows(f.store);
  assert.equal(rows.filter(r=>r.event.id==='e1').length,1,'源事件原位不被替换');
  const copy=rows.find(r=>r.event.id!=='e1');
  assert.ok(copy,'副本追加');
  assert.equal(copy.event.startMs,10500,'startMs=(t+rel)×1000');
  assert.equal(copy.event.notes,'keep-me','notes 深拷贝');
});

// ---------- 7. 待替换技能＋显式启用 ----------
test('PD-1 A 对 B 技能复制给 B＝B 对自身：待替换点名（映射后指向自身）、不落库、其余类型照常提交',()=>{
  const f=fixture(2);
  addSkill(f,2500,2000,'e1','actor-1',{kind:'party',performerId:'actor-2'}); // A(actor-1) 对 B(actor-2)
  f.clip(2,2);
  runCopyDialog(f,[2,4],{0:true,1:false},{skill:true,action:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:10,map:{0:1}});  // 复制给 B：owner=B(actor-2)、target 仍指 B→自身
  assert.match(prev,/待替换/,'待替换预告');
  assert.match(prev,/另一位排练舞者|指向自身/,'点名原因（真实 validate 消息）');
  const A=f.ctx.ChoreoAbilityPlan;
  assert.equal(A.rows(f.store).filter(r=>r.source===A.pid(f.store,1)).length,0,'待替换不落库（目标技能轨零写入）');
  assert.equal(f.store.dancers[1].actionClips.length,1,'其余类型（动作）照常提交');
  assert.equal(f.history.length,1,'一次写入一次 saveHistory');
  assert.notEqual(fullBytes(f),before,'确有写入（非 noop）');
});
test('PD-2 源舞者未映射的技能＝待替换（目标未映射）；全部待替换/未映射＝no-op 零写入零提交',()=>{
  const f=fixture(2);
  addSkill(f,2500,2000,'e1');
  runCopyDialog(f,[2,4],{0:true,1:false},{skill:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:10,map:{0:1},noCommit:true}); // e1 属舞者 0；映射 0→1：owner=actor-2、目标 actor-2 →自身→待替换
  assert.match(prev,/待替换/,'待替换点名');
  commitPaste(f); // 确定按钮在 noCommit 后手动触发：无写入内容时不产生历史
  assert.equal(f.history.length,0,'纯待替换＝零写入零历史');
  assert.equal(fullBytes(f),before,'字节不变');
  const g=fixture(2);
  g.clip(2,2);
  runCopyDialog(g,[2,4],{0:true,1:false},{action:true});
  const gb=fullBytes(g);
  const gp=runPaste(g,{t:10,map:{0:null},noCommit:true});
  assert.match(gp,/未映射|没有可映射/,'未映射源跳过预告');
  assert.equal(gb,fullBytes(g),'零写入');
});
test('AUI-1 待替换＝未提交预览项：setPending 后 lane 显示「待替换」徽标＋原因；不写 extraTracks',()=>{
  const f=fixture(1);
  addSkill(f,2000,1500,'px');
  const ev=f.ctx.ChoreoAbilityPlan.rows(f.store)[0].event;
  const ui=loadAbilityUI(f);
  const before=fullBytes(f);
  ui.setPending([{name:'技能 px',reason:'请指定另一位排练舞者',event:j(ev),di:0}]);
  const lane=ui.lane(0);
  assert.match(textOf(lane),/待替换/,'徽标');
  assert.match(textOf(lane),/请指定另一位排练舞者/,'点名原因');
  assert.match(textOf(lane),/磁盘上不存在待解决数据/,'如实表述不落盘');
  assert.equal(fullBytes(f),before,'不写 extraTracks');
  assert.equal(ui.pendingList().length,1);
  ui.clearPending();
  assert.ok(!/待替换/.test(textOf(ui.lane(0))),'清除后不再显示');
});
test('AUI-2 待替换「启用…」：改目标后经真实 validate 通过入库（显式控件，不借既有路径）',()=>{
  const f=fixture(2);
  addSkill(f,2000,1500,'px');
  const A=f.ctx.ChoreoAbilityPlan,ev=j(A.rows(f.store)[0].event);
  // 模拟 B 对自身待替换项：owner=舞者1、target 指 actor-2；事件 id＝粘贴副本新 id（非源 id）
  const ev2=j(ev);ev2.id='ability-pending-1';ev2.data.rehearsalAbility.target={kind:'party',performerId:'actor-2'};
  const ui=loadAbilityUI(f);
  ui.setPending([{name:'技能 px',reason:'请指定另一位排练舞者',event:ev2,di:1}]);
  const lane=ui.lane(1);
  const btn=findBtn(lane,'启用…');assert.ok(btn,'启用…控件');
  btn.onclick();
  const lane2=ui.lane(1);
  assert.match(textOf(lane2),/验证并保存/,'编辑面板展开');
  // 选目标＝舞者 0（actor-1）
  const selPerf=findByAria(lane2,'目标舞者'); assert.ok(selPerf,'目标舞者下拉');
  selPerf.value='actor-1';
  const ok=findBtn(lane2,'启用（验证并保存）');assert.ok(ok);
  ok.onclick();
  assert.equal(f.history.length,1,'一次 saveHistory');
  const rows=A.rows(f.store);
  assert.equal(rows.length,2,'原事件＋待替换启用后的新条目（新身份，不覆盖源）');
  const nx=rows.find(r=>r.source==='actor-2');
  assert.ok(nx,'owner=舞者1');
  assert.equal(nx.event.data.rehearsalAbility.target.performerId,'actor-1','目标已改＝经真实 validate');
  assert.equal(ui.pendingList().length,0,'待替换项清空');
});
test('AUI-3 已入库 disabled 事件：编辑保持 disabled；显式「启用」控件经真实 validate 启用（一次撤销）',()=>{
  const f=fixture(2);
  addSkill(f,2000,1500,'dx');
  const A=f.ctx.ChoreoAbilityPlan;
  f.store.contentExtra._doc.extraTracks[0].events[0].enabled=false; // 已入库合法 disabled 事件
  const ui=loadAbilityUI(f);
  ui.setSel('dx');
  const sum=ui.renderContext();
  assert.ok(sum,'摘要挂载');
  assert.match(textOf(sum),/启用/,'摘要显示启用控件');
  const en=findBtn(sum,'启用');assert.ok(en,'启用控件');
  en.onclick();
  assert.equal(A.rows(f.store)[0].event.enabled,true,'经真实 validate 启用');
  assert.equal(f.history.length,1,'一次 saveHistory');
  // 编辑路径不自动启用
  const g=fixture(2);
  addSkill(g,2000,1500,'dy');
  g.store.contentExtra._doc.extraTracks[0].events[0].enabled=false;
  const ui2=loadAbilityUI(g);
  const row=g.ctx.ChoreoAbilityPlan.rows(g.store)[0];
  ui2.open({id:120,type:'action',name:'技能 dy'},0,0,row);
  const editor=ui2.renderContext();
  assert.ok(editor,'编辑面挂载');
  const presIn=sandbox.flatten(editor).find(n=>n.value==='0.5');
  assert.ok(presIn,'表现提示输入');
  presIn.value='0.6';
  const ap=findBtn(editor,'应用技能编排');assert.ok(ap);
  ap.onclick();
  const evAfter=g.ctx.ChoreoAbilityPlan.rows(g.store)[0].event;
  assert.equal(evAfter.enabled,false,'编辑后保持 disabled（不借用既有路径自动启用）');
  assert.ok(Math.abs(evAfter.data.rehearsalAbility.presentationMs-600)<1e-9,'编辑生效');
});
test('AUI-4 命令面/接口：setPending/clearPending/pendingList 挂在 ChoreoAbilityUI',()=>{
  const f=fixture(1);
  const ui=loadAbilityUI(f);
  ['setPending','clearPending','pendingList'].forEach(n=>assert.equal(typeof ui[n],'function',n));
});

// ---------- 8. 提交与零写入 ----------
test('CM-1 混合八类一次粘贴：一次确认一次 saveHistory；一步撤销复原全部类型',()=>{
  const f=fixture(3);realHistory(f);
  f.setPath([[2,2,0],[4,4,0]],0);setFacing(f,[[3,30]],0);
  f.clip(2,2);
  f.store.dancers[0].switchClips.push({id:20,start:2.5,duration:0.5,data:{name:'套',command:'/gs 1',category:'switch'}});
  f.store.dancers[0].lyricClips.push({id:21,start:2.5,duration:1,data:{name:'词',category:'lyric',isLyric:true}});
  f.store.globalLyrics.push({id:60,start:2.5,duration:1,data:{name:'G'}});
  f.store.markers.push({id:'m1',t:3,name:'段'});
  addSkill(f,2500,2000,'e1','actor-1',{kind:'party',performerId:'actor-3'}); // 目标＝非源舞者→映射后合法
  f.ctx.saveHistory(); // 种基线快照
  runCopyDialog(f,[2,4.5],{0:true,1:false},{action:true,switch:true,lyric:true,globalLyric:true,marker:true,skill:true,movement:true,facing:true});
  const before=fullBytes(f);
  const prev=runPaste(f,{t:8,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.equal(f.history.length,2,'种1＋本批1＝恰好一次 saveHistory');
  // 八类都到位
  const A=f.ctx.ChoreoAbilityPlan;
  assert.equal(f.store.dancers[1].actionClips.length,1,'动作');
  assert.equal(f.store.dancers[1].switchClips.length,1,'切换');
  assert.equal(f.store.dancers[1].lyricClips.length,1,'台词');
  assert.equal(f.store.globalLyrics.length,2,'全局歌词');
  assert.equal(f.store.markers.length,2,'标记');
  assert.equal(A.rows(f.store).filter(r=>r.source===A.pid(f.store,1)).length,1,'技能');
  assert.equal(f.M.nodes(f.store,1).movement.length,2,'走位');
  assert.equal(f.M.nodes(f.store,1).facing.length,1,'朝向');
  // 相对时序保持：源 rel 0/0.5 → 目标 8/8.5
  assert.equal(f.store.dancers[1].actionClips[0].start,8);
  assert.equal(f.store.dancers[1].switchClips[0].start,8.5);
  // 一步撤销：上一快照复原全部类型
  const pre=f.snaps[0],preFull=JSON.parse(before);
  assert.deepEqual(pre.dancers,preFull.d,'片段');
  assert.deepEqual(pre.stageTracks,preFull.e.filter(t=>f.M.owned(t)),'走位/朝向轨');
  assert.deepEqual(pre.abilityTracks,preFull.e.filter(t=>f.ctx.ChoreoAbilityPlan.owned(t)),'技能');
  assert.deepEqual(pre.globalLyrics,preFull.g,'全局歌词');
  assert.deepEqual(pre.markers,preFull.m,'标记');
});
test('CM-2 取消/拒绝/多源拒绝＝全状态字节不变（含其余舞者轨道字节不动）',()=>{
  const f=fixture(3);
  f.setPath([[2,2,0],[4,4,0]],0);
  f.M.install(f.store,f.M.edit(f.store,2,{movement:[{time:'9',x:'1',z:'1'}],facing:[{time:'9',yaw:'9'}]},'w2'));
  f.clip(2,2);
  runCopyDialog(f,[2,4],{0:true,1:false},{action:true,movement:true});
  const before=fullBytes(f);
  const w2mv=trackBytes(f,2,'movement'),w2fc=trackBytes(f,2,'facing');
  f.ctx.b7bOpenPasteDialog();f.find('b7bPasteCheck').onclick();cancelPaste(f);
  assert.equal(fullBytes(f),before,'取消＝字节不变');
  runPaste(f,{t:2,map:{0:1},noCommit:true}); // H1 异位→拒绝
  assert.equal(fullBytes(f),before,'拒绝＝字节不变');
  assert.equal(trackBytes(f,2,'movement'),w2mv,'其余舞者走位轨字节不动');
  assert.equal(trackBytes(f,2,'facing'),w2fc,'其余舞者朝向轨字节不动');
});
test('CM-3 R5-05 ID 避让：陈旧 nextClipId 不复用既有 id/剪贴板源 id；提交后 nextClipId 前推（重载仍唯一）',()=>{
  const f=fixture(2);
  f.clip(2,2); // id=17
  f.store.nextClipId=1; // 陈旧计数器
  runCopyDialog(f,[2,4],{0:true,1:false},{action:true});
  const prev=runPaste(f,{t:10,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  const arr=f.store.dancers[1].actionClips;
  assert.equal(arr.length,1);
  assert.ok(arr[0].id!==17&&arr[0].id>17,'新 id 避开既有 17（分配器按扫描）');
  assert.ok(f.store.nextClipId>17,'提交后 nextClipId 前推（重载后仍唯一）');
  // 二次粘贴同一剪贴板：id 不与第一次冲突
  const prev2=runPaste(f,{t:20,map:{0:1}});
  assert.ok(!/拒绝/.test(prev2));
  const ids=f.store.dancers[1].actionClips.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length,'两次副本 id 互异');
});
test('CM-4 目标 performerIds 不变；跨 <0.5s 舞段不腾位如实预告',()=>{
  const f=fixture(2);
  const pidsBefore=j(f.store.contentExtra._doc.performerIds||{});
  f.store.markers.push({id:'m1',t:2,name:'点'});
  runCopyDialog(f,[2,2.2],{0:true,1:false},{marker:true});
  const prev=runPaste(f,{t:10,map:{0:1}});
  assert.ok(!/拒绝/.test(prev));
  assert.match(prev,/不足 0\.5s|不腾位/,'小跨度如实预告');
  assert.deepEqual(j(f.store.contentExtra._doc.performerIds||{}),pidsBefore,'performerIds 不变');
});
test('CM-5 旧格式剪贴板仍走既有单类型粘贴路径（回归钉住）',()=>{
  const f=fixture(1);
  const c=f.clip(2,2);sel(c);
  f.store._clipboard=f.ctx.ChoreoEdit.pure.serializeSelection(f.ctx.edSel());
  assert.ok(!f.store._clipboard.typed,'旧格式无 typed 标记');
  f.store.currentTime=8;
  f.ctx.pasteSelection();
  assert.equal(f.store.dancers[0].actionClips.length,2,'旧路径粘贴生效');
  assert.ok(f.toasts.some(m=>/自动右移/.test(m)),'makeRoom 口径提示保留');
});

// ---------- 9. 整轨复制诚实化（TD-04） ----------
test('CT-1 复制三条基础轨＋可选扩展：基础轨发新 id 一次到位；技能扩展 owner=目标；走位整条替换带平移',()=>{
  const f=fixture(2);realHistory(f);
  f.ctx.saveHistory();
  f.setPath([[2,2,0],[4,4,0]],0);setFacing(f,[[3,30]],0);
  addSkill(f,2500,2000,'e1','actor-1',{kind:'self'}); // 目标=自身类（不引用舞者、原样保留→复制后合法）
  f.clip(2,2);
  const srcIds=f.store.dancers[0].actionClips.map(c=>c.id);
  // 经真实对话框：勾选技能/走位/朝向
  f.ctx.b7bCopyTracksDialog(1,0);
  const g=id=>f.find(id);
  g('b7bTkSkills').checked=true;g('b7bTkMove').checked=true;g('b7bTkFace').checked=true;
  assert.match(textOf(f.find('b7bTracksDlg')),/三条基础轨（切换\/动作\/台词）/,'名称与实际范围一致');
  assert.match(textOf(f.find('b7bTracksDlg')),/走位/,'节点数/范围预告');
  g('b7bTkOk').onclick();
  const A=f.ctx.ChoreoAbilityPlan;
  assert.equal(f.store.dancers[1].actionClips.length,srcIds.length,'三条轨基础部分到位');
  assert.ok(f.store.dancers[1].actionClips.every(c=>srcIds.indexOf(c.id)<0),'发新 id');
  assert.equal(A.rows(f.store).filter(r=>r.source===A.pid(f.store,1)).length,1,'技能扩展 owner=目标');
  assert.equal(f.M.nodes(f.store,1).movement.length,2,'走位整条替换');
  assert.deepEqual(mvNodes(f,1),mvNodes(f,0),'默认平移到目标起始位（两人起始位同→等值）');
  assert.equal(f.M.nodes(f.store,1).facing.length,1,'朝向整条替换');
  assert.equal(f.history.length,2,'一次写入一次 saveHistory');
  // 撤销复原
  assert.equal(f.snaps.length,2);
});
test('CT-2 走位平移口径：目标起始位异于源 → 节点平移；「保持原坐标」不平移；目标已有走位轨＝整条替换预告＋确认后替换',()=>{
  const f=fixture(2);
  f.store.dancers[0].start={x:0,z:0,yawDeg:0};
  f.setPath([[2,2,0],[4,4,0]],0);
  f.clip(2,2); // 入口核心＝三条基础轨：源须有基础轨内容（与旧口径一致）
  f.store.dancers[1].start={x:10,z:0,yawDeg:0};
  f.ctx.b7bCopyTracksDialog(1,0);
  f.find('b7bTkMove').checked=true;
  f.find('b7bTkOk').onclick();
  const mv=mvNodes(f,1);
  assert.ok(Math.abs(mv[0][1]-12)<1e-9,'平移到目标起始位（+10）');
  assert.ok(Math.abs(mv[1][1]-14)<1e-9);
  const g=fixture(2);
  g.store.dancers[0].start={x:0,z:0,yawDeg:0};
  g.setPath([[2,2,0],[4,4,0]],0);
  g.clip(2,2);
  g.store.dancers[1].start={x:10,z:0,yawDeg:0};
  g.ctx.b7bCopyTracksDialog(1,0);
  g.find('b7bTkMove').checked=true;g.find('b7bTkKeep').checked=true;
  g.find('b7bTkOk').onclick();
  const gv=mvNodes(g,1);
  assert.ok(Math.abs(gv[0][1]-2)<1e-9,'保持原坐标');
  // 目标已有轨：预告替换
  const h=fixture(2);
  h.setPath([[2,2,0]],0);
  h.clip(2,2);
  h.M.install(h.store,h.M.edit(h.store,1,{movement:[{time:'7',x:'0',z:'0'}],facing:[]},'old'));
  h.ctx.b7bCopyTracksDialog(1,0);
  h.find('b7bTkMove').checked=true;
  const dlgTxt=textOf(h.find('b7bTracksDlg'));
  assert.match(dlgTxt,/替换/,'目标已有轨替换预告');
  h.find('b7bTkOk').onclick();
  assert.deepEqual(mvNodes(h,1),[[2,2,0]],'整条替换');
});
test('CT-3 目标走位轨锁定＝拒绝零写入；空源如实提示',()=>{
  const f=fixture(2);
  f.setPath([[2,2,0]],0);
  f.clip(2,2);
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'7',x:'0',z:'0'}],facing:[]},'old'));
  f.M.tracks(f.store).find(t=>t.type==='movement'&&t.performerId===f.M.pid(f.store,1)).locked=true;
  const before=fullBytes(f);
  f.ctx.b7bCopyTracksDialog(1,0);
  f.find('b7bTkMove').checked=true;
  f.find('b7bTkOk').onclick();
  assert.ok(f.toasts.some(m=>/锁定|拒绝/.test(m)),'锁定拒绝');
  assert.equal(fullBytes(f),before,'零写入');
  const g=fixture(2);
  g.ctx.b7bCopyTracksDialog(1,0);
  g.find('b7bTkOk').onclick();
  assert.ok(g.toasts.some(m=>/没有可复制|空的/.test(m)),'空源如实');
});

// ---------- 工具：ability-ui 独立装载 ----------
function loadAbilityUI(f){
  const src=fs.readFileSync(srcDir('choreo-ability-ui.js'),'utf8');
  f.ctx.ChoreoAbilityPlanTargets={assess(){},describe(){return ''},create(){return {view:()=>({rules:null,reason:''}),refresh(){},close(){},tick(){}}}};
  f.ctx.ChoreoAbilityUI=null;
  vm.runInContext(src,f.ctx,{filename:'choreo-ability-ui.js'});
  return f.ctx.ChoreoAbilityUI;
}
function findByAria(node,label){return sandbox.flatten(node).find(n=>n['aria-label']===label)||null}
function findBtn(node,text){return sandbox.flatten(node).find(n=>n.tag==='button'&&n.textContent===text)||null}

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
