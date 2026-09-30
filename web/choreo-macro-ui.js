// 宏编辑草稿与时间轴分开保存，输入法和浏览器撤销不受页面重绘影响。
(function(root){
  'use strict';
  var sessions=new Map();
  var deferred=false;
  // 持久化绑定使用规范文档，避免旧项目装载补字段后误报时间轴冲突。
  function binding(d){
    var clips=JSON.parse(ChoreoMacro.signature(d));
    // 目录补全的动作名称/分类只影响显示；重新绑定时仍从当前时间轴取完整数据。
    clips.slice(0,2).forEach(function(track){track.forEach(function(c){if(c.data&&c.data.command){delete c.data.name;delete c.data.category;}});});
    return JSON.stringify(ChoreoDocWire.persistDoc({dancers:[{id:d.id,switchClips:clips[0],actionClips:clips[1],lyricClips:clips[2]}]},{id:'editor-binding',name:'editor-binding'}));
  }
  function render(options){
    var s=options.store,d=s.dancers[s.activeMacroTab],el=options.el;
    var body=el('div','macro-body');if(!d)return body;
    var key=String(s.projectId)+'/'+String(d.id),sig=ChoreoMacro.signature(d),session=sessions.get(key);
    s.contentExtra=s.contentExtra||{};
    var owner=s.contentExtra,records=owner.macroEditors;
    if(!records||records.version!==1)records={version:1,dancers:{}};
    var saved=records.dancers&&records.dancers[String(d.id)];
    if(session&&session.owner!==owner)session=null;
    if(!session){
      var projection=ChoreoMacro.project(d),ta=el('textarea','macro-tx');ta.value=projection.text;ta.spellcheck=false;
      ta.placeholder='例如 /gs change 1 或 /say 手写台词；输入后点“应用修改”';
      session={owner:owner,base:projection,expected:sig,applied:projection.text,ta:ta,composing:false,edits:[{value:ta.value,start:0,end:0}],editIndex:0};
      if(saved&&typeof saved.text==='string'&&typeof saved.applied==='string'&&saved.base&&Array.isArray(saved.base.rows)){
        ta.value=saved.text;session.applied=saved.applied;session.base=saved.base;
        session.expected=saved.binding===binding(d)?sig:saved.expected;
        if(saved.binding===binding(d)){
          session.base.original=projection.original;session.base.hidden=projection.hidden;
          session.base.rows.forEach(function(r){if(r.clip&&r.track){var c=(d[r.track]||[]).find(function(c){return c.id===r.clip.id;});if(c)r.clip=JSON.parse(JSON.stringify(c));}});
        }
        session.edits=[{value:ta.value,start:0,end:0}];
      }
      sessions.set(key,session);
    }
    var ta=session.ta;
    if(session.expected!==sig&&session.base.original&&binding(d)===binding(Object.assign({id:d.id},session.base.original))){
      var currentProjection=ChoreoMacro.project(d);session.expected=sig;
      session.base.original=currentProjection.original;session.base.hidden=currentProjection.hidden;
      session.base.rows.forEach(function(r){if(r.clip&&r.track){var c=(d[r.track]||[]).find(function(c){return c.id===r.clip.id;});if(c)r.clip=JSON.parse(JSON.stringify(c));}});
    }
    // 时间轴有外部修改时，干净草稿自动刷新；未应用的草稿保留并提示冲突。
    if(session.expected!==sig&&ta.value===session.applied){
      session.base=ChoreoMacro.project(d);session.expected=sig;session.applied=session.base.text;
      if(ta.value!==session.applied){ta.value=session.applied;session.edits=[{value:ta.value,start:0,end:0}];session.editIndex=0;}
    }
    var page=el('div','macro-page macro-editor'),header=el('div','macro-page-hdr'),status=el('span','macro-draft-status');
    function current(){return s.projectId===projectId&&s.dancers.indexOf(d)>=0;}
    var projectId=s.projectId;
    function persist(){
      if(!current()||s.contentExtra!==owner||session.composing)return;
      owner.macroEditors=records;records.dancers=records.dancers||{};
      records.dancers[String(d.id)]={text:ta.value,applied:session.applied,base:session.base,expected:session.expected,
        binding:ChoreoMacro.signature(d)===session.expected?binding(d):(saved&&saved.binding||'')};
      if(options.persist)options.persist();
    }
    function refresh(){
      var conflict=!current()||ChoreoMacro.signature(d)!==session.expected;
      status.textContent=conflict?'时间轴已改变，草稿仍保留；请复制草稿后重新载入':ta.value===session.applied?'已应用 · 原歌曲歌词在独立面板编辑':'未应用 · 草稿自动保留 · Ctrl+Z 撤销文字，Ctrl+Enter 应用';
      apply.disabled=session.composing||conflict||ta.value===session.applied;
    }
    function snapshot(){return {value:ta.value,start:ta.selectionStart,end:ta.selectionEnd,direction:ta.selectionDirection};}
    function remember(){
      if(session.composing)return;
      var snap=snapshot(),last=session.edits[session.editIndex];
      if(last.value!==snap.value){session.edits=session.edits.slice(0,session.editIndex+1);session.edits.push(snap);session.editIndex++;if(session.edits.length>200){session.edits.shift();session.editIndex--;}}
      refresh();persist();
    }
    // Chromium 会在摘挂节点时丢原生撤销记录；草稿自行保留历史，应用前不碰项目历史。
    function moveEdit(delta){
      if(session.composing)return;
      var index=session.editIndex+delta;if(index<0||index>=session.edits.length)return;
      session.editIndex=index;var snap=session.edits[index];ta.value=snap.value;
      ta.setSelectionRange(snap.start,snap.end,snap.direction);refresh();persist();
    }
    var apply=el('button','btn primary','应用修改');apply.dataset.action='apply-macro';
    apply.onclick=function(){
      if(session.composing||!current()||ChoreoMacro.signature(d)!==session.expected){refresh();return;}
      try{
        var result=ChoreoMacro.reconcile(session.base,ta.value,options.resolve,s.nextClipId);
        var next=Object.assign({},d,result.tracks),changed=ChoreoMacro.signature(next)!==session.expected;
        if(changed){Object.assign(d,result.tracks);s.nextClipId=result.nextId;session.expected=ChoreoMacro.signature(d);}
        session.base={rows:result.rows,hidden:result.hidden,original:result.tracks,text:ta.value,signature:session.expected};
        session.applied=ta.value;refresh();persist();if(changed){options.save();options.render();}
      }catch(e){status.textContent=e.message;}
    };
    var reload=el('button','btn','重新载入时间轴');reload.onclick=function(){
      if(ta.value!==session.applied&&!confirm('重新载入会替换这份未应用草稿。继续？'))return;
      if(records.dancers)delete records.dancers[String(d.id)];sessions.delete(key);if(options.persist)options.persist();options.render();
    };
    var copy=el('button','btn','复制当前草稿');copy.onclick=function(){navigator.clipboard.writeText(ta.value).then(function(){options.toast('已复制当前草稿');}).catch(function(){options.toast('复制失败，请选中文字复制');});};
    var undo=el('button','btn','撤销已应用修改');undo.onclick=options.undo;
    var song=el('button','btn','编辑歌曲原词');song.onclick=options.lyrics;
    [apply,undo,reload,copy,song,status].forEach(function(n){header.appendChild(n);});
    ta.onbeforeinput=function(e){
      if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();moveEdit(e.inputType==='historyUndo'?-1:1);return;}
      if(!session.composing)session.edits[session.editIndex]=snapshot();
    };
    ta.oninput=remember;
    if(ta._composeStart)ta.removeEventListener('compositionstart',ta._composeStart);
    if(ta._composeEnd)ta.removeEventListener('compositionend',ta._composeEnd);
    ta._composeStart=function(){session.edits[session.editIndex]=snapshot();session.composing=true;refresh();};
    ta._composeEnd=function(){session.composing=false;queueMicrotask(function(){remember();if(deferred){deferred=false;options.render();}});};
    ta.addEventListener('compositionstart',ta._composeStart);ta.addEventListener('compositionend',ta._composeEnd);
    ta.onkeydown=function(e){
      if((e.ctrlKey||e.metaKey)&&!e.isComposing){
        if(e.key==='Enter'){e.preventDefault();apply.click();}
        else if(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y'){e.preventDefault();moveEdit(e.key.toLowerCase()==='y'||e.shiftKey?1:-1);}
      }
    };
    page.appendChild(header);
    if(session.base.hidden&&session.base.hidden.length)page.appendChild(el('div','',session.base.hidden.length+' 个不使用宏命令的动作保留在时间轴中，不受此草稿修改影响'));
    page.appendChild(ta);body.appendChild(page);refresh();return body;
  }
  // ---------- P1-B 宏起步（首条旅程）：粘贴→预览识别→明确应用/取消/撤销；不支持的原文进「宏原文备注」 ----------
  // 预览用 ChoreoMacro.parse 逐行判类别、按 start-to-start（与 reconcile 应用口径一致）累加时刻；
  // 应用仍走 ChoreoMacro.reconcile（零语义改动），只提交识别行，不支持行只记录不落条；
  // /ac 一律「身份待核验」，不从文本推断已核实技能。草稿与备注按项目+舞者独立持久化。
  var LYRIC_CMDS=['/say','/y','/sh','/p','/e','/echo'];
  var startSheet=null;
  function startRecords(s){
    s.contentExtra=s.contentExtra||{};
    var rec=s.contentExtra.macroStart;
    if(!rec||rec.version!==1)rec={version:1,dancers:{}};
    s.contentExtra.macroStart=rec;rec.dancers=rec.dancers||{};
    return rec;
  }
  function startRecord(s,id){
    var rec=s&&s.contentExtra&&s.contentExtra.macroStart;
    return (rec&&rec.dancers&&rec.dancers[String(id)])||null;
  }
  function notesFor(s,di){
    var d=s&&s.dancers&&s.dancers[di];if(!d)return [];
    var rec=startRecord(s,d.id);
    return rec&&Array.isArray(rec.notes)?rec.notes.map(function(n){return {text:String(n.text||''),why:String(n.why||'')}}):[];
  }
  function dancerById(s,id){for(var i=0;i<s.dancers.length;i++)if(s.dancers[i].id===id)return s.dancers[i];return null}
  function classifyLine(line,resolve){
    var raw=line.trim(),parsed;
    try{parsed=ChoreoMacro.parse(line)}catch(e){return {kind:'bad',raw:raw,reason:e.message}}
    if(!parsed)return null;
    if(parsed.delay)return {kind:'delay',raw:raw,wait:parsed.wait};
    var command=parsed.command,head=command.split(/\s+/)[0].toLowerCase();
    if(LYRIC_CMDS.indexOf(head)>=0)return {kind:'lyric',raw:raw,command:command,wait:parsed.wait,label:'台词'};
    if(head==='/gs'||head==='/gearset'){
      var args=command.slice(head.length).trim();
      if(!/^change\s+(?:[1-9]\d?|100|"[^"\r\n]+")(?:\s+[1-9]\d*)?$/i.test(args))return {kind:'bad',raw:raw,reason:'切装备请填写 /gs change 1（编号 1–100），或 /gs change "套装名"'};
      return {kind:'switch',raw:raw,command:command,wait:parsed.wait,label:'切装备'};
    }
    if(head==='/job')return {kind:'bad',raw:raw,reason:'游戏内切职业请改用 /gs change 装备套装编号'};
    if(head==='/ac'||head==='/action')return {kind:'skill',raw:raw,command:command,wait:parsed.wait,label:'技能（身份待核验）',why:'身份待核验：不从 /ac 文本推断已核实技能'};
    var found=resolve?resolve(command):null;
    if(found)return {kind:'action',raw:raw,command:command,wait:parsed.wait,label:'动作／表情',name:found.name};
    return {kind:'bad',raw:raw,reason:'不支持的命令，保留原文'};
  }
  function buildPlan(text,resolve){
    var rows=[],applyLines=[],bad=[],t=0;
    String(text==null?'':text).split(/\r?\n/).forEach(function(line){
      if(!line.trim())return;
      var r=classifyLine(line,resolve);if(!r)return;
      if(r.kind==='delay'){rows.push({time:null,kind:'delay',raw:r.raw,label:'等待',why:'先等 '+(Math.round(r.wait*10)/10)+' 秒'});applyLines.push(r.raw);t+=r.wait;return}
      if(r.kind==='bad'){rows.push({time:null,kind:'bad',raw:r.raw,label:'保留原文',why:r.reason});bad.push({text:r.raw,why:r.reason});return}
      rows.push({time:t,kind:r.kind,raw:r.raw,label:r.label,why:r.why||''});applyLines.push(r.raw);t+=(r.wait||0);
    });
    return {rows:rows,applyText:applyLines.join('\n'),bad:bad,recognized:rows.filter(function(r){return typeof r.time==='number'}).length};
  }
  function setStartSummary(text){var n=document.getElementById('macroStartSummary');if(n)n.textContent=text}
  function renderStartPreview(plan){
    var list=document.getElementById('macroStartList');if(!list)return;
    list.innerHTML='';
    plan.rows.forEach(function(r){
      var row=document.createElement('div');row.className='ms-row '+(r.kind==='bad'?'no':r.kind==='delay'?'wait':'ok');
      var t=document.createElement('span');t.className='ms-t';t.textContent=(r.time==null?'—':((Math.round(r.time*10)/10).toFixed(1)+'s'));
      var k=document.createElement('span');k.className='ms-k';k.textContent=r.label;
      var txt=document.createElement('span');txt.className='ms-txt';txt.textContent=r.raw;
      var why=document.createElement('span');why.className='ms-why';why.textContent=r.why||'';
      row.appendChild(t);row.appendChild(k);row.appendChild(txt);row.appendChild(why);list.appendChild(row);
    });
    var apply=document.getElementById('macroStartApply');if(apply)apply.disabled=plan.recognized===0;
    setStartSummary('共 '+plan.rows.length+' 行：识别 '+plan.recognized+' 行，保留原文 '+plan.bad.length+' 行。应用前不会改动时间轴；应用后可撤销。');
  }
  function closeStart(){
    if(startSheet&&startSheet.mask&&startSheet.mask.parentNode)startSheet.mask.parentNode.removeChild(startSheet.mask);
    startSheet=null;
  }
  function openStart(opts){
    closeStart();
    var s=opts.store,di=s.selectedDancer,d=s.dancers[di];
    if(!d){opts.toast('先添加一位舞者，再使用宏起步');return false}
    var mask=document.createElement('div');mask.className='macro-start-mask';mask.id='macroStartSheet';
    var box=document.createElement('div');box.className='macro-start-box';
    box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','从已有宏开始');
    box.appendChild(el('h3','','从已有宏开始（先预览，再应用）'));
    box.appendChild(el('p','macro-start-hint','粘贴游戏宏。每行一条命令；行尾 <wait.N> = 上一条开始后 N 秒发下一条；/wait N = 先等 N 秒。识别结果先给你看，点「应用到时间轴」才会改动。'));
    box.appendChild(el('p','macro-start-who','将应用到：'+d.name+'（当前舞者）'));
    var ta=document.createElement('textarea');ta.id='macroStartText';ta.className='macro-start-text';ta.spellcheck=false;
    ta.placeholder='例如：\n/gs change 1 <wait.2>\n/say 大家好 <wait.3>\n/ac 热舞 <wait.2.5>\n/party';
    var saved=startRecord(s,d.id);if(saved&&typeof saved.text==='string')ta.value=saved.text;
    box.appendChild(ta);
    var actions=el('div','macro-start-actions');
    var previewBtn=el('button','btn','预览识别');previewBtn.type='button';previewBtn.id='macroStartPreview';
    var cancelBtn=el('button','btn','取消（不改任何内容）');cancelBtn.type='button';cancelBtn.id='macroStartCancel';
    var applyBtn=el('button','btn primary','应用到时间轴');applyBtn.type='button';applyBtn.id='macroStartApply';applyBtn.disabled=true;
    actions.appendChild(previewBtn);actions.appendChild(cancelBtn);actions.appendChild(applyBtn);box.appendChild(actions);
    var sum=el('div','macro-start-summary');sum.id='macroStartSummary';box.appendChild(sum);
    var list=el('div','macro-start-list');list.id='macroStartList';box.appendChild(list);
    mask.appendChild(box);document.body.appendChild(mask);
    var st={mask:mask,ta:ta,opts:opts,projectId:s.projectId,dancerId:d.id};
    startSheet=st;
    function currentDancer(){return dancerById(opts.store,st.dancerId)}
    function persistDraft(){
      if(!startSheet||startSheet!==st)return;
      var cur=opts.store;
      if(cur.projectId!==st.projectId)return;
      var dd=currentDancer();if(!dd)return;
      var records=startRecords(cur),rec=records.dancers[String(dd.id)]||{};
      rec.text=ta.value;records.dancers[String(dd.id)]=rec;
      if(opts.persist)opts.persist();
    }
    function doPreview(){
      var plan=buildPlan(ta.value,opts.resolve);
      renderStartPreview(plan);
      if(!plan.rows.length)setStartSummary('还没有可识别的行：粘贴宏后再点「预览识别」。');
      persistDraft();
    }
    function doApply(){
      var cur=opts.store,dd=currentDancer();
      if(!dd||cur.projectId!==st.projectId){opts.toast('项目已改变，请重新打开宏起步');closeStart();return}
      var plan=buildPlan(ta.value,opts.resolve);
      if(!plan.applyText.trim()){setStartSummary('没有可应用的行：请先粘贴宏并点「预览识别」。');return}
      var result;
      try{result=ChoreoMacro.reconcile(ChoreoMacro.project(dd),plan.applyText,opts.resolve,cur.nextClipId)}
      catch(e){setStartSummary('应用失败：'+e.message);return}
      var changed=ChoreoMacro.signature(Object.assign({},dd,result.tracks))!==ChoreoMacro.signature(dd);
      Object.assign(dd,result.tracks);cur.nextClipId=result.nextId;
      var records=startRecords(cur),rec=records.dancers[String(dd.id)]||{};
      var notes=Array.isArray(rec.notes)?rec.notes.slice():[];
      plan.bad.forEach(function(b){if(!notes.some(function(n){return n.text===b.text&&n.why===b.why}))notes.push({text:b.text,why:b.why})});
      records.dancers[String(dd.id)]={text:ta.value,notes:notes};
      if(opts.persist)opts.persist();
      var recognized=plan.recognized,bad=plan.bad.length;
      closeStart();
      if(changed&&opts.save)opts.save();
      if(opts.render)opts.render();
      opts.toast('宏已应用：识别 '+recognized+' 条'+(bad?('，不支持 '+bad+' 行已存入「宏原文备注」'):'')+'；可点顶栏 ↶ 撤销');
    }
    ta.oninput=function(){
      var a=document.getElementById('macroStartApply');if(a)a.disabled=true;
      setStartSummary('正文已改变：请重新点「预览识别」。');persistDraft();
    };
    ta.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();cancelBtn.click()}else e.stopPropagation()};
    previewBtn.onclick=doPreview;
    applyBtn.onclick=doApply;
    cancelBtn.onclick=function(){closeStart();opts.toast('已取消：未改动时间轴（草稿已随输入保留）')};
    if(ta.value.trim())doPreview();
    ta.focus();
    return true;
  }
  root.ChoreoMacroUI={render:render,isComposing:function(){return Array.from(sessions.values()).some(function(s){return s.composing&&s.ta.isConnected;});},deferRender:function(){deferred=true;},
    openStart:openStart,closeStart:closeStart,isStartOpen:function(){return !!startSheet},notesFor:notesFor};
})(window);
