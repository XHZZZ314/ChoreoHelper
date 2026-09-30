# HANDOFF 2026-08-31 — ACTOR：游戏预览舞者（单角色契约）

> 状态：CLOSED（代码/测试/部署根全部落地；**主人实机多舞者验收通过 2026-08-31 当天**，SPEC §1 对应项已勾）。
> 本包未提交、未推送、未发布；工作树里主人此前的未提交内容全部原样保留。

## 问题与根因

- 网页 `buildGameClips` 把所有未静音舞者（`actorId=下标`）全部装进 `/playback/start` 与
  `/playback/timeline` payload；插件 `PlaybackManager.ExecuteClip` 不分 `ActorId` 把所有事件
  执行在同一个本地角色上。复现（node 直跑纯函数）：双舞者动作重叠（[0,4) vs [2,6)）时
  payload 同时含 actorId 0 与 1。
- seek 侧 `SeekPlanner` 按演员分组后本地显示取「Start 最晚/平手 ActorId 大」，混包时本地定格
  可能不是用户想看的舞者（datalayertest 已锁该旧行为成因）。

## 修复（最小根因）

**网页（发端过滤，网页多舞者排练口径不变）**

- `web/choreo-edit.js` `buildGameClips(dancers, globalLyrics, isMutedFn, previewActor)`：给了
  `previewActor`（下标）就只发这一位；显式选择优先于独奏/静音（那是网页排练口径）；越界下标
  = 只剩全局歌词（不静默换成别人）。不传参保持全量口径（clip-check 等检查方不受影响）。
- `web/choreo-app.js`：
  - `store.gameActor`（localStorage `choreo_gameActor`，默认 0）+ `gameActorIdx()` 解析
    （越界兜 0）+ `buildGamePayloadClips()`；`gameStartPlay`/`pushGameTimeline` 只发预览舞者；
    `gameStartPlay` 对「预览舞者名下没有条目」给中文指路 toast（不发空包）。
  - UI 可见性：游戏模式每个舞者行头「🎮 预览」徽标（选中高亮，点击换人）；底栏「预览舞者」
    常驻显示；播放按钮悬停提示与模式切换 toast 带舞者名。换人（`setGameActor`）在游戏模式、
    未播放时立即 `pushGameTimeline(true)`+`sendSeek`，游戏里马上看到换了谁。
  - `setDancerCount` 收拢 `gameActor`；读取侧 `gameActorIdx` 兜底。
- 兼容性：payload 字段不变（仍带 actorId），新旧网页×新旧插件不存在需要门控的协议分叉；
  唯一行为收紧在插件侧（下条），旧网页混包会得到 400+指路文案，属诚实失败。

**插件（收端拒绝，双保险：stale 混包永远不再静默混合）**

- 新增纯策略 `src/PreviewActorPolicy.cs`：`Validate(IEnumerable<int> actorIds)`——所有
  `ActorId>=0` 的条目必须同属一位舞者，`-1`（全局歌词）不参与，空/纯全局合法；违规返回中文
  错误（点名游戏预览舞者+指路）。签名用 int 序列是为了进 datalayertest（PlaybackManager.cs
  不链接进测试工程）。
- `src/HttpServer.cs` `ParsePlaybackClips` 末尾统一调用：`/playback/start` 与
  `/playback/timeline` 共用此解析口，违规 400 `{"error":"multi-actor timeline"}`。
- seek 侧不改 `SeekPlanner`：payload 只剩一位舞者后，本地定格必是预览舞者；`SeekPlan.cs`
  保持按演员分组的未来多演员语义（EXEC-CORE 显式映射后再放开插件侧限制）。

## 回归测试（先红后绿）

- `web/test-edit.js` 新 8b 段（6 断言）：双舞者动作重叠时只发预览舞者、另一人全不进、
  显式选择压过静音、越界只剩全局歌词、不传参保持全量。修复前 5 败，修复后全绿。
- `src/tests/datalayertest/program.cs` 新 ACTOR 段（11 断言）：混包拒绝/文案指路、单舞者+全局
  合法、纯全局/空/null 合法、三舞者拒绝；seek 侧混包旧 tie-break 成因锁定 + 预览 payload 的
  seek 定格=预览舞者、计划只剩一位、落空隙停止定格。
- `datalayertest.csproj` 登记 `PreviewActorPolicy.cs`（主工程 glob 自动包含）。

## 验证（AI-TEST-MATRIX，2026-08-31 实跑）

- Node 六套件全绿：engine 40/40、edit 93/93、check 73/73、projects 96/96、library 71/71、
  shell 33/33（同步后）。
- `datalayertest` Release：**232/232**（原 221，+11）；插件 Release 构建 0 警告 0 错误。
- `clipcheck-run.js`：source-dist 与 game root 各 **119/119**。
- `library-verify.js all`：**116/117**；`offline-verify.js all`：**33/35**——3 个失败全部
  根因定位为 **SEC-1 尾巴（harness 未适配私有读 token 门控）**，与 ACTOR 无代码交集，证据：
  - 48795 无 token 探测 `/export/skeleton`、`/model.gltf` 均 403（live DLL
    已是 SEC-1 门控）；offline-verify 从不种 `choreo_pairToken`（library-verify 有），fresh
    profile 页面拿不到骨架/模型 → `__p3dDebug().offline` 不清除 → [online]/[transition] 的
    「真模型」等待超时（确定性，非负载 flake；SEC-1 当天全绿是因为 DLL 热重载发生在套件之后）。
  - library-verify rec「自选清单」：`probeExport` 按门控读判连接，`exportConnected=false` 时
    四个录制模式按钮 disabled，合成 click 被吞 → 0 复选框。CDP 探针实锤：按钮 disabled=true、
    直调 `onclick()` 正常渲染 293 项。token 化重探要等 15s conn-watch，场景 2-5s 就点了。
  - 修复方向已写入 `AI-BACKLOG.md` HYGIENE（harness 先种 token/等 exportConnected；以及
    `exportConnected` 是否该挂在私有读上属主人可见行为，需主人拍板）。断言一律不放宽。
- 部署根：`choreo-app.js`/`choreo-edit.js` 已同步 web/dist、devPlugins、game 根，四处 md5
  一致（choreo-app `955604c9…`、choreo-edit `31f0b938…`）。其余 30 个产品文件未动。
- 卫生：`git diff --check` 干净；未 commit/push/publish；release/staging 未动。

## 主人待办（按队列）

1. ~~实机验收 ACTOR~~ **已通过（2026-08-31）**：主人确认功能正常，SPEC §1 对应项已勾。注意：
   主人验收的是网页侧过滤（live DLL 仍是 CORE-HTTP 版）；插件侧 `PreviewActorPolicy` 400
   守卫在下一次 DLL 热重载时生效，仅是双保险，不影响现有功能。
2. HYGIENE/SEC-1 尾巴：上面 3 个浏览器套件残留失败的修复方向需要您拍板（尤其
   `exportConnected` 语义）。
3. 既有队列不变：SEC-1 overlay smoke、双 profile 验收、zip 安装回归、Meddle 模型部署观察。

## 下一个工作包

`AI-BACKLOG.md` 顺位 4：**FIX-I**（3D init 取消 + 资料库可恢复/原子导入）。
