// 离线打开后的游戏入口回归：先完成既有能力握手，再带配对读取；迟到结果不得跨项目采用。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(probe){
  const elements=[],calls=[];
  function element(tag){const e={tag,style:{},children:[],isConnected:true,textContent:'',value:'',setAttribute(){},appendChild(c){this.children.push(c)},remove(){this.isConnected=false},showModal(){},close(){this.onclose?.()}};elements.push(e);return e}
  const state={projectId:'copy',capsOk:false,dancers:[{id:1,name:'舞者1',start:{x:0,z:0,yawDeg:0}}],contentExtra:{}};
  const w={store:state,document:{createElement:element,body:element('body')},ChoreoEdit:{pure:{placementFor:()=>state.dancers[0].start}},
    probeCaps:async()=>{calls.push('caps');if(probe)await probe(state);else state.capsOk=true},apiFetch:async()=>{calls.push('read');assert.equal(state.capsOk,true);return {gameReadable:true,actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}}}};
  w.showExecOwned=()=>({reconnect:async()=>({caps:{pluginInstanceId:'session',version:'0.7.1',protocolVersion:1,capabilities:['stagePathNativeConfirmV1']},input:await w.apiFetch('/x1/status'),show:await w.apiFetch('/shows/status'),busy:false})});
  w.window=w;const ctx=vm.createContext(w);
  for(const f of ['choreo-stage-motion.js','choreo-stage-game-plan.js','choreo-stage-recovery.js','choreo-stage-game-ui.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
  w.ChoreoStageMotion.install(state,w.ChoreoStageMotion.edit(state,0,{movement:[{time:'3',x:'0',z:'0.36'},{time:'4',x:'0',z:'0.36'}],facing:[{time:'3',yaw:'0'},{time:'4',yaw:'0'}]},'path'));
  w.ChoreoStageGameUI.open(0);
  return {w,calls,elements,state,button:text=>elements.find(e=>e.tag==='button'&&e.textContent===text).onclick(),read:()=>elements.find(e=>e.textContent==='读取角色并生成审阅计划').onclick()};
}
(async()=>{
  let t=setup();
  assert.ok(t.elements.some(e=>e.textContent==='① ✖ 连接：插件未连接：点「重新连接 / 刷新状态」'),'P5 阶段条：打开未连接时①受阻');
  await t.read();assert.deepEqual(t.calls,['caps','read','read']);assert.ok(t.elements.some(e=>e.textContent.includes('总路程 0.360米')));
  assert.ok(t.elements.some(e=>e.textContent==='① ✔ 连接：插件已连接 · 角色 #123'),'P5 阶段条：读取后①完成');
  assert.ok(t.elements.some(e=>e.textContent==='② ✔ 审阅：已生成：舞者1 → 角色 #123'),'P5 阶段条：读取后②完成');
  assert.ok(t.elements.some(e=>e.textContent==='③ ▶ 登记：先勾选下方确认词，再点登记'),'P5 阶段条：未勾选确认词时③当前并提示');
  assert.ok(t.elements.some(e=>e.textContent.includes('流程阶段（只显示位置与阻挡')),'P5 阶段条：常驻标题与不自动执行声明');
  t=setup(async s=>{s.projectId='another';s.capsOk=true});await t.read();assert.deepEqual(t.calls,['caps']);assert.ok(t.elements.some(e=>e.textContent.includes('旧操作已取消')));
  t=setup(async()=>{});await t.read();assert.deepEqual(t.calls,['caps']);assert.ok(t.elements.some(e=>e.textContent.includes('连接失败')));
  t=setup();await t.read();t.elements.find(e=>e.type==='checkbox').checked=true;
  const connection=t.w.showExecOwned().reconnect;t.w.showExecOwned=()=>({reconnect:connection,load:async()=>({packageId:'web',clientLoadId:'web-load'})});
  t.w.saveHistory=()=>{};t.w.persistProject=()=>{};t.w.projectRecord=()=>({id:'copy',name:'测试项目',content:t.state.contentExtra});t.w.ChoreoProjects={saveActive:async()=>true};
  const mapping={sourcePackageId:'web',sourceClientLoadId:'web-load',packageId:'native',clientLoadId:'native-load'};
  t.w.apiFetch=async path=>path==='/capabilities'?{capabilities:['stagePathNativeConfirmV1']}:path==='/shows/status'?{stageMapping:mapping,state:'faulted',stopReason:'角色变化',cleanupFailed:false}:{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false},coordinateFeedback:{active:false,lastReport:{Status:'失败也保存',ManualMode:'Cooperate',ManualInterventions:1,ManualResumptions:0,Path:{PackageId:'native',ClientLoadId:'native-load',EventId:'path-0'}}}};
  await t.button('确认并登记此路径');await t.button('读取并保存本次结果');
  assert.ok(t.elements.some(e=>e.textContent.includes('手动与自动协同')&&e.textContent.includes('介入 1 / 续走 0')));assert.equal(t.state.contentExtra.stagePathRecords.length,1);assert.equal(t.state.contentExtra.stagePathRecords[0].mapping.packageId,'native');
  assert.equal(t.state.contentExtra.stagePathRecords[0].showResult.stopReason,'角色变化');
  assert.ok(t.elements.some(e=>e.textContent==='⑤ ✔ 执行：已停止（发生失败或结果未确认）'),'P5 阶段条：faulted 后⑤如实完成');
  assert.ok(t.elements.some(e=>e.textContent==='⑥ ✔ 结果：本次结果已保存；历史结果不恢复执行许可'),'P5 阶段条：保存后⑥完成且不授予许可');
  assert.ok(!t.elements.some(e=>e.tag==='button'&&e.textContent.startsWith('明确开始')));
  mapping.sourceClientLoadId='foreign';await t.button('读取并保存本次结果');
  assert.ok(t.elements.some(e=>e.textContent.includes('结果身份不匹配')));assert.equal(t.state.contentExtra.stagePathRecords.length,1);
  let cancelled=0,stopped=0;t.w.showToast=()=>{};
  t.w.showExecOwned=()=>({state:()=>({packageId:'web',clientLoadId:'web-load'}),cancelLocal:()=>cancelled++,stopStage:async()=>{stopped++}});
  t.state.dancers[0].name+=' changed';t.w.ChoreoStageGameUI.invalidateChanged();t.w.ChoreoStageGameUI.invalidateChanged();
  await Promise.resolve();assert.equal(cancelled,1);assert.equal(stopped,1);assert.equal(t.state.contentExtra.stagePathRecords.length,1);
  // —— P5 返工断言（2026-09-21 退回单 D1–D4）：阶段条新鲜度／优先级／受阻原因 ——
  // D4a：选择变化后②受阻并带原因，不冒充未开始
  t=setup();
  await t.read();
  const selProbe=t.elements.find(e=>e.tag==='select');
  selProbe.value='0';selProbe.onchange();
  assert.ok(t.elements.some(e=>e.textContent==='② ✖ 审阅：选择已改变，请重新读取并审阅'),'D4a 选择变化②受阻带原因');
  await t.read();
  assert.ok(t.elements.some(e=>e.textContent==='② ✔ 审阅：已生成：舞者1 → 角色 #123'),'D4a 重读后②恢复完成');
  // D4b：编排变化经既有 invalidateChanged 钩子即刷新（bumpTimelineRev 的真实调用路径）
  t.state.dancers[0].name+=' changed2';
  t.w.ChoreoStageGameUI.invalidateChanged();
  assert.ok(t.elements.some(e=>e.textContent==='② ✖ 审阅：编排或选择已变化：重新读取并审阅'),'D4b 编排变化即显示受阻');
  // D2：能力握手成功但 reconnect 失败——①必须受阻，不得冒充已连接
  // （预挂 no-op catch：主环境造的 rejected promise 在 vm 内被 catch，Node 跨域记账会误报 unhandled）
  t=setup();
  await t.read();
  const rejD2=Promise.reject(new Error('网络中断'));rejD2.catch(()=>{});
  t.w.showExecOwned=()=>({reconnect:rejD2});
  await t.button('重新连接 / 刷新状态');
  assert.ok(t.elements.some(e=>e.textContent==='① ✖ 连接：最近一次读取未完成：不能当作当前连接；点「重新连接 / 刷新状态」'),'D2 刷新失败①受阻');
  // D3+R2-D1：未登记页读到 playing——④仍让位于已观察执行态；③须先过身份门，落回②阶梯不冒充完成
  t=setup();
  const origFetch3=t.w.apiFetch;
  t.w.apiFetch=async p=>p==='/shows/status'?{state:'playing',busy:true}:origFetch3(p);
  await t.read();
  assert.ok(t.elements.some(e=>e.textContent==='⑤ ▶ 执行：执行中；需要时点「立即停止」'),'D3 playing ⑤执行中');
  assert.ok(t.elements.some(e=>e.textContent==='③ ▶ 登记：先勾选下方确认词，再点登记'),'R2-D1 未登记页 playing ③不冒充完成');
  assert.ok(t.elements.some(e=>e.textContent==='④ ✔ 游戏内确认：本场执行中（见⑤）'),'D3 playing ④不再指路重复确认');
  // R2-D1：本页登记（本项目＋本会话＋快照可见）后 playing——③的 D3 让位提示在身份门内保留
  t=setup();
  await t.read();
  t.elements.find(e=>e.type==='checkbox').checked=true;
  const connD3=t.w.showExecOwned().reconnect;
  t.w.showExecOwned=()=>({reconnect:connD3,load:async()=>({packageId:'web',clientLoadId:'web-load'})});
  t.w.saveHistory=()=>{};t.w.persistProject=()=>{};
  t.w.projectRecord=()=>({id:'copy',name:'测试项目',content:t.state.contentExtra});t.w.ChoreoProjects={saveActive:async()=>true};
  const fetchD3=async p=>p==='/shows/status'?{owned:true,state:'loaded'}:{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}};
  t.w.apiFetch=fetchD3;
  await t.button('确认并登记此路径');
  assert.ok(t.elements.some(e=>e.textContent==='③ ✔ 登记：本页已登记本场范围，尚未开始'),'R2-D1 登记后 loaded ③完成');
  t.w.apiFetch=async p=>p==='/shows/status'?{owned:false,state:'playing',busy:true}:fetchD3(p);
  await t.button('重新连接 / 刷新状态');
  assert.ok(t.elements.some(e=>e.textContent==='③ ✔ 登记：游戏侧本场进行中（见⑤）'),'R2-D1 登记后 playing ③让位执行态（身份门内）');
  assert.ok(t.elements.some(e=>e.textContent==='④ ✔ 游戏内确认：本场执行中（见⑤）'),'R2-D1 登记后 playing ④让位保留');
  assert.ok(t.elements.some(e=>e.textContent==='⑤ ▶ 执行：执行中；需要时点「立即停止」'),'R2-D1 登记后 playing ⑤执行中');
  // D1：登记/保存只认「本项目＋本会话＋快照可见」；安全结束与换项目后不得保持完成
  t=setup();
  await t.read();
  t.elements.find(e=>e.type==='checkbox').checked=true;
  const connD1=t.w.showExecOwned().reconnect;
  t.w.showExecOwned=()=>({reconnect:connD1,load:async()=>({packageId:'web',clientLoadId:'web-load'})});
  t.w.saveHistory=()=>{};t.w.persistProject=()=>{};
  t.w.projectRecord=()=>({id:'copy',name:'测试项目',content:t.state.contentExtra});
  t.w.ChoreoProjects={saveActive:async()=>true};
  const mapD1={sourcePackageId:'web',sourceClientLoadId:'web-load',packageId:'native',clientLoadId:'native-load'};
  const fetchD1=async p=>p==='/capabilities'?{capabilities:['stagePathNativeConfirmV1']}
    :p==='/shows/status'?{owned:true,state:'loaded',stageMapping:mapD1}
    :{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false},coordinateFeedback:{active:false,lastReport:{Status:'失败也保存',ManualMode:'Cooperate',ManualInterventions:1,ManualResumptions:0,Path:{PackageId:'native',ClientLoadId:'native-load',EventId:'path-0'}}}};
  t.w.apiFetch=fetchD1;
  await t.button('确认并登记此路径');
  assert.ok(t.elements.some(e=>e.textContent==='③ ✔ 登记：本页已登记本场范围，尚未开始'),'D1 登记后③完成（快照 owned 可见）');
  assert.ok(t.elements.some(e=>e.textContent==='④ ▶ 游戏内确认：游戏内：/choreo x1 prepare → show-review → show-confirm'),'D1 登记后④指路既有确认');
  t.w.apiFetch=async p=>p==='/shows/status'?{owned:false,state:'idle'}:fetchD1(p);
  t.w.showExecOwned=()=>({reconnect:connD1,stopStage:async()=>{}});
  await t.button('安全结束旧登记');
  // 假 DOM 不随 textContent='' 清子元素：只看「最后一次渲染」的阶段行（stageBar 末 7 个子元素）
  const barsD1=t.elements.filter(e=>e.tag==='div'&&e.style&&/border:1px solid #2c3d55;border-radius:6px/.test(e.style.cssText||''));
  const lastRowsD1=(barsD1[barsD1.length-1].children||[]).slice(-7).map(e=>e.textContent);
  assert.ok(!lastRowsD1.includes('③ ✔ 登记：本页已登记本场范围，尚未开始'),'D1 安全结束后③不再完成');
  t.button('关闭');
  t.state.projectId='another';
  const cutD1=t.elements.length;
  t.w.ChoreoStageGameUI.open(0);
  const freshD1=t.elements.slice(cutD1);
  assert.ok(!freshD1.some(e=>String(e.textContent||'').indexOf('③ ✔')===0),'D1 换项目重开③不继承旧请求');
  assert.ok(!freshD1.some(e=>String(e.textContent||'').indexOf('⑥ ✔')===0),'D1 换项目重开⑥不继承旧保存');
  // —— R2-D1（二次返工，2026-09-21 退回单）：③ 的执行/终态让位须先过身份门 ——
  const lastStageRows=tt=>{const bars=tt.elements.filter(e=>e.tag==='div'&&e.style&&/border:1px solid #2c3d55;border-radius:6px/.test(e.style.cssText||''));return (bars[bars.length-1].children||[]).slice(-7).map(e=>e.textContent)};
  // 跨项目重读：B 项目页刷新读到 A 的 completed 快照——③不得完成；观察终态仍在⑤如实呈现
  t=setup();
  await t.read();
  t.elements.find(e=>e.type==='checkbox').checked=true;
  const connR2a=t.w.showExecOwned().reconnect;
  t.w.showExecOwned=()=>({reconnect:connR2a,load:async()=>({packageId:'web',clientLoadId:'web-load'})});
  t.w.saveHistory=()=>{};t.w.persistProject=()=>{};
  t.w.projectRecord=()=>({id:'copy',name:'测试项目',content:t.state.contentExtra});t.w.ChoreoProjects={saveActive:async()=>true};
  const fetchR2a=async p=>p==='/shows/status'?{owned:true,state:'loaded'}:{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}};
  t.w.apiFetch=fetchR2a;
  await t.button('确认并登记此路径');
  t.w.apiFetch=async p=>p==='/shows/status'?{owned:false,state:'completed'}:fetchR2a(p);
  t.state.projectId='another';
  const cutR2a=t.elements.length;
  t.w.ChoreoStageGameUI.open(0);
  await t.elements.slice(cutR2a).find(e=>e.tag==='button'&&e.textContent==='重新连接 / 刷新状态').onclick(); // 只点 B 对话框自己的按钮（A 旧按钮闭包已失效）
  const freshR2a=t.elements.slice(cutR2a); // 刷新后再切片：收入 B 打开＋刷新两轮渲染的全部行
  assert.ok(!freshR2a.some(e=>String(e.textContent||'').indexOf('③ ✔')===0),'R2-D1 跨项目重读终态③不完成');
  assert.ok(!freshR2a.some(e=>String(e.textContent||'').indexOf('⑥ ✔')===0),'R2-D1 跨项目重读⑥不继承');
  assert.ok(freshR2a.some(e=>e.textContent==='⑤ ✔ 执行：本场已结束'),'R2-D1 跨项目重读终态⑤仍如实呈现');
  // 换实例执行中：登记后插件重载（instanceId 变）且 playing——③不得完成；⑤执行态不隐瞒
  t=setup();
  await t.read();
  t.elements.find(e=>e.type==='checkbox').checked=true;
  const connR2b=t.w.showExecOwned().reconnect;
  t.w.showExecOwned=()=>({reconnect:connR2b,load:async()=>({packageId:'web',clientLoadId:'web-load'})});
  t.w.saveHistory=()=>{};t.w.persistProject=()=>{};
  t.w.projectRecord=()=>({id:'copy',name:'测试项目',content:t.state.contentExtra});t.w.ChoreoProjects={saveActive:async()=>true};
  t.w.apiFetch=async p=>p==='/shows/status'?{owned:true,state:'loaded'}:{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}};
  await t.button('确认并登记此路径');
  t.w.showExecOwned=()=>({reconnect:async()=>({caps:{pluginInstanceId:'session2',version:'0.7.1',protocolVersion:1,capabilities:['stagePathNativeConfirmV1']},input:await t.w.apiFetch('/x1/status'),show:await t.w.apiFetch('/shows/status'),busy:true})});
  t.w.apiFetch=async p=>p==='/shows/status'?{owned:false,state:'playing',busy:true}:{actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}};
  await t.button('重新连接 / 刷新状态');
  const lastR2b=lastStageRows(t);
  assert.ok(!lastR2b.some(s=>String(s).indexOf('③ ✔')===0),'R2-D1 换实例执行中③不完成');
  assert.ok(lastR2b.some(s=>String(s).indexOf('⑤ ▶ 执行：执行中')===0),'R2-D1 换实例⑤仍如实执行中');
  console.log('PASS offline handshake before authenticated read; late-project and unavailable capability reject');
})().catch(e=>{console.error(e);process.exitCode=1});
