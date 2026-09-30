// TASK-20260919-UI-OVERHAUL P1-A 旅程式浏览器探针：空态三入口 → 接着添加（lastEnd+等待、落点预告）
// → 插在这里（点刻度、0.5 吸附、点片段退出）→ 等待带与片段时长分列/改等待不动时长并预告范围
// → 旧项目直接可见+范围贴合+未用轨折叠 → 窄窗舞台收下方、停止常驻 → 布局占比偏好。
// 真实指针（CDP Input.dispatchMouseEvent/KeyEvent），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，
// 一次性 throwaway 资料（不触真实工程/私人资产/游戏端点）。证据目录由 CHOREO_WORKBENCH_EVIDENCE 指定且必须全新。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_WORKBENCH_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_WORKBENCH_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
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
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
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
const seedDraft={
 dancers:[
  {id:0,name:'舞者一',color:'#7eb3ff',switchClips:[],collapsed:false,laneScale:1,currentJob:null,
   actionClips:[{id:1,start:0,duration:3,autoDur:false,data:{id:0,name:'鞠躬',command:'/bow',category:'usual',jobName:'',jobId:0,jobAbbr:''}},
                {id:2,start:4,duration:2.5,autoDur:false,data:{id:0,name:'挥手',command:'/wave',category:'usual',jobName:'',jobId:0,jobAbbr:''}}],
   lyricClips:[]},
  {id:1,name:'舞者二',color:'#e07bf5',switchClips:[],collapsed:false,laneScale:1,currentJob:null,
   actionClips:[{id:3,start:2,duration:3,autoDur:false,data:{id:0,name:'跳舞',command:'/dance',category:'usual',jobName:'',jobId:0,jobAbbr:''}}],
   lyricClips:[],start:{x:2,z:0,yawDeg:0}},
  {id:2,name:'舞者三',color:'#5dde8e',switchClips:[],collapsed:false,laneScale:1,currentJob:null,actionClips:[],lyricClips:[]}
 ],
 dancerCount:3,showLyricMacro:false,totalDuration:300
};
(async()=>{try{
 await open();
 // ---------- S0 空态（1366×768） ----------
 await until('document.getElementById("wbEmpty")');
 check('P1A-1 空态一句话说明',await ev('document.getElementById("wbEmpty").textContent.includes("这里用来排一场演出")'));
 check('P1A-1 三个起步入口（从零/宏/旧项目）',await ev('!!document.getElementById("wbEmptyStart")&&!!document.getElementById("wbEmptyMacro")&&!!document.getElementById("wbEmptyOpen")&&document.getElementById("wbEmptyStart").textContent.includes("第一个动作")'));
 check('P1A-1 无空轨道墙/5分钟空白',await ev('!document.querySelector(".tl-area")&&!document.querySelector(".dancer-grp")'));
 check('P1A-1 停止常驻可见',await ev(stopVisible));
 check('P1A-1 舞台 3D/俯视标签常驻',await ev('(function(){var a=document.getElementById("wbTab3d"),b=document.getElementById("wbTabTop");return !!a&&!!b&&a.getBoundingClientRect().width>0&&b.getBoundingClientRect().width>0})()'));
 check('P1A-1 默认布局=时间轴为主（不预设舞台最大）',await ev('document.getElementById("editorFrame").classList.contains("wb-layout-timeline")'));
 await shot('s0-empty');step('S0 空态',{expect:'一句话+三入口+停止可见',actual:'已断言'});
 // ---------- S1 从零开始 ----------
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".sidebar")&&document.querySelector(".tl-area")&&document.getElementById("wbAddBar")');
 check('P1A-2 从零开始在 1 击内进入工作台（导航 1 击）',counts.nav===1);
 check('P1A-2 默认添加控件=接着添加动作（1 击语义）',await ev('!!document.querySelector("[data-wb=add-next]")&&document.querySelector("[data-wb=add-next]").textContent.includes("接着添加动作")'));
 check('P1A-2 空动作轨落点预告=第一个动作从 0.0s 开始',await ev('document.getElementById("wbLanding").textContent.includes("第一个动作从 0.0s 开始")'));
 await until('document.querySelector(".act-item")'); // 快照目录异步装填
 await shot('s1-from-scratch');step('S1 从零开始',{expect:'工作台+落点预告',actual:'已断言',navigation:counts.nav});
 // ---------- S2 接着添加 + 等待值 ----------
 const firstName=await ev('document.querySelector(".act-item .ai-name").textContent');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 const d1=await ev('store.dancers[0].actionClips[0].duration');
 check('P1A-2 库内 1 击落条且起点=lastEnd(0)',await ev('store.dancers[0].actionClips.length===1&&store.dancers[0].actionClips[0].start===0&&store.dancers[0].actionClips[0].data.name==='+JSON.stringify(firstName)));
 check('P1A-4 片段自身时长显示在条内',await ev('(function(){var n=document.querySelector(".clip .c-dur");return !!n&&n.textContent===store.dancers[0].actionClips[0].duration.toFixed(1)+"s"})()'));
 await type('#wbWaitInput','2');
 await until('document.getElementById("wbLanding").textContent.includes("等待 2.0s")');
 check('P1A-2 落点预告随等待值更新（先显后加）',await ev('document.getElementById("wbLanding").textContent.includes("新动作从 "+(Math.round((0+'+d1+'+2)*10)/10).toFixed(1)+"s 开始")'));
 await click('.act-item .ai-name',1,'select');
 await until('store.dancers[0].actionClips.length===2');
 check('P1A-2 第二个动作落点=lastEnd+等待（不改第一个）',await ev('(function(){var a=store.dancers[0].actionClips.slice().sort(function(x,y){return x.start-y.start});return a[1].start==='+(d1+2)+'&&a[0].duration==='+d1+'})()'));
 check('P1A-4 相邻动作间渲染等待带（等待≠时长）',await ev('(function(){var b=document.querySelectorAll(".wait-band");return b.length===1&&b[0].textContent.includes("等待 2.0s")})()'));
 await shot('s2-append-wait');step('S2 接着添加',{expect:'落点=lastEnd+2；等待带 2s',actual:'已断言',clipDuration:d1});
 // ---------- S3 插在这里 ----------
 await enterInsert(10);
 await until('!!document.querySelector("[data-wb=insert]")');
 check('P1A-3 点刻度切到「插在这里」（0.5 吸附后的 10.0s）',await ev('document.querySelector("[data-wb=insert]").textContent.includes("插在这里")&&document.getElementById("wbLanding").textContent.includes("插在 10.0s")'));
 check('P1A-3 提供「改回接着添加」',await ev('!!document.querySelector("[data-wb=back-append]")'));
 await shot('s3-insert-mode');
 await click('.act-item .ai-name',2,'select');
 await until('store.dancers[0].actionClips.length===3');
 check('P1A-3 插入落点=所选时刻（10.0s）',await ev('(function(){var a=store.dancers[0].actionClips.slice().sort(function(x,y){return x.start-y.start});return a[2].start===10})()'));
 check('P1A-3 插入完成后回到默认接着添加',await ev('!!document.querySelector("[data-wb=add-next]")&&!document.querySelector("[data-wb=insert]")'));
 await enterInsert(16);
 await until('!!document.querySelector("[data-wb=insert]")');
 const clip1Id=await ev('store.dancers[0].actionClips[0].id');
 await clickClip(clip1Id);
 await until('!!document.querySelector("[data-wb=add-next]")');
 check('P1A-3 点任何片段退出插入模式',await ev('!document.querySelector("[data-wb=insert]")&&window.ChoreoWorkbench.insertAt()==null'));
 // 改回接着添加按钮：再次进入插入后用它返回
 await enterInsert(16);
 await until('!!document.querySelector("[data-wb=back-append]")');
 await click('[data-wb=back-append]',0,'nav');
 await until('!!document.querySelector("[data-wb=add-next]")');
 check('P1A-3 「改回接着添加」可返回默认',await ev('!document.querySelector("[data-wb=insert]")&&!!document.querySelector("[data-wb=add-next]")'));
 step('S3 插在这里',{expect:'刻度选时刻→插入→点片段退出→可返回',actual:'已断言'});
 // ---------- S4 等待≠时长 + 改动范围预告 ----------
 const ids=await ev('store.dancers[0].actionClips.slice().sort(function(a,b){return a.start-b.start}).map(function(c){return c.id})');
 await clickClip(ids[1]);
 await until('!!document.getElementById("wbCtx")');
 const before=await ev('JSON.stringify(store.dancers[0].actionClips.slice().sort(function(a,b){return a.start-b.start}).map(function(c){return {id:c.id,start:c.start,duration:c.duration}}))');
 check('P1A-4 选中片段→上下文栏显示开始/等待/时长',await ev('(function(){var s=document.getElementById("wbCtxStart").textContent,d=document.getElementById("wbCtxDur").textContent,w=document.getElementById("wbCtxWait");return s.includes("开始 5.0s")&&d.includes("时长 "+Number('+d1+').toFixed(1)+"s")&&w.value==="2"})()'));
 await type('#wbCtxWait','1');
 await until('document.getElementById("wbChangePreview").textContent.includes("后面的片段不动")');
 const previewText=await ev('document.getElementById("wbChangePreview").textContent');
 check('P1A-4 改动范围预告：后面不动+间隔/重叠（first-macro-journey J3 措辞含「相隔」）',/后面的片段不动/.test(previewText)&&/(间隔|重叠|衔接|相隔)/.test(previewText));
 await key('Enter',13,'Enter');
 await until('store.dancers[0].actionClips.slice().sort(function(a,b){return a.start-b.start})[1].start===4');
 const after=await ev('JSON.stringify(store.dancers[0].actionClips.slice().sort(function(a,b){return a.start-b.start}).map(function(c){return {id:c.id,start:c.start,duration:c.duration}}))');
 const B=JSON.parse(before),A=JSON.parse(after);
 check('P1A-4 改等待只改开始：自身时长不变、后续不动',A[1].start===4&&A[1].duration===B[1].duration&&A[2].start===B[2].start&&A[0].start===B[0].start&&A[0].duration===B[0].duration);
 check('P1A-4 等待带同步为 等待 1.0s',await ev('(function(){var b=document.querySelectorAll(".wait-band");return b.length===2&&Array.prototype.some.call(b,function(n){return n.textContent.includes("等待 1.0s")})})()'));
 check('P1A-4 旧入口仍可达（编辑时间弹窗入口在）',await ev('!!document.getElementById("editClipTime")'));
 await shot('s4-wait-vs-duration');step('S4 等待≠时长',{before:JSON.parse(before),after:JSON.parse(after),preview:previewText});
 // ---------- S5 旧项目直接可见+范围贴合+未用轨折叠 ----------
 await ev('window.__projTest.seedFromDraft('+JSON.stringify(seedDraft)+').then(function(){return true})');
 await ev('location.reload()');
 await until('window.store&&store.appReady&&!document.getElementById("wbEmpty")');
 await until('document.querySelectorAll(".clip").length===3');
 const docBefore=await ev('JSON.stringify(projectRecord().content)');
 check('P1A-5 旧项目打开内容直接可见（3 条动作在两个舞者轨上）',await ev('store.dancers.length===3&&store.dancers[0].actionClips.length===2&&store.dancers[1].actionClips.length===1'));
 check('P1A-5 可见范围贴合内容（非固定 5 分钟空白）',await ev('(function(){var end=timelineContentEnd(),wrap=document.getElementById("timelineWrap");return end>0&&store.pps>20&&store.pps<=120&&end*store.pps<=wrap.clientWidth&&end*store.pps>=wrap.clientWidth*0.5})()'));
 check('P1A-5 未使用舞者与轨道折叠为可展开区',await ev('(function(){var f=document.getElementById("wbUnused");return !!f&&f.open===false&&f.textContent.includes("未使用的舞者与轨道")&&f.querySelectorAll(".dancer-grp").length===1})()'));
 await click('#wbUnused>summary',0,'nav');
 await until('document.getElementById("wbUnused").open===true');
 check('P1A-5 折叠区可展开（展开后舞者轨道可见）',await ev('(function(){var g=document.querySelector("#wbUnused .dancer-grp .lane-body");return !!g&&g.getBoundingClientRect().height>0})()'));
 const docAfter=await ev('JSON.stringify(projectRecord().content)');
 check('P1A-4/5 旧项目打开与展开零数据改动',docBefore===docAfter&&docBefore.includes('/bow'));
 // 俯视标签：切过去画布绘制舞者（只读预览；同处走位编辑在 P1-C）
 await click('#wbTabTop',0,'nav');
 await until('!document.getElementById("wbTopHost").hidden');
 check('P1A 俯视标签可切换且画布已绘制',await ev('(function(){var c=document.getElementById("wbTopView");if(!(c.width>0&&c.height>0))return false;var g=c.getContext("2d");var d=g.getImageData(0,0,c.width,c.height).data;for(var i=3;i<d.length;i+=4){if(d[i]!==0)return true}return false})()'));
 await click('#wbTab3d',0,'nav');
 await until('document.getElementById("wbTopHost").hidden');
 await shot('s5-old-project');step('S5 旧项目',{dancers:3,clips:3,pps:await ev('store.pps'),unusedFold:true});
 // ---------- S6 窄窗 ≤1000px：舞台收下方、停止常驻 ----------
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===1000');
 await sleep(300);
 check('P1A-6/窄窗 舞台面板收为下方面板',await ev('(function(){var s=document.getElementById("previewDock").getBoundingClientRect(),t=document.querySelector(".tl-area").getBoundingClientRect();return s.top>=t.bottom-2&&s.left<=t.left+1})()'));
 check('P1A-6/窄窗 停止按钮仍可见在视口内',await ev(stopVisible));
 check('P1A-6/窄窗 时间轴保持主操作面（≥70% 视口宽）',await ev('(function(){var t=document.querySelector(".tl-area").getBoundingClientRect();return t.width>=innerWidth*0.7})()'));
 await shot('s6-narrow');
 await send('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===1500');
 await sleep(300);
 check('P1A-6 1500×900 恢复横向两栏（舞台在右）',await ev('(function(){var s=document.getElementById("previewDock").getBoundingClientRect(),t=document.querySelector(".tl-area").getBoundingClientRect();return s.left>t.right-2&&s.top<=t.top+1})()'));
 check('P1A-6 宽窗停止仍可见',await ev(stopVisible));
 await shot('s7-wide');
 // ---------- S7 布局占比偏好可调 ----------
 await click('[data-wb-layout=balance]',0,'nav');
 await until('document.getElementById("editorFrame").classList.contains("wb-layout-balance")');
 check('P1A 布局占比可切到均衡并持久化偏好',await ev('localStorage.getItem("choreo_wb_layout")==="balance"'));
 await click('[data-wb-layout=timeline]',0,'nav');
 await until('document.getElementById("editorFrame").classList.contains("wb-layout-timeline")');
 check('P1A 可切回时间轴为主',await ev('localStorage.getItem("choreo_wb_layout")==="timeline"'));
 step('S7 布局偏好',{layout:'timeline'});
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个');
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-props-ui.js','choreo-workbench.js','choreo-bootstrap.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);
 console.log('\nWorkbench: '+checks.length+' checks passed');
 }catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
