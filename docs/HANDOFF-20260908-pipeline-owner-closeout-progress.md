# 交接：源链接目标进展与收口八行报告（OWNER-CLOSEOUT-PROGRESS）

> 给主人：本次为流程-only 变更——新增只读目标/里程碑/工单/证据投影与 `next` 的中文八行收口报告；路由、审批与既有合同语义未变，产品代码零改动。

## 目标与验收

- 主人授权的目标可追溯性（INT-20260908-OWNER-GOAL-TRACEABILITY 落实为 TASK-20260908-OWNER-CLOSEOUT-PROGRESS 修订 3）：一次读取即可看到目标推进、里程碑缺口与剩余工单，且每次收口直接输出中文进展。
- 验收 AC-1~AC-16；红绿回归 REG-PRESENTATION、REG-INVALID、REG-REENTRY，定性回归 REG-COMPAT、REG-SCOPE；模块+全局双通道评审 APPROVE（含逐项反例尝试，均未证伪）。

## 机制与红基线

- 新增 `scripts/pipeline-portfolio.js`：校验 `.agent/portfolio-map.json`（schemaVersion 1，只存关系与验收定义：唯一 id、里程碑无环、无悬空/冲突链接、无可变进度计数器、外部读取前规范路径包含、映射只作数据从不执行），并从既有源+时钟推导一份确定性只读快照。
- 红基线（2026-09-08T15:06Z 修正轮重录，哈希绑定日志在 `.agent/evidence/TASK-20260908-OWNER-CLOSEOUT-PROGRESS/red/`）：`--case PC-PRESENTATION/PC-INVALID/PC-REENTRY` 各退出 1，指纹与工单声明一致（指纹派生缺陷已由 TASK-20260908-FINGERPRINT-BINDING 修复）。
- 确定性与失败关闭：固定输入输出逐字节相同、零写入；读取屏障发现输入字节或工单清单漂移即输出 incomplete（绝不混合 complete）；缺失/冲突源输出定位的 `SOURCE_UNRESOLVED` 并抑制计数，已有关闭保持；零批准场景的里程碑验收返回 unknown 而非空洞通过；v2 关闭需最新带日期通过门+声明评审，工单与台账矛盾即 incomplete；legacy v1 关闭保持 closed-complete。

## 变更与保持

- `pipeline-cli.js`：新增只读 `progress [--full] [<ticket>]`；`next` 结果附加 `ownerProgress` 与渲染好的中文八行 `ownerSummaryZh`（终态 `done` 亦携带），路由字段与六段 handoff 合同不变；Worker 启动提示携带四类目标简报（目标/里程碑、有界贡献、场景/证据、剩余工作），legacy 未链接工单显示 `TICKET_UNLINKED` unknown 不阻塞。
- 种子映射仅覆盖设计 §9 实体（本票、生命周期、前置、修复项 1..10、两个 M2 静态包、M3/M4/X1/after-X1、引用的未来 web 里程碑）；其余登记行保持可发现未映射，不发明场景或历史迁移。
- 保持：产品/现网/发布路径零改动；路由选择、评审通道、六段合同与字数带、门/评审证据语义、预算与熔断规则、质量收口校验器全部不变；`worker.md` 与 claim 基线逐字节一致（claim 冻结上下文，简报经生成提示交付）。

## 实际验证

- 门 `GATE-RUN-20260908-OWNER-CLOSEOUT-PROGRESS-R3`：10/10 全过（ticket、scope、portfolio、cli、policy、process-policy、process-tests、audit、process-audit、docs）。
- 套件：portfolio 43/43、CLI 258/258（基线 235/235）、policy 335/335、process-policy 65/65、test-process-audit 20/20、process-audit --check 25/25、check-ai-docs 60/60；`pipeline-cli.js check` PASS（仅既有 PREREQUISITE_INVERSION_RECORDED 警告）。计数为时戳观测。
- 评审探针复跑全绿；实仓 `progress --json` complete=true、46/46 closed-complete、零写入。
- `measure`：14 文件 +2053/-50（预算 26/2400 内）；活跃 42 分钟（预算 150 内）。

## 遗留收尾

- 里程碑缺口是主人可见性而非缺陷：M-EVIDENCE 与 M-M2-START 有未满足批准场景且无链接开放工单（诊断 MILESTONE_NO_NEXT / MILESTONE_ACCEPTANCE_GAP）——下一步 M2 增量立项或验收会话由主人选择。
- 映射路径包含仍是词法级（评审发现 4，P3 非阻塞：当前无代码路径读取映射引用字节）；已记录为后续跟进。
- 数据范围行的时间来自消费输入 mtime（读取确定性），非渲染墙钟。
- owner tails 积压 10 > 8（非致命压力警告）：合并/了结主人侧尾部前不再排队更多流程包。

## 文件

- `scripts/pipeline-portfolio.js`、`scripts/test-pipeline-portfolio.js`、`scripts/pipeline-cli.js`、`scripts/test-pipeline-cli.js`
- `.agent/portfolio-map.json`、`.agent/PIPELINE-ROUTING.json`
- `.agent/roles/planner.md`、`qa-lead.md`、`reviewer.md`、`context-sync.md`
- `docs/AI-WORKFLOW.md`、`docs/AI-PIPELINE-SOP.md`、`docs/AI-BACKLOG.md`
- `.agent/CONTINUITY.md`、`.agent/PROCESS-STATE.json`、`.agent/modules/ai-pipeline/STATE.md`
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260908-OWNER-CLOSEOUT-PROGRESS.json`、`docs/HANDOFF-20260908-pipeline-owner-closeout-progress.md`
