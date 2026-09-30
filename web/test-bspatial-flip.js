// B-SPATIAL-2 件②：旧浮窗二维预览 +Z 翻转对齐（属主 2026-09-23「2 按推荐」＝A 案；评估件②§1A）：
// 显示层垂直镜像 sy'=canvas.height−sy、朝向箭头角度 180−yaw（先例 choreo-stage-ui.js stageDomY/stageDomYaw
// :403-404）；CE 纯层与持久化坐标零改动；画布只读（无指针事件，无输入回映射面）。真实产品模块＋内存 DOM；
// BSPATIAL_FLIP_SOURCE 指向保存的 before 目录时可对拍红测（三件模块从那里读）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps,msg)=>{if(typeof eps!=='number'){msg=eps;eps=1e-9}assert.ok(Math.abs(a-b)<=eps,(msg?msg+'：':'')+`${a} != ${b}`)};
const srcDir=n=>path.join(process.env.BSPATIAL_FLIP_SOURCE||__dirname,n);
function fixture(n=1){
  const f=sandbox.makeFixture(n);
  f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
  f.ctx.document.createTextNode=function(t){return {tag:'#text',textContent:String(t),children:[],parentNode:null,remove(){},classList:{add(){},remove(){},toggle(){}}}};
  const origCreate=f.ctx.document.createElement;
  f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
  for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
  if(process.env.BSPATIAL_FLIP_SOURCE){ // 本批两触件按 before 字节重放（IIFE 重挂全局；choreo-edit 是零改动锚点，仍读当前字节）
    for(const n2 of ['choreo-stage-motion.js','choreo-stage-motion-ui.js'])
      vm.runInContext(fs.readFileSync(srcDir(n2),'utf8'),f.ctx,{filename:n2});
  }
  return f;
}
const setFacing=(f,rows,di=0)=>f.M.install(f.store,f.M.edit(f.store,di,{movement:f.M.nodes(f.store,di).movement,facing:rows.map(([t,yaw])=>({time:String(t),yaw:String(yaw)}))},'bspflip'+di));
function openWin(f,di=0){f.calls.length=0;const box=f.ctx.ChoreoStageMotionUI.open(di);assert.ok(box,'浮窗已打开');return box}
const rotates=f=>f.calls.filter(c=>c.op==='rotate').map(c=>c.args[0]);
const textsOf=box=>{const out=[];sandbox.flatten(box).forEach(n2=>{if(typeof n2.textContent==='string'&&n2.textContent)out.push(n2.textContent)});return out};

// ---------- 翻转后方向约定（红基线：before 字节为 +Z 上） ----------
test('FLIP-1 +Z 画在屏幕下方（节点 z=+3 折线 y 大于起点 z=0 的 y）',()=>{
  const f=fixture(1);f.setPath([[2,0,3]]);
  openWin(f);
  const lineTo=f.calls.filter(c=>c.op==='lineTo')[0],moveTo=f.calls.filter(c=>c.op==='moveTo')[0];
  assert.ok(lineTo&&moveTo,'折线已画');
  assert.ok(lineTo.args[1]>moveTo.args[1],`z=+3 应在起点下方：lineTo.y=${lineTo.args[1]} moveTo.y=${moveTo.args[1]}`);
});
test('FLIP-2 朝向箭头角度＝镜像口径（yaw0→π、yaw90→π/2、yaw180→0）',()=>{
  for(const [yaw,want] of [[0,Math.PI],[90,Math.PI/2],[180,0]]){
    const f=fixture(1);f.store.dancers[0].start={x:0,z:0,yawDeg:yaw};
    openWin(f);
    const rs=rotates(f);
    assert.equal(rs.length,1,`无朝向轨时只有当前位三角一次 rotate（实测 ${rs.length}）`);
    near(rs[0],want,`yaw${yaw} 当前位三角角度`);
  }
});
test('FLIP-3 朝向节点小箭头同口径镜像（节点 yaw90 → π/2；播放头 0s 当前位三角 π）',()=>{
  const f=fixture(1);setFacing(f,[[2,90]]);f.store.currentTime=0; // 播放头 0s：当前位采样＝起始 yaw0
  openWin(f);
  const rs=rotates(f);
  assert.equal(rs.length,2,`朝向节点箭头＋当前位三角共两次 rotate（实测 ${rs.length}）`);
  near(rs[0],Math.PI/2,'朝向节点箭头 180−90');
  near(rs[1],Math.PI,'当前位三角（起始 yaw0）');
});
test('FLIP-4 方向标注如实（信息行与画布 aria-label 均为 +Z 向下＝观众席侧）',()=>{
  const f=fixture(1);
  const box=openWin(f);
  const texts=textsOf(box);
  assert.ok(texts.some(t=>t.includes('+Z 向下')&&t.includes('观众席侧')),'信息行应说明 +Z 向下（观众席侧）：'+texts.filter(t=>t.includes('二维预览')).join('｜'));
  const cv=sandbox.flatten(box).find(n2=>n2.tag==='canvas');
  assert.ok(cv,'画布在场');
  assert.ok(String(cv['aria-label']).includes('+Z 向下'),'画布 aria-label：'+cv['aria-label']);
  assert.ok(!texts.some(t=>t.includes('+Z 向上')),'不得残留 +Z 向上');
});
// ---------- 显示层单点镜像：CE 纯层与持久化坐标零改动 ----------
test('FLIP-5 CE 纯层保持 +Z 屏幕上（镜像只在浮窗显示层）＋打开零写入零历史',()=>{
  const f=fixture(2);
  f.store.dancers[1].start={x:3,z:-2,yawDeg:45};
  f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'2',x:'1',z:'3'}],facing:[{time:'4',yaw:'90'}]},'bspflip5'));
  const snap=JSON.stringify({d:f.store.dancers,e:f.store.contentExtra});
  const CE=f.ctx.ChoreoEdit.pure,t=CE.computeStageTransform(560,230,[{x:-4,z:-4},{x:4,z:4}]);
  assert.ok(CE.stageWorldToScreen(0,4,t).sy<CE.stageWorldToScreen(0,-4,t).sy,'CE 纯层 +Z 仍屏幕上方');
  openWin(f,1);
  assert.equal(JSON.stringify({d:f.store.dancers,e:f.store.contentExtra}),snap,'持久化坐标与轨道零改动');
  assert.equal(f.history.length,0,'零历史');
});
test('FLIP-6 浮窗其余语义不动（数值表显示持久化原值；应用/取消按钮在位）',()=>{
  const f=fixture(1);f.setPath([[2,0,3]]);
  const box=openWin(f);
  const all=sandbox.flatten(box);
  const xIn=all.find(n2=>n2['aria-label']==='路径节点1 X'),zIn=all.find(n2=>n2['aria-label']==='路径节点1 Z');
  assert.ok(xIn&&zIn,'数值表输入在位');
  assert.equal(xIn.value,'0');assert.equal(zIn.value,'3','数值表显示持久化原值（不镜像）');
  assert.ok(all.some(n2=>n2.textContent==='应用走位编排'),'应用按钮在位');
  assert.ok(all.some(n2=>n2.textContent==='取消'),'取消按钮在位');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
