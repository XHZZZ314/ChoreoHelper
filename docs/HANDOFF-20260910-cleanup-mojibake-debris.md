# HANDOFF-20260910-cleanup-mojibake-debris

> 微车道收口报告（Ticket: TASK-20260910-CLEANUP-MOJIBAKE-DEBRIS / RUN-20260910-CLEANUP-MOJIBAKE-DEBRIS，已 completed，票据已 closed）。

## 本次做了什么

- 卫生微改、零行为变化：从 `web/choreo-helper-app.css` 删除音乐排练面板 CSS 块中**唯一一行**
  GBK 乱码重复注释（基线第 389 行，含 U+FFFD），保留正确的 UTF-8 注释与其余全部字节；
  `web/dist/ChoreoHelper/` 孪生文件已字节级同步（两份 sha256 均为
  `5296133c…f3181`）。CSS 规则、选择器、属性零改动。
- 删除仓库根目录 61 字节 CMD 引号事故残留文件 `' + $out + '`（未跟踪文件，
  sha256 `9398ab2d…89fb`，完整字节级出处已存档于模块记录，可按十六进制逐字节重建回滚）。
- `web/test-shell.js` 新增 2 条确定性回归断言（HYGIENE-20260910）：音乐面板 CSS
  「无乱码且唯一注释」守卫 + 根目录残留文件缺席守卫；套件 62 → 64 全绿。

## 证据

- 门禁 `GATE-RUN-20260910-CLEANUP-MOJIBAKE-DEBRIS`：3/3 必需检查通过
  （pipeline check PASS、`git diff --check` 干净、test-shell 64/64）。
- 首轮评审曾因门禁缺少度量身份字段判 REQUEST_CHANGES；Worker 完成一次受控修复
  （仅重发门禁证据，未动实现与测试）后复审
  `REVIEW-RUN-20260910-CLEANUP-MOJIBAKE-DEBRIS-module-2` 判 **APPROVE**（零阻塞发现），
  运行以 completed 收口。
- 度量：仅 4 个锁定范围文件变化（+5/−4 行），活跃用时约 5.4 分钟，均在微车道预算内；
  禁改面零写入；主人未提交的大工作树原样保留。
- 回滚方式：按模块记录中的十六进制出处逐字节重建残留文件（61 字节）并在 CSS 基线
  第 389 行回插该乱码注释行（恢复 sha256 `f19f64ed…2432c`），再删除两条卫生断言即可；无数据迁移。

## 下一步

- 仓库内孪生已就绪；两个实机 live 根目录不做本步部署，随下一次主人授权的部署顺带生效。
- 下一个包：TASK-20260909-RESOURCE-CONVERT-PROBE 草案待 QA 验收（qa-lead）。
