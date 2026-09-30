// 主页外壳结构测试：防止内联块回流、资源漏部署或发布白名单漏项。
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'web');
const distDir = path.join(sourceDir, 'dist', 'ChoreoHelper');
const html = fs.readFileSync(path.join(sourceDir, 'choreo-helper-app.html'), 'utf8');
const css = fs.readFileSync(path.join(sourceDir, 'choreo-helper-app.css'), 'utf8');
const app = fs.readFileSync(path.join(sourceDir, 'choreo-app.js'), 'utf8');
// OVERHAUL 批 C 第五步：时间轴渲染/播放控制两块拆出主件——跨件语义断言读三件拼接（不变量随代码走）。
// 批 C 第六步：RENDER 外壳再拆出 choreo-app-render.js，拼接随之扩为四件。
// 批 C 第七步：连接目录层/舞者编辑操作层再拆出 choreo-app-catalog.js / choreo-app-dancers.js，拼接扩为六件。
const appTimeline = fs.readFileSync(path.join(sourceDir, 'choreo-app-timeline.js'), 'utf8');
const appRender = fs.readFileSync(path.join(sourceDir, 'choreo-app-render.js'), 'utf8');
const appCatalog = fs.readFileSync(path.join(sourceDir, 'choreo-app-catalog.js'), 'utf8');
const appDancers = fs.readFileSync(path.join(sourceDir, 'choreo-app-dancers.js'), 'utf8');
const appPlayback = fs.readFileSync(path.join(sourceDir, 'choreo-app-playback.js'), 'utf8');
const appAll = app + '\n' + appTimeline + '\n' + appRender + '\n' + appCatalog + '\n' + appDancers + '\n' + appPlayback;
const bootstrap = fs.readFileSync(path.join(sourceDir, 'choreo-bootstrap.js'), 'utf8');
const packer = fs.readFileSync(path.join(root, 'scripts', 'make-release-staging.js'), 'utf8');
const uiScripts = [
  'choreo-props-ui.js',
  'choreo-stage-ui.js',
  'choreo-library-ui.js',
  'choreo-check-ui.js',
  'choreo-project-ui.js',
  'choreo-recording-ui.js',
  'choreo-lyrics-ui.js',
  'choreo-show-ui.js',
  'choreo-cmdk-ui.js', // P4：Ctrl+K 命令面板纯视图模块（控制器之后、bootstrap 之前）
];
const productFiles = [
  'choreo-helper-app.html',
  'choreo-helper-app.css',
  // ARCH-2：48794/48795 配对本地 API 客户端（唯一 HTTP 出口，先于所有消费方加载）
  'choreo-api.js',
  'choreo-render-perf.js', // P5：统一渲染时钟/窗口化纯模块（控制器之前加载）
  // OVERHAUL 批 C：choreo-app 拆分件（配对/会话凭据薄壳、编辑事务层），随应用发布（白名单同步登记）
  'choreo-app-auth.js',
  'choreo-app-edit-tx.js',
  // OVERHAUL 批 C 第五步：时间轴渲染分件（主件之前加载）
  'choreo-app-timeline.js',
  // OVERHAUL 批 C 第六步：RENDER 外壳分件（主件之前加载）
  'choreo-app-render.js',
  // OVERHAUL 批 C 第七步：连接目录层/舞者编辑操作层分件（主件之前加载）
  'choreo-app-catalog.js',
  'choreo-app-dancers.js',
  'choreo-app.js',
  // OVERHAUL 批 C 第五步：播放控制分件（主件之后加载——updatePlayhead 双声明以后加载者为生效版）
  'choreo-app-playback.js',
  'choreo-props-ui.js',
  'choreo-macro.js',
  'choreo-macro-ui.js',
  'choreo-meddle-material.js',
  'choreo-model-import.js',
  'choreo-gearset.js',
  'choreo-ability-read.js',
  'choreo-ability-plan.js',
  'choreo-ability-plan-targets.js',
  'choreo-catalog.js',
  'choreo-ability-ui.js',
  'choreo-ability-preview.js',
  // OVERHAUL 批 B：preview3d 拆分件（视图层/模型缓存），随应用发布（白名单同步登记）
  'preview3d-cam.js',
  'preview3d-cache.js',
  'choreo-clip-time.js',
  'choreo-group-move.js',
  'choreo-ensemble-package.js',
  'choreo-ensemble-session.js',
  'choreo-ensemble-transport.js',
  'choreo-ensemble-clock.js',
  'choreo-ensemble-audio.js',
  'choreo-music-timing.js',
  'choreo-music.js',
  'choreo-music-ui.js',
  'choreo-ensemble-ui.js',
  'choreo-ensemble-app.js',
  'choreo-stop.js',
  ...uiScripts,
  'choreo-bootstrap.js',
  // WP-5（规范演出文档）：文档模块 + 持久化接线层，随应用发布
  'choreo-document.js',
  'choreo-docwire.js',
  // EXEC-CORE（演出执行）：ShowCompiler 纯编译模块 + 演出执行面板，随应用发布
  'choreo-show-compiler.js',
];

let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failed++;
    console.error('FAIL ' + name);
  }
}

check('HTML no inline style', !/<style(?:\s|>)/i.test(html));
check('HTML no inline script', !/<script(?!\s+src=)[^>]*>/i.test(html));
check('classic CSS link present', /<link rel="stylesheet" href="choreo-helper-app\.css">/.test(html));
check('classic controller script present', /<script src="choreo-app\.js"><\/script>/.test(html));
check('controller loads after snapshots', html.indexOf('standin-model.js') < html.indexOf('choreo-app.js'));
// WP-5：文档模块与接线层必须先于控制器加载（装载/保存/导入/导出都走它们）
// EXEC-CORE：ShowCompiler 也必须在控制器之前（编译当前项目 → 演出包）
// ARCH-2：choreo-api.js 必须先于每一个消费方（含 engine/library/preview3d/控制器/特性层）
const orderedScripts = ['choreo-api.js', 'choreo-document.js', 'choreo-docwire.js', 'choreo-show-compiler.js', 'choreo-app-auth.js', 'choreo-app-edit-tx.js', 'choreo-app-timeline.js', 'choreo-app-render.js', 'choreo-app-catalog.js', 'choreo-app-dancers.js', 'choreo-app.js', 'choreo-app-playback.js', ...uiScripts, 'choreo-bootstrap.js'];
check('feature scripts load in dependency order', orderedScripts.every((name, i) => i === 0 || html.indexOf(orderedScripts[i - 1]) < html.indexOf(name)));
const apiConsumers = ['choreo-engine.js', 'choreo-library.js', 'choreo-projects.js', 'choreo-document.js', 'choreo-docwire.js', 'choreo-show-compiler.js', 'choreo-edit.js', 'choreo-check.js', 'preview3d.js', 'choreo-app-auth.js', 'choreo-app-timeline.js', 'choreo-app-render.js', 'choreo-app-catalog.js', 'choreo-app.js', 'choreo-app-playback.js', ...uiScripts, 'choreo-bootstrap.js'];
check('choreo-api.js loads before every consumer', apiConsumers.every((name) => html.indexOf(name) >= 0 && html.indexOf('choreo-api.js') < html.indexOf(name)));
// OVERHAUL 批 B：preview3d 拆分件（视图层/模型缓存）存在且紧邻 preview3d.js 之前加载
check('preview3d split modules load before preview3d.js', ['preview3d-cam.js', 'preview3d-cache.js'].every((name) =>
  html.indexOf('<script src="' + name + '"></script>') >= 0 && html.indexOf(name) < html.indexOf('<script src="preview3d.js"></script>')));
// OVERHAUL 批 C：choreo-app 拆分件（配对薄壳/编辑事务层）存在、紧邻 choreo-app.js 之前加载、严格经典脚本；
// 编辑事务层不自建网络出口（配对请求仍归 choreo-app-auth.js → choreo-api.js）
check('choreo-app split modules load before choreo-app.js', ['choreo-app-auth.js', 'choreo-app-edit-tx.js'].every((name) =>
  html.indexOf('<script src="' + name + '"></script>') >= 0 && html.indexOf(name) < html.indexOf('<script src="choreo-app.js"></script>')));
check('choreo-app split modules are strict classic with zero network in edit-tx', ['choreo-app-auth.js', 'choreo-app-edit-tx.js'].every((name) =>
  fs.readFileSync(path.join(sourceDir, name), 'utf8').includes("'use strict';"))
  && !/fetch\s*\(|XMLHttpRequest/.test(fs.readFileSync(path.join(sourceDir, 'choreo-app-edit-tx.js'), 'utf8')));
// OVERHAUL 批 C 第五步：时间轴渲染分件在 choreo-app.js 之前；播放控制分件在 choreo-app.js 之后、
// bootstrap 之前——updatePlayhead 双声明（主件渲染时钟区早期版 / 播放件生效版）跨文件「后加载者生效」，
// 播放件必须后于主件加载才保持行为逐字不变；两件装时机语句自足，顺序对 uiScripts 无前置要求。
check('choreo-app step-5 splits order (timeline before app, playback after app before bootstrap)',
  html.indexOf('<script src="choreo-app-timeline.js"></script>') >= 0
  && html.indexOf('choreo-app-timeline.js') < html.indexOf('<script src="choreo-app.js"></script>')
  && html.indexOf('<script src="choreo-app.js"></script>') < html.indexOf('choreo-app-playback.js')
  && html.indexOf('choreo-app-playback.js') < html.indexOf('<script src="choreo-bootstrap.js"></script>'));
check('choreo-app step-5 splits are strict classic', ['choreo-app-timeline.js', 'choreo-app-playback.js'].every((name) =>
  fs.readFileSync(path.join(sourceDir, name), 'utf8').includes("'use strict';")));
// OVERHAUL 批 C 第六步：RENDER 外壳分件在 choreo-app.js 之前加载（同 timeline 件「拆分件先于消费者」
// 先例；装时机语句自足：window.ChoreoDock 赋值/toolbar-menu click 监听/ResizeObserver 挂 #root 等；
// renderActionList 向 ChoreoAbilityRead 传 read:apiFetch＝真 API 消费方，故不设零网络断言）。
check('choreo-app step-6 render split order (render before app)',
  html.indexOf('<script src="choreo-app-render.js"></script>') >= 0
  && html.indexOf('choreo-app-render.js') < html.indexOf('<script src="choreo-app.js"></script>'));
check('choreo-app step-6 render split is strict classic', fs.readFileSync(path.join(sourceDir, 'choreo-app-render.js'), 'utf8').startsWith('//')
  && fs.readFileSync(path.join(sourceDir, 'choreo-app-render.js'), 'utf8').includes("'use strict';"));
// OVERHAUL 批 C 第七步：连接目录层/舞者编辑操作层两分件在 choreo-app.js 之前加载（同 timeline/render
// 「拆分件先于消费者」先例；装时机语句自足：_connTimer/_measuredTimer/_catalog 创建/_libAutoBusy 与
// _knownProfiles/__choreoModelImportTarget 赋值）；catalog 是 apiFetch/ChoreoAPI 真消费方（已在 apiConsumers
// 登记），dancers 零网络出口故不设 API 消费断言。
check('choreo-app step-7 splits order (catalog/dancers before app)',
  html.indexOf('<script src="choreo-app-catalog.js"></script>') >= 0
  && html.indexOf('<script src="choreo-app-dancers.js"></script>') >= 0
  && html.indexOf('choreo-app-render.js') < html.indexOf('choreo-app-catalog.js')
  && html.indexOf('choreo-app-catalog.js') < html.indexOf('choreo-app-dancers.js')
  && html.indexOf('choreo-app-dancers.js') < html.indexOf('<script src="choreo-app.js"></script>'));
check('choreo-app step-7 splits are strict classic', ['choreo-app-catalog.js', 'choreo-app-dancers.js'].every((name) =>
  fs.readFileSync(path.join(sourceDir, name), 'utf8').startsWith('//')
  && fs.readFileSync(path.join(sourceDir, name), 'utf8').includes("'use strict';")));
check('bootstrap is the final script', html.lastIndexOf('<script') === html.indexOf('<script src="choreo-bootstrap.js">'));
check('controller remains non-module', !/type=["']module["']/.test(html));
// P3：注册 choreo-props-ui.js 后外壳约 5.3KB——预算 5KB→6KB；防内联回流由上面的 no-inline 两条专门把关
check('HTML is a small shell', Buffer.byteLength(html) < 6 * 1024);
check('CSS owns original root variables', css.startsWith('/* 编舞助手主页样式') && css.includes(':root{'));
check('controller owns original store', app.startsWith('// 编舞助手主页控制器') && app.includes("'use strict';") && app.includes('var store={'));
check('core no longer starts before features', !/\binit\(\);\s*$/.test(app));
check('bootstrap starts app after features', bootstrap.startsWith('// 主页启动入口') && /\binit\(\);\s*$/.test(bootstrap));
check('every split classic script is strict', uiScripts.concat('choreo-bootstrap.js').every((name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').includes("'use strict';")));

for (const name of productFiles) {
  const source = fs.readFileSync(path.join(sourceDir, name));
  const deployed = fs.readFileSync(path.join(distDir, name));
  check(name + ' source/dist twin', source.equals(deployed));
  check(name + ' exists in release whitelist', new RegExp("['\"]" + name.replace('.', '\\.') + "['\"]").test(packer));
}

// ARCH-2：客户端进包，测试/诊断文件绝不进包（test-api.js 只在 web/ 供 node 跑）
check('test-api.js stays out of the release inventory', !packer.includes('test-api.js'));

// M2-START-FORMATION F1：起始入口不用 .dh-sm——clip-check 用 '#lanes .dancer-grp .dh-sm' 下标选 S/M（[S0,M0,S1,M1]），共用会错位。
check('start entry does not reuse .dh-sm', !appAll.includes('dh-sm start-entry') && !appAll.includes('start-entry dh-sm') && appAll.includes("'start-entry'"));
check('start entry has independent styling', css.includes('.start-entry{') && css.includes('.start-entry.on'));

// M2-STAGE-DRAG：2D 舞台拖拽入口与面板骨架（红基线：实现前缺失即失败）
const stageUi = fs.readFileSync(path.join(sourceDir, 'choreo-stage-ui.js'), 'utf8');
const editSrc = fs.readFileSync(path.join(sourceDir, 'choreo-edit.js'), 'utf8');
// OVERHAUL 批 C 第六步迁移：stageBtn/openStage 随 RENDER 外壳（buildAdvancedToolsPage/renderToolbar）
// 搬到 choreo-app-render.js——不变量随代码走，改读 appAll（产品源族整体持有该入口契约）。
check('stage open entry exists in toolbar', appAll.includes('stageBtn') && appAll.includes('openStage'));
check('stage UI exposes openStage/closeStage', stageUi.includes('openStage') && stageUi.includes('closeStage') && stageUi.includes('stageDragModal'));
check('stage markers use placementFor single source', stageUi.includes('placementFor') && editSrc.includes('computeStageTransform'));
check('stage CSS owns markers/ghost/focus', css.includes('.stage-marker') && css.includes('.stage-ghost') && css.includes('.stage-modal :focus'));
check('stage UI makes zero game-control requests (no fetch/XHR)', !/fetch\s*\(|XMLHttpRequest/.test(stageUi));

// MUSIC-FOUNDATION（本地音乐节拍）：纯逻辑层先于控制器，面板晚于控制器、早于启动入口；双子一致；只走共享 api 客户端
check('music logic loads before controller', html.indexOf('<script src="choreo-music.js">') >= 0 && html.indexOf('<script src="choreo-music.js">') < html.indexOf('<script src="choreo-app.js">'));
check('music UI loads after controller before bootstrap', html.indexOf('<script src="choreo-music-ui.js">') > html.indexOf('<script src="choreo-app.js">') && html.indexOf('<script src="choreo-music-ui.js">') < html.indexOf('<script src="choreo-bootstrap.js">'));
check('ensemble audio loads before music bridge and ensemble app', html.indexOf('<script src="choreo-ensemble-audio.js">') >= 0 && html.indexOf('<script src="choreo-ensemble-audio.js">') < html.indexOf('<script src="choreo-music-ui.js">') && html.indexOf('<script src="choreo-music-ui.js">') < html.indexOf('<script src="choreo-ensemble-app.js">'));
for (const name of ['choreo-music.js', 'choreo-music-ui.js', 'choreo-music-timing.js']) {
  const src = fs.readFileSync(path.join(sourceDir, name));
  check(name + ' source/dist twin', src.equals(fs.readFileSync(path.join(distDir, name))));
  check(name + ' is strict classic', src.includes("'use strict';"));
}
check('music UI uses only the shared api client', !/fetch\s*\(|XMLHttpRequest/.test(fs.readFileSync(path.join(sourceDir, 'choreo-music-ui.js'), 'utf8')));
check('music timing loads before music logic', html.indexOf('<script src="choreo-music-timing.js">') >= 0 && html.indexOf('<script src="choreo-music-timing.js">') < html.indexOf('<script src="choreo-music.js">'));
check('music timing has no network/policy side channels', !/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|IndexedDB/.test(fs.readFileSync(path.join(sourceDir, 'choreo-music-timing.js'), 'utf8')));
check('music CSS owns panel/strip marks', css.includes('.music-panel') && css.includes('.music-strip') && css.includes('.mbeat') && css.includes('.music-wave'));
// HYGIENE-20260910 (TASK-20260910-CLEANUP-MOJIBAKE-DEBRIS): the music-panel CSS block keeps
// exactly one UTF-8 comment and zero GBK-mojibake duplicate lines (U+FFFD-free).
check('music CSS has no mojibake duplicate comment', css.indexOf('\ufffd') < 0 && (css.match(/\/\* [^*]*choreo-music-ui\.js[^*]*\*\//g) || []).length === 1);
// HYGIENE-20260910: the CMD quoting-accident debris file must stay deleted from the repo root.
check('root debris file stays deleted', !fs.existsSync(path.join(root, "' + $out + '")));

// P1-A 新增模块：源=dist 孪生与严格经典脚本、加载缺口先由本测试把关；发布白名单登记
// （scripts/make-release-staging.js）不在 P1-A 写域，留到发布批补登后再移入 uiScripts/productFiles。
{
  const wb = fs.readFileSync(path.join(sourceDir, 'choreo-workbench.js'));
  check('choreo-workbench.js source/dist twin', wb.equals(fs.readFileSync(path.join(distDir, 'choreo-workbench.js'))));
  check('choreo-workbench.js is strict classic', wb.includes("'use strict';"));
  check('choreo-workbench.js loads after controller and props-ui, before bootstrap',
    html.indexOf('<script src="choreo-workbench.js">') >= 0
    && html.indexOf('choreo-app.js') < html.indexOf('choreo-workbench.js')
    && html.indexOf('choreo-props-ui.js') < html.indexOf('choreo-workbench.js')
    && html.indexOf('choreo-workbench.js') < html.indexOf('choreo-bootstrap.js'));
}

const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (m) => m[1]);
check('all shell resources exist in dist', refs.every((ref) => fs.existsSync(path.join(distDir, ref))));

console.log('\nShell: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
