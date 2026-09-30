// TASK-20260919-UI-OVERHAUL P2 旅程式浏览器探针：多舞者与技能统一（真实指针，无需属主私有资料）。
// 覆盖：技能与动作同一锚点（技能轨末尾+等待值 / 插在这里消费所选时刻 / 缺省不用播放头）→
// 库内缺基础值前置状态与明示回落就地编排 → 技能片段统一上下文栏（单击摘要/双击展开更多设置/
// 应用立即保存可撤销/取消零改动）→ 动作×技能 Ctrl 多选与一次撤销删除/Delete 键 →
// 舞者行就地加人/移除（确认保留）/人物资源缺资源高亮/S·M 文案 → 落点预告复位不误导。
// 技能 fixture 明示为「合成目录条目」（type:'action' + 真实所需字段），setup 注入，不读属主资料。
// 证据目录=CHOREO_SKILL_EVIDENCE 指定的全新目录；真实指针（CDP），HTTP(S) 全阻断。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_SKILL_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_SKILL_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[],steps=[],dialogs=[];
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
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}));if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params);send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{})}};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p,modifiers=0){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,modifiers});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function dblclick(selector,index=0){const p=await point(selector,index,'select');for(const c of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:c});await sleep(150)}
async function type(selector,text){await click(selector,0,'input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:String(text)});await sleep(120)}
async function key(a,b,c,d){var kk,code,vk,mod;if(typeof b==='number'){code=a;vk=b;var kn=c;mod=d||0;kk=kn||a}else{kk=a;code=b;vk=c;mod=d||0}for(const tt of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:tt,key:kk,code,windowsVirtualKeyCode:vk,modifiers:mod});await sleep(80)}
async function btnText(text,root='body'){const i=await ev(`Array.from(document.querySelectorAll(${JSON.stringify(root)}+' button')).findIndex(b=>b.textContent===${JSON.stringify(text)})`);assert.ok(i>=0,'button not found: '+text);await click(root+' button',i,'confirm')}
// 应用技能编排：真实指针点击后等编辑面收起；未收起时把就地错误文本带出来，并最多重试 3 次（抗合成事件时序抖动）
async function applySkillEditor(){for(let i=0;i<3;i++){const idx=await ev('Array.from(document.querySelectorAll(".ability-editor button")).findIndex(b=>b.textContent==="应用技能编排")');if(idx<0)return;await click('.ability-editor button',idx,'confirm');for(let j=0;j<12;j++){if(await ev('!document.querySelector(".ability-editor")').catch(()=>false))return;await sleep(100)}const err=await ev('(function(){var s=document.querySelector(".ability-editor [role=status]");return s?s.textContent:""})()').catch(()=>"");if(err)throw Error('技能应用被拒：'+err)}throw Error('技能应用点击未生效（重试 3 次）')}
async function abilityPoint(id){
 return ev(`(()=>{const n=document.querySelector('.ability-clip[data-event-id="${id}"]');if(!n)throw Error('ability clip missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect();const left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),top=Math.max(r.top,w.top,0),bottom=Math.min(r.bottom,w.bottom,innerHeight);const y=top+(bottom-top)/2;for(const x of [left+10,(left+right)/2,right-10]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-rz'))return {x,y}}throw Error('No visible ability clip')})()`);
}
async function clickAbility(id,ctrl){await clickAt(await abilityPoint(id),ctrl?2:0);counts.select++}
async function dblAbility(id){ // 真实双击：两次点击同一屏幕点（上下文栏常态占位保证命中点不漂移）
 const p=await abilityPoint(id);
 for(const c of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:c});
 await sleep(180);counts.select++;
}
async function clipPoint(id){const p=await ev(`(()=>{const n=(_clipNodes[${id}]||[]).find(n=>n.isConnected);if(!n)throw Error('clip DOM missing');n.scrollIntoView({block:'center',inline:'center'});const r=n.getBoundingClientRect(),w=document.querySelector('#timelineWrap').getBoundingClientRect(),left=Math.max(r.left,w.left,0),right=Math.min(r.right,w.right,innerWidth),y=Math.max(r.top,w.top,0)+(Math.min(r.bottom,w.bottom,innerHeight)-Math.max(r.top,w.top,0))/2;for(const x of [left+12,(left+right)/2,right-12]){const hit=document.elementFromPoint(x,y);if(x>left&&x<right&&n.contains(hit)&&!hit.closest('.c-pv,.c-rz'))return {x,y}}throw Error('No visible clip body')})()`);counts.select++;return p}
async function rulerPoint(t){return ev(`(()=>{const wrap=document.getElementById('timelineWrap'),r=document.querySelector('#ruler');if(!wrap||!r)throw Error('ruler missing');const calc=()=>{const rr=r.getBoundingClientRect();return {x:rr.left+LABEL_W+${Number(t)}*store.pps,y:rr.top+rr.height/2}};let p=calc();const w=wrap.getBoundingClientRect();if(wrap.scrollTop!==0){wrap.scrollTop=0;p=calc()}if(p.x>w.right-6||p.x<w.left+LABEL_W+6){wrap.scrollLeft+=(p.x-(w.left+LABEL_W+6));p=calc()}const hit=document.elementFromPoint(p.x,p.y);if(!(hit&&hit.closest&&hit.closest('.ruler')))throw Error('ruler point not on ruler: '+(hit?hit.className:'null'));return p})()`).then(p=>{counts.select++;return p})}
async function enterInsert(t){for(let i=0;i<3;i++){await clickAt(await rulerPoint(t));for(let j=0;j<20;j++){if(await ev('window.ChoreoWorkbench.insertAt()==='+Number(t)).catch(()=>false))return;await sleep(50)}}throw Error('insert mode not entered at '+t)}
const CLIP_A={id:12001,type:'action',name:'合成技能甲',command:'/ac 合成技能甲',category:'skill',jobName:'合成测试职业',jobId:90,jobAbbr:'测',staticMetadata:{version:1,actionId:12001,castMs:1500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
const CLIP_B={id:12002,type:'action',name:'合成技能乙',command:'/ac 合成技能乙',category:'skill',jobName:'合成测试职业',jobId:90,jobAbbr:'测'}; // 明示无 staticMetadata=缺目录基础时间
const EMOTE={id:90001,name:'合成动作',command:'/合成动作',category:'usual'};
(async()=>{try{
 await open();
 // ---------- S0 空态 → 从零开始 ----------
 await until('!!document.getElementById("wbEmpty")');
 await click('#wbEmptyStart',0,'nav');
 await until('!!document.querySelector(".sidebar")&&!!document.querySelector(".tl-area")&&!!document.getElementById("wbAddBar")');
 check('P2/S0 从零开始进入工作台（导航 1 击）',counts.nav===1);
 // ---------- S1 合成技能目录注入（明示 fixture） ----------
 await ev('(function(){store.activeTab="skill-all";store.search="";store.actions=['+JSON.stringify(CLIP_A)+','+JSON.stringify(CLIP_B)+'];render();return true})()');
 await until('document.querySelectorAll(".act-item").length===2');
 check('P2/S1 明示合成目录条目（技能甲带真实身份+静态基础值）',await ev('(function(){var a=store.actions;return a.length===2&&a[0].type==="action"&&a[0].id===12001&&a[0].staticMetadata.castMs===1500&&a[1].staticMetadata===undefined})()'));
 check('P2/S1 技能页落点预告=技能轨（不是动作轨）',await ev('document.getElementById("wbLanding").textContent.includes("技能落点预告：第一个技能从 0.0s 开始")'));
 check('P2/S1 添加按钮文案随页签=接着添加技能',await ev('(function(){var b=document.querySelector("[data-wb=add-next]");return !!b&&b.textContent.includes("接着添加技能")})()'));
 check('P2/S1 缺基础值前置：选择前显示可默认/缺目录基础时间',await ev('(function(){var s=document.querySelectorAll(".ai-skill-state");return s.length===2&&s[0].getAttribute("data-skill-state")==="ready"&&s[0].textContent.includes("可默认落条")&&s[1].getAttribute("data-skill-state")==="missing"&&s[1].textContent.includes("缺目录基础时间")})()'));
 await shot('s1-library-state');step('S1 目录状态',{expect:'ready/missing 选择前可见',actual:'已断言'});
 // ---------- S2 默认锚点=技能轨末尾+等待值（不用播放头） ----------
 await ev('(function(){store.currentTime=7;return true})()');
 await click('.act-item .ai-name',0);
 await until('ChoreoAbilityPlan.rows(store).length===1');
 check('P2/S2 点技能=1 击落条且不用播放头（空技能轨=0.0s）',await ev('(function(){var r=ChoreoAbilityPlan.rows(store),e=r[0].event;return r.length===1&&e.startMs===0&&e.durationMs===2500&&store.currentTime===7})()'));
 check('P2/S2 默认落条不打开编辑面',await ev('!document.querySelector(".ability-editor")'));
 await type('#wbWaitInput','1');
 await until('document.getElementById("wbLanding").textContent.includes("等待 1.0s")');
 check('P2/S2 等待值进落点预告（技能轨末尾 2.5s+等待 1s）',await ev('(function(){var t=document.getElementById("wbLanding").textContent;return t.includes("上一个技能 2.5s 结束")&&t.includes("等待 1.0s")&&t.includes("新技能从 3.5s 开始")})()'));
 const hMiss=await ev('store.historyIdx');
 await click('.act-item .ai-name',1); // 缺基础值条目
 await until('document.querySelector(".ability-editor")&&document.querySelector("#toast").textContent.includes("无法按默认落条")');
 check('P2/S2 缺基础值=明示 toast+回落就地编排，零落下',await ev('ChoreoAbilityPlan.rows(store).length===1&&store.historyIdx==='+hMiss));
 check('P2/S2 回落编辑面挂在统一上下文栏宿主（不是独立浮窗）',await ev('(function(){var e=document.querySelector(".ability-editor");return !!e&&!!e.closest("#wbCtxHost")&&getComputedStyle(e).position!=="fixed"})()'));
 await btnText('取消','.ability-editor');
 await until('!document.querySelector(".ability-editor")');
 check('P2/S2 取消回落=编辑面消失、零历史改动',await ev('ChoreoAbilityPlan.rows(store).length===1&&store.historyIdx==='+hMiss));
 await shot('s2-anchor-and-missing');step('S2 锚点+缺基础值',{expect:'轨末+等待；缺基础值明示回落',actual:'已断言'});
 // ---------- S3 追加=技能轨末尾+等待值 ----------
 await click('.act-item .ai-name',0);
 await until('ChoreoAbilityPlan.rows(store).length===2');
 check('P2/S3 第二个技能=技能轨末尾 2.5s+等待 1s=3.5s',await ev('(function(){var e=ChoreoAbilityPlan.rows(store).map(function(r){return r.event}).sort(function(a,b){return a.startMs-b.startMs})[1];return e.startMs===3500})()'));
 check('P2/S3 预告随轨末更新=上一个技能 6.0s 结束',await ev('document.getElementById("wbLanding").textContent.includes("上一个技能 6.0s 结束")'));
 // ---------- S4 插在这里消费所选时刻 ----------
 await enterInsert(10);
 await until('!!document.querySelector("[data-wb=insert]")');
 check('P2/S4 点刻度→插在这里且预告插在 10.0s（动作/技能同口径）',await ev('document.getElementById("wbLanding").textContent.includes("插在 10.0s")&&!!document.querySelector("[data-wb=insert]")'));
 await click('.act-item .ai-name',0);
 await until('ChoreoAbilityPlan.rows(store).length===3');
 check('P2/S4 技能插入落点=所选时刻（10.0s）且插入态被消费',await ev('(function(){var e=ChoreoAbilityPlan.rows(store).map(function(r){return r.event});return e.some(function(x){return x.startMs===10000})&&ChoreoWorkbench.insertAt()===null&&!!document.querySelector("[data-wb=add-next]")})()'));
 await shot('s4-insert');step('S4 插在这里',{expect:'技能消费所选时刻',actual:'已断言'});
 // ---------- S5 单击技能条=选中+摘要上下文栏 ----------
 const firstId=await ev('ChoreoAbilityPlan.rows(store).sort(function(a,b){return a.event.startMs-b.event.startMs})[0].event.id');
 await clickAbility(firstId);
 await until('!!document.getElementById("wbCtx")&&!!document.querySelector(".ability-summary")');
 check('P2/S5 单击技能条=选中并显示摘要（名称/触发/目标）',await ev('(function(){var c=document.getElementById("wbCtx");var h=c.querySelector("h3");return c.classList.contains("ability-summary")&&h.textContent.includes("#12001")&&c.textContent.includes("触发")&&c.textContent.includes("目标：")&&document.querySelector(".ability-clip.selected")!==null})()'));
 check('P2/S5 单击不开编辑面、无独立浮窗',await ev('!document.querySelector(".ability-editor")'));
 // ---------- S6 双击=选中+展开更多设置；应用=立即保存+可撤销 ----------
 await dblAbility(firstId);
 await until('!!document.querySelector("#wbCtxHost .ability-editor")');
 check('P2/S6 双击=选中并展开「更多设置」（不再独立浮窗）',await ev('(function(){var e=document.querySelector("#wbCtxHost .ability-editor");var a=document.querySelector(".ability-advanced");return !!e&&!!a&&a.open===true&&getComputedStyle(e).position!=="fixed"})()'));
 check('P2/S6 咏唱只读、触发时刻可编辑',await ev('(function(){var c=document.querySelector("input[aria-label=\'咏唱提示时长（秒）\']"),s=document.querySelector("input[aria-label=\'触发时刻（秒）\']");return c&&c.readOnly===true&&s&&s.readOnly===false})()'));
 const hApply=await ev('store.historyIdx');
 const durBefore=await ev('ChoreoAbilityPlan.rows(store).filter(function(r){return r.event.id==='+JSON.stringify(firstId)+'})[0].event.durationMs');
 await type('input[aria-label="触发时刻（秒）"]','2.5');
 await applySkillEditor();
 check('P2/S6 应用=立即保存（触发改 2.5s、时长不变）+一次撤销',await ev('(function(){var r=ChoreoAbilityPlan.rows(store).filter(function(x){return x.event.id==='+JSON.stringify(firstId)+'})[0];return r.event.startMs===2500&&r.event.durationMs==='+durBefore+'&&store.historyIdx==='+hApply+'+1})()'));
 check('P2/S6 应用后回到摘要（触发 2.500s 可见）',await ev('document.querySelector(".ability-summary").textContent.includes("触发 2.500s")'));
 await key('z','KeyZ',90,2);await until('ChoreoAbilityPlan.rows(store).filter(function(r){return r.event.id==='+JSON.stringify(firstId)+'})[0].event.startMs===0');
 check('P2/S6 Ctrl+Z 撤销应用',await ev('ChoreoAbilityPlan.rows(store).filter(function(r){return r.event.id==='+JSON.stringify(firstId)+'})[0].event.startMs===0'));
 await key('y','KeyY',89,2);await until('ChoreoAbilityPlan.rows(store).filter(function(r){return r.event.id==='+JSON.stringify(firstId)+'})[0].event.startMs===2500');
 check('P2/S6 Ctrl+Y 重做应用',await ev('ChoreoAbilityPlan.rows(store).filter(function(r){return r.event.id==='+JSON.stringify(firstId)+'})[0].event.startMs===2500'));
 // ---------- S7 取消=零改动 ----------
 const hCancel=await ev('store.historyIdx');
 const docCancel=await ev('JSON.stringify(ChoreoAbilityPlan.rows(store))');
 await dblAbility(firstId);
 await until('!!document.querySelector("#wbCtxHost .ability-editor")');
 await type('input[aria-label="触发时刻（秒）"]','9');
 await btnText('取消','.ability-editor');
 await until('!document.querySelector(".ability-editor")');
 check('P2/S7 取消=草稿不保存、零改动零历史',await ev('store.historyIdx==='+hCancel+'&&JSON.stringify(ChoreoAbilityPlan.rows(store))==='+JSON.stringify(docCancel)));
 await shot('s7-editor-apply-cancel');step('S7 应用/取消',{expect:'应用可撤销、取消零改动',actual:'已断言'});
 // ---------- S8 跨类型 Ctrl 多选 + 一次撤销删除 ----------
 await ev('(function(){store.activeTab="emote-usual";store.search="";store.emotes.push('+JSON.stringify(EMOTE)+');render();return true})()');
 await until('!!document.querySelector(".act-item")');
 await click('.act-item .ai-name',0);
 await until('store.dancers[0].actionClips.length===1');
 const clipId=await ev('store.dancers[0].actionClips[0].id');
 await clickAt(await clipPoint(clipId));
 await until('edSel().length===1');
 await clickAbility(firstId,true); // Ctrl+点技能条：动作×技能同选
 await until('ChoreoAbilityUI.selection().length===1&&edSel().length===1');
 check('P2/S8 Ctrl+点击跨动作×技能多选（UI 态，不入库）',await ev('edSel().length===1&&ChoreoAbilityUI.selection().length===1'));
 check('P2/S8 多选上下文栏显示合计并可删除',await ev('(function(){var c=document.getElementById("wbCtx");return !!c&&c.textContent.includes("已选 2 条")&&!!document.getElementById("wbCtxDelSel")})()'));
 const hDel=await ev('store.historyIdx');
 await click('#wbCtxDelSel',0,'confirm');
 await until('store.dancers[0].actionClips.length===0&&ChoreoAbilityPlan.rows(store).length===2');
 check('P2/S8 删除所选=动作+技能同批删除、一次撤销',await ev('store.historyIdx==='+hDel+'+1'));
 await key('z','KeyZ',90,2);
 await until('store.dancers[0].actionClips.length===1&&ChoreoAbilityPlan.rows(store).length===3');
 check('P2/S8 一次 Ctrl+Z 恢复动作与技能',await ev('store.dancers[0].actionClips.length===1&&ChoreoAbilityPlan.rows(store).length===3&&store.historyIdx==='+hDel));
 // ---------- S9 Delete 键含技能 ----------
 await ev('(function(){ChoreoAbilityUI.clearSelection();clearClipSelection();refreshSelection();return true})()');
 const secondId=await ev('ChoreoAbilityPlan.rows(store).sort(function(a,b){return a.event.startMs-b.event.startMs})[1].event.id');
 await clickAbility(secondId);
 await until('ChoreoAbilityUI.selection().length===1');
 const hDelete=await ev('store.historyIdx');
 await key('Delete',46,'Delete');
 await until('ChoreoAbilityPlan.rows(store).length===2');
 check('P2/S9 Delete 键删除选中技能（一次撤销）',await ev('store.historyIdx==='+hDelete+'+1&&ChoreoAbilityPlan.rows(store).length===2'));
 await key('z','KeyZ',90,2);
 await until('ChoreoAbilityPlan.rows(store).length===3');
 check('P2/S9 撤销恢复技能',await ev('ChoreoAbilityPlan.rows(store).length===3&&store.historyIdx==='+hDelete));
 // ---------- S10 舞者区 ----------
 check('P2/S10 顶栏 1-8 快捷收进「更多设置」',await ev('(function(){var m=document.querySelector("[data-wb=more-settings]");return !!m&&m.textContent.includes("更多设置")&&m.querySelectorAll(".dancer-sel button").length===8&&!document.querySelector(".toolbar .transport .dancer-sel")})()'));
 check('P2/S10 舞者行显示 S/M 定稿文案（只看这位/暂时隐藏这位）',await ev('(function(){var b=Array.prototype.map.call(document.querySelectorAll(".dancer-grp .d-hdr .dh-sm"),function(n){return n.textContent});return b[0]==="只看这位"&&b[1]==="暂时隐藏这位"})()'));
 await click('#wbAddDancer',0,'nav');
 await until('store.dancers.length===2');
 check('P2/S10 舞者行就地添加舞者（新行有绑定与人物资源入口）',await ev('(function(){var rows=document.querySelectorAll(".dancer-grp");var r=rows[rows.length-1];return store.dancers.length===2&&!!r.querySelector(".dh-prof")&&!!r.querySelector(".dh-res")})()'));
 await ev('(function(){store.dancers[0].profileId="ghost-profile-x";render();return true})()');
 await until('!!document.querySelector(".dh-res.missing")');
 check('P2/S10 绑定档案缺失→「人物资源」高亮',await ev('(function(){var b=document.querySelector(".dh-res.missing");return !!b&&b.textContent.includes("人物资源")&&typeof b.onclick==="function"&&b.title.includes("缺失")})()'));
 const hRm=await ev('store.historyIdx');
 await click('.dancer-grp .dh-del',1,'confirm'); // 移除第二位（确认被自动接受）
 await until('store.dancers.length===1');
 check('P2/S10 舞者行就地移除（减人确认保留）+一次撤销',await ev('store.dancers.length===1&&store.historyIdx==='+hRm+'+1'));
 check('P2/S10 移除确认对话框确实弹出',dialogs.length>=1);
 await key('z','KeyZ',90,2);
 await until('store.dancers.length===2');
 check('P2/S10 撤销恢复舞者',await ev('store.dancers.length===2&&store.historyIdx==='+hRm));
 await shot('s10-dancers');step('S10 舞者区',{expect:'就地增删/更多设置/人物资源/SM 文案',actual:'已断言'});
 // ---------- S11 动作页落点预告不误导 ----------
 await ev('(function(){store.activeTab="emote-usual";render();return true})()');
 await until('!!document.getElementById("wbLanding")');
 check('P2/S11 切回动作页=落点预告不再提技能（不误导）',await ev('(function(){var t=document.getElementById("wbLanding").textContent;return t.indexOf("技能落点预告")<0&&(t.indexOf("落点预告")>=0||t.indexOf("第一个动作")>=0)})()'));
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个');
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-props-ui.js','choreo-workbench.js','choreo-ability-ui.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);json('dialogs',dialogs);
 console.log('\nSkill workbench: '+checks.length+' checks passed');
 }catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts,dialogs});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
