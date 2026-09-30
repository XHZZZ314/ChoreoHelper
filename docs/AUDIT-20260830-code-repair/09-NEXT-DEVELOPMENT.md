# 09: Product Development Order After Repairs

This file only describes how to continue once this repair package set is cleared; detailed product definitions remain governed by `SPEC.md`, `docs/PRODUCT-ROADMAP-20260829.md`, `docs/DESIGN-performance-script-v1.md`, `docs/DESIGN-game-executor.md`, and `docs/WORKPLAN-20260829.md`.

## 1. Hard Gates for Entering WP-5

- FIX-A~FIX-E all complete, with no unexplained P0/P1 leftovers.
- online, transition, sync, real-game seek, recording commit, and hot reload pass live verification.
- Two-character same-named clip isolation and the CHLB v2 round trip pass.
- OPT-F may have low-priority items deliberately deferred after measurement, but no data loss and no linear GPU leaks.
- Current source/deploy/docs consistent; whether release staging is rebuilt does not block development, but the old 0.6.7 staging must stay marked non-releasable.

## 2. WP-5: Unified Performance-Script Schema and Migration

FIX-B/FIX-D must first provide the schema these stable concepts:

- `actorId`: whom an event belongs to — no more implicit local-player via a global flat array.
- `eventId/type/start/duration`: actions, switches, lyrics, skills, movement, facing, and stage cues get explicit types.
- Continuous state and discrete side effects separated: seek evaluates only continuous state, never replays lyrics/skills.
- `assetRef`: action references use profile/clip identity, not just a `/bow` name.
- `timelineRevision`: web, plugin, and run logs can confirm they use the same script version.
- `schemaVersion` and pure migration functions: old projects load read-only then upgrade losslessly; unknown fields are preserved or explicitly rejected.
- Command fields must pass FIX-B's unified security policy — no schema-level bypass.

WP-5 minimum acceptance: old schema-2 project migration, save/reopen, import/export, undo/redo, web playback, and the game snapshot protocol all consistent.

## 3. WP-6: Music, Beats, Stage, and Path Editing

Implement local audio and stage data per the product boundary; nothing uploads to a server:

1. Local audio import, waveform, beat points, BPM/offset calibration.
2. Relative stage coordinates, start point, paths, speed, arrival time, and facing.
3. The 2D stage editor and the existing Three.js 3D preview share one continuous-state evaluator.
4. The file:// entry cannot fetch/import local modules; new assets must keep supporting classic scripts or the existing offline mechanisms.
5. Large audio / long timelines need performance and storage caps; never stuff Blobs into the localStorage mirror.

## 4. WP-7: Skill Catalog and FF14 Feasibility Rules

1. Build data models for job, level, target, cast, cooldown, movement limits, and scene limits.
2. Health-check rules rely only on explainable data; unknown conditions report "uncertain" — never pretend executability.
3. Skill events never execute during seek by default.
4. Catalog updates bind to game versions; offline snapshots carry version and source notes.

## 5. WP-8: Plugin Performance Runner

1. Executes only one performance explicitly started by the player.
2. Uses a local unified monotonic clock, supporting countdown, pause, resume, emergency stop, and manual takeover.
3. Event scheduling reuses FIX-B's type semantics and revision — never write a second timeline interpreter.
4. All game object access obeys FIX-E's framework thread contract.
5. All commands obey FIX-B's server-side boundaries; logs readable, bounded, and traceable to events.
6. No idle looping, combat decisions, auto-targeting, or PvP.

## 6. WP-9: Stage Movement Executor

- Build pure path evaluation and conflict health checks first, then connect game execution.
- vnavmesh, Something Need Doing, etc. can only be optional adapters — never core hard dependencies.
- Emergency stop, manual input takeover, timeout, and unreachable handling are mandatory.
- Any OS input injection must have a release backstop at FIX-E's level.

## 7. WP-10: Public Stability and Later Multi-Actor

1. Complete install, upgrade, protocol compatibility, data migration, privacy scan, and disaster-recovery drills.
2. Generate staging for the current version; only after the owner accepts it does separate authorization cover GitHub Pages, Release, and the custom plugin repo.
3. Multi-actor builds on actorId, asset identity, and per-actor seek/execution models — never pile features onto v0.7's global clip-name structure.
4. The product stays local-first: no accounts, cloud saves, telemetry, commercialization, or public template libraries.

## 8. Questions Every New Package Must Answer

- What can users see and accomplish?
- Is the data format migratable and recoverable?
- Does the web offline entry still work?
- What are the seek, normal-playback, and game-execution semantics for this event, respectively?
- Which behaviors control the game, and how are they stopped and taken over?
- What compatibility impact on old projects, old libraries, old backups, and the plugin protocol?
- What do automatic tests cover, and what must the owner confirm live?
