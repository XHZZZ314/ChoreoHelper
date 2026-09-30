# 交接：X1 离线失败策略（Skip 默认 + 逐事件 StopShow）TASK-20260911-X1-OFFLINE-FAILURE-POLICY

- 工单：`.agent/tickets/TASK-20260911-X1-OFFLINE-FAILURE-POLICY.json`（rev 3，R3，standard，gateContract/qualityContract v2，状态 closed，2026-09-11 收口）
- 运行：`RUN-20260911-X1-OFFLINE-FAILURE-POLICY-R3`（Worker，按 INT-20260911-X1-FAILURE-POLICY-MODULE-REPLAN 路由的新运行号；rev 2 旧运行号已取消并保全归档，不复用；2026-09-11T17:13Z finish 完成，归档 `.agent/runs/history/`）
- 本文原为 Worker 草稿，已由 Context Sync 在收口时补记门禁、评审与台账结果；台账（backlog 61 行、PROCESS-STATE、continuity）同步更新。

## 目标与验收

按主人裁定 INT-20260911-X1-FAILURE-POLICY-SEMANTICS（2026-09-11）在既有 X1 离线核心（56–60 号缝合不变）上落地失败策略语义：Skip 为准入默认（输入属性默认值翻转），StopShow 为逐事件显式选择，Wait 维持准入拒绝（中文原因含「等待」「未建」，未建）。可跳过类仅限：技能七条件不满足/未知（零提交）、朝向观测失败（保持上次角度）、移动终点容差超限（释放段，从观测位置继续）；准入拒绝、槽/分发失败与全局安全失败（守卫采集、RuntimeGuard 码、紧急停止、手动接管、卸载）在任何声明策略下永不跳过。跳过按条记录（事件标识、种类、失败类、中文原因、未知/不满足标记、showTimeMs）并进入 recentLog，`/shows/status` 附带 skip 汇总计数；dispatched 计数语义不变。五条验收（AC-1..5）见工单；修订 3 额外要求落实评审 MR-1/2/3 的有界回归与真实红绿基线。

## 机理与红基线

修订 3 承接未批准的 rev 2 实现（Skip 语义骨架已在工作树，作为 characterization 重新刻画），并修复模块评审三项缺陷（REG-REPAIR，红→绿）：

- MR-1（技能分类）：原实现按错误文本含「记录槽」与否＋对条件对象二次复扫（`IsSkippableCondition`）判定可跳过——事件标识含「记录槽」会把条件失败误判成故障，准入后变异出的非法输入（如空白 ActionId）在条件不满足时会被错误跳过。修复：`X1AbilityExecutor.TryExecute` 返回实际分支的 typed 失败类（`X1AbilityFailure`：InputInvalid/MissingCondition/MissingSink/MissingTarget/ConditionUnsatisfied/SinkRejected/SinkException）与同扫描取得的未知/不满足标记；分发器零文本匹配、零复扫，仅 `ConditionUnsatisfied` 在 Skip 下跳过。文字匹配与复扫助手删除（无残留调用方）。
- MR-2（他演员跳过早退）：原实现他演员目标观测失败按 Skip 处理时在移动循环之前 return——同窗激活移动当拍修正/到点释放全部停摆，且会掩盖移动故障（StopShow 容差超限被推迟到朝向窗结束才触发）。修复：跳过只作用于该次朝向更新（记录跳过、抑制本拍朝向输出），同一更新继续用已取得的有效自身观测推进移动修正与释放（每更新恰一次自身读取、恰一次目标读取），移动故障不被掩盖（跳过先记账、故障随后获胜）；观测回调重入停止与成功读取同口径——丢弃待报跳过，零输出零上报。
- MR-3（容差路径释放异常吞没）：原实现容差超限路径 `try { ReleaseMovement } catch {}` 吞掉释放异常，再由分发器按几何复推（`IsSkippableToleranceFailure`）分类——释放抛异常时 Skip 声明下仍会记成「跳过」。修复：`X1MovementExecutor.Update` 返回实际分支 typed 失败类（`X1MovementFailure`），容差路径释放异常以 SinkException（「记录槽异常」原因族）上报，任何策略下故障停；`Released` 短路保证释放尝试恰一次、清扫恰一次、停后零分发零输出；分发器零几何复推（助手删除）。容差内的成功路径释放异常吞没为 56–60 号已批准存量行为，按「不扩大范围」保持原样（已记入模块记录 knownRisks）。

红基线：修复前以仅用既有 API 的新行为回归行（记录槽 id、变异输入、他演员跳过＋激活/到点移动、跳过不掩故障、释放异常）跑 `-- x1-failure-policy --red`，退出 1、17 行 FAIL、指纹 `X1_FAILURE_POLICY_ASSERTION`，`record-red` 入档 `.agent/evidence/TASK-20260911-X1-OFFLINE-FAILURE-POLICY/red/REG-REPAIR.{json,log}`（evidenceHash 3da688d1…08f56）；旧 rev 2 的 red/门禁/评审证据保留为历史，不批准修订 3。

## 改了什么、保了什么

本运行认领后增量（measure 域=lockScope，4 文件 +110/-94）：`src/X1ExecutionInputs.cs`（新增两个 typed 失败类枚举）、`src/X1AbilityExecutor.cs`（typed TryExecute）、`src/X1MovementExecutor.cs`（typed Update＋容差路径释放异常上报）、`src/X1ShowDispatcher.cs`（技能 typed 分类、他演员跳过不早退、移动 typed 分类）。测试：`src/tests/datalayertest/X1FailurePolicyTests.cs`（修复回归节：6 组行为行＋技能/移动 typed 直行；存量 TryExecute 调用点适配）、`src/tests/datalayertest/X1ExecutorTests.cs`（三处调用点适配并绑定 typed 类）。rev 2 承接面（`src/ShowRunner.cs`、`src/ExecutionLog.cs`、`program.cs` 注册、四个测试文件等）保持原字节，由本票作为整体交付面收口。

行为保持：单一单调时钟、showStart+startMs、恰一次停止清扫、Arm+Start 唯一重演、重入停止抑制不变；朝向优先级/共享观测单读/共享 NormalizeDeg 严格区间/有界修正/步态数学不动；全局安全失败与准入拒绝永不策略化；生产（非 X1）GameShowDispatcher/ShowValidator/ShowProtocol/HttpServer/EventScheduler/RuntimeGuard 与线协议字节不动（Kinds=6、SupportedExecutors=3，movement/facing/ability 仍生产拒绝）；web/** 未动；SPEC 勾选无变化（REQ-SPEC-017/REQ-WP-X1 保持开放）；设计 §9 与 SPEC 行文同步（裁定引用、默认 Skip、可跳过/不可跳过类、wait 未建）为 rev 2 承接件，本次核实存在且一致，未再改动；未部署、未写 live 根、未 commit/push。

## 实际验证观察（Worker 阶段实测）

- 改前基线（承接 rev 2 代码）：datalayer 全套件 1710/0；show-compiler 43/0；plugin Release 构建 0 警告 0 错误。
- 红基线：`-- x1-failure-policy --red` 退出 1（17 FAIL 全部为新增修复行，指纹 X1_FAILURE_POLICY_ASSERTION）→ record-red 入档。
- 修复后：x1-failure-policy 0 失败（存量刻画行＋全部修复/typed 行 OK）；datalayer 全套件 1758/0（+48，无断言弱化）；show-compiler 43/0；plugin Release 构建 0 警告 0 错误；`git diff --check` 干净；`pipeline-cli.js check` PASS（修订 3 模块记录落位后）。
- 工单校验 `pipeline-cli.js ticket` PASS；preflight/claim 正常（新运行号，无锁冲突）。
- 门禁与评审（已执行）：
  - run-gate（`GATE-RUN-20260911-X1-OFFLINE-FAILURE-POLICY-R3`，2026-09-11T16:37Z）：冻结 17 项清单全部 passed（artifact/scope 3 + targeted 11 + compatibility status-json-freeze + module datalayer-suite/plugin-build + integration show-compiler-suite），evidence binding v1 完成——17 份逐项日志落盘 `.agent/evidence/TASK-20260911-X1-OFFLINE-FAILURE-POLICY/runs/RUN-20260911-X1-OFFLINE-FAILURE-POLICY-R3/logs/`，声明输入 before/after 快照一致（bindingContractHash d761e9d5…43c96）。
  - qualityEvidence v2：AC-1..AC-5 覆盖齐全；REG-SKIP/REG-PARITY 绑定绿色门禁日志，REG-REPAIR 红记录复核一致（退出 1、指纹 X1_FAILURE_POLICY_ASSERTION、log hash 3da688d1…08f56）。
  - module 评审 `REVIEW-MODULE-…-R3.json` APPROVE（CH-MODULE 反例尝试 not-falsified）；global 评审 `REVIEW-GLOBAL-…-R3.json` APPROVE（CH-GLOBAL not-falsified）；两评审绑定同一门禁（gateHash 9507f429…）。
  - finish（2026-09-11T17:13Z）：共享收口校验通过（AC 覆盖、红绿证据、每反例、模块记录引用）后归档运行；claim 后最终度量 4 文件 +110/-94（measure 域=lockScope），预算未超。

## 剩余主人尾巴与原因

六条既有主人尾巴原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）；本票不关闭任何尾巴。REQ-SPEC-017/REQ-WP-X1 保持开放：live 适配器、校准、能力开通、部署与实机验收另行单独授权；movement/facing/ability 在生产路径仍被拒绝（离线核心先行）。未部署、未 commit/push。

## 改动文件

- 产品（认领后增量）：`src/X1ExecutionInputs.cs`、`src/X1AbilityExecutor.cs`、`src/X1MovementExecutor.cs`、`src/X1ShowDispatcher.cs`
- 测试：`src/tests/datalayertest/X1FailurePolicyTests.cs`、`src/tests/datalayertest/X1ExecutorTests.cs`
- 记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260911-X1-OFFLINE-FAILURE-POLICY.json`（rev 3，覆盖 rev 2 记录；旧字节保全于 Planner 保全归档）、`.agent/modules/product-governance/changes/CHG-TASK-20260911-X1-OFFLINE-FAILURE-POLICY.json`（同前）、本交接（收口定稿）、红基线证据 `.agent/evidence/TASK-20260911-X1-OFFLINE-FAILURE-POLICY/red/REG-REPAIR.{json,log}`
- rev 2 承接面（本票整体交付，未在本运行再改）：`src/ShowRunner.cs`、`src/ExecutionLog.cs`、`src/tests/datalayertest/program.cs`、`src/tests/datalayertest/{X1StageCenterTests,X1TransitionTests,X1OtherActorTests,ShowGuardAvailabilityTests}.cs`、设计 §9 与 SPEC 行同步
