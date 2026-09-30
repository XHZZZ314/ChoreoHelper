// 宏使用者首条编舞旅程（first-macro-journey r1）模块级红基线/回归：
// J1–J3 添加/编辑对象与时间解释（workbench/props-ui）、J4 停止呈现分离（模块合成返回，标「模块测试」）、
// J5 走位移动用时换算（stage-motion-ui 同处走位）。浏览器真实指针旅程证据在
// test-first-macro-journey-browser.js（十二步 §3 / FJ-01…06）；本文件不冒充 UI 旅程或游戏结果。
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const base=process.env.CHOREO_JOURNEY_SOURCE||__dirname;
const read=f=>fs.readFileSync(path.join(base,f),'utf8');
// OVERHAUL 批 C 第七步迁移：clipDurationSourceLabel/trackOverlapConflict 已随舞者/编辑操作块搬到
// choreo-app-dancers.js——源级切片改读拆分件；CHOREO_JOURNEY_SOURCE 指旧目录时仍读旧 choreo-app.js
// （对拍红测语义不变）。
const readOps=()=>process.env.CHOREO_JOURNEY_SOURCE?read('choreo-app.js'):fs.readFileSync(path.join(__dirname,'choreo-app-dancers.js'),'utf8');

// —— 共享最小 DOM 桩（支撑 workbench/props-ui/motion-ui 的纯视图构建路径）——
function makeDom(){
  const nodes=[];
  class Node{
    constructor(tag){this.tagName=String(tag).toUpperCase();this.children=[];this.style={};this.value='';this.id='';this.type='';this.title='';this.hidden=false;this.isConnected=true;this._cls='';nodes.push(this)}
    get className(){return this._cls}set className(v){this._cls=String(v)}
    get textContent(){return (this.text||'')+this.children.map(n=>n.textContent).join('')}
    set textContent(v){this.text=String(v);this.children=[]}
    appendChild(n){this.children.push(n);n.parentNode=this;return n}
    insertBefore(n,ref){const i=ref?this.children.indexOf(ref):-1;if(i<0)this.children.push(n);else this.children.splice(i,0,n);n.parentNode=this;return n}
    remove(){if(this.parentNode){const i=this.parentNode.children.indexOf(this);if(i>=0)this.parentNode.children.splice(i,1);this.parentNode=null}}
    setAttribute(k,v){this[k]=v}
    querySelector(sel){if(sel[0]!=='.')return null;const cls=sel.slice(1);const walk=n=>{for(const c of n.children){if((' '+c.className+' ').indexOf(' '+cls+' ')>=0)return c;const r=walk(c);if(r)return r}return null};return walk(this)}
    focus(){}select(){}
  }
  const document={
    createElement:t=>new Node(t),
    getElementById:id=>nodes.find(n=>n.id===id)||null,
    querySelector:sel=>{if(sel[0]!=='.')return null;const cls=sel.slice(1);return nodes.find(n=>(' '+n.className+' ').indexOf(' '+cls+' ')>=0)||null}
  };
  return {Node,document,nodes};
}
function find(nodes,id){const n=nodes.find(x=>x.id===id);assert.ok(n,'缺少节点 #'+id);return n}

// —— J1/J2/J3：workbench 落点预告与添加条标签 ——
function loadWorkbench(storeObj){
  const {document}=makeDom();
  const ctx={document,window:{},console,localStorage:{getItem:()=>null,setItem(){}}};
  ctx.window=ctx;ctx.window.store=storeObj;vm.createContext(ctx);
  vm.runInContext(read('choreo-workbench.js'),ctx);
  return {wb:ctx.ChoreoWorkbench,ctx};
}
function wbStore(over){
  return Object.assign({selectedDancer:0,addToAll:false,activeTab:'emote-usual',dancers:[
    {name:'舞者1',actionClips:[{id:1,start:0,duration:3,autoDur:true,data:{name:'A',command:'/a'}}]},
    {name:'舞者2',actionClips:[]}
  ]},over);
}

// —— J2/J3/J4：props-ui 上下文栏 ——
function loadProps(){
  const {document}=makeDom();
  const ctx={document,window:{},console};
  ctx.window=ctx;vm.createContext(ctx);
  for(const f of ['choreo-clip-time.js','choreo-props-ui.js'])vm.runInContext(read(f),ctx);
  return {ctx,document};
}

// —— J4：choreo-stop 呈现（模块合成返回，非真实 HTTP）——
function stopSetup(fetcher){
  const nodes={},calls=[];
  for(const id of ['immediateStop','immediateStopStatus'])nodes[id]={textContent:'',dataset:{},setAttribute(){},addEventListener(_,f){this.click=f}};
  const ctx={console,URL,AbortController,Set,Promise,Date,Number,setTimeout,clearTimeout,
    fetch:async(url,opts)=>{calls.push({url,opts});return fetcher(url,opts)},
    document:{getElementById:id=>nodes[id]},
    stopLocalPlaybackNow(){},recordingStopNow(){},ChoreoMusicUI:{stopNow(){}},showExecCancelLocal(){},showExecConfirmGlobalStop(){},ensembleStopNow(){}};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(read('choreo-api.js'),ctx);
  vm.runInContext(read('choreo-stop.js'),ctx);
  return {ctx,nodes,calls};
}

// —— J5：stage-motion-ui 同处走位（P=ChoreoStageMotion 以桩注入，数据写入仍走 P.edit/P.install 链）——
// B5 起窗口替换的锚点构造收编为公共纯函数 M.t1Window——桩上同样经真实模块函数（不自写规则）。
const realStageMotion=(()=>{const c={};c.window=c;vm.createContext(c);vm.runInContext(read('choreo-stage-motion.js'),c,{filename:'choreo-stage-motion.js'});return c.ChoreoStageMotion})();
function moveSetup(movementRows){
  const dom=makeDom();
  const host=dom.document.createElement('div');host.id='wbTopHost';host.hidden=false;
  const hint=dom.document.createElement('div');hint.className='wb-top-hint';hint.textContent='原提示';
  host.appendChild(hint);
  // B9 机械更新（旧↔新并列）：旧链 A 的 wbMoveBar 挂 wbTopHost（舞台侧）；B9 统一草稿面后段子表单随
  // 会话栏挂时间轴下方 wbCtxHost——桩环境补挂该宿主（真实页面由 app renderWorkbenchBars 提供）。
  const ctxHost=dom.document.createElement('div');ctxHost.id='wbCtxHost';
  dom.nodes.push(host,ctxHost);
  const events={history:0,install:0,lastEdit:null,lastInstall:null,toasts:[]};
  const P={
    nodes:()=>({movement:(movementRows||[]).slice(),facing:[]}),
    edit:(s,di,d,tag)=>{events.lastEdit={di:di,d:d,tag:tag};return [{type:'movement',performerId:'p0'}]},
    install:(s,all)=>{events.install++;events.lastInstall=all},
    tracks:()=>[],owned:()=>true,pid:()=>'p0',sample:()=>({x:0,z:0,yawDeg:0}),
    t1Window:(list,aMs,bMs,dest,move)=>{
      const st={dancers:[{id:1,actionClips:[],switchClips:[],lyricClips:[]}],contentExtra:{_doc:{extraTracks:[]}}};
      if((movementRows||[]).length)realStageMotion.install(st,realStageMotion.edit(st,0,{movement:movementRows,facing:[]},'j5'));
      return realStageMotion.t1Window(list,aMs,bMs,dest,move,st,0,{x:0,z:0,yawDeg:0});
    }
  };
  const clip={id:7,start:4,duration:3,autoDur:true,data:{name:'B',command:'/b'}};
  const store={projectId:'p1',dancers:[{name:'舞者1',actionClips:[clip],switchClips:[],lyricClips:[]}],selectedDancer:0,isPlaying:false,currentTime:0};
  const ctx={document:dom.document,window:{},console};
  ctx.window=ctx;ctx.store=store;ctx.ChoreoStageMotion=P;
  vm.createContext(ctx);
  vm.runInContext(read('choreo-stage-motion-ui.js'),ctx);
  const root={dom:dom,store:store,clip:clip,events:events,ui:ctx.ChoreoStageMotionUI,
    saveHistory(){events.history++},updateTotalDuration(){},render(){},showToast(m){events.toasts.push(String(m))}};
  ctx.updateTotalDuration=root.updateTotalDuration;ctx.saveHistory=root.saveHistory;ctx.render=root.render;ctx.showToast=root.showToast;
  return root;
}

const checks=[];const queue=[];
function test(name,run){queue.push({name:name,run:run})}
async function runAll(){
  for(const t of queue){
    try{await t.run();checks.push({name:t.name,ok:true});console.log('PASS '+t.name)}
    catch(e){checks.push({name:t.name,ok:false});console.log('FAIL '+t.name+': '+String(e&&e.message||e).slice(0,400))}
  }
}

// ========== J2/J3 workbench ==========
test('J3-1 空轨落点预告保持「第一个动作从 0.0s 开始」',()=>{
  const {wb}=loadWorkbench(wbStore({dancers:[{name:'舞者1',actionClips:[]},{name:'舞者2',actionClips:[]}]}));
  assert.match(wb.landingText(),/第一个动作从 0\.0s 开始/);
});
test('J3-2 落点预告一句话含上一条开始/编排/结束与开始相隔（等待0）',()=>{
  const {wb}=loadWorkbench(wbStore());
  const t=wb.landingText();
  assert.match(t,/「A」从 0\.0s 开始、编排 3\.0s、到 3\.0s 结束/);
  assert.match(t,/新动作从 3\.0s 开始/);
  assert.match(t,/两条开始相隔 3\.0s/);
});
test('J3-3 等待 2 秒的预告含等待值与开始相隔 5.0s',()=>{
  const {wb}=loadWorkbench(wbStore());
  wb.setAppendWait(2);
  const t=wb.landingText();
  assert.match(t,/等待 2\.0s 后/);
  assert.match(t,/新动作从 5\.0s 开始/);
  assert.match(t,/两条开始相隔 5\.0s/);
});
test('J3-4 0.2 秒请求被 0.5 吸附：显示实际落点与对齐说明',()=>{
  const {wb}=loadWorkbench(wbStore());
  wb.setAppendWait(0.2);
  const t=wb.landingText();
  assert.match(t,/已按现有 0\.5 秒规则对齐/);
  assert.match(t,/实际空隙 0\.0s/);
  assert.match(t,/新动作从 3\.0s 开始/);
  assert.ok(t.indexOf('3.2s')<0||/对齐/.test(t),'不能只写 3.2s 而无对齐说明');
});
test('J3-5 添加到全部舞者时预告只代表当前舞者',()=>{
  const {wb}=loadWorkbench(wbStore({addToAll:true}));
  assert.match(wb.landingText(),/各舞者按自己的轨末尾落位/);
});
test('J2-1 添加条目标＝「下一条添加到：舞者1」',()=>{
  const {wb,ctx}=loadWorkbench(wbStore());
  const bar=wb.addBar({onAddNext(){},onWaitChange(){},onMacro(){}});
  assert.ok(bar,'addBar 需要返回节点');
  const label=ctx.document.getElementById('wbAddTarget');
  assert.ok(label);
  assert.equal(label.textContent,'下一条添加到：舞者1');
});
test('J2-2 添加等待字段名为「添加时：与上一条结束相隔」',()=>{
  const {wb,ctx}=loadWorkbench(wbStore());
  wb.addBar({onAddNext(){},onWaitChange(){},onMacro(){}});
  const input=ctx.document.getElementById('wbWaitInput');
  assert.ok(input);
  const label=input.parentNode;
  assert.match(label.textContent,/^添加时：与上一条结束相隔/);
  assert.match(String(input['aria-label']),/添加时与上一条结束相隔（秒）/);
});

// ========== J2/J3/J4 props-ui ==========
function propsBar(ctx,over){
  const clip={id:2,start:3,duration:3,autoDur:true,data:{name:'B',command:'/b'}};
  const prev={start:0,duration:3,data:{name:'A'}},next={start:8,duration:3,data:{name:'C'}};
  let commits=0;
  const opts=Object.assign({selection:[{clip:clip,di:0,track:'action'}],dancerName:'舞者1',
    neighbors:()=>({prev:prev,next:next}),totalDuration:()=>30,conflict:()=>false,
    commit:()=>commits++,ordinal:()=>2,durationSource:()=>'默认编排值（3 秒为默认占位，可修改；实际动作长度未确认）',
    rehearsalActive:()=>false,rehearsalRange:()=>null,onAction(){}},over||{});
  const bar=ctx.ChoreoPropsUI.renderContextBar(opts);
  return {clip:clip,bar:bar,commits:()=>commits};
}
function input(node,v){node.value=v;if(node.oninput)node.oninput()}
test('J2-3 编辑区标题＝「正在修改：舞者1 · 第2条「B」」',()=>{
  const {ctx}=loadProps();
  const b=propsBar(ctx);
  assert.equal(ctx.document.getElementById('wbCtx').children[0].textContent,'正在修改：舞者1 · 第2条「B」');
  assert.ok(b.bar.textContent.indexOf('正在修改：舞者1')>=0);
});
test('J2-4 编辑等待字段名为「这条开始前：与上一条结束相隔」',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  const w=ctx.document.getElementById('wbCtxWait');
  assert.ok(w);
  assert.match(w.parentNode.textContent,/^这条开始前：与上一条结束相隔/);
});
test('J3-6 改等待1秒的草稿预告：B 4–7、上一条区间、开始相隔、C 不动与结束相隔',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  input(ctx.document.getElementById('wbCtxWait'),'1');
  const pv=ctx.document.getElementById('wbChangePreview').textContent;
  assert.match(pv,/待应用：从 4\.000s 开始，编排 3\.000s，到 7\.000s 结束/);
  assert.match(pv,/上一条从 0\.000s 开始、3\.000s 结束，与这条开始相隔 4\.000s/);
  assert.match(pv,/只改这条，后面的片段不动/);
  assert.match(pv,/「C」仍从 8\.000s 开始/);
  assert.match(pv,/与这条结束相隔 1\.000s/);
});
test('J3-7 未修改时预告用「已保存：」且含时长来源（默认编排值）',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  const pv=ctx.document.getElementById('wbChangePreview').textContent;
  assert.match(pv,/^已保存：/);
  assert.match(pv,/时长来源：默认编排值/);
});
test('J3-8 时长改为草稿输入时来源随之说明',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  input(ctx.document.getElementById('wbCtxDurEdit'),'4');
  const pv=ctx.document.getElementById('wbChangePreview').textContent;
  assert.match(pv,/草稿输入/);
});
test('J4-1 首点按钮即写「循环试看这一段」且点击前可见循环范围与停止方式',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  const btn=ctx.document.getElementById('wbCtxRehearse');
  assert.ok(btn);
  assert.equal(btn.textContent,'循环试看这一段');
  const hint=ctx.document.getElementById('wbCtxRehHint');
  assert.ok(hint,'循环范围/停止方式须在点击前可见，不只放 title');
  assert.match(hint.textContent,/网页循环/);
  assert.match(hint.textContent,/0\.5/);
  assert.match(hint.textContent,/停止/);
});
test('J4-2 激活态按钮＝「退出循环试看」，徽标含范围',()=>{
  const {ctx}=loadProps();
  propsBar(ctx,{rehearsalActive:()=>true,rehearsalRange:()=>({a:3.5,b:7.5})});
  assert.equal(ctx.document.getElementById('wbCtxRehearse').textContent,'退出循环试看');
  assert.match(ctx.document.getElementById('wbCtxLoop').textContent,/循环试看中 3\.5–7\.5s/);
});
test('J2/J3 回归守卫：等待/时长草稿取消零提交、应用一次（沿用既有语义）',()=>{
  const {ctx}=loadProps();
  const b=propsBar(ctx);
  input(ctx.document.getElementById('wbCtxWait'),'2');
  ctx.document.getElementById('wbCtxTimeCancel').onclick();
  assert.equal(b.clip.start,3);assert.equal(b.commits(),0);
  input(ctx.document.getElementById('wbCtxWait'),'2');
  ctx.document.getElementById('wbCtxTimeApply').onclick();
  assert.equal(b.clip.start,5);assert.equal(b.commits(),1);
});

// ========== J4 choreo-stop（模块测试：合成返回）==========
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
test('【模块测试】J4-3 停止中：网页已停与游戏确认中分开呈现',async()=>{
  const d=defer(),s=stopSetup(()=>d.promise);
  const p=s.nodes.immediateStop.click();
  assert.equal(s.ctx.ChoreoStop.state(),'stopping');
  const st=s.nodes.immediateStopStatus.textContent;
  assert.match(st,/网页播放已停止/);
  assert.match(st,/游戏端停止确认中/);
  d.resolve(response({ok:true,state:'stopped',generation:1}));
  await p;
});
test('【模块测试】J4-4 成功：网页已停＋游戏端已确认分开说明',async()=>{
  const s=stopSetup(async()=>response({ok:true,state:'stopped',generation:1}));
  await s.ctx.ChoreoStop.stop();
  const st=s.nodes.immediateStopStatus.textContent;
  assert.match(st,/网页播放已停止/);
  assert.match(st,/游戏端已确认停止/);
});
test('【模块测试】J4-5 网络失败：网页已停＋游戏未确认可重试，不合并成全部停止',async()=>{
  const s=stopSetup(async()=>{throw Error('offline')});
  await s.ctx.ChoreoStop.stop();
  const st=s.nodes.immediateStopStatus.textContent;
  assert.match(st,/网页播放已停止/);
  assert.match(st,/游戏端停止未确认，请重试/);
  assert.match(st,/位置与循环范围保留/);
  assert.ok(st.indexOf('全部')<0||!/全部停止成功/.test(st));
  assert.equal(s.ctx.ChoreoStop.state(),'failed');
});
test('【模块测试】J4-6 本机单项失败：游戏已确认但本机未确认分别指出',async()=>{
  const s=stopSetup(async()=>response({ok:true,state:'stopped',generation:1}));
  s.ctx.recordingStopNow=()=>{throw Error('broken')};
  await s.ctx.ChoreoStop.stop();
  const st=s.nodes.immediateStopStatus.textContent;
  assert.match(st,/游戏端已确认停止/);
  assert.match(st,/录制与审核/);
  assert.equal(s.ctx.ChoreoStop.state(),'failed');
});

// ========== J5 stage-motion-ui 同处走位 ==========
test('J5-1 走位条同处显示舞者/动作/出发（舞者1 · 为「B」排走位 / 4s 出发）',()=>{
  const m=moveSetup([]);
  assert.equal(m.ui.openSamePlace(0,m.clip),true);
  const bar=m.dom.document.getElementById('wbMoveBar');
  assert.ok(bar);
  assert.equal(m.dom.document.getElementById('wbMoveTitle').textContent,'舞者1 · 为「B」排走位');
  const sub=bar.children.find(n=>n.className==='wb-move-sub');
  assert.ok(sub);assert.equal(sub.textContent,'4s 出发');
});
test('J5-2 主字段＝移动用时，默认=片段时长；改用时同步到达',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  const dur=m.dom.document.getElementById('wbMoveDur'),arr=m.dom.document.getElementById('wbMoveArrival');
  assert.ok(dur,'需要 #wbMoveDur 主字段');assert.ok(arr);
  assert.equal(dur.value,'3');
  assert.equal(arr.value,'7');
  input(dur,'2');
  assert.equal(arr.value,'6');
  const eta=m.dom.document.getElementById('wbMoveEta');
  assert.ok(eta);assert.match(eta.textContent,/到达 6s/);
});
test('J5-3 专家字段改到达同步用时（共享一份草稿）',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  input(m.dom.document.getElementById('wbMoveArrival'),'10');
  assert.equal(m.dom.document.getElementById('wbMoveDur').value,'6');
});
test('J5-4 B1 重选目的地保留时间，显式重置才恢复默认',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  input(m.dom.document.getElementById('wbMoveDur'),'2');
  m.ui.pickSamePlace(1.2,-0.8);
  assert.equal(m.dom.document.getElementById('wbMoveArrival').value,'6');
  assert.equal(m.dom.document.getElementById('wbMoveDur').value,'2');
  const hint=m.dom.document.getElementById('wbMoveHint').textContent;
  assert.match(hint,/已选目的地 \(1\.2, -0\.8\)/);
  assert.match(hint,/已保留用时与到达时刻/);
  m.dom.document.getElementById('wbMoveReset').onclick();
  assert.equal(m.dom.document.getElementById('wbMoveArrival').value,'7');
  assert.equal(m.dom.document.getElementById('wbMoveDur').value,'3');
});
test('J5-5 用时非法（空/0/负）不落库，说明须晚于出发',()=>{
  for(const v of ['','0','-1']){
    const m=moveSetup([]);
    m.ui.openSamePlace(0,m.clip);
    m.ui.pickSamePlace(1.2,-0.8);
    input(m.dom.document.getElementById('wbMoveDur'),v);
    m.dom.document.getElementById('wbMoveApply').onclick();
    assert.equal(m.events.install,0,'非法用时不得写入（'+v+'）');
    assert.match(m.dom.document.getElementById('wbMoveHint').textContent,/晚于动作开始|移动用时/,v);
  }
});
test('J5-6 窗口内已有节点：明示替换这个时间窗口的既有走位',()=>{
  const m=moveSetup([{time:'5',x:'1',z:'1'}]);
  m.ui.openSamePlace(0,m.clip);
  const note=m.dom.document.getElementById('wbMoveWindow');
  assert.ok(note,'需要窗口替换说明 #wbMoveWindow');
  assert.match(note.textContent,/替换这个时间窗口的既有走位/);
});
test('J5-7 应用按用时换算到达（4s出发+3s=7s 到达）且一次保存',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  m.ui.pickSamePlace(1.2,-0.8);
  m.dom.document.getElementById('wbMoveApply').onclick();
  assert.equal(m.events.install,1);
  assert.equal(m.events.history,1);
  const nodes=m.events.lastEdit.d.movement;
  const dest=nodes[nodes.length-1];
  assert.equal(dest.time,'7');assert.equal(dest.x,'1.2');assert.equal(dest.z,'-0.8');
  assert.match(m.events.toasts.join('|'),/7s 到达/);
});
test('J5-8 走位条说明独立轨（不随动作改时自动移动/不改游戏映射）',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  assert.match(m.dom.document.getElementById('wbMoveBar').textContent,/独立轨/);
});
test('J5-9 samePlaceState 暴露用时（dur）且到达保持既有口径',()=>{
  const m=moveSetup([]);
  m.ui.openSamePlace(0,m.clip);
  m.ui.pickSamePlace(1.2,-0.8);
  const st=m.ui.samePlaceState();
  assert.equal(st.arrival,7);
  assert.equal(st.dur,3);
  assert.equal(st.dest.x,1.2);
});

// ========== J3 时长来源分类（choreo-app.js 新增纯函数切片）==========
test('J3-9 clipDurationSourceLabel 五分类只标可确认来源',()=>{
  const app=readOps();
  const idx=app.indexOf('function clipDurationSourceLabel(');
  assert.ok(idx>=0,'choreo-app-dancers.js 需要 clipDurationSourceLabel');
  const end=app.indexOf('\nfunction ',idx+10);
  const ctx={};vm.createContext(ctx);
  vm.runInContext(app.slice(idx,end>0?end:undefined),ctx);
  const f=ctx.clipDurationSourceLabel;
  assert.match(f({data:{duration:5}},{}),/^资源声明/);
  assert.match(f({autoDur:true,data:{command:'/x'}},{ '/x':4 }),/已测量/);
  assert.match(f({autoDur:true,duration:3,data:{command:'/x'}},{}),/默认编排值/);
  assert.match(f({autoDur:true,duration:3,data:{command:'/x'}},{}),/实际动作长度未确认/);
  assert.match(f({autoDur:false,duration:3,data:{isLoop:true,command:'/x'}},{}),/循环动作默认占位/);
  assert.match(f({autoDur:false,duration:3,data:{command:'/x'}},{},{isLoop:true}),/循环动作默认占位/);
  assert.match(f({autoDur:false,duration:2,data:{command:'/x'}},{},{duration:7}),/^资源声明 7s/);
  assert.match(f({autoDur:false,data:{command:'/x'}},{}),/用户设置或旧项目/);
  assert.match(f({autoDur:false,data:{command:'/x'}},{}),/实际动作长度未确认/);
});

// ========== J3 同轨重叠拒绝（合同 §3「遇到冲突」：注入回调层补校验，规划器模块不改）==========
test('J3-10 trackOverlapConflict 同轨重叠判定（跨轨 conflictEnd 保持原样）',()=>{
  const app=readOps();
  const idx=app.indexOf('function trackOverlapConflict(');
  assert.ok(idx>=0,'choreo-app-dancers.js 需要 trackOverlapConflict');
  const end=app.indexOf('\nfunction ',idx+10);
  const c2={store:{dancers:[{actionClips:[{id:1,start:8,duration:3},{id:2,start:20,duration:2}],switchClips:[]}]},console};
  vm.createContext(c2);
  vm.runInContext(app.slice(idx,end>0?end:undefined),c2);
  const f=c2.trackOverlapConflict;
  assert.equal(f(0,'action',6,3,99),true);   // 6–9 与 8–11 重叠
  assert.equal(f(0,'action',4,3,99),false);  // 4–7 不与任何同轨重叠
  assert.equal(f(0,'action',8,3,1),false);   // 与自身重叠不算（排除自身）
  assert.equal(f(0,'action',21,2,1),true);   // 与 id:2 重叠
  assert.equal(f(0,'lyric',6,3,99),false);   // 台词轨不在此校验（沿用原规则）
  assert.equal(f(-1,'action',6,3,99),false);
});
test('J3-11 冲突拒绝文案说明与下一条具体重叠（零修改）',()=>{
  const {ctx}=loadProps();
  const b=propsBar(ctx,{conflict:()=>true});
  input(ctx.document.getElementById('wbCtxWait'),'3');
  ctx.document.getElementById('wbCtxTimeApply').onclick();
  const msg=ctx.document.getElementById('wbCtxTimeError').textContent;
  assert.match(msg,/冲突/);
  assert.match(msg,/重叠 1\.000s/);
  assert.match(msg,/「C」/);
  assert.equal(b.clip.start,3);
  assert.equal(b.commits(),0);
});

// ========== 修复批红回归（独立验收退回 R1/R2/R3；先红后修，不放宽旧断言）==========
test('R1-red 循环动作用户改时长后不得仍标默认来源（autoDur=false 且≠3）',()=>{
  const app=readOps();
  const idx=app.indexOf('function clipDurationSourceLabel(');
  assert.ok(idx>=0,'choreo-app-dancers.js 需要 clipDurationSourceLabel');
  const end=app.indexOf('\nfunction ',idx+10);
  const ctx={};vm.createContext(ctx);
  vm.runInContext(app.slice(idx,end>0?end:undefined),ctx);
  const f=ctx.clipDurationSourceLabel;
  // 用户把默认 3 改成 2（真实键鼠复现，ui-findings/review-duration.json）
  const lbl2=f({autoDur:false,duration:2,data:{command:'/x'}},{},{isLoop:true});
  assert.ok(!/循环动作默认占位|默认编排值/.test(lbl2),'改过时长的循环动作不得标默认来源，实际='+lbl2);
  assert.match(lbl2,/用户设置或旧项目/);
  assert.match(lbl2,/实际动作长度未确认/);
  // 原规划器复现：3 改 9（supplement.json R1）
  const lbl9=f({autoDur:false,duration:9,data:{command:'/x'}},{},{isLoop:true});
  assert.ok(!/循环动作默认占位|默认编排值/.test(lbl9),'9 秒非默认值不得标默认占位，实际='+lbl9);
  assert.match(lbl9,/用户设置或旧项目/);
  // 边界：恰为默认值 3 的循环动作仍可标默认占位（与用户改回 3 不可区分，不新增持久化来源字段）
  assert.match(f({autoDur:false,duration:3,data:{command:'/x'}},{},{isLoop:true}),/循环动作默认占位/);
});
test('R3-red 草稿排在下一条之后：预告不得报不存在的重叠（真实区间相交）',()=>{
  const {ctx}=loadProps();
  propsBar(ctx);
  input(ctx.document.getElementById('wbCtxWait'),'9'); // B 12–15，C 8–11：不相交
  const pv=ctx.document.getElementById('wbChangePreview').textContent;
  assert.ok(!/与这条重叠/.test(pv),'不相交不得报重叠，实际='+pv);
  assert.match(pv,/不重叠/);
});
test('R3-red 其它规则拒绝时不追加不相交片段的重叠说明（B 12–15 冲突拒绝）',()=>{
  const {ctx}=loadProps();
  const b=propsBar(ctx,{conflict:()=>true});
  input(ctx.document.getElementById('wbCtxWait'),'9'); // B 12–15 与 C 8–11 不相交
  ctx.document.getElementById('wbCtxTimeApply').onclick();
  const msg=ctx.document.getElementById('wbCtxTimeError').textContent;
  assert.match(msg,/冲突/);
  assert.ok(!/重叠/.test(msg),'不相交片段不得报重叠，实际='+msg);
  assert.equal(b.clip.start,3);assert.equal(b.commits(),0);
});
test('R3-red 越界拒绝不得误报与远早片段重叠（313–315 vs 8–11 复现）',()=>{
  const {ctx}=loadProps();
  const b=propsBar(ctx); // totalDuration=30
  input(ctx.document.getElementById('wbCtxStartEdit'),'28'); // 28+3=31>30 → 越界拒绝
  ctx.document.getElementById('wbCtxTimeApply').onclick();
  const msg=ctx.document.getElementById('wbCtxTimeError').textContent;
  assert.match(msg,/超出轨道末端/);
  assert.ok(!/重叠/.test(msg),'越界拒绝不得附带不存在的重叠说明，实际='+msg);
  assert.equal(b.commits(),0);
});
test('R3-red 真实相交仍如实报重叠量（B 6–9 与 C 8–11 重叠 1 秒，守卫不放宽）',()=>{
  const {ctx}=loadProps();
  propsBar(ctx,{conflict:()=>true});
  input(ctx.document.getElementById('wbCtxWait'),'3'); // B 6–9
  ctx.document.getElementById('wbCtxTimeApply').onclick();
  const msg=ctx.document.getElementById('wbCtxTimeError').textContent;
  assert.match(msg,/重叠 1\.000s/);
});
test('【模块测试】R2-red 本机失败＋游戏网络失败同时发生：最终反馈保留各项本机未确认',async()=>{
  const s=stopSetup(async()=>{throw Error('offline')});
  s.ctx.ChoreoMusicUI={stopNow(){throw Error('music broken')}};
  await s.ctx.ChoreoStop.stop();
  const st=s.nodes.immediateStopStatus.textContent;
  assert.match(st,/游戏端停止未确认，请重试/);
  assert.match(st,/本机未确认/);
  assert.match(st,/音乐/);
  assert.match(st,/网页播放已停止|网页播放停止未确认/);
  assert.equal(s.ctx.ChoreoStop.state(),'failed');
});


// ========== J1 空时间轴引导（源码级红锚：浏览器旅程探针负责 UI 验证）==========
test('J1-1 空时间轴引导不再误导「加到播放头」或「右侧属性面板」',()=>{
  // OVERHAUL 批 C 第五步迁移：tl-empty-guide 引导已随时间轴渲染块搬到 choreo-app-timeline.js——切片改读拆分件。
  const app=read('choreo-app-timeline.js');
  const seg=app.slice(app.indexOf('tl-empty-guide')-200,app.indexOf('tl-empty-guide')+1400);
  assert.ok(seg.indexOf('加到播放头')<0,'引导不得再写「加到播放头」');
  assert.ok(seg.indexOf('右侧属性面板精确')<0,'引导不得再指向右侧属性面板');
  assert.match(seg,/在左侧选一个动作，排成第一条/);
  assert.match(seg,/在时间轴下方修改这一条/);
});
test('J1-2 普通停止按钮 title 说明网页归零/循环退出语义',()=>{
  // OVERHAUL 批 C 第六步迁移：停止按钮 title 随 renderToolbar 搬到 choreo-app-render.js——
  // 正负断言都跨主件＋拆分件（不变量随代码走：族内不得回退为旧 title）。
  const app=read('choreo-app.js')+'\n'+read('choreo-app-render.js');
  const i=app.indexOf("bs.title='停止'");
  assert.ok(i<0,'工具栏停止按钮 title 需要普通停止语义说明');
  assert.match(app,/普通停止/);
});

runAll().then(function(){
  if(process.env.CHOREO_JOURNEY_RESULTS)fs.writeFileSync(process.env.CHOREO_JOURNEY_RESULTS,JSON.stringify(checks,null,2));
  const failed=checks.filter(c=>!c.ok).length;
  console.log(JSON.stringify({total:checks.length,failed:failed}));
  process.exitCode=failed?1:0;
}).catch(function(e){console.error(e);process.exitCode=1});
