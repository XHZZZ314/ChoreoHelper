// B2 真实按钮与指针可用性：全新资料目录、禁止 HTTP(S)，不操作游戏。
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=process.env.B2_US_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 B2_US_EVIDENCE');
fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
let chrome=null,ws=null,seq=0;const pending=new Map(),errors=[],requests=[],checks=[],steps=[];let counts={click:0};
const json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,1));
function step(n,d){steps.push(Object.assign({step:n},d||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok,d){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n+' '+(d||''))}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function shotClip(sel,n){const r=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});if(!n)return null;const b=n.getBoundingClientRect();return {x:Math.max(0,b.left),y:Math.max(0,b.top),width:Math.min(b.width,innerWidth),height:Math.min(b.height,innerHeight),scale:1}})()`);if(r&&r.width>2){const s=await send('Page.captureScreenshot',{format:'png',clip:r});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(s.data,'base64'))}}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(150)}
async function click(selector){const p=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);counts.click++;await clickAt(p);return p}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1500,900','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(()=>{})};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function clickText(selector,text){const p=await ev(`(()=>{const n=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!n)throw Error('missing button');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await clickAt(p)}
async function top(x,z){await ev('document.getElementById("wbTopView").scrollIntoView({block:"center"})');const p=await ev(`(()=>{const n=document.getElementById('wbTopView'),r=n.getBoundingClientRect(),c=getComputedStyle(n),t=ChoreoWorkbench.topViewTransform(),l=parseFloat(c.borderLeftWidth)||0,b=parseFloat(c.borderTopWidth)||0;return {x:r.left+l+(r.width-l-(parseFloat(c.borderRightWidth)||0))*(.5+${x}*t.sc/t.w),y:r.top+b+(r.height-b-(parseFloat(c.borderBottomWidth)||0))*(.5+${z}*t.sc/t.h)}})()`);await clickAt(p)}
async function textInput(selector,value){await click(selector);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:value})}
const skill={id:120,type:'action',name:'B2测试技能',staticMetadata:{version:1,actionId:120,castMs:0,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
(async()=>{try{
 await open();
 for(const count of [4,8]){
  const dancers=Array.from({length:count},(_,i)=>({id:i,name:'舞者'+(i+1),color:'#7eb3ff',start:{x:0,z:0,yawDeg:0},actionClips:[{id:100+i,start:0,duration:2,data:{id:0,name:'鞠躬',command:'/bow',category:'usual'}}],switchClips:[],lyricClips:[],collapsed:false,laneScale:1}));
  await ev(`__projTest.seedFromDraft(${JSON.stringify({dancers,dancerCount:count,totalDuration:60})}).then(()=>true)`);await ev('location.reload()');await until(`window.store&&store.appReady&&store.dancers.length===${count}`);
  await ev(`(()=>{store.previewTarget='web';store.pps=30;for(let i=0;i<store.dancers.length;i++)ChoreoAbilityUI.quickAdd(${JSON.stringify(skill)},i,2);store.selectedDancer=2;render();return true})()`);
  const ids=await ev('ChoreoAbilityPlan.rows(store).map(r=>r.event.id)');
  const sel=`.ability-clip[data-event-id="${ids[0]}"]`;
  await click(sel);check(count+' skill selected by pointer',await ev(`ChoreoAbilityUI.selection()[0]===${JSON.stringify(ids[0])}`));
  await click('#wbSkillMore');await until('!!document.getElementById("wbSkillEditor")');
  await ev('window.__b2Editor=document.getElementById("wbSkillEditor")');
  await textInput('#wbSkillEditor input[aria-label="触发时刻（秒）"]','4.25');
  await ev('render()');
  check(count+' foreign lane render preserves same editor and draft',await ev('document.getElementById("wbSkillEditor")===window.__b2Editor&&document.querySelector(\'#wbSkillEditor input[aria-label="触发时刻（秒）"]\').value==="4.25"'));
  check(count+' foreign lane render preserves global skill selection',await ev(`ChoreoAbilityUI.selection()[0]===${JSON.stringify(ids[0])}`));
  await shot('skill-editor-'+count);
  await clickText('#wbSkillEditor button','取消');
  await until('!!document.getElementById("wbSkillDel")');await click('#wbSkillDel');
  check(count+' real delete removes only selected dancer skill',JSON.stringify(await ev('ChoreoAbilityPlan.rows(store).map(r=>r.event.id)'))===JSON.stringify(ids.slice(1)));
  await click('[title^="撤销"]');
  check(count+' undo visible skill dancer type',await ev('store.selectedDancer===0&&document.getElementById("wbHistorySelection").textContent.includes("舞者1 · 技能")'));
  await click('[title^="重做"]');
  check(count+' redo visible skill dancer type',await ev('store.selectedDancer===0&&document.getElementById("wbHistorySelection").textContent.includes("舞者1 · 技能")'));
  await ev(`(()=>{ChoreoAbilityUI.clearSelection();for(let i=0;i<store.dancers.length;i++){const M=ChoreoStageMotion;M.install(store,M.edit(store,i,{movement:[{time:'5',x:'8',z:'0'}],facing:[{time:'5',yaw:'90'}]},'b2-'+i))}saveHistory();store.currentTime=0;store.selectedDancer=2;render();return true})()`);
  await click('#wbTabTop');
  const order=[2,...Array.from({length:count},(_,i)=>i).filter(i=>i!==2),2];
  for(let i=0;i<order.length;i++){await top(0,0);check(count+' marker over line cycle '+i,await ev(`store.selectedDancer===${order[i]}&&!ChoreoStageMotionUI.sessionActive()`))}
  await ev('store.selectedDancer=2;render()');
  for(let i=0;i<order.length;i++){await top(4,0);check(count+' overlapping path cycle '+i,await ev(`ChoreoStageMotionUI.sessionState().di===${order[i]}`))}
  await top(8,0);check(count+' node handle precedes other hits',await ev('document.getElementById("wbMotionStatus").textContent.includes("走位节点 1")&&ChoreoStageMotionUI.sessionState().di===2'));
  await shot('overlap-'+count);
  await ev('ChoreoStageMotionUI.clearSelection();render()');
  const rects=await ev(`(()=>{const g=document.querySelector('.dancer-grp'),nodes=Array.from(g.querySelectorAll('.stage-motion-clip,.stage-motion-open'));return nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,text:n.textContent}})})()`);
  check(count+' lane add movement facing rectangles separate',rects.length===3&&rects.every((a,i)=>rects.every((b,j)=>i===j||a.bottom<=b.top||b.bottom<=a.top||a.right<=b.left||b.right<=a.left)),JSON.stringify(rects));json('lane-rects-'+count,rects);
  await click('.dancer-grp .stage-motion-clip');check(count+' movement button pointer reaches movement',await ev('ChoreoStageMotionUI.sessionState().kind==="motion"&&ChoreoStageMotionUI.sessionState().di===0'));
  await click('.dancer-grp .stage-motion-clip:nth-of-type(3)');check(count+' facing button pointer reaches facing',await ev('ChoreoStageMotionUI.sessionState().kind==="facing"&&ChoreoStageMotionUI.sessionState().di===0'));
  await click('#wbMotionTable>summary');
  await textInput('[aria-label="朝向节点1 朝向°"]','45');await click('#wbMotionApply');
  await click('[title^="撤销"]');check(count+' facing undo dancer and type visible',await ev('store.selectedDancer===0&&document.getElementById("wbHistorySelection").textContent.includes("舞者1 · 独立朝向")'));
  await click('[title^="重做"]');check(count+' facing redo dancer and type visible',await ev('store.selectedDancer===0&&document.getElementById("wbHistorySelection").textContent.includes("舞者1 · 独立朝向")'));
  await shot('history-'+count);
 }
 check('no page JavaScript exceptions',errors.length===0,JSON.stringify(errors));
 json('checks',checks);json('requests',requests);json('errors',errors);console.log(checks.length+' checks passed');
 }catch(e){json('failure',{message:e.stack,checks,errors,requests});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();

