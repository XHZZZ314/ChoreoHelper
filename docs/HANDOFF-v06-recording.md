# ChoreoHelper v0.6.0 · Recording Pipeline Delivery Log (Late Night 2026-08-25)

> This doc + code package = everything achieved tonight. Complete handoff for the next AI (review or continue).
> Predecessor docs: HANDOFF-S3-BoneDirect.md (bone direct-write plan), handoff-s3.md / handoff-s3.1.md (S3 baking plan), final-delivery.md (v0.6 overall architecture).

## 1. What Was Achieved Tonight

**The full "in-game recording → disk → web 3D preview" pipeline works end to end and is visually verified:**

```
Character performs a real action in game (normal mode, no GPose needed)
  ↓ RecorderService: samples 101-bone local-space transforms every Framework.Update tick (30fps)
  ↓ AnimClipData JSON (q quaternion keyframes [t,x,y,z,w] / t translation channel, the ENGINE.md contract format)
All 293 actions recorded (~820MB, %AppData%\XIVLauncherCN\ChoreoExports\clips\)
  ↓ ExportServer (separate port 48795)
Web pose preview page pose-viewer.html (Three.js bone wireframe)
  ├─ Action list (293 entries, search filter)
  ├─ Drag slider = exact pose at any frame (0.5s vs 5.0s visually confirmed clearly different) ✓
  └─ Play button (continuous playback) ✓
```

**The user's core need — "park anywhere and it shows the correct action at the correct time" — is met on the web side with zero game interference.**

## 2. Architecture (Currently Running v0.6.0)

```
ChoreoHelper plugin (devPlugins, dual port)
├── 48794 main API (v0.5 legacy: action library/playback/seek — untouched, 0.5.26.2 rollback semantics)
└── 48795 ExportServer (new tonight, HttpListener)
    ├── /export/clip       POST {command, save} → synchronous recording (8s cap) → returns clip JSON
    ├── /export/batch      POST {commands:[...]} → batch recording (skips existing)
    ├── /export/batchstatus GET → {running, done, total, remaining}
    ├── /export/list       GET → list of exported action names
    ├── /export/getclip?name=xxx → single clip JSON (web pulls on demand)
    ├── /export/skeleton   GET → skeleton info (bone names/parent indices/reference pose, required for web rendering)
    ├── /export/recstate   GET → Recorder live diagnostics (debug channel when dual-client logs are unavailable)
    ├── /                  → choreo-helper-app.html (choreography main page)
    └── /viewer            → pose-viewer.html (pose preview page)
```

### File List (In The Code Package)

| File | Purpose |
|---|---|
| Exporter/RecorderService.cs | Core: the recorder. record → sample → end detection → AnimClipData |
| Exporter/ExportServer.cs | HTTP service: all /export/* endpoints + static pages |
| Exporter/SkeletonHelper.cs | Skeleton info export (hkaSkeleton.ParentIndices + reference pose) |
| Exporter/AnimWriter.cs | Animation data model + contract JSON (verbatim from the v3 delivery) |
| Exporter/ExportService.cs.bak | v3 full-export orchestration (CN compat unfixed, suspended) |
| Exporter/PapParser.cs.bak / PapResolver.cs.bak | pap parsing route (same; the recording route is sufficient) |
| Plugin.cs | Assembly (v0.5 core + v3 Recorder/ExportServer) |
| pose-viewer.html | Web pose preview page (Three.js) |
| dist/ChoreoHelper/choreo-helper-app.html | Choreography main page (includes the six frontend optimizations) |

## 3. Key Technical Details (Pitfall Log)

### 1. CN client bone read path (verified)
```csharp
var character = (Character*)local.Address;
var cb = (CharacterBase*)character->GameObject.DrawObject;   // 注意：GameObject.DrawObject（非 DrawObject 直取）
var partial = &cb->Skeleton->PartialSkeletons[0];
var pose = partial->GetHavokPose(0);
var ls = pose->GetSyncedPoseLocalSpace();   // hkArray<hkQsTransformf>，101 骨
// ls->Data[i].Translation(hkVector4f) / .Rotation(hkQuaternionf)
// 父索引：pose->Skeleton->ParentIndices.Data[i]（hkArray<short>）
```
**local-space is mandatory**: model-space world transforms differ between GPose and normal mode (the v0.5.31 lesson).

### 2. Recording end detection (survived repeated pitfalls)
- ❌ "wait until sampling stops" — idle breathing/physics never stops (sampled 900+ frames)
- ❌ "wait for bones still for 0.5s" (threshold 0.002) — breathing amplitude exceeds the threshold, still never stops
- ✅ **Current scheme**: after motion starts, detect "near-stillness" (over a 12-frame window, rotation-energy delta of bones 3-80 < 0.01, sustained 0.5s) → settled; **fallback MaxRecordSec = 8s hard cap** (once-type actions are generally <4s)
- Leftover: loop-type actions (dance etc.) get truncated at 8s — type marked once; frontend looping is handled by the engine layer

### 3. Dual-client log black hole
With two game processes, the plugin fails to write dalamud.log (file lock) — **logs completely blank**.
Countermeasure: the `/export/recstate` HTTP diagnostic endpoint returns all Recorder internal state (recording/frames/bonesNull/updateAliveAgo) — tonight it revealed "recording was actually running; only the end detection was broken".

### 4. Port planning (pitfall)
48795 was the web server (serve-app.ps1); tonight ExportServer also took 48795 → the web server got squeezed out.
**Final arrangement**: ExportServer serves the static pages itself (/ and /viewer); serve-app.ps1 retired. One plugin port provides API + pages.

### 5. Web rendering (pose-viewer.html implementation notes)
- Bone wireframe: one Object3D pivot per bone, parented by ParentIndices; parent→child Line segments
- **When the t channel is missing you MUST fall back to reference-pose positions** (otherwise all bone translations zero out → pose collapses into a stick) — fixed and verified
- Sampling: q channel slerp, t channel lerp; binary search for the frame interval
- Scale: FF14 bone units are centimeters → skelGroup.scale 0.01

### 6. Recording data quality (verified)
- /bow: bone_48 (right upper arm) frame 0 (0.38,0.37,-0.54,0.66) → frame 60 (0.50,-0.41,-0.32,0.70); magnitude normal
- All 101 bones have data, 30fps, ~2.9MB JSON per action

## 4. v3 Plan Parts Delivered But Unused Tonight

- choreo-engine.js (27/27 tests): the preview page currently uses a self-written simplified sampler; **switch to this engine when integrating the timeline** (evaluate(t)/scrubTo/chain/loop semantics finalized)
- gltf-adapter.js: connect after model export
- ExportService (full character-package orchestration) / PapParser / PapResolver: CN compat unfixed (CustomizeIndex and other constants, unsafe context), suspended as .bak
- Penumbra model export: not started (P0 todo)

## 5. Next Steps (Priority)

1. **Real 3D model**: Penumbra-export the player model glTF + skeleton.json mapping → upgrade pose-viewer from wireframe to skinned model (pose data already verified correct; the model is only "skin")
2. **Timeline integration**: main-page drag → embedded preview (use choreo-engine.js evaluate/scrubTo; multi-dancer multi-instance)
3. **Loop-type actions**: annotate type from the Emote table at recording time; engine-layer loop sampling
4. **Publish GitHub** (online is still v0.5.26.2 + frontend optimizations)

## 6. Verification Record (Tested Tonight)

| Item | Result |
|---|---|
| /export/clip /bow | ✓ 292KB→2.9MB JSON, 101 bones, 8s |
| /export/clip /dance | ✓ same as above |
| Batch of 292 actions | ✓ 293 files 820MB |
| /export/skeleton | ✓ 101 bones with parent indices (n_root→n_hara→j_kosi→j_asi_a_l chain correct) |
| pose-viewer render | ✓ humanoid wireframe (visual confirmation) |
| Drag 0.5s vs 5.0s | ✓ clearly different poses (two-image visual: arms low vs raised) |
| bone_48 data first/last frames | ✓ quaternion changes substantially |

## 7. Quick Start (This Machine)

```
Game running (plugin enabled) →
Web preview:     http://localhost:48795/viewer
Choreography page: http://localhost:48795/
Record a new action: POST http://localhost:48795/export/clip {"command":"/xxx","save":true}
Rebuild:         cd C:\Users\Administrator\ChoreoHelper && dotnet build -c Debug (hot reload automatic)
```

Note: if 48795 does not respond = plugin not loaded (enable ChoreoHelper via /xlplugins).
