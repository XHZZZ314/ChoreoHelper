# XAT 打包许可审查（2026-09-16）

任务：TASK-20260916-SIMPLE-CHOREO-P1B / 合同 r1 / 尝试 2（继续授权补证）。状态：待独立验收。

最新补证见 §7；尝试1完整文本和证据已保留在证据 attempt2/before/ 及原证据目录，原验证不自动覆盖本次修改。

## 1. 结论与适用范围

**总体结论：owner-legal-decision。当前不能据此公开打包 XAT，也不能把用户自装方案标为已清除许可障碍。**

XAT 自有代码的 BSD-3-Clause 许可已核实；这不等于其预编译转换器及第三方 SDK 全部获得再分发许可。主要缺口是 Havok 2014 的实际适用协议与上游授权链、FBX 2014.2.1 实际许可主体/类型与传递条件，以及发行组件清单与告知。Euler 原始代码的正面许可本次已补到，XAT 修改副本来源仍待维护者确认（§7）。它们不是“确定侵权”的结论，也不是属主一句同意即可替代权利人授权的事项。

本审查核验公开源码、构建声明、包元数据及许可文件。**未下载官方 XAT.zip，未运行/构建转换器，未安装任何组件。没有完整发行包 SBOM、恢复锁文件或全部嵌入组件的字节身份，故 AC-02 的完整发行清单仍部分待核实。** 其余 AC 的文档交付自检完成；具体计数见任务。

证据根：`.agent/evidence/TASK-20260916-SIMPLE-CHOREO-P1B/`（下称 E）。[来源索引](../.agent/evidence/TASK-20260916-SIMPLE-CHOREO-P1B/SOURCES.md)逐文件记录 URL、抓取时间、HTTP 结果和 SHA-256；`sources.jsonl` 是机器可读原记录。本文文件名均相对 E。抓取日期为 2026-09-16，精确时间见索引，不能用本文日期替代逐请求时间。

三态含义：**允许**指已查明的组件在列明条件下可用/分发，不涵盖它的其他依赖；**禁止**须有可适用的明确条款，不能以缺证代替；**需属主法律决定**表示必须补齐许可/主体/适用范围证据后决策。本文未将任何缺证组件武断判为绝对禁止。整体仍处于打包闸门未通过状态。

## 2. 上游身份、版本、发行与前置（AC-01）

| 项目 | 核验结果 | 原文/证据入口 |
|---|---|---|
| 身份 | [Etheirys/XAT](https://github.com/Etheirys/XAT)，XIV Animation Toolkit | `upstream/current-repo.html`、`upstream/README.md` |
| 当前主分支 | `3955622dba651456efbd8ecfdaf045cb0f2423c4` | 页面 `currentOid`，`identity.json`；非正式发行锁定建议 |
| 最新正式发布 | [v2026.2.10.210](https://github.com/Etheirys/XAT/releases/tag/v2026.2.10.210)，提交 `11e60de43784b3ae25bbdaf1644727f09be2f4dd` | `upstream/release.html` 标为 Latest；本文构建调查固定到该提交 |
| 顶层许可 | BSD-3-Clause，版权 Asgard 2022；main 与审查提交的 LICENSE 字节一致 | `upstream/LICENSE.md`、`upstream/main-LICENSE.md`；关键原文：`Redistribution and use in source and binary forms`；条件见 §4 |
| 官方附件 | XAT.zip（页面显示 71 MB）、XAT-Blender-Addon.zip（2.85 KB），另有 GitHub 源码 zip/tar.gz | `upstream/release-assets.html`；前两者上传时间分别为 `2026-02-10T02:11:51Z`、`02:11:54Z` |
| 附件哈希 | XAT.zip：`b861bdd32ef33ecb3b90ec3e7f91ecd9aee389234bdb2b819fcc8923ea258787`；Blender 插件：`f26d0e16a1d112a77073ec19c6647a54bd1c991698d0054b2eae6fc8f1ecee6a` | **上游页面声明值，未下载复算**，不能当本地已验哈希 |
| 运行前置 | README 明确要求 `Visual C++ Redistributable for Visual Studio 2012 x86`；其链接当前落到 Microsoft Update 4 下载页 | `upstream/README.md`、`upstream/vcredist-page.html`，未下载安装器 |
| 桌面发行 | .NET 10/WPF；发布配置 `win-x64`、`SelfContained=true`、`PublishSingleFile=true` | `upstream/XAT__XAT__XAT.csproj`、`upstream/XAT__XAT__Properties__PublishProfiles__FinalPublish.pubxml`；无需从这些配置推断用户必须另装 .NET，也不能由 `windows7.0` 推断当前 Windows 7 支持 |
| 转换器构建 | Win32、v110；Havok 2014 SDK for VS2012；FBX SDK 2014.2.1 for VS2012；分别用 `HAVOK_SDK_ROOT`、`FBX_SDK_ROOT` | `upstream/Havok__README.md`、`upstream/Havok__XATHavokInterop.vcxproj`；这些是构建前置，不等于终端用户要装两个 SDK |
| CI 发行链 | dotnet publish → publish-standalone 压缩为 XAT.zip；排除 pdb/xml；另打包 Blender。主工程复制已提交的 XATHavokInterop.exe。该 CI 未调用 Havok 重建脚本 | `upstream/.github__workflows__publish-xat.yml`、`upstream/build_xat_havok.bat`；未运行任何脚本 |

本地历史副本本会话重新可见：两处 `XAT/Lib/XATHavokInterop/XATHavokInterop.exe` 均为 11,167,232 字节，SHA-256 为 `f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2`。精确本地路径见 `local-pinned.json`，没有向外部提交路径或文件。计算的 Git blob SHA-1 为 `6d763f5b3853aca9b515f6c6d16b93ee691234ac`，与固定发行提交的 GitHub 文件页面短标识 `6d763f5` 相符；**这仅为关联线索，不是完整 blob 验证，也不证明它就是官方 XAT.zip 内的字节**。可见性只代表本会话；历史不可见记录保留，不归因于其他会话。

## 3. 组件、路径与包含层次（AC-02）

原始树页面和 `upstream-paths.json` 可复核所查目录。GitHub recursive tree API 返回 403 限流，改用固定提交的目录 HTML；没有把 API 失败当成仓库不存在。以下区分源码实物、声明链接、声明复制和未核实的发布字节。

| 组件 | 上游路径/依赖身份 | 包含依据与许可归属 |
|---|---|---|
| XAT 自有 C#/C++、转换器封装 | `XAT/XAT/`、`Havok/Source/` | 顶层 BSD-3-Clause；不扩张到第三方 SDK |
| XATHavokInterop.exe | `XAT/Lib/XATHavokInterop/XATHavokInterop.exe` | 固定提交树中存在；csproj 明确复制到输出；可含下列 SDK 代码，不能仅按 BSD 放行。只抓取 blob **网页元数据**，未抓取 exe |
| Havok SDK 头文件/源片段 | `$(HAVOK_SDK_ROOT)/Source/`，如 `Common/Base/hkBase.h`、`keycode.cxx`、`hkProductFeatures.cxx`、Animation/Serialize 等 | `HavokHeaders.hpp`、`HavokSystem.cpp` 引用；外部 SDK 输入，所查上游路径未提供对应 SDK 许可原文。不能说 XAT 仓库已随包提供整套 SDK 头文件 |
| Havok 静态/链接库 | `$(HAVOK_SDK_ROOT)/Lib/win32_vs2012_win7_noSimd/{debug,release}/` | 13 个显式链接项逐一见 §4；构建声明可证，最终 exe 每个对象的嵌入情况不可证 |
| Havok SDK 文档/示例 | 未在所查 Havok 根、ThirdParty 和 Lib 目录发现 SDK 文档/示例包 | `Havok/README.md` 是 XAT 转换器文档，不能误报成 Havok SDK 授权文档；更不能把“未发现”写成已确认整个发行包不含这些资料 |
| Autodesk FBX SDK | `$(FBX_SDK_ROOT)/include`，`lib/vs2012/x86/{debug,release}/libfbxsdk-md.lib` | vcxproj；2014.2.1 构建要求；2014 官方 LSA 见 §4，补丁版本/实际许可识别仍待证 |
| EulerAngles.h | `Havok/ThirdParty/Euler/EulerAngles.h` | 原文署名 `Ken Shoemake, 1993`；本次已追到 Graphics Gems 官方许可及代码；原始部分允许，XAT 合并/精度修改来源待确认，见§7 |
| Autoupdater.NET.Official | 1.9.2，主 csproj 直接包 | NuGet catalog 标 MIT；依赖 WebView2 ≥1.0.2592.51 |
| MaterialDesignThemes | 4.5.0，主 csproj 直接包 | MIT；MaterialDesignColors 范围 `[2.0.6,3.0.0)` |
| Serilog | 4.3.0，主 csproj 直接包 | Apache-2.0 |
| Serilog.Sinks.Debug | 3.0.0，主 csproj 直接包 | Apache-2.0；Serilog ≥4.0.0，由直接引用覆盖 |
| Serilog.Sinks.File | 7.0.0，主 csproj 直接包 | Apache-2.0；Serilog ≥4.2.0，由直接引用覆盖 |
| Fody | 6.9.3，PrivateAssets=all | MIT；构建工具，不能把包引用等同于发行携带全部工具 |
| PropertyChanged.Fody | 4.1.0，PrivateAssets=all | MIT；依赖 Fody ≥6.6.4；编织结果与工具本体分开 |
| MaterialDesignColors | 下限 2.0.6 | 查询此版本为 MIT、无后续依赖；实际恢复版本未核实，不能把下限写成发行锁定值 |
| Microsoft.Web.WebView2 SDK | 下限 1.0.2592.51 | 此版本包内 LICENSE 页面为 Microsoft BSD 三条款；不是 WebView2 **Runtime** 的许可。实际版本/原生 loader 包含情况未核实 |
| .NET 10 / WPF / 运行时第三方 | self-contained 发布隐含包含 | 保存 v10.0.0 runtime/WPF MIT 与 runtime 第三方告知作为参照；CI 为 10.0.x，实际补丁及携带第三方组件不能据此锁定 |
| VC++ 2012 x86 CRT | 运行前置；本次未见 XAT CI 打包安装器的声明 | Microsoft 官方下载页可达；适用 EULA/再分发清单未获证，不将本地现有安装器复制进仓库 |
| Blender 插件 | 独立 XAT-Blender-Addon.zip、`Blender/xat_addon` | 同仓 BSD；入口声明 Blender ≥3.0；非本次 PAP 转换器必需组件，不等于附带 Blender 本体 |

NuGet 证据为 `upstream/nuget-*.json` → `upstream/catalog-*.json`，只 GET 文本元数据，没有 restore 或 nupkg 下载。Serilog 在 net9.0 的依赖组不再列旧框架依赖；其他框架组的 DiagnosticSource、Channels、ValueTuple **不能据此断言随 net10 发行**。完整闭包以未来实际恢复/发布清单为准。本次没取得上游发布锁文件和完整 SBOM，隐藏/嵌入依赖仍属清单缺口。

## 4. 条款与两场景逐组件裁定（AC-03）

场景 A：ChoreoHelper 对外提供含该组件的产品包。场景 B：只给上游获取指引，用户自行下载并接受适用条款；我们不镜像、不代理下载、不代用户接受协议。本场景比较不是变更产品需求或启用用户自装的授权。

### 4.1 依据编号（许可证原文入口）

- **L1 BSD**：`upstream/LICENSE.md` 第 1/2/3 条：源码保留版权/条件/免责声明；二进制在随附材料重现；不得借权利人/贡献者名义背书。main 文件逐字节一致。
- **L2 Havok**：[官方网站 Terms of use](https://www.havok.com/terms-of-use/)，原件 `upstream/havok-terms.html`，辅助提取 `havok-terms.extracted.txt`；关键例外原文 `UNLESS SUCH REPRODUCTION OR REDISTRIBUTION IS EXPRESSLY PERMITTED BY THE LICENSE AGREEMENT ACCOMPANYING SUCH PRODUCTS`。这是**当前网站条款**，不能冒充 2014 SDK EULA，更不能证明上游无专门授权。真正适用 2014 SDK 协议/许可主体/可再许可权未取得，因此作缺证裁定。
- **L3 FBX**：[Autodesk 官方 FBX SDK 2014 LSA](https://damassets.autodesk.net/content/dam/autodesk/www/Company/docs/pdf/legal-notices-&-trademarks/Autodesk_FBX_SDK_2014_LSA_-_English.pdf)。`upstream/Autodesk-FBX-SDK-2014-LSA.extracted.txt` 为全部 15 页原文文本提取（非原 PDF 字节）；索引同时存原 PDF 与文本哈希，PDF 仅在内存中读取。§1.1.1–1.1.3 授予范围内开发/二进制链接及产品分发；§1.1.4–1.1.5 规定告知；§1.2/1.5 保留附加和第三方条款；§2.1.1 限制未明确授予行为。关键原文：`reproduce, distribute and sublicense free of charge or for a fee Licensee Product(s)`。不能脱离 Licensee/License Identification/地域/产品定义直接推为任何人可镜像 SDK；也不因“非商业”自动豁免。
- **L4 Euler（尝试2更新）**：XAT 文件仅署名；已取得 Graphics Gems 官方库的明确许可，原始代码允许用于产品。代码对照支持合并/精度调整的来源推断，但并非历史传递链证明；固定来源、差异与裁定边界见§7。
- **L5 MIT**：`upstream/LICENSE-MIT.html`；关键原文 `to use, copy, modify, merge, publish, distribute, sublicense, and/or sell`；保留版权和许可声明。各版本 catalog 的 licenseExpression 与此原文相连，泛用 MIT 原文不替代各包实际版权告知收集。
- **L6 Apache-2.0**：`upstream/LICENSE-Apache-2.0.html` §2/§4，允许复制与分发；须附许可、标注改动、保留适用声明与 NOTICE（若有），不授商标背书权。原文短摘 `You may reproduce and distribute copies of the Work`。
- **L7 WebView2 SDK**：`upstream/LICENSE-WebView2.html` 是 **1.0.2592.51 包内 License 页面**，要求保留版权/条件/免责声明及不得背书。该原文与 runtime 授权是两个对象。
- **L8 .NET/WPF**：`upstream/LICENSE-dotnet-runtime.txt`、`upstream/LICENSE-wpf.txt` 为 v10.0.0 MIT；`upstream/dotnet-THIRD-PARTY-NOTICES.txt` 为该标签告知集合，不能据此宣布未知 10.0.x 发行包第三方闭包已审完。
- **L9 CRT**：`upstream/vcredist-page.html` 只证官方获取来源及版本；不是已取得的再分发合同原文，缺口保留。

### 4.2 裁定表

| 组件 | 场景 A：随产品分发 | 场景 B：用户自行获取 | 依据/必须满足或补证 |
|---|---|---|---|
| XAT 自有源码/封装 | 允许（有条件） | 允许（有条件） | L1，仅自有部分；保留声明、无背书 |
| XATHavokInterop.exe 整体 | 需属主法律决定 | 需属主法律决定 | 含 SDK 的授权链未闭合，顶层 BSD 无法单独覆盖 |
| Havok SDK 头文件/源片段 | 需属主法律决定 | 需属主法律决定 | L2；核实 2014 协议与合法获取/使用范围 |
| hkBase.lib | 需属主法律决定 | 需属主法律决定 | L2，以下每一项均为 vcxproj 显式链接项 |
| hkSerialize.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkSceneData.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkVisualize.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkInternal.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkImageUtilities.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkaAnimation.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkaInternal.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkaPhysics2012Bridge.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkcdCollide.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkcdInternal.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkGeometryUtilities.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| hkCompat.lib | 需属主法律决定 | 需属主法律决定 | L2 |
| Havok SDK 文档/示例（若拟携带） | 需属主法律决定 | 需属主法律决定 | 未证随包；不能将库的潜在分发权扩大到 SDK 文档/示例 |
| FBX SDK 头文件/文档/示例本体 | 需属主法律决定 | 需属主法律决定 | L3 区分 SDK 本体与产品二进制；实际许可身份/2014.2.1 附加条款未证 |
| FBX libfbxsdk-md.lib / 所含二进制代码 | 需属主法律决定 | 需属主法律决定 | L3 有条件产品分发路径，但 ChoreoHelper/上游主体授权链和告知落实未证 |
| EulerAngles.h / 所含代码 | 原始部分允许；修改副本需属主法律决定 | 原始部分允许；修改副本需属主法律决定 | L4/§7，已补官方许可；XAT中间来源/修改权属待确认 |
| Autoupdater.NET.Official 1.9.2 | 允许（有条件） | 允许（有条件） | L5，本体 MIT；不涵盖它的依赖 |
| MaterialDesignThemes 4.5.0 | 允许（有条件） | 允许（有条件） | L5 |
| Serilog 4.3.0 | 允许（有条件） | 允许（有条件） | L6 |
| Serilog.Sinks.Debug 3.0.0 | 允许（有条件） | 允许（有条件） | L6 |
| Serilog.Sinks.File 7.0.0 | 允许（有条件） | 允许（有条件） | L6 |
| Fody 6.9.3 | 允许（有条件） | 允许（有条件） | L5；构建工具，本次未证其随包 |
| PropertyChanged.Fody 4.1.0 | 允许（有条件） | 允许（有条件） | L5；同上 |
| MaterialDesignColors 2.0.6 | 允许（有条件） | 允许（有条件） | L5；仅已核版本，实际恢复版本未证 |
| WebView2 SDK 1.0.2592.51 | 允许（有条件） | 允许（有条件） | L7；仅此 SDK，不含运行时 |
| WebView2 Runtime（若需提供） | 需属主法律决定 | 需属主法律决定 | 未证 XAT 携带；须另核运行时条款/实际使用，不能套 SDK BSD |
| .NET/WPF 自有代码（参照 v10.0.0） | 允许（有条件） | 允许（有条件） | L8；不等于未知实际 runtime 整体获准 |
| 实际 self-contained runtime 及内含第三方闭包 | 需属主法律决定 | 需属主法律决定 | L8；补丁/携带清单/对应告知未锁定 |
| VC++ 2012 x86 CRT / 安装器 | 需属主法律决定 | 需属主法律决定 | L9，官方获取指引可证，适用协议未证；B 仍由用户接受许可 |
| XAT Blender 插件自有代码 | 允许（有条件） | 允许（有条件） | L1；不包括 Blender 本体，不作为转换器必要依赖 |
| 未枚举的发布嵌入组件 | 需属主法律决定 | 需属主法律决定 | 清单不完整；不得承诺全部第三方均允许 |

场景 B 减少我们复制/再分发这些字节的行为，但不证明上游有权分发、用户获取使用符合 SDK 条款。自动下载、镜像缓存或代点接受均不属于本次定义的 B，需重新审查。P0 要求用户无需寻找/安装转换器，B 还涉及产品目标变更，未获执行授权。

## 5. 属主待决问题与回落边界（AC-04）

1. 是否要求上游/权利人提供 Havok **2014 对应版本**完整协议及可再分发/再许可证明，明确覆盖该转换器、非游戏工具用途、地域、接收者及二进制分发方式？本次未联系任何人。
2. FBX 2014 LSA 的实际 License Identification、2014.2.1 附加条款、上游与本产品的主体关系、§1.1.5 告知和第三方条件如何满足？是否有足以支持我们再分发的授权链？
3. Euler 原始部分的 Graphics Gems 正面许可已补齐；请维护者确认 XAT 修改副本来源及是否存在其他中间条款，不再重复询问原始 Graphics Gems 是否允许产品使用。
4. 是否在另行授权后取得官方发行包内容清单、完整组件版本/许可证/NOTICE、runtime 实际补丁、CRT 条款及构建来源证明？现有附件页面哈希只能用于未来校验，不能代替该审查。
5. 若考虑用户自装，是否愿意修改 P0 的零手动工具安装目标，并在明确授权链后重新定义下载/安装责任？不把该方案默认为已选路线。
6. 若上述缺口无法消除，是否启动已注册的仓内重实现路线、继续取证或暂停？**本审查不替属主选择。**

回落边界：P1-A 资源关系解析已验收，不因本许可审查被否定；保留 P0 的 unwrap → per-entry split → keyframes 转换边界。仓内重实现必须另行授权、建立合同与独立测试；不得复制未获许可的 Havok/FBX SDK、反编译转换器或把重实现自动当成法律问题已消失。若仅需解码而不需 FBX，未来设计可评估减少依赖，但本次没有证明可删除 FBX，也不改上游/仓内代码。样本覆盖、真实种族骨架兼容、耗时/空间仍须后续验证，旧运行历史不是本次测量。

**不提供可上线锁定版本建议**：结论不是 cleared。`v2026.2.10.210` + 提交 + 附件页面 SHA-256 仅为审查锚点。阶段 2 字节来源仍待属主决定：许可闭合后从官方固定发行获取并复算哈希，或另行固定本地副本且验证完整上游对应关系；可见的本地字节不豁免许可审查。阶段 2 仍须先补全 r2 写域/AC，不能直接沿用本 r1 开跑。

## 6. 证据、缺口与验证（AC-05）

- `before/` 保存任务与 PROGRESS 原始字节；`preflight.json` 记录会话、写域和新建文件原先不存在；`protected-before.json` 保存任务前 src/web 每个文件哈希，不能以脏工作树相对 HEAD 的 diff 当零改动证据。
- `SOURCES.md` / `sources.jsonl` 记录原文来源与 SHA-256；`upstream/` 保存许可证/构建/目录/包元数据文本。FBX 是 PDF 原文文本提取，明确区别于原始 PDF 字节；未伪装完整原件。Havok 2014 EULA、Euler 修改副本来源、CRT EULA及完整发行 SBOM 未取得，均保留缺口；Euler 原始部分正面许可已在尝试2补齐。
- GitHub API 403；固定提交 raw/HTML 可达。Autodesk 旧入口直接请求出现 HTTP 错误，官方许可索引经浏览工具可读，并成功提取链接的官方 2014 LSA。失败来源也记录在 sources 中。一次 git ls-remote 成功、后一次 TLS 失败；最终版本依据已保存的页面，不依赖未保存命令输出。
- 所有外部请求仅包含公开 XAT/直接依赖许可、版本和元数据 URL/抽象检索词；没有上传仓库、项目、游戏数据或私有小节。未对外发消息。
- `verification.json` 记录任务前后 src/web 清单和哈希比较、PROGRESS 仅本行变化、来源文件校验、无引入 exe/dll/zip/pdf/nupkg 等二进制及最终文档存在性；`SHA256SUMS.txt` 为交付证据文件指纹。命令入口见 `verify_delivery.py`（只读校验，只在 E 写验证结果）。
- 无产品行为变化，不运行产品单测/构建/浏览器/游戏；没有本次解码、性能、游戏效果或 live dist 更新结论。文档质量自检不能替代独立验收，也不是属主法律决定。

下一步仅为 Codex 独立验收本 r1/尝试 1 的证据、裁定边界及 AC-02 缺口，随后由属主决定法律取证/路线。保持阶段 2、P1-C 未启动。


## 7. 属主选择继续查授权后的补证（尝试2）

授权：2026-09-16 属主回复“继续查授权”。本次仍为 r1 阶段1同范围补证；不是对外发消息、下载转换器、运行、重实现或阶段2的授权。

### 7.1 Euler：原始代码许可已找到，修改副本仍保留来源边界

[Graphics Gems 官方站](https://www.realtimerendering.com/resources/GraphicsGems/)明确自称官方代码仓库，并链接 erich666/GraphicsGems。已将其源码固定到 `ca4898517a93b6b45444a9cda5fd50132694b864`；[许可原文](https://github.com/erich666/GraphicsGems/blob/ca4898517a93b6b45444a9cda5fd50132694b864/LICENSE.md)允许：`Using the code is permitted in any program, product, or library, non-commercial or commercial.` 同时禁止把代码文本冒充自己的作品转售，并保留无担保边界；不要称为“公有领域”。

证据：`attempt2/upstream/pinned-LICENSE.md`，以及同提交 `gemsiv/euler_angle/EulerAngles.h`、`EulerAngles.c`、`QuatTypes.h` 的文本副本。`attempt2/euler-header.diff`、`euler-implementation.diff` 保存与XAT审查提交的原始差异，没有用归一化制造“字节相同”。观察到宏/函数布局对应、三文件合并、float/double和数学函数精度差异、强制转换差异。**代码对照支持来源推断，不等于获得维护者的历史来源证明。**

裁定细化：Graphics Gems 原始部分在两场景均允许按许可用于产品；XAT 修改副本的中间来源/附加许可/修改权属仍请维护者确认，不能将相似度当完整授权链。它不再属于“连正面许可都找不到”的问题，Havok 仍是主要阻点。

### 7.2 Havok：公开检索未补齐许可链

上游仓内 Issues 搜索（包含已关闭记录）`license` 0项、`redistribution` 0项、`Havok` 1项；最后一项为 [#2 导出错误](https://github.com/Etheirys/XAT/issues/2)，讨论路径字符和VC++前置，未提供SDK再分发许可。原页面、查询字符串、计数及分页状态见 `attempt2/upstream/xat-issues-*.html`、`attempt2/issue-search-results.json`。这不证明未检索到的讨论或私人许可不存在。

对 Havok/Intel 官方来源的定向检索未取得可对应 XAT 构建的 Havok 2014 SDK EULA 或下游再分发授权。新抓取的当前 Havok Terms仍指向产品随附协议；其他产品、Unity集成、今天的价目表和论坛帖子不能替代2014实际协议。原文与失败请求见 `attempt2/SOURCES.md`；检索边界见 `attempt2/SEARCH-NOTES.md`。本次不从非官方SDK镜像推断授权。

**总体结论仍为 owner-legal-decision，自检仍4/5；AC-02完整发行清单仍部分待核实。** FBX许可主体/版本适用性、告知、完整发行清单也未因本次Euler补证获得放行。

### 7.3 下一步应向谁问、问什么

当前固定提交 README 的 Help 指向 [XAT 官方 Discord](https://discord.gg/KvGJCCnG8t)。先问 XAT 维护者：独立下游开发者能否把已有 `XATHavokInterop.exe` 随另一个应用公开分发，适用的 Havok 协议/许可证明是什么？如果必须自行取得Havok授权，请明确说明。先拿到这项答案，再决定是否继续打包细节。

已准备 [英文询问信](../.agent/evidence/TASK-20260916-SIMPLE-CHOREO-P1B/attempt2/MAINTAINER-INQUIRY.md)，包含FBX、组件清单和“用户自行获取”备选场景；只描述通用本地动画应用，不含私有仓库或游戏数据。**草稿未发送，也未加入Discord/创建issue。** 本任务原授权是只读调查，对外联系需属主明确授权并确定渠道/账号，或由属主自行发送。作者仅回答“XAT是BSD”不能替代SDK权利人许可；未回复不等于默许。

本次保护基线、任务前副本、差异和验证均在 `attempt2/`。原始尝试1证据不覆盖；本次验证入口为 `attempt2/verify_delivery.py`，结果为 `attempt2/verification.json`，指纹 `attempt2/SHA256SUMS.txt`。独立验收及维护者回复补证优先，未选定回落路线，未启动阶段2/P1-C。
