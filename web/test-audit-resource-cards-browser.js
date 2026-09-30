// 网页整改资源卡回归：真实 CDP 指针/键盘；DOM 只读；HTTP(S) 全阻断。
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const dir=process.env.CHOREO_AUDIT_RESOURCE_EVIDENCE,entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
if(!dir||!path.isAbsolute(dir)||fs.existsSync(dir))throw Error('CHOREO_AUDIT_RESOURCE_EVIDENCE 需要全新绝对目录');
const profile=path.join(dir,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out={entry,checks:[],requests:[],errors:[],screenshots:[],control:'CDP Input.dispatchMouseEvent/Input.dispatchKeyEvent; DOM read only'};
let browser,ws,seq=0;const pending=new Map();
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function record(card,actual,resolved){out.checks.push({card,actual,resolved});console.log(card+' '+(resolved?'NOT_REPRODUCED':'REPRODUCED')+' '+JSON.stringify(actual))}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));out.screenshots.push(name+'.png')}
async function click(selector,index=0){
 const p=await ev(`(()=>{const n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();for(const f of [.1,.5,.9]){const x=r.left+r.width*f,y=r.top+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,buttons:1});await sleep(160);
}
async function key(key,code,vk){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk});await sleep(160)}
async function button(text,scope){const i=await ev(`Array.from(document.querySelectorAll(${JSON.stringify(scope+' button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(text)}))`);if(i<0)throw Error('Missing button '+text);await click(scope+' button',i)}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);if(!exe)throw Error('Chrome missing');
 browser=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1440,900','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(dir,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}if(!target)throw Error('Chrome DevTools missing');
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')out.errors.push(m.params);if(m.method==='Fetch.requestPaused'){out.requests.push(m.params.request.url);send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(e=>out.errors.push({route:e.message}))}};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!browser)return;const p=browser,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));if(ws)send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);out.chromeExit=p.exitCode;for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();if(ws)ws.close()}
(async()=>{try{
 await open();
 await click('#toolsBtn');await until('!!document.querySelector("#toolsPage .lib-panel")');
 const pack=await ev('({top:!!document.querySelector("#toolsPage .lib-panel > .lib-offline-pack"),xat:!!document.querySelector("#toolsPage .lib-panel details.xat-convert"),text:document.querySelector("#toolsPage .lib-offline-pack")?.textContent.slice(0,110)})');
 record('U05',pack,pack.top);await shot('resources');
 await click('#toolsPage .lib-panel details summary');
 const wording=await ev('({text:document.querySelector("#toolsPage .lib-panel")?.textContent.match(/.{0,25}(?:单条目|多条目|单 entry|多 entry).{0,25}/g)?.slice(0,12),titles:[...document.querySelectorAll("#toolsPage .lib-panel [title]")].map(n=>n.title).filter(t=>/entry|条目/.test(t))})');
 record('T07',wording,!JSON.stringify(wording).includes(' entry'));await shot('xat-expanded');
 await button('从插件导入全部动作','#toolsPage');await until('document.querySelector("#toolsPage .lib-result")?.textContent.includes("导入失败")');
 const error=await ev('document.querySelector("#toolsPage .lib-result").textContent');record('T03',error,!error.includes('Failed to fetch')&&error.includes('无法连接游戏插件'));await shot('offline-import');
 await click('#toolsClose');await until('!document.getElementById("toolsCenterModal")');
 await button('项目','.toolbar-nav');await until('!!document.getElementById("projectCenterModal")');
 await click('#projectHistoryFold summary');await button('给当前项目存个版本','#projectCenterModal');
 await until('Array.from(document.querySelectorAll("#projectCenterModal button")).some(n=>n.textContent.includes("复制为新项目"))');
 const project=await ev('({close:document.getElementById("projectCenterClose")?.textContent,summary:document.querySelector("#projectHistoryFold summary")?.textContent,button:[...document.querySelectorAll("#projectCenterModal button")].map(n=>n.textContent).filter(t=>t.includes("复制为新项目")),sizes:[...document.querySelectorAll("#projectCenterModal span")].map(n=>n.textContent).filter(t=>t.includes("约 ")),resourceText:document.querySelector("#projectCenterModal")?.textContent.match(/.{0,30}(?:歌曲引用|音乐引用|原歌曲|音乐文件).{0,30}/g)})');
 record('T12',project,project.summary?.includes('复制为新项目')&&project.button.includes('复制为新项目'));record('T11',project,project.sizes.some(t=>/约 (?:[\d.]+ B|[\d.]+ KB)/.test(t))&&!project.sizes.some(t=>t.includes('0.0MB')));record('U01-close-control',project,project.close==='关闭');await shot('project');
 record('T14-project',project.resourceText,!JSON.stringify(project.resourceText).includes('歌曲引用')&&!JSON.stringify(project.resourceText).includes('原歌曲')&&!JSON.stringify(project.resourceText).includes('歌曲文件'));
 const focusBefore=await ev('({tag:document.activeElement?.tagName,id:document.activeElement?.id,inside:!!document.activeElement?.closest("#projectCenterModal")})');
 await key('Escape','Escape',27);const esc=await ev('!document.getElementById("projectCenterModal")');record('U01-Escape',{esc,focusBefore},esc);
 if(!esc)await click('#projectCenterClose');
 await button('项目','.toolbar-nav');await until('!!document.getElementById("projectCenterModal")');await click('#projectSearch');await key('Escape','Escape',27);
 const inputEsc=await ev('!document.getElementById("projectCenterModal")');record('U01-input-Escape',inputEsc,inputEsc);if(!inputEsc)await click('#projectCenterClose');
 await button('项目','.toolbar-nav');await until('!!document.getElementById("projectCenterModal")');await click('#projectCenterClose');
 record('U01-repeat-close',await ev('!document.getElementById("projectCenterModal")'),await ev('!document.getElementById("projectCenterModal")'));
 if(await ev('document.getElementById("musicToggle").getAttribute("aria-expanded")!=="true"'))await click('#musicToggle');
 await until('document.getElementById("musicToggle").getAttribute("aria-expanded")==="true"');
 const music=await ev('Object.fromEntries(["musicPlay","musicPause","musicResume","musicStop"].map(id=>{const n=document.getElementById(id);return [id,{disabled:n.disabled,visible:!!n.getClientRects().length,title:n.title}]}))');
 record('U04',music,music.musicPlay.disabled&&music.musicPause.disabled&&music.musicResume.disabled&&music.musicStop.visible);await shot('music');
 }catch(e){out.fatal={message:e.message,stack:e.stack};console.error(e)}finally{await close();const files=['choreo-library-ui.js','choreo-xat-convert-ui.js','choreo-project-ui.js','choreo-music-ui.js'];out.hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(entry),f))).digest('hex')]));fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(out,null,2));process.exitCode=out.fatal||out.checks.some(c=>!c.resolved)||out.requests.length||out.errors.length?1:0}})();
