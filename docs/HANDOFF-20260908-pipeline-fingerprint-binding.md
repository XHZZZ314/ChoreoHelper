# Handoff: 声明指纹绑定修复（TASK-20260908-FINGERPRINT-BINDING rev 3, Worker）

## Objective and acceptance（目标与验收）

恢复可信的声明指纹绑定：纯策略辅助 + 可执行的 record-red 调用缝，并迁移三条保留基线，
解开 M-OWNER-CLOSEOUT 在 G-OWNER-CONTROL 下的阻塞。覆盖 AC-1（绑定辅助）、AC-2（调用缝）、
AC-3（三记录指纹迁移）、AC-4（旧数据/重试/部分失败/取消/并发）、AC-5/AC-7（保留运行不受影响）、
AC-6（原运行恢复路由到后续独立 Gate 会话）。

## Mechanism / red baseline（机制与红基线）

根因：`recordRedBaselines` 只用 `normalizeFingerprint(output)`（取首个 error 关键字行并折叠数字/大小写），
从未把冻结声明供给校验；三条已存指纹均为该错误派生值，与冻结声明不一致，
但其哈希绑定的日志中声明哨兵以独立行逐字存在（24/13/6 行，各唯一）。
修前红基线（`record-red RUN-20260908-FINGERPRINT-BINDING`，均为 exit 1）：
REG-BINDING（fingerprint binding absent）、REG-CALLER（record caller binding absent）、
REG-MIGRATION（migration fingerprint mismatch），记录与哈希日志在
`.agent/evidence/TASK-20260908-FINGERPRINT-BINDING/red/`。

## What changed and behavior preserved（改动与保持）

- `scripts/pipeline-policy.js`：新增纯函数 `bindDeclaredFingerprint(declared, output)`，
  声明修整后在输出中恰为一个独立行（CRLF/LF 安全，首尾空白修整，行内空白/大小写/数字严格区分）
  时返回声明原文，否则返回确定性 issue（MISSING/INVALID/ABSENT/AMBIGUOUS）；
  无 I/O、无环境状态、不推断、不回退归一化、不硬编码哨兵串。
  一参 `normalizeFingerprint` 行为及其测试保持逐字节一致。
- `scripts/pipeline-cli.js`：`recordRedBaselines` 有冻结声明时调用绑定辅助，
  未绑定以 `QUALITY_RED_FINGERPRINT_UNBOUND` 在任何记录/日志写入前失败关闭；
  无声明 legacy 路径保持归一化；补上用法已声明但缺失的 `--regression` 参数。
- 三条保留红记录仅 `fingerprint` 字段经同一辅助重推导并写入，
  其余字段与全部日志字节不变；原文与前后哈希归档于本修复证据 `migration/`。
- 门修复（第 2 次修复尝试，见 escalation-gate-r2.json）：冻结的 preflight 门命令省略 `--run-id`，
  导致本票据自己的活跃运行被报为锁冲突；`preflight` 现仅自排除同 ticketId+同 revision 的活跃运行
  （外来运行、同票不同 revision、claim 与重叠审计全部保持失败关闭），夹具测试同步重做。
- 未动：`pipeline-gate.js`、组合/产品测试、原票据 rev 3、原运行 manifest/lock/冻结契约/哈希/日志、
  `.agent/runs/**`、共享状态与文档（并发 hold 下延后同步）。

## Verification actually observed（实际验证）

- `ticket` PASS；`git diff --check` 干净；`preflight`（无 `--run-id`）ok:true 零冲突且
  contextHash 与冻结值一致；原运行 manifest SHA-256 与 planner-evidence 受保护哈希一致，
  三条红日志与迁移后记录均与归档哈希吻合（仅 fingerprint 字段差异）。
- `test-pipeline-policy.js` 332/332（基线 317 + 8 绑定 + 7 迁移夹具）；
  `test-pipeline-cli.js` 251/251（基线 243 + 5 调用缝 + 3 门修复夹具净增，
  RUN-QUALITY/TAMPER 夹具改为噪声中字面哨兵；preflight 夹具改为外来运行承载冲突语义）。
- `pipeline-cli.js check` PASS（仅预录 PREREQUISITE_INVERSION_RECORDED 警告）；
  `check-ai-docs.js` 60/60。
- 迁移后三记录满足门读取条件：指纹/命令与声明相等、退出码在声明集合内、日志哈希相等。

## Remaining owner tails and why（剩余尾巴）

- 本修复的 module/global 评审与 Gate 仍需后续会话完成（Worker 不自批）。
- 原运行恢复是独立会话：`node scripts/pipeline-cli.js run-gate RUN-20260908-OWNER-CLOSEOUT-PROGRESS`
  加 `next` 于 TASK-20260908-OWNER-CLOSEOUT-PROGRESS，绑定新评审到新门；旧门制品保留。

## Files changed（文件）

- `scripts/pipeline-policy.js`、`scripts/test-pipeline-policy.js`
- `scripts/pipeline-cli.js`、`scripts/test-pipeline-cli.js`
- 三条红记录指纹字段、`migration/` 归档与 manifest、本模块变更记录与本文档。
