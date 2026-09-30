// TASK-20260919-UI-OVERHAUL P1-C 旅程式浏览器探针：同处走位（基础）。选中动作→上下文栏「走位…」
// →舞台自动切俯视标签（时间轴保持可见）→俯视点目的地→到达时刻（默认=片段结束）＋走/跑（默认走路）
// →应用走位（立即保存+可撤销）/清除/取消（零改动）；走位片段呈现于走位轨（名称/时长/走跑）；时间轴
// 选择上下文保留。真实指针（CDP 真实鼠标/键盘），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，
// 一次性 throwaway 资料（不触真实工程/私人资产/游戏端点、不写 live）。证据目录由 CHOREO_MOVE_EVIDENCE
// 指定且必须全新。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_MOVE_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_MOVE_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}));if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{})};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 // R5：记录俯视画布实际送达指针（click clientX/Y 整数），容差按实际指针坐标证明
 await ev('(function(){var cv=document.getElementById("wbTopView");window.__topClicks=[];if(cv)cv.addEventListener("click",function(e){window.__topClicks.push({x:e.clientX,y:e.clientY})});return true})()');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function key(k,code,vk){for(const t of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:t,key:k,code,windowsVirtualKeyCode:vk});await sleep(80)}
// 真实键盘切换两态 <select>：点击（可能开下拉）→ ArrowDown → Enter 提交（闭合态 ArrowDown 也直接改选）
async function selectNext(selector){
 await click(selector,0,'select');
 for(let i=0;i<3;i++){
  await key('ArrowDown','ArrowDown',40);
  await key('Enter','Enter',13);
  const v=await ev('document.querySelector('+JSON.stringify(selector)+').value');
  if(v==='run')return v;
 }
 throw Error('select keyboard switch failed');
}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function clickClip(id){
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id));
}
// 俯视世界坐标→画布像素，真实指针点击（须落在画布可见范围内；CSS 盒与画布属性尺寸按比例映射）。
// R5：前向映射与产品 topWorldAt 同口径＝内容盒（扣边框，不再用边框盒）；指针事件 clientX/Y 为
// 整数（截断至 1px）→ 返回实际送达指针与按其反算的期望世界坐标，容差由实际指针证明而非放宽。
async function clickTopWorld(x,z){
 const t=await ev('ChoreoWorkbench.topViewTransform()');
 if(!t||!(t.sc>0)||!(t.w>0)||!(t.h>0))throw Error('top view transform missing '+JSON.stringify(t));
 const r=await ev('(function(){var b=document.getElementById("wbTopView");var rc=b.getBoundingClientRect();var cs=getComputedStyle(b);var bl=parseFloat(cs.borderLeftWidth)||0,bt=parseFloat(cs.borderTopWidth)||0;return {l:rc.left+bl,t:rc.top+bt,w:rc.width-bl-(parseFloat(cs.borderRightWidth)||0),h:rc.height-bt-(parseFloat(cs.borderBottomWidth)||0)}})()');
 const px=r.l+r.w*(0.5+x*t.sc/t.w),py=r.t+r.h*(0.5+z*t.sc/t.h);
 if(px<r.l+4||px>r.l+r.w-4||py<r.t+4||py>r.t+r.h-4)throw Error('dest ('+x+','+z+') outside canvas: '+JSON.stringify({t,r,px,py}));
 counts.select++;await clickAt({x:px,y:py});
 const seen=await ev('(window.__topClicks&&window.__topClicks[window.__topClicks.length-1])||null');
 return {x:Math.round(x*100)/100,z:Math.round(z*100)/100,kx:(t.w/r.w)/t.sc,kz:(t.h/r.h)/t.sc,
  want:{x,z},sent:[px,py],seen:seen?{x:seen.x,y:seen.y}:null,
  expectedFromSeen:seen?{x:((seen.x-r.l)/r.w*t.w-t.w/2)/t.sc,z:((seen.y-r.t)/r.h*t.h-t.h/2)/t.sc}:null};
}
const pxTol=k=>0.006+1.05*k; // 量化±0.005＋1px 指针整数截断
const moveTracks=()=>ev('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];if(!t)return null;var e=t.events[0];return {dur:e.durationMs,points:e.data.stageMotion.points.map(function(p){return {t:p.tMs,x:p.x,z:p.z,move:p.move===\'run\'?\'run\':\'walk\'}})}})()');
const tracksJson=()=>ev('JSON.stringify(ChoreoStageMotion.tracks(store))');
(async()=>{try{
 await open();
 // ---------- S0 空态→从零开始→按顺序添加两个动作 ----------
 await until('document.getElementById("wbEmpty")');
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".tl-area")&&document.querySelector(".act-item")');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===2');
 const clips=await ev('(function(){var a=store.dancers[0].actionClips.slice().sort(function(x,y){return x.start-y.start});return a.map(function(c){return {id:c.id,name:c.data.name,start:c.start,dur:c.duration}})})()');
 check('P1C-0 按顺序添加两个动作（第二个=第一个结束）',clips.length===2&&clips[0].start===0&&Math.abs(clips[1].start-(clips[0].start+clips[0].dur))<1e-9);
 await shot('s0-two-clips');step('S0 两动作',{clips:clips});
 // ---------- S1 上下文栏「走位…」→舞台自动切俯视标签（时间轴保持可见）----------
 await click('#wbTab3d',0,'nav'); // 先显式回到 3D，验证自动切换
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtxMove")');
 check('P1C-1 选中动作→上下文栏出现「走位…」（1 击进入）',await ev('document.getElementById("wbCtxMove").textContent==="走位…"'));
 const before=await tracksJson();
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 check('P1C-1 舞台自动切俯视标签（时间轴保持可见）',await ev('document.getElementById("wbTabTop").classList.contains("on")&&!document.getElementById("wbTopHost").hidden&&document.getElementById("timelineWrap").getBoundingClientRect().width>100'));
 check('P1C-1 走位条标题=舞者名＋为「动作」排走位＋出发时刻（first-macro-journey J5）',await ev('document.getElementById("wbMoveTitle").textContent===(store.dancers[0].name+" · 为「'+clips[0].name+'」排走位")&&document.querySelector("#wbMoveBar .wb-move-sub").textContent==="'+clips[0].start+'s 出发"'));
 const end1=Math.round((clips[0].start+clips[0].dur)*1000)/1000;
 check('J5 主字段移动用时默认=片段时长，同区显示到达',await ev('Number(document.getElementById("wbMoveDur").value)==='+clips[0].dur+'&&document.getElementById("wbMoveEta").textContent.indexOf("到达 "+'+end1+'+"s")>=0'));
 check('P1C-2 到达时刻默认=片段结束（'+end1+'s）',await ev('Number(document.getElementById("wbMoveArrival").value)==='+end1));
 check('P1C-2 走/跑默认=走路',await ev('document.getElementById("wbMoveMode").value==="walk"&&document.getElementById("wbMoveMode").selectedOptions[0].textContent==="走路"'));
 await shot('s1-move-bar');step('S1 走位条',{arrivalDefault:end1});
 // ---------- S2 俯视点目的地（会话期点击=点目的地，不改选人/选择）----------
 const dest1=await clickTopWorld(1.2,-1);
 await until('ChoreoStageMotionUI.samePlaceState()&&ChoreoStageMotionUI.samePlaceState().dest');
 const st1=await ev('ChoreoStageMotionUI.samePlaceState()');
 check('P1C-3 俯视点选目的地（≈'+dest1.x+', '+dest1.z+'，0.01 量化，容差=1px 指针精度）',Math.abs(st1.dest.x-1.2)<=pxTol(dest1.kx)&&Math.abs(st1.dest.z+1)<=pxTol(dest1.kz));
 // R5（正向内容盒口径＋实际指针证明）：送达指针与意图≤1px 截断；落点与按实际指针反算的期望
 // 世界坐标之差只剩 0.005 量化＋浮点 ε——证明映射正确，容差不吸收映射误差
 check('R5 送达指针＝意图点整数截断（≤1px，内容盒口径）',!!dest1.seen&&Math.abs(dest1.seen.x-dest1.sent[0])<1&&Math.abs(dest1.seen.y-dest1.sent[1])<1);
 check('R5 按实际指针反算：落点差≤0.0055（仅量化＋浮点）',!!dest1.expectedFromSeen&&Math.abs(st1.dest.x-dest1.expectedFromSeen.x)<=0.0055&&Math.abs(st1.dest.z-dest1.expectedFromSeen.z)<=0.0055);
 const wantDest1='已选目的地 ('+st1.dest.x+', '+st1.dest.z+')';
 check('P1C-3 提示已选目的地坐标',(await ev('document.getElementById("wbMoveHint").textContent')).indexOf(wantDest1)>=0);
 check('P1C-3 会话期点击不改当前舞者/选中片段',await ev('store.selectedDancer===0&&store.selectedClip&&store.selectedClip.id==='+clips[0].id));
 // ---------- S3 切换跑步（真实键盘）----------
 await selectNext('#wbMoveMode');
 check('P1C-2 可切跑步',await ev('document.getElementById("wbMoveMode").value==="run"'));
 await shot('s2-dest-run');
 // ---------- S4 应用走位：立即保存＋走位轨呈现＋时间轴上下文保留 ----------
 await click('#wbMoveApply',0,'confirm');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !!t})()');
 const applied=await moveTracks();
 check('P1C-4 应用=立即保存：从 0s（隐式出发位）到片段结束 '+end1+'s，跑步节点',applied.dur===Math.round(end1*1000)&&applied.points.length===1&&applied.points[0].t===Math.round(end1*1000)&&applied.points[0].x===st1.dest.x&&applied.points[0].z===st1.dest.z&&applied.points[0].move==='run');
 check('P1C-4 走位片段呈现于走位轨（名称/时长/走跑）',await ev('(function(){var b=document.querySelector(".stage-motion-clip");return !!b&&b.textContent.indexOf("走位")>=0&&b.textContent.indexOf("'+end1+'s")>=0&&b.textContent.indexOf("跑步")>=0})()'));
 check('P1C-4 应用后走位条收起、俯视提示恢复',await ev('!document.getElementById("wbMoveBar")&&document.querySelector(".wb-top-hint").textContent.indexOf("点舞者")>=0'));
 check('P1C-4 时间轴选择上下文保留（仍选中该动作，上下文栏在）',await ev('store.selectedClip&&store.selectedClip.id==='+clips[0].id+'&&!!document.getElementById("wbCtx")&&document.getElementById("wbCtx").textContent.indexOf("'+clips[0].name+'")>=0&&!!document.getElementById("wbCtxMove")'));
 await shot('s3-applied');step('S4 应用',{applied:applied});
 // ---------- S5 应用后撤销：一步回到应用前 ----------
 await click('button[title^="撤销上一步编辑"]',0,'nav');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !t})()');
 check('P1C-5 撤销一步清除走位（时间轴动作不受影响）',await ev('store.dancers[0].actionClips.length===2&&store.dancers[0].actionClips.some(function(c){return c.id==='+clips[0].id+'})')&&(await tracksJson())===before);
 check('P1C-5 撤销后走位轨无片段',await ev('!document.querySelector(".stage-motion-clip")'));
 // ---------- S6 取消（零改动）：点目的地+改到达+切模式后取消 ----------
 const before6=await tracksJson();
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 check('P1C-6 重开会话仍默认走路',await ev('document.getElementById("wbMoveMode").value==="walk"'));
 const dest2=await clickTopWorld(-1.2,0.8);
 await until('ChoreoStageMotionUI.samePlaceState()&&ChoreoStageMotionUI.samePlaceState().dest');
 const st2=await ev('ChoreoStageMotionUI.samePlaceState()');
 await click('#wbMoveMore>summary',0,'nav'); // J5：绝对到达收进「更多设置」，先展开再编辑
 await type('#wbMoveArrival','1');
 await selectNext('#wbMoveMode'); // 切跑步后再取消
 check('P1C-6 会话内已点目的地/改到达/切跑步',await ev('ChoreoStageMotionUI.samePlaceState().dest.x==='+st2.dest.x+'&&Number(document.getElementById("wbMoveArrival").value)===1&&document.getElementById("wbMoveMode").value==="run"')&&Math.abs(st2.dest.x+1.2)<=pxTol(dest2.kx));
 await click('#wbMoveCancel',0,'nav');
 await until('!document.getElementById("wbMoveBar")');
 check('P1C-6 取消=零改动（走位轨道字节不变）',(await tracksJson())===before6);
 await shot('s4-cancel-zero');step('S6 取消零改动');
 // ---------- S7 第二个动作（更晚开始）：补出发保持节点＋走路默认入库无 run 键 ----------
 await clickClip(clips[1].id);
 await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 const start2=Math.round(clips[1].start*1000)/1000,end2=Math.round((clips[1].start+clips[1].dur)*1000)/1000;
 const base=await ev('ChoreoEdit.pure.placementFor(store.dancers,0)');
 check('P1C-2 到达默认=第二个动作结束（'+end2+'s）',await ev('Number(document.getElementById("wbMoveArrival").value)==='+end2));
 const dest3=await clickTopWorld(1,1);
 await until('ChoreoStageMotionUI.samePlaceState()&&ChoreoStageMotionUI.samePlaceState().dest');
 const st3=await ev('ChoreoStageMotionUI.samePlaceState()');
 await click('#wbMoveApply',0,'confirm');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !!t})()');
 const applied2=await moveTracks();
 check('P1C-7 晚开始动作：先补出发保持节点（'+start2+'s 原地），再到 '+end2+'s；走路不入 run 键',applied2.points.length===2&&applied2.points[0].t===Math.round(start2*1000)&&applied2.points[0].x===base.x&&applied2.points[0].z===base.z&&applied2.points[1].t===Math.round(end2*1000)&&applied2.points[1].x===st3.dest.x&&applied2.points[1].z===st3.dest.z&&applied2.points[1].move==='walk');
 check('P1C-7 走位轨显示走路',await ev('(function(){var b=document.querySelector(".stage-motion-clip");return !!b&&b.textContent.indexOf("走路")>=0})()'));
 // ---------- S8 清除这条走位（同一窗口，含出发保持节点）＋撤销恢复 ----------
 await clickClip(clips[1].id);
 await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 await click('#wbMoveClear',0,'confirm');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !t})()');
 check('P1C-8 清除=移除本动作窗口内全部走位节点（轨道清空）',await ev('!document.querySelector(".stage-motion-clip")'));
 await click('button[title^="撤销上一步编辑"]',0,'nav');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !!t})()');
 check('P1C-8 清除可撤销恢复',await ev('(function(){var b=document.querySelector(".stage-motion-clip");return !!b})()'));
 await shot('s5-clear-undo');step('S8 清除+撤销');
 // ---------- S9 守卫：未点目的地/到达时刻非法→拒绝且零改动 ----------
 const before9=await tracksJson();
 await clickClip(clips[1].id);
 await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 await click('#wbMoveApply',0,'confirm');
 // B3 HF-06 后语义：窗口内有已排走位时打开即承接预填，未改直接应用＝no-op（提示「与当前保存的一致」）；
 // 无预填时仍是「请先在俯视图里点一个目的地」拒绝。两者都是零改动。
 await until('document.getElementById("wbMoveHint")&&(document.getElementById("wbMoveHint").textContent.indexOf("请先在俯视图里点一个目的地")>=0||document.getElementById("wbMoveHint").textContent.indexOf("与当前保存的一致")>=0)');
 check('P1C-9 未改预填/未点目的地→应用零改动（拒绝或 no-op）',(await tracksJson())===before9);
 await clickTopWorld(0.6,-0.6);
 await click('#wbMoveMore>summary',0,'nav'); // J5：绝对到达在「更多设置」内，先展开
 await type('#wbMoveArrival',String(start2)); // 到达=动作开始 → 非法
 await click('#wbMoveApply',0,'confirm');
 await until('document.getElementById("wbMoveHint").textContent.indexOf("晚于动作开始")>=0');
 check('P1C-9 到达时刻≤动作开始→应用被拒绝（零改动）',(await tracksJson())===before9);
 await click('#wbMoveCancel',0,'nav');
 await until('!document.getElementById("wbMoveBar")');
 check('P1C-9 守卫拒绝后取消仍零改动',(await tracksJson())===before9);
 await shot('s6-guards');step('S9 守卫');
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个');
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-props-ui.js','choreo-workbench.js','choreo-stage-motion-ui.js','choreo-macro-ui.js','choreo-bootstrap.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);
 console.log('\nSamePlaceMove: '+checks.length+' checks passed');
}catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
