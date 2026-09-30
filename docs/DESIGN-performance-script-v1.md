# Performance Script Data Model Design Draft v1

> Target version: v0.8. This document defines the model and compatibility principles; it does not mean the current code implements them.

## 1. Core Terms

- **Choreography project**: the complete project the user edits and saves — dancers, music, lyrics, timeline, and stage info.
- **Performance script**: normalized platform-independent timed events derived from a project; the common input for web preview and game execution.
- **Show package**: a portable file compiled for one or more performers, containing the script, requirement lists, and checksum info; personal models, bone clips, and audio are not included by default.
- **FF14 native macro**: an export format with limited capability, suitable only for some actions/abilities; does not support precise stage paths.

## 2. Top-Level Structure

The target project structure uses explicit versions and stable IDs:

```json
{
  "schemaVersion": 2,
  "projectId": "uuid",
  "name": "未命名演出",
  "durationMs": 60000,
  "timing": {},
  "stage": {},
  "performers": [],
  "tracks": [],
  "lyrics": [],
  "markers": [],
  "metadata": {}
}
```

Rules:

- Time is uniformly integer milliseconds; the UI may display seconds or beats, but floating-point seconds must never be the persistence primary key.
- Every project, dancer, track, and event has an ID that never changes due to reordering.
- Events are sorted by `startMs`, but array order carries no identity meaning.
- Unknown fields are preserved on import as much as possible; unrecognized event types must be disabled with a notice, never silently deleted.
- All migrations copy the old structure into a new one and swap only after success; on failure the original file is kept.

## 3. Time and Music

`timing` contains at least:

- `bpmMap`: possibly multiple BPM segments, each with a start time and BPM.
- `timeSignatureMap`: time signature changes.
- `audioOffsetMs`: difference between the audio zero point and the show zero point.
- `countInBars`: number of count-in bars.
- `snapMode`: time, beat point, action edge, or off.

Audio is stored only as a local reference plus an optional file fingerprint, never inside normal show packages; when the user explicitly chooses "bundle audio", copyright and size warnings are handled separately.

## 4. Stage Coordinates

The project stores only stage-relative coordinates:

- Origin `(0, 0)`: the stage center the user calibrates in game, or a self-chosen reference point.
- `stageYaw`: the stage front direction relative to the game world.
- Plane axes: `x` is stage left-right, `z` is stage front-back, in meters.
- `y` exists only for venues with explicit elevation; the first-version editor locks to the ground by default.

Before game execution, the plugin transforms stage coordinates into current-map world coordinates. A project must not store the owner's housing, a map instance, or absolute world coordinates as its portable basis.

## 5. Dancers and Tracks

Each dancer contains:

- `id`, display name, color, notes.
- Optional job, level, and gear-state requirements.
- Show start point `(x,z)`, starting facing, and allowed error.
- The current user's executor character identity is stored only as a local mapping, never written into shared show packages.

Track types are fixed as:

- `motion`: emotes, dances, postures, skeletal actions.
- `ability`: job abilities, general actions, visible-effect actions.
- `movement`: world position paths.
- `facing`: independent facing and gaze targets.
- `cue`: countdowns, prompts, stage events.
- `lyrics`: lyric display; may remain a global track.

Actions, abilities, and movement must be on separate tracks, because their execution conditions and conflict rules differ.

## 6. Common Event Fields

All events contain at least:

- `id`, `kind`, `startMs`, `durationMs`.
- `enabled`, `locked`, `notes`.
- `sourceRef`: stable references such as action ID, ability ID, recorded clip ID.
- `createdWith`: app version for troubleshooting; not part of execution decisions.

Never use display names as the sole reference. Names can change with CN localization and game versions; execution prefers game data IDs and keeps command text as a compatibility fallback.

## 7. Action Events `motion`

Dedicated fields:

- `emoteId`, `command`, `clipId`.
- `playMode`: `once`, `loop`, `persistent`.
- `interruptPolicy`: natural end, takeover by next action, movement interrupt, or specified reset.
- `resetAction`: none, normal interrupt, `walkreset`, or user manual.
- `accentMs`: time of the action's key pose relative to the action start.
- `startPoseTag`, `endPoseTag`, body region, direction, intensity, and other analysis tags.

Recorded clips keep living in the personal library; the project only references clips. When a show package lacks a clip, game execution is allowed, but the web 3D view must display "missing local preview data".

## 8. Ability Events `ability`

Dedicated fields:

- `actionId`, command fallback text, target rules.
- `requiredJob`, `requiredLevel`.
- `castMs`, `recastMs`, animation-lock estimate.
- Whether combat, a target, ground targeting, weapon drawn, or specific resources are required.
- Whether execution while moving is allowed.

V1 does not auto-decide combat strategy and does not auto-select targets. The choreographer must explicitly specify target rules; the executor only validates current conditions and executes or refuses.

## 9. Movement Events `movement`

Dedicated fields:

- `points`: `(tMs,x,z)` waypoints ordered by relative time.
- `locomotion`: walk, run, or auto-select.
- `facingMode`: along path, fixed angle, stage center, or an independent facing track.
- `arrivalToleranceM`, `maxCorrectionM`.
- `failurePolicy`: stop the whole show, skip the segment, or wait for manual handling; default is stop the whole show.

Curves can be expressed with control points in the editor and are compiled into sufficiently dense waypoints. Path recording samples the player's position and facing, then simplifies via error thresholds; raw per-frame data must never be permanently written into the project.

## 10. Facing Events `facing`

Supports:

- Fixed stage angle.
- Along the movement tangent.
- Toward the stage center or a dancer's stage position.
- Smooth transition from angle A to angle B over a time span.

When facing and movement conflict, the independent `facing` track wins; facings that cannot be held while moving are flagged yellow or red by the health check.

## 11. Root-Bone Displacement Rules

Skeletal actions and world movement must be separated:

1. Recorded clips keep the original bone data.
2. Preprocessing detects local displacement of root/waist bones and generates an "in-place preview" version.
3. Web stage position is controlled only by the `movement` track.
4. If an action must keep its own short-range body displacement, explicitly mark `rootMotionMode=preserve`; the health check warns it may stack with world movement.

Default is `rootMotionMode=inPlace`, avoiding model sliding and double displacement.

## 12. Conflict Matrix and Choreography Health Check

Check at least, before compiling:

- A persistent action starting at the same moment as movement — the game will interrupt the action.
- Movement inside an ability's cast window.
- Path distance, duration, and chosen walk/run speed cannot all be satisfied.
- Ability job, level, target, cooldown, or scenario conditions unmet.
- A posture action with no reset afterwards.
- Overlapping events on the same execution channel.
- Missing dancer start point, facing, or stage calibration.
- Local clip, skeleton, or model fingerprint mismatch.
- FF14 native macro export lacking rows, wait precision, or command capability.

Results are graded: error (compile forbidden), warning (user may confirm then compile), hint. Every result must include dancer, event ID, time, and a jumpable location.

## 13. Compile Outputs

The compiler outputs:

- The normalized unified performance script.
- Each performer's event subset.
- Required actions, abilities, jobs, targets, start points, and local clip lists.
- Capability requirements, e.g. `movement-control`, `ability-execution`, `protocol>=N`.
- Project hash and compiler version.
- Optional FF14 native macro text; inexpressible content must be listed under "unexported items".

After loading a show package, the plugin must run its own runtime checks; never trust only the web compile result.

## 14. Migration Principles for the Current Version

- The current action track migrates to `motion`; the job-switch track stays temporarily as compatibility events and merges once the ability model stabilizes.
- Current lyrics data migrates as-is; bilingual lyric behavior is unchanged.
- Current 1–3 dancer projects must open losslessly; expanding to more dancers must not break old layouts.
- Current macro import results are first converted to `motion/ability/cue` events, then enter the unified project; maintaining a second macro project format is forbidden.
- Before implementing the v0.8 migration, first freeze old-project samples and round-trip tests.

## 15. Implementation status (WP-5-DOC foundation, 2026-08-31)

The pure foundation module has landed as `web/choreo-document.js` (classic script, no DOM/fetch/IndexedDB; node suite `web/test-document.js`). Repositories and UI do **not** consume it yet — routing `projectRecord`/`applyProjectContent`/import/export through it is the next increment (WP-5-WIRE). Decisions this package locked, to keep later work consistent:

- **Two version layers.** The document's `schemaVersion` starts at 2 exactly as §2 shows; the WP-3 project record's own `schemaVersion: 2` (`choreo-projects.js`) is a different layer and is never read by the document module. Document detection is structural (`schemaVersion` number + `tracks`/`performers` arrays), so both "schema 2" meanings coexist safely. Future document versions (>2) pass through normalized but never downgraded.
- **`assetRef` is the name.** §6's draft term `sourceRef` is implemented as `assetRef: {kind, id}`; the backlog's wording wins. Migration-time clip references use the document-scoped form `legacyclip-<oldClipId>`; library-level stable asset references replace them in a later increment.
- **Lossless channels.** Unknown keys on a canonical document are preserved in place. Legacy (draft / WP-3 content) migration maps known fields explicitly and freezes unrecognized ones: clip-level extras → event `_extra`, dancer-level extras → performer `_extra`, unknown content top-level keys → document `_extra` (this is exactly what the old pipeline demonstrably dropped). `_extra` and `legacyLane` are migration-era reserved fields the compiler must ignore. Projections re-spread them.
- **Editor/rehearsal state lives in `view`.** The design doc deliberately omits solo/mute (web-rehearsal controls) and editor view state; the document keeps them in `performer.view` (`solo/mute/collapsed/laneScale`) and `view.showLyricMacro` so v0.7 projects stay lossless, without polluting the semantic core.
- **Lyrics keep two homes per §2/§5.** Global lyrics are the document-level `lyrics` array (mirrors today's `globalLyrics`); per-dancer lyric clips become `lyrics`-type tracks. Both hold `kind:'lyrics'` events.
- **Deterministic migration.** IDs derive from legacy identity (`actor-<legacyDancerId>`, `ev-<legacyClipId>`, `tr-<i>-<type>`, `mk-<i>` for id-less markers) with deterministic dedupe; migration never reads the clock or RNG, never mutates its input, and `ensureDocument` is byte-idempotent. Events sort by `startMs` only (stable — ties keep prior array order). `serialize` is key-order-canonical JSON.
- **Sub-millisecond times quantize.** Float seconds persist only inside frozen legacy data; canonical times are integer ms (the mandated primary key), so a legacy→document→legacy round trip may shift a time by up to 0.5 ms. Everything else round-trips exactly.
- Old-project samples for §14's freeze requirement: covered by the fixture set in `web/test-document.js`; real exported project files should be added there when the wiring increment lands.

### 15.1 Wiring status (WP-5-WIRE, 2026-08-31)

Persistence is now routed through the document via the pure `web/choreo-docwire.js` (node suite `web/test-docwire.js`); `choreo-app.js` only moves fields:

- **Repositories store documents.** `projectRecord()` builds the canonical document from the store projection (plus the unknown-key carrier) and that document — not legacy content — is what records, the `choreo_autosave` mirror and version snapshots persist. `applyProjectContent()` accepts any stored shape (canonical document / WP-3 content / old draft), migrates, and applies the `toLegacyContent` projection to the store. `exportProject` writes the document itself; `importProject` accepts document exports and legacy v5.0 files through the same entry and keeps original numeric clip ids (no more array-position renumbering). The record-level `schemaVersion: 2` (`choreo-projects.js`) stays as-is — the two version layers never read each other.
- **Unknown-key carrier closes the loop.** Projection-level unknown top-level keys are collected into `store.contentExtra` and re-frozen into the document `_extra` on every save; event/dancer/marker-level extras ride the module's own `_extra` channels. The reproduced losses (load→save dropping `timing`/`stage`; import destroying clip identity and dancer extras; export whitelist drops) are frozen as regressions in `test-docwire.js`.
- **`timelineRevision` policy.** The persisted document's `timelineRevision` is seeded from the loaded document on load (loading itself does not advance it), incremented by `bumpTimelineRev()` on every content change together with the session/game `_tlRevision`, and written into the document on save (floor 1).
- **Stale `legacyLane`/`_extra` snapshot policy.** The stored document is always the deterministic re-migration of the current projection, never an incremental patch of the previous document — `legacyLane` is re-derived from lane membership and migration-era `_extra` fields are re-frozen from live data, so no stale snapshot can survive. Consequence: canonical-only fields the projection cannot express (e.g. `movement`/`facing`/`cue`/`ability` tracks, doc-native event fields like `playMode`) are not yet round-tripped by today's editor; no producer exists yet, and each future feature increment must extend `toLegacyContent` when it introduces such data. The plugin payload builder keeps its ACTOR-sanctioned path; EXEC-CORE replaces it.
