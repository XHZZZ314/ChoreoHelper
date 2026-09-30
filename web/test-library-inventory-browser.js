// 人物动作资料库实际入口回归：固定源副本、现有资产关联、撤销重做与离线保存。
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
 await ev(`await ChoreoProjects.renameProject(${JSON.stringify(copy.id)},${JSON.stringify('人物动作清单 '+label+' '+copy.id)});await switchProject(${JSON.stringify(copy.id)})`);await until('__p3dDebug().ready');await sleep(400);return copy.id;
}
// P4-C 旧↔新：旧=顶栏「📦 资料库」按钮；新=顶栏「工具」→「人物与资源」页（同一资料库面板内容）。
async function library(){await click('#toolsBtn');await until('!!document.getElementById("toolsPage")');await click('[data-tools-page=library]');await until('document.querySelectorAll(".lib-clip-inventory").length>0');}
async function inventory(pid){const selector=`[data-profile-id="${pid}"]`;await click(selector+' summary');return ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)});return {text:r.innerText,items:[...r.querySelectorAll('.lib-clip-item')].map(e=>({name:e.dataset.clipName,text:e.textContent})),open:r.querySelector('details').open}})()`);}
(async()=>{let before,lib;try{
 await open();before=await raw();lib=await ev('({profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()})');json('raw-intake',before);json('library-intake',lib);
 const a=await freshCopy('关联'),initial=await sample('initial');const pid=initial.document.performers[0].profileId;
 assert.ok(pid&&lib.profiles.some(p=>p.id===pid),'Use existing explicitly bound character only');
 await library();const view=await inventory(pid);json('inventory',view);await shot('inventory');
 check('每个人物显示已有真实骨架指纹',await ev('(await ChoreoLibrary.listProfiles()).every(p=>!p.skeletonHash||[...document.querySelectorAll("[data-profile-id]")].find(e=>e.dataset.profileId===p.id)?.textContent.includes(p.skeletonHash.slice(0,12)))'));
 check('按人物展开的清单与其动作索引完整对应',view.open&&equal(view.items.map(x=>x.name),lib.clips[pid].map(x=>x.name))&&view.items.every(x=>x.text.includes('骨架指纹一致')));
 const readOnly=await sample('after-view');check('查看资料不改变生产文档、撤销历史或资产',equal(initial.document,readOnly.document)&&equal(initial.history,readOnly.history)&&equal(lib,await ev('({profiles:await ChoreoLibrary.listProfiles(),clips:await ChoreoLibrary.allClipIndex()})')));await dismiss();
 // 只在新副本模拟外来项目的悬空人物引用，不删除或改写任何资料库资产。
 await ev(`store.dancers[0].profileId='inventory-missing-profile';saveHistory();__p3dBindingsChanged();render()`);await until('__p3dDebug().ready');
 const absent=await sample('missing-profile');json('missing-notices',await ev('__p3dDebug() .masters'));await shot('missing-profile');
 check('缺少档案保持引用并显示替身而不借默认人物',await ev('store.dancers[0].profileId==="inventory-missing-profile"&&__p3dDebug().masters.perDancer[0].reason==="missing-profile"&&__p3dDebug().masters.perDancer[0].source==="standin"'));
 await modal();await until('!document.querySelector(".modal").textContent.includes("正在核对")');check('缺少人物明确说明本地恢复或重新关联',await ev('document.querySelector(".modal").textContent.includes("缺少绑定的人物档案")'));await dismiss();
 await library();await inventory(pid);await click(`[data-profile-id="${pid}"] .lib-use`);await until('!document.querySelector(".modal")&&__p3dDebug().ready');
 check('用于具名舞者后恢复正确真实人物和自己的动作',await ev(`store.dancers[0].profileId===${JSON.stringify(pid)}&&__p3dDebug().masters.perDancer[0].profileId===${JSON.stringify(pid)}&&__p3dDebug().masters.perDancer[0].source==='profile'`));
 const bound=await sample('bound');check('重新关联保留全部原生事件、扩展、绑定和独立草稿',equal(clean(initial.document),clean(bound.document)));
 await key('z');await until('__p3dDebug().ready');check('关联可撤销到缺失引用且不删除编排',await ev('store.dancers[0].profileId==="inventory-missing-profile"'));await key('y');await until('__p3dDebug().ready');check('重做恢复原人物绑定及完整文档',equal(clean(initial.document),clean((await sample('redo')).document)));
 await fixture();await readySong();await observe();await click('#playBtn');await until('!document.querySelector("#musicPanel audio").paused&&store.currentTime>.1');const p0=await sample('playing-0');await sleep(350);const p1=await sample('playing-1');await shot('playing');
 check('复用原动作时原生音频、播放头、显示和真实骨架同步推进',progressing(p0,p1)&&!equal(p0.model.applied,p1.model.applied)&&p1.model.characters[0].clip.includes('balldance'));
 check('原词与手写台词显示，未应用草稿未混入',shown(p1,'原词甲：本轮排练显示','台词甲：独立手写内容')&&!p1.overlay.text.includes('未应用草稿'));
 await click('#playBtn');const h0=await sample('paused-0');await sleep(250);const h1=await sample('paused-1');check('暂停原生音频与真实人物保持',held(h0,h1));await seek(1100);const located=await sample('located');check('定位保留暂停并更新音频人物与重叠文字',located.audio.paused&&Math.abs(located.time-1.1)<.15&&shown(located,'原词重叠行','台词甲：独立手写内容'));await click('button[title^="停止"]');
 const b=await freshCopy('切换');await switchUI(a);await until('__p3dDebug().ready');
 await ev(`store.dancers[0].profileId='inventory-missing-profile';saveHistory();__p3dBindingsChanged();render()`);await until('__p3dDebug().ready');await library();
 await ev('window.realGetProfile=ChoreoLibrary.getProfile;window.releaseLibraryRead=null;ChoreoLibrary.getProfile=(id)=>realGetProfile(id).then(p=>new Promise(resolve=>{window.releaseLibraryRead=()=>resolve(p)}))');await click(`[data-profile-id="${pid}"] .lib-use`);await until('!!window.releaseLibraryRead');await dismiss();await ev('ChoreoLibrary.getProfile=realGetProfile');await switchUI(b);await until('__p3dDebug().ready');const b0=await sample('before-old-binding');await ev('releaseLibraryRead()');await sleep(200);const b1=await sample('after-old-binding');
 check('切项目后旧资料库关联回调不能覆盖新项目',b1.id===b&&equal(b0.document,b1.document)&&equal(b0.history,b1.history)&&!await ev('!!document.querySelector(".lib-result")'));
 await switchUI(a);await until('__p3dDebug().ready');await library();await click(`[data-profile-id="${pid}"] .lib-use`);await until('!document.querySelector(".modal")&&__p3dDebug().ready');await key('s');await sleep(350);const saved=await sample('saved');await close();
 await open();await until('__p3dDebug().ready');const reopened=await sample('reopened');check('完整退出后离线重开保留关联、完整文档与草稿，歌曲需重选',reopened.id===a&&equal(clean(saved.document),clean(reopened.document))&&!reopened.music.attached&&reopened.model.masters.perDancer[0].profileId===pid);
 await library();const again=await inventory(pid);await shot('reopened-inventory');check('离线重开仍可查看原人物与所属动作清单',equal(again.items,view.items));await dismiss();await readySong();await observe();await click('#playBtn');await until('!document.querySelector("#musicPanel audio").paused&&store.currentTime>.1');const r0=await sample('reopened-playing-0');await sleep(300);const r1=await sample('reopened-playing-1');await shot('reopened-playing');
 check('重选原曲后原人物动作、文字和音频继续工作，音乐引用不变',progressing(r0,r1)&&!equal(r0.model.applied,r1.model.applied)&&shown(r1,'原词甲：本轮排练显示','台词甲：独立手写内容')&&equal(saved.document._extra.music,r1.document._extra.music));
 await click('#immediateStop');const stop0=await sample('immediate-0');await sleep(200);const stop1=await sample('immediate-1');check('立即停止后人物和音频保持停止',held(stop0,stop1));await click('button[title^="停止"]');await key('s');await sleep(350);
 const after=await retention(before,lib);check('无页面异常或游戏播放请求',!errors.length&&(await ev('ChoreoMusicUI.debug.snapshot().netStarts'))===0);json('file-choosers',fileChoosers);json('result',{checks,errors,copies,originalCount:before.projects.length,finalCount:after.projects.length});if(checks.some(c=>!c.ok))process.exitCode=1;
 }catch(e){json('failure',{message:e.stack,errors,checks,copies});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{});}finally{await close();}})();
