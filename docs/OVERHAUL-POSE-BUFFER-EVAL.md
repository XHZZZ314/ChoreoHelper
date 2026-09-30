# sampleClip 每帧 pose 对象分配 → 平坦缓冲：评估（OVERHAUL 批 B 交付物 2）

> 只评估不改码（批 B 合同明确「不建议立即实施」）。所有行号对 2026-09-28 批 B 交付树
> （preview3d 拆分后）。本文件是批 C/后续批的立项输入，不是施工合同。

## 0. 结论先行

- **收益量级：中偏低（第二优化序位）。** 每帧每舞者约 102 个短命小对象（101 骨 + 1 个
  pose 字典），8 舞者 60fps 下 ≈ 4.9 万对象/秒、约 3–5 MB/s 的年轻代垃圾。V8 分代回收
  处理短命对象效率高，实测卡顿主因（批 A 已修的每帧字符串解析、O(N) 关键帧扫描、
  每帧万次 indexOf）排序在这之前。平坦缓冲值得做，但不是下一个最大头。
- **接口代价：偏高。** `pose` 形状（`{qx,qy,qz,qw,tx,ty,tz[,sx,sy,sz]}` 字典）同时是
  引擎内部热路径数据、两个渲染适配器的 applyFn 入参契约、技能动作层的混合快照载体、
  以及 6+ 个测试/浏览器探针的断言面。直接换成 Float32Array 会一次性打断全部五层。
- **建议路线：三阶段，第一阶段零接口变更（复用池＋快照平坦化），第二、三阶段才动
  applyFn 契约。** 详见 §5。不建议与批 C 巨石拆分同期做（choreo-app.js 拆分时测试
  改写面会叠加）。

## 1. 现状：分配发生在哪里

`choreo-engine.js`：

| 位置 | 说明 | 频率 |
|---|---|---|
| `sampleClip` `web/choreo-engine.js:137`（逐骨 `out` 对象 `:142`，`pose[boneName]=out` `:166`） | 1 个 pose 字典 + 101 个七~十字段对象 | 每次采样 |
| `Character.sample()` `:283` → `samplePlaybackClip` `:172` | 主路径：**待机也全骨采样**（normalizeClip 用参考骨架补齐全部骨，`web/preview3d.js` normalizeClip） | 每舞者每帧 |
| 混合分支 `:299`（`pose[bn] = {...}`） | blendFrom 活跃时每骨再造一个对象 | 每舞者每帧 × 0.3s 窗口 |
| `playClip` capture `:205-207`、`stopToIdle` `:217` | 切段/回待机时整份 pose 快照（**保留**至混合结束） | 每次切换 |
| `update()` 循环回卷 `:244/:268`、once 末帧 `:272` | 回卷/结束混合快照 | 每循环周期/每次结束 |
| `scrubTo` 接缝混合 `:504`、B10 末帧 `:513` | 拖动时快照 | 拖动期间 |
| `ChoreoStageMotion.rootTranslation` `web/choreo-stage-motion.js:76` | 舞台位移激活时 `Object.assign({},p,{tx,tz})` 再造 1 个根骨对象 | 每舞者每帧（走位中） |

规模：单舞者 ≈ 6.1k 对象/s；8 舞者 ≈ 48.6k/s（混合期翻倍）。混合快照整份保留
（≈ 6–9 KB/舞者，存活 ≤0.3s 或一个循环周期）。

## 2. 消费方清单（谁在读 pose 形状）

**产品运行时（改形状即断）：**

1. `preview3d` 的 `makeApplyFn`（`web/preview3d.js:1758`，批 A 已预索引）：读
   `pose.qx..qw/tx..tz`、`pose.sx !== undefined` 三连校验；把 pose 传入
   `ChoreoStageMotion.rootTranslation`（`:1779`，返回**可能是新对象**）后再读一遍全部字段。
2. `gltf-adapter.js:51-58`（姿势预览/诊断页适配器）：`applyFn(bn, pose)` 读
   `qx..qw` 与 `if (pose.tx||pose.ty||pose.tz)`。
3. `choreo-skill-motion.js:102-109`（技能动作层）：
   - `c.sample()` 的返回值 `underlying` **跨帧保留**后赋给 `c.blendFrom`（:109）——
     若 pose 图被复用，这里必须深拷贝，否则混合源被后续帧覆盖（别名陷阱）；
   - 三处直接调 `ChoreoEngine.sampleClip(...)` 造 blendFrom 快照（:105/:109）。
4. 引擎自身 `update()` 应用循环 `choreo-engine.js:446-447`：`for (const bn in pose)
   c.applyFn(bn, pose[bn])`——for-in 键序 = normalizeClip 的骨架骨序（确定性），
   平坦化后须保持等价的确定性遍历序。

**测试/探针改写面（公开 API 消费）：**

- `ChoreoEngine.sampleClip` 是**导出 API**（`choreo-engine.js:539`）：
  `test-engine.js:5,18-52` 直接调用并读 `.arm.qx/.qw` 等字段（50 检查的主体）。
- `Character.sample()` 返回值：`test-loose-ends.js:109-175`（`ch.sample().arm` + zDeg）、
  `test-b10-once-end-idle.js:18,39-63`（zDeg 读 `q.qz/qw`）。
- 浏览器探针的 observe() 包装器直接包裹 `c.applyFn` 并对入参做 `{...p}` 展开、
  把 `pose: c.sample()` 整份塞进 JSON 快照：`test-daily-edit-browser.js:44-45`、
  `test-library-inventory-browser.js:44-45`、`test-rehearsal-reminders-browser.js:47-48`、
  `test-stage-motion-browser.js:44-45`。平坦化后这些包装器要改成读缓冲视图。
- **团舞（ensemble 家族）经 grep 实证不消费 sampleClip/applyFn/pose**（批 B 会话核对
  `choreo-ensemble-*.js` 零命中）——立项时点名的「ensemble」实际影响面为 0，
  真正的额外消费方是技能动作层与四个旅程探针。

## 3. 候选方案对比

| 方案 | 思路 | 接口代价 | 收益 | 备注 |
|---|---|---|---|---|
| A. 全平坦 | pose = `Float32Array(骨数×10)` + 骨名→下标表；applyFn 收 `(boneIdx, buf)` | **高**：五层全断（§2 全部条目） | 最大：零分配、顺序内存、可批量写 | 一步到位但回归面 = 引擎+2 适配器+技能层+6 测试+4 探针 |
| B. 对象池复用 | Character 持有可复用的 pose 图，sampleClip 原地覆写；blendFrom 改平坦快照（Float32Array 拷贝） | **低**：applyFn 契约不变；仅需给 skill-motion 的 `underlying` 保留点加 clonePose | ≈99% 稳态分配消除；混合期翻倍也消失 | 保留 for-in 与对象字段访问（megamorphic 读在批 A 预索引后已不是热点） |
| C. 双轨（推荐） | 先 B 后 A：内部全平坦 + `sampleClip` 保留对象版给测试/诊断；渲染层新增 `applyFnFlat` 可选契约，旧 applyFn 兜底 | 分期摊付：B 零破坏，A 只断显式迁移者 | 终态等同 A | 合同/测试分两批改写，每批可独立回归 |

## 4. 别名陷阱（任何方案都要写进合同的硬约束）

1. **保留点必须拷贝**：`blendFrom`（engine 内部 6 处 + skill-motion 1 处）是唯一合法的
   跨帧保留；复用池方案下任何把 `sample()` 返回值存过当前帧的地方都要走快照拷贝。
2. **rootTranslation 的对象替换语义**：`Object.assign({},p,{tx,tz})` 在池方案下必须改为
   原地改写或返回池内对象；在全平坦方案下变成对 buf 根骨槽位的两次写。
3. **遍历确定性**：for-in 键序（= normalizeClip 骨序）目前被旅程探针的 JSON 对拍隐性
   依赖；平坦方案按下标遍历天然确定，但迁移测试须先加「对象序 == 下标序」断言。
4. **`pose.sx === undefined` 语义**：旧素材无 s 通道靠字段缺失表达「不缩放」；平坦槽位
   需要哨兵值（如 NaN 或独立 bitmask）区分「未定义」与「值恰好为 1」，否则
   `makeApplyFn` 的缩放回退（baseScale 恢复）行为会漂。

## 5. 建议分批步骤（合同级，供批 C 之后立项）

- **PB-1（零接口变更，预计半天＋全量回归）**：Character 持复用 pose 图 +
  `sampleClipInto(clip, t, poseOut)`；blendFrom 六处快照改 `Float32Array`（blend 数学
  对数组做）；`Character.sample()` 返回复用图；`ChoreoStageMotion.rootTranslation` 改
  原地写；skill-motion `underlying` 保留点改显式 `clonePose()`（新导出小 API）。
  回归面：五件 node＋四旅程探针全绿即可（applyFn 契约未动）。
- **PB-2（渲染层平坦契约，独立合同）**：引擎新增 `applyFnFlat(boneIdx, buf, stride)`
  可选通道；preview3d `makeApplyFn` 迁移（批 A 的 byName 预索引顺势换 byIndex）；
  gltf-adapter 保持旧契约（诊断页非热路径，不强制）。探针 observe() 包装器双轨兼容。
- **PB-3（内部对象图退役）**：热循环全平坦；`sampleClip` 对象版降级为测试/诊断兼容层；
  test-engine/test-loose-ends/test-b10 迁移为经 `sampleClipInto` 读缓冲的语义断言
  （对拍期可保留对象版做 golden 双算）。
- **不建议现在做的原因**：批 A 的三项热点修复刚交付、收益排序上平坦缓冲次于
  choreo-app.js 巨石拆分（批 C）与实机闭环（批 D）；且 PB-1 的别名纪律最好在没有
  大规模文件搬移的稳定树上落。

## 6. 规模参考（立项时的算术）

- 101 骨 × (1 pose 字典 + 101 骨对象) ≈ 102 对象/帧/舞者；60fps × 8 舞者 ≈ 48.6k 对象/s。
- 每骨对象 7~10 个双精度字段 + 对象头 ≈ 90–130 B；8 舞者稳态垃圾率 ≈ 4–6 MB/s
  （混合期 ×2，走位中再 +1 根骨对象/帧/舞者）。
- 对照：批 A 修掉的「每帧每骨字符串解析」（101 骨 × parseInt/slice×2 × N 舞者 × 60fps
  ≈ 同量级字符串垃圾＋解析 CPU）与 O(N) 扫描才是首要瓶颈；本项是其次。
