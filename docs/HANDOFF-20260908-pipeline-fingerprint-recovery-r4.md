# 交接：指纹恢复 r4 有界修复（GLOBAL-FB-3，含全局评审修正）

> 给主人：本次仅新增版本化恢复程序与隔离验证并按全局评审修正，未改现网记录与共享脚本。

## 目标与验收

- 修复归档恢复程序的写边界冲突：逐写前重验当前记录、日志/归档与 manifest/planner 授权字节，漂移拒绝且保留前缀。
- 全局评审 REQUEST_CHANGES 两项 P1（GLOBAL-FB-R4-INPUTS、GLOBAL-FB-R4-CANONICAL）已修正：授权字节逐写与完成前重验、完成只认原始清单；全部路径加真实路径包含，连接点逃逸拒绝。
- 验收 AC-1~AC-7；回归 REG-BINDING、REG-CALLER、REG-MIGRATION 定性；REG-RECOVERY 红绿；REG-PRESERVE、REG-RESUME 定性。

## 机制与红基线

- 旧程序先全量校验再批量写，写间漂移被覆盖（barrier 1/2 注入 FOREIGN_CONCURRENT_COMMAND 后仍全写成功）。
- 新红基线：`record-red RUN-20260908-FINGERPRINT-BINDING-R4 --regression REG-RECOVERY`，退出 1，指纹 `recovery write-boundary conflict absent`，日志已哈希绑定（claim 时冻结，未重录）。
- 评审修正机制：装载时绑定 manifest/planner 字节为运行授权，写间或完成前任何字节漂移（含空/重排/替换清单）立即拒绝；完成校验只遍历装载时的原始清单，替换清单不能定义“完成”。全部路径（manifest/planner/记录/日志按仓库根，归档按证据根）在预验、每写前与完成读取前做 realpath 真实路径包含，仓库内连接点指向外部即拒绝。

## 变更与保持

- `recovery-r4/recover-fingerprints-r4.cjs`：保留全量预验、归档/后像/日志绑定、逐写重读比对与写后验证；新增授权字节绑定重验与真实路径包含；完成按原始清单全量重验；原文幂等跳过；相邻比对写非原子 CAS，不声称任意写者原子性。
- `recovery-r4/verify-recovery-r4.cjs`：同程序内存/临时拷贝验证（前缀 0..3、记录漂移 1..3 含写后验证与完成扫描、日志/归档漂移、manifest/planner 授权漂移 × 屏障 1..3 × 空/重排/替换/异源、缺失/损坏/异源、取消/重试、双协作争者、真实连接点逃逸 record/log/archive/manifest/planner、旧程序仍失败、迁移指纹差、保存清单、临时目录）。
- 保持：共享脚本、迁移源、归档、现网三记录、评审探针 runs/**、OWNER-CLOSEOUT 运行与锁、历史门/评审/日志均未手改。

## 实际验证

- `ticket` PASS；`git diff --check` 干净；`preflight --role worker` ok 无冲突。
- `test-pipeline-policy.js` 335/335；`test-pipeline-cli.js` 251/251。
- `pipeline-cli.js check` PASS（已知 PREREQUISITE_INVERSION_RECORDED 警告）；`check-ai-docs.js` 60/60。
- `verify-recovery-r4.cjs` ok:true；`measure` 锁域 2 文件 +604/-0 行（预算 16 文件/800 行内）。

## 遗留收尾

- 本修复不直接恢复现网记录；现网恢复需另行明确授权。
- 本次修正需新门与双评审（模块+全局）重新绑定；全局评审旧探针不含 realpath 垫片，重验时需按新程序刷新探针。
- 原 OWNER-CLOSEOUT 运行恢复需另起独立 Deterministic Gate 会话：`node scripts/pipeline-cli.js run-gate RUN-20260908-OWNER-CLOSEOUT-PROGRESS`，再 `next TASK-20260908-OWNER-CLOSEOUT-PROGRESS`，绑定新评审。

## 文件

- `.agent/evidence/TASK-20260908-FINGERPRINT-BINDING/recovery-r4/recover-fingerprints-r4.cjs`
- `.agent/evidence/TASK-20260908-FINGERPRINT-BINDING/recovery-r4/verify-recovery-r4.cjs`
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260908-FINGERPRINT-BINDING-R4.json`
- `docs/HANDOFF-20260908-pipeline-fingerprint-recovery-r4.md`
