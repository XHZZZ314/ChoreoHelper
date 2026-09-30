// 独立朝向红回归：朝向节点与走位路点时刻解耦、纯朝向/纯走位、采样独立与审阅能力声明。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js');
const state={dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0}},{id:2,name:'乙',start:{x:1,z:1,yawDeg:30}}],contentExtra:{}};
const base={x:0,z:0,yawDeg:0};
if(process.argv.includes('--red')){
  // 红基线：解耦数据（朝向时刻不同于路径路点）在旧 1:1 配对校验下无法加载。
  const raw={dancers:state.dancers,contentExtra:{_doc:{extraTracks:[
    {id:'m',type:'movement',createdWith:P.TAG,performerId:'actor-1',enabled:true,locked:false,events:[{id:'me',kind:'movement',enabled:true,locked:false,startMs:0,durationMs:2000,data:{stageMotion:{version:1,fromStart:true,points:[{tMs:2000,x:2,z:0}]}}}]},
    {id:'f',type:'facing',createdWith:P.TAG,performerId:'actor-1',enabled:true,locked:false,events:[{id:'fe',kind:'facing',enabled:true,locked:false,startMs:0,durationMs:4000,data:{stageMotion:{version:1,fromStart:true,points:[{tMs:1000,yawDeg:90},{tMs:4000,yawDeg:180}]}}}]}]}}};
  assert.deepEqual(P.nodes(raw,0),{movement:[{time:'2',x:'2',z:'0'}],facing:[{time:'1',yaw:'90'},{time:'4',yaw:'180'}]},'解耦朝向数据必须可加载');
  const facingOnly={dancers:[{id:1,start:{x:0,z:0,yawDeg:0}}],contentExtra:{_doc:{extraTracks:[raw.contentExtra._doc.extraTracks[1]]}}};
  assert.deepEqual(P.nodes(facingOnly,0),{movement:[],facing:[{time:'1',yaw:'90'},{time:'4',yaw:'180'}]},'纯朝向轨道必须可加载');
  console.error('RED baseline not reached (implementation already accepts decoupled data?)');
  process.exit(1);
}
// 1) 解耦编辑：朝向节点时刻独立于路径路点（1s/4s 转身，路径仅 0→2s）。
const values={movement:[{time:'2',x:'2',z:'0'}],facing:[{time:'1',yaw:'90'},{time:'4',yaw:'180'}]};
const before=JSON.stringify(state);const made=P.edit(state,0,values,'test');
assert.equal(JSON.stringify(state),before);P.install(state,made);
assert.deepEqual(P.nodes(state,0),values);
assert.equal(P.rows(state).length,2);
// 采样独立：位置按路径轨 0→2 秒插值后保持；朝向按朝向轨 0→1→4 秒插值后保持。
assert.deepEqual(P.sample(state,0,500,base),{x:.5,z:0,yawDeg:45,stageMotion:true});
assert.deepEqual(P.sample(state,0,1500,base),{x:1.5,z:0,yawDeg:105,stageMotion:true});
assert.deepEqual(P.sample(state,0,3000,base),{x:2,z:0,yawDeg:150,stageMotion:true});
assert.deepEqual(P.sample(state,0,9000,base),{x:2,z:0,yawDeg:180,stageMotion:true});
// 2) 纯走位（清除朝向轨）：只写一条 movement 轨并删除旧 facing 轨。
P.install(state,P.edit(state,0,{movement:[{time:'3',x:'3',z:'0'}],facing:[]},'m'));
assert.deepEqual(P.nodes(state,0),{movement:[{time:'3',x:'3',z:'0'}],facing:[]});
assert.deepEqual(P.sample(state,0,9000,base),{x:3,z:0,yawDeg:0,stageMotion:true});
// 双空清除本舞者全部走位/朝向轨，再重新编排解耦数据。
P.install(state,P.edit(state,0,{movement:[],facing:[]},'c'));
assert.equal(P.tracks(state).filter(t=>P.owned(t)&&t.performerId===P.pid(state,0)).length,0);
P.install(state,P.edit(state,0,values,'r'));
assert.deepEqual(P.nodes(state,0),values);
// 3) 纯朝向舞者（无走位轨）：原地转身，仍阻断日常游戏播放。
P.install(state,P.edit(state,1,{movement:[],facing:[{time:'2',yaw:'210'}]},'f2'));
assert.deepEqual(P.nodes(state,1),{movement:[],facing:[{time:'2',yaw:'210'}]});
const b2={x:1,z:1,yawDeg:30};
assert.deepEqual(P.sample(state,1,1000,b2),{x:1,z:1,yawDeg:120,stageMotion:true});
assert.deepEqual(P.sample(state,1,0,b2),{...b2,stageMotion:true});
assert.equal(P.blocksGame(state,1),true);
// 4) 旧配对数据（等时特例）仍是合法输入，往返一致。
const paired={movement:[{time:'2',x:'2',z:'0'}],facing:[{time:'2',yaw:'90'}]};
P.install(state,P.edit(state,0,paired,'p'));
assert.deepEqual(P.nodes(state,0),paired);
assert.deepEqual(P.sample(state,0,1000,base),{x:1,z:0,yawDeg:45,stageMotion:true});
// 5) 校验：列表形状、时刻严格递增、数值范围、外来轨防叠加。
assert.throws(()=>P.edit(state,0,paired.movement,'x'),/分别提供路径节点与朝向节点/);
for(const bad of [{movement:[{time:'2',x:'2',z:'0'}],facing:[{time:'2',yaw:'0'},{time:'2',yaw:'90'}]},
  {movement:[{time:'0',x:'2',z:'0'}],facing:[]},
  {movement:[{time:'2',x:'NaN',z:'0'}],facing:[]},
  {movement:[],facing:[{time:'2',yaw:'1e309'}]}])assert.throws(()=>P.edit(state,0,bad,'bad'));
const foreign=structuredClone(state);foreign.contentExtra._doc.extraTracks.push({id:'fx',type:'facing',performerId:P.pid(state,0),events:[{enabled:true}]});
assert.throws(()=>P.edit(foreign,0,paired,'bad'),/其他走位或朝向轨道/);
// 6) 指标：速度段来自路径、转身段来自朝向；纯朝向距离为零。
assert.deepEqual(P.metrics(state,0,base),{distanceM:2,movementDurationMs:2000,facingDurationMs:2000,speedSegments:[{distanceM:2,speedMps:1,move:'walk'}],turnSegments:[{turnDegPerSecond:45}],exceedsNativeTrial:true});
assert.deepEqual(P.metrics(state,1,b2),{distanceM:0,movementDurationMs:0,facingDurationMs:2000,speedSegments:[],turnSegments:[{turnDegPerSecond:90}],exceedsNativeTrial:false});
// 7) 游戏计划审阅：路点朝向按朝向轨采样显示；纯朝向拒绝（无路径）。
require('./choreo-x1-inputs.js');
const G=require('./choreo-stage-game-plan.js');
const s2={projectId:'copy2',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s2,P.edit(s2,0,{movement:[{time:'2',x:'0',z:'0.18'},{time:'4',x:'0',z:'0.18'}],facing:[{time:'3',yaw:'90'}]},'p2'));
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const r=G.review(s2,0,s2.dancers[0].start,actor,0);
assert.deepEqual(r.points.map(p=>p.yawDeg),[0,60,90]);
assert.ok(Math.abs(r.distanceM-.18)<1e-9);
assert.throws(()=>G.review(state,1,b2,actor,0),/没有启用的路径/);
// 8) 整场审阅：朝向逐条给出能力声明式排除；执行包永不包含朝向。
const W=require('./choreo-stage-show.js');
const doc={id:'copy2',name:'独立朝向回归',tracks:P.tracks(s2)};
const review=W.review(doc,r,{actorId:'123',territoryId:816,jobId:21});
const frow=review.rows.find(x=>x.event.kind==='facing');
assert.equal(frow.supported,false);
assert.ok(frow.reason.includes('stageFacingV1')&&frow.reason.includes('网页')&&frow.reason.includes('排除'),frow.reason);
const pkg=W.packageFor(review,{supportedScope:true,pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05});
assert.ok(!pkg.events.some(e=>e.kind==='facing'));
assert.deepEqual(pkg.events.map(e=>e.kind),['movement','movement']);
console.log('PASS independent facing: decoupled authoring, facing-only/movement-only, sampling, metrics, review capability boundary');
