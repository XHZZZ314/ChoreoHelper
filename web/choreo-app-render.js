// 编舞助手 RENDER 外壳分件（OVERHAUL 批 C 第六步从 choreo-app.js 拆出）：
// 界面外壳层——_clipNodes/ChoreoDock 停靠、工具中心、命令面板注册表、空态与工作台壳、
// 属性面板、render/renderToolbar/renderSidebar/renderActionList 等。同全局名文件级搬家，
// 行为逐字不变；须在 choreo-app.js 之前加载（装时机语句自足，沿拆分件先于消费者先例）。
'use strict';

// === RENDER ===

// OPT-2/AUD-019：clip.id → 该条的全部 DOM 节点数组（全局歌词一条两个 DOM），render() 重建时重填；
// 拖动中的局部刷新按它找到要改 left/width 的节点，不再整页重建
var _clipNodes={};
// 工作区停靠：媒体节点留在 root 外；默认独立占位，也保留原有浮动预览和缩放。
window.ChoreoDock={floating:false,layout:function(){
  var frame=document.getElementById('editorFrame');if(!frame)return;
  var mp=document.getElementById('musicPanel'),musicHost=document.getElementById('musicDock');
  var p3d=document.getElementById('p3dPanel'),previewHost=document.getElementById('previewDock');
  // host 在 root 外，编辑重绘不拆卸音频、canvas 或 3D 资源。
  if(mp&&musicHost&&mp.parentNode!==musicHost)musicHost.appendChild(mp);
  var target=this.floating?document.body:previewHost;
  if(p3d&&target){if(p3d.parentNode!==target)target.appendChild(p3d);p3d.classList.toggle('docked',!this.floating);}
  var previewOpen=!!(!this.floating&&p3d&&p3d.classList.contains('open'));
  var widthChanged=frame.classList.contains('preview-open')!==previewOpen;
  frame.classList.toggle('preview-open',previewOpen);
  frame.classList.toggle('music-open',!!(mp&&mp.style.display!=='none'));
  if(mp)mp.style.right='';
  if(widthChanged&&store.appReady)markWindowDirty();
}};
function toggleMusicPanel(){
  var mp=document.getElementById('musicPanel');if(!mp){showToast('音乐面板未挂载');return;}
  // P4-A（#37）：底部音乐区收起/展开（默认收起，选择文件即展开）；无接线层时回落旧的显隐
  if(window.ChoreoMusicUI&&ChoreoMusicUI.toggleOpen){ChoreoMusicUI.toggleOpen();return;}
  mp.style.display=mp.style.display==='none'?'':'none';ChoreoDock.layout();
}
// 原生 details 提供键盘可达的菜单；复用按钮节点与既有回调，不复制业务逻辑。
function toolbarMenu(label,buttons){
  var menu=el('details','toolbar-menu'),summary=el('summary','btn',label+' ▾');
  menu.appendChild(summary);var items=el('div','toolbar-menu-items');
  buttons.forEach(function(b){if(b)items.appendChild(b)});menu.appendChild(items);
  menu.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();menu.open=false;summary.focus()}};
  items.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button');if(b&&!b.disabled)menu.open=false});
  return menu;
}
document.addEventListener('click',function(e){
  document.querySelectorAll('.toolbar-menu[open]').forEach(function(m){if(!m.contains(e.target))m.open=false});
});
// ===== P4-C 工具中心（#05/#40 尾/#41–#48/#50/#52/#53 前半） =====
// 顶栏「工具」1 击直达的分页容器：人物与资源/录制/协同/高级工具。旧「资源」「视图」菜单收编——
// 资料库/录制/双人直连/高级工具各自进页（能力逐项不删），音乐/歌词保持顶栏 1 击；
// B8 入口收敛：旧 2D 舞台自顶栏降级进高级工具页（R1 批 B8/§3，专家入口、能力不删），
// 固定/浮动预览与紧凑布局同在高级工具页（去向登记）。页面内容复用原弹窗/菜单的构建函数，不复制业务逻辑。
var _toolsPage='library';
var _toolsPages=[['library','人物与资源'],['record','录制'],['ensemble','协同'],['advanced','高级工具']];
function closeToolsCenter(){var bd=document.getElementById('toolsCenterModal');if(bd)bd.remove()}
function showToolsCenter(page){
  var opened=document.getElementById('toolsCenterModal');
  if(opened){if(page)setToolsPage(page);return}
  _toolsPage=page||_toolsPage||'library';
  var bd=el('div','modal-bg');bd.id='toolsCenterModal';bd.style.zIndex='600';
  var m=el('div','modal tools-center');
  m.appendChild(el('h3','','\uD83E\uDDF0 \u5DE5\u5177\u4E2D\u5FC3'));
  var tabs=el('div','tools-tabs');tabs.id='toolsTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','工具中心分页');
  _toolsPages.forEach(function(p){
    var b=el('button','btn tools-tab'+(_toolsPage===p[0]?' active':''),p[1]);
    b.type='button';b.dataset.toolsPage=p[0];
    b.setAttribute('role','tab');b.setAttribute('aria-selected',_toolsPage===p[0]?'true':'false');
    b.onclick=function(){setToolsPage(p[0])};
    tabs.appendChild(b);
  });
  var bClose=el('button','btn tools-close','关闭');bClose.id='toolsClose';bClose.type='button';bClose.onclick=closeToolsCenter;
  tabs.appendChild(bClose);m.appendChild(tabs);
  var host=el('div','tools-page');host.id='toolsPage';host.setAttribute('role','tabpanel');
  m.appendChild(host);
  bd.onclick=function(e){if(e.target===bd)closeToolsCenter()};
  bd.appendChild(m);document.body.appendChild(bd);
  mountToolsPage();
}
function setToolsPage(page){
  if(!document.getElementById('toolsPage'))return;
  _toolsPage=page;
  var tabs=document.querySelectorAll('#toolsTabs .tools-tab');
  for(var i=0;i<tabs.length;i++){
    var on=tabs[i].dataset.toolsPage===page;
    tabs[i].classList.toggle('active',on);
    tabs[i].setAttribute('aria-selected',on?'true':'false');
  }
  mountToolsPage();
}
function mountToolsPage(){
  var host=document.getElementById('toolsPage');if(!host)return;
  host.innerHTML='';
  try{
    if(_toolsPage==='library'){
      if(window.ChoreoLibraryUI&&ChoreoLibraryUI.panel)host.appendChild(ChoreoLibraryUI.panel({onClose:closeToolsCenter}));
      else host.appendChild(el('div','tools-empty','资料库界面未加载'));
    }else if(_toolsPage==='record'){
      if(window.ChoreoRecordingUI&&ChoreoRecordingUI.mountPanel)ChoreoRecordingUI.mountPanel(host);
      else host.appendChild(el('div','tools-empty','录制界面未加载'));
    }else if(_toolsPage==='ensemble'){
      host.appendChild(buildEnsemblePage());
    }else{
      host.appendChild(buildAdvancedToolsPage());
    }
  }catch(e){host.appendChild(el('div','tools-empty','工具页加载失败：'+((e&&e.message)||e)))}
}
// 协同页：只迁入口——按钮仍调 window.openEnsemblePanel，本地授权链/ensemble-app/session/transport 零触碰。
function buildEnsemblePage(){
  var box=el('div','ens-panel');
  box.appendChild(el('h4','tools-page-title','双人直连（实验）'));
  box.appendChild(el('p','tools-hint','双方各自在本机载入同一份演出，再手动交换邀请/答复文字；只传邀请、准备状态和计时信息，素材不外传。打开后是独立面板，收起面板演出继续。'));
  var b=el('button','btn primary','打开双人直连面板');b.id='toolsOpenEnsemble';b.type='button';
  b.title='打开原有的双人直连面板：生成邀请/接受邀请/准备并允许开演/本机停止（实验）';
  b.onclick=function(){
    closeToolsCenter();
    if(window.openEnsemblePanel)window.openEnsemblePanel();
    else showToast('双人直连模块未加载');
  };
  box.appendChild(b);
  box.appendChild(el('p','tools-hint','本机授权与停止语义不变；具体配对码、审阅与结果步骤仍在各自面板内完成。'));
  return box;
}
// 高级工具页：6 项由 recording-ui（原「⋯ 高级」弹层同源构建函数）提供；预览/布局开关在此收纳。
function buildAdvancedToolsPage(){
  var box=el('div','adv-panel');
  box.appendChild(el('h4','tools-page-title','高级工具'));
  box.appendChild(el('p','tools-hint','维护、实验与时间轴工具集中在此；实验功能已单独标注。演出请从「开演」进入。'));
  if(window.ChoreoRecordingUI&&ChoreoRecordingUI.advTools){
    var sec=el('div','tools-sec');
    sec.appendChild(el('h5','tools-sec-title','游戏与时间轴工具'));
    ChoreoRecordingUI.advTools().forEach(function(b){sec.appendChild(b)});
    box.appendChild(sec);
  }else box.appendChild(el('div','tools-empty','高级工具模块未加载'));
  var lay=el('div','tools-sec');
  lay.appendChild(el('h5','tools-sec-title','预览与布局 / 2D 舞台'));
  // B8 入口收敛（R1 批 B8/§3）：旧 2D 舞台降级为专家入口——自顶栏移入此页；接线与能力不变
  //（同一 ChoreoStageUI.openStage；日常走位＝舞台俯视图直拖＋时间轴下方就地编辑双入口）。
  var sb=el('button','btn','2D 舞台（专家）');sb.id='stageBtn';sb.type='button';
  sb.title='旧 2D 舞台（专家入口）：拖拽起始站位、快捷转向/前进、路径直编；日常走位在舞台俯视图直拖＋就地编辑完成';
  sb.setAttribute('aria-label','打开旧 2D 舞台（专家入口）');
  sb.onclick=function(){closeToolsCenter();if(window.ChoreoStageUI&&window.ChoreoStageUI.openStage)window.ChoreoStageUI.openStage(sb)};
  lay.appendChild(sb);
  var fb=el('button','btn',window.ChoreoDock&&ChoreoDock.floating?'固定预览':'浮动预览');fb.id='toolsFloatPreview';
  fb.title='固定预览不遮挡编舞；浮动预览可自由调整大小';
  fb.onclick=function(){ChoreoDock.floating=!ChoreoDock.floating;ChoreoDock.layout();fb.textContent=ChoreoDock.floating?'固定预览':'浮动预览'};
  var cb=el('button','btn'+(store.compact?' active':''),'紧凑布局');cb.id='toolsCompact';
  cb.title='分屏紧凑模式：动作面板变浮窗，工具栏/时间轴/轨道全部压缩，半屏显示更舒服';
  cb.onclick=function(){store.compact=!store.compact;_compactTouched=true;try{localStorage.setItem('choreo_compact',store.compact?'1':'0')}catch(e){};applyCompact();render();cb.classList.toggle('active',store.compact)};
  lay.appendChild(fb);lay.appendChild(cb);
  box.appendChild(lay);
  return box;
}
// 观察持久 root 的实际尺寸；停靠或窗口尺寸变化后补齐可见片段，不全页重绘。
if(typeof ResizeObserver==='function'){
  var workspaceSizeObserver=new ResizeObserver(function(){if(store.appReady)markWindowDirty()});
  var workspaceRoot=document.getElementById('root');if(workspaceRoot)workspaceSizeObserver.observe(workspaceRoot);
}
// P4-AC-3（命令面板）：Ctrl+K 打开——注册表每次打开时重建，只接线既有全局动作/开关，
// 与工具栏按钮逐字同源（snap/prop/compact 沿用按钮同款语句），不新增业务逻辑。
function buildCmdkCommands(){
  var one=edSel().length===1?edSel()[0]:null;
  return [
    {title:'播放 / 暂停',hint:'Space / K',kw:'play 播放 暂停',run:togglePlay},
    {title:'停止并回到开头',kw:'stop 停止',run:stopPlay},
    {title:'撤销',hint:'Ctrl+Z',kw:'undo 撤销',run:undo},
    {title:'重做',hint:'Ctrl+Y',kw:'redo 重做',run:redo},
    {title:'吸附 开 / 关',kw:'snap 吸附',run:function(){store.snapEnabled=!store.snapEnabled;render()}},
    {title:'右侧属性面板 开 / 关',kw:'prop 属性',run:function(){store.propOpen=!store.propOpen;try{localStorage.setItem('choreo_props_open',store.propOpen?'1':'0')}catch(e){}refreshProps()}},
    {title:'动作面板 收起 / 展开',kw:'sidebar 侧栏',run:toggleSidebar},
    {title:'分屏紧凑模式 开 / 关',kw:'compact 分屏',run:function(){store.compact=!store.compact;_compactTouched=true;try{localStorage.setItem('choreo_compact',store.compact?'1':'0')}catch(e){};applyCompact();render()}},
    {title:'3D 预览面板 开 / 关',kw:'3d preview 预览',run:function(){if(window.__togglePreview3D)window.__togglePreview3D();else showToast('3D 预览模块未加载')}},
    {title:'音乐排练面板 显示 / 隐藏',kw:'music 音乐',run:toggleMusicPanel},
    {title:'对齐到播放头',kw:'align 对齐',run:alignSelectionToPlayhead},
    {title:'精确平移（多选）',kw:'group move 平移',run:openGroupMove},
    {title:'整段推迟/提前（多选）',kw:'shift 推迟 提前 整段 平移',run:shiftSegmentTime},
    {title:'整组变换（镜像/旋转/等距）',kw:'spatial mirror rotate 整组 变换 镜像 旋转 等距 队形',run:spatialTransform},
    {title:'复制此时段舞段…',kw:'copy phrase 复制 舞段 时间窗',run:b7bOpenCopyPhraseDialog},
    {title:'编辑选中条时间…',kw:'time 时间',run:function(){if(one)openClipTime(one.clip);else showToast('请先选中一条动作')}},
    {title:'删除选中条',hint:'Delete',kw:'delete 删除',run:deleteSelectedClips},
    {title:'全选动作条',hint:'Ctrl+A',kw:'select all 全选',run:function(){edSelectAll();showToast('已全选全部动作条（Esc 取消）')}},
    {title:'回到开头',hint:'Home',kw:'home 开头',run:stopPlay},
    {title:'缩放到完整时间轴',kw:'fit 缩放 全长',run:fitTimeline},
    {title:'聚焦选中条',kw:'focus 聚焦',run:focusSelectedClip},
    {title:'添加到全部舞者 开 / 关',kw:'all dancer 全部',run:function(){store.addToAll=!store.addToAll;renderRegion('.sidebar',renderSidebar);refreshWorkbenchBars();showToast(store.addToAll?'添加到全部舞者：开':'添加到全部舞者：关')}},
    {title:'打开检查报告',kw:'check 检查 体检',run:showCheckModal}
  ];
}
function openCmdkPalette(){
  if(!window.ChoreoCmdkUI){showToast('命令面板模块未加载');return}
  ChoreoCmdkUI.open({commands:buildCmdkCommands()});
}
// P3-AC-4（空态引导）：会话级开关——关掉后本次不再弹；有任何时间轴事件/歌词/段落标记就不再显示
var _emptyGuideOff=false;
function projectIsEmpty(){
  if(store.globalLyrics.length||store.markers.length)return false;
  // 技能、走位/朝向等规范轨不在旧泳道里；保留的停用事件也是内容，仅空轨容器不算。
  var tracks=store.contentExtra&&store.contentExtra._doc&&store.contentExtra._doc.extraTracks;
  if(Array.isArray(tracks)&&tracks.some(function(t){return t&&Array.isArray(t.events)&&t.events.length>0}))return false;
  var any=false;ChoreoEdit.pure.eachClip(store,function(){any=true});return !any;
}
// ===== P1-A 工作台壳接线：未用轨折叠/贴合影棚/上下文栏宿主 =====
function _dancerHasContent(d,di){
  if(!d)return false;
  if(di===store.selectedDancer)return true; // 当前舞者始终展开，添加目标不会藏进折叠区
  if((d.switchClips||[]).length||(d.actionClips||[]).length||(d.lyricClips||[]).length)return true;
  if(window.ChoreoEdit&&ChoreoEdit.pure&&ChoreoEdit.pure.hasExplicitStart&&ChoreoEdit.pure.hasExplicitStart(d))return true;
  if(d.profileId)return true;
  if(window.ChoreoAbilityPlan&&ChoreoAbilityPlan.rows&&ChoreoAbilityPlan.pid){
    var who=ChoreoAbilityPlan.pid(store,di);
    if(who&&ChoreoAbilityPlan.rows(store).some(function(r){return r.source===who}))return true;
  }
  if(window.ChoreoStageMotion&&ChoreoStageMotion.rows&&ChoreoStageMotion.pid){
    var who2=ChoreoStageMotion.pid(store,di);
    if(who2&&ChoreoStageMotion.rows(store).some(function(t){return t.performerId===who2}))return true;
  }
  return false;
}
function timelineContentEnd(){
  var end=0;
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){(d[k]||[]).forEach(function(c){var e=c.start+c.duration;if(e>end)end=e})})});
  store.globalLyrics.forEach(function(c){var e=c.start+c.duration;if(e>end)end=e});
  if(window.ChoreoAbilityPlan)end=Math.max(end,ChoreoAbilityPlan.end(store));
  if(window.ChoreoStageMotion)end=Math.max(end,ChoreoStageMotion.end(store));
  return end;
}
function fitTimelineToContent(){
  if(store._ppsTouched)return;
  var wrap=document.getElementById('timelineWrap');if(!wrap)return;
  var end=timelineContentEnd();if(end<=0)return;
  var avail=wrap.clientWidth-LABEL_W-24;if(avail<=40)return;
  var pps=Math.max(20,Math.min(120,avail/Math.max(6,end+1)));
  if(Math.abs(pps-store.pps)<0.5)return;
  store.pps=Math.round(pps*100)/100;
  render();
}
function edNeighbors(clip){
  var out={prev:null,next:null};if(!clip)return out;
  for(var di=0;di<store.dancers.length;di++){
    var d=store.dancers[di];
    for(var ti=0;ti<3;ti++){
      var tt=['switch','action','lyric'][ti],arr=d[tt+'Clips']||[];
      if(arr.indexOf(clip)<0)continue;
      var sorted=arr.slice().sort(function(a,b){return a.start-b.start}),idx=sorted.indexOf(clip);
      out.prev=idx>0?sorted[idx-1]:null;out.next=sorted[idx+1]||null;return out;
    }
  }
  return out;
}
function focusWorkbenchLibrary(msg){
  document.body.classList.remove('wide-nosb'); // 添加入口始终展开已有动作库（含宽屏手动收起）
  if(document.body.classList.contains('narrow')||!document.querySelector('.sidebar'))openSidebar();
  var al=document.querySelector('.act-list');
  if(al){al.classList.add('wb-flash');setTimeout(function(){if(al.classList)al.classList.remove('wb-flash')},1200)}
  if(msg)showToast(msg);
}
function renderWorkbenchBars(){
  var addHost=el('div','wb-addhost');addHost.id='wbAddHost';
  var ctxHost=el('div','wb-ctxhost');ctxHost.id='wbCtxHost';
  if(window.ChoreoWorkbench){
    var bar=ChoreoWorkbench.addBar({
      onAddNext:function(){focusWorkbenchLibrary('接着添加：从左侧动作库点一个动作')},
      onInsert:function(){focusWorkbenchLibrary('插在这里：从左侧动作库点一个动作，将落在所选时刻')},
      onBack:function(){ChoreoWorkbench.clearInsert()},
      onWaitChange:function(v){ChoreoWorkbench.setAppendWait(v)},
      onMacro:function(){openMacroStart()}
    });
    if(bar)addHost.appendChild(bar);
    // P1-B：不支持的行保留原文备查（按当前舞者，独立于宏起步窗）
    if(window.ChoreoMacroUI&&ChoreoMacroUI.notesFor){
      var notesArea=ChoreoWorkbench.macroNotesArea(ChoreoMacroUI.notesFor(store,store.selectedDancer));
      if(notesArea)addHost.appendChild(notesArea);
    }
  }
  var sel=edSel();
  // P2/P3：技能就地编排或走位/朝向就地编辑优先占用上下文栏；技能选择是更明确的用户动作，先于走位会话。
  if(window.ChoreoAbilityUI&&ChoreoAbilityUI.renderContext){
    var skillCtx=ChoreoAbilityUI.renderContext();
    if(skillCtx){ctxHost.appendChild(skillCtx);return {add:addHost,ctx:ctxHost}}
  }
  if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.renderContext){
    var motionCtx=ChoreoStageMotionUI.renderContext();
    if(motionCtx){ctxHost.appendChild(motionCtx);return {add:addHost,ctx:ctxHost}}
  }
  var skillSelN=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection().length:0;
  if(!sel.length&&!skillSelN&&window.ChoreoPropsUI){
    // 无选中：清空上下文栏（保持与旧行为一致）
  }else if(sel.length+skillSelN>1&&window.ChoreoPropsUI&&ChoreoPropsUI.renderMultiContextBar){
    ctxHost.appendChild(ChoreoPropsUI.renderMultiContextBar({
      actionCount:sel.length,skillCount:skillSelN,
      key:sel.map(function(s){return s.clip.id}).sort(function(a,b){return a-b}).join(','),
      onAlign:function(){alignSelectionToPlayhead()},
      onGroupMove:function(){openGroupMove()},
      onDelete:function(){deleteSelectedClips()}
    }));
    return {add:addHost,ctx:ctxHost};
  }
  if(sel.length===1&&window.ChoreoPropsUI){
    var one=sel[0];
    var ctx=ChoreoPropsUI.renderContextBar({
      selection:sel,neighbors:edNeighbors,
      dancerName:one.di<0?'全局歌词':store.dancers[one.di].name,
      // J2：第几条＝该舞者动作轨按开始时刻排序的序号（仅动作轨；同刻按 id 稳定）
      ordinal:function(clip){
        if(one.di<0||one.track!=='action')return null;
        var arr=store.dancers[one.di].actionClips.slice().sort(function(a,b){return (a.start-b.start)||(a.id-b.id)});
        var i=arr.indexOf(clip);return i>=0?(i+1):null;
      },
      // J3：时长来源五分类（只读；clip.data 不存 isLoop/duration，按 command 回查目录源恢复循环标记）
      durationSource:function(clip){
        var cmd=clip&&clip.data&&clip.data.command,src=null;
        if(cmd)['emotes','actions'].forEach(function(k){if(src)return;src=((store[k]||[]).filter(function(x){return x.command===cmd})[0])||null});
        return clipDurationSourceLabel(clip,store.measuredDur,src);
      },
      totalDuration:function(){return store.totalDuration},
      conflict:function(ns,nd){return hasConflict(one.di,one.track,ns,nd,one.clip.id)||trackOverlapConflict(one.di,one.track,ns,nd,one.clip.id)},
      rehearsalActive:function(){return !!(window.ChoreoWorkbench&&ChoreoWorkbench.rehearsalActive())},
      rehearsalRange:function(){return window.ChoreoWorkbench?ChoreoWorkbench.rehearsalRange():null},
      commit:function(){updateTotalDuration();saveHistory();render()},
      // P4-A（#34）：切换轨片段就地编辑套装编号/时间；旧套装窗保留为专家/回落入口（右键/双击/宏面板均不动）
      gearset:(one.di>=0&&one.track==='switch')?{
        preview:function(slot){
          var r=ChoreoGearset.makeSwitch(slot,_gearsetSnapshot||null,store.classJobs);
          return r.ok?{ok:true,command:r.data.command,warning:r.warning,name:r.data.name}:{ok:false,error:r.error};
        },
        apply:function(slot,start){return applyGearsetEdit(one.clip,one.di,slot,start)},
        onExpert:function(){var cur=edSel()[0];if(cur&&cur.track==='switch')openGearsetPicker(cur.clip,cur.di);}
      }:null,
      onAction:function(act){
        var cur=edSel()[0];
        if(act==='del')deleteSelectedClips();
        else if(act==='time'&&cur)openClipTime(cur.clip);
        else if(act==='rehearse'&&cur)startLocalRehearsal(cur.clip);
        else if(act==='move'&&cur&&cur.di>=0&&cur.track==='action')openSamePlaceMove(cur.di,cur.clip);
        else if(act==='turn'&&cur&&cur.di>=0&&cur.track==='action'&&window.ChoreoStageMotionUI)ChoreoStageMotionUI.openFacing(cur.di);
        else if(act==='dup'&&cur)duplicateClip(cur.clip);
        else if(act==='align')alignSelectionToPlayhead();
      }
    });
    if(ctx)ctxHost.appendChild(ctx);
  }
  // P2：无选中时保留同高占位，选中/取消不会推动时间轴（双击第二下仍落在原片段上）
  if(!ctxHost.children.length){
    var ph=el('div','wb-ctx wb-ctx-idle');ph.setAttribute('aria-hidden','true');ctxHost.appendChild(ph);
  }
  return {add:addHost,ctx:ctxHost};
}
function refreshWorkbenchBars(){
  if(document.getElementById('wbAddHost'))renderRegion('#wbAddHost',function(){return renderWorkbenchBars().add});
  if(document.getElementById('wbCtxHost'))renderRegion('#wbCtxHost',function(){return renderWorkbenchBars().ctx});
}
// P3-AC-1（属性面板）：视图在 choreo-props-ui.js，这里只注入选择集、校验输入与提交路径
function renderPropPanel(){
  var sel=edSel(),one=sel.length===1?sel[0]:null;
  return ChoreoPropsUI.render({
    selection:sel,
    totalDuration:function(){return store.totalDuration},
    conflict:function(ns,nd){return one?(hasConflict(one.di,one.track,ns,nd,one.clip.id)||trackOverlapConflict(one.di,one.track,ns,nd,one.clip.id)):false},
    commit:function(){updateTotalDuration();saveHistory();render()},
    onAction:function(act){
      var cur=edSel()[0];
      if(act==='align')alignSelectionToPlayhead();
      else if(act==='groupMove')openGroupMove();
      else if(act==='del')deleteSelectedClips();
      else if(act==='dup'&&cur)duplicateClip(cur.clip);
      else if(act==='time'&&cur)openClipTime(cur.clip);
    },
    onToggle:function(){store.propOpen=false;try{localStorage.setItem('choreo_props_open','0')}catch(e){}refreshProps()}
  });
}
// 局部界面更新：选择/属性/目录不拆卸时间轴、宏输入框和音乐节点。
function renderRegion(selector,build){
  var node=document.querySelector(selector);if(!node)return false;
  var top=node.scrollTop,left=node.scrollLeft,opened=node.classList.contains('open');
  var scrolls={};if(node.querySelector)['.tabs-wrap','.act-list'].forEach(function(key){var child=node.querySelector(key);if(child)scrolls[key]=child.scrollTop});
  var replacement=build();node.parentNode.replaceChild(replacement,node);
  Object.keys(scrolls).forEach(function(key){var child=replacement.querySelector(key);if(child)child.scrollTop=scrolls[key]});
  replacement.scrollTop=top;replacement.scrollLeft=left;if(opened)replacement.classList.add('open');return true;
}
function refreshSelection(){
  document.querySelectorAll('.clip').forEach(function(node){node.classList.toggle('selected',!!(node.__clip&&node.__clip.selected))});
  if(store.propOpen&&window.ChoreoPropsUI)renderRegion('.prop-pnl',renderPropPanel);
  if(typeof refreshWorkbenchBars==='function')refreshWorkbenchBars(); // P1-A：选中变化即时刷新上下文栏
  ChoreoGroupMove.refresh();
}
function refreshProps(){
  var panel=document.querySelector('.prop-pnl'),workspace=document.querySelector('.workspace');
  if(panel)panel.remove();
  if(store.propOpen&&window.ChoreoPropsUI&&workspace)workspace.appendChild(renderPropPanel());
  var button=document.getElementById('propBtn');if(button)button.classList.toggle('active',!!store.propOpen);
  markWindowDirty();
}
function focusSelectedClip(){
  var selected=edSel();if(!selected.length){showToast('请先选中动作条');return}
  var wrap=document.getElementById('timelineWrap');if(!wrap)return;
  wrap.scrollLeft=Math.max(0,selected[0].clip.start*store.pps-40);markWindowDirty();
}
function fitTimeline(){
  var wrap=document.getElementById('timelineWrap');if(!wrap)return;
  store.pps=Math.max(.001,Math.min(200,(wrap.clientWidth-LABEL_W-24)/Math.max(1,store.totalDuration)));
  render();var next=document.getElementById('timelineWrap');if(next)next.scrollLeft=0;markWindowDirty();
}
function render(){
  ChoreoGroupMove.refresh();
  if(!store.appReady)return; // 阶段1：编辑器渲染只看网页程序就绪，不再被游戏连接挡住
  if(window.ChoreoMacroUI&&ChoreoMacroUI.isComposing()){ChoreoMacroUI.deferRender();return}
  // OPT-2/AUD-018：内容版本号——3D 面板(preview3d.js)靠它感知时间轴变化，只有变了才重排引擎
  // 界面重绘不代表内容变化；版本由 bumpTimelineRev 和实时拖动推进。
  store._renderCount=(store._renderCount||0)+1; // OPT-2/AUD-019 诊断：完整重建次数（拖动中不应增长）
  // OPT-2/AUD-019：clip.id → DOM 节点表（拖动中局部刷新用），每次重建后重填
  _clipNodes={};
  var root=document.getElementById('root');
  // 2026-08-28：重建 DOM 前记住各滚动容器的位置，重建后恢复——加/删/改/拖任何动作
  // 都会整页重建，之前时间轴（横向 18000px）弹回最左、动作列表回顶部，看着就像"跳到开头"
  var _sc={};
  var _w0=document.getElementById('timelineWrap');
  if(_w0)_sc.tl=[_w0.scrollLeft,_w0.scrollTop];
  _tlWinCache=null;timelineWindow(true,_w0); // P5：重建前先按旧容器量好可见窗口（新容器此时还没进文档）
  var _al0=document.querySelector('.act-list');if(_al0)_sc.al=_al0.scrollTop;
  var _tw0=document.querySelector('.tabs-wrap');if(_tw0)_sc.tw=_tw0.scrollTop;
  // 会话复用同一输入框；重绘前保存完整选择区，不压成单一光标。
  var cur=document.activeElement,macroFocus=null;
  if(cur&&cur.classList&&cur.classList.contains('macro-tx')){
    macroFocus={node:cur,start:cur.selectionStart,end:cur.selectionEnd,direction:cur.selectionDirection,scroll:cur.scrollTop};
    cur.remove();
  }
  root.innerHTML='';
  root.appendChild(renderToolbar());
  var ws=el('div','workspace');
  // P1-A：空项目先给“一句话+三入口”，不铺空轨道墙；用户选“从零开始/从已有宏开始”后进工作台。
  if(window.ChoreoWorkbench&&ChoreoWorkbench.showEmpty()&&projectIsEmpty()){
    ws.appendChild(ChoreoWorkbench.emptyState({
      onScratch:function(){ChoreoWorkbench.beginWorkbench();render();focusWorkbenchLibrary()},
      onMacro:function(){openMacroStart()},
      onOpen:function(){showProjectModal()}
    }));
  }else{
    ws.appendChild(renderSidebar());
    ws.appendChild(renderTimelineArea());
    if(store.propOpen&&window.ChoreoPropsUI)ws.appendChild(renderPropPanel()); // P3：属性面板保留为专家入口（P1-A 上下文栏已接管常用项）
  }
  root.appendChild(ws);
  root.appendChild(renderMacroPanel());
  root.appendChild(renderBottomBar());
  renderRuler();updatePlayhead();updateTimeDisplay();
  if(window.ChoreoWorkbench)ChoreoWorkbench.syncStage();
  // 滚动位置恢复（时间轴 + 底部标尺联动 + 侧栏列表/标签栏）
  var _w=document.getElementById('timelineWrap');
  if(_w&&_sc.tl){
    _w.scrollLeft=_sc.tl[0];_w.scrollTop=_sc.tl[1];
    var _br=document.getElementById('bottomRuler');if(_br)_br.scrollLeft=_w.scrollLeft;
  }
  var _al=document.querySelector('.act-list');if(_al&&_sc.al!=null)_al.scrollTop=_sc.al;
  var _tw=document.querySelector('.tabs-wrap');if(_tw&&_sc.tw!=null)_tw.scrollTop=_sc.tw;
  _tlWinRange=timelineWindow(true); // P5：记住本次重绘用的窗口，滚动时只补渲差量
  if(macroFocus&&macroFocus.node.isConnected){
    macroFocus.node.focus();macroFocus.node.setSelectionRange(macroFocus.start,macroFocus.end,macroFocus.direction);
    macroFocus.node.scrollTop=macroFocus.scroll;
  }
  _applySideOpen();
  // 实时体检：每次重绘后排一个防抖检查（编辑/拖动停稳 800ms 后真跑），并保持徽标同步
  scheduleRealtimeCheck();
  updateCheckBadge();
  // P1-A：打开旧项目后可见范围贴合内容（用户手动缩放过就不再自动改）
  if(store._fitPending){store._fitPending=false;fitTimelineToContent();}
}

// O-7：3D 预览按钮按压态/aria-pressed/提示随 #p3dPanel 开合同步（REQ-SPEC-020 自动打开不改，
// 读面板现状即可；沿 workbench 观察 #p3dPanel class 的 MutationObserver 先例，
// 面板晚建（游戏角色目标/手动首开）由 body childList 观察者兜底补挂）。
function sync3dPreviewBtnTo(b){
  var p=document.getElementById('p3dPanel');
  var open=!!(p&&p.classList.contains('open'));
  b.classList.toggle('active',open);
  b.setAttribute('aria-pressed',String(open));
  b.title=open?'3D 预览面板已打开：点击收起':'查看舞者预览；已存本机的模型和动作可离线使用（点击打开 3D 面板）';
}
function sync3dPreviewBtn(){var b=document.getElementById('btn3dPreview');if(b)sync3dPreviewBtnTo(b)}
function arm3dPreviewSync(){
  if(typeof MutationObserver!=='function')return;
  var p=document.getElementById('p3dPanel');
  if(p&&!p.__btn3dObserved){p.__btn3dObserved=true;new MutationObserver(sync3dPreviewBtn).observe(p,{attributes:true,attributeFilter:['class']})}
  if(!window.__btn3dBodyArm){window.__btn3dBodyArm=true;new MutationObserver(function(){arm3dPreviewSync();sync3dPreviewBtn()}).observe(document.body,{childList:true})}
}
function renderToolbar(){
  var tb=el('div','toolbar');
  var pdi=gameActorIdx(),pdn=pdi>=0?store.dancers[pdi].name:''; // ACTOR：游戏模式提示当前预览舞者
  var brand=el('div','brand');
  brand.appendChild(el('span','logo','FF14'));
  brand.appendChild(el('span','sub','编舞助手'));
  tb.appendChild(brand);
  tb.appendChild(el('div','tb-sep'));
  // ── 播放/演出组：播放键是全工具栏唯一 primary 主按钮 ──
  // REQ-SPEC-027（TASK-20260905-DUAL-MODE-CLOSEOUT，主人决定 B）：播放键本体可见文字携带模式
  // ——停止/播放两态都显示「网页播放/游戏内播放」；render() 每次重建工具栏，切模式/播放态变化
  // 自然刷新标签。tooltip、模式切换钮、状态栏提示照旧保留
  var bp=el('button','btn primary',(store.isPlaying?'\u23F8 ':'\u25B6 ')+(store.previewTarget==='game'?'\u6E38\u620F\u5185\u64AD\u653E':'\u7F51\u9875\u64AD\u653E'));
  bp.id='playBtn';
  bp.title='\u64AD\u653E(\u7A7A\u683C)\u2014\u2014\u5F53\u524D\uFF1A'+(store.previewTarget==='game'?('\u6E38\u620F\u5185\u64AD\u653E\uFF08\u9884\u89C8\u821E\u8005\uFF1A'+pdn+'\uFF09'):'\u7F51\u9875\u64AD\u653E');bp.onclick=togglePlay;
  tb.appendChild(bp);
  updatePlaybackButton(bp);
  // J4 普通停止：按钮语义明示（网页归零＋退出本次循环，手动 A/B 保留）；与常驻「立即停止」区分
  var bs=el('button','btn icon','\u23F9');bs.title='停止（普通停止）：网页播放停止、播放头归 0；本次循环试看一并退出，手动设的 A/B 保留';bs.onclick=stopPlay;tb.appendChild(bs);
  // 统一游戏演出入口：整场检查（只读）→ 既有准备与确认流程 → 结果与复盘；打开检查页不发送任何请求
  var bse=el('button','btn','\uD83C\uDFAD \u6E38\u620F\u6F14\u51FA');
  bse.title='整场检查与游戏演出准备；打开不会开始';
  bse.onclick=function(){if(window.ChoreoShowEntry)ChoreoShowEntry.open({di:gameActorIdx()});else showToast('\u6574\u573A\u68C0\u67E5\u6A21\u5757\u672A\u52A0\u8F7D')};
  tb.appendChild(bse);
  var td=el('span','time-disp');td.id='timeDisplay';td.textContent=fmtTime(store.currentTime);tb.appendChild(td);
  var sc=el('div','ctrl');sc.appendChild(el('label','','\u901F\u5EA6'));
  var sl=document.createElement('input');sl.type='range';sl.min='0.25';sl.max='2';sl.step='0.25';sl.value=store.speed;
  sl.onchange=function(e){var ns=parseFloat(e.target.value);if(store.isPlaying){var e2=(performance.now()-playStart)/1000*store.speed;playOffset=playOffset+e2;playStart=performance.now()}store.speed=ns};sc.appendChild(sl);
  sc.appendChild(el('span','',store.speed.toFixed(2)+'\u00D7'));tb.appendChild(sc);
  tb.appendChild(el('div','tb-sep'));
  // ── 视图组 ──
  // 阶段1（模式分流）：预览目标切换——网页 3D（默认）/ 游戏角色，决定拖动和播放发给谁
  var mt=el('button','btn'+(store.previewTarget==='game'?' active':''),store.previewTarget==='game'?'\uD83C\uDFAE \u6E38\u620F\u89D2\u8272':'\uD83C\uDF10 \u7F51\u9875 3D');
  mt.title='\u9884\u89C8\u76EE\u6807\uFF1A\u65F6\u95F4\u8F74\u62D6\u52A8\u548C\u64AD\u653E\u53D1\u7ED9\u8C01\u3002\u300C\u7F51\u9875 3D\u300D\u53EA\u9A71\u52A8\u7F51\u9875\u6A21\u578B\uFF08\u6E38\u620F\u53EF\u4EE5\u5173\u7740\uFF09\uFF1B\u300C\u6E38\u620F\u89D2\u8272\u300D\u9A71\u52A8\u6E38\u620F\u5185\u89D2\u8272\uFF08\u9700\u6E38\u620F\u548C\u63D2\u4EF6\u5F00\u7740\uFF09';
  mt.onclick=switchPreviewTarget;
  tb.appendChild(mt);
  // P2：1–8 人数快捷收进「更多设置」；日常增删在时间轴舞者行就地完成（减人确认保留）
  var dc=el('div','ctrl');
  var dcg=el('div','dancer-sel');dcg.setAttribute('aria-label','舞者人数快捷（1–8）');
  [1,2,3,4,5,6,7,8].forEach(function(n){var b=el('button','',String(n));b.title='设置为 '+n+' 位舞者；减少人数需确认，可撤销';b.setAttribute('aria-label','设置为 '+n+' 位舞者');if(store.dancerCount===n)b.classList.add('active');b.onclick=function(){if(n<store.dancerCount&&!window.confirm('将移除末尾 '+(store.dancerCount-n)+' 位舞者及其编排，可撤销。继续？'))return;setDancerCount(n)};dcg.appendChild(b)});
  var dancersMenu=toolbarMenu('更多设置 · 舞者 '+store.dancerCount,[el('p','menu-hint','人数快捷 1–8（创作上限 12）；增删舞者也可在时间轴舞者行就地操作'),dcg]);
  dancersMenu.setAttribute('data-wb','more-settings');
  dc.appendChild(dancersMenu);tb.appendChild(dc);
  var snapBtn=el('button','btn'+(store.snapEnabled?' active':''),'⇝ 吸附');
  snapBtn.title='吸附到时间或片段边缘；按住 Alt 暂时关闭';
  snapBtn.onclick=function(){store.snapEnabled=!store.snapEnabled;render()};
  tb.appendChild(snapBtn);
  var bsb=el('button','btn icon','\u2630');bsb.title='\u6536\u8D77/\u5C55\u5F00\u52A8\u4F5C\u9762\u677F';
  bsb.onclick=toggleSidebar;tb.appendChild(bsb);
  var bProp=el('button','btn icon'+(store.propOpen?' active':''),'\u25A4');bProp.id='propBtn';
  bProp.title='右侧专家属性面板（备用入口：开始/时长、复制/对齐等）；常用编辑在时间轴下方选中条就地完成';
  bProp.onclick=function(){store.propOpen=!store.propOpen;try{localStorage.setItem('choreo_props_open',store.propOpen?'1':'0')}catch(e){}refreshProps()};tb.appendChild(bProp);
  // P4-C：原顶栏「⇫ 分屏」紧凑布局开关收进工具中心高级工具页（去向登记，能力不删）
  tb.appendChild(el('div','tb-sep'));
  // ── 历史组：撤销/重做可见化（引擎早已支持，此前没有可见入口） ──
  var bUndo=el('button','btn icon','\u21B6');bUndo.title='\u64A4\u9500\u4E0A\u4E00\u6B65\u7F16\u8F91\uFF08\u53EF\u8FDE\u7EED\u64A4\u9500\uFF0C\u64A4\u9500\u540E\u81EA\u52A8\u4FDD\u5B58\uFF09';
  bUndo.disabled=store.historyIdx<=0;bUndo.onclick=undo;tb.appendChild(bUndo);
  var bRedo=el('button','btn icon','\u21B7');bRedo.title='\u91CD\u505A\u88AB\u64A4\u9500\u7684\u4E00\u6B65\u7F16\u8F91';
  bRedo.disabled=store.historyIdx>=store.history.length-1;bRedo.onclick=redo;tb.appendChild(bRedo);
  tb.appendChild(el('div','tb-sep'));
  // ── 资源/排练组：P4-C（#05/#06）起低频/协同/实验面收进顶栏「工具」中心，资源/视图菜单取消 ──
  var b3d=el('button','btn','\uD83E\uDCCC 3D\u9884\u89C8');
  b3d.id='btn3dPreview'; // O-7：状态同步锚点
  b3d.title='查看舞者预览；已存本机的模型和动作可离线使用（点击打开 3D 面板）';
  b3d.onclick=function(){if(window.__togglePreview3D)window.__togglePreview3D();else showToast('3D 预览模块未加载')};
  if(typeof sync3dPreviewBtnTo==='function')sync3dPreviewBtnTo(b3d); // O-7：初始按压态随面板现状（自动打开时即按下）
  if(typeof arm3dPreviewSync==='function')arm3dPreviewSync();
  tb.appendChild(b3d); // 节点随后归位到播放区（宽屏）或「排练设置」（窄屏），此处只建事件
  // 「工具」：1 击直达工具中心（人物与资源/录制/协同/高级工具分页容器，不做二级菜单）
  var bTools=el('button','btn','\uD83E\uDDF0 \u5DE5\u5177');bTools.id='toolsBtn';
  bTools.title='工具中心：资料库（人物与资源）、录制、协同与高级工具';
  bTools.onclick=function(){showToolsCenter()};
  tb.appendChild(bTools);
  // 视图菜单收编（B8 修订）：旧 2D 舞台降级进工具中心·高级工具页（能力不删，见 buildAdvancedToolsPage
  // 去向登记）；音乐保持顶栏 1 击导航；固定/浮动预览与紧凑布局收进高级工具页
  var musicButton=el('button','btn','\u97F3\u4E50');musicButton.id='musicBtn';
  musicButton.title='音乐与节拍：展开/收起底部音乐区（原视图菜单同一入口）';
  musicButton.onclick=toggleMusicPanel;
  tb.appendChild(musicButton);
  // WP-4：编舞体检——规则引擎在 web\choreo-check.js（纯函数、node 可测），这里只做入口
  // 实时体检：编辑后自动跑（见 runRealtimeCheck），按钮上的红/黄计数由 updateCheckBadge 维护
  // P4-B（#02 尾）：顶栏形态定稿——入口读作「检查」，打开问题列表并定位到片段
  var bchk=el('button','btn','\uD83E\uDE7A \u68C0\u67E5');bchk.id='btnCheck';
  bchk.title='检查编舞问题并定位到对应片段';
  bchk.onclick=showCheckModal;
  tb.appendChild(bchk);
  if(window.ChoreoSkillGame&&((window.ChoreoAbilityPlan&&ChoreoAbilityPlan.blocksGame(store))||(window.ChoreoSkillRecords&&ChoreoSkillRecords.list(store.contentExtra).length))){
    var skillResult=el('button','btn','技能实演结果');skillResult.onclick=ChoreoSkillGame.showResult;tb.appendChild(skillResult);
  }
  // 歌词按范围决定保持顶栏 1 击（去向登记见任务 P4-C 交付简报）；双人直连/高级工具已入工具中心对应页
  var bl=el('button','btn','\u{1F3B5} \u6B4C\u8BCD');bl.title='\u6B4C\u8BCD\u4E0E\u53F0\u8BCD\uFF1A\u53CC\u8BED\u6B4C\u8BCD\u5BFC\u5165\u3001\u624B\u5199\u53F0\u8BCD\u7BA1\u7406';bl.onclick=function(){showLyricsModal()};tb.appendChild(bl);
  tb.appendChild(el('div','tb-sep'));
  // ── 项目/文件组：P4-B 顶栏形态定稿——「📁 项目」即项目中心；
  // 原「📂 文件」菜单的导出/宏TXT/导入/清空已收编进项目中心（#08/#09/#10，能力逐项不删），
  // 这里只留隐藏的导入文件输入（项目中心「导入为新项目」与命令流程共用）。
  var bprj=el('button','btn','\uD83D\uDCC1 项目');
  bprj.title='项目中心：打开、新建、历史版本、导入导出与清空';
  bprj.onclick=showProjectModal;
  tb.appendChild(bprj);
  var fi=document.createElement('input');fi.type='file';fi.id='fileInput';fi.accept='.json';fi.style.display='none';
  fi.onchange=function(e){var input=e.target,f=input.files[0];var op=input._projectOp===undefined?beginProjectOperation():input._projectOp;input._projectOp=undefined;input.value='';if(f)readProjectFile(f,op)};
  fi.oncancel=function(){if(currentProjectOperation(fi._projectOp))beginProjectOperation();fi._projectOp=undefined};
  tb.appendChild(fi);
  tb.appendChild(el('div','spacer'));
  var dot=el('span','dot '+(store.connected?'live':''));
  dot.title=store.connected?'游戏已连接——点击刷新动作与技能目录':'游戏未连接——点击重新检测并刷新目录';
  dot.style.cursor='pointer';
  dot.onclick=function(){probeGame(false,true)};
  tb.appendChild(dot);
  bsb.textContent='动作库';bProp.textContent='属性';
  var nav=el('div','toolbar-nav'),transport=el('div','toolbar-transport');
  brand.title=store.projectName||'我的编舞';
  while(tb.firstChild)tb.removeChild(tb.firstChild);
  // P4-C：资源/视图菜单收编后导航节点直接平铺——工具、音乐、歌词 1 击可达；
  // B8：2D 舞台不在顶栏（降级进工具中心·高级工具页）
  var navNodes=[brand,bprj,bUndo,bRedo,bchk,bsb,bProp,bTools,musicButton,bl];
  if(typeof skillResult!=='undefined')navNodes.push(skillResult);
  navNodes.push(dot,fi);
  navNodes.forEach(function(n){nav.appendChild(n)});
  // 窄屏保留演出主操作，设置菜单复用原节点和事件，不复制控制器。
  if(window.innerWidth<=1000){
    var settings=toolbarMenu('排练设置',[sc,mt,snapBtn,dc,b3d]);settings.classList.add('rehearsal-settings');
    [bp,bs,td,bse,settings].forEach(function(n){transport.appendChild(n)});
  }else [bp,bs,td,sc,mt,snapBtn,dc,b3d,bse].forEach(function(n){transport.appendChild(n)});
  tb.appendChild(nav);tb.appendChild(transport);
  return tb;
}

// 清空当前项目（危险操作）：输入「清空」二次确认，门槛不降；清空后仍可 ↶ 撤销。
// P4-B（#10 尾）：入口从原「📂 文件」菜单收编进项目中心危险区（本函数逻辑不变，全界面唯一入口）。
function openClearConfirm(){
  var bg=el('div','modal-bg');
  var m=el('div','modal clear-modal');
  m.appendChild(el('h3','','清空当前项目？'));
  m.appendChild(el('p','start-notice','将删除「'+(store.projectName||'我的编舞')+'」的全部舞者、歌词、段落标记与循环。清空后仍可用 ↶ 撤销恢复。'));
  var row=el('div','start-row');
  row.appendChild(el('span','','确认词'));
  var inp=document.createElement('input');inp.type='text';inp.placeholder='输入 清空';inp.autocomplete='off';
  row.appendChild(inp);m.appendChild(row);
  var act=el('div','modal-act');
  var bcancel=el('button','btn','取消');
  var bconfirm=el('button','btn danger','确认清空');bconfirm.disabled=true;
  inp.oninput=function(){bconfirm.disabled=(inp.value.trim()!=='清空')};
  bcancel.onclick=function(){bg.remove()};
  bconfirm.onclick=function(){bg.remove();store.dancers=[makeDancer(0)];store.globalLyrics=[];store.dancerCount=1;store.selectedClip=null;store.markers=[];store.loopA=store.loopB=null;saveHistory();updateTotalDuration();render();showToast('已清空（↶ 可撤销）')};
  act.appendChild(bcancel);act.appendChild(bconfirm);m.appendChild(act);
  bg.appendChild(m);document.body.appendChild(bg);
  setTimeout(function(){inp.focus()},0);
}

function renderSidebar(){
  var sb=el('div','sidebar');
  var section=el('div','region-heading');section.appendChild(el('strong','','动作库'));section.appendChild(el('span','','拖入轨道'));sb.appendChild(section);
  var s=el('div','search');
  var si=el('input','');si.type='text';si.placeholder='\u641C\u7D22...';si.value=store.search;
  si.oninput=function(e){store.search=e.target.value;var al=document.querySelector('.act-list');if(al){al.remove();sb.appendChild(renderActionList())}};
  s.appendChild(si);sb.appendChild(s);
  var tw=el('div','tabs-wrap library-filters');
  var skillTab=store.activeTab==='skill-all'||store.activeTab.indexOf('job-')===0;
  var categoryLabel=el('label','library-filter','类别');
  var category=el('select','');category.id='libraryCategory';category.setAttribute('aria-label','动作类别');
  var categories=[['emote-usual','通常动作'],['emote-special','特殊动作'],['emote-expression','表情'],['skill-all','技能'],['switch','套装切换'],['race','种族'],['all','全部']];
  categories.forEach(function(c){
    var count=c[0].indexOf('emote-')===0?store.emotes.filter(function(e){return e.category===c[0].slice(6)}).length:
      c[0]==='skill-all'?store.actions.length:c[0]==='switch'?switchItems.length:c[0]==='race'?store.races.filter(function(r){return r.id>0}).length:store.emotes.length+store.actions.length;
    var option=el('option','',c[1]+' · '+count);option.value=c[0];category.appendChild(option);
  });
  category.value=skillTab?'skill-all':store.activeTab;
  // P2：切到/离开技能页时，时间轴上方「接着添加」的文案与落点预告要跟着如实切换（技能锚=技能轨末尾）
  category.onchange=function(){store.activeTab=category.value;renderRegion('.sidebar',renderSidebar);if(window.refreshWorkbenchBars)refreshWorkbenchBars()};
  categoryLabel.appendChild(category);tw.appendChild(categoryLabel);
  if(skillTab){
    var jobLabel=el('label','library-filter','职业'),job=el('select','');job.id='libraryJob';job.setAttribute('aria-label','技能职业');
    var any=el('option','','不限职业');any.value='skill-all';job.appendChild(any);
    var jobs=getJobTabs();
    jobs.forEach(function(j){var option=el('option','',j.name+' · '+j.count);option.value='job-'+j.name;job.appendChild(option)});
    if(store.activeTab!=='skill-all'&&!jobs.some(function(j){return 'job-'+j.name===store.activeTab})){
      var missing=el('option','',store.activeTab.slice(4)+'（目录暂缺）');missing.value=store.activeTab;job.appendChild(missing);
    }
    job.value=store.activeTab;
    job.onchange=function(){store.activeTab=job.value;renderRegion('.sidebar',renderSidebar);if(window.refreshWorkbenchBars)refreshWorkbenchBars()};
    jobLabel.appendChild(job);tw.appendChild(jobLabel);
  }
  sb.appendChild(tw);
  sb.appendChild(renderActionList());
  return sb;
}

function renderActionList(){
  var summary={},items=getFilteredActions(summary);
  var list=el('div','act-list');
  if(store.activeTab==='skill-all'&&store.search&&summary.total>items.length){
    list.appendChild(el('p','action-search-summary','当前显示 '+items.length+' 项，共匹配 '+summary.total+' 项。请细化搜索词查看其余结果。'));
  }
  if((store.activeTab==='skill-all'||store.activeTab.indexOf('job-')===0)&&items.some(function(item){return !ChoreoAbilityRead.isSkill(item)})){
    list.appendChild(el('p','','旧离线目录缺少明确技能身份。请连接本机插件刷新目录后检查条件；不按名称、同编号表情或 /ac 文本猜测。'));
  }
  if(store.activeTab==='switch'){
    var manual=el('button','btn','手动填写套装编号（1–100）');
    manual.onclick=function(){openGearsetPicker(null,store.selectedDancer)};list.appendChild(manual);
    list.appendChild(el('p','',ChoreoGearset.PREVIEW_NOTICE));
  }
  // MULTI-DANCER：添加到全部舞者（会话级开关，不进项目文件）——勾选后点动作/拖入动作轨给每位在场舞者同一时刻插入
  var allRow=el('label','add-all-row');
  allRow.title='\u52FE\u9009\u540E\uFF1A\u70B9\u51FB\u4FA7\u680F\u52A8\u4F5C\u6216\u62D6\u5230\u52A8\u4F5C\u8F68\uFF0C\u4F1A\u7ED9\u6BCF\u4E00\u4F4D\u5728\u573A\u821E\u8005\u5728\u540C\u4E00\u65F6\u523B\u63D2\u5165\u8FD9\u6761\u52A8\u4F5C\uFF08\u5404\u81EA\u6309\u8F68\u9053\u89C4\u5219\u843D\u4F4D\uFF0C\u51B2\u7A81\u53EA\u987A\u5EF6\u81EA\u5DF1\uFF0C\u81EA\u52A8\u5207\u804C\u4E1A\u6309\u5404\u821E\u8005\u5F53\u524D\u804C\u4E1A\u5224\u65AD\uFF09\u3002\u4EC5\u672C\u6B21\u6253\u5F00\u6709\u6548\uFF0C\u4E0D\u968F\u9879\u76EE\u4FDD\u5B58';
  var allCb=document.createElement('input');allCb.type='checkbox';allCb.checked=!!store.addToAll;
  allCb.onchange=function(e){store.addToAll=!!e.target.checked;refreshWorkbenchBars();showToast(store.addToAll?'\u6DFB\u52A0\u5230\u5168\u90E8\u821E\u8005\uFF1A\u5F00\uFF08\u70B9\u52A8\u4F5C\u7ED9\u6BCF\u4F4D\u821E\u8005\u540C\u4E00\u65F6\u523B\u63D2\u5165\uFF09':'\u6DFB\u52A0\u5230\u5168\u90E8\u821E\u8005\uFF1A\u5173')};
  allRow.appendChild(allCb);
  allRow.appendChild(document.createTextNode('\u6DFB\u52A0\u5230\u5168\u90E8\u821E\u8005'));
  list.appendChild(allRow);
  if(!items.length){
    list.classList.add('act-empty');
    list.textContent=store.search?('没有找到含「'+store.search+'」的条目 - 换个关键词或清空搜索框'):'\u65E0\u7ED3\u679C - \u70B9\u51FB\u4E0A\u65B9\u6807\u7B7E\u5207\u6362\u5206\u7C7B';
    return list;
  }
  var cols=el('div','act-cols');
  if(store.activeTab==='skill-all'||store.activeTab.indexOf('job-')===0)cols.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
  items.forEach(function(item){
    var ai=el('div','act-item');ai.draggable=true;
    ai.title=item.name+(item.jobAbbr?' ('+item.jobAbbr+')':'');
    ai.setAttribute('data-cat',item.category||'');
    ai.ondragstart=function(e){if((store.activeTab==='skill-all'||store.activeTab.indexOf('job-')===0)&&!ChoreoAbilityRead.isSkill(item)){e.preventDefault();showToast('旧技能目录缺少明确身份，请连接刷新后再编排');return}e.dataTransfer.setData('text/plain',JSON.stringify({data:item,fromSidebar:true}));e.currentTarget.classList.add('dragging')};
    ai.ondragend=function(e){e.currentTarget.classList.remove('dragging')};
  ai.onclick=function(){
    if(ChoreoAbilityRead.isSkill(item)){
      // B1：点技能=默认落条（addToAll 开=逐位一次撤销）；点技能条再就地编辑。
      // P2：与动作同一锚点语义——「插在这里」消费所选时刻，否则=技能轨末尾＋等待值（不再用播放头）。
      var wbs=window.ChoreoWorkbench;
      var wbAt=wbs?wbs.consumeInsert():null;
      var wbWait=wbs?Math.max(0,Number(wbs.appendWait())||0):0;
      if(store.addToAll&&window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAddAll)ChoreoAbilityUI.quickAddAll(item,wbAt!=null?wbAt:(abilityLaneEndAll()+wbWait));
      else if(window.ChoreoAbilityUI&&ChoreoAbilityUI.quickAdd)ChoreoAbilityUI.quickAdd(item,store.selectedDancer,wbAt!=null?wbAt:(abilityLaneEnd(store.selectedDancer)+wbWait));
      else ChoreoAbilityUI.open(item,store.selectedDancer,store.currentTime);
      return}
    if(store.activeTab==='skill-all'||store.activeTab.indexOf('job-')===0){showToast('旧目录缺少真实技能身份，请连接刷新后再编排');return}
    var di=store.selectedDancer;
    var track=(item.category==='switch')?'switch':'action';
    // Find end of last clip in this track to append after
    var d=store.dancers[di];
    if(!d){addClip(di,track,item);return}
    var arr=d[track+'Clips'];
    var lastEnd=0;
    arr.forEach(function(c){var e=c.start+c.duration;if(e>lastEnd)lastEnd=e});
    // P1-A：动作轨优先消费「插在这里」的选定时刻；否则默认接着添加=lastEnd＋等待值（默认 0，行为与旧版一致）
    var wb=window.ChoreoWorkbench;
    var wbAt=(track==='action'&&wb)?wb.consumeInsert():null;
    var st=wbAt!=null?wbAt:(track==='action'&&wb?lastEnd+Math.max(0,wb.appendWait()):lastEnd);
    // MULTI-DANCER：开关开 + 动作 → 同一时刻插给每位在场舞者（切职业类条目保持单舞者口径）
    if(store.addToAll&&track==='action'){addClipToAllDancers(item,st);return}
    addClip(di,track,item,st);
  };
    ai.appendChild(el('div','ai-name',item.name));
    if(ChoreoAbilityRead.isSkill(item)){
      // P2 缺基础值前置：选择前就显示能否按默认落条，不把缺目录基础时间的条目伪装成可直接用
      var skillMd=window.ChoreoSkillMetadata?ChoreoSkillMetadata.read(item):null;
      var stateEl=el('div','ai-skill-state'+(skillMd?'':' missing'),skillMd?('可默认落条 · 目录咏唱 '+(skillMd.castMs/1000)+'s'):'缺基础时间：需连接插件同步目录，或选择本档案已有实测');
      stateEl.setAttribute('data-skill-state',skillMd?'ready':'missing');
      stateEl.title=skillMd?'目标=未指定对象时使用自身、表现提示=1秒；双击技能条可改':'当前目录没有完整基础时间，不能默认添加；连接插件同步目录，或在设置中选择本档案已有实测咏唱';
      ai.appendChild(stateEl);
      var readButton=el('button','btn small','检查技能条件（不释放）');
      readButton.style.cssText='white-space:normal;padding:3px;max-width:100%';
      readButton.draggable=false;
      readButton.onmousedown=function(e){e.stopPropagation()};
      readButton.onclick=function(e){e.stopPropagation();ChoreoAbilityRead.open({skill:item,read:apiFetch,
        // 装载/恢复项目会换入新数组；同ID切回也不得复用旧报告。
        project:function(){return store.dancers},connected:function(){return store.gameConnected}})};
      ai.appendChild(readButton);
    }
    if(item.isLoop){
      ai.appendChild(el('div','ai-loop','\u221E \u5FAA\u73AF'));
    } else if(item.duration){
      ai.appendChild(el('div','ai-loop',(Math.round(item.duration*10)/10)+'s'));
    } else {
      // 非循环动作：显示实测真实时长（预览/播放过才有），否则标注待测
      var md=store.measuredDur[item.command];
      ai.appendChild(el('div','ai-loop',md?((Math.round(md*10)/10)+'s'):'\u975E\u5FAA\u73AF\u00B7\u70B9\u9884\u89C8\u6D4B\u65F6\u957F'));
    }
    if(item.jobAbbr){
      ai.appendChild(el('div','ai-job',item.jobAbbr));
    }
    cols.appendChild(ai);
  });
  list.appendChild(cols);
  return list;
}
