// 在指定项目新副本中验证插入删除时间拒绝非有限输入的撤销历史、身份和完整离线重开；证据仅存仓库外。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const equal=require('node:util').isDeepStrictEqual;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=process.env.CHOREO_TIMELINE_EVIDENCE,profile=process.env.CHOREO_TIMELINE_PROFILE;
assert.ok(evidence&&profile,'Supply external evidence and existing authorized profile');
const sourceId=process.env.CHOREO_TIMELINE_SOURCE_ID;
assert.ok(sourceId,'Pin the existing source project id so reruns do not duplicate earlier test fixtures');
for(const p of [evidence,profile]){const rel=path.relative(path.resolve(__dirname,'..'),path.resolve(p));assert.ok(rel.startsWith('..'+path.sep)||path.isAbsolute(rel), 'Private data stays outside repository');}
assert.ok(!fs.existsSync(evidence)&&fs.existsSync(profile));fs.mkdirSync(evidence,{recursive:true});
const daily=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const json=(name,value)=>fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(value,null,2));
let chrome,ws,seq=0,dialogAnswer;const dialogs=[];const pending=new Map(),errors=[],checks=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.unserializableValue==='-0'?0:r.result.value;}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100);}throw Error('Wait '+expression);}
async function key(key){const code='Key'+key.toUpperCase(),windowsVirtualKeyCode=key.toUpperCase().charCodeAt(0);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,modifiers:2});await sleep(120);}
async function shot(name){await ev('document.getElementById("timelineWrap").scrollLeft=190*store.pps');await sleep(80);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));}
function check(name,ok){checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);}
// 原项目按稳定身份比较；宏草稿基线的旧片段数组也只归一排序，不移除任何业务字段。
function stableStoredDoc(value){const d=structuredClone(value);delete d.timelineRevision;
 for(const t of d.tracks)t.events.sort((a,b)=>a.id.localeCompare(b.id));d.lyrics.sort((a,b)=>a.id.localeCompare(b.id));
 for(const session of Object.values(d._extra?.macroEditors?.dancers||{}))for(const lane of ['actionClips','switchClips','lyricClips']){
  const clips=session.base?.original?.[lane];if(!clips)continue;assert.equal(new Set(clips.map(c=>c.id)).size,clips.length);clips.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 }return d;
}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1600,1100','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 json("started-"+chrome.pid,{pid:chrome.pid,profile});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');}catch{}if(!target)await sleep(100);}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params);if(!dialogAnswer)throw Error('Unexpected dialog');send('Page.handleJavaScriptDialog',dialogAnswer).catch(e=>errors.push({dialog:e.message}));dialogAnswer=null;}};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Page.enable');await send('Page.navigate',{url:pathToFileURL(daily).href});await until('window.store&&store.appReady');
 await ev(`window.cleanTimelineDoc=x=>{x=JSON.parse(JSON.stringify(x));delete x.timelineRevision;for(const e of [...x.tracks.flatMap(t=>t.events),...x.lyrics])if(e._extra)delete e._extra.selected;for(const t of x.tracks)t.events.sort((a,b)=>a.id.localeCompare(b.id));x.lyrics.sort((a,b)=>a.id.localeCompare(b.id));return x};`);
}
async function close(){if(!chrome)return;const child=chrome,done=child.exitCode!==null?Promise.resolve():new Promise(r=>child.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(child.exitCode,null,'Owned browser completely exits');json('exit-'+child.pid,{pid:child.pid,code:child.exitCode});for(const p of pending.values()){clearTimeout(p.timer);p.resolve({});}pending.clear();ws.close();chrome=null;}
async function click(selector,index=0){const point=await ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await sleep(100);}
(async()=>{try{
 await open();
 await ev(`document.querySelector('.p3d-close')?.click();window.existing=await ChoreoProjects.listProjects();if(!existing.some(p=>p.id===${JSON.stringify(sourceId)}))throw Error('Pinned source missing');window.originals={};for(const p of existing)originals[p.id]=(await ChoreoProjects.openProject(p.id)).record.content;window.sourceDoc=originals[${JSON.stringify(sourceId)}];if(sourceDoc.tracks.flatMap(t=>t.events).filter(e=>e.data?.command?.includes('balldance')).length!==9)throw Error('Nine original dances required');if([...sourceDoc.tracks.flatMap(t=>t.events),...sourceDoc.lyrics].some(e=>/^(time-input|drag-noop|align-noop|fill-gap|duration|paste-anchor|toolbar|nudge|group|precise|timeline|duplicate|clipboard)-native-/.test(e.id)))throw Error('Prior test fixture source rejected');window.libraryBefore={profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()};`);
 json('source-verified',{sourceId,...await ev('({sourceDoc,originals,libraryBefore})')});
 await ev(`window.copy=await ChoreoProjects.duplicateProject(${JSON.stringify(sourceId)});await switchProject(copy.id);window.baseCount=store.dancers.length;window.sample=JSON.parse(JSON.stringify(store.dancers[0].actionClips.find(c=>c.data?.command?.includes('balldance'))));if(!sample)throw Error('Court dance clip missing');window.fixture=(lane,n)=>{let c=JSON.parse(JSON.stringify(sample));c.id=store.nextClipId++;c.start=200.5+n*20;c.duration=1.713+n*.013;c.autoDur=true;c.data=lane==='action'?c.data:{name:'时间编辑 '+lane,command:lane==='switch'?'/job PLD':'/say 手写台词',isLyric:lane==='lyric'};c._doc=Object.assign({},c._doc,{id:'time-input-native-'+lane,kind:lane==='action'||lane==='switch'?'motion':'lyrics',legacyLane:lane==='global'?'global':lane,enabled:true,locked:false,createdWith:ChoreoDocument.MODULE_TAG,notes:'保留备注 '+lane,futureNative:{nested:[lane,37]}});if(lane!=='action')Object.assign(c._doc,{command:c.data.command,text:c.data.name});c.futureTimeline={keep:[lane]};return c};for(let i=0;i<2;i++){let d=JSON.parse(JSON.stringify(store.dancers[0]));d.id=900+i;delete d._doc;d.name='时间编辑舞者'+i;d.switchClips=[];d.actionClips=[];d.lyricClips=[];store.dancers.push(d)}store.dancerCount=store.dancers.length;store.dancers[baseCount].actionClips=[fixture('action',0)];store.dancers[baseCount].switchClips=[fixture('switch',1)];store.dancers[baseCount].lyricClips=[fixture('lyric',2)];let g=fixture('global',3);g._doc.kind='lyrics';g.data.isLyric=true;store.globalLyrics.push(g);store.totalDuration=300;store.loopA=store.loopB=null;clearClipSelection();store.selectedClip=null;let other=fixture('action',4);other._doc.id='time-input-native-other';other.start=204.312;other.duration=1.419;store.dancers[baseCount+1].actionClips.push(other);let tail=fixture("action",5);tail._doc.id="time-input-native-tail";tail.start=203.583;tail.duration=1.117;store.dancers[baseCount].actionClips.push(tail);window.seedDoc=projectRecord().content;applyProjectContent(seedDoc);saveHistory();render();window.snap=()=>cleanTimelineDoc(projectRecord().content);window.seed=snap();window.events=d=>[...d.tracks.flatMap(t=>t.events),...d.lyrics];window.sourceClips=JSON.parse(JSON.stringify(store.dancers[baseCount]));`);
 await ev('delete store.dancers[baseCount].lyricClips[0].autoDur;store.dancers[baseCount].switchClips[0].autoDur=false;saveHistory();render()');
 json('seed',await ev('({copyId:copy.id,baseCount,seed,sourceClips})'));

 await ev("window.nativeId=c=>ChoreoDocWire.persistDoc({dancers:[{id:0,actionClips:[c],switchClips:[],lyricClips:[]}],globalLyrics:[]},{id:store.projectId,name:'identity probe'}).tracks.flatMap(t=>t.events)[0].id;store.pps=16;store.currentTime=200.125;store.markers.push({id:'time-input-marker',t:210.138,name:'保留标记',future:{nested:[3]}});saveHistory();render()");
 async function geometry(){return ev('(()=>{const a=[];ChoreoEdit.pure.eachClip(store,c=>{const n=(_clipNodes[c.id]||[]).find(n=>n.isConnected);a.push({id:nativeId(c),left:n?.style.left,width:n?.style.width,start:c.start,duration:c.duration})});return a.sort((a,b)=>a.id.localeCompare(b.id))})()');}
 async function exact(name,expected){const actual=await ev('snap()');check(name,equal(actual,expected));if(!equal(actual,expected))json('mismatch-'+checks.length,{expected,actual});}
 // P4-C 旧↔新：旧=顶栏「⋯ 高级」→#advPop 弹层第 5/6 项；新=顶栏「工具」→「高级工具」页同序按钮
 // （拍照/引擎/配对/演出执行/插入时间/删除时间）。插入/删除仍调同一 insDelTime 入口，prompt 语义不变。
 async function input(ins,value){await click('#toolsBtn');await until('!!document.getElementById("toolsPage")');await click('[data-tools-page=advanced]');await until('document.querySelectorAll("#toolsPage button").length>=6');dialogAnswer=value===null?{accept:false}:{accept:true,promptText:value};await click('#toolsPage button',ins?4:5);assert.equal(dialogAnswer,null,'Actual browser prompt handled');await sleep(150);}
 const before=await ev('snap()'),beforeGeometry=await geometry(),beforeHistory=await ev('({idx:store.historyIdx,length:store.history.length})');
 await shot('before-input');
 await input(false,'1e309');
 check('超范围时长显示明确中文拒绝',await ev('document.getElementById("toast").textContent.includes("有限")'));await exact('超范围删除输入不得改变完整文档',before);check('异常删除不增历史',equal(beforeHistory,await ev('({idx:store.historyIdx,length:store.history.length})')));check('异常删除所有条身位置宽度保持',equal(beforeGeometry,await geometry()));
 json('overflow-step',{before,after:await ev('snap()'),beforeGeometry,afterGeometry:await geometry(),dialogs});await shot('overflow-delete');
 if(!process.env.CHOREO_TIME_INPUT_BASELINE){
  for(const ins of [true,false])for(const value of ['Infinity','1e308','-Infinity','NaN','','0','-2','0.24',null]){
   const d=await ev('snap()'),h=await ev('({idx:store.historyIdx,length:store.history.length})'),g=await geometry();await input(ins,value);
   await exact((ins?'插入':'删除')+'拒绝或取消 '+String(value),d);check('无操作历史和DOM保持 '+ins+' '+String(value),equal(h,await ev('({idx:store.historyIdx,length:store.history.length})'))&&equal(g,await geometry()));
  }
  async function expectedShift(delta){return ev('(()=>{const p=JSON.parse(JSON.stringify(Object.assign({dancers:store.dancers,globalLyrics:store.globalLyrics,dancerCount:store.dancerCount,showLyricMacro:store.showLyricMacro,totalDuration:store.totalDuration,markers:store.markers},store.contentExtra||{})));ChoreoEdit.pure.eachClip(p,c=>{if(c.start>=store.currentTime)c.start+='+delta+'});p.markers.forEach(m=>{if(m.t>=store.currentTime)m.t+='+delta+'});return cleanTimelineDoc(ChoreoDocWire.persistDoc(p,{id:store.projectId,name:store.projectName},store._docRev))})()');}
  const insBefore=await ev('snap()'),insGeometry=await geometry(),insExpected=await expectedShift(.5),insIdx=await ev('store.historyIdx');
  await input(true,'0.25');await exact('原半秒量化下边界插入仅平移后方起点和标记',insExpected);check('插入只增一步历史',await ev('store.historyIdx')===insIdx+1);
  const insAfter=await ev('snap()'),insAfterGeometry=await geometry();check('真实条身只右移8px且宽度不变',insAfterGeometry.every(g=>{const b=insGeometry.find(x=>x.id===g.id);return g.width===b.width&&(b.start>=200.125?Math.abs(parseFloat(g.left)-parseFloat(b.left)-8)<.01:g.left===b.left)}));await shot('valid-insert');
  await key('z');await exact('有效插入一次撤销完整恢复',insBefore);const redo=await ev('({idx:store.historyIdx,length:store.history.length})');
  await input(true,'1e309');check('异常插入保留已有重做分支',equal(redo,await ev('({idx:store.historyIdx,length:store.history.length})')));await exact('异常插入不改任何业务字段',insBefore);
  await key('y');await exact('异常输入后实际重做仍恢复有效插入',insAfter);
  // 既有删除区间规则由纯模块回归覆盖；此处使用空隙中的0.5秒验证原毫秒偏移与真实条身。
  await ev('store.totalDuration=300;saveHistory();render()');
  const delBefore=await ev('snap()'),delGeometry=await geometry(),delExpected=await expectedShift(-.5);
  await input(false,'0.5');await exact('有效删除仅左移起点标记并按原规则缩短总时长',delExpected);
  const delAfter=await ev('snap()'),delAfterGeometry=await geometry();check('真实条身只左移8px且宽度不变',delAfterGeometry.every(g=>{const b=delGeometry.find(x=>x.id===g.id);return g.width===b.width&&(b.start>=200.125?Math.abs(parseFloat(g.left)-parseFloat(b.left)+8)<.01:g.left===b.left)}));await shot('valid-delete');
  await key('z');await exact('有效删除一次撤销完整恢复',delBefore);const delRedo=await ev('({idx:store.historyIdx,length:store.history.length})');await input(false,'Infinity');check('异常删除保留已有重做分支',equal(delRedo,await ev('({idx:store.historyIdx,length:store.history.length})')));await key('y');await exact('异常删除后实际重做仍恢复',delAfter);
  check('宏草稿仍未应用',await ev('document.querySelector(".macro-tx").value.includes("未应用草稿")&&!events(snap()).some(e=>e.data?.command?.includes("未应用草稿"))'));
 }
 json('dialogs',dialogs);
 json('final-editor',await ev('({document:snap(),copyId:copy.id})'));await shot('final-editor');
 await ev('await manualSnapshot();persistProject()');const saved=await ev('({id:store.projectId,content:snap(),originals,libraryBefore})');json('saved',saved);
 await close();await open();
 const reopened=await ev('({id:store.projectId,content:cleanTimelineDoc(projectRecord().content)})');json('reopened',reopened);
 check('完整退出后离线重开文档保真',reopened.id===saved.id&&equal(reopened.content,saved.content));
 const preserved=await ev('window.preservedDocs={};for(const p of await ChoreoProjects.listProjects())preservedDocs[p.id]=(await ChoreoProjects.openProject(p.id)).record.content;({docs:preservedDocs,library:{profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()}})');json('preserved-projects',preserved);
 check('原项目旧测试副本与资产索引保持',Object.entries(saved.originals).every(([id,d])=>equal(stableStoredDoc(d),stableStoredDoc(preserved.docs[id])))&&equal(preserved.library,saved.libraryBefore));
 await ev('document.querySelector(".p3d-close")?.click();store.pps=16;render()');await shot('offline-reopened');check('无页面异常',errors.length===0);
 json('result',{checks,errors,profile,daily});if(checks.some(c=>!c.ok))process.exitCode=1;
}catch(e){json('failure',{message:e.stack,errors,checks});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{});}finally{await close();}})();
