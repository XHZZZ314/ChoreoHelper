# HANDOFF — Multi-Dancer Editing (track copy + add-to-all)

Package: TASK-20260831-MULTI-DANCER-EDIT (revision 2, R2) · Worker run RUN-20260831-MULTI-DANCER-EDIT-R2 · 2026-08-31

## Objective and acceptance

Implement the two owner-requested group-editing operations in the web editor, per the accepted
ticket and `docs/DESIGN-multi-dancer-editing.md`:

1. Copy one dancer's three tracks onto another dancer (fresh clip ids, currentJob carried over,
   per-dancer view state untouched, confirm for non-empty targets, one undo step).
2. A session toggle 「添加到全部舞者」: one sidebar click/drop inserts the same action at the same
   absolute start for every existing dancer, with per-dancer auto job-switch and per-dancer
   conflict deferral, never moving existing clips, in a single undo step.

AC-1..AC-9 are in the ticket; evidence mapping is below.

## Mechanism / red baseline

- Pure layer did not exist: `node web/test-edit.js` crashed with `TypeError: pure.copyDancerTracks
  is not a function` (red), and the editor had no copy/add-to-all affordance at all
  (`makeDancer` always created empty tracks; sidebar add targeted `selectedDancer` only).
- Existing placement semantics discovered during implementation (kept, not changed):
  `planActionPlacement` only defers via the job-switch window (`needSwitch=true`) or the action
  window vs the switch track; a same-job (`needSwitch=false`) action drop onto an occupied action
  window overlaps today and add-to-all preserves exactly that rule.

## What changed and behavior preserved

- `web/choreo-edit.js` — two additive pure functions (node-tested):
  - `copyDancerTracks(dancers, srcIdx, dstIdx, allocId)`: deep-clones the three track arrays with
    fresh ids and `selected:false`, carries `currentJob`, returns the target dancer; `null` with
    zero mutation on empty source, `src===dst`, out-of-range or missing `allocId`. Unknown keys
    inside `data` (`_extra`) survive; `name/color/solo/mute/collapsed/laneScale` untouched.
  - `planMultiActionPlacement(dancers, st, dur, item, jobMap)`: read-only per-dancer plan
    `[{di,needSwitch,st,swStart,swDur,deferred}]` reusing `planActionPlacement`; unison start for
    free dancers, deferral isolated to the conflicting dancer, `null` placeholders for empty slots.
- `web/choreo-app.js` — wiring only:
  - `addClip` gained a trailing internal `noSave` flag (default path identical);
  - `addClipToAllDancers(item,st)`: dancerCount≤1 delegates to `addClip` (AC-6 by construction);
    otherwise builds switch/action clips per plan with fields identical to `addClip`, runs
    per-dancer `autoFillGaps`, toasts deferred dancer names, one `saveHistory()` per operation;
  - `copyDancerTracksFrom(dst,src)` + `showCopyTracksMenu` + dancer-header 「⇉」 button
    (class `dh-copy`, deliberately not `.dh-sm` whose DOM indexes clip-check ⑱/㉚ rely on);
    empty source toasts, non-empty target `confirm()`s, cancel changes nothing;
  - session `store.addToAll` toggle rendered above the action list (not persisted);
    click and drop action-track paths honor it; switch-category items keep single-dancer behavior.
- `scripts/clipcheck-run.js` — additive `--scenario <name>` mode: opens the local dist twin app
  page in an isolated headless profile, waits for `appReady`, runs a registered self-contained
  scenario via CDP. Default clip-check mode unchanged.
- `web/test-edit.js` — new sections 11/12, purely additive (93 → 116 cases).
- Twins `web/dist/ChoreoHelper/choreo-edit.js` / `choreo-app.js` synced byte-identical (`cmp`
  verified). The devPlugins and game-root live deploy copies were NOT written (owner-gated).

Document schema, migration, show-package protocol, plugin `src/`, executor, compiler and
generated assets: untouched. Copied/added clips keep the existing shape and compile through
`buildGameClips` per actorId exactly like hand-placed clips.

## Verification actually observed

- Red→green: test-edit crashed before the pure functions existed; after implementation
  `116/0, exit 0` (baseline 93 + 23 new cases: id freshness, field parity incl. `_extra`,
  aliasing regression, empty/identity/oob guards, unison placement, per-dancer `needSwitch`,
  deferral isolation with read-only planner, single-dancer equivalence, `buildGameClips` payload).
- Browser scenario `node scripts/clipcheck-run.js --scenario multidancer`: `22 过 / 0 败, exit 0`
  against the synced twin — confirm cancel/confirm on non-empty target, one-undo revert of copy
  and of add-to-all, real `.act-item` click unison (8/8/8), per-dancer 0.5s job-switch, conflict
  deferral isolation with id-level no-move check, toast naming 舞者3, single-dancer equivalence.
- Regression: default clip-check at the game deploy root `148/0, exit 0`; `test-shell 41/0` after
  the twin sync (before sync it correctly flagged `choreo-app.js source/dist twin FAIL`);
  `test-document 88/0`, `test-docwire 45/0`, `test-showcompiler 37/0`, `test-engine 47/0`,
  `test-check 73/0`, `test-projects 96/0`, `test-library 91/0`.
- Gates: `pipeline-cli ticket` PASS, `pipeline-cli check` PASS,
  `process-audit.js --check` 21/21. Machine gate artifact:
  `.agent/runs/GATE-RUN-20260831-MULTI-DANCER-EDIT-R2.json` (9 checks, exit/duration/evidence
  hash each). Module review (separate context):
  `.agent/runs/REVIEW-RUN-20260831-MULTI-DANCER-EDIT-R2-module.json` — APPROVE, findings
  info/low only. Run closed `completed`.

## Remaining owner tails and why

- Live deploy roots: syncing `web/dist/ChoreoHelper` changes into `%AppData%/XIVLauncherCN/
  devPlugins/...` and the game `dist/ChoreoHelper` overwrites a live install — owner-gated per
  product boundaries (the local repo twin is already synced; browser verification used it).
- Human UI acceptance of the two new affordances in real use (editor-only; no plugin change, so
  no live-game acceptance is required for correctness).
- Owner-manual updates (使用说明.md/操作速查.md) are a ticket nonGoal / follow-up.

## Files changed

`web/choreo-edit.js`, `web/choreo-app.js`, `web/test-edit.js`, `scripts/clipcheck-run.js`,
`web/dist/ChoreoHelper/choreo-edit.js`, `web/dist/ChoreoHelper/choreo-app.js` (twin),
`.agent/runs/GATE-…​.json`, `.agent/runs/REVIEW-…​-module.json`,
`.agent/runs/history/RUN-20260831-MULTI-DANCER-EDIT-R2.json`,
`.agent/modules/web-product/changes/CHG-TASK-20260831-MULTI-DANCER-EDIT.json`, this handoff,
`docs/AI-BACKLOG.md`, `.agent/PROCESS-STATE.json`, `.agent/CONTINUITY.md`.
