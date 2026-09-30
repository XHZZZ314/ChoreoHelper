# 交接：X1 离线独立朝向舞台中心（r2 证据恢复）TASK-20260911-X1-OFFLINE-STAGE-CENTER

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-STAGE-CENTER.json`（rev 2，R3，standard，gateContract/qualityContract v2）
- 运行：`RUN-20260911-X1-OFFLINE-STAGE-CENTER-R2`（Worker，已完成入历史；r1 按主人 2026-09-11 决定取消，见 `.agent/evidence/TASK-20260911-X1-OFFLINE-STAGE-CENTER/owner-r2-decision.md`）
- 门禁：`.agent/evidence/TASK-20260911-X1-OFFLINE-STAGE-CENTER/runs/RUN-20260911-X1-OFFLINE-STAGE-CENTER-R2/gate.json`（15 项全过，证据哈希入档）
- 评审：module + global 均 APPROVE，反例 CH-MODULE / CH-GLOBAL 均 not-falsified
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-STAGE-CENTER-R2.json`

## 目标与验收

主人 2026-09-11 指示按证据从已关闭执行器工单的非目标中选取下一个离线增量，Planner 只选 StageCenter。目标：给纯离线核心补上「面向显式舞台中心」的独立朝向事件——舞台本地中心 x/z 显式给定，结合既有单演员观测提供者、ShowRunner 时钟、朝向优先级与 fail-closed 停演生命周期。六条验收（AC-1..6）覆盖：仅准入显式有限中心（缺轴/NaN/Infinity/混合演员/未定义枚举/skip/wait/transition/other-actor/原始曲线全拒绝，无隐含 (0,0)，中心入场即快照拷贝）；方位角取自观测位置（四象限 0/90/180/270/45°，1e-9 内，归一化 [0,360)，近重合驻留，导出溢出拒绝）；与固定角/沿路/移动切向的优先级与单次共享观测；观测缺失/抛出/非有限/重入停止与朝向 sink 抛出全 fail-closed；停止/守卫/复演/释放恰一次语义；遗留行为与冻结字节不变。本 r2 是证据恢复：r1 已实现的 StageCenter 代码原样结转、零产品字节改动，r1 历史字节保全按主人裁定视为不可得且不批准，r2 证据仅限认领前 34 文件保护基线快照 + 新鲜门禁与双评审。

## 机理与红基线

六条回归（REG-INPUTS/GEOMETRY/PRECEDENCE/FAILURE/STOP/PARITY）全部 characterization：r2 结转已存在的实现与测试，改前无产品字节变更，不存在可伪造的红基线；按工单冻结把既有行为断言作为新鲜特征化重跑并独立复核结转 diff，r1 旧日志仅作历史开发证据、不冒充红。保护基线（34 文件清单 + 内容包 + 逐文件哈希）在认领前、门禁后与两次评审各验证一次，全部 `PROTECTED-BASELINE-OK 34 files`；r1 历史缺口如实保留，从不声称 r1 历史字节证明。

## 改了什么、保了什么

r2 零产品字节变更：`src/X1ExecutionInputs.cs`、`src/X1FacingExecutor.cs`、`src/X1ShowDispatcher.cs` 与三个测试文件（`X1ExecutorTests.cs`、`X1StageCenterTests.cs`、`program.cs`）均为 r1 结转、本运行逐字节未动。结转的行为语义（全部重新特征化冻结）：StageCenter 输入需显式有限中心两轴、构造前拒绝且零 sink 调用、中心快照拷贝防改向；方位角 `atan2(dx,dz)`（0=+Z，[0,360)），两轴差均 <1e-12 时驻留自身上次角度或首发前不发；每次更新至多读取一次观测提供者且移动纠偏与 StageCenter 共用同一快照；最新开始独立胜出、同开始按 event id、独立压过移动切向、[start,end) 生命周期；观测/释放故障按 event id + 中文原因走不变 runner 停演，重入 RequestStop 截断本更新剩余输出，释放逐项恰一次；显式 Arm+Start 是唯一复演且新同开始事件无旧角度残留。新增仅运行自有证据：`r2/verify-protected.cjs` 保护基线校验器与认领前比对记录。

保持不动：ShowRunner/ShowValidator/GameShowDispatcher/EventScheduler/RuntimeGuard/ExecutionLog/Plugin/Http/协议/web/姿态子系统与全部禁止路径；ShowValidator 仍拒绝 movement/facing/ability 事件与两个能力名（Kinds==6、SupportedExecutors==3）；无新线字段、无生产 X1 激活、无隐含中心、无校准、未部署。

## 实际验证观察

- 门禁 15 项全过：工单校验、工作区完整性、diff-whitespace、七个 X1 命名用例（含 x1-stage-center）、status-json-freeze、datalayer 全套件 1175/0、show-compiler 43/0、Release 构建 0 警告 0 错误、保护基线校验 `PROTECTED-BASELINE-OK 34 files`。
- 特征化全绿：x1-stage-center 0 失败（输入矩阵/四象限几何/优先级共享观测/故障/停止复演全覆盖）；`--red` 与绿模式同一批断言；未知用例名仍退出 2。
- module 评审：独立假时钟/记录 sink 探针（65/0）尝试击穿准入、快照、单次读取、同快照共用、抑制与精确过期，另做断言变异验证失败命令非零退出，not-falsified。
- global 评审：独立复算两个契约哈希、15/15 冻结项逐一核对、r1 结转 delta 对恢复基线十块全部重哈希重推导（仅 StageCenter 范围新增）、测量归因 0 文件 +0/-0 行印证零产品字节、保护基线复核 OK，not-falsified。唯一发现为 P3 非阻塞环境项：本机应用程序控制策略拦新建 .NET 探针程序集执行（FileLoadException 0x800711C7，8 次确定性重试均拦），评审改用门禁产物现行源二进制复跑 + 结构化源码核查替代，无保证缺口；后续角色在本机构建新探针前先确认可执行。
- `git diff --check` 干净；measure 归因 0 个在域内文件变更。

## 剩余主人尾巴与原因

六条既有主人尾巴全部原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）。REQ-SPEC-017、REQ-WP-X1 与 S-X1-1 保持开放：本包只贡献离线 StageCenter 回归维度，实机适配器、校准、能力开通、部署与全部实机验收另行单独授权。策略上限恢复决定仍待主人。r1 历史字节保全不可得（主人已裁定），此缺口随本记录存档。

## 改动文件

r2 运行归因零产品文件；新增仅运行自有证据与收口文档：`r2/verify-protected.cjs`、`r2/pre-claim-comparison-*.json`、模块记录 `CHG-TASK-20260911-X1-OFFLINE-STAGE-CENTER-R2.json`、本交接、backlog 行 57 与 PROCESS-STATE 台账登记、continuity 现状改写。结转的 StageCenter 产品/测试文件保持主人未提交工作树原样（不 commit/push/部署）。

收口快照：`next` 快照 2026-09-11T04:31:03.208Z（complete，无不可用段）——工单已闭，组合路由停于 owner-tail（六尾巴待主人处置，未到 `done`），`progress --full` 为只读全量视图；本票在组合图中暂无关联证据条目（快照如实标注 unavailable）。
