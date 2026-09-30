# HANDOFF — Six-track lossless round-trip + eight-performer authoring (SIX-TRACK)

Package: TASK-20260901-SIX-TRACK-ROUNDTRIP (revision 2, R3, standard lane) · Run
RUN-20260901-SIX-TRACK-ROUNDTRIP (completed) · 2026-09-01

## Objective and acceptance

Per the accepted ticket: extend the canonical-document projection, repositories and editor model so
all six track kinds (motion, ability, movement, facing, cue, lyrics) and their documented fields
survive create/edit/save/version/export/import/reload round trips for one through eight performers,
while old one-to-three-performer projects migrate losslessly and preview/execution safely ignores
or rejects unsupported semantics. AC-1..AC-5 map to the suites named in the ticket; every lane
(module + global) approved on independent re-verification.

## Mechanism / red baseline

- The legacy clip/lane projection silently dropped anything it could not express: lane-less tracks
  (ability/movement/facing/cue, orphaned/disabled tracks) and per-event canonical fields outside the
  legacy shape were lost on save/restore. Red evidence: new fixture suites failed before the
  carrier work (test-document +13, test-docwire +9, test-projects +9, test-edit +29, test-check +10,
  test-showcompiler +5 cases all red on the pre-change code).
- Without the pure-legacy exemption, untouched v0.7 projects gained `_doc` carriers on save —
  `library-verify proj` red with 4 unexpected-carrier failures; after the exemption it is 23/0 and
  the v0.7 save shape stays byte-stable.
- Twin check was red on the five changed product files before `web/dist/ChoreoHelper` sync; green
  (5/5 byte-identical) after.

## What changed and behavior preserved

Product (web only; `src/**` zero diff, show protocol/version untouched):

- `web/choreo-document.js` — canonical-only data now round-trips through frozen carriers instead of
  being dropped: lane-less/orphaned/disabled tracks freeze per-track into `_doc.extraTracks` and
  re-enter `doc.tracks` on re-migration; per-event canonical fields (kind/enabled/locked/notes/
  assetRef/createdWith/playMode/points/unknown keys) freeze into `clip._doc` and spread back;
  doc segments projection cannot rebuild (timing/stage/capabilities/metadata/view/schemaVersion>2/
  topUnknown/laneTracks) freeze into `content._doc`; pure-legacy events whose every canonical field
  equals the carrier-free migration defaults produce no `_doc`, so untouched v0.7 saves stay
  byte-stable. Schema version stays 2; future versions remain only-up-never-down.
- `web/choreo-docwire.js` — explicit import of a document with an unknown track kind throws a
  locatable Chinese error before any stored data is touched; the load path keeps
  disable-and-keep semantics so autosave recovery never blocks startup (design §2).
- `web/choreo-projects.js` — a migration failing mid-write no longer consumes the migrated flag
  (`degradedInit(markMigrated=false)`), so retry after correction succeeds; the legacy backup is
  still written first and the source file stays byte-identical on failure.
- `web/choreo-app.js` — authoring cap raised 3→12 (same band as AUD-002 import validation); toolbar
  quick buttons 1–8.
- `web/choreo-check.js` — new info-level `unsupported-kind` capability-report rule
  (`PLUGIN_EXECUTABLE={motion,cue,lyrics}`) names each non-executable kind with a count and
  「完整保留但插件拒绝」 semantics, reading frozen tracks from `_doc.extraTracks` with
  `store.contentExtra` fallback.
- `web/choreo-show-compiler.js` — untouched; it already emitted all six kinds with capability
  requirements from EXEC-CORE. AC-4 added coverage only.

Tests/harness: `web/test-{document,docwire,projects,edit,check,showcompiler}.js` additive sections;
`scripts/clipcheck-run.js` gained the `sixtrack` browser scenario (8 performers, all six kinds,
real save → versioning → confirm-cancel → completed restore → web-mode rehearsal → capability
report). Plugin rejection is the unchanged EXEC-CORE `ShowValidator`/`ShowProtocol`; the
plugin-product change record is a zero-change re-verification (datalayertest 389/0 unchanged).

## Verification actually observed

Gate `.agent/evidence/TASK-20260901-SIX-TRACK-ROUNDTRIP/GATE-RUN-20260901-SIX-TRACK-ROUNDTRIP.json`
(all required checks passed): test-document 101/0 · test-docwire 54/0 · test-projects 105/0 ·
test-edit 145/0 · test-check 83/0 · test-showcompiler 42/0 · test-shell 41/0 · clipcheck-run
148/0 (incl. sixtrack 20/0) · offline-verify all 45/0 (plugin online) · library-verify all 149/0
(plugin online; proj 23/0) · datalayertest 389/0 · pipeline check PASS · process audit 22/22 ·
5/5 dist twins byte-identical · git status: prohibited paths zero changes. Both review lanes
re-ran the seven fast suites and datalayertest with identical counts before approving.

Non-required gate observation (adjudicated by both lanes, not a product regression): with the
plugin offline, `library-verify all` carries a known 148/1 shape — the 「好动作自动进资料库」
check misses one scenario (bow) because harness bootstrap/mock state couples to plugin liveness;
reproduced 2/2 offline, passes 149/0 online, zero diff in the touched path. Recommended follow-up
ticket: make `scenarioRec` deterministic under plugin-offline bootstrap.

Process note: the run exceeded the 90-minute `maxRunMinutes` budget (~3h50m) because session
context was lost and rebuilt across sessions; `repairAttempts: 0`, file/line budgets respected
(17 files / ~1227 of 1500 lines), scope never grew. Disclosed in the module record and both
review verdicts.

## Remaining owner tails and why

- **SIXTRACK-DEPLOY (new tail)**: the five changed product files live only in repo source plus the
  local `web/dist/ChoreoHelper` twin (owner's daily file:// entry already has six-track editing).
  Both live roots (devPlugins, game dist) still hold pre-change bytes with the 3-performer clamp.
  Writing live roots needs owner authorization; when granted, sync the whole tree to both roots in
  one pass (GAMECLOCK deploy pattern; the five files are one coupled deploy set).
- The `offline-verify` scenarios that require a live plugin (online/transition/mode-check/
  clip-check) remain environment-bound as before; they pass with the game online.
- library-verify offline determinism: follow-up ticket recommended above (harness, not product).

## Files changed

`web/choreo-document.js` · `web/choreo-docwire.js` · `web/choreo-projects.js` · `web/choreo-app.js`
· `web/choreo-check.js` · `web/test-document.js` · `web/test-docwire.js` · `web/test-projects.js` ·
`web/test-edit.js` · `web/test-check.js` · `web/test-showcompiler.js` · `scripts/clipcheck-run.js`
· `web/dist/ChoreoHelper/{choreo-document,choreo-docwire,choreo-projects,choreo-app,
choreo-check}.js` (twins, byte-identical) · module change records (web-product, plugin-product) ·
gate/review evidence under `.agent/evidence/TASK-20260901-SIX-TRACK-ROUNDTRIP/` · this handoff.
Zero diff: `src/**`, `web/choreo-show-compiler.js`, `web/choreo-edit.js`, `choreo-helper-app.html/css`,
`web/test-shell.js`. No commit, no live-root write, no staging rebuild.
