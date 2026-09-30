# Multi-Dancer Editing Design (track copy + add-to-all)

> Planner architecture-impact artifact for `TASK-20260831-MULTI-DANCER-EDIT`.
> Status: proposal (draft ticket). This document describes intended behavior; it does not mean current code implements it.
> Labels: **[F]** verified fact (with evidence), **[A]** assumption, **[R]** recommendation, **[D]** owner decision.

## 1. Owner intent

Group-choreography editing is still rudimentary. Two concrete pains (owner, 2026-08-31):

1. After changing the dancer count, a new dancer starts with completely empty tracks, and there
   is no way to copy an existing dancer's track content onto them.
2. Adding an action only adds it to dancer 1's track; there is no "add to all dancers".

## 2. Verified current behavior

- **[F]** New dancers are always empty: `makeDancer(idx)` creates `switchClips/actionClips/lyricClips` as `[]` with `currentJob:''` (`web/choreo-app.js:720`).
- **[F]** `setDancerCount(n)` only pushes fresh `makeDancer` entries or pops; it never seeds content (`web/choreo-app.js:722-730`). Count is clamped to 1..3 (`[1,2,3]` buttons, `web/choreo-app.js:1467`).
- **[F]** Sidebar click-add targets only `store.selectedDancer` (default 0 = 舞者1) and appends at that dancer's track end via `addClip` (`web/choreo-app.js:1547-1557`, `822-853`).
- **[F]** The session clipboard keeps each item's source dancer index `di`; `pasteItems` pastes back into `content.dancers[it.di]` (`web/choreo-edit.js:128-143`, `167-195`). Cross-dancer pasting is therefore impossible today — this confirms pain 1's second half.
- **[F]** `addClip` placement for the action track goes through the pure `planActionPlacement` (job-switch 0.5 s, conflict → defer new clip; `web/choreo-edit.js:268`, `web/choreo-app.js:831-841`). The auto job-switch decision reads `d.currentJob` (`web/choreo-app.js:833`).
- **[F]** Owner decision 2026-08-28: manual edits no longer auto-refill gaps — gaps are explicit user intent; existing clips must never be moved by an insert (`web/choreo-app.js:795-819`).
- **[F]** All per-dancer content is consumed generically: game payload `buildGameClips` iterates each dancer's three clip arrays (`web/choreo-edit.js:299-317`), macro generation likewise (`web/choreo-edit.js:323-343`), and persistence stores the same shapes (`web/choreo-document.js` migration/normalize). A duplicated clip needs no executor/compiler/protocol change.
- **[F]** Undo is single-step snapshot history; every editing entry point calls `saveHistory()` (`web/choreo-app.js:86`).
- **[F]** The dancer lane header (`d-hdr`) already hosts per-dancer buttons (game-preview, solo S, mute M, +台词) — the natural home for a copy-tracks affordance (`web/choreo-app.js:1770-1806`).

## 3. Requirement 1 — copy one dancer's tracks to another dancer

**[R]** One-shot copy, not live mirroring:

- Pure function `copyDancerTracks(dancers, srcIdx, dstIdx, allocId)` in `web/choreo-edit.js` (`ChoreoEdit.pure`):
  deep-clones `switchClips`, `actionClips`, `lyricClips` from source to target with **fresh clip ids**
  (`allocId`), preserving `start`, `duration`, `autoDur`, and the full `data` object (any
  unknown/`_extra` keys survive the deep clone); copies `currentJob`; copies nothing else —
  `name`, `color`, `solo`, `mute`, `collapsed`, `laneScale` stay per-dancer.
- UI: dancer-header menu on the target dancer ("从舞者N复制全部轨道"). Target non-empty →
  `confirm()` (same pattern as 清空); cancel changes nothing.
- One `saveHistory()` per copy → one undo step reverts the whole copy.
- Empty source → toast, no change. Source == target → menu item not offered / no-op.

**[A]** Replace semantics (target's existing clips are discarded) is acceptable because the primary
case is a freshly added empty dancer; the confirm dialog makes the destructive case explicit.

## 4. Requirement 2 — add an action to all dancers

**[R]** Sidebar toggle 「添加到全部舞者」 next to the action list (session-scoped, not persisted):

- When enabled, one sidebar click/drop inserts the clip for **every existing dancer at the same
  target start** (齐奏/unison). Per dancer:
  - the existing per-dancer placement rules apply unchanged (`planActionPlacement`, including the
    per-dancer auto job-switch clip when that dancer's `currentJob` differs);
  - if one dancer's tracks conflict at the target time, **only that dancer's** new clip defers;
    other dancers keep the requested start; a toast names deferred dancers;
  - **no pre-existing clip is ever moved or resized** — consistent with the 2026-08-28 owner decision.
- `dancerCount === 1` + toggle on must behave identically to today's single-dancer add.
- One `saveHistory()` for the whole multi-dancer insert.

**[D]** RESOLVED (owner, 2026-08-31) — add-to-all timing semantics: all dancers insert at the
**same absolute start** (齐奏/unison; matches group-choreography intent in the owner's wording
"没有全部增加"). The alternative — appending at each dancer's own track end, which drifts dancers
apart — is rejected. AC-4/AC-5 in the ticket encode exactly this semantics.

## 5. Module, consumer and contract impact

| Surface | Impact |
|---|---|
| `web/choreo-edit.js` (`ChoreoEdit.pure`) | New pure functions (`copyDancerTracks`, multi-dancer add placement helper); node-testable in `web/test-edit.js` |
| `web/choreo-app.js` | UI wiring: dancer-header copy menu, sidebar toggle, toasts; `saveHistory`/`persistProject` as today |
| Document schema / `choreo-document.js` | **None.** Clips keep the existing shape; `dancerCount` semantics unchanged; no migration |
| Show compiler / plugin / `/shows` `/playback` protocol | **None.** Copied clips flow through `buildGameClips` and compile like any clip; no new event type; no `src/` change |
| Generated assets (`libs-classic`, snapshots) | **None.** Never touched |
| Deploy | `web/` sources must be synced to the `web/dist/ChoreoHelper` twin (byte-identical). The two live deploy roots are updated only with explicit owner authorization |

Consumers of `ChoreoEdit.pure` (app, preview3d via `isMuted`, tests) see only additive exports.

## 6. Compatibility, rollout, rollback

- Old projects load unchanged; the features are pure content operations on existing shapes.
- Rollback: revert the bounded web change; no data, schema or protocol artifact is affected, so
  projects saved with copied/added clips remain valid after a rollback.
- Rollout: standard package flow (`docs/AI-WORKFLOW.md`), risk-routed gates, then twin sync;
  live-install overwrite stays owner-gated per product boundaries.

## 7. Risk classification

**R2** — module behavior/state transitions in the web editor; no data/contract/security impact.
Per `docs/AI-PIPELINE-SOP.md` §3: targeted + module gates, independent module review. Not R3:
no persistence format, migration, IPC, shared-lifecycle or cross-deployable change. Not R1: it
changes editing semantics, not isolated styling.

## 8. Test strategy (detail in ticket)

Pure semantics in `web/test-edit.js` (copy id freshness/aliasing/currentJob, add-to-all placement,
deferral isolation, single-dancer equivalence); document round-trip via `web/test-document.js`;
wiring via `scripts/clipcheck-run.js`; loading/twin structure via `web/test-shell.js`.
