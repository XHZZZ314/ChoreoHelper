// 编舞助手舞者/编辑操作分件（OVERHAUL 批 C 第七步从 choreo-app.js 拆出）：
// 舞者增删与绑定清单、目录过滤、冲突检查、空隙补齐与片段的增删复制——
// makeDancer..getFilteredActions、conflictEnd/autoFillGaps、addClip/deleteClip/duplicateClip 等。
// 同全局名文件级搬家，行为逐字不变；须在 choreo-app.js 之前加载（装时机语句自足）。
'use strict';

// solo/mute（WP-3b）：随项目 content.dancers 持久化；生效口径见 ChoreoEdit.pure.isMuted
function makeDancer(idx){return{id:idx,name:'\u821E\u8005'+(idx+1),color:dancerColors[idx%dancerColors.length],switchClips:[],actionClips:[],lyricClips:[],currentJob:'',collapsed:false,laneScale:1,solo:false,mute:false}}

// CHARACTER-ASSETS-P3：已知档案清单缓存（舞者行绑定下拉的数据源；只读不写库）。
// 启动时拉一次，之后跟着资料库窗口的 __p3dProfilesChanged 通知刷新；清单变了才重绘
var _knownProfiles=[];
// 快捷模型导入捕获项目与舞者对象，异步解析完成后不得误绑到另一个项目。
window.__choreoModelImportTarget=function(){
  var projectId=store.projectId,dancer=store.dancers[store.selectedDancer];
  if(!dancer)return null;
  var sourceProfileId=dancer.profileId||null;
  function isCurrent(){return store.projectId===projectId&&store.dancers.indexOf(dancer)>=0&&(dancer.profileId||null)===sourceProfileId}
  return {label:dancer.name,sourceProfileId:sourceProfileId,isCurrent:isCurrent,bind:async function(profileId){
    if(!isCurrent()||!window.ChoreoLibrary)return false;
    var profiles=await ChoreoLibrary.listProfiles();
    if(!isCurrent())return false;
    var known=profiles.map(function(p){return p.id});
    var changed=ChoreoEdit.pure.setDancerBinding(store.dancers,store.dancers.indexOf(dancer),profileId,known);
    if(!changed)return false;
    _knownProfiles=profiles.map(function(p){return{id:p.id,name:p.name,boneCount:p.boneCount}});
    saveHistory();if(window.__p3dBindingsChanged)window.__p3dBindingsChanged();render();return true;
  }};
};
function refreshKnownProfiles(){
  if(!(window.ChoreoLibrary&&ChoreoLibrary.available())){_knownProfiles=[];return}
  ChoreoLibrary.listProfiles().then(function(lps){
    var next=lps.map(function(p){return{id:p.id,name:p.name,boneCount:p.boneCount}});
    if(JSON.stringify(next)!==JSON.stringify(_knownProfiles)){
      _knownProfiles=next;
      if(store.appReady)render();
    }
  }).catch(function(){});
}

function setDancerCount(n){
  // 六轨八人（TASK-20260901-SIX-TRACK-ROUNDTRIP）：创作上限从 3 放开到 12——与导入校验
  // AUD-002 的 1～12 同一口径；8 人是本包的第一个合奏创作验收门，UI 提供 1～8 快捷按钮。
  // 8/8/1 裁定（主人 2026-09-05，TASK-20260905-DUAL-MODE-CLOSEOUT D1）：编辑/排练 8、网页预览 8、
  // X1 前游戏执行 1；1～12 是裁定之上刻意保留的创作/导入余量（E1 验收过 1～12 舞者工程，
  // 硬砍到 8 需新的主人决定+迁移包），快捷按钮只到 8
  n=Math.max(1,Math.min(12,n));
  while(store.dancers.length<n)store.dancers.push(makeDancerAtNextId());
  while(store.dancers.length>n)store.dancers.pop();
  store.dancerCount=n;
  if(store.selectedDancer>=n)store.selectedDancer=n-1;
  if(store.gameActor>=n)store.gameActor=n-1; // ACTOR：预览舞者跟着舞者数收拢，读取侧 gameActorIdx 还有兜底
  saveHistory();updateTotalDuration();render()
}
// P2 舞者行就地添加/移除：id 取现有人群最大值+1，避免中间移除后再加出现重号（旧口径只在末尾增删）
function nextDancerId(){var m=-1;store.dancers.forEach(function(d){if(d.id>m)m=d.id});return m+1}
function makeDancerAtNextId(){return makeDancer(nextDancerId())}
function addDancerAtEnd(){
  var d=makeDancerAtNextId();d.name='舞者'+(store.dancers.length+1);
  store.dancers.push(d);store.dancerCount=store.dancers.length;store.selectedDancer=store.dancers.length-1;
  return d;
}
function removeDancerAt(di){
  var d=store.dancers[di];
  if(!d||store.dancers.length<=1)return;
  if(!window.confirm('移除舞者「'+d.name+'」及其编排？可一次撤销恢复，其余舞者不动。'))return;
  // 技能轨按舞者随删（本批域）；动作/走位轨沿用既有「减少人数」口径，不顺手扩面
  if(window.ChoreoAbilityPlan){
    try{
      var who=ChoreoAbilityPlan.pid(store,di);
      var all=ChoreoAbilityPlan.tracks(store).filter(function(t){return !(ChoreoAbilityPlan.owned(t)&&t.performerId===who)});
      store.contentExtra=store.contentExtra||{};store.contentExtra._doc=store.contentExtra._doc||{};
      store.contentExtra._doc.extraTracks=all;
    }catch(e){}
  }
  store.dancers.splice(di,1);store.dancerCount=store.dancers.length;
  if(store.selectedDancer>=store.dancers.length)store.selectedDancer=store.dancers.length-1;
  if(store.gameActor>=store.dancers.length)store.gameActor=store.dancers.length-1; // ACTOR 读取侧还有兜底
  clearClipSelection();
  if(window.ChoreoAbilityUI&&ChoreoAbilityUI.clearSelection)ChoreoAbilityUI.clearSelection();
  saveHistory();updateTotalDuration();render();
  showToast('已移除 '+d.name+'（↶ 可撤销）');
}

// Get job categories for sidebar
function getJobTabs(){
  var groups={};
  store.actions.forEach(function(a){
    if(a.jobName){
      if(!groups[a.jobName])groups[a.jobName]={count:0,jobId:a.jobId,abbr:a.jobAbbr||'',role:a.jobAbbr||''};
      groups[a.jobName].count++;
    }
  });
  return Object.keys(groups).map(function(name){return{name:name,count:groups[name].count,jobId:groups[name].jobId,abbr:groups[name].abbr}}).filter(function(j){return j.count>=3}).sort(function(a,b){return b.count-a.count});
}

function getFilteredActions(summary){
  var items=[],q=store.search.toLowerCase();
  if(store.activeTab==='emote-usual')items=store.emotes.filter(function(e){return e.category==='usual'});
  else if(store.activeTab==='emote-special')items=store.emotes.filter(function(e){return e.category==='special'});
  else if(store.activeTab==='emote-expression')items=store.emotes.filter(function(e){return e.category==='expression'});
  else if(store.activeTab==='switch')items=switchItems;
  else if(store.activeTab==='race')items=store.races.filter(function(r){return r.id>0}).map(function(r){return{id:r.id,name:r.masculine||r.feminine,command:'race:'+r.id,category:'绉嶆棌'}});
  else if(store.activeTab==='all')items=store.emotes.concat(store.actions.slice(0,150));
  else if(store.activeTab==='skill-all')items=q?store.actions:store.actions.slice(0,400);
  else if(store.activeTab.indexOf('job-')===0){
    var jn=store.activeTab.substring(4);
    items=store.actions.filter(function(a){return a.jobName===jn});
  }
  if(q)items=items.filter(function(i){return(i.name||'').toLowerCase().indexOf(q)>=0||(i.command||'').toLowerCase().indexOf(q)>=0||(i.jobAbbr||'').toLowerCase().indexOf(q)>=0});
  if(summary)summary.total=items.length;
  return items.slice(0,300);
}

// Esc：先退宏面板全屏；否则清空多选（WP-3b）
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(store.macroFullscreen){store.macroFullscreen=false;render();showToast('\u5DF2\u9000\u51FA\u5B8F\u5168\u5C4F');return}
  if(window.ChoreoEdit&&edHasSel()){clearClipSelection();render()}
});

// Delete/Backspace 删除选中的 clip（输入框中不生效）；多选时整批删（WP-3b）；P2 含技能片段；
// B3：走位/朝向会话也在选择摘要内，键盘与屏幕删除按钮同一分派（deleteSelectedClips 内部自带 toast）
document.addEventListener('keydown',function(e){
  if(e.key!=='Delete'&&e.key!=='Backspace')return;
  var t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return; // 输入框焦点＝文本编辑，永不删对象（S0 亦然）
  var skillN=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection().length:0;
  var motionN=(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.selectionDetail)?ChoreoStageMotionUI.selectionDetail().length:0;
  if(!store.selectedClip&&!edHasSel()&&!skillN&&!motionN)return;
  deleteSelectedClips();
  e.preventDefault();
});

// Conflict check：返回造成冲突的另一轨 clip 的最晚结束时刻（无冲突返回 0）
function conflictEnd(di,tt,ns,nd,ex){
  var d=store.dancers[di];if(!d)return 0;
  if(tt!=='switch'&&tt!=='action')return 0;
  var ot=tt==='switch'?'actionClips':'switchClips';
  var other=d[ot];var ne=ns+nd;var ret=0;
  for(var i=0;i<other.length;i++){
    var c=other[i];if(c.id===ex)continue;
    var cE=c.start+c.duration;
    if(ns<cE-0.01&&ne>c.start+0.01&&cE>ret)ret=cE;
  }
  return ret;
}
function hasConflict(di,tt,ns,nd,ex){return conflictEnd(di,tt,ns,nd,ex)>0}
// 首条旅程（合同 §3「遇到冲突」）：同轨动作重叠也须拒绝。既有 conflictEnd 只查动作↔切换
// 跨轨冲突，同轨重叠应用会静默通过——而下方编辑预告写着「应用会校验」。这里在注入
// ChoreoClipTime.plan 的回调层补同轨校验（同舞者同轨、排除自身、沿用 0.01 容差）；
// 规划器模块 choreo-clip-time.js 与 conflictEnd 本体不改。
function trackOverlapConflict(di,tt,ns,nd,ex){
  if(di==null||di<0||(tt!=='action'&&tt!=='switch'))return false;
  var d=store.dancers[di];if(!d)return false;
  var arr=d[tt+'Clips']||[],ne=ns+nd;
  for(var i=0;i<arr.length;i++){
    var c=arr[i];if(c.id===ex)continue;
    var cE=c.start+c.duration;
    if(ns<cE-0.01&&ne>c.start+0.01)return true;
  }
  return false;
}

// 自动补齐规则（2026-08-28 主人拍板改）：手动编辑（拖动/缩短/删除/改时长）不再自动回填——
// 空隙是用户的显式意图，界面如实显示。只剩两种场景自动补：
//   ① 新增动作插入中间：只延长"新插入的这条"接住下一个（addClip 传 onlyClip）
//   ② 导入工程 / 解析宏：整轨全量补齐（"生成连续时间轴"的语义没变）
// 想补齐留出的空隙：动作条右键菜单「补齐空隙」
function autoFillGaps(di,onlyClip){
  var d=store.dancers[di];if(!d)return false;
  var changed=false;
  var arr=d.actionClips.slice().sort(function(a,b){return a.start-b.start});
  if(onlyClip){ // 只补指定 clip 到下一个之间的缝（新增插入场景，不动其他 clip）
    var i=arr.indexOf(onlyClip);if(i<0||i>=arr.length-1)return false;
    var a=arr[i],b=arr[i+1];
    if(b.start-(a.start+a.duration)>0.05){
      a.duration=Math.round((b.start-a.start)*1000)/1000;
      if(a.autoDur)a.autoDur=false;
      changed=true;
    }
    return changed;
  }
  for(var j=0;j<arr.length-1;j++){
    var a2=arr[j],b2=arr[j+1];
    if(b2.start-(a2.start+a2.duration)>0.05){
      a2.duration=Math.round((b2.start-a2.start)*1000)/1000;
      if(a2.autoDur)a2.autoDur=false; // 补齐是显式时长，不再被实测时长自动校正顶掉
      changed=true;
    }
  }
  return changed;
}

// 插入用户明确选择的条目，不自动切换职业
// noSave：批量插入（添加到全部舞者）时静默——落位/建条照旧，历史/落盘/重绘由调用方一次性收尾
// TASK-20260918-PLAYER-UX-SIMPLIFY B1：技能不再弹编辑窗，直接按默认落条（缺目录基础时间时
// quickAdd 内部明示 toast 并回落打开编辑窗）；时刻=该舞者技能轨末尾，与动作条追加口径一致。
function abilityLaneEnd(di){
  if(!window.ChoreoAbilityPlan)return 0;
  var who=ChoreoAbilityPlan.pid(store,di);if(!who)return 0;
  var end=0;ChoreoAbilityPlan.rows(store).forEach(function(r){if(r.source===who)end=Math.max(end,r.event.startMs+r.event.durationMs)});
  return end/1000;
}
function abilityLaneEndAll(){
  if(!window.ChoreoAbilityPlan)return 0;
  var end=0;ChoreoAbilityPlan.rows(store).forEach(function(r){end=Math.max(end,r.event.startMs+r.event.durationMs)});
  return end/1000;
}
// 首条旅程 J3：时长来源五分类（资源声明/已测量/默认编排/用户设置或旧项目）。
// 只标实际可确认的来源；autoDur=false 且无资源声明时无法区分用户设置与旧项目，如实合并标注；
// 不新增持久化来源字段，也不把默认 3 秒说成实际动作长度。
// src=可选的目录源条目（按 command 只读回查）：clip.data 不保存 isLoop/duration，
// 循环标记要从目录源恢复，仅用于显示，不写回任何数据。
function clipDurationSourceLabel(clip,measuredDur,src){
  if(!clip||!clip.data)return '';
  var resDur=Number(clip.data.duration)||(src&&Number(src.duration))||0;
  if(resDur>0)return '资源声明 '+resDur+'s';
  if(clip.data.isLoop||(src&&src.isLoop)){
    // 循环动作建条即 autoDur=false，目录标记不能倒推来源（R1）：仅当前值恰为默认 3 秒
    // 才可称默认占位；用户改过的时长与旧项目不可区分，按「用户设置或旧项目」如实标注
    if(Math.abs(Number(clip.duration)-3)<1e-9)return '默认编排值（'+Number(clip.duration)+'s：循环动作默认占位，可修改；实际动作长度未确认）';
    return '用户设置或旧项目（实际动作长度未确认）';
  }
  if(clip.autoDur){
    var m=measuredDur&&measuredDur[clip.data.command];
    if(Number(m)>0)return '已测量（'+Number(m)+'s，实测到手后自动校正）';
    return '默认编排值（'+Number(clip.duration)+'s 为默认占位，可修改；实际动作长度未确认）';
  }
  return '用户设置或旧项目（实际动作长度未确认）';
}
function addClip(di,tt,data,st,noSave){
  // P2：技能缺省锚点由 quickAdd 内部统一（技能轨末尾），这里不再预填，避免各调用方口径漂移
  if(window.ChoreoAbilityPlan&&ChoreoAbilityPlan.isSkill(data)&&window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAdd){ChoreoAbilityUI.quickAdd(data,di,st);return false}
  var d=store.dancers[di];if(!d)return false;
  if(st===undefined){var d0=store.dancers[di];var arr0=d0[tt+'Clips'];var lastEnd0=0;arr0.forEach(function(c){var e0=c.start+c.duration;if(e0>lastEnd0)lastEnd0=e0});st=lastEnd0}
  var dur=data.duration||(data.isLoop?3:(store.measuredDur[data.command]||3));
  var autoDur=!data.duration&&!data.isLoop; // 非循环动作：时长来自默认/实测值，拿到实测后自动校正
  // 与用户明确放置的切换轨错开；装备套装不从职业目录推测。
  var plan={st:st,swStart:0,swDur:0};
  if(tt==='action'){
    plan=ChoreoEdit.pure.planActionPlacement(d.switchClips,d.actionClips,st,dur,false);
    if(plan.st!==st)showToast('已自动顺延到 '+plan.st.toFixed(1)+'s（切换和动作轨不能重叠）');
    st=plan.st;
  }else if(tt!=='lyric'){
    var guard=0,ce;
    while((ce=conflictEnd(di,tt,st,dur))>0&&guard++<50){st=ce+0.05}
    if(guard>0)showToast('已自动顺延到 '+st.toFixed(1)+'s（切换和动作轨不能重叠）');
  }
  var nc={id:store.nextClipId++,start:Math.max(0,st),duration:dur,autoDur:autoDur,data:{id:data.id,name:data.name,command:data.command,category:data.category,jobName:data.jobName,jobId:data.jobId,jobAbbr:data.jobAbbr}};
  if(tt==='switch')nc.data=JSON.parse(JSON.stringify(data));
  d[tt+'Clips'].push(nc);
  if(tt==='action')autoFillGaps(di,nc); // 拖放插入中间时只把"新插入的这条"延长接住下一个，不动其他动作
  if(!noSave){saveHistory();updateTotalDuration();render()}
  return true;
}

// MULTI-DANCER（TASK-20260831-MULTI-DANCER-EDIT）：把一条动作在同一时刻插给每位在场舞者（齐奏）。
// 落位规划走纯函数 planMultiActionPlacement（node 单测覆盖）：每位按既有 per-dancer 规则
// （planActionPlacement：切职业 0.5s、冲突顺延）各算各的，某舞者自己轨道冲突时只有那一位被
// 顺延，其余保持请求起点，既有条永不移动。建条字段与 addClip 逐字段同口径（含自动切职业与
// autoFill），保证编译/播放与手摆条完全一致。单人（或开关关）原样走 addClip，行为零变化。
function addClipToAllDancers(item,st){
  // B1：技能+「添加到全部舞者」＝逐位默认落条一次撤销（quickAddAll 内含不可默认回落）。
  if(window.ChoreoAbilityPlan&&ChoreoAbilityPlan.isSkill(item)){if(window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAddAll)ChoreoAbilityUI.quickAddAll(item,st);return}
  if(store.dancers.length<=1){addClip(store.selectedDancer,'action',item,st);return}
  var dur=item.duration||(item.isLoop?3:(store.measuredDur[item.command]||3));
  var autoDur=!item.duration&&!item.isLoop; // 与 addClip 同口径：非循环动作拿实测后自动校正
  var plan=ChoreoEdit.pure.planMultiActionPlacement(store.dancers,st,dur,item,{});
  var deferred=[];
  plan.forEach(function(p){
    if(!p)return;
    var d=store.dancers[p.di];
    var nc={id:store.nextClipId++,start:Math.max(0,p.st),duration:dur,autoDur:autoDur,data:{id:item.id,name:item.name,command:item.command,category:item.category,jobName:item.jobName,jobId:item.jobId,jobAbbr:item.jobAbbr}};
    d.actionClips.push(nc);
    autoFillGaps(p.di,nc);
    if(p.deferred)deferred.push({name:d.name,st:Math.max(0,p.st)}); // O-6：顺延如实带实际落点
  });
  if(deferred.length)showToast(deferred.map(function(x){return x.name+'→'+x.st.toFixed(2)+'s'}).join('、')+' 已顺延（若与同轨内容重叠会红框标出），其余舞者保持 '+st.toFixed(1)+'s');
  saveHistory();updateTotalDuration();render(); // 整次多舞者插入只进一步撤销
}

function showCopyTracksMenu(x,y,srcIdx){ // 舞者行头「⧉」菜单：列其他舞者作为复制目标（B7b/TD-04：入口如实＝三条基础轨＋可选扩展）
  var m=document.getElementById('ctxMenu');m.innerHTML='';
  var offered=0;
  store.dancers.forEach(function(d,ti){
    if(ti===srcIdx)return; // 目标=自己不给
    offered++;
    var mi=el('div','ctx-it','\u21C9 复制三条基础轨（切换/动作/台词）到 '+d.name);
    mi.title='把「'+store.dancers[srcIdx].name+'」的三条基础轨（切换/动作/台词）复制给 '+d.name+'；可勾选扩展：技能/走位/朝向；目标已有内容时会先确认（整体替换，一次撤销可还原）';
    mi.onclick=function(){m.classList.remove('show');b7bCopyTracksDialog(ti,srcIdx)};
    m.appendChild(mi);
  });
  if(!offered)return;
  m.style.left=x+'px';m.style.top=y+'px';m.classList.add('show');
}
function addClipToTrack(di,tt,data,st){
  var d=store.dancers[di];if(!d)return;
  if(st===undefined){var arr=d[tt+'Clips'];var lastEnd=0;arr.forEach(function(c){var e=c.start+c.duration;if(e>lastEnd)lastEnd=e;st=Math.round(st*2)/2});st=lastEnd}
  d[tt+'Clips'].push({id:store.nextClipId++,start:st,duration:data.duration||3,data:data});
  saveHistory();updateTotalDuration();render();
}

function deleteClip(id){
  store.dancers.forEach(function(d){d.switchClips=d.switchClips.filter(function(c){return c.id!==id});d.actionClips=d.actionClips.filter(function(c){return c.id!==id});d.lyricClips=d.lyricClips.filter(function(c){return c.id!==id})});
  store.globalLyrics=store.globalLyrics.filter(function(c){return c.id!==id});
  if(store.selectedClip&&store.selectedClip.id===id)store.selectedClip=null;
  // 删除后不再自动回填：空隙是用户的显式意图，想补齐用右键「补齐空隙」
  saveHistory();updateTotalDuration();render();
}

function duplicateClip(clip){
  // Search in dancers
  for(var di=0;di<store.dancers.length;di++){
    var d=store.dancers[di];
    for(var tt of['switch','action','lyric']){
      var arr=d[tt+'Clips'];
      var idx=arr.indexOf(clip);
      if(idx>=0){
        var ns=clip.start+clip.duration; // 紧贴被复制条末端生成（2026-08-29 主人反馈，不留缝）
        var nc=JSON.parse(JSON.stringify(clip));nc.id=store.nextClipId++;nc.start=ns;
        // 副本用新 clip id 派生事件身份，保留其余规范字段和扩展。
        if(nc._doc&&typeof nc._doc==='object'&&!Array.isArray(nc._doc))delete nc._doc.id;
        // 腾位再落副本：本轨被副本压到的条目整体右移，复制完时间轴零重叠
        ChoreoEdit.pure.makeRoom(arr,ns,clip.duration);
        arr.push(nc);
        saveHistory();updateTotalDuration();render();return;
      }
    }
  }
  // Search in global lyrics
  var gi=store.globalLyrics.indexOf(clip);
  if(gi>=0){
    var ns2=clip.start+clip.duration; // 紧贴被复制条末端生成
    var nc2=JSON.parse(JSON.stringify(clip));nc2.id=store.nextClipId++;nc2.start=ns2;
    if(nc2._doc&&typeof nc2._doc==='object'&&!Array.isArray(nc2._doc))delete nc2._doc.id;
    ChoreoEdit.pure.makeRoom(store.globalLyrics,ns2,clip.duration);
    store.globalLyrics.push(nc2);
    saveHistory();updateTotalDuration();render();
  }
}
