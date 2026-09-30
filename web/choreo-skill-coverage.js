// 项目技能资源检查：按每位舞者的真实档案读取，报告缺失与阶段冲突；不修改项目或借用资源。
(function(root){
  'use strict';
  function create(options){
    var generation=0;
    async function inspect(state){
      var gen=++generation,P=root.ChoreoAbilityPlan,people=P.performers(state),rows=P.rows(state);
      var snapshot=JSON.stringify([state.projectId,state.dancers.map(d=>[d.id,d.profileId,d.mute,d.solo,d.actionClips]),rows]);
      function current(){return gen===generation&&options.current()&&snapshot===JSON.stringify([state.projectId,state.dancers.map(d=>[d.id,d.profileId,d.mute,d.solo,d.actionClips]),P.rows(state)])}
      var result=[],cache=new Map(),profiles=new Map();
      for(const row of rows){
        if(!current())return null;
        var p=P.plan(row.event),who=people.find(x=>x.id===row.source);
        var item={eventId:row.event.id,performerId:row.source,dancer:who?who.name:'舞者已不存在',actionId:p&&p.actionId,name:p&&p.name,startMs:row.event.startMs,status:'invalid',message:'',executionMessage:'条件未核验：没有本舞者实际执行时序记录'};result.push(item);
        try{
          P.validate(row.event,people,row.source);
          var d=state.dancers[who.index];
          if(row.track.enabled===false||row.event.enabled===false||d.mute||(state.dancers.some(x=>x.solo)&&!d.solo)){item.status='disabled';item.message='已停用或静音';continue}
          var profile=await options.profile(d.profileId||null);if(!current())return null;
          if(!profile){item.status='unbound';item.message='未绑定有效角色档案';continue}
          profiles.set(profile.id,JSON.stringify(profile));
          item.profileId=profile.id;item.skeletonHash=profile.skeletonHash;
          if(root.ChoreoSkillLegality&&p.executionTiming){
            var savedAssessment=root.ChoreoSkillLegality.reference(p.executionTiming,p.actionId,{profileId:profile.id,skeletonHash:profile.skeletonHash,sourceHash:p.executionTiming.sourceHash},options.conditions&&options.conditions());
            item.executionMessage=savedAssessment.message;item.conditionState=savedAssessment.state;
            if(savedAssessment.state==='reference')item.reference=p.executionTiming;
          }
          if(!Array.isArray(profile.modelNames)||!profile.modelNames.length){item.status='missing-model';item.message='该角色档案未导入模型，不能用其他舞者代替';continue}
          var assetName=root.ChoreoSkillMotion.name(p.actionId,p.timing),key=profile.id+'\0'+assetName,clip;
          if(cache.has(key))clip=cache.get(key);else{clip=await options.clip(assetName,profile.id);cache.set(key,clip)}
          if(!current())return null;
          if(!clip){item.status='missing';item.message='本档案缺少此 Action 的动画';continue}
          var binding=root.ChoreoSkillMotion.validate(clip,p.actionId,{profileId:profile.id,fingerprint:profile.skeletonHash,skeleton:profile.skeleton});
          if(root.ChoreoSkillLegality){
            var assessment=root.ChoreoSkillLegality.reference(p.executionTiming,p.actionId,{profileId:profile.id,skeletonHash:profile.skeletonHash,sourceHash:binding.source.papHash},options.conditions&&options.conditions());
            item.executionMessage=assessment.message;item.conditionState=assessment.state;
            delete item.reference;
            if(assessment.state==='reference')item.reference=p.executionTiming;
          }
          var cast=root.ChoreoSkillStages.castTime(p,clip.nativeTiming);
          item.status='ready';item.message='可预览：'+binding.source.variant;item.variant=binding.source.variant;item.sourceHash=binding.source.papHash;
          item.animationStartMs=row.event.startMs+cast*1000+binding.phase.offset*1000;item.animationEndMs=item.animationStartMs+binding.phase.duration*1000;
          if(clip.nativeTiming){item.animationStartMs=row.event.startMs;item.animationEndMs=row.event.startMs+clip.nativeTiming.end*1000;item.message+=' · 实测咏唱 '+cast+' 秒；原生采样回看，阶段边界含采样误差，冷却/动作锁未因此核验'}
          if(clip.nativeTiming&&!item.reference){item.reference={castMs:clip.nativeTiming.castMs};item.executionMessage+='；本档案已采用的原生观察提供咏唱占用参考'}
          var live=options.conditions&&options.conditions();
          if(clip.nativeTiming&&live&&(String(clip.nativeTiming.actorId)!==String(live.actorId)||clip.nativeTiming.jobId!==live.jobId))item.executionMessage+='；动画时序记录角色/职业已变化，需复核，网页仅回看旧观察';
          if(clip.nativeTiming&&p.executionTiming&&clip.nativeTiming.castMs!==p.executionTiming.castMs)item.executionMessage+='；新执行咏唱与旧动画观察不同，动画时序需重新实测';
        }catch(e){item.message=String(e.message||e)}
      }
      for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){
        var a=result[i],b=result[j];if(a.performerId!==b.performerId||a.animationStartMs===undefined||b.animationStartMs===undefined)continue;
        if(a.animationStartMs<b.animationEndMs&&b.animationStartMs<a.animationEndMs){
          if(a.startMs===b.startMs){a.status=b.status='conflict';a.message=b.message='网页预览冲突：同一舞者有多个技能在同刻触发，请明确先后顺序'}
          else{a.message+=' · 视觉尾段重叠，后触发技能接管';b.message+=' · 视觉尾段重叠，后触发技能接管'}
        }
      }
      if(root.ChoreoSkillLegality){
        people.forEach(who=>{
          var d=state.dancers[who.index];if(!result.some(r=>r.performerId===who.id)||d.mute||(state.dancers.some(x=>x.solo)&&!d.solo))return;
          (d.actionClips||[]).filter(c=>c.enabled!==false).forEach(c=>{
            var at=Math.round(c.start*1000),same=result.some(r=>r.performerId===who.id&&r.startMs===at&&r.status!=='disabled');
            result.push({kind:'motion',clipId:c.id,eventId:'motion:'+c.id,performerId:who.id,dancer:who.name,name:c.data&&c.data.name||'普通动作',startMs:at,status:same?'conflict':'ordinary',message:same?'网页预览冲突：普通动作与技能同刻触发':'普通动作按原播放器预览；后触发动作接管技能视觉尾段',executionMessage:'普通动作只检查前序技能执行占用；不会把动画长度当动作锁'});
          });
        });
        var enabled=result.filter(r=>r.status!=='disabled'),checked=root.ChoreoSkillLegality.check(enabled);
        checked.forEach((r,index)=>{var item=enabled[index];item.conflicts=r.conflicts;item.earliestMs=r.earliestMs;
          if(r.conflicts.length)item.executionMessage+='；时序冲突：'+r.conflicts.map(c=>({cast:'咏唱占用',cooldown:'共享冷却/充能',additionalCooldown:'附加冷却',lock:'动作锁'}[c.kind])+'至 '+c.until/1000+' 秒').join('、');
          if(r.unknown.length)item.executionMessage+='；未知：'+r.unknown.join('、');
          if(item.reference&&!r.conflicts.length)item.executionMessage+='；已知参考条件下未见冲突';
          if(item.reference)item.executionMessage+='；目标、资源消耗、状态变化及当前游戏准入仍未核验';
        });
      }
      for(const [id,text] of profiles){if(!current()||JSON.stringify(await options.profile(id))!==text)return null}
      return current()?result:null;
    }
    return {inspect,cancel:()=>generation++};
  }
  // 资源批量铺开汇总：按不同 Action 聚合逐舞者检查结果（只读汇总；普通动作行不入聚合）。
  // ready 计入已覆盖；missing/unbound/missing-model 计入缺资源；其余状态（conflict/disabled/invalid）保留原状态单列。
  function summary(rows){
    var order=[],by=new Map();
    (rows||[]).forEach(function(r){
      if(!r||r.kind==='motion'||!Number.isSafeInteger(r.actionId)||r.actionId<=0)return;
      if(!by.has(r.actionId)){by.set(r.actionId,{actionId:r.actionId,name:r.name||'',entries:[],readyCount:0,missingCount:0});order.push(r.actionId)}
      var a=by.get(r.actionId),status=r.status||'unknown';
      a.entries.push({dancer:r.dancer||'—',status,message:r.message||''});
      if(status==='ready')a.readyCount++;
      else if(status==='missing'||status==='unbound'||status==='missing-model')a.missingCount++;
    });
    var actions=order.map(function(id){return by.get(id)});
    return {actions,totals:{actions:actions.length,
      readyActions:actions.filter(function(a){return a.entries.length&&a.entries.every(function(e){return e.status==='ready'})}).length,
      missingActions:actions.filter(function(a){return a.missingCount>0}).length}};
  }
  // 补资源工作单：把汇总里的缺资源 Action 变成可执行下一步（纯函数，离线可用，不发请求）。
  // 只描述既有捕获/转换/导入链，不伪造任何捕获哈希；多执行时间线与无可读执行时间线的 Action 保持明确不支持。
  function worksheet(sum,info){
    var items=(sum&&sum.actions||[]).filter(function(a){return a.missingCount>0}).map(function(a){
      var by=function(status){return a.entries.filter(function(e){return e.status===status}).map(function(e){return e.dancer})};
      var missing=by('missing'),unbound=by('unbound'),nomodel=by('missing-model'),next=[];
      if(unbound.length)next.push(unbound.join('、')+'：未绑定角色档案——先在舞者绑定处选择或建立档案，资源准备无从开始');
      if(nomodel.length)next.push(nomodel.join('、')+'：档案未导入模型——先为该档案补模型；动画资源可另行准备');
      if(missing.length)next.push(missing.join('、')+'：捕获 Action'+a.actionId+' 的真实 TMB 参考记录与实际绑定 PAP（插件只读 bound 路由），'
        +'经 scripts/local-skill-assets/prepare_bound_actions.py --variant 转换为本档案动作，再回本页「批量导入本舞者技能动作」');
      return {actionId:a.actionId,name:a.name||'',
        dancers:{missing:missing,unbound:unbound,missingModel:nomodel,
          other:a.entries.filter(function(e){return ['missing','unbound','missing-model'].indexOf(e.status)<0}).map(function(e){return e.dancer+'（'+e.status+'）'})},
        next:next};
    });
    return {version:1,kind:'choreo-skill-resource-worksheet',
      boundTo:{projectId:info&&info.projectId||'',dancer:info&&info.dancer||'',profileId:info&&info.profileId||'',profileName:info&&info.profileName||'',skeletonHash:info&&info.skeletonHash||''},
      totals:sum&&sum.totals||{actions:0,readyActions:0,missingActions:0},items:items,
      notes:['清单六项捕获输入（binding/skeletonRead/skeletonBinary/skeletonXml/profile/papIndex）与每条 reference 全部按 sha256 钉死；'
        +'模板中的空值表示"尚未捕获"，脚本会拒绝空值——须以实际捕获填充，不得手填猜测值。',
        '多执行时间线的 Action（如历史记录中的 37/42）与无可读独立执行时间线的 Action（如 16155）保持明确不支持；本工作单不自动选择相位。',
        '历史既证边界不变：不借用其他档案动作、不按名称/表情推断、网页不出特效；race/body/sex 必须与档案一致。']};
  }
  // --variant 清单模板：契约键齐全、每条缺资源 Action 预命名 reference 占位；sha256 留空 = 有意防伪（脚本拒绝空值）。
  function manifestTemplate(ws){
    return {version:1,
      binding:{path:'',sha256:''},skeletonRead:{path:'',sha256:''},skeletonBinary:{path:'',sha256:''},
      skeletonXml:{path:'',sha256:''},profile:{path:'profile.json',sha256:''},papIndex:{path:'',sha256:''},
      papDirectory:'',
      references:(ws&&ws.items||[]).map(function(it){return {path:'action'+it.actionId+'-reference.json',sha256:''}})};
  }
  // 导出工作单包（工作单 + 清单模板 + 可直接另存的档案文件）；复用既有 Blob 下载通道，零网络请求。
  function downloadWorksheet(sum,info,profileObject){
    var ws=worksheet(sum,info),bundle={worksheet:ws,manifestTemplate:manifestTemplate(ws),files:{}};
    if(profileObject)bundle.files['profile.json']=JSON.stringify(profileObject,null,2);
    var text=JSON.stringify(bundle,null,2),url=root.URL&&root.URL.createObjectURL(new root.Blob([text],{type:'application/json'}));
    if(!url)throw Error('当前环境不支持文件下载');
    var a=root.document.createElement('a');a.href=url;a.download='skill-resource-worksheet-'+((info&&info.projectId)||'project')+'.json';
    a.click();setTimeout(function(){root.URL.revokeObjectURL(url)},1000);
    return bundle;
  }
  root.ChoreoSkillCoverage={create,summary,worksheet,manifestTemplate,downloadWorksheet};
})(typeof window!=='undefined'?window:globalThis);
