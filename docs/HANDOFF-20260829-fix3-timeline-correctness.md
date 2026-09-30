# HANDOFF: FIX-3 Timeline Correctness (2026-08-29)

> What this file is: build handoff for FIX-3. Scope = **AUD-007 / AUD-008 / AUD-010 / AUD-014**, the four timeline-correctness items from the master audit list (`HANDOFF-20260829-code-audit-fix-optimization.md`).
> Version stays **0.7.1** (pure web changes; C# untouched, no DLL built or deployed); not committed, not published.

## 1. What Was Fixed (by audit ID)

### AUD-007 deleteTime misses clips whose start is left of the delete zone

- **Root cause**: `deleteTime()` in `web\choreo-edit.js` was missing one interval case — a clip starting left of the delete zone (`start < t0`) with its end inside it (`t0 < end <= t1`) fell through all four mutually exclusive branches into "before the interval, untouched". Example: clip [4,7), delete [6,8) — old code left it unchanged; correct result is truncated to [4,6).
- **Fix**: added a fifth branch "end inside the interval (start on the left) → truncate to t0", using the same 0.5s rule as the "start inside the interval" branch (post-truncation length <0.5s deletes the clip outright). All other semantics preserved verbatim ([t0,t1) half-open interval, 0.01 tolerance, spanning clips shortened, later clips shift left, markers translate).
- **Tests**: `web\test-edit.js` new section 4b, 4 assertions (audit sample [4,7)+delete[6,8); left-truncated to <0.5s deletes; adjacent boundaries end=t0 / start=t1; same criteria across job / lyrics / global-lyrics track types).

### AUD-008 Batch move's per-clip clamping destroys relative spacing

- **Root cause**: three independent per-clip clamps — pure function `batchMove` clamps per clip, drag `dragClip` clamps multi-select followers per clip, keyboard multi-select move clamps per clip. Sample: [0,5] group-moved left 3s → [0,2]; a 5s spacing shrank to 2s.
- **Fix**: new pure function in `choreo-edit.js`, **`moveGroup(items, delta, totalDuration)`**: computes one common allowed delta from the group's earliest start / latest end; the whole group clamps together and stops at the edge together, pairwise spacing unchanged; returns the delta actually applied. `batchMove` converged into a thin wrapper around it (delta quantized to q05 once) — the old "clamp each clip to the pile edge" behavior was replaced per the audit (the corresponding old test assertions were updated to the new semantics). The homepage's drag and keyboard paths dropped their own clamps and both call `moveGroup` (three copies of boundary logic unified). 0.5s quantization of delta remains the drag path's job (snap + rounding); the pure function no longer rounds per clip (that itself broke spacing of starts not on the 0.5 grid).
- **Tests**: test-edit section 2's two clamp assertions rewritten to whole-group semantics + new section 2b, 5 items (left/right boundary applied delta, spacing kept across dancers and tracks, delta=0, empty args).

### AUD-010 Auto job-switch clip inherently overlaps the action by 0.5s; checkup generates false reds

- **Root cause**: the job-switch clip auto-inserted by `addClip` used `start=st-0.5, duration=1`, covering up to st+0.5 and overlapping the following action by 0.5s — every job-carrying action created through the normal entry reported red. Macro generation emits `<wait.0.5>` for job switches, proving the real semantics is 0.5s.
- **Fix**: new pure function in `choreo-edit.js`, **`planActionPlacement(switchClips, actionClips, st, dur, needSwitch)`** (switch takes 0.5s and ends exactly when the action starts at st):
  1. Switch window [st-0.5, st) conflicts with the action track (cross-track) or the switch track (same track) → action + switch are postponed together to conflict end **+0.5** (the switch always stretches 0.5 forward; +0.05 doesn't fit it);
  2. Action window [st, st+dur) conflicts with the switch track → keeps the old +0.05 postponement (original conflictEnd semantics);
  3. st<0.5 → action pushed to 0.5 so the switch fits;
  4. needSwitch=false (consecutive same-job actions) → returned unchanged.
  Homepage `addClip` now calls this function; the old `hasSW` check was deleted (the pure function guarantees the placement window has zero overlap, so a duplicate switch is impossible); direct drag-drop onto the switch track keeps the original conflictEnd semantics untouched.
- **Tests**: test-edit new section 10, 7 items (audit-required: empty track / 0-second start / existing switch / existing action conflict / same-job consecutive / different-job consecutive + a multi-round convergence case), each with a "placement result has zero overlap" verification; clip-check ㉒ drives the real page's `addClip` through four placements and then runs the real `ChoreoCheck`, asserting zero self-generated red items.

### AUD-014 Quick recording reads the wrong field; draft-referenced actions miss the quick list

- **Root cause**: `recDraftSet()` reads `c.command`, but the actual timeline clip structure is `c.data.command` — actions referenced by the current project but outside the fixed REC_QUICK list never entered "quick init common actions".
- **Fix**: changed to `(c.data && c.data.command) || c.command || ''` (current structure first, old-structure fallback for compatibility).
- **Tests**: clip-check ㉓: picks an action not in REC_QUICK from the catalog (this run got surprised), puts both a current-structure and an old-structure reference in the draft, asserts `recQuickItems()` contains it exactly once (dedup, count=1).

## 2. Changed Files

| File | Change |
|---|---|
| `web\choreo-edit.js` | AUD-007 branch added; new moveGroup / planActionPlacement added and exported; batchMove converged |
| `web\choreo-helper-app.html` | addClip wired to planActionPlacement; dragClip/keyboard multi-select wired to moveGroup; recDraftSet reads data.command |
| `web\test-edit.js` | 57→**73**: section 2 assertions updated to group semantics; new sections 4b/2b/10 |
| `web\clip-check.html` | new ㉒㉓ groups (92→**100** assertions); header comment updated |
| `web\mode-check.html` | test infra only: zero-request counting excludes `/capabilities` (WP-1's capsOk 15s self-heal probe lands in the window; same class of false positive as /health; product code untouched) |
| `scripts\clipcheck-run.js` | **new file**: repeatable headless-Chrome runner for the diagnostics acceptance pages (previously manual); defaults to the game-dir deploy copy of clip-check |

Three deploy locations synced, md5 verified identical (source web\ → web\dist\ChoreoHelper → devPlugins\dist\ChoreoHelper → game dir\dist\ChoreoHelper):
choreo-edit.js=cbd6cf2d…, choreo-helper-app.html=34ab13dd…, clip-check.html=145646eb…, mode-check.html=92eb97d1…

## 3. Regression Results (all actually run)

| Check | Result |
|---|---|
| `node web\test-edit.js` | **73/73** (57 original + 16 new) |
| `node web\test-check.js` | 47/47 |
| `node web\test-projects.js` | 77/77 |
| `node web\test-engine.js` | 35/35 |
| `node web\test-library.js` | 23/23 |
| `node scripts\library-verify.js all` | **103/103** (real plugin online) |
| `node scripts\offline-verify.js` | **21/21** |
| clip-check (game-dir deploy copy) | **CLIP-PASS, 100 items** |
| mode-check (48795 real plugin, live seek) | **MODE-PASS, 18 items** (3 consecutive runs) |
| `git diff --check` | pass |
| Inline script syntax | node Function check, 1 segment, 0 errors |

## 4. Two Findings About the Acceptance Tooling Environment (no product impact, but remember them)

1. **New headless Chrome blocks file:// → localhost fetch**: local Chrome (headless=new) fetching 48794/48795 from a file:// page fails with "Failed to fetch"; `--disable-web-security` restores it. Experiment isolated the cause: **blocked only when `--allow-file-access-from-files` is added** (origin changes from null to `file://`, mismatching the plugin's `ACAO: null`); file:// pages without that flag work as usual (that's how library-verify/offline-verify ran). **The owner's live file:// entry is unaffected** (passed on-machine acceptance 2026-08-29). So: acceptance pages like clip-check that need cross-origin iframe reads use `scripts\clipcheck-run.js` (defaults to game-dir file:// + that flag; UI-only, no network dependency) or the 48795 http origin; acceptance needing the real plugin's network keeps the old way (file:// without the flag, or 48795 origin).
2. **mode-check zero-request assertion counting window**: the capsOk 15s self-heal (connection self-heal probe introduced in WP-1) periodically hits 48794 `/capabilities`, landing inside the web-playback zero-request window and causing an intermittent single-item false positive — excluded following the /health precedent; after exclusion, 3 consecutive MODE-PASS runs.

## 5. Master Audit List Status Sync

The AUD-007 / AUD-008 / AUD-010 / AUD-014 rows were updated to "FIX-3 fixed (see this handoff)". FIX-3 exit criteria checked: pure-function tests complete ✔; real-page diagnostics (clip-check ㉒㉓) ✔; multi-select spacing / delete-time / auto job-switch / quick-record list all match the audit's acceptance criteria ✔.

## 6. Next Steps

1. **Owner on-machine acceptance** (optional, not queued): create a few job-carrying actions (different jobs adjacent, dragged into the middle of a continuous timeline) — the switch clip should sit exactly 0.5s before the action and the checkup should stop reporting self-generated reds; multi-select several clips and drag to the left/right edges — spacing should hold; right-click "insert/delete time" removing a span covering the left half of clips no longer misses. Not doing this does not block FIX-4.
2. **Next package = FIX-4 (WP-4 full closeout: AUD-009 nested overlap + AUD-013 fingerprint/capability/macro checks)**; do not jump to WP-5.
3. Phase-4 acceptance tail (one pose-category round + cancel-and-resume recording) still awaiting the owner.
