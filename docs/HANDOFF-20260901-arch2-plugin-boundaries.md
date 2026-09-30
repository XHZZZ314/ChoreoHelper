# HANDOFF — Plugin HTTP transport split from playback/show/export request policies (ARCH2 boundaries)

Package: TASK-20260901-ARCH2-PLUGIN-BOUNDARIES (revision 2, R3, standard lane, tags
architecture/ipc/lifecycle/compatibility) · Run RUN-20260901-ARCH2-PLUGIN-BOUNDARIES
(completed) · 2026-09-04 · Module: plugin-product · Reviews: module + global, both APPROVE
against gate `GATE-RUN-20260901-ARCH2-PLUGIN-BOUNDARIES-5`.

## Objective and acceptance

Shrink `HttpServer` and `ExportServer` into transport shells (parse/authorize/serialize/
delegate) with the 48794 playback/show and 48795 recording/export request policies extracted
into small Dalamud-free, independently testable components — while preserving every endpoint,
authorization rule, status code, response byte shape, lane capacity (fast 32 / outbound 4),
single-session constraint and shutdown drain order. AC-1..AC-6 cover inventory/routing parity,
lane/cancellation semantics, OPTIONS/405/token safety, malformed/oversize/retry handling,
dispose hardening and behavior-preserving build/scope closure.

## Mechanism / red baseline

- Baseline: datalayertest 401/401, Release build 0 warnings / 0 errors, fix1-web-verify PASS,
  library-verify all 149 pass / 1 pre-existing rec-flake, `git diff --check` clean,
  `pipeline-cli check` PASS, `process-audit --check` 24/25 (all pre-existing).
- Red→green for the new checks was demonstrated per-fix during development: the first
  post-extraction run exposed 3 fixture defects and 2 encoder-contract findings (default
  `JsonSerializer` emits `\uXXXX` for non-ASCII, so byte expectations are locked via
  parsed-field + deterministic-reserialize comparison — the same serializer call as before, so
  wire bytes are unchanged); `dispatch:dispose` was red before the `_disposed` hardening
  (post-Dispose `TryAccept` threw `ObjectDisposedException` from the disposed semaphore) and
  green after.
- Gate attempts 1–4 failed only on environment/process facts, never on ARCH2 code:
  `library-verify` rec auto-import flake (fixed harness-only by closed
  TASK-20260903-LIBVERIFY-REC-AUTOIMPORT) and the implementation-context byte budget (cap
  raised by closed TASK-20260904-PIPELINE-BUDGET). Attempt 5 passed everything; datalayertest
  and fix1-web-verify log hashes stayed byte-identical across attempts 2–5, proving the code
  under test never changed after the Worker finished. Zero repair attempts (SOP §8: the gate
  never repairs implementation code; both remediations landed as separate closed packages).

## What changed and behavior preserved

- New `src/PlaybackApiPolicy.cs`: the full 48794 endpoint tables (read/write sets incl.
  `/shows/status`), 405/404 method classification (`PostWrongMethodAllow` / `OtherMethodAllow`,
  OrdinalIgnoreCase, dual-use `/settings/engine` precedence and unknown-POST-falls-to-404
  preserved), 4 MB / 2000-clip limits, the 413/400/503/409/500 error byte shapes, stable
  400 invalid-body shape, and timeline-clip parse+validation returning a Dalamud-free
  `ClipSpec`; `HttpServer` performs the mechanical ClipSpec→PlaybackClip mapping
  (`PlaybackClip` stays in the untouched `PlaybackManager.cs`).
- New `src/ShowApiPolicy.cs`: the five `/shows/*` writes plus `/shows/status`, package-element
  extraction, `/shows/start` countdown parsing, and 400/409/503 shaping with the former
  `HttpServer.JsonOptions` semantics (`WhenWritingNull`) so bodies stay byte-identical.
- New `src/Exporter/ExportApiPolicy.cs`: the `/export/*` 14-entry Ordinal method whitelist,
  static file mapping (`/` → app html, `/viewer` → pose-viewer), 64 KB limit + 413 shape,
  unknown-endpoint 404 shape, tolerant body parsers (swallow-and-default preserved).
- `src/HttpServer.cs` / `src/Exporter/ExportServer.cs` are now transport shells: OPTIONS
  preflight before any business logic, token pairing, CORS, serialization, lane dispatch,
  delegation. ExportServer's dead `GetEndpoints`/`PostEndpoints` hashsets (zero references)
  were removed; ExportServer deliberately stays off `RequestDispatcher` (no per-handler cap
  today — capping would change concurrency behavior; `InFlightTracker` drain order untouched).
- `src/RequestDispatcher.cs`: the only behavioral delta is AC-5 hardening — volatile
  `_disposed`, post-Dispose `TryAccept` returns false instead of throwing, `WaitDrained` valid
  after Dispose, idempotent Dispose; exactly-once slot+handle release stays in the single
  `finally`. `src/tests/datalayertest/*` gains +144 checks (policy:route/body/shapes/clips/
  oversize/show/countdown/export/session/single-session, dispatch:inflight/release/cancel/
  dispose) using `SpinWaitUntil` only, a loopback `HttpListener` through production
  `LocalApiSecurity.ReadBodyLimited` for 413 byte-counting, and `FakeShowDispatcher` (no
  game-thread calls).
- Preserved: no endpoint/pairing/CORS/method-whitelist/limit change, no protocol/data-format
  change, no new dependency, lane caps 32/4, POST mutation gate, single-session 409, stop
  order (cancel → listener stop → 6 s `WaitDrained`; ExportServer batch stop → `CancelPending`
  → 5 s tracker drain), owner's uncommitted baseline untouched.

## Verification actually observed

- Gate attempt 5 (status passed, 2026-09-03): datalayertest **545/0** (output sha256
  byte-identical to attempts 2–4 and to the independent reviewer re-run), Release build
  0 warnings / 0 errors, fix1-web-verify FIX1-WEB-PASS, library-verify all **150/0** (the rec
  auto-import check now genuinely passing after the harness-only remediation; expectation
  unchanged), `git diff --check` clean, `pipeline-cli check` PASS, `process-audit --check`
  25/25. Logs: `.agent/evidence/TASK-20260901-ARCH2-PLUGIN-BOUNDARIES/gate-logs/attempt5/`.
- Both reviews APPROVE: the module lane re-derived every policy constant/error literal
  hunk-by-hunk against the removed inline code and independently re-ran datalayertest (545/0,
  identical hash); the global lane re-verified topology (`MODULES.json` pin match), the
  web-product wire contract (byte-parity incl. `WhenWritingNull`), scope-drift attribution
  (non-ARCH2 hunks all belong to closed HYGIENE's own record) and live-install safety
  (deployed DLL mtime 15:10 +0800 predates the run claim 18:40 +0800 — both live roots still
  run the pre-ARCH2 build).
- Process facts: run-time budget breach (339 elapsed vs 90 minutes) recorded in the gate as an
  owner-visible escalation fact; continuation across the two remediation packages was
  owner-directed. Changed-file/line budgets: 8/18 files, ~1292/1400 lines at attempt 1.

## Remaining owner tails and why

- **ARCH2-LIVE wire verification**: after an owner-authorized DLL deploy and reload, a quick
  curl/browser pass over 48794/48795 confirms the byte-identical wire behavior in the real
  game. This package's rollout explicitly scoped deployment out; the Release build here proves
  compilation only and no live root was touched.
- **Rollback precision (global GF-1)**: if ever needed, the revert is hunk-scoped for
  `src/HttpServer.cs` and `src/Exporter/ExportServer.cs` — those files co-carry the live
  HYGIENE hunks in the same uncommitted tree; a whole-file restore would also revert three
  live fixes. The finalized module record carries the corrected recipe; any actual rollback
  runs as its own reviewed change.
- Non-actions: no DLL deployment, no staging rebuild, no commit/push/publish, no live-install
  mutation. Run-time budget breach remains an owner-visible process fact only.

## Files changed

Run-attributed, all inside ticket writeScope (8 paths): new `src/PlaybackApiPolicy.cs`,
`src/ShowApiPolicy.cs`, `src/Exporter/ExportApiPolicy.cs`; modified `src/HttpServer.cs`,
`src/RequestDispatcher.cs`, `src/Exporter/ExportServer.cs`,
`src/tests/datalayertest/datalayertest.csproj`, `src/tests/datalayertest/program.cs`
(+144 checks). Full record:
`.agent/modules/plugin-product/changes/CHG-TASK-20260901-ARCH2-PLUGIN-BOUNDARIES.json`.
