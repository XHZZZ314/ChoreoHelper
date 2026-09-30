# HANDOFF：简洁编舞 P1-A 离线资源关系解析器（TASK-20260916-SIMPLE-CHOREO-P1A / r4 / 尝试 2）

> 交付状态：**待验收**（尝试 2 返工 GLM5.3，自测 6/6；独立复验未执行）。本文件为交付文档，不是验收结论。
> 尝试 1 独立验收退回（AC-02/06：R1/R2/R3，另 E1 证据缺口），裁定见 `.agent/evidence/TASK-20260916-SIMPLE-CHOREO-P1A/review-attempt1/REVIEW.md`；下方"尝试 1 交付内容"描述的主体功能不变，本节之后为尝试 2 返工增量。

## 尝试 2 返工增量（review-attempt1 R1/R2/R3 + E1）

- **R1**：`PapHeaderError` 的 `info+count*40` 比较改 long 计算（`src/SkillResourceMap.cs`）——原 int 算术在 info 接近 int.MaxValue 时回绕为负、跳过比较而把坏头误判为 hit。回归夹具 `BuildOverflowInfoPap()`（info=int.MaxValue/count=1/start=66/end=98/len=98）：修复前 resolvable 假命中（红），修复后 bad-pap-header、badPapHeaders=1、reason=info+count*40>start。
- **R2**：`CanonicalJson` 全部数值改 `ToString(CultureInfo.InvariantCulture)`（rowIds、flags/startFrame/durationFrames、PAP 头五字段，含 `\u` 转义 hex）——原输出依赖 CurrentCulture，ar-SA 负号含 U+061C，字节随区域漂移且产物非法 JSON。回归：负数字段（flags=-1/startFrame=-5/PAP code=-101）在 Invariant 与 ar-SA 下序列化逐字节相同、ar-SA 产物 `JsonDocument.Parse` 成功、解析值还原，文化设置 finally 恢复。
- **R3**：五场景（S1–S5）隔离重跑断言补全——新增 `DeletedKeyZeroCalls`（被删键 TMB + 每个候选 store 的 PAP 调用数均为 0）应用于全部五场景；`ProbeCountsExact` 增加"被调用路径数=总调用数=K+N+K×N"（排除已知路径之外的额外路径与重读）；S3/S5 原先缺失的完整读取断言补齐（TMB=K′/SKLB=N/PAP=K′×N）。原有断言一条不删，F1–F8 冻结计数与全部场景快照未动。
- **E1**：尝试 2 开始前保存受保护区域 543 文件逐文件 SHA-256 清单（web 321 + .agent/tickets+.agent/runs 217 + src/Exporter/*.bak 3 + TmbResourceReferences.cs/SkillResourceReader.cs），事后重跑清单逐字节一致；两个受保护源与验收者 17:17 记录的指纹完全一致（确认"验收时点→返工时点"未变）。尝试 1 实施阶段的基线缺口如实声明不可追溯、不补造，由验收者裁定（`attempt2/before/baseline-record-attempt2.md`）。安装根与游戏目录本轮未访问。

## 验证结果（尝试 2，绝对 SDK 路径 + DOTNET_ROLL_FORWARD=Major）

| 检查 | 结果 |
|---|---|
| 红复现（修复前，测试先行）skill-resource-map-classification | 退出 1，恰 4 FAIL（R1×2+R2×2）（attempt2/red/red-r1r2-classification.log） |
| skill-resource-map-classification / -malformed / -probe-errors / -no-store-universe | 各退出 0，0 FAIL（attempt2/after/） |
| 无参数全量套件 | 退出 0，3259/0（尝试 1 基线 3250 + 新增 9：R1×3、R2×4、S3/S5 各 +1） |
| 未知命名用例 no-such-case-xyz | 退出 2，提示行恰一次 |
| dotnet build src\ChoreoHelper.csproj -c Release | 退出 0，0 警告 0 错误 |
| 受保护区域事后核对 | 543 文件与 attempt2/before 清单逐字节一致（diff 为空） |

program.cs / datalayertest.csproj 尝试 2 未改动（哈希仍为尝试 1 终态）。回退：用 attempt2/before/ 副本还原两个源文件即回尝试 1 交付态。独立复验提示词见任务合同 §4。

## 尝试 1 交付内容（主体，仍然有效）

纯插件侧只读解析模块 + 合成夹具测试，让后续自动准备能回答"每个 ActionTimeline key 在哪些候选骨架库可解析、缺在哪一步"：

- `src/SkillResourceMap.cs`：`SkillResourceMap.Build(rows, candidateCodes, tryRead)` 纯同步。
  - 输入身份：`(uint rowId, string key)` 枚举 + 固定候选 code 集合 + `Func<string, byte[]?>` seam（null=未命中 / 字节=命中 / 抛错=读取错误，三者永不同义）。空 key 行只计入 `inputCounts.emptyKeyRows`；重复 key 合并为一个条目（rowIds 按输入序）。
  - 一次 Build = 一份一致 store 快照：TMB 每唯一 key 恰 1 次；SKLB `chara/human/<code>/skeleton/base/b0001/skl_<code>b0001.sklb` 每 store 每 Build 恰 1 次（sklbStatus 为 store 级，全 Build 一致）；PAP `chara/human/<code>/animation/a0001/bt_common/<key>.pap` 每（key×store）恰 1 次无条件探测（不因 SKLB/TMB 状态门控）。
  - TMB 解析为模块自含实现（合同"本模块自行解析"条款）：条目布局、长度/数量/字符串引用校验与 C002/C010/C012/C063 Kind 语义逐条沿用 `src/TmbResourceReferences.cs` 现行口径，未修改该类；C010 flags 为其未输出的头内字段（条目偏移 +16 int32），由本模块补读。
  - PAP 头校验按 `scripts/local-skill-assets/pap_selection.py:11-13` 布局：`pap ` 魔数、len≥26、count/code/info/start/end 与 `0<count≤2048 ∧ 26≤info ∧ info+count*40≤start<end≤len`。
  - 九级分类优先级：placeholder-key → missing-tmb → unsupported-container → no-animation-phase → resolvable（命中优先于一切错误）→ no-store-universe → read-error → bad-pap-header → pattern-gap；非 resolvable 必带机器可读 reason。
  - errorCounts 事件口径：`sklbReadErrors` 按 store（不乘键数）、`papReadErrors`/`badPapHeaders` 按（key×store）；TMB 层问题不进这三个计数。
  - 数据层 seam 异常逐项隔离，永不抛出 Build；null 枚举/seam/candidateCodes 抛 ArgumentNullException（API 误用）。
  - `CanonicalJson(entry)`：per-key 条目规范序列化（固定字段序），供"同快照删键重跑逐字节相同"隔离断言。
- `src/tests/datalayertest/SkillResourceMapTests.cs`：4 个命名用例（classification 含四族、malformed、probe-errors S1/S2/S3、no-store-universe S4/S5），S1–S5 五次独立 Build、每场景对照键 + 同快照删指定键重跑的逐字节隔离 + 读取次数按剩余键数重算 + 跨场景汇总显式标注"非单批"。夹具 seam 只按路径响应（无调用序号/当前 key）。
- 接线：program.cs 命名分发 4 行 + 未知用例提示语 + 全量套件节；datalayertest.csproj 恰一行 `Compile Include`。

## 明确没做（合同非目标）

PAP/Havok 解码与关键帧提取（P1-B）；HTTP 端点/能力/配对改动；web/**；部署/安装；candidateCodes 之外（含 X02 偶数码）的路径模式结论；名字派生 PAP 探测；C002 递归跟随。游戏字节未进仓库（夹具全合成）。

## 验证结果（绝对 SDK 路径 + DOTNET_ROLL_FORWARD=Major，dotnet run 命名入口）

| 检查 | 结果 |
|---|---|
| 红基线：三命名用例实施前 | 各退出 2，输出含"未知命名用例"（before/red-baseline.log） |
| 实施前全量套件 | 退出 0，3159/0（before/full-suite-baseline.log） |
| 实施后 skill-resource-map-classification | 退出 0，0 FAIL |
| 实施后 skill-resource-map-malformed | 退出 0，0 FAIL |
| 实施后 skill-resource-map-probe-errors | 退出 0，0 FAIL |
| 实施后 skill-resource-map-no-store-universe | 退出 0，0 FAIL |
| 未知命名用例 | 退出 2，提示行恰一次 |
| 实施后全量套件 | 退出 0，3250/0（≥基线 3159，增量全为本模块） |
| dotnet build src\ChoreoHelper.csproj -c Release | 退出 0，0 警告 0 错误 |

证据目录：`.agent/evidence/TASK-20260916-SIMPLE-CHOREO-P1A/`（before/ 与 after-* 日志、两份接线 diff、final-hashes.txt）。

## 验收入口（给 Codex）

1. 读任务合同 `.agent/tasks/TASK-20260916-SIMPLE-CHOREO-P1A.md`（r4，重点：输入/输出/分类语义节 + R6 边界场景表）与本文件。
2. 复核写域：`git status` + 两份 diff（after-program.cs.diff / after-datalayertest.csproj.diff）确认无越界修改；TmbResourceReferences.cs / SkillResourceReader.cs 未动。
3. 复跑四命名用例、未知用例、全量、产品构建（命令见任务 §4）。
4. 逐 AC 核对（任务表"自测证据"列已带日志定位）；重点挑战：S1–S5 计数与场景表一致性、隔离断言的逐字节比较是否真实比较了模块自身的规范序列化输出、errorCounts 事件口径、K9 明细保留。

## 回退

删除两个新建文件、本 HANDOFF 与证据目录；用 before/ 原字节副本+SHA-256 还原 program.cs、datalayertest.csproj、PROGRESS.md（不用 git checkout——属主工作树为脏）。模块当前唯一消费者是测试 harness，产品行为零影响。
