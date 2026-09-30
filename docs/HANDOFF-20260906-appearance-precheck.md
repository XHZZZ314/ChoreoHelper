# HANDOFF — 同骨架异外观隔离预检（APPEARANCE-PRECHECK，Worker 证据包 rev5）

任务：TASK-20260906-APPEARANCE-PRECHECK（rev5，R3，standard）· Run RUN-20260906-APPEARANCE-PRECHECK-R5（新领用）· 模块 web-product。
结论先行：全新重跑，字节级复现已确认的产品缺陷——同骨架双舞者渲染与逐舞者外观绑定无关（S1/S2/S4 画布逐字节相同），次位舞者身体缺失。
路由：停止部署就绪主张，先起有界修复单；本单不修产品、不部署、不关尾。rev2 旧 run 与旧门不可复用，其证据逐文件出处保全。

## Objective and acceptance

INT-20260906-DEPLOY-ACCEPT-START 授权序列的第一步：只用合成夹具、一次性浏览器、公开 API，
在 `web/dist/ChoreoHelper/choreo-helper-app.html`（file://）上验证“同骨架不同外观双舞者”是否各自渲染。
AC-1 隔离（fixtures＋拦截计数＋产品字节不动）、AC-2 矩阵（同时渲染＋换绑定＋换位＋重载＋双对照＋截图像素比对）、
AC-3 畸形／重复／重载边界、AC-4 单次重试／中止／并发／恢复、AC-5 只路由不修复、AC-6 五张声明内 PNG 经共享 measure 计量——
证据见 `.agent/evidence/TASK-20260906-APPEARANCE-PRECHECK/`（fixtures、probe、reports 三件套）。

## Mechanism / red baseline

- rev5 领用前基线（与 QA 验收记录一致）：`pipeline-cli check` FAIL 仅两条保留项——stale rev2 CHG 修订错配（本记录已接替消除）
  ＋历史 six-track PREREQUISITE_INVERSION_RECORDED；test-pipeline-cli 162/162；test-pipeline-policy 152/152；test-library 318/0。
- 嫌疑机制（沿用 architecture-impact，非本单复现）：`choreo-edit.js planRender` 按 skeletonHash 归并母版，
  `preview3d.js buildMasters` 对已存在的母版键直接复用首个母版——P6 的同字节复用断言覆盖不了异外观，本单即为该边界量身取证。

## What changed and behavior preserved

- 产品行为零改动：web／src／scripts／SPEC 一字节未动（`git diff --check` 通过；dist 30 文件前后哈希一致 16b8b3d17…；双 live 根未碰）。
- 证据全量重跑再生（同一批工单自有路径）：夹具（字节级确定性复现）、探针、隔离清单、矩阵报告（含畸形节）、5 张截图、结论报告。
- 探针清理加固（工单自有代码，仅清理路径，观测与分类逻辑一字未改）：`kill()` 先等浏览器进程退出再重试删除一次性 profile
  （修上轮 Windows 文件锁漏删需人工善后的问题）；清理清单机制化写入矩阵（PID／路径／onlyOwned／removed＋staleSweep＋leftoversAfter=0）。
- rev2 历史证据逐文件出处保全：旧 CHG 逐字节副本 `chg-revision2-preserved.json` ＋ 全部被替换文件 SHA-256 清单
  `reports/historical-revision2-provenance.json`（含 rev2 handoff 原字节哈希）；旧 GATE×2 与旧 run 记录原样未动，不构成对本修订的批准。

## Verification actually observed

- `--isolation`：PASS（blocked=8 含 48794/48795，allowed=0，一次性前缀成立，dist 一致）。
- `--matrix`：S1 缺身体／S2 错色（与 S1 逐字节相同 172cdfa1…）／S3 错色（与 C1 逐字节相同 ee8a1f8d…，仅光圈跟人）／
  S4 缺身体（绑定恢复成功但渲染未恢复）／C1 缺身体（双红对照排除阈值假说）→ 5 项 CONFIRMED_PRODUCT_DEFECT；
  C2 异骨架双母版 PASS；57 attempts 零失败零重试。
- `--malformed-boundary`：截断中文拒绝「broken.gltf」不是有效的 glTF 文件（JSON 解析失败），零写入、他档无损
  → fixture-INCONCLUSIVE（非产品缺陷）；重复导入幂等同哈希 → PASS。
- 弹性与清理：中止演练只杀任务自有浏览器；本轮清走上轮遗留 8 个任务自有残留（1.9–2.2h），收尾该前缀目录/进程均为 0。
- AC-6 计量：五张 PNG 全部本轮重新生成，7489/7447/7447/7489/7447 共 37319B（上限 8192/张、40960 总）；
  `measure RUN-20260906-APPEARANCE-PRECHECK-R5` 零诊断——确定性渲染使 PNG 字节与上轮一致（缺陷字节级复现，非旧文件复用）。
- `pipeline-cli check`（CHG 接替后）：stale CHG 错配项消除；`git diff --check` exit 0。
- 种子：骨架 7d640d79…（101 骨）、红 90451ed2…、蓝 af97a23a…；复现命令见 reports/outcome-report.md。

## Remaining owner tails and why

- 本单不新增主人尾；路由决定在下一步：确认缺陷 → Planner 起有界修复单（含独立验收／复查），修完重跑本探针复检；
  已授权部署规划须等修复复查通过。既有 TAIL:CHARASSETS-P2-LIVE、TAIL:DUAL-MODE-ACCEPT 等不受本单影响。
- 独立复查已完成：module 与 global 双评审对同一 GATE-R5 下 APPROVE
  （`REVIEW-RUN-20260906-APPEARANCE-PRECHECK-R5-module.json`／`-global.json`，零阻塞发现）；
  run 已按 completed 收档、工单关闭，本单终结，不再有后续角色进入本证据包。

## Files changed

- 证据（工单 writeScope 内）：`fixtures/*`（再生，字节不变）、`probe-appearance-precheck.js`（清理加固）、
  `reports/appearance-matrix.json`、`reports/isolation-manifest.json`、`reports/outcome-report.md`、
  `reports/historical-revision2-provenance.json`、`reports/screenshots/*.png`×5、`chg-revision2-preserved.json`。
- 记录：`.agent/modules/web-product/changes/CHG-TASK-20260906-APPEARANCE-PRECHECK.json`（rev5，接替 stale rev2）；本 handoff。
- 产品文件 0 改动。详情与回滚见 CHG rev5。
