// 实际执行时序的显式采用：只读当前角色，保存独立参考，不改动画采样或自动授予游戏准入。
(function(root){
  'use strict';
  function attach(box,skill,di,current,adopt,saved,selectedTiming){
    var generation=0,pending=null,conditions=null;
    function node(tag,text){var n=document.createElement(tag);n.textContent=text||'';box.appendChild(n);return n}
    var line=node('p',saved?'已保存实际执行时序参考；离线可检查，当前游戏条件仍需复核。':'实际执行时序尚未读取；目录时间不作为角色实际时间。');
    var read=node('button','读取当前角色实际时序（只读）'),confirm=node('label'),agree=document.createElement('input'),apply=node('button','采用此执行时序参考');
    read.type=apply.type='button';read.className=apply.className='btn';apply.disabled=true;
    agree.type='checkbox';agree.setAttribute('aria-label','确认当前游戏角色对应本舞者档案');confirm.append(agree,document.createTextNode(' 我确认当前游戏角色对应本舞者所绑定的档案；不会用于其他舞者'));
    async function digest(value){var bytes=new TextEncoder().encode(JSON.stringify(value)),h=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(h),x=>x.toString(16).padStart(2,'0')).join('')}
    read.onclick=async function(){
      var gen=++generation;pending=null;conditions=null;apply.disabled=true;agree.checked=false;read.disabled=true;
      try{
        if(!root.store.gameConnected)throw Error('离线：可使用保存的参考；当前游戏条件未核验');
        var dancer=root.store.dancers[di],id=dancer.profileId||null,profile=id?await ChoreoLibrary.getProfile(id):await ChoreoLibrary.getActiveProfile();
        if(!current()||gen!==generation)return;
        if(!profile)throw Error('请先绑定本舞者角色档案');
        var profileText=JSON.stringify(profile),timing=selectedTiming&&selectedTiming();
        var clip=await ChoreoLibrary.getClip(ChoreoSkillMotion.name(skill.id,timing),profile.id);
        if(!clip)clip=await ChoreoLibrary.getClip(ChoreoSkillMotion.name(skill.id),profile.id);
        var binding=ChoreoSkillMotion.validate(clip,skill.id,{profileId:profile.id,fingerprint:profile.skeletonHash,skeleton:profile.skeleton});
        var context=await root.apiFetch('/x1/ability-read?mode=context&actionId='+skill.id);
        if(!current()||gen!==generation)return;
        if(!context.context||!context.context.available)throw Error('当前游戏角色不可读取');
        if(clip.nativeTiming&&String(clip.nativeTiming.actorId)!==String(context.context.actorId))throw Error('当前角色不是此动画时序记录的角色，不能套用');
        var response=await root.apiFetch('/x1/ability-read?mode=timing&actionId='+skill.id+'&requestId='+encodeURIComponent(crypto.randomUUID())+'&contextKey='+encodeURIComponent(context.context.contextKey));
        if(!current()||gen!==generation)return;
        if(response.error||!response.timing)throw Error(response.error||'当前插件不支持实际时序读取');
        if(JSON.stringify(await ChoreoLibrary.getProfile(profile.id))!==profileText)throw Error('档案已变化，请重新读取');
        var r=Object.assign({},response.timing,{profileId:profile.id,skeletonHash:profile.skeletonHash,sourceHash:binding.source.papHash,sourceEvidenceHash:await digest(response),sourceEvidence:response,observedAtUtc:response.observedAtUtc});
        if(!current()||gen!==generation)return;
        if(ChoreoSkillLegality.reference(r,skill.id,{profileId:profile.id,skeletonHash:profile.skeletonHash,sourceHash:binding.source.papHash}).state!=='reference')throw Error('实际时序记录字段不完整');
        pending=r;conditions=r.conditions;apply.disabled=false;
        line.textContent='当前角色：'+context.context.actorName+'；职业 #'+r.conditions.jobId+' / 等级 '+r.conditions.level+'。实际咏唱 '+r.castMs+'ms，复唱 '+r.recastMs+'ms，共享冷却组 '+r.recastGroup+'，充能 '+r.currentCharges+'/'+r.maxCharges+'。当前动作锁读数 '+r.currentAnimationLockMs+'ms；此技能动作锁时长未知。状态/属性覆盖不完整，不能代表未来执行准入。';
      }catch(e){if(current()&&gen===generation)line.textContent=String(e.message||e)}finally{read.disabled=false}
    };
    apply.onclick=()=>{if(!current()||!pending)return;if(!agree.checked){line.textContent='请先确认当前游戏角色对应此舞者档案；不能把一个角色的记录套给另一个角色。';return}adopt(JSON.parse(JSON.stringify(pending)));line.textContent='已选择执行时序参考；点击“应用技能编排”后保存。动画采样保持原记录，未知动作锁和当前准入不会转为通过。'};
    return {conditions:()=>conditions};
  }
  root.ChoreoSkillTimingUI={attach};
})(window);
