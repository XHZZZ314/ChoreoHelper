# HANDOFF 2026-08-31 — FIX-I：库与 3D 鲁棒性（PREVIEW-1 / LIB-1 / LIB-2 / LIB-3）

> 工作包来源：`docs/AI-BACKLOG.md` 第 4 项（P2/P3 reliability）。本包只动 web 侧，未触碰 C#、发布 staging 与任何主人未提交的工作。

## 干了什么（一句版）

3D 面板「初始化进行中切档案」不再死面板（初始化代次令牌）；资料库的一次瞬时读写失败不再毒化整页会话（迁移 promise 可重试）；老版本产生的「空骨架指纹」档案按原文回填（自家备份不再被误判成篡改）；CHLB v2 的目录段纳入写库前 preflight（坏目录零写入、段级中文报错）。

## 复现与机制（修复前均已确认为真）

1. **PREVIEW-1（过期异步初始化）**：`preview3d.init()` 挂在慢请求上时再触发一次 `hardReset()+init()`（真实入口：面板就绪后下拉才有档案可选，所以竞态发生在第二次切档案），旧 `init` 不被作废：新 `init()` 被 `initing` 拒绝，旧 `init` 在被清空的模块状态上崩溃，`finally` 还把 `inited=true` 写上——面板永久死在「初始化失败：Cannot read properties of null (reading 'bones')」，离线时 10s 探针也救不回（探针被 503 关掉后验证过，无任何自愈路径）。
2. **LIB-1（永久缓存的拒绝）**：`_profEnsured`/`_clipsMigrated` 缓存 promise 后，一次瞬时 IndexedDB/配额失败会让 `clipIndex()/putClip()/stats()/exportBundle()` 等所有入口拒绝到页面关闭为止（`useDb/useBackend` 之外没有任何清缓存路径）。
3. **LIB-2（遗留空指纹）**：老库 `meta.skeleton` 记录没有 `hash` 字段时，迁移建档写入 `skeletonHash:''`；`preflightV2` 用 `!h || h !== bp.skeletonHash` 判定 → 本程序自己导出的备份被拒：「骨架指纹与内容对不上（备份可能被篡改）」。
4. **LIB-3（目录在 preflight 外）**：v2 导入链里目录段在「档案+动作都已写库之后」才 `JSON.parse`，坏目录炸掉整个链且报错误导；若备份骨架与本机不同指纹，档案已经写进去了（部分写入实测复现）。

## 修复（最小根因，全部在 web 侧）

- `web/preview3d.js`：新增模块态 `_initGen`。`hardReset()` 自增它并置 `initing=false`（放行紧随其后的 `init()`）；`init()` 开头捕获代次，**每个 `await` 之后**（含 `loadModel(gen)`/`loadModelFromProfile(pid,gen)`/`cacheModelToProfile(...,gen)` 内部）检查 `gen!==_initGen` 即静默退出；`catch/finally` 只在当代分支才允许写状态栏/`initing/inited`。过期代次不写任何模块状态。
- `web/choreo-library.js`：
  - LIB-1：两个迁移 promise 挂 `catch`，失败时清缓存（`if (_x === p) _x = null`），下次访问重试；迁移本身逐条原子事务、幂等。
  - LIB-2：迁移建档时旧记录无 hash 就按骨架原文现算；`loadProfiles()` 对存量「有原文、无指纹」档案回填并原子落库；`preflightV2` 改为**只在录了非空指纹且对不上时**才判篡改（无指纹按原文放行，导入时按内容建真指纹）。
  - LIB-3：`preflightV2` 末尾对 catalog 段做 `JSON.parse` + 形状检查（须为含 `emotes` 数组的对象），报「目录数据损坏（备份里的目录段不是有效 JSON）/目录数据结构不对（缺 emotes 表情清单）」，坏包在**任何写库之前**整体拒绝。

## 回归（全部先红后绿，断言未放松）

- `web/test-library.js` 新增三节（71 → **91** 项）：
  - 十五 LIB-1：瞬时故障后端（同会话、不重置后端）下迁移失败如实报错，故障恢复后重试成功、旧仓搬空；档案迁移同理（迁出「默认角色」）。
  - 十六 LIB-2：迁移建档回填 / 存量空指纹读取回填并落库 / 头里无指纹的老备份导入成功 / 非空指纹对不上仍拒绝且零写入。
  - 十七 LIB-3：catalog 段非 JSON → 整体拒绝且报「目录」、原库动作与档案零写入（种子用异骨架，档案数变化才能抓到部分写入）；缺 emotes → 拒绝；健康包不受影响。
- `scripts/offline-verify.js` 新增 `initrace` 场景（7 项）：CDP 把部署位 `model.gltf` 延迟 1100ms 挂住 init#2，窗口内经真实档案下拉再切回（`/export/list` 回 503 关掉 10s 探针以防"探针救活"掩盖竞态；`Page.addScriptToEvaluateOnNewDocument` 注入 model.gltf 计数器，跨重载无时序依赖）。修复前 4 项红（面板死于「初始化失败：…null…bones」），修复后 7/7 绿。

## 验证（本包实际执行）

- Node：engine 40、edit 93、check 73、projects 96、**library 91**、shell 33 —— 全绿。
- `offline-verify all`：**40/42**。两个失败为 CONTINUITY 已归档的 SEC-1 harness 遗留（[online]/[transition] 真模型等待，harness 未注入配对码），与本包无关、先于本包存在。
- `library-verify all`：**116/117**。唯一失败同为已归档 SEC-1 遗留（[rec] 自选清单按钮禁选）。档案/备份/迁移/项目场景全过。
- `clipcheck-run.js`：**119/119** 游戏根（默认）+ **119/119** 源-dist（显式指定），均为同步后新文件。
- C# 无改动 → 按 `AI-TEST-MATRIX.md` 无需 datalayertest/构建。

## 部署同步

`web/choreo-library.js`、`web/preview3d.js`（本包仅有的两个产品文件改动）已同步三个根，md5 四方一致（web/ 与 web/dist/ChoreoHelper/ 与 devPlugins 根与游戏根）；`diff -rq` 三根递归**零差异**。release staging 未触碰。

## 遗留与边界

- 两个 SEC-1 harness 遗留失败仍开放（修复方向记录在 `AI-BACKLOG.md` HYGIENE，等主人决定 pairing 语义），断言均未放松。
- `loadModelFromLib`（无档案老路径）内部未加代次检查：它仅在 `profile=null` 时可达且只读资料库，写状态由调用方的代次检查兜住。
- `cacheModelToProfile` 的 fire-and-forget model.bin 补写链未逐个查代次：内容 hash 去重使重复写入幂等，且写的是"旧代次本来就想写的内容"，无错误状态可污染。
- 下一个包：**WEB-RACE**（WEB-1 宏防抖跨舞者 / WEB-2 过期 seek 重试 / WEB-3 拖动中实时体检重绘 / WEB-4 实测时长不推快照 / WEB-5 空白区点击不 seek 游戏）。

## 追加（同日晚间）：SEC-1 harness 遗留清零 + 连带挖出一个真产品 bug

主人问询 SEC-1 遗留的决策点（「已连接」判定口径），AI 按推荐方案 A 执行（**产品口径保持不变**：未配对=显示未连接，403 已有指路配对 toast；只修验收脚本。如主人想改两段式口径——匿名 /capabilities 判「插件在跑」+ 配对状态单独显示——随时可另开小包）。

### 脚本侧修复（产品语义不动）

- `scripts/offline-verify.js`：[online]/[transition] 打真插件但从不注配对码 → 私有读 403 → 3D 面板永远停在替身。现在从本机 `%APPDATA%\XIVLauncherCN\pluginConfigs\ChoreoHelper\pairing.json`（首次生成后永久不变）读真码，经 `Page.addScriptToEvaluateOnNewDocument` 在**任何页面脚本之前**种进 localStorage（每次新文档自动重种，跨 reload 有效）。配对码只进本机临时浏览器配置，不写入任何日志/文档。
- `scripts/library-verify.js`：[rec] 种码后 `savePairToken` 里的立即重探被 `choreoTokenHeaders` 的 capsOk 门槛吃掉 token（握手未完成）→ 403 → `exportConnected` 要等 15s 连接监视器才翻转 → 四个录制模式按钮全禁用、合成点击被吞。现在 capsOk 之后补探一次并等 `exportConnected=true` 再开弹窗。

### 连带挖出的产品 bug（空壳档案劫持升级，已修）

种上配对码后 [transition] 仍卡替身，诊断出根因：离线→在线升级场景里，`syncLibrary` 补拉到动作后 `putClip → activePidOrNew()` 会先建一个**无骨架**的「默认角色」档案并自动占上活动指针；随后 3D 升级 init 拿到线上骨架做档案对号时，`listProfiles()` 非空且哈希全对不上 → 走 FIX-D 的「换角色不乱套」分支 → 面板被钉死在替身，`profMismatch` 指向一个根本没有身体的档案。修复（`web/preview3d.js` 对号分支）：**只有存在真带骨架内容的档案时**才判"另一副身体"；全是空壳时照旧用游戏骨架建真档案，并在活动指针被空壳占住时切过去。真实换种族场景（档案带骨架、对不上）行为不变。

该 bug 早于本包存在（putClip/activePidOrNew 旧代码），此前被 403 掩盖。[transition] 场景即其回归（红→绿）。

### 追加验证

- `offline-verify online` 5/5、`offline-verify transition` 3/3、`library-verify rec` 28/28（均曾红）。
- preview3d 改动已同步三个部署根（四方 md5 一致）。
