# Handoff: Local music-beat foundation (TASK-20260909-MUSIC-BEAT-VERIFY)

## Objective and acceptance

First bounded REQ-SPEC-009 increment: local music rehearsal in the pure web
layer — audio reference clock `T=A-O` with one global offset, manual
BPM/anchor beat targets, and one explicit game start coordinating a single
normal actor — without claiming physical-clock or 3 ms accuracy (ticket
revision 5, R3, standard lane, review lanes module+global; owner-authorized
`INT-20260910-MUSIC-BEAT-DIRECT-BUILD` superseded the cancelled r4 formal
attempts). No SPEC/roadmap checkbox closed; no live-root, staging, commit or
push action. All eight acceptance criteria verified by
`GATE-RUN-20260910-MUSIC-BEAT-FOUNDATION-R5-2` (19/19 frozen checks green,
gate sha256 `a41ef30a71600625…`) with quality-contract v2 evidence, module
and global reviews both APPROVE with not-falsified counterexamples, and the
run closed `completed` by the shared closeout validator.

## Mechanism / red baseline

- No music feature existed before this ticket, so the six red-green baselines
  are injection reds recorded on this run from the recovery fixture:
  `r5/implementation/red-fixture.js` reverted the five pre-run-changed product
  files from hash-verified quarantined baseline blobs, removed the four music
  files and placed a loadable absence placeholder, all six declared commands
  failed behaviorally at exit 1 with the declared `MUSIC_*_ASSERTION`
  fingerprints (`red/REG-*.json` bound to this run), then restored byte-exact
  (`hashDrift=0 twinDrift=0`, `fixture-provenance.json`).
- Recovery provenance: the original r5 worker run was invalidated by the
  context-recovery interruption; its implemented tree was quarantined (50
  preserved artifacts under `r5/ledger-recovery/`) and re-claimed as
  RUN-20260910-MUSIC-BEAT-FOUNDATION-R5 (claim baseline `baedc39b…`) per
  `r5/planner-recovery-plan.md`; r4 history stays immutable.
- Superseded failed gate disclosed: the first gate of this run failed BROWSER
  (19/21, pre-roll display race); repair2 (below) fixed it and gate `-2`
  passed. Worker repair budget consumed 1/2; the gate itself performed none.

## What changed and behavior preserved

- `web/choreo-music.js` (pure layer, new): audio reference clock `T=A-O` in
  ms with visible time clamped to `[0, project duration]`, media the only
  advancing source, pre-roll/clamped-seek/reset/end and no-music invariants;
  manual beats `audio=H+n·60000/BPM`, `timeline=audio−O`, numeric ranges
  (offset integer ±3600000, BPM finite 1–600 nullable, anchor integer ≤ audio
  duration) with Chinese errors and unchanged values on invalid input; one
  explicit game start — `media.play` first, pre-roll waits until `T≥0`,
  `fromTime=max(0,A−O)/1000` sampled once, only `status=playing` confirms,
  pending/RTT honestly reported; session invalidated before cleanup, late
  start success compensated by one stop before any new start is admitted,
  unconfirmed remote stop stays `unknown`; no automatic loop/restart; rate
  applied once, web loop only when mapped endpoints are valid, game-side
  rate/seek changes pause and require explicit Play.
- Persistence is settings-plus-opaque-fingerprint only, carried losslessly
  through the existing `contentExtra.music` `_extra` channel; paths/URLs/
  bytes/base64 never persist; fingerprint mismatch requires explicit
  replacement; invalid imports reject atomically; rich timing
  (`bpmMap`/`timeSignatureMap`/`countIn`/`snap`) and six-track content are
  untouched and round-trip byte-stable.
- `web/choreo-music-ui.js` (body-level Chinese panel, new): local file
  selection, play/pause/resume/stop/seek, fingerprint-based reselection with
  explicit replacement, beat bar with numeric targets, game actions through
  the shared `apiFetch`; two script tags in the HTML shell and a CSS panel
  block; repository dist twins byte-identical (integrity-disclosed).
- Recovery-run test repair B3 (no product bytes): `web/test-music.js` browser
  pre-roll assertion now follows the AC-1 clamp oracle exactly and integrity
  re-binds to the fresh run id (19→21 assertions; no tolerance widened, no
  coverage removed).
- repair2 (product, 1/2 budget): UI display sampling 100 ms→50 ms in
  `web/choreo-music-ui.js` + dist twin — the mapping formula `T=A-O` is
  unchanged; the browser scenario adds a 250 ms post-pre-roll settle wait.
  Root cause was a display-tick race at the ±100 ms tolerance boundary, not a
  mapping defect; browser then passed 21/0 three consecutive runs.

## Verification actually observed

- Gate `GATE-RUN-20260910-MUSIC-BEAT-FOUNDATION-R5-2` (every check exit 0):
  clock 29/0, beats 48/0, game 22/0 (delays 0/200/2000), lifecycle 15/0,
  persistence 12/0, boundaries 19/0, integrity 11/0, browser 21/0 ×3 (36
  synthetic network intercepts, zero real traffic), shell 62/0, engine 47/0,
  edit 402/0, check 93/0, projects 105/0, document 120/0, docwire 56/0,
  showcompiler 43/0, library 318/0; `pipeline-cli check` PASS;
  `git diff --check` clean.
- Quality evidence v2: one acceptance-coverage entry per AC (8/8), six
  red-green records re-verified on disk against the declared plans,
  REG-BROWSER bounded-unavailable with green BROWSER, REG-INTEGRITY
  characterization binding MUSIC-INTEGRITY/LEGACY-SHELL/ARTIFACT/SCOPE.
- Reviews: module APPROVE — independent replay 47/47
  (`review-module-ch-module-replay.js` sha256 `2375fb47…`, exit 0) across
  BPM=137/H=251/O=−499 arithmetic, exact loop/media edges, rich-timing
  round-trip, hidden pause and reversed completions; global APPROVE —
  watchdog-guarded replay exit 0 across stop/new-Play races, both late-start
  completion orders, timeout/status-ahead-during-seek, no local revival,
  unknown remote state, history/twin independence. Both bind the same gate
  hash; each lane's challenge is attempted and not falsified.
- Attribution (exact, baseline `baedc39b…`): 8 changed files +212/−11 against
  budgets 30 files / 1500 lines; active ≈26.6 min ≤ 90; repairAttempts 1/2.

## Remaining owner tails and why

- None new; the five standing owner tails are unchanged and live roots stay
  pre-deploy (repository dist twins only — deployment needs owner
  authorization).
- P3 non-blocking follow-ups disclosed in reviews/CHG (not conditions of
  approval): one GBK-mojibake duplicate of the music-panel CSS comment at
  `web/choreo-helper-app.css:389` in both twins, introduced in the original
  build window before the recovery claim baseline — a follow-up micro ticket
  should rewrite the comment in UTF-8 in one edit; the `fpOf` late-completion
  ordering note (no silent rebind reproducible; explicit-replace surfaces);
  and a pre-existing 61-byte stray file named `' + $out + '` at the
  repository root (mtime 2026-09-06, outside every write scope, shell-quoting
  debris from an earlier session).
- REQ-SPEC-009 stays open by design: waveform, auto-BPM, variable
  tempo/meter, count-in, snapping and any accuracy claim remain later
  increments; live music-beat acceptance against real audio stays with the
  owner per the ticket's non-goals.

## Files changed

- Product (recovery-run claim-baseline relative): `web/choreo-music-ui.js` +
  dist twin (repair2 sampling), `web/test-music.js` (B3 + repair2
  assertions).
- Increment footprint in the working tree since pre-ticket (quarantined
  original build, re-verified by global review; CHG record lists ten files):
  `web/choreo-music.js`, `web/choreo-music-ui.js`, HTML shell, CSS panel
  block, each with byte-identical dist twins, plus `web/test-music.js` and
  `web/test-shell.js` additions.
- Evidence: `.agent/evidence/TASK-20260909-MUSIC-BEAT-VERIFY/` — two gates
  (failed first + passing `-2`), two APPROVE reviews with counterexample
  replays, six `red/` records, four `r5/implementation/` files, run-bound
  logs.
- Process: ticket accepted→closed,
  `.agent/runs/history/RUN-20260910-MUSIC-BEAT-FOUNDATION-R5.json`
  (completed), `CHG-TASK-20260909-MUSIC-BEAT-VERIFY-R5.json` (web-product),
  `.agent/PROCESS-STATE.json` (order 51, latest product handoff),
  `.agent/portfolio-map.json` (S-MUSIC-FOUNDATION link), `.agent/CONTINUITY.md`,
  generated `docs/AI-BACKLOG.md` row, this handoff.
