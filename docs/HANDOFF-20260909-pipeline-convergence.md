# 交接：管线收敛——真实全量进展、文档余量与累计运行提醒（PIPELINE-CONVERGENCE）

> 给主人：本次为流程-only 变更——`progress --full` 不再截断、工单/证据归属不再张冠李戴、实现文档上限 45000→60000、同一工单反复建 run 时给出非阻塞提醒；路由/审批/产品代码零改动，运行 1 的超支如实记在已取消历史里。

## 目标与验收

- 主人批准的有界方案（INT-20260909-PIPELINE-CONVERGENCE）：回音乐验证前先收敛重复流程成本；不新增管线框架。修订 2 仅把行数上限 900→1400（INT-20260910-PIPELINE-CONVERGENCE-R2-LINE-CEILING），因为运行 1 的不可变证据工件（两份失败/作废门 JSON 共 288 行）结构性超出 900，其余条款一字未动。
- 验收 AC-1..AC-7；门 GATE-RUN-20260909-PIPELINE-CONVERGENCE-02 通过 10/10；模块+全局双通道评审 APPROVE（QA 的 CV 反例矩阵全部实际尝试，均未证伪）。

## 机制与红基线

- 红基线（对照原始生产字节，不弱化修复）：QA 实测复现 `progress --full` 截断、无参进展误归首个历史已关工单、未知路由三缺陷；运行 1 原始审计 23/25（implementation 45651>45000 为已授权的 AC-3 红基线）；运行 2 聚焦基线 `check-ai-docs` 59/60 与 `check` FAIL 均恰好卡在 CHG 记录 ticketRevision=1 的过期指向（仅此一条错误，重指向修订 2 修复，零生产代码改动）。
- 运行 1（修订 1）以 +895/-29=924/900 行取消、单次修复已消耗，全额记入已取消历史 RUN-20260909-PIPELINE-CONVERGENCE，计数不重置；其遗留实现与两份门 JSON 进入运行 2 的新基线（不重计、不删除）。

## 变更与保持

- `scripts/pipeline-portfolio.js`：全量文本枚举全部可用里程碑（含未来）、场景、需求 ID 与诊断实体，缺失节如实标注、不发明数值、不再提示"运行同一命令看剩余"；八行中文摘要保持有界且省略计数准确；JSON 键/语义不变（仅既有 truncated 标记）。无参进展=全局视图（justClosed null）；未关闭工单显示中文状态、绝不称已完成；已关工单证据只取本工单关联场景或显式"暂无关联证据"。
- `scripts/pipeline-cli.js`：独立 progress 经既有 buildPortfolioNext 选择器给出已知下一角色/原因（失败给中文不可用原因，无递归/变更/第二调度器）；`next` 路由字段不变，仅附加 ownerProgress/八行 ownerSummaryZh。status/doctor 新增观察性 TICKET_RUN_ACCUMULATION 提醒：未关闭工单 ≥3 个唯一 run 或 ≥2 个取消 run 才出现（runId 去重、active 优先、冲突诊断不合并、确定性排序、遗留缺失字段显示 unknown、取消不算失败），不改路由/claim 与 finish 资格/退出码/process events（doctor --record 显式跳过它）。
- `.agent/PROCESS-STATE.json`：仅 budgets.implementationContextBytes 45000→60000 与本包生命周期行；默认上限 20000、角色预算、policy/routing 字节、台账/登记簿/owner tails 深度不变。
- 保持：产品/web/dist/release/SPEC/现网零改动；无新门阶段、无校验器扩张、无证据迁移、无指标工具、无车道资格变化、无依赖新增；五份同步文档终值 45685 字节 ≤48000（60000 上限下余 23.9%）。

## 实际验证

- 门 C1–C10 全过：check PASS（仅既有 PREREQUISITE_INVERSION_RECORDED 历史警告）、portfolio 69/69、cli 281/281、policy 336/336、process-policy 65/65、process-audit 测试 20/20、process-audit --check 25/25、check-ai-docs 60/60、git diff --check 干净；两评审全量复跑同绿。计数为时戳观测。
- 收口实测：measure 归因精确、零诊断——全 writeScope 8 文件 +279/-9（预算 24/1400 内）；核心生产脚本（pipeline-cli.js+pipeline-portfolio.js）相对 claim 基线 0/350；活跃 ~5.6/90 分钟、修复 0/1；收口后 process-audit --check 与 check-ai-docs 复跑全绿、五文档字节 45673≤48000 复核通过。

## 遗留收尾与原因

- 五条 owner tails（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE）与实验演出路径风险段原样保留，验收状态未动——均为主人实机事项，非本票范围。
- 评审 P3 观察记录在案、不阻塞：next 提示按票名朴素派生 run id（QA 已用绑定 RUN-…-02 关闭本次风险，根治属未来工单）；运行只存在于损坏历史文件的工单在台账修复前无提醒；C2 冻结度量只测 lockScope，本次以全 writeScope 补充度量补偿。人工观察（后续 3 个产品增量、5-10 次收口的预算压缩观察）按计划链接执行，非本票关闭前提。

## 文件

- `scripts/pipeline-cli.js`、`scripts/pipeline-portfolio.js`、`scripts/test-pipeline-cli.js`、`scripts/test-pipeline-portfolio.js`、`scripts/test-pipeline-policy.js`
- `.agent/PROCESS-STATE.json`、`.agent/CONTINUITY.md`、`docs/AI-BACKLOG.md`
- `.agent/modules/ai-pipeline/STATE.md`、`.agent/modules/ai-pipeline/changes/CHG-TASK-20260909-PIPELINE-CONVERGENCE.json`
- `.agent/evidence/TASK-20260909-PIPELINE-CONVERGENCE/**`（门/评审/规划与 QA 记录）
- `docs/HANDOFF-20260909-pipeline-convergence.md`
