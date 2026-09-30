# 仓内最小解码方案可行性调查（2026-09-16）

任务：TASK-20260916-SIMPLE-CHOREO-DECODE-FEASIBILITY / r1 / 尝试 2（2026-09-17 按独立验收意见修复 D1–D4 后复验通过，AC 6/6 已验收；调查结论未变）。
证据根：`.agent/evidence/TASK-20260916-SIMPLE-CHOREO-DECODE-FEASIBILITY/`（下称 E）。本文只读调查，未实现解码器、未运行转换器、未下载任何二进制、未改 src/web/scripts。

## 0. 结论摘要

1. **格式宇宙极窄**：c0101 bt_common 全量 3253 个 PAP + 18 个种族基础 SKLB 中，unwrap 后的 Havok 载荷只有 **1 种容器头变体**、**1 种动画编码（hkaSplineCompressedAnimation，样条压缩）**、共 19 个 Havok 类名（PAP 侧；SKLB 侧另有仅 2 个 mapper 类，合计 21）。没有"格式动物园"，工作量收敛到一条窄路径：tagfile 容器 + hkaSkeleton + hkaSplineCompressedAnimation。
2. **仓库已有外围全部环节**（容器剥离、骨架匹配、编排去重、网页消费契约），**唯独缺"tagfile 载荷→关键帧"这一步**——历史上由外部 XAT exe（Havok SDK）承担。
3. **公开知识三态**：类布局与容器结构有 MIT 参考（HKX2 / TagTools）；**样条解压算法本体没有找到许可干净的公开实现**（存在 GPL-3 完整实现 HavokLib 证明其可独立实现，但不可抄入产品）。
4. **新发现第三路线（证据驱动，非选定）**：同为 MIT 的 VFXEditor/FFXIVClientStructs 证明可在**游戏进程内**调用游戏自带的 Havok 运行时做解码采样（插件模式），不分发任何 Havok 字节——与"分发 XAT"是两种完全不同的法律画像。是否可行/可接受由属主决定。
5. 不编造工期：本调查只给出可测量量与"需原型才能回答"的未知清单。

## 1. 已有能力与职责盘点（AC-1，file:line 复核）

| 环节 | 状态 | 证据（当前源码） | 覆盖边界 |
|---|---|---|---|
| PAP/SKLB 容器剥离 | 仓内已有（历史 Python） | `scripts/local-action-assets/resource_container.py:4-15`：PAP 头 `pap `(count/code/info/start/end)、SKLB 头 `blks`(v0x3132/0x3133)→切出 Havok 载荷 | **PAP 仅支持 count==1**（:8）；多 entry 会抛异常 |
| PAP 头读取（产品代码） | 已有且已验收 | `src/SkillResourceMap.cs:300` PapHeaderError、`:16` SkillResourcePapHeader(Count,Code,Info,Start,End) | 只读头帧数；**不读动画轨道** |
| 资源关系解析 | 已有且已验收 | `src/SkillResourceMap.cs:45-` Build（ActionTimeline→TMB→C010→PAP/SKLB 存在性） | 存在性+头，非内容 |
| Havok 载荷→骨架+关键帧 | **没有**（外部 XAT exe） | `scripts/local-skill-assets/prepare_bound_actions.py:104-108` 调 TOOL `addSkeleton`/`toFbxAnimation`（超时45s、哈希钉死）；模式清单见 `scripts/local-action-assets/prepare_c1201_balldance.py:98-103`（getStats/addSkeleton/toFbxAnimation/toXMLFile） | 本调查对象 |
| FBX→clip JSON | 仓内已有（历史 Python） | `scripts/local-action-assets/fbx_clip.py:59` convert（FBX 7100-7500 二进制；:53-57 欧拉→四元数，XAT EulOrdXYZs 约定） | 输入依赖 XAT 产出的 FBX |
| 骨架匹配（局部空间映射） | 仓内已有（历史 Python） | `scripts/local-skill-assets/prepare_motion.py:41-61` retarget（mappingType==1、1:1 骨名、全 target 覆盖、<1e-5）；:31-38 mappings（chainMappings 断言为0） | 链式映射未实现（P0 §3） |
| 骨架/映射的 XML 来源 | 依赖 XAT `toXMLFile` | `prepare_bound_actions.py:114` 解析 `object[@type="hkaSkeletonMapper"]`；target-skeleton.xml 是转换器产物 | 仓内没有 SKLB→XML 能力 |
| 编排/失败隔离/去重 | 仓内已有（历史 Python） | `prepare_bound_actions.py:72-130`（按源 sha256 去重、逐动作 try/except、mapper 等价性证明） | — |
| 网页剪辑消费 | 产品代码已有 | `web/choreo-engine.js:20-37`（AnimationClip 格式文档）、`:64-124`（校验）、`web/preview3d.js:53`（骨架 `{count,bones:[{i,n,p,t,q,s}]}`）、`:2039,2139`（bone_N 注册） | 见 §4 契约 |

红线重申：**"已有资源解析"不是"已有动画解码"**。仓库从未在无外部转换器条件下解出关键帧；历史"秒级/文件"测量是 XAT 子进程数据（P0 §6）。

## 2. 固定样本字节结构图（AC-2，探针 E/probe-container-structure.js）

范围：18 个奇数主种族代码（c0101–c1801）基础 SKLB 全量；c0101 `a0001/bt_common` 全部 12,359 个 ActionTimeline 唯一键中索引命中的 3,258 个 PAP 全量；外加 p0-scan 2 个历史样本交叉核对。只做容器/类名层结构识别，**未解码任何轨道值**。运行 2.1–2.2 秒，结果 `E/probe-container-result.json`、日志 `E/probe-container-run.log`。

### 2.1 PAP 容器层（全部记录通过）

- 头字段：`count/code/info/start/end`（`pap ` 魔数，偏移8起 `<hiiii>`）。
- **entry 表算术 100% 成立（0/3253 失败）**：`info + 40×count == start`；每项 32 字节名（null 结尾，多 entry 名可读，例：human_sp_zns_event.pap 的 17 个 QTE 动画名）+ 8 字节未解域（推断为子载荷偏移，未验证语义）。载荷区 `[start,end]`。
- count 分布：**0（空占位）99 个——全部是同一 32 字节**；**1（单entry）3,075 个（94.4%，含 2 个 p0-scan 本地交叉样本）**；2–17（多entry）79 个（2.4%）。unwrap 现实现只吃 count==1；多 entry 需按 entry 表扩展（结构已明）。
- 提取异常 7 个：**7 个游戏内 PAP zlib 解压失败 + 0 个本地路径错误**（wks021/wks023/wks033/pc_cnt090/s_sprint/glad_first/event_base_stand_listen2，7/3,258≈0.21%，reason 逐条在 `E/probe-container-result.json` errors，不臆断）；记录数核算：3,258 索引命中 − 7 提取失败 + 2 本地交叉样本 = 3,253。
- 尺寸：p50 27KB / p90 70KB / max 372KB；distinct 字节 2,689/3,253。

### 2.2 Havok tagfile 载荷层（unwrap 后）

- **唯一 12 字节头变体**（3,093/3,093）：`1e0db0ca ce fa 11 d0 02 06 04 28`；+12 起即明文类名区，首串恒为 `hkRootLevelContainer`。语义（版本号含义）不在本调查臆断，见 §3。
- PAP 类名签名（count==1，3,075 个）：全部为同一集合 **hkaSplineCompressedAnimation**（样条压缩，3,075/3,075=**100%**）+ hkaAnimation/hkaAnimationContainer/hkaBone/hkaMeshBinding/hkaSkeleton + hkx* 辅助类（hkxAttribute/AttributeHolder/IndexBuffer/Material/Mesha/VertexBuffer/VertexBufferVertexData/VertexDescription）+ 基类（hkRootLevelContainer(+NamedVariant)/hkReferencedObject/hkBaseObject/hkLocalFrame）。**无 interleaved/wavelet/quantized 等其他动画编码。**（结果中第 2 个 PAP 签名多出的 `hka5` 为类名前缀正则的扫描噪声 token、非真实类：3,074+1。）
- SKLB 类名签名（18 个）：同上集合；**16/18 含 hkaSkeletonMapper+hkaSkeletonMapperData**（c0101、c1701 无 mapper；与 P0 §3 的 16/18 一致）。
- 样本落盘：`E/samples/`（c0101/c1201 SKLB + 2 个代表性 PAP，共 4 文件）；全量可由探针对游戏索引复跑复现。

## 3. 公开格式知识调查（AC-3，来源副本 E/web-upstream/）

| 子集 | 三态结论 | 证据 |
|---|---|---|
| tagfile 二进制容器结构 | **部分可用** | TagTools（MIT，©2018 Skyth，`tagtools-LICENSE.txt`）：Python 独立实现 tagfile 读写与版本转换（2015/2016 ↔ ≤2012 2.0），证明容器可无 SDK 解析；但非 FFXIV 版本专用、不做动画类语义。MultiAssist（WTFPL，README:102）确认 FFXIV pap/sklb 剥头后即 Havok binary tagfile，但其 tagfile 反序列化由依赖 Havok 2014 SDK 的 exe 完成（README 依赖清单），壳许可不覆盖解码器 |
| hkaSkeleton / hkaSkeletonMapper 类布局 | **可用（MIT）** | HKX2Library（MIT）`HKX2/Autogen/hkaSplineCompressedAnimation.cs` 等 autogen 类给出完整成员布局；本调查存档该类源码（`hkx2-hkaSplineCompressedAnimation.cs`，Signature 0x792ee0bb：numFrames/numBlocks/maxFramesPerBlock/maskAndQuantizationSize/blockDuration/blockInverseDuration/frameDuration/blockOffsets/floatBlockOffsets/transformOffsets/floatOffsets/data/endian） |
| **hkaSplineCompressedAnimation 样条解压本体** | **未找到许可干净公开实现** | HavokLib（GPL-3，`havoklib-LICENSE.txt`）含完整解压器 `source/hka_spline_decompressor.cpp/.hpp`（存档头文件含 `TransformSplineBlock::GetValue(trackID,time,hkQTransform&)` 采样接口）——**证明算法可脱离 SDK 独立实现，但 GPL-3 不可抄入/链接进拟公开分发的产品**；HKX2 只到成员容器层（"actual spline decompression would happen elsewhere"）；hkxcmd（hexabits 原作，figment 镜像）能 hkx→KF：根目录 LICENSE.TXT 为 BSD（Niflib 系）且**仅覆盖原创部分**、文内声明 "hkxcmd uses Havok®"、README.txt 要求自备 Havok 2010.2 Content Tools/SDK，ExportKF.cpp 直接 include Havok SDK 头（含 `Animation/Animation/Animation/SplineCompressed/hkaSplineCompressedAnimation.h`）→ **解码路径非干净重实现**（include 清单与引文见 `E/sources.md` B 表）；hkxpack（MIT，Java）仅 TagXML 打包；hkxanim（MIT 代码）明确"输出未压缩动画"，无样条编解码 |
| 游戏内运行时采样（替代路线证据） | **可用（MIT，先例充分）** | Dalamud-VFXEditor（MIT）`PapFormat/Motion/PapMotion.cs`：通过 FFXIVClientStructs（MIT）`Havok.Animation.*` 直接调用**游戏自带 Havok 运行时**做 PAP 动画预览/glTF 导出；BlenderAssist 同模式但无许可文件。Xande（AGPL-3）同模式（AGPL 不可用，仅作存在性佐证） |

未找到 ≠ 不存在：以上是 2026-09-16 定向检索（HavokLib/HKX2/TagTools/hkxcmd/hkxpack/hkxanim/MultiAssist/Xande/VFXEditor/BlenderAssist/TagTools 作者系）的结论；逐项来源（URL+许可+覆盖面+抓取时间）与失败检索词（含 2026-09-17 复跑）均落档于 **`E/sources.md`**，上游原文副本 16 份+核验清单 1 份在 `E/web-upstream/`；不从非官方 SDK 镜像推断授权。

## 4. 网页剪辑 JSON 契约（AC-4）

消费端（`web/choreo-engine.js:20-37` 格式文档 + `:64-124` 校验；`web/preview3d.js:53` 骨架）：

```
AnimationClip = {
  name?: string, duration: 秒, type: 'once'|'loop'|'chain',
  chainNext?: string|null, chainAt?: number,
  intro?: { version:1, type:'once', duration, bones:{...} },   // 仅 loop 的 v1 起始段扩展
  bones: { ['bone_'+i]: {          // 键 = 骨架索引（preview3d.js:2039,2139 注册）
      q: [[t,x,y,z,w],...],        // 必需：父骨骼局部绝对旋转，slerp
      t: [[t,x,y,z],...],          // 可选：位移
      s: [[t,x,y,z],...] } }       // 可选：正缩放；省略时保持模型原值
}
约束：帧时间严格递增、∈[0,duration+1e-6]；四元数非零；s 分量>0；intro 仅 type=loop。
```

一例历史解码样本对照：`E2=.agent/evidence/DIRECT-20260912/c1201-candidate-review-20260912-205337-224/unit-fixtures/approved/.../goodbye-goodbye_st.json`（101 骨/303 通道）通过上述全部约束；其配套 `c1201-skeleton.json` 与 `prepare_motion.py:15-21` skeleton() 输出同形。**结论：解码目标格式无需发明，历史链产物与现行网页契约逐字段兼容。**

## 5. 四缺口结论与属主决策输入（AC-5）

### 5.1 缺口盘点

| 缺口 | 已有 | 缺 | 还需什么证据 |
|---|---|---|---|
| ① PAP 拆分 | unwrap（count==1）+ PAP 头读取（产品代码）；entry 表 40B/项布局本次 100% 实证 | count>1 的子载荷切分（8 字节未解域语义）；产品侧（C#）尚无 unwrap | 原型级：多 entry 文件按 entry 表切分的字节验证（样本已识别 79 个） |
| ② Havok 解码 | 100% 收敛为单一编码 hkaSplineCompressedAnimation；MIT 类布局（HKX2）+ GPL 完整解压器存在性证明（HavokLib） | **样条解压算法本体的许可干净实现**；tagfile 数据区对象图的 FFXIV 版本细节（头 `02 06 04 28` 语义、指针宽度、对齐） | 原型级：对 1 个样本 PAP 走通"tagfile→hkaSpline…data→关键帧"并与历史解码值比对（历史 FBX/clip 产物可作真值，见 §4 样本） |
| ③ 骨架匹配 | retarget 局部映射（mappingType==1）已实现且有等价性证明框架 | SKLB→骨架层级/参照位的仓内解析（当前靠 XAT toXMLFile 的 XML）；链式映射（P0 §3：仅类型描述符，实例未证） | 原型级：SKLB tagfile→骨名/父级/参照位，与既有 XML 真值（c0101/c1201）比对 |
| ④ 网页输出 | 契约已固定（§4）且历史产物逐字段兼容 | 无实质缺口 | 无（路径②③打通后直接套用；FBX 环节可整体跳过） |

### 5.2 可测量量（非工期）

- 目标类总数 19（PAP）+2（仅 SKLB mapper）=21；动画编码 1 种；容器头变体 1 种。
- 解码规模（c0101 主存储）：3,075 个单 entry 动画（distinct 字节 2,689），99 空占位，79 多 entry；文件 p50 27KB / max 372KB。
- 参照骨架 101 骨（c1201 fixture；c0101 亦为既有 XML 真值）。
- 每文件结构扫描成本：3,253 PAP + 18 SKLB 全量索引定位+提取+扫描 = 2.1–2.2 秒（本机，只读）。

### 5.3 需原型才能回答的未知（不臆断）

1. FFXIV tagfile 数据区对象图 walking 的精确规则（版本字段语义、指针/偏移宽度、类成员对齐）；
2. 样条块位级格式（量化掩码、子块布局、float 通道）——GPL 实现证明可解，但干净来源缺失；
3. 多 entry PAP 的 8 字节域语义；
4. 游戏内采样路线的每剪辑采样成本与国服客户端结构偏移可用性（FFXIVClientStructs 面向国际服版本）；
5. 7 个 zlib 解压失败文件成因。

### 5.4 属主选项（本调查不选择）

- **A. 游戏内 Havok 采样**（VFXEditor/FFXIVClientStructs 模式，MIT 先例）：插件进程内借游戏自带运行时解码→直接产网页剪辑 JSON。不分发 Havok 字节、绕开 P1-B 分发授权链；代价=依赖游戏内部结构（国服版本适配、游戏更新维护）、Framework 线程约束、批量采样成本未测。**需要新的授权与原型验证。**
- **B. 离线干净重实现**：tagfile 容器（TagTools MIT 参考）+ 类布局（HKX2 MIT 参考）+ 自研样条解压（无干净来源，clean-room 成本与法律边界属属主决定）。零运行时依赖、与本地优先最契合；代价=②的本体实现与验证工作量最大。
- **C. 继续等 XAT/#19**（当前主线，P1-B 阻塞中）：若获可依赖授权→阶段2测量路径。
- A/B/C 不互斥：A 的采样结果可同时充当 B 的解码真值；C 的结果影响是否仍需 A/B。

## 6. 证据、边界与验证（AC-6）

- 证据：`E/preflight.json`（会话/写域/基线哈希）、`E/before/`、`E/protected-before.json`（src/web/scripts 901 文件）、`E/sqpack-extract.js`（P0 只读提取器副本，sha256=94512bd5…，来源 /d/choreo/p0-scan-20260916/）、`E/probe-container-structure.js` + `probe-container-result.json` + `probe-container-run.log`、`E/samples/`（4 文件）、`E/sources.md`（来源记录：逐项 URL+许可+覆盖面+抓取时间+失败检索词）、`E/web-upstream/`（17 文件=16 份上游原文副本+1 份 Havok 路径核验清单，共 10 项目）、`E/SHA256SUMS.txt`、`E/verify_delivery.py`。
- 边界遵守：零 src/web/scripts 现有文件改动；游戏文件只读（索引定位/块解压在内存中，仅 4 个样本字节落盘证据目录）；外部请求仅公开仓库 README/LICENSE/源文件，未外传仓库内容/游戏数据；未运行/下载转换器或 SDK；未启动阶段2/P1-C；#19 未动（并行等待，本调查不改变其状态）。
- 验证入口：`python E/verify_delivery.py`（复算证据哈希、保护文件一致、无二进制、报告关键节存在）。

## 7. 与等待 XAT 回复的并行关系

本调查全程未触碰 #19（P1-B 证据链不动）；产出（抽样帧、网页契约、路线证据）对 XAT 放行/不放行两个方向都可复用：放行→阶段2抽样测量直接复用 §2 的存储画像与 §4 契约；不放行→A/B 路线决策直接引用 §5.4。无重复投入。
