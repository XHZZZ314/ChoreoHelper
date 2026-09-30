# HANDOFF 2026-08-31 — FIX-J 插件线程、生命周期与恢复（PLUG-1~7）

> 包来源：`docs/AI-BACKLOG.md` 第 7 包。本次只动 C# 插件与数据层测试；web 产物零改动，
> 三个部署根无需同步（C# 变更经主人下一次加载/热重载 DLL 生效）。未提交、未推送、未发布；
> Release 构建只落在 `src/bin`，devPlugins 复制目标仅挂 Debug 配置，实机安装未被触碰。

## 修复总览（全部七项）

| 项 | 根因（代码证据） | 最小修复 |
|---|---|---|
| PLUG-1 | `HttpServer.HandleRequest` 三个游戏线程调度分支只认 `method == "GET"`，HEAD 掉进后备 switch 在监听线程直读游戏对象（`/debug/poke` 还会在非框架线程触发调试动作） | 三分支改为 `(GET \|\| HEAD)`，HEAD 与 GET 同进 `GameThreadJson` 框架线程调度（5s 上限天然生效）；HEAD /lyrics 维持 GET-only，落 switch 无臂 → 404 一致拒绝 |
| PLUG-2 | `ExportServer.HandleSkeletonAsync` 无限等 `_framework.RunOnFrameworkThread`，游戏线程卡死时 handler 永久挂起、Dispose 排空陪葬 | 与 48794 `GameThreadJson` 同口径：`WaitAsync(5s)`，超时写 503 `{"error":"game thread busy"...}` 并返回 null |
| PLUG-3 | `ExportServer.Start()` 一次 bind 失败即永久放弃（热重载/双开窗口期端口被占则本实例从此无 API），而 48794 有 BindLoop | 新增 `BindLoop`（与 HttpServer 同策略：2s×90 后 30s 兜底，`_cts` 可取消，Dispose 与绑定竞速自关防泄漏），成功后接 `ListenLoop` + `CleanStalePending()` |
| PLUG-4 | 录制完成路径全在框架（游戏）线程：`Finish → BuildClip`（逐帧×逐骨 Decompose）→ 回调内 `AnimWriter.ToJson` + 多兆字节 `File.WriteAllText`（单条 pending 暂存与批量落盘/隔离两路都是） | `Finish` 在游戏线程只做 O(1)：`_recording=false` → 帧列表整表换新实例交接 → 后台 `Task.Run` 做 `BuildClip`（改为纯静态，只吃交接帧列表）+ 日志 + 回调。JSON 序列化/质检/落盘随回调一起移到线程池路径 |
| PLUG-5 | `RecorderService.Record` 先置 `_recording=true` 再重置 `_startedAt` 等状态；框架 tick 插入会拿上一条的计时判定 `now-_startedAt > 20s` → 新录制开局即被 timeout 掐死 | 状态全部就绪后最后发布 volatile `_recording=true`（volatile 写自带释放语义，框架线程看到 true 时状态必已就绪） |
| PLUG-6 | `ExportServer.ListenLoop` `_inFlight.Begin()` 后 `Task.Run(handler, ct)`：ct 在调度前取消则工作体整体被跳过，`finally { h.Dispose() }` 不执行 → 在途计数泄漏、排空陪葬 | 已接受的请求调度去掉取消令牌（`RequestDispatcher` 的源头契约同款：令牌只进工作体内部 I/O） |
| PLUG-7 | `GameCommandExecutor` 用 `DateTime.Now` 做 200ms 命令节流，墙钟回拨停摆/前跳连发 | 判定抽成纯策略 `src/CommandThrottlePolicy.cs`（单调 `Environment.TickCount64` 毫秒，边界口径与旧 `elapsed >= 间隔` 完全一致），执行器只喂单调时钟；队列过期丢弃本就用 TickCount64，统一取一次 `nowMs` |

## 复现与回归（诚实记录）

- 基线实测：`datalayertest` **232/232 全绿**（修复前先跑确认）。
- PLUG-7：`DateTime.Now` 墙钟行为无法在单测里操纵，故按“判定抽纯策略”路线：新增
  `CommandThrottlePolicy` + 9 条边界回归（首命令放行/199 拦/200 放/399 拦/长间隔放/
  delta 0 拦/delta 负拦/零间隔/负间隔）。
- PLUG-6：泄漏机制在单测中隔离复现（预取消令牌的 `Task.Run` 整体跳过工作体 + InFlightTracker
  句柄无人释放排空永不归零）+ 修复契约（无令牌调度必达、finally 必执行、排空归零），共 3 条。
  无法对旧 `ExportServer` 整类直接红绿——它依赖 Dalamud 接口，net8 测试工程不可引用；
  实机行为列入主人验收尾巴。
- PLUG-1/2/3/4/5：宿主类同样无法在 datalayertest 构造（Dalamud 依赖），按矩阵口径以
  代码机制证据 + 修复同构复用（48794 已实机验证过的 `GameThreadJson`/`BindLoop` 模式）
  收口，实机验证列入尾巴。PLUG-1 仅有的纯面（HEAD 诊断走快车道）加了 1 条契约断言。
- 修复后：`datalayertest` **245/245**（+13），全绿一次通过；新段名
  `== FIX-J PLUG-7 / PLUG-6 ==`。
- 插件 Release 构建（`--no-incremental`）：**0 警告 / 0 错误**。
  （过程中修过一处编译错误：`RecorderService.cs` 里 `Task` 与
  `FFXIVClientStructs...Framework.Task` 歧义，改全限定 `System.Threading.Tasks.Task.Run`。）

## 行为保持说明

- 生产语义不变：POST 互斥、SEC-1 配对、两阶段提交、批量隔离、48794 全部行为原样；
  200ms 节流边界口径不变（恰好 200ms 放行）。
- 录制回调改为异步到达：两个等待方（`HandleClipSync` 的 30s 事件、`BatchLoop` 的 TCS）
  本就只等信号，不受影响；`CancelPending` 不会二次回调（`_onDone` 已清空）。
- PLUG-4 交接安全：`RecGate` 串行化保证下一条 `Record` 只会在回调之后启动，`_frames`
  整表换新后旧列表在线程池独占读取；`_frameTimes` 仅采样期使用，不交接。
- 48795 绑定重试与 48794 完全同参（2s×90 → 30s），Dispose 取消随时终止，热重载接管窗口
  与 48794 一致。

## 文件变更

- 新增：`src/CommandThrottlePolicy.cs`（纯策略，无 BOM，同 RecordTiming/ReadAuthPolicy 惯例）。
- `src/HttpServer.cs`：三个游戏线程调度分支 GET → GET||HEAD（PLUG-1）。
- `src/Exporter/ExportServer.cs`：`Start/BindLoop` 重写（PLUG-3）、`ListenLoop` 调度去令牌（PLUG-6）、
  `HandleSkeletonAsync(ctx)` 加 5s 超时 503（PLUG-2）。
- `src/Exporter/RecorderService.cs`：`Record` 状态就绪后发布旗标（PLUG-5）、`Finish` 交接 +
  `BuildClip` 纯静态化（PLUG-4）、`_frames` 去 readonly。
- `src/GameCommandExecutor.cs`：节流接 `CommandThrottlePolicy`（PLUG-7）。
- `src/tests/datalayertest/`：csproj 链接新策略；`program.cs` 末尾新增 FIX-J 段 +13 条。
- 文档：`docs/AI-BACKLOG.md`（第 7 包 CLOSED + 验收队列补充）、`.agent/CONTINUITY.md`、本文件。

## 实机自测补遗（2026-08-31，重载后发现第二个根因）

主人重载后自测发现：**实机上所有带响应体的 HEAD 本来就是 500**，不止三个游戏线程端点。
隔离探针锁定根因：`HEAD /health`（纯常量、不碰游戏）也 500，且 500 响应头
`Content-Length: 15` 恰好等于 `{"status":"ok"}` 的长度——HttpListener 拒绝对 HEAD 响应写
实体 body，`OutputStream.Write` 抛异常后被兜底 catch 统一变成 500（旧代码先把
ContentLength64 设成了 body 长度，异常路径原样保留了这个头）。405 文案里宣传的
"GET, HEAD" 名不副实；PLUG-1 只改调度分支还不够，HEAD 仍会在写响应时 500。

补丁（最小两处，与 PLUG-1 同包收口）：

- `LocalApiSecurity.RespondJson`（两端口全部 JSON 响应/403/405 的共享写入器）：
  HEAD 保留 Content-Length 头、跳过写 body，状态码与 CORS 完全一致。
- `HttpServer.HandleRequest` 手写响应尾：同口径跳过 HEAD 写体。

复验：datalayertest 245/245（不涉及，纯托管面不变）；Release 构建 0 警告 / 0 错误。
实机判定口径更正：HEAD 期望 **200/403 状态码 + Content-Length 头、body 为空**（curl -I
看状态与头，本就不显示 body）；GET 行为不变。

另：本次实机核对确认 Dalamud 的 `DevPluginLoadLocations` 只指向
`%APPDATA%\XIVLauncherCN\devPlugins\ChoreoHelper\ChoreoHelper.dll`——**热重载加载的是
该文件，不会自动取 `src/bin` 的构建产物**；重载前必须先把新 DLL 复制过去（首次自测
时该文件还是 8 月 30 日的旧构建，md5 `9a691f26…` ≠ 新构建 `c7d227c0…`，即主人第一次
重载到的并非 FIX-J 版本）。

## 实机自测结果（2026-08-31 13:0x–13:2x，主人授权全量自测）

新版 DLL（`90759acf…`）经主人重载生效后，按风险从低到高全部实测：

| 项 | 实测证据 | 结论 |
|---|---|---|
| PLUG-1 | HEAD 匿名读 200、无令牌 403、带令牌私有读 200+Content-Length+空 body（上一轮套件） | ✅ |
| PLUG-2 | 正常路径 200/75ms；80 并发骨架风暴全部 200、最长 90ms、零崩溃、无泄漏；**5s→503 分支未被触发**（框架线程消化远快于 5s，无法安全逼停），分支本身与 48794 `GameThreadJson`（CORE-HTTP 实机验证过）逐字同构 | ✅ 实测面 / 503 分支留尾巴 |
| PLUG-3 | 今日 13:13:32 与 13:14:04 两次重载都打出新代码独有的 `ExportServer listening on localhost:48795 (attempt 1)`（旧格式无 attempt 后缀；12:01/13:05 两条旧格式正是旧 DLL） | ✅ BindLoop 已在跑；busy→接管分支需真实端口争用，留尾巴 |
| PLUG-4 | `/wave motion` save=true：HTTP 200 仅比录制时长多 ~0.14s（4.35s vs 4.21s）——构建+暂存落盘在线程池；收尾后骨架延迟 30–67ms 无顿挫；`updateAliveAgo` 全程 <0.08s；日志 `Recorder: done … (settled)` 来自后台构建 | ✅ |
| PLUG-5 | 录制中 recstate 轮询：`startedAgo` 首轮 0.04s 起步、逐轮正常增长、57 帧采满 settled——旧 bug 的「开局即 timeout（too few frames (0)）」已死 | ✅ |
| PLUG-6 | 80 并发 handler 全部有界返回、零 `handler crashed`、风暴后 skeleton 5ms / recstate 正常 | ✅ 实测面（调度契约另有单测） |
| PLUG-7 | 日志 `Queued: /wave motion` 13:21:36.937 → `Direct delegate call OK` 13:21:37.014（77ms 放行并执行，正常路径）；边界行为单测已锁 | ✅ |

清理与无泄漏：`/export/clip/cancel` → `{"ok":true}`，pending 目录归零；clips 目录无新文件
（4 个 wave* 均为 8/28–8/30 旧库存）；风暴零 handler 崩溃。游戏侧仅发生一次授权的
`/wave motion`。旧 DLL 观察到的 12:17/12:37 `ExportServer handle error`（HandleAsync 堆栈）
与 HEAD 写体 500 机制吻合——该 bug 在修复前就在真实使用中触发过。

**仅剩尾巴（无法安全/自主诱导）**：PLUG-2 的 503 需要框架线程真卡死（角色传送/大模型加载
时顺带观察即可）；PLUG-3 的 busy→接管需双开真实争用端口（日志找
`ExportServer port 48795 busy (attempt N)`）；PLUG-7 仅系统时钟被调整时可见。

## 主人实机验收尾巴（DLL 加载后一次会话可全过）

1. 加载重建的 DLL（热重载；本包构建未触碰 live install）。
2. **PLUG-1 + HEAD 修复**：配对后 `curl -I -H "X-Choreo-Token: ..."` 打 `/dancers`、
   `/debug/animstate`、`/health` 应 **200 且带 Content-Length 头**（HEAD 本就不回 body；
   旧版本这些一律 500）；无令牌 HEAD 仍 403。
3. **PLUG-2**：游戏线程卡顿场景（或加载大模型时）打 `/export/skeleton`，最多 5s 后得 503
   `game thread busy`，而非无限挂起；`/export/recstate` 在骨架挂起期间照常可查。
4. **PLUG-3**：双开/热重载占端口场景，日志出现
   `ExportServer port 48795 busy (attempt N, likely another game client)`，对端释放后自动接管。
5. **PLUG-5**：连续录制两条，`/export/recstate` 的 `startedAgo` 从小值正常增长，
   不再出现开局即 `recording timeout`。
6. **PLUG-4**：录制收尾瞬间游戏帧率不再顿挫；批量录制仍正常落盘/隔离静止片
   （`quarantine` 行为回归不变）。
7. **PLUG-7**：正常编舞播放手感不变（200ms 口径未动）；此修复只在系统时间被调整时可见。
