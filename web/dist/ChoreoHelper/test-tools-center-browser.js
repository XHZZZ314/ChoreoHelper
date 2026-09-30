// TASK-20260919-UI-OVERHAUL P4-C 旅程式浏览器探针：顶栏「工具」→工具中心分页容器
// （人物与资源/录制/协同/高级工具）。覆盖：工具 1 击直达；各页 1 击切换；资料库 15 按钮/7 控件
// 与 XAT 三面；档案列表/待归档（不可恢复删除确认）与「用于舞者」关闭回编排；录制 4 模式与
// 自选/审核（审核=真实重放提示）；协同入口经 openEnsemblePanel；高级 6 项（实验标注）与
// 预览/布局开关；歌词/2D 舞台/音乐保持顶栏 1 击；旧资源/视图菜单与 advBtn 移除；窄窗排练设置不动。
// 真实指针（CDP Input.dispatchMouseEvent/KeyEvent），一次交互→明确状态（until 轮询），HTTP(S) 全阻断，
// 一次性 throwaway 资料（不触真实工程/私人资产/游戏端点）。证据目录由 CHOREO_TOOLS_EVIDENCE 指定
// 且必须为全新绝对路径（Windows Chrome 以相对 --user-data-dir 拒绝启动）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_TOOLS_EVIDENCE;
assert.ok(evidence&&path.isAbsolute(evidence),'需要全新绝对路径证据目录 CHOREO_TOOLS_EVIDENCE');
assert.ok(!fs.existsSync(evidence),'证据目录必须不存在，避免覆盖旧证据');fs.mkdirSync(evidence,{recursive:true});
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
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1440,900','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(evidence,'chrome-stderr.log'),'a')]});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(100)}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Fetch.requestPaused')route(m).catch(e=>errors.push({route:e.message}))};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http://'},{urlPattern:'https://'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:require('node:url').pathToFileURL(entry).href});await until('window.store&&store.appReady');
}
async function close(){if(!chrome)return;const p=chrome,done=p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(p.exitCode,null);json('exit',{pid:p.pid,code:p.exitCode});for(const q of pending.values()){clearTimeout(q.timer);q.resolve({})}pending.clear();ws.close();chrome=null}
async function point(selector,index=0,kind='select'){return ev(`(()=>{let n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();const l=Math.max(r.left,0)+2,rr=Math.min(r.right,innerWidth)-2;if(rr<=l)throw Error('Target outside viewport '+n.textContent);for(const f of [.05,.2,.5,.8,.95]){const x=l+(rr-l)*f,y=r.y+r.height/2;if(y<4||y>innerHeight-4)continue;if(n.contains(document.elementFromPoint(x,y)))return {x,y}}throw Error('Occluded '+n.textContent+' rect='+JSON.stringify({l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width}))})()`).then(p=>{counts[kind]++;return p})}
async function clickAt(p){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(120)}
async function click(selector,index=0,kind='select'){return clickAt(await point(selector,index,kind))}
async function key(code,vk,keyName){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:keyName||code,code,windowsVirtualKeyCode:vk});await sleep(120)}
// 关掉最上层 .modal-bg：真实指针点空白背景（与原生弹窗的遮罩关闭一致）
async function closeAnyModal(){
 const p=await ev(`(()=>{const bd=[...document.querySelectorAll('.modal-bg')].find(n=>n.getClientRects().length);if(!bd)throw Error('no modal-bg');const r=bd.getBoundingClientRect();for(const y of [r.top+24,r.top+90,innerHeight-24])for(const x of [12,innerWidth-12]){if(document.elementFromPoint(x,y)===bd)return {x,y}}throw Error('no backdrop point')})()`);
 await clickAt(p);await sleep(120);
}
const toolbarButtons='Array.from(document.querySelectorAll(".toolbar-nav button"))';
(async()=>{try{
 await open();
 // ---------- S0 顶栏形态：工具 1 击入口 + 歌词/2D/音乐直达；旧菜单与 advBtn 移除 ----------
 check('P4C-1 顶栏「工具」入口在场（1 击直达工具中心）',await ev(toolbarButtons+'.some(function(b){return b.id==="toolsBtn"&&b.textContent.includes("工具")&&b.title.indexOf("工具中心")>=0})'));
 check('P4C-1 歌词入口保持顶栏 1 击（去向登记：顶栏直达）',await ev(toolbarButtons+'.some(function(b){return b.textContent.includes("歌词")})'));
 check('P4C-1 2D 舞台与音乐保持顶栏 1 击导航',await ev('!!document.getElementById("stageBtn")&&!!document.getElementById("musicBtn")'));
 check('P4C-1 旧「资源」「视图」菜单已移除（只余舞者更多设置）',await ev('(function(){var ms=document.querySelectorAll("details.toolbar-menu");for(var i=0;i<ms.length;i++){var t=ms[i].querySelector("summary").textContent;if(t.indexOf("资源")>=0||t.indexOf("视图")>=0)return false}return true})()'));
 check('P4C-1 旧高级按钮/弹层已移除',await ev('!document.getElementById("advBtn")&&!document.getElementById("advPop")&&!document.querySelector("button[title^=\\"配对、兼容模式\\"]")'));
 check('P4C-1 顶栏不建「开演」入口（P5 占位不建）',await ev('!'+toolbarButtons+'.some(function(b){return b.textContent.indexOf("开演")>=0})'));
 await shot('s0-topbar');step('S0 顶栏形态',{expect:'工具/歌词/2D/音乐直达，资源/视图菜单与 advBtn 移除'});
 // ---------- S1 工具 1 击 → 人物与资源页（资料库 15 按钮/7 控件 + XAT 三面） ----------
 const nav0=counts.nav;
 await click('#toolsBtn',0,'nav');
 await until('!!document.getElementById("toolsCenterModal")');
 check('P4C-2 工具入口 1 击直达工具中心',counts.nav===nav0+1);
 check('P4C-2 四页签在场（人物与资源/录制/协同/高级工具）',await ev('["library","record","ensemble","advanced"].every(function(p){var b=document.querySelector("[data-tools-page="+p+"]");return !!b&&b.getAttribute("role")==="tab"})'));
 check('P4C-2 默认落在「人物与资源」页（资料库面板在场）',await ev('document.querySelector("[data-tools-page=library]").classList.contains("active")&&!!document.querySelector("#toolsPage .lib-panel")'));
 check('P4C-3 资料库面板 15 按钮（空库含 XAT 与停止导入）',await ev('document.querySelectorAll("#toolsPage .lib-panel button").length===15'));
 check('P4C-3 资料库面板 7 控件（2 隐藏 file + 3 XAT 文本 + 动作包 file/覆盖 checkbox）',await ev('document.querySelectorAll("#toolsPage .lib-panel input").length===7&&document.querySelectorAll("#toolsPage .lib-panel input[type=file]").length===3'));
 check('P4C-3 五个资料库操作逐项在场',await ev('(function(){var t=document.querySelector("#toolsPage .lib-panel").textContent;return t.includes("从插件导入全部动作")&&t.includes("导入角色包")&&t.includes("导出备份")&&t.includes("导入备份")&&t.includes("清空")})()'));
 check('P4C-4 XAT 单条面：读取/开始/取消/入库/骨架下载在场',await ev('(function(){var t=document.querySelector("#toolsPage .lib-panel").textContent;return t.includes("游戏动作转换")&&t.includes("从当前角色读取")&&t.includes("开始转换")&&t.includes("取消")&&t.includes("存入当前档案资料库")&&t.includes("下载骨架 JSON")})()'));
 check('P4C-4 XAT 批量面：读取/全选/开始准备/停止在场（计数与失败重试由未改模块保留）',await ev('(function(){var t=document.querySelector("#toolsPage .lib-panel").textContent;return t.includes("一键准备")&&t.includes("读取绑定动作")&&t.includes("全选单 entry")&&t.includes("开始准备")&&t.includes("当前项完成后")})()'));
 check('P4C-4 离线动作包面：拖入框/覆盖同名动作/文件选择在场',await ev('(function(){var p=document.querySelector("#toolsPage .lib-panel");var cb=[...p.querySelectorAll("input[type=checkbox]")].some(function(c){return c.title.indexOf("覆盖")>=0});var fi=[...p.querySelectorAll("input[type=file]")].some(function(f){return f.accept&&f.accept.indexOf(".gz")>=0});return p.textContent.includes("导入离线动作包")&&p.textContent.includes("拖进下面虚线框")&&cb&&fi})()'));
 await shot('s1-resources-empty');step('S1 人物与资源（空库）',{expect:'15 按钮/7 控件/XAT 三面在场'});
 await closeAnyModal();
 await until('!document.getElementById("toolsCenterModal")');
 // 种子：一个角色档案 + 一条待归档动作（throwaway IndexedDB，不触真实资料）。
 // 独立读回等待写入落库（不依赖 evaluate 的 awaitPromise 时序），保证断言确定性。
 await ev('(async function(){window.__p4cProf=await ChoreoLibrary.createProfile({name:"P4C 探针档案",skeleton:__CHOREO_SKELETON_SNAPSHOT__});await ChoreoLibrary.putClip("p4c-pending",{type:"once",duration:0.5,bones:{bone_0:{q:[[0,0,0,0,1]]}}},"__pending__");return true})()');
 await until('!!window.__p4cProf&&(await ChoreoLibrary.pendingClipIndex()).length===1');
 await click('#toolsBtn',0,'nav');
 await until('!!document.querySelector("#toolsPage [data-profile-id]")&&(document.querySelector("#toolsPage .lib-panel").textContent||"").includes("等待归档")');
 check('P4C-5 档案列表按数据行渲染（标识/骨架指纹可见）',await ev('(function(){var r=document.querySelector("#toolsPage [data-profile-id]");return r.dataset.profileId===__p4cProf.id&&r.textContent.includes("P4C 探针档案")&&r.textContent.includes("骨架")})()'));
 check('P4C-5 档案行四操作齐备（用于舞者/导出角色包/重命名/删除）',await ev('(function(){var r=document.querySelector("#toolsPage [data-profile-id]");return !!r.querySelector(".lib-use")&&r.textContent.includes("导出角色包")&&r.textContent.includes("重命名")&&r.textContent.includes("删除")})()'));
 check('P4C-5 选择来源≠身份推断（同名不是同一资产+核对标识/指纹文案保留）',await ev('(function(){var t=document.querySelector("#toolsPage .lib-panel").textContent;return t.includes("同名不是同一资产")&&t.includes("骨架指纹")&&t.includes("用于舞者")})()'));
 check('P4C-6 待归档动作区：计数提示+归档所选+删除所选+目标档案选择',await ev('(function(){var p=document.querySelector("#toolsPage .lib-panel");return p.textContent.includes("等待归档")&&p.textContent.includes("归档所选")&&p.textContent.includes("删除所选")&&[...p.querySelectorAll("option")].some(function(o){return o.textContent.includes("P4C 探针档案")})})()'));
 await ev('window.__p4cConfirm="";window.__p4cRealConfirm=window.confirm;window.confirm=function(m){window.__p4cConfirm=String(m);return false}');
 await click('#toolsPage .lib-panel button',await ev('Array.from(document.querySelectorAll("#toolsPage .lib-panel button")).findIndex(function(b){return b.textContent==="删除所选"})'),'confirm');
 await until('window.__p4cConfirm.length>0');
 check('P4C-6 待归档删除仍走不可恢复确认（取消零改动）',await ev('window.__p4cConfirm.indexOf("不影响已归档")>=0&&(await ChoreoLibrary.pendingClipIndex()).length===1'));
 await ev('window.confirm=window.__p4cRealConfirm');
 // 用于舞者：绑定成功即关闭工具中心回到编排（旧资料库弹窗行为等价）
 const pid=await ev('__p4cProf.id');
 await click('#toolsPage .lib-panel .lib-use',0,'confirm');
 await until('store.dancers[0].profileId==='+JSON.stringify(pid));
 check('P4C-5 「用于舞者」立即绑定并关闭工具中心',await ev('!document.getElementById("toolsCenterModal")&&store.dancers[0].profileId==='+JSON.stringify(pid)));
 await ev('undo()');
 await until('!store.dancers[0].profileId');
 check('P4C-5 绑定可一次撤销恢复',true);
 await shot('s2-resources-seeded');step('S2 档案与待归档',{expect:'档案四操作/不可恢复确认/用于舞者关闭'});
 // ---------- S2 录制页：4 模式 + 自选/审核真实重放提示 ----------
 await ev('store.gameConnected=true;store.exportConnected=true');
 const navR=counts.nav;
 await click('#toolsBtn',0,'nav');
 await click('[data-tools-page=record]',0,'nav');
 await until('!!document.querySelector("#toolsPage .rec-panel")');
 check('P4C-7 录制页 1 击切换（工具中心内）',counts.nav===navR+2);
 check('P4C-8 四种录制模式逐项在场',await ev('(function(){var t=document.querySelector("#toolsPage .rec-panel").textContent;return t.includes("快速常用")&&t.includes("完整全量")&&t.includes("补录缺失")&&t.includes("自选")})()'));
 check('P4C-8 实际操作角色标注保留（录制期间别操作游戏角色）',await ev('document.querySelector("#toolsPage .rec-panel").textContent.includes("别操作游戏角色")'));
 await click('#toolsPage .rec-panel button',await ev('Array.from(document.querySelectorAll("#toolsPage .rec-panel button")).findIndex(function(b){return b.textContent.indexOf("自选")>=0})'),'select');
 await until('document.querySelector("#toolsPage .rec-panel").textContent.includes("审核所选")');
 check('P4C-9 自选区四操作在场（全选可录/清空/录制所选/审核所选）',await ev('(function(){var t=document.querySelector("#toolsPage .rec-panel").textContent;return t.includes("全选可录")&&t.includes("清空")&&t.includes("录制所选")&&t.includes("审核所选")})()'));
 check('P4C-9 审核=真实重放提示保留（角色会真的做动作）',await ev('(function(){var b=Array.from(document.querySelectorAll("#toolsPage .rec-panel button")).find(function(x){return x.textContent.indexOf("审核所选")>=0});return !!b&&b.title.indexOf("重放")>=0&&b.title.indexOf("真的做动作")>=0})()'));
 await shot('s3-record');step('S2 录制页',{expect:'4 模式+自选/审核提示'});
 await closeAnyModal();
 // ---------- S3 协同页：只迁入口，仍调 window.openEnsemblePanel ----------
 const navE=counts.nav;
 await click('#toolsBtn',0,'nav');
 await click('[data-tools-page=ensemble]',0,'nav');
 await until('!!document.getElementById("toolsOpenEnsemble")');
 check('P4C-10 协同页 1 击切换且入口在场（经 window.openEnsemblePanel）',counts.nav===navE+2&&await ev('document.getElementById("toolsOpenEnsemble").textContent.includes("双人直连")'));
 check('P4C-10 协同页说明保留本机授权/只传邀请与计时语义',await ev('(function(){var t=document.getElementById("toolsPage").textContent;return t.includes("只传邀请")&&t.includes("授权")})()'));
 await click('#toolsOpenEnsemble',0,'nav');
 await until('!!document.querySelector(".choreo-ensemble-panel")');
 check('P4C-10 打开双人直连面板（原面板本体，入口零触碰授权链）',await ev('(function(){var p=document.querySelector(".choreo-ensemble-panel");return p&&p.getClientRects().length>0&&(p.textContent.includes("生成双人邀请")&&p.textContent.includes("接受邀请并生成答复")&&p.textContent.includes("准备并允许本次开演")&&p.textContent.includes("本机停止"))})()'));
 await click('.choreo-ensemble-panel [data-action=hide]',0,'nav');
 await until('!document.querySelector(".choreo-ensemble-panel").getClientRects().length');
 check('P4C-10 面板收起后演出继续语义不变（面板本体保留）',await ev('!!document.querySelector(".choreo-ensemble-panel")'));
 await shot('s4-ensemble');step('S3 协同页',{expect:'入口调用原面板'});
 // ---------- S4 高级工具页：6 项逐项 + 实验标注 + 预览/布局去向 ----------
 const navA=counts.nav;
 await click('#toolsBtn',0,'nav');
 await click('[data-tools-page=advanced]',0,'nav');
 await until('!!document.getElementById("toolsCompact")');
 check('P4C-11 高级工具页 1 击切换',counts.nav===navA+2);
 const advLabels=await ev('Array.from(document.querySelectorAll("#toolsPage button")).slice(0,6).map(function(b){return b.textContent})');
 check('P4C-12 高级 6 项逐项在场（拍照/引擎/配对/演出执行/插入时间/删除时间）',
  advLabels.length===6&&advLabels[0].includes("拍照精确")&&advLabels[1].includes("引擎")&&/配对/.test(advLabels[2])&&advLabels[3].includes("演出执行")&&advLabels[4].includes("插入时间")&&advLabels[5].includes("删除时间"));
 check('P4C-12 实验演出窗明确「实验」标注（不与 P5 开演入口混淆）',advLabels[3].indexOf("实验")>=0);
 check('P4C-13 原视图菜单的固定/浮动预览与紧凑布局逐项保留（去向登记）',await ev('!!document.getElementById("toolsFloatPreview")&&!!document.getElementById("toolsCompact")'));
 const compact0=await ev('store.compact');
 await click('#toolsCompact',0,'confirm');
 await until('store.compact==='+(!compact0));
 check('P4C-13 紧凑布局开关仍生效',await ev('store.compact==='+(!compact0)));
 await click('#toolsCompact',0,'confirm');
 await until('store.compact==='+compact0);
 const float0=await ev('window.ChoreoDock.floating');
 await click('#toolsFloatPreview',0,'confirm');
 await until('window.ChoreoDock.floating==='+(!float0));
 check('P4C-13 固定/浮动预览开关仍生效且文案随态',await ev('window.ChoreoDock.floating==='+(!float0)+'&&document.getElementById("toolsFloatPreview").textContent===('+(!float0)+'?"固定预览":"浮动预览")'));
 await click('#toolsFloatPreview',0,'confirm');
 await until('window.ChoreoDock.floating==='+float0);
 await shot('s5-advanced');step('S4 高级工具页',{expect:'6 项+实验标注+布局开关'});
 await closeAnyModal();
 // ---------- S5 歌词/音乐/2D 顶栏 1 击 ----------
 await click('.toolbar-nav button',await ev(toolbarButtons+'.findIndex(function(b){return b.textContent.indexOf("歌词")>=0})'),'nav');
 await until('document.querySelector(".modal h3")&&document.querySelector(".modal h3").textContent.indexOf("歌词导入")>=0');
 check('P4C-14 顶栏「歌词」1 击打开既有歌词导入（能力不删）',true);
 await closeAnyModal();
 const musicHidden=await ev('document.getElementById("musicBody").hidden');
 await click('#musicBtn',0,'nav');
 await until('document.getElementById("musicBody").hidden==='+(!musicHidden));
 check('P4C-14 顶栏「音乐」1 击切换音乐区（原视图菜单能力）',true);
 await click('#musicBtn',0,'nav');
 await until('document.getElementById("musicBody").hidden==='+musicHidden);
 await click('#stageBtn',0,'nav');
 await until('!!document.getElementById("stageDragModal")');
 check('P4C-14 顶栏「2D 舞台」1 击打开既有 2D 舞台（能力不删）',await ev('document.getElementById("stageDragModal").textContent.includes("2D 舞台")'));
 await closeAnyModal();
 await shot('s6-topbar-entries');step('S5 歌词/音乐/2D',{expect:'三者保持 1 击'});
 // ---------- S6 窄窗：排练设置不动，工具中心仍可达 ----------
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===1000');await sleep(300);
 check('P4C-15 窄窗「排练设置」菜单保持（含 3D 预览与速度）',await ev('(function(){var s=document.querySelector("details.rehearsal-settings");return !!s&&s.textContent.includes("排练设置")&&s.textContent.includes("3D预览")&&!!s.querySelector("input[type=range]")})()'));
 await click('#toolsBtn',0,'nav');
 await until('!!document.getElementById("toolsCenterModal")');
 check('P4C-15 窄窗工具中心仍 1 击可开、四页签在场',await ev('["library","record","ensemble","advanced"].every(function(p){return !!document.querySelector("[data-tools-page="+p+"]")})'));
 await closeAnyModal();
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await until('innerWidth===1440');await sleep(200);
 // ---------- 收口 ----------
 check('全程无 JS 异常',errors.length===0,errors.length+' 个');
 check('未发起非本机 HTTP(S) 请求（全阻断）',requests.every(r=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host)),JSON.stringify(requests.slice(0,3)));
 const hashes={};for(const f of ['choreo-helper-app.html','choreo-helper-app.css','choreo-app.js','choreo-library-ui.js','choreo-recording-ui.js','choreo-xat-convert-ui.js','choreo-ensemble-ui.js','choreo-bootstrap.js']){
  const h=sha=>crypto.createHash('sha256').update(fs.readFileSync(sha)).digest('hex');
  hashes[f]={source:h(path.resolve(__dirname,f)),dist:h(path.resolve(__dirname,'dist/ChoreoHelper',f))};
  check('源=dist 逐字节孪生 '+f,hashes[f].source===hashes[f].dist);
 }
 json('checks',checks);json('steps',steps);json('requests',requests);json('counts',counts);json('hashes',hashes);
 console.log('\nToolsCenter: '+checks.length+' checks passed');
}catch(e){json('failure',{message:e.stack,checks,errors,requests,steps,counts,ctx:await ev('(function(){var p=document.querySelector("#toolsPage .lib-panel");return {page:document.querySelector("[data-tools-page].active")&&document.querySelector("[data-tools-page].active").dataset.toolsPage,lib:!!p,text:p?p.innerText.slice(0,600):null,pending:(window.__p4cProf&&{prof:!!window.__p4cProf})||null}})()').catch(function(err){return {dumpError:String(err)}})});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}finally{await close()}})();
