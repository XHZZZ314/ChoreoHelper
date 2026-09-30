# HANDOFF 2026-08-30 — CORE-HTTP responsive local API (48794)

Package: `docs/AI-BACKLOG.md` #2 (P2 architecture). Status: **implementation + unit acceptance closed; live curl is an owner tail.** No commit/push/publish performed.

## Problem (mechanism confirmed in current source before the fix)

- `src/HttpServer.cs` `ListenLoop` awaited `HandleRequest` inline before calling `GetContextAsync` again: one request in flight blocked acceptance of the next (head-of-line blocking).
- `/lyrics/search` and `/lyrics` await the NetEase API with a 10s `HttpClient.Timeout`; game-thread diagnostics can wait up to their 5s dispatch cap. Stop/seek/status therefore queued behind unrelated slow reads.

## Fix (minimal root cause + house patterns)

- New pure module `src/HttpDispatchPolicy.cs`: lane classification — `GET /lyrics/search` and `GET /lyrics` → `Outbound` (cap 4); everything else → `Fast` (cap 32). HEAD on lyrics paths stays fast (the handler only awaits outbound work for GET).
- New pure module `src/RequestDispatcher.cs`: per-lane bounded concurrency; a full lane **rejects immediately** (`TryAccept` returns false → caller replies 503 `{"error":"busy"}`) instead of queueing, so stop never waits behind anyone. In-flight registration is synchronous at accept time and slot/count are recycled in one `finally` (work-body exceptions cannot leak capacity). `Task.Run` receives **no** cancellation token — an accepted request is never unscheduled (the pattern PLUG-6 flags in ExportServer is prevented here by construction); cancellation reaches work via the lifetime token inside the handler.
- `src/HttpServer.cs`:
  - `ListenLoop` dispatches each accepted context immediately (`DispatchAccepted` → `TryAccept` → `RunAccepted` → `HandleRequest`).
  - POST mutations (playback/preview/bonerec/gpose/settings) run under one `_postGate(1,1)` that replaces `_playbackGate` — this preserves exactly the old accept-level POST↔POST mutual exclusion (all gate bodies are millisecond-fast synchronous handlers).
  - Lyrics `SendAsync` now receives the lifetime `CancellationToken`, so a pending outbound request aborts at Dispose instead of stalling the 6s drain window.
  - `Dispose` drains via `_dispatcher.WaitDrained(6s)` then disposes dispatcher + gate (FIX-E ordering unchanged).
- Fast-lane reads were already concurrency-designed: `PlaybackManager` has `_stateLock` (HTTP vs game thread), freezer entry points are any-thread with `_previewGen` guards, game-thread reads keep their 5s `WaitAsync` cap. ExportServer (48795) already dispatched concurrently; this brings 48794 to the same model.

## Behavior change summary

- Intended: GETs (status/seek-adjacent reads/diagnostics) no longer queue behind slow requests; >4 concurrent lyric requests get an honest 503 (web `apiFetch` surfaces it as the existing "搜索失败/失败" toast); a saturated fast lane (only reachable via hostile flood) 503s instead of queueing.
- Preserved: POST↔POST serialization, all endpoint/auth/CORS semantics (SEC-1 untouched), playback gate semantics, bind-retry loop, dispose-drain ordering.

## Verification (observed in this package)

- `datalayertest` (Release): **221/221** (was 180; +41 CORE-HTTP: 9 lane policy, 11 delayed-lyrics stop/seek/status concurrency, 9 saturation/reject, 12 exception/drain/concurrency). No existing assertion weakened.
- Plugin `ChoreoHelper.csproj` Release build: **0 errors / 0 warnings**. (Release config does not copy to devPlugins — live install untouched.)
- Web files unchanged → deploy-root sync not applicable; browser suites not re-run (no web surface changed).

## Live acceptance (observed on the owner's machine, 2026-08-30 evening)

Game online, plugin hot-reloaded via the in-game plugin manager (also exercises the new Dispose/drain path on unload). Old build was still installed when testing started, which allowed a true before/after on the same machine:

- Old DLL live repro (12 parallel `/lyrics/search` + 3 simultaneous probes): `/health` **2.78s**, `/playback/status` **2.77s**, `POST /playback/stop` **2.77s** (baseline ~1.2ms) — head-of-line blocking reproduced on real hardware, including delayed emergency stop.
- New DLL, same storm, probes fired at storm start: `/health` **1.1ms**, `/playback/status` **1.6ms** (200), `POST /playback/stop` **2.5ms** (200) — stop executes while 12 outbound requests are still in flight.
- Outbound lane cap 4: 8 parallel lyric searches → 4×200 with real NetEase results + 4×503 `{"error":"busy","message":"请求繁忙，请稍后重试"}`. No queueing.
- SEC-1 checklist on the new DLL: anonymous set stays 200 (health/capabilities/version/classjobs/lyrics); private reads 403 without token and 403 with wrong token, 200 with the pairing token (dancers/status/gpose/bonerec); POST stop 403 without/wrong token.
- Rollback note: the pre-CORE-HTTP DLL was backed up to `%TEMP%\choreo-dll-backup\ChoreoHelper.dll.pre-corehttp` before overwriting devPlugins.

## Remaining owner tails

- Pose-viewer pairing overlay browser smoke (SEC-1 tail, needs a browser session); then the owner can flip the pending SPEC §5 item.
- ExportServer PLUG-1..6 hardening remains a separate open package (FIX-J).

## Files changed

- New: `src/HttpDispatchPolicy.cs`, `src/RequestDispatcher.cs`.
- Modified: `src/HttpServer.cs`, `src/tests/datalayertest/{datalayertest.csproj,program.cs}`, `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md`, this handoff.
