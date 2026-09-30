# 交接：X1 首个离线执行器增量（纯技能/移动/朝向核心）TASK-20260911-X1-OFFLINE-EXECUTORS

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-EXECUTORS.json`（rev 2，R3，standard，gateContract/qualityContract v2）
- 运行：`RUN-20260911-X1-OFFLINE-EXECUTORS`（Worker，已完成入历史）
- 门禁：`.agent/evidence/TASK-20260911-X1-OFFLINE-EXECUTORS/GATE-RUN-20260911-X1-OFFLINE-EXECUTORS.json`（13 项全过，2026-09-10T18:13Z）
- 评审：module + global 均 APPROVE，反例 `COUNTEREXAMPLE-CH-MODULE-1` / `COUNTEREXAMPLE-CH-GLOBAL-1` 均 not-falsified
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-EXECUTORS.json`

## 目标与验收

主人 2026-09-11 解锁 X1 执行器开发（REQ-SPEC-017 第一增量，离线假时钟证据即可收包；实机部署另行单独授权）。交付一个可复用的纯离线执行器核心，挂在既有 ShowRunner 时钟/调度器/生命周期上：单演员（显式 performer id）的技能、按 waypoint 时间的移动插值与有界纠偏、固定角/沿路朝向，全部 fail-closed、只发意图不碰游戏。七条验收（AC-1..7）覆盖输入拒绝矩阵、时钟优先级派发、技能七条件三态、移动边界与有界纠偏、朝向优先级/驻留、停止边界与清理、遗留行为与冻结字节不变。

## 机理与红基线

本包为新增能力，六条回归（REG-INPUTS/CLOCK/ABILITY/MOVEMENT/FACING/STOP）均为 bounded-unavailable：改前核心与命名用例不存在，预先运行只会在测试器分发处退出 2，度量的是分发表而非执行器行为，故不存在诚实的行为红基线，按工单冻结只绑绿门检查。REG-PARITY 为特性化保护：改前基线 801/0 全套件、status-json-freeze 0 失败、show-compiler 43/0、Release 构建 0 警告 0 错误，改后逐一复跑不得弱化。

## 改了什么、保了什么

- `src/X1ExecutionInputs.cs`（新）：唯一受支持的离线输入形状（ability/movement/facing + 七个三态技能条件 + 记录型 sink）。全部拒绝（缺 actionId、NaN/Infinity、空/乱序/重复 tMs、非正容差、混用 performer、skip/wait 策略、transition/stage-center/other-actor 朝向、未采样曲线）在任何执行器构造前给出非空中文原因且零 sink 调用。内部语义冻结：舞台本地 x/z 米、角度度（atan2(dx,dz)，0=+Z）、单一 performer id。
- `src/X1ShowDispatcher.cs`（新）：记录型派发器，`IX1ActiveUpdater` 活动更新缝 + 成功项带「离线意图（未确认游戏生效）」区分已提交意图与未证实的游戏生效。
- `src/X1AbilityExecutor.cs`（新）：七条件全真才提交且恰一次；任一 false/unknown 提交零条并按 event id + 中文原因停演；无目标搜索、无动作替换、无自动重试。
- `src/X1MovementExecutor.cs`（新）：按声明 waypoint 时间分段线性插值；每次纠偏钳到 maxCorrectionM（4.0m 误差恰发 1.5m 上界）；终点观测误差超 arrivalToleranceM（0.5m 对 0.25m 边界）即故障释放、终点后零更新不追跑（静止观察者同规则故障）；非法输入执行前拒绝；只发意图，从不写游戏坐标。0.25/1.5 仅为测试夹具参数，产品代码无默认容差。
- `src/X1FacingExecutor.cs`（新）：独立固定角（90° 夹具）激活期间每帧恰一条胜出；结束后回归移动切向、无残留独立角；静止段驻留最后输出（不吸附 0/NaN）；终止清理恰一次释放。
- `src/ShowRunner.cs`：可选 `IX1ActiveUpdater` 缝，旧 IShowDispatcher 消费者零行为变化；守卫评估仍先于故障帧任何输出；同刻事件按调度器优先级（facing>movement>ability>motion>cue>lyrics）恰一次提交、无链式延迟漂移；sink 内重入 RequestStop 即刻截断剩余突发/更新且零泄漏；清理跨抛异常仍逐项恰一次；停止/故障后显式 Arm+Start 是唯一复演路径；Countdown/Playing/Stopping 卸载仍拒绝。
- 测试三件：`X1ExecutorTests.cs`（新，六个命名用例 + --red 同断言抑 OK 奇偶校验）+ `program.cs` 分发 + csproj 编译项。既有四个命名用例名称/哨兵/退出码原样。

保持不动：ShowValidator/GameShowDispatcher/EventScheduler/RuntimeGuard/ExecutionLog/Plugin/Http/协议层、web、pose 子系统、全部禁止路径；movement/facing/ability 事件与 movement-control/ability-execution 能力名仍按原消息拒绝；Kinds=6、SupportedExecutors=3；无新线字段、无生产 X1 激活、无第二时钟；未部署。

## 实际验证观察

- 门禁 13 项全过（工单校验、工作区完整性、diff-whitespace、六个 X1 命名用例、status-json-freeze、datalayer 全套件、show-compiler 43/0、Release 构建 0 警告 0 错误），证据哈希入档。
- 全套件 1081/0（= 改前 801 基线 + 280 条新 X1 断言，零弱化）；六个新用例同时从无过滤全量套件执行；未知用例名仍退出 2；`--red` 与绿模式同一批断言。
- module 评审用自写假时钟探针（review-module-harness/，自备 id/阈值 0.3m/1.2m/角度 200/300/90，不复用 Worker 夹具）尝试击穿准入、恰一次/优先级、纠偏上界、朝向优先级、停止边界及 --red 奇偶性，另做逐用例断言删除变异（mutation-green-red.log），全部 not-falsified。
- global 评审从源码+门禁证伪生产隔离：X1 引用仅限五个新核心文件/ShowRunner/测试三件；ShowValidator/EventScheduler/RuntimeGuard/ExecutionLog 对 HEAD 零字节改动；冻结 StatusJson 与编译器输出逐字节一致；not-falsified。
- `git diff --check` 干净；measure 归因仅 9 个在域内文件。

## 剩余主人尾巴与原因

六条既有主人尾巴全部原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）——本包是离线核心，真机适配/校准/实机验收需主人单独授权与实机会话。REQ-SPEC-017 与 REQ-WP-X1 保持开放（离线实现/回归维度推进，部署/实机维度未动）；REQ-SPEC-012 仍开放。策略上限恢复决定（policy-ceiling）仍待主人。

## 改动文件

`src/ShowRunner.cs`（+`IX1ActiveUpdater` 缝）；新增 `src/X1ExecutionInputs.cs`、`src/X1ShowDispatcher.cs`、`src/X1AbilityExecutor.cs`、`src/X1MovementExecutor.cs`、`src/X1FacingExecutor.cs`；`src/tests/datalayertest/program.cs`、`datalayertest.csproj`、新增 `src/tests/datalayertest/X1ExecutorTests.cs`。共 9 个域内文件，工作树未提交（仓库保持主人未提交工作原样，不 commit/push）。

收口快照：`next` 快照 2026-09-10T18:49:16.518Z（complete，无不可用段）——工单已闭，组合路由停于 owner-tail（六尾巴待主人处置），`progress --full` 为只读全量视图。
