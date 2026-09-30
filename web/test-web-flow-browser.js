// 网页主流程收口：隔离、合成、真实指针输入回归；DOM/状态只读断言不冒充人工验收。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_FLOW_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_FLOW_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(process.env.CHOREO_FLOW_SOURCE || __dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0,ordinary:0};
let expectedPrompt=null;const dialogs=[];
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params);if(expectedPrompt!==null){const text=expectedPrompt;expectedPrompt=null;send('Page.handleJavaScriptDialog',{accept:true,promptText:text}).catch(e=>errors.push({dialog:e.message}));}else send('Page.handleJavaScriptDialog',{accept:false}).catch(()=>{});}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
// 真实键盘输入：点中→Ctrl+A→insertText（触发 input 事件）
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function key(code,vk,keyName){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:keyName||code,code,windowsVirtualKeyCode:vk});await sleep(120)}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function clickClip(id){
 // 窗口化渲染只保留可见片段：目标被滚出窗口时先滚回它，等节点重建后再点（真实指针）
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id));
}
async function rulerPoint(t){return ev(`(()=>{const wrap=document.getElementById('timelineWrap'),r=document.querySelector('#ruler');if(!wrap||!r)throw Error('ruler missing');const calc=()=>{const rr=r.getBoundingClientRect();return {x:rr.left+LABEL_W+${Number(t)}*store.pps,y:rr.top+rr.height/2}};let p=calc();const w=wrap.getBoundingClientRect();if(wrap.scrollTop!==0){wrap.scrollTop=0;p=calc()}if(p.x>w.right-6||p.x<w.left+LABEL_W+6){wrap.scrollLeft+=(p.x-(w.left+LABEL_W+6));p=calc()}const hit=document.elementFromPoint(p.x,p.y);if(!(hit&&hit.closest&&hit.closest('.ruler')))throw Error('ruler point not on ruler: '+(hit?hit.className:'null'));return p})()`).then(p=>{counts.select++;return p})}
// 点刻度进入「插在这里」：重绘竞态下最多重试 3 次，直到状态明确（非固定 sleep 断言）
async function enterInsert(t){for(let i=0;i<3;i++){await clickAt(await rulerPoint(t));for(let j=0;j<20;j++){if(await ev('window.ChoreoWorkbench.insertAt()==='+Number(t)).catch(()=>false))return;await sleep(50)}}throw Error('insert mode not entered at '+t)}
const stopVisible=`(function(){var b=document.getElementById('immediateStop');if(!b)return false;var r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+1})()`;
async function button(text,scope='body',kind='nav'){
 const idx=await ev(`Array.from(document.querySelectorAll(${JSON.stringify(scope+' button')})).findIndex(n=>n.textContent.includes(${JSON.stringify(text)}))`);
 if(idx<0)throw Error('button missing '+text);await click(scope+' button',idx,kind);
}
const hitStop=`(()=>{const b=document.getElementById('immediateStop'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
const times=()=>ev('store.dancers[0].actionClips.map(c=>({id:c.id,start:c.start,duration:c.duration}))');
(async()=>{try{
 await open();
 await button('项目','.toolbar-nav');await until('!!document.getElementById("projectCenterModal")');
 expectedPrompt='合成观察—网页主流程收口';counts.input++;counts.ordinary++;
 await button('新建项目','#projectCenterModal');
 await until('store.projectName==="合成观察—网页主流程收口"&&!document.getElementById("projectCenterModal")');
 check('native new-project prompt submits synthetic name',dialogs.some(d=>d.type==='prompt'&&d.message.includes('新项目')));
 await click('#wbEmptyStart',0,'nav');await until('!!document.querySelector(".act-item .ai-name")');
 await click('.act-item .ai-name',0);await until('store.dancers[0].actionClips.length===1');
 await click('.act-item .ai-name',0);await until('store.dancers[0].actionClips.length===2');
 const before=await times(),id=before[1].id;
 await clickClip(id);await until('!!document.getElementById("wbCtxWait")');
 check('duration is visible without advanced expansion',await ev('!document.getElementById("wbCtxDurEdit").closest("details")'));
 await type('#wbCtxWait','1');await type('#wbCtxDurEdit','4');
 check('typing and blur leave timeline unchanged',JSON.stringify(await times())===JSON.stringify(before));
 await click('#wbCtxTimeCancel',0,'ordinary');
 check('cancel restores draft and leaves timeline unchanged',JSON.stringify(await times())===JSON.stringify(before)&&await ev('document.getElementById("wbCtxWait").value==="0"'));
 await type('#wbCtxWait','1');await type('#wbCtxDurEdit','4');await click('#wbCtxTimeApply',0,'ordinary');
 await until('store.dancers[0].actionClips[1].duration===4');
 const after=await times();check('apply changes only selected clip and preserves first clip',after[1].start===before[1].start+1&&after[1].duration===4&&JSON.stringify(after[0])===JSON.stringify(before[0]));
 await click('button[title^="撤销上一步编辑"]',0,'ordinary');await until('store.dancers[0].actionClips[1].duration===3');
 check('single undo restores both fields',JSON.stringify(await times())===JSON.stringify(before));
 await click('#wbAddDancer',0,'ordinary');await until('store.dancers.length===2');await clickClip(id);
 check('selected dancer and distinct add target are explicit',await ev('document.querySelector("#wbCtx .wb-ctx-name").textContent.includes(store.dancers[0].name)&&document.getElementById("wbAddTarget").textContent.includes(store.dancers[1].name)'));
 check('single selection has one time entry and no duplicate transport delete',await ev('document.querySelectorAll("#editClipTime").length===1&&!Array.from(document.querySelectorAll(".transport button")).some(n=>/编辑时间|删除/.test(n.textContent))'));
 const clipP=await clipPoint(id);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...clipP,button:'right',clickCount:1});
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 const timeIndex=await ev('Array.from(document.querySelectorAll("#ctxMenu .ctx-it")).findIndex(n=>n.textContent==="编辑时间…")');
 await click('#ctxMenu .ctx-it',timeIndex,'nav');await until('!!document.getElementById("clipTimeModal")');
 await type('#clipTimeStart','9');await click('#clipTimeCancel',0,'ordinary');
 check('right-click precision dialog preserved and cancel does not mutate',JSON.stringify(await times())===JSON.stringify(before));
 await shot('selected-wide');step('draft edit and actor context',{before,after});
 await click('#wbCtxRehearse',0,'ordinary');await until('store.isPlaying===true');
 await ev('window.__flowStopNode=document.getElementById("immediateStop")');
 await button('游戏连接 / 结果','.immediate-stop-bar');await until('!!document.querySelector("dialog[open]")');
 check('game preparation keeps exact existing stop node reachable',await ev(hitStop)&&await ev('document.getElementById("immediateStop")===window.__flowStopNode'));
 await shot('game-prepare-stop');await click('#immediateStop',0,'ordinary');await until('store.isPlaying===false');
 check('same stop button works during native modal web rehearsal',await ev('!store.isPlaying&&!!document.querySelector("dialog[open]")'));
 await button('关闭','dialog[open]','ordinary');await until('!document.querySelector("dialog[open]")');
 check('stop restored after modal closes',await ev('document.getElementById("immediateStop").parentNode.parentNode===document.body')&&await ev(hitStop));
 // Immediate stop intentionally preserves playhead/range; normal web Stop exits local rehearsal.
 await click('.toolbar button[title^="停止"]',0,'ordinary');await until('store.loopA==null&&store.loopB==null');
 await button('游戏演出','.toolbar');await until('!!document.querySelector("dialog[open]")');
 check('whole-show check also keeps stop reachable',await ev(hitStop));await shot('game-check-stop');
 await button('关闭','dialog[open]','ordinary');await until('!document.querySelector("dialog[open]")');
 await send('Emulation.setDeviceMetricsOverride',{width:640,height:800,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===640');
 // Resize may rebuild the shell; reselect through the clip UI if necessary.
 await clickClip(id);await until('!!document.getElementById("wbCtxDurEdit")');
 check('640px selected editor has usable height',await ev('document.getElementById("wbCtxHost").getBoundingClientRect().height>=190'));
 check('640px entire editor fits inside timeline without parent clipping',await ev('document.getElementById("wbCtxHost").getBoundingClientRect().bottom<=document.querySelector(".tl-area").getBoundingClientRect().bottom+1'));
 check('640px wait duration apply are visible and hit-testable',await ev(`['wbCtxWait','wbCtxDurEdit','wbCtxTimeApply'].every(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect();return r.top>=36&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})`));
 await shot('selected-640');step('640px selected editor');
 await click('#wbCtxMove',0,'nav');await until('!!document.getElementById("wbMoveBar")');
 await point('#wbMoveCancel',0,'nav');
 check('640px placement canvas retains usable height',await ev('document.getElementById("wbTopView").getBoundingClientRect().height>=180'));
 await shot('move-640');await click('#wbMoveCancel',0,'ordinary');
 await until('!!document.getElementById("wbCtxDurEdit")');
 await click('#editClipTime',0,'nav');await type('#wbCtxStartEdit','8');await click('#wbCtxTimeCancel',0,'ordinary');
 check('precise time entry uses same cancellable draft',JSON.stringify(await times())===JSON.stringify(before));
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('#wbCtxRehearse',0,'ordinary');await until('store.isPlaying===true');
 check('local rehearsal starts web playback only',await ev('store.previewTarget==="web"&&store.loopA!=null&&store.loopB!=null'));
 await click('.toolbar button[title^="停止"]',0,'ordinary');await until('store.isPlaying===false');
 check('normal web stop exits rehearsal and resets playhead',await ev('!store.isPlaying&&store.currentTime===0&&store.loopA==null&&store.loopB==null'));
 check('no JS exceptions',errors.length===0);
 await shot('final-stopped');json('checks',checks);json('counts',counts);json('steps',steps);json('errors',errors);json('requests',requests);json('dialogs',dialogs);
 }catch(e){json('failure',{message:e.message,stack:e.stack});json('checks',checks);json('errors',errors);json('requests',requests);await shot('failure').catch(()=>{});console.error(e);process.exitCode=1}
 finally{await close()}})();
