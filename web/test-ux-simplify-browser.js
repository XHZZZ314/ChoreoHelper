// TASK-20260918-PLAYER-UX-SIMPLIFY 阶段二浏览器点验：一次性资料（HTTP 全阻断，不触真实工程/私人资产/游戏端点）。
// 包 A：技能窗常用区/高级折叠、走位/起始站位/2D 数值区/游戏面板长文折叠，原能力经折叠 UI 仍可达。
// 包 B/C 检查项随批次追加（默认落条+撤销、一键转向、2D 路径直编）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_UX_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_UX_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100)}throw Error('Wait '+expression)}
function check(n,ok){checks.push({name:n,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+n);if(!ok)throw Error(n)}
async function route(p){const u=new URL(p.request.url);requests.push({host:u.host,path:u.pathname});await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
async function shot(n){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,n+'.png'),Buffer.from(r.data,'base64'))}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(evidence,'throwaway-profile');fs.mkdirSync(profile,{recursive:true});
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1500,1000','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<200&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function click(selector,index=0){const p=await ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});let r=n.getBoundingClientRect();for(const f of [.5,.85,.98,.2]){let x=r.x+r.width*f,y=r.y+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
// r3：双击=两次完整点击（clickCount 1→2），Chrome 合成 click+click+dblclick
async function dblclick(selector,index=0){const p=await ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});let r=n.getBoundingClientRect();for(const f of [.5,.85,.98,.2]){let x=r.x+r.width*f,y=r.y+r.height/2;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent)})()`);for(const c of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:c});await sleep(120)}
// A1 收纳后折叠区内按钮在文档序中先于常用区按钮，索引会漂移：一律按文本解析按钮再点击。
async function btnText(text,scope='button'){const i=await ev(`Array.from(document.querySelectorAll(${JSON.stringify(scope)})).findIndex(b=>b.textContent===${JSON.stringify(text)})`);if(!(i>=0))throw Error('Missing button '+text);await click(scope==='button'?'button':scope,i)}
const inAdv=s=>`(!!document.querySelector(${JSON.stringify(s)})&&!!document.querySelector(${JSON.stringify(s)}).closest('.ability-advanced'))`;
(async()=>{try{
 await open();
 check('一次性资料空店启动',await ev('store.dancers.length>=1'));
 // P1-A 旧↔新：空项目现在先显示三入口空态卡（旧：直接是空轨道墙）。本探针只测收纳行为，
 // 经新入口「从零开始」进入工作台（导航 1 击）后再继续原有的行为断言。
 await ev('ChoreoWorkbench.beginWorkbench();render()');await until('document.querySelector(".tl-area")&&document.querySelector(".ability-lane")');
 check('P1-A 新壳入口：从零开始进入工作台（旧↔新：空态卡→工作台）',await ev('!!document.getElementById("wbAddBar")&&!document.getElementById("wbEmpty")'));
 const skill={id:120,type:'action',name:'测试技能',staticMetadata:{version:1,actionId:120,castMs:1500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
 // ---------- 包 A1：技能窗收纳 ----------
 await ev(`ChoreoAbilityUI.open(${JSON.stringify(skill)},0,2.5)`);await until('document.querySelector(".ability-editor")');
 // P2 旧↔新：编辑面从独立浮窗迁入统一上下文栏（仍在 #wbCtxHost 内、选择器不变）；折叠区文案由「技能细节」定稿为「更多设置（专家参数）」，且目标类型按合同收进该折叠区（常用区只留触发时刻）。
 check('A1 高级区默认折叠',await ev('(function(){var d=document.querySelector(".ability-advanced");return d&&!d.open&&d.querySelector("summary").textContent.includes("更多设置")})()'));
 check('A1 新建默认目标=未指定对象时使用自身',await ev('document.querySelector("select[aria-label=排练目标类型]").value==="defaultSelf"'));
 check('A1 常用区只含触发时刻（目标类型收进更多设置，P2 旧↔新；默认目标值在摘要/折叠区可见）',await ev('(function(){var inAdv='+inAdv('input[aria-label="触发时刻（秒）"]')+';var kindInAdv='+inAdv('select[aria-label=排练目标类型]')+';return !inAdv&&kindInAdv})()'));
 check('A1 专家字段收进高级区',await ev('(function(){var cast='+inAdv('input[aria-label="咏唱提示时长（秒）"]')+',pres='+inAdv('input[aria-label="触发表现提示时长（秒）"]')+',who='+inAdv('select[aria-label=目标舞者]')+',rules=!!document.querySelector(".ability-advanced .ability-target-rules");return cast&&pres&&who&&rules})()'));
 check('A1 两个专家子区收进高级区',await ev('(function(){var a=document.querySelector(".ability-advanced");return !!a&&a.textContent.includes("本舞者技能动作")&&a.textContent.includes("实际执行时序")})()'));
 check('A1 常用区按钮=应用/取消（编辑时删除在外可见）',await ev('(function(){var box=document.querySelector(".ability-editor");var texts=Array.from(box.children).filter(n=>n.tagName==="BUTTON").map(b=>b.textContent);return texts.length===2&&texts[0]==="应用技能编排"&&texts[1]==="取消"})()'));
 // 选中需补充字段的目标类型时自动展开高级区
 check('A1 依赖型目标自动展开高级区',await ev('(function(){var d=document.querySelector(".ability-advanced");d.open=false;var s=document.querySelector("select[aria-label=排练目标类型]");s.value="enemyMarker";s.dispatchEvent(new Event("change"));return d.open&&document.querySelector("input[aria-label=敌人标记名称]").parentNode.style.display!=="none"})()'));
 // 经折叠 UI 完成一次应用（能力保持）
 await ev('(function(){var s=document.querySelector("select[aria-label=排练目标类型]");s.value="defaultSelf";s.dispatchEvent(new Event("change"));return true})()');
 await btnText('应用技能编排');await until('!document.querySelector(".ability-editor")');
 check('A1 折叠窗应用落库（defaultSelf/目录基础咏唱/表现1s）',await ev('(function(){var r=ChoreoAbilityPlan.rows(store);var p=ChoreoAbilityPlan.plan(r[0].event);return r.length===1&&p.target.kind==="defaultSelf"&&p.castMs===1500&&p.presentationMs===1000&&r[0].event.startMs===2500})()'));
 // ---------- r3 属主点验修正：技能条单击=选中、双击=开窗（与时间轴惯例一致） ----------
 await ev('ChoreoAbilityUI.quickAdd('+JSON.stringify(skill)+',0,8)'); // 第二条技能，经公开默认落条入口
 await until('document.querySelectorAll(".ability-clip").length===2');
 // P2 旧↔新：应用后编辑面收起并保留该技能为选中（摘要上下文栏可见）；本段测单击选中语义，先清选中回到旧探针的起点。
 await ev('ChoreoAbilityUI.clearSelection()');
 await click('.ability-clip',0);
 check('r3 单击技能条=选中且不开编辑窗',await ev('(function(){var c=document.querySelectorAll(".ability-clip");return c[0].classList.contains("selected")&&!c[1].classList.contains("selected")&&!document.querySelector(".ability-editor")})()'));
 await click('.ability-clip',1);
 check('r3 点其它技能条切换选中',await ev('(function(){var c=document.querySelectorAll(".ability-clip");return !c[0].classList.contains("selected")&&c[1].classList.contains("selected")})()'));
 await click('.ability-clip',1);
 check('r3 再点同条取消选中',await ev('!document.querySelector(".ability-clip.selected")'));
 await click('.ability-clip',0);
 check('r3 选中态可见（复用 .selected 口径）',await ev('document.querySelectorAll(".ability-clip.selected").length===1'));
 await ev('(function(){document.querySelector(".ability-lane .lane-body").dispatchEvent(new MouseEvent("click",{bubbles:true}));return true})()');
 check('r3 点空白清除选中且条目无变化',await ev('!document.querySelector(".ability-clip.selected")&&ChoreoAbilityPlan.rows(store).length===2'));
 await dblclick('.ability-clip',0);await until('document.querySelector(".ability-editor")');
 // P2 旧↔新：双击语义由「开浮窗且默认折叠」改为「选中并展开更多设置」（就地编辑，不再独立浮窗）。
 check('r3 双击技能条=选中并展开更多设置',await ev('(function(){var e=document.querySelector(".ability-editor");return !!e&&!!e.closest("#wbCtxHost")&&document.querySelector(".ability-clip.selected")&&document.querySelector(".ability-advanced").open===true})()'));
 await btnText('取消');await until('!document.querySelector(".ability-editor")'); // 编辑态常用区按钮=应用/删除/取消（文本定位防折叠区按钮漂移）
 check('A1 编辑窗取消零改动',await ev('ChoreoAbilityPlan.rows(store).length===2'));
 await ev('undo()');await ev('undo()');
 check('A1 撤销还原空技能轨',await ev('ChoreoAbilityPlan.rows(store).length===0'));
 await shot('packA-ability');
 // ---------- 包 A2：起始位置/2D/走位/游戏面板收纳 ----------
 // P3 旧↔新：舞者行「起始位置」入口不再直开对话框，改为工作台俯视就地编辑（#wbStartBar：俯视拖点＋
 // 「更多设置（专家参数）」里的 X/Z/朝向数值）；原对话框保留为精确输入/窄窗回落（2D 舞台「数字编辑」直达）。
 await click('.start-entry',0);await until('document.getElementById("wbStartBar")');
 check('P3 起始位置就地编辑打开（切俯视+更多设置数值默认折叠+仅网页预览注记）',await ev('(function(){var b=document.getElementById("wbStartBar");var m=document.getElementById("wbStartMore");var i=document.getElementById("wbStartX");return !!b&&document.getElementById("wbTabTop").classList.contains("on")&&!!m&&!m.open&&!!i&&b.textContent.includes("网页预览")&&b.textContent.includes("游戏执行")})()'));
 await ev('ChoreoStageUI.cancelStartPosition()');
 await until('!document.getElementById("wbStartBar")');
 // A2 原对话框断言保留（P3：入口改经保留的对话框 API，内容/折叠/通知不变）
 await ev('ChoreoStageUI.openStartDialog(0)');await until('document.getElementById("startFormationModal")');
 check('A2 起始站位说明默认折叠且按钮仍 3 个',await ev('(function(){var m=document.getElementById("startFormationModal");var d=m.querySelector("details.start-notes");return d&&!d.open&&m.querySelectorAll("button").length===3})()'));
 check('A2 起始站位通知文字仍在（折叠不减内容）',await ev('(function(){var t=document.getElementById("startFormationModal").textContent;return t.includes("网页预览")&&t.includes("游戏执行")&&t.includes("骨骼")})()'));
 await ev('ChoreoStageUI.closeStartDialog()');
 await ev('ChoreoStageUI.openStage()');await until('document.getElementById("stageDragModal")');
 check('A2 2D 舞台数值区默认折叠',await ev('(function(){var f=document.querySelector(".stage-nums-fold");return f&&!f.open})()'));
 check('A2 展开后数字输入可达',await ev('(function(){document.querySelector(".stage-nums-fold").open=true;var i=document.querySelector(".stage-ix");i.focus();return document.activeElement===i})()'));
 await ev('ChoreoStageUI.closeStage(true)');
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 check('A2 走位面板说明与数值表默认折叠',await ev('(function(){var t=document.querySelector(".stage-motion-tables"),n=document.querySelector(".stage-motion-notes");return t&&!t.open&&n&&!n.open})()'));
 await ev('Array.from(document.querySelectorAll(".stage-motion-editor button")).find(b=>b.textContent==="取消").click()');
 await ev('ChoreoStageGameUI.open(0)');await until('document.querySelector("dialog[aria-label=游戏单人路径]")');
 check('A2 游戏短演出 intro 默认折叠',await ev('(function(){var d=document.querySelector("dialog[aria-label=游戏单人路径] details.stage-game-intro");return d&&!d.open&&d.textContent.includes("/choreo stage")})()'));
 await ev('document.querySelector("dialog[aria-label=游戏单人路径]").close()');
 await ev('ChoreoShowEntry.open()');await until('document.querySelector("dialog[aria-label=游戏演出整场检查]")');
 check('A2 整场检查 intro 默认折叠',await ev('(function(){var d=document.querySelector(".show-entry-intro");return d&&!d.open&&d.textContent.includes("统一入口")})()'));
 await ev('document.querySelector("dialog[aria-label=游戏演出整场检查]").close()');
 // ---------- 包 B1：技能默认落条 ----------
 const skillA={id:120,type:'action',name:'测试技能甲',command:'/ac 测试技能甲',category:'skill',staticMetadata:{version:1,actionId:120,castMs:1500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
 const skillB={id:121,type:'action',name:'旧技能乙',command:'/ac 旧技能乙',category:'skill'};
 await ev('(function(){store.activeTab="skill-all";store.search="";store.actions=['+JSON.stringify(skillA)+','+JSON.stringify(skillB)+'];render();return true})()');
 await until('document.querySelectorAll(".act-item").length===2');
 const h0=await ev('store.historyIdx');
 await click('.act-item .ai-name',0);
 await until('ChoreoAbilityPlan.rows(store).length===1');
 check('B1 侧栏点技能=默认落条不弹窗（defaultSelf/目录咏唱/表现1s/轨末时刻）',await ev('(function(){var r=ChoreoAbilityPlan.rows(store),p=ChoreoAbilityPlan.plan(r[0].event);return !document.querySelector(".ability-editor")&&p.target.kind==="defaultSelf"&&p.castMs===1500&&p.presentationMs===1000&&r[0].event.durationMs===2500&&r[0].event.startMs===0})()'));
 check('B1 默认落条单次撤销（historyIdx +1）',await ev('store.historyIdx==='+h0+'+1')&&await (async()=>{await ev('undo()');return await ev('ChoreoAbilityPlan.rows(store).length===0&&store.historyIdx==='+h0)})());
 // 拖放到技能轨落点：合成 drop 事件（dataTransfer 携带 fromSidebar 载荷）
 await ev('(function(){var body=document.querySelector(".ability-lane .lane-body");var dt=new DataTransfer();dt.setData("text/plain",JSON.stringify({fromSidebar:true,data:'+JSON.stringify(skillA)+'}));body.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()');
 await until('ChoreoAbilityPlan.rows(store).length===1');
 check('B1 拖放技能=按落点时刻默认落条',await ev('ChoreoAbilityPlan.rows(store)[0].event.startMs===0'));
 await ev('undo()');
 // 缺目录基础时间：明确提示 + 回落打开编辑窗（不静默）
 await click('.act-item .ai-name',1);
 await until('document.querySelector(".ability-editor")');
 check('B1 缺目录基础时间→明示回落编辑窗零写入',await ev('(function(){return ChoreoAbilityPlan.rows(store).length===0&&document.querySelector("#toast").textContent.includes("无法按默认落条")})()'));
 await btnText('取消');await until('!document.querySelector(".ability-editor")');
 // 添加到全部舞者：逐位默认落条整批一次撤销
 await ev('(function(){while(store.dancers.length<2)store.dancers.push({id:store.dancers.length,name:"伴舞"+store.dancers.length,color:"#5dde8e",switchClips:[],actionClips:[],lyricClips:[],collapsed:false,laneScale:1,currentJob:"",solo:false,mute:false});store.dancerCount=2;store.addToAll=true;render();return true})()');
 const hAll=await ev('store.historyIdx');
 await click('.act-item .ai-name',0);
 await until('ChoreoAbilityPlan.rows(store).length===2');
 check('B1 addToAll 技能=两位舞者整批落条一次撤销',await ev('store.historyIdx==='+hAll+'+1')&&await (async()=>{await ev('undo()');return await ev('ChoreoAbilityPlan.rows(store).length===0&&store.historyIdx==='+hAll)})());
 await ev('store.addToAll=false;store.actions=[];render()');
 // ---------- 包 B2：一键转向 + 前进 3 秒 ----------
 await ev('(function(){ChoreoEdit.pure.setDancerStart(store.dancers,0,"1","2","90");saveHistory();render();return true})()');
 const hq=await ev('store.historyIdx');
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 check('B2 面板快捷行在折叠区外可见',await ev('(function(){var q=document.querySelector(".stage-motion-quick");var t=document.querySelector(".stage-motion-tables");return q&&q.textContent.includes("原地转 90")&&q.textContent.includes("前进 3 秒")&&t&&!t.open})()'));
 await btnText('原地转 90°');await sleep(250);
 check('B2 面板一键转向：末尾+2秒 facing 节点，单次撤销',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).facing)===JSON.stringify([{time:"2",yaw:"90"}])&&store.historyIdx==='+hq+'+1'));
 await btnText('原地转 90°');await sleep(250);
 check('B2 面板重复同角度=复用不写（零历史）',await ev('ChoreoStageMotion.nodes(store,0).facing.length===1&&store.historyIdx==='+hq+'+1'));
 await btnText('前进 3 秒（当前朝向）');await sleep(250);
 check('B2 面板前进3秒：+3秒沿朝向1.5米（90°朝向→+X）',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).movement)===JSON.stringify([{time:"3",x:"2.5",z:"2"}])&&store.historyIdx==='+hq+'+2'));
 await btnText('取消');await until('!document.querySelector(".stage-motion-editor")');
 await ev('undo()');await ev('undo()');
 check('B2 面板快捷两次提交两次撤销后清空',await ev('ChoreoStageMotion.nodes(store,0).movement.length===0&&ChoreoStageMotion.nodes(store,0).facing.length===0&&store.historyIdx==='+hq));
 await ev('ChoreoStageUI.openStage()');await until('document.getElementById("stageDragModal")');
 await btnText('原地转 180°');await sleep(250);
 check('B2 2D 舞台一键转向落库单次撤销',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).facing)===JSON.stringify([{time:"2",yaw:"180"}])&&store.historyIdx==='+hq+'+1'));
 await btnText('前进 3 秒（当前朝向）');await sleep(250);
 check('B2 2D 舞台前进3秒（起始朝向90°→+X）',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).movement)===JSON.stringify([{time:"3",x:"2.5",z:"2"}])&&store.historyIdx==='+hq+'+2'));
 await ev('undo()');await ev('undo()');
 check('B2 2D 快捷两次撤销后清空',await ev('ChoreoStageMotion.nodes(store,0).movement.length===0&&ChoreoStageMotion.nodes(store,0).facing.length===0&&store.historyIdx==='+hq));
 await ev('ChoreoStageUI.closeStage(true)');
 // ---------- 包 C：2D 走位路径直编 ----------
 await ev('ChoreoStageUI.openStage()');await until('document.getElementById("stageDragModal")');
 check('C 编辑态默认关',await ev('(function(){var b=document.getElementById("stageDragModal");return !b._pathMode&&!document.querySelector(".stage-pathnode")})()'));
 await btnText('✎ 走位路径');await sleep(250);
 check('C 开启后无路径不画节点',await ev('(function(){var b=document.getElementById("stageDragModal");return b._pathMode===true&&document.querySelectorAll(".stage-pathnode").length===0})()'));
 // 点画布加节点：时刻=播放头。点前在页内换算预期世界坐标（与实现同变换；B8 翻转后第二参回镜像 viewH−sy），断言落库一致。
 const clickCanvas=async(t)=>{await ev('(function(){store.currentTime='+t+';return true})()');const r=await ev('(function(){var s=document.getElementById("stageSurface").getBoundingClientRect();var bg=document.getElementById("stageDragModal");var su=document.getElementById("stageSurface");var cl=su.clientLeft||0,ct=su.clientTop||0;var fr=[[.7,.35],[.25,.75],[.6,.8],[.2,.25],[.5,.5]];for(var i=0;i<fr.length;i++){var x=s.left+s.width*fr[i][0],y=s.top+s.height*fr[i][1];var hit=document.elementFromPoint(x,y);if(hit&&hit.closest&&hit.closest("button"))continue;x=Math.round(x);y=Math.round(y);var w=ChoreoEdit.pure.stageScreenToWorld(x-s.left-cl,bg._transform.viewH-(y-s.top-ct),bg._transform);return {x,y,wx:ChoreoEdit.pure.quantStage(w.x),wz:ChoreoEdit.pure.quantStage(w.z)}}throw Error("no empty canvas point")})()');for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',clickCount:1});await sleep(300);return r};
 const hC=await ev('store.historyIdx');
 const c1=await clickCanvas(2);
 console.log('C1-DIAG',JSON.stringify(await ev('(function(){var n=ChoreoStageMotion.nodes(store,0).movement;return {n:n,toast:(document.getElementById("toast")||{}).textContent,h:store.historyIdx,mode:!!(document.getElementById("stageDragModal")||{})._pathMode,pn:document.querySelectorAll(".stage-pathnode").length,cur:store.currentTime}})()')),'expect',JSON.stringify(c1));
 check('C 点画布=播放头 2 秒加节点（厘米量化）',await ev('(function(){var n=ChoreoStageMotion.nodes(store,0).movement;return n.length===1&&n[0].time==="2"&&Number(n[0].x)==='+c1.wx+'&&Number(n[0].z)==='+c1.wz+'&&store.historyIdx==='+hC+'+1})()'));
 const c2=await clickCanvas(5);
 check('C 第二节点 5 秒严格递增',await ev('(function(){var n=ChoreoStageMotion.nodes(store,0).movement;return n.length===2&&n[1].time==="5"&&Number(n[1].x)==='+c2.wx+'&&Number(n[1].z)==='+c2.wz+'&&store.historyIdx==='+hC+'+2})()'));
 await ev('(function(){var s=document.getElementById("stageSurface").getBoundingClientRect();return true})()');
 await (async()=>{const r=await ev('(function(){var s=document.getElementById("stageSurface").getBoundingClientRect();var fr=[[.5,.6],[.3,.85],[.75,.15]];for(var i=0;i<fr.length;i++){var x=s.left+s.width*fr[i][0],y=s.top+s.height*fr[i][1];var hit=document.elementFromPoint(x,y);if(hit&&hit.closest&&hit.closest("button"))continue;return {x,y}}throw Error("no empty canvas point")})()');for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',clickCount:1});await sleep(250)})();
 check('C 同刻（播放头仍 5 秒）拒绝不写',await ev('ChoreoStageMotion.nodes(store,0).movement.length===2&&store.historyIdx==='+hC+'+2'));
 // 点按选中节点（无位移）→ 行内微调时刻
 const nodeCtr=async(i)=>await ev('(function(){var n=document.querySelectorAll(".stage-pathnode")['+i+'];var r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 let p=await nodeCtr(1);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await sleep(250);
 check('C 点按选中节点出微调行',await ev('(function(){var bg=document.getElementById("stageDragModal");return bg._pathSel===1&&document.querySelector(".stage-path-edit").style.display!=="none"&&document.querySelector(".stage-path-time").value==="5"})()'));
 await ev('(function(){var i=document.querySelector(".stage-path-time");i.value="3";return true})()');await btnText('应用时刻');await sleep(250);
 check('C 时刻微调 5→3 秒（单次撤销）',await ev('JSON.stringify(ChoreoStageMotion.nodes(store,0).movement.map(v=>v.time))===JSON.stringify(["2","3"])&&store.historyIdx==='+hC+'+3'));
 // 删除节点
 p=await nodeCtr(0);
 console.log('C-PRECLICK',JSON.stringify(await ev('(function(){var __cx='+p.x+',__cy='+p.y+';var ns=Array.from(document.querySelectorAll(".stage-pathnode")).map(function(n,i){var r=n.getBoundingClientRect();return {i:i,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}});var hit=document.elementFromPoint(__cx,__cy);return {ns:ns,click:{x:__cx,y:__cy},hit:hit?hit.tagName+"."+hit.className:null}})()')));
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await sleep(250);
 console.log('C-SEL0-DIAG',JSON.stringify(await ev('(function(){var bg=document.getElementById("stageDragModal");var row=document.querySelector(".stage-path-edit");var i=row.querySelector(".stage-path-time");return {sel:bg._pathSel,shown:row.style.display,val:i.value,ds:JSON.stringify(i.dataset),n:ChoreoStageMotion.nodes(store,0).movement.length,h:store.historyIdx}})()')));
 await btnText('删除节点');await sleep(250);
 console.log('C-DEL-DIAG',JSON.stringify(await ev('(function(){var row=document.querySelector(".stage-path-edit");return {n:ChoreoStageMotion.nodes(store,0).movement,h:store.historyIdx,sel:(document.getElementById("stageDragModal")||{})._pathSel,ds:(row.querySelector(".stage-path-time")||{}).dataset,rowShown:row.style.display,toast:(document.getElementById("toast")||{}).textContent}})()')));
 check('C 删除节点（剩 1 节点）',await ev('ChoreoStageMotion.nodes(store,0).movement.length===1&&ChoreoStageMotion.nodes(store,0).movement[0].time==="3"&&store.historyIdx==='+hC+'+4'));
 // 拖节点：按下→移动→释放=位置改（冻结变换换算；期望同 B8 回镜像口径 viewH−sy）
 p=await nodeCtr(0);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
 const drop=await ev('(function(){var s=document.getElementById("stageSurface").getBoundingClientRect();var bg=document.getElementById("stageDragModal");var su=document.getElementById("stageSurface");var cl=su.clientLeft||0,ct=su.clientTop||0;var x=Math.round(s.left+s.width*0.3),y=Math.round(s.top+s.height*0.65);var w=ChoreoEdit.pure.stageScreenToWorld(x-s.left-cl,bg._transform.viewH-(y-s.top-ct),bg._transform);return {x,y,wx:ChoreoEdit.pure.quantStage(w.x),wz:ChoreoEdit.pure.quantStage(w.z)}})()');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+((drop.x-p.x)/2),y:p.y+((drop.y-p.y)/2),button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drop.x,y:drop.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drop.x,y:drop.y,button:'left',clickCount:1});await sleep(300);
 check('C 拖节点释放提交改位置（单次撤销）',await ev('(function(){var v=ChoreoStageMotion.nodes(store,0).movement[0];return Number(v.x)==='+drop.wx+'&&Number(v.z)==='+drop.wz+'&&store.historyIdx==='+hC+'+5})()'));
 // 逐步撤销回空
 for(let i=0;i<5;i++)await ev('undo()');
 check('C 五次提交五次撤销后清空',await ev('ChoreoStageMotion.nodes(store,0).movement.length===0&&store.historyIdx==='+hC));
 await ev('ChoreoStageUI.closeStage(true)');
 // 面板同数据 + 3D 同一采样：重建一条路径后两处口径一致
 await ev('(function(){ChoreoStageUI.openStage();return true})()');await until('document.getElementById("stageDragModal")');
 await btnText('✎ 走位路径');await sleep(250);await clickCanvas(4);await sleep(200);
 await ev('ChoreoStageUI.closeStage(true)');
 await ev('ChoreoStageMotionUI.open(0)');await until('document.querySelector(".stage-motion-editor")');
 await ev('document.querySelector(".stage-motion-tables").open=true');await sleep(150);
 check('C 走位面板数值表=同一份数据',await ev('(function(){var i=document.querySelector(\'input[aria-label="路径节点1 到达秒"]\');return i&&i.value==="4"})()'));
 await ev('Array.from(document.querySelectorAll(".stage-motion-editor button")).find(b=>b.textContent==="取消").click()');
 // 3D 预览同一采样（preview3d.js placementOf→ChoreoStageMotion.sample(store,di,currentTime)）
 await ev('(function(){store.currentTime=6;return true})()');
 await ev('(function(){var i=Array.from(document.querySelectorAll(\'.toolbar button\')).findIndex(b=>b.textContent.includes("3D预览"));if(i>=0)document.querySelectorAll(\'.toolbar button\')[i].click();return true})()');
 await until('window.__p3dDebug&&__p3dDebug().ready');
 await ev('(function(){store.currentTime=6;try{__p3dRefreshPlacement()}catch(e){}return true})()');await sleep(400);
 console.log('C-3D-DIAG',JSON.stringify(await ev('(function(){var d=__p3dDebug();var v=ChoreoStageMotion.nodes(store,0).movement;return {ready:d&&d.ready,pl:d&&d.placements?d.placements[0]:null,nodes:v,cur:store.currentTime}})()')));
 check('C 3D 预览采样=路径节点位置（同一 ChoreoStageMotion.sample）',await ev('(function(){var v=ChoreoStageMotion.nodes(store,0).movement[0];var pl=__p3dDebug().placements[0];return pl&&Math.abs(pl.x-Number(v.x))<1e-6&&Math.abs(pl.z-Number(v.z))<1e-6})()')); // debug 快照不含 stageMotion 标志，以位置一致为准
 await ev('(function(){document.querySelector(".p3d-close")&&document.querySelector(".p3d-close").click();undo();return true})()');
 check('全程零未捕获异常',errors.length===0);
 await shot('packA-done');
 json('checks',checks);json('requests',requests);json('errors',errors);console.log('PASS pack A browser probe');
}catch(e){json('failure',{message:e.message,stack:e.stack});json('checks',checks);json('errors',errors);await shot('failure').catch(()=>{});console.error(e);process.exitCode=1}finally{await close();process.exit(process.exitCode||0)}})();
