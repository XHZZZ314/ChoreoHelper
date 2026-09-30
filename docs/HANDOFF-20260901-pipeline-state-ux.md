# HANDOFF 2026-09-01 — PIPELINE-STATE-UX owner status, doctor and micro lane

## Objective and acceptance

`TASK-20260901-PIPELINE-STATE-UX` (rev 1, R2, `pipeline_change`, standard lane) gives the owner
read-only visibility and safe bounded lanes: Chinese `status`/`queue`/`advance`/`doctor`
commands, deterministic next-package recommendation, targeted interruption placement checks and
a two-conversation `micro` lane, while the active E1 product run, product files and independent
approval stay untouched (AC-1–AC-6 of the ticket).

## Mechanism / red baseline

The pre-package pipeline (routing `effort-lanes-1.2`) had no owner-facing state command: progress
was inferred from handoff prose, package choice was manual, stale or contradictory process state
could only surface as a generic audit failure, and any small isolated improvement still paid the
three-conversation fast-lane cost. Inserted requirements also had no guaranteed visible
destination when their target ticket did not exist yet.

## What changed and behavior preserved

- `status`, `queue`, `advance` and `doctor` are read-only by default. `doctor` mutates only behind
  explicit `--record` (idempotent process events) or `--fix` (delegates to the pre-existing
  hard-allowlisted process-audit repair) and reports stable codes with bounded Chinese repairs.
- `queue`/`advance` overlay active runs on PROCESS-STATE and ticket prerequisites and recommend
  deterministically: continue active, else first ready package, else one explicit owner decision;
  `next` on a closed ticket carries `portfolioNext`.
- Routing `effort-lanes-1.2 → 1.3` adds the `micro` lane (R0-R1, one module, module-only review,
  ≤5 files/200 lines/20 minutes/1 repair, no pipeline/hotfix/release class) with a
  two-conversation contract: the Worker may implement and record gate evidence, only an
  independent Reviewer+Closeout approves. Ticket validation generalizes the fast-lane checks to
  `fast|micro` and fails closed to a wider lane.
- Standard and fast routes, existing tickets and both active run manifests load unchanged;
  `.agent/PIPELINE-POLICY.json` and `.agent/roles/worker.md` stayed byte-identical, so the E1
  immutable context remains valid; no product source, deploy root, release artifact or live
  install changed.

## Verification actually observed

Gate `GATE-20260901-PIPELINE-STATE-UX` passed all 12 checks: scope/budget (10 attributable files,
594 changed lines vs budgets 20/1800), prohibited-path attribution, the full ticket test plan
(policy 83/83, CLI 68/68, `pipeline-cli check` PASS with 2 active runs and 0 open interrupts,
`status`/`queue`/`doctor` exit 0), `process-audit --check` 22/22, `check-ai-docs` 58/58, the E1
next-routing snapshot (still `worker`, worker-active) and a worktree-hash read-only proof.
Independent module review `REVIEW-…-MODULE` and global review `REVIEW-…-GLOBAL` both returned
APPROVE on this gate after re-running the suites themselves. Closeout re-ran `process-audit
--fix` (0 repairs needed), `--check` 22/22, `check-ai-docs` 58/58 and `pipeline-cli check` PASS;
`finish` then moved the run to history and released the active lock.

## Remaining owner tails and why

No live or owner-bound acceptance tail exists for this package. Queued follow-ups recorded by
review (all low, none blocking): a CLI fixture driving a micro run to `micro-review`; the
rename-token edge in `gitChangedFiles`; a defensive budgets guard in `buildOwnerStatus`; a
pipeline-evolution ticket to represent parallel active packages in PROCESS-STATE schemaVersion 1
(removes the persistent ACTIVE_PACKAGE_MISMATCH/PACKAGE_STATUS_MISMATCH warnings); pin
`.agent/process-events.jsonl` in the writeScope of whichever ticket puts `doctor --record` into
routine/scheduled use. This ticket itself is not registered as a PROCESS-STATE package row
because that file is outside its writeScope; register it in the next governance/evolution ticket
that owns PROCESS-STATE.

## Files changed

`.agent/PIPELINE-ROUTING.json`, `scripts/pipeline-policy.js`, `scripts/pipeline-cli.js`,
`scripts/test-pipeline-policy.js`, `scripts/test-pipeline-cli.js`, `docs/AI-PIPELINE-SOP.md`,
`docs/AI-WORKFLOW.md`, plus ticket/interruption/run/evidence/change-record artifacts and this
handoff. See `CHG-TASK-20260901-PIPELINE-STATE-UX.json` and the gate for the exact scoped list.
