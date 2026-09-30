# HANDOFF 2026-08-31 — PIPELINE-V2 risk-routed control plane closeout

## Objective and acceptance

Ticket `TASK-20260831-PIPELINE-V2` (rev 2, R2, class `pipeline_change`): harden the ChoreoHelper AI
pipeline and produce portable templates without changing product behavior. This handoff records the
owner-directed closeout (Context Sync role): final module change record, regenerated machine views
and package 14 closure.

Acceptance mapping: AC-1 deterministic ticket validation and AC-3 circuit rules are covered by
`test-pipeline-policy.js`; AC-2 overlap fail-closed by `test-pipeline-cli.js`; AC-4 product-path
protection held (see below); AC-5 portable template is partially met (templates + schema validators
exist, but no executable standalone self-test — recorded as a tail, not claimed as done).

## Mechanism / red baseline

- Baseline at closeout: `pipeline-cli.js check` PASS, `process-audit.js --check` **21/21**,
  `check-ai-docs.js` **45/45**, but `test-pipeline-policy.js` failed **34/36**: `valid context
  manifest accepted` and `valid run manifest accepted` were rejected with `contextHash does not
  match context identity`.
- Root cause (evidence, not guess): the producer `pipeline-cli.js` (context build) and the validator
  both define `contextHash = sha256(stableStringify({ticketId, ticketRevision, policyVersion, role,
  sourceRevision, files}))`, and both historical run manifests satisfy that formula; only the test's
  static `'a'.repeat(64)` placeholder violated it. The expectations were stale, so the test was
  updated to compute the identity hash exactly like the producer (regression value preserved: a truly
  valid manifest must still be accepted; stale-revision rejection still covered).

## What changed and behavior preserved

- Closeout edits: `scripts/test-pipeline-policy.js` (two stale expectations fixed as above);
  `.agent/modules/ai-pipeline/changes/CHG-TASK-20260831-PIPELINE-V2.json` created (validator-clean);
  `.agent/modules/ai-pipeline/STATE.md` finalized to "PIPELINE-V2 closed";
  `.agent/PROCESS-STATE.json` package 14 → closed with this handoff as evidence;
  `docs/AI-BACKLOG.md` + `.agent/CONTINUITY.md` regenerated through `process-audit.js --fix`.
- Package surface (already implemented by the worker runs, recorded in the CHG): role contracts,
  immutable tickets, claim-locked runs with context manifests, per-module change records,
  `PIPELINE-POLICY.json` (choreo-pipeline-2.2) and `MODULES.json` contracts, `pipeline-policy.js` /
  `pipeline-cli.js` with tests, artifact templates and routed AGENTS/docs updates.
- No product source, deploy root, live install, release staging, historical handoff or archive was
  modified by this ticket or this closeout. The working tree still carries the owner's separate
  uncommitted v0.7.1 product work, which is untouched and unattributed to this package.

## Verification actually observed

- `node scripts/test-pipeline-policy.js` — **36/36**, exit 0 (after the fix above; was 34/36, exit 1).
- `node scripts/test-pipeline-cli.js` — **16/16**, exit 0.
- `node scripts/test-process-policy.js` — **28/28**, exit 0.
- `node scripts/test-process-audit.js` — **10/10**, exit 0.
- `node scripts/pipeline-cli.js check` — PASS (`activeRunCount: 0`, 5 modules, 1 ticket), exit 0.
- `node scripts/process-audit.js --fix` then `--check` — **21/21** after regeneration.
- `node scripts/check-ai-docs.js` — **45/45**, exit 0.
- CHG record validated with `validateModuleChange` against policy 2.2: no issues.

## Remaining owner tails and why

- **Review-lane evidence**: both worker runs closed as `cancelled` with empty gate/review evidence,
  so no durable independent module/global review artifact exists for this ticket; the deterministic
  matrix was re-verified at closeout instead. If durable reviewer artifacts become a hard gate,
  record them under `.agent/evidence/` in a follow-up.
- **AC-5 portable template self-test**: no executable standalone suite exists in this repository;
  template parity is enforced only by the shared schema validators and examples.
- Owner tails in continuity (next direction, EXEC-CORE live acceptance, FIX-J observations, SEC-1 UI
  smoke, compatibility checks, release authorization) are unchanged and owner-bound.

## Files changed

- `scripts/test-pipeline-policy.js` — two stale contextHash expectations now computed like production.
- `.agent/modules/ai-pipeline/changes/CHG-TASK-20260831-PIPELINE-V2.json` — new module change record.
- `.agent/modules/ai-pipeline/STATE.md` — finalized closed state.
- `.agent/PROCESS-STATE.json` — package 14 closed, latest process handoff pointer.
- `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md` — regenerated views (allowlisted blocks only).
- `docs/HANDOFF-20260831-pipeline-v2-closeout.md` — this file.
