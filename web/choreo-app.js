// 编舞助手主页控制器：负责 DOM 渲染与业务模块编排，保持 file:// 经典脚本兼容。
'use strict';
// 48794 基址与请求出口归 choreo-api.js（ARCH-2 配对客户端）；本文件只留 apiFetch/apiPreview 薄壳
var CHOREO_PROTOCOL=1; // v0.6.7 协议版本：与插件 /capabilities.protocolVersion 对比，不匹配提示升级
var LABEL_W=112; // 时间轴标签列宽(px)：须与 .lane-label 的 CSS 宽度一致（普通 112 / body.narrow 64），applyCompact 里随模式切换（AUD3-W2）

var dancerColors=['#7eb3ff','#e07bf5','#5dde8e','#fb923c','#5ad8d0','#f472b6','#f5d76e','#b08968'];
var store={
  connected:false,pps:60,snapEnabled:true,snapGrid:1.0,snapThreshold:0.3,currentTime:0,isPlaying:false,speed:1,totalDuration:300,measuredDur:{},
  // 阶段1（模式分流）：连接状态与工作模式拆开——connected 只代表 48794 在线（旧 UI 圆点还在用，保留为镜像）
  appReady:false,          // 网页程序就绪：编辑器能不能渲染只看它，跟游戏连不连无关
  gameConnected:false,     // 48794 游戏插件在线
  exportConnected:false,   // 48795 导出/3D 服务在线
  // v0.6.7（安全与能力握手）：capsOk=插件 ≥0.6.7（支持 /capabilities 与配对）；
  // 旧插件走兼容模式——写请求不带配对头（旧插件的预检靠业务响应带 CORS 头过关，多一个
  // 自定义头反而会让预检失败），所以配对头只在 capsOk 时才发
  capsOk:false,
  pluginCaps:null,
  pairToken:(function(){try{return localStorage.getItem('choreo_pairToken')||''}catch(e){return ''}})(),
  previewTarget:(function(){try{return localStorage.getItem('choreo_previewTarget')==='game'?'game':'web'}catch(e){return 'web'}})(),
  // ACTOR（2026-08-31）：游戏预览舞者（舞者下标，仅游戏模式消费；网页排练仍是多舞者口径）。
  // 游戏内只有一位本地角色，播放/拖动只演这一位，防止多家事件混在同一个角色上
  gameActor:(function(){try{var v=parseInt(localStorage.getItem('choreo_gameActor'),10);return v>=0?v:0}catch(e){return 0}})(),
  catalogFromSnapshot:false, // 阶段2：当前侧栏目录来自内置快照（游戏连上后会被线上目录覆盖）
  // 实时体检（瞬态，不进项目存储）：最近一次体检结果 + clipId→最严重级别（渲染描边用）
  checkIssues:[],checkLevel:{},
  // 目录数组必须先给空值：阶段1起 render() 先于插件目录加载执行，undefined 会让侧栏 .filter 崩掉
  emotes:[],races:[],actions:[],classJobs:[],
  gpose:false,
  engine:(function(){try{return localStorage.getItem('choreo_engine')||'classic'}catch(e){return 'classic'}})(),
  compact:(function(){try{var v=localStorage.getItem('choreo_compact');if(v!==null)return v===('1');return window.innerWidth<=980}catch(e){return window.innerWidth<=980}})(),
  jobMap:{},
  dancers:[],dancerCount:1,
  globalLyrics:[],showLyricMacro:false,
  // WP-3（项目中心）：当前项目身份。存储在 choreo-projects.js（IndexedDB choreo3dproj +
  // localStorage 镜像 choreo_autosave）；上面 dancers 等 5 个字段就是项目 content，格式没变
  projectId:null,projectName:'',projectCreatedAt:0,projectsDegraded:false,
  // WP-5-WIRE（2026-08-31）：持久化接线载体（转换逻辑在 choreo-docwire.js，node 单测覆盖）
  // contentExtra=投影顶层的未知键（保存时原样回文档 _extra，修掉固定字段清单丢键）；
  // _docRev=持久文档的 timelineRevision（装载播种、编辑递增，与游戏协议的 _tlRevision 分层）
  contentExtra:{},_docRev:1,
  selectedClip:null,selectedDancer:0,
  // WP-3b（编辑基础）：都是会话级状态，不进项目文件——loopA/B 是网页播放的循环区间；
  // markers 是段落标记的内存镜像（真身随项目 content 持久化）；_clipboard 是编辑剪贴板
  loopA:null,loopB:null,markers:[],_clipboard:null,
  activeTab:'emote-usual',search:'',
  addToAll:false, // MULTI-DANCER：添加到全部舞者（会话级开关，不进项目文件）
  propOpen:(function(){try{return localStorage.getItem('choreo_props_open')==='1'}catch(e){return false}})(), // P3：右侧属性面板开合（本机记忆；P3 起默认收起，常用编辑在时间轴下方上下文栏）
  history:[],historyIdx:-1,nextClipId:1,
  macroCollapsed:true,activeMacroTab:0,
  dancerHeights:{} // di -> lane height multiplier
};
// OVERHAUL 批 C 接线（原在配对薄壳块内）：会话令牌种子须在 store 诞生后立即执行——
// SESSION_KEY 由先加载的 choreo-app-auth.js 定义；行为与拆分前同位等价。
store.sessionToken=(function(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch(e){return ''}})();
store._sessionMintAt=0;

function fmtTime(t){var m=Math.floor(t/60),s=t%60;return String(m).padStart(2,'0')+':'+s.toFixed(1).padStart(4,'0')}
// P5（渲染性能）：统一渲染时钟——播放推进/播放头/时间显示/覆盖层/可见窗口共用一条 rAF 链，
// 每帧只在最后那次刷帧里写 DOM；值没变就一次都不写（旧实现每帧无条件写 4 处 + 全量重算覆盖层）。
var RK={playhead:'playhead',time:'time',overlay:'overlay',window:'window'};
var TL_OVERSCAN_VIEWPORTS=1; // 可见窗口左右各多渲一个视口宽：长项目的节点数只跟视口有关
var renderClock=null,_tlWinCache=null,_tlWinRange=null;
function clock(){
  if(!renderClock&&typeof window!=='undefined'&&window.ChoreoRenderPerf){
    renderClock=window.ChoreoRenderPerf.createClock({
      requestAnimationFrame:function(cb){return requestAnimationFrame(cb)},
      cancelAnimationFrame:function(id){return cancelAnimationFrame(id)},
      onFrame:function(){playLoop(playToken)},onFlush:renderFlush
    });
  }
  return renderClock;
}
function stopRenderClock(){var c=clock();if(c)c.stop()}
function updateTimeDisplay(){var c=clock();if(!c){writeTimeDisplay();return}c.mark(RK.time);if(store.previewTarget==='web')c.mark(RK.overlay);c.flush()}
function updatePlayhead(){var c=clock();if(!c){writePlayhead((LABEL_W+store.currentTime*store.pps)+'px');return}c.mark(RK.playhead);c.flush()}
function writePlayhead(v){var p=document.getElementById('playhead');if(p){p.style.left=v;p.style.display='block'}var bp=document.getElementById('bottomPlayhead');if(bp)bp.style.left=v}
function writeTimeDisplay(){var e=document.getElementById('timeDisplay');if(e)e.textContent=fmtTime(store.currentTime);var e2=document.getElementById('cursorPos');if(e2)e2.textContent='位置: '+store.currentTime.toFixed(1)+'s';if(store.previewTarget==='web')updatePlayOverlay();if(window.ChoreoWorkbench)ChoreoWorkbench.tickTop()}
// 一次脏检查刷帧：四个消费者各写一次，值相同则零写入；覆盖层与可见窗口只在这里重算
function renderFlush(){
  var c=clock();if(!c)return;
  if(c.dirty(RK.playhead))c.commit(RK.playhead,(LABEL_W+store.currentTime*store.pps)+'px',writePlayhead);
  if(c.dirty(RK.time))c.commit(RK.time,fmtTime(store.currentTime)+'|'+store.currentTime.toFixed(1),writeTimeDisplay);
  if(c.dirty(RK.overlay))updatePlayOverlay();
  if(c.dirty(RK.window))refreshTimelineWindow();
}
function snapTime(t,clip,di,tt,type,bypass){
  if(bypass)return t; // P4：拖动中按住 Alt 临时绕过吸附（工具栏 Snap 状态不动，抬手即恢复）
  if(!store.snapEnabled)return t;
  // MUSIC-EDITOR（会话内拍点吸附）：music-ui 在 window.ChoreoBeatTargets 发布会话选择与分段拍点；
  // beat 有有效拍点则只认拍点（严格 0.3s、等距取早、无目标不移动），off 直接关闭；time/action 走既有网格+边缘；
  // 无有效拍点的 beat 回退既有网格，保证编辑器可用。改速度/拍号 alone 永不搬移 clip（只读目标）。
  var bt=null;try{bt=(typeof window!=='undefined'&&window.ChoreoBeatTargets)||null;}catch(e){}
  if(bt&&bt.mode==='off')return t;
  if(bt&&bt.mode==='beat'&&bt.targets&&bt.targets.length){
    try{var TM=(typeof window!=='undefined'&&window.ChoreoMusicTiming)||globalThis.ChoreoMusicTiming||null;
      if(TM&&TM.snapBeatEdge){var r=TM.snapBeatEdge(t,bt.targets);if(r.snapped)return r.target;return t;}}catch(e){return t;}
  }
  var snap=store.snapThreshold;
  var candidates=[];
  // Grid snap (whole seconds)
  // HYGIENE(AC-5)：网格候选只搜到 300s（i<=300）——超过 300s 的时刻只剩其他条目边缘可吸附，
  // 这是既有行为（配合轨道默认 300s 总长），列为开放契约，行为修正需另行立项
  var grid=Math.max(0,Math.min(300,Math.floor(t*2)/2));
  candidates.push(grid);if(grid<300)candidates.push(grid+0.5);
  // Snap to other clips' start/end in same dancer
  if(di>=0&&store.dancers[di]){
    var d=store.dancers[di];
    ['switchClips','actionClips','lyricClips'].forEach(function(k){
      d[k].forEach(function(c){
        if(c.id===clip.id)return;
        candidates.push(c.start,c.start+c.duration);
      });
    });
  }
  // Also snap to global lyrics
  store.globalLyrics.forEach(function(c){if(c.id!==clip.id)candidates.push(c.start,c.start+c.duration)});
  // Find closest candidate
  var best=t,bestDist=snap;
  candidates.forEach(function(c){var d=Math.abs(c-t);if(d<bestDist){bestDist=d;best=c}});
  return best;
}
function fmtDur(t){if(t<60)return Math.round(t)+'s';return Math.floor(t/60)+'m'+Math.floor(t%60)+'s'}
// AUD-002：el() 只收纯文本（textContent）——动作名/台词/歌词/标记名等项目内容一律按文本节点渲染；
// 需要拼结构化 HTML 的地方必须用 DOM API 组装（appendChild + el 子节点），禁止把用户可控字符串拼进 innerHTML
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove('show')},2000)}
function showTip(x,y,text){var t=document.getElementById('tooltip');t.textContent=text;t.style.left=x+'px';t.style.top=y+'px';t.classList.add('show')}
function hideTip(){document.getElementById('tooltip').classList.remove('show')}
function setLoadingText(t){document.getElementById('loadTx').textContent=t}

function saveHistory(){
  // WP-3b：快照扩到 markers（段落标记的增删改也要能撤销）；dancers 快照天然带上 solo/mute
  // AUD-005：showLyricMacro 也是可撤销编辑（onchange 会进历史），一并入快照；
  // totalDuration 是派生值不入快照，恢复时统一重算
  var s=JSON.parse(JSON.stringify({dancers:store.dancers,globalLyrics:store.globalLyrics,markers:store.markers,showLyricMacro:store.showLyricMacro}));
  if(window.ChoreoAbilityPlan)s.abilityTracks=ChoreoAbilityPlan.snapshot(store);
  if(window.ChoreoStageMotion)s.stageTracks=ChoreoStageMotion.snapshot(store);
  store.history=store.history.slice(0,store.historyIdx+1);
  store.history.push(s);store.historyIdx++;
  if(store.history.length>50){store.history.shift();store.historyIdx--}
  persistProject(); // WP-3：不再直接写 choreo_draft，改走项目存储层（镜像同步 + IndexedDB）
  bumpTimelineRev(); // FIX-B：内容变了，游戏时间轴快照要跟着重推
}
// === WP-3（项目中心）：项目持久化与当前项目记录 ===
// WP-5-WIRE：content 存的就是规范演出文档——6 已知字段 + contentExtra 未知键一起经文档模块
// 迁移（未知键收进 _extra，修掉固定字段清单丢键）；timelineRevision 写携带的 _docRev
function projectRecord(){
  var proj={dancers:store.dancers,globalLyrics:store.globalLyrics,dancerCount:store.dancerCount,showLyricMacro:store.showLyricMacro,totalDuration:store.totalDuration,markers:store.markers};
  var extra=store.contentExtra;
  if(extra)Object.keys(extra).forEach(function(k){proj[k]=extra[k]});
  return {id:store.projectId,name:store.projectName,createdAt:store.projectCreatedAt||Date.now(),updatedAt:Date.now(),
    schemaVersion:(window.ChoreoProjects&&ChoreoProjects.pure.SCHEMA_VERSION)||2,
    content:ChoreoDocWire.persistDoc(proj,{id:store.projectId,name:store.projectName},store._docRev)};
}
var _lastSnapAt=0,_lastSnapJson='';
function persistProject(){
  if(!window.ChoreoProjects||!store.projectId)return;
  var rec=projectRecord();
  ChoreoProjects.saveActive(rec); // 镜像同步落盘（崩溃保险）+ IndexedDB
  try{ // 每 5 分钟（有改动时）自动存一个历史版本快照
    var j=JSON.stringify(rec.content);
    if(Date.now()-_lastSnapAt>5*60*1000&&j!==_lastSnapJson){
      _lastSnapAt=Date.now();_lastSnapJson=j;
      ChoreoProjects.addVersion(rec.id,'自动保存',rec.content,true);
    }
  }catch(e){}
}
function undo(){
  if(store.historyIdx<=0)return;
  store.historyIdx--;
  var s=JSON.parse(JSON.stringify(store.history[store.historyIdx]));
  store.dancers=s.dancers||[];store.globalLyrics=s.globalLyrics||[];store.markers=s.markers||[];
  store.showLyricMacro=!!s.showLyricMacro; // AUD-005：歌词宏显示跟快照走
  if(window.ChoreoAbilityPlan)ChoreoAbilityPlan.restore(store,s.abilityTracks);
  if(window.ChoreoStageMotion)ChoreoStageMotion.restore(store,s.stageTracks);
  store.dancerCount=store.dancers.length;
  store.selectedClip=null;
  updateTotalDuration(); // AUD-005：派生值恢复后重算，不残留旧时长
  render();
  persistProject(); // AUD-005：撤销结果立即落盘（不调 saveHistory，避免破坏撤销栈）——撤销后直接关页面重开也是撤销后的状态
  bumpTimelineRev(); // FIX-B：撤销也是内容变化
}
function redo(){ // WP-3：重做。撤销栈本来就是“截断重写”式（saveHistory 里 slice），历史点之后还有记录就能重做
  if(store.historyIdx>=store.history.length-1)return;
  store.historyIdx++;
  var s=JSON.parse(JSON.stringify(store.history[store.historyIdx]));
  store.dancers=s.dancers||[];store.globalLyrics=s.globalLyrics||[];store.markers=s.markers||[];
  store.showLyricMacro=!!s.showLyricMacro;
  if(window.ChoreoAbilityPlan)ChoreoAbilityPlan.restore(store,s.abilityTracks);
  if(window.ChoreoStageMotion)ChoreoStageMotion.restore(store,s.stageTracks);
  store.dancerCount=store.dancers.length;
  store.selectedClip=null;
  updateTotalDuration();
  render();
  persistProject(); // AUD-005：同 undo
  bumpTimelineRev(); // FIX-B：重做也是内容变化
}

// Emote categorization
var exprNames={'blink':1,'wink':1,'kiss':1,'fume':1,'pout':1,'tongue':1,'facepalm':1,'sigh':1,'snicker':1,'blush':1,'smug':1,'sneer':1,'provoke':1,'bored':1,'sleepy':1};
var specNames={'dance':1,'sit':1,'pose':1,'stretch':1,'cross':1,'beckon':1};
function categorizeEmote(name,gc){
  var l=name?name.toLowerCase():'';
  if(gc){
    var gl=gc.toLowerCase();
    if(gl.indexOf('usual')>=0||gc.indexOf('\u901A\u5E38')>=0)return'usual';
    if(gl.indexOf('special')>=0||gc.indexOf('\u7279\u6B8A')>=0||gc.indexOf('\u7279\u522B')>=0)return'special';
    if(gl.indexOf('expression')>=0||gc.indexOf('\u8868\u60C5')>=0||gl.indexOf('expr')>=0)return'expression';
  }
  if(exprNames[l]||exprNames[name])return'expression';
  if(specNames[l]||specNames[name])return'special';
  return'usual';
}

// LRC parser
function parseLRC(text){
  var lines=[];
  text.split('\n').forEach(function(line){
    var re=/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g,m,times=[];
    while(m=re.exec(line)){times.push(m[1]*60+ +m[2]+(m[3]?+m[3].padEnd(3,'0'):0)/1000)}
    var txt=line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g,'').trim();
    times.forEach(function(t){if(txt)lines.push({time:t,text:txt})})
  });
  lines.sort(function(a,b){return a.time-b.time});
  // 双语歌词合并：同刻（<0.05s）的后续行视为翻译，并为一行 "原文 / 译文"
  // （网易云导出的双语 LRC / 手动拼接的原文+翻译都是同时间戳成对出现）
  var merged=[];
  lines.forEach(function(l){
    var prev=merged[merged.length-1];
    if(prev&&Math.abs(l.time-prev.time)<0.05){
      if(prev.text.indexOf(l.text)<0)prev.text=prev.text+' / '+l.text;
    }else merged.push({time:l.time,text:l.text});
  });
  return merged
}
// 旧骨骼录制进度轮询 startRecPoll 已删：唯一数据源 /bonerec/status 随 BoneAnimator 死臂
// 删除（恒回 {}），且本函数无任何调用方。底栏 recPos 显示位保留——录制中心
// （choreo-recording-ui.js recPosText）用它展示每条/整场录制结果
// OVERHAUL 批 C：配对/会话凭据薄壳已拆至 choreo-app-auth.js（同全局名文件级搬家，行为逐字不变）

var switchItems=[];
for(var i=1;i<=15;i++)switchItems.push(ChoreoGearset.makeSwitch(i,null).data);

// Job role colors
var roleColors={0:'#22d3ee',1:'#4d7eff',2:'#ff5757',3:'#e07bf5',4:'#5dde8e'};
var SWITCH_CAT='switch';

// ===== 分屏紧凑模式（收起侧栏为浮窗 + 全面紧凑化）=====
var _compactTouched=false,_sideOpen=false;
function applyCompact(){document.body.classList.toggle('narrow',!!store.compact);LABEL_W=store.compact?64:112;if(!store.compact)closeSidebar()}
function openSidebar(){var sb=document.querySelector('.sidebar');if(sb)sb.classList.add('open');var bd=document.getElementById('sbBackdrop');if(bd)bd.classList.add('show');_sideOpen=true}
function closeSidebar(){_sideOpen=false;var sb=document.querySelector('.sidebar');if(sb)sb.classList.remove('open');var bd=document.getElementById('sbBackdrop');if(bd)bd.classList.remove('show')}
function toggleSidebar(){if(document.body.classList.contains('narrow')){_sideOpen?closeSidebar():openSidebar()}else{document.body.classList.toggle('wide-nosb')}}
function _applySideOpen(){if(_sideOpen&&store.compact){var sb=document.querySelector('.sidebar');if(sb&&!sb.classList.contains('open'))sb.classList.add('open');var bd=document.getElementById('sbBackdrop');if(bd)bd.classList.add('show')}}
window.addEventListener('resize',function(){if(_compactTouched)return;var nc=window.innerWidth<=980;if(nc!==!!store.compact){store.compact=nc;applyCompact();if(store.appReady)render()}});

// 工具栏断点独立于用户手动选择的紧凑模式，仅跨断点时刷新导航。
var _toolbarNarrow=window.innerWidth<=1000;
window.addEventListener('resize',function(){var narrow=window.innerWidth<=1000;if(narrow===_toolbarNarrow)return;_toolbarNarrow=narrow;if(store.appReady)renderRegion('.toolbar',renderToolbar)});

// seek 合并+串行:同一时刻只有一个请求在途,拖动中新位置覆盖旧位置(拖动器自身有50ms节流,
// 见下方 onMove 的 now-lastSent>50 门槛——旧注释写 150ms 与实现不符,HYGIENE(AC-5) 纠正)
// 阶段1（模式分流）：网页 3D 模式下拖动只走本地（preview3d 自己读 store.currentTime），不向游戏发 seek/freeze
// FIX-B（AUD2-003）：seek 带 revision（时间轴修订号）；插件版本不符回 409，网页重推快照后重试一次
// WEB-RACE：每次 seek 带递增序号，重试资格只属于最新意图——排队里的新时间优先于旧时间的 409 重试
var _seekBusy=false,_seekPending=null,_seekSeq=0,_controlStopEpoch=0;
function sendSeek(t,noRetry){
  if(store.previewTarget!=='game')return;
  var seq=++_seekSeq,stopEpoch=_controlStopEpoch;
  if(_seekBusy){_seekPending={t:t,seq:seq};return}
  _seekBusy=true;
  var payload={time:Math.round(t*100)/100,revision:store._tlRevision};
  apiFetch('/playback/seek',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  .then(function(){
    if(stopEpoch!==_controlStopEpoch)return;
    _seekBusy=false;
    if(_seekPending){var p=_seekPending;_seekPending=null;sendSeek(p.t)}
  },function(e){
    if(stopEpoch!==_controlStopEpoch)return;
    _seekBusy=false;
    if(e&&e.status===409&&!noRetry){
      // 插件持有旧时间轴 → 重推快照后重试一次（只重试一次防循环）。
      // 排队里有更新的 seek 就让它接管重推后的落位（它自己带 409 重试资格），旧时间不得压过它
      pushGameTimeline(true).then(function(){
        if(stopEpoch!==_controlStopEpoch)return;
        if(_seekPending){var p=_seekPending;_seekPending=null;sendSeek(p.t)}
        else if(seq===_seekSeq){sendSeek(t,true)}
      });
      return;
    }
    if(_seekPending){var p=_seekPending;_seekPending=null;sendSeek(p.t)}
  });
}

// === FIX-B（AUD2-003）：时间轴修订号 + 快照同步 ===
// 每次内容变化（编辑/撤销/重做/换项目/导入）递增 revision；游戏模式下防抖 300ms 把
// buildGameClips 规范快照推给插件 /playback/timeline 原子替换。这样「切到游戏模式后
// 未按播放就拖动」「编辑后未重新播放就拖动」都作用在当前时间轴上，不再拿空/旧时间轴。
store._tlRevision=1;
var _tlPushTimer=null;
function bumpTimelineRev(){
  store._tlRev=(store._tlRev||0)+1;
  if(window.ChoreoStageGameUI)ChoreoStageGameUI.invalidateChanged();
  if(window.ChoreoShowEntry)ChoreoShowEntry.invalidate(); // 统一入口：编排变化即作废旧检查结论
  store._tlRevision++;
  store._docRev=(store._docRev||0)+1; // WP-5-WIRE：持久文档的 timelineRevision 跟内容变化一起走
  if(store.previewTarget==='game'&&store.gameConnected&&!store.isPlaying){
    if(_tlPushTimer)clearTimeout(_tlPushTimer);
    _tlPushTimer=setTimeout(pushGameTimeline,300);
  }
}
function pushGameTimeline(force){
  if(_tlPushTimer){clearTimeout(_tlPushTimer);_tlPushTimer=null}
  if(store.previewTarget!=='game'||!store.gameConnected)return Promise.resolve(false);
  if(store.isPlaying&&!force)return Promise.resolve(false); // 播放中插件时间轴由 start 负责
  var rev=store._tlRevision;
  var clips;try{clips=buildGamePayloadClips()}catch(e){showToast(e.message);return Promise.resolve(false)}
  return apiFetch('/playback/timeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clips:clips,revision:rev})})
    .then(function(d){return !!(d&&d.status==='ok')})
    .catch(function(){return false});
}

// === ACTOR（2026-08-31）：游戏预览舞者 ===
// 当前产品游戏内只有一个本地角色：游戏模式的播放/拖动只演这一位，绝不把多个舞者的事件
// 混到同一角色上（插件侧 PreviewActorPolicy 也会拒绝混演员 payload）。网页排练
// （3D 预览/独奏/静音/A-B 循环）保持多舞者口径不变；显式选中的预览舞者不受静音影响。
function gameActorIdx(){
  if(!store.dancers.length)return -1;
  return (store.gameActor>=0&&store.gameActor<store.dancers.length)?store.gameActor:0;
}
function setGameActor(di){
  if(store.gameActor===di)return;
  store.gameActor=di;
  try{localStorage.setItem('choreo_gameActor',String(di))}catch(e){}
  render();
  if(store.previewTarget==='game'&&store.gameConnected&&!store.isPlaying){
    // 立即换人：新舞者时间轴推给插件，并按当前播放头重新定格（游戏里马上看到换了谁）
    pushGameTimeline(true).then(function(ok){if(ok)sendSeek(store.currentTime)});
  }
}
function buildGamePayloadClips(forExplicitStart){
  var clips=ChoreoEdit.pure.buildGameClips(store.dancers,store.globalLyrics,null,gameActorIdx());
  if(!forExplicitStart&&clips.some(function(c){return c.type==='switch'||/^\s*\/(?:gs|gearset|job)(?:\s|$)/i.test(c.command)}))throw new Error(ChoreoGearset.PREVIEW_NOTICE);
  return clips;
}

// v0.5.21: 修复存量数据的英文 clip 名 —— 旧版宏解析回填时直接拿命令去斜杠当名字（/bow->"bow"），
// 已保存进草稿。按命令回查表情表恢复中文名；解析默认的 expression 分类也一并还原真实分类。
function repairClipNames(){
  if(!store.emotes||!store.emotes.length)return;
  var byCmd={};
  store.emotes.forEach(function(e2){var c=(e2.command||'').toLowerCase();if(c&&c.indexOf(' ')<0&&!byCmd[c])byCmd[c]={name:e2.name,category:e2.category}});
  store.dancers.forEach(function(d){
    (d.actionClips||[]).forEach(function(c){
      // 剥掉变体后缀再查（"/bow motion" -> 查 "/bow"），命令本身保持不变
      var key=(c.data.command||'').toLowerCase().replace(/\s+(motion|loop|special)\s*$/,'');
      var m=byCmd[key];
      if(m){c.data.name=m.name;if(c.data.category==='expression')c.data.category=m.category}
    });
  });
}
// === WP-3（项目中心）：从项目存储层恢复，替代旧的 restoreDraft（直读 choreo_draft） ===
function recalcNextClipId(){
  var maxId=0;
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){(d[k]||[]).forEach(function(c){if(c.id>maxId)maxId=c.id})})});
  store.globalLyrics.forEach(function(c){if(c.id>maxId)maxId=c.id});
  store.nextClipId=maxId+1;
}
function clearClipSelection(){ // 清掉所有选中标记（切换项目/导入工程后旧引用必须作废）
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){(d[k]||[]).forEach(function(c){c.selected=false})})});
  store.globalLyrics.forEach(function(c){c.selected=false});
  store.selectedClip=null;
}

// OVERHAUL 批 C：WP-3b 编辑事务层（B3/B5/B7a/BSPATIAL/B7b）已拆至 choreo-app-edit-tx.js（同全局名文件级搬家，行为逐字不变）

function setLoopPoint(which){ // 传输区 A/B 按钮：在播放头设循环区间（仅网页播放；游戏模式按钮禁用）
  if(store.previewTarget==='game'){showToast('A-B 循环只支持网页播放——游戏插件没有循环端点');return}
  store[which]=store.currentTime;
  if(store.loopA!=null&&store.loopB!=null&&store.loopB<store.loopA){var t=store.loopA;store.loopA=store.loopB;store.loopB=t}
  if(window.ChoreoWorkbench)ChoreoWorkbench.exitRehearsal(); // 手工设 A/B 即退出定位排练标记，避免停止时误清
  render();
  showToast(which==='loopA'?('A='+store.loopA.toFixed(1)+'s'+(store.loopB!=null?' · B='+store.loopB.toFixed(1)+'s':'（再按 B 设终点）')):('B='+store.loopB.toFixed(1)+'s · A='+store.loopA.toFixed(1)+'s'));
}
function clearLoop(){store.loopA=store.loopB=null;if(window.ChoreoWorkbench)ChoreoWorkbench.exitRehearsal();render();showToast('已清除 A-B 循环')}
// 显式定位交给正在使用的网页时钟，防止下一帧把播放头拉回原位置。
function seekTimelinePosition(t){
  if(!isFinite(t)||t<0)return;
  if(store.previewTarget!=='game'){
    if(window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('请先停止本机演出，再定位时间轴');return}
    if(window.ChoreoMusicUI&&window.ChoreoMusicUI.seekFromTimeline(t))return;
    if(store.isPlaying){playOffset=t;playStart=performance.now()}
  }
  store.currentTime=t;updatePlayhead();updateTimeDisplay();sendSeek(t);
}
function addMarkerAtPlayhead(){ // 传输区 ⚑ 按钮：在播放头加段落标记（随项目保存、可撤销）
  var mk=ChoreoEdit.pure.addMarker(store.markers,store.currentTime,'段落'+(store.markers.length+1),ChoreoEdit.pure.newMarkerId());
  saveHistory();render();
  showToast('已加标记「'+mk.name+'」@'+mk.t.toFixed(1)+'s（标尺上点击跳转、右键改名/删除）');
}
function showMarkerMenu(x,y,mk){ // 标尺旗标右键菜单（复用 #ctxMenu 容器）
  var m=document.getElementById('ctxMenu');m.innerHTML='';
  [['✎ 改名',function(){var v=prompt('标记名称：',mk.name||'');if(v===null)return;mk.name=v.trim()||mk.name;ChoreoEdit.pure.sortMarkers(store.markers);saveHistory();render()}],
   ['⏱ 改时间',function(){var v=prompt('标记时间（秒）：',String(mk.t));if(v===null)return;var t2=parseFloat(v);if(!(t2>=0)){showToast('时间无效');return}ChoreoEdit.pure.updateMarker(store.markers,mk.id,{t:t2});saveHistory();render()}],
   ['🗑 删除本标记',function(){ChoreoEdit.pure.removeMarker(store.markers,mk.id);saveHistory();render();showToast('已删除标记')}],
   ['🗑 删除全部标记',function(){if(!confirm('删除全部段落标记？'))return;store.markers=[];saveHistory();render()},true]
  ].forEach(function(pair){
    var mi=el('div','ctx-it'+(pair[2]?' danger':''),pair[0]);
    mi.onclick=function(){pair[1]();m.classList.remove('show')};
    m.appendChild(mi);
  });
  m.style.left=x+'px';m.style.top=y+'px';m.classList.add('show');
}
function applyProjectContent(ct){
  // WP-5-WIRE：装载一律过文档模块——规范文档/WP-3 旧内容自动识别迁移，投影回 store；
  // 未知顶层键收进 store.contentExtra，保存时原样回文档 _extra（不再被固定字段清单丢弃）
  var w=ChoreoDocWire.loadProjection(ct);
  var proj=w.proj;
  if(window.ChoreoProjects&&ChoreoProjects.pure&&ChoreoProjects.pure.normalizeContent)ChoreoProjects.pure.normalizeContent(proj);
  if(w.warning)showToast('项目数据格式异常，已按空项目打开：'+w.warning);
  store.dancers=proj.dancers||[];
  store.globalLyrics=proj.globalLyrics||[];
  store.totalDuration=Math.max(300,proj.totalDuration||300); // 手动加长的轨道长度跨会话保留
  store.dancerCount=proj.dancerCount||Math.max(1,store.dancers.length);
  store.showLyricMacro=!!proj.showLyricMacro;
  store.markers=proj.markers||[];
  store.contentExtra=ChoreoDocWire.unknownTopKeys(proj);
  if(window.ChoreoMusicUI)ChoreoMusicUI.projectLoaded();
  if(window.__p3dBindingsChanged)window.__p3dBindingsChanged(); // 装载/同项目恢复/导入立即作废旧预览。
  recalcNextClipId();
  // P1-A：换项目/恢复后重算“空态→工作台”的进入状态，并让可见范围贴合新内容（手动缩放过则不覆盖）
  var _empty=(typeof projectIsEmpty==='function')?projectIsEmpty():false;
  store._ppsTouched=false;
  store._fitPending=!_empty;
  if(window.ChoreoWorkbench)ChoreoWorkbench.noteLoaded(!_empty);
  bumpTimelineRev(); // FIX-B：换项目/导入/恢复后内容整体变了，游戏时间轴快照作废重推
  store._docRev=w.rev; // WP-5-WIRE：装载本身不推进持久修订号——种子在 bump 之后重写，下一条编辑才 +1
}
async function loadActiveProject(){
  var res={degraded:false,migrated:false,name:''};
  try{res=await ChoreoProjects.init()}
  catch(e){res={degraded:true,migrated:false,name:''}}
  store.projectsDegraded=!!res.degraded;
  var rec=null,recovered=false;
  try{
    var opened=await ChoreoProjects.openProject(ChoreoProjects.getActiveId());
    if(opened&&opened.record){rec=opened.record;recovered=!!opened.recovered}
  }catch(e){}
  if(!rec)rec=ChoreoProjects.pure.defaultRecord();
  try{var loaded=ChoreoDocWire.loadProjection(rec.content||{});if(loaded.warning)throw new Error(loaded.warning)}
  catch(e){
    // 损坏音乐不半装载，也不让启动后的自动保存覆盖原记录。
    store.projectId=null;store.projectName='项目恢复被拒绝（原数据保留）';
    setTimeout(function(){showToast('项目恢复被拒绝：'+e.message+'。原记录保留，请在项目中心打开其他项目或新建项目。')},500);
    return;
  }
  store.projectId=rec.id;store.projectName=rec.name||'我的编舞';store.projectCreatedAt=rec.createdAt||Date.now();
  applyProjectContent(rec.content||{});
  try{_lastSnapAt=Date.now();_lastSnapJson=JSON.stringify(projectRecord().content)}catch(e){} // 打开时定基线（WP-5-WIRE：按迁移后的文档形态定，旧记录首轮不误存迁移版本）
  if(res.migrated)setTimeout(function(){showToast('已把旧草稿迁移成项目「'+(res.name||'我的编舞')+'」，原草稿已自动备份')},1500);
  if(recovered)setTimeout(function(){showToast('上次好像没正常关闭——已经恢复到最近的编辑')},4500);
}
async function init(){
  await loadActiveProject(); // WP-3：迁移旧草稿 + 打开上次项目（内部自带降级，绝不阻断编辑器）
  var bd=document.createElement("div");bd.id="sbBackdrop";bd.className="sb-backdrop";bd.onclick=closeSidebar;document.body.appendChild(bd);applyCompact();
  // 阶段1（模式分流）：编辑器不再等插件——草稿恢复完直接进网页模式工作区；
  // 插件连接与动作目录改为后台并行加载，游戏没开也能编辑、拖动、网页播放
  if(!store.dancers.length)store.dancers=[makeDancer(0)];
  saveHistory();
  store.appReady=true;
  document.getElementById('loading').classList.add('hidden');
  render();
  // CHARACTER-ASSETS-P3：绑定下拉要列已知档案——启动拉一次；包一层 __p3dProfilesChanged
  // 让主页清单跟着资料库窗口的增删刷新。先调原函数再刷新自己：3D 面板的对号/重建决策
  // 不被主页这边的重渲染挤占（initrace 场景的竞争窗口口径保持不变）
  (function(){
    var orig=window.__p3dProfilesChanged;
    window.__p3dProfilesChanged=function(){if(orig)orig();refreshKnownProfiles();};
  })();
  refreshKnownProfiles();
  probeExport();
  startConnWatch(); // 阶段2：断连时静默轮询，游戏中途启动后自动刷新状态/升级目录
  // 阶段4：上次录制没录完的话提醒一声（会话明细在 localStorage，打开录制窗口能续录）
  try{
    var _rs=JSON.parse(localStorage.getItem('choreo_recSession')||'null');
    if(_rs&&_rs.items&&!_rs.finished&&_rs.items.some(function(it){return it.status==='pending'}))
      showToast('上次录制没录完——点顶栏「🧰 工具」→「录制」可以继续');
  }catch(e){}
  await probeGame(false);
}

// —— 连接探测/目录快照/资料库自动同步/实测时长已拆至
//    choreo-app-catalog.js（OVERHAUL 批 C 第七步；在本件之前加载，同全局名调用时解析）。——

// —— 舞者管理/目录过滤/冲突/补隙/增删复制条已拆至
//    choreo-app-dancers.js（OVERHAUL 批 C 第七步；在本件之前加载，同全局名调用时解析）。——

function updateTotalDuration(){
  // 固定轨道长度制（基础 5 分钟）：拖动被钳制在轨道末端，超出需点"+1分钟"手动加长；
  // 导入/粘贴等内容超出时仍自动生长（否则歌词会落在轨道外不可见）。只增不减，保留手动加长。
  var max=300;
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){d[k].forEach(function(c){var e=c.start+c.duration;if(e>max)max=e})})});
  store.globalLyrics.forEach(function(c){var e=c.start+c.duration;if(e>max)max=e});
  if(window.ChoreoAbilityPlan)max=Math.max(max,ChoreoAbilityPlan.end(store));
  if(window.ChoreoStageMotion)max=Math.max(max,ChoreoStageMotion.end(store));
  var need=Math.ceil(max);
  if(need>store.totalDuration)store.totalDuration=need;
}

// Import lyrics to global track
function importLyrics(lrc){
  var ly=parseLRC(lrc);
  if(!ly.length){showToast('未找到有效歌词');return}
  store.globalLyrics=[];
  for(var i=0;i<ly.length;i++){
    var st=ly[i].time,end=i+1<ly.length?ly[i+1].time:st+5;
    store.globalLyrics.push({id:store.nextClipId++,start:st,duration:Math.max(0.5,end-st),data:{name:ly[i].text,command:'',category:'lyric',isLyric:true}});
  }
  saveHistory();updateTotalDuration();render();
  showToast('已导入 '+ly.length+' 行歌词到全局歌词轨');
}

// Macro generation
function generateMacro(di){
  var d=store.dancers[di];if(!d)return[];
  // 事件组装走 ChoreoEdit.pure.macroEvents（FIX-4/AUD-013：与体检宏检查共用同一份口径，
  // 含开歌词宏时的全局歌词和同刻去重规则；顺序 switch→action→歌词 与原实现逐字一致）
  var all=ChoreoEdit.pure.macroEvents(d,store.globalLyrics,store.showLyricMacro);
  all.sort(function(a,b){return a.clip.start-b.clip.start});
  function fmtWait(d){d=Math.round(d*2)/2;var s=d.toFixed(1);if(s.indexOf('.0')===s.length-2)s=s.substring(0,s.length-2);return '<wait.'+s+'>'}
  // Group clips by same start time (within 0.1s)
  var groups=[];
  all.forEach(function(item){
    if(groups.length===0||item.clip.start-groups[groups.length-1].start>0.1){
      groups.push({start:item.clip.start,items:[item]})
    }else{groups[groups.length-1].items.push(item)}
  });
  var macroLines=[];
  var currentJob='';
  groups.forEach(function(g,gi){
    // Calculate wait for this group = time until next group starts
    // If this is the last group, wait = max clip duration in group
    var nextStart=gi<groups.length-1?groups[gi+1].start:null;
    g.items.forEach(function(item,ii){
      var c=item.clip;
      var cmd=c.data.command||'';
      var isLastInGroup=ii===g.items.length-1;
      var waitStr='';
      if(isLastInGroup){
        if(nextStart!==null){
          // Wait = gap to next group
          var wait=nextStart-g.start;
          if(wait>=0.5)waitStr=' '+fmtWait(wait);
        }else{
          // Last group: use own duration as wait
          if(c.duration>=0.5)waitStr=' '+fmtWait(c.duration);
        }
      }
      if(item.type==='switch'){
        if(c.data.jobName)currentJob=c.data.jobName;
        macroLines.push(cmd+waitStr);
      }else if(item.type==='lyric'){
        // 文字宏：歌词/文字 clip 无命令时输出 "/say 文字"（此前输出空行 = 文字宏整个丢失）
        if(!cmd&&c.data.name)cmd='/say '+c.data.name;
        if(cmd)macroLines.push(cmd+waitStr);
      }else{
        var noWaitCmds=['\u623F\u5C4B','house','\u4F0F\u5C4B'];
        var needsWait=true;
        noWaitCmds.forEach(function(nc){if(cmd.indexOf(nc)>=0)needsWait=false});
        macroLines.push(cmd+(needsWait?waitStr:''));
      }
    });
  });
  var resultLines=['/echo \u7F16\u821E: '+d.name];
  var maxLines=14; // 游戏单宏槽 15 行：每 14 行动作分页 + /nextmacro 连续执行，留 1 行余量
  for(var i=0;i<macroLines.length;i++){
    resultLines.push(macroLines[i]);
    if((i+1)%maxLines===0&&i<macroLines.length-1){resultLines.push('/nextmacro')}
  }
  return resultLines;
}

// —— 播放控制/GAMECLOCK/模式切换已拆至 choreo-app-playback.js（OVERHAUL 批 C 第五步；须在本件之后加载：
//    updatePlayhead 双声明以后加载者为生效版）。——

function exportProject(){
  // WP-5-WIRE：导出文件就是规范演出文档（schemaVersion 2，稳定 ID/整数毫秒/未知键在 _extra）；
  // 旧 v5.0 导出文件的导入能力不受影响——导入端自动识别新旧两种形态
  var doc=projectRecord().content;
  var b=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'});
  var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download='choreo_'+Date.now()+'.json';a.click();URL.revokeObjectURL(u);showToast('已导出项目编排与引用（不含历史版本、人物、动作及歌曲文件）。资源请另行备份；导入后在本地资料库/舞者绑定及音乐面板重新关联缺失资源。');
}
// 导出所有舞者的宏文本为 .txt（含分页，可直接复制进游戏）
function exportMacroTxt(){
  var out=[];
  store.dancers.forEach(function(d,di){
    var lines=generateMacro(di);
    out.push('===== '+d.name+' =====');
    // 与界面一致：按页分块，页间空行分隔（/nextmacro 保留在页内）
    var page=[];
    lines.forEach(function(l){
      if(l==='/nextmacro'){page.push(l);out.push(page.join('\n'));page=[];out.push('')}
      else page.push(l)
    });
    if(page.length)out.push(page.join('\n'));
    out.push('');
  });
  if(store.globalLyrics.length){out.push('===== \u5168\u5C40\u6B4C\u8BCD =====');out.push(store.globalLyrics.map(function(c){return (c.start).toFixed(1)+'s  '+(c.data.name||'')}).join('\n'))}
  var b=new Blob([out.join('\n')],{type:'text/plain;charset=utf-8'});
  var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download='choreo_macro_'+Date.now()+'.txt';a.click();URL.revokeObjectURL(u);showToast(store.dancers.some(function(d){return d.switchClips.length})?'宏已导出 .txt。套装编号未核实；旧 /job 请手工改为 /gs change 编号。':'宏已导出 .txt');
}
// AUD-002：导入层第二道防线——结构/类型/数量/长度/数值范围校验（渲染层按文本渲染仍是根本防线）
function sanitizeImportProject(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('文件不是有效的编舞工程 JSON');
  var dancers=data.dancers;
  if(!Array.isArray(dancers))throw new Error('缺少 dancers 数组');
  // 数量口径：8/8/1 裁定（主人 2026-09-05：编辑/排练 8、网页预览 8、X1 前游戏执行 1）之上，
  // 1～12 是刻意保留的导入余量（E1 验收过 1～12 舞者工程）；这里守住余量边界，快捷按钮另限 1～8
  if(dancers.length<1||dancers.length>12)throw new Error('舞者数量须在 1～12 之间（当前 '+dancers.length+'）');
  function str(v,max,label){if(v==null)return;if(typeof v!=='string')throw new Error(label+' 必须是文本');if(v.length>max)throw new Error(label+' 超长（上限 '+max+' 字）')}
  function num(v,label){if(typeof v!=='number'||!isFinite(v))throw new Error(label+' 必须是数字');if(v<0||v>86400)throw new Error(label+' 超出允许范围（0～86400 秒）')}
  dancers.forEach(function(d,i){
    if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('舞者 '+(i+1)+' 数据不完整');
    str(d.name,40,'舞者 '+(i+1)+' 名称');
    ['switchClips','actionClips','lyricClips','clips'].forEach(function(k){if(d[k]!==undefined&&!Array.isArray(d[k]))throw new Error('舞者 '+(i+1)+' 的 '+k+' 不是数组')});
    var clips=(d.actionClips||d.clips||[]).concat(d.switchClips||[],d.lyricClips||[]);
    if(clips.length>2000)throw new Error('舞者 '+(i+1)+' 的动作条太多（上限 2000）');
    clips.forEach(function(c,ci){
      if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('舞者 '+(i+1)+' 第 '+(ci+1)+' 条数据不完整');
      if(c.data!==undefined&&(typeof c.data!=='object'||Array.isArray(c.data)))throw new Error('舞者 '+(i+1)+' 第 '+(ci+1)+' 条的 data 字段无效');
      str(c.data&&c.data.name,120,'舞者 '+(i+1)+' 第 '+(ci+1)+' 条的名称');
      str(c.data&&c.data.command,200,'舞者 '+(i+1)+' 第 '+(ci+1)+' 条的命令');
      num(c.start,'舞者 '+(i+1)+' 第 '+(ci+1)+' 条的开始时刻');
      num(c.duration,'舞者 '+(i+1)+' 第 '+(ci+1)+' 条的时长');
    });
  });
  if(data.globalLyrics!==undefined){
    if(!Array.isArray(data.globalLyrics))throw new Error('globalLyrics 不是数组');
    if(data.globalLyrics.length>5000)throw new Error('全局歌词行数太多（上限 5000）');
    data.globalLyrics.forEach(function(c,ci){
      if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('全局歌词第 '+(ci+1)+' 行数据不完整');
      str(c.data&&c.data.name,500,'全局歌词第 '+(ci+1)+' 行文本');
      num(c.start,'全局歌词第 '+(ci+1)+' 行的开始时刻');
      num(c.duration,'全局歌词第 '+(ci+1)+' 行的时长');
    });
  }
  if(data.markers!==undefined){
    if(!Array.isArray(data.markers))throw new Error('markers 不是数组');
    if(data.markers.length>500)throw new Error('段落标记太多（上限 500）');
    data.markers.forEach(function(m,ci){
      if(!m||typeof m!=='object'||Array.isArray(m))throw new Error('段落标记第 '+(ci+1)+' 条数据不完整');
      str(m.name,60,'段落标记第 '+(ci+1)+' 条的名称');
      num(m.t,'段落标记第 '+(ci+1)+' 条的时刻');
    });
  }
  if(data.showLyricMacro!==undefined&&typeof data.showLyricMacro!=='boolean')throw new Error('showLyricMacro 必须是 true/false');
}

// —— RENDER 外壳（_clipNodes/ChoreoDock/工具中心/命令面板/空态/工作台壳/属性面板/render/renderToolbar/侧栏/动作列表）已拆至
//    choreo-app-render.js（OVERHAUL 批 C 第六步；在本件之前加载，同全局名调用时解析）。——

// —— 时间轴窗口化渲染/拖拽/右键/标尺已拆至 choreo-app-timeline.js（OVERHAUL 批 C 第五步；
//    在本件之前加载，同全局名调用时解析）。——

// P1-B：宏命令身份解析（宏草稿与宏起步共用同一份 resolver；/ac 是否真的对应某个技能由预览明示“身份待核验”，不从文本推断为已核实）
function resolveMacroCommand(command){
  var cmd=command.split(/\s+/)[0].toLowerCase();
  var found=store.emotes.concat(store.actions).find(function(e){return (e.command||'').toLowerCase()===command.toLowerCase()||(e.command||'').toLowerCase()===cmd});
  return found?Object.assign({},found):null;
}
// P1-B 宏起步入口：空态卡与工作台内常驻入口都走这里；预览/应用/取消在 choreo-macro-ui.js，
// 草稿与「宏原文备注」按项目+舞者持久化（contentExtra.macroStart），应用只提交识别行且走既有 reconcile。
function openMacroStart(){
  if(!window.ChoreoMacroUI||!ChoreoMacroUI.openStart){showToast('宏模块未加载');return}
  if(!store.dancers[store.selectedDancer]){showToast('先添加一位舞者，再使用宏起步');return}
  store.activeMacroTab=store.selectedDancer;
  ChoreoMacroUI.openStart({
    store:store,toast:showToast,resolve:resolveMacroCommand,persist:persistProject,
    save:function(){updateTotalDuration();saveHistory()},render:render,undo:undo
  });
}
// P1-B 循环试看这一段：循环区间=片段±0.5s，起播后停止即退出循环（复用现有 loopA/B、seek 与播放链）
// J4：点击前按钮已写明循环（choreo-props-ui）；toast 同步说清网页循环、停止方式与素材边界
function startLocalRehearsal(clip){
  if(!clip)return;
  if(store.previewTarget==='game'){showToast('循环试看只支持网页播放——游戏插件没有循环端点');return}
  if(window.ChoreoWorkbench&&ChoreoWorkbench.rehearsalActive()){exitLocalRehearsal();return}
  var a=Math.max(0,Math.round((clip.start-0.5)*10)/10),b=Math.round((clip.start+clip.duration+0.5)*10)/10;
  store.loopA=a;store.loopB=b;
  if(window.ChoreoWorkbench)ChoreoWorkbench.startRehearsal(a,b);
  seekTimelinePosition(a);
  if(!store.isPlaying)startPlay();
  render();
  showToast('循环试看：网页循环 '+a.toFixed(1)+'–'+b.toFixed(1)+'s（片段前后各留 0.5 秒）；点顶部 ⏹ 停止或再点一次退出。素材状态以舞台面板为准，替身只示意位置，不代表真实动作已预览');
}
function exitLocalRehearsal(){
  if(window.ChoreoWorkbench)ChoreoWorkbench.exitRehearsal();
  store.loopA=store.loopB=null;
  render();
  showToast('已退出循环试看（播放不中断，不再循环）');
}
// P1-C 同处走位（基础）：上下文栏「走位…」→ 舞台俯视点目的地+到达时刻+走/跑（B9：会话在 choreo-stage-motion-ui）
function openSamePlaceMove(di,clip){
  if(!window.ChoreoStageMotionUI||!ChoreoStageMotionUI.openSamePlace){showToast('走位模块未加载');return}
  if(!ChoreoStageMotionUI.openSamePlace(di,clip)
    &&!(ChoreoStageMotionUI.samePlaceActive&&ChoreoStageMotionUI.samePlaceActive())) // B9：脏切换拒绝时旧快捷段仍在并已 toast，不追加误导的「片段已变化」
    showToast('打开走位编辑失败：片段已变化，请重新选择');
}
function renderMacroPanel(){
  var panel=el('div','macro-pnl'+(store.macroCollapsed?' collapsed':'')+(store.macroFullscreen?' fullscreen':''));
  // 高度由 inline height 直接驱动：旧版内容高度+max-height 方案下面板只有 ~140px，
  // 拖拽条改 maxHeight 视觉无效、全屏 max-height!important 也撑不开 —— 这就是"太低/全屏没反应"
  var normH=function(){return Math.min(store.macroHeight||220,Math.max(140,Math.round(window.innerHeight*0.28)))};
  var fsH=function(){return store.macroFsHeight||Math.round(window.innerHeight*0.86)};
  var applyH=function(){
    if(store.macroCollapsed)panel.style.height='34px';
    else if(store.macroFullscreen)panel.style.height=fsH()+'px';
    else panel.style.height=normH()+'px';
  };
  applyH();
  // 收起态只有一个入口，不构建宏编辑器或挤占时间轴。
  if(store.macroCollapsed){
    var open=el('button','macro-drawer-toggle','宏文本');
    open.type='button';open.setAttribute('aria-expanded','false');
    open.appendChild(el('span','macro-drawer-hint','需要时展开 ↗'));
    open.onclick=function(){store.macroCollapsed=false;store.macroFullscreen=false;render()};
    panel.appendChild(open);return panel;
  }
  // 拖拽条：上下拖调整宏面板高度（普通/全屏各自记忆）
  var rz=el('div','macro-resize');rz.title='拖动调整宏面板高度';
  rz.onmousedown=function(e){
    e.preventDefault();e.stopPropagation();
    rz.classList.add('dragging');
    var sy=e.clientY,curH=panel.offsetHeight;
    var minH=140,maxH=store.macroFullscreen?window.innerHeight-60:Math.max(140,Math.round(window.innerHeight*.28));
    var onMv=function(ev){
      var nh=Math.max(minH,Math.min(maxH,curH+(sy-ev.clientY)));
      panel.style.height=nh+'px';
      if(store.macroFullscreen)store.macroFsHeight=nh;else store.macroHeight=nh;
    };
    var onUp=function(){rz.classList.remove('dragging');document.removeEventListener('mousemove',onMv);document.removeEventListener('mouseup',onUp)};
    document.addEventListener('mousemove',onMv);document.addEventListener('mouseup',onUp);
  };
  panel.appendChild(rz);
  var hdr=el('div','macro-hdr');
  var collapse=el('button','btn macro-collapse','收起');collapse.type='button';collapse.setAttribute('aria-expanded','true');
  collapse.onclick=function(){store.macroCollapsed=true;store.macroFullscreen=false;render()};hdr.appendChild(collapse);
  hdr.appendChild(el('span','mp-ttl','宏文本'));
  var tabs=el('div','macro-tabs');
  store.dancers.forEach(function(d,di){
    var t=el('div','macro-tab'+(store.activeMacroTab===di?' active':''));t.textContent=d.name;
    t.onclick=function(e){e.stopPropagation();store.activeMacroTab=di;render()};tabs.appendChild(t);
  });
  hdr.appendChild(tabs);
  var fs=el('button','btn',store.macroFullscreen?'\u25A0 \u9000\u51FA\u5168\u5C4F':'\u26F6 \u5168\u5C4F');fs.title='\u5B8F\u9762\u677F\u5168\u5C4F\u7F16\u8F91\uFF08Esc \u9000\u51FA\uFF09';
  fs.onclick=function(e){e.stopPropagation();store.macroFullscreen=!store.macroFullscreen;render()};
  hdr.appendChild(fs);
  var gear=el('button','btn','切换装备套装');gear.onclick=function(e){e.stopPropagation();openGearsetPicker()};hdr.appendChild(gear);
  hdr.appendChild(el('span','','手写台词与动作 · 点应用后生效'));
  panel.appendChild(hdr);
  if(!store.macroCollapsed){
    panel.appendChild(ChoreoMacroUI.render({store:store,el:el,toast:showToast,render:render,undo:undo,
      lyrics:function(){showSongLyricsEditor()},
      resolve:resolveMacroCommand,
      persist:persistProject,
      save:function(){updateTotalDuration();saveHistory()}
    }));
  }
  return panel;
}

// 套装编号由用户选择；读取列表不操作角色，插入只改当前项目的切换轨。
var _gearsetSnapshot=null,_gearsetGeneration=0;
// P4-A（#34）套装片段上下文栏的就地提交：与旧对话框 onInsert 同一校验/合并/撤销链——
// 播放中阻止、游戏连接时取新鲜套装清单核对（无连接则如实标未核验）、updateClip 合并、一次 saveHistory。
async function applyGearsetEdit(clip,di,slot,start){
  var projectId=store.projectId,extra=store.contentExtra;
  var dancer=store.dancers[di],original=JSON.stringify(clip);
  if(!dancer)return {ok:false,error:'舞者不存在，请重新选择后再改。'};
  if(store.isPlaying)return {ok:false,error:'请先停止播放，再修改套装切换。'};
  var snapshot=null;
  if(store.gameConnected){try{snapshot=await apiFetch('/gearsets',{timeoutMs:4000})}catch(e){}}
  if(store.projectId!==projectId||store.contentExtra!==extra||store.dancers.indexOf(dancer)<0)return {ok:false,error:'项目已经改变，请重新选择套装'};
  _gearsetSnapshot=snapshot;
  var r=ChoreoGearset.makeSwitch(slot,snapshot,store.classJobs);
  if(!r.ok)return {ok:false,error:r.error};
  var index=dancer.switchClips.indexOf(clip);
  if(index<0||JSON.stringify(clip)!==original)return {ok:false,error:'条目已经改变，请重新选择后再改。'};
  dancer.switchClips[index]=ChoreoGearset.updateClip(clip,r.data,start);
  updateTotalDuration();saveHistory();render();
  return {ok:true,warning:r.warning};
}
async function openGearsetPicker(clip,di){
  var generation=++_gearsetGeneration,projectId=store.projectId,extra=store.contentExtra;
  var dancer=store.dancers[di==null?store.activeMacroTab:di],at=clip?clip.start:store.currentTime;
  var original=clip?JSON.stringify(clip):null;
  if(!dancer)return;
  var snapshot=null;
  if(store.gameConnected){try{snapshot=await apiFetch('/gearsets',{timeoutMs:4000})}catch(e){}}
  if(generation!==_gearsetGeneration||store.projectId!==projectId||store.contentExtra!==extra||store.dancers.indexOf(dancer)<0)return;
  _gearsetSnapshot=snapshot;
  var slotMatch=clip&&clip.data&&String(clip.data.command).match(/^\s*\/(?:gs|gearset)\s+change\s+([1-9]\d?|100)\s*$/i);
  ChoreoGearset.openDialog({snapshot:_gearsetSnapshot,classJobs:store.classJobs,editing:!!clip,start:at,slot:slotMatch?slotMatch[1]:null,
    isPlaying:function(){return store.isPlaying},
    getCharacterKey:function(){return _gearsetSnapshot&&_gearsetSnapshot.characterKey},
    onRefresh:function(){openGearsetPicker(clip,di)},
    onInsert:function(data,start){
      if(generation!==_gearsetGeneration||store.projectId!==projectId||store.contentExtra!==extra||store.dancers.indexOf(dancer)<0)return {ok:false,error:'项目已经改变，请重新选择套装'};
      if(clip){
        var index=dancer.switchClips.indexOf(clip);
        if(index<0||JSON.stringify(clip)!==original)return {ok:false,error:'条目已经改变，请重新打开后修改'};
        dancer.switchClips[index]=ChoreoGearset.updateClip(clip,data,start);
        updateTotalDuration();saveHistory();render();return {ok:true};
      }
      return {ok:addClip(store.dancers.indexOf(dancer),'switch',data,start)};
    }
  });
}

function renderBottomBar(){
  var b=el('div','bottombar');
  var sc=0,ac=0,lc=0,glc=store.globalLyrics.length,extraCount=0;
  store.dancers.forEach(function(d){sc+=d.switchClips.length;ac+=d.actionClips.length;lc+=d.lyricClips.length});
  // COUNT-01：技能、走位等规范轨按事件计数；保留的停用内容也计入，空轨和路点不另算条目。
  var extraTracks=store.contentExtra&&store.contentExtra._doc&&store.contentExtra._doc.extraTracks;
  if(Array.isArray(extraTracks))extraTracks.forEach(function(t){if(t&&Array.isArray(t.events))extraCount+=t.events.length});
  // 引擎开关已移进工具栏「⋯ 高级」弹层（阶段4：普通用户不需要看见经典/增强内部概念）
  var pdi=gameActorIdx(),pdn=pdi>=0?store.dancers[pdi].name:'\u2014'; // ACTOR：底栏直接可见当前预览舞者
  var html='<div>\u6A21\u5F0F: <span class="v">'+(store.previewTarget==='game'?'\u6E38\u620F\u89D2\u8272':'\u7F51\u9875 3D')+'</span></div>'+
    '<div>\u9884\u89C8\u821E\u8005: <span class="v">'+(store.previewTarget==='game'?pdn:'\u2014')+'</span></div>'+
    '<div>\u6E38\u620F: <span class="v">'+(store.gameConnected?'\u5DF2\u8FDE\u63A5':'\u672A\u8FDE\u63A5')+'</span></div>'+
    '<div>\u821E\u8005: <span class="v">'+store.dancerCount+'</span></div>'+
    '<div title="切换 '+sc+' · 动作 '+ac+' · 台词 '+lc+' · 全局歌词 '+glc+' · 额外轨道事件 '+extraCount+'">条目: <span class="v">'+(sc+ac+lc+glc+extraCount)+'</span></div>'+
    '<div id="recPos"></div>'+'<div id="cursorPos">位置: 0.0s</div>';
  b.innerHTML=html;
  return b;
}
