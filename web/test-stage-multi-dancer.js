// 多舞者整场呈现回归：审阅按舞者汇总（所选舞者绑定本地角色可执行，其余仅网页排练并逐条排除），
// 排除文案与四键排除同一风格；执行包保持单本地角色硬边界（单 performers/单 x1.bindings，不含其他舞者事件）；
// 就绪页审阅区显示多舞者范围行；技能资源批量铺开按 Action 聚合汇总（只读，不新增端点）。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),P=require('./choreo-stage-motion.js');
require('./choreo-x1-inputs.js');
const G=require('./choreo-stage-game-plan.js'),W=require('./choreo-stage-show.js');
(async()=>{

// 场景：两位舞者。甲（所选）路径 0→2 秒走 0.18 米后保持，尾部朝向 5→6 秒；乙有自己的走位/朝向/动作轨。
const s={projectId:'multi',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]},{id:2,name:'乙',start:{x:1,z:1,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s,P.edit(s,0,{movement:[{time:'2',x:'0',z:'0.18'},{time:'4',x:'0',z:'0.18'}],facing:[{time:'5',yaw:'90'},{time:'6',yaw:'120'}]},'path'));
P.install(s,P.edit(s,1,{movement:[{time:'2',x:'1',z:'1.18'},{time:'4',x:'1',z:'1.18'}],facing:[{time:'2',yaw:'45'},{time:'4',yaw:'90'}]},'other'));
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const plan=G.review(s,0,s.dancers[0].start,actor,0);
const tracks=P.tracks(s);
const doc={id:'multi',name:'多舞者回归',timelineRevision:3,performers:[{id:'actor-1',name:'甲'},{id:'actor-2',name:'乙'}],
  tracks:tracks.concat([
    {id:'m1',type:'motion',performerId:'actor-1',events:[{id:'m1e',kind:'motion',command:'/wave motion',startMs:100,durationMs:300}]},
    {id:'a1',type:'ability',performerId:'actor-1',events:[{id:'a1e',kind:'ability',startMs:1500,durationMs:500,sourceRef:{kind:'action',id:'31'},data:{rehearsalAbility:{version:1,actionId:'31',target:{kind:'self'}}}}]},
    {id:'m2',type:'motion',performerId:'actor-2',events:[{id:'m2e',kind:'motion',command:'/bow motion',startMs:500,durationMs:300}]}]),
  lyrics:[]};
const before=JSON.stringify(doc);

// 1) 审阅：逐舞者汇总；乙的事件逐条排除且文案点明仅网页排练+未绑定本地角色。
const review=W.review(doc,plan,{actorId:'123',territoryId:816,jobId:21});
assert.equal(review.errors.length,0,review.errors.join('\n'));
assert.ok(Array.isArray(review.dancers)&&review.dancers.length===2,'审阅须给出两位舞者的汇总');
const bound=review.dancers.find(d=>d.performerId==='actor-1'),other=review.dancers.find(d=>d.performerId==='actor-2');
assert.ok(bound&&bound.executable===true,'所选舞者标记为绑定本地角色可执行');
assert.equal(bound.name,'甲');
assert.ok(other&&other.executable===false,'未选舞者不得标记可执行');
assert.equal(other.name,'乙');
assert.ok(other.excludedCount>=3,'乙的走位/朝向/动作至少各一条逐条排除（实际 '+other.excludedCount+'）');
const otherRows=review.rows.filter(r=>r.performerId==='actor-2');
assert.equal(otherRows.length,other.excludedCount,'排除计数与逐条行数一致');
otherRows.forEach(r=>{
  assert.equal(r.supported,false,'乙的事件不得标记可执行：'+r.event.id);
  assert.ok(r.reason.includes('未绑定本地角色')&&r.reason.includes('网页排练')&&r.reason.includes('排除'),'排除文案风格须点明边界：'+r.reason);
  assert.equal(r.dancerName,'乙','每行标注所属舞者');
});
const ownRows=review.rows.filter(r=>r.performerId==='actor-1');
assert.ok(ownRows.length&&ownRows.every(r=>r.dancerName==='甲'),'所选舞者行同样标注舞者名');
assert.equal(JSON.stringify(doc),before,'审阅不得改写项目');

// 2) 执行包边界不变：单 performers、单 x1.bindings、绝不携带乙的事件（一个客户端只动一个本地角色）。
const options={supportedScope:true,pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05};
const pkg=W.packageFor(review,options);
assert.equal(pkg.performers.length,1);assert.equal(pkg.performers[0].id,'actor-1');
assert.equal(pkg.x1.bindings.length,1);assert.equal(pkg.x1.bindings[0].performerId,'actor-1');
assert.ok(!pkg.events.some(e=>e.performerId==='actor-2'),'执行包不得包含未绑定舞者的事件');
assert.ok(pkg.events.some(e=>e.id==='m1e')&&pkg.events.some(e=>e.id==='a1e'),'所选舞者动作/技能仍按原时刻进入');

// 3) 单舞者项目：汇总仅一位且可执行，行为不变。
const single={projectId:'copy',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(single,P.edit(single,0,{movement:[{time:'2',x:'0',z:'0.18'},{time:'4',x:'0',z:'0.18'}],facing:[{time:'2',yaw:'0'},{time:'4',yaw:'0'}]},'path'));
const plan1=G.review(single,0,single.dancers[0].start,actor,0);
const review1=W.review({id:'copy',name:'单舞者',tracks:P.tracks(single)},plan1,{actorId:'123',territoryId:816,jobId:21});
assert.equal(review1.dancers.length,1);assert.equal(review1.dancers[0].executable,true);

// 4) 缺 performers 的旧形状文档：舞者名降级为表演者 ID，不伪造。
const degraded=W.review({id:'multi2',name:'降级',tracks},plan,{actorId:'123',territoryId:816,jobId:21});
assert.equal(degraded.dancers.length,2);
assert.equal(degraded.dancers.find(d=>d.performerId==='actor-2').name,'actor-2','无名可查时按 ID 降级显示');

// 5) 就绪页：多舞者审阅显示范围行；单舞者与旧记录（无 dancers 字段）不显示，旧记录不伪造。
{
  const elements=[];
  function element(tag){const e={tag,style:{},children:[],isConnected:true,textContent:'',value:'',checked:false,disabled:false,
    setAttribute(){},appendChild(c){this.children.push(c);return c},remove(){this.isConnected=false},showModal(){},close(){}};elements.push(e);return e}
  const caps={app:'ChoreoHelper',version:'0.7.1',protocolVersion:1,pluginInstanceId:'session-1',
    capabilities:['stagePathNativeConfirmV1','stageShowV2']};
  const input={gameReadable:true,actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:true},
    calibration:{complete:true,validForCurrentState:true},stageManual:{mode:'Interrupt',cooperativeKeys:[]},outputOwnership:{}};
  const show={state:'loaded',stageMappingConfirmed:true,x1Registration:{actorId:'123',territoryId:816},stageMapping:{},stopReason:null,cleanupFailed:false};
  const w={store:{projectId:'p1'},document:{createElement:element,body:element('body')},window:null};
  w.window=w;w.globalThis=w;
  vm.runInContext(fs.readFileSync(__dirname+'/choreo-stage-readiness.js','utf8'),vm.createContext(w));
  const R=w.ChoreoStageReadiness;
  const multiReview={dancerName:'甲',locomotion:'walk',durationMs:4000,distanceM:.18,actor:{id:'123',territoryId:816},
    whole:{rows:review.rows,errors:[],segmentCount:2,showMs:review.showMs,dancers:review.dancers}};
  const t=R.check({caps,input,show,busy:false,changed:false,owned:true},multiReview);
  const section=t.sections.find(x=>x.key==='review');
  assert.ok(section.lines.join('\n').includes('多舞者'),'就绪页审阅区须显示多舞者范围行');
  assert.ok(section.lines.join('\n').includes('仅网页排练'),'范围行须点明其余舞者仅网页排练');
  const singleReview={dancerName:'甲',locomotion:'walk',durationMs:4000,distanceM:.18,actor:{id:'123',territoryId:816},
    whole:{rows:review1.rows,errors:[],segmentCount:2,showMs:review1.showMs,dancers:review1.dancers}};
  const t2=R.check({caps,input,show,busy:false,changed:false,owned:true},singleReview);
  assert.ok(!t2.sections.find(x=>x.key==='review').lines.join('\n').includes('多舞者'),'单舞者审阅不显示多舞者行');
  const legacyWhole=JSON.parse(JSON.stringify(multiReview));delete legacyWhole.whole.dancers;
  const t3=R.check({caps,input,show,busy:false,changed:false,owned:true},legacyWhole);
  assert.ok(!t3.sections.find(x=>x.key==='review').lines.join('\n').includes('多舞者'),'旧记录缺字段不伪造多舞者行');
}

// 6) 游戏走位对话框（show 范围）：多舞者汇总块 + 逐行舞者名前缀；单舞者显示保持原样。
{
  const elements=[];
  function element(tag){const e={tag,style:{},children:[],isConnected:true,textContent:'',value:'',checked:false,disabled:false,
    setAttribute(){},appendChild(c){this.children.push(c);return c},remove(){this.isConnected=false},showModal(){},close(){}};elements.push(e);return e}
  const state={projectId:'multi',capsOk:true,dancers:s.dancers.map(d=>Object.assign({},d)),contentExtra:JSON.parse(JSON.stringify(s.contentExtra))};
  const w={store:state,document:{createElement:element,body:element('body')},ChoreoEdit:{pure:{placementFor:(dancers,di)=>dancers[di].start}},
    probeCaps:async()=>{state.capsOk=true},
    apiFetch:async path=>path==='/x1/ability-read?mode=context'?{context:{actorId:'123',territoryId:816,jobId:21}}:
      path==='/shows/status'?{state:'idle',stageMapping:null}:
      {gameReadable:true,actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},movementReference:{IsWalking:false}},
    projectRecord:()=>({id:'multi',name:'多舞者',content:doc})};
  w.showExecOwned=()=>({reconnect:async()=>({caps:{pluginInstanceId:'session',version:'0.7.1',protocolVersion:1,capabilities:['stagePathNativeConfirmV1','stageShowV2']},
    input:await w.apiFetch('/x1/status'),show:await w.apiFetch('/shows/status'),busy:false})});
  w.window=w;const ctx=vm.createContext(w);
  for(const f of ['choreo-stage-motion.js','choreo-stage-game-plan.js','choreo-stage-recovery.js','choreo-stage-show.js','choreo-stage-game-ui.js'])
    vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
  w.ChoreoStageGameUI.open(0);
  await elements.find(e=>e.textContent==='读取角色并生成审阅计划').onclick();
  const summary=elements.find(e=>e.tag==='pre'&&e.textContent.includes('本场逐条审阅'));
  assert.ok(summary,'整场审阅文本应已生成');
  const text=summary.textContent;
  assert.ok(text.includes('多舞者（共 2 位）'),'对话框须显示多舞者汇总块');
  assert.ok(text.includes('绑定本地角色 #123'),'所选舞者标注绑定本地角色');
  assert.ok(/乙 — 未绑定本地角色/.test(text),'未选舞者逐条汇总仅网页排练');
  assert.ok(text.includes('仅网页排练预览'),'汇总须点明其余舞者仅网页排练');
  assert.ok(text.split('本场逐条审阅：')[1].includes('乙 · m2e'),'逐条审阅行须带舞者名前缀');
}

// 7) 技能资源批量铺开：按 Action 聚合（只读汇总，普通动作不入聚合，端点不变）。
{
  const rows=[
    {kind:'ability',actionId:31,name:'战栗',dancer:'甲',status:'ready',message:'可预览'},
    {kind:'ability',actionId:31,name:'战栗',dancer:'乙',status:'missing',message:'本档案缺少此 Action 的动画'},
    {kind:'ability',actionId:40,name:'泰然自若',dancer:'甲',status:'unbound',message:'未绑定有效角色档案'},
    {kind:'motion',clipId:'c1',eventId:'motion:c1',dancer:'乙',status:'ordinary',message:'普通动作按原播放器预览'}];
  require('./choreo-skill-coverage.js');
  const S=globalThis.ChoreoSkillCoverage;
  const sum=S.summary(rows);
  assert.equal(sum.totals.actions,2,'按不同 Action 聚合（普通动作不计）');
  const a31=sum.actions.find(a=>a.actionId===31);
  assert.ok(a31&&a31.entries.length===2&&a31.entries.some(e=>e.dancer==='甲'&&e.status==='ready')&&a31.entries.some(e=>e.dancer==='乙'&&e.status==='missing'));
  assert.equal(a31.readyCount,1);assert.equal(a31.missingCount,1);
  const a40=sum.actions.find(a=>a.actionId===40);
  assert.equal(a40.missingCount,1,'未绑定档案计入缺资源');
  assert.equal(sum.totals.missingActions,2,'两个 Action 均有缺口');
  assert.equal(sum.totals.readyActions,0);
  assert.equal(S.summary([]).totals.actions,0,'空项目零聚合不报错');
}

console.log('PASS multi-dancer presentation: per-dancer summary, per-row exclusion style, single-local-actor package boundary, readiness scope line, action coverage aggregation');
})().catch(e=>{console.error(e);process.exitCode=1});
