// TASK-20260924-OBS-FIX node 回归：总验收观察小修复（O-1 同点命中提示 / O-4 t6Shift a=0 跳过冗余首锚点
// ＋采样对拍 / O-5 粘贴标记字符串 id＋文档层保号 / O-6 「添加到全部舞者」顺延落点如实 toast）。
// 真实模块＋真实对话框驱动；OBSFIX_SOURCE=<改前目录> 时对 app/stage-motion/workbench 三件做红回放。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const before=process.env.OBSFIX_SOURCE||null;
if(before)process.env.B1_SOURCE=before; // b1 基座重定向 workbench/stage-motion-ui；stage-motion 在 fixture 内再重放
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
const appSrc=()=>fs.readFileSync(path.join(before?before:__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..setLoopPoint 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读
// （尾标记 setLoopPoint 留在 choreo-app.js，改为切到件尾）；OBSFIX_SOURCE 旧目录仍读旧 app.js 两标记切片。
const txSrc=()=>before?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第七步迁移：addClipToAllDancers 已随舞者/编辑操作块搬到 choreo-app-dancers.js——appFn
// 从拆分件读；OBSFIX_SOURCE 指旧目录时仍读旧 app.js（对拍红测语义不变）。
const opsSrc=()=>before?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-dancers.js'),'utf8');
function fixture(n=2){ // O-1/O-4/O-6：真实 stage-motion（before 字节可重放）
  const f=sandbox.makeFixture(n);
  if(before)vm.runInContext(fs.readFileSync(path.join(before,'choreo-stage-motion.js'),'utf8'),f.ctx,{filename:'choreo-stage-motion.js'});
  f.M=f.ctx.ChoreoStageMotion;
  return f;
}
function b7bFixture(n=2){ // O-5：沿 test-b7b-phrase-copy.js 的真对话框基座（app 切片 edContent..setLoopPoint）
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  f.ctx.document.createTextNode=function(t){return {tag:'#text',textContent:String(t),children:[],parentNode:null,remove(){},classList:{add(){},remove(){},toggle(){}}}};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  if(before)vm.runInContext(fs.readFileSync(path.join(before,'choreo-stage-motion.js'),'utf8'),f.ctx,{filename:'choreo-stage-motion.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-ability-plan.js'),'utf8'),f.ctx,{filename:'choreo-ability-plan.js'});
  const tx=txSrc();
  const a=tx.indexOf('function edContent(){'),b=tx.indexOf('function setLoopPoint(');
  assert.ok(a>0,'tx slice start');
  vm.runInContext(tx.slice(a,b>a?b:undefined),f.ctx,{filename:'choreo-app-obs-slice'});
  f.confirms=[];f.confirmResult=true;
  f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
  f.ctx.window.confirm=f.ctx.confirm;
  f.prompts=[];f.promptQueue=[];
  f.ctx.prompt=function(msg,def){const v=f.promptQueue.shift();f.prompts.push(String(msg)+'｜默认:'+String(def));return v===undefined?null:v};
  f.ctx.window.prompt=f.ctx.prompt;
  f.skillSel=[];
  f.ctx.ChoreoAbilityUI={selection:()=>f.skillSel,clearSelection(){}};
  f.ctx.clearClipSelection=function(){f.ctx.ChoreoEdit.pure.clearSelection(f.ctx.edContent());f.store.selectedClip=null};
  f.M=f.ctx.ChoreoStageMotion;
  return f;
}
function runCopyDialog(f,win,dancers,types){
  f.ctx.b7bOpenCopyPhraseDialog();
  const g=id=>f.find(id);
  g('b7bCopyA').value=String(win[0]);g('b7bCopyB').value=String(win[1]);
  Object.keys(dancers).forEach(di=>{const n=g('b7bCd-'+di);if(n)n.checked=!!dancers[di]});
  Object.keys(types).forEach(k=>{const n=g('b7bCt-'+k);if(n)n.checked=!!types[k]});
  g('b7bCopyOk').onclick();
}
function runPaste(f,o){
  f.ctx.b7bOpenPasteDialog();
  const g=id=>f.find(id);
  if(o&&o.t!=null)g('b7bPasteT').value=String(o.t);
  if(o&&o.map)Object.keys(o.map).forEach(sdi=>{const s=g('b7bMap-'+sdi);if(s)s.value=o.map[sdi]==null?'':String(o.map[sdi])});
  g('b7bPasteCheck').onclick();
  const prev=String(g('b7bPastePrev').textContent);
  if(!(o&&o.noCommit))g('b7bPasteOk').onclick();
  return prev;
}
function appFn(name){const app=opsSrc();const a=app.indexOf('function '+name+'(');assert.ok(a>0,name+' 在源内');return app.slice(a,app.indexOf('\nfunction ',a+1))}
const docCtx={window:{}};vm.createContext(docCtx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-document.js'),'utf8'),docCtx,{filename:'choreo-document.js'});
const Doc=docCtx.window.ChoreoDocument;
const baseOf=(f,di)=>f.ctx.ChoreoEdit.pure.placementFor(f.store.dancers,di);
const near=(a,b,msg,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,String(msg||'')+' '+a+' != '+b);
let passed=0,failed=0;
function test(name,fn){try{fn();console.log('PASS '+name);passed++}catch(e){console.log('FAIL '+name+'\n'+e.stack);failed++}}

// ---------- O-1 俯视同点多命中可见反馈 ----------
test('OB1-1 俯视同点多命中点击：toast 含命中数＋当前舞者＋再点切换；单命中不提示',()=>{
  const f=fixture(2);
  const w=f.workbench();w.drawTop();
  const t=w.topViewTransform();
  f.toasts.length=0;
  f.ctx.__topClick({clientX:t.w/2,clientY:t.h/2}); // 两位舞者同在出发点（0,0）
  assert.equal(f.store.selectedDancer,0,'B2 循环首位语义不变');
  assert.ok(f.toasts.some(m=>/同点 2 位舞者，当前：Synthetic 1（再点切换）/.test(m)),'多命中 toast：'+f.toasts.join('|'));
  f.toasts.length=0;
  f.store.dancers[1].start={x:5,z:5,yawDeg:0}; // 分开后＝单命中
  w.drawTop();
  f.ctx.__topClick({clientX:t.w/2,clientY:t.h/2});
  assert.equal(f.toasts.length,0,'单命中不提示');
});

// ---------- O-4 t6Shift：Δ>0 且 a≈0 跳过冗余首锚点 ----------
test('OB4-1 走位 [0,b]＋Δ>0 一次成功（改前＝解析器整批拒绝）；锚点如实 2 枚',()=>{
  const f=fixture(1);
  f.setPath([[1,1,0],[4,4,0]]);
  const rows=f.M.nodes(f.store,0).movement;
  const g=f.M.t6Shift(rows,0,4,1,true,f.store,0,baseOf(f,0),'movement');
  assert.ok(!g.refuse,'改前为「产品解析器拒绝：到达时刻须大于零…」整批拒绝；改后应成功，实际：'+(g&&g.refuse));
  assert.equal(g.anchorsAdded,2,'a=0 首锚点并入隐式出发点＝2 枚（预览「锚点 2」如实）');
  f.M.install(f.store,f.M.edit(f.store,0,{movement:g.values,facing:[]},'obs4')); // 产物经真实 edit 落库
});
test('OB4-2 采样对拍：窗内 new(t+Δ)=old(t) 逐点等价；保持段 [0,Δ] 停在出发点',()=>{
  const f=fixture(1);
  f.setPath([[1,1,0],[4,4,0],[8,8,0]]);
  const rows=f.M.nodes(f.store,0).movement;
  const g=f.M.t6Shift(rows,0,4,1,true,f.store,0,baseOf(f,0),'movement');
  assert.ok(!g.refuse,g&&g.refuse);
  const grid=[0,0.5,1,2,3,4];
  const olds=grid.map(t=>f.M.sample(f.store,0,t*1000,baseOf(f,0)));
  f.M.install(f.store,f.M.edit(f.store,0,{movement:g.values,facing:[]},'obs4b'));
  grid.forEach((t,i)=>{
    const n2=f.M.sample(f.store,0,(t+1)*1000,baseOf(f,0));
    near(n2.x,olds[i].x,'new('+(t+1)+').x');near(n2.z,olds[i].z,'new('+(t+1)+').z');
  });
  [0,0.4,0.9].forEach(t=>{ // 推迟期间（保持段）停在出发点＝qa=base
    const n2=f.M.sample(f.store,0,t*1000,baseOf(f,0));
    near(n2.x,0,'保持段 x');near(n2.z,0,'保持段 z');
  });
});
test('OB4-3 [0,b]＋Δ<0 仍结构性整批拒绝（点名零写入；改前改后一致）',()=>{
  const f=fixture(1);
  f.setPath([[1,1,0],[4,4,0]]);
  const rows=f.M.nodes(f.store,0).movement;
  const bytes0=JSON.stringify(f.store.contentExtra._doc.extraTracks);
  const g=f.M.t6Shift(rows,0,4,-0.5,true,f.store,0,baseOf(f,0),'movement');
  assert.ok(g.refuse&&/到达时刻须大于零/.test(g.refuse),'负时刻锚点经产品解析器拒绝：'+(g&&g.refuse));
  assert.equal(JSON.stringify(f.store.contentExtra._doc.extraTracks),bytes0,'零写入');
});
test('OB4-4 朝向 [0,b]＋Δ>0 同样跳过 0 秒首锚点＋采样对拍',()=>{
  const f=fixture(1),P=f.M;
  P.install(f.store,P.edit(f.store,0,{movement:P.nodes(f.store,0).movement,facing:[{time:'2',yaw:'90'},{time:'6',yaw:'180'}]},'obs4c'));
  const rows=P.nodes(f.store,0).facing;
  const g=P.t6Shift(rows,0,6,1,true,f.store,0,baseOf(f,0),'facing');
  assert.ok(!g.refuse,'改前整批拒绝：'+(g&&g.refuse));
  assert.equal(g.anchorsAdded,2);
  const olds=[0.5,1,2,4,6].map(t=>P.sample(f.store,0,t*1000,baseOf(f,0)));
  P.install(f.store,P.edit(f.store,0,{movement:P.nodes(f.store,0).movement,facing:g.values},'obs4d'));
  [0.5,1,2,4,6].forEach((t,i)=>{
    near(P.sample(f.store,0,(t+1)*1000,baseOf(f,0)).yawDeg,olds[i].yawDeg,'new('+(t+1)+').yaw');
  });
  [0,0.5].forEach(t=>near(P.sample(f.store,0,t*1000,baseOf(f,0)).yawDeg,0,'保持段朝向=出发点朝向'));
});
test('OB4-5 a>0 既有口径不变：锚点仍 3 枚（先例对拍）',()=>{
  const f=fixture(1);
  f.setPath([[2,2,0],[4,4,0],[8,8,0]]);
  const rows=f.M.nodes(f.store,0).movement;
  const g=f.M.t6Shift(rows,2,4,1,true,f.store,0,baseOf(f,0),'movement');
  assert.ok(!g.refuse,g&&g.refuse);
  assert.equal(g.anchorsAdded,3,'a>0 出发锚点仍补＝3 枚');
});

// ---------- O-5 粘贴标记字符串 id＋文档层保号 ----------
test('OB5-1 粘贴标记发字符串 id（newMarkerId 命名空间）；重开经文档层保号；旧数字 id 归一登记',()=>{
  const f=b7bFixture(1);
  f.store.markers.push({id:'m9',t:3,name:'段'});
  runCopyDialog(f,[2,6],{0:true},{marker:true});
  runPaste(f,{t:10,map:{0:0}});
  const nm=f.store.markers.find(m=>m.id!=='m9');
  assert.ok(nm,'标记副本已落');
  near(nm.t,11,'落点 t+rel=10+1');
  assert.equal(nm.name,'段','语义 name 不变');
  assert.equal(typeof nm.id,'string','粘贴标记 id 须为字符串（改前为数字，重开被文档层改号）');
  assert.match(nm.id,/^m[0-9a-z]+$/,'沿 newMarkerId 命名空间');
  const kept=Doc.normalize({markers:[{id:nm.id,tMs:11000,name:'段'}]},[]).markers[0].id;
  assert.equal(kept,nm.id,'字符串 id 经文档层保号（重开不变）');
  // LOOSE-ENDS L1 机械更新：原期望 mk-0 编码了「数字 21 在位置 0」的位置相关归一；L1 已改为
  // 位置无关派生 mk-<原数字>（缺 id 仍按序、字符串 id 不变），期望随之改为 mk-21，断言强度不减
  assert.equal(Doc.normalize({markers:[{id:21,tMs:11000,name:'老'}]},[]).markers[0].id,'mk-21','旧数字 id 位置无关归一（LOOSE-ENDS L1：mk-<原数字>）');
});

// ---------- O-6 「添加到全部舞者」顺延落点如实 toast ----------
test('OB6-1 顺延舞者逐位报实际落点（0.55s）＋重叠标红口径；空闲舞者保持请求起点',()=>{
  const f=fixture(2);
  f.store.nextClipId=100;
  f.ctx.autoFillGaps=()=>false;
  vm.runInContext(appFn('addClipToAllDancers'),f.ctx);
  f.store.dancers[1].switchClips.push({id:9,start:0,duration:0.5,data:{name:'切'}}); // 切职业条 [0,0.5)：请求 0 起的 3s → 规划器顺延 0.55
  f.ctx.addClipToAllDancers({id:5,name:'挥手',command:'/wave',category:'usual',jobName:'',jobId:0,jobAbbr:'',duration:3},0);
  const msg=f.toasts.join('|');
  assert.match(msg,/Synthetic 2→0\.55s/,'顺延者带实际落点：'+msg);
  assert.match(msg,/已顺延/);
  assert.match(msg,/红框/,'重叠标红口径');
  assert.match(msg,/保持 0\.0s/,'其余舞者保持请求起点');
  near(f.store.dancers[1].actionClips[0].start,0.55,'落点与 toast 一致');
  near(f.store.dancers[0].actionClips[0].start,0,'空闲舞者保持');
});
test('OB6-2 无顺延不弹时间 toast（边界；改前改后一致）',()=>{
  const f=fixture(2);
  f.store.nextClipId=100;
  f.ctx.autoFillGaps=()=>false;
  vm.runInContext(appFn('addClipToAllDancers'),f.ctx);
  f.ctx.addClipToAllDancers({id:5,name:'挥手',command:'/wave',category:'usual',jobName:'',jobId:0,jobAbbr:'',duration:3},0);
  assert.equal(f.toasts.filter(t=>/顺延/.test(t)).length,0,'全部直落＝无顺延提示');
});

console.log('obs-fix: pass '+passed+' fail '+failed);
process.exit(failed?1:0);
