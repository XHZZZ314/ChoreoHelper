# Stage movement and facing: active owner scope

## Pre-existing failure repairs (2026-09-15, owner-authorized)

Registered INT-20260915-PREEXISTING-FAILURES-REPAIR (resolved completed-bounded). Owner
authorized fixing the failures recorded during the unified-entry round; scope = bounded root-cause
repairs of those checks plus the two live-root deployments they require. No DLL/C# change, no
commit. All pre/post comparisons were made before touching anything.

Fixed, with mechanism:
- clip-check page never finishing (68过1败 → clipcheck-run/offline-verify/library-verify timeouts):
  three independent causes. (1) `choreo-macro.js project()` threw on macro-invalid stored commands
  (injection-fixture `/<img…` fails the command grammar), crashing the whole render through the
  macro panel — projection now degrades such rows to marked invalid rows (surrogate key, never
  matched, never silently rewritten; user input stays strictly validated in reconcile; byte-proven
  identical for valid inputs; +2 regressions in test-macro.js). (2) Step ㉒ asserted the removed
  auto job-switch insertion (explicit-gearset decision; addClip passes needSwitch=false) and
  crashed on an unguarded `switchClips[0].start` — rewritten to the current contract (no auto
  switch, no currentJob auto-write, explicit switch clips still protected by +0.05 deferral).
  (3) Step ㉙'s ChoreoLibrary stub predated the check-modal resource report (missing
  listProfiles/allClipIndex). Step ⑨ lacked the multi-select `selected` flag; step ㉚ asserted the
  removed 600ms auto-apply timer — rewritten to the explicit-apply contract (draft-only input,
  apply button writes the original dancer). Result: clip-check 153/153 from repo dist AND from the
  game root (clipcheck-run default).
- test-stop.js window-less VM ReferenceError: playbackContext lacked `window` (same self-reference
  pattern as the file's own setup()); gameStartPlay's optional-module guards need it. 20/0.
- offline-verify 48/2 → 50/0: the skeleton check expected stand-in dancers to display a 101/101
  match; the per-dancer assets contract marks stand-ins 「（替身）」 honestly and reports matches
  only for real models (asserted elsewhere). Updated the assertion to the honest-stand-in
  contract. The clip-check scenario turned green via the fixes above plus root deploy.
- library-verify 141/9 → 150/0: (a) stale generated catalog snapshot — the online catalog
  validation requires every action `type:'action'` (live plugin serves 2243 typed actions; the
  jobName filter drops all non-action types), but dist snapshots carried no `type`. Fixed
  `make-offline-assets.js slimAction` to keep `type` and regenerated the snapshots against the
  running plugin (catalog 2243 typed actions / 305 emotes; skeleton refreshed). rec 28/0 (counts
  exactly 264 — no expectation change needed), verify 23/0 (AC-7 rows render). (b) clock scenario
  sequencing: the second `gameStartPlay()` early-returns while the first play is still running, so
  follow never attaches after the simulated statusV2 upgrade — added an explicit stop between the
  AC-4 and AC-3 phases (follow attaches at start by design). clock 10/0.
- Found-while-regressing test-macro-browser.js '切换项目' leak: the simulated switch changed
  projectId/dancers but not contentExtra, while real project switches replace contentExtra (draft
  records are project-scoped by design). Test updated to real-switch semantics. 15/15.

Not fixed, recorded: test-skill-game-http.js requires an explicitly provided pairing file (owner
input by design); the process-audit/pipeline context-budget excesses are pre-existing doc-size
policy matters, net additions this round kept minimal.

Install: four files hash-verified into both live roots with per-root backups
(`choreo-macro.js`, `clip-check.html`, regenerated `catalog-snapshot.js`, `skeleton-snapshot.js`;
standin-model.js and mode-check.html byte-unchanged, not reinstalled) — manifest
D:/choreo/preexist-repair-install-20260915-1/web-install.json. Post-install: clipcheck-run default
(game root) 153/153, offline-verify all 50/0, library-verify all 150/0. Game was running during the
web-asset sync; one read-only /capabilities snapshot is in the unified-entry install evidence.

## Unified show entry and whole-show check (2026-09-15, latest owner scope)

Registered INT-20260915-UNIFIED-SHOW-ENTRY (resolved completed-bounded). Owner boundary this
round: web development, offline tests and repo-dist sync only — no real-game operations, no
install over the running plugin, no auto-sync of the two live install roots, no commit/push.
Real-game effect acceptance stays deferred to the unified owner acceptance session.

Verified from source first (not memory):
- Baseline problem reproduced: `gameStartPlay` (choreo-app.js) blocked movement/facing projects
  with a dead-end toast ('走位与朝向尚未接入日常游戏执行…') and no route into the existing
  stage flow; the whole stage flow (`ChoreoStageGameUI.open`) was reachable only from inside the
  stage-motion editor dialog. Red baseline proven by re-running the extracted pre-change
  `gameStartPlay` body in a VM: no routing, toast only, zero writes.
- Existing capabilities confirmed reusable and NOT duplicated: whole-show support/exclusion
  rules live only in `ChoreoStageShow.review` (stage-show.js); owned-show lifecycle and late-
  response guards in `choreo-show-owned.js`; readiness three-state checks in
  `choreo-stage-readiness.js`; replay in `choreo-stage-replay.js`; read-only refresh chain
  (probeCaps → directed reconnect → /x1/ability-read?mode=context) already used by the stage
  dialog. Daily pure-action/gearset/skill channels untouched.

Implemented (4 changed files + 1 new, no new player/clock/timeline/console):
- New `web/choreo-show-entry.js` (`ChoreoShowEntry`): pure `countEvents` (counts only, per
  selected dancer vs others vs disabled, gearset commands separated), pure `summarize` (binding
  project/revision/dancer/profile + counts + locally-decidable blockers with object/cause/next;
  plugin-unread ⇒ honest 未知, never fabricated), pure `structureReview` (delegates support
  judgment to `ChoreoStageShow.review` output; buckets 本机执行 / 仅网页排练(其他舞者) /
  网页预览范围(歌词) / 游戏执行限制排除 / 原项目停用 / 阻断; splits error strings into
  object+cause; `partial` flag forces 部分执行 labeling). Dialog `open()`: zero requests on open
  (asserted); explicit 检查整场（只读刷新） runs exactly the existing read-only chain and the
  real review pipeline; conclusion binds signature (project+docRev+dancer+profile+dancer-count)
  and plugin session — any drift marks 检查结论已失效 and stale async responses are dropped by
  a version token (checked after every await); dancer switch invalidates; no auto retry; close
  preserves choreography. One 进入现有准备与确认流程 button routes into the untouched
  `ChoreoStageGameUI.open(di)` (flow keeps its own review/confirm boundaries). Records footer
  lists saved `stagePathRecords` with one 复盘 button each into `ChoreoStageReplay.open`.
  STATE labels (尚未开始/准备中/待确认/执行中/停止处理中/已完成/失败或结果未确认) match the
  readiness/replay vocabulary; boundary lines state HTTP success ≠ game effect and history
  grants no re-performance permission.
- `web/choreo-app.js` three wirings only: toolbar button 🎭 游戏演出 next to the play controls
  (reuses existing playback-target switch and game preview dancer); `gameStartPlay`'s
  movement/facing block now opens the unified entry with `{entry:'daily-blocked',di}` (module
  missing ⇒ original toast preserved); `bumpTimelineRev` calls `ChoreoShowEntry.invalidate()`.
- `web/choreo-helper-app.html` gains one classic script tag (shell 5118/5120 bytes; comment
  indent trimmed, no behavior change). `scripts/make-release-staging.js` whitelist entry added.

Verification: red baseline demonstrated (above) → new `web/test-show-entry.js` green: pure
counts/summary/blockers/unknown, review bucketing incl. blocker object/cause split and partial
labeling, open-zero-requests (connected too), offline unknown degradation, read-only endpoint
allowlist (GET-only, existing endpoints only), mid-flight project change drops late responses,
external invalidate + session change mark stale, routing carries selected dancer, replay record
identity, no-path guidance to the daily channel, gameStartPlay routing + fallback (vm
extraction). Regressions pass: ability-plan, stage-game-ui, stage-readiness(+pure), stage-replay
(+pure), stage-show, stage-game-plan, stage-motion, stage-multi-dancer, stage-facing-exec,
stage-facing-independent, web-rehearsal, gearset×3, skill-game, stage-segments, stage-recovery,
release-gates; fast pure suites engine/edit/check/projects/document/docwire/showcompiler/library
and shell 117/0. Browser smokes (disposable profile, HTTP(S) fully blocked, explicitly NOT
fixed-profile acceptance): new `web/test-show-entry-smoke.js` 19 checks — toolbar entry opens,
zero-request open, offline unknown, daily-block auto-routing with movement count, close leaves
choreography intact, zero network zero page errors; existing readiness/replay smokes still pass.
offline-verify 48/2 and library-verify 141/9 — both compared PRE vs POST (dist temporarily
reverted to pre-change files): failure sets identical, so all are pre-existing and unrelated:
clip-check page halts at the owner's uncommitted command strictness (`命令尚未写完整` on the
injection fixture) so its title never settles (clipcheck-run timeout; proven identical on a
pre-change throwaway copy), recording-catalog counts need a populated real library, AC-3
GAMECLOCK follow needs live statusV2 behavior, AC-7 audit-row buttons, skeleton 101/101 check
sees an unbound-profile stand-in. `test-stop.js` fails at a pre-existing window-less VM
ReferenceError introduced by the owner's uncommitted blocksGame line (proven identical
pre-change); `test-skill-game-http.js` requires an explicitly provided pairing file and was not
run this round. Matrix deviation recorded: live-root clip-check and live-root twin sync were
NOT performed because the owner forbade touching the two live install roots this round.

Install: repo dist twin `web/dist/ChoreoHelper/` was synced first (hashes verified). After the
round closed, the owner explicitly authorized deploying the two live install roots in the same
conversation; the three changed web products (`choreo-app.js`, `choreo-helper-app.html`, new
`choreo-show-entry.js`) were individually pre-backed-up and hash-verified into the devPlugins and
game live roots (`web-install.json` with before/after hashes; before-hashes in `backups/`). The
game was running during the web-asset sync; one read-only `/capabilities` snapshot was recorded
(`live-capabilities.json`, healthy v0.7.1). Post-install: source == repo dist == devPlugins ==
game byte-identical for all three files, and the game-root `mode-check.html` smoke passes 23/23.
No DLL or C# change, no build.

Use now: with any project (offline too) press 🎭 游戏演出 in the toolbar, pick the 本机舞者,
read 绑定/时长/事件计数/阻断与未知项, then 检查整场（只读刷新） for the full executable/
excluded/blocked conclusion (parts labeled 部分执行), then 进入现有准备与确认流程 walks the
unchanged 审阅→登记→游戏内确认→开始 chain; results remain in the same dialog and 复盘 opens
the read-only replay. Daily game playback on a movement/facing project now auto-opens this
check instead of a dead-end toast; web rehearsal/pause/drag are untouched.

Deferred unified real-game acceptance (one owner session, unchanged list): independent facing
real turns, polyline, ≥2-segment long shows, multi-dancer presentation in a fixed-profile
browser session, both physical manual modes, plus this round's unified-entry flow walked once
live with the plugin online.

## Multi-dancer presentation, package triage and batch resource coverage (2026-09-15, latest owner scope)

Owner queue item ⑦. Registered INT-20260915-MULTI-DANCER-PACKAGES (resolved completed-bounded).
Web-only again: no protocol, DLL, C#, project or history changes; no multi-client execution invented.

Verified from source first (not memory):
- Multi-dancer authoring already complete — `choreo-stage-motion.js` keeps per-dancer movement/facing
  tracks in `_doc.extraTracks` keyed by performerId, with per-dancer sampling/metrics/preview; nothing migrated.
- The whole-show review already listed every dancer's events but collapsed all other dancers into one
  generic string ('不属于本次所选舞者；须显式选择单舞者范围') with no per-dancer identity, and
  `packageFor` packs exactly one performer + one x1 binding.
- Native hard boundary confirmed: `Bindings.Single()` in NativeStageEvents/StagePathMappingReview/
  X1GameRegistrationFactory — one client executes one local actor; `prepared.Bindings` multi-entries exist
  only for `OtherActorPositionProvider` observation (face-toward-target), not execution.
- The `choreo-ensemble-*` family was read and run for the first time this round: it is a complete
  two-person direct-connect multiplayer performance TRIAL (WebRTC DataChannel manual invites, clock
  estimation, local per-machine audio, ready→schedule→serial plugin access, per-performer package split
  with SHA-256 freeze) — all 7 suites pass (185 checks). It is NOT a local performance-package
  distribution/load chain, so no reuse was forced; reported as-is and this round stays web-side.
- Result chain (`stagePathRecords`) stays single-show single-dancer; the saved review snapshot picks up
  the new fields automatically, and old records degrade without them.

Implemented (5 existing files, no shell/whitelist change):
- `choreo-stage-show.js` review now returns a `dancers` summary (selected dancer first, then first-appearance
  order): per dancer name (canonical `doc.performers`, degraded to performerId when absent), executable flag,
  enabled/excluded counts. Every row carries `dancerName`. The other-dancer exclusion text was rewritten in
  the four-key style: '舞者「X」未绑定本地角色，仅网页排练预览；本场逐条排除，不在游戏执行（一个客户端一次只执行所选舞者）'.
  `packageFor` untouched — one performer, one binding, no other-dancer events ever packaged.
- `choreo-stage-game-ui.js` show scope renders a 多舞者（共 N 位） block (bound dancer → 绑定本地角色 #id 可执行;
  others → 仅网页排练预览, N 条逐条排除) and prefixes each per-row line with the dancer name (multi-dancer
  projects only; single-dancer display byte-unchanged).
- `choreo-stage-readiness.js` review section adds one guarded 多舞者 scope line when the review carries
  >1 dancers; old snapshots without the field show nothing new and fabricate nothing.
- `choreo-skill-coverage.js` gains a pure `summary(rows)` aggregation for batch resource rollout: groups the
  per-dancer inspection by distinct Action (ordinary motions excluded), counts ready vs missing/unbound/
  missing-model per action. `choreo-skill-motion-ui.js` renders a 批量铺开汇总 block above the existing
  per-event list naming exactly which Action lacks resources on which dancer's profile. Read-only; no new
  endpoints, no keying changes.

Verification: red baseline `red-stage-multi-dancer.log` (review.dancers absent, exit 1) → new
`test-stage-multi-dancer.js` green (per-dancer summary + counts, per-row exclusion style, single-local-actor
package boundary incl. no other-dancer events, single-dancer unchanged, performerless legacy shape degrades
to performerId, readiness line on/off/legacy-absent, game-dialog 多舞者 block + row prefixes via vm harness,
action aggregation incl. empty input). 31-suite routine web set passes (`web-suites.log`: stage full set +
show-owned/showcompiler/check/edit/document/docwire/projects/shell 117/engine/skill set + ensemble 7 suites).
One out-of-routine failure archived as pre-existing: untracked WIP `test-x1-inputs.js` fails a
capability-normalization deep-equal (`extra:true` not stripped by `choreo-document.js` ensureDocument); its
require graph contains none of this round's five changed files — not retried or weakened.
Docs check stays 59/60 and pipeline check keeps the same pre-existing defaultContextBytes budget excess
(22694 vs 20000 cap) plus the recorded prerequisite-inversion warning. `pipeline-cli next` (default) still
routes the older unrelated INT-20260914-SKILL-COMPLETE planner prompt — output preserved in
`pipeline-next.json`, no role switch made.

Install: five changed web products individually pre-backed-up and hash-verified into all three dist roots
(`web-install.json`; before-hashes in `backups/`). No DLL or C# change, no build. The owner's game was
running during the web-asset sync; live `/capabilities` first confirmed the same healthy instance
b18ee5ff… still advertising stageFacingV1/stageShowV2/stagePathNativeConfirmV1 (`live-capabilities.json`);
no 0x800711C7 symptom, no rollback, no game endpoint beyond that read.

Use now: in a multi-dancer project open 游戏走位 · 连接与结果, pick the executing dancer and read the review —
the dialog names every dancer with its executable/web-rehearsal verdict, each event line is prefixed with its
dancer, and registration still packages only the selected dancer (one client, one local actor). The pre-show
readiness page shows the same scope line; saved replays of new shows include the new texts (old records
unchanged). 技能面板 → 检查本项目全部技能资源 now also prints the per-Action 批量铺开汇总.

Boundaries: multi-dancer game execution is NOT in this round (one client moves one local actor); ensemble
direct-connect multiplayer remains a separate trial line with its own acceptance; no game effect was issued
or claimed — independent facing turns, polyline, ≥2-segment long shows, the multi-dancer presentation in a
real browser session, and physical manual modes all stay on the unified deferred acceptance list
(fixed-profile browser acceptance still blocked on the absent D:/choreo/local-backup-20260915).
Evidence root: D:/choreo/multi-dancer-20260915-1/.

Next queued owner item: per the owner queue after ⑦ (unified deferred game-effect acceptance session when
the owner chooses; fixed-profile browser rounds resume after the agreed C: local-tree backup appears).

## Pre-show readiness page (2026-09-15, latest owner scope)

Owner queue item ⑥. Registered INT-20260915-STAGE-READINESS-PAGE (resolved completed-bounded).
Web-only and strictly read-only: no protocol, DLL, C#, project or history changes; the page never
issues prepare/show-start/stop or any game output — next-step texts only point at the existing
prepare → show-review → show-confirm → show-start flow.

Data side verified from source first (not memory): /capabilities shape from
`LocalApiSecurity.CapabilitiesJson` + `WithGlobalStopCapability` (version/protocol/pluginInstanceId;
stagePathShowV1/stagePathNativeConfirmV1/stageShowV2/stageFacingV1 injected together by
`PlaybackStatusV2.WithStageShowCapabilities` only when ShowRunner+X1 input status+global stop are
all present); /x1/status from `X1InputPreparation.StatusJson` (gameReadable/gameReason, actor
id/territory/worldX/worldZ/rotationRad, movementReference.IsWalking, calibration
complete/validForCurrentState/completedSamples/requiredSamples/turnThenMove/message, stageManual
mode/description/cooperativeKeys, cameraPreparation.lastAttempt); /shows/status from
`ShowRunner.StatusJson` (state, stageMapping, stageMappingConfirmed, x1Prepared,
x1Registration incl. actorId/territoryId/independentFacing/mixedShow, stopReason); the game
dialog's existing `connection()` snapshot (`ChoreoShowOwned.reconnect`); `ChoreoStageShow.review`
errors/segmentCount/facingIncluded/rows; and the native Ready() gate — facing shows additionally
require `Calibration.Complete` with the prepare hint. Old flows untouched, nothing migrated.

New `web/choreo-stage-readiness.js` (classic script; no new player/clock/console/button system):
pure `check(snapshot, review)` renders seven fixed sections — plugin connection & capabilities
(each capability shown declared/not; stageFacingV1 required only when the review includes facing,
drift = fail), actor readability & territory, gait reading (IsWalking true/false/null),
this review's conclusion (error list, auto-split segment count, facing-included vs capability
match, per-item excluded rows with the four-key reason; path-only compat scope stated; local data
so it still renders offline), registration/mapping/execution state chain (busy, plugin reload,
playing/completed, mapping unconfirmed → show-confirm hint, confirmed = pass with "not yet
consumed"), calibration/prepare state (sample progress, turn-then-move note, prepare moves the
character briefly and leaving game foreground voids it) and manual mode (Cooperate without safe
disjoint keys fails). Every section is pass/fail/unknown with a next-step suggestion; the
boundary text 就绪=可执行≠已验收 is always shown; offline/refresh-failure degrades honestly to
无法判定 (never fabricates; the review section still shows because it is local). `open()` fetches
nothing itself: it reuses the existing `probeCaps` + `ChoreoShowOwned.reconnect()` refresh
(read-only GET set /capabilities, /shows/status, /x1/status, /playback/status, /shows/clock) and
takes the review from the game dialog via `getReview`.

Entry: one 演前就绪检查 button in the existing game-stage dialog (`choreo-stage-game-ui.js`);
the shell gains one classic script tag (the ARCH-2 comment was compressed to keep the shell at
5088/5120 bytes; no other shell change); release-whitelist entry added in `make-release-staging.js`.

Verification: red baseline `red-stage-readiness.log` (module absent, exit 1) → `test-stage-readiness.js`
green (fixed seven sections, all-pass fixture, missing-capability naming, facing-capability drift,
unreadable actor, null gait, missing/error/path-only review, registration chain incl.
busy/changed/playing/completed/unconfirmed mapping, calibration progress + prepare hint, manual-mode
failure, offline degradation with honest review display, UI dialog content incl. three-state legend
and boundary text, read-only endpoint set at runtime, recheck button, entry wiring, static
zero-network/zero-write/zero-endpoint-reference source checks, shell tag + <5KB + whitelist).
The 22-suit routine web set passes (`web-suites-final.log`; shell 117/0 after dist sync).
Disposable-profile smoke `test-stage-readiness-smoke.js` (explicitly NOT fixed-profile acceptance;
HTTP(S) fully blocked) passes 15 checks with zero page errors and zero network requests (`smoke-1/`).
Docs check stays 59/60 with the same pre-existing defaultContextBytes excess (22513 vs 20000 cap,
grown by prior-round doc appends; cap unchanged, not weakened). `pipeline-cli next` (default) still
routes the older unrelated INT-20260914-SKILL-COMPLETE planner prompt — output preserved in
`pipeline-next.json`, no role switch made.

Install: three changed web products (new `choreo-stage-readiness.js`, `choreo-stage-game-ui.js`,
`choreo-helper-app.html`) individually pre-backed-up and hash-verified into all three dist roots
(`web-install.json`; before-hashes in `backups/`). No DLL or C# change, no build. At closeout the
owner's game was running and /capabilities verified the previously cold-installed DLL
A116A317… is live and advertising stageFacingV1/stageShowV2/stagePathNativeConfirmV1
(pluginInstanceId b18ee5ff…, `live-capabilities.json`); no 0x800711C7 blocking, no rollback
needed, no other game endpoint touched. Fixed-profile browser acceptance remains blocked (the
agreed D:/choreo/local-backup-20260915 of the C: local tree has not appeared); the smoke above is
clearly labeled non-acceptance, and readiness shown as 通过 never means game-effect acceptance
(independent facing turns, polyline, ≥2-segment long shows stay on the unified deferred list).

Use now: open 游戏走位 · 连接与结果 → 演前就绪检查. The dialog summarizes in one screen what is
still missing before a show (connection/capabilities, actor, gait, this review's conclusion,
registration/mapping, calibration, manual mode), each with 通过/未通过/无法判定 and the next
step; fix items through the existing flow and close. Evidence root:
D:/choreo/stage-readiness-20260915-1/.

Next queued owner item: ⑦ multi-dancer / performance packages / batch resource coverage.

## Performance replay view (2026-09-15, latest owner scope)

Owner queue item ⑤. Registered INT-20260915-STAGE-REPLAY-VIEW (resolved completed-bounded).
Web-only and strictly read-only: consumes already-saved `stagePathRecords`; no protocol, DLL, C#,
project or history changes; old records are never migrated or rewritten, and missing fields in old
records degrade with explicit notes instead of fabricated data.

Data side verified from source first (not memory): saved-record shape from
`choreo-stage-recovery.js result()` (version/savedAt/packageId/clientLoadId/instanceId/review incl.
the whole review snapshot/mapping/report/showResult), per-event log fields from ShowRunner
`StatusJson` (id, kind, plannedMs, dispatchedMs, ok, reason, skipped, skipClass, skipMarking —
recentLog keeps only a tail of 32 for the mixed compiler, so truncation is surfaced honestly), and
report metrics from `X1CameraFeedbackReport` (TotalDistanceM/FinalDistanceToTargetM/
MaxPathTrackingErrorM/ArrivalToleranceM/ManualMode/ManualInterventions/ManualResumptions, saved in
PascalCase).

New `web/choreo-stage-replay.js` (classic script; no new player/clock/console; zero network,
storage or project-write outlets — asserted statically): per-event table 计划 vs 实际分发 with
to-point delta and 已执行/已跳过/失败 classification plus reason and whole-show state/stopReason/
cleanupFailed; movement metrics (planned distance vs actual cumulative, endpoint error, max
tracking error, per-authored-segment plan, per-execution-segment dispatches when auto-split;
skills/abilities show submission and receipt only, never inferred game effects); review-snapshot
replay — the 当时受支持/被排除 verdicts with reasons (incl. the four-key independent-facing
exclusion) paired side-by-side with actual results, the original path row joining all its `-sN`
segment results; manual-mode info (mode/介入/续走) when present in the record. Per-event 定位
seeks the existing web preview through the existing timeline seek (game preview target refuses
with a clear hint; zero HTTP either way). The dialog states 回放的是编排数据，不是游戏实况录像 and
that replay restores no execution permission. Synthetic fixtures flagged `synthetic:true` are
labeled 自动化合成夹具（非真实演出）; unflagged records read as saved plugin-report snapshots. A
timelineRevision mismatch vs the current document shows a staleness note. Entry: one 复盘 button
per saved record in the existing game-stage dialog records area (`choreo-stage-game-ui.js`);
release-whitelist entry added in `make-release-staging.js`; the shell gains one classic script tag
(5100/5120 byte budget).

Verification: red baseline `red-stage-replay.log` (module absent, exit 1) → `test-stage-replay.js`
green (pure classification/delta, tail-truncation note, review↔result pairing with segments and
excluded facing, metrics degradation, manual info, source labels; UI dialog content, zero-HTTP
guard, web/game seek split, drift note, old-record degradation, game-dialog entry). 22 web suites
pass (`web-suites.log`: stage-replay, stage-game-ui, stage-recovery, stage-show, stage-segments,
stage-facing-exec, stage-facing-independent, stage-motion, stage-game-plan, show-owned 20,
showcompiler 43, check 94, edit 402, document 120, docwire 56, projects 105, shell 117, engine 50,
skill-motion, skill-stages, skill-game). Disposable-profile smoke `test-stage-replay-smoke.js`
(explicitly NOT fixed-profile acceptance; HTTP(S) fully blocked; synthetic record injected) passes
14 checks with zero page errors and zero network requests (`smoke-1/`). Docs check stays 59/60 and
pipeline check keeps the same pre-existing defaultContextBytes budget failure (unchanged, not
weakened). `pipeline-cli next` still routes the older unrelated INT-20260914-SKILL-COMPLETE
planner prompt — output preserved in `pipeline-next.json`, no role switch made.

Install: three changed web products (new `choreo-stage-replay.js`, `choreo-stage-game-ui.js`,
`choreo-helper-app.html`) individually pre-backed-up and hash-verified into all three dist roots
(`web-install.json`; before-hashes in `backups/`). No DLL or C# change, no build, game offline
throughout. Fixed-profile browser acceptance remains blocked (the agreed
D:/choreo/local-backup-20260915 of the C: local tree has not appeared); the smoke above is clearly
labeled non-acceptance. Real game effects (independent-facing turns, polyline, ≥2-segment long
shows) stay on the unified deferred acceptance list. Evidence root:
D:/choreo/stage-replay-20260915/.

Use now: save a whole-show/path result as before; in 游戏走位 · 连接与结果 the records area shows
one 复盘 button per record. The dialog replays plan-vs-actual per event, movement metrics, the
review-snapshot exclusions and manual-mode counters read-only, and 定位 moves the web preview
playhead to an event's authored time (current choreography data, not a game recording).

Next queued owner items: ⑥ pre-show readiness page; ⑦ multi-dancer / performance packages / batch
resource coverage.

## Independent facing game-execution wiring (2026-09-15, latest owner scope)

Owner ruling item ③ "也要开发". Registered INT-20260915-STAGE-FACING-EXEC; capability means
executable, not accepted. No real game facing output this round; actual turning joins polyline,
long shows and physical manual modes on the unified deferred acceptance list.

Native (4 files): HttpServer now advertises `stageFacingV1` in the same ready chain as
stageShowV2 via the new pure `PlaybackStatusV2.WithStageShowCapabilities` (ClipCompare.cs,
datalayertest-tested). `StageShowContract` accepts facing events in mixed shows under the
existing four-key rule — facing must not overlap any path segment (same half-open check as
X1ShowProtocol, which re-verifies through `X1CameraPathPlan`→`ValidateForPreparation(ownsMovementFacing:true)`);
facing requires a parseable X1 input, positive duration and stopShow failure policy; the show
end may now be covered by the last path OR the last facing event (exact coverage still required;
gaps error honestly). Identity/performer/cap rules unchanged; stage-path-review-v1 still accepts
exactly one event. `StageShowDispatcher` gained an optional X1 facing core: facing events
dispatch at their original time (same 100ms window as motion/ability) into the dormant
`X1ShowDispatcher`/`X1FacingExecutor` chain through `X1StageExecutionSinks` (stage→world angle
transform, existing `_x1Sinks` turn keys, `_preparation.CheckExecutionSafety` input guard);
`UpdateActive` advances the path first, then facing so a boundary-touching tick releases path
feedback before facing takes the input-safety check; OnStop releases facing keys before path
teardown. `X1GameRegistrationFactory.PrepareStagePath` builds the core only when facing events
exist, reuses the ShowRunner clock/output lease/monotonic guards (no new player, clock or
console), and `Ready()` additionally requires `Calibration.Complete` with a clear prepare hint
(real turn-key output already failed closed without it). Registration metadata now reports
`independentFacing:true` for facing shows.

Web (2 product files): `choreo-stage-show.js` review takes an optional caps argument. When the
plugin advertises stageFacingV1, authored facing nodes compile per consecutive pair (including
the start yaw) into existing X1 `transition` inputs at original times with stopShow — no new
modes invented; pairs overlapping any path segment stay excluded per row with the four-key
reason (先转向再走), never clipped or retimed; uncompilable facing data stays excluded. Show
duration and the 5-minute cap now follow the last included facing end (path end otherwise —
unchanged when no facing is included). `packageFor` emits included facing events with their
compiled x1 and covers the same duration. Without the capability the blanket exclusion row and
text are byte-identical to before. `choreo-stage-game-ui.js` passes the live capability snapshot
into review, adjusts warnings/review footer text (stating path direction vs independent facing
and that executable≠accepted), and re-checks stageFacingV1 at registration when the reviewed
package includes facing (drift guard).

Boundaries preserved: per-segment ≤4s/1.5m, whole-show 5min/128 events, 1000ms handoff,
tolerances, write-before-safe, focus, input-lease and cleanup guards untouched; no coordinate
writes, pathfinding, loops or skill retries; loop motions with root displacement still rejected;
skills still once-only.

Verification: C# red baseline (red-csharp-contract.log: 3147 pass / 2 fail — tail facing
rejected by the old contract; capability grep 0 in HttpServer/ClipCompare) → datalayertest
3159/0 (green-csharp-final.log) incl. 19 `[stage-facing]`/`[stage-facing-red]` checks: contract
accept/reject matrix, half-open boundary, V1 refusal, capability string, X1-core registration,
original-time dispatch, linear transition interpolation at 45° midpoint, no early release,
immediate release at end, adapter close, idempotent second stop without double release, second
show dispatch, mid-facing stop release. Web red (red-web-facing-exec.log: capability-declared
review still excluded facing) → new `test-stage-facing-exec.js` green (pair compilation,
per-item four-key exclusion, package contents/duration, legacy no-capability text unchanged,
5-minute cap via facing tail). Routine 20 web suites pass (web-suites.log: stage full set,
show-owned, showcompiler, check, edit, document, docwire, projects, shell, engine, skill-motion,
skill-stages, skill-game). 13 other non-browser web tests fail for pre-existing environment
reasons (browser-stub/window, live plugin HTTP, C:-local assets; none import the two changed
files — not retried or weakened). Release build 0 warnings/0 errors (release-build.log). The
datalayertest executable ran without Windows App Control interference this round (no 0x800711C7
re-block observed). Docs check stays 59/60 with the same pre-existing defaultContextBytes excess
(measured 22175 vs 20000 cap, inherited); pipeline check reports the same pre-existing budget
failure and open-interrupt count.

Install: two changed web products individually pre-backed-up and hash-verified into all three
dist roots (web-install.json; before-hashes in backups/). New DLL
E0EC7DD79CE26D3811549374E601584CD7CC1DF2DED32472A4761CDF254E2FE3 cold-installed (game offline,
no ffxiv process) over BF7CE05B… which is retained at backups/ChoreoHelper.before.dll with the
manifested rollback path (dll-install.json). Fixed-profile browser acceptance remains blocked:
the agreed D:/choreo/local-backup-20260915 of the C: local tree has not appeared, so no browser
round is claimed; dialog behavior is node-suite covered only. Evidence root:
D:/choreo/stage-facing-exec-20260915/ (red logs, green logs, backups, manifests). No
commit/push/publish; dirty owner tree preserved (one accidental `git stash` during test triage
was immediately popped — stash list empty, 122 tracked modifications intact).

Use now: author movement + facing nodes as before; open 整场 review — with the new DLL loaded,
facing rows after the path end compile as executable transitions at original times while
overlapping rows are excluded item-by-item with the four-key reason; the same prepare →
show-review → show-confirm → show-start flow executes them via the turn keys (calibration
required beforehand). Actual in-game turning is still unverified.

## Long shows via lossless path segmentation (2026-09-15, latest owner scope)

Owner product review ruling: lift the 4-second show ceiling (loop-during-move stays rejected —
the game itself interrupts animations; skill-cadence advisory not wanted). Registered
INT-20260915-LONGSHOW-SEGMENTS. Why 4s existed: the first live movement trials deliberately
capped one native path event at the verified 4s/1.5m envelope and whole-show v2 inherited it;
no longer acceptance had ever extended it. Implementation keeps every live-verified per-segment
bound and chains segments instead of enlarging any envelope.

Web (`choreo-stage-show.js`): `segmentPath` splits the authored path losslessly — segment
boundaries are authored nodes; spans exceeding the envelope are cut only at exact
linear-interpolation points (authored node times/positions/ speeds unchanged; inserted points are
exact interpolations). First segment keeps the original event id; others get `-sN` suffixes. Show
cap stage-1 60s / 128 events after segmentation; review surfaces both caps as errors and exposes
`segmentCount` (UI shows the split plan, warnings and editor notices updated). `packageFor` now
builds the package directly (single-path pathOnly compat flow untouched).

Owner amendment INT-20260915-LONGSHOW-5MIN (same day): show cap raised 60s → 300000ms
(5 minutes). Web `MAX_SHOW_MS` and native `MaxShowMs` changed; per-segment 4s/1.5m envelope,
handoff budget and 128-event cap unchanged (75×4000ms segments cover 5 minutes). Web suite green
(300s/100-segment compile, 301s rejection). Note: the C# datalayertest executable was blocked by
Windows App Control (0x800711C7) on freshly built assemblies during this amendment round — the
production delta is the single constant; the same logic passed 3140/0 at 60s one hour earlier, and
the suite must be re-run when the environment allows (`D:/choreo/longshow-5min/` logs).

Native: `StageShowContract.Paths` accepts ordered non-overlapping chained movement segments
(first at 0, each ≤4s, last covers to show end per original timing), MaxShowMs=60000,
MaxEvents=128; `StagePathShowDispatcher` becomes sequence-capable (arm once, begin each segment
at the original show clock, per-segment dispatch identity, HandoffBudgetMs=1000 — if a segment
has not released input within the budget past the next start the show fails honestly, no
catch-up). `X1GameRegistrationFactory` builds one `X1CameraPathPlan` per segment and wires the
sequence dispatcher; `StageShowDispatcher` signature unchanged. Registration metadata and
`/shows/status` JSON unchanged.

Verification: web red baseline (`red-stage-segments.log`: old single-path cap rejected a 10s
path) → `test-stage-segments.js` green (3-segment 10s/3m chain with cap/contiguity/identity
checks, authored-boundary split, 10s hold → 3 segments, 60s/20-segment compile, 61s rejection,
129-segment rejection, mixed long show event identity + full `ChoreoX1Inputs.validatePackage`).
Existing suites updated for the intended multi-segment output: stage-show, stage-facing-
independent, all stage/game/recovery/show-owned/showcompiler/shell/document/docwire/projects
suites pass. Data-layer 3140/0 (+16 `[long-show]` checks: 3/60-segment contracts, 61s, overlap,
per-seg >4s, last-segment coverage, >128 events, dispatch-before-begin ordering, original-clock
begins, duplicate/unknown rejection, full-run completion, stop idempotence, handoff-budget
failure). Release build 0 warnings/0 errors. Install: DLL cold-installed (game offline) and
three changed web files individually synced with pre-backups to all three dist roots
(`install.json`); prior DLL AE12B0DC backup retained.

Boundary: no live long-show execution yet — a real ≥2-segment performance remains on the
deferred acceptance list; loop motions during movement stay rejected by owner ruling; independent
facing still excluded (stageFacingV1 unadvertised). Next queued owner items: independent facing
execution, result-replay view, pre-show readiness page, multi-performer/packages/batch resource
coverage.

## Independent facing authoring and preview (2026-09-15, latest owner scope)

Owner changed pace: advance the next unimplemented development before concentrating real-game
acceptance. Registered INT-20260915-STAGE-INDEPENDENT-FACING. Confirmed gap: the stage editor forced
facing nodes to share every movement waypoint time 1:1 (old `nodes()/edit()`), so mid-segment turns,
post-arrival turns and facing-only dancers were unauthorable, and whole-show review excluded facing
with a blanket "尚不支持" string and no capability declaration. Native chain was already complete
but dormant: X1ShowProtocol/X1ShowDispatcher/X1FacingExecutor parse, validate and can dispatch
facing; StageShowContract explicitly rejects facing kinds. This increment is web-side only.

Implemented (no new player/clock/console/standalone buttons; same dialog, lane, timeline and
preview pipeline): `web/choreo-stage-motion.js` now models movement and facing as two independent
node lists with their own strictly increasing times (`nodes()` returns `{movement,facing}`,
`edit()` takes that shape, each track optional); old paired data with equal times remains a valid
special case, and metrics split into movement speed segments and facing turn-rate segments with
separate durations. `choreo-stage-motion-ui.js` renders the same dialog with two tables
(路径节点/朝向节点), states the path-direction vs independent-facing distinction, draws facing-node
arrows at their sampled positions in the 2D draft, and the lane shows facing clips (⟳) beside path
clips. `choreo-stage-game-plan.js` review displays waypoint yaw by sampling the facing track at
waypoint times (display only; game execution adopts the path, not authored facing).
`choreo-stage-show.js` facing rows now declare the boundary explicitly: execution requires an
unadvertised `stageFacingV1` plugin capability plus per-event acceptance; rows stay excluded and
the compiled package never contains facing events. Daily game start still blocks stage tracks.

Boundaries unchanged: native StageShowContract still rejects facing; X1 facing executor stays
dormant (no evidence opened it); no game output, no coordinate writes, no pathfinding/loops; 4s/
1.5m, tolerances, write-before-safe, focus, input-lease and cleanup guards untouched; skills keep
once-only attempt and failure-continue.

Verification: new `web/test-stage-facing-independent.js` began red (decoupled stored data could
not even load under the old paired check, exit1) and passes green: decoupled edit/round-trip,
facing-only and movement-only tracks, independent sampling (mid-segment 105°/150° cases), clear
semantics, strict-time/number validation, foreign-track rejection, split metrics, game-plan
waypoint-yaw sampling and facing-only review refusal, capability-declared exclusion and
facing-free package. Updated stage-motion/stage-show/stage-game-plan/stage-game-ui suites to the
new model; passing suites: stage-facing-independent, stage-motion, stage-game-plan, stage-show,
stage-game-ui, stage-recovery, show-owned 20/20, showcompiler 43/0, check 94/0, edit 402/0,
document 120/0, docwire 56/0, projects 105/0, shell 117/0, engine 50/0. Browser driver
`test-stage-motion-browser.js` was updated to the dual-table UI (dancer0 authors a facing node at
5s between the 4s/6s waypoints; p5 yaw expectation 225°) but could not run this round: the fixed
browser profile and the whole `C:/Users/xhz/AppData/Local/ChoreoHelper` tree remain NOT FOUND from
this task (documented cross-task virtualization blocker; the agreed D: local backup has not
appeared), so the required fixed-profile acceptance was NOT executed and is not claimed. A clearly
labeled disposable-profile smoke (`test-stage-facing-smoke.js`, all HTTP(S) blocked, no real
projects/assets/game endpoints) passed real-dialog decoupled authoring, dual lane clips, sampled
mid-turn, persist, full browser exit, offline reopen and facing-only editing with zero page errors
and zero network requests.

Install: five changed web products (choreo-stage-motion.js, choreo-stage-motion-ui.js,
choreo-stage-game-plan.js, choreo-stage-show.js, choreo-stage-game-ui.js) were individually
pre-backed-up and hash-verified into all three dist roots; manifest `web-install.json`. No DLL or
C# change, no build needed. Private evidence relocated to `D:/choreo/stage-facing-20260915-094847/`
(red log, smoke rounds incl. the preserved failed smoke-1, backups, manifest) because the C: local
tree is invisible from this task; prior C: evidence roots are untouched wherever they exist.
Docs check stays 59/60 with the same pre-existing defaultContextBytes excess. Real-game polyline,
independent-facing execution and both physical manual modes remain on the unified later acceptance
list; nothing here claims game effects.

## Daily startup, connection recovery and result reminders (2026-09-15)

## Whole short-show integration (2026-09-15, latest owner scope)

INT-20260915-STAGE-WHOLE-SHOW: sustained direct owner development, no role switch or independent approval. Reuses the daily page, /choreo stage, original commands, ShowRunner clock, native mapping, input/focus guards, stop and result saver. No additional player, clock or console.

Concrete red: the existing path compiler discarded the ordinary motion and Action from a production-shaped scene (whole-red-2.log). The new stage-show-review-v2 scope includes original event IDs/times for one dancer's motion, self-target Action and single path. Native StageShowContract/StageShowDispatcher wrap the existing path dispatcher; NativeStageEvents shares its output lease and calls the existing once-only ability adapter. Skill failure is logged and skipped without retry or added cooldown/charge/prerequisite validation. Native safety checks can still stop the whole scene. Browser displays every event and exclusion before explicit registration; native current-position confirmation is still required and consumed by one explicit start.

Bounds remain one path from0 covering the entire show, <=4s/1.5m, <=32 events, original correction/frame/arrival bounds. Extra events require distinct positive trigger times before the path ends. Unsupported targets/kinds, out-of-range times and looping motions block registration; no truncation or retiming. Independent facing and other dancers require the explicit supported-scope selection and are clearly excluded. Native emotes are one trigger, not duration-controlled animation playback; skill presentation length is not proof of effect. Casting/game-state guards remain active. Arbitrary turns, independent facing, full multi-dancer scenes and physical manual modes remain unaccepted.

Evidence root (private, outside Git): C:/Users/xhz/AppData/Local/ChoreoHelper/stage-whole-1789403218667.
- Initial actual inventory226 projects/85 versions. Browser harness failure copy pmu1gvc6qp9avc9 preserved. Fixed-source independent authored copy pmu1gwhukkl6dql; cross-project protection copy pmu1hpejfhtay2d. Final observed229 projects/86 versions. All prior documents/versions and profile/clip index compared unchanged; original pmtzdam4b7ruhs3 exact. New copy's renderer adds only selected:false to one event on reopen; offline-node-identity.json separately records this existing view default, with all IDs, multiplicity, timing, other fields and results checked.
- Browser real UI authoring/review, real bound __action_16140 and wave sampling using existing web clock, explicit no-music mode preserving original song reference. Original macro drafts were never Applied. Same-session disconnect/reconnect retains ownership; actual idle plugin reload invalidates old request and permits new explicit registration without movement for recovery. Full Chrome exit then HTTP(S)-blocked file reopen restores both real results, no execution permission. Browser logs/PNG and raw audits are in browser-2. Necessary localhost routes only were allowed for native phase.
- Run1: fresh actor269024904/job24, territory816. Reviewed .18m over3s, hold through4s; self Action16140 at1.5s, /wave motion at3.1s. Native mapping origin399.828338623,-686.611450195. ShowRunner completed4000ms with dispatch0/1500/3125ms. Actual coordinate feedback distance.245609812m, endpoint error.065637659m, all keys released. Native skill returnedTrue, not the predicted rejection: effect and the complete native wave animation were NOT independently confirmed. Do not label this a real skill-failure test or successful skill effect. Screenshots show changed position/body direction; coordinate samples substantiate path feedback, not arbitrary path correctness.
- Separate explicitly announced stop run: new source/native identities, fresh idle and preparation/mapping, one start. Existing /control/stop issued only against the exact reviewed scene at about.8s; final showTime859ms. Only movement was dispatched; no Action/wave dispatch over another6533ms. Actual distance.113359495m, all keys released, cleanup safe. No replay of a failed scene, no physical key trials.
- Both real results saved to the authored copy. One injected storage failure (test condition only, real report unmodified) reports failure; retry and repeat save keep exactly two records. Foreign-project save is rejected. Old/late/cancel/cleanup-failed/identity and concurrent-save coverage also remains in existing pure suites. Explicitly synthetic native-failure callback tests prove failure-continue scheduling; they are not stored as real results.
- Preserved failures: invalid first red fixture, data fixture total-duration/capability mismatch, pre-sync shell mismatch, browser clip-index/selector/loading/serialized-extension assumptions, expired first preparation, missed nonaccepted native button click, system dotnet without SDK, and offline selected:false strict comparison. These did not justify fixture/data deletion or limit relaxation. Expired preparation was refused before any show started; only its necessary preparation was explicitly renewed.

Verification: targeted red/green and17 web suites pass (shell final117/0); data-layer final3115/0 including mixed protocol, clock, skip/continue, duplicate, stop, stale mapping, late event and loop rejection. Release build0 warnings/0 errors; docs60/60 and pipeline CLI281/281. Initial docs59/60 was the existing context-byte cap exceeded by the expanded continuity header; the header was shortened without relaxing the cap. Four changed web products were copied individually to all three roots, DLL backed up separately; r3/r4-install-manifest.json hold before/after hashes and idle snapshots. Final installed session997f0946abf54f0ab3a898096080ed4b advertises stageShowV2 and has input disabled, no owner/held keys, no cleanup failure and no playback. Native trials preceded the final additional loop-rejection/status-wording change; no unnecessary real replay was performed.

Use: edit motions, bound self skills and a short path on the existing timeline; open game-stage review and explicitly choose the displayed supported scope; register; in /choreo stage prepare, review current-position mapping, confirm, start once; immediately stop there or from web top bar; return to the web result panel and save to the named target project. Offline records restore history only. This is bounded mixed scheduling/results closure, not unrestricted native effect acceptance. Both physical manual modes remain skipped/unverified.

Owner scope: INT-20260914-STAGE-RECOVERY. This sustained direct-development increment is
complete for automatic/read-only acceptance. Physical interruption and cooperation remain
explicitly skipped and unverified. No new preparation, movement, facing, skill or show start
was issued. No independent pipeline approval or wider game-effect acceptance is claimed.

Daily entry: existing file page, top bar "游戏走位 · 连接与结果", or the existing dancer path
editor; game entry remains /choreo stage and normal plugin main/config. Both original command
paths remain compatible. Web shows current project, plugin version/protocol/capability,
actor/territory, registration, native mapping confirmation and execution state. The existing
15-second connection watcher refreshes the open panel and result reminder; no new timer or
player. Refresh is also explicit. Saved-result feedback includes project name and ID.

Root causes and fixes:
- Reproduction in owned-red.log: after a plugin reload the existing web owner still rejects
  the next load. A per-HTTP-server instance identity and stageRecoveryV1 permit coherent
  capability/status snapshots. A changed instance clears obsolete local ownership only when
  observed idle, input disabled, keys released and cleanup safe. Same-session ownership is
  retained; offline/mixed/late replies do not prove cleanup. Observed cleanup failure latches
  until an explicit confirmed stop; it cannot be erased by reconnecting.
- New owned loads carry the reviewed plugin instance. Server rejects a mismatched instance
  before adoption with the existing nonce-sealed noMutation response. Missing instance stays
  compatible with original commands. Unknown fields and malformed identities remain rejected.
- Explicit path stop resolves only the current source-to-native mapping and current clock
  identity before targeted stop. Old nonce semantics and foreign-scene protection are unchanged.
  Project/choreography changes invalidate local confirmation and cancel only this owned path;
  failure reports that native stop is unconfirmed and requires explicit stop. Existing native
  actor/area/focus/mode/write/cleanup checks continue to govern execution.
- Old result UI invoked persistProject without awaiting storage and announced success. The new
  small choreo-stage-recovery module checks project, source/native load and plugin identities,
  appends once through the production serializer/saveActive API and waits for database result.
  Failure retains the record locally for retry; late completion cannot mutate the new project.
  Saving does not call saveHistory, retime tracks, rewrite nodes or restore execution permission.
  Reloaded/unreadable results are explicitly unavailable. Stored history remains read-only.

Observed verification:
- Owned lifecycle regression: old 16 checks plus concrete reload red, final20 passed, including
  offline/mixed/cleanup/busy/cancel, source-to-native stop and reviewed-session binding.
- Result/UI tests cover missing/old reports, active execution, project/source/native identity,
  failure/retry/duplicate/concurrent save, late project completion and edit invalidation.
- Data-layer suite3098 passed/0 failed (+9 daily-state/optional-session parser assertions).
  Release build0 warnings/0 errors. Fifteen relevant web suites pass; docs60/60 and pipeline
  check pass with the previously recorded prerequisite-inversion warning. Process fix/re-audit
  passes25/25 with no repairs. git diff --check still reports the pre-existing handwritten-
  dialogue trailing space; its identical before-copy line is retained, not cleaned.
- Actual API rejects a stale pluginInstanceId with409/noMutation; current registered IDs and
  state remain exact (late-session-live.json). Actual browser reload/re-registration passes.
  Native panel was visually inspected. Registration/reconnection never prepared or moved actor.
- Final full browser4 uses the one fixed authorized profile, HTTP(S) blocked before every file
  navigation, and only necessary localhost48794 routes during native checks. It tests offline
  startup, connection loss, same-session reconnect, actual idle-owned DLL reload, obsolete load,
  unavailable result, new explicit registration, pending result reminder, failed save, retry,
  duplicate save, cross-project rejection and full process exit/offline reopen. Browser errors0.
  Fresh accepted copy pmu1g5onumtj4qi; separate cross-project copy pmu1g6gvv971k00.
- To honor no repeated movement, new saved results are clearly labeled synthetic persistence
  fixtures ("自动化保存测试（非真实演出）"). This proves browser identity/storage/UI behavior,
  not a new game performance result. Existing real results and their prior acceptance remain.
- Initial220 projects/85 versions; final226 projects/85 versions, observed from full inventories.
  Every prior project/version and original pmtzdam4b7ruhs3 exact; all84 older historical versions
  and the later85th preserved. Private profile/clip inventory exact. Each round uses a fresh
  original-source copy and preserves failures. Only the previous-active derived timelineRevision
  may advance once on switch-save; exact exception records compare every other field/array.
  Final result saving preserves tracks, performers and timelineRevision. Initial-to-final actor,
  area, position and facing exact; input disabled, no held keys/pending/owner/cleanup failure.

Evidence: C:/Users/xhz/AppData/Local/ChoreoHelper/stage-recovery-1789401063723.
Before copies, source hashes, red/green/build logs, actual API evidence and all browser rounds
remain there. Five changed web products individually backed up/frozen/synced to all three roots;
DLL separately idle-checked, backed up and installed. r3-install-manifest.json/final-hashes.json
bind final bytes. No private assets, generated catalog, original documents or old DLL backups
were overwritten. All owned acceptance Chrome processes exited; unrelated browsers untouched.

Preserved failures: first installer required cameraPreparation fields absent from actual wire,
so it stopped before any copy; next installer path-prefix mistake stopped before target writes.
Early browser command checks inspected ownership before async registration finished; replies
retain those failed assertions and subsequent genuine completions. Final browser4 uses awaited
completion and passes without that driver race. No failing game trial was retried.

Changed source: web/choreo-app.js (two existing lifecycle hooks), choreo-helper-app.html (entry
and module load), choreo-show-owned.js, choreo-stage-game-ui.js, new choreo-stage-recovery.js;
matching three-root product twins; three web test files; src/HttpServer.cs, ShowRunner.cs,
StageGamePanel.cs, OwnedShowApiPolicy.cs and X1CameraPathTests.cs; new resource whitelist entry
in scripts/make-release-staging.js. Process changes only register/resolve the owner interruption,
point continuity here and append this work record. No commit/push/publish or staging build.

Limit: mapping-based native stop is unit-verified in this increment; no new mapped live path
was started to exercise it. Both physical modes remain manually unverified. Lost unsaved
plugin reports cannot be resurrected; historical records never confer execution authority.


## Physical acceptance continuation (2026-09-14, skipped by owner)

Owner subsequently asked to skip physical acceptance after the repeated coordination
delays. No more physical trials or automatic retries are authorized by that readiness.
Final large-cue straight run completed4015ms without in-run physical input; actual countdown,
green Playing, motion and stopped pose were observed (`cue-final-visible-*.jpg`).
Report saved in `pmu1eddn91qvmws`; full browser exit/offline reopen completed. These are
automatic execution/UI/persistence observations, not manual interruption or cooperation.
Physical S release/resumption, physical-stop/restart and cooperative intervention remain
explicitly unverified. Do not ask the owner to repeat them unless they request resumption.
Final output off with no held keys, pending request, cleanup failure or exclusive owner.
Final audit220 projects/85 versions; all original84 versions, original project and private
library exact. Owned fixed-profile browser fully exited. Docs60/60 and pipeline check pass.

Evidence: `C:/Users/xhz/AppData/Local/ChoreoHelper/stage-physical-1789398481264`.
Owner became available and explicitly asked the agent to operate all buttons; owner only
provides real S input. Early preparation was invalidated when the owner returned to chat;
no bypass was used. Two later straight runs completed without in-run physical input.
Owner confirmed no S on the first and S only after completion on the second, because the
small countdown was not noticed. Neither is manual-takeover acceptance. Both reports are
appended in independent copy `pmu1do0yfpnjz5k`, fully closed/reopened offline. Audit218->219,
84 versions, previous projects and private library exact. Initial failed UI clicks, later
successful button interactions, command fallback and screenshots are retained. Source tree
had903 dirty entries at resumption; do not compare this with old999 as a cleanup operation.

INT-20260914-STAGE-COUNTDOWN-VISIBLE records the observed usability hotfix. Native panel
now shows large numeric countdown and green execution state using ShowRunner's existing
deadline; no HTTP wire change, second clock or automatic test input. Countdown red3085/1 ->
green3089/0, Release build0 warnings/errors. Changed ShowRunner.cs, StageGamePanel.cs,
Plugin.cs and data test program.cs; before copies and logs are in the evidence root.
Idle-checked, backed-up DLL installed:
`CBBD6DD5902D7149EBD52AD226432528E39A9BE3442BD1C5081113F3E6E19FC1`.
No web product changed in this continuation. Both actual manual modes remain pending;
The first visible-cue group was invalidated before start when a system network panel
appeared; owner denied moving/clicking, so tool coordinate behavior is unresolved and
subsequent operation uses existing native commands. Owner explicitly requested another
attempt. That preparation was cancelled on its third sample with real physical input
(ManualTakeover/AnyPhysicalHeld true, physical sequence1, focus sequence0, foreign0).
Owner confirmed pressing during preparation. This proves preparation cancellation only.
The panel now also labels preparation and not-started states in large yellow text; only
actual Playing is green. Final UI-only build0 warnings/errors, backed-up DLL installed:
`5E0C54E9199D58C8B4DED84460B2CDF9E51BD92F9BA9E756A9456FF0737874DF`.
Independent new copy `pmu1eddn91qvmws` is retained. Audit219->220 projects,85 current
versions (all84 older versions preserved; prior result saving added one). Actual mode
acceptance was subsequently skipped at owner request; do not automatically retry.

## Current continuation: manual modes and native panel (2026-09-14)

Owner scope: INT-20260914-STAGE-MANUAL-MODES. Direct sustained implementation and
backed-up per-file installation remain authorized. Owner subsequently said they cannot
provide physical input now and requested completion of the automatically verifiable part.
The full manual-input acceptance remains OPEN; do not label synthetic events human input.
No independent pipeline approval or whole-feature completion is claimed.

Evidence root: `C:/Users/xhz/AppData/Local/ChoreoHelper/stage-manual-1789396064266`.

Implemented: native `/choreo stage` panel (also normal plugin main/config entry), mode
selection, existing prepare/review/confirm/start commands as buttons, explicit global stop,
identity-bound queued panel commands, current actor/territory, mapping and Chinese state,
stop/result information. Commands remain compatible. ShowRunner still owns the only clock.
A mode change invalidates old mapping confirmation. Histories restore records, never permission.

Interrupt is the default. Physical input latches cancellation and cannot resume on release.
Cooperate only accepts registered movement keys disjoint from the automatic W/A/D controls;
the actual current binding supports S only. Same-key, unlisted input and mouse input stop;
active gamepad input is still rejected by the existing game safety adapter. The input monitor
retains real/injected separation. Cooperation becomes active only when the path actually
begins; physical input during countdown still latches cancellation.
On cooperative input the feedback session releases its automatic keys and keeps the original
clock. Neutral/stable >=250ms plus <=min(0.025m, original control deadband) error at the
original current target permits resumption through the existing settle/write gates. The
original tracking tolerance, waypoint witness, frame/identity/focus/height/distance/deadline
and foreign-injection checks remain. No catch-up, retiming, coordinate write or path rewrite.
A late input at the final write boundary rejects the pending press. Unsupported combinations
are explained; no fallback to opposite-key superposition. A separate cleanup gate prevents
ShowRunner automatic teardown retrying an already failed release; explicit stop owns retry.

Red/green: independent cooperative S incorrectly latched stop:3060/1 ->3082/0 after mode,
session, countdown and safety regressions. Automatic cleanup after in-tick release failure
then had a separate concrete3082/3 red ->3085/0 final. Release build0 warnings/0 errors.
Ten affected web suites pass, including stored mode/counters and legacy records. No assertion
was weakened. An additive ShowRunner JSON field first broke its frozen wire baseline;
it was removed in favor of an internal panel property. That failed log is preserved.

Actual game observations (no physical-input acceptance):
- Group1, Interrupt: actor269024904/territory816; prepare exactly once, then one reviewed
  0.18m/3s straight path, hold to4s, from(395.032,-689.075) to(395.178,-688.970),54.2deg.
  Root inspected actual movement/turn/stop screenshots. One identity-bound stop at about
  1.2s matched/safe; report remains Completed=false, travel0.075525631m, intervention0.
  Copy `pmu1coabziozh4a` saved the stopped report and fully exited/reopened offline.
- Group2, Cooperate: fresh preparation exactly once, then one new confirmed 0.18m/3s
  straight path, hold to4s, from(395.529,-688.681) to(395.674,-688.574),53.8deg.
  Root inspected movement, changed facing, stopped pose and completion frames. Completed=true,
  travel0.173618582m, endpoint error0.006381610m, completion observation4015ms.
  Intervention0/resumption0: this proves normal automatic execution in selected cooperative
  mode only. Copy `pmu1cwc4h15kk8s` saved and fully exited/reopened offline.
  The native panel stop button was also exercised after completion. No output remained.

Game group1 used DLLb880952b; group2 used85f5a2bb. The final cleanup-only guard was then
unit-tested, built, backed up and installed as
`7a7775643666bdf813724966910a51a9510f9ed1b0cf2881a8c3d12114bfd04e`.
No real failed-release injection or extra route was run after that last guard change.
Install manifests: dll-install*.json, web-install.json, final-hashes.json. One web product
file was separately backed up and hash-verified across all three dist roots. No assets copied.

Preservation audit:215 ->218 actual projects,84 historical versions, fixed original and
private library exact. All copies, including preliminary `pmu1cly5nncbkgb`, are retained.
Per-round prior-active switch-save may advance only derived timelineRevision once; exact
exception records retain all other document fields. Full native-ID/array content was compared.
The browser used only the fixed authorized profile; HTTP(S) blocked before every file
navigation, native allowlist enabled only for the existing required localhost routes.
Five owned Chrome processes exited with code0 across creation and offline restores.

Preserved driver failures: initial interruption impact value rejected before creation;
screenshot crop import unsupported (normal screenshots saved); first reused driver wrote
an old round4 browser-ready pointer, recovered from its original browser-4 copy manifest
and isolated before further work (driver-path-incident.json); an early reply-file read
preceded completion. No failed game group was retried, and no physical input was simulated.

Next concrete action: when owner can provide real input, freshly inspect actor/area/keys and
state each bounded group. Test S during actual movement separately in both modes, release,
stop and explicit new start; save separate real reports and offline restore. Start with a
short straight line; use a simple polyline only if it resolves an actual acceptance need.
Observe whether S gives a safe cooperative resumption or a bounded no-resume stop; never
relax tolerance or timing merely to make a human trial pass. Owner authorization persists,
but readiness and actual physical action cannot be fabricated. No automatic run is pending.


## Current bounded acceptance: native mapping flow (2026-09-14)

Active continuation `INT-20260914-STAGE-NATIVE-CONFIRM` adds native `show-review` /
`show-confirm` before `show-start`. Evidence root:
`C:/Users/xhz/AppData/Local/ChoreoHelper/stage-confirm-1789393598850`.
The actual missing-confirmation red was3047/1; current targeted data suite3060/0.
Native group1 completed one prepare and one new ShowRunner straight path after explicit
current-position confirmation, without returning to the old origin. Actual travel0.379960m,
endpoint error0.019984m, completion observation4016ms. Root observed game screenshots of
movement and turning. `native-confirmed.json` binds the old web identity to the new native
identity; `path-result-full.json` and `path-show-result.json` retain actual results.
Copy `pmu1b4gh0ngk7qx` saved the result and browser2 fully exited/reopened offline with
the record visible and no execution permission. Audit212→213 projects,84 prior versions
and original/resources preserved. Browser1's failed fetch (driver omitted POST preflight
and session routes), its copy and stop are retained. No native output occurred in that
failed browser round. Latest DLL/web installation manifests are in this evidence root.
Native group2 completed the new confirmed two-segment path (0.18m at1.5s, then0.18m at3s,
hold to4s). Root observed actual first-segment motion, a turn and second-segment motion.
Reported travel0.274325m and endpoint error0.068801m passed the unchanged0.12m tolerance;
this is not exact-speed or arbitrary-corner acceptance. `poly-result-full.json` and
`poly-show-result.json` retain the report. Copy `pmu1bbozdczclzo` saved and reopened offline.

Native group3 began one confirmed straight path and received one identity-bound stop after
the observed show time exceeded1200ms. The stop matched the new native load and returned safe.
Root observed the actor start, stop and remain in place. The report is deliberately
Completed=false at1281ms; it is not relabeled arrival success. Its0.122067m distance is
the report's last observed travel, not a measurement of all post-release settling.
Evidence: `mid-stop-observations.json`, `mid-stop-response.json`, `mid-result-full.json`.
Copy `pmu1bidzye9xu1f` saved the stopped result and reopened fully offline. Current result UI
also shows the historical mapping and report metrics; future saves retain ShowRunner's
separate stop reason. Final audit214→215 projects,84 original versions, original project,
prior project contents and private library exact. No project, failure copy or asset deleted.

User flow now: web review/register → game prepare → show-review → show-confirm → show-start
once → stop/result save → full browser exit/offline restore. No return to the old origin,
silent coordinate translation, project mutation, new player or replacement clock.
Old load callbacks/start/stop cannot affect the newly confirmed identity. Position/actor/
territory changes latch invalidation; duplicate confirmation/start and cleanup-failure
ownership are covered by the actual3060/0 data suite. Ten affected web suites pass;
the final UI suite additionally checks mapped result identity and separate stop reasons.
Release build0 warnings/0 errors; preserve the first capability-overload compile failure.
DLL81251409D9769D1AE81B2A8A0C98D4E4C310034E2F475A5ADB885D8A1B9212ED is backed up and
installed; changed web UI is individually backed up/hash-verified across all three roots.
`final-native.json` confirms no held keys, owner or cleanup failure. No native output remains.

Scope remains single-performer, single bounded path. Independent stationary facing,
arbitrary timing/speed/turns, whole-show skill/motion mixtures and physical-key takeover
of this new chain were not newly live-verified. Existing takeover/focus/write guards remain.
No skill logic was changed, no independent pipeline approval or broad product completion claimed.
Implementation targets: StagePathMappingReview, ShowRunner, Plugin, X1InputPreparation,
HttpServer capability, stage-game UI and their targeted data/web tests. No pipeline role
handoff was forced in the middle of the owner-authorized sustained task.

## Prior integration checkpoint (superseded by current acceptance above)

Latest owner scope is registered as `INT-20260914-STAGE-GAME-FLOW`. Continue the whole
user flow; do not reimplement the accepted web editor or treat this increment as closure.
Subsequent necessary bounded trials remain authorized, but the owner's no-retry-after-failure
rule still applies. No independent pipeline approval is claimed.

Implemented: `choreo-stage-game-plan.js` converts the existing authored nodes to a reviewed
single-performer mapping without mutating source, event IDs, coordinates or times.
`choreo-stage-game-ui.js` provides dancer selection, current actor/mapping review, explicit
path-only scope, owned load/arm/start, global immediate stop and matching-result storage in
project extensions. This is explicitly a path-only trial; skills, ordinary motions and authored
independent facing are not included. Whole-show mixed execution is still blocked elsewhere.

Native wiring: the explicit `stage-path-review-v1` compiler contract accepts only one movement
event at time zero. `StagePathShowDispatcher` uses ShowRunner's original monotonic start and
the existing X1CameraFeedbackSession, key writer, output lease and input guards. It does not
invoke the separate `path` command or create another player. The existing trial defaults are
unchanged; an optional explicit path origin permits at most one frame of dispatch lateness.
The native `x1 show-start` command waits for neutral input once and uses the same owned
registration and scheduled start. It does not move the mapping or return to the start point.

Evidence root: `C:/Users/xhz/AppData/Local/ChoreoHelper/stage-game-flow-1789391718265`.
The concrete 50ms-late callback regression was 3041 pass / 1 fail. Current data layer is
3047 pass / 0 fail including fixed origin, deadline, duplicate event and stop checks.
Release build has zero warnings/errors. Ten affected web suites pass; see final-web-tests.json.
Preserve clock-green.log's compile error, the driver startup errors and both browser 403s.

Real file-mode browser operations used fresh fixed-source copies, the sole fixed profile,
blocked HTTP(S) before navigation, real path editing/entry clicks, and complete Chrome exit
and offline reopening. Browser3 visibly displayed the actual current character and mapped
0.360m/3s path with a hold through4s. Its copy is recorded in browser-3/copy.json. Latest
audit is210 before /211 after,84 previous versions exact, original and all prior project
contents/resources exact. Prior rounds208→209 and209→210 are retained. Counts are observations.

Native group1 performed exactly one preparation. Root inspected the returned game screenshots
showing actual forward/left/right movement and turns; raw observations are prepare-visible-status.json
and prepare-result.json. The resulting actor269024904/territory816 was at
(392.85498046875,-690.6043701171875). Web read then failed403 before any path load/start.
Per the stated failure rule the group was stopped, not repeated. group1-stop.json and
group1-stopped.json confirm disabled input, no held keys, no output owner and no cleanup failure.
There was no native straight-path execution, polyline execution or mixed execution this turn.

403 investigation found two causes: offline startup had not completed probeCaps, and the fixed
profile had no saved pairing code. The entry now calls the existing capability probe, with
late-project and unavailable-capability regression coverage. The fixed browser profile was paired
using the already-existing local pairing code (never written to evidence); browser3 then passed
the real read-only review. This does not relabel either403 or the stopped group as passed.

Four web product files are backed up and hash-identical across source and all three dist roots;
see web-install.json, web-install2.json and final-hashes.json. The backed-up per-file DLL install
is032b6f4ca1869db39d8c1f80c9ce097cb71115c840e15762dfb866f0905f5ba1; capability reload was observed.
No private asset, original project, history, commit, remote or release was changed.

Unfinished acceptance and actual workflow gap: the new ShowRunner path chain has not executed
visibly in game. Native straight line, simple polyline, stop-during-path, and actual result-save/
offline-result-restore remain unverified. The browser currently requires staying in game foreground
for prepared input; switching to the browser invalidates preparation, and preparation itself moves
the actor. The native-start instructions still require manually returning to the reviewed origin.
An ergonomic current-position mapping confirmation while remaining in game is not implemented.
Do not claim a completed everyday web-to-game workflow or solve this by disabling focus safety,
automatically translating the path or making the actor chase its start. No further native output
was issued after group1 stopped. Authorization is not missing; preserve the no-automatic-rerun rule.

Owner request (2026-09-14): complete the daily stage-authoring flow in one sustained task.
Direct bounded development and backed-up per-file three-root installation remain authorized.
Registered as `INT-20260914-STAGE-DAILY-LOOP`; no independent pipeline approval is claimed.

## Implemented and verified

Reuse the existing performer `start`, stage coordinate transform, canonical movement/facing
tracks, `_doc.extraTracks`, document serializer, project repository, history, music controller,
animation engine and Three.js rigs. No new player or clock. New small modules are
`web/choreo-stage-motion.js` and `web/choreo-stage-motion-ui.js`.

Each dancer has a timeline entry for arrival-time / X / Z / yaw nodes. Lines connect the
nodes from the editable start at time zero. Equal positions allow an in-place turn; angles
interpolate as explicitly authored, including full turns. Apply is transactional, cancellable,
undoable and redoable. Invalid/non-increasing times, nonfinite coordinates, locked/corrupt
owned tracks and overlapping foreign channels reject without rewriting original events.
Unknown foreign tracks are preserved. Existing explicit X1 movement and fixed/transition
facing inputs can be sampled without enabling native output.

The existing absolute `store.currentTime` drives both stage placement and bone sampling.
Stage paths hold their endpoints and support reverse seeking. When stage movement is active,
only the skeleton root's horizontal translation is held at its reference; child-bone movement
and vertical motion remain animated. The new explicit `全路径` camera action reuses the existing
fit routine and does not take over the user's camera during playback.

The editor shows a 2D draft using the same coordinate transform and playhead. Per-segment
required speed/turn rate and the existing native trial's 4-second / 1.5-metre limits are
visible. Daily game playback rejects a selected dancer's stage tracks instead of silently
dropping them. Start and path editors also respect the existing audio controller's playing
state (which is distinct from legacy `store.isPlaying`) and reject stale project targets.

## Evidence

Private evidence root: `C:/Users/xhz/AppData/Local/ChoreoHelper/stage-flow-1789388266775`.

Real red: `red-browser-2` used the old installed file page and a fresh fixed-source copy.
A canonical 0-to-4-metre path remained visibly at X=0 after seeking to 4 seconds. The earlier
red harness failed on an absent optional `_doc` carrier; its copy and evidence remain.

`browser-8` passed the full current file-mode workflow: two dancers' start/path/yaw,
arrival-time modification, undo/redo, no-op and invalid-time guards, exact bound Action16140
at 0.5 seconds, visible skeletal action plus stage movement, original-song playback/pause,
editing blocked during audio playback, seek in both directions, endpoint hold, project
switching, and complete Chrome exit followed by offline reopening. Root inspected actual
rendered images, including `first-line.png`, `music-live-1.png`, `music-live-2.png` and prior
two-dancer reopening images. The accepted copy is `pmu18dgkg4otqo4`.

Latest browser audit: 206 before / 208 after, all 84 prior historical versions exact, original
`pmtzdam4b7ruhs3` exact, existing library profiles/clips exact. The previously active failure
copy may increment only derived `timelineRevision` once during switch-save; that exact
exception is recorded separately, with all other fields compared. No original project was
activated by the acceptance. All failures and copies are retained.

Earlier browser failures: stale test button label; testing audio playback through the legacy
boolean instead of actual audio state; a previous-active derived-revision audit mismatch;
one Chrome debugging-port startup failure; unstable button targeting while a draft status
changed layout. The editor now keeps its footer stable. First camera inspection exposed
out-of-frame movement and led to the explicit full-path framing action. These failures are
not erased by the later pass. A skill at exactly the ordinary action's trigger correctly
showed a conflict; the final test uses an explicitly later trigger and asserts the actual
bound clip name, not only a label or a log.

Pure/affected suites passed: stage-motion, engine, edit, check, projects, document, docwire,
showcompiler, library, shell, ability-plan and skill-game. Latest stage suite additionally
covers canonical round-trip, foreign-channel rejection, corrupt input, native input sampling,
root separation and speed metrics. Pipeline `check` passes with the historical prerequisite
inversion warning. Broad generic browser scripts were not run because the owner requires
the one fixed private profile and fixed-source copies. No new independent reviewer or
formal X1 approval is asserted.

Six changed product files were frozen, separately backed up and individually synchronized
to all three dist roots, with live idle/output-ownership checks and SHA256 verification.
Manifests are `web-sync*.json`; no DLL, private asset or generated snapshot was changed.
Original files use LF; inserted CRLF lines were corrected back to LF. The pre-existing
trailing space on the handwritten-dialogue header is preserved.

## Native boundary and next action

Current source already has `X1CameraPathPlan` and the `prepare` / `path` guarded input chain.
It retains the registered event's original timestamps, stops at 4 seconds, bounds planned
and actual path distance to 1.5 metres, and retains manual takeover and immediate stop.
Fresh camera-response preparation itself issues three bounded 150ms key probes and may
move up to 3 metres in 10 seconds; it is not read-only and needs this group's authorization.
Independent stationary facing and full-show mixed execution are not newly accepted.

The review draft is `真实移动待审阅草案.md` / `native-review-plan.json` under the private
evidence root: one preparation followed by one 0.36-metre straight segment over 3 seconds,
holding through 4 seconds, with explicit tolerance, identity and stop rules. It is not an
executable authorization. After the login wait, current actor is269024904 in territory816, readable/safe with input disabled and no output owner. The visible actor is immediately beside a stone slope; owner was asked to park manually on flat unobstructed ground before freezing this group. See native-status-after-login-wait.json and game-after-login.jpg. Re-read position and facing after the owner reports ready, then ask for fresh movement authorization.
This was the pre-authorization checkpoint; superseded by the authorized native group result below. No skill or full-show start was sent.

The web flow can be used now; the whole task remains open for current native binding,
fresh authorized movement, visible native result and resulting integration decisions.


### Authorized native group 1 result

Owner explicitly authorized native-review-ready.json. One prepare was executed with visible
forward/left/right movement and turning. All three response reports completed; cumulative
reported distances were0.504840+0.534465+0.524482=1.563787m. Current actor269024904/territory816
stopped at(391.328003,-691.912170), yaw-36.257844deg. Evidence: prepare-visible-0..7.jpg,
prepare-status-frames.json. This verifies preparation responses only, not independent facing.

The planned path passed /shows/validate, but the agent hand-written /shows/load envelope
was rejected400 before adoption: missing envelope protocolVersion and non-GUID clientLoadId.
No path command was sent. Per the no-retry contract, /choreo x1 off was issued;
native-stopped-confirmed.json verifies disabled input, no held keys, no owner and no cleanup
failure. This is a test-driver defect, not evidence that game cannot follow the path.

The corrected driver now reuses existing ChoreoShowOwned.load; intercepted dry run makes
zero POST calls, verifies canonical GUID/version1/onlyIfIdle and current capability reads.
Existing node web/test-show-owned.js passes16 checks. Native group1 authorization is spent.
A second explicit bounded group is prepared in native-review-second-group.json and awaits
fresh owner authorization; do not automatically run it.


### Native group2 and deadline repair

Fresh owner authorization allowed one prepare and one path. Existing ChoreoShowOwned.load
registered one event successfully. The visible character moved and turned along the path;
original report remains FAILED at4031ms because CheckCurrent rejected >4000 before the
completion branch. Last frames3953/3984/4031ms were stationary at5.24mm endpoint error.
Observed path distance derived from raw frames0.364220m, maximum tracking error0.054935m.
See path2-visible-0..11.jpg, path2-result-full.json and native-path2-summary.json.
Owned stop confirmed matchedCurrent/safe; x1 off confirmed no input/held keys/owner.
Group2 authorization is spent, and its failed report is not relabeled passed.

Source repair: X1CameraFeedbackPolicy.CanObserveSettledDeadline admits only read-only
completion observations within the existing100ms frame bound, when the original final
segment is a hold, no control is desired, stable/settled before the original deadline,
and current horizontal/vertical shift <=2mm. The beforePress event deadline remains
unchanged; ordinary target timeout and all existing identity/input/safety checks remain.
No event time, coordinate, tolerance or max distance was changed.

New X1CameraPathTests deadline regression red:3029/1; green with late/shift/manual/fresh
rejections:3041/0. Initial net8 host failure and an unsuitable moving-fixture red are retained.
Use DOTNET_ROLL_FORWARD=Major per runbook. Release build0 warnings/0 errors. Backed-up
single-DLL installation SHA256 e799452a9d7c96f5c3a8d307a910cfb6d3cc6dde2404af63367d11ed8b5dfa3b confirmed autoreload and input off;
see deadline-dll-install.json and deadline-after-reload.json. Third group is concretely
reviewed in native-review-third-group.json and awaits new owner authorization.


### Current native checkpoint: group3 passed

Owner authorized group3 and subsequent necessary bounded acceptance in this task
("授权 后续全部授权"). Concrete plans and stop conditions still apply; this is not permission
for loops, unsafe bypass, direct coordinate writes, auto-nav or unrelated gameplay.

After one fresh preparation, exact reviewed stage origin was(392.2769775390625,
-691.1014404296875), fixed stage yaw48.88845868257861deg. The one .36m/3s path held
through4s and completed. Visible path3 screenshots show actual movement and turning.
Reported duration4000ms, actual path0.397157739m, endpoint error0.037354677m, maximum
tracking error0.059216650m, last held-control sample2719ms. Final position
(392.57354736328125,-690.8372802734375), yaw0.8431821465492249rad. This native run hit
exactly4000ms; the after-deadline branch itself is covered by the4031ms red/green tests,
not falsely claimed as exercised by this passed native run.

Evidence: native-frozen-package3.json, native-loaded3.json, prepare3-status-frames.json,
path3-visible-0..10.jpg, path3-result-full.json, native-path3-summary.json. Owned stop
matched this load and reported safe; native-final-disabled3.json confirms disabled input,
no held keys, no owner, no cleanup failure. No loop, retry of a failed group, skill,
gearset, coordinate write, automatic navigation or full-show start was issued.

Web scope is complete. Game evidence is limited to this registered short straight path
and its bounded preparation, stop and fresh endpoint confirmation. Independent stationary
facing, arbitrary speed/timing, turns at polyline corners and full mixed show execution
remain unaccepted. The daily UI continues to explain and guard that boundary. Full native
closure requires that separate execution integration and its visible acceptance; it is
not blocked by missing movement authorization. No additional game action is currently running.
