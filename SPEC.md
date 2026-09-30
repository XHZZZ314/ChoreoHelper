# ChoreoHelper SPEC (acceptance standard)

> This file is the final acceptance standard for ChoreoHelper. 2026-08-28: product mainline shifted from "game must always run" to "web 3D by default, switch to game for verification". 2026-08-29: long-term goal defined as a "actions + skills + movement" performance choreography & execution tool for FF14 CN. 2026-09-01: owner approved the workstation mainline — ChoreoHelper is a local-first integrated performance workstation for choreography, rehearsal and game execution; the normal flow never depends on native in-game macros (owner requirement recorded in `.agent/interrupts/history/INT-20260901-PERFORMANCE-WORKSTATION.json`). See `docs/README-AI.md`.
>
> Language policy (owner decision 2026-08-30): this spec is English for AI sessions; anything the owner must read stays Chinese.

## One-line goal

ChoreoHelper is a local-first integrated performance workstation for choreography, rehearsal and game execution, for FF14 CN players: arrange actions, skills, movement, facing, lyrics, local music and beats in the web app by default, preview/rehearse with a 3D character; switch to the in-game character for real verification with one click. Game + plugin are only required for first-time asset prep (model/actions), in-game preview/recording, and live execution.

## Core product principles

- The choreography timeline is the single source of truth; web and game are two preview/playback targets.
- The internal standard data model is the "performance script"; one performance script covers actions, skills, movement, facing, lyrics, local music and beats.
- The normal choreography, rehearsal and execution flow never depends on native in-game macros; the native macro is only a limited import/export compatibility format, never the underlying timeline model.
- Actions, skills, movement and facing are separate tracks, compiled and rehearsed by one unified timeline.
- Movement uses "stage origin + front direction" relative coordinates; no absolute map/housing coordinates baked into projects.
- Default target is "web 3D"; the game character is driven only after the user explicitly switches.
- Web editing, web scrubbing and web playback must never break because game/plugin are not running.
- Models, skeletons, actions and drafts stay on the user's machine; no cloud, no accounts.
- "Character model assets" and "skeletal action data" are two different asset kinds; UI and docs must not conflate them into one "recording".
- Automatic execution is limited to one performance explicitly started by the player, with emergency stop and manual takeover; no auto-loop, AFK farming, combat decisions or PvP.

## Proven foundations

- [x] In game: character plays actions per the web timeline; scrub freezes at any moment.
- [x] Action sampling: in-game actions recorded as 101-bone data files; up to 30fps cap, real rate follows game fps (~11–17), web playback interpolates.
- [x] Web 3D: real/stand-in model driven by recorded actions; scrub shows the matching pose.
- [x] Choreography home: multi-dancer timeline, bilingual lyrics, in-game macro generation.
- [x] Loop actions: web seam blending and in-game transitions accepted on the real machine.
- [x] Local plugin v0.6.7: dual ports, recording, game playback, seek freeze all working; local API security (method whitelist / zero-side-effect OPTIONS / pairing code on writes / CORS allowlist / capability handshake) verified on the real machine.

## Long-term product acceptance scope

- [x] Multi-project center: create, rename, duplicate, delete, recent-open, autosave versions and recovery (owner accepted 2026-08-29; WP-3a: multi-project IndexedDB, legacy draft migration + backup, crash-recovery mirror, 20 versions/project — see HANDOFF-20260829-wp3a-projects.md)
- [x] Pro timeline: redo, multi-select, box-select, copy/paste, batch move, align, insert/delete time, A-B loop, section markers (owner accepted 2026-08-29; WP-3a redo + WP-3b the rest; paste adjacent to selection + make-room anti-overlap, schema 2 — see HANDOFF-20260829-wp3b-editbase.md)
- [ ] Local music & beats: waveform, BPM, time signature, offset, count-in, beat snapping; audio never uploaded.
- [ ] FF14 action semantics: once/loop/posture/emote classes, loop period, reset method, key poses, local recording status.
- [ ] FF14 skill semantics: job, level, target, cast, cooldown, movement/scene restrictions.
- [ ] Stage & movement: relative coords, start, path, speed, arrival time, facing, 2D stage and 3D preview.
- [x] Choreography health check: finds action/skill/movement conflicts, missing conditions, asset mismatches and macro-inexpressible items; jump to issue (owner accepted 2026-08-30: levels / missing-clip yellow jump / nested red bars confirmed; real-time auto-refresh observation folded into "function OK". WP-4+FIX-4: 9-rule pure-function engine, red/yellow/info modal + click-to-jump, real-time check + outline highlight, sweep-line nested overlap, clip↔skeleton fingerprint, capability handshake — see HANDOFF-20260829-fix4-wp4-check.md)
- [x] Performance-script foundation: the canonical schema and the web compiler handle six event kinds — motion, ability, movement, facing, cue, lyrics (`web/choreo-document.js` `TRACK_TYPES`/`EVENT_KINDS`; WP-5-DOC/WP-5-WIRE + EXEC-CORE compile — see HANDOFF-20260831-wp5doc-canonical-document.md, HANDOFF-20260831-wp5wire-persistence-wiring.md). Dancer-count ruling (owner, 2026-09-05): edit/rehearsal 8 dancers, web preview 8, game execution 1 before X1; the 1–12 authoring clamp and project-import validation stay as deliberate headroom above the ruling (E1 verified 1–12-performer round-trip, evidence below), quick buttons stay 1–8; lossless six-track round-trip persistence closed 2026-09-01 via E1/SIX-TRACK (see HANDOFF-20260901-six-track-roundtrip.md), while rich native six-kind editing and plugin execution of movement/facing/ability remain open work, not accepted editor scale.
- [x] Game-execution foundation: plugin-local monotonic clock, show compiler/validator/scheduler/guard/runner, countdown, emergency stop and readable log are implemented for motion/cue/lyrics on the single local performer (EXEC-CORE — see HANDOFF-20260831-execcore-show-runner.md). The plugin rejects ability, movement and facing packages before start until their executors and guard inputs exist; `ShowProtocol.MaxPerformers=64` is only a parser safety cap, never verified execution scale.
- [ ] Performance compilation: unified performance script, per-actor packages, requirements list, optional native macro (the foundation above is implemented; this row accepts the full compilation semantics on top of it).
- [ ] Game execution: plugin-local unified clock, action/skill/movement execution, countdown, emergency stop, manual takeover, readable log (the foundation above executes motion/cue/lyrics only; this row accepts skills, movement and facing too, ordered after the single-client execution milestone in `docs/WORKPLAN-20260829.md`).
- [ ] Player-facing GitHub Pages site, GitHub Releases plugin package, custom plugin repo, install/upgrade and data migration.

## Next-release checklist (current mainline)

### 1. Web preview vs game preview

- [ ] Clear toolbar target switch: "web 3D (default) / game character".
- [ ] New page opens in web-3D mode; 3D preview shows without the old floating button.
- [ ] In web-3D mode, ruler clicks / playhead drags / clip drags only update the web model; no seek/freeze to the game.
- [ ] In game mode the same operations drive the game character; when plugin is offline, just notify — editing and switching back to web keep working.
- [ ] Both modes read one playhead and one timeline; never two copies of choreography data.
- [x] Game preview drives exactly one explicitly selected dancer ("🎮 预览" badge per dancer row in game mode); multi-dancer events can never mix on the single local character (owner accepted 2026-08-31: web sends only the preview dancer + global lyrics; plugin rejects mixed-actor payloads with 400 via PreviewActorPolicy — the 400 guard activates on the next DLL hot-reload; web multi-dancer rehearsal unaffected — see HANDOFF-20260831-actor-preview-dancer.md)
- [x] Game preview drives exactly one explicitly selected dancer ("🎮 预览" badge per dancer row in game mode); multi-dancer events can never mix on the single local character (owner accepted 2026-08-31: web sends only the preview dancer + global lyrics; plugin rejects mixed-actor payloads with 400 via PreviewActorPolicy — the 400 guard activates on the next DLL hot-reload; web multi-dancer rehearsal unaffected — see HANDOFF-20260831-actor-preview-dancer.md)

### 2. Web playback vs in-game playback

- [ ] Web-3D play advances only the web playhead and 3D model; works from start/pause/resume/stop with the game closed.
- [ ] Game mode play sends the timeline to the plugin and drives the character while keeping the web playhead in sync.
- [ ] Play button text/state must clearly show "web playback" vs "in-game playback".
- [ ] Web playback failure must never be caused by "plugin not running"; game playback failure gives a clear connection hint.

### 3. First-run init and working without the game

- [x] The web app does not depend on plugin static hosting to open; editor works after game is closed (2026-08-28 stage 2: desktop shortcut opens via file://; headless 11/11 — editor/draft/snapshot catalog/stand-in 3D/web playback all OK; page auto-recovers when game starts mid-session)
- [x] First init pulls reference skeleton, action catalog and recordings from the plugin into the browser local library (2026-08-28 stage 3: online open auto-stores skeleton/catalog/actions; headless verified)
- [x] Character model route: built-in stand-in works immediately + optional Meddle glTF/GLB real model import; never advertise "one-click real model recording" while ChoreoHelper cannot export meshes (stage 3: real model online loads auto-cache into the library, offline 3D uses it — 101/101 bones verified; in-page model file picker deferred; real model still served from deploy roots)
- [x] Action assets persist in browser durable storage (IndexedDB/OPFS or equivalent), survive closing page/game/plugin (2026-08-28 stage 3: IndexedDB, 264 clips imported, offline playback of real model + recorded actions verified with plugin blocked)
- [ ] Three.js, scripts and static assets cacheable by static site/PWA; never upload user models/actions/drafts (stage 5: PWA needs a real site origin; current file:// local files need no network)
- [ ] Export/import backup of the personal 3D library so it is not locked in one browser (2026-08-28 single-profile CHLB v1; 2026-08-30 foreign-skeleton backups import as new profiles instead of being rejected; second audit confirmed v1 lacks per-action profileId/skeletonHash and same-name actions of multiple profiles still overwrite — needs CHLB v2 + composite action keys per `docs/AUDIT-20260830-code-repair/04-FIX-D-PROFILES-AND-BACKUP.md`; FIX-D shipped this, keep unchecked until owner's dual-profile on-machine acceptance)
- [ ] Library carries version, skeleton fingerprint and character identity; on race/gender change or incompatible model, prompt re-init instead of silently applying a wrong skeleton (2026-08-30 character profiles: skeleton SHA-256 + multiple "model+skeleton" profiles, online mismatch refuses wrong pairing and offers one-click adopt; game API has no character-config ID so identity = skeleton fingerprint; stays unchecked)
- [x] Lossless compression/compact storage for actions; never copy ~1.18GB raw JSON wholesale; lossy quantization deferred (2026-08-28: 264 clips 1178MB → compact 515MB → gzip 108MB into IndexedDB; 28s import, 0 failures; byte-exact round-trip)

### 4. New recording entry

- [x] Remove old "⚡ Record All"; replace with "Record 3D action library" (2026-08-28 stage 4; owner recorded common actions via the new entry 2026-08-29)
- [x] Recording goes through 48795 JSON/web-3D pipeline, no legacy `/bonerec` .bin data (per-clip POST /export/clip; owner's real recordings use it)
- [x] Four modes: quick common / full catalog / missing-only / selected-only (catalog 264 reconciled; quick verified by owner, other three mock-verified)
- [x] Progress UI: current action, done/fail counts, ETA, cancel, resume-after-reload (progress/fail/cancel owner-verified; refresh-resume verified on real page × real plugin 2026-08-30, `library-verify realrec` 7/7 — cancel-keeps-done, resume banner, real commits to disk)
- [x] Always `motion` variants; auto walkreset for posture; auto interrupt for looped; reliable spacing between clips (owner-verified; posture walkreset verified 2026-08-30 — foreground guard nudges only, full key injection after game focused)
- [x] Per-clip quality gate; failed clips individually re-recordable; never accept still/polluted data (amplitude QC + still retry + single re-record; owner recordings all passed without false positives)
- [x] After recording, auto-update the browser library; no manual %AppData% copying (clip enters IndexedDB immediately; owner confirmed)

### 5. Release & security

- [ ] Public release contains only the stand-in model; no owner's Meddle model, no private action data.
- [x] 48794/48795 no longer send `Access-Control-Allow-Origin: *`; only local pages and explicit official origins (2026-08-29 WP-1: allowlist file:// null + local ports; unknown origin preflight 403 / no CORS headers; real-machine curl verified; `PublicSiteOrigin` constant reserved — see HANDOFF-20260829-v067-security.md)
- [x] Explicit HTTP method whitelist on all endpoints; OPTIONS preflight has zero side effects (never triggers walkreset/recording/game control) (2026-08-29 WP-1: whitelist + 405; OPTIONS always 204 — before the fix `OPTIONS /export/walkreset` really moved the character, retested 405/204)
- [x] Game-control endpoints require minimal pairing/authorization; random pages cannot silently drive the character or start recording (2026-08-29 WP-1: 8-digit pairing code, `/choreo pair` in game, paste once in web "Advanced → Pairing"; writes without/wrong code → 403; owner smoke passed — full-width pairing-code bug fixed, game-mode playback OK; SEC-1 extended pairing to private reads, see item below)
- [ ] Private local reads require the pairing token; `Origin: null` alone grants no personal data (2026-08-30 SEC-1: paired GETs = /export/*, model.gltf/glb/bin, /dancers, playback/gpose/bonerec status, /debug/*; anonymous stays = capabilities/health/version/actions catalogs/classjobs/lyrics; policy in `ReadAuthPolicy.cs`, datalayertest 180/180 + security mocks 31/31; **pending owner: load new DLL and run the read-only curl checklist in HANDOFF-20260830-sec1-private-reads.md**)
- [x] `/capabilities` handshake: site detects plugin, protocol and feature versions, prompts upgrade (2026-08-29 WP-1: both ports return app/version/protocolVersion=1/capability list; page detects old plugin and shows upgrade/compat hint)
- [x] Standalone release staging with reproducible packaging; single source copy of web files (no more three hand-maintained copies) (2026-08-30 RELEASE-G: `make-release-staging.js` rebuilt staging at 0.7.1 from one whitelisted source copy; the three deploy locations are deployment sync targets, verified byte-identical — see HANDOFF-20260830-release-g.md)
- [x] Release staging uses a file whitelist: no diagnostic pages, owner's real model, private actions, local paths or config; offline catalog/skeleton/stand-in snapshots must be regenerated from public stand-in assets, never copied from the owner's current snapshot (2026-08-30: whitelist + forbidden-file blocklist + privacy scan pass; model.gltf byte-equal to stand-in source, no model.bin; catalog/skeleton snapshots regenerated live from the running game during packaging)
- [x] Bundled self-use converter `dist/ChoreoHelper/tools/xat/`（XAT `XATHavokInterop.exe`，钉死 SHA-256 `f9a4ae0d…`）仅属主自用：公开 staging 在唯一分发授权开关 `tools/xat/distribution-authorization.json` 为 `unauthorized` 期间绝不携带该目录（门禁显式拒绝任何 `tools/` 条目与任何等于钉死哈希的进包文件）；XAT BSD 告知与成分清单随包；P1-B 授权证据落档后属主翻转开关为 `authorized` 属数据文件修改，无需改打包/调用代码（2026-09-17 TASK-20260917-SIMPLE-CHOREO-XAT-BUNDLE：字节入包并哈希核验、自新位置完成一次端到端 PAP→clip 转换并通过网页剪辑契约、门禁区分测试 44/44、offline 自用入口 16/16 不受影响；插件内调用编排另行任务）
- [ ] Ship a new release to GitHub only after web-mode/game-mode/offline-library/recording/security regressions pass

## Explicit non-goals

- No login, accounts or cloud storage; the static site carries program files only, personal data stays local.
- No monetization, paid features, ads, donation links or telemetry.
- No community submissions, public template library, online review or leaderboards.
- Never duplicate the timeline or project format for dual-mode.
- Never treat the native macro as precise movement/scheduling; macro export is compatibility only.
- No AFK loops, unattended operation, combat decisions, auto-targeting or PvP automation.
- No remote-controlled multi-client operation and no central possession of player credentials: ensemble coordination only synchronizes locally authorized clients, and every player keeps local pairing, explicit Ready and local emergency stop.
- Never hard-depend on vnavmesh, Something Need Doing or other third-party plugins; optional adapters only.
- Do not change stable v0.5 semantics; keep the game-side regression baseline until the new modes finish acceptance.
- Never put the owner's real model, action library or %AppData% data into the repo, releases or the public site.
- Never delete any historical handoff docs or `.bak` prototypes.

## UI style

Dark, clean, all-Chinese UI. Default workspace shows the timeline and the web-3D character together; normal users only need to understand "web 3D / game character" — never expose internal terms like "classic/enhanced" or "48794/48795".

## Runtime environment

- First init, 3D action recording, game-character preview, in-game playback: FF14 CN + XIVLauncherCN + ChoreoHelper plugin must be running.
- Daily web editing, web-3D scrubbing and web playback: game and plugin may be closed.
- Web and game stay on the same Windows PC; personal data lives in that PC's browser or in owner-exported backups.

## Later (do not expand scope now)

- 3D model material/texture fidelity
- Lossy motion quantization, cross-skeleton retargeting
- Different personal models per dancer
- Multi-actor performance packages, unified countdown, deviation diagnostics
- Optional vnavmesh adapter and advanced movement correction
- Multiplayer collaboration and cloud sync are out of product scope
