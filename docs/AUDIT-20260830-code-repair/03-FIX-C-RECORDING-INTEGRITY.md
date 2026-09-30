# 03: FIX-C Recording Data Integrity and Timing (P1)

## AUD2-006: A Failed Recording Can First Overwrite the Good File

### Symptoms and Evidence

- The web single-clip recording always sends `save:true`.
- The plugin writes the final `clips/<name>.json` immediately upon receiving the recording result.
- The web only runs its quality check (frame count, duration, amplitude, expression exception) after receiving the response; on failure it merely skips writing IndexedDB — it cannot undo the disk overwrite the plugin already did.

Evidence locations:

- `web/choreo-helper-app.html:3174-3180, 3200-3213`
- `src/Exporter/ExportServer.cs:234-248`

### Target Behavior

- Any recording that fails quality check, is canceled, times out, or loses the network must never overwrite the last healthy clip.
- Writing the final file must be one explicit commit; the commit should be as atomic as possible.
- The browser library and the plugin's raw clip directory must not linger long in a state where "one has the new clip, the other the old/bad clip" with no warning.

### Recommended Implementation

Use a "record to temp result → quality check → commit" protocol:

1. `/export/clip` returns `recordingId` and the clip on success, writing a pending file named by a random ID into a plugin-owned temp directory; never build the temp path from the command.
2. The web runs its existing quality check. On pass: write IndexedDB first, then POST `/export/clip/commit` containing only `recordingId` and the FIX-A-validated logical clip name.
3. The plugin writes the final file via a same-directory temp file + atomic replace. The old file may briefly stay as `.previous`, cleaned by an explicit policy once replacement is confirmed.
4. On failed quality check, user cancel, or session expiry, call cancel; plugin startup and shutdown clean only their own pending files past their deadline.
5. If the two-phase interface is not adopted, the minimum acceptable fallback is server-side quality check with the same rules as the web before overwriting, with bad clips landing only in a quarantine diagnostic directory. But there must be shared rules or cross-tests — never two long-lived drifting threshold sets.
6. Batch recording applies the same "good files are never overwritten by bad clips" principle.

### Targeted Tests

- Pre-place a healthy clip, simulate a still-body recording failure; the final file hash stays unchanged.
- Recording passes but commit fails: the old file still exists; the pending file can be retried or cleaned.
- Commit succeeds: the final file content is correct, no half-written JSON remains.
- Concurrent same-name recordings: the second returns busy/409; neither overwrites the other.
- After cancel, timeout, or service Dispose: no indefinitely pending files and no unreleased gates.
- On IndexedDB write failure, the plugin's final file is not committed and the page shows a Chinese recovery message.

## AUD2-007: Absolute TickCount64 to float Degrades Precision Over Time

### Symptoms and Evidence

`RecorderService.Now()` returns `Environment.TickCount64 / 1000f`. `float` has only about 24 significant binary bits:

- At ~3.9 days of uptime, the minimum time step is ~31.25ms, so 30fps's 33.3ms sampling easily lands every other frame — effectively ~16fps.
- After ~12.1 days, the minimum step is ~125ms — at most ~8fps.
- Logic like `_frames[^12]` interpreted as "about 0.4 seconds" also drifts with the actual sampling rate.

Evidence locations: `src/Exporter/RecorderService.cs:53-56, 168-176, 337-341`.

### Modification Steps

1. Timing uses `Stopwatch.GetTimestamp()` or `TimeProvider`/a monotonic `double`.
2. Store the recording start as a long tick; all internal decisions use relative elapsed, never absolute float seconds accumulated since system boot.
3. Convert to float only when serializing clip times; first normalize the relative double to a 0 origin.
4. "The last 0.4 seconds" must be found by time or computed from the target sampling rate — never rely on a fixed 12th-from-last frame.
5. Record actual sampling-interval statistics; when it drops abnormally below the product threshold, report it explicitly in the result instead of silently producing a low-quality clip.

### Targeted Tests

- Inject fake monotonic clocks starting from 0, 4 days, 13 days, and longer uptimes, generating the same sample sequence; output frame count and timestamps must be identical.
- At 30fps/60fps framework updates, the target sampling rate stays stable and the still-detection time window stays consistent.
- Clock rollbacks do not affect recording; monotonic clock overflow is handled safely per .NET behavior.
- Expression clips with low body amplitude still pass under the existing exception; ordinary still recordings still fail.

## Package Definition of Done

- [x] Failed/canceled recordings never overwrite the last healthy file.
- [x] The browser-library and plugin disk-commit order has clear transactional semantics.
- [x] Recording quality no longer degrades with system uptime.
- [x] Single, batch, cancel, resume, and pose-reset regressions all pass.
- [x] The owner completed at least one live acceptance recording each of: normal action, expression, sustained action, and pose-type clips.
  (2026-08-30 same day the owner explicitly authorized AI direct testing; completed: `scripts\realrec-fixc.js` 18 items — normal full-chain commit to disk / sustained 20s interrupted+cancel / expression recording (smile measured to have body motion) / pose-type walkreset full reset; plus library-verify `realrec` scenario 7/7 on real pages with real recording cancel/resume/commit. All pass.)

## Construction Record (2026-08-30; code + automatic acceptance + live curl complete)

Adopted the **recommended plan: two-phase commit protocol** (`recordingId` pending staging → web quality check + into library → commit atomically to disk).

- **AUD2-006 plugin side**: `/export/clip` no longer overwrites `clips\<name>.json` directly on completion — it first writes `ChoreoExports\pending\<guid>.json` (random-ID naming, never path-built from the command) and the response carries `recordingId`. New endpoint `POST /export/clip/commit` (recordingId accepts only 32-hex to prevent path injection; the name still goes through ClipPathPolicy; same-directory temp file + `File.Replace` atomic replace; missing staging returns 404) and `POST /export/clip/cancel` (idempotent staging delete). Startup/Dispose/every staging pass clean orphan stagings older than 24h. capabilities gains `clip-commit` (protocol stays 1, backward compatible: new response fields; old web ignores them).
- **AUD2-006 web side** (choreo-helper-app.html recRunLoop): quality check passes → **write IndexedDB first → then commit**; quality-check failure / before retry / library write failure → cancel; commit failure, staging failure (`stageError`), and low sampling rate (`lowSampleRate`) each show a Chinese toast. Old plugins (no recordingId in response) automatically fall back to the old semantics.
- **AUD2-006 batch**: `/export/batch`'s BatchLoop self-checks with `ClipQuality.IsStill` (same rules as the web's recAmp) before writing to disk; still-body bad clips land in `ChoreoExports\quarantine\<name>-<timestamp>.json`, never into clips, with lastError reported explicitly. scripts\batch-record.js also connects to the two-phase flow (good clip commit / still-body cancel).
- **AUD2-007**: new pure-function file `src\RecordTiming.cs` (Stopwatch monotonic double absolute seconds + finding the still-reference frame by a 0.4s time window, replacing the fixed 12th-from-last frame); all RecorderService timing fields switched to double, frame times relative to a 0 origin, float conversion only at the serialization boundary; RecordResult carries `AvgSampleHz`/`LowSampleRate` (<8Hz judged low; response carries `sampleHz`/`lowSampleRate`), low sampling rate logs a Warning.
- **Tests**: datalayertest 100→**121/121** (21 new: 0/4/12.1/100-day uptime precision comparisons — including a "float truly distorts at 12.1 days" root-cause-locking assertion, still-window boundaries, ClipQuality same-rule vectors); new `scripts\qc-crosstest.js` (runs directly under node) C#/JS same-vector cross test **7/7** locking the quality-check rules.
- **Regression**: node five-suite 40/87/77/73/47 all green; library-verify all **106/103→106/106** (rec scenario gains 3 FIX-C assertions: good clip commit×3 / still cancel×2 / staging orphans=0; mock mirrors the commit/cancel endpoints); offline-verify **27/27**; Debug/Release **0 error** (6 existing warnings); `git diff --check` clean.
- **Live curl nine checks all pass (2026-08-30 same day, game online, new DLL hot-reloaded, capabilities carrying clip-commit)**: ① commit without pairing code 403 ② illegal recordingId 400 ③ unknown staging 404 ④ cancel idempotent 200 ⑤ new endpoint OPTIONS 204 with zero side effects ⑥ commit creates 200 (staging fully deleted, no `.committing` residue, content correct) ⑦ re-commit same name 200 (File.Replace overwrite branch) ⑧ unsafe clip name 400 invalid name with staging preserved ⑨ cancel deletes staging. Test files (qcfixctest) cleaned up. **Pitfall**: Git Bash's curl eats backslashes / mixes multi-line variables; two "plugin error" results were actually scaffolding problems — send complex JSON with `--data-binary @file`.
- **Intentional deviation**: plugin-side batch quality check has no expression-type exemption (the plugin has no expression list; expression bad clips land in quarantine for manual recovery; both real batch consumers — batch-record.js and the web recording center — exempt expression types externally). An extreme orphan where a 30s HTTP recording timeout's callback stages afterwards is backstopped by the 24h expiry cleanup.
- **Pending owner live test**: record one each of normal/expression/sustained/pose types to confirm the full chain (the last definition-of-done item above).
