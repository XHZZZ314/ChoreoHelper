// 单人整场结果保存回归：合成输入，逐事件逐段、数据库回执、失败重试与串场拒绝。
'use strict';
const assert=require('node:assert/strict');
// 身份一致的合成夹具（R4）：计划事件身份与分段报告、技能回执一一对应；两场（正常/中止）独立身份。
function fixture(projectId='p',run='one',aborted=false){
 const mapping={sourcePackageId:'source-'+run,sourceClientLoadId:'load-'+run,packageId:'mapped-'+run,clientLoadId:'mapped-load-'+run};
 const request={instanceId:'instance',projectId,packageId:mapping.sourcePackageId,clientLoadId:mapping.sourceClientLoadId,review:{dancerName:'测试舞者',distanceM:0.2,actor:{id:'123'}}};
 const reports=[0,1].map(i=>({Completed:!aborted,Status:aborted?'人工接管中止':'本段完成',TotalDistanceM:.1,FinalDistanceToTargetM:0,
  Path:{PackageId:mapping.packageId,ClientLoadId:mapping.clientLoadId,EventId:'path-'+i}}));
 const dispatched=aborted?15:40;
 const events=Array.from({length:40},(_,i)=>({id:i===0?'path-0':i===1?'path-1':i===10?'ability-1':i===11?'facing-1':'e'+i,
  kind:i<2?'movement':i===10?'ability':i===11?'facing':'motion',plannedMs:i*20,durationMs:i<2?200:0,dispatched:i<dispatched}));
 const recentLog=events.filter(e=>e.dispatched).map(e=>{
  const row={id:e.id,kind:e.kind,plannedMs:e.plannedMs,dispatchedMs:e.plannedMs,ok:true,reason:'提交，效果未知',skipped:false,skipClass:'',skipMarking:''};
  if(e.id==='ability-1')row.abilityAttempt={Identity:{EventId:'ability-1',ActorId:123,ActionId:132,TargetId:123},State:'attempted',NativeInvoked:true,NativeReturned:true,Message:'原生返回 true；效果未独立确认'};
  return row;});
 const snapshot={caps:{pluginInstanceId:'instance'},busy:false,input:{coordinateFeedback:{active:false,lastReport:reports[1],reports}},
  show:{state:aborted?'faulted':'completed',stopReason:aborted?'人工接管':'',projectId,stageMapping:mapping,packageId:mapping.packageId,clientLoadId:mapping.clientLoadId,
   startId:'start-'+run,events,recentLog,dispatched:recentLog.length,skipped:0,remaining:40-recentLog.length}};
 return {request,snapshot};
}
module.exports={fixture};
if(require.main===module)(async()=>{
 require('./choreo-stage-recovery.js');require('./choreo-stage-replay.js');
 const R=globalThis.ChoreoStageRecovery,normal=fixture(),abort=fixture('p','two',true),store={projectId:'p',contentExtra:{}};
 let release,done=false,calls=0;
 const saver=R.createSaver(),options={store,...normal,current(){assert.equal(store.projectId,'p')},projectRecord:()=>({id:'p',name:'test',content:structuredClone(store.contentExtra)}),
  saveActive:()=>{calls++;return new Promise(r=>release=r)}};
 const pending=saver(options).then(()=>done=true);await Promise.resolve();assert.equal(done,false);release(true);await pending;assert.equal(done,true);
 assert.equal(store.contentExtra.stagePathRecords[0].showResult.events.length,40);
 assert.equal(store.contentExtra.stagePathRecords[0].reports.length,2);
 const failed={...options,...abort,saveActive:async()=>false};await assert.rejects(saver(failed),/数据库未确认/);
 await saver({...failed,saveActive:async()=>true});assert.equal(store.contentExtra.stagePathRecords.length,2);
 const saved=structuredClone(store.contentExtra.stagePathRecords);assert.equal(saved[1].showResult.events.filter(e=>e.notDispatched).length,25);
 assert.equal(saved[1].showResult.events.filter(e=>e.evidenceMissing).length,0);
 assert.equal(saved[0].showResult.events.find(e=>e.id==='ability-1').abilityAttempt.Identity.EventId,'ability-1');
 assert.equal(globalThis.ChoreoStageReplay.eventRows(saved[1]).rows.at(-1).clsLabel,'未分发');
 assert.equal(globalThis.ChoreoStageReplay.movementMetrics(saved[0]).actualDistanceM,.2);
 // —— R4 反例（同一套合成数据，只在内存里改动一处身份/证据；必须拒绝或显式未知） ——
 const reject=(name,mutate,pattern)=>{const f=fixture();mutate(f);assert.throws(()=>R.result(f.request,f.snapshot),pattern,name)};
 reject('foreign segment EventId',f=>{f.snapshot.input.coordinateFeedback.reports[0].Path.EventId='not-in-show'},/不对应/);
 reject('segment on non-movement event',f=>{f.snapshot.input.coordinateFeedback.reports[0].Path.EventId='e5'},/移动事件/);
 reject('duplicate segment report',f=>{f.snapshot.input.coordinateFeedback.reports[1].Path.EventId='path-0'},/重复/);
 reject('foreign ability identity',f=>{f.snapshot.show.recentLog[10].abilityAttempt={Identity:{EventId:'foreign',ActorId:123},NativeInvoked:true}},/技能回执/);
 reject('ability actor mismatch',f=>{f.snapshot.show.recentLog[10].abilityAttempt={Identity:{EventId:'ability-1',ActorId:999},NativeInvoked:true}},/角色/);
 reject('duplicate declared event identity',f=>{f.snapshot.show.events[3].id='e2'},/重复事件身份/);
 // R4-ID/SEG/COUNT: malformed evidence must not reach persistence.
 reject('missing ability Identity',f=>{delete f.snapshot.show.recentLog[10].abilityAttempt.Identity},/技能回执/);
 for(const invalid of [false,0,'',[],true])reject('malformed ability receipt',f=>{f.snapshot.show.recentLog[10].abilityAttempt=invalid},/技能回执/);
 reject('identity-free ability on motion',f=>{f.snapshot.show.recentLog[3].abilityAttempt={NativeInvoked:true}},/技能回执/);
 // R4-ID 标量格式：数组/对象/布尔/数字不得经 String() 强转成身份（recentLog 与 outcome 两来源），保存回调零触达。
 for(const [field,bad] of [['EventId',['ability-1']],['ActorId',[123]],['EventId',{valueOf:()=>'ability-1'}],['ActorId',false],['ActorId',null],['EventId',10]])
  reject('non-scalar ability identity '+field,f=>{f.snapshot.show.recentLog[10].abilityAttempt.Identity[field]=bad},/技能回执/);
 reject('outcome non-scalar EventId',f=>{f.snapshot.show.events[10].outcome={Kind:'ability',Ok:true,AbilityAttempt:{Identity:{EventId:['ability-1'],ActorId:123,ActionId:132,TargetId:123},State:'attempted',NativeInvoked:true,NativeReturned:true}}},/技能回执/);
 {let writes=0;const bad=fixture();bad.snapshot.show.recentLog[10].abilityAttempt.Identity.ActorId=[123];
  await assert.rejects(R.createSaver()({...bad,store:{projectId:'p'},current(){},projectRecord(){return {id:'p'}},saveActive(){writes++;return true}}),/技能回执/);
  assert.equal(writes,0,'格式反例不得触达保存回调');}
 {const ok=fixture();ok.snapshot.show.recentLog[10].abilityAttempt.Identity.ActorId='123';// 数字串 ActorId 属既有合法线形态
  const r=R.result(ok.request,ok.snapshot);assert.equal(r.showResult.events.find(e=>e.id==='ability-1').abilityAttempt.Identity.ActorId,'123');}
 reject('partial dispatch contradiction',f=>{f.snapshot.show.recentLog=[];f.snapshot.show.events[3].dispatched=false},/分发/);
 reject('outcome contradicts false flag',f=>{f.snapshot.show.events[39].dispatched=false;f.snapshot.show.dispatched=39;f.snapshot.show.recentLog.pop();f.snapshot.show.events[39].outcome={EventId:'e39',Kind:'motion',Ok:true}},/分发/);
 reject('log contradicts false flag',f=>{f.snapshot.show.events[39].dispatched=false;f.snapshot.show.dispatched=39},/分发/);
 reject('segment report for unstarted event',f=>{f.snapshot.show.events[0].dispatched=false;f.snapshot.show.dispatched=39;f.snapshot.show.recentLog.shift()},/分发/);
 for(const count of [0,1]){
  const f=fixture();f.snapshot.input.coordinateFeedback.reports=f.snapshot.input.coordinateFeedback.reports.slice(0,count);
  const r=R.result(f.request,f.snapshot);assert.equal(r.reports.length,2);
  const unknown=r.reports.filter(x=>x.evidenceMissing);assert.equal(unknown.length,2-count);
  for(const x of unknown){assert.ok(x.Path.EventId);assert.equal(x.Completed,undefined);assert.equal(x.TotalDistanceM,undefined);}
 }
 const unstarted=fixture('p','never',true);unstarted.snapshot.show.events.forEach(e=>e.dispatched=false);unstarted.snapshot.show.dispatched=0;
 unstarted.snapshot.show.recentLog=[];unstarted.snapshot.input.coordinateFeedback={active:false,lastReport:null,reports:[]};
 const unstartedRecord=R.result(unstarted.request,unstarted.snapshot);
 assert.equal(unstartedRecord.reports.length,2);assert.ok(unstartedRecord.reports.every(r=>r.notDispatched===true&&r.Completed===undefined&&r.TotalDistanceM===undefined));
 let badWrites=0;const bad=fixture();delete bad.snapshot.show.recentLog[10].abilityAttempt.Identity;
 await assert.rejects(R.createSaver()({...bad,store:{projectId:'p'},current(){},projectRecord(){return {id:'p'}},saveActive(){badWrites++;return true}}),/技能回执/);assert.equal(badWrites,0);
 const missing=fixture();missing.snapshot.show.recentLog=[];
 const missingRecord=R.result(missing.request,missing.snapshot);
 assert.equal(missingRecord.showResult.events.filter(e=>e.notDispatched).length,0,'缺失证据不得伪装未分发');
 assert.equal(missingRecord.showResult.events.filter(e=>e.evidenceMissing).length,40,'缺失证据须显式未知');
 assert.equal(globalThis.ChoreoStageReplay.classifyEvent({id:'x',evidenceMissing:true}).label,'证据缺失（效果未知）');
 const wrong=structuredClone(normal);wrong.snapshot.caps.pluginInstanceId='other';assert.throws(()=>R.result(wrong.request,wrong.snapshot),/重载/);
 wrong.snapshot.caps.pluginInstanceId='instance';wrong.snapshot.input.coordinateFeedback.reports[0].Path.PackageId='other';assert.throws(()=>R.result(wrong.request,wrong.snapshot),/串场/);
 const early=fixture('p','three',true);early.snapshot.input.coordinateFeedback={active:false,lastReport:null,reports:[]};
 assert.equal(R.result(early.request,early.snapshot).report.Path,null);
 assert.deepEqual(saved,store.contentExtra.stagePathRecords);assert.equal(calls,1);
 console.log('PASS complete 40 events / 2 segments coherent identities, normal+abort, receipt wait, failure retry, no duplicate, R4 identity counterexamples, missing evidence explicit, early-abort unknown observation');
})().catch(e=>{console.error(e);process.exitCode=1});
