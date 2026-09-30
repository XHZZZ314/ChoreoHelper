# UI overhaul Package 4 — operation ergonomics (TASK-20260915-UI-P4-OPERATIONS)

## Objective and acceptance

Owner direction: continue the five-package UI overhaul (INT-20260915-UI-OVERHAUL-P1); Packages
1–3 implemented, gated and deployed. Package 4 adds operation ergonomics: playback control knew
only Space and Home (precise playhead positioning needed mouse drags); snapping was all-or-nothing
via the toolbar Snap toggle (dragging past a snap point required flipping the switch twice); the
growing toolbar/menu/panel surface had no quick keyboard access. Accepted ticket revision 1 (fast
lane, R1, web-product, 10 files / 600 lines / 60 min / 1 repair). Run
RUN-20260915-UI-P4-OPERATIONS.

## Mechanism / red baseline

Baseline before edits: shell 121/0, design-tokens 57/0, stop 20/0, clipcheck sixtrack 20/0,
offline-verify 45/2 — the two offline failures (3D real-model upgrade waits) existed before the
first P4 edit and are identical in every later run. The design-tokens suite gained 26 P4
assertions; they went red-green against the implementation in the same session (no separate
qualityContract on this ticket).

## What changed and behavior preserved

- `web/choreo-bootstrap.js` — new `seekBy(d)` helper clamps to `[0, store.totalDuration]` and
  routes through the existing `seekTimelinePosition`; K toggles play exactly like Space, J/L jump
  the playhead −/+5 s, `,`/`.` step −/+0.1 s (Shift = 1 s), all after the existing
  input/contentEditable guard; Ctrl+K (preventDefault) opens the palette, including while playing.
  Every pre-existing binding line (Space, Delete, Ctrl+Z/Y/D/C/V/A, Home, ArrowLeft/Right with and
  without Shift) byte-preserved.
- `web/choreo-app.js` — `snapTime(t,clip,di,tt,type,bypass)` returns the raw time when `bypass`
  is set, consulted before `store.snapEnabled`; the three `dragClip` call sites pass `ev2.altKey`
  so holding Alt mid-drag suspends snapping while the toolbar Snap state, threshold, beat-snap
  branch and candidate logic are untouched; the Snap button title now mentions the Alt bypass.
  New `buildCmdkCommands()` rebuilds a 16-entry registry at open time wired only to existing
  global actions (play/stop/undo/redo/snap/prop/sidebar/compact toggles with the toolbar
  buttons' own statements, `__togglePreview3D`, `#musicPanel` visibility,
  `alignSelectionToPlayhead`, `openGroupMove`, `openClipTime`, `deleteClip`, `edSelectAll`,
  `showCheckModal`); `openCmdkPalette()` injects it into the module.
- `web/choreo-cmdk-ui.js` (new) — strict classic-script pure view module exporting
  `ChoreoCmdkUI.open/close/isOpen`: centered mask (`.cmdk-mask` z-index 600, above the 500-layer
  docked panels) + panel, autofocus filter input, substring filter over the Chinese title plus an
  optional keyword alias, ArrowUp/ArrowDown cycle the active item, Enter runs and closes, Escape
  or a mask click closes without running; no network, no store access, no persistence.
- `web/choreo-helper-app.css` — `.cmdk-*` palette styles on the P1 token ladder.
- `web/choreo-helper-app.html` — registers `choreo-cmdk-ui.js` after `choreo-app.js`, before
  `choreo-bootstrap.js`.
- `web/test-shell.js` — `choreo-cmdk-ui.js` added to uiScripts/productFiles (order, twin,
  whitelist and strict-script checks cover it automatically).
- `web/test-design-tokens.js` — +26 P4 assertions (AC-1 key literals/clamp/guard/preserved
  bindings; AC-2 bypass-before-snapEnabled, 3× `ev2.altKey` call sites, preserved snap toggle and
  threshold lines, Alt title; AC-3 module contract, export, Arrow/Enter/Escape literals, filter
  semantics, mask-click close, z-index 600, no-network, registry ≥10 wired only to existing
  globals; AC-5 load order + five twin hashes).
- `scripts/make-release-staging.js` — whitelist entry for the new module.
- dist twins synced sha256-identical for all five changed product files.
- `.agent/CONTINUITY.md` — the one repair attempt: removed drift-listed verification chronology
  (test-count vectors, per-deploy counts, one duplicated DLL line) to bring the startup-doc
  budget from 20309 to 19971 bytes (cap 20000); no decision, risk or owner tail removed.

## Verification actually observed

Gate RUN-20260915-UI-P4-OPERATIONS (binding-verified, logs+hashes under
`.agent/evidence/TASK-20260915-UI-P4-OPERATIONS/runs/RUN-20260915-UI-P4-OPERATIONS/`):
8/10 checks — preflight, pipeline-check (after the doc-budget repair), diff-whitespace, shell
123/123, design-tokens 83/83, stop 20/0, sixtrack pass. `offline-verify-all` (required) failed
45/2: both failures are 3D real-model upgrade waits, deterministic across the pre-edit baseline,
both gate runs and a dedicated re-run; the P1–P3 gates earlier the same day had this check green
at 50/0, so the regression window is owner-side modifications after the P3 gate to
`scripts/offline-verify.js` / `web/preview3d.js` — both prohibited paths for this ticket and
untouched by this run. The two optional failures are the ticket's documented monitoring-only
pre-existing cases (gearset-browser 受暂停的套装路径; clipcheck-multidancer P1 skill-identity).
Measure: 3 lockScope files, +106/−5, zero out-of-scope paths. Deepened self-test: headless-Chrome
`file://` smoke over the dist twins with network blocked, 23/23 (every AC-1 key behavior
including both clamps and the INPUT guard; AC-2 bypass probe + Snap title + toolbar toggle; AC-3
palette open/focus/z-index/filters/Arrow/Escape/Enter/mask-click). `check-ai-docs.js` 60/60,
`process-audit.js --check` 25/25. Run closed **blocked**: independent review pending and the
offline-verify real-model regression needs an owner decision before an approving review can bind
a green gate.

## Remaining owner tails and why

- P4 (and P1–P3) independent module review remains pending — owner directed continued frontend
  work without waiting; the Worker never approves its own change.
- offline-verify real-model regression (two timeout scenarios) predates P4 and lives on
  prohibited paths; needs owner-side repair or an explicit re-baseline decision.
- Live-root deployment of the five P4 product files NOT performed: the ticket scopes rollout to
  the working tree + web/dist twins, with per-file live deploy following the owner-authorized
  flow after the gate; with the gate red on the pre-existing item the deploy decision stays with
  the owner.
- Owner direction recorded as INT-20260915-OWNER-CONTINUE-FRONTEND: skip skill-direction
  interruption triage for now; next frontend package is Package 5 render performance (unified
  clock, playhead layer, timeline virtualization), which needs a fresh planner-qa-fast ticket
  before a Worker run.

## Files changed

web/{choreo-bootstrap.js, choreo-app.js, choreo-cmdk-ui.js (new), choreo-helper-app.css,
choreo-helper-app.html, test-design-tokens.js, test-shell.js}; scripts/make-release-staging.js;
web/dist/ChoreoHelper/ five twins; .agent/CONTINUITY.md (doc-budget repair); ticket (rev 1); CHG
record `.agent/modules/web-product/changes/CHG-TASK-20260915-UI-P4-OPERATIONS.json`; this
handoff. No commit/push, no live-root deploy.
