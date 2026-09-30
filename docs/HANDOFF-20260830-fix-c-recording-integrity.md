# HANDOFF: FIX-C Recording Data Integrity and Timing (2026-08-30)

> Work package: `docs\AUDIT-20260830-code-repair\03-FIX-C-RECORDING-INTEGRITY.md` (AUD2-006 / AUD2-007, P1)
> Conclusion: **code + automated acceptance + nine live curl items all complete**; version still 0.7.1; real-human live recording acceptance of the four clip classes left to owner.
> Next package: FIX-D (per-profile clip isolation + CHLB v2, `04-FIX-D-PROFILES-AND-BACKUP.md`).

## 1. What was fixed (plain language)

**The old problem**: when the web asked the plugin to record a clip, the plugin **immediately** wrote the file into the clip library (clips directory) upon finishing, and only then did the web start checking "was it recorded well". If the recording was bad (character didn't move, data is static), the plugin's good file had already been overwritten by the bad one — the web merely "didn't accept it into the browser library"; the on-disk loss was unrecoverable.

**Another hidden problem**: recording used "absolute seconds since boot" stored in float (a low-precision number). After the machine has been up more than 4 days, sampling silently slows (drops to ~16fps after 4 days, ~8fps after 12 days), getting worse the longer it runs, and nobody would ever notice.

**How it works now**:

1. **Two-phase commit**: the plugin first writes the recording into a "staging area" (pending directory, random-ID name) and returns a `recordingId` token to the web. Only after the web checks it as good **and has stored it into the browser library** does it send back a commit — only then does the plugin atomically replace the staged file into the official file. Failed check, mid-way cancel, or library-write failure → the web sends cancel, the staged file is deleted, and the old good file is untouched. Even if the web crashes before finishing, staged files auto-expire after 24h — the old file is never eaten.
2. **Batch recording protected too**: the plugin's batch endpoint has no web to check for it, so before writing to disk it self-checks amplitude with **exactly the same thresholds** as the web; static bad clips go into a "quarantine" directory for manual review, never into the official clip library.
3. **Timing fix**: everything switched to Stopwatch monotonic double clocks (very high precision); all decisions use "relative time from recording start"; conversion to float happens only at final file write. The stillness reference frame is now "the frame 0.4 seconds earlier, found by time", no longer the "12th-from-last frame" estimate. The recording response also reports the actual sample rate; if too low (<8Hz) it is explicitly warned in log and response.

## 2. Change list

| File | Change |
|---|---|
| `src\RecordTiming.cs` | **New** pure-function file: Stopwatch monotonic double clock + stillness reference frame found by time |
| `src\ClipQuality.cs` | **New** pure-function file: amplitude QC (same thresholds as the web's recAmp, threshold 0.3) |
| `src\Exporter\RecorderService.cs` | All timing fields float→double, frame times relativized, sample-rate stats into RecordResult |
| `src\Exporter\ExportServer.cs` | Recording now stages to pending; new endpoints `/export/clip/commit`, `/export/clip/cancel`; batch QC + quarantine before write; 24h expired-staging cleanup at startup/shutdown/before staging |
| `src\LocalApiSecurity.cs` | capabilities gains `clip-commit` (protocol stays 1) |
| `web\choreo-helper-app.html` | recRunLoop: QC pass → write to library first → commit; static/library failure → cancel; three exception types get Chinese toasts |
| `scripts\batch-record.js` | Synced to the two-phase flow (good clip commit / static cancel / low-sample-rate hint) |
| `scripts\library-verify.js` | Mock mirrors commit/cancel endpoints + recordingId; rec scenario +3 assertions |
| `src\tests\datalayertest\*` | Hooks the two new pure-function files, 100→121 tests |
| `scripts\qc-crosstest.js` | **New**: C#/JS same-vector cross test, locks QC thresholds against drift |

Deployment: app html synced to the three deployment locations (md5 `d893b4df…` consistent across all four); new DLL went into devPlugins with the Debug build (hot reload effective while game online, `/capabilities` already returns `clip-commit`).

## 3. Verification (all actually run)

- datalayertest **121/121** (21 new: 0/4/12.1/100-day uptime precision comparisons — one of them specifically locks the root cause that "float really does distort at 12.1 days"; still-window boundaries; QC vectors). Run method: user-level dotnet `--roll-forward Major` on the net8.0 test binary.
- `scripts\qc-crosstest.js` **7/7** (node direct run).
- Node five suites: test-engine 40 / test-edit 87 / test-projects 77 / test-check 73 / test-library 47, all green.
- library-verify all **106/106** (rec forced-mock: good clip commit×3, static bad clip cancel×2, staging orphans=0; mode/clip/lib-check diagnostic pages via real-plugin origin all PASS).
- offline-verify **27/27**.
- Debug/Release **0 errors** (6 pre-existing warnings); `git diff --check` clean.
- **Nine live curl items** (game online same day, new DLL hot-reloaded): 403 / 400 / 404 / idempotent 200 / OPTIONS 204 / commit create / commit overwrite / unsafe name 400 with staging retained / cancel removes staging — all passed. Test clip qcfixctest cleaned up.

## 4. Live acceptance (completed same day 2026-08-30, owner authorized AI direct testing)

Full real-machine recording chains for the four clip classes done via `scripts\realrec-fixc.js` (18 items) + `library-verify realrec` (7 items):

1. Normal /bow motion: record → staging → commit → `clips\bow.json` truly updated (amplitude 3.99, sample rate 10.4Hz reported) → restored from backup after verification.
2. Expression /smile motion: record/staging/cancel all normal. **Measured amplitude 3.92 with large body movement — further proof that the old "expression clips only move the face" was a misdiagnosis of a NaN bug**; the QC exemption convention is unaffected (what is exempted is "misjudged as static", not "necessarily static").
3. Sustained /golddance motion: full 20s recording then cut off → cancel leaves the old file untouched → beckon interruption normal.
4. Stance /doze motion: record + cancel then walkreset reset — with the game not in foreground, only the position nudge ran (foreground protection correct); after bringing the game to foreground, the full keyboard injection reset in 1.2s succeeded.
5. **Real-machine proof of the anti-pollution core**: a real batch run in the recording-center page recorded wave/greet/clap as static multiple times; QC correctly rejected and cancelled the staging (no committed line in logs), old files zero pollution; completed items (wave/bow/joy/clap) truly committed to disk (mtime evidence) and used into the library right after recording.
6. Cancel/refresh resume: `library-verify realrec` scenario 7/7 — stopping right after start leaves pending, refresh shows the resume banner, the resumed run completes, staging zero orphans. **Pitfall: recStart does not auto-open the recording window; showRecModal() must be called first (the real user path)**.

## 5. Intentional deviations and boundaries

- Plugin batch QC has **no expression-class exemption** (the plugin doesn't know the expression list) — expression clips recorded in batch land in quarantine for manual recovery; both real batch consumers (batch-record.js, web recording center) do the expression exemption externally, so in practice unaffected.
- The extreme orphan-staging case where the callback writes staging only after the 30s HTTP timeout is covered by the 24h expiry cleanup (cannot cancel, since the id is unavailable).
- `File.Replace` takes the atomic-replace branch only when the target exists; new files go through `File.Move` (same volume, also never half-written).
- Old plugin + new web / new plugin + old web both compatible: new response fields are unread by the old web; without a recordingId the new web automatically falls back to the old semantics.

## 6. Next package

FIX-D: `docs\AUDIT-20260830-code-repair\04-FIX-D-PROFILES-AND-BACKUP.md` — profiles isolate only model/skeleton; clips still globally overwrite by name (AUD2-008); CHLB v1 stores no per-clip profile attribution (AUD2-009).
