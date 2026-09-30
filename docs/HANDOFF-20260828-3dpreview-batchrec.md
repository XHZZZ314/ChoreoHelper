# ChoreoHelper · 3D Preview Linkage + Full-Library Batch Recording Push (Early Hours 2026-08-28)

> Predecessor docs: HANDOFF-20260827-local-deploy.md (local deployment), HANDOFF-v06-recording.md (recording pipeline).
> Covers the entire session from late night into the early hours of 2026-08-28: 3D timeline linkage launched + three rounds of work on the batch recording system. Complete handoff for the next AI.

## 1. What Was Achieved

### 1. Main-Page Timeline ↔ 3D Preview Linkage (SPEC todo #1 done ✓)

- New file `web\preview3d.js`: the toolbar "🧍 3D预览" button opens a floating panel; all dancers' real models side by side in one view (SkeletonUtils.clone gives each dancer its own model copy; colored circle under each matches the dancer color)
- Data flow: main page `store.currentTime` (read-only each frame, **zero changes to existing main-page code**) → ChoreoEngine.scrubTo → per-dancer applyFn writes the cloned model's bones
- Measured: bow@2.0s head height **1.49m** in Chrome — three-way match with the pose preview page's historical measurement (1.48m) and a node forward-kinematics offline calc
- Extras: pose preview page top-right jump links “← 编舞主页” and “主页+3D预览”; `#3d` deep link (`#3d&t=seconds` positions time)
- **Found and fixed**: action-library sync ran only once at init (actions added to the timeline later couldn't be driven) → now checks the action-name set every 0.5s and re-queries missing ones every 10s; newly recorded actions take effect automatically without a manual refresh
- **Key data conversion**: engine sampleClip gives bones missing a translation channel position 0 (skeleton collapses); fill from the reference skeleton before clip registration; also synthesize an `__idle__` standing-idle clip

### 2. Node.js Installed (D:\nodejs)

v24.20.0 LTS zip build, on D:, not in PATH, use the full path `D:/nodejs/node.exe` (same pattern as the .NET SDK). test-engine.js unit tests 21/21 pass.

### 3. Batch Recording System (Three Rounds; Final Form)

**Plugin side (C#, compiled and deployed)**:
- `/export/batch`: records and saves item by item, skips existing files (resumable), 2.5s interval (shorter and actions get swallowed)
- `/export/batchcancel`: cancel (stops after the current item finishes recording and saving)
- `/export/walkreset`: **pose-reset double insurance** — ① nudge the GameObject position 0.4 m (same principle as nav plugins; no foreground needed); ② when the game is foreground, OS-level keybd_event injects Space+W jump-walk for 1.2 seconds (with foreground protection; keys auto-released on window switch)
- Recording end reason returned (settled = played out and still / timeout = 20s cap = sustained type); after timeout it automatically sends `/beckon motion` to interrupt
- `ClipName()`: command→filename uniformly strips motion/loop/special variant suffixes ("beckon motion"→"beckon.json")
- MaxRecordSec = **20s** (owner-set cap; one-shot actions generally finish still in 2~4s early, so no loss)

**Orchestrator (`scripts\batch-record.js`, node script, one command)**:
- All triggers use the `xxx motion` pure-motion variants (no chat spam, no target taken, works even for emotes without a text version)
- Pose-type 10 (doze/kneel/pose/grovel/**lounge**/groundsit/playdead/situps/winded/savortea): record → walk-reset → 4.5s
- Sustained (≥19s) → beckon interrupt → 4s; normal → 2.5s
- Per-item on-the-spot QC: amplitude <0.3 = still/bad data → retry once; **facial category (29 emotes) exempt from QC** (face-only, body doesn't move — false positives)
- Usage: `D:/nodejs/node.exe scripts/batch-record.js` (--dry previews the list)

**Post-processing tool (`scripts\trim-loop-clips.js`)**:
- `check`: whole-library amplitude QC, lists still/bad data
- `trim [--apply]`: for items ≥17s (cut-off sustained type) run period detection, cut into whole loop periods + mark type:"loop" (preview loops without frame jumps, saves storage); items with no clear period (e.g. /dance is an 18s one-shot full performance) stay once
- /dance verified judged correctly: no clear period (score 0.12) → once ✓

### 4. Pose Reset Verified Live

Sequence: record doze (lying 20s) → walkreset → record beckon (not saved) → data comparison: post-reset beckon first frame vs standing reference deviation 0.906, consistent with the known standing baseline (1.031) (ratio 0.88; still lying down it would be several times larger) → **reset works**. Playdead → jump up → walking confirmed OK by the owner visually.

## 2. Pitfall Log (By Importance)

1. **Three deployment locations**: while the game runs, the web actually reads the **game directory** `...\最终幻想XIV\game\dist\ChoreoHelper\` (Dalamud loads dev plugins from a copy; Assembly.Location is not devPlugins — the v0.6.1 "root fix" was only half right). Changing web pages requires syncing: web\dist (source) → build auto-syncs devPlugins → **manually sync the game directory**. Browser refresh applies it.
2. **`/nod motion` does not exist on CN** (chat reports "command not found") → interrupt command switched to the verified-working `/beckon motion`.
3. **Pose-type action pollution**: after recording doze the character stays lying down; the next 15 items were all garbage recorded lying down (deleted). Only character movement clears a pose; commands cannot. → walkreset double insurance solves it.
4. **Dalamud IKeyState injection is ineffective** (CN Orange/Soil build tested: API returns success but the character doesn't move) → use OS-level keybd_event + GetForegroundWindow foreground protection (prevents keys leaking into other windows) + a SetPosition nudge as fallback.
5. **Facial-category actions have ~0 body amplitude**: fume/huh were QC-flagged "still" while the recording was actually fine (log shows normal frame count, settled ending). → orchestrator exempts by category. Debug order: read the Recorder lines in dalamud.log before concluding.
6. **Emote triggers need the motion variant**: the `/beckon` text version recorded as still twice; `/beckon motion` worked. Keep ≥2.5s between consecutive recordings or the animation lock swallows the next action.
7. **The two recording stores are unrelated**: toolbar "⚡ 录制全部" = 48794 /bonerec saving .bin (for in-game instant preview; /bonerec/list is an empty stub); the 3D panel reads only 48795 json (`%AppData%\XIVLauncherCN\ChoreoExports\clips`).
8. **The library's isLoop flags are all true** (nearly all FF14 actions support a loop variant) — no discriminating power. Judge sustained type by actual recorder behavior (timeout = sustained).
9. **bow recording: standing up between 2~2.5s is very fast**: at t=2.5 it already looks fully standing — not a bug (verified with node forward kinematics).
10. **Reading game action data directly (pap parsing)**: evaluated back in S3; cost 4~8 weeks and loses physics effects (skirt/hair/face); prototype at src\Exporter\papparser.cs.bak as a fallback route. Owner asked; answered.

## 3. Current State

- **15 recorded** (ChoreoExports\clips): angry beckon bow cheer clap comfort cry dance doubt doze furious goodbye surprised wave
- **280 to go**: the orchestrator runs them in one go (~1h estimate, including pose resets and interrupt gaps)
- Environment installed: Node.js D:\nodejs; .NET SDK (full path) unchanged
- All three web deployment locations consistent (preview3d.js/choreo-engine.js/main page/preview page/libs all synced); the plugin DLL contains all new features and **the game loaded it this session**
- Owner visually verified: pose reset OK; owner has not yet operated the 3D preview panel (AI verified numerically)

## 4. Next Steps (Priority)

1. **Finish the batch recording**: `D:/nodejs/node.exe scripts/batch-record.js` (run in background, ~1h; game open, character placed in open space, camera facing open space, don't touch the character). Afterwards review the failure list; re-run the still/bad ones once.
2. **Loop trimming**: `D:/nodejs/node.exe scripts/trim-loop-clips.js trim --apply` (run without --apply first to preview the report; threshold 0.02 adjustable per the actual score distribution)
3. **Owner web acceptance**: refresh browser → play any action on the main page → 3D preview follows (facial-category actions showing a standing still pose is normal)
4. SPEC todos: loop actions looping correctly (engine already supports it; only the clip type marker missing — ready automatically once trim is done), publish GitHub
5. Leftover small items: v0.5 features (macro/export etc.) not regression-tested (zero changes this session, theoretically unaffected)

## 5. Verification Command Cheat Sheet

```
D:/nodejs/node.exe D:/choreohelper/web/test-engine.js          # 引擎单测（应 21/21）
D:/nodejs/node.exe D:/choreohelper/scripts/batch-record.js --dry  # 预演录制清单
D:/nodejs/node.exe D:/choreohelper/scripts/trim-loop-clips.js check # 动作库质检
curl http://localhost:48795/export/list                          # 已录清单
curl -X POST http://localhost:48795/export/walkreset -d '{}' -H "Content-Type: application/json"  # 姿态复位
"C:/Users/xhz/AppData/Local/Microsoft/dotnet/dotnet.exe" build D:\choreohelper\src\ChoreoHelper.csproj -c Debug  # 编译+同步devPlugins
```
