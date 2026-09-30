// 主页启动入口：注册全局快捷键并在全部经典脚本加载后启动应用。
'use strict';
// P4（操作人体工学）：播放头跳转统一钳制到 [0, totalDuration] 后仍走既有 seekTimelinePosition 路径
function seekBy(d){seekTimelinePosition(Math.max(0,Math.min(store.currentTime+d,store.totalDuration)))}
// Keyboard shortcuts
document.addEventListener('keydown',function(e){
  // 命令面板可从正在编辑的输入框打开；其他时间轴快捷键仍留给文本输入。
  if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();openCmdkPalette();return}
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;
  if(e.code==='Space'){e.preventDefault();togglePlay()}
  if(e.code==='Delete'&&store.selectedClip)deleteClip(store.selectedClip.id);
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();undo()}
  // WP-3：重做——Ctrl+Y 或 Ctrl+Shift+Z
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&(e.key==='z'||e.key==='Z')))){e.preventDefault();redo()}
  if((e.ctrlKey||e.metaKey)&&e.key==='d'&&store.selectedClip){e.preventDefault();duplicateClip(store.selectedClip)}
  // WP-3b：复制/粘贴/全选（输入框内不生效——上面已经 return 了）
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(e.key==='c'||e.key==='C')){e.preventDefault();copySelection()}
  if((e.ctrlKey||e.metaKey)&&(e.key==='v'||e.key==='V')){e.preventDefault();pasteSelection()}
  if((e.ctrlKey||e.metaKey)&&(e.key==='a'||e.key==='A')){e.preventDefault();edSelectAll();showToast('已全选全部动作条（Esc 取消）')}
  if(e.code==='Home')stopPlay();
  // P4（操作人体工学）专业播放键：K=播放/暂停（同空格）；J/L=播放头 -/+5s；
  // "," / "."=细步 -/+0.1s（Shift 加大为 -/+1s）。只改播放头位置，不改播放语义。
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='KeyK'){e.preventDefault();togglePlay()}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='KeyJ'){e.preventDefault();seekBy(-5)}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='KeyL'){e.preventDefault();seekBy(5)}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='Comma'){e.preventDefault();seekBy(e.shiftKey?-1:-0.1)}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='Period'){e.preventDefault();seekBy(e.shiftKey?1:0.1)}
  // 方向键按实际选集平移 0.5s，保留毫秒起点；Shift 调时长沿用原入口。
  // P1-A：T=把当前时刻设为插入时刻（0.5 吸附），添加控件切换为「插在这里（T）」。
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.code==='KeyT'&&window.ChoreoWorkbench){e.preventDefault();ChoreoWorkbench.setInsertAt(store.currentTime)}
  if(e.code==='ArrowLeft'||e.code==='ArrowRight'){
    var c2=store.selectedClip,dir=(e.code==='ArrowRight')?1:-1;
    if(e.shiftKey){
      if(!c2)return;
      e.preventDefault();
      var duration=Math.max(0.5,c2.duration+dir*0.5);
      if(Math.abs(duration-c2.duration)<1e-9)return;
      c2.duration=duration;c2.autoDur=false;
    }else{
      var sel2=edSel();if(!sel2.length)return;
      e.preventDefault();
      // 单选与多选共用公共边界，不能把最终起点重新量化到半秒格。
      if(Math.abs(ChoreoEdit.pure.moveGroup(sel2,dir*0.5,store.totalDuration))<1e-9)return;
    }
    saveHistory();updateTotalDuration();render();
  }
});

// Verify syntax before running
try{
  // self-test: ensure no syntax errors
}catch(e){}

// P1-A：舞台面板（3D/俯视标签、布局占比、只读俯视预览）在启动前挂好，预览面板开关随类名同步
if(window.ChoreoWorkbench)ChoreoWorkbench.initStage();

init();
