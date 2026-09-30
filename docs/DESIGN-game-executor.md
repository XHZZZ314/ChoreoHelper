# In-Game Performance Executor Design Rules

> Target version: v0.9 onward. This document defines the execution architecture and safety boundaries; it does not mean the current code already has automatic movement.

## 1. Executor Responsibility

The plugin executor only executes the performance script already compiled by the web page. It does not make combat decisions, choose abilities, find targets, or auto-loop shows on the choreographer's behalf.

One full execution flow:

```text
网页体检并编译
  → 一次性上传演出包
  → 插件二次校验
  → 校准舞台与起点
  → 玩家点击开始
  → 倒计时
  → 插件本地时钟执行
  → 完成或安全停止
```

*(Web health-check and compile → one-shot show package upload → plugin-side re-validation → calibrate stage and start points → player clicks start → countdown → plugin local-clock execution → completion or safe stop.)*

The browser must not send per-frame movement commands during playback. Browser sleep, backgrounding, or closing must never cause loss of character control.

## 1b. Execution milestone order (owner-approved 2026-09-01)

The first execution milestone is single-client skills, movement and facing — ability, movement and facing events for the one local performer — with manual takeover, local emergency stop and real-game acceptance. The current validator accepts only motion, cue and lyrics and rejects ability, movement and facing packages before start, so this milestone requires new executors and guard inputs, not just data plumbing.

Later milestones start only after that first milestone passes: performance playlists (sequences of shows), per-actor sub-packages, per-player local pairing with explicit Ready, LAN session-clock synchronization, scheduled show start and deviation diagnostics. Their multi-client coordination design is `DESIGN-ensemble-sync.md`. Every added capability keeps the boundaries above: one player-started performance, manual takeover and emergency stop always available, no combat decisions, no auto-targeting, never PvP.

## 2. State Machine

Fixed states:

- `Idle`: no loaded show.
- `Loaded`: show package passed format validation.
- `Armed`: character, job, stage, start point, and permission checks passed.
- `Countdown`: counting down; cancellable at any time.
- `Playing`: executing on the unified clock.
- `Stopping`: stop movement, cancel unexecuted events, clean up action state.
- `Completed`: finished normally.
- `Faulted`: an error occurred and a safe stop has been performed.

A state receiving the emergency stop must always enter `Stopping`, then return to `Loaded` or `Idle` after cleanup.

## 3. Code Boundaries

Gradually establish the following C# boundaries; do not pile everything into one class:

- `ShowProtocol`: DTOs, versions, JSON validation.
- `ShowValidator`: plugin-side recheck of capabilities, character conditions, and event conflicts.
- `ShowRunner`: state machine and unified clock.
- `EventScheduler`: decides which events to dispatch at a given time; does not directly control the game.
- `IActionExecutor`: emotes and normal actions.
- `IAbilityExecutor`: ability execution with returned results.
- `IMovementExecutor`: path start, update, stop, status.
- `IFacingExecutor`: facing control.
- `RuntimeGuard`: stop conditions — combat, cutscenes, map change, character loss, manual input, etc.
- `ExecutionLog`: planned time, dispatch time, result, and reason.

First provide game-independent unit tests for clock, scheduling, and movement math, then connect the Dalamud services.

## 4. Clock and Scheduling

- Use a monotonic clock, never system wall time.
- All events are computed as "show start moment + startMs"; never chain `Task.Delay`.
- The game framework checks due events each frame; multiple events in the same frame execute in a fixed priority order.
- Suggested priority: stop/protection > facing preparation > movement state > actions/abilities > prompts.
- Record planned vs actual dispatch time and compute jitter and drift.
- Whether the game server accepts, and when the animation visibly appears, differ from local dispatch time — the log must distinguish "dispatched" from "confirmed state change".

## 5. Action and Ability Execution

- Emotes default to the `motion` variant, avoiding chat spam and target effects.
- Persistent, posture, and loop actions reuse the already field-tested interrupt/reset knowledge.
- Re-check job, level, target, cast, cooldown, and current controllability before executing an ability.
- No automatic target search, no ability selection based on enemy state, never enabled in PvP.
- Single event failure follows the compiled policy: stop or skip; the default is to stop the whole show on movement and critical-ability failure.

## 6. Movement Execution Strategy

### First Backend: Own Stage Movement Controller

Choreography needs "walk a specified line at a specified time", which differs from general navigation's "find some route that reaches the goal". The first backend should:

- Read local character position and facing every frame.
- Produce movement/turn input from the target waypoint, current error, and remaining time.
- Cap maximum correction to avoid sudden reversals or large detours.
- Detect stuck, manual input, map change, and character-uncontrollable states.
- Stop and report when arrival error exceeds limits, instead of chasing points forever.

Official show movement must never be implemented via teleport or direct world-coordinate writes.

### Optional Backend: vnavmesh Adapter

Upstream vnavmesh publicly exposes path computation, `Path.MoveTo`, `Path.Stop`, and status IPC, so optional integration has a technical basis:

- https://github.com/awgil/ffxiv_navmesh/blob/master/vnavmesh/IPCProvider.cs

But it is an optional capability only:

- Probe the plugin and IPC version first; if absent, ChoreoHelper core functionality is unaffected.
- Never copy upstream assemblies into this project.
- CN Chengyue (Orange Moon launcher) compatibility must be verified on a real machine.
- It suits complex-venue reachability and pathfinding; it does not guarantee strict adherence to stage-art curves.

### Optional Export: Something Need Doing

Something Need Doing already provides extended macro and Lua scripting capabilities, usable later as a reference for one export format:

- https://github.com/Jaksuhn/SomethingNeedDoing

ChoreoHelper does not make it a dependency, and never hands user scripts to it for execution bypassing this project's health checks and stop protection.

## 7. Runtime Protection

Stop all movement and cancel unexecuted events immediately when any of the following occurs:

- The player presses the emergency stop hotkey.
- Player manual movement or active takeover is detected.
- The current character disappears, changes map, hits a loading screen, enters a cutscene, or becomes uncontrollable.
- Entering combat, a duty instance, or PvP; if the owner later adjusts this scope, it needs separate design and confirmation.
- Plugin unload, exception, corrupted show package, or clock jump.
- Movement error persistently over limit, character stuck, or unable to arrive.
- The web sends a mismatched session, version, or stop request.

Stopping must be idempotent: repeated calls never re-trigger movement, actions, or exceptions.

## 8. Local HTTP and Pairing Rules

Before adding execution endpoints, fix the current 48794/48795 security base:

1. `OPTIONS` may only return the preflight response and must never enter business handling. The current implementation needs focused regression on `/export/walkreset` to prevent a preflight from triggering movement and key injection.
2. Every endpoint uses an explicit method whitelist; GET never changes game state.
3. CORS allows only local entries and the owner-determined official GitHub Pages origin; never `*`.
4. All write endpoints require a short-lived session token; the token is displayed/confirmed in the game plugin UI, never written into URLs or logs.
5. Limit request body size, frequency, and concurrency; only one recording or show session at a time.
6. Listen only on the local loopback; no LAN remote control.

Suggested new protocol endpoints:

- `GET /capabilities`: versions, protocol, capabilities, read-only status.
- `POST /pair`: session pairing after local user confirmation.
- `POST /shows/validate`: plugin-side precheck, no execution.
- `POST /shows/load`: load and validate a full show package.
- `POST /shows/arm`: calibration and pre-show condition checks.
- `POST /shows/start`: accepts only Armed sessions.
- `POST /shows/stop`: idempotent emergency stop.
- `GET /shows/status`: read-only status and latest error.

Exact paths may be adjusted before implementation, but the capability handshake, sessions, method whitelists, and side-effect-free OPTIONS are non-negotiable.

## 9. Publishing Boundary

Dalamud's official documentation lists automated interaction and emote loops as unacceptable common directions:

- https://dalamud.dev/plugin-publishing/restrictions/

Therefore product planning defaults to publishing the auto-execution build via a GitHub custom plugin repo; getting into an official repo is not an acceptance criterion. The UI must clearly state this is a locally run rehearsal tool started by the user, and execution capability is off by default.

## 10. Testing and Acceptance

Build at minimum:

- Fake-clock scheduling tests: event order and planned times identical across frame rates.
- Five-minute virtual show: no cumulative drift from chained delays.
- State machine tests for repeated start, stop, exception, unload.
- Manual-takeover and stop tests for every RuntimeGuard condition.
- Pure-math path-following tests: straight lines, polylines, curves, timeout, stuck, error over limit.
- Degradation tests for missing external adapter, version mismatch, and mid-run disappearance.
- Method, OPTIONS, origin, token, size, and concurrency tests for all write endpoints.
- On-device acceptance: single action, ability-condition failure, short path, curved path, emergency stop, map-change stop.

Suggested target values get fixed after an on-device baseline; no exaggerated millisecond-precision promises before measurement.
