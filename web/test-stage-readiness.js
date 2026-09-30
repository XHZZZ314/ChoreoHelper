// 演前就绪检查页测试：一屏只读汇总"开演前还差什么"——插件连接与能力（stageShowV2/stageFacingV1/
// stagePathNativeConfirmV1 逐一宣告）、角色可读性与区域、步态读数、本次审阅结论（错误清单/自动切分/
// 独立朝向包含与能力匹配/逐条排除项）、登记·映射确认·执行状态、校准（prepare）与"会短暂移动角色、
// 离开游戏前台会作废"提示、手动模式说明；每项 通过/未通过/无法判定 三态与下一步建议（指向既有
// prepare→show-review→show-confirm→show-start，不自动执行）。只走既有只读端点与连接刷新；
// 插件离线按无法判定降级，不伪造状态；就绪=可执行≠已验收。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// 以下连接/状态夹具为自动化合成数据（synthetic），字段形状取自 /capabilities、/x1/status、/shows/status 现有源码。
const capsFacing={app:'ChoreoHelper',version:'0.7.1',protocolVersion:1,pluginInstanceId:'session-1',
  capabilities:['playback','seek','stageRecoveryV1','ownedShowLoadV1','scheduledStartV1','stagePathShowV1','stagePathNativeConfirmV1','stageShowV2','stageFacingV1','stageLocomotionAutoV1']};
const capsNoFacing=Object.assign({},capsFacing,{pluginInstanceId:'session-2',
  capabilities:capsFacing.capabilities.filter(c=>c!=='stageFacingV1' && c!=='stageShowV2' && c!=='stagePathNativeConfirmV1')});
// TASK-20260919-PATH-LOCOMOTION：老插件夹具（缺自动切换步态能力），用于降级明示断言。
const capsNoAuto=Object.assign({},capsFacing,{pluginInstanceId:'session-3',
  capabilities:capsFacing.capabilities.filter(c=>c!=='stageLocomotionAutoV1')});
function input(o){return Object.assign({gameReadable:true,gameSafe:true,gameReason:null,
  actor:{id:'269024904',territoryId:816,worldX:395.032,worldZ:-689.075,rotationRad:0.945},
  movementReference:{IsWalking:true},
  calibration:{complete:true,validForCurrentState:true,completedSamples:3,requiredSamples:3,turnThenMove:true,message:'校准完成（合成夹具）'},
  stageManual:{mode:'Cooperate',description:'手动与自动协同（合成夹具说明）',cooperativeKeys:['S'],yielding:false},
  unconfirmedHeldKeys:false,stageRequestPending:false,
  outputOwnership:{inputLeaseHeld:false,previewCleanupFailed:false,exclusiveOwner:null,legacyLeases:0}},o)}
function show(o){return Object.assign({state:'loaded',x1Prepared:true,
  x1Registration:{packageId:'pkg-1',clientLoadId:'load-1',actorId:'269024904',territoryId:816,independentFacing:true,mixedShow:true},
  stageMapping:{sourcePackageId:'pkg-1',sourceClientLoadId:'load-1',packageId:'native-1',clientLoadId:'native-load',summary:'合成映射摘要'},
  stageMappingConfirmed:true,stopReason:null,cleanupFailed:false},o)}
const reviewWhole={dancerName:'舞者甲',locomotion:'walk',durationMs:4000,distanceM:0.6,
  actor:{id:'269024904',territoryId:816},
  // TASK-20260919-PATH-LOCOMOTION：走/跑混合节点夹具（1 走 + 1 跑），驱动能力必需性与步态区新断言。
  points:[{tMs:0,x:0,z:0,yawDeg:0},{tMs:2000,x:0,z:0.2,move:'walk'},{tMs:4000,x:0,z:0.6,move:'run'}],gaitWarnings:[],
  whole:{
  rows:[
    {trackId:'t1',performerId:'d1',event:{id:'mv1',kind:'movement',startMs:0,durationMs:4000},enabled:true,supported:true,reason:'按原时刻执行'},
    {trackId:'t1',performerId:'d1',event:{id:'fc1-f1',kind:'facing',startMs:0,durationMs:1000},enabled:true,supported:false,reason:'四键模式先转向再走：与路径段重叠的独立朝向本场排除，不能裁剪或重定时'},
    {trackId:'t1',performerId:'d1',event:{id:'fc2-f1',kind:'facing',startMs:4100,durationMs:800},enabled:true,supported:true,reason:'按原时刻执行'}],
  errors:[],segmentCount:2,showMs:4900,stageFacing:true,facingIncluded:1}};

function setup(options){
  options=options||{};
  const elements=[];
  function element(tag){const e={tag,style:{cssText:''},children:[],isConnected:true,textContent:'',value:'',checked:false,disabled:false,
    setAttribute(){},appendChild(c){this.children.push(c);return c},remove(){this.isConnected=false},showModal(){},close(){}};
    elements.push(e);return e}
  const state=Object.assign({projectId:'p1',projectName:'演示项目',gameConnected:true,capsOk:true,pluginCaps:capsFacing,
    contentExtra:{stagePathRecords:[]},dancers:[{id:1,name:'舞者甲',start:{x:0,z:0,yawDeg:0}}]},options.state||{});
  const w={store:state,apiCalls:[],refreshCount:0,document:{createElement:element,body:element('body')},
    probeCaps:async()=>{w.refreshCount++;state.capsOk=options.offline?false:true;state.pluginCaps=options.offline?null:capsFacing},
    showExecOwned:()=>({reconnect:async()=>{
      // 模拟既有连接刷新的只读 GET 集合（与 choreo-show-owned.js reconnect 实际读取一致），供端点边界断言。
      for(const p of ['/capabilities','/shows/status','/x1/status','/playback/status','/shows/clock'])
        w.apiCalls.push({path:p,method:'GET'});
      if(options.reconnectError)throw Error(options.reconnectError);
      return options.snapshot||{caps:capsFacing,input:input(),show:show(),clock:{},busy:false,changed:false,owned:true}}})};
  w.window=w;w.globalThis=w;
  w.apiFetch=async(path,opts)=>{w.apiCalls.push({path,method:(opts&&opts.method)||'GET'});return null};
  const ctx=vm.createContext(w);
  for(const f of ['choreo-stage-recovery.js','choreo-stage-readiness.js','choreo-stage-game-ui.js'])
    vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
  return {w,elements,button:text=>elements.find(e=>e.tag==='button'&&e.textContent===text)};
}
function collect(e){let out=(e.tag==='button'?'['+e.textContent+']':e.textContent||'')||'';e.children.forEach(c=>out+=collect(c));return out}

(async()=>{
  const R=setup().w.ChoreoStageReadiness;
  assert.ok(R,'ChoreoStageReadiness 模块应存在（旧代码下此断言为红基线）');

  // —— 纯函数：全绿快照 + 审阅 ——
  let t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  // VM realm 数组与宿主字面量原型不同，deepEqual 按原型会误判；用 JSON 内容比较（等价不削弱）。
  assert.equal(JSON.stringify(t.sections.map(s=>s.key)),JSON.stringify(['plugin','actor','gait','review','registration','calibration','manual']),'七个就绪区块固定');
  assert.deepEqual(Array.from(t.sections.map(s=>s.state)).every(x=>x==='pass'),true,'全绿夹具七项应全通过');
  assert.equal(t.ready,true);
  const caps=t.caps;
  assert.equal(caps.find(c=>c.name==='stageShowV2').declared,true);
  assert.equal(caps.find(c=>c.name==='stageFacingV1').declared,true);
  assert.equal(caps.find(c=>c.name==='stageFacingV1').required,true,'审阅含独立朝向时 stageFacingV1 为必需');
  assert.ok(t.boundary.includes('就绪=可执行≠已验收'),'边界文案必须常显');

  // —— 纯函数：能力缺失（stageShowV2/stagePathNativeConfirmV1 未宣告）→ 未通过 ——
  t=R.check({caps:capsNoFacing,input:input(),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  const plug=t.sections.find(s=>s.key==='plugin');
  assert.equal(plug.state,'fail');
  assert.ok(plug.lines.join('\n').includes('stageShowV2')&&plug.lines.join('\n').includes('stagePathNativeConfirmV1'),'须点名缺失能力');
  assert.equal(t.caps.find(c=>c.name==='stageShowV2').declared,false);
  assert.equal(t.ready,false);

  // —— 纯函数：审阅含朝向但插件未宣告 stageFacingV1 → 能力漂移未通过 ——
  t=R.check({caps:capsNoFacing,input:input(),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='review').state,'fail');
  assert.ok(t.sections.find(s=>s.key==='review').lines.join('\n').includes('stageFacingV1'),'须指出独立朝向能力不匹配');

  // —— 纯函数：角色不可读 → 未通过并给出原因 ——
  t=R.check({caps:capsFacing,input:input({gameReadable:false,gameSafe:false,gameReason:'登录过场中（合成夹具）'}),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  const actor=t.sections.find(s=>s.key==='actor');
  assert.equal(actor.state,'fail');assert.ok(actor.lines.join('\n').includes('登录过场中'));

  // —— 纯函数：步态 null → 无法判定（不伪造）——
  t=R.check({caps:capsFacing,input:input({movementReference:{IsWalking:null}}),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='gait').state,'unknown');
  t=R.check({caps:capsFacing,input:input({movementReference:{}}),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='gait').state,'unknown');
  t=R.check({caps:capsFacing,input:input({movementReference:{IsWalking:false}}),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='gait').state,'pass');
  assert.ok(t.sections.find(s=>s.key==='gait').lines.join('\n').includes('跑步'));

  // —— 纯函数：TASK-20260919-PATH-LOCOMOTION 走/跑节点模式与能力降级 ——
  // 新插件（宣告 stageLocomotionAutoV1）+ 混合节点 → 通过，明示逐段切换与最快档校准提示。
  t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  let gait=t.sections.find(s=>s.key==='gait');
  assert.equal(gait.state,'pass','新插件+混合节点+步行读数=通过（自动切换）');
  assert.ok(gait.lines.join('\n').includes('1 走路 / 1 跑步')&&gait.lines.join('\n').includes('逐段'),'须明示节点模式统计与逐段切换');
  assert.ok(gait.lines.join('\n').includes('跑步状态下完成'),'含跑步节点须提示按最快档校准');
  assert.equal(t.caps.find(c=>c.name==='stageLocomotionAutoV1').required,true,'混合场自动切换能力为必需');
  assert.ok(t.sections.find(s=>s.key==='review').lines.join('\n').includes('1 走 / 1 跑'),'审阅区须明示模式统计');
  // 老插件（未宣告）+ 混合节点 → 未通过并点名能力。
  t=R.check({caps:capsNoAuto,input:input(),show:show(),busy:false,changed:false,owned:true},reviewWhole);
  gait=t.sections.find(s=>s.key==='gait');
  assert.equal(gait.state,'fail','混合模式无自动切换能力须未通过');
  assert.ok(gait.lines.join('\n').includes('stageLocomotionAutoV1'),'须点名缺失能力');
  assert.equal(t.caps.find(c=>c.name==='stageLocomotionAutoV1').required,true,'能力清单须标必需');
  // 老插件 + 单一走路 + 当前跑步 → 未通过并明示手动切换。
  const walkOnly=JSON.parse(JSON.stringify(reviewWhole));walkOnly.points[2].move='walk';
  t=R.check({caps:capsNoAuto,input:input({movementReference:{IsWalking:false}}),show:show(),busy:false,changed:false,owned:true},walkOnly);
  gait=t.sections.find(s=>s.key==='gait');
  assert.equal(gait.state,'fail');assert.ok(gait.lines.join('\n').includes('手动切换为「走路」'),'降级须明示手动保持');
  // 老插件 + 单一跑步 + 当前跑步 → 通过（手动保持口径）；步态 null 仍无法判定。
  const runOnly=JSON.parse(JSON.stringify(reviewWhole));runOnly.points[1].move='run';
  t=R.check({caps:capsNoAuto,input:input({movementReference:{IsWalking:false}}),show:show(),busy:false,changed:false,owned:true},runOnly);
  assert.equal(t.sections.find(s=>s.key==='gait').state,'pass');
  t=R.check({caps:capsNoAuto,input:input({movementReference:{IsWalking:null}}),show:show(),busy:false,changed:false,owned:true},runOnly);
  assert.equal(t.sections.find(s=>s.key==='gait').state,'unknown');
  // 审阅区速度矛盾提示不静默。
  const warnReview=JSON.parse(JSON.stringify(reviewWhole));warnReview.gaitWarnings=['第1段按走路要求 5.00 米/秒，超过该档社区实测参考上限（约 2 米/秒）：游戏内大概率无法按时到达'];
  t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},warnReview);
  assert.ok(t.sections.find(s=>s.key==='review').lines.join('\n').includes('速度与模式矛盾提示')&&t.sections.find(s=>s.key==='review').lines.join('\n').includes('5.00'),'矛盾提示须逐条可见');

  // —— 纯函数：无审阅 → 无法判定并指向既有审阅入口 ——
  t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},null);
  let rv=t.sections.find(s=>s.key==='review');
  assert.equal(rv.state,'unknown');assert.ok(rv.next.includes('读取角色并生成审阅计划'));
  // 审阅有错误 → 未通过列出错误
  const badReview=JSON.parse(JSON.stringify(reviewWhole));badReview.whole.errors=['mv2：原时序超出本场时长；不能裁剪或重定时'];
  t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},badReview);
  rv=t.sections.find(s=>s.key==='review');
  assert.equal(rv.state,'fail');assert.ok(rv.lines.join('\n').includes('mv2'));
  // 兼容仅路径审阅（无 whole）→ 如实说明
  t=R.check({caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true},{dancerName:'舞者甲',locomotion:'run'});
  assert.ok(t.sections.find(s=>s.key==='review').lines.join('\n').includes('仅路径'));

  // —— 纯函数：登记/映射/执行状态链 ——
  const base={caps:capsFacing,input:input(),show:show(),busy:false,changed:false,owned:true};
  t=R.check(Object.assign({},base,{show:show({state:'idle',x1Prepared:false,x1Registration:null,stageMapping:null,stageMappingConfirmed:false})}),reviewWhole);
  let reg=t.sections.find(s=>s.key==='registration');
  assert.equal(reg.state,'fail');assert.ok(reg.next.includes('登记'));
  t=R.check(Object.assign({},base,{show:show({stageMappingConfirmed:false})}),reviewWhole);
  reg=t.sections.find(s=>s.key==='registration');
  assert.equal(reg.state,'fail');assert.ok(reg.next.includes('show-confirm'),'历史映射须指向游戏内确认');
  t=R.check(Object.assign({},base,{show:show()}),reviewWhole);
  reg=t.sections.find(s=>s.key==='registration');
  assert.equal(reg.state,'pass');assert.ok(reg.lines.join('\n').includes('尚未消费'),'已确认映射须说明尚未消费');
  t=R.check(Object.assign({},base,{busy:true}),reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='registration').state,'fail');
  t=R.check(Object.assign({},base,{changed:true}),reviewWhole);
  reg=t.sections.find(s=>s.key==='registration');
  assert.equal(reg.state,'fail');assert.ok(reg.lines.join('\n').includes('插件已重载')||reg.next.includes('重新连接'));
  t=R.check(Object.assign({},base,{show:show({state:'playing'})}),reviewWhole);
  reg=t.sections.find(s=>s.key==='registration');
  assert.equal(reg.state,'fail');assert.ok(reg.lines.join('\n').includes('执行中'));
  t=R.check(Object.assign({},base,{show:show({state:'completed',stageMappingConfirmed:false})}),reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='registration').state,'fail');

  // —— 纯函数：校准（prepare）状态 ——
  t=R.check(Object.assign({},base,{input:input({calibration:{complete:false,validForCurrentState:false,completedSamples:1,requiredSamples:3,turnThenMove:true,message:'等待测量（合成夹具）'}})}),reviewWhole);
  let cal=t.sections.find(s=>s.key==='calibration');
  assert.equal(cal.state,'fail');assert.ok(cal.lines.join('\n').includes('1/3')||cal.lines.join('\n').includes('1')&&cal.lines.join('\n').includes('3'),'须显示样本进度');
  assert.ok(cal.lines.join('\n').includes('prepare'),'须指向 /choreo x1 prepare');
  assert.ok(cal.lines.join('\n').includes('短暂移动')&&cal.lines.join('\n').includes('离开游戏前台'),'须说明 prepare 会移动角色且前台作废');
  t=R.check(Object.assign({},base,{input:input({calibration:{complete:true,validForCurrentState:false,completedSamples:3,requiredSamples:3,turnThenMove:true,message:'键位已变（合成夹具）'}})}),reviewWhole);
  cal=t.sections.find(s=>s.key==='calibration');
  assert.equal(cal.state,'fail');assert.ok(cal.next.includes('prepare'));
  t=R.check(Object.assign({},base,{input:input({calibration:null})}),reviewWhole);
  assert.equal(t.sections.find(s=>s.key==='calibration').state,'unknown','缺校准块按无法判定，不伪造');

  // —— 纯函数：手动模式 ——
  t=R.check(Object.assign({},base,{input:input({stageManual:{mode:'Cooperate',description:'协同说明',cooperativeKeys:[],yielding:false}})}),reviewWhole);
  let man=t.sections.find(s=>s.key==='manual');
  assert.equal(man.state,'fail');assert.ok(man.next.includes('打断')||man.lines.join('\n').includes('打断'),'无安全协同键须建议打断模式');
  t=R.check(Object.assign({},base,{input:input({stageManual:{mode:'Interrupt',description:'手动打断自动说明',cooperativeKeys:['S'],yielding:false}})}),reviewWhole);
  man=t.sections.find(s=>s.key==='manual');
  assert.equal(man.state,'pass');assert.ok(man.lines.join('\n').includes('手动打断自动'));
  t=R.check(Object.assign({},base,{input:input({stageManual:{mode:'Cooperate',description:'协同说明',cooperativeKeys:['S'],yielding:false}})}),reviewWhole);
  man=t.sections.find(s=>s.key==='manual');
  assert.equal(man.state,'pass');assert.ok(man.lines.join('\n').includes('S'),'协同须列出独立移动键');

  // —— 纯函数：离线降级（snapshot=null）→ 连接相关项无法判定，不伪造 ——
  t=R.check(null,reviewWhole);
  assert.equal(t.offline,true);
  const st={};t.sections.forEach(s=>st[s.key]=s.state);
  assert.equal(st.plugin,'unknown');assert.equal(st.actor,'unknown');assert.equal(st.gait,'unknown');
  assert.equal(st.registration,'unknown');assert.equal(st.calibration,'unknown');assert.equal(st.manual,'unknown');
  assert.equal(st.review,'pass','审阅结论来自本页本地数据，离线仍可如实显示');
  assert.equal(t.ready,false);
  assert.ok(t.offlineNote.includes('无法判定')&&t.offlineNote.includes('不伪造'),'离线说明须列出无法判定且不伪造');

  // —— UI：对话框渲染（全绿）——
  let s=setup();
  s.w.ChoreoStageReadiness.open({getReview:()=>reviewWhole});
  const txt=()=>s.elements.map(e=>collect(e)).join('\n');
  await new Promise(r=>setTimeout(r,0));
  assert.ok(s.elements.some(e=>e.tag==='h3'&&e.textContent.includes('演前就绪检查')),'对话框标题');
  ['通过','未通过','无法判定'].forEach(x=>assert.ok(txt().includes(x),'三态标签必须出现：'+x));
  assert.ok(txt().includes('就绪=可执行≠已验收'),'边界文案必须显示');
  assert.ok(txt().includes('prepare')&&txt().includes('show-review')&&txt().includes('show-confirm')&&txt().includes('show-start'),'下一步须指向既有四步流程');
  assert.ok(txt().includes('0.7.1')&&txt().includes('session-1'.slice(0,8))||txt().includes('0.7.1'),'须显示插件版本');
  assert.ok(txt().includes('#269024904')&&txt().includes('816'),'须显示角色与区域');
  assert.ok(txt().includes('步行'),'须显示步态读数');
  assert.ok(txt().includes('自动切分：2 段'),'须显示切分段数');
  assert.ok(txt().includes('fc1-f1')&&txt().includes('四键模式先转向再走'),'逐条排除项须可见');
  assert.ok(txt().includes('短暂移动')&&txt().includes('离开游戏前台'),'prepare 提示须显示');
  assert.ok(txt().includes('手动与自动协同'),'手动模式说明须显示');
  assert.ok(txt().includes('尚未消费'),'映射确认状态须说明');
  // 只读端点边界：只允许既有连接刷新的 GET 集合
  const ALLOWED=['/capabilities','/shows/status','/x1/status','/playback/status','/shows/clock'];
  assert.ok(s.w.apiCalls.every(c=>ALLOWED.includes(c.path)&&c.method==='GET'),'只允许既有只读端点：'+JSON.stringify(s.w.apiCalls));
  assert.ok(s.w.refreshCount>=1,'打开时须走既有连接刷新');
  // 重新检查按钮仍走只读刷新
  const before=s.w.apiCalls.length;
  s.button('重新检查').onclick();
  await new Promise(r=>setTimeout(r,20));
  assert.ok(s.w.apiCalls.length>before&&s.w.apiCalls.every(c=>ALLOWED.includes(c.path)&&c.method==='GET'));

  // —— UI：离线降级 ——
  s=setup({offline:true});
  s.w.ChoreoStageReadiness.open({getReview:()=>reviewWhole});
  await new Promise(r=>setTimeout(r,0));
  const txt2=()=>s.elements.map(e=>collect(e)).join('\n');
  assert.ok(txt2().includes('离线')||txt2().includes('未连接'),'离线状态须显示');
  assert.ok(txt2().includes('无法判定'),'离线各项按无法判定显示');
  assert.ok(txt2().includes('自动切分：2 段'),'本地审阅结论离线仍如实显示');
  assert.equal(s.w.apiCalls.length,0,'离线时不得伪造任何插件请求（stub 记录应为空）');

  // —— UI：连接失败（reconnect 抛错）按降级显示，不把上次状态当当前状态 ——
  s=setup({reconnectError:'插件版本或恢复能力不匹配（合成夹具）'});
  s.w.ChoreoStageReadiness.open({getReview:()=>reviewWhole});
  await new Promise(r=>setTimeout(r,0));
  const txt3=()=>s.elements.map(e=>collect(e)).join('\n');
  assert.ok(txt3().includes('插件版本或恢复能力不匹配'));
  assert.ok(txt3().includes('无法判定'));

  // —— 集成：游戏走位对话框提供"演前就绪检查"入口 ——
  s=setup({state:{gameConnected:false}});
  s.w.ChoreoStageGameUI.open(0);
  const entry=s.button('演前就绪检查');
  assert.ok(entry,'游戏走位对话框应有演前就绪检查按钮');
  entry.onclick();
  assert.ok(s.elements.some(e=>e.tag==='h3'&&e.textContent.includes('演前就绪检查')),'点击后打开就绪检查对话框');
  assert.equal(s.w.apiCalls.length,0,'游戏对话框未连接时不自动发起请求（就绪页同样不自动发）');

  // —— 静态边界：模块源码零自建网络出口、零写操作 ——
  const src=fs.readFileSync(__dirname+'/choreo-stage-readiness.js','utf8');
  assert.ok(!/apiFetch|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/i.test(src),'就绪页不得自建网络/存储出口（只经既有连接刷新）');
  assert.ok(!/method\s*:\s*['"]POST/i.test(src),'就绪页不得有写请求');
  assert.ok(!/saveActive|saveHistory|persistProject/.test(src),'就绪页不得写项目或历史');
  assert.ok(!/\/shows\/(load|arm|schedule|stop|arm-owned|stop-owned)|\/control\//.test(src),'就绪页不得引用任何执行/停止端点');
  // HTML 装载：经典脚本进外壳且不超外壳预算
  const html=fs.readFileSync(__dirname+'/choreo-helper-app.html','utf8');
  assert.ok(html.includes('choreo-stage-readiness.js'),'外壳须装载就绪检查模块');
  // 外壳预算口径与 AUDIT-P1-GATES AC-4 一致（≤6144 字节；旧 5KB 断言在 5206 字节外壳落地时已过期）。
  assert.ok(Buffer.byteLength(html)<6144,'外壳仍须小于 6KB');
  // 发布白名单
  assert.ok(/['"]choreo-stage-readiness\.js['"]/.test(fs.readFileSync(__dirname+'/../scripts/make-release-staging.js','utf8')),'就绪页须进发布白名单');

  console.log('PASS stage readiness page: three-state sections, offline degradation, review conclusion, capability drift, read-only endpoints only');
})().catch(e=>{console.error(e);process.exitCode=1});
