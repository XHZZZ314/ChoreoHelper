# 07: RELEASE-G Docs, Deployment, and Release Gates (P3)

This package is not release authorization. External operations (creating a remote, pushing, publishing) happen only when the owner explicitly requests them.

## AUD2-013: Current State Is Inconsistent

### Confirmed Discrepancies

- `docs/README-AI.md` still says WP-4 awaits live acceptance and next step OPT-1; reality is WP-4 accepted, OPT-1/OPT-2 complete.
- `.agent/CONTINUITY.md` has two consecutive "next step" headings and says "all P0/P1 fixed"; after this new audit that statement no longer holds.
- `SPEC.md` item 67's old wording says "skeleton mismatches are all rejected", while current character-profile behavior imports cross-body backups as a new profile instead of rejecting.
- The actual game directory's `skeleton-snapshot.js` differs from source/`web/dist`/devPlugins.
- `release/staging` is still the historical 0.6.7 staging, without the current full 0.7.1 product files.
- Release builds still have 6 warnings; `ChoreoHelper.csproj` uses a broad `NoWarn` for nullable warnings, potentially masking new problems.
- The home page location text renders as the literal `u4F4Du7F6E`.

Evidence locations:

- `docs/README-AI.md:45-47, 84-87`
- `.agent/CONTINUITY.md:409-424`
- `SPEC.md:67-68`
- `web/choreo-helper-app.html:392`
- Compile warnings in `src/Plugin.cs:8`, `src/AnimationPoseFreezer.cs`, `src/Exporter/ExportServer.cs`
- `src/ChoreoHelper.csproj:12`

## Modification Steps

### 1. Status Documents

1. As each P0/P1 package completes, update only its status; items without live verification explicitly stay "pending online verification".
2. `docs/README-AI.md`'s current status, handoff entry, and next step must point into this repair package.
3. `.agent/CONTINUITY.md` removes duplicate headings, stale conclusions, and mutually contradictory old statements; keep historical events but put current status at the top/next step.
4. `SPEC.md` gets checked only when acceptance is actually met; when fixing wording, never pre-mark unfinished items (real character IDs, PWA, executor, etc.) as complete.

### 2. Code Hygiene

1. Fix the location text to proper Chinese.
2. Remove duplicate usings; confirm and delete genuinely unused fields; never delete state still used via reflection/lifecycle just to clear warnings.
3. Narrow `NoWarn`. After enabling nullable, handle newly exposed issues one by one — no one-shot bulk formatting.
4. Delete or implement clear dead code such as `ctx503`, but search call sites first.
5. Unifying the C# test target with the main project's net10 still goes through the old RELEASE-1/AUD-021 path, verifying local/CI environments.

### 3. Three Web Deploy Locations

After any product web change, sync:

1. Source deploy location: `web/dist/ChoreoHelper`.
2. devPlugins: `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`.
3. Actual game directory: `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper`.

Generated artifacts are rebuilt only from source scripts:

- `libs-classic/`: `scripts/make-classic-libs.js`.
- `catalog-snapshot.js`, `skeleton-snapshot.js`, `standin-model.js`: `scripts/make-offline-assets.js`.

Never hand-edit generated artifacts to mask source problems. Config files that the game/plugin write back can be safely handled only while the game is not running; web deploy files take effect by syncing per the existing flow and refreshing.

### 4. Staging and Release

1. Re-run `scripts/make-release-staging.js` only after P0/P1 are cleared and online live regressions pass.
2. Staging must use the stand-in model; it must not contain Meddle real models, real clips, projects, pairing codes, absolute personal paths, or temp logs.
3. The whitelist must include `choreo-library.js`, `choreo-projects.js`, `choreo-edit.js`, `choreo-check.js`, and the needed offline artifacts; test files must not leak into the product bundle.
4. Verify manifest, version numbers, protocol version, SHA-256, and the Chinese install/migration instructions.
5. Creating the GitHub remote, push, Release, Pages, and custom plugin repo each still need the owner's explicit authorization separately.

## Package Definition of Done

- [x] README-AI, SPEC, CONTINUITY, handoffs, and code state are consistent. (2026-08-30)
- [x] All product files hash-identical across the three deploy locations. (2026-08-30, recursive diff zero)
- [x] Release build 0 error, warnings cleared or each kept with a documented justification. (2026-08-30: 0 warnings with `NoWarn` removed entirely)
- [x] New staging generated from current source and passing the privacy scan. (2026-08-30, 0.7.1)
- [x] No remote or release operations without authorization. (nothing published; local staging only)

See `docs/HANDOFF-20260830-release-g.md` for evidence and details.
