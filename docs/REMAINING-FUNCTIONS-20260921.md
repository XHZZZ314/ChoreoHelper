# Remaining product work — current-source review, 2026-09-21

> 属主摘要：第一优先推荐「同一个动作包自动适配各角色档案，支持一次导入全部档案」。已有编舞、音乐、技能动画、走位和项目管理不重做。游戏准备与结果流程排其后；真实游戏效果、真实素材观感和独立验收另列，不能用自测代替。本轮仅核对与形成合同，未实施、未安装、未操作游戏。

## Scope and baseline

- Checkout: `D:/choreohelper`, master `e795d84efb1843b76d8e29b7226c70bf25554739` plus existing tracked and untracked owner changes. HEAD alone is not the delivery.
- Method: required instructions, SPEC, current progress/continuity, relevant contracts/deliveries, source call chains and focused tests. This is a feature-level audit, not exhaustive defect discovery or independent acceptance.
- Evidence: `.agent/evidence/TASK-20260921-REMAINING-AUDIT/`. Product manifest covers 547 existing tracked/untracked files under web/src/scripts/tools, excluding ignored assets. It is not a complete private-data inventory.
- Older README/PROGRESS/SPEC unchecked rows are not reliable implementation inventories. Neither old checkbox counts nor test totals are product completion percentages.

## Remaining-function inventory

| Order / item | Current implementation evidence | Remaining obligation and completion boundary |
|---|---|---|
| **1. Universal animation pack** — missing implementation | `scripts/make-anim-pack.js:574` emits formatVersion 1; `web/choreo-xat-convert-ui.js:456` rejects versions other than 1; current import calls `putClip(name,clip)` without a target profile | v2 base-skeleton package; per-profile conversion; explicit multi-profile import; backward compatibility, preflight, cancellation and cross-profile isolation. Continue approved option A from TASK-20260918-ANIM-PACK-UNIVERSAL; r2 contract linked below. |
| 2. Game preparation and results UX (P5) — partial | `choreo-show-entry.js` performs read-only checks then closes and opens `ChoreoStageGameUI`; that dialog retains separate review/register/result actions and native confirmation instructions | A coherent preparation/results presentation that reuses current guards. P5 remains paused; no implementation authorization from this review. This does not expand execution support. |
| 3. Complete mixed-track game performance — partial, larger follow-up | `choreo-stage-show.js` requires one original path, limits supported motion to once/inPlace and skills to true Action/self target, excludes facing overlapping movement; max 300 s / 128 compiled events | Explicitly scoped path-free performances, broader skill targets, loop/posture semantics and other mixed tracks need separate contracts. Daily game playback already provides a distinct route; no false claim that all path-free playback is absent. |
| 4. Live movement/facing/locomotion closure — implemented, acceptance gap | `X1LocomotionSwitcher.cs`, `X1LocomotionFrameworkAdapter.cs`, StageShowContract and PATH-LOCOMOTION contract implement node walk/run handling | Fresh authorized in-game observation of node transitions, restoration on stop, polyline/facing and long-show effects. Native submission or mock success cannot close this. Web locomotion appearance intentionally does not distinguish walk/run. |
| 5. Action/skill resource coverage — partial content | `choreo-skill-motion.js` plus `preview3d.js:2242` provide actual skill-motion wiring; SKILL-ANIM-CHANNEL records bounded acceptance | Missing source resources, seven weapon-draw posture items recorded for later, and wider real-character coverage remain. The text-only fallback in ability-plan is not proof that all skill animations are missing. No new effects renderer requested. |
| 6. First-use and daily editing acceptance — implemented changes, pending checks | first-action-entry RESULTS, first-macro-fix-r4 REPORT and web-flow-closeout OWNER-REPORT record later deliveries beyond the stale PROGRESS row | Independent acceptance of the latest exact bytes and actual owner/new-user understanding. Do not reimplement those flows or reopen P4-C E1/E2. Prior C: independent reports are referenced by deliveries but not independently re-audited here. |
| 7. Music/rehearsal acceptance — substantial implementation | music-ui consumes tempo/meter maps, snapping, waveform and count-in; music/timing modules and rehearsal flow exist | Real local-song listening/synchronization and relevant unresolved acceptance evidence. SPEC unchecked music row is not a blank implementation task. |
| 8. Multi-character local assets — substantial implementation | library supports profile namespaces, skeleton hash, CHLB/share packages and explicit `putClip(...,pid,guard)`; bundled 18 skeletons verified below | Actual model/two-profile acceptance and universal import (item 1). No new account or storage system. |
| 9. Two-person collaboration — bounded implementation | ensemble session/transport/audio/UI modules exist | Real two-machine readiness, clock/audio coordination and interruption acceptance; not accepted general multiplayer game execution. Separate from this contract. |
| 10. Public distribution/install — local tooling, not public completion | release staging tooling and existing SPEC release gates | Current-tree packaging/privacy/dependency checks, clean install/upgrade and data recovery, then separately authorized Pages/Releases/plugin-repo publication. PWA is a later real-origin concern. |

Already present: multi-project storage/history, native document/compiler foundation, timeline editing, macro explicit Apply, local rehearsal, stage paths, skill authoring, stop coordination and resource tools. Their existence does not imply every live acceptance gate is closed.

## Why item 1 wins

It removes an upstream resource-preparation obstacle before either choreography or rehearsal, serves every supported character profile, and follows an already selected owner direction. The existing retargeting math, 18-skeleton reference pack and profile-specific storage make the scope bounded. P5 is valuable but paused and downstream; broad game execution carries native-control dependencies; more timeline foundations would duplicate delivered capabilities. This is a qualitative prioritization, not measured user-time savings or a completion estimate.

## Fresh verification

Node `D:/nodejs/node.exe` v24.20.0, cwd `D:/choreohelper`, 2026-09-21 +08:00:

| Command suffix | Actual result |
|---|---|
| `scripts/test-anim-pack.js` | 9 passed, 0 failed |
| `scripts/test-dancer-autoadapt.js` | 29 checks passed through B3; B4 aborted: missing `.agent/evidence/TASK-20260917-SKELETON-HASH-STABILITY/capture-0.json`. **Incomplete, not passed**. Harness nevertheless exited 0: catch sets exitCode=1 but final process.exit recomputes from assertion count. |
| `web/test-show-entry.js`, `web/test-stage-game-ui.js`, `web/test-stage-readiness.js` | Each exited 0 |
| `web/test-stop.js` | 20 passed, 0 failed; synthetic gameWrites=0 |
| `web/test-first-macro-journey.js` | 39 passed, 0 failed |
| `web/test-web-flow-drafts.js` | 10 passed |
| `web/test-stage-show.js` | Failed at line 12: actual additionally contains path-movement-event-s1 |
| `web/test-stage-segments.js` | Failed at line 24: r.path undefined. Source build() returns G.review directly as r; G.review returns eventId at its top level. |

Read-only VM inspection of the shipped skeleton pack: 18 tribes; c0101 has 106 bones; every tribe's named bones are contained in c0101; target counts 101 or 106. This verifies mapping availability, not animation quality.

The autoadapt harness used its isolated browser/mock workflow; no actual owner assets or live game were validated. Fresh checks above are limited module/integration baselines. No full-pack conversion, listening, deployment, real-game operation or broad acceptance was performed. The two stage tests stay outside the selected implementation scope.

## Contract and routing

Selected contract: `.agent/tasks/TASK-20260918-ANIM-PACK-UNIVERSAL-r2.md`. Original r1 remains unchanged. r2 resolves target binding, partial completion, version compatibility and test false-green behavior. Current user request authorizes this audit and contract only; no implementation dispatched. Recommended implementer: GLM-5.3, followed by a fresh independent technical acceptance session; data-integrity failures must be escalated rather than waived.
