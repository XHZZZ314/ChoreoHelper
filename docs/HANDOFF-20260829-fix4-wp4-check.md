# HANDOFF-20260829 FIX-4: WP-4 Choreography Checkup Full Closeout (AUD-009 / AUD-013, version still 0.7.1)

> What this file is: build handoff for FIX-4. Finishes AUD-009 (nested overlap underreported) and AUD-013 (WP-4 missing fingerprint/capability/macro criteria) from the audit list
> `HANDOFF-20260829-code-audit-fix-optimization.md`, plus a re-check of AUD-004's impact on the missing-recording check. During re-verification a real plugin bug was also fixed
> (/export/skeleton permanently caching its error response — see Section 6, FIX-4's only C# change). **Code and automated acceptance are done; WP-4 only counts as complete
> after the owner's on-machine acceptance of the checkup.**

## 1. What Changed (by file)

### web\choreo-edit.js (pure-function layer, +2 shared functions)

- New `ChoreoEdit.pure.macroEvents(dancer, globalLyrics, showLyricMacro)`: synthesizes one dancer's three tracks (+ global lyrics when the lyric macro is on) into an event list identical to generateMacro's — same-timestamp stable ordering switch→action→dancer lyrics→global lyrics; the global-lyrics dedup rule is verbatim identical to generateMacro (same timestamp, same name within 0.15s skipped).
- New `ChoreoEdit.pure.macroLineEstimate(events, jobMap)`: estimates line count by generateMacro's line rules — one line per event (textless lyrics produce no line); action clips insert a job-switch line only when "has a job name + the job actually changed + jobMap contains that job" (the old checkup added +1 for every jobName unconditionally, overestimating).
- Purpose: macro export and checkup share one criteria set (AUD-013's requirement); the two can no longer drift apart.

### web\choreo-helper-app.html

- `generateMacro()`: assembling the `all` events now calls `ChoreoEdit.pure.macroEvents` (behavior verbatim equivalent; eliminates the duplicated criteria).
- `probeCaps()`: **capsOk tightened** — no longer accepts any response carrying `protocolVersion`; it must be `app==='ChoreoHelper'` with a numeric `protocolVersion` to enter new-version safe mode (and send pairing headers).
- Checkup ctx (`showCheckModal` and the headless hook `__checkRun`) gained `showLyricMacro:store.showLyricMacro`, so the macro check now knows whether the homepage has the lyric macro on.

### web\choreo-check.js (rules engine)

- **AUD-009**: same-track overlap changed from "sort then compare neighbors only" to a sweep line — tracks the "latest end among clips already started"; any clip starting before the end of some earlier-started clip counts as overlap. Long clips wrapping multiple shorter ones, nesting, and multi-level nesting are all caught; each conflicting clip is reported at most once (clipId is jumpable). Adjacency and the 0.01 tolerance criteria are unchanged; the lyrics track remains hint-level.
- **AUD-013 new rule 8 "clip↔skeleton fingerprint"** (yellow): choreo-library.js stamps "the skeleton fingerprint at write time" onto clip metadata; a timeline-referenced clip recorded under a different skeleton (race/appearance changed) reports yellow. Old data never stamped → insufficient evidence, no report (cannot confirm); never a false positive.
- **AUD-013 rule 9 "capability handshake" extended**: ① bidirectional protocol compare — plugin newer than web = hint (compatible but fewer features); plugin older = **yellow** (semantics may be incompatible, must upgrade); ② item-by-item compare against the capability list; the web requires `REQUIRED_CAPS=['playback','seek','freeze','recording','walkreset','library-sync']` (gpose optional); each missing capability is named in the yellow report; ③ old-plugin message corrected — the old text claimed "write interfaces will be rejected", but the web actually uses compatibility mode for old plugins (no pairing headers); rewritten to describe reality.
- Rule 7's comment gained a "model fingerprint" criteria note (see "explainable uncertain results" below).

### web\choreo-library.js

- `putClip()`: on write, reads the current skeleton fingerprint once (`getSkeletonInfo`) and stamps it onto the clip metadata's `skeletonHash` — all write paths (auto sync / manual import / backup import) go through it or stamp explicitly.
- `importBundle()`: backup-imported clips also get the current skeleton fingerprint (read after the backup skeleton is written, guaranteeing the skeleton from this import).
- `clipIndex()`: entries now expose `skeletonHash` (for the checkup).
- `putModelFile()`: computes the file's SHA-256 into the record on ingest (model source/version metadata); `getModelFiles()` exposes the hash.

### web\test-check.js / test-edit.js / test-library.js (targeted regression)

- test-check 47→**73**: new section 11 nested overlap (audit samples / multi-level nesting / identical starts / fully identical intervals / adjacent / tolerance boundary / message doesn't explode / lyrics-track downgrade), section 12 clip skeleton fingerprint (different → yellow; same → no report; never stamped → no report; no current skeleton → no report), section 13 capability extension (protocol both directions / missing capability named / complete → no report / old-plugin message reworded), section 14 macro shared criteria (lyric macro on → global lyrics enter the check / same-time same-name dedup / same job inserts one line only / jobMap missing → no line / switch clip counted).
  Note: test-check must now `require('./choreo-edit.js')` first (matching the product page's script order).
- test-edit 73→**85**: macroEvents (ordering / same-timestamp order / lyric-macro switch / dedup / empty dancer) + macroLineEstimate (switch line / job change inserts a line / jobMap missing → no line / textless lyrics produce no line / global lyrics counted).
- test-library 23→**26**: new section 7 — clip written with a skeleton present gets stamped; after a skeleton update, old fingerprint ≠ current; no skeleton → left empty.

### scripts\library-verify.js (fixed a pre-existing harness bug — unrelated to FIX-4 business but exposed by today's environment)

- `attachRewrite()` fixed a repeat-call short-circuit: with the plugin offline, main first wraps `attachRewrite(ch,false)` (rewrites only 48795); the rec scenario then calls `attachRewrite(ch,true)` to add the 48794 rewrite, but the `_rewritten` guard returned immediately — **48794 never made it into the rewrite list, so the rec scenario always hung waiting on capsOk when the machine state was "game offline"**. All previous rec greens ran with the game online (the online path); today the game was off and it surfaced. Fix: a repeat call only upgrades the `_rewriteGame` flag; patterns are generated at pageTarget connection time using the latest flag.

## 2. Explainable "Uncertain Results" (AUD-013's exit criteria requires itemizing these)

WORKPLAN WP-4's four required categories, current status:

1. Missing recording / continuous truncation / pose not reset — existing rules 1/2/3 (untouched).
2. Same-channel overlap / insufficient action duration / macro-inexpressible or quantization drift — overlap nesting fixed (AUD-009); macro quantization/line count now share the export's criteria (AUD-013); under the current action model, "macro-inexpressible" is mainly a <wait> granularity issue — walk/skill macro-inexpressible items need the WP-5 performance-script model before there is anything to check (honestly not done).
3. **Model / skeleton / clip fingerprints**: skeleton — online vs library (rule 7); clip — stamped at recording, mismatch reports yellow (rule 8); **model — metadata archived only (putModelFile records SHA-256), no report**: at checkup time there is no second trusted source to compare against, and gear changes only affect the appearance mesh, not skeletal-animation correctness; skeleton changes that do affect animation correctness are already covered by rules 7/8. The owner's old library of 264 clips was never stamped — all silently treated as "cannot confirm"; **newly recorded/imported clips now carry fingerprints**, so future role switches on reopen will report yellow.
4. Website/plugin capability mismatch — rule 9's bidirectional protocol + capability list (above).

## 3. AUD-004 Re-check Conclusion (impact on the missing-recording check)

- putClip metadata+data already commit atomically in one transaction (FIX-2); importBundle decompresses and recomputes hashes before writing, with zero residue on failure (FIX-2).
- Orphan repair `repairOrphans` runs automatically on library open (choreo-library.js); ghost clips ("index has it, data missing") are cleared the next time the page opens — the missing-recording check reads the index, so the window where a ghost can fool it only spans "corruption occurs → next open".
- Conclusion: AUD-004's fix chain is sufficient to protect the missing-recording check's accuracy; FIX-4 needs no additional checkup-side defense. This round only had clipIndex expose skeletonHash (the same metadata, no new write surface).

## 4. Verification Record (actually run)

- node tests: test-check **73/73**, test-edit **85/85**, test-projects 77/77, test-engine 35/35, test-library **26/26**.
- Browser regression (game offline, mock path): library-verify full suite **103/103** (incl. rec 25/25 — first offline green after the harness bug fix, sec 20, auto 4, sync 12, uicheck 6, proj 23, check 10, three diagnostics pages); clipcheck-run **100 assertions CLIP-PASS** (the new page was synced to the deploy copy — no FIX-3-style false green); offline-verify offline 11/11 + mode-check + clip-check pass.
- **offline-verify's online/transition scenarios, 3 items, not run**: they need the real plugin online (game was off); to be re-run via `scripts\offline-verify.js` next time the game is online, expected all green (these two scenarios' only intersection with this change is probeCaps/capsOk, and library-verify already covers that same code path).
- app html inline script syntax checked; `git diff --check` clean.
- All four deploy locations md5 identical: choreo-check.js=0a3b6d27…, choreo-edit.js=e606ef59…, choreo-library.js=4eabd2f0…, choreo-helper-app.html=fec13ad7… (web\ source, web\dist\ChoreoHelper, devPlugins deploy copy, game-dir dist — all four verified one by one).
- C# untouched, no DLL built; version stays 0.7.1.

## 5. Addendum: Realtime Checkup + Red/Yellow Outline Highlight (requested by owner same day; implemented)

After seeing FIX-4 the owner asked 「可不可以实时体检，并且用对应颜色高亮显示出来」 — implemented with zero changes to the rules engine (conflict issue items only gained a `pid` partner field):

- **Realtime checkup engine** (choreo-helper-app.html new `scheduleRealtimeCheck/runRealtimeCheck/applyCheckIssues/updateCheckBadge`):
  - `render()` schedules an **800ms-debounced** check after every redraw — it actually runs only after editing, dragging, pasting, or undoing settles, never mid-drag; the library index/skeleton fingerprint cache lives 30s, and any library change (auto sync / manual import / recording ingest / clear) immediately invalidates the cache and reschedules the checkup.
  - **Issue signature comparison**: if the results (level:clipId:partner:rule:time) are unchanged, no redraw — dragging/playback is never needlessly interrupted, and render→check→render cannot loop; on change it renders and refreshes outlines.
  - Failures silent: any realtime-checkup exception shows no popup and retries on the next edit (the popup checkup remains the full-criteria version, including online skeleton comparison).
- **Highlighting**: found red/yellow issues outline their clips on the timeline by clipId (+ the new `pid` conflict-partner clip) — red `issue-red`, yellow `issue-yellow` (inset outline + faint glow; selected state keeps both classes); **hint-level issues get no outline** (no noise). Jumping still goes through the checkup modal's clickable entries.
- **Badge**: the toolbar 「🩺 体检」 button carries red N / yellow M counts (`updateCheckBadge` refills it after render rebuilds the button).
- **Modal/realtime sync**: after a manual checkup-modal run, `applyCheckIssues(issues)` applies them — outlines/badge follow the modal's results (the modal's ctx is fuller, including online skeleton comparison).
- **Acceptance**: clip-check new **㉔ group, 3 assertions** (both overlapping clips get red outlines; missing-recording gets a yellow outline; staggering them clears the outlines — driven through the real `__checkRun→applyCheckIssues→render` sync chain), clip-check 100→**103**; test-check unchanged at 73/73 (pid is an additional field); library-verify **103/103**, offline-verify offline + two diagnostics pages pass (online/transition still awaiting an online re-run); app inline script syntax passes; four deploy locations md5 identical (choreo-check=7af57d74…, app html=9ea75d04…, clip-check=c2cc3c28…; choreo-edit/library untouched).

Two extra observation points for the owner's on-machine checkup acceptance: ① within about 1 second of an edit, the badge and outlines update automatically (no button press); ② after separating two overlapping clips, the red outlines disappear automatically.

## 6. Remaining Items

1. **Owner on-machine acceptance (WP-4's full exit condition; prerequisite for ticking SPEC's "Choreography Checkup")**: ① open the homepage, click 「🩺 体检」, review the three-tier graded results; ② deliberately reference unrecorded actions, run the checkup — a yellow entry should appear and be clickable to jump; ③ make two mutually overlapping clips (one long wrapping one short) — a red entry should appear; ④ confirm the old-plugin / missing-capability messages are understandable; ⑤ the two realtime-checkup observation points: badge/outlines auto-update within ~1s of an edit, red outline auto-clears after staggering an overlap.
2. **offline-verify online/transition re-run: all green (2026-08-29 evening), and it incidentally fixed a real plugin bug**:
   - Diagnosis: with the game running but no character logged in, `/export/skeleton` returned no player → panel fell back honestly to snapshot skeleton (correct behavior); **after the owner logged in it still returned no player → the real root cause was `ExportServer.HandleSkeleton` permanently caching its first result (including errors)** — whoever called it once before login doomed every later call, even with a character logged in. This is exactly the cause of the CONTINUITY open case "/export/skeleton returns byte-identical cached responses, dual-sample stillness detection fails".
   - **Fix (FIX-4's only C# change, src/Exporter/ExportServer.cs)**: cache removed, computed fresh every call, errors never cached; Debug build 0 errors (6 pre-existing warnings), hot-reloaded in game, verified to return a real 101-bone skeleton after login.
   - Re-run results: **offline-verify 21/21 all green** (offline 11 / online / transition / mode-check / clip-check) + library-verify **103/103** (real plugin online path) + clipcheck-run **103/103**.
   - Harness/test infra also fixed: ① library-verify's attachRewrite short-circuit bug (rec offline always hung on the capsOk wait; all previous rec greens ran with the game online) ② mode-check's zero-request assertion now also excludes /settings/engine and /gpose/state (requests sent incidentally during probeGame connection, unrelated to playback control — aligned with the existing /health and /capabilities exclusions).
   - **Known jitter (not a code issue, recorded honestly)**: in back-to-back "all" runs the diagnostics pages occasionally hit a 120s timeout (about 1 in 3; always passes when run alone) — headless Chrome long-run timing jitter; static 404s (model.glb doesn't exist) respond without CORS headers, causing console noise (preview3d already catches it; optional OPT cleanup).
3. After the owner's acceptance, tick SPEC line 38 "Choreography Checkup" + update CONTINUITY; only then is WP-4 marked complete.
4. Next workpackage is OPT-1 (AUD-016/017 recording robustness, P2), in audit order.
