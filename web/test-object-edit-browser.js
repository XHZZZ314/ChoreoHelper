// TASK-20260919-UI-OVERHAUL P3 旅程式浏览器探针：对象编辑与专家走位。
// 覆盖：①片段/旗标右键菜单逐项（真实 contextmenu 指针，行为等价性抽查）；②多选上下文栏「平移…」就地
// 精确平移（公共 delta+预告+一次撤销，旧 #preciseGroupMove 收编）；③舞者行「复制整轨到…」就地菜单（覆盖
// 确认+一次撤销）；④起始位置收口（舞者行入口→俯视拖点+「更多设置」数值；旧对话框保留）；⑤俯视走位线
// 就地编辑＋「节点数值表」折叠＋片段上下文栏「转向…」独立朝向；⑥属性面板并入上下文栏（默认收起、命令
// 面板可达）、「+ 台词」右移台词轨、数值化精确 A/B。
// 真实指针（CDP 真实鼠标/键盘），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，一次性 throwaway 资料
// （不触真实工程/私人资产/游戏端点、不写 live）。证据目录由 CHOREO_OBJECT_EVIDENCE 指定且必须全新。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_OBJECT_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_OBJECT_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
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
 await ev('window.__objPrompt=null;window.prompt=function(){return window.__objPrompt}'); // 演练：输入类原生对话框改为确定性返回值
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p,modifiers=0){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,modifiers});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function rightClickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'right',clickCount:1});await sleep(150)}
async function rightClick(selector,index=0){return rightClickAt(await point(selector,index,'select'))}
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function key(k,code,vk,modifiers=0){for(const t of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:t,key:k,code,windowsVirtualKeyCode:vk,modifiers});await sleep(80)}
async function selectRun(selector){
 await click(selector,0,'select');
 // 原生 select 在无头弹层里偶发不接力真实按键：真实点击后确保焦点在该 select，再用真实键盘改值
 await ev('(function(){var s=document.querySelector('+JSON.stringify(selector)+');if(s&&document.activeElement!==s)s.focus();return true})()');
 for(let i=0;i<3;i++){
  await key('ArrowDown','ArrowDown',40);
  await key('Enter','Enter',13);
  const v=await ev('document.querySelector('+JSON.stringify(selector)+').value');
  if(v==='run')return v;
 }
 throw Error('select keyboard switch failed v='+await ev('document.querySelector('+JSON.stringify(selector)+').value'));
}
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
// 俯视世界坐标→画布像素，真实指针点击
async function clickTopWorld(x,z){
 const t=await ev('ChoreoWorkbench.topViewTransform()');
 if(!t||!(t.sc>0)||!(t.w>0)||!(t.h>0))throw Error('top view transform missing '+JSON.stringify(t));
 // first-macro-journey 对齐：产品端 topWorldAt 已按内容盒（扣 1px 边框）映射，前向映射同口径
 const r=await ev('(function(){var b=document.getElementById("wbTopView");var cs=getComputedStyle(b);var rc=b.getBoundingClientRect();var bl=parseFloat(cs.borderLeftWidth)||0,bt=parseFloat(cs.borderTopWidth)||0,br=parseFloat(cs.borderRightWidth)||0,bb=parseFloat(cs.borderBottomWidth)||0;return {l:rc.left+bl,t:rc.top+bt,w:rc.width-bl-br,h:rc.height-bt-bb}})()');
 const px=r.l+r.w*(0.5+x*t.sc/t.w),py=r.t+r.h*(0.5+z*t.sc/t.h);
 if(px<r.l+4||px>r.l+r.w-4||py<r.t+4||py>r.t+r.h-4)throw Error('dest ('+x+','+z+') outside canvas: '+JSON.stringify({t,r,px,py}));
 counts.select++;await clickAt({x:px,y:py});
 return {x:Math.round(x*100)/100,z:Math.round(z*100)/100};
}
async function undo(){await click('button[title^="撤销上一步编辑"]',0,'nav');await sleep(150)}
async function ctxItems(){return ev('Array.from(document.querySelectorAll("#ctxMenu .ctx-it")).map(function(n){return {t:n.textContent,o:getComputedStyle(n).opacity}})')}
async function clickCtxText(text){
 const idx=await ev('Array.from(document.querySelectorAll("#ctxMenu .ctx-it")).findIndex(function(n){return n.textContent==='+JSON.stringify(text)+'})');
 if(!(idx>=0))throw Error('Missing ctx item '+text);
 await click('#ctxMenu .ctx-it',idx,'select');
 await until('!document.getElementById("ctxMenu").classList.contains("show")');
}
async function expandMotionTable(){await click('#wbMotionTable>summary',0,'nav');await until('document.getElementById("wbMotionTable").open===true')}
const actionClips=()=>ev('(function(){return store.dancers[0].actionClips.slice().sort(function(a,b){return a.start-b.start}).map(function(c){return {id:c.id,name:c.data.name,start:c.start,dur:c.duration}})})()');
const moveNodes=()=>ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).movement)');
const faceNodes=()=>ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).facing)');
(async()=>{try{
 await open();
 // ---------- S0 空态→从零开始→两条动作＋切换条＋标记（真实入口） ----------
 await until('document.getElementById("wbEmpty")');
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".tl-area")&&document.querySelector(".act-item")');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===2');
 // 切换条：右键菜单第 10 项（切换轨）需要真实切换片段；经既有 store+render 注入（不写项目文件）
 await ev('(function(){var d=store.dancers[0];d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"套装1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 await until('document.querySelector(".switch-lane .clip")');
 const clips=await actionClips();
 check('P3-0 空态→从零开始→按顺序添加两个动作（第二个=第一个结束）',clips.length===2&&clips[0].start===0&&Math.abs(clips[1].start-(clips[0].start+clips[0].dur))<1e-9);
 // 旗标：真实「⚑+」按钮在播放头加标记
 await click('button[title^="在播放头添加段落标记"]',0,'nav');
 await until('store.markers.length===1');
 check('P3-1 「⚑+」在播放头加段落标记',await ev('store.markers.length===1&&store.markers[0].t===0'));
 await shot('s0-setup');step('S0 准备',{clips:clips});
  // ---------- S1 片段右键菜单：动作 11 项＋切换轨第 12 项，行为等价（B7a 增「整段推迟/提前…」；B-SPATIAL-2 增「整组变换…」） ----------
  await rightClickAt(await clipPoint(clips[0].id));
  await until('document.getElementById("ctxMenu").classList.contains("show")');
  const items1=await ctxItems();
  const want1=['复制','对齐到播放头','粘贴到选中条后','复制此时段舞段…','精确平移…','整段推迟/提前…','整组变换…','编辑时间…','设置时长...','补齐空隙(本舞者)','游戏内预览','删除'];
  check('P3-1 动作右键 12 项逐项对照（B7b 后含复制此时段舞段；B-SPATIAL-2 后含整组变换；切换轨 13 项）',items1.length===want1.length&&want1.every(function(t){return items1.some(function(i){return i.t===t})}));
 const disabled1=items1.filter(function(i){return Number(i.o)<0.9}).map(function(i){return i.t}).sort();
 check('P3-1 未复制的「粘贴到选中条后」与单选「精确平移…」禁用（行为等价）',disabled1.join(',')==='粘贴到选中条后,精确平移…');
 await clickCtxText('复制');
 await until('store.dancers[0].actionClips.length===3');
 const a3=await actionClips();
 check('P3-1 右键「复制」=原条之后新增一条 '+JSON.stringify(a3.slice(0,3)),a3.length===3&&Math.abs(a3[1].start-(a3[0].start+a3[0].dur))<1e-9);
 await undo();await until('store.dancers[0].actionClips.length===2');
 check('P3-1 复制后一次撤销回到 2 条',(await actionClips()).length===2);
 // 编辑时间… 打开既有对话框（同一能力，不重建）
 await rightClickAt(await clipPoint(clips[0].id));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 await clickCtxText('编辑时间…');
 await until('!!document.getElementById("clipTimeModal")');
 check('P3-1 右键「编辑时间…」打开既有精确时间弹窗',await ev('!!document.getElementById("clipTimeModal")'));
 await click('#clipTimeCancel',0,'nav');
 await until('!document.getElementById("clipTimeModal")');
 // 对齐到播放头（右键项）
 await ev('seekTimelinePosition(5)');await sleep(200);
 await rightClickAt(await clipPoint(clips[0].id));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 await clickCtxText('对齐到播放头');
 await until('store.dancers[0].actionClips.some(function(c){return c.id==='+clips[0].id+'&&c.start===5})');
 check('P3-1 右键「对齐到播放头」=本条起点=5s',true);
 await undo();await until('store.dancers[0].actionClips.some(function(c){return c.id==='+clips[0].id+'&&c.start===0})');
 await ev('seekTimelinePosition(0)');await sleep(150);
 // 删除（单选）
 await rightClickAt(await clipPoint(clips[1].id));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 await clickCtxText('删除');
 await until('store.dancers[0].actionClips.length===1');
 check('P3-1 右键「删除」删除本条目',true);
 await undo();await until('store.dancers[0].actionClips.length===2');
 check('P3-1 删除后一次撤销恢复',true);
 // 切换轨右键：第 10 项「修改套装编号 / 时间…」
 const swId=await ev('store.dancers[0].switchClips[0].id');
 await rightClickAt(await clipPoint(swId));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 const items2=await ctxItems();
  check('P3-1 切换轨右键 13 项：含「修改套装编号 / 时间…」',items2.length===13&&items2[0].t==='修改套装编号 / 时间…'&&want1.every(function(t){return items2.some(function(i){return i.t===t})}));
 await clickCtxText('修改套装编号 / 时间…');
 await until('!!document.getElementById("gearsetModal")');
 check('P3-1 切换轨右键打开套装选择（既有弹窗）',true);
 await ev('(function(){var b=Array.from(document.querySelectorAll("#gearsetModal button")).find(function(x){return x.textContent.indexOf("取消")>=0});if(b)b.click();return true})()');
 await until('!document.getElementById("gearsetModal")');
 await shot('s1-clip-menu');step('S1 片段右键',{items:items1});
 // ---------- S1b 旗标右键：改名/改时间/删除 + 撤销 ----------
 async function markerMenu(){await rightClick('.mk-flag',0);await until('document.getElementById("ctxMenu").classList.contains("show")')}
 await markerMenu();
 const mkItems=await ctxItems();
 check('P3-1 旗标右键 4 项（改名/改时间/删除本标记/删除全部标记）',mkItems.length===4&&mkItems[0].t.indexOf('改名')>=0&&mkItems[1].t.indexOf('改时间')>=0&&mkItems[2].t.indexOf('删除本标记')>=0&&mkItems[3].t.indexOf('删除全部标记')>=0);
 await ev('window.__objPrompt="3"');
 await clickCtxText('⏱ 改时间');
 await until('store.markers[0].t===3');
 check('P3-1 旗标「改时间」=标记时刻 3s',true);
 await undo();await until('store.markers[0].t===0');
 await markerMenu();
 await ev('window.__objPrompt="测试标记"');
 await clickCtxText('✎ 改名');
 await until('store.markers[0].name==="测试标记"');
 check('P3-1 旗标「改名」生效',true);
 await undo();await until('store.markers[0].name!=="测试标记"');
 await markerMenu();
 await clickCtxText('🗑 删除本标记');
 await until('store.markers.length===0');
 check('P3-1 旗标「删除本标记」生效',true);
 await undo();await until('store.markers.length===1');
 check('P3-1 旗标操作一次撤销可恢复',true);
 await shot('s1b-marker');step('S1b 旗标右键',{items:mkItems});
 // ---------- S2 多选上下文栏「平移…」就地精确平移 ----------
 await clickClip(clips[0].id);
 await clickClip(clips[1].id,2); // Ctrl+点击加选
 await until('!!document.getElementById("wbCtxGroupMove")');
 check('P3-2 多选→上下文栏出现「平移…」「对齐到播放头」「删除所选」',await ev('document.getElementById("wbCtxGroupMove").textContent==="平移…"&&!!document.getElementById("wbCtxAlignSel")&&!!document.getElementById("wbCtxDelSel")'));
 check('P3-2 旧传输区 #preciseGroupMove 已收编（不再存在）',await ev('!document.getElementById("preciseGroupMove")'));
 const before2=await actionClips();
 await click('#wbCtxGroupMove',0,'nav');
 await until('!!document.getElementById("wbGroupMoveForm")');
 await type('#wbGroupMoveOffset','+1.0');
 const preview2=await ev('document.getElementById("wbGroupMovePreview").textContent');
 check('P3-2 就地表单显示公共 delta 与改动预告',preview2.indexOf('请求偏移 +1.000')>=0&&preview2.indexOf('平移后整组范围')>=0);
 await click('#wbGroupMoveConfirm',0,'confirm');
 await until('!document.getElementById("wbGroupMoveForm")');
 const after2=await actionClips();
 check('P3-2 确认后整组同 delta 平移 +1.0s（相对间距不变）',after2.every(function(c,i){return Math.abs(c.start-(before2[i].start+1))<1e-9&&c.dur===before2[i].dur}));
 await undo();await until('(function(){var a=store.dancers[0].actionClips;return Math.abs(a.find(function(c){return c.id==='+clips[0].id+'}).start-'+clips[0].start+')<1e-9})()');
 check('P3-2 一次撤销整组回到平移前',true);
 // 右键与命令面板入口指向同一就地编辑（P3 合同第 2 条）
 await clickClip(clips[0].id);
 await clickClip(clips[1].id,2);
 await until('!!document.getElementById("wbCtxGroupMove")');
 await rightClickAt(await clipPoint(clips[1].id));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 await clickCtxText('精确平移…');
 await until('!!document.getElementById("wbGroupMoveForm")');
 check('P3-2 右键「精确平移…」指向同一就地表单',true);
 await click('#wbGroupMoveCancel',0,'nav');
 await until('!document.getElementById("wbGroupMoveForm")');
 await ev('(function(){var c=buildCmdkCommands().find(function(x){return x.title.indexOf("精确平移")>=0});if(!c)throw Error("cmdk entry missing");c.run();return true})()');
 await until('!!document.getElementById("wbGroupMoveForm")');
 check('P3-2 命令面板「精确平移（多选）」指向同一就地表单',true);
 await click('#wbGroupMoveCancel',0,'nav');
 await until('!document.getElementById("wbGroupMoveForm")');
 // 对齐到播放头（多选就地）：清掉旧选集后重新框定两条，避免 Ctrl+点击把已选项取消
 await ev('(function(){clearClipSelection();refreshSelection();return true})()');
 await clickClip(clips[0].id);
 await clickClip(clips[1].id,2);
 await until('!!document.getElementById("wbCtxAlignSel")');
 await ev('seekTimelinePosition(5)');await sleep(150);
 await click('#wbCtxAlignSel',0,'confirm');
 await until('store.dancers[0].actionClips.every(function(c){return c.start===5})');
 check('P3-2 多选「对齐到播放头」整批对齐',true);
 await undo();await until('store.dancers[0].actionClips.some(function(c){return c.start===0})');
 await ev('seekTimelinePosition(0)');await sleep(150);
 await shot('s2-group-move');step('S2 精确平移',{before:before2,after:after2});
 // ---------- S3 整轨复制：舞者行就地「复制三条基础轨（切换/动作/台词）到…」（B7b/TD-04 诚实化＋扩展对话框） ----------
 await click('#wbAddDancer',0,'nav');
 await until('store.dancers.length===2');
 await until('document.querySelectorAll(".dancer-grp").length===2'); // 新舞者成为当前舞者，直接展开不藏折叠区
 const srcIds=(await actionClips()).map(function(c){return c.id});
 await click('.dancer-grp .dh-copy',0,'nav');
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 const cpItems=await ctxItems();
 check('P3-3 舞者行「⇉」菜单=复制三条基础轨到其他舞者 '+JSON.stringify(cpItems),cpItems.length===1&&cpItems[0].t==='⇉ 复制三条基础轨（切换/动作/台词）到 舞者2');
 await clickCtxText('⇉ 复制三条基础轨（切换/动作/台词）到 舞者2');
 await until('!!document.getElementById("b7bTracksDlg")');
 check('P3-3 对话框名称与实际范围一致（三条基础轨＋可选扩展）',await ev('(function(){var t=document.getElementById("b7bTracksDlg").textContent;return t.indexOf("三条基础轨（切换/动作/台词）")>=0&&t.indexOf("技能")>=0&&t.indexOf("走位")>=0&&t.indexOf("朝向")>=0})()'));
 await click('#b7bTkOk',0,'nav');
 await until('store.dancers[1].actionClips.length==='+srcIds.length);
 check('P3-3 整轨复制到空目标=三条轨一次到位（发新 id，一次撤销）',await ev('(function(){var a=store.dancers[1].actionClips;return a.length==='+srcIds.length+'&&a.every(function(c){return '+JSON.stringify(srcIds)+'.indexOf(c.id)<0})})()'));
 // 目标已有内容：对话框取消=零改动；确定=整体替换
 await ev('(function(){store.dancers[1].actionClips.pop();store.dancers[1].lyricClips=[];render();return true})()');
 const before3=await ev('JSON.stringify(store.dancers[0].actionClips.map(function(c){return c.id}))');
 await click('.dancer-grp .dh-copy',1,'nav');
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 check('P3-3 目标行菜单=复制三条基础轨到 舞者1',await ev('document.querySelector("#ctxMenu .ctx-it").textContent==="⇉ 复制三条基础轨（切换/动作/台词）到 舞者1"'));
 await clickCtxText('⇉ 复制三条基础轨（切换/动作/台词）到 舞者1');
 await until('!!document.getElementById("b7bTracksDlg")');
 check('P3-3 目标已有内容时对话框预告整体替换',await ev('document.getElementById("b7bTkPrev").textContent.indexOf("会被整体替换")>=0'));
 await click('#b7bTkCancel',0,'nav');
 await sleep(150);
 check('P3-3 对话框取消=目标零改动',await ev('JSON.stringify(store.dancers[0].actionClips.map(function(c){return c.id}))')===before3);
 await click('.dancer-grp .dh-copy',1,'nav');
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 await clickCtxText('⇉ 复制三条基础轨（切换/动作/台词）到 舞者1');
 await until('!!document.getElementById("b7bTracksDlg")');
 await click('#b7bTkOk',0,'nav');
 await until('store.dancers[0].actionClips.length==='+(srcIds.length-1));
 check('P3-3 确定后整体替换为目标内容',true);
 await undo();
 await until('store.dancers[0].actionClips.length==='+srcIds.length);
 check('P3-3 整轨覆盖一次撤销还原',true);
 await shot('s3-copy-tracks');step('S3 整轨复制',{srcIds:srcIds});
 // ---------- S4 起始位置收口：舞者行入口→俯视拖点＋更多设置数值 ----------
 await click('.start-entry',0,'nav');
 await until('!!document.getElementById("wbStartBar")');
 check('P3-4 舞者行「起始位置」→舞台自动切俯视标签＋就地编辑条',await ev('document.getElementById("wbTabTop").classList.contains("on")&&!document.getElementById("wbTopHost").hidden&&!!document.getElementById("wbStartX")'));
 check('P3-4 数值收进「更多设置（专家参数）」且默认折叠、仅网页预览注记在',await ev('(function(){var m=document.getElementById("wbStartMore");var b=document.getElementById("wbStartBar");return !!m&&!m.open&&b.textContent.indexOf("网页预览")>=0&&b.textContent.indexOf("游戏执行")>=0})()'));
 const startBase=await ev('ChoreoEdit.pure.placementFor(store.dancers,0)');
 const p4=await clickTopWorld(2,-1);
 await until('Math.abs(Number(document.getElementById("wbStartX").value)-2)<=0.03');
 const pick4=await ev('({x:Number(document.getElementById("wbStartX").value),z:Number(document.getElementById("wbStartZ").value)})');
 check('P3-4 俯视拖点=草稿 X/Z（厘米量化≈'+pick4.x+','+pick4.z+'）',Math.abs(pick4.x-2)<=0.03&&Math.abs(pick4.z+1)<=0.03);
 await click('#wbStartApply',0,'confirm');
 await until('!!store.dancers[0].start');
 check('P3-4 「应用起点」保存显式 start（朝向沿用当前值）',await ev('store.dancers[0].start.x==='+pick4.x+'&&store.dancers[0].start.z==='+pick4.z+'&&store.dancers[0].start.yawDeg==='+startBase.yawDeg));
 await undo();await until('!store.dancers[0].start');
 check('P3-4 应用起点一次撤销可还原',true);
 // 更多设置：精确数值输入
 await click('.start-entry',0,'nav');
 await until('!!document.getElementById("wbStartBar")');
 await click('#wbStartMore>summary',0,'nav');
 await until('document.getElementById("wbStartMore").open===true');
 await type('#wbStartX','-1.5');await type('#wbStartZ','2.25');await type('#wbStartYaw','90');
 await click('#wbStartApply',0,'confirm');
 await until('!!store.dancers[0].start&&store.dancers[0].start.yawDeg===90');
 check('P3-4 「更多设置」数值可用：X/Z/朝向精确保存',await ev('store.dancers[0].start.x===-1.5&&store.dancers[0].start.z===2.25&&store.dancers[0].start.yawDeg===90'));
 // 清除起点
 await click('.start-entry',0,'nav');
 await until('!!document.getElementById("wbStartBar")');
 await click('#wbStartClear',0,'confirm');
 await until('!store.dancers[0].start');
 check('P3-4 「清除起点」恢复自动排布',true);
 await undo();await until('!!store.dancers[0].start');
 await ev('(function(){ChoreoEdit.pure.clearDancerStart(store.dancers,0);saveHistory();render();return true})()');
 // 旧对话框保留（能力不删）
 check('P3-4 openStartDialog 对话框仍可用（能力不删）',await ev('(function(){ChoreoStageUI.openStartDialog(0);var ok=!!document.getElementById("startFormationModal");ChoreoStageUI.closeStartDialog();return ok})()'));
 await shot('s4-start-position');step('S4 起始位置');
 // ---------- S5 俯视走位线就地编辑＋节点数值表＋独立朝向 ----------
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtxMove")');
 await click('#wbCtxMove',0,'nav');
 await until('!!document.getElementById("wbMoveBar")');
 await clickTopWorld(1.2,-1);
 await until('ChoreoStageMotionUI.samePlaceState()&&ChoreoStageMotionUI.samePlaceState().dest');
 await click('#wbMoveApply',0,'confirm');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !!t})()');
 const end1=Math.round((clips[0].start+clips[0].dur)*1000)/1000;
 check('P3-5 准备：P1-C 走位应用成功（1 节点，到达 '+end1+'s）',await ev('ChoreoStageMotion.nodes(store,0).movement.length===1'));
 // 点俯视走位线=选中就地编辑
 const base5=await ev('ChoreoEdit.pure.placementFor(store.dancers,0)');
 const dest5=await ev('ChoreoStageMotion.nodes(store,0).movement[0]');
 const mx=(base5.x+Number(dest5.x))/2,mz=(base5.z+Number(dest5.z))/2;
 await clickTopWorld(mx,mz);
 await until('!!document.getElementById("wbMotionTable")');
 check('P3-5 点俯视走位线→选中该舞者走位＋「节点数值表（精确编辑）」随选（默认折叠）',await ev('(function(){var t=document.getElementById("wbMotionTable");return !!t&&!t.open&&document.getElementById("wbMotionTitle").textContent.indexOf("走位 · 舞者1")>=0&&document.getElementById("wbMotionSummary").textContent.indexOf("路径节点 1 个")>=0})()'));
 // 在播放头加节点（草稿）+ 走/跑 + 应用（一次撤销）
 const t2=Math.round((end1+1.5)*2)/2;
 await ev('seekTimelinePosition('+t2+')');await sleep(150);
 await click('#wbMotionAdd',0,'nav');
 await until('document.getElementById("wbMotionSummary").textContent.indexOf("路径节点 2 个")>=0');
 check('P3-5 「＋ 在播放头加节点」加入草稿（未应用前轨道不变）',await ev('ChoreoStageMotion.nodes(store,0).movement.length===1&&document.getElementById("wbMotionSummary").textContent.indexOf("路径节点 2 个")>=0'));
 await expandMotionTable();
 await selectRun('select[aria-label="路径节点2 移动模式"]');
 check('P3-5 节点数值表可就地切走/跑',await ev('document.querySelector(\'select[aria-label="路径节点2 移动模式"]\').value==="run"'));
 await click('#wbMotionApply',0,'confirm');
 await until('ChoreoStageMotion.nodes(store,0).movement.length===2');
 const applied5=JSON.parse(await moveNodes());
 check('P3-5 应用=一次保存（节点 2 @'+t2+'s 跑步）',applied5.length===2&&Math.round(applied5[1].time*1000)/1000===t2&&applied5[1].move==='run');
 await undo();await until('ChoreoStageMotion.nodes(store,0).movement.length===1');
 check('P3-5 节点编辑一次撤销回到 1 节点',true);
 // 撤销会替换 store.dancers → 就地会话按守卫作废；重新选中走位线继续
 await click('.stage-motion-lane .lane-label',0,'select');
 await until('!!document.getElementById("wbMotionTable")');
 // 非零递增约束：时刻改 0 应用被拒绝且零改动
 const before5b=await moveNodes();
 await expandMotionTable();
 await type('input[aria-label="路径节点1 到达秒"]','0');
 await click('#wbMotionApply',0,'confirm');
 await until('document.getElementById("wbMotionStatus").textContent.indexOf("严格递增")>=0');
 check('P3-5 非零递增约束保留：0s 节点被拒绝且零改动',(await moveNodes())===before5b);
 await click('#wbMotionCancel',0,'nav');
 await until('document.getElementById("wbMotionStatus").textContent.indexOf("取消修改")>=0');
 // 清除这段走位（草稿+应用）
 await click('#wbMotionClear',0,'nav');
 await until('document.getElementById("wbMotionSummary").textContent.indexOf("路径节点 0 个")>=0');
 await expandMotionTable();
 await click('#wbMotionApply',0,'confirm');
 await until('(function(){var t=ChoreoStageMotion.rows(store).filter(function(x){return x.type==="movement"})[0];return !t})()');
 check('P3-5 「删除这段走位」=路径轨道移除（草稿应用，一次撤销）',true);
 await undo();await until('ChoreoStageMotion.nodes(store,0).movement.length===1');
 check('P3-5 删除走位一次撤销可恢复',true);
 // 旧版专家面板保留（能力不删）：撤销后重选走位线再打开
 await click('.stage-motion-lane .lane-label',0,'select');
 await until('!!document.getElementById("wbMotionTable")');
 await expandMotionTable();
 await until('!!document.getElementById("wbMotionLegacy")');
 await click('#wbMotionLegacy',0,'nav');
 await until('document.querySelector(".stage-motion-editor")');
 check('P3-5 旧走位浮窗仍可打开（快捷/二维预览/游戏路径能力不删）',true);
 await ev('Array.from(document.querySelectorAll(".stage-motion-editor button")).find(function(b){return b.textContent==="取消"}).click()');
 await until('!document.querySelector(".stage-motion-editor")');
 // 片段上下文栏「转向…」独立朝向
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtxTurn")');
 await click('#wbCtxTurn',0,'nav');
 await until('!!document.getElementById("wbMotionTable")&&document.getElementById("wbMotionTitle").textContent.indexOf("独立朝向")>=0');
 check('P3-5 片段上下文栏「转向…」=独立朝向就地编辑（时刻/角度）',true);
 await ev('seekTimelinePosition(2)');await sleep(150);
 await click('#wbMotionAdd',0,'nav');
 await until('document.getElementById("wbMotionSummary").textContent.indexOf("朝向节点 1 个")>=0');
 await expandMotionTable();
 await type('input[aria-label="朝向节点1 朝向°"]','90');
 await click('#wbMotionApply',0,'confirm');
 await until('ChoreoStageMotion.nodes(store,0).facing.length===1');
 check('P3-5 独立朝向应用=一次保存（2s/90°）',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).facing)===JSON.stringify([{time:"2",yaw:"90"}])'));
 await undo();await until('ChoreoStageMotion.nodes(store,0).facing.length===0');
 check('P3-5 独立朝向一次撤销可还原',true);
 // 朝向守卫：0 秒节点拒绝（撤销后会话作废，重新经片段「转向…」打开）
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtxTurn")');
 await click('#wbCtxTurn',0,'nav');
 await until('!!document.getElementById("wbMotionTable")&&document.getElementById("wbMotionTitle").textContent.indexOf("独立朝向")>=0');
 await ev('seekTimelinePosition(0)');await sleep(150);
 await click('#wbMotionAdd',0,'nav');
 await until('document.getElementById("wbMotionStatus").textContent.indexOf("大于 0")>=0');
 check('P3-5 朝向节点同样拒绝 0 秒（非零递增）',await ev('ChoreoStageMotion.nodes(store,0).facing.length===0'));
 await click('#wbMotionClose',0,'nav');
 await until('!document.getElementById("wbMotionTable")');
 await shot('s5-motion-edit');step('S5 走位/朝向');
 // ---------- S6 属性面板并入上下文栏：默认收起、命令面板可达、单选职责就地 ----------
 check('P3-6 右侧属性面板默认收起（未手动打开时不渲染）',await ev('!document.getElementById("propPanel")'));
 check('P3-6 工具栏「属性」入口仍在',await ev('!!document.getElementById("propBtn")'));
 await click('#propBtn',0,'nav');
 await until('!!document.getElementById("propPanel")');
 check('P3-6 「属性」按钮可展开专家面板（能力不删）',true);
 await click('#propBtn',0,'nav');
 await until('!document.getElementById("propPanel")');
 check('P3-6 命令面板仍可达属性面板开关',await ev('buildCmdkCommands().some(function(c){return c.title.indexOf("属性面板")>=0})'));
 await clickClip(clips[0].id);
 await until('!!document.getElementById("wbCtx")');
 check('P3-6 单选职责并入上下文栏：复制/对齐到播放头/更多设置（时长/精确开始）都在',await ev('(function(){var b=document.getElementById("wbCtx");return !!document.getElementById("wbCtxDup")&&!!document.getElementById("wbCtxAlign")&&!!document.getElementById("wbCtxDurEdit")&&!!document.getElementById("wbCtxStartEdit")&&b.textContent.indexOf("更多设置")>=0})()'));
 await shot('s6-props-merge');step('S6 属性面板');
 // ---------- S7 「+ 台词」右移台词轨 ----------
 check('P3-7 舞者头不再有「+ 台词」',await ev('!Array.from(document.querySelectorAll(".d-hdr")).some(function(h){return h.textContent.indexOf("+ 台词")>=0})'));
 await ev('window.__objPrompt="测试台词"');
 await click('.lyric-lane .lyric-add',0,'confirm');
 await until('store.dancers[0].lyricClips.length===1');
 check('P3-7 台词轨右缘「+ 台词」入口生效（原逻辑）',await ev('store.dancers[0].lyricClips[0].data.name==="测试台词"&&store.dancers[0].lyricClips[0].data.command==="/y 测试台词"'));
 await undo();await until('store.dancers[0].lyricClips.length===0');
 check('P3-7 加台词一次撤销可还原',true);
 await shot('s7-lyric-entry');step('S7 台词入口');
 // ---------- S8 数值化精确 A/B（会话级语义） ----------
 await type('#loopAInput','1');
 await key('Enter','Enter',13);
 await until('store.loopA===1');
 check('P3-8 数值输入 A=1s（不经过播放头）',true);
 await type('#loopBInput','2.5');
 await key('Enter','Enter',13);
 await until('store.loopB===2.5');
 check('P3-8 数值输入 B=2.5s',await ev('store.loopA===1&&store.loopB===2.5'));
 await type('#loopAInput','3');
 await key('Enter','Enter',13);
 await until('store.loopA===2.5&&store.loopB===3').catch(async function(){throw Error('swap wait failed '+await ev('JSON.stringify({a:store.loopA,b:store.loopB,aIn:document.getElementById("loopAInput").value,bIn:document.getElementById("loopBInput").value})'))});
 check('P3-8 A>B 自动交换（与按钮同一口径）',true);
 await click('button[title="清除 A-B 循环"]',0,'nav');
 await until('store.loopA===null&&store.loopB===null');
 check('P3-8 清除后会话级区间为空、游戏模式禁用口径不变',await ev('(function(){store.previewTarget="game";render();var dis=document.getElementById("loopAInput").disabled&&document.getElementById("loopBInput").disabled;store.previewTarget="web";render();return dis&&!document.getElementById("loopAInput").disabled})()'));
 await shot('s8-ab-numeric');step('S8 精确 A-B');
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个：'+JSON.stringify(errors.slice(0,2)));
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-props-ui.js','choreo-workbench.js','choreo-stage-motion-ui.js','choreo-stage-ui.js','choreo-bootstrap.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);
 console.log('\nObjectEdit: '+checks.length+' checks passed');
}catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
