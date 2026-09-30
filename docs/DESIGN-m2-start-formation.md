# M2 起始站位设计（TASK-20260906-M2-START-FORMATION）

> 第一增量：每位舞者可编辑的静态起始 `start {x,z,yawDeg}`，网页 3D 持久放置。
> 非目标：2D 拖拽舞台、阵型预设、移动路径/速度/到达、动画朝向事件、根运动提取、音乐、
> 游戏校准/世界坐标、游戏移动/朝向/技能执行器、编译器/协议/能力变更、游戏起始阻塞变更。

## 1. 坐标契约（AC-1，实施前已定）

- 单位：`x/z` 米；`y` 不碰（首版编辑器锁定地面）。
- `start` 是静态项目放置，与播放头与整数 ms 时间轴无关。
- 零 yaw 朝 `+Z`（前），正 yaw 把 `+Z` 转向 `+X`，90 度朝 `+X`。
- 前向向量 `forward = (sin yawDeg, 0, cos yawDeg)`，对
  `0/90/180/270/-90/450/720` 在 `1e-6` 内成立且包络等价（`-90==270`，`450==90`，`720==0`）。
- `stageYawDeg` 永不参与网页坐标；不合成任何 `originCalibrated` 值。
- 不做文档/协议版本变更（schema-v2、protocol-v1 不变）。
- 若已有已著录夹具与本约定矛盾，停跑升级，不静默重解释。

M1 Y-up 约定保持私有：前 `+Z`、侧 `+X`、上 `+Y`。

## 2. 编辑语义（AC-2）

- 按舞者稳定下标寻址；仅该舞者 `start` 经一个纯编辑操作变更，再走既有
  `saveHistory/persistProject` 边界；存储的 `yawDeg` 原样保留用户输入的有限数值。
- 空白、非数字、`NaN`、`Infinity`、`-Infinity` 可见拒绝，零写入零历史。
- `Cancel`、`Escape`、未 `Apply` 关闭、同值 `Apply` 零写入零历史。
- `Clear` 删 `start` 键恢复“无 start”形状。
- 播放中双目标（网页/游戏）一致禁用（`disabled`+`aria-disabled`，点击 no-op）。
- `Tab` 可达全部输入，`Enter` 应用，`Escape` 取消；缺失 id 对话框零写入零抛错；
  快速连续 `Apply` 以最后一次为准。

## 3. 网页放置（AC-3/AC-4）

- 显式 `start` 置 `(x, baseY, z)`，`1e-6` 内，yaw 前向 `(sin,0,cos)`，`1e-6` 内；
  保留 `baseY` 与骨骼数据，光圈跟 `x/z`。
- 缺失 `start` 保持既有索引等距 `x=(i-(n-1)/2)*1.15`，`z=0`，放置 yaw 零。
- 显式原点渲染于 `(0,baseY,0)`，与缺失可区分；`stageYawDeg` 永不参与；
  档案绑定与每舞者 clip 命名空间不变；12 舞者经保存/重载不截断到 8；
  非有限永不进放置。
- 编辑落在就绪/未就绪/隐藏/初始化中，下一次就绪渲染出现，无模型重载
  （同母版缓存标识，零新增模型请求）；未就绪接受编辑、就绪时应用；
  隐藏/初始化中应用在 `show` 时零异常；`scrub` 保留全部 `start`；
  同人数放置刷新不改相机位姿、选中与 `currentTime`。

## 4. 持久化（AC-5）

- 显式有限 `x/z/yawDeg` 与舞者归属经撤销/重做、保存/重载、项目版本恢复、
  导出/导入存活；`Clear` 恢复缺失；不向未触舞者急写舞台默认或 `start`；
  既有无 `start` 保存形状字节稳定；版本、六轨数据、档案绑定、无关 extras、
  非零 `stageYawDeg`/`originCalibrated` 原样往返，无新存储/迁移；
  非对象 `start`、非有限字段、多余 `start` 子字段走既有归一化，按缺失附 hint，
  不崩不丢其余数据；持久失败走既有错误路径，内存编辑+历史保留，无部分写。
- Worker 阶段 diff 零触 `.agent/PROCESS-STATE.json`、`.agent/CONTINUITY.md`、
  `docs/AI-BACKLOG.md`（Context Sync 才动）。

## 5. 游戏执行边界（AC-6）

- 协议 v1 `performers` 投影仍仅 `id/name`；编辑入口与对话框常驻中文提示：
  起始站位/朝向已保存、用于网页预览、当前游戏执行不用，区分放置与骨骼动作，
  不声称校准或新增游戏支持；清掉最后 `start` 去字段级标记，无陈旧徽标；
  已有 motion/cue/lyrics 与未支持类拒绝不变；网页模式编辑零 `48794/48795`
  游戏控制请求；`web/choreo-show-compiler.js`、`src/ShowProtocol.cs`、
  `src/ShowValidator.cs` 字节不变。

## 6. 加载与发布（AC-7）

- 改后产品孪生 `web/` 源与 `web/dist/ChoreoHelper` 字节一致；新适配器
  `choreo-stage-ui.js` 按 `api/document/docwire/compiler/app/feature-adapters/bootstrap-last`
  依序经典加载，无模块脚本，外壳 `<5KB`；在既有发布白名单按名注册，
  不加诊断/私有资产；无 staging 生成、无活装写入、无真实游戏执行。
