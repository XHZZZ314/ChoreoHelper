// 游戏计划红回归：保留原始节点、身份和朝向声明，禁止把局部试验称为整场执行。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js');
const G=require('./choreo-stage-game-plan.js');
const s={projectId:'copy',dancers:[{id:1,name:'甲',start:{x:2,z:3,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s,P.edit(s,0,{movement:[{time:'3',x:'2',z:'3.36'},{time:'4',x:'2',z:'3.36'}],facing:[{time:'3',yaw:'0'},{time:'4',yaw:'0'}]},'path'));
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const original=JSON.stringify(s),review=G.review(s,0,s.dancers[0].start,actor,0);
assert.equal(JSON.stringify(s),original);
assert.equal(review.points[1].tMs,3000);assert.equal(review.points[2].tMs,4000);
assert.equal(review.points[0].worldX,10);assert.equal(review.points[0].worldZ,20);
assert.ok(Math.abs(review.distanceM-.36)<1e-9);
assert.ok(review.warnings.some(x=>x.includes('朝向')));
assert.throws(()=>G.packageFor(review,{pathOnly:false}),/明确/);
const pkg=G.packageFor(review,{pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05});
require('./choreo-x1-inputs.js');globalThis.ChoreoX1Inputs.validatePackage(pkg.x1,pkg.events);
assert.equal(pkg.events.length,1);assert.equal(pkg.events[0].id,P.rows(s)[0].events[0].id);
assert.equal(pkg.events[0].x1.points[0].x,2);assert.equal(pkg.events[0].x1.points[1].z,3.36);
assert.equal(pkg.x1.bindings[0].stage.originX,8);assert.equal(pkg.x1.bindings[0].stage.originZ,17);
assert.equal(JSON.stringify(s),original);
const rotated=G.review(s,0,s.dancers[0].start,actor,90);
assert.ok(Math.abs(rotated.points[1].worldX-10.36)<1e-9);
for(const bad of [NaN,Infinity])assert.throws(()=>G.review(s,0,s.dancers[0].start,actor,bad));
assert.throws(()=>G.review(s,0,s.dancers[0].start,{...actor,id:'0'},0));
assert.throws(()=>G.packageFor({...review,durationMs:4001},{pathOnly:true}),/4 秒/);
assert.throws(()=>G.packageFor(review,{pathOnly:true,locomotion:'run',arrivalToleranceM:1,maxCorrectionM:.05}),/容差/);
P.tracks(s).push({id:'foreign',type:'movement',performerId:P.pid(s,0),events:[{enabled:true}]});
assert.throws(()=>G.review(s,0,s.dancers[0].start,actor,0),/其他/);
// TASK-20260919-PATH-LOCOMOTION：节点模式驱动打包 locomotion（缺省走）；仅路径范围拒绝混合；速度矛盾逐段提示。
{
  const sr={projectId:'run',dancers:[{id:1,name:'甲',start:{x:2,z:3,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(sr,P.edit(sr,0,{movement:[{time:'3',x:'2',z:'3.36',move:'run'}],facing:[]},'run'));
  const rr=G.review(sr,0,sr.dancers[0].start,actor,0);
  assert.equal(rr.points[1].move,'run');assert.equal(rr.segments[0].move,'run');assert.deepEqual(rr.gaitWarnings,[]);
  const pkgr=G.packageFor(rr,{pathOnly:true,arrivalToleranceM:.12,maxCorrectionM:.05});
  assert.equal(pkgr.events[0].x1.locomotion,'run','打包 locomotion 来自节点模式，无需整场选项');
}
{
  const sm={projectId:'mix',dancers:[{id:1,name:'甲',start:{x:2,z:3,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(sm,P.edit(sm,0,{movement:[{time:'3',x:'2',z:'3.2'},{time:'4',x:'2',z:'3.36',move:'run'}],facing:[]},'mix'));
  const rm=G.review(sm,0,sm.dancers[0].start,actor,0);
  assert.throws(()=>G.packageFor(rm,{pathOnly:true,arrivalToleranceM:.12,maxCorrectionM:.05}),/不能混用/);
}
{
  const sf={projectId:'fast',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(sf,P.edit(sf,0,{movement:[{time:'1',x:'3',z:'0'}],facing:[]},'fast'));
  const rf=G.review(sf,0,sf.dancers[0].start,actor,0);
  assert.equal(rf.segments[0].speedMps,3);
  assert.equal(rf.gaitWarnings.length,1);assert.ok(rf.gaitWarnings[0].includes('3.00')&&rf.gaitWarnings[0].includes('走路'),'走路档超速须逐段点名');
  const sfr={projectId:'fastrun',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(sfr,P.edit(sfr,0,{movement:[{time:'1',x:'3',z:'0',move:'run'}],facing:[]},'fastrun'));
  const rfr=G.review(sfr,0,sfr.dancers[0].start,actor,0);
  assert.deepEqual(rfr.gaitWarnings,[],'跑步 3 米/秒在参考上限内不提示');
}
console.log('PASS stage game review preserves identity/time/data, explicit partial scope, mapping, per-node locomotion and gait warnings');
