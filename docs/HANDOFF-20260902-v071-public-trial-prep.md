# HANDOFF — v0.7.1 public-trial preparation (public origin, hotfix-in-staging, Pages verification)

Package: TASK-20260902-V071-PUBLIC-TRIAL-PREP (revision 2, R4, standard lane, modules
release-product + plugin-product) · Run RUN-20260902-V071-PUBLIC-TRIAL-PREP-R2 (completed) ·
closed 2026-09-03

## Objective and acceptance

Per the accepted ticket revision 2: prepare tonight's v0.7.1 partial-user trial — the public
Pages origin allowlisted in the plugin, release/staging rebuilt from the current tree so the
packaged web bits carry the 2026-09-02 lyrics hotfix, FIX-K privacy/integrity gates and the
routed regression matrix re-run on the rebuilt artifacts, and one real-browser verification that
the published Pages origin reaches the local plugin. Repo creation, Pages enablement and Release
upload stay owner-only R4 actions; REQ-SPEC-018/044/052 stay open (INV-5).

## Mechanism / red baseline

- Revision 1 (run cancelled per INV-6) had staged a build at 2026-09-02T13:50:24.379Z whose
  packaged `choreo-lyrics-ui.js` (sha256 prefix `7fd07199`) predated the owner-confirmed lyrics
  hotfix (resolved 14:33Z, twin prefix `8c591051`).
  INT-20260902-LYRICS-HOTFIX-RELEASE-INCLUDE therefore required a rebuild plus re-run gates
  before any public-trial upload; revision 2 inherits the revision-1 security-file edits instead
  of redoing them.
- The security surface is one constant: `LocalApiSecurity.PublicSiteOrigin =
  "https://xhzzz314.github.io"` (exact-string allowlist slot, single-slot replace semantics).
  Everything else — the five local origins, token-gated private reads, preflight 403/204 with
  zero side effects, PNA header — is byte-identical logic asserted by the datalayertest
  named-origin block (constant configured, exact allow, five near-miss rejections,
  unknown-origin rejection, temp-assignment restore, loopback HttpListener preflight contract).

## What changed and behavior preserved

- `src/LocalApiSecurity.cs`: the public-origin constant plus its comment — the entire diff vs
  HEAD 8a7e9f6 (AC-1 patches archived in `rev2/ac1-gitdiff-LocalApiSecurity.patch`).
- `src/tests/datalayertest/program.cs`: the inherited origin-check additions (AC-1 patches
  archived in `rev2/ac1-gitdiff-datalayertest.patch`). Revision 2 made zero further edits to
  either file; the Release DLL was rebuilt (0 warnings/0 errors) from the current tree.
- `release/staging/**`: regenerated twice within the run — the Worker-time build (15:05:00.971Z)
  and the gate's own testPlan re-run; the shipped staging is the gate-time build
  (`MANIFEST builtAt 2026-09-02T15:22:48.970Z`, sourceDigest `2cd91eb1b9acc…`, recorded in
  `rev2/MANIFEST-staging-copy-rev2-gate.json`, byte-equal to the current
  `release/staging/MANIFEST.json`). Hotfix bytes proven in-package: `choreo-lyrics-ui.js`
  (`8c591051…`) and `choreo-api.js` (`81a869fa…`) SHA256-equal the hotfixed dist twin; M1 bytes
  present (`preview3d.js 5f485bcf…`, `choreo-helper-app.css 350e4f61…`); stand-in-only
  `model.gltf` from `web/model-standin.gltf`; snapshots regenerated live with the game open and
  paired; Chinese README.txt script-generated; zips built and byte-verified.
- Nothing else: `web/**`, `scripts/**`, SPEC, site and sample trees hold zero diff from this
  ticket; no remote, push, upload, commit or live-install write occurred (INV-4); the cancelled
  revision-1 evidence stays untouched as history (INV-6).

## Verification actually observed

- Gate `GATE-RUN-20260902-V071-PUBLIC-TRIAL-PREP-R2`: 29/29 checks passed on cycle 1, zero
  repair attempts, all 24 revision-2 testPlan entries in order — dotnet build 0/0, datalayertest
  401/0, make-release-staging all inline phases (privacy scan incl. zip re-scan and DLL/PDB path
  gate), test-release-gates 28/28, test-engine 47/0, test-edit/test-check/test-projects/
  test-document/test-docwire/test-showcompiler green, test-api 53/0, test-lyrics 12/0,
  test-library 91/0, test-shell 45/0, clipcheck-run pass, offline-verify all 45/0,
  library-verify all 149/0 (the Worker-time `好动作自动进资料库` flake family — 148/1 twice — did
  not reproduce at gate time), staged-twin-sha256 34 equal/0 mismatch (whitelist 32×2 +
  model.gltf ×2; staged DLL sha-equals the fresh Release build), pipeline-cli check PASS,
  process-audit 25/25, git diff --check clean.
- Reviews: module APPROVE (3 info findings — F-1 staging-identity wording, F-2 disclosed
  claim-time context trim, F-3 documented library-verify flake family), global APPROVE (4 info
  findings — publication-order recommendation, owner-authority ordering, carried F-1, live-root
  hash transparency), owner APPROVE (0 findings).
- AC-6 real-browser verification (after the owner published): 2026-09-02T16:21:18Z,
  `https://xhzzz314.github.io/choreo/` via headless Chrome CDP — OPTIONS preflight to 48794 and
  48795 returned 204 with `Access-Control-Allow-Origin: https://xhzzz314.github.io` and
  `Access-Control-Allow-Private-Network: true`; `/capabilities` 200 protocolVersion 1 version
  0.7.1; one unpaired private read (`/export/list`, no token) returned 403
  (`rev2/AC6-browser-verification.json`). The product's real endpoints are
  `http://localhost:{48794,48795}/` (HttpListener binds localhost; 127.0.0.1 as a literal Host
  is refused by http.sys — recorded in the plugin-product module record).
- Closeout converged machine state: run archived to history, ticket closed, CHG records
  finalized (gate-time staging identity; AC-6 marked completed), process-audit 25/25 after
  fix/check, check-ai-docs clean.

## Remaining owner tails and why

- RELEASE: the Pages site is published and verified (AC-6); the GitHub Release plugin-package
  upload and any recall/replace of published artifacts remain owner publishing decisions
  outside this ticket. Staging stays local and reproducible via `scripts/make-release-staging.js`.
- M1-DEPLOY (unchanged): both live install roots still hold pre-M1 bytes; a whole-tree
  no-delete copy of `web/dist/ChoreoHelper` needs owner authorization.
- POLICY-BUDGET (unchanged): sibling role context budgets still sit below this ticket size.
- REQ-SPEC-018 stays open (this ticket is partial evidence: site + package + origin verified;
  custom repo, install/upgrade and migration mechanics unstarted).

## Files changed

`src/LocalApiSecurity.cs`, `src/tests/datalayertest/program.cs`, regenerated
`release/staging/**` (gitignored, local-only), ticket/run/evidence artifacts under
`.agent/tickets/`, `.agent/runs/`,
`.agent/evidence/TASK-20260902-V071-PUBLIC-TRIAL-PREP/rev2/`, module change records under
`.agent/modules/{release-product,plugin-product}/changes/`, and the closeout state views
(`docs/AI-BACKLOG.md`, `.agent/PROCESS-STATE.json`, `.agent/CONTINUITY.md`, this handoff).
Full per-module inventories: `CHG-TASK-20260902-V071-PUBLIC-TRIAL-PREP.json` in both modules.
