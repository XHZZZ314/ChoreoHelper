// 包一视觉地基回归测试：设计令牌/字号阶梯/类别色/active 统一/停止条分层/舞者8色/内联样式归 CSS/孪生一致性。
// 对应工单 TASK-20260915-UI-P1-VISUAL-FOUNDATION 的 AC-1..AC-6（node 可测部分）。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const webDir = __dirname;
const distDir = path.join(webDir, 'dist', 'ChoreoHelper');
const css = fs.readFileSync(path.join(webDir, 'choreo-helper-app.css'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'choreo-app.js'), 'utf8');
// OVERHAUL 批 C 第五步：时间轴渲染/播放控制两块拆到 choreo-app-timeline.js / choreo-app-playback.js；
// 第六步：RENDER 外壳拆到 choreo-app-render.js；第七步：连接目录层/舞者编辑操作层拆到
// choreo-app-catalog.js / choreo-app-dancers.js。语义断言随代码走：锚在被拆块的检查改读 appAll
// （六件拼接，不变量＝产品源族整体持有该契约），切片类检查改从对应拆分件切片（renderRuler 尾标记
// renderMacroPanel 留主件 → 切到件尾，同批 C 第一步 setLoopPoint 法）。
const appTimeline = fs.readFileSync(path.join(webDir, 'choreo-app-timeline.js'), 'utf8');
const appRender = fs.readFileSync(path.join(webDir, 'choreo-app-render.js'), 'utf8');
const appCatalog = fs.readFileSync(path.join(webDir, 'choreo-app-catalog.js'), 'utf8');
const appDancers = fs.readFileSync(path.join(webDir, 'choreo-app-dancers.js'), 'utf8');
const appPlayback = fs.readFileSync(path.join(webDir, 'choreo-app-playback.js'), 'utf8');
const appAll = app + '\n' + appTimeline + '\n' + appRender + '\n' + appCatalog + '\n' + appDancers + '\n' + appPlayback;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('FAIL - ' + name); }
}

// —— AC-1 字号阶梯 + 覆盖区移除 ——
check('AC-1 覆盖区标记「字体放大」已删除', !css.includes('字体放大'));
const sizes = [];
for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) sizes.push(parseFloat(m[1]));
for (const m of css.matchAll(/font:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)) sizes.push(parseFloat(m[1]));
const ladder = new Set([12, 13, 14, 16, 20]);
const outOfLadder = [...new Set(sizes.filter((v) => !ladder.has(v)))];
check('AC-1 全部字号落在阶梯 {12,13,14,16,20}（共 ' + sizes.length + ' 处，越界: [' + outOfLadder.join(',') + ']）', outOfLadder.length === 0);

// —— AC-2 色彩系统 ——
check('AC-2 无 rgba(...,0.18) 类别底色', (css.match(/rgba\([^)]*,\s*0\.18\)/g) || []).length === 0);
check('AC-2 无 rgba(...,0.3) 悬停底色', (css.match(/rgba\([^)]*,\s*0\.3\)/g) || []).length === 0);
check('AC-2 无硬编码蓝 #2d5a8a', !css.includes('#2d5a8a'));
check('AC-2 无硬编码蓝 #4a9eff', !css.toLowerCase().includes('#4a9eff'));
const activeRule = (css.match(/\.btn\.active\s*\{[^}]*\}/) || [''])[0];
check('AC-2 .btn.active 存在且使用 var(--accent)', /\.btn\.active\s*\{[^}]*var\(--accent\)/.test(css) && activeRule.length > 0);
check('AC-2 .btn.active 无 !important', !activeRule.includes('!important'));
check('AC-2 .btn.active::before 圆点 hack 已移除', !/\.btn\.active::before/.test(css));

// —— AC-3 紧急停止条分层 ——
check('AC-3 .immediate-stop-bar 高度 36px', /\.immediate-stop-bar\{[^}]*height:36px/.test(css));
check('AC-3 .app 与停止条高度一致 (36px)', /\.app\{[^}]*calc\(100dvh - 36px\)[^}]*margin-top:36px/.test(css));
check('AC-3 #immediateStop 为红色实底按钮', /#immediateStop\{[^}]*background:var\(--danger\)/.test(css));
check('AC-3 #immediateStopStatus 右移分组 (margin-left:auto)', /#immediateStopStatus\{[^}]*margin-left:auto/.test(css));

// —— AC-4 舞者 8 色板 ——
const paletteMatch = app.match(/var dancerColors\s*=\s*\[([^\]]+)\]/) || [];
const palette = paletteMatch[1] ? paletteMatch[1].split(',').map((s) => s.trim()) : [];
check('AC-4 dancerColors 恰好 8 色（当前 ' + palette.length + '）', palette.length === 8 && palette.every((c) => /^'#[0-9a-fA-F]{6}'$/.test(c)));
// OVERHAUL 批 C 第七步迁移：makeDancer 随舞者/编辑操作块搬到 choreo-app-dancers.js——族级不变量改读 appAll。
check('AC-4 makeDancer 使用动态取模 idx%dancerColors.length', appAll.includes('dancerColors[idx%dancerColors.length]'));

// —— AC-5 工具栏内联样式移除 ——
check('AC-5 choreo-app.js 无 style.fontSize= 内联字号', (appAll.match(/style\.fontSize\s*=/g) || []).length === 0);
const cssTextBlocks = [...appAll.matchAll(/style\.cssText\s*=\s*'([^']*)'/g)].map((m) => m[1]);
check('AC-5 cssText 字符串不含 font-size', cssTextBlocks.every((block) => !block.includes('font-size')));
check('AC-5 CSS 提供 .add-all-row 类', /\.add-all-row\{/.test(css));
const toolbarBtn = (css.match(/\.toolbar \.btn\{[^}]*\}/) || [''])[0];
const toolbarBtnSize = parseFloat((toolbarBtn.match(/font-size:\s*(\d+)px/) || [0, '0'])[1]);
check('AC-5 .toolbar .btn 字号 ≥12px（当前 ' + toolbarBtnSize + 'px）', toolbarBtnSize >= 12);
check('AC-5 CSS 提供 .act-empty 空态类', /\.act-empty\{/.test(css));

// —— AC-1 附：圆角令牌（无 3/4/5/8px 字面量，2px 微件与 50% 圆除外）——
check('AC-1 圆角令牌 --radius/--radius-lg 已定义', /--radius:6px/.test(css) && /--radius-lg:8px/.test(css));
const badRadius = (css.match(/border-radius:\s*\d+px/g) || []).filter((v) => !/border-radius:\s*(2px|50%)/.test(v) && !/var\(/.test(v));
check('AC-1 无 3/4/5/6/8px 圆角字面量（越界 ' + badRadius.length + ' 处）', badRadius.length === 0);

// —— AC-6 dist 孪生字节一致 ——
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
for (const name of ['choreo-helper-app.css', 'choreo-app.js']) {
  const src = path.join(webDir, name);
  const twin = path.join(distDir, name);
  const same = fs.existsSync(twin) && sha256(src) === sha256(twin);
  check('AC-6 孪生一致: ' + name, same);
}

// ===== 包二（TASK-20260915-UI-P2-TOPBAR-GOVERNANCE）：顶栏治理 =====
// —— P2-AC-1 工具栏分组 + 主播放键 ——
check('P2-AC-1 CSS 提供 .tb-sep 分组分隔线', /\.tb-sep\{/.test(css));
check('P2-AC-1 播放键使用 btn primary 主样式', /el\('button','btn primary'/.test(appAll));
check('P2-AC-1 播放键标签契约保留（网页播放/游戏内播放）', appAll.includes('\\u7F51\\u9875\\u64AD\\u653E') && appAll.includes('\\u6E38\\u620F\\u5185\\u64AD\\u653E') && appAll.includes("bp.id='playBtn'"));
check('P2-AC-1 停止键 title 契约保留（first-macro-journey J4 迁移：普通停止语义说明，仍锚 stopPlay 接线）', appAll.includes('停止（普通停止）') && /bs\.onclick=stopPlay/.test(appAll));
// —— P2-AC-2 撤销/重做可见 ——
check('P2-AC-2 工具栏 ↶ 撤销按钮接线 undo()', /'\\u21B6'/.test(appAll) && /bUndo\.onclick=undo/.test(appAll));
check('P2-AC-2 工具栏 ↷ 重做按钮接线 redo()', /'\\u21B7'/.test(appAll) && /bRedo\.onclick=redo/.test(appAll));
// —— P2-AC-3 文件菜单 + 危险操作收纳 ——
check('P2-AC-3 CSS 提供 .menu-pop/.menu-danger', /\.menu-pop\{/.test(css) && /\.menu-danger\{/.test(css));
// P4-B 旧↔新：旧=顶栏「📂 文件」菜单（toggleFilePop）收纳导出/宏TXT/导入；新=文件按钮与菜单
// 收编进项目中心「导入导出」折叠（#08/#09/#10），三动作逐项保留、清空移入项目中心危险区。
const projectUiSrc = fs.readFileSync(path.join(webDir, 'choreo-project-ui.js'), 'utf8');
check('P2-AC-3 导出/宏TXT/导入收编进项目中心「导入导出」折叠', !appAll.includes("'📂 文件'") && !/function toggleFilePop/.test(appAll) && projectUiSrc.includes("'导出'") && projectUiSrc.includes("'宏TXT'") && projectUiSrc.includes("'导入为新项目'") && projectUiSrc.includes('导入导出') && projectUiSrc.includes("'projectIoFold'"));
check('P2-AC-3 清空收编进项目中心危险区（输入确认门槛不降）', projectUiSrc.includes('危险区') && projectUiSrc.includes('清空当前项目…'));
check('P2-AC-3 清空移入菜单且输入「清空」二次确认', appAll.includes('清空当前项目') && /trim\(\)!=='清空'/.test(appAll) && /bconfirm\.disabled=true/.test(appAll));
check('P2-AC-3 工具栏不再有直接清空按钮', !/el\('button','btn danger','\\u6E05\\u7A7A'\)/.test(appAll));
// P4-C 旧↔新：旧=「⋯ 高级」按钮 badv(id=advBtn)＋资源菜单；新=顶栏「工具」按钮 id=toolsBtn
// 1 击直达工具中心，高级 6 项迁入「高级工具」页（recording-ui 构建），体检 btnCheck 契约不变。
check('P2-AC-3 体检/工具入口契约保留（P4-C：高级按钮收编进工具中心）', appAll.includes("bchk.id='btnCheck'") && appAll.includes("bTools.id='toolsBtn'"));

// ===== 包三（TASK-20260915-UI-P3-LAYOUT-IA）：布局信息架构 =====
const propsUiPath = path.join(webDir, 'choreo-props-ui.js');
const propsUi = fs.existsSync(propsUiPath) ? fs.readFileSync(propsUiPath, 'utf8') : '';
const htmlSrc = fs.readFileSync(path.join(webDir, 'choreo-helper-app.html'), 'utf8');
const p3dSrc = fs.readFileSync(path.join(webDir, 'preview3d.js'), 'utf8');
const p3dCamSrc = fs.readFileSync(path.join(webDir, 'preview3d-cam.js'), 'utf8');
const musicUiSrc = fs.readFileSync(path.join(webDir, 'choreo-music-ui.js'), 'utf8');
// —— P3-AC-1 右侧属性面板 ——
check('P3-AC-1 属性面板模块存在且为严格经典脚本', propsUi.startsWith('//') && propsUi.includes("'use strict';"));
check('P3-AC-1 属性面板无网络副作用', !/fetch\s*\(|XMLHttpRequest|WebSocket/.test(propsUi));
check('P3-AC-1 属性面板导出 ChoreoPropsUI', /globalThis\.ChoreoPropsUI/.test(propsUi));
check('P3-AC-1 校验复用 ChoreoClipTime.plan', propsUi.includes('ChoreoClipTime.plan'));
check('P3-AC-1 app 接线 renderPropPanel 与 propBtn', appAll.includes('renderPropPanel') && appAll.includes("id='propBtn'"));
check('P3-AC-1 CSS 提供 .prop-pnl 右栏宽度', /\.prop-pnl\{[^}]*width:/.test(css));
check('P3-AC-1 面板输入域 id 稳定', propsUi.includes("'propStart'") && propsUi.includes("'propDuration'") && propsUi.includes("'propApply'"));
// —— P3-AC-2 既有编辑入口契约保留 ——
// Web-flow contract: remove duplicate default transport entry; preserve shared context draft and right-click precision dialog.
// Pointer evidence: web-flow-closeout/RESULTS.md, flow-final/checks.json (cancel/no mutation for both routes).
check('P3-AC-2 精确时间能力保留：主编辑区入口＋右键弹窗', propsUi.includes("bTime.id = 'editClipTime'") && propsUi.includes('fold.open = true; inStart.focus()') && appAll.includes('openClipTime') && appAll.includes("act==='time'"));
check('P3-AC-2 右键菜单契约保留', app.includes("getElementById('ctxMenu')") && appAll.includes('showCtxMenu'));
// —— P3-AC-3 浮窗停靠 ——
check('P3-AC-3 app 提供 window.ChoreoDock.layout', /window\.ChoreoDock\s*=\s*\{/.test(appAll));
check('工作台：音乐和预览使用独立持久区域', appAll.includes("getElementById('musicDock')") && appAll.includes("getElementById('previewDock')") && htmlSrc.includes('id="editorFrame"'));
// OVERHAUL 批 B：M1 视图层拆到 preview3d-cam.js（其中 3 处挂钩随迁），与 preview3d.js 的
// 开/关面板 1 处合计仍 ≥4——语义断言跨拆分件计数，不锁单文件实现细节（价值优先门 §5a）
check('P3-AC-3 preview3d 四处停靠挂钩（preview3d.js＋preview3d-cam.js 合计）',
  ((p3dSrc.match(/ChoreoDock\.layout\(\)/g) || []).length + (p3dCamSrc.match(/ChoreoDock\.layout\(\)/g) || []).length) >= 4);
check('P3-AC-3 音乐面板挂载后参与停靠', /ChoreoDock\.layout\(\)/.test(musicUiSrc));
// P1-A 旧↔新：旧断言的 `.editor-frame.preview-open>.preview-dock` 仍要求保留（3D 面板停靠前缀），
// 新增舞台面板常驻列的断言；音乐面板仍是同一持久区域。
check('工作台：音乐进入布局且舞台面板为持久独立列（P1-A：预览停靠进舞台面板）', css.includes('#musicDock>.music-panel{position:relative') && css.includes('.editor-frame>.preview-dock{display:flex') && css.includes('.editor-frame.preview-open>.preview-dock'));
// —— P3-AC-4 空态引导 ——
check('P3-AC-4 空项目时间轴引导浮层', appAll.includes('tl-empty-guide') && appAll.includes('_emptyGuideOff'));
check('P3-AC-4 引导浮层不拦截鼠标', /\.tl-empty-guide\{[^}]*pointer-events:none/.test(css));
check('P3-AC-4 侧栏空态带搜索词', appAll.includes('没有找到含'));
// —— P3-AC-5 模块注册与孪生一致 ——
check('P3-AC-5 HTML 注册新模块（app.js 后、bootstrap 前）', htmlSrc.includes('<script src="choreo-props-ui.js"></script>') && htmlSrc.indexOf('choreo-app.js') < htmlSrc.indexOf('choreo-props-ui.js') && htmlSrc.indexOf('choreo-props-ui.js') < htmlSrc.indexOf('choreo-bootstrap.js'));
for (const name of ['choreo-helper-app.html', 'preview3d.js', 'choreo-music-ui.js', 'choreo-props-ui.js']) {
  const src = path.join(webDir, name);
  const twin = path.join(distDir, name);
  const same = fs.existsSync(twin) && sha256(src) === sha256(twin);
  check('P3-AC-5 孪生一致: ' + name, same);
}

// ===== 包四（TASK-20260915-UI-P4-OPERATIONS）：操作人体工学 =====
const bootstrapSrc = fs.readFileSync(path.join(webDir, 'choreo-bootstrap.js'), 'utf8');
const cmdkPath = path.join(webDir, 'choreo-cmdk-ui.js');
const cmdkSrc = fs.existsSync(cmdkPath) ? fs.readFileSync(cmdkPath, 'utf8') : '';
// —— P4-AC-1 专业播放键 ——
check('P4-AC-1 seekBy 复用 seekTimelinePosition 并钳制 [0,totalDuration]', bootstrapSrc.includes('function seekBy') && /seekBy\(d\)\{seekTimelinePosition\(Math\.max\(0,Math\.min\(store\.currentTime\+d,store\.totalDuration\)\)\)\}/.test(bootstrapSrc));
check('P4-AC-1 K=播放/暂停、J=-5s、L=+5s 键字面量', /e\.code==='KeyK'/.test(bootstrapSrc) && /e\.code==='KeyJ'/.test(bootstrapSrc) && /e\.code==='KeyL'/.test(bootstrapSrc) && bootstrapSrc.includes('seekBy(-5)') && bootstrapSrc.includes('seekBy(5)'));
check('P4-AC-1 逗号/句点细步 ±0.1s，Shift=±1s', /e\.code==='Comma'/.test(bootstrapSrc) && /e\.code==='Period'/.test(bootstrapSrc) && bootstrapSrc.includes('seekBy(e.shiftKey?-1:-0.1)') && bootstrapSrc.includes('seekBy(e.shiftKey?1:0.1)'));
check('P4-AC-1 新键全部位于输入框守卫之后', bootstrapSrc.indexOf("isContentEditable)return;") >= 0 && bootstrapSrc.indexOf("isContentEditable)return;") < bootstrapSrc.indexOf("e.code==='KeyK'") && bootstrapSrc.indexOf("isContentEditable)return;") < bootstrapSrc.indexOf("e.code==='Comma'"));
check('P4-AC-1 既有绑定字面量逐条保留（Space/Delete/Ctrl+Z/Home/方向键）', ["if(e.code==='Space'){e.preventDefault();togglePlay()}", "if(e.code==='Delete'&&store.selectedClip)deleteClip(store.selectedClip.id);", "if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();undo()}", "if(e.code==='Home')stopPlay();", "if(e.code==='ArrowLeft'||e.code==='ArrowRight'){"].every(function (l) { return bootstrapSrc.includes(l); }));
check('P4-AC-1 Ctrl+K 打开命令面板（preventDefault，播放中可用）', /\(e\.ctrlKey\|\|e\.metaKey\)&&\(e\.key==='k'\|\|e\.key==='K'\)\)\{e\.preventDefault\(\);openCmdkPalette\(\)\}/.test(bootstrapSrc));
// —— P4-AC-2 Alt 临时吸附旁路 ——
const bypassIdx = app.indexOf('if(bypass)return t;');
check('P4-AC-2 snapTime 新增 bypass 形参且判定先于 store.snapEnabled', /function snapTime\(t,clip,di,tt,type,bypass\)\{/.test(app) && bypassIdx >= 0 && bypassIdx < app.indexOf('if(!store.snapEnabled)return t;'));
check('P4-AC-2 三处拖拽调用点都传 ev2.altKey', (appAll.match(/snapTime\((ns|ne),clip,di,tt,type,ev2\.altKey\)/g) || []).length === 3);
check('P4-AC-2 工具栏 Snap 开关语句逐字保留', appAll.includes("snapBtn.onclick=function(){store.snapEnabled=!store.snapEnabled;render()}"));
check('P4-AC-2 吸附阈值与拍点分支保留（只加旁路，不改判定）', app.includes('var snap=store.snapThreshold;') && app.includes("bt.mode==='beat'"));
const snapTitleLine = (appAll.match(/snapBtn\.title='[^']*'/) || [''])[0];
check('P4-AC-2 Snap 按钮 title 提示 Alt 临时绕过', snapTitleLine.includes('Alt') && (/暂时关闭|临时绕过/.test(snapTitleLine)||snapTitleLine.includes('\\u4E34\\u65F6\\u7ED5\\u8FC7')));
// —— P4-AC-3 Ctrl+K 命令面板 ——
check('P4-AC-3 模块存在且为严格经典脚本', cmdkSrc.startsWith('//') && cmdkSrc.includes("'use strict';"));
check('P4-AC-3 导出 ChoreoCmdkUI（open/close/isOpen）', /root\.ChoreoCmdkUI=\{open:open,close:close,isOpen:isOpen\}/.test(cmdkSrc));
check('P4-AC-3 键盘导航字面量 ArrowUp/ArrowDown/Enter/Escape', cmdkSrc.includes("'ArrowUp'") && cmdkSrc.includes("'ArrowDown'") && cmdkSrc.includes("'Enter'") && cmdkSrc.includes("'Escape'"));
check('P4-AC-3 过滤走标题与别名的子串匹配', cmdkSrc.includes("String(c.title).toLowerCase().indexOf(q)>=0") && cmdkSrc.includes("c.kw&&String(c.kw).toLowerCase().indexOf(q)>=0"));
check('P4-AC-3 点掩罩关闭、点面板不关', /mask\.onclick=function\(e\)\{if\(e\.target===mask\)close\(\)\}/.test(cmdkSrc));
check('P4-AC-3 掩罩 z-index 高于 500 停靠层', /\.cmdk-mask\{[^}]*z-index:600/.test(css));
check('P4-AC-3 面板无网络副作用（纯视图）', !/fetch\s*\(|XMLHttpRequest|WebSocket/.test(cmdkSrc));
// OVERHAUL 批 C 第六步迁移：buildCmdkCommands/openCmdkPalette 随 RENDER 外壳搬到 choreo-app-render.js
// ——注册表切片从拆分件两标记切片（两标记相邻同件），注入断言改读 appAll。
const registrySrc = appRender.slice(appRender.indexOf('function buildCmdkCommands'), appRender.indexOf('function openCmdkPalette'));
const registryCount = (registrySrc.match(/\{title:'/g) || []).length;
check('P4-AC-3 注册表 ≥10 条且只接线既有全局动作', registryCount >= 10 && ['run:togglePlay', 'run:stopPlay', 'run:undo', 'run:redo', 'run:toggleSidebar', 'run:alignSelectionToPlayhead', 'run:openGroupMove', 'run:showCheckModal', 'run:deleteSelectedClips', 'run:function(){edSelectAll();showToast'].every(function (l) { return registrySrc.includes(l); }));
check('P4-AC-3 app 提供 openCmdkPalette 并注入注册表', appAll.includes('function openCmdkPalette') && appAll.includes('ChoreoCmdkUI.open({commands:buildCmdkCommands()})'));
// —— P4-AC-5 外壳注册与孪生一致 ——
check('P4-AC-5 HTML 注册新模块（app.js 后、bootstrap 前）', htmlSrc.includes('<script src="choreo-cmdk-ui.js"></script>') && htmlSrc.indexOf('choreo-app.js') < htmlSrc.indexOf('choreo-cmdk-ui.js') && htmlSrc.indexOf('choreo-cmdk-ui.js') < htmlSrc.indexOf('choreo-bootstrap.js'));
for (const name of ['choreo-bootstrap.js', 'choreo-cmdk-ui.js', 'choreo-helper-app.css', 'choreo-helper-app.html', 'choreo-app.js']) {
  const src = path.join(webDir, name);
  const twin = path.join(distDir, name);
  const same = fs.existsSync(twin) && sha256(src) === sha256(twin);
  check('P4-AC-5 孪生一致: ' + name, same);
}

// ===== 包五（TASK-20260915-UI-P5-RENDER-PERFORMANCE）：渲染性能 =====
const renderPerfSrc = fs.readFileSync(path.join(webDir, 'choreo-render-perf.js'), 'utf8');
// —— P5-AC-1 统一渲染时钟接线 + 全局入口契约保留 ——
check('P5-AC-1 控制器接 ChoreoRenderPerf.createClock（onFrame/onFlush 单链）',
  /ChoreoRenderPerf\.createClock\(\{/.test(app) && app.includes('onFrame:function(){playLoop(playToken)}') && app.includes('onFlush:renderFlush'));
check('P5-AC-1 全局入口逐字保留：function updatePlayhead(){ / function updateTimeDisplay(){',
  app.includes('function updatePlayhead(){') && app.includes('function updateTimeDisplay(){'));
check('P5-AC-1 播放循环不再自建 rAF 链（统一时钟接管）', !/playRAF\s*=/.test(app) && app.includes('stopRenderClock'));
check('P5-AC-1 纯模块无 DOM/网络/存储副作用', !/document\.|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|IndexedDB/.test(renderPerfSrc));
// —— P5-AC-3 播放头图层 ——
check('P5-AC-3 choreo-app.js 建 #playheadLayer 图层并托管 #playhead', appAll.includes("pl.id='playheadLayer'") && appAll.includes("'playhead-layer'") && appAll.includes("ph.id='playhead'"));
check('P5-AC-3 .playhead-layer 指针穿透 + containment', /\.playhead-layer\{[^}]*pointer-events:none/.test(css) && /\.playhead-layer\{[^}]*contain:/.test(css));
check('P5-AC-3 #playhead/#bottomPlayhead 与 px 公式原样保留',
  appAll.includes("bpm.id='bottomPlayhead'") && appAll.includes("(LABEL_W+store.currentTime*store.pps)+'px'") && appAll.includes("p.style.display='block'"));
// —— P5-AC-4 窗口化 ——
const renderLaneSrc = appTimeline.slice(appTimeline.indexOf('function renderLane('), appTimeline.indexOf('function renderGlobalLyricTrack('));
check('P5-AC-4 renderLane 走 ChoreoRenderPerf.visibleClips', /ChoreoRenderPerf\.visibleClips\(/.test(renderLaneSrc) && renderLaneSrc.includes('__laneMeta'));
// renderRuler 随批 C 第五步迁至 choreo-app-timeline.js 且为件尾（尾标记 renderMacroPanel 留主件）→ 切到件尾
const renderRulerSrc = appTimeline.slice(appTimeline.indexOf('function renderRuler('));
check('P5-AC-4 renderRuler 走 ChoreoRenderPerf.visibleTicks', /ChoreoRenderPerf\.visibleTicks\(/.test(renderRulerSrc));
check('P5-AC-4 拖动/拉长手势期间挂起裁剪', appAll.includes('store._clipDragActive') && appAll.includes('suspended:win.suspended') && appAll.includes("if(store._clipDragActive)return false"));
check('P5-AC-4 滚动与缩放经统一时钟刷新可见窗口', appAll.includes('markWindowDirty') && appAll.includes('refreshTimelineWindow') && appAll.includes('c.requestFrame()'));
// —— P5-AC-5 P1-P4 契约不回退 ——
// P4-B 旧↔新：旧 id 契约含 fileBtn（顶栏「📂 文件」按钮）；新=文件菜单收编进项目中心后该按钮移除，
// 其余工具栏与面板 id 契约逐项保留（fileInput 隐藏导入控件仍在）。
// P4-C 旧↔新：旧 id 契约含 advBtn（「⋯ 高级」按钮，已随资源菜单收编移除）；新=toolsBtn（顶栏「工具」）
// 与 musicBtn（顶栏「音乐」，视图菜单收编后保持 1 击）；2D 舞台/属性/检查/播放 id 不变；旧「资源/视图」
// details.toolbar-menu 不再生成（只剩舞者更多设置与窄屏排练设置）。
check('P5-AC-5 P1-P4 工具栏与面板 id 契约保留（P4-B：fileBtn 移除；P4-C：advBtn→toolsBtn/musicBtn）', ['playBtn', 'btnCheck', 'toolsBtn', 'musicBtn', 'stageBtn', 'propBtn', 'snapBtn'].every(function (id) { return appAll.includes(id); }) && !appAll.includes("bFile.id='fileBtn'") && !appAll.includes("badv.id='advBtn'") && !appAll.includes("toolbarMenu('资源'") && !appAll.includes("toolbarMenu('视图'") && appAll.includes("fi.id='fileInput'"));
check('P5-AC-5 P4 键位与 Alt 旁路、Ctrl+K 面板注册保留',
  /e\.code==='KeyK'/.test(bootstrapSrc) && /e\.code==='KeyJ'/.test(bootstrapSrc) && /e\.code==='KeyL'/.test(bootstrapSrc)
  && app.includes('if(bypass)return t;') && appAll.includes('openCmdkPalette') && appAll.includes('buildCmdkCommands'));
// —— P5-AC-6 外壳注册与孪生一致 ——
check('P5-AC-6 HTML 在控制器之前注册 choreo-render-perf.js',
  htmlSrc.includes('<script src="choreo-render-perf.js"></script>') && htmlSrc.indexOf('choreo-render-perf.js') < htmlSrc.indexOf('choreo-app.js'));
for (const name of ['choreo-render-perf.js', 'choreo-app.js', 'choreo-helper-app.css', 'choreo-helper-app.html']) {
  const src = path.join(webDir, name);
  const twin = path.join(distDir, name);
  check('P5-AC-6 孪生一致: ' + name, fs.existsSync(twin) && sha256(src) === sha256(twin));
}

console.log('\nDesignTokens: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
