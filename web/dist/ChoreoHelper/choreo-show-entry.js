// 统一游戏演出入口与整场检查：把分散的整场审阅、就绪、执行与复盘组织成一条用户能走完的流程。
// 本页只读——打开不发任何请求；显式"检查整场"只走既有只读端点（probeCaps + 定向 reconnect + ability-read），
// 支持与排除判定唯一来源是 ChoreoStageShow.review，这里只做计数与分桶展示，不复制规则引擎。
// 检查结论绑定项目/编排版本/本机舞者/档案绑定/插件会话，任一变化即失效；迟到回包不得覆盖新状态，
// 也不恢复任何执行许可。不新增第二套时间轴、播放器、时钟或控制台。
(function(root){
  'use strict';
  var GEARSET_RE=/^\/(?:gs|gearset|job)(?:\s|$)/i;
  // 统一执行状态文案（口径与 choreo-stage-readiness/replay 的 STATE 一致，按用户可理解的方式细分）。
  var STATE={idle:'尚未开始',loaded:'准备中（已登记，尚未开始）',armed:'待确认（已就绪，待游戏内确认）',countdown:'执行中（倒数中）',playing:'执行中',stopping:'停止处理中',completed:'已完成（游戏效果须另行确认）',faulted:'失败或结果未确认（已停止）'};
  function num(v){v=Number(v);return Number.isFinite(v)?v:null}
  function hasCap(caps,name){return !!(caps&&Array.isArray(caps.capabilities)&&caps.capabilities.indexOf(name)>=0)}
  // —— 纯计数：只数事件与归属，不做支持判定（那是 ChoreoStageShow.review 的唯一职责）——
  function countEvents(doc,performerId){
    var out={counts:{movement:0,facing:0,motion:0,gearset:0,ability:0,other:0},mine:{movement:0,facing:0,motion:0,gearset:0,ability:0,other:0},selected:0,otherDancers:0,disabled:0,lyric:0,otherDancerIds:[]};
    var seen={};
    ((doc&&doc.tracks)||[]).forEach(function(t){
      var mine=t&&t.performerId===performerId;
      ((t&&t.events)||[]).forEach(function(e){
        var command=(e&&(e.command||(e.data&&e.data.command)))||'';
        var kind=e&&e.kind==='motion'&&GEARSET_RE.test(command)?'gearset':e&&e.kind;
        if(!out.counts.hasOwnProperty(kind))kind='other';
        out.counts[kind]++;
        if(t.enabled===false||e.enabled===false)out.disabled++;
        else if(mine){out.selected++;out.mine[kind]++}
        else{out.otherDancers++;var k=String((t&&t.performerId)||'未知');if(!seen[k]){seen[k]=1;out.otherDancerIds.push(k)}}
      });
    });
    out.lyric=((doc&&doc.lyrics)||[]).filter(function(e){return e&&e.enabled!==false}).length;
    return out;
  }
  // —— 离线即可得的本地摘要：绑定、计数与本地可判定的阻断；插件未读取时支持范围如实标未知 ——
  function summarize(doc,info){
    info=info||{};
    var maxShowMs=(root.ChoreoStageShow&&root.ChoreoStageShow.MAX_SHOW_MS)||300000;
    var counts=countEvents(doc,info.performerId);
    var problems=[],unknown=[];
    var durationMs=num(doc&&doc.durationMs);
    if(!doc)problems.push({category:'blocking',object:'当前项目',cause:'未取得可检查的演出文档',next:'重新打开或保存项目后再检查'});
    if(!(info.di>=0)||!info.dancerName)problems.push({category:'blocking',object:'本机舞者',cause:'项目没有舞者可选',next:'先添加舞者再检查'});
    else if(!info.profileBound)problems.push({category:'resource',object:'舞者「'+info.dancerName+'」',cause:'未绑定本机档案（网页 3D 排练与游戏执行的前置资源）',next:'在资料库为该舞者关联档案后重新检查'});
    if(doc&&info.di>=0&&!(counts.mine.movement>0))problems.push({category:'blocking',object:'舞者「'+(info.dancerName||'')+'」的走位轨道',
      cause:'整场演出通道以所选舞者的启用路径为锚点，当前没有启用路径，无法生成整场审阅',
      next:'在时间轴「走位 / 朝向」轨道编排并启用一条路径后重新检查；纯动作 / 套装 / 技能项目无需整场通道，切到「游戏角色」模式用日常游戏播放即可'});
    if(durationMs!==null&&durationMs>maxShowMs)problems.push({category:'blocking',object:'整场时长',cause:'整场最长 '+(maxShowMs/1000)+' 秒（当前 '+(durationMs/1000)+' 秒），不能自动裁剪或重定时',next:'缩减编排长度后重新检查'});
    if(!info.caps)unknown.push('插件连接与能力尚未读取：执行支持范围未知（点「检查整场（只读刷新）」后判定；离线不伪造结论）');
    else{
      if(counts.counts.facing>0&&!hasCap(info.caps,'stageFacingV1'))unknown.push('插件未宣告 stageFacingV1：本场独立朝向将全部按排除处理（仅网页排练）');
      if(!hasCap(info.caps,'stageShowV2'))unknown.push('插件未宣告 stageShowV2：整场混排通道不可用，检查无法给出可执行结论');
    }
    return {binding:{projectId:info.projectId||'',projectName:info.projectName||'',timelineRevision:num(info.timelineRevision)||0,di:info.di,dancerName:info.dancerName||'',performerId:info.performerId||null},
      durationMs:durationMs,counts:counts,problems:problems,unknown:unknown,maxShowMs:maxShowMs};
  }
  // —— 整场审阅结果分桶：可执行 / 仅网页排练（其他舞者）/ 网页预览范围 / 游戏执行限制排除 / 阻断 ——
  function structureReview(whole){
    var mine=whole&&whole.path?whole.path.performerId:null;
    var out={executable:[],webRehearsal:[],webPreview:[],gameExecution:[],disabled:[],blockers:[],partial:false,
      showMs:num(whole&&whole.showMs),segmentCount:num(whole&&whole.segmentCount),facingIncluded:num(whole&&whole.facingIncluded),dancers:Array.isArray(whole&&whole.dancers)?whole.dancers:[]};
    ((whole&&whole.rows)||[]).forEach(function(r){
      var e=r&&r.event||{};
      if(r.enabled===false){out.disabled.push({id:e.id,kind:e.kind||'',reason:r.reason||'原项目已停用'});return}
      if(e.kind==='lyric'){out.webPreview.push({id:e.id,reason:r.reason||'原曲歌词仅网页显示'});return}
      if(mine!==null&&r.performerId!==undefined&&r.performerId!==mine){out.webRehearsal.push({id:e.id,kind:e.kind||'',reason:r.reason||'未绑定本地角色，仅网页排练'});return}
      if(r.supported)out.executable.push({id:e.id,kind:e.kind||'',startMs:e.startMs,durationMs:e.durationMs,reason:r.reason||''});
      else out.gameExecution.push({id:e.id,kind:e.kind||'',reason:r.reason||'本场明确排除'});
    });
    ((whole&&whole.errors)||[]).forEach(function(err){
      var text=String(err),cut=text.indexOf('：');
      var head=cut>0?text.slice(0,cut):'',looksId=head&&/^[A-Za-z0-9_-]+$/.test(head);
      out.blockers.push({object:looksId?head:'整场一致性',cause:looksId?text.slice(cut+1):text,next:'按对象修正编排后重新检查；本页不会自动修改项目、时序或舞者'});
    });
    out.partial=(out.webRehearsal.length+out.webPreview.length+out.gameExecution.length)>0;
    return out;
  }
  function n(tag,text,parent){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}
  // —— 统一入口对话框：打开零请求；显式检查只读；结论失效即标注，不作为执行依据 ——
  function open(options){
    options=options||{};
    var s=root.store;if(!s)return;
    var initial=options.di;
    if(!(initial>=0&&initial<s.dancers.length))initial=typeof root.gameActorIdx==='function'&&root.gameActorIdx()>=0?root.gameActorIdx():(s.gameActor>=0&&s.gameActor<s.dancers.length?s.gameActor:0);
    var box=n('dialog');box.setAttribute('aria-label','游戏演出整场检查');
    box.style.cssText='width:min(860px,92vw);max-height:85vh;overflow:auto;background:#172131;color:#eef3ff;padding:20px;border:1px solid #71c9b4';
    n('h3','游戏演出 · 整场检查',box);
    // TASK-20260918-PLAYER-UX-SIMPLIFY A2：intro 长文默认折叠；检查/进入流程按钮不动。
    var introFold=n('details',undefined,box);introFold.className='show-entry-intro';
    var introSum=n('summary','说明 ▸',introFold);introSum.style.cssText='cursor:pointer;color:#9fc6dd';
    n('p','统一入口：先看清本场时长与事件、哪些本机执行、哪些只排练或明确排除、什么拦住了继续；确认后进入既有准备与确认流程（审阅 → 登记 → 游戏内确认 → 开始）。本页只读：不装载、不准备、不注册、不启动任何游戏操作，打开本页不发送任何请求。',introFold);
    if(options.entry==='daily-blocked')n('p','已从日常游戏播放转入：走位与朝向不在日常播放通道执行，本场需要整场演出通道；网页排练不受影响。',box);
    var modeNote=n('p','',box);
    var row=n('div',undefined,box);
    n('span','本机舞者：',row);
    var select=n('select',undefined,row);select.setAttribute('aria-label','本机舞者');
    s.dancers.forEach(function(d,i){var o=n('option',d.name,select);o.value=String(i)});
    select.value=String(initial);
    var body=n('div',undefined,box);
    var status=n('p','',box);status.setAttribute('role','status');
    var version=0,conclusion=null,invalidated=false;
    function currentDi(){var v=Number(select.value);return v>=0&&v<s.dancers.length?v:0}
    function sig(){var d=s.dancers[currentDi()]||{};return JSON.stringify({project:s.projectId,rev:s._docRev||s._tlRevision||0,di:currentDi(),profile:d.profileId||null,dancers:s.dancers.length})}
    function doc(){try{return root.projectRecord().content}catch(e){return null}}
    function capsNow(){return s.capsOk&&s.pluginCaps?s.pluginCaps:null}
    function stale(){if(!conclusion)return false;if(conclusion.binding.signature!==sig())return true;var c=capsNow();return !!conclusion.binding.session&&(!c||c.pluginInstanceId!==conclusion.binding.session)}
    function local(){
      var di=currentDi(),d=s.dancers[di]||{};
      var who=(root.ChoreoStageMotion&&root.ChoreoStageMotion.pid)?root.ChoreoStageMotion.pid(s,di):(d.id!==undefined?'actor-'+d.id:null);
      var info={projectId:s.projectId,projectName:s.projectName,timelineRevision:s._docRev||0,di:di,dancerName:d.name||'',performerId:who,profileBound:!!d.profileId,caps:capsNow()};
      return summarize(doc(),info);
    }
    function problemLine(p){return '对象：'+p.object+'｜原因：'+p.cause+'｜下一步：'+p.next}
    function renderLocal(){
      modeNote.textContent=s.previewTarget==='game'?'当前是「游戏角色」模式：检查通过后可直接进入既有流程。':'当前是「网页 3D」模式：本检查可离线查看；进入执行前请在工具栏切换到「游戏角色」。';
      body.textContent='';
      // P5（UI-OVERHAUL）：流程位置行——本页是①，后续阶段在「游戏短演出」对话框与游戏内；只描述位置，不构成执行许可。
      n('p','流程位置：① 整场检查（本页，只读）→ ② 审阅 → ③ 确认并登记 → ④ 游戏内确认（/choreo x1 prepare → show-review → show-confirm）→ ⑤ 开始执行（show-start）→ ⑥ 保存结果与复盘'+(conclusion&&conclusion.showState?('。最近读取的游戏状态：'+(STATE[conclusion.showState]||conclusion.showState)):'。'),body);
      var t=local(),b=t.binding;
      n('h4','本次检查绑定',body);
      n('p','项目：'+(b.projectName||'—')+'（'+(b.projectId||'—')+'） · 编排版本 '+(b.timelineRevision||0)+' · 本机舞者：「'+(b.dancerName||'—')+'」'+(s.capsOk&&s.pluginCaps?' · 插件会话 '+String(s.pluginCaps.pluginInstanceId||'—').slice(0,12):' · 插件会话未读取'),body);
      n('h4','整场概览（本地计数，未读取插件）',body);
      var c=t.counts;
      n('p','时长 '+(t.durationMs!==null?t.durationMs/1000+' 秒（项目时长，上限 '+(t.maxShowMs/1000)+' 秒）':'—')+' · 事件：走位 '+c.counts.movement+'、朝向 '+c.counts.facing+'、动作 '+c.counts.motion+'、套装 '+c.counts.gearset+'、技能 '+c.counts.ability+(c.counts.other?'、其他 '+c.counts.other:'')+'、歌词 '+c.lyric
        +(c.disabled?' · 已停用 '+c.disabled+' 条（原项目即停用，不参与本场）':''),body);
      if(c.otherDancers)n('p','其他舞者事件 '+c.otherDancers+' 条：仅网页排练预览，本场逐条排除（一个客户端一次只执行所选舞者）。',body);
      n('p','以上为本地事实计数。哪些内容能进游戏执行、哪些被排除，须点「检查整场（只读刷新）」后按审阅结论显示；本页不推断。',body);
      renderProblems(t.problems,t.unknown);
    }
    function renderProblems(problems,unknown){
      if(problems&&problems.length){n('h4','阻断或缺失（须处理后才能继续）',body);problems.forEach(function(p){n('p',problemLine(p),body)})}
      if(unknown&&unknown.length){n('h4','尚未判定（读取插件后才能下结论）',body);unknown.forEach(function(u){n('p',u,body)})}
    }
    function renderConclusion(){
      if(!conclusion)return;
      if(invalidated||stale()){n('h4','检查结论已失效',body);n('p','项目、编排、所选舞者、档案绑定或插件会话已变化；旧结论不能作为执行依据。请重新点「检查整场（只读刷新）」。',body);return}
      var t=conclusion.structured;
      n('h4',conclusion.failed?'检查未完成（本地摘要仍有效）':'检查结论（只读审阅，绑定读取那一刻）',body);
      n('p','整场 '+(t.showMs!==null?t.showMs/1000+' 秒':'—')+(t.segmentCount>1?' · 路径自动切分 '+t.segmentCount+' 段（每段≤4秒/1.5米，原节点不变）':'')+(t.facingIncluded?' · 含独立朝向过渡 '+t.facingIncluded+' 段':'')+' · 本机执行 '+t.executable.length+' 条'+(t.partial?' · 明确排除 '+(t.webRehearsal.length+t.webPreview.length+t.gameExecution.length)+' 条（部分执行，不能称整场完整执行）':' · 无排除项'),body);
      if(t.dancers.length>1)n('p','多舞者：共 '+t.dancers.length+' 位；仅所选舞者绑定本地角色，其余仅网页排练并逐条排除。',body);
      function list(title,items,note){if(!items.length)return;n('h4',title+'（'+items.length+'）',body);var pre=n('pre',items.map(function(x){return x.id+' · '+(x.kind||'')+' · '+(x.reason||'')}).join('\n')||'（无）',body);pre.style.cssText='white-space:pre-wrap;line-height:1.6';if(note)n('p',note,body)}
      list('本机执行（所选舞者受支持事件）',t.executable,'按原时刻执行；技能到点尝试一次，失败继续。');
      list('仅网页排练（其他舞者）',t.webRehearsal,'本场逐条排除，不在游戏执行；不改动这些舞者的编排。');
      list('网页预览范围',t.webPreview,'原曲歌词等只在网页显示，不进入任何游戏执行通道。');
      list('游戏执行限制（明确排除）',t.gameExecution,'这些内容本场不执行且不能自动改写；保留显式选择才继续，不能称完整执行。');
      if(t.disabled.length)list('原项目已停用',t.disabled,'原项目即停用，不参与本场，也不自动启用。');
      renderProblems(t.blockers.map(function(b){return {category:'blocking',object:b.object,cause:b.cause,next:b.next}}),[]);
      n('p','状态对照：尚未开始 / 准备中 / 待确认 / 执行中 / 停止处理中 / 已完成 / 失败或结果未确认——进入流程后见「游戏短演出 · 整场审阅与结果」对话框与演前就绪检查页。',body);
      n('p','诚实边界：HTTP 成功、请求已提交或时间轴走完都不等于游戏效果成功；效果以保存后的复盘记录与实际观察为准，历史结果不授予再次开演权限。',body);
    }
    function renderAll(){renderLocal();renderConclusion();renderRecords()}
    // 显式只读检查：与「游戏短演出」对话框同一读取链（probeCaps → 定向 reconnect → ability-read），
    // 全部 GET；任一环节失败如实降级，不自动重试。
    async function runCheck(){
      var token=++version,before=sig();invalidated=false;conclusion=null;status.textContent='正在只读检查（不发送任何写入或执行请求）…';
      try{
        if(typeof root.probeCaps==='function'){try{await root.probeCaps()}catch(e){}}
        if(token!==version||before!==sig())throw Error('检查期间选择或项目已变化，请重试');
        if(!s.capsOk){renderAll();status.textContent='插件离线或不可访问：已按未知降级显示本地摘要；编辑与网页排练不受影响，连接后重新检查。';return}
        var snapshot=await root.showExecOwned().reconnect();
        if(token!==version||before!==sig())throw Error('检查期间选择或项目已变化，请重试');
        var read=snapshot.input;
        var ability=await root.apiFetch('/x1/ability-read?mode=context');
        if(token!==version||before!==sig())throw Error('检查期间选择或项目已变化，请重试');
        var di=currentDi();
        var path=root.ChoreoStageGamePlan.review(s,di,root.ChoreoEdit.pure.placementFor(s.dancers,di),read.actor,0);
        var facing=snapshot.caps.capabilities&&snapshot.caps.capabilities.indexOf('stageFacingV1')>=0;
        var whole=root.ChoreoStageShow.review(root.projectRecord().content,path,ability.context,{stageFacingV1:facing});
        if(token!==version||before!==sig())throw Error('检查期间选择或项目已变化，请重试');
        conclusion={binding:{signature:before,session:snapshot.caps.pluginInstanceId||''},structured:structureReview(whole),whole:whole,showState:snapshot.show&&snapshot.show.state};
        renderAll();
        status.textContent='检查完成（只读）。'+(conclusion.structured.blockers.length?'存在阻断项，须处理后重新检查；':'')+'进入既有流程后，装载/准备/确认/开始仍须逐项明确操作。';
      }catch(e){
        if(token!==version)return;
        conclusion={binding:{signature:sig(),session:''},structured:{executable:[],webRehearsal:[],webPreview:[],gameExecution:[],disabled:[],blockers:[{object:'整场检查',cause:e.message,next:'处理后重新点「检查整场（只读刷新）」；本页不自动重试'}],partial:false,showMs:null,segmentCount:null,facingIncluded:null,dancers:[]},whole:null,showState:null,failed:true};
        renderAll();
        status.textContent='检查未完成：'+e.message+'；已保留本地摘要，未发送任何写入或执行请求。';
      }
    }
    var flowBtn=mkButton('检查整场（只读刷新）',runCheck);
    var enter=mkButton('进入现有准备与确认流程',function(){
      var di=currentDi();closeSelf();
      if(root.ChoreoStageGameUI)root.ChoreoStageGameUI.open(di);
      else if(root.showToast)root.showToast('整场流程模块未加载');
    });
    function mkButton(text,fn){var b=n('button',text,box);b.className='btn';b.type='button';b.onclick=fn;return b}
    var closeBtn=mkButton('关闭',function(){closeSelf()});
    var recordsBox=n('div',undefined,box);
    function renderRecords(){
      recordsBox.textContent='';
      var list=(s.contentExtra&&s.contentExtra.stagePathRecords)||[];
      n('h4','结果与复盘（本项目已保存 '+list.length+' 条）',recordsBox);
      if(!list.length){n('p','此项目尚无已保存的演出结果；执行并保存后在这里复盘。',recordsBox)}
      else list.forEach(function(r){var b=n('button','复盘',recordsBox);b.className='btn';b.type='button';b.style.marginRight='6px';b.onclick=function(){if(root.ChoreoStageReplay)root.ChoreoStageReplay.open(r)}});
      n('p','复盘只读消费已保存记录；历史结果不授予再次开演权限。',recordsBox);
    }
    function closeSelf(){try{box.close()}catch(e){}if(box.onclose)box.onclose()}
    select.onchange=function(){version++;conclusion=null;invalidated=false;renderAll();status.textContent='已切换舞者；请重新检查整场。'};
    box.onclose=function(){version++;if(box._closed)return;box._closed=true;box.remove()};
    renderAll();
    document.body.appendChild(box);if(root.ChoreoWorkbench&&root.ChoreoWorkbench.showSafetyDialog)root.ChoreoWorkbench.showSafetyDialog(box);else box.showModal();
    return {box:box,rerender:function(){if(box.isConnected){renderAll()}},invalidate:function(){version++;invalidated=true;if(box.isConnected)renderAll()}};
  }
  var active=null;
  root.ChoreoShowEntry={summarize:summarize,countEvents:countEvents,structureReview:structureReview,STATE:STATE,
    open:function(options){if(active&&active.box&&active.box.isConnected)active.box.close&&active.box.close();active=open(options);return active},
    invalidate:function(){if(active&&active.invalidate)active.invalidate()}};
  if(typeof module!=='undefined')module.exports=root.ChoreoShowEntry;
})(typeof window!=='undefined'?window:globalThis);
