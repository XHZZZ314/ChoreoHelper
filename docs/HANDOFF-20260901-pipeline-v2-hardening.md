# HANDOFF 2026-09-01 — PIPELINE-V2 hardening addendum

## Outcome

`TASK-20260901-PIPELINE-HARDEN` closes the two explicit tails in the 2026-08-31 PIPELINE-V2 closeout: durable module/global review evidence now exists, and the separate portable template has an executable isolated self-test. The addendum also fixes two review findings discovered while proving those tails: the deterministic-gate role lacked a context budget, and shared administrative evidence paths made independent module runs serialize unnecessarily.

The original closeout remains historical evidence. This file is an additive correction, not a rewrite.

## Contracts added or tightened

- Every declared role must have a positive `roleContextBytes` budget.
- Context and run identity hashes are recomputed from ticket, policy, role, source revision and context-file hashes; placeholders or forged identity are rejected.
- Run finish revalidates the active manifest, ticket revision, immutable policy/module/ticket/role inputs and gate source revision.
- `writeScope` is the full file allowlist. Optional `lockScope` is the smaller business mutex and must be contained by `writeScope`. Legacy tickets/runs without it fall back to `writeScope`.
- Claim creation still uses one repository-local atomic lock. Unique run/evidence files may be shared in write allowlists without forcing unrelated business modules to serialize.

The new behavior was proven while `RUN-20260901-GAMECLOCK-PREVIEW-VERIFY` remained active: its product write scope was preserved, and the non-overlapping pipeline hardening lock was claimed without cancelling or mutating it.

## Durable evidence

- Gate: `.agent/evidence/TASK-20260901-PIPELINE-HARDEN/gate.json`.
- Module review: `.agent/evidence/TASK-20260901-PIPELINE-HARDEN/review-module.json` — APPROVE.
- Global review: `.agent/evidence/TASK-20260901-PIPELINE-HARDEN/review-global.json` — APPROVE.
- Module change: `.agent/modules/ai-pipeline/changes/CHG-TASK-20260901-PIPELINE-HARDEN.json`.
- Run: `RUN-20260901-PIPELINE-HARDEN`, source revision `522fbbdcc25e8295d161a825e939efce36bfe47b`, context hash `f30d5588d09e2d109d1e07efc265c3c36d86912a9f6e28f3c27e32bc22df5208`.

## Verification observed

- Pipeline policy: **39/39**.
- Pipeline CLI integration: **17/17**.
- Pipeline workspace and hardening ticket: PASS with two independent active runs at gate time.
- Existing process policy/audit: **28/28**, **10/10**, live **21/21**.
- AI document governance: **45/45**.
- Portable template mode: PASS, seven JSON templates parsed.
- Portable isolated self-test: **18/18**.
- All eleven required gate checks exited 0 and have SHA-256 output hashes in the gate artifact.

## Scope and preservation

Only AI-pipeline policy, roles/templates/tickets/evidence/module state, pipeline docs and pipeline scripts/tests were changed in ChoreoHelper. No `SPEC.md`, `src/`, `web/`, `release/`, `site/`, `sample/`, deploy root, live install or product behavior was modified by this addendum. The portable template remains outside the ChoreoHelper repository.

No dependency was installed; no hook was activated; no commit, push, publication or production mutation was performed.

## Remaining bounded tails

- Existing tickets without `lockScope` retain conservative whole-write-scope locking. Migrate them only when they are next revised; do not rewrite historical tickets.
- Portable hook and CI samples are inert until a repository owner explicitly adopts them.
- Module/global reviews are durable separated passes by the root agent, not an independently delegated reviewer; owner review is not required for this R2 ticket.

## Post-close concurrent observation

After this run completed and its 45/45 document-governance gate had been recorded, the still-active independent `RUN-20260901-GAMECLOCK-PREVIEW-VERIFY` wrote a module change record naming `src/tests/datalayertest/datalayertest.csproj` outside that ticket's write scope. The final workspace recheck therefore correctly fell to **44/45**. This addendum does not modify that product ticket or its evidence; its owner must either remove an inaccurately listed file or revise/reclaim the ticket before completion. All other final checks remained green.
