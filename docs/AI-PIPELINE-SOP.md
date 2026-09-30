# ChoreoHelper AI pipeline SOP

> Routed reference for risk, roles, artifacts, hotfix/refactor branches, circuit breakers and process evolution. Normal implementation still starts from `AI-WORKFLOW.md`; load only the relevant section here.

## 1. Control model

The repository uses six execution stages and one cross-task control-plane role:

1. Planner — architecture, contract and compatibility impact.
2. QA Lead — testable ticket, BDD and requirements review.
3. Worker — bounded implementation and tests in a fresh context.
4. Deterministic Gate — local checks and compact error evidence; no model.
5. Reviewer — independent module review and risk-triggered global review.
6. Context Sync — module change/state, generated global views and documentation impact.
7. Pipeline Governor — aggregate process evaluation; not a mandatory stage on every ticket.

Stable responsibilities and stop conditions live in `.agent/roles/`. A Worker may not approve its own change. Reviewer input is ticket + contracts + normalized diff + gate evidence + module records, not Worker hidden reasoning.

## 2. Machine authority and artifacts

- `.agent/PIPELINE-POLICY.json`: risk, budgets, roles, paths and retry policy.
- `.agent/MODULES.json`: module IDs, owned roots, context and dependency edges.
- `.agent/tickets/TASK-*.json`: immutable accepted behavior/scope contract for one revision.
- `.agent/runs/active/`: ignored local overlap locks with source/policy/ticket revision and context hashes.
- `.agent/evidence/<ticket>/`: durable final gate and review evidence when required.
- `.agent/modules/<module>/changes/CHG-<ticket>.json`: one independent record per impacted module.
- `.agent/PROCESS-STATE.json`: package/tail/global process state, not task attempt history.
- `HANDOFF-*`: concise human evidence after deterministic artifacts exist.

Conversation, generated state and handoff prose never replace current source/tests. Any accepted-ticket change increments its revision and invalidates old context/run evidence.

## 3. Risk routing

| Risk | Typical impact | Minimum route |
|---|---|---|
| R0 | Generated views and non-behavioral routed docs | Artifact + scope checks |
| R1 | Isolated UI/style or local implementation; no data/contract/security impact | Targeted gates + module review |
| R2 | Module behavior, state transitions or internal pipeline policy | Module gates + independent module review |
| R3 | IPC, persistence, migrations, shared lifecycle, cross-module or release preparation | Compatibility/integration gates + module/global review |
| R4 | Security authority, destructive data, production mutation or irreversible release | R3 controls + security/recovery + explicit owner authority |

The highest impact determines risk, not line count. Tags in the active policy may trigger global review beyond the base risk.

## 4. Standard package flow

1. Intake searches current source, tests, module state and recent module change records. Record facts, assumptions, recommendations and decisions separately.
2. Planner assesses module/contract/compatibility impact for R2+ or any contract-tagged request.
3. QA Lead writes an accepted ticket with non-goals, BDD evidence mapping, path scope, budgets, rollout and rollback.
4. Validate and preflight:

   ```powershell
   & 'D:\nodejs\node.exe' scripts\pipeline-cli.js ticket .agent\tickets\TASK-....json
   & 'D:\nodejs\node.exe' scripts\pipeline-cli.js preflight .agent\tickets\TASK-....json --role worker
   ```

5. Claim the Worker run before editing. The global claim lock serializes overlap checks, and active write scopes fail closed:

   ```powershell
   & 'D:\nodejs\node.exe' scripts\pipeline-cli.js claim .agent\tickets\TASK-....json --run-id RUN-... --role worker
   ```

6. Worker establishes the narrow baseline, changes only accepted scope, adds regression coverage and drafts module records.
7. Deterministic Gate runs scope first, then the risk-routed test matrix. Each required command records exit, duration, evidence hash and failure fingerprint.
8. Failures receive only a bounded error slice and relevant context. Apply the circuit rules in §8 before every repair.
9. Reviewer returns structured module verdict; global review checks topology, compatibility, rollout and rollback when required.
10. Context Sync finalizes module records/state, runs `process-audit --fix`, creates docs/KB obligations and records one concise handoff.
11. A completed run requires a passing gate, approval for every ticket review lane and one change record per impacted module. Blocked/cancelled runs may close without approval evidence.

Run claims are local and ignored by Git. A stale `.agent/runs/.claim.lock` must be investigated before removal; never delete it merely to unblock a second process.

## 5. Requirements and review gates

Requirements review rejects:

- subjective outcomes without a measure;
- missing actor, trigger, failure, cancellation, compatibility or recovery behavior when applicable;
- product decisions disguised as implementation assumptions;
- unbounded paths, missing rollback or unresolved material authority;
- acceptance criteria without deterministic evidence mapping.

Code review checks only applicable dimensions: correctness, contract/version skew, state-machine closure, cancellation/idempotency, memory/subscription cleanup, concurrency/stale work, security, performance, accessibility, test quality, scope and documentation impact.

Blocking findings require severity, evidence, violated criterion, impact and bounded correction. Unrelated improvements become follow-up tickets.

## 6. Hotfix branch

Hotfix is faster, not control-free:

1. Name incident severity, affected version, containment goal and last known good.
2. Freeze unrelated changes on the incident surface and create a narrow `hotfix` ticket.
3. Establish reproduction or the cheapest decisive failure mechanism.
4. Keep compatibility/security/data classification; urgency alone cannot waive R3/R4 controls.
5. Use one repair attempt by default. Repeated or changing failures escalate.
6. Require targeted regression, release smoke where applicable, independent review and verified rollback.
7. Any waiver names control, reason, approver, expiry, compensation and follow-up root-cause ticket.

Secret scanning, scope protection and recovery for destructive risk are never waived.

## 7. Major refactor branch

1. Write RFC/ADR, dependency graph, public contract inventory, characterization tests and baseline budgets.
2. Define milestones with independently mergeable/revertible exit criteria.
3. Introduce compatibility seams, adapters or flags before switching behavior.
4. Migrate one consumer/module cohort per ticket and compare old/new behavior using fixtures or differential tests.
5. Run global review at public-contract/topology checkpoints.
6. Preserve rollback until stability criteria pass; remove old path/flags only in a dedicated cleanup ticket.

Do not combine unrelated feature behavior with a refactor package.

## 8. Circuit breaker and escalation

Automatic repair stops when any condition is true:

- more than two standard repair attempts or one hotfix repair attempt;
- the same normalized failure fingerprint appears twice;
- write scope, file/line, context, time or tool budget is exceeded;
- a repair produces a new severe regression, weakens a valid test/gate or edits protected policy;
- source, ticket or policy revision invalidates the context;
- required authority or a material product decision is missing;
- active run state is malformed or overlapping.

The escalation artifact contains ticket/policy/source revisions, attempts, compact fingerprints/slices, hypotheses/evidence, violations, smallest decision required, safe options and last known good. It excludes full logs and secrets.

## 9. Module and global control

Each impacted module owns `CONTEXT.md`, compact `STATE.md` and one `CHG-<ticket>.json`. Module records list observable behavior, non-changes, files, contracts, tests, risk, rollback and documentation impact.

Global review is triggered by R3/R4, pipeline-policy tags, public contracts, persistence/migration, security/release, multiple deployables, topology changes or uncertain impact. It reviews cross-module invariants and rollout order rather than duplicating every line review.

## 10. UI and logic fast lanes

- UI optimization defines default/loading/empty/error/disabled/focus/keyboard/responsive/accessibility states and visual evidence where relevant.
- Logic optimization names invariants, state transitions, time/random/I/O abstractions and measurable performance targets.
- R1/R2 work may combine Planner and QA preparation, but Worker and approving Reviewer remain separate contexts.
- Feature flags and stable extension points permit rapid insertion; missing user documentation still blocks general availability.

## 11. Controlled evolution

`process-event.js` records only corrections, repeated failures, flakes, live mismatches, manual repetition, state drift or budget breaches. Thresholds may create review-only proposals. Promotion requires root-cause evidence, one canonical change, regression coverage, quality/context/security/compatibility assessment and rollback.

The Governor may recommend context selection, model routing, templates, folder layout, gates and retry thresholds. It cannot automatically change product behavior, protected rules, permissions, live installs, release authority or history.

Use offline replay, then shadow/canary comparison. Quality and safety guardrails outrank token savings.

## 12. Automation boundary

Repository scripts are the stable control surface. Hooks and CI should call:

```powershell
& 'D:\nodejs\node.exe' scripts\pipeline-cli.js check
& 'D:\nodejs\node.exe' scripts\process-audit.js --check
& 'D:\nodejs\node.exe' scripts\check-ai-docs.js
```

Hooks provide fast feedback; clean CI is authoritative. This package does not silently enable a local hook, alter Git configuration, commit, push, publish or mutate a live install.
