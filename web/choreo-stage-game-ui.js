// 单人路径审阅和执行记录：复用定向演出生命周期、立即停止与项目扩展保存。
(function(root){
  'use strict';var active=null,request=null;var saveResult=root.ChoreoStageRecovery.createSaver();
  function invalidateChanged(){
    // D4b（返工）：编排变化时先刷新活动对话框的阶段条（仅展示；sig 已变会让②如实显示受阻），
    // 再走原有取消判定——取消协议本身零改动。
    try{if(active&&active.invalidateView)active.invalidateView()}catch(e){}
    if(!request||request.invalidated||request.projectId===root.store.projectId&&request.signature===request.signatureNow())return;
    request.invalidated=true;var owner=root.showExecOwned();
    if(owner.state().clientLoadId!==request.clientLoadId||owner.state().packageId!==request.packageId)return;
    owner.cancelLocal();owner.stopStage().then(function(){root.showToast('项目或编排已变化，旧路径登记已取消；请重新审阅登记')},function(e){root.showToast('旧确认已作废，但插件停止未确认：'+e.message+'。请在游戏面板立即停止')});
  }
  function n(tag,text,parent){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}
  function open(di){
    if(active)active.remove();var s=root.store,project=s.projectId,box=n('dialog');active=box;
    box.setAttribute('aria-label','游戏单人路径');box.style.cssText='width:min(760px,90vw);max-height:85vh;overflow:auto;background:#172131;color:#eef3ff;padding:20px;border:1px solid #71c9b4';
    n('h3','游戏短演出 · 整场审阅与结果',box);
    // TASK-20260918-PLAYER-UX-SIMPLIFY A2：intro 长文默认折叠；安全链按钮/确认词/登记状态不动。
    var introFold=n('details',undefined,box);introFold.className='stage-game-intro';var introSum=n('summary','说明 ▸',introFold);introSum.style.cssText='cursor:pointer;color:#9fc6dd';
    n('p','在游戏内打开 /choreo stage：选择手动模式，再点准备、查看映射、确认、明确开始和停止。原命令仍可用。协同仅支持面板列出的独立移动键；不追赶、不补时。',introFold);
    n('p','路径节点「走路 / 跑步」：整场按各节点自动切换步态执行（插件宣告 stageLocomotionAutoV1 时自动实现，未宣告时混合模式不能登记、单一模式需手动保持）。网页 3D 预览按节点时刻插值位置，不区分走/跑动画观感。',introFold);
    var select=n('select',undefined,box);select.setAttribute('aria-label','执行舞者');s.dancers.forEach((d,i)=>{var o=n('option',d.name,select);o.value=i});select.value=di;
    var scope=n('select',undefined,box);scope.setAttribute('aria-label','本次执行范围');
    if(root.ChoreoStageShow){var full=n('option','所选舞者：动作 + 自身技能 + 路径（逐条审阅排除项）',scope);full.value='show';scope.value='show';}
    var pathOnly=n('option','兼容：仅此路径，其他内容不执行',scope);pathOnly.value='path';if(!root.ChoreoStageShow)scope.value='path';
    var yaw=n('input',undefined,box);yaw.value='0';yaw.setAttribute('aria-label','舞台游戏旋转角');n('span','° 舞台旋转；将所选舞者起始点映射到本次读取的角色位置',box);
    var summary=n('pre','读取当前角色后审阅计划；不会移动角色。',box);summary.style.cssText='white-space:pre-wrap;line-height:1.6';
    // P5（UI-OVERHAUL）：常驻流程阶段条＋显著停止行——只读本对话框既有状态推导，不新增请求或轮询。
    var stageBar=n('div',undefined,box);stageBar.style.cssText='margin:8px 0;padding:8px 10px;border:1px solid #2c3d55;border-radius:6px;font-size:12px;line-height:1.9';
    var stopRow=n('div',undefined,box);stopRow.style.cssText='margin:6px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    var label,confirm;
    var daily=n('pre','当前项目：'+s.projectName+'（'+project+'）\n尚未检查插件；离线编辑和历史结果可用。',box);daily.style.whiteSpace='pre-wrap';daily.setAttribute('aria-label','日常连接状态');
    var status=n('p','',box);status.setAttribute('role','status');var review=null,signature='',version=0,session='',context='',busy=false,working=0,polling=false,lastSnapshot=null,staleReason='';
    function current(){if(root.store!==s||s.projectId!==project||!box.isConnected)throw Error('项目或面板已变化，旧操作已取消')}
    function sig(){return JSON.stringify({project:s.projectId,dancers:s.dancers,lyrics:s.globalLyrics,markers:s.markers,tracks:root.ChoreoStageMotion.tracks(s),di:select.value,yaw:yaw.value,scope:scope.value})}
    function button(text,fn,parent){var b=n('button',text,parent||box);b.className='btn';b.type='button';b.onclick=async()=>{working++;b.disabled=true;try{current();await fn()}catch(e){status.textContent=e.message}finally{working--;b.disabled=false;renderStages()}};return b}
    // —— P5：流程阶段条（① 连接→② 审阅→③ 登记确认→④ 游戏内确认→⑤ 执行→⑥ 结果）。
    // 状态只由既有变量推导（capsOk/session/最近快照/review 与签名/request/确认框/已存记录数）；
    // 渲染点=connection()/invalidate()/按钮完成钩子/打开末尾/invalidateChanged 视图钩子，不新增请求或自动执行。
    // 返工 D1–D4（2026-09-21 退回单）：③⑥ 只认「本项目+本会话+快照可见」的登记/保存；① 刷新失败不得
    // 冒充已连接；④ 让位于已观察的执行/终态；② 被作废时带原因显示受阻。全部仅展示层。 ——
    // 二次返工 R2-D1（2026-09-21 退回单）：③ 的执行/终态让位同样先过身份门——跨项目重读他人终态、
    // 换实例执行态都不算本页登记完成；观察到的游戏态仍由④⑤与日常状态行如实呈现，不隐瞒。 ——
    function stageRows(){
      var show=lastSnapshot&&lastSnapshot.show||{},input=lastSnapshot&&lastSnapshot.input||{},ck=!!(confirm&&confirm.checked);
      var reviewOk=false;if(review){try{reviewOk=signature===sig()}catch(e){reviewOk=false}}
      var executing=['countdown','playing','stopping'].indexOf(show.state)>=0,ended=['completed','faulted'].indexOf(show.state)>=0;
      var mine=request&&!request.invalidated&&request.projectId===project&&session&&request.instanceId===session?request:null;
      var registered=!!mine&&!!lastSnapshot&&(lastSnapshot.owned===true||executing||ended||show.state==='loaded'||show.state==='armed');
      var rows=[];
      function row(no,name,state,hint){rows.push({no:no,name:name,state:state,hint:hint})}
      if(!s.capsOk)row('①','连接','blocked','插件未连接：点「重新连接 / 刷新状态」');
      else if(!session)row('①','连接','current','点「重新连接 / 刷新状态」读取插件与角色');
      else if(!lastSnapshot)row('①','连接','blocked','最近一次读取未完成：不能当作当前连接；点「重新连接 / 刷新状态」'); // D2：刷新失败≠已连接
      else row('①','连接','done','插件已连接 · 角色 #'+(input.actor&&input.actor.id!=null?input.actor.id:'不可读')+(input.gameReadable===false?'（当前不可读）':''));
      if(!review){
        if(staleReason)row('②','审阅','blocked',staleReason); // D4a：被作废的审阅带原因受阻，不冒充未开始
        else row('②','审阅',s.capsOk?'current':'pending','点「读取角色并生成审阅计划」逐条核对范围与排除项');
      }
      else if(!reviewOk)row('②','审阅','blocked','编排或选择已变化：重新读取并审阅');
      else row('②','审阅','done','已生成：'+(review.dancerName||'—')+' → 角色 #'+(review.actor&&review.actor.id!=null?review.actor.id:'—'));
      if(registered)row('③','登记','done',ended?'本场已结束；重演须重新审阅登记':executing?'游戏侧本场进行中（见⑤）':'本页已登记本场范围，尚未开始'); // R2-D1：执行/终态让位仅在身份门内
      else if(reviewOk)row('③','登记','current',ck?('点「'+(root.ChoreoStageShow?'确认并登记本场':'确认并登记此路径')+'」'):'先勾选下方确认词，再点登记');
      else row('③','登记','pending','先完成②审阅');
      if(executing)row('④','游戏内确认','done','本场执行中（见⑤）'); // D3：执行中不再指路重复确认
      else if(ended)row('④','游戏内确认','done','本场已结束；如需重演须重新登记并重新确认');
      else if(show.stageMappingConfirmed===true)row('④','游戏内确认','done','游戏内已确认映射（尚未消费）；/choreo x1 show-start 开始一次');
      else if(registered||show.state==='loaded'||show.state==='armed')row('④','游戏内确认','current','游戏内：/choreo x1 prepare → show-review → show-confirm');
      else row('④','游戏内确认','pending','③登记后在此确认');
      if(['countdown','playing'].indexOf(show.state)>=0)row('⑤','执行','current',(show.state==='countdown'?'倒数中':'执行中')+'；需要时点「立即停止」');
      else if(show.state==='stopping')row('⑤','执行','current','停止处理中');
      else if(ended)row('⑤','执行','done',show.state==='completed'?'本场已结束':'已停止（发生失败或结果未确认）');
      else row('⑤','执行','pending','游戏内 /choreo x1 show-start 开始一次');
      var savedCount=(s.contentExtra&&s.contentExtra.stagePathRecords||[]).length;
      if(mine&&mine.savedMessage)row('⑥','结果','done','本次结果已保存；历史结果不恢复执行许可'); // D1：只认本项目的保存
      else if(ended)row('⑥','结果','current','点「读取并保存本次结果」');
      else row('⑥','结果','pending','执行结束后保存并复盘（本项目已保存 '+savedCount+' 条）');
      return rows;
    }
    function renderStages(){
      stageBar.textContent='';
      var head=n('div','流程阶段（只显示位置与阻挡；每步仍须明确点击，不自动执行）',stageBar);head.style.cssText='font-weight:600;color:#e8c57a;margin-bottom:2px';
      var colors={done:'#8fd6b0',current:'#e8c57a',pending:'#8fa0b6',blocked:'#d98c8c'},marks={done:'✔',current:'▶',pending:'·',blocked:'✖'};
      stageRows().forEach(function(r){var line=n('div',r.no+' '+marks[r.state]+' '+r.name+'：'+r.hint,stageBar);line.style.cssText='color:'+colors[r.state]});
    }
    function actorKey(read){return JSON.stringify({id:read.actor?.id,area:read.actor?.territoryId,worldX:read.actor?.worldX,worldZ:read.actor?.worldZ,rotationRad:read.actor?.rotationRad,walking:read.movementReference?.IsWalking})}
    async function connection(){
      try{
      var token=version;await root.probeCaps();current();if(token!==version)throw Error('连接期间选择已变化，请重试');
      if(!s.capsOk)throw Error('连接失败：插件离线或不可访问；旧登记和结果未被当作恢复成功。请点重新连接。');
      var snapshot=await root.showExecOwned().reconnect();current();if(token!==version)throw Error('旧连接回包已失效');
      if(session&&session!==snapshot.caps.pluginInstanceId||context&&context!==actorKey(snapshot.input)||signature&&signature!==sig()){review=null;confirm.checked=false;staleReason='角色、会话或编排已变化，原审阅已作废：重新读取并审阅';}
      session=snapshot.caps.pluginInstanceId;context=actorKey(snapshot.input);lastSnapshot=snapshot;
      daily.textContent='当前项目：'+s.projectName+'（'+project+'）\n插件 '+snapshot.caps.version+' · 协议 '+snapshot.caps.protocolVersion+' · 恢复能力匹配\n角色 #'+(snapshot.input.actor?.id||'不可读')+' / 区域 '+(snapshot.input.actor?.territoryId||'不可读')+'\n登记：'+(snapshot.owned?'本页持有登记':snapshot.changed?'插件重载，旧登记已失效':'本页无登记')+' · 游戏：'+({idle:'尚未登记',loaded:'已登记，尚未开始',armed:'已就绪',countdown:'倒数中',playing:'执行中',completed:'本场已结束',faulted:'已停止，发生失败',stopping:'正在停止'}[snapshot.show.state]||snapshot.show.state)+'\n映射：'+(snapshot.show.stageMappingConfirmed?'游戏内已确认，尚未消费':snapshot.show.stageMapping?'历史映射，无执行许可':'尚未确认映射')+'\n下一步：'+(snapshot.busy?'执行或输入仍在进行；请在游戏面板查看，必要时明确停止':snapshot.owned?'已有登记；在游戏面板审阅，或点安全结束旧登记后重新登记':'点读取角色并生成审阅计划，再明确登记');
      if(request?.projectId===project){try{root.ChoreoStageRecovery.result(request,snapshot);status.textContent=request.savedMessage||'本场已结束，有待保存结果。请点读取并保存本次结果。'}catch(e){status.textContent=e.message}}
      renderStages();
      return snapshot;
      }catch(e){review=null;confirm.checked=false;lastSnapshot=null;daily.textContent='当前项目：'+s.projectName+'（'+project+'）\n状态检查未完成：'+e.message+'\n不能把上次连接状态当作当前状态。';renderStages();throw e}
    }
    box.refreshStatus=async()=>{if(working||polling||!box.isConnected)return;polling=true;try{await connection()}catch(e){status.textContent=(request?.savedMessage?request.savedMessage+'\n':'')+e.message}finally{polling=false}};
    function stageGroup(title){var g=n('div',undefined,box);g.style.cssText='margin:12px 0 2px';var h=n('h4',title,g);h.style.cssText='margin:4px 0;color:#9fc6dd';return g}
    var g1=stageGroup('① 连接：插件与当前状态');
    button('重新连接 / 刷新状态',async()=>{review=null;confirm.checked=false;version++;await connection()},g1);
    button('安全结束旧登记',async()=>{version++;review=null;confirm.checked=false;await root.showExecOwned().stopStage();await connection();status.textContent='旧登记已安全结束；请重新连接、审阅并登记。历史结果不会删除。'},g1);
    function invalidate(){version++;review=null;confirm.checked=false;staleReason='选择已改变，请重新读取并审阅';status.textContent='选择已改变，请重新读取并审阅';invalidateChanged();renderStages()}scope.onchange=select.onchange=yaw.oninput=invalidate;
    var g2=stageGroup('② 审阅：读取角色并逐条核对');
    button('立即停止',async()=>{await root.ChoreoStop.stop();status.textContent='已请求全局立即停止；确认状态见顶部停止栏'},stopRow);
    n('span','紧急情况随时可点，不限于所属阶段；确认状态见顶部停止栏',stopRow).style.cssText='font-size:12px;color:#aab6c8';
    button('读取角色并生成审阅计划',async()=>{
      var token=++version,before=sig();confirm.checked=false;
      var snapshot=await connection();current();if(token!==version||before!==sig())throw Error('能力读取期间编排变化，请重新审阅');
      if(!s.capsOk)throw Error('插件连接或能力握手不可用；尚未读取或登记路径');
      var read=snapshot.input;current();if(snapshot.busy)throw Error('执行或输入仍在进行，不能重新审阅登记');if(token!==version||before!==sig())throw Error('读取期间编排变化，请重新审阅');
      if(!read.gameReadable)throw Error('当前游戏角色不可读');
      review=root.ChoreoStageGamePlan.review(s,Number(select.value),root.ChoreoEdit.pure.placementFor(s.dancers,Number(select.value)),read.actor,Number(yaw.value));
      review.locomotion=read.movementReference?.IsWalking===true?'walk':read.movementReference?.IsWalking===false?'run':null;signature=before;staleReason='';
      var facingCap=snapshot.caps.capabilities?.includes('stageFacingV1')===true;
      if(scope.value==='show')review.warnings=['保留本场全部受支持事件的原始身份与时刻；下方逐条列出范围和限制。',
        facingCap?'独立朝向：插件已宣告 stageFacingV1，仅路径外时段的朝向过渡按原时刻执行；与路径段重叠的逐条排除（四键先转向再走），不能裁剪或重定时。路径方向与角色独立朝向是两回事。':'独立朝向仅网页排练（执行须插件宣告 stageFacingV1 后另行接入）；须明确排除，不能称完整轨道执行。路径方向与角色独立朝向是两回事。',
        '长路径按原节点自动无损切分为每段≤4秒/1.5米执行；整场最长5分钟，到点不追赶，不改速、不延时、不循环。',
        '移动模式：路径各节点走/跑逐段自动切换步态（插件宣告 stageLocomotionAutoV1 时游戏内自动实现；未宣告时混合模式不能登记、单一模式需开演前手动保持该步态）。网页预览不区分走/跑动画观感。'];
      summary.textContent='舞者：'+review.dancerName+' → 角色 #'+review.actor.id+' / 区域 '+review.actor.territoryId+'\n'+review.points.map((p,i)=>i+' · '+p.tMs/1000+'秒 · 舞台('+p.x+', '+p.z+') → 游戏('+p.worldX.toFixed(3)+', '+p.worldZ.toFixed(3)+') · 编排朝向 '+p.yawDeg+'° · '+(i?(p.move==='run'?'跑步':'走路'):'起点')).join('\n')+'\n总路程 '+review.distanceM.toFixed(3)+'米 · '+review.durationMs/1000+'秒\n'+review.segments.map((p,i)=>(i+1)+'段 '+p.speedMps.toFixed(3)+'米/秒 · '+(p.move==='run'?'跑步':'走路')+' · 游戏方向 '+(p.bearingDeg===null?'停留':p.bearingDeg.toFixed(1)+'°')).join('\n')+(review.gaitWarnings&&review.gaitWarnings.length?'\n速度与移动模式矛盾提示（社区实测参考值，明确提示不静默）：\n'+review.gaitWarnings.join('\n'):'')+'\n'+review.warnings.join('\n');
      if(scope.value==='show'){
        var ability=await root.apiFetch('/x1/ability-read?mode=context');current();if(token!==version||before!==sig())throw Error('读取期间项目或范围变化，旧审阅已取消');
        review.whole=root.ChoreoStageShow.review(root.projectRecord().content,review,ability.context,{stageFacingV1:facingCap});
        // 多舞者呈现：所选舞者绑定本地角色可执行，其余仅网页排练并逐条排除；单舞者显示保持原样。
        var ds=review.whole.dancers||[],multi=ds.length>1;
        if(multi)summary.textContent+='\n\n多舞者（共 '+ds.length+' 位）：\n'+ds.map(x=>'· '+x.name+' — '+(x.executable
          ?'绑定本地角色 #'+review.actor.id+'，本场受支持事件按原时刻执行'
          :'未绑定本地角色，仅网页排练预览；本场 '+x.excludedCount+' 条逐条排除，不在游戏执行')).join('\n');
        summary.textContent+='\n\n项目：'+s.projectName+'（'+project+'）\n本场逐条审阅：\n'+review.whole.rows.map(x=>(multi&&x.dancerName?x.dancerName+' · ':'')+x.event.id+' · '+x.event.kind+' · '+x.event.startMs/1000+'秒 / '+x.event.durationMs/1000+'秒 · '+(x.event.command||x.event.name||x.event.data?.rehearsalAbility?.actionId||'')+' · '+x.reason).join('\n');
        if(review.whole.errors.length)summary.textContent+='\n不能登记：\n'+review.whole.errors.join('\n');
        if(review.whole.segmentCount>1)summary.textContent+='\n路径自动切分：'+review.whole.segmentCount+' 段（每段≤4秒/1.5米；原节点时刻与坐标不变，自动补插值点）。';
        summary.textContent+=facingCap
          ?'\n独立朝向仅路径外时段逐段执行（已宣告 stageFacingV1；重叠段逐条排除）；实际转身效果仍须逐条观察，能力可执行不等于已验收。技能到点尝试一次，失败继续，不检查冷却、充能或前置条件；游戏安全边界仍可停止整场。'
          :'\n独立朝向和其他排除项均不执行。技能到点尝试一次，失败继续，不检查冷却、充能或前置条件；游戏安全边界仍可停止整场。';
      }
      status.textContent='仅生成审阅。容差0.12米、修正意图上限0.05米；每段实际路程≤1.5米，长路径自动切分执行；各节点走/跑按上述审阅逐段执行。';
    },g2);
    // 演前就绪检查入口：只读打开就绪检查页（choreo-stage-readiness.js），携带当前审阅结论；不新增按钮体系。
    button('演前就绪检查',async()=>{if(root.ChoreoStageReadiness)root.ChoreoStageReadiness.open({getReview:function(){return review}})},g2);
    var g3=stageGroup('③ 确认并登记（须先勾选确认词；安全链不变）');
    label=n('label',undefined,g3);label.style.cssText='display:block;margin:4px 0;line-height:1.6';confirm=n('input',undefined,label);confirm.type='checkbox';confirm.setAttribute('aria-label','确认角色映射与仅路径验收');n('span','确认当前角色对应所选舞者，并明确选择以上范围；已逐条审阅所有排除项，独立朝向不执行，不称完整轨道执行。',label);confirm.onchange=renderStages;
    button(root.ChoreoStageShow?'确认并登记本场':'确认并登记此路径',async()=>{
      if(!review||!confirm.checked||sig()!==signature)throw Error('请先审阅并确认本次角色映射与执行范围');
      if(busy)throw Error('已有登记操作正在处理');var token=version,snapshot=await connection(),caps=snapshot.caps;current();if(token!==version||!review||!confirm.checked||sig()!==signature)throw Error('计划已变化');
      if(!caps.capabilities?.includes('stagePathNativeConfirmV1'))throw Error('插件尚未提供游戏内映射确认能力，请更新并重载');
      if(scope.value==='show'&&!caps.capabilities?.includes('stageShowV2'))throw Error('插件尚未提供整场短演出能力，请更新并重载');
      if(scope.value==='show'&&review.whole?.facingIncluded>0&&!caps.capabilities?.includes('stageFacingV1'))throw Error('审阅时插件已宣告独立朝向能力，登记时已消失；请重新连接并审阅');
      // TASK-20260919-PATH-LOCOMOTION：步态能力降级明示——未宣告自动切换时混合模式拒绝登记；单一模式允许但要求手动保持（运行时硬闸仍在插件）。
      var autoLoco=caps.capabilities?.includes('stageLocomotionAutoV1')===true;
      var nodeModes=Array.from(new Set((review.points||[]).slice(1).map(p=>p.move==='run'?'run':'walk')));
      if(!autoLoco&&nodeModes.length>1)throw Error('当前插件未宣告 stageLocomotionAutoV1（不会自动切换步态），本场走/跑混合模式不能登记：请统一各节点模式，或更新插件后重新审阅');
      var opts={pathOnly:true,supportedScope:true,arrivalToleranceM:.12,maxCorrectionM:.05};
      var pkg=scope.value==='show'?root.ChoreoStageShow.packageFor(review.whole,opts):root.ChoreoStageGamePlan.packageFor(review,opts);
      busy=true;var loaded;try{loaded=await root.showExecOwned().load(pkg,session)}finally{busy=false}root._showOwnedMode=true;
      if(!box.isConnected||root.store!==s||s.projectId!==project||token!==version||sig()!==signature){await root.showExecOwned().stop();throw Error('装载期间项目或计划变化，本次登记已取消')}
      request={instanceId:session,projectId:project,review:JSON.parse(JSON.stringify(review)),package:pkg,packageId:loaded.packageId,clientLoadId:loaded.clientLoadId,signature,signatureNow:sig};
      await connection();
      var locoNote=autoLoco
        ?(nodeModes.includes('run')?'本场含跑步节点：/choreo x1 prepare 请在跑步状态下完成校准（按最快档校准防过冲），步态由插件按各节点自动切换。':'步态由插件按各节点自动切换（本场全部走路节点）。')
        :('当前插件不会自动切换步态：开演前请在游戏内手动切换为「'+(nodeModes[0]==='run'?'跑步':'走路')+'」并保持到本场结束（运行时插件仍会校验实际步态）。');
      status.textContent='已登记所审阅的本场范围，尚未输出且不能开始。'+locoNote+'回到游戏 /choreo x1 prepare（会短暂移动）；随后 /choreo x1 show-review 查看当前站位映射，/choreo x1 show-confirm 明确确认当前角色位置对应舞者起点，最后 /choreo x1 show-start 开始一次。无需回旧起点；原项目节点和时刻不变。离开游戏前台会作废准备。';
    },g3);
    var g6=stageGroup('⑥ 结果：保存与复盘（技能/动作逐条结果在复盘中呈现）');
    var records=n('pre','',g6);records.style.whiteSpace='pre-wrap';
    // 每条已保存记录一个复盘入口：只读打开演出复盘视图（choreo-stage-replay.js），不新增按钮体系。
    var replayBar=n('div','',g6);
    function saved(){records.textContent=(s.contentExtra?.stagePathRecords||[]).map(r=>r.savedAt+' · '+r.review.dancerName+' · '+r.report.Status
      +(r.report.ManualMode?'\n手动模式：'+(r.report.ManualMode==='Cooperate'?'手动与自动协同':'手动打断自动')+' · 介入 '+r.report.ManualInterventions+' / 续走 '+r.report.ManualResumptions:'')
      +(r.mapping?.summary?'\n历史映射（只读）：'+r.mapping.summary.split('\n确认当前')[0]:'')
      +(Number.isFinite(r.report.TotalDistanceM)?'\n实际累计 '+r.report.TotalDistanceM.toFixed(3)+'米':'')
      +(Number.isFinite(r.report.FinalDistanceToTargetM)?' · 终点误差 '+r.report.FinalDistanceToTargetM.toFixed(3)+'米':'')
      +(r.showResult?.events?'\n本场逐条结果：\n'+r.showResult.events.map(e=>e.id+' · '+e.kind+' · '+e.plannedMs+'ms → '+e.dispatchedMs+'ms · '+e.reason).join('\n'):'')
      +(r.showResult?.stopReason?'\n演出停止原因：'+r.showResult.stopReason:'')
      +'\n历史记录不恢复执行许可；实际移动和朝向须另行观察。').join('\n\n')||'此项目没有已保存的路径结果';
      replayBar.textContent='';
      (s.contentExtra?.stagePathRecords||[]).forEach(r=>{var b=n('button','复盘',replayBar);b.className='btn';b.type='button';b.style.marginRight='6px';b.onclick=()=>{if(root.ChoreoStageReplay)root.ChoreoStageReplay.open(r)}})}
    button('读取并保存本次结果',async()=>{
      if(!request||request.projectId!==project)throw Error('此页面没有本项目的路径请求；下方可离线回看历史');var expected=request;
      var snapshot=await connection();current();if(request!==expected)throw Error('请求已经改变');
      status.textContent='正在保存结果到 '+s.projectName+'（'+project+'）…';
      var savedResult=await saveResult({store:s,request:expected,snapshot,current:function(){current();if(request!==expected)throw Error('请求已变化；保存仅针对捕获的原项目')},
        projectRecord:root.projectRecord,saveActive:root.ChoreoProjects.saveActive});
      saved();status.textContent=expected.savedMessage='保存成功：'+savedResult.projectName+'（'+savedResult.projectId+'）。'+(savedResult.duplicate?'未重复添加结果。':'')+'历史结果不恢复执行许可。';
    },g6);
    button('关闭',async()=>box.close());box.invalidateView=function(){if(box.isConnected)renderStages()};box.onclose=()=>{version++;box.remove();if(active===box)active=null};document.body.appendChild(box);if(root.ChoreoWorkbench&&root.ChoreoWorkbench.showSafetyDialog)root.ChoreoWorkbench.showSafetyDialog(box);else box.showModal();saved();renderStages();if(s.gameConnected)box.refreshStatus();
  }
  root.ChoreoStageGameUI={open,invalidateChanged,refreshStatus:function(){if(active?.refreshStatus)return active.refreshStatus()}};
})(window);
