// TASK-20260924-OBS-FIX 浏览器探针：总验收观察四条 UI 修复（O-1 俯视多命中提示 / O-2 未使用折叠
// 展开跨重绘保持＋摘要指引 / O-3 多选未拖动单击收拢单选 / O-7 3D 预览按钮按压态随面板开合）。
// 真实指针（CDP Input.dispatchMouseEvent/KeyEvent），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，
// 一次性 throwaway 资料。证据目录由 CHOREO_OBSFIX_EVIDENCE 指定且必须全新。检查累积到末尾统一抛错
// （一次红跑可覆盖全部条目）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_OBSFIX_EVIDENCE;
if(!evidence||fs.existsSync(evidence)){console.error('需要全新证据目录 CHOREO_OBSFIX_EVIDENCE');process.exit(2)}
fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
const step=(name,data)=>steps.push(Object.assign({step:name,counts:Object.assign({},counts)},data||{}));
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n)} // 累积，末尾统一抛
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);if(!exe)throw Error('chrome.exe not found');
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}if(!target)throw Error('no CDP target');
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(140)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function key(code,vk){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:code,code,windowsVirtualKeyCode:vk});await sleep(140)}
async function btnByText(name){const p=await ev(`(()=>{const b=Array.from(document.querySelectorAll('.toolbar button,button')).find(b=>b.textContent.includes(${JSON.stringify(name)})&&!b.closest('details.toolbar-menu'));if(!b)throw Error('Missing button '+${JSON.stringify(name)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);counts.nav++;await clickAt(p)}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function clickClip(id){ // 窗口化渲染兜底：滚回可见再点（真实指针）
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id));
}
async function ctrlClickClip(id){const p=await clipPoint(id);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1,modifiers:2});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1,modifiers:2});counts.select++;await sleep(140)}
async function dragClipBy(id,px){const p=await clipPoint(id);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});for(const dx of [px*0.3,px*0.6,px]){await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p,x:p.x+dx,button:'left',buttons:1});await sleep(60)}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,x:p.x+px,button:'left',clickCount:1});counts.select++;await sleep(200)}
const seedDraft={
 dancers:[
  {id:0,name:'舞者一',color:'#7eb3ff',switchClips:[],collapsed:false,laneScale:1,currentJob:null,
   actionClips:[{id:1,start:0,duration:3,autoDur:false,data:{id:0,name:'鞠躬',command:'/bow',category:'usual',jobName:'',jobId:0,jobAbbr:''}},
                {id:2,start:4,duration:2.5,autoDur:false,data:{id:0,name:'挥手',command:'/wave',category:'usual',jobName:'',jobId:0,jobAbbr:''}}],
   lyricClips:[],start:{x:1,z:1,yawDeg:0}},
  {id:1,name:'舞者二',color:'#e07bf5',switchClips:[],collapsed:false,laneScale:1,currentJob:null,
   actionClips:[{id:3,start:1,duration:2,autoDur:false,data:{id:0,name:'跳舞',command:'/dance',category:'usual',jobName:'',jobId:0,jobAbbr:''}}],
   lyricClips:[],start:{x:1,z:1,yawDeg:0}},
  {id:2,name:'舞者三',color:'#5dde8e',switchClips:[],collapsed:false,laneScale:1,currentJob:null,
   actionClips:[{id:4,start:2,duration:2,autoDur:false,data:{id:0,name:'鼓掌',command:'/clap',category:'usual',jobName:'',jobId:0,jobAbbr:''}}],
   lyricClips:[],start:{x:3,z:0,yawDeg:0}},
  {id:3,name:'舞者四',color:'#f5d76e',switchClips:[],collapsed:false,laneScale:1,currentJob:null,actionClips:[],lyricClips:[]}
 ],
 dancerCount:4,showLyricMacro:false,totalDuration:300
};
(async()=>{try{
 await open();
 // ---------- S0 O-7：3D 预览按钮态随面板开合（默认 web 目标＝自动打开） ----------
 await until('!!document.getElementById("p3dPanel")&&document.getElementById("p3dPanel").classList.contains("open")');
 const b3d=()=>document.getElementById('btn3dPreview');
 check('O7-1 按钮存在且「3D预览」子串保留（宽屏顶栏）',await ev('(function(){var b=document.getElementById("btn3dPreview");return !!b&&b.textContent.includes("3D预览")})()'));
 check('O7-2 自动打开后面板开＝按压态（.active＋aria-pressed=true＋提示已打开）',await ev('(function(){var b=document.getElementById("btn3dPreview");return !!b&&b.classList.contains("active")&&b.getAttribute("aria-pressed")==="true"&&/已打开/.test(b.title)})()'));
 await btnByText('3D预览');
 await until('!document.getElementById("p3dPanel").classList.contains("open")');
 check('O7-3 点击收起＝按压态解除（aria-pressed=false＋提示查看）',await ev('(function(){var b=document.getElementById("btn3dPreview");return !!b&&!b.classList.contains("active")&&b.getAttribute("aria-pressed")==="false"&&/查看舞者预览/.test(b.title)})()'));
 await btnByText('3D预览');
 await until('document.getElementById("p3dPanel").classList.contains("open")');
 check('O7-4 再次点击重开＝按压态回归（aria-pressed=true）',await ev('(function(){var b=document.getElementById("btn3dPreview");return !!b&&b.getAttribute("aria-pressed")==="true"&&b.classList.contains("active")})()'));
 await shot('s0-3dbtn');step('S0 O-7 按钮态',{panelOpen:true});
 // ---------- S1 种子项目（四舞者：一/二同点、三独点、四无内容） ----------
 await ev('window.__projTest.seedFromDraft('+JSON.stringify(seedDraft)+').then(function(){return true})');
 await ev('location.reload()');
 await until('window.store&&store.appReady&&!document.getElementById("wbEmpty")');
 await until('document.querySelectorAll(".clip").length>=4');
 // ---------- S2 O-2：未使用折叠初始收起＋摘要指引＋展开跨重绘保持 ----------
 check('O2-1 初始收起且摘要保留「未使用的舞者与轨道」＋点开指引',await ev('(function(){var f=document.getElementById("wbUnused");return !!f&&f.open===false&&f.textContent.includes("未使用的舞者与轨道")&&f.textContent.includes("点开本行")&&f.querySelectorAll(".dancer-grp").length===1})()'));
 await click('#wbUnused>summary',0,'nav');
 await until('document.getElementById("wbUnused").open===true');
 check('O2-2 摘要点开可展开（舞者四轨道可见）',await ev('(function(){var g=document.querySelector("#wbUnused .dancer-grp .lane-body");return !!g&&g.getBoundingClientRect().height>0})()'));
 await btnByText('⇝ 吸附'); // 真实控件触发整页重绘（render()）
 await sleep(300);
 check('O2-3 展开后跨重绘保持展开（吸附切换触发 render）',await ev('document.getElementById("wbUnused").open===true'));
 await btnByText('⇝ 吸附'); // 还原吸附开关（再触发一次重绘）
 await sleep(300);
 check('O2-4 连续重绘仍保持展开',await ev('document.getElementById("wbUnused").open===true'));
 await click('#wbUnused>summary',0,'nav');
 await sleep(300); // 点 summary 后不假设展开态（红/绿两侧状态不同，双向保持由 O2-5 断言）
 await btnByText('⇝ 吸附');
 await sleep(300);
 check('O2-5 收起后跨重绘保持收起（双向）＋结构不变',await ev('(function(){var f=document.getElementById("wbUnused");return f.open===false&&f.querySelectorAll(".dancer-grp").length===1})()'));
 await shot('s2-unused');step('S2 O-2 折叠',{unusedOpen:false});
 // ---------- S3 O-1：俯视多命中可见反馈 ----------
 await click('#wbTabTop',0,'nav');
 await until('!document.getElementById("wbTopHost").hidden');
 await ev('store.currentTime=0');
 await sleep(200);
 const topPoint=(wx,wz)=>ev('(function(){var c=document.getElementById("wbTopView");var r=c.getBoundingClientRect();var cs=getComputedStyle(c);var bl=parseFloat(cs.borderLeftWidth)||0,bt=parseFloat(cs.borderTopWidth)||0;var iw=r.width-bl-(parseFloat(cs.borderRightWidth)||0),ih=r.height-bt-(parseFloat(cs.borderBottomWidth)||0);var t=ChoreoWorkbench.topViewTransform();var fx=(('+wx+')*t.sc+t.w/2+t.panX)/t.w,fy=(('+wz+')*t.sc+t.h/2+t.panZ)/t.h;return {x:r.left+bl+fx*iw,y:r.top+bt+fy*ih}})()');
 const overlap=await topPoint(1,1);
 await clickAt(overlap);
 await sleep(150);
 check('O1-1 同点多命中点击：toast 含命中数＋当前舞者＋再点切换',await ev('(function(){var t=document.getElementById("toast");return t.classList.contains("show")&&/同点 2 位舞者，当前：舞者一（再点切换）/.test(t.textContent)})()'));
 check('O1-2 循环首位语义不变（当前舞者保持舞者一）',await ev('store.selectedDancer===0'));
 await sleep(2200); // 等上一次 toast 隐藏，避免污染单命中判定
 const alone=await topPoint(3,0);
 await clickAt(alone);
 await sleep(150);
 check('O1-3 单命中选中舞者三且不提示',await ev('(function(){var t=document.getElementById("toast");return store.selectedDancer===2&&!t.classList.contains("show")})()'));
 await shot('s3-tophit');step('S3 O-1 俯视',{selectedDancer:2});
 await click('#wbTab3d',0,'nav');
 await until('document.getElementById("wbTopHost").hidden');
 // ---------- S4 O-3：多选未拖动单击＝收拢单选 ----------
 const selCount=()=>ev('document.querySelectorAll(".clip.selected").length');
 await clickClip(1);
 await sleep(200);
 await ctrlClickClip(2);
 await sleep(200);
 check('O3-1 Ctrl 多选成立（2 条选中＝多选栏）',await ev('(function(){return document.querySelectorAll(".clip.selected").length===2&&!!document.getElementById("wbCtxGroupMove")&&!document.getElementById("editClipTime")})()'));
 await clickClip(1); // 未拖动、无修饰键的纯单击
 await sleep(250);
 check('O3-2 纯单击收拢为单选该条（单条入口出现、多选栏消失）',await ev('(function(){var n=document.querySelector(".clip.selected");return document.querySelectorAll(".clip.selected").length===1&&!!n&&n.__clip&&n.__clip.id===1&&!!document.getElementById("editClipTime")&&!document.getElementById("wbCtxGroupMove")})()'));
 await key('Escape',27);
 await sleep(200);
 check('O3-3 Esc 仍清空选择',await ev('document.querySelectorAll(".clip.selected").length===0'));
 await ctrlClickClip(1);await ctrlClickClip(2);
 await sleep(200);
 const starts0=await ev('JSON.stringify(store.dancers[0].actionClips.slice(0,2).map(function(c){return c.start}))');
 const px=Math.round(await ev('store.pps')); // 拖 1s＝pps 像素（0.5 吸附网格内）
 await dragClipBy(2,px);
 await sleep(300);
 const starts1=await ev('JSON.stringify(store.dancers[0].actionClips.slice(0,2).map(function(c){return c.start}))');
 check('O3-4 拖动仍整组平移（两条同 delta，B2 契约不变）',await ev('(function(){var a='+starts0+',b='+starts1+';var d0=b[0]-a[0],d1=b[1]-a[1];return Math.abs(d0-d1)<1e-9&&Math.abs(d0-1)<1e-9})()'));
 await shot('s4-multiselect');step('S4 O-3 多选',{groupMoved:1});
 json('checks',checks);json('requests',requests);json('errors',errors);json('steps',steps);
 const failed=checks.filter(c=>!c.ok);
 await close();
 if(failed.length){console.error('FAILED checks: '+failed.map(f=>f.name).join(' | '));process.exit(1)}
 console.log('PASS obs-fix browser '+checks.length+'/'+checks.length);
}catch(e){
 json('checks',checks);json('requests',requests);json('errors',errors);json('steps',steps);
 console.error('ERROR '+e.message);try{await close()}catch(_){}
 process.exit(1);
}})();
