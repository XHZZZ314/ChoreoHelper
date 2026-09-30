// 走位/独立朝向节点编辑与二维预览：复用舞台坐标、现有播放头、项目保存和撤销。
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
    var canvas=n('canvas',undefined,box);canvas.width=560;canvas.height=230;canvas.style.cssText='width:100%;height:230px;background:#0b1422';canvas.setAttribute('aria-label','二维舞台走位与朝向预览');
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
      if(!t)return;ctx.strokeStyle='#71c9b4';ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>{var q=CE.stageWorldToScreen(p.x,p.z,t);i?ctx.lineTo(q.sx,q.sy):ctx.moveTo(q.sx,q.sy)});ctx.stroke();
      points.forEach((p,i)=>{var q=CE.stageWorldToScreen(p.x,p.z,t);ctx.fillStyle='#91aaba';ctx.beginPath();ctx.arc(q.sx,q.sy,4,0,Math.PI*2);ctx.fill();ctx.fillText(i+' · '+(p.tMs||0)/1000+'s',q.sx+7,q.sy-5)});
      // 朝向节点小箭头：按该时刻采样位置与角度显示独立转身，与路径点区分。
      var yawOwn=all.find(t=>P.owned(t)&&t.type==='facing'&&t.performerId===P.pid(s,di));
      (yawOwn?yawOwn.events[0].data.stageMotion.points:[]).forEach((p,i)=>{var fp=P.sample(preview,di,p.tMs,live),q=CE.stageWorldToScreen(fp.x,fp.z,t),a=fp.yawDeg*Math.PI/180;ctx.save();ctx.translate(q.sx,q.sy);ctx.rotate(a);ctx.strokeStyle='#8fb7ff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,6);ctx.lineTo(0,-12);ctx.moveTo(-4,-7);ctx.lineTo(0,-12);ctx.lineTo(4,-7);ctx.stroke();ctx.restore();ctx.fillStyle='#8fb7ff';ctx.fillText('⟲'+(i+1)+' '+(p.tMs/1000)+'s',q.sx+8,q.sy+12)});
      var q=CE.stageWorldToScreen(at.x,at.z,t),a=at.yawDeg*Math.PI/180;ctx.save();ctx.translate(q.sx,q.sy);ctx.rotate(a);ctx.fillStyle='#ffc46b';ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(9,9);ctx.lineTo(-9,9);ctx.closePath();ctx.fill();ctx.restore();
      var metric=P.metrics(preview,di,live),length=metric.distanceM;
      var speed=metric.speedSegments.map((v,i)=>(i+1)+'段 '+v.speedMps.toFixed(2)+' 米/秒'+(v.move==='run'?' · 跑步':' · 走路')).join('、'),turn=metric.turnSegments.map((v,i)=>(i+1)+'段 '+v.turnDegPerSecond.toFixed(1)+'°/秒').join('、');
      notice.textContent='路径各段要求：'+(speed||'无路径')+'。朝向各段要求：'+(turn||'无独立转身')+'。'+(metric.exceedsNativeTrial?'超过单段4秒/1.5米：整场审阅登记时会按原节点自动无损切分为多段链式执行（整场最长5分钟）。':'处于单段4秒/1.5米包络内，可直接整场登记。')+'独立朝向仅网页排练，游戏执行须插件宣告 stageFacingV1 后另行接入；移动可能打断动作；不会改速、延时或静默忽略路径。';
      info.textContent='草稿二维预览 · 播放头 '+s.currentTime.toFixed(3)+'s · X '+at.x.toFixed(2)+' / Z '+at.z.toFixed(2)+' / '+at.yawDeg.toFixed(1)+'° · 路径全长 '+length.toFixed(2)+' 米'+(metric.facingDurationMs?' · 朝向编排便 '+(metric.facingDurationMs/1000)+' 秒':'')+'。应用后进入 3D；游戏速度未校准。';
    }frame();return box;
  }
  function lane(di){var s=root.store,lane=n('div');lane.className='lane stage-motion-lane';lane.style.height='34px';var label=n('div','走位 / 朝向',lane);label.className='lane-label';label.style.cursor='pointer';label.onclick=()=>open(di);var body=n('div',undefined,lane);body.className='lane-body';body.style.cssText='position:relative;height:34px';
    var b=button('＋ 编排路径节点',body,()=>open(di));b.className='btn stage-motion-open';b.style.cssText='position:sticky;left:0;z-index:2;font-size:11px';
    var who=P.pid(s,di);P.tracks(s).filter(t=>['movement','facing'].includes(t.type)&&t.performerId===who).forEach(t=>(t.events||[]).forEach(e=>{
      var facing=t.type==='facing',b=button((facing?'⟲ 朝向 · ':'↗ 走位 · ')+(e.durationMs/1000)+'s',body,()=>open(di));
      b.className='stage-motion-clip';b.style.cssText='position:absolute;top:3px;height:27px;background:'+(facing?'#233d5e':'#204b40')+';color:'+(facing?'#cfe0ff':'#d6ffef')+';border:1px solid '+(facing?'#8fb7ff':'#71c9b4')+';border-radius:4px;overflow:hidden;white-space:nowrap';
      b.style.left=e.startMs/1000*s.pps+'px';b.style.width=Math.max(140,e.durationMs/1000*s.pps)+'px';
      b.title=facing?'编辑独立朝向节点；仅网页排练，游戏执行未开放':'编辑路径节点；网页排练，游戏短路径须单独审阅';b.onmousedown=ev=>ev.stopPropagation();if(P.owned(t))label.textContent='走位 / 朝向 ✎'}));return lane}
  root.ChoreoStageMotionUI={open,lane};
})(window);
