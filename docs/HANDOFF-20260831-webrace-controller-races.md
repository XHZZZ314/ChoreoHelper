# HANDOFF — WEB-RACE: controller correctness (2026-08-31)

## Scope

Closed the WEB-RACE package from `docs/AI-BACKLOG.md` (order 5). Web-only package: `choreo-app.js`, `choreo-check-ui.js`, `clip-check.html`. No C#, no release staging, no SPEC changes, nothing committed/pushed/published.

## Root causes and minimal fixes

### WEB-1 — macro debounce crosses dancers

- Evidence: the 600ms macro sync timer's callback read `store.activeMacroTab` when it fired. Typing in dancer A's macro tab and clicking dancer B's tab inside 600ms re-rendered the panel (dropping the old timer id from the new `syncTimers` object) and the stale timer parsed dancer A's text into dancer B's clips via `parseMacroToClips(text, store.activeMacroTab)` — B's three clip lanes were wholesale replaced.
- Fix (`choreo-app.js`, `renderMacroPanel`): capture `var di = store.activeMacroTab` inside `ta.oninput` and pass `di` to the deferred `parseMacroToClips`. Input identity is now bound at typing time; a late timer writes back to its own dancer only.

### WEB-2 — stale 409 seek retry overtakes a newer seek

- Evidence: `sendSeek`'s 409 branch unconditionally retried the old time after `pushGameTimeline(true)`. A newer seek queued in `_seekPending` was sent only after the stale retry, so the plugin landed on the old time.
- Fix (`choreo-app.js`, `sendSeek`): added `_seekSeq`; every `sendSeek` bumps it and the pending slot stores `{t, seq}`. On 409: after the snapshot re-push, a queued newer seek is promoted (it keeps its own one-shot 409 retry right); the old time is retried only when it is still the newest intent (`seq === _seekSeq`). FIX-B's retry-once-against-revision semantics are preserved.

### WEB-3 — realtime check renders during drag

- Evidence: the 800ms debounced `runRealtimeCheck` could fire mid-drag; `applyCheckIssues` saw a changed issue signature (clip positions move while dragging) and called `render()`, rebuilding the DOM under the pointer.
- Fix: `dragClip` raises `store._clipDragActive` for the gesture (`onUp` clears it). `runRealtimeCheck` bails while it is set, and `applyCheckIssues` discards late-arriving results (guard at top) instead of re-rendering. The drag-end `render()` re-arms the scheduler, so exactly one final check runs against the final layout.

### WEB-4 — measured duration leaves plugin snapshot stale

- Evidence: `refreshMeasured` auto-corrected clip durations (`ChoreoEdit.pure.applyMeasuredDurations`), rendered and persisted, but never bumped `store._tlRevision` — the plugin kept the old snapshot/revision while local content had changed.
- Fix (`choreo-app.js`, `refreshMeasured`): when `fixed > 0`, call `bumpTimelineRev()` first — revision increments and, in game mode while paused and connected, the debounced `pushGameTimeline` ships the corrected snapshot. `bumpTimelineRev`'s own mode gates keep web-only sessions local.

### WEB-5 — empty timeline click does not seek game

- Semantics confirmed: every explicit playhead jump (bottom ruler, marker click, check-modal jump) already seeks; empty-area click was the one exception.
- Fix (`choreo-app.js`, `wrap.onclick`): empty-area click now calls `sendSeek(store.currentTime)`. `sendSeek` itself is a no-op unless `previewTarget === 'game'`, so web 3D rehearsal is unchanged and game mode is consistent across all jump paths.

## Regression coverage (red → green observed)

New clip-check section ㉚–㉞ (15 checks) in `web/clip-check.html`, driving the real app through the iframe with synthetic events and a stubbed `apiFetch`:

- ㉚ WEB-1: type into A's macro textarea, click B's tab within the debounce window, wait 750ms → A has the 2 parsed clips, B's lanes untouched. Before the fix: A=0, B overwritten (2/0/0).
- ㉛ WEB-2: seek(1) in flight, seek(2) queued, first rejected with 409 → exactly 2 seek calls `[1, 2]` after the snapshot re-push. Before: `[1, 1, 2]`.
- ㉜ WEB-3: arm the debounced check, drag through its fire point (>1s of moves) → zero full renders mid-drag, dragged node stays connected, and after mouseup the final check clears the red overlap strokes on its own. Before: render Δ=1 and the node was detached.
- ㉝ WEB-4: `refreshMeasured` with a stubbed `/actions/measured-durations` → clip corrected to 3.3s, `_tlRevision` +1, one `/playback/timeline` push containing `"duration":3.3`. Before: revision unchanged, zero pushes.
- ㉞ WEB-5: click the lane body at 4s in game mode → playhead at 4s and one seek with time 4. Before: no seek call.

## Verification (all observed in this session)

- `scripts/clipcheck-run.js` on `web/dist/ChoreoHelper/clip-check.html`: **134/134** (was 119; +15). RED first observed at 125 pass / 7–8 fail before the fixes.
- Same page on the game root (`clipcheck-run.js` default): **134/134** post-sync.
- Node suites: engine **40/0**, edit **93/0**, check **73/0**, projects **96/0**, library **91/0**, shell **33/0**.
- `scripts/offline-verify.js all`: **45/45**. `scripts/library-verify.js all`: **117/117**.
- Deploy roots: `choreo-app.js`, `choreo-check-ui.js`, `clip-check.html` copied to `web/dist/ChoreoHelper`, `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`, and the game `dist\ChoreoHelper`; recursive `diff -r` of both remote roots vs source-dist: **IDENTICAL** (four-way md5 equal).
- `git diff --check` clean. C# untouched per the matrix; no live-game or recording scenarios (not required by this package).

## Notes for the next session

- Next open package per backlog order: **ENGINE-CURSOR** (`scrubTo`/`setTimeline` cursor invariants in `choreo-engine.js`).
- The WEB-2/4/5 scenarios stub `w.apiFetch` with a rejecting fallback for unrelated URLs; this matches the offline page state and does not leak beyond each section (each restores the original `apiFetch`, `previewTarget`, `gameConnected`, `measuredDur`).
- Owner/live acceptance queue is unchanged; WEB-RACE adds no owner tails (fully covered by the headless harness).
