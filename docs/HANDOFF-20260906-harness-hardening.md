# Handoff: harness wait hardening (TASK-20260906-HARNESS-HARDENING)

## Objective and acceptance

Harden the three browser-integration waits that flaked in
GATE-RUN-20260905-DUAL-MODE-CLOSEOUT-R2, harness-only with zero product-behavior change
(ticket revision 2, R2, standard lane; queued from interruption
INT-20260906-HARNESS-HARDENING-FLAKE because the closeout ticket prohibited `scripts/**`).
All five acceptance criteria verified by GATE-RUN-20260906-HARNESS-HARDENING (passed, 14/14
checks) plus module review APPROVE:

- AC-1 — `mode-check` standalone exits 0 at 1/0 MODE-PASS across 3 consecutive passes and
  `offline-verify all` exits 0 at 50/0 (MODE-PASS + CLIP-PASS) across 2 consecutive passes,
  against live-root 48795 with the game online; no SCENARIO_TIMEOUT on the diagnostic title;
  every repeated run logs the harness-reported plugin-online state (是 in every run).
- AC-2 — the initrace baseline option-count assert waits for the post-refresh render
  (bounded poll on `.p3d-prof option` count) and is green in both `all` passes.
- AC-3 — `library-verify all` exits 0 at 150/0 across 2 consecutive passes with the `[rec]`
  window-open check waiting on deterministic modal state instead of a fixed sleep.
- AC-4 — attribution is exact: implementation changes only in the two harness scripts
  (+46/−3); no web/src/SPEC/WORKPLAN/closeout bytes touched; `git diff --check` clean.
- AC-5 — the 120s scenarioDiag budget and the 15s per-command CDP timeout stay fail-closed
  naming their methods; no pre-existing check() deleted or weakened; suite totals stay 50
  and 150 (reviewer verified in source and logs).

## Mechanism / red baseline

Red baseline reproduced live on the claimed tree before any edit: `offline-verify all`
failed 49/1 with `等待超时(120s): 诊断结果（标题）` on clip-check — the identical
SCENARIO_TIMEOUT fingerprint to the R2 gate — confirming pre-existing harness timing, not a
product regression. Three root mechanisms, each converted from assert-after-wait to
readiness-before-assert: (1) scenarioDiag asserted the diagnostic title inside the 120s
budget with no terminal-title distinction, so a stalled page burned the whole budget;
(2) the initrace baseline asserted option count immediately after `__p3dProfilesChanged()`,
racing the IDB-driven select rebuild; (3) the `[rec]` window-open check asserted once after
a fixed `sleep(500)`, racing the async modal render.

## What changed and behavior preserved

- `scripts/offline-verify.js` scenarioDiag — waits for a terminal diagnostic title (PASS
  mark → pass; FAIL title or 45s without a terminal title → bounded whole-page reload
  retry, max 2, skipped inside the last 15s of budget); reloads exhausted with a FAIL title
  fail fast carrying the page-log tail; the outer 120s budget and its fail-closed,
  method-named throw are unchanged. Each diag run logs the harness-reported 48795
  plugin-online state.
- `scripts/offline-verify.js` scenarioInitRace — the baseline option-count assert is now
  preceded by a bounded 20s/200ms poll for `.p3d-prof option` count 2; a poll timeout is
  swallowed so the original exactly-2 check still records the failure. Assertion unchanged.
- `scripts/library-verify.js` scenarioRec — the `[rec]` window-open check is preceded by a
  bounded 15s/200ms named waitFor on the exact modal-text state the check asserts; the
  fixed `sleep(500)` is removed; the pre-existing check() is byte-identical.

No check() deleted or weakened; suite totals 50/150 unchanged; cancellation/verify-cleanup
paths, Chrome launch topology, serial execution, mock/offline fallback and diagnostic-page
pass marks (MODE-PASS/CLIP-PASS) untouched. Known bounded residual (accepted in review):
the reload retry can mask a transient single-shot diagnostic failure but not a persistent
one; the FAIL-terminal fail-fast branch's evidence shape has not yet been observed in a
real failing run.

## Verification actually observed

Gate (passed, 14/14): mode-check ×3 and offline-verify all ×2 and library-verify all ×2 all
green at the repeat minima with zero SCENARIO_TIMEOUT and no retry/reload line fired in any
green run; clipcheck-run 148/0; `pipeline-cli check` PASS; `process-audit --check` 25/25;
`check-ai-docs.js` 60/60; `git diff --check` clean; measure attribution exact (2 files,
+46/−3, within budgets 10 files / 600 lines). One gate repair (1/1 within budget):
MODULE_CHANGE_FIELD_MISSING — the module change record lacked `documentationImpact`; the
value is dictated verbatim by ticket revision 2 and no code/test/policy/ticket bytes were
touched; pipeline-cli check and check-ai-docs re-passed after the repair. Module review:
APPROVE, no findings, AC-1–AC-5 each verified from gate logs/source. Closeout (context-sync):
run finished completed with gate + module review + web-product change record; ticket status
accepted → closed; `process-audit --fix` 25/25 with zero repairs needed, re-run `--check`
25/25, `check-ai-docs.js` 60/60, `pipeline-cli.js check` PASS.

## Remaining owner tails and why

- None new. The pre-existing review-only warnings remain as before (9 open owner tails vs
  the soft budget of 8; recorded SIX-TRACK prerequisite-inversion exception).
- The dual-mode closeout already re-gated fresh (R3) after the escalation, so no re-gate
  waits on this hardening; future gates simply run on the now-hardened harness.

## Files changed

- `scripts/offline-verify.js`, `scripts/library-verify.js` — the three readiness-wait
  conversions (implementation diff +46/−3).
- `.agent/tickets/TASK-20260906-HARNESS-HARDENING.json` — status accepted → closed.
- `.agent/runs/history/RUN-20260906-HARNESS-HARDENING.json` — completed run archive with
  gate/review/change evidence (active manifest removed).
- `.agent/evidence/TASK-20260906-HARNESS-HARDENING/` — gate result, module review, worker
  evidence, gate logs.
- `.agent/modules/web-product/changes/CHG-TASK-20260906-HARNESS-HARDENING.json` — module
  change record.
- `docs/HANDOFF-20260906-harness-hardening.md` — this handoff.
- `docs/AI-BACKLOG.md` — one line under "Other closed history".
- `.agent/CONTINUITY.md` — next-action paragraph refreshed.
