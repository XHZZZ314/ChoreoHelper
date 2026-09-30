# Handoff: M2 stage yaw third increment (TASK-20260909-M2-STAGE-YAW)

## Objective and acceptance

Third M2 feature increment completing graphical editing of the start {x, z, yawDeg}
triple: the choreographer rotates one dancer's static start yaw by dragging a
per-marker rotation affordance on the Chinese 2D stage with one release-time
commit; x/z stays untouched by the gesture; the web 3D preview reflects the
committed facing; undo/redo/reload preserve it; the persistent Chinese notice
keeps stating protocol-v1 game playback omits starts (ticket revision 2, R3,
standard lane, review lanes module + global; web-only package while the game is
under maintenance — zero game-control requests; meters, +X screen-right, +Z
screen-up, zero yaw faces +Z, positive yaw turns +Z toward +X; placementFor
stays the single placement source; stored finite yaw kept as-is, never clamped
or envelope-normalized; schema-v2/protocol-v1 and persistence unchanged; 1–12
headroom; no live-root/staging/release/commit/push). All six acceptance criteria
verified by GATE-RUN-20260909-M2-STAGE-YAW (passed; all 23 required checks plus
the optional stat record green) plus module review APPROVE and global review
APPROVE; closed by RUN-20260909-M2-STAGE-YAW completed.

## Mechanism / red baseline

- Yaw was numeric-input only before this run (marker title 朝向用数字框编辑);
  the new offline-verify `stage-yaw` scenario asserts yaw-handler presence first
  and exits non-zero on pre-change code, so it can never silently skip
  (Planner/QA rev2 facts; red arm verified by review log inspection).
- Pure decision logic lives in `ChoreoEdit.pure` as an independent oracle
  mirroring `stageCommitDecision`: `stageYawFromPointer` (screen angle
  atan2(sx-cx, cy-sy) degrees, identical to the facing-arrow rotate(yaw),
  NaN on non-finite inputs and zero-vector/center release), `quantStageYaw`
  (one fixed drag quantum STAGE_YAW_QUANT = 1 degree, integer degrees with -0
  normalization, no envelope folding — 450 stays 450), `stageYawCommitDecision`
  (finite/unchanged/no-op rules). Numeric editing stays unquantized.
- Zero repair cycles: the gate passed on the first run and both reviews
  returned APPROVE. One medium record-only finding (module RF-1 = global GF-1):
  three module-record evidence strings drifted from the gate logs
  (engine 37→47, start-formation 59→39, workspace 30→70); Context Sync applied
  the correction while finalizing the change record — no implementation, test
  or gate bytes changed, no Worker repair cycle consumed.

## What changed and behavior preserved

- `web/choreo-edit.js` (pure layer): the three pure yaw helpers above with
  exports; `placementFor`/`setDancerStart` untouched; explicit x/z strictly
  preserved with fallback {x,z} adopted only when a missing start becomes
  explicit at commit.
- `web/choreo-stage-ui.js` (DOM layer): satellite `.stage-yaw` button per
  marker with a Chinese accessible name, tabIndex=-1 (Tab order unbroken;
  numeric fields remain the keyboard alternative), rest orientation from the
  same yaw variable as the facing arrow (1-deg consistency by construction),
  disabled + aria-disabled exactly when the existing stage controls are
  (playback or invalid geometry). Marker-body pointerdown outside the
  affordance keeps the existing x/z drag (kind=xz); affordance pointerdown
  starts kind=yaw on the single `_pending` skeleton (order-45 pattern): frozen
  pointerdown transform/center, ghost-arrow-only moves (canonical dancers JSON
  deep-equal while dragging), ≤2px strict no-op, one release-time transaction
  of exactly one setDancerStart + one saveHistory + one persist attempt,
  identity (project/dancer object/original start) re-resolved before commit,
  wrong-pointer-id rejection, full cancellation matrix
  (Escape/close/blur/resize/pointercancel/capture-loss/outside-release/
  playback-start/project-replace/dancer-remove-reorder/concurrent-edit) with
  zero drag-owned writes and clean re-dispatch. Marker title guidance updated
  in Chinese to cover drag-to-rotate yaw without game-side claims.
- `web/choreo-helper-app.css`: handle/ghost-arrow styling with visible focus
  and narrow-viewport fit (700×600 fits via the existing short-viewport media
  compaction).
- `scripts/offline-verify.js`: new `stage-yaw` scenario, 72 asserts
  (1/8/12-dancer + mixed-start + empty + resize fixtures, pointer/commit
  counts, undo/redo, 11-way cancel matrix, playback read-only, 3D/lifecycle
  including failed persist + retry + last-write-wins + following x/z keeps
  yaw, keyboard/focus/narrow viewport, zero game-control requests) with the
  red-arm described above.
- Preserved: schema-v2/protocol-v1 bytes and persistence code unchanged
  (document/docwire/projects/show-compiler/preview3d/choreo-app prohibited
  paths untouched); compiler performers projection stays id/name-only;
  untouched dancers gain no defaults; legacy no-start saves byte-stable; web
  mode issues zero fetch/XHR to 48794/48795; all pre-existing suites green
  with additive-only deltas. The three permitted product twin pairs are
  byte-identical by SHA-256 (choreo-edit f1f39b8c, stage-ui 9095a238, css
  68af7250).

## Verification actually observed

Gate passed (all checks exit 0): test-edit 386/0 (+17 yaw pure fixtures),
test-shell 54/0, engine 47/0, check 93/0, document 120/0, docwire 56/0,
projects 105/0, library 318/0, showcompiler 43/0; offline-verify stage-yaw
72/0 (new), stage-drag 73/0, start-formation 39/0, clipcheck-dist 1/0,
workspace 70/0, offline 16/0; `pipeline-cli check` PASS (ticketCount 49,
moduleCount 5, openInterruptCount 0; the PREREQUISITE_INVERSION_RECORDED
warning is the recorded historical non-fatal one); `process-audit --check`
25/25 (openOwnerTails 5 of 8); `check-ai-docs.js` 60/60; `git diff --check`
clean. Attribution exact via `pipeline-cli measure`: 4 lockScope files
+597/−7 (edit +42/−0, stage-ui +212/−6, css +6/−0, offline-verify +337/−1),
plus additive `web/test-edit.js` +38/−0 and three byte-identical dist twins —
within budgets 16 files / 800 lines / 75 active minutes (active ~16 of 75;
repairAttempts 0/2). Reviews: module APPROVE + global APPROVE against the
same gate (raw-byte SHA-256 re-hashed identical at both reviews; HEAD and
diff totals drift-free); both reviews independently re-ran stage-yaw,
test-shell, measure and pipeline-cli check green. Closeout: run finished
completed with the shared evidence validator passing, ticket accepted →
closed, PROCESS-STATE order 48 registered, machine views regenerated by
`process-audit --fix`, `--check` re-passed, `check-ai-docs.js` re-passed,
`pipeline-cli check` PASS.

## Remaining owner tails and why

- None new. The feature is live in the working tree (repo file:// dist twins
  paired); the two live roots (devPlugins + game dist) lag this increment by
  exactly the three product files — they hold the 2026-09-09 LIVE-DEPLOY
  snapshot including the order-44/45 stage UI. The increment rides the next
  owner-authorized live deploy; a mixed-version root degrades gracefully (new
  stage-ui guards helper presence, old stage-ui shows no handle).
- REQ-SPEC-012 stays open by design: formation presets, multi-select
  movement, grid snapping, movement paths/speed/arrival, animated facing and
  any game-side start execution are later M2/M3 increments needing new
  planner intake; game playback intentionally ignores start placement until
  protocol work is authorized.
- Design notes, not defects (review observations): missing-start undo
  (original-absence restoration) is covered by the shared history-snapshot
  mechanism rather than a direct assert — same accepted residual gap as order
  45; the last-write-wins assert uses a lenient ternary on the strict
  exercised geometry; dead gesture fields `_pending.invalid/lastYaw/lastRawYaw`
  mirror the accepted order-45 pattern; one awkward Chinese comment fragment
  in choreo-edit.js before the STAGE_YAW_QUANT declaration is cosmetic. 700×600
  fits via media compaction — OS-level zoom/text-scaling beyond it remains
  owner visual acceptance; synthetic PointerEvent fixtures prove the DOM
  transaction contract, not real-pointer or real-model acceptance.
- Pre-existing soft state unchanged: 5 open owner tails vs the soft budget of
  8; the recorded SIX-TRACK prerequisite-inversion exception stands.

## Files changed

- Run-owned product/harness (attribution exact, +597/−2 over lockScope):
  `web/choreo-edit.js`, `web/choreo-stage-ui.js`, `web/choreo-helper-app.css`
  plus their paired `web/dist/ChoreoHelper/` twins (byte-identical),
  `scripts/offline-verify.js`; additive test `web/test-edit.js`.
- Process artifacts: `.agent/tickets/TASK-20260909-M2-STAGE-YAW.json`
  (accepted → closed), `.agent/runs/history/RUN-20260909-M2-STAGE-YAW.json`
  (completed archive with gate/review/change evidence; active manifest and
  claim baseline removed),
  `.agent/evidence/TASK-20260909-M2-STAGE-YAW/` (architecture impact, gate,
  both reviews, logs),
  `.agent/modules/web-product/changes/CHG-TASK-20260909-M2-STAGE-YAW.json`
  (with the RF-1/GF-1 count correction),
  `.agent/PROCESS-STATE.json` (order 48), `.agent/CONTINUITY.md`,
  `docs/AI-BACKLOG.md` (generated package row), this handoff.
