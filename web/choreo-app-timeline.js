// 编舞助手时间轴渲染分件（OVERHAUL 批 C 第五步从 choreo-app.js 拆出）：
// 时间轴横向窗口化渲染（timelineWindow/renderTimelineArea/renderLane/renderClip/renderRuler）、
// 拖动/拉长/框选手势（dragClip）、右键菜单（showCtxMenu）与空态引导。同全局名文件级搬家，
// 行为逐字不变；须在 choreo-app.js 之前加载（装时机语句自足，沿拆分件先于消费者先例）。
'use strict';

// P5（渲染性能）：时间轴横向窗口——只渲染可见时间窗内的片段与刻度（长项目节点数不再随总长增长）。
// 拖动/拉长手势期间整段不裁剪（suspended），被拖的节点不会被中途移除或替换。
function timelineWindow(force,elWrap){
  if(_tlWinCache&&!force)return _tlWinCache;
  var w=elWrap||document.getElementById('timelineWrap');
  var vp=w?(w.clientWidth||0):0,sl=w?w.scrollLeft:0;
  var cull=!store._clipDragActive&&vp>0&&!!(typeof window!=='undefined'&&window.ChoreoRenderPerf);
  var r=cull?window.ChoreoRenderPerf.visibleRange({scrollLeft:sl,viewportPx:vp,labelW:LABEL_W,pps:store.pps,overscanSec:(vp/store.pps)*TL_OVERSCAN_VIEWPORTS}):{start:0,end:Math.max(store.totalDuration,30)};
  r.suspended=!cull;_tlWinCache=r;return r;
}
function markWindowDirty(){var c=clock();if(!c)return;c.mark(RK.window);c.requestFrame()}
// 滚动/缩放后只补渲窗口差量：窗口没变就一次 DOM 都不动
function refreshTimelineWindow(){
  if(store._clipDragActive)return false; // 手势中绝不重建节点
  var r=timelineWindow(true),p=_tlWinRange;
  if(p&&p.start===r.start&&p.end===r.end&&p.suspended===r.suspended)return false;
  _tlWinRange=r;renderRuler();reflowLanes(r);return true;
}
function reflowLanes(r){
  var bodies=document.querySelectorAll('#lanes .lane-body'),i;
  Array.prototype.forEach.call(bodies,function(b){
    var m=b.__laneMeta;if(!m)return; // 全局歌词轨不参与窗口化
    var d=store.dancers[m.di];if(!d)return;
    var vis=window.ChoreoRenderPerf.visibleClips(d[m.tt+'Clips']||[],r,{suspended:r.suspended});
    var ids=[];for(i=0;i<vis.length;i++)ids.push(vis[i].id);
    var key=ids.join(',');
    if(b.__laneKey===key)return;
    for(i=0;i<(b.__laneIds||[]).length;i++)delete _clipNodes[b.__laneIds[i]];
    b.__laneKey=key;b.__laneIds=ids;b.innerHTML='';
    for(i=0;i<vis.length;i++)b.appendChild(renderClip(vis[i],m.di,m.tt,m.lh));
    if(m.tt==='action'&&window.ChoreoWorkbench)ChoreoWorkbench.appendWaitBands(b,d);
  });
}
var _mqJustDone=false; // 框选刚结束时为真：吞掉紧随的 click，避免框选完播放头乱跳
var _wbUnusedFoldOpen=false; // O-2：#wbUnused 用户展开态（会话内跨重绘保持；重载初始收起）
function renderTimelineArea(){
  var ta=el('div','tl-area');
  var tr=el('div','transport');
  tr.appendChild(el('strong','timeline-section-title','时间轴'));
  var zc=el('div','ctrl');
  var zo=el('button','btn icon','-');zo.onclick=function(){store._ppsTouched=true;store.pps=Math.max(10,store.pps/1.5);render()};zc.appendChild(zo);
  var zoomLabel=el('span','',Number(store.pps.toFixed(2))+'px/s');zoomLabel.title='时间轴缩放：每秒对应的屏幕像素数；只改变显示，不改变编排时间';zc.appendChild(zoomLabel);
  var zi=el('button','btn icon','＋');zi.onclick=function(){store._ppsTouched=true;store.pps=Math.min(200,store.pps*1.5);render()};zc.appendChild(zi);
  tr.appendChild(zc);
  tr.appendChild(el('span','\u603B:'));tr.appendChild(el('span','',store.totalDuration+'秒'));
  var bAdd=el('button','btn','＋60秒');
  bAdd.title='\u8F68\u9053\u52A0\u957F60\u79D2\uFF08\u62D6\u52A8\u9499\u5236\u5728\u8F68\u9053\u672B\u7AEF\uFF0C\u9700\u8981\u66F4\u957F\u5C31\u70B9\u8FD9\u91CC\uFF09';
  bAdd.onclick=function(){store.totalDuration+=60;saveHistory();render();showToast('\u8F68\u9053\u5DF2\u52A0\u957F\u5230 '+store.totalDuration+' \u79D2')};
  tr.appendChild(bAdd);
  // WP-3b：A-B 循环（仅网页播放）+ 段落标记。游戏模式没有循环端点，A/B 禁用
  var gm=store.previewTarget==='game';
  var bLA=el('button','btn small'+(store.loopA!=null?' active':''),'A');
  bLA.title='在播放头设循环起点 A：网页播放只在 A~B 之间循环。游戏模式不支持（插件没有循环端点）';
  bLA.disabled=gm;bLA.onclick=function(){setLoopPoint('loopA')};tr.appendChild(bLA);
  var bLB=el('button','btn small'+(store.loopB!=null?' active':''),'B');
  bLB.title='在播放头设循环终点 B（A、B 谁在后自动当终点）';
  bLB.disabled=gm;bLB.onclick=function(){setLoopPoint('loopB')};tr.appendChild(bLB);
  var bLX=el('button','btn small','\u2715');
  bLX.title='清除 A-B 循环';
  bLX.disabled=gm;bLX.onclick=clearLoop;tr.appendChild(bLX);
  var bMk=el('button','btn small','\u2691+');
  bMk.title='在播放头添加段落标记（随项目保存）。标尺上旗标：点击跳转、右键改名/改时间/删除';
  bMk.onclick=addMarkerAtPlayhead;tr.appendChild(bMk);
  tr.appendChild(el('div','spacer'));
  // P2：删除/选择信息把技能片段一起算进来（删除仍是一次撤销；技能的就地编辑在下方上下文栏）
  var _an=edSel().length,_sn=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection().length:0;
  if(store.selectedClip||_an||_sn){
    var sc=store.selectedClip||(_an?edSel()[0].clip:null);
    var nsel=_an+_sn;
    if(sc)tr.appendChild(el('span','transport-selection',(nsel>1?('已选 '+nsel+' 条 · '):'')+sc.data.name+' '+sc.start.toFixed(1)+'→'+(sc.start+sc.duration).toFixed(1)+' ('+sc.duration.toFixed(1)+'s)'));
    else tr.appendChild(el('span','transport-selection','已选 '+_sn+' 个技能片段 · 在下方上下文栏就地编辑或删除'));
    var selectedTime=tr.querySelector('.transport-selection');if(selectedTime)selectedTime.title='选中片段摘要按 0.1 秒显示；精确时间请在下方编辑';
    // 单选编辑时间在下方主编辑区；不再并列第二个表单入口。
    if(_an>1)tr.appendChild(el('span','selection-secondary','Ctrl+点击加选 · 拖动整体平移 · Ctrl+C/V 复制粘贴（精确平移在下方上下文栏「平移…」）'));
    if(nsel>1){var bd=el('button','btn danger selection-secondary','删除所选');bd.onclick=deleteSelectedClips;tr.appendChild(bd);}
  }else{
    tr.appendChild(el('span','\u672A\u9009\u4E2D'));
  }
  ta.appendChild(tr);
  // P3：数值化精确 A/B 输入（会话级 loopA/B 语义与游戏模式禁用口径不变；与 A/B 按钮并存）；
  // 独立于选择工具栏分支构建，避免与既有工具栏单测的源码切片耦合。
  (function(){
    var wrap=el('span','ab-nums');
    function loopInput(which,tag){
      var lab=el('label','ab-num');lab.appendChild(el('span','',tag));
      var inp=document.createElement('input');inp.type='number';inp.min='0';inp.step='0.1';
      inp.id=which==='loopA'?'loopAInput':'loopBInput';
      inp.value=store[which]==null?'':String(Math.round(store[which]*10)/10);
      inp.disabled=gm;inp.setAttribute('aria-label',(tag==='A'?'循环起点 A':'循环终点 B')+'（秒）');
      inp.title='填入秒数后回车/失焦：不经过播放头精确设 '+(tag==='A'?'起点 A':'终点 B')+'（仅网页播放；游戏模式禁用）';
      function commit(){
        if(gm||inp.__commitDone)return;
        var v=parseFloat(inp.value);
        if(!isFinite(v)||v<0){showToast(tag+' 须为 ≥0 的秒数');inp.value=store[which]==null?'':String(store[which]);return}
        if(store[which]!=null&&Math.abs(store[which]-v)<1e-9)return;
        inp.__commitDone=true; // 重建替换后旧输入框的迟到 change 不再二次提交（避免交换后再被旧值覆盖）
        store[which]=v;
        if(store.loopA!=null&&store.loopB!=null&&store.loopB<store.loopA){var t=store.loopA;store.loopA=store.loopB;store.loopB=t}
        if(window.ChoreoWorkbench)ChoreoWorkbench.exitRehearsal(); // 手工设 A/B 即退出定位排练标记
        render();showToast(tag+'='+v.toFixed(1)+'s'+(store.loopA!=null&&store.loopB!=null?(' · A='+store.loopA.toFixed(1)+'s · B='+store.loopB.toFixed(1)+'s'):''));
      }
      inp.onchange=commit;
      inp.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();commit();inp.blur()}e.stopPropagation()};
      lab.appendChild(inp);return lab;
    }
    wrap.appendChild(loopInput('loopA','A'));
    wrap.appendChild(loopInput('loopB','B'));
    tr.appendChild(wrap);
  })();
  // P1-A：按顺序添加条放在时间轴上方（主操作），选中片段的上下文栏放时间轴下方——不挤占主编辑面
  var wbBars=window.ChoreoWorkbench?renderWorkbenchBars():null;
  if(wbBars)ta.appendChild(wbBars.add);
  // 排练提示独立占位，暂停和定位时也不遮挡编辑按钮或时间轴片段。
  var ov=el('div','play-overlay');ov.id='playOverlay';
  if(!store.isPlaying)ov.style.display='none';
  ta.appendChild(ov);
  // P3-AC-4 / 首条旅程 J1：空项目三步上手引导——与现行工作台一致（左侧接着添加＋时间轴下方主编辑），
  // 不引导去播放头落条或右侧专家面板；容器 pointer-events:none 不挡轨道操作；✕ 关掉或添加首条后自动消失
  if(!_emptyGuideOff&&projectIsEmpty()){
    var eg=el('div','tl-empty-guide');
    eg.appendChild(el('b','','时间轴还是空的，三步开始：'));
    eg.appendChild(el('p','','① 在左侧选一个动作，排成第一条（第一条从 0 秒开始，之后接在当前添加目标的末尾）'));
    eg.appendChild(el('p','','② 选中一条后，在时间轴下方修改这一条（等待/时长在这里改；精确开始在「更多设置」）'));
    eg.appendChild(el('p','','③ 空格播放看效果：顺序、时刻和站位可见；动作素材以舞台状态为准'));
    var egx=el('button','eg-close','✕');egx.title='关闭提示（添加动作后也会自动消失）';
    egx.onclick=function(){_emptyGuideOff=true;var g=document.querySelector('.tl-empty-guide');if(g)g.remove()};
    eg.appendChild(egx);ta.appendChild(eg);
  }
  var wrap=el('div','tl-wrap');wrap.id='timelineWrap';
  // Ctrl+滚轮：缩放时间轴密度（pps = 每秒像素）
  wrap.addEventListener('wheel',function(e){
    if(!e.ctrlKey)return;
    e.preventDefault();
    var old=store.pps;
    store._ppsTouched=true;
    store.pps=Math.max(10,Math.min(240,old*(e.deltaY<0?1.15:1/1.15)));
    if(store.pps===old)return;
    // 以鼠标位置为锚点缩放：保持鼠标下的时间点不动
    var r=wrap.getBoundingClientRect();
    var mx=e.clientX-r.left+wrap.scrollLeft;
    var tAt=(mx-LABEL_W)/old;
    render();renderRuler();
    // render() 会整树重建 #timelineWrap，闭包里的 wrap 已是脱离文档的旧节点——
    // 锚点位置必须写进重新取到的新节点，否则缩放后时间轴弹回旧位置
    var nw=document.getElementById('timelineWrap');
    if(nw)nw.scrollLeft=LABEL_W+tAt*store.pps-(e.clientX-r.left);
    var br=document.getElementById('bottomRuler');if(br&&nw)br.scrollLeft=nw.scrollLeft;
    showToast('缩放: '+Math.round(store.pps)+' px/s');
  },{passive:false});
  // Click on empty area to move playhead
  wrap.onclick=function(e){
    if(_mqJustDone){_mqJustDone=false;return} // 框选刚结束：这次 click 不当"点空白定位"处理
    if(e.target.classList.contains('lane-body')||e.target.classList.contains('tl-canvas')||e.target.classList.contains('ruler')||e.target.classList.contains('bottom-ruler')){
      var r=wrap.getBoundingClientRect();
      var x=e.clientX-r.left+wrap.scrollLeft-LABEL_W;
      seekTimelinePosition(Math.max(0,x/store.pps));
      var ph=document.getElementById('playhead');if(ph)ph.style.display='block';
      var br=document.getElementById('bottomRuler');if(br)br.scrollLeft=wrap.scrollLeft;
    }
    // P1-A：点顶部刻度=选插入时刻（0.5 吸附）并切换到「插在这里」；点刻度子元素（刻度线/标签）同样生效
    if(e.target.closest&&e.target.closest('.ruler')&&window.ChoreoWorkbench){
      var r2=wrap.getBoundingClientRect();
      var x2=e.clientX-r2.left+wrap.scrollLeft-LABEL_W;
      ChoreoWorkbench.setInsertAt(Math.round(Math.max(0,x2/store.pps)*2)/2);
    }
  };
  // Sync scroll
  wrap.onscroll=function(){
    var br=document.getElementById('bottomRuler');if(br)br.scrollLeft=wrap.scrollLeft;
    markWindowDirty(); // P5：横向滚动经统一时钟补渲可见窗口
  };
  var canvas=el('div','tl-canvas');canvas.id='timelineCanvas';
  var ruler=el('div','ruler');ruler.id='ruler';canvas.appendChild(ruler);
  var lanes=el('div');lanes.id='lanes';
  var isSolo=store.dancerCount===1;
  var _cp=document.body.classList.contains('narrow');var laneHeight=isSolo?(_cp?44:56):(_cp?32:40);
  if(isSolo){var sp=el('div','');sp.style.height=laneHeight+'px';lanes.appendChild(sp)}
  // P1-A：未使用的舞者与轨道收进一个可展开区，不铺空轨道墙；当前舞者始终展开。
  // O-2：展开态本会话跨重绘保持（模块级标记；页面重载仍初始收起），摘要补可达指引。
  var _used=[],_unused=[];
  store.dancers.forEach(function(d,di){(_dancerHasContent(d,di)?_used:_unused).push(di)});
  _used.forEach(function(di){var d=store.dancers[di];lanes.appendChild(renderDancerGroup(d,di,laneHeight*(d.laneScale||1)))});
  if(_unused.length){
    var _fold=document.createElement('details');_fold.className='wb-unused';_fold.id='wbUnused';
    var _sum=document.createElement('summary');
    _sum.textContent='未使用的舞者与轨道 · '+_unused.length+' 位（点开本行：绑定人物、设起始位）';
    _fold.appendChild(_sum);
    _fold.open=_wbUnusedFoldOpen; // O-2：重绘不再强制收起
    _fold.addEventListener('toggle',function(){_wbUnusedFoldOpen=_fold.open});
    _unused.forEach(function(di){var d=store.dancers[di];_fold.appendChild(renderDancerGroup(d,di,laneHeight*(d.laneScale||1)))});
    lanes.appendChild(_fold);
  }
  // P2：舞者行就地添加（当前成为选中舞者；上限 12 与既有口径一致）
  if(store.dancers.length<12){
    var addRow=el('div','wb-add-dancer-row');
    var bAddD=el('button','btn','＋ 添加舞者');bAddD.type='button';bAddD.id='wbAddDancer';
    bAddD.title='在当前时间轴末尾添加一位舞者：可就地绑定人物、点「人物资源」导入档案；移除在舞者行右侧';
    bAddD.onclick=function(){addDancerAtEnd();saveHistory();updateTotalDuration();render();showToast('已添加舞者：先在舞者行绑定人物、点「人物资源」导入档案，再排动作')};
    addRow.appendChild(bAddD);lanes.appendChild(addRow);
  }
  // Global lyric track at bottom
  lanes.appendChild(renderGlobalLyricTrack());
  canvas.appendChild(lanes);
  // WP-3b 框选：在轨道空白处（轨道体/顶标尺/画布空隙/**舞者标题行**/轨道标签）按下并拖动
  // ≥3px 画矩形，松手选中矩形碰到的所有动作条；拖不出死区的仍是普通点击，原行为不变。
  // 标题行里的按钮/输入框（S·M·+台词·折叠·轨道高度）不算起手，点它们照常工作。
  // 矩形挂 body（render() 重建不丢）；命中检测按屏幕矩形，折叠舞者轨道 0 尺寸自动跳过。
  // 时间轴区域已 user-select:none，拖动不会再触发浏览器的"选择/复制文字"。
  // 监听挂 canvas（标尺是 lanes 的兄弟节点）；closest 白名单放行刻度等子元素，动作条及其把手除外
  canvas.addEventListener('mousedown',function(e){
    if(e.button!==0)return;
    var tg=e.target;
    if(tg.closest&&(tg.closest('.clip')||tg.closest('.dh-right')||tg.closest('.gl-tg')||tg.closest('button')||tg.closest('input')))return; // 动作条/把手/标题行控件不做起手
    if(!(tg.closest&&(tg.closest('.lane-body')||tg.closest('.ruler')||tg.closest('.d-hdr')||tg.closest('.lane-label')||tg.closest('.gl-hdr'))||tg.classList.contains('tl-canvas')))return;
    var sx=e.clientX,sy=e.clientY,rect=null,cnt=null,mq=false,add=e.ctrlKey||e.metaKey;
    // 矩形命中检测（mv 实时计数和 up 落选共用）：返回碰到的 clip 对象数组（全局歌词按对象去重）
    var geometry=null,geometryRev=-1,frame=null,latest=null;
    var invalidateGeometry=function(){geometry=null};
    window.addEventListener('scroll',invalidateGeometry,true);window.addEventListener('resize',invalidateGeometry);
    var hits=function(l,t,r,b){
      if(!geometry||geometryRev!==store._renderCount){
        geometry=Array.prototype.map.call(document.querySelectorAll('.clip'),function(node){return {clip:node.__clip,rect:node.getBoundingClientRect()}});
        geometryRev=store._renderCount;
      }
      var out=[],seen=new Set();
      geometry.forEach(function(entry){
        var cr=entry.rect;
        if(cr.width<=0&&cr.height<=0)return; // 折叠舞者的轨道：跳过
        if(cr.right<l||cr.left>r||cr.bottom<t||cr.top>b)return;
        var c=entry.clip;if(!c||seen.has(c))return;
        seen.add(c);out.push(c);
      });
      return out;
    };
    var mv=function(ev){
      latest=ev;if(frame===null)frame=requestAnimationFrame(paintMarquee);
    };
    function paintMarquee(){
      frame=null;var ev=latest;
      if(!mq){
        if(Math.abs(ev.clientX-sx)<3&&Math.abs(ev.clientY-sy)<3)return;
        mq=true;
        try{window.getSelection().removeAllRanges()}catch(err){} // 保险：拖起来先清掉任何残留选区
        rect=document.createElement('div');
        rect.style.cssText='position:fixed;border:1px solid #7eb3ff;background:rgba(126,179,255,.15);pointer-events:none;z-index:9997;display:none';
        document.body.appendChild(rect);
        cnt=document.createElement('div'); // 实时显示框住的条数（2026-08-29 主人拍板的优化）
        cnt.style.cssText='position:fixed;z-index:9998;pointer-events:none;background:#161c26;border:1px solid #7eb3ff;border-radius:4px;padding:2px 8px;color:#cfe0ff;white-space:nowrap;display:none';
        document.body.appendChild(cnt);
      }
      var l=Math.min(sx,ev.clientX),t=Math.min(sy,ev.clientY),r=Math.max(sx,ev.clientX),b=Math.max(sy,ev.clientY);
      rect.style.left=l+'px';rect.style.top=t+'px';
      rect.style.width=(r-l)+'px';rect.style.height=(b-t)+'px';
      rect.style.display='block';
      cnt.textContent=(add?'追加 ':'已选 ')+hits(l,t,r,b).length+' 条';
      cnt.style.left=(r+12)+'px';cnt.style.top=(t+12)+'px';
      cnt.style.display='block';
    };
    var up=function(ev){
      if(frame!==null){cancelAnimationFrame(frame);frame=null;latest=ev;paintMarquee()}
      window.removeEventListener('scroll',invalidateGeometry,true);window.removeEventListener('resize',invalidateGeometry);
      geometry=null; // 抬手重新测量，滚动/尺寸变化后的最终选区以当前画面为准。
      document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
      if(rect)rect.remove();
      if(cnt)cnt.remove();
      if(!mq)return; // 没拖成=普通点击，交给原有 click 处理
      _mqJustDone=true;setTimeout(function(){_mqJustDone=false},0);
      var l=Math.min(sx,ev.clientX),t=Math.min(sy,ev.clientY),r=Math.max(sx,ev.clientX),b=Math.max(sy,ev.clientY);
      if(!add)clearClipSelection();
      var sel=hits(l,t,r,b);
      sel.forEach(function(c){c.selected=true});
      store.selectedClip=sel.length?sel[0]:null;
      refreshSelection();
      if(sel.length)showToast('框选了 '+sel.length+' 条'+(add?'（追加模式）':''));
    };
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
    e.preventDefault(); // 拖动时不选中文本
  });
  // P5：播放头独立图层（pointer-events:none + containment），播放头移动不再与片段层同一容器
  var pl=el('div','playhead-layer');pl.id='playheadLayer';
  var ph=el('div','playhead');ph.id='playhead';ph.style.display='none';pl.appendChild(ph);canvas.appendChild(pl);
  wrap.appendChild(canvas);
  ta.appendChild(wrap);
  // Bottom draggable timeline ruler
  var br=el('div','bottom-ruler');br.id='bottomRuler';
  br.style.cssText='height:64px;overflow-x:hidden;overflow-y:hidden;position:relative;border-top:1px solid var(--border);background:var(--panel);flex-shrink:0;cursor:pointer';
  br.innerHTML='<div id="bottomRulerInner" style="position:relative;height:100%;"></div>';
  br.onmousedown=function(e){
    if(store.previewTarget!=='game'&&window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('请先停止本机演出，再定位时间轴');return}
    var wasPlaying=store.isPlaying,projectId=store.projectId,target=store.previewTarget;
    // 保留独立播放的停止后拖动；音乐排练由原媒体时钟保持播放或暂停状态。
    if(wasPlaying){
      playToken++;      store.isPlaying=false;
      stopRenderClock();
      if(store.previewTarget==='game')apiFetch('/playback/stop',{method:'POST'}).catch(function(){});
      var ov0=document.getElementById('playOverlay');if(ov0)ov0.style.display='none';
      render();
    }
    var lastSent=0;
    function cleanup(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp)}
    function seekAt(ev,final){
      if(store.projectId!==projectId||store.previewTarget!==target){cleanup();return}
      if(target!=='game'&&window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){cleanup();return}
      // 停止播放会重建标尺，必须读取当前节点，不能使用已移除节点的坐标。
      var active=document.getElementById('bottomRuler');if(!active){cleanup();return}
      var r=active.getBoundingClientRect();
      var t=Math.max(0,(ev.clientX-r.left+active.scrollLeft-LABEL_W)/store.pps);
      if(target!=='game'&&!wasPlaying){seekTimelinePosition(t);return}
      store.currentTime=t;updatePlayhead();updateTimeDisplay();
      var now=Date.now();
      if(final||now-lastSent>50){lastSent=now;sendSeek(t)}
    }
    var onMove=function(ev){seekAt(ev,false)};
    var onUp=function(ev){seekAt(ev,true);cleanup()};
    seekAt(e,true);
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
    e.preventDefault();
  };
  ta.appendChild(br);
  if(wbBars)ta.appendChild(wbBars.ctx);
  return ta;
}

function renderDancerGroup(dancer,di,lh){
  var group=el('div','dancer-grp'+(dancer.collapsed?' collapsed':''));
  var hdr=el('div','d-hdr');
  var dot=el('div','dh-dot');dot.style.background=dancer.color;hdr.appendChild(dot);
  hdr.appendChild(el('span','dh-nm',dancer.name));
  if(dancer.currentJob)hdr.appendChild(el('span','dh-jb','['+dancer.currentJob+']'));
  // ACTOR（2026-08-31）：游戏模式标出「游戏预览舞者」——播放/拖动只演这一位；
  // 点其他舞者行头的同一按钮换人（游戏连着且没在播时立即生效：推快照+按播放头重新定格）
  if(store.previewTarget==='game'){
    var bG=el('button','dh-sm'+(gameActorIdx()===di?' on':''),'\uD83C\uDFAE \u9884\u89C8');
    bG.title='游戏预览舞者：游戏模式播放/拖动只演这一位（游戏内只有一个角色；不受独奏/静音影响）。点其他舞者行头的同一按钮换人';
    bG.onclick=function(){setGameActor(di)};
    hdr.appendChild(bG);
  }
  // M2-START-FORMATION：每舞者起始站位入口（常驻中文提示：仅网页预览用，游戏执行不用）。
  // 播放中双目标一致禁用（disabled+aria-disabled，点击 no-op）；缺 start 显示自动排布。
  // F1 修复：不用 .dh-sm 类——clip-check 用 '#lanes .dancer-grp .dh-sm' 下标选 S/M（[S0,M0,S1,M1]），共用会错位。
  (function(){
    var CE = (window.ChoreoEdit && window.ChoreoEdit.pure) || null;
    var has = CE && CE.hasExplicitStart ? CE.hasExplicitStart(dancer) : !!(dancer && dancer.start && typeof dancer.start === 'object');
    var bSt = el('button', 'start-entry' + (has ? ' on' : ''), has ? '📍 起始●' : '📍 起始');
    var note = (window.ChoreoStageUI && window.ChoreoStageUI.NOTICE) || '起始站位与朝向已保存，用于网页预览；当前游戏执行不使用（游戏内以骨骼动作为准，未做地图校准）。';
    bSt.title = '起始位置：' + note + '（点开后在舞台俯视图拖点放位置；X/Z/朝向数值在「更多设置（专家参数）」）';
    bSt.setAttribute('aria-label', dancer.name + '起始位置');
    if (store.isPlaying) { bSt.disabled = true; bSt.setAttribute('aria-disabled', 'true'); }
    bSt.onclick = function(){
      if (store.isPlaying) return;
      // P3：舞者行入口→俯视标签就地拖点（复用 P1-C 俯视交互）；无俯视宿主时回落既有对话框
      if (window.ChoreoStageUI && window.ChoreoStageUI.openStartPosition) { window.ChoreoStageUI.openStartPosition(di); return; }
      if (window.ChoreoStageUI && window.ChoreoStageUI.openStartDialog) window.ChoreoStageUI.openStartDialog(di);
    };
    hdr.appendChild(bSt);
  })();
  // 右侧控件包成一组并 sticky 在屏幕右缘：横向拖动时间轴时按钮固定可见，不随内容滚走
  var rgt=el('div','dh-right');
  // MULTI-DANCER：整轨复制入口——点开列其他舞者，把那位的三条轨一次性复制给这位（class 独立于
  // dh-sm，clip-check 用 .dh-sm 下标选 S/M，别共用）
  if(store.dancers.length>1){
    var bCp=el('button','dh-copy','\u21C9');
    bCp.title='\u590D\u5236\u8F68\u9053\uFF1A\u628A\u5176\u4ED6\u821E\u8005\u7684\u4E09\u6761\u8F68\uFF08\u5207\u6362/\u52A8\u4F5C/\u53F0\u8BCD\uFF09\u4E00\u6B21\u6027\u590D\u5236\u7ED9\u8FD9\u4F4D\uFF0C\u5E26\u804C\u4E1A\u3001\u53D1\u65B0 id\uFF1B\u76EE\u6807\u5DF2\u6709\u5185\u5BB9\u65F6\u4F1A\u5148\u786E\u8BA4\uFF08\u6574\u4F53\u66FF\u6362\uFF0C\u4E00\u6B21\u64A4\u9500\u53EF\u8FD8\u539F\uFF09';
    bCp.style.cssText='padding:2px 6px;margin-right:2px;background:#2c3440;color:#cdd6e4;border:1px solid #3d4757;border-radius:3px;cursor:pointer';
    bCp.onclick=function(e){e.stopPropagation(); // 冒泡会撞上 document 的全局 click 关菜单监听，先拦下
      var r=bCp.getBoundingClientRect();showCopyTracksMenu(r.left,r.bottom+2,di)};
    rgt.appendChild(bCp);
  }
  var rsz=el('div','dh-rsz');
  rsz.appendChild(el('label','','\u8F68\u9053\u9AD8\u5EA6'));
  var ri=document.createElement('input');ri.type='number';ri.min='0.5';ri.max='3';ri.step='0.5';ri.value=(dancer.laneScale||1);
  ri.onchange=function(e){dancer.laneScale=parseFloat(e.target.value)||1;saveHistory();render()};
  rsz.appendChild(ri);
  rgt.appendChild(rsz);
  // CHARACTER-ASSETS-P3：每舞者档案绑定（最小入口，QA rev-2 围栏：就这一个控件）——「跟随
  // 活动档案」（=不写 profileId 键）或指定已知档案；写入走 setDancerBinding 纯函数（未知 id
  // 拒绝），编辑路径与独奏/静音同款（saveHistory+重绘，可撤销可持久化）；改完通知 3D 面板重建
  var bProf=document.createElement('select');
  bProf.className='dh-prof';
  var profCur=(typeof dancer.profileId==='string'&&dancer.profileId)?dancer.profileId:'';
  var profMissing=!!profCur&&!_knownProfiles.some(function(p){return p.id===profCur}); // P2：绑定档案在本机缺失→入口高亮
  bProf.title='这位舞者 3D 预览用哪套角色档案（模型+骨架+动作按档案隔离）；「跟随活动档案」=不绑定，随 3D 面板当前档案走；选择会保存进项目';
  (function(){
    var cur=profCur;
    if(cur&&!_knownProfiles.some(function(p){return p.id===cur})){
      var mo=document.createElement('option');
      mo.value='!!missing!!';
      mo.textContent='\u26A0 \u7ED1\u5B9A\u5DF2\u5931\u6548';
      mo.selected=true;
      bProf.appendChild(mo);
    }
    var def=document.createElement('option');
    def.value='';
    def.textContent='\uD83D\uDC64 \u8DDF\u968F\u6D3B\u52A8\u6863\u6848';
    if(!cur)def.selected=true;
    bProf.appendChild(def);
    _knownProfiles.forEach(function(p){
      var o=document.createElement('option');
      o.value=p.id;
      o.textContent=p.name+'\uFF08'+p.boneCount+'\u9AA8\uFF09';
      if(cur===p.id)o.selected=true;
      bProf.appendChild(o);
    });
  })();
  bProf.onchange=function(){
    var v=bProf.value;
    if(v!=='!!missing!!'){
      var known=_knownProfiles.map(function(p){return p.id});
      var changed=!!(window.ChoreoEdit&&ChoreoEdit.pure&&ChoreoEdit.pure.setDancerBinding(store.dancers,di,v,known));
      if(changed){
        saveHistory();
        if(window.__p3dBindingsChanged)window.__p3dBindingsChanged();
      }
    }
    render();
  };
  rgt.appendChild(bProf);
  // P2 人物资源入口：档案/模型缺失时高亮，点开本地资料库恢复或导入（档案管理/离线包/导入面仍留 P4，不删）
  var bRes=el('button','dh-res'+(profMissing?' missing':''),'人物资源');
  bRes.type='button';bRes.title='人物资源：管理/导入本地角色档案与模型'+(profMissing?('。这位舞者绑定的档案「'+profCur+'」在本机缺失，已高亮'):'')+'；档案与动作资产不在项目文件里，缺失时在这里恢复或重新关联';
  bRes.onclick=function(e){e.stopPropagation();if(typeof showLibraryModal==='function')showLibraryModal();else showToast('资料库模块未加载')};
  rgt.appendChild(bRes);
  // WP-3b：独奏/暂时隐藏——随项目保存、同一舞者互斥（开一个自动关另一个）；
  // 生效口径见 ChoreoEdit.pure.isMuted（有人独奏=只有独奏者出动作）。P2 文案定稿：S→「只看这位」、M→「暂时隐藏这位」
  var bS=el('button','dh-sm'+(dancer.solo?' on':''),'只看这位');bS.title='只看这位：只让这个舞者出动作（可以多位；和「暂时隐藏这位」互斥）；再点取消';
  bS.onclick=function(){dancer.solo=!dancer.solo;if(dancer.solo)dancer.mute=false;saveHistory();render()};
  rgt.appendChild(bS);
  var bM=el('button','dh-sm'+(dancer.mute?' on':''),'暂时隐藏这位');bM.title='暂时隐藏这位：这个舞者不出动作（网页 3D 站桩可见、游戏播放跳过；和「只看这位」互斥）；再点取消';
  bM.onclick=function(){dancer.mute=!dancer.mute;if(dancer.mute)dancer.solo=false;saveHistory();render()};
  rgt.appendChild(bM);
  // P2 舞者行就地移除（减人确认保留；技能轨随删除清理，动作/走位轨与旧「减少人数」口径一致）
  if(store.dancers.length>1){
    var bRm=el('button','dh-del','✕');bRm.type='button';bRm.title='移除「'+dancer.name+'」及其编排（可一次撤销恢复）';
    bRm.onclick=function(e){e.stopPropagation();removeDancerAt(di)};
    rgt.appendChild(bRm);
  }
  // P3：台词入口右移台词轨（renderLane 的歌词轨右侧常驻按钮）；舞者头不再放「+ 台词」
  var tog=el('span','dh-toggle',dancer.collapsed?'\u25B6':'\u25BC');
  tog.onclick=function(){dancer.collapsed=!dancer.collapsed;render()};
  rgt.appendChild(tog);
  hdr.appendChild(rgt);
  group.appendChild(hdr);
  // Lanes
  var lanes=el('div','lanes');
  lanes.appendChild(renderLane(dancer,di,'switch','\u{1F504} \u5207\u6362',lh));
  lanes.appendChild(renderLane(dancer,di,'action','\u26A1 \u52A8\u4F5C',lh));
  if(window.ChoreoAbilityUI)lanes.appendChild(ChoreoAbilityUI.lane(di));
  if(window.ChoreoStageMotionUI)lanes.appendChild(ChoreoStageMotionUI.lane(di));
  lanes.appendChild(renderLane(dancer,di,'lyric','\u{1F4AC} \u53F0\u8BCD',Math.max(28,lh*0.7)));
  group.appendChild(lanes);
  return group;
}

function renderLane(dancer,di,trackType,labelText,lh){
  var cls=trackType==='switch'?'switch-lane':trackType==='action'?'action-lane':'lyric-lane';
  var lane=el('div','lane '+cls);
  if(edIsMuted(di))lane.classList.add('muted-lane'); // WP-3b：静音舞者的轨道整体调暗（模型站桩可见）
  lane.style.height=lh+'px';
  var label=el('div','lane-label');
  var parts=labelText.split(' ');
  if(trackType==='switch'){parts[1]='切换·未核实';label.title=ChoreoGearset.PREVIEW_NOTICE}
  label.appendChild(el('span','',parts[0]));
  label.appendChild(el('span','',parts[1]||''));
  lane.appendChild(label);
  var body=el('div','lane-body');
  body.ondragover=function(e){
    e.preventDefault();
    try{
      var data=JSON.parse(e.dataTransfer.getData('text/plain')||'{}');
      if(data.fromSidebar&&data.data){
        var r=e.currentTarget.getBoundingClientRect();
        var x=e.clientX-r.left;
        var st=x/store.pps;
        if(trackType!=='lyric'&&hasConflict(di,trackType,st,data.data.duration||3)){e.currentTarget.classList.add('conflict')}
        else{e.currentTarget.classList.add('drag-over')}
      }
    }catch(err){}
  };
  body.ondragleave=function(e){e.currentTarget.classList.remove('drag-over','conflict')};
  if(trackType==='lyric'){body.style.cursor='crosshair';body.onclick=function(e){
    if(e.target.closest('.clip'))return;
    if(_mqJustDone)return; // 框选刚结束的 click 不当"点空白输入台词"处理
    var r=e.currentTarget.getBoundingClientRect();
    var st=(e.clientX-r.left)/store.pps;
    var txt=prompt('\u8F93\u5165\u53F0\u8BCD:');
    if(txt&&txt.trim()){
      var ch=txt.trim().charAt(0);
      var prefix=ch==='/ '?'/':(ch==='/'?'':'/y ');
      var cmd=ch==='/'?txt.trim():'/y '+txt.trim();
      addClipToTrack(di,'lyric',{name:txt.trim(),command:cmd,category:'lyric',isLyric:true,duration:3},st);
    }
  }};
  body.ondrop=function(e){
    e.preventDefault();e.currentTarget.classList.remove('drag-over','conflict');
    try{
      var data=JSON.parse(e.dataTransfer.getData('text/plain'));
      if(data.fromSidebar&&data.data){
        var r=e.currentTarget.getBoundingClientRect();
        var x=e.clientX-r.left;
        var st=x/store.pps;
        if(window.ChoreoAbilityPlan&&ChoreoAbilityPlan.isSkill(data.data)){
          if(trackType==='action'&&store.addToAll&&window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAddAll)ChoreoAbilityUI.quickAddAll(data.data,st);
          else if(window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAdd)ChoreoAbilityUI.quickAdd(data.data,di,st);
          else ChoreoAbilityUI.open(data.data,di,st);
          return}
        if(trackType==='switch'&&data.data.category!==SWITCH_CAT){showToast('\u5207\u6362\u8F68\u9053\u53EA\u80FD\u653E\u5207\u6362\u7C7B');return}
        // MULTI-DANCER：开关开 + 动作轨 → 拖到哪一刻，全体舞者同一时刻插入（切职业条目保持单舞者口径）
        if(trackType==='action'&&store.addToAll)addClipToAllDancers(data.data,st);
        else addClip(di,trackType,data.data,st);
        // 松手即退出定格预览(若拖动期间停留在定格中)
        apiFetch('/playback/freeze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:''})}).catch(function(){})
      }
    }catch(err){}
  };
  // P5：只渲染可见时间窗内的片段（手势期间 win.suspended → 全量，节点不会被中途换掉）
  var clips=dancer[trackType+'Clips']||[];
  var win=timelineWindow();
  var vis=window.ChoreoRenderPerf?window.ChoreoRenderPerf.visibleClips(clips,win,{suspended:win.suspended}):clips;
  var _ids=[];for(var _i=0;_i<vis.length;_i++)_ids.push(vis[_i].id);
  body.__laneMeta={di:di,tt:trackType,lh:lh};body.__laneIds=_ids;body.__laneKey=_ids.join(',');
  vis.forEach(function(c){body.appendChild(renderClip(c,di,trackType,lh))});
  if(trackType==='action'&&window.ChoreoWorkbench)ChoreoWorkbench.appendWaitBands(body,dancer);
  lane.appendChild(body);
  // P3：「+ 台词」入口右移到台词轨右侧（sticky 右缘，横向滚动时仍可见）
  if(trackType==='lyric'){
    var lyR=el('div','lane-right');
    var addLy=el('button','btn small lyric-add','＋ 台词');
    addLy.title='在这位舞者的台词轨末尾加一条台词（以 / 开头会作为命令，如 /y 你好）';
    addLy.onclick=function(e){e.stopPropagation();addLyricPrompt(di)};
    lyR.appendChild(addLy);lane.appendChild(lyR);
  }
  return lane;
}
function addLyricPrompt(di){ // P3：+ 台词入口共用（原舞者头逻辑原样搬移）
  var txt=prompt('\u8F93\u5165\u53F0\u8BCD\u6587\u5B57 (\u4EE5 / \u5F00\u5934\u5219\u4F5C\u4E3A\u547D\u4EE4, \u5982 /y \u4F60\u597D):');
  if(!(txt&&txt.trim()))return;
  var t=txt.trim(),cmd=t.charAt(0)==='/'?t:'/y '+t,d=store.dancers[di];
  if(!d)return;
  var arr=d.lyricClips,lastEnd=0;
  arr.forEach(function(c){var e=c.start+c.duration;if(e>lastEnd)lastEnd=e});
  d.lyricClips.push({id:store.nextClipId++,start:lastEnd,duration:3,data:{name:t,command:cmd,category:'lyric',isLyric:true}});
  saveHistory();updateTotalDuration();render();
}

function renderGlobalLyricTrack(){
  var wrap=el('div','global-lyric');
  var hdr=el('div','gl-hdr');
  hdr.appendChild(el('span','gl-ttl','\u{1F3B5} \u5168\u5C40\u6B4C\u8BCD\u8F68 (\u5168\u821E\u8005\u5171\u4EAB)'));
  var tg=el('div','gl-tg');
  var cb=document.createElement('input');cb.type='checkbox';cb.checked=store.showLyricMacro;
  cb.onchange=function(e){store.showLyricMacro=e.target.checked;saveHistory();render()};
  tg.appendChild(cb);
  tg.appendChild(el('span','','导出宏时包含歌曲原词（不进入宏编辑框）'));
  // P4-A（#35/#36）：歌词导入与原词编辑入口右移到歌词轨头；搜索需本机插件联网，离线可直接粘贴 LRC 手输。
  // 三类文本保持独立：导入/原词只写 globalLyrics，手写台词在舞者台词轨，宏草稿在宏面板。
  var impLy=el('button','btn','导入歌词');impLy.id='glImport';
  impLy.title='联网搜索歌曲歌词（搜索需要本机 ChoreoHelper 插件已连接）或离线粘贴 LRC 文本；导入到全局歌词轨';
  impLy.onclick=function(){showLyricsModal()};hdr.appendChild(impLy);
  var editSong=el('button','btn','编辑原词');editSong.id='glEditLyrics';
  editSong.title='逐行修改歌曲原词与翻译（只写全局歌词轨；手写台词与宏草稿独立保存）';
  editSong.onclick=function(){showSongLyricsEditor()};hdr.appendChild(editSong);
  hdr.appendChild(tg);
  wrap.appendChild(hdr);
  // 双行显示：上行原文，下行翻译（"原文 / 译文" 合并文本按首个 " / " 拆分；无翻译的行只显示在上行）
  var laneH2=document.body.classList.contains('narrow')?22:32;
  function glBody(){
    var body=el('div','lane-body');
    body.style.cursor='crosshair';
    body.ondragover=function(e){e.preventDefault();e.currentTarget.classList.add('drag-over')};
    body.ondragleave=function(e){e.currentTarget.classList.remove('drag-over')};
    return body;
  }
  function splitLyricText(name){
    var i=name.indexOf(' / ');
    return i>=0?[name.substring(0,i),name.substring(i+3)]:[name,null];
  }
  var laneO=el('div','lane lyric-lane');laneO.style.height=laneH2+'px';
  var labelO=el('div','lane-label');labelO.appendChild(el('span','','\u539F\u6587'));
  laneO.appendChild(labelO);
  var bodyO=glBody();
  var laneT=el('div','lane lyric-lane');laneT.style.height=laneH2+'px';
  var labelT=el('div','lane-label');labelT.appendChild(el('span','','\u8BD1\u6587'));
  laneT.appendChild(labelT);
  var bodyT=glBody();
  store.globalLyrics.forEach(function(c){
    var parts=splitLyricText(c.data.name||'');
    bodyO.appendChild(renderClip(c,-1,'lyric',laneH2,parts[0]));
    if(parts[1]!=null)bodyT.appendChild(renderClip(c,-1,'lyric',laneH2,parts[1]));
  });
  laneO.appendChild(bodyO);
  laneT.appendChild(bodyT);
  wrap.appendChild(laneO);
  wrap.appendChild(laneT);
  return wrap;
}

// 选中一个 clip（清掉其他选中态）——把手和条身两条路径共用
function selectClipOnly(clip){
  // P3：选中常规片段即退出走位/朝向就地编辑（走位会话与片段选择互斥）
  if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.clearSelection)ChoreoStageMotionUI.clearSelection();
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){d[k].forEach(function(x){x.selected=false})})});
  store.globalLyrics.forEach(function(x){x.selected=false});
  clip.selected=true;store.selectedClip=clip;
}
function renderClip(clip,di,tt,lh,txtOverride){
  // 实时体检：该条有红/黄问题时描边（级别取最严重的；提示级不描边不吵）
  var _ilv=store.checkLevel&&store.checkLevel[clip.id];
  var c=el('div','clip'+(clip.selected?' selected':'')+(_ilv?(' issue-'+_ilv):''));
  c.setAttribute('data-cat',clip.data.category||'');
  c.style.left=(clip.start*store.pps)+'px';
  c.style.width=Math.max(20,clip.duration*store.pps)+'px';
  c.style.height=(lh-4)+'px';
  c.style.top='2px';
  // 拉长/缩短把手：真实元素命中（点中即拉长），不再按点击位置百分比猜意图——
  // 旧算法在窄动作条上判定区几乎占满整条，点哪儿都算拉长，误触极多
  var wpx=Math.max(20,clip.duration*store.pps);
  if(wpx>=48){
    var hdl=el('span','c-rz c-rz-l');hdl.title='左右拖：调整开始时刻（左端）';
    hdl.onmousedown=function(e2){e2.preventDefault();e2.stopPropagation();selectClipOnly(clip);dragClip(e2,clip,di,tt,'resize-left',clip.start);refreshSelection()};
    c.appendChild(hdl);
  }
  var hdr=el('span','c-rz c-rz-r');hdr.title='左右拖：拉长/缩短时长';
  hdr.onmousedown=function(e2){e2.preventDefault();e2.stopPropagation();selectClipOnly(clip);dragClip(e2,clip,di,tt,'resize-right',clip.start+clip.duration);refreshSelection()};
  c.appendChild(hdr);
  c.__clip=clip; // WP-3b 框选命中用：DOM 节点反查 clip 对象（render() 重建时一起重建，无悬挂问题）
  (_clipNodes[clip.id]=_clipNodes[clip.id]||[]).push(c); // OPT-2/AUD-019：拖动局部刷新用
  c.onmousedown=function(e){
    if(e.target.classList.contains('c-pv'))return;
    if(e.target.classList&&e.target.classList.contains('c-rz'))return; // 把手有自己的处理
    if(window.ChoreoWorkbench)ChoreoWorkbench.clearInsert(); // P1-A：点任何片段即退出“插在这里”回到默认
    if(e.ctrlKey||e.metaKey){ // Ctrl+点击：加选/去选（不启动拖动）
      clip.selected=!clip.selected;
      store.selectedClip=clip.selected?clip:null;
      e.preventDefault();e.stopPropagation();refreshSelection();return;
    }
    if(clip.selected&&edSel().length>1){store.selectedClip=clip} // 多选中拖其中一条=整体平移，选择集保持
    else selectClipOnly(clip);
    dragClip(e,clip,di,tt,'move',clip.start);
    e.preventDefault();e.stopPropagation();refreshSelection();
  };
  c.oncontextmenu=function(e){e.preventDefault();showCtxMenu(e.clientX,e.clientY,clip,di,tt)};
  if(tt==='switch'){txtOverride=ChoreoGearset.label(clip.data);c.title=txtOverride+'。'+ChoreoGearset.PREVIEW_NOTICE;c.ondblclick=function(e){e.stopPropagation();openGearsetPicker(clip,di)};}
  c.onmouseenter=function(e){showTip(e.clientX+10,e.clientY+10,(tt==='switch'?ChoreoGearset.label(clip.data)+'\n'+ChoreoGearset.PREVIEW_NOTICE:clip.data.name)+'\n'+(clip.data.command||'')+'\n'+clip.start.toFixed(1)+'s \xB7 '+clip.duration.toFixed(1)+'s')};
  c.onmouseleave=hideTip;
  if(clip.data.isLyric){
    c.appendChild(el('span','c-nm',txtOverride!=null?txtOverride:clip.data.name));
  }else{
    c.appendChild(el('span','c-nm',txtOverride!=null?txtOverride:clip.data.name));
    if(clip.data.command&&tt!=='switch'){
      var pv=el('button','c-pv','\u25B6');pv.title='\u9884\u89C8';pv.style.height=(lh-8)+'px';
      pv.onclick=function(e){e.stopPropagation();apiPreview(clip.data.command).then(function(r){showToast(r.status==='ok'?'\u9884\u89C8:'+clip.data.name:'\u5931\u8D25')}).catch(function(){showToast('\u5931\u8D25')})};
      c.appendChild(pv);
    }
    if(clip.data.jobAbbr){c.appendChild(el('span','c-job',clip.data.jobAbbr))}
  }
  // P1-A：片段自身时长与「等待 N 秒」带分列显示，两个概念不共用同一控件/文案
  c.appendChild(el('span','c-dur',(Math.round(clip.duration*10)/10).toFixed(1)+'s'));
  return c;
}

// 拖动/拉长实时气泡：跟随鼠标显示当前值和新旧对比（拉长时一眼看到改了多少）
function updateDragTip(ev,type,clip,origStart,origDur){
  var tip=document.getElementById('dragTip');
  if(!ev){if(tip)tip.style.display='none';return} // 只隐藏
  if(!tip){
    tip=document.createElement('div');tip.id='dragTip';
    tip.style.cssText='position:fixed;display:none;z-index:9999;pointer-events:none;background:#161c26;border:1px solid var(--accent);border-radius:4px;padding:3px 8px;color:#cfe0ff;white-space:nowrap';
    document.body.appendChild(tip);
  }
  var txt;
  if(type==='move')txt='\u5F00\u59CB '+clip.start.toFixed(1)+'s \u00B7 \u65F6\u957F '+clip.duration.toFixed(1)+'s';
  else if(type==='resize-left')txt='\u5F00\u59CB '+origStart.toFixed(1)+'\u2192'+clip.start.toFixed(1)+'s \u00B7 \u65F6\u957F '+origDur.toFixed(1)+'\u2192'+clip.duration.toFixed(1)+'s';
  else txt='\u65F6\u957F '+origDur.toFixed(1)+'\u2192'+clip.duration.toFixed(1)+'s';
  tip.textContent=txt;
  tip.style.left=Math.min(ev.clientX+14,window.innerWidth-170)+'px';
  tip.style.top=Math.max(6,ev.clientY-32)+'px';
  tip.style.display='block';
}
// 吸附对齐参考线：snapTime 真正吸附命中时显示一条竖线，未吸附隐藏
function updateDragGuide(t){
  var g=document.getElementById('dragGuide');
  if(t==null){if(g)g.style.display='none';return}
  var wrap=document.getElementById('timelineWrap');
  var lanes=document.getElementById('lanes');
  if(!wrap||!lanes){if(g)g.style.display='none';return}
  if(!g){
    g=document.createElement('div');g.id='dragGuide';
    g.style.cssText='position:fixed;width:1px;background:rgba(126,179,255,.8);pointer-events:none;z-index:9998;display:none';
    document.body.appendChild(g);
  }
  var wr=wrap.getBoundingClientRect(),lr=lanes.getBoundingClientRect();
  g.style.left=(wr.left+LABEL_W+t*store.pps-wrap.scrollLeft)+'px';
  g.style.top=lr.top+'px';g.style.height=lr.height+'px';g.style.display='block';
}
function dragClip(e,clip,di,tt,type,val){
  store._clipDragActive=true; // WEB-RACE：拖动中实时体检让路（防抖火灾/迟到结果都不重绘），收尾 render 再统一补最终检查
  var startX=e.clientX,startY=e.clientY;
  var _plainLeftClick=e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey; // O-3：仅左键无修饰键的纯单击才收拢单选（右键多选流程保持多选集）
  var raf=null,moved=false,latest=null;
  var origStart=clip.start,origDur=clip.duration;
  // WP-3b 批量平移：拖的是多选集中的一条时，其余选中条按同一 delta 跟随（吸附/量化以被拖条为准）
  var group=null;
  if(type==='move'&&clip.selected&&edSel().length>1){
    group=edSel().map(function(s){return{c:s.clip,s0:s.clip.start}});
  }
  var onMove=function(ev){
    if(!moved){
      // 点击死区：位移<3px 视为纯点击选中——不改值、不重绘、不进历史，杜绝手抖误动
      if(Math.abs(ev.clientX-startX)<3&&Math.abs(ev.clientY-startY)<3)return;
      moved=true;
    }
    latest=ev;
    if(raf!==null)return;
    raf=requestAnimationFrame(applyMove);
  };
  function applyMove(){
      raf=null;
      var ev2=latest;
      var dx=ev2.clientX-startX,dt=dx/store.pps,ns,snapped=null,tlChanged=false;
      if(type==='move'){
        ns=Math.max(0,val+dt);
        var pre=snapTime(ns,clip,di,tt,type,ev2.altKey);
        if(Math.abs(pre-ns)>0.001)snapped=pre; // 吸附命中（参考线挂这个时刻）
        ns=Math.round(pre*2)/2;
        if(group){ // AUD-008 整组平移：公共钳制一次、整组一起触边停，两两间距不变
          var applied=ChoreoEdit.pure.moveGroup(group.map(function(it){return it.c}),ns-clip.start,store.totalDuration);
          ns=clip.start+applied;
          tlChanged=applied!==0;
        }else{
          ns=Math.max(0,Math.min(ns,store.totalDuration-clip.duration)); // 轨道末端钳制：加长需点“+1分钟”
          if(ns!==clip.start){clip.start=ns;tlChanged=true}
        }
      }else if(type==='resize-left'){
        // HYGIENE(AC-5)：0.5s 最短时长钳制只发生在吸附之前——随后 snapTime 可把左缘吸附到
        // (end-0.5, end] 内的候选点上，实际时长被压到 0.5s 以下。这是既有行为，列为开放契约
        ns=Math.max(0,val+dt);var end=clip.start+clip.duration;ns=Math.min(ns,end-0.5);
        var pre2=snapTime(ns,clip,di,tt,type,ev2.altKey);
        if(Math.abs(pre2-ns)>0.001)snapped=pre2;ns=pre2;
        ns=Math.round(ns*2)/2;
        if(ns!==clip.start){clip.start=ns;clip.duration=end-ns;clip.autoDur=false;tlChanged=true}
      }else{
        var ne=Math.max(clip.start+0.5,val+dt);
        var pre3=snapTime(ne,clip,di,tt,type,ev2.altKey);
        if(Math.abs(pre3-ne)>0.001)snapped=pre3;ne=pre3;
        ne=Math.min(ne,store.totalDuration); // 末端钳制
        ne=Math.round(ne*2)/2;
        if(ne!==clip.start+clip.duration){clip.duration=ne-clip.start;clip.autoDur=false;tlChanged=true}
      }
      updateDragTip(ev2,type,clip,origStart,origDur);
      updateDragGuide(snapped);
      updateTotalDuration(); // 便宜（只算轨道末端），下一帧钳制要用最新值
      if(tlChanged){
        // OPT-2/AUD-018：拖动改变条目位置→ 3D 面板靠 _tlRev 感知并重排引擎时间轴
        store._tlRev=(store._tlRev||0)+1;
        // OPT-2/AUD-019：只改被拖条（多选=整组）的 left/width，不再每帧整页重建 DOM；
        // mouseup 才完整 render（描边/冲突高亮/持久化恢复），拖动全程跟手不打抖
        var pps=store.pps;
        (group||[{c:clip}]).forEach(function(it){
          var arr=_clipNodes[it.c.id];
          if(!arr)return;
          for(var i=0;i<arr.length;i++){
            var nd=arr[i];
            if(type==='move')nd.style.left=(it.c.start*pps)+'px';
            else if(type==='resize-left'){nd.style.left=(it.c.start*pps)+'px';nd.style.width=Math.max(20,it.c.duration*pps)+'px'}
            else nd.style.width=Math.max(20,it.c.duration*pps)+'px';
          }
        });
      }
  }
  var onUp=function(ev){
    if(raf!==null){cancelAnimationFrame(raf);raf=null}
    if(moved){if(ev&&Number.isFinite(ev.clientX))latest=ev;applyMove()}
    store._clipDragActive=false; // WEB-RACE：解除体检让路（本次 render 尾部会排最终检查）
    updateDragTip(null); // 传 null 只隐藏
    updateDragGuide(null);
    if(moved){
      updateTotalDuration();
      // 条身最终未位移（量化、触边或拖回原处）时保留历史及重做；缩放沿用原逻辑。
      if(type!=='move'||(group?group.some(function(it){return it.c.start!==it.s0}):clip.start!==origStart))saveHistory();
      render();
    }else if(group&&_plainLeftClick){ // O-3：多选集内未拖动的纯单击＝收拢为单选该条（单条入口随之出现；拖动仍整组平移）
      selectClipOnly(clip);refreshSelection();
    } // OPT-2/AUD-019：收尾才整页重建+存历史（纯点击不进历史，选中 UI 在 mousedown 已 render）
    document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
  };
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
}

function openGroupMove(){
  // P3：精确平移收编进多选上下文栏就地表单（公共 delta+改动预告+一次撤销，逻辑复用 ChoreoGroupMove）；
  // 无工作台宿主（无头/极早）时回落旧浮动对话框，能力不删。
  var sel=edSel();if(sel.length<2){showToast('请先选中至少两个片段再做精确平移');return}
  function read(){return {projectId:store.projectId,owner:store.contentExtra,totalDuration:store.totalDuration,
    items:edSel().map(function(e){return {clip:e.clip,owner:e.di<0?store.globalLyrics:store.dancers[e.di],track:e.track}})}};
  function commit(){saveHistory();render()}
  var host=document.getElementById('wbCtxHost');
  if(host&&window.ChoreoPropsUI&&ChoreoPropsUI.openGroupMove){
    var key=sel.map(function(s){return s.clip.id}).sort(function(a,b){return a-b}).join(',');
    if(ChoreoPropsUI.openGroupMove({key:key,read:read,commit:commit})){
      try{host.scrollIntoView({block:'nearest'})}catch(e){}
      return;
    }
  }
  ChoreoGroupMove.open(read,commit);
}

function openClipTime(clip,focusDuration){
  var projectId=store.projectId,extra=store.contentExtra,entry=null;
  ChoreoEdit.pure.eachClip(store,function(c,di,track){if(c===clip)entry={di:di,track:track}});
  if(!entry)return;
  ChoreoClipTime.open({clip:clip,focusDuration:focusDuration,
    isCurrent:function(){var found=false;ChoreoEdit.pure.eachClip(store,function(c,di,track){if(c===clip&&di===entry.di&&track===entry.track)found=true});return found&&store.projectId===projectId&&store.contentExtra===extra},
    totalDuration:function(){return store.totalDuration},
    conflict:function(start,duration){return hasConflict(entry.di,entry.track,start,duration,clip.id)||trackOverlapConflict(entry.di,entry.track,start,duration,clip.id)},
    commit:function(){updateTotalDuration();saveHistory();render()}
  });
}

function showCtxMenu(x,y,clip,di,tt){
  var m=document.getElementById('ctxMenu');m.innerHTML='';
  if(!clip.selected)selectClipOnly(clip); // 右键的这条不在多选里就当单选处理（对齐/删除作用范围随之确定）
  var nsel=edSel().length;
  var items=[{act:'dup',label:'\u590D\u5236'},{sep:true},
    {act:'align',label:'\u5BF9\u9F50\u5230\u64AD\u653E\u5934'+(nsel>1?'\uFF08'+nsel+' \u6761\uFF09':''),title:'选中条起点统一=播放头（保持各自时长；跨舞者齐奏用）'},
    {act:'paste',label:'\u7C98\u8D34\u5230\u9009\u4E2D\u6761\u540E',title:'紧贴当前选中的那条之后粘贴（没选中则粘到播放头）',disabled:!store._clipboard||!store._clipboard.items.length},
    {act:'copyPhrase',label:'复制此时段舞段…',title:'按时间窗勾选舞者×类型复制完整舞段（动作/切换/台词/全局歌词/标记/技能/走位/朝向）'},
    {act:'groupMove',label:'精确平移…',disabled:nsel<2},
    {act:'shiftSeg',label:'整段推迟/提前…',title:'所选片段/技能＋所选舞者窗内走位/朝向整体 ±Δt（表 A/T6；带影响范围预告与冲突覆盖确认）'},
    {act:'spatial',label:'整组变换…',title:'对所选舞者整组做镜像/90°旋转/起始位等距（整条走位/朝向轨＋起始位同步变换；一次撤销）'},
    {act:'time',label:'编辑时间…',disabled:nsel!==1},{act:'dur',label:'\u8BBE\u7F6E\u65F6\u957F...'},{act:'fill',label:'\u8865\u9F50\u7A7A\u9699(\u672C\u821E\u8005)',disabled:di<0},{act:'preview',label:'\u6E38\u620F\u5185\u9884\u89C8',disabled:!clip.data.command},{sep:true},{act:'del',label:nsel>1?('\u5220\u9664\u6240\u9009('+nsel+')'):'\u5220\u9664',danger:true}];
  if(tt==='switch')items.unshift({act:'gearset',label:'修改套装编号 / 时间…'});
  items.forEach(function(it){
    if(it.sep){m.appendChild(el('div','ctx-sep'));return}
    if(it.disabled){var mi=el('div','ctx-it',it.label);mi.style.opacity='.4';m.appendChild(mi);return}
    mi=el('div','ctx-it'+(it.danger?' danger':''),it.label);
    if(it.title)mi.title=it.title;
    mi.onclick=function(){
      if(it.act==='gearset')openGearsetPicker(clip,di);
      else if(it.act==='dup')duplicateClip(clip);
      else if(it.act==='align')alignSelectionToPlayhead();
      else if(it.act==='paste')pasteSelection();
      else if(it.act==='copyPhrase')b7bOpenCopyPhraseDialog();
      else if(it.act==='groupMove')openGroupMove();
      else if(it.act==='shiftSeg')shiftSegmentTime();
      else if(it.act==='spatial')spatialTransform();
      else if(it.act==='time'||it.act==='dur')openClipTime(clip,it.act==='dur');
      else if(it.act==='fill'){
        if(autoFillGaps(di)){saveHistory();updateTotalDuration();render();showToast('\u5DF2\u8865\u9F50\u821E\u8005'+(di+1)+'\u52A8\u4F5C\u8F68\u7684\u7A7A\u9699')}
        else showToast('本舞者动作轨没有需要补齐的空隙');
      }
      else if(it.act==='preview')apiPreview(clip.data.command).then(function(r){if(r.status==='blocked')return;showToast(r.status==='ok'?'\u9884\u89C8:'+clip.data.name:'\u5931\u8D25')}).catch(function(){showToast('\u5931\u8D25')});
      else if(it.act==='del')deleteSelectedClips();
      m.classList.remove('show');
    };
    m.appendChild(mi);
  });
  m.style.left=x+'px';m.style.top=y+'px';m.classList.add('show');
}
document.addEventListener('click',function(e){if(!e.target.closest('#ctxMenu'))document.getElementById('ctxMenu').classList.remove('show')});

function renderRuler(){
  var r=document.getElementById('ruler');if(!r)return;r.innerHTML='';
  // +40s 空白网格缓冲：轨道不在内容末尾"突然断轨"；拖片段进缓冲区时 totalDuration 自动生长
  var total=Math.max(store.totalDuration,30),pps=store.pps;
  var major=pps>=80?1:pps>=40?2:pps>=20?5:10;
  var minor=major/5;
  // P5：只建可见窗口内的刻度（手势期间不裁剪，铺满整个项目）
  var win=timelineWindow();
  var ticks=window.ChoreoRenderPerf?ChoreoRenderPerf.visibleTicks(win,{minorSec:minor,majorSec:major,totalDuration:total,suspended:win.suspended}):null;
  if(!ticks){ticks=[];for(var q=0;q<=total;q+=minor)ticks.push({t:q,major:q%major<0.01})}
  ticks.forEach(function(tk){
    var tick=el('div','r-tick'+(tk.major?' major':' minor'));
    tick.style.left=(LABEL_W+tk.t*pps)+'px';r.appendChild(tick);
    if(tk.major){var lb=el('div','r-lb',fmtDur(tk.t));lb.style.left=(LABEL_W+tk.t*pps)+'px';r.appendChild(lb)}
  });
  var c=document.getElementById('timelineCanvas');if(c)c.style.width=(LABEL_W+total*pps+80)+'px';
  // Render bottom ruler
  var bri=document.getElementById('bottomRulerInner');if(bri){
    bri.innerHTML='';bri.style.width=(LABEL_W+total*pps+80)+'px';
    ticks.forEach(function(tk){
      var bt=el('div','r-tick'+(tk.major?' major':' minor'));
      bt.style.left=(LABEL_W+tk.t*pps)+'px';bt.style.height='100%';bri.appendChild(bt);
      if(tk.major){var bl=el('div','r-lb',fmtDur(tk.t));bl.style.left=(LABEL_W+tk.t*pps)+'px';bl.style.bottom='6px';bri.appendChild(bl)}
    });
    // Bottom playhead marker
    var bpm=el('div','');bpm.id='bottomPlayhead';
    bpm.style.cssText='position:absolute;left:'+(LABEL_W+store.currentTime*pps)+'px;top:0;bottom:0;width:2px;background:var(--playhead);z-index:5;pointer-events:none';
    bri.appendChild(bpm);
  }
  // WP-3b：A-B 循环区间高亮 + 段落标记旗标（顶部/底部标尺都画；旗标只挂顶部，可交互）
  var hosts=[];
  var rTop=document.getElementById('ruler');if(rTop)hosts.push(rTop);
  var rBot=document.getElementById('bottomRulerInner');if(rBot)hosts.push(rBot);
  hosts.forEach(function(host,hi){
    if(store.loopA!=null&&store.loopB!=null){
      var l0=Math.min(store.loopA,store.loopB),l1=Math.max(store.loopA,store.loopB);
      var band=el('div','');
      band.style.cssText='position:absolute;top:0;bottom:0;background:rgba(126,179,255,.16);border-left:2px solid #7eb3ff;border-right:2px solid #7eb3ff;pointer-events:none;z-index:4';
      band.style.left=(LABEL_W+l0*pps)+'px';band.style.width=Math.max(2,(l1-l0)*pps)+'px';
      host.appendChild(band);
    }
    if(hi===0)(store.markers||[]).forEach(function(mk){
      var fl=el('div','mk-flag','\u2691'+(mk.name||''));
      fl.style.cssText='position:absolute;top:0;color:#ffd27e;cursor:pointer;z-index:6;line-height:1.4;padding:0 2px;white-space:nowrap;text-shadow:0 1px 2px #000';
      fl.style.left=(LABEL_W+mk.t*pps)+'px';
      fl.title=(mk.name||'标记')+' @ '+mk.t.toFixed(1)+'s\n点击：跳到标记；右键：改名/改时间/删除';
      fl.onclick=function(ev){ev.stopPropagation();seekTimelinePosition(Math.max(0,mk.t))};
      fl.oncontextmenu=function(ev){ev.preventDefault();ev.stopPropagation();showMarkerMenu(ev.clientX,ev.clientY,mk)};
      host.appendChild(fl);
    });
  });
}
