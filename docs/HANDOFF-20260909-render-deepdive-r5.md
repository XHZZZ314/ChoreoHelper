# HANDOFF 2026-09-09 — 渲染深潜 r5：侧面保留修复（修正夹具验收）

> 票据 `TASK-20260909-RENDER-DEEPDIVE` rev5 · 运行 `RUN-20260909-RENDER-DEEPDIVE-R5` · 门 `GATE-RUN-20260909-RENDER-DEEPDIVE-R5`（23/23 通过）· module/global 双 APPROVE · 工作树收口，未部署。

## 目标与验收

r3 运行因"makeRig 强制 DoubleSide"缝被 global 评审否决而取消后，主人 2026-09-09 双选项 A 授权（INT-20260909-RENDER-R4-OWNER-DISPOSITION）：保留导入的 side/alpha/sharing，改用修正夹具验收（原始 6 片内向三角反转，其余字节不变）。r5 以全新 RUN-ID 重走完整链条：修复仅落 `web/preview3d.js`，验收 6 个材质用例与原始特征逐一相符，修正矩阵在 SwiftShader 全绿，红态可回放。五条 AC 全部以确定性证据关闭：AC-1 修正夹具与材质对照、AC-2 修正矩阵+隔离+5 张 PNG 预算、AC-3 套件与断言只增不弱、AC-4 门+度量+预算、AC-5 回滚/取消/并发/熔断演练（本 handoff 与 `r5/reports/rollback-rehearsal.json`）。

## 机制 / 红基线

诊断链（DIAGNOSIS.md + H1–H4）定位：r1 前原始 `makeRig` 蒙皮遍历只做 `frustumCulled=false`，从不改写材质 side/needsUpdate/forceSinglePass/opacity；r3 受损态遍历哈希 65af188a 强制 DoubleSide 且 BLEND 双趟、共享静态消费者 side=2、重复创建不复原。r5 修复 = 撤销该缝，`web/preview3d.js` 与 dist 双子逐字节回到原始最后已知好 blob `25e8be65`（git ce68b085），提取遍历哈希 `3d781c42` 与原始逐字节相等。红基线：修复前 `material-check.cjs --assert-orig-passes` exit 1（6 例仅 2/6 过、fsp 2/6）；修复后 exit 0（6/6 + fsp 6/6），并从认领基线 blob `fa17c5d1` 回放红态 RED-CONFIRMED（4 处不符）。

## 改了什么、行为保持什么

- 产品改动只有 3 个文件：`web/preview3d.js` 与其 dist 双子（字节复原原始 blob）+ `web/test-edit.js`（第 24 节 3→5 项等强或更强断言：遍历保义字面相等、双子逐字节一致、r5 红/蓝夹具 SHA 与 12/12 外向、原始 6/12 反绕守护）。
- 保持：订单 46 母版身份（指纹+外观内容哈希）、C1 单键、P4 命名空间/SHA-256 去重、无绑定快路径、母版数≤舞者数；`choreo-edit.js` 只读未碰；libs/DESIGN/SPEC/原始 fixtures/原始矩阵零变化；schema/协议/持久化/游戏控制面零变化。
- r5 证据树：2 个修正夹具+manifest、material-check.cjs、probe-r5.js、4 个报告 JSON（material-check/corrected-matrix/isolation/rollback-rehearsal）、5 张 PNG（共 37989B/61440B，单张最大 7645B/12288B）。

## 实际观察到的验证

- 门（gate 时点，logs-gate-r5/）：23/23 检查通过——五套 node 套件 369/318/47/93/54 全过（test-edit +2 为新增断言）、offline-verify 70+1+16、library-verify 150/0（在线环境既有竞态已知披露，末次全绿）、material-check PASS、修正矩阵 S1/S2/S3/S4/C1/C2 全 PASS（S1 右舞者 0→22480px 对比红基线）、M1 fixture-INCONCLUSIVE、M2 PASS、隔离 allowedHttp=0、双子校验 PASS、pipeline check / process-audit 25/25 / check-ai-docs 60/60 / git diff --check 全过。
- 度量：17 个范围内文件 +596/−42（预算 28/1500），活动时长约 31.6 分钟（≤85），修复尝试 0/2，二进制预算内。
- AC-5 演练（收口会话实测，一次性目录）：三文件回滚→认领基线哈希 `fa17c5d1`/`929a356c` 逐位复原、重应用→final `25e8be65`/`30c173b6` 复原、两态双子均逐字节一致；9 秒处树杀运行中的矩阵探针——dist 树/夹具/源哈希前后不变、无 corrected-matrix/isolation 结果产物；并发第二认领 exit 2 点名活动 run 且零状态变更、无败者基线；熔断第三修复 `repair-budget-exhausted`(exit 3)、第二次同指纹 `repeated-failure-fingerprint`(exit 3)、边界对照继续。
- 评审：module 与 global 双 APPROVE（绑定同一门哈希 `48024f87…`）；两级评审各 7 项独立证伪尝试全部 not-falsified。

## 遗留主人尾巴与原因

- **TAIL:REPAIR-MISSING-BODY 保持开启**：SwiftShader 全绿只证软件光栅路径；缺陷当年在真 GPU（AMD 880M D3D11）上确认，关闭条件是修复后同一矩阵在真 GPU 通过。主人有头复验命令（沿用订单 46 的 build-realgpu-probe 模式）：从冻结的 `r5/probe-r5.js` 派生有头变体（仅去掉 `--headless=new` 与 `--enable-unsafe-swiftshader`、报告改写 `r5/reports/realgpu/` 并加 GPU 渲染器取证），在真机运行 `node .agent/evidence/TASK-20260909-RENDER-DEEPDIVE/r5/<有头变体>.js --matrix`；S1/S2/S3/S4/C1/C2 全 PASS（两舞者身体像素齐、每区≥400px 且≥3x）即关尾并解锁后续部署议题。任何 SwiftShader 结果都不替代该实机验收。
- **部署保持停止**：两个 live 根仍是修复前代次 `6942f530`（mtime 2026-09-02/03），本运行零 live 写、零提交/推送/发布。未来部署单元 = `web/preview3d.js`+dist 双子作为一个双子对，随 CHARASSETS-P2-LIVE 联合会话整体搬运；r5 修正夹具与证据只留 `.agent/evidence/`，永不进 dist 或 staging。
- 其余尾巴（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE）不变，见 CONTINUITY。

## 变更文件

- 产品/测试：`web/preview3d.js`、`web/dist/ChoreoHelper/preview3d.js`、`web/test-edit.js`（均回到/停在 r5 final 态）。
- 证据（新增）：`.agent/evidence/TASK-20260909-RENDER-DEEPDIVE/r5/**`（fixtures 3、material-check.cjs、probe-r5.js、reports 4 JSON+5 PNG、rehearsal 3 输入）。
- 记录/文档：`.agent/modules/web-product/changes/CHG-TASK-20260909-RENDER-DEEPDIVE.json`（rev5）、门 `GATE-RUN-…-R5.json`、双评审 `REVIEW-RUN-…-R5-{module,global}.json`、本 handoff、`.agent/PROCESS-STATE.json`、`.agent/CONTINUITY.md`、`docs/AI-BACKLOG.md`。
