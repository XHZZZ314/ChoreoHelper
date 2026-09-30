// TASK-20260919-UI-OVERHAUL P4-B 旅程式浏览器探针：项目中心与检查。
// 覆盖：①顶栏「项目」「检查」形态定稿（#02 尾）——「📂 文件」菜单收编进项目中心，能力逐项不删；
// ②项目中心——打开/新建（P1-A「新建直回工作台」语义保持）＋「历史」折叠（手动存版本/备注≤120 字/
//   恢复 confirm/恢复前自动存档/另存独立项目）＋「导入导出」折叠（导出 JSON/宏TXT/导入为新项目）＋
//   危险区（清空须输入「清空」、门槛不降、清空后可撤销）；
// ③检查——顶栏「检查」→问题列表＋定位到片段（关弹窗→播放头跳时刻→选中高亮→滚动居中），
//   实时徽标保留（choreo-check.js 规则零改动）；
// ④实时体检重建竞争收口（P4-A 验收 N1 必办）——签名变化不得整页 render() 打断根内输入；
//   本探针在上下文栏输入框真实打字期间直接驱动 runRealtimeCheck()（不以等待/settle 规避），
//   断言输入框未重建、焦点保持、值不丢失、期间无整页 render、描边经局部更新生效。
// 真实指针（CDP 真实鼠标/键盘），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，一次性 throwaway
// 资料（不触真实工程/私人资产/游戏端点、不写 live）。证据目录由 CHOREO_PROJECT_CHECK_EVIDENCE 指定
// 且必须全新。夹具明示：重叠布局与导入 JSON 均为探针自建确定性数据；无属主私有资料。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_PROJECT_CHECK_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_PROJECT_CHECK_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0,chooser=null;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
// 注：不用 replMode——本机 headless Chrome 在 replMode 下 awaitPromise 不返回解析值（Promise 对象原样回来），
// 会让 Promise 表达式断言假通过；普通脚本模式 + awaitPromise 正常返回解析值。
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<250;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Page.fileChooserOpened')chooser=m.params;if(m.method==='Fetch.requestPaused')route(m.params).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('DOM.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Page.setInterceptFileChooserDialog',{enabled:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:evidence});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 // 演练：原生 prompt/confirm 改为确定性返回值（新建命名 / 恢复确认）
 await ev('window.__pcPrompt=null;window.__pcConfirm=false;window.prompt=function(){return window.__pcPrompt};window.confirm=function(){return window.__pcConfirm}');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){
 // 先把真实指针挪到左上角清掉悬停/提示层（同真实用户移开鼠标），避免提示层遮挡命中测试
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await sleep(40);
 return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})
}
// 注：mouseReleased 带 buttons:1——本机 headless Chrome 在 release 报 buttons:0 时偶发不合成 click
// （mousedown/mouseup 都到达目标却无 click）；带上按下位掩码后稳定合成，不改变真实指针语义。
async function clickAt(p,modifiers=0){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,buttons:1,modifiers});await sleep(140)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function type(selector,text){
 await click(selector,0,'input');
 // 无头环境真实点击偶发不接力焦点：真实点击后确保焦点在目标，键盘才不会落到全局快捷键
 const focused=await ev('(function(){var n=document.querySelector('+JSON.stringify(selector)+');if(n&&document.activeElement!==n)n.focus();return !!n&&document.activeElement===n})()');
 if(!focused)throw Error('Focus failed '+selector);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(160);
}
async function key(k,code,vk,modifiers=0){for(const t of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:t,key:k,code,windowsVirtualKeyCode:vk,modifiers});await sleep(90)}
async function undo(){await click('button[title^="撤销上一步编辑"]',0,'nav');await sleep(180)}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body '+JSON.stringify({r:{l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height},w:{l:w.left,r:w.right,t:w.top,b:w.bottom},scroll:document.getElementById('timelineWrap').scrollLeft,left:left,right:right,iw:innerWidth,ih:innerHeight}))})()`);counts.select++;return p}
async function clickClip(id,modifiers=0){
 await ev('(function(){ChoreoEdit.pure.eachClip(store,function(c){if(c.id==='+id+'){var w=document.getElementById("timelineWrap");if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return true})()');
 await sleep(200);
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id),modifiers);
}
async function clickToolbar(label,kind){
 const idx=await ev('Array.from(document.querySelectorAll(".toolbar-nav button")).findIndex(function(b){return b.textContent.indexOf('+JSON.stringify(label)+')>=0})');
 if(idx<0)throw Error('toolbar missing '+label);
 await click('.toolbar-nav button',idx,kind||'nav');
}
async function clickButtonIn(container,text,kind){
 const sel=container+' button';
 const idx=await ev('Array.from(document.querySelectorAll('+JSON.stringify(sel)+')).findIndex(function(b){return b.textContent==='+JSON.stringify(text)+'})');
 if(idx<0)throw Error('button missing '+text+' in '+container);
 await click(sel,idx,kind||'confirm');
}
async function setFileInput(selector,file){
 const doc=await send('DOM.getDocument');
 const q=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
 if(!q.nodeId)throw Error('file input missing '+selector);
 await send('DOM.setFileInputFiles',{files:[file],nodeId:q.nodeId});
}
(async()=>{try{
 await open();
 // ---------- S0 空态→从零开始→两个连续动作（第二个带「上一个结束后等待」上下文栏） ----------
 await until('document.getElementById("wbEmpty")');
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".tl-area")&&document.querySelector(".act-item")');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===2');
 const a0=await ev('store.dancers[0].actionClips[0].id'),a1=await ev('store.dancers[0].actionClips[1].id');
 check('PC-0 准备：两条连续动作片段（第二条有前驱，可改等待）',await ev('store.dancers[0].actionClips.length===2&&store.dancers[0].actionClips[1].start>0'));
 await shot('s0-setup');step('S0 准备',{a0:a0,a1:a1});

 // ---------- S1 顶栏形态定稿（#02 尾）：项目 / 检查；文件菜单收编 ----------
 check('PC-1 顶栏「项目」入口在场并指向项目中心',await ev('Array.from(document.querySelectorAll(".toolbar-nav button")).some(function(b){return b.textContent.indexOf("项目")>=0&&b.title.indexOf("项目中心")>=0})'));
 check('PC-1 顶栏「检查」入口在场（id=btnCheck 保留）',await ev('(function(){var b=document.getElementById("btnCheck");return !!b&&b.textContent.indexOf("检查")>=0})()'));
 check('PC-1「📂 文件」按钮与下拉菜单已收编（不再有 fileBtn/filePop）',await ev('!document.getElementById("fileBtn")&&!document.getElementById("filePop")'));
 check('PC-1 隐藏导入文件输入保留（项目中心导入共用）',await ev('!!document.getElementById("fileInput")'));
 check('PC-1 顶栏不建「开演」入口（P5 占位不建）',await ev('!Array.from(document.querySelectorAll(".toolbar-nav button")).some(function(b){return b.textContent.indexOf("开演")>=0})'));
 await shot('s1-topbar');step('S1 顶栏形态');

 // ---------- S2 实时体检重建竞争收口（P4-A N1 必办） ----------
 await clickClip(a1);
 await until('document.getElementById("wbCtxWait")');
 await ev('runRealtimeCheck()'); // 基线：把签名对齐到当前干净布局（不是等待/规避，是断言前的确定性起点）
 await ev('window.__pcInput=document.getElementById("wbCtxWait");window.__pcRC=store._renderCount');
 await type('#wbCtxWait','12'); // 未提交（oninput 只预览）：连续打字进行中
 // 模拟一次后台编排变化落到 store（真实编辑会先 render；这里隔离“体检结果到达”这一竞争）
 await ev('(function(){var d=store.dancers[0],a=d.actionClips[0],b=d.actionClips[1];a.start=0;a.duration=Math.max(1,b.start+1);return true})()');
 await ev('runRealtimeCheck()'); // 直接驱动真实实时体检路径：签名已变化，旧实现会在这里整页 render()
 check('PC-2 体检签名变化不再整页重建：上下文栏输入框未重建',await ev('(function(){var n=document.getElementById("wbCtxWait");return !!n&&n===window.__pcInput&&n.isConnected})()'));
 check('PC-2 输入焦点保持（打字未被打断）',await ev('document.activeElement===window.__pcInput'));
 check('PC-2 连续打字的值不丢失、未被回填',await ev('document.getElementById("wbCtxWait").value==="12"'));
 check('PC-2 期间无整页 render()（_renderCount 不增长）',await ev('store._renderCount===window.__pcRC'));
 check('PC-2 新问题经局部更新立即上色（两条红描边）',await ev('document.querySelectorAll(".clip.issue-red").length===2'));
 check('PC-2 顶栏徽标同步红计数（实时徽标保留）',await ev('(function(){var s=document.querySelector("#btnCheck .chk-badge");return !!s&&s.textContent.indexOf("红")>=0})()'));
 await shot('s2-race-typing');step('S2 重建竞争收口');

 // ---------- S3 检查→问题列表＋定位（#49 前半；jumpTo 语义保留） ----------
 // 打字值在失焦时按既有语义提交（wait onchange→commit→render）：先点中性标题完成这次提交，
 // 再重建确定性重叠布局，隔离后续「检查→定位」场景（不掩盖 PC-2 的竞争断言）。
 const beforeCommit=await ev('store.dancers[0].actionClips[1].start');
 await click('.timeline-section-title',0,'nav');
 await until('store.dancers[0].actionClips[1].start!=='+beforeCommit);
 await ev('(function(){var d=store.dancers[0],a=d.actionClips[0],b=d.actionClips[1];a.start=0;a.duration=5;b.start=2;b.duration=2;saveHistory();updateTotalDuration();render();return true})()');
 await until('document.querySelectorAll(".clip.issue-red").length===2');
 await click('#btnCheck',0,'nav');
 await until('document.querySelector(".modal h3")&&document.querySelector(".modal h3").textContent.indexOf("编舞体检")>=0');
 await until('(function(){var i=document.querySelector(".modal div");return document.querySelector(".modal").textContent.indexOf("检查完成")>=0})()');
 check('PC-3 顶栏「检查」打开问题列表（分组与计数）',await ev('document.querySelector(".modal").textContent.indexOf("红 ")>0&&document.querySelector(".modal").textContent.indexOf("点条目跳到对应位置")>0'));
 const rowIdx=await ev('Array.from(document.querySelectorAll(".modal div[style*=\'border-left\']")).findIndex(function(n){return n.textContent.indexOf("时间重叠")>=0})');
 check('PC-3 问题列表含重叠条目（真实规则，choreo-check.js 零改动）',rowIdx>=0);
 await ev('window.__pcJump=(store.checkIssues||[]).find(function(i){return i.level==="red"&&i.rule==="overlap"})');
 await click('.modal div[style*=\'border-left\']',rowIdx,'select');
 await until('!document.querySelector(".modal")');
 check('PC-3 定位：点条目关弹窗→播放头跳到问题时刻',await ev('Math.abs(store.currentTime-window.__pcJump.t)<0.001'));
 check('PC-3 定位：问题片段被选中高亮',await ev('!!store.selectedClip&&store.selectedClip.id===window.__pcJump.clipId&&!!document.querySelector(".clip.selected")'));
 check('PC-3 定位：时间轴滚动到该时刻居中',await ev('(function(){var w=document.getElementById("timelineWrap");var want=Math.max(0,LABEL_W+store.currentTime*store.pps-w.clientWidth/2);return Math.abs(w.scrollLeft-want)<2})()'));
 await shot('s3-jump');step('S3 检查定位');

 // ---------- S4 项目中心：打开/新建＋历史折叠 ----------
 await clickToolbar('项目');
 await until('document.getElementById("projectCenterModal")');
 check('PC-4 项目中心：打开/新建与项目列表在场',await ev('!!document.getElementById("projectSearch")&&Array.from(document.querySelectorAll("#projectCenterModal button")).some(function(b){return b.textContent==="➕ 新建项目"})'));
 check('PC-4「历史」折叠默认收起，内含手动存版本与版本备注（≤120 字）',await ev('(function(){var d=document.getElementById("projectHistoryFold");return !!d&&d.open===false&&d.contains(document.getElementById("projectVersionLabel"))&&Array.from(d.querySelectorAll("button")).some(function(b){return b.textContent==="💾 给当前项目存个版本"})})()'));
 check('PC-4 版本备注可访问名称与长度限制保留',await ev('document.getElementById("projectVersionLabel").maxLength===120&&!!document.getElementById("projectVersionLabel").getAttribute("aria-label")'));
 await click('#projectHistoryFold>summary',0,'nav');
 await until('document.getElementById("projectHistoryFold").open===true');
 check('PC-4「历史」折叠可展开（原生 details）',true);
 await until('document.getElementById("projectHistoryFold").textContent.indexOf("5 分钟")>=0');
 check('PC-4「历史」折叠说明保留自动存档口径（最多 20 个 / 每 5 分钟）',await ev('(function(){var t=document.getElementById("projectHistoryFold").textContent;return t.indexOf("20")>=0&&t.indexOf("5 分钟")>=0})()'));
 await shot('s4-history-fold');step('S4 项目中心与历史折叠');

 // ---------- S5 手动存版本 / 恢复 confirm / 恢复前自动存档 / 另存独立项目 ----------
 await type('#projectVersionLabel','P4B 检阅版本');
 await clickButtonIn('#projectCenterModal','💾 给当前项目存个版本');
 await until('document.getElementById("projectVersionStatus").textContent.indexOf("已保存")>=0');
 check('PC-5 手动存版本成功并回执备注',true);
 check('PC-5 版本列表读到新版本且标签保留',await ev('ChoreoProjects.listVersions(store.projectId).then(function(vs){return vs.some(function(v){return v.label==="P4B 检阅版本"})})'));
 check('PC-5 版本条目提供「恢复到此版本」「复制为新项目」（另存独立项目）',await ev('Array.from(document.querySelectorAll("#projectCenterModal button")).some(function(b){return b.textContent==="恢复到此版本"})&&Array.from(document.querySelectorAll("#projectCenterModal button")).some(function(b){return b.textContent==="复制为新项目"})'));
 const baseN=await ev('store.dancers[0].actionClips.length');
 await ev('(function(){var d=store.dancers[0];d.actionClips.push({id:store.nextClipId++,start:30,duration:1,data:{name:"恢复前临时",command:"/bow",category:"usual"}});saveHistory();updateTotalDuration();render();return true})()');
 await until('store.dancers[0].actionClips.length==='+(baseN+1));
 await ev('window.__pcConfirm=false');
 await clickButtonIn('#projectCenterModal','恢复到此版本');
 await sleep(250);
 check('PC-5 恢复确认取消→零改动且面板保留',await ev('store.dancers[0].actionClips.length==='+(baseN+1)+'&&!!document.getElementById("projectCenterModal")'));
 await ev('window.__pcConfirm=true');
 await clickButtonIn('#projectCenterModal','恢复到此版本');
 await until('store.dancers[0].actionClips.length==='+baseN);
 check('PC-5 恢复→内容回到该版本（弹窗关闭）',await ev('!document.getElementById("projectCenterModal")'));
 check('PC-5 恢复前自动存档（新版本「恢复版本前自动保存」）',await ev('ChoreoProjects.listVersions(store.projectId).then(function(vs){return vs.some(function(v){return v.label==="恢复版本前自动保存"})})'));
 // 另存独立项目：不切换当前项目、原项目与历史保留
 await clickToolbar('项目');
 await until('document.getElementById("projectCenterModal")');
 await click('#projectHistoryFold>summary',0,'nav');
 await until('document.getElementById("projectHistoryFold").open===true');
 const pid=await ev('store.projectId'),projN=await ev('ChoreoProjects.listProjects().then(function(l){return l.length})');
 await clickButtonIn('#projectCenterModal','复制为新项目');
 await until('ChoreoProjects.listProjects().then(function(l){return l.length>'+(projN)+'})');
 check('PC-5 历史版本另存独立项目：副本创建、原项目保留',await ev('store.projectId==='+JSON.stringify(pid)));
 check('PC-5 另存后可明确打开副本（不自动切换）',await ev('Array.from(document.querySelectorAll("#projectCenterModal button")).some(function(b){return b.textContent==="打开副本"})'));
 await shot('s5-history-actions');step('S5 历史版本动作');

 // ---------- S6 导入导出折叠（导出/宏TXT/导入为新项目逐项不删） ----------
 check('PC-6「导入导出」折叠默认收起',await ev('(function(){var d=document.getElementById("projectIoFold");return !!d&&d.open===false})()'));
 await click('#projectIoFold>summary',0,'nav');
 await until('document.getElementById("projectIoFold").open===true');
 check('PC-6 折叠内含导出/宏TXT/导入为新项目',await ev('(function(){var d=document.getElementById("projectIoFold");var t=Array.from(d.querySelectorAll("button")).map(function(b){return b.textContent});return t.indexOf("导出")>=0&&t.indexOf("宏TXT")>=0&&t.indexOf("导入为新项目")>=0})()'));
 await clickButtonIn('#projectIoFold','导出');
 await until('document.getElementById("toast").textContent.indexOf("已导出项目编排与引用")>=0');
 check('PC-6 导出 JSON 可点且有明确回执（不含历史/资产说明）',true);
 await clickButtonIn('#projectIoFold','宏TXT');
 await until('document.getElementById("toast").textContent.indexOf("宏已导出")>=0');
 check('PC-6 宏TXT 可点且有明确回执',true);
 const fixture=path.join(evidence,'import-fixture.json');
 fs.writeFileSync(fixture,JSON.stringify(JSON.parse(await ev('JSON.stringify(projectRecord().content)')),null,2));
 const beforeImport=await ev('ChoreoProjects.listProjects().then(function(l){return l.length})');
 await clickButtonIn('#projectIoFold','导入为新项目');
 for(let i=0;i<20&&!chooser;i++)await sleep(50); // 等 Page.fileChooserOpened（按钮已真实触发文件输入）
 if(chooser&&chooser.backendNodeId)await send('DOM.setFileInputFiles',{backendNodeId:chooser.backendNodeId,files:[fixture]});
 else await setFileInput('#fileInput',fixture); // 事件缺失时回退：仍走同一 change 链
 await until('document.getElementById("toast").textContent.indexOf("已保存为独立项目")>=0');
 check('PC-6 导入为新项目：独立副本创建并切换',await ev('ChoreoProjects.listProjects().then(function(l){return l.length>'+(beforeImport)+'})')&&await ev('!!store.projectName&&store.projectName.indexOf("副本")>=0'));
 check('PC-6 导入后项目中心只保留一层（旧面板被替换）',await ev('document.querySelectorAll("#projectCenterModal").length===1'));
 await shot('s6-io-import');step('S6 导入导出');

 // ---------- S7 危险区：清空须输入「清空」、门槛不降、清空后可撤销 ----------
 const clipN=await ev('store.dancers[0].actionClips.length');
 await clickButtonIn('#projectCenterModal','清空当前项目…');
 await until('document.querySelector(".modal h3")&&document.querySelector(".modal h3").textContent.indexOf("清空当前项目")>=0');
 check('PC-7 清空确认框：初始禁用，须输入确认词',await ev('(function(){var m=document.querySelector(".modal");var i=m.querySelector("input");var b=Array.from(m.querySelectorAll("button")).find(function(x){return x.textContent==="确认清空"});return !!i&&i.placeholder.indexOf("清空")>=0&&b.disabled===true})()'));
 await type('.modal input','清');
 check('PC-7 输错确认词→确认仍禁用（门槛不降）',await ev('Array.from(document.querySelectorAll(".modal button")).find(function(b){return b.textContent==="确认清空"}).disabled===true'));
 await type('.modal input','清空');
 await until('!Array.from(document.querySelectorAll(".modal button")).find(function(b){return b.textContent==="确认清空"}).disabled');
 await clickButtonIn('.modal','确认清空');
 await until('store.dancers[0].actionClips.length===0&&store.globalLyrics.length===0');
 check('PC-7 清空生效（内容清空）',true);
 await undo();
 await until('store.dancers[0].actionClips.length==='+clipN);
 check('PC-7 清空后可 ↶ 撤销恢复',true);
 await shot('s7-clear-undo');step('S7 危险区清空');

 // ---------- S8 新建项目→直回工作台（P1-A 已验语义保持） ----------
 await clickToolbar('项目');
 await until('document.getElementById("projectCenterModal")');
 await ev('window.__pcPrompt="P4B 新建项目"');
 await clickButtonIn('#projectCenterModal','➕ 新建项目');
 await until('!document.getElementById("projectCenterModal")');
 check('PC-8 新建项目→直回工作台空态（P1-A 语义保持）',await ev('store.projectName==="P4B 新建项目"&&!!document.getElementById("wbEmpty")'));
 await shot('s8-new-project');step('S8 新建直回');

 // ---------- S9 完整性与安全 ----------
 check('PC-9 全程 0 JS 异常',errors.length===0);
 check('PC-9 全程 0 外发 HTTP(S) 请求',requests.length===0);
 json('integrity',{errors:errors.length,requests:requests.length});
 await close();
}catch(e){
 json('failure',{error:String(e&&e.message||e),stack:String(e&&e.stack||''),checks:checks.length,errors:errors.map(function(x){return x.exceptionDetails||x}),
  ctx:await ev('(function(){return {modal:(document.querySelector(".modal h3")||{}).textContent||null,active:document.activeElement&&(document.activeElement.id||document.activeElement.tagName),toast:(document.getElementById("toast")||{}).textContent||""}})()').catch(function(err){return {dumpError:String(err)}})});
 try{await shot('failure')}catch(_){}
 try{await close()}catch(_){}
 console.error('FAIL: '+(e&&e.message||e));process.exit(1);
}})();
process.on('exit',function(){json('checks',checks);json('steps',steps);json('counts',counts);const fail=checks.filter(function(c){return !c.ok}).length;console.log('TOTAL '+checks.length+' PASS '+(checks.length-fail)+' FAIL '+fail)});
