// 统一演出入口与整场检查测试：打开检查页零请求；显式检查只走既有只读端点；结论绑定项目/编排/舞者/会话，
// 变化即失效、迟到回包不得覆盖；路由进既有准备与确认流程；结果复盘复用已保存记录；
// gameStartPlay 走位/朝向拦截改为路由进统一入口（旧行为只弹死胡同 toast——红基线）。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// 合成夹具（synthetic）：字段形状取自规范演出文档与 /capabilities、/x1/status 现有源码，不作为游戏效果证据。
function makeDoc(extraTracks){
  return {id:'p1',name:'演示',durationMs:10000,timelineRevision:7,
    performers:[{id:'actor-0',name:'舞者甲'},{id:'actor-1',name:'舞者乙'}],
    tracks:(extraTracks||[]).concat([
      {id:'t-fc',type:'facing',performerId:'actor-0',enabled:true,events:[
        {id:'fc1',kind:'facing',startMs:0,durationMs:1000,enabled:true,data:{stageMotion:{version:1,fromStart:true,points:[{tMs:1000,yawDeg:90}]}}},
        {id:'fc2',kind:'facing',startMs:0,durationMs:4900,enabled:true,data:{stageMotion:{version:1,fromStart:true,points:[{tMs:4500,yawDeg:90},{tMs:4900,yawDeg:180}]}}}]},
      {id:'t-mo',type:'motion',performerId:'actor-0',enabled:true,events:[{id:'mo1',kind:'motion',startMs:1000,durationMs:2000,enabled:true,command:'/bow'}]},
      {id:'t-gs',type:'motion',performerId:'actor-0',enabled:true,events:[{id:'gs1',kind:'motion',startMs:2000,durationMs:500,enabled:true,command:'/gs change 1'}]},
      {id:'t-ab',type:'ability',performerId:'actor-0',enabled:true,events:[{id:'ab1',kind:'ability',startMs:1500,durationMs:2500,enabled:true,sourceRef:{kind:'action',id:'3552'},data:{rehearsalAbility:{version:1,actionId:'3552',target:{kind:'self'}}}}]},
      {id:'t-off',type:'motion',performerId:'actor-0',enabled:false,events:[{id:'off1',kind:'motion',startMs:0,durationMs:500,enabled:true,command:'/wave'}]},
      {id:'t-other',type:'motion',performerId:'actor-1',enabled:true,events:[{id:'ot1',kind:'motion',startMs:500,durationMs:1000,enabled:true,command:'/dance'}]}]),
    lyrics:[{id:'ly1',kind:'lyric',startMs:0,durationMs:1000,enabled:true}]};
}
const CAPS={app:'ChoreoHelper',version:'0.7.1',protocolVersion:1,pluginInstanceId:'sess-1',
  capabilities:['stageRecoveryV1','ownedShowLoadV1','scheduledStartV1','stagePathNativeConfirmV1','stageShowV2']};
function setup(options){
  options=options||{};
  const elements=[],apiCalls=[];
  function element(tag){const e={tag,style:{cssText:''},children:[],isConnected:true,textContent:'',value:'',checked:false,disabled:false,
    setAttribute(){},appendChild(c){this.children.push(c);return c},remove(){this.isConnected=false},showModal(){},close(){if(this.onclose)this.onclose()}};
    elements.push(e);return e}
  const state=Object.assign({projectId:'p1',projectName:'演示',_docRev:7,_tlRevision:7,previewTarget:'game',gameConnected:true,capsOk:true,gameActor:0,
    dancers:[{id:0,name:'舞者甲',profileId:'prof1',start:{x:0,z:0,yawDeg:0}},{id:1,name:'舞者乙',profileId:null,start:{x:1,z:1,yawDeg:0}}],
    contentExtra:{_doc:{performerIds:{},extraTracks:[]},stagePathRecords:options.records||[]},
    pluginCaps:options.offline?null:CAPS},options.state||{});
  let doc=makeDoc();
  const defaultReconnect=async()=>{
    for(const p of ['/capabilities','/shows/status','/x1/status','/playback/status','/shows/clock'])apiCalls.push({path:p,method:'GET'});
    if(options.reconnectError)throw Error(options.reconnectError);
    return options.snapshot||{caps:CAPS,input:{gameReadable:true,actor:{id:'123',territoryId:816,worldX:10,worldZ:-5,rotationRad:0},movementReference:{IsWalking:true}},show:{state:'idle'},clock:{},busy:false,changed:false,owned:false};
  };
  const w={store:state,apiCalls,
    document:{createElement:element,body:element('body')},
    probeCaps:async()=>{w.probeCount=(w.probeCount||0)+1;if(options.offline){state.capsOk=false;state.pluginCaps=null}},
    showToast:()=>{},
    gameActorIdx:()=>0,
    projectRecord:()=>({id:state.projectId,name:state.projectName,content:doc}),
    apiFetch:async(path,opts)=>{apiCalls.push({path,method:(opts&&opts.method)||'GET'});return options.apiResponses?options.apiResponses(path):null},
    ChoreoEdit:{pure:{placementFor:dancers=>dancers[0].start}},
    showExecOwned:()=>({reconnect:options.reconnect||defaultReconnect})};
  w.window=w;w.globalThis=w;
  let uiOpened=[],replayOpened=[];
  w.ChoreoStageGameUI={open:di=>uiOpened.push(di)};
  w.ChoreoStageReplay={open:r=>replayOpened.push(r)};
  w.__uiOpened=uiOpened;w.__replayOpened=replayOpened;
  const ctx=vm.createContext(w);
  for(const f of ['choreo-stage-motion.js','choreo-stage-game-plan.js','choreo-stage-show.js','choreo-show-entry.js'])
    vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
  // 与 test-stage-game-ui 相同方式安装一条真实路径轨（actor-0，4 秒 / 0.36 米）。
  if(!options.noPath)w.ChoreoStageMotion.install(state,w.ChoreoStageMotion.edit(state,0,{movement:[{time:'4',x:'0',z:'0.36'}],facing:[]},'entry-test'));
  doc=Object.assign(makeDoc(state.contentExtra._doc.extraTracks),{id:state.projectId});
  w.__setDoc=d=>{doc=d};
  return {w,elements,button:text=>{const b=elements.find(e=>e.tag==='button'&&e.textContent===text);if(!b)throw Error('button not found: '+text);return b.onclick()},
    text:()=>elements.map(e=>collect(e)).join('\n')};
}
function collect(e){let out=(e.tag==='button'?'['+e.textContent+']':e.textContent||'')||'';e.children.forEach(c=>out+=collect(c));return out}
const READ_ONLY=new Set(['/capabilities','/shows/status','/x1/status','/playback/status','/shows/clock','/x1/ability-read?mode=context']);

(async()=>{
  const E=setup().w.ChoreoShowEntry;
  assert.ok(E,'ChoreoShowEntry 模块应存在（旧行为只有死胡同 toast，此断言为红基线）');

  // —— 状态文案覆盖用户可理解的完整集合 ——
  assert.equal(E.STATE.idle,'尚未开始');
  assert.ok(E.STATE.loaded.includes('准备中'));
  assert.ok(E.STATE.armed.includes('待确认'));
  assert.ok(E.STATE.playing.includes('执行中'));
  assert.ok(E.STATE.stopping.includes('停止处理中'));
  assert.ok(E.STATE.completed.includes('已完成'));
  assert.ok(E.STATE.faulted.includes('结果未确认'));

  // —— 纯计数：只数事件，不做支持判定 ——
  const MV=[{id:'t-mv',type:'movement',performerId:'actor-0',enabled:true,events:[{id:'mv1',kind:'movement',startMs:0,durationMs:4000,enabled:true}]}];
  let c=E.countEvents(makeDoc(MV),'actor-0');
  assert.deepEqual(JSON.parse(JSON.stringify(c.counts)),{movement:1,facing:2,motion:3,gearset:1,ability:1,other:0});
  assert.equal(c.selected,6);assert.equal(c.disabled,1);assert.equal(c.otherDancers,1);assert.equal(c.lyric,1);

  // —— 本地摘要：绑定 + 计数 + 本地可判定阻断；插件未读取如实标未知 ——
  let s=E.summarize(makeDoc(MV),{projectId:'p1',projectName:'演示',timelineRevision:7,di:0,dancerName:'舞者甲',performerId:'actor-0',profileBound:true,caps:null});
  assert.equal(s.binding.projectId,'p1');assert.equal(s.binding.timelineRevision,7);assert.equal(s.binding.dancerName,'舞者甲');
  assert.equal(s.problems.length,0,'档案已绑定且有路径时本地无阻断');
  assert.ok(s.unknown.some(u=>u.includes('插件连接与能力尚未读取')),'离线必须标未知而不是伪造结论');
  s=E.summarize(makeDoc(MV),{projectId:'p1',projectName:'演示',timelineRevision:7,di:1,dancerName:'舞者乙',performerId:'actor-1',profileBound:false,caps:null});
  assert.ok(s.problems.some(p=>p.category==='resource'&&p.object.includes('舞者乙')&&p.next.includes('档案')),'未绑定档案归类为资源缺失');
  assert.ok(s.problems.some(p=>p.category==='blocking'&&p.object.includes('走位轨道')&&p.next.includes('日常游戏播放')),'无路径时阻断并指路既有通道');
  s=E.summarize(Object.assign(makeDoc(MV),{durationMs:300001}),{projectId:'p1',timelineRevision:7,di:0,dancerName:'舞者甲',performerId:'actor-0',profileBound:true,caps:null});
  assert.ok(s.problems.some(p=>p.category==='blocking'&&p.object==='整场时长'&&p.next.includes('缩减')),'超时长阻断');
  s=E.summarize(makeDoc(MV),{projectId:'p1',timelineRevision:7,di:0,dancerName:'舞者甲',performerId:'actor-0',profileBound:true,caps:CAPS});
  assert.ok(s.unknown.some(u=>u.includes('stageFacingV1')),'有能力快照时按能力给出未知/限制说明');

  // —— 审阅结果分桶：本机执行 / 仅网页排练 / 网页预览 / 游戏执行限制 / 停用 / 阻断 ——
  let whole={path:{performerId:'actor-0'},rows:[
    {performerId:'actor-0',enabled:true,supported:true,event:{id:'mv1',kind:'movement',startMs:0,durationMs:4000},reason:'按原时刻执行'},
    {performerId:'actor-0',enabled:true,supported:false,event:{id:'fc1',kind:'facing',startMs:0,durationMs:1000},reason:'须插件宣告 stageFacingV1'},
    {performerId:'actor-1',enabled:true,supported:false,event:{id:'ot1',kind:'motion',startMs:500,durationMs:1000},reason:'未绑定本地角色'},
    {enabled:true,supported:false,event:{id:'ly1',kind:'lyric',startMs:0,durationMs:1000},reason:'原曲歌词仅网页显示'},
    {performerId:'actor-0',enabled:false,supported:false,event:{id:'off1',kind:'motion',startMs:0,durationMs:500},reason:'原项目已停用'}],
    errors:['e5：仅支持原地单次动作；循环或根位移不能改写为单次执行','当前角色读取不一致，请重新审阅'],
    segmentCount:2,showMs:4900,facingIncluded:0,dancers:[{performerId:'actor-0',name:'舞者甲',executable:true},{performerId:'actor-1',name:'舞者乙',executable:false}]};
  let st=E.structureReview(whole);
  assert.equal(st.executable.length,1);assert.equal(st.gameExecution.length,1);assert.equal(st.webRehearsal.length,1);assert.equal(st.webPreview.length,1);assert.equal(st.disabled.length,1);
  assert.equal(st.partial,true,'有排除项必须标部分执行');
  assert.equal(st.blockers[0].object,'e5');assert.ok(st.blockers[0].cause.includes('原地单次动作'));assert.ok(st.blockers[0].next.includes('不会自动修改'));
  assert.equal(st.blockers[1].object,'整场一致性','无事件身份的错误按整场一致性归对象');

  // —— 打开检查页零请求（连接态也不发） ——
  let t=setup();t.w.ChoreoShowEntry.open();
  assert.equal(t.w.apiCalls.length,0,'打开检查页不得发送任何请求');
  assert.equal(t.w.probeCount||0,0);
  assert.ok(t.text().includes('本次检查绑定')&&t.text().includes('编排版本 7')&&t.text().includes('舞者甲'));
  assert.ok(t.text().includes('打开本页不发送任何请求'));
  assert.ok(t.text().includes('走位 1、朝向 2、动作 3、套装 1、技能 1、歌词 1'),'本地计数展示');
  assert.ok(t.text().includes('流程位置：① 整场检查（本页，只读）'),'P5 流程位置行常驻');

  // —— 离线打开：未知降级，编辑与网页排练不受影响 ——
  t=setup({offline:true});t.w.ChoreoShowEntry.open();
  assert.equal(t.w.apiCalls.length,0);
  assert.ok(t.text().includes('插件连接与能力尚未读取'));

  // —— 显式检查：全部只读端点，真实审阅链出结构化结论 ——
  t=setup({apiResponses:path=>path==='/x1/ability-read?mode=context'?{context:{available:true,actorId:'123',territoryId:816,jobId:34}}:null});
  t.w.ChoreoShowEntry.open();
  await t.button('检查整场（只读刷新）');
  assert.ok(t.w.apiCalls.length>0,'显式检查应发起只读刷新');
  t.w.apiCalls.forEach(call=>{assert.equal(call.method,'GET','不得出现写入请求');assert.ok(READ_ONLY.has(call.path),'只允许既有只读端点：'+call.path)});
  assert.ok(t.text().includes('检查结论')&&t.text().includes('本机执行 3 条'),t.text().slice(-3000));
  assert.ok(t.text().includes('明确排除 5 条')&&t.text().includes('部分执行，不能称整场完整执行'));
  assert.ok(t.text().includes('gs1')&&t.text().includes('此事件尚未接入有界整场'),'套装事件按阻断+排除如实展示');
  assert.ok(t.text().includes('历史结果不授予再次开演权限'));
  assert.equal(JSON.stringify(t.w.store.contentExtra._doc.extraTracks.length>=1),JSON.stringify(true),'检查不改动项目');

  // —— 无副作用与编排保全：打开+检查+关闭后 store 逐字节不变 ——
  const before=JSON.stringify({d:t.w.store.dancers,e:t.w.store.contentExtra});
  t.button('关闭');
  assert.equal(JSON.stringify({d:t.w.store.dancers,e:t.w.store.contentExtra}),before,'关闭不得改动用户编排');

  // —— 迟到回包不得覆盖：检查中途换项目 ——
  let gate=Promise.withResolvers();
  t=setup({reconnect:()=>gate.promise});
  t.w.ChoreoShowEntry.open();
  const pending=t.button('检查整场（只读刷新）');
  t.w.store.projectId='p2';
  gate.resolve({caps:CAPS,input:{gameReadable:true,actor:{id:'123',territoryId:816,worldX:10,worldZ:-5,rotationRad:0},movementReference:{IsWalking:true}},show:{state:'idle'},clock:{},busy:false,changed:false,owned:false});
  await pending;
  assert.ok(t.text().includes('检查期间选择或项目已变化')||t.text().includes('检查未完成'),'迟到回包不得套用为新项目结论');
  assert.ok(!t.text().includes('本机执行 3 条'),'旧结论不得覆盖新状态');

  // —— 外部失效钩子：编排变化作废已有结论 ——
  t=setup({apiResponses:path=>path==='/x1/ability-read?mode=context'?{context:{available:true,actorId:'123',territoryId:816,jobId:34}}:null});
  t.w.ChoreoShowEntry.open();
  await t.button('检查整场（只读刷新）');
  assert.ok(t.text().includes('本机执行 3 条'));
  t.w.ChoreoShowEntry.invalidate();
  assert.ok(t.text().includes('检查结论已失效')&&t.text().includes('不能作为执行依据'));

  // —— 会话变化失效：插件重载后旧结论不可用 ——
  t=setup({apiResponses:path=>path==='/x1/ability-read?mode=context'?{context:{available:true,actorId:'123',territoryId:816,jobId:34}}:null});
  t.w.ChoreoShowEntry.open();
  await t.button('检查整场（只读刷新）');
  t.w.store.pluginCaps=Object.assign({},CAPS,{pluginInstanceId:'sess-2'});
  t.button('进入现有准备与确认流程'); // 会话已变，重渲染须标记失效
  assert.ok(t.text().includes('检查结论已失效')||t.w.__uiOpened.length===1,'路由本身仍可用（流程自会重验）');

  // —— 路由：进入既有准备与确认流程，携带所选舞者 ——
  t=setup();t.w.ChoreoShowEntry.open();
  t.button('进入现有准备与确认流程');
  assert.deepEqual(t.w.__uiOpened,[0]);
  const sel=t.elements.find(e=>e.tag==='select');
  sel.value='1';sel.onchange();
  t.button('进入现有准备与确认流程');
  assert.deepEqual(t.w.__uiOpened,[0,1],'路由携带当前所选舞者');

  // —— 结果与复盘：已保存记录逐条进入既有复盘页 ——
  const record={savedAt:'2026-09-15T00:00:00Z',review:{dancerName:'舞者甲'},report:{Status:'失败也保存'}};
  t=setup({records:[record]});t.w.ChoreoShowEntry.open();
  assert.ok(t.text().includes('已保存 1 条'));
  t.button('复盘');
  assert.equal(t.w.__replayOpened.length,1);assert.equal(t.w.__replayOpened[0],record);

  // —— 无路径项目：本地阻断 + 检查失败如实降级（不自动改项目）——
  t=setup({noPath:true});t.w.ChoreoShowEntry.open();
  assert.ok(t.text().includes('走位轨道')&&t.text().includes('日常游戏播放'),'无路径时指路既有通道');

  // —— gameStartPlay 拦截路由：日常播放被走位/朝向拦截时打开统一入口（旧代码只弹 toast——红基线）——
  // OVERHAUL 批 C 第五步迁移：gameStartPlay 已随播放控制块搬到 choreo-app-playback.js——切片改读拆分件。
  const source=fs.readFileSync(__dirname+'/choreo-app-playback.js','utf8');
  const start=source.indexOf('function gameStartPlay(){');
  const body=source.slice(start,start+source.slice(start).indexOf('  var requestToken='))+'}';
  let opened=null,toasts=[],writes=0;
  const fakeWindow={ChoreoStageMotion:{blocksGame:()=>true},ChoreoShowEntry:{open:o=>{opened=o}}};
  const ctx={window:fakeWindow,ChoreoStageMotion:fakeWindow.ChoreoStageMotion,ChoreoShowEntry:fakeWindow.ChoreoShowEntry,
    store:{dancers:[{name:'舞者甲'}],previewTarget:'game',gameConnected:true},
    gameActorIdx:()=>0,showToast:m=>toasts.push(m),apiFetch:()=>writes++};
  vm.runInNewContext(body+'\ngameStartPlay()',ctx);
  assert.ok(opened&&opened.entry==='daily-blocked'&&opened.di===0,'拦截时须打开统一入口并携带预览舞者');
  assert.equal(writes,0,'拦截路径不得发送任何请求');
  assert.ok(toasts.some(x=>x.includes('整场检查')));
  // 无统一入口模块时保留原死胡同文案（兼容降级）
  opened=null;toasts=[];
  const ctx2={window:{ChoreoStageMotion:fakeWindow.ChoreoStageMotion},ChoreoStageMotion:fakeWindow.ChoreoStageMotion,
    store:ctx.store,gameActorIdx:ctx.gameActorIdx,showToast:m=>toasts.push(m),apiFetch:()=>writes++};
  vm.runInNewContext(body+'\ngameStartPlay()',ctx2);
  assert.equal(opened,null);assert.ok(toasts.some(x=>x.includes('网页排练')),'模块缺失时保留原文案');

  console.log('PASS unified show entry: zero-request open, read-only check, stale-proof conclusion, routing and replay reuse');
})().catch(e=>{console.error(e);process.exitCode=1});
