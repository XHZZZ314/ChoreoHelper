# HANDOFF: WP-3 Second Increment — v0.7 Timeline Editing Base (2026-08-29)

> **Completed and accepted by the owner in-game (2026-08-29)**; SPEC "professional timeline" is checked.
> Feature list per `docs\WORKPLAN-20260829.md` WP-3: multi-select, box select, copy/paste, batch translate, align, insert/delete time, A/B loop, section markers, actor solo/mute (redo already landed with the first increment).
> Previous handoff: `HANDOFF-20260829-wp3a-projects.md`.

## 1. What Changed (plain language)

- **New file `web\choreo-edit.js`**: all the "algorithm" parts of editing live here — pure data operations, no UI; the node unit tests in `web\test-edit.js` run directly (43 tests all pass). **Product file, the release package must include it** (added to the packaging script whitelist).
- **Main page `choreo-helper-app.html`**: buttons, mouse, keyboard wiring (details below).
- **`web\preview3d.js`**: the 3D panel skips muted dancers (they stay visible standing still, not hidden).
- **`web\choreo-projects.js`**: project format upgraded to schema 2 (below); old projects get defaults filled in automatically on open, with not one byte of data lost.
- Zero C# changes; version stays 0.7.0 (WP-3 as a whole is one version).

## 2. Features & Usage (owner acceptance reference)

| Feature | How to use | Notes |
|---|---|---|
| Multi-select | Ctrl+click = add/remove selection; Ctrl+A = select all; Esc = clear all | Transport area shows 「已选 N 条」 (N selected) |
| Box select | Hold and drag a box on empty track space (track body / top ruler / canvas gaps all work) | Every clip the box touches gets selected; a drag under 3px falls back to the old behavior (clicking empty space moves the playhead); text selection is disabled in the timeline area |
| Batch translate | Drag any selected clip and the whole selection moves; ←/→ moves the batch 0.5s | Snapping and 0.5s stepping match single-clip behavior |
| Copy/paste | Ctrl+C copies the selection; Ctrl+V pastes | **Pastes immediately after the currently selected clip** (make-room guarantees zero overlap; nothing selected → pastes at the playhead); after pasting, the selection lands on the new clips, so repeated Ctrl+V chains forward; the right-click menu is 「粘贴到选中条后」 (paste after selected clip) |
| Align | Right-click an action clip → 「对齐到播放头」 (align to playhead) | Selected clips' starts all become the playhead, durations unchanged (for multiple dancers starting in unison) |
| Insert/delete time | 「⋯ 高级」 (Advanced) → 「⤵ 插入时间…/⤴ 删除时间…」 (insert/delete time…) | Affects all dancers + global lyrics + section markers; delete = "cut out a span, everything after shifts left" |
| A-B loop | Timeline top-left transport area 「A」「B」「✕」 (position the playhead first, then press) | Web playback only — jumps back to A at B; **game mode unsupported** (the plugin has no loop endpoint), button grayed out |
| Section markers | Transport area 「⚑+」 plants a flag at the playhead; click a flag on the ruler to jump; right-click to rename/retime/delete | Saved with the project; undoable (Ctrl+Z) |
| Solo/mute | 「S」「M」 small buttons on each dancer's title row | **Mutually exclusive** (enabling one turns off the other); muted dancer: track dims, web 3D stands still without actions, game-mode playback skips the dancer entirely (global lyrics unaffected); saved with the project |

## 2.5 Owner First-Round Feedback: Three Fixes (2026-08-29 same day, all landed)

The owner's first trial reported three issues, all fixed the same round with full regression:

1. **Box select fought the browser's native text selection/copy**: the entire timeline area (`.tl-area`) now disables text selection (`user-select:none`), so dragging no longer highlights page text; box-select start zones extended to the top ruler and canvas gaps (clips and handles still drag the clip body); the lyric track's "click empty space to enter lyrics" no longer mis-pops the input box after a box select ends.
2. **Paste/copy crushed existing actions**: added the "make room" mechanism (`ChoreoEdit.pure.makeRoom`) — **paste** at the playhead shifts clips after the playhead right on the target track and truncates clips spanning the playhead down to it (deleting results under 0.5s), giving zero same-track overlap after paste; **right-click duplicate/Ctrl+D** likewise makes room before placing the copy. Relative spacing between copies is preserved.
3. **S/M should be mutually exclusive**: solo on a dancer turns mute off; mute on turns solo off.

Companion: test-edit.js 43→**50** tests (makeRoom boundaries + paste make-room); clip-check.html adds the ⑲ assertion group and fixes one button-index bug (the old ⑱ "S toggles solo" was misclicking dancer 1's M, and an earlier deployment missed syncing that file, giving a false green on the old page — this round actually ran 64 passed 0 failed CLIP-PASS).

## 2.7 Owner Second-Round Feedback: Three Fixes (2026-08-29 same day, all landed)

1. **Box select couldn't start on dancer title rows**: title rows (including track labels and the global lyric header) can now start box-select drags; buttons and inputs inside title rows (S·M·+lyric·collapse·track height) are unaffected and still work when clicked.
2. **Copy generates flush**: right-click duplicate/Ctrl+D now generates the copy **flush against the copied clip's end** (previously 0.5s away); the make-room logic is unchanged — clips the copy would crush shift right, zero overlap after copying.
3. **Muted dancers' 3D ring dims**: with M on, that dancer's floor ring in the 3D panel drops to 0.22 opacity (~20% visible); unmuting restores instantly; solo follows the same rule (dancers displaced by a solo dim likewise).

Companion: clip-check adds a "box-select from title row" assertion and the copy assertions are updated to the flush convention; `__p3dDebug()` gains a `ringOps` field (headless test 1→0.22→1 passed); four-location deployment md5 identical.

## 2.8 Owner Third-Round Feedback (2026-08-29 same day, landed)

1. **Paste becomes "flush after the selected clip"**: Ctrl+V / right-click 「粘贴到选中条后」 = pasted content lands flush against the current selected clip's end (make-room as before: crushed clips auto-shift right); with nothing selected it falls back to the old "paste at playhead". After pasting, the selection lands on the new clips — repeated Ctrl+V chains forward.
2. **Live box-select count**: while dragging a box, 「已选 N 条」 (N selected) displays live beside the rectangle (Ctrl append mode shows 「追加 N 条」/appending N).

## 3. Data Format (schema 1 → 2)

- Project content gains a 6th field `markers` (section markers); each dancer gains `solo/mute` switches.
- Old projects get defaults filled on open (markers empty, switches off), **lossless**; the next save writes schema 2 automatically.
- `web\test-projects.js` 64→70 assertions (migration tests added; one old assertion updated to the new convention, schemaVersion=1 → =2).

## 4. Verification (all actually run, 2026-08-29, re-verified after the feedback fixes)

- Node unit tests: test-edit **50/50**, test-projects **70/70**, test-engine **35/35**
- Headless Chrome: clip-check (incl. the new ⑪~⑲ assertions, **actually run**) **CLIP-PASS** (64 passed 0 failed), mode-check **MODE-PASS**
- The first full round (before the feedback fixes) also went all green once: offline-verify **21/21** (game online, incl. the real model/real plugin chain), library-verify all **93/93** (rec forced to mock, rest real plugin); the feedback fixes only touched editing logic, so the full suite was not rerun
- Four-location deployment (web source / web\dist / devPlugins / game directory) md5 identical:
  choreo-helper-app.html=9e447f45…, choreo-edit.js=ca5e7558…, clip-check.html=e8c1416f…,
  preview3d.js=59e1cc2b…, choreo-projects.js=8142b309…
- Note: offline-verify's online/transition/diagnostics scenarios depend on the real plugin at 48795 (that script has no mock fallback) — with the game closed those three time out; a pre-existing environment dependency, not this round's problem; run with the game open and everything is green.
  library-verify all's first run had 2 flaky rec failures (self-picked list / beckon interrupt); rerunning rec alone gave 25/25 and the whole package rerun gave 93/93, all passed.

## 5. Owner In-Game Acceptance Checklist (run through once to check SPEC line 33)

1. **Multi-select + batch**: Ctrl+click two or three clips → drag one, all move → Delete removes the batch (Ctrl+Z brings them back).
2. **Box select**: drag a box over empty space to select several → drag the whole set elsewhere.
3. **Copy/paste**: select several, Ctrl+C → move the playhead somewhere new, Ctrl+V → the new clips are draggable/deletable.
4. **Align**: give two dancers one clip each → select both → position the playhead → right-click 「对齐到播放头」 → both start at the same moment.
5. **Insert/delete time**: insert 2s from 「⋯ 高级」 — everything after the playhead shifts right; delete 2s to shift left (Ctrl+Z restores).
6. **A-B loop**: web 3D mode, playhead mid-action press 「A」, move it later and press 「B」, press play → it loops between A and B.
7. **Section markers**: 「⚑+」 plants a flag → click the flag on the ruler to jump → right-click rename → Ctrl+Z undo delete, etc.
8. **Solo/mute**: give 2-3 dancers a few clips each → M-mute one (web 3D: that dancer stands still, track dims) → S-solo another → game-mode playback: the muted dancer performs no actions.

## 6. Boundaries & Notes

- Box select hits by screen rectangle: clips scrolled out of view can't be selected (same behavior as mainstream editing software).
- Paste and copy guarantee zero same-track overlap at the target via `makeRoom`; the A-B loop works in web playback only (the game-mode button shows a grayed hint).
- Muted = the dancer performs no actions but the model stays visible standing (the model is not hidden, so positioning stays checkable).
- Toggling solo/mute mid game playback does not affect the current run (the command already went out); it takes effect on the next playback.
- staging artifacts still 0.6.7, not rebuilt; nothing committed, pushed, or released this round.
