<!-- 设计文档：M1.5 双模（网页模式/游戏模式）现状核对与产品规划（仅规划，不改产品行为） -->
# M1.5 dual-mode audit and product plan (planning only)

> Ticket: `TASK-20260905-DUAL-MODE-AUDIT` (run `RUN-20260905-DUAL-MODE-AUDIT`). English
> AI-facing planning document per the repository language policy; owner summary lines live in the
> ticket and closing handoff. Scope: planning and audit only — no product file, product test,
> SPEC checkbox, roadmap row or workplan gate changes in this package.
>
> Inputs: `SPEC.md` sections 1–2 (REQ-SPEC-019..029), the 2026-09-05 pipeline-review synthesis
> (`.agent/evidence/INT-20260905-PIPELINE-PERFORMANCE-REVIEW/REVIEW-SYNTHESIS-ZH.md` §§8–9, 14–15),
> current source, the requirement registry in `.agent/PROCESS-STATE.json`, and the cited handoffs.
> Classification policy (per synthesis §14 retained conclusions): a registry-closed requirement
> with handoff/test backing is `implemented-verified`; implemented behavior whose owner/real-game
> acceptance is still owed is `implemented-pending-acceptance` pointing at its named tail; a
> definite missing piece against the requirement text is `confirmed-gap`. Classification never
> replaces real product acceptance — SPEC checkbox flips belong to the named packages and the owner.

## 1. Current-state table (REQ-SPEC-019 .. REQ-SPEC-029)

Registry state (`.agent/PROCESS-STATE.json` requirements): open 019–023, 025–028; closed 024, 029.

| REQ | Category | Evidence (repository citations) | Blocking target / next action |
|---|---|---|---|
| REQ-SPEC-019 toolbar target switch | implemented-pending-acceptance | `web/choreo-app.js:1408` `switchPreviewTarget` wired to the toolbar button at `web/choreo-app.js:1601-1604`; `HANDOFF-20260828-stage1-modesplit-clipux.md` §2 (mode-check 18/18 incl. mode button); regression still routed via `scripts/offline-verify.js` `mode-check` scenario | Owner acceptance of SPEC §1 (owed real-machine pass, handoff §3). Next: fold into the game-mode acceptance session named under §4 GAMECLOCK-LIVE/EXEC-LIVE. |
| REQ-SPEC-020 new page opens web-3D | implemented-pending-acceptance | `web/choreo-app.js:20` — `previewTarget` defaults to `web` (fresh profiles open web-3D; the user's last choice persists by design via `choreo_previewTarget`, written at `web/choreo-app.js:1411`); 3D panel auto-open per handoff §2 preview3d changes; mode-check 18/18 ("3D panel auto-opens") | Same SPEC §1 owner acceptance. The last-choice persistence is deliberate; confirm during that pass. |
| REQ-SPEC-021 web-mode ops never touch the game | implemented-pending-acceptance | `sendSeek`/`/playback/stop` call sites gated by `previewTarget` (handoff §2); mode-check 18/18 asserted "web play·pause·stop·drag issues zero requests to 48794" (PerformanceResourceTiming count unchanged) | Same SPEC §1 owner acceptance. |
| REQ-SPEC-022 game-mode ops drive the game; offline only notifies | implemented-pending-acceptance | `web/choreo-app.js:1414-1424` — web→game probes, offline toast "游戏未连接：编辑不受影响…", timeline snapshot push (`pushGameTimeline(true)`); `web/choreo-app.js:1256-1294` `gameStartPlay`; handoff §2 verification record includes a real-machine seek while online | Owed "one full game-mode real playback" (handoff §3 item 2) plus the EXEC-LIVE real-use list. Next: same game-mode acceptance session. |
| REQ-SPEC-023 one playhead, one timeline, never two copies | implemented-pending-acceptance | `web/choreo-app.js:1406-1407` — both modes share one timeline and one playhead; single `store` source of truth (handoff §2 store fields); SPEC non-goal "Never duplicate the timeline or project format for dual-mode" (`SPEC.md:110`); mode-check regression covers the shared-playhead behavior | Same SPEC §1 owner acceptance (architectural invariant already regression-covered). |
| REQ-SPEC-024 game preview drives exactly one selected dancer | implemented-verified | Registry closed 2026-08-31; `SPEC.md:61` checked with owner acceptance; `HANDOFF-20260831-actor-preview-dancer.md` (web sends only the preview dancer + global lyrics; plugin rejects mixed-actor payloads with 400 via PreviewActorPolicy) | — |
| REQ-SPEC-025 web playback self-contained (start/pause/resume/stop with the game closed) | implemented-pending-acceptance | `web/choreo-app.js:1235-1253` — `pausePlay`/`startPlay` web mode sends zero requests; offline web playback asserted by `scripts/offline-verify.js:194` and `scripts/library-verify.js:559` ("网页播放立即起播" → `web/true`); the game-closed clause additionally carries the closed REQ-SPEC-029 stage-2 owner evidence (`SPEC.md:72`) | Owner acceptance of SPEC §2 (same session; automated evidence already green). |
| REQ-SPEC-026 game playback with web playhead in sync | implemented-pending-acceptance | `web/choreo-app.js:1256-1286` — `gameStartPlay` sends the preview-dancer payload, checks the response body before entering playing state, then `startFollow()`; GAMECLOCK follow starts with playback and stops on pause/stop/mode switch (`web/choreo-app.js:1285`, `:1238`, `:1412`); `HANDOFF-20260901-gameclock-preview-verify.md` leaves AC-10 real-game clock-follow acceptance open | GAMECLOCK-LIVE tail (AC-10 clock-follow) + EXEC-LIVE. Next: in-game clock-follow run per that handoff. |
| REQ-SPEC-027 play button text/state shows web vs in-game playback | confirmed-gap | `web/choreo-app.js:1606` — the play button's visible label is only ⏸/▶; the playback target appears in its tooltip ("当前：网页播放/游戏内播放"), on the mode toggle (`web/choreo-app.js:1601`) and in the bottom status bar/toasts — the button's own text/state never carries the mode | First follow-up package (draft `TASK-20260905-DUAL-MODE-CLOSEOUT`, §8): owner judges whether the current indication set satisfies the intent or the play-button label must carry it; narrow web-product UI change either way. |
| REQ-SPEC-028 web playback never fails from "plugin not running"; game failure gives a clear hint | implemented-pending-acceptance | Web mode issues zero requests so plugin state cannot fail it (`web/choreo-app.js:1243-1253`; mode-check zero-request assertion); game failure paths give Chinese reasons and pairing guidance (`web/choreo-app.js:1275-1294`), exercised by `scripts/fix1-web-verify.js:84` (gameStartPlay toast harness) | Same SPEC §2 owner acceptance. |
| REQ-SPEC-029 web app opens without plugin static hosting | implemented-verified | Registry closed 2026-08-28; `SPEC.md:72` (stage 2: desktop shortcut opens via `file://`; headless 11/11 — editor/draft/snapshot catalog/stand-in 3D/web playback OK); `HANDOFF-20260828-dual-preview-offline-workflow.md` | — |

Coverage: 11/11 dual-mode requirements classified, none left unclassified. Summary: 2
implemented-verified (024, 029), 8 implemented-pending-acceptance (019–023, 025, 026, 028), 1
confirmed-gap (027). The eight pending rows all trace to one owed owner acceptance event (the
Stage-1 real-machine pass plus GAMECLOCK AC-10), not to missing implementation.

## 2. Product scenario table (synthesis §9, hand-made)

Verdict legend: pass = demonstrable today with current evidence; fail = demonstrably broken
today; blocked-by = not yet demonstrable, blocked by the named requirement id, owner tail or
milestone.

| Scenario | Verdict | Blocked-by / evidence |
|---|---|---|
| M1.5 dual-mode audit exit | pass | This document: every REQ-SPEC-019..029 row classified with evidence, blockers and next actions; real-machine items declared non-blocking for M2 (§3); structural check in the ticket testPlan exits 0. |
| M2 eight-dancer formations, start/facing editing, save/reopen | blocked-by | REQ-SPEC-012 (stage & movement, open) + M2 design prerequisites: coordinate/time conventions (synthesis §15.4; M1 view convention provisional in `.agent/CONTINUITY.md`); E1 foundation closed (REQ-WP-E1). |
| M3 timed paths between formations, arrival/facing editing, full undo | blocked-by | M2 (same-source stage model) + REQ-SPEC-012 path/speed/arrival semantics; game-side movement execution additionally waits for X1 executors (`src/ShowValidator.cs:31-36`). |
| M4 2D/3D position and facing consistency under random drag, no double displacement | blocked-by | M3 + unified sampling/one-playhead seam (REQ-SPEC-023) + root-motion separation; character-assets identity merge (`web/preview3d.js:1199-1201` skeletonHash keying) informs the same-skeleton reproduce-first input (P4 scope, §3 priority). |
| music local import, key-pose beat alignment, reopen persistence | blocked-by | REQ-SPEC-009 (open); insertion point in the mainline is a Planner scheduling recommendation, not an approved hard dependency (synthesis §8). |
| skill semantics readable (job, level, unlock, target, cooldown, cast, restrictions) | blocked-by | REQ-SPEC-011 (open); CN-data basis with explicit uncertainty marking (synthesis §9). |
| M6/X1 single-role combined execution (actions, supported skills, paths, facing) | blocked-by | REQ-WP-X1 (open) + REQ-SPEC-017 (game execution row, open): motion/cue/lyrics execute today; ability/movement/facing packages are rejected before start until their executors and guard inputs exist (`src/ShowValidator.cs:31-36`). |
| after-X1 multi-player coordination (local prep, unified countdown, deviation diagnostics) | blocked-by | X1 + security gate (§3: multi-player game execution explicitly waits on X1); coordination contract `docs/DESIGN-ensemble-sync.md`. |
| web offline (overall acceptance scenario) | blocked-by | 30 s / 8 dancers / two formation changes / music and facing / save-reopen consistency: eight-dancer authoring works (E1, `HANDOFF-20260901-six-track-roundtrip.md`), but music waits on REQ-SPEC-009 and formation changes on REQ-SPEC-012/M2. |
| game single (overall acceptance scenario) | blocked-by | explicit start, 60 s action+skill+movement+facing, takeover, emergency stop, failure localization, drift measurement: motion executes for the single local performer (EXEC-CORE); skills/movement/facing wait on REQ-WP-X1, real-game behaviors on the EXEC-LIVE/GAMECLOCK-LIVE tails. |

Both overall scenarios are future acceptance targets, not current passes (synthesis §9).

## 3. Real dependencies (synthesis §8 classes)

Four separately labeled groups. Every entry names the object it blocks (capability, milestone,
deploy, live acceptance or release) and carries an explicit blocks-M2 statement. M2 here means
the M2 editing milestone (stage/start/facing/formation editing), not the whole roadmap.

### Technical dependency

| Dependency | Blocks | blocks-M2 |
|---|---|---|
| Coordinate/time conventions (axes, units, facing positive direction, angle wrap, time rounding, segment boundaries) must be fixed in M2 design before path editing | M2/M3 editing capability and their protocol packages (synthesis §7 row 1, §15.4) | yes — M2 design prerequisite, not M1.5 work |
| Unified sampling and one playhead (REQ-SPEC-023 seam) | M4 consistency acceptance (2D/3D same-source sampling) | no — M2 editing proceeds; blocks M4 |
| Compiler generic-field projection: `web/choreo-show-compiler.js:59-74` `eventOf` emits only the generic protocol fields; `src/ShowProtocol.cs:41-51` `ShowEvent` mirrors them; movement path/speed, facing and ability target fields therefore never enter the show package ("save succeeds, execution rejects") | M2/M3 acceptance: edit-side immediate marking of fields the package cannot carry (acceptance gate of the owning M2/M3 packages, §7) | yes — as an acceptance gate on M2/M3 packages, not as implementation here |

### Security gate

| Gate | Blocks | blocks-M2 |
|---|---|---|
| Multi-player game execution explicitly waits on X1 (synthesis §8; `docs/WORKPLAN-20260829.md:22` X1 ordering) | after-X1 coordination milestones, any multi-performer game execution or deploy claiming it | no — gates after-X1 work, not M2 editing |
| New/changed game-control or protocol surfaces require method, CORS/origin and pairing review (`AGENTS.md` change rules; local-authorization contract `docs/DESIGN-local-authorization.md`) | M2/M3 protocol packages touching endpoints or package shape; release (§14-blocked) | yes — as a review gate on those packages' surfaces, not new work in M1.5 |

### Priority (scheduling class, no auto-reordering)

| Item | Blocks | blocks-M2 |
|---|---|---|
| Music insertion point in the mainline is a Planner scheduling recommendation, not an approved hard dependency (synthesis §8) | music milestone scheduling only | no |
| Character-assets P4–P6 stay deferred with prerequisites unchanged (P4's only accepted prerequisite is P3 closure; the two identity-reproduction cases and a batched live session inform its scope) | character-assets line only (`TASK-20260903-CHARACTER-ASSETS-P4-NAMESPACE.json`) | no |

### Real-machine waiting

| Waiting item | Blocks | blocks-M2 |
|---|---|---|
| GAMECLOCK AC-10 clock-follow + one fresh-clip audit (GAMECLOCK-LIVE) | REQ-SPEC-026 acceptance (live) | no |
| Owed Stage-1 real-machine pass: offline launch after the game fully quits (already backed by closed REQ-SPEC-029 stage-2 evidence) and one full game-mode playback including the game-mode stop/unfreeze behavior | SPEC §1/§2 acceptance of REQ-SPEC-019–023, 025, 027–028 | no |
| EXEC-CORE live behavioral acceptance during real use (EXEC-LIVE) | game-side execution acceptance for the motion/cue/lyrics set | no |
| Compatibility and live-install checks needing the owner device or overwrite authorization (COMPAT-LIVE) | dual-profile skeleton identity, plugin-zip install, newly exported Meddle model acceptance | no |
| ARCH2 live wire parity + pose-lifecycle pass at the next owner-authorized DLL deploy (ARCH2-LIVE) | live wire-parity acceptance (48794/48795) and in-game freeze/seek/GPose/pin-mode behaviors | no |
| Character-assets live deploy + real-model render + two-profile session (CHARASSETS-P2-LIVE) | REQ-SPEC-054 check-off; real Meddle render acceptance | no |

No real-machine waiting item blocks M2: offline planning and implementation proceed; only live
acceptance waits (synthesis §8 rule).

## 4. Eight owner-tail judgments (synthesis §14 correction 3: item by item)

Judgment tokens: `named-pending-verification` (directly dual-mode-relevant, stays a named
pending-verification item), `in-scope-acceptance-only` (no M1.5 implementation; its acceptance
need survives inside this audit's scenario/dependency views), `excluded` (out of M1.5; the
acceptance need survives at the named owner path — exclusion never removes a requirement).

| Tail | Judgment | Surviving acceptance need / owner path |
|---|---|---|
| GAMECLOCK-LIVE | named-pending-verification | In-game clock-follow (AC-10) and the game-mode stop/unfreeze on switching back to web are directly dual-mode-relevant (synthesis §14.3) and stay named pending-verification items. Path: `HANDOFF-20260901-gameclock-preview-verify.md` AC-10 + the owed Stage-1 game-mode pass (§1 rows 019–028). |
| EXEC-LIVE | named-pending-verification | Game-mode playback/show-runner behaviors are the game half of dual mode: show after territory change, mid-play 409, crash-orphan sweep, unload unpin, DispatchLeadMs calibration. Path: `HANDOFF-20260831-execcore-show-runner.md` real-use list. |
| FIXJ-OBS | excluded | Narrow special-condition observations only (stuck framework thread for PLUG-2, real port contention for PLUG-3, system-clock change for PLUG-7; PLUG-4/5 already live-tested). The acceptance need survives when those real conditions occur. Path: `HANDOFF-20260831-fixj-plugin-thread-lifecycle.md`. |
| SEC1-SMOKE | in-scope-acceptance-only | Pose-viewer pairing and export-connection presentation still need human browser acceptance before the remaining SPEC §5 security checks. Survives in §3 security gate + real-machine groups. Path: `HANDOFF-20260830-sec1-private-reads.md` curl/UI checklist. |
| COMPAT-LIVE | in-scope-acceptance-only | Dual-profile skeleton identity, real plugin-zip installation and a newly exported Meddle model need the owner device or overwrite authorization. Survives in §3 real-machine waiting. Path: the tail itself; run only when the matching device/authorization is available. |
| RELEASE | excluded | Release authorization is not M1.5 work (owner-mandated exclusion). The acceptance need survives at `SPEC.md:101` (ship only after web-mode/game-mode/offline-library/recording/security regressions pass) and the §14 local-authorization release-blocking conditions. Path: owner publication authorization per `HANDOFF-20260902-v071-public-trial-prep.md`. |
| ARCH2-LIVE | in-scope-acceptance-only | Wire parity and pose-lifecycle behavior are test/review-proven; the live roots still run the pre-ARCH2 DLL. Survives in §3 real-machine waiting; the in-game freeze/seek behaviors feed the dual-mode game-side acceptance view. Path: next owner-authorized DLL deploy + reload pass per `HANDOFF-20260901-arch2-plugin-boundaries.md` / `HANDOFF-20260901-arch2-pose-lifecycle.md`. |
| CHARASSETS-P2-LIVE | in-scope-acceptance-only | Live deploy of the five character-assets twin pairs, one real Meddle import and a two-profile session; REQ-SPEC-054 check-off waits here (REQ-SPEC-056 on the P6 sweep). Survives in §3 real-machine waiting; the `web/preview3d.js:1199-1201` skeletonHash identity merge informs P4 scope. Path: `HANDOFF-20260903-character-assets-p3-preview.md`. |

## 5. Dancer-count ruling (owner-fixed one-line definition)

Verbatim definition (owner decision 2026-09-05, synthesis §15.4):

> Edit/rehearsal: 8 dancers; web preview: 8 dancers; game execution: 1 dancer (before X1).

Five divergent count spots verified in the current tree — this package names each spot and its
owning package; copy sync happens there, not here (assignments, not edits):

| Spot | Current state (evidence) | Owning package for the copy sync |
|---|---|---|
| `SPEC.md:42` | "The visible editor still offers 1–3 dancers by default" — stale against the 8-dancer ruling (E1 closed eight-performer authoring 2026-09-01) | product-governance doc-sync (draft `TASK-20260905-DUAL-MODE-CLOSEOUT`) |
| `web/choreo-app.js:1654` | Quick buttons 1–8 (the fast path to the ruling's 8); `setDancerCount` clamps 1–12 at `web/choreo-app.js:810` | web-product (closeout draft: align clamp/copy with the 8 ruling or record the deliberate 12 headroom) |
| `web/choreo-app.js:1465` | Project import validates 1–12 (AUD-002 second line of defense) | web-product (same closeout decision as above) |
| `src/ShowProtocol.cs:22` | `MaxPerformers = 64` — parser safety cap only, never verified execution scale (comment + `SPEC.md:43`) | plugin-product (comment/copy alignment only if QA judges it needed; the cap itself is a structural guard) |
| Deliberate single-actor game execution | Single-local-actor execution is a standing architecture decision until X1 (`docs/DESIGN-game-executor.md:30`, `.agent/CONTINUITY.md` architecture decisions; REQ-SPEC-024 verified) | None needed — the ruling restates it; any change belongs to X1-era packages |

Additional stale claim, same treatment: `docs/WORKPLAN-20260829.md:20` still says
"`setDancerCount` clamps to 1–3" while the source clamps 1–12 (`web/choreo-app.js:810`).
Owning package: product-governance doc-sync (closeout draft).

## 6. Seam plan (inside the AI-ARCHITECTURE decomposition sequence)

Planner output per synthesis §15.4: the seams below are the existing extension points future
M2/M3 packages extend, listed inside the "Safe decomposition sequence" of
`docs/AI-ARCHITECTURE.md`. No refactor or seam-implementation package is opened by this audit.

1. **Canonical document seam** (sequence step 1, landed WP-5-DOC/SIX-TRACK): M2 stage/start/
   facing editing extends event-kind fields through `web/choreo-document.js` (six kinds,
   unknown keys ride `_extra`), never a second timeline format (`SPEC.md:110`).
2. **Compiler/protocol seam** (sequence step 5, landed EXEC-CORE): `web/choreo-show-compiler.js`
   `compile`/`eventOf` and `src/ShowProtocol.cs` protocol v1. Rich movement/facing/ability fields
   enter the package only via a protocol-version bump with capability handshake — the plugin stays
   the single rejection authority (`src/ShowValidator.cs`).
3. **Executor registration seam** (sequence step 5): `src/ShowValidator.cs:31-36`
   `SupportedExecutors` + capability handshake. X1-era executors for ability/movement/facing
   register here; packages carrying them stay rejected before start until then.
4. **Preview planning seam** (sequence steps 4–5 context, landed P3): `web/preview3d.js`
   `planRender` pure master planner + the provisional M1 view convention. M2/M4 formation and
   position rendering extend the planner and the layout conventions; M2 design adopts or
   re-versions the coordinate contract with migration evidence.
5. **Edit-side marking seam** (sequence steps 1–2 landed): the editor projection through
   `web/choreo-document.js`/`web/choreo-docwire.js`. The M2/M3 acceptance gate "compiler
   field-loss → edit-side immediate marking" (§7) lands here, marking fields the show package
   cannot carry at edit time.

## 7. Milestone-to-requirement mapping with M2/M3 acceptance inputs

Mapping is by ticket/doc content only (synthesis §14 correction 4) — no registry schema or
machine-field change.

| Milestone | Existing requirement ids | Notes / acceptance inputs |
|---|---|---|
| M1.5 | REQ-SPEC-019..REQ-SPEC-029 | This audit (§1). |
| M2 | REQ-SPEC-012 (stage & movement, open), REQ-WP-E1 (closed foundation) | M2 design prerequisite: coordinate/time conventions. |
| M3 | REQ-SPEC-012 (path/speed/arrival), REQ-SPEC-016 (performance compilation, open) | Game-side movement execution waits for X1. |
| M4 | REQ-SPEC-012, REQ-SPEC-056 (multi-skeleton 1–8 preview, open) | Same-source sampling + root-motion separation; measurement method + device/asset scale per synthesis §13.5. |
| music | REQ-SPEC-009 (open) | Insertion point is a scheduling recommendation (§3 priority). |
| action semantics | REQ-SPEC-010 (open) | once/loop/posture, loop phase, reset, quality. |
| skill semantics | REQ-SPEC-011 (open) | CN-data basis; explicit uncertainty marking. |
| M6/X1 | REQ-WP-X1 (open), REQ-SPEC-017 (game execution row, open) | Single-client skills/movement/facing with takeover, emergency stop, real-game acceptance (`docs/WORKPLAN-20260829.md:22`). |
| after-X1 | REQ-WP-X1 + `docs/DESIGN-ensemble-sync.md` contract | Security gate: multi-player game execution waits on X1 (§3). |

Two M2/M3 acceptance inputs recorded from the verified chain
(`web/choreo-show-compiler.js:59-74` eventOf generic-field projection → `src/ShowProtocol.cs:41-51`
ShowEvent → `src/ShowValidator.cs:31-36` SupportedExecutors/KnownUnsupported: motion/cue/lyrics
only, movement-control/ability-execution rejected):

- **Compiler field-loss → edit-side immediate marking** is an M2/M3 acceptance criterion of the
  owning packages (synthesis §15.4): when an edited field cannot enter the show package, the
  editor marks it immediately instead of letting "save succeeds, execution rejects" surface only
  at game time.
- **Shared dual-side samples** are an M2/M3 protocol-package gate (not an M1.5 item): a small set
  of non-private canonical samples with expectations derived from the contract and independent
  derivation, never one side's output used verbatim as the other side's truth (synthesis §7).

## 8. First follow-up package and remaining planning rows

Exactly one thin deferred draft ticket is registered by this package:
`TASK-20260905-DUAL-MODE-CLOSEOUT` (status draft, deferred in `.agent/PROCESS-STATE.json`,
prerequisite this audit). Its justification comes from §1: the only confirmed gap is REQ-SPEC-027
(play-button presentation) and the dancer-count copy syncs of §5 are assigned but unowned in the
queue. Nothing is enabled, claimed or pre-approved; its full BDD acceptance criteria are authored
at its own QA review after the owner enables it (character-assets split precedent).

Rows that stay planning-only in this document (a second draft would exceed this contract and
needs a ticket revision):

1. **M2 entry package** (stage/start/facing/formation editing): next mainline product package
   after the closeout; owns the coordinate/time conventions design and the edit-side marking
   acceptance input of §7.
2. **M2/M3 protocol package with shared dual-side samples**: gate recorded in §7.
3. **Game-mode acceptance session** (owner action, not a package): one sitting covering the owed
   Stage-1 real-machine pass, GAMECLOCK AC-10 clock-follow, and the game-mode stop/unfreeze
   check — closes the acceptance side of §1's eight pending rows and the two named tails.
4. **Play-button presentation judgment** (owner decision inside the closeout package): whether
   the tooltip + mode-toggle + status-bar indication satisfies REQ-SPEC-027's intent or the
   button label itself must carry the mode.
