// P4-A 诊断2：用探针同款真实指针助手复现 type() 后套装块消失
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const evi=path.resolve('.agent/evidence/TASK-20260919-UI-OVERHAUL/p4-a/diag2');
fs.rmSync(evi,{recursive:true,force:true});fs.mkdirSync(evi,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome,ws,seq=0;const pending=new Map(),errors=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
(async()=>{
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
 const profile=path.join(evi,'profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params)};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 await ev('window.prompt=function(){return null}');
 await ev('(function(){var d=store.dancers[0];d.actionClips.push({id:store.nextClipId++,start:0,duration:3,data:{name:"动作A",command:"/bow motion",category:"action"}});d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"套装1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 const swId=await ev('store.dancers[0].switchClips[0].id');
 async function point(selector,index=0){
  return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport');for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded')})()`);
 }
 async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(140)}
 async function click(sel){return clickAt(await point(sel))}
 async function type(sel,text){await click(sel);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(160)}
 async function clickClip(id){
  await ev('(function(){var w=document.getElementById("timelineWrap");if(w)w.scrollLeft=0;return true})()');await sleep(200);
  const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect();return {x:Math.min(Math.max((r.left+r.right)/2,Math.max(r.left,w.left)+12),Math.min(r.right,innerWidth)-12),y:(r.top+r.bottom)/2}})()`);
  await clickAt(p);
 }
 function dump(tag){return ev('(document.getElementById("wbCtxHost")||{}).innerHTML||"NO-HOST"').then(h=>{fs.writeFileSync(path.join(evi,tag+'.html'),h);console.log(tag,'len='+h.length,'gear='+(/wbCtxGearApply/.test(h)?'Y':'N'),'sel='+h.slice(0,80))})}
 await clickClip(swId);await until('document.getElementById("wbCtxGearApply")');
 console.log('-- 阶段1：type slot=3');
 await type('#wbCtxGearSlot','3');await dump('d1-after-slot-type');
 await click('#wbCtxGearApply');await until('store.dancers[0].switchClips[0].data.command==="/gs change 3"');
 console.log('-- 阶段2：undo');
 await ev('undo()');await until('store.dancers[0].switchClips[0].data.command==="/gs change 1"');
 await clickClip(swId);await until('document.getElementById("wbCtxGearStart")');await dump('d2-reselect');
 console.log('-- 阶段3：type start=8（探针失败点）');
 const pt=await point('#wbCtxGearStart');console.log('start pt',JSON.stringify(pt));
 console.log('activeElement before click:',await ev('document.activeElement&&document.activeElement.id||document.activeElement&&document.activeElement.tagName'));
 await clickAt(pt);
 console.log('activeElement after click:',await ev('document.activeElement&&document.activeElement.id||document.activeElement&&document.activeElement.tagName'));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await send('Input.insertText',{text:'8'});await sleep(160);
 await dump('d3-after-start-type');
 console.log('sel:',await ev('JSON.stringify({n:edSel().length,first:edSel()[0]&&edSel()[0].track})'));
 console.log('startValue:',await ev('(document.getElementById("wbCtxGearStart")||{}).value'));
 console.log('exceptions:',JSON.stringify(errors.map(e=>e.exceptionDetails&&e.exceptionDetails.exception&&e.exceptionDetails.exception.description||String(e)).slice(0,5)));
 chrome.kill();process.exit(0);
})().catch(e=>{console.error('DIAG-FAIL',e.message);chrome&&chrome.kill();process.exit(1)});
