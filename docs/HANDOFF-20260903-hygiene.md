# HANDOFF — Verified dead-code, harness, comment and rendering cleanup batch (HYGIENE)

Package: TASK-20260903-HYGIENE (revision 2, R3, standard lane, tags cross-module/cleanup/
dead-code/rendering/harness) · Run RUN-20260903-HYGIENE (completed) · 2026-09-03 ·
Modules: web-product, plugin-product · Reviews: module + global, both APPROVE.

## Objective and acceptance

One bounded cleanup batch with a zero behavior-contract change: retire dead web identifiers and the
write-only gpose storage key, stop the preview rAF loop when its panel closes, render the play
overlay only when its observable content changes, remove payload-dumping debug logs, correct
comments that disagree with shipped behavior, restructure the ExportServer busy gate so no acquired
RecGate can be abandoned, URL-escape the NetEase songId, report the real game version in the
unchanged gameVersion field shape, delete the dead BreakStanceLock method, bound every CDP send()
with a timeout, fold three stray harness temp-profile cleanups into the common module, and drop the
unused trim-loop `--min` parse and the mock-listen hang. AC-1..AC-13 map to the routed matrix below;
both review lanes approved against the same cycle-4 gate.

## Mechanism / red baseline

- Closed preview panel: `toggle(false)` only removed the open class while `tick()` kept chaining
  `requestAnimationFrame`, so `window.__p3dDebug().tickOn` stayed true and the loop stayed armed
  while rendering nothing. AC-1 was proven by a real red→green: the new workspace scenario samples
  `tickOn` twice across the closed interval and again after reopen.
- Play overlay: `updatePlayOverlay` rewrote `#playOverlay.innerHTML` on every play tick even when
  the active item set was unchanged. The first implementation used a module-level cache and failed
  3 of the 7 new assertions — `render()` recreates the `#playOverlay` node (health-check render
  ~800ms after play start), which desynced a module-level cache. Moving the cache onto the element
  itself (`ov._poHtml`) makes node recreation self-healing; the test keeps genuine regression value.
- `ExportServer.HandleClipSync` returned a busy response after `RecGate.Wait(0)` succeeded and
  before the covering `try/finally`, a path that would abandon a held semaphore. It was never
  reproducible (race-only), so the fix was verified by static structure, not by a red test.
- Harness hangs (CDP `send()` with no response, mock `listen` with no rejection) were likewise not
  reproduced: the timeout and the error handler are structural fixes proven by inspection plus green
  normal runs.
- Environment flakes observed and attributed, never silently retried past the circuit rules:
  `library-verify` `hasClips` fails with the game online and passes game-closed on the mock path
  (150/0, owner Option A, ESCALATION-...-CYCLE2); `offline-verify` timing checks gave 2x49/50 with
  the game loaded and 50/0 in a quiet idle-online window (owner verbatim `A`,
  ESCALATION-...-CYCLE3, one authorized attempt consumed successfully).

## What changed and behavior preserved

- `web/preview3d.js` + dist twin: `toggle(false)` drops `_rafOn` exactly like the `visibilitychange`
  hide path, `tick()` returns before re-arming when `!_rafOn`, init completion arms only
  `if (visible)`, and reopen takes the existing `resizeCanvas()+startTick()` path. Camera state and
  panel bounds survive; `__p3dDebug().tickOn` now reports `false` throughout the closed interval.
- `web/choreo-app.js` + dist twin: `updatePlayOverlay` writes `innerHTML` only when the rendered
  string changes (cache on the element); `addGlobalLyric` (zero callers) deleted; the three
  payload-dumping `console.log`s in `gameStartPlay` (full clips array, raw response, clip-details
  dump) deleted; three stale comments corrected (seek-merge 50ms drag gate, snapTime 300s grid
  candidate cap, resize-left enforce-min-then-snap) — comment-only hunks, no executable line moved.
- `web/choreo-library.js` + dist twin: the write-only `_profListCache` declaration deleted.
- `web/choreo-recording-ui.js` + dist twin: the never-read `choreo_gpose` localStorage write deleted;
  the toggle still assigns `store.gpose` from the server response, renders and toasts.
- `src/Exporter/ExportServer.cs`: `HandleClipSync` checks `_batchRunning` before `RecGate.Wait(0)`,
  matching `HandleVerify`; the first statement after a successful Wait is the covering
  `try/finally`. Both busy strings survive verbatim.
- `src/HttpServer.cs`: `Uri.EscapeDataString(songId)` at the single outbound NetEase lyric URL;
  `GetGameVersion` reads the Lumina `ffxiv` repository version (compile-verified) with the unchanged
  `unknown` fallback; field name and both response shapes untouched.
- `src/AnimationPoseFreezer.cs`: the private zero-caller `BreakStanceLock` method, its doc comment
  and its catch handler deleted as one block (`_idleTimelines` retained).
- Harness scripts: identical 15000ms per-command CDP timeout wrappers in `offline-verify.js`,
  `library-verify.js` and `clipcheck-run.js`; `vclean.register(proc, profile)` added to
  `fix1-web-verify.js`, `profile-look-check.js` and `restore-bundle-check.js`; the dead `--min`
  parse and its usage text removed from `trim-loop-clips.js`; the library-verify mock listen promise
  now rejects with an explicit port error.
- Preserved: no HTTP route, verb, JSON field name, response shape, document schema, persistence
  format or protocol version changed anywhere; overlay content and ordering for any given state are
  byte-identical (the muted-dancer listing included); the gpose badge still derives solely from the
  server response and the `/gpose/state` poll; trim-loop idempotence is untouched (`LOOP_MIN_SEC`
  17 was already the effective constant, the `--min` removal is parse-only); every owner-modified
  prohibited file (`web/choreo-api.js`, `web/choreo-lyrics-ui.js`, `web/choreo-helper-app.css`,
  `web/test-api.js`, `web/test-lyrics.js`, `src/LocalApiSecurity.cs`,
  `src/tests/datalayertest/program.cs`) carries zero HYGIENE edits.

## Verification actually observed

- Gate `GATE-RUN-20260903-HYGIENE-CYCLE4` (status passed, 0 repair attempts across four cycles):
  tp01–tp08 eight fast pure suites green; tp09 `offline-verify all` 50/0 fresh in the authorized
  quiet game-online window; tp10 `library-verify all` 150/0 (mock path per the cycle-2
  authorization); tp11 `clipcheck-run` 148/0 with the timeout wrapper active; tp12 datalayertest
  401/0 plus Release build 0 warnings / 0 errors; tp13 `pipeline-cli check`, tp14 `process-audit
  --check` 25/25, tp15 `git diff --check`; supp-01 `offline-verify workspace` 70/0 carrying all
  four AC-1 assertions. The other 18 entries were carried from immutable cycle-3 records after
  fresh no-drift pre-checks (ticket SHA unchanged, HEAD == sourceRevision, 4/4 twin hashes
  identical, writeScope mtime scan PASS).
- Independent re-measurement by both reviewers: ripgrep zero matches for `addGlobalLyric`,
  `_profListCache` and `choreo_gpose` across `web/`; zero `BreakStanceLock` under `src/`;
  `Uri.EscapeDataString` at the single outbound lyric URL; `--min`/`MIN_DUR` parse gone;
  SHA256 of the four web twin pairs byte-identical; read-only `web/test-showcompiler.js` 42/0 and
  `scripts/check-ai-docs.js` 60/60 (closeout-adjacent probes by the global lane).
- Known accepted nuances, all info/minor and none requiring code change: the AC-6 reorder makes
  `/export/clip` answer the batch busy message during a running batch (both strings survive, no
  client branches on the text, and it matches `HandleVerify` — module F-1); the only remaining
  `MIN_DUR` text is the explanatory comment documenting its removal (F-2); the new `gameVersion`
  value is compile-verified but not yet observed in-game (F-3); a pre-existing `library-verify`
  rec-flake was observed at baseline too (F-4).

## Backlog section 12 disposition

Every line of the removed `## 12. HYGIENE` section is dispositioned here; nothing was dropped.

| Backlog line | Disposition | Record |
|---|---|---|
| Preview close can leave rAF armed | **done** — AC-1, four new workspace assertions | this handoff + web-product record |
| Stale negative-model notes and sync rejection paths | **re-homed** — touch-time re-check found no demonstrably stale claim in this batch's hunks; stays a standing touch-time instruction | follow-up 15 |
| `updatePlayOverlay` per-frame rebuild | **done** — AC-2, seven MutationObserver assertions | web-product record |
| Play overlay muted-dancer listing | **preserved unchanged** (not a defect; only the write count changed) | follow-up 10 |
| `startRecPoll` dead candidate | **already-resolved** — removed by earlier audit work, only comments remain | ticket nonGoals |
| `addGlobalLyric`, `_profListCache` | **done** — AC-3, zero matches across `web/` | web-product record |
| gpose storage read/write asymmetry | **done** — AC-3, write-only key removed; zero readers, orphan keys harmless (G-8) | web-product record |
| Debug payload logs | **done** — AC-4, console-capture assertion | web-product record |
| Resize-left snap undercut / 300s snap cap / 50ms seek-throttle comment | **done (comments)** + **re-homed (behavior)** — AC-5 corrected the comments; the two behavior edges stay open contracts | follow-ups 1, 2 |
| Selection-copy quantization, paste ordering/negative time, `planActionPlacement` guard | **re-homed** — behavior changes excluded by ticket nonGoals | follow-ups 3, 4, 5 |
| Project-store stale pointers, `savedAt` semantics, slerp normalization, `check(null)` | **re-homed** — not touched, no evidence gathered here | follow-ups 6, 7, 8, 9 |
| Compress oversized headers when touching a file | **re-homed** — no file edited in this batch needed a header rewrite; the touch-time rule stands | standing instruction |
| Remove `/bonerec`/`BoneAnimator` dead arms | **already-resolved** — removed earlier, only comments remain | ticket nonGoals |
| Remove `PackWriter` and remaining audit3 dead paths | **owner-gated** — deferred behind the open EXEC-LIVE tail's live-regression acceptance | tail EXEC-LIVE |
| Unused command verification (`/export/verify`) | **stale** — `web/choreo-recording-ui.js` actively calls it and tests cover it | verified by both lanes |
| Escape NetEase `songId` | **done** — AC-7 | plugin-product record |
| Fix the misleading `gameVersion` field | **done** — AC-8 (value source only, shape unchanged) | plugin-product record |
| JSON-escape bone names defensively | **done as sweep** + **re-homed (found site)** — `ClipCompare` already escapes; the sweep found `src/HttpServer.cs:640` interpolating `clip.Name` unescaped and inconsistent escaping styles (`\"` vs `'`); AC-13 forbids fixing it here | follow-up 12 |
| Restructure the recording-sync early return (semaphore leak) | **done** — AC-6 | plugin-product record |
| CDP `send()` timeouts in the three harnesses | **done** — AC-10 | web-product record |
| Offline-asset fetch timeout | **owner-gated / re-homed** — `scripts/make-offline-assets.js` is a prohibited owner-run generator | follow-up 14 |
| Fold the three stray temp profiles into common cleanup | **done** — AC-11 | web-product record |
| Re-check trim-loop idempotence | **done as verified** — the `--min` removal is parse-only, `LOOP_MIN_SEC` 17 unchanged, re-checked at closeout | global review nonChangesAudit |
| Unused `--min` | **done** — AC-12 | web-product record |
| Mock listen errors | **done** — AC-12, explicit port rejection | web-product record |
| Hardcoded private dev paths before publication | **re-homed** — only pre-existing usage-comment paths remain (`scripts/restore-bundle-check.js:8`, `scripts/trim-loop-clips.js:4`); this batch's added diff lines introduce none; publication is owner-gated | non-actions below |

## Candidate follow-up tickets (never silent fixes)

1. Resize-left snap can undercut the 0.5s minimum duration.
2. Grid-snap search caps at 300s.
3. Selection copy quantizes 0.05-grid placements to 0.1s.
4. Paste ordering and negative-time contracts.
5. `planActionPlacement` silent 60-iteration guard.
6. Project-store stale active pointers.
7. `savedAt` is page-local.
8. Engine slerp normalization.
9. `check(null)` robustness.
10. Play-overlay muted-dancer listing contract (behavior intentionally preserved by AC-2).
11. Rec-flake: the library write is silently skipped when `ChoreoLibrary.available()` is momentarily
    false at clip-finish (module F-4; observed at baseline too).
12. Hand-built JSON escaping: `src/HttpServer.cs:640` interpolates `clip.Name` unescaped, and the
    escaping style is inconsistent across error builders (global G-2).
13. Harness robustness: poll the initrace baseline condition instead of a single post-ready sample,
    and distinguish plugin-busy from plugin-down in diagnostic-page title waits (gate observation).
14. Offline-asset fetch timeout in the owner-run generator (prohibited path).
15. Negative-model notes and sync-rejection comments: touch-time re-check at the next edit.
16. Optional orphan `choreo_gpose` localStorage cleanup (global G-8; harmless, zero readers).
17. QA note: normalize the accepted test plan against the nine fast suites in the matrix
    (`web/test-showcompiler.js` was green but is not in `testPlan`) (global G-6).

## Remaining owner tails and why

- **M1-DEPLOY (updated)**: the four changed web product files are synced to the repository
  `web/dist/ChoreoHelper` twin only; both live roots still hold the pre-M1/pre-HYGIENE bytes. One
  authorized whole-tree copy carries HYGIENE together with M1.
- **Owner observation point (F-3 / G-5)**: after the owner loads a build made from this source,
  `/version` and `/actions` report the Lumina `ffxiv` repository version (or `unknown`); the live
  DLL still answers the old language value today. The corrected value reaches the generated
  `web/dist/ChoreoHelper/catalog-snapshot.js` only when the owner re-runs
  `scripts/make-offline-assets.js` (a prohibited path here); both old and new snapshot values are
  inert display data.
- **EXEC-LIVE**: still gates `PackWriter` and the remaining audit3 dead-arm removal, as the backlog
  requires.
- **Non-actions performed by this run**: no live-install copy to either root, no release staging
  rebuild, no snapshot regeneration, no remote creation, no commit, push or publish. `site/` is a
  whitelist-only stand-in and intentionally keeps pre-HYGIENE content (global G-4).
- **Rollback precision (global G-1)**: revert hunk-level for `web/preview3d.js`,
  `web/dist/ChoreoHelper/preview3d.js` and `scripts/offline-verify.js` — those three also carry
  pre-existing uncommitted owner M1/V071 work that no artifact can restore — and file-level for the
  other fifteen paths. No data conversion is needed.
- **Governance decision (global G-3)**: the owner authorized (verbatim `全部授权`, 2026-09-03,
  recorded in `REVIEW-GLOBAL-RUN-20260903-HYGIENE.json`) editing the single guard line in
  `scripts/check-ai-docs.js` that required the `## 12. HYGIENE` backlog heading, so the section
  could be reduced at closeout without breaking `backlog 无 CLOSED 详细编号区块`. The guard was
  rewritten to assert that the HYGIENE disposition lives in this handoff, and the authorization is
  named here. No other prohibited path was touched.

## Files changed

Run-attributed, all inside the ticket writeScope (18 paths):
`web/choreo-app.js` (+12/-13), `web/choreo-library.js` (+0/-1),
`web/choreo-recording-ui.js` (+1/-1), `web/preview3d.js` (+433/-7),
their four byte-identical `web/dist/ChoreoHelper` twins,
`scripts/library-verify.js` (+28/-3), `scripts/clipcheck-run.js` (+9/-1),
`scripts/fix1-web-verify.js` (+2/-0), `scripts/profile-look-check.js` (+2/-0),
`scripts/restore-bundle-check.js` (+2/-0), `scripts/trim-loop-clips.js` (+2/-2),
`scripts/offline-verify.js` (+593/-4), `src/HttpServer.cs` (+16/-2),
`src/Exporter/ExportServer.cs` (+5/-3), `src/AnimationPoseFreezer.cs` (+0/-20).

`web/preview3d.js` and `scripts/offline-verify.js` (with their dist twin) also carry pre-existing
uncommitted owner M1/V071 work, so their raw totals are not chargeable to this ticket; the mtime
split against the run start is the evidence. Full inventories live in
`.agent/modules/web-product/changes/CHG-TASK-20260903-HYGIENE.json` and
`.agent/modules/plugin-product/changes/CHG-TASK-20260903-HYGIENE.json`.
