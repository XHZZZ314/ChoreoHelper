# Handoff: pipeline-cli preflight ignoreRunId fix (TASK-20260903-PREFLIGHT-IGNORERUNID)

## Objective and acceptance

Fix the pipeline-cli preflight self-match defect recorded as the out-of-scope finding in
PLANNER-INT-20260903-AC3-DISPOSITION and authorized by INT-20260903-PREFLIGHT-IGNORERUNID
(resolved as create-queued-ticket-and-resume-current): `preflight` called `activeConflicts()`
without its supported `ignoreRunId` argument, so any post-claim preflight deterministically
conflicted with the claimed run and exited 1 — a gate embedding a post-claim preflight could
never pass (the LIBVERIFY gate initial/R2/R3 pattern: same fingerprint three times). Ticket
revision 2, R1, standard lane, class pipeline_change. All four acceptance criteria verified by
gate GATE-RUN-20260903-PREFLIGHT-IGNORERUNID plus module review APPROVE: AC-1 — live
self-referential proof under the claimed run discovers its own run id from `.agent/runs/active`
and post-claim preflight `--run-id RUN-20260903-PREFLIGHT-IGNORERUNID` exits 0 with ok:true and
conflicts:[]; AC-2 — fixture-root regression cases (a) no `--run-id` still conflicts exit 1,
(b) own id excluded exit 0, (c) non-active id keeps the conflict exit 1, (d) two overlaps with
one named conflicts exactly the other, (e) a run literally named RUN-PREFLIGHT still conflicts;
AC-3 — claim against a genuinely overlapping foreign run is refused writing no manifest, and
preflight on malformed active-run state fails closed non-zero with no ok:true; AC-4 — full
routed suite plus containment checks exit 0 with writeScope-only diff and git diff --check clean.

## Mechanism / red baseline

Root cause: `preflight` computed lock-scope conflicts over every active run including the
caller's own claimed run, with no way to name it. Red baseline: any `preflight <ticket> --role
worker` executed while that ticket's run was active reported its own runId in `conflicts` and
exited 1 (observed three times as the same failure fingerprint in the LIBVERIFY gate chain).
The fix passes the explicitly supplied `--run-id` through as `activeConflicts`' fourth
`ignoreRunId` parameter; exclusion is exact-id inside the existing conflict filter, after the
fail-closed malformed-state validation.

## What changed and behavior preserved

- `scripts/pipeline-cli.js` — 4 insertions / 2 deletions: the preflight usage string now names
  `[--run-id RUN-*]`, and the `activeConflicts` call passes `args.runId || ''` with a comment
  that only an explicitly passed id is ignored. No other command changed: claim still calls
  `activeConflicts` with no ignore id, so claim conflict enforcement, gate artifact rules,
  exit-code semantics and output fields are untouched.
- `scripts/test-pipeline-cli.js` — 105 insertions / 0 deletions: one isolated git-initialized
  tmpdir fixture root driving the real CLI entry point, adding the seven regression checks
  (cases a-e, claim-overlap refusal, malformed-state fail-closed). No prior assertion deleted,
  reworded or weakened (93/93 pre-change all still pass inside the post-change 100/100).
- Zero product change: no `src/**`, `web/**`, `release/**`, `site/**`, `sample/**` or SPEC.md
  writes; `.agent/PIPELINE-POLICY.json` and `.agent/PIPELINE-ROUTING.json` byte-identical to
  claim time. No commit, push, publication or live-install action.

## Verification actually observed

Gate GATE-RUN-20260903-PREFLIGHT-IGNORERUNID (passed, 5 scope checks + 8 checks, exit 0):
`node scripts/test-pipeline-cli.js` 100/100 including cases a-e; `node
scripts/test-pipeline-policy.js` 85/85; `node scripts/test-process-policy.js` 65/65; `node
scripts/test-process-audit.js` 20/20; `node scripts/pipeline-cli.js check` PASS (only the
pre-existing recorded PREREQUISITE_INVERSION warning on TASK-20260901-SIX-TRACK-ROUNDTRIP);
`node scripts/process-audit.js --check` 25/25; `node scripts/check-ai-docs.js` 60/60; the
verbatim ticket testPlan self-referential assertion exited 0 printing "post-claim preflight with
own run id ok, conflicts=[]". Scope evidence: mtime attribution lists exactly 13 post-claim
files all inside writeScope; protected hashes (policy, modules registry, ticket revision 2,
roles/worker.md, AI-TEST-MATRIX.md) match claim time; budgets 2/4 files, 111/200 lines; git
diff --check clean. Module review REVIEW-RUN-20260903-PREFLIGHT-IGNORERUNID-module: APPROVE, no
findings, gate-log hashes independently re-hashed equal and key suites re-run green. Run
budget: 0 repair attempts. Closeout checks (context-sync): `process-audit.js --fix`,
re-run `--check` and `check-ai-docs.js` recorded in the closeout section of the evidence
directory.

## Remaining owner tails and why

- None. This is pipeline tooling only; no product, deploy, release or live-install action is
  pending, and no new owner tail was created. Existing owner tails are unchanged.

## Files changed

- `scripts/pipeline-cli.js` — preflight usage string + ignoreRunId wiring (4+/2-).
- `scripts/test-pipeline-cli.js` — preflight regression fixture and seven checks (105+/0-).
- `.agent/tickets/TASK-20260903-PREFLIGHT-IGNORERUNID.json` — status closed at closeout.
- `.agent/runs/history/RUN-20260903-PREFLIGHT-IGNORERUNID.json` — completed run archive (gate +
  module review + module change record as evidence).
- `.agent/evidence/TASK-20260903-PREFLIGHT-IGNORERUNID/` — gate result, gate logs, module
  review, worker self-preflight evidence.
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260903-PREFLIGHT-IGNORERUNID.json` — module
  change record.
- `.agent/modules/ai-pipeline/STATE.md` — module state refreshed with the closed change.
- `.agent/PROCESS-STATE.json` — `latestProcessHandoff` now points to this handoff.
- `.agent/process-events.jsonl` — context-budget breach event + resolution (see closeout notes).
- `docs/HANDOFF-20260903-pipeline-preflight-fix.md` — this handoff.
- `docs/AI-BACKLOG.md` — one line under "Other closed history".
- `.agent/CONTINUITY.md` — next-action paragraph refreshed.
