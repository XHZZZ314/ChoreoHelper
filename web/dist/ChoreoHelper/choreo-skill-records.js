// 项目内实演证据：独立哈希、真实身份、追加保存；离线记录永远不是当前执行许可。
(function(root){
  'use strict';
  var key='skillPerformanceRecords',clone=x=>JSON.parse(JSON.stringify(x));
  async function digest(value){var b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')}
  function payload(record){return {version:record.version,request:record.request,report:record.report,recordedAtUtc:record.recordedAtUtc}}
  function identities(request,report){
    if(!request||!request.plan||!Array.isArray(request.plan.events)||!request.binding||typeof request.binding.profileId!=='string'||typeof request.binding.skeletonHash!=='string'||!request.projectId||!report||report.runId!==request.runId||!Array.isArray(report.results))throw Error('实演身份或档案依据不完整，未保存');
    for(var r of report.results){var i=r.Identity;if(!i&&r.NativeReturned!==true&&r.ResponseObserved!==true)continue;var e=i&&request.plan.events.find(e=>e.id===i.EventId);if(!e||String(e.actionId)!==String(i.ActionId)||String(i.ActorId)!==String(request.plan.actorId)||i.TargetId!==undefined&&String(i.TargetId)!==String(e.targetId||request.plan.targetId||request.plan.actorId))throw Error('响应与本次 Action、事件、目标或角色不一致，未保存')}
  }
  async function capture(request,report){
    identities(request,report);
    var frozen=clone({version:1,request:request,report:report,recordedAtUtc:new Date().toISOString()});
    frozen.hash=await digest(payload(frozen));return frozen;
  }
  async function valid(record){try{identities(record.request,record.report);return record.version===1&&/^[a-f0-9]{64}$/.test(record.hash)&&record.hash===await digest(payload(record))}catch{return false}}
  function list(extra){return extra&&Array.isArray(extra[key])?extra[key]:[]}
  function append(extra,record){
    var existing=list(extra);if(existing.some(r=>r.hash===record.hash))return extra;
    return Object.assign({},extra,{[key]:existing.concat([clone(record)])});
  }
  root.ChoreoSkillRecords={capture,valid,list,append};
})(typeof window!=='undefined'?window:globalThis);
