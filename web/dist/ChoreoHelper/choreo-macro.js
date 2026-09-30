// 宏草稿按原始事件逐行合并，保留时间与扩展数据，原歌曲歌词不进入编辑投影。
(function(root){
  'use strict';
  var tracks=['switchClips','actionClips','lyricClips'];
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function signature(d){return JSON.stringify(tracks.map(function(k){return (d[k]||[]).map(function(c){var copy=clone(c);delete copy.selected;return copy;});}));}
  function number(n){return String(Math.round(n*1000)/1000);}
  function parse(line){
    var s=line.trim(),wait=null,m=s.match(/\s*<wait\.(\d+(?:\.\d+)?)>$/i);
    if(m){wait=+m[1];s=s.slice(0,m.index).trim();}
    if(!s)return null;
    if(/^\/wait\s+\d+(?:\.\d+)?$/i.test(s)){
      var delay=+s.split(/\s+/)[1];
      if(!isFinite(delay)||delay<0||delay>86400)throw new Error('等待时间须在 0 到 86400 秒之间');
      return {command:s,wait:delay,delay:true};
    }
    if(!/^\/[^\s<>]+(?:\s.*)?$/.test(s)||/<wait[.\s]/i.test(s))throw new Error('命令尚未写完整：'+line);
    if(wait!==null&&(!isFinite(wait)||wait<0||wait>86400))throw new Error('等待时间须在 0 到 86400 秒之间');
    return {command:s,wait:wait,delay:false};
  }
  function key(p){return p.command+'\n'+p.wait;}
  function project(d){
    var items=[],hidden=[],original={};
    tracks.forEach(function(k){original[k]=clone(d[k]||[]);(d[k]||[]).forEach(function(c){var data=c.data||{};if(!data.command&&!(k==='lyricClips'&&data.name)){hidden.push({track:k,clip:clone(c)});return;}items.push({track:k,clip:clone(c)});});});
    items.sort(function(a,b){return a.clip.start-b.clip.start;});
    var rows=[];
    if(items.length&&items[0].clip.start>0)rows.push({text:'/wait '+number(items[0].clip.start),start:0,initial:true});
    items.forEach(function(item,i){
      var c=item.clip,data=c.data||{},cmd=data.command||((item.track==='lyricClips')?'/say '+(data.name||''):'');
      if(!cmd)return;
      var next=items[i+1],wait=next?Math.max(0,next.clip.start-c.start):c.duration;
      rows.push({text:cmd+(wait>0?' <wait.'+number(wait)+'>':''),track:item.track,clip:c,start:c.start,final:!next});
    });
    // 投影不得因个别宏非法命令（如导入数据里的注入串）中断整页渲染：逐行降级为"无效行"，
    // 文本原样保留且不参与对齐（代理键不可能与任何用户行相等），不会被静默改写或删除；
    // 用户编辑仍由 reconcile 对输入文本的严格解析把关。
    rows.forEach(function(r){try{r.parsed=parse(r.text);}catch(e){r.invalid=true;r.error=e.message;r.parsed={command:'\u0000'+r.text,wait:null};}});
    return {rows:rows,hidden:hidden,original:original,text:rows.map(function(r){return r.text;}).join('\n'),signature:signature(d)};
  }
  // 行数相同时视为逐行修改；增删行时以精确相同行作锚点，只有新增行分配新编号。
  function align(before,after){
    var n=before.length,m=after.length;
    if(n===m)return before.map(function(_,i){return i;});
    if(n*m>4000000)throw new Error('一次最多编辑约 2000 行，请分段修改');
    var dp=Array.from({length:n+1},function(){return new Uint16Array(m+1);});
    for(var i=n-1;i>=0;i--)for(var j=m-1;j>=0;j--)dp[i][j]=key(before[i].parsed)===key(after[j])?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
    var pairs=[],bi=0,ai=0,anchors=[];
    while(bi<n&&ai<m){if(key(before[bi].parsed)===key(after[ai])){anchors.push([bi++,ai++]);}else if(dp[bi+1][ai]>=dp[bi][ai+1])bi++;else ai++;}
    anchors.push([n,m]);bi=0;ai=0;
    anchors.forEach(function(a){while(bi<a[0]&&ai<a[1])pairs[ai++]=bi++;while(ai<a[1])pairs[ai++]=-1;if(a[1]<m)pairs[a[1]]=a[0];bi=a[0]+1;ai=a[1]+1;});
    return pairs;
  }
  function commandData(command,resolve){
    var m=command.match(/^(\/\S+)(?:\s+(.*))?$/),cmd=m[1].toLowerCase(),args=m[2]||'';
    if(['/say','/y','/sh','/p','/e','/echo'].indexOf(cmd)>=0)return {track:'lyricClips',data:{name:args,command:command,category:'lyric',isLyric:true}};
    if(cmd==='/gs'||cmd==='/gearset'){
      if(!/^change\s+(?:[1-9]\d?|100|"[^"\r\n]+")(?:\s+[1-9]\d*)?$/i.test(args))throw new Error('切装备请填写 /gs change 1（编号 1–100），或 /gs change "套装名"');
      return {track:'switchClips',data:{name:command,command:command,category:'switch',isJobSwitch:true,gearsetVerified:false}};
    }
    if(cmd==='/job')throw new Error('游戏内切职业请改用 /gs change 装备套装编号');
    var data=resolve?resolve(command):null;
    return {track:'actionClips',data:Object.assign({name:args||cmd.slice(1),category:(cmd==='/ac'||cmd==='/action')?'skill':'expression'},data||{},{command:command})};
  }
  function reconcile(base,text,resolve,nextId){
    var after=text.split(/\r?\n/).filter(function(s){return s.trim()&&s.trim()!=='/nextmacro';}).map(parse);
    var matched=align(base.rows,after),out={switchClips:[],actionClips:[],lyricClips:[]},newRows=[];
    (base.hidden||[]).forEach(function(r){out[r.track].push(clone(r.clip));});
    var shift=0,cursor=0,id=nextId;
    after.forEach(function(p,i){
      var original=matched[i]>=0?base.rows[matched[i]]:null;
      if(p.delay){
        if(original&&!original.initial)throw new Error('请将等待命令另起一行，或直接在动作末尾修改 <wait.秒数>');
        var oldWait=original?original.parsed.wait:0;shift+=p.wait-oldWait;cursor+=p.wait;
        newRows.push({text:p.command,parsed:p,start:cursor-p.wait,initial:true});return;
      }
      if(original&&original.initial)throw new Error('开头的 /wait 用于保留起始时间，请保留它或单独修改秒数');
      var unchanged=original&&p.command===original.parsed.command;
      var info=unchanged?{track:original.track,data:original.clip.data}:commandData(p.command,resolve);
      var clip=original?clone(original.clip):{id:id++,start:cursor,duration:Math.max(0.5,p.wait||0.5),data:{}};
      if(original)clip.start=Math.max(0,original.clip.start+shift);
      if(!unchanged){
        // 未知扩展字段原样保留；命令身份字段必须随新命令更新，防止旧技能/表情被执行。
        ['id','emoteId','actionId','jobId','jobName','jobAbbr','gearsetSlot','gearsetName','gearsetVerified','warning','isLyric','isJobSwitch','isLoop','duration'].forEach(function(k){delete clip.data[k];});
        clip.data=Object.assign(clip.data,info.data);
        if(clip._doc&&typeof clip._doc==='object'){
          clip._doc.command=p.command;
          clip._doc.kind=info.track==='lyricClips'?'lyrics':'motion';
          clip._doc.legacyLane=info.track.replace('Clips','');
          if(info.track==='lyricClips')clip._doc.text=clip.data.name;
          else {delete clip._doc.text;clip._doc.clipId='legacyclip-'+clip.id;clip._doc.assetRef={kind:'clip',id:'legacyclip-'+clip.id};}
        }
      }
      var old=original?original.parsed.wait:0,delta=(p.wait||0)-(old||0);
      if(original&&delta){if(original.final){clip.duration=Math.max(0.5,clip.duration+delta);clip.autoDur=false;}else shift+=delta;}
      out[info.track].push(clip);cursor=clip.start+(p.wait||0);
      newRows.push({text:p.command+(p.wait!==null?' <wait.'+number(p.wait)+'>':''),parsed:p,track:info.track,clip:clone(clip),start:clip.start,final:i===after.length-1});
    });
    tracks.forEach(function(k){
      var source=base.original&&base.original[k]||[];
      out[k].sort(function(a,b){var ai=source.findIndex(function(c){return c.id===a.id;}),bi=source.findIndex(function(c){return c.id===b.id;});return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);});
    });
    return {tracks:out,nextId:id,rows:newRows,hidden:base.hidden||[]};
  }
  var api={signature:signature,project:project,reconcile:reconcile,parse:parse};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ChoreoMacro=api;
})(typeof window==='object'?window:globalThis);
