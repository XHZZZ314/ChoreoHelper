# ChoreoHelper · Web/Game Dual Mode & Offline Workflow Plan (2026-08-28)

> This document is the new product mainline confirmed by the owner on 2026-08-28. It continues `HANDOFF-20260828-v066-release-gates.md` but takes priority over the original "prepare release package directly" track.
>
> **As of writing, only the plan and doc updates are done — the new modes described here are NOT implemented yet.** After each stage completes, update `SPEC.md` and `.agent/CONTINUITY.md` from measured results; never check boxes early.

## 1. Final Product Shape

One choreography timeline, two output targets:

1. **Web 3D (default)**
   - Timeline drag, ruler click, play/pause/stop all handled by the web engine.
   - Editing, dragging and playback still work after game and plugin are closed.
   - The web local library provides models, skeleton, clips and the action catalog.
2. **Game character**
   - Only after the user explicitly switches: dragging sends seek/freeze to the plugin.
   - Playback sends `/playback/start`; the web playhead remains the display truth.
   - If the plugin is not connected, show a notice — but never lock up the whole editor.

The UI must only expose "网页 3D / 游戏角色" (Web 3D / Game character) to normal users; stop surfacing historical internal concepts like "classic/enhanced engine", "48794/48795", "S3/v3".

## 2. Why This Mainline First

### Currently reliable foundations

- v0.6.6 runs in-game and passed loop transition, 3D rewind and zoom anchor acceptance.
- `web/test-engine.js` currently 35/35 green.
- Release build 0 errors, 6 pre-existing warnings.
- `%AppData%\XIVLauncherCN\ChoreoExports\clips` holds 264 web-3D JSON clips.
- Real model, standin model, 101-bone matching and multi-dancer same-screen all work.

### Problems with the current product path

- `togglePlay()` requires 48794 `/playback/start` to succeed before the web playhead moves — there is no truly independent web playback.
- Timeline dragging always calls 48794 `/playback/seek`, even when the user only wants web 3D.
- Homepage init is gated on 48794 `/health`; the so-called "offline mode" has no full action catalog, skeleton or library.
- `preview3d.js` pulls skeleton and clips from 48795 on every open; after the game closes, full preview cannot re-initialize.
- The old "⚡ 录制全部" button calls `/bonerec/batch`, but `Plugin.cs` never creates or assigns `BoneAnimator`; at runtime `/bonerec/status` returns `{}`. This chain is dead.
- The 264 clips were actually recorded by the 48795 `RecorderService + ExportServer` JSON pipeline.
- The real character model is a Meddle manual glTF export, not a mesh recorded by ChoreoHelper itself.
- The current 264 raw JSON clips total ~1.18GB. Sampled gzip is ~9%–24% of original size — raw JSON cannot be stuffed into the browser as-is.

So the new plan is to organize and productize existing reliable capabilities — not rewrite the 3D engine or the game playback core.

## 3. Product State Model

### 1. Single output mode

The homepage gets one persistent state, e.g.:

```text
previewTarget = "web" | "game"
default = "web"
```

It decides both "who receives drags" and "who receives playback". Do not add two independent switches that fight each other.

### 2. Web mode behavior

- Opening the homepage shows the 3D workspace directly; the old floating panel can be reused at first, later converted to a fixed/collapsible layout.
- Ruler click / playhead drag: only modify `store.currentTime`; `preview3d.js → ChoreoEngine.scrubTo()` shows the pose.
- Play: no HTTP wait — immediately set local `store.isPlaying=true` and start the existing rAF playhead.
- Pause: stop only the local playhead; no stop sent to the plugin.
- Stop: keep the existing "playhead to zero" semantics but only clear web state.
- The "preview" in action details, in web mode, should position the playhead at that action or play it in 3D — no longer directly fire the game emote.

### 3. Game mode behavior

- On switch, probe 48794 health; on failure show only "game not connected", no fullscreen error page.
- Dragging: keep existing seek merging, serialization and 50ms throttling.
- Playback: keep existing `/playback/start`, `/playback/stop`, background-tab time compensation and the v0.6.6 game-side logic.
- Enter game-playing state only after the game playback request succeeds; on failure the web can switch back to web mode and keep working.
- Switching game→web must explicitly stop/unfreeze game state; never leave a half-frozen character.

### 4. Separate connection state from work mode

`store.connected` can no longer be the master switch gating `render()`. Split at least into:

```text
appReady        = web app + local library available
gameConnected   = 48794 online
exportConnected = 48795 online
```

The editor shows based on `appReady`; the two plugin connection states only gate the relevant buttons.

## 4. Local 3D Library

### 1. Goal

With the game closed, reopening the web page still provides:

- Action catalog (Chinese names, commands, categories, default/measured durations)
- Reference skeleton
- Standin model or user-imported real model
- Recorded clips
- Current character profile and version info
- Choreography drafts

### 2. Storage layering

- `localStorage`: only tiny UI preferences and a draft-compat entry.
- IndexedDB: clip index, profile metadata, recording state, smaller objects.
- OPFS or IndexedDB Blob: compressed clip packages and large files such as glTF/GLB/model.bin.
- Service Worker/PWA cache: web shell, Three.js and static assets without personal data.

Do not keep stuffing large clip JSON into `localStorage`.

### 3. Profile structure

Each personal profile records at least:

```text
profileId
schemaVersion
createdAt / updatedAt
gameVersion
skeletonHash / boneCount
race / sex (when obtainable)
modelKind = standin | imported-gltf | imported-glb
modelFiles
clipIndex{name, type, duration, bytes, hash, recordedAt}
```

Web clip lookup priority:

```text
browser-local clip → plugin 48795 (backfill+cache only when connected) → missing
```

### 4. Code boundary

Build a unified asset provider layer first, named `ChoreoLibrary` or `AssetLibrary`, with:

- `getActionCatalog()`
- `getSkeleton()`
- `getModel()`
- `getClip(name)`
- `putClip(name, data)`
- `listClips()`
- `exportBundle()` / `importBundle()`

`preview3d.js` and the pose preview page must stop calling `fetch(48795)` all over the place; they take data only from the provider layer. Plugin online sync is just one source of the provider layer.

### 5. Compression strategy

This round is **lossless** first, to avoid changing animation math at the same time:

- May start with gzip/CompressionStream on JSON Blobs; provide a JS/server-compatible path when the browser lacks support.
- Clip hashes based on decompressed canonical data, or explicitly record the compression version.
- No quaternion quantization, downsampling or cross-skeleton retargeting in this phase.
- Measure footprint, load time and browser quota after full 264-clip import before deciding whether a more compact binary format is needed.

### 6. Backup and migration

Provide a user-visible "export 3D library" file containing manifest, skeleton, models and clips, plus re-import. Extension can be decided later, but the format must be versioned; validate skeleton and hashes before import.

## 5. Model Initialization Route

ChoreoHelper currently cannot export skinned character meshes, so it cannot promise "click record and get a real character model". The stable route is:

1. Everyone starts with the in-repo `model-standin.gltf` so web 3D works immediately.
2. Users who want their personal real model export glTF/GLB via Meddle, then import by picking the file in the web page.
3. The web checks skinned mesh, bone-name match count and external buffers; store glTF + bin together into the library when necessary.
4. Real models go only into the local library — never copied to public staging.
5. Gear change = swap model only; race/sex change or skeleton hash change = create/rebuild the profile.

If Meddle later offers a stable API, evaluate auto-import separately; this phase does not reverse-implement a game model exporter.

## 6. New "Record 3D Action Library"

### 1. Replace the old entry

Remove the old "⚡ 录制全部" button from the main UI; add "录制 3D 动作库" (Record 3D Action Library). Move the old "📷 拍照精确" and "classic/enhanced engine" out of the normal toolbar into an advanced/diagnostics area; decide whether to delete the underlying code after game-mode regression is done.

### 2. Recording capabilities

The new panel provides at least:

- Quick init of common actions
- Full init of all available actions
- Record only clips missing from the library
- Check from the action list and record
- Single-failure re-record
- Cancel and resume from breakpoint

### 3. Reliable orchestration rules

Promote the proven `scripts/batch-record.js` strategies into formal product logic:

- Trigger commands uniformly get the `motion` variant
- At least 2.5s between adjacent recordings
- Persistent/loop clips interrupted with `/beckon motion` after recording completes
- Posture clips (doze, kneel, pose, grovel, lounge, groundsit, playdead, situps, winded, savortea) call `/export/walkreset` after recording
- Run the existing channel hygiene sequence before recording
- Log settled/timeout, duration, frame count and failure reason
- Basic stillness/contamination QC; facial actions get separate rules — do not misjudge them with body-amplitude thresholds

### 4. Front/back-end responsibilities

Recommended split: the plugin handles "reliable recording and reset of the current single clip"; the web handles queue, selection, progress and writing results into the browser library. That way the web can resume from the manifest after refresh, and users can handle failures item by item.

Existing `/export/clip` continues as the single-clip base; the batch endpoint needs formal state and a result list — the current simplified `/export/batch` is not the final UI backend.

### 5. First-use experience

Init wizard order:

1. Check game/plugin connection
2. Create the character profile and save the skeleton
3. Use the standin model or import a Meddle model
4. Choose "quick" or "full" action recording
5. Show progress, failures and ETA
6. Write into the browser library and tell the user they can close the game and keep working

The full library currently measures ~1h45m — the button text must stop saying "about 15 minutes".

## 7. Stages and Acceptance Gates

### Stage 1: Mode split (first actual dev task)

Goal: truly separate web playback from game playback while still using the existing plugin data sources.

Main changes:

- `web/choreo-helper-app.html`
  - Add `previewTarget`, `gameConnected`, `exportConnected`
  - Remove the `render()` hard gate on `store.connected`
  - Split `togglePlay()` into local playback control and a game request wrapper
  - `sendSeek()` only called in game mode
  - New mode-switch UI, default web
- `web/preview3d.js`
  - Auto open/show by default
  - Still read-only on the same `store.currentTime`
  - Status text distinguishes "web assets missing" from "plugin not connected"

Stage acceptance:

- With 48794 disconnected/closed, the existing page can still web-play, pause, stop and drag 3D.
- In web mode, dragging produces zero seek requests to 48794.
- Game mode play/stop/drag behaves identically to v0.6.6.
- Space, Home, stop-to-zero and background-tab compensation do not regress.
- `web/test-engine.js` stays all green; add page-controller-level tests or a repeatable diagnostics page.

### Stage 2: Web launches without the plugin

Goal: reopening the web page works with the game closed.

Main changes: provide a web entry not depending on the 48795 static service (static site/PWA); bundle an offline action catalog snapshot and the standin model; probe the plugin in parallel at init instead of blocking the homepage with a fullscreen connection error; state online/offline honestly, never fake "connected".

Stage acceptance:

- With the game fully quit, a fresh web page shows the action panel, drafts, timeline and standin model.
- When the game starts afterwards, connection status refreshes without reload or draft loss.

### Stage 3: Local library

Goal: skeleton, models and clips load from the browser library.

Main changes: new asset provider layer, IndexedDB/OPFS, lossless compression, cache-first with plugin backfill, library export/import.

Stage acceptance:

- After importing at least bow/wave/loop action types with the plugin connected, closing the game and refreshing the web still plays them.
- Full 264-clip import reports clear duration, footprint and failures.
- Corrupted/version-incompatible library packages are rejected without damaging the existing library.

### Stage 4: Formal recording center

Goal: the new record button covers single, missing, quick and full recording plus reliable QC.

Stage acceptance:

- One real-machine test round each for posture, once and loop.
- Cancel, page refresh and continue never lose completed results.
- After recording, no manual file copying — the web library is immediately usable.

### Stage 5: Security, legacy cleanup and release

Goal: once the new mainline is stable, retire old entries and produce a publishable release candidate.

Stage acceptance:

- CORS restricted to explicit origins + minimal pairing/authorization in effect.
- Release staging contains only the standin model — no personal clips or real models.
- Web sources generate staging via a script in one shot; no more manual three-place sync.
- Full regression of v0.5 game playback, seek, macros and lyrics.
- Remote site updates or GitHub publishing only after explicit owner authorization.

## 8. Legacy Handling Boundaries

### Hide / move out of normal UI now

- `⚡ 录制全部`
- `📷 拍照精确`
- Bottom "classic/enhanced engine" toggle
- Internal terms like 48794/48795

### Code deletable only after the new chain passes acceptance

- `src/BoneAnimator.cs`
- `/bonerec/*` routes and status polling
- GPose auto-record branches not needed by the new game mode
- `store.engine` and the classic/pin normal-user setting

Before deleting, re-confirm call sites with `rg` and run game-mode seek/playback regression; do not bulk-delete `AnimationPoseFreezer`'s stable paths just because they "look old".

### Keep but exclude from release packages

- All historical handoffs in `docs/`
- `src/Exporter/*.bak`
- `.agent/`
- Diagnostic pages `web/p3d-check.html`, `web/p3d-trace.html`, `web/jscheck.html` etc. (can move to `tools/dev` later)
- `site/` v0.5 online backup — decide its archive location only after the new version is released and verified

### Obvious temp files, handled in the cleanup phase

- `_em2.json`
- `web/_em.json`
- `web/_batch.json`
- Retired `web/serve-app.ps1`

These have no production callers today, but deletion/moves happen in a dedicated cleanup phase with diff checks — never mixed into a feature change batch.

## 9. Security and Release Design

- Both ports currently send `Access-Control-Allow-Origin: *`; must be tightened before the public site goes live.
- At minimum, separate read-only endpoints from write endpoints that control the character / recordings.
- When the official static site accesses localhost, the plugin should validate `Origin` and require a short-lived pairing token or explicit user authorization for write operations.
- Tokens stay on the local machine — never in URLs, logs or project files.
- localhost stays loopback-bound; do not widen to LAN.
- Public packages always ship the standin model; real models and clip assets are established locally by the init wizard.

## 10. Risks and Non-Goals

- Browser storage quota may run out: do compression and capacity probing first, and provide library export.
- Browser data is isolated per origin: finalize the official site address before building the full library, to avoid an origin change looking like "data lost".
- Do not rewrite 3D math, upgrade Three.js, or merge the two C# servers during the mode-split stage.
- Do not do lossy quantization, cross-race retargeting or per-dancer models in the library stage.
- Do not treat the current personal 264 clips as a publicly distributable default pack.
- Do not delete historical handoffs, `.bak`, SPEC, AGENTS or `.agent`.

## 11. First Work Task (Directly Executable)

Next session starts at "Stage 1: Mode split", strictly scoped to:

1. Default web mode; 3D shown automatically.
2. Web playback waits for no plugin and calls no game start/stop.
3. Web-mode dragging sends no seek/freeze.
4. Game mode fully preserves existing v0.6.6 behavior.
5. With the plugin disconnected, the editor still opens and restores drafts; full catalog offline-ization waits for stage 2.
6. When done, run the 35 engine tests, the Release build, browser smoke of both web/game modes and the on-machine game regression, then update CONTINUITY.

In this stage: do not delete `BoneAnimator`, do not change the clip data format, do not start IndexedDB, and do not publish.
