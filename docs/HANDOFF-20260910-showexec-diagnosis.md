# 交接：演出执行（实验）异常诊断 TASK-20260910-X1-SHOWEXEC-DIAGNOSIS（终端 A）

- 工单：`.agent/tickets/TASK-20260910-X1-SHOWEXEC-DIAGNOSIS.json`（rev 2, R2, standard）
- 运行：`RUN-20260910-X1-SHOWEXEC-DIAGNOSIS`（Worker）
- 终端状态：**A——离线确认的插件本地根因 + 有界修复 + 回归覆盖**（B/C 未触发）
- 机理证据：`.agent/evidence/TASK-20260910-X1-SHOWEXEC-DIAGNOSIS/mechanism-assessment.md`
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260910-X1-SHOWEXEC-DIAGNOSIS.json`

## 目标与验收

主人 2026-09-09 现场报告：「高级→演出执行（实验）」执行中角色不动、停止后才动（无录像无计数，
非正式验收）；同场普通「游戏角色→游戏内播放」四连舞正常。本包在 X1 执行器动工前，
必须以证据终结为三态之一：A 可验证的插件本地修复 / B 有证据的隔离+实测计划 / C 超出范围的升级。
结论为 **A**。REQ-WP-X1、REQ-SPEC-017、REQ-SPEC-009 保持 open，无 SPEC/路线图勾选变化。

## 机理与红基线

根因（M3，文件行证据）：演出链路在开演时从不释放预览/seek 残留的 pose 定格——
`ShowRunner.Load/Arm/Start` 零 dispatcher 调用（`src/ShowRunner.cs:89-141`），
每事件 `Dispatch` 只做 `PrepareForPlaybackCommand()+入队`（`src/GameShowDispatcher.cs:41-46`），
而 `Prepare…` 不碰 `_previewMode`（`src/AnimationPoseFreezer.cs:1353-1373`）。
残留定格的 Hold 期每帧压 0 速+重写时刻（`…:797,810-814`），整场钉住派发的舞蹈；
终态 `OnStop` 的 `StopPreview()`（`src/GameShowDispatcher.cs:65-76` → `…:697-698`）一松开，
冻住的舞蹈就续播——正是「演中静止、停后才动」。同进程同角色同舞蹈下普通播放正常，
因为 `PlaybackManager.Play` 开演即 `StopPreview+Clear`（`src/PlaybackManager.cs:149-150`），
演出链路缺的正是这一行互斥。队列/调度/时钟/编译器/守卫五路或被证伪、或特性化为按设计工作
（M1/M2/M4/M5/M6；其中队列在停止时 `Clear`，单凭它解释不了停后才动）。

红基线（未改产品码，仅加测试时）：7 个 FAIL、exit 1——`Start` 从不调 `OnShowStart`（calls=0）；
定格残留跨场；第一场 `visible=0 suppressed=3`（离线复现主人签名）； stops/13 条/第二场 10 条连带失败；
9 个队列特性化断言同期保持绿。`record-red` 不适用（本票无 qualityContract，
`QUALITY_CONTRACT_MISSING`），红基线以套件输出为证。

## 改了什么、保了什么

- `src/ShowRunner.cs`：`IShowDispatcher` 新增幂等 `OnShowStart` 成员；`Start` 进入 Countdown 时调一次，
  try/catch+trace 兜底，绝不破坏倒计时进入；被拒的 Start（含在途重试）不调用，409 单会话语义不变。
- `src/GameShowDispatcher.cs`：新增 `OnShowStart()`——仅 `Clear()+StopPreview()`（与 Play 同口径），
  不碰领地基线、不抛异常、幂等。
- `src/tests/datalayertest/program.cs`：21 个新断言（红绿回归：开演互斥 3、连续场 residue 10；
  特性化：队列 7；冻结：StatusJson 全载荷逐字节 1）+ `FakeFreeze/FakeShowQueue/ShowEmuDispatcher`
  语义镜像（注释内注 file:line）+ `FakeShowDispatcher` 计数。
- 保住的：pose 子系统零改（AC-6 禁止路径哈希前后一致）；线/协议/CORS/token 零改；
  普通播放链路零改（它是 parity 基准）；validator 照拒 movement/facing/ability；web 只读；
  主人未提交工作全保留（含 `src/Plugin.cs` 的 TASK-20260908 hunks，本包未碰）。

## 实际观测到的验证

- datalayertest：改前基线 626/0；加测试未改产品码时 7 红（exit 1）；修复后 **647/0 exit 0**
  （626 全绿零回归 + 21 新绿，含 StatusJson 冻结基线——14 字段逐字节锁定，改前捕获、改后仍绿）。
- `ChoreoHelper.csproj` Release 构建：改前改后均为 0 警告 0 错误。
- `web/test-showcompiler.js`：43/0（前后一致）。
- `pipeline-cli.js ticket` PASS；`pipeline-cli.js check` PASS（一条既有
  PREREQUISITE_INVERSION_RECORDED 警告，与本包无关）；`git diff --check` 干净。
- 预算内：3 个产品/测试文件 + 证据/记录/交接（≤10 文件 / ≤800 行）。

## 剩余主人尾巴与原因

1. **TAIL:SHOWEXEC-A-LIVE（分支 A 实机验收， riding 下一次主人游戏会话，不单独开会话；原因：
   可见 link 的引擎侧确认只能在真机做，AI 禁止 live-game 动作）**：用已部署的新 DLL（主人另行授权部署；
   本包未部署、未动 live 根）做两组对比——① 先拖时间轴预览/Seek 留定格 → 进「🎬 演出执行」
   装载→就绪→开始，预期演中即动；② 演中按停止，预期回到 Loaded 且无「停后才动」。
   附带记下 `/shows/status` 的 state/showTimeMs/dispatched/stopReason 与 `recentLog` 计划-vs-派发。
   若 ① 仍静止但 `showTimeMs` 钉在 0 附近且 dispatched=0 → 按 M4 转 tick 接线排查；
   若报 Faulted → 把 `stopReason` 原样带回。
2. X1 执行器包待本尾巴关闭后再上路（X1 门禁语义不变）。

## 文件清单

- `src/ShowRunner.cs`、`src/GameShowDispatcher.cs`、`src/tests/datalayertest/program.cs`
- `.agent/evidence/TASK-20260910-X1-SHOWEXEC-DIAGNOSIS/mechanism-assessment.md`
- `.agent/evidence/TASK-20260910-X1-SHOWEXEC-DIAGNOSIS/stability-pre.json`
- `.agent/evidence/TASK-20260910-X1-SHOWEXEC-DIAGNOSIS/stability-post.json`
- `.agent/modules/plugin-product/changes/CHG-TASK-20260910-X1-SHOWEXEC-DIAGNOSIS.json`
- `.agent/CONTINUITY.md`（仅风险行更新为终端 A）
