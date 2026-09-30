# HANDOFF 2026-08-29 — OPT-1: Recording & Legacy-Interface Robustness (AUD-016 + AUD-017)

> Prerequisite: FIX-1 through FIX-4 complete (see `HANDOFF-20260829-fix4-wp4-check.md` and CONTINUITY items 26-28).
> WP-4 only lacks the owner's on-machine checkup acceptance (does not block this package). This package is OPT-1 of the master audit list (`HANDOFF-20260829-code-audit-fix-optimization.md`); version still 0.7.1.

## AUD-016: Recording finalization motion detection re-criteriated (root-cause fix)

- **Problem**: RecorderService's finalization criterion squashed quaternions into the single scalar `x²+y²+z²` and diffed it — blind spot for "near-identity pose" bones: two rotations of the same angle about different axes yield equal scalars, so real motion was misjudged as still and cut off early.
- **Calibration (measure first, against the real 264 clips)**: one-off tool `scripts\calibrate-motion2.js` (archived, runs directly on node) —
  - Among the 71 clips that settled early, the old criterion's still-window rotation-angle peak was **0.4735 rad** (joy);
  - Slow-motion attend/atease real motion minimum was 0.21 rad, which the old scalar could catch (large-pose bones).
  - Pitfall: clip channel format is `[t,x,y,z,w]` — quaternions sit at indices 1..4 (the first script version read 0..3 as the quaternion and got everything wrong; deleted).
- **New criteria** (`src\MotionDetect.cs`, new pure-function file, no Dalamud dependency, into datalayertest per the ChatCommandBuffer convention):
  **old scalar (0.05, still) OR real rotation angle (0.5 rad) OR translation distance (0.02 m) — any threshold exceeded means moving**;
  Decompose failure / zero quaternion conservatively counts as "moving".
  Strictly more sensitive than the old criterion: everything that historically finalized still finalizes, and the large-rotation blind spot on identity-pose bones is covered.
- `RecorderService.OnFrameworkUpdate` only changed at the criterion call site; window/bone slots (3..79, 12 frames, 0.5s sustained stillness) all untouched.

## AUD-017: Legacy batch recording (/export/batch) robustness

- **Problem**: `BatchLoop` had no try/finally — a 30s callback timeout or exception left `_batchRunning` permanently true (batch busy forever); `SetResult` threw on duplicate callback; during batch start there was a "take RecGate → release → set state" window in which a single recording could slip in (two pipelines overlapping).
- **Fix** (`ExportServer.cs`):
  1. Batch start holds RecGate without releasing (during prep, single recordings can only get busy); RecGate is handed to BatchLoop and released in a **finally**; start failure / empty queue is released by HandleBatch's own finally.
  2. BatchLoop is wrapped in try/catch/finally end to end: **every** exit path (normal / cancel / timeout / exception) clears the busy state, clears the queue, and releases RecGate.
  3. Callback switched to `TrySetResult` + `TaskCompletionSource.RunContinuationsAsynchronously` (finalization no longer runs on the framework thread).
  4. 30s timeout → log an error and terminate the batch (no longer dies with it); status page `/export/batchstatus` gained a `lastError` field.

## Verification

- Data-layer tests (datalayertest, DOTNET_ROLL_FORWARD=Major): **42/42** (26 original + 16 new: same-angle different-axis reproduces the old blind spot / q and -q equivalence / tiny noise / calibration anchors 0.47 still, 0.55 moving / 60° and 90° angles / pure translation / Decompose failure conservative / large-pose-bone old-path regression).
- Debug + Release builds 0 errors (6 pre-existing warnings unchanged).
- **Live smoke (game online, curl direct against the freshly hot-reloaded DLL)**:
  ① batch of already-recorded commands all skipped (character untouched, gate returned properly) ② new-command batch starts with running=true ③ a second batch started mid-run returns the running status ④ a single `/export/clip` mid-batch returns busy (batch holds the lock throughout — new semantics) ⑤ after completion running=false/done=1 and it can start again. Test artifact hail.json deleted.
- Web untouched; git diff --check clean.
- **Not live-covered** (covered by code review; left for live acceptance): callback-loss timeout path and mid-batch exception path — they need artificially induced recorder failures, not reproducible without side effects.

## Risks & Criteria

- The new criterion can theoretically only finalize **later**, never earlier (three-condition OR; thresholds carry margin above the calibration upper bounds); worst case a few actions record a few extra seconds; the continuous-type 20s cap fallback is unchanged.
- During a batch run, single recordings went from "can slip in (data cross-contamination)" to "explicit busy" — scripts like `batch-record.js` have no send-single-during-batch usage, so no impact.

## Next Steps

- Owner live: WP-4 checkup acceptance (SPEC "Choreography Checkup") + casually confirm OPT-1 has no perceptible regression (record one action; it should finalize normally).
- Next build package: OPT-2 (large-project performance & GPU lifecycle, AUD-018/019/020).
