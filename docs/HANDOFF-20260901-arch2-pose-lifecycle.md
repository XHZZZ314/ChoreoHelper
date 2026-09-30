# HANDOFF — AnimationPoseFreezer pose-lifecycle decomposition (ARCH2 pose lifecycle)

Closed 2026-09-04. Ticket `TASK-20260901-ARCH2-POSE-LIFECYCLE` (revision 2, feature, R3,
standard lane). Run `RUN-20260901-ARCH2-POSE-LIFECYCLE` completed with gate attempt 1 passed,
zero repair attempts, module + global review APPROVE. Durable machine evidence:
`.agent/evidence/TASK-20260901-ARCH2-POSE-LIFECYCLE/`, module record
`.agent/modules/plugin-product/changes/CHG-TASK-20260901-ARCH2-POSE-LIFECYCLE.json`.

## Objective and acceptance

Split the 2289-line `AnimationPoseFreezer` into four explicit internal components — pose
signature access, pose sampling, pose application, preview-session lifecycle — with every
public API, wire response, timeout and cleanup semantic unchanged (AC-1..AC-5). The four seams
give movement/facing execution work (X1) testable pure surfaces before it starts.

## Mechanism / red baseline

Baseline captured immediately before the first edit on the owner's uncommitted tree:
datalayertest 545/545 green, Release build 0 warnings / 0 errors, clipcheck 148/148,
library-verify 121 pass / 4 fail (all four `真模型缓存进资料库` 60s-timeout scenarios with the
plugin endpoints unreachable — environmental; 150/150 green the same session once the real
plugin was online, live DLL never modified by this run). A pre-extraction call-site inventory
was recorded at `.agent/evidence/TASK-20260901-ARCH2-POSE-LIFECYCLE/call-site-inventory.md`
and the module review verified the new public surface member-for-member against it.

## What changed and behavior preserved

- New `src/PoseSignatureAccess.cs` (pure managed, Dalamud-free): command→emote/timeline caches,
  learning policy, ownership checks, fail-closed resolve, diagnostic ring and debug views.
- New `src/PoseSampler.cs` (unsafe, framework-thread only): read probes and the main-control
  read/write primitive — bodies moved verbatim.
- New `src/PoseApplicator.cs` (unsafe, framework-thread only): pin session state, base-override
  management, three-layer speed writes, direct emote execution, play primitives — moved verbatim.
- New `src/PreviewSessionLifecycle.cs` (pure managed, injected clock): drag-stream
  request/settlement bookkeeping, generation counter, dispose bounded-wait truth table and the
  `PoseSessionPolicy` pure routing/swallow decisions plus the 16-slot measure queue.
- `src/AnimationPoseFreezer.cs` shrinks 2289 → 1828 lines and remains the only public facade:
  the attach/hold state machine, GPose, hygiene sequences and debug payloads stay; the four
  components are internal collaborators. `PlaybackManager.cs`, `GameShowDispatcher.cs`,
  `Plugin.cs` and `src/ChoreoHelper.csproj` needed no change; HttpServer (prohibited path) is
  untouched and still compiles verbatim against the facade. `PinModeEnabled` and
  `MeasuredDurations` stay public statics on the freezer because HttpServer binds them.
- Tests: `datalayertest` gained three suites (+47 checks): `pose:signature` 18,
  `pose:lifecycle` 19, `pose:thread` 10 — injected clock only, no wall-clock sleeps.

Behavior is byte-identical externally: no wire byte, timeout, cleanup semantic or public
signature changed; playback/preview mutual exclusion untouched; pointer/game-object access
stays on framework-thread paths (FIX-E) and no pointer escapes into the pure components or
HTTP responses.

## Verification actually observed

| Check | Result |
|---|---|
| datalayertest (Release) | 592/592 green (545 baseline, +47, zero regressions) |
| Release build `--no-incremental` | 0 warnings / 0 errors, before and after |
| `node scripts/clipcheck-run.js` | 148/148 green |
| `node scripts/library-verify.js all` | 150/150 green (plugin online) |
| `git diff --check` + scope containment | clean; 7 source/test files, all within writeScope |
| Gate `GATE-RUN-20260901-ARCH2-POSE-LIFECYCLE.json` | passed, attempt 1, 13/13 checks |
| Reviews | module APPROVE + global APPROVE |
| Budgets | 7 changed files (cap 20), 11 gate wall minutes (cap 90), 0 repairs |

Process note: the run's total wall time (claim to finish) was 92 minutes against the 90-minute
ticket budget because gate/review/closeout spanned role conversations; scope, repair and
file budgets were never exceeded and no circuit-breaker condition fired.

## Remaining owner tails and why

- Real-game pose-lifecycle validation (freeze/seek/GPose/pin-mode in-game behavior, unload
  unpins the character, seek/stop/unload races under real use) requires a DLL deploy + reload,
  which this run deliberately did not do. It rides the existing **TAIL:ARCH2-LIVE** wire-parity
  tail: at the next owner-authorized deploy + reload, one in-game pass covers both the
  ARCH2 wire check and pose-lifecycle observation.
- No other new tails; rollback is the atomic revert described in the module change record
  (hunk-scoped to this run's delta inside the shared uncommitted file).

## Files changed

Run delta: `src/PoseSignatureAccess.cs`, `src/PoseSampler.cs`, `src/PoseApplicator.cs`,
`src/PreviewSessionLifecycle.cs` (new), `src/AnimationPoseFreezer.cs`,
`src/tests/datalayertest/datalayertest.csproj`, `src/tests/datalayertest/program.cs`; pipeline
artifacts under `.agent/evidence/TASK-20260901-ARCH2-POSE-LIFECYCLE/`,
`.agent/runs/history/RUN-20260901-ARCH2-POSE-LIFECYCLE.json`,
`.agent/modules/plugin-product/changes/CHG-TASK-20260901-ARCH2-POSE-LIFECYCLE.json`. Closeout
(this role): ticket status closed, `PROCESS-STATE` package 23 closed, backlog row, continuity
snapshot/tails regeneration, this handoff. No web/dist/deploy-root, prohibited-path or live
install changes.
