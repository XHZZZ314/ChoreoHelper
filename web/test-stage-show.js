// 整场红回归：生产形状中的动作、技能和路径不能被仅路径编译静默省略。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js'),G=require('./choreo-stage-game-plan.js');
require('./choreo-x1-inputs.js');
const s={projectId:'copy',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
P.install(s,P.edit(s,0,{movement:[{time:'2',x:'0',z:'0.18'},{time:'4',x:'0',z:'0.18'}],facing:[{time:'2',yaw:'0'},{time:'4',yaw:'0'}]},'path'));
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const r=G.review(s,0,s.dancers[0].start,actor,0),options={pathOnly:true,supportedScope:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05};
const doc={id:'copy',name:'整场回归',tracks:P.tracks(s).concat([{id:'motions',type:'motion',performerId:'actor-1',events:[{id:'m',kind:'motion',command:'/wave motion',startMs:100,durationMs:300}]},{id:'abilities',type:'ability',performerId:'actor-1',events:[{id:'a',kind:'ability',startMs:2500,durationMs:500,sourceRef:{kind:'action',id:'31'},data:{rehearsalAbility:{version:1,actionId:'31',target:{kind:'self'}}}}]}])};
if(process.argv.includes('--red')){const pkg=G.packageFor(r,options);assert.deepEqual(pkg.events.map(e=>e.id),['path-movement-event','path-movement-event-s1','m','a'],'whole-show loses ordinary motion and skill');}
const W=require('./choreo-stage-show.js'),before=JSON.stringify(doc),review=W.review(doc,r,{actorId:'123',territoryId:816,jobId:21});
const pkg=W.packageFor(review,options);assert.deepEqual(pkg.events.map(e=>e.id),['path-movement-event','path-movement-event-s1','m','a']);assert.equal(JSON.stringify(doc),before);
const frow=review.rows.find(x=>x.event.kind==='facing');
assert.equal(frow.supported,false);assert.ok(frow.reason.includes('stageFacingV1')&&frow.reason.includes('网页')&&frow.reason.includes('排除'),frow.reason);
assert.throws(()=>W.packageFor(review,{...options,supportedScope:false}),/明确/);
doc.tracks.at(-1).events[0].durationMs=2000;assert.throws(()=>W.packageFor(W.review(doc,r,review.context),options),/不能裁剪/);
doc.tracks.at(-1).events[0].durationMs=500;doc.tracks.at(-1).events[0].data.rehearsalAbility.target.kind='enemyMarker';assert.throws(()=>W.packageFor(W.review(doc,r,review.context),options),/自身目标/);
doc.tracks.at(-1).events[0].data.rehearsalAbility.target.kind='self';
doc.tracks.at(-2).events[0].playMode='loop';assert.throws(()=>W.packageFor(W.review(doc,r,review.context),options),/单次/);
console.log('PASS whole-show identities, time, explicit exclusions, scope and unchanged project');
