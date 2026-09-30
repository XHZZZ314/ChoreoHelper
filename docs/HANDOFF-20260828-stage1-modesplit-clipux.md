# ChoreoHelper · Stage 1 Mode Split + Clip Bar UX (2026-08-28)

> Continues `HANDOFF-20260828-dual-preview-offline-workflow.md` (new product mainline plan).
> This is an **execution report + next task list**: mainline Stage 1 "mode split" code is done and passed 18 automated acceptance checks; additionally, clip bar interaction was optimized per an owner bug report (on-machine acceptance OK).
> Both changes touch web files only (`web\choreo-helper-app.html`, `web\preview3d.js`); zero C# and zero engine changes.

## 1. Bottom Line

- **Stage 1 mode split complete**: web playback/dragging fully separated from the game; default web 3D; game mode fully preserves v0.6.6 semantics. Headless Chrome auto acceptance 18/18 (including real-machine seek/unfreeze while the game was online).
- **Two real-machine tests still owed before checking SPEC**: ① offline launch after the game fully quits; ② one full game-mode playback. Neither blocks Stage 2.
- **Clip bar interaction optimization complete and owner-accepted** (handles / dead zone / bubble / guide lines / new autoFill rules / keyboard nudge), auto acceptance 27/27.
- Two new repeatable diagnostic pages: `web\mode-check.html` (mode split), `web\clip-check.html` (clip bar interaction). **Must be excluded from release staging.**

## 2. Stage 1 Mode Split: What Changed

### Homepage `web\choreo-helper-app.html`

- store gains four fields: `appReady` (editor render master switch), `gameConnected` (48794), `exportConnected` (48795), `previewTarget` (`'web'|'game'`, persisted in localStorage `choreo_previewTarget`, default web). Old `connected` kept as a gameConnected mirror (toolbar dot still uses it).
- `render()` gate changed from `store.connected` to `store.appReady` — **the editor renders even with the game off**.
- `init()` rewritten: after draft restore, **render the editor first**, then `probeGame()` in background (probe + load action catalog; failure shows only a toast, no more fullscreen error page; `showConnectionError` deleted). After the catalog loads, render again to fill the sidebar.
- `togglePlay()` split into three: `pausePlay()` (web mode: zero requests) / `startPlay()` (web mode: immediate local playback) / `gameStartPlay()` (**v0.6.6 semantics preserved verbatim**: only enters playing state after 48794 `/playback/start` succeeds; if not connected, probeGame fast-fails with a clear message).
- `sendSeek()` returns immediately when `previewTarget!=='game'`; the three `/playback/stop` call sites (playLoop finish, `stopPlay()`, bottom ruler drag) get the same game gate.
- Toolbar adds a「🌐 网页 3D / 🎮 游戏角色」(Web 3D / Game character) toggle (`switchPreviewTarget()`: web→game probes first, failure only notifies and never blocks editing; **game→web sends stop + empty freeze to unfreeze**, no half-frozen character left). The dot is clickable to reconnect. Bottom bar status becomes two lines "mode/game"; port numbers no longer exposed.

### `web\preview3d.js`

- Web mode (default): panel **auto-opens** on a fresh homepage load; does not grab the screen if the user last chose game mode; `#3d` deep-link behavior unchanged.
- init is idempotent and retryable: on failure, click "刷新动作库" (refresh action library) to retry; already-loaded libs/skeleton/model/scene are not rebuilt.
- Status distinguishes "plugin not connected (48795 no response)" from "web assets missing: skeleton data invalid".
- Library sync network failures are flagged `netfail` and excluded from the "unrecorded" list (status bar notes 48795 not connected); auto-cleared and re-pulled when `/export/list` recovers.

### Verification record (2026-08-28 late night, game online)

- Engine tests 35/35; inline script + preview3d `node --check` pass.
- Three deployment locations cmp byte-identical; 48795 live serves the new code.
- `mode-check.html` 18/18: default web / editor not blocked by connection / 3D panel auto-opens / mode button / sidebar rendering; **web play·pause·stop·drag issues zero requests to 48794** (PerformanceResourceTiming count 8→8 unchanged); after switching to game, a real-machine seek is actually sent (0→1); switching back to web auto-stops and unfreezes (0→1).
- Release build success 0 errors (incremental; C# untouched).

### Pitfall fixed

`store.emotes/races/actions/classJobs` were only assigned after the old init loaded the catalog — the new init renders first, so the first render's `renderSidebar` `.filter` threw directly (exposed by mode-check group ② deadlocking; located via CDP stack). Fixed by initializing the store literal with empty arrays; offline the sidebar shows an empty catalog and fills in automatically once connected.

## 3. Stage 1: Two Real-Machine Tests Still Owed (SPEC Check Conditions)

1. **New web page after the game fully quits**: confirm the editor opens normally, the draft restores, and web playback works. Run `http://localhost:48795/mode-check.html` (with the game offline, group ④ auto-degrades to "verify switching doesn't crash") or open the homepage and eyeball it. To be done next time the owner closes the game.
2. **One full game-mode real-machine playback**: switch the browser to「游戏角色」(Game character), press play/stop/drag-freeze, confirm it feels identical to v0.6.6. The request-body construction code is untouched verbatim (seek/stop channels were tested this session).

After both pass, check the corresponding items in SPEC "next version acceptance checklist" sections 1 and 2, then start Stage 2 (web launch without the plugin: static site/PWA, bundled offline action catalog snapshot + standin model, online/offline state refresh without draft loss).

## 4. Clip Bar Interaction Optimization (owner bug report → plan approved → accepted OK)

The owner's two pain points: ① lengthening a clip is hard and easily misfires into a whole-clip drag; ② shortening a clip auto-lengthens the previous one. Root causes:

- The old version had **no handle elements**; mousedown guessed intent from the click position's width percentage (12~25px), and a wrong guess locked the entire gesture. On narrow clip bars the judgment zone covered nearly the whole bar, so every click counted as "lengthen".
- `autoFillGaps` ran unconditionally: drag / shorten-left-edge / delete all lengthened the previous clip to fill the gap; even durations manually changed via right-click got "delay-overwritten" by the next operation.

### Changes (all in `choreo-helper-app.html`)

1. **Real handle elements**: `renderClip` gives each clip a real `.c-rz` handle (right edge always; left edge too when width ≥48px). Clicking a handle = lengthen/shorten; everything else = whole-clip drag. Deleted the position-guessing edge formula and onmousemove cursor switching (CSS `:hover` takes over). ▶ preview button / job badge moved right to make room; old `::before/::after` gradient layers removed.
2. **Click dead zone**: `dragClip` treats displacement <3px as a pure click-select — no value change, no redraw, no history entry.
3. **Drag bubble + snap guide**: during drag/lengthen, `#dragTip` follows the mouse showing "时长 5.0→7.0s" (duration 5.0→7.0s); on a true snapTime hit, a `#dragGuide` vertical line appears at the snap time. Both attach to body, unaffected by the render() full rebuild.
4. **autoFillGaps new rules (owner decision: manual edits don't auto-fill, inserts do)**: manual edits never backfill; new second param `autoFillGaps(di,onlyClip)` — when addClip inserts mid-timeline, only "the newly inserted clip" lengthens to reach the next one; project import / macro parsing keep the full fill; right-click menu adds「补齐空隙(本舞者)」(fill gaps (this dancer)) as a manual fallback.
5. **Keyboard nudge**: with a clip selected, `←/→` moves ±0.5s, `Shift+←/→` changes duration ±0.5s (minimum 0.5s).

### Verification

`clip-check.html` 27/27 (handle existence / right handle only changes duration / dead zone / gaps left are not backfilled / left-edge drag doesn't grab-modify the previous clip / delete leaves gap / insert auto-connects / full fill / keyboard nudge / guide three states); mode-check regression PASS; engine 35/35; three deployments consistent. **Owner on-machine acceptance OK (2026-08-28).**

## 5. The Two Diagnostic Pages (New Assets)

| File | Purpose | Result marker |
|---|---|---|
| `web\mode-check.html` | 18 mode-split assertions (iframe loads the real homepage) | Title `MODE-PASS/FAIL:n` |
| `web\clip-check.html` | 27 clip-bar assertions (synthetic mouse/keyboard events) | Title `CLIP-PASS/FAIL:n` |

How to run: after deploying, open `http://localhost:48795/mode-check.html` (or clip-check.html) in a browser; check the title and the body log.

**Both diagnostic pages are currently present in all three deployment locations** (for easy re-runs), **but release staging must exclude them** (same treatment as p3d-check).

clip-check has two pitfall-prevention designs — keep them when reusing:

- **Draft backup/restore**: tests trigger saveHistory writing localStorage — it backs up `choreo_draft` at the start and restores both localStorage and the store at the end, so the owner's draft is never eaten.
- **Synthetic events need real delays**: `dragClip` is rAF-throttled; a synchronous mousedown/mousemove/mouseup burst makes mouseup cancel the not-yet-run rAF callback so the drag never takes effect — `await` tens of ms between events.

## 6. Session Pitfall Log (Reuse Value)

1. **Headless Chrome's new profile has no draft**: wait conditions must not depend on an existing `.clip` on the timeline (old CONTINUITY lesson, re-hit once); wait for "editor rendered" (`.act-list` exists) instead.
2. **The host environment's headless Chrome occupies the 9333 debug port**: your own instance must switch ports, and `/json` polling over IPv4/IPv6 may hit different instances (mine only got `[::1]:9333`). **Do not kill the host browser's process** (match precisely on the `user-data-dir` command-line signature before killing).
3. **Under git bash, md5sum output for Windows backslash paths carries an escape prefix**, so string comparison falsely reports MISMATCH — verify deployment consistency with `cmp -s` byte comparison and convert paths with `cygpath -u`.
4. When moving large code blocks, **verify with a verbatim diff** (this session briefly miscopied the lyric clip's `type:'lyric',name:...` as `type:c.data.name`; git diff caught it).

## 7. Next Task List (In Order)

1. **Stage 1 finish-up tests** (when opportunity allows; does not block 2): owner closes the game, then run the offline launch verification; one game-mode real playback. Passing checks SPEC sections 1 and 2.
2. **Stage 2: web launch without the plugin**: static site/PWA entry; bundled offline action catalog snapshot + standin model; online/offline state refresh without draft loss. Plan details in `HANDOFF-20260828-dual-preview-offline-workflow.md` section 7, Stage 2.
3. Stages 3–5 in order: IndexedDB/OPFS local library → formal recording center → security/cleanup/release.
4. Feel tweaks anytime: handle width (9px), dead zone (3px) and bubble offsets are independent numbers — change them if the owner finds them awkward.

## 8. Explicitly Not To Do

- Do not delete `BoneAnimator`/`/bonerec/*`, change clip data format, or adopt IndexedDB before Stage 2 (established mainline boundary).
- Do not package `mode-check.html`, `clip-check.html`, `p3d-*.html`, the real model or the private clip library into the release.
- Do not touch v0.5's stable semantics (stop-to-zero, macros, lyrics); the game-side regression line stays until new-mode acceptance ends.
- No git commit, no remote, no publishing without owner authorization.
- Do not delete historical handoffs, `.bak`, SPEC, AGENTS, `.agent`.

## 9. Common Verification Commands

```powershell
# Engine tests (35)
& 'D:\nodejs\node.exe' 'D:\choreohelper\web\test-engine.js'

# Homepage inline script syntax check (extract then node --check)
# (in-session: one-line node script extracts the <script> block to a temp file, then check)

# Three-deployment consistency (cmp byte compare; do NOT use md5sum string compare)
# web\dist\ChoreoHelper / devPlugins deployment / game dir game\dist\ChoreoHelper

# Diagnostic pages (open in browser, read the title)
# http://localhost:48795/mode-check.html   -> MODE-PASS
# http://localhost:48795/clip-check.html   -> CLIP-PASS

# Both ports online
curl.exe -s http://localhost:48794/health
curl.exe -s -o NUL -w "%{http_code}" http://localhost:48795/export/list
```
