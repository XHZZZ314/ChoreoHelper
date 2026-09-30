# ChoreoHelper · Stage 2 Web Launch Without the Plugin (2026-08-28)

> Continues `HANDOFF-20260828-stage1-modesplit-clipux.md` (Stage 1 mode split + clip bar UX).
> This is an **execution report + next task list**: mainline Stage 2 "the web opens normally with the game closed" has landed,
> auto acceptance 21/21, and the **owner's on-machine acceptance passed** ("本地是方块可以动，其他都正常").
> Changes are web-side only (two new scripts, preview3d.js, homepage); zero C# changes.

## 1. Bottom Line

- **With the game fully closed, double-clicking a local file opens the choreography web page**: editor renders, draft restores, sidebar action catalog (built-in snapshot: 305 emotes / 2121 skills / 44 jobs), 3D panel auto-opens showing the standin model (101/101 bone match), and web play/pause/stop all work.
- **Starting the game mid-session auto-recovers the same page**: a 15s silent connection monitor refreshes connection state and upgrades the snapshot catalog to the online one; the 3D panel's 10s light probe upgrades standin → real model — no page reload, no draft loss.
- **The file:// entry is fully usable while online too**: connection succeeds, online catalog, real model + real skeleton (the BASE absolute-address path fixed in v0.6.6 works as-is).
- Headless Chrome auto acceptance **21/21** (offline 11 + online 5 + mid-transition recovery 3 + mode-check/clip-check regression 2); engine tests 35/35; three deployment locations byte-identical.
- Desktop shortcut「**编舞助手**」created, pointing at `web\dist\ChoreoHelper\choreo-helper-app.html`.
- **Owner on-machine acceptance OK (2026-08-28)**: desktop shortcut offline-open shows the block standin, editable and playable, everything else normal. Draft migration not done (when an old-entry draft is needed, do one export/import; blocks nothing).

## 2. Entry Choice and Rationale (Key Decision)

Stage 2 requires "a web entry not depending on the 48795 static service". Among three candidates, **file:// double-click local file** was chosen:

| Candidate | Verdict | Reason |
|---|---|---|
| **Double-click local HTML (chosen)** | ✅ | Zero resident processes; doesn't violate the "48796 is for temporary dev only" rule; doesn't require publishing a public site early |
| Resident local mini server | ❌ | Would break the established "close after use" rule, and adds a background process that can silently die |
| Publish GitHub Pages now | ❌ | Drags Stage 5's CORS/authorization security work forward; no publishing without owner authorization |

The PWA/Service Worker route doesn't work locally: SW needs an http(s) origin, and the only local http origin (48795) disappears with the game. Site PWA is deferred to Stage 5.

**Draft note (one-time migration)**: browser localStorage is isolated per "how the page was opened". Drafts stored under the old entry `http://localhost:48795` are invisible to the file:// entry. The owner does this once: old page「导出」(export) → new entry「导入」(import). Opening from the desktop shortcut thereafter avoids the issue entirely.

## 3. What Changed

### 1. New script `scripts\make-classic-libs.js` (repeatable)

Mechanically converts the 4 three.js ES modules in `libs\` into classic scripts; output `web\dist\ChoreoHelper\libs-classic\` (three / BufferGeometryUtils / SkeletonUtils / GLTFLoader, fixed load order). Conversion rules: strip import/export, attach export names to `window.THREE`, wrap the body in an IIFE.

**Why classic scripts are mandatory**: browsers forbid file:// pages from loading ES modules (import throws CORS). This is the only way three.js loads in the offline scenario.

**Biggest pitfall of this session (highest reuse value)**: the first version did not wrap in an IIFE — classic scripts share the global scope, so three's top-level `class BufferAttribute` entered the global lexical environment, and a later file's destructured `var { BufferAttribute }` conflicted with it, throwing `SyntaxError: Identifier already been declared`; GLTFLoader/clone never got attached (symptom: "GLTFLoader is not a constructor"). **Always IIFE-wrap classic script bundles** — also safe for repeated loading.

### 2. New script `scripts\make-offline-assets.js` (run while the game is online)

Generates three bundled snapshots (attached as window globals — file:// forbids fetching local files, so only `<script>` works):

| Artifact | Size | Content |
|---|---|---|
| `catalog-snapshot.js` | 368KB | Slimmed snapshot of 48794's four endpoints: emotes 305 / races 8 / skills 2121 / jobs 44 (only fields the web uses) |
| `skeleton-snapshot.js` | 13KB | 48795 reference skeleton, 101 bones |
| `standin-model.js` | 27KB | Standin model glTF (buffer embedded as base64, no external files) |

Re-run to refresh after a game major-version update or catalog change. Artifacts are generated files — they go to the deployment locations only, not git.

### 3. `web\preview3d.js` offline fallback chain

- **Libs**: original `import()` first (http scenario unchanged); on failure, fall back to loading the 4 classic scripts in order.
- **Skeleton**: 48795 unreachable → `__CHOREO_SKELETON_SNAPSHOT__` snapshot (identical data structure; zero engine-math changes).
- **Model**: model.glb/gltf unreachable → `GLTFLoader.parse` directly parses the embedded standin JSON.
- **Honest status**: `readyStatus(netFail)` unifies the ready text — offline degradation is labeled "（离线 · 替身模型）" (offline · standin model), 48795 unreachable is labeled "动作库未同步" (action library not synced); never fakes online.
- **Auto-upgrade**: while panel init has failed or is degraded, light-probe `/export/list` every 10s; on success, `hardReset()+init()` performs the full upgrade (scene/renderer not rebuilt; data layer fully cleared including the clip cache). The "刷新动作库" button also triggers the full redo for the degraded state.
- Also fixed a latent issue: `startTick()` guarantees only one rAF loop (previously, re-entrant init would accumulate multiple `requestAnimationFrame(tick)` loops).

### 4. `web\choreo-helper-app.html` catalog snapshot + connection monitor

- The three snapshots' `<script>` tags go after preview3d.js (the page runs normally if they're missing).
- `applyCatalogSnapshot()`: when probeGame fails, fills the catalog from the snapshot using exactly the same classification/filter/job-table logic as online; `store.catalogFromSnapshot` marks the source.
- `startConnWatch()`: silent probe every 15s (only while disconnected); on recovery, `probeGame(true, forceCatalog)` upgrades the snapshot catalog to the online version, with a one-shot edge-triggered "游戏已连接" (game connected) notice.
- probeGame's failure branch only calls render() when state actually changed (periodic polling must not repeatedly rebuild DOM and interrupt drags).
- sendSeek/playback split and other Stage 1 semantics: zero changes.

### 5. Acceptance script `scripts\offline-verify.js` (repeatable)

Headless Chrome + node global WebSocket, direct CDP. Five scenarios: `offline` (host-resolver-rules points localhost into the void to simulate the game closed), `online`, `transition` (CDP Network.setBlockedURLs blocks both ports then unblocks — true same-page mid-transition recovery), `mode-check`, `clip-check`. Run: `D:\nodejs\node.exe scripts\offline-verify.js [scenario|all]`. Works whether the game is open or not.

## 4. Verification Record (2026-08-28, game online)

- **offline 11/11**: editor / draft / snapshot catalog / panel auto-open / standin 101/101 / playback start-counter-stop-to-zero / zero JS exceptions.
- **online 5/5**: online catalog (catalogFromSnapshot=false) / real model 101/101 / zero exceptions.
- **transition 3/3**: block → offline degraded-ready → unblock → connection auto-refresh (≤15s) → catalog upgraded to online → 3D auto-upgrades to real model (≤10s + init) → draft intact.
- mode-check 18 items MODE-PASS, clip-check 27 items CLIP-PASS (48795 http entry regression fine).
- Engine tests 35/35; all JS passes `node --check`; Debug build 0 errors (C# untouched); source=dist=devPlugins=game dir, 15 files byte-identical.
- Snapshot generation cross-checked against live endpoints: emotes 305 / skills 2121 (after jobName filter) / jobs 44 — consistent with what probeGame actually loads.

## 5. Next Task List (In Order)

1. ~~Owner on-machine acceptance of Stage 2~~ **Done** (2026-08-28: "本地是方块可以动，其他都正常"). Old draft migration not done — whenever the owner needs old choreography, do the section-2 export→import once; blocks no development.
2. **Stage 1's last outstanding test (the only tail)**: with the game open, owner switches to「🎮 游戏角色」mode and does one real-machine play/stop/drag-freeze, confirming it matches v0.6.6 (the offline-launch item is already covered by Stage 2's headless acceptance + owner acceptance). Passing checks SPEC sections 1 and 2.
3. **Stage 3: local library (next actual dev task)** — IndexedDB/OPFS, lossless compression, the `ChoreoLibrary` asset provider layer (preview3d stops pulling directly from 48795), cache-first + plugin backfill, export/import backup. When done, **offline standin/real model can also play recorded clips** (currently offline only has the standing-pose standin — a stage boundary the owner knows about). Plan in `HANDOFF-20260828-dual-preview-offline-workflow.md` sections 4 and 7; measure the 264-clip full import's footprint/time/quota before finalizing compression details (sampled gzip ≈9%–24% of original).
4. Stages 4/5 in order: formal recording center → security/cleanup/release.

## 6. Explicitly Not To Do

- No lossy quantization or cross-skeleton retargeting before Stage 3; no SW/manifest/PWA (waits for the online origin, Stage 5).
- No deleting `BoneAnimator`/`/bonerec/*`, no clip data format change, no touching CORS, no git commit, no publishing.
- `mode-check.html`, `clip-check.html`, `p3d-*.html`, the three snapshot files (incl. standin), libs-classic, and the real model model.* all stay out of the release package (the staging exclusion list grows again; handled in Stage 5).
- Do not delete historical handoffs, `.bak`, SPEC, AGENTS, `.agent`.

## 7. Maintenance Notes (New Rules, Also Written Into AGENTS.md)

- Three.js upgrade: after swapping files in `libs\` and re-fixing relative imports, **re-run `scripts\make-classic-libs.js`**.
- Game major-version update / catalog change: **open the game and re-run `scripts\make-offline-assets.js`** (also re-run if the standin model source `web\model-standin.gltf` changed).
- Changes to generated artifacts (libs-classic, the three snapshots) must be synced to the three deployment locations, like any other web file.
