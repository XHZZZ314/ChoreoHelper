// 单人有界游戏计划：仅转换明确的原始轨道与舞台映射；审阅不修改项目、不恢复执行许可。
// TASK-20260919-PATH-LOCOMOTION：移动节点逐个带走/跑模式（缺省走）；打包按节点推导 locomotion，不再整场统一申报。
(function(root){
  'use strict';
  var P=root.ChoreoStageMotion;
  // 社区实测参考上限（非官方数）：跑≈6 米/秒、走≈2 米/秒。仅作审阅提示不阻断；游戏运行时到达容差才是硬闸。
  var WALK_REF_MAX_MPS=2,RUN_REF_MAX_MPS=6;
  function must(v,m){if(!v)throw Error(m)}
  function copy(v){return JSON.parse(JSON.stringify(v))}
  function review(s,di,base,actor,yawDeg){
    var dancer=s.dancers[di],who=P.pid(s,di);
    must(dancer&&who,'请选择现有舞者');
    must(actor&&/^[1-9][0-9]*$/.test(actor.id)&&Number.isSafeInteger(actor.territoryId)&&actor.territoryId>0,'当前游戏角色不可读');
    must([actor.worldX,actor.worldZ,actor.rotationRad,base.x,base.z,base.yawDeg,yawDeg].every(Number.isFinite),'角色或舞台坐标无效');
    var tracks=P.tracks(s).filter(t=>t.performerId===who&&t.enabled!==false);
    must(!tracks.some(t=>['movement','facing'].includes(t.type)&&!P.owned(t)&&(t.events||[]).some(e=>e.enabled!==false)),'存在其他走位或朝向轨道，不能省略或合并');
    var nodes=P.nodes(s,di),movement=tracks.find(t=>P.owned(t)&&t.type==='movement');
    must(nodes.movement.length&&movement&&movement.events[0].enabled!==false,'没有启用的路径');
    var a=yawDeg*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
    var originX=actor.worldX-base.x*c-base.z*sn,originZ=actor.worldZ+base.x*sn-base.z*c;
    // 路点朝向按朝向轨在到达时刻采样显示：路径方向与角色独立朝向是两回事，游戏执行只采纳路径。
    var points=[{tMs:0,x:base.x,z:base.z,yawDeg:base.yawDeg}].concat(nodes.movement.map(p=>{var tMs=Number(p.time)*1000;return {tMs,x:Number(p.x),z:Number(p.z),yawDeg:P.sample(s,di,tMs,base).yawDeg,move:p.move==='run'?'run':'walk'}}));
    var distance=0,segments=[];
    points.forEach((p,i)=>{
      p.worldX=originX+p.x*c+p.z*sn;p.worldZ=originZ-p.x*sn+p.z*c;
      must([p.worldX,p.worldZ].every(Number.isFinite),'舞台映射超出范围');
      if(!i)return;var prev=points[i-1],d=Math.hypot(p.x-prev.x,p.z-prev.z),seconds=(p.tMs-prev.tMs)/1000;
      distance+=d;segments.push({startMs:prev.tMs,endMs:p.tMs,distanceM:d,speedMps:d/seconds,bearingDeg:d?Math.atan2(p.worldX-prev.worldX,p.worldZ-prev.worldZ)*180/Math.PI:null,turnDegPerSecond:(p.yawDeg-prev.yawDeg)/seconds,move:p.move});
    });
    // 速度矛盾提示（明确不静默）：模式隐含速度超过该档社区实测参考上限时逐段提示；到点不追赶，运行时以到达容差失败告终。
    var gaitWarnings=[];segments.forEach((sg,i)=>{var cap=sg.move==='run'?RUN_REF_MAX_MPS:WALK_REF_MAX_MPS;
      if(sg.speedMps>cap)gaitWarnings.push('第'+(i+1)+'段按'+(sg.move==='run'?'跑步':'走路')+'要求 '+sg.speedMps.toFixed(2)+' 米/秒，超过该档社区实测参考上限（约 '+cap+' 米/秒）：游戏内大概率无法按时到达，将以到达容差失败结束本场。可加长该段到达时刻、缩短距离，或把该节点改为跑步。')});
    var warnings=['这是单条路径的有界验收计划，普通动作、技能和独立朝向不进入本次试验；原编排全部保留。','游戏身体朝向可能随移动改变，不保证填写的朝向、独立原地转身或转角时序。','仅短直线已有实测；折线、各段速度与转角均须单独验收。到点不追赶，不改速、不延时、不循环，失败立即停止。'];
    return copy({version:1,projectId:s.projectId,performerId:who,dancerName:dancer.name,eventId:movement.events[0].id,
      actor,stage:{id:'stage-'+who,originX,originZ,yawDeg},points,segments,gaitWarnings,distanceM:distance,durationMs:movement.events[0].durationMs,warnings});
  }
  function packageFor(r,options){
    must(options&&options.pathOnly===true,'必须明确选择仅验收此路径，不能当作整场或朝向执行');
    must(r.durationMs>0&&r.durationMs<=4000&&r.distanceM>0&&r.distanceM<=1.5&&r.points.length<=256,'路径限 4 秒 / 1.5 米 / 256 点；不能自动裁剪或重定时');
    must(options.arrivalToleranceM>=.025&&options.arrivalToleranceM<=.12&&Number.isFinite(options.maxCorrectionM)&&options.maxCorrectionM>0,'请明确原始到达容差和修正界；容差限0.025至0.12米');
    // 单一执行段只承载一个步态：仅路径范围不支持走/跑混合，须统一模式或改整场（逐段自动切换）。
    var modes=new Set(r.points.slice(1).map(p=>p.move==='run'?'run':'walk'));
    must(modes.size<=1,'仅路径范围是一条单一执行段，不能混用走路/跑步；请把各节点统一为同一模式，或改用整场范围（按节点逐段自动切换步态）');
    var locomotion=modes.has('run')?'run':'walk';
    var e={id:r.eventId,performerId:r.performerId,kind:'movement',startMs:0,durationMs:r.durationMs,command:'',name:'有界路径验收',playMode:'',
      x1:{version:1,failurePolicy:'stopShow',points:r.points.map(p=>({tMs:p.tMs,x:p.x,z:p.z})),locomotion,arrivalToleranceM:options.arrivalToleranceM,maxCorrectionM:options.maxCorrectionM}};
    var pkg={protocolVersion:1,compiler:'stage-path-review-v1',projectId:r.projectId,name:r.dancerName+' · 单路径验收',durationMs:r.durationMs,timelineRevision:0,projectHash:'',
      performers:[{id:r.performerId,name:r.dancerName}],events:[e],capabilities:[{name:'x1-input-v1',minProtocol:1},{name:'movement-control',minProtocol:1}],
      x1:{version:1,bindings:[{performerId:r.performerId,actorId:r.actor.id,territoryId:r.actor.territoryId,stage:copy(r.stage)}]}};
    root.ChoreoX1Inputs&&root.ChoreoX1Inputs.validatePackage(pkg.x1,pkg.events);return pkg;
  }
  var api={review,packageFor};root.ChoreoStageGamePlan=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
