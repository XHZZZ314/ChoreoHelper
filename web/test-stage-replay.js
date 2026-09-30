// 演出复盘视图测试：只读消费已保存 stagePathRecords——逐事件计划vs实际对照、走位指标、审阅快照回看、
// 手动模式信息、按事件时刻定位网页编排预览；旧记录缺字段按只读兼容降级并说明；绝不发任何游戏请求。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// 夹具与产品代码里全部明确标注：以下为自动化合成夹具（synthetic:true），非真实演出结果。
const fullRecord={version:1,synthetic:true,savedAt:'2026-09-15T10:00:00.000Z',packageId:'web-pkg',clientLoadId:'web-load',instanceId:'session-1',
  review:{version:1,projectId:'p1',performerId:'d1',dancerName:'舞者甲',eventId:'mv1',
    actor:{id:'123',territoryId:816,worldX:1,worldZ:2,rotationRad:0},stage:{id:'stage-d1',originX:1,originZ:2,yawDeg:0},
    points:[{tMs:0,x:0,z:0,yawDeg:0,worldX:1,worldZ:2},{tMs:2000,x:0,z:0.3,yawDeg:90,worldX:1,worldZ:2.3},{tMs:4000,x:0,z:0.6,yawDeg:90,worldX:1,worldZ:2.6}],
    segments:[{startMs:0,endMs:2000,distanceM:0.3,speedMps:0.15,bearingDeg:0,turnDegPerSecond:45},{startMs:2000,endMs:4000,distanceM:0.3,speedMps:0.15,bearingDeg:0,turnDegPerSecond:0}],
    distanceM:0.6,durationMs:4000,warnings:['合成夹具'],locomotion:'run',
    whole:{path:{performerId:'d1',eventId:'mv1',durationMs:4000},context:{actorId:'123',territoryId:816},projectId:'p1',name:'演示项目',timelineRevision:7,
      rows:[
        {trackId:'t1',performerId:'d1',event:{id:'mv1',kind:'movement',startMs:0,durationMs:4000,command:'',name:'路径'},enabled:true,supported:true,reason:'按原时刻执行'},
        {trackId:'t1',performerId:'d1',event:{id:'mv1-f1',kind:'facing',startMs:0,durationMs:1000},enabled:true,supported:false,reason:'四键模式先转向再走：与路径段重叠的独立朝向本场排除，不能裁剪或重定时'},
        {trackId:'t1',performerId:'d1',event:{id:'fc1-f2',kind:'facing',startMs:4100,durationMs:800},enabled:true,supported:true,reason:'按原时刻执行'},
        {trackId:'t1',performerId:'d1',event:{id:'mo1',kind:'motion',startMs:1500,durationMs:2000,command:'/wave motion',name:'挥手'},enabled:true,supported:true,reason:'按原时刻执行'},
        {trackId:'t1',performerId:'d1',event:{id:'ab1',kind:'ability',startMs:3000,durationMs:100,command:'',name:'神速咏唱'},enabled:true,supported:true,reason:'按原时刻执行'},
        {trackId:'t1',performerId:'d1',event:{id:'ot1',kind:'motion',startMs:100,durationMs:500,command:'/dance motion'},enabled:true,supported:false,reason:'仅支持原地单次动作；循环或根位移不能改写为单次执行'}
      ],
      errors:[],segmentCount:2,showMs:4900,stageFacing:true,facingIncluded:1}},
  mapping:{summary:'历史映射摘要\n确认当前…'},
  report:{Completed:true,Status:'已完成',AtMs:4016,TargetX:1,TargetZ:2.6,ArrivalToleranceM:0.12,FinalDistanceToTargetM:0.025,TotalDistanceM:0.5,MaxPathTrackingErrorM:0.05,ManualMode:'Cooperate',ManualInterventions:1,ManualResumptions:2,Path:{PackageId:'native',ClientLoadId:'native-load'}},
  showResult:{state:'completed',stopReason:null,cleanupFailed:false,showTimeMs:4900,
    events:[
      {id:'mv1',kind:'movement',plannedMs:0,dispatchedMs:0,ok:true,reason:'路径段开始',skipped:false},
      {id:'mo1',kind:'motion',plannedMs:1500,dispatchedMs:1506,ok:true,reason:'已提交',skipped:false},
      {id:'zz1',kind:'motion',plannedMs:900,dispatchedMs:905,ok:false,reason:'键位占用，已跳过',skipped:true,skipClass:'input'},
      {id:'mv1-s2',kind:'movement',plannedMs:2000,dispatchedMs:2008,ok:true,reason:'路径段开始',skipped:false},
      {id:'ab1',kind:'ability',plannedMs:3000,dispatchedMs:3010,ok:true,reason:'native True',skipped:false},
      {id:'fc9',kind:'facing',plannedMs:5000,dispatchedMs:5001,ok:false,reason:'输入护栏拒绝',skipped:false},
      {id:'fc1-f2',kind:'facing',plannedMs:4100,dispatchedMs:4102,ok:true,reason:'已转向提交',skipped:false}
    ],dispatched:6,skipped:1,remaining:0}};
// 旧版/仅路径记录：无 whole 审阅快照、报告缺数值字段、无逐事件日志——必须降级说明而非伪造。
const oldRecord={version:1,savedAt:'2026-09-14T08:00:00.000Z',packageId:'old-pkg',clientLoadId:'old-load',instanceId:'session-0',
  review:{version:1,projectId:'p1',performerId:'d1',dancerName:'舞者甲',eventId:'mv0',distanceM:0.36,durationMs:4000,
    points:[],segments:[{startMs:0,endMs:4000,distanceM:0.36,speedMps:0.09,bearingDeg:0,turnDegPerSecond:0}]},
  mapping:{},report:{Completed:false,Status:'已中止',ManualMode:'Interrupt'},showResult:{state:'faulted',stopReason:'角色变化',cleanupFailed:false,showTimeMs:1200,events:[],dispatched:0,skipped:0,remaining:1}};
const truncated={version:1,synthetic:true,savedAt:'2026-09-15T11:00:00.000Z',review:{dancerName:'舞者乙',distanceM:1.2},
  report:{Status:'已完成',TotalDistanceM:1.1,FinalDistanceToTargetM:0.03},
  showResult:{state:'completed',stopReason:null,events:[
    {id:'a9',kind:'motion',plannedMs:9000,dispatchedMs:9004,ok:true,reason:'已提交',skipped:false},
    {id:'b8',kind:'movement',plannedMs:9500,dispatchedMs:9507,ok:true,reason:'路径段开始',skipped:false},
    {id:'c7',kind:'ability',plannedMs:9800,dispatchedMs:9803,ok:true,reason:'native True',skipped:false}
  ],dispatched:8,skipped:2,remaining:0}};

function setup(options){
  options=options||{};
  const elements=[];
  function element(tag){const e={tag,style:{cssText:''},children:[],isConnected:true,textContent:'',value:'',checked:false,disabled:false,
    setAttribute(){},appendChild(c){this.children.push(c);return c},remove(){this.isConnected=false},showModal(){},close(){this.onclose&&this.onclose()}};
    elements.push(e);return e}
  const state=Object.assign({projectId:'p1',projectName:'演示项目',currentTime:0,previewTarget:'web',_docRev:7,
    contentExtra:{stagePathRecords:[]},dancers:[{id:1,name:'舞者甲',start:{x:0,z:0,yawDeg:0}}]},options.state||{});
  const w={store:state,document:{createElement:element,body:element('body')},
    seekCalls:[],apiCalls:[],
    seekTimelinePosition(t){w.seekCalls.push(t);state.currentTime=t},
    apiFetch:async p=>{w.apiCalls.push(p);throw Error('复盘不得发起任何 HTTP 请求：'+p)}};
  w.window=w;w.globalThis=w;
  const ctx=vm.createContext(w);
  for(const f of ['choreo-stage-motion.js','choreo-stage-recovery.js','choreo-stage-replay.js','choreo-stage-game-ui.js'])
    vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
  return {w,elements,button:text=>elements.find(e=>e.tag==='button'&&e.textContent===text)};
}

(async()=>{
  const R=setup().w.ChoreoStageReplay;
  assert.ok(R,'ChoreoStageReplay 模块应存在（旧代码下此断言为红基线）');

  // —— 纯函数：逐事件对照 ——
  let t=R.eventRows(fullRecord);
  assert.equal(t.rows.length,7);
  const mo1=t.rows.find(r=>r.id==='mo1');
  assert.equal(mo1.deltaMs,6);assert.equal(mo1.cls,'ok');assert.equal(mo1.clsLabel,'已提交（效果未确认）');
  assert.equal(t.rows.find(r=>r.id==='zz1').clsLabel,'已跳过');
  assert.equal(t.rows.find(r=>r.id==='fc9').clsLabel,'失败');
  assert.deepEqual(Array.from(t.notes),[]);
  t=R.eventRows(oldRecord);
  assert.deepEqual(Array.from(t.rows),[]);assert.ok(t.notes.length===1&&t.notes[0].includes('未保存逐事件结果日志')&&t.notes[0].includes('不伪造'));
  t=R.eventRows(truncated);
  assert.equal(t.rows.length,3);
  assert.ok(t.notes.some(n=>n.includes('仅保留尾部 3 条')&&n.includes('共 10 条')),'应说明日志截断且不伪造补齐');

  // —— 纯函数：审阅快照 ↔ 实际结果并列 ——
  let m=R.mergeReview(fullRecord);
  assert.equal(m.pairs.length,6);
  const mv=m.pairs.find(p=>p.id==='mv1');
  assert.equal(mv.results.length,2,'原始路径行应并列它的全部切分段结果（mv1 与 mv1-s2）');
  assert.deepEqual(mv.results.map(r=>r.id),['mv1','mv1-s2']);
  const ex=m.pairs.find(p=>p.id==='mv1-f1');
  assert.equal(ex.supported,false);assert.ok(ex.reviewReason.includes('四键'));assert.deepEqual(ex.results,[]);
  assert.equal(m.pairs.find(p=>p.id==='fc1-f2').results.length,1);
  m=R.mergeReview(oldRecord);
  assert.deepEqual(Array.from(m.pairs),[]);assert.ok(m.notes.length===1&&m.notes[0].includes('未保存整场审阅快照'));

  // —— 纯函数：走位指标 ——
  let mm=R.movementMetrics(fullRecord);
  assert.equal(mm.plannedDistanceM,0.6);assert.equal(mm.actualDistanceM,0.5);assert.equal(mm.endpointErrorM,0.025);
  assert.equal(mm.maxTrackingErrorM,0.05);assert.equal(mm.arrivalToleranceM,0.12);assert.equal(mm.segmentCount,2);
  assert.equal(mm.segments.length,2);assert.equal(mm.notes.length,0,'完整记录不应有走位降级说明');
  mm=R.movementMetrics(oldRecord);
  assert.equal(mm.actualDistanceM,null);assert.equal(mm.endpointErrorM,null);
  assert.ok(mm.notes.some(n=>n.includes('实际累计距离未存入')&&n.includes('不推断')));
  assert.ok(mm.notes.some(n=>n.includes('终点误差未存入')));

  // —— 纯函数：手动模式与来源标注 ——
  let mi=R.manualInfo(fullRecord.report);
  assert.ok(mi.mode.includes('手动与自动协同'));assert.equal(mi.interventions,1);assert.equal(mi.resumptions,2);
  assert.equal(R.manualInfo(oldRecord.report).mode.includes('手动打断自动'),true);
  assert.equal(R.manualInfo({Status:'x'}),null);
  assert.ok(R.sourceLabel(fullRecord).includes('自动化合成夹具')&&R.sourceLabel(fullRecord).includes('非真实演出'));
  assert.ok(R.sourceLabel(oldRecord).includes('插件报告'));

  // —— UI：只读复盘对话框 ——
  let s=setup({state:{contentExtra:{stagePathRecords:[fullRecord,oldRecord]}}});
  s.w.ChoreoStageReplay.open(fullRecord);
  const txt=()=>s.elements.map(e=>collect(e)).join('\n');
  function collect(e){let out=(e.tag==='button'?'['+e.textContent+']':e.textContent||'')||'';e.children.forEach(c=>out+=collect(c));return out}
  assert.ok(s.elements.some(e=>e.tag==='h3'&&e.textContent.includes('演出复盘')));
  assert.ok(txt().includes('回放的是编排数据，不是游戏实况录像'));
  assert.ok(txt().includes('自动化合成夹具'),'UI 必须明确标注合成夹具');
  const motionRow=s.elements.find(e=>e.tag==='tr'&&e.children[0]?.textContent==='mo1');
  assert.deepEqual(motionRow.children.slice(0,7).map(e=>e.textContent),['mo1','motion','1500ms','1506ms','+6ms','已提交（效果未确认）','已提交'],'逐事件完整表格行保留计划、实际、偏差、结果和原因');
  assert.ok(txt().includes('已跳过')&&txt().includes('失败')&&txt().includes('键位占用'),'须有跳过/失败分类与原因');
  assert.ok(txt().includes('四键模式先转向再走'),'审阅快照须保留四键排除原因');
  assert.ok(txt().includes('计划路程 0.600 米')&&txt().includes('实际累计 0.500 米')&&txt().includes('终点误差 0.025 米'));
  assert.ok(txt().includes('mv1-s2')&&txt().includes('2 段'),'多段执行须逐段可见');
  assert.ok(txt().includes('只显示提交与回执')&&txt().includes('不代表游戏内效果'),'技能只显示提交与回执');
  assert.ok(txt().includes('手动与自动协同')&&txt().includes('介入 1')&&txt().includes('续走 2'));
  assert.ok(txt().includes('本场已结束')&&txt().includes('正常完成，无异常停止'),'完成态须如实标注');
  assert.ok(txt().includes('不恢复执行许可')&&txt().includes('不触发任何游戏输出'));

  // 定位按钮：网页预览走本地 seek；游戏预览模式拒绝且不发请求
  const locateBtns=s.elements.filter(e=>e.tag==='button'&&e.textContent==='定位');
  assert.ok(locateBtns.length>=7,'逐事件每行应有定位按钮');
  locateBtns[1].onclick();
  assert.deepEqual(s.w.seekCalls,[1.5]);assert.equal(s.w.store.currentTime,1.5);
  s.w.store.previewTarget='game';locateBtns[1].onclick();
  assert.deepEqual(s.w.seekCalls,[1.5],'游戏预览模式下不得定位');
  assert.ok(txt().includes('游戏预览模式')&&txt().includes('不向游戏发送任何请求'));
  assert.deepEqual(s.w.apiCalls,[],'复盘视图不得发起任何 HTTP 请求');
  s.w.store.previewTarget='web';

  // 旧记录降级文案
  s=setup();s.w.ChoreoStageReplay.open(oldRecord);
  const txt2=()=>s.elements.map(e=>collect(e)).join('\n');
  assert.ok(txt2().includes('未保存逐事件结果日志'));
  assert.ok(txt2().includes('未保存整场审阅快照'));
  assert.ok(txt2().includes('实际累计距离未存入'));
  assert.ok(txt2().includes('停止原因')&&txt2().includes('角色变化'),'整场停止原因必须显示');
  assert.ok(txt2().includes('插件报告'));

  // 时间轴漂移提示：保存后项目已改（修订号 7→9）
  s=setup({state:{_docRev:9}});s.w.ChoreoStageReplay.open(fullRecord);
  const txt3=()=>s.elements.map(e=>collect(e)).join('\n');
  assert.ok(txt3().includes('保存后项目已有修改'));
  s=setup({state:{_docRev:7}});s.w.ChoreoStageReplay.open(fullRecord);
  assert.ok(!s.elements.map(e=>collect(e)).join('\n').includes('保存后项目已有修改'));

  // —— 集成：现有游戏走位对话框提供复盘入口 ——
  s=setup({state:{contentExtra:{stagePathRecords:[fullRecord]}}});
  s.w.ChoreoStageGameUI.open(0);
  const replayEntry=s.elements.filter(e=>e.tag==='button'&&e.textContent==='复盘');
  assert.equal(replayEntry.length,1,'结果区每条记录一个复盘按钮');
  replayEntry[0].onclick();
  assert.ok(s.elements.some(e=>e.tag==='h3'&&e.textContent.includes('演出复盘')),'点击后打开复盘对话框');
  assert.deepEqual(s.w.apiCalls,[],'入口与复盘全程零 HTTP');

  // —— 静态边界：模块源码零网络出口 ——
  const src=fs.readFileSync(__dirname+'/choreo-stage-replay.js','utf8');
  assert.ok(!/apiFetch|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/i.test(src),'复盘模块不得包含任何网络/存储出口');
  assert.ok(!/saveActive|saveHistory|persistProject/.test(src),'复盘模块不得写项目或历史');
  // HTML 装载：经典脚本进外壳
  assert.ok(fs.readFileSync(__dirname+'/choreo-helper-app.html','utf8').includes('choreo-stage-replay.js'),'外壳须装载复盘模块');

  console.log('PASS stage replay view: per-event plan-vs-actual, movement metrics, review snapshot, manual info, read-only locate, degraded old records');
})().catch(e=>{console.error(e);process.exitCode=1});
