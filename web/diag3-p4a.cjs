// P4-A 诊断3（重写）：逐步复现 type('#wbCtxGearSlot','3')
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const evi=path.resolve('.agent/evidence/TASK-20260919-UI-OVERHAUL/p4-a/diag3');
fs.rmSync(evi,{recursive:true,force:true});fs.mkdirSync(evi,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome,ws,seq=0;const pending=new Map(),errors=[];
function send(method,params){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params:params||{}}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
const ST='(function(){var s=document.getElementById("wbCtxGearSlot"),p=document.getElementById("wbCtxGearPreview");return JSON.stringify({v:s&&s.value,active:document.activeElement&&(document.activeElement.id||document.activeElement.tagName),pv:p&&p.textContent.slice(0,40)})})()';
(async()=>{
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
 const profile=path.join(evi,'profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params)};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 await ev('(function(){var d=store.dancers[0];d.actionClips.push({id:store.nextClipId++,start:0,duration:3,data:{name:"A",command:"/bow motion",category:"action"}});d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"S1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 const swId=await ev('store.dancers[0].switchClips[0].id');
 async function st(tag){console.log(tag,await ev(ST))}
 const clipExpr='(function(){var n=(_clipNodes['+swId+']||[]).filter(function(n){return n.isConnected})[0];n.scrollIntoView({block:"center",inline:"center"});var r=n.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}})()';
 const cp=await ev(clipExpr);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:cp.x,y:cp.y,button:'left',clickCount:1});
 await sleep(200);await until('document.getElementById("wbCtxGearSlot")');await st('s0-selected ');
 // 挂钩：记录上下文栏重建的调用栈
 await ev('(function(){window.__p4aLogs=[];var orig=window.refreshWorkbenchBars;window.refreshWorkbenchBars=function(){window.__p4aLogs.push({fn:"refreshWorkbenchBars",stack:(new Error()).stack.split("\\n").slice(1,6).join("|")});return orig.apply(this,arguments)};var origRender=window.render;window.render=function(){window.__p4aLogs.push({fn:"render",stack:(new Error()).stack.split("\\n").slice(1,8).join("|")});return origRender.apply(this,arguments)}})()');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await sleep(40);
 const pt=await ev('(function(){var n=document.getElementById("wbCtxGearSlot");n.scrollIntoView({block:"center",inline:"nearest"});var r=n.getBoundingClientRect(),l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;var fr=[.05,.2,.5,.8,.95];for(var i=0;i<fr.length;i++){var x=l+(rr-l)*fr[i],y=r.y+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x:x,y:y}}return {none:true,rect:{l:r.left,r:r.right,t:r.top,b:r.bottom}}})()');
 console.log('point:',JSON.stringify(pt));
 if(pt.none){
  console.log('GEO:',await ev('(function(){function g(id){var n=document.getElementById(id);if(!n)return null;var r=n.getBoundingClientRect();var cs=getComputedStyle(n);return {t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),sh:n.scrollHeight,ch:n.clientHeight,ov:cs.overflow+"/"+cs.overflowY,flex:cs.flexShrink}}return JSON.stringify({tl:g("tlArea")||document.querySelector(".tl-area")&&g.call&&null,tlArea:(function(){var n=document.querySelector(".tl-area");var r=n.getBoundingClientRect();var cs=getComputedStyle(n);return {t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),ov:cs.overflow+"/"+cs.overflowY}})(),ctxHost:g("wbCtxHost"),ctx:g("wbCtx"),input:g("wbCtxGearSlot"),vh:innerHeight})})()'));
  chrome.kill();process.exit(2);
 }
 await st('s1-moved    ');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:pt.x,y:pt.y,button:'left',clickCount:1});
 await sleep(140);await st('s2-clicked  ');
 console.log('focus-ensure:',await ev('(function(){var n=document.querySelector("#wbCtxGearSlot");if(n&&document.activeElement!==n)n.focus();return document.activeElement===n})()'));
 await st('s3-focused  ');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await sleep(60);await st('s4-ctrlA    ');
 await send('Input.insertText',{text:'3'});
 await sleep(200);await st('s5-inserted ');
 console.log('p4aLogs:',JSON.stringify(await ev('window.__p4aLogs||[]')));
 console.log('exceptions:',errors.length?JSON.stringify(errors.map(function(e){return e.exceptionDetails&&e.exceptionDetails.exception&&e.exceptionDetails.exception.description}).slice(0,5)):'none');
 chrome.kill();process.exit(0);
})().catch(e=>{console.error('DIAG-FAIL',e.message);chrome&&chrome.kill();process.exit(1)});
