// P4-A 诊断：复现 undo 后上下文栏套装块消失问题
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const evi=path.resolve('.agent/evidence/TASK-20260919-UI-OVERHAUL/p4-a/diag1');
fs.rmSync(evi,{recursive:true,force:true});fs.mkdirSync(evi,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome,ws,seq=0;const pending=new Map();
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
(async()=>{
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
 const profile=path.join(evi,'profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 await ev('window.prompt=function(){return null}');
 await ev('(function(){var d=store.dancers[0];d.actionClips.push({id:store.nextClipId++,start:0,duration:3,data:{name:"动作A",command:"/bow motion",category:"action"}});d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"套装1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 const swId=await ev('store.dancers[0].switchClips[0].id');
 async function clickAt(x,y){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});await sleep(150)}
 async function clickClip(id){
  await ev('(function(){var w=document.getElementById("timelineWrap");if(w)w.scrollLeft=0;return true})()');await sleep(150);
  const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await clickAt(p.x,p.y);
 }
 async function dump(tag){const h=await ev('(document.getElementById("wbCtxHost")||{}).innerHTML||"NO-HOST"');fs.writeFileSync(path.join(evi,tag+'.html'),h);console.log('== '+tag+' == '+(h.length>400?h.slice(0,400)+'…':h))}
 await clickClip(swId);
 await until('document.getElementById("wbCtxGearApply")');
 await dump('t1-selected');
 await ev('document.getElementById("wbCtxGearSlot").value="3";document.getElementById("wbCtxGearSlot").dispatchEvent(new Event("input",{bubbles:true}))');
 await ev('document.getElementById("wbCtxGearApply").click()');
 await until('store.dancers[0].switchClips[0].data.command==="/gs change 3"');
 await dump('t2-applied');
 await ev('undo()');
 await until('store.dancers[0].switchClips[0].data.command==="/gs change 1"');
 await dump('t3-undone');
 await clickClip(swId);
 await sleep(400);
 await dump('t4-reselected');
 console.log('sel after reselect:',await ev('JSON.stringify({n:edSel().length,track:edSel()[0]&&edSel()[0].track,selected:store.dancers[0].switchClips[0].selected})'));
 chrome.kill();process.exit(0);
})().catch(e=>{console.error('DIAG-FAIL',e.message);chrome&&chrome.kill();process.exit(1)});
