// B-SPATIAL-2 件①纯函数层：mirrorAxis/rotateRight/equidistantStarts（唯一归属 choreo-stage-motion.js）。
// 口径＝B-SPATIAL-1 评估件①§1/§4.1-A/§4.2-A/§4.3-A/§6：方向向量 (sin yaw, cos yaw)、翻 X→朝向 −yaw、
// 翻 Z→朝向 180−yaw（必含朝向）；旋转仅 90° 整数倍（十进制精确）；等距仅起始位＋首尾保持；输出过
// serializeList（三位小数）再进 precheckBoth。数值例双侧＝纯函数输出 vs 真实 M.edit→install 落地再读出。
// BSPATIAL_SOURCE 指向保存的 before 目录时可对拍红测（choreo-stage-motion.js 从那里读）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
// 本批触件 choreo-stage-motion.js 从 BSPATIAL_SOURCE（若设）读；choreo-edit.js 是零改动锚点，恒读当前字节。
const src=n=>path.join(process.env.BSPATIAL_SOURCE||__dirname,n);
const ctx={};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-edit.js'),'utf8'),ctx,{filename:'choreo-edit.js'});
vm.runInContext(fs.readFileSync(src('choreo-stage-motion.js'),'utf8'),ctx,{filename:'choreo-stage-motion.js'});
const CE=ctx.ChoreoEdit.pure,M=ctx.ChoreoStageMotion;
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps,msg)=>{if(typeof eps!=='number'){msg=eps;eps=1e-9}assert.ok(Math.abs(a-b)<=eps,(msg?msg+'：':'')+`${a} != ${b}`)};
const j=v=>JSON.parse(JSON.stringify(v));
function mkState(n=1){return {dancers:Array.from({length:n},(_,i)=>({id:i+1,name:'SP '+(i+1),start:{x:0,z:0,yawDeg:0},actionClips:[],switchClips:[],lyricClips:[]})),globalLyrics:[],markers:[],contentExtra:{_doc:{extraTracks:[]}}};}
const baseOf=(s,di=0)=>CE.placementFor(s.dancers,di)||{x:0,z:0,yawDeg:0};
const N=(t,x,z=0,move)=>({t,x,z,...(move?{move}:{})});
const NF=(t,yaw)=>({t,yaw});
function host(ns,fs2,di=0){
  const s=mkState(di+1);
  const vals={movement:(ns||[]).map(n=>({time:String(n.t),x:String(n.x),z:String(n.z),...(n.move?{move:n.move}:{})})),
    facing:(fs2||[]).map(n=>({time:String(n.t),yaw:String(n.yaw)}))};
  if((ns&&ns.length)||(fs2&&fs2.length))M.install(s,M.edit(s,di,vals,'sphost'));
  return s;
}
const valsOf=(s,kind,di=0)=>kind==='movement'?M.nodes(s,di).movement:M.nodes(s,di).facing;
// 双侧“后”侧：纯函数输出安装成真实产品轨后再读出/采样。
function installVals(out,kind){
  const s=mkState();
  if(out.values.length)M.install(s,M.edit(s,0,kind==='facing'?{movement:[],facing:out.values}:{movement:out.values,facing:[]},'spres'));
  return s;
}
const px=(s,t)=>M.sample(s,0,t*1000,baseOf(s)).x;
const pyaw=(s,t)=>M.sample(s,0,t*1000,baseOf(s)).yawDeg;

// ---------- 镜像（按被翻转坐标命名；必含朝向） ----------
test('MP-1 翻 X（枢轴原点）：(1,2)→(−1,2)、yaw90→−90（movement＋facing 双侧）',()=>{
  const s=host([N(2,1,2)],[NF(2,90)]);
  const gm=M.mirrorAxis(valsOf(s,'movement'),'x',0,s,0,'movement');
  assert.ok(!gm.refuse,JSON.stringify(gm));
  assert.deepEqual(j(gm.values),[{time:'2',x:'-1',z:'2'}]);
  const am=installVals(gm,'movement');
  assert.deepEqual(j(valsOf(am,'movement')),[{time:'2',x:'-1',z:'2'}]);
  near(px(am,2),-1,'落地后采样');
  const gf=M.mirrorAxis(valsOf(s,'facing'),'x',0,s,0,'facing');
  assert.ok(!gf.refuse,JSON.stringify(gf));
  assert.deepEqual(j(gf.values),[{time:'2',yaw:'-90'}]);
  const af=installVals(gf,'facing');
  assert.deepEqual(j(valsOf(af,'facing')),[{time:'2',yaw:'-90'}]);
  near(pyaw(af,2),-90,'落地后朝向采样');
});
test('MP-2 翻 Z（枢轴原点）：(1,2)→(1,−2)、yaw0→180（必含朝向）',()=>{
  const s=host([N(2,1,2)],[NF(2,0)]);
  const gm=M.mirrorAxis(valsOf(s,'movement'),'z',0,s,0,'movement');
  assert.deepEqual(j(gm.values),[{time:'2',x:'1',z:'-2'}]);
  const am=installVals(gm,'movement');
  assert.deepEqual(j(valsOf(am,'movement')),[{time:'2',x:'1',z:'-2'}]);
  const gf=M.mirrorAxis(valsOf(s,'facing'),'z',0,s,0,'facing');
  assert.deepEqual(j(gf.values),[{time:'2',yaw:'180'}]);
  const af=installVals(gf,'facing');
  near(pyaw(af,2),180,'落地后朝向采样');
});
test('MP-2b 翻 Z 枢轴非零（pivot z=5）：(1,2)→(1,8)、yaw45→135',()=>{
  const s=host([N(2,1,2)],[NF(2,45)]);
  const gm=M.mirrorAxis(valsOf(s,'movement'),'z',5,s,0,'movement');
  assert.deepEqual(j(gm.values),[{time:'2',x:'1',z:'8'}]);
  const gf=M.mirrorAxis(valsOf(s,'facing'),'z',5,s,0,'facing');
  assert.deepEqual(j(gf.values),[{time:'2',yaw:'135'}]);
});
// ---------- 旋转（仅 90° 整数倍；位置随朝向同转；十进制精确） ----------
test('MP-3 旋转 90 绕原点：(0,1)→(1,0)、yaw0→90（双侧）',()=>{
  const s=host([N(2,0,1)],[NF(2,0)]);
  const gm=M.rotateRight(valsOf(s,'movement'),90,{x:0,z:0},s,0,'movement');
  assert.ok(!gm.refuse,JSON.stringify(gm));
  assert.deepEqual(j(gm.values),[{time:'2',x:'1',z:'0'}]);
  const am=installVals(gm,'movement');
  assert.deepEqual(j(valsOf(am,'movement')),[{time:'2',x:'1',z:'0'}]);
  const gf=M.rotateRight(valsOf(s,'facing'),90,{x:0,z:0},s,0,'facing');
  assert.deepEqual(j(gf.values),[{time:'2',yaw:'90'}]);
  const af=installVals(gf,'facing');
  near(pyaw(af,2),90);
});
test('MP-4 旋转 180/270 三位小数十进制精确＋枢轴偏移',()=>{
  const s=host([N(2,0.001,0.002)]);
  const g180=M.rotateRight(valsOf(s,'movement'),180,{x:0,z:0},s,0,'movement');
  assert.deepEqual(j(g180.values),[{time:'2',x:'-0.001',z:'-0.002'}]);
  const g270=M.rotateRight(valsOf(s,'movement'),270,{x:0,z:0},s,0,'movement');
  assert.deepEqual(j(g270.values),[{time:'2',x:'-0.002',z:'0.001'}]);
});
test('MP-4b 旋转 90 枢轴 (1,2) 于 (0.001,0.002)：得 (−0.998, 2.999)',()=>{
  const s=host([N(2,0.001,0.002)]);
  const g=M.rotateRight(valsOf(s,'movement'),90,{x:1,z:2},s,0,'movement');
  assert.deepEqual(j(g.values),[{time:'2',x:'-0.998',z:'2.999'}]);
  const a=installVals(g,'movement');
  assert.deepEqual(j(valsOf(a,'movement')),[{time:'2',x:'-0.998',z:'2.999'}]);
});
test('MP-5 yaw 不包络归一（450 仍 450）：翻 X→−450、翻 Z→−270、旋转 90→540',()=>{
  const s=host(null,[NF(2,450)]);
  assert.deepEqual(j(M.mirrorAxis(valsOf(s,'facing'),'x',0,s,0,'facing').values),[{time:'2',yaw:'-450'}]);
  assert.deepEqual(j(M.mirrorAxis(valsOf(s,'facing'),'z',0,s,0,'facing').values),[{time:'2',yaw:'-270'}]);
  assert.deepEqual(j(M.rotateRight(valsOf(s,'facing'),90,{x:0,z:0},s,0,'facing').values),[{time:'2',yaw:'540'}]);
});
test('MP-6 run 标记保留（镜像/旋转都不丢步态）',()=>{
  const s=host([N(2,1,2,'run'),N(4,2,0)]);
  assert.deepEqual(j(M.mirrorAxis(valsOf(s,'movement'),'x',0,s,0,'movement').values),[ {time:'2',x:'-1',z:'2',move:'run'},{time:'4',x:'-2',z:'0'}]);
  const a=installVals(M.mirrorAxis(valsOf(s,'movement'),'x',0,s,0,'movement'),'movement');
  assert.equal(M.metrics(a,0,baseOf(a)).speedSegments[0].move,'run');
  assert.deepEqual(j(M.rotateRight(valsOf(s,'movement'),180,{x:0,z:0},s,0,'movement').values),[ {time:'2',x:'-1',z:'-2',move:'run'},{time:'4',x:'-2',z:'0'}]);
});
test('MP-7 空列表＝如实零改动（changed:false、values:[]、不建轨）',()=>{
  const s=mkState();
  const g=M.mirrorAxis([],'x',0,s,0,'movement');
  assert.equal(g.changed,false);assert.deepEqual(j(g.values),[]);
  const r=M.rotateRight([],90,{x:0,z:0},s,0,'facing');
  assert.equal(r.changed,false);assert.deepEqual(j(r.values),[]);
  assert.equal(M.tracks(s).length,0,'不因空列表建轨');
});
test('MP-8 非法参数明确拒绝（轴/角度/枢轴）',()=>{
  const s=host([N(2,1,2)]);
  assert.throws(()=>M.mirrorAxis(valsOf(s,'movement'),'y',0,s,0,'movement'),/镜像轴/);
  assert.throws(()=>M.rotateRight(valsOf(s,'movement'),45,{x:0,z:0},s,0,'movement'),/90\/180\/270/);
  assert.throws(()=>M.rotateRight(valsOf(s,'movement'),90,{x:NaN,z:0},s,0,'movement'),/枢轴/);
});
test('MP-9 未知扩展字段丢弃边界＝t 系同一已登记边界（nodes() API；登记不修）',()=>{
  const s=host([N(2,1,2)]);
  s.contentExtra._doc.extraTracks[0].events[0].data.stageMotion.points[0].custom={keep:1};
  const g=M.mirrorAxis(valsOf(s,'movement'),'x',0,s,0,'movement');
  M.install(s,M.edit(s,0,{movement:g.values,facing:[]},'mp9'));
  assert.equal(s.contentExtra._doc.extraTracks[0].events[0].data.stageMotion.points[0].custom,undefined,'与 t 系/粘贴同一已登记边界');
  assert.deepEqual(j(valsOf(s,'movement')),[{time:'2',x:'-1',z:'2'}]);
});
test('MP-10 预检拒绝面（锁定/停用/外来轨）＝原状态克隆拒绝、原轨零改动',()=>{
  for(const kind of ['locked','disabled','foreign']){
    const s=host([N(2,1,2)]);
    const t=M.tracks(s)[0],before=JSON.stringify(M.tracks(s));
    if(kind==='locked')t.locked=true; // 快照在改写前取：拒绝后原轨（含本次注入标记）零改动
    else if(kind==='disabled')t.enabled=false;
    else M.tracks(s).push({id:'foreign',type:'movement',performerId:'actor-1',events:[{enabled:true}]});
    const g=M.mirrorAxis(valsOf(s,'movement'),'x',0,s,0,'movement');
    assert.ok(g.refuse,kind+' 应拒绝');
    assert.match(g.refuse,/锁定|停用|其他走位/);
    const ev=x=>JSON.stringify(x.filter(y=>y.id===t.id).map(y=>y.events));
    assert.equal(ev(M.tracks(s)),ev(JSON.parse(before)),'原轨事件零改动（预检在克隆上）');
  }
});
// ---------- 起始位等距（仅起始位、沿轴、首尾保持、<3 人 no-op） ----------
test('MP-11 等距 3 人 X=[0,1,3]→[0,1.5,3]（首尾保持、Z 与 yaw 不动、moved 仅中间人）',()=>{
  const g=M.equidistantStarts([{x:0,z:0,yawDeg:0},{x:1,z:2,yawDeg:30},{x:3,z:-1,yawDeg:90}],'x');
  assert.equal(g.changed,true);assert.equal(g.count,3);
  assert.deepEqual(j(g.kept),[0,2]);assert.deepEqual(j(g.moved),[1]);
  assert.deepEqual(j(g.starts),[{x:0,z:0,yawDeg:0},{x:1.5,z:2,yawDeg:30},{x:3,z:-1,yawDeg:90}]);
  assert.equal(g.from,0);assert.equal(g.to,3);assert.equal(g.step,1.5);
});
test('MP-11b 等距沿 Z：首尾 Z 保持、X 与 yaw 不动',()=>{
  const g=M.equidistantStarts([{x:1,z:0,yawDeg:10},{x:2,z:1,yawDeg:20},{x:3,z:3,yawDeg:30}],'z');
  assert.deepEqual(j(g.starts),[{x:1,z:0,yawDeg:10},{x:2,z:1.5,yawDeg:20},{x:3,z:3,yawDeg:30}]);
});
test('MP-12 等距 <3 人＝如实 no-op（starts:null、changed:false）',()=>{
  for(const n of [0,1,2]){
    const list=Array.from({length:n},(_,i)=>({x:i,z:0,yawDeg:0}));
    const g=M.equidistantStarts(list,'x');
    assert.equal(g.changed,false,'n='+n);assert.equal(g.starts,null,'n='+n);assert.equal(g.count,n);
  }
});
test('MP-12b 等距 tie（同轴值跨度 0）：中间人取首值；非法项不入序且保持原值',()=>{
  const g=M.equidistantStarts([{x:2,z:0,yawDeg:0},{x:2,z:1,yawDeg:0},{x:2,z:2,yawDeg:0}],'x');
  assert.deepEqual(j(g.starts.map(s=>s.x)),[2,2,2]);
  assert.equal(g.step,0);
  const h=M.equidistantStarts([{x:0,z:0,yawDeg:0},null,{x:2,z:0,yawDeg:0},{x:4,z:0,yawDeg:0}],'x');
  assert.equal(h.count,3);assert.deepEqual(j(h.moved),[2]);assert.equal(h.starts[1],null,'非法项保持 null（调用方不动）');
  assert.equal(h.starts[2].x,2,'中间人取首尾中点');
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
