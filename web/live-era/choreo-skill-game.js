// 游戏技能明确开始：复用播放入口，只采用本舞者真实动作与本次角色核对，不保存执行许可。
(function(root){
  'use strict';
  function must(v,msg){if(!v)throw Error(msg)}
  function build(rows,context,options){
    must(context&&context.available&&/^[1-9][0-9]*$/.test(context.actorId),'当前游戏角色不可读');
    must(options.fromTime===0&&options.speed===1,'技能实演须从0秒、原速明确开始；定位与变速只用于网页回看');
    must(rows.length>0&&rows.length<=32,'本次须有1至32个明确技能事件');
    var ids=new Set(),targets=new Set(),selected=false,events=rows.map(function(r){
      var e=r.event,p=e.data&&e.data.rehearsalAbility;
      must(p&&p.version===1&&/^[1-9][0-9]*$/.test(p.actionId)&&Number(p.actionId)<=2147483647,'缺少真实 Action 身份');
      must(e.kind==='ability'&&e.sourceRef&&e.sourceRef.kind==='action'&&String(e.sourceRef.id)===p.actionId,'技能来源与真实 Action 身份不一致');
      must(p.target&&['self','party','alliance','ally','enemyMarker','ownPet','partyPet'].includes(p.target.kind),'需明确自身或真实手选对象；默认目标和舞台地面坐标不能自动转换成游戏目标');
      var targetId=String(context.actorId);
      if(p.target.kind!=='self'){
        must(options.bindSelected===true&&/^[1-9][0-9]*$/.test(context.targetId)&&context.targetId!==context.actorId,'请明确将排练目标绑定到当前手选对象');
        if(options.protocolVersion!==3)must(context.targetKinds&&context.targetKinds[p.target.kind]===true,'当前手选对象的队伍、敌我或宠物所属关系与声明不符');
        targets.add(p.target.performerId||p.target.label||p.target.kind);must(targets.size===1,'本次有多个不同目标声明；不能把它们都替换成同一个手选对象');
        targetId=context.targetId;selected=true;
      }
      must(typeof e.id==='string'&&e.id.length>0&&!ids.has(e.id),'技能事件身份重复');ids.add(e.id);
      must(Number.isSafeInteger(e.startMs)&&e.startMs>=0,'技能触发时间无效');
      if(options.protocolVersion!==3)[p.timing,p.executionTiming&&p.executionTiming.conditions].forEach(function(c){if(c&&c.actorId)must(String(c.actorId)===String(context.actorId),'当前角色与保存的实测角色不同；请复核舞者档案和时序记录')});
      return {id:e.id,actionId:p.actionId,startMs:e.startMs,targetId:targetId,targetKind:p.target.kind};
    });
    var tail=0;
    options.clips.forEach(function(c){
      var command=c.command;
      if(typeof command==='string'&&/^\/[^\s;<>]+$/.test(command)&&(options.emoteCommands||[]).includes(command))command+=' motion';
      must(c.type==='action'&&typeof command==='string'&&/^\/[^\s;<>]+ motion$/.test(command),'技能混排只接收本机普通动作；换装与聊天需要各自的执行声明');
      must(Number.isFinite(c.start)&&Number.isFinite(c.duration)&&c.start>=0&&c.duration>0,'普通动作时间无效');
      var id='motion:'+c.id,at=Math.round(c.start*1000);must(!ids.has(id)&&Number.isSafeInteger(at),'普通动作身份或时间重复');ids.add(id);
      events.push({id:id,kind:'motion',command:command,startMs:at});tail=Math.max(tail,(c.start+c.duration)*1000);
    });
    must(events.length<=32,'本次技能与普通动作合计最多32条');events.sort((a,b)=>a.startMs-b.startMs);
    events.forEach((e,i)=>must(!i||e.startMs>events[i-1].startMs,'同一时刻多个技能无法明确执行顺序'));
    // 这是本次演出的停止上限，不是技能冷却或动作锁推算。
    var end=Math.max(10000,Math.ceil(Math.max(tail,events[events.length-1].startMs+6000)/1000)*1000);
    must(end<=120000,'当前原生短演出限120秒，请缩短本次技能编排');
    return {version:options.protocolVersion===3?3:options.protocolVersion===2||options.clips.length||selected?2:1,runId:options.runId,actorId:String(context.actorId),jobId:context.jobId,level:context.level,
      territoryId:context.territoryId,targetId:selected?context.targetId:String(context.actorId),maxDurationMs:end,events:events};
  }
  async function prepare(options){
    var state=options.state,di=options.dancerIndex,P=root.ChoreoAbilityPlan;
    var rows=P.rows(state).filter(r=>r.source===P.pid(state,di)&&r.track.enabled!==false&&r.event.enabled!==false);
    var profileId=state.dancers[di].profileId;
    must(profileId,'请先明确绑定本舞者档案');
    var profile=await root.ChoreoLibrary.getProfile(profileId);
    if(!options.isCurrent())return null;
    must(profile,'舞者档案已不存在');var before=JSON.stringify(profile);
    var read=await options.read('/x1/ability-read?mode=context');
    if(!options.isCurrent())return null;
    var others=rows.filter(r=>r.event.data.rehearsalAbility.target.kind!=='self'),bindSelected=false;
    if(others.length){
      var declarations=Array.from(new Set(others.map(r=>P.targetLabel(r.event.data.rehearsalAbility,P.performers(state),P.pid(state,di))))).join('、');
      bindSelected=options.confirm('本次排练目标 '+declarations+' 将绑定到游戏已手选对象：'+(read.context.targetName||'无')+' #'+read.context.targetId+'。不会替你选择或切换目标；请确认确为该排练对象。');
      if(!bindSelected||!options.isCurrent())return null;
    }
    must(root.ChoreoEdit.pure.hasCap(state.pluginCaps,'skillPlaybackV3'),'请更新插件：当前版本不支持失败后继续的技能播放');
    var plan=build(rows,read.context,{runId:crypto.randomUUID(),fromTime:state.currentTime,speed:state.speed,clips:options.clips,bindSelected:bindSelected,emoteCommands:(state.emotes||[]).map(e=>e.command),protocolVersion:3});
    if(JSON.stringify(await root.ChoreoLibrary.getProfile(profileId))!==before||!options.isCurrent())return null;
    var message='本次游戏技能实演\n舞者：'+state.dancers[di].name+'\n游戏角色：'+read.context.actorName+' · '+read.context.jobName+' Lv.'+read.context.level+
      '\n请确认该游戏角色对应本舞者档案。目标：'+(bindSelected?'按条目明确的本人 / '+read.context.targetName+' #'+read.context.targetId:'本人')+'。\n'+plan.events.map(e=>(e.startMs/1000)+'秒：'+(e.kind==='motion'?e.command:'Action'+e.actionId+' → #'+e.targetId)).join('\n')+
      '\n共'+plan.events.filter(e=>e.kind!=='motion').length+'次技能、'+plan.events.filter(e=>e.kind==='motion').length+'条普通动作，最多'+(plan.maxDurationMs/1000)+'秒；不循环、不重试。\n按触发时刻尝试一次，不检查技能前置条件；使用失败继续下一条，不等待咏唱或动作锁。身份变化、观察失效或本人输入仍停止；停止不能撤销已提交的咏唱或效果。\n请先在游戏内 /choreo x1 observe，保持游戏前台并松键。\n确认本次执行？';
    if(!options.confirm(message)||!options.isCurrent())return null;
    if(JSON.stringify(await root.ChoreoLibrary.getProfile(profileId))!==before||!options.isCurrent())return null;
    plan.binding={profileId:profile.id,skeletonHash:profile.skeletonHash,skills:rows.map(r=>({eventId:r.event.id,actionId:r.event.data.rehearsalAbility.actionId,sourceHash:r.event.data.rehearsalAbility.executionTiming?.sourceHash||null}))};
    return plan;
  }
  function resultRows(report){
    return (report.results||[]).map(function(r){
      return 'Action'+(r.Identity?r.Identity.ActionId:'未知')+'：'+(r.Message||'状态未知')+' · 原生返回 '+(r.NativeReturned===true?'成功':'未确认')+' · 匹配响应 '+(r.ResponseObserved===true?'已确认':'未确认')+' · 动作锁结束 '+(r.AnimationLockReleased===true?'已确认':'未确认');
    });
  }
  async function showResult(){
    var state=root.store,project=state.projectId,request=state._skillPlaybackRequest,R=root.ChoreoSkillRecords;
    if(!R){root.showToast('实演记录模块不可用');return}
    var saved=R.list(state.contentExtra).slice(),entries=saved.map(record=>({record:record,saved:true}));
    try{
      if(request&&request.projectId===project){
        var report=state._skillPlaybackResult;
        if(state.gameConnected){try{var read=await root.apiFetch('/playback/status');if(state.projectId!==project||state._skillPlaybackRequest!==request)return;if(read.skillPlayback&&read.skillPlayback.runId===request.runId)report=read.skillPlayback}catch{}}
        if(report&&report.runId===request.runId){state._skillPlaybackResult=report;entries.push({record:await R.capture(request,report),saved:false})}
      }
      if(state.projectId!==project)return;
      var panel=document.createElement('dialog');panel.style.cssText='background:#171e29;color:#eef3ff;border:1px solid #63718a;max-width:700px;max-height:80vh;overflow:auto;padding:20px';
      var select=document.createElement('select');select.setAttribute('aria-label','选择实演记录');entries.forEach(function(e,i){var o=document.createElement('option');o.value=i;o.textContent=(e.saved?'已保存参考':'本次结果')+' · '+e.record.recordedAtUtc+' · '+e.record.request.runId;select.appendChild(o)});select.value=entries.length-1;panel.appendChild(select);
      var body=document.createElement('div');panel.appendChild(body);var generation=0;
      async function display(){
        var gen=++generation,entry=entries[Number(select.value)];
        if(!entry){body.textContent='此项目尚无实演记录，可导入先前保存的实演参考；不会释放技能。';return}
        var record=entry.record;
        var verified=await R.valid(record);if(gen!==generation||!panel.isConnected||state.projectId!==project)return;
        body.textContent='';function line(tag,text){var n=document.createElement(tag);n.textContent=text;body.appendChild(n);return n}
        line('h3',entry.saved?'已保存实演参考':'本次技能实演结果');
        if(!verified){line('p','记录哈希不匹配，不能作为有效证据；原记录保留。');return}
        var report=record.report,binding=record.request.binding;
        line('p','来源项目 '+record.request.projectId+' · 档案 '+binding.profileId+' · 骨架 '+binding.skeletonHash+' · 历史角色 '+record.request.plan.actorId);
        line('p','离线和旧记录仅供回看；角色、职业、属性或状态变化后需重新核验，不能恢复执行许可。');
        line('p',report.message||'结果未完整返回');resultRows(report).forEach(text=>line('p',text));
        if(report.conditionsChanged)line('p','本次状态或属性曾变化：旧时序参考需复核，已保留变化记录；没有拉伸动画或延后触发。');
        (report.motions||[]).forEach(m=>line('p',m.command+'：'+(m.submitted?'已提交，画面效果须独立观察':'未提交')));
        if(report.evidenceLimit)line('p',report.evidenceLimit);
        var save=line('button','保存到当前项目');save.className='btn';save.disabled=entry.saved;
        save.onclick=function(){if(state.projectId!==project||!panel.isConnected)return;var next=R.append(state.contentExtra,record);if(next!==state.contentExtra){state.contentExtra=next;root.saveHistory();root.render()}entry.saved=true;save.disabled=true;root.showToast('已保存独立实演参考；没有修改技能时序或恢复执行许可')};
        var download=line('button','导出此实演记录');download.className='btn';download.onclick=function(){var url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='skill-performance-'+report.runId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
      }
      var input=document.createElement('input');input.type='file';input.accept='.json';input.setAttribute('aria-label','导入实演参考记录');panel.appendChild(input);var importGeneration=0;
      input.onchange=async function(){var token=++importGeneration,file=input.files[0];if(!file)return;try{if(file.size>8*1024*1024)throw Error('实演记录超过8MB');var record=JSON.parse(await file.text());if(!await R.valid(record))throw Error('记录格式或哈希无效');if(token!==importGeneration||state.projectId!==project||!panel.isConnected)return;entries.push({record:record,saved:false});var o=document.createElement('option');o.value=entries.length-1;o.textContent='导入历史参考 · '+record.recordedAtUtc+' · '+record.request.runId;select.appendChild(o);select.value=o.value;await display()}catch(e){if(token===importGeneration&&state.projectId===project&&panel.isConnected)root.showToast(e.message)}};
      select.onchange=display;var close=document.createElement('button');close.className='btn';close.textContent='关闭';close.onclick=()=>panel.close();panel.appendChild(close);panel.onclose=()=>{generation++;importGeneration++;panel.remove()};document.body.appendChild(panel);panel.showModal();await display();
    }catch(e){if(state.projectId===project)root.showToast(e.message)}
  }
  root.ChoreoSkillGame={build:build,prepare:prepare,showResult:showResult,resultRows:resultRows};
})(typeof window!=='undefined'?window:globalThis);
