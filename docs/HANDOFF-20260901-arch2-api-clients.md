# HANDOFF — Paired 48794/48795 web API clients without contract change (ARCH-2 API-CLIENTS)

Package: TASK-20260901-ARCH2-API-CLIENTS (revision 2, R3, standard lane) · Run
RUN-20260901-ARCH2-API-CLIENTS (completed) · 2026-09-02

## Objective and acceptance

Per the accepted ticket: introduce one classic-script client module `web/choreo-api.js` with paired
clients for the 48794 playback/show API and the 48795 recording/export API, migrate the enumerated
web callers onto it, and prove that request lifecycle, wire traffic, diagnostic interception,
file:// offline behavior and deploy/whitelist integrity stay byte-compatible with today's plugin
and file:// entry. AC-1..AC-5 map to the suites named in the ticket; both lanes (module + global)
approved on independent re-verification against gate R2. No endpoint, method, payload, timeout
duration, cadence or plugin (C#) change — the ticket's non-goals held.

## Mechanism / red baseline

- Pass 1 extracted the client but the module review returned REQUEST_CHANGES with three high
  findings: the 48795 side exposed only raw seams (no high-level boundary), timeout and caller
  cancellation were not composed into one AbortController (a live-reproduced HUNG_AFTER_TIMER case
  where a settled request left a timer armed), and the failure matrix under-covered 401/pairing/
  supersede paths. Red evidence: the review's HUNG repro; test-api at 36 cases.
- Repair (1/2 attempts used) composed timeout×signal into one effective AbortController observed by
  fetch with timer and external-listener cleanup on both settle paths, added the `export.api`
  high-level boundary, and grew test-api 36→52 cases; the HUNG repro is now a bounded regression
  assertion that fails as HUNG if it regresses.
- Twin-drift red check: after editing sources but before syncing the deploy twin, test-shell went
  41/4 and returned to 45/0 after the byte sync — the twin checks demonstrably catch drift.

## What changed and behavior preserved

- New `web/choreo-api.js` (classic IIFE, no DOM/localStorage/IndexedDB access): owns both base
  URLs; `game.api`/`game.preview` reproduce the former `apiFetch`/`apiPreview` semantics verbatim
  (fixed 4000ms timeout, 403 pairing handler with exact Chinese text, e.status/e.detail mapping,
  2xx JSON); `game.raw` stays only for the anonymous /capabilities probe.
- New `export.api` 48795 boundary: provider token header (capsOk-gated; no provider = legacy
  compatibility mode), NO default timeout (recording's long-blocking calls stay unbounded; probes
  pass 3000/4000ms explicitly), 403 classified as e.status=403+e.pairing WITHOUT prompting (silent
  probe degradation preserved; prompting stays with the one caller that had it — recRecordOne),
  non-2xx thrown as e.status/e.detail(message-priority)/e.body so callers keep reading the plugin's
  short error code verbatim. `export.raw`/`rawUrl` remain only for the model/binary asset seam.
- Migrated callers: choreo-app.js (probeExport, autoSyncLibrary), choreo-recording-ui.js (7 sites),
  choreo-check-ui.js (skeleton probe), choreo-library.js (syncFromPlugin; its standalone
  localStorage secHeaders helper became dead code and was removed), preview3d.js (skeleton probe,
  10s light probe, getclip, recheckMissing). A static scan proves zero localhost:48794/48795
  literals and zero ChoreoAPI.export.raw( call sites remain in the seven enumerated consumers.
- Shell and inventory: choreo-api.js loads first in `choreo-helper-app.html` and the dist twin;
  `WEB_FILES` in make-release-staging.js gained exactly one line (choreo-api.js); test-api.js is
  absent from dist and inventory.
- Preserved without diff: clip-check.html (it stubs window.apiFetch/window.fetch and the client
  resolves global fetch at request time), choreo-show-ui.js and choreo-lyrics-ui.js (apiFetch
  globals), pose-viewer.html and Node-side operational scripts (ticket non-goal), src/** (zero
  changes), live deploy roots (untouched). Wire contract, pairing authority, CORS, token lifetime,
  retry policy (none), timeout durations and polling cadences are all unchanged. Three latent
  wording micro-deltas in paths unreachable against the current ExportServer (non-JSON error
  bodies) are disclosed in the module record's nonChanges/knownRisks; ok/fail outcomes are
  unchanged.

## Verification actually observed

- Deterministic gate R2 passed 24/24 checks (cycle 2, re-gate of R1 after the review repair; repair
  1/2 used) with all 16 ticket.testPlan commands green: test-api 52/0 (+16 vs pass-1), test-shell
  45/0, test-engine 47/0, test-edit 145/0, test-check 83/0, test-projects 105/0, test-document
  101/0, test-docwire 54/0, test-showcompiler 42/0, test-library 91/0, clipcheck-run 148/0
  (diagnostic interception intact), offline-verify all 45/0 (file-mode + online transition +
  diagnostics), library-verify all 149/0 against the REAL 48795 plugin (live wire evidence),
  pipeline-cli check PASS, process-audit 22/22, check-ai-docs 58/58. Gate artifact:command-fidelity
  re-parsed 16/16 plan commands equal to ticket.testPlan and re-hashed 23/23 evidence logs.
- Independent reviews: module lane APPROVE (REVIEW-…-MODULE-R2, supersedes pass-1 REQUEST_CHANGES)
  and global lane APPROVE (REVIEW-…-GLOBAL-R2), both re-derived from source at HEAD ab015e58, not
  from the Worker summary; sha256 twin identity re-verified 7/7 byte-identical; git status shows no
  live-root path and no prohibited-path tracked change.
- Budget deviation, disclosed: run wall clock reached 567 min against the 90-min budget (468 min
  idle while the owner-side review lanes and concurrent GOVERNANCE-CONVERGENCE conversation
  proceeded). No new work happened after evidence completion; the breach is owner-side latency, not
  extended scope. The concurrent owner activity touched only .agent ticket/interrupt history; run
  context hashes matched the manifest pins 7/7.

## Remaining owner tails and why

- Live deploy (owner-authorized whole-tree copy of web/dist/ChoreoHelper to both live roots) is not
  done: ticket non-goal and AGENTS.md gate. The changed files are a superset of SIX-TRACK's; the
  merged SIXTRACK-DEPLOY owner tail covers both. Deploy must be whole-tree — a partial copy fails
  loudly (ChoreoAPI undefined) rather than misrouting.
- Global review LOW finding G1 (non-blocking), routed to closeout and recorded here and in
  continuity: this run edited `scripts/make-release-staging.js` (one WEB_FILES line, owned by AC-4)
  which MODULES.json assigns to release-product, while the ticket declared only web-product as
  impacted. The inventory content is verified correct; future tickets editing
  `scripts/make-release-*.js` should declare release-product in impactedModules (or the owner
  accepts the single-module declaration as done here).
- No in-game acceptance is newly required: the plugin is unchanged; library-verify exercised the
  real 48795 server green.

## Files changed

web/choreo-api.js (new), web/test-api.js (new), web/choreo-app.js, web/choreo-recording-ui.js,
web/choreo-check-ui.js, web/choreo-library.js, web/preview3d.js, web/choreo-helper-app.html,
web/test-shell.js, scripts/make-release-staging.js, plus the byte-identical web/dist/ChoreoHelper
twins of the seven product files (choreo-api.js, choreo-app.js, choreo-recording-ui.js,
choreo-check-ui.js, choreo-library.js, preview3d.js, choreo-helper-app.html) — 17 files total, all
inside writeScope/lockScope; full inventory in
`.agent/modules/web-product/changes/CHG-TASK-20260901-ARCH2-API-CLIENTS.json`.

## Owner-authorized live deploy (2026-09-02)

The owner authorized the pending live sync (「先同步吧」, covering SIX-TRACK's superset per the
merged SIXTRACK-DEPLOY tail). Pre-flight: all 24 shared dist files byte-identical to `web/`
sources; both live roots held pre-ARCH2 bytes (choreo-api.js absent) with 37-file sets identical
to source except the new file. Deploy: whole-tree copy `web/dist/ChoreoHelper/` → devPlugins and
game roots (GAMECLOCK pattern, no deletes). Verified: `diff -r` clean on both roots except the
pre-existing live-only `choreo-recording-ui.js.pre-gameclockdeploy.bak` backups (kept); sha256 of
choreo-api.js / choreo-helper-app.html / choreo-recording-ui.js / preview3d.js match across
repo/dev/game; both deployed htmls load choreo-api.js first. The SIXTRACK-DEPLOY tail is resolved;
GAMECLOCK AC-10 in-game acceptance is unchanged.
