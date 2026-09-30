# HANDOFF — In-page GLB / Meddle glTF+bin import into the selected profile (character assets P2)

Package: TASK-20260903-CHARACTER-ASSETS-P2-IMPORT (revision 3, R3, standard lane, tags
cross-module/persistence/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P2-IMPORT
(completed, 0 worker repair attempts) · 2026-09-05 · Modules: web-product · Reviews: module +
global, both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P2-IMPORT-R3.

## Objective and acceptance

Design section 2 slice of the owner-approved character-asset v1 plan: on the ready 3D preview
panel, an in-page picker imports exactly one model set — a single .glb, or a .gltf plus every
external companion it references — into the existing library profile selected in the panel's
selector, as one all-or-nothing replacement of that profile's model files under the picked
ORIGINAL filenames, with SHA-256 intake hashes in the existing pfile record shape and glTF
external-buffer pairing validated by the CHLB v2 preflight basename rule in the same operation.
Never-imported profiles, deploy-root precedence, DB_VERSION/CHLB envelope and all
library/backup/clip behavior stay byte-identical; no dancer profileId is written from any UI
(P3). AC-1..AC-11 all passed; the red mechanism and counts below are the accepted evidence.

## Mechanism / red baseline

`ChoreoLibrary.importModelSet` did not exist at baseline (TypeError on the fake backend) and the
panel had no import control — the new §18–§24 suites in `web/test-library.js` failed on the
missing surface before implementation (recorded in `worker-baseline.md`). All 91 pre-existing
test-library assertions stayed green, so the failure was the missing feature, not a broken
baseline.

## What changed and behavior preserved

- `web/choreo-library.js` (+98/-0): new additive member `ChoreoLibrary.importModelSet(pid,
  files)`. All validation precedes any write: exactly one model document per set (a .glb or a
  .gltf; both/two+/neither rejected), any zero-byte file rejected by name, .glb must start with
  the `glTF` magic, .gltf must JSON-parse, and every external-buffer uri must resolve by
  basename — last path segment without query, data: URIs exempt, byte-identical to the CHLB v2
  preflight rule — against the picked set only (an already-stored companion does not count).
  The write is one readwrite transaction over files+meta: prior pfile rows deleted, picked
  files stored under ORIGINAL names as ordinary `pfile:<pid>:<name>` records with intake
  SHA-256, profile modelNames replaced with exactly the picked set. Abort leaves the prior set
  intact; retry needs no cleanup.
- `web/preview3d.js` (+133/-15): foot-bar `导入模型` button drives a hidden multi-select
  .glb/.gltf/.bin input; import targets the panel-selector profile, shows a Chinese ack that
  survives the model reload via the ready status, refreshes the selector and hardReset+init
  reloads when the imported profile is the rendered one; cancel performs no write.
  `loadModelFromProfile` keeps both fixed-name branches byte-identical and gains a fallthrough
  `loadModelFromProfileSet` that applies the same three gates (stored-hash integrity, parse,
  full-bone compat with 0.8–1.25 unit ratio) and resolves .gltf external buffers by basename
  via a blob-URL LoadingManager; a missing companion returns null to the stand-in exactly like
  today's missing model.bin.
- `web/test-library.js` (+252/-0): purely additive §18–§24 suites mapped to AC-1/2/3/5/8/9/10.
  Zero deleted lines anywhere, so no pre-existing assertion was modified or weakened (AC-4).
- Both changed sources are byte-identical to their `web/dist/ChoreoHelper` twins (SHA-256 in
  the gate `scope:dist-twin-identity` check; AC-11). No live install root touched.

## Verification actually observed

Gate R3 passed all 16 required checks (gates R1/R2 failed only on process artifacts: R1's
stale continuity snapshot was repaired by the allowlisted `process-audit --fix`, then the
implementation-context budget surfaced 36533 > 36500; the owner selected escalation remedy (a)
— two stale backlog bullets trimmed under owner-authorized direct maintenance,
`owner-direct-maintenance-budget-trim.md`, 36533 → 36295 — and R3 went green). Budgets:
5 product files +714/-30 (9 changed files counting closeout/evidence, ≤ 12), ~24.7 active
minutes (≤ 90), 0 worker repairs. Suites: `test-library` 144/0 (baseline 91 + 53 new),
engine 47/0, edit 168/0, check 83/0, projects 105/0, document 110/0, docwire 54/0,
showcompiler 42/0, shell 45/0; `offline-verify all` 50/0; `library-verify all` 150/0;
`clipcheck-run` 148/0; `pipeline-cli check` PASS; `process-audit --check` 25/25;
`git diff --check` clean. AC-6/AC-7 browser probe on the real `file://` dist page via CDP
`DOM.setFileInputFiles` on the panel's hidden picker: 9/9 — import stored under the original
name with a 64-hex intake hash, panel reloaded to the stand-in with the per-profile compat
note (the synthetic fixture correctly failed the skeleton gate 0/101), success ack in the
ready status, glb+gltf rejection with zero store change, empty-change cancel with no write.
Temporary probe deleted per the ticket evidence rule.

Review findings were all `info`, none requiring code change: duplicate-name multi-select
records the name twice in modelNames (no AC covers it; rendering unaffected), a legacy
self-contained data-URI .gltf corner now renders through the same gates instead of falling to
the stand-in (intended P2 semantics), companion .bin load-time hash convention equals the
pre-existing fixed-name convention (intake hashes still enforced by CHLB v2 preflight), and
the live-root deploy unit note below. Both reviewers independently recomputed the attribution
diff against the claim baseline, re-verified twin hashes and re-ran the library suites.

## Remaining owner tails and why

- New tail [TAIL:CHARASSETS-P2-LIVE]: both live install roots still carry pre-P2 web bytes, and
  the recorded browser probe used a synthetic fixture that exercised the compat-note path — a
  real Meddle export rendering through the gate-success path has not been observed yet. Next
  owner-authorized deploy should copy both twin pairs (choreo-library.js + preview3d.js) into
  each live root as one unit, then import one real Meddle export on the `file://` page and
  confirm the render (or the compat note). REQ-SPEC-054 stays open until that real acceptance.
- Non-actions: no live-install copy, no release-staging rebuild, no snapshot regeneration, no
  commit/push/publish in this run.
- Rollback: revert the five files below as one unit. Imported files are ordinary v2-store
  pfile records under original names with content hashes: a reverted pre-P2 build keeps the
  fixed-name path (an imported-over profile renders the stand-in until re-import) and CHLB v2
  export/import still round-trips them — no data conversion needed.

## Files changed

Run-attributed (5 product paths, +483/-15; 9 files counting evidence/closeout artifacts):
`web/choreo-library.js` (+98), `web/preview3d.js` (+133/-15), `web/test-library.js` (+252),
`web/dist/ChoreoHelper/choreo-library.js`, `web/dist/ChoreoHelper/preview3d.js` (twins). Full
detail: `.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P2-IMPORT.json`;
gate rounds R1–R3 and both reviews under
`.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P2-IMPORT/`.
