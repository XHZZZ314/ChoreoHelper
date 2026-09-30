// 插件内 XAT 转换入口（TASK-20260917-PLUGIN-XAT-INVOCATION）：资料库弹窗里的一节——
// 输入 bt_common PAP 与对应基础 SKLB 的游戏相对路径（可从当前角色已绑定资源读取），
// 调插件后台转换（45s/调用超时、可取消、失败显式分类），成功后把网页剪辑 JSON 存进
// 当前角色档案的资料库。只经 ChoreoAPI 出口；不动档案骨架，产物只落本机 IndexedDB。
// TASK-20260917-DANCER-AUTOADAPT（AC-1/2/3）：新增「准备当前角色动作」批量区——
// 读取绑定 PAP 列表（papEntries 单/多 entry 标注，多 entry 明确跳过并说明原因），
// 勾选+一键全选单 entry，顺序队列逐条转换入库（Busy 等待不报错、失败单独标红可重试、
// 可中途停止、进度可见）；成功首条顺手给档案补 sourceSkeletonCode 种族码（AC-4，加性）。
(function(root){
  'use strict';
  // 与库内 el(tag, class, text) 同形：第二参是 class（样式走 style.cssText），第三参才是显示文字
  function t(tag,cls,text){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
  function sklbOf(pap){
    var m=/^chara\/human\/(c\d{4})\//.exec(pap||'');
    return m?'chara/human/'+m[1]+'/skeleton/base/b0001/skl_'+m[1]+'b0001.sklb':'';
  }
  // 绑定资源读取的共享解析：返回 {skel, paps:[{path,papEntries}]}（papEntries 可能未知=undefined）
  function parseBindings(j){
    var paps=[],skel='';
    (j&&j.resources||[]).forEach(function(r){
      if(r.group==='skeleton'&&r.slot===0&&/\.sklb$/.test(r.path))skel=r.path;
      else if(/^pap/.test(r.group)&&/\.pap$/.test(r.path))paps.push({path:r.path,papEntries:(typeof r.papEntries==='number'?r.papEntries:undefined)});
    });
    return {skel:skel,paps:paps};
  }
  function isMultiEntry(r){return typeof r.papEntries==='number'&&r.papEntries>1}
  function buildSection(opts){
    opts=opts||{};
    var box=t('details','');box.style.cssText='flex:1 1 100%;min-width:0;border:1px solid #252e3c;border-radius:6px;padding:6px 10px';
    box.appendChild(t('summary','','🔌 游戏动作转换（插件内 XAT，零手动工具）'));
    var tip=t('div','','输入或读取当前角色绑定的动作（PAP）路径，插件会用随包转换器把它转成网页动作并保存到当前档案。转换在后台进行，单次调用 45 秒超时；失败会明确说明原因，不会静默跳过。');
    tip.style.cssText='font-size:12px;line-height:1.7;color:#aab6c8;margin:6px 0';
    box.appendChild(tip);
    var row1=t('div','');row1.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px';
    var papIn=document.createElement('input');papIn.size=64;papIn.placeholder='chara/human/c0101/animation/a0001/bt_common/<时间轴键>.pap';
    papIn.style.cssText='flex:1 1 320px;min-width:0';
    var readBtn=t('button','btn','从当前角色读取');
    readBtn.title='连接插件读取当前人物模型实际绑定的 PAP 与基础骨架路径（需要游戏和插件开着）';
    row1.appendChild(papIn);row1.appendChild(readBtn);
    box.appendChild(row1);
    var skelIn=document.createElement('input');skelIn.size=64;skelIn.placeholder='对应基础骨架 SKLB（由 PAP 的 c#### 自动推导，可改）';
    skelIn.style.cssText='width:100%;margin-bottom:4px';
    box.appendChild(skelIn);
    var row2=t('div','');row2.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px';
    var nameIn=document.createElement('input');nameIn.size=24;nameIn.placeholder='动作名（留空=时间轴键）';
    var startBtn=t('button','btn primary','开始转换');
    var cancelBtn=t('button','btn','取消');cancelBtn.style.display='none';
    row2.appendChild(nameIn);row2.appendChild(startBtn);row2.appendChild(cancelBtn);
    box.appendChild(row2);
    var status=t('div','');status.style.cssText='font-size:12px;line-height:1.7;color:#e8c57a;white-space:pre-line';
    status.setAttribute('role','status');status.style.display='none';
    box.appendChild(status);
    var resultBox=t('div','');resultBox.style.cssText='display:none;font-size:12px;line-height:1.7;margin-top:4px';
    var importBtn=t('button','btn primary','⬇ 存入当前档案资料库');
    var dlSkel=t('button','btn','下载骨架 JSON');
    resultBox.appendChild(importBtn);resultBox.appendChild(dlSkel);
    box.appendChild(resultBox);
    var boundList=t('div','');boundList.style.cssText='display:none;font-size:12px;color:#7d8a9c;margin-top:4px;max-height:140px;overflow:auto';
    box.appendChild(boundList);
    box.appendChild(buildBatchArea(opts,box));
    if(opts.includePack!==false)box.appendChild(buildPackArea(opts,box));

    papIn.addEventListener('change',function(){if(!skelIn.value||skelIn.value===sklbOf(papIn.dataset.prev||''))skelIn.value=sklbOf(papIn.value);papIn.dataset.prev=papIn.value});
    papIn.addEventListener('input',function(){skelIn.value=sklbOf(papIn.value)});

    var jobId=null,pollTimer=null,clip=null,skeletonJson=null;
    function say(msg){status.style.display='';status.textContent=msg;if(opts.report)opts.report(msg)}
    function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
    function dead(){return opts.isCancelled?opts.isCancelled():!box.isConnected}

    readBtn.onclick=function(){
      if(typeof ChoreoAPI==='undefined'){say('API 客户端未加载');return}
      say('正在读取当前角色绑定的动作资源…');
      ChoreoAPI.game.api('/character/assets?animationBindings=1').then(function(j){
        if(dead())return;
        if(!j||!j.available){say(j&&j.message||'当前角色不可读（需要游戏与插件在线）');return}
        var b=parseBindings(j),paps=b.paps,skel=b.skel,multi=0,known=0;
        paps.forEach(function(r){if(typeof r.papEntries==='number'){known++;if(r.papEntries>1)multi++}});
        if(skel)skelIn.value=skel;
        boundList.style.display='';boundList.textContent='';
        boundList.appendChild(t('div','','当前角色骨架：'+(skel||'未读到')+'；已绑定 PAP '+paps.length+' 个（点击填入'+(known?('，'+(paps.length-known>0?'其余条目数未知，':'')+'多条目 '+multi+' 个会转换失败待后续拆分支持'):'')+'）：'));
        paps.forEach(function(r){
          var multiEntry=isMultiEntry(r);
          var b2=t('button','btn',r.path.split('/').pop()+(multiEntry?' ×'+r.papEntries:''));
          b2.title=r.path+(multiEntry?('\n多条目（数量='+r.papEntries+'）：当前转换器会明确拒绝，拆分支持属后续任务'):'');
          b2.style.cssText='margin:2px 4px 2px 0'+(multiEntry?';opacity:.55':'');
          b2.onclick=function(){papIn.value=r.path;skelIn.value=sklbOf(r.path);papIn.dataset.prev=r.path};
          boundList.appendChild(b2);
        });
        say('已读取绑定资源：骨架 '+(skel?'就绪':'缺失')+'，PAP '+paps.length+' 个（仅列出当前已加载的；也可手输 bt_common 路径）');
      }).catch(function(e){say('读取失败：'+((e&&e.detail)||e.message||e))});
    };

    startBtn.onclick=function(){
      if(typeof ChoreoAPI==='undefined'){say('API 客户端未加载');return}
      var pap=papIn.value.trim(),skel=skelIn.value.trim()||sklbOf(pap);
      var name=nameIn.value.trim()||(pap?pap.split('/').pop().replace(/\.pap$/,''):'');
      if(!pap||!skel){say('请先提供 PAP 与骨架路径');return}
      stopPoll();clip=null;skeletonJson=null;resultBox.style.display='none';
      say('正在启动转换…');
      ChoreoAPI.game.api('/xat/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({papPath:pap,skeletonPath:skel,name:name})})
        .then(function(j){
          if(dead())return;
          if(!j||!j.ok){say((j&&j.message)||'启动失败');return}
          jobId=j.jobId;cancelBtn.style.display='';
          say('转换已开始（作业 '+jobId+'）…');
          pollTimer=setInterval(poll,1000);
        }).catch(function(e){say('启动失败：'+((e&&e.detail)||e.message||e))});
    };

    function poll(){
      if(dead()){stopPoll();return}
      ChoreoAPI.game.api('/xat/status?id='+encodeURIComponent(jobId)).then(function(j){
        if(dead()||!j||!j.ok||!j.job)return;
        var job=j.job;
        if(job.state==='running'){say('进行中：'+job.stage+'（'+(job.elapsedMs/1000).toFixed(1)+'s）');return}
        stopPoll();cancelBtn.style.display='none';
        if(job.state==='succeeded'){
          say('转换成功：'+job.message);
          ChoreoAPI.game.api('/xat/status?id='+encodeURIComponent(jobId)+'&includeResult=1',{timeoutMs:15000}).then(function(r){
            if(dead()||!r||!r.ok||!r.job)return;
            clip=JSON.parse(r.job.clipJson);skeletonJson=r.job.skeletonJson;
            resultBox.style.display='';
            checkAlignment(clip);
          }).catch(function(e){say('取结果失败：'+((e&&e.detail)||e.message||e))});
        }else if(job.state==='cancelled'){say('已取消。');
        }else{say('失败（'+job.errorKind+'）：'+job.message);}
      }).catch(function(e){stopPoll();cancelBtn.style.display='none';say('状态查询失败：'+((e&&e.detail)||e.message||e))});
    }

    function checkAlignment(clipObj){
      if(!root.ChoreoLibrary||!ChoreoLibrary.available())return;
      ChoreoLibrary.getSkeleton().then(function(skel){
        if(!skel||!skel.bones)return;
        var indices=new Set(skel.bones.map(function(x){return 'bone_'+x.i}));var bad=[];
        Object.keys(clipObj.bones||{}).forEach(function(k){if(!indices.has(k))bad.push(k)});
        say('转换成功：'+(clipObj.bones?Object.keys(clipObj.bones).length:0)+' 骨。骨架对齐：'+(bad.length?('当前档案骨架缺少 '+bad.length+' 个骨骼索引，播放可能不完整（可换匹配档案或导入配套骨架核对）'):'与当前档案骨架索引一致'));
      }).catch(function(){});
    }

    cancelBtn.onclick=function(){
      if(!jobId)return;
      ChoreoAPI.game.api('/xat/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:jobId})})
        .then(function(){say('已请求取消…')}).catch(function(e){say('取消失败：'+((e&&e.detail)||e.message||e))});
    };

    importBtn.onclick=function(){
      if(!clip||!root.ChoreoLibrary){say('没有可保存的转换结果');return}
      var name=clip.name||nameIn.value.trim()||('xat-'+jobId);
      var save=function(){ChoreoLibrary.putClip(name,clip).then(function(){
        say('已存入当前档案：/'+name+'（在 3D 预览的动作列表选用）');
        if(window.__p3dLibChanged)window.__p3dLibChanged();
      }).catch(function(e){say('保存失败：'+e.message)})};
      ChoreoLibrary.clipIndex().then(function(idx){
        var exists=(idx||[]).some(function(c){return c.name===name});
        if(exists&&!window.confirm('当前档案已有同名动作「'+name+'」，覆盖它？'))return;
        save();
      }).catch(save);
    };

    dlSkel.onclick=function(){
      if(!skeletonJson)return;
      var blob=new Blob([skeletonJson],{type:'application/json'});
      var a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download=((clip&&clip.offlinePrototype&&clip.offlinePrototype.sourceSkeleton)||'skeleton')+'-skeleton.json';
      a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
    };

    return box;
  }

  // ---- DANCER-AUTOADAPT（AC-1/2/3）：准备当前角色动作（批量） ----
  // 读取 → 勾选列表（多 entry 默认跳过+原因）→ 顺序队列逐条 convert/status/入库。
  // Busy=等待重试（不报错）、失败标红可单条重试、停止=当前项完成后停、进度行实时更新。
  function buildBatchArea(opts,box){
    var area=t('div','');area.style.cssText='margin-top:8px;padding-top:6px;border-top:1px dashed #252e3c';
    var head=t('div','','一键准备：把当前角色绑定的全部单条目动作排队转换进当前档案（换新角色后动作库就绪）。');
    head.style.cssText='font-size:12px;line-height:1.7;color:#aab6c8;margin:4px 0';
    area.appendChild(head);
    var row=t('div','');row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px';
    var loadBtn=t('button','btn','读取绑定动作');
    loadBtn.title='读取当前角色模型实际绑定的全部 PAP（需要游戏和插件开着）';
    var allBtn=t('button','btn','全选单条目');allBtn.style.display='none';allBtn.title='勾选全部单条目动作（多条目不参与：转换器明确拒绝，拆分属后续任务）';
    var goBtn=t('button','btn primary','开始准备');goBtn.style.display='none';
    var stopBtn=t('button','btn','停止（当前项完成后）');stopBtn.style.display='none';
    row.appendChild(loadBtn);row.appendChild(allBtn);row.appendChild(goBtn);row.appendChild(stopBtn);
    area.appendChild(row);
    var list=t('div','');list.style.cssText='display:none;font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin-bottom:4px';
    area.appendChild(list);
    var progress=t('div','');progress.style.cssText='display:none;font-size:12px;line-height:1.7;color:#e8c57a;white-space:pre-line';
    progress.setAttribute('role','status');
    area.appendChild(progress);

    var items=[];           // [{r:{path,papEntries}, key, row, cb, state, msg}]
    var queue=null;         // 运行中的队列 {todo:[item...], done, failed, skipped, total, stopRequested, codeWritten}
    function dead(){return opts.isCancelled?opts.isCancelled():!box.isConnected}
    function say(msg){progress.style.display='';progress.textContent=msg;if(opts.report)opts.report(msg)}

    loadBtn.onclick=function(){
      if(typeof ChoreoAPI==='undefined'){say('API 客户端未加载');return}
      say('正在读取当前角色绑定的动作资源…');
      ChoreoAPI.game.api('/character/assets?animationBindings=1').then(function(j){
        if(dead())return;
        if(!j||!j.available){say(j&&j.message||'当前角色不可读（需要游戏与插件在线）');return}
        var b=parseBindings(j);
        items=[];list.style.display='';list.textContent='';
        var singles=0,multis=0,unknown=0;
        b.paps.forEach(function(r){
          var key=r.path.split('/').pop().replace(/\.pap$/,'');
          var multi=isMultiEntry(r);
          var unknownEntry=typeof r.papEntries!=='number';
          if(multi)multis++;else if(unknownEntry)unknown++;else singles++;
          var rowEl=t('div','');
          var cb=document.createElement('input');cb.type='checkbox';
          cb.checked=!multi&&!unknownEntry;      // 默认只勾单 entry；条目数未知的不默认勾（转换可能被拒，勾了也会失败隔离）
          cb.disabled=multi;
          var label=t('span','',key+(multi?'（多条目 ×'+r.papEntries+'，跳过：单条 PAP 含多个动作，转换器明确拒绝，拆分支持属后续任务）':(unknownEntry?'（条目数未知，可试转；若为多条目会明确失败）':'')));
          label.style.cssText='margin-left:6px'+(multi?';color:#7d8a9c':'');
          rowEl.appendChild(cb);rowEl.appendChild(label);
          list.appendChild(rowEl);
          items.push({r:r,key:key,cb:cb,row:rowEl,state:multi?'skipped-multi':'ready',msg:''});
        });
        allBtn.style.display='';goBtn.style.display='';
        say('已读取 '+b.paps.length+' 个绑定 PAP：单条目 '+singles+'（默认全勾）· 多条目 '+multis+'（明确跳过）'+(unknown?(' · 条目数未知 '+unknown+'（默认不勾）'):'')+'。勾选后点「开始准备」。');
        updateGoBtn();
      }).catch(function(e){say('读取失败：'+((e&&e.detail)||e.message||e))});
    };

    allBtn.onclick=function(){
      items.forEach(function(it){if(!it.cb.disabled)it.cb.checked=true});
      updateGoBtn();
    };
    function selected(){return items.filter(function(it){return it.cb.checked&&it.state!=='skipped-multi'})}
    function updateGoBtn(){
      var n=queue?0:selected().length;
      goBtn.textContent=queue?'准备中…':('开始准备'+(n?('（'+n+' 项）'):''));
      goBtn.disabled=!!queue||n===0;
    }

    function rowText(it){return (it.state==='done'?'✓ ':(it.state==='failed'?'✗ ':(it.state==='running'?'▶ ':'')))+it.key+(it.msg?('：'+it.msg):'')}
    function renderRow(it){
      it.row.textContent=rowText(it);
      it.row.style.color=it.state==='failed'?'#e57373':(it.state==='done'?'#7fbf7f':(it.state==='running'?'#e8c57a':''));
    }
    function renderProgress(){
      if(!queue)return;
      var processed=queue.succeeded+queue.failed+queue.skipped;
      var cur=queue.todo.length?'':' · 当前：'+queue.lastKey;
      say('准备进度 '+processed+'/'+queue.total+' · 成功 '+queue.succeeded+' · 失败 '+queue.failed+' · 已在库跳过 '+queue.skipped+cur+(queue.stopRequested?'（已请求停止）':''));
    }

    goBtn.onclick=function(){
      if(queue||typeof ChoreoAPI==='undefined')return;
      var todo=selected();
      if(!todo.length)return;
      stopBtn.style.display='';
      queue={todo:todo,succeeded:0,failed:0,skipped:0,total:todo.length,stopRequested:false,lastKey:'',codeWritten:false};
      updateGoBtn();
      // 已在当前档案的动作按名跳过（幂等：重跑只补缺的重转）
      (root.ChoreoLibrary&&ChoreoLibrary.available()?ChoreoLibrary.clipIndex():Promise.resolve([])).then(function(idx){
        var have={};(idx||[]).forEach(function(c){have[c.name]=true});
        queue.todo=queue.todo.filter(function(it){
          if(have[it.key]){it.state='skipped';it.msg='已在当前档案，跳过';it.cb.checked=false;it.cb.disabled=true;queue.skipped++;renderRow(it);return false}
          it.state='queued';renderRow(it);return true;
        });
        queue.total=queue.skipped+queue.todo.length;
        if(!queue.todo.length){finishQueue();return}
        renderProgress();
        runNext();
      }).catch(function(e){say('读取动作库失败，未开始：'+((e&&e.message)||e));endQueue();});
    };

    function endQueue(){queue=null;stopBtn.style.display='none';updateGoBtn()}
    function finishQueue(){
      var q=queue;endQueue();
      // 计数只写实结果：成功+失败+已在库跳过=总数；停止导致未开始的项不计成功也不计失败，单独标注
      var total=q.succeeded+q.failed+q.skipped;
      say('准备结束（共 '+total+' 项）：'+q.succeeded+' 成功 · '+q.failed+' 失败 · '+q.skipped+' 已在库跳过'
        +(q.todo.length?(' · 因停止未开始 '+q.todo.length+' 项'):'')
        +(q.failed?('——失败项可单条重试（勾选后点开始，或点失败行）'):''));
      if(window.__p3dLibChanged)window.__p3dLibChanged();
      items.forEach(function(it){if(it.state==='queued'){it.state='ready';it.msg='';renderRow(it)}});
    }

    function runNext(){
      if(!queue)return;
      if(queue.stopRequested||!queue.todo.length){finishQueue();return}
      var it=queue.todo.shift();
      queue.lastKey=it.key;
      it.state='running';it.msg='启动转换…';renderRow(it);renderProgress();
      convertOne(it).then(function(ok){
        if(!queue)return; // 面板已死/被外部清理
        if(ok)queue.succeeded++;else queue.failed++;  // 失败不计成功（D1：成功+失败+已在库跳过=总数）
        renderProgress();
        runNext();
      });
    }

    // 单条：启动（Busy 等待重试）→ 轮询 → 取结果 → 入库 + 对齐校验 + 首次成功补种族码
    function convertOne(it){
      return new Promise(function(resolve){
        var jobId=null,timer=null,busyTries=0,stopped=false;
        function done(ok){stopped=true;if(timer){clearTimeout(timer);timer=null}resolve(ok)}
        function fail(kind,msg){it.state='failed';it.msg='失败（'+kind+'）：'+msg;renderRow(it);addRetry(it);done(false)}
        function addRetry(item){
          // 失败隔离（AC-2）：单独重试入口——队列空闲时点它，只重跑这一条
          var rb=t('button','btn','重试');rb.style.marginLeft='8px';
          rb.onclick=function(){
            if(queue)return;
            item.state='queued';item.msg='';renderRow(item);
            queue={todo:[item],succeeded:0,failed:0,skipped:0,total:1,stopRequested:false,lastKey:item.key,codeWritten:false};
            stopBtn.style.display='';updateGoBtn();renderProgress();runNext();
          };
          item.row.appendChild(rb);
        }
        function start(){
          if(stopped||dead())return done(false);
          ChoreoAPI.game.api('/xat/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({papPath:it.r.path,skeletonPath:sklbOf(it.r.path),name:it.key})})
            .then(function(j){
              if(stopped||dead())return done(false);
              if(!j||!j.ok)return fail('启动',(j&&j.message)||'未知原因');
              jobId=j.jobId;it.msg='转换排队中…';renderRow(it);poll();
            })
            .catch(function(e){
              if(stopped||dead())return done(false);
              if(e&&e.status===409){ // Busy：有别的转换在跑（如手动单条）——等待后重试，不报错
                if(++busyTries>80)return fail('busy','等待其它转换结束超过约 2 分钟，可稍后重试');
                it.msg='转换器忙，等待重试（'+busyTries+'）…';renderRow(it);
                timer=setTimeout(start,1500);return;
              }
              if(e&&e.cancelled)return fail('取消',e.message||'本次操作已被停止取消');
              fail('启动',((e&&e.detail)||e.message||e));
            });
        }
        function poll(){
          if(stopped||dead())return done(false);
          ChoreoAPI.game.api('/xat/status?id='+encodeURIComponent(jobId)).then(function(j){
            if(stopped||dead())return done(false);
            if(!j||!j.ok||!j.job)return fail('状态','查询失败：'+((j&&j.message)||'作业不存在'));
            var job=j.job;
            if(job.state==='running'){it.msg='转换中：'+job.stage+'（'+((job.elapsedMs||0)/1000).toFixed(1)+'s）';renderRow(it);timer=setTimeout(poll,1000);return}
            if(job.state==='cancelled'){it.state='failed';it.msg='已取消（可重试）';renderRow(it);addRetry(it);return done(false)}
            if(job.state!=='succeeded')return fail(job.errorKind||'转换',job.message||'未知失败');
            ChoreoAPI.game.api('/xat/status?id='+encodeURIComponent(jobId)+'&includeResult=1',{timeoutMs:15000}).then(function(r){
              if(stopped||dead())return done(false);
              if(!r||!r.ok||!r.job||!r.job.clipJson)return fail('取结果',((r&&r.job&&r.job.message)||'结果不可读'));
              var clipObj;try{clipObj=JSON.parse(r.job.clipJson)}catch(e){return fail('取结果','剪辑 JSON 解析失败')}
              importClip(it,clipObj,r.job.skeletonJson).then(function(){done(true)}).catch(function(e){fail('入库',((e&&e.message)||e))});
            }).catch(function(e){if(!stopped)fail('取结果',((e&&e.detail)||e.message||e))});
          }).catch(function(e){
            if(stopped||dead())return done(false);
            // 状态查询瞬时失败不连坐判死：短暂退避后重查（持续查不到才按失败隔离）
            it._pollFails=(it._pollFails||0)+1;
            if(it._pollFails>5)return fail('状态',((e&&e.detail)||e.message||e));
            timer=setTimeout(poll,1000);
          });
        }
        start();
      });
    }

    // 入库当前档案 + 骨架对齐校验（既有消费端口径）+ 首次成功补 sourceSkeletonCode
    function importClip(it,clipObj,skeletonJson){
      return ChoreoLibrary.putClip(it.key,clipObj).then(function(){
        it.state='done';it.msg='已入库（'+(clipObj.bones?Object.keys(clipObj.bones).length:0)+' 骨'+(clipObj.duration!=null?(' / '+Number(clipObj.duration).toFixed(2)+'s'):'')+'）';
        renderRow(it);
        if(queue&&!queue.codeWritten){
          queue.codeWritten=true;
          var code=clipObj&&clipObj.offlinePrototype&&clipObj.offlinePrototype.sourceSkeleton;
          if(/^c\d{4}$/.test(code||'')){
            ChoreoLibrary.getActiveProfile().then(function(p){
              if(p&&p.id&&!p.sourceSkeletonCode)return ChoreoLibrary.setProfileSourceCode(p.id,code);
            }).catch(function(){/* 补码失败不影响入库结果 */});
          }
        }
        // 对齐校验结果附在行上（提示用，不改变成败）
        if(skeletonJson&&ChoreoLibrary.getSkeleton){
          ChoreoLibrary.getSkeleton().then(function(skel){
            if(!skel||!skel.bones)return;
            var idx={};skel.bones.forEach(function(x){idx['bone_'+x.i]=true});
            var bad=Object.keys(clipObj.bones||{}).filter(function(k){return !idx[k]}).length;
            if(bad)it.msg+=' ⚠ 骨架对齐：当前档案缺 '+bad+' 个骨骼索引';
            renderRow(it);
          }).catch(function(){});
        }
        return true;
      });
    }

    stopBtn.onclick=function(){
      if(!queue)return;
      queue.stopRequested=true;stopBtn.style.display='none';
      renderProgress();
      say(progress.textContent+'（将在当前项完成后停止）');
    };

    return area;
  }

  // ---- SKILL-ANIM-CHANNEL 阶段二（方案 A）：导入离线动作包 ----
  // 包由 scripts/make-anim-pack.js 离线生成（sqpack 只读提取+随包 XAT 转换，游戏不用开）：
  // 表情全量+技能出招（ability 族）转成网页剪辑，按 cmdToName(命令) 命名入库当前档案——
  // 时间轴放表情/技能即预览（库优先于旧游戏录制）。file:// 页面读不了本地盘（浏览器安全
  // 限制，无 fetch），所以给两入口：拖拽进虚线框（普通用户最快）或 file 输入点选；
  // 失败逐条隔离；计数自洽（成功+失败+已在库跳过=总数，D1 同口径）；完成通知预览刷新。
  // r2（TASK-20260918-ANIM-PACK-UNIVERSAL）：v2 通用包（--universal，c0101 基准）按目标
  // 档案骨架自动换算入库；「导入到全部档案」逐档案各自换算各自计数；v1 包路径零改动
  // （不换算、只入当前档案），v1 勾选全部档案时在写入前明确拒绝并提示改用通用包。
  // r2 返工（AP-R2-01/02）：全包深度校验先于任何写入（晚到的坏剪辑零写入）；被拒档案
  // 计入 planned 并在汇总逐档案对账（说明文字进状态区、失败列表只放真实逐条失败）；
  // 异常比例骨（平移保持原样）或被拒档案存在时完成文案不得宣称「全部完成」。
  function buildPackSection(opts){
    var box=t('section','lib-offline-pack');box.style.cssText='border:1px solid #252e3c;border-radius:6px;padding:8px 10px;margin-bottom:8px;min-width:0';
    box.appendChild(t('h4','','📦 离线动作包（无需打开游戏）'));
    box.appendChild(buildPackArea(opts||{},box));
    return box;
  }
  function buildPackArea(opts,box){
    var area=t('div','');area.style.cssText='margin-top:8px;padding-top:6px;border-top:1px dashed #252e3c';
    var head=t('div','','导入离线动作包（表情+技能出招，游戏不用开）：把动作包文件 anim-pack.json.gz 拖进下面虚线框，或点击虚线框选文件。通用包（一个文件全员可用，按各自角色自动换算）或单族包都可以；只需导入一次（约 1–2 分钟），之后动作都存在本机资料库里。不知道文件在哪就找 anim-pack.json.gz（约 90 MB，一般在程序所在文件夹或收到的压缩包里）。');
    head.style.cssText='font-size:12px;line-height:1.7;color:#aab6c8;margin:4px 0';
    area.appendChild(head);
    // 拖拽/点击二合一投递框：file:// 页面无法自动扫本地磁盘（浏览器安全限制），拖拽是普通用户最快路径
    var drop=t('div','','把 anim-pack.json.gz 拖到这里\n（松手即开始导入；或点击选择文件）');
    drop.style.cssText='border:1px dashed #3d4a5f;border-radius:6px;padding:14px 8px;text-align:center;font-size:12px;line-height:1.7;color:#8fa0b6;cursor:pointer;white-space:pre-line;margin-bottom:4px';
    function dropHi(on){drop.style.borderColor=on?'#e8c57a':'#3d4a5f';drop.style.color=on?'#e8c57a':'#8fa0b6'}
    drop.addEventListener('dragover',function(e){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';dropHi(true)});
    drop.addEventListener('dragleave',function(){dropHi(false)});
    drop.addEventListener('drop',function(e){e.preventDefault();dropHi(false);var fs=e.dataTransfer&&e.dataTransfer.files;importFile(fs&&fs.length===1?fs[0]:null)});
    drop.addEventListener('click',function(){if(typeof fileIn.click==='function')fileIn.click()});
    area.appendChild(drop);
    var row=t('div','');row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px';
    var fileIn=document.createElement('input');fileIn.type='file';fileIn.accept='.gz,.json';
    fileIn.title='离线动作包（anim-pack.json.gz）；导入约 1–2 分钟，期间请勿关闭页面';
    var overChk=document.createElement('input');overChk.type='checkbox';
    overChk.style.cssText='width:auto;flex:none;margin:0';
    overChk.title='勾选后同名动作按包内数据覆盖；默认跳过已在库的同名动作';
    var overLbl=t('span','',' 覆盖同名动作');overLbl.style.cssText='font-size:12px;color:#aab6c8';
    var allChk=document.createElement('input');allChk.type='checkbox';
    allChk.style.cssText='width:auto;flex:none;margin:0';
    allChk.title='勾选后一次导入到全部角色档案（仅通用包 v2 支持：逐档案按各自骨架换算各自入库）；默认只导入当前档案';
    var allLbl=t('span','',' 导入到全部档案');allLbl.style.cssText='font-size:12px;color:#aab6c8';
    var overGroup=t('label',''),allGroup=t('label','');
    overGroup.style.cssText=allGroup.style.cssText='display:inline-flex;align-items:center;gap:4px;cursor:pointer';
    overGroup.appendChild(overChk);overGroup.appendChild(overLbl);allGroup.appendChild(allChk);allGroup.appendChild(allLbl);
    row.appendChild(fileIn);row.appendChild(overGroup);row.appendChild(allGroup);
    area.appendChild(row);
    var stopBtn=t('button','btn','停止导入（当前条完成后）');stopBtn.style.display='none';stopBtn.style.marginBottom='4px';
    stopBtn.title='停止后已入库的动作保留，未开始的不再导入；可重新导入补齐';
    area.appendChild(stopBtn);
    var progress=t('div','');progress.style.cssText='display:none;font-size:12px;line-height:1.7;color:#e8c57a';
    progress.setAttribute('role','status');
    area.appendChild(progress);
    var fails=t('div','');fails.style.cssText='display:none;font-size:12px;line-height:1.7;color:#d98c8c;margin-top:4px;max-height:120px;overflow:auto;white-space:pre-line';
    area.appendChild(fails);
    function say(msg){progress.style.display='';progress.textContent=msg;if(opts.report)opts.report(msg)}
    function dead(){return opts.isCancelled?opts.isCancelled():!box.isConnected}
    function sayFails(list){
      fails.style.display='';fails.textContent='';
      fails.appendChild(t('div','','失败 '+list.length+' 条：'));
      list.slice(0,30).forEach(function(f){fails.appendChild(t('div','','· '+f))});
      if(list.length>30)fails.appendChild(t('div','','…其余 '+(list.length-30)+' 条见动作包 manifest'));
    }
    var importing=false,activePlan=null; // AC6：导入进行中重复点击不启动第二次
    stopBtn.onclick=function(){
      if(activePlan)activePlan.cancelled=true;
      say('已请求停止：当前条完成后停止，已入库的保留');
    };
    // r2：v2 通用包导入（冻结计划→逐档案换算入库→诚实汇总）
    async function importV2(pack){
      if(!root.ChoreoAnimPackImport||!root.ChoreoAnimPackRetarget)throw new Error('通用包导入模块未加载（页面脚本不完整）');
      var act=await ChoreoLibrary.getActiveProfile();
      if(!act)throw new Error('没有活动档案：先在资料库建档（族包选择器或游戏在线）再导入');
      var b=await root.ChoreoAnimPackImport.buildPlan({lib:ChoreoLibrary,pack:pack,allProfiles:allChk.checked,activePid:act.id,
        overwrite:overChk.checked,skeletonPack:root.__CHOREO_SKELETON_PACK__||null});
      if(!b.ok)throw new Error(b.reason);
      var plan=b.plan;activePlan=plan;stopBtn.style.display='';
      // AP-R2-02：被拒档案是「说明文字」（进状态区，不进失败列表）；其条目计入 planned/failed，
      // 汇总逐档案对账——不得再出现「全部完成＋planned 少算＋失败列表里混跳过说明」的矛盾汇报。
      var rejNote=plan.rejected.length?('；另有 '+plan.rejected.length+' 个档案不导入（零写入）：'
        +plan.rejected.map(function(r){return '「'+r.name+'」'+r.reason;}).join('、')):'';
      say('开始导入 '+pack.entries.length+' 个动作到 '+plan.targets.length+' 个档案（'+plan.targets.map(function(tg){return tg.name;}).join('、')+'）'+rejNote+'…');
      var res=await root.ChoreoAnimPackImport.runPlan(plan,pack,{
        lib:ChoreoLibrary,
        current:function(){return !dead();},
        putClip:function(name,clip,pid,guard){return ChoreoLibrary.putClip(name,clip,pid,guard);},
        clipIndex:function(pid){return ChoreoLibrary.clipIndex(pid);},
        onProgress:function(stage,d){
          if(stage!=='entry')return;
          var tg=d.target;
          say('导入中 ['+tg.name+']'+(tg.code?'（按 '+tg.code+' 换算）':'')+'：成功 '+tg.counts.imported+' · 已在库跳过 '+tg.counts.skipped+' · 失败 '+tg.counts.failed+' · 未开始 '+tg.counts.notStarted
            +(plan.targets.length>1?(' · 档案 '+(plan.targets.indexOf(tg)+1)+'/'+plan.targets.length):''));
        }
      });
      activePlan=null;stopBtn.style.display='none';
      var lines=res.targets.map(function(tg){
        var pb=0;for(var k in tg.preservedBones)pb++;
        return '档案「'+tg.name+'」'+(tg.code?('已按 '+tg.code+' 换算'):'（按档案骨架换算）')+'：导入 '+tg.counts.imported+' · 已在库跳过 '+tg.counts.skipped+' · 失败 '+tg.counts.failed+' · 未开始 '+tg.counts.notStarted
          +(pb?('（'+pb+' 个动作有异常比例骨骼保持原样，未计为全换算）'):'');
      }).concat((res.rejected||[]).map(function(r){
        return '档案「'+r.name+'」未导入（'+(r.counts?r.counts.failed:pack.entries.length)+' 项全部未导入）：'+r.reason;
      }));
      var ag=res.aggregate;
      var statusText=res.status==='cancelled'?'已停止（已入库的保留）'
        :(res.status==='completed'?(res.anomalyEntries>0?'完成（含 '+res.anomalyEntries+' 项异常比例骨平移保持原样，未计为全换算）':'全部完成'):'部分完成');
      say('导入结束（'+statusText+'，共 '+ag.planned+' 项·档案×动作）：'+lines.join('；')+' —— 时间轴放表情/技能即可预览');
      var fl=[];
      res.targets.forEach(function(tg){tg.failures.forEach(function(f){fl.push('['+tg.name+'] '+f);});});
      if(fl.length)sayFails(fl); // 失败列表只放真实逐条失败，不放被拒档案的说明文字
      if(ag.imported>0&&window.__p3dLibChanged)window.__p3dLibChanged();
    }
    function importFile(file){
      if(!file){say('请拖入一个动作包文件（anim-pack.json.gz，一次一个）');return}
      if(!root.ChoreoLibrary||!ChoreoLibrary.available()){say('资料库不可用（无法导入）');return}
      if(importing){say('已有一次导入在进行中，请等它结束');return}
      importing=true;
      say('读取动作包 '+file.name+'（'+(file.size/1048576).toFixed(1)+' MB）…');
      (async function(){
        try{
          var buf=new Uint8Array(await file.arrayBuffer());
          var text=null;
          if(buf.length>2&&buf[0]===0x1f&&buf[1]===0x8b){
            if(typeof DecompressionStream==='undefined')throw new Error('此浏览器不支持解压 gzip');
            var stream=new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
            text=await new Response(stream).text();
          }else text=new TextDecoder().decode(buf);
          if(dead())return;
          var pack;try{pack=JSON.parse(text)}catch(e){throw new Error('动作包 JSON 解析失败（文件可能不完整）')}
          if(dead())return;
          if(pack&&pack.formatVersion===2){await importV2(pack);return}
          if(allChk.checked)throw new Error('这是 v1 单族包，不支持「导入到全部档案」：请改用通用包（生成时加 --universal，一个文件全员通用）后再勾选');
          if(!pack||pack.formatVersion!==1||!Array.isArray(pack.entries)||!Array.isArray(pack.clips))
            throw new Error('动作包格式不支持（需要 formatVersion=1 或 2 的 anim-pack）');
          var overwrite=overChk.checked;
          var existing={};
          try{ (await ChoreoLibrary.clipIndex()).forEach(function(c){existing[c.name]=true}) }catch(e){}
          if(dead())return;
          var todo=pack.entries.filter(function(e){return overwrite||!existing[e.name]});
          var skipped=pack.entries.length-todo.length;
          var ok=0,bad=[],doneN=0;
          for(var i=0;i<todo.length;i++){
            if(dead())return;
            var e=todo[i];
            try{
              var c=pack.clips[e.clipIndex];
              if(!c||!c.clip||!c.clip.bones)throw new Error('包缺剪辑数据');
              await ChoreoLibrary.putClip(e.name,c.clip);
              ok++;
            }catch(err){bad.push(e.label+'（'+e.name+'）：'+((err&&err.message)||err))}
            doneN++;
            if(doneN%10===0||doneN===todo.length)say('导入中 '+doneN+'/'+todo.length+' · 成功 '+ok+' · 失败 '+bad.length+' · 已在库跳过 '+skipped);
          }
          say('导入结束（共 '+pack.entries.length+' 项）：'+ok+' 成功 · '+bad.length+' 失败 · '+skipped+' 已在库跳过——时间轴放表情/技能即可预览');
          if(bad.length)sayFails(bad);
          if(ok>0&&window.__p3dLibChanged)window.__p3dLibChanged();
        }catch(e2){say('导入失败：'+((e2&&e2.message)||e2))}
        finally{importing=false;activePlan=null;stopBtn.style.display='none'}
      })();
    }
    fileIn.onchange=function(){importFile(fileIn.files&&fileIn.files[0])};
    return area;
  }
  root.ChoreoXatConvertUI={buildSection:buildSection,buildPackSection:buildPackSection};
})(typeof window!=='undefined'?window:globalThis);
