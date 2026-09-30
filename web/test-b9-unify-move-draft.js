// TASK-20260919-UI-OVERHAUL B9「同处走位并入就地编辑单一草稿面」回归：真实产品模块＋内存 DOM，
// 不冒充浏览器验收。覆盖：①窗口快捷段打开即定位/高亮（会话内窗口子表单）②窗口替换在统一草稿内完成
// （一段应用/整条应用共用一次确认→一次写入→恰好一次 saveHistory）③取消/拒绝＝字节级零写入
// ④脏判据单一（samePlaceDirty 并入整轨草稿 diff：未应用数如实）⑤通用 Delete 按统一判据分派/拒绝
// ⑥两链互斥收起（脏切换拒绝）⑦播放中拒绝 ⑧未应用草稿关闭确认 ⑨「查看整条」自然消失（会话已开）。
// B9_SOURCE 指向保存旧文件目录时对拍红测（stage-motion-ui 与 app 切片都从那里读）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base.replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B9_SOURCE&&n==='choreo-stage-motion-ui.js'?path.join(process.env.B9_SOURCE,n)")+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const appSrc=()=>fs.readFileSync(path.join(process.env.B9_SOURCE||__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..copySelection 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读，
// B9_SOURCE 指向旧目录时仍读旧 choreo-app.js（对拍红测语义不变）；deleteClip 段仍在 app。
const txSrc=()=>process.env.B9_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第七步迁移：deleteClip 段已随舞者/编辑操作块搬到 choreo-app-dancers.js——当前字节从拆分件读；
// B9_SOURCE 指向旧目录时仍读旧 choreo-app.js（对拍红测语义不变）。
const dbSrc=()=>process.env.B9_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-dancers.js'),'utf8');
function fixture(n=2){
 const f=sandbox.makeFixture(n);
 f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
 const origCreate=f.ctx.document.createElement;
 f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
 for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
 const app=appSrc(),tx=txSrc(),db=dbSrc();
 // 选择摘要＋通用 Delete 总事务切片（与 test-b3 同标记）：openSamePlaceMove 守卫由 W-1 静态断言覆盖。
 vm.runInContext(tx.slice(tx.indexOf('function edContent(){'),tx.indexOf('function copySelection(')),f.ctx,{filename:'choreo-app-b9-slice'});
 vm.runInContext(db.slice(db.indexOf('function deleteClip(id){'),db.indexOf('function duplicateClip(clip){')),f.ctx,{filename:'choreo-app-deleteClip'});
 f.confirms=[];f.confirmResult=true;
 f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
 f.ctx.window.confirm=f.ctx.confirm;
 f.installs=0;const oi=f.M.install;f.M.install=function(s,a){f.installs++;return oi.call(f.M,s,a)};
 return f;
}
const fullBytes=f=>JSON.stringify({d:f.store.dancers,g:f.store.globalLyrics,m:f.store.markers,e:f.store.contentExtra&&f.store.contentExtra._doc&&f.store.contentExtra._doc.extraTracks});
const mv=(f,di=0)=>f.M.nodes(f.store,di).movement.map(v=>[Number(v.time),Number(v.x),Number(v.z)]);
const input=(f,label,value)=>{const n=sandbox.flatten(f.host).find(n=>n['aria-label']===label);assert.ok(n,'缺少输入 '+label);n.value=value;n.oninput({target:n});return n};

// ---------- 0. 接线 ----------
test('W-1 app 入口守卫：拒绝路径不再误报「片段已变化」（openSamePlaceMove 有 samePlaceActive 抑制）',()=>{
 const src=appSrc();const i=src.indexOf('function openSamePlaceMove(');
 assert.ok(i>0,'openSamePlaceMove 在源内');
 const seg=src.slice(i,src.indexOf('function renderMacroPanel()',i));
 assert.match(seg,/samePlaceActive/,'拒绝时若同处会话仍在（脏切换拒绝），不追加误导 toast');
});
test('W-2 导出面保持（workbench/app 只读依赖的出口不删）',()=>{
 const f=fixture();const E=f.UI;
 ['openSamePlace','samePlaceActive','samePlaceState','pickSamePlace','drawSamePlace','endSamePlace','selectMotion','openFacing','clearSelection','renderContext','sessionActive','sessionState','selectionDetail','discardSessionIfDancer'].forEach(k=>assert.equal(typeof E[k],'function',k+' 导出保持'));
});

// ---------- 1. 单一草稿面：同处走位＝链 B 会话内的窗口快捷段 ----------
test('U-1 openSamePlace＝打开链 B 会话＋窗口快捷段（会话栏宿主，非舞台条独立草稿）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0],[12,8,0]]);
 f.UI.openSamePlace(0,f.clip()); // 动作 8–10s；预填承接＝干净
 assert.equal(f.UI.sessionActive(),true,'就地编辑会话打开（单一草稿面）');
 assert.equal(f.UI.samePlaceActive(),true,'窗口快捷段随会话打开');
 const bar=f.find('wbMoveBar');
 assert.ok(bar,'窗口快捷段子表单存在');
 const ctx=f.find('wbCtx');
 assert.ok(ctx,'会话上下文栏存在');
 assert.ok(sandbox.flatten(ctx).some(n=>n.id==='wbMoveBar'),'窗口快捷段在会话栏内（宿主统一到时间轴下方 wbCtxHost）');
 assert.equal(f.UI.sessionState().di,0);
 assert.ok(!f.top.children.some(n=>n.id==='wbMoveBar'),'舞台俯视标签不再持有第二套窗口草稿条');
 assert.ok(f.find('wbMoveDur')&&f.find('wbMoveArrival')&&f.find('wbMoveMode')&&f.find('wbMoveApply')&&f.find('wbMoveClear')&&f.find('wbMoveCancel'),'快捷段子表单字段齐备');
});
test('U-2 打开即定位/高亮该动作窗口（数值表窗内行 data-win＋表格自动展开）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0],[12,8,0]]);
 f.UI.selectMotion(0);f.mount();
 f.UI.openSamePlace(0,f.clip()); // 同舞者：复用既有会话
 f.mount(); // 桩环境：结构变化后重挂会话栏（真实页面由 refreshWorkbenchBars 重建）
 const winRows=sandbox.flatten(f.find('wbMotionTable')).filter(n=>n['data-win']==='1');
 assert.equal(winRows.length,1,'窗内行恰 1 行高亮（节点 9s 在 [8,9]）');
 assert.ok(f.find('wbMotionTable').open===true,'数值表自动展开＝定位到窗口');
});
test('U-3 「查看整条」自然消失（会话已是整条编辑）＋无预填如实提示',()=>{
 const f=fixture();f.setPath([[5,3,0]]); // 出发 8s 后无节点
 f.UI.openSamePlace(0,f.clip());
 assert.equal(f.UI.sessionActive(),true,'整条会话已开＝互链目标已在此，无需跳转');
 assert.ok(!f.find('wbMoveViewAll'),'「查看整条」按钮自然消失（语义由统一草稿面吸收）');
 assert.match(f.find('wbMoveHint').textContent,/没有已排走位/,'如实提示保留');
});

// ---------- 2. 提交链统一：一次确认→一次写入→恰好一次 saveHistory ----------
test('U-4 应用一段：窗口替换并入统一草稿后一次提交（恰一次 install＋一次 saveHistory）',()=>{
 const f=fixture();f.setPath([[2,0,0],[10,8,0],[12,8,0]]);f.installs=0; // setPath 自身的 install 不计
 f.UI.openSamePlace(0,f.clip()); // 预填＝节点 10(8)，到达 10
 f.UI.pickSamePlace(9,0); // 目的地 (9,0)（HF-01：保留用时/到达）
 f.find('wbMoveApply').onclick();
 assert.equal(f.history.length,1,'恰好一次 saveHistory');
 assert.equal(f.installs,1,'恰好一次写入');
 assert.deepEqual(mv(f),[[2,0,0],[8,6,0],[10,9,0],[12,8,0]],'T1 窗口替换＝表 A 数值例（锚点 P(8)=6）');
 assert.equal(f.UI.samePlaceActive(),false,'应用后窗口快捷段收起');
 assert.ok(f.toasts.some(m=>/10s 到达/.test(m)),'应用 toast 如实（到达时刻）');
});
test('U-5 应用整条（wbMotionApply）在窗口快捷段有未应用输入时＝并入同一草稿一次提交',()=>{
 const f=fixture();f.setPath([[2,0,0]]);
 f.UI.openSamePlace(0,f.clip()); // 无预填→到达默认 10
 f.UI.pickSamePlace(4,0);
 f.find('wbMotionApply').onclick(); // 会话栏「应用走位」（整条）
 assert.equal(f.history.length,1,'一次确认→一次写入→恰一次 saveHistory（不分两段）');
 assert.deepEqual(mv(f),[[2,0,0],[8,0,0],[10,4,0]],'窗口子表单经统一草稿落库');
 assert.equal(f.UI.samePlaceActive(),false,'提交后快捷段收起');
});
test('U-6 复用会话：先改窗外节点草稿再开窗口快捷段，一次提交两处改动（单一草稿，非保存态）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0],[12,8,0]]);
 f.UI.selectMotion(0);f.mount();
 input(f,'路径节点3 X 米','3'); // 窗外节点 12 的草稿改动（未应用）
 f.UI.openSamePlace(0,f.clip()); // 同舞者：复用会话（不重取基线）
 f.mount();
 input(f,'到达时刻（秒）','10');
 f.UI.pickSamePlace(6,0);
 f.find('wbMoveApply').onclick();
 assert.equal(f.history.length,1,'窗外节点修改＋窗口替换＝同一次提交、一步撤销');
 const got=mv(f);
 assert.equal(got.length,4);
 assert.deepEqual(got[0],[2,0,0]);
 near(got[1][1],4.286);assert.equal(got[1][0],8,'出发锚点按草稿轨迹采样');
 assert.deepEqual(got[2],[10,6,0],'目的地落位');
 assert.deepEqual(got[3],[12,3,0],'窗外草稿改动随统一草稿一并保存（旧链会丢这处改动）');
});
test('U-7 取消/拒绝＝字节级零写入（含其他舞者轨道）',()=>{
 const f=fixture(2);f.setPath([[2,0,0],[9,5,0]],0);f.setPath([[3,1,1]],1);
 f.UI.openSamePlace(0,f.clip());
 f.UI.pickSamePlace(6,0);
 const before=fullBytes(f);
 input(f,'到达时刻（秒）','7.5'); // 到达=7.5 <出发 8 → 非法
 f.find('wbMoveApply').onclick();
 assert.equal(fullBytes(f),before,'非法到达拒绝＝零写入');
 assert.match(f.find('wbMoveHint').textContent,/晚于动作开始|移动用时/);
 f.find('wbMoveCancel').onclick();
 assert.equal(fullBytes(f),before,'取消＝字节级零写入（舞者1 轨道不动）');
 assert.equal(f.UI.samePlaceActive(),false);
 assert.equal(f.UI.sessionActive(),false,'自动打开的会话随取消收起');
 assert.equal(f.UI.samePlaceState(),null);
});
test('U-8 播放中拒绝（零写入，会话保持）',()=>{
 const f=fixture();f.setPath([[2,0,0]]);
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(6,0);
 f.store.isPlaying=true;
 const before=fullBytes(f);
 f.find('wbMoveApply').onclick();
 assert.equal(fullBytes(f),before,'播放中零写入');
 assert.equal(f.UI.samePlaceActive(),true,'拒绝不关会话');
 assert.match(f.find('wbMoveHint').textContent,/请先暂停/);
});

// ---------- 3. 脏会话单一判据 ----------
test('U-9 脏判据单一：窗口输入计入「未应用 N 处」（如实计数）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0]]);
 f.UI.openSamePlace(0,f.clip());
 assert.match(f.find('wbMotionDirty').textContent,/已与保存一致/,'预填承接＝干净');
 f.UI.pickSamePlace(6,0);
 assert.match(f.find('wbMotionDirty').textContent,/未应用 1 处/,'点目的地＝未应用 1 处');
 assert.match(f.find('wbMotionDirty').textContent,/窗口快捷段/,'如实标注含窗口快捷段');
 const d=f.UI.selectionDetail();
 assert.equal(d.length,1,'摘要单一对象（不再两套）');
 assert.equal(d[0].level,'window','编辑作用域＝窗口');
 assert.equal(d[0].dirty,true,'统一判据 dirty');
});
test('U-10 通用 Delete 按统一判据拒绝脏窗口草稿（R5-06）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0]]);
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(6,0);
 const before=fullBytes(f);
 f.ctx.deleteSelectedClips();
 assert.ok(f.toasts.some(m=>/先「应用」或「取消」/.test(m)),'脏＝拒绝');
 assert.equal(fullBytes(f),before,'零写入');
});
test('U-11 干净窗口会话：通用 Delete 仍按 T3 窗口分派（分派能力不弱化）',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0],[12,8,0]]);
 f.UI.openSamePlace(0,f.clip()); // 预填承接＝干净
 f.confirmResult=true;
 f.ctx.deleteSelectedClips();
 assert.ok(f.confirms.some(m=>/重连/.test(m)),'窗口级 T3 预告确认');
 assert.deepEqual(mv(f),[[2,0,0],[12,8,0]],'窗内节点清除');
 assert.equal(f.UI.samePlaceActive(),false,'被删对象的会话关闭');
 assert.equal(f.history.length,1);
});
test('U-12 未应用草稿关闭确认（含窗口快捷段计数；拒绝＝保持）',()=>{
 const f=fixture();f.setPath([[2,0,0]]);
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(6,0);
 f.confirmResult=false;
 f.find('wbMotionClose').onclick();
 assert.ok(f.confirms.some(m=>/未应用 1 处/.test(m)),'确认框列出未应用数（含快捷段）');
 assert.equal(f.UI.samePlaceActive(),true,'拒绝关闭＝会话保持');
 f.confirmResult=true;
 f.find('wbMotionClose').onclick();
 assert.equal(f.UI.samePlaceActive(),false,'确认后关闭');
});

// ---------- 4. 两链互斥收口 ----------
test('U-13 脏窗口快捷段：切换编辑器（selectMotion 他舞者）拒绝并保持',()=>{
 const f=fixture(2);f.setPath([[2,0,0]],0);
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(6,0);
 const before=fullBytes(f);
 assert.equal(f.UI.selectMotion(1),false,'切换被拒（表 B：先应用或取消）');
 assert.ok(f.toasts.some(m=>/先「应用」或「取消」/.test(m)),'toast 提示');
 assert.equal(f.UI.samePlaceActive(),true,'快捷段保持');
 assert.equal(fullBytes(f),before,'零写入');
});
test('U-14 干净窗口快捷段：切换编辑器＝收起并入新会话（不静默丢草稿之外的行为）',()=>{
 const f=fixture(2);f.setPath([[2,0,0]],0);
 f.UI.openSamePlace(0,f.clip()); // 干净（未 pick）
 assert.equal(f.UI.selectMotion(1),true,'干净可切换');
 assert.equal(f.UI.samePlaceActive(),false,'旧快捷段随旧会话收起');
 assert.equal(f.UI.sessionState().di,1);
});

console.log(pass+' passed, '+fail+' failed');
process.exitCode=fail?1:0;
