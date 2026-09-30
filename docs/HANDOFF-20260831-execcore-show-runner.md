# HANDOFF — EXEC-CORE: safe game show executor (2026-08-31)

Package: `AI-BACKLOG.md` §10 (first open unblocked package; §1–§9 all CLOSED).
Scope landed in one increment: the four mandated components (`ShowCompiler` web-side,
`ShowRunner`/`EventScheduler`/`RuntimeGuard` C#-side) plus the supporting pure pieces the
design doc requires (`ShowProtocol` parse, `ShowValidator` plugin-side recheck, `ExecutionLog`,
`IShowDispatcher` + game adapter) and the `/shows/*` HTTP transport. Nothing committed,
pushed or published; release staging untouched; live devPlugins DLL untouched.

## Mechanism evidence (reproduce step)

EXEC-CORE is a capability package, not a bug fix, so the "failure" is established from code
evidence: the only game execution path was `PlaybackManager` (`src/PlaybackManager.cs`),
which starts playing **immediately on `POST /playback/start`** (no load/arm/countdown state
machine), is driven frame-by-frame with a web-coupled seek/freeze preview loop, has **no
runtime guard** (combat/cutscene/zone change/character loss are never evaluated), and keeps
`AnimationPoseFreezer` inside the orchestration path. Design doc
`DESIGN-game-executor.md` §1–§8 requires the opposite contract; §10 requires game-independent
unit tests first. That is what this package builds.

## What landed

### C# (plugin; reaches the game only via a future owner-authorized DLL update)

- `src/ShowProtocol.cs` — pure DTOs + strict parser (`ShowProtocolParser.Parse`): protocol
  version, integer-ms times (fractional JSON numbers rejected), unique event ids, kind
  whitelist, performers/capabilities shape, caps `MaxEvents=5000` / `MaxPerformers=64`,
  `SupportedVersion=1`. Chinese 400-level messages.
- `src/ShowValidator.cs` — pure plugin-side recheck (design §13: never trust the web compile):
  rejects too-new protocols, capability requirements the plugin lacks (`movement-control`/
  `ability-execution` → precise "执行器未实装" errors), unsupported event kinds
  (ability/movement/facing), mixed-performer motion events (ACTOR single-actor contract),
  missing/unsafe commands (`ChatCommandPolicy` gate), events beyond declared duration.
- `src/EventScheduler.cs` — precompiled queue + monotonic cursor: sorted by `startMs`, ties by
  priority (facing > movement > ability > motion > cue > lyrics, mirroring design §4), every
  event collected exactly once, optional `DispatchLeadMs` (default 0, to be calibrated
  on-device later).
- `src/RuntimeGuard.cs` — pure stop-condition policy: CharacterLost > TerritoryChanged >
  Cutscene > InCombat > Uncontrollable > ManualTakeover > ClockJump (negative delta or
  delta > 5s) > AdapterFailure > MovementError; Chinese reason texts.
- `src/ExecutionLog.cs` — capped ring (500) of planned/dispatched show-ms + monotonic ms +
  result/reason; `RenderTail(10)` readable Chinese log for `/shows/status`.
- `src/ShowRunner.cs` — the state machine (Idle/Loaded/Armed/Countdown/Playing/Stopping/
  Completed/Faulted) on an injected monotonic clock: `Load` (rejected while executing) →
  `Arm` → `Start` (only from Armed; enters cancellable countdown, default 3s, cap 30s) →
  per-frame `Tick()` (guard each frame; dispatch due events; motion failure faults the show,
  lyrics/cue failures skip; finish = all dispatched + duration reached → Completed with the
  same cleanup). `RequestStop` is idempotent: only Armed/Countdown/Playing react; enters
  Stopping, runs cleanup once (`OnStop`), returns to Loaded (Faulted if cleanup threw).
  `StatusJson()` for the status endpoint. No Dalamud dependency anywhere.
- `src/GameShowDispatcher.cs` — the Dalamud adapter (thin, not in tests): motion =
  `PrepareForPlaybackCommand` + `GameCommandExecutor.ExecuteCommand` (policy/throttle/queue
  stay in the executor); lyrics = empty command no-op, else same command gate; cue = log;
  `OnStop` = `Clear()` + `StopPreview()` (same hygiene as PlaybackManager end-of-play).
  Guard provider (framework-thread only): `ObjectTable.LocalPlayer` presence,
  `IClientState.TerritoryType` baseline captured on first evaluation (countdown frame),
  `ICondition` WatchingCutscene/OccupiedInCutSceneEvent/InCombat/BetweenAreas(+51).
  Manual-takeover and movement-error inputs exist in the guard policy but the adapter
  honestly feeds `false` (no input hooks / no movement backend yet).
- `src/HttpServer.cs` — `POST /shows/validate|load|arm|start|stop`, `GET /shows/status`.
  All POSTs ride the existing pairing-token gate + `_postGate`; validate returns
  `200 {ok:false, issues}` (successful validation of a bad show), load with a rejected show
  is 400 with the first Chinese error, wrong-state arm/start is 409 with `StateRuleMessage`,
  stop is always safe. `/shows/status` added to `ReadAuthPolicy` paired reads.
- `src/LocalApiSecurity.cs` — capabilities JSON now carries `shows:{protocol:1,
  executors:[motion,cue,lyrics], maxEvents:5000}` (public metadata, stays anonymous per SEC-1).
- `src/Plugin.cs` — injects `IClientState`/`ICondition`, builds dispatcher+runner,
  `Framework.Update → ShowRunner.Tick()` (exception-proofed), `RequestStop("插件卸载")`
  in Dispose before the executor/freezer teardown.

### Web (synced to all three deploy roots)

- `web/choreo-show-compiler.js` (new, pure, classic script) — ShowCompiler: consumes the
  canonical document via `ChoreoDocument.ensureDocument` (so WP-3 records and old drafts
  compile directly); emits protocol-v1 packages with integer-ms events, per-event performer
  ids, command lifted from the migrated `command` (fallback `data.command`), stable sort by
  startMs → priority → compile order, derived capabilities (movement/facing →
  `movement-control`, ability → `ability-execution`), deterministic FNV-1a `projectHash`
  over the canonical serialization, duration extended to the latest event end. Migration-era
  `_extra`/`legacyLane`/`data` never enter the package. Structural errors (executable event
  without performer / dangling performer ref) → `ok:false`; empty motion command → warning
  only (the plugin remains the single authority on rejection).
- `web/choreo-show-ui.js` (new) — 「🎬 演出执行」 panel in the ⋯高级 popup (button added in
  `choreo-recording-ui.js`): 编译并装载 → 就绪 → 开始（confirm + 3s countdown） → 紧急停止，
  status line + recent log polled from `/shows/status` (1.5s while open). Gated on
  `store.pluginCaps.shows` (honest "not supported" on old plugins) and `gameConnected`.
  `window.__showDebug()` headless hook compiles without sending.
- `web/choreo-helper-app.html` — script order: `choreo-show-compiler.js` after
  `choreo-docwire.js` (before the controller); `choreo-show-ui.js` last feature UI.
- `web/clip-check.html` — new section ㉟ (14 checks) freezing the panel protocol wiring:
  capability handshake both ways, refuse-when-disconnected, arm/start button gating by state,
  load request carries a protocol-v1 package compiled from the current project (integer ms,
  performer ids), start carries `countdownMs:3000`, stop always available, status line shows
  执行中+进度, `__showDebug` compiles with an 8-hex hash.
- `web/test-shell.js` / `scripts/make-release-staging.js` — new product files
  (`choreo-show-compiler.js`, `choreo-show-ui.js`) in the dependency-order assertions and the
  release whitelist; diagnostic `clip-check.html` correctly NOT whitelisted.

## Verification (all observed in this session)

- C#: datalayertest **357/357** (was 245; +112 EXEC-CORE checks: parser shape/caps/fractional-ms
  rejections, validator capability/kind/single-performer/command gates, scheduler order +
  exactly-once + frame-rate independence (16ms/500ms/single-frame identical dispatch order) +
  lead boundary, guard precedence/clock-jump boundary (> threshold, == passes), runner state
  rules (409 semantics), countdown→playing→planned-time dispatch→completion, replay-after-
  completed, countdown & mid-play emergency stop idempotency (cleanup counted exactly),
  guard trips (character lost / combat / clock jump) → Faulted with Chinese reasons,
  motion-failure stops the show vs lyrics-failure skips, dispatcher exception → Faulted no
  crash, **300s/300-event virtual show completes with jitter ≤ one 16ms frame and identical
  dispatch order under 200ms frames** (no chained-delay drift). Plugin Release build
  **0 errors / 0 warnings** (this surfaced the real Dalamud API differences: `LocalPlayer`
  lives on `IObjectTable`, `TerritoryType` is `uint`, cutscene flag is `WatchingCutscene`).
- Web: `test-showcompiler` **37/37** (protocol shape freeze incl. a byte-exact package
  baseline, migration inputs, determinism incl. key-order scrambling, capability derivation,
  structural errors, disabled/unknown kinds). All suites green: engine 47, edit 93, check 73,
  projects 96, document 83, docwire 45, library 91, **shell 41** (was 37), showcompiler 37.
- Browser: clip-check **148/148** on source-dist and game root (was 134; +14 EXEC ㉟ checks);
  offline-verify **45/45** (deployed copy boots clean with the new script order, 0 JS
  exceptions); library-verify **117/117**. One transient hang of offline-verify's first run
  (known un-timed CDP `send()` hazard, HYGIENE item) — rerun on a clean Chrome passed fully.
- Deploy: `choreo-helper-app.html`, `choreo-show-compiler.js`, `choreo-show-ui.js`,
  `choreo-recording-ui.js`, `clip-check.html` synced source → `web/dist/ChoreoHelper` →
  devPlugins root → game root; recursive `diff -rq` **zero vs both remote roots**; four-way
  md5 equal on the five files. C# and release staging untouched.

## Contracts to remember

- Two independent game channels: `/playback/*` (web-driven preview/freeze, PlaybackManager)
  and `/shows/*` (one-shot upload, explicit start, plugin local clock, ShowRunner). They do
  not call each other; `AnimationPoseFreezer` remains a called adapter, never the orchestrator.
- The plugin is the single rejection authority: the web compiler only warns; show load is
  rejected by `ShowValidator` with the authoritative Chinese reason.
- Unsupported requirement = safe stop **before** start: movement/facing/ability events (or
  their capability tags) fail validation, so the runner never sees them. When the movement /
  ability executors land, extend `SupportedExecutors` + the capability map on both sides and
  lift the ACTOR single-actor restriction deliberately.
- `RequestStop` only reacts from Armed/Countdown/Playing (else it is a no-op) so cleanup runs
  exactly once; design's "Stopping" is a transient under one lock, observable via status
  ordering, and the idempotency contract is test-frozen.
- Guard inputs the adapter cannot observe yet (manual takeover, movement error) are policy
  branches with tests but feed `false` — wiring them is part of the movement/input package,
  not free text claims.

## Owner tails (why they cannot be self-tested here)

1. **Live on-device acceptance** (design §10 last item): single action show, a show rejected
   for capability, countdown start, emergency stop, and a zone-change/combat stop need the
   game + the new DLL loaded — the live devPlugins DLL is untouched (still FIX-J
   `90759acf…`); the new code reaches the game only via the next owner-authorized DLL update.
2. **Real combat/cutscene/gpose observation**: the ICondition flags fire only in real game
   states; mock coverage proves policy, not live detection.
3. **Countdown/dispatch latency calibration**: `DispatchLeadMs` stays 0 until an on-device
   baseline exists (design §10: no fabricated millisecond promises).
4. Publication remains separately owner-gated (unchanged).
