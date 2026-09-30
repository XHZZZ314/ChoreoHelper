# ChoreoHelper Handoff · S3 Bone Direct-Write Plan (Full Version)

> Handoff document for the next AI. Read ALL of it before touching anything.
> Project root: `C:\Users\Administrator\ChoreoHelper`
> Web page: `C:\Users\Administrator\ChoreoHelper\dist\ChoreoHelper\choreo-helper-app.html`
> Local services: plugin HTTP API `localhost:48794`, web server `127.0.0.1:48795` (serve-app.ps1)

## 1. Project Goal (Core User Need)

**Drag the timeline to any position; the in-game character shows the exact pose of the action at that position.**

The user edits an FF14 choreography timeline in the web UI (multiple dancers, action clips, lyrics) and needs drag-preview to arrange action order and timing. Drag preview is currently unreliable.

## 2. Why Past Attempts Failed (Must Know — Do Not Repeat)

### The Repeating Failure Pattern

```
AI tests via direct API call → "verification passed" → user drags from the web page → completely broken
```

**Lesson from every iteration**: AI testing took the bypass (direct POST /playback/freeze); the user's operation takes the full path (web drag → /playback/seek → HandlePlaybackSeek → PlaybackManager → Freezer middle layers → freeze pipeline). The middle layers include drag-stream separation (150ms deferred settle), the _previewGen generation counter (incremented on StopPreview to discard in-flight requests), deferred logic, etc. — these layers swallowed every freeze request while in GPose mode.

**Next time**: debug from the web drag through the full user path, verifying what the user actually sees at each step with **screenshots + visual confirmation**. Never substitute API bypass tests.

### Approaches Tried And Failed

| Approach | Problem |
|---|---|
| Normal mode + emote channel/learning/pinning | Game emote queue swallows commands, loop-residue deadlock, race variant rows, fake duration readings — adversarial dev loop; each fix opens more holes |
| Learning persistence + full warmup | Warmup scanned 263 actions and flooded the game emote queue; user interrupted mid-operation by the scan |
| GPose direct control (v0.5.29) | API test passed (different poses at different times), but the web-drag path was eaten by the middle layers; user saw no effect |
| GPose bone record/replay (v0.5.30-31) | model-space coordinates not portable across modes (recorded in normal mode, replayed in GPose); local-space fixed the coordinates but writing required hooking UpdateBonePhysics; after the hook the written values were correct but rendering still didn't follow (the written hkaPose layer and the layer rendering reads may differ) |

## 3. Verified Working Primitives (Reusable)

These primitives were individually verified on the CN client and are reliable building blocks:

### 1. GPose Enter/Exit
```
Enter: chat command /gpose (GameCommandExecutor direct delegate call)
Exit: send /gpose again
After exiting, the emote system is temporarily stuck → user walks two steps and it recovers
```

### 2. Deterministic Animation Id Resolution
```csharp
// 在 AnimationPoseFreezer.cs 中（方法名 ResolveGposeId）
// 原理：调用游戏自己的角色解析接口，不学习不观察
var r = chara->ResolveTargetedEmoteId(ids.Emote, null);
// r = 该角色实际执行的变体行号
// 然后查 Emote 表该行的 ActionTimeline[0] = 确定性主时间轴 id
// 已验证：wave→706, box→5809, dance→700, golddance→3777, cheerjumpred→6248
```

### 3. GPose Direct Bind + Time Scrub + Clock Stop (API-level verification passed)
```csharp
// 绑定动画到角色（GPose 内有效）
chara->Timeline.BaseOverride = timelineId;
chara->Timeline.PlayActionTimeline(timelineId);

// 拨到目标时刻
AccessMainControl(targetTime, true);  // 写 LocalTime

// 停表
SetAllControlSpeeds(0f);  // 全槽速度归零

// 视觉验证结果（通过截图 + AI 视觉确认）：
// /dance @0.5s → 双臂抬起摆动、单腿抬起（舞蹈中段）✓
// /dance @5.0s → 手臂放下接近站立（另一时刻）✓
// /box @0.5s → 双拳抬起防御准备 ✓
// /box @8.0s → 单臂前伸出拳 ✓
```

### 4. Bone Read/Write (local-space)
```csharp
// 读：partial-0 的 hkaPose → GetSyncedPoseLocalSpace() → hkArray<hkQsTransformf>
var pose = partialSkeleton->GetHavokPose(0);
var local = pose->GetSyncedPoseLocalSpace();
// local->Data[b] 是第 b 根骨骼的 {Translation(hkVector4f), Rotation(hkQuaternionf), Scale}

// 写：直接写 local->Data[b].Rotation = ...
// local-space 是父骨相对变换，跨 GPose/普通模式通用

// 已验证：写入右上臂骨(j_ude_a_r) 90° 旋转 → 视觉确认手臂旋转 ✓ 2.5秒不被覆盖 ✓
// 但：通过 hook UpdateBonePhysics 逐帧重写全部骨骼 → 渲染层未跟进（原因未明）
```

### 5. UpdateBonePhysics Hook
```csharp
// 签名（Brio 同款）：
var sig = "48 89 5C 24 ?? 48 89 6C 24 ?? 48 89 74 24 ?? 57 41 54 41 56 48 83 EC ?? 48 8B 59 ?? 45 33 E4";
// hook 后在 detour 里调用 original → 然后写骨骼 → 理论上是正确时机
// 实际：hook 生效（日志确认调用），写入值正确（读回验证），但角色渲染未变化
// 可能原因：渲染读取的不是 GetHavokPose(0) 的 local-space 数据，而是另一层
```

### 6. Bone Name List (partial-0, 101 bones)
```
0:n_root, 1:n_hara, 3:j_kosi, 33:j_kubi(neck), 46:j_kao(face),
47:j_ude_a_l(left upper arm), 48:j_ude_a_r(right upper arm), 59:j_ude_b_l(left forearm), 60:j_ude_b_r(right forearm),
64:j_te_l(left hand), 65:j_te_r(right hand), 5:j_asi_a_l(left thigh), 6:j_asi_a_r(right thigh)
```

## 4. Current Code State

### Version: 0.5.31 (running locally)

### File layout:
```
ChoreoHelper/
├── Plugin.cs                 — plugin entry, service injection
├── AnimationPoseFreezer.cs   — core freeze/preview logic (~2200 lines)
│   ├── GPose toggle (GposeToggle)
│   ├── Deterministic id resolution (ResolveGposeId)
│   ├── GPose direct-control freeze (GposeFreeze) — partially superseded by the bone path
│   ├── Normal-mode freeze pipeline (FreezeRequestCore → AttachPhase → Hold)
│   │   └── Lots of legacy here: learning/attach/wait/retry/interrupters (all can be retired)
│   └── Bone probe (BoneProbe) — for debugging
├── BoneAnimator.cs           — S3 bone recorder/replayer (~500 lines)
│   ├── Record: StartRecording → TickRecord(30fps sampling) → CheckAutoStop → SaveToDisk
│   ├── Replay: StartReplay → TickReplay(per-frame write + interpolation)
│   ├── Batch: StartBatch(iterate all emotes) → TickBatch
│   └── UpdateBonePhysics hook (same signature as Brio)
├── PlaybackManager.cs        — playback orchestration (execute commands at timestamps)
├── HttpServer.cs             — HTTP API
│   ├── /gpose/toggle, /gpose/state
│   ├── /bonerec/start|stop|status|batch|batchcancel|clear
│   ├── /playback/start|stop|seek|freeze
│   └── /debug/animstate|diag|boneprobe|tlinfo|emotefamily
├── GameCommandExecutor.cs    — chat command direct-call delegates
└── serve-app.ps1             — web server (127.0.0.1:48795)
```

### Web page (choreo-helper-app.html) existing features:
- Timeline editor (multi-dancer, action/switch/lyric tracks, drag arrangement)
- 📷 precise-photo button (toggles GPose)
- ⚡ record-all button (batch bone recording)
- Split-screen compact mode, LRC translation, two-line lyric track, fixed 5-minute track
- Engine switch (classic/enhanced)

## 5. Next Steps (Priority Order)

### Plan A: Fix the drag path (smallest change — try first)

**Problem**: the GPose direct-control primitives are verified, but the pipeline from web drag to character display is broken.

**Fix**: in `HandlePlaybackSeek` (or equivalent) add a GPose passthrough branch:
```
if GPose active:
    skip all middle layers (do NOT go through FreezeRequestCore / deferred / _previewGen)
    directly call one simple function:
        1. find the clip at the current position → get command
        2. ResolveGposeId(command) → timelineId
        3. chara->Timeline.BaseOverride = timelineId
        4. chara->Timeline.PlayActionTimeline(timelineId)
        5. AccessMainControl(inClipTime, true)  // write LocalTime
        6. SetAllControlSpeeds(0)
```

**Key**: do not go through the RequestFreezePreview → RunOnFrameworkThread → _previewGen check → FreezeRequestCore chain. Call directly in the HTTP handler (or via a direct-call method with no middle layers).

**Verification**: must test by actually dragging in the web UI, with screenshots confirming every step. No API bypass testing.

### Plan B: Fix the render layer for bone replay (if A is not enough)

**Problem**: local-space bone values written inside the UpdateBonePhysics hook are correct, but rendering doesn't follow.

**Possible causes**:
1. Rendering doesn't read `GetHavokPose(0)` data
2. An extra sync function is needed (e.g. `SetPoseLocalSpace` instead of writing the array directly)
3. A Havok pose recalculation must be triggered

**Reference**: Brio's `SkeletonService.cs` (`/tmp/brio/Brio/Game/Posing/SkeletonService.cs`)
- Brio hooks not only UpdateBonePhysics but also FinalizeSkeletons
- Brio does extra ReparentPartials / ReparentAttachments steps after writing
- Brio maintains its own Skeleton/Bone/PartialSkeleton wrapper classes (`/tmp/brio/Brio/Game/Posing/Skeletons/`)

### Plan C: Fully Standalone Renderer (EXE, long-term)

Export model + animation data and render the preview in a standalone app; the game is used only for final playback. Effort 4-8 weeks.

## 6. Key File Paths

```
Project code:     C:\Users\Administrator\ChoreoHelper\
Web page:         C:\Users\Administrator\ChoreoHelper\dist\ChoreoHelper\choreo-helper-app.html
Web server:       C:\Users\Administrator\ChoreoHelper\serve-app.ps1 (port 48795)
Brio source:      /tmp/brio/Brio/ (reference implementation)
ClientStructs:    /tmp/cs/FFXIVClientStructs/ (CN version headers)
Bone recordings:  C:\Users\Administrator\AppData\Roaming\XIVLauncherCN\pluginConfigs\ChoreoHelper\bonerec\
Plugin log:       C:\Users\Administrator\AppData\Roaming\XIVLauncherCN\dalamud.log
GitHub repo:      https://github.com/XHZZZ314/XHZZZ314.github.io (choreo/ subtree)
```

## 7. Cautions

1. **CN client quirks**: `ActionTimelineSequencer.PlayTimeline(3)` crashes; ExecuteEmote is rejected inside GPose; the emote system has cooldown/queue
2. **Two game clients**: two processes fight over port 48794 (HttpListener); the plugin retries but a restart may be needed
3. **Hot reload**: after code changes `dotnet build -c Debug` auto-copies to devPlugins and triggers Dalamud hot reload; **static fields are NOT reset** by hot reload (needs game restart or a clear endpoint)
4. **Version history**: the GitHub-published version is v0.5.26.2 (stable rollback) + pure frontend optimizations; locally running is v0.5.31 (with bone-recording experiment code)
5. **Testing discipline**: always start from the web drag through the full user path; verify with screenshots + visual confirmation. Never replace user-path verification with API bypass tests.

## 8. User Preferences

- FF14 CN-server player, using the Orange Moon launcher (XIVLauncherCN)
- Main use: generate macros for multi-dancer choreography (timeline edit → in-game playback → macro export)
- Strongly dislikes "adversarial development" (endless edge-case patching); expects root-cause solutions
- Communicates in Chinese; strong technical background but not a programmer
