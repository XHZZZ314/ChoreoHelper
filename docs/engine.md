# ChoreoEngine v0.1 · Web Preview Engine Spec

> The author AI starts coding batch 1 directly. This file is the **web engine ↔ plugin exporter** integration contract.
> Implementation: `choreo-engine.js` (engine module) · Demo: `engine-demo.html` (two-character timeline)
> 2026-08-25

## 1. Animation Data Format (AnimationClip)

The format produced by the plugin exporter (pap parsing), consumed directly by the engine:

```json
{
  "name": "bow",              // 全局唯一（动作命令去斜杠，如 "bow" / "flamedance"）
  "duration": 1.6,            // 秒（pap 真实时长 —— 顺带解决动作时长表）
  "type": "once" | "loop" | "chain",
  "chainNext": "goldB",       // type=chain 时的下一段名称
  "chainAt": 1.0,             // 当前段播到该秒接下一段
  "bones": {
    "n_spine": {
      "q": [ [0, 0, 0, 0, 1], [0.5, 0.05, 0, 0, 0.9988] ],
      "t": [ [0, 0, 0, 0], [1.0, 0.02, 0, 0] ]          // 可选位移通道
    },
    "n_arm_l": { "q": [ ... ] }
  }
}
```

**Conventions** (block comments above: `name` globally unique — action command de-slash, e.g. "bow" / "flamedance"; `duration` seconds — real pap duration, doubles as the action duration table; `chainNext` next segment for type=chain; `chainAt` the second at which the current segment hands over; `t` optional translation channel):

- `q` = quaternion keyframes `[t, x, y, z, w]`, **local rotation** (relative to parent bone), matching in-game driving semantics
- `t` = translation keyframes `[t, x, y, z]`, local translation (optional; static bones may omit it)
- Bone naming: game-original bone names (exporter reads from .sklb); the engine only passes names through — **exporter and model packaging must guarantee name consistency**
- **Recording-fallback-route bone naming**: `bone_N` (skeleton index order), with `skeleton.json` providing the `bone_N ↔ glTF node` mapping (engine passes names through; both routes can coexist)
- Keyframes need not be evenly spaced (pap raw sample rate); the engine interpolates via binary search on time
- Binary/quantized compression is a v0.2 optimization; contract unchanged (JSON is the initial wire format)

## 2. Character Pack Structure (model + animation + index)

```
角色包/                          # 一个角色（种族+性别+穿搭）
├── model.gltf / model.bin / textures/*   # Penumbra IO 导出
├── skeleton.json               # 骨骼名 → 索引（glTF nodes 对应）
├── clips/
│   ├── emotes/                 # 全量表情（静态资产）
│   ├── jobs/                   # 按职业分（动态资产）
│   │   └── warior/             # 职业 ID 目录
│   │       └── heavy-swing.json
│   └── generic/                # 待机/站姿等
└── index.json                  # 动作→clip 映射 + 时长表
```

*(Tree above: character pack root — one character (race+gender+outfit); model.gltf/model.bin/textures from Penumbra IO export; skeleton.json bone name → index (maps to glTF nodes); clips/emotes full emote set (static assets); clips/jobs per-job (dynamic assets), job-ID directory; clips/generic idle/stand poses; index.json action→clip mapping + duration table.)*

`index.json` structure:

```json
{
  "version": 1,
  "race": 4, "gender": 0,
  "clips": {
    "bow":        { "file": "clips/emotes/bow.json",   "duration": 1.6, "type": "once" },
    "heavy-swing":{ "file": "clips/jobs/warior/hs.json","duration": 2.1, "type": "once", "jobId": 21, "weapon": 1 },
    "dance":      { "file": "clips/emotes/dance.json",  "duration": 12.0,"type": "loop" },
    "goldchain":  { "file": "clips/emotes/gold-a.json", "duration": 7.3, "type": "chain", "chainNext": "goldchain-b" }
  },
  "timelines": { "jobId": 21, "weapon": 1 }
}
```

## 3. Engine API (v0.1)

```js
const engine = new ChoreoEngine.PreviewEngine();

// 资源
engine.registerClip(clip);                    // 注册动画（或批量 loadCharacterPack）

// 角色（网页端每舞者一个实例）
engine.addCharacter({
  name: 'A',
  bones: { n_spine: THREE.Object3D, ... },   // 骨骼注册表（glTF 加载后填）
  applyFn: (boneName, pose) => { /* 写 quaternion/position */ },
  idleClip: idle,
});

// 播放控制
engine.play() / engine.pause();
engine.setSpeed(0.25–4);
engine.scrubTo(t);          // 编舞拖动 seek（v0.1：回位重放语义）
engine.seek(t);             // 播放头直接跳（播放中可用）
// 游标不变量（ENGINE-CURSOR，2026-08-31）：timelineIdx 恒为当前时刻第一条尚未触发的
// 时间轴条目；scrubTo/seek/setTimeline/timeline 替换都会立即重新对齐，
// 保证随后 play()+update() 既不重放已过条目也不漏触发。

// 时间轴（编舞序列）
engine.setTimeline([
  { char:'A', clipName:'dance', start:0, opts:{ loop:true } },
  { char:'B', clipName:'bow',   start:4, opts:{} },
  ...
]);
engine.onEvent = e => { /* {kind:'chain'|'clip', ...} */ };
```

*(JS comments above: resources — registerClip registers one animation, or batch via loadCharacterPack; characters — one instance per dancer on the web, bones = bone registry filled after glTF load, applyFn writes quaternion/position; playback — scrubTo is choreography drag seek (v0.1: reset-and-replay semantics), seek jumps the playhead directly (usable while playing); timeline = choreography sequence.)*

## 4. State Machine Semantics

| State | Trigger | Behavior |
|---|---|---|
| idle | default / once finished | looping standby; the blend target when an action ends |
| playing | playClip | current clip advances |
| chain | reaching chainAt | engine event switches to the next segment (capture blend) |
| blending | once finished, back to idle | 0.3s bone-level interpolation (blendFrom → idle) |

- `loop` clip: modulo looping
- `once` clip: finishes → blending → idle (BLEND=0.3s)
- `chain` clip: fires an event at chainAt; the engine switches to chainNext

## 5. Integration Points with choreo/index.html

1. The current "preview" area → add a 「3D 预览」(3D preview) canvas (Three.js renderer mounted into the existing DOM)
2. Drag events: `bottom-ruler onMove` → also call `engine.scrubTo(t)` (**zero IPC, purely local**; in-game preview vs web preview is an either-or toggle)
3. Action library card ▶ → `engine` plays the clip directly (no longer via the /preview API)
4. 「当前职业」(current job) selector → filters the index.json jobId subset; un-exported badge → triggers plugin export (existing API channel)
5. Sequence playback: `engine.setTimeline(...)` web-first; the 「游戏内播放」(play in game) button keeps the existing /playback/start

## 6. Plugin Exporter Integration Spec (data contract done, code next)

| Module | Responsibility | Status |
|---|---|---|
| ExportService | Character collection: gear/dyes/race/weapon → model reference chain | To write (needs Penumbra API details, verify at home) |
| PapResolver | ActionTimeline Key → pap path + job/weapon variant rules | To write (Phase 0 verification) |
| PapParser | Havok container → bone tracks (q/t keyframes) | To write (Phase 0 verification, implemented independently referencing community tools) |
| AnimWriter | AnimationClip JSON serialization (this contract) | Can write now, pure data |
| PackWriter | Character pack directory + index.json | Can write now, pure data |

**License note**: Penumbra is AGPL — only call its public API (or independently implement the algorithms); **never copy its source into this project** (this repo carries no License declaration; directly including AGPL code is a compliance risk).

## 7. v0.2 Backlog (after verification)

- [ ] seek semantics upgrade: timeline look-back (seek to t → find each character's active clip at t and locate clipTime)
- [ ] blend advance switched to dt (currently approximates 1/60)
- [ ] glTF model integration + material mapping table (skin/cloth approximation)
- [ ] binary quantized animation compression
- [ ] bone name mapping (.sklb original names ↔ glTF node names)
