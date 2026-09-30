# HANDOFF — Clip namespaces plus content-hash reuse (character assets P4)

Package: TASK-20260903-CHARACTER-ASSETS-P4-NAMESPACE (revision 3, R3, standard lane, tags
cross-module/persistence/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P4-NAMESPACE
(completed, 0 repair attempts) · 2026-09-05 · Modules: web-product · Reviews: module + global,
both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P4-NAMESPACE-R2.

## Objective and acceptance

Design-doc sections 7 and 8 slice on the closed P1/P2/P3 state: clip identity becomes the
composite `(profileId, name)` with active-default and missing-returns-null semantics and zero
silent cross-profile borrowing; identical model bytes are stored once under a content-addressed
payload (`mblob:<sha256>`) referenced by per-profile rows and reclaimed only when the last
surviving reference goes; the single cross-profile path is one explicit user-confirmed
per-dancer copy (Chinese wording, cancel-safe, target re-stamped with the target skeleton
hash); preview and health-check resolve each dancer against its own namespace with a stand-in
plus Chinese per-dancer notice when the clip lives only in another profile. DB_VERSION stays 2
and the CHLB v2 envelope/BUNDLE_VERSION/librarySchemaVersion are untouched. AC-1..AC-11 all
passed via gate R2 plus both review lanes; counts and probes below are the accepted evidence.

## Mechanism / red baseline

At the claim baseline the P4 surface did not exist: `allClipIndex`/`copyClipToProfile` were
undefined, `putProfileFile` accepted a non-string name and a zero-byte blob, and every written
byte landed inline per profile (no `mblob` family, no reclamation) — each new
`web/test-library.js` suite 26–34 assertion fails against the baseline blobs (red mechanism in
the CHG tests row). Gate history: R1 failed on two `offline-verify all` flakes with distinct
fingerprints (`transition`, `initrace`) and no source/ticket/policy byte change between gates;
both were green in standalone reruns and R2 ran the same command full-green 50/0. The flake is
recorded as `EVT-20260905-offline-verify-flake-mto7zvo2` in `.agent/process-events.jsonl`.

## What changed and behavior preserved

- `web/choreo-library.js` (+210/−42): model bytes content-addressed — one payload row per
  SHA-256 under `mblob:<hash>` while each `pfile:<pid>:<name>` row becomes a reference row;
  legacy inline rows keep reading through a ref-resolution fallback. Writers
  (putProfileFile/importModelSet/createProfile-with-files) commit payload + reference + meta in
  one transaction (payload only-if-absent, so repeat imports are idempotent), then reclaim
  unreferenced payloads via survivor computation (`gcBlobRows`, no stored refcounter).
  `putClip`/`putProfileFile` reject empty/non-string names and zero-byte blobs with Chinese
  reasons and zero writes. New members: `allClipIndex()` and
  `copyClipToProfile(name, fromPid, toPid)` — the only cross-profile clip path (atomic, source
  rows byte-unchanged, target re-stamped with the target skeleton hash, pending never a
  source). `exportBundle` expands references to inline bytes (no mblob rows exported, envelope
  untouched); `importBundle` re-dedupes through the normal write path.
- `web/preview3d.js` (+51/−16): `buildMasters` gains a namespace precheck (after the existing
  `hasAnyBinding` early return, so no-binding sessions stay byte-identical) — a bound dancer
  whose action name exists only in another profile's namespace deterministically falls back to
  the stand-in with a Chinese per-dancer notice (dancer, missing action, holding profile, bone
  count + fingerprint prefix, 「没有借用」); `__p3dDebug().notices` exposes the read-only view
  with per-dancer reason `missing-clip-ns`.
- `web/choreo-check.js` (+69/−5): `normCtx` accepts optional namespace context (absent = old
  verdicts exactly, node suites unmodified); `checkMissing` resolves per dancer's namespace,
  `checkClipSkeleton` compares per dancer-bound fingerprint, and new rule 11
  `checkNamespacedClips` emits `missing-clip-ns` issues carrying copyFrom/copyTo/clipName.
- `web/choreo-check-ui.js` (+74/−3): `fetchNamespaceCtx` (same 30 s cache discipline as the
  index cache; modal always force-refreshes) feeds realtime/modal checks; the modal renders one
  「复制动作」 button per `missing-clip-ns` row behind a Chinese confirm — cancel writes
  nothing, success calls `copyClipToProfile`, invalidates both caches, notifies
  `__p3dLibChanged` and reopens the report.
- `web/test-library.js` (+300/−3): new suites 二十六–三十四 (isolation, lookup
  defaults/rejections, explicit copy, dedupe, refcounted delete, abort injection, concurrency,
  CHLB v2 round-trip, store-key allowlist) plus the intent-preserving split of suite 二十四's
  files-store key assertion (pfile/reference rows keep the original comparison verbatim; the
  new assertion pins the mblob payload family to exactly the expected hashes with the replaced
  payload reclaimed).
- The four changed product sources are byte-identical to their `web/dist/ChoreoHelper` twins
  (SHA-256 re-verified by gate and both reviews); `web/choreo-library-ui.js` is byte-unchanged
  and correctly absent from the change set. No engine/document/docwire/api/app/shell byte
  changed; no new endpoint, no network IO on any P4 path; the two live install roots were
  verified untouched (0 P4 markers). The Worker's touch of the pre-existing
  `CHG-TASK-20260902-M1-3D-WORKSPACE-CAMERA.json` record is CRLF/LF noise only (zero diff
  under `--ignore-cr-at-eol`) and is left as-is per module review.

## Verification actually observed

Gate R2 passed all 21 required checks: engine 47/0, edit 212/0, check 83/0, projects 105/0,
document 110/0, docwire 54/0, showcompiler 42/0, library 204/0 (baseline 152/0 + 52 new,
DB_VERSION=2 asserted), shell 45/0; `offline-verify all` 50/0 (both R1 flake scenarios green);
`library-verify all` 150/0 (real 48795 plugin, bone-match 101/101); `clipcheck-run` 148/0
(workspace dist + game-root smoke); `pipeline-cli check` PASS; `process-audit --check` 25/25;
`git diff --check` clean. Browser probe 19/0 on the real `file://` dist page (one-shot Chrome
profile, probe script deleted, evidence `gate-probe-p4ns.md`): AC-9 — distinct fingerprints
per session, dancer A on its own master (`reason=null`), dancer B on the stand-in with
`missing-clip-ns` + Chinese notice, per-dancer clip identity at t=2 s (A own clip, B
`__idle__`), same-content model set imported into two profiles shares one hash; AC-3 — health
check shows the notice + one copy button, cancel = exactly one confirm and zero writes into
profile B, confirm = byte-equal copy re-stamped with B's skeleton hash with A byte-unchanged,
exactly two confirms per session with no auto-apply, the entry disappears after copying.
Budgets (gate-time shared measure authority over lockScope): 3 files +543/−42 (≤ 14 files /
900 lines), 0 repairs (≤ 2), 40.4 active minutes (≤ 90); worker business change
`web/choreo-library.js` +210/−42. The later `RUN_LINE_BUDGET_EXCEEDED` status warn (+925) is
added review/gate evidence artifacts under the ticket-declared `.agent/evidence/**` path only;
the global review dispositioned it as advisory evidence growth, not product scope, and no
repair was made.

## Remaining owner tails and why

- [TAIL:CHARASSETS-P2-LIVE] broadened to the combined P1–P4 deploy unit (now also
  `choreo-check.js`/`choreo-check-ui.js`): both live roots still carry pre-P2 web bytes and
  every probe used synthetic fixtures. Next authorized deploy: copy the twin pairs into each
  live root as one unit, import one real Meddle export, exercise one two-profile session;
  REQ-SPEC-054 needs that real acceptance; REQ-SPEC-056 waits for the P6 1–8 dancer sweep.
- P5 (`.choreochar` share) and P6 (1–8 dancer acceptance) remain DEFERRED pending owner
  enable; REQ-SPEC-055 rides P5.
- Non-actions: no live-install copy, no release-staging rebuild, no generated-asset
  regeneration (none changed), no commit/push/publish in this run.
- Rollback: revert the nine files below as one unit. Namespace rows are ordinary v2
  composite-key records a pre-P4 build already reads profile-scoped; deduped payloads degrade
  to per-profile reads (a reverted build may re-duplicate on next write but never loses bytes
  while one profile reference remains); no document shape changed, so no data conversion.

## Files changed

9 files: `web/choreo-library.js` (+210/−42), `web/preview3d.js` (+51/−16),
`web/choreo-check.js` (+69/−5), `web/choreo-check-ui.js` (+74/−3), `web/test-library.js`
(+300/−3) plus the four byte-identical `web/dist/ChoreoHelper/` twins. Full detail:
`.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P4-NAMESPACE.json`;
gate rounds R1–R2, both reviews, the browser-probe record and worker baseline under
`.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P4-NAMESPACE/`.
