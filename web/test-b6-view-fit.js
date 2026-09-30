// B6 视图约定与拟合（HF-09/HF-10）：拟合集合（R2 §七＋R4 §七真实口径）、三视图态、方向常驻标注。
// 真实产品模块与采样（M.sample / placementFor / extentPoints），内存 DOM/画布依赖；浏览器可用性另验。
// B6_SOURCE 指向保存的旧文件目录时可对拍红测（workbench 从那里读）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base.replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B6_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B6_SOURCE,n)")+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();console.log('PASS '+n);pass++}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-6,msg)=>assert.ok(Math.abs(a-b)<=eps,(msg?msg+': ':'')+`${a} != ${b}`);

// 注入时间轴滚动容器（B6 可见时间窗来源）。口径与 ChoreoRenderPerf.visibleRange 一致：
// 可见窗＝[(scrollLeft-labelW)/pps,(scrollLeft+viewport-labelW)/pps]，labelW 与产品 LABEL_W（112/窄 64）同值。
function tl(f,a,b,pps=60,labelW=112){
  f.store.pps=pps;
  let w=f.ctx.document.getElementById('timelineWrap');
  if(!w){w=f.ctx.document.createElement('div');w.id='timelineWrap';f.ctx.document.body.appendChild(w);}
  w.clientWidth=(b-a)*pps;w.scrollLeft=labelW+a*pps;   // 可见时长＝clientWidth/pps（labelW 在 scrollLeft 侧扣除）
  return w;
}
function load(f){
  vm.runInContext(fs.readFileSync(path.join(process.env.B6_SOURCE||__dirname,'choreo-workbench.js'),'utf8')
    .replace('var api = {','globalThis.__topClick=topClick;globalThis.__topMouseDown=topMouseDown; var api = {'),f.ctx,{filename:'choreo-workbench.js'});
  return f.ctx.ChoreoWorkbench;
}
const bases=f=>f.store.dancers.map((_,i)=>f.ctx.ChoreoEdit.pure.placementFor(f.store.dancers,i));
// 期望比例按产品公式 min(w,h)/(2*(maxAbs+1.5)) 独立推导（夹具画布 400×400）
const expectedScale=(pts,w=400)=>{let m=1;pts.forEach(p=>{m=Math.max(m,Math.abs(p.x),Math.abs(p.z))});return w/(2*(m+1.5))};
const worldX=(tr,x)=>tr.w/2+(tr.panX||0)+x*tr.sc;   // 与产品绘制同映射（含平移）

// ---------- 1. 拟合集合（HF-10 / C-08 / N21/N22 / 空路径 / 末点后 / 已选对象） ----------
test('HF-10 far node outside window no longer shrinks current-window fit',()=>{
  const f=sandbox.makeFixture(3);tl(f,0,6);                       // 可见窗 [0,6]s，仍在 3s 附近编辑
  f.setPath([[3,1,0],[90,100,0]],0);                              // 当前舞者：3s 节点＋90s X=100 远节点
  f.store.selectedDancer=0;
  const w=load(f);w.drawTop();const tr=w.topViewTransform();
  const pts=[...bases(f),{x:1,z:0},f.sample(0),f.sample(6)];      // 全员真实起始位＋窗内节点＋两端必采样（真实产品采样）
  near(tr.sc,expectedScale(pts));
  assert.ok(tr.sc>20,`当前窗内编辑比例不再被远节点缩小（旧值≈1.97，实测 ${tr.sc}）`);
});
test('C-08 cross-window segment endpoints stay visible via mandatory boundary samples',()=>{
  const f=sandbox.makeFixture(1);tl(f,40,50);                     // 窗 [40,50]：窗内无节点（0→100s 直线）
  f.setPath([[100,100,0]],0);
  const w=load(f);w.drawTop();const tr=w.topViewTransform();
  near(tr.sc,expectedScale([...bases(f),f.sample(40),f.sample(50)]));   // 窗外节点不参与（maxAbs=50 而非 100）
  for(const t of [40,50]){const sx=worldX(tr,f.sample(t).x);assert.ok(sx>=0&&sx<=tr.w,`t=${t} 端点可见 sx=${sx}`);}
});
test('N21/N22 fit samples bind each dancer own di and start (non-zero index, explicit (5,7))',()=>{
  const f=sandbox.makeFixture(3);tl(f,4,6);
  f.store.dancers[1].start={x:5,z:7,yawDeg:0};
  f.setPath([[10,20,7]],1);                                        // 舞者1：10s 到 (20,7)；窗内无节点
  f.store.selectedDancer=1;
  const w=load(f);w.drawTop();const tr=w.topViewTransform();
  near(tr.sc,expectedScale([...bases(f),f.sample(4,1),f.sample(6,1)]));  // 两端采样绑定舞者1自身 di 与起点（错采 0 号即不平）
});
test('empty path fits to start position; after-end holds last value',()=>{
  const f=sandbox.makeFixture(2);tl(f,10,20);
  f.store.dancers[1].start={x:5,z:7,yawDeg:0};f.store.selectedDancer=1;   // 空路径：P(wA)=P(wB)=起始位
  const w=load(f);w.drawTop();
  near(w.topViewTransform().sc,expectedScale(bases(f)));
  const g=sandbox.makeFixture(1);tl(g,50,60);g.setPath([[2,3,0]],0);      // 末点后＝保持值 (3,0)（窗外节点也不外扩）
  const wg=load(g);wg.drawTop();
  near(wg.topViewTransform().sc,expectedScale([...bases(g),g.sample(50)]));
});
test('selected clip dancer sampled at playhead joins the fit set (own di/start)',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,10);
  f.setPath([[10,15,0]],1);                                        // 舞者1：10s 到 (15,0)
  const c={id:31,start:1,duration:2,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);f.store.selectedClip=c;
  f.store.currentTime=8;                                           // 已选对象舞者1 在播放头 x=12（非全时段 15）
  const w=load(f);w.drawTop();
  near(w.topViewTransform().sc,expectedScale([...bases(f),f.sample(0),f.sample(10),f.sample(8,1)]));
});
test('refit on window scroll and object switch',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,6);
  f.setPath([[3,1,0],[40,30,0]],0);f.setPath([[3,2,0]],1);
  const w=load(f);f.store.selectedDancer=0;w.drawTop();
  const sc0=w.topViewTransform().sc;
  tl(f,36,42);w.drawTop();                                          // 滚窗：舞者0 窗内含 (30,0)
  assert.notEqual(w.topViewTransform().sc,sc0,'滚窗重算');
  near(w.topViewTransform().sc,expectedScale([...bases(f),{x:30,z:0},f.sample(36),f.sample(42)]));
  f.store.selectedDancer=1;w.drawTop();                             // 切换对象：按舞者1 窗内轨迹重算
  near(w.topViewTransform().sc,expectedScale([...bases(f),{x:2,z:0},f.sample(36,1),f.sample(42,1)]));
});
test('no refit inside sessions (scroll/switch/viewport resize keep the transform)',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,6);
  f.setPath([[3,1,0],[40,30,0]],0);
  const w=load(f);f.store.selectedDancer=0;w.drawTop();
  const scS=w.topViewTransform().sc;
  f.UI.openSamePlace(0,f.clip());
  w.drawTop();                                                       // 开窗沿：按开会话时的窗口/对象重算一次（输入未变→sc 不变）
  near(w.topViewTransform().sc,scS,1e-6,'开窗沿重算＝按开会话时的窗口/对象');
  tl(f,36,42);f.store.selectedDancer=1;w.drawTop();                 // 会话稳态：滚窗＋切换对象不重拟合
  near(w.topViewTransform().sc,scS,1e-6,'会话内滚窗/切人不重拟合');
  f.top.clientWidth=800;f.top.clientHeight=800;w.drawTop();         // 会话内视口变化：比例保持（防跳动）
  assert.equal(w.topViewTransform().sc,scS,'会话内视口变化不重拟合');
  f.find('wbMoveCancel').onclick();                                 // 取消会话→闭沿重算恢复正常触发
  w.drawTop();
  near(w.topViewTransform().sc,expectedScale([...bases(f),f.sample(36,1),f.sample(42,1)],800),1e-6,'会话结束按当前对象/窗口重算');
});

// ---------- 2. 三视图态 ----------
test('three view states: window default, fit-all button, manual zoom/pan with explicit exit',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,6);
  f.setPath([[90,100,0]],0);
  const w=load(f);w.drawTop();
  assert.equal(w.topViewMode(),'window','默认跟随窗口');
  assert.match(f.find('wbTopViewState').textContent,/跟随窗口/,'当前态可见');
  const winSc=w.topViewTransform().sc;
  f.find('wbTopFitAll').onclick();                                  // 「适应全部」按钮（真实 DOM 入口）
  assert.equal(w.topViewMode(),'all');assert.match(f.find('wbTopViewState').textContent,/适应全部/);
  let m=1;bases(f).forEach(p=>m=Math.max(m,Math.abs(p.x),Math.abs(p.z)));
  near(w.topViewTransform().sc,expectedScale([...bases(f),{x:100,z:0},...bases(f)],400),1e-6,'适应全部=全员全时段（含 90s 远节点）');
  // 手动态：滚轮缩放（光标下世界点不动）
  const tr0=w.topViewTransform();
  const anchorX=(100-tr0.w/2-(tr0.panX||0))/tr0.sc;                 // clientX=100（画布内容盒 0..400）下的世界 x
  w.topWheel({deltaY:-100,clientX:100,clientY:100,preventDefault(){}});
  assert.equal(w.topViewMode(),'manual');assert.match(f.find('wbTopViewState').textContent,/手动/);
  const tr1=w.topViewTransform();
  assert.ok(tr1.sc>tr0.sc,'放大');
  near((100-tr1.w/2-(tr1.panX||0))/tr1.sc,anchorX,1e-9,'缩放锚点：光标下世界点不动');
  const panBefore=w.topViewTransform().panX;
  w.topPanBy(40,0);                                                 // 平移（进入/保持手动态）
  assert.equal(w.topViewMode(),'manual');assert.equal(w.topViewTransform().panX-panBefore,40);
  tl(f,50,60);w.drawTop();                                          // 手动态：滚窗不重拟合
  assert.equal(w.topViewTransform().panX,panBefore+40);assert.equal(w.topViewTransform().sc,tr1.sc);
  f.find('wbTopRefit').onclick();                                   // 「重新拟合」按钮退出手动→回跟随窗口
  assert.equal(w.topViewMode(),'window');assert.equal(w.topViewTransform().panX,0);
  near(w.topViewTransform().sc,expectedScale([...bases(f),f.sample(50),f.sample(60)]),1e-6,'退出后按窗口重算');
  assert.ok(winSc>0);
});
test('empty-canvas drag pans into manual and swallows the following click; sub-threshold drag does not',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,6);
  f.store.dancers[1].start={x:5,z:7,yawDeg:0};
  const w=load(f);w.drawTop();
  const L={};f.ctx.document.addEventListener=(t,fn)=>{(L[t]=L[t]||[]).push(fn)};f.ctx.document.removeEventListener=(t,fn)=>{(L[t]=(L[t]||[]).filter(x=>x!==fn))};
  f.ctx.__topMouseDown({button:0,clientX:200,clientY:200,preventDefault(){}});
  assert.ok(L.mousemove&&L.mousemove.length===1&&L.mouseup.length===1,'平移监听接线');
  L.mousemove[0]({clientX:210,clientY:205});                        // ≥4px：进入平移
  assert.equal(w.topViewMode(),'manual');
  assert.equal(w.topViewTransform().panX,10);assert.equal(w.topViewTransform().panZ,5);
  L.mouseup[0]({});
  const sel=f.store.selectedDancer;f.ctx.__topClick({clientX:210,clientY:205});
  assert.equal(f.store.selectedDancer,sel,'平移手势吞掉随后的 click');
  // 阈值内小拖动＝普通点击（不平移、click 正常选人）
  w.topRefit();
  const tr=w.topViewTransform(),p1={x:200+5*tr.sc,y:200+7*tr.sc};   // 舞者1 起点 (5,7) 屏幕位
  f.ctx.__topMouseDown({button:0,clientX:p1.x,clientY:p1.y,preventDefault(){}});
  const mv=L.mousemove[L.mousemove.length-1];L.mouseup[L.mouseup.length-1]({});
  mv({clientX:p1.x+2,clientY:p1.y+1});
  assert.equal(w.topViewMode(),'window','阈值内不平移');
  f.ctx.__topClick({clientX:p1.x,clientY:p1.y});
  assert.equal(f.store.selectedDancer,1,'click 正常选人');
});

// ---------- 3. 方向约定常驻标注（HF-09） ----------
test('HF-09 permanent direction markers: audience bottom (+Z down), stage-back top, both faces resident',()=>{
  const f=sandbox.makeFixture(2);tl(f,0,6);
  f.setPath([[3,0,4]],0);                                           // 舞者0 在 +Z 方向 (z=4)
  const w=load(f);f.store.currentTime=3;w.drawTop();
  const texts=()=>f.calls.filter(c=>c.op==='fillText');
  const tr=w.topViewTransform();
  const aud=texts().find(c=>c.args[0]==='观众席'),back=texts().find(c=>c.args[0]==='舞台后方');
  assert.ok(aud&&back,'两面常驻方向标注');
  assert.ok(aud.args[2]>tr.h/2,'观众席标注在屏幕下方（+Z=观众侧）');
  assert.ok(back.args[2]<tr.h/2,'舞台后方标注在屏幕上方');
  const arc=f.calls.find(c=>c.op==='arc'&&c.args[2]===9);
  assert.ok(arc.args[1]>tr.h/2,'z=+4 舞者画在中心下方（+Z 屏幕向下）');
  // 常驻：会话内／手动／适应全部下都画
  f.UI.openSamePlace(0,f.clip());f.calls.length=0;w.drawTop();
  assert.ok(texts().some(c=>c.args[0]==='观众席'&&c.args[2]>w.topViewTransform().h/2),'会话内常驻');
  w.topWheel({deltaY:100,clientX:200,clientY:200,preventDefault(){}});f.calls.length=0;w.drawTop();
  assert.ok(texts().some(c=>c.args[0]==='观众席'),'手动态常驻');
  w.topFitAll();f.calls.length=0;w.drawTop();
  assert.ok(texts().some(c=>c.args[0]==='观众席'),'适应全部常驻');
  // 与 3D 预览默认机位一致：preview3d 默认 viewTheta=0（相机在 +Z 观众侧看向舞台）
  // OVERHAUL 批 B：M1 视图层（含 clampView 的 viewTheta=0 兜底）搬到 preview3d-cam.js，断言跟随迁移
  const p3=fs.readFileSync(path.join(__dirname,'preview3d-cam.js'),'utf8');
  assert.match(p3,/isFinite\(viewTheta\)\) viewTheta = 0;/,'preview3d 默认机位在 +Z（观众）侧');
  // 持久化坐标严禁改动：视图操作不改任何编排数据
  const before=JSON.stringify(f.store.contentExtra);
  w.topWheel({deltaY:-100,clientX:200,clientY:200,preventDefault(){}});w.topPanBy(30,20);w.topFitAll();w.topRefit();w.drawTop();
  assert.equal(JSON.stringify(f.store.contentExtra),before,'持久化坐标零改动');
});

console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
