// TASK-20260919-UI-OVERHAUL P4-A 旅程式浏览器探针：内容编辑面（套装/歌词/原词/音乐）。
// 覆盖：①套装片段上下文栏（#34，切换条单击选中→就地编辑编号/时间＋未核验标注；右键与旧套装窗保留）；
// ②歌词与原词三类文本独立（#21/#35/#36，导入入口迁歌词轨头、编辑原词入口、LRC 导入/搜索/预览弹窗逐项不删）；
// ③音乐区（#37/#38，底部默认收起、选文件即展开、11 参数全部保留、复杂节拍参数收「设置」折叠）。
// 真实指针（CDP 真实鼠标/键盘），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，一次性 throwaway 资料
// （不触真实工程/私人资产/游戏端点、不写 live）。证据目录由 CHOREO_CONTENT_EVIDENCE 指定且必须全新。
// 夹具明示：切换条与宏草稿种子经 store 注入（不写项目文件、不冒充游戏数据）；音频为探针生成的确定性
// 正弦波 WAV（无版权、无属主私有资料）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_CONTENT_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_CONTENT_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[];
const counts={nav:0,select:0,input:0,confirm:0};
function snapshotCounts(){return Object.assign({},counts)}
function step(name,data){steps.push(Object.assign({step:name,counts:snapshotCounts()},data||{}))}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<250;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,768','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('DOM.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
 await ev('window.__p4aPrompt=null;window.prompt=function(q){return window.__p4aPrompt};window.confirm=function(){return false}'); // 演练：输入类原生对话框改为确定性返回值
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){
 // 先把真实指针挪到左上角清掉悬停/提示层（同真实用户移开鼠标），避免提示层遮挡命中测试
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await sleep(40);
 return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p,modifiers=0){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,modifiers});await sleep(140)}
async function dblclickAt(p){for(const c of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:c});await sleep(150)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function type(selector,text){
 await click(selector,0,'input');
 // 无头环境真实点击偶发不接力焦点（P3 selectRun 同款口径）：真实点击后确保焦点在目标，键盘才不会落到全局快捷键
 const focused=await ev('(function(){var n=document.querySelector('+JSON.stringify(selector)+');if(n&&document.activeElement!==n)n.focus();return !!n&&document.activeElement===n})()');
 if(!focused)throw Error('Focus failed '+selector);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(160);
}
async function key(k,code,vk,modifiers=0){for(const t of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:t,key:k,code,windowsVirtualKeyCode:vk,modifiers});await sleep(90)}
async function undo(){await click('button[title^="撤销上一步编辑"]',0,'nav');await sleep(180)}
// 实时体检（800ms 防抖）签名变化时会整页 render 重建上下文栏（P1-A 起既有行为，check-ui 属 P4-B 写域）：
// 在根内输入框（上下文栏/宏面板）打字前先等体检收敛，避免后台重建打断输入。
async function settleCheck(){
 const read=()=>ev('(String(window._checkSig!==undefined?window._checkSig:""))+"|"+(window._checkTimer?"T":"-")+(window._checkRunning?"R":"-")').catch(()=> '?');
 for(let i=0;i<50;i++){
  const a=await read();await sleep(300);const b=await read();
  if(a===b&&a.indexOf('T')<0&&a.indexOf('R')<0)return;
 }
 throw Error('realtime check did not settle');
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
async function rightClickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'right',clickCount:1});await sleep(160)}
async function setFileInput(selector,file){
 const doc=await send('DOM.getDocument');
 const q=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
 if(!q.nodeId)throw Error('file input missing '+selector);
 await send('DOM.setFileInputFiles',{files:[file],nodeId:q.nodeId});
}
// 确定性正弦波 WAV（8000Hz 单声道 16bit，2 秒）：探针自有夹具，无版权/无属主资料。
function makeWav(sec,rate){
 const n=Math.floor(sec*rate),buf=Buffer.alloc(44+n*2);
 buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVE',8);buf.write('fmt ',12);
 buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);
 buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)buf.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
 return buf;
}
(async()=>{try{
 await open();
 // ---------- S0 空态→从零开始→一条动作＋切换条夹具 ----------
 await until('document.getElementById("wbEmpty")');
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".tl-area")&&document.querySelector(".act-item")');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 check('CF-0 空态→从零开始→按顺序添加首个动作',await ev('store.dancers[0].actionClips.length===1&&store.dancers[0].actionClips[0].start===0'));
 // 夹具明示：切换条经 store+render 注入（右键第 10 项与上下文栏都需要真实切换片段；不写项目文件）
 await ev('(function(){var d=store.dancers[0];d.switchClips.push({id:store.nextClipId++,start:6,duration:2,data:{name:"套装1",command:"/gs change 1",category:"switch"}});saveHistory();updateTotalDuration();render();return true})()');
 await until('document.querySelector(".switch-lane .clip")');
 const swId=await ev('store.dancers[0].switchClips[0].id');
 await shot('s0-setup');step('S0 准备',{switchId:swId});

 // ---------- S1 套装片段上下文栏（#34） ----------
 await settleCheck();
 await clickClip(swId);
 await until('document.getElementById("wbCtxGearSlot")');
 await settleCheck();
 check('CF-1 切换条单击选中→上下文栏出现套装就地编辑（编号/时间/应用）',await ev('!!document.getElementById("wbCtxGearSlot")&&!!document.getElementById("wbCtxGearStart")&&!!document.getElementById("wbCtxGearApply")'));
 check('CF-1 编号回填当前值、时间回填当前开始',await ev('document.getElementById("wbCtxGearSlot").value==="1"&&document.getElementById("wbCtxGearStart").value==="6"'));
 check('CF-1 未核验标注在场（无游戏连接时如实标注）',await ev('document.getElementById("wbCtxGearMark").textContent.indexOf("编号未核验")>=0'));
 await type('#wbCtxGearSlot','3');
 await until('document.getElementById("wbCtxGearPreview").textContent.indexOf("/gs change 3")>=0');
 check('CF-1 输入编号→命令预览即时更新（/gs change 3）',true);
 check('CF-1 预览含未核验警示（不冒充已核实）',await ev('document.getElementById("wbCtxGearPreview").textContent.indexOf("编号未核实")>=0'));
 await click('#wbCtxGearApply',0,'confirm');
 await until('store.dancers[0].switchClips[0].data.command==="/gs change 3"');
 check('CF-1 应用→命令更新为 /gs change 3（立即保存）',true);
 check('CF-1 应用后仍如实标注未核验（不伪造游戏核实）',await ev('store.dancers[0].switchClips[0].data.gearsetVerified===false'));
 await undo();
 await until('store.dancers[0].switchClips[0].data.command==="/gs change 1"');
 check('CF-1 应用=一次撤销恢复原编号',true);
 await clickClip(swId);
 await until('document.getElementById("wbCtxGearStart")');
 await settleCheck();
 await type('#wbCtxGearStart','8');
 await until('document.getElementById("wbCtxGearApply")');
 await click('#wbCtxGearApply',0,'confirm');
 await until('store.dancers[0].switchClips[0].start===8');
 check('CF-1 改开始时间→只动开始，时长不变（updateClip 与旧窗同口径）',await ev('store.dancers[0].switchClips[0].duration===2'));
 await undo();await until('store.dancers[0].switchClips[0].start===6');
 await clickClip(swId);
 await until('document.getElementById("wbCtxGearSlot")');
 await settleCheck();
 const before0=await ev('JSON.stringify(store.dancers[0].switchClips[0])');
 await type('#wbCtxGearSlot','0');
 await click('#wbCtxGearApply',0,'confirm');
 await sleep(250);
 check('CF-1 非法编号 0→拒绝且零改动',await ev('document.getElementById("wbCtxGearErr").textContent.indexOf("1–100")>=0&&JSON.stringify(store.dancers[0].switchClips[0])===('+JSON.stringify(before0)+')'));
 await type('#wbCtxGearSlot','999');
 await click('#wbCtxGearApply',0,'confirm');
 await sleep(250);
 check('CF-1 非法编号 999→拒绝且零改动',await ev('document.getElementById("wbCtxGearErr").textContent.length>0&&JSON.stringify(store.dancers[0].switchClips[0])===('+JSON.stringify(before0)+')'));
 await type('#wbCtxGearSlot','7');
 await key('Escape','Escape',27);
 await sleep(150);
 check('CF-1 Escape→就地取消：输入恢复当前值（零改动）',await ev('document.getElementById("wbCtxGearSlot").value==="1"&&JSON.stringify(store.dancers[0].switchClips[0])===('+JSON.stringify(before0)+')'));
 // track 门控：动作条上下文栏不出现套装编辑
 const aId=await ev('store.dancers[0].actionClips[0].id');
 await clickClip(aId);
 await until('document.getElementById("wbCtx")&&!document.getElementById("wbCtxGearSlot")');
 check('CF-1 动作条上下文栏不出现套装编辑（门控=切换轨）',await ev('!document.getElementById("wbCtxGearSlot")&&!!document.getElementById("wbCtx")'));
 await shot('s1-gearset-ctx');step('S1 套装上下文栏');
 // 右键「修改套装编号 / 时间…」→旧套装窗（专家/回落入口保留）
 await clickClip(swId);await until('document.getElementById("wbCtxGearSlot")');
 await rightClickAt(await clipPoint(swId));
 await until('document.getElementById("ctxMenu").classList.contains("show")');
 const hasG=await ev('Array.from(document.querySelectorAll("#ctxMenu .ctx-it")).some(function(n){return n.textContent==="修改套装编号 / 时间…"})');
 check('CF-2 右键菜单「修改套装编号 / 时间…」仍在',hasG);
 const gIdx=await ev('Array.from(document.querySelectorAll("#ctxMenu .ctx-it")).findIndex(function(n){return n.textContent==="修改套装编号 / 时间…"})');
 await click('#ctxMenu .ctx-it',gIdx,'select');
 await until('!!document.getElementById("gearsetModal")');
 check('CF-2 右键项→旧套装窗打开（ChoreoGearset.openDialog 能力保留）',true);
 const gCancel=await ev('Array.from(document.querySelectorAll("#gearsetModal button")).findIndex(function(b){return b.textContent==="取消"})');
 await click('#gearsetModal button',gCancel,'nav');
 await until('!document.getElementById("gearsetModal")');
 check('CF-2 旧窗取消→零改动',await ev('JSON.stringify(store.dancers[0].switchClips[0])===('+JSON.stringify(before0)+')'));
 // 双击切换条→旧套装窗（专家入口，P2 双击口径：第二击 clickCount=2）
 const dp=await clipPoint(swId);
 await dblclickAt(dp);
 await until('!!document.getElementById("gearsetModal")');
 check('CF-2 双击切换条→旧套装窗打开（专家入口保留）',true);
 await key('Escape','Escape',27);
 await until('!document.getElementById("gearsetModal")');
 check('CF-2 旧窗 Esc 关闭→零改动',await ev('JSON.stringify(store.dancers[0].switchClips[0])===('+JSON.stringify(before0)+')'));
 // 宏面板默认收起：先真实展开抽屉，再核验宏面板套装/原词入口（P1-B 已验不回退）
 await click('.macro-drawer-toggle',0,'nav');
 await until('document.querySelector(".macro-tx")');
 check('CF-2 宏面板「切换装备套装」入口不动（P1-B 已验不回退）',await ev('Array.from(document.querySelectorAll(".macro-pnl button")).some(function(b){return b.textContent==="切换装备套装"})'));
 check('CF-2 切换轨标签仍含「未核实」只读标注',await ev('document.querySelector(".switch-lane .lane-label").textContent.indexOf("未核实")>=0'));

 // ---------- S2 歌词与原词三类文本独立（#21/#35/#36） ----------
 await until('document.getElementById("glImport")&&document.getElementById("glEditLyrics")');
 check('CF-3 歌词轨头出现「导入歌词」与「编辑原词」入口',await ev('document.getElementById("glImport").textContent==="导入歌词"&&document.getElementById("glEditLyrics").textContent==="编辑原词"'));
 check('CF-3 「导入歌词」标注联网搜索、且保留离线 LRC 手输说明',await ev('document.getElementById("glImport").title.indexOf("联网搜索")>=0&&document.getElementById("glImport").title.indexOf("LRC")>=0'));
 await click('#glImport',0,'nav');
 await until('document.querySelector(".modal h3")&&document.querySelector(".modal h3").textContent.indexOf("歌词导入")>=0');
 const modalCaps=await ev('(function(){var m=document.querySelector(".modal");var tas=Array.from(m.querySelectorAll("textarea"));var btns=Array.from(m.querySelectorAll("button")).map(function(b){return b.textContent});return {search:!!m.querySelector("input[type=text]"),ta:tas.length,btns:btns}})()');
 check('CF-4 弹窗能力逐项在场：搜索框/搜索按钮/LRC 粘贴区/导入/关闭',modalCaps.search&&modalCaps.ta>=1&&modalCaps.btns.indexOf('搜索')>=0&&modalCaps.btns.indexOf('导入到全局歌词轨')>=0&&modalCaps.btns.indexOf('关闭')>=0);
 await type('.modal textarea','[00:01.00] 第一句\n[00:03.50] 第二句\n[00:06.00] 第三句');
 await until('(document.querySelector(".modal").textContent||"").indexOf("3 行歌词")>=0');
 check('CF-4 离线手输：粘贴 LRC→预览 3 行歌词（预览能力保留）',true);
 await shot('s2-lyrics-modal');step('S2 歌词弹窗');
 const impIdx=await ev('Array.from(document.querySelectorAll(".modal button")).findIndex(function(b){return b.textContent==="导入到全局歌词轨"})');
 await click('.modal button',impIdx,'confirm');
 await until('store.globalLyrics.length===3');
 const lyr=await ev('store.globalLyrics.map(function(c){return [c.start,c.data.name]})');
 check('CF-4 导入→全局歌词轨 3 条、时刻与文本正确',lyr.length===3&&lyr[0][0]===1&&lyr[1][0]===3.5&&lyr[2][0]===6&&lyr[0][1]==='第一句');
 // 手写台词独立：「+ 台词」真实入口（prompt 桩返回确定性文本）
 await ev('window.__p4aPrompt="大家好，这是手写台词"');
 await click('.lyric-add',0,'select');
 await until('store.dancers[0].lyricClips.length===1');
 check('CF-5 手写台词经「+ 台词」入口新增、落在舞者台词轨（与歌词轨分轨）',await ev('store.dancers[0].lyricClips[0].data.command.indexOf("/y ")===0'));
 check('CF-5 导入歌词不产生手写台词（两类文本分储）',await ev('store.globalLyrics.length===3&&store.dancers[0].lyricClips.length===1'));
 // 宏草稿独立：宏面板真实输入持久化（根内输入框：先等体检收敛）
 await settleCheck();
 await type('.macro-tx','/bow motion 夹具宏草稿');
 await until('(store.contentExtra.macroEditors&&store.contentExtra.macroEditors.dancers&&store.contentExtra.macroEditors.dancers["0"]&&store.contentExtra.macroEditors.dancers["0"].text||"").indexOf("夹具宏草稿")>=0');
 check('CF-5 宏草稿经宏面板输入并持久化（第三类文本在储）',true);
 const seedMacro=await ev('JSON.stringify(store.contentExtra.macroEditors)');
 const seedLyric=await ev('JSON.stringify(store.dancers[0].lyricClips)');
 // 编辑原词→逐行修改→应用
 await click('#glEditLyrics',0,'nav');
 await until('document.querySelector(".song-lyric-row textarea")');
 check('CF-6 原词编辑窗打开（标题与既有窗体一致）',await ev('document.querySelector(".modal h3").textContent.indexOf("编辑歌曲原词")>=0'));
 await type('.song-lyric-row textarea','改好的第一句');
 const applyIdx=await ev('Array.from(document.querySelectorAll(".modal button")).findIndex(function(b){return b.textContent==="应用原词修改"})');
 await click('.modal button',applyIdx,'confirm');
 await until('store.globalLyrics[0].data.name==="改好的第一句"');
 check('CF-6 原词逐行修改→应用后更新到全局歌词轨',true);
 check('CF-6 原词应用后：手写台词与宏草稿零变化（三类文本独立）',await ev('JSON.stringify(store.dancers[0].lyricClips)===('+JSON.stringify(seedLyric)+')&&JSON.stringify(store.contentExtra.macroEditors)===('+JSON.stringify(seedMacro)+')'));
 await undo();
 await until('store.globalLyrics[0].data.name==="第一句"');
 check('CF-6 原词修改=一次撤销恢复',true);
 check('CF-7 工具栏「🎵 歌词」入口保留（P4-C：资源菜单收编后保持顶栏 1 击直达）',await ev('Array.from(document.querySelectorAll(".toolbar-nav button")).some(function(b){return b.textContent.indexOf("歌词")>=0})'));
 check('CF-7 宏面板「编辑歌曲原词」入口保留',await ev('Array.from(document.querySelectorAll(".macro-pnl button")).some(function(b){return b.textContent==="编辑歌曲原词"})'));
 check('CF-7 原词开关（导出宏时包含歌曲原词）在场且语义不变',await ev('(function(){var cb=document.querySelector(".gl-tg input[type=checkbox]");return cb&&cb.checked===store.showLyricMacro})()'));
 await shot('s2-done');step('S2 歌词与原词');

 // ---------- S3 音乐区（#37/#38） ----------
 check('CF-8 默认收起：音乐正文隐藏、收起条在场',await ev('(function(){var b=document.getElementById("musicBody");return !!b&&b.hidden===true&&!!document.getElementById("musicBar")})()'));
 check('CF-8 收起条含「音乐」开关、状态文本与「选择音乐文件…」入口',await ev('document.getElementById("musicToggle").textContent.indexOf("音乐")>=0&&!!document.getElementById("musicMiniStatus")&&document.getElementById("musicChoose").textContent.indexOf("选择音乐文件")>=0'));
 const ids=['musicFile','musicSeek','musicOffset','musicBpm','musicAnchor','musicZoom','musicTempo','musicMeter','musicCountOn','musicCountBars','musicSnap'];
 const missing=await ev('["musicFile","musicSeek","musicOffset","musicBpm","musicAnchor","musicZoom","musicTempo","musicMeter","musicCountOn","musicCountBars","musicSnap"].filter(function(id){return !document.getElementById(id)})');
 check('CF-9 11 参数全部在场（'+ids.length+' 项 ID 清单）',missing.length===0);
 const foldState=await ev('(function(){var s=document.getElementById("musicSettings");var inside=["musicTempo","musicMeter","musicCountOn","musicCountBars","musicSnap","musicZoom"].every(function(id){var n=document.getElementById(id);return n&&s.contains(n)});return {inside:inside,open:s.open}})()');
 check('CF-9 复杂节拍参数全部收在「设置」折叠内',foldState.inside);
 check('CF-9 「设置」折叠默认收起',foldState.open===false);
 await click('#musicToggle',0,'nav');
 await until('document.getElementById("musicBody").hidden===false');
 check('CF-10 收起→展开（真实点击「音乐」开关）',await ev('document.getElementById("musicToggle").getAttribute("aria-expanded")==="true"'));
 await shot('s3-music-open');step('S3 音乐展开');
 await click('#musicToggle',0,'nav');
 await until('document.getElementById("musicBody").hidden===true');
 check('CF-10 展开→再收起',true);
 // 选择文件即展开：确定性 WAV 夹具经 CDP 注入真实文件
 const wav=path.join(evidence,'p4a-tone.wav');fs.writeFileSync(wav,makeWav(2,8000));
 await setFileInput('#musicFile',wav);
 await until('document.getElementById("musicBody").hidden===false');
 check('CF-11 选择文件→音乐区自动展开',true);
 await until('(document.getElementById("musicMeta").textContent||"").indexOf("2.0 秒")>=0');
 check('CF-11 文件核对通过（元数据显示文件名与秒数）',await ev('document.getElementById("musicMeta").textContent.indexOf("p4a-tone.wav")>=0'));
 check('CF-11 收起条同步显示当前文件',await ev('document.getElementById("musicMiniStatus").textContent.indexOf("p4a-tone.wav")>=0'));
 await until('store.contentExtra&&store.contentExtra.music&&store.contentExtra.music.ref&&!!store.contentExtra.music.ref.fingerprint');
 check('CF-11 音频引用随项目持久化（contentExtra.music.ref）',true);
 await click('#musicSettings>summary',0,'nav');
 await until('document.getElementById("musicSettings").open===true');
 check('CF-12 「设置」折叠可展开、复杂节拍参数可达',await ev('!!document.getElementById("musicTempo").closest("#musicSettings")&&document.getElementById("musicSettings").open===true'));
 await click('#musicToggle',0,'nav');
 await until('document.getElementById("musicBody").hidden===true');
 check('CF-12 选文件后仍可再收起（收起条保留文件状态）',await ev('document.getElementById("musicMiniStatus").textContent.indexOf("p4a-tone.wav")>=0'));
 // P4-C 旧↔新：旧=视图菜单「音乐面板」二级入口（菜单 2 击）；新=顶栏「音乐」按钮直点（1 击导航），
 // 视图菜单已随 P4-C 收编，音乐能力与 toggleMusicPanel 语义不变。
 await click('#musicBtn',0,'nav');
 await until('document.getElementById("musicBody").hidden===false');
 check('CF-13 顶栏「音乐」按钮→展开音乐区（P4-C：视图菜单收编，1 击导航）',true);
 await shot('s3-music-final');step('S3 音乐区');
 // 完整性：0 JS 异常、0 外发请求
 check('CF-14 全程 0 JS 异常',errors.length===0);
 check('CF-14 全程 0 外发 HTTP(S) 请求',requests.length===0);
 json('integrity',{errors:errors.length,requests:requests.length});
 await close();
}catch(e){
 json('failure',{error:String(e&&e.message||e),stack:String(e&&e.stack||''),checks:checks.length,errors:errors.map(function(x){return x.exceptionDetails||x}),
  ctx:await ev('(function(){var s=document.getElementById("wbCtxSlot")||document.getElementById("wbCtxGearSlot");return {html:(document.getElementById("wbCtxHost")||{}).innerHTML||"NO-HOST",slotValue:s&&s.value,active:document.activeElement&&(document.activeElement.id||document.activeElement.tagName)}})()').catch(function(err){return {dumpError:String(err)}})});
 try{await shot('failure')}catch(_){}
 try{await close()}catch(_){}
 console.error('FAIL: '+(e&&e.message||e));process.exit(1);
}})();
process.on('exit',function(){json('checks',checks);json('steps',steps);json('counts',counts);const fail=checks.filter(function(c){return !c.ok}).length;console.log('TOTAL '+checks.length+' PASS '+(checks.length-fail)+' FAIL '+fail)});
