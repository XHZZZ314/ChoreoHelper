# HANDOFF — Per-dancer profile binding contract + read-only bindings seam (character assets P1)

Package: TASK-20260903-CHARACTER-ASSETS-P1-BIND (revision 2, R3, standard lane, tags
cross-module/persistence/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P1-BIND
(completed, 0 repair attempts) · 2026-09-04 · Modules: web-product · Reviews: module +
global, both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P1-BIND.

## Objective and acceptance

The P1 slice of the owner-approved character-asset v1 design (`docs/DESIGN-character-assets-v1.md`
sections 1/5): a per-dancer character-profile binding data contract on the performance document —
a `profileId` reference on the canonical performer and the legacy dancer projection that
round-trips losslessly in both directions while binding-free documents stay byte-stable — plus one
pure node-testable resolution rule and a read-only per-dancer bindings observation seam on the
ready 3D preview panel computed by that same resolver. Deliberately out of scope (P2–P6 per design
section 12): binding-entry UI, per-dancer rendering/stand-in/notice changes, per-dancer clip
namespaces, store/schema changes, import UX, sharing, 1–8 dancer acceptance. AC-1..AC-8 all
passed; the red mechanism and counts below are the accepted evidence.

## Mechanism / red baseline

- `web/test-document.js` new §14 suite failed on unmodified source exactly 4/110
  (`red-test-document.txt`): the legacy projection dropped a canonical `performer.profileId`,
  `migrateContent` parked a valid legacy `dancer.profileId` in the `_extra` unknown-key channel,
  and a dangling reference was lost. All pre-existing assertions stayed green — the failure was
  the missing carry, not a broken baseline.
- `web/test-edit.js` red baseline (`red-test-edit.txt`): `ChoreoEdit.pure.resolveBindings` did
  not exist; the new §13/§14/§15 cases failed on the missing export before implementation.

## What changed and behavior preserved

- `web/choreo-document.js` (+9/-0): `migrateContent` lifts a non-empty-string legacy
  `dancer.profileId` out of `_extra` onto the canonical performer; `toLegacyContent` projects a
  canonical `performer.profileId` onto the projected dancer as the same-name key. Absent, empty
  and non-string values are not bindings: nothing is projected, legacy unknowns keep riding
  `_extra`, and the key is never synthesized, so binding-free documents stay byte-stable.
- `web/choreo-edit.js` (+26/-0): pure resolver `ChoreoEdit.pure.resolveBindings(dancers,
  knownProfileIds, activeProfileId)` returning an order-aligned view with states
  `default` (absent/empty/non-string → activeProfileId), `none` (same with no active profile),
  `bound` (known id → itself) and `missing` (unknown id → nothing, never a silent rebind).
  Membership uses `indexOf`, so prototype key names cannot false-hit; no input mutation, no
  library/DOM/global access, deterministic. `copyDancerTracks` is untouched and never copies,
  clears or overwrites either dancer's binding (AC-4).
- `web/preview3d.js` (+21/-0): read-only `__p3dDebug().bindings` computed by that same resolver
  over `window.store.dancers`, a module-private known-profile-id cache (refreshed at panel init
  completion and `__p3dProfilesChanged` — the same lifecycle points as the profile dropdown) and
  the panel's active profile id. No binding-entry UI, no rendering/clip-resolution/notice change:
  preview output is identical whether or not bindings exist.
- `web/choreo-library.js`: zero diff (AC-5 collision protection held — DB_VERSION 2, CHLB v2
  envelope untouched, no new public API member). `web/test-library.js`: zero diff.
- Tests: `web/test-document.js` +50 (§14 round-trip suite), `web/test-edit.js` +92 (§13 resolver
  matrix, §14 copy invariance, §15 missing→bound recovery).
- All three changed product sources are byte-identical to their `web/dist/ChoreoHelper` twins
  (SHA-256 in the gate `scope:dist-twins` check; AC-8). Pure-legacy v0.7 saves and six-track
  `_doc` carriers ride through unchanged; zero deleted lines anywhere, so no pre-existing
  assertion was modified or weakened (AC-2 verified at diff level by both reviewers).

## Verification actually observed

Gate `GATE-RUN-20260903-CHARACTER-ASSETS-P1-BIND` passed all 19 required checks, 0 repairs,
budgets 10 changed files / +468 lines / 32.3 active minutes (caps 15/900/90). Suite results:
`test-document` 110/0 (baseline 101 + 9 new), `test-edit` 168/0 (145 + 23 new), `test-library`
91/0 unmodified, engine 47/0, check 83/0, projects 105/0, docwire 54/0, showcompiler 42/0,
shell 45/0; `offline-verify all` 50/0 after one immediate flake-discrimination re-run (first run
49/1 on the single timing-sensitive initrace baseline precondition `init#1 就绪且下拉含两套档案`,
fingerprint observed once, all functional assertions after it green — no circuit break, both
reviews saw the disposition); `library-verify all` 150/0 first try; `clipcheck-run` 148/0
(workspace dist + game-root smoke); `pipeline-cli check` PASS; `process-audit --check` 25/25;
`git diff --check` clean. AC-7 browser probe on the real `file://` page: 9/9
(`browser-probe-bindings.txt`) — default/bound/missing aligned with `store.dancers` order, equal
repeated reads, zero writes to store/library/localStorage, rendering snapshot unchanged;
temporary probe deleted per the self-test mandate. Both reviewers independently recomputed the
attribution diff against the claim-time baseline, re-verified all four twin hashes, and re-ran
the document/edit/library suites.

Review findings were all `info`, none requiring code change: (1) a reverted pre-P1 build drops a
canonical `profileId` only when round-tripping through legacy projection — pre-existing semantics
for unknown canonical performer keys; P2/P3 add writers and own mixed-version durability;
(2) the seam's known-id cache is eventually consistent with the library (refresh points above) —
acceptable for a read-only seam, P3 owns its refresh policy; (3) the initrace flake disposition
(register as a process event if it recurs); (4) post-gate `measure` growth (12 files/+750) is
evidence artifacts only, not scope growth. The module reviewer additionally verified by direct
old-vs-new differential that binding-free fixtures — including empty-string/null `profileId`
shapes riding `_extra` — serialize byte-identically across both code versions.

## Remaining owner tails and why

- No new owner tail. P1 adds no user-visible behavior, so there is nothing to accept beyond the
  recorded probe/gate evidence.
- Deploy note (informational, no action now): both live install roots still carry pre-P1 web
  bytes; the next owner-authorized whole-tree copy carries P1 together with the pending local-auth
  web work. There is no user-visible difference until P2/P3 land.
- Non-actions: no live-install copy, no release-staging rebuild, no snapshot regeneration, no
  commit/push/publish in this run.
- Rollback: revert the eight listed files as one unit; no data conversion (no migration step, no
  document/library rewrite; older readers ignore the unknown key).

## Files changed

Run-attributed (8 paths, +198/-0 in sources and tests, gate-time measurement 10 files/+468
counting the three synced twins):
`web/choreo-document.js` (+9), `web/choreo-edit.js` (+26), `web/preview3d.js` (+21),
`web/test-document.js` (+50), `web/test-edit.js` (+92),
`web/dist/ChoreoHelper/choreo-document.js`, `web/dist/ChoreoHelper/choreo-edit.js`,
`web/dist/ChoreoHelper/preview3d.js` (twins). Full detail:
`.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P1-BIND.json`; gate and
reviews under `.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P1-BIND/`.
