// 单人整场保存/重开真实浏览器探针：一次性资料目录，HTTP 全阻断，仅合成报告。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {fixture}=require('./test-solo-show-recovery.js');
const out=process.env.CHOREO_SOLO_EVIDENCE;assert.ok(out&&!fs.existsSync(out),'需要全新 CHOREO_SOLO_EVIDENCE');
fs.mkdirSync(out,{recursive:true});const profile=path.resolve(out,'profile');let child,ws,id=0;const pending=new Map(),requests=[],results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'));},20000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitReady(){for(let n=0;n<150;n++){if(await ev('!!(window.store&&store.appReady&&window.ChoreoStageRecovery)'))return;await sleep(100);}throw Error('app not ready');}
function check(name,yes){assert.ok(yes,name);results.push(name);}
(async()=>{
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(exe);
 child=spawn(exe,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--window-size=1400,1000','--user-data-dir='+profile,'--host-resolver-rules=MAP localhost ~NOTFOUND','about:blank'],{windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(out,'chrome.log'),'a')]});
 let target;for(let n=0;n<100&&!target;n++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');}catch{}if(!target)await sleep(100);}
 assert.ok(target);ws=new WebSocket(target.webSocketDebuggerUrl);ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Network.responseReceived'&&/^https?:/.test(m.params.response.url))requests.push(m.params.response.url);};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});
 await send('Page.navigate',{url:pathToFileURL(path.resolve(__dirname,'dist/ChoreoHelper/choreo-helper-app.html')).href});await waitReady();
 const project=await ev('store.projectId');
 for(const [run,aborted] of [['normal',false],['abort',true]]){
  const f=fixture(project,run,aborted);
  await ev(`window.__f=${JSON.stringify(f)};window.__save=ChoreoStageRecovery.createSaver();undefined`);
  if(aborted){check('failed database receipt stays retryable',await ev(`(async()=>{try{await __save({store,...__f,current(){},projectRecord,saveActive:async()=>false});return false}catch(e){return /数据库未确认/.test(e.message)}})()`));}
  const result=await ev(`__save({store,...__f,current(){if(store.projectId!==__f.request.projectId)throw Error('changed')},projectRecord,saveActive:ChoreoProjects.saveActive})`);
  check(run+' receipt identifies project',result.projectId===project);
  await ev(`(async()=>{store.contentExtra.stagePathRecords.forEach(r=>r.synthetic=true);await ChoreoProjects.saveActive(projectRecord());})()`);
  await send('Page.reload');await waitReady();
  const data=await ev('store.contentExtra.stagePathRecords');
  const rec=data.find(r=>r.startId==='start-'+run);check(run+' reopened all events',rec.showResult.events.length===40);check(run+' reopened all segments',rec.reports.length===2);
  check(run+' source/mapped identity retained',rec.mapping.sourcePackageId==='source-'+run&&rec.mapping.packageId==='mapped-'+run);
  check(run+' no restored execution permission',await ev('!store.gameConnected'));
 }
 const data=await ev('store.contentExtra.stagePathRecords');check('two distinct saved runs',data.length===2&&data[1].showResult.events.filter(e=>e.notDispatched).length===25);
 check('normal run coherent ability identity',data[0].showResult.events.find(e=>e.id==='ability-1').abilityAttempt.Identity.EventId==='ability-1');
 check('abort run has no fabricated pending among dispatched',data[1].showResult.events.filter(e=>e.evidenceMissing).length===0);
 // —— R4 浏览器侧反例（同一合成夹具，仅内存改动；产品 result() 必须拒绝或显式未知） ——
 const normalFixture=fixture(project,'normal',false);
 await ev(`window.__fn=${JSON.stringify(normalFixture)};undefined`);
 const mutate=async fn=>ev(`(()=>{const f=JSON.parse(JSON.stringify(__fn));(${fn})(f);try{ChoreoStageRecovery.result(f.request,f.snapshot);return 'accepted'}catch(e){return e.message}})()`);
 check('foreign segment identity rejected in browser',/不对应|移动事件/.test(await mutate(`f=>{f.snapshot.input.coordinateFeedback.reports[0].Path.EventId='not-in-show'}`)));
 check('duplicate segment report rejected in browser',/重复/.test(await mutate(`f=>{f.snapshot.input.coordinateFeedback.reports[1].Path.EventId='path-0'}`)));
 check('foreign ability identity rejected in browser',/技能回执/.test(await mutate(`f=>{f.snapshot.show.recentLog[10].abilityAttempt={Identity:{EventId:'foreign',ActorId:123}}}`)));
 check('missing ability Identity rejected in browser',/技能回执/.test(await mutate(`f=>{delete f.snapshot.show.recentLog[10].abilityAttempt.Identity}`)));
 check('ability on motion rejected in browser',/技能回执/.test(await mutate(`f=>{f.snapshot.show.recentLog[3].abilityAttempt={NativeInvoked:true}}`)));
 // R4-ID 标量格式反例：数组身份不得经 String() 强转通过；合法数字串形态仍放行；保存回调零触达。
 check('array EventId rejected in browser',/技能回执/.test(await mutate(`f=>{f.snapshot.show.recentLog[10].abilityAttempt.Identity.EventId=['ability-1']}`)));
 check('array ActorId rejected in browser',/技能回执/.test(await mutate(`f=>{f.snapshot.show.recentLog[10].abilityAttempt.Identity.ActorId=[123]}`)));
 check('outcome array EventId rejected in browser',/技能回执/.test(await mutate(`f=>{f.snapshot.show.events[10].outcome={Kind:'ability',Ok:true,AbilityAttempt:{Identity:{EventId:['ability-1'],ActorId:123,ActionId:132,TargetId:123},State:'attempted',NativeInvoked:true,NativeReturned:true}}}`)));
 check('numeric-string ActorId still accepted in browser',await mutate(`f=>{f.snapshot.show.recentLog[10].abilityAttempt.Identity.ActorId='123'}`)==='accepted');
 check('malformed identity never reaches save callback in browser',await ev(`(async()=>{let writes=0;const f=JSON.parse(JSON.stringify(__fn));f.snapshot.show.recentLog[10].abilityAttempt.Identity.EventId=['ability-1'];try{await ChoreoStageRecovery.createSaver()({store,...f,current(){},projectRecord,saveActive:async()=>{writes++;return true}});return 'saved:'+writes}catch(e){return 'rejected:'+writes}})()`)==='rejected:0');
 check('partial dispatch contradiction rejected in browser',/分发/.test(await mutate(`f=>{f.snapshot.show.recentLog=[];f.snapshot.show.events[3].dispatched=false}`)));
 const segments=await ev(`(()=>{const f=JSON.parse(JSON.stringify(__fn));f.snapshot.input.coordinateFeedback.reports=[];const r=ChoreoStageRecovery.result(f.request,f.snapshot);return r.reports})()`);
 check('missing segment identities explicit without observations',segments.length===2&&segments.every(r=>r.evidenceMissing===true&&r.Path.EventId&&!('TotalDistanceM' in r)&&!('Completed' in r)));
 const missing=await ev(`(()=>{const f=JSON.parse(JSON.stringify(__fn));f.snapshot.show.recentLog=[];const r=ChoreoStageRecovery.result(f.request,f.snapshot);return {pending:r.showResult.events.filter(e=>e.notDispatched).length,missing:r.showResult.events.filter(e=>e.evidenceMissing).length}})()`);
 check('missing log stays explicitly unknown in browser',missing.pending===0&&missing.missing===40);
 // Missing/unstarted segment states survive a genuine IDB transaction and reopen.
 for(const run of ['missing-segments','unstarted-segments']){
  const f=fixture(project,run,true);f.snapshot.input.coordinateFeedback={active:false,lastReport:null,reports:[]};
  if(run==='unstarted-segments'){f.snapshot.show.dispatched=0;f.snapshot.show.recentLog=[];f.snapshot.show.events.forEach(e=>e.dispatched=false);}
  await ev(`window.__segmentFixture=${JSON.stringify(f)};undefined`);
  await ev(`ChoreoStageRecovery.createSaver()({store,...__segmentFixture,current(){},projectRecord,saveActive:ChoreoProjects.saveActive})`);
  await ev(`(async()=>{store.contentExtra.stagePathRecords.forEach(r=>r.synthetic=true);await ChoreoProjects.saveActive(projectRecord());})()`);
  await send('Page.reload');await waitReady();
  const record=await ev(`store.contentExtra.stagePathRecords.find(r=>r.startId==='start-${run}')`);
  check(run+' reopened two declared identities',record.reports.length===2&&record.reports.every(r=>r.Path.PackageId==='mapped-'+run));
  check(run+' reopened explicit state without fabricated observations',record.reports.every(r=>(run==='missing-segments'?r.evidenceMissing:r.notDispatched)===true&&!('Completed' in r)&&!('TotalDistanceM' in r)));
 }
 await ev('ChoreoStageReplay.open(store.contentExtra.stagePathRecords[1])');
 check('actual dialog shows pending and segment outcomes',await ev(`document.querySelector('dialog[aria-label="演出复盘"]').textContent.includes('未分发')&&document.querySelector('dialog[aria-label="演出复盘"]').textContent.includes('路径段 path-0')`));
 const png=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'replay.png'),Buffer.from(png.data,'base64'));
 check('HTTP responses blocked',requests.length===0);fs.writeFileSync(path.join(out,'RESULTS.json'),JSON.stringify({results,requests,synthetic:true},null,2));console.log('PASS '+results.length+' browser checks');
})().catch(e=>{fs.writeFileSync(path.join(out,'ERROR.txt'),e.stack);console.error(e);process.exitCode=1}).finally(async()=>{if(ws){try{await send('Browser.close')}catch{}ws.close();}for(const p of pending.values()){clearTimeout(p.timer);p.resolve({});}if(child&&child.exitCode===null)child.kill();});
