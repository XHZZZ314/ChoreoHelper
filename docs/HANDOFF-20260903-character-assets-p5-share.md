# HANDOFF — Single-role .choreochar share (character assets P5)

Package: TASK-20260903-CHARACTER-ASSETS-P5-SHARE (revision 2, R3, standard lane, tags
cross-module/persistence/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P5-SHARE
(completed, 0 repair attempts) · 2026-09-05 · Modules: web-product · Reviews: module + global,
both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P5-SHARE · Owner enable recorded
in `.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P5-SHARE/OWNER-ENABLE.json`.

## Objective and acceptance

Design-doc sections 3 and 11 on the closed P1–P4 state: one profile travels point-to-point as
a privacy-minimal `.choreochar` v1 file with atomic validate-before-adopt semantics — any
failure leaves the receiver library byte-unchanged and the dancer falls back to the stand-in.
The envelope is one self-contained binary with its own `CHRC` magic and format version 1
(distinct from CHLB/v2): 12-byte head, one header JSON with per-segment offset/len/hash, then
raw segments (skeleton JSON, model file bytes, gzip clip data). It travels exactly one
profile's identity block (name, skeletonHash, boneCount), that profile's model files with
per-file SHA-256 and bare filenames, and that profile's `(pid, name)` clip rows as metadata
plus gzip data; other profiles' rows, pending-namespace clips, the global emote catalog,
projects/documents/lyrics/audio, pairing/session/credential material, absolute paths and local
configuration are excluded by construction. Adoption always creates a fresh local profile id
(never merged into a same-fingerprint profile), makes the display name locally unique, never
touches the receiver's activeProfile, stamps clips with the adopted fingerprint in the new
namespace only, and re-dedupes model bytes through the P4 content-hash path. DB_VERSION stays
2, no new object stores, no share-draft rows, CHLB backup semantics byte-stable, no
fetch/upload/endpoint. AC-1..AC-8 all passed via the gate plus both review lanes.

## Mechanism / red baseline

At the claim baseline the share surface did not exist: `createSharePackage` and
`importSharePackage` were undefined, so every new `web/test-library.js` suite (三十五–四十)
aborts against the claim-baseline blobs with `TypeError: ChoreoLibrary.createSharePackage is
not a function` — each new assertion red there and green on the changed source (red mechanism
in the CHG tests row). Single gate pass, no repair rounds, circuit breaker untouched.

## What changed and behavior preserved

- `web/choreo-library.js` (+266/−0): new envelope constants `SHARE_MAGIC "CHRC"` /
  `SHARE_VERSION 1` plus two public members. `createSharePackage(pid)` is a read-only one-shot
  blob build (12-byte head, 64-byte-aligned padded header JSON, then skeleton, model bytes
  expanded from P4 payload rows, gzip clips); refuses unknown pid, `__pending__` and
  skeleton-less profiles with Chinese reasons and zero writes; two creates from an unchanged
  profile yield equal entry tables and byte-equal segments. `importSharePackage(file, opts)`
  validates the whole envelope before any write — magic (including distinct cross-type
  refusal of CHLB backups on the share entry and of `.choreochar` on the backup entry),
  format version, header bounds, every segment offset/len, identity block, duplicate/missing
  names, skeleton-vs-content fingerprint, per-file SHA-256, zero-byte segments, glTF
  external-buffer pairing, per-clip gunzip+JSON+hash — then hits the cancel point (after
  validation, before any write) and adopts in ONE readwrite transaction over
  meta/files/profileClips/profileClipData: fresh pid distinct from every existing id and
  `__pending__`, locally-unique display name on collision, receiver activeProfile unchanged,
  clips stamped with the adopted fingerprint in the new profile's namespace only, `mblob`
  re-dedupe (payload only-if-absent + reference rows), profile row with modelNames; abort
  leaves the store byte-unchanged.
- `web/choreo-library-ui.js` (+40/−4): per-profile 「导出角色包」 button (Chinese refusal
  toast for skeleton-less profiles) downloading `<profileName>.choreochar`, and a toolbar
  「导入角色包」 entry with `.choreochar` picker, Chinese validation progress and the shared
  停止 cancel affordance; adoption fires the existing profile-change notification hooks so
  the 3D panel re-resolves through the existing P3 master/stand-in paths (preview3d.js
  untouched).
- `web/test-library.js` (+406/−0): new suites 三十五–四十 mapping AC-1..AC-7 (envelope parse
  + entry allowlist + excluded-class scan + read-only snapshot equality + refusals; one
  tamper case per failure class with before/after store snapshots; adoption with fresh-id/
  collision/namespace/dedupe/byte-exact read-back; cancel/abort-injection/retry plus
  repeat-import tolerance; concurrency with interleaved transaction resolution; store-key
  allowlist + envelope-constant mutual exclusion + no-network-egress + cross-type magic
  guards).
- Both changed product sources are byte-identical to their `web/dist/ChoreoHelper` twins
  (SHA-256 `b35887a6…` / `5263c759…`, re-verified by gate and both reviews). No
  engine/document/api/shell/preview byte changed; no CHLB export/import body edited; no new
  endpoint, no network IO on any share path; both live install roots verified untouched.

## Verification actually observed

Gate passed all 21 required checks: library 289/0 (claim baseline 204/0, +85 across the new
suites), engine 47/0, edit 212/0, check 83/0, projects 105/0, document 110/0, docwire 54/0,
showcompiler 42/0, shell 45/0; `offline-verify all` 50/0 (one first-invocation 49/1 flake on
the unchanged tree, fingerprinted once as `env:offline-verify-init1-flake`, pre-registered in
the CHG, standalone reruns green — not a ticket regression); `library-verify all` 150/0;
`clipcheck-run` 148/0; `pipeline-cli check` PASS; `process-audit --check` 25/25;
`git diff --check` clean. Browser probe (AC-6) on the real `file://` dist page: 29/29
assertions, externalUrls=0 — per-profile export button, import entry with Chinese
progress/cancel, wrong-type refusals, cancel-leaves-unchanged, adopted profile selectable and
rendering through the P3 path (probe script deleted after the run; durable evidence
`gate-probe-p5share.md`). Budgets (gate-time shared measure authority over lockScope): 2
files +306/−4 (≤ 14 files / 900 lines), 0 repairs (≤ 2), ~42 active minutes (≤ 90); later
status growth is review/gate evidence artifacts under the ticket-declared `.agent/evidence/**`
path only (advisory, no product file rides along — verified by global review).

## Remaining owner tails and why

- [TAIL:CHARASSETS-P2-LIVE] broadened to the combined P1–P5 deploy unit: both live roots
  still carry pre-P2 web bytes and every probe used synthetic fixtures. Next authorized
  deploy: copy the character-assets twin pairs into each live root as one unit, import one
  real Meddle export, exercise one two-profile session; REQ-SPEC-054 needs that real
  acceptance, REQ-SPEC-056 waits for the P6 1–8 dancer sweep.
- REQ-SPEC-055 (`.choreochar` share) stays unchecked in SPEC until the owner accepts the
  working-tree build — same acceptance pattern as REQ-SPEC-054; working-tree closeout does
  not self-certify product acceptance.
- Non-actions: no live-install copy, no release-staging rebuild, no generated-asset
  regeneration (none changed), no commit/push/publish in this run.
- Rollback: revert the five files below as one unit. `.choreochar` v1 is a new format no
  pre-P5 build reads (unknown magic refused on both import entries), DB_VERSION stays 2 with
  no store change, so no data conversion; profiles adopted from a `.choreochar` before
  rollback are ordinary v2 rows a pre-P5 build continues to read; already-exchanged files
  remain valid standalone bytes on disk.

## Files changed

5 files: `web/choreo-library.js` (+266/−0), `web/choreo-library-ui.js` (+40/−4),
`web/test-library.js` (+406/−0) plus the two byte-identical `web/dist/ChoreoHelper/` twins.
Full detail: `.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P5-SHARE.json`;
gate result, both review verdicts, the browser-probe record and the owner-enable decision
under `.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P5-SHARE/`.
