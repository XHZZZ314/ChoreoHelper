# HANDOFF: WP-3 First Increment — Project Center & Project Storage Layer (2026-08-29)

> Status: **completed and accepted by the owner in-game (2026-08-29)**; the SPEC "multi-project center" item is checked. Nothing committed or released this round.
> Previous handoff: `HANDOFF-20260829-wp2-staging.md` (WP-2 public packaging staging).

## 1. What This Round Did (plain language)

The whole choreography used to be a single "auto draft" hidden in the browser — open the page and it's there. This round upgrades to **multi-project**:

- New toolbar 「📁 项目」 (Projects) button → project center: **create / open / rename / duplicate / delete / recent-open sorting**, plus **history versions** (manual saves + one automatic version every 5 minutes of editing, 20 kept per project, one-click restore; the current content is auto-archived before a restore).
- **Old draft migrates automatically**: the first open of the new page turns the old draft into project 「我的编舞」 (My Choreography); the original is byte-backed-up to `choreo_draft_backup_20260829` (the old `choreo_draft` key is neither deleted nor overwritten — double guard); migration never repeats.
- **Abrupt close loses nothing**: every edit synchronously writes the localStorage mirror `choreo_autosave` (same sync style as the old draft), then writes IndexedDB asynchronously; on the next open, if the mirror is newer than the library (the last write didn't finish before closing), restore from the mirror and auto-save an "abnormal-close auto recovery" version.
- **Redo**: Ctrl+Y or Ctrl+Shift+Z (undo scope unchanged).
- Degraded fallback: if IndexedDB won't open (private mode etc.) → single-project mode; editing and autosave unaffected.
- Pre-existing hazard fixed in passing: importing a project didn't clear selection references (undo would point at stale data) — both import and project switch now clear.

## 2. Change List

| File | Change |
|---|---|
| `web/choreo-projects.js` | **New file (product file, must ship in the release package)**. Project storage layer: IndexedDB DB `choreo3dproj` (projects + versions stores, separate from the library's choreo3dlib — clearing the library never touches projects) + mirror dual-write + migration + version cap + degraded mode. Pure logic exported at `ChoreoProjects.pure` for node unit tests |
| `web/choreo-helper-app.html` | Script include; store gains `projectId/projectName/projectCreatedAt/projectsDegraded`; `restoreDraft` removed, replaced by `loadActiveProject/applyProjectContent/recalcNextClipId/clearClipSelection`; `saveHistory` now ends with `persistProject()` (mirror + IDB + 5-minute auto snapshot); new `redo()`, project center (`showProjectModal` and friends), headless hook `window.__projTest`; keyboard adds Ctrl+Y / Ctrl+Shift+Z; importProject clears the selection at the top |
| `web/clip-check.html` | Backup/restore reworked: restores based on the **project content at open time** (no longer the stale old choreo_draft — a real profile would overwrite the new project back to old content); ends with a `persistProject()` write-back |
| `web/test-projects.js` | **New file**. Node unit tests: migration pure functions / clip id scan / crash-recovery takes the newest / cap / sorting + an in-memory fake DB covering init/CRUD/crash recovery/degraded mode/IDB write failure mirror fallback |
| `scripts/library-verify.js` | New **proj scenario (23 assertions)**; `seedDraftAndReload` now seeds via the page hook `__projTest.seedFromDraft` (seeding choreo_draft directly gets blocked by the migration flag); comparison convention `canonContent`: display names (the catalog fix changes them — pre-existing behavior) and selected (UI transient) are excluded from comparison |
| `scripts/offline-verify.js` | `seedDraftAndReload` reworked the same way |
| `scripts/make-release-staging.js` | WEB_FILES whitelist adds `choreo-projects.js`; FORBIDDEN adds `test-projects.js` |
| `src/plugin.json` + `src/ChoreoHelper.csproj` | Version **0.6.7 → 0.7.0** (changed together; the packaging assertion requires them consistent). Zero C# logic changes |

Deployment: `choreo-helper-app.html`, `choreo-projects.js`, `clip-check.html` synced to **four** locations (web\ source, web\dist\ChoreoHelper, devPlugins dist, game-directory dist), md5 identical. Debug build 0 errors (6 pre-existing warnings); the devPlugins DLL is **0.7.0.0**, effective on game hot-reload/next start (the web part is effective on browser refresh).

## 3. Storage Design Points (must-read for future AIs)

- Project record: `{id, name, createdAt, updatedAt, schemaVersion:1, content}`; content = the old draft's 5 fields (dancers/globalLyrics/dancerCount/showLyricMacro/totalDuration); **the project data format is unchanged** (the unified performance-script schema is WP-5).
- updatedAt uses a **monotonic timestamp** (`touchNow()`): consecutive edits within the same millisecond must still order correctly, or "recently opened" sorting is unstable.
- Version savedAt is likewise monotonic (the composite key [projectId, savedAt] would self-overwrite within the same millisecond).
- `saveActive` order: **write the mirror synchronously first, then IDB** — an IDB failure never blocks editing; the mirror is the fallback and auto-restores on next open (unit-test covered).
- localStorage keys: `choreo_autosave` (mirror), `choreo_activeProject` (last project id), `choreo_migrated_v1` (migration flag), `choreo_draft_backup_20260829` (old draft backup). `choreo_draft` is kept but never read again.
- The undo stack stays session memory (50 entries, snapshotting only dancers/globalLyrics), cleared on project switch.
- Known pre-existing behavior (not this round's regression): the online catalog's "Chinese name fix" rewrites clip display names to catalog names (e.g. 鞠躬→行礼) and saves them into projects; the `selected` transient flag also enters storage. The automated acceptance comparison convention already handles this (`canonContent`).

## 4. Acceptance Results (all actually run)

- `web/test-projects.js`: **64/64** (node direct)
- `web/test-engine.js`: **35/35** (engine untouched)
- `scripts/offline-verify.js all`: **21/21** (offline 11 / online 5 / mid-run recovery 3 / mode-check / clip-check)
- `scripts/library-verify.js all`: **93/93** (sec 14 + auto 4 + sync 13 + uicheck 5 + **proj 23** + rec 25 + lib/mode/clip-check 3 diagnostics pages)
- proj scenario covers: first default project / old-draft auto migration + byte backup + original key untouched + re-migration blocked / no re-migration on reopen / create-open-rename-duplicate-delete / recent-open sorting / content isolation / crash recovery (mirror-takes-newest + recovery version + stale mirror never overwrites) / version save-restore rollback / 20 cap / zero JS exceptions throughout
- Four-location deployment md5 identical; Debug build 0 errors; devPlugins DLL FileVersion 0.7.0.0

## 5. Owner In-Game Acceptance (passed 2026-08-29; SPEC "multi-project center" checked)

The owner actually accepted these four steps:

1. Open the page (desktop-shortcut file:// entry) → the "old draft migrated into a project" prompt appears; choreography content identical to before the migration.
2. 「📁 项目」 (Projects) → try create/rename/duplicate/delete; the most recently edited project sorts first.
3. Edit a few actions → close the browser directly → reopen: the edits are there (autosave); opening 「📁 项目 → 历史版本」 (History) again can return to a state from a few minutes ago.
4. Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo.

## 6. Leftovers & Notes

- **staging artifacts are still 0.6.7** (the release\staging\ zips/MANIFEST were not rebuilt). Before the next release: rebuild Release + rerun `scripts\make-release-staging.js` (the version assertion now requires 0.7.0; an old Release DLL without a rebuild makes it refuse to run — intended protection). This round **did not** touch the Release directory or staging artifacts.
- `web/test-projects.js` does not enter the deployment location or the release package (same treatment as test-engine.js).
- WP-3 second increment (not done, next task): multi-select, box select, copy/paste, batch translate, align, insert/delete time, A/B loop, section markers, actor solo/mute; the finished redo is the only piece of it that landed early.
- Stage 4 acceptance tail (when the owner has time): record one round of pose-type actions + cancel/resume — unchanged, not blocking.
