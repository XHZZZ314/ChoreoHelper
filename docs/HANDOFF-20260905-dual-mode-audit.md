# Handoff: M1.5 dual-mode audit and product plan (TASK-20260905-DUAL-MODE-AUDIT)

## Objective and acceptance

Planning-only package (revision 1, R2, standard lane, module+global review) from the owner
intake launched 2026-09-05 (pipeline-review synthesis §§14–15). All nine acceptance criteria
are met with machine evidence: every dual-mode requirement REQ-SPEC-019..029 is classified in
`docs/DESIGN-dual-mode-audit.md` §1 — 2 implemented-verified (024, 029), 8
implemented-pending-acceptance (019–023, 025, 026, 028, all tracing to one owed owner
acceptance event, the Stage-1 real-machine pass plus GAMECLOCK AC-10), 1 confirmed-gap (027,
play-button presentation) — each row carrying repository citations and non-verified rows a
named blocking target and next action (AC-1); the scenario table judges the seven milestone
rows plus web-offline and game-single overall rows pass/fail/blocked-by with named blockers
(AC-2); dependencies are grouped technical / security gate / priority / real-machine waiting,
multi-player game execution explicitly waits on X1 (blocks-M2 no), every entry names its
blocked object (AC-3); all eight owner tails are judged item by item — GAMECLOCK-LIVE clock
follow and game-mode stop/unfreeze stay named-pending-verification, FIX-J observations and
release authorization stay excluded with their acceptance needs surviving at the named paths
(AC-4); the dancer-count ruling is recorded verbatim ("Edit/rehearsal: 8 dancers; web preview:
8 dancers; game execution: 1 dancer (before X1).") with the five divergent spots
(SPEC.md:42, web/choreo-app.js:1654, web/choreo-app.js:1465, src/ShowProtocol.cs:22,
deliberate single-actor execution) plus the stale WORKPLAN:20 claim assigned to their owning
packages and no product copy changed (AC-5); the seam plan stays inside the AI-ARCHITECTURE
decomposition sequence and the milestone-to-requirement mapping cites REQ-SPEC-012/REQ-WP-X1
and the verified compiler→ShowProtocol→ShowValidator generic-field chain, recording compiler
field-loss → edit-side marking and shared dual-side samples as M2/M3 acceptance gates (AC-6);
exactly one thin draft ticket exists (`TASK-20260905-DUAL-MODE-CLOSEOUT`, status draft,
registered deferred in PROCESS-STATE, never enabled or pre-approved; queue shows it blocked on
this audit; directory count of new-pattern tickets = 1; P4–P6 deferred with unchanged
prerequisites) (AC-7); budgets carry the full-lifecycle estimate with the explicit
evidenceCostLines=700 line and this handoff records the actual-vs-estimate comparison below
(AC-8); and the diff touches only ticket writeScope — SPEC.md, roadmap, workplan, web/**,
src/** and the character-assets P4–P6 tickets byte-unchanged (verified by gate-time context
re-hash of all 11 claim manifest files; zero run-attributable writes outside writeScope;
outsideWriteScope and inProhibitedPaths empty) (AC-9).

## Mechanism / red baseline

R1 gate failed on two required checks with one fingerprint
(`module-change:plugin-product+web-product/CHG-...: tests[0].status 'not-run-by-design' not in
[passed,failed,not-run]`, occurrences 2), tripping the SOP §8 circuit breaker. The owner
authorized exactly one Worker repair cycle (ESCALATION-RESOLUTION, verbatim "授权 Worker 修复
周期", attempt 1 of 2): change only the two enum tokens to `not-run`. R2 re-ran the full
testPlan in a fresh gate conversation; the fingerprint did not reappear and every other check
stayed byte-identical. No repair budget beyond that was used; no gate, test or threshold was
weakened.

## What changed and behavior preserved

- `docs/DESIGN-dual-mode-audit.md` — the planning deliverable (8 sections; 11/11 requirement
  rows, scenario table, dependency groups, 8 tail judgments, dancer-count ruling with the five
  assigned spots, seam plan, milestone mapping, first-package section).
- `.agent/tickets/TASK-20260905-DUAL-MODE-CLOSEOUT.json` — the single thin deferred draft
  (goal, prerequisites [this audit], placeholder scopes/budgets for its own future QA review).
- `.agent/PROCESS-STATE.json` — order-42 deferred row for the draft; at closeout the order-43
  closed row for this audit and the latest-product-handoff pointer.
- Module change records for product-governance, web-product, plugin-product
  (`.agent/modules/*/changes/CHG-TASK-20260905-DUAL-MODE-AUDIT.json`).
- Evidence tree `.agent/evidence/TASK-20260905-DUAL-MODE-AUDIT/` (R1/R2 gate artifacts with
  gate logs, both review verdicts, escalation pair, private-path scan script).
- Derived views resynced from PROCESS-STATE (`docs/AI-BACKLOG.md` package index,
  `.agent/CONTINUITY.md` snapshot/tails blocks) via `process-audit --fix`, plus rewritten
  continuity prose; closing handoff (this file).
- Behavior preserved by design: no product file, product test, SPEC checkbox, roadmap row or
  workplan gate was touched; web playback/edit behavior, plugin protocol (MaxPerformers 64,
  single-local-actor until X1) and all suites keep their pre-run states.

## Verification actually observed

- Gate R2 (`GATE-RUN-20260905-DUAL-MODE-AUDIT-R2.json`, status passed): scope measure
  attribution=exact, 10 files / +641 −0 lines, all inside writeScope, outsideWriteScope and
  inProhibitedPaths empty, all 11 claim context hashes recomputed equal; testPlan 7/7 —
  `pipeline-cli check` PASS, `queue` snapshot (draft blocked, P4–P6 deferred), `process-audit
  --check` 25/25, `check-ai-docs` 60/60, `git diff --check` clean, audit structure check
  (11 categorized / 9 scenario rows / 8 tails / 5 count spots / seam+mapping), private-path
  scan 756 added lines / 0 private absolute paths. Budgets: 10/22 files, 641/1450 lines,
  ~15.1/90 min active.
- Reviews: module lane APPROVE (3 low findings, none requiring correction — citation
  grounding and row uniqueness re-verified against source), global lane APPROVE (3 low
  findings; topology, contracts, migration, security boundaries, rollback and evidence
  completeness re-checked; one finding instructs this closeout to compute AC-8 from the
  closeout-time measure, done below).
- Closeout (this session): `process-audit --fix` regenerated exactly the three controlled
  blocks; `process-audit --check` 25/25, `check-ai-docs` 60/60, `pipeline-cli check` PASS
  re-observed after the registry/handoff edits; closeout-time run measure recorded in the
  archived run history (`finalMeasurement`).

## Remaining owner tails and why

The audit judges but never changes tail states; all eight tails remain owner-bound as listed
in CONTINUITY. The eight pending-acceptance requirement rows fold into one game-mode
acceptance session (Stage-1 real-machine pass + GAMECLOCK AC-10 clock-follow + game-mode
stop/unfreeze check), an owner action, not a package. The single follow-up package
`TASK-20260905-DUAL-MODE-CLOSEOUT` (REQ-SPEC-027 judgment plus the five dancer-count copy
syncs and WORKPLAN:20) stays deferred until the owner enables it; M2 entry stays a planning
row in audit §8. P4–P6 remain deferred with unchanged prerequisites.

## Files changed

Run-attributable (lockScope measure set, all new except PROCESS-STATE):
`docs/DESIGN-dual-mode-audit.md`,
`.agent/tickets/TASK-20260905-DUAL-MODE-CLOSEOUT.json`,
`.agent/PROCESS-STATE.json`, 3 × `CHG-TASK-20260905-DUAL-MODE-AUDIT.json`, 9 evidence
artifacts under `.agent/evidence/TASK-20260905-DUAL-MODE-AUDIT/`. Closeout additions inside
writeScope: `docs/HANDOFF-20260905-dual-mode-audit.md` (this file), generated blocks in
`docs/AI-BACKLOG.md` and `.agent/CONTINUITY.md` plus rewritten continuity prose, and the
ticket's own status flip to closed at finish.

## Evidence cost (AC-8, actual vs estimate)

Estimate: `evidenceCostLines` = 700 (full-lifecycle estimation under current rules; data for
a possible future bucketing evaluation, no rule change). Actual at closeout, from
`pipeline-cli measure RUN-20260905-DUAL-MODE-AUDIT` over evidence/module-record/handoff
paths: 13 files / 785 added lines (9 evidence artifacts 558, 3 module change records 108,
this handoff 119) — 85 lines (~12%) above the 700-line estimate. The excess is attributable
to the R1 gate failure and its owner-authorized repair: the escalation pair, the immutable R1
gate artifact kept alongside R2, and the second review round; without one repair cycle the
same set lands under the estimate. Data point for the possible future bucketing evaluation:
a repair cycle roughly doubles gate-evidence cost. No measurement or rule file changed.
