# Handoff: M2 stage drag second increment (TASK-20260906-M2-STAGE-DRAG)

## Objective and acceptance

Second M2 feature increment on the numeric-start foundation: the choreographer drags one
dancer's static start x/z on a Chinese 2D stage with one release-time commit; the web 3D
preview reflects the committed placement; undo/redo/reload preserve it; a persistent
Chinese notice states protocol-v1 game playback omits starts (ticket revision 2, R3,
standard lane, review lanes module + global; 1/8/12-dancer file-mode projects with 1–12
headroom; meters, +X screen-right, +Z screen-up, one equal finite scale; placementFor
stays the single placement source; stored yaw preserved exactly; schema-v2/protocol-v1
and persistence unchanged; web-only — zero game-control requests; no live-root/staging/
release/commit/push). All six acceptance criteria verified by
GATE-RUN-20260906-M2-STAGE-DRAG-R2 (passed; every required check green) plus module
review APPROVE (R2) and global review APPROVE; closed by RUN-20260906-M2-STAGE-DRAG
completed.

## Mechanism / red baseline

- No 2D stage existed before this run (Planner/QA rev2 facts); the new offline-verify
  `stage-drag` scenario asserts drag-handler presence first and exits non-zero on
  pre-change code, so the scenario can never silently skip.
- Review cycle 1 (module REQUEST_CHANGES, findings MF-1 high / MF-2 medium, against the
  first gate): MF-1 — a real no-movement click landing off the 28px marker center
  committed a silent position jump (~0.29 m at the 8-dancer default fit) because the
  commit derived its world position solely from the release point; fixtures only clicked
  centers, so the gate could not see it. Repaired with the review's option (b):
  `stagePointerDown` records the press screen point and `stagePointerUp` cancels with
  zero writes when press→release distance is ≤2px, before any identity/commit logic.
  Decisive by construction: without the guard the off-center release world differs from
  stored/fallback by ~10px/scale meters, far above the 0.01 m quantization, so the spy
  counts would be nonzero. New fixtures cover off-center no-move clicks on explicit-start
  and start-less dancers (spy {h:0,p:0,v:0}, unchanged triple, no start key created).
  MF-2 — the empty-project assertion `ctrls.length>=0` was a tautology; it now fails
  unless every `.stage-list`/`.stage-num`/`.stage-apply` control is disabled with
  `aria-disabled="true"` and zero markers are present.
- Review cycle 2 was process-only: the post-repair gate re-used the prior artifact id,
  which kept routing repair after the fix was green. Resolved by the distinct-id retry
  convention (R2 gate) plus a no-product-byte re-checkpoint; both repair attempts consumed
  (2/2), no further repair permitted without escalation.

## What changed and behavior preserved

- `web/choreo-edit.js` (pure layer): `STAGE_QUANT` 0.01, `computeStageTransform` (single
  finite equal pixels-per-meter scale on both axes within 1e-9, +X screen-right, +Z
  screen-up, padding-box origin), `stageWorldToScreen`/`stageScreenToWorld` exact
  inverses, `stageTransformEqual`, `stageCommitDecision` (finite/unchanged/no-op rules);
  `placementFor` remains the single placement source; existing yaw strictly preserved
  with fallback yaw 0 only for a newly explicit start; stored coordinates never clamped
  to view; auto-fit is pure and leaves the project JSON hash unchanged.
- `web/choreo-stage-ui.js` (DOM layer, same file as the start dialog): `openStage`/
  `closeStage` Chinese 2D stage — `placementFor` markers with inert textContent plus
  aria-label names, CSS-triangle facing arrows rotated by stored yaw, origin mark, scale
  label, dancer list (all N reachable by keyboard), numeric x/z/yaw alternative with
  Enter/Escape, persistent notice that web preview uses starts but protocol-v1 game
  playback omits them. Ghost-only pointer moves (canonical dancers JSON deep-equal while
  dragging); frozen pointerdown transform committed once at release via exactly one
  validation + one `setDancerStart` + one `saveHistory` + one persist attempt; identity
  (project/dancer object/original start) re-resolved before commit; press-screen ≤2px
  strict no-op; cancel on Escape/close/blur/resize/pointercancel/capture-loss/
  outside-release/playback-start/project-replace/dancer-remove/reorder/concurrent-edit/
  wrong-pointer-id with zero drag-owned writes and clean re-dispatch; playback is
  read-only (disabled + aria-disabled, no-op clicks) in both targets; topmost-only
  Escape with invoker focus restore.
- `web/choreo-app.js`: one 2D-stage toolbar entry (no `.dh-sm` reuse);
  `web/choreo-helper-app.css`: stage styling with visible focus and short-viewport
  compaction (700×600 fits, surface 220px).
- `scripts/offline-verify.js`: new `stage-drag` scenario, 73 asserts (coordinate
  contract, single commit, 13-way cancellation matrix, lifecycle, keyboard/narrow
  viewport, blocked-network) with the red-arm described above.
- Preserved: schema-v2/protocol-v1 bytes and persistence code unchanged (document/
  docwire/projects/show-compiler/preview3d prohibited paths untouched); compiler
  performers projection stays id/name-only; untouched dancers gain no defaults; legacy
  no-start saves stay byte-stable; web mode issues zero fetch/XHR to 48794/48795; all
  pre-existing suites green with additive-only deltas. The four permitted product twin
  pairs are byte-identical by SHA-256 (edit 44f8ac49, stage-ui dca713a8, app 97f83c59,
  css cceacac5).

## Verification actually observed

Gate R2 passed (all 24 required checks exit 0): test-edit 338/0 (+13), test-shell 54/0
(+5), engine 47/0, check 93/0, document 120/0, docwire 56/0, projects 105/0, library
318/0, showcompiler 43/0; offline-verify stage-drag 73/0, start-formation 39/0,
clipcheck-dist 1/0, workspace 70/0, offline 16/0; `pipeline-cli check` PASS;
`process-audit --check` 25/25 (pre-existing soft warning: 9 owner tails > 8);
`check-ai-docs.js` 60/60; `git diff --check` clean. Attribution exact via
`pipeline-cli measure`: 5 lockScope files +984/−2 (11 writeScope files including the 4
dist twins and 2 additive test files), within budgets 22 files / 1200 lines / 90 active
minutes; active 19.5 of 90 minutes; repairAttempts 2/2. One full review cycle plus one
process-only cycle: module REQUEST_CHANGES (MF-1/MF-2) → repair → module APPROVE (R2) +
global APPROVE against the same R2 gate, no open findings. Closeout: run finished
completed, ticket accepted → closed, PROCESS-STATE order 45 registered, machine views
regenerated by `process-audit --fix`, `--check` re-passed, `check-ai-docs.js` re-passed,
`pipeline-cli check` PASS.

## Remaining owner tails and why

- None new. The feature is live in the working tree (repo file:// dist twins paired);
  live deploy roots are explicitly excluded by the ticket and stay pre-deploy — this
  pair rides the next owner-authorized live deploy together with the other pending
  working-tree work (TAIL:DUAL-MODE-ACCEPT, TAIL:CHARASSETS-P2-LIVE, TAIL:ARCH2-LIVE).
- REQ-SPEC-012 stays open by design: formation presets, multi-select movement, grid
  snapping, drag-to-rotate, movement paths/speed/arrival, animated facing and any
  game-side start execution are later M2/M3 increments needing new planner intake; game
  playback intentionally ignores start placement until protocol work is authorized.
- Design notes, not defects: marker text ellipsis is deliberate (full name in the title
  attribute); 700×600 fitting relies on the short-viewport media compaction — OS-level
  zoom/text-scaling beyond it remains owner visual acceptance; matrix setups that mutate
  store state must keep the restore render+reopen pair (recorded in the CHG knownRisks);
  synthetic PointerEvent fixtures prove the DOM transaction contract, not real-model or
  game acceptance.
- Pre-existing soft warning unchanged: 9 open owner tails vs the soft budget of 8; the
  recorded SIX-TRACK prerequisite-inversion exception stands.

## Files changed

- Run-owned product/harness (attribution exact, +984/−2 over lockScope):
  `web/choreo-edit.js`, `web/choreo-stage-ui.js`, `web/choreo-app.js`,
  `web/choreo-helper-app.css` plus their paired `web/dist/ChoreoHelper/` twins
  (byte-identical), `scripts/offline-verify.js`; additive tests `web/test-edit.js`,
  `web/test-shell.js`.
- Process artifacts: `.agent/tickets/TASK-20260906-M2-STAGE-DRAG.json` (accepted →
  closed), `.agent/runs/history/RUN-20260906-M2-STAGE-DRAG.json` (completed archive with
  gate/review/change evidence; active manifest and claim baseline removed),
  `.agent/evidence/TASK-20260906-M2-STAGE-DRAG/` (architecture impact, both gates, all
  three reviews, worker repair note, logs),
  `.agent/modules/web-product/changes/CHG-TASK-20260906-M2-STAGE-DRAG.json`,
  `.agent/PROCESS-STATE.json` (order 45), `.agent/CONTINUITY.md`,
  `docs/AI-BACKLOG.md` (generated package row), this handoff.
