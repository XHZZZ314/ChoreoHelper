# 交接：X1 守卫采集不可用 fail-closed（离线守卫）TASK-20260910-X1-OFFLINE-GUARD

- 工单：`.agent/tickets/TASK-20260910-X1-OFFLINE-GUARD.json`（rev 2，R3，standard，gateContract/qualityContract v2）
- 运行：`RUN-20260910-X1-OFFLINE-GUARD`（Worker）
- 模块记录：`.agent/modules/plugin-product/changes/CHG-TASK-20260910-X1-OFFLINE-GUARD.json`
- 红基线：`.agent/evidence/TASK-20260910-X1-OFFLINE-GUARD/red/`（REG-COUNTDOWN / REG-CANCEL / REG-REPLAY，各含哈希记录与日志）

## 目标与验收

守卫采集不可用——采集器从未接入、采集抛异常、采集返回 null——曾被视为「健康」：`TickInner`
用 `snap ??= new GuardSnapshot()` 补一个默认干净快照，演出照常倒计时、照常派发（QA 在
`src/ShowRunner.cs:215-217` 确认的源码缺口）。本包把执行态（Countdown/Playing）的采集不可用
改为 fail-closed 故障停：下一个活动 Tick 直接 Faulted，先于 Countdown→Playing 转换与任何到点
分发；演中故障冻结已发前缀与日志、零进一步分发；清扫跨重复 Tick/停止恰一次；原因含「守卫采集」；
恢复采集+时钟前进绝不自动复演，显式 Arm+Start 是唯一恢复路径，输入仍不可用则再次故障。
有效快照的既有优先级/时钟/手动接管行为原样保留，六条主人尾巴原样开放，不接执行器、不动线路。

## 机理与红基线

缺口（改前 `src/ShowRunner.cs:216-217`）：`try { snap = _guardProvider?.Invoke(); } catch …` 之后
`snap ??= new GuardSnapshot()` 把「没有采集/采集坏了」一律漂白成健康快照——生产在
`src/Plugin.cs:63` 挂了采集器所以现场无感，但契约上是「输入坏了照演」，与守卫存在的意义相反。

三条红绿回归均在改产品码前用 `record-red` 记录（声明命令、退出 1、哨兵指纹逐字绑定）：

- REG-COUNTDOWN：`-- guard-availability-countdown --red` → 27 FAIL / exit 1 / GUARD_COUNTDOWN_ASSERTION
  （三种不可用形态 ×正/0 倒计时：不 Faulted、照常转换或滞留 Countdown、清扫为 0、原因缺失）。
- REG-CANCEL：`-- guard-availability-cancel --red` → 19 FAIL / exit 1 / GUARD_CANCEL_ASSERTION
  （故障帧照发同刻突发 3 条、清扫 0、OnStop 计 0）。
- REG-REPLAY：`-- guard-availability-replay --red` → 10 FAIL / exit 1 / GUARD_REPLAY_ASSERTION
  （无故障即无「恢复不复演/唯一恢复路径」可言，Faulted 断言连带失败）。

## 改了什么、保了什么

- `src/ShowRunner.cs`（产品，净 +8 行）：守卫评估前 `snap == null`（未接入/抛异常/返回 null 三形态
  同判）→ `Faulted("安全停止：守卫采集不可用")` 并返回。故障先于倒计时转换与分发；Faulted 后
  Tick 早退（恢复采集不自动复演）；`Faulted`/`RequestStop` 既有幂等保证清扫恰一次。无新线字段、
  无 OnShowStart 变化、无调度器/验证器变化。
- `src/tests/datalayertest/program.cs`：新增命名用例过滤（`-- 用例名` 只跑该节，无参数=全量套件
  一条不删）与 `--red` 模式（同一批断言、抑制 OK 行，失败打印哨兵行恰一次并退出 1）；
  SHOWEXEC-DIAGNOSIS D 节 StatusJson 冻结断言原文移入 `ShowGuardAvailabilityTests.cs`
  （`status-json-freeze` 命名用例与全量套件共用一份）；11 处夹具构造显式挂健康采集
  （fail-closed 后夹具不再依赖「漂白」行为），r2 原有显式采集不变。
- `src/tests/datalayertest/ShowGuardAvailabilityTests.cs`（新）：AC-1/2/3 三条命名回归 +
  status-json-freeze 共用断言 + ManualTakeover（倒计时/演中）与 OnShowStart（Arm 不调、Start 恰一次）
  特性化；采集抛异常/返回 null 形态、0 倒计时边界帧、同刻突发、OnStop 抛异常变体、
  RequestStop/SetGuardProvider/Tick 全 6 种串行排列全覆盖。纯假时钟+记录型执行器，无线程无 sleep。

保持不动：`RuntimeGuard`、`GameShowDispatcher`、`Plugin`、`ShowValidator`、调度器、协议/HTTP 层、
web、pose 子系统、全部禁止路径；movement/facing/ability 仍被 ShowValidator 拒绝；StatusJson 冻结
基线逐字节不变；SPEC/路线图无勾选变化；未部署、未提交。

## 实际观测到的验证

- 改前基线：全量套件 647/0 exit 0；`dotnet build src/ChoreoHelper.csproj -c Release --no-incremental`
  0 警告 0 错误；`git grep SetGuardProvider -- src/Plugin.cs` 非空（:63）。
- 红：record-red ×3（见上，记录含命令/退出/指纹/日志哈希，落 `.agent/evidence/…/red/`）。
- 绿：四个命名用例（guard-availability-countdown / -cancel / -replay / status-json-freeze）各 exit 0；
  全量无过滤 801/0 exit 0（647 既有断言一条不少 + 154 新增）；插件 Release 构建重跑 0 警告 0 错误；
  接线 grep 非空；`pipeline-cli check` PASS；`git diff --check` 干净；measure：3 文件 +407/−22
  （预算 20 文件/1000 行内）。
- 已知既有噪声（非本包引入）：datalayertest 对 `RuntimeGuard.Evaluate(null)`（program.cs 既有断言）
  有一条 CS8625 可空性警告，改前即存在，不影响退出码。

## 剩余主人尾巴与原因

六条主人尾巴（EXEC-LIVE / DUAL-MODE-ACCEPT / COMPAT-LIVE / ARCH2-LIVE / CHARASSETS-P2-LIVE /
SHOWEXEC-A-LIVE）原样保留，全部 owner-bound；本包是离线证据（假时钟+记录型执行器），不替代任何
实机验收，不部署 DLL，不启用执行器；ManualTakeover=true 是离线注入的取消控制，不是真实输入检测
证据（nonGoals 原文）。X1 执行线仍被 TAIL:SHOWEXEC-A-LIVE 等实机尾巴把守。

## 文件清单

- `src/ShowRunner.cs` — 产品改动：执行态守卫采集 fail-closed
- `src/tests/datalayertest/program.cs` — 命名用例过滤 + --red；夹具显式健康采集；D 节移出
- `src/tests/datalayertest/ShowGuardAvailabilityTests.cs` — 新增：三条守卫回归 + 冻结/特性化断言
- `.agent/evidence/TASK-20260910-X1-OFFLINE-GUARD/red/` — 三条红基线记录与日志（机器写入）
- `.agent/modules/plugin-product/changes/CHG-TASK-20260910-X1-OFFLINE-GUARD.json` — 模块记录
- `docs/AI-BACKLOG.md`、`.agent/PROCESS-STATE.json`、`.agent/CONTINUITY.md` — 收口登记
