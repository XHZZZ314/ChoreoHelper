// 主页体检界面：负责实时检查调度、结果弹窗和问题定位。
'use strict';
// ============ WP-4：编舞体检（UI 壳） ============
// 规则全在 web\choreo-check.js（ChoreoCheck.pure.check，纯函数、node 可测）；
// 这里只负责：打开弹窗 → 异步预取 ctx（资料库索引/骨架/插件握手）→ 展示红/黄/提示分组
// → 点问题条目跳到对应舞者和时间点。检查是手动触发（点按钮跑一次），不做实时监听。
function checkFindClip(id){
  var found=null;
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){
    d[k].forEach(function(c){if(c.id===id)found=c})})});
  store.globalLyrics.forEach(function(c){if(c.id===id)found=c});
  return found;
}
// ============ 🩺 实时体检（FIX-4 后续）：编辑后自动跑，问题动作条在时间轴上红/黄描边 ============
// 原则：①防抖 800ms——render() 每次都排一个定时器，编辑/拖动停稳后才真跑；②资料库索引和骨架
// 指纹缓存 30s（资料库变动会立刻作废）；③问题签名没变就不重绘（拖动/播放不被无谓打断，
// 也保证 render→check→render 不会死循环）；④提示级不描边（只有红/黄上色），完整列表看弹窗。
var _checkTimer=null,_checkSig='',_checkRunning=false;
var _libIdxCache=null,_libIdxAt=0,_skelInfoCache=null;
var _nsCtxCache=null,_nsCtxAt=0;
// CHARACTER-ASSETS-P4：逐档案命名空间数据（profileClipIndex/dancerBindings/profileMeta）——
// 体检的逐档案规则（缺录按舞者档案判定、missing-clip-ns 附显式复制入口）用它。
// 读不到 → null（规则静默回老口径，不误报）；与 _libIdxCache 同款 30s 缓存，
// 资料库变动（复制/导入/删除）后由调用处置空强刷
async function fetchNamespaceCtx(force){
  if(!window.ChoreoLibrary||!ChoreoLibrary.available()||typeof ChoreoLibrary.allClipIndex!=='function')return null;
  if(!force&&_nsCtxCache&&Date.now()-_nsCtxAt<30000)return _nsCtxCache;
  var r=await Promise.all([
    ChoreoLibrary.allClipIndex().catch(function(){return null}),
    ChoreoLibrary.listProfiles().catch(function(){return null}),
    ChoreoLibrary.getActiveProfile().catch(function(){return null})
  ]);
  var idx=r[0],profs=r[1]||[],act=r[2];
  var out=null;
  if(idx||profs.length){
    var clips={},meta={};
    profs.forEach(function(p){
      meta[p.id]={name:p.name||'',skeletonHash:p.skeletonHash||'',boneCount:p.boneCount||0};
      var m={};
      ((idx&&idx[p.id])||[]).forEach(function(row){
        m[row.name]={duration:row.duration||0,type:row.type||'once',skeletonHash:row.skeletonHash||''};
      });
      clips[p.id]=m; // 空档案也给空对象：规则把「无动作档案」当空命名空间，不误判成查不了
    });
    var bindings=null;
    var CE=window.ChoreoEdit;
    if(CE&&CE.pure&&typeof CE.pure.resolveBindings==='function'){
      bindings=CE.pure.resolveBindings(store.dancers,profs.map(function(p){return p.id}),act?act.id:null)
        .map(function(b){return b?b.profileId:null});
    }
    out={profileClipIndex:clips,dancerBindings:bindings,profileMeta:meta};
  }
  _nsCtxCache=out;_nsCtxAt=Date.now();
  return out;
}
function scheduleRealtimeCheck(){
  if(!window.ChoreoCheck)return;
  if(_checkTimer)clearTimeout(_checkTimer);
  _checkTimer=setTimeout(runRealtimeCheck,800);
}
async function runRealtimeCheck(){
  _checkTimer=null;
  if(_checkRunning||!window.ChoreoCheck||!store.appReady)return;
  if(store._clipDragActive)return; // WEB-RACE：拖动中不跑检查（applyCheckIssues 会整页重建 DOM 打断拖动），收尾 render 会排最终检查
  _checkRunning=true;
  try{
    var libIdx=null,skelInfo=null;
    if(window.ChoreoLibrary&&ChoreoLibrary.available()){
      if(!_libIdxCache||Date.now()-_libIdxAt>30000){
        _libIdxCache=await ChoreoLibrary.clipIndex().catch(function(){return null});
        _libIdxAt=Date.now();
      }
      libIdx=_libIdxCache;
      if(!_skelInfoCache)skelInfo=_skelInfoCache=await ChoreoLibrary.getSkeletonInfo().catch(function(){return null});
      else skelInfo=_skelInfoCache;
    }
    var nsCtx=await fetchNamespaceCtx(false);
    var ctx={
      libraryIndex:libIdx, hasSkeleton:!!skelInfo, skeletonHash:skelInfo?skelInfo.hash:null,
      profileClipIndex:nsCtx?nsCtx.profileClipIndex:null,
      dancerBindings:nsCtx?nsCtx.dancerBindings:null,
      profileMeta:nsCtx?nsCtx.profileMeta:null,
      onlineSkeletonHash:null, measuredDur:store.measuredDur, jobMap:store.jobMap,
      capsOk:store.capsOk, pluginProbed:!!store.gameConnected, pluginCaps:store.pluginCaps,
      protocolVersion:typeof CHOREO_PROTOCOL!=='undefined'?CHOREO_PROTOCOL:1,
      showLyricMacro:store.showLyricMacro, totalDuration:store.totalDuration,
    };
    var issues=ChoreoCheck.pure.check({dancers:store.dancers,globalLyrics:store.globalLyrics,markers:store.markers},ctx);
    applyCheckIssues(issues);
  }catch(e){/* 实时体检失败静默：下下一次编辑会再试，不弹窗打扰 */}
  _checkRunning=false;
}
// 把体检结果落进 store 并决定要不要重绘。issues 为空=全清（描边全部摘掉）
function applyCheckIssues(issues){
  if(store._clipDragActive)return; // WEB-RACE：拖动开始前发起的检查最迟此刻才回来——结果作废，最终检查由拖动收尾 render 补跑
  if(!issues)issues=[];
  store.checkIssues=issues;
  var lv={},sig=[];
  issues.forEach(function(it){
    if(it.clipId&&(it.level==='red'||it.level==='yellow')){
      if(!lv[it.clipId]||it.level==='red')lv[it.clipId]=it.level;
    }
    if(it.pid&&(it.level==='red'||it.level==='yellow')){
      if(!lv[it.pid]||it.level==='red')lv[it.pid]=it.level; // 冲突对方条同样描边（两条都看得见）
    }
    sig.push((it.level||'?')[0]+':'+(it.clipId||'')+':'+(it.pid||'')+':'+it.rule+':'+Math.round((it.t||0)*10));
  });
  store.checkLevel=lv;
  var s=sig.join('|');
  if(s===_checkSig){updateCheckBadge();return} // 没变化：只刷徽标，不重绘
  _checkSig=s;
  updateCheckBadge();
  if(store.appReady)render();
}
// 工具栏体检按钮上的红/黄计数徽标（render 每次重建按钮，所以 render 末尾也会调它）
function updateCheckBadge(){
  var b=document.getElementById('btnCheck');
  if(!b)return;
  var old=b.querySelector('.chk-badge');if(old)old.remove();
  var nR=0,nY=0;
  (store.checkIssues||[]).forEach(function(it){if(it.level==='red')nR++;else if(it.level==='yellow')nY++});
  if(nR||nY){
    var sp=document.createElement('span');sp.className='chk-badge';
    sp.style.color=nR?'#ff6b6b':'#e8c57a';
    sp.textContent=(nR?('红'+nR):'')+((nR&&nY)?' ':'')+(nY?('黄'+nY):'');
    b.appendChild(sp);
  }
}

// 复用项目资源报告和现有音乐状态，只提供提醒与玩家选择，不设检查准入门槛。
function addRehearsalReminder(modal,current,close){
  if(store.previewTarget==='game')return;
  var box=el('div','');box.id='rehearsalReminder';box.style.cssText='border:1px solid #46556b;padding:8px;margin-bottom:10px;font-size:12px;line-height:1.6';
  box.appendChild(el('b','','网页排练准备 · 仅提醒'));
  box.appendChild(el('div','','检查不会阻止排练。缺少人物或动作时，网页可能显示替身或无法还原对应动作；是否继续由你决定。'));
  var music=el('div','');music.id='rehearsalMusicStatus';box.appendChild(music);
  var resources=el('div','');resources.id='rehearsalResources';resources.style.cssText='white-space:pre-wrap;max-height:130px;overflow:auto;color:#aab6c8;margin:6px 0';box.appendChild(resources);
  var controls=el('div','');controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
  var pick=el('button','btn','选择原歌曲');pick.id='rehearsalChooseFile';
  var library=el('button','btn','本地资料库');library.id='rehearsalOpenLibrary';
  var go=el('button','btn primary','仍然网页排练');go.id='rehearsalContinue';
  var dismiss=el('button','btn','关闭提醒');dismiss.id='rehearsalClose';
  [pick,library,go,dismiss].forEach(function(b){controls.appendChild(b)});box.appendChild(controls);modal.insertBefore(box,modal.children[1]||null);
  function state(){return window.ChoreoMusicUI?ChoreoMusicUI.rehearsalStatus():{attached:false,hasReference:!!(store.contentExtra&&store.contentExtra.music&&store.contentExtra.music.ref),selecting:false,withoutMusic:false}}
  function update(){
    if(!current()||store.previewTarget==='game'){
      music.textContent='项目或编排已变更，请关闭后重新查看当前项目提醒。';[pick,library,go].forEach(function(b){b.disabled=true});return;
    }
    var s=state();
    music.textContent=s.withoutMusic?'本次已选择无音乐排练，原歌曲引用保留。':s.selecting?'歌曲正在核对；也可以明确选择本次无音乐排练。':s.attached?'原歌曲已选择并验证，将使用现有音频时间参考。':s.hasReference?'原歌曲尚未重新选择。可选择原歌曲，或明确选择本次无音乐排练；原引用会保留。':'本项目没有歌曲引用，可直接无音乐网页排练。';
    go.textContent=s.withoutMusic||(s.hasReference&&(!s.attached||s.selecting))?'仍然无音乐排练':'仍然网页排练';
  }
  pick.onclick=function(){if(!current()||store.previewTarget==='game')return;close();if(window.ChoreoMusicUI)ChoreoMusicUI.chooseFile()};
  library.onclick=function(){if(!current()||store.previewTarget==='game')return;close();showLibraryModal()};
  go.onclick=function(){
    if(!current()||store.previewTarget==='game')return;
    var s=state();close();
    if(s.hasReference&&(!s.attached||s.selecting)&&window.ChoreoMusicUI)ChoreoMusicUI.rehearseWithoutMusic();
    else startPlay();
  };
  dismiss.onclick=close;
  if(window.projectResourceReport)projectResourceReport(resources,{includeMusic:false});
  else resources.textContent='本地人物和动作引用尚未核实；仍可自行决定排练。';
  update();
  var timer=setInterval(function(){if(!box.isConnected){clearInterval(timer);return}update()},250);
}
function showCheckModal(){
  var pid=store.projectId,extra=store.contentExtra,rev=store._docRev,op=_projectOperation;
  var bd=el('div','modal-bg');
  var m=el('div','modal');m.style.minWidth='560px';m.style.maxHeight='85vh';m.style.overflowY='auto';
  m.innerHTML='<h3>🩺 编舞体检</h3>';
  var info=el('div','');info.style.cssText='font-size:12px;line-height:1.7;color:#aab6c8;margin-bottom:8px';
  var list=el('div','');list.style.cssText='max-height:55vh;overflow-y:auto;font-size:12px;line-height:1.5';
  m.appendChild(info);m.appendChild(list);
  function current(){return bd.isConnected&&store.projectId===pid&&store.contentExtra===extra&&store._docRev===rev&&currentProjectOperation(op)}
  function close(){if(bd.parentNode)bd.parentNode.removeChild(bd)}
  bd.onclick=function(e){if(e.target===bd)close()};
  bd.appendChild(m);document.body.appendChild(bd);
  addRehearsalReminder(m,current,close);

  // 点击问题条目：关弹窗 → 播放头跳到 t → 有 clip 就选中高亮 → 时间轴滚动到该时刻居中。
  // render() 会整树重建，所以滚动/播放头更新都放在 render 之后对新 DOM 做（v0.6.6 的老坑）
  function jumpTo(it){
    if(!current())return;
    close();
    if(store.isPlaying)stopPlay();
    store.currentTime=Math.max(0,it.t||0);
    var clip=it.clipId?checkFindClip(it.clipId):null;
    if(clip)selectClipOnly(clip);else{store.selectedClip=null}
    render();
    var w=document.getElementById('timelineWrap');
    if(w)w.scrollLeft=Math.max(0,LABEL_W+store.currentTime*store.pps-w.clientWidth/2);
    updatePlayhead();updateTimeDisplay();sendSeek(store.currentTime);
  }

  var LEV={red:{label:store.previewTarget==='game'?'红 · 放不了/会出事':'红 · 重点提醒（不阻止网页排练）',color:'#ff6b6b'},yellow:{label:'黄 · 建议处理',color:'#e8c57a'},info:{label:'提示 · 知道就行',color:'#8fa3bf'}};
  function renderResults(issues){
    if(!issues){info.textContent='体检模块（choreo-check.js）没加载出来，刷新页面试试';return}
    var nRed=issues.filter(function(i){return i.level==='red'}).length;
    var nYel=issues.filter(function(i){return i.level==='yellow'}).length;
    var nInf=issues.filter(function(i){return i.level==='info'}).length;
    info.textContent=(issues.length===0)
      ?'检查完成：没发现问题，可以放心排练/导出 ✓'
      :'检查完成：红 '+nRed+' · 黄 '+nYel+' · 提示 '+nInf+'（点条目跳到对应位置）';
    list.innerHTML='';
    ['red','yellow','info'].forEach(function(lv){
      var items=issues.filter(function(i){return i.level===lv});
      if(!items.length)return;
      var hd=el('div','');hd.style.cssText='font-weight:bold;margin:8px 0 4px;color:'+LEV[lv].color;
      hd.textContent=LEV[lv].label+'（'+items.length+'）';list.appendChild(hd);
      items.forEach(function(it){
        var row=el('div','');row.style.cssText='border-left:3px solid '+LEV[lv].color+';padding:4px 8px;margin:3px 0;background:#1a2230;border-radius:0 4px 4px 0;cursor:pointer;display:flex;align-items:center;gap:2px';
        var where=(it.di>=0?('舞者'+(it.di+1)+' '):'全局 ')+(it.t>0?('@ '+it.t.toFixed(1)+'s'):'');
        // AUD-002：体检消息里含动作名/命令等用户内容，按文本节点拼装
        var msg=el('span','');msg.style.flex='1';
        var wEl=el('span','',where);wEl.style.color='#6b7a90';
        msg.appendChild(wEl);
        msg.appendChild(document.createTextNode('\u3000'+it.message));
        row.appendChild(msg);
        // CHARACTER-ASSETS-P4（AC-3）：动作只在别的档案命名空间 → 唯一跨档案通道：
        // 一次显式按舞者复制（确认弹窗 → ChoreoLibrary.copyClipToProfile；取消零写入）
        if(it.rule==='missing-clip-ns'&&it.copyFrom&&it.copyTo&&it.clipName&&window.ChoreoLibrary&&ChoreoLibrary.available()){
          var bCp=el('button','btn','复制动作');bCp.style.cssText='font-size:11px;padding:1px 8px;flex:none';
          bCp.title='把这条动作从档案「'+(it.copyFromName||'')+'」复制进舞者'+(it.di+1)+'绑定的档案「'+(it.copyToName||'')+'」：内容原样、指纹按他的档案重新盖章；原档案数据不动';
          bCp.onclick=function(ev){
            ev.stopPropagation(); // 别触发行的「跳到时间点」
            if(!current())return;
            var okGo=confirm('把动作「'+it.clipName+'」复制进舞者'+(it.di+1)+'绑定的档案「'+(it.copyToName||'')+'」？\n（从档案「'+(it.copyFromName||'')+'」复制，内容原样、指纹按目标档案重新盖章；原档案数据不动）');
            if(!okGo)return; // 取消=零写入
            bCp.disabled=true;bCp.textContent='复制中…';
            ChoreoLibrary.copyClipToProfile(it.clipName,it.copyFrom,it.copyTo).then(function(){
              showToast('已把「'+it.clipName+'」复制进档案「'+(it.copyToName||'')+'」');
              _libIdxCache=null;_nsCtxCache=null;
              if(window.__p3dLibChanged)__p3dLibChanged(); // 命名空间补上了：预览整体重建，舞者换回自己的模型
              scheduleRealtimeCheck();
              try{document.body.removeChild(bd)}catch(e2){}
              showCheckModal(); // 重跑体检：该条从报告消失
            }).catch(function(e){showToast('复制失败：'+e.message);bCp.disabled=false;bCp.textContent='复制动作'});
          };
          row.appendChild(bCp);
        }
        row.title='点击跳到这个位置';
        row.onclick=function(){jumpTo(it)};
        list.appendChild(row);
      });
    });
    if(!list.children.length){
      var okRow=el('div','');okRow.style.cssText='color:#7dc98f;padding:8px 0';
      okRow.textContent='✓ 时间轴、资料库和插件能力都没查出问题';
      list.appendChild(okRow);
    }
  }

  // 异步预取 ctx 再跑规则（资料库/骨架查不到就如实降级，不让整次体检挂掉）
  (async function(){
    info.textContent='正在检查…';
    try{
      var libIdx=null,skelInfo=null;
      if(window.ChoreoLibrary&&ChoreoLibrary.available()){
        libIdx=await ChoreoLibrary.clipIndex().catch(function(){return null});
        skelInfo=await ChoreoLibrary.getSkeletonInfo().catch(function(){return null});
      }
      var onlineHash=null;
      if(!current())return;
      // 骨架指纹比对只在插件在线时做：在线骨架算同一把 hash 和资料库比
      if(store.gameConnected&&store.capsOk&&skelInfo&&window.ChoreoLibrary&&ChoreoLibrary.available()){
        try{
          // AUD3-W4（FIX-H）：/export/skeleton 只挂在 48795 导出服务，apiFetch(48794) 必 404，
          // 在线骨架比对从未生效过——现走 choreo-api.js 48795 客户端。SEC-1：骨架是私有读，
          // 配对码头归 48795 高层 api；拉不到（离线/未配对/坏体）就跳过比对，不报假问题
          var sk=await ChoreoAPI.export.api('/export/skeleton',{timeoutMs:4000});
          if(sk&&sk.bones&&sk.count)onlineHash=await ChoreoLibrary.hashObject(sk)
        }catch(e){/* 拉不到就跳过比对，不报假问题 */}
      }
      var nsCtx=await fetchNamespaceCtx(true); // 手动体检：逐档案数据强制现读
      if(!current())return;
      var ctx={
        libraryIndex:libIdx, hasSkeleton:!!skelInfo, skeletonHash:skelInfo?skelInfo.hash:null,
        profileClipIndex:nsCtx?nsCtx.profileClipIndex:null,
        dancerBindings:nsCtx?nsCtx.dancerBindings:null,
        profileMeta:nsCtx?nsCtx.profileMeta:null,
        onlineSkeletonHash:onlineHash, measuredDur:store.measuredDur, jobMap:store.jobMap,
        capsOk:store.capsOk, pluginProbed:!!store.gameConnected, pluginCaps:store.pluginCaps,
        protocolVersion:typeof CHOREO_PROTOCOL!=='undefined'?CHOREO_PROTOCOL:1,
        showLyricMacro:store.showLyricMacro,
        totalDuration:store.totalDuration,
      };
      var issues=null;
      if(window.ChoreoCheck)issues=ChoreoCheck.pure.check({dancers:store.dancers,globalLyrics:store.globalLyrics,markers:store.markers},ctx);
      applyCheckIssues(issues); // 弹窗结果与时间轴描边/徽标同步（手动体检强制刷新过 ctx，以它为准）
      renderResults(issues);
    }catch(e){if(current())info.textContent='体检失败：'+e.message+'；提醒不影响你自行决定网页排练。'}
  })();
}
// 无头验收钩子：不弹窗直接跑一次体检，返回问题列表（供自动验收/诊断用）
window.__checkRun=async function(){
  var libIdx=null,skelInfo=null;
  if(window.ChoreoLibrary&&ChoreoLibrary.available()){
    libIdx=await ChoreoLibrary.clipIndex().catch(function(){return null});
    skelInfo=await ChoreoLibrary.getSkeletonInfo().catch(function(){return null});
  }
  var nsCtx=await fetchNamespaceCtx(true);
  var ctx={
    libraryIndex:libIdx, hasSkeleton:!!skelInfo, skeletonHash:skelInfo?skelInfo.hash:null,
    profileClipIndex:nsCtx?nsCtx.profileClipIndex:null,
    dancerBindings:nsCtx?nsCtx.dancerBindings:null,
    profileMeta:nsCtx?nsCtx.profileMeta:null,
    onlineSkeletonHash:null, measuredDur:store.measuredDur, jobMap:store.jobMap,
    capsOk:store.capsOk, pluginProbed:!!store.gameConnected, pluginCaps:store.pluginCaps,
    protocolVersion:typeof CHOREO_PROTOCOL!=='undefined'?CHOREO_PROTOCOL:1,
    showLyricMacro:store.showLyricMacro,
    totalDuration:store.totalDuration,
  };
  if(!window.ChoreoCheck)return null;
  var _issues=ChoreoCheck.pure.check({dancers:store.dancers,globalLyrics:store.globalLyrics,markers:store.markers},ctx);
  applyCheckIssues(_issues); // 无头验收：与时间轴描边同步（clip-check 断言 issue-red/issue-yellow 类）
  return _issues;
};
// 无头验收/诊断钩子：名字列表省略=插件里全部；onProgress 可选（阶段4起导入统一过静止质检，坏文件不进库）
window.__libImportFromPlugin=function(names,onProgress){
  return ChoreoLibrary.syncFromPlugin({names:names||null,onProgress:onProgress,qcFn:recLibQc,shouldCancel:function(){return _libCancel}});
};
