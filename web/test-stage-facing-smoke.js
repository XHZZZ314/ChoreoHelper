// 独立朝向一次性浏览器冲烟：临时一次性资料（非固定验收资料），HTTP(S) 全阻断，不触碰真实工程/私人资产/游戏端点。
// 明确不是固定资料环境验收：固定 profile 当前在本任务文件系统视图不可见（见 CONTINUITY 阻断记录）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_FACING_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_FACING_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
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
 const dancers=await ev('store.dancers.length');
 // 1) 真实对话框双表编排：路径 2s 到 (1,0)，独立朝向 1s→90°、3s→180°（时刻与路点解耦）。
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 // TASK-20260918-PLAYER-UX-SIMPLIFY A2：数值表默认折叠（新契约），展开后按钮/输入仍按原口径可达。
 check('走位面板数值表默认折叠（A2 收纳）',await ev('(function(){var f=document.querySelector(".stage-motion-tables");var n=document.querySelector(".stage-motion-notes");return f&&!f.open&&n&&!n.open})()'));
 await ev('document.querySelector(".stage-motion-tables").open=true');
 await btn('添加路径节点');await fill('路径节点1 到达秒','2');await fill('路径节点1 X','1');await fill('路径节点1 Z','0');
 await btn('添加朝向节点');await fill('朝向节点1 到达秒','1');await fill('朝向节点1 朝向','90');
 await btn('添加朝向节点');await fill('朝向节点2 到达秒','3');await fill('朝向节点2 朝向','180');
 await shot('editor-decoupled');
 await btn('应用走位编排');await until('!document.querySelector(".stage-motion-editor")');
 check('解耦数据落库',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0))')===JSON.stringify({movement:[{time:'2',x:'1',z:'0'}],facing:[{time:'1',yaw:'90'},{time:'3',yaw:'180'}]}));
 check('泳道同时显示走位与朝向片段',await ev('document.querySelectorAll(".stage-motion-clip").length===2'));
 // 2) 采样与二维/文档一致；持久化到一次性资料后完整体面退出并离线重开。
 const sampled=await ev('ChoreoStageMotion.sample(store,0,2000,ChoreoEdit.pure.placementFor(store.dancers,0))');
 check('中段独立转身采样',Math.abs(sampled.x-1)<1e-9&&Math.abs(sampled.yawDeg-135)<1e-9);
 await ev('persistProject()');await sleep(400);
 await close();await open();
 check('离线重开恢复解耦朝向',await ev('store.dancers.length===('+dancers+')&&JSON.stringify(ChoreoStageMotion.nodes(store,0))')===JSON.stringify({movement:[{time:'2',x:'1',z:'0'}],facing:[{time:'1',yaw:'90'},{time:'3',yaw:'180'}]}));
 // 3) 纯朝向：删除路径节点后仅保留朝向轨。
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 await ev('document.querySelector(".stage-motion-tables").open=true'); // A2 收纳：重开后折叠复位，先展开再操作
 await btn('移除','');await shot('editor-facing-only');await btn('应用走位编排');await until('!document.querySelector(".stage-motion-editor")');
 check('纯朝向轨成立且阻断游戏播放',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0))')===JSON.stringify({movement:[],facing:[{time:'1',yaw:'90'},{time:'3',yaw:'180'}]})&&await ev('ChoreoStageMotion.blocksGame(store,0)===true'));
 check('朝向泳道片段保留',await ev('document.querySelectorAll(".stage-motion-clip").length===1&&document.querySelector(".stage-motion-clip").textContent.includes("朝向")'));
 json('checks',checks);json('requests',requests);json('errors',errors);console.log('PASS disposable-profile independent-facing smoke (NOT the fixed-profile acceptance)');
 }catch(e){json('failure',{message:e.message,stack:e.stack});json('checks',checks);json('requests',requests);json('errors',errors);await shot('failure').catch(()=>{});console.error(e);process.exitCode=1}finally{await close();process.exit(process.exitCode||0)}})();
