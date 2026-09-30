# HANDOFF — local authorization Phase 1 session tokens (closed)

Package: TASK-20260901-LOCAL-AUTH-IMPLEMENTATION (revision 1, R4, standard lane,
modules plugin-product + web-product + release-product) ·
Run RUN-20260901-LOCAL-AUTH-IMPLEMENTATION (completed 2026-09-04)

## Objective and acceptance

Ship Phase 1 of the owner-approved contract
(`docs/DESIGN-local-authorization.md`): short-lived write session tokens
alongside the persistent pairing code, on all three allowed origins, with
old-client compatibility and rollback — no origin, schema, UI-feature or
protocolVersion drift. All seven acceptance criteria are met with recorded
evidence: AC-1/2/4/5/6 via datalayertest 626/626 (+34 session vectors) and
web/test-api 75/75; AC-3 via offline-verify 50/50, library-verify 150/150 and
named-origin vectors (live three-row regression stays release-blocked per
§14(c)); AC-7 via the clean `release/ site/ sample/` probe plus the owner-lane
APPROVE recorded in person.

## Mechanism / red baseline

- Red baseline: before this change no `src/SessionTokenStore.cs` existed and
  `LocalApiSecurity` accepted only the persistent pairing code —
  `DESIGN-game-executor.md` §8 rule 4 (short-lived write tokens) was unmet.
- Run history: Worker implementation → gate attempt 1 failed on 3
  fingerprints (offline-verify 45/2, library-verify 121/4 real-model waits,
  defaultContextBytes 16019>16000) → repair triage classified the two
  integration failures as environment-gated (game had no player character
  loaded; old-web control fails identically) → worker repair (1 of 2) made
  zero product-code change (process evidence only) → gate attempt 2: 27/27
  green with the character loaded and the continuity fix holding at 15997.

## What changed and behavior preserved

- NEW `src/SessionTokenStore.cs`: memory-only 32-char unambiguous-ASCII
  tokens bound to the minting pairing code; absolute 720 min + idle 30 min
  dual expiry with injected clock; any effective code change revokes all
  sessions; restart/unload clears via `Clear`; `Validate` fail-closed on
  null/empty/wrong-length/malformed/unknown/expired/code-mismatch and
  refreshes the idle stamp on success.
- `src/LocalApiSecurity.cs` + `src/HttpServer.cs` +
  `src/Exporter/ExportServer.cs`: POST writes dual-accept the pairing code or
  a live session token (`CheckWriteToken`); paired reads stay
  pairing-code-only (`CheckToken`, `ReadAuthPolicy.cs` untouched); new
  POST-only `/auth/session` on 48794/48795 mints with pairing-only auth, no
  game-state side effect, non-POST keeps the existing 405/OPTIONS handling;
  `/capabilities` gains the additive session block (supported,
  absoluteMinutes 720, idleMinutes 30) plus the session-auth item,
  protocolVersion stays 1.
- Web (`web/choreo-api.js`, `web/choreo-app.js`, `web/test-api.js` + byte
  identical dist twins): the client prefers session-token writes only when
  `/capabilities` advertises them (never hard-codes lifetimes); the token
  lives only in sessionStorage key `choreo_sessionToken`; silent re-mint
  before expiry replaces the token in the same slot; expiry/restart recovery
  in exactly one extra round trip; persistent 403 re-probes capabilities once,
  then shows the existing toast and stops; paired reads keep the pairing
  code; client keeps zero storage access.
- `scripts/test-release-gates.js`: pairing.json credential-exclusion
  fixtures (33/33) — a staged tree containing pairing.json is rejected.
- Preserved byte-identical: the three origin rows and CORS allowlist,
  anonymous-read classification, 409/session-busy semantics, twins hashes
  between attempts (no product-file change during repair); no deploy,
  external-root sync, staging rebuild, remote, push or publication.

## Verification actually observed

- Gate R2 `GATE-RUN-20260901-LOCAL-AUTH-IMPLEMENTATION-R2.json`: 27/27
  checks passed at the claimed source revision — datalayertest 626/626,
  plugin build 0 warnings/0 errors, all nine web suites green (test-api
  75/75), offline-verify 50/50 and library-verify 150/150 in online
  real-plugin mode (live pre-session plugin, working-tree dist — the C1–C4
  skew path healthy), release gates 33/33, pipeline check, process-audit
  25/25, check-ai-docs 60/60, twins match, diff --check clean, live-plugin
  probe 200 with anonymous skeleton read still 403.
- Reviews against R2: module APPROVE, global APPROVE, owner APPROVE —
  owner's verbatim selection "批准 … 不部署、不发布，发布仍按合同 §14 另行授权"
  recorded 2026-09-04 with alternatives offered.
- Budgets: run wall 174/90 min (recorded warning; owner pause + repair
  cycle, attempt 2 itself 22 min), repair 1 of 2 consumed, file/line budgets
  within limits.

## Remaining owner tails and why

- Release stays blocked per contract §14: this ticket closed, gates green —
  still required are live browser regressions on all three section-12 rows
  and explicit publication authorization (tracked by the existing RELEASE
  tail).
- No DLL deploy and no external-root web sync were performed: live roots
  still run the pre-session plugin and old web (C1 state valid per §13);
  activating the built session plugin is a separate owner-authorized deploy.
- Rollback until then: revert the thirteen changed files as one change
  (plugin sources + tests, web sources + dist twins, release-gate tests) and
  restart the plugin to clear memory-only sessions; pairing code, projects,
  libraries and live installs need no conversion.

## Files changed

`src/SessionTokenStore.cs` (new), `src/LocalApiSecurity.cs`,
`src/HttpServer.cs`, `src/Exporter/ExportServer.cs`,
`src/tests/datalayertest/datalayertest.csproj`,
`src/tests/datalayertest/program.cs`, `web/choreo-api.js`,
`web/choreo-app.js`, `web/test-api.js`,
`web/dist/ChoreoHelper/choreo-api.js`,
`web/dist/ChoreoHelper/choreo-app.js`, `scripts/test-release-gates.js`,
plus ticket/run/evidence/module-record process artifacts and this handoff.
