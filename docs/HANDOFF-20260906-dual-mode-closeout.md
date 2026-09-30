# Handoff: M1.5 dual-mode closeout (TASK-20260905-DUAL-MODE-CLOSEOUT)

## Objective and acceptance

Close the M1.5 dual-mode audit's only confirmed gap (REQ-SPEC-027, ticket revision 3, R2,
standard lane) and sync every divergent dancer-count copy spot to the owner-fixed 2026-09-05
ruling (edit/rehearsal 8, web preview 8, game execution 1 before X1). All ten acceptance
criteria are verified: the play button's own visible label identifies the playback target in
all four stopped/playing × web/game combinations with tooltip, mode-toggle and status-bar
indications retained (AC-1/2, owner decision D2 — option A rejected); the label re-renders on
mode switch with no stale copy surviving the toolbar re-creation and the FIX-B switch behavior
unchanged (AC-3); every pre-existing mode-check assertion passes unmodified — 24 original
`ok()` sites intact, zero-request-to-48794, snapshot push, 409 re-push and game-to-web
stop+unfreeze all green (AC-4); the stale SPEC.md "still offers 1–3 dancers by default" claim
is replaced on line 42 by the ruling plus the deliberate 1–12 headroom with E1 evidence and the
checkbox stays checked (AC-5); the WORKPLAN-20260829.md E1 paragraph states quick buttons 1–8,
clamp 1–12, import validation 1–12 and the ruling as a dated correction with both stale phrases
gone (AC-6); the two web clamp/validation comments state the ruling and headroom while
setDancerCount stays 1–12, quick buttons 1–8 and import behavior byte-unchanged (AC-7, D1 —
headroom stays); the ShowProtocol MaxPerformers comment states the ruling and that 64 is a
structural parser guard, value unchanged (AC-8, D3); source/dist twins are SHA-256-identical
with live deploy roots untouched (AC-9); one module change record per impacted module with both
review lanes approving the final gate and SPEC line 67 still unchecked (AC-10).

## Mechanism / red baseline

The play button was an icon-only `btn icon` element whose text never carried the preview
target, so in-game and web playback looked identical on the button itself (audit §1, REQ-SPEC-027
unchecked). The copy assertions (D1–D4) reproduced red at claim time — stale phrases present,
ruling markers absent — and turned green with the copy edits; the twin check T1 was green
before and after. The implementation diff is web/choreo-app.js +12/-2 (label construction plus
two comment blocks), web/mode-check.html +98/-3 additive (13 new `ok()` sites 24→37, only the
fetch-restore line moved into the ④b `done()` closure, which restores state even on waitFor
timeout — strictly safer), plus one sentence each in SPEC.md and WORKPLAN and a two-line comment
in src/ShowProtocol.cs.

## What changed and behavior preserved

- `web/choreo-app.js` — play-button label `text = (isPlaying ? '⏸ ' : '▶ ') +
  (previewTarget==='game' ? '游戏内播放' : '网页播放')` (id=playBtn, inline 10px sizing);
  setDancerCount and sanitizeImportProject comments now carry the 8/8/1 ruling and the 1–12
  headroom. All behavior lines byte-identical: clamp expressions, gameStartPlay response-body
  gating, switchPreviewTarget stop+unfreeze, zero-request web-mode paths.
- `web/mode-check.html` (+ its dist twin) — 13 additive assertions: 12 label assertions across
  sections ①②④④b⑤ plus the ④b playing-state assertion, driven through a hermetic in-page mock
  (`__mcMockPlayback` answers freeze/start/stop; `__mcStartFailOnce` yields the v0.7.1
  HTTP-200 `{error}` business-failure shape) that passes through to the real plugin outside the
  window, so section ⑤'s real stop counting is preserved.
- `web/dist/ChoreoHelper/choreo-app.js`, `web/dist/ChoreoHelper/mode-check.html` — byte-identical
  twins (T1 exit 0; choreo-app.js d3061939…, mode-check.html e98e8bfe…). Live deploy roots
  untouched (owner-gated); deploy the two twin pairs together at the next authorized deploy.
- `SPEC.md` — line 42 only: ruling + 1–12 headroom + E1 pointer; checkbox stays checked; line 67
  (REQ-SPEC-027) stays unchecked pending owner acceptance.
- `docs/WORKPLAN-20260829.md` — E1 paragraph dated correction only.
- `src/ShowProtocol.cs` — comment-only lines 21–22; MaxPerformers stays 64; protocol v1 shape
  frozen; datalayertest 626/0 and Release build 0 warnings/0 errors.
- No new endpoint, payload, timer, request path, persisted state, version or capability change;
  no commit, push, publish, staging rebuild or live-install overwrite.

## Verification actually observed

Gate `GATE-RUN-20260905-DUAL-MODE-CLOSEOUT-R3` passed 26/26 required checks (2026-09-06T03:49Z),
zero failures, zero repairs: offline-verify mode-check 1/0 and all 50/0, library-verify 150/0,
clipcheck 148/0, web fast suites engine 47 / edit 304 / check 93 / projects 105 / document 110 /
docwire 54 / showcompiler 42 / library 318 / shell 45 — all 0 failures, D1–D4 copy assertions and
T1 twins exit 0, datalayertest 626/0, plugin Release build 0 warnings/0 errors,
`pipeline-cli check` PASS, `process-audit --check` 25/25, check-ai-docs 60/60,
`git diff --check` clean. Module review REVIEW-…-R3-module APPROVE after independently re-running
the 36/36 mode-check on repo dist served from the allowlisted 48796 origin and diffing all seven
product changes against claim-baseline blobs; global review REVIEW-…-R3-global APPROVE after
re-deriving topology, contracts, migration-compatibility, security and rollout/rollback from the
same blobs. Closeout (context-sync, 2026-09-06): run finished `completed` with gate R3 + both
review approvals + three module change records and archived to
`.agent/runs/history/RUN-20260905-DUAL-MODE-CLOSEOUT.json`; ticket status accepted → closed;
PROCESS-STATE order 42 registered with the new DUAL-MODE-ACCEPT owner tail; `process-audit --fix`
regenerated exactly the backlog package index and the continuity snapshot/tails derived blocks;
the §6 continuity rewrite (dual-mode/product-state/next-action refresh, stale closeout clauses
removed) also brought the default context budget back under the 20000-byte ceiling at 19916;
`process-audit --check` 25/25, `check-ai-docs` 60/60 and `pipeline-cli check` PASS re-ran green
on the regenerated tree (remaining non-fatal warnings: 9 open owner tails vs the soft budget of
8, and the recorded SIX-TRACK prerequisite-inversion exception).

Run history that shaped this closeout: the first gate tripped a pre-existing harness flake
(offline-verify all [initrace] async option-count assert; repair surface scripts/** is ticket
prohibitedPaths), escalated per SOP §8; the owner resolved INT-20260906-HARNESS-HARDENING-FLAKE
as create-queued-ticket-and-resume-current — `TASK-20260906-HARNESS-HARDENING` (draft, queued)
owns the harness wait-hardening and this run re-gated fresh as R3 with all three previously
flaky checks green in-plan. Doctor's RUN_LINE_BUDGET_EXCEEDED (+839/-2 at gate time vs the
400-line budget) is dispositioned by both reviewers: the overage is entirely the mandated
immutable gate/escalation evidence under `.agent/evidence/**` (the implementation diff is
+12/-2); routed as a process-evolution candidate — exclude `.agent/evidence/**` gate JSONs from
the line budget or give them a per-gate allowance.

## Remaining owner tails and why

- **[TAIL:DUAL-MODE-ACCEPT] M1.5 dual-mode acceptance:** the label and copy sync are proven by
  diagnostics and review; only a human can accept the visible copy. One owner session in the
  file:// app: visually accept the play-button label in both modes (checks off REQ-SPEC-027,
  SPEC line 67) and run the game-mode acceptance closing the audit's eight
  implemented-pending-acceptance rows. Live deploy roots stay owner-gated; the repo twins deploy
  together as two paired units.
- **TASK-20260906-HARNESS-HARDENING (queued, draft):** harden the three characterized harness
  timing waits (mode-check scenarioDiag title waits, initrace async assert, library [rec]
  window-open) so flaky-under-load failures stop tripping gates; its re-gate is a
  harness-confidence rerun, not a product-repair cycle.

## Files changed

- `web/choreo-app.js`, `web/mode-check.html` and their `web/dist/ChoreoHelper/` twins — the
  implementation diff.
- `SPEC.md`, `docs/WORKPLAN-20260829.md`, `src/ShowProtocol.cs` — the copy/comment sync.
- `.agent/tickets/TASK-20260905-DUAL-MODE-CLOSEOUT.json` — status accepted → closed at closeout.
- `.agent/runs/history/RUN-20260905-DUAL-MODE-CLOSEOUT.json` — completed run with gate/review/
  change evidence (active manifest removed).
- `.agent/evidence/TASK-20260905-DUAL-MODE-CLOSEOUT/` — worker evidence, escalation, gates R2/R3
  and both R3 review verdicts, owner decision records, gate pin.
- `.agent/modules/{web-product,product-governance,plugin-product}/changes/CHG-TASK-20260905-DUAL-MODE-CLOSEOUT.json`
  — one module record per impacted module.
- `.agent/PROCESS-STATE.json` — order 42 closed with outcome + handoff; DUAL-MODE-ACCEPT tail.
- `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md` — order-42 views regenerated by
  `process-audit.js --fix` plus the continuity product-state/next-action rewrite.
- `docs/HANDOFF-20260906-dual-mode-closeout.md` — this handoff.
