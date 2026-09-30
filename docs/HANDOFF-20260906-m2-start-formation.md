# Handoff: M2 start formation first increment (TASK-20260906-M2-START-FORMATION)

## Objective and acceptance

First M2 feature increment: the choreographer edits each dancer's canonical start
`{x, z, yawDeg}` through an explicit Apply; the web 3D preview (stand-in plus synthetic
fixtures) places the dancer there; undo/redo/reopen preserve it; a persistent Chinese
notice states protocol-v1 game playback omits it (ticket revision 2, R3, standard lane,
review lanes module + global; 1–8 dancers with 1–12 headroom; web-only — zero game-control
requests, no schema/protocol change, no live-root/staging/release/commit/push).
All seven acceptance criteria verified by GATE-RUN-20260906-M2-START-FORMATION-R2
(passed; every required check green) plus module review APPROVE (R2) and global review
APPROVE; closed by RUN-20260906-M2-START-FORMATION completed.

## Mechanism / red baseline

- Pre-change behavior (QA rev2 facts, reproduced by the new red-armed tests): document
  normalize coerced `start` with `Number() || 0` and validation treated an explicit
  `(0, 0)` origin as missing; the preview always used the indexed SPACING layout; there
  was no editing entry. The contract (meters, Y-up front +Z / side +X, zero yaw = +Z,
  positive yaw rotates +Z toward +X, forward = (sin yawDeg, 0, cos yawDeg), stageYawDeg
  never applied, no synthesized originCalibrated, no version change) was documented in
  `docs/DESIGN-m2-start-formation.md` §S1 before implementation, with an independent
  sin/cos oracle in test-edit (cardinal/negative/wrap incl. 450°/720°).
- Review F1 (module review REQUEST_CHANGES → one repair, 1/2 within budget): the first
  start entry reused `.dh-sm`, shifting clip-check's positional S/M selectors on the
  same page. Red armed on a controlled defective variant: clip-check section ⑱ failed
  exactly the four reviewed S/M mis-click assertions (4过/4败); after the byte-identical
  restore the section is 8过/0败 with whole-page CLIP-PASS. Repair: independent
  `.start-entry`/`.start-entry.on` classes mirroring `.dh-sm` styling, plus a new
  `clipcheck-dist` offline-verify scenario so this coupling is guarded against the
  working-tree dist in file mode (the live-root route cannot see it).

## What changed and behavior preserved

- `web/choreo-edit.js` (pure): `hasExplicitStart` / start validate / set / clear /
  `startForward` / `placementFor` / placement signature, `START_SPACING = 1.15`;
  explicit finite triple is the only write shape; blank/NaN/±Infinity rejected with
  zero write and zero history; identical-value Apply, Cancel/Escape and close are no-ops;
  Clear restores absence; last rapid Apply wins; missing-id dialog writes nothing.
- `web/choreo-document.js`: normalize keeps strict finite triples, treats malformed /
  non-object / extra-subfield start as missing with the existing hint (explicit origin
  is legal), and only truly missing start gets H_MISSING_START; no eager defaults; the
  legacy no-start save shape stays byte-stable; schema-v2 unchanged.
- `web/choreo-stage-ui.js` (new, DOM-only adapter): the Chinese start-position dialog —
  Apply / Cancel / Clear, Enter applies, Escape cancels, Tab reaches every input,
  controls disabled + `aria-disabled` during playback in both playback targets with
  no-op clicks, and the persistent web-only notice (start placement/facing is saved and
  used by the web preview but not carried into current game execution).
- `web/choreo-app.js`: per-dancer 起始站位 entry button (class `start-entry`, no `.dh-sm`
  reuse) plus the small edit/undo/redo/restore hooks.
- `web/preview3d.js`: explicit-start-first placement at (x, baseY, z) with yaw rotation
  and rings following x/z; missing start keeps the exact indexed layout
  x = (i − (n−1)/2)·1.15, z = 0, yaw 0; stageYawDeg never applied; same-count refresh is
  narrow — no camera pose, selection, currentTime or model reload change; applies while
  hidden/not-ready/initializing on next show with zero exceptions.
- `web/choreo-helper-app.html` / `.css`: shell loads stage-ui in order
  api/document/docwire/compiler/app/stage-ui/bootstrap-last (no module scripts, shell
  under 5KB); independent `.start-entry` styling.
- `scripts/offline-verify.js`: new `start-formation` scenario (39 checks: dialog,
  validation, isolation, transform/undo/reopen, 1/8/12-dancer headroom, lifecycle,
  camera/scrub, hidden/initializing, notice, zero game-control requests across 139
  requests) and the `clipcheck-dist` guard; `scripts/make-release-staging.js`: one
  WEB_FILES whitelist line for `choreo-stage-ui.js`.
- All seven changed product twins are byte-identical web/ ↔ web/dist/ChoreoHelper;
  `web/choreo-show-compiler.js`, `src/ShowProtocol.cs`, `src/ShowValidator.cs` run-owned
  bytes unchanged (performers projection stays id/name-only; the ShowProtocol HEAD-dirty
  hunk is comment-only owner work predating the claim, attributed to
  RUN-20260905-DUAL-MODE-CLOSEOUT).

## Verification actually observed

Gate R2 passed (all required checks): test-edit 325/0 (+21), test-document 120/0 (+10),
test-docwire 56/0 (+2), test-showcompiler 43/0 (+1), test-engine 47/0, test-check 93/0,
test-projects 105/0, test-library 318/0, test-shell 49/0 (+4 incl. two F1 static guards),
offline-verify start-formation 39/0, offline 16/0, workspace 70/0, clipcheck-dist 1/0
with clip-check ⑱ 8过/0败 CLIP-PASS; `pipeline-cli check` PASS;
`process-audit --check` 25/25 (known soft warning: 9 open owner tails > 8);
`check-ai-docs.js` 60/60; `git diff --check` clean. The one non-required check
(`protected-files-head-diff`) failed on the pre-existing ShowProtocol comment-only hunk
and is dispositioned `attributed-to-prior-completed-run-not-this-run` with the required
`scope:protected-files-attribution` check passing. Attribution exact: 10 lockScope
targets +638/−11 within budgets 30/1500; active 73.8 of 90 minutes; repairAttempts 1/2.
One full review cycle: module REQUEST_CHANGES (F1) → repair → re-gate R2 → module
APPROVE + global APPROVE, no open findings. Closeout: run finished completed, ticket
status accepted → closed, PROCESS-STATE order 44 registered, machine views regenerated
by `process-audit --fix`, `--check` re-passed 25/25 (soft 9-tails warning pre-existing),
`check-ai-docs.js` 60/60, `pipeline-cli check` PASS. Continuity prose was compacted in
the same closeout to hold the owner-fixed 20000-byte default-context ceiling — no fact
removed; detail stays in the linked handoffs.

## Remaining owner tails and why

- None new. The feature is live in the working tree (repo file:// dist twins paired);
  live deploy roots are explicitly excluded by the ticket and stay pre-deploy — this
  web-only pair rides the next owner-authorized live deploy like the other pending
  working-tree work (TAIL:DUAL-MODE-ACCEPT, TAIL:CHARASSETS-P2-LIVE, TAIL:ARCH2-LIVE).
- REQ-SPEC-012 stays open by design: 2D drag stage, formation presets, movement
  paths/speed/arrival, animated facing events, root-motion/music and any game-side start
  execution are later M2/M3 increments that need new planner intake; game playback
  intentionally ignores start placement until protocol work is authorized.
- Pre-existing soft warning unchanged: 9 open owner tails vs the soft budget of 8; the
  recorded SIX-TRACK prerequisite-inversion exception stands.

## Files changed

- Run-owned product/harness/doc (attribution exact, +638/−11): `web/choreo-edit.js`,
  `web/choreo-stage-ui.js` (new), `web/choreo-app.js`, `web/preview3d.js`,
  `web/choreo-document.js`, `web/choreo-helper-app.html`, `web/choreo-helper-app.css`
  plus their paired `web/dist/ChoreoHelper/` twins (byte-identical), `web/test-edit.js`,
  `web/test-document.js`, `web/test-docwire.js`, `web/test-showcompiler.js`,
  `web/test-shell.js`, `scripts/offline-verify.js`, `scripts/make-release-staging.js`,
  `docs/DESIGN-m2-start-formation.md` (new).
- Process artifacts: `.agent/tickets/TASK-20260906-M2-START-FORMATION.json` (accepted →
  closed), `.agent/runs/history/RUN-20260906-M2-START-FORMATION.json` (completed archive
  with gate/review/change evidence; active manifest removed),
  `.agent/evidence/TASK-20260906-M2-START-FORMATION/` (gate R2, both reviews, both CHG
  inputs, worker logs incl. red-arm/repair),
  `.agent/modules/web-product/changes/CHG-TASK-20260906-M2-START-FORMATION.json`,
  `.agent/modules/release-product/changes/CHG-TASK-20260906-M2-START-FORMATION.json`,
  `.agent/PROCESS-STATE.json` (order 44), `.agent/CONTINUITY.md`,
  `docs/AI-BACKLOG.md` (generated package row), this handoff.
