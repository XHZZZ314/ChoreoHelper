// 日常编排实际入口回归：固定源副本、编辑撤销、排练布局与离线保存重开。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const equal=require('node:util').isDeepStrictEqual;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=process.env.CHOREO_REHEARSAL_EVIDENCE,profile=process.env.CHOREO_REHEARSAL_PROFILE;
assert.ok(evidence&&profile,'Supply external evidence and existing authorized profile');
const sourceId=process.env.CHOREO_REHEARSAL_SOURCE_ID;
assert.ok(sourceId,'Pin the existing source project id so reruns do not duplicate earlier test fixtures');
for(const p of [evidence,profile]){const rel=path.relative(path.resolve(__dirname,'..'),path.resolve(p));assert.ok(rel.startsWith('..'+path.sep)||path.isAbsolute(rel), 'Private data stays outside repository');}
assert.ok(!fs.existsSync(evidence)&&fs.existsSync(profile));fs.mkdirSync(evidence,{recursive:true});
fs.copyFileSync(__filename,path.join(evidence,'runner.js'),fs.constants.COPYFILE_EXCL);
const daily=path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html');
const json=(name,value)=>fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(value,null,2));
let chrome,ws,seq=0,dialogAnswer;const dialogs=[],fileChoosers=[];const pending=new Map(),errors=[],checks=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true,replMode:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.unserializableValue==='-0'?0:r.result.value;}
async function until(expression){for(let i=0;i<150;i++){if(await ev(expression).catch(()=>false))return;await sleep(100);}throw Error('Wait '+expression);}
async function key(key){const code='Key'+key.toUpperCase(),windowsVirtualKeyCode=key.toUpperCase().charCodeAt(0);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,modifiers:2});await sleep(120);}
async function shot(name){await sleep(80);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));}
function check(name,ok){checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);}
// 原项目按稳定身份比较；宏草稿基线的旧片段数组也只归一排序，不移除任何业务字段。
function stableStoredDoc(value){const d=structuredClone(value);delete d.timelineRevision;
 for(const t of d.tracks)t.events.sort((a,b)=>a.id.localeCompare(b.id));d.lyrics.sort((a,b)=>a.id.localeCompare(b.id));
 for(const session of Object.values(d._extra?.macroEditors?.dancers||{}))for(const lane of ['actionClips','switchClips','lyricClips']){
  const clips=session.base?.original?.[lane];if(!clips)continue;clips.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 }return d;
}
async function open(){
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 chrome=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1600,1100','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 json("started-"+chrome.pid,{pid:chrome.pid,profile});
 let target;for(let i=0;i<300&&!target;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');}catch{}if(!target)await sleep(100);}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Page.fileChooserOpened')fileChoosers.push(m.params);if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params);if(!dialogAnswer)throw Error('Unexpected dialog');send('Page.handleJavaScriptDialog',dialogAnswer).catch(e=>errors.push({dialog:e.message}));dialogAnswer=null;}};await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});await send('Page.enable');await send('Page.setInterceptFileChooserDialog',{enabled:true});await send('Page.navigate',{url:pathToFileURL(daily).href});await until('window.store&&store.appReady');await ev('document.querySelector("#musicPanel").style.right="380px"');
 await ev(`window.cleanTimelineDoc=x=>{x=JSON.parse(JSON.stringify(x));delete x.timelineRevision;for(const e of [...x.tracks.flatMap(t=>t.events),...x.lyrics])if(e._extra)delete e._extra.selected;for(const t of x.tracks)t.events.sort((a,b)=>a.id.localeCompare(b.id));x.lyrics.sort((a,b)=>a.id.localeCompare(b.id));return x};`);
}
async function close(){if(!chrome)return;const child=chrome,done=child.exitCode!==null?Promise.resolve():new Promise(r=>child.once('exit',r));send('Browser.close').catch(()=>{});await Promise.race([done,sleep(15000)]);assert.notEqual(child.exitCode,null,'Owned browser completely exits');json('exit-'+child.pid,{pid:child.pid,code:child.exitCode});for(const p of pending.values()){clearTimeout(p.timer);p.resolve({});}pending.clear();ws.close();chrome=null;}
async function click(selector,index=0){const point=await ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error("Click target occluded: "+e.id);return {x,y}})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await sleep(100);}
const song=process.env.CHOREO_REHEARSAL_SONG;assert.ok(song&&fs.existsSync(song));
const copies=[];
async function selectSong(wait=true){await send('Page.setInterceptFileChooserDialog',{enabled:true});await click('#musicFile');const doc=await send('DOM.getDocument');const q=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#musicFile'});await send('DOM.setFileInputFiles',{nodeId:q.nodeId,files:[song]});if(wait)await until('ChoreoMusicUI.debug.snapshot().attached&&!document.querySelector("#musicReplace")');}
async function observe(){await ev(`window.appliedPose={};for(const c of __p3dDebug().engine.characters){if(c._rehearsalObserved)continue;const fn=c.applyFn;c.applyFn=function(n,p){const result=fn(n,p);(appliedPose[c.name]||(appliedPose[c.name]={}))[n]={...p};return result};c._rehearsalObserved=true;}`);await sleep(150);}
async function sample(name){const s=await ev(`(()=>{const d=__p3dDebug(),a=document.querySelector('#musicPanel audio');return {id:store.projectId,time:store.currentTime,silentPlaying:store.isPlaying,music:ChoreoMusicUI.debug.snapshot(),web:ChoreoMusicUI.webState(),audio:{time:a.currentTime,paused:a.paused,src:!!a.getAttribute('src'),count:document.querySelectorAll('#musicPanel audio').length},button:document.querySelector('#playBtn').textContent,title:document.querySelector('#playBtn').title,display:document.querySelector('#timeDisplay').textContent,head:parseFloat(document.querySelector('#playhead').style.left),pps:store.pps,label:LABEL_W,status:document.querySelector('#musicStatus').textContent,model:{ready:d.ready,masters:d.masters,bindings:d.bindings,characters:d.engine?.characters.map(c=>({name:c.name,clip:c.currentClip?.name,phase:c.clipTime,global:c.globalT,pose:c.sample()})),applied:window.appliedPose},history:{len:store.history.length,index:store.historyIdx,revision:store._docRev},overlay:{visible:getComputedStyle(document.querySelector('#playOverlay')).display!=='none',text:document.querySelector('#playOverlay').innerText,html:document.querySelector('#playOverlay').innerHTML,rows:[...document.querySelectorAll('#playOverlay .po-item')].map(e=>({label:e.querySelector('.po-dancer').textContent,name:e.querySelector('.po-name').textContent,cls:e.className,whiteSpace:getComputedStyle(e.querySelector('.po-name')).whiteSpace}))},document:projectRecord().content}})()`);json(name,s);return s;}
function progressing(a,b){return !b.audio.paused&&b.audio.time>a.audio.time+.15&&Math.abs(b.time-Math.max(0,b.audio.time-b.music.settings.offsetMs/1000))<.15&&Math.abs(b.head-(b.label+b.time*b.pps))<.1;}
function held(a,b){return b.audio.paused&&a.audio.time===b.audio.time&&a.time===b.time&&equal(a.model.characters,b.model.characters)&&equal(a.model.applied,b.model.applied);}
function clean(d){const x=stableStoredDoc(d);for(const e of [...x.tracks.flatMap(t=>t.events),...x.lyrics])if(e._extra&&Object.hasOwn(e._extra,'selected')){delete e._extra.selected;if(!Object.keys(e._extra).length)delete e._extra;}return x;}
async function seek(ms){await click('#musicSeek');await key('a');await send('Input.insertText',{text:String(ms)});await click('#musicSeekGo');await sleep(100);}
async function switchUI(id){
 const name=await ev(`(await ChoreoProjects.listProjects()).find(p=>p.id===${JSON.stringify(id)}).name`);
 await modal();await until('!document.querySelector("#projectSearchCount").textContent.includes("正在")');await query(name);
 const point=await ev(`(()=>{const matches=[...document.querySelectorAll('.modal b')].filter(x=>x.textContent===${JSON.stringify(name)});if(matches.length!==1)throw Error('Expected exactly named source row');const btn=[...matches[0].parentElement.parentElement.querySelectorAll('button')].find(x=>x.textContent==='打开');if(!btn)throw Error('Open absent');btn.scrollIntoView({block:'center'});const r=btn.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!btn.contains(document.elementFromPoint(x,y)))throw Error('Open occluded');return {x,y}})()`);
 json('switch-ui-target',{id,name,point});for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await until(`store.projectId===${JSON.stringify(id)}`);await until('!document.querySelector(".modal")');
}
// 测试夹具仅添加到刚创建的固定源副本；所有原生事件及扩展保留。
async function fixture(){await ev(`(()=>{const clip=(start,duration,name)=>({id:store.nextClipId++,start,duration,data:{name,command:'',category:'lyric',isLyric:true}});store.globalLyrics.push(clip(0,3,'原词甲：本轮排练显示'),clip(1,1,'原词重叠行'),clip(3,3,'原词乙：换行内容\\n第二行完整显示，长句不省略以便排练时阅读。'),clip(9,6,'原词丙：动作空隙仍继续'));store.dancers[0].lyricClips.push(clip(0,3,'台词甲：独立手写内容'),clip(3,3,'台词乙：不是歌曲原词'),clip(9,6,'台词丙：继续排练'));saveHistory();render();})()`);}
function shown(s,lyric,speech){return s.overlay.visible&&s.overlay.rows.some(r=>r.label==='原歌词'&&r.name===lyric)&&s.overlay.rows.some(r=>r.label.startsWith('手写台词 · ')&&r.name===speech);}
async function modal(){await click('button[title^="项目中心："]');await until('!!document.querySelector(".modal")');}
async function dismiss(){const pt=await ev('(()=>{const r=document.querySelector(".modal").getBoundingClientRect();return {x:Math.max(1,r.left-12),y:Math.max(1,r.top-12)}})()');for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...pt,button:'left',clickCount:1});await until('!document.querySelector(".modal")');}
async function query(text){await click('#projectSearch');await key('a');await send('Input.insertText',{text});await sleep(120);}
// 直接读原始存储，不调用 openProject 的恢复/最近项目路径。重复 ID 按完整记录排序，保留所有重数。
async function raw(){return ev(`await new Promise((resolve,reject)=>{const q=indexedDB.open('choreo3dproj');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction(['projects','versions'],'readonly'),p=t.objectStore('projects').getAll(),v=t.objectStore('versions').getAll();t.oncomplete=()=>{db.close();resolve({projects:p.result,versions:v.result})};t.onerror=()=>reject(t.error)}})`);}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function stored(value){const d=stableStoredDoc(value);for(const t of d.tracks)t.events.sort((a,b)=>a.id.localeCompare(b.id)||JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));d.lyrics.sort((a,b)=>a.id.localeCompare(b.id)||JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));return d;}
async function retention(before,lib){const after=await raw(),library=await ev('({profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()})');json('raw-final',after);json('library-final',library);
 check('全部旧项目完整原始存储及同 ID 重数保留',before.projects.every(p=>{const n=after.projects.find(n=>n.id===p.id);return n&&equal(stored(p.content),stored(n.content));}));
 check('全部旧历史版本逐记录保留',before.versions.every(v=>equal(v,after.versions.find(n=>n.projectId===v.projectId&&n.savedAt===v.savedAt))));
 check('全部本轮副本及资产索引保留',copies.every(id=>after.projects.some(p=>p.id===id))&&equal(lib,library));return after;
}
async function readySong(){await selectSong();await until('document.querySelector("#musicPanel audio").readyState>=3&&ChoreoMusicUI.debug.snapshot().wave.buckets>0');}
async function freshCopy(label){
 const current=await raw(),src=current.projects.find(x=>x.id===sourceId);assert.ok(src,'Fixed source exists; no recent fallback');
 const events=src.content.tracks.flatMap(t=>t.events),dances=events.filter(e=>e.data?.command?.includes('balldance'));
 assert.equal(dances.length,9);assert.equal(new Set(dances.map(e=>e.id)).size,9);assert.ok(!events.some(e=>/^(time-input|drag-noop|align-noop|fill-gap|duration|paste-anchor|toolbar|nudge|group|precise|timeline|duplicate|clipboard|rehearsal|rehearsal-text|inventory)-native-/.test(e.id)));
 assert.ok(!JSON.stringify(src.content).includes('原词甲：本轮排练显示'));json('source-'+label,src);
 const copy=await ev(`await ChoreoProjects.duplicateProject(${JSON.stringify(sourceId)})`);copies.push(copy.id);
 await ev(`await ChoreoProjects.renameProject(${JSON.stringify(copy.id)},${JSON.stringify('日常编排 '+label+' '+copy.id)});await switchProject(${JSON.stringify(copy.id)})`);await until('__p3dDebug().ready');await sleep(400);return copy.id;
}
// P4-C 旧↔新：旧=顶栏「📦 资料库」按钮(2 击自资源菜单取消菜单即已 1 击)；新=顶栏「工具」→「人物与资源」页。
async function library(){await click('#toolsBtn');await until('!!document.getElementById("toolsPage")');await click('[data-tools-page=library]');await until('document.querySelectorAll(".lib-clip-inventory").length>0');}
async function inventory(pid){const selector=`[data-profile-id="${pid}"]`;await click(selector+' summary');return ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)});return {text:r.innerText,items:[...r.querySelectorAll('.lib-clip-item')].map(e=>({name:e.dataset.clipName,text:e.textContent})),open:r.querySelector('details').open}})()`);}
// 日常编排完整流程：只编辑固定源的新副本，以生产文档和原生身份核对变化。
const uiIds={};
const events=d=>[...d.tracks.flatMap(t=>t.events),...d.lyrics];
async function doc(){return (await ev('projectRecord().content'));}
async function type(selector,value){await click(selector);await key('a');await send('Input.insertText',{text:String(value)});}
async function body(native,ctrl=false){
 if(uiIds[native]===undefined)uiIds[native]=await ev(`(()=>{const native=${JSON.stringify(native)},base={dancers:store.dancers,globalLyrics:store.globalLyrics,dancerCount:store.dancerCount,showLyricMacro:store.showLyricMacro,totalDuration:store.totalDuration,markers:store.markers,...store.contentExtra},count=d=>[...d.tracks.flatMap(t=>t.events),...d.lyrics].filter(e=>e.id===native).length,original=count(projectRecord().content),matches=[];ChoreoEdit.pure.eachClip(store,(c,di,track)=>{const p=JSON.parse(JSON.stringify(base)),arr=di<0?p.globalLyrics:p.dancers[di][track+'Clips'];const at=arr.findIndex(x=>x.id===c.id);if(at<0)throw Error('Projection identity missing');arr.splice(at,1);if(count(ChoreoDocWire.persistDoc(p,{id:store.projectId,name:store.projectName},store._docRev))<original)matches.push(c.id)});if(matches.length!==1)throw Error('Native identity not unique');return matches[0]})()`);
 const point=await ev(`(()=>{const e=[...document.querySelectorAll('.clip')].find(e=>(e.__clip?._doc?.id===${JSON.stringify(native)}||e.__clip?.id===${JSON.stringify(uiIds[native]??null)}));if(!e)throw Error('Native clip node missing');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect(),x=r.x+Math.min(22,r.width/2),y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!e.contains(hit)||hit.closest('.c-pv,.c-rz'))throw Error('Clip obscured '+hit?.className);return {x,y}})()`);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1,modifiers:ctrl?2:0});await sleep(100);return point;
}
async function roundtrip(label,before,after){await ev('document.activeElement?.blur()');await key('z');check(label+'撤销完整还原',equal(clean(before),clean(await doc())));await key('y');check(label+'重做完整还原',equal(clean(after),clean(await doc())));}
function expectOnly(before,after,id,patch){const wanted=structuredClone(before);Object.assign(events(wanted).find(e=>e.id===id),patch);return equal(clean(wanted),clean(after));}
(async()=>{let before,lib;try{
 await open();before=await raw();lib=await ev('({profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()})');json('raw-intake',before);json('library-intake',lib);
 if(process.env.CHOREO_DAILY_LAYOUT==='1'){
  const a=await freshCopy('布局回归');await fixture();await readySong();await seek(1100);
  const native=events(await doc()).find(e=>e.data?.command?.includes('balldance')).id;
  for(const [width,height] of [[1600,1100],[1280,900]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await body(native);
   const d=await doc(),history=await ev('({length:store.history.length,index:store.historyIdx})');
   const geometry=await ev(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height}};return {toolbar:rect('.transport'),overlay:rect('#playOverlay'),timeline:rect('#timelineWrap')}})()`);json('layout-'+width,geometry);
   check(width+' 排练文字独立占位不遮挡编辑工具栏或时间轴',geometry.overlay.y>=geometry.toolbar.bottom&&geometry.overlay.bottom<=geometry.timeline.y&&geometry.timeline.height>80);
   await click('#editClipTime');check(width+' 显示重叠排练文字时编辑时间可点击',await ev('!!document.querySelector("#clipTimeModal")'));await click('#clipTimeCancel');
   const pt=await ev(`(()=>{const o=document.querySelector('#playOverlay');o.scrollTop=0;const r=o.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,overflow:o.scrollHeight>o.clientHeight}})()`);
   await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:pt.x,y:pt.y,deltaX:0,deltaY:120});await sleep(200);
   check(width+' 长排练内容可用鼠标滚动查看',pt.overflow&&await ev('document.querySelector("#playOverlay").scrollTop>0'));
   await shot('layout-'+width);check(width+' 查看及取消编辑不写文档或撤销历史',equal(clean(d),clean(await doc()))&&equal(history,await ev('({length:store.history.length,index:store.historyIdx})')));
  }
  await click('button[title^="停止"]');await key('s');await sleep(350);const after=await retention(before,lib);check('布局回归无页面异常',errors.length===0);json('result',{checks,errors,copies,originalCount:before.projects.length,finalCount:after.projects.length});if(checks.some(c=>!c.ok))process.exitCode=1;return;
 }
 const a=await freshCopy('日常编辑'),initial=await sample('initial');
 assert.ok(initial.document.performers[0].profileId&&initial.model.masters.perDancer[0].source==='profile');
 assert.ok(!await ev('store.loopA!==null||store.loopB!==null'),'No preexisting loop admitted');
 const originalEvents=events(initial.document),dance=originalEvents.find(e=>e.data?.command?.includes('balldance'));assert.ok(dance);
 const tabIndex=await ev(`Array.from(document.querySelectorAll('.tab')).findIndex(e=>e.textContent.startsWith('特殊'))`);assert.ok(tabIndex>=0);await click('.tab',tabIndex);
 await type('.search input',dance.data.name);const choices=await ev(`Array.from(document.querySelectorAll('.act-item')).map(e=>e.title)`);json('action-choices',choices);const ix=choices.indexOf(dance.data.name);assert.ok(ix>=0,'Existing court dance catalog item');
 const runtimeBefore=await ev('store.dancers.flatMap(d=>d.actionClips.map(c=>c.id))');await click('.act-item',ix);const added=await doc();json('after-add',added);
 const newEvents=events(added).filter(e=>!originalEvents.some(o=>o.id===e.id));assert.equal(newEvents.length,1);const n=newEvents[0];const runtimeAdded=(await ev('store.dancers.flatMap(d=>d.actionClips.map(c=>c.id))')).filter(id=>!runtimeBefore.includes(id));assert.equal(runtimeAdded.length,1);uiIds[n.id]=runtimeAdded[0];
 const without=structuredClone(added);for(const t of without.tracks)t.events=t.events.filter(e=>e.id!==n.id);
 check('侧栏添加已有宫廷舞，只增加一个独立事件且原文档不丢内容',n.data.command.includes('balldance')&&equal(clean(initial.document),clean(without)));
 await roundtrip('添加',initial.document,added);
 await body(n.id);await click('#editClipTime');await type('#clipTimeStart',(n.startMs+2000)/1000);await click('#clipTimeConfirm');
 const moved=await doc();json('after-move',moved);check('修改起点只改变目标事件毫秒时间',expectOnly(added,moved,n.id,{startMs:n.startMs+2000}));await roundtrip('移动',added,moved);
 await body(n.id);await click('#editClipTime');await type('#clipTimeDuration','1.875');await click('#clipTimeConfirm');
 const resized=await doc(),resizedEvent=events(resized).find(e=>e.id===n.id),expectedResize=structuredClone(moved),er=events(expectedResize).find(e=>e.id===n.id);er.durationMs=1875;er._extra={...er._extra,autoDur:false};
 json('after-duration',resized);check('修改时长保留全部内容并显式关闭自动时长',resizedEvent.durationMs===1875&&equal(clean(expectedResize),clean(resized)));await roundtrip('改时长',moved,resized);
 await body(n.id);const preDup=await ev('store.dancers.flatMap(d=>d.actionClips.map(c=>c.id))');await key('d');const duplicated=await doc(),dup=events(duplicated).filter(e=>!events(resized).some(o=>o.id===e.id));assert.equal(dup.length,1);
 const duplicate=dup[0];const runtimeDup=(await ev('store.dancers.flatMap(d=>d.actionClips.map(c=>c.id))')).filter(id=>!preDup.includes(id));assert.equal(runtimeDup.length,1);uiIds[duplicate.id]=runtimeDup[0];const dupWithout=structuredClone(duplicated);for(const t of dupWithout.tracks)t.events=t.events.filter(e=>e.id!==duplicate.id);
 const normEvent=e=>{const x=structuredClone(e);delete x.id;delete x.startMs;if(x._extra){delete x._extra.selected;if(!Object.keys(x._extra).length)delete x._extra;}return x;};
 // 新添加条尚无原生载体，生产迁移器给每条生成独立文档内 clip 引用；显式已有资源引用仍由全原文档比较保护。
 const expectedDuplicate=normEvent(resizedEvent);expectedDuplicate.assetRef=duplicate.assetRef;expectedDuplicate.clipId=duplicate.clipId;
 const rawPair=await ev(`store.dancers.flatMap(d=>d.actionClips).filter(c=>[${uiIds[n.id]},${uiIds[duplicate.id]}].includes(c.id))`);
 const rawNorm=c=>{const x=structuredClone(c);delete x.id;delete x.start;delete x.selected;return x;};
 json('duplicate',{resizedEvent,duplicate,rawPair,document:duplicated});
 check('Ctrl+D 紧贴原条复制，身份独立且内容完整',duplicate.startMs===resizedEvent.startMs+resizedEvent.durationMs&&duplicate.assetRef.id===duplicate.clipId&&duplicate.clipId!==resizedEvent.clipId&&rawPair.length===2&&equal(rawNorm(rawPair[0]),rawNorm(rawPair[1]))&&equal(normEvent(duplicate),expectedDuplicate)&&equal(clean(resized),clean(dupWithout)));await roundtrip('复制',resized,duplicated);
 for(const native of [n.id,duplicate.id])if(!await ev(`store.dancers.flatMap(d=>d.actionClips).find(c=>c.id===${uiIds[native]}).selected`))await body(native,true);
 check('批量入口对应这两条真实选集',await ev('edSel().length')===2);await click('#wbCtxGroupMove');await type('#wbGroupMoveOffset','+2.137'); // P3 旧↔新：精确平移收编为多选上下文栏就地编辑（原 #preciseGroupMove/#groupMoveOffset）
 check('批量平移预览不写文档',equal(clean(duplicated),clean(await doc())));await click('#groupMoveConfirm');
 const batch=await doc(),expectedBatch=structuredClone(duplicated);for(const e of events(expectedBatch))if([n.id,duplicate.id].includes(e.id))e.startMs+=2137;
 json('after-batch',batch);check('批量调整两条只改变相同偏移并保持间距',equal(clean(expectedBatch),clean(batch)));await roundtrip('批量调整',duplicated,batch);
 await shot('edited-timeline');
 // 完整撤销整段操作、再完整重做，验证连续编辑的历史组合，而非仅单步孤立功能。
 for(let i=0;i<5;i++)await key('z');check('连续五次撤销回到原项目完整文档',equal(clean(initial.document),clean(await doc())));
 for(let i=0;i<5;i++)await key('y');check('连续五次重做恢复完整编排',equal(clean(batch),clean(await doc())));
 await fixture();await readySong();await observe();await click('#playBtn');await until('!document.querySelector("#musicPanel audio").paused&&store.currentTime>.1');const p0=await sample('playing-0');await sleep(350);const p1=await sample('playing-1');await shot('playing');
 check('编辑后原曲、播放头和真实人物骨架同步推进',progressing(p0,p1)&&!equal(p0.model.applied,p1.model.applied)&&p1.model.characters[0].clip.includes('balldance'));
 check('原词和手写台词分别显示，未应用宏草稿不混入',shown(p1,'原词甲：本轮排练显示','台词甲：独立手写内容')&&!p1.overlay.text.includes('未应用草稿'));
 await click('#playBtn');const h0=await sample('paused-0');await sleep(250);check('暂停后音频和真实人物保持',held(h0,await sample('paused-1')));
 await seek(1100);const located=await sample('located');check('暂停定位更新音频、播放头及重叠文字',located.audio.paused&&Math.abs(located.time-1.1)<.15&&shown(located,'原词重叠行','台词甲：独立手写内容'));
 await click('#playBtn');const c0=await sample('continued-0');await sleep(300);const c1=await sample('continued-1');check('继续从定位处推进音频和人物',progressing(c0,c1)&&!equal(c0.model.applied,c1.model.applied));
 await click('button[title^="停止"]');const stop=await sample('stop');check('停止归零并保持音乐和编排内容',stop.audio.paused&&stop.audio.time===0&&stop.time===0&&stop.display.includes('0:00')&&equal(clean(p1.document),clean(stop.document)));
 await key('s');await sleep(350);const saved=await sample('saved');await close();await open();await until('__p3dDebug().ready');const reopened=await sample('reopened');await shot('reopened');
 check('完整退出后离线重开完整文档、宏草稿和绑定保真，歌曲需重选',reopened.id===a&&equal(clean(saved.document),clean(reopened.document))&&!reopened.music.attached&&reopened.model.masters.perDancer[0].source==='profile');
 await readySong();await observe();await click('#playBtn');await until('!document.querySelector("#musicPanel audio").paused&&store.currentTime>.1');const r0=await sample('reopened-playing-0');await sleep(350);const r1=await sample('reopened-playing-1');await shot('reopened-playing');
 check('重选原曲后真实人物、文字和音频继续工作且引用不变',progressing(r0,r1)&&!equal(r0.model.applied,r1.model.applied)&&shown(r1,'原词甲：本轮排练显示','台词甲：独立手写内容')&&equal(saved.document._extra.music,r1.document._extra.music));
 await click('#immediateStop');const i0=await sample('immediate-0');await sleep(250);check('立即停止后音频和人物保持停止',held(i0,await sample('immediate-1')));
 // 保存后的项目切换：媒体选择尚未完成时切换，迟到结果不得写到新项目。
 const b=await freshCopy('隔离');await switchUI(a);await until('__p3dDebug().ready');await selectSong(false);await switchUI(b);await until('__p3dDebug().ready');const b0=await sample('switch-0');await sleep(700);const b1=await sample('switch-1');
 check('切换项目后旧媒体回调不写入新项目或继续播放',b1.id===b&&!b1.music.attached&&b1.audio.paused&&equal(clean(b0.document),clean(b1.document))&&equal(b0.history,b1.history));
 await switchUI(a);await until('__p3dDebug().ready');await key('s');await sleep(350);check('切回编辑项目完整内容保持',equal(clean(saved.document),clean(await doc())));
 const after=await retention(before,lib);check('无页面异常或游戏播放请求',errors.length===0&&(await ev('ChoreoMusicUI.debug.snapshot().netStarts'))===0);json('file-choosers',fileChoosers);json('result',{checks,errors,copies,originalCount:before.projects.length,finalCount:after.projects.length});if(checks.some(c=>!c.ok))process.exitCode=1;
 }catch(e){json('failure',{message:e.stack,checks,errors,copies});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{});}finally{await close();}})();
