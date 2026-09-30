// B5 全局插/删时间（TD-06）：真实 app 切片＋引擎/编辑/技能/走位模块与隔离 DOM；浏览器可用性另验。
// 覆盖：插入时间＝片段/全局歌词/标记现行右移（对拍钉住）＋技能 startMs≥t 右移＋每位舞者走位/朝向
// 表 A T4（停留锚点对）；删除时间 [a,b)＝R5-03/04 合成事务（三轨片段＋全局歌词＋标记走真实
// CE.deleteTime、走位 T5、朝向时刻字节不变、技能跨窗整批拒绝点名、候选预检一次提交）；
// 预告对话框按类型预告＋拒绝点名＋一次确认→一次写入＋一次 saveHistory；播放中拒绝。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
// B5_SOURCE 指向保存的旧文件目录时可对拍红测（app/stage-motion/ability-plan/edit 都从那里读）。
const basePatched=base
  .replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B5_SOURCE&&n!=='choreo-workbench.js'?path.join(process.env.B5_SOURCE,n)")
  .replace("const modules=['choreo-edit.js','choreo-stage-motion.js','choreo-stage-motion-ui.js','choreo-workbench.js'];","const modules=['choreo-edit.js','choreo-stage-motion.js','choreo-stage-motion-ui.js'];");
vm.runInContext(basePatched+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const j=v=>JSON.parse(JSON.stringify(v)); // vm realm 数组/对象统一 JSON 化比较
const appSrc=()=>fs.readFileSync(path.join(process.env.B5_SOURCE||__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..setLoopPoint 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读
// （尾标记 setLoopPoint 留在 choreo-app.js，改为切到件尾）；B5_SOURCE 旧目录仍读旧 app.js 两标记切片。
const txSrc=()=>process.env.B5_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
function fixture(n=2){
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  vm.runInContext(fs.readFileSync(path.join(process.env.B5_SOURCE||__dirname,'choreo-ability-plan.js'),'utf8'),f.ctx,{filename:'choreo-ability-plan.js'});
  // 切片：edContent..setLoopPoint（含 B5 插/删时间事务与 insDelTime；工作台选择摘要等仅声明不调用）。
  const tx=txSrc();
  const a=tx.indexOf('function edContent(){'),b=tx.indexOf('function setLoopPoint(');
  assert.ok(a>0,'tx slice start');
  vm.runInContext(tx.slice(a,b>a?b:undefined),f.ctx,{filename:'choreo-app-b5-slice'});
  f.confirms=[];f.confirmResult=true;
  f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
  f.ctx.window.confirm=f.ctx.confirm;
  f.prompts=[];f.promptResult='2';
  f.ctx.prompt=function(msg){f.prompts.push(String(msg));return f.promptResult};
  f.ctx.window.prompt=f.ctx.prompt;
  return f;
}
function addSkill(f,startMs,durMs,id){
  const t={id:'ab-'+id,type:'ability',performerId:'actor-1',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',events:[]};
  t.events.push({id,kind:'ability',enabled:true,locked:false,notes:'',createdWith:'choreo-ability-plan-v1',startMs,durationMs:durMs,sourceRef:{kind:'action',id:'120'},data:{rehearsalAbility:{version:1,actionId:'120',name:'技能 '+id,castMs:1000,presentationMs:durMs-1000,target:{kind:'party',performerId:'actor-2'},animation:'not-connected',gameOutput:false}}});
  f.store.contentExtra._doc.extraTracks.push(t);
}
function setFacing(f,rows,di=0){
  const P=f.M;
  P.install(f.store,P.edit(f.store,di,{movement:P.nodes(f.store,di).movement,facing:rows.map(([t,yaw])=>({time:String(t),yaw:String(yaw)}))},'b5f'+di));
}
const fullBytes=f=>JSON.stringify({d:f.store.dancers,g:f.store.globalLyrics,m:f.store.markers,e:f.store.contentExtra&&f.store.contentExtra._doc&&f.store.contentExtra._doc.extraTracks});

// ---------- 1. 插入时间：全类型右移＋走位/朝向 T4 停留锚点对＋一次历史 ----------
test('INS-1 插 2s：片段/歌词/标记按现行规则右移（对拍）、技能右移、走位/朝向 T4、停留采样',()=>{
  const f=fixture(2);
  f.setPath([[2,2,2],[4,4,4],[6,6,6]]);
  setFacing(f,[[2,20],[6,60]]);
  const c1=f.clip(4,2),c2=f.clip(2,4);c2.data={name:'cross'};
  f.store.dancers[0].switchClips.push({id:31,start:2,duration:4});
  f.store.dancers[0].lyricClips.push({id:41,start:5,duration:1});
  f.store.globalLyrics.push({id:'g1',start:5,duration:1});
  f.store.markers.push({id:'m1',t:4});
  addSkill(f,3000,2000,'e1');addSkill(f,1000,1000,'e2');
  // 对拍基准：同一初始内容跑现行 CE.insertTime
  const parity=JSON.parse(JSON.stringify(f.ctx.ChoreoEdit.pure?{dancers:f.store.dancers,globalLyrics:f.store.globalLyrics,markers:f.store.markers}:{dancers:[],globalLyrics:[],markers:[]}));
  f.ctx.ChoreoEdit.pure.insertTime(parity,3,2);
  const beforeBytes=fullBytes(f);
  f.promptResult='2';
  f.ctx.insDelTime(true);
  assert.equal(f.confirms.length,1,'一次预告确认');
  const prev=f.confirms[0];
  assert.match(prev,/在 3\.0s 插入 2s/);
  assert.match(prev,/动作 1/);assert.match(prev,/切换 0/);assert.match(prev,/台词 1/);
  assert.match(prev,/全局歌词 1/);assert.match(prev,/标记右移 1/);
  assert.match(prev,/技能[^\n]*1/);
  assert.match(prev,/走位[^\n]*右移 2[^\n]*锚点 2/);
  assert.match(prev,/停留/);
  assert.equal(f.history.length,1,'一次写入一次撤销（§7 直接编辑）');
  // 片段/歌词/标记＝现行 insertTime 对拍
  assert.deepEqual(j(f.store.dancers[0].actionClips.map(c=>c.start)),j(parity.dancers[0].actionClips.map(c=>c.start)));
  assert.deepEqual(j(f.store.dancers[0].switchClips.map(c=>c.start)),j(parity.dancers[0].switchClips.map(c=>c.start)));
  assert.deepEqual(j(f.store.globalLyrics.map(g=>g.start)),j(parity.globalLyrics.map(g=>g.start)));
  assert.deepEqual(j(f.store.markers.map(m=>m.t)),j(parity.markers.map(m=>m.t)));
  // 技能：startMs≥3000 右移、其余不动
  const A=f.ctx.ChoreoAbilityPlan;
  const ev=id=>A.rows(f.store).find(r=>r.event.id===id).event;
  assert.equal(ev('e1').startMs,5000);assert.equal(ev('e2').startMs,1000);
  // 走位 T4：2(2),3(3),5(3),6(4),8(6)；[3,5] 停留在 Q(3)=3
  assert.deepEqual(j(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x)])),[[2,2],[3,3],[5,3],[6,4],[8,6]]);
  near(f.sample(4).x,3);
  // 朝向 T4：2(20),3(30),5(30),8(60)
  assert.deepEqual(j(f.M.nodes(f.store,0).facing.map(v=>[Number(v.time),Number(v.yaw)])),[[2,20],[3,30],[5,30],[8,60]]);
  // 舞者 2 无轨道：不回写、不新建轨道
  assert.equal(f.M.rows(f.store).filter(t=>t.performerId==='actor-2').length,0);
  assert.notEqual(fullBytes(f),beforeBytes);
});
test('INS-2 循环区间作废＋toast＋undo 一步恢复（快照含 tracks）',()=>{
  const f=fixture(1);
  f.setPath([[4,4,4]]);
  f.store.loopA=1;f.store.loopB=5;
  f.promptResult='2';f.ctx.insDelTime(true);
  assert.equal(f.store.loopA,null);assert.equal(f.store.loopB,null);
  assert.ok(f.toasts.some(m=>/插入/.test(m)));
  assert.equal(f.history.length,1);
});
test('INS-3 预告分舞者点名；无 t 后对象的舞者如实标不动',()=>{
  const f=fixture(2);
  f.setPath([[4,4,4]],0);f.setPath([[2,2,2]],1);
  f.promptResult='2';f.ctx.insDelTime(true);
  assert.match(f.confirms[0],/Synthetic 1[^\n]*右移 1/);
  assert.match(f.confirms[0],/Synthetic 2[^\n]*不动|Synthetic 2[^\n]*没有/);
});
test('INS-4 取消确认＝整状态字节不变零历史',()=>{
  const f=fixture(1);f.setPath([[4,4,4]]);f.clip(4,2);addSkill(f,4000,1000,'e1');
  const before=fullBytes(f);
  f.promptResult='2';f.confirmResult=false;f.ctx.insDelTime(true);
  assert.equal(fullBytes(f),before,'零写入');
  assert.equal(f.history.length,0);
  assert.ok(f.toasts.some(m=>/取消/.test(m)));
});
test('INS-5 播放中拒绝并提示先暂停（插与删两向）',()=>{
  const f=fixture(1);f.setPath([[4,4,4]]);
  f.store.isPlaying=true;const before=fullBytes(f);
  f.promptResult='9'; // 不应被消费
  f.ctx.insDelTime(true);
  assert.ok(f.toasts.some(m=>/请先暂停/.test(m)),'插入播放中拒绝');
  f.ctx.insDelTime(false);
  assert.ok(f.toasts.slice(-1)[0]&&/请先暂停/.test(f.toasts[f.toasts.length-1]),'删除播放中拒绝');
  assert.equal(f.prompts.length,0,'播放中不弹输入');
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('INS-6 无 t 后对象＝no-op 提示零写入零确认',()=>{
  const f=fixture(1);f.setPath([[2,2,2]]);f.clip(1,1);
  const before=fullBytes(f);
  f.promptResult='2';f.ctx.insDelTime(true);
  assert.ok(f.toasts.some(m=>/没有需要右移|没有需要/.test(m)),f.toasts.join('|'));
  assert.equal(f.confirms.length,0);
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('INS-7 锁定走位轨→整体拒绝点名舞者，零部分成功',()=>{
  const f=fixture(2);f.setPath([[2,2,2],[4,4,4]],0);f.setPath([[5,5,5]],1);f.clip(4,2);
  f.M.tracks(f.store).find(t=>t.type==='movement'&&t.performerId==='actor-1').locked=true;
  const before=fullBytes(f);
  f.promptResult='2';f.ctx.insDelTime(true);
  assert.ok(f.toasts.some(m=>/未插入/.test(m)&&/Synthetic 1/.test(m)),f.toasts.join('|'));
  assert.equal(f.confirms.length,0,'拒绝先于预告框');
  assert.equal(fullBytes(f),before,'片段/技能/他人轨道全部零写入');
  assert.equal(f.history.length,0);
});
for(const finalCount of [500,501]){
  test('INS-8 最终容量 '+finalCount+'（R5-02：合并后 ≤500，501 提交前拒绝）',()=>{
    const f=fixture(1);
    const n=finalCount-1; // t=3 的节点右移后恰与保持锚点同刻同位合并：最终 = 2 保留 + (n−2) 右移 + 2 锚点 − 1 合并 = n+1
    f.setPath(Array.from({length:n},(_,i)=>[i+1,i+1,0]));
    f.promptResult='2';
    f.ctx.insDelTime(true);
    if(finalCount<=500){assert.equal(f.history.length,1);assert.equal(f.M.nodes(f.store,0).movement.length,finalCount)}
    else{assert.equal(f.history.length,0,'零写入');assert.equal(f.M.nodes(f.store,0).movement.length,n,'轨道未变');
      assert.ok(f.toasts.some(m=>/500/.test(m)),f.toasts.join('|'));assert.equal(f.confirms.length,0)}
  });
}

// ---------- 2. 删除时间 [a,b)：R5-03/04 合成事务 ----------
test('DEL-1 删 [4,6)：片段/歌词/标记走真实 CE.deleteTime（对拍）、走位 T5、朝向字节不动、技能不变',()=>{
  const f=fixture(2);
  f.setPath([[2,2,2],[5,5,5],[8,8,8]]);
  setFacing(f,[[2,20],[8,80]]);
  f.clip(4,2); // 4–6 全在窗内→删
  f.store.dancers[0].switchClips.push({id:31,start:2,duration:4}); // 终点落窗→截短
  f.store.dancers[0].lyricClips.push({id:41,start:7,duration:1});  // 窗后→左移
  f.store.globalLyrics.push({id:'g1',start:5,duration:1});
  f.store.markers.push({id:'m1',t:4},{id:'m2',t:7});
  addSkill(f,1000,1000,'e1');addSkill(f,6500,1000,'e2');
  const parity=JSON.parse(JSON.stringify({dancers:f.store.dancers,globalLyrics:f.store.globalLyrics,markers:f.store.markers}));
  f.ctx.ChoreoEdit.pure.deleteTime(parity,4,6);
  f.store.currentTime=4;f.promptResult='2';f.ctx.insDelTime(false);
  assert.equal(f.confirms.length,1);
  assert.match(f.confirms[0],/删除 4\.0~6\.0s/);
  assert.match(f.confirms[0],/移除 2[^\n]*/); // 动作 4–6 与全局歌词 5–6 全在窗内
  assert.match(f.confirms[0],/缩短 1/);assert.match(f.confirms[0],/左移 1/);
  assert.match(f.confirms[0],/重连段 \[2s → 6s\]/);
  assert.match(f.confirms[0],/朝向轨时刻不变|朝向.*不变/);
  assert.equal(f.history.length,1);
  // 片段对拍
  assert.equal(f.store.dancers[0].actionClips.length,0);
  assert.deepEqual(j(f.store.dancers[0].switchClips.map(c=>[c.start,c.duration])),j(parity.dancers[0].switchClips.map(c=>[c.start,c.duration])));
  assert.deepEqual(j(f.store.dancers[0].lyricClips.map(c=>c.start)),j(parity.dancers[0].lyricClips.map(c=>c.start)));
  assert.deepEqual(j(f.store.markers.map(m=>m.t)),j(parity.markers.map(m=>m.t)));
  // 走位 T5：[2(2),6(8)]；重连段采样改变
  assert.deepEqual(j(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x)])),[[2,2],[6,8]]);
  near(f.sample(4).x,5); // 重连段允许改变：4s 处由 4 变 5（预告口径）
  // 朝向轨字节不动（R5-03 独立朝向边界）
  assert.deepEqual(j(f.M.nodes(f.store,0).facing.map(v=>[Number(v.time),Number(v.yaw)])),[[2,20],[8,80]]);
  // 技能不变更
  const A=f.ctx.ChoreoAbilityPlan;
  assert.deepEqual(j(A.rows(f.store).map(r=>[r.event.id,r.event.startMs])),[['e1',1000],['e2',6500]]);
});
test('DEL-2 技能跨窗→整批拒绝点名且全状态字节不变（含其他类型零写入）',()=>{
  const f=fixture(1);
  f.setPath([[2,2,2],[5,5,5],[8,8,8]]);
  f.clip(4,2);addSkill(f,3000,2000,'e1'); // 3–5s 跨窗 [4,6)
  const before=fullBytes(f);
  f.store.currentTime=4;f.promptResult='2';f.ctx.insDelTime(false);
  assert.ok(f.toasts.some(m=>/未删除/.test(m)&&/e1/.test(m)),f.toasts.join('|'));
  assert.equal(f.confirms.length,0,'拒绝先于预告框');
  assert.equal(fullBytes(f),before,'字节级零写入');
  assert.equal(f.history.length,0);
});
test('DEL-3 全清（全部节点落窗内）＝合法清空回起始位＋预告口径',()=>{
  const f=fixture(1);
  f.setPath([[5,5,5],[8,8,8]]);
  f.store.currentTime=1;f.promptResult='9';
  f.ctx.insDelTime(false); // 删 [1,10)
  assert.match(f.confirms[0],/整轨清空|全清/);
  assert.match(f.confirms[0],/\[0[^\n]*END/);
  assert.equal(f.history.length,1);
  assert.equal(f.M.nodes(f.store,0).movement.length,0,'走位轨整体移除');
  near(f.sample(30).x,0);
});
test('DEL-4 kept 空起点段／清尾终态／窗口超末点不动 逐口径预告',()=>{
  // kept 空：单节点 5(5) 删 [0,4) → [1(5)]，起点段 [0,1]
  const f1=fixture(1);f1.setPath([[5,5,5]]);
  f1.store.currentTime=0;f1.promptResult='4';f1.ctx.insDelTime(false);
  assert.match(f1.confirms[0],/起点段|从起点/);
  assert.deepEqual(j(f1.M.nodes(f1.store,0).movement.map(v=>Number(v.time))),[1]);
  // 清尾：[2(2),5(5)] 删 [4,9) → [2(2)]，[2,END] 终态改 2
  const f2=fixture(1);f2.setPath([[2,2,2],[5,5,5]]);
  f2.store.currentTime=4;f2.promptResult='5';f2.ctx.insDelTime(false);
  assert.match(f2.confirms[0],/终态/);
  assert.deepEqual(j(f2.M.nodes(f2.store,0).movement.map(v=>Number(v.time))),[2]);
  near(f2.sample(30).x,2);
  // 窗口超末点：[2,4] 删 [6,8) → 不动（如实预告）
  const f3=fixture(1);f3.setPath([[2,2,2],[4,4,4]]);
  const before=fullBytes(f3);
  f3.store.currentTime=6;f3.promptResult='2';f3.ctx.insDelTime(false);
  assert.ok(f3.toasts.some(m=>/没有需要删除|没有可删/.test(m)),f3.toasts.join('|'));
  assert.equal(fullBytes(f3),before);
});
test('DEL-5 删除后首节点落 0 秒→拒绝点名零写入',()=>{
  const f=fixture(1);
  f.setPath([[2,2,2],[4,4,4]]);
  const before=fullBytes(f);
  f.store.currentTime=0;f.promptResult='2';f.ctx.insDelTime(false); // 删 [0,2)：4(4)→2(2)、2(2) 删，kept 空 moved 2
  assert.ok(f.toasts.some(m=>/0 秒/.test(m)),f.toasts.join('|'));
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);assert.equal(f.confirms.length,0);
});
test('DEL-6 播放头＝删除窗起点，删除后保持原位（现行行为保留）',()=>{
  const f=fixture(1);
  f.setPath([[8,8,8]]);f.clip(8,2);
  f.store.currentTime=8;f.promptResult='2';f.ctx.insDelTime(false); // 删 [8,10)：动作/走位全在窗内删，播放头停在 8
  assert.equal(f.store.currentTime,8);
  const g=fixture(1);g.clip(13,2);
  g.store.currentTime=13;g.promptResult='2';g.ctx.insDelTime(false); // 删 [13,15)：片段全在窗内删
  assert.equal(g.store.currentTime,13);
});
test('DEL-7 取消确认＝整状态字节不变',()=>{
  const f=fixture(1);f.setPath([[2,2,2],[5,5,5]]);f.clip(5,2);
  const before=fullBytes(f);
  f.store.currentTime=4;f.promptResult='2';f.confirmResult=false;f.ctx.insDelTime(false);
  assert.equal(fullBytes(f),before);assert.equal(f.history.length,0);
});
test('DEL-8 独立朝向轨（含嵌套扩展字节）全程不动',()=>{
  const f=fixture(1);
  f.setPath([[2,2,2],[5,5,5]]);
  setFacing(f,[[3,30]]);
  const face=f.M.tracks(f.store).find(t=>t.type==='facing');
  face.events[0].data.stageMotion.points[0].custom={keep:true};
  const faceBytes=JSON.stringify(face);
  f.store.currentTime=4;f.promptResult='2';f.ctx.insDelTime(false); // 删 [4,6)：5(5) 删、2(2) 保留
  assert.equal(JSON.stringify(f.M.tracks(f.store).find(t=>t.type==='facing')),faceBytes,'朝向轨字节级不动');
});

// ---------- 3. 输入校验沿用 ----------
test('V-1 非有限/小于 0.5 的输入拒绝（现行校验保留）',()=>{
  const f=fixture(1);f.setPath([[4,4,4]]);
  for(const bad of ['abc','0.2','-1']){
    f.promptResult=bad;f.ctx.insDelTime(true);
  }
  assert.equal(f.confirms.length,0);assert.equal(f.history.length,0);
  assert.ok(f.toasts.some(m=>/≥0\.5|有限/.test(m)));
});

console.log(JSON.stringify({passed:pass,failed:fail,tier:'mechanism; not browser usability'}));
process.exitCode=fail?1:0;
