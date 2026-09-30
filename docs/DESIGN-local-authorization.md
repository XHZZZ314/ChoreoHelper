# 本地授权与发布来源合同（Local Authorization and Release Contract）

> Status: APPROVED 2026-09-04 (owner-lane review) — no product code changes in this ticket.
> Binding decision authority for token model, origins, compatibility and release
> blocking once the owner approves (see §15). Implementation lands only through
> `.agent/tickets/TASK-20260901-LOCAL-AUTH-IMPLEMENTATION.json`.
> Fixed input: the published origin `https://xhzzz314.github.io`
> (`src/LocalApiSecurity.cs`, owner-supplied 2026-09-02) is not re-decided here.

## 0. Fixed inputs and non-goals

- Current implementation is the persistent paste-once 8-character pairing code:
  `src/PairingStore.cs` (8 chars, unambiguous alphabet, one permanent code in
  `pairing.json`, ephemeral fallback only when storage fails),
  `X-Choreo-Token` header transport (`src/LocalApiSecurity.cs`), per-browser
  `localStorage` (`web/choreo-app.js:19`), fail-closed on empty codes.
- `docs/DESIGN-game-executor.md` §8 rule 4 previously required a short-lived
  session token for writes. This contract reconciles the two (see §2); §8 rule 4
  now defers to this document.
- This contract does not: invent or change any public origin; add accounts,
  cloud identity, telemetry, remote multi-client control or LAN credential
  sharing; treat CORS as authorization; make private reads anonymous; mix in
  movement, ability, schema or UI feature work.

## 1. Threat model

- Adversary: any untrusted web page or script the owner visits (including
  arbitrary `file://` pages, sandboxed frames and third-party sites), plus
  other local users/processes that can read cleartext the browser persists.
- Assets: personal action clips and library (`/export/*`), personal model
  bytes (`model.gltf/glb/bin`), dancer/session/debug state (`/dancers`,
  `/playback/status`, `/gpose/state`, `/debug/*`, `/shows/status`), and
  game-control writes (preview, recording, walkreset, show load/arm/start/stop).
- Non-assets (public by design): `/capabilities`, `/health`, `/version`,
  public action catalogs, classjobs, lyrics search — see `ReadAuthPolicy.cs`.
- Attack surface: cross-origin `fetch` from an allowed browser origin;
  DNS-rebinding or malicious local pages reusing `Origin: null`; token theft
  from browser storage or shoulder-surfing the in-game display.
- Out of scope for this contract: OS-level compromise, malicious plugin
  builds, phishing of the pairing code outside the product UI.

## 2. Token model decision (phased)

APPROVED (owner decision recorded in §15, 2026-09-04): keep the persistent pairing code
as the long-term device credential (Phase 0, current behavior, unchanged) and
add short-lived session tokens for write/show sessions (Phase 1, derived
implementation ticket). Rationale: paste-once usability and all existing
acceptance stay intact, while game-control writes gain expiry, per-browser
isolation and clean revocation without re-pairing every browser.

- Phase 0 (now): one permanent 8-character code per plugin install
  (`PairingStore.LoadOrCreate`); displayed via `/choreo pair`; pasted once per
  browser; sent as `X-Choreo-Token` on writes and paired reads; never in URLs
  or logs.
- Phase 1 (derived ticket): paired code mints short-lived session tokens over
  the already-paired channel; writes accept either the pairing code (legacy)
  or a live session token (preferred when the plugin advertises it in
  `/capabilities`); exact mint endpoint paths are fixed at implementation QA
  under the existing method-whitelist and zero-side-effect-OPTIONS rules.
- Alternatives rejected: pairing-code-only forever (no expiry/revocation for
  game control); sessions-only with no persistent credential (re-pair on every
  plugin restart, unacceptable usability); per-request signatures (no clock
  or key infrastructure exists locally).

## 3. Token lifetime

- Pairing code: permanent until rotated or its store is lost (§9–§10).
- Session token (Phase 1): dies on plugin unload/restart (memory-only, never
  persisted); absolute cap plus idle cap as recommended defaults —
  absolute 12h, idle 30min — both confirmable at implementation QA and
  advertised in `/capabilities` so the web never hard-codes them.
- Anonymous capability reads never carry or require any token.

## 4. Rotation

- Pairing code rotation is an explicit in-game user action (new code shown via
  `/choreo pair` flow); rotating immediately invalidates all live session
  tokens; affected browsers show the existing re-pair toast
  (`web/choreo-app.js:219`) and keep read-only anonymous access meanwhile.
- Session tokens rotate silently: the web mints a fresh one over the paired
  channel before expiry; overlapping validity of old/new during one handover
  round trip is allowed, two live tokens per browser is a bug.

## 5. Revocation

- Regenerating the pairing code revokes every session token everywhere.
- Plugin restart/unload revokes every session token (memory-only by design).
- A compromised browser is contained by: rotating the pairing code in game,
  which revokes all sessions; clearing that browser's site data drops its
  stored code. There is no remote kill list because there is no server.

## 6. Browser storage

- Pairing code: `localStorage` (`choreo_pairToken`), one value per browser,
  ASCII-only validation before send (`web/choreo-app.js:202`); cleared only by
  explicit user unpair or site-data clear.
- Session token (Phase 1): `sessionStorage` or in-memory only, never
  `localStorage`, never cookies; closed tab means forgotten token.
- Neither credential ever appears in URLs, logs, error toasts, diagnostics
  pages, staging packages or share files.

## 7. Expired-token retry behavior

- One paired write fails with `403 pairing required` → the web re-probes
  `/capabilities` once (detects restart/upgrade/rotation) → if the failure
  persists, show the re-pair toast and stop; never loop retries with the same
  token, never silently downgrade a paired private read to anonymous.
- After plugin restart the next write mints a fresh session over the paired
  channel automatically: exactly one extra round trip, no user action.

## 8. Concurrent pairing policy

- One pairing code per plugin install is shared by all of the owner's
  browsers (current behavior; each pastes once).
- Session tokens are per-browser and independent; one browser's expiry never
  affects another.
- Only one recording or show session runs at a time (existing §8 rule 5);
  a second browser's conflicting write gets the existing 409/session-busy
  semantics, never a silent takeover.

## 9. Plugin restart

- Pairing code survives (reloaded from `pairing.json`); session tokens do not
  (memory-only); the web recovers via §7 with no user action.
- If `pairing.json` is missing/corrupt at startup, the plugin issues the
  ephemeral fallback (restart changes it) and the web treats the next 403 as
  re-pair-required, exactly like a rotation.

## 10. Backup and recovery

- `pairing.json` lives only in the plugin config directory; it is excluded
  from every share/export surface (SPEC privacy-minimal `.choreochar` already
  excludes credentials and pairing state) and from release staging.
- Backup = file copy of the plugin config dir; recovery = restore the file
  or paste once again after `/choreo pair`. No cloud sync, no site-side copy.

## 11. CORS is transport, never authorization

CORS allowlisting and preflight handling decide which browser origins may
*talk* to the local ports; they never decide *who* may read personal data or
drive the game. Every paired read and every write requires the token header
regardless of origin — including `Origin: null` and `localhost`.
`OPTIONS` has zero side effects; unknown origins get preflight 403 with no
CORS headers so the browser never sends the real request.

## 12. Origin/access matrix

| Runtime row | Anonymous capability reads | Paired private reads | Paired writes | Token transport | Private Network Access handling | User recovery |
|---|---|---|---|---|---|---|
| `file://` (desktop shortcut, `Origin: null`) | `/capabilities`, `/health`, `/version`, catalogs, classjobs, lyrics search | `/export/*`, `model.gltf/glb/bin`, `/dancers`, playback/gpose/show status, `/debug/*` — all need `X-Choreo-Token` | All POSTs + `/debug/poke` need `X-Choreo-Token`, else 403 | Header only; never URL/log | Server returns `Access-Control-Allow-Private-Network: true` with the echoed `null` origin on allowlisted preflights | `/choreo pair` → paste once (half-width ASCII); wrong-code toast guides re-paste |
| Localhost plugin pages (`http://localhost:48795`, `http://127.0.0.1:48795`, `:48796` dev, `:48797` mock) | Same anonymous set | Same paired set; same-origin navigations carry no `Origin` and skip CORS but still need the token | Same write rule | Same header | Same-origin needs no preflight; cross-port preflights get 204 + PNA header | Same re-pair flow |
| `https://xhzzz314.github.io` (exact-string allowlist, owner-supplied 2026-09-02; verified reaching the plugin 2026-09-02T16:21Z: preflight 204 with ACAO+PNA, `/capabilities` 200, unpaired private read 403) | Same anonymous set | Same paired set | Same write rule | Same header | Public→private fetch requires preflight + PNA header (Chrome 137+); server sends both for this exact origin | Same re-pair flow |

Any origin outside these three rows requires a new owner decision before
specification or allowlisting; near-miss spellings stay rejected (exact match).

## 13. Compatibility matrix

| Row | Combination | Negotiation | Degradation | Forced re-pair | Rollback |
|---|---|---|---|---|---|
| C1 | Old web (no token) + new plugin | Web lacks `capsOk`/pairing headers; plugin answers anonymous reads, 403s writes with the pairing message | Read-only until paired/upgraded; message names the fix | Paste pairing code, or upgrade web | Revert web only; plugin behavior unchanged |
| C2 | New web + old plugin (no `/capabilities`, 404) | `probeCaps` fails → compatibility mode, no pairing headers sent | Full legacy behavior, no pairing protection available | Upgrade plugin to regain pairing | Revert plugin only; web auto-degrades |
| C3 | Protocol skew (`protocolVersion`, `shows.protocol`, capability list) | Plugin-newer → hint; plugin-older → yellow upgrade prompt (AUD-013 rule 9); missing `REQUIRED_CAPS` named item by item | Older side works where capabilities overlap; show load refused on executor mismatch | None, unless the capability flag for sessions flips | Capability advertisement is additive; removal is a new contract revision |
| C4 | Phase-1 rollout (sessions) | Plugin ships first with dual-accept (pairing code AND session tokens); new web prefers sessions when advertised, else pairing code | Mixed fleets interoperate during rollout; no flag day | `pairing.json` loss (ephemeral), explicit rotation, session-capability flag change | Sessions are memory-only and additive: revert web to pairing-only, restart plugin to clear sessions; pairing code and projects untouched |

Rollout order: plugin first (dual-accept keeps old web working read-mostly),
then web (prefers sessions). No step breaks anonymous reads or corrupts data.

## 14. Release blocking conditions

Release stays blocked until ALL of these pass: (a) the derived implementation
ticket closes; (b) security and recovery gates pass (origin allow/block,
paired-vs-anonymous reads, write 403s, preflight zero-side-effects,
rotation/restart recovery); (c) browser regressions pass on all three matrix
rows including PNA behavior; (d) explicit owner publication authorization for
that release. This contract ticket itself changes no source, live root,
staging or remote.

## 15. Owner decision record

- Recommended decision: approve the phased model (§2), the matrix rules
  (§12), the compatibility/rollout order (§13) and the release block (§14),
  with session lifetime defaults (12h absolute / 30min idle) confirmable at
  implementation QA.
- Owner decision: APPROVED — 批准合同 (owner selected "批准合同" in the owner-lane
  review pause; recorded in
  `.agent/evidence/TASK-20260901-LOCAL-AUTH-RELEASE-CONTRACT/REVIEW-RUN-20260901-LOCAL-AUTH-RELEASE-CONTRACT-OWNER.json`).
- Date: 2026-09-04.

## Appendix A. Grounded evidence paths

`src/PairingStore.cs`, `src/LocalApiSecurity.cs` (origins, token, preflight,
PNA, `ProtocolVersion`, capabilities), `src/ReadAuthPolicy.cs` (paired vs
anonymous), `src/HttpServer.cs:169,237`, `src/Exporter/ExportServer.cs:166,
899-900`, `src/Plugin.cs:62` (startup load), `web/choreo-app.js:19,191-219,
559-574,1188` (storage, transport, handshake, toasts),
`docs/HANDOFF-20260902-v071-public-trial-prep.md` (origin allowlist + AC-6
browser proof), `docs/DESIGN-game-executor.md` §8 (reconciled by this doc).
