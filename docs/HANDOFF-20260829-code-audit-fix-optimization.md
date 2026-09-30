# ChoreoHelper Comprehensive Code Audit: Fixes & Optimization Handoff (2026-08-29)

> What this file is for: turn the 2026-08-29 comprehensive review of `SPEC.md`, `.agent/CONTINUITY.md`, current source, tests, build and deployment artifacts into a fix list the next developer can start on directly.
>
> This round did auditing and handoff records only — **no business source modified, nothing committed, pushed, or released**. Whether an issue is fixed is decided solely by the status on each item here, the matching regression tests, and later handoffs; do not assume resolution just because existing automated tests are green.

## 1. Conclusions First

The base capabilities work: action library, multi-project, professional timeline, web 3D, game preview, and the first-version health check are all implemented; existing automated acceptance totals **342 passing items**, Release build **0 errors**. But this audit confirmed there are still:

- 3 security/process-stability risks to handle first: long-command out-of-bounds read, web DOM injection, incomplete WalkReset key release.
- 3 data reliability issues: action-library dual-table non-atomic writes, undo/redo not persisted, deleted current project can be "resurrected" by autosave.
- 7 editor, health-check and game playback correctness issues, several outside existing test coverage.
- 6 recording/API/performance robustness issues.
- WP-4 only delivered "first-version UI and part of the rules"; **it has not reached the full exit criteria in `WORKPLAN-20260829.md`**.
- Public staging is still 0.6.7 while current source/plugin is 0.7.0; there is no GitHub Actions, so release cannot happen directly.

Correct order going forward: **finish P0/P1 fixes and regressions first, then complete WP-4, only then enter WP-5; public release still waits on new staging and full-chain regression.**

## 2. Work Discipline and Status Conventions

### 2.1 Order of Authority

On conflict, judge in this order:

1. Current source and directly-run test results.
2. `SPEC.md`.
3. `.agent/CONTINUITY.md`.
4. This handoff and `docs/README-AI.md`.
5. Historical handoffs.

### 2.2 Workspace Protection

- Current branch: `main`.
- The working tree holds large amounts of pre-existing uncommitted changes and untracked files from stages 1–4 and WP-1–WP-4; they are the project's current state and must not be reset, overwritten, or casually cleaned.
- No commit, push, remote creation, or release without the owner's explicit authorization.
- After changing web product files, sync the three deployment locations per `AGENTS.md` and confirm via hashes; when adding test assertions, also confirm the actual acceptance page is synced — do not just trust a final PASS.
- Every confirmed bug gets a regression test; never make tests green by deleting assertions, loosening thresholds, or swallowing errors.

### 2.3 Priorities

| Level | Meaning | Work requirement |
|---|---|---|
| P0 | Possible process crash, stuck keys, security injection, or severe data corruption | Fix first; one issue = one independently reviewable change |
| P1 | Corrupts user data/edit results, or core features give wrong conclusions | Fix immediately after P0; do not enter WP-5 before done |
| P2 | Robustness, performance, maintainability; may work at current scale but blocks future growth | Handle as work packages after P1/WP-4 |
| P3 | Build hygiene, docs, release prep | Must close before release; never preempts P0/P1 |

### 2.4 Evidence Labels

- **Reproduced**: actually triggered this round with a minimal sample.
- **Statically confirmed**: code paths prove the problem exists, but the risky behavior was not deliberately triggered in-game.
- **Performance risk**: hot path confirmed; actual lag threshold still needs benchmarking.
- **Requirement gap**: item-by-item comparison of source vs work-package acceptance confirms unimplemented or partially implemented.

## 3. Audit Baseline

### 3.1 Actual Run Results

| Check | Result |
|---|---:|
| `D:\nodejs\node.exe web\test-check.js` | 47/47 |
| `D:\nodejs\node.exe web\test-edit.js` | 50/50 |
| `D:\nodejs\node.exe web\test-projects.js` | 70/70 |
| `D:\nodejs\node.exe web\test-engine.js` | 35/35 |
| `D:\nodejs\node.exe scripts\library-verify.js` | 103/103 |
| `D:\nodejs\node.exe scripts\offline-verify.js` | 21/21 |
| Data-layer tests `src\tests\datalayertest` | 16/16; local machine needs `DOTNET_ROLL_FORWARD=Major` |
| Release build | 0 errors, 6 warnings |
| `git diff --check` | Passed, no whitespace errors |

Total **342 tests/assertions passed**. These prove no obvious regression in the existing main flows, but most issues below are edge, exception, or security paths the existing tests never covered — the two facts do not contradict.

### 3.2 Version, Deployment, and Release Status

- `src/plugin.json`, project version, and local Release DLL are all **0.7.0**.
- `web` source, `web/dist/ChoreoHelper`, the dev-plugin directory, and the directory the game actually reads have matching hashes for the main product scripts; no deployment drift found ("source changed but game still reads old files").
- The public staging directory still holds 0.6.7 artifacts like `release/staging/ChoreoHelper-web-0.6.7`; it does not represent current 0.7.0.
- The repo has no `.github` directory and no actual GitHub Actions workflow; WP-2 docs contain only a CI plan, no implemented automated workflow.
- Private `model.gltf + model.bin` and local release staging remain at the ignored/untracked boundary; no evidence of committed private models.

### 3.3 Release Build Warnings

The current 6 warnings do not block the build but should be cleaned in P3:

- `src/Plugin.cs:2` and `src/Plugin.cs:8` duplicate `using Dalamud.Plugin.Services`.
- Unused `_idleCandidate`, `_idleCandidateFrames`, `_lastIdleObserve`, `_lastLog` in `src/AnimationPoseFreezer.cs`.
- Unused `_lastStatus` at `src/Exporter/ExportServer.cs:26`.

## 4. Issue Summary Table

| ID | Priority | Status | Summary |
|---|---|---|---|
| AUD-001 | P0 | Statically confirmed | Long UTF-8 game commands read from the wrong buffer; out-of-bounds read and exception leaks |
| AUD-002 | P0 | Statically confirmed | Imported project/LRC/remote song text can reach `innerHTML`, enabling DOM injection |
| AUD-003 | P0 | Statically confirmed | WalkReset counts by frames and Dispose never releases W; hot reload may leave a key stuck |
| AUD-004 | P0 | Statically confirmed | Action metadata and data written in two transactions; failure can leave a "ghost action"; import never verifies payload hash |
| AUD-005 | P1 | Statically confirmed | undo/redo only changes memory without autosave; reopening the page reverts to the pre-undo state |
| AUD-006 | P1 | Reproduced | After deleting the current project, the next save can recreate it |
| AUD-007 | P1 | Fixed (FIX-3, see HANDOFF-20260829-fix3-timeline-correctness.md) | deleteTime missed clips "entering the deletion region from the left and ending inside it" |
| AUD-008 | P1 | Fixed (FIX-3, same doc) | Batch translation clamps each clip at boundaries independently, destroying relative spacing across a multi-select |
| AUD-009 | P1 | Fixed (FIX-4, see HANDOFF-20260829-fix4-wp4-check.md) | Health check only compares adjacent clips, missing nested overlap where a long clip covers several short ones |
| AUD-010 | P1 | Fixed (FIX-3, same doc) | Auto job-switch clip naturally overlaps the following action; health check flags its own generated timeline red |
| AUD-011 | P1 | Statically confirmed | 48794 chunked POST bypasses the body size cap and is read unbounded via `ReadToEnd` |
| AUD-012 | P1 | Statically confirmed | Plugin business failure still returns HTTP 200; web wrongly enters "game is playing" state |
| AUD-013 | P1 | Fixed (FIX-4, see HANDOFF-20260829-fix4-wp4-check.md; full WP-4 package completes after owner's in-game health-check acceptance) | WP-4 lacks model/clip fingerprints, full capability comparison, and an accurate macro check |
| AUD-014 | P1 | Fixed (FIX-3, same doc) | Quick recording reads `c.command`, but the actual command sits at `c.data.command` |
| AUD-015 | P1 | Statically confirmed | Auto measured-duration correction never enters history nor persists; lost if the page closes immediately |
| AUD-016 | P2 | Statically confirmed, impact pending sample verification | Recording stillness detection flattens quaternions to one scalar; misses same-angle different-axis rotation |
| AUD-017 | P2 | Statically confirmed | Legacy batch recording can leave `_batchRunning` stuck true forever after a timeout, plus a startup race |
| AUD-018 | P2 | Performance risk | 3D rebuilds and sorts the whole timeline every frame, then scans the full dancer table |
| AUD-019 | P2 | Performance risk | Dragging clears and rebuilds the entire main-page DOM every frame |
| AUD-020 | P2 | Statically confirmed | 3D hard reset only removes objects, never frees GPU geometry/material resources |
| AUD-021 | P3 | Statically confirmed | Test runtime, warnings, doc status, and release staging not yet unified |

## 5. P0: Security, Process Stability, and Data Integrity

### AUD-001 Long-command wrong-buffer read and unmanaged memory leak

**Evidence**

- `src/GameCommandExecutor.cs:150-180`: when UTF-8 length `>= 0x40`, the actual string lives in a separately allocated `strBuf`; `Utf8String.StringPtr` points at the heap buffer.
- `src/GameCommandExecutor.cs:201`: regardless of length, executes `Encoding.UTF8.GetString(inlineBuffer, len)`.
- `inlineBuffer` starts at offset 0x22 of a 0x68-byte struct; only 70 bytes remain inside the struct. Long commands read from the never-written inline area, and past 70 bytes they read beyond the allocated block boundary.
- `src/GameCommandExecutor.cs:225-226`: `FreeHGlobal` only runs at the end of the normal path; any mid-way exception jumps to the outer catch and both unmanaged blocks may leak.

**Impact**

- Long Chinese macros, lyrics, or commands can be recorded as garbage or read out of bounds; severe cases can destabilize the plugin or game process.
- Repeated exceptions accumulate an unmanaged memory leak.

**Fix requirements**

1. Verify logging decodes directly from the managed `bytes`, or picks the real string pointer based on `useHeap`; never again fixedly read `inlineBuffer`.
2. `mem` and `strBuf` go into `try/finally` or a safe wrapper and are freed on every return/exception path.
3. Preserve the existing ABI of short-command inline and long-command heap paths; do not casually replace the whole game-call mechanism.
4. Define the UTF-8 byte-length boundaries explicitly; test 63, 64, 70, 71 bytes and long Chinese strings — byte counts, never C# char counts.

**Acceptance criteria**

- All boundary inputs above: no out-of-bounds read, correct log content, no double free.
- After injecting simulated exceptions, the allocation count returns to 0.
- In-game, run one short action command and one safe text command over 70 UTF-8 bytes: plugin does not crash, command behavior matches the game's own limits.

### AUD-002 Project/LRC/remote text can execute DOM injection

**Evidence**

- The generic `el(tag, cls, html)` at `web/choreo-helper-app.html:407` passes its third argument straight to `innerHTML`.
- Untrusted data reaches this helper or `innerHTML` directly via:
  - Action names: `web/choreo-helper-app.html:1705`.
  - Dancer names: `web/choreo-helper-app.html:1919`.
  - Timeline clip names/lyrics: `web/choreo-helper-app.html:2100-2102`.
  - Section markers: `web/choreo-helper-app.html:2278`.
  - Health-check messages: `web/choreo-helper-app.html:2562`.
  - LRC preview: `web/choreo-helper-app.html:3214`.
  - Remote song/artist/album names: `web/choreo-helper-app.html:3255-3257`.
- `web/choreo-helper-app.html:1491-1502`: importing arbitrary JSON applies only minimal structural filtering; names and text can flow verbatim into the render paths above.
- The pairing code is stored in localStorage; once injected code can read the page's script context, it can call the protected localhost write APIs.

**Impact**

- Malicious or tampered project files, LRC, or song search results can execute script in the page context.
- This is not just "display broken": it can read the page's local data and pairing code and send requests to the plugin's local APIs.

**Fix requirements**

1. Make generic text rendering default to `textContent`. Suggested split: a "text helper" and a "trusted static HTML helper" that only accepts in-code constants, named so the distinction is explicit.
2. All project, action, lyric, marker, health-check and network-returned fields are assembled as text nodes; style tags created via DOM API, never concatenated from user strings.
3. Add structural, type, count, string-length and numeric-range validation at the import layer — but import validation must not be the only line of defense; the render layer must still be safe.
4. Do not pull in a large sanitizing library; native DOM APIs suffice for this project.

**Regression tests**

- Inject `<img src=x onerror=...>`, `<svg onload=...>`, quotes, and HTML entities into dancer names, action names, commands, lyrics, markers, project names, and song search results respectively.
- The page must display raw text, generate no img/svg/script nodes, not trip a global sentinel variable, and send no extra network requests.
- Oversized/wrong-type import fields must produce a Chinese error message and must not leave the editor half-initialized.

### AUD-003 WalkReset can leave the W key down, and duration depends on frame rate

**Evidence**

- `src/Exporter/RecorderService.cs:101-129` uses `_walkFrames = frames` to control holding W.
- `src/Exporter/RecorderService.cs:158-162`: decremented once per game Update; the default 75 frames is ~2.5 s at 30 FPS but only ~0.52 s at 144 FPS, inconsistent with the "about 1.2 s" comment.
- `src/Exporter/RecorderService.cs:337-341`: `Dispose()` only unsubscribes and never calls `ReleaseWalkKeys()`.
- If an exception is thrown between W keydown and `_osKeysHeld = true`, the catch only logs — no fallback keyup.

**Impact**

- If plugin hot-reload, unload, or an exception lands while the key is held, W may never be released in pair.
- Reset displacement and success rate vary widely across frame rates; pose-type auto recording is unstable.

**Fix requirements**

1. Switch to a monotonic clock such as `Environment.TickCount64` for the deadline; stop representing seconds as frame counts.
2. Release old state before each new WalkReset; every path after keydown guarantees a final keyup.
3. `Dispose()`, lost foreground, cancel, exception, and normal deadline all call the same idempotent `ReleaseWalkKeys()`.
4. Keep the "inject only while the game window is foreground" protection; never send keys to other programs.

**Acceptance criteria**

- Hold durations at 30/60/144 FPS all within design tolerance.
- Normal completion, lost foreground, hot-reload/Dispose, and repeated invocation each produce exactly one W keyup.
- Owner tests one pose action in-game: reset succeeds and the character does not keep walking after the keyboard is released.

### AUD-004 Action-library dual-table non-atomic writes and unverified backup payload

**Evidence**

- `putClip()` at `web/choreo-library.js:177-190` uses `Promise.all` over two independent transactions writing `clips` metadata and `clipdata` data.
- If one transaction fails, the other may already have committed; `clipIndex()` believes the action exists while `getClip()` returns null for missing data — a "ghost action". The health check's missing-recording judgment can also be fooled by bad metadata.
- Backup import at `web/choreo-library.js:431-436` likewise writes metadata first, then data; failure can leave a half record.
- The backup header already carries `hash`, but import just copies `e.hash` without decompressing and recomputing the payload hash; corrupted content can be accepted as a successful import.

**Impact**

- Quota errors, browser crash, or a corrupted package during recording or backup import leave the library index inconsistent with real data.
- The user sees "recorded" but 3D cannot load it; a bad backup may overwrite a healthy same-name action.

**Fix requirements**

1. A single action's `clips + clipdata` must commit in one IndexedDB `readwrite` multi-store transaction, waiting for transaction complete.
2. Backup import validates range, compression format, decompression, JSON structure and SHA-256 before writing; on hash mismatch it must not overwrite existing data.
3. Each clip may commit atomically on its own; the whole package may report partial failure, but a failed clip leaves no new metadata or data.
4. Add an orphan-repair policy at library startup/health check: metadata without payload and payload without metadata must both be detected, then cleaned or explicitly reported.
5. Keep the existing `.choreolib` format compatible where possible; if the schema must change, document migration and rejection rules clearly.

**Regression tests**

- Simulate first/second store write failure, transaction abort, quota exception, and cancelled import.
- Construct bad gzip, truncated blob, hash mismatch, JSON without bones: none may overwrite healthy actions.
- After a successful import, recompute every hash and match the index; after failures, `clipIndex()` and `getClip()` produce no ghost entries.

## 6. P1: Editing, Playback, and Health-Check Correctness

### AUD-005 undo/redo not persisted, snapshot fields incomplete

**Evidence**

- `web/choreo-helper-app.html:413-420`: normal edits call `persistProject()` after `saveHistory()`.
- `web/choreo-helper-app.html:440-454`: undo/redo restores memory and `render()`s but never calls `persistProject()`.
- History snapshots contain only `dancers/globalLyrics/markers`, not project content fields such as `showLyricMacro` and `totalDuration`.

**Impact**

- Undo then immediately closing the page reopens to the post-edit (pre-undo) future state, violating "autosave keeps the latest edits".
- Some project-level state cannot be fully restored through undo/redo.

**Fix requirements**

1. After undo/redo restore completes, call `persistProject()` directly; do not call `saveHistory()` or the undo stack breaks.
2. Align history snapshot fields with the truly undoable project fields; derived values are recomputed uniformly, non-derived values must enter the snapshot.
3. Define explicitly whether `showLyricMacro` is undoable; the UI already calls `saveHistory()` onchange, so it should enter the snapshot.

**Regression tests**

- Edit → undo → simulate close/reinit: the restored result must equal the post-undo state.
- Undo → redo → reopen likewise.
- Toggle lyric macro display, markers, solo/mute, and action duration; verify complete restoration for each.

### AUD-006 Deleted current project can be resurrected by autosave

**Evidence**

- `web/choreo-helper-app.html:2712-2718`: the current project also shows "delete"; after deletion only the list refreshes — `store.projectId`, the active ID, and the mirror are never switched.
- `web/choreo-projects.js:290-300`: after deleting the record, `saveActive(rec)` unconditionally `putProject(rec)`.
- Reproduced this round on a minimal in-memory backend: after deleting the current project, one save call makes a "current" project with the same ID/content reappear in the list.

**Impact**

- The user believes the project is deleted, but the next edit or autosave resurrects it; list, active ID, and mirror state contradict each other.

**Fix requirements**

1. Minimal fix: forbid deleting the current project; prompt to open another project first.
2. Fuller fix: before deleting the current item, select another project, atomically switch store/active/mirror, and delete only after the switch is confirmed.
3. Storage-layer defense: `deleteProject(activeId)` must not silently succeed without an explicit switch target.

**Regression tests**

- Deleting a non-current project works normally.
- The current project cannot be deleted directly, or deletion immediately lands on another valid project.
- After deletion, editing, timed saves, refresh, and exception recovery must not resurrect the original project.

### AUD-007 deleteTime misses one interval-intersection case

**Evidence & reproduction**

- `web/choreo-edit.js:79-108` already handles: fully inside the deletion region, spanning the whole region, start inside the region, fully after the region.
- Missing: `clip.start < t0` and `clip.end > t0` and `clip.end <= t1`.
- Minimal sample: clip `[4,7]`, delete `[6,8)`; current result stays `{start:4,duration:3}`; the correct result truncates to 6 s, i.e. `{start:4,duration:2}`, and deletes if under 0.5 s after truncation.

**Fix requirements**

- Rewrite this local logic with complete interval classification or a unified interval mapping instead of stacking more mutually exclusive conditions that miss boundaries.
- Clips and markers both keep the current `[t0,t1)` semantics and the 0.5 s minimum-action rule.

**Regression tests**

- Cover: left of the region, right of it, fully contained, containing it, left overlap, right overlap, touching without overlapping, 0.5 s boundary values.
- Run the same parameterized suite on all three dancer track types and the global lyric track.

### AUD-008 Batch translation breaks relative spacing at boundaries

**Evidence & reproduction**

- `web/choreo-edit.js:55-61` clamps each entry independently.
- The drag path `web/choreo-helper-app.html:2175-2180` and keyboard path `web/choreo-helper-app.html:3297-3300` also clamp independently.
- Minimal sample: start `[0,5]`, move the group left 3 s → result `[0,2]`; the original 5 s spacing shrinks to 2 s — no longer a group translation.

**Fix requirements**

1. From the selection's earliest start and latest end, compute one group-wide allowed delta.
2. Quantize delta once, then apply it unchanged to all clips; if any clip hits an edge, the whole group stops together.
3. Mouse drag, arrow keys, and the translation pure function must share one implementation; three copies of boundary logic cannot remain.

**Regression tests**

- Left boundary, right boundary, differing durations, cross-dancer/cross-track, positive/negative delta, 0.5 s quantization.
- Pairwise relative spacing of all clips identical before and after the move.

### AUD-009 Health check misses nested overlaps

**Evidence & reproduction**

- `web/choreo-check.js:143-153` sorts, then compares only adjacent clips.
- Sample `[0,10]`, `[1,2]`, `[3,4]`: only the second clip is reported overlapping the long one; the third is only compared against the second, so its staying inside the long clip is missed.

**Fix requirements**

- Use a sweep line: at minimum track the current max end time and its source; to list all conflict pairs, maintain an active set.
- Same-track action/switch stays red and lyric overlap stays a hint per current design; touching boundaries and the 0.01 s tolerance stay consistent.

**Regression tests**

- Nested, multi-level nested, multiple identical starts, fully identical intervals, end-to-start touching, tolerance boundary.
- Assert every conflicting clip has at least one jumpable issue, avoiding duplicate-message explosion.

### AUD-010 Auto job switch creates a red conflict

**Evidence**

- `web/choreo-helper-app.html:1068-1078`: an action starts at `st`; the auto job-switch clip starts at `st-0.5` and lasts 1 s, so it covers through `st+0.5`.
- `web/choreo-check.js:155-162` correctly applies the switch × action mutual-exclusion rule and flags that 0.5 s as a red conflict.

**Impact**

- Adding an action with a job through the normal entry makes the system generate a timeline that always reports red.

**Fix requirements**

- Prefer making the auto switch occupy a definite 0.5 s ending exactly at action `st`, matching the macro-generated `<wait.0.5>` convention.
- If in-game testing proves the switch must keep 1 s, the action must move wholly after the switch ends; overlap is not tolerable.
- Adding must still pass the unified `conflictEnd/makeRoom` rules; it must not sit on top of existing actions.

**Regression tests**

- Empty track, 0 s start, existing switch, existing action conflict, same-job consecutive actions, different-job consecutive actions.
- Run the health check immediately after a normal addClip: no overlap red item caused by the auto switch itself.

### AUD-011 48794 chunked request body bypasses the size cap

**Evidence**

- `src/HttpServer.cs:158-163` rejects only when `ContentLength64 > 4MB`.
- With chunked/unknown length, `ContentLength64 == -1` and processing continues into business logic.
- `src/HttpServer.cs:194-195`, `240-241`, `367-368`, `491-492`, `538-539`, `576-577` and similar paths call `StreamReader.ReadToEnd()` directly with no cap.
- `src/LocalApiSecurity.cs:114-127` already has `ReadBodyLimited()` handling unknown lengths, but most 48794 handlers do not use it.
- That helper's unknown-length branch calls `reader.Read()` once; streaming reads may return few characters early, so it still needs to loop to EOF or `max+1` — one Read is not a full body.

**Impact**

- A paired or local malicious caller can use chunked large bodies to make the plugin keep allocating memory; the server is a serial request loop, so one slow request blocks subsequent APIs.

**Fix requirements**

1. All POSTs go through the limited read function; over-limit uniformly returns HTTP 413.
2. Limits count UTF-8 bytes, not chars; the helper's unknown-length branch currently counts chars and must be fixed too.
3. JSON parsing uses an explicit max depth / sane array counts, especially `/playback/start`'s clips array.
4. Do not copy the read-body logic into each handler.

**Regression tests**

- Content-Length boundary and over-limit values; chunked boundary and over-limit values; multi-byte Chinese payloads.
- Over-limit returns 413, no business side effects, and subsequent healthy requests are still served promptly.

### AUD-012 Business failure still HTTP 200; web wrongly reports playback success

**Evidence**

- `src/HttpServer.cs:486-523`: `/playback/start` returns an `{"error":...}` string when `_playback == null` or on exception, but the outer layer still writes the response as 200.
- With empty clips, `PlaybackManager.Play()` at `src/PlaybackManager.cs:113-118` returns directly, yet the handler still returns `status=playing`.
- `web/choreo-helper-app.html:1364-1376`: as long as the fetch Promise resolves it sets `store.isPlaying=true`, never checking `d.error` or `d.status`.

**Impact**

- The game is not actually playing but the web still shows playing; errors masquerade as success and are hard to diagnose.

**Fix requirements**

1. Establish a unified result convention for the local API: success 2xx, bad input 400/422, state conflict 409, service unavailable 503, internal exception 500.
2. `/playback/start` returns a readable error for an empty timeline; `Play()` should return bool/a result rather than silently returning.
3. The web enters playing state only when `status === 'playing'`; when the JSON contains error, throw with a Chinese message.
4. Audit seek/freeze/preview and similar endpoints together, not just start.

**Regression tests**

- Empty clips, bad JSON, missing fields, no playback, execution exception, normal playback.
- On failure: web playhead does not move, `isPlaying=false`, the connection status is not wrongly flagged red, and an accurate reason is displayed.

### AUD-013 WP-4 incomplete versus work-package exit criteria

**Already implemented and keepable**

- Pure-function rule layer, red/yellow/hint grading, modal, click-to-jump.
- Missing recordings, one-shot/loop durations, pose tail, basic overlap, basic macro quantization, macro paging, skeleton presence/online skeleton hash, partial protocol hints.
- `web/test-check.js` currently 47/47.

**Confirmed gaps**

1. `docs/WORKPLAN-20260829.md:99-104` requires model/skeleton/clip fingerprint mismatch checks; current `web/choreo-check.js:214-224` only has skeleton, and its comment explicitly says "clip 级指纹本版不查" (clip-level fingerprints not checked this version); the model hash never enters ctx.
2. `web/choreo-check.js:227-239` only checks "old plugin did not handshake" and "plugin protocol newer than web"; it never checks web protocol newer than plugin, nor compares the specific `capabilities` list.
3. `web/choreo-helper-app.html:818-829`: any response carrying `protocolVersion` sets `capsOk=true` without validating app, protocol direction, pairing, or required capabilities.
4. The old-plugin warning text claims "write APIs will be rejected", but the web actually runs compatibility mode with old plugins and sends no token; text contradicts behavior.
5. `checkMacroQuantize/checkMacroLines` only scans the three dancer tracks; with `showLyricMacro` on, the main page exports global lyrics, but the check ctx/content never carries that switch, so global lyric quantization and line counts may be undercounted.
6. `web/choreo-check.js:203-206` adds an extra line for every action carrying `jobName`; actual `generateMacro()` only inserts a line when the job truly changes and no switch exists — the check overestimates.

**Fix requirements**

- Build source/version/fingerprint metadata for library models, skeletons, and each clip; the check reports only with sufficient evidence, shows "cannot confirm" when uncertain, and never misreports.
- Define the web's required capability set, e.g. playback/seek/freeze/recording/walkreset/library-sync, and compare item by item against plugin-returned capabilities.
- Compare protocol in both directions, distinguishing "compatible but fewer features" from "semantically incompatible, must upgrade".
- Extract macro event-normalization/line-count computation into a shared reusable pure function used by both generator and checker, so the two estimates stop drifting.

**Exit criteria**

- Every one of the work package's four requirement classes has a real rule or a clearly "indeterminable" result.
- Add fingerprint/capability/global-lyric/job-switch tests; the base 47 must not regress.
- Owner opens the health check in-game, creates missing-recording and overlap cases, clicks the jumps; only after confirming the wording is understandable is WP-4 marked complete.

### AUD-014 Quick recording does not recognize draft-referenced actions

**Evidence**

- `recDraftSet()` at `web/choreo-helper-app.html:2878-2881` reads `c.command`.
- Timeline clips actually store `c.data.command`; other logic in the same file reads that structure.

**Impact**

- Actions outside the fixed `REC_QUICK` list but already used in the current project never enter "quick-init common actions". Existing automated tests only assert the quick list count and never insert a draft-only-referenced command, hence the miss.

**Fix & tests**

- Switch to safely reading `c.data && c.data.command`, falling back to `c.command` for legacy structure.
- Test: insert an action not in `REC_QUICK` but present in the catalog and referenced by the draft; assert the quick list contains it, deduplicated.

### AUD-015 Auto measured-duration correction is not saved

**Evidence**

- `web/choreo-helper-app.html:934-953`: after updating `measuredDur` and the `autoDur` clip it only calls `updateTotalDuration(); render()`.
- No history entry and no `persistProject()`.

**Impact**

- Closing the page right after a preview returns the real duration loses that auto-correction.
- This is a program-initiated correction, not necessarily something to push onto the user's undo stack, but it must be persisted.

**Fix requirements & tests**

- Call `persistProject()` after auto-correction; whether it enters the undo stack needs its own decision, defaulting to no so async results never interrupt user undo.
- Simulate measured-duration return → correction → reinit project: duration and `autoDur=false` must survive.

## 7. P2: Recording Robustness and Performance

### AUD-016 Recording motion detection's quaternion comparison misses movement

**Evidence**

- `src/Exporter/RecorderService.cs:188-198` judges whether bones still move via the difference of two `QuaternionTo()` results.
- `src/Exporter/RecorderService.cs:328-332` flattens the quaternion to the single scalar `x²+y²+z²`.
- Two rotations can share the same angle on different axes and still yield the same scalar; translation change does not participate at all.

**Status note**

- The mathematical miss mechanism is confirmed; the current 264-action library works overall and no single action has been confirmed truncated early because of it — "implementation defect confirmed, real impact pending targeted sample verification".

**Optimization requirements**

- Compare real rotation difference via `abs(dot)`/angular distance of normalized quaternions and add translation difference; handle Decompose failure conservatively.
- Calibrate thresholds against real recorded samples, especially facial expressions, slow poses, loop dances, and hair settle; do not blindly reuse the old 0.05 scalar as an angle value.

**Tests**

- Same angle different axis, `q` vs `-q` equivalence, tiny noise, obvious rotation, pure translation, Decompose failure.
- Record one slow action and one facial expression: no premature end, and no never-ending due to tail micro-jitter.

### AUD-017 Legacy batch recording loop can stick busy forever and has a startup race

**Evidence**

- `BatchLoop()` at `src/Exporter/ExportServer.cs:355-392` has no `try/finally`; a `WaitAsync(30s)` timeout or other exception faults the background task and `_batchRunning` stays true.
- The callback uses `done.SetResult(true)`; a repeated callback throws — should be `TrySetResult`.
- `src/Exporter/ExportServer.cs:322-351`: briefly acquires then releases `RecGate`, and only then sets `_batchRunning`. Between release and set, a single recording can start, overlapping two recording pipelines.
- The main page's recording center mostly uses per-clip `/export/clip` now, but `/export/batch` remains a public endpoint; a permanently busy state cannot be left just because it is "temporarily unused".

**Fix requirements**

- Use an explicit state machine and `try/finally`; any completion, cancellation, timeout, or exception clears queue/busy state and records the last error.
- Batch start and single start share one atomic mutex; no check-release-then-set pattern.
- If the old endpoint is retired, remove it completely from capability lists and UI/script references and return a clear deprecation response — no silent half-removal.

**Tests**

- Normal, recording-callback failure, no-callback timeout, repeated callback, cancel, simultaneous single+batch start.
- After each failure a new recording can start again and the status page shows the reason instead of staying busy forever.

### AUD-018 3D preview rebuilds, sorts, and full-scans every frame

**Evidence**

- `rebuildTimeline()` at `web/preview3d.js:681-703` creates a new array, scans all dancer actions, and sorts — on every call.
- `web/preview3d.js:745-762` calls it every frame, then runs `engine.scrubTo()`.
- `web/choreo-engine.js:308-318` scans the whole timeline from the start again for every dancer.

**Complexity & risk**

- Roughly `O(N log N + D*N)` per frame, constantly producing short-lived arrays; small current projects may not feel it, but WP-5/6 adding skills, movement, beats, and longer shows will amplify it.

**Optimization requirements**

1. Add revision/dirty flags for timeline content, solo/mute, and library changes; rebuild and sort only on change.
2. Give the engine a per-actor sorted index; scrub can binary-search the last event with `start <= t`, and continuous playback can cache the current position.
3. Do not change "timeline is the single data source" or scrub's deterministic semantics.

**Benchmark & acceptance**

- Add a 3-dancer × 1000-event benchmark; across 600 consecutive frames on a static timeline, rebuild/sort count must be 0 (except the initial build).
- Compare moment-by-moment against existing engine tests: once-freeze, loop wrap, solo/mute results must be identical.

### AUD-019 Dragging rebuilds the entire main-page DOM every frame

**Evidence**

- `render()` at `web/choreo-helper-app.html:1507` clears and rebuilds the main page.
- `web/choreo-helper-app.html:2196-2199`: every rAF of a mouse drag does `updateTotalDuration(); render()`.
- The main page currently holds ~3300 lines of native DOM-building logic; growing element counts will cause noticeable layout and GC pressure.

**Optimization requirements**

- No framework migration at this stage.
- During a drag, update only the dragged clip/selected group's `left/width`, the play hint, and reference lines; full render + history save at mouseup.
- Progressively separate modal rendering (project center, health check, recording center) from the main timeline; use partial refresh for normal edits.

**Acceptance**

- With 1000 actions, dragging stays stable and responsive; full `render()` during one drag happens no more than the necessary start/end times.
- Regress box select, snapping, scroll position, tooltip, history, and deployment diagnostics.

### AUD-020 3D hard reset never frees GPU resources

**Evidence**

- `web/preview3d.js:269-278` only removes group/ring from the scene and clears references; it never walks dispose geometry/material/texture nor clears renderer lists.
- Offline stand-in → real model once the game connects, and init-failure retries, all go through hard reset.

**Impact**

- Repeated upgrades/retries can accumulate WebGL VRAM and renderer caches. No precise leak measurement exists yet; this is a resource-lifecycle gap.

**Optimization requirements**

- Deduplicate, then dispose geometry/material/texture unique to this reset and no longer in use; cloned models may share resources — never dispose shared objects still in use.
- Release ring, self-built materials, and temp textures too; call renderer renderLists dispose if needed.

**Acceptance**

- Run 20 consecutive offline/online resets: renderer memory stats do not grow linearly.
- Real model, stand-in, and multi-dancer clones still render correctly, with no black materials or "freed resource still in use" errors.

## 8. P3: Build, Docs, and Release Closure

### AUD-021 Toolchain, warnings, status docs, and staging not unified

**Confirmed items**

1. The main plugin targets `net10.0-windows` but `src/tests/datalayertest/datalayertest.csproj` targets `net8.0`; this machine has only the .NET 10 runtime, so a direct run fails and only works after `DOTNET_ROLL_FORWARD=Major` (16/16).
2. The Release build still has the 6 warnings listed in section 3.
3. Before the audit, `docs/README-AI.md` still said "next mainline WP-4" while `.agent/CONTINUITY.md` said "WP-4 code complete"; historical WP-3b/continuity also still carried "paste does not avoid conflicts", contradicting the implemented `makeRoom`.
4. There is no standalone WP-4 handoff; this file serves as the current audit and fix entry point but must not pretend "WP-4 accepted".
5. Staging is still 0.6.7, there is no `.github` workflow, and the production site origin is still empty.

**Handling requirements**

- For the data-layer tests pick one: retarget to net10.0, or install/lock the net8 runtime in docs; the project standardizes on .NET 10, so evaluate retargeting first and only change after confirming it serves no test-compatibility purpose.
- Remove the duplicate using and fields confirmed unused; if a field is part of an unfinished design, keep it with a comment/test — do not delete behavior just for zero warnings.
- Current entry docs defer to this handoff; WP-4 status becomes "base version implemented, full criteria pending".
- Before release: rebuild Release, rerun `make-release-staging.js`, unpack-verify, privacy scan, version/manifest/hash alignment.
- Whether GitHub Actions lands follows the WP-2 plan as its own work item; when the CN-private Dalamud DLLs cannot be obtained in CI, do only auditable verify/publish separation — never fake a cloud-reproducible build.

## 9. Suggested Work Packages

### FIX-1: C# security and process stability (P0)

Scope: AUD-001, AUD-003, AUD-011, AUD-012.

Exit criteria: boundary/exception unit tests pass, Release 0 errors, in-game smoke passes for short/long commands, WalkReset, and normal/failed playback.

### FIX-2: Web input and local data integrity (P0/P1)

Scope: AUD-002, AUD-004, AUD-005, AUD-006, AUD-015.

Exit criteria: malicious strings generate no HTML; action writes atomic; bad backups never overwrite; undo/delete/auto-duration survive reopen; library/project/offline full regression.

### FIX-3: Timeline correctness (P1)

Scope: AUD-007, AUD-008, AUD-010, AUD-014.

Exit criteria: pure-function tests and real-page diagnostics added; multi-select spacing, deleteTime, auto job switch, and the quick-recording list all meet this file's acceptance.

### FIX-4: WP-4 full closure (P1)

Scope: AUD-009, AUD-013, plus re-verifying AUD-004's effect on the missing-recording check.

Exit criteria: every item in `WORKPLAN-20260829.md:97-104` has an implementation or an explainable "indeterminable" result; Node, browser, and owner in-game jumps all pass, then update SPEC/CONTINUITY.

### OPT-1: Recording and legacy-API robustness (P2)

Scope: AUD-016, AUD-017.

Exit criteria: validated with math samples and real slow actions; the batch endpoint recovers after any exception.

### OPT-2: Large-project performance and GPU lifecycle (P2)

Scope: AUD-018, AUD-019, AUD-020.

Exit criteria: benchmark first, then optimize; result semantics unchanged; 1000-event and repeated-reset metrics met.

### RELEASE-1: Build and release gate (P3)

Scope: AUD-021, full regression of all fixes, new 0.7.x staging, install/migration instructions, and the production origin; remote creation/release only with the owner's explicit authorization.

## 10. Minimum Regression Matrix per Work Package

After any work package touching web/projects/health-check, run at least:

```powershell
& 'D:\nodejs\node.exe' web\test-check.js
& 'D:\nodejs\node.exe' web\test-edit.js
& 'D:\nodejs\node.exe' web\test-projects.js
& 'D:\nodejs\node.exe' web\test-engine.js
& 'D:\nodejs\node.exe' scripts\library-verify.js
& 'D:\nodejs\node.exe' scripts\offline-verify.js
```

When the C# data layer is involved:

```powershell
$env:DOTNET_ROLL_FORWARD = 'Major'
& 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe' run --project src\tests\datalayertest\datalayertest.csproj
```

When the plugin is involved:

```powershell
& 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe' build src\ChoreoHelper.csproj -c Release --no-restore
```

Additionally:

- Run the work package's own new targeted tests, not just the old matrix.
- `git diff --check`.
- Check `git status --short`, distinguishing this package's changes from the owner's pre-existing ones.
- Sync web to the three deployment locations and compare hashes.
- Do the matching in-game smoke whenever actual plugin behavior is involved; if not done, write explicitly "pending owner in-game test" — never write "done".

## 11. Relation to the Final Product Goals

Fixing this file does not equal product completion. `SPEC.md` still explicitly lacks:

- Local music, waveforms, BPM, beats, and snapping.
- Full FF14 action semantics.
- Skill catalog, skill conditions, and skill health checks.
- Stage, movement, facing, and path preview.
- Unified performance-script schema, compilation, and per-actor show packages.
- Plugin show runner, emergency stop, and manual takeover.
- Player-facing GitHub Pages, Releases, custom plugin repo, and upgrade migration.

These belong to WP-5~WP-10 and must not bleed into the current fix packages. The immediate priority is making the existing action-choreography base safe, lossless, and free of misjudgments, then expanding to the unified performance script.

## 12. Pre-Work Checklist for the Next Developer

- [ ] Read `AGENTS.md`, `SPEC.md`, `.agent/CONTINUITY.md`, this file, and the relevant source.
- [ ] Recorded `git status --short` before starting; no pre-existing uncommitted changes overwritten.
- [ ] Claimed exactly one FIX/OPT work package.
- [ ] Used the correct verification method for each item's "reproduced / statically confirmed / performance risk" label.
- [ ] Added failing targeted regressions first, then fixed root causes.
- [ ] Synced web to the three deployment locations and verified hashes.
- [ ] Actually ran the minimum regression matrix and recorded the numbers.
- [ ] Updated `.agent/CONTINUITY.md` and the new handoff; no commit/release without authorization.
