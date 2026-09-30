// 演出结果复盘（只读）：消费已保存的 stagePathRecords——逐事件对照计划与实际分发、走位指标、审阅快照回看与手动模式；
// 可按事件时刻定位网页编排预览（回放的是编排数据，不是游戏实况录像）。不恢复执行许可、不触发任何游戏输出、不写项目与历史。
(function(root){
  'use strict';
  var STATE={idle:'尚未登记',loaded:'已登记，尚未开始',armed:'已就绪',countdown:'倒数中',playing:'执行中',completed:'本场已结束',faulted:'已停止，发生失败',stopping:'正在停止'};
  function num(v){if(v===null||v===undefined)return null;v=Number(v);return Number.isFinite(v)?v:null}
  function classifyEvent(e){
    if(e&&e.notDispatched===true)return{code:'pending',label:'未分发'};
    if(e&&e.evidenceMissing===true)return{code:'unknown',label:'证据缺失（效果未知）'};
    if(e&&e.skipped===true)return{code:'skip',label:'已跳过'};
    if(e&&e.ok===true)return{code:'ok',label:'已提交（效果未确认）'};
    return{code:'fail',label:'失败'};
  }
  // 逐事件对照：计划时刻 vs 实际分发时刻（到点偏差）、执行/跳过/失败分类与原因；日志截断如实说明，不伪造补齐。
  function eventRows(record){
    var list=record&&record.showResult&&Array.isArray(record.showResult.events)?record.showResult.events:null;
    if(!list||!list.length)return{rows:[],notes:['该记录未保存逐事件结果日志（旧版保存或保存时无日志），不伪造补齐。']};
    var rows=list.map(function(e){
      var c=classifyEvent(e),p=num(e&&e.plannedMs),d=num(e&&e.dispatchedMs);
      return{id:e&&e.id||'(缺身份)',kind:e&&e.kind||'',plannedMs:p,dispatchedMs:d,
        deltaMs:p!==null&&d!==null?d-p:null,cls:c.code,clsLabel:c.label,
        reason:e&&e.reason||'',skipped:e&&e.skipped===true,ok:e&&e.ok===true,skipClass:e&&e.skipClass||''};
    });
    var notes=[],disp=num(record.showResult.dispatched),skip=num(record.showResult.skipped);
    if(record.version<2&&disp!==null&&skip!==null&&disp+skip>rows.length || record.version===undefined&&disp!==null&&skip!==null&&disp+skip>rows.length)
      notes.push('插件日志仅保留尾部 '+rows.length+' 条（本场分发/跳过共 '+(disp+skip)+' 条），早期 '+(disp+skip-rows.length)+' 条未存入记录；不伪造补齐。');
    return{rows:rows,notes:notes};
  }
  // 审阅快照回看：当时逐条受支持/排除的判定与原因，和实际结果并列；原始路径行并上全部切分段。
  function mergeReview(record){
    var whole=record&&record.review&&record.review.whole;
    if(!whole||!Array.isArray(whole.rows))return{pairs:[],notes:['该记录未保存整场审阅快照（仅路径计划或旧版保存）；无法对照当时的受支持/排除清单。']};
    var events=record&&record.showResult&&Array.isArray(record.showResult.events)?record.showResult.events:[];
    var pairs=whole.rows.map(function(row){
      var e=row&&row.event||{},id=String(e.id||'(缺身份)');
      var hits=events.filter(function(x){
        if(!x||String(x.id||'')!==id)return false;
        return true;
      });
      if(e.kind==='movement')hits=events.filter(function(x){return x&&x.kind==='movement'&&(String(x.id)===id||String(x.id).indexOf(id+'-s')===0)});
      return{id:id,kind:e.kind||'',startMs:num(e.startMs),durationMs:num(e.durationMs),name:e.name||e.command||'',
        supported:row.supported===true,reviewReason:row.reason||'',
        results:hits.map(function(x){return{id:x.id,plannedMs:num(x.plannedMs),dispatchedMs:num(x.dispatchedMs),clsLabel:classifyEvent(x).label,reason:x.reason||''}})};
    });
    return{pairs:pairs,notes:[]};
  }
  // 走位指标：计划路程 vs 实际累计距离、终点误差、（多段时）逐段计划与执行段；缺字段降级说明，不推断。
  function movementMetrics(record){
    var rv=record&&record.review||{},rp=record&&record.report||{},notes=[];
    var reports=record&&record.reports;
    if(Array.isArray(reports)&&reports.length){rp=Object.assign({},rp,{TotalDistanceM:reports.every(r=>num(r.TotalDistanceM)!==null)?reports.reduce((n,r)=>n+r.TotalDistanceM,0):null});}
    var out={plannedDistanceM:num(rv.distanceM),actualDistanceM:num(rp.TotalDistanceM),endpointErrorM:num(rp.FinalDistanceToTargetM),
      maxTrackingErrorM:num(rp.MaxPathTrackingErrorM),arrivalToleranceM:num(rp.ArrivalToleranceM),
      completed:rp.Completed===true,status:rp.Status||null,
      segments:Array.isArray(rv.segments)?rv.segments.map(function(s){return{startMs:num(s.startMs),endMs:num(s.endMs),distanceM:num(s.distanceM),speedMps:num(s.speedMps),bearingDeg:s.bearingDeg===undefined?null:s.bearingDeg}}):[],
      segmentCount:rv.whole&&num(rv.whole.segmentCount)!==null?rv.whole.segmentCount:null,notes:notes};
    out.segmentReports=Array.isArray(reports)?reports:[];
    if(out.plannedDistanceM===null)notes.push('计划路程未存入该记录。');
    if(out.actualDistanceM===null)notes.push('实际累计距离未存入该记录（旧版保存或中止），不推断。');
    if(out.endpointErrorM===null)notes.push('终点误差未存入该记录。');
    return out;
  }
  function manualInfo(report){
    if(!report||!report.ManualMode)return null;
    return{mode:report.ManualMode==='Cooperate'?'手动与自动协同（Cooperate）':report.ManualMode==='Interrupt'?'手动打断自动（Interrupt）':String(report.ManualMode),
      interventions:num(report.ManualInterventions),resumptions:num(report.ManualResumptions)};
  }
  // 真实结果与自动化合成夹具明确区分：夹具记录带 synthetic:true（测试数据侧同样标注）。
  function sourceLabel(record){
    return record&&record.synthetic===true
      ?'自动化合成夹具（非真实演出；仅证明保存/展示行为，不作为游戏效果证据）'
      :'插件报告快照（本页保存链写入；真实游戏效果须另行观察）';
  }
  function n(tag,text,parent){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}
  function ms(v){return v===null?'—':v+'ms'}
  function delta(v){return v===null?'—':(v>=0?'+':'')+v+'ms'}
  function m3(v){return v===null?'—':v.toFixed(3)+' 米'}
  function open(record){
    var s=root.store;
    var box=n('dialog');box.setAttribute('aria-label','演出复盘');
    box.style.cssText='width:min(880px,92vw);max-height:85vh;overflow:auto;background:#172131;color:#eef3ff;padding:20px;border:1px solid #71c9b4';
    n('h3','演出复盘（只读）',box);
    var whole=record&&record.review&&record.review.whole;
    n('p','保存时间 '+(record.savedAt||'—')+' · 舞者 '+(record.review&&record.review.dancerName||'—')+' · 项目 '+(whole&&whole.name||s&&s.projectName||'—')+' · 插件实例 '+(record.instanceId||'—'),box);
    n('p','来源：'+sourceLabel(record),box);
    if(whole&&num(whole.timelineRevision)!==null&&s&&num(s._docRev)!==null&&num(s._docRev)!==num(whole.timelineRevision))
      n('p','注意：保存后项目已有修改（时间轴修订号 '+whole.timelineRevision+' → '+s._docRev+'）；预览显示的是当前编排数据，与当时审阅可能不同。',box);
    var sr=record&&record.showResult||{};
    n('p','整场状态：'+(STATE[sr.state]||sr.state||'—')+(sr.stopReason?' · 停止原因：'+sr.stopReason:' · 正常完成，无异常停止')+' · 清理失败：'+(sr.cleanupFailed?'是':'否')+' · 演出时长 '+(num(sr.showTimeMs)!==null?sr.showTimeMs+'ms':'—'),box);

    n('h4','逐事件对照（计划时刻 vs 实际分发时刻）',box);
    var er=eventRows(record);
    if(er.rows.length){
      var table=n('table',undefined,box);table.style.cssText='border-collapse:collapse;width:100%;font-size:12px';
      var head=n('tr',undefined,table);
      ['事件','类型','计划','实际','到点偏差','结果','原因'].forEach(function(h){var c=n('th',h,head);c.style.cssText='border:1px solid #2c3d55;padding:3px 6px;text-align:left'});
      er.rows.forEach(function(r){
        var tr=n('tr',undefined,table);
        [r.id,r.kind,ms(r.plannedMs),ms(r.dispatchedMs),delta(r.deltaMs),r.clsLabel+(r.skipClass?'（'+r.skipClass+'）':''),r.reason].forEach(function(v){
          var c=n('td',v,tr);c.style.cssText='border:1px solid #2c3d55;padding:3px 6px'});
        var td=n('td',undefined,tr);td.style.cssText='border:1px solid #2c3d55;padding:3px 6px';
        if(r.plannedMs!==null){var b=n('button','定位',td);b.className='btn';b.type='button';b.onclick=function(){locate(r.plannedMs)}}
      });
    }
    er.notes.forEach(function(x){n('p',x,box)});

    n('h4','走位指标',box);
    var mm=movementMetrics(record);
    n('p','计划路程 '+m3(mm.plannedDistanceM)+' · 实际累计 '+m3(mm.actualDistanceM)+' · 终点误差 '+m3(mm.endpointErrorM)
      +(mm.maxTrackingErrorM!==null?' · 最大跟踪误差 '+m3(mm.maxTrackingErrorM):'')
      +(mm.arrivalToleranceM!==null?' · 到达容差 '+m3(mm.arrivalToleranceM):'')
      +(mm.segmentCount!==null&&mm.segmentCount>1?' · 自动切分 '+mm.segmentCount+' 段':''),box);
    if(mm.segments.length>1){
      n('p','原创分段计划（作者节点，非执行段）：'+mm.segments.map(function(g,i){return (i+1)+') '+(g.startMs!==null?g.startMs:'—')+'–'+(g.endMs!==null?g.endMs:'—')+'ms · '+m3(g.distanceM)+' · '+(g.speedMps!==null?g.speedMps.toFixed(3)+'米/秒':'—')}).join('；'),box);
    }
    var segEvents=er.rows.filter(function(r){return r.kind==='movement'});
    if(segEvents.length>1)n('p','执行段实际分发（自动切分段，到点不追赶）：'+segEvents.map(function(r){return r.id+' '+ms(r.plannedMs)+'→'+ms(r.dispatchedMs)+'（'+delta(r.deltaMs)+'·'+r.clsLabel+'）'}).join('；'),box);
    mm.segmentReports.forEach(function(r){n('p','路径段 '+(r.Path?.EventId||'缺身份')+'：'+r.Status+'；实际路程 '+m3(num(r.TotalDistanceM))+'；终点误差 '+m3(num(r.FinalDistanceToTargetM)),box)});
    n('p','技能/动作事件只显示提交与回执（上方 ok/reason），不代表游戏内效果；实际效果须另行观察。',box);
    mm.notes.forEach(function(x){n('p',x,box)});

    n('h4','审阅快照回看（当时判定 vs 实际结果）',box);
    var mr=mergeReview(record);
    mr.pairs.forEach(function(p){
      n('p',p.id+' · '+(p.kind||'—')+' · '+(p.startMs!==null?p.startMs+'ms':'—')+' / '+(p.durationMs!==null?p.durationMs+'ms':'—')
        +' · 审阅判定：'+(p.supported?'受支持':'已排除')+'（'+p.reviewReason+'）'
        +(p.results.length?' · 实际：'+p.results.map(function(r){return r.id+' '+ms(r.plannedMs)+'→'+ms(r.dispatchedMs)+' '+r.clsLabel+(r.reason?'（'+r.reason+'）':'')}).join('；'):' · 实际：未执行（审阅即排除，无分发记录）'),box);
    });
    mr.notes.forEach(function(x){n('p',x,box)});

    var mi=manualInfo(record&&record.report);
    if(mi){
      n('h4','手动模式',box);
      n('p',mi.mode+' · 介入 '+(mi.interventions!==null?mi.interventions:'—')+' 次 / 续走 '+(mi.resumptions!==null?mi.resumptions:'—')+' 次（来自保存的插件报告）',box);
    }
    n('p','预览定位：点上方“定位”把播放头移到该事件的编排时刻。回放的是编排数据，不是游戏实况录像；记录里没有游戏画面。',box);
    var seekStatus=n('p','',box);seekStatus.setAttribute('role','status');
    n('p','复盘为纯只读：不恢复执行许可、不触发任何游戏输出、不修改项目与历史记录、不写坐标。',box);
    var close=n('button','关闭',box);close.className='btn';close.type='button';close.onclick=function(){box.close()};
    box.onclose=function(){box.remove()};
    function locate(tMs){
      if(!root.store)return;
      if(root.store.previewTarget==='game'){seekStatus.textContent='当前是游戏预览模式；复盘不向游戏发送任何请求，请切回网页预览后再定位。';return}
      var t=tMs/1000;
      if(typeof root.seekTimelinePosition==='function')root.seekTimelinePosition(t);
      else root.store.currentTime=t;
      seekStatus.textContent='已定位到 '+t.toFixed(3)+' 秒（网页编排预览采样）；回放的是编排数据，不是游戏实况录像。';
    }
    document.body.appendChild(box);box.showModal();
  }
  root.ChoreoStageReplay={classifyEvent,eventRows,mergeReview,movementMetrics,manualInfo,sourceLabel,open};
})(typeof window!=='undefined'?window:globalThis);
