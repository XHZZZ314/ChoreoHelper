# Execution Evidence Chain Design v1 (motion first)

> Status: owner-approved direction (2026-09-16 direction review following the external-plugin
> research session; registered as INT-20260916-EXEC-EVIDENCE-DIRECTION). Package P1 may start
> implementation via TASK-20260916-EXEC-EVIDENCE-P1-MOTION; P2–P5 are registered boundaries,
> not started work. All code citations below were verified against the working tree on
> 2026-09-16.

## 1. Problem — the motion evidence gap (verified code facts)

1. `ShowRunner`'s dispatch loop (src/ShowRunner.cs:601–647) writes `ExecutionLogEntry` with
   `Ok = r.Ok`; a motion `!r.Ok` Faults the whole show (src/ShowRunner.cs:641–644).
2. `GameShowDispatcher.Dispatch` (src/GameShowDispatcher.cs:43–48) calls
   `_executor.ExecuteCommand(e.Command)` — a `void` — and returns `Success()` unconditionally,
   so "enqueued" is reported as "sent".
3. `GameCommandExecutor.ExecuteCommand` (src/GameCommandExecutor.cs:92–117) silently drops
   commands on seven paths: (a) empty/whitespace; (b) `ChatCommandPolicy` rejection
   (log-only); (c) stale origin lease / failed origin guard; (d) `TryAcquireLegacy` refusal
   while an exclusive trial owns the output; (e) queue full → the OLDEST entry is dropped and
   its own evidence vanishes; at dequeue (src/GameCommandExecutor.cs:193–216): (f) older than
   5 s → expired drop; (g) stale origin/guard → drop. Native exceptions inside `ExecuteNow`
   (src/GameCommandExecutor.cs:224–234) are swallowed into an Error log.
4. `ExecutionLog` renders `Ok → 已发送` (src/ExecutionLog.cs:69); its own header documents
   that the confirm channel is missing ("当前版本只记发送侧").
5. The ability chain is NOT the gap: `AbilityNativeResponseObserver` hooks
   `ActionEffectHandler.Receive` (src/AbilityNativeResponseObserver.cs:23) and
   `AbilityExecutionLifecycle` correlates by actor/action/target + `SourceSequence` with an
   observation deadline and states pending/submitted/rejected/responded/casting/uncertain/
   interrupted/completed/cancelled (src/AbilityExecutionLifecycle.cs). P1 reuses this
   discipline for motion; it does not rebuild the ability side.

Owner ruling (2026-09-16): the most valuable new capability is completing the execution
evidence chain; the most worth verifying new technique is the input-reader override (P3); the
things NOT to copy are navigation advancement, auto-refire and wholesale bone override.

## 2. Evidence model

Chain per dispatched motion (and command-bearing lyrics) event:

`planned → queued(outcome) → native-submitted → matched state change → terminal`

| state | owner-facing render | meaning |
|---|---|---|
| queued | 已入队 | accepted into the command queue |
| queue-rejected | 入队被拒（原因） | never enqueued: empty / policy / lease / exclusive owner |
| dropped-oldest | 队列淘汰 | displaced by a full queue (the dropped victim's outcome) |
| dropped-expired | 过期丢弃 | older than the 5 s cap at dequeue |
| dropped-stale-origin | 租约失效丢弃 | origin lease/guard stale at dequeue |
| native-submitted | 已原生提交 | ProcessChatBoxEntry returned; NOT proof the game accepted |
| native-fault | 原生提交异常 | the native call threw (legacy queue keeps swallowing; now observable) |
| confirmed | 已确认（+Δms） | an expected state change correlated to THIS event |
| no-evidence | 超时未确认 | observation window elapsed without a match |
| mismatch | 证据不符 | another action started instead of the expected one |
| cancelled-by-stop | 停演取消 | show stopped/faulted/unloaded before a terminal evidence state |
| mapping-unknown | 无法映射预期 | expected emote id could not be derived; observation skipped |

Non-negotiable rules:

- Evidence is **record-only** in P1: it never changes `Ok`, never Faults the show, never
  skips an event, and never triggers re-execution.
- **No auto-refire/retry/resend of any command, ever** (owner ruling 2026-09-16).
- Correlation is strict: expected id + baseline (pre-dispatch `EmoteId` and base-slot
  timeline id) + observation window + single terminal adoption + per-ticket supersede guard.
  An old emote ending must never be adopted as this event's confirmation.
- `native-submitted` keeps the established wording discipline: submission ≠ the game accepted.

## 3. Package P1 — motion execution evidence (authorized to start)

### 3.1 Tracked command surface (additive)

- New overload `ExecuteCommandTracked(string command, GameOutputLease? origin,
  Func<bool>? originGuard) → CommandTicket` on `GameCommandExecutor`. The legacy
  `ExecuteCommand` delegates to it and discards the ticket — byte-identical observable
  behavior for every existing caller (`PlaybackManager`, walkreset, recording, HTTP paths).
- Queue entries carry the ticket id; dequeue, expiry, drop-oldest, stale-origin and the
  native call all report outcomes into a bounded pure evidence board (capacity ≥ queue cap,
  oldest-out with terminal supersede).
- All seven silent-drop paths from §1(3) must produce a ticket outcome.

### 3.2 Pure correlator (Dalamud-free, in datalayertest)

- A pure `MotionEvidenceBoard` (new src file, no Dalamud references) holds one record per
  ticket: EventId, expected emote id, baseline (EmoteId + base-slot timeline id), native
  submit mono time, observation window (constant, default 1500 ms, not configurable in P1),
  terminal state + Chinese reason + mono time. Exactly-once terminal; stop/unload marks
  cancelled-by-stop for every open ticket; ticket ids from a previous show are never adopted
  by a new show (supersede guard).

### 3.3 Game adapter (Dalamud-bound, not in datalayertest)

- Framework-thread observation of `LocalPlayer` `EmoteController.EmoteId` and the base slot
  current timeline id, through the SimpleHeels-derived slot access documented at
  src/AnimationPoseFreezer.cs:13.
- Expected-id mapping: command text minus the ` motion` suffix → Lumina `Emote` sheet
  `TextCommand` column → emote id. Unresolvable commands (including lyrics chat lines)
  report mapping-unknown — record-only, observation skipped, never a failure.
- The adapter is injected behind an interface so `ShowRunner` stays Dalamud-free (the same
  seam pattern as the guard provider, src/Plugin.cs:116–117).

### 3.4 Plumbing

- `ShowDispatchResult` gains `TicketId` (default `""`; the Success/Fail/Skip factories and
  all existing fields stay unchanged).
- `ExecutionLogEntry` gains additive evidence fields (state, reason, mono-ms). Entries are
  mutated only on the framework thread inside `ShowRunner.Tick`; `StatusJson` keeps reading
  under its gate (src/ShowRunner.cs:759–808).
- `StatusJson.recentLog` entries gain the additive evidence keys in ONE freeze revision —
  precedent: the TASK-20260911-X1-OFFLINE-FAILURE-POLICY additive skipped/skipClass/skipMarking
  revision of the same frozen string (src/tests/datalayertest/ShowGuardAvailabilityTests.cs).
  Existing keys and their order stay byte-identical; old JSON readers ignore unknown keys.
- `RenderTail` appends an evidence annotation segment ONLY when the dispatcher attached a
  ticket: a dispatcher that returns no ticket (today's behavior, FakeShowDispatcher) renders
  byte-identical `logText`. The base arrows 已发送/失败/已跳过 stay.
- Web consumers (`choreo-show-owned.js`, `choreo-stage-replay.js`, `choreo-show-entry.js`)
  change nothing; their suites must stay green unchanged.

### 3.5 Rollout

- Working tree only. DLL deployment, live-root install and real-game acceptance are
  owner-gated and outside the run.

## 4. P1 hard non-goals

- No change to Ok/Faulted/skip semantics: a queue-rejected or unconfirmed motion event does
  NOT stop the show in P1. Moving from record-only to a policy is a P2 owner decision gated
  on real samples.
- No scheduler/`DispatchLeadMs` change; no X1 admission change; `ShowProtocol`,
  `ShowValidator`, `HttpServer` routes and the capability string stay byte-unchanged except
  the additive `StatusJson` fields.
- No `web/**` edit, no Exporter edit, no SPEC edit (REQ-SPEC-017 stays open and unchecked).
- No movement/facing/ability evidence rework; the ability lifecycle chain stays untouched.

## 5. Registered follow-ups (boundaries only; each needs its own owner-enabled ticket)

- **P2 Delay sampling & diagnostics**: measure queue wait / submit→state-change /
  state-change→expected visual beat using P1's timestamps; per-action tables only after
  stable samples (with sample size, variance, client version); adopting per-event lead times
  REQUIRES redesigning the scheduler around actual send deadlines (ordering, same-tick
  priority, dependencies, throttle interaction).
- **P3 Movement-vector backend experiment**: input-reader-override mechanism
  (vnavmesh `OverrideMovement` as mechanism inspiration only — no code copying, the upstream
  repo carries no license). Bounded question: same character, same movement settings, same
  short path — lower trajectory error and jitter while keeping independent facing, manual
  takeover and stop reliability. Metrics: trajectory error, arrival time, facing error,
  post-stop residual movement, takeover response. CN client signature verification is
  mandatory; enablement-gated behind the X1 owner flow.
- **P4 Redraw/pose recovery regression**: reproduce equip-change/redraw first; recovery
  contract = re-confirm actor/skeleton/binding, then restore the pinned time; safe-exit when
  unconfirmable; decide on any new hook only after reproduction.
- **P5 Region capability + ensemble error decomposition**: catalog/check knowledge of
  body-region occupancy per action (full-body / upper-body / expression …); ensemble panel
  separates clock-alignment error / local submission lateness / local action-response
  lateness; a game-shared-event coarse alignment stays a research candidate, never a second
  start source.

## 6. P1 verification

- datalayertest: a new `motion-evidence` scenario covers the board matrix (all seven drop
  paths, throttle cadence, drop-oldest victim reporting, native-fault) and the correlator
  matrix (≥ 12 cases: confirm-after-submit; old-emote-end-then-expected; mismatch; window
  expiry; stop-cancel; double-adoption refusal; pre-submit observation ignored;
  mapping-unknown; supersede guard; record-only assertions). `status-json-freeze` is revised
  once and green; the full suite and `x1-composite-dispatcher` parity stay green.
- Web compatibility without edits: `node web/test-show-owned.js`,
  `node web/test-stage-replay.js`, `node web/test-show-entry.js` stay green with zero
  `web/**` diffs.
- Plugin Release build green.
- Real-machine acceptance (owner-gated, outside the run): one show with a visible motion
  shows 已确认; a policy-rejected command shows 入队被拒; a burst faster than the 200 ms
  cadence shows truthful queue states; no observable dispatch-behavior change.
