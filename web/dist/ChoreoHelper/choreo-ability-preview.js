// 3D 技能排练覆盖层：读取同一播放头，标注咏唱/表现阶段与目标；不驱动骨骼或游戏。
(function(root){
  'use strict';var layer=null,signature='';
  function draw(panel,canvas,state,project,motionStatus,motionRows){
    if(!layer||layer.parentNode!==panel){if(layer)layer.remove();layer=document.createElement('div');layer.className='ability-preview';layer.style.cssText='position:absolute;pointer-events:none;overflow:hidden;z-index:2';panel.appendChild(layer);signature=''}
    layer.style.left=canvas.offsetLeft+'px';layer.style.top=canvas.offsetTop+'px';layer.style.width=canvas.clientWidth+'px';layer.style.height=canvas.clientHeight+'px';
    var rows=root.ChoreoAbilityPlan.active(state,Math.round((state.currentTime||0)*1000)),w=canvas.clientWidth,h=canvas.clientHeight;
    (motionRows||[]).forEach(r=>{var i=rows.findIndex(x=>x.id===r.id&&x.source===r.source);if(i<0)rows.push(r);else rows[i]=r});
    if(motionStatus)rows.forEach(r=>{r.animation=motionStatus(r.id)});
    var points=rows.map(r=>({a:project(r.sourceIndex),b:r.targetKind==='enemyMarker'?{x:w*.82,y:h*.58}:project(r.targetIndex,r.targetPosition)}));
    var sig=JSON.stringify({rows:rows.map(r=>Object.assign({},r,{remainingMs:Math.ceil(r.remainingMs/100)*100})),points:points.map(p=>({a:p.a&&{x:Math.round(p.a.x),y:Math.round(p.a.y)},b:p.b&&{x:Math.round(p.b.x),y:Math.round(p.b.y)}})),w,h});
    if(sig===signature)return;signature=sig;layer.replaceChildren();if(!rows.length)return;
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',w);svg.setAttribute('height',h);svg.style.cssText='position:absolute;inset:0';layer.appendChild(svg);
    function shape(tag,attrs){var e=document.createElementNS(svg.namespaceURI,tag);Object.keys(attrs).forEach(k=>e.setAttribute(k,attrs[k]));svg.appendChild(e);return e}
    rows.slice(0,12).forEach(function(r,i){var p=points[i],color=r.targetKind==='enemyMarker'?'#ffca88':'#88eaff';
      if(p.a&&p.b){shape('line',{x1:p.a.x,y1:p.a.y,x2:p.b.x,y2:p.b.y,stroke:color,'stroke-width':2,'stroke-dasharray':'5 4'});shape('circle',{cx:p.b.x,cy:p.b.y,r:13,fill:'none',stroke:color,'stroke-width':2});var tx=shape('text',{x:Math.min(w-140,Math.max(4,p.b.x+17)),y:Math.max(18,p.b.y),fill:color,'font-size':12});tx.textContent=r.targetLabel;}
    });
    var cards=document.createElement('div');cards.style.cssText='position:absolute;left:8px;top:8px;max-width:85%;max-height:45%;overflow:hidden;color:#e7f8ff;font-size:12px;text-shadow:0 1px 2px #000';layer.appendChild(cards);
    rows.slice(0,12).forEach(function(r){var n=document.createElement('div');n.className='ability-preview-cue';n.dataset.eventId=r.id;n.style.cssText='background:#102535e8;border-left:3px solid #88eaff;padding:5px 8px;margin-bottom:4px;border-radius:3px';n.textContent=r.sourceName+' · '+r.name+' · '+r.phase+' · '+r.targetLabel+' · 剩余 '+(Math.ceil(r.remainingMs/100)/10).toFixed(1)+'s\n'+r.animation;n.style.whiteSpace='pre-line';cards.appendChild(n)});
    if(rows.length>12){var more=document.createElement('div');more.textContent='另有 '+(rows.length-12)+' 个同时技能提示，请查看技能轨';cards.appendChild(more)}
  }
  root.ChoreoAbilityPreview={draw};
})(window);
