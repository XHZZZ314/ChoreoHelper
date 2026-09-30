// 技能分段复用既有播放头：原帧不变，实际咏唱和动画采样读数分别保存，禁止自行拉伸。
(function(root){
  'use strict';
  function source(p,t){return p.sourceStart+t*(p.rate===undefined?1:p.rate)}
  function castTime(plan,trace){
    if(trace){
      var t=plan.timing;
      if(!t||t.version!==1||t.observationHash!==trace.observationHash||t.profileId!==trace.profileId||t.skeletonHash!==trace.skeletonHash||t.castMs!==trace.castMs||plan.castMs!==trace.castMs)throw Error('时序未匹配：请在技能编辑中采用本档案实测时序；不自动修改旧存档');
      return trace.castMs/1000;
    }
    if(plan.castMs>0)throw Error('未核验：缺少本角色实际咏唱及阶段时序，不能按存档提示值播放');
    return 0;
  }
  function observed(entry,elapsed){
    var trace=entry.nativeTiming,rows=trace.samples,i=-1;
    while(i+1<rows.length&&rows[i+1].at<=elapsed)i++;
    if(i<0)return {entry,elapsed:-1,duration:0,time:0,endTime:0,role:'等待实测动作起手'};
    var a=rows[i],b=rows[i+1],part=a.role==='start'?entry.castStart:a.role==='loop'?entry.castLoop:entry,time=a.time;
    if(b&&b.role===a.role){var end=b.time;if(a.role==='loop'&&end<a.time)end+=part.clip.duration;time=a.time+(end-a.time)*(elapsed-a.at)/(b.at-a.at);if(a.role==='loop')time%=part.clip.duration}
    var first=i;while(first>0&&rows[first-1].role===a.role)first--;
    var next=i+1;while(next<rows.length&&rows[next].role===a.role)next++;
    var phaseEnd=next<rows.length?rows[next].at:trace.end,role=a.role==='start'?'咏唱起手':a.role==='loop'?'持续咏唱':'技能动作';
    if(a.role==='loop'){if(elapsed>=trace.castMs/1000)role='释放衔接';else phaseEnd=Math.min(phaseEnd,trace.castMs/1000)}
    return {entry:part,elapsed:elapsed-rows[first].at,duration:trace.end-rows[first].at,time,endTime:time,role,remainingMs:Math.max(0,Math.ceil((phaseEnd-elapsed)*1000-1e-6))};
  }
  function select(entry,cast,elapsed){
    if(entry.nativeTiming)return observed(entry,elapsed);
    var p=entry.binding.phase,start=entry.castStart,loop=entry.castLoop;
    if(start&&loop&&cast>0&&elapsed>=0&&elapsed<cast){
      var intro=start.binding.phase,begin=Math.min(cast,intro.duration);
      if(elapsed<begin)return {entry:start,elapsed,duration:begin,time:source(intro,elapsed),endTime:source(intro,begin),role:'咏唱起手'};
      var lp=loop.binding.phase,t=elapsed-begin;
      return {entry:loop,elapsed:t,duration:cast-begin,time:source(lp,t%lp.duration),endTime:source(lp,(cast-begin)%lp.duration),role:'持续咏唱',from:{clip:start.clip,time:source(intro,begin)}};
    }
    var e=elapsed-cast-p.offset,result={entry,elapsed:e,duration:p.duration,time:source(p,e),endTime:source(p,p.duration),role:'技能动作'};
    if(start&&loop&&cast>0){
      var sp=start.binding.phase,lp=loop.binding.phase;
      result.from=cast<=sp.duration?{clip:start.clip,time:source(sp,cast)}:{clip:loop.clip,time:source(lp,(cast-sp.duration)%lp.duration)};
    }
    return result;
  }
  root.ChoreoSkillStages={select,castTime};
})(typeof window!=='undefined'?window:globalThis);
