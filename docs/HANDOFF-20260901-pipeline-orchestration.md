# HANDOFF 2026-09-01 — PIPELINE-ORCHESTRATION copy-ready handoffs and midstream routing

## Objective and acceptance

`TASK-20260901-PIPELINE-ORCHESTRATION` (rev 3, R2, class `pipeline_change`) makes every
generated role handoff one copy-ready fresh-session prompt with exactly the six sections
ROLE, TASK, READ, DO, DO NOT, FINISH — embedding the next role's authority, prohibitions and
stop conditions — while keeping deterministic next-role routing, worker checkpoints, Global
Review selection and safe midstream interruption routes. No product behavior changes (AC-7).

## Mechanism / red baseline

At claim time the suites passed (policy 47/47, cli 27/27) but `pipeline-cli.js check` failed
closed: the CHG record was pinned to ticketRevision 2 while the accepted ticket is revision 3
(rev-3 interrupt INT-20260901-COPY-READY-HANDOFF cancelled run R3). `workspaceAudit` correctly
rejects module records stale against the current ticket revision, proving the machine contract
fires before any edit.

## What changed and behavior preserved

- `scripts/pipeline-policy.js`: `HANDOFF_SECTIONS`/`HANDOFF_WORD_BANDS`, template and prompt
  validators, `buildHandoffPrompt`; `validateRouting` now requires structured six-section
  templates for the nine role prompts (plain prompts remain only for owner/pipeline-governor)
  and `controller.promptSections`. Word bands 150–300 normal, 300–500 Planner/Global Reviewer;
  safety-critical content is never dropped to fit a size target.
- `scripts/pipeline-cli.js`: `promptFor` builds copy-ready prompts from templates, appends
  dynamic ticket/run/interruption reference lines to TASK, and fails closed on structural or
  required-content violations.
- `.agent/PIPELINE-ROUTING.json`: `copy-ready-handoff-1.1` with nine structured templates.
- Tests: `test-pipeline-policy.js` 47→67 checks, `test-pipeline-cli.js` 27→41 checks, including
  negative paths (forged hashes, hollow prohibitions, band violations, stale manifests).
- Routed docs updated to the six-section contract: `AGENTS.md` change rule, `AI-PIPELINE-SOP.md`
  §1, `AI-WORKFLOW.md` §2; stale CHG record moved to revision 3.
- Preserved: product source, deployment roots, live install, Git state, review lanes,
  interruption routing semantics and the active GAMECLOCK run (disjoint lock scope).

## Verification actually observed

Deterministic gate `GATE-RUN-20260901-PIPELINE-ORCHESTRATION-R4` passed 11/11 required checks
(0 repair attempts, sourceRevision 522fbbd, policyVersion choreo-pipeline-2.2): policy 67/67,
cli 41/41, `pipeline-cli check` PASS (defaultContextBytes 15996/16000), process-policy 28/28,
process-audit tests 10/10, `process-audit --check` 21/21, `check-ai-docs` 48/48. Both review
lanes independently re-ran the full ticket testPlan with the pinned `D:/nodejs/node.exe`
v24.20.0 and reproduced byte-identical results. Live corroboration: the prompts that opened the
module-review and global-review conversations were byte-equivalent to the generated templates,
and interrupt INT-20260901-PERFORMANCE-WORKSTATION took the queued-unrelated route against this
ticket without mutating the accepted contract.

## Remaining owner tails and why

None for this ticket. The owner still launches each next conversation manually (explicit
non-goal: no task-API integration), and portable-template parity remains the separate draft
ticket TASK-20260901-PORTABLE-COPY-READY.

## Files changed

22 files per `CHG-TASK-20260901-PIPELINE-ORCHESTRATION.json`: the two pipeline scripts, two
pipeline test suites, `check-ai-docs.js`, `PIPELINE-ROUTING.json`, five role files, two
templates, three interrupt READMEs, this ticket's CHG/WORKER evidence, `AGENTS.md`,
`docs/README-AI.md`, `AI-WORKFLOW.md`, `AI-PIPELINE-SOP.md`. Review findings of note: default
startup context is at 15996/16000 bytes, so future default-document growth requires replacement
or compaction; routing config and pipeline scripts must deploy or revert as one atomic unit;
whole-tree line attribution versus the 3000-line ticket budget becomes measurable only on the
next commit of these untracked files.
