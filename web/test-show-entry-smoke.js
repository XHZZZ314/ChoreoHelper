// 统一演出入口一次性浏览器冲烟：临时一次性资料（非固定验收资料），HTTP(S) 全阻断，
// 不触碰真实工程/私人资产/游戏端点。只验证：工具栏统一入口打开整场检查页、打开零请求、
// 离线未知降级、日常播放被走位拦截后路由进统一入口、关闭零副作用。明确不是固定资料环境验收，
// 也不是游戏效果验收（见 CONTINUITY）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_SHOW_ENTRY_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_SHOW_ENTRY_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
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
async function clickText(text,scope='document'){const p=await ev(`(()=>{let n=Array.from(${scope==='dialog'?'document.querySelector("dialog[aria-label=\\"游戏演出整场检查\\"]")':'document'}.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)});if(!n)throw Error('Missing button '+${JSON.stringify(text)});n.scrollIntoView({block:'center'});let r=n.getBoundingClientRect();for(const f of [.5,.85,.98,.2]){let x=r.x+r.width*f,y=r.y+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(150)}
(async()=>{try{
 await open();
 check('一次性资料空店启动',await ev('store.dancers.length>=1'));
 check('离线状态如实',await ev('store.gameConnected===false'));
 check('统一入口模块已装载',await ev('typeof ChoreoShowEntry==="object"&&!!ChoreoShowEntry.open'));
 // 1) 工具栏统一入口：打开整场检查页（打开零请求）。
 await clickText('🎭 游戏演出');
 await until('Array.from(document.querySelectorAll("dialog h3")).some(h=>h.textContent.includes("游戏演出 · 整场检查"))');
 const body=()=>ev('Array.from(document.querySelectorAll("dialog")).map(d=>d.innerText).join("\\n")');
 let bt=await body();
 check('整场检查页打开',bt.includes('游戏演出 · 整场检查'));
 check('只读声明',bt.includes('不装载、不准备、不注册、不启动')&&bt.includes('打开本页不发送任何请求'));
 check('绑定展示（项目/编排版本/舞者）',bt.includes('本次检查绑定')&&bt.includes('编排版本')&&bt.includes('本机舞者'));
 check('本地计数展示',bt.includes('整场概览')&&bt.includes('事件：'));
 check('离线未知降级',bt.includes('插件连接与能力尚未读取'));
 check('无路径阻断并指路既有通道',bt.includes('走位轨道')&&bt.includes('日常游戏播放'));
 check('既有流程入口存在',bt.includes('进入现有准备与确认流程'));
 check('复盘边界文案',bt.includes('历史结果不授予再次开演权限'));
 await shot('show-entry-offline');
 // 2) 切换舞者选择不触发请求、不改动编排。
 await ev('(()=>{const s=document.querySelector("dialog select");s.value="0";s.onchange();return true})()');
 check('切换舞者后仍零请求',requests.length===0);
 // 3) 关闭对话框，进入流程按钮不在此页触发任何装载。
 await clickText('关闭','dialog');
 await sleep(200);
 check('关闭后对话框移除',await ev('!Array.from(document.querySelectorAll("dialog h3")).some(h=>h.textContent.includes("游戏演出 · 整场检查"))'));
 // 4) 日常游戏播放被走位/朝向拦截 → 自动路由进统一入口（离线也成立：拦截在连接检查之前）。
 await ev('ChoreoStageMotion.install(store,ChoreoStageMotion.edit(store,0,{movement:[{time:"4",x:"0",z:"0.36"}],facing:[]},"smoke"))');
 await ev('store.previewTarget="game"');
 await ev('typeof togglePlay==="function"?togglePlay():gameStartPlay()');
 await until('Array.from(document.querySelectorAll("dialog h3")).some(h=>h.textContent.includes("游戏演出 · 整场检查"))');
 bt=await body();
 check('拦截路由进统一入口',bt.includes('已从日常游戏播放转入'));
 check('路由后展示走位计数',bt.includes('走位 1'));
 await shot('show-entry-daily-blocked');
 await clickText('关闭','dialog');
 await sleep(200);
 // 5) 编排保全与零请求零错误。
 check('打开/关闭不改动用户编排',await ev('JSON.stringify(store.contentExtra._doc.extraTracks.length)')==='1');
 check('零网络请求（HTTP 全阻断且无自发请求）',requests.length===0);
 check('零页面错误',errors.length===0);
 await close();
 json('result',{checks,requests,errors:errors.map(e=>JSON.stringify(e)).slice(0,10),note:'一次性临时资料冲烟（非固定资料验收、非游戏效果验收）'});
 console.log('PASS unified show entry smoke: toolbar entry, zero-request open, offline unknown, daily-block routing（一次性资料，非验收）');
}catch(e){json('failure',{checks,requests,errors:errors.map(x=>JSON.stringify(x)).slice(0,10),error:String(e)});console.error(e);process.exitCode=1;await close().catch(()=>{})}})();
