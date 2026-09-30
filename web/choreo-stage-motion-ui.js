// 走位/独立朝向节点编辑与二维预览：复用舞台坐标、现有播放头、项目保存和撤销。
// P1-C 同处走位（基础）：上下文栏「走位…」→ 舞台俯视标签点目的地+到达时刻+走/跑→应用/清除/取消（见文件末段）。
// P3 专家走位就地编辑：选中走位线（俯视路径线/走位片段）→ 时间轴下方上下文栏节点编辑（含「节点数值表
// （精确编辑）」折叠区）；片段上下文栏「转向…」=独立朝向就地编辑；旧浮窗与 2D 面板保留不删除。
// B3 删除/插入/承接可见性：未应用提示·应用·取消常驻（TD-01）；三级删除与预告（HF-05，T2/T3 预告内联，
// 公共纯函数归 B5）；加节点默认＝采样位置（HF-03）；同处走位承接预填（HF-06）；选择摘要/会话处置口
// （selectionDetail/discardSessionIfDancer，供 choreo-app 通用 Delete 总事务只读调用）。
// B4 主俯视图节点直拖：拖动/行内微调一律改草稿（表 B：S1 拖→S2；S2 拖不落库；S3/播放中拒绝）；
// 0.01 米量化、回原量化点零改动；就地改同一节点对象（选中身份/删除预告不被拖动破坏）；拖动指针接线与
// 变换冻结在 choreo-workbench.js；脏态常驻标注「3D 预览显示已保存值；应用后同步」（R3 显示口径）。
// B9-UNIFY-MOVE-DRAFT（属主 2026-09-23「并入」）：同处走位并入就地编辑＝单一草稿面——链 A 收敛为
// 链 B 会话内的「窗口快捷段」（会话栏子表单，舞台俯视只留引导提示＋叠加绘制）；窗口替换在统一草稿内
// 完成（M.t1Window 作用于会话草稿，预览态采样同「播放头加节点」法）；一段应用/整条应用共用一次确认
// →一次写入→恰好一次 saveHistory（同一撤销粒度＝整轨草稿一步）；取消/拒绝＝字节级零写入；脏判据单一
// （samePlaceDirty 并入整轨草稿 diff，未应用数如实）；通用 Delete/编辑器切换按统一判据拒绝/放行。
(function(root){
  'use strict';var P=root.ChoreoStageMotion,closeActive=null;
  function n(tag,text,parent){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}
  function button(text,parent,fn){var e=n('button',text,parent);e.className='btn';e.type='button';e.onclick=fn;return e}
  function table(box,title,cols,addLabel){
    n('h4',title,box);
    var table=n('table',undefined,box);table.style.cssText='width:100%;margin:6px 0 12px;border-collapse:collapse';
    var head=n('tr',undefined,n('thead',undefined,table));cols.forEach(x=>n('th',x,head));n('th','节点',head);
    return {tbody:n('tbody',undefined,table),add:button(addLabel,box,()=>{})};
  }
  function open(di){
    // D-B2-01（B3 第 0 项）：旧浮窗入口与 beginSession 同款技能编辑互斥——技能编辑中拒绝并保留其草稿。
    if(root.ChoreoAbilityUI&&root.ChoreoAbilityUI.suspendEditor&&!root.ChoreoAbilityUI.suspendEditor())return;
    if(closeActive)closeActive();var s=root.store,d=s.dancers[di];if(!d)return;
    var draft;try{draft=P.nodes(s,di)}catch(e){root.showToast(e.message);return}
    var project=s.projectId,dancers=s.dancers,baseline=JSON.stringify(P.tracks(s)),start=JSON.stringify(d.start),closed=false;
    var box=n('div');box.className='stage-motion-editor';box.setAttribute('role','dialog');box.setAttribute('aria-label','走位与独立朝向编排');
    box.style.cssText='position:fixed;z-index:900;right:18px;top:46px;width:min(610px,94vw);max-height:87vh;overflow:auto;background:#172131;color:#e6edf7;padding:16px;border:1px solid #74bbaa;border-radius:10px;box-shadow:0 12px 48px #0009';
    n('h3',d.name+' · 走位与独立朝向',box);
    // TASK-20260918-PLAYER-UX-SIMPLIFY A2：说明/边界长文与数值表默认折叠，原能力全部可达。
    var foldNote=n('details',undefined,box);foldNote.className='stage-motion-notes';
    var foldNoteSummary=n('summary','说明与边界 ▸',foldNote);foldNoteSummary.style.cssText='cursor:pointer;color:#9fc6dd';
    n('p','路径节点决定走到哪里（X 向右、Z 向前，单位米）；朝向节点是角色独立面向（0° 朝前，90° 朝右），可与路径不同时刻，也可原地转身。两条列表各自按到达时刻连续插值；朝向 0→360 是转一整圈。',foldNote);
    n('p','网页按原时序排练路径与独立朝向；骨骼根的水平位移不叠加到舞台路径。',foldNote);
    n('p','每个路径节点可选「走路 / 跑步」（默认走路，旧项目也是走路）。模式只用于游戏内执行：整场会按各节点自动切换步态；网页 3D/二维预览按节点时刻插值位置，不区分走/跑动画观感。',foldNote);
    var base=root.ChoreoEdit.pure.placementFor(s.dancers,di);
    n('p','起始：X '+base.x+' / Z '+base.z+' / '+base.yawDeg+'°',box);
    button('编辑起始站位',box,()=>{hide();root.ChoreoStageUI.openStartDialog(di)});
    button('游戏单人路径',box,()=>{hide();root.ChoreoStageGameUI.open(di)});
    // TASK-20260918-PLAYER-UX-SIMPLIFY B2：一键原地转向/前进 3 秒（常用一步直达；精确值仍在数值表）。
    var quick=n('div',undefined,box);quick.className='stage-motion-quick';quick.style.cssText='margin:8px 0 4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center';
    function commitNow(mutator){
      try{current();var next=collect();mutator(next);
        var all=P.edit(s,di,next,'stage-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
        P.install(s,all);root.updateTotalDuration();root.saveHistory();root.render();
        baseline=JSON.stringify(P.tracks(s));start=JSON.stringify(d.start);draft=P.nodes(s,di);drawRows('movement');drawRows('facing');
      }catch(e){error.textContent=e.message}
    }
    function quickTurn(deg){
      commitNow(function(next){
        var last=next.facing[next.facing.length-1];
        if(last&&Number(last.yaw)===deg)throw Error('末尾朝向节点已是 '+deg+'°，不再重复添加');
        next.facing.push({time:String(last?Number(last.time)+2:2),yaw:String(deg)});
      });
    }
    function quickAdvance(){
      commitNow(function(next){
        var last=next.movement[next.movement.length-1],t=last?Number(last.time)+3:3,atMs=last?Math.round(Number(last.time)*1000):0;
        var preview=s; // 含草稿采样：与下方 frame() 同法构造临时状态
        try{var all=P.edit(s,di,{movement:next.movement,facing:next.facing},'draft');preview={dancers:s.dancers,contentExtra:{_doc:Object.assign({},s.contentExtra&&s.contentExtra._doc,{extraTracks:all})}}}catch(e){}
        var live=root.ChoreoEdit.pure.placementFor(s.dancers,di),p=P.sample(preview,di,atMs,live),rad=p.yawDeg*Math.PI/180;
        next.movement.push({time:String(t),x:String(Math.round((p.x+Math.sin(rad)*1.5)*100)/100),z:String(Math.round((p.z+Math.cos(rad)*1.5)*100)/100)});
      });
    }
    n('span','快捷：',quick);
    [0,90,180,270].forEach(deg=>{var b=button('原地转 '+deg+'°',quick,()=>quickTurn(deg));b.title='末尾朝向节点 +2 秒（无则 2 秒）原地转向 '+deg+'°；一次撤销；精确值展开「节点数值表」改'});
    var adv=button('前进 3 秒（当前朝向）',quick,quickAdvance);adv.title='末尾路径节点 +3 秒（无则 3 秒），沿该时刻朝向前进约 1.5 米（单段包络内）；一次撤销；精确值展开改';
    var foldTables=n('details',undefined,box);foldTables.className='stage-motion-tables';
    var foldTablesSummary=n('summary','节点数值表（精确编辑） ▸',foldTables);foldTablesSummary.style.cssText='cursor:pointer;color:#9fc6dd';
    var pathTable=table(foldTables,'路径节点（走位）',['到达秒','X 米','Z 米','移动'],'添加路径节点');
    var yawTable=table(foldTables,'朝向节点（独立转身）',['到达秒','朝向°'],'添加朝向节点');
    var inputs={movement:[],facing:[]};
    function read(kind){var keys=kind==='movement'?['time','x','z','move']:['time','yaw'];return inputs[kind].map(row=>Object.fromEntries(keys.map(k=>[k,row[k].value])))}
    function drawRows(kind){var cols=kind==='movement'?['time','x','z']:['time','yaw'],labels=kind==='movement'?{time:'到达秒',x:'X',z:'Z'}:{time:'到达秒',yaw:'朝向'},name=kind==='movement'?'路径节点':'朝向节点';inputs[kind]=[];(kind==='movement'?pathTable:yawTable).tbody.replaceChildren();
      draft[kind].forEach((v,i)=>{var tr=n('tr',undefined,(kind==='movement'?pathTable:yawTable).tbody),row={};
        cols.forEach(k=>{var td=n('td',undefined,tr),e=n('input',undefined,td);e.type='text';e.inputMode='decimal';e.value=v[k];e.style.cssText='width:100%;min-width:0;box-sizing:border-box';e.setAttribute('aria-label',name+(i+1)+' '+labels[k]);row[k]=e});
        // TASK-20260919-PATH-LOCOMOTION：移动列=走/跑下拉（默认走路）；只影响游戏执行，预览不区分动画。
        if(kind==='movement'){var tdM=n('td',undefined,tr),sel=n('select',undefined,tdM);[['walk','走路'],['run','跑步']].forEach(o=>{var op=n('option',o[1],sel);op.value=o[0]});
          sel.value=v.move==='run'?'run':'walk';sel.setAttribute('aria-label',name+(i+1)+' 移动模式');
          sel.title='走路=慢速步行；跑步=快速跑动。游戏整场按各节点自动切换步态；网页预览按时刻插值位置，不区分走/跑动画';
          sel.style.cssText='width:100%;min-width:0;box-sizing:border-box';row.move=sel}
        inputs[kind].push(row);var td=n('td',undefined,tr);
        button('定位',td,()=>{try{var all=P.edit(s,di,{movement:read('movement'),facing:read('facing')},'draft'),t=all.find(x=>P.owned(x)&&x.type===kind&&x.performerId===P.pid(s,di));root.seekTimelinePosition(t.events[0].data.stageMotion.points[i].tMs/1000)}catch(e){error.textContent=e.message}});
        button('移除',td,()=>{draft=collect();draft[kind].splice(i,1);drawRows('movement');drawRows('facing')})})}
    function collect(){return {movement:read('movement'),facing:read('facing')}}
    drawRows('movement');drawRows('facing');
    pathTable.add.onclick=()=>{draft=collect();var last=draft.movement[draft.movement.length-1];draft.movement.push({time:String(last?Number(last.time)+2:2),x:String(last?last.x:base.x),z:String(last?last.z:base.z)});drawRows('movement')};
    yawTable.add.onclick=()=>{draft=collect();var last=draft.facing[draft.facing.length-1];draft.facing.push({time:String(last?Number(last.time)+2:2),yaw:String(last?last.yaw:base.yawDeg)});drawRows('facing')};
    var error=n('p','',box);error.setAttribute('role','status');error.style.cssText='color:#ffd091;min-height:1.5em';
    var canvas=n('canvas',undefined,box);canvas.width=560;canvas.height=230;canvas.style.cssText='width:100%;height:230px;background:#0b1422';canvas.setAttribute('aria-label','二维舞台走位与朝向预览（+X 向右 · +Z 向下＝观众席侧）');
    var info=n('p','',box);info.style.minHeight='3em';var notice=n('p','游戏：当前日常播放器尚未执行走位/独立朝向。已有短路径输入研究需当前角色与舞台校准、速度/时序核查和本次授权；不能保证任意速度或同时舞蹈，移动可能打断动作。不会静默忽略路径后启动。',foldNote);notice.className='stage-game-boundary';
    function current(){if(root.store!==s||s.projectId!==project||s.dancers!==dancers||s.dancers[di]!==d||JSON.stringify(P.tracks(s))!==baseline||JSON.stringify(d.start)!==start)throw Error('项目、舞者或轨道已变化，请关闭后重新打开；草稿未覆盖原数据');var m=root.ChoreoMusicUI&&root.ChoreoMusicUI.webState();if(s.isPlaying||(m&&m.playing&&!m.paused))throw Error('请先暂停再应用编排')}
    function apply(){try{current();var all=P.edit(s,di,collect(),'stage-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));if(JSON.stringify(all)===baseline){hide();return}P.install(s,all);root.updateTotalDuration();root.saveHistory();root.render();hide();root.showToast('走位与独立朝向已保存，可在同一播放器中排练')}catch(e){error.textContent=e.message}}
    var controls=n('div',undefined,box);controls.style.cssText='position:sticky;bottom:-16px;background:#172131;padding:10px 0';
    button('应用走位编排',controls,apply);button('取消',controls,hide);
    button('播放 / 暂停',controls,()=>{if(s.previewTarget!=='web'){root.showToast('请先切换到网页 3D 排练');return}root.togglePlay()});
    var raf;
    function hide(){closed=true;cancelAnimationFrame(raf);box.remove();if(closeActive===hide)closeActive=null}
    closeActive=hide;document.body.appendChild(box);
    function frame(){if(closed)return;raf=requestAnimationFrame(frame);var ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
      if(s.projectId!==project||s.dancers!==dancers){info.textContent='项目已切换，旧草稿不会应用到新项目';return}
      var live=root.ChoreoEdit.pure.placementFor(s.dancers,di),all=P.tracks(s),preview=s;
      try{all=P.edit(s,di,collect(),'draft');preview={dancers:s.dancers,contentExtra:{_doc:Object.assign({},s.contentExtra&&s.contentExtra._doc,{extraTracks:all})}}}catch(e){info.textContent=e.message;return}
      var own=all.find(t=>P.owned(t)&&t.type==='movement'&&t.performerId===P.pid(s,di));
      var points=[live].concat(own?own.events[0].data.stageMotion.points:[]),CE=root.ChoreoEdit.pure,t=CE.computeStageTransform(canvas.width,canvas.height,points),at=P.sample(preview,di,s.currentTime*1000,live);
      if(!t)return;
      // B-SPATIAL-2（属主 2026-09-23「2 按推荐」＝A 翻转对齐）：CE 纯层保持 +Z 屏幕上；本显示层只在
      // 出画布前做一次垂直镜像 sy'=canvas.height−sy、朝向箭头角度取 180−yaw（先例 choreo-stage-ui.js
      // stageDomY/stageDomYaw :403-404）。持久化坐标零改动；画布只读（无指针事件，无输入回映射面）。
      var dom=function(x,z){var q=CE.stageWorldToScreen(x,z,t);if(q)q.sy=canvas.height-q.sy;return q},domA=function(yawDeg){return (180-yawDeg)*Math.PI/180};
      ctx.strokeStyle='#71c9b4';ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>{var q=dom(p.x,p.z);i?ctx.lineTo(q.sx,q.sy):ctx.moveTo(q.sx,q.sy)});ctx.stroke();
      points.forEach((p,i)=>{var q=dom(p.x,p.z);ctx.fillStyle='#91aaba';ctx.beginPath();ctx.arc(q.sx,q.sy,4,0,Math.PI*2);ctx.fill();ctx.fillText(i+' · '+(p.tMs||0)/1000+'s',q.sx+7,q.sy-5)});
      // 朝向节点小箭头：按该时刻采样位置与角度显示独立转身，与路径点区分。
      var yawOwn=all.find(t=>P.owned(t)&&t.type==='facing'&&t.performerId===P.pid(s,di));
      (yawOwn?yawOwn.events[0].data.stageMotion.points:[]).forEach((p,i)=>{var fp=P.sample(preview,di,p.tMs,live),q=dom(fp.x,fp.z),a=domA(fp.yawDeg);ctx.save();ctx.translate(q.sx,q.sy);ctx.rotate(a);ctx.strokeStyle='#8fb7ff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,6);ctx.lineTo(0,-12);ctx.moveTo(-4,-7);ctx.lineTo(0,-12);ctx.lineTo(4,-7);ctx.stroke();ctx.restore();ctx.fillStyle='#8fb7ff';ctx.fillText('⟲'+(i+1)+' '+(p.tMs/1000)+'s',q.sx+8,q.sy+12)});
      var q=dom(at.x,at.z),a=domA(at.yawDeg);ctx.save();ctx.translate(q.sx,q.sy);ctx.rotate(a);ctx.fillStyle='#ffc46b';ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(9,9);ctx.lineTo(-9,9);ctx.closePath();ctx.fill();ctx.restore();
      var metric=P.metrics(preview,di,live),length=metric.distanceM;
      var speed=metric.speedSegments.map((v,i)=>(i+1)+'段 '+v.speedMps.toFixed(2)+' 米/秒'+(v.move==='run'?' · 跑步':' · 走路')).join('、'),turn=metric.turnSegments.map((v,i)=>(i+1)+'段 '+v.turnDegPerSecond.toFixed(1)+'°/秒').join('、');
      notice.textContent='路径各段要求：'+(speed||'无路径')+'。朝向各段要求：'+(turn||'无独立转身')+'。'+(metric.exceedsNativeTrial?'超过单段4秒/1.5米：整场审阅登记时会按原节点自动无损切分为多段链式执行（整场最长60秒）。':'处于单段4秒/1.5米包络内，可直接整场登记。')+'独立朝向仅网页排练，游戏执行须插件宣告 stageFacingV1 后另行接入；移动可能打断动作；不会改速、延时或静默忽略路径。';
      info.textContent='草稿二维预览（+X 向右 · +Z 向下＝观众席侧） · 播放头 '+s.currentTime.toFixed(3)+'s · X '+at.x.toFixed(2)+' / Z '+at.z.toFixed(2)+' / '+at.yawDeg.toFixed(1)+'° · 路径全长 '+length.toFixed(2)+' 米'+(metric.facingDurationMs?' · 朝向编排便 '+(metric.facingDurationMs/1000)+' 秒':'')+'。应用后进入 3D；游戏速度未校准。';
    }frame();return box;
  }
  function lane(di){var s=root.store,lane=n('div');lane.className='lane stage-motion-lane';lane.style.height='96px';var label=n('div','走位 / 朝向',lane);label.className='lane-label';label.style.cursor='pointer';label.title='点这里选中这位舞者的走位线，在时间轴下方就地编辑（节点时刻/走跑/增删+节点数值表）；旧版浮窗仍可从就地编辑区打开';label.onclick=()=>selectMotion(di);var body=n('div',undefined,lane);body.className='lane-body';body.style.cssText='position:relative;height:96px';
    // B8 入口收敛：此按钮开的是旧版浮窗（专家入口）——文案/提示如实标注；接线零变化（仍 open(di)）。
    var b=button('＋ 编排路径节点（旧版浮窗）',body,()=>open(di));b.className='btn stage-motion-open';b.title='打开旧版浮窗编排路径节点（专家入口）；日常编辑点走位线/轨按钮就地完成';b.style.cssText='position:sticky;top:3px;height:27px;left:0;z-index:2;font-size:11px';
    var who=P.pid(s,di);P.tracks(s).filter(t=>['movement','facing'].includes(t.type)&&t.performerId===who).forEach(t=>(t.events||[]).forEach(e=>{
      // P1-C：走位片段呈现名称/时长/走跑（全跑步=跑步、无=走路、混合=走+跑）
      var facing=t.type==='facing',move='';
      if(!facing){var pts=(e.data&&e.data.stageMotion&&e.data.stageMotion.points)||[],runs=pts.filter(p=>p.move==='run').length;
        move=' · '+(!pts.length?'走路':runs===0?'走路':runs===pts.length?'跑步':'走+跑')}
      var b=button((facing?'⟲ 朝向 · ':'↗ 走位 · ')+(e.durationMs/1000)+'s'+move,body,()=>{facing?openFacing(di):selectMotion(di)});
      b.className='stage-motion-clip';b.style.cssText='position:absolute;top:'+(facing?65:34)+'px;height:27px;background:'+(facing?'#233d5e':'#204b40')+';color:'+(facing?'#cfe0ff':'#d6ffef')+';border:1px solid '+(facing?'#8fb7ff':'#71c9b4')+';border-radius:4px;overflow:hidden;white-space:nowrap';
      b.style.left=e.startMs/1000*s.pps+'px';b.style.width=Math.max(140,e.durationMs/1000*s.pps)+'px';
      b.title=facing?'编辑独立朝向节点（就地）；仅网页排练，游戏执行未开放':'编辑路径节点（就地）；网页排练，游戏短路径须单独审阅';
      b.onmousedown=ev=>ev.stopPropagation();if(P.owned(t))label.textContent='走位 / 朝向 ✎';
      if(session&&sessionAlive(session)&&session.di===di&&((facing&&session.kind==='facing')||(!facing&&session.kind==='motion')))b.style.outline='2px solid #ffd091';}));return lane}
  // ---------- P1-C 同处走位（B9 并入就地编辑）：动作上下文「走位…」→ 打开链 B 会话＋窗口快捷段 ----------
  // 会话只持段子表单的 UI 值（目的地/到达时刻/走跑，全部存状态，栏重建不丢）；写入统一走
  // P.nodes→P.edit→P.install＋恰一次 saveHistory（与整条就地编辑同一提交链）；choreo-stage-motion.js
  // 数据/采样零改动。B9：段子表单宿主＝时间轴下方会话栏（wbCtxHost）；舞台俯视只留引导提示＋叠加绘制。
  var samePlace=null,barBusy=false;
  function playing(){var m=root.ChoreoMusicUI&&root.ChoreoMusicUI.webState();return !!(root.store.isPlaying||(m&&m.playing&&!m.paused))}
  function fmtT(ms){return String(Math.round(ms)/1000)}
  function samePlaceActive(){return !!samePlace}
  function samePlaceState(){if(!samePlace)return null;var sp=samePlace;return {di:sp.di,clipId:sp.clip.id,clipStart:sp.clip.start,dest:sp.dest,arrival:Number(sp.vals.arrival),move:sp.vals.mode,dur:Number(sp.vals.dur)}}
  function segEl(id){return document.getElementById(id)}
  function setStatus(msg,warn){var sp=samePlace;if(!sp)return;sp.statusText=msg;sp.statusWarn=warn!==false;var st=segEl('wbMoveHint');if(st){st.textContent=msg;st.className='wb-move-hint'+(warn===false?'':' warn')}}
  // B3 HF-06/表 B（B9 单一判据的一半）：段子表单「脏」＝用户改过预填之外的内容（预填取自草稿，不算
  // 用户改动）；无预填时点了目的地＝有未提交内容。整轨草稿 diff 由 draftCount 相加为单一判据。
  function segDirty(){
    var sp=samePlace;if(!sp)return false;
    var a=Number(sp.vals.arrival);
    if(sp.pristine){
      if(!sp.dest)return true;
      return !(String(sp.dest.x)===String(sp.pristine.x)&&String(sp.dest.z)===String(sp.pristine.z)
        &&isFinite(a)&&Math.round(a*1000)===sp.pristine.timeMs&&(sp.vals.mode==='run')===(sp.pristine.move==='run'));
    }
    return !!sp.dest;
  }
  function segForSession(se){return !!(se&&samePlace&&samePlace.di===se.di&&se.kind==='motion')}
  // B9 单一判据：整轨草稿 diff＋窗口快捷段（段有未应用输入计 1 处）；通用 Delete/编辑器切换/关闭确认共用。
  function sessionDirtyCount(se){
    var c=draftChanges(se);
    if(segForSession(se)&&segDirty())c++;
    return c;
  }
  // 重建会话栏：真实页面走 refreshWorkbenchBars；无该接线（node 测试内存桩）时直接挂 wbCtxHost。
  // barBusy 防重入（renderContext 空路径→endSamePlace→本函数→renderRegion→renderContext）。
  function refreshBarNow(){
    if(barBusy)return;barBusy=true;
    try{
      destroyBar();
      if(root.refreshWorkbenchBars){try{root.refreshWorkbenchBars()}catch(e){}}
      var ch=document.getElementById&&document.getElementById('wbCtxHost');
      if(ch&&ch.children&&!Array.prototype.some.call(ch.children,function(v){return v&&v.id==='wbCtx'})){
        var bar=renderContext();
        if(bar){try{ch.appendChild(bar)}catch(e){}}
      }
    }finally{barBusy=false}
  }
  function endSamePlace(){
    if(!samePlace)return;var sp=samePlace;samePlace=null;
    if(sp.hint)sp.hint.textContent=sp.hintText;
    refreshBarNow();
    if(window.ChoreoWorkbench&&ChoreoWorkbench.drawTop)try{ChoreoWorkbench.drawTop()}catch(e){}
  }
  // 段收口：快捷段移除；由快捷段自动打开的会话一并收起（回到打开前状态）；预存会话保持。
  function closeSegmentWith(){var sp=samePlace;endSamePlace();if(sp&&sp.auto)clearSelection()}
  function openSamePlace(di,clip){
    var s=root.store,d=s.dancers[di];
    if(!s||!d||!clip||d.actionClips.indexOf(clip)<0)return false;
    // B9 表 B：窗口快捷段有未应用输入时，重开/切换＝拒绝（先应用或取消），不静默丢弃
    if(samePlace&&segDirty()){root.showToast('窗口快捷段还有未应用修改：请先「应用」或「取消」');return false}
    endSamePlace();
    if(root.ChoreoAbilityUI&&root.ChoreoAbilityUI.suspendEditor&&!root.ChoreoAbilityUI.suspendEditor())return false;
    // SPEC §4：舞台自动切俯视标签，时间轴保持可见（舞台是侧面板，不盖时间轴）
    if(window.ChoreoWorkbench&&ChoreoWorkbench.setTab)ChoreoWorkbench.setTab('top');
    var host=document.getElementById('wbTopHost');
    if(!host||host.hidden)return false;
    // B9 单一草稿面：打开同处走位＝打开（或复用同舞者）链 B「就地编辑」会话，窗口快捷段挂在会话内。
    var auto=false;
    if(!(session&&sessionAlive(session)&&session.kind==='motion'&&session.di===di)){
      if(!beginSession('motion',di))return false;
      auto=true;
    }else{
      s.selectedDancer=di;
    }
    var hint=host.querySelector('.wb-top-hint');
    var sp={di:di,clip:clip,projectId:s.projectId,dancers:s.dancers,dest:null,hint:hint,hintText:hint?hint.textContent:'',auto:auto,
      pristine:null,vals:{dur:'',arrival:'',mode:'walk'},statusText:'',statusWarn:false,etaText:'',windowText:''};
    samePlace=sp;
    if(hint)hint.textContent='在俯视图里点一个目的地；时间轴保持可见，可随时核对。';
    // B3 HF-06 承接预填（B9：取自统一草稿）：严格晚于出发时刻的第一个走位节点（move＝该节点步态）；
    // 没有则如实提示（整条编辑已在下方会话打开，「查看整条」互链自然消失），不编造默认值。
    // 预填本身不算用户改动（未改直接应用＝no-op）。
    var startMs0=Math.round(clip.start*1000),nextNode=null;
    try{nextNode=(session.draft.movement||[]).find(function(v){return Math.round(Number(v.time)*1000)>startMs0})||null}catch(e){}
    if(nextNode){
      var t0=Math.round(Number(nextNode.time)*1000);
      sp.pristine={x:nextNode.x,z:nextNode.z,timeMs:t0,move:nextNode.move==='run'?'run':'walk'};
      sp.dest={x:nextNode.x,z:nextNode.z};
      sp.vals.arrival=fmtT(t0);sp.vals.dur=fmtT(t0-startMs0);sp.vals.mode=sp.pristine.move;
      setStatus('已承接已排走位：目的地 ('+nextNode.x+', '+nextNode.z+') 米、'+fmtT(t0)+'s 到达（该动作出发后第一个走位节点）；可直接应用或在俯视图改点。',false);
    }else{
      setStatus('该动作出发时刻之后没有已排走位：请先在俯视图里点一个目的地（整条走位编辑已在下方打开，可直接在数值表加节点）',false);
      resetDefaultTimes();
    }
    refreshBarNow();
    refreshEta();refreshWindowNote();
    return true;
  }
  // J5 换算：默认到达=片段结束（既有行为）；用时/到达共享段子表单状态，任一处无效都不落库。
  // 值全部写回状态（栏重建不丢），同步刷新已挂元素。
  function resetDefaultTimes(){
    var sp=samePlace;if(!sp)return;
    sp.vals.arrival=fmtT(Math.round((sp.clip.start+sp.clip.duration)*1000));
    sp.vals.dur=fmtT(Math.round(sp.clip.duration*1000));
    var dEl=segEl('wbMoveDur'),aEl=segEl('wbMoveArrival');
    if(dEl)dEl.value=sp.vals.dur;if(aEl)aEl.value=sp.vals.arrival;
    refreshEta();
  }
  function refreshEta(){
    var sp=samePlace;if(!sp)return;
    var a=Number(sp.vals.arrival);
    sp.etaText=(isFinite(a)&&a>sp.clip.start)
      ?('用 '+fmtT(Math.round((a-sp.clip.start)*1000))+'s · 到达 '+fmtT(Math.round(a*1000))+'s')
      :('到达无效：须晚于出发 '+fmtT(Math.round(sp.clip.start*1000))+'s');
    var e=segEl('wbMoveEta');if(e)e.textContent=sp.etaText;
  }
  // 窗口替换说明：所选窗口内已有节点时如实说「替换」，不谎称仅追加（B9：读统一草稿＝单一真相源）
  function refreshWindowNote(){
    var sp=samePlace;if(!sp)return;
    var wEl=segEl('wbMoveWindow');
    var a=Number(sp.vals.arrival);
    if(!isFinite(a)||a<=sp.clip.start){sp.windowText='';if(wEl)wEl.textContent='';return}
    var startMs=Math.round(sp.clip.start*1000),arriveMs=Math.round(a*1000),draft=null;
    if(session&&sessionAlive(session)&&session.di===sp.di){draft=session.draft}
    if(!draft){try{draft=P.nodes(root.store,sp.di)}catch(e){draft=null}}
    if(!draft){sp.windowText='';if(wEl)wEl.textContent='';return}
    var inWin=draft.movement.filter(v=>{var t=Math.round(Number(v.time)*1000);return t>=startMs&&t<=arriveMs});
    var text=inWin.length
      ?('这一段已有 '+inWin.length+' 个走位节点：应用会替换这个时间窗口的既有走位（更早/更晚的节点不动；「清除」也是删这个窗口）')
      :'';
    var next=draft.movement.find(v=>Math.round(Number(v.time)*1000)>arriveMs);
    var note=fmtT(arriveMs)+'s 至 '+(next?fmtT(Math.round(Number(next.time)*1000))+'s':'END（排练终点）')+' 的路径会重连';
    if(!next&&sp.dest){
      var CE=root.ChoreoEdit&&root.ChoreoEdit.pure,base=CE?CE.placementFor(root.store.dancers,sp.di):{x:0,z:0},old=P.sample(root.store,sp.di,arriveMs,base);
      note+='；终态保持位置由 ('+fmtN(old.x)+', '+fmtN(old.z)+') 改为 ('+sp.dest.x+', '+sp.dest.z+') 米';
    }
    text+=(text?'；':'')+'应用影响：'+note+'。';
    // B3 HF-05：「清除」同窗口的受影响区间常驻预告（前节点/后节点口径，与确认框一致）。
    var cp=null;draft.movement.forEach(function(v){if(Math.round(Number(v.time)*1000)<startMs)cp=v});
    var cn=draft.movement.find(function(v){return Math.round(Number(v.time)*1000)>arriveMs});
    var cpTxt=cp?fmtT(Math.round(Number(cp.time)*1000))+'s':'0s';
    text+=' 清除影响：'+(cn?('['+cpTxt+' → '+fmtT(Math.round(Number(cn.time)*1000))+'s] 重连'):('['+cpTxt+' → END] 终态变化'))+'。';
    sp.windowText=text;if(wEl)wEl.textContent=text;
  }
  // 俯视图点选目的地（workbench topClick 在快捷段期转入这里，不再选人/不再拖节点）
  function pickSamePlace(x,z){
    if(!samePlace)return;
    if(!isFinite(x)||!isFinite(z))return;
    var CE=root.ChoreoEdit&&root.ChoreoEdit.pure,q=v=>CE&&CE.quantStage?CE.quantStage(v):Math.round(v*100)/100;
    samePlace.dest={x:q(x),z:q(z)};
    // 空间微调只改目的地；时间仅由时间输入或显式重置按钮改变（HF-01）。
    refreshDirtyHint();
    setStatus('已选目的地 ('+samePlace.dest.x+', '+samePlace.dest.z+') 米；已保留用时与到达时刻。',false);
    refreshWindowNote();
    if(window.ChoreoWorkbench&&ChoreoWorkbench.drawTop)ChoreoWorkbench.drawTop();
  }
  // 俯视叠加：出发点（片段开始时位置）→ 目的地虚线与标记（读段子表单状态）
  function drawSamePlace(g,project){
    if(!samePlace)return;
    var sp=samePlace,s=root.store;
    if(s.projectId!==sp.projectId||s.dancers!==sp.dancers){endSamePlace();return} // 项目已切换：会话作废
    var CE=root.ChoreoEdit&&root.ChoreoEdit.pure,base=CE.placementFor(s.dancers,sp.di);
    var from=P.sample(s,sp.di,Math.round(sp.clip.start*1000),base);
    var a=project(from.x,from.z);
    g.strokeStyle='#ffd091';g.setLineDash([4,3]);g.lineWidth=1.5;g.beginPath();g.arc(a.sx,a.sy,8,0,Math.PI*2);g.stroke();g.setLineDash([]);
    g.fillStyle='#ffd091';g.font='11px sans-serif';g.fillText('出发 '+fmtT(Math.round(sp.clip.start*1000))+'s',a.sx+10,a.sy+4);
    if(!sp.dest)return;
    var b=project(sp.dest.x,sp.dest.z);
    g.strokeStyle='#71c9b4';g.setLineDash([6,4]);g.beginPath();g.moveTo(a.sx,a.sy);g.lineTo(b.sx,b.sy);g.stroke();g.setLineDash([]);
    g.beginPath();g.moveTo(b.sx-6,b.sy);g.lineTo(b.sx+6,b.sy);g.moveTo(b.sx,b.sy-6);g.lineTo(b.sx,b.sy+6);g.stroke();
    g.fillText('到达 '+sp.vals.arrival+'s',b.sx+10,b.sy+4);
  }
  function sessionTarget(){
    var sp=samePlace,s=root.store;
    if(!sp)return null;
    // B9：快捷段寄生在会话上——会话失联（外部关闭/项目切换）则段一并收起
    if(!(session&&sessionAlive(session)&&session.kind==='motion'&&session.di===sp.di)){endSamePlace();return null}
    if(s.projectId!==sp.projectId||s.dancers!==sp.dancers||!s.dancers[sp.di]||s.dancers[sp.di].actionClips.indexOf(sp.clip)<0){
      setStatus('片段或项目已变化，未做改动；请「取消」后从时间轴重新打开',true);return null}
    return sp;
  }
  // 应用=窗口替换并入统一草稿后整轨一次提交（B9 提交链统一）：保留 <片段开始 与 >到达时刻 的节点；
  // [片段开始, 到达时刻] 窗口内（含同刻）由「出发保持+目的地」落位。片段从 0s 开始时 0 点已是隐式出发位，
  // 不补保持节点；非零出发均补原轨迹采样锚点并保留来向步态（锚点按统一草稿轨迹采样——预览态构造与
  // 「播放头加节点」同法）；后侧重连影响在应用前预告。公共变换＝M.t1Window（B5）。
  // 「应用一段」与「应用整条」共用同一提交链：恰一次写入＋恰一次 saveHistory，撤销粒度＝整轨草稿一步。
  function applySamePlace(){
    var sp=sessionTarget(),s=root.store;
    if(!sp)return;
    if(playing()){setStatus('请先暂停再应用走位',true);return}
    if(!sp.dest){setStatus('请先在俯视图里点一个目的地',true);return}
    var arrive=Number(sp.vals.arrival);
    // J5：主字段是移动用时——到达=出发+用时；空/0/负/非数经双向同步后到达必无效，这里双保险拒绝
    if(!isFinite(arrive)||arrive<=sp.clip.start){setStatus('到达时刻须为数字且晚于动作开始（'+fmtT(Math.round(sp.clip.start*1000))+'s）；移动用时须为大于 0 的秒数',true);return}
    var durMs=Math.round(arrive*1000)-Math.round(sp.clip.start*1000);
    if(!(durMs>0)){setStatus('移动用时须为大于 0 的秒数',true);return}
    var startMs=Math.round(sp.clip.start*1000),arriveMs=Math.round(arrive*1000);
    if(startMs<0){setStatus('出发时刻不得小于零，未做改动',true);return}
    // B3 HF-06（R3 §五 no-op）：预填未被修改而直接应用＝零写入零历史——预填本就取自当前草稿，
    // 重新应用默认值不是新信息（含出发锚点也不补）。轨若已被外部改到预填源不在首位，则走正常 T1。
    if(sp.pristine&&!segDirty()){
      try{
        var cn=session.draft.movement.find(function(v){return Math.round(Number(v.time)*1000)>startMs});
        if(cn&&String(cn.x)===String(sp.pristine.x)&&String(cn.z)===String(sp.pristine.z)&&Math.round(Number(cn.time)*1000)===sp.pristine.timeMs){
          setStatus('走位与当前保存的一致，未重复保存（预填取自当前轨）',false);root.showToast('走位与当前保存的一致，未重复保存');return;
        }
      }catch(e){}
    }
    var se=session,base=root.ChoreoEdit&&root.ChoreoEdit.pure,p0=base?base.placementFor(s.dancers,sp.di):{x:0,z:0};
    var preview=s;
    try{var pre=P.edit(s,se.di,{movement:se.draft.movement,facing:se.draft.facing},'draft');preview={dancers:s.dancers,contentExtra:{_doc:Object.assign({},s.contentExtra&&s.contentExtra._doc,{extraTracks:pre})}}}catch(e){preview=s}
    var nodes;
    try{nodes=P.t1Window(se.draft.movement,startMs,arriveMs,sp.dest,sp.vals.mode==='run'?'run':undefined,preview,sp.di,p0)}
    catch(e){setStatus(e.message,true);return}
    // 窗口替换在草稿内完成（B9）：失败时回退本次并入，草稿保持应用前原样＝零副作用。
    // 窗外原字节保留（值感知）：窗外且标准维值与已保存点相等＝用户未改该节点，保留原字节含扩展字段
    // （b1 HF-02 口径）；值不等＝用户在统一草稿里改过该节点，按新值落库（与整条编辑同口径）。
    var prevMovement=se.draft.movement;
    se.draft.movement=nodes;se.nodeSel=null;se.overlay=null;
    var preserve=function(all){
      return all.map(function(t){
        var old=P.tracks(s).find(v=>v.id===t.id);
        if(!old||!P.owned(t)||t.performerId!==P.pid(s,sp.di))return t;
        if(t.type==='facing'){
          if(!old.events[0]||!t.events[0])return t;
          t.events[0].data.stageMotion.points=t.events[0].data.stageMotion.points.map(function(p){
            var prior=old.events[0].data.stageMotion.points.find(v=>v.tMs===p.tMs&&String(v.yaw)===String(p.yaw));
            return prior?JSON.parse(JSON.stringify(prior)):p;
          });return t;
        }
        if(!old.events[0]||!t.events[0])return t;
        var priorPts=old.events[0].data.stageMotion.points;
        t.events[0].data.stageMotion.points=t.events[0].data.stageMotion.points.map(function(p){
          var keep=(p.tMs<startMs||p.tMs>arriveMs)&&priorPts.find(v=>v.tMs===p.tMs&&String(v.x)===String(p.x)&&String(v.z)===String(p.z)&&(v.move==='run')===(p.move==='run'));
          return keep?JSON.parse(JSON.stringify(keep)):p;
        });return t;
      });
    };
    var r=commitDraft('wbmove-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),preserve);
    if(r&&typeof r==='object'&&r.fail){
      se.draft.movement=prevMovement;refreshBarNow();setStatus(r.fail,true);return;
    }
    if(r==='noop'){closeSegmentWith();root.showToast('走位与当前保存的一致，未重复保存');return}
    closeSegmentWith();
    root.showToast('走位已应用：'+fmtT(startMs)+'s 出发，用 '+fmtT(durMs)+'s，'+fmtT(arriveMs)+'s 到达（↶ 可撤销）');
  }
  // 清除=删掉 [片段开始, 到达时刻] 窗口内的走位节点（T3 直接提交：一次确认→一次写入→恰好一次
  // saveHistory）；B9 统一判据：整条草稿有未应用节点修改时先拒绝（先应用或取消），干净草稿下清除
  // 即等价改写并重取基线；清空后 movement 轨整体移除。
  function clearSamePlace(){
    var sp=sessionTarget(),s=root.store;
    if(!sp)return;
    if(playing()){setStatus('请先暂停再清除走位',true);return}
    if(draftChanges(session)>0){setStatus('整条草稿还有未应用修改：请先「应用」或「取消修改」，再清除这条走位',true);return}
    var arrive=Number(sp.vals.arrival);
    var startMs=Math.round(sp.clip.start*1000),arriveMs=isFinite(arrive)&&arrive>sp.clip.start?Math.round(arrive*1000):Math.round((sp.clip.start+sp.clip.duration)*1000);
    var draft=session.draft; // 判据已保证草稿＝保存值
    var inWin=v=>{var t=Math.round(Number(v.time)*1000);return t>=startMs&&t<=arriveMs};
    if(!draft.movement.some(inWin)){setStatus('这段时间里没有已保存的走位节点',true);return}
    // B3 HF-05：窗口级预告并入同一口径——列出受影响区间 [前节点,后节点]（清到尾部时 [前节点,END]＋终态
    // 变化；整轨清空回起点站位），确认后才保存（一次撤销）；取消＝零写入。公共纯函数归 B5。
    var prevN=null,nextN=null;
    draft.movement.forEach(function(v){if(Math.round(Number(v.time)*1000)<startMs)prevN=v});
    nextN=draft.movement.find(function(v){return Math.round(Number(v.time)*1000)>arriveMs});
    var prevTxt=prevN?fmtT(Math.round(Number(prevN.time)*1000))+'s':'0s';
    var msg='将删除 '+fmtT(startMs)+'s–'+fmtT(arriveMs)+'s 窗口内的 '+draft.movement.filter(inWin).length+' 个走位节点（一次撤销）。';
    if(nextN)msg+='受影响区间 ['+prevTxt+' → '+fmtT(Math.round(Number(nextN.time)*1000))+'s]：这段路径将重连为直线。';
    else{
      var rest=draft.movement.filter(function(v){return !inWin(v)}),lastRest=rest.length?rest[rest.length-1]:null;
      if(lastRest)msg+='清到尾部：受影响区间 ['+prevTxt+' → END]，终态保持位置改为 ('+lastRest.x+', '+lastRest.z+') 米。';
      else msg+='清空整轨：受影响区间 [0 → END]，回到起点站位。';
    }
    if(root.confirm&&!root.confirm(msg+'确定清除？'))return;
    try{
      var all=P.edit(s,sp.di,{movement:draft.movement.filter(v=>!inWin(v)),facing:draft.facing},'wbmove-clr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
      if(JSON.stringify(all)!==JSON.stringify(P.tracks(s))){P.install(s,all);root.updateTotalDuration();root.saveHistory();root.render()}
      // 会话重取基线（干净草稿下清除＝整轨等价改写），快捷段收口
      session.draft=P.nodes(s,sp.di);session.baseline=JSON.stringify(P.tracks(s));session.baseNodes=JSON.parse(JSON.stringify(session.draft));session.nodeSel=null;
      closeSegmentWith();
      root.showToast('已清除这条走位（↶ 可撤销）');
    }catch(e){setStatus(e.message,true)}
  }
  // ---------- P3 专家走位就地编辑：选中走位线（俯视路径线/走位片段）→ 时间轴下方上下文栏 ----------
  // 会话=UI 草稿（draft）+ 显式「应用」（一次撤销）；节点时刻/走跑/增删与「节点数值表（精确编辑）」
  // 折叠区都在这里；旧走位浮窗与 2D 舞台面板保留（入口可迁、能力不删）。choreo-stage-motion.js
  // 数据/采样零改动；提交仍走 P.edit/P.install + 一次 saveHistory。
  var mctx=null,session=null;
  function fmtN(v){return String(Math.round(Number(v)*1000)/1000)}
  function sessionAlive(se){return !!(se&&root.store&&se.projectId===root.store.projectId&&se.dancers===root.store.dancers&&root.store.dancers[se.di])}
  // B3 TD-01：未应用修改数＝草稿 vs 会话基线的节点级差集（改一个值/加一个/删一个各计 1 处）。
  function nodeDiffCount(a,b){var pool={};b.forEach(function(v){var k=JSON.stringify(v);pool[k]=(pool[k]||0)+1});
    var add=0;a.forEach(function(v){var k=JSON.stringify(v);if(pool[k])pool[k]--;else add++});
    var del=0;Object.keys(pool).forEach(function(k){del+=pool[k]});
    return Math.max(add,del)}
  function draftChanges(se){return nodeDiffCount(se.draft.movement,se.baseNodes.movement)+nodeDiffCount(se.draft.facing,se.baseNodes.facing)}
  // B3-RT-01：可直传目标元素——buildBar 时新栏尚未插入文档，getElementById 查不到。
  // B4（R3 显示口径）：脏态常驻标注俯视读草稿、3D 读已保存值——应用前两者可能不同。
  // B9：未应用数＝单一判据 sessionDirtyCount（整轨草稿 diff＋窗口快捷段，计数如实标注含快捷段）。
  function refreshDirtyHint(el,note){el=el||document.getElementById('wbMotionDirty');if(!el||!session)return;
    var segOn=segForSession(session)&&segDirty();
    var c=sessionDirtyCount(session);
    el.textContent=c>0?('未应用 '+c+' 处修改'+(segOn?'（含窗口快捷段）':'')+'（点「应用」保存）'):'已与保存一致';
    var ne=note||document.getElementById('wbMotion3dNote');if(ne)ne.textContent=c>0?'3D 预览显示已保存值；应用后同步':''}
  // B3 HF-05：节点级删除预告（R3 表 A T2 双侧口径：内部重连 / 尾部 [t_prev,END] 终态改前节点值 / 唯一节点整轨清空）。
  function nodePreviewText(rows,idx){
    var v=rows[idx],t=fmtN(v.time),prevTxt=idx>0?fmtN(rows[idx-1].time)+'s':'0s';
    if(rows.length===1)return '唯一节点：删除后整轨清空，回到起点站位（立即保存，一次撤销）';
    if(idx===rows.length-1)return '删除后 ['+prevTxt+', END] 终态保持值改为前节点值（一次撤销）';
    return '删除后 ['+prevTxt+', '+fmtN(rows[idx+1].time)+'s] 直线重连、速度改变（一次撤销）';
  }
  function destroyBar(){if(mctx&&mctx.destroy)mctx.destroy();mctx=null}
  function barStatus(msg){if(session)session.status=msg||'';var el=document.getElementById('wbMotionStatus');if(el)el.textContent=msg||''}
  function clearTimelineSelection(){
    var s=root.store;if(!s)return;
    (s.dancers||[]).forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){(d[k]||[]).forEach(function(x){x.selected=false})})});
    (s.globalLyrics||[]).forEach(function(x){x.selected=false});
    s.selectedClip=null;
  }
  function beginSession(kind,di){
    var s=root.store,d=s&&s.dancers[di];
    if(!s||!d)return false;
    // B9 表 B／R5-06：窗口快捷段有未应用输入时，切换编辑器＝拒绝（先应用或取消），不静默丢弃
    if(samePlace&&segDirty()){root.showToast('窗口快捷段还有未应用修改：请先「应用」或「取消」');return false}
    var draft;try{draft=P.nodes(s,di)}catch(e){root.showToast(e.message);return false}
    endSamePlace(); // 就地编辑与窗口快捷段互斥：进新会话即收起旧快捷段（脏段已在上面拒绝）
    if(root.ChoreoAbilityUI&&root.ChoreoAbilityUI.suspendEditor&&!root.ChoreoAbilityUI.suspendEditor())return false;
    s.selectedDancer=di;
    session={kind:kind,di:di,projectId:s.projectId,dancers:s.dancers,draft:draft,baseNodes:JSON.parse(JSON.stringify(draft)),nodeSel:null,overlay:JSON.parse(JSON.stringify(draft.movement)),baseline:JSON.stringify(P.tracks(s)),status:''};
    destroyBar();
    if(root.ChoreoWorkbench&&root.ChoreoWorkbench.drawTop)try{root.ChoreoWorkbench.drawTop()}catch(e){}
    if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
    return true;
  }
  function selectMotion(di){return beginSession('motion',di)}
  function openFacing(di){return beginSession('facing',di)}
  function clearSelection(){if(!session&&!mctx&&!samePlace)return;session=null;if(samePlace)endSamePlace();destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars()} // B9：会话与窗口快捷段一体收起
  function sessionActive(){return !!session}
  function sessionState(){return session?{kind:session.kind,di:session.di,movement:session.draft.movement.length,facing:session.draft.facing.length,status:session.status}:null}
  function distToSeg(px,pz,ax,az,bx,bz){var dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz;if(l2<=1e-12)return Math.hypot(px-ax,pz-az);var t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l2));return Math.hypot(px-(ax+dx*t),pz-(az+dz*t))}
  // 俯视图点选走位线：容差内当前舞者优先，同点重复点击循环；命中即选中该舞者走位。
  function pickTopPath(x,z,tol){
    var s=root.store,CE=root.ChoreoEdit&&root.ChoreoEdit.pure;if(!s||!CE||!isFinite(x)||!isFinite(z))return false;
    var hits=[];
    for(var di=0;di<s.dancers.length;di++){
      var base=CE.placementFor(s.dancers,di);if(!base)continue;
      var pts=P.extentPoints(s,di,base);
      var bestD=Infinity;
      for(var i=1;i<pts.length;i++){var d=distToSeg(x,z,pts[i-1].x,pts[i-1].z,pts[i].x,pts[i].z);bestD=Math.min(bestD,d)}
      if(bestD<=tol)hits.push(di);
    }
    var bestDi=cycleHit('path',x,z,tol,hits);
    if(bestDi>=0){if(session&&session.di===bestDi&&session.kind==='motion')return true;return selectMotion(bestDi)}
    return false;
  }
  // 同一命中集合保留初次顺序；自身选人改变不重置循环，外部换人/项目/内容则重置。
  var hitCycle=null;
  function cycleHit(kind,x,z,tol,hits){
    var s=root.store,key=hits.join(','),old=hitCycle,tracks=s.contentExtra&&s.contentExtra._doc&&s.contentExtra._doc.extraTracks;
    if(!hits.length){if(old&&old.kind===kind)hitCycle=null;return -1}
    var same=old&&old.kind===kind&&old.project===s.projectId&&old.dancers===s.dancers&&old.tracks===tracks&&old.time===s.currentTime&&old.key===key&&old.chosen===s.selectedDancer&&Math.hypot(x-old.x,z-old.z)<=tol/4;
    if(same){old.index=(old.index+1)%old.order.length}else{
      var order=hits.slice().sort(function(a,b){return (a===s.selectedDancer?-1:b===s.selectedDancer?1:a-b)});
      hitCycle=old={kind:kind,project:s.projectId,dancers:s.dancers,tracks:tracks,time:s.currentTime,key:key,x:x,z:z,order:order,index:0};
    }
    old.chosen=old.order[old.index];return old.chosen;
  }
  function pickTopNode(x,z,tol){
    if(!session||!sessionAlive(session)||session.kind!=='motion')return false;
    var idx=nodeAt(x,z,tol);
    if(idx<0)return false;
    selectNodeIdx(idx);return true;
  }
  // B4：主俯视图节点手柄命中（只认会话舞者的路径节点；位置以校验过的 overlay 为准，S3 保留上一有效位置）。
  function nodeAt(x,z,tol){
    if(!session||!sessionAlive(session)||session.kind!=='motion')return -1;
    var rows=session.overlay||[],idx=rows.findIndex(function(v){return Math.hypot(Number(v.x)-x,Number(v.z)-z)<=tol});
    return idx>=0&&session.draft.movement[idx]!=null?idx:-1;
  }
  function selectNodeIdx(idx){
    root.store.selectedDancer=session.di;
    // B3 HF-05：节点身份＝草稿数组对象引用（R3 §二）；选中即见删除后连线预告与受影响区间。
    session.nodeSel=session.draft.movement[idx]||null;
    session.status='已选中 '+root.store.dancers[session.di].name+' · 走位节点 '+(idx+1)+'：'+nodePreviewText(session.overlay||session.draft.movement,idx);
    barStatus(session.status);
    destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
    if(root.ChoreoWorkbench)root.ChoreoWorkbench.drawTop();
  }
  // B4：节点直拖（表 B：S1 拖→改草稿进 S2；S2 拖→仍只改草稿不落库；S3/播放中拒绝并提示）。
  // 指针接线与拖动期变换冻结在 choreo-workbench.js；这里只管草稿、选中身份与状态条。
  function dragNodeStart(idx){
    if(!session||!sessionAlive(session)||session.kind!=='motion'||!session.draft.movement[idx])return null;
    selectNodeIdx(idx); // 点按/拖起同一选中语义（R1 批 B4：选中并出行内微调行）
    if(playing()){session.status='请先暂停再拖动节点';barStatus(session.status);return {ok:false}}
    try{P.edit(root.store,session.di,session.draft,'wb-drag-check')}
    catch(e){session.status='数值表存在非法输入：请先修正输入，或点「取消修改」还原后再拖动节点';barStatus(session.status);return {ok:false}}
    var node=session.draft.movement[idx];
    session.drag={idx:idx,x:String(node.x),z:String(node.z)};
    return {ok:true};
  }
  function dragQuant(v){var CE=root.ChoreoEdit&&root.ChoreoEdit.pure,q=CE&&CE.quantStage?CE.quantStage(v):Math.round(v*100)/100;return q===0?0:q}
  function dragNodeMove(x,z){
    if(!session||!session.drag||!isFinite(x)||!isFinite(z))return false;
    var node=session.draft.movement[session.drag.idx];if(!node)return false;
    // 0.01 米量化；数值相同（回原量化点）不写字符串＝草稿零改动。就地改同一对象：选中身份与删除预告不破坏。
    var nx=dragQuant(x),nz=dragQuant(z);
    if(!(Math.round(nx*100)===Math.round(Number(node.x)*100)&&Math.round(nz*100)===Math.round(Number(node.z)*100))){node.x=String(nx);node.z=String(nz)}
    if(root.ChoreoWorkbench&&root.ChoreoWorkbench.drawTop)try{root.ChoreoWorkbench.drawTop()}catch(e){}
    return true;
  }
  function dragNodeEnd(){
    if(!session||!session.drag)return null;
    var idx=session.drag.idx,ox=session.drag.x,oz=session.drag.z;session.drag=null;
    var node=session.draft.movement[idx]||{};
    var moved=!(Math.round(Number(node.x)*100)===Math.round(Number(ox)*100)&&Math.round(Number(node.z)*100)===Math.round(Number(oz)*100));
    if(moved)session.status='已拖动走位节点 '+(idx+1)+' 到 ('+node.x+', '+node.z+') 米（未应用；点「应用」保存，可继续编辑）';
    destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
    if(root.ChoreoWorkbench&&root.ChoreoWorkbench.drawTop)try{root.ChoreoWorkbench.drawTop()}catch(e){}
    return {moved:moved};
  }
  function dragActive(){return !!(session&&session.drag)}
  // 俯视图叠加：高亮选中的走位折线与节点（workbench.drawTop 调用）
  function drawSelected(g,project){
    var s=root.store;if(!s||!session||!sessionAlive(session)||session.kind!=='motion')return;
    var base=root.ChoreoEdit.pure.placementFor(s.dancers,session.di);
    // 线、节点与标签共享同一份经产品解析器校验的草稿；非法输入保留上次有效显示，不写保存态。
    try{
      P.edit(s,session.di,session.draft,'wb-draft-preview');
      session.overlay=JSON.parse(JSON.stringify(session.draft.movement));
      if(session.overlayError){session.overlayError=false;barStatus('草稿已更新（未应用）')}
    }catch(e){session.overlayError=true;barStatus(e.message||String(e))}
    var rows=session.overlay,pts=[base].concat(rows.map(v=>({x:Number(v.x),z:Number(v.z)})));if(pts.length<2)return;
    g.save();
    g.strokeStyle='#ffd091';g.lineWidth=3;g.beginPath();
    pts.forEach(function(p,i){var q=project(p.x,p.z);if(i)g.lineTo(q.sx,q.sy);else g.moveTo(q.sx,q.sy)});g.stroke();
    rows.forEach(function(v,i){var q=project(Number(v.x),Number(v.z));g.fillStyle='#ffd091';g.fillRect(q.sx-3,q.sy-3,6,6);g.font='12px sans-serif';g.fillText((i+1)+'·'+fmtN(v.time)+'s',q.sx+7,q.sy-5)});
    // B3 HF-05：选中节点即时预览「删除后连线」——虚线直连前→后（尾部无后邻居时圈出终态锚）。
    var selIdx=session.nodeSel?session.draft.movement.indexOf(session.nodeSel):-1;
    if(selIdx>=0&&selIdx<rows.length){
      var prevPt=selIdx>0?rows[selIdx-1]:{x:base.x,z:base.z};
      var qa=project(Number(prevPt.x),Number(prevPt.z));
      g.strokeStyle='#ff8f8f';g.lineWidth=2;g.setLineDash([6,4]);
      if(selIdx<rows.length-1){var nb=rows[selIdx+1],qb=project(Number(nb.x),Number(nb.z));
        g.beginPath();g.moveTo(qa.sx,qa.sy);g.lineTo(qb.sx,qb.sy);g.stroke()}
      else{g.beginPath();g.arc(qa.sx,qa.sy,7,0,Math.PI*2);g.stroke()}
      g.setLineDash([]);
      var qs=project(Number(rows[selIdx].x),Number(rows[selIdx].z));
      g.strokeStyle='#ff8f8f';g.strokeRect(qs.sx-5,qs.sy-5,10,10);
    }
    g.restore();
  }
  function nodeInput(tr,label,value,oninput){
    var td=n('td',undefined,tr),inp=n('input',undefined,td);inp.type='text';inp.inputMode='decimal';inp.className='wb-node-in';inp.value=value;inp.setAttribute('aria-label',label);inp.oninput=function(e){oninput(e);refreshDirtyHint();if(root.ChoreoWorkbench&&root.ChoreoWorkbench.drawTop)root.ChoreoWorkbench.drawTop()};return inp;
  }
  function buildNodeTable(kind){
    var wrap=n('div',undefined);wrap.className='wb-node-table';
    var table=n('table',undefined,wrap);table.className='wb-node-tbl';
    var head=n('tr',undefined,n('thead',undefined,table));
    (kind==='movement'?['到达秒','X 米','Z 米','移动','']:['到达秒','朝向°','']).forEach(function(h){n('th',h,head)});
    var tbody=n('tbody',undefined,table),rows=session.draft[kind];
    // B9：窗口快捷段打开时高亮该动作窗口内的节点行（定位到正在排走位的时间段）
    var seg=segForSession(session)?samePlace:null,segA=-1,segB=-2;
    if(seg&&kind==='movement'){
      var av=Number(seg.vals.arrival);segA=Math.round(seg.clip.start*1000);
      segB=isFinite(av)&&av>seg.clip.start?Math.round(av*1000):segA-1;
    }
    rows.forEach(function(v,i){
      var tr=n('tr',undefined,tbody),idx=i;
      if(session.nodeSel===rows[idx]){tr.setAttribute('data-sel','1');tr.style.background='rgba(255,208,145,.14)'} // B4：行内微调行随选中节点高亮
      else if(seg&&function(){var t=Math.round(Number(rows[idx].time)*1000);return t>=segA&&t<=segB}()){tr.setAttribute('data-win','1');tr.style.background='rgba(143,183,255,.16)'} // B9：窗口行高亮
      nodeInput(tr,kind==='movement'?('路径节点'+(i+1)+' 到达秒'):('朝向节点'+(i+1)+' 到达秒'),v.time,function(e){rows[idx].time=e.target.value});
      if(kind==='movement'){
        nodeInput(tr,'路径节点'+(i+1)+' X 米',v.x,function(e){rows[idx].x=e.target.value});
        nodeInput(tr,'路径节点'+(i+1)+' Z 米',v.z,function(e){rows[idx].z=e.target.value});
        var tdM=n('td',undefined,tr),sel=n('select',undefined,tdM);sel.className='wb-node-in';sel.setAttribute('aria-label','路径节点'+(i+1)+' 移动模式');
        [['walk','走路'],['run','跑步']].forEach(function(o){var op=n('option',o[1],sel);op.value=o[0]});
        sel.value=v.move==='run'?'run':'walk';
        sel.title='走路=慢速步行；跑步=快速跑动。游戏整场按节点切换步态；网页预览按时刻插值位置，不区分走/跑动画';
        sel.onchange=function(){if(sel.value==='run')rows[idx].move='run';else delete rows[idx].move;refreshDirtyHint()};
      }else{
        nodeInput(tr,'朝向节点'+(i+1)+' 朝向°',v.yaw,function(e){rows[idx].yaw=e.target.value});
      }
      var td=n('td',undefined,tr);
      var b=button('移除',td,function(){if(session.nodeSel===rows[idx])session.nodeSel=null;session.draft[kind].splice(idx,1);session.status='已从草稿移除节点（未应用；点「应用」保存；取消可还原）';destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars()});
      b.className='btn small';
    });
    return wrap;
  }
  function addDraftNode(kind){
    if(!session)return;
    var s=root.store,CE=root.ChoreoEdit.pure,base=CE.placementFor(s.dancers,session.di),list=session.draft[kind],last=list[list.length-1]||null;
    if(kind==='movement')list.push({time:String(last?Number(last.time)+2:2),x:String(last?last.x:base.x),z:String(last?last.z:base.z)});
    else list.push({time:String(last?Number(last.time)+2:2),yaw:String(last?last.yaw:base.yawDeg)});
    session.status='已添加草稿节点（时刻须大于 0 且严格递增；点「应用」保存）';destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
  }
  function addAtPlayhead(kind){
    if(!session)return;
    var s=root.store,t=Math.round((s.currentTime||0)*1000)/1000;
    if(!(t>0)){barStatus('播放头在 0 秒：先把播放头移到要到达的时刻再加节点（节点时刻须大于 0 且严格递增）');return}
    var list=session.draft[kind];
    if(list.some(function(v){return Math.round(Number(v.time)*1000)===Math.round(t*1000)})){barStatus(fmtN(t)+'s 已有同刻节点：请把播放头移到其他时刻，或在数值表里改');return}
    // B3 HF-03：默认位置＝该时刻按当前草稿轨迹的真实采样（经产品解析器+采样器），插入本身不改变轨迹。
    var at;
    try{
      var all=P.edit(s,session.di,{movement:session.draft.movement,facing:session.draft.facing},'wb-draft-preview');
      var preview={dancers:s.dancers,contentExtra:{_doc:Object.assign({},s.contentExtra&&s.contentExtra._doc,{extraTracks:all})}};
      var base=root.ChoreoEdit.pure.placementFor(s.dancers,session.di);
      at=P.sample(preview,session.di,Math.round(t*1000),base);
    }catch(e){barStatus((e.message||String(e))+'——先修正数值表中的输入，或点「取消修改」还原后再加节点');return}
    if(kind==='movement')list.push({time:fmtN(t),x:fmtN(at.x),z:fmtN(at.z)});
    else list.push({time:fmtN(t),yaw:fmtN(at.yawDeg)});
    list.sort(function(a,b){return Number(a.time)-Number(b.time)});
    session.status='已在 '+fmtN(t)+'s 加入草稿节点（位置＝该时刻按当前草稿的采样；点「应用」保存）';destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
  }
  function clearMovementDraft(){if(!session)return;session.draft.movement=[];session.status='已清空草稿中的路径节点（点「应用」保存；应用后一次撤销）';destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars()}
  function resetDraft(){if(!session)return;try{session.draft=P.nodes(root.store,session.di)}catch(e){}session.baseNodes=JSON.parse(JSON.stringify(session.draft));session.nodeSel=null;session.status='已取消修改（草稿还原为已保存值，零改动）';destroyBar();if(root.refreshWorkbenchBars)root.refreshWorkbenchBars()}
  // B9 提交链统一：整轨草稿一次提交（「应用一段」与「应用整条」共用同一提交链）——P.edit 预检通过后
  // 可选保留窗外原字节（含扩展字段；窗口快捷段路径），再比对、一次写入＋恰好一次 saveHistory、重取
  // 基线。返回 'ok'｜'noop'｜'dead'｜{fail:错误信息}。
  function commitDraft(tag,preserve){
    var se=session,s=root.store;
    if(!se||!sessionAlive(se)){session=null;refreshBarNow();return 'dead'}
    try{
      var all=P.edit(s,se.di,{movement:se.draft.movement,facing:se.draft.facing},tag||('wbedit-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)));
      if(preserve)all=preserve(all);
      if(JSON.stringify(all)===JSON.stringify(P.tracks(s))){barStatus('与已保存一致，未重复保存');se.baseNodes=JSON.parse(JSON.stringify(se.draft));se.nodeSel=null;refreshBarNow();return 'noop'}
      P.install(s,all);root.updateTotalDuration();root.saveHistory();root.render();
      se.draft=P.nodes(s,se.di);se.baseline=JSON.stringify(P.tracks(s));se.baseNodes=JSON.parse(JSON.stringify(se.draft));se.nodeSel=null;se.status='已应用（一次撤销）';
      return 'ok'
    }catch(e){var msg=e.message||String(e);barStatus(msg);return {fail:msg}}
  }
  function commitSession(){
    var se=session,s=root.store;
    if(!se||!sessionAlive(se)){session=null;refreshBarNow();return}
    if(playing()){barStatus('请先暂停再应用走位');return}
    // B9：窗口快捷段有未应用输入时先并入草稿（同一份草稿、同一次提交）；段自身拒绝＝中止本次提交
    var sp=samePlace,segBaked=false,prevMovement=null;
    if(segForSession(se)&&segDirty()){
      if(!sp.dest){setStatus('请先在俯视图里点一个目的地',true);return}
      var arrive=Number(sp.vals.arrival);
      if(!isFinite(arrive)||arrive<=sp.clip.start){setStatus('到达时刻须为数字且晚于动作开始（'+fmtT(Math.round(sp.clip.start*1000))+'s）；移动用时须为大于 0 的秒数',true);return}
      var startMs=Math.round(sp.clip.start*1000);
      if(startMs<0){setStatus('出发时刻不得小于零，未做改动',true);return}
      var arriveMs=Math.round(arrive*1000);
      var base=root.ChoreoEdit&&root.ChoreoEdit.pure,p0=base?base.placementFor(s.dancers,sp.di):{x:0,z:0};
      var preview=s;
      try{var pre=P.edit(s,se.di,{movement:se.draft.movement,facing:se.draft.facing},'draft');preview={dancers:s.dancers,contentExtra:{_doc:Object.assign({},s.contentExtra&&s.contentExtra._doc,{extraTracks:pre})}}}catch(e){preview=s}
      var nodes;
      try{nodes=P.t1Window(se.draft.movement,startMs,arriveMs,sp.dest,sp.vals.mode==='run'?'run':undefined,preview,sp.di,p0)}
      catch(e){setStatus(e.message,true);return}
      prevMovement=se.draft.movement;
      se.draft.movement=nodes;se.nodeSel=null;se.overlay=null;segBaked=true;
    }
    var r=commitDraft();
    if(r&&typeof r==='object'&&r.fail){
      if(segBaked){se.draft.movement=prevMovement}
      refreshBarNow();return;
    }
    if(r==='ok'){
      if(segBaked)endSamePlace(); // 段输入已随整轨提交消费：快捷段收起（会话保持干净态）
      refreshBarNow();
      root.showToast(se.kind==='facing'?'独立朝向已保存（↶ 可撤销）':'走位已保存（↶ 可撤销）');
    }
  }
  // B9：窗口快捷段子表单（宿主＝会话栏；元素 id/文案沿用旧 wbMoveBar，舞台侧不再持有第二套草稿条）。
  // 值全部读写段子表单状态（samePlace.vals），栏重建（节点增删/拖动/状态变化）不丢输入。
  function buildSegmentUI(box){
    var sp=samePlace;
    if(!sp||!segForSession(session))return;
    var bar=n('div',undefined,box);bar.className='wb-move-bar';bar.id='wbMoveBar';bar.setAttribute('role','group');bar.setAttribute('aria-label','同处走位·窗口快捷段');
    bar.style.cssText='flex-basis:100%;margin:2px 0';
    // 首条旅程 J5：同一操作区显示舞者、动作、出发、移动用时、到达——不必回看上方选的是谁
    var title=n('b',undefined,bar);title.className='wb-move-title';title.id='wbMoveTitle';
    title.textContent=root.store.dancers[sp.di].name+' · 为「'+((sp.clip.data&&sp.clip.data.name)||'动作')+'」排走位';
    n('span',fmtT(Math.round(sp.clip.start*1000))+'s 出发',bar).className='wb-move-sub';
    // 主字段=移动用时（到达=出发+用时的界面换算，毫秒精度沿用）；绝对到达收进「更多设置」，两者共享这份段子表单
    var wDur=n('label','移动用时(秒) ',bar);wDur.className='wb-move-field';
    var dur=n('input',undefined,wDur);dur.type='number';dur.min='0.5';dur.step='0.5';dur.id='wbMoveDur';dur.value=sp.vals.dur;
    dur.setAttribute('aria-label','移动用时（秒）');
    var bReset=button('重置为默认',bar,function(){resetDefaultTimes();refreshWindowNote();setStatus('已恢复片段默认用时；目的地保留',false)});bReset.id='wbMoveReset';
    var eta=n('span',sp.etaText,bar);eta.className='wb-move-sub';eta.id='wbMoveEta';
    var wMode=n('label','',bar);wMode.className='wb-move-field';
    var mode=n('select',undefined,wMode);mode.id='wbMoveMode';mode.setAttribute('aria-label','移动模式');
    [['walk','走路'],['run','跑步']].forEach(o=>{var op=n('option',o[1],mode);op.value=o[0]});
    mode.value=sp.vals.mode;
    mode.title='走路=慢速步行；跑步=快速跑动。游戏整场按节点切换步态；网页预览按时刻插值位置，不区分走/跑动画';
    // 更多设置（专家参数）：绝对到达时刻＋换算与独立轨说明
    var fold=document.createElement('details');fold.className='wb-move-more';fold.id='wbMoveMore';
    var foldSum=document.createElement('summary');foldSum.textContent='更多设置（绝对到达等）';fold.appendChild(foldSum);
    var wArr=n('label','到达时刻(秒) ',fold);wArr.className='wb-move-field';
    var arrival=n('input',undefined,wArr);arrival.type='number';arrival.min='0.5';arrival.step='0.5';arrival.id='wbMoveArrival';arrival.value=sp.vals.arrival;
    arrival.setAttribute('aria-label','到达时刻（秒）');
    n('span','到达=出发+移动用时，改任一个另一个跟着变。走位是独立轨：以后改动作的时刻不会自动移动这段走位，也不会改游戏映射。',fold).className='wb-move-note';
    bar.appendChild(fold);
    // 应用走位＝并入统一草稿一次提交；清除＝T3 直接提交；取消＝收起快捷段（零写入）
    var bApply=button('应用走位',bar,applySamePlace);bApply.className='btn primary';bApply.id='wbMoveApply';
    bApply.title='立即保存这段走位（可 ↶ 撤销）：从片段开始时刻出发，按「移动用时」在到达时刻走到目的地；这一时间窗口里已有的走位节点会被替换（并入当前整条草稿一次提交，一步撤销）';
    var bClear=button('清除这条走位',bar,clearSamePlace);bClear.id='wbMoveClear';
    bClear.title='删除这段时间里已保存的走位节点（可 ↶ 撤销）；按「到达时刻」框的当前值界定这一段';
    var bCancel=button('取消',bar,function(){closeSegmentWith();root.showToast('已取消走位编辑，未做任何改动')});bCancel.id='wbMoveCancel';
    bCancel.title='关闭窗口快捷段与本次走位编辑，不改任何内容';
    var status=n('span',sp.statusText,bar);status.id='wbMoveHint';status.className='wb-move-hint'+(sp.statusWarn?' warn':'');status.setAttribute('role','status');
    var win=n('span',sp.windowText,bar);win.id='wbMoveWindow';win.className='wb-move-hint';
    // 换算双向同步（写状态＋同步已挂元素）；用时无效（空/0/负/非数）时到达一并置空，应用必被拒绝
    dur.oninput=function(){var s2=samePlace;if(!s2)return;s2.vals.dur=dur.value;var v=Number(dur.value);s2.vals.arrival=(isFinite(v)&&v>0)?fmtT(Math.round((s2.clip.start+v)*1000)):'';var a2=segEl('wbMoveArrival');if(a2)a2.value=s2.vals.arrival;refreshEta();refreshWindowNote();refreshDirtyHint()};
    arrival.oninput=function(){var s2=samePlace;if(!s2)return;s2.vals.arrival=arrival.value;var a=Number(arrival.value);if(isFinite(a)&&a>s2.clip.start){s2.vals.dur=fmtT(Math.round((a-s2.clip.start)*1000));var d2=segEl('wbMoveDur');if(d2)d2.value=s2.vals.dur}refreshEta();refreshWindowNote();refreshDirtyHint()};
    mode.onchange=function(){var s2=samePlace;if(s2)s2.vals.mode=mode.value;refreshDirtyHint()};
  }
  function buildBar(){
    var s=root.store,se=session,isFacing=se.kind==='facing';
    var box=n('section');box.className='wb-ctx stage-motion-ctx';box.id='wbCtx';box.setAttribute('aria-label',isFacing?'独立朝向就地编辑':'走位就地编辑');
    var tEl=n('span',(isFacing?'「独立朝向 · ':'「走位 · ')+s.dancers[se.di].name+'」',box);tEl.className='wb-ctx-name';tEl.id='wbMotionTitle';
    var sum=n('span','',box);sum.className='wb-ctx-field';sum.id='wbMotionSummary';
    sum.textContent=isFacing?('朝向节点 '+se.draft.facing.length+' 个'):('路径节点 '+se.draft.movement.length+' 个 · 朝向节点 '+se.draft.facing.length+' 个');
    buildSegmentUI(box); // B9：窗口快捷段＝会话内子表单（打开同处走位时随会话栏出现并定位该动作窗口）
    var acts=n('div',undefined,box);acts.className='wb-ctx-actions';
    var addB=button(isFacing?'＋ 在播放头加朝向节点':'＋ 在播放头加节点',acts,function(){addAtPlayhead(isFacing?'facing':'movement')});
    addB.id='wbMotionAdd';addB.title='节点到达时刻=当前播放头（须大于 0 且严格递增）；默认位置＝该时刻按当前草稿的真实采样；先加入草稿，点「应用」才保存';
    if(!isFacing){var clr=button('删除这段走位',acts,clearMovementDraft);clr.id='wbMotionClear';clr.className='btn danger';clr.title='清空这条走位的路径节点（草稿；点「应用」后一次撤销）'}
    // B3 TD-01：「未应用提示 · 应用 · 取消」常驻可见（不再藏进「节点数值表」折叠区）；折叠区只留数值表本身。
    var dirtyEl=n('span','',acts);dirtyEl.id='wbMotionDirty';dirtyEl.className='wb-ctx-field wb-motion-dirty';
    var noteEl=n('span','',acts);noteEl.id='wbMotion3dNote';noteEl.className='wb-ctx-field';
    noteEl.title='俯视图实时画草稿；3D/执行预览读已保存值，点「应用」后同步（R3 显示口径）';
    var apply=button(isFacing?'应用朝向':'应用走位',acts,commitSession);apply.id='wbMotionApply';apply.className='btn primary';
    apply.title=isFacing?'立即保存朝向节点（一次撤销）':'立即保存路径与朝向节点（一次撤销）';
    var cancel=button('取消修改',acts,resetDraft);cancel.id='wbMotionCancel';cancel.className='btn';
    cancel.title='放弃未应用修改，草稿还原为已保存值（会话保持）';
    if(!isFacing&&se.nodeSel&&se.draft.movement.indexOf(se.nodeSel)>=0){
      // B3 HF-05：节点级删除（与键盘 Delete 同一分派＝choreo-app.deleteSelectedClips，经选择摘要走 T2 语义）。
      var dn=button('删除选中节点',acts,function(){if(root.deleteSelectedClips)root.deleteSelectedClips()});
      dn.id='wbMotionDelNode';dn.className='btn danger';
      dn.title='删除选中的路径节点（画布已显示删除后连线预览；立即保存，一次撤销）';
    }
    var closeB=button('关闭',acts,function(){
      // B3 TD-01：脏会话关闭必须确认并列出未应用修改数，不得静默丢弃（B9：单一判据含窗口快捷段）。
      var dirty=sessionDirtyCount(se);
      if(dirty>0&&root.confirm&&!root.confirm('就地编辑未应用 '+dirty+' 处修改'+((segForSession(se)&&segDirty())?'（含窗口快捷段）':'')+'，关闭将丢弃这些修改。确定关闭？'))return;
      clearSelection();
    });closeB.id='wbMotionClose';closeB.title='收起就地编辑（有未应用修改时会先确认）';
    var legacy=button('旧版专家面板（快捷转向 / 二维预览 / 游戏路径）…',acts,function(){var di=se.di;open(di)});
    legacy.id='wbMotionLegacy';legacy.className='btn small wb-motion-legacy';
    legacy.title='保留原浮窗全部专家能力（不删除）：快捷原地转向/前进、二维走位预览与速度指标、游戏单人路径、编辑起始站位';
    var fold=document.createElement('details');fold.className='wb-ctx-expert stage-motion-tables';fold.id='wbMotionTable';
    fold.appendChild(n('summary','节点数值表（精确编辑）'));
    var body=n('div',undefined,fold);body.className='wb-ctx-expert-body';
    if(!isFacing)body.appendChild(buildNodeTable('movement'));
    body.appendChild(buildNodeTable('facing'));
    var tools=n('div',undefined,body);tools.className='wb-ctx-actions';
    if(!isFacing){var ap=button('添加路径节点',tools,function(){addDraftNode('movement')});ap.id='wbMotionAddPath';ap.className='btn small'}
    var af=button('添加朝向节点',tools,function(){addDraftNode('facing')});af.id='wbMotionAddFacing';af.className='btn small';
    var st=n('p','',box);st.className='wb-ctx-preview';st.id='wbMotionStatus';st.setAttribute('role','status');if(se.status)st.textContent=se.status;
    box.appendChild(fold);
    if(!isFacing&&(se.nodeSel&&se.draft.movement.indexOf(se.nodeSel)>=0||segForSession(se)))fold.open=true; // B4：点按节点＝选中并出行内微调行；B9：窗口快捷段打开＝定位/高亮该动作窗口
    refreshDirtyHint(dirtyEl,noteEl); // B3-RT-01：栏尚未插入文档，须直传新元素，干净态即显「已与保存一致」
    return {node:box,destroy:function(){}};
  }
  function renderContext(){
    if(session&&!sessionAlive(session)){session=null;destroyBar()}
    if(!session){if(samePlace)endSamePlace();destroyBar();return null} // B9：会话失联＝快捷段一并收起
    var key=session.kind+':'+session.projectId+':'+session.di;
    if(mctx&&mctx.key===key)return mctx.node;
    destroyBar();
    var built=buildBar();
    mctx={key:key,node:built.node,destroy:built.destroy};
    return mctx.node;
  }
  // B3：选择摘要（走位/朝向侧）——B9 单一草稿面：就地会话＝唯一对象（有节点选中时为节点级，身份＝
  // 草稿对象引用；窗口快捷段打开时为窗口级（R3 §二 时间窗身份，span 毫秒））；dirty＝单一判据
  // sessionDirtyCount（整轨草稿 diff＋窗口快捷段），供通用 Delete 总事务按 R5-06 决定拒绝/关闭。只读。
  function selectionDetail(){
    var out=[];
    if(session&&sessionAlive(session)){
      var kind=session.kind==='motion'?'movement':'facing';
      var o={di:session.di,kind:kind,level:'track',dirty:sessionDirtyCount(session)>0};
      if(session.nodeSel){
        var i=session.draft[kind].indexOf(session.nodeSel);
        if(i>=0){o.level='node';o.node=JSON.parse(JSON.stringify(session.draft[kind][i]));o.nodeIndex=i}
        else o.missing=true;
      }else if(kind==='movement'&&segForSession(session)){
        o.level='window';
        var a=Number(samePlace.vals.arrival);
        if(isFinite(a)&&a>samePlace.clip.start)o.span=[Math.round(samePlace.clip.start*1000),Math.round(a*1000)];
        o.clipId=samePlace.clip.id;
      }
      out.push(o);
    }
    return out;
  }
  // B3 R5-06：成功提交后关闭「受影响舞者」的干净会话并重取基线；其他舞者的会话不动。
  function discardSessionIfDancer(dis){
    if(session&&sessionAlive(session)&&dis.indexOf(session.di)>=0){session=null;destroyBar()}
    if(samePlace&&dis.indexOf(samePlace.di)>=0)endSamePlace();
    if(root.refreshWorkbenchBars)root.refreshWorkbenchBars();
  }
  root.ChoreoStageMotionUI={open,lane,openSamePlace,samePlaceActive,samePlaceState,pickSamePlace,drawSamePlace,endSamePlace,
    selectMotion,openFacing,clearSelection,renderContext,pickTopPath,pickTopNode,nodeAt,dragNodeStart,dragNodeMove,dragNodeEnd,dragActive,
    cycleHit,drawSelected,sessionActive,sessionState,selectionDetail,discardSessionIfDancer};
})(window);
