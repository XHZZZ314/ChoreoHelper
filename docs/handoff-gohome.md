# ChoreoHelper v3 · 回家完整行动手册

> 自包含执行路径：装环境 → 校准 PapParser → 确认模型导出 → 出角色包 → 网页看到真实角色跳真实动作。
> 每步都有成功判据；失败有处理。不依赖任何 AI 临时商量。2026-08-25

## 先决条件（30 分钟）

1. 家里电脑装好：.NET 8+ SDK、XIVLauncherCN（**不要让它自动更新**，用 .NET 8 版 6.4.8-1，Update.exe 改名禁用）、游戏本体
2. 游戏内 `/xlsettings` → Experimental → 开 Dev Mode，确认 `%AppData%\XIVLauncher\dev\` 有 Dalamud.dll
3. 装 Penumbra 插件（模型导出依赖）→ `%AppData%\XIVLauncherCN\devPlugins\Penumbra\` 有 Penumbra.Api.dll
4. 把 `choreo-src-v3` 整个目录拷到家里，和现有 `choreo/src`（v0.5）放平级

## Step 0 · 编译 v3 插件（20 分钟）

```powershell
cd choreo-src-v3
dotnet build
# 预期：成功，dll 自动复制到 devPlugins\ChoreoHelper
```

**成功判据**：`bin/Debug/net10.0-windows/ChoreoHelper.dll` 存在。
**失败处理**：
- 缺 Penumbra.Api.dll 引用 → 检查 Penumbra 装没装；引用路径改到实际 devPlugins 位置
- net10 SDK 缺失 → 装 .NET 10 SDK（XIVLauncherCN 新版也要它）
- 编译错 ChoreoHelper.csproj 版本不匹配 → 把 v3 代码并入 v0.5 解决方案改 TargetFramework

## Step 1 · 游戏内冒烟（10 分钟）

启动游戏 → `/xlplugins` 确认 ChoreoHelper 加载 → 聊天栏出现 "ChoreoHelper v3 已启动"。
浏览器开 http://localhost:48795/export/progress → 返回 `{"exporting":false,...}`。

**成功判据**：端点能访问。
**失败处理**：端口被 v0.5 占用 → 按 HttpServer-patch-notes.md 用独立端口或改 Port 常量。

## Step 2 · 校准 PapParser（重点，2-4 小时）

**目标**：让 `PapParser.TryParse` 能从真实 .pap 解出骨骼关键帧。

1. 准备对照工具：下载 [FFXIV-Explorer](https://github.com/ilmegh/FFXIV_Explorer)（Noesis 插件）——它能解析 .pap 并导出动画，是校准的"正确答案"
2. 找一个动作 pap：游戏目录 `game/040000/`（Lumina 里 `<game>/040000` 或 `sqpack` 内），或让 v3 插件跑一次 `/export/clip {"command":"/bow"}` 看日志里 PapPath
3. 用 FFXIV-Explorer 打开该 pap → 导出 → 得到"正确答案"（骨骼数、每骨骼关键帧、时长）
4. 打开 `Exporter/PapParser.cs`，对照依次核对 `TODO_VERIFY[P0]`：
   - 外层头布局（TryUnwrap 的 zlib 扫描已兜底，先确认它能解出内层）
   - 内层 magic/头偏移/pointerSize
   - classnames 注册表跳过逻辑
   - **ScanForAnimation 实现**：按对照结果把轨道布局写死（mask/numFrames/量化常数）
5. 校准判据：插件 `/export/clip {"command":"/bow"}` 返回 ok，且产出 JSON 的骨骼数、时长与 FFXIV-Explorer 一致（±5%）

**卡住时的降级（已内置）**：PapResolver 返回 fail → `ResolveOrRecordClip` 自动走 RecorderService 录制兜底（触发动作真实播放读骨骼）——**照样出数据，只是慢（每个动作播一遍）**。先跑通全流程，之后回头补解析。

## Step 3 · 模型导出（2-4 小时）

1. 打开 `Exporter/ExportService.cs` 末尾的 `PenumbraModelExporter`，补 TODO：
   - 确认 Penumbra.Api 有无公开 glTF 导出入口（查 Penumbra 文档/反编译）
   - 有 → 调用；没有 → 在 Penumbra 的"模型编辑器"里手动导出玩家模型 glTF（Penumbra UI 支持导出），或用 Lumina 自行拼（Item 表 ModelMain/ModelSub + 种族路径）
2. 产出：`model.gltf + skeleton.json`（骨骼名映射）

**成功判据**：Blender 或 Three.js 能加载该 glTF 且骨骼名称与动画 JSON 的 bone_N 能对应。
**捷径**：Penumbra 手动导出 + 手工生成 skeleton.json（先不动代码），验证链路后再自动化。

## Step 4 · 出角色包（10 分钟）

```powershell
# 游戏内调用（或浏览器 POST）
POST http://localhost:48795/export/start
# 轮询
GET  http://localhost:48795/export/progress
```

**预期**：日志依次出现 模型OK → 表情 N/~300 → 技能 M → `OK <pack路径>`。
**成功判据**：`%AppData%\XIVLauncher\ChoreoExports\role_你的名字_种族_性别\index.json` 存在，clips 有内容。

## Step 5 · 网页端加载真实角色（1 小时）

把 `choreo-engine.js` 放进 `choreo/` 前端，实现：
1. 读 index.json → 按需 fetch 动画 JSON（有本地缓存）
2. GLTFLoader 加载 model.gltf → 建 `bones` 注册表（gltf nodes ↔ bone_N）→ 接入引擎
3. 拖动时间轴 → `engine.scrubTo(t)` → 真实角色显示真实动作
4. 动作库卡片 ▶ → 播该动作

**成功判据**：你的角色在网页里做 /bow，拖动进度条能看到鞠躬过程中每个瞬间的姿势。

## Step 6 · 验收清单（对照你的原始需求）

- [ ] 网页展示的是你的角色（装备/种族/染色）—— 真实模型
- [ ] /dance 第 1 秒 = 真实动画第 1 秒 —— 真实动作数据
- [ ] 拖动时间轴实时变化姿态 —— 引擎 v0.2 已保证
- [ ] 编排连续播放模型跳完 —— 时间轴+状态机已保证
- [ ] 换职业后技能可用 —— 职业包机制（Step 4 已内置）

## 时间预算

| 步骤 | 时间 | 关键风险 |
|---|---|---|
| 0 编译 | 20 分 | 环境引用 |
| 1 冒烟 | 10 分 | 端口冲突 |
| 2 PapParser 校准 | 2-4 小时 | ⚠️ 最重要（可降级录制兜底） |
| 3 模型导出 | 2-4 小时 | ⚠️ Penumbra API 不确定（可手动导出兜底） |
| 4 出包 | 10 分 | — |
| 5 网页接入 | 1 小时 | 骨骼名映射 |

**总计：一个晚上可到 Step 5 出真效果（走降级路径），1-2 天完善。**

## 如果某个 AI 会话接手（把它喂给它的话）

> 这是 ChoreoHelper v3 的游戏外渲染方案行动手册。代码已全部就位（网页引擎 choreo-engine.js + 插件导出管线 choreo-src-v3）。你的任务是执行校准，不改变架构：第一步编译 v3 插件；第二步用 FFXIV-Explorer 对照校准 PapParser.cs 里的 TODO_VERIFY[P0]（Havok 布局）；第三步确认 Penumbra 模型导出路径；第四步跑 /export/start 出角色包；第五步网页端接入真实模型和真实动画。自定义动画格式与角色包结构见 ENGINE.md，不许改契约。