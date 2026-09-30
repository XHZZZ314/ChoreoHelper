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
  root.ChoreoMacroUI={render:render,isComposing:function(){return Array.from(sessions.values()).some(function(s){return s.composing&&s.ta.isConnected;});},deferRender:function(){deferred=true;}};
})(window);
