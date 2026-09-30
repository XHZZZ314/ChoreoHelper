# 交接：X1 适配器增量 1（休眠接线）TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING

- 工单：`.agent/tickets/TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING.json`（rev 2，R3，standard，gateContract/qualityContract v2 + gateEvidenceBinding v1，状态 closed，2026-09-12 收口）
- 运行：`RUN-20260912-X1-ADAPTERS-MOVEMENT-FACING`（Worker；2026-09-11T18:32Z finish 完成，归档 `.agent/runs/history/`）
- 方向来源：主人裁定 INT-20260912-X1-ADAPTERS-DIRECTION（2026-09-12，61 号收口时登记）——下一方向为 X1 适配器，把 56–61 号已收口的离线核心接进生产分发路径；能力使能、校准与部署另行单独授权。

## 目标与验收

在冻结的离线核心（56–61 号，`X1ShowDispatcher` 语义字节不动）上交付第一个适配器增量——**休眠接线**：纯复合分发器把 X1 核心托管在生产 ShowRunner 路径上，游戏侧移动/朝向适配器把核心意图变成输入层按键状态（绝不传送、绝不写世界坐标），停止清理幂等清空全部适配器输入；同时 `ShowValidator`/`ShowProtocol`/`HttpServer` 准入字节不动（ability/movement/facing 仍被生产拒绝），已准入种类的分发与 `/shows/status` 字节一致，离线核心语义冻结。五条验收（AC-1..AC-5）见工单：AC-1 已准入种类复合/纯生产等价与幂等扇出/终态重演，AC-2 意图→输入策略映射与释放中性化，AC-3 观测 fail-closed（缺/抛/非有限/未知目标绝不编造坐标），AC-4 生产字节等价与休眠零事件，AC-5 诚实缺口（接管/移动错误检测不伪造、不虚报校准）。

## 机理与红基线

- 复合分发器 `X1CompositeShowDispatcher`（纯、无 Dalamud，进 datalayertest）：motion/cue/lyrics（含未知种防御）走生产半，ability/movement/facing 走 X1 核心；`UpdateActive` 委托 X1 核心（休眠零槽调用）；`OnShowStart`/`OnStop` 向两半扇出（先生产后 X1，任一半抛异常仍调另一半，首异常在两半都尝试后透出，ShowRunner 侧兜底）。
- 纯策略 `X1AdapterInputPolicy`（无 Dalamud）：修正向量方向保持地映射到 [-1,1] 每轴（按修正界截断，低于 1e-12 米死区即中性），角度归一到 [0,360)；非有限输入/非正修正界 fail-closed 且零状态变化；`ReleaseMovement`/`ReleaseFacing`/`ClearAll` 幂等恰一次中性化。
- 游戏绑定 `X1GameAdapters.cs`（Dalamud 绑定，不进 datalayertest，仅框架线程经 `ShowRunner.Tick`）：观测读 `IObjectTable.LocalPlayer` 位置（缺失/无效即抛，绝不编造）与对象表扫描他演员目标（未知即抛），旋转读 `LocalPlayer.Rotation`（不可用则保持上次键态）；输出仅输入层——移动状态驱动八向 WASD、目标角 5° 容差内 Q/E 转向，经 OS `keybd_event` + WalkReset 前台保护注入。该文件无 `SetPosition`/传送/世界坐标写（可 grep 证伪）。`IKeyState` 在橙月版实测无效（20260828 交接），故沿用 OS 键注入。技能槽有意留空（技能适配器是跟进包，核心无槽 fail-closed）。
- 红基线：实现前以 compiling 骨架注册两个命名套件，`record-red` 各录一次——`REG-COMPOSITE`（`-- x1-composite-dispatcher --red` 退出 1，指纹 `X1_COMPOSITE_PARITY_ASSERTION`）与 `REG-ADAPTER-POLICY`（`-- x1-adapter-policy --red` 退出 1，指纹 `X1_ADAPTER_POLICY_ASSERTION`），入档 `.agent/evidence/TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING/red/`，随后实现转绿。

## 改了什么、保了什么

本运行认领后增量（measure 域=lockScope，4 文件 +474/-1）：`src/X1CompositeShowDispatcher.cs`、`src/X1AdapterInputPolicy.cs`、`src/X1GameAdapters.cs`（三个新文件）+ `src/Plugin.cs`（仅构造接线两处：字段声明 + 复合替换纯生产半接线，守卫采集仍归生产半 `CreateGuardProvider()`）。测试：`src/tests/datalayertest/X1CompositeDispatcherTests.cs`（463 行新套件）、`X1AdapterPolicyTests.cs`（150 行新套件）、`program.cs`（+15/-1，仅用法串扩两个套件名 + 全套件调用）、`datalayertest.csproj`（+2 编译包含，仅两个纯文件进 harness）。文档：`docs/DESIGN-game-executor.md` §6 恰一个新增小节（机制、输入层合规、未验证 CN 项、诚实缺口）。

行为保持：冻结离线核心零漂移（`X1ShowDispatcher.cs` 与认领基线 blob 字节一致）；`ShowValidator`/`ShowProtocol`/`HttpServer`/`GameShowDispatcher`/`EventScheduler`/`RuntimeGuard`/`ChoreoHelper.csproj` 字节不动（X1 符号零引用，mtime 早于认领窗）；ability/movement/facing 仍 `E_KIND_UNSUPPORTED` 中文拒绝（Kinds=6、SupportedExecutors=3 不变）；`/shows/status` JSON 字节冻结；X1 束生产零事件、槽零调用；web/** 未动；SPEC 勾选无变化（REQ-SPEC-017 保持开放未勾）；未部署、未写 live 根、未 commit/push；六条主人尾巴原样。

## 实际验证观察

- 红基线：两条红记录均退出 1、指纹逐字绑定（`X1_COMPOSITE_PARITY_ASSERTION` / `X1_ADAPTER_POLICY_ASSERTION`），早于绿色实现入档。
- 门禁 `GATE-RUN-20260912-X1-ADAPTERS-MOVEMENT-FACING`（2026-09-11T18:13Z，全部 passed，9/9）：ticket-validation、workspace-integrity、diff-whitespace 干净；x1-composite-dispatcher 41 行 OK 0 失败（种类路由矩阵、已准入种类等价含 StatusJson 字节一致、幂等扇出、三终态、重演、休眠零槽、观测 fail-closed 行）；x1-adapter-policy 46 行 OK 0 失败（方向映射、限幅、死区、非有限 fail-closed、释放恰一次）；status-json-freeze 0 项失败；datalayer 全套件 1845/0（基线 1758/0，+87 新断言，零存量断言改动）；show-compiler 43/0；plugin Release 构建 0 警告 0 错误。evidence binding v1 完成：7 份声明输入 before/after 快照一致（bindingContractHash cb7e9c2c…e9e），9 份逐项日志落盘。
- qualityEvidence v2：AC-1..AC-5 覆盖齐全；REG-COMPOSITE/REG-ADAPTER-POLICY 红记录复核一致，REG-FROZEN 刻画四绿门禁绑定。
- 评审：module `APPROVE`（CH-MODULE 三条反例尝试全部 not-falsified，含复合变异 A/B 与策略符号翻转均按冻结哨兵恰一次失败；两条 P3 非阻塞发现——comp-parity 行 `>=1` 收紧与 `_gameHwnd` 刷新——均路由到跟进包，不影响本票）；global `APPROVE`（CH-GLOBAL not-falsified，独立重算门禁哈希 757c34cf…16d、认领相对增量、冻结面字节、生命周期扇出与框架线程纪律）。两评审绑定同一门禁。
- finish（2026-09-11T18:32Z）：共享收口校验通过（AC 覆盖、红绿证据、每反例、模块记录引用）后归档运行；认领后最终度量 4 文件 +474/-1，预算未超。

## 剩余主人尾巴与原因

六条既有主人尾巴原样（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE、SHOWEXEC-A-LIVE）；本票不关闭任何尾巴。REQ-SPEC-017/REQ-WP-X1 保持开放：能力使能、CN 客户端校准（OS 键显路径循环、Rotation 映射、Q/E 指派、键盘布局、1.5m 满标占位）、接管/移动错误真实信号、部署与实机验收均在后续单独授权的使能/校准包处理；休眠期间生产零 X1 事件。未部署、未 commit/push。

## 改动文件

- 产品（认领后增量）：`src/X1CompositeShowDispatcher.cs`、`src/X1AdapterInputPolicy.cs`、`src/X1GameAdapters.cs`（新增）、`src/Plugin.cs`（构造接线）
- 测试：`src/tests/datalayertest/X1CompositeDispatcherTests.cs`、`src/tests/datalayertest/X1AdapterPolicyTests.cs`（新增）、`program.cs`、`datalayertest.csproj`
- 文档：`docs/DESIGN-game-executor.md`（§6 新增小节）
- 记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING.json`、`.agent/modules/product-governance/changes/CHG-TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING.json`、门禁/评审/红基线证据 `.agent/evidence/TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING/`、运行归档 `.agent/runs/history/RUN-20260912-X1-ADAPTERS-MOVEMENT-FACING.json`、台账（backlog 62 行、PROCESS-STATE、continuity）、本交接
