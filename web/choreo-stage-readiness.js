// 演前就绪检查页（只读）：一屏汇总"开演前还差什么"——插件连接与能力（stageShowV2/stageFacingV1/
// stagePathNativeConfirmV1 等逐一核对）、当前角色可读性与区域、步态读数、本次审阅结论（错误清单、
// 自动切分段数、独立朝向包含数与能力匹配、逐条排除项）、登记/映射确认/执行状态、校准（prepare，
// 会短暂移动角色、离开游戏前台会作废）与手动模式说明。每项 通过/未通过/无法判定 三态并给下一步建议，
// 只指向既有 prepare→show-review→show-confirm→show-start 流程，不自动执行任何步骤；
// 数据只来自既有连接刷新与本页已有审阅结论，插件离线按无法判定降级，不伪造状态。就绪=可执行≠已验收。
(function(root){
  'use strict';
  var STATE={idle:'尚未登记',loaded:'已登记，尚未开始',armed:'已就绪',countdown:'倒数中',playing:'执行中',completed:'本场已结束',faulted:'已停止，发生失败',stopping:'正在停止'};
  var OFFLINE_NEXT='启动游戏并加载 ChoreoHelper 插件后点“重新检查”，或回到“游戏走位 · 连接与结果”重新连接。';
  var PREPARE_HINT='/choreo x1 prepare 会短暂移动角色做镜头响应与转向短测；离开游戏前台会作废，需要重新准备。';
  var FLOW_HINT='既有流程：/choreo x1 prepare（会短暂移动角色；离开游戏前台会作废）→ /choreo x1 show-review（查看当前站位映射）→ /choreo x1 show-confirm（明确确认当前角色位置对应舞者起点）→ /choreo x1 show-start（明确开始一次）。本页不自动执行任何步骤。';
  var CAP_NAMES=[
    {name:'stageRecoveryV1',required:true,note:'连接恢复与结果保存'},
    {name:'ownedShowLoadV1',required:true,note:'定向装载'},
    {name:'scheduledStartV1',required:true,note:'预约开始'},
    {name:'stagePathNativeConfirmV1',required:true,note:'游戏内映射确认'},
    {name:'stageShowV2',required:true,note:'整场混排执行'},
    {name:'stagePathShowV1',required:false,note:'路径执行链（随整场能力一起宣告）'},
    {name:'stageFacingV1',required:false,note:'独立朝向（本场不含朝向过渡时非必需）'},
    {name:'stageLocomotionAutoV1',required:false,note:'按节点自动切换走/跑步态（本场走/跑混合时为必需）'}];
  function num(v){v=Number(v);return Number.isFinite(v)?v:null}
  function deg(rad){var v=num(rad);return v===null?null:v*180/Math.PI}
  function hasCap(caps,name){return !!(caps&&Array.isArray(caps.capabilities)&&caps.capabilities.indexOf(name)>=0)}
  function sec(key,title,state,lines,next){return{key:key,title:title,state:state,label:{pass:'通过',fail:'未通过',unknown:'无法判定'}[state],lines:lines||[],next:next||''}}

  // 纯函数核心：snapshot 为既有连接刷新（choreo-show-owned reconnect）的只读快照（离线为 null），
  // review 为游戏走位对话框当前审阅（未生成为 null）。逐项三态判定，不做任何网络或写操作。
  function check(snapshot,review){
    var caps=snapshot&&snapshot.caps,input=snapshot&&snapshot.input,show=snapshot&&snapshot.show;
    var whole=review&&review.whole;
    var facingNeed=!!(whole&&num(whole.facingIncluded)>0);
    // TASK-20260919-PATH-LOCOMOTION：本场节点模式统计（走/跑、是否混合）驱动能力必需性与步态区提示。
    var pathNodes=review&&Array.isArray(review.points)?review.points.slice(1):[],runCount=pathNodes.filter(function(p){return p&&p.move==='run'}).length,gaitMixed=pathNodes.length>0&&runCount>0&&runCount<pathNodes.length,gaitAuto=hasCap(caps,'stageLocomotionAutoV1');
    var capRows=CAP_NAMES.map(function(c){
      var required=c.required||facingNeed&&c.name==='stageFacingV1'||gaitMixed&&c.name==='stageLocomotionAutoV1';
      return{name:c.name,required:required,note:c.note+(facingNeed&&c.name==='stageFacingV1'?'；本场审阅包含独立朝向，为必需':'')+(gaitMixed&&c.name==='stageLocomotionAutoV1'?'；本场走/跑混合，为必需':''),declared:hasCap(caps,c.name)};
    });
    var sections=[];
    // 1 插件连接与能力
    if(!caps)sections.push(sec('plugin','插件连接与能力','unknown',['插件离线或未连接；版本、协议与能力清单都无法读取，不伪造状态。'],OFFLINE_NEXT));
    else{
      var lines=['插件 '+caps.version+' · 协议 v'+caps.protocolVersion+' · 实例 '+String(caps.pluginInstanceId||'—').slice(0,12)];
      lines.push('能力清单：'+capRows.map(function(c){return c.name+(c.declared?'已宣告':'未宣告')+(c.required?'':'（非必需）')}).join('；'));
      var missing=capRows.filter(function(c){return c.required&&!c.declared}).map(function(c){return c.name+'（'+c.note+'）'});
      if(num(caps.protocolVersion)!==1)sections.push(sec('plugin','插件连接与能力','fail',lines.concat(['协议版本不是 1，网页与插件不匹配。']),'更新网页或插件使协议一致后重新检查。'));
      else if(missing.length)sections.push(sec('plugin','插件连接与能力','fail',lines.concat(['缺必需能力：'+missing.join('、')]),'更新并重载插件后点“重新检查”；旧登记与历史结果不受影响。'));
      else sections.push(sec('plugin','插件连接与能力','pass',lines,'开演所需能力已逐一宣告。'));
    }
    // 2 当前角色可读性与区域
    if(!input)sections.push(sec('actor','当前角色可读性与区域','unknown',['插件状态未读取，角色可读性无法判定。'],OFFLINE_NEXT));
    else if(input.gameReadable===true){
      var a=input.actor||{},d=deg(a.rotationRad),x=num(a.worldX),z=num(a.worldZ);
      sections.push(sec('actor','当前角色可读性与区域','pass',
        ['角色 #'+(a.id!=null?a.id:'—')+' · 区域 '+(a.territoryId!=null?a.territoryId:'—'),
         '世界坐标 ('+(x!==null?x.toFixed(3):'—')+', '+(z!==null?z.toFixed(3):'—')+') · 朝向 '+(d!==null?d.toFixed(1)+'°':'—')+(input.gameSafe===false?' · 注意：插件安全检查未通过':'')],
        '角色可读即可继续后续步骤；执行安全由插件在开演时就绪检查把关。'));
    }
    else sections.push(sec('actor','当前角色可读性与区域','fail',
      ['当前游戏角色不可读'+(input.gameReason?'：'+input.gameReason:'')+'；不能登记或校准。'],
      '待角色可读（登录完成、脱离过场等）后点“重新检查”。'));
    // 3 步态与移动模式
    if(!input)sections.push(sec('gait','步态与移动模式','unknown',['插件状态未读取，步态无法判定。'],OFFLINE_NEXT));
    else{
      var walking=input.movementReference?input.movementReference.IsWalking:undefined;
      var gl=['movementReference.IsWalking：'+(walking===true?'true（步行）':walking===false?'false（跑步）':String(walking))];
      if(pathNodes.length)gl.push('本场路径节点：'+pathNodes.length+' 个（'+(pathNodes.length-runCount)+' 走路 / '+runCount+' 跑步）'+(gaitMixed?'，走/跑混合，逐段切换':'，单一模式')+'。');
      if(gaitMixed&&!caps)sections.push(sec('gait','步态与移动模式','unknown',gl.concat(['插件离线：无法确认自动切换步态能力（走/跑混合场为必需）。']),OFFLINE_NEXT));
      else if(gaitMixed&&!gaitAuto)sections.push(sec('gait','步态与移动模式','fail',gl.concat(['插件未宣告 stageLocomotionAutoV1：不会自动切换步态，走/跑混合本场不能执行。']),'更新并重载插件后重新检查；或把各节点统一为同一模式后重新审阅。'));
      else if(gaitAuto){
        gl.push('插件已宣告 stageLocomotionAutoV1：开演后按各节点自动切换步态（游戏中手动改步态会中断本场）。');
        if(runCount>0)gl.push('本场含跑步节点：/choreo x1 prepare 须在跑步状态下完成（按最快档校准防过冲）。');
        gl.push('网页预览不区分走/跑动画观感；模式只影响游戏内执行。');
        sections.push(sec('gait','步态与移动模式',walking===true||walking===false?'pass':'unknown',gl,'开演前保持当前角色与镜头条件；无需手动切换步态。'));
      }
      else if(pathNodes.length){
        gl.push('当前插件未宣告自动切换步态（stageLocomotionAutoV1）：开演前请手动切换为「'+(runCount===0?'走路':'跑步')+'」并保持到本场结束；运行时插件仍校验实际步态。');
        if(walking!==true&&walking!==false)sections.push(sec('gait','步态与移动模式','unknown',gl.concat(['步态读数尚无结论（null 或缺字段），不伪造。']),'在游戏中实际走动或跑动一次后再读取，或按上一行手动保持要求执行。'));
        else if(walking!==(runCount!==pathNodes.length))sections.push(sec('gait','步态与移动模式','fail',gl,'当前实际步态与本场单一模式不一致：请在游戏内手动切换为「'+(runCount===pathNodes.length?'跑步':'走路')+'」后重新检查。'));
        else sections.push(sec('gait','步态与移动模式','pass',gl,'步态与模式一致，可继续后续步骤。'));
      }
      else sections.push(sec('gait','步态与移动模式',walking===true||walking===false?'pass':'unknown',gl.concat(['本场没有路径节点，步态不参与执行。']),'开演前保持当前角色与镜头条件。'));
    }
    // 4 本次审阅结论（本页本地数据；插件离线也如实显示）
    if(!review)sections.push(sec('review','本次审阅结论','unknown',
      ['本页尚未生成审阅计划（或已因项目/编排变化作废）。'],
      '回到“游戏走位 · 连接与结果”，选择舞者与执行范围后点“读取角色并生成审阅计划”，逐条审阅排除项。'));
    else if(!whole)sections.push(sec('review','本次审阅结论','pass',
      ['兼容仅路径范围：本场只执行此路径，动作、技能与独立朝向不包含（其他内容不执行）。'
        +(review.dancerName?'舞者：'+review.dancerName:'')
        +(pathNodes.length?' · 模式：'+(pathNodes.length-runCount)+' 走 / '+runCount+' 跑（单一执行段只支持统一模式）':'')
        +(num(review.durationMs)!==null?' · 时长 '+(review.durationMs/1000)+' 秒':'')
        +(num(review.distanceM)!==null?' · 总路程 '+review.distanceM.toFixed(3)+' 米':'')],
      '如需整场（动作 + 自身技能 + 路径）或走/跑混合逐段执行，在游戏走位对话框改选"所选舞者"范围并重新审阅。'));
    else{
      var rl=['审阅范围：'+(review.dancerName||'—')+'（整场） · 事件 '+((whole.rows||[]).length)+' 条 · 整场 '+(num(whole.showMs)!==null?whole.showMs/1000+' 秒':'—')];
      // 多舞者范围行：仅所选舞者绑定本地角色可执行；旧记录缺 dancers 字段时不显示、不伪造。
      var dl=Array.isArray(whole.dancers)?whole.dancers:[],bl=dl.filter(function(x){return x&&x.executable});
      if(dl.length>1)rl.push('多舞者：共 '+dl.length+' 位；'+(bl.length===1?'仅「'+(bl[0].name||bl[0].performerId)+'」绑定本地角色可执行，':'')+'其余 '+(dl.length-bl.length)+' 位仅网页排练，逐条排除。');
      if(num(whole.segmentCount)>1)rl.push('路径自动切分：'+whole.segmentCount+' 段（每段≤4秒/1.5米；原节点时刻与坐标不变，自动补插值点）。');
      if(pathNodes.length)rl.push('路径移动模式：'+pathNodes.length+' 个节点（'+(pathNodes.length-runCount)+' 走 / '+runCount+' 跑）'+(gaitMixed?'，逐段自动切换步态；':'，单一模式；')+(caps?(gaitAuto?'插件已宣告 stageLocomotionAutoV1（自动切换）':'插件未宣告 stageLocomotionAutoV1（须手动保持单一模式）'+(gaitMixed?'，混合模式不能登记':'')):'插件离线无法判定（见插件连接区）'));
      if(review.gaitWarnings&&review.gaitWarnings.length)rl.push('速度与模式矛盾提示（社区实测参考，不静默）：'+review.gaitWarnings.join('；'));
      var fi=num(whole.facingIncluded);
      rl.push(fi>0
        ?'独立朝向包含 '+fi+' 段过渡，能力匹配：'+(caps?(hasCap(caps,'stageFacingV1')?'插件已宣告 stageFacingV1':'插件未宣告 stageFacingV1，能力不匹配'):'插件离线无法判定（见插件连接区）')
        :'独立朝向：本场无受支持朝向过渡');
      var excluded=(whole.rows||[]).filter(function(r){return r.enabled!==false&&!r.supported});
      rl.push(excluded.length?'排除项（逐条，须知悉后才能登记）：'+excluded.map(function(x){return x.event.id+'：'+x.reason}).join('；'):'无排除项。');
      if((whole.errors||[]).length)sections.push(sec('review','本次审阅结论','fail',rl.concat(['不能登记：'+whole.errors.join('；')]),'按错误清单修正编排后重新读取角色生成审阅计划；不能裁剪或重定时。'));
      else if(facingNeed&&caps&&!hasCap(caps,'stageFacingV1'))sections.push(sec('review','本次审阅结论','fail',rl,
        '独立朝向能力与审阅时不一致（审阅时已宣告，现已消失）：重新连接并重新审阅登记。'));
      else sections.push(sec('review','本次审阅结论','pass',rl,'有排除项时请逐条知悉；排除项不执行，不能称完整轨道执行。'));
    }
    // 5 登记/映射确认/执行状态
    if(!show)sections.push(sec('registration','登记 · 映射确认 · 执行状态','unknown',['插件状态未读取，登记与映射无法判定。'],OFFLINE_NEXT));
    else{
      var ml=['游戏：'+(STATE[show.state]||show.state)+(show.stopReason?' · 停止原因：'+show.stopReason:''),
        '网页登记：'+(snapshot.owned?'本页持有登记':snapshot.changed?'插件已重载，旧登记已失效':'本页无登记')];
      if(show.x1Registration)ml.push('登记信息：角色 #'+show.x1Registration.actorId+' / 区域 '+show.x1Registration.territoryId
        +(show.x1Registration.independentFacing?' · 含独立朝向链':'')+(show.x1Registration.mixedShow?' · 整场混排':''));
      if(snapshot.busy)sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',
        ml.concat(['执行或输入仍在进行（持有键、输入租约或待处理请求未释放）。']),'在游戏面板查看，必要时明确停止后再点“重新检查”。'));
      else if(snapshot.changed)sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',ml,
        '插件已重载：重新连接、重新审阅并登记；历史结果不受影响。'));
      else if(['playing','countdown','stopping'].indexOf(show.state)>=0)sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',ml,
        '本机正在执行：等待结束后保存结果，或需要时立即停止。'));
      else if(['completed','faulted'].indexOf(show.state)>=0)sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',ml,
        '本场已结束：保存结果后如需重演，须重新审阅登记并重新确认映射。'));
      else if(show.stageMappingConfirmed===true)sections.push(sec('registration','登记 · 映射确认 · 执行状态','pass',
        ml.concat(['映射：游戏内已确认，尚未消费（一次明确开始后消费）。']),
        '可在游戏内 /choreo x1 show-start 开始一次；先完成其他未通过项更稳妥。'));
      else if(show.stageMapping)sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',
        ml.concat(['映射：历史映射，无执行许可。']),
        '在游戏内 /choreo x1 show-review 查看当前站位映射，再 /choreo x1 show-confirm 明确确认。'));
      else if(show.state==='loaded'||show.state==='armed')sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',
        ml.concat(['映射：尚未确认。']),
        '在游戏面板选择手动模式并点准备（prepare），随后 show-review、show-confirm，最后 show-start。'));
      else sections.push(sec('registration','登记 · 映射确认 · 执行状态','fail',ml,
        '在“游戏走位 · 连接与结果”审阅后点“确认并登记本场”。'));
    }
    // 6 校准（prepare）状态
    if(!input)sections.push(sec('calibration','校准（准备）状态','unknown',['插件状态未读取，校准无法判定。'],OFFLINE_NEXT));
    else if(!input.calibration)sections.push(sec('calibration','校准（准备）状态','unknown',
      ['插件未上报校准块（旧版本插件？），不伪造；原生就绪检查仍会在开演时把关。'],OFFLINE_NEXT));
    else{
      var cal=input.calibration,cs=num(cal.completedSamples),rs=num(cal.requiredSamples);
      var cl=['转向键校准：'+(cal.complete?'完成':(cs!==null||rs!==null)?'未完成（'+(cs!==null?cs:'?')+'/'+(rs!==null?rs:'?')+'）':'未完成')];
      if(cal.message)cl.push('插件说明：'+cal.message);
      cl.push('键位规则：'+(cal.turnThenMove===true?'四键模式——先转向再走':cal.turnThenMove===false?'全向键——可直接移动':'未知'));
      if(!cal.complete&&input.cameraPreparation&&input.cameraPreparation.lastAttempt)cl.push('存在上次 prepare 尝试记录（不证明当前有效）。');
      if(facingNeed)cl.push('本场含独立朝向：就绪要求转向校准完成（与原生就绪检查同口径）。');
      cl.push(PREPARE_HINT);
      if(cal.complete&&cal.validForCurrentState===true)sections.push(sec('calibration','校准（准备）状态','pass',cl,
        '校准有效；不要改键位或离开游戏前台，直接继续后续步骤。'));
      else if(cal.complete)sections.push(sec('calibration','校准（准备）状态','fail',
        cl.concat(['校准已完成但与当前键位/状态不匹配（改键、切走或重载后作废）。']),'重新 /choreo x1 prepare 完成校准。'));
      else sections.push(sec('calibration','校准（准备）状态','fail',cl,
        '在游戏内 /choreo x1 prepare 完成校准（会短暂移动角色；离开游戏前台会作废）。'));
    }
    // 7 手动模式选择与说明
    if(!input||!input.stageManual)sections.push(sec('manual','手动模式选择与说明','unknown',['插件状态未读取，手动模式无法判定。'],OFFLINE_NEXT));
    else{
      var sm=input.stageManual;
      var sl=['当前模式：'+(sm.mode==='Cooperate'?'手动与自动协同（Cooperate）':sm.mode==='Interrupt'?'手动打断自动（Interrupt）':String(sm.mode))];
      if(sm.description)sl.push('说明：'+sm.description);
      if(sm.mode==='Cooperate')sl.push('协同接受的独立移动键：'+(sm.cooperativeKeys&&sm.cooperativeKeys.length?sm.cooperativeKeys.join('、'):'（无）'));
      if(sm.mode==='Cooperate'&&!(sm.cooperativeKeys&&sm.cooperativeKeys.length))sections.push(sec('manual','手动模式选择与说明','fail',sl,
        '当前键位没有与自动三键分离的移动键，不能安全协同：改选打断模式或调整键位后在游戏面板重新选择。'));
      else sections.push(sec('manual','手动模式选择与说明','pass',sl,
        '模式在游戏 /choreo stage 面板选择；改模式会作废已确认的映射，需重新确认。'));
    }
    return{
      offline:!caps,sections:sections,caps:capRows,
      ready:!!caps&&sections.every(function(s){return s.state==='pass'}),
      boundary:'就绪=可执行≠已验收：本页只汇总“开演前还差什么”，全部通过只代表可以按既有流程开演，不代表游戏效果已验收（实际转身、折线、≥2段长演出仍在统一验收清单）。',
      offlineNote:!caps?'插件离线/未连接：能力清单、角色可读性、步态、登记/映射、校准、手动模式均无法判定，不伪造状态；仅“本次审阅结论”来自本页本地数据。':''
    };
  }

  function n(tag,text,parent){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}

  // 就绪检查对话框：打开时若已连接则走一次既有连接刷新（probeCaps + 定向 reconnect，全部只读 GET）。
  // 不自动发起 prepare/show-start/停止等任何游戏输出；刷新失败按无法判定降级，不把上次状态当当前状态。
  function open(options){
    options=options||{};
    var getReview=typeof options.getReview==='function'?options.getReview:function(){return null};
    var box=n('dialog');box.setAttribute('aria-label','演前就绪检查');
    box.style.cssText='width:min(860px,92vw);max-height:85vh;overflow:auto;background:#172131;color:#eef3ff;padding:20px;border:1px solid #71c9b4';
    n('h3','演前就绪检查（只读）',box);
    // P5（UI-OVERHAUL）：流程位置说明——②审阅组的入口在登记前后均可打开本页（如实描述既有入口，D5 返工修正）；静态文字，不判定状态。
    n('p','本页在流程中的位置：开演前的最后一遍只读核对——从②审阅组「演前就绪检查」入口打开，③确认与登记的前后都可以用（越晚越接近真实状态）；核对的是 ④ 游戏内确认（prepare → show-review → show-confirm）与 ⑤ 开始执行 之前还差什么。全部通过＝可以按既有流程开演，本页不自动执行任何步骤。',box).style.cssText='color:#9fc6dd';
    var summary=n('p','',box);summary.setAttribute('role','status');
    var body=n('div',undefined,box);
    var status=n('p','',box);status.setAttribute('role','status');
    function render(snapshot){
      var r=check(snapshot,getReview());
      body.textContent='';
      summary.textContent=r.ready
        ?'当前读取下全部就绪项通过：可以按既有流程开演。'
        :'仍有未通过或无法判定项，见下方逐项与下一步建议。';
      n('p','每项判定三态：通过 / 未通过 / 无法判定（无法判定=当前读不到，不等于通过）。'+(r.offline?' '+r.offlineNote:''),body);
      n('p',r.boundary,body);
      r.sections.forEach(function(s){
        n('h4',s.title+' —— '+s.label,body);
        if(s.lines.length){var pre=n('pre',s.lines.join('\n'),body);pre.style.cssText='white-space:pre-wrap;line-height:1.6;margin:6px 0'}
        if(s.next)n('p','下一步：'+s.next,body);
      });
      n('p',FLOW_HINT,body);
      n('p','纯只读：本页仅通过既有连接刷新读取 /capabilities、/x1/status、/shows/status 等只读状态；不修改项目与历史、不写坐标。',body);
    }
    var busy=false;
    async function refresh(){
      if(busy)return;busy=true;
      status.textContent='正在通过既有连接刷新读取只读状态…';
      try{
        if(typeof root.probeCaps==='function'){try{await root.probeCaps()}catch(e){}}
        if(!root.store||!root.store.capsOk){
          render(null);status.textContent='插件离线或未连接：已按无法判定降级显示；不把上次连接状态当作当前状态。';
          return;
        }
        var snapshot=await root.showExecOwned().reconnect();
        render(snapshot);status.textContent='';
      }catch(e){
        render(null);status.textContent='状态检查未完成：'+e.message+'；不能把上次连接状态当作当前状态。';
      }finally{busy=false}
    }
    var btn=n('button','重新检查',box);btn.className='btn';btn.type='button';btn.onclick=refresh;
    var close=n('button','关闭',box);close.className='btn';close.type='button';close.onclick=function(){box.close()};
    box.onclose=function(){box.remove()};
    render(null);
    document.body.appendChild(box);box.showModal();
    if(root.store&&root.store.gameConnected)refresh();
  }
  root.ChoreoStageReadiness={check,open};
})(typeof window!=='undefined'?window:globalThis);
