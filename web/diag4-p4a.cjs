// P4-A 诊断4：右键切换条时 contextmenu 未触发的几何测量（复刻 P3 探针前态）
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const evi=path.resolve('.agent/evidence/TASK-20260919-UI-OVERHAUL/p4-a/diag4');
fs.rmSync(evi,{recursive:true,force:true});fs.mkdirSync(evi,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome,ws,seq=0;const pending=new Map(),errors=[];
function send(method,params){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params:params||{}}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
(async()=>{
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
 const profile=path.join(evi,'profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Input.dispatchMouseEvent')errors.push({mouse:m.params})};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 await ev('window.prompt=function(){return null}');
 // 复刻 P3 前态：两个动作＋一条切换条（同 P3 探针夹具）
 await ev('(function(){var d=store.dancers[0];d.actionClips.push({id:store.nextClipId++,start:0,duration:3,data:{name:"A1",command:"/bow motion",category:"action"}});d.actionClips.push({id:store.nextClipId++,start:3,duration:3,data:{name:"A2",command:"/wave motion",category:"action"}});d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"S1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 const swId=await ev('store.dancers[0].switchClips[0].id');
 await until('document.querySelector(".switch-lane .clip")');
 const GEO='(function(){var n=(_clipNodes['+swId+']||[]).filter(function(n){return n.isConnected})[0];if(!n)return "clip-node-missing";var r=n.getBoundingClientRect();var host=document.getElementById("wbCtxHost").getBoundingClientRect();var tl=document.querySelector(".tl-area").getBoundingClientRect();return JSON.stringify({clip:{t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left)},ctxHost:{t:Math.round(host.top),b:Math.round(host.bottom),h:Math.round(host.height)},tl:{t:Math.round(tl.top),b:Math.round(tl.bottom)}})})()';
 const cp=await ev('(function(){var n=(_clipNodes['+swId+']||[]).filter(function(n){return n.isConnected})[0];n.scrollIntoView({block:"center",inline:"center"});var r=n.getBoundingClientRect(),w=document.querySelector("#timelineWrap").getBoundingClientRect();return {x:Math.min(Math.max((r.left+r.right)/2,Math.max(r.left,w.left)+12),Math.min(r.right,innerWidth)-12),y:(r.top+r.bottom)/2}})()');
 console.log('before:',await ev(GEO),'pt:',JSON.stringify(cp));
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...cp,button:'right',clickCount:1});
 await sleep(80);
 console.log('after-mousedown:',await ev(GEO));
 console.log('at-pt:',await ev('(function(){var e=document.elementFromPoint('+cp.x+','+cp.y+');function path(x){var a=[];while(x&&x!==document.body){a.unshift(x.tagName+(x.id?"#"+x.id:"")+(x.className&&typeof x.className==="string"?"."+x.className.split(" ").join("."):""));x=x.parentElement}return a.join(" < ")}return e?path(e):"none"})()'));
 console.log('menu:',await ev('document.getElementById("ctxMenu").classList.contains("show")'));
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...cp,button:'right',clickCount:1});
 await sleep(200);
 console.log('menu-after-release:',await ev('document.getElementById("ctxMenu").classList.contains("show")'));
 console.log('exceptions:',errors.length);
 chrome.kill();process.exit(0);
})().catch(e=>{console.error('DIAG-FAIL',e.message);chrome&&chrome.kill();process.exit(1)});
