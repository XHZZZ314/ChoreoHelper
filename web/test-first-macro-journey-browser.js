// 首条编舞旅程（first-macro-journey r1）浏览器探针：§3 十二步旅程 + FJ-01…06。
// 真实指针/键盘（CDP Input），DOM/store/生产序列化只作读取断言；导航前阻断全部 HTTP(S)
// （含 localhost 游戏端点）；一次性 throwaway 合成资料，不触属主工程/真实素材/音频。
// 证据目录由 CHOREO_JOURNEY_EVIDENCE 指定且必须为全新绝对路径。游戏端停止结果在网络阻断
// 环境下只能是「未确认」；本探针不冒充真实游戏响应或人类易用性验证。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_JOURNEY_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_JOURNEY_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(process.env.CHOREO_JOURNEY_SOURCE || __dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0,ordinary:0};
let expectedPrompt=null;const dialogs=[];
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
// 含 await 的异步表达式必须走非 replMode（本机实测：CDP replMode 下 async IIFE 结果丢失为 {}）
async function evx(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:false});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function blockNetwork(){
 const commands=[['Network.enable',{}],['Network.setBlockedURLs',{urls:['http://*','https://*']}],['Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]}]];
 const records=[];try{for(const [method,params] of commands){const record={method,params,ok:false};records.push(record);await send(method,params);record.ok=true}}catch(e){records[records.length-1].error=e.message;throw e}finally{fs.writeFileSync(path.join(evidence,'blocking.json'),JSON.stringify({phase:'before navigation',records},null,2))}
}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];fs.writeFileSync(path.join(evidence,'control-connection.json'),JSON.stringify({discovery:'http://127.0.0.1:'+port+'/json/list',scope:'Node browser control only; not product network'}));target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params);if(expectedPrompt!==null){const text=expectedPrompt;expectedPrompt=null;send('Page.handleJavaScriptDialog',{accept:true,promptText:text}).catch(e=>errors.push({dialog:e.message}));}else send('Page.handleJavaScriptDialog',{accept:false}).catch(()=>{});}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m.params).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await blockNetwork();
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 // R5：记录俯视画布实际送达的指针坐标（click 事件 clientX/Y 为整数），供容差按实际指针证明
 await ev('(function(){var cv=document.getElementById("wbTopView");window.__topClicks=[];if(cv)cv.addEventListener("click",function(e){window.__topClicks.push({x:e.clientX,y:e.clientY})});return true})()');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function key(code,vk,keyName){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:keyName||code,code,windowsVirtualKeyCode:vk});await sleep(120)}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function clickClip(id){
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id));
}
// R5：前向映射与产品 topWorldAt 同口径＝内容盒（扣边框），不再用边框盒；
// 返回实际送达指针（整数截断）与按其反算的期望世界坐标，容差由此证明而非放宽。
async function clickTopWorld(x,z){
 const t=await ev('ChoreoWorkbench.topViewTransform()');
 if(!t||!(t.sc>0)||!(t.w>0)||!(t.h>0))throw Error('top view transform missing '+JSON.stringify(t));
 const r=await ev('(function(){var b=document.getElementById("wbTopView");var rc=b.getBoundingClientRect();var cs=getComputedStyle(b);var bl=parseFloat(cs.borderLeftWidth)||0,bt=parseFloat(cs.borderTopWidth)||0;return {l:rc.left+bl,t:rc.top+bt,w:rc.width-bl-(parseFloat(cs.borderRightWidth)||0),h:rc.height-bt-(parseFloat(cs.borderBottomWidth)||0)}})()');
 const px=r.l+r.w*(0.5+x*t.sc/t.w),py=r.t+r.h*(0.5+z*t.sc/t.h);
 if(px<r.l+4||px>r.l+r.w-4||py<r.t+4||py>r.t+r.h-4)throw Error('dest ('+x+','+z+') outside canvas: '+JSON.stringify({t,r,px,py}));
 counts.select++;await clickAt({x:px,y:py});
 const seen=await ev('(window.__topClicks&&window.__topClicks[window.__topClicks.length-1])||null');
 return {want:{x,z},sent:[px,py],seen:seen?{x:seen.x,y:seen.y}:null,
  kx:(t.w/r.w)/t.sc,kz:(t.h/r.h)/t.sc,
  expectedFromSeen:seen?{x:((seen.x-r.l)/r.w*t.w-t.w/2)/t.sc,z:((seen.y-r.t)/r.h*t.h-t.h/2)/t.sc}:null};
}
async function button(text,scope='body',kind='nav'){
 const idx=await ev(`Array.from(document.querySelectorAll(${JSON.stringify(scope+' button')})).findIndex(n=>n.textContent.includes(${JSON.stringify(text)}))`);
 if(idx<0)throw Error('button missing '+text);await click(scope+' button',idx,kind);
}
const times=()=>ev('store.dancers[0].actionClips.map(c=>({id:c.id,start:c.start,duration:c.duration,autoDur:c.autoDur}))');
const historyLen=()=>ev('store.history.length');
const tracksJson=()=>ev('JSON.stringify(projectRecord().content)');
// 完整生产文档比较：保留 native ID/完整数组/重复项/嵌套字段，仅排除已证实的可变项——
// ①版本号（timelineRevision/_docRev）②UI 选择标记＝已证实的序列化位置：规范文档
// tracks/lyrics 事件的 _extra.selected 与旧形态片段级 selected（R4 修复：不递归删除任意
// 位置——data.extension.selected 等原生字段必须参与比较）
// ③install/restore 保留的空 extraTracks 容器（上一批独立验收 flow-supplement 诊断已证明的实现细节，不据此误报损坏）
const cleanDocJs=`(function(doc){doc=JSON.parse(JSON.stringify(doc));if('timelineRevision' in doc)delete doc.timelineRevision;if('_docRev' in doc)delete doc._docRev;['tracks','lyrics'].forEach(function(k){(doc[k]||[]).forEach(function(t){(t.events||[]).forEach(function(e){if(e&&e._extra&&'selected' in e._extra)delete e._extra.selected})})});var stripClips=function(arr){(arr||[]).forEach(function(c){if(c&&'selected' in c)delete c.selected})};(doc.dancers||[]).forEach(function(d){stripClips(d.actionClips);stripClips(d.switchClips);stripClips(d.lyricClips)});stripClips(doc.globalLyrics);var ex=doc.contentExtra;if(ex&&ex._doc&&Array.isArray(ex._doc.extraTracks)&&ex._doc.extraTracks.length===0){delete ex._doc.extraTracks;var keys=Object.keys(ex._doc);if(!keys.length)delete ex._doc;var exKeys=Object.keys(ex);if(!exKeys.length)delete doc.contentExtra}return doc})`;
// R4：差异路径清单（清洗后逐路径比较；数组长度差异记为 p[#]）——应用步骤断言「只动了应动的子树」
const diffPathsJs=`(function(a,b){var out=[];(function walk(x,y,p){if(x===y)return;if(Array.isArray(x)&&Array.isArray(y)){if(x.length!==y.length)out.push(p+'[#]');var n=Math.min(x.length,y.length);for(var i=0;i<n;i++)walk(x[i],y[i],p+'['+i+']');return}if(x&&y&&typeof x==='object'&&typeof y==='object'){var ks=Object.keys(x).concat(Object.keys(y)).filter(function(v,i,s){return s.indexOf(v)===i});ks.forEach(function(k){walk(x[k],y[k],p+'.'+k)});return}out.push(p)})(a,b,'');return out})`;
// R4-A：只允许插入唯一新 movement；移除后全文档相等，保持数组次序和重复项。
// R4-A/r4 修复（独立验收 P2 漏报）：diffPathsJs 在一方数组、一方对象时按键名递归，会把
// 数组与同数字键对象、空数组与空对象判等；候选放行必须在差异清单之外再过类型敏感的
// 完整结构全等 eq（数组≠对象、空数组≠空对象；数组按序逐项、对象按键集＋值、重复项保留）。
const movementDeltaJs=`(function(a,b,diff){var eq=function(x,y){if(x===y)return true;if(Array.isArray(x)||Array.isArray(y))return Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&x.every(function(v,i){return eq(v,y[i])});if(x&&y&&typeof x==='object'&&typeof y==='object'){var kx=Object.keys(x),ky=Object.keys(y);if(kx.length!==ky.length)return false;for(var j=0;j<kx.length;j++){if(!Object.prototype.hasOwnProperty.call(y,kx[j])||!eq(x[kx[j]],y[kx[j]]))return false}return true}return false};var paths=diff(a,b),addedTypes=[],indexes=[];if(!Array.isArray(a.tracks)||!Array.isArray(b.tracks)||b.tracks.length!==a.tracks.length+1)return {ok:false,paths:paths,addedTypes:addedTypes};for(var i=0;i<b.tracks.length;i++){var t=b.tracks[i];if(!t||t.type!=="movement"||typeof t.id!=="string"||!t.id||a.tracks.some(function(q){return q.id===t.id}))continue;var restored=JSON.parse(JSON.stringify(b));restored.tracks.splice(i,1);if(diff(a,restored).length===0&&eq(a,restored))indexes.push(i)}if(indexes.length===1)addedTypes.push("movement");return {ok:indexes.length===1,paths:paths,addedTypes:addedTypes,addedIndexes:indexes}})`;
async function docDiff(beforeJson,afterJson){
 return ev('JSON.stringify('+diffPathsJs+'('+cleanDocJs+'('+beforeJson+'),'+cleanDocJs+'('+afterJson+')))').then(JSON.parse);
}
(async()=>{try{
 await open();
 // ---------- 合成初始资料准备（独立标注：经项目中心+原生 prompt 协议新建空合成项目，非点击旅程的一部分）----------
 await button('项目','.toolbar-nav');await until('!!document.getElementById("projectCenterModal")');
 expectedPrompt='合成观察—首条编舞旅程';counts.input++;counts.ordinary++;
 await button('新建项目','#projectCenterModal');
 await until('store.projectName==="合成观察—首条编舞旅程"&&!document.getElementById("projectCenterModal")');
 step('prep',{note:'合成项目经原生 prompt 协议命名，不算桌面可见命名输入'});

 // ---------- §3-1 进入：点「添加第一个动作」 ----------
 await click('#wbEmptyStart',0,'nav');await until('document.querySelector(".tl-area")&&document.getElementById("wbAddBar")');
 const guide=await ev('document.querySelector(".tl-empty-guide").textContent');
 check('FJ-01 进入后引导=在左侧选一个动作，排成第一条',guide.includes('在左侧选一个动作，排成第一条'));
 check('FJ-01 引导说明第一条从 0 秒开始',guide.includes('第一条从 0 秒开始'));
 check('FJ-01 引导不再误导播放头/右侧面板',!guide.includes('加到播放头')&&!guide.includes('右侧属性'));
 check('FJ-01 引导说明下方修改这一条',guide.includes('在时间轴下方修改这一条'));
 check('FJ-02 添加目标可见=下一条添加到：舞者1',(await ev('document.getElementById("wbAddTarget").textContent'))==='下一条添加到：'+(await ev('store.dancers[0].name')));
 check('J3 空轨落点预告=第一个动作从 0.0s 开始',(await ev('document.getElementById("wbLanding").textContent')).includes('第一个动作从 0.0s 开始'));
 await shot('s1-enter');step('进入',{guide:guide});

 // ---------- §3-2 排第一条：动作库点 A ----------
 await until('document.querySelector(".act-item .ai-name")');
 const nameA=await ev('document.querySelector(".act-item .ai-name").textContent');
 await click('.act-item .ai-name',0,'select');await until('store.dancers[0].actionClips.length===1');
 const t1=await times(),dA=t1[0].duration;
 check('FJ-03 A 落 0–'+dA+'（默认编排占位 3 秒）',t1[0].start===0&&t1[0].duration===3);
 const lblA=await ev('(function(){var c=store.dancers[0].actionClips[0];var src=null;["emotes","actions"].forEach(function(k){if(src)return;src=((store[k]||[]).filter(function(x){return x.command===c.data.command})[0])||null});return clipDurationSourceLabel(c,store.measuredDur,src)})()');
 step('A-label',{label:String(lblA)});
 check('J3 时长来源=默认编排值（不可信来源如实标注；实际='+String(lblA).slice(0,60)+'）',String(lblA).indexOf('默认编排值')===0);

 // ---------- §3-3 排第二条：间隔 0，点 B ----------
 const nameB=await ev('document.querySelectorAll(".act-item .ai-name")[1].textContent');
 await click('.act-item .ai-name',1,'select');await until('store.dancers[0].actionClips.length===2');
 const t2=await times();
 const bStart=t2[1].start;
 check('FJ-03 B 落 '+bStart+'–'+(bStart+t2[1].duration)+'（上一条结束+间隔0）',Math.abs(bStart-dA)<1e-9&&t2[0].start===0);
 const land2=await ev('document.getElementById("wbLanding").textContent');
 check('FJ-03 落点预告一句话含上一条开始/编排/结束与开始相隔',/「.+」从 [\d.]+s 开始、编排 [\d.]+s、到 [\d.]+s 结束/.test(land2)&&land2.includes('两条开始相隔'));

 // ---------- §3-4 排第三条：间隔改 2，点 C ----------
 await type('#wbWaitInput','2');
 await until('document.getElementById("wbLanding").textContent.includes("等待 2.0s")');
 await click('.act-item .ai-name',2,'select');await until('store.dancers[0].actionClips.length===3');
 const t3=await times();const sorted3=t3.slice().sort((a,b)=>a.start-b.start);
 const cStart=Math.round((dA+t2[1].duration+2)*2)/2;
 check('FJ-03 C 落 '+cStart+'（A/B 不改）',Math.abs(sorted3[2].start-cStart)<1e-9&&sorted3[0].start===0&&Math.abs(sorted3[1].start-dA)<1e-9);
 const waitAfter=await ev('document.getElementById("wbWaitInput").value');
 check('FJ-02 添加设置继续使用（非一次性消费）',Number(waitAfter)===2);
 const land3=await ev('document.getElementById("wbLanding").textContent');
 check('J3 吸附预告如实（'+(dA+t2[1].duration+2)+' 已按现有 0.5 秒规则对齐）',land3.includes('已按现有 0.5 秒规则对齐')||Math.abs((dA+t2[1].duration+2)-cStart)<1e-9);
 await shot('s2-three-clips');step('排三条',{A:[0,dA],B:[bStart,bStart+t2[1].duration],C:[cStart,cStart+sorted3[2].duration]});

 // ---------- §3-5 改第二条：选 B，这条开始前间隔=1 ----------
 const idB=sorted3[1].id,idC=sorted3[2].id,idA=sorted3[0].id;
 await clickClip(idB);await until('!!document.getElementById("wbCtxWait")');
 const docB0=await tracksJson(); // R4：B 编辑全程完整生产序列化基线
 const ctxName=await ev('document.querySelector("#wbCtx .wb-ctx-name").textContent');
 check('FJ-02 编辑区标题=正在修改：舞者1 · 第2条「'+nameA+'」同库第二项」形式',ctxName.startsWith('正在修改：')&&ctxName.includes('第2条「'));
 check('FJ-02 编辑等待字段=这条开始前：与上一条结束相隔',(await ev('document.getElementById("wbCtxWait").getAttribute("aria-label")')).includes('这条开始前：与上一条结束相隔'));
 const before5=await times(),hist5=await historyLen();
 await type('#wbCtxWait','1');
 check('FJ-03 输入零写（时间轴与历史不变）',JSON.stringify(await times())===JSON.stringify(before5)&&await historyLen()===hist5);
 const pv5=await ev('document.getElementById("wbChangePreview").textContent');
 const expStart=Math.round((bStart+1)*1000)/1000;
 check('FJ-03 草稿预告：从 '+expStart+'s 开始…只改这条…后面的「C」仍从 '+cStart+'s 开始',pv5.includes('待应用：从 '+expStart.toFixed(3)+'s 开始')&&pv5.includes('只改这条，后面的片段不动')&&pv5.includes('仍从 '+cStart.toFixed(3)+'s 开始'));
 check('J3 时长来源标注（默认编排值）',pv5.includes('时长来源：默认编排值')||pv5.includes('草稿输入'));
 await shot('s3-edit-b-draft');step('改第二条草稿',{preview:pv5});

 // ---------- §3-6 取消再应用 ----------
 await click('#wbCtxTimeCancel',0,'ordinary');
 check('FJ-03 取消恢复已保存值（B 仍 '+bStart+'，零历史）',JSON.stringify(await times())===JSON.stringify(before5)&&await historyLen()===hist5);
 check('FJ-03/R4 取消＝完整生产序列化零变化（原生字节不变）',(await tracksJson())===docB0);
 check('FJ-03 取消后等待字段回原值',Number(await ev('document.getElementById("wbCtxWait").value'))===Math.round((bStart-dA)*1000)/1000);
 check('FJ-02 添加区间隔仍 2（两区互不回写）',Number(await ev('document.getElementById("wbWaitInput").value'))===2);
 await type('#wbCtxWait','1');await click('#wbCtxTimeApply',0,'ordinary');
 await until('Math.abs(store.dancers[0].actionClips.find(c=>c.id==='+idB+').start-'+expStart+')<1e-9');
 check('FJ-03 应用后 B '+expStart+'–'+(expStart+t2[1].duration)+'，仅一条撤销记录',await historyLen()===hist5+1);
 const after6=await times();
 // R4：应用＝完整生产序列化比较——期望文档=基线仅改 B 事件 startMs（保留 native ID/重复数组/嵌套字段）
 {
  const exp=await ev('(function(){var d=JSON.parse('+JSON.stringify(docB0)+');var found=0;d.tracks.forEach(function(t){(t.events||[]).forEach(function(e){if(String(e.id).replace(/^ev-/,"")===String('+idB+')&&"startMs" in e){e.startMs='+Math.round(expStart*1000)+';found++}})});return JSON.stringify({doc:d,found:found})})()');
  const expO=JSON.parse(exp);
  check('FJ-03/R4 期望构造：恰定位 1 条 B 事件（ev-'+idB+'）',expO.found===1);
  const diffApply=await docDiff(JSON.stringify(expO.doc),await tracksJson());
  check('FJ-03/R4 应用＝完整生产序列化：除 B 开始外逐路径相等（'+diffApply.length+' 差异）',diffApply.length===0);
 }
 check('FJ-03 A/C 不动（A 0–'+dA+'，C '+cStart+'）',after6.find(c=>c.id===idA).start===0&&after6.find(c=>c.id===idC).start===cStart);
 await click('button[title^="撤销上一步编辑"]',0,'ordinary');
 await until('Math.abs(store.dancers[0].actionClips.find(c=>c.id==='+idB+').start-'+bStart+')<1e-9');
 check('FJ-03 一次撤销回 '+bStart+'（撤销不新增历史项）',await historyLen()===hist5+1);
 {
  const dUndo=await docDiff(docB0,await tracksJson());
  if(dUndo.length)fs.writeFileSync(path.join(evidence,'undo-b-doc-debug.json'),JSON.stringify({diffPaths:dUndo,before:JSON.parse(docB0),after:JSON.parse(await tracksJson())},null,2));
  check('FJ-03/R4 撤销＝完整生产序列化恢复应用前文档（'+dUndo.length+' 差异路径）',dUndo.length===0);
 }
 await clickClip(idB);await until('!!document.getElementById("wbCtxWait")');
 await type('#wbCtxWait','1');await click('#wbCtxTimeApply',0,'ordinary');
 await until('Math.abs(store.dancers[0].actionClips.find(c=>c.id==='+idB+').start-'+expStart+')<1e-9');
 check('FJ-03 再经同一 UI 应用回 '+expStart+' 以继续旅程',true);
 await shot('s4-b-applied');step('取消再应用',{B:[expStart,expStart+t2[1].duration]});

 // ---------- §3-7 遇到冲突：B 开始前间隔=3（B 将 6–9 与 C 8–11 重叠） ----------
 const bDur=t2[1].duration,cDur=sorted3[2].duration;
 const histBefore7=await historyLen();
 const docR0=await tracksJson(); // R4：拒绝步完整生产序列化基线
 await type('#wbCtxWait','3');await click('#wbCtxTimeApply',0,'ordinary');
 await sleep(400);
 const dbg7={err:(await ev('(document.getElementById("wbCtxTimeError")||{textContent:"<no-el>"}).textContent')),times:await times(),prev7:await ev('document.getElementById("wbCtxWait").value'),start7:await ev('document.getElementById("wbCtxStartEdit").value'),hist7:await historyLen(),histBefore7:histBefore7};
 step('conflict-debug',dbg7);
 await until('document.getElementById("wbCtxTimeError").textContent.length>0');
 const err7=await ev('document.getElementById("wbCtxTimeError").textContent');
 const overlap=Math.round(((cStart)-(bStart+3+bDur))*1000)/1000;
 check('FJ-03 冲突被拒并说明与 C 重叠 '+Math.max(0,-overlap)+'s',/冲突|重叠/.test(err7)&&err7.includes('重叠 '+Math.max(0,-overlap).toFixed(3)+'s'));
 const after7=await times(),hist7v=await historyLen();
 check('FJ-03 拒绝后已保存仍 B '+expStart+' / C '+cStart+'，零新增历史',Math.abs(after7.find(c=>c.id===idB).start-expStart)<1e-9&&after7.find(c=>c.id===idC).start===cStart&&hist7v===histBefore7);
 check('FJ-03/R4 拒绝＝完整生产序列化零变化（原生字节不变）',(await tracksJson())===docR0);
 await click('#wbCtxTimeCancel',0,'ordinary');
 check('FJ-03 取消回已保存值（不挪 C、不截 B、不删内容）',Number(await ev('document.getElementById("wbCtxWait").value'))===1);
 await shot('s5-conflict-rejected');step('冲突拒绝',{error:err7});

 // ---------- §3-8 试看这一段（B：'+expStart+'–'+(expStart+bDur)+' → 循环 ±0.5s） ----------
 const rehBtn=await ev('document.getElementById("wbCtxRehearse").textContent');
 check('FJ-04 首点按钮即写「循环试看这一段」',rehBtn==='循环试看这一段');
 const rehHint=await ev('document.getElementById("wbCtxRehHint").textContent');
 const loopA=Math.max(0,Math.round((expStart-0.5)*10)/10),loopB=Math.round((expStart+bDur+0.5)*10)/10;
 check('FJ-04 点击前可见循环范围与停止方式（不只 title）',rehHint.includes(loopA.toFixed(1)+'–'+loopB.toFixed(1))&&rehHint.includes('停止'));
 await click('#wbCtxRehearse',0,'ordinary');await until('store.isPlaying===true');
 check('FJ-04 网页循环 '+loopA+'–'+loopB+'（两边各 0.5 秒）',await ev('store.loopA==='+loopA+'&&store.loopB==='+loopB));
 check('FJ-04 循环徽标=循环试看中 '+loopA+'–'+loopB,(await ev('document.getElementById("wbCtxLoop").textContent')).includes('循环试看中 '+loopA.toFixed(1)+'–'+loopB.toFixed(1)));
 await shot('s6-loop-rehearsal');step('循环试看',{loop:[loopA,loopB]});

 // ---------- §3-9 普通停止 ----------
 await click('.toolbar button[title^="停止"]',0,'ordinary');
 await until('store.isPlaying===false&&store.loopA===null&&store.loopB===null&&store.currentTime===0');
 const toast9=await ev('document.getElementById("toast").textContent');
 check('FJ-04 普通停止：网页停止归 0、本次循环退出并说明',toast9.includes('网页播放已停止')&&toast9.includes('归 0')&&toast9.includes('本次循环试看已退出'));
 check('FJ-04 不泛称删除 A/B、不称游戏已停',!toast9.includes('删除')&&!toast9.includes('游戏'));
 await shot('s7-normal-stop');step('普通停止',{toast:toast9});

 // ---------- §3-10 紧急停止分支（HTTP(S) 全阻断 → 游戏端未确认） ----------
 await click('#wbCtxRehearse',0,'ordinary');await until('store.isPlaying===true');
 await click('#immediateStop',0,'ordinary');
 await until('store.isPlaying===false');
 await until('document.getElementById("immediateStopStatus").textContent.indexOf("游戏端停止未确认")>=0');
 const stop10=await ev('document.getElementById("immediateStopStatus").textContent');
 check('FJ-04 网页已停与游戏未确认分开，保留位置与循环',stop10.includes('网页播放已停止')&&stop10.includes('游戏端停止未确认')&&stop10.includes('位置与循环范围保留'));
 check('FJ-04 立即停止保留播放头与循环范围',await ev('store.currentTime>0&&store.loopA==='+loopA+'&&store.loopB==='+loopB));
 check('FJ-04 不合并成全部停止成功',!stop10.includes('全部停止成功'));
 await shot('s8-immediate-stop-unconfirmed');step('紧急停止分支',{status:stop10});
 // §3-11 恢复到编辑：不自动恢复；普通停止退出循环后再继续
 await click('.toolbar button[title^="停止"]',0,'ordinary');
 await until('store.loopA===null&&store.loopB===null');
 check('FJ-04 按普通停止结束这次循环（不自动重试游戏）',await ev('store.loopA===null&&store.currentTime===0'));
 await clickClip(idB);await until('!!document.getElementById("wbCtxWait")');
 step('恢复到编辑');

 // ---------- §3-12 给 B 排走位（4 秒出发 · 用 3 秒 · 7 秒到达） ----------
 const docBefore12=await tracksJson();
 await click('#wbCtxMove',0,'nav');await until('!!document.getElementById("wbMoveBar")');
 const mvTitle=await ev('document.getElementById("wbMoveTitle").textContent');
 check('FJ-05 走位条=舞者 · 为「动作」排走位（滚到舞台不必回看上方）',mvTitle===(await ev('store.dancers[0].name'))+' · 为「'+nameB+'」排走位');
 check('FJ-05 同区显示 '+expStart+'s 出发 / 移动用时默认 '+bDur+' / 到达 '+(expStart+bDur),(await ev('document.querySelector("#wbMoveBar .wb-move-sub").textContent'))===expStart+'s 出发'&&Number(await ev('document.getElementById("wbMoveDur").value'))===bDur&&(await ev('document.getElementById("wbMoveEta").textContent')).includes('到达 '+(expStart+bDur)+'s'));
 check('J5 独立轨说明在「更多设置」',(await ev('document.getElementById("wbMoveBar").textContent')).includes('独立轨'));
 // 取消零改
 await click('#wbMoveCancel',0,'nav');await until('!document.getElementById("wbMoveBar")');
 check('FJ-05 取消零改（生产文档字节不变）',(await tracksJson())===docBefore12);
 // 重新点目的地并应用（真实指针点俯视图）
 await click('#wbCtxMove',0,'nav');await until('!!document.getElementById("wbMoveBar")');
 const ptr12=await clickTopWorld(1.4,-0.8);
 await until('ChoreoStageMotionUI.samePlaceState()&&ChoreoStageMotionUI.samePlaceState().dest');
 const st12=await ev('ChoreoStageMotionUI.samePlaceState()');
 // R5：容差按实际送达指针证明——意图点与送达整数指针≤1px（截断），落点与按实际指针反算的
 // 期望世界坐标之差只剩 0.005 量化＋浮点 ε（不再用放宽容差吸收映射误差）
 check('FJ-05/R5 送达指针＝意图点整数截断（≤1px）',!!ptr12.seen&&Math.abs(ptr12.seen.x-ptr12.sent[0])<1&&Math.abs(ptr12.seen.y-ptr12.sent[1])<1);
 check('FJ-05/R5 按实际指针反算：落点差≤0.0055（仅量化＋浮点）',!!ptr12.expectedFromSeen&&Math.abs(st12.dest.x-ptr12.expectedFromSeen.x)<=0.0055&&Math.abs(st12.dest.z-ptr12.expectedFromSeen.z)<=0.0055);
 const hint12=await ev('document.getElementById("wbMoveHint").textContent');
 check('FJ-05 已选目的地坐标＋保留用时与到达时刻提示',hint12.includes('已选目的地 ('+st12.dest.x+', '+st12.dest.z+')')&&hint12.includes('米；已保留用时与到达时刻。'));
 await type('#wbMoveDur','3');
 check('FJ-05 用时 3 → 到达 '+(expStart+3)+'（到达=出发+用时）',Number(await ev('document.getElementById("wbMoveArrival").value'))===expStart+3);
 await shot('s9-move-dest');step('走位草稿',{dest:st12.dest});
 const beforeApply12=await times();
 await click('#wbMoveApply',0,'confirm');
 await until('!document.getElementById("wbMoveBar")');
 const after12=await times();
 check('FJ-05 应用写入走位轨，A/B/C 开始与长度不改',JSON.stringify(after12)===JSON.stringify(beforeApply12));
 // R4-A：走位应用只新增一条 movement，移除此项后整个文档零差异。
 // native ID、数组次序、重复项和嵌套字段均参与比较。
 {
  // 比较器逐个候选移除，禁止仅按 .tracks 前缀放行或按 ID 折叠。
  const docApplied=await tracksJson();
  const mv=await ev('JSON.stringify('+movementDeltaJs+'('+cleanDocJs+'(JSON.parse('+JSON.stringify(docBefore12)+')),'+cleanDocJs+'(JSON.parse('+JSON.stringify(docApplied)+')),'+diffPathsJs+'))');
  const mvO=JSON.parse(mv);
  json('movement-documents',{before:JSON.parse(docBefore12),after:JSON.parse(docApplied),comparison:mvO});
  check('FJ-05/R4 应用＝完整生产序列化：差异仅限走位子树（'+mvO.paths.length+' 路径，新增 '+JSON.stringify(mvO.addedTypes)+'）',mvO.ok&&mvO.addedTypes.length===1&&mvO.addedTypes[0]==='movement');
 }
 const mv12=await ev('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return t?t.events[0].data.stageMotion.points.map(function(p){return {t:p.tMs,x:p.x,z:p.z,move:p.move||"walk"}}):null})()');
 check('FJ-05 节点=4s 出发保持＋7s 到达目的地（走路）',!!mv12&&mv12.length===2&&mv12[0].t===Math.round(expStart*1000)&&mv12[1].t===Math.round((expStart+3)*1000)&&Math.abs(mv12[1].x-st12.dest.x)<0.01&&mv12[1].move==='walk');
 // 合成无先前路径：4 秒前保持原位，4–7 秒位置变化（生产采样器只读断言）
 const posAt=async t=>ev('(function(){var b=ChoreoEdit.pure.placementFor(store.dancers,0);var p=ChoreoStageMotion.sample(store,0,'+t+',b);return {x:p.x,z:p.z}})()');
 const p35=await posAt(3500),p55=await posAt(5500),pBase=await ev('ChoreoEdit.pure.placementFor(store.dancers,0)');
 check('FJ-05 4 秒前保持原位、4–7 秒位置变化',Math.abs(p35.x-pBase.x)<1e-6&&Math.abs(p35.z-pBase.z)<1e-6&&(Math.abs(p55.x-pBase.x)>1e-6||Math.abs(p55.z-pBase.z)>1e-6));
 // 撤销恢复完整编排内容（完整生产序列化对比，仅排除版本号与 UI 选择标记）
 const docApplied12=await tracksJson();
 await click('button[title^="撤销上一步编辑"]',0,'ordinary');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !t})()');
 const docUndo12=await tracksJson();
 const eqDocs=await ev('JSON.stringify('+cleanDocJs+'('+docUndo12+'))')===await ev('JSON.stringify('+cleanDocJs+'('+docBefore12+'))');
 if(!eqDocs)fs.writeFileSync(path.join(evidence,'undo-doc-debug.json'),JSON.stringify({before:JSON.parse(docBefore12),after:JSON.parse(docUndo12)},null,2));
 check('FJ-05 一次撤销恢复完整编排内容（保留 ID/数组/重复项/嵌套）',eqDocs&&docUndo12!==docApplied12);
 await shot('s10-move-applied-undo');step('走位应用与撤销',{points:mv12});

 // ---------- FJ-05 窄窗 640×800：舞台区仍可辨识舞者/动作/出发/用时/到达 ----------
 await send('Emulation.setDeviceMetricsOverride',{width:640,height:800,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===640');await sleep(300);
 await clickClip(idB);await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');await until('!!document.getElementById("wbMoveBar")');
 // 窄窗旅程语义：先滚到舞台（用户动作），再要求走位条同区可辨识
 await ev('(function(){var n=document.getElementById("wbMoveBar");if(n)n.scrollIntoView({block:"center"});return true})()');
 await sleep(250);
 const mvVisible=await ev(`(function(){var ids=['wbMoveTitle','wbMoveDur','wbMoveEta'];for(var i=0;i<ids.length;i++){var n=document.getElementById(ids[i]);if(!n)return false;var r=n.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)return false;if(!n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false}return true})()`);
 check('FJ-05 640px 走位条舞者/动作/用时/到达可见可点',mvVisible);
 check('FJ-05 640px 俯视画布≥180px 可点目的地',await ev('document.getElementById("wbTopView").getBoundingClientRect().height>=180'));
 await shot('s11-640-move');step('窄窗走位');
 await click('#wbMoveCancel',0,'nav');await until('!document.getElementById("wbMoveBar")');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

 // ---------- FJ-02 补充：另一个舞者 / 添加到全部舞者 / 首条无前驱 ----------
 await click('#wbAddDancer',0,'ordinary');await until('store.dancers.length===2');
 await click('.add-all-row input',0,'nav');
 await until('document.getElementById("wbAddTarget").textContent.indexOf("下一条添加到：全部舞者")===0');
 check('FJ-02 添加目标随「添加到全部舞者」如实显示',true);
 const landAll=await ev('document.getElementById("wbLanding").textContent');
 step('addall-debug',{land:landAll,addToAll:await ev('store.addToAll'),insert:await ev('ChoreoWorkbench.insertAt()')});
 check('FJ-02 全部添加时预告只代表当前舞者（各舞者各自轨末尾）',landAll.includes('各舞者按自己的轨末尾落位'));
 await click('.add-all-row input',0,'nav');
 await until('document.getElementById("wbAddTarget").textContent.indexOf("下一条添加到：全部舞者")<0');
 check('FJ-02 关闭后恢复单舞者目标',(await ev('document.getElementById("wbAddTarget").textContent')).startsWith('下一条添加到：'));
 // 首条无前驱：选 A，无「这条开始前」字段、无伪造上一条
 await clickClip(idA);await until('!!document.getElementById("wbCtx")');
 check('FJ-02 首条无前驱：不出现「这条开始前」等待字段',await ev('!document.getElementById("wbCtxWait")'));
 const pvA=await ev('document.getElementById("wbChangePreview").textContent');
 check('FJ-02 首条预告不显示伪造的上一条',!pvA.includes('上一条从'));
 await shot('s12-first-no-prev');step('FJ-02 补充');

 // ---------- FJ-01 补充：显式插入仍可用（不作默认） ----------
 await ev('(function(){var w=document.getElementById("timelineWrap");if(w)w.scrollLeft=0;return true})()');
 // 真实键盘 T（既有快捷键）：把当前播放头时刻设为插入时刻，进入「插在这里」
 if(await ev('document.activeElement&&document.activeElement.tagName==="INPUT"'))await key('Escape',27,'Escape'); // 输入框内 Esc=取消草稿（此处草稿已净，零写）
 await key('KeyT',84,'t');
 await sleep(300);
 step('fj01-key',{focus:await ev('document.activeElement&&document.activeElement.tagName'),insert:await ev('window.ChoreoWorkbench?ChoreoWorkbench.insertAt():null'),now:await ev('store.currentTime')});
 await until('!!document.querySelector("[data-wb=insert]")');
 check('FJ-01 显式「插在这里」保留（键盘 T 进入，不充当默认）',await ev('!!document.querySelector("[data-wb=insert]")&&!!document.querySelector("[data-wb=back-append]")'));
 await click('[data-wb=back-append]',0,'nav');await until('!!document.querySelector("[data-wb=add-next]")');
 step('FJ-01 补充');

 // ---------- FJ-04 补充（R4）：退出循环 / 手改 A/B 组合 ----------
 await clickClip(idB);await until('!!document.getElementById("wbCtxRehearse")');
 await click('#wbCtxRehearse',0,'ordinary');await until('store.isPlaying===true&&store.loopA!=null');
 check('FJ-04/R4 组合①激活态按钮即「退出循环试看」',await ev('document.getElementById("wbCtxRehearse").textContent==="退出循环试看"'));
 await click('#wbCtxRehearse',0,'ordinary');await until('store.loopA===null&&store.loopB===null&&store.isPlaying===true');
 const exitToast=await ev('document.getElementById("toast").textContent');
 check('FJ-04/R4 组合①退出循环：循环端点清空、播放不中断、如实说明',exitToast.includes('已退出循环试看')&&exitToast.includes('不中断'));
 await click('.toolbar button[title^="停止"]',0,'ordinary');await until('store.isPlaying===false&&store.currentTime===0');
 // 手改 A/B：真实键盘输入＋回车提交（不经播放头）
 await type('#loopAInput','2');await key('Enter',13,'Enter');
 await type('#loopBInput','6');await key('Enter',13,'Enter');
 await until('store.loopA===2&&store.loopB===6');
 check('FJ-04/R4 组合②手改 A/B 写入（2–6，不经播放头）',await ev('store.loopA===2&&store.loopB===6'));
 await click('#playBtn',0,'ordinary');await until('store.isPlaying===true');
 await click('.toolbar button[title^="停止"]',0,'ordinary');await until('store.isPlaying===false&&store.currentTime===0');
 const stopM=await ev('document.getElementById("toast").textContent');
 check('FJ-04/R4 组合②普通停止保留手动 A/B 并说明',await ev('store.loopA===2&&store.loopB===6')&&stopM.includes('手动循环范围 A/B 仍保留'));
 await click('#playBtn',0,'ordinary');await until('store.isPlaying===true');
 await click('#immediateStop',0,'ordinary');
 await until('document.getElementById("immediateStopStatus").textContent.indexOf("游戏端停止未确认")>=0');
 check('FJ-04/R4 组合③立即停止未确认时手动循环范围保留',await ev('store.loopA===2&&store.loopB===6'));
 await click('.toolbar button[title^="停止"]',0,'ordinary');await until('store.isPlaying===false');
 await click('.transport button[title="清除 A-B 循环"]',0,'ordinary');await until('store.loopA===null&&store.loopB===null');
 check('FJ-04/R4 清除 A-B 循环收尾（范围已清）',await ev('store.loopA===null&&store.loopB===null'));
 await shot('s14-fj04-combos');step('FJ-04 补充');

 // ---------- FJ-06 预览承诺：分层素材状态 ----------
 await click('#wbTab3d',0,'nav');await until('document.getElementById("wbTopHost").hidden===true');
 // 离线环境 3D 面板常已自动打开：状态行已存在就直接用，否则真实点击打开
 if(!(await ev('!!document.querySelector(".p3d-status")'))){
   await click('#wbOpen3d',0,'nav').catch(async()=>{await button('打开 3D 预览','#previewDock');});
 }
 await until('!!document.querySelector(".p3d-status")');
 for(let i=0;i<60;i++){const s=await ev('document.querySelector(".p3d-status").textContent');if(s.includes('就绪（'))break;await sleep(500)}
 const p3dStatus=await ev('document.querySelector(".p3d-status").textContent');
 check('FJ-06 预览能力分层文案（替身示意/真实模型只承诺各自可见范围）',/就绪（/.test(p3dStatus)&&(/替身示意/.test(p3dStatus)||/真实模型可看/.test(p3dStatus)));
 check('FJ-06 顺序/时刻/站位路径始终可查的提示',p3dStatus.includes('时间轴'));
 const miss=await ev('(document.querySelector(".p3d-miss")||{}).textContent||""');
 check('FJ-06 缺失按实际能力提示（替身/未录制如实，不伪造动作）',miss===''||miss.includes('替身')||miss.includes('未录制')||miss.includes('模型'));
 await shot('s13-p3d-tier');step('FJ-06',{status:p3dStatus.slice(0,160),miss:miss.slice(0,120)});

 // ---------- FJ-06 补充（R4）：四层隔离合成资源状态（合成播种独立标注，非真实素材/非游戏结果） ----------
 // L2 内置替身已由上方默认状态覆盖（s13）。L3/L4：播种合成档案（骨架=内置快照、模型=内置
 // 替身模型字节，经 ChoreoLibrary 真实建档）→ 活动档案＝该合成档案 → 真实模型层：先缺动作
 // 素材（L3，未录制名单），再在档案内补齐首个动作（L4，该动作离开未录制名单）。
 const seed=await evx('(async function(){try{var lib=window.ChoreoLibrary;if(!lib||!lib.available())return {error:"library-unavailable"};var snap=window.__CHOREO_SKELETON_SNAPSHOT__,stm=window.__CHOREO_STANDIN_MODEL__;if(!snap||!snap.bones||!stm)return {error:"snapshot-or-standin-missing",hasSnap:!!snap,hasStm:!!stm};var p=await lib.createProfile({name:"合成替身档案—FJ06",skeleton:snap,files:[{name:"model.gltf",blob:new Blob([JSON.stringify(stm)],{type:"model/gltf+json"})}]});return {pid:p&&p.id,name:p&&p.name,boneCount:snap.count,profileKeys:p?Object.keys(p):null}}catch(e){return {error:String(e&&e.message||e),stack:String(e&&e.stack||"").slice(0,300)}}})()');
 step('fj06-seed',{seed:seed,note:'合成资料播种（隔离）：内置骨架快照＋内置替身模型字节经 ChoreoLibrary 建档；非真实素材、非游戏结果'});
 if(!seed||!seed.pid)throw Error('FJ-06 合成档案播种失败：'+JSON.stringify(seed));
 await ev('window.__p3dBindingsChanged();true');
 let tier3='';
 for(let i=0;i<90;i++){tier3=await ev('(document.querySelector(".p3d-status")||{textContent:""}).textContent');if(/真实模型可看/.test(tier3))break;await sleep(500)}
 check('FJ-06/R4 L3 有模型但缺素材：只承诺已匹配的动作素材',/真实模型可看/.test(tier3)&&/仅限已匹配的动作素材/.test(tier3));
 // 离线全阻断＝无法查证"没录过"：产品如实标「插件未连接…动作状态未知」，不伪称未录制
 const miss3=await ev('(document.querySelector(".p3d-miss")||{textContent:""}).textContent');
 check('FJ-06/R4 L3 缺素材离线如实＝动作状态未知（不伪造未录制结论）',miss3.includes('插件未连接')&&miss3.includes('动作状态未知'));
 await shot('s15-fj06-l3-realmode-missing');
 const cmdA=await ev('store.dancers[0].actionClips[0].data.command');
 const fj06Name=String(cmdA).replace(/^\//,'').replace(/\//g,'_');
 await evx('(async function(){await ChoreoLibrary.putClip('+JSON.stringify(fj06Name)+',{bones:[{name:"Hips",frames:[[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0]]}],type:"once",duration:2000},'+JSON.stringify(seed.pid)+');return true})()');
 await ev('window.__p3dLibChanged();true');
 // L4 匹配素材：重扫后该动作由本地资料库供给（状态栏如实计入 libHits；B/C 仍状态未知不影响本断言）
 let tier4='';
 for(let i=0;i<90;i++){tier4=await ev('(document.querySelector(".p3d-status")||{textContent:""}).textContent');if(/本地资料库已供/.test(tier4))break;await sleep(500)}
 check('FJ-06/R4 L4 档案补齐后本地资料库供该动作（'+fj06Name+'）',/本地资料库已供/.test(tier4));
 await shot('s16-fj06-l4-matched');
 // L1 边界（如实登记，不伪造）：无可显示模型层需要 _dancerMaster 全空；buildMasters 以
 // dancers.map(()=>primaryMaster) 建表且主母版恒在（含替身兜底），≥1 舞者时经 UI 不可达。
 step('fj06-l1-boundary',{note:'L1 仅时间资料层在有舞者项目不可达（preview3d buildMasters：dancers.map(()=>primaryMaster)，主母版恒有替身兜底）；不以合成手段伪造该层 UI 证据'});

 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0);
 check('未发起非本机 HTTP(S) 请求（全阻断；localhost 游戏停止请求被拦即未确认）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app-auth.js','choreo-app-edit-tx.js','choreo-app-timeline.js','choreo-app-render.js','choreo-app-catalog.js','choreo-app-dancers.js','choreo-app.js','choreo-app-playback.js','choreo-props-ui.js','choreo-workbench.js','choreo-stage-motion-ui.js','choreo-stop.js','preview3d.js','choreo-bootstrap.js']){
  const h=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('counts',counts);json('steps',steps);json('errors',errors);json('requests',requests);json('dialogs',dialogs);json('hashes',hashes);
 console.log('\nFirstMacroJourney: '+checks.length+' checks passed');
 }catch(e){json('failure',{message:e.message,stack:e.stack});json('checks',checks);json('steps',steps);json('errors',errors);json('requests',requests);console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
