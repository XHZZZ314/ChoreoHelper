# HANDOFF — local authorization and release contract (closed)

Package: TASK-20260901-LOCAL-AUTH-RELEASE-CONTRACT (revision 2, R4, standard lane,
modules product-governance + web-product + plugin-product + release-product) ·
Run RUN-20260901-LOCAL-AUTH-RELEASE-CONTRACT (completed 2026-09-04)

## Objective and acceptance

Per the accepted ticket revision 2: resolve the persistent-pairing vs
short-lived-session contradiction as an owner-reviewable contract covering
`file://`, localhost plugin pages and `https://xhzzz314.github.io`; define
token lifecycle, storage, rotation, revocation, compatibility, capability
negotiation and release blocking; create the bounded follow-up implementation
ticket with zero product-code change in this run. All five acceptance
criteria are met with recorded evidence (AC-1/2/3 contract sections and
matrices cross-checked in `contract-checklist.md`; AC-4 zero during-run
writes under `src/ web/ release/ site/ sample/` plus release-gates 28/28;
AC-5 derived ticket PASS).

## Mechanism / red baseline

- No red product test: documentation/governance package. Grounded
  contradiction: `src/PairingStore.cs` stores one permanent 8-char
  paste-once code (`localStorage`, `X-Choreo-Token`) while
  `DESIGN-game-executor.md` §8 rule 4 demanded short-lived session tokens
  for writes.
- Run history: Worker draft → R1 gate failed on 2 process fingerprints
  (CHG test-status enum, continuity snapshot vs fresh claim) → escalation
  with owner authorization for one repair cycle
  (`ESCALATION-RUN-...`/`ESCALATION-RESOLUTION-RUN-...`) → repair touched
  exactly 6 authorized process files → R2 gate passed.

## What changed and behavior preserved

- NEW `docs/DESIGN-local-authorization.md`, APPROVED 2026-09-04 (§15 owner
  decision, transcribed verbatim in the owner-lane review): phased token
  model (persistent pairing Phase 0 + short-lived write/show sessions Phase
  1), threat model, lifetime/rotation/revocation/storage/retry/concurrency/
  restart/recovery rules, CORS-is-transport rule, exactly-three-rows
  origin/access matrix with the new-origin stop rule, C1–C4 compatibility
  matrix with plugin-first dual-accept rollout, release blocking conditions.
- Three pointer-only deltas: SPEC §5 contract paragraph (no checkbox,
  registry untouched), executor §8 rule 4 defers to the contract,
  AI-RUNBOOK origin pointer.
- NEW derived ticket `TASK-20260901-LOCAL-AUTH-IMPLEMENTATION` (R4, every
  AC cites a contract section; ticket check PASS) — unfrozen into
  scheduling by the owner decision; it still needs its own QA acceptance
  before any code changes.
- Four module change records (product-governance binding authority,
  web-product zero web writes, plugin-product zero src writes,
  release-product blocked release), reconciled at closeout to the recorded
  owner decision.
- Preserved: every product behavior, protocol byte, gate and threshold; all
  unrelated uncommitted owner work intact; no deploy, staging rebuild,
  remote, push or publication.

## Verification actually observed

- Gate R2 `GATE-RUN-20260901-LOCAL-AUTH-RELEASE-CONTRACT-R2`: 14/14 checks
  passed, 0 fingerprints, both R1 fingerprints cleared at root; ticket
  sha256 equal to claim-time pin; 0 during-run writes under prohibited
  roots (32 baseline entries all pre-existing owner work); budgets 9 files
  / 699 additions ≤ 14 / 1200; repair 1 of 2.
- Reviews against R2: module APPROVE, global APPROVE (topology,
  shared-contract, migration, R4 security-boundary, hidden-drift and
  scope-provenance findings all info/none-blocking), owner APPROVE —
  "批准合同" recorded in person 2026-09-04 with alternatives offered.
- Ticket checks contract + derived PASS/PASS; `check` PASS; process-audit
  25/25; check-ai-docs 60/60; test-release-gates 28/28; git diff --check
  clean over ticket paths.
- Run budget: 96/90 minutes elapsed at closeout (recorded warning; caused
  by the repair cycle and owner pause, not extra scope — 9 files / 699
  lines both well inside budget).

## Remaining owner tails and why

- None new. The pre-existing RELEASE/ARCH2-LIVE/GAMECLOCK-LIVE owner tails
  are unchanged; release work stays blocked by contract §14 until the
  derived implementation ticket, security/recovery gates, three-origin
  browser regressions and explicit publication authorization pass.
- Live-browser PNA re-verification on `https://xhzzz314.github.io` and any
  DLL/staging/publication action stay owner-authorized follow-ups under the
  derived ticket.

## Files changed

`docs/DESIGN-local-authorization.md` (new), `SPEC.md`,
`docs/DESIGN-game-executor.md`, `docs/AI-RUNBOOK.md`,
`.agent/tickets/TASK-20260901-LOCAL-AUTH-IMPLEMENTATION.json` (new),
`.agent/evidence/TASK-20260901-LOCAL-AUTH-RELEASE-CONTRACT/**` (new),
`.agent/modules/{product-governance,web-product,plugin-product,release-product}/changes/CHG-TASK-20260901-LOCAL-AUTH-RELEASE-CONTRACT.json`
(new), this handoff.
