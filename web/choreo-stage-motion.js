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
  // ---------- B5 表 A 时间变换纯函数（唯一归属；输入/输出都是本模块 edit 认的值列表） ----------
  // 精度分层：作者坐标与算法锚点统一三位小数（number() 口径）；节点字节未动区精确、含锚点边界 ≤1mm。
  function fmtQ(v){var n=Math.round(Number(v)*1000)/1000;return String(n===0?0:n)}
  function parseList(list,kind){return (list||[]).map(v=>kind==='movement'
    ?{t:Number(v.time),x:Number(v.x),z:Number(v.z),...(v.move==='run'?{move:'run'}:{})}
    :{t:Number(v.time),yaw:Number(v.yaw)})}
  function sameSpot(a,b,kind){return kind==='movement'?Math.abs(a.x-b.x)<1e-9&&Math.abs(a.z-b.z)<1e-9:Math.abs(a.yaw-b.yaw)<1e-9}
  // 统一同刻规则：全维度同位→合并（先到对象优先，run 标志可后补）；任一维异位→拒绝。
  function unifyList(nodes,kind){
    var sorted=nodes.slice().sort((a,b)=>a.t-b.t),res=[];
    for(var i=0;i<sorted.length;i++){
      var n=sorted[i],last=res[res.length-1];
      if(last&&Math.abs(last.t-n.t)<1e-9){
        if(!sameSpot(last,n,kind))throw Error('同刻异位（t='+fmtQ(n.t)+'，本模型不可表示）');
        if(kind==='movement'&&n.move==='run'&&!last.move)last.move='run';
        continue;
      }
      res.push(n);
    }
    return res;
  }
  function serializeList(nodes,kind){return nodes.map(n=>kind==='movement'
    ?{time:fmtQ(n.t),x:fmtQ(n.x),z:fmtQ(n.z),...(n.move==='run'?{move:'run'}:{})}
    :{time:fmtQ(n.t),yaw:fmtQ(n.yaw)})}
  // 合法性预检：在 s 的克隆上经本模块 edit（锁/停用/外来冲突轨与最终 500 上限一并拦截，异常不逃逸预检）。
  function precheckList(s,di,vals){try{edit(copy(s),di,vals,'b5');return null}catch(e){return e.message}}
  function bothVals(s,di,kind,vals){var cur=nodes(s,di);return kind==='movement'?{movement:vals,facing:cur.facing}:{movement:cur.movement,facing:vals}}
  function precheckBoth(s,di,kind,vals){
    var both;try{both=bothVals(s,di,kind,vals)}catch(e){return '原状态轨道数据无法读取：'+e.message}
    return precheckList(s,di,both);
  }
  function sampleAt(s,di,sec,base){return sample(s,di,sec*1000,base||{x:0,z:0,yawDeg:0})}
  function dimsOf(v,kind){return kind==='movement'?{x:v.x,z:v.z}:{yaw:v.yawDeg}}
  function gaitAt(list,tSec){var n=list.find(v=>v.t>=tSec-1e-9);return n&&n.move}
  // T4 插时间 Δ 于 t（走位/朝向同核）：t≥t 节点右移；t>0 补首边界锚点 (t,q3(Q(t))) 带覆盖段步态＋
  // 保持末锚点 (t+Δ,q3(Q(t))) 无步态；t=0 只加 (Δ,起始位)。无 t≥t 节点＝无改动（不回写）。
  function t4Insert(list,t,delta,s,di,base,kind){
    kind=kind||'movement';
    if(!(delta>=0.5))return {refuse:'Δ<0.5'};
    if(!(t>=0))return {refuse:'a<0'};
    var cur=parseList(list,kind);
    var shift=cur.filter(n=>n.t>=t-1e-9);
    if(!shift.length)return {values:list.slice(),shifted:0,anchors:0,changed:false};
    var held=dimsOf(sampleAt(s,di,t,base),kind);
    var moved=shift.map(n=>Object.assign({},n,{t:n.t+delta}));
    var kept=cur.filter(n=>n.t<t-1e-9);
    var mk=(tSec,vals,gait)=>kind==='movement'
      ?Object.assign({t:tSec,x:vals.x,z:vals.z},gait?{move:gait}:{})
      :{t:tSec,yaw:vals.yaw};
    var anchors;
    if(t>1e-9){var g=gaitAt(cur,t);anchors=[mk(t,held,g),mk(t+delta,held)]}
    else anchors=[mk(delta,dimsOf(base||{x:0,z:0,yawDeg:0},kind))];
    var merged;
    try{merged=unifyList(kept.concat(moved,anchors),kind)}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,kind);
    var bad=precheckBoth(s,di,kind,vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    return {values:vals,shifted:moved.length,anchors:anchors.length,changed:true};
  }
  // T5 删时间 [a,b)（走位轨；删时间下朝向时刻不变——独立朝向边界）：窗内删、t≥b 左移 (b−a)、不加锚点；
  // 删后首节点落 0 秒拒绝；全部节点落窗内＝合法清空整轨（回起始位）；窗口在末节点之后＝零写入提示
  // （afterEnd 供事务容忍为不动）。
  function t5Delete(list,a,b,s,di,base){
    if(!(b-a>0))return {refuse:'跨度≤0（零写入）'};
    var span=b-a,cur=parseList(list,'movement');
    var kept=cur.filter(n=>n.t<a-1e-9);
    var inWin=cur.filter(n=>n.t>=a-1e-9&&n.t<b-1e-9);
    var moved=cur.filter(n=>n.t>=b-1e-9).map(n=>Object.assign({},n,{t:n.t-span}));
    if(!inWin.length&&!moved.length)return {refuse:'窗口在末节点之后：无受影响节点（零写入提示）',afterEnd:true};
    if(moved.length&&moved[0].t<=1e-9)return {refuse:'删除后首节点落在 0 秒（本模型无显式 0 秒节点），拒绝零写入'};
    if(!kept.length&&!moved.length){
      var bad0=precheckBoth(s,di,'movement',[]);
      if(bad0)return {refuse:'产品解析器拒绝：'+bad0};
      return {values:[],changed:true,removedIn:inWin.length,moved:0,affected:[0,'END'],clearedAll:true,revertsToBase:true,terminalChange:true};
    }
    var merged;
    try{merged=unifyList(kept.concat(moved),'movement')}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,'movement');
    var bad=precheckBoth(s,di,'movement',vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    var tPrev=kept.length?kept[kept.length-1].t:0;
    return {values:vals,changed:true,removedIn:inWin.length,moved:moved.length,
      affected:kept.length&&moved.length?[tPrev,moved[0].t]:(kept.length?[tPrev,'END']:[0,moved[0].t]),
      terminalChange:!moved.length&&!!kept.length,startSegmentChange:!kept.length};
  }
  // T6 整段平移 [a,b] Δ（本批仅纯函数；整段平移 UI 归 B7a）：窗内节点＋Δ；锚点三枚（窗起边界带覆盖段
  // 步态／保持对无步态／窗末边界带覆盖段步态；a≈0 且 Δ>0 时首锚点并入隐式出发点＝两枚，O-4）；
  // Δ>0 冲突区 (b,b+Δ]、Δ<0 冲突区 [a+Δ,a)，cover=true 覆盖。
  function t6Shift(list,a,b,delta,cover,s,di,base,kind){
    kind=kind||'movement';
    if(delta===0)return {refuse:'零位移：无改动（零写入提示）'};
    if(Math.abs(delta*2-Math.round(delta*2))>1e-9)return {refuse:'Δ 非 0.5 步进'};
    if(!(a>=0))return {refuse:'a<0'};
    if(!(b>a))return {refuse:'b≤a'};
    var cur=parseList(list,kind);
    if(!cur.length||a>cur[cur.length-1].t+1e-9)return {refuse:'窗口整体在末节点之后（零写入提示）'};
    var win=cur.filter(n=>n.t>=a-1e-9&&n.t<=b+1e-9),outside=cur.filter(n=>n.t<a-1e-9||n.t>b+1e-9);
    var qa=dimsOf(sampleAt(s,di,a,base),kind),qb=dimsOf(sampleAt(s,di,b,base),kind);
    var conflictTs=outside.filter(o=>delta>0?(o.t>b+1e-9&&o.t<=b+delta+1e-9):(o.t>=a+delta-1e-9&&o.t<a-1e-9)).map(o=>o.t);
    if(conflictTs.length&&!cover)return {conflicts:conflictTs};
    var survivors=outside.filter(o=>conflictTs.indexOf(o.t)<0);
    var moved=win.map(n=>Object.assign({},n,{t:n.t+delta}));
    var mk=(tSec,vals,gait)=>kind==='movement'
      ?Object.assign({t:tSec,x:vals.x,z:vals.z},gait?{move:gait}:{})
      :{t:tSec,yaw:vals.yaw};
    // O-4：Δ>0 且 a≈0 时首锚点 (0,qa=base) 与隐式出发点重复（模型无 0 秒节点，写入会被
    // 「到达时刻须大于零」整批拒绝），跳过该锚点——采样等价（先例 t1Window 的 a>0 才补出发
    // 锚点 / pasteConnect 的 0 秒并入隐式起点）；Δ<0 且 a=0 仍生成负时刻锚点＝结构性拒绝。
    var anchors=delta>0
      ?(a>1e-9?[mk(a,qa,gaitAt(cur,a))]:[]).concat([mk(a+delta,qa),mk(b+delta,qb,gaitAt(cur,b))])
      :[mk(a+delta,qa,gaitAt(cur,a)),mk(b+delta,qb,gaitAt(cur,b)),mk(b,qb)];
    var merged;
    try{merged=unifyList(survivors.concat(moved,anchors),kind)}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,kind);
    var bad=precheckBoth(s,di,kind,vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    var after=delta>0?b+delta:b;
    var tNext=survivors.filter(o=>o.t>after+1e-9)[0];
    var tPrev=survivors.filter(o=>o.t<(delta>0?a:a+delta)-1e-9).slice(-1)[0];
    return {values:vals,covered:conflictTs,anchorsAdded:anchors.length,
      affected:delta>0
        ?[[a,a+delta,'保持段'],[a+delta,b+delta,'平移段'],[b+delta,tNext?tNext.t:'END','窗后重连']]
        :[[tPrev?tPrev.t:0,a+delta,'窗前重连（原线不经过新锚点，该段必变）'],[a+delta,b+delta,'平移段'],[b+delta,b,'保持段'],[b,tNext?tNext.t:'END','窗后重连']],
      guarantees:delta>0
        ?{unchangedPrefixUpTo:a,prefixNote:'t<a 采样不变（锚点共线精确，否则≤1mm）'}
        :{unchangedPrefixUpTo:tPrev?tPrev.t:0,prefixNote:'t≤t_prev 精确；[t_prev,a+Δ] 为窗前重连段（必变，已预告）'},
      terminalChange:!tNext&&cur[cur.length-1].t<=b+1e-9};
  }
  // T1 窗口应用（B1 内联锚点收编为公共纯函数；stage-motion-ui 的 applySamePlace 回接）：
  // 保留 t<a 与 t>b；a>0 补出发锚点 (a,P(a)) 带来向步态；(b,dest) move 按用户；[a,b] 窗口内节点替换。
  function t1Window(list,aMs,bMs,dest,move,s,di,base){
    var cur=parseList(list,'movement');
    var kept=cur.filter(n=>n.t*1000<aMs-0.5),after=cur.filter(n=>n.t*1000>bMs+0.5);
    var out=kept.slice();
    if(aMs>0){
      var anchor=Object.assign({t:aMs/1000},dimsOf(sampleAt(s,di,aMs/1000,base),'movement'));
      var g=gaitAt(cur,aMs/1000);
      if(g)anchor.move=g;
      out.push(anchor);
    }
    out.push(Object.assign({t:bMs/1000,x:dest.x,z:dest.z},move==='run'?{move:'run'}:{}));
    return serializeList(out.concat(after),'movement');
  }
  // B7b 表 C 粘贴重连（纯函数）：把粘贴节点序列接入（T4 腾位后的）目标轨。
  // postT4＝t4Insert 产出的目标轨值列表；pasted＝已加 offset 的相对节点（rel∈[0,span]，x/z 或 yaw 原值）；
  // t＝落点；span＝舞段跨度（＝空隙 Δ）；base＝目标舞者起始位（t=0 特例用）。
  // 规则（R4 §六）：粘贴首节点恰落 t 时与保持锚点 H1 全维同位→合并（H1 让位于内容），任一维异位→拒绝；
  // 末节点恰抵空隙末 (t+span)→内容取代 H2；提前结束→尾部保持锚点 H2 改持粘贴末位。
  // t=0 且无 H1（模型无显式 0 秒节点）：与起始位同位→并入隐式起点（丢弃该节点）；异位→拒绝。
  function pasteConnect(postT4,pasted,t,span,s,di,base,kind){
    kind=kind||'movement';
    var nodes=(pasted||[]).slice().sort((a,b)=>a.rel-b.rel).map(n=>kind==='movement'
      ?Object.assign({t:t+n.rel,x:n.x,z:n.z},n.move==='run'?{move:'run'}:{})
      :{t:t+n.rel,yaw:n.yaw});
    if(!nodes.length)return {values:(postT4||[]).slice(),changed:false,pastedCount:0};
    var cur=parseList(postT4||[],kind),survivors=cur.slice();
    var first=nodes[0];
    var h1=survivors.findIndex(n=>Math.abs(n.t-t)<1e-9);
    if(Math.abs(first.t-t)<1e-9){
      if(h1>=0){
        if(!sameSpot(survivors[h1],first,kind))return {refuse:'粘贴首节点与落点保持锚点 H1 '+(kind==='movement'?'（X/Z）':'（朝向）')+'异位（t='+fmtQ(t)+'），预检拒绝'};
        survivors.splice(h1,1);
      }else if(t<=1e-9){
        var basePos=kind==='movement'?{x:(base||{}).x,z:(base||{}).z}:{yaw:(base||{}).yawDeg};
        if(!sameSpot(basePos,first,kind))return {refuse:'粘贴首节点落在 0 秒且与目标起始位异位（本模型无 0 秒节点），拒绝'};
        nodes.shift();
      }
    }
    if(nodes.length){
      var last=nodes[nodes.length-1];
      var h2=survivors.findIndex(n=>Math.abs(n.t-(t+span))<1e-9);
      if(h2>=0){
        if(Math.abs(last.t-(t+span))<1e-9)survivors.splice(h2,1);
        else survivors[h2]=kind==='movement'?{t:t+span,x:last.x,z:last.z}:{t:t+span,yaw:last.yaw};
      }
    }
    var merged;
    try{merged=unifyList(survivors.concat(nodes),kind)}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,kind);
    var bad=precheckBoth(s,di,kind,vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    return {values:vals,changed:true,pastedCount:nodes.length};
  }
  // ---------- B-SPATIAL-2 整组空间变换纯函数（镜像/旋转/起始位等距；输入/输出都是本模块 edit 认的值列表） ----------
  // 方向基线（评估件① §0）：单位朝向向量＝(sin yaw, cos yaw)；翻 X 坐标→朝向 −yaw、翻 Z 坐标→朝向
  // 180−yaw（镜像必含朝向；按被翻转坐标命名）；yaw 不包络归一（450 仍 450）。旋转仅 90° 整数倍
  // （cos/sin∈{0,±1}，十进制精确、代数封闭）；等距仅起始位、首尾保持。空间变换不改任何节点时刻，
  // 故 unifyList 同刻规则空转继承（不可能制造新的同刻冲突）；输出统一过 serializeList 再进 precheckBoth。
  function mirrorAxis(list,axis,pivot,s,di,kind){
    kind=kind||'movement';
    must(axis==='x'||axis==='z','镜像轴仅支持 x（左右）或 z（前后）');
    var p=Number(pivot);must(Number.isFinite(p)&&Math.abs(p)<=10000,'镜像枢轴超出范围（±10000）');
    var cur=parseList(list,kind);
    if(!cur.length)return {values:[],changed:false};
    var out=cur.map(n=>kind==='movement'
      ?Object.assign({},n,axis==='x'?{x:2*p-n.x}:{z:2*p-n.z})
      :Object.assign({},n,{yaw:axis==='x'?-n.yaw:180-n.yaw}));
    var merged;
    try{merged=unifyList(out,kind)}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,kind);
    var bad=precheckBoth(s,di,kind,vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    return {values:vals,changed:true,axis:axis,pivot:p};
  }
  // 绕枢轴顺时针旋转 deg90 度（评估件① §4.2-A：仅 90/180/270；位置随朝向同转，朝向 yaw+θ 不归一）。
  function rotateRight(list,deg90,pivot,s,di,kind){
    kind=kind||'movement';
    must(deg90===90||deg90===180||deg90===270,'旋转仅支持 90/180/270 度（任意角已延期）');
    var px=Number(pivot&&pivot.x),pz=Number(pivot&&pivot.z);
    must(Number.isFinite(px)&&Number.isFinite(pz),'旋转枢轴须为有限坐标');
    var th=deg90*Math.PI/180,c=Math.round(Math.cos(th)),si=Math.round(Math.sin(th));
    var cur=parseList(list,kind);
    if(!cur.length)return {values:[],changed:false};
    var out=cur.map(n=>{
      if(kind!=='movement')return Object.assign({},n,{yaw:n.yaw+deg90});
      var dx=n.x-px,dz=n.z-pz;
      return Object.assign({},n,{x:px+dx*c+dz*si,z:pz-dx*si+dz*c});
    });
    var merged;
    try{merged=unifyList(out,kind)}catch(e){return {refuse:e.message}}
    var vals=serializeList(merged,kind);
    var bad=precheckBoth(s,di,kind,vals);
    if(bad)return {refuse:'产品解析器拒绝：'+bad};
    return {values:vals,changed:true,deg90:deg90,pivot:{x:px,z:pz}};
  }
  // 起始位等距（评估件① §4.3-A，v1 仅起始位）：按轴投影排序，首尾两人不动，中间人轴坐标均匀重排，
  // 另一轴不动；<3 位有效＝如实 no-op（首尾保持下无中间人）。返回与输入同长的 starts（未动的位保持
  // 原值拷贝），moved/kept 为输入下标；量化沿起始位编辑通道（调用方做，厘米/整度）。
  function equidistantStarts(starts,axis){
    axis=axis==='z'?'z':'x';
    var list=(starts||[]).map(v=>v?{x:Number(v.x),z:Number(v.z),yawDeg:Number(v.yawDeg)}:null);
    var idx=[];list.forEach((v,i)=>{if(v&&Number.isFinite(v.x)&&Number.isFinite(v.z))idx.push(i)});
    if(idx.length<3)return {starts:null,changed:false,count:idx.length,kept:idx.slice(),moved:[]};
    idx.sort((a,b)=>{var d=list[a][axis]-list[b][axis];return d!==0?d:a-b});
    var first=list[idx[0]][axis],last=list[idx[idx.length-1]][axis],step=(last-first)/(idx.length-1);
    var out=list.map(v=>v?{x:v.x,z:v.z,yawDeg:v.yawDeg}:null),moved=[];
    for(var k=1;k<idx.length-1;k++){out[idx[k]][axis]=first+step*k;moved.push(idx[k])}
    return {starts:out,changed:true,count:idx.length,kept:[idx[0],idx[idx.length-1]],moved:moved,axis:axis,from:first,to:last,step:step};
  }
  var api={TAG,tracks,pid,owned,rows,snapshot,install,restore,nodes,edit,sample,end,blocksGame,rootTranslation,extentPoints,metrics,
    t1Window,t4Insert,t5Delete,t6Shift,pasteConnect,mirrorAxis,rotateRight,equidistantStarts};root.ChoreoStageMotion=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
