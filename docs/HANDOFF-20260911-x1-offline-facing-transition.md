# 交接：X1 离线独立朝向过渡（显式角 A→B）TASK-20260911-X1-OFFLINE-FACING-TRANSITION

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-FACING-TRANSITION.json`（rev 2，R3，standard，gateContract/qualityContract v2）
- 运行：`RUN-20260911-X1-OFFLINE-FACING-TRANSITION`（Worker，已完成入历史）
- 门禁：`.agent/evidence/TASK-20260911-X1-OFFLINE-FACING-TRANSITION/GATE-RUN-20260911-X1-OFFLINE-FACING-TRANSITION.json`（15 项全过，逐项证据哈希入档）
- 评审：module + global 均 APPROVE，反例 `COUNTEREXAMPLE-CH-MODULE-1` / `COUNTEREXAMPLE-CH-GLOBAL-1` 均 not-falsified
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-FACING-TRANSITION.json`

## 目标与验收

主人 2026-09-11 指示实机验收延期、按证据从已关闭执行器线的候选中选取下一个离线增量（INT-20260911-DEFER-ACCEPT-CONTINUE-NEXT），Planner 只选朝向过渡：输入形状、生命周期、优先级、sink 与 fail-closed 接缝全部离线已冻结，且存在诚实的行为红基线（改前代码拒绝 Transition）。目标：Transition 作为独立朝向模式进入纯离线核心——显式有限 from/to 角度（度，允许未归一化）在朝向事件既有 [start,end) 窗口上按 ShowRunner 时钟逐 tick 线性插值，fail-closed 中文原因，只发意图。五条验收（AC-1..5）覆盖：准入矩阵（任一端点缺失/NaN/Infinity、非 StopShow 策略、混合演员、未知枚举、OtherActor 全部在执行器创建前拒绝且零 sink 调用；Transition 输入上多余的 StageCenterX/Z 保持忽略）；插值精确（t=0 发 NormalizeDeg(A)，中段 1e-9 内等于 NormalizeDeg(A+(B-A)*t)，半开窗口 t=1 端点永不发，零长窗口不发，方向由调用方声明——350→370 过 0、10→-10 反向、0→340 走 +340 而非 -20° 最短路、0→720 跨两圈，全部输出有限且归一化 [0,360)）；优先级（最新开始独立胜出、事件 id 平局、Transition 胜出时忽略移动切向与观测输入、StageCenter 单次共享观测读不变、窗口结束回到切向无残留）；停止生命周期（sink 抛出按事件 id + 中文原因停演、sink 内重入停止截断剩余输出零泄漏、释放恰一次、Arm+Start 是唯一复演且无旧角度残留）；遗留与冻结（全套件绿、StatusJson 字节冻结、编译器绿、Release 0 警告 0 错误、ShowValidator 仍拒绝 movement/facing/ability 与两个能力名 Kinds=6/SupportedExecutors=3、无线上/能力/网页变化、生产 X1 不激活、不部署）。旋转方向与缓动按带标签的最小子集建议（architecture-impact.md A1–A3）由 QA rev 2 独立评审接受并强化 AC-2，不是既有产品规则。

## 机理与红基线

改前实现诚实拒绝 Transition——行为红基线真实存在而非构造。三条 red-green 回归（REG-INPUTS/REG-INTERP/REG-STOP）修复前用 `record-red` 各记一条：同一命令 `x1-transition --red`，退出 1，标准化指纹 `X1_TRANSITION_ASSERTION`（记录与日志在 `.agent/evidence/TASK-20260911-X1-OFFLINE-FACING-TRANSITION/red/`，2026-09-11T05:27:30Z）。REG-PARITY 为 characterization：全套件 1175/0 基线、StatusJson 冻结字节、协议 v1 编译器输出与 Release 构建是当前绿的保全目标，弱化任何一项即回归、无红可记；x1-inputs 与 x1-facing 原两行 Transition 拒收缩窄为 OtherActor-only，等价覆盖移入 x1-transition（本票域内），替换本身由冻结命名用例把门。

## 改了什么、保了什么

运行归因（finalMeasurement，基线哈希 3e137d…）5 个在域文件 +564/-11 加 1 个新路径：`src/X1ExecutionInputs.cs` 增可空 `TransitionFromDeg/TransitionToDeg` 字段与构造前校验（两端点必须存在且有限，快照拷贝防改向）；`src/X1FacingExecutor.cs` 增快照属性与逐 tick 线性插值分支（半开端点、零长窗口静默、非有限值 fail-closed）；`src/tests/datalayertest/X1TransitionTests.cs` 新增命名回归（tr-inputs/tr-interp/tr-prec/tr-fail 四组）；`X1ExecutorTests.cs` 与 `program.cs` 做对应收窄与 `x1-transition` 接线；`datalayertest.csproj` 加编译项。语义冻结在模块记录：准入矩阵、五类方向行的插值公式、优先级与单次共享读、停止/复演语义。

保持不动：ShowRunner/X1ShowDispatcher/ShowValidator/ShowProtocol/EventScheduler/RuntimeGuard/ExecutionLog/Plugin/GameShowDispatcher 等全部生产文件与 web 零字节改动（global 评审以认领基线逐文件 SHA-256 加全树 mtime 审计重推导 diff 佐证）；ShowValidator 仍拒绝 movement/facing/ability 与两个能力名（Kinds==6、SupportedExecutors==3）；StatusJson 字节冻结；无线上写、未部署。

## 实际验证观察

- 门禁 15 项全过（v2 冻结清单逐一对应）：工单校验、工作区完整性、diff-whitespace、九个 X1 命名用例（含新 x1-transition）、status-json-freeze、datalayer 全套件、show-compiler 43/0、plugin-build Release 0 警告 0 错误。
- 全套件 1285/0（1175 基线 + 110 条新过渡断言；两行缩窄为 OtherActor，等价覆盖在 x1-transition，无弱化）；`git diff --check` 干净。
- x1-transition 四组命名断言：准入矩阵 30 检（含零 sink 调用断言）、五类插值行（10→100、350→370、10→-10、0→340、0→720；1e-9；发散行钉死 85/170/255 而非 355/350/345）、优先级（含事件 id 平局与 StageCenter 读计数 1/0 差分）、故障/停止/复演（含重入停止与抛出清理恰一次）。
- module 评审：独立假时钟/记录 sink 探针（评审自有夹具 rv-*、容差 2e-10 严于 Worker 的 1e-9、临时工程编译仓库源码原样）尝试击穿准入/插值/四类方向行/优先级，并做断言删除变异验证绿命令非零失败——not-falsified；global 评审：独立复算 gateContractHash 与 qualityContractHash、15/15 冻结项逐一核对（含逐项日志哈希与三条红记录重绑）、5 文件 delta 重推导加 22 个冻结生产文件 mtime 审计、fail-closed 停止语义与 Arm+Start 复演击穿——not-falsified。
- 双评审各记一条相同 P3（非阻塞，如实留档）：共享助手 `X1MovementExecutor.NormalizeDeg` 对 (-2.8e-14,0) 区间的原始角恰好返回 360.0 而非 <360；所有已声明行类不可达、方向等价（360≡0）、该助手本票未改动；留作未来事实记录，不在本票修。

## 剩余主人尾巴与原因

六条既有主人尾巴全部原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）。REQ-SPEC-017、REQ-WP-X1 保持开放：本包只贡献离线 Transition 回归维度，实机适配器、校准、能力开通、部署与全部实机验收另行单独授权；策略上限恢复决定仍待主人；SPEC 无勾选。收口时发现的未决漂移一项：Planner 早期草稿工单 `.agent/tickets/TASK-20260911-X1-OFFLINE-TRANSITION.json`（order 10000，draft，路由 qa-lead）与本票同域，其范围已被本票接受并关闭，属残留路由项；按收口边界不改动他票，留待主人处置（取消或重定向）。

## 改动文件

运行归因 5 变更 + 1 新路径（见上节）。收口新增/更新：模块记录 `CHG-TASK-20260911-X1-OFFLINE-FACING-TRANSITION.json`、本交接、backlog 行 58（生成视图）、PROCESS-STATE 台账（包 58 与 latestProductHandoff）、continuity 现状改写（产品状态、架构决策、下一步）。产品/测试文件保持主人未提交工作树原样（不 commit/push/部署）。

收口快照：`next` 快照 2026-09-11T06:58:02.579Z（complete，无不可用段）——本票已闭，组合图暂无本票关联证据条目（快照如实标注 unavailable）；组合路由转至残留草稿 `TASK-20260911-X1-OFFLINE-TRANSITION`（order 10000，qa-lead，requirements），该草稿与本票同域、属收口发现的未决漂移，待主人处置；`progress --full` 为只读全量视图。

主人授权直接维护（2026-09-11，本收口会话）：主人一句授权「重复草稿作废」，范围仅限将上述残留草稿工单 `.agent/tickets/TASK-20260911-X1-OFFLINE-TRANSITION.json` 状态 draft→cancelled（内容与工单其余字段零改动，无产品字节改动），使组合路由不再把已完成工单的重复评审排给 qa-lead；按 AI-WORKFLOW §2.7 将授权、范围与本条编辑记录于本交接。作废后路由去向以收口会话复跑 `next` 为准。
