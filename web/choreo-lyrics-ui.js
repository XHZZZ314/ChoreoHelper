// 主页歌词界面：负责 LRC 导入、搜索和预览弹窗。
'use strict';
var LYRICS_TIMEOUT_MS=12000;

function lyricsApiOptions(){return {timeoutMs:LYRICS_TIMEOUT_MS}}

function neteaseSongId(input){
  var text=String(input||'').trim();
  if(!/(?:^|\b)(?:https?:\/\/)?(?:y\.)?music\.163\.com\b/i.test(text))return '';
  var queryId=text.match(/(?:[?&#]|\b)id=(\d+)/i);
  if(queryId)return queryId[1];
  var pathId=text.match(/music\.163\.com\/(?:[^\s?#]*\/)?song\/(\d+)/i);
  return pathId?pathId[1]:'';
}

function lyricsResponseError(data){
  if(!data||typeof data!=='object')return '\u6B4C\u8BCD\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E';
  var detail=data.message||data.error;
  if(typeof detail==='string'&&detail.trim())return detail.trim();
  return data.code!==undefined&&data.code!==200?'\u670D\u52A1\u9519\u8BEF\uFF08code '+data.code+'\uFF09':'';
}

function lyricsFailureText(action,err){
  if(err&&err.name==='AbortError')return action+'\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5';
  if(err&&err.status===503)return '\u6B4C\u8BCD\u670D\u52A1\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5';
  if(err&&err.detail)return action+'\u5931\u8D25\uFF1A'+err.detail;
  return '\u65E0\u6CD5\u8FDE\u63A5\u6B4C\u8BCD\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4\u6E38\u620F\u548C ChoreoHelper \u63D2\u4EF6\u5DF2\u542F\u52A8';
}

function songArtists(song){return song.artists||song.ar||[]}
function songAlbum(song){return song.album||song.al||null}
// 原歌曲歌词独立逐行修改，保留事件身份、时间和原有扩展字段，不生成手写台词。
function showSongLyricsEditor(){
  var projectId=store.projectId,original=store.globalLyrics,baseline=JSON.stringify(original);
  var owner=store.contentExtra||(store.contentExtra={}),draft=owner.songLyricsEditor;
  var clips=original.map(function(c){var copy=JSON.parse(JSON.stringify(c));delete copy.selected;return copy;});
  var binding=JSON.stringify(ChoreoDocWire.persistDoc({dancers:[],globalLyrics:clips},{id:'song-editor-binding',name:'song-editor-binding'}));
  if(!draft||draft.version!==1||!Array.isArray(draft.texts)||!draft.texts.every(function(t){return typeof t==='string';}))draft=null;
  var conflict=!!draft&&draft.binding!==binding,composing=new Set();
  var bd=el('div','modal-bg'),m=el('div','modal');m.style.cssText='width:min(780px,92vw);max-height:85vh;overflow:auto';
  m.appendChild(el('h3','','编辑歌曲原词'));
  m.appendChild(el('p','','这里修改歌曲原词与翻译。草稿自动保留，点“应用原词修改”后进入时间轴；关闭面板不会丢草稿。舞者手写台词在宏框单独编辑。'));
  var status=el('div',''),fields=[];
  (conflict?draft.texts.map(function(text){return {start:0,data:{name:text}};}):original).forEach(function(c,i){
    var row=el('div','song-lyric-row'),time=el('span','',conflict?'旧草稿':fmtTime(c.start)),input=el('textarea','');
    input.value=draft?draft.texts[i]:(c.data.name||'');input.rows=2;row.appendChild(time);row.appendChild(input);m.appendChild(row);fields.push(input);
    input.oninput=saveDraft;
    input.addEventListener('compositionstart',function(){composing.add(input);apply.disabled=true;});
    input.addEventListener('compositionend',function(){composing.delete(input);queueMicrotask(function(){saveDraft();apply.disabled=conflict||!original.length||composing.size>0;});});
  });
  if(!original.length)m.appendChild(el('p','','尚未导入歌曲歌词。请先使用“歌词导入”。'));
  var actions=el('div','modal-act'),apply=el('button','btn primary','应用原词修改'),close=el('button','btn','关闭');
  apply.disabled=!original.length||conflict;
  if(conflict)status.textContent='原歌词已经改变，旧草稿保留在这里供复制；请先复制，再重新载入原词。';
  function current(){return store.projectId===projectId&&store.contentExtra===owner&&store.globalLyrics===original&&JSON.stringify(original)===baseline;}
  function saveDraft(){
    if(!current()||composing.size||conflict)return;
    owner.songLyricsEditor={version:1,binding:binding,texts:fields.map(function(input){return input.value;})};
    persistProject();
  }
  apply.onclick=function(){
    if(composing.size||conflict)return;
    if(!current()){status.textContent='项目或原歌词已经改变，请关闭后重新打开；当前输入仍保留。';return;}
    var changed=false;
    var next=original.map(function(c,i){
      var text=fields[i].value;if(text===(c.data.name||''))return c;
      changed=true;var copy=JSON.parse(JSON.stringify(c));copy.data.name=text;
      function updateSpeech(command){var match=String(command||'').match(/^(\/(?:say|y|sh|p|e|echo))(?:\s|$)/i);return match?match[1]+' '+text:command}
      if(copy.data.command)copy.data.command=updateSpeech(copy.data.command);
      if(copy._doc&&typeof copy._doc==='object'){copy._doc.text=text;if(copy._doc.command)copy._doc.command=updateSpeech(copy._doc.command);}
      return copy;
    });
    delete owner.songLyricsEditor;
    if(changed){store.globalLyrics=next;saveHistory();render();}else persistProject();
    bd.remove();showToast(changed?'歌曲原词已保存，可用撤销恢复':'原词没有变化');
  };
  var reload=el('button','btn','重新载入原词');reload.onclick=function(){if(!confirm('重新载入会替换这份未应用原词草稿。继续？'))return;if(store.projectId!==projectId||store.contentExtra!==owner)return;delete owner.songLyricsEditor;persistProject();bd.remove();showSongLyricsEditor();};
  close.onclick=function(){saveDraft();bd.remove()};actions.appendChild(apply);actions.appendChild(reload);actions.appendChild(close);m.appendChild(status);m.appendChild(actions);bd.appendChild(m);document.body.appendChild(bd);
}
// ============ 歌词搜索 / LRC 导入弹窗 ============
function showLyricsModal(){
  var bd=el('div','modal-bg');
  var m=el('div','modal');m.style.minWidth='540px';
  m.innerHTML='<h3>\u{1F3B5} \u6B4C\u8BCD\u5BFC\u5165 (\u5BFC\u5165\u5230\u5168\u5C40\u6B4C\u8BCD\u8F68)</h3>';
  // Search row
  var sr=el('div','');sr.style.cssText='display:flex;gap:5px;margin-bottom:5px';
  var si=el('input','');si.type='text';si.placeholder='\u6B4C\u66F2\u540D\u6216\u7F51\u6613\u4E91\u94FE\u63A5...';si.style.flex='1';
  si.onkeydown=function(e){if(e.key==='Enter')doSearch()};
  sr.appendChild(si);
  var bS=el('button','btn primary','\u641C\u7D22');bS.onclick=doSearch;sr.appendChild(bS);
  m.appendChild(sr);
  // Results
  var rd=el('div','ly-res');rd.style.display='none';m.appendChild(rd);
  // Preview
  var pd=el('div','');pd.style.cssText='margin-bottom:5px;display:none';m.appendChild(pd);
  // LRC textarea
  var ld=el('div','');ld.style.marginBottom='5px';
  ld.appendChild(el('div','','\u7C98\u8D34 LRC \u6B4C\u8BCD:'));
  var ta=el('textarea','');ta.placeholder='[00:01.00] \u6B4C\u8BCD...';ta.style.minHeight='60px';
  ta.oninput=function(){
    var ly=ta.value?parseLRC(ta.value):[];
    if(ly.length){
      pd.style.display='block';
      pd.innerHTML='';
      var info=document.createElement('div');
      info.style.cssText='font-size:10px;color:#7a8597;margin-bottom:3px';
      info.textContent=ly.length+' \u884C\u6B4C\u8BCD';
      pd.appendChild(info);
      var list=document.createElement('div');
      list.style.cssText='max-height:140px;overflow-y:auto;border:1px solid #252e3c;border-radius:4px;padding:3px';
      ly.slice(0,20).forEach(function(l){
        var item=document.createElement('div');
        item.style.cssText='font-size:9px;padding:1px 3px';
        // AUD-002：LRC 歌词文本来自用户文件，按文本节点拼装
        var ts=el('span','',fmtTime(l.time));ts.style.cssText='color:#7eb3ff;font-family:monospace';
        item.appendChild(ts);
        item.appendChild(document.createTextNode(' '+(l.text==null?'':String(l.text))));
        list.appendChild(item);
      });
      if(ly.length>20){
        var more=document.createElement('div');
        more.textContent='...+'+(ly.length-20)+'\u884C';
        more.style.cssText='font-size:9px;color:#7a8597;padding:1px 3px';
        list.appendChild(more);
      }
      pd.appendChild(list);
    }else{pd.style.display='none'}
  };
  ld.appendChild(ta);m.appendChild(ld);
  // Actions
  var act=el('div','modal-act');
  var bI=el('button','btn primary','\u5BFC\u5165\u5230\u5168\u5C40\u6B4C\u8BCD\u8F68');
  bI.onclick=function(){if(!ta.value)return;importLyrics(ta.value);document.body.removeChild(bd)};
  var bC=el('button','btn','\u5173\u95ED');bC.onclick=function(){document.body.removeChild(bd)};
  act.appendChild(bI);act.appendChild(bC);m.appendChild(act);
  bd.appendChild(m);
  bd.onclick=function(e){if(e.target===bd)document.body.removeChild(bd)};
  document.body.appendChild(bd);

  async function doSearch(){
    var q=si.value.trim();if(!q)return;
    bS.textContent='\u641C\u7D22\u4E2D...';bS.disabled=true;rd.style.display='none';
    try{
      if(/music\.163\.com/i.test(q)){
        var sid=neteaseSongId(q);
        if(sid){
          var data=await apiFetch('/lyrics?id='+encodeURIComponent(sid),lyricsApiOptions());
          var dataErr=lyricsResponseError(data);if(dataErr){showToast('\u83B7\u53D6\u6B4C\u8BCD\u5931\u8D25\uFF1A'+dataErr);return}
          if(data.lrc&&data.lrc.lyric){ta.value=(data.tlyric&&data.tlyric.lyric&&data.tlyric.lyric.trim())?data.lrc.lyric+String.fromCharCode(10)+data.tlyric.lyric:data.lrc.lyric;ta.oninput();showToast('\u83B7\u53D6\u6210\u529F')}
          else showToast('\u65E0\u6B4C\u8BCD');
        }else showToast('\u65E0\u6CD5\u8BC6\u522B\u7F51\u6613\u4E91\u6B4C\u66F2\u94FE\u63A5\uFF0C\u8BF7\u4F7F\u7528\u5305\u542B id \u7684\u6B4C\u66F2\u9875\u94FE\u63A5');
      }else{
        var res=await apiFetch('/lyrics/search?s='+encodeURIComponent(q),lyricsApiOptions());
        var resErr=lyricsResponseError(res);if(resErr){showToast('\u641C\u7D22\u5931\u8D25\uFF1A'+resErr);return}
        if(res.result&&Array.isArray(res.result.songs)&&res.result.songs.length){
          rd.style.display='block';rd.innerHTML='';
          res.result.songs.slice(0,10).forEach(function(s){
            var item=el('div','ly-r');item.onclick=function(){pickSong(s.id)};
            var info=el('div','');info.style.flex='1';
            info.appendChild(el('div','',s.name));
            info.appendChild(el('div','',songArtists(s).map(function(a){return a.name}).join('/')));
            var album=songAlbum(s);if(album&&album.name)info.appendChild(el('div','',album.name));
            item.appendChild(info);rd.appendChild(item);
          });
        }else showToast('\u672A\u627E\u5230\u6B4C\u66F2\uFF0C\u8BF7\u6362\u6B4C\u540D\u6216\u52A0\u4E0A\u6B4C\u624B\u540D');
      }
    }catch(err){showToast(lyricsFailureText('\u641C\u7D22',err))}
    finally{bS.textContent='\u641C\u7D22';bS.disabled=false}
  }
  async function pickSong(id){
    bS.textContent='\u83B7\u53D6\u6B4C\u8BCD...';bS.disabled=true;
    try{
      var data=await apiFetch('/lyrics?id='+encodeURIComponent(id),lyricsApiOptions());
      var dataErr=lyricsResponseError(data);if(dataErr){showToast('\u83B7\u53D6\u6B4C\u8BCD\u5931\u8D25\uFF1A'+dataErr);return}
      if(data.lrc&&data.lrc.lyric){ta.value=(data.tlyric&&data.tlyric.lyric&&data.tlyric.lyric.trim())?data.lrc.lyric+String.fromCharCode(10)+data.tlyric.lyric:data.lrc.lyric;ta.oninput();rd.style.display='none';showToast('\u83B7\u53D6\u6210\u529F')}
      else showToast('\u65E0\u6B4C\u8BCD');
    }catch(err){showToast(lyricsFailureText('\u83B7\u53D6\u6B4C\u8BCD',err))}
    finally{bS.textContent='\u641C\u7D22';bS.disabled=false}
  }
}

if(typeof module==='object'&&module.exports){module.exports={
  LYRICS_TIMEOUT_MS:LYRICS_TIMEOUT_MS,lyricsApiOptions:lyricsApiOptions,
  neteaseSongId:neteaseSongId,lyricsResponseError:lyricsResponseError,
  lyricsFailureText:lyricsFailureText,songArtists:songArtists,songAlbum:songAlbum
}}
