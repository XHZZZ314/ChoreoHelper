// 日常连接快照与结果保存：只读检查身份，结果写入原项目且等待持久化，不恢复执行许可。
// R4：保存前逐事件/分段/技能身份与结果完整性校验——计划是唯一权威；缺失证据标为未知，绝不伪装未分发。
(function(root){
  'use strict';
  function must(v,m){if(!v)throw Error(m)}
  function isObj(v){return !!v&&typeof v==='object'}
  // R4-ID：身份字段合法线格式＝标量（EventId 字符串；ActorId 数值或数字串），数组/对象/布尔不得经 String() 强转混入。
  function idScalar(v){return (typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.length>0)}
  function fromLog(r){return {id:r.id,kind:r.kind||'',plannedMs:r.plannedMs,dispatchedMs:r.dispatchedMs,ok:r.ok===true,reason:r.reason||'',
    skipped:r.skipped===true,skipClass:r.skipClass||'',skipMarking:r.skipMarking||'',evidenceState:r.evidenceState||'',
    evidenceReason:r.evidenceReason||'',evidenceMonoMs:r.evidenceMonoMs||0,abilityAttempt:r.abilityAttempt??null};}
  function fromOutcome(id,e){var o=e.outcome||{};return {id:id,kind:o.Kind||e.kind||'',plannedMs:e.plannedMs,dispatchedMs:o.DispatchedShowMs,
    ok:o.Ok===true,reason:o.Reason||'',skipped:o.Skipped===true,skipClass:o.SkipClass||'',skipMarking:o.SkipMarking||'',
    evidenceState:o.EvidenceState||'',evidenceReason:o.EvidenceReason||'',evidenceMonoMs:o.EvidenceMonoMs||0,abilityAttempt:o.AbilityAttempt??null};}
  function result(request,snapshot){
    must(request,'此页面没有本项目的路径请求；历史记录只读，不恢复执行许可');
    must(request.instanceId===snapshot.caps.pluginInstanceId,'插件已重载，本次结果已不可读取；不能采用旧结果或伪造恢复');
    var show=snapshot.show,input=snapshot.input,report=input.coordinateFeedback?.lastReport,mapping=show.stageMapping;
    must(!snapshot.busy&&!input.coordinateFeedback?.active,'执行仍在进行，尚无可保存的本场结果');
    var complete=Array.isArray(show.events)&&typeof show.startId==='string'&&show.startId.length>0;
    must(mapping&&mapping.sourcePackageId===request.packageId&&mapping.sourceClientLoadId===request.clientLoadId&&
      (complete ? show.packageId===mapping.packageId&&show.clientLoadId===mapping.clientLoadId : report&&report.Path?.PackageId===mapping.packageId&&report.Path?.ClientLoadId===mapping.clientLoadId),
      '本次尚未完成或结果身份不匹配；不采用旧结果');
    if(complete && (!report||report.Path?.PackageId!==mapping.packageId||report.Path?.ClientLoadId!==mapping.clientLoadId))
      report={Status:show.stopReason||'本场未产生路径观测',Completed:false,Path:null};
    must(!show.projectId||show.projectId===request.projectId,'结果所属项目不匹配，未保存');
    // 逐事件计划是身份权威：缺少或重复事件身份直接拒绝，不进入保存。
    var planned=Array.isArray(show.events)?show.events:null,byId={};
    if(planned)planned.forEach(function(e){
      must(isObj(e)&&typeof e.id==='string'&&e.id.length>0,'本场计划存在缺少身份的事件，结果不完整，未保存');
      must(!byId[e.id],'本场计划存在重复事件身份「'+e.id+'」，结果不完整，未保存');
      byId[e.id]=e;
    });
    var reviewActor=request.review&&request.review.actor&&request.review.actor.id;
    function bindEvidence(entry){
      must(isObj(entry)&&typeof entry.id==='string'&&entry.id.length>0,'执行证据缺少事件身份，未保存');
      must(byId[entry.id],'执行证据包含不在本场计划内的事件「'+entry.id+'」，未保存');
      var plan=byId[entry.id];
      if(complete)must(plan.dispatched===true,'执行证据与事件分发标记矛盾，未保存');
      if(entry.kind&&plan.kind&&entry.kind!==plan.kind)
        throw Error('执行证据事件「'+entry.id+'」类型与计划「'+plan.kind+'」不符，未保存');
      var attempt=entry.abilityAttempt;
      if(attempt!==null&&attempt!==undefined){
        must(isObj(attempt)&&!Array.isArray(attempt)&&isObj(attempt.Identity)&&!Array.isArray(attempt.Identity),'技能回执缺少有效身份，未保存');
        must(typeof attempt.Identity.EventId==='string'&&idScalar(attempt.Identity.ActorId),'技能回执身份字段格式无效，未保存');
        must(plan.kind==='ability','技能回执不对应本场已声明的技能事件「'+entry.id+'」，未保存');
        must(attempt.Identity.EventId===entry.id,'技能回执身份「'+attempt.Identity.EventId+'」与事件「'+entry.id+'」不符，未保存');
        if(reviewActor!==undefined&&reviewActor!==null&&reviewActor!=='')
          must(String(attempt.Identity.ActorId)===String(reviewActor),'技能回执角色与本次审阅角色不符，未保存');
      }
    }
    // 路径分段结果：绑定到本场已声明的 movement 事件；重复或未声明一律拒绝。
    var reports=input.coordinateFeedback&&input.coordinateFeedback.reports,seen={};
    if(reports!==undefined)must(Array.isArray(reports),'路径分段结果格式无效，未保存');
    (reports||[]).forEach(function(r){
      must(isObj(r&&r.Path),'路径分段结果缺少身份，未保存');
      must(r.Path.PackageId===mapping.packageId&&r.Path.ClientLoadId===mapping.clientLoadId,'路径分段结果串场，未保存');
      var id=r.Path.EventId;
      must(typeof id==='string'&&id.length>0,'路径分段结果缺少事件身份，未保存');
      must(!seen[id],'路径分段结果重复「'+id+'」，未保存');seen[id]=true;
      if(planned)must(byId[id]&&byId[id].kind==='movement','路径分段结果不对应本场已声明的移动事件「'+id+'」，未保存');
      if(complete)must(byId[id].dispatched===true,'路径观测与事件未分发标记矛盾，未保存');
    });
    if(report&&report.Path){
      var rid=report.Path.EventId;
      must(typeof rid==='string'&&rid.length>0,'最后路径结果缺少事件身份，未保存');
      if(planned)must(byId[rid]&&byId[rid].kind==='movement','最后路径结果不对应本场已声明的移动事件「'+rid+'」，未保存');
      if(complete)must(byId[rid].dispatched===true,'最后路径观测与事件未分发标记矛盾，未保存');
    }
    var recent=Array.isArray(show.recentLog)?show.recentLog:[];
    if(planned){
      recent.forEach(function(r){if(isObj(r))bindEvidence(fromLog(r))});
      planned.forEach(function(e){if(isObj(e)&&isObj(e.outcome))bindEvidence(fromOutcome(e.id,e))});
    }
    var results;
    if(complete&&planned){
      var flagged=planned.filter(function(e){return e.dispatched===true}).length,disp=show.dispatched;
      // runner 每次 Dispatch 返回后计数一次（含拒绝/跳过）；活动更新不增加分发数。
      must(planned.every(function(e){return typeof e.dispatched==='boolean'})&&Number.isInteger(disp)&&disp>=0&&disp===flagged,
        '本场分发总数与逐事件分发标记矛盾，结果不完整，未保存');
      results=planned.map(function(e){
        var found=null;
        for(var i=recent.length-1;i>=0;i--)if(recent[i]&&recent[i].id===e.id){found=fromLog(recent[i]);break}
        if(!found&&isObj(e.outcome))found=fromOutcome(e.id,e);
        if(found)return found;
        if(e.dispatched===false)
          return {id:e.id,kind:e.kind,plannedMs:e.plannedMs,dispatchedMs:null,notDispatched:true,reason:'本场停止前未分发'};
        return {id:e.id,kind:e.kind,plannedMs:e.plannedMs,dispatchedMs:null,evidenceMissing:true,
          reason:'插件日志未包含该事件的执行证据，效果未知（不伪造未分发）'};
      });
    }else results=complete?[]:recent;
    if(show.events)must(typeof show.startId==='string'&&show.startId&&show.packageId===mapping.packageId&&show.clientLoadId===mapping.clientLoadId,'尚未明确开始或场次身份不符');
    var reportList=(reports!==undefined)?reports:(report&&report.Path?[report]:[]);
    if(complete)reportList=planned.filter(function(e){return e.kind==='movement'}).map(function(e){
      var observed=reportList.find(function(r){return r.Path&&r.Path.EventId===e.id});
      if(observed)return observed;
      // 缺失项只保存声明身份及证据状态，不伪造观测、完成或距离。
      var missing={Path:{PackageId:mapping.packageId,ClientLoadId:mapping.clientLoadId,EventId:e.id}};
      if(e.dispatched===false){missing.notDispatched=true;missing.Status='本段未分发，无路径观测';}
      else{missing.evidenceMissing=true;missing.Status='本段路径观测缺失，结果未知';}
      return missing;
    });
    return {version:2,savedAt:new Date().toISOString(),packageId:request.packageId,clientLoadId:request.clientLoadId,
      instanceId:request.instanceId,review:request.review,mapping,report,
      reports:JSON.parse(JSON.stringify(reportList)),startId:show.startId||'',
      showResult:{state:show.state,stopReason:show.stopReason,cleanupFailed:show.cleanupFailed,showTimeMs:show.showTimeMs,
        events:JSON.parse(JSON.stringify(results)),
        dispatched:show.dispatched,remaining:show.remaining,skipped:show.skipped}};
  }
  function has(records,request){return records.some(r=>r.packageId===request.packageId&&(!r.clientLoadId||r.clientLoadId===request.clientLoadId))}
  function createSaver(){
    var saving=false;
    return async function(options){
      must(!saving,'结果正在保存，请勿重复操作');saving=true;
      try{
        options.current();var s=options.store,request=options.request;
        must(request?.projectId===s.projectId,'当前项目与结果项目不一致，未保存');
        var record=result(request,options.snapshot),old=s.contentExtra?.stagePathRecords||[];
        var next=has(old,request)?old:old.concat([record]);
        // 同步捕获生产序列化文档；异步完成后绝不把旧项目内容写进新的活动项目。
        s.contentExtra=Object.assign({},s.contentExtra,{stagePathRecords:next});
        var frozen=options.projectRecord();
        must(frozen.id===request.projectId,'保存目标已变化');
        var outcome=await options.saveActive(frozen);
        must(outcome!==false,'保存失败：项目数据库未确认写入。结果仍保留在本页，请重试保存');
        options.current();
        return {projectId:frozen.id,projectName:frozen.name,duplicate:next===old};
      } finally{saving=false}
    };
  }
  root.ChoreoStageRecovery={result,has,createSaver};
})(typeof window!=='undefined'?window:globalThis);
