// 技能条件只读面板：明确请求、现读七条件和过期隔离；不接入项目、历史、播放或输出。
'use strict';
(function(root){
  var NOTICE='仅本次只读观察；此检查不会释放技能或授予执行许可';
  var FIELDS=[['jobMatches','职业'],['levelMeets','等级'],['targetValid','明确目标'],['notCasting','咏唱状态'],['cooldownReady','冷却'],['movementAllowed','移动许可'],['controllable','可控性']];
  function isSkill(s){return !!s&&s.type==='action'&&Number.isSafeInteger(s.id)&&s.id>0&&s.id<=2147483647}
  function positive(s,max){return typeof s==='string'&&/^[1-9][0-9]*$/.test(s)&&BigInt(s)<=max}
  function targetText(r){
    if(!r||r.version!==1)return '目标规则未知：请连接并刷新支持目标规则的本机插件';
    var names=[['hostile','敌人'],['party','队伍成员'],['alliance','团队成员'],['ally','友方'],['self','自身'],['ownPet','自己的宠物'],['partyPet','队伍宠物']];
    var allowed=names.filter(p=>r[p[0]]===true).map(p=>p[1]);
    return '技能允许目标：'+(allowed.join('、')||'未提供可用对象类别')+'。'+(r.area?'地面目标技能：此面板不选择地面位置。':r.unselectedSelfAllowed?'无手选目标时可选择检查自身；不会改变游戏目标。':'必须选择技能允许的目标，不能无目标改用自身。');
  }
  function validate(skill,input){
    if(!isSkill(skill))return '缺少真实技能 Action 编号，不能按名称、表情或 /ac 文本猜测';
    if(!positive(input.targetId,18446744073709551615n))return '缺少明确目标编号：先在游戏内手动选中目标，再填写所显示的编号';
    if(!positive(input.jobId,4294967295n))return '缺少明确要求的职业行编号';
    if(!positive(input.level,100n))return '缺少明确最低等级（1–100）';
    return '';
  }
  function create(opts){
    var generation=0, sequence=0, context=null, result=null, message='尚未读取当前游戏', reading=false;
    var contextAt=0,resultAt=0,project=opts.project(),closed=false,refreshing=null,skillInfo=null;
    var now=opts.now||Date.now;
    function emit(){if(opts.changed)opts.changed(view())}
    function invalidate(reason){generation++;result=null;reading=false;message=reason;emit()}
    function guard(){
      if(closed)return false;
      if(project!==opts.project()){context=null;invalidate('项目已变化，请关闭后重新选择技能');return false}
      if(!opts.connected()){context=null;invalidate('游戏离线或连接已断开；缓存不能代表当前条件');return false}
      return true;
    }
    function view(){return {context,result,message,reading,skillInfo,notice:NOTICE}}
    // API 的传输超时不覆盖响应头之后的 JSON 正文；本面板单独限制完整只读等待。
    async function read(path){
      var timer;
      try{return await Promise.race([
        new Promise(function(resolve,reject){timer=setTimeout(function(){reject(Error('只读响应超时，请刷新当前角色后重新检查'))},3000)}),
        Promise.resolve().then(function(){return opts.read(path)})
      ])}finally{clearTimeout(timer)}
    }
    function refresh(){
      if(refreshing)return refreshing;
      refreshing=refreshOnce().finally(function(){refreshing=null});
      return refreshing;
    }
    async function refreshOnce(){
      if(!guard())return false;
      var ticket=++sequence;
      try{
        var response=await read('/x1/ability-read?mode=context&actionId='+opts.skill.id+'&_='+now());
        if(closed||ticket!==sequence||!guard())return false;
        if(response.schemaVersion!==1)throw Error('插件不支持技能只读检查 V1，请更新本机插件');
        if(response.error||!response.context||!response.context.available)throw Error(response.error||'当前角色不可读');
        skillInfo=response.skill&&response.skill.type==='action'&&response.skill.id===opts.skill.id?response.skill:null;
        if(context&&context.contextKey!==response.context.contextKey)invalidate('角色、职业、等级、区域或手选目标变化，旧结果已作废');
        context=response.context;contextAt=now();if(message==='尚未读取当前游戏')message='身份已读取，请明确填写本次要求';emit();return true;
      }catch(e){if(!closed&&ticket===sequence){context=null;skillInfo=null;invalidate('只读连接失败：'+(e.detail||e.message))}return false}
    }
    async function check(input){
      invalidate('正在检查本次明确请求…');
      if(!guard())return;
      var targetMode=input.targetMode||'selected';
      if(targetMode!=='selected'&&targetMode!=='unselectedSelf'){message='不支持的目标方式';emit();return}
      if(targetMode==='unselectedSelf'){
        var rules=skillInfo&&skillInfo.targetRules;
        if(!context||context.targetId||!rules||rules.version!==1||rules.unselectedSelfAllowed!==true){message='仅无手选目标且本机技能规则允许时可检查自身；不会替换已选目标';emit();return}
        input=Object.assign({},input,{targetId:context.actorId});
      }
      var error=validate(opts.skill,input);
      if(error){message=error;emit();return}
      if(!context||now()-contextAt>2000){message='请先刷新并核对当前角色和手选目标';emit();return}
      var request={actionId:String(opts.skill.id),targetId:input.targetId,jobId:input.jobId,level:input.level,targetMode,
        contextKey:context.contextKey,requestId:'read-'+now()+'-'+generation};
      var token=generation, started=now();reading=true;emit();
      try{
        var q=Object.keys(request).map(k=>k+'='+encodeURIComponent(request[k])).join('&');
        var r=await read('/x1/ability-read?mode=check&'+q);
        if(closed||token!==generation||!guard())return;
        if(now()-started>3000)throw Error('响应迟到，请重新检查');
        if(r.schemaVersion!==1||r.requestId!==request.requestId||r.outputEnabled!==false||r.error||
          (r.targetMode||'selected')!==targetMode)throw Error(r.error||'响应不属于本次请求');
        var p=r.report,n=p&&p.native;
        if(!r.context||r.context.contextKey!==request.contextKey||!r.skill||r.skill.type!=='action'||r.skill.id!==opts.skill.id||!r.skill.name||
          !p||!p.readAccepted||p.actionId!==request.actionId||p.explicitTargetId!==request.targetId||p.requiredJobId!==request.jobId||p.requiredLevel!==Number(request.level)||
          !n||String(n.sourceActorId)!==context.actorId||n.playerJobId!==context.jobId||n.playerLevel!==context.level||n.territoryId!==context.territoryId||
          !p.conditions||!Number.isFinite(p.readStartedAtMs)||p.readCompletedAtMs<p.readStartedAtMs||p.readCompletedAtMs-p.readStartedAtMs>100||!Number.isFinite(Date.parse(r.observedAtUtc)))throw Error('本次请求、身份或读取时间校验失败');
        // HTTP 往返期间再次读当前上下文；只复核身份，不重算七条件，也不变更目标。
        if(refreshing)await refreshing;
        if(token!==generation||!await refresh()||token!==generation||!context||context.contextKey!==request.contextKey)return;
        if(now()-started>3000)throw Error('响应迟到，请重新检查');
        result={response:r,request:request};resultAt=now();message='本次观察记录（不是实时准入）';
      }catch(e){if(token===generation){result=null;message='本次检查未完成：'+(e.detail||e.message)}}
      finally{if(token===generation){reading=false;emit()}}
    }
    function tick(){if(!guard())return;if(result&&now()-resultAt>=3000)invalidate('本次观察已过期，请重新检查');}
    return {refresh,check,tick,invalidate,view,close:function(){closed=true;generation++;sequence++;result=null;context=null}};
  }
  var activeClose=null;
  function open(opts){
    if(activeClose)activeClose();
    var skill=Object.assign({},opts.skill),box=document.createElement('div');
    box.className='ability-read-panel';box.setAttribute('role','dialog');box.setAttribute('aria-label','检查技能条件（不释放）');
    box.style.cssText='position:fixed;z-index:10000;right:24px;top:60px;width:min(540px,90vw);max-height:85vh;overflow:auto;background:#172131;color:#e6edf7;padding:20px;border:1px solid #8194b4;border-radius:10px;box-shadow:0 12px 48px #0009';
    function add(tag,text){var n=document.createElement(tag);n.textContent=text||'';box.appendChild(n);return n}
    add('h3','检查技能条件（不释放）');
    add('p','已选 Action #'+skill.id+' · '+skill.name+'（名称将由本机真实 Action 表复核）');
    add('p',NOTICE);var current=add('p','正在读取当前角色及玩家手选目标…');current.style.whiteSpace='pre-wrap';
    var rulesLine=add('p',targetText(null));
    add('p','手选目标请核对并填写编号；只有技能允许时，才可使用下方“无手选目标时检查自身”。已有目标不会被换成本人。');
    var modeLabel=add('label','本次目标方式 '),mode=document.createElement('select');mode.setAttribute('aria-label','本次目标方式');
    [['selected','检查手选目标'],['unselectedSelf','无手选目标时检查自身']].forEach(function(p){var o=document.createElement('option');o.value=p[0];o.textContent=p[1];mode.appendChild(o)});modeLabel.appendChild(mode);
    var inputs={};[['targetId','明确目标编号'],['jobId','要求职业行编号'],['level','要求最低等级（1–100）']].forEach(function(pair){
      var label=add('label',pair[1]+' ');label.style.cssText='display:block;margin:10px 0';var input=document.createElement('input');
      input.type='text';input.inputMode='numeric';input.setAttribute('aria-label',pair[1]);input.autocomplete='off';label.appendChild(input);inputs[pair[0]]=input;
    });
    var reload=add('button','刷新当前角色与手选目标'),check=add('button','检查技能条件（不释放）'),close=add('button','关闭');
    [reload,check,close].forEach(n=>{n.className='btn';n.style.margin='4px'});
    var targetHint=add('p'),output=add('div');output.setAttribute('aria-live','polite');output.style.whiteSpace='pre-wrap';
    var model=create({skill,read:opts.read,project:opts.project,connected:opts.connected,changed:function(s){
      var c=s.context;
      rulesLine.textContent=targetText(s.skillInfo&&s.skillInfo.targetRules);
      targetHint.textContent=mode.value==='unselectedSelf'?(c&&!c.targetId?'本次只读对象：本人 #'+c.actorId+'（仍需技能规则允许）':'已有手选目标或身份未知，不能改用自身'):'';
      current.textContent=c?'当前角色：'+c.actorName+' #'+c.actorId+'\n职业：'+c.jobName+' #'+c.jobId+' · 等级 '+c.level+'\n玩家手选目标：'+(c.targetId?c.targetName+' #'+c.targetId:'未选择'):'当前角色/目标未知，需连接本机插件并完成网页配对';
      output.replaceChildren();var line=document.createElement('p');line.textContent=s.message;output.appendChild(line);check.disabled=s.reading;
      if(s.result){var r=s.result.response,p=r.report;line=document.createElement('p');
        line.textContent='真实技能：Action #'+r.skill.id+' · '+r.skill.name+'（原生要求等级 '+r.skill.requiredLevel+'）\n本次目标方式：'+(s.result.request.targetMode==='unselectedSelf'?'无手选目标，按技能规则检查自身':'明确手选目标')+'\n本次要求：目标 #'+p.explicitTargetId+'，职业 #'+p.requiredJobId+'，最低等级 '+p.requiredLevel+'\n读取时间：'+r.observedAtUtc+'\n请求：'+r.requestId;output.appendChild(line);
        FIELDS.forEach(function(f){var l=document.createElement('p'),v=p.conditions[f[0]];l.textContent=f[1]+'：'+(v===true?'满足':v===false?'不满足':'未知');output.appendChild(l)});
        line=document.createElement('p');line.textContent=p.blockedConditions||'本次七条件均满足；'+NOTICE;output.appendChild(line);
      }
    }});
    Object.keys(inputs).forEach(k=>inputs[k].oninput=()=>model.invalidate('输入已变化，请重新检查'));
    mode.onchange=function(){inputs.targetId.disabled=mode.value==='unselectedSelf';inputs.targetId.parentNode.style.display=inputs.targetId.disabled?'none':'block';model.invalidate('目标方式已变化，请重新检查')};
    reload.onclick=()=>model.refresh();check.onclick=()=>model.check({targetId:inputs.targetId.value,jobId:inputs.jobId.value,level:inputs.level.value,targetMode:mode.value});
    var pending=false,timer=setInterval(async function(){model.tick();if(pending)return;pending=true;try{await model.refresh()}finally{pending=false}},1000);
    function hide(){model.close();clearInterval(timer);box.remove();document.removeEventListener('visibilitychange',visibility);if(activeClose===hide)activeClose=null}
    function visibility(){if(document.hidden)hide()}
    close.onclick=hide;activeClose=hide;document.addEventListener('visibilitychange',visibility);document.body.appendChild(box);model.refresh();
  }
  root.ChoreoAbilityRead={isSkill,validate,create,open,targetText,NOTICE};
})(typeof window!=='undefined'?window:globalThis);
