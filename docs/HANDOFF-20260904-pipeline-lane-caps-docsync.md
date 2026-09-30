# Handoff: SOP §10 lane-cap prose sync (TASK-20260904-SOP-LANE-CAPS-DOCSYNC)

## Objective and acceptance

Sync the two stale `docs/AI-PIPELINE-SOP.md` §10 lane-cap eligibility sentences to the
machine-checked `laneRules` raised by order 38, with zero policy or product change (ticket revision
1, R1, standard lane, `pipeline_change` docsync). All four acceptance criteria verified: the §10
micro eligibility sentence now reads "budgets at or below six changed files, 300 changed lines,
30 run minutes and one repair" exactly once with the stale 5/200/20 numbers gone (AC-1); the fast
sentence now reads "budgets within the fast caps (≤10 changed files, ≤600 changed lines, ≤60 run
minutes, 1 repair attempt)" exactly once with the stale ≤8/≤400/≤45 numbers gone (AC-2); the
sha256 of `.agent/PIPELINE-ROUTING.json` (8675f060…) and `.agent/PIPELINE-POLICY.json` (99f8f727…)
at gate equals the claim-time run-manifest hashes and all seven routed testPlan commands exit 0
(AC-3); every package-attributed file is inside writeScope with prohibited-roots porcelain
identical at claim and gate (29 pre-existing owner-work lines) and exactly one passing gate, one
APPROVE module review and one ai-pipeline CHG record (AC-4).

## Mechanism / red baseline

Order 38 raised the machine caps (micro 5/200/20 → 6/300/30, fast 8/400/45 → 10/600/60) but left
the SOP §10 prose at the old numbers, so human planning guidance contradicted machine enforcement.
Baseline suites were green pre-change (policy 85/85, cli 100/100, process-policy 65/65,
process-audit 20/20, check PASS, docs 60/60). The only mid-run blocker was process context, not
content: the claim-activated snapshot line pushed `implementationContextBytes` to 35518 > 35500
(BLK-IMPL-CONTEXT-BUDGET-18B in WORKER-RESULT.json); the owner authorized the AI-WORKFLOW §2.7
bounded maintenance raise 35500 → 36000 in `.agent/PROCESS-STATE.json` (recorded in
OWNER-MAINT-BUDGET-RAISE.json), after which the leg passed without weakening any check.

## What changed and behavior preserved

- `docs/AI-PIPELINE-SOP.md`: exactly two lines — the §10 micro eligibility sentence (line 197:
  five/200/20 → six/300/30) and the §10 fast eligibility sentence (line 207: ≤8/≤400/≤45 →
  ≤10/≤600/≤60). The file was clean vs HEAD at claim, so the whole diff is package-attributed.
- Zero machine-policy bytes: `laneRules`, `allowedRisks`, `maxImpactedModules`, `allowedReviewLanes`,
  `forbiddenClasses`, budgets and `modelRouting` are frozen (sha256 recompute equals claim-time).
- No product source, behavior, contract, deployment root or release artifact changed; no script
  gained a lane-cap consistency check (evidence stays grep- and gate-based per nonGoals); no
  dependency, hook, commit, push, publication or live-install overwrite.
- Closeout (context-sync): run finished `completed` with the gate, module review and CHG record;
  ticket status accepted → closed; ai-pipeline STATE finalized; PROCESS-STATE order 39 closed with
  this handoff as evidence; backlog index and continuity derived blocks regenerated only by the
  `process-audit.js --fix` reducer.

## Verification actually observed

Gate GATE-RUN-20260904-SOP-LANE-CAPS-DOCSYNC (passed, 13/13 checks, 2026-09-03T17:56:35Z): scope
diff (exactly two SOP lines), policy-hash recompute, prohibited-roots compare, AC-1/AC-2 greps
(positive count 1 each, stale fragments absent exit 1), laneRules truth cross-read, then the
seven-command testPlan — test-pipeline-policy 85/85, test-pipeline-cli 100/100, `pipeline-cli
check` PASS (pre-existing recorded PREREQUISITE_INVERSION warning only), test-process-policy 65/65,
test-process-audit 20/20, `process-audit --check` 25/25 (35518 ≤ 36000), check-ai-docs 60/60.
Module review REVIEW-RUN-20260904-SOP-LANE-CAPS-DOCSYNC-MODULE: APPROVE with no findings; the
reviewer independently re-ran the greps, hash recompute, diff and four suites with identical
results. Finish re-validated the gate, review and module record before archiving the run to
`.agent/runs/history/`. Closeout re-verification (context-sync, 2026-09-04): `pipeline-cli check`
PASS; `process-audit --fix` repairs `backlog-package-index` + `continuity-derived-blocks` (both
reviewed: regenerated views only, no history touched); `process-audit --check` 25/25;
`check-ai-docs.js` 60/60.

## Remaining owner tails and why

- None new. One known risk carried in the CHG record: headroom under the 36000-byte
  `implementationContextBytes` budget is ~482 bytes, so a future long-ID claim plus closeout
  growth can cross it again; budget raises stay owner decisions by design (budgets live outside
  any Worker writeScope).

## Files changed

- `docs/AI-PIPELINE-SOP.md` — the two §10 eligibility lines.
- `.agent/tickets/TASK-20260904-SOP-LANE-CAPS-DOCSYNC.json` — status closed at closeout.
- `.agent/runs/history/RUN-20260904-SOP-LANE-CAPS-DOCSYNC.json` — completed run archive.
- `.agent/evidence/TASK-20260904-SOP-LANE-CAPS-DOCSYNC/` — worker baseline/result, claim-time
  prohibited-roots snapshot, owner-maintenance record, gate and module-review artifacts,
  gate-checks evidence set.
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260904-SOP-LANE-CAPS-DOCSYNC.json` — module record.
- `.agent/modules/ai-pipeline/STATE.md` — module state finalized (docsync section added).
- `.agent/PROCESS-STATE.json` — order 39 closed (closeout-required registry mutation; active
  package removal already done atomically by the finish reducer).
- `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md` — order-39 views regenerated by
  `process-audit.js --fix` from PROCESS-STATE.
- `docs/HANDOFF-20260904-pipeline-lane-caps-docsync.md` — this handoff.
