# HANDOFF — 同骨架异外观修复（APPEARANCE-DEFECT-REPAIR，rev3 收口待评审）

任务：TASK-20260907-APPEARANCE-DEFECT-REPAIR（rev3，R3，standard）· Run RUN-20260907-APPEARANCE-DEFECT-REPAIR-R3 · 模块 web-product。
结论先行：外观一半已修好并两轮像素证实（同骨架双舞者各穿各的外观，换绑定即换色）；缺身体一半按主人决定（INT-20260907-APPEARANCE-GATE-REVISION）记为已知环境限制——单权重腰方块夹具×SwiftShader 触发组合，分散权重对照双区全量像素，产品侧状态逐项正确，主人真机复核已登记为 TAIL-REPAIR-MISSING-BODY；红基线证据已可测量化（红日志 UTF-8 转换＋10 张 PNG 全部声明在额）。部署就绪继续停止。

## Objective and acceptance

rev3 有界收口：保全 rev2 已像素证实的外观修复字节；AC-1 红基线证据可测量化（10 张声明 PNG 在额内＋红日志 UTF-8 化，零 RUN_LINE_BUDGET_UNMEASURABLE）；按主人决定把缺身体一半（右区 0：S1/S2/S3/S4，C1 单体）记为已知环境限制并附分散权重对照，登记 TAIL-REPAIR-MISSING-BODY（主人真机复核）；探针拷贝复验 AC-2/AC-3/AC-4/AC-5。达成：AC-1 ✓、AC-2 ✓（S2 左蓝 6323／S3 左蓝 6066 跟绑定走，S1≠S2，bindingsIndependent=false）、AC-3 ✓（右区 0＋C1 单体＋对照双区全量按票面记录）、AC-4 ✓、AC-5 ✓、AC-6/AC-7 待 Gate＋评审收口。

## Mechanism / red baseline

- 红基线（rev2 修前，本轮逐字节保全）：S1/S2/S4 画布逐字节相同（172cdfa1…）、S3/C1 逐字节相同（ee8a1f8d…），左区红 6066、右区 0，五场景 CONFIRMED_PRODUCT_DEFECT（reports/red-baseline/）。
- 根因（外观半，已修）：`planRender` 按 skeletonHash 归并母版＋`buildMasters` 复用首个母版——同骨架异外观双舞者共用首位模型。
- 修复：`choreo-edit.js` 纯函数 `appearanceId`（内容哈希优先）＋`masterKeyFor`（指纹＋外观复合键）；`preview3d.js` `buildMasters` 按档案模型哈希富化、复合键建／复用额外母版、同档同外观复用主母版。产品字节与 rev2 完全一致（双子 d683ac6c…/25e8be65…，与 GATE 记录逐一相同）。
- 缺身体半（未修，按主人决定结为环境限制）：单权重（全顶点同取一块骨矩阵纹理元）腰方块在右侧（+1）不光栅化；分散权重对照模型同位置双区全量（左 16056／右 25050，GATE 观测裁定，本轮以哈希证同字节态）；rigs／群组／骨骼／纹理／draw／相机／视口／投影逐项正确、零 JS 异常——vendored three.js/SwiftShader 层，本票 nonGoal 禁改。

## What changed and behavior preserved

- 产品字节零新增改动（保全 rev2 修复）：`web/choreo-edit.js`、`web/preview3d.js` 与 dist 双子逐字节一致；未写任何 live 根。
- rev3 实际改动全在证据与记录面：红日志 `test-edit-red.txt` UTF-16LE→UTF-8 一次转换（e990ce62…→7491a5f3…，202/202 行，CRLF 保留；转换记录含双 SHA-256＋失败断言内容）；汇总复验记录 `reports/appearance-recheck-run2.json`；探针拷贝复验产物（matrix/isolation/5 张截图，字节级复现 rev2）；CHG 记录升 rev3；本 handoff 重写（rev2 原文与哈希存 `logs-worker/handoff-rev2-preserved.md`）。
- 行为保全：P4 命名空间／SHA-256 去重、stand-in／外来指纹／missing-clip-ns 回落与中文提示、无绑定单母版快路径、C2 行为、母版数≤舞者数 bound 全部绿证；断言无一削弱（作废形状以等价或更强覆盖重写）。
- 运行插曲：首轮领用 RUN-…-R2 取消后重领 R3——R2 的 claim 基线把红日志按 UTF-16 字节冻结，度量权威对「基线为二进制」的改动对判 UNMEASURABLE（设计行为），故转换必须先于领用；非修复消耗，R2 全部工作产物保全并原样带入 R3（见复验记录 predecessorRun）。

## Verification actually observed

- 基线（修复字节在树下复跑）：test-edit 364/0（含 h2/第 23 节异外观回归）、test-library 318/0、engine 47/0、check 93/0、shell 54/0。
- 集成本轮复跑：offline-verify workspace 70/0、clipcheck-dist 1/0、offline 16/0；library-verify all 150/0（真插件在线）。
- 探针复验（本轮，拷贝仅 EV 常量一行异于闭环原件，双 SHA-256 在案）：isolation PASS（blocked=8、allowed=0、dist 前后 2bba0c49… 不变）；S2/S3 左区颜色跟绑定走（蓝 6323/6066，≥400 且 ≥3 倍对色）、S1≠S2 画布（172cdfa1… vs 0a67f667…）、bindingsIndependent=false；S4 与 S1 同字节（重载复原即过）；C2 PASS；M1 fixture-INCONCLUSIVE；M2 PASS；S1/S2/S3/S4 右区 0、C1 单体（缺身体半按票面记录）；57 attempts 全过、清理残留 0；闭环目录树哈希 fa9ee023… 前后一致。
- 二进制预算：10 张声明 PNG（5 绿＋5 红）结构校验全过、在额内（最大 7505≤12288/张，总 74663≤122880）；截图确定性复现 rev2 字节，measure 零二进制计费。
- `pipeline-cli check` PASS（仅历史已登记 six-track 倒置警告）；`process-audit --check` 25/25（tails 9>8 为已知非阻断压力警告）；`check-ai-docs` 60/60；`git diff --check` 干净。
- R2 取消时 measure 的 1 条 UNMEASURABLE 诊断已归档于历史；R3 领用后 measure 零诊断（红日志基线即 UTF-8 文本）。

## Remaining owner tails and why

- TAIL-REPAIR-MISSING-BODY（登记于本单）：缺身体半需真机 headed Chrome（真 GPU）复核同一探针矩阵：`node .agent/evidence/TASK-20260907-APPEARANCE-DEFECT-REPAIR/probe-appearance-precheck.js --isolation --matrix --malformed-boundary`；真机通过→部署就绪评估恢复；真机同缺→Planner 开渲染管线深查单（vendored 库／渲染器设计超出本票 writeScope）。
- TAIL:CHARASSETS-P2-LIVE：继续阻塞，直至模块＋全局评审通过且缺身体尾关闭；部署仍需单独主人授权。
- 本单不新增其他尾；SPEC 复选框未动。

## Files changed

- 产品（rev2 修复字节，本轮零改动）：`web/choreo-edit.js`、`web/dist/ChoreoHelper/choreo-edit.js`、`web/preview3d.js`、`web/dist/ChoreoHelper/preview3d.js`（双子一致）。
- 测试／设计（rev2 修复字节，本轮零改动）：`web/test-edit.js`、`web/test-library.js`、`docs/DESIGN-character-assets-v1.md`（§13 一 bullet）。
- rev3 本轮新增／更新：红日志 UTF-8 转换＋`reports/red-log-utf8-conversion.json`、`reports/appearance-recheck-run2.json`、探针复验产物（matrix/isolation/screenshots）、`logs-worker/`（closed-tree 前后、probe-copy diff／哈希、dist 前后、handoff-rev2 保全）、CHG rev3、本 handoff。
