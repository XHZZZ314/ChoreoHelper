// 技能编排界面：应用式编辑与本机目标类别只读提示，沿用保存/撤销；不输出技能。
(function(root){
  'use strict';
  var P=root.ChoreoAbilityPlan,closeActive=null,selEventId=null;
  function node(tag,text,parent){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.appendChild(n);return n}
  function button(text,parent,fn){var b=node('button',text,parent);b.type='button';b.className='btn';b.onclick=fn;return b}
  function install(all){var s=root.store;s.contentExtra=s.contentExtra||{};s.contentExtra._doc=s.contentExtra._doc||{};s.contentExtra._doc.extraTracks=all;root.updateTotalDuration();root.saveHistory();root.render()}
  // r3 属主点验修正：技能条与时间轴惯例对齐——单击=选中（再点取消）、双击=打开编辑窗。
  // 选中是纯 UI 态（selEventId 不入库、不新增数据格式），选中态视觉复用 .selected 口径；
  // 只切 class 不整页 render——render 重建 DOM 会打断双击事件。
  function clearTimelineSel(){ // 与常规条选中互斥：对齐 app.js selectClipOnly+refreshSelection 的清理面
    var s=root.store;if(!s)return;
    (s.dancers||[]).forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){(d[k]||[]).forEach(function(x){x.selected=false})})});
    (s.globalLyrics||[]).forEach(function(x){x.selected=false});
    s.selectedClip=null;
    Array.prototype.forEach.call(document.querySelectorAll('.clip.selected'),function(n){if(n.__clip&&!n.__clip.selected)n.classList.remove('selected')});
  }
  function setSel(id){ // id=null=清除；跨技能轨只保一个选中
    selEventId=id;
    Array.prototype.forEach.call(document.querySelectorAll('.ability-clip'),function(n){n.classList.toggle('selected',id!==null&&n.dataset.eventId===id)});
    if(id!==null)clearTimelineSel();
  }
  if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('click',function(ev){ // 点技能条以外任意处（空白/常规条/编辑窗等）即清除选中；node 桩 document 无此 API 不注册
    if(!selEventId)return;
    var t=ev.target;
    if(t&&t.closest&&t.closest('.ability-clip'))return;
    setSel(null);
  });
  function open(skill,di,start,row){
    if(closeActive)closeActive();var s=root.store,people=P.performers(s),source=P.pid(s,di);
    if(!P.isSkill(skill)||!source){root.showToast('缺少真实 Action 身份或舞者，不能按名称编排技能');return}
    skill=Object.assign({},(s.actions||[]).find(a=>a.type==='action'&&a.id===skill.id)||{},skill);
    if(row&&(row.track.locked||row.event.locked)){root.showToast('技能片段已锁定');return}
    if(row&&(!P.plan(row.event)||!P.plan(row.event).target)){root.showToast('技能编排数据不完整，已保留原数据');return}
    var dancers=s.dancers,extra=s.contentExtra,project=s.projectId,oldText=row?JSON.stringify(row.event):null,closed=false,model,timer;
    var box=node('div');box.className='ability-editor';box.setAttribute('role','dialog');box.setAttribute('aria-label','编排技能');
    box.style.cssText='position:fixed;z-index:10000;right:24px;top:50px;width:min(490px,90vw);max-height:88vh;overflow:auto;background:#172131;color:#e6edf7;padding:18px;border:1px solid #729fb4;border-radius:10px;box-shadow:0 12px 48px #0009';
    node('h3',(row?'编辑技能':'编排技能')+' · '+skill.name+' #'+skill.id,box);
    // TASK-20260918-PLAYER-UX-SIMPLIFY A1：常用区只留触发时刻/目标类型/应用；其余收进默认折叠的「技能细节（高级）」，原能力全部可达。
    node('p','网页排练专用，不释放技能。目标默认「未指定对象时使用自身」；咏唱、目标舞者、坐标等在「技能细节（高级）」。',box);
    var p=row?P.plan(row.event):null,inputs={};
    function field(key,label,value,parent){var l=node('label',label+' ',parent||box);l.style.cssText='display:block;margin:9px 0';var n=node('input',undefined,l);n.type='text';n.value=value;n.setAttribute('aria-label',label);inputs[key]=n;return n}
    function select(key,label,options,value,parent){var l=node('label',label+' ',parent||box);l.style.cssText='display:block;margin:9px 0';var n=node('select',undefined,l);n.setAttribute('aria-label',label);options.forEach(o=>{var v=node('option',o[1],n);v.value=o[0]});n.value=value;inputs[key]=n;return n}
    field('start','触发时刻（秒）',String(row?row.event.startMs/1000:Math.round(Math.max(0,start===undefined?s.currentTime:start)*1000)/1000));
    select('targetKind','排练目标类型',[['','请选择'],['self','自身（明确指定）'],['party','指定队友舞者（队伍成员）'],['ally','指定普通友方舞者'],['enemyMarker','明确敌人排练标记'],['defaultSelf','未指定对象时使用自身'],['alliance','指定团队成员舞者'],['ownPet','自己的宠物标记'],['partyPet','指定队友的宠物标记'],['ground','舞台地面坐标']],p?p.target.kind:'defaultSelf');
    var adv=node('details',undefined,box);adv.className='ability-advanced';
    var advSummary=node('summary','技能细节（高级）',adv);advSummary.style.cssText='cursor:pointer;margin:10px 0 6px;color:#9fc6dd';
    var advBody=node('div',undefined,adv);
    var metadata=root.ChoreoSkillMetadata&&root.ChoreoSkillMetadata.read(skill);
    var fixedCastMs=p?p.castMs:metadata?metadata.castMs:null,adoptedTiming=p&&p.timing||null,executionTiming=p&&p.executionTiming||null,profileBinding=s.dancers[di].profileId||'';
    node('p','所属：'+people.find(p=>p.id===source).name+'。网页排练专用，不释放技能。',advBody);
    node('p','目标是编舞声明，不使用游戏手选目标。表现提示时长不是动画长度；技能动作按本舞者资源预览，特效在游戏中查看。',advBody);
    if(root.ChoreoSkillMetadata)node('p',root.ChoreoSkillMetadata.describe(skill),advBody);
    field('cast','咏唱提示时长（秒）',fixedCastMs===null?'':String(fixedCastMs/1000),advBody).readOnly=true;
    node('p','咏唱时间不允许自行修改。目录仅提供基础值，实际时间须按角色和游戏状态核验；旧存档数值保留，但不因此视为可实演。请通过调整触发时刻编排。',advBody);
    field('presentation','触发表现提示时长（秒）',String(p?p.presentationMs/1000:1),advBody);
    select('targetPerformer','目标舞者',[['','请选择另一位舞者']].concat(people.filter(x=>x.id!==source).map(x=>[x.id,x.name])),p?p.target.performerId||'':'',advBody);
    field('targetLabel','敌人标记名称',p?p.target.label||'':'',advBody);
    ['X','Y','Z'].forEach(k=>field('target'+k,'地面目标 '+k+'（米）',String(p&&p.target.position?p.target.position[k.toLowerCase()]:0),advBody));
    function targetFields(){var kind=inputs.targetKind.value;var needExtra=P.PERSON_TARGETS.includes(kind)||['enemyMarker','ownPet','partyPet','ground'].includes(kind);
      if(needExtra&&!adv.open)adv.open=true; // 选中需补充字段的目标类型时自动展开高级区，保一步可达
      inputs.targetPerformer.parentNode.style.display=P.PERSON_TARGETS.includes(kind)?'block':'none';inputs.targetLabel.parentNode.style.display=['enemyMarker','ownPet','partyPet','ground'].includes(kind)?'block':'none';var targetTitle=kind==='enemyMarker'?'敌人标记名称':'目标标记名称';inputs.targetLabel.setAttribute('aria-label',targetTitle);if(inputs.targetLabel.parentNode.firstChild)inputs.targetLabel.parentNode.firstChild.textContent=targetTitle+' ';['X','Y','Z'].forEach(k=>inputs['target'+k].parentNode.style.display=kind==='ground'?'block':'none')}
    inputs.targetKind.onchange=function(){targetFields();rulesView()};targetFields();
    var rulesLine=node('p','未核验：尚未读取本机规则',advBody);rulesLine.className='ability-target-rules';
    var matchLine=node('p','',advBody);matchLine.className='ability-target-match';
    var draft=node('label','',advBody),draftCheck=node('input',undefined,draft);draftCheck.type='checkbox';
    draftCheck.setAttribute('aria-label','明确保存未核验排练草稿');node('span',' 我确认仅保存未核验排练草稿，不表示目标有效或技能能释放',draft);
    var error=node('p','',box);error.setAttribute('role','status');error.style.color='#ffc785';
    function current(){if(root.store!==s||s.projectId!==project||root.store.dancers!==dancers||root.store.contentExtra!==extra||(s.dancers[di].profileId||'')!==profileBinding)throw Error('项目或舞者已重新装载，请关闭后重新打开');if(row&&JSON.stringify(row.event)!==oldText)throw Error('技能片段已变化，请重新打开')}
    function isCurrent(){try{current();return !closed}catch(e){return false}}
    function rulesView(){
      if(!model)return;var v=model.view(),T=root.ChoreoAbilityPlanTargets,a=T.assess(v.rules,inputs.targetKind.value);
      rulesLine.textContent=T.describe(v.rules)+' '+v.reason;matchLine.textContent='网页仅预览动作；目标规则供参考，不限制保存。游戏按时尝试，失败跳过。';
      Array.from(inputs.targetKind.children).forEach(o=>{o.disabled=false});
      draft.style.display='none';
    }
    function hide(){closed=true;if(model)model.close();clearInterval(timer);box.remove();if(closeActive===hide)closeActive=null}
    function apply(){try{current();var values={};Object.keys(inputs).forEach(k=>values[k]=inputs[k].value);
      var a=root.ChoreoAbilityPlanTargets.assess(model.view().rules,values.targetKind);rulesView();


      if(fixedCastMs===null)throw Error('未核验：缺少技能基础时间，不能自定义咏唱时长');
      values.cast=String(fixedCastMs/1000);
      var e=P.make(skill,values,row?row.event.id:'ability-'+crypto.randomUUID(),row&&row.event);
      if(adoptedTiming)e.data.rehearsalAbility.timing=JSON.parse(JSON.stringify(adoptedTiming));
      if(executionTiming)e.data.rehearsalAbility.executionTiming=JSON.parse(JSON.stringify(executionTiming));
      var all=P.upsert(P.tracks(s),source,e,'ability-track-'+crypto.randomUUID(),P.performers(s));
      if(row&&JSON.stringify(e)===oldText){hide();return}
      install(all);hide();root.showToast('技能编排已保存；3D 按本舞者资源预览，缺失会明确提示');
    }catch(e){error.textContent=e.message}}
    button('应用技能编排',box,apply);
    if(row)button('删除技能片段',box,function(){try{current();install(P.remove(P.tracks(s),row.event.id));hide()}catch(e){error.textContent=e.message}});
    button('取消',box,hide);
    button('刷新目标规则（只读）',advBody,function(){draftCheck.checked=false;model.refresh()});
    if(root.ChoreoSkillMotionUI){node('h4','本舞者技能动作',advBody);root.ChoreoSkillMotionUI.attach(advBody,skill,di,isCurrent,function(t){
      current();fixedCastMs=t.castMs;inputs.cast.value=String(t.castMs/1000);
      adoptedTiming={version:1,observationHash:t.observationHash,profileId:t.profileId,skeletonHash:t.skeletonHash,actionId:t.actionId,actorId:t.actorId,jobId:t.jobId,castMs:t.castMs,endMs:Math.ceil(t.end*1000)};
      error.textContent='已选本档案实测咏唱 '+t.castMs/1000+' 秒；点击应用后保存。只对应这次角色状态，实际演出前仍须复核。';
    },p&&p.timing)}
    if(root.ChoreoSkillTimingUI){node('h4','实际执行时序',advBody);root.ChoreoSkillTimingUI.attach(advBody,skill,di,isCurrent,t=>{current();executionTiming=t},p&&p.executionTiming,()=>adoptedTiming)}
    model=root.ChoreoAbilityPlanTargets.create({id:skill.id,current:isCurrent,connected:()=>!!s.gameConnected,catalogRules:metadata?skill.targetRules:null,
      read:path=>root.apiFetch(path),changed:rulesView});
    closeActive=hide;document.body.appendChild(box);rulesView();model.refresh();
    timer=setInterval(function(){model.tick();rulesView()},250);
  }
  // TASK-20260918-PLAYER-UX-SIMPLIFY B1：侧栏点/拖技能不再先弹窗——按默认值直接落条
  // （目标=未指定对象时使用自身、咏唱=目录基础值、表现提示=1秒、时刻=传入落点），
  // 一次 install=单次撤销；缺目录基础时间等不可默认时明示 toast 并回落打开编辑窗，不静默。
  function quickAdd(skill,di,start){
    var s=root.store,source=P.pid(s,di);
    if(!P.isSkill(skill)||!source){root.showToast('缺少真实 Action 身份或舞者，不能按名称编排技能');return {ok:false,missing:'identity'}}
    skill=Object.assign({},(s.actions||[]).find(a=>a.type==='action'&&a.id===skill.id)||{},skill);
    var values=P.quickDefaults(skill,root.ChoreoSkillMetadata&&root.ChoreoSkillMetadata.read(skill));
    if(!values){root.showToast('无法按默认落条：目录缺少该技能的基础咏唱时间，已打开编辑窗，请手动编排');open(skill,di,start);return {ok:false,missing:'cast'}}
    values.start=String(Math.round(Math.max(0,start===undefined?s.currentTime:start)*1000)/1000);
    try{
      var e=P.make(skill,values,'ability-'+crypto.randomUUID());
      var all=P.upsert(P.tracks(s),source,e,'ability-track-'+crypto.randomUUID(),P.performers(s));
      install(all);
      root.showToast('已按默认落条（Ctrl+Z 撤销）：目标=未指定对象时使用自身 · 咏唱=目录基础值 · 表现提示=1秒；双击技能条可改');
      return {ok:true,eventId:e.id};
    }catch(err){root.showToast('默认落条未写入：'+err.message);return {ok:false,missing:'error'}}
  }
  // 「添加到全部舞者」+技能：同一默认值逐位落条，整批一次 install=一次撤销；
  // 任一位不可默认（目录基础时间缺失/身份问题）则整批不动并回落编辑窗。
  function quickAddAll(skill,start){
    var s=root.store;
    skill=Object.assign({},(s.actions||[]).find(a=>a.type==='action'&&a.id===skill.id)||{},skill);
    var values=P.quickDefaults(skill,root.ChoreoSkillMetadata&&root.ChoreoSkillMetadata.read(skill));
    if(!values){root.showToast('无法按默认落条：目录缺少该技能的基础咏唱时间，已打开编辑窗，请手动编排');if(s.dancers[s.selectedDancer])open(skill,s.selectedDancer,start);return {ok:false,missing:'cast'}}
    values.start=String(Math.round(Math.max(0,start===undefined?s.currentTime:start)*1000)/1000);
    var all=P.tracks(s),added=0;
    try{
      P.performers(s).forEach(function(who){
        var e=P.make(skill,values,'ability-'+crypto.randomUUID());
        all=P.upsert(all,who.id,e,'ability-track-'+crypto.randomUUID(),P.performers(s));added++;
      });
    }catch(err){root.showToast('默认落条未写入：'+err.message);return {ok:false,missing:'error'}}
    if(!added){root.showToast('没有可落条的舞者');return {ok:false,missing:'dancer'}}
    install(all);
    root.showToast('已给全部 '+added+' 位舞者按默认落条（一次撤销整批；目标=未指定对象时使用自身 · 咏唱=目录基础值 · 表现提示=1秒）');
    return {ok:true,count:added};
  }
  function lane(di){
    var s=root.store,who=P.pid(s,di),items=P.rows(s).filter(r=>r.source===who),lane=node('div');lane.className='lane ability-lane';
    if(selEventId&&!items.some(r=>r.event.id===selEventId))selEventId=null; // 被删/撤销的条目不再保留悬挂选中
    var label=node('div',undefined,lane);label.className='lane-label';node('span','✦',label);node('span','技能',label);
    var body=node('div',undefined,lane);body.className='lane-body';body.style.position='relative';
    var slots=[];items.sort((a,b)=>a.event.startMs-b.event.startMs).forEach(function(r){
      var p=P.plan(r.event);if(!p)return;var e=r.event,index=slots.findIndex(x=>x<=e.startMs);if(index<0)index=slots.length;slots[index]=e.startMs+e.durationMs;
      var b=button(p.name+' · '+P.targetLabel(p,P.performers(s),who),body,null);
      b.className='ability-clip';b.dataset.eventId=e.id;b.style.cssText='position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;background:#204153;color:#d2f5ff;border:1px solid #71c4df;border-radius:4px;height:25px;padding:2px 5px;cursor:pointer';
      b.style.left=(e.startMs/1000*s.pps)+'px';b.style.width=Math.max(30,e.durationMs/1000*s.pps)+'px';b.style.top=(index*28+3)+'px';
      b.title=p.name+' #'+p.actionId+' · '+(e.startMs/1000)+'s · 咏唱 '+p.castMs/1000+'s / 表现提示 '+p.presentationMs/1000+'s · '+P.targetLabel(p,P.performers(s),who)+' · 动画按本舞者档案读取 · 单击选中，双击编辑';
      if(r.track.enabled===false||e.enabled===false)b.style.opacity='0.4';
      if(selEventId===e.id)b.classList.add('selected');
      b.onmousedown=function(ev){ev.stopPropagation()};
      b.onclick=function(ev){ev.stopPropagation();setSel(selEventId===e.id?null:e.id)}; // r3：单击=选中/再点取消，不开编辑窗
      b.ondblclick=function(ev){ev.stopPropagation();setSel(e.id);open({id:Number(p.actionId),type:'action',name:p.name},di,0,r)}; // r3：双击=打开编辑窗（编辑能力不变）
    });
    lane.style.height=Math.max(34,slots.length*28+6)+'px';
    if(!items.length){var hint=node('span','从技能列表点击或拖入直接按默认落条；单击技能条选中、双击改目标与时间',body);hint.style.cssText='font-size:11px;color:#8fa6b5;line-height:32px;pointer-events:none'}
    body.ondragover=function(e){e.preventDefault()};body.ondrop=function(e){e.preventDefault();e.stopPropagation();try{var x=JSON.parse(e.dataTransfer.getData('text/plain'));if(!x.fromSidebar||!P.isSkill(x.data))throw Error('技能轨只接受真实 Action 技能');quickAdd(x.data,di,Math.max(0,(e.clientX-body.getBoundingClientRect().left)/s.pps))}catch(err){root.showToast(err.message)}};
    return lane;
  }
  root.ChoreoAbilityUI={open,quickAdd,quickAddAll,lane};
})(window);
