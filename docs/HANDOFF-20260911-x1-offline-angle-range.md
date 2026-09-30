# 交接：X1 离线共享角度规范化严格区间（恰 360→0 全消费者生效）TASK-20260911-X1-OFFLINE-ANGLE-RANGE

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-ANGLE-RANGE.json`（rev 1，R3，standard，gateContract/qualityContract v2，状态 closed）
- 运行：`RUN-20260911-X1-OFFLINE-ANGLE-RANGE`（Worker，已完成入历史；活跃 10.2 分钟 / 预算 90 分钟，修复 1 次 / 上限 2 次）
- 门禁：`.agent/evidence/TASK-20260911-X1-OFFLINE-ANGLE-RANGE/GATE-RUN-20260911-X1-OFFLINE-ANGLE-RANGE.json`（17 项全过，qualityEvidence v2：5/5 AC 覆盖 + REG-RANGE/REG-PARITY 双回归绑定）
- 评审：module + global 均 APPROVE，反例 `CH-MODULE` / `CH-GLOBAL` 均 not-falsified（含两处变异击穿尝试，见下）
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-ANGLE-RANGE.json`

## 目标与验收

主人 2026-09-11 按 INT-20260911-NEXT-X1-INCREMENT 从 56–59 号订单交接记录的候选中选择本增量：把 59 号收口时登记的共享缺陷（OtherActor 分支局部修正后，其余冻结分支在同一边界几何下仍发 360）升级为共享助手级修复。目标：共享 `X1MovementExecutor.NormalizeDeg` 仅把舍入后恰为 360.0 的结果映射为 +0，对全部离线 movement/facing 消费者一致生效；其余一切有限结果位级不变（含 -0 保留 -0、邻接 359.99999999999994 与微小正值原样），NaN/Infinity 传播不变；`X1FacingExecutor` 与 `X1ShowDispatcher` 零字节改动（OtherActor 局部防御按 nonGoals 原样保留，现为冗余但不动）。五条验收（AC-1..5）覆盖助手矩阵、全消费者边界行、生命周期边界矩阵、停止/复演刻画与遗留冻结（全套件绿、StatusJson 字节冻结、Release 0 警告 0 错误、验证器仍拒绝 movement/facing/ability 与两能力名、无部署无 SPEC 勾选）。

## 机理与红基线

机理：atan2 度数 -2.2918311805232927e-14（dx=-4e-16,dz=1 的可复现边界）经 `%360` 得自身负值，`+360` 在 IEEE double 下舍回恰 360.0。修复为助手体内两行：`if (r == 360.0) r = 0.0;`（英文行内注释，原因见环境事项）。诚实红基线 REG-RANGE：修复前 `-- x1-angle-range --red` 退出 1、26 行 FAIL（全部恰-360 行 emitted=360）、指纹 `X1_ANGLE_RANGE_ASSERTION`，`record-red` 入档（`.agent/evidence/TASK-20260911-X1-OFFLINE-ANGLE-RANGE/red/REG-RANGE.{json,log}`，日志 sha256 0da0852b…cd89a，门禁 qualityEvidence 重校验绑定）；REG-PARITY 为 characterization（携带行为保护检查，非失败基线），绑定 13 项绿门禁检查。

## 改了什么、保了什么

运行归因（finalMeasurement，基线哈希 5d9e54df…，认领基线对照）恰 3 个在域文件 +645/-1：`src/X1MovementExecutor.cs`（仅 NormalizeDeg 两行修正，其余字节不变）、`src/tests/datalayertest/X1AngleRangeTests.cs`（新增，132 命名行 / 10 族：ar-helper 助手矩阵、ar-fixed/ar-along/ar-tangent/ar-transition/ar-stage/ar-other/ar-dispatch 全消费者、ar-life 生命周期边界、ar-stop 停止复演刻画）、`src/tests/datalayertest/program.cs`（两行 harness 注册）。保护面零字节改动：X1FacingExecutor、X1ShowDispatcher、ShowRunner、X1AbilityExecutor、X1ExecutionInputs、ShowValidator、ShowProtocol、EventScheduler、RuntimeGuard、ExecutionLog、Plugin、GameShowDispatcher、web、SPEC 与全部历史交接未动；StatusJson 字节冻结；验证器仍拒绝 movement/facing/ability 与两个能力名（Kinds=6、SupportedExecutors=3）；无 epsilon 吸附、无容差/最短路径/缓动/方向变化。

## 实际验证观察

- 门禁 17 项全过（v2 冻结清单一一对应）：工单校验、工作区完整性、diff-whitespace、十一个 X1 命名用例（新 x1-angle-range + 既有 inputs/clock/ability/movement/facing/stop/stage-center/transition/other-actor）、status-json-freeze、datalayer 全套件、show-compiler 43/0、plugin-build Release 0 警告 0 错误。
- 全套件 1508/0（+104 over 1404 改前基线，无断言弱化；x1-angle-range 自身 0 失败）。
- REG-RANGE 红绿完整：红退出 1 指纹 X1_ANGLE_RANGE_ASSERTION（26 行恰-360 发射 360），绿 x1-angle-range/x1-other-actor/datalayer-suite 全过。
- module 评审 not-falsified：独立 IEEE-754 oracle（Node 22 fmod/atan2）逐位复算全部期望字面量（-2.29e-14/-5e-324/-1e-14/-2.8e-14→+0；五个邻接值→359.99999999999994；+2.29e-14 保留；±0/-360/-720 符号位保留；1e308→296 等；NaN/±Inf→NaN）；变异 1（评审自有临时夹具回退修正）26 FAIL 同指纹；变异 2（epsilon 吸附变异）23 FAIL 全落在邻接值/微小正值/带符号零保护行；对当前源复跑套件与 measure 范围核对（3 文件 +645/-1，gateContractHash/qualityContractHash 重算匹配）。
- global 评审 not-falsified：独立复算门禁规范哈希 70ac261f…、两契约哈希与认领/门禁/评审间窗口外零改动扫描；评审自有临时夹具回退修正后 4 行 [ar-stop] 生命周期行（含 Arm+Start 复演行）发射 360 而失败；红证据盘上哈希三处一致；CHG 测试证据引用 REG-RANGE/REG-PARITY、回滚限于运行自有范围。

## 剩余主人尾巴与原因

六条既有主人尾巴全部原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）。REQ-SPEC-017、REQ-WP-X1 保持开放：本包只贡献离线严格区间修正的离线假时钟回归维度，实机适配器、校准、能力开通、部署与实机验收另行单独授权；SPEC 无勾选，未部署、未 commit/push。环境事项（仓库外，模块记录 knownRisks 已披露）：首次修复尝试在 `X1MovementExecutor.cs` 体内使用中文行内注释后，该内容新建的 datalayertest.dll 一律 FileLoadException 0x800711C7 闭锁失败（TEMP 下 hello-world 对照构建正常），改用英文行内注释重建后行为完全一致（x1-angle-range 0 失败）；文件头中文用途注释保留，后续评审不要再往该函数体引入非 ASCII 而不复跑命名门禁。

## 改动文件

运行归因 3 变更（见上节）。收口新增/更新：模块记录 `CHG-TASK-20260911-X1-OFFLINE-ANGLE-RANGE.json`（Worker 已建）、本交接、PROCESS-STATE 台账（包 60 与 latestProductHandoff）、backlog 行 60（生成视图）、continuity 现状改写、工单状态 accepted→closed。产品/测试文件保持主人未提交工作树原样（不 commit/push/部署）。

收口快照：finish 后复跑 `next` 于 2026-09-11T13:21:31.792Z（complete，无不可用段；closurePreserved=true、secondFinish=false；M-OWNER-CLOSEOUT/M-LIFECYCLE/M-EVIDENCE 的 MILESTONE_NO_NEXT/ACCEPTANCE_GAP 诊断为组合图既有状态，非本票引入，与 59 号收口一致）——本票已闭（closedTicket 确认），组合路由暂停在主人对 EXEC-LIVE 尾巴的决定（mode owner-tail，6 条开放尾巴阻断组合 done，无需开新角色会话）：主人实机执行或显式处置实机验收尾巴，或指示下一个增量交 Planner 新票；`progress --full` 为只读全量视图。
