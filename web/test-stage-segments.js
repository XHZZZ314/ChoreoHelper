// 长演出切分红回归：任意时长原创路径无损切分为≤4秒/1.5米链式段；整场300秒/128事件上限；原生包形状合法。
'use strict';
const assert=require('node:assert/strict'),P=require('./choreo-stage-motion.js');
require('./choreo-x1-inputs.js');
const G=require('./choreo-stage-game-plan.js'),W=require('./choreo-stage-show.js');
const actor={id:'123',territoryId:816,worldX:10,worldZ:20,rotationRad:0};
const options={supportedScope:true,pathOnly:true,locomotion:'run',arrivalToleranceM:.12,maxCorrectionM:.05};
const context={actorId:'123',territoryId:816,jobId:21};
function build(nodes){
  const s={projectId:'copy',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(s,P.edit(s,0,nodes,'path'));
  const r=G.review(s,0,s.dancers[0].start,actor,0);
  return {s,r,review:W.review({id:'copy',name:'切分回归',tracks:P.tracks(s)},r,context)};
}
function seg(pkg){return pkg.events.filter(e=>e.kind==='movement')}
// 1) 10 秒 3 米直线：按 ceil(10000/4000)=3 与 ceil(3/1.5)=2 取 3 段；段内每跳≤1.5米；段间严格衔接。
{
  const {r,review}=build({movement:[{time:'10',x:'0',z:'3'}],facing:[]});
  assert.equal(review.errors.length,0,review.errors.join(';'));
  const pkg=W.packageFor(review,options),segments=seg(pkg);
  assert.equal(segments.length,3);
  assert.equal(pkg.durationMs,10000);
  assert.equal(segments[0].startMs,0);
  assert.equal(segments[0].id,r.eventId);
  assert.ok(segments.slice(1).every(e=>e.id.startsWith(r.eventId+'-s')));
  for(let i=1;i<segments.length;i++)assert.equal(segments[i-1].startMs+segments[i-1].durationMs,segments[i].startMs);
  assert.equal(segments[2].startMs+segments[2].durationMs,10000);
  segments.forEach(e=>{
    assert.ok(e.durationMs<=4000,e.durationMs);
    const pts=e.x1.points;assert.equal(pts[0].tMs,0);assert.equal(pts[pts.length-1].tMs,e.durationMs);
    let d=0;for(let i=1;i<pts.length;i++)d+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);
    assert.ok(d<=1.5+1e-9,d);
    // 端点保持原创坐标：首段起点=基地，末段终点=(0,3)。
  });
  assert.deepEqual(segments[0].x1.points[0],{tMs:0,x:0,z:0});
  const last=segments[2].x1.points;assert.deepEqual(last[last.length-1],{tMs:segments[2].durationMs,x:0,z:3});
  globalThis.ChoreoX1Inputs.validatePackage(pkg.x1,pkg.events);
  assert.ok(pkg.capabilities.some(c=>c.name==='movement-control'));
}
// 2) 原创多节点 2/4/6 秒：段边界恰为原创节点时刻，不改时序。
{
  const {review}=build({movement:[{time:'2',x:'0',z:'1'},{time:'4',x:'0',z:'2'},{time:'6',x:'0',z:'2'}],facing:[]});
  const segments=seg(W.packageFor(review,options));
  assert.deepEqual(segments.map(e=>e.startMs),[0,2000,4000]);
  assert.deepEqual(segments.map(e=>e.durationMs),[2000,2000,2000]);
  const pts=segments[1].x1.points;assert.deepEqual(pts[0],{tMs:0,x:0,z:1});
}
// 3) 原地保持 10 秒：按 4000ms 上限切 3 段，段内零位移。
{
  const {review}=build({movement:[{time:'10',x:'0',z:'0'}],facing:[]});
  const segments=seg(W.packageFor(review,options));
  assert.equal(segments.length,3);
  segments.forEach(e=>{const p=e.x1.points;assert.equal(p[0].x,p[p.length-1].x);assert.equal(p[0].z,p[p.length-1].z)});
}
// 4) 60 秒 30 米：20 段（距离主导），编译通过。
{
  const {review}=build({movement:[{time:'60',x:'0',z:'30'}],facing:[]});
  assert.equal(review.errors.length,0,review.errors.join(';'));
  const segments=seg(W.packageFor(review,options));
  assert.equal(segments.length,20);assert.equal(segments[19].startMs+segments[19].durationMs,60000);
}
// 5) 超过 300 秒：审阅直接报错，不能裁剪。
{
  const {review}=build({movement:[{time:'301',x:'0',z:'30'}],facing:[]});
  assert.ok(review.errors.some(x=>x.includes('300')),review.errors.join(';'));
  assert.throws(()=>W.packageFor(review,options),/300/);
}
// 6) 切分后事件超 128：审阅报错，不静默丢弃。
{
  const nodes={movement:[],facing:[]};for(let i=1;i<=129;i++)nodes.movement.push({time:(i*0.45).toFixed(2),x:'0',z:(i*0.01).toFixed(2)});
  const {review}=build(nodes);
  assert.ok(review.errors.some(x=>x.includes('128')),review.errors.join(';'));
}
// 7) 非位移事件在长场内按原时刻附加；执行包事件上限与身份唯一。
{
  const s={projectId:'copy',dancers:[{id:1,name:'甲',start:{x:0,z:0,yawDeg:0},clips:[]}],contentExtra:{}};
  P.install(s,P.edit(s,0,{movement:[{time:'10',x:'0',z:'3'}],facing:[]},'path'));
  const r=G.review(s,0,s.dancers[0].start,actor,0);
  const doc={id:'copy',name:'混排',tracks:P.tracks(s).concat([{id:'motions',type:'motion',performerId:'actor-1',events:[{id:'m',kind:'motion',command:'/wave motion',startMs:5000,durationMs:300}]}])};
  const review=W.review(doc,r,context);
  assert.equal(review.errors.length,0,review.errors.join(';'));
  const pkg=W.packageFor(review,options);
  assert.deepEqual(pkg.events.map(e=>e.id),[r.eventId,r.eventId+'-s1',r.eventId+'-s2','m']);
  assert.equal(pkg.events.find(e=>e.id==='m').startMs,5000);
  globalThis.ChoreoX1Inputs.validatePackage(pkg.x1,pkg.events);
}
console.log('PASS long-show segmentation: lossless chains, caps, authored boundaries, 300s/128 limits');
