# HANDOFF — 1–8 dancer acceptance sweep (character assets P6)

Package: TASK-20260903-CHARACTER-ASSETS-P6-ACCEPT (revision 2, R3, standard lane, tags
cross-module/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P6-ACCEPT (completed,
1 owner-authorized repair) · 2026-09-05 · Modules: web-product · Reviews: module + global,
both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P6-ACCEPT-R2 · Owner enable
recorded in `.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P6-ACCEPT/OWNER-ENABLE.json`.

## Objective and acceptance

Design sections 9–10 accepted over the closed P1–P5 state: every dancer count 1–8 (plus
boundaries 0/9/12 inside the unchanged 1–12 import range) resolves each dancer to its bound
profile, the stand-in, or an explicit missing notice — never another dancer's model or clip —
while game preview still drives exactly the one selected dancer. The sweep was acceptance
evidence only: it exposed no product gap on any deterministic surface, so no product source
byte changed. AC-1 (planRender sweep), AC-3 (namespace/reuse + frozen missing-clip-ns
wording), AC-4 (adoption into an open session), AC-5 (buildGameClips previewActor invariance)
and AC-6 node-side resilience are frozen by the new node suites; AC-2/AC-4/AC-6 browser
surfaces by the gate's file:// probe; AC-7 closed at this closeout by checking exactly
REQ-SPEC-053 and REQ-SPEC-056 (054/055 stay owner live-deploy acceptance); AC-8 by the full
routed matrix with every pre-existing assertion unmodified.

## Mechanism / red baseline

At the claim baseline the P6 sweep assertions did not exist, so the new suites abort red
against the claim-baseline blobs (sections 19–20 of test-edit, 15 of test-check, 四十一–四十三
of test-library) and green on the changed tests only. Two authoring expectations were
corrected against the current implementation during the run (merged-master dancer list
0,2,6,7 because a second profile shares fingerprint F1; the clean +1-master case must rebind
a previously bound dancer since dangling-repair drops the unneeded stand-in master) — both
were test-expectation errors, not product gaps. GATE-1 passed 21/21 except one process
metric (continuity snapshot drift after the package activation); the owner authorized exactly
one bounded repair (regenerate the marked block via `process-audit --fix`, recorded in
`worker-repair-1.md` + `ESCALATION-RESOLUTION-*.json`), and GATE-R2 re-ran the full testPlan
green as the run of record.

## What changed and behavior preserved

- `web/test-edit.js` (+133/−0): AC-1 sweep — six-class mixed template (distinct skeletons,
  shared skeleton, model-less skeletoned, no-skeleton shell, dangling id, unbound default)
  planned at every count 0–8 plus 9 and 12; dancer-aligned entries, hand-computed master
  counts, per-entry fingerprint ownership, pairwise non-borrowing, run-to-run deep equality,
  zero input mutation; plus the AC-5 buildGameClips invariance suite (previewActor k=0..7
  byte-identical to the binding-free baseline, mute-only semantics unchanged, out-of-range k
  yields only global lyrics).
- `web/test-check.js` (+74/−0): AC-3 frozen-wording suite — the missing-clip-ns health item's
  exact Chinese message (dancer/action/bound profile/source profile), full copy affordance,
  「其他档案」 fallback, rule-1 non-duplication and the silent classes.
- `web/test-library.js` (+217/−0): AC-3 full-occupancy namespace/reuse (two composite
  (profileId,name) rows for one shared action name, no implicit borrowing, identical bytes
  stay one mblob payload), AC-4 adoption-into-session (binding-neutral adoption, new/same
  fingerprint master cases, others byte-unchanged, corrupt refusal with store+document bytes
  unchanged), AC-6 mid-session resilience (delete flips only its dancers, re-import
  auto-recovers bindings, repeated resets byte-equal, malformed binding shapes behave as
  unbound defaults, v2 key-family allowlist).
- No product source changed: `web/preview3d.js`, `web/choreo-edit.js`, `web/choreo-library.js`,
  `web/choreo-check.js` are byte-identical to the claim baseline (gate measure + both
  reviews), so no dist-twin sync was required and both live roots stay untouched. DB_VERSION
  stays 2; no new store/endpoint/header/upload; the 1–12 import range and the owner-fixed
  8/8/1 dancer-count ruling are untouched (copy syncs belong to
  TASK-20260905-DUAL-MODE-CLOSEOUT).

## Verification actually observed

GATE-R2 passed all 21 required checks: edit 304/0 (baseline 212), check 93/0 (83), library
318/0 (289), engine 47/0, projects 105/0, document 110/0, docwire 54/0, showcompiler 42/0,
shell 45/0 — all pre-existing assertions unmodified; `offline-verify all` 50/0,
`library-verify all` 150/0, `clipcheck-run` 148/0, each green standalone on first try (the
known overlapped-invocation flake from P5 did not recur); `pipeline-cli check` PASS with the
pre-existing PREREQUISITE_INVERSION_RECORDED warning; `process-audit --check` 25/25;
`git diff --check` clean. Browser probe (GATE-1 `probe:browser-p6`, 56/56, carried into GATE-R2
on a machine-verified byte-identical product surface): AC-2 per-count master counts
{1:1, 2:2, 3:2, 4:3, 5:4, 6:4, 7:4, 8:4} with per-dancer Chinese notices and rigs===n
throughout; AC-4 real-path `.choreochar` adoption + binding-switch re-resolution with correct
master add/merge/reclaim; AC-6 delete/re-import/reset with document bytes unchanged and
malformed binding shapes resolving to the unbound default; zero JS exceptions, zero network
egress (probe script deleted after the run per the evidence plan; durable record
`gate-probe-p6accept.md`). Budgets (shared measure authority over lockScope): 1 repair (≤2);
gate-time delta 8 files +702/−0, all bookkeeping under `.agent/evidence/<ticket>/**`; the
three test files add 424 lines against the 1100 budget; ~34 active minutes of 90.

## Remaining owner tails and why

- [TAIL:CHARASSETS-P2-LIVE] unchanged in kind, now covering the P1–P6 twin union: both live
  roots still run pre-P2 bytes and every acceptance probe used synthetic fixtures. At the
  next authorized deploy, copy the character-assets twin pairs into each live root as one
  unit, import one real Meddle export and exercise a multi-profile session; that real
  acceptance is what checks REQ-SPEC-054 and REQ-SPEC-055. REQ-SPEC-053/056 are now checked
  on this run's evidence.
- Non-actions: no live-install copy, no release-staging rebuild, no commit/push/publish, no
  generated-asset regeneration (none changed) in this run.
- Rollback: revert the three test files as one unit (claim-baseline blobs under
  `.agent/runs/baselines/RUN-20260903-CHARACTER-ASSETS-P6-ACCEPT/` at gate time); no product,
  dist, or data byte depends on them. The SPEC/registry rows return to unchecked if this
  evidence is invalidated.

## Files changed

3 files: `web/test-edit.js` (+133/−0), `web/test-check.js` (+74/−0), `web/test-library.js`
(+217/−0); no dist twins (no product source changed). Closeout-only registry/state edits:
SPEC.md rows REQ-SPEC-053/056 checked, PROCESS-STATE registry/package/tail views, backlog
index row — regenerated by the deterministic closeout tools. Full detail:
`.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P6-ACCEPT.json`;
gate result, both review verdicts, the probe record, the escalation/repair records and the
owner-enable decision under `.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P6-ACCEPT/`.
