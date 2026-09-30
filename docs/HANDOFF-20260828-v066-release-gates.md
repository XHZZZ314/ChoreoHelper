# ChoreoHelper · v0.6.6 Closeout Plan And Release Gates (2026-08-28)

> Continues `HANDOFF-20260828-pm-deadlock-seam-ui.md`.
> Purpose: turn the 2026-08-28 full audit of `SPEC.md`, `.agent/CONTINUITY.md`, the current source, the running plugin,
> the three web deployment locations, and the 264-clip library into a task list the next AI can execute directly.
> **This document only audits and plans; no feature code was changed.**

## 1. Bottom Line First

- The main architecture does not need a rebuild; the project has entered the v0.6.5 → v0.6.6 closeout stage.
- The `SPEC.md` loop item and GitHub release item remain unchecked.
- The current state is not "one owner eyeball-click away": the loop wrap blending never reached the main page's real call path;
  v0.6.5's playback unblock and auto-settle are loaded but not yet live-triggered and accepted.
- The next version should be **v0.6.6**: first fix the loop real path and the zoom anchor, then run the three in-game regressions,
  and only then prepare the public release package.

## 2. Confirmed Current Facts

### 1. Running Instance

- Game process PID 42304, started 2026-08-28 11:48.
- The plugin was later reloaded inside the same game process: `ChoreoHelper v0.6.5 started` appears in the logs at 12:06 and 12:18.
- `http://localhost:48794/version` currently returns `0.6.5`; so there is no need to wait for a game restart —
  CONTINUITY's "v0.6.5 loads on next restart" is outdated.
- The zombie signature is still alive: `slot0=3184`, `emoteId=108`, `isEmoting=true`,
  `charMode=1`, `idleTimelines=[]`. This is exactly the target scene for verifying v0.6.5's unblock.
- No `unblocked emote channel for playback` in the logs yet; and no new recordings since v0.6.5 loaded,
  so the playback unblock and the 0.05 settle threshold remain "code in place, behavior awaiting acceptance".

### 2. Clip Library And Build

- `%AppData%\XIVLauncherCN\ChoreoExports\clips` holds 264 clips in total:
  - 250 `once`
  - 14 `loop`
  - all 264/264 have 101 bones
  - `trim-loop-clips.js check`: 264 normal, 0 suspicious-still
- The 14 loop clips: attention, cackle, charmed, cheeronbright, cheerrhythmbright,
  cheerrhythmred, cheerwaveviolet, cheerwaveyellow, conduct, golddance,
  malevolence, pen, wasshoi, water.
- `web/test-engine.js` currently 25/25, but this suite does not cover the main page's per-frame `scrubTo()` real path.
- The .NET Release build succeeds: 0 errors, 6 pre-existing warnings.

### 3. Web Deployment

- The following three locations each hold the same 10 files with identical total bytes and SHA-256:
  1. `web\dist\ChoreoHelper`
  2. `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`
  3. `...\最终幻想XIV\game\dist\ChoreoHelper`
- The main page, viewer, engine, preview3d, models, and Three.js currently served by 48795 also hash-match the local deployment locations.
- The current Debug build only auto-syncs location 2; location 3 still needs explicit syncing — never skip it when changing web files.

## 3. P0: The Loop Seam Fix Never Entered The Main Page's Real Path

### Symptom And Root Cause

`web/choreo-engine.js`'s `Character.update()` on loop wrap:

1. `clipTime %= duration`;
2. captures the last frame into `blendFrom`;
3. blends into the new cycle over the first 0.3 seconds.

The existing 4 new unit tests call `Character.update()` directly, so they all pass.

But the main page's `web/preview3d.js` never lets the engine advance time itself. Every animation frame it runs:

```text
main page store.currentTime
  → engine.scrubTo(currentTime)
  → engine.update(now) sampling only
```

And `scrubTo()` takes the modulo directly for loops and unconditionally sets `c.blendFrom = null` at the end.
So `Character.update()`'s wrap blending never gets a chance to act on the main page.

Minimal offline repro: for a 1-second loop, run `scrubTo(0.999)` then `scrubTo(1.001)`:
across the seam `qx` jumps from about 0.8995 to 0.0011 — a diff of about 0.8984 — and `blendFrom=null`.
Proof that the main page still hard-wraps.

### Recommended Minimal Fix

Do not switch preview3d to the engine's independent playhead — it would drift from the main page's `store.currentTime`.
Keep the main-page timeline as the single source of truth; just give `scrubTo()` an explicit "smooth loop seams during continuous playback" option.

Suggested implementation:

1. Move `blendT += 1/60` out of `Character.sample()`.
   - `sample()` must be pure sampling; it must not change the blend duration depending on 30/60/144 Hz displays.
   - The internal playback path advances `blendT` by real time in `update(dt, speed, ...)`.
2. Extend `PreviewEngine.scrubTo(t, opts)`, for example:
   - `opts.blendLoopSeams=false` as the default, preserving precise scrub semantics;
   - when true, the current clip is a loop, and we are already past the first cycle:
     - `phase = inClip % duration`
     - if `phase < BLEND`, set the end-of-cycle pose as `blendFrom` and set `blendT=phase`
     - otherwise clear the blend.
3. `preview3d.js` calls:
   - while playing: `engine.scrubTo(time, { blendLoopSeams: true })`
   - paused/manual scrubbing: keep precise alignment, no stateful blending.
4. Quaternion blending uses the existing `_slerp()`, not per-component linear addition; the output must stay a unit quaternion.
   The translation channel keeps linear interpolation.

If during implementation "blend only while `store.isPlaying`" leaves manual scrubbing across the seam still jarring,
the loop seam pose can be defined as a deterministic sample: past the first cycle, blend whenever `phase < BLEND`.
But never sacrifice precise scrubbing of once clips, and never introduce a second independent playhead.

### Required New Regression Tests

Keep the existing internal state-machine tests and add at least:

1. A main-page-path seam test `scrubTo(0.999)` → `scrubTo(1.001)`: no big seam jump, blend established.
2. With `blendLoopSeams=false` it still takes the exact modulo, proving manual precise-preview semantics were not silently changed.
3. The same 0.3-second blend gives identical results under 30/60/144 `sample()` calls, proving independence from frame count.
4. The blended quaternion length stays near 1, avoiding hidden scale/skew on model bones.

### P0 Acceptance Criteria

- `web/test-engine.js` all green, count above the current 25.
- The offline `scrubTo()` minimal repro no longer shows a 0.898-scale hard jump.
- Three deployment locations hash-identical; 48795 serves the new code.
- On the main page actually playing golddance, wasshoi, and the cheer family, the 3D model does not flicker through the wrap point.
- Only then may the `SPEC.md` loop item be checked.

## 4. P0: Three v0.6.5 In-Game Regressions

These checks make the game character perform actions; tell the owner before running them. The current code is loaded — do not restart or rebuild first;
keep the existing zombie scene for verification.

### A. In-Game Playback Unblock

1. Play an easily recognizable action (e.g. bow/wave) from the start on the main page.
2. Accept:
   - the character actually moves, not just the web playhead;
   - the log shows `unblocked emote channel for playback`;
   - `/debug/animstate` may keep the 3184 zombie binding — eliminating it is not required.
3. On failure, first verify that `PrepareForPlaybackCommand()` actually matched
   `isEmoting + slot0 IsLoop + non-idle`; do not broaden the fix first.

### B. once Auto-Settle

Use `save:false` to avoid overwriting good data:

```powershell
curl.exe -s -X POST http://localhost:48795/export/clip `
  -H "Content-Type: application/json" `
  -d '{"command":"/wave motion","save":false}'
```

Accept:

- the response has `reason=settled`;
- it ends in about 4–7 seconds, no longer the full 20 seconds;
- use `scripts/fk-hand-height.js` or your eyes to confirm the action really happened; do not mistake fake stillness for success.

### C. Seek Freeze

- In the zombie state, drag into the middle of bow etc. and confirm the game character freezes into the matching pose.
- Current `RequestFreezePreview` has fast-forward and `ResetEmoteState()`, but not v0.6.4's unconditional idle rebind.
- Patch only after reproducing a failure. Recommended: extract "choose idle id + PlayActionTimeline" into a very small private method
  reused by recording, playback unblock, and seek; do not refactor the whole freezer.

### C# Acceptance

- At least one of Debug/Release builds with 0 errors.
- Normal-state playback must not log an unblock for every action; unblocking must only hit the zombie/loop-occupied-slot state.
- Do play, stop, play again, and drag-to-freeze once each, without changing v0.5's stop-zeroing semantics.

## 5. P1: Remaining Small Regression In The Main-Page Scroll Fix

The root cause of lost scroll position on normal add/delete/edit/drag is already fixed: save before `render()` rebuilds, restore after.

The remaining issue is Ctrl+wheel zoom: the `wrap` captured in the event closure is the pre-render old DOM; after `render()` it keeps writing
`wrap.scrollLeft` on a node already detached from the page. The new timeline never receives the mouse-anchor position.

Minimal fix:

```text
render()
newWrap = document.getElementById('timelineWrap')
newWrap.scrollLeft = computed anchor position
bottomRuler.scrollLeft = newWrap.scrollLeft
```

Acceptance matrix:

- With the timeline scrolled to mid: add, delete, change duration, drag an action — horizontal position must not jump.
- With the action list scrolled to mid, operate — the list must not jump back to the top.
- During Ctrl+wheel, the time point under the mouse stays roughly in place.
- ⏹ Stop and Home still zero the playhead per the old semantics — do not treat them as bugs.

## 6. P1: SPEC's "30 Frames Per Second" Needs The Owner To Set The Yardstick

`RecorderService`'s `SampleInterval=1/30` is only a maximum of 30fps; sampling rides on the game's Framework.Update.
Actual keyframe density of the current 264 clips:

- lowest ~10.94fps
- median ~11.25fps
- highest ~16.55fps
- all 264 below 20fps

Three.js interpolates, and the current look has not been judged bad for it; but `SPEC.md` says "每秒 30 帧" — literally unmet.

Give the owner two options; do not silently change the acceptance standard for them:

1. Recommended: change SPEC to "target/max 30fps, actual follows game frame rate, playback interpolated smooth". Current features are then acceptable.
2. If a fixed 30fps is required: resample to 30fps on a unified timeline before export — slerp rotations, lerp translations.
   This grows files and should not be done casually during the v0.6.6 closeout unless the owner explicitly chooses it.

Another related fact: the settle algorithm uses `_frames[^12]` with a comment saying "0.4 seconds ago"; at the actual 11fps that is
about 1.1 seconds ago. Watch this gap when validating v0.6.5 auto-settle; do not trust the comment alone.

## 7. P1: Product And Safety Gates Before Public Release

### 1. The Existing Release Is Not A New-Version Package

- `release\devPlugins\ChoreoHelper\ChoreoHelper.dll` is still 0.6.0.0.
- `site\choreo\repo\latest.zip` / manifest are still 0.5.26.2.
- `release\devPlugins` lacks the current full `dist\ChoreoHelper` web assets.
- So "release the new version" is not swapping one DLL: full staging, manifest, zip, and checksums must be redone.

### 2. Do Not Publish The Current Real Model

`web\dist\ChoreoHelper\model.gltf + model.bin` is the owner's real character model exported via Meddle,
containing personal character appearance and game-exported assets. **Must not go straight into a public GitHub release.**

Release staging should use `web\model-standin.gltf`, or design the model as a user-installed optional local asset.
Do not overwrite the real model the owner uses locally in order to build the package; set up a separate staging directory or packaging script.

### 3. New Users Have No 264 Clips

The clip library exists only in the owner's `%AppData%\...\ChoreoExports\clips`, not in the repo or the release.
Before public release the product shape must be decided:

- Personal tool/dev edition: document that users record their own clips, provide a clear initialization flow; or
- Out-of-the-box edition: research a legally distributable, skeleton-compatible default clip pack.

Until decided, do not advertise "all-action 3D preview works immediately after install".

### 4. Tighten The Local API's Web Origins

48794/48795 both listen on localhost but currently return:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Private-Network: true
```

This widens the ability of arbitrary web pages to call local state-changing endpoints from the browser. SPEC already states "everything runs locally";
before release, allow only explicit origins, e.g. `http://localhost:48795` and necessary 127.0.0.1 variants;
if old GitHub Pages support is still needed, the owner must explicitly decide and only the official site is allowlisted — not `*`.

### 5. No More Hardcoded Version Numbers

`/version` already reads the version from the assembly, but Plugin.cs's startup log and chat message still hardcode `v0.6.5`.
When bumping to v0.6.6, take the version from the assembly everywhere, avoiding another "code is new, log reports old".

## 8. Suggested Execution Order

1. Fix the loop's `scrubTo()` real path; add integration-style unit tests; deploy to three locations; owner visual acceptance.
2. Use the current v0.6.5 zombie scene for the three regressions: playback, once settle, seek.
3. Add the idle rebind only if seek reproduces a failure.
4. Fix the Ctrl+wheel stale-DOM reference and run a browser smoke test.
5. Confirm the "30fps" yardstick with the owner; change SPEC or open a separate resampling task per the decision.
6. After all of the above pass, bump to v0.6.6 and unify the dynamic version string.
7. Before release: decide the clip-library shape, stand-in model staging, and CORS origin scope; produce a full release candidate.
8. Only after the owner's explicit authorization may git be initialized, a remote created, or GitHub published; the standing decision remains "not yet".

## 9. Common Verification Commands

```powershell
# 引擎测试
& 'D:\nodejs\node.exe' 'D:\choreohelper\web\test-engine.js'

# 动作库检查
& 'D:\nodejs\node.exe' 'D:\choreohelper\scripts\trim-loop-clips.js' check

# 当前插件版本与僵尸现场
curl.exe -s http://localhost:48794/version
curl.exe -s http://localhost:48794/debug/animstate

# 关键日志
rg -a "v0\.6\.|unblocked emote channel|prepared actor|Recorder:" `
  "$env:APPDATA\XIVLauncherCN\dalamud.log"

# 编译（Debug 会自动同步 devPlugins；不会自动同步游戏目录网页）
& 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe' build `
  'D:\choreohelper\src\ChoreoHelper.csproj' -c Debug
```

## 10. Key Files

- `SPEC.md`: final acceptance criteria; loop/GitHub currently unchecked.
- `.agent\CONTINUITY.md`: current facts and next steps.
- `web\choreo-engine.js`: loop wrap, sampling, scrubTo.
- `web\test-engine.js`: must add main-page real-path tests.
- `web\preview3d.js`: the integration point reading store.currentTime every frame.
- `web\choreo-helper-app.html`: playhead, scroll restore, Ctrl+wheel.
- `src\AnimationPoseFreezer.cs`: emote-channel hygiene logic for recording/playback/seek.
- `src\PlaybackManager.cs`: in-game timeline playback call chain.
- `src\Exporter\RecorderService.cs`: sample rate and auto-settle.
- `src\HttpServer.cs`, `src\Exporter\ExportServer.cs`: localhost API and CORS.
- `src\ChoreoHelper.csproj`: version and Debug deployment target.

## 11. Explicitly Do Not

- Do not check SPEC loop first; the current 25/25 cannot prove the main-page loop is fixed.
- Do not try to eliminate the 3184 zombie binding itself; the goal is harmlessness plus working features.
- Do not downgrade the "30fps" wording or run mass resampling without the owner's consent.
- Do not upload the real model, private data, or the `%AppData%` clip library to a public repo.
- No publishing, remote creation, commits, or pushes unless the owner explicitly authorizes.
- Do not casually upgrade Three.js, .NET, Dalamud, or refactor the freezer.
- Do not delete historical handoffs, `.bak`, SPEC, AGENTS, or `.agent`.
