# HANDOFF — 执行证据链 P1（motion，只记录）TASK-20260916-EXEC-EVIDENCE-P1-MOTION / RUN-20260916-EXEC-EVIDENCE-P1-R1

## Objective and acceptance

Complete the motion execution evidence chain 计划 → 入队接受/拒绝 → 实际原生提交 → 匹配状态变化 →
结束/超时/取消 inside EXEC-CORE as one record-only package: tracked command surface on
GameCommandExecutor, a pure MotionEvidenceBoard correlator with strict baseline/expected/window
discipline, a Dalamud-bound observer adapter, additive ExecutionLog/StatusJson evidence fields with
exactly ONE status-json freeze revision, and cancelled-by-stop bookkeeping. Owner hard rulings
(INT-20260916-EXEC-EVIDENCE-DIRECTION): evidence never changes Ok, never Faults, never skips; no
auto-refire/retry/resend ever; the ability evidence chain is reused discipline, not rebuilt.
Full contract: docs/DESIGN-execution-evidence-v1.md §3; all seven ACs met as listed below.

## Mechanism / red baseline

- Red: `-- motion-evidence` exited 2 (scenario absent) before implementation;
  `-- status-json-freeze`, full datalayertest suite (3159/0) and the plugin Release build were
  green pre-change. Evidence: .agent/evidence/TASK-20260916-EXEC-EVIDENCE-P1-MOTION/red-baseline-*.txt.
- The seven silent drops live in the legacy void ExecuteCommand (empty; policy; stale origin/guard;
  exclusive-owner refusal; queue-full drop-oldest) and at dequeue (5s expiry; stale origin/guard),
  plus ExecuteNow swallowing native exceptions. All were silent by construction; the gap was
  verified against src/GameCommandExecutor.cs:92-117/193-234 at claim time.

## What changed and behavior preserved

- src/MotionEvidenceBoard.cs (new, pure, no Dalamud): CommandTicket + bounded board
  (capacity 256 ≥ queue cap 64, oldest-out with terminal supersede) + strict correlator
  (1500ms constant window). States and Chinese renders per design §2: 已入队 / 入队被拒（原因）/
  队列淘汰 / 过期丢弃 / 租约失效丢弃 / 已原生提交 / 原生提交异常 / 已确认（+Δms）/
  超时未确认 / 证据不符 / 停演取消 / 无法映射预期（+ 证据记录淘汰 for eviction).
  Exactly-once terminal; per-show generation in ticket ids (supersede guard); MarkStopped cancels
  every open ticket exactly once.
- src/GameCommandExecutor.cs: additive `ExecuteCommandTracked(command, origin, originGuard) →
  CommandTicket`; the legacy void overload delegates and discards the ticket (same checks, same
  logs, same queue effects — the dequeue compound drop condition only split into two sequential
  drops with identical control flow). Queue entries carry the ticket; dequeue expiry/stale/TryRun
  refusal and ExecuteNow success/fault record outcomes. SubmitBoundedPlayback/SubmitX1Synchronous
  byte-unchanged.
- src/GameShowDispatcher.cs: DispatchTrackedCommand captures the pre-dispatch baseline
  (EmoteController.EmoteId + Timeline.TimelineSequencer.GetSlotTimeline(0), the SimpleHeels-derived
  slot access) before enqueue, resolves the expected emote row family from the Lumina Emote sheet
  TextCommand column (command minus trailing " motion"; unresolvable → mapping-unknown,
  observation skipped, never a failure) and attaches TicketId to the Success result. TickEvidence
  (called by Plugin.OnFrameworkUpdate on the framework thread before ShowRunner.Tick) feeds
  observations when tickets are open and settles window expiry; all observation failures are
  swallowed — evidence never affects execution.
- src/ShowRunner.cs: optional SetMotionEvidence seam (guard-provider pattern); Load bumps the
  board generation; dispatch-loop entries carry TicketId and copy board state at dispatch and each
  Playing tick; CleanupLocked/Unload mark cancelled-by-stop and refresh entries; recentLog gains
  evidenceState/evidenceReason/evidenceMonoMs.
- src/ExecutionLog.cs: additive TicketId/EvidenceState/EvidenceReason/EvidenceMonoMs; UpdateEvidence
  copies board state into ticketed entries; RenderTail appends 〔证据：…〕 ONLY for ticketed entries
  (no-ticket logText byte-identical; base arrows 已发送/失败/已跳过 preserved).
- src/Plugin.cs: passes DataManager to GameShowDispatcher, wires SetMotionEvidence(_executor.Evidence)
  and calls _showDispatcher.TickEvidence() before _showRunner.Tick().
- ONE status-json freeze revision (ShowGuardAvailabilityTests.cs), precedent
  TASK-20260911-X1-OFFLINE-FAILURE-POLICY: each recentLog entry gains
  `"evidenceState":"","evidenceReason":"","evidenceMonoMs":0` after skipMarking; existing keys,
  order, values, logText and dispatched semantics byte-identical; comment updated citing this task.
- Test harness: src/tests/datalayertest/MotionEvidenceTests.cs (new scenario, 63 assertions:
  [q-*] fake-queue/clock seven-drop + native-fault + exactly-once + bounded; [corr-*] 14 strict
  cases incl. old-emote-end-not-adopted, baseline→other→expected, strict window, double-adoption
  refusal, mapping-unknown ×2, supersede, variant family; [render-*] byte-identity + annotations;
  [policy-*] record-only with the runner Playing and Ok=true; [stop-*] idempotence/replay/unload),
  routed in program.cs, compiled via datalayertest.csproj.

## Verification actually observed

Frozen gateContract (node scripts/pipeline-cli.js run-gate RUN-20260916-EXEC-EVIDENCE-P1-R1):
**passed** — ticket-validation, pipeline-check, diff-whitespace, motion-evidence-suite (0 failures),
status-json-freeze (revised canonical), x1-composite-dispatcher, datalayer-suite 3159/0,
plugin-build (0 warnings/0 errors), show-owned-web, stage-replay-web, show-entry-web.
Full detail: .agent/evidence/TASK-20260916-EXEC-EVIDENCE-P1-MOTION/verification-summary.md.
measure: changedFilePaths all inside lockScope (+427/−15); zero web/** and zero prohibited-path
diffs. No-refire grep: zero ExecuteCommand/Submit*/ExecuteNative call sites in the evidence
sources (no-refire-grep.txt).

## Remaining owner tails and why

- Real-machine evidence acceptance is owner-gated and outside the run (design §3.5): one show with
  a visible motion shows 已确认; a policy-rejected command shows 入队被拒; a burst faster than the
  200ms cadence shows truthful queue states; no observable dispatch-behavior change. Rides the next
  owner-authorized game session; no DLL was built-for-install, deployed or loaded here.
- Record-only → policy wiring (e.g. fault or skip on unconfirmed motion) is a P2 owner decision
  gated on real samples; P2–P5 are registered boundaries only.
- pipeline-check's defaultContextBytes was already over policy at claim time (22630 > 20000) from
  the owner's uncommitted continuity growth; the workflow-mandated continuity rewrite
  (current-state form, all facts and machine markers preserved) brought it to 19994 ≤ 20000.
- Worker disclosure: src/tests/datalayertest/program.cs gained the named-case routing line for this
  ticket's own frozen gate command (`-- motion-evidence`); program.cs is the shared test-harness
  router but sits outside the ticket's enumerated writeScope, hence disclosed here instead of the
  module-change files list.
- Owner-directed maintenance after the gate (2026-09-16, AI-WORKFLOW §2.7): on the owner's verbatim
  instruction 「不管分类旧技能范围中断，永远别管了」, the six old skill-scope interruptions
  (INT-20260914-SKILL-ATTEMPT-ONCE / -COMPLETE / -FINALIZATION / -LEGALITY / -MOTION-PREVIEW /
  -NATIVE-PERFORMANCE) were resolved with decision `owner-dismissed` and never require planner
  classification again. Record: .agent/evidence/TASK-20260916-EXEC-EVIDENCE-P1-MOTION/
  owner-directed-interrupt-maintenance.md. No product source, ticket, run manifest or policy file
  was touched; the STAGE/OWNER-CONTINUE/UI/EXEC-EVIDENCE interruptions were left for the
  owner/planner.

## Files changed

src/MotionEvidenceBoard.cs (new), src/GameCommandExecutor.cs, src/GameShowDispatcher.cs,
src/ShowRunner.cs, src/ExecutionLog.cs, src/Plugin.cs, src/tests/datalayertest/MotionEvidenceTests.cs
(new), src/tests/datalayertest/ShowGuardAvailabilityTests.cs (one freeze revision),
src/tests/datalayertest/datalayertest.csproj, src/tests/datalayertest/program.cs (routing),
.agent/evidence/TASK-20260916-EXEC-EVIDENCE-P1-MOTION/**, .agent/modules/plugin-product/changes/
CHG-TASK-20260916-EXEC-EVIDENCE-P1-MOTION.json, .agent/CONTINUITY.md (rewrite-as-current-state),
this handoff, ticket/run bookkeeping.
