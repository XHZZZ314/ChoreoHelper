# Ensemble Synchronization Design (locally authorized multi-player rehearsal)

> Status: design contract only; nothing in this document is implemented. Per the owner-approved
> sequencing (INT-20260901-PERFORMANCE-WORKSTATION), this work starts only after the first execution
> milestone — single-client skills, movement and facing with manual takeover, local emergency stop
> and real-game acceptance — has passed (`docs/WORKPLAN-20260829.md` gate X1). The first ensemble
> target is the eight-player authoring/rehearsal acceptance gate; 24 players remain a measured later
> target, not an implementation promise.

## 1. Roles

- **Performer (every participant).** Runs the same local ChoreoHelper web app + plugin on their own
  machine and client. Each performer loads, validates, arms and starts their own show package. There
  is no "conductor client" with special authority over another player's game.
- **Director (optional, revocable, per-session).** A role any performer may additionally hold for
  one rehearsal: proposes the session plan (who performs which per-actor package, session zero,
  schedule), relays status summaries and compiles the post-show deviation report. The director
  distributes files and timing information; it never sends in-game commands to another client and
  never holds another player's credentials, tokens or pairing state.
- **Session coordinator process (logic, not authority).** The clock-offset exchange and Ready
  accounting are pure bookkeeping. They can only observe what clients voluntarily report and can
  only delay the *announcement* of a start time; they can never force, cancel or interfere with any
  client that has started or stopped locally.

## 2. Trust and authorization boundaries

- Trust is per-player, local and revocable. Joining a session means "I will exchange show-package
  files and timing messages with these named players over this transport", nothing more.
- No credential centralization: pairing tokens, plugin sessions and game credentials never leave the
  player's machine. The director holds no token that is valid on another player's plugin.
- The exchange transport reuses the existing local security posture: explicit allowlisted origins,
  method whitelists, pairing-gated writes, and no LAN remote control. A session adds message types
  for package distribution, clock estimation, Ready accounting and status; it never adds an endpoint
  that drives another player's character.
- Every message that can influence execution is advisory on the receiving side: the receiving plugin
  re-validates its own package, its own guard conditions and its own state machine before acting.

## 3. Per-actor package identity

- The compiler already emits per-performer event subsets (`DESIGN-performance-script-v1.md` §13).
  Ensemble work makes the per-actor sub-package the unit of distribution: `actorId`, project ID,
  content hash, `schemaVersion` and required protocol/capability versions travel with each package.
- A performer's plugin accepts only the package addressed to their `actorId`, verifies the content
  hash locally, and refuses packages whose required capabilities the local installation does not
  satisfy — the same rejection authority the plugin already holds for single-performer packages.
- Two performers never share one package file identity; identical events duplicated across performers
  remain separate per-actor packages so one player's edit cannot silently change another's show.

## 4. Local pairing and explicit Ready state

- Each player completes the existing local pairing on their own machine, loads their own sub-package,
  runs the pre-show checks, arms, and then sets **Ready** as an explicit local action.
- Ready can be set and cleared only in that player's UI. No message from the director or another
  performer can set, fake or clear it. The start announcement is only *proposed* to players who are
  locally Ready; a player who is not Ready is simply not started.
- Ready state is per-show-run: after a stop, fault or edit, every player returns to not-Ready and
  must re-arm and re-Ready explicitly.

## 5. Monotonic session-clock estimation

- Every client already executes its show on its own plugin-local monotonic clock
  (`DESIGN-game-executor.md` §4). Ensemble sync adds a session zero: one agreed future instant that
  each client maps onto its own monotonic clock.
- Session-zero transfer uses a ping/offset exchange (each client measures round-trip time to the
  coordinator and derives a bounded offset estimate, the same class of algorithm as NTP/SNTP
  smoothing). Estimates are re-measured periodically; wall-clock time is never used for dispatch.
- Each client converts "session zero + event startMs" into its own monotonic timeline and executes
  exactly as it does today, so ensemble mode reuses the proven scheduler instead of adding a new one.
- Clock-jump guard: if a client's offset estimate changes beyond tolerance after arming, that client
  treats it as a guard condition and stops locally rather than drifting.

## 6. Scheduled start

- The director (or any agreed player) proposes a scheduled session start: session zero plus a
  countdown long enough for every client to complete arming.
- A client accepts a scheduled start only while locally Ready; the countdown then runs locally on the
  client's monotonic clock, exactly like today's single-player countdown. If arming or Ready is lost
  before session zero, that client does not start and reports locally.
- Start is therefore N independent local decisions aligned by a shared estimate — never one command
  that triggers N clients.

## 7. Cancellation

- Cancellation is local-first: any player can cancel their own participation at any time before or
  during the show, with exactly-once stop cleanup, without asking the director.
- Before session zero, a cancellation from any Ready player halts the start announcement for everyone
  (no one has started; this is safe). After the show has started, other clients keep performing: a
  missing performer is a deviation (§9), not a trigger to remote-stop anyone else — each client
  decides locally, per its compiled failure policy.
- Cancellation is idempotent and safe to repeat; it never leaves a half-armed session.

## 8. Reconnect and failure behavior

- A client that drops (network loss, game crash, plugin unload) falls back to local solo behavior:
  its own RuntimeGuard conditions stop its show locally, exactly as in single-player execution.
- Rejoin always requires the full local sequence again — reconnect, re-pair if needed, reload the
  per-actor package, re-arm, re-Ready. A client never auto-resumes into an already-running session.
- The coordinator only relays "this performer has not reported since T"; it never marks a player as
  failed on behalf of that player's own client.
- Coordinator loss is non-fatal: with session zero already distributed and offset estimates stable,
  every started client completes its show independently; a session without a coordinator simply
  cannot schedule a *new* start or produce the merged report until it is restored.

## 9. Deviation diagnostics

- Each client logs planned vs actual dispatch, dispatch-vs-confirmed state, clock-offset estimates
  and per-event deviation to its local execution log (extending the existing execution log contract).
- The director may collect per-client summaries after the show into one merged deviation report
  (who arrived late, where, by how much) — post-show analysis, never live remote correction.
- Deviation beyond the compiled tolerance is surfaced to that performer locally and stops that
  performer per its failure policy; it is never silently hidden from the report.

## 10. Protocol and capability versioning

- Session messages carry a session-protocol version plus the per-client capability set already
  exposed by `/capabilities` (app, plugin, protocol, feature versions).
- Incompatible clients are excluded at join time, before any start is scheduled — never upgraded or
  renegotiated mid-show. A capability mismatch yields a plain-language reason (missing executor,
  old protocol, missing feature flag).
- Version skew rule: a client that does not understand a session message ignores it and reports the
  gap locally; unknown message types never alter execution state.

## 11. Local emergency stop

- Every client keeps its own emergency stop hotkey and all existing RuntimeGuard stop conditions.
  Ensemble participation can never delay, veto or override a local stop.
- A local stop stops that client only; it is announced to the session as a status event. Other
  clients react solely through their own compiled failure policy and their own player's decision.

## 12. Rollback

- Stopping is idempotent and returns the client to `Loaded` (or `Idle` after unload), the same state
  machine as single-player execution; no new persistent state is introduced by a session.
- Session artifacts are local and disposable: received per-actor packages, offset logs and Ready
  history can be deleted by their owner at any time. There is no shared mutable server state to roll
  back beyond each client's own local log.
- A failed or cancelled session leaves every client exactly as a locally stopped show would —
  personal data, projects and library untouched.

## 13. Permanent non-goals (unchanged)

- No remote control of another player's client, no central possession of player credentials, no
  bypass of per-player local pairing, explicit Ready or local emergency stop.
- No accounts, cloud personal data, telemetry, community template libraries or commercialization.
- No AFK loops, combat decisions, auto-targeting or PvP; one player-started performance per client
  with manual takeover remains the entire automation surface.
- Native FF14 macros stay a limited import/export compatibility format, never part of the normal
  choreography, rehearsal or execution flow.
