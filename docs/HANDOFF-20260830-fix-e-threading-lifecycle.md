# HANDOFF: FIX-E Game-Thread Ownership and Service Lifecycle (2026-08-30, second-audit package 5)

> Conclusion: **FIX-E complete** (code + automated acceptance + nine live read-only/no-side-effect curl items all passed; new DLL hot reload effective). Version still **0.7.1**. Web zero changes. Work package: `docs/AUDIT-20260830-code-repair/05-FIX-E-THREADING-AND-LIFECYCLE.md` (AUD2-010). Not committed, not pushed, not released.

## 1. Pre-work checks

- CONTINUITY/SPEC consistent with code (FIX-A/B/C/D claims all verified true; FIX-D deployment md5 re-checked consistent across all four locations).
- AUD2-010 confirmed in source: HTTP-thread paths touching game memory directly were `GposeToggle`/`DebugPoke`/`GetDebugAnimState`/`StopPreview` (via 48794) and `WalkReset`/`HandleSkeleton` (via 48795); newer paths in the same files, `RequestFreezePreview`/`PrepareForExternalEmote` etc., already used `RunOnFrameworkThread` — the inconsistent convention was real. Both services' Dispose not draining in-flight work, `RecGate` static across instances, `RecorderService.Dispose` swallowing callbacks — all confirmed.

## 2. Thread-ownership table (established this package; all new code must follow it)

| Operation | Allowed thread |
|---|---|
| JSON parsing, path validation, file compression/read, Lumina table reads (thread-safe), managed state words | any thread |
| ObjectTable, local player, DrawObject, Skeleton pointer read/write | framework thread |
| Timeline/EmoteController/GPose state/Unpin/SetAllControlSpeeds etc. game memory | framework thread |
| OS keyboard injection start-condition check (WalkResetCore) | framework thread; key release backstopped by Update/Dispose |
| HTTP response write | request thread; only immutable data may cross (JSON strings/primitives) |

## 3. Change list (all C#, seven files under `src/`, web zero changes)

1. **New `src/InFlightTracker.cs`** (pure managed, no dependencies, datalayertest direct-tested): in-flight request counter + awaitable drain-to-zero (bounded timeout). Handle Dispose idempotent (double release never goes negative).
2. **`AnimationPoseFreezer.cs`**:
   - New `RunOnGameThread` helper: executes inline if already on the framework thread, else schedules via `RunOnFrameworkThread`; all exceptions caught.
   - `StopPreview()` now callable from any thread — state words updated inline, `Unpin`/`SetAllControlSpeeds` scheduled onto the framework thread (no waiting; PlaybackManager calling while holding `_stateLock` cannot deadlock back). `_previewGen++` semantics unchanged.
   - `GposeToggle()`: `_gposeActive` flip stays inline (for return value / GET reads); the game-memory part (batch cancel / stop replay / BaseOverride zeroing / slot speeds) scheduled onto the framework thread.
3. **`RecorderService.cs`**: `_recording`/`_onDone` volatile; new `_disposed` gate (after Dispose, Record/WalkReset are always rejected); new `CancelPending()` (immediately fires in-flight callbacks with error results — HTTP waiters / batch loops no longer ride out the 30s timeout); `WalkReset` scheduled wholly onto the framework thread (`WalkResetCore`, which checks `_disposed` first inside); Dispose = set `_disposed` + CancelPending + release keys + unsubscribe.
4. **`ExportServer.cs`**: `RecGate` now **instance-level** (fixes the static lock carrying old-instance state into a hot-reloaded new instance); constructor gains `IFramework`; `Handle` became async `HandleAsync`, `/export/skeleton` scheduled onto the framework thread for JSON; ListenLoop registers the in-flight handle at accept; Dispose drain order = stop accepting → `_batchRunning=false` → `CancelPending` → `WaitDrained(5s)` → release.
5. **`HttpServer.cs`**: constructor gains `IFramework`; new `GameThreadJson` (executes on the framework thread, 5s cap, timeout → 503); GET `/debug/animstate`, `/debug/poke`, `/dancers` are always scheduled onto the framework thread when the dependency is present (a missing dependency still takes the `?.` short-circuit arm returning no freezer, no game touch); ListenLoop same in-flight registration; Dispose drains (6s) before releasing `_playbackGate`.
6. **`PlaybackManager.cs`**: Dispose calls `Stop()` first (stop playback, clear queue, unfreeze), then unsubscribes.
7. **`Plugin.cs`**: Dispose ordering = command de-registration → the two services (stop accepting + drain) → recording (release keys) → playback → freezer → previewer → executor (dependency-graph order: playback depends on freezer/executor).
8. `/debug/emotefamily`, `/debug/diag`, `/gpose/state`, `/settings/engine` checked and **kept inline**: they read only Lumina (thread-safe) / managed collections / managed statics, no game objects touched.

## 4. Intentional deviations

- **Targeted-test scope note**: the work package's envisioned "fake dispatcher recording threads" test would have required making the freezer injectable with fake game objects — its core heavily depends on FFXIVClientStructs unsafe pointers and is untestable. Landed instead as: the testable drain logic extracted into the pure component `InFlightTracker` and direct-tested (9 items), with the plugin classes as thin wrappers; "game objects accessed only on the framework thread" is guaranteed by "everything goes through the two entries `RunOnGameThread`/`RunOnFrameworkThread`" (grep-verifiable).
- `StopPreview`'s managed state-word part still writes inline on the calling thread (only the game-memory part schedules) — same convention as `GposeToggle`; the cross-thread visibility risk of a managed flag is far below native-memory corruption; no lock added, keeping the change minimal.
- Constructor signature changes (HttpServer/ExportServer gain an `IFramework` parameter): the sole caller Plugin.cs updated in sync; no protocol impact.

## 5. Verification (all actually executed)

- **datalayertest 121→130/130** (9 new: initial drain / counting / timeout false / await zero / double-Dispose idempotent / reuse / 64-thread concurrent drain / instance isolation).
- **Debug + Release 0 errors** (6 pre-existing warnings, none new).
- **Nine live items (game online same day; new DLL 16:12:51 auto hot reload confirmed in dalamud.log)**:
  ① GET /debug/animstate 200 (new framework-scheduling path, returns real slot0/emote state) ② GET /dancers 200 (real character 「巧克力歌剧院」 level 20, 100) ③ GET /export/skeleton 200 (101 bones, computed on the framework thread) ④ /gpose/state 200 ⑤ /debug/diag 200 (inline path unchanged) ⑥ /playback/status 200 ⑦ POST /playback/stop with pairing code 200 ⑧ no-code / wrong-code write → 403 regression ⑨ OPTIONS preflight 204 zero-side-effect regression.
  After reload, dalamud.log shows no new error/exception (the 15:2x~15:3x old errors all predate the reload).
- **library-verify all 106/106 (real plugin online, incl. the rec real-recording scenario)**, **offline-verify 27/27**, lib/mode/clip-check PASS.
- Web three deployment locations md5 identical word-for-word with the FIX-D records (app=06a57ae2, library=fffc72fd, preview3d=5b2e76c8, engine=cffe0213, check=e0e89de7) — direct evidence of zero web changes.
- `git diff --check` clean.
- **Pitfall reused**: Git Bash curl POST without a body gets 411 (Length Required) from http.sys; `-d ""` fixes it — not a plugin issue.

## 6. Left to owner live (does not block the next package)

- Four live stress items (work package section 4): requests during zone switch/teleport don't crash; hot reload during recording leaves no keys/ports/locks behind; control recovers after GPose enter/exit; rapid playback/seek concurrency causes no perceptible anomalies — low-frequency high-risk paths, just observe during daily use; a 「游戏线程忙」 ("game thread busy") 503 is this package's new explicit degradation, not a fault.
- No curls that would move the character (freeze/seek recording class) were done: per audit discipline, waiting for owner to explicitly start them.

## 7. Next package

**OPT-F** (P2: IndexedDB transaction semantics AUD2-011, profile-switch optimization AUD2-012 — the latter is the formal scheduling entry for owner's "switching/loading slow" feedback). After that RELEASE-G closes out. Audit master gate: `docs/AUDIT-20260830-code-repair/README.md`.
