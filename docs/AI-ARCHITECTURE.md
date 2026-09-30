# ChoreoHelper architecture map

> Stable source routing for AI workers. Update when ownership or dependency direction changes, not after every small fix.

Current implementation packages and acceptance criteria live in `AI-BACKLOG.md`; this file defines stable boundaries, not priority/status.

## Runtime shape

```text
Chinese UI shell (HTML/CSS)
        |
        v
web controller (classic script, DOM + orchestration)
        |
        +--> pure timeline/edit/check/document modules
        +--> IndexedDB project and personal-asset repositories
        +--> 3D preview adapter -> ChoreoEngine -> Three.js
        +--> paired local HTTP clients
                  |
                  +--> 48794 playback/catalog/lyrics
                  +--> 48795 recording/skeleton/static export
                              |
                              v
                     game-thread adapters and recorder
```

The performance-script document is the single source of truth: since WP-5-WIRE the repositories persist canonical documents and the canonical schema plus web compiler handle six event kinds (motion, ability, movement, facing, cue, lyrics). DOM state, preview state, plugin snapshots and native macros are projections, never competing project formats. The visible editor natively round-trips all six kinds losslessly since SIX-TRACK (2026-09-01), and the plugin still executes motion/cue/lyrics only for the single local performer — ability, movement and facing packages are rejected before start until their executors and guard inputs exist. Six-track data rides `_doc` carriers; pure-legacy v0.7 saves stay byte-stable.

## Source ownership

| Area | Owner files | Read only when |
|---|---|---|
| App shell/style | `web/choreo-helper-app.html`, `web/choreo-helper-app.css` | Markup, layout or loading order changes |
| Core UI controller | `web/choreo-app.js` | Shared state, DOM orchestration, editing gestures, render core |
| Feature UI adapters | `web/choreo-library-ui.js`, `choreo-check-ui.js`, `choreo-project-ui.js`, `choreo-recording-ui.js`, `choreo-lyrics-ui.js` | Only the named feature's modal/session UI |
| App bootstrap | `web/choreo-bootstrap.js` | Global shortcuts and final `init()` after every classic script loads |
| Web API client | `web/choreo-api.js` | `window.ChoreoAPI` call sites; `/playback/*` and `/shows/*` never cross |
| Timeline runtime | `web/choreo-engine.js` | Playback, scrub, interpolation, cursor behavior |
| Pure editing | `web/choreo-edit.js` | Selection, move, copy/paste, insert/delete time, mute/solo |
| Health rules | `web/choreo-check.js` | Static/realtime validation rules |
| Canonical document | `web/choreo-document.js` | Schema, normalization, unknown-key `_extra` preservation, migrations |
| Persistence wiring | `web/choreo-docwire.js` | Documents through projectRecord/applyProjectContent/import/export |
| Show compiler | `web/choreo-show-compiler.js` | Six-kind script → protocol-v1 show package, capability requirements |
| Project repository | `web/choreo-projects.js` | IndexedDB, mirror, versions, migration |
| Personal asset repository | `web/choreo-library.js` | Profiles, models, clips, CHLB backup |
| 3D adapter | `web/preview3d.js` | Three.js/model loading, caches, render lifecycle |
| Local playback API | `src/HttpServer.cs`, `LocalApiSecurity.cs`, `PlaybackManager.cs` | 48794 transport, auth, timeline and seek |
| Recording API | `src/Exporter/ExportServer.cs`, `RecorderService.cs` | 48795 and clip/skeleton persistence |
| Show execution core | `src/ShowProtocol.cs`, `src/ShowValidator.cs`, `src/ShowRunner.cs`, `src/EventScheduler.cs`, `src/RuntimeGuard.cs`, `src/ExecutionLog.cs` | Protocol DTOs; validator accepts motion/cue/lyrics and rejects ability/movement/facing before start; monotonic clock, scheduler, guard and log are game-independent pure logic |
| Game adapters | `Plugin.cs`, `AnimationPoseFreezer.cs`, `GameCommandExecutor.cs`, `GameShowDispatcher.cs` | Dalamud/game-thread calls only |
| Pure C# policies | `ChatCommandPolicy.cs`, `ClipPathPolicy.cs`, `SeekPlan.cs`, etc. | Business rules; mirror in data-layer tests |

## Dependency rules

1. Pure data modules do not access DOM, fetch, IndexedDB, Dalamud or game state.
2. Repositories own persistence and migration; UI never writes IndexedDB object stores directly.
3. HTTP classes parse/authorize/serialize and delegate. They do not own choreography semantics or long-running game logic. Route/limit/error tables live only in the pure policy components, never in the HTTP/export transport classes.
4. Game APIs are called only through explicit game-thread adapters with bounded waits and cancellation.
5. The web controller may coordinate modules but must not duplicate their rules.
6. Classic browser modules expose one namespaced `window` API because `file://` is a supported runtime.
7. Product files have one editable source and deterministic deploy copies. Generated and private assets never become editable sources.

## Safe decomposition sequence

The old page mixed style, markup and roughly 3,350 lines of controller code. The first architecture package separates the shell/style, core controller, five feature UI adapters and final bootstrap without changing globals or behavior. Continue in small packages:

1. Add a pure `choreo-document` module for schema, normalization, unknown-field preservation and migrations; route all save/load/import/export through it. *(Landed: WP-5-DOC module + WP-5-WIRE persistence wiring; the editor projection's six-track round-trip gap is tracked as the first open editor milestone in `WORKPLAN-20260829.md`.)*
2. Extract paired API clients for 48794/48795, including timeout, auth and error mapping; UI consumes typed results.
3. Extract recording-session orchestration from the controller behind a small UI adapter.
4. Extract timeline rendering/interaction from project modal and library modal controllers.
5. Before game execution, add `ShowCompiler`, `ShowRunner`, `EventScheduler` and `RuntimeGuard`; do not extend the HTTP or pose monoliths. *(Landed: `web/choreo-show-compiler.js` plus the protocol-v1 pure core in `ShowProtocol`/`ShowValidator`/`ShowRunner`/`EventScheduler`/`RuntimeGuard` with `GameShowDispatcher` as the adapter; ability/movement/facing executors remain unshipped and their packages are rejected before start.)*
6. Split `AnimationPoseFreezer` only along proven responsibilities: signature access, pose sampling, pose application and preview-session lifecycle. Lock each extraction with data/game regressions.

Never mix these structural steps with schema or behavior changes unless the package explicitly owns both and includes migration/regression coverage.

## Context budget rules

- Start from `rg` hits and this map; read focused ranges, not whole monoliths.
- A UI-only task normally needs the shell, one controller range and one pure module—not library, preview and C# together.
- A C# policy task normally needs the endpoint call site, policy class and data test—not all game adapter files.
- Historical evidence is searched by audit ID, symbol, endpoint or failure text. Completed handoffs are not startup reading.
- Put durable current truth in code/tests or this map. Put transient progress only in `.agent/CONTINUITY.md`.
