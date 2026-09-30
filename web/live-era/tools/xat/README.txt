ChoreoHelper 内置转换工具（tools/xat）——自用说明
登记任务：TASK-20260917-SIMPLE-CHOREO-XAT-BUNDLE / 2026-09-17

【这是什么】
XAT 上游的 Havok→FBX 转换器（XATHavokInterop.exe），供 ChoreoHelper 把游戏动作文件
（PAP/SKLB 剥壳后的 Havok tagfile）转成网页剪辑 JSON。当前仅属主自用；对外分发授权
状态见 distribution-authorization.json（当前 = 未授权）。

【运行前置】
需要 Microsoft Visual C++ 2012 Redistributable (x86)：本 exe 动态链接 x86 版
MSVCP110.dll 与 MSVCR110.dll。本目录不携带这两个 DLL，缺失时 exe 无法启动。
组件、来源指针、许可边界见 COMPONENTS.txt。

【回退】
直接删除整个 tools/xat 目录即可。本目录是独立的 dist-only 工具资产：当前产品网页与
插件代码不加载、不依赖它，删除后网页应用与游戏插件行为不变。将来插件内调用编排
落地后，删除该目录会使调用方显式报“转换器缺失”，不会静默失败或崩溃。

【许可提醒（重要）】
XAT 上游自有代码为 BSD-3-Clause（LICENSE-XAT.txt），但该 exe 内嵌 Havok 2014 与
Autodesk FBX 2014.2.1 SDK 字节，公开再分发授权链未闭合
（docs/XAT-LICENSE-REVIEW-20260916.md，P1-B 结论 owner-legal-decision）。
在 distribution-authorization.json 的 status 翻转为 authorized 之前，禁止把本目录
任何字节放入公开分发物；公开打包门禁也会拒绝。
