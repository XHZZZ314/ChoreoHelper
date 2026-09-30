# ChoreoHelper · Stage 3 Local Library (2026-08-28, late night)

> Continues `HANDOFF-20260828-stage2-offline-launch.md` (Stage 2 web launch without the plugin).
> This is an **execution report + next task list**: mainline Stage 3 "skeleton/model/clips live in the browser, usable with the game closed" has landed;
> auto acceptance all green (auto 4/4 + sync 12/12 + uicheck 6/6 + full 4/4 + three diagnostic-page regressions + Stage 2 offline regression 11/11 + engine 35/35 — 25/25 total),
> **owner on-machine acceptance complete (2026-08-28 confirmed) — Stage 3 closed**. All changes are web-side (1 new file + 2 changed files + 1 diagnostic page + 1 acceptance script); zero C# changes.

## 1. Bottom Line

- **Zero clicks needed**: with the game open, opening the web page **automatically** stores the plugin's clips, skeleton, model and action catalog into the browser (bottom-right toast shows progress; the full 264 clips take ~half a minute).
- **After the game closes, imported clips are still editable, draggable and 3D-playable** — and offline uses the **real model + real skeleton** (not the standin): acceptance verified blocking both ports then reloading; `bone match 101/101`, bow/wave/golddance (once/once/loop — all three types) all correctly driven, web playback start/counter/stop-to-zero all correct.
- **264-clip full import measured: 28 seconds, 108.1MB compressed (disk raw 1178MB → compacted 515MB → gzip 108MB), 0 failures**; file:// browser quota measured at 10GB — plenty.
- **Backups are portable**: the library window one-click exports a `.choreolib` file (skeleton + catalog + all clips + model); import restores it on another browser/computer. Bad files, version mismatch and **skeleton fingerprint mismatch** (a different character) are all rejected without touching the existing library.
- The sidebar action catalog is stored too (offline fallback: built-in snapshot → library cache); opening the page online, the skeleton/catalog/model and clips used on the timeline **automatically** enter the library — no manual clicking.
- Mid-acceptance the owner closed the game — acceptance didn't stop: the script auto-started a local mock (real clips data, read-only, doesn't occupy plugin ports) and finished all green (method in section 5; next time the game is open, re-verify against the real plugin).

## 2. How the Owner Uses It (Plain Language)

1. **Click nothing**: with the game open, double-click the desktop「编舞助手」shortcut. The page notices clips missing from the library and collects them in the background (bottom-right notice "正在后台自动同步…"; full 264 clips ~half a minute; editing works normally throughout). Skeleton, model and catalog are stored automatically too.
2. **Afterwards**: close the game, double-click to open the page — edit, drag, play as usual. The 3D view uses the real model and all clips are there. Recorded new clips while the game was open? They backfill automatically on next page open.
3. **Insurance (optional)**: in the library window,「📤 导出备份」saves a file somewhere safe;「📥 导入备份」restores it on a new browser/computer. No regular backups needed — the clip raw files always live in the game's %AppData% directory alongside the plugin; even if browser data gets wiped, reopening the page with the game on rebuilds it automatically; backup is mainly for computer migration.
4. The「⬇ 从插件导入全部动作」button remains for an immediate manual full import (existing clips are skipped).

## 3. What Changed

### 1. New file `web\choreo-library.js` (product file — must ship)

Classic script (IIFE-wrapped, file:// compatible), exposed as `window.ChoreoLibrary`. Zero dependencies.

| Layer | Design |
|---|---|
| Storage | IndexedDB db `choreo3dlib`: `meta` (skeleton/catalog/profile), `clips` (clip metadata index), `clipdata` (compressed clip Blobs), `files` (model file Blobs) |
| Compression | gzip (native CompressionStream, Chrome 80+; if unsupported, stores raw and flags `enc='raw'` honestly). **Stores the plugin's original JSON** (compacted); reference-skeleton backfill happens at preview3d registration — the library is not welded to one skeleton |
| Fingerprint | SHA-256 (crypto.subtle — available on file:// as a secure context): skeleton fingerprint + per-clip fingerprint |
| Backup | CHLB v1 binary: `CHLB` magic + version + 64-byte-aligned header (per-segment offset/length/hash) + data segments. Export only moves Blob references (hundreds of MB never enter memory); import validates magic/version/segment bounds/skeleton fingerprint — **any failure = zero writes** |
| Foolproofing | `useDb('测试库名')` gives diagnostic pages a separate db so real data is never touched |

### 2. `web\preview3d.js` — three integration points (cache-first + plugin backfill + write-back)

- **Skeleton**: 48795 online → use the real skeleton and `putSkeleton` along the way; unreachable → the library-cached real skeleton (**not a degradation**); none → built-in snapshot (degradation).
- **Model**: deployment-location files load → `model.gltf`+`model.bin` (or glb) auto-stored; unreachable → replay from the library (gltf's external buffer fed to GLTFLoader via blob URL + `LoadingManager.setURLModifier`; **not a degradation**); none → built-in standin (degradation).
- **Clips**: `syncLibrary` is library-first (works offline); library miss → pull from 48795 → register + write back to the library. "刷新动作库" (force) skips the library and asks the plugin directly — **re-recorded clips refresh to their new versions**. The status bar honestly notes「48795 未连接，本地资料库已供 N 个动作」(48795 not connected; local library supplied N clips).
- New hook `window.__p3dLibChanged()`: the homepage clears the panel's in-memory cache after import/backup-restore, so new clips are immediately usable.

### 3. `web\choreo-helper-app.html`: catalog cache + auto sync + library window

- `applyCatalogObject(c)` extracted (snapshot and library cache share one classification logic); on probeGame success the online catalog is stored; on failure, snapshot → library fallback.
- **Auto sync `autoSyncLibrary()` (added after the owner asked "自动保存不行吗"; acceptance auto 4/4)**: triggered on probeGame success — diffs the plugin's clip list against the library's and backfills what's missing in the background (one hook covers first open / reconnect / dot-click reconnect; re-entry guarded; yields to manual import; failed entries auto-retry on next connect). **Owner does zero clicks.**
- Toolbar gains a **「📦 资料库」** button → modal: usage stats (N clips / compressed MB / skeleton / catalog / model), ⬇ import all clips from plugin (skips existing, stoppable, completion shows duration + failure list), 📤 export backup (downloads .choreolib), 📥 import backup (file picker, progress, rejection states the reason), clear (double confirm).
- `window.__libImportFromPlugin(names)`: headless acceptance hook (same code path as the button).

### 4. Diagnostic page `web\library-check.html` (**release-excluded**) + acceptance script `scripts\library-verify.js`

- library-check (http://localhost:48795/library-check.html or any static server): 13 items — lossless round-trips (clip/skeleton/catalog/model at byte level), index, whole-library export→clear→import-restore, **four bad-package rejections** (random bytes / version 999 / skeleton fingerprint mismatch without damaging the existing library / truncated). Runs entirely on a separate test db.
- library-verify scenarios: `sync` (acceptance core: online auto-collect → block ports, reload → real model real skeleton offline playback, three moments correctly driven), `uicheck` (window UI + import-by-name + export), `full` (full import report), `lib-check`/`mode-check`/`clip-check` (regression). `all` excludes `full` (~several minutes); run `full` separately.

## 4. Size and Timing Measurements (Stage 3 Acceptance Numbers)

| Item | Value |
|---|---|
| Disk raw JSON (C# indented) | 264 clips / 1178MB |
| Compacted (stored in library) | 515MB |
| gzip compressed (IndexedDB footprint) | **108.1MB** |
| Full import time (incl. compression, headless Chrome) | **28s, 0 failures** |
| Total incl. skeleton + model | 112.2MB |
| file:// browser quota (temp profile, measured) | 10GB |
| Single-clip round-trip | decompressed output byte-identical to the plugin's original JSON (lossless) |

## 5. Acceptance Record and Mock Methodology (Repeatable)

`scripts\library-verify.js` (auto acceptance 25/25 all green): **auto** 4/4 (zero-click auto-collect of all 264 + skeleton + catalog + model), **sync** 12/12 (online auto-collect → block ports, reload → real model real skeleton offline playback, three moments correctly driven), **uicheck** 6/6 (window + import-by-name + export), **full** 4/4 (264 clips 28s/108MB/0 failures), **lib-check** 13 items (backup round-trip + four bad-package rejections), **mode-check/clip-check** regressions, plus offline-verify offline 11/11 and engine 35/35.

**Background**: mid-acceptance the owner closed the game (48794/48795 vanished), and sync/uicheck/full all need plugin data.

**Solution** (built into `scripts\library-verify.js`, fully automatic):

1. At startup, probe 48795: reachable → talk to the real plugin; not → start the **48797 local mock**.
2. The mock mirrors ExportServer: static files (deployment location) + `/export/list` (reads the ChoreoExports\clips directory directly) + `/export/getclip` (reads one clip) + `/export/skeleton` (answers with the snapshot skeleton — which the plugin recorded anyway); `game:true` scenarios also **simulate 48794** (/health OK; the four catalog endpoints answer from catalog-snapshot data) so the "online auto-cache" real code path gets exercised. Everything is read-only; no game state is touched.
3. The page still requests `localhost:48795/48794`; the **CDP Fetch domain transparently rewrites requests to 48797** — plugin ports stay free and **the game can be opened anytime** (no risk of grabbing 48795 and blocking the plugin).
4. Diagnostic-page regression rewrites only 48795 (stays consistent with the historical pass form).
5. All scenarios use a disposable browser profile (temp dir, deleted after the run); IndexedDB lives in that temp profile — **the owner's daily browser is never touched**.

**Next time the game is open**: `D:\nodejs\node.exe scripts\library-verify.js all` automatically talks to the real plugin for re-verification (one script, dual use).

## 6. Incidental Fixes and This Session's Pitfalls

- **mode-check "zero request" assertion false-positive (pre-existing race, not a product bug)**: Stage 2's `startConnWatch` probes 48794 `/health` every 15s while disconnected; running mode-check with the game offline, that request randomly lands between the two "paused zero request" sampling windows (never exposed while online because gameConnected=true early-exits the polling). Fix: exclude `/health` from the count (the assertion means "no playback control requests"; connection probes don't count) + clearInterval both pollers before counting and restore afterwards.
- **Self-introduced and self-fixed**: `_savedConnTimer` was stored in a run() local, unreachable from `backToWeb` (a top-level function) → ReferenceError silently killed `finish()`, so the title never got set (symptom: group ⑤ assertions all passed but MODE-PASS never appeared). Fixed by storing it on the iframe window. **Lesson: in diagnostic pages, pass state between multi-stage callbacks via window — never closure locals.**
- **Modal forgot `bd.appendChild(m)`**: symptom — `.modal-bg` exists but `.modal` doesn't. Headless DOM dump located it instantly.
- **Writing JS template strings inside a bash heredoc**: bash eats the backticks and corrupts the script. For long JS, always write to a file — never `node -e` + heredoc.
- Under Git Bash, md5sum output for `C:\...` paths carries an extra `\` before the hash — a display artifact; just strip it when comparing.

## 7. Next Task List (In Order)

1. ~~Owner on-machine acceptance of Stage 3~~ **Done** (2026-08-28, owner confirmed "验收完成").
2. **Stage 1's last outstanding test** (optional tail, doesn't block): one game-mode real-machine play/stop/drag → check SPEC sections 1 and 2.
3. **Stage 4: the formal「录制 3D 动作库」center** — replaces the old「⚡ 录制全部」entry; four record modes (quick/full/missing/selected); progress/cancel/resume; promotes `scripts\batch-record.js`'s proven orchestration rules (motion variant, ≥2.5s intervals, posture walkreset, persistent-clip interrupt, QC) into product logic (web queue + plugin reliable single-clip recording); recorded clips auto-enter the browser library. Plan: `HANDOFF-20260828-dual-preview-offline-workflow.md` sections 6 and 7.
4. Stage 5: CORS/authorization, legacy cleanup, release staging, publishing.

## 8. Explicitly Not To Do

- No deleting `BoneAnimator`/`/bonerec/*`, no clip data format change, no touching CORS, no git commit, no publishing.
- No lossy quantization, cross-skeleton retargeting, per-dancer models, or SW/manifest/PWA (waits for the formal origin, Stage 5).
- **Release exclusion list +1**: `library-check.html` (rest unchanged: mode-check/clip-check/p3d-*, the three snapshots, libs-classic, real model model.*). Note `choreo-library.js` is a **product file that must ship**.
- Do not delete historical handoffs, `.bak`, SPEC, AGENTS, `.agent`.
