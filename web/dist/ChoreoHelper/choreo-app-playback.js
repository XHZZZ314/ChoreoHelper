// 编舞助手播放控制分件（OVERHAUL 批 C 第五步从 choreo-app.js 拆出）：
// 网页/游戏播放控制、GAMECLOCK 跟随、停止链与模式切换（togglePlay/startPlay/gameStartPlay/playLoop/
// stopPlay/switchPreviewTarget 等，含生效版 updatePlayhead——与主件渲染时钟区的同名早期声明构成
// 「后加载者生效」，故本件必须排在 choreo-app.js 之后加载）。同全局名文件级搬家，行为逐字不变。
'use strict';

// Playback
var playStart=0,playOffset=0;
// 后台标签页 RAF 被节流:切到游戏窗口时播放头停走,回来跳变 -> 用 visibilitychange 补偿
var playLastVisTime=0;
document.addEventListener('visibilitychange',function(){
  if(document.hidden){
    playLastVisTime=performance.now();
  }else if(store.isPlaying&&playLastVisTime){
    var gap=(performance.now()-playLastVisTime)/1000*store.speed;
    playOffset+=gap; // 补偿后台流逝的时间,播放头与插件时间轴对齐
    playStart=performance.now();
    updatePlayhead();updateTimeDisplay();updatePlayOverlay();
  }
});
// 阶段1（模式分流）：播放拆成本地控制 + 游戏请求包装两条路——
// web 模式纯本地立即起播（不等插件、游戏关着也能播）；game 模式完整保留 v0.6.6 语义
// （先发插件 start 成功才进入播放态；stop/解冻照旧）
function togglePlay(){
  // 有音乐的网页排练由现有音频控制器接管，不启动第二个时钟。
  if(window.ChoreoMusicUI&&ChoreoMusicUI.webControl('toggle'))return;
  if(store.isPlaying)pausePlay();
  else startPlay();
}
// 暂停：只停本地播放头；游戏模式额外通知插件停，web 模式不发任何请求
function pausePlay(){
  if(!store.isPlaying&&window.ChoreoMusicUI&&ChoreoMusicUI.webControl('pause'))return;
  playToken++;
  store._gearsetPlaybackEnd=null;
  store.isPlaying=false;stopRenderClock(); // P5：停统一时钟（等价于旧的取消待触发帧）
  stopFollow(); // GAMECLOCK：暂停即停轮询，本地钟完全接管
  if(store.previewTarget==='game')apiFetch('/playback/stop',{method:'POST'}).catch(function(){});
  var ov=document.getElementById('playOverlay');if(ov)ov.style.display='none';
  render();
}
function startPlay(){
  if(window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('请先在双人面板停止本机演出，再开始预览');return}
  store._gearsetPlaybackEnd=null;
  if(window.ChoreoMusicUI&&ChoreoMusicUI.webControl('play'))return;
  if(window.ChoreoMusicUI&&ChoreoMusicUI.debug.snapshot().mode!=='idle'){showToast('请先在音乐面板停止，再单独播放时间线');return}
  if(store.previewTarget==='game'){gameStartPlay();return}
  if(store.dancers.some(function(d){return d.switchClips.length}))showToast(ChoreoGearset.PREVIEW_NOTICE);
  // WP-3b：A-B 循环——播放头在区间外时先拉回 A 再起播
  if(edHasLoop()&&(store.currentTime<store.loopA||store.currentTime>=store.loopB))store.currentTime=store.loopA;
  var tk=++playToken;
  store.isPlaying=true;playStart=performance.now();playOffset=store.currentTime;
  var ov=document.getElementById('playOverlay');if(ov)ov.style.display='block';
  updatePlayOverlay();
  render();
  var c0=clock();if(c0)c0.stop();
  playLoop(tk); // P5：首帧同步推进（playLoop 内部只打脏标记）
  if(c0){c0.flush();if(store.isPlaying)c0.start()} // 之后由统一时钟一条链继续
}
// 游戏模式播放：只发「游戏预览舞者」一人的时间轴（+全局歌词）给 48794，成功后网页播放头
// 才进入播放态（防 start 失败但 UI 显示播放中）
function gameStartPlay(){
  if(window.ChoreoStageMotion&&ChoreoStageMotion.blocksGame(store,gameActorIdx())){
    // 统一演出入口：日常播放不执行走位/朝向，改路由进整场检查（只读），从那里进既有演出流程
    if(window.ChoreoShowEntry){showToast('走位与朝向不在日常游戏播放执行；已打开整场检查，可从那里进入既有演出流程');ChoreoShowEntry.open({entry:'daily-blocked',di:gameActorIdx()})}
    else showToast("走位与朝向尚未接入日常游戏执行；请用网页排练，真实移动需审阅短路径后单独授权");
    return}
  var hasSkills=!!(window.ChoreoAbilityPlan&&ChoreoAbilityPlan.blocksGame(store));
  if(hasSkills&&(!window.ChoreoSkillGame||!ChoreoEdit.pure.hasCap(store.pluginCaps,'skillPlaybackV1'))){showToast('当前插件技能实演尚未开放；仍可使用网页 3D 排练');return}
  if(store.isPlaying){showToast('正在播放，请先停止再重新明确开始。');return}
  var requestToken=++playToken;
  var pdi=gameActorIdx();
  if(pdi<0){showToast('没有舞者可预览：先添加舞者再播放');return}
  var initialClips=buildGamePayloadClips(true);
  var hasSwitch=initialClips.some(function(c){return c.type==='switch'||/^\s*\/(?:gs|gearset|job)(?:\s|$)/i.test(c.command)});
  var initialProject=store.projectId,initialExtra=store.contentExtra,initialRevision=store._tlRevision;
  var initialTime=store.currentTime,initialSpeed=store.speed,initialActor=store.gameActor,initialClipsText=JSON.stringify(initialClips);
  var initialSkills=hasSkills?JSON.stringify(ChoreoAbilityPlan.snapshot(store)):null,initialProfile=store.dancers[pdi].profileId;
  function currentStart(){return requestToken===playToken&&(!(hasSwitch||hasSkills)||(store.projectId===initialProject&&store.contentExtra===initialExtra&&store._tlRevision===initialRevision&&store.gameActor===initialActor&&store.currentTime===initialTime&&store.speed===initialSpeed&&store.previewTarget==='game'&&JSON.stringify(buildGamePayloadClips(true))===initialClipsText&&(!hasSkills||(store.dancers[pdi].profileId===initialProfile&&JSON.stringify(ChoreoAbilityPlan.snapshot(store))===initialSkills))))}
  var go=async function(){
    if(requestToken!==playToken)return;
    var allClips,gearsetStart=null,skillStart=null;
    try{
      // 无命令的全局原词只供本地显示，保留项目内容，不进入单条套装游戏请求。
      allClips=hasSwitch?initialClips.filter(function(c){return !(c.type==='lyric'&&c.actorId===-1&&c.command==='')}):buildGamePayloadClips();
      if(hasSkills){
        allClips=allClips.filter(function(c){return !(c.type==='lyric'&&c.actorId===-1&&c.command==='')});
        skillStart=await ChoreoSkillGame.prepare({state:store,dancerIndex:pdi,clips:allClips,isCurrent:currentStart,read:apiFetch,confirm:function(message){return window.confirm(message)}});
        if(!skillStart||!currentStart())return;
        if(skillStart.version===3&&!ChoreoEdit.pure.hasCap(store.pluginCaps,'skillPlaybackV3'))throw Error('当前插件不支持失败后继续，请更新插件');
        if(skillStart.version===2&&!ChoreoEdit.pure.hasCap(store.pluginCaps,'skillPlaybackV2'))throw Error('当前插件不支持技能与普通动作混排，请更新插件');
        allClips=[]; // 普通动作已按真实触发时刻纳入同一技能演出，不能再发一次。
      }
      if(hasSwitch){
        if(!ChoreoEdit.pure.hasCap(store.pluginCaps,'gearsetStartV1'))throw new Error('当前插件未提供明确套装开始能力，请更新插件后重试。');
        if(allClips.length>1&&!ChoreoEdit.pure.hasCap(store.pluginCaps,'gearsetSequenceV2'))throw new Error('当前插件未提供开场换装短演出能力，请更新插件后重试。');
        gearsetStart=await ChoreoGearset.confirmStart({clips:allClips,fromTime:initialTime,speed:initialSpeed,isCurrent:currentStart,
          readSnapshot:function(){return apiFetch('/gearsets',{timeoutMs:4000})},confirm:function(message){return window.confirm(message)}});
        if(!gearsetStart||!currentStart())return;
      }
    }catch(e){if(currentStart())showToast(e.message);return}
    // 播放前先解冻:退出定格预览,避免定格残留影响播放
    if(!hasSwitch&&!hasSkills)apiFetch('/playback/freeze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:''})}).catch(function(){});
    // ACTOR（2026-08-31）：payload 只装预览舞者（组装逻辑抽在 choreo-edit.js 纯函数里，
    // test-edit.js 覆盖）；插件侧也拒绝混演员包，双保险
    // 套装执行检查已在任何游戏写入之前完成。
    if(!allClips.length&&!skillStart){showToast('游戏没动：预览舞者「'+store.dancers[pdi].name+'」名下没有可播放的条目。先给他排动作，或点其他舞者行头的「🎮 预览」换人');return}
    // Send to plugin and start playback (await result before UI state: 防止 start 失败但 UI 显示播放中)
    // HYGIENE(AC-4)：不再向控制台倾倒整包 clips/原始响应/逐条明细——排障走结构化 toasts 与连接状态
    if(skillStart)store._skillPlaybackRequest={runId:skillStart.runId,projectId:store.projectId,plan:JSON.parse(JSON.stringify(skillStart)),binding:skillStart.binding};
    apiFetch('/playback/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clips:allClips,revision:store._tlRevision,fromTime:store.currentTime,speed:store.speed,gearsetStart:gearsetStart||undefined,skillStart:skillStart||undefined})
    }).then(function(d){
      if(!currentStart()){
        if(skillStart)apiFetch('/playback/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skillRunId:skillStart.runId})}).catch(function(){});
        return;
      }
      // v0.7.1：插件业务失败旧版会包在 HTTP 200 里返回 {error:...}——必须看响应体，
      // 不能 fetch 一成功就当播放成功（曾出现游戏没动、网页却显示播放中的假象）
      if(!d||d.error||d.status!=='playing'){
        var why=(d&&d.message)||'插件返回异常，未开始播放';
        showToast('游戏没动：'+why);
        return;
      }
      var tk=++playToken;
      store._gearsetPlaybackEnd=skillStart?skillStart.maxDurationMs/1000:hasSwitch?Math.max.apply(null,allClips.map(function(c){return c.start+c.duration})):null;
      store._skillPlaybackRun=skillStart?skillStart.runId:null;
      store.isPlaying=true;playStart=performance.now();playOffset=store.currentTime;
      var ov=document.getElementById('playOverlay');if(ov)ov.style.display='block';
      if(store.isPlaying)updatePlayOverlay();
      render();
      startFollow(); // GAMECLOCK：起播即跟随插件钟（能力位不满足时是空操作）
      playLoop(tk);
    }).catch(function(e){
      if(skillStart)apiFetch('/playback/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skillRunId:skillStart.runId})}).catch(function(){});
      if(!currentStart())return;
      console.error('Playback start error:',e);
      var m=(e&&e.message)||'';
      if(m.indexOf('403')>=0){ // 配对没过不是连接问题：连接状态别动（曾误标断连圆点变红），给准确指路
        showToast('游戏没动：配对码不对或没带上。游戏里输入 /choreo pair 查看配对码，到顶栏「🧰 工具」→「高级工具」的「🔗 网页配对」重新粘贴（输入法用英文半角）');
        return;
      }
      if(e&&e.status){ // v0.7.1：插件明确拒绝（400/409/503…）——连接没问题，给插件给的中文原因
        showToast('游戏没动：'+(e.detail||'插件拒绝了这次播放（'+e.status+'）'));
        return;
      }
      store.gameConnected=false;store.connected=false;
      render();
      showToast('\u6E38\u620F\u64AD\u653E\u5931\u8D25\uFF1A\u63D2\u4EF6\u672A\u8FDE\u63A5\u6216\u542F\u52A8\u5F02\u5E38\uFF08\u53EF\u5207\u56DE\u300C\u7F51\u9875 3D\u300D\u6A21\u5F0F\u7EE7\u7EED\u5DE5\u4F5C\uFF09');
    });
  };
  // 未连接时先探一次（快速失败，别对着空气等 4 秒超时）
  if(store.gameConnected){go();return}
  probeGame(true).then(function(){
    if(store.gameConnected)go();
    else showToast('\u6E38\u620F\u672A\u8FDE\u63A5\uFF1A\u65E0\u6CD5\u5728\u6E38\u620F\u5185\u64AD\u653E\u3002\u542F\u52A8\u6E38\u620F\u540E\u70B9\u5DE5\u5177\u680F\u5706\u70B9\u91CD\u8FDE\uFF0C\u6216\u5207\u56DE\u300C\u7F51\u9875 3D\u300D\u6A21\u5F0F');
  });
}
function playLoop(tk){
  if(!store.isPlaying||tk!==playToken)return; // 过期调用直接退出(防 stop/start 乱序)
  var e=(performance.now()-playStart)/1000*store.speed;
  store.currentTime=playOffset+e;
  // GAMECLOCK：跟随态（game 模式+statusV2+已有基准样本）用插件钟外推覆盖本地推进；
  // 没有基准/轮询失败时上面的本地推进原样生效——行为与旧版完全一致
  if(_followState&&_followState.base&&window.ChoreoEdit){
    var pt=ChoreoEdit.pure.followProject(_followState.base,performance.now()/1000);
    if(pt!==null&&isFinite(pt)&&pt>=0){_followState.display=pt;store.currentTime=pt}
  }
  // WP-3b：A-B 循环（仅网页播放）——到 B 回卷 A，动作经引擎插值连续过渡；不设循环走原终止逻辑
  var playbackEnd=store._gearsetPlaybackEnd||store.totalDuration;
  if(!store._gearsetPlaybackEnd&&edHasLoop()){
    if(store.currentTime>=store.loopB){
      store.currentTime=store.loopA;playOffset=store.loopA;playStart=performance.now();
    }
  }else if(store.currentTime>=playbackEnd){
    store.currentTime=playbackEnd;store.isPlaying=false;store._gearsetPlaybackEnd=null;render();
    stopFollow(); // GAMECLOCK：播完停轮询
    stopRenderClock(); // P5：统一时钟停链（下一帧不再由 playLoop 自己排）
    if(store.previewTarget==='game')apiFetch('/playback/stop',{method:'POST'}).catch(function(){});
    var ov=document.getElementById('playOverlay');if(ov&&store.previewTarget==='game')ov.style.display='none';return;
  }
  // P5：只打脏标记并请求一帧——同一帧内的多次请求合并成一次刷帧（不再自己排 rAF 链）
  var c=clock();if(c){c.mark(RK.playhead);c.mark(RK.time);c.mark(RK.overlay);c.requestFrame()}
}
var playToken=0; // 播放令牌:防止 stop/start 乱序,只接受最新一次操作

// ---------- GAMECLOCK：游戏模式时钟跟随（TASK-20260831） ----------
// 仅当 game 模式 + 插件 /capabilities 带 statusV2 能力位时轮询 /playback/status（约 5Hz），
// 把播放头对齐插件权威时钟；轮询失败/插件暂停一律静默退回本地钟（播放不停、不报错）。
// 非目标（AUD2-002 结论保持）：不建逐骨实时姿态流——预览对齐只有时钟跟随这一条通道。
// web 预览模式从不出现在 followCapable() 里，零新请求（旧插件/网页行为字节级不变）。
var _followState=null,_followTimer=null;
function followCapable(){
  return store.previewTarget==='game'&&store.capsOk
    &&!!(window.ChoreoEdit&&ChoreoEdit.pure.hasCap&&ChoreoEdit.pure.hasCap(store.pluginCaps,'statusV2'));
}
function stopFollow(){
  if(_followTimer){clearInterval(_followTimer);_followTimer=null}
  _followState=null;
}
function startFollow(){
  stopFollow();
  if(!followCapable())return; // 旧插件（无 statusV2）或网页模式：今天的本地钟行为，一字节不改
  _followTimer=setInterval(function(){
    if(!store.isPlaying||store.previewTarget!=='game'){return}
    var token=playToken,project=store.projectId,revision=store._tlRevision;
    apiFetch('/playback/status').then(function(j){
      if(!store.isPlaying||token!==playToken||project!==store.projectId||revision!==store._tlRevision)return;
      if(!j||typeof j!=='object'||j.error)return;
      if(store._skillPlaybackRun&&j.skillPlayback&&j.skillPlayback.runId===store._skillPlaybackRun&&j.revision===revision&&j.playing===false){
        store._skillPlaybackResult=j.skillPlayback;store._skillPlaybackRun=null;
        playToken++;store.isPlaying=false;store._gearsetPlaybackEnd=null;store.currentTime=j.time;
        stopRenderClock();stopFollow();
        var skillOverlay=document.getElementById('playOverlay');if(skillOverlay)skillOverlay.style.display='none';
        showToast(j.skillPlayback.message);render();return;
      }
      if(store._gearsetPlaybackEnd&&j.gearsetSequence&&j.revision===revision&&j.playing===false){
        playToken++;store.isPlaying=false;store._gearsetPlaybackEnd=null;store.currentTime=j.time;
        stopRenderClock();stopFollow();
        var ov=document.getElementById('playOverlay');if(ov)ov.style.display='none';
        showToast(j.gearsetSequence.stopReason||'短演出已停止。');render();return;
      }
      var prev=(_followState&&_followState.stamp!=null)?{stamp:_followState.stamp,display:_followState.display}:null;
      // 本地刚收到载荷：龄记 0，后续流逝由 followProject 用本地钟外推（stampMs 只用于乱序判别）
      var r=ChoreoEdit.pure.followAccept(prev,{time:j.time,stampMs:j.stampMs,stampAgeMs:0,speed:j.speed,playing:j.playing});
      if(r.accepted){
        r.base.recvSec=performance.now()/1000;
        _followState={stamp:r.stamp,base:r.base,display:(_followState&&_followState.display)||store.currentTime};
        if(r.resync){store.currentTime=r.base.time;_followState.display=r.base.time} // 漂移超阈值：硬切对齐
      }else if(r.local){
        // 插件播完/暂停（预览舞者时间轴通常比整个项目短）：交还本地钟，播放继续到项目末尾
        _followState=null;
      }
      // accepted:false（旧样本/坏载荷）→ 保持现状，下个轮询周期再试
    }).catch(function(){/* 网络失败：静默退本地钟，恢复后自动跟上（AC-3）*/});
  },200);
}
// 一键停止先同步作废播放、seek与延迟推送；保留播放头位置，不等待插件。
function stopLocalPlaybackNow(){
  playToken++;_controlStopEpoch++;store.isPlaying=false;store._gearsetPlaybackEnd=null;
  if(typeof stopRenderClock==='function')stopRenderClock(); // P5：停统一渲染时钟（窄 vm 用例只导入本函数，故用 typeof 守卫）
  stopFollow();
  _seekSeq++;_seekBusy=false;_seekPending=null;
  if(_tlPushTimer){clearTimeout(_tlPushTimer);_tlPushTimer=null}
  var ov=document.getElementById('playOverlay');if(ov)ov.style.display='none';render();
}
// 停止：播放头归零（v0.5 语义不变）；web 模式只清网页状态，不发插件请求
// J4：反馈分开说——网页已停＋归 0；本次循环是否退出、手动 A/B 是否保留按实际结果，不称游戏已停
function stopPlay(){
  if(window.ChoreoMusicUI)ChoreoMusicUI.webControl('stop');
  playToken++;store.isPlaying=false;store._gearsetPlaybackEnd=null;stopRenderClock();stopFollow();
  var loopCleared=false;
  if(window.ChoreoWorkbench&&ChoreoWorkbench.rehearsalStopped()){store.loopA=store.loopB=null;loopCleared=true}
  store.currentTime=0;
  if(store.previewTarget==='game')apiFetch('/playback/stop',{method:'POST'}).catch(function(){});
  var ov=document.getElementById('playOverlay');if(ov)ov.style.display='none';render();
  showToast('网页播放已停止，播放头归 0'+(loopCleared?'；本次循环试看已退出':((store.loopA!=null&&store.loopB!=null)?'；手动循环范围 A/B 仍保留':'')));
}
// 顶部和音乐面板读取同一个媒体状态；只更新显示，不写文档或编辑历史。
function updatePlaybackButton(button){
  var b=button||document.getElementById('playBtn');if(!b||store.previewTarget==='game')return;
  var m=window.ChoreoMusicUI&&ChoreoMusicUI.webState();
  var playing=m?m.playing:store.isPlaying;
  b.textContent=(playing?'⏸ ':m&&m.pending?'… ':'▶ ')+'网页播放'+(window.ChoreoMusicUI&&ChoreoMusicUI.isWebWithoutMusic()?'（无音乐）':'');
  b.title=playing?'暂停网页排练（空格）':m&&m.pending?'音频正在启动，点击取消':m&&m.paused?'继续网页排练（空格）':'播放（空格）——当前：网页播放';
  b.setAttribute('aria-pressed',String(!!playing));
}
// HYGIENE(AC-2)：播放期间每 tick 都会调 updatePlayOverlay，但活动条目集合大多不变——
// 内容没变就不写 DOM（稳态播放期 MutationObserver 看不到 childList 变动；集合变化时整串重写，
// 展示内容与逐帧重写的旧实现完全一致）。缓存挂在节点上（ov._poHtml，同 toast 的 t._t 约定）：
// render() 会重建 #playOverlay 节点，重建后的新节点没有缓存，首 tick 即写回，不会错漏显示。
function updatePlayOverlay(){
  var ov=document.getElementById('playOverlay');if(!ov)return;
  // 只消费已发布的网页排练位置；暂停、定位、停止及项目重绘也保留当前内容，不读取编辑草稿。
  var web=store.previewTarget==='web';if(web)ov.style.display='block';
  var t=store.currentTime;
  var items=[];
  store.dancers.forEach(function(d,di){
    d.actionClips.forEach(function(c){if(t>=c.start&&t<c.start+c.duration)items.push({dancer:d.name,di:di,type:'action',clip:c})});
    d.lyricClips.forEach(function(c){if(t>=c.start&&t<c.start+c.duration)items.push({dancer:d.name,di:di,type:'lyric',clip:c})});
    d.switchClips.forEach(function(c){if(t>=c.start&&t<c.start+c.duration)items.push({dancer:d.name,di:di,type:'switch',clip:c})});
  });
  store.globalLyrics.forEach(function(c){if(t>=c.start&&t<c.start+c.duration)items.push({dancer:'\u5168\u5C40',di:-1,type:'lyric',clip:c})});
  if(web)items=items.filter(function(it){return it.type==='lyric'}).concat(items.filter(function(it){return it.type!=='lyric'}));
  var html='';
  if(items.length===0){
    html='<div class=\"po-empty\">'+(web?'当前位置暂无文字或动作条目':'\u6682\u65E0\u52A8\u4F5C')+'</div>';
  }else{
    items.forEach(function(it){
      var cls=it.type==='action'?'po-action':it.type==='lyric'?'po-lyric':'po-switch';
      var icon=it.type==='action'?'\u{1F3B6}':it.type==='lyric'?'\u{1F4AC}':'\u{1F504}';
      var nm=it.type==='switch'?ChoreoGearset.label(it.clip.data):it.clip.data.name||'';nm=nm.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      var label=web&&it.type==='lyric'?(it.di<0?'原歌词':'手写台词 · '+it.dancer):it.dancer;
      var dn=String(label).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html+='<div class=\"po-item '+cls+'\"><span class=\"po-dancer\">'+dn+'</span><span class=\"po-icon\">'+icon+'</span><span class=\"po-name\">'+nm+'</span></div>';
    });
  }
  if(ov._poHtml!==html){ov.innerHTML=html;ov._poHtml=html}
}
function updatePlayhead(){var p=document.getElementById('playhead');if(p){p.style.left=(LABEL_W+store.currentTime*store.pps)+'px';p.style.display='block'}var bp=document.getElementById('bottomPlayhead');if(bp)bp.style.left=(LABEL_W+store.currentTime*store.pps)+'px'}

// 阶段1（模式分流）：模式切换。web→game 先探连接（失败只提示，不拦截编辑）；
// game→web 明确 stop+解冻游戏，不能留半冻结角色。两种模式共用同一份时间轴和播放头
function switchPreviewTarget(){
  var to=store.previewTarget==='web'?'game':'web';
  store.previewTarget=to;
  try{localStorage.setItem('choreo_previewTarget',to)}catch(e){}
  stopFollow(); // GAMECLOCK：切模式清跟随（game→web 不留轮询；web→game 由下次起播重建）
  render();
  if(to==='game'){
    probeGame(true).then(function(){
      render();
      if(!store.gameConnected)showToast('\u6E38\u620F\u672A\u8FDE\u63A5\uFF1A\u7F16\u8F91\u4E0D\u53D7\u5F71\u54CD\uFF0C\u6E38\u620F\u5185\u62D6\u52A8/\u64AD\u653E\u6682\u4E0D\u53EF\u7528\uFF08\u542F\u52A8\u6E38\u620F\u540E\u70B9\u5DE5\u5177\u680F\u5706\u70B9\u91CD\u8FDE\uFF09');
      else{
        pushGameTimeline(true); // FIX-B：进游戏模式先把当前时间轴快照推给插件（未按播放就能拖动定格）
        var pdi=gameActorIdx(),pdn=pdi>=0?store.dancers[pdi].name:'';
        if(store.isPlaying)showToast('\u5DF2\u5207\u5230\u300C\u6E38\u620F\u89D2\u8272\u300D\uFF1A\u7F51\u9875\u64AD\u653E\u7EE7\u7EED\uFF0C\u8981\u6E38\u620F\u5185\u64AD\u653E\u8BF7\u518D\u6309\u4E00\u6B21\u64AD\u653E\uFF08\u9884\u89C8\u821E\u8005\uFF1A'+pdn+'\uFF09');
        else showToast('\u5DF2\u5207\u5230\u300C\u6E38\u620F\u89D2\u8272\u300D\uFF1A\u62D6\u52A8\u548C\u64AD\u653E\u53EA\u9A71\u52A8\u6E38\u620F\u9884\u89C8\u821E\u8005\u300C'+pdn+'\u300D\uFF08\u6362\u4EBA\u70B9\u5404\u821E\u8005\u884C\u5934\u7684\uD83C\uDFAE \u9884\u89C8\uFF09');
      }
    });
  }else if(store.gameConnected){
    apiFetch('/playback/stop',{method:'POST'}).catch(function(){});
    apiFetch('/playback/freeze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:''})}).catch(function(){});
    showToast('\u5DF2\u5207\u5230\u300C\u7F51\u9875 3D\u300D\uFF1A\u6E38\u620F\u89D2\u8272\u5DF2\u505C\u6B62\u5E76\u89E3\u51BB\uFF0C\u62D6\u52A8/\u64AD\u653E\u53EA\u8D70\u7F51\u9875');
  }else{
    showToast('\u5DF2\u5207\u5230\u300C\u7F51\u9875 3D\u300D\u6A21\u5F0F');
  }
}
