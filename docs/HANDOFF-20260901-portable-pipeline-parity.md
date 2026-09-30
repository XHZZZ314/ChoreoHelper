# Handoff: portable copy-ready parity (TASK-20260901-PORTABLE-COPY-READY)

## Objective and acceptance

Apply the approved copy-ready handoff contract to the external portable AI
pipeline template as a separate versioned task, without touching the accepted
TASK-20260901-PIPELINE-ORCHESTRATION contract or ChoreoHelper product behavior
(ticket revision 2, R2, standard lane, `pipeline_change`). All five acceptance
criteria verified: every generated handoff is exactly one copy-ready prompt with
exactly the six sections ROLE, TASK, READ, DO, DO NOT, FINISH in order and no
extra heading (AC-1); ROLE embeds authority plus the fresh-conversation start,
DO NOT embeds prohibitions, FINISH embeds stop conditions including
generate-next, return-verbatim, stop plus the closing short Chinese summary
line, with path-only references (AC-2); misses, reorderings, duplications,
extra headings, missing fresh-conversation/stop instructions and word-band
violations are rejected, including in-band prompts missing safety content
(AC-3); template v1.2 draft passes the full isolated self-test including the
pre-existing claim, stale-context, evidence-close and circuit cases with no
ChoreoHelper dependency (AC-4); no product file, repository pipeline behavior,
or orchestration contract, evidence or run record changed (AC-5).

## Mechanism / red baseline

The template's dogfood run had implemented the six-section contract with gaps:
FINISH required only a stop directive (no generate-next-handoff, no
return-verbatim, no closing Chinese summary), word budgets were warnings, the
fresh-conversation statement was accepted anywhere, `.ai/roles/worker.md`
lacked its authority mirror, the template declared v1.1, and handoff cases
lived outside the single self-test. Repo baselines were green pre-change
(policy 93/93, cli 133/133, process-policy 65/65, process-audit 20/20,
check-ai-docs 60/60). The only mid-run blockers were process context, not
content: the first gate failed 23/25 on the claim-activated continuity snapshot
plus the pre-existing implementation-context overage (both outside writeScope);
the owner authorized the AI-WORKFLOW §2.7 bounded maintenance (snapshot
regeneration via `process-audit --fix`, budgets to 36500/16100 in
PROCESS-STATE, one stale-line trim, recorded in OWNER-MAINT-BUDGET-RAISE.json),
after which gate R2 passed without weakening any check.

## What changed and behavior preserved

- External template `portable-ai-pipeline-template-v1` (outside this
  repository, authorized by ticket assumption 2) v1.1 to 1.2 draft:
  `.ai/templates/handoff-contract.json` contractVersion 2 (ROLE placement,
  FINISH controls, hard word rejections, never-omit-safety guardrail);
  `scripts/ai-pipeline-handoff-tests.js` 22→27 checks; `scripts/test-ai-pipeline.js`
  now runs the handoff suite; `.ai/roles/worker.md` authority mirror plus six
  header v1→v2 bumps; `.ai/PIPELINE-POLICY.json` portable-1.2 with
  `pipelineChangeAllowed` extended; README/CHANGELOG 1.2 draft entries;
  template docs and continuity updated; dogfood run closed to history; one
  misplaced foreign review copy removed (authoritative APPROVE remains in this
  repository).
- Repository behavior preserved: no product source, deployment, release or
  live-install change; repository pipeline policy, routing, roles, templates
  and scripts untouched; the orchestration ticket revision 3 referenced by path
  only; pre-existing template coverage preserved (18/18 unchanged).
- Closeout (context-sync): run finished `completed` with gate R2 plus module
  and global APPROVE and the ai-pipeline CHG record; ticket accepted → closed;
  ai-pipeline STATE finalized; PROCESS-STATE order 25 closed with this handoff
  as evidence; backlog and continuity views regenerated only by the
  `process-audit.js --fix` reducer.

## Verification actually observed

Gate GATE-RUN-20260901-PORTABLE-COPY-READY-R2 (passed, 15 checks,
2026-09-04T12:48:01Z): source-revision equals run sourceRevision, 7/7 context
hashes match claim-time, measure attribution exact with 0 violations and 0
prohibited hits, ticket check PASS, portable self-test 27/27 + 18/18
(`CHANGELOG` declares 1.2), repo suites policy 93/93, cli 133/133,
`pipeline-cli check` PASS, process-policy 65/65, process-audit 20/20,
`process-audit --check` 25/25, check-ai-docs 60/60, plus whitespace and status
hygiene. Module review APPROVE (4 findings, all info/low, closeout-owned) with
an independent isolated-copy re-run (27/27 + 18/18, zero ChoreoHelper-path
hits) and direct contract/test-source reads. Global review APPROVE (4 findings,
all info/low) re-deriving topology, gate identity, contract parity, self-test
and repo parity. Finish re-validated gate, both reviews and the module record
before archiving the run to `.agent/runs/history/`. Closeout re-verification
(context-sync): `pipeline-cli check` PASS; `process-audit --fix` repairs
reviewed (generated views only); `process-audit --check` 25/25;
`check-ai-docs.js` 60/60.

## Remaining owner tails and why

- None new. Three carried items (also in the CHG record): confirm the recorded
  template path (`D:\codex\2026-08-31\ni-s\outputs\portable-ai-pipeline-template-v1`,
  found by stable-name search rather than in-conversation confirmation); decide
  when to commit the template's uncommitted v1.2 state (rollback via its
  baseline commit or the v1.1 zip alongside); apply the planned post-closeout
  policy raise of `budgets.defaultContextBytes` 16000 → 16100 (closeout
  headroom is 5 bytes; implementation headroom 176 bytes; raises stay owner
  decisions by design).

## Files changed

- External template only (see CHG `externalChanges` for the full list; the
  repository holds no template bytes).
- `.agent/evidence/TASK-20260901-PORTABLE-COPY-READY/` — WORKER.json,
  OWNER-MAINT-BUDGET-RAISE.json, both gate results (R1 failed immutable
  history, R2 passed), both APPROVE reviews, gate-checks evidence set.
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260901-PORTABLE-COPY-READY.json` — module record.
- `.agent/modules/ai-pipeline/STATE.md` — module state finalized (parity section).
- `.agent/tickets/TASK-20260901-PORTABLE-COPY-READY.json` — status closed at closeout.
- `.agent/runs/history/RUN-20260901-PORTABLE-COPY-READY.json` — completed run archive.
- `.agent/PROCESS-STATE.json` — order 25 closed (closeout-required registry mutation).
- `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md` — order-25 views regenerated by
  `process-audit.js --fix` from PROCESS-STATE.
- `docs/HANDOFF-20260901-portable-pipeline-parity.md` — this handoff.
