# Handoff: Two-route resource-conversion feasibility probe (TASK-20260909-RESOURCE-CONVERT-PROBE)

## Objective and acceptance

Evidence-first feasibility probe (ticket revision 2, R2, standard lane, module
review lane) from owner plan chapters 5 / 12-V4 / 13-experiment-B plus OD-3:
measure a frozen five-sample representative set on both candidate conversion
routes — route A offline parsing of the local game install by an isolated
probe harness, route B the existing client-assisted recording baseline —
across eight metrics per sample, with one comparison record per criterion,
honest failed/unknown cells and a schema-only cache-identity proposal. No
production converter, no product behavior change, no route winner, no SPEC/
roadmap edit (no portfolio milestone id exists; contribution is plan
experiment B / Q3 only). All six acceptance criteria are verified by
`GATE-RUN-20260909-RESOURCE-CONVERT-PROBE` (8/8 frozen gateContract-v2 checks
passed, gateContractHash `b9ed0903…`); the module review
`REVIEW-RUN-20260909-RESOURCE-CONVERT-PROBE-module` is APPROVE with three
not-falsified CP-CHALLENGE counterexamples, an independent real-sample
re-probe and an independent scope/csproj inspection; the run closed
`completed` through the shared closeout validator.

## Mechanism / red baseline

- The frozen sample set (`sampleSetHash 6fb054eb…`) covers the five OD-3
  default classes once/loop/posture/weapon-held/skill-phase over two skeleton
  classes (midlander-m, miqote-f) with resolved catalog ids, explicit
  non-command reasons (dance-action-no-text-command, posture-no-command,
  skill-action-no-text-command) and library-availability evidence
  (library-index:miss:2026-09-10) — frozen before formal measurement.
- Route A negative evidence is real, not synthetic: five harness attempts
  (`ATT-A-S-*`, output ids `OUT-A-S-*`, all preserved) terminated at stage
  `lookup` with reason `source-missing:runtime-only` in 0.2–0.297 ms each,
  because no actual game-resource source was supplied to the isolated
  harness at run time. Header inspection never implied decode success, and
  the unsupported offline decode stays a recorded failure per qa-contract.
- Route B baseline: no compatible clips exist in the library for any of the
  five identities (library-index miss), so all five records are mode
  `unavailable` with `followUp: owner-capture:pending-2026-09-10`; nothing
  was fabricated or waited on indefinitely.
- Verifier falsification mechanism: `verify.js --self-test` holds a positive
  fixture plus 14 isolated mutations (duplicate-row-same-count, absent-B,
  foreign/missing id, wrong-skeleton reuse, stale hash, fabricated zero,
  nonfinite, path leak, unknown-to-match, inverted verdict, partial report,
  missing cache field and more), each rejected nonzero; the harness
  self-test exercises cancellation, timeout, same-id publish races and
  fresh-id recovery (21/21).

## What changed and behavior preserved

- New standalone probe harness only, excluded from the plugin DLL:
  `src/tests/convertprobe/convertprobe.csproj` (net8.0 Exe, no
  ProjectReference, no Dalamud/Exporter/papparser content; the plugin
  csproj's `Compile Remove="tests\**"` glob keeps it out and is
  byte-identical, sha256 `e91a203a…`), `Program.cs` (read-only lookup/
  parse/measure with explicit finite limits MaxInputBytes 65536 and
  MaxFrameCount 1024 checked before any declared-length allocation, 60 s
  per-attempt bound, exclusive CreateNew publish) and `verify.js`
  (three-gate oracle: `--records`, `--self-test`, `--scope`).
- Evidence artifacts: `probe.json` (schemaVersion 1, ticketRevision 2,
  consolidated sanitized records — 5 samples, 5+5 route records, 40
  comparison cells, cacheIdentityProposal with 8 field names, 10 attempt
  identities) and `scope-baseline.json` (read-only SHA-256 inventory,
  1571 files, taken before implementation). No keyframe arrays, transform
  data, asset bytes or machine paths enter the repository; only catalog
  identities, hashes, sanitized tokens and measurements.
- Zero product change: plugin, web, endpoints, protocol, data formats,
  SPEC/roadmap/workplan, frozen `src/Exporter/*.bak` prototypes (read
  reference only) and live installs are untouched; no new dependency.

## Verification actually observed

- Frozen gate `GATE-RUN-20260909-RESOURCE-CONVERT-PROBE` — all eight
  required checks passed: CP-ARTIFACT (pipeline check PASS), CP-PROCESS
  (25/25), CP-DOCS (60/60), CP-DIFF (clean), CP-RECORDS (`--records` exit 0:
  CP-SAMPLES/CP-A/CP-B/CP-MATRIX OK, 5/5 samples 40/40 cells hash-bound),
  CP-ORACLE (15/15), CP-HARNESS (21/21 via the user-local .NET 10 SDK with
  `DOTNET_ROLL_FORWARD=Major`; the SDK-less machine-wide dotnet resolved
  first with 0x80008083 and was rerun per AI-TEST-MATRIX with the command
  string unchanged), CP-SCOPE (scope assertions OK; baseline 1571 → current
  1577, 5 lockScope files, +531/-0).
- Module review APPROVE, independently re-running all eight commands
  (every exit 0) and binding gate hash `ce5bb3ce…`; counterexamples all
  not-falsified: duplicated comparison row rejected
  (`comparison-dup;comparison-missing:X-SKILL|size`), route-B skeleton
  misbind rejected (`routeB-skel-mismatch:X-ONCE`), forced unknown→match
  quality verdict rejected (`comparison-verdict…want-unknown`); a fresh-id
  real harness re-probe reproduced the recorded lookup failure without
  private paths; the independent inventory/csproj/leak scan confirmed
  budget compliance and byte-identity. Two P3 findings (inputHash format
  not validated when present; per-metric stage tokens looser than the
  attempt terminal stage) are optional hardening for a future
  production-converter ticket, no change required in this run.
- Comparison table verdicts: 35 `routeA-failed` + 5 `routeB-unavailable`,
  zero match/mismatch — the honest-incompleteness outcome the qa-contract
  authorizes; real comparison remains pending the live inputs below.
- Run measurement at closeout: 5 attributable files +531/-0 (budgets 12/
  900/90 min; active time ≈ 11.8 min), repair attempts 0; closeout state
  files (this handoff, ledger, backlog, continuity, ticket status) are
  Context Sync artifacts outside the gate-time measurement.

## Remaining owner tails and why

- None opened or closed (ticket non-goal). Two optional owner follow-ups
  stay recorded inside `probe.json`, not as pipeline tails: supply actual
  local game-resource source inputs to the isolated harness (route A) and
  capture the five missing clips through the existing recording UI if
  desired (route B, `owner-capture:pending-2026-09-10`). Until either
  happens, the 40-cell table stays explicitly incomplete and no route
  decision is supported.

## Files changed

- `src/tests/convertprobe/convertprobe.csproj`, `src/tests/convertprobe/Program.cs`,
  `src/tests/convertprobe/verify.js` (new, standalone, DLL-excluded).
- `.agent/evidence/TASK-20260909-RESOURCE-CONVERT-PROBE/probe.json`,
  `scope-baseline.json` (new; `qa-contract.md` predates the claim and stays
  frozen).
- Evidence: `GATE-RUN-20260909-RESOURCE-CONVERT-PROBE.json`,
  `REVIEW-RUN-20260909-RESOURCE-CONVERT-PROBE-module.json`; module record
  `CHG-TASK-20260909-RESOURCE-CONVERT-PROBE.json` (plugin-product).
- Closeout state: `.agent/PROCESS-STATE.json` (order 52 closed),
  `docs/AI-BACKLOG.md`, `.agent/CONTINUITY.md`, ticket status `closed`,
  this handoff.

## 主人对比摘要（路线 A vs 路线 B，五样本 × 八指标）

- 本次探针只完成「测量框架 + 证据规则」，**两条路线都还没有真实的转换测量结果**，
  因此不宣布任何胜者：40 格对比表中 35 格为「路线A失败」、5 格为「路线B不可用」，
  没有任何一格是匹配或不匹配。
- 路线 A（离线解析本机游戏安装）：探针在运行时未获得真实游戏资源输入，
  五次尝试全部在「查找源文件」阶段诚实失败（每次约 0.2–0.3 毫秒，原因
  source-missing:runtime-only）。这不是解析能力失败的结论——只是本轮没有喂入
  真实资源；头文件检查也从不被当成解码成功的证据。
- 路线 B（客户端辅助录制基线）：资料库中五个样本（挥手/踢踏舞循环/站姿持 /
  持剑礼/重击技能阶段，覆盖中原民男+猫魅族女两套骨架）都没有兼容的已录剪辑，
  全部记录为「不可用，待主人补录」（owner-capture:pending）。未伪造任何数据。
- 缓存身份字段只做了 schema 提案（来源身份、内容哈希、骨架/绑定、转换器版本、
  游戏资源版本、质检版本与结果共 8 个字段），没有任何缓存实现或产品格式迁移。
- 若想得到真实对比：主人下次方便时，把本地游戏资源路径喂给独立探针（路线 A），
  和/或用现有录制 UI 录齐这五个样本（路线 B），然后开一张新的探针票重测；
  本票的框架、冻结样本集与校验规则可直接复用。
