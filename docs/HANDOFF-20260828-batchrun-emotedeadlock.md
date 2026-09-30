# ChoreoHelper · Full-Library Batch Recording Wrap-Up + Emote Deadlock Push (Daytime 2026-08-28)

> Predecessor doc: HANDOFF-20260828-3dpreview-batchrec.md (3D preview linkage + batch recording system).
> Covers: the overnight batch run → loop trimming → the morning "three actions wrong" report that triggered the emote-deadlock investigation, up to the scene where the v0.6.3 fix was **not yet fully effective**. Complete handoff for the next AI.

## 1. What Was Achieved

### 1. Full-Library Batch Recording Complete (251/251 Success, 0 Failures)

- `D:/nodejs/node.exe scripts/batch-record.js` ran overnight, ~1h45m, **full library 264 clips** (15 old + 251 new − 2: gcsalute's three Grand Company variants share one command/name so they overwrite each other, 266→264)
- Facial category 29 items (straightface/smile/grin/wink etc., face-only) **skipped per the owner's instruction** (useless for choreography); filter added to `batch-record.js`
- check whole-library QC: 264/264 normal, no still/bad data; engine unit tests 21/21; plugin distribution verified fine

### 2. Fixed The QC Amplitude Function NaN Bug (Biggest Pit Of The Session)

`batch-record.js` `amplitude()`: the frame structure is `[t,x,y,z,w]`; `a=q[0].slice(1)` has only 4 elements, yet the code compared `fr[1..4]` against `a[1..4]` — **a[4] out of bounds = NaN, all comparisons fail, every action falsely flagged 0.00 still**. Fix: `a[0..3] ↔ fr[1..4]` 1:1. After the fix, wave measured 3.997 (note: this is a sign-flip saturated value, see below).

**Two old beliefs overturned as a consequence**:
- fume/huh/joy actually all have large body motion (fume/huh recorded the full 20s, sustained type) — the old "facial actions falsely flagged still" was the NaN bug, not "face-only movement"
- The game window **records fine even minimized** (measured 13~17 frames/sec sampling continuing) — the "minimized freeze" was also a misdiagnosis. But walkreset key injection needs the foreground

### 3. Quaternion Sign-Flip Phenomenon (Data Is Fine; The Metric Saturates)

- Recording data occasionally shows adjacent-frame q→-q (same rotation, opposite sign; a Havok output trait; most commonly bone_35=j_sako_r right scapula)
- Per-component amplitude metrics **saturate to ~4.0** on a flip (|Δ| all components ≈4); **already present in historical data** (bow/dance/doze all contain it); playback via three.js slerp takes the shortest path and is naturally compatible — **not a data-quality problem**
- QC's "true stillness" verdict remains valid (stillness produces no flips)
- Identification signature for flip-polluted recordings: dominant bones fixed at 35/34/57/32/69, amplitude ~4.0, frames ~265, 20s timeout without settling — seeing this signature means deadlock pollution; do not treat it as normal data

### 4. Loop Trimming, Three Iterations (14 loop / 250 once Final)

`trim-loop-clips.js` three improvements:
1. **Sign normalization**: in `sampleAt` before interpolation and `poseDist` before comparison, negate when the dot product is negative (otherwise flips pollute period scores and real loop dances like dance/stepdance were all missed; 38→50 items)
2. **Remove the dance-in transition**: the old version cut from t=0, so loop wrap showed a big "dance pose→standing" jump (golddance measured seam 0.28/bone); changed to search for a start where t0=pose(t0)≈pose(t0+T), keeping only [t0, t0+N×T] with timestamps zeroed
3. **Pick the seam at the "hesitation point"**: choosing t0 by period match alone lands right after the transition ends, where motion is fastest (seam = speed × frame interval still visible); changed to period match + local minimum speed (the motion's "hesitation point")

Final handling:
- The 8 items with average seam difference >0.2 (dazed/drinkgreentea/savortea/three city-states' sip+gulp) **reverted to once** rather than force-looped
- stepdance/sundance/mogdance/yoldance/balldance/harvestdance/cheerrhythmviolet etc. loop dances fail the 0.02 threshold with period scores ~0.024-0.031 due to **breathing overlay** (breathing period ≠ dance period; spine-chain bones always differ slightly between t and t+T) → stay once; whether to relax the threshold awaits the owner's visual acceptance
- **Lesson: trim --apply overwrites the original files with no backup**. It didn't matter this time; back up the clips directory before future runs

### 5. Idle Power Plan (For Overnight Batches; Values Since Restored)

- This machine is a **laptop, plugged in, S0 modern standby**; during the batch it was temporarily set to: lid closed = do nothing, AC/DC never sleep (originals: lid = sleep, DC 600s) → **closing the lid / screen off while sleeping does not affect recording**; everything restored after the run
- LIDACTION is hidden by default; query/change with `powercfg /qh` (view) and setacvalueindex/setdcvalueindex (change)

### 6. Plugin v0.6.3 (Emote-Deadlock Fix; **Deployed But Not Fully Effective**, See Section 2)

- `AnimationPoseFreezer.PrepareForExternalEmote()`: hygiene sequence before externally triggered emotes (Unpin + restore slot speeds + fast-forward slot0's old animation to its end so the game unbinds + ResetEmoteState; **deliberately does NOT call _executor.Clear()** — the recording service just enqueued the command; clearing would delete it)
- `RecorderService` gained a `_beforeRecord` hook, called by `Record()` before triggering the command; wired in Plugin.cs
- Build zero errors, deployed to devPlugins (DLL 180224 bytes)

## 2. Emote Deadlock Event, Full Record (Most Important Handoff Content; **Unresolved**)

### Symptom

The owner reported “招手 道别 挥手三个动作错误” (beckon/goodbye/wave — three actions look wrong; in the 3D preview they look wrong). Re-recording found `/export/clip` output all polluted: either near-still (amplitude 0.007~0.19, fake settled at 1.5~4s) or full-skeleton noise for 20s without settling (dominant bones 35/34/57/32/69, amplitude ~4).

### Root Cause (Located)

- In the morning the owner played a dance-containing timeline in game + dragged the web timeline → **the Lalafell dance race-variant row (emoteId 108, timeline 3184, 2.33s loop) latched onto the character's slot0** — the plugin source comment says verbatim: “命令被游戏解析到种族/性别变体行时（**表行 104 拉拉菲尔舞 → 实际行 108**）” (when the game resolves a command to a race/gender variant row, sheet row 104 Lalafell dance → actual row 108)
- Key complication: **charMode=Normal(1)** — `ResetEmoteState()` only does the "force main-idle rebind" when Mode=EmoteLoop/InPositionLoop; our deadlock falls exactly outside that branch (the doc comment says "when necessary also force the main idle to pull the sequencer off the old loop binding", but the code doesn't cover this case)
- Worse: **the loop reappears even after a game restart** (new process, no plugin persistent state involved) — cause not identified; guess: the login position/arrangement triggered a dance/emote again. Unverified

### Things Tried That Were **Ineffective** (Do Not Repeat)

1. `/playback/stop` (internally does StopPreview)
2. `/playback/freeze` with empty body (= explicit unfreeze via StopPreview, returns "unfrozen")
3. A GPose toggle round (`/gpose/toggle` ×2)
4. `/preview` proper path with bow (FreezeRequestCore's full switch hygiene runs preFast+Reset)
5. `/debug/poke?action=reset` (cleared EmoteId=0, but slot0 still bound to 3184)
6. walkreset's real W-key movement (**temporarily effective**: isEmoting immediately false and one clean recording right after — but the very next emote command rebinds instantly)
7. The owner manually typed `/bow` in game (no effect)
8. Full game restart (no effect — the loop reappears)
9. `blendidle`/`playaction3` two memory-level pokes never verified (the owner closed the game right after sending; no crash event; 48794 completely dead afterwards = process gone)
10. **v0.6.3's PrepareForExternalEmote (confirmed running: log "prepared actor for external emote (preFast true 2.33s)") — recording still polluted**. Inference: after the fast-forward unbind, the loop rebinds during the gap (~200ms) before the command lands

### Next Plans (Priority Order; All Thought Out, None Implemented)

1. **Unconditionally `chara->Timeline.PlayActionTimeline(idleId)` inside `PrepareForExternalEmote`** (copy the ResetEmoteState Loop-branch style, `_idleTimelines[0]`): immediately pin the idle timeline back onto slot0 after the fast-forward unbind, pulling the sequencer off the old loop binding. Closest to the current understanding of the root cause
2. If that fails: **recording-period suppression for the freezer** — add `if (_suppressForRecording) return;` at the top of `OnFrameworkUpdate`; `PrepareForExternalEmote` sets it, recording Finish resets it (rules out the freezer's observe/learn mechanisms stirring during the recording window — at 11:08:38 an "Idle timeline confirmed" was seen mid-recording; probably harmless observation, but worth ruling out too)
3. If that fails: **hard-write Mode to loop** — following the `/debug/poke` modecycle/setmode_normal idea, force the SetMode(Normal)+PlayActionTimeline(idle) combination; or check whether AccessMainControl can directly stop slot0 control
4. If all fail: consider having the owner **change location/character state** (the deadlock is suspected tied to the residential-district + Lalafell-dance-variant combination; play a non-dance timeline once in game so a normal action pushes the loop binding off — needs the owner's cooperation to test)

### The Part Already Fixed

- **wave.json is fixed**: a clean recording was captured this morning (2.83s, dominant bones = arm chain bone_36~41, amplitude 0.315 — matches the 0.31 historical calibration in the trim script's comments exactly) and installed
- goodbye/beckon are still the original versions (the ones the owner reported as wrong); the three originals are backed up in `ChoreoExports\clips_bak_20260828\`

### Diagnostic Toolbox (Use Directly Next Time)

- `curl http://localhost:48794/debug/animstate`: `isEmoting/emoteId/slot0/charMode/localTime/duration` — deadlock signature = isEmoting:true + emoteId:108 + slot0:3184 + localTime looping back around + charMode:1
- Judging character motion: two `curl http://localhost:48795/export/skeleton` calls 1.5s apart, compare q per bone (note: skeleton bones are the `{i,n,p,t,q}` single-pose structure, different from clip keyframe arrays)
- `grep -a "Recorder\|WalkReset\|Freeze\|prepared" %AppData%\XIVLauncherCN\dalamud.log` — to verify whether walkreset actually injected keys, look for “键盘注入开始” vs “游戏不在前台”
- Restoring the game window to foreground: open_application's activate does not necessarily restore minimized windows; use Win32 ShowWindow(9)+SetForegroundWindow (note: here-strings in PS script files occasionally fail to parse; `-EncodedCommand` is reliable)

### Recording Iron Rules (New; Written Into CONTINUITY)

1. Before recording, check `/debug/animstate`: only start recording when `isEmoting=false` and the character is still
2. During recording the owner must not touch the game, must not drag the web timeline, must not start an in-game timeline preview
3. Do not play any timeline in game until the batch recording finishes (playing one with dances latches the character and can ruin the whole library)

## 3. Current State

- Plugin **v0.6.3** compiled and deployed to devPlugins; game restarted and loaded (log confirms "ChoreoHelper v0.6.3 started"), **but the deadlock fix is not effective**; a wave trial recording is still polluted
- Full library 264 clips: 14 loop / 250 once; the clean wave is installed; goodbye/beckon await the deadlock fix and then re-record
- Game currently open (owner restarted it; character in the residential-district yard); the choreography web page is closed by the owner
- Power settings restored to originals; temporary scripts cleaned (_restore-game.ps1 was used once and deleted)
- The 29 facial items are not recorded (owner decision); CONTINUITY.md synced to this morning's state

## 4. Next Steps (Priority)

1. **Continue the emote-deadlock fix**: implement per section 2's plan order (start with the unconditional idle rebind); after each change `dotnet build` → owner restarts the game → trial-record wave (save:false) and verify the signature (clean = settled 2~4s + dominant bones 36~41 arm chain + amplitude ~0.3)
2. After the deadlock is solved: re-record goodbye + beckon (save with overwrite), verify, then owner acceptance of the three actions
3. **Owner web acceptance**: on the main page play bow/dance/golddance/wasshoi/beckon(招手)/goodbye(道别)/wave(挥手) → check via 3D preview dragging; for loop items check the loop seams
4. After acceptance → check SPEC "loop actions loop correctly"
5. Whether the stepdance family becomes loops (the breathing-overlay problem) awaits the owner; textures and GitHub publish come later
6. Leftover small items: v0.5 features (macro/export etc.) not regression-tested

## 5. Verification Command Cheat Sheet

```
curl http://localhost:48794/debug/animstate                  # 表情状态机（死锁签名：emoteId=108+slot0=3184+charMode=1）
curl -X POST http://localhost:48795/export/clip -H "Content-Type: application/json" -d '{"command":"/wave motion","save":false}'  # 试录不落盘
D:/nodejs/node.exe D:/choreohelper/web/test-engine.js        # 引擎单测（应 21/21）
D:/nodejs/node.exe D:/choreohelper/scripts/trim-loop-clips.js check  # 全库质检
curl http://localhost:48795/export/list                      # 已录清单（264）
grep -a "prepared actor" "$APPDATA/XIVLauncherCN/dalamud.log" | tail -2  # v0.6.3 卫生序列是否执行
"C:/Users/xhz/AppData/Local/Microsoft/dotnet/dotnet.exe" build D:\choreohelper\src\ChoreoHelper.csproj -c Debug  # 编译+同步devPlugins
```
