// B5 表 A 时间变换纯函数：T4/T5/T6 唯一归属 choreo-stage-motion.js、B1 内联 T1 锚点收编、
// ability-plan 技能右移辅助、edit 插/删预告计数。全部经真实产品模块（M/A/CE）采样与解析器；
// 数值例按 R4 §三表 A 双侧口径（变换前后都采样）；R5-01/R5-02 拒绝与容量条款入断言。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
// B5_SOURCE 指向保存的旧文件目录时可对拍红测（产品件都从那里读）。
const src=n=>path.join(process.env.B5_SOURCE||__dirname,n);
const ctx={};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['choreo-edit.js','choreo-stage-motion.js','choreo-ability-plan.js'])vm.runInContext(fs.readFileSync(src(f),'utf8'),ctx,{filename:f});
const CE=ctx.ChoreoEdit.pure,M=ctx.ChoreoStageMotion,A=ctx.ChoreoAbilityPlan;
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const close=(a,b)=>assert.ok(Math.abs(a-b)<=0.001+1e-9,`${a} !~ ${b}`);
// vm 上下文里创建的数组/对象与宿主字面量过 deepEqual 会因 realm 原型不同而失败——统一 JSON 化比较。
const j=v=>JSON.parse(JSON.stringify(v));
function mkState(n=1){return {dancers:Array.from({length:n},(_,i)=>({id:i+1,name:'B5 '+(i+1),start:{x:0,z:0,yawDeg:0},actionClips:[],switchClips:[],lyricClips:[]})),globalLyrics:[],markers:[],contentExtra:{_doc:{extraTracks:[]}}};}
const baseOf=s=>CE.placementFor(s.dancers,0)||{x:0,z:0,yawDeg:0};
// 数值节点 → 安装成真实产品轨（movement + 可选 facing），返回该状态。
function host(ns,fs2){
  const s=mkState();
  const vals={movement:(ns||[]).map(n=>({time:String(n.t),x:String(n.x),z:String(n.z),...(n.move?{move:n.move}:{})})),
    facing:(fs2||[]).map(n=>({time:String(n.t),yaw:String(n.yaw)}))};
  if((ns&&ns.length)||(fs2&&fs2.length))M.install(s,M.edit(s,0,vals,'b5host'));
  return s;
}
const N=(t,x,z=0,move)=>({t,x,z,...(move?{move}:{})});
const NF=(t,yaw)=>({t,yaw});
const valsOf=(s,kind)=>kind==='movement'?M.nodes(s,0).movement:M.nodes(s,0).facing;
// 结果安装回真实轨再采样（双侧断言的“后”侧一律走产品 sample）。
const canonM=ns=>host(ns);
const canonF=fs2=>host(null,fs2);
const px=(s,t)=>M.sample(s,0,t*1000,baseOf(s)).x;
const pz=(s,t)=>M.sample(s,0,t*1000,baseOf(s)).z;
const pyaw=(s,t)=>M.sample(s,0,t*1000,baseOf(s)).yawDeg;
// 把 T4/T5/T6 的 values 输出安装为真实轨（movement 或 facing），供采样断言。
function installVals(out,kind){
  const s=mkState(),v=kind==='facing'?{movement:[],facing:out.values}:{movement:out.values,facing:[]};
  if(out.values.length)M.install(s,M.edit(s,0,v,'b5res'));
  return s;
}

// ---------- T4 插时间 ----------
test('T4-1 0.004 不归零＋保持＋位移（双侧）',()=>{
  const before=host([N(2,.004),N(4,1)]);
  const g=M.t4Insert(valsOf(before,'movement'),2,1,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse,JSON.stringify(g));
  assert.equal(g.shifted,2);assert.equal(g.anchors,2);assert.equal(g.changed,true);
  const node2=g.values.find(v=>Math.abs(Number(v.time)-2)<1e-9);
  assert.equal(node2.x,'0.004');
  const after=installVals(g,'movement');
  near(px(after,2.5),.004);near(px(after,4),.502);near(px(before,3),.502);
});
test('T4-2 x=t 2..8 a=3 Δ=2 三段保证（双侧）',()=>{
  const before=host([N(2,2),N(4,4),N(6,6),N(8,8)]);
  const g=M.t4Insert(valsOf(before,'movement'),3,2,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse);assert.equal(g.shifted,3);assert.equal(g.anchors,2);
  const after=installVals(g,'movement');
  near(px(after,2.5),2.5);near(px(after,4),3);near(px(after,7),5);near(px(after,9),7);
  near(px(before,5),5);near(px(before,7),7);
  assert.deepEqual(j(g.values.map(v=>Number(v.time))),[2,3,5,6,8,10]);
});
test('T4-3 a=0 只加 (Δ,起始位) 单锚点',()=>{
  const before=host([N(2,2),N(4,4)]);
  const g=M.t4Insert(valsOf(before,'movement'),0,2,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse);assert.equal(g.anchors,1);assert.equal(g.shifted,2);
  assert.ok(g.values.every(v=>Number(v.time)>0));
  const after=installVals(g,'movement');
  near(px(after,1),0);near(px(after,3),1);
});
test('T4-4 6(6,run) 于 2s 插 1s：来向 run 保留在首边界锚点、保持末锚点无步态',()=>{
  const before=host([N(6,6,0,'run')]);
  const g=M.t4Insert(valsOf(before,'movement'),2,1,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse);
  const first=g.values.find(v=>Number(v.time)===2),hold=g.values.find(v=>Number(v.time)===3);
  assert.equal(first.move,'run','首边界锚点带覆盖段步态');
  assert.equal(hold.move,undefined,'保持末锚点无步态');
  const after=installVals(g,'movement');
  assert.equal(M.metrics(after,0,baseOf(after)).speedSegments[0].move,'run','产品 metrics 首段 run');
});
test('T4-5 同刻合并：原节点恰在 a，右移后与保持锚点同刻同位合并且不翻倍',()=>{
  const before=host([N(3,3,0,'run'),N(5,5)]);
  const g=M.t4Insert(valsOf(before,'movement'),3,2,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse);
  assert.deepEqual(j(g.values.map(v=>Number(v.time))),[3,5,7]);
  assert.equal(g.values.find(v=>Number(v.time)===5).move,'run','合并保留先到对象＝右移节点，run 随节点保留（R4 unify 语义）');
  const after=installVals(g,'movement');near(px(after,4),3);near(px(after,6),4); // t≥a+Δ＝原 t−Δ：原 t4 处 4
});
test('T4-6 无 t≥a 节点＝无改动（R5-07 不回写）',()=>{
  const before=host([N(2,2),N(4,4)]);
  const g=M.t4Insert(valsOf(before,'movement'),6,2,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse);assert.equal(g.changed,false);assert.equal(g.shifted,0);assert.equal(g.anchors,0);
  assert.deepEqual(j(g.values.map(v=>Number(v.time))),[2,4]);
});
for(const bad of [['Δ<0.5',[N(2,2)],2,.3],['a<0',[N(2,2)],-1,1]]){
  test('T4-7 拒绝 '+bad[0],()=>{
    const before=host(bad[1]);
    const g=M.t4Insert(valsOf(before,'movement'),bad[2],bad[3],before,0,baseOf(before),'movement');
    assert.ok(g.refuse&&g.refuse.includes(bad[0]),JSON.stringify(g));
  });
}
for(const finalCount of [499,500,501]){
  test('T4-8 最终容量 '+finalCount+'（R5-02 合并后列表为准）',()=>{
    const ns=Array.from({length:finalCount-2},(_,i)=>N(i+1,i+1)); // 插入后 = 原 + 2 锚点
    const before=host(ns);
    const g=M.t4Insert(valsOf(before,'movement'),0.5,2,before,0,baseOf(before),'movement');
    if(finalCount<=500){assert.ok(!g.refuse,JSON.stringify(g));assert.equal(g.values.length,finalCount)}
    else{assert.ok(g.refuse&&/500/.test(g.refuse),JSON.stringify(g))}
  });
}
test('T4-9 锁定轨在原状态克隆上拒绝（R5-01 零写入）',()=>{
  const before=host([N(2,2),N(4,4)]);
  M.tracks(before)[0].locked=true;
  const snap=JSON.stringify(before);
  const g=M.t4Insert(valsOf(before,'movement'),2,1,before,0,baseOf(before),'movement');
  assert.ok(g.refuse,JSON.stringify(g));
  assert.equal(JSON.stringify(before),snap,'原状态字节不变');
});
test('T4-10 朝向按 yaw 同规则（锚点=q3(yaw 采样)）',()=>{
  const before=host(null,[NF(6,90)]);
  const g=M.t4Insert(valsOf(before,'facing'),2,1,before,0,baseOf(before),'facing');
  assert.ok(!g.refuse);assert.equal(g.shifted,1);assert.equal(g.anchors,2);
  const after=installVals(g,'facing');
  near(pyaw(after,2.5),30);near(pyaw(after,4),45);near(pyaw(before,3),45);
});

// ---------- T5 删时间 [a,b) ----------
test('T5-1 x=t 1..8 删 [4,6)（双侧）',()=>{
  const line=Array.from({length:8},(_,i)=>N(i+1,i+1));
  const before=host(line);
  const g=M.t5Delete(valsOf(before,'movement'),4,6,before,0,baseOf(before));
  assert.ok(!g.refuse);
  const after=installVals(g,'movement');
  near(px(after,3),3);near(px(after,5),7);near(px(after,4),6);near(px(before,4),4);
  assert.deepEqual(j(g.affected),[3,4]);
  assert.deepEqual(j(g.values.map(v=>Number(v.time))),[1,2,3,4,5,6]);
});
test('T5-2 跨度≤0 拒绝',()=>{
  const before=host([N(2,2)]);
  const g=M.t5Delete(valsOf(before,'movement'),4,4,before,0,baseOf(before));
  assert.ok(g.refuse&&g.refuse.includes('跨度'),JSON.stringify(g));
});
test('T5-3 删后首节点落 0 秒拒绝／窗口超末点拒绝（零写入提示）／kept 空起点段预告',()=>{
  const b1=host([N(2,2),N(4,4)]);
  const r1=M.t5Delete(valsOf(b1,'movement'),0,2,b1,0,baseOf(b1));
  assert.ok(r1.refuse&&r1.refuse.includes('0 秒'),JSON.stringify(r1));
  const b2=host([N(2,2),N(4,4)]);
  const r2=M.t5Delete(valsOf(b2,'movement'),6,8,b2,0,baseOf(b2));
  assert.ok(r2.refuse&&r2.refuse.includes('末节点之后')&&r2.afterEnd,JSON.stringify(r2));
  const b3=host([N(3,5)]);
  const r3=M.t5Delete(valsOf(b3,'movement'),0,1,b3,0,baseOf(b3));
  assert.ok(!r3.refuse&&r3.startSegmentChange,JSON.stringify(r3));
});
test('T5-4 尾部删除 [t_prev,END] 终态改前节点值（双侧）',()=>{
  const before=host([N(2,2),N(4,4)]);
  const g=M.t5Delete(valsOf(before,'movement'),4,6,before,0,baseOf(before));
  assert.ok(!g.refuse&&g.terminalChange);
  const after=installVals(g,'movement');
  near(px(after,10),2);near(px(before,10),4);
});
test('T5-5 全删节点＝合法清空整轨 [0,END] 回起始位（R4-03/N05）',()=>{
  const before=host([N(3,5),N(8,9)]);
  const g=M.t5Delete(valsOf(before,'movement'),1,10,before,0,baseOf(before));
  assert.ok(!g.refuse&&g.clearedAll&&g.values.length===0&&g.revertsToBase,JSON.stringify(g));
  assert.deepEqual(j(g.affected),[0,'END']);
  const after=installVals(g,'movement'); // values 空 → 轨移除，采样回起始位
  near(px(after,30),0);
});
test('T5-6 kept/moved 全组合无异常逃逸',()=>{
  for(const [ns,a,b] of [[[N(3,5),N(8,9)],1,10],[[N(3,5),N(8,9)],0,3],[[N(3,5),N(8,9)],9,12],[[N(4,4)],0,9],[[N(4,4)],2,6]]){
    const h=host(ns);
    const r=M.t5Delete(valsOf(h,'movement'),a,b,h,0,baseOf(h));
    if(!r.refuse)assert.ok(Array.isArray(r.values));
    else assert.equal(r.values,undefined);
  }
});
test('T5-7 锁定轨全清在原状态克隆上拒绝（R5-01 空结果同样传播拒绝）',()=>{
  const before=host([N(3,5),N(8,9)]);
  M.tracks(before)[0].locked=true;
  const snap=JSON.stringify(before);
  const g=M.t5Delete(valsOf(before,'movement'),1,10,before,0,baseOf(before));
  assert.ok(g.refuse,JSON.stringify(g));
  assert.equal(JSON.stringify(before),snap);
});

// ---------- T6 整段平移 [a,b] Δ（本批纯函数＋单测；UI 归 B7a） ----------
test('T6-1 稀疏 10(10) [2,4]+2：窗末边界锚点＋形状平移（双侧）',()=>{
  const before=host([N(10,10)]);
  const g=M.t6Shift(valsOf(before,'movement'),2,4,2,false,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse&&!g.conflicts,JSON.stringify(g));
  assert.ok(g.values.some(v=>Math.abs(Number(v.time)-6)<1e-9));
  const after=installVals(g,'movement');
  near(px(after,5),3);near(px(before,3),3);
  near(px(after,1),1);near(px(before,1),1);
  near(px(after,3),2);near(px(before,8),8);near(px(after,8),7);
});
test('T6-2 x=t 1..8 [2,4]+2：冲突预检点名 5、6；覆盖后节点如合同（双侧）',()=>{
  const line=Array.from({length:8},(_,i)=>N(i+1,i+1));
  const before=host(line);
  const pre=M.t6Shift(valsOf(before,'movement'),2,4,2,false,before,0,baseOf(before),'movement');
  assert.deepEqual(j(pre.conflicts),[5,6]);
  assert.equal(pre.values,undefined,'未决冲突不出节点');
  const cov=M.t6Shift(valsOf(before,'movement'),2,4,2,true,before,0,baseOf(before),'movement');
  assert.ok(!cov.refuse);
  assert.deepEqual(j(cov.values.map(v=>[Number(v.time),Number(v.x)])),[[1,1],[2,2],[4,2],[5,3],[6,4],[7,7],[8,8]]);
  const after=installVals(cov,'movement');
  near(px(after,5),3);near(px(before,3),3);
});
test('T6-3 负位移 [4,6]−1 覆盖删 3：平移段=原 t−Δ、前缀精确、窗前重连已预告',()=>{
  const line=Array.from({length:8},(_,i)=>N(i+1,i+1));
  const before=host(line);
  const neg=M.t6Shift(valsOf(before,'movement'),4,6,-1,true,before,0,baseOf(before),'movement');
  assert.ok(!neg.refuse,JSON.stringify(neg));
  const after=installVals(neg,'movement');
  near(px(after,3.5),4.5);near(px(before,4.5),4.5);
  near(px(after,4),5);near(px(before,5),5);
  near(px(after,1),1);near(px(before,1),1);
  assert.equal(neg.guarantees.unchangedPrefixUpTo,2);
  assert.equal(neg.affected[0][0],2);
  assert.ok(String(neg.affected[0][2]).includes('窗前重连'));
  assert.ok(Math.abs(px(after,2.5)-px(before,2.5))>1e-6,'t2.5 落窗前重连段（2.5→3.0）');
  const pre=M.t6Shift(valsOf(before,'movement'),4,6,-1,false,before,0,baseOf(before),'movement');
  assert.deepEqual(j(pre.conflicts),[3]);
});
for(const bad of [['零位移',[2,4],0],['0.5',[2,4],.3]]){
  test('T6-4 拒绝 '+bad[0],()=>{
    const line=Array.from({length:8},(_,i)=>N(i+1,i+1));
    const before=host(line);
    const g=M.t6Shift(valsOf(before,'movement'),bad[1][0],bad[1][1],bad[2],false,before,0,baseOf(before),'movement');
    assert.ok(g.refuse&&g.refuse.includes(bad[0]),JSON.stringify(g));
  });
}
test('T6-5 窗口超末点拒绝',()=>{
  const before=host([N(2,2),N(4,4)]);
  const g=M.t6Shift(valsOf(before,'movement'),6,8,2,false,before,0,baseOf(before),'movement');
  assert.ok(g.refuse&&g.refuse.includes('末节点之后'),JSON.stringify(g));
});
test('T6-6 朝向 T6 稀疏保形（产品 yaw 采样）',()=>{
  const before=host(null,[NF(12,120)]);
  const g=M.t6Shift(valsOf(before,'facing'),3,5,1.5,false,before,0,baseOf(before),'facing');
  assert.ok(!g.refuse,JSON.stringify(g));
  const after=installVals(g,'facing');
  near(pyaw(after,5),35);near(pyaw(before,3.5),35);
});
test('T6-7 稀疏非零 Z 双轴 [3,5]+1.5 于 12(9,−6)',()=>{
  const before=host([N(12,9,-6)]);
  const g=M.t6Shift(valsOf(before,'movement'),3,5,1.5,false,before,0,baseOf(before),'movement');
  assert.ok(!g.refuse,JSON.stringify(g));
  assert.ok(g.values.some(v=>Math.abs(Number(v.time)-6.5)<1e-9),'窗末边界锚点 6.5');
  const after=installVals(g,'movement');
  for(const t of [3,3.25,4,4.75,5]){close(px(before,t),px(after,t+1.5));close(pz(before,t),pz(after,t+1.5))}
});

// ---------- B1 内联 T1 锚点收编（公共纯函数；applySamePlace 回接后行为零变化由 b1 回归保证） ----------
test('T1-1 窗口替换：保留 <a 与 >b、a>0 补出发锚点（采样+来向步态）、(b,dest) 按用户步态',()=>{
  const before=host([N(2,0),N(10,8,0,'run'),N(12,8),N(20,20)]);
  const g=M.t1Window(valsOf(before,'movement'),8000,12000,{x:5,z:3},undefined,before,0,baseOf(before));
  assert.deepEqual(j(g.map(v=>Number(v.time))),[2,8,12,20]);
  assert.equal(g.find(v=>Number(v.time)===8).x,'6','出发锚点=原轨迹 8s 采样（0→8 直线）');
  assert.equal(g.find(v=>Number(v.time)===8).move,'run','来向步态保留（原 8s 处节点带 run）');
  assert.equal(g.find(v=>Number(v.time)===12).x,'5');assert.equal(g.find(v=>Number(v.time)===12).z,'3');
  assert.equal(g.find(v=>Number(v.time)===12).move,undefined);
  const run=M.t1Window(valsOf(before,'movement'),8000,12000,{x:5,z:3},'run',before,0,baseOf(before));
  assert.equal(run.find(v=>Number(v.time)===12).move,'run','到达节点 move 按用户选择');
});
test('T1-2 a=0 不补保持锚点；窗口内节点整段替换；无前/后节点边界',()=>{
  const b=host([N(4,4),N(6,6)]);
  const g=M.t1Window(valsOf(b,'movement'),0,4000,{x:9,z:0},undefined,b,0,baseOf(b));
  assert.deepEqual(j(g.map(v=>Number(v.time))),[4,6]);
  assert.equal(g[0].x,'9');
  const b2=host([N(2,2)]);
  const g2=M.t1Window(valsOf(b2,'movement'),2000,6000,{x:7,z:1},undefined,b2,0,baseOf(b2));
  assert.deepEqual(j(g2.map(v=>Number(v.time))),[2,6]);
  assert.equal(g2[0].x,'2');assert.equal(g2[1].x,'7');
});

// ---------- ability-plan 技能右移纯函数（不落库） ----------
function skillTrack(){
  return {id:'ab-t',type:'ability',performerId:'actor-1',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',
    events:[
      {id:'e1',kind:'ability',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',startMs:2000,durationMs:2000,sourceRef:{kind:'action',id:'120'},data:{rehearsalAbility:{version:1,actionId:'120',name:'S',castMs:1000,presentationMs:1000,target:{kind:'party',performerId:'actor-2'},animation:'not-connected',gameOutput:false}}},
      {id:'e2',kind:'ability',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',startMs:3000,durationMs:2000,sourceRef:{kind:'action',id:'121'},data:{rehearsalAbility:{version:1,actionId:'121',name:'S2',castMs:1000,presentationMs:1000,target:{kind:'party',performerId:'actor-2'},animation:'not-connected',gameOutput:false}}}
    ]};
}
test('A-1 技能右移：startMs≥t 右移、其余不动、输入不被修改（纯函数）',()=>{
  const all=[skillTrack()];
  const snap=JSON.stringify(all);
  const r=A.shiftEvents(all,3000,2000);
  assert.equal(r.shifted,1,'只 3000ms 起的事件右移');
  assert.equal(r.tracks[0].events.find(e=>e.id==='e1').startMs,2000);
  assert.equal(r.tracks[0].events.find(e=>e.id==='e2').startMs,5000);
  assert.equal(JSON.stringify(all),snap,'不落库：原数组字节不变');
});
test('A-2 起点恰在 t 的事件右移（边界含端点）',()=>{
  const all=[skillTrack()];
  const r=A.shiftEvents(all,2000,1000);
  assert.equal(r.shifted,2);
  assert.deepEqual(j(r.tracks[0].events.map(e=>e.startMs)),[3000,4000]);
});

// ---------- choreo-edit 插/删预告计数（纯计数不修改） ----------
function clipContent(){
  return {dancers:[{id:1,name:'d1',actionClips:[{id:1,start:4,duration:2},{id:2,start:2,duration:4}],switchClips:[{id:3,start:3,duration:1}],lyricClips:[{id:4,start:5,duration:1}]},
                   {id:2,name:'d2',actionClips:[{id:5,start:6,duration:2}],switchClips:[],lyricClips:[]}],
          globalLyrics:[{id:6,start:4,duration:2}],markers:[{id:'m1',t:3},{id:'m2',t:6}]};
}
test('E-1 insertTimePreview 按类型计数（含恰在 t 的端点）',()=>{
  const c=clipContent(),snap=JSON.stringify(c);
  const n=CE.insertTimePreview(c,4,2);
  assert.deepEqual(j(n),{action:2,switch:0,lyric:1,globalLyric:1,markers:1});
  assert.equal(JSON.stringify(c),snap,'纯计数不修改');
});
test('E-2 deleteTimePreview 与 deleteTime 实际行为对拍',()=>{
  const c=clipContent();
  const n=CE.deleteTimePreview(c,4,6);
  const clone=JSON.parse(JSON.stringify(c));
  const r=CE.deleteTime(clone,4,6);
  assert.equal(n.removed,r.removed,'移除数与 deleteTime 一致');
  assert.deepEqual(j(n),{removed:3,shortened:1,shifted:1,markers:1});
  // removed: action id1 (4–6 恰在窗内)、lyric id4、全局歌词 id6；shortened: action id2 (2–6 终点落窗、截到 2s)；
  // shifted: action id5 (6 起)；markers: m1 (t=3) 在窗前不动、m2 (t=6) 左移＝调整 1 个。
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
