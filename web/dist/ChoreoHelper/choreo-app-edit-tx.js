// 编舞助手编辑事务层（OVERHAUL 批 C 从 choreo-app.js 拆出）：WP-3b 选择摘要＋B3 通用删除＋
// B5 全局插/删时间＋B7a 整段平移＋BSPATIAL 整组空间变换＋B7b 舞段复制粘贴/整轨复制。
// 纯数据操作仍在 choreo-edit.js 的 ChoreoEdit.pure（node 单测覆盖）；这里只做对话框/预检/一次确认/
// 一次写入的接线。同全局名文件级搬家，行为逐字不变；须在 choreo-app.js 之前加载（调用时才读 store 等全局）。
'use strict';
// ============ WP-3b：时间轴编辑基础（多选/复制粘贴/批量/插入删除时间/A-B/标记/独奏静音） ============
// 纯数据操作都在 choreo-edit.js 的 ChoreoEdit.pure（node 单测 test-edit.js 覆盖）；这里只做接线
function edContent(){return {dancers:store.dancers,globalLyrics:store.globalLyrics,markers:store.markers}}
function edSel(){return ChoreoEdit.pure.collectSelected(edContent())}
function edHasSel(){return edSel().length>0}
function edSelectAll(){ChoreoEdit.pure.selectAll(edContent());refreshSelection()}
function edIsMuted(di){return ChoreoEdit.pure.isMuted(store.dancers,di)}
function edHasLoop(){return store.loopA!=null&&store.loopB!=null&&(store.loopB-store.loopA)>=0.5}

// ==== B3：选择摘要单一读取口＋通用 Delete 总事务（键盘与屏幕删除按钮走同一分派函数）====
function selectionSummary(){ // 汇总「舞者×类型×时段」对象列表：片段=selected、技能=ChoreoAbilityUI 全局 id 集、走位/朝向=会话
  var out=[];
  edSel().forEach(function(sc){out.push({kind:'clip',di:sc.di,track:sc.track,clip:sc.clip,span:[sc.clip.start,sc.clip.start+sc.clip.duration]})});
  var skillIds=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection():[];
  if(skillIds.length&&window.ChoreoAbilityPlan){
    var byId={};ChoreoAbilityPlan.rows(store).forEach(function(r){byId[r.event.id]=r});
    skillIds.forEach(function(id){
      var r=byId[id];if(!r)return; // 已被删除/撤销的悬挂 id 不入摘要
      var di=-1;
      for(var i=0;i<store.dancers.length;i++){if(ChoreoAbilityPlan.pid(store,i)===r.source){di=i;break}}
      out.push({kind:'skill',di:di,id:id,span:[r.event.startMs/1000,r.event.startMs/1000]});
    });
  }
  if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.selectionDetail){
    ChoreoStageMotionUI.selectionDetail().forEach(function(o){
      out.push({kind:o.kind,di:o.di,track:o.kind,level:o.level,dirty:o.dirty,node:o.node,missing:o.missing,span:o.span,clipId:o.clipId});
    });
  }
  return out;
}
// §6：删除动作片段不静默牵连其窗口走位——检查被删片段窗口内是否有走位节点，供 toast 明说。
function clipsTouchMovement(clips){
  var P=window.ChoreoStageMotion;if(!P)return false;
  for(var i=0;i<clips.length;i++){
    var sc=clips[i];if(!sc||sc.di==null||sc.di<0||sc.track!=='action')continue;
    var nodes;try{nodes=P.nodes(store,sc.di)}catch(e){continue}
    var a=Math.round(sc.clip.start*1000),b=Math.round((sc.clip.start+sc.clip.duration)*1000);
    if(nodes.movement.some(function(v){var t=Math.round(Number(v.time)*1000);return t>=a&&t<=b}))return true;
  }
  return false;
}
function b3NodeMatch(a,b){ // 节点级按值对位（选中身份＝草稿对象引用；保存轨解析后是等值副本）
  return String(a.time)===String(b.time)&&String(a.x)===String(b.x)&&String(a.z)===String(b.z)&&(a.move==='run')===(b.move==='run');
}
function b3WindowClearPreview(o){ // [a,b] 清窗预告（与 stage-motion-ui clearSamePlace 同口径；公共纯函数归 B5）
  var P=window.ChoreoStageMotion,saved=P.nodes(store,o.di),list=saved.movement,a=o.span[0],b=o.span[1];
  var prev=null,next=null;
  list.forEach(function(v){if(Math.round(Number(v.time)*1000)<a)prev=v});
  next=list.find(function(v){return Math.round(Number(v.time)*1000)>b});
  var inN=list.filter(function(v){var t=Math.round(Number(v.time)*1000);return t>=a&&t<=b}).length;
  var prevTxt=prev?(Math.round(Number(prev.time)*1000)/1000)+'s':'0s';
  var msg='清除 '+inN+' 个走位节点（窗口 ['+a/1000+'s, '+b/1000+'s]）。';
  if(next)msg+='受影响区间 ['+prevTxt+' → '+(Math.round(Number(next.time)*1000)/1000)+'s]：路径重连为直线。';
  else{
    var rest=list.filter(function(v){var t=Math.round(Number(v.time)*1000);return t<a||t>b}),last=rest.length?rest[rest.length-1]:null;
    msg+=rest.length?('清到尾部：受影响区间 ['+prevTxt+' → END]，终态保持值改为 ('+last.x+', '+last.z+')。'):('清空整轨：受影响区间 [0 → END]，回到起点站位。');
  }
  return msg+'立即保存，可一次撤销。';
}
function deleteSelectedClips(){ // B3：通用 Delete 总事务——只经选择摘要分派；节点→T2、时间窗→T3、整条→整轨清除，三级互不扩大
  // 输入框焦点＝文本编辑，永不删对象（S0 亦然；键盘入口 keydown 已拦，此处覆盖屏幕按钮/程序调用入口）
  var ae0=document.activeElement;
  if(ae0&&(ae0.tagName==='INPUT'||ae0.tagName==='TEXTAREA'||ae0.isContentEditable))return;
  // 表 B S6：起始站位未确认草稿→拒绝。B3-RT-02 前移到焦点守卫之后，覆盖全部 Delete 入口（含单片早退分支）。
  if(window.ChoreoStageUI&&ChoreoStageUI.startPosState){
    var sp6=ChoreoStageUI.startPosState();
    if(sp6&&sp6.picked){showToast('起始站位还有未应用的放置：请先应用或取消，再删除');return}
  }
  var sum=selectionSummary();
  var clips=sum.filter(function(o){return o.kind==='clip'});
  var skills=sum.filter(function(o){return o.kind==='skill'});
  var motions=sum.filter(function(o){return o.kind==='movement'||o.kind==='facing'});
  if(!clips.length&&!skills.length&&!motions.length){
    // 悬挂引用兜底（AUD3-W3 FIX-H：Ctrl 点选后 selectedClip 已置 null 之外的镜像情形）
    var one0=store.selectedClip;
    if(one0){
      var di0=-1,tr0='action';store.dancers.forEach(function(d,i){['actionClips','switchClips','lyricClips'].forEach(function(k){if(d[k].indexOf(one0)>=0){di0=i;tr0=k.slice(0,-5)}})});
      var nm0=one0.data&&one0.data.name;
      deleteClip(one0.id);
      showToast('已删除: '+(nm0||'clip')+(clipsTouchMovement([{di:di0,track:tr0,clip:one0}])?'；该动作时段内的走位节点未动':''));
    }
    return;
  }
  if(clips.length<=1&&!skills.length&&!motions.length){
    // 单选片段走原逻辑（同摘要分派的特例分支）
    var one=store.selectedClip||(clips[0]&&clips[0].clip);
    if(!one)return;
    var nm=one.data&&one.data.name;
    var di=-1,tr='action';store.dancers.forEach(function(d,i){['actionClips','switchClips','lyricClips'].forEach(function(k){if(d[k].indexOf(one)>=0){di=i;tr=k.slice(0,-5)}})});
    deleteClip(one.id);
    showToast('已删除: '+(nm||'clip')+(clipsTouchMovement([{di:di,track:tr,clip:one}])?'；该动作时段内的走位节点未动':''));
    return;
  }
  var P=window.ChoreoStageMotion,AP=window.ChoreoAbilityPlan;
  // 会话规则（表 B / R5-06）：受影响舞者脏会话→拒绝（防删轨顺手丢未应用修改）
  if(motions.some(function(o){return o.dirty})){showToast('走位/朝向编辑还有未应用修改：请先「应用」或「取消」，再删除');return}
  // 预检 A（零写入）：走位/朝向对象存在性（节点不在保存轨/窗内无节点/空轨＝提示零写入）
  if(P&&motions.length){
    for(var i=0;i<motions.length;i++){
      var o=motions[i],saved;
      if(o.missing){showToast('未删除：选中的节点已不在草稿中');return}
      try{saved=P.nodes(store,o.di)}catch(e){showToast('未删除：'+e.message);return}
      if(o.level==='node'){
        if(!saved[o.kind].some(function(v){return b3NodeMatch(v,o.node)})){showToast('未删除：选中的'+(o.kind==='movement'?'路径':'朝向')+'节点已不存在');return}
      }else if(o.level==='window'){
        var a=o.span&&o.span[0],b=o.span&&o.span[1];
        if(!(isFinite(a)&&isFinite(b)&&b>a)){showToast('未删除：该走位时间窗无效');return}
        if(!saved.movement.some(function(v){var t=Math.round(Number(v.time)*1000);return t>=a&&t<=b})){showToast('未删除：该时间窗内没有走位节点');return}
      }else if(!saved[o.kind].length){showToast('未删除：这条'+(o.kind==='movement'?'走位':'朝向')+'轨没有节点');return}
    }
  }
  // 预检 B（合成候选）：克隆状态上逐对象过 P.edit / AP.remove——任一拒绝＝整体零写入（先于确认框）
  var skillRemoved=0,removedN=0,removedW=0,removedT=0,cand=null;
  if(P&&motions.length||skills.length&&AP){
    var st={dancers:store.dancers,contentExtra:{_doc:Object.assign({},store.contentExtra&&store.contentExtra._doc,{extraTracks:P?P.tracks(store):AP.tracks(store)})}};
    try{
      motions.forEach(function(o){
        var saved=P.nodes(st,o.di),list=saved[o.kind].slice();
        if(o.level==='node'){var k=list.findIndex(function(v){return b3NodeMatch(v,o.node)});if(k<0)throw Error('选中的节点已不存在');list.splice(k,1);removedN++}
        else if(o.level==='window'){var a=o.span[0],b=o.span[1];list=list.filter(function(v){var t=Math.round(Number(v.time)*1000);return t<a||t>b});removedW++}
        else{list=[];removedT++}
        var vals={movement:saved.movement,facing:saved.facing};vals[o.kind]=list;
        st.contentExtra._doc.extraTracks=P.edit(st,o.di,vals,'wbdel-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
      });
      skills.forEach(function(o){
        if(!AP.rows(st).some(function(r){return r.event.id===o.id}))return; // 已不在轨：跳过不误报
        st.contentExtra._doc.extraTracks=AP.remove(st.contentExtra._doc.extraTracks,o.id);skillRemoved++;
      });
      cand=st.contentExtra._doc.extraTracks;
    }catch(e){showToast('未删除：'+(e.message||e));return}
  }
  // 预检 C（预告确认，可取消＝整体零写入）：整条级列出节点数；窗口级列出受影响区间（节点级预告在选中时已显示）
  for(var ci=0;ci<motions.length;ci++){
    var o2=motions[ci];
    if(o2.level==='track'){
      var cnt=0;try{cnt=P.nodes(store,o2.di)[o2.kind].length}catch(e){}
      var who=store.dancers[o2.di]?store.dancers[o2.di].name:('舞者 '+(o2.di+1));
      if(!confirm('删除「'+who+'」的整条'+(o2.kind==='movement'?'走位':'独立朝向')+'（共 '+cnt+' 个节点）？\n立即保存，可一次撤销。')){showToast('已取消删除，未做任何改动');return}
    }else if(o2.level==='window'){
      if(!confirm(b3WindowClearPreview(o2)+'\n确定清除？')){showToast('已取消删除，未做任何改动');return}
    }
  }
  // 提交：一次写入＋恰好一次 saveHistory（R5-06）；受影响舞者的干净会话关闭并重取基线，其他会话不动
  var touchedMovement=clipsTouchMovement(clips);
  var ids={};clips.forEach(function(sc){ids[sc.clip.id]=true});
  store.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){d[k]=d[k].filter(function(c){return !ids[c.id]})})});
  store.globalLyrics=store.globalLyrics.filter(function(c){return !ids[c.id]});
  store.selectedClip=null;
  if(window.ChoreoAbilityUI&&ChoreoAbilityUI.clearSelection)ChoreoAbilityUI.clearSelection();
  if(cand&&(motions.length||skillRemoved)){P.install(store,cand)}
  if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.discardSessionIfDancer){
    var aff={};motions.forEach(function(o){aff[o.di]=1});
    ChoreoStageMotionUI.discardSessionIfDancer(Object.keys(aff).map(Number));
  }
  saveHistory();updateTotalDuration();render();
  var parts=[];
  if(clips.length)parts.push(clips.length+' 条片段');
  if(skillRemoved)parts.push(skillRemoved+' 条技能');
  if(removedN)parts.push(removedN+' 个'+(removedN===1?'路径节点':'路径/朝向节点'));
  if(removedW)parts.push(removedW+' 段时间窗走位');
  if(removedT)parts.push(removedT+' 条整轨（走位/朝向）');
  showToast('已删除：'+parts.join('、')+'（↶ 可撤销一次）'+(touchedMovement?'；被删动作时段内的走位节点未动':''));
}
function copySelection(){ // Ctrl+C：类型化复制选择摘要（B7b 表 C：片段/技能/走位/朝向全类型；走位对象＝其时段窗内节点）
  var cb=b7bCopyFromSummary();
  if(cb.refuse){showToast(cb.refuse);return}
  if(!cb.items||!cb.items.length){showToast('先选中要复制的内容：单击选中、Ctrl+点击加选、走位/朝向会话窗口也计入；按时间窗整段复制用右键「复制此时段舞段…」');return}
  store._clipboard=cb;
  showToast('已复制 '+b7bCountsText(cb.counts)+'（跨度 '+cb.span.toFixed(1)+'s）');
}
function pasteSelection(){ // Ctrl+V / 右键「粘贴到选中条后」：类型化剪贴板走 B7b 合成事务（预检→腾位→粘贴→重连→提交）；
  // 旧格式剪贴板（本会话早期/程序注入）保持既有单类型粘贴路径（makeRoom 口径）不变。
  if(store._clipboard&&store._clipboard.typed){b7bOpenPasteDialog();return}
  if(!store._clipboard||!store._clipboard.items.length){showToast('剪贴板是空的');return}
  var anchor=store.selectedClip,sel=edSel();
  if(!anchor&&sel.length===1)anchor=sel[0].clip; // Ctrl 取消主片段后仍紧贴唯一选中条
  var t=anchor?(anchor.start+anchor.duration):store.currentTime;
  var created=ChoreoEdit.pure.pasteItems(store._clipboard,edContent(),t,function(){return store.nextClipId++});
  if(!created.length){showToast('粘贴目标舞者不存在（舞者数被减少？）');return}
  clearClipSelection();
  created.forEach(function(c){c.selected=true});
  store.selectedClip=created[created.length-1];
  saveHistory();updateTotalDuration();render();
  showToast(anchor
    ?('已粘贴 '+created.length+' 条紧贴「'+(anchor.data&&anchor.data.name||'clip')+'」之后（重叠的条目已自动右移）')
    :('已粘贴 '+created.length+' 条到播放头 '+store.currentTime.toFixed(1)+'s（重叠的条目已自动右移让位）'));
}
function alignSelectionToPlayhead(){ // 右键「对齐到播放头」：选中条起点统一=播放头（跨舞者齐奏入口）
  var sel=edSel();if(!sel.length)return;
  // 起点未变时保留撤销/重做分支；不能用空快照截断已有重做。
  if(sel.every(function(s){return s.clip.start===store.currentTime})){showToast('所选片段已对齐到播放头');return}
  ChoreoEdit.pure.alignStarts(sel,store.currentTime);
  saveHistory();updateTotalDuration();render();
  showToast('已把 '+sel.length+' 条的起点对齐到 '+store.currentTime.toFixed(1)+'s');
}
// ---------- B5 全局插/删时间（TD-06）：全类型事务（片段/全局歌词/标记＋技能＋每位舞者走位/朝向）----------
// 预检在克隆候选上逐类执行（走位/朝向/朝向伴轨均经产品 M.edit 预检，R5-04）；任一拒绝＝整体零写入并点名
// （R5-01）；一次确认→一次写入＋一次 saveHistory（§7 直接编辑，一次撤销）；播放中拒绝；状态源过期须重试。
function b5StateBytes(){return JSON.stringify([store.dancers,store.globalLyrics,store.markers,store.contentExtra&&store.contentExtra._doc&&store.contentExtra._doc.extraTracks])}
function b5DancerName(di){return store.dancers[di]?store.dancers[di].name:('舞者 '+(di+1))}
// 克隆候选：dancers/globalLyrics/markers（片段与标记经 ChoreoEdit 变换——一律克隆，确认前不碰实时
// store）＋extraTracks 宿主（走位/技能）。
function b5Candidate(){
  var P=window.ChoreoStageMotion;
  var dancers=JSON.parse(JSON.stringify(store.dancers));
  var globalLyrics=JSON.parse(JSON.stringify(store.globalLyrics||[]));
  var markers=JSON.parse(JSON.stringify(store.markers||[]));
  var host={dancers:dancers,contentExtra:{_doc:Object.assign({},store.contentExtra&&store.contentExtra._doc,{extraTracks:JSON.parse(JSON.stringify(P.tracks(store)))})}};
  var content={dancers:dancers,globalLyrics:globalLyrics,markers:markers};
  return {host:host,content:content,install:function(){
    store.dancers=dancers;store.globalLyrics=globalLyrics;store.markers=markers;
    store.contentExtra=store.contentExtra||{};store.contentExtra._doc=store.contentExtra._doc||{};
    store.contentExtra._doc.extraTracks=host.contentExtra._doc.extraTracks;
  }};
}
// 在候选上落一位舞者的走位/朝向双轨：未变的一侧保留原字节（含嵌套扩展，R5-07）。
function b5InstallDancerTracks(cand,di,vals,mvChanged,fcChanged,tag){
  var P=window.ChoreoStageMotion;
  var all=P.edit(cand.host,di,vals,tag);
  all=all.map(function(nt){
    var old=P.tracks(store).find(function(ot){return ot.id===nt.id});
    if(!old||!P.owned(nt))return nt;
    if(nt.type==='movement'&&!mvChanged)return JSON.parse(JSON.stringify(old));
    if(nt.type==='facing'&&!fcChanged)return JSON.parse(JSON.stringify(old));
    return nt;
  });
  cand.host.contentExtra._doc.extraTracks=all;
}
function buildInsertTimeTransaction(t,delta){
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  var cand=b5Candidate(),lines=[];
  // ① 片段/全局歌词/标记：现行 insertTime 右移（跨落点片段行为以产品为准）
  var cp=CEp.insertTimePreview(cand.content,t,delta);
  CEp.insertTime(cand.content,t,delta);
  lines.push('片段/歌词右移：动作 '+cp.action+'、切换 '+cp.switch+'、台词 '+cp.lyric+'、全局歌词 '+cp.globalLyric+'；标记右移 '+cp.markers);
  // ② 技能：startMs≥t 右移（纯函数口径；不落库——随候选安装）
  var ab=A.shiftEvents(cand.host.contentExtra._doc.extraTracks,Math.round(t*1000),Math.round(delta*1000));
  cand.host.contentExtra._doc.extraTracks=ab.tracks;
  lines.push('技能事件右移：'+ab.shifted+' 个');
  // ③ 每位舞者走位/朝向分别 T4（停留锚点对）；无 t≥t 节点的舞者不回写（R5-07）
  var anyTrack=false;
  for(var di=0;di<store.dancers.length;di++){
    var base=CEp.placementFor(store.dancers,di)||{x:0,z:0,yawDeg:0},cur;
    try{cur=P.nodes(cand.host,di)}catch(e){return {refuse:'舞者 '+b5DancerName(di)+' 走位数据无法读取：'+e.message}}
    var gM=P.t4Insert(cur.movement,t,delta,cand.host,di,base,'movement');
    if(gM.refuse)return {refuse:'舞者 '+b5DancerName(di)+' 走位：'+gM.refuse};
    var gF=P.t4Insert(cur.facing,t,delta,cand.host,di,base,'facing');
    if(gF.refuse)return {refuse:'舞者 '+b5DancerName(di)+' 朝向：'+gF.refuse};
    if(!gM.changed&&!gF.changed){
      if(cur.movement.length||cur.facing.length)lines.push('舞者 '+b5DancerName(di)+'：没有 ≥'+t.toFixed(1)+'s 的走位/朝向节点（不动）');
      continue;
    }
    anyTrack=true;
    try{b5InstallDancerTracks(cand,di,{movement:gM.changed?gM.values:cur.movement,facing:gF.changed?gF.values:cur.facing},gM.changed,gF.changed,'b5ins-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
    catch(e){return {refuse:'舞者 '+b5DancerName(di)+' 走位/朝向写入被产品拒绝：'+e.message}}
    var mv=gM.changed?('走位右移 '+gM.shifted+' 节点＋停留锚点 '+gM.anchors+' 个'):'走位不动';
    var fc=gF.changed?('、朝向右移 '+gF.shifted+' 节点＋停留锚点 '+gF.anchors+' 个'):'';
    lines.push('舞者 '+b5DancerName(di)+'：'+mv+fc);
  }
  if(!((cp.action+cp.switch+cp.lyric+cp.globalLyric+cp.markers)>0||ab.shifted>0||anyTrack))
    return {noop:t.toFixed(1)+'s 之后没有需要右移的片段/技能/走位/朝向内容，未做改动'};
  return {preview:'将在 '+t.toFixed(1)+'s 插入 '+delta+'s（影响全部类型）：\n'+lines.join('\n')+
    '\n走位/朝向在 ['+t.toFixed(1)+', '+(t+delta).toFixed(1)+']s 期间停留在原位置（停留锚点对）。\n确定插入？',
    commit:cand.install};
}
function buildDeleteTimeTransaction(t0,t1){
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  // ① 技能跨窗预检：相交→整批拒绝并点名（技能时刻不变更，含其他类型零写入，R5-03）
  var cross=A.rows(store).filter(function(r){return r.event.startMs<t1*1000-0.5&&r.event.startMs+r.event.durationMs>t0*1000+0.5});
  if(cross.length)return {refuse:'技能事件跨删除窗（技能不变更，整批拒绝并点名）：'+cross.map(function(r){
    return (r.event.data&&r.event.data.rehearsalAbility&&r.event.data.rehearsalAbility.name||r.event.id)+'（'+(r.event.startMs/1000)+'s 起）'}).join('、')};
  var cand=b5Candidate(),lines=[];
  // ② 三轨片段＋全局歌词＋标记：真实 CE.deleteTime
  var cp=CEp.deleteTimePreview(cand.content,t0,t1);
  CEp.deleteTime(cand.content,t0,t1);
  lines.push('片段/歌词：移除 '+cp.removed+' 条、跨窗缩短 '+cp.shortened+' 条、其后左移 '+cp.shifted+' 条；标记调整 '+cp.markers+' 个');
  lines.push('技能：无跨删除窗事件（技能时刻不变）');
  // ③ 每位舞者走位 T5；朝向轨时刻不变（独立朝向边界）——但每次双轨 M.edit 在候选上预检（R5-04）
  var anyTrack=false;
  for(var di=0;di<store.dancers.length;di++){
    var base=CEp.placementFor(store.dancers,di)||{x:0,z:0,yawDeg:0},cur;
    try{cur=P.nodes(cand.host,di)}catch(e){return {refuse:'舞者 '+b5DancerName(di)+' 走位数据无法读取：'+e.message}}
    var g=P.t5Delete(cur.movement,t0,t1,cand.host,di,base);
    if(g.refuse){
      if(g.afterEnd){if(cur.movement.length)lines.push('舞者 '+b5DancerName(di)+'：走位窗口在末节点之后（不动）');continue}
      return {refuse:'舞者 '+b5DancerName(di)+' 走位：'+g.refuse};
    }
    anyTrack=true;
    try{b5InstallDancerTracks(cand,di,{movement:g.values,facing:cur.facing},true,false,'b5del-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
    catch(e){return {refuse:'舞者 '+b5DancerName(di)+' 走位写入被产品拒绝：'+e.message}}
    var seg;
    if(g.clearedAll)seg='全部节点在窗内＝整轨清空（[0 → END]，回到起始位）';
    else if(g.startSegmentChange)seg='删 '+g.removedIn+' 节点、左移 '+g.moved+' 节点；起点段 [0 → '+String(g.affected[1])+'s] 从起始位连线';
    else if(g.terminalChange)seg='删 '+g.removedIn+' 节点；['+String(g.affected[0])+'s → END]，终态保持改为前节点值';
    else seg='删 '+g.removedIn+' 节点、左移 '+g.moved+' 节点；重连段 ['+String(g.affected[0])+'s → '+String(g.affected[1])+'s] 将改变';
    lines.push('舞者 '+b5DancerName(di)+' 走位：'+seg);
  }
  lines.push('朝向轨时刻不变（独立朝向）');
  if(!((cp.removed+cp.shortened+cp.shifted+cp.markers)>0||anyTrack))
    return {noop:t0.toFixed(1)+'~'+t1.toFixed(1)+'s 这段没有需要删除的内容，未做改动'};
  return {preview:'将删除 '+t0.toFixed(1)+'~'+t1.toFixed(1)+'s（影响全部类型）：\n'+lines.join('\n')+'\n确定删除？',
    removed:cp.removed,commit:cand.install};
}
function insDelTime(ins){ // 「⋯ 高级」里的插入/删除时间：TD-06 作用全部类型（片段/技能/走位/朝向/歌词/标记）
  if(store.isPlaying){showToast('请先暂停再'+(ins?'插入':'删除')+'时间');return}
  var v=prompt((ins?'在播放头插入的时长':'要删除的时长')+'（秒，0.5 步进，影响全部类型：片段/技能/走位/朝向/歌词/标记）：','2');
  if(v===null)return;
  var sec=ChoreoEdit.pure.q05(parseFloat(v));
  // 非有限时长必须在全轨变换前拒绝，避免溢出输入批量删除或破坏起点。
  if(!isFinite(sec)){showToast('请输入有限的秒数（≥0.5）');return}
  if(!(sec>=0.5)){showToast('请输入 ≥0.5 的秒数');return}
  var t=store.currentTime;
  if(!(t>=0)){showToast('播放头时间无效，未做改动');return}
  var before=b5StateBytes(),tr;
  try{tr=ins?buildInsertTimeTransaction(t,sec):buildDeleteTimeTransaction(t,t+sec)}
  catch(e){showToast((ins?'未插入：':'未删除：')+(e.message||e));return}
  if(tr.refuse){showToast((ins?'未插入：':'未删除：')+tr.refuse);return}
  if(tr.noop){showToast(tr.noop);return}
  if(b5StateBytes()!==before){showToast('项目状态已变化，请重新操作');return}
  if(!confirm(tr.preview)){showToast('已取消，未做任何改动');return}
  tr.commit();
  store.loopA=store.loopB=null; // 时间轴变了，循环区间作废
  if(ins){
    saveHistory();updateTotalDuration();render();
    showToast('已在 '+t.toFixed(1)+'s 插入 '+sec+'s：片段/技能/走位/朝向全部右移（↶ 可撤销）');
  }else{
    var t0=t,t1=t0+sec;
    if(store.currentTime>=t1)store.currentTime-=sec;else if(store.currentTime>t0)store.currentTime=t0;
    store.totalDuration=Math.max(300,store.totalDuration-sec);
    saveHistory();render();
    showToast('已删除 '+t0.toFixed(1)+'~'+t1.toFixed(1)+'s（移除 '+tr.removed+' 条，后面的整体左移；↶ 可撤销）');
  }
}
// ---------- B7a 整段推迟/提前（表 A/T6）：多选整段平移事务（右键菜单/命令面板入口）----------
// R1 §5：作用于选择集（片段、技能事件）＋所选舞者在 [a,b] 内的走位/朝向节点，全部 +Δt；走位/朝向复用
// B5 t6Shift 纯函数（锚点三枚、冲突清单、影响范围分区，只读不改语义）；片段/技能沿既有整组平移口径
// （同轨重叠不阻断、不自动让位、只预告提示——粘贴 makeRoom 的自动右移不适用于平移）；任一预检拒绝＝
// 整体零写入并点名（R5-01 原状态克隆）；预检源过期须重新操作（R5-04）；一次确认→一次写入＋一次
// saveHistory（§7 直接编辑，一次撤销）。影响范围预告如实（源窗∪目标窗∪重连∪尾段），无「窗外采样不变」。
function b7aSpanOf(sum){ // 默认源窗＝所选片段并集跨度（无片段时取技能/会话对象跨度）
  var a=Infinity,b=-Infinity;
  sum.forEach(function(o){if(o.span&&isFinite(o.span[0])&&isFinite(o.span[1])){if(o.span[0]<a)a=o.span[0];if(o.span[1]>b)b=o.span[1]}});
  return isFinite(a)&&isFinite(b)&&b>a?[a,b]:null;
}
function b7aParseWin(v){
  var m=String(v==null?'':v).trim().match(/^(-?[0-9]*\.?[0-9]+)\s*[~,\s]\s*(-?[0-9]*\.?[0-9]+)$/);
  return m?[parseFloat(m[1]),parseFloat(m[2])]:null;
}
function b7aFmt(t){return String(Math.round(t*10)/10)}
function b7aSeg(g){ // t6Shift 的 affected 分区→如实预告文字（源窗∪目标窗∪重连∪尾段）
  return g.affected.map(function(seg){return seg[2]+' ['+b7aFmt(seg[0])+'→'+(seg[1]==='END'?'END':b7aFmt(seg[1]))+']'}).join('、');
}
// B7a 舞者作用域安装器：沿 b5InstallDancerTracks 的 R5-07「未变一侧保留原字节」，但回滚只作用于
// 本舞者的轨——多舞者逐位安装时，后一位舞者单侧未变不得把前一位已装好的同侧新轨回滚为原字节
// （b5InstallDancerTracks 按轨 id 全量回滚存在该跨舞者误伤面，B5 插/删路径登记批外未动）。
function b7aInstallDancerTracks(cand,di,vals,mvChanged,fcChanged,tag){
  var P=window.ChoreoStageMotion,who=P.pid(cand.host,di);
  var all=P.edit(cand.host,di,vals,tag);
  all=all.map(function(nt){
    if(!P.owned(nt)||nt.performerId!==who)return nt;
    var old=P.tracks(store).find(function(ot){return ot.id===nt.id});
    if(!old)return nt;
    if(nt.type==='movement'&&!mvChanged)return JSON.parse(JSON.stringify(old));
    if(nt.type==='facing'&&!fcChanged)return JSON.parse(JSON.stringify(old));
    return nt;
  });
  cand.host.contentExtra._doc.extraTracks=all;
}
function buildShiftTimeTransaction(a,b,delta,cover,motionDis){
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,AP=window.ChoreoAbilityPlan;
  var cand=b5Candidate(),lines=[],conflicts=[];
  // ① 选择集片段（动作/切换/台词＋全局歌词）+Δ：候选上平移；提前出 0 秒＝整批拒绝点名
  var selClips=CEp.collectSelected(cand.content),cc={action:0,switch:0,lyric:0,global:0},i,sc;
  for(i=0;i<selClips.length;i++){
    sc=selClips[i];
    if(!(sc.clip.start+delta>=-1e-9))return {refuse:'片段「'+(sc.clip.data&&sc.clip.data.name||'clip '+sc.clip.id)+'」提前后会早于 0 秒（整批拒绝，零写入）'};
    sc.clip.start+=delta;
    cc[sc.track==='global'?'global':sc.track]++;
  }
  if(selClips.length)lines.push('片段'+(delta>0?'推迟':'提前')+' '+selClips.length+' 条：动作 '+cc.action+'、切换 '+cc.switch+'、台词 '+cc.lyric+'、全局歌词 '+cc.global);
  // 片段侧冲突＝既有整组平移口径（R1 §5）：同轨重叠不阻断、不自动让位，只预告提示
  var lanes={};selClips.forEach(function(s){var k=(s.di<0?'g':'')+s.di+'|'+s.track;(lanes[k]=lanes[k]||[]).push(s)});
  var overlap=0,overlapNames=[];
  CEp.eachClip(cand.content,function(c,di,tt){
    if(c.selected)return;
    var arr=lanes[(di<0?'g':'')+di+'|'+tt];if(!arr)return;
    for(var q=0;q<arr.length;q++){
      var s2=arr[q].clip,ns=s2.start,ne=ns+s2.duration;
      if(ns<c.start+c.duration-0.01&&ne>c.start+0.01){overlap++;if(overlapNames.length<3)overlapNames.push(c.data&&c.data.name||('clip '+c.id));break}
    }
  });
  if(overlap)lines.push('提示：目标位置与 '+overlap+' 条未选中片段同轨重叠（'+overlapNames.join('、')+(overlap>3?' 等':'')+'；既有整组平移口径：不阻断、不自动让位）');
  // ② 选择集技能事件 +Δ（候选上按 id 平移；提前出 0 秒＝整批拒绝点名；所属舞者入所选集合）
  var skillIds=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection():[];
  var want={},skillShifted=0,skillRefuse=null,skillDis={},byPerf={},di;
  for(di=0;di<cand.host.dancers.length;di++){var pp=AP?AP.pid(cand.host,di):null;if(pp)byPerf[pp]=di}
  skillIds.forEach(function(id){want[id]=true});
  if(AP){
    var allT=cand.host.contentExtra._doc.extraTracks;
    outer:
    for(var ti=0;ti<allT.length;ti++){
      var t=allT[ti];if(!AP.owned(t))continue;
      var evs=t.events||[];
      for(var ei=0;ei<evs.length;ei++){
        var e=evs[ei];if(!want[e.id])continue;
        if(!(e.startMs+delta*1000>=-0.5)){skillRefuse='技能事件「'+(e.data&&e.data.rehearsalAbility&&e.data.rehearsalAbility.name||e.id)+'」提前后会早于 0 秒（整批拒绝，零写入）';break outer}
        e.startMs=Math.round(e.startMs+delta*1000);skillShifted++;
        if(byPerf[t.performerId]!==undefined)skillDis[byPerf[t.performerId]]=1;
      }
    }
  }
  if(skillRefuse)return {refuse:skillRefuse};
  if(skillShifted)lines.push('技能事件'+(delta>0?'推迟':'提前')+'：'+skillShifted+' 个');
  // ③ 所选舞者集合＝片段 di ∪ 技能所属 di ∪ 走位/朝向会话 di
  var dis={};
  selClips.forEach(function(s){if(s.di>=0)dis[s.di]=1});
  motionDis.forEach(function(d){if(d>=0&&d<cand.host.dancers.length)dis[d]=1});
  Object.keys(skillDis).forEach(function(k){dis[Number(k)]=1});
  // ④ 每位所选舞者走位/朝向 t6Shift（movement/facing 各自绑定自身 di 与 placementFor 起点；朝向按 yaw）
  var anyTrack=false,changedDis=[],refuse=null,kinds=[['movement','走位'],['facing','朝向']];
  Object.keys(dis).map(Number).sort(function(x,y){return x-y}).forEach(function(d){
    if(refuse)return;
    var base=CEp.placementFor(store.dancers,d)||{x:0,z:0,yawDeg:0},cur;
    try{cur=P.nodes(cand.host,d)}catch(e){refuse='舞者 '+b5DancerName(d)+' 走位数据无法读取：'+e.message;return}
    var res={},parts=[];
    for(var kj=0;kj<kinds.length;kj++){
      var kind=kinds[kj][0],label=kinds[kj][1];
      var g=P.t6Shift(cur[kind],a,b,delta,cover,cand.host,d,base,kind);
      if(g.refuse){
        if(/窗口整体在末节点之后/.test(g.refuse)){if(cur[kind].length)parts.push(label+'：窗口在末节点之后（不动）');continue}
        refuse='舞者 '+b5DancerName(d)+' '+label+'：'+g.refuse;return;
      }
      if(g.conflicts){ // cover=false 探查轮：收集全部冲突对象，本 kind 无产出
        g.conflicts.forEach(function(ts){conflicts.push('舞者 '+b5DancerName(d)+' '+label+'节点 @'+ts+'s')});
        continue;
      }
      res[kind]=g;
      var nIn=cur[kind].filter(function(v){var t=Number(v.time);return t>=a-1e-9&&t<=b+1e-9}).length;
      parts.push(label+'：窗内 '+nIn+' 节点'+(delta>0?'推迟':'提前')+'＋锚点 '+g.anchorsAdded+' 枚'+((g.covered||[]).length?('、覆盖删除 '+g.covered.length+' 个冲突节点'):'')
        +'；影响：'+b7aSeg(g)+(g.terminalChange?'（终态变化）':'')+'；保证：'+g.guarantees.prefixNote);
    }
    var mvG=res.movement||null,fcG=res.facing||null;
    if(!(mvG&&mvG.values)&&!(fcG&&fcG.values)){
      if(cur.movement.length||cur.facing.length||parts.length)lines.push('舞者 '+b5DancerName(d)+'：'+(parts.length?parts.join('；'):'窗口内没有走位/朝向内容（不动）'));
      return;
    }
    anyTrack=true;changedDis.push(d);
    try{b7aInstallDancerTracks(cand,d,{movement:mvG&&mvG.values?mvG.values:cur.movement,facing:fcG&&fcG.values?fcG.values:cur.facing},!!(mvG&&mvG.values),!!(fcG&&fcG.values),'b7a-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
    catch(e){refuse='舞者 '+b5DancerName(d)+' 走位/朝向写入被产品拒绝：'+e.message;return}
    lines.push('舞者 '+b5DancerName(d)+'：'+(parts.join('；')||'窗口内没有显式节点，仍按窗边界锚定'));
  });
  if(refuse)return {refuse:refuse};
  if(conflicts.length)return {conflicts:conflicts}; // 冲突未决：由用户在确认框选「覆盖（重建 cover=true）」或取消
  if(!selClips.length&&!skillShifted&&!anyTrack)
    return {noop:'窗口 ['+b7aFmt(a)+'~'+b7aFmt(b)+'] 内没有需要'+(delta>0?'推迟':'提前')+'的片段/技能/走位/朝向内容，未做改动'};
  return {lines:lines,commit:cand.install,affectedDis:changedDis,clips:selClips.length,skills:skillShifted};
}
function shiftSegmentTime(){ // B7a「整段推迟/提前…」：多选后右键/命令面板入口（一次确认→一次写入＋一次撤销）
  if(store.isPlaying){showToast('请先暂停再整段推迟/提前');return}
  var sum=selectionSummary();
  if(!sum.length){showToast('先选中要平移的内容：多选片段/技能后右键「整段推迟/提前…」');return}
  if(sum.some(function(o){return (o.kind==='movement'||o.kind==='facing')&&o.dirty})){showToast('走位/朝向编辑还有未应用修改：请先「应用」或「取消」，再整段推迟/提前');return}
  var span=b7aSpanOf(sum);
  if(!span){showToast('所选内容没有有效时间跨度，未做改动');return}
  var before=b5StateBytes();
  var wv=prompt('整段推迟/提前——源时间窗 [a~b]（秒；默认＝所选片段并集跨度，可修改）：',b7aFmt(span[0])+'~'+b7aFmt(span[1]));
  if(wv===null)return;
  var win=b7aParseWin(wv);
  if(!win){showToast('时间窗格式：a~b（秒，例如 2~4）');return}
  var a=win[0],b2=win[1];
  if(!(a>=0)){showToast('时间窗起点 a 不能小于 0（'+a+'）');return}
  if(!(b2>a)){showToast('时间窗须满足 b>a（当前 '+a+'~'+b2+'）');return}
  var dv=prompt('位移 Δ（秒，0.5 步进；正＝推迟、负＝提前）：','1');
  if(dv===null)return;
  var delta=parseFloat(dv);
  if(!isFinite(delta)){showToast('请输入有限的位移秒数');return}
  if(delta===0){showToast('零位移：未做任何改动');return}
  if(Math.abs(delta*2-Math.round(delta*2))>1e-9){showToast('Δ 须为 0.5 秒步进（当前 '+dv+'）');return}
  var motionDis=sum.filter(function(o){return o.kind==='movement'||o.kind==='facing'}).map(function(o){return o.di}).filter(function(d){return d!=null&&d>=0});
  var tr,conflictList=null;
  try{
    tr=buildShiftTimeTransaction(a,b2,delta,false,motionDis);
    if(tr.conflicts&&tr.conflicts.length){conflictList=tr.conflicts;tr=buildShiftTimeTransaction(a,b2,delta,true,motionDis)}
  }catch(e){showToast('未推迟/提前：'+(e.message||e));return}
  if(tr.refuse){showToast('未推迟/提前：'+tr.refuse);return}
  if(tr.noop){showToast(tr.noop);return}
  if(b5StateBytes()!==before){showToast('项目状态已变化，请重新操作');return}
  var head='将整段'+(delta>0?'推迟':'提前')+' ['+b7aFmt(a)+'~'+b7aFmt(b2)+'] '+(delta>0?'+':'')+delta+'s（选择集片段/技能＋所选舞者窗内走位/朝向）：\n';
  var cl=conflictList?('\n时窗冲突——以下 '+conflictList.length+' 个对象落在目标窗内；「确定」＝覆盖（删除清单内节点），「取消」＝不做任何改动：\n· '+conflictList.join('\n· ')+'\n'):'';
  var foot='\n影响范围＝源窗∪目标窗∪重连段∪尾段（各舞者分区如上）；片段侧同轨重叠不阻断（既有整组平移口径）。\n一次写入，↶ 可一次撤销。确定执行？';
  if(!confirm(head+cl+tr.lines.join('\n')+foot)){showToast('已取消，未做任何改动');return}
  tr.commit();
  if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.discardSessionIfDancer&&tr.affectedDis&&tr.affectedDis.length)ChoreoStageMotionUI.discardSessionIfDancer(tr.affectedDis);
  if(store.selectedClip){ // cand.install 整体替换了 dancers/globalLyrics：选中主片段按 id 重挂（找不到＝置空）
    var sid=store.selectedClip.id,rel=null;
    ChoreoEdit.pure.eachClip(store,function(c){if(!rel&&c.id===sid)rel=c});
    store.selectedClip=rel;
  }
  saveHistory();updateTotalDuration();render();
  showToast('已整段'+(delta>0?'推迟':'提前')+' '+(delta>0?'+':'')+delta+'s：片段 '+(tr.clips||0)+' 条、技能 '+(tr.skills||0)+' 个、所选舞者窗内走位/朝向同步（↶ 可一次撤销）');
}
// ---------- B-SPATIAL-2 整组空间变换（镜像/旋转/起始位等距）：多选整组事务（右键菜单/命令面板入口）----------
// 属主 2026-09-23「1 修」＝B-SPATIAL-1 评估件①必改口径：作用对象＝所选舞者集合（B7a :909-913 同式
// 并集：片段 di ∪ 技能 owner di ∪ 走位/朝向会话 di）的整条走位/朝向轨＋起始位；镜像按被翻转坐标命名
// （翻 X→朝向 −yaw、翻 Z→朝向 180−yaw，必含朝向）；旋转仅 90° 整数倍；等距仅起始位＋首尾保持。
// 纯函数在 M（mirrorAxis/rotateRight/equidistantStarts）；预检在克隆候选上经产品 M.edit（R5-01）；
// 起始位在候选 dancers 上直写恰三键（隐式固化须预告；量化沿起始位编辑通道＝厘米/整度）；任一拒绝＝
// 整批零写入并点名；一次确认→一次写入＋恰好一次 saveHistory（一次撤销）；取消/播放中/脏会话/状态过期
// ＝b5StateBytes 级零写入。
var BSPATIAL_TYPES={mirrorX:'左右镜像（翻 X 坐标）',mirrorZ:'前后镜像（翻 Z 坐标）',rot90:'顺时针旋转 90°',rot180:'顺时针旋转 180°',rot270:'顺时针旋转 270°',equiX:'沿 X 轴等距（起始位）',equiZ:'沿 Z 轴等距（起始位）'};
function bspFmt(v){return String(Math.round(Number(v)*100)/100)}
function bspatialPivotPoint(dis){ // 组包围盒中心（默认枢轴）：受影响舞者当前放置的包围盒中心
  var CEp=ChoreoEdit.pure,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,n=0;
  (dis||[]).forEach(function(di){
    var p=CEp.placementFor(store.dancers,di);if(!p||!isFinite(p.x)||!isFinite(p.z))return;
    n++;if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.z<minZ)minZ=p.z;if(p.z>maxZ)maxZ=p.z;
  });
  return n?{x:(minX+maxX)/2,z:(minZ+maxZ)/2}:null;
}
function bspatialSameVals(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function buildSpatialTransaction(sum,spec){ // 预检＋候选组装（零写入），返回 {refuse}|{noop}|{preview,counts,affectedDis,commit}
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan,i;
  if(store.isPlaying)return {refuse:'播放中（请先暂停）'};
  if((sum||[]).some(function(o){return (o.kind==='movement'||o.kind==='facing')&&o.dirty}))return {refuse:'走位/朝向编辑还有未应用修改（先「应用」或「取消」）'};
  var type=spec&&spec.type;if(!BSPATIAL_TYPES[type])return {refuse:'变换类型无效'};
  var mode=type.indexOf('equi')===0?'equi':(type.indexOf('mirror')===0?'mirror':'rot');
  var axis=(type==='mirrorX'||type==='equiX')?'x':'z';
  var deg=type==='rot90'?90:type==='rot180'?180:type==='rot270'?270:0;
  // ① 选择分派：片段 di ∪ 技能 owner di ∪ 走位/朝向会话 di（B7a 并集式；片段/技能只贡献所属舞者，时刻不变）
  var skillIds=(window.ChoreoAbilityUI&&ChoreoAbilityUI.selection)?ChoreoAbilityUI.selection():[];
  var want={},byPerf={},nClip=0,nSkill=0,skillDis={};
  skillIds.forEach(function(id){want[id]=true});
  for(i=0;i<store.dancers.length;i++){var pp=A?A.pid(store,i):null;if(pp)byPerf[pp]=i}
  if(A)A.rows(store).forEach(function(r){if(want[r.event.id]&&byPerf[r.source]!==undefined){skillDis[byPerf[r.source]]=1;nSkill++}});
  var dis={};
  (sum||[]).forEach(function(o){
    if(o.kind==='clip'){if(o.di>=0&&o.di<store.dancers.length){dis[o.di]=1;nClip++}}
    else if((o.kind==='movement'||o.kind==='facing')&&o.di>=0&&o.di<store.dancers.length)dis[o.di]=1;
  });
  Object.keys(skillDis).forEach(function(k){dis[Number(k)]=1});
  var disArr=Object.keys(dis).map(Number).sort(function(x,y){return x-y});
  if(!disArr.length)return {noop:'所选内容没有可变换的舞者（片段/技能所属舞者或走位/朝向会话），未做改动'};
  // ② 枢轴：组包围盒中心（默认）/原点；等距不使用枢轴
  var pivot=null;
  if(mode!=='equi'){
    pivot=(spec.pivot==='origin')?{x:0,z:0}:bspatialPivotPoint(disArr);
    if(!pivot||!isFinite(pivot.x)||!isFinite(pivot.z))return {refuse:'无法确定枢轴（受影响舞者放置无效）'};
  }
  var cand=b5Candidate(),lines=[],refuse=null,changedDis=[];
  var beforeBytes=JSON.stringify([cand.host.dancers,store.globalLyrics,store.markers,cand.host.contentExtra._doc.extraTracks]);
  var startsIn=disArr.map(function(di){var p=CEp.placementFor(cand.host.dancers,di);return p?{x:p.x,z:p.z,yawDeg:p.yawDeg}:null});
  var eq=(mode==='equi')?P.equidistantStarts(startsIn,axis):null;
  if(mode==='equi'&&!eq.changed)return {noop:'所选舞者有效起始位 '+eq.count+' 处：等距需要首尾之外还有中间人（不足 3 位），未做改动'};
  var totals={dancers:disArr.length,starts:0,implicit:0,mv:0,fc:0};
  disArr.forEach(function(di,si){
    if(refuse)return;
    var who=b5DancerName(di),cur;
    try{cur=P.nodes(cand.host,di)}catch(e){refuse='舞者 '+who+' 走位数据无法读取：'+e.message;return}
    var base=CEp.placementFor(cand.host.dancers,di);
    if(!base){refuse='舞者 '+who+' 位置无效';return}
    var mvRes,fcRes;
    if(mode==='equi'){mvRes={values:cur.movement};fcRes={values:cur.facing}}
    else if(mode==='mirror'){
      var pv=axis==='x'?pivot.x:pivot.z;
      mvRes=P.mirrorAxis(cur.movement,axis,pv,cand.host,di,'movement');
      if(mvRes.refuse){refuse='舞者 '+who+' 走位：'+mvRes.refuse;return}
      fcRes=P.mirrorAxis(cur.facing,axis,pv,cand.host,di,'facing');
      if(fcRes.refuse){refuse='舞者 '+who+' 朝向：'+fcRes.refuse;return}
    }else{
      mvRes=P.rotateRight(cur.movement,deg,pivot,cand.host,di,'movement');
      if(mvRes.refuse){refuse='舞者 '+who+' 走位：'+mvRes.refuse;return}
      fcRes=P.rotateRight(cur.facing,deg,pivot,cand.host,di,'facing');
      if(fcRes.refuse){refuse='舞者 '+who+' 朝向：'+fcRes.refuse;return}
    }
    // 起始位：镜像/旋转全体、等距仅中间人（首尾保持）；量化沿起始位编辑通道（x/z 厘米、yaw 整度）
    var ns=null;
    if(mode==='equi'){if(eq.moved.indexOf(si)>=0)ns={x:eq.starts[si].x,z:eq.starts[si].z,yawDeg:eq.starts[si].yawDeg}}
    else if(mode==='mirror')ns=axis==='x'?{x:2*pivot.x-base.x,z:base.z,yawDeg:-base.yawDeg}:{x:base.x,z:2*pivot.z-base.z,yawDeg:180-base.yawDeg};
    else{var th=deg*Math.PI/180,c=Math.round(Math.cos(th)),sn=Math.round(Math.sin(th)),dx=base.x-pivot.x,dz=base.z-pivot.z;
      ns={x:pivot.x+dx*c+dz*sn,z:pivot.z-dx*sn+dz*c,yawDeg:base.yawDeg+deg}}
    if(ns){
      var qx=CEp.quantStage(ns.x),qz=CEp.quantStage(ns.z),qy=CEp.quantStageYaw(ns.yawDeg);
      if(!isFinite(qx)||!isFinite(qz)||!isFinite(qy)){refuse='舞者 '+who+' 起始位变换结果无效';return}
      ns={x:qx,z:qz,yawDeg:qy};
    }
    var startChanged=false,wasImplicit=false;
    if(ns){
      var dref=cand.host.dancers[di],ex=CEp.hasExplicitStart(dref);
      if(!ex||!(dref.start.x===ns.x&&dref.start.z===ns.z&&dref.start.yawDeg===ns.yawDeg)){wasImplicit=!ex;startChanged=true;dref.start={x:ns.x,z:ns.z,yawDeg:ns.yawDeg}}
    }
    var mvChanged=mvRes.values.length>0&&!bspatialSameVals(cur.movement,mvRes.values);
    var fcChanged=fcRes.values.length>0&&!bspatialSameVals(cur.facing,fcRes.values);
    if(mvChanged||fcChanged){
      try{b7aInstallDancerTracks(cand,di,{movement:mvRes.values,facing:fcRes.values},mvChanged,fcChanged,'bsp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
      catch(e){refuse='舞者 '+who+' 走位/朝向写入被产品拒绝：'+e.message;return}
    }
    if(startChanged){totals.starts++;if(wasImplicit)totals.implicit++}
    if(mvChanged)totals.mv+=mvRes.values.length;
    if(fcChanged)totals.fc+=fcRes.values.length;
    if(startChanged||mvChanged||fcChanged)changedDis.push(di);
    lines.push('舞者 '+who+'：'+(startChanged?('起始位 ('+bspFmt(base.x)+', '+bspFmt(base.z)+') → ('+bspFmt(ns.x)+', '+bspFmt(ns.z)+')'+(wasImplicit?'（原为隐式，将固化）':'')):'起始位不变')
      +'；'+(mvChanged?('走位 '+mvRes.values.length+' 节点'):(cur.movement.length?'走位不变':'无走位轨'))
      +'、'+(fcChanged?('朝向 '+fcRes.values.length+' 节点'):(cur.facing.length?'朝向不变':'无朝向轨')));
  });
  if(refuse)return {refuse:refuse};
  var afterBytes=JSON.stringify([cand.host.dancers,store.globalLyrics,store.markers,cand.host.contentExtra._doc.extraTracks]);
  if(afterBytes===beforeBytes)return {noop:'变换后与当前状态一致（枢轴/轴选择下没有实际变化），未做改动'};
  var head='整组变换：'+BSPATIAL_TYPES[type]+'；枢轴 '+(mode==='equi'?'不使用枢轴（仅沿 '+axis.toUpperCase()+' 轴重排起始位）':('('+bspFmt(pivot.x)+', '+bspFmt(pivot.z)+')（'+(spec.pivot==='origin'?'原点 0,0':'组包围盒中心')+'）'));
  var sumline='受影响舞者 '+totals.dancers+' 位（实际变化 '+changedDis.length+' 位；所选片段 '+nClip+' 条、技能 '+nSkill+' 个所属舞者进入集合）'
    +'；起始位 '+totals.starts+' 处（其中隐式固化 '+totals.implicit+' 处）；走位节点 '+totals.mv+' 个；朝向节点 '+totals.fc+' 个';
  return {preview:head+'\n'+sumline+'\n'+lines.join('\n')+'\n空间变换不改任何节点时刻；一次写入，↶ 可一次撤销。确定执行？',
    counts:{dancers:totals.dancers,changed:changedDis.length,starts:totals.starts,implicit:totals.implicit,mv:totals.mv,fc:totals.fc,clips:nClip,skills:nSkill},
    affectedDis:changedDis,commit:cand.install};
}
function spatialTransform(){ // 「整组变换…」：多选后右键/命令面板入口（对话框一次确认→一次写入＋一次撤销）
  if(store.isPlaying){showToast('请先暂停再整组变换');return}
  var sum=selectionSummary();
  if(!sum.length){showToast('先选中要变换的内容：选中片段/技能（其所属舞者入集合），或打开走位/朝向编辑后右键「整组变换…」');return}
  if(sum.some(function(o){return (o.kind==='movement'||o.kind==='facing')&&o.dirty})){showToast('走位/朝向编辑还有未应用修改：请先「应用」或「取消」，再整组变换');return}
  var d=b7bDlg('bspatialDlg','整组变换（镜像 / 旋转 / 起始位等距）');
  d.appendChild(b7bNode('p',null,'对所选舞者的整条走位/朝向轨＋起始位做一次整组变换；走位/朝向节点时刻不变，镜像/旋转必含朝向。'));
  var rowT=b7bNode('div');d.appendChild(rowT);
  var lT=b7bNode('label',null,'变换类型 ',rowT);
  var sel=b7bNode('select');sel.id='bspatialType';lT.appendChild(sel);
  Object.keys(BSPATIAL_TYPES).forEach(function(k){var o=b7bNode('option',null,BSPATIAL_TYPES[k]);o.value=k;sel.appendChild(o)});
  sel.value='mirrorX';
  var rowP=b7bNode('div');d.appendChild(rowP);
  b7bNode('span',null,'枢轴 ',rowP);
  var pivots={};
  [['group','组包围盒中心（默认）'],['origin','原点 0,0']].forEach(function(pair){
    var lb=b7bNode('label',null,' ',rowP);
    var r=b7bNode('input');r.type='radio';r.name='bspatialPivot';r.id='bspatialPivot-'+pair[0];r.value=pair[0];r.checked=pair[0]==='group';
    lb.insertBefore(r,lb.firstChild);lb.appendChild(document.createTextNode(pair[1]));
    r.onchange=function(){recompute()};pivots[pair[0]]=r;
  });
  var noteP=b7bNode('span',null,'');noteP.id='bspatialPivotNote';rowP.appendChild(noteP);
  var prev=b7bNode('div');prev.id='bspatialPrev';prev.style.cssText='margin:10px 0;white-space:pre-wrap;background:#101823;border:1px solid #33506a;border-radius:6px;padding:8px;min-height:40px;color:#cfe3f5';prev.textContent='（零写入预览）';d.appendChild(prev);
  var btns=b7bNode('div');btns.style.cssText='margin-top:10px';d.appendChild(btns);
  var ok=b7bNode('button',null,'确定变换');ok.id='bspatialOk';ok.className='btn primary';ok.disabled=true;btns.appendChild(ok);
  var cancel=b7bNode('button',null,'取消');cancel.id='bspatialCancel';cancel.className='btn';btns.appendChild(cancel);
  var lastPlan=null,lastBytes=null;
  function spec(){return {type:sel.value,pivot:(pivots.origin&&pivots.origin.checked)?'origin':'group'}}
  function recompute(){
    var before=b5StateBytes(),tr;
    try{tr=buildSpatialTransaction(selectionSummary(),spec())}
    catch(e){prev.textContent='预检失败：'+(e.message||e);lastPlan=null;ok.disabled=true;return}
    if(b5StateBytes()!==before){prev.textContent='项目状态已变化，请重新选择。';lastPlan=null;ok.disabled=true;return}
    if(tr.refuse){prev.textContent='拒绝（零写入）：'+tr.refuse;lastPlan=null;ok.disabled=true;return}
    if(tr.noop){prev.textContent=tr.noop;lastPlan=null;ok.disabled=true;return}
    prev.textContent=tr.preview;lastPlan=tr;lastBytes=before;ok.disabled=false;
  }
  sel.onchange=function(){noteP.textContent=(sel.value.indexOf('equi')===0?'（等距不使用枢轴）':'');recompute()};
  ok.onclick=function(){
    if(!lastPlan){showToast('请先让预览通过，再确定变换');return}
    if(b5StateBytes()!==lastBytes){prev.textContent='项目状态已变化，请重新选择。';lastPlan=null;ok.disabled=true;return}
    var tr=lastPlan;tr.commit();
    if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.discardSessionIfDancer&&tr.affectedDis&&tr.affectedDis.length)ChoreoStageMotionUI.discardSessionIfDancer(tr.affectedDis);
    if(store.selectedClip){ // cand.install 整体替换了 dancers：选中主片段按 id 重挂（找不到＝置空）
      var sid=store.selectedClip.id,rel=null;
      ChoreoEdit.pure.eachClip(store,function(c){if(!rel&&c.id===sid)rel=c});
      store.selectedClip=rel;
    }
    saveHistory();updateTotalDuration();render();
    showToast('已整组变换：'+BSPATIAL_TYPES[sel.value]+'（实际变化 '+tr.counts.changed+' 位舞者；↶ 可一次撤销）');
    d.remove();
  };
  cancel.onclick=function(){d.remove();showToast('已取消，未做任何改动')};
  recompute();
}
// ---------- B7b 完整舞段复制（表 C）：类型化剪贴板＋插空腾位粘贴合成事务（预检→腾位→粘贴→重连→提交） ----------
// 属主 2026-09-22 知情确认：腾位＝插空腾位（T4 插时间、零覆盖、零截断、按类型右移），与现行单类型粘贴
// makeRoom（推移＋可能截断/删除跨落点条目）不同；跨落点片段默认整批拒绝，截断勾选＝makeRoom 口径
// （截到落点、残余不足 0.5s 删）；技能跨落点＝时长固定不变量，恒拒绝。一次确认（对话框「确定粘贴」）→
// 一次写入＋恰好一次 saveHistory；取消/任一预检失败＝全状态字节级零写入（含其余舞者轨道字节不动）。
var B7B_KIND_LABELS={movement:'走位',facing:'朝向',skill:'技能',action:'动作',switch:'切换',lyric:'台词',globalLyric:'全局歌词',marker:'标记'};
function b7bCountsText(counts){
  var parts=[];
  Object.keys(B7B_KIND_LABELS).forEach(function(k){if(counts&&counts[k])parts.push(B7B_KIND_LABELS[k]+' '+counts[k]+((k==='movement'||k==='facing')?' 节点':' 条'))});
  return parts.length?parts.join('、'):'0 项';
}
function b7bNode(tag,cls,text,parent){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;if(parent)parent.appendChild(e);return e}
function b7bDlg(id,title){ // 轻量模态（内联样式；css 不在本批写域）；同 id 先移除再建
  var old=document.getElementById(id);if(old&&old.remove)old.remove();
  var d=b7bNode('div');d.id=id;
  d.style.cssText='position:fixed;z-index:10001;left:50%;top:8vh;transform:translateX(-50%);width:min(600px,94vw);max-height:82vh;overflow:auto;background:#172131;color:#e6edf7;border:1px solid #729fb4;border-radius:10px;padding:14px;box-shadow:0 12px 48px #0009;line-height:1.6';
  d.appendChild(b7bNode('h3',null,title));
  document.body.appendChild(d);
  return d;
}
// 采集窗口内类型化条目（零写入）。spec={a,b,dancers:{di:bool},types:{kind:bool},
// clipIds/skillIds/motionWins 可选＝「复制所选」只取摘要内对象}。spanStart＝窗起 a（出发锚点采样时刻）。
function b7bCollectPhrase(spec){
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  var a=spec.a,b=spec.b,items=[],counts={},dep={};
  if(!(b>a))return {refuse:'时间窗须满足 止>起'};
  Object.keys(spec.dancers||{}).map(Number).sort(function(x,y){return x-y}).forEach(function(di){
    var d=store.dancers[di];if(!d)return;
    ['switch','action','lyric'].forEach(function(tt){
      if(!spec.types[tt])return;
      (d[tt+'Clips']||[]).forEach(function(c){
        if(spec.clipIds&&!spec.clipIds[c.id])return;
        if(c.start>=a-1e-9&&c.start<=b+1e-9){
          var extra=JSON.parse(JSON.stringify(c));
          ['id','start','duration','autoDur','data','selected'].forEach(function(k){delete extra[k]});
          items.push({kind:tt,sourceDi:di,rel:c.start-a,duration:c.duration,autoDur:c.autoDur===true,
            data:JSON.parse(JSON.stringify(c.data||{})),extra:extra,sourceId:c.id});
          counts[tt]=(counts[tt]||0)+1;
        }
      });
    });
    if(spec.types.movement||spec.types.facing){
      var cur;
      try{cur=P.nodes(store,di)}catch(e){return}
      cur&&[['movement'],['facing']].forEach(function(kk){
        var kind=kk[0];if(!spec.types[kind])return;
        cur[kind].forEach(function(v){
          var t=Number(v.time);
          var wins=(spec.motionWins&&spec.motionWins[di]&&spec.motionWins[di][kind])||[[a,b]];
          var hit=wins.some(function(w){return t>=w[0]-1e-9&&t<=w[1]+1e-9});
          if(!hit)return;
          items.push({kind:kind,sourceDi:di,rel:t-a,node:JSON.parse(JSON.stringify(v))});
          counts[kind]=(counts[kind]||0)+1;
          if(kind==='movement'&&!dep[di]){
            var base=CEp.placementFor(store.dancers,di)||{x:0,z:0,yawDeg:0};
            dep[di]=P.sample(store,di,a*1000,base); // 源段出发锚点＝产品采样（绑定自身 di/起点）
          }
        });
      });
    }
    if(spec.types.skill&&A){
      var who=A.pid(store,di);
      A.rows(store).forEach(function(r){
        if(r.source!==who)return;
        if(spec.skillIds&&!spec.skillIds[r.event.id])return;
        var st=r.event.startMs/1000;
        if(st>=a-1e-9&&st<=b+1e-9){
          items.push({kind:'skill',sourceDi:di,rel:st-a,duration:r.event.durationMs/1000,event:JSON.parse(JSON.stringify(r.event)),sourceId:r.event.id});
          counts.skill=(counts.skill||0)+1;
        }
      });
    }
  });
  if(spec.types.globalLyric){
    (store.globalLyrics||[]).forEach(function(c){
      if(spec.clipIds&&!spec.clipIds[c.id])return;
      if(c.start>=a-1e-9&&c.start<=b+1e-9){
        var extra=JSON.parse(JSON.stringify(c));
        ['id','start','duration','autoDur','data','selected'].forEach(function(k){delete extra[k]});
        items.push({kind:'globalLyric',sourceDi:-1,rel:c.start-a,duration:c.duration,autoDur:c.autoDur===true,
          data:JSON.parse(JSON.stringify(c.data||{})),extra:extra,sourceId:c.id});
        counts.globalLyric=(counts.globalLyric||0)+1;
      }
    });
  }
  if(spec.types.marker){
    (store.markers||[]).forEach(function(mk){
      if(mk.t>=a-1e-9&&mk.t<=b+1e-9){items.push({kind:'marker',sourceDi:-1,rel:mk.t-a,name:mk.name,sourceId:mk.id});counts.marker=(counts.marker||0)+1}
    });
  }
  var span=0;
  items.forEach(function(it){var ext=it.rel+(it.duration||0);if(ext>span)span=ext});
  return {typed:true,v:1,span:span,spanStart:a,dep:dep,counts:counts,items:items};
}
// 「复制所选」＝摘要逐项（片段＋技能＋走位/朝向会话窗口；走位对象＝其时段窗内节点；标记不可选，走舞段对话框）
function b7bCopyFromSummary(){
  var sum=selectionSummary();
  if(sum.some(function(o){return (o.kind==='movement'||o.kind==='facing')&&o.dirty}))
    return {refuse:'走位/朝向编辑还有未应用修改：请先「应用」或「取消」，再复制'};
  var clips=sum.filter(function(o){return o.kind==='clip'});
  var skills=sum.filter(function(o){return o.kind==='skill'});
  var motions=sum.filter(function(o){return o.kind==='movement'||o.kind==='facing'});
  if(!clips.length&&!skills.length&&!motions.length)return {typed:true,items:[],counts:{},span:0};
  var a=Infinity,spanEnd=-Infinity;
  clips.forEach(function(o){a=Math.min(a,o.span[0]);spanEnd=Math.max(spanEnd,o.span[1])});
  skills.forEach(function(o){a=Math.min(a,o.span[0]);spanEnd=Math.max(spanEnd,o.span[1])});
  motions.forEach(function(o){a=Math.min(a,o.span[0]);spanEnd=Math.max(spanEnd,o.span[1])});
  if(skills.length&&window.ChoreoAbilityPlan){ // 技能时长补真（摘要 span 是点，不含 durationMs）
    var byId={};ChoreoAbilityPlan.rows(store).forEach(function(r){byId[r.event.id]=r});
    skills.forEach(function(o){var r=byId[o.id];if(r)spanEnd=Math.max(spanEnd,(r.event.startMs+r.event.durationMs)/1000)});
  }
  var spec={a:a,b:spanEnd,dancers:{},types:{},clipIds:{},skillIds:{},motionWins:{}};
  clips.forEach(function(o){spec.dancers[o.di]=true;spec.types[o.track==='global'?'globalLyric':o.track]=true;spec.clipIds[o.clip.id]=true});
  skills.forEach(function(o){if(o.di>=0)spec.dancers[o.di]=true;spec.types.skill=true;spec.skillIds[o.id]=true});
  var P=window.ChoreoStageMotion;
  motions.forEach(function(o){
    spec.dancers[o.di]=true;spec.types[o.kind]=true;
    var w; // 摘要走位/朝向窗归一化到秒：samePlace 窗口＝毫秒；整条会话＝全轨窗；节点级＝单点窗
    if(o.node&&isFinite(Number(o.node.time)))w=[Number(o.node.time),Number(o.node.time)];
    else if(o.level==='window'&&o.span)w=[o.span[0]/1000,o.span[1]/1000];
    else if(P){try{var nd=P.nodes(store,o.di)[o.kind];w=[0,nd.length?Number(nd[nd.length-1].time):0]}catch(e){w=[0,0]}}
    else w=[0,0];
    (spec.motionWins[o.di]=spec.motionWins[o.di]||{})[o.kind]=(spec.motionWins[o.di][o.kind]||[]).concat([w]);
  });
  return b7bCollectPhrase(spec);
}
// B7b 舞者作用域安装器：未变一侧保留「候选当前」原轨对象字节（含嵌套 point 扩展）。
// 与 b7aInstallDancerTracks 的差别：old 取自候选自身（T4 已装/原样），不回读 store——粘贴链上第二次
// 安装（粘贴重连）不得把 T4 结果回滚为原始字节。
function b7bInstallDancerTracks(cand,di,vals,mvChanged,fcChanged,tag){
  var P=window.ChoreoStageMotion,who=P.pid(cand.host,di);
  var prior=cand.host.contentExtra._doc.extraTracks;
  var all=P.edit(cand.host,di,vals,tag);
  all=all.map(function(nt){
    if(!P.owned(nt)||nt.performerId!==who)return nt;
    var old=prior.find(function(ot){return ot.id===nt.id});
    if(!old)return nt;
    if(nt.type==='movement'&&!mvChanged)return JSON.parse(JSON.stringify(old));
    if(nt.type==='facing'&&!fcChanged)return JSON.parse(JSON.stringify(old));
    return nt;
  });
  cand.host.contentExtra._doc.extraTracks=all;
}
// 合成事务：预检（零写入）→克隆候选上腾位（插空腾位/截断分支）→粘贴与重连→返回 commit。
// 返回 {refuse}|{noop,pending?}|{preview,commit,affectedDis,pending,counts}；store 全程不被触碰。
function b7bBuildPastePlan(t,map,opts){
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  var cb=store._clipboard;
  if(!cb||!cb.typed||!cb.items||!cb.items.length)return {refuse:'剪贴板是空的'};
  if(!(t>=0))return {refuse:'落点 t 无效（须 ≥0）'};
  opts=opts||{};
  var lines=[],pending=[],skipped=[],affectedDis={};
  // ① 类型完备性：未知类型＝整批拒绝点名，绝不静默丢弃
  var unknown=[];
  cb.items.forEach(function(it){if(!B7B_KIND_LABELS[it.kind])unknown.push(String(it.kind)+'（源 di='+it.sourceDi+'）')});
  if(unknown.length)return {refuse:'剪贴板含未知内容类型，整批拒绝点名：'+unknown.join('、')};
  // ② 映射：目标存在＋单射；未映射源→其对象跳过并预告（技能→待替换点名）
  var srcDis=[];cb.items.forEach(function(it){if(it.sourceDi>=0&&srcDis.indexOf(it.sourceDi)<0)srcDis.push(it.sourceDi)});
  srcDis.sort(function(x,y){return x-y});
  var seen={},mapPairs=[],skippedSources={};
  for(var i=0;i<srcDis.length;i++){
    var sdi=srcDis[i],tdi=map[sdi];
    if(tdi==null){skippedSources[sdi]=1;skipped.push('源舞者 '+b5DancerName(sdi)+' 未映射：其对象跳过');continue}
    if(!(tdi>=0&&tdi<store.dancers.length))return {refuse:'源舞者 '+b5DancerName(sdi)+' 的映射目标不存在（di='+tdi+'），整批拒绝'};
    if(seen[tdi])return {refuse:'多个源舞者映射到同一目标 '+b5DancerName(tdi)+'：整批拒绝（一次粘贴每个目标最多接收一个源，请分开粘贴）'};
    seen[tdi]=1;mapPairs.push([sdi,tdi]);
  }
  var hasGlobal=cb.items.some(function(it){return it.kind==='globalLyric'||it.kind==='marker'});
  if(!mapPairs.length&&!hasGlobal)return {noop:'剪贴板内没有可映射内容（源舞者均未映射），未做改动'};
  // ③ 跨落点预检（原状态）：片段/全局歌词默认整批拒绝（截断勾选＝makeRoom 口径）；技能恒拒绝（时长固定）
  var cross=CEp.collectCrossingClips(edContent(),t);
  var crossSkill=[];
  if(A)A.rows(store).forEach(function(r){
    var st=r.event.startMs/1000,en=st+r.event.durationMs/1000;
    if(st<t-0.0005&&en>t+0.0005)crossSkill.push((r.event.data&&r.event.data.rehearsalAbility&&r.event.data.rehearsalAbility.name||r.event.id)+'（'+st+'s 起）');
  });
  if(cross.length&&!opts.truncate){
    return {refuse:'跨落点片段（start<'+t.toFixed(1)+'s<start+duration）默认整批拒绝并点名：'
      +cross.map(function(c){return c.name+'（'+c.track+' '+c.start+'~'+c.end+'s'+(c.di>=0?'，舞者 '+b5DancerName(c.di):'，全局')+'）'}).join('、')
      +'；如需截断到落点请勾选「截断跨落点对象」'};
  }
  if(crossSkill.length)return {refuse:'技能事件跨落点（技能时长＝咏唱+表现提示为固定不变量，不可截断），整批拒绝点名：'+crossSkill.join('、')};
  // ④ 空间映射 offset＝目标舞者在 t 的产品采样位−源段出发锚点（各绑各 di/起点）；保持原坐标＝不平移
  var tOff={};
  mapPairs.forEach(function(pr){
    var hasMv=cb.items.some(function(it){return it.kind==='movement'&&it.sourceDi===pr[0]});
    if(!hasMv)return;
    if(opts.keepCoords){tOff[pr[1]]={x:0,z:0};return}
    var d=(cb.dep&&cb.dep[pr[0]])||{x:0,z:0};
    var tb=CEp.placementFor(store.dancers,pr[1])||{x:0,z:0,yawDeg:0};
    var tgt=P.sample(store,pr[1],t*1000,tb);
    tOff[pr[1]]={x:tgt.x-d.x,z:tgt.z-d.z};
  });
  // ⑤ 候选＋腾位（全局插时间一行）：片段/全局歌词/标记右移（截断分支 makeRoom 同效＋截断＋标记手动右移）；
  //    技能 startMs≥t 右移（B5 纯函数口径）；每位舞者走位/朝向 T4（粘贴目标链上再 pasteConnect）
  var cand=b5Candidate(),delta=cb.span,gap=delta>=0.5,shiftCounts=null,skillShifted=0;
  if(gap){
    if(opts.truncate){
      var mk={shifted:0,truncated:0,removed:0};
      cand.content.dancers.forEach(function(d){['switchClips','actionClips','lyricClips'].forEach(function(k){
        var o=CEp.makeRoom(d[k]||[],t,delta);mk.shifted+=o.shifted;mk.truncated+=o.truncated;mk.removed+=o.removed})});
      var og=CEp.makeRoom(cand.content.globalLyrics||[],t,delta);
      mk.shifted+=og.shifted;mk.truncated+=og.truncated;mk.removed+=og.removed;
      cand.content.markers.forEach(function(mm){if(mm.t>=t-1e-9)mm.t+=delta});
      shiftCounts=mk;
    }else{
      var cp=CEp.insertTimePreview(cand.content,t,delta);
      CEp.insertTime(cand.content,t,delta);
      shiftCounts={action:cp.action,switch:cp.switch,lyric:cp.lyric,globalLyric:cp.globalLyric,markers:cp.markers};
    }
    if(A){
      var ab=A.shiftEvents(cand.host.contentExtra._doc.extraTracks,Math.round(t*1000),Math.round(delta*1000));
      cand.host.contentExtra._doc.extraTracks=ab.tracks;skillShifted=ab.shifted;
    }
  }
  // ⑥ 每位舞者：T4（全局右移）＋粘贴重连（目标）；R5-07：双轨均无 ≥t 节点且无粘贴内容的舞者不往返 M.edit
  var pn={};
  cb.items.forEach(function(it){
    if((it.kind==='movement'||it.kind==='facing')&&!skippedSources[it.sourceDi]){
      var tdi=map[it.sourceDi],key=tdi+'|'+it.kind;
      (pn[key]=pn[key]||[]).push(it);
    }
  });
  var anchors=0,pastedMv=0,pastedFc=0,refuse=null;
  for(var di=0;di<store.dancers.length;di++){
    if(refuse)break;
    var base=CEp.placementFor(store.dancers,di)||{x:0,z:0,yawDeg:0},cur;
    try{cur=P.nodes(cand.host,di)}catch(e){refuse='舞者 '+b5DancerName(di)+' 走位数据无法读取：'+e.message;break}
    var pm=pn[di+'|movement']||[],pf=pn[di+'|facing']||[];
    var gM=gap?P.t4Insert(cur.movement,t,delta,cand.host,di,base,'movement'):null;
    if(gM&&gM.refuse){refuse='舞者 '+b5DancerName(di)+' 走位：'+gM.refuse;break}
    var gF=gap?P.t4Insert(cur.facing,t,delta,cand.host,di,base,'facing'):null;
    if(gF&&gF.refuse){refuse='舞者 '+b5DancerName(di)+' 朝向：'+gF.refuse;break}
    var postM=(gM&&gM.changed)?gM.values:cur.movement;
    var postF=(gF&&gF.changed)?gF.values:cur.facing;
    var rM=null,rF=null;
    if(pm.length){
      var off=opts.keepCoords?{x:0,z:0}:(tOff[di]||{x:0,z:0});
      // offset 平移后按产品三位小数量化（与整轨复制路径同口径，R2 表 A A-2）：几何同位＝量化后同一代表值，
      // 与 H1 锚点正常合并；真异位（量化后仍不同代表值）仍整批拒绝点名。
      rM=P.pasteConnect(postM,pm.map(function(it){
        return {rel:it.rel,x:Math.round((Number(it.node.x)+off.x)*1000)/1000,z:Math.round((Number(it.node.z)+off.z)*1000)/1000,move:it.node.move};
      }),t,delta,cand.host,di,base,'movement');
      if(rM.refuse){refuse='舞者 '+b5DancerName(di)+' 走位：'+rM.refuse;break}
    }
    if(pf.length){
      rF=P.pasteConnect(postF,pf.map(function(it){return {rel:it.rel,yaw:Number(it.node.yaw)}}),t,delta,cand.host,di,base,'facing');
      if(rF.refuse){refuse='舞者 '+b5DancerName(di)+' 朝向：'+rF.refuse;break}
    }
    var mvChanged=!!(gM&&gM.changed)||(rM&&rM.changed);
    var fcChanged=!!(gF&&gF.changed)||(rF&&rF.changed);
    if(!mvChanged&&!fcChanged){
      if((cur.movement.length||cur.facing.length)&&gap)lines.push('舞者 '+b5DancerName(di)+'：没有 ≥'+t.toFixed(1)+'s 的走位/朝向节点（不动）');
      continue;
    }
    if(gap)anchors+=(gM?gM.anchors:0)+(gF?gF.anchors:0);
    pastedMv+=rM?rM.pastedCount:0;pastedFc+=rF?rF.pastedCount:0;
    try{b7bInstallDancerTracks(cand,di,{movement:(rM&&rM.changed)?rM.values:postM,facing:(rF&&rF.changed)?rF.values:postF},mvChanged,fcChanged,'b7b-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
    catch(e){refuse='舞者 '+b5DancerName(di)+' 走位/朝向写入被产品拒绝：'+e.message;break}
    affectedDis[di]=1;
  }
  if(refuse)return {refuse:refuse};
  // ⑦ 片段类粘贴：一律新身份（R5-05 分配器对既有 id＋剪贴板源 id 共同避让）＋落点 t+rel
  var alloc=CEp.allocIdFactory(CEp.existingClipIds(edContent()).concat(
    cb.items.filter(function(it){return typeof it.sourceId==='number'}).map(function(it){return it.sourceId})));
  var created={action:0,switch:0,lyric:0,globalLyric:0,marker:0},lastCreatedId=null;
  cb.items.forEach(function(it){
    if(it.kind==='movement'||it.kind==='facing'||it.kind==='skill')return;
    if(skippedSources[it.sourceDi])return;
    if(it.kind==='marker'){var nm2={id:CEp.newMarkerId(),t:t+it.rel,name:it.name};cand.content.markers.push(nm2);created.marker++;return} // O-5：沿 newMarkerId 字符串命名空间（文档层保号；旧数字 id 归一属既有行为）
    var arr;
    if(it.kind==='globalLyric')arr=cand.content.globalLyrics;
    else{var d=cand.content.dancers[map[it.sourceDi]];if(!d)return;arr=d[it.kind+'Clips']||(d[it.kind+'Clips']=[])}
    var c=Object.assign(JSON.parse(JSON.stringify(it.extra||{})),{
      id:alloc(),start:Math.max(0,t+it.rel),duration:it.duration,autoDur:false,
      data:JSON.parse(JSON.stringify(it.data)),selected:false});
    if(c._doc&&typeof c._doc==='object'&&!Array.isArray(c._doc))delete c._doc.id;
    c._b7bNew=true;
    arr.push(c);created[it.kind]++;lastCreatedId=c.id;
  });
  // ⑧ 技能粘贴：新事件 id＋startMs=(t+rel)×1000（绝不沿用源 id——否则真实 upsert 会替换源事件）；
  //    人目标映射（引用源舞者→改指映射目标、label/position 原样）；映射后经真实 validate，非法→待替换不入库
  var committedSkills=0;
  if(A){
    var people=A.performers(cand.host);
    var pidOf={};mapPairs.forEach(function(pr){pidOf[P.pid(store,pr[0])]=P.pid(cand.host,pr[1])});
    var allT=cand.host.contentExtra._doc.extraTracks;
    for(var si=0;si<cb.items.length;si++){
      var sit=cb.items[si];
      if(sit.kind!=='skill')continue;
      var evName=(sit.event&&sit.event.data&&sit.event.data.rehearsalAbility&&sit.event.data.rehearsalAbility.name)||String(sit.sourceId||'技能');
      if(skippedSources[sit.sourceDi]){pending.push({name:evName,reason:'源舞者 '+b5DancerName(sit.sourceDi)+' 未映射，无处安放',event:sit.event,di:null});continue}
      var tdi2=map[sit.sourceDi],tgtPid=P.pid(cand.host,tdi2);
      var e=JSON.parse(JSON.stringify(sit.event));
      e.id='ability-'+(crypto.randomUUID?crypto.randomUUID():('r'+Date.now().toString(36)+Math.random().toString(36).slice(2,10)));
      e.startMs=Math.round((t+sit.rel)*1000);
      var tp=e.data&&e.data.rehearsalAbility&&e.data.rehearsalAbility.target;
      if(tp&&A.PERSON_TARGETS.includes(tp.kind)){
        var np=pidOf[tp.performerId];
        if(np!==undefined)tp.performerId=np;
      }
      try{A.validate(e,people,tgtPid)}catch(err){pending.push({name:evName,reason:err.message,event:e,di:tdi2});continue}
      try{allT=A.upsert(allT,tgtPid,e,'ability-track-'+(crypto.randomUUID?crypto.randomUUID():('t'+Date.now().toString(36)+Math.random().toString(36).slice(2,10))),people);committedSkills++}
      catch(err){return {refuse:'技能「'+evName+'」写入被产品拒绝：'+err.message}}
    }
    cand.host.contentExtra._doc.extraTracks=allT;
  }
  // ⑨ 汇总：无任何写入内容＝如实 noop（纯待替换只登记预览项）
  var anyWrite=Object.keys(created).some(function(k){return created[k]})||pastedMv||pastedFc||committedSkills
    ||(shiftCounts&&Object.keys(shiftCounts).some(function(k){return (shiftCounts[k]||0)>0}))||skillShifted>0;
  if(!anyWrite){
    if(pending.length)return {noop:'全部技能待替换，没有可写入内容（待替换项只是界面预览，不写入项目——磁盘上不存在待解决数据）',pending:pending};
    return {noop:'没有可写入内容，未做改动'};
  }
  var prev=[];
  prev.push('落点 '+t.toFixed(1)+'s，舞段跨度 '+delta.toFixed(1)+'s。');
  if(gap)prev.push('腾位＝插空腾位：在落点插入空隙，片段/技能/走位/朝向按类型右移——零覆盖、零截断'+(opts.truncate?'（跨落点片段按勾选截断：makeRoom 口径，截到落点、残余不足 0.5s 删）':'')
    +'。'+(opts.truncate
      ?('右移 '+shiftCounts.shifted+' 条、截断 '+shiftCounts.truncated+' 条、删除残余 '+shiftCounts.removed+' 条')
      :('片段/歌词右移：动作 '+(shiftCounts.action||0)+'、切换 '+(shiftCounts.switch||0)+'、台词 '+(shiftCounts.lyric||0)+'、全局歌词 '+(shiftCounts.globalLyric||0)+'；标记右移 '+(shiftCounts.markers||0)+''))
    +'；技能事件右移 '+skillShifted+' 个');
  else prev.push('舞段跨度不足 0.5s：不腾位直接粘贴（可能与后续内容同轨重叠，如实告知）');
  if(anchors||pastedMv||pastedFc)prev.push('走位/朝向：每位舞者 T4 停留锚点对＋粘贴重连（首节点与 H1 同位合并/末点接替 H2），共锚点 '+anchors+' 个、粘贴走位 '+pastedMv+' 节点、朝向 '+pastedFc+' 节点');
  prev.push('粘贴内容：'+b7bCountsText({action:created.action,switch:created.switch,lyric:created.lyric,globalLyric:created.globalLyric,marker:created.marker,skill:committedSkills}));
  if(skipped.length)prev.push('跳过：'+skipped.join('；'));
  if(pending.length)prev.push('待替换技能 '+pending.length+' 个（不写入项目，磁盘上不存在待解决数据）：'+pending.map(function(p2){return p2.name+'——'+p2.reason}).join('；'));
  if(lines.length)prev=prev.concat(lines);
  prev.push('一次写入，↶ 可一次撤销全部类型。');
  // 粘贴条选中（提交后可见反馈；在候选上标记）
  CEp.clearSelection(cand.content);
  var selIds=[];
  CEp.eachClip(cand.content,function(c){if(c._b7bNew){c.selected=true;c._b7bNew=false;selIds.push(c.id)}});
  return {preview:prev.join('\n'),commit:function(){cand.install()},affectedDis:Object.keys(affectedDis).map(Number),
    pending:pending,lastCreatedId:lastCreatedId,selIds:selIds};
}
function b7bOpenCopyPhraseDialog(){ // 「复制此时段舞段…」：勾选 舞者×[起,止]×类型（显示计数）→类型化剪贴板
  var d=b7bDlg('b7bCopyDlg','复制此时段舞段');
  var sp=b7aSpanOf(selectionSummary());
  var defA=sp?sp[0]:0,defB=sp?sp[1]:Math.max(10,Math.ceil(store.currentTime));
  var rowA=b7bNode('div');d.appendChild(rowA);
  var lA=b7bNode('label',null,'时间窗 起 ',rowA);
  var iA=b7bNode('input');iA.id='b7bCopyA';iA.type='text';iA.value=b7aFmt(defA);lA.appendChild(iA);
  var lB=b7bNode('label',null,' ~ 止 ',rowA);
  var iB=b7bNode('input');iB.id='b7bCopyB';iB.type='text';iB.value=b7aFmt(defB);lB.appendChild(iB);
  var dRow=b7bNode('div');d.appendChild(dRow);dRow.appendChild(b7bNode('span',null,'舞者：'));
  store.dancers.forEach(function(dd,di){
    var lb=b7bNode('label',null,' ',dRow);
    var cb=b7bNode('input');cb.id='b7bCd-'+di;cb.type='checkbox';cb.checked=true;lb.insertBefore(cb,lb.firstChild);
    lb.appendChild(document.createTextNode(dd.name));
  });
  var tRow=b7bNode('div');d.appendChild(tRow);tRow.appendChild(b7bNode('span',null,'类型：'));
  var typeList=[['action','动作'],['switch','切换'],['lyric','台词'],['globalLyric','全局歌词'],['marker','标记'],['skill','技能'],['movement','走位'],['facing','朝向']];
  typeList.forEach(function(tt){
    var lb=b7bNode('label',null,' ',tRow);
    var cb=b7bNode('input');cb.id='b7bCt-'+tt[0];cb.type='checkbox';cb.checked=true;lb.insertBefore(cb,lb.firstChild);
    lb.appendChild(document.createTextNode(tt[1]));
  });
  var counts=b7bNode('div');counts.id='b7bCopyCounts';counts.style.cssText='margin:8px 0;color:#9fd0e8';d.appendChild(counts);
  function spec(){
    var dancers={},types={};
    store.dancers.forEach(function(_,di){var n=document.getElementById('b7bCd-'+di);if(n&&n.checked)dancers[di]=true});
    typeList.forEach(function(tt){var n=document.getElementById('b7bCt-'+tt[0]);if(n&&n.checked)types[tt[0]]=true});
    return {a:parseFloat(iA.value),b:parseFloat(iB.value),dancers:dancers,types:types};
  }
  function recompute(){
    var s2=spec();
    if(!(isFinite(s2.a)&&isFinite(s2.b)&&s2.b>s2.a)){counts.textContent='时间窗格式：起<止（秒）';return null}
    var cb=b7bCollectPhrase(s2);
    if(cb.refuse){counts.textContent=cb.refuse;return null}
    counts.textContent=cb.items.length?('将复制：'+b7bCountsText(cb.counts)+'（跨度 '+(cb.span||0).toFixed(1)+'s）'):'窗口内没有可复制的内容';
    return cb;
  }
  recompute();
  [iA,iB].forEach(function(inp){inp.oninput=recompute});
  var btns=b7bNode('div');btns.style.cssText='margin-top:10px';d.appendChild(btns);
  var ok=b7bNode('button',null,'复制');ok.id='b7bCopyOk';ok.className='btn primary';btns.appendChild(ok);
  var cancel=b7bNode('button',null,'取消');cancel.id='b7bCopyCancel';cancel.className='btn';btns.appendChild(cancel);
  ok.onclick=function(){
    var cb=recompute();
    if(!cb)return;
    if(!cb.items||!cb.items.length){showToast('窗口内没有可复制的内容');return}
    if(cb.refuse){showToast(cb.refuse);return}
    store._clipboard=cb;
    showToast('已复制 '+b7bCountsText(cb.counts)+'（跨度 '+cb.span.toFixed(1)+'s）');
    d.remove();
  };
  cancel.onclick=function(){d.remove();showToast('已取消，未做任何改动')};
}
function b7bOpenPasteDialog(){ // 粘贴舞段：落点/actor 映射/空间映射/截断勾选＋预检预览＋一次确认提交
  var cb=store._clipboard;
  if(!cb||!cb.typed||!cb.items||!cb.items.length){showToast('剪贴板是空的');return}
  if(store.isPlaying){showToast('请先暂停再粘贴舞段');return}
  var d=b7bDlg('b7bPasteDlg','粘贴舞段');
  var anchor=store.selectedClip,sel0=edSel();
  if(!anchor&&sel0.length===1)anchor=sel0[0].clip;
  var defT=anchor?(anchor.start+anchor.duration):store.currentTime;
  var rowT=b7bNode('div');d.appendChild(rowT);
  var lT=b7bNode('label',null,'落点 t（秒；所选片段后或播放头） ',rowT);
  var iT=b7bNode('input');iT.id='b7bPasteT';iT.type='text';iT.value=b7aFmt(defT);lT.appendChild(iT);
  var srcDis=[];cb.items.forEach(function(it){if(it.sourceDi>=0&&srcDis.indexOf(it.sourceDi)<0)srcDis.push(it.sourceDi)});
  srcDis.sort(function(x,y){return x-y});
  if(srcDis.length){
    d.appendChild(b7bNode('div',null,'舞者映射（默认同序可改；「不映射」＝该源的对象跳过；多源映射到同一目标＝整批拒绝）：'));
    srcDis.forEach(function(sdi){
      var lb=b7bNode('label',null,' ',d);lb.style.cssText='display:inline-block;margin-right:10px';
      lb.appendChild(document.createTextNode(b5DancerName(sdi)+' → '));
      var s2=b7bNode('select');s2.id='b7bMap-'+sdi;
      var un=b7bNode('option',null,'（不映射·跳过）');un.value='';s2.appendChild(un);
      store.dancers.forEach(function(dd,ti){var o=b7bNode('option',null,dd.name);o.value=String(ti);s2.appendChild(o)});
      s2.value=(sdi<store.dancers.length)?String(sdi):'';
      lb.appendChild(s2);
    });
  }
  var oRow=b7bNode('div');d.appendChild(oRow);
  var lKeep=b7bNode('label',null,' ',oRow);
  var iKeep=b7bNode('input');iKeep.id='b7bKeepCoords';iKeep.type='checkbox';lKeep.insertBefore(iKeep,lKeep.firstChild);
  lKeep.appendChild(document.createTextNode('保持原坐标（默认平移：目标舞者在落点的采样位对齐源段出发锚点；朝向角度不平移）'));
  var lTr=b7bNode('label',null,' ',oRow);
  var iTr=b7bNode('input');iTr.id='b7bTruncate';iTr.type='checkbox';lTr.insertBefore(iTr,lTr.firstChild);
  lTr.appendChild(document.createTextNode('截断跨落点对象（与现行单类型粘贴一致：截到落点、残余不足 0.5s 删；技能不参与）'));
  var prev=b7bNode('div');prev.id='b7bPastePrev';prev.style.cssText='margin:10px 0;white-space:pre-wrap;background:#101823;border:1px solid #33506a;border-radius:6px;padding:8px;min-height:40px;color:#cfe3f5';prev.textContent='点「预检并预览」查看影响预告（零写入）。';d.appendChild(prev);
  var btns=b7bNode('div');btns.style.cssText='margin-top:10px';d.appendChild(btns);
  var chk=b7bNode('button',null,'预检并预览');chk.id='b7bPasteCheck';chk.className='btn';btns.appendChild(chk);
  var ok=b7bNode('button',null,'确定粘贴');ok.id='b7bPasteOk';ok.className='btn primary';ok.disabled=true;btns.appendChild(ok);
  var cancel=b7bNode('button',null,'取消');cancel.id='b7bPasteCancel';cancel.className='btn';btns.appendChild(cancel);
  var lastPlan=null,lastBytes=null;
  chk.onclick=function(){
    var t=parseFloat(iT.value);
    if(!isFinite(t)||t<0){prev.textContent='落点 t 无效（须 ≥0 的秒数）。';lastPlan=null;ok.disabled=true;return}
    var map={};srcDis.forEach(function(sdi){var n=document.getElementById('b7bMap-'+sdi);if(n)map[sdi]=n.value===''?null:Number(n.value)});
    var before=b5StateBytes(),tr;
    try{tr=b7bBuildPastePlan(t,map,{keepCoords:!!iKeep.checked,truncate:!!iTr.checked})}
    catch(e){prev.textContent='预检失败：'+(e.message||e);lastPlan=null;ok.disabled=true;return}
    if(b5StateBytes()!==before){prev.textContent='项目状态已变化，请重新预检。';lastPlan=null;ok.disabled=true;return}
    if(tr.refuse){prev.textContent='拒绝（零写入）：'+tr.refuse;lastPlan=null;ok.disabled=true;return}
    if(tr.noop){prev.textContent=tr.noop+(tr.pending&&tr.pending.length?('\n待替换 '+tr.pending.length+' 个：'+tr.pending.map(function(p2){return p2.name+'——'+p2.reason}).join('；')):'');lastPlan={pendingOnly:tr.pending||[],bytes:before};ok.disabled=!(tr.pending&&tr.pending.length);return}
    prev.textContent=tr.preview;
    lastPlan=tr;lastBytes=before;ok.disabled=false;
  };
  ok.onclick=function(){
    if(!lastPlan){showToast('请先「预检并预览」，且预检须通过');return}
    if(lastPlan.pendingOnly){
      if(b5StateBytes()!==lastPlan.bytes){prev.textContent='项目状态已变化，请重新预检。';lastPlan=null;ok.disabled=true;return}
      if(window.ChoreoAbilityUI&&ChoreoAbilityUI.setPending)ChoreoAbilityUI.setPending(lastPlan.pendingOnly);
      showToast('已记为待替换预览 '+lastPlan.pendingOnly.length+' 个（未写入项目，磁盘上不存在待解决数据）');
      d.remove();return;
    }
    if(b5StateBytes()!==lastBytes){prev.textContent='项目状态已变化，请重新预检。';lastPlan=null;ok.disabled=true;return}
    var tr=lastPlan;
    tr.commit();
    if(window.ChoreoAbilityUI&&ChoreoAbilityUI.setPending)ChoreoAbilityUI.setPending(tr.pending&&tr.pending.length?tr.pending:[]);
    if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.discardSessionIfDancer&&tr.affectedDis&&tr.affectedDis.length)ChoreoStageMotionUI.discardSessionIfDancer(tr.affectedDis);
    if(store.selectedClip){ // cand.install 整体替换 dancers/globalLyrics：按 id 重挂
      var sid=store.selectedClip.id,rel2=null;
      ChoreoEdit.pure.eachClip(store,function(c){if(!rel2&&c.id===sid)rel2=c});
      store.selectedClip=rel2;
    }
    var mx=0;ChoreoEdit.pure.eachClip(store,function(c){if(c.id>mx)mx=c.id});
    store.nextClipId=Math.max(store.nextClipId,mx+1); // R5-05：重载后仍唯一
    store.loopA=store.loopB=null; // 时间轴变了，循环区间作废
    saveHistory();updateTotalDuration();render();
    showToast('已粘贴舞段（↶ 可一次撤销全部类型）'+((tr.pending&&tr.pending.length)?('；待替换 '+tr.pending.length+' 个未写入（界面预览）'):''));
    d.remove();
  };
  cancel.onclick=function(){d.remove();showToast('已取消，未做任何改动')};
  chk.onclick(); // 打开即预检一次（零写入）
}
// ---------- B7b 整轨复制诚实化（TD-04）：三条基础轨＋可选扩展（技能/走位/朝向） ----------
function b7bCopyTracksExtended(srcIdx,dstIdx,opts){ // 预检＋候选组装（零写入），返回 {refuse}|{lines,commit}
  var CEp=ChoreoEdit.pure,P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  opts=opts||{};
  var src=store.dancers[srcIdx],dst=store.dancers[dstIdx];
  if(!src||!dst||srcIdx===dstIdx)return {refuse:'源/目标舞者无效'};
  var counts={switch:(src.switchClips||[]).length,action:(src.actionClips||[]).length,lyric:(src.lyricClips||[]).length};
  if(!counts.switch&&!counts.action&&!counts.lyric)return {refuse:src.name+' 的三条基础轨是空的，没有可复制的内容'};
  var cand=b5Candidate(),lines=[],skipped=[];
  var alloc=CEp.allocIdFactory(CEp.existingClipIds(cand.content));
  if(!CEp.copyDancerTracks(cand.content.dancers,srcIdx,dstIdx,alloc))return {refuse:'三条基础轨复制失败（源/目标无效）'};
  if((dst.switchClips||[]).length||(dst.actionClips||[]).length||(dst.lyricClips||[]).length)
    lines.push('三条基础轨：切换 '+counts.switch+'、动作 '+counts.action+'、台词 '+counts.lyric+'（目标同名轨整体替换，发新 id）——'+dst.name+' 现有三条轨内容会被替换');
  else lines.push('三条基础轨：切换 '+counts.switch+'、动作 '+counts.action+'、台词 '+counts.lyric+'（发新 id）');
  if(opts.skills&&A){
    var srcPid=A.pid(store,srcIdx),tgtPid=A.pid(cand.host,dstIdx),people=A.performers(cand.host),n2=0;
    var allT=cand.host.contentExtra._doc.extraTracks;
    var srcRows=A.rows(store).filter(function(r){return r.source===srcPid});
    for(var i=0;i<srcRows.length;i++){
      var r=srcRows[i],e=JSON.parse(JSON.stringify(r.event));
      e.id='ability-'+(crypto.randomUUID?crypto.randomUUID():('r'+Date.now().toString(36)+Math.random().toString(36).slice(2,10)));
      var tp=e.data&&e.data.rehearsalAbility&&e.data.rehearsalAbility.target;
      if(tp&&A.PERSON_TARGETS.includes(tp.kind)&&tp.performerId===srcPid)tp.performerId=tgtPid; // 人目标引用源舞者→改指目标
      var nm2=(e.data&&e.data.rehearsalAbility&&e.data.rehearsalAbility.name)||e.id;
      try{A.validate(e,people,tgtPid)}catch(err){skipped.push(nm2+'——'+err.message);continue}
      try{allT=A.upsert(allT,tgtPid,e,'ability-track-'+(crypto.randomUUID?crypto.randomUUID():('t'+Date.now().toString(36)+Math.random().toString(36).slice(2,10))),people);n2++}
      catch(err){return {refuse:'技能「'+nm2+'」写入被产品拒绝：'+err.message}}
    }
    cand.host.contentExtra._doc.extraTracks=allT;
    lines.push(n2?('技能：复制 '+n2+' 个（owner＝目标，人目标引用源舞者→改指目标）'):'技能：源没有可复制的技能事件');
    if(skipped.length)lines.push('跳过技能 '+skipped.length+' 个（validate 拒绝，不落库）：'+skipped.join('；'));
  }
  var off=null;
  if(opts.movement||opts.facing){
    if(opts.keepCoords)off={x:0,z:0};
    else{
      var sb=CEp.placementFor(store.dancers,srcIdx)||{x:0,z:0,yawDeg:0};
      var tb=CEp.placementFor(store.dancers,dstIdx)||{x:0,z:0,yawDeg:0};
      off={x:tb.x-sb.x,z:tb.z-sb.z}; // 整轨＝全时轨：offset＝目标起始位−源起始位（t=0 采样位）
    }
  }
  var kinds=[['movement',opts.movement,'走位'],['facing',opts.facing,'朝向']];
  for(var ki=0;ki<kinds.length;ki++){
    var kind=kinds[ki][0],on=kinds[ki][1],label=kinds[ki][2];
    if(!on)continue;
    var curS,dstCur;
    try{curS=P.nodes(store,srcIdx);dstCur=P.nodes(cand.host,dstIdx)}catch(e){return {refuse:'走位数据无法读取：'+e.message}}
    var vals=curS[kind].map(function(v){
      if(kind==='movement')return Object.assign({time:v.time,
        x:String(Math.round((Number(v.x)+off.x)*1000)/1000),z:String(Math.round((Number(v.z)+off.z)*1000)/1000)},
        v.move==='run'?{move:'run'}:{});
      return {time:v.time,yaw:v.yaw};
    });
    var both={movement:dstCur.movement,facing:dstCur.facing};
    both[kind]=vals;
    try{b7bInstallDancerTracks(cand,dstIdx,both,kind==='movement',kind==='facing','b7bt-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}
    catch(e){return {refuse:'目标舞者 '+dst.name+' '+label+'写入被产品拒绝（目标已有锁定/停用轨？）：'+e.message}}
    lines.push(label+'：整条'+(vals.length?('替换 '+vals.length+' 节点'):'清空（源轨为空）')+(opts.keepCoords?'（保持原坐标）':'（平移到目标起始位）')
      +(dstCur[kind].length?('；目标原有 '+dstCur[kind].length+' 节点被替换'):''));
  }
  return {lines:lines,commit:function(){cand.install()}};
}
function b7bCopyTracksDialog(dstIdx,srcIdx){ // 「⇉ 复制三条基础轨（切换/动作/台词）到…」＋可选勾选扩展
  var src=store.dancers[srcIdx],dst=store.dancers[dstIdx];
  if(!src||!dst)return;
  var d=b7bDlg('b7bTracksDlg','复制三条基础轨（切换/动作/台词）');
  d.appendChild(b7bNode('p',null,'把「'+src.name+'」的三条基础轨（切换/动作/台词）复制给「'+dst.name+'」；可勾选扩展：技能/走位/朝向。名称与实际范围一致（TD-04）。'));
  var prev=b7bNode('div');prev.id='b7bTkPrev';prev.style.cssText='white-space:pre-wrap;margin:8px 0;color:#cfe3f5';d.appendChild(prev);
  var P=window.ChoreoStageMotion,A=window.ChoreoAbilityPlan;
  function nOf(di,kind){try{return P.nodes(store,di)[kind].length}catch(e){return 0}}
  function skN(di){if(!A)return 0;var w=A.pid(store,di);return A.rows(store).filter(function(r){return r.source===w}).length}
  function recompute(){
    var t2='三条基础轨：切换 '+(src.switchClips||[]).length+'、动作 '+(src.actionClips||[]).length+'、台词 '+(src.lyricClips||[]).length
      +(((dst.switchClips||[]).length||(dst.actionClips||[]).length||(dst.lyricClips||[]).length)?('（'+dst.name+' 现有三条轨内容会被整体替换）'):'');
    var sk=document.getElementById('b7bTkSkills'),mv=document.getElementById('b7bTkMove'),fc=document.getElementById('b7bTkFace');
    if(sk&&sk.checked)t2+='\n技能：源 '+skN(srcIdx)+' 个事件（owner＝目标；人目标引用源舞者→改指目标；validate 拒绝者跳过点名）';
    if(mv&&mv.checked)t2+='\n走位：整条替换（源 '+nOf(srcIdx,'movement')+' 节点'+(nOf(dstIdx,'movement')?('；目标已有 '+nOf(dstIdx,'movement')+' 节点，将被替换——先确认'):'')+')';
    if(fc&&fc.checked)t2+='\n朝向：整条替换（源 '+nOf(srcIdx,'facing')+' 节点'+(nOf(dstIdx,'facing')?('；目标已有 '+nOf(dstIdx,'facing')+' 节点，将被替换——先确认'):'')+')';
    prev.textContent=t2;
  }
  recompute();
  var rows=[['b7bTkSkills','技能（源 '+skN(srcIdx)+' 个事件；人目标引用源舞者→改指目标）'],
    ['b7bTkMove','走位（源 '+nOf(srcIdx,'movement')+' 节点；整条替换：目标已有轨先确认、节点数预告）'],
    ['b7bTkFace','朝向（源 '+nOf(srcIdx,'facing')+' 节点；整条替换）'],
    ['b7bTkKeep','保持原坐标（默认平移到目标起始位；朝向角度不平移）']];
  rows.forEach(function(rr){
    var lb=b7bNode('label',null,' ',d);lb.style.cssText='display:block';
    var cb=b7bNode('input');cb.id=rr[0];cb.type='checkbox';cb.checked=false;lb.insertBefore(cb,lb.firstChild);
    lb.appendChild(document.createTextNode(rr[1]));
    cb.onclick=recompute;
  });
  var btns=b7bNode('div');btns.style.cssText='margin-top:10px';d.appendChild(btns);
  var ok=b7bNode('button',null,'复制');ok.id='b7bTkOk';ok.className='btn primary';btns.appendChild(ok);
  var cancel=b7bNode('button',null,'取消');cancel.id='b7bTkCancel';cancel.className='btn';btns.appendChild(cancel);
  ok.onclick=function(){
    var tr=b7bCopyTracksExtended(srcIdx,dstIdx,{
      skills:document.getElementById('b7bTkSkills').checked,
      movement:document.getElementById('b7bTkMove').checked,
      facing:document.getElementById('b7bTkFace').checked,
      keepCoords:document.getElementById('b7bTkKeep').checked});
    if(tr.refuse){showToast('未复制：'+tr.refuse);return}
    tr.commit();
    if(window.ChoreoStageMotionUI&&ChoreoStageMotionUI.discardSessionIfDancer)ChoreoStageMotionUI.discardSessionIfDancer([srcIdx,dstIdx]);
    if(store.selectedClip){
      var sid=store.selectedClip.id,rel2=null;
      ChoreoEdit.pure.eachClip(store,function(c){if(!rel2&&c.id===sid)rel2=c});
      store.selectedClip=rel2;
    }
    var mx=0;ChoreoEdit.pure.eachClip(store,function(c){if(c.id>mx)mx=c.id});
    store.nextClipId=Math.max(store.nextClipId,mx+1);
    saveHistory();updateTotalDuration();render();
    showToast('已把 '+src.name+' 的三条基础轨'+(document.getElementById('b7bTkSkills').checked?'＋技能':'')+(document.getElementById('b7bTkMove').checked?'＋走位':'')+(document.getElementById('b7bTkFace').checked?'＋朝向':'')+'复制给 '+dst.name+'（↶ 可一步撤销）');
    d.remove();
  };
  cancel.onclick=function(){d.remove();showToast('已取消，未做任何改动')};
}
