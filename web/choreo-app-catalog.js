// 编舞助手连接/目录分件（OVERHAUL 批 C 第七步从 choreo-app.js 拆出）：
// 连接探测、目录快照、资料库自动同步与实测时长——probeExport/applyCatalogObject/
// applyCatalogSnapshot/startConnWatch/probeCaps/probeGame/autoSyncLibrary/refreshMeasured。
// 同全局名文件级搬家，行为逐字不变；须在 choreo-app.js 之前加载（装时机语句自足）。
'use strict';

// 探测 48795（导出/3D 服务）在线状态：只置标志，不阻断任何功能
function probeExport(){
  // SEC-1：/export/list 是私有读，带配对码（没配对时 403 → 显示未连接，符合实际可用性）。
  // ARCH-2：配对码头归 choreo-api.js 48795 高层 api——非 2xx 走 catch 静默降级，不弹提示
  ChoreoAPI.export.api('/export/list',{method:'GET',timeoutMs:3000})
    .then(function(){store.exportConnected=true})
    .catch(function(){store.exportConnected=false});
}

// 阶段2（离线启动）：游戏没开时用内置目录快照（catalog-snapshot.js）把侧栏立起来。
// 返回 true 表示本次真的填了数据（调用方据此决定要不要提示/重绘）；快照数据套用
// 与线上目录完全相同的归类/过滤/职业表构建逻辑，两边行为一致
// 阶段3：抽出 applyCatalogObject(c)——内置快照和本地资料库缓存的目录共用这套逻辑
function applyCatalogObject(c){
  if(!c||!c.emotes||!c.emotes.length)return false;
  store.emotes=c.emotes.map(function(e){var n=Object.assign({},e);n.category=categorizeEmote(n.name,n.category);return n});
  store.races=c.races||[];
  store.actions=(c.actions||[]).filter(function(a){return a.jobName&&a.jobName.length>0});
  store.classJobs=(c.classJobs||[]).filter(function(j){return j.name&&j.name.length>0});
  store.jobMap={};
  store.classJobs.forEach(function(j){store.jobMap[j.id]={name:j.name,abbr:j.abbreviation,id:j.id,role:j.role}});
  store.catalogFromSnapshot=true;
  return true;
}
function applyCatalogSnapshot(){
  if(store.emotes.length)return false;
  return applyCatalogObject(window.__CHOREO_CATALOG__);
}

// 阶段2（离线启动）：断连时每 15s 静默探测——游戏中途启动后连接状态自动刷新、
// 快照目录自动升级成线上目录；不重载页面、不丢草稿，只在"从断到通"的边沿提示一次
var _connTimer=null;
function startConnWatch(){
  if(_connTimer)return;
  _connTimer=setInterval(async function(){
    if(window.ChoreoStageGameUI)ChoreoStageGameUI.refreshStatus();
    if(!store.exportConnected)probeExport();
    // v0.6.7：连着但还没认出新版插件（页面开着时插件热重载升级了）——持续轻探 /capabilities 直到认出
    if(store.gameConnected&&!store.capsOk){probeCaps();return}
    if(store.gameConnected)return;
    var snapLoaded=store.catalogFromSnapshot;
    await probeGame(true,snapLoaded); // 静默探测；目录来自快照时顺带强制升级成线上版
    if(store.gameConnected)showToast(snapLoaded&&snapLoaded===store.catalogFromSnapshot
      ?'游戏已连接'
      :'游戏已连接，动作目录已更新');
  },15000);
}

var _measuredTimer=null;
// v0.6.7 能力握手：新版插件回 {app,version,protocolVersion,pairing,capabilities}；
// 旧插件（≤0.6.6）没有这个端点 → capsOk=false 走兼容模式（写请求不带配对头）。
// 独立成函数：连接监视器也调——页面开着时插件热重载升级（旧→新），capsOk 15s 内自动跟上
async function probeCaps(){
  var was=store.capsOk;
  try{
    var cr=await ChoreoAPI.game.raw('/capabilities',{timeoutMs:3000});
    // FIX-4/AUD-013：capsOk 不再"带 protocolVersion 就认"——必须确认是本插件（app 字段）
    // 且协议版本是数字，才进入新版安全模式（才发配对头）
    if(cr.ok){var cj=await cr.json();
      store.capsOk=!!(cj&&cj.app==='ChoreoHelper'&&typeof cj.protocolVersion==='number');
      store.pluginCaps=cj||null}
    else{store.capsOk=false;store.pluginCaps=null}
  }catch(e){store.capsOk=false;store.pluginCaps=null}
  // Phase 1：会话未广播（旧插件/能力缺失）则清本页会话令牌，保持配对码直写 legacy 行为
  if(!sessionAdvertised())clearStoredSession();
  if(store.capsOk&&!was&&!store.pairToken)
    showToast('检测到新版插件：控制游戏前先配对——游戏里输入 /choreo pair 查码，到顶栏「🧰 工具」→「高级工具」的「🔗 网页配对」粘贴');
  // 插件协议比网页新 → 提示升级网页（网页旧了不认识新协议；反向暂时不存在更高网页协议）
  if(store.capsOk&&store.pluginCaps&&store.pluginCaps.protocolVersion>CHOREO_PROTOCOL)
    showToast('插件版本比网页新——重新打开/刷新网页获取新版，避免功能不匹配');
}
// 探测 48794（游戏插件）并补齐动作目录；失败只置离线状态+提示，不挡编辑器。
// silent=true 时不弹"游戏未连接"提示（调用方自己有更具体的话要说）
// 目录刷新先完整读取并持久化，再原子替换；旧快照不能盖住本地真实身份。
var _catalog=ChoreoCatalog.create({
  read:function(p,o){return apiFetch(p,o)},
  load:function(){return window.ChoreoLibrary&&ChoreoLibrary.available()?ChoreoLibrary.getCatalog():Promise.resolve(null)},
  fallback:function(){return window.__CHOREO_CATALOG__},
  save:function(c,o){return window.ChoreoLibrary&&ChoreoLibrary.available()?ChoreoLibrary.putCatalog(c,o):Promise.reject(Error('本地资料库不可用，目录未保存'))},
  apply:function(c,offline){applyCatalogObject(c);store.catalogFromSnapshot=offline}
});
async function probeGame(silent,forceCatalog){
  var catalogGeneration=_catalog.begin();
  try{
    var h=await apiFetch('/health');
    if(!_catalog.current(catalogGeneration))return;
    if(h.status!=='ok')throw new Error('unhealthy');
    store.gameConnected=true;store.connected=true;
    await probeCaps();
  }catch(err){
    if(!_catalog.current(catalogGeneration))return;
    var wasConnected=store.gameConnected;
    store.gameConnected=false;store.connected=false;
    // 阶段2（离线启动）：游戏没开时用内置目录快照兜底，侧栏照样有动作可拖
    var snapOk=applyCatalogSnapshot();
    // 只在状态真正变化时重绘——连接监视器会周期性调到这里，不能反复重建 DOM 打断用户操作
    if(store.appReady&&(wasConnected||snapOk))render();
    if(!silent)showToast(snapOk
      ?'游戏未连接——已按「网页 3D」模式工作，动作目录用内置快照（'+store.emotes.length+' 动作）'
      :'游戏未连接——已按「网页 3D」模式工作，编辑不受影响（点工具栏圆点可重新检测）');
    try{
      if(await _catalog.restore(catalogGeneration,{actions:store.actions})&&store.appReady){render();if(!silent)showToast('游戏未连接——已恢复本机目录，目标条件仍未核验')}
    }catch(e){if(_catalog.current(catalogGeneration))showToast(e.message)}
    return;
  }
  if(!_catalog.current(catalogGeneration))return;
  // 已连接：同步设置与动作目录（每步独立兜底，单项失败不拖垮别的）
  // 同步引擎偏好到插件（经典/增强）——v0.6.7：新版插件未配对前先跳过（否则每次探测都 403 弹配对提示）
  if(!store.capsOk||store.pairToken){
    try{apiFetch('/settings/engine',{method:'POST',body:JSON.stringify({pinMode:store.engine==='pin'})}).catch(function(){})}catch(e){}
  }
  // 恢复 GPose 模式显示状态（不自动发送命令——用户上次退出时已关）
  try{apiFetch('/gpose/state').then(function(r){if(r.gpose){store.gpose=true;render()}}).catch(function(){})}catch(e){}
  if(forceCatalog||!store.emotes.length){
    try{
      if(await _catalog.refresh(catalogGeneration)&&store.appReady){render();showToast('目录已保存到本机：'+store.actions.length+' 技能；目标条件仍须本次核验')}
    }catch(err){if(_catalog.latest(catalogGeneration))showToast(err.message||'目录刷新失败，保留上次有效目录')}
  }
  if(!_catalog.current(catalogGeneration))return;
  // 实测动画时长：预览/拖动/播放过的动作会记录真实时长，用于显示与自动校正 clip 时长
  if(!_measuredTimer){
    refreshMeasured();
    _measuredTimer=setInterval(refreshMeasured,5000);
  }
  // 阶段3（自动同步）：连上插件了——发现资料库里缺动作就后台自动补齐，主人不用点任何按钮。
  // 挂在 probeGame 成功处，首次打开/断线重连/点圆点重连三种情况都走这里
  autoSyncLibrary();
  if(store.appReady)render();
}

// 阶段3（自动同步）：网页连上插件后，把插件里已录制、本地资料库还没有的动作自动收进来。
// 全量 264 条约半分钟（后台进行，可正常编辑）；没存上的下次连上自动重试。
// 手动「资料库」窗口导入进行中时让路（_libBusy）；自身防重入（_libAutoBusy）
var _libAutoBusy=false;
function autoSyncLibrary(){
  if(_libAutoBusy||_libBusy)return;
  if(!(window.ChoreoLibrary&&ChoreoLibrary.available()))return;
  _libAutoBusy=true;
  (async function(){
    try{
      // SEC-1：/export/list 私有读带配对码（ARCH-2：码头归 48795 高层 api，非 2xx 抛错走静默 catch）
      var j=await ChoreoAPI.export.api('/export/list');var names=(j&&j.clips)||[];
      var idx=await ChoreoLibrary.clipIndex();
      var have={};idx.forEach(function(c){have[c.name]=true});
      var miss=names.filter(function(n){return !have[n]});
      if(!miss.length)return;   // 库是齐的：什么都不说，安静
      showToast('检测到 '+miss.length+' 个动作还没存进本地，正在后台自动同步…');
      var rep=await ChoreoLibrary.syncFromPlugin({qcFn:recLibQc}); // 阶段4：静止坏数据不进库
      if(rep.imported>0){
        showToast('动作已自动存进本地资料库：新增 '+rep.imported+' 条'
          +(rep.failed.length?('，'+rep.failed.length+' 条没存上（下次连上自动重试）'):''));
        if(window.__p3dLibChanged)__p3dLibChanged();
        _libIdxCache=null;scheduleRealtimeCheck(); // 资料库变了：缺录判定立即重算
      }
    }catch(e){/* 静默：下次连上插件再试 */}
    finally{_libAutoBusy=false}
  })();
}

// 拉取插件实测的动画时长（预览/定格/播放时累积），并自动校正未被手动调过的 clip 时长
function refreshMeasured(){
  apiFetch('/actions/measured-durations').then(function(d){
    if(!d||!d.durations)return;
    var changed=false;
    Object.keys(d.durations).forEach(function(k){
      var v=parseFloat(d.durations[k]);if(!isFinite(v)||v<=0.05)return;
      if(store.measuredDur[k]!==v){store.measuredDur[k]=v;changed=true}
    });
    if(!changed)return;
    // AUD-015：修正循环抽成纯函数（ChoreoEdit.pure.applyMeasuredDurations，node 单测覆盖）；
    // 程序自动修正后立即落盘，不进撤销栈——刚校正完就关页面也不会丢
    var fixed=(window.ChoreoEdit&&ChoreoEdit.pure.applyMeasuredDurations)?ChoreoEdit.pure.applyMeasuredDurations(store.dancers,store.measuredDur):0;
    // WEB-RACE：时长被实测值改掉=时间轴内容变更，revision 必须递增并重推快照（游戏模式下防抖推送）
    if(fixed){bumpTimelineRev();updateTotalDuration();render();persistProject()}
  }).catch(function(){});
}
