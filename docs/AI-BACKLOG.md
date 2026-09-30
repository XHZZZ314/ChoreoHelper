# ChoreoHelper repair and architecture backlog

> Authoritative open-work list after the 2026-08-30 full review and ARCH-1. This is routed reading, not a default startup document. Source/tests override stale text. Claim one package at a time and update status here at close.

## One-sentence start command

> 先读 `AGENTS.md`、`docs/README-AI.md` 和 `.agent/CONTINUITY.md`，然后从 `docs/AI-BACKLOG.md` 按顺序领取第一个未完成且未阻塞的工作包，先复现并补回归测试，再做最小根因修复、运行 `docs/AI-TEST-MATRIX.md` 对应验收，并按其自测要求把本环境能测的全部自己测掉（按风险加做模糊/幂等、真实形状冻结、浏览器冒烟等），只把确需游戏实机、覆盖实装或主人授权的项留给主人并在交接里写明原因；同步三个部署根并更新 CONTINUITY/交接，未经主人明确授权不要提交、推送或发布。

## Package order

| Order | Package | Priority | Status | Purpose |
|---:|---|---|---|---|
| 1 | SEC-1 | P1 release blocker | CLOSED (curl done; overlay smoke + SPEC flip pending owner) | Protect private local reads; keep file-mode usable through pairing |
| 2 | CORE-HTTP | P2 architecture | CLOSED (incl. live pass) | Remove request head-of-line blocking; preserve fast stop/seek |
| 3 | ACTOR | P2 correctness | CLOSED (incl. owner live pass 2026-08-31) | Stop multi-dancer events mixing on one game character |
| 4 | FIX-I | P2/P3 reliability | CLOSED (2026-08-31) | 3D init cancellation and recoverable/atomic library import |
| 5 | WEB-RACE | P2/P3 correctness | CLOSED (2026-08-31) | Close controller races and revision drift |
| 6 | ENGINE-CURSOR | P2 latent correctness | CLOSED (2026-08-31) | Make scrub/timeline replacement cursor semantics safe |
| 7 | FIX-J | P2/P3 plugin reliability | CLOSED (2026-08-31; live tails for owner) | Thread dispatch, timeout, port recovery, callback/lifecycle hardening |
| 8 | FIX-K | P2 release blocker | CLOSED (2026-08-31; publication still owner-gated) | Binary privacy scan, clean provenance and fresh staging |
| 9 | WP-5-DOC | Product architecture | CLOSED (2026-08-31; foundation + wiring landed) | Canonical performance document, migration and compiler foundation |
| 10 | EXEC-CORE | Product/safety | CLOSED (2026-08-31; live acceptance + lead calibration owner tails) | Dedicated safe show runner/scheduler/guard |
| 11 | ARCH-2 | Maintainability | DEFERRED | Replace compatibility globals and split remaining monoliths incrementally |
| 12 | HYGIENE | P4 | DEFERRED | Low-risk dead code, harness and rendering cleanup |

Do not start WP-5 merely because it is larger or more visible. The security, concurrency, actor and persistence contracts constrain its schema and executor design.

## Global definition of done

Every package must:

1. Re-check current source and reproduce the failure or establish the mechanism from direct code/test evidence.
2. Add a focused regression before or with the fix; never weaken an existing assertion.
3. Keep behavior outside the package unchanged and preserve old project/library data through migrations.
4. Run the task-routed checks in `AI-TEST-MATRIX.md`, then follow the self-test mandate there: deepen the self-testing as risk warrants (repro red/green, fuzz/idempotency, real-shape freeze, browser smoke) so only genuinely owner-bound checks remain; record commands and observed counts, including any flake, and list leftover owner tails with the reason each cannot be self-tested.
5. Sync web product files to source-dist, devPlugins and game roots and prove recursive/hash consistency when web files change.
6. Update this package status, `.agent/CONTINUITY.md`, relevant SPEC acceptance only when owner acceptance is real, and one concise handoff.
7. Leave release staging untouched unless the package is FIX-K or the owner explicitly requests a rebuild. Never commit/push/publish without explicit authorization.

## 1. SEC-1 — private local reads

**Problem evidence**

- `src/LocalApiSecurity.cs` trusts literal `Origin: null` and returns `Access-Control-Allow-Origin: null` plus Private Network permission.
- `null` is not unique to the owner's `file://` app; opaque-origin documents such as sandboxed frames can also produce it.
- Pairing protects writes, but private reads remain anonymous: `/export/list`, `/export/getclip`, `/export/skeleton`, personal `model.gltf`/`model.bin`, and `/dancers`.
- Live read-only probe confirmed `Origin: null` could enumerate all 264 personal clip entries.

**Required result**

- Pair/authenticate every response containing personal clips, skeletons, models or character data. Keep only capabilities/health and deliberately public catalog metadata anonymous.
- Preserve the daily `file://` workflow with the existing pairing token or a narrowly scoped local read session; never trust `null` alone.
- Set and test the official site origin when it exists; unknown/opaque unpaired origins receive no readable private response.
- Extend security mocks and live read-only curl tests for OPTIONS, HEAD/GET, right/wrong/missing token and official/file origins.

**CLOSED 2026-08-30** (see `HANDOFF-20260830-sec1-private-reads.md`): pure policy `src/ReadAuthPolicy.cs` gates paired reads on both ports; CORS keep `null` for the file:// transport only — authorization is token-based. `PublicSiteOrigin` is a settable static field (default unchanged). Web attaches `X-Choreo-Token` to private reads (main app gated on `capsOk`; pose-viewer got its deferred pairing entry); harness seeds the token into pages. Verified: datalayertest 180/180, Release build clean, Node suites + shell all green, library-verify 117/117 (sec scenario 31/31), offline-verify 38/38, clip-check 119/119 on both source-dist and game root, three deploy roots recursive diff zero. **Owner tails**: load the rebuilt DLL (never overwrite the live install without authorization), then run the read-only curl checklist in the handoff; smoke the pose-viewer pairing prompt and the export-connection indicator (shows "not connected" until paired — honest SEC-1 semantics).

## 2. CORE-HTTP — responsive local API

**Problem evidence**

- `src/HttpServer.cs` accepts one request and awaits `HandleRequest` before accepting the next.
- `/lyrics/search` and `/lyrics` can wait on an external NetEase request with a roughly 10-second timeout; game-thread diagnostics can also wait.
- Stop, seek and status can therefore queue behind unrelated slow work. This cannot be the emergency-stop path for the final executor.

**Required result**

- Accept requests independently with bounded concurrency and cancellation; retain state-specific semaphores where mutation serialization is required.
- Isolate outbound lyric work from game-control work. Stop/abort must have a short, bounded path that does not share a slow request queue.
- Add a delayed-lyrics concurrency test proving stop/seek/status complete while lyrics remains pending, plus clean Dispose/drain coverage.

**CLOSED 2026-08-30** (see `HANDOFF-20260830-core-http-responsive-api.md`): `ListenLoop` no longer awaits handlers inline — each accepted context is dispatched via the new pure `RequestDispatcher` (per-lane bounded concurrency, full-lane reject with 503 instead of queueing, InFlightTracker-based drain). Lane classification lives in pure `HttpDispatchPolicy` (GET `/lyrics/search` + `/lyrics` → outbound lane cap 4; everything else → fast lane cap 32). Old POST↔POST mutual exclusion is preserved by a single `_postGate` (replaces `_playbackGate`); outbound lyric `SendAsync` now carries the lifetime token so Dispose drain is not stalled by a pending 10s request. Verified: datalayertest 221/221 (was 180; +41 CORE-HTTP checks incl. delayed-lyrics stop/seek/status concurrency, lane saturation reject, exception/drain), plugin Release build 0 errors / 0 warnings. **Live pass same day**: old DLL reproduced the block (probes 2.77–2.78s behind a 12-lyrics storm), new DLL answers the same probes in 1–2.5ms, 8 parallel lyrics → 4×200 + 4×503 busy, hot reload clean; SEC-1 curl checklist green on the new DLL.

## 3. ACTOR — game-preview actor semantics

**Problem evidence**

- Web `buildGameClips` sends every unmuted dancer with `actorId`.
- Normal plugin playback in `src/PlaybackManager.cs` executes all events on the local character and does not use `ActorId` to select/filter a target.
- Seek selects per-actor plans but the local display chooses one latest/tie-broken actor, which can disagree with the user's intended dancer.

**Required result**

- For the current single-local-character product, require an explicit preview dancer and send/filter only that actor; never silently mix dancers.
- UI must make the selected game-preview dancer obvious and preserve web multi-dancer rehearsal separately.
- WP-5 uses stable actor IDs, not array positions. Future multi-actor execution must map package actor IDs to runtime actors explicitly.
- Add payload, normal playback and seek tests with at least two dancers and overlapping events.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-actor-preview-dancer.md`): web now requires an explicit game-preview dancer. `buildGameClips(dancers, globalLyrics, isMutedFn, previewActor)` filters to that one dancer (explicit selection overrides solo/mute; out-of-range index yields global lyrics only) while the no-arg form keeps the full view for clip-check. `choreo-app.js` persists `store.gameActor` (localStorage `choreo_gameActor`), sends only the preview dancer from `gameStartPlay`/`pushGameTimeline`, and shows a 🎮预览 badge per dancer header in game mode plus bottombar/toast/title labels; switching dancers pushes the snapshot and re-seeks live. Plugin side: pure `PreviewActorPolicy.Validate` rejects mixed-actor payloads with 400 in `ParsePlaybackClips` (start + timeline share the choke point), so a stale multi-dancer web can never silently mix again. Verified: test-edit 93/93 (new 8b section red→green, 2-dancer overlapping events), datalayertest 232/232 (+11 ACTOR checks incl. preview-payload seek), Release build clean, clip-check 119/119 on source-dist and game root, three deploy roots byte-identical. **Owner live pass 2026-08-31: accepted** — web-side single-dancer preview verified on the real game (the plugin-side 400 guard ships in the built DLL and activates on the next hot-reload; defense-in-depth only).

## 4. FIX-I — library and 3D robustness

### PREVIEW-1: stale asynchronous initialization

- `preview3d.init()` can continue after `hardReset()` during a profile switch; `initing` is not invalidated and stale awaits resume against cleared state.
- Add a generation/cancellation token, check it after every await, and make reset/retry deterministic offline and online.

### LIB-1: permanently cached rejection

- `_profEnsured` and `_clipsMigrated` cache rejected promises forever. One transient IndexedDB/quota failure poisons the session until reload.
- Reset the cached promise on rejection; migrations must remain idempotent and retryable.

### LIB-2: legacy empty skeleton hash

- Legacy migration can create profiles with empty `skeletonHash`; CHLB v2 preflight rejects that program-produced backup as tampered.
- Backfill the hash from skeleton content or define a safe recompute path; preserve honest tamper detection.

### LIB-3: catalog outside v2 preflight

- CHLB v2 catalog JSON is not parsed/shape-validated before writes. A corrupt catalog can fail after profiles were written and be misreported as a clip failure.
- Parse/hash/shape-check every segment before the first write. A bad v2 bundle must produce zero writes and a segment-specific Chinese error.

**Acceptance:** extend `test-library` for transient retry, switch-during-load, legacy self-export round trip and corrupt-catalog zero-write behavior; then run library/offline/profile-switch integration.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-fixi-library-preview-robustness.md`): PREVIEW-1 — `preview3d.init()` now carries a generation token (`_initGen`); `hardReset()` bumps it and releases `initing`, every `await` in init/loadModel/loadModelFromProfile/cacheModelToProfile re-checks it, and only the current generation may write module state or lifecycle flags (stale branches exit silently). LIB-1 — `_profEnsured`/`_clipsMigrated` clear themselves on rejection, so one transient IndexedDB failure no longer poisons the session; migrations stay idempotent. LIB-2 — legacy migration computes the profile hash from skeleton content when the old record has none, `loadProfiles()` backfills persisted empty-hash profiles from content, and v2 preflight only rejects when a non-empty recorded hash mismatches (old-program backups import; honest tamper detection preserved). LIB-3 — v2 preflight now parses and shape-checks the catalog segment before the first write; a bad bundle yields zero writes and a segment-specific Chinese error. Verified: test-library 91/91 (was 71; +20 new checks — all four acceptance behaviors covered, red→green observed), initrace scenario in offline-verify 7/7 (red with 4 failing checks before the fix, failure mode exactly the predicted "初始化失败: null bones" dead panel), node suites green (engine 40, edit 93, check 73, projects 96, shell 33), offline-verify all 40/42 (the 2 fails are the pre-existing SEC-1 harness tails), library-verify all 116/117 (the 1 fail is the pre-existing SEC-1 rec tail), clip-check 119/119 on source-dist and game root post-sync, three deploy roots recursively identical.

## 5. WEB-RACE — controller correctness

### WEB-1: macro debounce crosses dancers

- The 600ms macro timer reads the active dancer when it fires. Typing for dancer A and switching tabs can overwrite dancer B.
- Capture stable actor/project identity at input time and discard stale timers.

### WEB-2: stale seek retry overtakes a newer seek

- A 409 timeline re-push retry can resend an older time after a newer seek was queued.
- Use a seek generation/sequence and allow only the newest request to retry/commit.

### WEB-3: realtime check renders during drag

- The check scheduler may full-render while a clip is being dragged, recreating the DOM under the pointer.
- Defer check result rendering until drag completion; preserve one final check.

### WEB-4: measured duration leaves plugin snapshot stale

- Automatic measured-duration correction persists/renders but does not bump `timelineRevision`.
- Treat a changed duration as a timeline mutation and push/reconcile the new snapshot.

### WEB-5: empty timeline click does not seek game

- Empty-area click changes web playhead but does not call the game seek path, unlike ruler/marker/problem jumps.
- Confirm intended semantics; if game mode is selected, make all explicit playhead jumps consistent and test them.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-webrace-controller-races.md`): all five reproduced in a new clip-check section ㉚–㉞ (red observed, exact predicted failure modes), then fixed minimally. WEB-1 — macro sync timer captures the dancer index at input time instead of reading `store.activeMacroTab` when it fires (typing A then switching tabs no longer overwrites B). WEB-2 — `sendSeek` carries a monotonically increasing sequence; only the newest intent may retry after a 409, and a queued newer seek is promoted instead of being overtaken by the stale retry. WEB-3 — `dragClip` raises `store._clipDragActive`; `runRealtimeCheck` skips and `applyCheckIssues` discards results while it is set, and the drag-end render schedules the one final check (issue strokes reflect the final layout). WEB-4 — `refreshMeasured` calls `bumpTimelineRev()` after automatic duration correction, so `timelineRevision` increments and the corrected snapshot is pushed to the plugin (game mode, debounced). WEB-5 — empty-area click now calls `sendSeek(store.currentTime)`; semantics confirmed as "every explicit playhead jump seeks in game mode" (`sendSeek` itself stays a web-mode no-op, so 3D rehearsal is unchanged). Verified: clip-check 134/134 red→green on source-dist and game root (was 119; +15 checks), node suites green (engine 40, edit 93, check 73, projects 96, library 91, shell 33), offline-verify all 45/45, library-verify all 117/117, three deploy roots recursively identical. C# and release staging untouched.

## 6. ENGINE-CURSOR — timeline cursor invariants

### ENGINE-1: `scrubTo` leaves event cursor stale

- `scrubTo(t)` changes time but does not realign `timelineIdx`; later `play()+update()` may replay entries before t.

### ENGINE-2: `setTimeline` aligns using old time

- The public `setTimeline(entries)` path invokes the timeline setter while the old time is still active, then resets time to zero. Reproduction observed `time=0` with `timelineIdx=2`.

**Required result**

- Define one invariant: `timelineIdx` is always the first not-yet-fired entry at the current engine time.
- Reset/align in the correct order for timeline replacement, scrub, stop and play.
- Add mixed `scrub -> setTimeline -> play/update` and `scrub -> play` regressions while preserving production preview behavior.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-engine-cursor.md`): the invariant is now stated at the engine section head and enforced on every playhead-mutating path — `scrubTo`/`seek` realign the cursor via one `_alignCursor()` binary search (`timelineIdx = firstAtOrAfter(timeline, time)`, `start == t` counts as pending, consistent with `update()`'s `time >= start` firing), and `setTimeline` resets `time` to 0 **before** assigning the timeline so the setter aligns against the new time instead of the old one (the reported `time=0` + `timelineIdx=2` repro). Production web preview is untouched: preview3d never calls `engine.play()` (playhead truth stays `store.currentTime`, `update()` runs the paused sample path); the only runtime delta is one extra O(log N) search per `scrubTo`, covered by the existing AUD-018 benchmark. Verified: `test-engine.js` 47/47 red→green (was 40; +7 new checks — forward/backward `scrub -> play`, `setTimeline` order, mixed `scrub -> setTimeline -> play/update`, and an invariant property sweep over 11 targets incl. duplicate starts and out-of-range; red observed 40/7 with exactly the predicted failure modes), all six Node suites green (edit 93, check 73, projects 96, library 91, shell 33), clip-check 134/134 on source-dist and game root, offline-verify 45/45, library-verify 117/117, `choreo-engine.js` byte-identical across the three deploy roots (four-way md5 equal, recursive diff zero vs both remote roots). C# and release staging untouched.

## 7. FIX-J — plugin thread, lifecycle and recovery

### PLUG-1: HEAD game-thread bypass

- HEAD for `/debug/animstate`, `/debug/poke` and `/dancers` can fall through to listener-thread game reads because dispatch branches check only GET.
- Route HEAD through the same game-thread path or reject it consistently.

### PLUG-2: skeleton dispatch has no timeout

- 48795 `/export/skeleton` can await the framework thread indefinitely.
- Apply the same bounded timeout/503 policy as 48794.

### PLUG-3: 48795 bind is one-shot

- ExportServer gives up permanently after one port-bind failure while 48794 retries.
- Use a bounded/cancellable bind loop and verify hot reload/Dispose.

### PLUG-4: recording callback does CPU and disk IO on game thread

- Clip JSON serialization, quality scan and multi-megabyte file writes run from the framework callback.
- Capture an immutable result on the game thread; serialize, validate and write on the awaiting/background path.

### PLUG-5: RecorderService publishes `_recording` too early

- `_recording=true` is set before timestamps/state reset; a framework tick can see stale timing and instantly timeout a new recording.
- Initialize all state first and publish the volatile active flag last.

### PLUG-6: accepted request can leak in-flight count

- ExportServer calls `_inFlight.Begin()` and then `Task.Run(..., ct)`. Cancellation after Begin but before scheduling/execution may skip the handler `finally`.
- Do not cancel scheduling of an already accepted request, or dispose the handle on every scheduling failure; add deterministic cancellation/drain tests.

### PLUG-7: wall-clock command throttle

- `GameCommandExecutor` uses `DateTime.Now` for a 200ms throttle. Clock changes can stall or burst commands.
- Use `Stopwatch`/`Environment.TickCount64` monotonic time and test boundary behavior.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-fixj-plugin-thread-lifecycle.md`): all seven items fixed minimally in the plugin. PLUG-1 — the three game-thread dispatch branches in `HttpServer.HandleRequest` (`/debug/animstate`, `/debug/poke`, `/dancers`) now accept GET or HEAD, so HEAD rides the same `GameThreadJson` framework-thread path with its 5s cap instead of falling through to listener-thread game reads; HEAD `/lyrics` stays GET-only (404, no game touch). **Live self-test same day found a second, pre-existing HEAD root cause: HttpListener throws when an entity body is written to a HEAD response, so every body-bearing HEAD on both ports had always been 500** (even `HEAD /health`; the stray `Content-Length` on the 500 matched the never-written body). Fixed in the two shared writers — `LocalApiSecurity.RespondJson` and the `HttpServer` response tail now keep `Content-Length` and skip the body write for HEAD, making the advertised "GET, HEAD" semantics real. PLUG-2 — `HandleSkeletonAsync` mirrors `GameThreadJson`: 5s `WaitAsync`, timeout writes 503 `game thread busy`. PLUG-3 — `ExportServer.Start` now runs a `BindLoop` identical in schedule to 48794 (2s×90 then 30s, `_cts`-cancellable, Dispose-race closes a just-bound candidate). PLUG-4 — `RecorderService.Finish` does O(1) work on the game thread: it flips the flag, swaps the frame list out (fresh instance assigned back) and hands the immutable frames to a background `Task.Run` where `BuildClip` (now a pure static), result logging and the consumer callbacks run — clip JSON serialization, quality scan and multi-MB writes leave the framework thread for both the single and batch paths. PLUG-5 — `Record` initializes command/callback/frames/timing state first and publishes the volatile `_recording` flag last (the stale-`_startedAt` instant-timeout repro is dead by construction). PLUG-6 — the accepted-request `Task.Run` in `ExportServer.ListenLoop` no longer carries the cancellation token (same source contract `RequestDispatcher` documents: a canceled-before-schedule work body skips its `finally` and leaks the in-flight count). PLUG-7 — the 200ms throttle judgment moved to a new pure `CommandThrottlePolicy` fed `Environment.TickCount64` (boundary semantics unchanged: exactly 200ms passes). Verified: datalayertest **245/245** red-baseline→green (was 232; +13 FIX-J checks — 9 throttle boundary incl. delta-0/negative clock, 3 PLUG-6 scheduling-contract incl. isolated leak reproduction, 1 PLUG-1 fast-lane contract; the five Dalamud-bound items establish mechanism from code evidence + pattern reuse of the live-verified 48794 implementations — no red/green possible without Dalamud fakes), plugin Release build 0 errors / 0 warnings. Web untouched → deploy roots not synced (C# reaches the owner via the next DLL load). **Live-probe evidence (old DLL still loaded at first pass):** GET `/dancers` paired 200 in 58ms while every body-bearing HEAD 500'd — exact pre-fix failure mode. **Full live self-test completed same day with owner authorization** (copy to `devPlugins` + reload + curl/recording/storm suites; details in the handoff self-test table): HEAD suite green, one `/wave motion` recording proved PLUG-4/5/7 live (fresh `startedAgo`, 57-frame clip, ~0.14s finalize overhead, no post-finalize skeleton stall, command executed 77ms after enqueue), an 80-way skeleton storm proved bounded concurrency with zero crashes (PLUG-6), and both reloads logged the new-code-only `ExportServer listening on localhost:48795 (attempt 1)` (PLUG-3). Cleanup verified (cancel ok, pending zero, no clips leak). **Remaining tails (not safely inducible autonomously):** PLUG-2's 503 needs a genuinely stuck framework thread, PLUG-3's busy→takeover needs real double-client port contention (log `ExportServer port 48795 busy (attempt N)`), PLUG-7 shows only when the system clock changes.

## 8. FIX-K — release integrity and provenance

**Problem evidence**

- Current `release/staging` predates FIX-H and ARCH-1 and must not be published.
- The staged DLL was confirmed to contain a local CodeView PDB path under `D:\choreohelper\...`.
- `make-release-staging.js` scans selected text extensions only, scans before writing README, matches patterns case-sensitively, and copies whole Three.js directories.
- Manifest `gitCommit` identifies HEAD even when the actual release source is a large dirty working tree.

**Required result**

- Produce deterministic/path-mapped Release binaries or otherwise prove no owner-local paths exist in DLL/PDB metadata.
- Scan final contents after every write, including binaries, case-insensitively and for slash variants; allow only explicit documented README installation terms.
- Replace whole-directory copying with an explicit reviewed library inventory and reject unexpected files.
- Refuse a public build from dirty/untraceable source or record a complete reproducible source identity; never claim HEAD alone identifies dirty content.
- Rebuild staging only after FIX-K, then verify stand-in-only assets, no private model/bin/clips/diagnostics, zip contents, manifest and hashes.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-fixk-release-integrity.md`): reproduction first — the old staged DLL carried a `D:\choreohelper\...` CodeView PDB path (never scanned: text-extensions only), and the SEC-1 pairing gate had silently broken the packaging flow (anonymous `48795/export/list` probe and `/export/skeleton` snapshot fetch now 403). Fixes: Release-only `PathMap` in `ChoreoHelper.csproj` maps the repo root to `/build/` (rebuilt DLL byte-sweeps clean of every `X:\…` path; Debug untouched); new pure `scripts/release-gates.js` + `scripts/test-release-gates.js` (28/28, red observed against the pre-FIX-K staging DLL) provide binary/latin1, case-insensitive, slash-variant scanning with the dynamic repo-root pattern and a README-only documented-term allowlist; `make-release-staging.js` now writes README/manifest **before** the final gate, probes and fetches snapshots with `X-Choreo-Token` from the local `pairing.json`, copies `libs`/`libs-classic` from an explicit 8-file inventory that rejects strays, extracts both zips and proves them per-file sha256-identical to the staged trees before rescanning, and records honest provenance (`sourceIdentity`: gitHead + `workingTree dirty（155 项）` + note that HEAD is only a baseline, plus content `sourceDigest`). Staging rebuilt 2026-08-31 with live-regenerated snapshots (token'd): 118 files scanned incl. zip re-scan, 0 hits; stand-in-only both trees; no model.bin; no diagnostics; manifest/SUMS/zip hashes verified; deploy roots re-synced for the two regenerated snapshots (recursive zero). Verified: datalayertest 245/245, Release build 0/0, six web suites green (47/93/73/96/91/33), clip-check 134/134 on source-dist and game root, offline-verify 45/45 (one transient flake in run 1), library-verify 117/117. **Release to GitHub remains owner-authorized only**; the live devPlugins DLL was not touched.

## 9. WP-5-DOC — canonical performance document

**Current architectural risk**

- Current save/load/import/export code reconstructs a fixed field list (`projectRecord`, `applyProjectContent`, import sanitization). New/unknown fields can be silently dropped.
- Current schema uses float seconds, array-position dancer identity and command-name references; these are a v0.7 foundation, not the final performance-script contract.

**Required foundation**

- A pure classic module owns schema, normalization, migration, validation, lossless unknown-field preservation and deterministic serialization.
- Use integer milliseconds, stable event/actor IDs, `assetRef`, `timelineRevision`, explicit track/event types and versioned capability requirements.
- Repositories store documents; UI edits projections; compiler produces per-actor runtime packages and optional native macros. No second timeline model.
- Migration is idempotent and tested from legacy draft, schema 2 project, future-unknown fields and malformed input.
- Update `SPEC.md` and `DESIGN-performance-script-v1.md` only through an explicit WP-5 package; do not infer final semantics inside UI code.

**CLOSED 2026-08-31** (foundation: `HANDOFF-20260831-wp5doc-canonical-document.md`; wiring: `HANDOFF-20260831-wp5wire-persistence-wiring.md`). The pure module `web/choreo-document.js` landed first (schema v2, migration, lossless `_extra`, deterministic serialization; 83 checks). The wiring increment **WP-5-WIRE** then routed all persistence through it via the new pure `web/choreo-docwire.js` (45 checks): repositories (records, `choreo_autosave` mirror, version snapshots) now store canonical documents; the UI edits the projected WP-3 content (`toLegacyContent`); unknown top-level keys ride `store.contentExtra` back into `_extra` on save, so the previously reproduced losses are dead (load→save round trip keeps `timing`/`stage`; import keeps original clip ids and dancer extras/`currentJob`; export is the document itself). `timelineRevision` is carried by the document (seeded on load, incremented on every content change, floor 1). Legacy import rejections keep their pre-migration AUD-002 semantics (clip-check §20). Verified red→green against the real `choreo-app.js` (vm repro, 8 losses → 0), eight Node suites green (incl. `test-docwire` 45/45), clip-check 134/134 on both synced roots, offline-verify 45/45, library-verify 117/117 (harness adapted: `canonContent` key-order-insensitive, mirror surgery doc-aware — product semantics unchanged), real-Chrome `file://` end-to-end smoke 13/13 on the deployed copy, three deploy roots recursive diff zero. The compiler/executor half of this package's "compiler foundation" proceeds as §10 EXEC-CORE (now unblocked); SPEC.md updates stay owner-gated until real acceptance.

## 10. EXEC-CORE — safe game executor

- Implement dedicated `ShowCompiler`, `ShowRunner`, `EventScheduler` and `RuntimeGuard` components per `DESIGN-game-executor.md`.
- HTTP endpoints remain transport/auth; `AnimationPoseFreezer` remains a game adapter, not the show orchestrator.
- Use one monotonic clock, precompiled per-actor queues, explicit player start, countdown, readable log, emergency stop and manual takeover.
- Character loss, zone/cutscene change, manual movement, unsupported requirement or adapter failure stops safely.
- Optional vnavmesh/SND adapters remain optional and cannot be core dependencies.

**CLOSED 2026-08-31** (see `HANDOFF-20260831-execcore-show-runner.md`): all four components landed.
Web `choreo-show-compiler.js` compiles the canonical document (or any migratable project) into a
protocol-v1 show package (integer ms, per-event performer ids, priority sort mirroring the plugin
scheduler, derived capabilities, deterministic FNV-1a hash; migration-era fields never enter the
package). C# pure core `ShowProtocol` (strict parse) + `ShowValidator` (plugin-side recheck:
unsupported capabilities/kinds, mixed-performer motion, command policy gate — rejection happens
before anything executes) + `EventScheduler` (precompiled queue + cursor, exactly-once,
frame-rate-independent) + `RuntimeGuard` (pure stop conditions incl. clock jump, precedence
tested) + `ExecutionLog` + `ShowRunner` state machine (Idle→Loaded→Armed→Countdown→Playing→
Stopping→Completed/Faulted, injected monotonic clock, idempotent emergency stop, motion failure
faults / lyrics-cue failures skip, per-frame guard). Game adapter `GameShowDispatcher` reuses the
field-tested command queue/freezer hygiene; guard feeds real character/territory/cutscene/combat/
between-areas state (manual-takeover and movement-error inputs stay honest `false` until the input/
movement packages exist). Transport: `POST /shows/validate|load|arm|start|stop` + paired
`GET /shows/status` + `shows` section in `/capabilities`. Web panel 「🎬 演出执行」（⋯高级）drives
compile→load→arm→start(countdown)→stop with live status; capability-handshaked against old plugins.
Verified: datalayertest 357/357 (+112: fake-clock scheduling incl. frame-rate independence and a
300s/300-event no-drift show, state machine, guard precedence, parser/validator gates), Release
build 0/0, `test-showcompiler` 37/37 (byte-exact package freeze), nine Node suites green, clip-check
148/148 on both synced roots (new ㉟ section freezes the panel protocol wiring), offline-verify 45/45,
library-verify 117/117, three deploy roots recursively identical. **Owner tails**: live on-device
acceptance (needs the new DLL loaded — live install untouched), real combat/cutscene/gpose flag
observation, `DispatchLeadMs` calibration after an on-device baseline. When movement/ability
executors land, extend `ShowValidator.SupportedExecutors` + the web capability map together and
lift the single-actor restriction deliberately.

## 11. ARCH-2 — incremental maintainability

ARCH-1 closed the default-context problem and physically separated the web shell/core/feature UI/bootstrap. Remaining structural work is deliberately incremental:

- Replace cross-file compatibility globals with small namespaced APIs only when a package touches that boundary.
- Move recording-session orchestration behind a small controller API; keep DOM rendering separate from state transitions.
- Split `AnimationPoseFreezer` by proven responsibilities: signature access, sampling, pose application and preview-session lifecycle.
- Keep `HttpServer`/`ExportServer` as transport and move business rules into pure/testable policy classes.
- Do not add a framework/bundler solely to make files look modern; `file://` and release simplicity remain acceptance constraints.

## 12. HYGIENE — deferred verified cleanup

Batch only after higher-risk packages; re-check every item before editing.

### Web/library/preview

- Preview panel close can leave rAF armed; stale negative model notes and sync rejection paths need cleanup.
- `updatePlayOverlay` rebuilds HTML per frame and can list muted dancers; render only on dirty state and filter consistently.
- Dead/unused candidates: `startRecPoll`, `addGlobalLyric`, `_profListCache`, stale gpose storage read/write asymmetry and debug payload logs.
- Resize-left snap can fall below minimum duration; snap-grid loop stops at 300s; seek-throttle comment differs from actual 50ms.
- Selection copy quantizes 0.05-grid placements to 0.1s; paste ordering/negative-time behavior and `planActionPlacement`'s silent 60-iteration guard need explicit contracts.
- Project store should repair stale active pointers; `savedAt` monotonicity is page-local. Check engine slerp normalization and `check(null)` robustness when those modules are touched.

### C#

- Re-check/remove dead `/bonerec`/`BoneAnimator`/`PackWriter`, `BreakStanceLock`, unused command verification and other audit3 dead paths only after live regression coverage confirms no consumers.
- Escape NetEase `songId`; correct the misleading `gameVersion` field; JSON-escape bone names defensively.
- Restructure the unreachable gate/flag early-return in recording sync so future edits cannot leak the semaphore.

### Verification scripts

- Add a timeout to CDP `send()` in offline/library/clipcheck harnesses.
- ~~**SEC-1 harness tail**~~ **FIXED 2026-08-31** (owner chose to keep the product pairing semantics unchanged; harness-only fix): the 3 residual browser-suite failures were SEC-1 private-read token gating that the harnesses predated. (a) `offline-verify` [online]/[transition] never seeded `choreo_pairToken`, so token-gated 48795 skeleton/model reads got 403 and the 3D panel never upgraded — the scenarios now read the real code from the local `pairing.json` (permanent, owner-local) and seed it via `addScriptToEvaluateOnNewDocument` before any page script. (b) `library-verify` [rec] seeded the token but `probeExport`'s immediate re-probe went out before `capsOk`, so `choreoTokenHeaders` dropped the token (403) and `exportConnected` only flipped on the 15s conn-watch, leaving all four rec-mode buttons disabled — the harness now re-probes after the caps handshake and waits for `exportConnected`. Seeding exposed one more pre-existing product bug, fixed same day (see FIX-I handoff): during the offline→online upgrade, `putClip → activePidOrNew()` could create a skeleton-less active 「默认角色」 before the online skeleton arrived, and preview3d's profile matching treated that empty shell as "another body" — the panel stayed on stand-in forever. Matching now only reports a mismatch when some profile actually carries skeleton content. Asserts preserved everywhere.
- Integrate `fix1-web-verify`, `profile-look-check` and `restore-bundle-check` temp profiles into common cleanup.
- Add timeout to offline-asset fetch; re-check trim-loop idempotence/unused `--min`, mock listen errors and hardcoded private dev paths before publication.

## Owner/live acceptance queue

These are not safe to mark complete from mocks alone:

- SEC-1 live pass: load the rebuilt DLL (overwrites the live install — owner action only) and run the read-only curl checklist in `HANDOFF-20260830-sec1-private-reads.md`; smoke the pose-viewer pairing prompt once per browser.
- Dual-profile, different-skeleton, same-named-clip on-machine acceptance; then update the two unchecked SPEC identity/backup items.
- Real plugin zip installation regression because it overwrites the live install.
- Newly exported Meddle model deployment and compatibility check.
- Long-run/hot-reload observation for thread-busy 503, port recovery, model switching and hidden-tab resume. **FIX-J (2026-08-31) adds the 48795 side of this**: paired HEAD reads, `/export/skeleton` 503 under a busy game thread, `ExportServer port 48795 busy` bind-takeover log, no instant recording timeout, no finalize-frame hitch — see the 7-step checklist in `HANDOFF-20260831-fixj-plugin-thread-lifecycle.md`.
- Real multi-dancer/game-preview acceptance: **owner accepted 2026-08-31** (ACTOR live pass; SPEC §1 item flipped same day).

## Closed items not to reopen without regression evidence

- FIX-H: compact sidebar state, lane label/playhead alignment, orphan selection Delete, online skeleton check port.
- ARCH-1: routed startup context; HTML/CSS/core/feature UI/bootstrap split; 33 structural checks; three deploy roots synchronized.
- Earlier FIX-A–E, OPT-F and RELEASE-G claims are indexed in `AUDIT-20260830-code-repair/README.md`; inspect their handoffs only when the touched behavior intersects them.
