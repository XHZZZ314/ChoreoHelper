// 多人直连试验的时钟估计：明确误差和过期边界，不把网络到达时间当开演时间。
(function(root){
  'use strict';
  function finite(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0;}
  function sample(t0,t1,t2,t3){
    if(![t0,t1,t2,t3].every(finite)||t3<t0||t2<t1)throw new Error('时钟采样顺序无效');
    var rtt=(t3-t0)-(t2-t1);
    if(rtt<0)throw new Error('时钟采样跨越了不兼容的时钟');
    return Object.freeze({offsetMs:((t1-t0)+(t2-t3))/2,rttMs:rtt,uncertaintyMs:rtt/2,observedAtMs:t3});
  }
  function estimate(samples,now,options){
    options=options||{};
    var age=options.maxAgeMs===undefined?5000:options.maxAgeMs;
    var maxError=options.maxUncertaintyMs===undefined?100:options.maxUncertaintyMs;
    var need=options.minSamples===undefined?3:options.minSamples;
    if(!finite(now)||!finite(age)||!finite(maxError)||!Number.isInteger(need)||need<1)throw new Error('时钟估计参数无效');
    var live=samples.filter(function(s){return s&&Number.isFinite(s.offsetMs)&&finite(s.rttMs)&&finite(s.uncertaintyMs)&&finite(s.observedAtMs)&&s.observedAtMs<=now&&now-s.observedAtMs<=age;});
    if(live.length<need)return {ok:false,reason:'clock-not-ready',message:'还没有足够的近期计时样本'};
    live.sort(function(a,b){return a.rttMs-b.rttMs||b.observedAtMs-a.observedAtMs;});
    var best=live[0];
    if(best.uncertaintyMs>maxError)return {ok:false,reason:'clock-uncertain',message:'网络延迟过大，无法确认同步起点'};
    // 两条误差区间不能相交，说明暂停、漂移或样本异常；重新采样，不冒用最快的旧样本。
    if(live.some(function(s){return Math.abs(s.offsetMs-best.offsetMs)>s.uncertaintyMs+best.uncertaintyMs+2;}))return {ok:false,reason:'clock-changed',message:'计时时钟发生变化，请重新准备'};
    return Object.freeze({ok:true,offsetMs:best.offsetMs,uncertaintyMs:best.uncertaintyMs,rttMs:best.rttMs,samples:live.length,observedAtMs:best.observedAtMs,expiresAtMs:best.observedAtMs+age});
  }
  function localDeadline(remoteDeadline,clock,now,options){
    options=options||{};var lead=options.minLeadMs===undefined?500:options.minLeadMs,maxLead=options.maxLeadMs===undefined?30000:options.maxLeadMs;
    if(!finite(remoteDeadline)||!finite(now)||!finite(lead)||!finite(maxLead)||!clock||!clock.ok||!Number.isFinite(clock.offsetMs)||!finite(clock.uncertaintyMs)||!finite(clock.expiresAtMs))return {ok:false,reason:'clock-not-ready'};
    if(now>clock.expiresAtMs)return {ok:false,reason:'clock-stale'};
    var deadline=remoteDeadline-clock.offsetMs;
    if(deadline-now<lead+clock.uncertaintyMs)return {ok:false,reason:'start-too-late'};
    if(deadline-now>maxLead)return {ok:false,reason:'start-too-far'};
    return Object.freeze({ok:true,deadlineMs:deadline,uncertaintyMs:clock.uncertaintyMs});
  }
  var api={sample:sample,estimate:estimate,localDeadline:localDeadline};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ChoreoEnsembleClock=api;
})(typeof window==='object'?window:globalThis);
