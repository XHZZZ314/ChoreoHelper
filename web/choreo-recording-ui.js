// 主页录制界面：负责高级工具、配对和 3D 动作库录制会话。
'use strict';
// ============ ⋯ 高级：老版本功能弹层（阶段4 起移出普通工具栏） ============
// v0.6.7 新增「🔗 网页配对」：新版插件的写接口（播放/录制/复位）要配对码，一个浏览器粘一次
function pairBtnLabel(){
  if(!store.gameConnected)return'🔗 网页配对（游戏未连）';
  if(!store.capsOk)return'🔗 网页配对（插件较旧·无需）';
  return store.pairToken?'🔗 已配对':'🔗 网页配对';
}
function pairDialog(){
  if(!store.gameConnected){showToast('游戏没连上——先开游戏再配对');return}
  if(!store.capsOk){showToast('当前插件是 0.6.6 或更早，不需要配对；若游戏刚更新过，等几秒或刷新页面再试');return}
  var t=prompt('游戏里输入 /choreo pair 查看配对码，粘贴到这里（一个浏览器只需一次；全角/空格会自动纠正）：',store.pairToken||'');
  if(t===null)return; // 取消不动
  t=normToken(t);
  if(!t){savePairToken('');showToast('已清除配对码——写操作会要求重新配对');return}
  savePairToken(t);
  showToast('已配对：'+t+'（清浏览器数据后要重粘一次）');
}
// P4-C（#52）：原「⋯ 高级」弹层 6 项迁入工具中心「高级工具」页。这里保留逐项构建函数（回调与旧弹层
// 同源，逐项不删）；「演出执行」明确标注「实验」，不与开演页统一入口混淆。点击后先关工具中心再执行，
// 与旧弹层点击即收起的行为一致。
function buildAdvToolButtons(){
  var out=[];
  function item(text,tip,fn){
    var b=el('button','btn',text);b.type='button';b.title=tip;
    b.onclick=function(){if(typeof closeToolsCenter==='function')closeToolsCenter();fn()};
    out.push(b);return b;
  }
  item('📷 拍照精确','进入拍照模式编辑（游戏屏闭一切干扰）：拖动=确定性解析→直接绑定→精确定格，无等待无学习；再点退出',function(){apiFetch('/gpose/toggle',{method:'POST',body:JSON.stringify({})}).then(function(r){store.gpose=r.gpose;render();showToast(r.gpose?'已进入拍照精确模式':'已退出拍照精确模式')}).catch(function(){showToast('失败')})});
  item('引擎: '+((store.engine!=='pin')?'经典':'增强'),'经典 = v0.5.11 行为族 / 增强 = 钉住架构',function(){
    store.engine=(store.engine==='pin')?'classic':'pin';
    try{localStorage.setItem('choreo_engine',store.engine)}catch(e){}
    apiFetch('/settings/engine',{method:'POST',body:JSON.stringify({pinMode:store.engine==='pin'})}).then(function(){render()}).catch(function(){});
  });
  item(pairBtnLabel(),'新版插件（0.6.7+）控制游戏前要配对：游戏里 /choreo pair 查看配对码，这里粘贴一次',pairDialog);
  // EXEC-CORE：实验演出执行面板入口（编译→装载→就绪→开始/紧急停止）；面板本体在 show-ui，不在本批写域
  item('🎬 演出执行（实验）','把当前项目编译成演出包交给插件演出执行器：显式开始+倒计时+紧急停止（实验功能，需新版插件；开演页统一入口属后续 P5，不与此混淆）',function(){showExecPanel()});
  // WP-3b：插入/删除时间——全体舞者+全局歌词+段落标记一起动的"时间轴手术"，放高级里防误触
  item('\u2935 插入时间…','在播放头插入空隙：之后的所有条目（全体舞者+全局歌词+段落标记）整体右移',function(){insDelTime(true)});
  item('\u2934 删除时间…','删除播放头起的一段时长：区间内的条目删掉、横跨的缩短、后面的整体左移（影响全部舞者）',function(){insDelTime(false)});
  return out;
}

// ============ 阶段4：录制 3D 动作库中心 ============
// 编排规则照抄 scripts\batch-record.js 的实战验证（251/251 全成功那套）：
// 网页逐条驱动 48795 /export/clip（插件只管单条可靠录制），统一 motion 变体触发、
// 姿态类录完调 /export/walkreset 复位、持续类（≥19s）用 /beckon motion 打断、
// 相邻间隔 ≥2.5s、每条质检（幅度<0.3=静止，重试一次仍静止记失败不进库，表情类豁免）。
// 队列/断点（localStorage manifest）/进度/预计剩余/入库全在网页侧；
// 录好的动作直接 putClip 进本地资料库，3D 面板立刻能用。
var REC_KEY='choreo_recSession';
var REC_POSTURE=['sit','groundsit','doze','kneel','playdead','pose','lounge','grovel','winded','situps','savortea'];
var REC_QUICK=['bow','wave','goodbye','beckon','greet','easterngreeting','easternbow','salute','imperialsalute',
  'yes','no','point','clap','cheer','dance','balldance','stepdance','sundance','mogdance','yoldance',
  'harvestdance','golddance','breakdance','conduct','wasshoi'];
var REC_MODE_LABEL={quick:'快速常用',full:'完整全量',missing:'补录缺失',pick:'自选'};
var _recRunning=false,_recCancel=false,_recState=null,_recUi=null;
var _recordingGeneration=0,_recStartSequence=0,_recLoopOwner=null,_verLoopOwner=null;
function recordingStopNow(){ // 全局立即停止：先撤销网页后续动作；实际游戏取消由 /control/stop 统一处理。
  _recordingGeneration++;_recStartSequence++;
  _recCancel=true;_verCancel=true;_verCancelSent=true;
  // 在途请求仍归旧循环所有，等它退场再允许重启，不能提前清 running。
  try{recUpdateUI();if(_recRunning)recPosText('⏹ 已请求立即停止，正在等待录制请求结束')}catch(e){}
  try{verUpdateUI()}catch(e){}
}

function recBaseName(cmd){ // "/beckon motion" → "beckon"（与插件 ClipName 同规则）
  var n=String(cmd||'').trim().replace(/^\//,'').replace(/\//g,'_');
  var sufs=[' motion',' loop',' special'];
  for(var i=0;i<sufs.length;i++){if(n.length>sufs[i].length&&n.slice(-sufs[i].length)===sufs[i]){n=n.slice(0,-sufs[i].length);break}}
  return n.trim();
}
function recAmp(j){ // 相对首帧的最大偏移：静止≈0，正常动作≥0.31（batch-record.js 实测校准；帧结构 [t,x,y,z,w]）
  var best=0,bones=(j&&j.bones)||{};
  for(var k in bones){
    var q=bones[k].q;if(!q||q.length<2)continue;
    var a=q[0].slice(1);
    for(var f=0;f<q.length;f++){
      var fr=q[f];
      var m=Math.abs(fr[1]-a[0])+Math.abs(fr[2]-a[1])+Math.abs(fr[3]-a[2])+Math.abs(fr[4]-a[3]);
      if(m>best)best=m;
    }
  }
  return best;
}
function recExprSet(){ // 表情类：只动脸不动身体，幅度质检豁免（默认不进录制清单）
  var s={};
  (store.emotes||[]).forEach(function(e){if(e.category==='expression'){var b=recBaseName(e.command);if(b)s[b]=1}});
  return s;
}
function recCatalogList(){ // 录制候选清单：非表情、命令非空、按基础名去重（口径与实拍全库 264 条一致）
  var seen={},out=[];
  (store.emotes||[]).forEach(function(e){
    var cmd=String(e.command||'').trim();if(!cmd)return;
    if(e.category==='expression')return;
    var b=recBaseName(cmd);if(!b||seen[b])return;seen[b]=1;
    out.push({cmd:cmd,cname:e.name,b:b});
  });
  return out;
}
function recDraftSet(){ // 草稿时间轴里引用过的动作也算"常用"（AUD-014：命令在 c.data.command，兼容旧结构回退 c.command）
  var s={};
  (store.dancers||[]).forEach(function(d){(d.actionClips||[]).forEach(function(c){var b=recBaseName((c.data&&c.data.command)||c.command||'');if(b)s[b]=1})});
  return s;
}
function recQuickItems(){
  var quick={},draft=recDraftSet();
  REC_QUICK.forEach(function(b){quick[b]=1});
  return recCatalogList().filter(function(c){return quick[c.b]||draft[c.b]});
}
function recLibQc(name,clip){ // 从插件收动作时的统一质检（autoSync/手动导入共用）：静止坏数据不进库
  if(recExprSet()[name])return{ok:true};
  var amp=recAmp(clip);
  if(amp<0.3)return{ok:false,reason:'静止数据（幅度 '+amp.toFixed(2)+'），可在「录制 3D 动作库」里重录'};
  return{ok:true};
}
function recLoadSession(){try{return JSON.parse(localStorage.getItem(REC_KEY)||'null')}catch(e){return null}}
function recSaveSession(){if(_recState){_recState.updatedAt=Date.now();try{localStorage.setItem(REC_KEY,JSON.stringify(_recState))}catch(e){}}}
function recClearSession(){_recState=null;try{localStorage.removeItem(REC_KEY)}catch(e){}}
function recSleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function recCountsOf(st){var done=0,fail=0,pend=0;(st&&st.items||[]).forEach(function(it){if(it.status==='done')done++;else if(it.status==='failed')fail++;else pend++});return{done:done,fail:fail,pend:pend,total:(st&&st.items||[]).length}}
function recCounts(){return recCountsOf(_recState)}
function recEta(){ // 预计剩余（秒）：按本会话实测单条耗时（含节奏间隔）滚动平均，没数据时按 25s/条估
  var st=_recState||{},times=(st.itemTimes||[]).slice(-20),c=recCounts();
  var avg=times.length?times.reduce(function(a,b){return a+b},0)/times.length:25000;
  return Math.max(1,Math.round(c.pend*avg/1000));
}
function recEtaText(n){var s=Math.round(n*25);return s<90?('~'+s+' 秒'):s<5400?('约 '+Math.round(s/60)+' 分钟'):('约 '+Math.floor(s/3600)+' 小时 '+Math.round(s%3600/60)+' 分')}
function recPosText(txt){var p=document.getElementById('recPos');if(p)p.textContent=txt}
function recUpdateUI(){ // 录制窗口 + 底栏进度同步（窗口可能已关闭，全部判空）
  var st=_recState;if(!st)return;
  var c=recCounts();
  if(_recRunning){
    var cur='';
    for(var i=0;i<st.items.length;i++){var it=st.items[i];if(it.status==='pending'&&it.tries&&!cur)cur=it.name}
    var line='录制 '+(c.done+c.fail)+'/'+c.total+(cur?(' · '+cur):'')+' · 成功 '+c.done+' · 失败 '+c.fail+' · 预计剩余 '+recEta()+' 秒';
    recPosText('⏺ '+line);
    // 窗口可能显示的是摘要/横幅（没有进度条元素）——引用全部判空，否则这里抛异常会把整个录制循环打断
    if(_recUi&&document.body.contains(_recUi.box)){
      if(_recUi.line)_recUi.line.textContent=line;
      if(_recUi.bar)_recUi.bar.style.width=((c.total?Math.round((c.done+c.fail)*100/c.total):0))+'%';
    }
  }else{
    recPosText('⏺ 录制暂停中：成功 '+c.done+' · 失败 '+c.fail+' · 剩 '+c.pend);
  }
}
async function recRecordOne(cmd,generation){ // 单条录制：48795 同步阻塞，响应回来即录完（插件侧上限 30s）
  // ARCH-2：配对码头/JSON/错误映射归 choreo-api.js 48795 高层 api——403 配对错误（e.pairing）
  // 现场弹提示（这里也是唯一弹的调用方），带错误体的非 2xx 按插件「error」短码取词与拆分前同语
  try{
    var j=await ChoreoAPI.export.api('/export/clip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd,save:true})});
    if(j.error)return{ok:false,err:j.error};
    // FIX-C：新插件把录制结果先暂存 pending，质检过+进库后凭 recordingId 才提交落盘
    return{ok:true,dur:j.duration||0,amp:recAmp(j),clip:j,recId:j.recordingId||'',stageError:j.stageError||'',lowRate:!!j.lowSampleRate};
  }catch(e){
    if(e&&e.pairing){if(generation===_recordingGeneration)handle403();return{ok:false,pairing:true,err:'需要配对'}}
    if(e&&e.status&&e.body&&e.body.error)return{ok:false,err:e.body.error};
    return{ok:false,net:true,err:(e&&e.message)||'网络失败'};
  }
}
async function recCommitPending(recId,name,generation){ // FIX-C：质检过+已进库，才让插件把暂存提交成正式文件
  try{
    await ChoreoAPI.export.api('/export/clip/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordingId:recId,name:name})});
    return true;
  }catch(e){}
  if(generation===_recordingGeneration)showToast('动作「'+name+'」已进资料库，但插件落盘未确认（旧文件保留）——稍后可重录这条或忽略');
  return false;
}
async function recCancelPending(recId){ // FIX-C：质检失败/重试前丢掉插件暂存，别覆盖旧的好文件
  try{await ChoreoAPI.export.api('/export/clip/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordingId:recId})})}catch(e){}
}
async function recWalkreset(){
  // 拒绝或缺少确认都必须中止队列，不把关闭的复位后端当作成功。
  var r=await ChoreoAPI.export.api('/export/walkreset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!r||r.ok!==true||r.error)throw new Error('行走复位未确认，后续动作已暂停');
}
async function recStopper(){try{await apiPreview('/beckon motion')}catch(e){}}

async function recRunLoop(){
  if(!_recState||_recRunning)return;
  var st=_recState,expr=recExprSet(),wroteLib=false,netErr=0,broke=false;
  var generation=_recordingGeneration,owner={};_recLoopOwner=owner;
  function live(){return generation===_recordingGeneration&&_recLoopOwner===owner&&_recState===st}
  st.startedAt=st.startedAt||Date.now();
  _recRunning=true;_recCancel=false;
  try{
  recSaveSession();recUpdateUI();
  for(var i=0;i<st.items.length;i++){
    if(_recCancel||!live())break;
    var it=st.items[i];
    if(it.status!=='pending')continue;
    var t0=Date.now();
    it.tries=(it.tries||0)+1;
    recUpdateUI();
    var r=await recRecordOne(it.cmd,generation);
    if(!live())break;
    if(r.pairing){showToast('先完成网页配对再录制：游戏里输入 /choreo pair 查看配对码，到顶栏「🧰 工具」→「高级工具」的「🔗 网页配对」粘贴');break}
    if(r.ok&&r.amp<0.3&&!expr[it.name]){ // 静止坏数据：稍等重试一次（先丢掉这次暂存，别吃掉旧好文件）
      await recSleep(3500);
      if(!live())break;
      if(r.recId)recCancelPending(r.recId);
      it.tries++;
      r=await recRecordOne(it.cmd,generation);
      if(!live())break;
    }
    if(!r.ok){it.status='failed';it.reason=r.err;netErr=r.net?netErr+1:0}
    else if(r.amp<0.3&&!expr[it.name]){it.status='failed';it.reason='静止数据（幅度 '+r.amp.toFixed(2)+'）';netErr=0;if(r.recId)recCancelPending(r.recId)}
    else{
      // FIX-C：先写资料库，成功后才提交插件落盘（两阶段，坏片永远吃不掉 clips 里的健康文件）
      var libErr=false;
      if(window.ChoreoLibrary&&ChoreoLibrary.available()){
        try{await ChoreoLibrary.putClip(it.name,r.clip);wroteLib=true}catch(e){libErr=true}
        if(!live())break;
      }
      if(libErr){
        it.status='failed';it.reason='浏览器资料库写入失败——动作没保存成，稍后重录这条';
        if(r.recId)recCancelPending(r.recId);
        showToast('动作「'+it.name+'」录制成功但浏览器资料库写入失败，没有保存——请稍后重录这条');
      }else{
        it.status='done';it.dur=r.dur;it.amp=r.amp;netErr=0;
        if(r.recId)await recCommitPending(r.recId,it.name,generation);
        if(!live())break;
        if(r.stageError)showToast('动作「'+it.name+'」已进资料库，但插件暂存失败（磁盘问题）——旧文件未被覆盖');
        if(r.lowRate)showToast('「'+it.name+'」采样率偏低（游戏卡顿或开机过久），动作可能不流畅——建议重启游戏后重录');
      }
    }
    (st.itemTimes=st.itemTimes||[]).push(Date.now()-t0);
    recSaveSession();
    if(wroteLib&&window.__p3dLibChanged)__p3dLibChanged();
    if(wroteLib){_libIdxCache=null;scheduleRealtimeCheck()} // 录完的动作进库了：缺录黄条该消的消
    recUpdateUI();
    if(!live())break;
    if(netErr>=3){ // 连续网络失败=游戏/插件掉线：自动暂停，已完成的都在，回来可续录
      showToast('游戏或插件连接断开，录制已暂停——重新连上后点「⏺ 录制 3D 动作库」继续');
      break;
    }
    // 收尾节奏（batch-record.js 实测值）：姿态类行走复位后等 4.5s / 持续类打断后等 4s / 普通等 2.5s
    var hasMore=_recCancel||st.items.some(function(x,j){return j>i&&x.status==='pending'});
    if(r.ok){
      if(REC_POSTURE.indexOf(it.name)>=0){await recWalkreset();if(!live())break;if(hasMore)await recSleep(4500)}
      else if(r.dur>=19){await recStopper();if(!live())break;if(hasMore)await recSleep(4000)}
      else if(hasMore)await recSleep(2500);
    }else if(hasMore)await recSleep(2500);
  }
  }catch(e){ // 循环里任何异常都不能把会话卡死在"运行中"（曾在窗口显示摘要时启动踩过）
    broke=true;
    if(live())showToast('录制出错了：'+((e&&e.message)||e)+'——已停下，已完成的都在资料库里');
  }finally{
  if(_recLoopOwner===owner){
  if(live()&&!_recCancel&&netErr<3&&!broke&&recCountsOf(st).pend===0){
    st.finished=true;
    var c=recCounts();
    showToast('录制完成：成功 '+c.done+' 条'+(c.fail?('，失败 '+c.fail+' 条（可单独重录）'):'')+'——已自动存进本地资料库');
  }
  if(_recState===st)recSaveSession();
  _recRunning=false;_recLoopOwner=null;
  if(_recState){var cc=recCounts();recPosText(_recState.finished
    ?('⏺ 录制结束：成功 '+cc.done+' · 失败 '+cc.fail)
    :('⏺ 录制暂停中：成功 '+cc.done+' · 失败 '+cc.fail+' · 剩 '+cc.pend+' 条'))}
  if(_recUi&&document.body.contains(_recUi.box))renderRecModalBody(); // 显示摘要 + 失败重录
  }
  }
}
async function recStart(mode,items){
  if(window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('请先停止双人演出再录制');return}
  if(_recRunning)return;
  if(!items||!items.length){showToast('没有要录的动作');return}
  var generation=_recordingGeneration,startSequence=++_recStartSequence;
  function live(){return generation===_recordingGeneration&&startSequence===_recStartSequence&&!_recRunning}
  try{ // 起跑前实测双端口真在线（页面开着时游戏可能已经关了）
    var h=await apiFetch('/health');if(!live())return;if(!h||h.status!=='ok')throw 0;
    // SEC-1：/export/list 私有读带配对码（顺带提前发现没配对，别让 264 条全跑成失败）——
    // ARCH-2：码头归 48795 高层 api，非 2xx（含 403）抛错走下面同一个 catch
    await ChoreoAPI.export.api('/export/list');
  }catch(e){if(live())showToast('游戏或插件没连上，先开着游戏再录');return}
  if(!live())return;
  if(window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('本机已准备双人演出，本次不开始录制');return}
  if(store.capsOk&&!store.pairToken){ // v0.6.7：新版插件要先配对，别让 264 条全跑成失败
    showToast('新版插件要先配对：游戏里输入 /choreo pair，到顶栏「🧰 工具」→「高级工具」的「🔗 网页配对」粘贴一次');
    return;
  }
  _recState={v:1,mode:mode,items:items.map(function(c){return{cmd:c.cmd,name:c.b,status:'pending',tries:0}}),itemTimes:[],startedAt:0,updatedAt:Date.now(),finished:false};
  recSaveSession();
  recRunLoop();
  renderRecModalBody();
}

// P4-C（#47）：录制中心迁入工具中心「录制」页——页面宿主直接挂正文（四模式/续录/重录原样保留）。
function mountRecPanel(host){
  host.innerHTML='';
  var wrap=el('div','rec-panel');
  wrap.appendChild(el('h4','tools-page-title','⏺ 录制 3D 动作库'));
  var box=el('div','');
  wrap.appendChild(box);host.appendChild(wrap);
  _recUi={box:box};
  renderRecModalBody();
}
// 旧函数名保留给既有调用方；新入口=顶栏「工具」→「录制」页。录制中关闭工具中心不中断，重新进页回来看进度。
function showRecModal(){
  if(typeof showToolsCenter==='function'){showToolsCenter('record');return}
  showToast('工具中心未加载');
}
function renderRecModalBody(){ // 窗口内容随会话状态重建：进行中 / 未完成续录 / 摘要+重录 / 四模式选择
  var box=_recUi&&_recUi.box;if(!box||!document.body.contains(box))return;
  _recUi.line=null;_recUi.bar=null; // 重建正文后旧进度条引用作废（进行中分支会重新挂上）
  box.innerHTML='';
  var online=store.gameConnected&&store.exportConnected;
  var sess=_recState||recLoadSession();

  // ① 状态信息
  var info=el('div','');info.style.cssText='font-size:12px;line-height:1.7;color:#aab6c8;border:1px solid #252e3c;border-radius:6px;padding:8px 10px;margin-bottom:8px;white-space:pre-line';
  box.appendChild(info);
  function fillInfo(libCount){
    var lines=['游戏插件：'+(online?'已连接 ✓':'未连接（录制要开着游戏）')];
    lines.push('动作目录 '+(store.emotes||[]).length+' 个（表情类按约定不录） · 本地资料库已有动作 '+libCount+' 条');
    if(online)lines.push('录制期间别操作游戏角色、别在游戏里放时间轴；姿态类录完角色会自己起身复位（需要游戏窗口在前台）');
    info.textContent=lines.join('\n');
  }
  if(window.ChoreoLibrary&&ChoreoLibrary.available()){
    ChoreoLibrary.clipIndex().then(function(idx){fillInfo(idx.length)}).catch(function(){fillInfo('?')});
  }else fillInfo(0);

  if(_recRunning){ // ② 进行中
    var act=el('div','');act.style.cssText='border:1px solid #4a5568;border-radius:6px;padding:10px;margin-bottom:8px';
    var line=el('div','');line.style.cssText='font-size:13px;color:#e8c57a';
    var barBg=el('div','');barBg.style.cssText='height:8px;background:#232c3c;border-radius:4px;overflow:hidden;margin:8px 0';
    var bar=el('div','');bar.style.cssText='height:8px;width:0;background:linear-gradient(90deg,#4a9eff,#7ec8ff)';
    barBg.appendChild(bar);
    var note=el('div','');note.style.cssText='font-size:11px;color:#7a8597';
    note.textContent='可以关掉本窗口、切到游戏前台盯着——录制在后台继续，重新点顶栏「🧰 工具」→「录制」回来看进度；刷新/关闭网页会中断当前这条，已完成的不会丢';
    var bCan=el('button','btn danger','停止（当前动作录完后停）');bCan.style.marginTop='6px';
    bCan.onclick=function(){_recCancel=true;bCan.disabled=true;bCan.textContent='正在停止…'};
    act.appendChild(line);act.appendChild(barBg);act.appendChild(note);act.appendChild(bCan);
    box.appendChild(act);
    _recUi.line=line;_recUi.bar=bar;
    recUpdateUI();
    return;
  }

  if(sess&&sess.items&&sess.items.length){ // ③ 上次会话：未完成→续录横幅；已结束→摘要+失败重录
    var c=recCountsOf(sess);
    if(!sess.finished&&c.pend>0){
      var ban=el('div','');ban.style.cssText='border:1px solid #e8c57a;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;color:#e8c57a;display:flex;align-items:center;gap:8px;flex-wrap:wrap';
      ban.appendChild(el('span','','上次录制未完成：还剩 '+c.pend+' 条没录'+(c.fail?('，'+c.fail+' 条失败'):'')+'（已完成的都在资料库里）'));
      var bGo=el('button','btn primary','继续录制');
      var bDrop=el('button','btn','放弃剩余');
      bGo.onclick=function(){if(_recRunning)return;_recState=sess;sess.finished=false;recSaveSession();recRunLoop();renderRecModalBody()};
      bDrop.onclick=function(){recClearSession();renderRecModalBody()};
      ban.appendChild(bGo);ban.appendChild(bDrop);
      box.appendChild(ban);
    }else if(sess.finished&&(c.done||c.fail)){
      var sum=el('div','');sum.style.cssText='border:1px solid #2c3a50;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px';
      var head=el('div','');head.style.cssText='color:'+(c.fail?'#ff9b9b':'#8fd9a0')+';margin-bottom:2px';
      head.textContent='上次录制（'+(REC_MODE_LABEL[sess.mode]||sess.mode)+'）：成功 '+c.done+' 条'+(c.fail?('，失败 '+c.fail+' 条'):'');
      sum.appendChild(head);
      sess.items.forEach(function(it){
        if(it.status!=='failed')return;
        var row=el('div','');row.style.cssText='display:flex;align-items:center;gap:6px;margin-top:4px';
        var nm=el('span','','✗ '+it.name+'（'+(it.reason||'失败')+'）');nm.style.cssText='flex:1;font-size:12px;color:#ff9b9b';
        var bR=el('button','btn','重录');bR.style.cssText='font-size:10px;padding:2px 8px';
        bR.onclick=function(){if(_recRunning)return;_recState=sess;it.status='pending';it.tries=0;it.reason='';sess.finished=false;recSaveSession();recRunLoop();renderRecModalBody()};
        row.appendChild(nm);row.appendChild(bR);sum.appendChild(row);
      });
      var bClr2=el('button','btn','清除本次记录');bClr2.style.cssText='font-size:10px;padding:2px 8px;margin-top:6px';
      bClr2.onclick=function(){recClearSession();renderRecModalBody()};
      sum.appendChild(bClr2);
      box.appendChild(sum);
    }
  }

  // ④ 四种模式
  var modeRow=el('div','');modeRow.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
  var bQuick=el('button','btn primary','⚡ 快速常用');bQuick.style.fontSize='11px';
  bQuick.title='常用问候/欢呼/舞蹈等表演动作，加上当前草稿里用到的动作';
  var bFull=el('button','btn','🌐 完整全量');bFull.style.fontSize='11px';
  bFull.title='目录里除表情类的全部动作（完整全量约 1.5~2 小时，可随时中断续录）';
  var bMiss=el('button','btn','🩹 补录缺失');bMiss.style.fontSize='11px';
  bMiss.title='只录本地资料库还没有的动作';
  var bPick=el('button','btn','☑ 自选');bPick.style.fontSize='11px';
  bPick.title='从动作列表勾选想录的';
  modeRow.appendChild(bQuick);modeRow.appendChild(bFull);modeRow.appendChild(bMiss);modeRow.appendChild(bPick);
  box.appendChild(modeRow);
  var quickN=recQuickItems().length,fullN=recCatalogList().length;
  bQuick.textContent='⚡ 快速常用（'+quickN+' 个 · '+recEtaText(quickN)+'）';
  bFull.textContent='🌐 完整全量（'+fullN+' 个 · '+recEtaText(fullN)+'）';
  if(!online){[bQuick,bFull,bMiss,bPick].forEach(function(b){b.disabled=true})}
  bQuick.onclick=function(){recStart('quick',recQuickItems())};
  bFull.onclick=function(){recStart('full',recCatalogList())};
  bMiss.onclick=function(){
    if(!(window.ChoreoLibrary&&ChoreoLibrary.available())){showToast('此浏览器不支持本地资料库');return}
    bMiss.disabled=true;bMiss.textContent='🩹 查询中…';
    var generation=_recordingGeneration;
    ChoreoLibrary.clipIndex().then(function(idx){
      bMiss.disabled=false;bMiss.textContent='🩹 补录缺失';
      if(generation!==_recordingGeneration)return;
      var have={};idx.forEach(function(cl){have[cl.name]=1});
      var miss=recCatalogList().filter(function(cc){return !have[cc.b]});
      if(!miss.length){showToast('资料库不缺动作，不用补录');return}
      recStart('missing',miss);
    }).catch(function(e){bMiss.disabled=false;bMiss.textContent='🩹 补录缺失';if(generation===_recordingGeneration)showToast('查询资料库失败：'+e.message)});
  };
  var pickArea=el('div','');pickArea.style.cssText='display:none;border:1px solid #252e3c;border-radius:6px;padding:8px;margin-bottom:8px';
  box.appendChild(pickArea);
  bPick.onclick=function(){
    if(pickArea.style.display==='none'){renderPickArea(pickArea);pickArea.style.display='block'}
    else pickArea.style.display='none';
  };
}
function renderPickArea(pickArea){ // 自选清单：全目录（表情类禁选）+ 已录标记
  pickArea.innerHTML='';
  var seen={},rows=[];
  (store.emotes||[]).forEach(function(e){
    var cmd=String(e.command||'').trim();if(!cmd)return;
    var b=recBaseName(cmd);if(!b||seen[b])return;seen[b]=1;
    rows.push({cmd:cmd,cname:e.name,b:b,isExpr:e.category==='expression'});
  });
  var head=el('div','');head.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap';
  var cnt=el('span','','已选 0 个');cnt.style.cssText='font-size:12px;color:#e8c57a';
  var bAll=el('button','btn','全选可录');bAll.style.fontSize='10px';
  var bNone=el('button','btn','清空');bNone.style.fontSize='10px';
  var bGo=el('button','btn primary','⏺ 录制所选');bGo.style.fontSize='10px';
  // GAMECLOCK：批量审核所选（重放+现采比对，只报告不改数据；旧插件 404 时给明确提示）
  var bVer=el('button','btn','🔍 审核所选');bVer.style.fontSize='10px';
  bVer.title='把勾选的动作逐条在游戏里重放一遍，与库里录制数据比对偏差（需要新版插件；角色会真的做动作）';
  bVer.onclick=function(){
    if(_verRunning)return;
    var items=[];
    boxes.forEach(function(bx,i){if(bx.checked&&!bx.disabled)items.push(rows[i])});
    if(!items.length){showToast('先勾选要审核的动作');return}
    verStart(items);
  };
  head.appendChild(cnt);head.appendChild(bAll);head.appendChild(bNone);head.appendChild(bGo);head.appendChild(bVer);
  pickArea.appendChild(head);
  var listBox=el('div','');listBox.style.cssText='max-height:260px;overflow-y:auto;border:1px solid #20293a;border-radius:6px;padding:6px';
  pickArea.appendChild(listBox);
  // GAMECLOCK：审核进度行 + 结果列表 + 取消（挂在自选清单下面；窗口重建后 verUpdateUI 恢复显示）
  var verLine=el('div','');verLine.style.cssText='font-size:12px;color:#e8c57a;margin-top:6px;min-height:16px';
  var verList=el('div','');verList.style.cssText='max-height:120px;overflow-y:auto;margin-top:2px';
  var bVerStop=el('button','btn danger','✋ 停止审核');bVerStop.style.cssText='font-size:10px;padding:2px 8px;margin-top:4px';
  bVerStop.style.display=_verRunning?'inline-block':'none';
  bVerStop.onclick=verRequestCancel;
  pickArea.appendChild(verLine);pickArea.appendChild(verList);pickArea.appendChild(bVerStop);
  _verUi={verLine:verLine,verList:verList,verBtn:bVer,verStop:bVerStop};
  verUpdateUI();
  var boxes=[];
  function refreshCnt(){cnt.textContent='已选 '+boxes.filter(function(bx){return bx.checked&&!bx.disabled}).length+' 个'}
  if(window.ChoreoLibrary&&ChoreoLibrary.available()){
    ChoreoLibrary.clipIndex().then(function(idx){
      var have={};idx.forEach(function(cl){have[cl.name]=1});
      rows.forEach(function(r,i){
        var tag=boxes[i]&&boxes[i].parentNode&&boxes[i].parentNode.querySelector('.libtag');
        if(tag&&have[r.b])tag.textContent='已录';
      });
    }).catch(function(){});
  }
  rows.forEach(function(r){
    var row=el('div','');row.style.cssText='display:flex;align-items:center;gap:4px';
    var lab=el('label','');lab.style.cssText='display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 4px;cursor:'+(r.isExpr?'not-allowed':'pointer')+';color:'+(r.isExpr?'#5d6779':'#c7d2e2')+';flex:1';
    var cb=el('input','');cb.type='checkbox';cb.disabled=r.isExpr;
    cb.onchange=refreshCnt;
    lab.appendChild(cb);
    lab.appendChild(el('span','',r.cname+' '));
    var cmdS=el('span','','('+r.cmd+')');cmdS.style.cssText='color:#7a8597;font-size:10px';
    lab.appendChild(cmdS);
    var tag=el('span','libtag',r.isExpr?'表情·不录':'');tag.style.cssText='font-size:10px;color:'+(r.isExpr?'#5d6779':'#8fd9a0')+';margin-left:auto';
    lab.appendChild(tag);
    // GAMECLOCK：单条审核（per-clip）：这条命令重放+现采比对一次
    var bOne=el('button','btn','🔍');bOne.style.cssText='font-size:10px;padding:1px 5px';
    bOne.title='审核这条：在游戏里重放一次并比对库里录制数据的偏差（旧插件不支持会提示）';
    bOne.onclick=function(e){
      e.preventDefault();e.stopPropagation();
      if(_verRunning)return;
      verStart([{cmd:r.cmd,name:r.b}]);
    };
    row.appendChild(lab);row.appendChild(bOne);
    listBox.appendChild(row);boxes.push(cb);
  });
  bAll.onclick=function(){boxes.forEach(function(bx){if(!bx.disabled)bx.checked=true});refreshCnt()};
  bNone.onclick=function(){boxes.forEach(function(bx){bx.checked=false});refreshCnt()};
  bGo.onclick=function(){
    var items=[];
    boxes.forEach(function(bx,i){if(bx.checked&&!bx.disabled)items.push(rows[i])});
    if(!items.length){showToast('先勾选要录的动作');return}
    recStart('pick',items);
  };
}
// 无头验收/诊断钩子：录制会话内部状态
window.__recDebug=function(){return{running:_recRunning,cancel:_recCancel,session:_recState||recLoadSession(),counts:recCounts()}};

// ============ 动作审核（GAMECLOCK：录制动作 vs 游戏实放比对，TASK-20260831 AC-7） ============
// 入口：录制窗口「自选」清单里每行的「🔍 审核」（单条）与「🔍 审核所选」（批量）。
// 每条 = POST /export/verify：插件把这条命令重放一次、现采骨骼帧与库里同名 clip 比对，
// 返回 {verdict, aggregate, maxRotDelta, hotspots,...}——网页只展示，不改任何 clip 数据。
// 安全边界与录制中心同源：玩家点一次跑一次、配对码头、姿态复位/持续打断节奏、取消即停。
var _verRunning=false,_verCancel=false,_verCancelSent=false,_verState=null,_verUi=null;
function verRequestCancel(){ // 可见停止键：本地停队列 + 通知插件立刻取消当前现采（幂等，只发一次）
  if(!_verRunning||_verCancelSent)return;
  _verCancel=true;_verCancelSent=true;verUpdateUI();
  ChoreoAPI.export.api('/export/batchcancel',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{}'}).catch(function(){});
}
function verRecStart(cmd){ // 浏览器侧发起：POST /export/verify（48795，私有写要配对码）
  // ARCH-2：状态/错误分类见 choreo-api.js 48795 高层 api——403 走 e.pairing，插件错误体在 e.body
  return ChoreoAPI.export.api('/export/verify',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({command:cmd})}).then(function(j){
    if(j&&j.ok===false)return{ok:false,err:j.error||'失败'};
    return{ok:true,report:j};
  }).catch(function(e){
    if(e&&e.pairing)return{ok:false,err:'pairing'};
    if(e&&e.status===404)return{ok:false,err:'noclip'};
    if(e&&e.status===409)return{ok:false,err:'busy'};
    if(e&&e.status===400)return{ok:false,err:(e.body&&e.body.message)||'命令不合格'};
    if(e&&e.status)return{ok:false,err:'HTTP '+e.status};
    return{ok:false,err:'net'};
  });
}
async function verRunLoop(){
  if(!_verState||_verRunning)return;
  var st=_verState,generation=_recordingGeneration,owner={},broke=false;_verLoopOwner=owner;
  function live(){return generation===_recordingGeneration&&_verLoopOwner===owner&&_verState===st}
  _verRunning=true;_verCancel=false;_verCancelSent=false;
  try{
    verUpdateUI();
    for(var i=0;i<st.items.length;i++){
      if(_verCancel||!live())break;
      var it=st.items[i];
      if(it.status!=='pending')continue;
      it.status='running';verUpdateUI();
      var r=await verRecStart(it.cmd);
      if(_verCancel||!live()){it.status='pending';verUpdateUI();break}
      if(r.err==='pairing'){it.status='pending';showToast('先完成网页配对再审核：游戏里输入 /choreo pair 查看配对码');break}
      if(r.err==='noclip'){it.status='fail';it.reason='动作库里没有这条的录制数据'}
      else if(r.err==='busy'){it.status='pending';showToast('插件忙（录制/批量/另一场审核进行中）——稍后再审');break}
      else if(r.err==='net'){it.status='pending';st.netErr=(st.netErr||0)+1;if(st.netErr>=3){showToast('游戏或插件连接断开，审核已暂停');break}await recSleep(2000);continue}
      else if(!r.ok){it.status='fail';it.reason=r.err;st.netErr=0}
      else{
        st.netErr=0;
        var rep=r.report;
        it.status=(rep.verdict==='match')?'pass':'fail';
        it.rot=rep.maxRotDelta;it.agg=rep.aggregate;
        it.bone=(rep.hotspots&&rep.hotspots[0])?rep.hotspots[0].bone:'';
        it.persistent=!!rep.persistent;it.reason='';
      }
      verUpdateUI();
      if(_verCancel||!live())break;
      if(i<st.items.length-1&&st.items.slice(i+1).some(function(x){return x.status==='pending'})){
        // 与录制同源的收尾节奏：持续类打断+等 4s，姿态类复位+等 4.5s，普通等 2.5s
        if(it.status==='pass'||it.status==='fail'){
          if(REC_POSTURE.indexOf(it.name)>=0){await recWalkreset();if(_verCancel||!live())break;await recSleep(4500)}
          else if(it.persistent){await recStopper();if(_verCancel||!live())break;await recSleep(4000)}
          else await recSleep(2500);
        }
      }
    }
  }catch(e){broke=true;if(live())showToast('审核出错了：'+((e&&e.message)||e)+'——已停下')}
  finally{
  if(_verLoopOwner===owner){
  var c=verCounts();
  if(live()&&!_verCancel&&!broke&&c.pend===0)showToast('审核完成：通过 '+c.pass+' 条'+(c.fail?('，偏差超标 '+c.fail+' 条'):''));
  _verRunning=false;_verLoopOwner=null;
  verUpdateUI();
  }
  }
}
function verCounts(){var pass=0,fail=0,pend=0;((_verState&&_verState.items)||[]).forEach(function(it){if(it.status==='pass')pass++;else if(it.status==='fail')fail++;else pend++});return{pass:pass,fail:fail,pend:pend}}
function verUpdateUI(){ // 审核进度行/结果列表（窗口可能已关，全部判空）
  var line=_verUi&&_verUi.verLine;if(!line||!document.body.contains(line))return;
  if(!_verState){line.textContent='';return}
  var c=verCounts(),done=c.pass+c.fail,cur='';
  _verState.items.forEach(function(it){if(it.status==='running')cur=it.name});
  line.textContent='审核中：完成 '+done+' 条（通过 '+c.pass+' · 超标 '+c.fail+' · 剩 '+c.pend+'）'
    +(cur?('　当前：'+cur):'');
  var list=_verUi.verList;if(list){
    list.innerHTML='';
    _verState.items.forEach(function(it){
      if(it.status!=='pass'&&it.status!=='fail')return;
      var row=el('div','');row.style.cssText='font-size:12px;padding:1px 0;color:'+(it.status==='pass'?'#8fd9a0':'#ff9b9b');
      row.textContent=(it.status==='pass'?'✓ ':'✗ ')+it.name
        +(it.status==='pass'?('　通过（最大旋转差 '+Number(it.rot||0).toFixed(3)+' rad）')
          :('　偏差超标：'+(it.bone?('最差骨 '+it.bone+'，'):'')+'最大旋转差 '+Number(it.rot||0).toFixed(3)+' rad'));
      list.appendChild(row);
    });
  }
  if(_verUi.verBtn){_verUi.verBtn.disabled=_verRunning;_verUi.verBtn.textContent=_verRunning?'审核中…':'🔍 审核所选'}
  if(_verUi.verStop){
    _verUi.verStop.style.display=_verRunning?'inline-block':'none';
    _verUi.verStop.disabled=_verCancelSent;
    _verUi.verStop.textContent=_verCancelSent?'正在停止…':'✋ 停止审核';
  }
}
function verStart(items){ // 批量审核入口（选中清单）；单条审核=同入口单元素
  if(window.__choreoGameControlLocked&&window.__choreoGameControlLocked()){showToast('请先停止双人演出再审核动作');return}
  if(_verRunning)return;
  if(!items||!items.length){showToast('先勾选要审核的动作');return}
  _verState={v:1,items:items.map(function(c){return{cmd:c.cmd,name:c.b,status:'pending'}}),netErr:0};
  verRunLoop();
}
// 无头验收/诊断钩子：审核会话内部状态
window.__verDebug=function(){return{running:_verRunning,cancel:_verCancel,cancelSent:_verCancelSent,state:_verState,counts:verCounts()}};

// P4-C：工具中心「录制」页与「高级工具」页的构建出口（纯视图，业务逻辑仍在上面各函数）
window.ChoreoRecordingUI={mountPanel:mountRecPanel,advTools:buildAdvToolButtons};
