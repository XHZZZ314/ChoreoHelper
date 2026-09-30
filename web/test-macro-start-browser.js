// TASK-20260919-UI-OVERHAUL P1-B 旅程式浏览器探针：宏起步（粘贴→预览识别→明确应用/取消/撤销，
// /ac 身份待核验、未识别原文保留+原因、不支持行进「宏原文备注」）→ 无宏路径 → 定位排练这一段
// （片段±0.5s 循环复用 loopA/B/seek、暂停保位、停止即退出循环）。真实指针（CDP 真实鼠标/键盘），
// 一次交互→明确状态（until 轮询），HTTP(S) 全阻断，一次性 throwaway 资料（不触真实工程/私人资产/
// 游戏端点、不写 live）。证据目录由 CHOREO_MACRO_EVIDENCE 指定且必须全新。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_MACRO_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_MACRO_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
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
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
// 真实键盘输入：点中→Ctrl+A→insertText（触发 input 事件；换行按多行文本一次插入）
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function clickClip(id){
 for(let i=0;i<50;i++){
  const ok=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(n)return true;ChoreoEdit.pure.eachClip(store,function(c){if(c.id===${id}){var w=document.getElementById('timelineWrap');if(w)w.scrollLeft=Math.max(0,c.start*store.pps-40)}});return false})()`);
  if(ok)break;await sleep(100);
 }
 await clickAt(await clipPoint(id));
}
const tracks=`JSON.stringify({sw:store.dancers[0].switchClips.length,ac:store.dancers[0].actionClips.length,ly:store.dancers[0].lyricClips.length,g:store.globalLyrics.length,m:store.markers.length})`;
(async()=>{try{
 await open();
 // ---------- S0 空态宏入口：打开→取消（零时间轴改动） ----------
 await until('document.getElementById("wbEmpty")');
 check('P1B-0 空态卡有「从已有宏开始」入口',await ev('!!document.getElementById("wbEmptyMacro")&&document.getElementById("wbEmptyMacro").textContent.includes("粘贴我的宏")'));
 const before=await ev(tracks);
 await click('#wbEmptyMacro',0,'nav');
 await until('!!document.getElementById("macroStartSheet")');
 check('P1B-1 宏起步窗：粘贴框+预览/取消/应用',await ev('!!document.getElementById("macroStartText")&&!!document.getElementById("macroStartPreview")&&!!document.getElementById("macroStartCancel")&&!!document.getElementById("macroStartApply")'));
 check('P1B-1 未预览前「应用到时间轴」禁用（明确应用）',await ev('document.getElementById("macroStartApply").disabled'));
 check('P1B-1 明示将应用到当前舞者',await ev('document.getElementById("macroStartSheet").textContent.includes("当前舞者")&&document.getElementById("macroStartSheet").textContent.includes(store.dancers[0].name)'));
 await shot('s0-macro-sheet');step('S0 宏窗口',{expect:'粘贴/预览/取消/应用明确',actual:'已断言'});
 await click('#macroStartCancel',0,'nav');
 await until('!document.getElementById("macroStartSheet")');
 check('P1B-1 取消不改时间轴（零内容改动）',(await ev(tracks))===before);
 // ---------- S1 工作台常驻入口→粘贴→预览识别 ----------
 await click('#wbEmptyStart',0,'nav');
 await until('document.querySelector(".tl-area")&&document.getElementById("wbMacroStart")');
 await until('document.querySelector(".act-item")'); // 快照目录异步装填
 check('P1B-2 工作台内有常驻宏入口（空态/旧项目都可见）',await ev('(function(){var b=document.getElementById("wbMacroStart");var r=b.getBoundingClientRect();return b.textContent.includes("从已有宏开始")&&r.width>0&&r.height>0})()'));
 await click('#wbMacroStart',0,'nav');
 await until('!!document.getElementById("macroStartSheet")');
 const emoteCmd=await ev('(function(){var e=store.emotes.find(function(x){return x.command==="/bow"})||store.emotes.concat(store.actions).find(function(x){return /^\\//.test(x.command||"")});return e?e.command:null})()');
 const emoteOk=!!emoteCmd&&await ev('!!resolveMacroCommand('+JSON.stringify(emoteCmd)+')');
 const lastLine=(emoteOk?emoteCmd:'/ac 谢幕')+' <wait.2.5>';
 const macroText=['/gs change 1 <wait.2>','/say 大家好 <wait.3>','/ac 热舞 <wait.2>','/party',lastLine].join('\n');
 await type('#macroStartText',macroText);
 await click('#macroStartPreview',0,'confirm');
 await until('document.querySelectorAll("#macroStartList .ms-row").length===5');
 const rows=await ev('Array.prototype.map.call(document.querySelectorAll("#macroStartList .ms-row"),function(r){return {t:r.querySelector(".ms-t").textContent,k:r.querySelector(".ms-k").textContent,txt:r.querySelector(".ms-txt").textContent,why:r.querySelector(".ms-why").textContent}})');
 check('P1B-2 逐行识别：类别+计算时刻（0/2/5/7s，start-to-start）',rows.length===5&&rows[0].t==='0.0s'&&rows[0].k==='切装备'&&rows[1].t==='2.0s'&&rows[1].k==='台词'&&rows[2].t==='5.0s'&&rows[2].k.includes('技能')&&rows[4].t==='7.0s');
 check('P1B-2 /ac 一律「身份待核验」且不从文本推断',rows[2].k.includes('身份待核验')&&rows[2].why.includes('不从 /ac 文本推断'));
 check('P1B-2 未识别项原文保留+原因',rows[3].k==='保留原文'&&rows[3].txt==='/party'&&rows[3].why==='不支持的命令，保留原文');
 if(emoteOk)check('P1B-2 动作／表情类别按现有 resolver 识别',rows[4].k==='动作／表情');
 const summary=await ev('document.getElementById("macroStartSummary").textContent');
 check('P1B-2 汇总：识别 4 行 / 保留原文 1 行；应用前不改动',summary.includes('识别 4 行')&&summary.includes('保留原文 1 行')&&summary.includes('应用前不会改动时间轴'));
 check('P1B-2 预览后「应用到时间轴」可用',await ev('!document.getElementById("macroStartApply").disabled'));
 await shot('s1-macro-preview');step('S1 宏预览',{expect:'类别+时刻/未识别原文+/ac 待核验',actual:'已断言',emote:emoteOk?emoteCmd:null});
 // ---------- S2 明确应用→时间轴落位→备注可查 ----------
 await click('#macroStartApply',0,'confirm');
 await until('!document.getElementById("macroStartSheet")');
 await until('store.dancers[0].switchClips.length===1&&store.dancers[0].lyricClips.length===1&&store.dancers[0].actionClips.length===2');
 const applied=await ev('(function(){function s(a){return a.slice().sort(function(x,y){return x.start-y.start}).map(function(c){return {start:c.start,dur:c.duration,cmd:c.data.command,name:c.data.name}})}return {sw:s(store.dancers[0].switchClips),ly:s(store.dancers[0].lyricClips),ac:s(store.dancers[0].actionClips),gl:store.globalLyrics.length}})()');
 check('P1B-3 应用落位：切装备@0 / 台词@2 / 技能@5 / 动作@7',applied.sw.length===1&&applied.sw[0].start===0&&applied.sw[0].cmd==='/gs change 1'&&applied.ly.length===1&&applied.ly[0].start===2&&applied.ly[0].cmd==='/say 大家好'&&applied.ac.length===2&&applied.ac[0].start===5&&applied.ac[0].cmd==='/ac 热舞'&&applied.ac[1].start===7);
 check('P1B-3 台词独立在台词轨（歌曲原词未被写入）',applied.gl===0&&applied.ly[0].name==='大家好'&&applied.ly[0].cmd.indexOf('/say')===0);
 await until('!!document.getElementById("wbMacroNotes")');
 check('P1B-3 不支持行进「宏原文备注」独立可查',await ev('document.getElementById("wbMacroNotes").textContent.includes("1 行不支持")'));
 await click('#wbMacroNotes>summary',0,'nav');
 await until('document.getElementById("wbMacroNotes").open===true');
 const note=await ev('(function(){var n=document.querySelector("#wbMacroNotes .wb-macro-note");return n?{tx:n.querySelector(".wb-macro-note-tx").textContent,why:n.querySelector(".wb-macro-note-why").textContent}:null})()');
 check('P1B-3 备注保留原文与原因',!!note&&note.tx==='/party'&&note.why==='不支持的命令，保留原文');
 check('P1B-3 草稿与备注按项目+舞者独立持久化',await ev('(function(){var r=store.contentExtra&&store.contentExtra.macroStart&&store.contentExtra.macroStart.dancers&&store.contentExtra.macroStart.dancers[String(store.dancers[0].id)];return !!r&&r.text.indexOf("/party")>=0&&r.notes.length===1})()'));
 await shot('s2-macro-applied');step('S2 应用',{applied:applied});
 // ---------- S3 应用可撤销（一条撤销回到应用前） ----------
 await click('button[title^="撤销上一步编辑"]',0,'nav');
 await until('store.dancers[0].actionClips.length===0&&store.dancers[0].switchClips.length===0&&store.dancers[0].lyricClips.length===0');
 check('P1B-3 撤销一步回到应用前（时间轴清空）',(await ev(tracks))===before);
 check('P1B-3 撤销后「宏原文备注」仍独立可查',await ev('!!document.getElementById("wbMacroNotes")'));
 // ---------- S3b 重开页面：草稿与备注按项目持久化 ----------
 await ev('location.reload()');
 await until('window.store&&store.appReady&&document.getElementById("wbEmpty")');
 check('P1B-3 重开后空项目仍见空态（草稿不冒充内容）',await ev('projectIsEmpty()'));
 await click('#wbEmptyStart',0,'nav');
 await until('!!document.getElementById("wbMacroNotes")');
 check('P1B-3 重开后「宏原文备注」按项目持久化可查',await ev('document.getElementById("wbMacroNotes").textContent.includes("/party")'));
 await click('#wbMacroStart',0,'nav');
 await until('!!document.getElementById("macroStartSheet")');
 check('P1B-3 重开后宏草稿原文保留（可继续预览/应用）',await ev('document.getElementById("macroStartText").value.indexOf("/party")>=0'));
 await click('#macroStartCancel',0,'nav');
 await until('!document.getElementById("macroStartSheet")');
 // ---------- S4 无宏路径仍完整（库内 1 击接着添加） ----------
 await until('document.querySelector(".act-item")');
 await click('.act-item .ai-name',0,'select');
 await until('store.dancers[0].actionClips.length===1');
 check('P1B-4 无宏路径：库内 1 击添加第一个动作仍从 0.0s 开始',await ev('store.dancers[0].actionClips.length===1&&store.dancers[0].actionClips[0].start===0&&store.dancers[0].switchClips.length===0'));
 await shot('s3-no-macro');
 // ---------- S5 定位排练这一段：循环±0.5s/起播/回绕/暂停保位/停止退出 ----------
 const clipId=await ev('store.dancers[0].actionClips[0].id');
 await clickClip(clipId);
 await until('!!document.getElementById("wbCtxRehearse")');
 const clip=await ev('(function(){var c=store.dancers[0].actionClips[0];return {start:c.start,dur:c.duration}})()');
 const loopA=Math.max(0,Math.round((clip.start-0.5)*10)/10),loopB=Math.round((clip.start+clip.dur+0.5)*10)/10;
 await click('#wbCtxRehearse',0,'nav');
 await until('store.loopA!==null&&store.loopB!==null&&store.isPlaying');
 check('P1B-5 定位排练：循环=片段±0.5s 并起播',await ev('store.loopA==='+loopA+'&&store.loopB==='+loopB));
 check('P1B-5 循环徽标显示范围与退出方式',await ev('(function(){var b=document.getElementById("wbCtxLoop");return !!b&&b.textContent.includes('+JSON.stringify(loopA.toFixed(1)+'–'+loopB.toFixed(1))+')&&b.textContent.includes("停止即退出")&&document.getElementById("wbCtxRehearse").textContent.includes("退出循环试看")})()'));
 let wrapped=false,last=await ev('store.currentTime'),maxSeen=last;
 for(let i=0;i<100;i++){await sleep(120);const c=await ev('store.currentTime');if(c>maxSeen)maxSeen=c;if(c<last-0.3)wrapped=true;last=c;if(wrapped)break}
 check('P1B-5 播放头在循环范围内回绕且不越界',wrapped&&maxSeen<=loopB+0.3);
 await click('#playBtn',0,'nav');
 await until('!store.isPlaying');
 const p0=await ev('store.currentTime');await sleep(350);const p1=await ev('store.currentTime');
 check('P1B-5 暂停保留位置且循环不退出',Math.abs(p0-p1)<0.05&&await ev('store.loopA==='+loopA));
 await click('#playBtn',0,'nav');
 await until('store.isPlaying');
 await click('button[title^="停止（普通停止）"]',0,'nav');
 await until('store.loopA===null&&store.loopB===null&&!store.isPlaying&&store.currentTime===0');
 check('P1B-5 停止即退出循环（A/B 清除、播放头归零）',await ev('store.loopA===null&&store.loopB===null'));
 check('P1B-5 退出后时间轴上下文仍在、按钮回到「循环试看这一段」（first-macro-journey J4 更名）',await ev('!!document.getElementById("wbCtx")&&document.getElementById("wbCtxRehearse").textContent.includes("循环试看这一段")'));
 await shot('s4-rehearsal-stopped');step('S5 定位排练',{loopA:loopA,loopB:loopB,wrapped:wrapped});
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个');
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-props-ui.js','choreo-workbench.js','choreo-macro-ui.js','choreo-bootstrap.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);
 console.log('\nMacroStart: '+checks.length+' checks passed');
 }catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
