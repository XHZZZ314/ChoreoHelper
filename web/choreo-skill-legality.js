// 技能执行参考检查：咏唱、共享冷却和充能独立于动画尾段，未知条件绝不补默认值。
(function(root){
  'use strict';
  var hash=/^[a-f0-9]{64}$/,ms=x=>Number.isSafeInteger(x)&&x>=0&&x<=86400000;
  function reference(r,id,scope,current){
    if(!r)return {state:'unknown',message:'条件未核验：没有本舞者实际执行时序记录'};
    if(r.version!==1||!hash.test(r.sourceEvidenceHash)||!hash.test(r.sourceHash)||!hash.test(r.skeletonHash)||!r.conditions||!r.conditions.actorId||!r.conditions.contextKey||!Number.isInteger(r.conditions.jobId)||!Number.isInteger(r.conditions.level)||!ms(r.castMs)||!ms(r.recastMs))return {state:'unknown',message:'条件未核验：记录缺少实际时间或可核验来源'};
    if(String(r.actionId)!==String(id)||r.profileId!==scope.profileId||r.skeletonHash!==scope.skeletonHash||r.sourceHash!==scope.sourceHash)return {state:'stale',message:'需复核：Action、档案、骨架或动画来源已变化'};
    if(current&&['actorId','jobId','level','contextKey','statusKey','attributesKey'].some(k=>String(r.conditions[k])!==String(current[k])))return {state:'stale',message:'需复核：角色、职业、等级、属性或状态已变化；旧记录仅作离线参考'};
    return {state:'reference',message:'保存的角色状态参考；属性/状态覆盖不完整，旧记录需复核，当前游戏准入未核验'};
  }
  function check(rows){
    var out=rows.map(r=>Object.assign({},r,{conflicts:[],unknown:[],earliestMs:r.startMs})),actors=new Map();
    out.forEach(r=>{var a=actors.get(r.performerId)||[];a.push(r);actors.set(r.performerId,a)});
    actors.forEach(list=>{
      list.sort((a,b)=>a.startMs-b.startMs);var groups=new Map(),prior=[];
      list.forEach(row=>{
        var r=row.reference;
        function unknown(s){if(!row.unknown.includes(s))row.unknown.push(s)}
        function conflict(kind,until,other){if(row.startMs<until){row.conflicts.push({kind,until,eventId:other});row.earliestMs=Math.max(row.earliestMs,until)}}
        prior.forEach(p=>{if(ms(p.reference.castMs))conflict('cast',p.startMs+p.reference.castMs,p.eventId);
          if(ms(p.reference.lockDurationMs))conflict('lock',p.startMs+p.reference.lockDurationMs,p.eventId)});
        if(!r){if(row.kind!=='motion')unknown('实际咏唱/冷却/充能/动作锁');return}
        if(!ms(r.castMs))unknown('实际咏唱');
        if(!ms(r.lockDurationMs))unknown('动作锁时长');
        if(!Number.isInteger(r.recastGroup)||r.recastGroup<0||!ms(r.recastMs))unknown('共享冷却组/实际复唱');
        else{
          var key=r.recastGroup,g=groups.get(key);
          if(!g){
            var capacity=Number.isInteger(r.maxCharges)&&r.maxCharges>0?r.maxCharges:null;
            var known=capacity!==null&&Number.isInteger(r.currentCharges)&&r.currentCharges>=0&&r.currentCharges<=capacity;
            g={capacity,available:known?r.currentCharges:null,queue:[],recast:r.recastMs,last:null};groups.set(key,g);
            // 未满充能的首个恢复时刻不由文件长度或目录值推算。
            if(known&&r.currentCharges<capacity){
              var initial=r.primaryRecovery;
              // SDK 的 Elapsed 是已恢复量；仅同一 Action 且总量等于本等级充能容量时采用。
              if(initial&&initial.groupId===key&&String(initial.lastActionId)===String(r.actionId)&&initial.active===true&&
                r.recastMs>0&&Number.isFinite(initial.elapsedMs)&&initial.elapsedMs>=0&&Number.isFinite(initial.totalMs)&&
                Math.abs(initial.totalMs-r.recastMs*capacity)<=1&&Math.floor(initial.elapsedMs/r.recastMs)===r.currentCharges){
                var first=Math.ceil((r.currentCharges+1)*r.recastMs-initial.elapsedMs);
                for(var n=0;n<capacity-r.currentCharges;n++)g.queue.push(first+n*r.recastMs);
                g.last=row.eventId;
              }else{g.available=null;unknown('起始充能/恢复状态')}
            }
          }
          if(g.available===null||g.recast!==r.recastMs||g.capacity!==r.maxCharges){unknown('起始充能/恢复状态');g.available=null}
          else{
            while(g.queue.length&&g.queue[0]<=row.startMs){g.queue.shift();g.available++}
            if(g.available===0)conflict('cooldown',g.queue[0],g.last);
            else{g.available--;g.queue.push(Math.max(row.startMs,g.queue.length?g.queue[g.queue.length-1]:row.startMs)+r.recastMs);g.last=row.eventId}
          }
        }
        if(r.additionalRecastGroup!==-1){
          var extra=r.additionalRecovery;
          if(extra&&extra.groupId===r.additionalRecastGroup&&Number.isFinite(extra.remainingMs)&&extra.remainingMs>=0)conflict('additionalCooldown',Math.ceil(extra.remainingMs),row.eventId);
          unknown('附加冷却组后续占用');
        }
        prior.push(row);
      });
    });
    return out;
  }
  root.ChoreoSkillLegality={reference,check};
})(typeof window!=='undefined'?window:globalThis);
