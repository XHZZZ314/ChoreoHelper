# Handoff: M2 stage scale reference span (TASK-20260909-M2-STAGE-SCALE)

## Objective and acceptance

M2 view-only increment on the closed numeric-start, x/z-drag and yaw-drag
foundation: the Chinese 2D stage never zooms past one declared minimum visible
world span (reference span, rev2 contract `declaredSpan = 10 m`), a
full-drawable-width drag therefore covers at least 10 m, the scale label
truthfully states the visible span, and every data-writing behavior, schema,
protocol and persistence byte stays unchanged (ticket revision 2, R2, standard
lane, review lane module; web-only while game-side tails wait for the owner —
zero game-control requests; no live-root/staging/release/commit/push).
All five acceptance criteria verified by GATE-RUN-20260909-M2-STAGE-SCALE
(passed; 26/26 checks green including 25 required plus the stat record) plus
module review APPROVE; closed by RUN-20260909-M2-STAGE-SCALE completed.

## Mechanism / red baseline

- Clustered formations inflated the pure content-fit `computeStageTransform`
  without bound (e.g. a 0.2 m cluster on the 440x300 surface reached ~1960 px/m),
  so the whole surface covered a sub-meter window — the direct cause of both the
  too-small drag range and the 2D/3D perception mismatch.
- The new offline-verify `stage-scale` scenario asserts the cap/label presence
  first (`STAGE_REFERENCE_SPAN===10` plus transform entry points) and exits
  non-zero on pre-change code, so it can never silently skip.
- Red-green inside this package: test-edit carries a 390/6 pre-fix red baseline
  (scale=1960 vs cap=39.2, 0.2 m visible span) and stage-yaw carried a 71/72
  pre-repair baseline (exact-center release phantom-committed yawDeg=-90 plus
  one saveHistory via 1/64 px layout-snap residue dx=-0.009375 px passing the
  old 1e-12 guard); both repaired in the same files with red-arm constants kept.

## What changed and behavior preserved

- `web/choreo-edit.js` (pure layer): one named constant
  `STAGE_REFERENCE_SPAN=10` (web/choreo-edit.js:669, name plus value recorded
  in the module change record as the AC requires); the cap
  `cap=(viewW-2*pad)/10` applies uniformly strictly after the existing
  `STAGE_FALLBACK_SPAN=4` degenerate fallback, so single/coincident point sets
  resolve through the finite fallback and are then capped (440x300 single
  point: fallback scale 63 -> cap 39.2). When the fitted scale already satisfies
  the cap — including all content wider than 10 m such as the 12.65 m 12-dancer
  line — the assignment branch does not fire, so scale/originX/originY stay
  IEEE-754 identical to the pre-change content-fit (independent inline oracle
  in test-edit). Single scale for both axes, +X screen-right, +Z screen-up,
  origin mark at world (0,0), stored coordinates never clamped or rewritten.
- `web/choreo-stage-ui.js` (DOM layer): the scale label emits exactly the rev2
  template `比例 {px/m} 像素/米 · 横向可见约 {span} 米 · +X 向右 · +Z 向上 ·
  原点已标记` with the unchanged `Math.round(scale*10)/10` px/m and
  `span=Math.round(((viewW-2*STAGE_PAD)/scale)*10)/10` from the transform's own
  viewW (span exactly 10 at the cap, >= 10 whenever the cap is active); the null
  state keeps exactly `比例不可用`. No new controls; the existing
  `.stage-toprow` flex-wrap absorbs the longer copy at 700x600.
- Consequential repair in the same files (module RF-1, P3 record-only,
  APPROVE with no correction required): `STAGE_YAW_DEAD_PX=1`
  (web/choreo-edit.js:746,758); `stageYawFromPointer` returns NaN inside a 1 px
  radius of the marker center. Sub-px center releases previously resolved to an
  arbitrary angle from layout residue direction, now no-op through the unchanged
  finite-only commit gate; real yaw drags span tens of px and are unaffected;
  the UI-level <=2px press guard and all AC-3/AC-4 invariants are untouched.
- Preserved: single-transaction drag contract (ghost-only moves, one
  pure-validation plus one saveHistory plus one persist at release, yaw
  preserved by x/z drags and x/z by yaw drags, <=2px no-move guard,
  release-outside cancellation, finite-only commits, centimeter quantization,
  pointerdown-frozen transform strictly equal at commit via
  `stageTransformEqual`); full 11-path cancellation matrix with zero
  drag-owned writes; schema-v2/protocol-v1 bytes and persistence unchanged;
  `placementFor` stays the single placement source; 1-12 dancer headroom; web
  mode issues zero fetch/XHR to 48794/48795.
- `web/test-edit.js` (+16: 10 cap assertions plus 6 dead-zone assertions, all
  pre-existing assertions preserved) and `scripts/offline-verify.js` (new
  55-assert `stage-scale` scenario). CSS untouched.

## Verification actually observed

Gate passed (all checks exit 0): test-edit 402/0, test-shell 54/0, engine 47/0,
check 93/0, document 120/0, docwire 56/0, projects 105/0, library 318/0,
showcompiler 43/0; offline-verify stage-scale 55/0 (new), stage-drag 73/0,
stage-yaw 72/72 post-fix (71/72 pre-dead-zone), start-formation 39/0,
clipcheck-dist bundled, workspace 70/0, offline 16/0; `pipeline-cli check` PASS
(1 active run, 0 open interruptions; the PREREQUISITE_INVERSION_RECORDED
warning is the recorded historical non-fatal one); `process-audit --check`
25/25; `check-ai-docs.js` 60/60; `git diff --check` clean. Attribution exact
via `pipeline-cli measure`: 3 lockScope files +232/-7 (edit +7/-3, stage-ui
+8/-3, offline-verify +217/-1) plus additive `web/test-edit.js` +75/-0 and two
byte-identical dist twins — within budgets 14 files / 600 lines / 60 active
minutes (active ~17.5 min; repairAttempts 0/2). Reviewer independently re-ran
test-edit, stage-scale, stage-drag, stage-yaw and pipeline-cli check green;
recomputed twin SHA-256 source==dist (choreo-edit cfdd5808..., stage-ui
4e11067d..., css 68af7250... unchanged vs claim); reconstructed the
claim-baseline blob diff; validated every module-record count against the gate
logs with no stale-count defect. Closeout: run finished completed with the
shared evidence validator passing (ticket schemaVersion 1: no qualityContract,
so legacy v1 shape applies — complete AC coverage, red/green regression
evidence, empty counterexamples valid with no lane challenges, module-record
tests references verified by the reviewer).

## Remaining owner tails and why

- None new. The increment is live in the working tree (repo file:// dist twins
  paired); both live roots lag this increment plus the yaw increment — they
  hold the 2026-09-09 LIVE-DEPLOY snapshot. Both ride the next
  owner-authorized live deploy; no staging/rebuild was performed here.
- REQ-SPEC-012 stays open by design: the reference span bounds only the start
  view; formation presets, multi-select movement, grid snapping, movement
  paths/speed/arrival, animated facing and any game-side start execution are
  later M2/M3 increments needing new planner intake; game playback
  intentionally ignores start placement until protocol work is authorized.
- Recorded owner decisions, not defects: the 2D/3D axis-mirror (+Z screen-up
  vs 3D top-view +Z screen-down) and any interactive zoom control (buttons,
  wheel, pan) stay explicit follow-ups; nothing in this diff prejudges them.
- Pre-existing soft state unchanged: 5 open owner tails vs the soft budget of
  8; the recorded SIX-TRACK prerequisite-inversion exception stands.

## Files changed

- Run-owned product/harness (claim-baseline relative): `web/choreo-edit.js`,
  `web/choreo-stage-ui.js`, `scripts/offline-verify.js` (lockScope +232/-7),
  additive `web/test-edit.js` (+75/-0), paired `web/dist/ChoreoHelper/`
  twins of the two product sources (byte-identical by SHA-256); CSS twin
  unchanged and identical.
- Process artifacts: `.agent/tickets/TASK-20260909-M2-STAGE-SCALE.json`
  (accepted → closed), `.agent/runs/history/RUN-20260909-M2-STAGE-SCALE.json`
  (completed archive with gate/review/change evidence; active manifest and
  claim baseline removed),
  `.agent/evidence/TASK-20260909-M2-STAGE-SCALE/` (architecture impact, gate,
  module review, logs),
  `.agent/modules/web-product/changes/CHG-TASK-20260909-M2-STAGE-SCALE.json`
  (final; name plus value of STAGE_REFERENCE_SPAN recorded),
  `.agent/PROCESS-STATE.json` (order 49), `.agent/CONTINUITY.md`,
  `docs/AI-BACKLOG.md` (generated package row), this handoff.
