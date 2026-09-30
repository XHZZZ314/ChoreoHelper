# Handoff: library-verify rec autoimport flake fix (TASK-20260903-LIBVERIFY-REC-AUTOIMPORT)

## Objective and acceptance

Stabilize the rec autoimport timing flake in the headless verification harness
(`node scripts/library-verify.js rec` and `all`) without touching product code (ticket revision 4,
R1, standard lane; created from interruption INT-20260903-LIBVERIFY-REC-AUTOIMPORT-FLAKE to unblock
the ARCH2 gate). All three acceptance criteria verified by gate
GATE-RUN-20260903-LIBVERIFY-REC-AUTOIMPORT-R4 plus module review APPROVE: AC-1 — four consecutive
isolated `rec` runs each exit 0 with 0 failed checks, hasClips [true,true,true,false], FIX-C
commits=3 cancels=2 pending=0, cancel/reload-resume and recqcbad-refusal green; AC-2 — one full
`all` run exits 0 with the rec section green, both new waits poll library-observable state through
the pre-existing `waitFor` helper with explicit timeouts (60s/1s and 30s/500ms, both ≤60s) and
named-timeout expiry, and the added-lines scan reports zero Date.now/performance.now/hrtime tokens;
AC-3 — pre-claim preflight ok:true with conflicts:[], post-claim zero foreign lock overlap
(ARCH2 overlap=false), writeScope containment with zero src/** and web/** changes,
removed-check-calls=0, added-wallclock-hits=0, co-located HYGIENE hunks attributed BEFORE-RUN by
mtime, `git diff --check` clean.

## Mechanism / red baseline

Root cause: rec `putClip` writes the active profile via `activePidOrNew` while 3D-init
`putSkeleton` creates a new profile and switches the active pointer on hash mismatch, so the single
immediate readiness read after recStart could observe a profile the clips had not landed in yet.
Red baseline: `rec` in isolation and the rec section inside `all` failed 0/4 on the pre-change
baseline (the flake that blocked the ARCH2 deterministic gate). The fix sequences recStart after
`stats().skeleton` is persisted and polls `hasClips([bow,doze,golddance,recstat]) ===
[true,true,true,false]` for the final read — the profile-scope race is removed by construction.

## What changed and behavior preserved

- `scripts/library-verify.js` — exactly two hunks: a pre-session skeleton wait (waitFor 60s/1s
  before recStart) and the rec autoimport readiness poll (waitFor 30s/500ms over
  `ChoreoLibrary.hasClips`). No check() assertion added, deleted or reworded; no wall-clock-elapsed
  pass/fail assertion added; scenario failure still exits non-zero.
- Zero product-code change: no `src/**` or `web/**` writes during the run (mtime attribution:
  DURING-RUN tracked writes=0; the co-located HYGIENE hunks in the same file diff are BEFORE-RUN
  owner baseline). No deploy-root, staging, DLL or release action.
- Closeout (context-sync): run finished completed with gate R4, module review and the web-product
  change record; ticket status accepted → closed; one machine-state repair — the cancelled
  revision-3 history entry was renamed to `RUN-20260903-LIBVERIFY-REC-AUTOIMPORT-R1.json`
  (runId suffix only, content preserved) because the revision-4 run had re-claimed the same runId
  and `finish` enforces history uniqueness; rationale and tooling findings recorded in
  `.agent/evidence/TASK-20260903-LIBVERIFY-REC-AUTOIMPORT/closeout-notes.md`.

## Verification actually observed

Gate R4 (passed, 14/14 checks): four consecutive `rec` runs exit 0 (28 pass / 0 fail each; all four
logs byte-identical, sha256 903d181d…), `all` exits 0 (150 pass / 0 fail, rec section green at
gate-logs-r4/all.txt lines 100–122), added-lines scan 40 added lines with
added-wallclock-hits=0, removed-lines scan removed-check-calls=0, foreign-lock scan zero overlap
beyond this run, mtime attribution BEFORE-RUN for all 43 tracked modified paths, `git diff --check`
clean, `pipeline-cli check` PASS (pre-existing recorded PREREQUISITE_INVERSION warning only).
Module review REVIEW-RUN-20260903-LIBVERIFY-REC-AUTOIMPORT-MODULE: APPROVE, no blocking findings;
all evidence hashes independently re-hashed equal at HEAD 8a7e9f6. Run budget: 0 repair attempts;
elapsed ~50 min vs the 45-minute ticket budget (non-fatal RUN_BUDGET_EXCEEDED warning recorded).
Closeout checks: `process-audit.js --fix` 25/25 with zero repairs needed (views already
consistent), re-run `--check` 25/25, `check-ai-docs.js` 60/60, `pipeline-cli.js check` PASS.

## Remaining owner tails and why

- None new for the product. One environmental condition, not a tail: the `all`-mode real-plugin
  sections (auto/sync/uicheck/check) need a character logged in-game; without one they time out
  environmentally (probe evidence in the module record's knownRisks). `rec` itself is forced-mock
  and unaffected.
- Routed follow-up candidates recorded in closeout-notes.md for a future pipeline ticket, not
  fixed here (pipeline-cli is outside this ticket's writeScope): claim does not check run history
  for ID reuse; finish mutates activePackages before its final collision check; preflight lacks
  ignoreRunId (already tracked by INT-20260903-PREFLIGHT-IGNORERUNID).

## Files changed

- `scripts/library-verify.js` — two wait hunks (verification harness only).
- `.agent/tickets/TASK-20260903-LIBVERIFY-REC-AUTOIMPORT.json` — status closed at closeout.
- `.agent/runs/history/RUN-20260903-LIBVERIFY-REC-AUTOIMPORT.json` — completed run archive
  (gate R4 + module review + web-product change record as evidence).
- `.agent/runs/history/RUN-20260903-LIBVERIFY-REC-AUTOIMPORT-R1.json` — cancelled revision-3 run
  renamed from the colliding ID at closeout (content preserved).
- `.agent/evidence/TASK-20260903-LIBVERIFY-REC-AUTOIMPORT/` — gate R2/R3/R4, module review,
  planner disposition, gate logs, worker evidence, closeout-notes.md.
- `.agent/modules/web-product/changes/CHG-TASK-20260903-LIBVERIFY-REC-AUTOIMPORT.json` — module
  change record.
- `docs/HANDOFF-20260903-libverify-rec-autoimport.md` — this handoff.
- `docs/AI-BACKLOG.md` — one line under "Other closed history".
- `.agent/CONTINUITY.md` — next-action paragraph refreshed.
