// B3 删除、插入与承接可见性：真实 UI/引擎/编辑模块与隔离 DOM；浏览器可用性另验（不冒充）。
// 覆盖：D-B2-01 旧浮窗入口拒绝；TD-01 应用/取消/未应用提示常驻；HF-05 三级删除与预告（T2/T3 双侧）；
// HF-03 加节点=采样位置；HF-06 承接预填；B3 选择摘要 getter＋通用 Delete 总事务（R5-06 会话/历史）。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
// B3_SOURCE 指向保存的旧文件目录时可对拍红测（stage-motion-ui 与 app 切片都从那里读）。
vm.runInContext(base.replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B3_SOURCE&&n==='choreo-stage-motion-ui.js'?path.join(process.env.B3_SOURCE,n)")+';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const appSrc=()=>fs.readFileSync(path.join(process.env.B3_SOURCE||__dirname,'choreo-app.js'),'utf8');
// OVERHAUL 批 C迁移：edContent..copySelection 段已随代码搬到 choreo-app-edit-tx.js——当前字节从拆分件读，
// B3_SOURCE 指向旧目录时仍读旧 choreo-app.js（对拍红测语义不变）。
const txSrc=()=>process.env.B3_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-edit-tx.js'),'utf8');
// OVERHAUL 批 C 第七步迁移：deleteClip 段已随舞者/编辑操作块搬到 choreo-app-dancers.js——当前字节从拆分件读；
// B3_SOURCE 指向旧目录时仍读旧 choreo-app.js（对拍红测语义不变）。
const dbSrc=()=>process.env.B3_SOURCE?appSrc():fs.readFileSync(path.join(__dirname,'choreo-app-dancers.js'),'utf8');
function fixture(n=4){
 const f=sandbox.makeFixture(n);
 f.ctx.requestAnimationFrame=()=>0;f.ctx.cancelAnimationFrame=()=>{};
 // 旧浮窗 open() 自建 canvas：让 createElement('canvas') 复用夹具的记录型 2D 上下文。
 const origCreate=f.ctx.document.createElement;
 f.ctx.document.createElement=function(tag){const e=origCreate(tag);if(tag==='canvas')e.getContext=()=>f.g;return e};
 // B1 夹具的 g 少数 2D 操作未记录（translate/rotate/closePath/scale），旧浮窗 frame() 会用到。
 for(const op of ['translate','rotate','closePath','scale','clip'])if(!f.g[op])f.g[op]=(...args)=>f.calls.push({op,args});
 for(const name of ['choreo-ability-plan.js','choreo-skill-metadata.js','choreo-ability-plan-targets.js','choreo-ability-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),f.ctx);
 const db=dbSrc();
 // 选择摘要＋通用 Delete 总事务（edContent..deleteSelectedClips 段）与 deleteClip 段按标记切片加载。
 const tx=txSrc();
 vm.runInContext(tx.slice(tx.indexOf('function edContent(){'),tx.indexOf('function copySelection(')),f.ctx,{filename:'choreo-app-b3-slice'});
 vm.runInContext(db.slice(db.indexOf('function deleteClip(id){'),db.indexOf('function duplicateClip(clip){')),f.ctx,{filename:'choreo-app-deleteClip'});
 f.confirms=[];f.confirmResult=true;
 f.ctx.confirm=function(msg){f.confirms.push(String(msg));return f.confirmResult};
 f.ctx.window.confirm=f.ctx.confirm;
 return f;
}
const skill={id:120,type:'action',name:'测试技能',staticMetadata:{version:1,actionId:120,castMs:0,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
const insideFold=n=>{for(let p=n&&n.parentNode;p;p=p.parentNode){if(p.id==='wbMotionTable')return true}return false};

// ---------- 0. D-B2-01：技能编辑中旧浮窗入口 open() 同款拒绝 ----------
test('D-B2-01 open() refuses while skill editor holds uncommitted draft',()=>{
 const f=fixture();f.ctx.ChoreoAbilityUI.quickAdd(skill,0,2);
 const r=f.ctx.ChoreoAbilityPlan.rows(f.store)[0];
 f.ctx.ChoreoAbilityUI.open(skill,0,2,r); // 技能编辑会话
 assert.equal(f.ctx.ChoreoAbilityUI.suspendEditor(),false,'precondition: skill editor active');
 const before=JSON.stringify(f.store);
 f.UI.open(0); // 旧版浮窗入口（「＋编排路径节点」/「旧版专家面板」）
 assert.ok(!sandbox.flatten(f.ctx.document.body).some(n=>n.className==='stage-motion-editor'),'浮窗不得打开');
 assert.ok(f.toasts.some(m=>/请先应用或取消技能编辑/.test(m)),'须 toast 与 beginSession 同款拒绝');
 assert.equal(f.ctx.ChoreoAbilityUI.suspendEditor(),false,'技能编辑器保持');
 assert.equal(JSON.stringify(f.store),before,'零写入');
});

// ---------- 1. TD-01：未应用提示·应用·取消 常驻可见（移出折叠区） ----------
test('TD-01 apply/cancel/unapplied hint always visible outside the fold',()=>{
 const f=fixture();f.setPath([[6,6,0]]);f.UI.selectMotion(0);f.mount();
 const apply=f.find('wbMotionApply'),cancel=f.find('wbMotionCancel'),dirty=f.find('wbMotionDirty');
 assert.ok(apply&&cancel&&dirty,'未应用提示·应用·取消三件都在');
 assert.ok(!insideFold(apply)&&!insideFold(cancel)&&!insideFold(dirty),'三件都移出「节点数值表」折叠区');
 const fold=f.find('wbMotionTable');assert.ok(fold,'折叠区仍在');
 assert.ok(sandbox.flatten(fold).some(n=>n.className==='wb-node-tbl'),'折叠区只留数值表本身');
 assert.ok(insideFold(sandbox.flatten(fold).find(n=>n['aria-label']==='路径节点1 到达秒')),'数值表仍在折叠区内');
});
test('TD-01 dirty count / close confirm / keep session on decline',()=>{
 const f=fixture();f.setPath([[6,6,0]]);f.UI.selectMotion(0);f.mount();
 const inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');assert.ok(inp);
 inp.value='9';inp.oninput({target:inp});
 assert.match(f.find('wbMotionDirty').textContent,/未应用 1 处/);
 f.confirmResult=false;f.find('wbMotionClose').onclick();
 assert.equal(f.UI.sessionActive(),true,'拒绝确认时会话保留');
 assert.ok(f.confirms.some(m=>/未应用 1 处/.test(m)),'确认框列出未应用修改数');
 f.confirmResult=true;f.find('wbMotionClose').onclick();
 assert.equal(f.UI.sessionActive(),false);
});
test('TD-01 apply commits once back to clean; cancel re-baselines keeping session',()=>{
 const f=fixture();f.setPath([[6,6,0]]);f.UI.selectMotion(0);f.mount();
 let inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');
 inp.value='9';inp.oninput({target:inp});
 f.find('wbMotionApply').onclick();
 assert.equal(f.history.length,1);
 assert.equal(f.M.nodes(f.store,0).movement[0].x,'9');
 assert.equal(f.UI.sessionActive(),true,'应用后回 S1（会话保持）');
 f.mount();assert.equal((f.find('wbMotionDirty').textContent.match(/\d+/)||['0'])[0],'0');
 inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');
 inp.value='5';inp.oninput({target:inp});
 f.find('wbMotionCancel').onclick();
 assert.equal(f.M.nodes(f.store,0).movement[0].x,'9','取消＝重取 baseline，保存值不动');
 assert.equal(f.UI.sessionState().di,0,'会话与选择保持');
 assert.equal(f.history.length,1);
 f.mount();assert.equal((f.find('wbMotionDirty').textContent.match(/\d+/)||['0'])[0],'0');
});

test('B3-RT-01 dirty hint reads 已与保存一致 on every (re)built bar in clean state',()=>{
 const f=fixture();f.setPath([[6,6,0]]);f.UI.selectMotion(0);f.mount();
 assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致','打开会话（干净态）即显示一致');
 let inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');
 inp.value='9';inp.oninput({target:inp});
 assert.match(f.find('wbMotionDirty').textContent,/未应用 1 处/,'编辑中提示未应用数');
 f.find('wbMotionApply').onclick();
 f.mount();
 assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致','应用后（重建栏）回一致');
 inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');
 inp.value='5';inp.oninput({target:inp});
 f.find('wbMotionCancel').onclick();
 f.mount();
 assert.equal(f.find('wbMotionDirty').textContent,'已与保存一致','取消后（重建栏）回一致');
});

// ---------- 2. HF-05＋§6：三级删除与预告（T2/T3 双侧） ----------
test('HF-05 node pick previews reconnect and T2 delete dual-side [t_prev,t_next]',()=>{
 const f=fixture();f.setPath([[2,0,0],[4,0,4],[6,4,0]]);
 const before=[1,3,5,7].map(t=>f.sample(t).x);
 assert.deepEqual(before,[0,0,2,4]);
 f.UI.selectMotion(0);f.mount();
 f.UI.pickTopNode(0,4,0.3);
 const det=f.ctx.ChoreoStageMotionUI.selectionDetail()[0];
 assert.equal(det.level,'node');
 assert.equal(det.di,0);
 assert.match(f.find('wbMotionStatus').textContent,/走位节点 2/,'节点选中反馈保留 B2 口径');
 assert.match(f.find('wbMotionStatus').textContent,/\[2s.*6s\].*重连|重连.*\[2s.*6s\]/,'受影响区间预告');
 // 连线预览：虚线直连前(0,0)→后(4,0)，跳过被选节点
 f.calls.length=0;f.UI.drawSelected(f.g,(x,z)=>({sx:x,sy:z}));
 const i=f.calls.findIndex(c=>c.op==='moveTo'&&c.args[0]===0&&c.args[1]===0&&f.calls[f.calls.indexOf(c)+1]&&f.calls[f.calls.indexOf(c)+1].op==='lineTo'&&f.calls[f.calls.indexOf(c)+1].args[0]===4&&f.calls[f.calls.indexOf(c)+1].args[1]===0);
 assert.ok(i>=0,'删除后连线预览（prev→next 直连）');
 f.ctx.deleteSelectedClips(); // 通用 Delete（键盘与屏幕同分派）
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>Number(v.time)),[2,6]);
 assert.equal(f.history.length,1,'一次撤销');
 const after=[1,3,5,7].map(t=>f.sample(t).x);
 assert.equal(after[0],0,'t<t_prev 精确不变');
 near(after[1],1);near(after[2],3);assert.equal(after[3],4,'t>t_next 精确不变');
 assert.equal(f.UI.sessionActive(),false,'干净会话按 R5-06 关闭');
 assert.ok(f.toasts.some(m=>/节点/.test(m)));
});
test('HF-05 T2 tail delete announces [t_prev,END] and changes terminal to prev node',()=>{
 const f=fixture();f.setPath([[2,2,0],[4,4,0]]);
 assert.equal(f.sample(20).x,4);
 f.UI.selectMotion(0);f.mount();f.UI.pickTopNode(4,0,0.3);
 assert.match(f.find('wbMotionStatus').textContent,/END/,'尾部预告到 END');
 f.ctx.deleteSelectedClips();
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>Number(v.time)),[2]);
 assert.equal(f.sample(20).x,2,'终态改为前节点值');
 assert.equal(f.sample(1).x,1,'t<t_prev 精确不变');
 assert.equal(f.history.length,1);
});
test('HF-05 T2 sole node delete clears whole track back to start placement',()=>{
 const f=fixture();f.setPath([[4,4,0]]);
 f.UI.selectMotion(0);f.mount();f.UI.pickTopNode(4,0,0.3);
 assert.match(f.find('wbMotionStatus').textContent,/唯一|整轨清空|起点/);
 f.ctx.deleteSelectedClips();
 assert.equal(f.M.tracks(f.store).filter(t=>f.M.owned(t)&&t.type==='movement').length,0,'整轨移除');
 assert.equal(f.sample(10).x,0,'回到起点站位');
 assert.equal(f.history.length,1);
});
test('HF-05 node missing from saved track = toast zero write',()=>{
 const f=fixture();f.setPath([[2,0,0],[4,4,0],[6,8,0]]);
 f.UI.selectMotion(0);f.mount();f.UI.pickTopNode(4,0,0.3);
 f.M.install(f.store,f.M.edit(f.store,0,{movement:[{time:'2',x:'0',z:'0'},{time:'6',x:'8',z:'0'}],facing:[]},'ext'));
 const snap=JSON.stringify(f.store);
 f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap);
 assert.ok(f.toasts.some(m=>/不存在/.test(m)));
});
test('HF-05 window clear (清除这条走位) preview + confirm + T3 dual-side 原例',()=>{
 const f=fixture();f.setPath([[2,0,0],[8,0,0],[10,8,0],[12,8,0]]);
 assert.equal(f.sample(4).x,0);assert.equal(f.sample(11).x,8);
 f.UI.openSamePlace(0,f.clip()); // 动作 8–10s，默认到达 10
 f.confirmResult=false;f.find('wbMoveClear').onclick();
 assert.equal(f.M.nodes(f.store,0).movement.length,4,'未确认零写入');
 assert.ok(f.find('wbMoveWindow').textContent.indexOf('清除影响')>=0,'常驻窗口说明含清除预告');
 f.confirmResult=true;f.find('wbMoveClear').onclick();
 assert.ok(f.confirms.some(m=>/\[2s.*12s\]/.test(m)&&/重连/.test(m)),'确认框预告受影响区间 [前节点,后节点]');
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x)]),[[2,0],[12,8]]);
 assert.equal(f.history.length,1);
 near(f.sample(4).x,1.6);near(f.sample(11).x,7.2);
 assert.equal(f.sample(1).x,0,'t≤t_prev 精确不变');
 assert.equal(f.sample(20).x,8,'t≥t_next 精确不变');
});
test('HF-05 window clear to tail announces [t_prev,END] terminal change',()=>{
 const f=fixture();f.setPath([[2,2,0],[4,4,0],[10,9,0]]);
 assert.equal(f.sample(20).x,9);
 f.UI.openSamePlace(0,f.clip()); // 窗口 [8,10] 内含节点 10(9)（预填承接＝干净会话）
 f.confirmResult=true;f.find('wbMoveClear').onclick();
 assert.ok(f.confirms.some(m=>/\[4s.*END\]/.test(m)&&/终态/.test(m)));
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x)]),[[2,2],[4,4]]);
 assert.equal(f.sample(20).x,4);
 assert.equal(f.history.length,1);
});
test('HF-05 window with no nodes = status hint zero write (existing rule kept)',()=>{
 const f=fixture();f.setPath([[2,0,0]]);
 f.UI.openSamePlace(0,f.clip()); // 窗口 8–10 无节点
 f.confirmResult=true;f.find('wbMoveClear').onclick();
 assert.equal(f.M.nodes(f.store,0).movement.length,1);
 assert.equal(f.history.length,0);
 assert.match(f.find('wbMoveHint').textContent,/没有已保存的走位节点/);
});
test('HF-05 whole-track delete via universal Delete lists node count, one undo, facing intact',()=>{
 const f=fixture();
 f.M.install(f.store,f.M.edit(f.store,0,{movement:[{time:'2',x:'1',z:'0'},{time:'4',x:'2',z:'0'},{time:'6',x:'3',z:'0'}],facing:[{time:'5',yaw:'90'}]},'wt'));
 f.UI.selectMotion(0);f.mount();
 f.confirmResult=true;f.ctx.deleteSelectedClips();
 assert.ok(f.confirms.some(m=>/3 个节点/.test(m)),'明确列出节点数');
 assert.equal(f.M.tracks(f.store).filter(t=>f.M.owned(t)&&t.type==='movement').length,0);
 assert.ok(f.M.tracks(f.store).find(t=>f.M.owned(t)&&t.type==='facing'),'走位/朝向互不牵连');
 assert.equal(f.UI.sessionActive(),false);
 assert.equal(f.history.length,1);
});
test('HF-05 whole-track facing delete leaves movement intact',()=>{
 const f=fixture();
 f.M.install(f.store,f.M.edit(f.store,0,{movement:[{time:'2',x:'1',z:'0'}],facing:[{time:'5',yaw:'90'}]},'wf'));
 f.UI.openFacing(0);f.mount();
 f.confirmResult=true;f.ctx.deleteSelectedClips();
 assert.ok(f.confirms.some(m=>/朝向/.test(m)));
 assert.ok(f.M.tracks(f.store).find(t=>f.M.owned(t)&&t.type==='movement'),'movement 不动');
 assert.equal(f.M.tracks(f.store).filter(t=>f.M.owned(t)&&t.type==='facing').length,0);
 assert.equal(f.history.length,1);
});

// ---------- 3. HF-03：加节点默认＝采样位置 ----------
test('HF-03 addAtPlayhead samples the draft trajectory (movement, dual-side real sampling)',()=>{
 const f=fixture();f.setPath([[10,10,0]]);
 const before=[0,2,4,6,8,10,12].map(t=>f.sample(t).x);
 f.UI.selectMotion(0);f.mount();
 f.store.currentTime=4;
 f.find('wbMotionAdd').onclick();
 assert.equal(f.UI.sessionState().movement,2,'草稿 +1');
 f.find('wbMotionApply').onclick();
 const after=[0,2,4,6,8,10,12].map(t=>f.sample(t).x);
 before.forEach((v,i)=>assert.ok(Math.abs(v-after[i])<=0.0005,'t='+i+' 采样不变（≤量化容差）'));
 assert.equal(f.history.length,1);
 assert.equal(f.M.nodes(f.store,0).movement[0].x,'4','节点坐标＝该时刻采样（非复制末点）');
});
test('HF-03 facing node sampled; same-time refused; invalid draft refused (表 B S3)',()=>{
 const f=fixture();
 f.M.install(f.store,f.M.edit(f.store,0,{movement:[],facing:[{time:'2',yaw:'0'},{time:'10',yaw:'90'}]},'fs'));
 f.UI.openFacing(0);f.mount();
 f.store.currentTime=6;
 f.find('wbMotionAdd').onclick();
 assert.equal(f.UI.sessionState().facing,3);
 f.find('wbMotionApply').onclick();
 near(f.sample(6).yawDeg,45);
 assert.equal(f.history.length,1);
 const g=fixture();
 g.M.install(g.store,g.M.edit(g.store,0,{movement:[],facing:[{time:'2',yaw:'0'}]},'fs2'));
 g.UI.openFacing(0);g.mount();g.store.currentTime=2;g.find('wbMotionAdd').onclick();
 assert.equal(g.UI.sessionState().facing,1,'同刻沿用现行拒绝');
 assert.match(g.find('wbMotionStatus').textContent,/同刻/);
 const h=fixture();h.setPath([[10,10,0]]);h.UI.selectMotion(0);h.mount();
 const inp=sandbox.flatten(h.host).find(n=>n['aria-label']==='路径节点1 到达秒');
 inp.value='x';inp.oninput({target:inp});
 h.store.currentTime=4;h.find('wbMotionAdd').onclick();
 assert.equal(h.UI.sessionState().movement,1,'非法草稿不加节点');
 assert.match(h.find('wbMotionStatus').textContent,/数字|修正|取消/);
});

// ---------- 4. HF-06：承接预填 ----------
test('HF-06 prefill = first node strictly after departure (8→13 原例)；未改直接应用＝no-op',()=>{
 const f=fixture();f.setPath([[8,0,0],[13,5,0]]);
 const c=f.clip();const snap=JSON.stringify(f.store);
 f.UI.openSamePlace(0,c); // 动作 8–10s
 const st=f.UI.samePlaceState();
 assert.equal(String(st.dest.x),'5','目的地＝该节点坐标');
 assert.equal(String(st.dest.z),'0');
 assert.equal(f.find('wbMoveArrival').value,'13','到达＝其时刻');
 assert.equal(f.find('wbMoveDur').value,'5','用时＝差值');
 f.find('wbMoveApply').onclick();
 assert.equal(JSON.stringify(f.store),snap,'按预填直接应用＝字节级不变（no-op）');
 assert.equal(f.history.length,0,'零历史');
 assert.ok(f.toasts.some(m=>/一致|未重复保存/.test(m)));
 assert.equal(f.UI.samePlaceActive(),true,'no-op 不关会话（可继续编辑；零触碰）');
});
test('HF-06 no node after departure = honest empty prefill；「查看整条」由统一草稿面吸收（B9 迁移）',()=>{
 // B9 机械迁移（旧↔新并列）：旧＝无预填时给「查看整条」按钮跳转链 B 会话；新＝打开同处走位即开
 // 链 B 会话（单一草稿面），互链目标已在此、按钮自然消失（留证：本断言即消失证据）；其余断言不动。
 const f=fixture();f.setPath([[5,3,0]]);
 f.UI.openSamePlace(0,f.clip());
 assert.equal(f.UI.samePlaceState().dest,null,'目的地留空，不编造默认');
 assert.match(f.find('wbMoveHint').textContent,/没有已排走位/,'如实提示');
 assert.equal(f.UI.sessionActive(),true,'整条就地编辑会话已随打开开启（原「查看整条」的落点）');
 assert.equal(f.UI.sessionState().di,0);
 assert.ok(!f.find('wbMoveViewAll'),'「查看整条」按钮自然消失（会话已是整条编辑，无需跳转）');
 assert.equal(f.UI.samePlaceActive(),true,'快捷段仍开（可继续点目的地）');
});
test('HF-06 round trips carry the latest result (change dest, then arrival)',()=>{
 const f=fixture();f.setPath([[8,0,0],[13,5,0]]);
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(7,2);
 f.find('wbMoveApply').onclick();
 assert.equal(f.history.length,1);
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x),Number(v.z)]),[[8,0,0],[13,7,2]]);
 f.UI.openSamePlace(0,f.clip());
 assert.equal(String(f.UI.samePlaceState().dest.x),'7','改终点后重开承接最新终点');
 assert.equal(f.find('wbMoveArrival').value,'13');
 f.find('wbMoveCancel').onclick();
 f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(7,2);
 const arr=f.find('wbMoveArrival');arr.value='12';arr.oninput();
 f.find('wbMoveApply').onclick();
 // T1：窗口 [8,12] 替换；t>12 的既有节点（13）按「保留 t>b 节点字节不动」留下
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x),Number(v.z)]),[[8,0,0],[12,7,2],[13,7,2]]);
 f.UI.openSamePlace(0,f.clip());
 assert.equal(f.find('wbMoveArrival').value,'12','改到达后重开承接最新到达');
 assert.equal(String(f.UI.samePlaceState().dest.x),'7');
});

// ---------- 5. 选择摘要 getter＋通用 Delete 总事务 ----------
test('selectionSummary aggregates clips, skills and motion sessions',()=>{
 const f=fixture(2);f.setPath([[5,5,0]],0);f.setPath([[7,7,0]],1);
 const c=f.clip();c.selected=true;
 f.ctx.ChoreoAbilityUI.quickAdd(skill,0,2);
 const id=f.ctx.ChoreoAbilityPlan.rows(f.store)[0].event.id;
 f.ctx.ChoreoAbilityUI.toggleSel(id); // Ctrl 语义跨类型加选（setSel 会按产品规则清时间轴选中）
 f.UI.selectMotion(1);
 const sum=f.ctx.selectionSummary();
 assert.deepEqual(Array.from(sum).map(o=>o.kind).sort(),['clip','movement','skill']);
 const mv=sum.find(o=>o.kind==='movement');assert.equal(mv.di,1);assert.equal(mv.level,'track');assert.equal(mv.dirty,false);
 const sk=sum.find(o=>o.kind==='skill');assert.equal(sk.di,0);assert.equal(sk.id,id);
 const cl=sum.find(o=>o.kind==='clip');assert.equal(cl.di,0);assert.deepEqual(Array.from(cl.span),[8,10]);
});
test('mixed selection deletes in one transaction with exactly one saveHistory',()=>{
 const f=fixture(2);
 f.setPath([[5,5,0]],0);f.setPath([[7,7,0]],1);
 const c=f.clip();c.selected=true;
 f.ctx.ChoreoAbilityUI.quickAdd(skill,0,2);
 f.ctx.ChoreoAbilityUI.toggleSel(f.ctx.ChoreoAbilityPlan.rows(f.store)[0].event.id); // Ctrl 跨类型加选
 const h0=f.history.length;
 f.confirmResult=true;
 f.ctx.deleteSelectedClips();
 assert.equal(f.history.length,h0+1,'混合选择恰一次 saveHistory');
 assert.equal(f.store.dancers[0].actionClips.length,0);
 assert.equal(f.ctx.ChoreoAbilityPlan.rows(f.store).length,0);
 assert.equal(f.M.tracks(f.store).filter(t=>f.M.owned(t)).length,2,'摘要无走位对象：两舞者走位轨都不动');
 assert.ok(f.toasts.some(m=>/已删除/.test(m)));
});
test('dirty motion session refuses Delete with zero write (S2 拒绝)',()=>{
 const f=fixture();f.setPath([[6,6,0]]);const c=f.clip();c.selected=true;
 f.UI.selectMotion(0);f.mount();
 const inp=sandbox.flatten(f.host).find(n=>n['aria-label']==='路径节点1 X 米');
 inp.value='9';inp.oninput({target:inp});
 const snap=JSON.stringify(f.store);
 f.confirmResult=true;f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap,'整体零写入');
 assert.equal(f.history.length,0);
 assert.equal(f.UI.sessionActive(),true,'会话不受触碰（R5-06 拒绝路径）');
 assert.ok(f.toasts.some(m=>/先「应用」或「取消」|先应用或取消/.test(m)));
});
test('whole-track confirm declined = zero write, session untouched (R5-06 取消路径)',()=>{
 const f=fixture();f.setPath([[5,5,0]]);f.UI.selectMotion(0);f.mount();
 const snap=JSON.stringify(f.store);
 f.confirmResult=false;f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap);
 assert.equal(f.history.length,0);
 assert.equal(f.UI.sessionActive(),true);
});
test('input focus Delete never deletes objects (S0 亦然)',()=>{
 const f=fixture();const c=f.clip();c.selected=true;
 f.ctx.document.activeElement={tagName:'INPUT'};
 const snap=JSON.stringify(f.store);
 f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap);
 assert.equal(f.history.length,0);
});
test('B3-RT-02 S6 unconfirmed start placement refuses Delete even for single selected clip',()=>{
 const f=fixture();const c=f.clip();c.selected=true;
 f.ctx.window.ChoreoStageUI={startPosState:()=>({picked:true})};
 const snap=JSON.stringify(f.store);
 f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap,'单片早退分支同样被 S6 拒绝（零写入）');
 assert.equal(f.history.length,0);
 assert.ok(f.toasts.some(m=>/起始站位还有未应用的放置/.test(m)),'须 S6 同款 toast');
 f.ctx.window.ChoreoStageUI={startPosState:()=>({picked:false})};
 f.ctx.deleteSelectedClips();
 assert.equal(f.store.dancers[0].actionClips.length,0,'S6 解除后单片删除恢复');
 assert.ok(f.toasts.some(m=>/已删除/.test(m)));
});
test('deleting action clips keeps window movement and toast says so explicitly',()=>{
 const f=fixture();f.setPath([[9,5,0]]); // 节点 9(5,0) 在动作 8–10s 窗口内
 const c=f.clip();c.selected=true;
 f.ctx.deleteSelectedClips();
 assert.equal(f.store.dancers[0].actionClips.length,0);
 assert.equal(f.M.nodes(f.store,0).movement.length,1,'窗口走位未动');
 assert.ok(f.toasts.some(m=>/走位节点未动/.test(m)),'toast 明说');
});
test('skill precheck failure refuses the whole batch (locked track, zero write)',()=>{
 const f=fixture();const c=f.clip();c.selected=true;
 f.ctx.ChoreoAbilityUI.quickAdd(skill,0,2);
 const t=f.ctx.ChoreoAbilityPlan.tracks(f.store)[0];t.locked=true;
 f.ctx.ChoreoAbilityUI.setSel(t.events[0].id);
 const h0=f.history.length,snap=JSON.stringify(f.store);
 f.confirmResult=true;f.ctx.deleteSelectedClips();
 assert.equal(JSON.stringify(f.store),snap,'任一预检失败整体零写入');
 assert.equal(f.history.length,h0);
 assert.ok(f.toasts.some(m=>/未删除/.test(m)));
});
test('summary window object from samePlace dispatches T3 via universal Delete',()=>{
 const f=fixture();f.setPath([[2,0,0],[9,5,0],[12,8,0]]);
 f.UI.openSamePlace(0,f.clip()); // 预填承接（干净）→ 窗口对象在摘要中
 f.confirmResult=true;f.ctx.deleteSelectedClips();
 assert.ok(f.confirms.some(m=>/重连/.test(m)));
 assert.deepEqual(f.M.nodes(f.store,0).movement.map(v=>[Number(v.time),Number(v.x)]),[[2,0],[12,8]]);
 assert.equal(f.UI.samePlaceActive(),false,'被删对象的会话关闭');
 assert.equal(f.history.length,1);
});

console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
