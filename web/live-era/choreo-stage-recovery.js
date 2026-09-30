// 日常连接快照与结果保存：只读检查身份，结果写入原项目且等待持久化，不恢复执行许可。
(function(root){
  'use strict';
  function must(v,m){if(!v)throw Error(m)}
  function result(request,snapshot){
    must(request,'此页面没有本项目的路径请求；历史记录只读，不恢复执行许可');
    must(request.instanceId===snapshot.caps.pluginInstanceId,'插件已重载，本次结果已不可读取；不能采用旧结果或伪造恢复');
    var show=snapshot.show,input=snapshot.input,report=input.coordinateFeedback?.lastReport,mapping=show.stageMapping;
    must(!snapshot.busy&&!input.coordinateFeedback?.active,'执行仍在进行，尚无可保存的本场结果');
    must(report&&mapping&&mapping.sourcePackageId===request.packageId&&mapping.sourceClientLoadId===request.clientLoadId&&
      report.Path?.PackageId===mapping.packageId&&report.Path?.ClientLoadId===mapping.clientLoadId,
      '本次尚未完成或结果身份不匹配；不采用旧结果');
    must(!show.projectId||show.projectId===request.projectId,'结果所属项目不匹配，未保存');
    return {version:1,savedAt:new Date().toISOString(),packageId:request.packageId,clientLoadId:request.clientLoadId,
      instanceId:request.instanceId,review:request.review,mapping,report,
      showResult:{state:show.state,stopReason:show.stopReason,cleanupFailed:show.cleanupFailed,showTimeMs:show.showTimeMs,events:JSON.parse(JSON.stringify(show.recentLog||[])),dispatched:show.dispatched,remaining:show.remaining,skipped:show.skipped}};
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
