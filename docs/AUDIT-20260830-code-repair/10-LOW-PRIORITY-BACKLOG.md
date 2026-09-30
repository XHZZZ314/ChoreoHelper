# 10: Low-Priority Re-Check and Maintenance Candidates

These items were found in the second audit but have not reached P0/P1 blocking evidence strength. A successor should first write a failing test or establish real impact before deciding to fix; never refactor casually just because an item is on this list.

## BL-001: chain Playback Depends on Whether onEvent Is Registered

- `web/choreo-engine.js:324-328` puts "find and play the next clip" logic inside `ev.kind === 'chain' && this.onEvent`.
- If the consumer never registered `onEvent`, chain events may skip even internal switches.
- The home page currently uses no chains, so it is not a blocker in this version; before WP-5 introduces segments/compiled chains, add a unit test proving "chains work without a callback" and separate the notification callback from engine state transitions.

## BL-002: Import or Compat Paths May Accept Zero Duration

- The home page's new-action paths generally use `duration || default`, but if external projects / a future schema legitimately store the number 0, it may be replaced with the default or produce invisible entries on other paths.
- WP-5 should uniformly define the allowed duration per event type: action minimums, whether instantaneous events are fixed at 0, and display durations for lyrics/cues.
- All checks use explicit `Number.isFinite` and range validation — never `||`, which confuses 0 with missing.

## BL-003: Command Queue Throttling Uses DateTime.Now

- `src/GameCommandExecutor.cs:112,126` uses the system wall clock for its 200ms throttle.
- When the user or system adjusts the clock, intervals can suddenly stretch or shrink.
- While FIX-B touches command policy, add an injectable monotonic-clock test along the way; without actual failure evidence, do not separately rework the executor.

## BL-004: Action Attribution Window Extended Uniformly for All Events

- `src/PlaybackManager.cs:73-90`'s `ExecuteClip` updates `_lastOwnActionEnd` for action, switch, and lyric alike.
- The window is meant to identify "the most recent action started by ourselves"; lyrics/job switches arguably should not extend action attribution.
- When FIX-B splits event semantics, add a targeted test, then decide whether only actions update it or whether the Seek/Playback plan explicitly returns attribution info.

## BL-005: Preview Success Response Does Not Mean the Command Actually Succeeded

- `ActionPreviewer.Preview` catches exceptions internally but returns no failure to the caller; `HttpServer.HandlePreview` therefore almost always returns `{status:'ok'}`.
- A command entering the queue also does not mean the game executed it. The interface's actual semantics are closer to "accepted".
- FIX-B could change the response to `accepted/queued` and report execution failures via async status or logs; never keep describing queueing success as "the action played successfully".

## BL-006: Defensive Gate Release for Single Recording

- `src/Exporter/ExportServer.cs:201-205` checks `_batchRunning` after acquiring `RecGate`; that early return sits before the `try/finally`.
- Under the current batch flow, when `_batchRunning` the batch normally already holds the gate, so the branch is theoretically hard to reach; but any state race or future flow change could leak the gate.
- FIX-E should place all returns after gate acquisition inside a single `try/finally`, with a state-machine test proving each path releases exactly once.

## BL-007: Static Files Read Whole Into Memory

- `src/Exporter/ExportServer.cs:531` uses `File.ReadAllBytes` to serve models and web assets.
- Current models are a few hundred KB, so impact is small; future GLBs with textures could raise memory peaks significantly.
- If OPT-F measurement confirms the need, switch to streamed copying with correct Content-Length/cancellation handling; never rewrite the server for this item alone.

## BL-008: Recovery Bundle Check Contains a Always-True Assertion

- `scripts/restore-bundle-check.js:112`'s bone-match assertion ends with `|| true`.
- The next line's status-bar regex still checks `101/101`, so coverage is not entirely lost, but that assertion itself can never fail.
- When RELEASE-G or FIX-D extends backup tests, remove the always-true condition and make the assertion check structured `matchInfo` directly; ensure the test fails when the bone count is deliberately wrong.

## BL-009: Test Scripts Leave Temp Screenshots in the Repo

- `scripts/profile-look-check.js` generates `profile-check.tmp.png`.
- Before running, confirm output ownership; afterwards the script should clean up uniformly on success/failure/Ctrl+C paths, or write to a controlled temp directory instead.
- Never delete the owner's pre-existing screenshots; clean only files this script created with known paths.

## Handling Rules

1. Mark each item "confirmed / rejected / keep observing" first.
2. Confirmed items go into the closest existing repair package or get a small standalone task.
3. Fixes must add regression; for rejected items, record the evidence in a handoff so the next round does not re-investigate.
4. These candidates must not block FIX-A~FIX-E and must not be stretched into unrelated refactors.
