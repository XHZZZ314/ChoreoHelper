// 舞台路径红回归：同一时刻采样、无状态定位、撤销和旧轨道保留；朝向与路点解耦后等时数据仍是合法特例。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js');
const state={dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0}},{id:2,name:'乙'}],contentExtra:{_doc:{extraTracks:[{id:'foreign',type:'cue',events:[{id:'keep',unknown:{x:1}}]}]}}};
const base={x:0,z:0,yawDeg:0};
const nodes={movement:[{time:'2',x:'2',z:'0'},{time:'4',x:'2',z:'2'}],facing:[{time:'2',yaw:'90'},{time:'4',yaw:'180'}]};
const before=JSON.stringify(state);const made=P.edit(state,0,nodes,'test');
assert.equal(JSON.stringify(state),before);P.install(state,made);
assert.deepEqual(P.sample(state,0,1000,base),{x:1,z:0,yawDeg:45,stageMotion:true});
assert.deepEqual(P.sample(state,0,3000,base),{x:2,z:1,yawDeg:135,stageMotion:true});
assert.deepEqual(P.sample(state,0,9000,base),{x:2,z:2,yawDeg:180,stageMotion:true});
assert.deepEqual(P.sample(state,0,0,base),{...base,stageMotion:true});
assert.deepEqual(P.sample(state,1,3000,base),base);
assert.equal(P.sample(state,0,3000,{x:4,z:0,yawDeg:0}).x,2);
assert.equal(P.sample(state,0,1000,{x:4,z:0,yawDeg:0}).x,3);
const saved=P.snapshot(state),oldIds=saved.map(t=>t.events[0].id);
assert.deepEqual(P.edit(state,0,nodes,'other'),made);
assert.deepEqual(P.edit(state,0,{movement:[{time:'3',x:'1',z:'2'}],facing:[{time:'3',yaw:'360'}]},'other').filter(P.owned).map(t=>t.events[0].id),oldIds);
for(const bad of ['','NaN','Infinity','1e309'])assert.throws(()=>P.edit(state,0,{movement:[{...nodes.movement[0],x:bad}],facing:nodes.facing},'bad'));
assert.throws(()=>P.edit(state,0,{movement:[nodes.movement[0],{...nodes.movement[1],time:'2'}],facing:[]},'bad'));
assert.throws(()=>P.edit(state,0,{movement:[{...nodes.movement[0],time:'0'}],facing:[]},'bad'));
assert.throws(()=>P.edit(state,0,nodes.movement,'bad'),/分别提供路径节点与朝向节点/);
const extras=JSON.stringify(P.tracks(state).filter(t=>!P.owned(t)));P.restore(state,[]);assert.equal(P.rows(state).length,0);assert.equal(JSON.stringify(P.tracks(state)),extras);
P.restore(state,saved);assert.deepEqual(P.snapshot(state),saved);
state.dancers[0].mute=true;assert.deepEqual(P.sample(state,0,1000,base),base);state.dancers[0].mute=false;
const duplicated=structuredClone(saved[0]);P.tracks(state).push(duplicated);assert.throws(()=>P.edit(state,0,nodes,'bad'));P.tracks(state).pop();
assert.equal(P.rootTranslation({p:-1,t:[1,2,3]},{tx:10,ty:20,tz:30},true).tx,1);
assert.equal(P.rootTranslation({p:0,t:[1,2,3]},{tx:10,ty:20,tz:30},true).tx,10);
assert.equal(P.rootTranslation({p:-1,t:[1,2,3]},{tx:10,ty:20,tz:30},false).tx,10);
assert.deepEqual(P.metrics(state,0,base),{distanceM:4,movementDurationMs:4000,facingDurationMs:4000,speedSegments:[{distanceM:2,speedMps:1,move:'walk'},{distanceM:2,speedMps:1,move:'walk'}],turnSegments:[{turnDegPerSecond:45},{turnDegPerSecond:45}],exceedsNativeTrial:true});
const broken=structuredClone(state);P.rows(broken)[0].events[0].durationMs=1;assert.throws(()=>P.edit(broken,0,nodes,'bad'));
// TASK-20260919-PATH-LOCOMOTION：移动节点跑步标记——入库仅 'run' 键、走路缺省；旧数据（无 move）解析为走路。
const runNodes={movement:[{time:'2',x:'2',z:'0',move:'run'},{time:'4',x:'2',z:'2',move:'walk'}],facing:[]};
const runMade=P.edit(state,0,runNodes,'run');P.install(state,runMade);
assert.deepEqual(P.nodes(state,0).movement,[{time:'2',x:'2',z:'0',move:'run'},{time:'4',x:'2',z:'2'}]);
assert.deepEqual(P.tracks(state).find(t=>P.owned(t)&&t.type==='movement').events[0].data.stageMotion.points,[{tMs:2000,x:2,z:0,move:'run'},{tMs:4000,x:2,z:2}]);
assert.deepEqual(P.metrics(state,0,base).speedSegments,[{distanceM:2,speedMps:1,move:'run'},{distanceM:2,speedMps:1,move:'walk'}]);
// 旧数据迁移：手工剥掉 move 键后读回=走路，且 nodes 形状与既有三键完全一致。
const legacy=structuredClone(state);legacy.contentExtra._doc.extraTracks.find(t=>P.owned(t)&&t.type==='movement').events[0].data.stageMotion.points.forEach(p=>delete p.move);
assert.deepEqual(P.nodes(legacy,0).movement,[{time:'2',x:'2',z:'0'},{time:'4',x:'2',z:'2'}]);
// 非法模式值：解析层与存储层都明确拒绝，原数据保留。
assert.throws(()=>P.edit(state,0,{movement:[{time:'2',x:'1',z:'0',move:'sprint'}],facing:[]},'bad'),/移动模式仅支持/);
const corrupt=structuredClone(state);corrupt.contentExtra._doc.extraTracks.find(t=>P.owned(t)&&t.type==='movement').events[0].data.stageMotion.points[0].move='auto';
assert.throws(()=>P.nodes(corrupt,0),/移动模式字段损坏/);
// 走路节点重新编辑保存往返不引入 move 键（字节形状稳定）。
P.install(state,P.edit(state,0,{movement:[{time:'2',x:'2',z:'0'},{time:'4',x:'2',z:'2'}],facing:[]},'plain'));
assert.equal(JSON.stringify(P.tracks(state).find(t=>P.owned(t)&&t.type==='movement').events[0].data.stageMotion.points).includes('move'),false);
// 恢复原轨道，后续 docwire/持久化断言继续基于原始 made 数据。
P.install(state,made);assert.deepEqual(P.snapshot(state),saved);
const native={dancers:[{id:1}],contentExtra:{_doc:{extraTracks:[{type:'movement',performerId:'actor-1',events:[{kind:'movement',startMs:1000,durationMs:2000,x1:{version:1,points:[{tMs:0,x:0,z:0},{tMs:2000,x:2,z:2}]}}]}]}}};
assert.deepEqual(P.sample(native,0,2000,base),{x:1,z:1,yawDeg:0,stageMotion:true});
assert.deepEqual(P.sample(native,0,999,base),base);
assert.throws(()=>P.edit(native,0,nodes,'new'),'An existing independent channel must not be silently overlaid');
native.contentExtra._doc.extraTracks[0].enabled=false;assert.deepEqual(P.sample(native,0,2000,base),base);assert.equal(P.blocksGame(native,0),false);
require('./choreo-document.js');require('./choreo-docwire.js');const W=globalThis.ChoreoDocWire;
const projection={dancers:state.dancers,globalLyrics:[],markers:[],dancerCount:2,totalDuration:300,...state.contentExtra};
const doc=W.persistDoc(projection,{id:'test',name:'test'},1),loaded=W.loadProjection(doc);
assert.deepEqual(doc.tracks.filter(P.owned).map(t=>t.events),saved.map(t=>t.events));
assert.ok(JSON.stringify(loaded).includes('stageMotion'));
console.log('PASS stage sampling/editing/history/invalid-input/identity/root separation');
