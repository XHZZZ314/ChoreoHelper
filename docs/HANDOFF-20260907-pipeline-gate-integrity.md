# HANDOFF — Gate evidence contract v2: reject contradictory gate evidence and ambiguous approvals

Ticket: [TASK-20260907-GATE-INTEGRITY](../.agent/tickets/TASK-20260907-GATE-INTEGRITY.json) (rev 2, closed) ·
Run: `RUN-20260907-GATE-INTEGRITY` · Role: Context Sync (closeout) · Date: 2026-09-07

## Objective and acceptance

One bounded pipeline quality-repair package (class `pipeline_change`, R2, standard lane) under
INT-20260907-QUALITY-REPAIR-QUEUE authority: a ticket may declare an optional strict
`gateContract` (schemaVersion 2); claiming freezes it into the run; gate and review evidence on
such runs must bind it exactly; contradictory or incomplete evidence and ambiguous approvals are
rejected with zero closeout mutation, while one complete valid fixture closes exactly once.
Legacy v1 artifacts are neither rewritten nor upgraded. No src/web/live/deploy/appearance-run
changes.

## Mechanism / red baseline

Before the change the gate validator accepted demonstrably contradictory evidence:
`validateGateResult` returned 0 issues for a gate marking an unplanned check `passed` with exit 7
and for `passed` with a required check `not-run`; `validateReview` returned 0 issues for APPROVE
carrying a P1 finding; and `reviewReferencesGate` used substring `includes`, so a review citing
`GATE-1` bound gate `GATE-10`. Baseline before changes: policy 152/152, cli 162/162, ticket
validation PASS, `check` PASS with the one pre-recorded prerequisite-inversion warning,
`git diff --check` clean (probes preserved as
[false-pass-probe.js](../.agent/evidence/TASK-20260907-GATE-INTEGRITY/false-pass-probe.js)).

## What changed and behavior preserved

- `scripts/pipeline-policy.js` (+231/-0) — strict optional `gateContract` validation
  (contract level: `schemaVersion`+`checks` only; per check: unique id, one of eight categories,
  exact command, boolean `required`, non-empty unique safe-integer `successExitCodes`; duplicate
  ids/commands, unknown keys/categories, missing fields, unsupported versions and empty/duplicate/
  non-integer exit sets rejected; every `testPlan` command maps exactly once; every risk-required
  category has a required check; absence = unchanged legacy-v1 path); claim-side freeze support
  (`GATE_CONTRACT_VERSION`, canonical hash inputs); `validateGateResultV2`/`validateGateEvidence`
  (one-to-one frozen inventory match on id/category/command/required; strict
  passed/failed/not-run/timed-out + exit-code matrix; non-negative integer `durationMs`; SHA-256
  `evidenceHash`; aggregate `passed` iff every frozen required check passed); `validateReviewV2`/
  `validateReviewEvidence`/`reviewBindsGateV2` (gateId exactly equal, gateHash =
  SHA-256(stableStringify(complete gate artifact)), P0–P3 severities only, only P0/P1 block
  APPROVE); frozen-contract re-verification in `validateRunManifest`.
- `scripts/pipeline-cli.js` (+37/-5) — claim stores the exact contract copy, version 2 and a
  run-bound `gateContractHash`; `workspaceAudit` and `finish` fail closed on contract drift;
  `next` and `finish` consume the same shared semantic validators (identical rejection classes,
  zero mutation on rejected finishes).
- Four templates + `docs/AI-PIPELINE-SOP.md` (+28/+4) — v2 field examples and the SOP §2 "Gate
  evidence contract v2" subsection including the legacy assurance limit and bootstrap boundary.
- Preserved: legacy schema-v1 results byte-for-byte (v2-marked evidence on a legacy run fails
  explicitly as unsupported, never silently downgraded); global policy/routing, budgets, lanes,
  roles and routing prompts untouched; the stableStringify/SHA-256 and shared `measureRun`
  authorities untouched; no product, web, dist, live or appearance-run path touched; history,
  cancelled attempts and baselines untouched.

## Verification actually observed

| Check | Baseline | After |
|---|---|---|
| `node scripts/pipeline-cli.js ticket .agent/tickets/TASK-20260907-GATE-INTEGRITY.json` | PASS | PASS (exact accepted contract) |
| `node scripts/test-pipeline-policy.js` | 152/152 | **216/216** (+64) |
| `node scripts/test-pipeline-cli.js` | 162/162 | **194/194** (+32) |
| `node scripts/pipeline-cli.js check` | PASS (1 recorded warning) | PASS, identical warning, no new |
| `git diff --check` | clean | clean |

New named coverage: GATE-CONTRACT-POLICY declaration matrix, GATE-CONTRACT-RUN frozen
identity/tamper/downgrade, GATE-V2-MATRIX status/exit/inventory matrix, REVIEW-V2-SEVERITY and
REVIEW-V2-GATE-BINDING (incl. GATE-1/GATE-10 collision), GATE-INTEGRITY-LEGACY byte-for-byte v1
compatibility; GATE-CONTRACT-CLAIM concurrency/cancel/reclaim/restart, GATE-V2-NEXT-FINISH
next/finish parity with zero mutation, REVIEW-V2-ROUTING retry/invalidation,
GATE-INTEGRITY-FULL-RUN exactly-once closeout with restart determinism, GATE-INTEGRITY-BOOTSTRAP
legacy-run legality. The Deterministic Gate passed 6/6 required checks (0 repairs); the
independent module reviewer re-ran every declared command plus `check-ai-docs` (60/60) in a fresh
context; the global reviewer verified identity, topology, contracts, migration, security, scope,
rollback and budgets. This closeout itself finished the run exactly once into
`.agent/runs/history/RUN-20260907-GATE-INTEGRITY.json` under the new wiring.

## Remaining owner tails and why

- None added. Deliberate limits (not tails): this run was claimed before v2 enforcement, so its
  own gate/review evidence stays legacy schema-v1; executed-command, output-file and source-byte
  authenticity remain open and are deferred to repair-sequence step 3, the immediate next
  pipeline package.

## Files changed

Attributed run-owned implementation delta (claim-baseline measure + reviewer reconciliation):
**9 files, +877/-5** — the four lockScope scripts measured +845/-5
(`scripts/pipeline-policy.js` +231, `scripts/pipeline-cli.js` +37/-5,
`scripts/test-pipeline-policy.js`, `scripts/test-pipeline-cli.js`) plus the +32 net tail outside
the lockScope measurement: `.agent/templates/run-manifest.example.json` (+14),
`.agent/templates/task-ticket.example.json` (+12), `.agent/templates/gate-result.example.json`
(+1), `.agent/templates/review.example.json` (+1), `docs/AI-PIPELINE-SOP.md` (+4).
Closeout-owned writeScope paths: `.agent/evidence/TASK-20260907-GATE-INTEGRITY/**` (planner/QA
inputs, worker evidence, gate, both reviews),
`.agent/modules/ai-pipeline/changes/CHG-TASK-20260907-GATE-INTEGRITY.json`,
`.agent/modules/ai-pipeline/STATE.md` (Context Sync), this handoff.
