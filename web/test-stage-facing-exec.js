// 独立朝向执行接线回归：插件宣告 stageFacingV1 时整场审阅按原时刻编译尾部不重叠朝向，
// 与路径段重叠的朝向逐条排除（四键先转向再走）；未宣告能力时保持现状排除文案。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js');
require('./choreo-x1-inputs.js');
const G=require('./choreo-stage-game-plan.js'),W=require('./choreo-stage-show.js');
// 场景：路径 0→2 秒走 0.18 米，2→4 秒原地保持；朝向节点 3 秒/5 秒/6 秒。
// 朝向段 (0→3)、(3→5) 与路径段重叠须逐条排除；(5→6) 在路径外按原时刻编译为 transition。
const s2={projectId:'copy-fe',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s2,P.edit(s2,0,{movement:[{time:'2',x:'0',z:'0.18'},{time:'4',x:'0',z:'0.18'}],facing:[{time:'3',yaw:'90'},{time:'5',yaw:'150'},{time:'6',yaw:'180'}]},'fe'));
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const plan=G.review(s2,0,s2.dancers[0].start,actor,0);
const doc={id:'copy-fe',name:'朝向执行回归',tracks:P.tracks(s2)};
function rows(review){return review.rows.filter(x=>x.event.kind==='facing')}
if(process.argv.includes('--red')){
  // 红基线：能力已宣告时旧审阅仍整体排除朝向（未接入 stageFacingV1），不存在受支持朝向行。
  const review=W.review(doc,plan,{actorId:'123',territoryId:816,jobId:21},{stageFacingV1:true});
  assert.ok(rows(review).some(x=>x.supported),'能力已宣告时尾部不重叠朝向段应转为受支持');
  console.error('RED baseline not reached (implementation already compiles facing?)');
  process.exit(1);
}
// 1) 能力已宣告：重叠朝向逐条排除并给出四键原因；路径外朝向按原时刻受支持。
const review=W.review(doc,plan,{actorId:'123',territoryId:816,jobId:21},{stageFacingV1:true});
const facing=rows(review);
assert.equal(facing.length,3,'朝向节点逐段成行（3 秒/5 秒/6 秒三段）');
assert.deepEqual(facing.map(x=>x.event.id),['fe-facing-event-f1','fe-facing-event-f2','fe-facing-event-f3'],'逐段身份源自原创朝向事件');
assert.equal(facing[0].supported,false,'(0→3) 与路径段重叠必须排除');
assert.ok(facing[0].reason.includes('四键')&&facing[0].reason.includes('先转向再走')&&facing[0].reason.includes('重叠'),facing[0].reason);
assert.equal(facing[1].supported,false,'(3→5) 与保持段重叠必须排除');
const ok3=facing[2];
assert.equal(ok3.supported,true,'(5→6) 在路径外按原时刻受支持');
assert.equal(ok3.event.startMs,5000);assert.equal(ok3.event.durationMs,1000);
assert.deepEqual(ok3.event.x1,{version:1,failurePolicy:'stopShow',mode:'transition',transitionFromDeg:150,transitionToDeg:180});
assert.equal(review.errors.length,0,review.errors.join('\n'));
assert.equal(review.showMs,6000,'整场时长由末条受支持朝向覆盖');
assert.equal(review.segmentCount,2,'路径仍无损切分为两段');
// 2) 编译包含 x1 朝向事件且身份/时刻原样；整场时长覆盖朝向尾部。
const pkg=W.packageFor(review,{supportedScope:true,pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05});
const fe=pkg.events.filter(e=>e.kind==='facing');
assert.equal(fe.length,1);assert.equal(fe[0].id,'fe-facing-event-f3');assert.equal(fe[0].startMs,5000);assert.equal(fe[0].durationMs,1000);
assert.equal(pkg.durationMs,6000);
assert.deepEqual(pkg.events.map(e=>e.kind),['movement','movement','facing']);
// 3) 能力未宣告：保持现状单行整体排除文案，执行包不含朝向。
const legacy=W.review(doc,plan,{actorId:'123',territoryId:816,jobId:21});
const lrow=rows(legacy);
assert.equal(lrow.length,1,'未宣告能力时仍按原始事件单行审阅');
assert.equal(lrow[0].supported,false);
assert.ok(lrow[0].reason.includes('stageFacingV1')&&lrow[0].reason.includes('网页')&&lrow[0].reason.includes('排除'),lrow[0].reason);
const pkg2=W.packageFor(legacy,{supportedScope:true,pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05});
assert.ok(!pkg2.events.some(e=>e.kind==='facing'));
assert.equal(pkg2.durationMs,4000,'未宣告能力时整场时长仍由路径覆盖');
// 4) 朝向把整场拉超过 5 分钟上限时诚实报错，不裁剪。
const s3={projectId:'copy-fe2',dancers:[{id:1,name:'乙',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s3,P.edit(s3,0,{movement:[{time:'2',x:'0',z:'0.18'}],facing:[{time:'290',yaw:'90'},{time:'301',yaw:'180'}]},'fe2'));
const plan3=G.review(s3,0,s3.dancers[0].start,actor,0);
const over=W.review({id:'copy-fe2',name:'上限',tracks:P.tracks(s3)},plan3,{actorId:'123',territoryId:816,jobId:21},{stageFacingV1:true});
assert.ok(over.errors.some(e=>e.includes('整场最长')),over.errors.join('\n'));
console.log('PASS stage facing exec: capability-declared compile, per-item four-key exclusion, legacy text, 5min cap');
