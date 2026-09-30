// 舞台走位与朝向：规范双轨编辑和绝对时刻采样，不持有时钟、不输出游戏输入。
// 移动节点可带跑步标记（move:'run'，缺省=走路，旧数据天然迁移）；仅供游戏执行按段选择步态，采样与预览不区分。
(function(root){
  'use strict';
  var TAG='choreo-stage-motion-v1';
  function copy(v){return JSON.parse(JSON.stringify(v))}
  function must(ok,msg){if(!ok)throw Error(msg)}
  function tracks(s){return s.contentExtra&&s.contentExtra._doc&&s.contentExtra._doc.extraTracks||[]}
  function pid(s,i){var d=s.dancers[i],ids=s.contentExtra&&s.contentExtra._doc&&s.contentExtra._doc.performerIds;return d?(ids&&ids[String(d.id)]||'actor-'+d.id):null}
  function owned(t){return !!t&&t.createdWith===TAG&&['movement','facing'].includes(t.type)}
  function rows(s){return tracks(s).filter(owned)}
  function snapshot(s){return copy(rows(s))}
  function install(s,all){s.contentExtra=s.contentExtra||{};s.contentExtra._doc=s.contentExtra._doc||{};s.contentExtra._doc.extraTracks=all}
  function restore(s,saved){if(!rows(s).length&&!(saved||[]).length)return;install(s,tracks(s).filter(t=>!owned(t)).concat(copy(saved||[])))}
  function number(v,label){must(typeof v==='string'&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(v),label+'须为数字，最多三位小数');var n=Number(v);must(Number.isFinite(n)&&Math.abs(n)<=10000,label+'超出范围（±10000）');return n}
  function readNodes(t,kind){var e=t.events[0],p=e.data&&e.data.stageMotion;
    must(p&&p.version===1&&p.fromStart===true&&Array.isArray(p.points)&&p.points.length,'走位版本或节点不完整，不能覆盖');
    must(e.kind===kind&&e.startMs===0&&valid(e,[{tMs:0,x:0,z:0,yawDeg:0}].concat(p.points),kind==='movement'?['x','z']:['yawDeg']),'已有走位时序或节点损坏，保留原数据，不自动修复');
    // TASK-20260919-PATH-LOCOMOTION：移动节点可带跑步标记（move:'run'），缺省=走路（旧数据天然迁移）；仅 'run' 合法。
    if(kind==='movement')must(p.points.every(p2=>p2.move===undefined||p2.move==='run'),'路径节点移动模式字段损坏（仅支持跑步标记），保留原数据，不自动修复');
    return p.points.map(p2=>kind==='movement'?{time:String(p2.tMs/1000),x:String(p2.x),z:String(p2.z),...(p2.move==='run'?{move:'run'}:{})}:{time:String(p2.tMs/1000),yaw:String(p2.yawDeg)})}
  function nodes(s,di){
    var own=rows(s).filter(t=>t.performerId===pid(s,di)),m=own.find(t=>t.type==='movement'),f=own.find(t=>t.type==='facing');
    if(!m&&!f)return {movement:[],facing:[]};
    // 路径与朝向是两条独立轨道：各自时刻严格递增即可，不再强制 1:1 同刻配对（旧等时数据仍是合法特例）。
    must(own.length===(m?1:0)+(f?1:0),'走位轨道存在重复或不完整数据，已保留，请先检查原事件');
    return {movement:m?readNodes(m,'movement'):[],facing:f?readNodes(f,'facing'):[]};
  }
  function parseRows(list,kind){var last=0,labels=kind==='movement'?{x:'X',z:'Z'}:{yaw:'朝向'};
    return list.map(v=>{var sec=number(v.time,'到达时刻'),t=Math.round(sec*1000);must(t>last,'到达时刻须大于零并严格递增；不会自动排序或改变时序');last=t;
      var out={tMs:t};Object.keys(labels).forEach(k=>out[k]=number(v[k],labels[k]));
      // 移动模式：仅 'run' 入库；'walk'/缺省=走路（不入键）；其他值明确拒绝不猜测。
      if(kind==='movement'&&v.move!==undefined){must(v.move==='run'||v.move==='walk','移动模式仅支持「跑步」或「走路」');if(v.move==='run')out.move='run'}
      return out})}
  function edit(s,di,values,id){
    var who=pid(s,di);must(who,'舞者已不存在');nodes(s,di);
    must(values&&Array.isArray(values.movement)&&Array.isArray(values.facing),'须分别提供路径节点与朝向节点列表，不能猜测');
    must(values.movement.length<=500&&values.facing.length<=500,'最多 500 个节点');
    var parsed={movement:parseRows(values.movement,'movement'),facing:parseRows(values.facing,'facing')};
    must(!tracks(s).some(t=>!owned(t)&&t.performerId===who&&['movement','facing'].includes(t.type)&&t.enabled!==false&&(t.events||[]).some(e=>e.enabled!==false)),'此舞者已有其他走位或朝向轨道，保留原事件，不能叠加第二条路径');
    var all=copy(tracks(s));
    ['movement','facing'].forEach(kind=>{
      var kindRows=parsed[kind],existing=all.filter(t=>owned(t)&&t.type===kind&&t.performerId===who),t=existing[0];
      must(existing.length<=1,'轨道重复，不能覆盖');
      if(t)must(!t.locked&&t.enabled!==false&&t.events.length===1&&!t.events[0].locked&&t.events[0].enabled!==false,'轨道已锁定或停用，不能覆盖');
      if(!kindRows.length){if(t)all.splice(all.indexOf(t),1);return}
      if(!t){t={id:id+'-'+kind,type:kind,performerId:who,enabled:true,locked:false,notes:'',createdWith:TAG,events:[]};must(!all.some(x=>x.id===t.id),'轨道 ID 冲突');all.push(t)}
      var e=t.events[0]||{id:id+'-'+kind+'-event',kind,enabled:true,locked:false,notes:'',createdWith:TAG};
      must(!all.some(x=>(x.events||[]).some(y=>y.id===e.id&&y!==t.events[0])),'事件 ID 重复，不能覆盖');
      e.startMs=0;e.durationMs=kindRows[kindRows.length-1].tMs;
      e.data=Object.assign({},e.data,{stageMotion:Object.assign({},e.data&&e.data.stageMotion,{version:1,fromStart:true,points:kindRows.map(p=>kind==='movement'?{tMs:p.tMs,x:p.x,z:p.z,...(p.move==='run'?{move:'run'}:{})}:{tMs:p.tMs,yawDeg:p.yaw})})});t.events=[e];
    });return all;
  }
  function enabled(s,di){var d=s.dancers[di];return d&&!d.mute&&(!s.dancers.some(x=>x.solo)||d.solo)}
  function points(e,kind,base){
    var p=e.data&&e.data.stageMotion;
    if(p&&p.version===1&&p.fromStart===true)return [Object.assign({tMs:0},kind==='movement'?{x:base.x,z:base.z}:{yawDeg:base.yawDeg})].concat(p.points||[]);
    // 已有正式 X1 草稿可按其明确输入排练；不推导游戏绑定或开启执行。
    var x=e.x1;
    if(x&&x.version===1){if(kind==='movement')return x.points;if(x.mode==='fixedAngle')return [{tMs:0,yawDeg:x.fixedAngleDeg},{tMs:e.durationMs,yawDeg:x.fixedAngleDeg}];if(x.mode==='transition')return [{tMs:0,yawDeg:x.transitionFromDeg},{tMs:e.durationMs,yawDeg:x.transitionToDeg}]}
    return null;
  }
  function valid(e,ps,keys){return Number.isSafeInteger(e.startMs)&&e.startMs>=0&&Number.isSafeInteger(e.durationMs)&&e.durationMs>0&&Array.isArray(ps)&&ps.length>=2&&ps[0].tMs===0&&ps[ps.length-1].tMs===e.durationMs&&ps.every((p,i)=>p&&Number.isSafeInteger(p.tMs)&&p.tMs>=0&&(!i||p.tMs>ps[i-1].tMs)&&keys.every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=10000))}
  function sample(s,di,time,base){
    var out=Object.assign({},base);if(!Number.isFinite(time)||!enabled(s,di))return out;
    var who=pid(s,di);
    ['movement','facing'].forEach(kind=>{
      var keys=kind==='movement'?['x','z']:['yawDeg'],events=[];
      tracks(s).filter(t=>t.type===kind&&t.performerId===who&&t.enabled!==false).forEach(t=>(t.events||[]).forEach(e=>{var ps=points(e,kind,base);if(e.kind===kind&&e.enabled!==false&&valid(e,ps,keys))events.push({e,ps})}));
      events.sort((a,b)=>a.e.startMs-b.e.startMs);
      events.forEach(({e,ps})=>{if(time<e.startMs)return;var t=Math.min(time-e.startMs,e.durationMs),b=ps.findIndex(p=>p.tMs>=t);if(b<1)b=1;var a=ps[b-1],z=ps[b],u=Math.max(0,Math.min(1,(t-a.tMs)/(z.tMs-a.tMs)));keys.forEach(k=>out[k]=a[k]+(z[k]-a[k])*u);out.stageMotion=true});
    });return out;
  }
  function end(s){return tracks(s).filter(t=>['movement','facing'].includes(t.type)&&t.enabled!==false).reduce((n,t)=>(t.events||[]).reduce((n,e)=>e.enabled!==false&&Number.isSafeInteger(e.startMs)&&Number.isSafeInteger(e.durationMs)?Math.max(n,(e.startMs+e.durationMs)/1000):n,n),0)}
  function blocksGame(s,di){return tracks(s).some(t=>['movement','facing'].includes(t.type)&&t.enabled!==false&&(di===undefined||t.performerId===pid(s,di))&&(t.events||[]).some(e=>e.enabled!==false))}
  function rootTranslation(b,p,active){return active&&b&&b.p<0?Object.assign({},p,{tx:b.t[0],tz:b.t[2]}):p}
  function extentPoints(s,di,base){var out=[base];tracks(s).filter(t=>t.type==='movement'&&t.performerId===pid(s,di)&&t.enabled!==false).forEach(t=>(t.events||[]).forEach(e=>{var ps=points(e,'movement',base);if(e.enabled!==false&&valid(e,ps,['x','z']))out=out.concat(ps)}));return out}
  function metrics(s,di,base){var values=nodes(s,di),prev={tMs:0,x:base.x,z:base.z},distance=0,speedSegments=[];
    values.movement.forEach(v=>{var tMs=Number(v.time)*1000,x=Number(v.x),z=Number(v.z),seconds=(tMs-prev.tMs)/1000,d=Math.hypot(x-prev.x,z-prev.z);distance+=d;speedSegments.push({distanceM:d,speedMps:d/seconds,move:v.move==='run'?'run':'walk'});prev={tMs,x,z}});
    var fprev={tMs:0,yawDeg:base.yawDeg},turnSegments=values.facing.map(v=>{var tMs=Number(v.time)*1000,yawDeg=Number(v.yaw),seconds=(tMs-fprev.tMs)/1000,rate=(yawDeg-fprev.yawDeg)/seconds;fprev={tMs,yawDeg};return {turnDegPerSecond:rate}});
    return {distanceM:distance,movementDurationMs:prev.tMs,facingDurationMs:fprev.tMs,speedSegments,turnSegments,exceedsNativeTrial:distance>1.5||prev.tMs>4000};
  }
  var api={TAG,tracks,pid,owned,rows,snapshot,install,restore,nodes,edit,sample,end,blocksGame,rootTranslation,extentPoints,metrics};root.ChoreoStageMotion=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
