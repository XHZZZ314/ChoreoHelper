# Handoff: pipeline budget raise (TASK-20260904-PIPELINE-BUDGET)

## Objective and acceptance

Raise the six non-worker role context budgets in `.agent/PIPELINE-POLICY.json` and relax the
micro/fast lane caps in `.agent/PIPELINE-ROUTING.json` so every role can claim tickets of the
current size and small iterations default to micro/fast (ticket revision 1, R2, standard lane).
All six acceptance criteria verified: worker stays exactly 200000 with the six siblings at
planner 220000, qa-lead 220000, deterministic-gate 24000, reviewer 40000, context-sync 28000,
pipeline-governor 80000 (AC-1); micro caps become exactly 6 files/300 lines/30 min/1 repair and
fast exactly 10/600/60/1 with 7-file micro and 11-file fast rejected and 6/10-file fixtures
accepted (AC-2); all seven role preflights pass with zero lockScope conflicts and every
contextBytes inside its new budget (AC-3); malformed-input validation stays fail-closed with no
silent defaults (AC-4); repair/claim/interruption circuit rules hold (repairAttempts 0,
sanctioned cancel-and-reclaim, no silent widening, AC-5); package-attributable diff stays inside
writeScope with zero prohibitedPaths and no commit/push/publish (AC-6).

## Mechanism / red baseline

The M1 review finding F-6 measured sibling preflight needs of 212064/211806/70206 bytes on this
ticket size, so the draft 40000/32000/40000 values would still fail; the raised values were sized
from those measurements. Baseline suites were green pre-change (policy 83/83, cli 93/93,
process-policy 65/65, process-audit 20/20, check 25/25, docs 60/60). A mid-change `pipeline-cli
check` FAIL (immutable policy context changed under an active claim) was resolved by the
sanctioned cancel-and-reclaim flow, not by weakening any check.

## What changed and behavior preserved

- `.agent/PIPELINE-POLICY.json`: only the `roleContextBytes` block (six siblings raised; worker
  frozen at 200000). No other budget, repairPolicy, riskLevels, classConstraints or
  globalReviewTriggers value changed.
- `.agent/PIPELINE-ROUTING.json`: `laneRules` micro caps 5/200/20 → 6/300/30 and fast caps
  8/400/45 → 10/600/60, plus one `worker-micro` prompt prose line synced to the raised numbers.
  allowedRisks, maxImpactedModules, allowedReviewLanes, forbiddenClasses and modelRouting frozen.
- `scripts/test-pipeline-policy.js`: exact sibling-budget assertion plus raised-cap boundary
  rejections added (85/85 post-change, +2); no existing assertion weakened.
- Closeout (context-sync): run finished completed with gate plus both review lanes and module
  change record; ticket status accepted → closed; ai-pipeline STATE finalized; order 38
  registered and the POLICY-BUDGET owner tail resolved in PROCESS-STATE; the reviewer-routed
  follow-up for the stale `AI-PIPELINE-SOP.md` §10 lane-cap prose registered as order 39
  (TASK-20260904-SOP-LANE-CAPS-DOCSYNC, deferred pending owner enable).
- No product source, behavior, contract, deployment root or release artifact changed; no
  dependency installed, hook enabled, commit, push, publish or live-install overwrite.

## Verification actually observed

Gate GATE-RUN-20260904-PIPELINE-BUDGET-CTX2 (passed): test-pipeline-policy 85/85,
test-pipeline-cli 93/93, `pipeline-cli.js check` PASS (pre-existing recorded
PREREQUISITE_INVERSION warning only), test-process-policy 65/65, test-process-audit 20/20,
`process-audit.js --check` 25/25, `check-ai-docs.js` 60/60. Seven-role preflight after the
change: planner 214856, qa-lead 214598, worker 38431, gate 19100, reviewer 35394, sync 24641,
governor 72998 — all inside the new budgets. Module review
(REVIEW-...-CTX2-module) and global review (REVIEW-...-CTX2-global) both APPROVE with no
blocking findings; the reviewers independently re-ran the suites with identical results.
Finish re-validated gate, both lanes and the module record before archiving the run to
`.agent/runs/history/`.

## Remaining owner tails and why

- None new. The POLICY-BUDGET tail is resolved by this package. The only routed follow-up is the
  SOP §10 cap-prose sync (order 39, deferred): the SOP is outside this ticket's writeScope, so
  editing it inside the run would itself have been a scope violation; it needs one owner enable.

## Files changed

- `.agent/PIPELINE-POLICY.json` — sibling roleContextBytes raised, worker frozen.
- `.agent/PIPELINE-ROUTING.json` — micro/fast lane caps raised; worker-micro prompt prose synced.
- `scripts/test-pipeline-policy.js` — exact-budget and boundary regression assertions.
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260904-PIPELINE-BUDGET.json` — module record.
- `.agent/modules/ai-pipeline/STATE.md` — budget delivery state finalized.
- `.agent/tickets/TASK-20260904-PIPELINE-BUDGET.json` — status closed at closeout.
- `.agent/PROCESS-STATE.json` — order 38 closed, order 39 registered, POLICY-BUDGET tail removed.
- `.agent/evidence/TASK-20260904-PIPELINE-BUDGET/` — gate and both review artifacts.
- `.agent/runs/history/RUN-20260904-PIPELINE-BUDGET-CTX2.json` — completed run archive
  (first claim RUN-20260904-PIPELINE-BUDGET cancelled in history after self-invalidation).
