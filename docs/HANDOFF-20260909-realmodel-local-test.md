# HANDOFF 2026-09-09 — 本地真模型补充渲染检查（presence 判定，零模型字节入库）

> 票据 `TASK-20260909-REALMODEL-LOCAL-TEST` rev2 · 运行 `RUN-20260909-REALMODEL-LOCAL-TEST` · 只加测试驱动器与证据，产品零改动。

## 目标与验收

主人要求：后续渲染测试也要用本机可用的真角色模型（不止合成夹具），且必须本地隐私优先（个人模型二进制只留本机，仅按 路径+SHA-256 哈希绑定，绝不进证据/暂存/发布/live 根）。本次以 rev2 全链执行：新增一次性驱动器 `web/test-realmodel-local.js`，用主人本机的真 Meddle 导出（`D:\choreo\model\巧克力歌剧院\巧克力歌剧院.gltf` + 配套 `.bin`）在无头 Chromium SwiftShader 下完成 presence 检查。四条 AC 全部以确定性数值证据关闭；本检查是**补充性质**，永不替代确定性修正夹具矩阵与主人有头真 GPU 复验。

## 机制 / 基线

- 本机仅找到一份真模型导出（巧克力歌剧院，2026-08-28）；其余候选（Temp model.gltf=出厂替身副本、桌面 .choreolib=真骨架+替身网格、Downloads .choreochar=小型测试包）都不是可用真模型 → 按票据定义走**单模型边界**：S1 两位舞者同用 slot1，S2 换绑为恒等变换记 SKIP（原因写入证据）。
- 模型注入走产品现成通道：内置骨架快照建档案 → `importModelSet` 整套导入（配套 bin 按 uri 原样百分号编码基名配对——产品按基名配对不解码，属工具侧桥接，不改产品）→ CDP 分块 base64 只进一次性浏览器 profile 内存，用后即删。
- 基线（改前实测）：`web/test-edit.js` 369/0、`web/test-library.js` 318/0；产品文件全程只读（preview 源/dist SHA-256 与 dist 树哈希前后一致）。
- 首次 matrix 运行暴露驱动器自身一处表达式语法错（bind 少一个 catch），guarded() 两次同指纹熔断如实中止；修复后全绿（本次运行消耗 0/1 修复预算外的自修，未触发票据熔断条件）。

## 改了什么、行为保持什么

- 新增 `web/test-realmodel-local.js`（唯一代码改动）：`--manifest-only`（清单+边界错误 exit 2）、`--matrix`（SwiftShader 渲染+数值判定，零 PNG）、`--forbidden-scan`（整文件哈希查禁）、`--resilience`（取消/并发认领/重跑一致三探针）。
- 保持：`web/preview3d.js`、dist 双子、libs、choreo-edit/library、全部 schema/协议/持久化/游戏控制面零变化；确定性修正夹具矩阵原样且仍是深潜修复的门禁；不勾 SPEC、不关任何尾巴（证据里 `complementaryOnly=true`、`closesTails=false`）；无暂存/发布/提交/推送/live 写。

## 实际观察到的验证

- 清单：真模型 哈希绑定（gltf `94edbad8…`、bin `3e3744e7…`）+ 模型侧骨架指纹 computed；四类边界（零模型/repo 内/standalone bin/缺失）各 exit 2 且 `{code,fingerprint}` 落盘、零拷贝。
- 矩阵：S1 PASS——左右区 nonBg 10813/10760px（阈值≥800），两位舞者均 `source=profile`、rigs=2、无替身回落；S2 SKIP（单模型边界）；隔离 allowedHttp=0（拦截 9 次）、dist 树哈希前后一致、双子逐字节一致。
- 禁扫：copiesFound=0、证据目录零 PNG 仅 .json；**先在观察**（非本运行造成，如实上报）：出厂替身 `model.bin` 与主人导出的 `.bin` 字节相同（repo dist 与 devPlugins live 根各一份，mtime 早于本运行、dist 哈希未变）——涉及发布物隐私姿态，由主人裁量，本票不改产品。
- 韧性：取消 exit 130 且 S1 部分证据保留、清单/成品矩阵/模型文件/dist 全部不变（Windows 三种外部 SIGINT 投递实测均为硬终止，探针以 after-S1 里程碑走同一条 cancel() 路径，平台限制已记录）；并发第二认领 exit 2 零败者状态；同输入重跑模型哈希与 PASS/SKIP/PASS 判定逐项一致（createdAt 除外），临时目录在 repo 外并已删除。
- 流程：`pipeline-cli check` PASS、`process-audit --check` 25/25、`check-ai-docs` 60/60、`git diff --check` 干净。

## 遗留主人尾巴与原因

- **TAIL:REPAIR-MISSING-BODY 不受影响**：本检查不关该尾，真 GPU 有头复验仍按 r5 handoff 命令执行。
- **给门禁的提示**：testPlan 中两条驱动器命令在未设 `CHOREO_REALMODEL_1` 时按定义 exit 2（零模型边界）；门禁会话需带 env 运行或按边界口径判定。
- **主人观察项（可选）**：出厂替身 `model.bin` 与本机真导出 `.bin` 同字节是否合意（涉及公开分发物内容），属产品决策，需另开票据。
- 其余尾巴（EXEC-LIVE、DUAL-MODE-ACCEPT、COMPAT-LIVE、ARCH2-LIVE、CHARASSETS-P2-LIVE）不变，见 CONTINUITY。

## 变更文件

- 测试：`web/test-realmodel-local.js`（新增）。
- 证据：`.agent/evidence/TASK-20260909-REALMODEL-LOCAL-TEST/{manifest,local-matrix,local-matrix.cancelled,forbidden-scan,resilience}.json`。
- 记录/文档：`.agent/modules/web-product/changes/CHG-TASK-20260909-REALMODEL-LOCAL-TEST.json`、本 handoff。
