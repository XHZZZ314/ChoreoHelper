// 走/跑移动模式一次性浏览器冲烟（TASK-20260919-PATH-LOCOMOTION）：走位面板逐行选择、2D 编辑态选择、
// 新增节点默认走、面板↔2D 显示一致、如实文案（预览不区分走/跑动画）、纯函数审阅数据带模式与矛盾提示。
// 一次性资料（非固定验收资料），HTTP(S) 全阻断，不触碰真实工程/私人资产/游戏端点；
// 审阅计划 summary 的完整文案组装依赖插件连接（本探针离线），其数据面以 ChoreoStageGamePlan.review 纯调用覆盖。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_LOCO_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_LOCO_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry='D:/choreohelper/web/dist/ChoreoHelper/choreo-helper-app.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(exe));
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1500,1000','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 json('started',{pid:chrome.pid,profile:'disposable-in-evidence'});
 let target;for(let i=0;i<200&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function click(selector,index=0){const p=await ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});let r=n.getBoundingClientRect();for(const f of [.5,.85,.98,.2]){let x=r.x+r.width*f,y=r.y+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function fill(label,text){await click('input[aria-label="'+label+'"]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text})}
async function btn(text){await sleep(150);const i=await ev(`Array.from(document.querySelectorAll('.stage-motion-editor button')).findIndex(b=>b.textContent===${JSON.stringify(text)})`);assert.ok(i>=0,text);await click('.stage-motion-editor button',i)}
(async()=>{try{
 await open();
 check('一次性资料空店启动',await ev('store.dancers.length>=1'));
 // 1) 走位面板：数值表逐行「移动」select，默认走路；节点1 选跑步、节点2 保持走路。
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 await ev('document.querySelector(".stage-motion-tables").open=true');
 check('说明折叠区含如实文案（预览不区分走/跑动画）',await ev('(function(){var t=document.querySelector(".stage-motion-notes").textContent;return t.includes("不区分走/跑动画")&&t.includes("默认走路")})()'));
 await btn('添加路径节点');
 check('新路径节点「移动」列默认走路',await ev('(function(){var s=document.querySelectorAll(".stage-motion-editor tbody tr")[0].querySelector("select");return s&&s.value==="walk"&&s.textContent.includes("走路")&&s.textContent.includes("跑步")})()'));
 await fill('路径节点1 到达秒','2');await fill('路径节点1 X','1');await fill('路径节点1 Z','0');
 await ev('document.querySelectorAll(".stage-motion-editor tbody tr")[0].querySelector("select").value="run"');
 await btn('添加路径节点');
 await fill('路径节点2 到达秒','4');await fill('路径节点2 X','1');await fill('路径节点2 Z','1');
 check('第二行仍默认走路（逐节点独立）',await ev('document.querySelectorAll(".stage-motion-editor tbody tr")[1].querySelector("select").value==="walk"'));
 await btn('应用走位编排');await until('!document.querySelector(".stage-motion-editor")');
 check('跑步节点入库带 move 键、走路节点不带（旧形状）',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).movement)')===JSON.stringify([{time:'2',x:'1',z:'0',move:'run'},{time:'4',x:'1',z:'1'}]));
 await ev('persistProject()');await sleep(300);
 // 2) 面板重开：draft 显示与库一致（数值面板 ↔ 数据）。
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 await ev('document.querySelector(".stage-motion-tables").open=true');
 check('重开面板 select 反映各节点模式',await ev('(function(){var rows=document.querySelectorAll(".stage-motion-editor tbody tr");var a=rows[0].querySelector("select"),b=rows[1].querySelector("select");return a.value==="run"&&b.value==="walk"})()'));
 await sleep(400);
 check('面板指标行走/跑标注',await ev('(function(){var n=document.querySelector(".stage-game-boundary");return n&&n.textContent.includes("跑步")&&n.textContent.includes("走路")})()'));
 await ev('Array.from(document.querySelectorAll(".stage-motion-editor button")).find(b=>b.textContent==="取消").click()');
 // 3) 2D 编辑态：选中跑步节点出「移动」select 且值一致；改走路即单事务提交；节点 title 标注模式。
 await ev('ChoreoStageUI.openStage()');await until('document.getElementById("stageDragModal")');
 await ev('(function(){Array.from(document.querySelectorAll(".stage-pathtoggle")).find(b=>b.textContent.includes("走位路径")).click();return true})()');await sleep(300);
 check('跑步节点 title 标注模式',await ev('(function(){var b=document.querySelector(".stage-pathnode");return b&&b.title.includes("跑步")})()'));
 const p0=await ev('(function(){var n=document.querySelector(".stage-pathnode");var r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p0.x,y:p0.y,button:'left',clickCount:1});await sleep(300);
 check('选中节点行显示模式且 select=run',await ev('(function(){var s=document.querySelector(".stage-path-move");var xy=document.querySelector(".stage-path-xy").textContent;return s&&s.value==="run"&&xy.includes("跑步")})()'));
 const hBefore=await ev('store.historyIdx');
 await ev('document.querySelector(".stage-path-move").value="walk";document.querySelector(".stage-path-move").dispatchEvent(new Event("change"))');await sleep(300);
 check('2D 改走路=单事务提交（一次撤销）',await ev('ChoreoStageMotion.nodes(store,0).movement[0].move===undefined&&store.historyIdx==='+hBefore+'+1'));
 await ev('document.querySelector(".stage-path-move").value="run";document.querySelector(".stage-path-move").dispatchEvent(new Event("change"))');await sleep(300);
 check('2D 改回跑步（select 双向可用）',await ev('ChoreoStageMotion.nodes(store,0).movement[0].move==="run"'));
 // 2D 点画布新增节点默认走路（播放头 6 秒）。
 await ev('store.currentTime=6');
 const cp=await ev('(function(){var s=document.getElementById("stageSurface").getBoundingClientRect();var su=document.getElementById("stageSurface");var cl=su.clientLeft||0,ct=su.clientTop||0;var fr=[[.7,.35],[.25,.75],[.6,.8],[.2,.25],[.5,.5]];for(var i=0;i<fr.length;i++){var x=s.left+s.width*fr[i][0],y=s.top+s.height*fr[i][1];var hit=document.elementFromPoint(x,y);if(hit&&hit.closest&&hit.closest("button"))continue;return {x:Math.round(x),y:Math.round(y)}}throw Error("no empty canvas point")})()');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:cp.x,y:cp.y,button:'left',clickCount:1});await sleep(300);
 check('2D 点画布新增节点默认走路',await ev('(function(){var n=ChoreoStageMotion.nodes(store,0).movement;return n.length===3&&n[2].move===undefined})()'));
 await ev('ChoreoStageUI.closeStage(true)');
 // 4) 游戏面板说明折叠区含步态模式如实文案。
 await ev('ChoreoStageGameUI.open(0)');await until('document.querySelector("dialog[aria-label=\\"游戏单人路径\\"]")');
 check('游戏面板说明含走/跑自动切换与预览口径',await ev('(function(){var t=document.querySelector(".stage-game-intro").textContent;return t.includes("走路 / 跑步")&&t.includes("不区分走/跑动画")&&t.includes("stageLocomotionAutoV1")})()'));
 await ev('(function(){var bs=Array.from(document.querySelectorAll("dialog[aria-label=\\"游戏单人路径\\"] button"));var c=bs.find(b=>b.textContent==="关闭");if(c)c.click();return true})()');
 // 5) 纯函数审阅数据：points/segments 带模式 + 速度矛盾提示（离线等效数据面；summary 文案组装需连接，不在本探针）。
 const rev=await ev('(function(){var base=ChoreoEdit.pure.placementFor(store.dancers,0);return ChoreoStageGamePlan.review(store,0,base,{id:"123",territoryId:816,worldX:10,worldZ:20,rotationRad:0},0)})()');
 check('审阅数据逐点/逐段带模式',rev.points[1].move==='run'&&rev.points[2].move==='walk'&&rev.points[3].move==='walk'&&rev.segments.every(s=>typeof s.move==='string'));
 check('速度矛盾提示按档判定（当前各段均未超参考上限）',Array.isArray(rev.gaitWarnings)&&rev.gaitWarnings.length===0);
 const fast=await ev('(function(){var P=ChoreoStageMotion;var all=P.edit(store,0,{movement:[{time:"1",x:"3",z:"0"},{time:"4",x:"4",z:"0",move:"run"}],facing:[]},"probe");P.install(store,all);var base=ChoreoEdit.pure.placementFor(store.dancers,0);var r=ChoreoStageGamePlan.review(store,0,base,{id:"123",territoryId:816,worldX:10,worldZ:20,rotationRad:0},0);undo();return r})()');
 check('走路档 3 米/秒触发矛盾提示、跑步 1 米/秒不提示',fast.gaitWarnings.length===1&&fast.gaitWarnings[0].includes('3.00')&&fast.gaitWarnings[0].includes('走路'));
 check('全程零未捕获异常',errors.length===0);
 json('checks',checks);json('requests',requests);json('errors',errors);console.log('PASS disposable-profile locomotion smoke (NOT the fixed-profile acceptance)');
}catch(e){json('failure',{message:e.message,stack:e.stack});json('checks',checks);json('errors',errors);await shot('failure').catch(()=>{});console.error(e);process.exitCode=1}finally{await close();process.exit(process.exitCode||0)}})();
