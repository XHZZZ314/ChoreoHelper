// make-release-staging.js — WP-2 公开发布 staging（可重复打包，白名单 + 隐私扫描 + 校验值）
//
// 干嘛的：从本仓库产出"可以直接给别的玩家"的干净安装包。铁律（WORKPLAN-20260829 WP-2 + FIX-K）：
//   1) 公开包强制替身模型：部署位里的主人真模型（model.gltf+model.bin，Meddle 导出）绝不进包；
//      包里的 model.gltf 必须就是 web\model-standin.gltf（脚本逐字节核对）
//   2) 目录/骨架快照必须现场从游戏重新生成（跑 make-offline-assets.js）——公开包快照只认
//      生成过程，不拷部署位现成文件；所以打包时要开着游戏
//   3) 只从白名单复制；诊断页（mode-check/clip-check/library-check/jscheck/p3d-check/p3d-trace/
//      test-engine）和一切私人数据（clips/pairing/日志/本机路径）进不了包；
//      libs 目录按显式清单逐文件复制，清单外文件直接拒绝（不再整目录盲拷）
//   4) 隐私扫描在全部写入完成之后执行（含 README/manifest）：所有文件一律按二进制（latin1）
//      扫，模式大小写不敏感、正反斜杠等价，并覆盖本机检出根路径；README.txt 的安装说明
//      术语（%AppData%\XIVLauncherCN\devPlugins 等）按文档化豁免，其余文件出现即失败。
//      DLL 的构建机路径由 csproj 的 Release PathMap 从源头映射掉（/build/...），
//      这里再字节级把关——两道门。
//   5) zip 解包后与 staged 目录逐文件 sha256 核对 + 同标准重扫（zip 是压缩流，扫 zip
//      字节不可靠，必须解包验）。
//   6) manifest 记录完整来源身份：git HEAD 只是基线，脏树（本仓库常态）时发布内容以
//      files/zips 逐文件 sha256 与 sourceDigest 为准，绝不声称 HEAD 单独标识内容。
//   7) 未经主人明确授权不创建远程、不发布——本脚本只在本机 release\staging\ 产出文件
//
// 前提：游戏开着（第 2 条）；Release 已编译（src\bin\x64\Release\net10.0-windows\ChoreoHelper.dll）；
//       本机已配对（%APPDATA%\XIVLauncherCN\pluginConfigs\ChoreoHelper\pairing.json，SEC-1 后
//       48795 私有读要配对码，码只进本机进程，不进命令行/日志/包）
// 用法：D:\nodejs\node.exe scripts\make-release-staging.js
// 产出：release\staging\
//   ChoreoHelper-web-<版本>\       网站文件（GitHub Pages 或本地 file:// 双击用）
//   ChoreoHelper-web-<版本>.zip
//   ChoreoHelper\                  插件安装目录（整个文件夹丢进 devPlugins 即可，含 dist 网页）
//   ChoreoHelper-plugin-<版本>.zip （= 上面 ChoreoHelper\ 文件夹的 zip）
//   MANIFEST.json + SHA256SUMS.txt + README.txt

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gates = require('./release-gates.js');
const fail = gates.fail;

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
const STAGING = path.join(ROOT, 'release', 'staging');
const RELEASE_DLL = path.join(ROOT, 'src', 'bin', 'x64', 'Release', 'net10.0-windows', 'ChoreoHelper.dll');

// 网站白名单：产品文件逐一列名，不在名单里的一律不进包（新文件要进包在这里加）
const WEB_FILES = [
  'choreo-helper-app.html',
  'choreo-helper-app.css', // ARCH-1：主页样式（从 HTML 内联块机械拆出，file:// 相对加载）
  'choreo-api.js',         // ARCH-2：48794/48795 配对本地 API 客户端（超时/配对/取消/错误映射唯一出口）
  'choreo-render-perf.js', // P5：统一渲染时钟 + 时间轴窗口化纯模块（控制器之前加载）
  // OVERHAUL 批 C：choreo-app 拆分件（配对/会话凭据薄壳、编辑事务层），随应用发布
  'choreo-app-auth.js',
  'choreo-app-edit-tx.js',
  'choreo-app-timeline.js', // OVERHAUL 批 C 第五步：时间轴渲染分件（主件之前加载）
  'choreo-app-render.js',  // OVERHAUL 批 C 第六步：RENDER 外壳分件（主件之前加载）
  'choreo-app-catalog.js', // OVERHAUL 批 C 第七步：连接探测/目录/自动同步分件（主件之前加载）
  'choreo-app-dancers.js', // OVERHAUL 批 C 第七步：舞者管理与编辑操作分件（主件之前加载）
  'choreo-app.js',         // ARCH-1：主页核心 DOM/时间轴控制器（经典脚本，保持全局兼容）
  'choreo-app-playback.js', // OVERHAUL 批 C 第五步：播放控制分件（主件之后加载，updatePlayhead 生效版所在）
  'choreo-props-ui.js',    // P3：右侧属性面板纯视图模块（校验复用 ChoreoClipTime.plan）
  'choreo-stage-motion.js',
  'choreo-stage-motion-ui.js',
  'choreo-stage-ui.js',    // M2-START-FORMATION：起始站位 DOM 适配层（经典脚本，随应用发布）
  'choreo-stage-game-plan.js', // 舞台演出游戏计划纯模块（app.html 引用；曾漏录致公开包 404，随引用完整性断言补录）
  'choreo-stage-game-ui.js',   // 舞台演出游戏面 DOM 适配层（同上）
  'choreo-library-ui.js',  // ARCH-1：资料库界面适配层
  'choreo-xat-convert-ui.js', // TASK-20260917-PLUGIN-XAT-INVOCATION：资料库内游戏动作转换节（app.html 引用，漏录会 404）
  'choreo-check-ui.js',    // ARCH-1：体检界面适配层
  'choreo-project-ui.js',  // ARCH-1：项目中心界面适配层
  'choreo-recording-ui.js',// ARCH-1：录制与高级工具界面适配层
  'choreo-lyrics-ui.js',   // ARCH-1：歌词界面适配层
  'choreo-show-ui.js',     // EXEC-CORE：演出执行面板（编译→装载→就绪→开始/紧急停止）
  'choreo-cmdk-ui.js',     // P4：Ctrl+K 命令面板纯视图模块（注册表由控制器打开时注入）
  'choreo-bootstrap.js',   // ARCH-1：快捷键与启动入口（必须最后加载）
  'choreo-library.js',
  'choreo-projects.js',   // WP-3：项目存储层（多项目/自动保存/迁移）
  'choreo-document.js',   // WP-5-DOC：规范演出文档纯模块（schema/迁移/确定性序列化）
  'choreo-docwire.js',    // WP-5-WIRE：持久化接线层（装载投影/保存文档/导入导出；HTML 按序加载）
  'choreo-stage-show.js', // 有界整场审阅，不包含私人数据。
  'choreo-stage-recovery.js', // 日常恢复与身份绑定结果保存。
  'choreo-stage-replay.js', // 演出结果复盘（只读消费已保存记录）。
  'choreo-stage-readiness.js', // 演前就绪检查页（只读汇总连接/角色/审阅/登记/校准/手动模式）。
  'choreo-show-entry.js', // 统一游戏演出入口与整场检查（只读摘要，路由进既有流程）。
  'choreo-show-owned.js', // 单机正式输入的定向场次身份。
  'choreo-x1-inputs.js', // 正式输入版本、明确身份与完整事件字段校验。
  'choreo-show-compiler.js', // EXEC-CORE：ShowCompiler（规范文档→演出包，纯模块；HTML 按序加载）
  'choreo-edit.js',       // WP-3b：时间轴编辑基础纯函数层（多选/插入删除时间/标记/静音等）
  'choreo-macro.js',
  'choreo-macro-ui.js',
  'choreo-meddle-material.js',
  'choreo-model-import.js',
  'choreo-gearset.js',
  'choreo-ability-read.js',
  'choreo-ability-plan.js',
  'choreo-skill-game.js',
  'choreo-skill-records.js',
  'choreo-skill-stages.js',
  'choreo-skill-motion.js',
  'choreo-skill-metadata.js',
  'choreo-skill-coverage.js',
  'choreo-skill-legality.js',
  'choreo-skill-timing-ui.js',
  'choreo-skill-import.js',
  'choreo-skill-motion-ui.js',
  'choreo-ability-plan-targets.js',
  'choreo-catalog.js',
  'choreo-ability-ui.js',
  'choreo-ability-preview.js',
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
  'choreo-check.js',      // WP-4：编舞体检规则引擎（红/黄/提示分级，node 可测）
  'preview3d.js',
  'preview3d-cam.js',   // OVERHAUL 批 B：preview3d 拆分件（视图层），html 引用必须进包
  'preview3d-cache.js', // OVERHAUL 批 B：preview3d 拆分件（模型缓存），html 引用必须进包
  'choreo-engine.js',
  'pose-viewer.html',
  'catalog-snapshot.js',
  'skeleton-snapshot.js',
  'skeleton-pack.js',   // DANCER-AUTOADAPT：离线 18 族基础骨架包（生成资产，游戏派生数据、无个人数据）
  'standin-model.js',
  // TASK-20260925-PROJECT-REMEDIATION §7 P0：部署页 html 引用（:88/:92/:93）此前漏录——
  // 不进包会 404（复制循环只对"列了但缺"的文件报错，不会发现"该列没列"的新必需文件）
  'choreo-workbench.js',
  'choreo-anim-pack-retarget.js',
  'choreo-anim-pack-import.js',
];
// FIX-K：three 库从整目录拷贝改为显式清单——误投进 libs 的文件会被 inventoryDiff 拒绝，
// 不再默默随包发出。新库文件要进包，在这里逐个登记（经人审后）。
const LIB_FILES = [
  'libs/three.module.js',
  'libs/loaders/GLTFLoader.js',
  'libs/utils/BufferGeometryUtils.js',
  'libs/utils/SkeletonUtils.js',
  'libs-classic/three.classic.js',
  'libs-classic/GLTFLoader.classic.js',
  'libs-classic/BufferGeometryUtils.classic.js',
  'libs-classic/SkeletonUtils.classic.js',
];

// SEC-1：读本机插件配对码（与 make-offline-assets.js / offline-verify.js 同一来源与口径）
function readPairingCode() {
  try {
    const p = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).code || '';
  } catch (e) { return ''; }
}
function copyFile(src, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }

(async function main() {
  // 0) 版本号来源：plugin.json（对外口径）与 csproj（程序集）必须一致
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'plugin.json'), 'utf8'));
  const ver = manifest.Version;
  if (!ver) fail('plugin.json 缺 Version 字段');
  const csproj = fs.readFileSync(path.join(ROOT, 'src', 'ChoreoHelper.csproj'), 'utf8');
  const asmVer = (csproj.match(/<Version>([\d.]+)<\/Version>/) || [])[1];
  if (asmVer !== ver + '.0') fail('版本不一致：plugin.json=' + ver + ' csproj=' + asmVer + '（先统一再打包）');

  // 1) 快照现场生成（审计口径：不拷部署位现成文件）。游戏没开/没配对直接失败。
  const pairCode = readPairingCode();
  if (!pairCode) fail('读本机 pairing.json 失败（%APPDATA%\\XIVLauncherCN\\pluginConfigs\\ChoreoHelper）'
    + '——SEC-1 后打包探针要配对码，先在游戏里 /choreo pair 配对一次');
  const probe = spawnSync(process.execPath, ['-e',
    'fetch("http://localhost:48795/export/list",{headers:{"X-Choreo-Token":process.env.CHOREO_PAIR},'
    + 'signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'],
    { stdio: 'ignore', env: Object.assign({}, process.env, { CHOREO_PAIR: pairCode }) });
  if (probe.status !== 0) fail('插件（48795）不在线或配对码无效——目录/骨架快照必须开着游戏现场生成（铁律），请先开游戏再打包');
  console.log('重新生成目录/骨架/替身快照（make-offline-assets.js）…');
  const gen = spawnSync(process.execPath, [path.join(__dirname, 'make-offline-assets.js')], { stdio: 'inherit' });
  if (gen.status !== 0) fail('快照生成失败（见上）');

  // 2) 清空 staging
  fs.rmSync(STAGING, { recursive: true, force: true });
  const webDir = path.join(STAGING, 'ChoreoHelper-web-' + ver);
  const pluginDir = path.join(STAGING, 'ChoreoHelper');

  // 3a) 网站包：白名单逐文件复制 + libs 显式清单核对
  for (const f of WEB_FILES) copyFile(path.join(DIST, f), path.join(webDir, f));
  const actualLibs = gates.walk(DIST).filter(function (r) { return r.indexOf('libs/') === 0 || r.indexOf('libs-classic/') === 0; });
  const inv = gates.inventoryDiff(actualLibs, LIB_FILES);
  if (inv.unexpected.length) fail('libs 目录出现清单外文件（拒绝盲拷，人工确认后加进 LIB_FILES）：\n  ' + inv.unexpected.join('\n  '));
  if (inv.missing.length) fail('libs 清单文件缺失（先重跑 make-classic-libs.js / 补齐源文件）：\n  ' + inv.missing.join('\n  '));
  for (const rel of LIB_FILES) copyFile(path.join(DIST, rel), path.join(webDir, rel));

  // 3b) 替身换装：包里的 model.gltf 必须就是替身源文件（逐字节一致），并且不带 model.bin
  const standinRaw = fs.readFileSync(path.join(ROOT, 'web', 'model-standin.gltf'), 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(path.join(webDir, 'model.gltf'), standinRaw, 'utf8');

  // 4) 插件包：DLL + manifest + dist（同一份白名单网站文件）
  if (!fs.existsSync(RELEASE_DLL)) fail('Release DLL 不存在：' + RELEASE_DLL + '（先编译 -c Release）');
  copyFile(RELEASE_DLL, path.join(pluginDir, 'ChoreoHelper.dll'));
  copyFile(path.join(ROOT, 'src', 'plugin.json'), path.join(pluginDir, 'ChoreoHelper.json'));
  fs.mkdirSync(path.join(pluginDir, 'dist', 'ChoreoHelper'), { recursive: true });
  fs.cpSync(webDir, path.join(pluginDir, 'dist', 'ChoreoHelper'), { recursive: true });
  // 插件目录也放一份替身（FindWebRoot 服务的就是 dist\ChoreoHelper，model.gltf 已在其中）

  // 4b) XAT 工具目录公开门禁（TASK-20260917-SIMPLE-CHOREO-XAT-BUNDLE）：
  //     公开包是否携带 tools/xat 由唯一"分发授权开关"决定（web/dist/ChoreoHelper/tools/xat/
  //     distribution-authorization.json 的 status；属主取得授权证据后翻转数据文件即可，打包代码不动）。
  //     unauthorized：显式拒绝 tools/ 子目录进入公开包（白名单本来就不复制它，这里是双保险断言，
  //     不放松任何既有公开校验）；authorized：整目录复制 + exe 钉死哈希核验（翻转零返工）。
  const xatState = gates.readXatAuthorization(DIST);
  if (xatState.status === 'authorized') {
    const xatDir = path.join(DIST, 'tools', 'xat');
    if (!fs.existsSync(xatDir)) fail('XAT 分发授权开关=authorized，但 tools/xat 目录不存在（先补齐包内容）');
    const xatFiles = gates.walk(xatDir);
    if (xatFiles.indexOf('XATHavokInterop.exe') < 0) fail('tools/xat 缺 XATHavokInterop.exe');
    if (xatFiles.indexOf('LICENSE-XAT.txt') < 0 || xatFiles.indexOf('COMPONENTS.txt') < 0)
      fail('tools/xat 缺许可文本或成分清单（BSD 告知与 SBOM 随包是 authorized 的硬条件）');
    if (gates.sha256(path.join(xatDir, 'XATHavokInterop.exe')) !== gates.XAT_PINNED_SHA256)
      fail('tools/xat 的 XATHavokInterop.exe 与钉死哈希不符（禁止替换字节后分发）');
    // 案 B 运行库随包（TASK-20260917-PLUGIN-XAT-INVOCATION）：两 DLL 在场且哈希=登记值是 authorized 的硬条件
    for (const dll of Object.keys(gates.XAT_PINNED_DLL_SHA256)) {
      if (xatFiles.indexOf(dll) < 0)
        fail('tools/xat 缺 VC++ 2012 x86 运行库 ' + dll + '（案 B 随包硬条件，见 VCREDIST-COMPONENTS.txt）');
      if (gates.sha256(path.join(xatDir, dll)) !== gates.XAT_PINNED_DLL_SHA256[dll])
        fail('tools/xat 的 ' + dll + ' 与登记哈希不符（禁止替换字节后分发）');
    }
    for (const rel of xatFiles) copyFile(path.join(xatDir, rel), path.join(webDir, 'tools', 'xat', rel));
    fs.cpSync(path.join(webDir, 'tools'), path.join(pluginDir, 'dist', 'ChoreoHelper', 'tools'), { recursive: true });
    console.log('XAT 分发授权开关=authorized：tools/xat 已随包（' + xatFiles.length + ' 个文件，exe 钉死哈希已核验）');
  }
  for (const tree of [webDir, pluginDir]) {
    const toolsHits = gates.xatToolsHits(gates.walk(tree));
    if (xatState.status !== 'authorized' && toolsHits.length)
      fail('XAT 分发授权开关=' + xatState.status + '（未授权）：tools/ 子目录不得进入公开包：\n  ' + toolsHits.join('\n  '));
  }

  // 5) README（先写后扫：README 是包内容，必须和其余文件一起过隐私门）
  const readme = [
    'ChoreoHelper v' + ver + ' — FF14 国服演出编排助手',
    '',
    '【这是什么】',
    '本地演出编排工具：在网页里编排动作时间轴、用 3D 角色排练；需要时连上游戏插件，让游戏角色按时间轴表演。',
    '所有数据（动作库、模型、编舞草稿）只存在你自己的电脑里，没有账号、不上传云端。',
    '',
    '【两个包】',
    '1. ChoreoHelper-web-' + ver + '.zip —— 网页（必装）',
    '   解压到任意文件夹，双击 choreo-helper-app.html 就能用（网页 3D 模式无需游戏）。',
    '   以后正式网站上线后，直接访问网站即可，不需要本地文件。',
    '2. ChoreoHelper-plugin-<版本>.zip —— 游戏插件（可选：游戏内预览/录制才需要）',
    '   前提：FF14 国服 + 橙月启动器（XIVLauncherCN）+ 已装 Dalamud。',
    '   安装：解压后把 ChoreoHelper 整个文件夹放进 %AppData%\\XIVLauncherCN\\devPlugins\\，',
    '   然后游戏内 /xlsettings → 实验性 → 打开 DevMode 并在 Dev Plugin Locations 里登记',
    '   （指向 ChoreoHelper\\ChoreoHelper.dll），重启游戏，/xlplugins 里启用。',
    '',
    '【首次初始化】',
    '1. 打开网页：双击插件目录 dist\\ChoreoHelper\\choreo-helper-app.html（无需开游戏也能用）',
    '   → 动作目录、参考骨架、动作库自动录入浏览器本地资料库（约半分钟）。',
    '2. 3D 模型默认是内置替身（方块人）。想要自己角色的真模型：用 Meddle 插件导出 glTF，',
    '   把导出的 model.gltf（+model.bin）放进插件目录的 dist\\ChoreoHelper\\ 下，刷新网页即用；',
    '   在线打开过网页后真模型会自动缓存进本地资料库，之后关游戏也能用。',
    '3. 网页控制游戏前要配对（防止别的网页偷偷控制你的角色）。',
    '   游戏里输入 /choreo pair 查看配对码，到网页顶栏「🧰 工具」→「高级工具」→「🔗 网页配对」粘贴一次即可；不连游戏的编排与 3D 排练无需配对。',
    '',
    '【提示】',
    '- 找不到网页/打不开：网页入口就是插件目录 dist\\ChoreoHelper\\choreo-helper-app.html，双击打开；只复制 DLL 的安装会缺网页文件，请重新完整解压。',
    '- 录制新动作：网页「⏺ 录制 3D 动作库」，按提示在游戏里等待即可。',
    '- 资料库备份：工具栏「📦 资料库」→ 导出备份（换浏览器/换电脑用）。',
    '- 问题反馈与更新：见发布页（正式发布后填写）。',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(webDir, 'README.txt'), readme, 'utf8');
  fs.writeFileSync(path.join(STAGING, 'README.txt'), readme, 'utf8');
  // 插件树不塞 README（保持与 devPlugins 布局一致），安装说明看 staging 根或网站包

  // 6) 打 zip（PowerShell Compress-Archive；内部条目全 ASCII 名，中文在内容里没问题）
  function zipOf(dir, zipName) {
    const zip = path.join(STAGING, zipName);
    if (fs.existsSync(zip)) fs.rmSync(zip);
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      'Compress-Archive -Path "' + dir + '" -DestinationPath "' + zip + '" -Force'], { stdio: 'ignore' });
    if (r.status !== 0 || !fs.existsSync(zip)) fail('zip 失败：' + zipName);
    return zip;
  }
  const webZip = zipOf(webDir, 'ChoreoHelper-web-' + ver + '.zip');
  const pluginZip = zipOf(pluginDir, 'ChoreoHelper-plugin-' + ver + '.zip');

  // 7) MANIFEST + SHA256SUMS（FIX-K：完整来源身份。脏树时 HEAD 只是基线，
  //    发布内容以逐文件 sha256 与 sourceDigest 为准；禁止发布页声称 HEAD 单独标识内容）
  let gitHead = '', dirtyEntries = 0;
  try {
    gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim();
    dirtyEntries = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT }).stdout.toString()
      .split('\n').filter(function (l) { return l.trim().length > 0; }).length;
  } catch (e) { }
  const files = {};
  for (const rel of gates.walk(webDir)) files['ChoreoHelper-web-' + ver + '/' + rel] = gates.sha256(path.join(webDir, rel));
  for (const rel of gates.walk(pluginDir)) files['ChoreoHelper/' + rel] = gates.sha256(path.join(pluginDir, rel));
  // 公开门禁第二道断言（TASK-20260917）：未授权状态下，公开包任何文件不得等于钉死 XAT 字节
  //（防改名混入；复用上方逐文件 sha256，不额外读盘）。
  const xatByte = gates.xatByteHits(files);
  if (xatState.status !== 'authorized' && xatByte.length)
    fail('公开包内发现钉死 XAT 字节（疑似改名混入）：' + xatByte.join(', '));
  const sourceDigest = gates.sha256Text(Object.keys(files).sort().map(function (f) { return f + '  ' + files[f]; }).join('\n'));
  const outManifest = {
    name: manifest.Name,
    version: ver,
    protocolVersion: 1,
    dalamudApiLevel: manifest.DalamudApiLevel,
    gitCommit: gitHead,
    sourceIdentity: {
      gitHead: gitHead,
      workingTree: dirtyEntries > 0 ? 'dirty（' + dirtyEntries + ' 项未提交改动）' : 'clean',
      note: dirtyEntries > 0
        ? '工作树含未提交改动：gitCommit 仅是基线，不标识本包内容；内容以 files/zips 的逐文件 sha256 与 sourceDigest 为准'
        : '工作树干净：gitCommit 即本包内容基线',
    },
    sourceDigest: sourceDigest,
    builtAt: new Date().toISOString(),
    xatDistribution: {
      switchStatus: xatState.status,
      switchPresent: xatState.present,
      bundled: xatState.status === 'authorized',
      note: xatState.status === 'authorized'
        ? 'tools/xat 已随包（分发授权开关=authorized；exe 钉死哈希与 VC++ 2012 x86 两 DLL 登记哈希已核验）'
        : 'tools/xat 未随包（分发授权开关=' + xatState.status + '，公开包拒绝该子目录与钉死字节）',
    },
    model: 'standin-only（公开包不带个人模型；model.gltf == web/model-standin.gltf）',
    snapshots: 'generated-from-live-game（make-offline-assets.js，打包时现场生成）',
    files: files,
    zips: {
      web: { file: path.basename(webZip), sha256: gates.sha256(webZip), bytes: fs.statSync(webZip).size },
      plugin: { file: path.basename(pluginZip), sha256: gates.sha256(pluginZip), bytes: fs.statSync(pluginZip).size },
    },
  };
  fs.writeFileSync(path.join(STAGING, 'MANIFEST.json'), JSON.stringify(outManifest, null, 2), 'utf8');
  const sums = Object.entries(files).map(([f, h]) => h + '  ' + f).join('\n')
    + '\n' + gates.sha256(webZip) + '  ' + path.basename(webZip)
    + '\n' + gates.sha256(pluginZip) + '  ' + path.basename(pluginZip) + '\n';
  fs.writeFileSync(path.join(STAGING, 'SHA256SUMS.txt'), sums, 'utf8');

  // 8) FIX-K 隐私门：全部写入（含 README/manifest/zip）完成之后执行。
  //    所有文件按二进制 latin1 扫；模式大小写不敏感 + 正反斜杠等价 + 本机检出根路径；
  //    README 只豁免文档化安装术语；禁文件名单小写比较；替身逐字节核对（网站树+插件树）。
  const patterns = gates.buildPatterns(ROOT);
  let scannedTotal = 0, hitCount = 0;
  for (const tree of [webDir, pluginDir]) {
    const rels = gates.walk(tree);
    const bad = gates.forbiddenFileHits(rels);
    if (bad.length) fail('包里出现禁文件：' + bad.join(', '));
    const r = gates.scanTree(tree, patterns);
    scannedTotal += r.scanned;
    for (const h of r.hits) { hitCount++; console.error('  隐私扫描命中「' + h.pattern + '」：' + path.relative(STAGING, path.join(tree, h.file))); }
  }
  if (hitCount > 0) fail('隐私扫描命中 ' + hitCount + ' 处（见上）——本机路径/私人数据不得进公开包');
  for (const modelPath of [path.join(webDir, 'model.gltf'), path.join(pluginDir, 'dist', 'ChoreoHelper', 'model.gltf')]) {
    if (fs.readFileSync(modelPath, 'utf8') !== standinRaw) fail('包里的 model.gltf 不是替身源文件！（逐字节核对失败）' + modelPath);
  }

  // 9) zip 内容核对：解包 → 与 staged 目录逐文件 sha256 对比 → 解包内容同标准重扫
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-stage-verify-'));
  try {
    function unzipInto(zip, dest) {
      fs.mkdirSync(dest, { recursive: true });
      const r = spawnSync('powershell', ['-NoProfile', '-Command',
        'Expand-Archive -Path "' + zip + '" -DestinationPath "' + dest + '" -Force'], { stdio: 'ignore' });
      if (r.status !== 0) fail('zip 解包失败：' + zip);
    }
    unzipInto(webZip, path.join(verifyRoot, 'web'));
    unzipInto(pluginZip, path.join(verifyRoot, 'plugin'));
    const webExtract = path.join(verifyRoot, 'web', 'ChoreoHelper-web-' + ver);
    const pluginExtract = path.join(verifyRoot, 'plugin', 'ChoreoHelper');
    for (const pair of [[webDir, webExtract], [pluginDir, pluginExtract]]) {
      const d = gates.diffTreeFiles(pair[0], pair[1]);
      if (d.missing.length || d.unexpected.length || d.changed.length) {
        fail('zip 内容与 staged 目录不一致 missing=' + d.missing.length
          + ' unexpected=' + d.unexpected.length + ' changed=' + d.changed.length
          + '\n  ' + d.missing.concat(d.unexpected, d.changed).slice(0, 10).join('\n  '));
      }
      const rels = gates.walk(pair[1]);
      const bad = gates.forbiddenFileHits(rels);
      if (bad.length) fail('zip 内出现禁文件：' + bad.join(', '));
      const r = gates.scanTree(pair[1], patterns);
      scannedTotal += r.scanned;
      for (const h of r.hits) { hitCount++; console.error('  zip 内扫描命中「' + h.pattern + '」：' + h.file); }
    }
    if (hitCount > 0) fail('隐私扫描（含 zip 解包）命中 ' + hitCount + ' 处——终止打包');
  } finally {
    fs.rmSync(verifyRoot, { recursive: true, force: true });
  }

  console.log('隐私扫描通过：' + scannedTotal + ' 个文件（含 zip 解包重扫、DLL/PDB 路径门、README 文档化豁免）；'
    + 'model.gltf=替身源文件 ✓；无 model.bin ✓；无诊断/测试文件 ✓');
  console.log('来源身份：HEAD ' + (gitHead || '(未知)').slice(0, 12) + ' + ' + outManifest.sourceIdentity.workingTree
    + '；sourceDigest=' + sourceDigest.slice(0, 12) + '…');
  console.log('完成。staging 位置：' + STAGING);
  console.log('  网站 zip：' + path.basename(webZip) + '（' + (fs.statSync(webZip).size / 1048576).toFixed(1) + 'MB）');
  console.log('  插件 zip：' + path.basename(pluginZip) + '（' + (fs.statSync(pluginZip).size / 1048576).toFixed(1) + 'MB）');
  console.log('  MANIFEST.json / SHA256SUMS.txt / README.txt 已生成');
  console.log('注意：只在本机 staging，未创建远程、未发布（发布需主人明确授权）');
})().catch(function (e) { fail(e && e.stack || e); });