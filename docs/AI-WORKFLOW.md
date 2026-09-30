# ChoreoHelper task workflow

Current process, reconciled 2026-09-22 at the owner's request. This replaces the legacy
package-state/process-audit closeout route for current tasks; historical records remain intact.

## 1. Authority and one current task

The owner is the final authority for user outcomes.
Current facts come from source and direct evidence; intended behavior comes from owner decisions,
SPEC and the accepted contract. Intended contract behavior cannot be replaced by current bugs.
A task contract owns requirements, revision, acceptance criteria, write scope, evidence and review.
PROGRESS is a short Chinese view. CONTINUITY carries current constraints and pointers.
NEXT-ACTION is only an index of the exact next prompt inside the task, never proof of acceptance.
Do not duplicate long evidence or prompt bodies across status documents.

Read the actual task and inspect source before choosing the next step. Preserve existing authority;
do not ask for approval again for already-authorized bounded work. Review-only work cannot implement.
If a new requirement changes behavior, scope or compatibility, settle it before dependent work.

## 2. Before implementation

Record one user-visible outcome and observable acceptance criteria. Inspect reusable code and all
entry points of the affected behavior. Cover normal, boundary, failure, cancel, switch and recovery
cases, or state why a case does not apply. Define what this batch will NOT change.
For data/delete/undo work, specify atomicity, no-op, draft preservation and one-step recovery first.
Save dirty target bytes and hashes: HEAD alone is not the baseline. Check overlapping writers.
Do not recursively copy evidence trees. Save only the target files and link old evidence.
Record a failing reproduction for confirmed bugs where feasible; otherwise record the mechanism
and limitations. Establish existing failing signatures before attributing new failures.

## 3. Implementation and verification

Complete the authorized batch without stopping after each routine step. Make minimal changes,
then run targeted tests, affected regressions and real browser interactions where UI is involved.
Use isolated profiles/data for destructive test scenarios. Inspect both primary and legacy entry
points; test failures and cancellation, not just happy paths. For an explicit repeatability criterion,
run the required repeats and preserve failed runs; otherwise repeat only when risk or evidence warrants it.
Do not loosen valid assertions or repair unrelated historical failures to get a green total.
Bind logs to exact tested bytes, task revision, commands and exit codes. List affected deploy roots;
source tests, browser behavior, deployment and real game effects are separate evidence levels.
Progress is event-driven: report findings, changed direction, blockers and completion in plain Chinese.
The active tool's communication requirements still apply.

## 4. Review level and models

Review levels: self | standard | technical | critical. An assigned level may only be raised, never lowered
without an explicit scope decision. Review risk is orthogonal to model marketing names.

| Level | Scope | Review requirement |
|---|---|---|
| self | Reversible spelling or links only | Self-check and clearly label it |
| standard | Local behavior without data/transaction impact | Fresh independent session, real affected checks |
| technical | Cross-module UI, storage, delete/undo, async state | Fresh capable coding/reasoning session, counterexamples and integration evidence |
| critical | Authorization, migrations, live game output, release | Codex final acceptance plus the required owner/live evidence |

The implementer never accepts its own changed bytes. Fresh review means independent evidence,
not merely a different model name. A reviewer reports defects and does not fix them in the same review.
For existing GLM tasks preserve the agreed implementation model (currently GLM-5.3) unless the owner
changes it. For complex planning and technical/critical review recommend GPT-6 Astra (high) in Codex
when available; this is a project recommendation, not a measured guarantee. Lightweight reviewers
must not replace missing risk coverage. Verify availability at handoff; GLM access is not observable
from this Codex session. State that limitation rather than claiming dispatch.
Current Codex host advertises Astra; official catalog: https://developers.openai.com/api/docs/models/all .
Model recommendation, responsibility, reason and actual dispatch status belong outside the prompt.

## 5. Acceptance and bounded rework

Implementation complete -> self-tested -> independent review -> accepted for the specified evidence
level. Never collapse these states. Every applicable AC needs a result and evidence; failed/blocked
AC prevents acceptance of that scope. An out-of-scope discovery may be deferred only with a linked
follow-up, owner decision when needed, and a narrower accurate completion claim.
Two attempts without meaningful progress on the same root cause trigger diagnosis/replanning before
another edit cycle. Retain old attempts; distinguish product defects, test defects and environment limits.
For major-feature completion gate, walk the whole owner journey across batches, test old-project
reopen and required offline/deployment behavior; batch PASS alone is not whole-product acceptance.
No new gate may retroactively rewrite accepted historical evidence.

## 5a. Value-first gate (owner decision 2026-09-28)

From the overhaul plan (docs/OVERHAUL-PLAN-20260928.md); constrains how sections 2-5 are applied:
- Offline green is not product progress. Every batch advances at least one owner-visible path,
  or states explicitly why it is pure enabling work authorized by the plan.
- Offline edge-case defense (non-scalar/injection-style counterexamples) gets at most one bounded
  rework round; if still red, register it as a known issue and return to the mainline. The owner
  may override per task.
- New hash-freeze assertions are limited to data-integrity invariants; refactor-target files must
  migrate their hash tests to semantic assertions before restructuring.

## 6. Closeout

Inspect the final diff, hashes and verification. Update only this task's current state and evidence.
Synchronize its PROGRESS row and a concise CONTINUITY pointer. Preserve other work and history.
Select exactly one next action from actual state:
- incomplete implementation -> remaining authorized work;
- implementation/self-test done -> independent review;
- review failed -> bounded repair with reproducible failures;
- accepted batch -> next authorized batch, or one concrete owner decision if authorization is absent;
- blocked -> the smallest unblock action; never instruct repeating the same failing run blindly.

Every substantive closeout, including review PASS, failure and blockage, includes these Chinese lines:
1. 做成了什么 — user-visible change; distinguish policy-only work.
2. 验证到哪 — observed evidence level, not a wall of test totals.
3. 还差什么 — failure, unknown or owner-only evidence.
4. 下一步 — one action and why it comes next; what the owner must do, if anything.
5. 用什么模型 — model, responsibility, reason, dispatch status (outside the prompt).
6. A complete Chinese continuation prompt in a fenced block in the final reply; a file link is insufficient.

The prompt includes absolute repo/task/evidence paths, contract revision, current scope, current
verified/unverified facts, actual next action, preserved files, tests, completion and stop conditions.
Do not put placeholders or model-role chatter inside it. Do not infer permission from a suggested prompt.
Update .agent/NEXT-ACTION.json to point to the exact task heading and normalized prompt SHA-256.
Run D:/nodejs/node.exe scripts/test-workflow.js and scripts/check-workflow.js --next.
The latter renders the stored handoff for copying, without launching a model. Include its complete
prompt in the final response; adapt only with corresponding contract/index updates.
Structural PASS is NOT a semantic/product/independent-review PASS. These scripts are not automatically
executed by the app and cannot force an external AI to obey; each executor must run them at closeout.

## 7. Legacy boundary and preservation

Do not run process-audit --fix, close old tickets, alter old hashes or recreate missing evidence just
to satisfy the legacy pipeline. scripts/check-ai-docs.js remains a separate, currently failing audit;
report its failures separately. The current checker covers current handoff routing only.
No commit, push, publish, live install or game action is authorized by this process change.
Preserve original documentation snapshots and all product work. Revisit obsolete historical indexes
only in a specifically scoped task, not as a dependency for ordinary development.
