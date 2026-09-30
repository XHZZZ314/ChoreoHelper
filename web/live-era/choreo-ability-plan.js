// 技能编排纯逻辑：规范 ability 轨、明确排练对象和毫秒时序；不读取游戏或播放动画。
(function(root){
  'use strict';
  var TAG='choreo-ability-plan-v1';
  var TARGETS=['self','defaultSelf','party','alliance','ally','enemyMarker','ownPet','partyPet','ground'];
  var PERSON_TARGETS=['party','alliance','ally','partyPet'];
  function clone(v){return JSON.parse(JSON.stringify(v))}
  function must(ok,msg){if(!ok)throw Error(msg)}
  function isSkill(s){return !!s&&s.type==='action'&&Number.isSafeInteger(s.id)&&s.id>0&&s.id<=2147483647}
  function owned(t){return !!t&&t.type==='ability'&&t.createdWith===TAG}
  function tracks(state){return state.contentExtra&&state.contentExtra._doc&&state.contentExtra._doc.extraTracks||[]}
  function pid(state,di){var d=state.dancers[di],ids=state.contentExtra&&state.contentExtra._doc&&state.contentExtra._doc.performerIds;return d?(ids&&ids[String(d.id)]||'actor-'+d.id):null}
  function performers(state){return state.dancers.map(function(d,i){return {id:pid(state,i),name:d.name,index:i}})}
  function snapshot(state){return clone(tracks(state).filter(owned))}
  function restore(state,saved){
    var original=tracks(state),next=original.filter(t=>!owned(t)).concat(clone(saved||[]));
    if(!original.length&&!next.length)return;
    state.contentExtra=state.contentExtra||{};state.contentExtra._doc=state.contentExtra._doc||{};
    state.contentExtra._doc.extraTracks=next;
  }
  function seconds(value){
    must(typeof value==='string'&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(value),'时间须为非负秒数，最多三位小数');
    var n=Math.round(Number(value)*1000);must(Number.isSafeInteger(n)&&n<=86400000,'时间必须在 0–86400 秒内');return n;
  }
  function plan(e){return e&&e.data&&e.data.rehearsalAbility}
  function validate(e,people,source){
    var p=plan(e);must(e&&e.kind==='ability'&&typeof e.id==='string'&&e.id&&p&&p.version===1,'不是可编辑的技能编排片段');
    must(isSkill({id:Number(p.actionId),type:'action'})&&String(Number(p.actionId))===p.actionId,'缺少真实 Action 编号');
    must(Number.isSafeInteger(e.startMs)&&e.startMs>=0&&Number.isSafeInteger(p.castMs)&&p.castMs>=0&&Number.isSafeInteger(p.presentationMs)&&p.presentationMs>0,'技能时间必须为整数毫秒，表现提示时长须大于零');
    must(e.durationMs===p.castMs+p.presentationMs&&e.startMs+e.durationMs<=86400000,'技能时序超出范围或不一致');
    must(people.some(x=>x.id===source),'所属舞者已不存在');
    var t=p.target;must(t&&TARGETS.includes(t.kind),'请选择明确的排练目标类型');
    if(PERSON_TARGETS.includes(t.kind))must(people.some(x=>x.id===t.performerId)&&t.performerId!==source,'请指定另一位排练舞者；目标失效时不会借用其他舞者');
    if(['enemyMarker','ownPet','partyPet','ground'].includes(t.kind))must(typeof t.label==='string'&&t.label.trim().length>0&&t.label.length<=80,'请填写明确的排练目标标记名称（最多80字）');
    if(t.kind==='ground')must(t.position&&['x','y','z'].every(k=>Number.isFinite(t.position[k])&&Math.abs(t.position[k])<=10000),'地面目标需有效舞台坐标，每轴在 -10000–10000 米内');
    return e;
  }
  function make(skill,values,id,previous){
    must(isSkill(skill),'旧目录缺少真实技能身份，请连接刷新后再编排');
    var castMs=seconds(values.cast),presentationMs=seconds(values.presentation),startMs=seconds(values.start);
    var e=previous?clone(previous):{id,kind:'ability',enabled:true,locked:false,notes:'',createdWith:TAG};
    var old=plan(e)||{},target=Object.assign({},old.target||{},{kind:values.targetKind});
    delete target.performerId;delete target.label;delete target.position;
    if(PERSON_TARGETS.includes(target.kind))target.performerId=values.targetPerformer;
    if(['enemyMarker','ownPet','partyPet','ground'].includes(target.kind))target.label=(values.targetLabel||'').trim();
    if(target.kind==='ground'){
      target.position={};['x','y','z'].forEach(k=>{var v=values['target'+k.toUpperCase()];must(typeof v==='string'&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(v),'舞台坐标须为数字，最多三位小数');target.position[k]=Number(v)});
    }
    e.startMs=startMs;e.durationMs=castMs+presentationMs;
    e.sourceRef=Object.assign({},e.sourceRef||{},{kind:'action',id:String(skill.id)});
    e.data=Object.assign({},e.data||{},{rehearsalAbility:Object.assign({},old,{version:1,actionId:String(skill.id),name:skill.name,
      castMs,presentationMs,target,animation:'not-connected',gameOutput:false})});
    return e;
  }
  // TASK-20260918-PLAYER-UX-SIMPLIFY B1：默认落条的纯默认值——目标=未指定对象时使用自身、
  // 咏唱=目录基础值（缺失即不可默认，调用方须明示回落编辑窗）、表现提示=1 秒、地面坐标 0。
  function quickDefaults(skill,metadata){
    if(!isSkill(skill)||!metadata||!Number.isSafeInteger(metadata.castMs)||metadata.castMs<0||metadata.castMs>86400000)return null;
    return {start:'',cast:String(metadata.castMs/1000),presentation:'1',targetKind:'defaultSelf',targetPerformer:'',targetLabel:'',targetX:'0',targetY:'0',targetZ:'0'};
  }
  function upsert(all,source,event,trackId,people){
    validate(event,people,source);var out=clone(all),found=[];
    out.forEach(t=>(t.events||[]).forEach(e=>{if(e.id===event.id)found.push({t,e})}));
    must(found.length<=1,'技能事件 ID 重复，保留原数据并拒绝修改');
    if(found.length){var t=found[0].t;must(owned(t)&&t.performerId===source&&!t.locked&&!found[0].e.locked,'此技能片段不可编辑');t.events[t.events.indexOf(found[0].e)]=clone(event)}
    else{var t=out.find(t=>owned(t)&&t.performerId===source&&!t.locked&&t.enabled!==false);
      if(!t){must(!out.some(t=>t.id===trackId),'轨道 ID 冲突');t={id:trackId,type:'ability',performerId:source,enabled:true,locked:false,notes:'',createdWith:TAG,events:[]};out.push(t)}t.events.push(clone(event));}
    return out;
  }
  function remove(all,id){var out=clone(all),found=[];out.forEach(t=>(t.events||[]).forEach(e=>{if(e.id===id)found.push({t,e})}));
    must(found.length===1&&owned(found[0].t)&&!found[0].t.locked&&!found[0].e.locked,'技能已变化或不可删除');var f=found[0];f.t.events.splice(f.t.events.indexOf(f.e),1);return out;
  }
  function rows(state){var out=[];tracks(state).filter(owned).forEach(t=>(t.events||[]).forEach(e=>out.push({track:t,event:e,source:t.performerId})));return out}
  function targetLabel(p,people,source){var t=p.target||{};if(t.kind==='self')return '自身';if(t.kind==='defaultSelf')return '未指定对象 → 自身（排练规则）';if(t.kind==='enemyMarker')return '敌人标记：'+t.label;
    if(t.kind==='ownPet')return '自己的宠物标记：'+t.label;
    if(t.kind==='ground'){var v=t.position||{};return '地面标记：'+t.label+'（'+v.x+', '+v.y+', '+v.z+' 米）'}
    var who=people.find(x=>x.id===t.performerId);return ({party:'队友：',alliance:'团队成员：',ally:'友方：',partyPet:'队友宠物所属：'}[t.kind]||'目标：')+(who?who.name:'目标舞者已不存在')+(t.kind==='partyPet'?' · '+t.label:'');}
  function active(state,timeMs){var people=performers(state);return rows(state).filter(r=>{
    var di=people.find(p=>p.id===r.source),p=plan(r.event);if(!di||!p||p.version!==1||!p.target||!TARGETS.includes(p.target.kind)||!Number.isSafeInteger(p.castMs)||p.castMs<0||!Number.isSafeInteger(p.presentationMs)||p.presentationMs<=0||!Number.isSafeInteger(r.event.startMs)||r.event.startMs<0||r.event.durationMs!==p.castMs+p.presentationMs)return false;
    var d=state.dancers[di.index];return r.track.enabled!==false&&r.event.enabled!==false&&!d.mute&&(!state.dancers.some(d=>d.solo)||d.solo)&&timeMs>=r.event.startMs&&timeMs<r.event.startMs+r.event.durationMs;
  }).map(r=>{var p=plan(r.event),who=people.find(x=>x.id===r.source),elapsed=timeMs-r.event.startMs;return {id:r.event.id,source:r.source,sourceIndex:who.index,name:p.name,
    sourceName:who.name,targetLabel:targetLabel(p,people,r.source),targetKind:p.target.kind,
    targetIndex:['ownPet','partyPet','ground'].includes(p.target.kind)?undefined:['self','defaultSelf'].includes(p.target.kind)?who.index:(people.find(x=>x.id===p.target.performerId)||{}).index,targetPosition:p.target.kind==='ground'?clone(p.target.position||{}):null,
    phase:elapsed<p.castMs?'咏唱提示':'触发表现提示',remainingMs:r.event.startMs+r.event.durationMs-timeMs,animation:'技能动画未接入（仅时间与目标提示）'};});}
  function end(state){return rows(state).reduce((n,r)=>{
    var p=plan(r.event),t=p&&p.timing,observed=t&&t.version===1&&/^[a-f0-9]{64}$/.test(t.observationHash)&&Number.isSafeInteger(t.endMs)&&t.endMs>0&&t.endMs<=86400000?t.endMs:0;
    return Math.max(n,Number(r.event.startMs+r.event.durationMs)||0,observed&&Number.isSafeInteger(r.event.startMs)&&r.event.startMs>=0?Math.min(86400000,r.event.startMs+observed):0);
  },0)/1000}
  function blocksGame(state){return rows(state).some(r=>r.track.enabled!==false&&r.event.enabled!==false)}
  root.ChoreoAbilityPlan={TAG,TARGETS,PERSON_TARGETS,isSkill,owned,tracks,pid,performers,snapshot,restore,seconds,plan,validate,make,quickDefaults,upsert,remove,rows,targetLabel,active,end,blocksGame};
})(typeof window!=='undefined'?window:globalThis);
