# UI overhaul Package 2 — top-bar governance (TASK-20260915-UI-P2-TOPBAR-GOVERNANCE)

## Objective and acceptance

Owner direction after Package 1 deploy: keep focusing on the frontend overhaul. Package 2 fixes the
flat toolbar: 20+ buttons with no grouping, destructive Clear beside Import behind a native
confirm, and undo/redo with no visible entry. Accepted ticket revision 2 (fast lane, R1,
web-product, 10 files / 600 lines / 60 min / 1 repair).

## Mechanism / red baseline

The design-tokens suite gained 11 P2 assertions run against the unchanged tree first: 8 failed
(they pass only after the restructure), including the negative guard that the direct
清空/导出/宏TXT toolbar buttons no longer exist. Red → green recorded in the run.

## What changed and behavior preserved

- `web/choreo-app.js` — renderToolbar regrouped into five `.tb-sep`-separated groups (play/show,
  view, history, resources, project/file); play button is the only `btn primary`; ↶/↷ buttons wire
  the existing undo()/redo() with `historyIdx`-accurate disabled states; new `toggleFilePop()`
  dropdown (📂 文件, outside-click close, same pattern as the advanced popup) collecting
  导出/宏TXT/导入为新项目 with byte-equivalent handlers; new `openClearConfirm()` styled modal —
  confirm disabled until the typed word 清空 matches, then runs the previous clear body and notes
  undoability. Every id/label/title contract kept: playBtn text contract (REQ-SPEC-027),
  button[title=停止], btnCheck, advBtn, stageBtn.
- `web/choreo-helper-app.css` — `.tb-sep`, `.menu-pop`, `.menu-sep`, `.menu-danger`,
  `.clear-modal` rules.
- `web/test-gearset-browser.js` — export clicks now open 📂 文件 first (menu closes after each
  action, so it is reopened before 宏TXT); real-download assertions unchanged.
- dist twins synced sha256-identical.

## Verification actually observed

Gate RUN-…-R2 **passed** (binding on pipeline-harness inputs): preflight, pipeline-check,
diff-whitespace, shell 117/117, design-tokens 35/35, stop 20/0, sixtrack 20/0, offline-verify 50/0.
Two monitoring checks failed with pre-existing causes proven by A/B against claim-baseline bytes:
gearset-browser (受暂停的套装路径 assertion, 17 prior checks pass including the real downloads
through the new menu) and clipcheck-multidancer (the P1-documented catalog skill-identity failures).
Measure: 2 scope files, +92/−26 lines, 1.9 minutes. Post-gate deploy to both live roots verified
by sha256 (backups in D:/choreo/ui-p2-deploy-20260915/backups); game-root clip-check smoke re-run.

The R1→R2 re-claim followed the same evidence-first pattern as P1: the ticket froze gearset as
required before the pre-existing failure was proven, so the run was cancelled on claim-state
bytes, the ticket revised (monitoring-only with A/B reason) and re-claimed on restored baseline.

## Remaining owner tails and why

Independent review of P1/P2 remains pending (runs closed blocked with full gate evidence after the
owner directed continued frontend work without waiting for routing). The standing tails in
`.agent/CONTINUITY.md` are untouched.

## Files changed

web/choreo-app.js; web/choreo-helper-app.css; web/test-design-tokens.js;
web/test-gearset-browser.js; web/dist/ChoreoHelper/{choreo-app.js, choreo-helper-app.css};
ticket (rev 2); CHG record; this handoff. Deployed to both live roots; no commit/push.
