# HANDOFF — ENGINE-CURSOR: timeline cursor invariants (2026-08-31)

## Scope

Closed the ENGINE-CURSOR package from `docs/AI-BACKLOG.md` (order 6). Web-only package: `web/choreo-engine.js`, `web/test-engine.js` (+3 doc files). No C#, no release staging, no SPEC changes, nothing committed/pushed/published.

## Invariant (the package's required definition)

**`timelineIdx` is always the first not-yet-fired timeline entry at the current engine time.** Entries with `start < t` are past; entries with `start == t` are still pending — consistent with `update()`'s `time >= start` firing condition and with the long-standing "setTimeline at time 0 fires the `start=0` entry on the first update" behavior. Every playhead-mutating path must realign immediately: `scrubTo`, `seek`, `setTimeline`, and direct `timeline` replacement (the setter, used by preview3d rebuilds, already aligned to the current time since the AUD-018 work in this working tree).

## Root causes and minimal fixes (`web/choreo-engine.js`)

### ENGINE-1 — `scrubTo` leaves the event cursor stale

- Evidence: `scrubTo(t)` set `this.time` and realigned only the per-character *display* state (active clip + clipTime); `timelineIdx` kept its old value. After `scrubTo(2)` on `[a@1, b@3]`, the next `play()+update()` re-entered the firing loop at idx 0 and replayed `a` (`playClip` resets `clipTime` to 0), surfacing as a pose jump plus a spurious `clip` event. Scrubbing *backwards* had the mirror failure: with idx already past the end, re-crossed entries never fired again.
- Fix: `scrubTo` now calls the new `_alignCursor()` right after the null-timeline guard — one binary search `timelineIdx = firstAtOrAfter(timeline, time)` (O(log N), the function that already existed for the setter). Same one line added to `seek(t)`, the other public playhead jump (no product caller today; aligned so the invariant is total, not because a live path needed it).

### ENGINE-2 — `setTimeline` aligns with the old time

- Evidence: the body assigned `this.timeline = entries` (setter aligns idx against the *current* time) **and then** reset `this.time = 0`. With the playhead at 2s and replacement entries starting at `[0,1,2,3]`, the setter aligned to `start=2` (idx=2) and only afterwards zeroed time — exactly the reproduction recorded in the backlog: `time=0` with `timelineIdx=2`. The first `update()` then skipped the first two entries; if the replacement timeline was shorter than the old index, nothing ever fired.
- Fix: order swap — `this.time = 0` first, then `this.timeline = entries`, so the setter aligns against the new time (idx 0 for normal non-negative starts). `stopToIdle` unchanged.

## Production preview behavior preserved

preview3d's main loop is `engine.scrubTo(store.currentTime)` + `engine.update(now)` every frame, and nothing in product code ever calls `engine.play()`/sets `engine.playing` — the playhead truth is `store.currentTime` and `update()` always runs the paused branch (advanceBlend + sample/apply), so the `timelineIdx` firing loop was dead code in the live preview. That is why this bug was *latent*: the module is a public API (`ChoreoEngine`), its own clock path was simply wrong. The only runtime delta after the fix is one extra O(log N) binary search per `scrubTo` call — the existing AUD-018 benchmark (600 frames × 3000 entries) still reports ~0 ms, and sections 7/10/11 of the engine suite (scrub display semantics, loop-seam blending, binary-search equivalence) all pass unchanged.

## Regression coverage (red → green observed, `web/test-engine.js` section 12, +7 checks)

- ENGINE-1 forward: `scrubTo(2)` → `play()` → 3 updates on `[a@1, b@3]` → no `clip` event and `clipTime` continues from 1.3, not reset. Before: `evs:["a"]`, `clipTime=0.3`.
- ENGINE-1 backward: play past both entries (idx=2), `scrubTo(0.5)` → idx realigns to 0; 8 more updates → `a` fires exactly once (`["a"]`). Before: idx stayed 2 and `evs` stayed empty.
- ENGINE-2: playhead at 2s, `setTimeline` with starts `[0,1,2,3]` → `time===0 && timelineIdx===0`. Before: `{time:0, idx:2}` — the exact reported repro.
- Mixed: `scrubTo(5)` on a 4-entry timeline → idx=2 pending at `y@5`; `setTimeline` (2 entries) → `play()` + 25 updates → exactly `["x","y"]` in order. Before: idx 0 at scrub, then nothing fired after replacement.
- Invariant property sweep: `scrubTo(t)` then `seek(t+0.25)` over 11 targets (0, boundaries, duplicate starts at 3, past-end, 100) — `timelineIdx` always equals a test-side linear `firstAtOrAfter` reference. Before: first failure at `seek` t=1 (`idx:0, want:1`).

Red observed first: **40 pass / 7 fail**, every failure matching the predicted mode above; after the fix **47/47**.

## Verification (commands and observed counts)

- `& D:\nodejs\node.exe web\test-engine.js` → **47/47** (was 40; +7; no prior assertion weakened).
- All six Node suites: engine 47, edit 93, check 73, projects 96, library 91, shell 33 — all green, counts unchanged except engine.
- `scripts/clipcheck-run.js` (game root default) → 134/134; explicit `web/dist/ChoreoHelper/clip-check.html` run → 134/134.
- `scripts/offline-verify.js all` → 45/45. `scripts/library-verify.js all` → 117/117.
- C# untouched per matrix (web-only change); release staging untouched.
- Deploy sync: `web/choreo-engine.js` copied to `web/dist/ChoreoHelper`, `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`, and the game root `dist\ChoreoHelper` — four-way md5 equal (`b0d1e708…`), recursive diff of source-dist vs both remote roots: zero lines. `test-engine.js` is a test file and is not deployed.

## Docs updated

- `docs/AI-BACKLOG.md`: package 6 marked CLOSED with summary; next open package is FIX-J (order 7).
- `docs/engine.md`: cursor invariant noted in the playback-control API block.
- `.agent/CONTINUITY.md`: objective, verified state, contract, files changed, next action.

## Owner tails

- Nothing here needs live-game acceptance: the fixed code path (engine-owned clock firing) is not reachable from the current web preview, and all browser harnesses pass on the synced roots. The next DLL-adjacent owner action remains the FIX-J/SEC-1 queue, not this package.
