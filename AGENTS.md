# Project rules (auto-read by every AI session)

> Language policy (owner decision 2026-08-30): **docs for AI/worker consumption are written in English** to save tokens. Owner-facing material stays Chinese: product UI text, `使用说明.md`, `操作速查.md`, `docs/readme.md` (legacy v0.5 user readme), `docs/final-delivery.md`, `docs/reports/*.html`, and the owner-note headers inside otherwise-English files. Chinese originals of converted docs are archived under `docs/archive-zh-20260830/` (do not edit, do not delete). Code-file header comments stay Chinese per the existing convention.

## What this project is

ChoreoHelper: an FF14 CN "performance choreography assistant". The web app handles offline arrangement of actions/skills/movement/facing/lyrics/beats plus 3D rehearsal; the in-game plugin reads game data, records skeletal actions, previews in game, and later executes one player-started performance script.

## Start protocol

Read docs/README-AI.md, SPEC.md and .agent/CONTINUITY.md, then the current task contract.
For task execution and handoff, docs/AI-WORKFLOW.md is the canonical process.
PROGRESS.md is the owner-facing view; .agent/NEXT-ACTION.json points to the current task's
exact continuation prompt. Run D:/nodejs/node.exe scripts/check-workflow.js --next at closeout.
Always include a complete Chinese copy-ready prompt in the final reply, with model recommendation,
reason and actual dispatch status outside the prompt. Explain the user-visible result, gaps and one next step.
Current facts: source and direct observations outrank summaries. Intended behavior: owner decisions
and accepted contracts outrank current bugs. Safety and authorization: current owner scope and
higher-priority rules apply; a recommendation never authorizes a new action. The owner is the
final authority for user outcomes. Preserve dirty work and historical evidence.
The old August package sequence and legacy pipeline state are historical references, not today's queue.

## Product boundary (owner-confirmed 2026-08-29)

- Internal standard is the "performance script"; the FF14 native macro is only a limited import/export format, not the underlying timeline model.
- Three core choreography assets: actions, skills, movement; facing, lyrics, beats and stage cues are supporting tracks.
- No monetization, community submissions, public template library, accounts, cloud saves or telemetry; personal models/actions/projects stay local.
- Final public form: GitHub Pages site + GitHub Releases plugin package + custom plugin repo; without explicit per-task authorization, never create remotes, push or publish.
- Late-stage auto-execution is limited to one player-started performance, with emergency stop and manual takeover; no AFK loops, combat decisions, auto-targeting or PvP.
- vnavmesh / Something Need Doing may only be optional adapters, never core dependencies.
- Long-term route and work packages: `docs/PRODUCT-ROADMAP-20260829.md`, `docs/DESIGN-performance-script-v1.md`, `docs/DESIGN-game-executor.md`, `docs/WORKPLAN-20260829.md`.

## Tech stack

- Plugin: C# / .NET 10 (net10.0-windows) / Dalamud API Level 15; CN client + Orange Moon launcher (XIVLauncherCN) only.
- Services: plugin-local dual HTTP — 48794 legacy features (library/playback/scrub), 48795 export pipeline (recording/pose-viewer pages).
- Web: vanilla HTML+JS single-file pages; Three.js for preview; preview engine `web/choreo-engine.js` (+ `web/test-engine.js` node tests); home 3D panel `web/preview3d.js` (reads home `store.currentTime`, does not touch home code); **local asset library `web/choreo-library.js`** (IndexedDB+gzip+CHLB backup; preview3d/home use cache-first + plugin backfill; must ship); **project storage `web/choreo-projects.js`** (WP-3+: multi-project IndexedDB `choreo3dproj` + localStorage mirror `choreo_autosave` dual-write, legacy draft auto-migration, + `web/test-projects.js`; must ship).
- Build: references Dalamud/FFXIVClientStructs/Lumina etc. from `%AppData%\XIVLauncherCN\addon\Hooks\dev\`; Debug output + `web\dist` auto-copy to `devPlugins\ChoreoHelper\`.

## Directory conventions

- `src\` plugin source; `src\Exporter\` recording/export module; `src\tests\` data-layer test project (excluded from main build).
- `src\Exporter\*.bak` = retired prototypes (pap parsing etc.); keep, never compile, never delete.
- `web\` web sources; `web\dist\ChoreoHelper\` = deployment-source root; `web\libs\` = local Three.js r160 (GLTFLoader/SkeletonUtils 'three' bare imports rewritten to relative paths — re-patch when upgrading); model files live at deploy roots — **real model is `model.gltf`+`model.bin`** (Meddle glTF; code prefers `model.glb` which does not exist), stand-in is also named `model.gltf` (source `web\model-standin.gltf`).
- Inside `web\dist\ChoreoHelper\`, **`libs-classic\` and `catalog-snapshot.js` / `skeleton-snapshot.js` / `standin-model.js` are generated** (stage-2 offline assets): after a three upgrade re-run `scripts\make-classic-libs.js`; after a game version/catalog change re-run `scripts\make-offline-assets.js` in game. Hand edits are futile — edit sources and regenerate.
- `scripts\` tools (stand-in model generator, temp dev server 48796, verification harnesses); **ps1 files must carry a UTF-8 BOM** (PowerShell 5.1 misparses Chinese comments without it).
- `docs\` = all historical handoffs, design pages, old prototypes (project memory — never delete).
- `sample\` recording samples; `release\devPlugins\` installable build artifacts; `site\` GitHub Pages v0.5 backup.

## Style & conventions

- All owner/user-facing text in Chinese (UI, toasts, user docs).
- Code files start with a short Chinese "what this file is for" comment.
- Minimal diffs: no drive-by refactors, dependency upgrades or format sweeps; fix bugs at the root cause.

## Operational notes (hard-won, keep)

- The owner does not code: explain in plain language; after every change state what changed and how to verify.
- **Owner's daily entry (since stage 2)**: desktop shortcut "编舞助手" → Chrome opens `web\dist\ChoreoHelper\choreo-helper-app.html` via file://; works with game open or closed. The legacy http://localhost:48795 entry still works (diagnostic pages use it). **The two entries have separate localStorage drafts** — migrate once via export/import, then stay on the new entry.
- **file:// page constraints**: fetch to localhost works (48794/48795 send CORS *), but local-file fetch and ES module imports are banned — offline three.js relies on `libs-classic` classic scripts (preview3d falls back automatically). New resources for file:// must be classic `<script>` + window globals.
- **Sync three deploy roots for web changes**: ① `web\dist\ChoreoHelper` (source) ② `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper` (auto on Debug build) ③ game dir `...\最终幻想XIV\game\dist\ChoreoHelper` (**the copy the running game actually serves** — new Dalamud loads dev plugins from a copy, so Assembly.Location misses devPlugins and FindWebRoot falls back here). Editing only ①② = 404s. Browser refresh applies; no game restart needed.
- **Dev plugin registration (Dalamud 2026-08-27+)**: no auto-scan of devPlugins; plugins must be listed in `%AppData%\XIVLauncherCN\dalamudConfig.json` → `DevPluginLoadLocations` (Path → plugin DLL, DevMode=true). ChoreoHelper is registered. In-game: /xlsettings → experimental → Dev Plugin Locations. **Editing dalamudConfig.json while the game runs gets overwritten on exit — edit only after the game fully quits.**
- .NET 10 SDK installed per-user (`C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe`, not on PATH — use full path); `dotnet run` single-file scripts unusable (nuget.org blocked). Data-layer tests run with `--roll-forward Major` (net8.0 test binary).
- Node.js at `D:\nodejs` (v24.20.0, not on PATH — full path); runs `web\test-engine.js` etc.
- 48795 belongs exclusively to the plugin ExportServer; `serve-app.ps1` retired, do not revive; `scripts\library-verify.js` auto-starts a read-only mock on 48797 (plus CDP request rewrite) when the plugin is offline — 48797 is its temporary exclusive port, no conflict with the game.
- The old machine's 820MB recording data never migrated here; record actions on demand (`/export/clip` or `/export/batch`).
- **Recording emotes always use "xxx motion" variants** (no target consumed, no chat spam, works for text-less emotes; text variants once recorded as stills). Keep ≥2.5s between clips or actions get swallowed.
- **Posture actions** (doze/kneel/pose/grovel/lounge/groundsit/playdead/situps/winded/savortea) leave the character seated — only movement resets; call POST `/export/walkreset` after recording (position nudge + foreground key injection, verified). Interrupt sustained loops with `/beckon motion` (`/nod motion` does not exist on CN).
- **Emote-class actions are NOT face-only** (early "face-only" was a NaN bug misdiagnosis; smile etc. do have body motion). Dalamud IKeyState (Orange Moon build) injection does not work; synthetic input goes through OS-level keybd_event + foreground guard.
- Batch orchestrator `scripts\batch-record.js`; loop trimmer `scripts\trim-loop-clips.js` (usage in file headers).
- At wrap-up update `.agent/CONTINUITY.md`; local git exists (initial commit 2026-08-28) but **no commit/push without owner authorization**. The owner has decided to publish on GitHub eventually, but remote creation/push/release each need explicit authorization in their own task.
- Never delete: `SPEC.md`, `AGENTS.md`, `.agent\`, `docs\`.
