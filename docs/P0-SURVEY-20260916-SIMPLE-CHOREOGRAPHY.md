# P0 engineering survey: simple-choreography batch feasibility

Date: 2026-09-16 (attempt 1), revised 2026-09-16 (attempt 2 after independent review R1–R7),
revised again 2026-09-16 (attempt 3: R1 statistic-label corrections, R7 command/baseline fixes;
scope and ACs unchanged).
Interruption: `INT-20260916-SIMPLE-CHOREOGRAPHY` (open, planning).
Plan input: `docs/PLAN-20260916-SIMPLE-CHOREOGRAPHY.md` (chapter 6 P0).
Evidence type: source audit + read-only local probes. **No game process, no browser,
no deploy, no live-install change, no game output, no converter execution.** Game data
read-only from `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\sqpack` (60 GB, base + ex1–ex5,
last content update on disk 2026-09-08).

Evidence layers in this report: **[a1]** attempt-1 probes in
`D:\choreo\p0-scan-20260916\` (unchanged, see `D:/choreo/p0-acceptance-20260916-attempt1/review-input-hashes.json`),
**[acc]** observations recorded by the attempt-1 acceptance session (task §5), **[a2]**
attempt-2 probes in `D:\choreo\p0-rework-20260916-attempt2\` (`probe2-rework-evidence.js`,
`rework-probe-result.json`, `probe2-run.log`, `sklb/`, `actiontimeline-repro.tsv`,
`lumina-export/`). Attempt-2 corrections supersede attempt-1 wording wherever they
conflict; attempt-1 raw outputs are preserved, not overwritten. **[a3]** attempt-3
probe in `D:\choreo\p0-rework-20260916-attempt3\` (`probe3-r1-stats.js`,
`probe3-result.json`, `probe3-run.log`, exit 0, 19/19 assertions): corrects the
attempt-2 statistic *labels* (duplicate-content group scope split, token-kind tally,
parts_idle_sp count) — all attempt-2 numbers that were merely mislabeled keep their
values, verified against the acceptance session's `independent-counts.json`.

Counting scopes used throughout (R1 fix): **rows** = non-empty ActionTimeline TSV rows;
**unique keys** = deduplicated key strings (a path is built from a key, so unique hit
keys = unique hit paths); **unique contents** = distinct sha256 of extracted bytes.

## 1. What layer the "existing action data" actually reaches

| Layer | Current state | Evidence |
|---|---|---|
| Action catalog | Offline Excel catalog readable by the plugin's own Lumina: **25,001 rows / 12,453 non-empty rows / 12,359 unique keys** (79 keys appear on 2–4 rows; e.g. `normal/idle` on 4 rows). Row- and key-scoped category counts in `rework-probe-result.json` (ability 893/892, emote 386/362, mon_sp 5964/5960 …) | [a1] `actiontimeline.tsv`; [a2] export reproduced line-identical (25,001 rows, diff 0, exit 0) |
| Animation references | TMB resolvable by constructed path `chara/action/<key>.tmb` for **11,990/12,453 rows (96.3%)** = **11,896/12,359 unique keys (96.2%)** = **10,866 unique byte contents**. Content duplication, correctly scoped [a3]: **124 duplicate-content groups** (same-sha256 groups holding >1 key) cover **1,154 hit keys**; **1,030 keys are redundant** beyond one per group (= 1,154 − 124 = 11,896 − 10,866; not "124 groups of 1,030", and not "all shared keys"). The 463 unique miss keys: 442 contain a `[SKL_ID]` token — token-kind tally over keys: `[SKL_ID]` × 442, no other kind, no multi-token key [a3]; **21 contain no bracket token and are itemized**: 2 × `mon_sp/…` (`mon_sp/m9996/mon_sp001`, `mon_sp/gimmick/crystal2_baha_encyu_target`), 4 × `specialpop/specialdepop3..6`, **15 × `parts_idle_sp/…`** (attempt-2 said 16 — wrong; 2+4+15=21) — a miss is recorded as a miss, never auto-labeled "placeholder" | [a1] `probe-coverage.js` row probe; [a2] three-scope sweep + per-key miss list; [a3] corrected group/token/family tallies |
| Real animations | PAP files resolvable offline by exact path per skeleton store; header parses with the repo's existing PAP layout (`count/code/info/start/end`), names verified (`cbem_goodbye_st`, `cbem_dance_elezen_2lp`) | [a1] `sqpack-extract.js --extract`; [acc] byte-identical re-extraction |
| Body variants | Measured with both denominators (unique-key scope /362 emote, /892 ability): **c0101 316 emote + 729 ability; c1101 293 + 184; c0901 293 + 109; the other 15 primary stores 138–226 emote and 0–6 ability** at the `bt_common` pattern (row-scope values incl. duplicates: emote matrix 340/158–317 of 386, ability 729/184/893). No "race-native" subset is claimed beyond this table — every store's numbers are listed per scope | [a1] `probe-ability.js`, `race-emote-matrix.json`; [a2] full 18-code × both-denominator table |
| Matching rules | **Type layer only:** 16/18 non-c0101 primary SKLBs contain the strings `hkaSkeletonMapper` ×4, `simpleMapping` ×1, `chainMapping` ×1 inside one 142-byte name-table region (c1201 decimal offsets 2251–2393); c0101 and c1701 contain none. **Instance layer untested for all codes this survey**; the one deserialized sample ([acc] `action16140/conversion-inspect/target-skeleton.xml`, adjacent SKLB hash equals this round's c1201 sample `1dc96a9d…`) shows 6 mapper instances with `simpleMappings`=101 each, `mappingType`=1 and **no `chainMappings` arrays at all**. "16/18" is therefore a type-descriptor count, NOT chain-mapping coverage | [a2] `sklb/` extraction + string/offset audit; [acc] XML instance observation (not re-readable in the attempt-2 session, see §5) |
| Playable results | Only the previously captured chain (c0101/c1101 source decode → local-space mapper → c1201 target), stored per-profile with full evidence hashes; web validation contract in `web/choreo-skill-motion.js` enforces profileId/skeletonHash/phase/cast evidence | `scripts/local-skill-assets/prepare_bound_actions.py`, `web/choreo-skill-motion.js` |

Conclusion (revised): catalog → reference → animation file are deterministically
reachable offline **at the probed path patterns**, and the SKLB type layer confirms
mapper classes exist in-data. Chain-mapping *instance* coverage is unproven — the only
observed instance set contains zero chain mappings — so "native mapping rules are in
the data" is true at type level only. The unimplemented part remains decode/retarget
breadth (chapter 3), plus instance-level mapping-rule verification.

## 2. Batch resolution of resources not loaded on the current character

**Proven end-to-end offline, no login, no per-race switching** [a1, reproduced acc+a2]:

1. Path hash: `Crc32NoFinal(lastFolderString) << 32 | Crc32NoFinal(fileName)`
   (CRC-32 poly 0xEDB88320, init 0xFFFFFFFF, **no final XOR**; calibrated against the
   shipped `Lumina.GameData.GetFileHash` reflection oracle; Lumina's public recursion
   yields the *last folder segment* while the on-disk `.index` keys use the *full folder
   string* — the probe uses the on-disk form).
2. `.index` entry → dat id/offset (packed `data & 0xE >> 1`, `(data & ~0xF) * 8`).
3. Dat block: 0x18 file header, 8-byte block-info table, 16-byte per-block header,
   raw-deflate payload. Self-validated on every extracted file: magic and declared
   length checked (TMB sweep: 0 failures, 0 magic/length mismatches [a2]).

Cost measured: index load 689 ms [a1] / 578 ms [a2] (59 chunk indexes, 1,802,971
entries); TMB full sweep 11,990 row extractions in 810 ms [a1] / 575 ms, 0.048 ms per
file, 0 failures [a2] — warm-cache figures, environment-dependent, not a fixed
threshold; single PAP/SKLB extract 1–2 ms cold [a1], 0.077–0.236 ms warm [acc].
**Enumeration caveat:** indexes are hash-only (no path strings; `.index2` is a
CRC32→offset table), so batch discovery must hash-probe *systematic path patterns* —
validated patterns: `chara/action/<key>.tmb`,
`chara/human/<cXXXX>/animation/a0001/bt_common/<key>.pap`,
`chara/human/<cXXXX>/skeleton/base/b0001/skl_<cXXXX>b0001.sklb`.

Open pattern gaps (P1 scope, reasons explicit):

- **Even-numbered (X02) codes**: at every probed pattern — body model
  `obj/body/b0001/model/<code>b0001_top.mdl`, base skeleton
  `skeleton/base/b0001/skl_<code>b0001.sklb`, `bt_common` PAPs — **all 20 codes
  c0102–c2002 resolve zero files** [a2]. (Odd-code control: the `b0001` top.mdl pattern
  resolves only for c0101, so per-race body ids also vary — model-pattern coverage is
  unexplored, not proven absent.) Naming evidence only: `cbfm_*`-prefixed animation
  names (attempt-1 TMB sample) resolve inside the **c0101/c1101 odd-code stores**
  (verified example: `event/event_chair_talk.pap` hits in both c0101 and c1101 [a2]).
  The plugin reads `RaceSexId` from the running game and keeps **no static code→race/sex
  table** (`src/CharacterAssetIdentityReader.cs`), so this survey does not assert what
  X02 codes mean; the even-code skeleton path pattern is unknown, not proven absent.
- **Ability keys missing from c0101 `bt_common`**: 163 unique keys (164 rows) are also
  **absent from the c0101 `bt_unique` pattern (0 hits) and from all 18 stores'
  `bt_common` (0 hits)** [a2] — the attempt-1 attribution "weapon-skill and unique-body
  PAPs live under bt_unique / equipment-linked weapon skeletons" is **retracted as
  unverified**. What is measured: unresolved at every probed pattern; the key names
  (`ability/swd_knight/abl007_hit`, `ability/clw_monk/abl007_hit`,
  `ability/2bw_bard/abl008_hit`, `ability/no_mot_*` …) suggest weapon-family hit
  reactions, which is a naming observation, not a file-location fact.
- **Miss keys** (463): 442 contain a `[SKL_ID]` token (consistent with data
  placeholders); 21 itemized keys contain no token — 2 `mon_sp/`, 4 `specialpop/`,
  15 `parts_idle_sp/` [a2, a3] — and their status is simply
  **unknown at probed patterns**.

## 3. Conversion and skeleton-matching coverage (rule existence ≠ implementation)

Source: `scripts/local-skill-assets/prepare_motion.py`, `prepare_bound_actions.py`,
`pap_selection.py`, `native_timing.py`, `prepare_c1201_*.py`.

Implemented and evidence-chained today: single-execution-phase decode from a bound
PAP; PAP entry selection by exact name; Havok container unwrap → converter → FBX →
clip; **local-space mapper only** (`mappingType == 1`), requires 1:1 bone-name
correspondence, full target coverage, < 1e-5 reference-pose error; dynamic
equivalence proof between mapper variants; TMB C010 single-entry phase with
natural/time-controlled modes; per-source-file (sha256) decode dedupe; mapper-variant
equivalence checks.

Native-rule families present in data but **not implemented** (data-evidence layer stated):

| Family | Data evidence (layer stated) | Current behavior | P1 direction |
|---|---|---|---|
| Chain mappings | Type descriptors in 16/18 SKLBs [a2]; instance count untested; observed instance sample = 0 chain mappings [acc] | hard reject (`Chain mapping unsupported`) | verify instance-level rules before building chain composition; do not assume chains exist |
| Multi-phase / multi-C010 TMBs | 3/290 sampled (event/QTE bundles up to 31 C010 entries) [a1] | reject (`Multiple animation phases require explicit composition`) | structural composition, not per-skill scripts |
| Cast phases | `SkillResourceReader` reads cast timeline; TMB exists (source audit) | reject in batch; cast preview requires manual in-game observation (`native_timing.py`) | keep observation-evidence contract; automate resolution of the cast TMB/PAP pair offline |
| Weapon / attached skeletons | 163 unique ability keys unresolved at every probed pattern [a2]; location unknown (naming suggests weapon families) | unhandled | pattern discovery first, then partial-skeleton decode |
| Runtime-only resolution | none observed for player actions in this survey | n/a | watch item, not yet a proven gap |

## 4. Automatic character acquisition ("use my game character")

Current state: real models arrive as **external Meddle glTF/GLB exports** imported
in-page (`web/choreo-model-import.js`), validated against an existing profile
skeleton; in-game identity today = `CharacterAssetIdentityReader` (RaceSexId →
`cXXXX` only, no mesh).

P0 facts that change the plan (layered, R3 fix):

- Per-race **base SKLB is extractable offline** for all 18 odd primary codes
  (c0101–c1801, b0001; 18 distinct sha256, no cross-race byte sharing [a2]), so
  correct per-race *skeleton identity + stand-in* can be generated without login or
  per-race capture, once the SKLB→web-skeleton step has a maintained path
  (currently converter-dependent).
- MDL is **index-locatable but not content-readable by the probe**: 
  `chara/human/c0101/obj/body/b0001/model/c0101b0001_top.mdl` → 1 index hit;
  `extract()` refuses `unsupported file type 3` [a2, acc]. Index reachability is not
  MDL readability. Full mesh/material auto-export (MDL+TEX→glTF) is **not implemented
  anywhere in the repo**, and no export API existence was assumed. MDL→glTF remains a
  separate, sizable P3 work package; Meddle stays the compatibility entry, it cannot
  remain the novice path.

## 5. Conversion toolchain deliverability

Converter environment visibility **differs by session** on this machine (R4 fix;
no cause assigned, no parallel session blamed):

| Session | Time (+08) | `%LOCALAPPDATA%\ChoreoHelper\direct-20260912-action-assets` (pinned XAT toolchain, `XAT\XAT\Lib\XATHavokInterop\XATHavokInterop.exe`) | `D:/choreo/local-backup-20260915` | `action16140/conversion-inspect/target-skeleton.xml` |
|---|---|---|---|---|
| GLM attempt 1 | 09-16 ~14:xx | not visible (attempt-1 report's claim) | not visible | not searched |
| Codex acceptance | 09-16 15:07 | **visible**; exe + upstream copy, sha256 `F9A4AE0DD7F30058D8B0092ACA3C95A21185B446A9BBF347F9123E43DD1917B2` (their record; not re-readable later) | not visible | visible (6 mappers, 0 chainMappings) |
| GLM attempt 2 | 09-16 15:15+ | **not visible** — full search: `C:/Users/xhz/AppData/Local/ChoreoHelper` (only 12 `gearset-browser-*` dirs), all of `D:/choreo` (depth 8), `D:/ff14`, `D:/codex`, `D:/Dev`, `D:/workspace`, `D:/coded`, `D:/zcode`, `D:/x1oa-rev`, user Downloads/Documents/Desktop | not visible | not visible |

Implications, stated without overreach: the pinned bytes existed on this machine at
15:07 and were absent from both P0 work sessions' views; neither "absent" nor
"present" is a stable fact. File visibility is not execution and not distributability
— no converter was run in either P0 attempt. `C:\Users\xhz\AppData\Local\ChoreoHelper`
itself is readable again (the 2026-09-15 "cannot read AppData" blocker is stale for
listing), but the toolchain tree under it is not there now.

- XAT is the open-source [Etheirys/XAT](https://github.com/Etheirys/XAT) toolkit
  (BSD-3-Clause; VC++ 2012 x86 prerequisites). Redistribution with a public package
  still needs a license review of its bundled Havok components plus version pinning;
  visibility of the private pinned copy does not clear that review. Until resolved,
  the product must not require the user to install or locate it.
- Deliverable route for P1/P2: keep the converter seam, but move batch decode into a
  software-invoked local component (bundled CLI invoked by the plugin, no Python, no
  user path entry), with per-file failure isolation already proven in
  `prepare_bound_actions.py` (failures recorded per action, library not rolled back).
  Reimplementing the narrow used subset (unwrap → per-entry split → keyframes) in-repo
  remains the fallback if XAT redistribution is blocked; measured decode volume makes
  this tractable (≤ ~730 shared ability PAPs + ≤ ~320 emote PAPs per store at the
  probed patterns, unique-key scope).
- Owner decision (does not block P1-A), re-framed from the corrected facts:
  (a) **stabilize the pinned toolchain** — the bytes demonstrably exist on this
  machine (15:07 view); pin them somewhere session-stable under owner control for
  development, rather than "re-provide from scratch";
  (b) approve the XAT bundling license review;
  (c) fund the in-repo decoder reimplementation.
  Any route still needs P1-B to actually run the converter and measure cost.

## 6. Measured batch-preparation cost (and what cannot be measured yet)

| Measurement | Value (scope stated) | Method |
|---|---|---|
| Index universe | 59 chunk indexes, 1,802,971 hash entries; load 0.69 s [a1] / 0.58 s [a2] | `loadAll()` |
| ActionTimeline catalog | 25,001 rows / 12,453 non-empty rows / 12,359 unique keys | Lumina offline dump [a1]; reproduced line-identical [a2] |
| TMB resolvable | rows 11,990/12,453 (96.3%); unique keys 11,896/12,359 (96.2%); unique contents 10,866 — 124 duplicate-content groups / 1,154 keys in groups / 1,030 redundant keys [a3, matches acceptance `independent-counts.json`]; full sweep 0 failures, 7.7 MB, 810 ms [a1] / 575 ms [a2] warm | three-scope sweep [a2]; corrected group scope [a3] |
| TMB structure | 290/300 sampled parsed, 0 parse failures; multi-C010 1%; non-zero flags 2%; per-file parse 0.19 ms — flags semantics not fully confirmed | `probe-tmb-structure.js` [a1, acc] |
| Ability PAP per store (bt_common, unique-key /892) | c0101 729; c1101 184; c0901 109; others 0–6 | hash-probe [a2] |
| Emote PAP per store (bt_common, unique-key /362) | c0101 316; c1101 293; c0901 293; others 138–226 (row-scope matrix incl. duplicates in `race-emote-matrix.json`) | hash-probe [a1][a2] |
| Keys missing from c0101 bt_common | 163 unique keys (164 rows); 0 in c0101 bt_unique; 0 in any other store's bt_common | [a2] |
| Single PAP/SKLB extract | 1–2 ms cold [a1]; 0.077–0.236 ms warm [acc] — environment-dependent | CLI extract |
| Havok decode + retarget per clip | **not measured this survey** — the converter binary was not visible in either P0 work session (§5) and was never executed; historical evidence (2026-09-12 runs) shows seconds-per-file through XAT subprocess with 45 s timeout | honest gap; P1-B fills it |

Dedup statement (R1 fix attempt 2, label correction attempt 3): rows, unique keys and
unique byte contents are reported as separate scopes everywhere above; no directory
entry count was ever used as animation coverage, and "dedupe by content path" applies
only where the table says *unique keys*. Content duplication uses the three-way split
**groups / keys-in-groups / redundant keys = 124 / 1,154 / 1,030** [a3]; the
attempt-2 result JSON field `duplicateContentGroups: 1030` in
`p0-rework-20260916-attempt2/rework-probe-result.json` is **mislabeled** (it counts
redundant keys) and is preserved unmodified as history — use
`p0-rework-20260916-attempt3/probe3-result.json` for the corrected field names.
Decode-output sha256 dedupe in `prepare_bound_actions.py` is a different
(decode-result) scope and remains as implemented.

## 7. Direct P1 inputs (next bounded packages)

Sequence (each independently gated; no unbounded mega-package):

1. **P1-A offline resource map** (task contract draft
   `.agent/tasks/TASK-20260916-SIMPLE-CHOREO-P1A.md` **r4 draft, awaiting Codex
   re-check**; r1 snapshot at
   `D:/choreo/p0-rework-20260916-attempt2/before/tasks__TASK-20260916-SIMPLE-CHOREO-P1A.md`,
   r2 snapshot at
   `D:/choreo/p0-rework-20260916-attempt3/before/tasks__TASK-20260916-SIMPLE-CHOREO-P1A.md`,
   r3 snapshot at
   `D:/choreo/p0-rework-20260916-attempt4/before/tasks__TASK-20260916-SIMPLE-CHOREO-P1A.md`;
   r4 closes the attempt-3 review residual R6-a/R6-b: per-Build store snapshot with
   fixed read counts (TMB=K, SKLB exactly once per store per Build, PAP=K×N
   unconditional), errorCounts event semantics (store-level SKLB errors not
   multiplied by keys), AC-06 split into five explicit Build sub-scenarios S1–S5
   (all-ok / one-store-error / success+error / all-missing / all-error) each with a
   control key and same-snapshot key-removal byte isolation, cross-scenario totals
   explicitly marked as aggregates, and unconditional per-store PAP probing unified
   with the non-goal wording so the K9 no-SKLB-hit detail is executable):
   pure plugin-side resolver module + coverage manifest
   (ActionTimeline → TMB → C010 → per-store PAP/SKLB presence), fixture-frozen tests
   from this survey, no new HTTP surface, no decode.
2. **P1-B decode seam revival**: restore a software-invoked converter path (owner
   picks the §5 route), decode N sampled clips across skeleton families, measure real
   per-clip cost and space (fills the unmeasured cell above).
3. **P1-C preparation queue + shared cache** on the P1-A/P1-B outputs with the
   plan §5.2 cache identity (content hashes + rule version + phase structure), then
   one-dancer end-to-end acceptance (the P1 user goal: select → auto-prepare → web
   play → close → offline reopen, zero file edits/binding/recording/scripts).

Blocking decision for the owner (does not block P1-A): choose the converter
deliverability route per §5 (stabilize pinned copy / XAT bundling license review /
in-repo decoder reimplementation). P1-A proceeds regardless.

## 8. Re-runnable commands, exit codes and fingerprints (attempt 3)

Working directory for Node probes: any; Node = `D:/nodejs/node.exe`; dotnet =
`C:/Users/xhz/AppData/Local/Microsoft/dotnet/dotnet.exe` (SDK 10.0.400). Game files
are opened read-only by `sqpack-extract.js`.

```powershell
# Attempt-3 R1 correction probe (corrected labels only; writes ONLY under attempt3;
# log comes from the redirection below — the script itself does not write a log file):
& D:/nodejs/node.exe D:/choreo/p0-rework-20260916-attempt3/probe3-r1-stats.js `
  > D:/choreo/p0-rework-20260916-attempt3/probe3-run.log 2>&1        # exit 0
#   → probe3-result.json (assertions 19/19 PASS vs fixed values and the acceptance
#     session's independent-counts.json), probe3-run.log

# Old evidence hash verification (attempt-1 review fingerprints 31/31 match;
# attempt-2 evidence list matches; r1 P1-A snapshot = 02b9933b…384dd):
& D:/nodejs/node.exe D:/choreo/p0-rework-20260916-attempt3/old-evidence-hash-check.js    # exit 0
#   → old-evidence-hash-check.json

# Lumina ActionTimeline export reproduction (R7; roll-forward is required — the
# csproj targets net8.0 while the local SDK is 10.0.400 — and is part of the command).
# Run from the attempt-3 byte-identical project copy (attempt2 originals untouched):
$env:DOTNET_ROLL_FORWARD = 'Major'
& 'C:/Users/xhz/AppData/Local/Microsoft/dotnet/dotnet.exe' run --project D:/choreo/p0-rework-20260916-attempt3/lumina-export/lumina-export.csproj -c Release `
  -- D:/choreo/p0-rework-20260916-attempt3/actiontimeline-repro-attempt3.tsv `
  > D:/choreo/p0-rework-20260916-attempt3/lumina-rerun-attempt3.log 2>&1   # exit 0
#   API: GameData.Excel.GetBaseSheet(Lumina.Excel.Sheets.ActionTimeline, null, "ActionTimeline")
#   → "ROWS 25001 NONEMPTY 12453" (MSB3277 warnings, same as acceptance; harmless).
#   Repro TSV: 25,001 lines, line-identical to p0-scan-20260916/actiontimeline.tsv
#   (normalized diff exit 0). NOT byte-identical: original is CRLF, export is LF;
#   export sha256 e11d8750… equals the attempt-2 repro exactly. See
#   attempt3/lumina-diff-attempt3.txt.
Remove-Item Env:DOTNET_ROLL_FORWARD   # restore the session environment

# Attempt-2 probe2 — historical note (attempt-3 correction): the attempt-2 run was
# exit 0 and its probe2-run.log was produced by SHELL REDIRECTION of this command
# (the script itself writes only the result JSON and sklb/ — a bare invocation
# produces no log file). DO NOT re-run as-is: it would overwrite attempt2 evidence
# (rework-probe-result.json, sklb/). For re-verification use probe3 above, or
# intercept writeFileSync in memory as the acceptance session did.
# & D:/nodejs/node.exe D:/choreo/p0-rework-20260916-attempt2/probe2-rework-evidence.js `
#   *> D:/choreo/p0-rework-20260916-attempt2/probe2-run.log               # exit 0 (2026-09-16)

# Attempt-1 probes remain runnable unmodified (read-only; they rewrite their own
# JSON only via writeFileSync — point them at the old directory or intercept as the
# acceptance session did):
& D:/nodejs/node.exe D:/choreo/p0-scan-20260916/probe-ability.js                          # exit 0
& D:/nodejs/node.exe D:/choreo/p0-scan-20260916/probe-skeletons.js                        # exit 0
& D:/nodejs/node.exe D:/choreo/p0-scan-20260916/probe-tmb-structure.js                    # exit 0
```

Fingerprints: attempt-1 delivered-hash list `p0-scan-20260916/deliver-hashes.txt`
(stale for the report — see task §4) and the acceptance input hashes
`D:/choreo/p0-acceptance-20260916-attempt1/review-input-hashes.json` are preserved
unchanged (31/31 evidence entries re-verified in attempt 3). Attempt-2 pre-edit
baselines: `p0-rework-20260916-attempt2/baseline-hashes.txt` + `before/` byte copies;
that list omitted the CONTINUITY copy — its hash is supplemented (without editing the
old list) in `p0-rework-20260916-attempt3/baseline-hashes-attempt2-supplement.txt`.
Attempt-2 final tested hashes: `p0-rework-20260916-attempt2/deliver-hashes-attempt2.txt`.
Attempt-3 pre-edit baselines (all 5 authorized files, including CONTINUITY):
`p0-rework-20260916-attempt3/baseline-hashes-attempt3.txt` + `before/`; attempt-3
final tested hashes: `p0-rework-20260916-attempt3/deliver-hashes-attempt3.txt`.
PROGRESS.md is not git-tracked (git ls-files exits 1 for it); its increments are
documented against `before/` byte copies, never against the git index.
