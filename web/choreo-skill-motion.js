// 技能动作连接：按档案与真实资源身份读取原始关键帧，借用现有骨骼播放器和音乐播放头。
(function(root){
  'use strict';
  var HASH=/^[a-f0-9]{64}$/;
  function fail(message){throw Error(message)}
  function name(id,timing){return '__action_'+id+(timing&&HASH.test(timing.observationHash)?'@observed_'+timing.observationHash:'')}
  function validate(clip,id,scope,role){
    role=role||'execution';
    var b=clip&&clip.motionBinding;
    if(!b||b.version!==1)fail('未映射：缺少技能资源身份');
    if(!b.source||b.source.type!=='action'||String(b.source.id)!==String(id))fail('不兼容：不是此 Action 的动画');
    if(!scope||!scope.profileId||!scope.fingerprint)fail('未绑定：请选择有骨架的角色档案');
    if(!b.target||b.target.profileId!==scope.profileId||b.target.skeletonHash!==scope.fingerprint)fail('不兼容：动作不属于当前角色档案或骨架');
    if(!b.source.variant||!b.source.animationName||!HASH.test(b.source.papHash)||!HASH.test(b.source.skeletonHash)||!HASH.test(b.source.bindingEvidenceHash))fail('未映射：变体或来源哈希不完整');
    if(!['native','mapped-local'].includes(b.mapping&&b.mapping.kind)||!HASH.test(b.mapping.evidenceHash))fail('未映射：缺少已核验的骨架转换依据');
    var p=b.phase;
    if(!p||p.role!==role||!HASH.test(p.timelineHash)||!Number.isFinite(p.offset)||p.offset<0||!Number.isFinite(p.sourceStart)||p.sourceStart<0||!Number.isFinite(p.duration)||p.duration<=0||!['natural','time-controlled'].includes(p.mode)||!Number.isInteger(p.entryId))fail('未映射：技能阶段与时间引用不完整');
    if(!Number.isFinite(clip.duration)||clip.duration<=0||!Number.isFinite(p.rate===undefined?1:p.rate)||(p.rate!==undefined&&p.rate<0)||sourceTime(p,p.duration)>clip.duration+1e-6||clip.type!=='once'||clip.intro)fail('不兼容：技能阶段超出原始动画');
    if(!clip.bones||!Object.keys(clip.bones).length)fail('缺失：没有动画关键帧');
    if(scope.skeleton){
      var indices=new Set(scope.skeleton.bones.map(x=>'bone_'+x.i));
      Object.keys(clip.bones).forEach(k=>{if(!indices.has(k))fail('不兼容：动画引用目标骨架以外的骨骼')});
    }
    root.ChoreoEngine.validateScaleChannels(clip);
    Object.keys(clip.bones).forEach(k=>['q','t','s'].forEach(channel=>{
      var keys=clip.bones[k][channel];if(channel==='s'&&keys===undefined)return;
      if(!Array.isArray(keys)||!keys.length)fail('不兼容：原始关键帧通道不完整');
      var last=-1;keys.forEach(row=>{if(!Array.isArray(row)||row.length!==(channel==='q'?5:4)||!row.every(Number.isFinite)||row[0]<0||row[0]<last||row[0]>clip.duration+1e-6)fail('不兼容：关键帧时间或数值无效');last=row[0]});
    }));
    if(p.timingPolicy==='observed-transition-linear-preview')fail('未核验：咏唱阶段使用观测区间估算，不能当作游戏实际时序播放');
    if(clip.castPreview){
      var cast=clip.castPreview;
      if(role!=='execution'||cast.version!==1||!HASH.test(cast.observationHash)||!Number.isFinite(cast.observedCastSeconds)||cast.observedCastSeconds<=0||cast.start&&cast.start.castPreview||cast.loop&&cast.loop.castPreview)fail('未映射：咏唱衔接缺少实际来源或包含嵌套阶段');
      validate(cast.start,id,scope,'cast-start');validate(cast.loop,id,scope,'cast-loop');
      if(cast.start.motionBinding.phase.offset!==0||cast.loop.motionBinding.phase.offset!==0||cast.loop.motionBinding.phase.loop!==true)fail('未映射：咏唱阶段偏移或循环依据不完整');
    }
    if(clip.nativeTiming){
      var t=clip.nativeTiming;
      if(role!=='execution'||!clip.castPreview||t.version!==1||t.kind!=='native-control-observation'||!HASH.test(t.observationHash)||t.profileId!==scope.profileId||t.skeletonHash!==scope.fingerprint||String(t.actionId)!==String(id)||!Number.isSafeInteger(t.castMs)||t.castMs<=0||!Number.isFinite(t.end)||t.end<=t.castMs/1000||!Number.isFinite(t.maxSampleGap)||t.maxSampleGap<=0||t.maxSampleGap>.25||!Array.isArray(t.samples)||t.samples.length<3||t.samples.length>10000)fail('未核验：原生时序观测缺少身份、阶段或采样边界');
      var previous=-1,roles=new Set();
      t.samples.forEach(s=>{var raw=s.role==='start'?clip.castPreview.start:s.role==='loop'?clip.castPreview.loop:s.role==='execution'?clip:null;
        if(!raw||!Number.isFinite(s.at)||s.at<0||s.at<=previous||s.at>=t.end||!Number.isFinite(s.time)||s.time<0||s.time>raw.duration+1e-6||previous>=0&&s.at-previous>t.maxSampleGap+1e-6)fail('未核验：原生动画采样缺失或超出原帧');previous=s.at;roles.add(s.role)});
      if(roles.size!==3||t.end-previous>t.maxSampleGap+1e-6)fail('未核验：原生阶段观测不完整');
    }
    return b;
  }
  function sourceTime(p,elapsed){return p.sourceStart+elapsed*(p.rate===undefined?1:p.rate)}
  function create(options){
    var cache=new Map(),generation=0,status=new Map(),overrides=new Map(),activeRows=[];
    function restore(){overrides.forEach((value,c)=>Object.assign(c,value));overrides.clear()}
    function clear(){restore();generation++;cache.clear();status.clear();activeRows=[]}
    function load(id,scope,timing){
      if(!scope)return {state:'未绑定：请选择有骨架的角色档案'};
      var assetName=name(id,timing),key=JSON.stringify([scope.profileId,scope.fingerprint,assetName]),entry=cache.get(key);
      if(entry)return entry;
      entry={state:'正在读取本档案技能动作'};cache.set(key,entry);var gen=generation;
      Promise.resolve().then(()=>options.read(assetName,scope.profileId)).then(clip=>{
        if(gen!==generation)return;
        if(!clip){entry.state='缺失：本档案没有 Action'+id+' 的动作资源';return}
        validate(clip,id,scope);var prepared={clip:options.normalize(clip,key,scope),binding:clip.motionBinding,state:'就绪：当前档案的真实技能动作'};
        if(clip.castPreview){['start','loop'].forEach(part=>{var raw=clip.castPreview[part];prepared[part==='start'?'castStart':'castLoop']={clip:options.normalize(raw,key+' / cast-'+part,scope),binding:raw.motionBinding}})}
        prepared.nativeTiming=clip.nativeTiming;
        Object.assign(entry,prepared);
      }).catch(e=>{if(gen===generation)entry.state=String(e.message||e)});
      return entry;
    }
    function apply(state,engine,scopeFor){
      status.clear();activeRows=[];var P=root.ChoreoAbilityPlan,time=Math.max(0,state.currentTime||0),people=P.performers(state),byDancer=new Map();
      var rows=P.rows(state),latest=new Map();
      rows.forEach(r=>{if(r.track.enabled!==false&&r.event.enabled!==false&&r.event.startMs<=time*1000){try{P.validate(r.event,people,r.source);latest.set(r.source,Math.max(latest.has(r.source)?latest.get(r.source):-1,r.event.startMs))}catch(e){/* 无效片段不抢占动作。 */}}});
      rows.forEach(r=>{
        var person=people.find(p=>p.id===r.source),p=P.plan(r.event);
        if(!person||!p||r.track.enabled===false||r.event.enabled===false)return;
        var d=state.dancers[person.index];if(d.mute||(state.dancers.some(x=>x.solo)&&!d.solo))return;
        try{P.validate(r.event,people,r.source)}catch(e){status.set(r.event.id,'未映射：'+e.message);return}
        var ordinary=(d.actionClips||[]).filter(c=>c.enabled!==false&&Number.isFinite(c.start)&&c.start*1000<=time*1000&&c.start*1000>=r.event.startMs);
        if(ordinary.length){status.set(r.event.id,ordinary.some(c=>c.start*1000===r.event.startMs)?'冲突：技能与普通动作同刻触发':'视觉尾段被后触发普通动作接管；执行占用请查看项目检查');return}
        if(latest.has(r.source)&&r.event.startMs<latest.get(r.source)){status.set(r.event.id,'视觉尾段被后触发技能接管；执行时序请查看项目检查');return}
        var entry=load(p.actionId,scopeFor(person.index),p.timing);status.set(r.event.id,entry.state);
        if(!entry.clip)return;
        var cast;try{cast=root.ChoreoSkillStages.castTime(p,entry.nativeTiming)}catch(e){status.set(r.event.id,e.message);return}
        var selected=root.ChoreoSkillStages.select(entry,cast,time-r.event.startMs/1000),phase={duration:selected.duration},elapsed=selected.elapsed;
        status.set(r.event.id,elapsed<0?'动作等待触发':elapsed>=phase.duration?'动作阶段已结束，恢复舞蹈':'正在预览此角色的技能动作');
        if(entry.nativeTiming&&elapsed>=0&&elapsed<phase.duration)status.set(r.event.id,'本角色实测回看 · 采样间隔≤'+Math.ceil(entry.nativeTiming.maxSampleGap*1000)+'ms；不代表下次演出准入');
        if(elapsed>=0&&elapsed<phase.duration)activeRows.push({id:r.event.id,source:r.source,sourceIndex:person.index,sourceName:person.name,name:p.name,
          targetKind:p.target.kind,targetLabel:P.targetLabel(p,people,r.source),targetIndex:['ownPet','partyPet','ground'].includes(p.target.kind)?undefined:['self','defaultSelf'].includes(p.target.kind)?person.index:(people.find(x=>x.id===p.target.performerId)||{}).index,targetPosition:p.target.kind==='ground'?p.target.position:null,
          phase:selected.role,remainingMs:selected.remainingMs===undefined?Math.ceil((phase.duration-elapsed)*1000):selected.remainingMs,animation:''});
        // 文件阶段独立于可编辑的提示框长度。结束后恢复原舞蹈相位，绝不推进第二个时钟。
        if(elapsed<0||elapsed>=phase.duration+.15)return;
        var list=byDancer.get(person.index)||[];list.push(Object.assign(selected,{id:r.event.id,startMs:r.event.startMs}));byDancer.set(person.index,list);
      });
      byDancer.forEach((list,di)=>{
        var live=list.filter(x=>x.elapsed<x.duration),previous=list.find(x=>x.elapsed>=x.duration);
        if(live.length)list=live; // 已结束动作的淡出不能把紧接的下一技能误报为阶段冲突。
        list.sort((a,b)=>b.startMs-a.startMs);
        if(list.length>1&&list[0].startMs!==list[1].startMs){
          list.slice(1).forEach(x=>status.set(x.id,'视觉尾段被后触发技能接管；执行时序请查看项目检查'));
          list=[list[0]];
        }
        if(list.length!==1){list.forEach(x=>status.set(x.id,'冲突：同一舞者的技能动作阶段重叠，未叠加播放'));return}
        var x=list[0],c=engine.characters[di];if(!c)return;
        var underlying=c.sample(),p=x.entry.binding.phase,tail=x.elapsed>=x.duration;
        overrides.set(c,{currentClip:c.currentClip,clipTime:c.clipTime,state:c.state,loop:c.loop,blendFrom:c.blendFrom,blendT:c.blendT});
        if(tail){
          if(state.isPlaying){c.blendFrom=root.ChoreoEngine.sampleClip(x.entry.clip,x.endTime);c.blendT=(x.elapsed-x.duration)/.15*c.BLEND}
          return;
        }
        c.currentClip=x.entry.clip;c.clipTime=x.time;c.loop=false;c.state='playing';
        c.blendFrom=state.isPlaying&&x.elapsed<.15?(x.from?root.ChoreoEngine.sampleClip(x.from.clip,x.from.time):previous?root.ChoreoEngine.sampleClip(previous.entry.clip,previous.endTime):underlying):null;c.blendT=x.elapsed/.15*c.BLEND;
      });
    }
    return {clear,restore,apply,rows:()=>activeRows.slice(),status:id=>status.get(id)||'缺失：技能动作尚未读取',load};
  }
  root.ChoreoSkillMotion={name,validate,create};
})(typeof window!=='undefined'?window:globalThis);
