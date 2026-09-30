# HANDOFF — Bounded PNG evidence budget in shared run measurement

Ticket: [TASK-20260906-BINARY-EVIDENCE-BUDGET](../.agent/tickets/TASK-20260906-BINARY-EVIDENCE-BUDGET.json) (rev 3, accepted) ·
Run: `RUN-20260906-BINARY-EVIDENCE-BUDGET` · Role: Worker · Date: 2026-09-06

## Objective and acceptance

One optional, fail-closed PNG evidence allowance so authorized binary evidence no longer makes an
attributable run unmeasurable, while everything else keeps its existing behavior. Rev 3 AC-1..AC-6,
implemented under INT-20260906-BINARY-BUDGET-PIPELINE authority; the appearance ticket stays blocked
for fresh QA and is untouched.

## Mechanism / red baseline

`measureRun` routed every changed binary (including deletions) to `RUN_LINE_BUDGET_UNMEASURABLE`,
and `validateTicket` ignored `binaryEvidenceBudget` entirely — that is what made the five appearance
screenshots unmeasurable in the cancelled appearance run. Baseline before changes:
policy 132/132, cli 133/133, `check` FAIL with exactly the two preserved findings, `git diff --check` clean.

## What changed and behavior preserved

- `scripts/pipeline-policy.js` — optional `binaryEvidenceBudget` validation: schemaVersion 1 only;
  explicit unique repo-relative `.png` paths inside writeScope **and** the effective measurement
  scope (lockScope or writeScope); positive safe-integer `maxFiles/maxFileBytes/maxTotalBytes` with
  `maxFiles <= paths.length`; rejects unknown keys/versions, globs, traversal, absolute paths,
  duplicates and case-folded aliases. Absence = zero new behavior.
- `scripts/pipeline-cli.js` — claim freezes the declaration into the run manifest with
  `binaryEvidenceBudgetHash = sha256(runId, ticketId, ticketRevision, declaration)`; every shared
  measurement re-verifies it (`RUN_BINARY_DECLARATION_TAMPER` fails closed). `measureRun` reports
  changed declared PNGs as `oldBytes/newBytes/chargedBytes=max(old,new)` (missing side zero) plus
  per-side SHA-256 in an additive `binaries` result object, enforces the three caps independently
  (`RUN_BINARY_FILE/COUNT/TOTAL_BUDGET_EXCEEDED`, exit 3), and structurally validates every present
  side (signature, bounded chunk framing, CRC, first IHDR length 13 with nonzero dimensions, ≥1 IDAT,
  terminal zero-length IEND, no trailing bytes) — `RUN_BINARY_MALFORMED` on any violation, including
  text-looking bytes and deleted files' baseline bytes. Byte framing only; this proves nothing about
  rendered appearance. Unchanged: undeclared binaries keep `RUN_LINE_BUDGET_UNMEASURABLE` + non-zero
  exit, text lines keep the single CRLF/LF rule, global changed-file budgets keep counting PNGs,
  legacy/no-declaration runs keep exact old behavior, and measure/status/doctor/gate/finish all read
  the same measurement. No consumer-specific exclusions, waivers or baseline laundering.

## Verification actually observed

| Check | Baseline | After |
|---|---|---|
| `node scripts/test-pipeline-policy.js` | 132/132 | **152/152** (+20 declaration cases) |
| `node scripts/test-pipeline-cli.js` | 133/133 | **162/162** (+29 fixtures) |
| `node scripts/pipeline-cli.js check` | FAIL (2 preserved findings) | FAIL, **identical** findings, no new |
| `git diff --check` | clean | clean |

New CLI fixtures cover: freeze + tamper (declaration, hash, CLI exit), post-claim ticket broadening
inert, combined add/replace/delete/revert charging with SHA-256, exact and one-over per-file /
count / total caps, truncated / CRC-corrupt / trailing / IDAT-less PNGs, text-at-declared-path,
undeclared binaries, text↔binary transitions, byte-identical repeated measurement, blocked finish
archiving final binary evidence, recovery on a fresh run ID + baseline, and legacy compatibility.
AC-5 fixture copies the five preserved screenshots (37319 bytes total, each ≤ 8192) only **after**
its own claim into a disposable repo and passes the declared 5-file/8192/40960 allowance with
per-path bytes + SHA-256; the originals were hash-verified untouched. Machine evidence:
[worker-evidence.json](../.agent/evidence/TASK-20260906-BINARY-EVIDENCE-BUDGET/worker-evidence.json).

## Remaining owner tails and why

- None added. The two preserved `check` findings (appearance CHG identity/revision mismatch;
  recorded prerequisite inversion) are pre-existing and dispositioned by fresh appearance QA per
  the ticket — this repair never closes product tails.

## Files changed

`scripts/pipeline-policy.js`, `scripts/pipeline-cli.js`, `scripts/test-pipeline-policy.js`,
`scripts/test-pipeline-cli.js`, `.agent/templates/task-ticket.example.json`,
`.agent/evidence/TASK-20260906-BINARY-EVIDENCE-BUDGET/worker-evidence.json`,
`.agent/modules/ai-pipeline/changes/CHG-TASK-20260906-BINARY-EVIDENCE-BUDGET.json`, this handoff.
