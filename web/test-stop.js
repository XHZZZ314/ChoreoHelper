// 立即停止的真实网页模块回归：同步停本地、旧异步回包、失败重试和停止确认。
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function setup(fetcher){
 const calls=[],events=[],nodes={};
 for(const id of ['immediateStop','immediateStopStatus']) nodes[id]={textContent:'',dataset:{},setAttribute(){},addEventListener(_,f){this.click=f}};
 const ctx={console,URL,AbortController,Set,Promise,Date,Number,setTimeout,clearTimeout,fetch:async(url,opts)=>{calls.push({url,opts});return fetcher(url,opts)},document:{getElementById:id=>nodes[id]},stopLocalPlaybackNow:()=>events.push('play'),recordingStopNow:()=>events.push('record'),ChoreoMusicUI:{stopNow:()=>events.push('music')},showExecCancelLocal:()=>events.push('cancel'),showExecConfirmGlobalStop:()=>events.push('confirmed'),ensembleStopNow:()=>events.push('ensemble')};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(read('choreo-api.js'),ctx);vm.runInContext(read('choreo-stop.js'),ctx);return{ctx,calls,events,nodes};
}
const app=read('choreo-app.js');
// OVERHAUL 批 C迁移：sessionWrite/apiPreview 已随配对薄壳搬到 choreo-app-auth.js——这两个切片从拆分件读。
const auth=read('choreo-app-auth.js');
// OVERHAUL 批 C 第五步迁移：gameStartPlay..playLoop / stopLocalPlaybackNow..stopPlay 已随播放控制块
// 搬到 choreo-app-playback.js——这两个切片从拆分件读（sendSeek 切片仍在主件保留区）。
const playback=read('choreo-app-playback.js');
function functionPart(first,next,src){src=src||app;return src.slice(src.indexOf('function '+first+'('),src.indexOf('function '+next+'('))}
function playbackContext(api,connected=true){
 const ctx={console,apiFetch:api,store:{previewTarget:'game',gameConnected:connected,dancers:[{name:'actor'}],currentTime:0,speed:1,_tlRevision:1},playToken:0,_controlStopEpoch:0,playRAF:null,_seekSeq:0,_seekBusy:false,_seekPending:null,_tlPushTimer:null,gameActorIdx:()=>0,buildGamePayloadClips:()=>[{}],document:{getElementById:()=>null},render(){},showToast(){},startFollow(){},stopFollow(){},playLoop(){},cancelAnimationFrame(){},clearTimeout,performance:{now:()=>0},probeGame:async()=>{ctx.store.gameConnected=true}};
 ctx.window=ctx; // gameStartPlay 的可选模块守卫引用 window（与上方 setup 同款自引用）
 vm.createContext(ctx);vm.runInContext(functionPart('gameStartPlay','playLoop',playback),ctx);vm.runInContext(functionPart('stopLocalPlaybackNow','stopPlay',playback),ctx);return ctx;
}
(async()=>{
 let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name)}
 await test('点击同帧停止本地所有生产者，未等HTTP',async()=>{const d=defer(),s=setup(()=>d.promise);const p=s.nodes.immediateStop.click();assert.deepEqual(s.events,['play','record','music','cancel','ensemble']);assert.equal(s.calls.length,1);assert.equal(s.ctx.ChoreoStop.state(),'stopping');d.resolve(response({ok:true,state:'stopped',generation:1}));await p;assert.equal(s.ctx.ChoreoStop.state(),'stopped')});
 await test('重复点击共用一次请求，不重复清理',async()=>{const d=defer(),s=setup(()=>d.promise);const a=s.ctx.ChoreoStop.stop(),b=s.ctx.ChoreoStop.stop();assert.equal(a,b);assert.equal(s.calls.length,1);d.resolve(response({ok:true,state:'stopped',generation:1}));await a;assert.equal(s.events.filter(x=>x==='play').length,1)});
 await test('HTTP成功但清理失败不报已停止，也不暗中重试',async()=>{const s=setup(async()=>response({ok:false,state:'failed',generation:1,message:'释放失败'}));const r=await s.ctx.ChoreoStop.stop();assert.equal(r.ok,false);assert.equal(s.nodes.immediateStop.textContent,'重试停止');assert.equal(s.calls.length,1);await assert.rejects(s.ctx.ChoreoAPI.game.api('/playback/start',{method:'POST'}),/重试停止/);assert.equal(s.calls.length,1)});
 await test('第二次明确点击才重试并解除写入锁',async()=>{let n=0;const s=setup(async()=>response(++n===1?{ok:false,state:'failed',generation:1}:{ok:true,state:'stopped',generation:2}));await s.ctx.ChoreoStop.stop();await s.ctx.ChoreoStop.stop();assert.equal(s.calls.length,2);await s.ctx.ChoreoAPI.game.api('/playback/start',{method:'POST'});assert.equal(s.calls.length,3)});
 await test('缺失或过期的停止世代不能作为确认',async()=>{const a=setup(async()=>response({ok:true,state:'stopped'}));assert.equal((await a.ctx.ChoreoStop.stop()).ok,false);let n=0;const b=setup(async()=>response(++n===1?{ok:true,state:'stopping',generation:2}:{ok:true,state:'stopped',generation:1}));assert.equal((await b.ctx.ChoreoStop.stop()).ok,false);assert.equal(b.calls.filter(x=>x.opts.method==='POST').length,1)});
 await test('待清理只复读状态，不再次POST',async()=>{let n=0;const s=setup(async()=>response(++n===1?{ok:true,state:'stopping',generation:1}:{ok:true,state:'stopped',generation:1}));assert.equal((await s.ctx.ChoreoStop.stop()).ok,true);assert.equal(s.calls.length,2);assert.match(s.calls[1].url,/control\/status$/);assert.equal(s.calls[1].opts.method,'GET')});
 await test('局部停止抛错仍请求插件停止，保留失败显示',async()=>{const s=setup(async()=>response({ok:true,state:'stopped',generation:1}));s.ctx.recordingStopNow=()=>{throw Error('broken')};assert.equal((await s.ctx.ChoreoStop.stop()).ok,false);assert.equal(s.calls.length,1);assert(s.events.includes('music'));assert(!s.events.includes('confirmed'))});
  await test('连接失败不伪造游戏停止',async()=>{const s=setup(async()=>{throw Error('offline')});const r=await s.ctx.ChoreoStop.stop();assert.equal(r.state,'failed');assert.deepEqual(s.events,['play','record','music','cancel','ensemble'])});
 await test('音乐返回失败对象不能被丢弃为成功',async()=>{const s=setup(async()=>response({ok:true,state:'stopped',generation:1}));s.ctx.ChoreoMusicUI.stopNow=()=>({ok:false});assert.equal((await s.ctx.ChoreoStop.stop()).ok,false);assert(!s.events.includes('confirmed'))});
 await test('异步本地失败对象不能被当成已停止',async()=>{const s=setup(async()=>response({ok:true,state:'stopped',generation:1}));s.ctx.ensembleStopNow=async()=>({failed:true});assert.equal((await s.ctx.ChoreoStop.stop()).ok,false)});
 await test('取消旧写请求即使transport忽略abort仍拒绝迟到成功',async()=>{const d=defer(),s=setup(()=>d.promise);const p=s.ctx.ChoreoAPI.game.api('/playback/start',{method:'POST'});s.ctx.ChoreoAPI.cancelGameWrites();assert.equal(s.calls[0].opts.signal.aborted,true);d.resolve(response({status:'playing'}));await assert.rejects(p,/立即停止取消/)});
  await test('停止请求自身不会被输出锁或取消拦住',async()=>{const d=defer(),s=setup(()=>d.promise);s.ctx.ChoreoAPI.setOutputBlocked(true);const p=s.ctx.ChoreoAPI.game.api('/control/stop',{method:'POST'});s.ctx.ChoreoAPI.cancelGameWrites();assert.equal(s.calls[0].opts.signal.aborted,false);d.resolve(response({ok:true,state:'stopped',generation:1}));assert.equal((await p).ok,true)});
 await test('Response已到而JSON迟到时仍作废旧写入',async()=>{for(const type of ['game','export']){const d=defer(),s=setup(async()=>({ok:true,status:200,json:()=>d.promise}));const p=s.ctx.ChoreoAPI[type].api(type==='game'?'/playback/start':'/export/record',{method:'POST'});await flush();s.ctx.ChoreoAPI.cancelGameWrites();d.resolve({ok:true,status:'playing'});await assert.rejects(p,/立即停止取消/)}});
 await test('真实gameStartPlay的晚成功不能重新进入播放态',async()=>{const d=defer();const c=playbackContext(p=>p==='/playback/start'?d.promise:Promise.resolve({}));c.gameStartPlay();c.stopLocalPlaybackNow();d.resolve({status:'playing'});await flush();assert.equal(c.store.isPlaying,false)});
 await test('真实连接探测晚回不能在停止后才发送start',async()=>{const d=defer(),writes=[];const c=playbackContext(p=>{writes.push(p);return Promise.resolve({})},false);c.probeGame=()=>d.promise;c.gameStartPlay();c.stopLocalPlaybackNow();c.store.gameConnected=true;d.resolve();await flush();assert.equal(writes.length,0)});
 await test('真实seek409重推晚回不能在停止后发重试',async()=>{const d=defer(),writes=[];const c=playbackContext(p=>{writes.push(p);return Promise.reject({status:409})});c.pushGameTimeline=()=>d.promise;const first=app.indexOf('function sendSeek('),end=app.indexOf('store._tlRevision=1;',first);vm.runInContext(app.slice(first,end),c);c.sendSeek(2);await flush();c.stopLocalPlaybackNow();d.resolve(true);await flush();assert.equal(writes.length,1)});
 for(const mode of ['token','fallback','refresh']) await test('真实sessionWrite停止后拒绝迟到签发 '+mode,async()=>{
  const d=defer();let mintCalls=0,startCalls=0;
  // 403 重试分支使用带 status 的合成拒绝；现有 gameApi 的 HTTP403 错误不携带 status。
  const s=setup(async url=>{if(url.endsWith('/control/stop'))return response({ok:true,state:'stopped',generation:1});startCalls++;throw Object.assign(Error('synthetic 403'),{status:403})});
  Object.assign(s.ctx,{_controlStopEpoch:0,getStoredSession:()=>mode==='refresh'?'old':'',sessionNeedsRefresh:()=>false,mintSessionToken:()=>{mintCalls++;return d.promise},clearStoredSession(){},probeCaps:async()=>{}});
  s.ctx.stopLocalPlaybackNow=()=>{s.ctx._controlStopEpoch++};vm.runInContext(functionPart('sessionWrite','apiPreview',auth),s.ctx);
  const old=s.ctx.sessionWrite('/playback/start',{method:'POST'},false);const rejected=assert.rejects(old,/立即停止取消/);await flush();
  assert.equal(mintCalls,1);assert.equal((await s.ctx.ChoreoStop.stop()).ok,true);
  if(mode==='fallback')d.reject(Error('mint failed'));else d.resolve('new-token');await rejected;
  assert.equal(startCalls,mode==='refresh'?1:0);assert.equal(s.ctx.ChoreoStop.state(),'stopped');
 });
 await test('停止请求不因等待会话期间另一次停止而失效',async()=>{
  const d=defer(),s=setup(async()=>response({ok:true,state:'stopped',generation:2}));
  Object.assign(s.ctx,{_controlStopEpoch:0,getStoredSession:()=>'',sessionNeedsRefresh:()=>false,mintSessionToken:()=>d.promise,clearStoredSession(){},probeCaps:async()=>{}});
  vm.runInContext(functionPart('sessionWrite','apiPreview',auth),s.ctx);const p=s.ctx.sessionWrite('/playback/stop',{method:'POST'},false);s.ctx._controlStopEpoch++;d.resolve('token');assert.equal((await p).state,'stopped');assert.equal(s.calls.length,1);
 });
 const html=read('choreo-helper-app.html');assert(html.indexOf('id="immediateStop"')<html.indexOf('id="root"'));assert(html.includes('<script src="choreo-stop.js"></script>'));
 console.log(JSON.stringify({passed,failed:0,gameWrites:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
