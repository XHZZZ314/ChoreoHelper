# 交接：X1 离线他演员朝向（显式目标演员观测位置）TASK-20260911-X1-OFFLINE-OTHER-ACTOR

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-OTHER-ACTOR.json`（rev 2，R3，standard，gateContract/qualityContract v2，状态 closed）
- 运行：`RUN-20260911-X1-OFFLINE-OTHER-ACTOR-R2`（Worker，已完成入历史；r1 运行因历史保全证明无法完成被主人作废，证据全保留）
- 门禁：`.agent/evidence/TASK-20260911-X1-OFFLINE-OTHER-ACTOR/GATE-RUN-20260911-X1-OFFLINE-OTHER-ACTOR-R2.json`（17 项全过，逐项证据哈希入档）
- 评审：module + global 均 APPROVE，反例 `COUNTEREXAMPLE-CH-MODULE-1` / `COUNTEREXAMPLE-CH-GLOBAL-1` 均 not-falsified
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-OTHER-ACTOR-R2.json`

## 目标与验收

主人 2026-09-11 授权 r2（INT-20260911-OTHER-ACTOR-R2-AUTHORIZED）：r1 已取消但实现仍留在工作树，承认旧运行历史保全证明无法补齐、保留全部证据，以受保护基线 + 新验收 + 新运行恢复证据链；非追溯批准、非扩权。目标：OtherActor 作为独立朝向模式进入纯离线核心——显式非空目标演员 id（观测键而非驱动，不触发单演员捆绑检查）、在既有 ShowRunner 时钟上逐 tick 由观测自身位置指向观测目标位置的 atan2 方位角、1e-12 重合/自指保持最后角度、目标观测缺失/抛出/非有限/未知 id 全部带胜出事件 id 前缀中文原因 fail-closed、Arm+Start 唯一复演、只发意图。r2 增量限定严格区间修正：共享 `X1MovementExecutor.NormalizeDeg` 在他演员方位上恰好返回 360.0 时（可复现 dx=-4e-16,dz=1）发射 0，严格小于 360 的值原样发射（-5e-16/-8e-16/-1e-15 保持 359.99999999999994、+4e-16 保持微小正值、0 保持 0）。五条验收（AC-1..5）覆盖准入矩阵、方位精确与退化、优先级与 fail-closed、停止/复演生命周期、遗留冻结（全套件绿、StatusJson 字节冻结、编译器绿、Release 0 警告 0 错误、Kinds=6/SupportedExecutors=3、无线上/能力/网页变化、不部署）；保全声明只绑定 r2 受保护基线，绝不回填 r1 历史缺口。

## 机理与红基线

r1 实现已在树内且 QA 验收时 x1-other-actor 即绿，故 REG-INPUTS/REG-BEARING/REG-STOP/REG-PARITY 全部为 characterization：携带行为在新运行上重新刻画（冻结检查绿 + 评审独立击穿尝试），绝不把已取消 r1 的红记录重用为新失败证据。唯一诚实红基线是 REG-R2-RANGE（QA 冻结的真缺陷）：修复前 `x1-other-actor --red` 在 dx=-4e-16,dz=1 行发射 360 而失败，`record-red` 记录退出 1、指纹 `X1_OTHER_ACTOR_ASSERTION`（`.agent/evidence/TASK-20260911-X1-OFFLINE-OTHER-ACTOR/red/REG-R2-RANGE.{json,log}`），门禁 qualityEvidence 内重校验绑定；修复后同行恰发 0。机理：atan2 度数约 -2.29e-14，360 加该值在 double 下舍回恰 360.0，故仅在 OtherActor 分支补 `if (a == 360.0) a = 0;` 规范化。

## 改了什么、保了什么

r2 运行归因（finalMeasurement，基线哈希 a09322b…）恰 2 个在域文件 +46/-0：`src/X1FacingExecutor.cs`（+3：OtherActor 分支 only 的恰-360→0 规范化及中文注释）与 `src/tests/datalayertest/X1OtherActorTests.cs`（+43：[oa-wrap] 边界命名用例，一恰 0 行、三 359.99999999999994 行、一微小正值行、一 0 行、一有限性行）。携带的 r1 实现（5 文件 +73 行）经 global 评审对照保留的 r1 归一 diff 逐字验证仍在位。生产面零字节改动：ShowRunner/X1AbilityExecutor/X1MovementExecutor/X1ShowDispatcher/ShowValidator/ShowProtocol/EventScheduler/RuntimeGuard/ExecutionLog/Plugin/GameShowDispatcher 与 web 由 15 文件 r2 受保护基线（manifest sha256 3cf7dfb4…）在 preclaim/claim 后/修复后与两评审五次验证 PROTECTED-BASELINE-OK；StatusJson 字节冻结；ShowValidator 仍拒绝 movement/facing/ability 与两个能力名（Kinds==6、SupportedExecutors==3）；共享 NormalizeDeg 与 StageCenter/固定角/沿路径/过渡分支字节未动——同一边界几何下冻结分支仍发 360，属票据明示授权的局部修正而非一致性问题。

## 实际验证观察

- 门禁 17 项全过（v2 冻结清单一一对应）：工单校验、工作区完整性、diff-whitespace、十个 X1 命名用例（含新 x1-other-actor 与既有 inputs/clock/ability/movement/facing/stop/stage-center/transition）、status-json-freeze、datalayer 全套件、show-compiler 43/0、plugin-build Release 0 警告 0 错误、protected-preservation。
- 全套件 1404/0（携带基线 1396/0 + 8 条新 wrap 断言；x1-inputs 携带的两行 OtherActor 拒绝行收缩窄、等价覆盖在 x1-other-actor，未知枚举行在 x1-transition 原样，无弱化）。
- REG-R2-RANGE 红绿完整：红退出 1 指纹 X1_OTHER_ACTOR_ASSERTION（恰 dx=-4e-16 行失败 emitted=360），绿五检查全过。
- module 评审：独立假时钟/记录 sink 探针（自有夹具 rv-*，O=(3,-4) 非原点，循环 1e-9 比较的独立方位 oracle，临时工程编译仓库源码）52/52 通过后尝试击穿准入/方位/退化/wrap/优先级，并做断言删除变异 M1/M2/M3（各退出 1、控制组 M0 退出 0）证明新命名用例承重——not-falsified；global 评审：独立复算 gateContractHash 61d17a8c…/qualityContractHash ac3000e2…/gate 规范哈希 1252d601…、17/17 冻结项与逐项日志哈希核对、delta 从认领基线重推导（恰 2 文件 +46/-0）、r1 73 行逐字核对、四类观测失败/重入停止/跨线程停止/释放恰一次/Arm+Start 复演无残留全部击穿尝试失败——not-falsified。
- 双评审各记非阻塞 P3（如实留档）：冻结分支在同一边界仍发 360（授权局部修正，全进程严格区间若要统一需另开后续工单覆盖共享助手与全部冻结模式基线）；datalayer 套件日志在 64KB 证据上限处截断（退出码与逐用例行已证 0 失败，1404 为时戳观测值不硬编码）；r1 认领基线目录已不存在、r1 增量只能从保留证据重建（主人已处置的历史缺口，r2 链条从认领基线到当前字节哈希钉死）。

## 剩余主人尾巴与原因

六条既有主人尾巴全部原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）。REQ-SPEC-017、REQ-WP-X1 保持开放：本包只贡献离线 OtherActor 朝向（含严格区间修正）回归维度，实机适配器、校准、能力开通、部署与实机验收另行单独授权；SPEC 无勾选。环境事项（仓库外，模块记录 knownRisks 已披露）：为让新构建未签名测试二进制取得 SAC 判定，按主人指示重开 Defender MAPS/实时监控，mihomo 以热重载运行时副本加了三条最高优先级 SAC 端点规则（原配置未动、备份 sha256 ba9c0e3c…）；Verge 下次切换配置会丢弃这三条，是否持久化由主人另行决定。

## 改动文件

r2 运行归因 2 变更（见上节）。携带 r1 归因 5 文件（X1ExecutionInputs.cs、X1FacingExecutor.cs、X1ShowDispatcher.cs、X1ExecutorTests.cs、program.cs，历史归 r1 取消运行）。收口新增/更新：模块记录 `CHG-TASK-20260911-X1-OFFLINE-OTHER-ACTOR-R2.json`、本交接、backlog 行 59（生成视图）、PROCESS-STATE 台账（包 59 与 latestProductHandoff）、continuity 现状改写、工单状态 accepted→closed。产品/测试文件保持主人未提交工作树原样（不 commit/push/部署）。

收口快照：finish 后复跑 `next` 于 2026-09-11T11:45:34.963Z（complete，无不可用段；M-OWNER-CLOSEOUT/M-LIFECYCLE 的 MILESTONE_NO_NEXT/ACCEPTANCE_GAP 诊断为组合图既有状态，非本票引入）——本票已闭（closedTicket 确认），组合路由暂停在主人对 EXEC-LIVE 尾巴的决定（mode owner-tail，6 条开放尾巴阻断组合 done，无需开新角色会话）：主人实机执行或显式处置实机验收尾巴，或指示下一个 X1 离线增量交 Planner 新票；`progress --full` 为只读全量视图。
