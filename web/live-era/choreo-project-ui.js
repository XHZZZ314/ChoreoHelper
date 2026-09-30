// 主页项目界面：负责项目列表、版本快照与恢复交互。
'use strict';
var _projectOperation = 0;
function beginProjectOperation(){return ++_projectOperation}
function currentProjectOperation(op){return op === _projectOperation}
// ============ 📁 项目中心（WP-3：多项目管理，存储层在 choreo-projects.js） ============
function newProject(name){
  var op=beginProjectOperation();
  persistProject();
  var content={dancers:[makeDancer(0)],globalLyrics:[],dancerCount:1,showLyricMacro:false,totalDuration:300,markers:[]};
  return ChoreoProjects.createProject(name,content).then(function(rec){
    return switchToRecord(rec,op);
  });
}
function switchProject(id){
  var op=beginProjectOperation();
  persistProject(); // 先把当前项目落盘再走
  return ChoreoProjects.openProject(id).then(function(opened){
    return switchToRecord(opened.record,op);
  });
}
function switchToRecord(rec,op){
  if(op===undefined)op=beginProjectOperation();
  if(!currentProjectOperation(op))return Promise.resolve(null);
  var loaded=ChoreoDocWire.loadProjection(rec.content||{}); // 校验先完成，失败不得改身份或停止播放。
  if(loaded.warning)throw new Error(loaded.warning+'；原记录保留');
  ChoreoProjects.setActiveId(rec.id);
  stopPlay(); // 播放头归零（游戏模式顺带发停止）；3D 面板每帧只读 store，自然跟过来
  store.history=[];store.historyIdx=-1; // 撤销栈是会话性的，换项目清空（避免撤销串台到别的项目）
  store.loopA=store.loopB=null; // WP-3b：循环区间跟着旧时间轴，换项目作废
  store.projectId=rec.id;store.projectName=rec.name||'我的编舞';store.projectCreatedAt=rec.createdAt||Date.now();
  applyProjectContent(rec.content||{});
  clearClipSelection();
  _lastSnapAt=Date.now();try{_lastSnapJson=JSON.stringify(projectRecord().content)}catch(e){} // 换项目后重新定快照基线（WP-5-WIRE：按迁移后的文档形态定，旧记录首轮不误存迁移版本）
  saveHistory();updateTotalDuration();render();
  return Promise.resolve(rec); // 把 rec 传回去，调用方（新建/切换/恢复）能拿到结果
}
function manualSnapshot(label){
  label=String(label||'').trim()||'手动保存';
  if(label.length>120)return Promise.reject(new Error('版本备注最多 120 个字符'));
  var rec=projectRecord(),op=_projectOperation,started=Date.now();
  var json=JSON.stringify(rec.content),content=JSON.parse(json); // 点击时定稿，后续编辑不进入此版本。
  return ChoreoProjects.addVersion(rec.id,label,content,false).then(function(saved){
    if(!saved)throw new Error('未能确认版本完整保存，请检查本地存储后重试；已写入的版本可能仍在历史列表中');
    if(currentProjectOperation(op)&&store.projectId===rec.id&&_lastSnapAt<=started){
      _lastSnapAt=started;_lastSnapJson=json;
    }
    return true;
  });
}
function restoreProjectVersion(savedAt){
  var op=beginProjectOperation();
  var rec=projectRecord();
  return ChoreoProjects.addVersion(rec.id,'恢复版本前自动保存',rec.content,false) // 先给当前内容存档，恢复错了也能回来
    .then(function(){return ChoreoProjects.getVersion(rec.id,savedAt)})
    .then(function(v){
      if(!v||!v.content)throw new Error('版本数据读不到');
      return switchToRecord({id:rec.id,name:rec.name,createdAt:rec.createdAt,content:v.content},op);
    });
}
// 历史版本另存为独立项目：校验后才创建，不切换、不改原记录或原历史。
function copyProjectVersion(projectId,savedAt,name,isCurrent){
  if(!isCurrent())return Promise.resolve(null);
  return ChoreoProjects.getVersion(projectId,savedAt).then(function(v){
    if(!isCurrent())return null;
    if(!v||!v.content||v.projectId!==projectId||v.savedAt!==savedAt)throw new Error('版本数据读不到或身份不一致');
    var loaded=ChoreoDocWire.importProjection(v.content,sanitizeImportProject);
    var doc=JSON.parse(JSON.stringify(loaded.doc));
    doc.name=name;
    return ChoreoProjects.createImportedProject(doc);
  });
}
// 文件选择与读取共享项目代际；旧文件/旧打开结果不得接管后来的项目。
function readProjectFile(file,op){
  if(!file||!currentProjectOperation(op))return;
  var reader=new FileReader();
  reader.onload=function(){
    if(!currentProjectOperation(op))return;
    try{Promise.resolve(importProject(JSON.parse(reader.result),op)).catch(failed)}catch(e){failed(e)}
  };
  function failed(e){if(currentProjectOperation(op))showToast('导入失败：'+e.message+'。原项目保留。')}
  reader.onerror=function(){failed(new Error('文件读取失败'))};
  reader.onabort=function(){};
  reader.readAsText(file);
}
function importProject(data,op){
  if(op===undefined)op=beginProjectOperation();
  if(!currentProjectOperation(op))return Promise.resolve(null);
  var w=ChoreoDocWire.importProjection(data,sanitizeImportProject);
  return ChoreoProjects.createImportedProject(w.doc).then(function(rec){
    if(!currentProjectOperation(op))return rec; // 已提交的独立副本留在项目中心，绝不切换当前项。
    persistProject();
    return switchToRecord(rec,op).then(function(){
      showToast('已保存为独立项目「'+rec.name+'」。原项目保留；人物、动作和歌曲文件未包含，请查看项目中心的资源说明。');
      showProjectModal();return rec;
    });
  });
}
// 只读本机资料清单，不导入资产、不猜测绑定；迟到报告只写回自己的弹窗。
function projectResourceReport(target,options){
  var dancers=JSON.parse(JSON.stringify(store.dancers)),extra=store.contentExtra;
  var op=_projectOperation,pid=store.projectId,rev=store._docRev;
  function current(){return target.isConnected&&currentProjectOperation(op)&&store.projectId===pid&&store.contentExtra===extra&&store._docRev===rev}
  target.textContent='正在核对本机人物和动作引用…';
  if(!window.ChoreoLibrary){target.textContent='本地资料库不可用，人物和动作引用尚未核实。';return}
  Promise.all([ChoreoLibrary.listProfiles(),ChoreoLibrary.allClipIndex()]).then(function(r){
    if(!current())return;
    var lines=[];
    dancers.forEach(function(d,i){
      var p=r[0].find(function(p){return p.id===d.profileId});
      var label=(d.name||('舞者 '+(i+1)))+'：';
      if(!d.profileId){lines.push(label+'未显式绑定人物，保留原设置；需要固定人物时请在舞者绑定处选择已有档案。');return}
      if(!p){lines.push(label+'缺少绑定的人物档案，请在本地资料库恢复原档案，或在舞者绑定处明确重新关联。');return}
      var own=r[1][p.id]||[];
      var missing=[],incompatible=[],elsewhere=[];
      (d.actionClips||[]).forEach(function(c){
        var cmd=c.data&&c.data.command;
        var name=cmd&&String(cmd).trim().replace(/^\//,'').replace(/\//g,'_');
        if(!name)return;
        var entry=own.find(function(x){return x.name===name});
        if(!entry&&missing.indexOf(name)<0){missing.push(name);if(Object.keys(r[1]).some(function(id){return id!==p.id&&(r[1][id]||[]).some(function(x){return x.name===name})}))elsewhere.push(name)}
        if(entry&&entry.skeletonHash&&entry.skeletonHash!==p.skeletonHash&&incompatible.indexOf(name)<0)incompatible.push(name);
      });
      lines.push(label+'复用「'+p.name+'」；'+(p.modelNames.length?'模型文件在本机':'缺少模型文件')+'，'+(p.hasSkeleton?'骨架在本机':'缺少骨架')+'。'+(missing.length?'缺少动作：'+missing.join('、')+'；请恢复到该档案，再运行编舞体检核对兼容性。':'所引用动作在本机；兼容性请运行编舞体检。')+(elsewhere.length?' 其他档案有同名动作（'+elsewhere.join('、')+'），不会借用。':'')+(incompatible.length?' 骨架不兼容：'+incompatible.join('、')+'；不会套用，请恢复该人物兼容的原动作。':'')+' 档案标识：'+p.id+'。');
    });
    var music=extra&&extra.music;
    if(!options||options.includeMusic!==false)lines.push(music&&music.ref?'音乐仅保留引用'+(music.ref.name?'「'+music.ref.name+'」':'')+'，未包含歌曲文件；请在音乐面板重新选择原歌曲并核对指纹。':'此项目没有已保存的歌曲引用；项目文件不包含音频。');
    target.textContent=lines.join('\n');
  }).catch(function(){if(current())target.textContent='本地资源清单读取失败，资源尚未核实；编排和引用仍然保留。'});
}
function showProjectModal(){
  if(!window.ChoreoProjects){showToast('项目模块没加载');return}
  if(ChoreoProjects.isDegraded()){showToast('浏览器的本地项目库打不开（可能是隐私模式）——当前只能用自动保存的这一份');return}
  var bd=el('div','modal-bg');bd.style.zIndex='600'; // 高于浮动 3D 预览，低于立即停止栏。
  var m=el('div','modal');m.style.minWidth='560px';
  m.innerHTML='<h3>\uD83D\uDCC1 项目中心</h3>';
  var tip=el('div','');tip.style.cssText='font-size:12px;color:#aab6c8;margin-bottom:8px;line-height:1.6';
  tip.textContent='编舞按项目分开自动保存，不用手动存。项目文件包含当前编排、原词、宏草稿、绑定与音乐引用及设置，不含历史版本、人物/动作资产或歌曲文件。已有本地资料按原绑定复用；缺失时在「本地资料库」恢复对应人物/动作，在舞者绑定处重新关联；音乐面板重新选择原歌曲并核对指纹。未指定人物绑定时不会猜测人物身份。删除项目不可恢复。';
  m.appendChild(tip);
  var resources=el('div','');resources.style.cssText='font-size:12px;white-space:pre-wrap;line-height:1.6;margin-bottom:10px';
  m.appendChild(resources);
  var row=el('div','');row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
  var bNew=el('button','btn primary','\u2795 新建项目');
  var bSnap=el('button','btn','\uD83D\uDCBE 给当前项目存个版本');
  bSnap.title='把当前内容存成一个历史版本，以后可以在下面「历史版本」里回到这个时刻';
  row.appendChild(bNew);row.appendChild(bSnap);
  m.appendChild(row);
  var snapRow=el('div','');snapRow.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px';
  var snapLabel=el('input','');snapLabel.id='projectVersionLabel';snapLabel.type='text';snapLabel.maxLength=120;
  snapLabel.placeholder='版本备注（可选），如：副歌改前、第二次排练';snapLabel.setAttribute('aria-label','版本备注（可选，最多 120 个字符）');
  snapLabel.style.cssText='flex:1;min-width:220px';
  var snapStatus=el('span','');snapStatus.id='projectVersionStatus';snapStatus.setAttribute('role','status');
  snapStatus.style.cssText='font-size:12px;color:#aab6c8;overflow-wrap:anywhere';
  snapRow.appendChild(snapLabel);snapRow.appendChild(snapStatus);m.appendChild(snapRow);
  var searchRow=el('div','');searchRow.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px';
  var search=el('input','');search.type='search';search.id='projectSearch';search.placeholder='按项目名称搜索';
  search.setAttribute('aria-label','按项目名称搜索');search.style.cssText='flex:1;min-width:160px';
  var clearSearch=el('button','btn','清空搜索');clearSearch.id='projectSearchClear';clearSearch.disabled=true;
  var searchCount=el('span','');searchCount.id='projectSearchCount';searchCount.setAttribute('role','status');
  searchCount.style.cssText='font-size:12px;color:#aab6c8';
  searchRow.appendChild(search);searchRow.appendChild(clearSearch);searchRow.appendChild(searchCount);m.appendChild(searchRow);
  var projectList=[],listReady=false,listRequest=0,versionRequest=0;
  search.oninput=function(){clearSearch.disabled=!search.value;if(listReady)renderList()};
  clearSearch.onclick=function(){search.value='';search.oninput();search.focus()};
  var listWrap=el('div','');listWrap.style.cssText='max-height:260px;overflow:auto;border:1px solid #252e3c;border-radius:6px';
  m.appendChild(listWrap);
  var verWrap=el('div','');verWrap.style.cssText='margin-top:10px;display:none';
  m.appendChild(verWrap);
  bd.onclick=function(ev){if(ev.target===bd)document.body.removeChild(bd)};
  bd.appendChild(m);document.body.appendChild(bd);
  projectResourceReport(resources);
  function close(){if(bd.parentNode)document.body.removeChild(bd)}
  function fmtT(ms){var d=new Date(ms);return (d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
  function refresh(){
    var request=++listRequest;
    listReady=false;searchCount.textContent='正在读取项目…';
    ChoreoProjects.listProjects().then(function(list){
      if(!bd.isConnected||request!==listRequest)return;
      projectList=list;listReady=true;renderList();
    }).catch(function(e){
      if(!bd.isConnected||request!==listRequest)return;
      searchCount.textContent='项目尚未读取';listWrap.textContent='读取失败：'+e.message;
    });
  }
  function renderList(){
      var query=search.value.trim().toLowerCase();
      var list=projectList.filter(function(p){return (p.name||'未命名').toLowerCase().indexOf(query)>=0});
      searchCount.textContent=query?'找到 '+list.length+' / '+projectList.length+' 个项目':'共 '+projectList.length+' 个项目';
      listWrap.innerHTML='';
      if(!list.length){var e0=el('div','',query?'没有匹配的项目，请换个名称片段或清空搜索。':'还没有项目');e0.style.padding='10px';listWrap.appendChild(e0)}
      list.forEach(function(p){
        var cur=p.id===store.projectId;
        var rp=el('div','');rp.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #1c2430'+(cur?';background:#16202e':'');
        var nm=el('div','');nm.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        var bN=el('b','');bN.textContent=p.name||'未命名';bN.title=bN.textContent;if(cur)bN.style.color='#7eb3ff';
        nm.appendChild(bN);
        var meta=el('span','',fmtT(p.updatedAt)+' · 约 '+fmtMB(p.size||0));meta.style.cssText='color:#66788f;font-size:11px;margin-left:8px';
        nm.appendChild(meta);
        if(cur){var tag=el('span','当前');tag.style.cssText='color:#5dde8e;font-size:11px;margin-left:8px';nm.appendChild(tag)}
        rp.appendChild(nm);
        function bb(txt,fn,danger){var b=el('button','btn'+(danger?' danger':''),txt);b.style.fontSize='10px';b.style.padding='2px 6px';b.onclick=fn;rp.appendChild(b);return b}
        if(!cur)bb('打开',function(){switchProject(p.id).then(close).catch(function(e){showToast('打开失败：'+e.message)})});
        bb('改名',function(){
          var nm2=prompt('改成什么名字？',p.name||'');
          if(nm2===null)return;nm2=nm2.trim();if(!nm2||nm2===p.name)return;
          ChoreoProjects.renameProject(p.id,nm2).then(function(){if(p.id===store.projectId)store.projectName=nm2;refresh();showToast('已改名')}).catch(function(e){showToast('改名失败：'+e.message)});
        });
        bb('复制',function(){ChoreoProjects.duplicateProject(p.id).then(function(){refresh();showToast('已复制一份')}).catch(function(e){showToast('复制失败：'+e.message)})});
        bb('删除',function(){
          ChoreoProjects.listProjects().then(function(all){
            if(all.length<=1){showToast('至少要留一个项目');return}
            if(!confirm('确定删除项目「'+(p.name||'未命名')+'」？删了就找不回来了（可以先「导出」留个文件）。'))return;
            var del=ChoreoProjects.deleteProject(p.id);
            if(cur){
              // AUD-006：删当前项目前先切到最近编辑的其他项目——store.projectId 不再指着被删项目，
              // 之后的自动保存就不会把它 put 回来（复活）；存储层另有 tombstone 双保险
              var others=all.filter(function(q){return q.id!==p.id})
                .sort(function(a,b){return (b.updatedAt||0)-(a.updatedAt||0)});
              del=switchProject(others[0].id).then(function(){return ChoreoProjects.deleteProject(p.id)});
            }
            del.then(function(){refresh();showToast('已删除')}).catch(function(e){showToast('删除失败：'+e.message)});
          });
        },true);
        listWrap.appendChild(rp);
      });
  }
  function refreshVersions(){
    var request=++versionRequest,pid=store.projectId,name=store.projectName,op=_projectOperation;
    function current(){return bd.isConnected&&request===versionRequest&&pid===store.projectId&&currentProjectOperation(op)}
    verWrap.style.display='block';verWrap.textContent='正在读取当前项目的历史版本…';
    ChoreoProjects.listVersions(pid).then(function(vs){
      if(!current())return;
      verWrap.style.display='block';
      verWrap.innerHTML='<div style="font-size:12px;color:#aab6c8;margin-bottom:6px">当前项目的历史版本（最多保留 20 个）。复制为新项目可单独排练旧编排，原项目及历史保留；歌曲仍需重选原文件。</div>';
      if(!vs.length){var e0=el('div','','还没有历史版本——编辑时每 5 分钟自动存一个，也可以点上面按钮手动存');e0.style.cssText='font-size:12px;padding:2px 10px';verWrap.appendChild(e0);return}
      vs.forEach(function(v){
        var vr=el('div','');vr.style.cssText='display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:12px';
        var vt=el('span','');vt.style.cssText='color:#aab6c8;overflow-wrap:anywhere;min-width:0';vt.textContent=fmtT(v.savedAt)+' · '+(v.label||'（无备注）')+' · 约 '+fmtMB(v.size);
        vr.appendChild(vt);
        var bRes=el('button','btn','恢复到此版本');bRes.style.fontSize='10px';bRes.style.padding='2px 6px';
        bRes.onclick=function(){
          if(!current())return;
          if(!confirm('恢复到这个版本？当前内容会先自动存成一个版本，恢复错了也能再回来。'))return;
          restoreProjectVersion(v.savedAt).then(function(){showToast('已恢复');close()}).catch(function(e){showToast('恢复失败：'+e.message)});
        };
        vr.appendChild(bRes);
        var bCopy=el('button','btn','复制为新项目');bCopy.style.cssText='font-size:10px;padding:2px 6px';
        var result=el('span','');result.setAttribute('role','status');
        var busy=false;
        bCopy.onclick=function(){
          if(busy||!current())return;
          busy=true;bCopy.disabled=true;result.textContent='正在保存独立副本…';
          copyProjectVersion(pid,v.savedAt,(name||'未命名')+' · 历史 '+fmtT(v.savedAt),current).then(function(rec){
            if(!rec||!current())return; // 已提交的副本保留，旧弹窗不得接管后来项目。
            result.textContent='已保存「'+rec.name+'」，原项目保留。';
            var bOpen=el('button','btn','打开副本');bOpen.style.cssText='font-size:10px;padding:2px 6px';
            bOpen.onclick=function(){
              if(!current())return;
              bOpen.disabled=true;
              var opening=switchProject(rec.id),openOp=_projectOperation;
              opening.then(function(opened){if(opened&&currentProjectOperation(openOp))close()}).catch(function(e){
                if(bd.isConnected&&currentProjectOperation(openOp)){result.textContent='打开失败：'+e.message+'；副本已保留在项目中心。';bOpen.disabled=false}
              });
            };
            result.appendChild(bOpen);refresh();
          }).catch(function(e){if(current())result.textContent='复制失败：'+e.message+'。原项目及历史版本保留。'})
            .finally(function(){if(current()){busy=false;bCopy.disabled=false}});
        };
        vr.style.flexWrap='wrap';vr.appendChild(bCopy);vr.appendChild(result);
        verWrap.appendChild(vr);
      });
    }).catch(function(e){if(current()){verWrap.style.display='block';verWrap.textContent='历史版本读取失败：'+e.message}});
  }
  bNew.onclick=function(){
    var nm=prompt('新项目叫什么名字？','我的新编舞');
    if(nm===null)return;nm=nm.trim();if(!nm)nm='新项目';
    newProject(nm).then(function(){
      snapProject=store.projectId;snapOperation=_projectOperation;snapBusy=false;
      snapLabel.value='';snapLabel.disabled=false;bSnap.disabled=false;snapStatus.textContent='';
      refresh();refreshVersions();showToast('已新建「'+nm+'」');
    }).catch(function(e){showToast('新建失败：'+e.message)});
  };
  var snapBusy=false,snapProject=store.projectId,snapOperation=_projectOperation;
  function currentSnapshot(){return bd.isConnected&&store.projectId===snapProject&&currentProjectOperation(snapOperation)}
  bSnap.onclick=function(){
    if(snapBusy||!currentSnapshot())return;
    var label=snapLabel.value.trim()||'手动保存',pid=snapProject,op=snapOperation;
    function current(){return bd.isConnected&&store.projectId===pid&&currentProjectOperation(op)}
    snapBusy=true;bSnap.disabled=true;snapLabel.disabled=true;snapStatus.textContent='正在保存当前编排版本…';
    var saving;
    try{saving=manualSnapshot(label)}catch(e){saving=Promise.reject(e)}
    Promise.resolve(saving).then(function(saved){
      if(!saved||!current())return;
      snapLabel.value='';snapStatus.textContent='已保存「'+label+'」。可在下方历史版本中查看。';refreshVersions();
    }).catch(function(e){
      if(current())snapStatus.textContent='保存失败：'+e.message+'。当前编排和备注保留。';
    }).finally(function(){if(current()){snapBusy=false;bSnap.disabled=false;snapLabel.disabled=false}});
  };
  refresh();refreshVersions();
}
// 无头验收钩子（library-verify.js proj 场景用）：绕过 UI 直接驱动项目层
window.__projTest={
  info:function(){var n=0;store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){n+=(d[k]||[]).length})});n+=store.globalLyrics.length;
    return {projectId:store.projectId,name:store.projectName,degraded:!!store.projectsDegraded,dancers:store.dancers.length,clips:n,history:store.history.length}},
  list:function(){return ChoreoProjects.listProjects()},
  versions:function(){return ChoreoProjects.listVersions(store.projectId)},
  seedFromDraft:function(d){ // 测试种子：把旧格式草稿造成项目（内容与迁移产物一致），sync/uicheck 等场景灌数据用
    var rec=ChoreoProjects.pure.legacyToProject(d);
    if(!rec)return Promise.reject(new Error('草稿无效'));
    return ChoreoProjects.createProject(rec.name,rec.content).then(function(r){ChoreoProjects.setActiveId(r.id);return r.id});
  },
  create:function(n){return newProject(n)},
  open:function(id){return switchProject(id)},
  rename:function(id,n){return ChoreoProjects.renameProject(id,n).then(function(r){if(id===store.projectId)store.projectName=n;return r})},
  duplicate:function(id){return ChoreoProjects.duplicateProject(id)},
  remove:function(id){return ChoreoProjects.deleteProject(id)},
  addVersion:function(label){return ChoreoProjects.addVersion(store.projectId,label||'测试版本',projectRecord().content,false).then(function(){return ChoreoProjects.listVersions(store.projectId)})},
  restore:function(savedAt){return restoreProjectVersion(savedAt)},
  save:function(){persistProject();return Promise.resolve(store.projectId)},
  content:function(){return JSON.stringify({dancers:store.dancers,globalLyrics:store.globalLyrics,dancerCount:store.dancerCount,showLyricMacro:store.showLyricMacro,totalDuration:store.totalDuration,markers:store.markers||[]})}
};
