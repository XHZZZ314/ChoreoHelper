# ChoreoHelper Product Charter and Version Roadmap (2026-08-29)

> Status: long-term direction confirmed by the owner. Constrains version scope and scheduling; when implementation details change, the product boundaries here must stay intact, or the owner's approval must come first.

## 1. Product Definition

ChoreoHelper is a local-first integrated performance workstation for FF14 CN players, covering choreography, rehearsal and game execution: plan actions, abilities, movement, facing, lyrics, local music and beats in a web page, rehearse offline with a 3D character, and let the plugin preview or execute in game when needed. One macro-independent performance script is the single standard model; the normal flow never depends on native in-game macros, which remain a limited import/export compatibility format only.

Standard workflow:

1. The player opens the static website or local entry and can edit existing projects without launching the game.
2. On first use, connect the plugin to fetch the action/ability catalogs and skeleton, and record personal action clips as needed.
3. Edit the timeline, music beats, and stage paths in the web page.
4. Run the "choreography health check" and fix anything the game cannot execute or that is prone to failure.
5. Rehearse in web 3D first, then run single-event in-game tests and full rehearsals.
6. Export the whole project or one performer's show package; personal models and personal action data are not included in show packages by default.

## 2. Scope and Boundaries

### Must Do

- Multi-project center, autosave, version restore, and local backup.
- A unified timeline for actions, abilities, movement, facing, beats, and lyrics.
- A local personal action library and Meddle model import.
- 2D stage top view, 3D multi-angle preview, and in-game rehearsal.
- FF14 execution-condition checks, timing-conflict checks, and a locatable problem list.
- Per-performer show packages, missing-action lists, and start-point calibration instructions.
- Player-initiated one-shot performance execution, plus an always-available emergency stop.
- GitHub Pages static site, GitHub Releases plugin package, and a custom plugin repo.

### Explicitly Not Doing

- Commercialization, ads, payments, donations, or sponsorship features.
- Community submissions, public template libraries, online asset markets, public leaderboards.
- Login, accounts, cloud projects, cloud models, cloud action libraries, telemetry.
- Background AFK, looped auto performances, combat strategy, auto targeting, auto ability loops, PvP features.
- Remotely controlling another computer from the web, or manipulating multiple player clients at once.

Local-file-based project sharing and per-performer show packages are baseline portability, not community submissions or a template library.

## 3. Product Capability Structure

### A. Projects and Editing

- Multi-project create, rename, duplicate, delete, recent list.
- Autosave and recoverable local history versions.
- Undo/redo, multi-select, box select, copy/paste, batch move, alignment, insert/delete time.
- A/B loop, section markers, per-performer solo/mute, one-click jump to problems.

### B. Music and Beats

- Read only the player's local audio; never upload.
- Waveform, BPM, time signature, start offset, beat grid, count-in, beat snapping.
- Action key poses can align to beat points, not only to action start times.

### C. FF14 Actions and Abilities

- Actions record one-shot/persistent/posture/facial type, loop period, reset method, and key poses.
- Abilities record job, level, target, cast, cooldown, move-while-casting, and scenario restrictions.
- The catalog clearly shows owned / recorded / executable / needs conditions / not executable.
- Ability effects the web cannot reproduce are replaced with icons, ranges, and hints; the in-game rehearsal is the final authority.

### D. Stage and Movement

- Use "stage origin + front direction" to build a portable relative X/Z coordinate system.
- Straight lines, polylines, curves, path nodes, arrival times, speed, facing, tolerance.
- Support the player manually walking a route in game, recording it as a path, then simplifying and editing it.
- Keep action skeletal root displacement separate from character world movement to prevent double displacement in preview.

### E. Rehearsal and Execution

- Four rehearsal layers: web single action, web full 3D, game single event, game full show.
- Pre-show checks of job, abilities, actions, start point, facing, plugin version, and run state.
- The plugin executes the full show package on a unified clock; it does not depend on the browser sending per-frame commands.
- Emergency stop, manual-input takeover, automatic stop on anomaly, and a readable execution log.

## 4. Version Roadmap

| Version | Theme | Must complete | Estimated cycle |
|---|---|---|---|
| v0.6.7 | Public release foundation | Stage 4 on-device acceptance; HTTP method and OPTIONS security; CORS/pairing; capability handshake; model selection; standalone staging; reproducible build | 1–2 weeks |
| v0.7 | Long-term usable editor | Project center; autosave versions; redo; multi-select and batch editing; A/B loop; first choreography health check | 2–3 weeks |
| v0.8 | FF14-specific performance model | action/ability/movement/facing events; data migration; ability conditions; music and beats; 2D stage; path recording and editing | 3–4 weeks |
| v0.9 | In-game execution beta | show compiler; plugin scheduler; action/ability execution; basic movement; emergency stop; execution log and drift diagnostics | 4–6 weeks |
| v1.0 | Stable for ordinary players | install and upgrade; old project migration; compatibility hints; onboarding; full regression; stable channels for public site and plugin | 2–3 weeks |
| v1.1 | Multi-performer rehearsal | performer show packages; start point/countdown sync; movement correction; optional vnavmesh adapter; multi-player deviation diagnostics; eight-performer acceptance first, 24 players only as a measured later target | 4–6 weeks |

This is a rough estimate for solo development plus on-device acceptance. Scheduling is gated by passing version thresholds, not by forcing release dates.

Owner-approved mainline sequencing (2026-09-01, INT-20260901-PERFORMANCE-WORKSTATION): the first editor milestone is native lossless round-trip persistence for all six track kinds — motion, ability, movement, facing, cue, lyrics — together with explicit eight-performer authoring and rehearsal acceptance; no work item extends toward the 24-player target before that gate passes, and 24 players remain a measured later target, not an implementation promise. The first execution milestone is single-client skills, movement and facing with manual takeover, local emergency stop and real-game acceptance; playlists, per-actor sub-packages, per-player local pairing with explicit Ready, LAN session-clock synchronization, scheduled show start and deviation diagnostics appear only after it (design contract: `DESIGN-ensemble-sync.md`).

## 5. Version Management Rules

- `appVersion`: web product version.
- `pluginVersion`: plugin assembly version.
- `protocolVersion`: web↔plugin communication protocol.
- `schemaVersion`: project and show package data format.
- `librarySchemaVersion`: personal 3D library format.

On release:

1. `main` is always buildable; use short-lived feature branches, no long-lived `develop`.
2. Only two public channels exist: `beta` and `stable`.
3. One Git tag produces the website, plugin ZIP, plugin manifest, and SHA-256 checksum files.
4. The website recognizes at least the current and previous protocol versions; on incompatibility it shows a clear upgrade prompt.
5. Auto-backup before data migration; a failed migration never overwrites the original project or library.
6. GitHub Pages publishes only whitelisted static assets; the diagnostics page, snapshots, private models, action data, and local paths never enter the package.
7. Each version carries exactly one theme; until its threshold passes, do not merge the next version's big features early.

## 6. Minimum Quality Bar for Public Releases

- New users reach the built-in demo within 30 seconds, without launching the game first.
- After connecting the plugin, version, permissions, library, and character state are clearly visible.
- No write endpoint ever gains side effects from a browser OPTIONS preflight.
- Closing the game or plugin never corrupts projects; reopening allows continued editing.
- A 5-minute show does not accumulate drift from chained delays.
- Manual takeover or emergency stop immediately terminates auto movement and subsequent events.
- Every failure shows performer, time, event, and a plain-language reason.
- Projects, models, actions, and audio stay on the local machine by default.

## 7. Directional Technical Decisions

- No React/Vue migration; first split the existing vanilla JavaScript into classic-script modules by responsibility, keeping `file://` compatibility.
- The performance script is the single standard model; web preview, game execution, and native macro export are all consumers of it.
- The plugin runner has no hard dependency on external plugins; all external capabilities come in through optional adapters.
- Precise stage movement prefers our own closed-loop control; navigation plugins fit better as optional pathfinding backends and do not define choreography paths.
- Auto-execution is expected to ship via a custom plugin repo; getting into any official repo is not a version goal.
