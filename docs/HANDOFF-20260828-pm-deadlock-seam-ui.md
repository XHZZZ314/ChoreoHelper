# ChoreoHelper · Deadlock Wrap-Up + Loop Seam Engine Fix + Main-Page Scroll Fix (Afternoon 2026-08-28)

> Predecessor doc: HANDOFF-20260828-batchrun-emotedeadlock.md (batch wrap-up + emote-deadlock push; this doc continues it).
> Covers midday to afternoon 2026-08-28: verification of the deadlock fix and the **key misdiagnosis reversal**, re-recording and installing three actions (owner accepted), three v0.6.5 plugin changes, loop seam quantification and engine wrap blending, v0.5 regression, and the main-page scroll position fix. Complete handoff for the next AI.

## 1. What Was Achieved

### 1. Emote Deadlock Substantively Solved (Owner Accepted All Three Actions ✓)

- **v0.6.4's idle rebind verified working**: after the owner restarted the game with v0.6.4 and a wave trial was recorded, the forward-kinematics check showed **the right hand really raised** (0.43→0.79m) — the deadlock's core harm of "actions won't play" is gone. Log confirms the new code runs (keyword `idle rebind 3`; with an empty learning set it falls back to the standard idle id 3)
- **Three real actions re-recorded and installed**: wave 5.23s/69 frames, goodbye 5.14s/67 frames, beckon 5.50s/72 frames (recorded on v0.6.4; the 20s-timeout versions were tail-trimmed offline and installed). FK hand-height Δ: wave 0.39 / goodbye 0.20 / beckon 0.17 — all real actions. `/export/getclip` distribution verified. **Owner visually accepted the fix**
- Backups: the 20s full versions are in `ChoreoExports\clips_bak_20260828\full20s-20260828-pm\`; the morning's fake wave kept as `wave.fake-settled-283s.json` in the same directory

### 2. The Morning Misdiagnosis Reversed (This Doc's Most Important Correction — Do Not Repeat)

- **The 2.83s wave.json treated as "fixed" this morning was fake-still pollution**: FK check right-hand height Δ=0.00 (a real wave should be ≥0.3); the dominant bones were actually the spine chain (bone_36~41 = j_sk_*, NOT the arm chain — that morning the spine chain was mislabeled the "arm chain"). The owner's “三个动作错误” (three actions wrong) report was right all along
- **"W-key movement temporarily effective" was the same misdiagnosis**: the "clean" recording captured right after moving was this fake-still version
- **The right way to judge real vs fake actions**: `D:/nodejs/node.exe D:/choreohelper/scripts/fk-hand-height.js <clip.json>` — offline forward kinematics computing right-hand/head world-height curves, no browser or eyeballs needed. **From now on, characterize any "suspected still/suspected pollution" with it first before acting**
- That morning's "pollution signature" (dominant bones 35/34/57/32/69, amplitude ~4) was quaternion sign-flip saturation; today's actual pollution was "the action played + the settle detection never fired"

### 3. Correct Understanding Of The Deadlock Residual State

- **Zombie binding is harmless**: slot0=3184 and emoteId=108 remain (still present after recordings), but with visual weight ≈0 — the character stands still and actions play normally. The hygiene sequence (Unpin→restore slot speeds→fast-forward the old loop→clear emote state→**idle placeholder**) lets every recording/command land normally. **No need to hunt this binding anymore**
- **Aftershock phenomenon**: after an action finishes, the spine chain/hair show intermittent energy of 0.01~0.03 (occasionally >0.05 even 7~10s later), but the standing state itself is truly still (double sample <0.003). The old settle threshold 0.01 got stuck by the aftershock → once-type actions all timed out at 20s
- **Side effect: the zombie blocks the game's emote channel** — v0.5 in-game timeline playback (`/playback/start`: state machine completes but the character doesn't move), motion variants, and the owner's manual /bow all no-op (channel occupied; command dedup rejects). Only the recording channel with the hygiene sequence gets through

### 4. v0.6.5 (Compiled And Deployed To devPlugins As 0.6.5.0; **Takes Effect After Game Restart; Two Items Pending Verification**)

1. **Settle threshold 0.01→0.05** (RecorderService.cs): calibrated offline by replaying that day's real data — 0.01 never settles / 0.03 settles at 10.9s / **0.05 settles at 5.0s** (the action plays out in 3.5s, fully preserved); real-action motion >>0.05, so no false kills
2. **Fixed the hardcoded version string** (Plugin.cs:56-57 previously hardcoded "v0.6.3"): the 11:48 log said "v0.6.3 started" while actually running 0.6.4 code — **from now on, confirm this line is fixed before trusting log version numbers** (from 0.6.5 on, the log tells the truth)
3. **Playback channel unblock**: new `AnimationPoseFreezer.PrepareForPlaybackCommand()` — acts only on the block signature = isEmoting + slot0 being a non-idle IsLoop (zero change in the normal state; v0.5 original semantics untouched); `PlaybackManager.ExecuteClip` calls it before sending a command. Timing uses the same model as the recording pipeline (hygiene queued to the framework thread; the command lands after the executor's ≥200ms throttle)
4. Known gap: the seek-freeze path (RequestFreezePreview) has its own preFast but no idle rebind; unverified in the zombie state — evaluate whether to add it after the playback unblock is verified

### 5. Loop Seam Quantification + Engine Wrap Blending (Live On The Web)

- **Quantified** (`scripts/seam-visibility.js`, offline FK computing all-joint world displacement across the wrap point): **quaternion-average pass ≠ invisible to the eye**. 6 items >3cm: cheerrhythmbright 5.78 / wasshoi 5.19 / cheeronbright 5.03 / cheerrhythmred 4.99 / cheerwaveyellow 4.68 / golddance 4.11 (worst bones concentrate at finger/arm extremities — chain amplification); charmed 1.74 / cheerwaveviolet 1.53 in the middle; the other 8 <1cm
- **Engine fix**: choreo-engine.js loop wrap changed from a hard jump (`clipTime %= dur`) to reusing the existing blendFrom blending — on wrap it captures the end pose and smooth-interpolates into the new cycle's start over the first 0.3s. All loops benefit
- **Unit tests +4** (wrap modulo / capture blend start / seam has no hard jump / real pose after blending), **25/25 pass**; all three deployments done; 48795 live-confirmed serving the new code — **browser refresh applies it**

### 6. v0.5 Regression

- Read-only endpoints all green: /health /version /actions(594KB) /actions/emotes(53KB) /actions/races /dancers /classjobs /settings/engine /playback/status /gpose/state /bonerec/status all 200
- Playback smoke test found the zombie block (see 3 above); the unblock fix is compiled into v0.6.5, pending restart verification

### 7. Main-Page Scroll Position Loss Fix (Owner Bug Report: “操作任何动作时时间轴跳到开头” — "the timeline jumps to the start whenever I trigger any action")

- **Root cause**: every main-page operation (add/delete/edit/drag/resize) goes through `render()` full DOM rebuild (`root.innerHTML=''`) — the timeline's horizontal scroll (300s×60pps=18000px wide) snaps back to the far left and the sidebar action list returns to the top. The playhead was not zeroed; it was scrolled out of view. The macro edit box already had a "detach-reuse + restore scroll" special case; other containers did not
- **Fix**: render() captures the scroll positions of `#timelineWrap` (+ the linked bottom ruler) + `.act-list` + `.tabs-wrap` before rebuilding and restores them after. The Ctrl+wheel zoom path sets scrollLeft itself after render, which would override the restored value; anchor-zoom behavior unchanged. The 3D panel mounts on document.body, unaffected (checked)
- ⏹ The stop button/Home key already zero the playhead (v0.5 original semantics, untouched)
- Deployed to all three locations, live-verified, node syntax parse passes — awaiting the owner's Ctrl+F5 acceptance

### 8. New Tool Scripts (All In scripts\)

| Script | Purpose |
|---|---|
| `fk-hand-height.js` | clip+skeleton offline forward kinematics for right-hand/head height curves — **the standard tool for judging real vs fake actions** |
| `analyze-pollution.js` | clip amplitude Top + period detection (is a loop repeating?) |
| `seam-visibility.js` | loop seam all-joint world displacement quantification (is the seam visible?) |

Note: the fk/seam scripts depend on `%TEMP%\skel.json` (first run `curl http://localhost:48795/export/skeleton -o %TEMP%\skel.json`).

## 2. Current State

- Plugin source **v0.6.5** compiled and deployed to devPlugins (0.6.5.0, including the settle threshold / version string / playback unblock); **the game process still runs the old copy loaded at 11:48** — the next restart loads 0.6.5
- The web is fully updated and live (engine wrap blending + main-page scroll fix); browser refresh applies; unit tests 25/25
- The full library's 264 clips pass QC (including the three newly installed); wave/goodbye/beckon are the real-action versions
- The zombie binding is still on the character (slot0=3184/emoteId=108) — harmless; not being hunted
- Owner has accepted: beckon/goodbye/wave ✓

## 3. Next Steps (Priority)

1. **Owner acceptance**: ① loop looping (dance/golddance/wasshoi/cheer family; check in the 3D preview that the wrap transition is smooth) → on pass check the SPEC loop item; ② main-page scroll fix (view doesn't jump when triggering actions)
2. **After the next game restart loads v0.6.5, spot-check two things**: ① in-game timeline playback (the character moving in the zombie state = unblock works; log keyword `unblocked emote channel for playback`) ② record one once-type action and confirm ~5s auto-settle (no more 20s timeout)
3. Seek-freeze zombie-state gap: based on the playback unblock results, decide whether to add the idle rebind to RequestFreezePreview too
4. Whether the stepdance family becomes loops (breathing overlay; period scores 0.024-0.031 fail the 0.02 threshold) awaits the owner's word
5. Textures and GitHub publish come later; web-side v0.5 features (macro generation/lyrics etc.) await owner daily-use feedback

## 4. Verification Command Cheat Sheet

```
curl http://localhost:48794/debug/animstate     # 僵尸签名：emoteId=108+slot0=3184+charMode=1（无害化，仅观察）
curl -X POST http://localhost:48795/export/clip -H "Content-Type: application/json" -d '{"command":"/wave motion","save":false}'  # 试录不落盘
D:/nodejs/node.exe D:/choreohelper/scripts/fk-hand-height.js <clip路径>   # 判动作真假（先取 skel.json 见上）
D:/nodejs/node.exe D:/choreohelper/web/test-engine.js       # 引擎单测（应 25/25）
D:/nodejs/node.exe D:/choreohelper/scripts/trim-loop-clips.js check       # 全库质检（应 264/264）
grep -a "idle rebind\|unblocked emote channel\|Recorder" "$APPDATA/XIVLauncherCN/dalamud.log" | tail   # 关键日志
"C:/Users/xhz/AppData/Local/Microsoft/dotnet/dotnet.exe" build D:\choreohelper\src\ChoreoHelper.csproj -c Debug  # 编译+同步devPlugins
```
