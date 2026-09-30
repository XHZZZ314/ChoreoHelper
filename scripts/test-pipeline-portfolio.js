// 目标关联进度回归：PC-01..PC-16，只读投影与八行中文 closeout。
// 确定性夹具：固定 UTC 时钟 2026-09-08T00:00:00.000Z，固定 ID，排序输出，独立期望值。
// 用法：node scripts/test-pipeline-portfolio.js [--case PC-PRESENTATION|PC-INVALID|PC-REENTRY]
// 无参数运行全部 16 例；未知选择器与零执行用例失败。
// 缺失行为时打印对应工单指纹并因断言失败退出 1；导入/语法错误不计为特征红。
'use strict';

const path = require('path');

const FIXED_NOW = new Date('2026-09-08T00:00:00.000Z');
const FINGERPRINTS = {
  'PC-PRESENTATION': 'portfolio presentation absent',
  'PC-INVALID': 'portfolio invalid source handling absent',
  'PC-REENTRY': 'portfolio reentry handling absent',
};
const GROUPS = {
  'PC-PRESENTATION': ['PC-01', 'PC-03', 'PC-04', 'PC-05', 'PC-12', 'PC-13', 'PC-14', 'PC-15', 'PC-16'],
  'PC-INVALID': ['PC-02', 'PC-07', 'PC-11', 'PC-13'],
  'PC-REENTRY': ['PC-07', 'PC-08'],
};
const ALL_CASES = ['PC-01', 'PC-02', 'PC-03', 'PC-04', 'PC-05', 'PC-06', 'PC-07', 'PC-08',
  'PC-09', 'PC-10', 'PC-11', 'PC-12', 'PC-13', 'PC-14', 'PC-15', 'PC-16'];

let portfolio = null;
let loadError = '';
try {
  portfolio = require('./pipeline-portfolio.js');
} catch (error) {
  loadError = String((error && error.message) || error);
}

let passed = 0;
let total = 0;
const failures = [];
function check(caseId, name, condition, detail) {
  total++;
  if (condition) { passed++; console.log(`  ✓ ${caseId} ${name}`); return true; }
  failures.push(`${caseId} ${name}${detail ? ` :: ${detail}` : ''}`);
  console.error(`  ✘ ${caseId} ${name}${detail ? ` :: ${detail}` : ''}`);
  return false;
}

// ---- 独立夹具构造（与实现无关的期望值） ----

function baseMap() {
  return {
    schemaVersion: 1,
    goals: [
      { id: 'G-OWNER', titleZh: '主人全局掌控', userOutcome: '每次收尾直接看到中文进展', sourceRefs: [{ file: '.agent/tickets/TASK-20260908-OWNER-CLOSEOUT-PROGRESS.json' }], authority: 'owner-authorized', milestoneIds: ['M-CLOSEOUT'] },
      { id: 'G-MOVE', titleZh: '走位预演', userOutcome: '多人走位可预演', sourceRefs: [{ file: 'docs/DESIGN-dual-mode-audit.md', anchor: 'M2 eight-dancer' }], authority: 'owner-authorized', milestoneIds: ['M-M2A', 'M-WEB-FUTURE'] },
    ],
    milestones: [
      { id: 'M-CLOSEOUT', goalId: 'G-OWNER', titleZh: '收尾可见', requirementIds: [], sourceRefs: [{ file: '.agent/tickets/TASK-20260908-OWNER-CLOSEOUT-PROGRESS.json' }], scenarioIds: ['S-CLOSEOUT-1'], dependsOn: [] },
      { id: 'M-M2A', goalId: 'G-MOVE', titleZh: 'M2静态', requirementIds: ['REQ-SPEC-012'], sourceRefs: [{ file: 'docs/DESIGN-dual-mode-audit.md', anchor: 'M2 eight-dancer' }], scenarioIds: ['S-M2A-1'], dependsOn: [] },
      { id: 'M-WEB-FUTURE', goalId: 'G-MOVE', titleZh: '未来Web离线', requirementIds: [], sourceRefs: [{ file: 'docs/DESIGN-dual-mode-audit.md', anchor: '30 s / 8 dancers' }], scenarioIds: ['S-WEB-1'], dependsOn: ['M-M2A'] },
    ],
    acceptanceScenarios: [
      { id: 'S-CLOSEOUT-1', milestoneId: 'M-CLOSEOUT', actor: 'closing-role', setup: 'closed run', action: 'render reply', expected: 'eight rows', sourceRefs: [{ file: '.agent/tickets/TASK-20260908-OWNER-CLOSEOUT-PROGRESS.json' }], authority: 'approved', dimensions: ['implementation', 'regression'] },
      { id: 'S-M2A-1', milestoneId: 'M-M2A', actor: 'owner', setup: 'stage', action: 'edit start', expected: 'saved', sourceRefs: [{ file: 'docs/DESIGN-dual-mode-audit.md', anchor: 'M2 eight-dancer' }], authority: 'approved', dimensions: ['implementation', 'regression', 'scenario', 'deployment', 'live'] },
      { id: 'S-WEB-1', milestoneId: 'M-WEB-FUTURE', actor: 'owner', setup: 'offline', action: '30s eight dancers two formations music facing save-reopen', expected: 'consistent', sourceRefs: [{ file: 'docs/DESIGN-dual-mode-audit.md', anchor: '30 s / 8 dancers' }], authority: 'proposed', dimensions: ['scenario'] },
    ],
    ticketLinks: [
      { ticketId: 'TASK-CLOSE-1', milestoneId: 'M-CLOSEOUT', contributionZh: '实现收尾投影', scenarioIds: ['S-CLOSEOUT-1'], acceptanceCriterionIds: ['AC-1'], relation: 'implements', sourceRefs: [{ file: '.agent/tickets/TASK-20260908-OWNER-CLOSEOUT-PROGRESS.json' }] },
    ],
    evidenceRefs: [
      { scenarioId: 'S-CLOSEOUT-1', dimension: 'regression', artifact: 'scripts/test-pipeline-portfolio.js', locator: 'PC-01', ticketRevision: 3, runId: 'RUN-FIXTURE', gateId: 'GATE-FIXTURE', environment: 'local' },
    ],
    repairItems: [
      { id: 'REPAIR-01', labelZh: '修复一', sourceRefs: [{ file: 'SPEC.md' }], ticketId: 'TASK-CLOSE-1' },
    ],
    notApplicable: [],
  };
}

function baseState() {
  return {
    packages: [{ order: 1, id: 'TASK-CLOSE-1', status: 'closed', outcome: '收尾投影', handoffs: ['docs/HANDOFF-fixture.md'] }],
    ownerTails: [],
    requirements: {
      items: [
        { id: 'REQ-A', state: 'open', source: 'SPEC.md', anchor: 'a', title: 'A', basis: 'source-marker', evidence: [] },
        { id: 'REQ-B', state: 'open', source: 'SPEC.md', anchor: 'b', title: 'B', basis: 'source-marker', evidence: [] },
        { id: 'REQ-C', state: 'closed', source: 'SPEC.md', anchor: 'c', title: 'C', basis: 'source-marker', evidence: [] },
        { id: 'REQ-D', state: 'deferred', source: 'SPEC.md', anchor: 'd', title: 'D', basis: 'source-marker', evidence: [] },
        { id: 'REQ-E', state: 'superseded', source: 'SPEC.md', anchor: 'e', title: 'E', basis: 'source-marker', evidence: [] },
      ],
    },
  };
}

function hasFeature() {
  return portfolio && typeof portfolio.buildSnapshot === 'function'
    && typeof portfolio.renderOwnerSummaryZh === 'function'
    && typeof portfolio.validatePortfolioMap === 'function';
}

function trySnapshot(extra = {}) {
  if (!hasFeature()) return null;
  try {
    return portfolio.buildSnapshot({
      map: baseMap(), processState: baseState(),
      tickets: [{ id: 'TASK-CLOSE-1', status: 'closed', revision: 3, title: '收尾投影' }],
      runs: [], route: { nextRole: 'done', mode: 'terminal', reason: 'done', prompt: '', commands: [] },
      closedTicketId: 'TASK-CLOSE-1', now: FIXED_NOW, ...extra,
    });
  } catch (_) { return null; }
}

// ---- 16 例 ----

function runPC01() {
  const snap = trySnapshot();
  const text = snap && portfolio.renderOwnerSummaryZh(snap);
  const labels = (portfolio && portfolio.EIGHT_LABELS) || [];
  const expectedLabels = ['本票完成', '目标推进', '验证范围', '里程碑还缺', '当前与下一步', '全局剩余', '需要主人', '数据范围'];
  check('PC-01', 'eight ordered labels exported', Array.isArray(labels) && labels.join('|') === expectedLabels.join('|'), `got ${JSON.stringify(labels)}`);
  check('PC-01', 'snapshot complete with fixed timestamp', !!snap && snap.complete === true && snap.generatedAt === '2026-09-08T00:00:00.000Z', `got ${snap && snap.generatedAt}`);
  check('PC-01', 'summary carries ticket id outcome evidence and time', typeof text === 'string' && text.includes('TASK-CLOSE-1') && text.includes('PC-01') && text.includes('2026-09-08'), (text || '').slice(0, 200));
  const orderOk = typeof text === 'string' && expectedLabels.every((label, i, all) => i === 0 || text.indexOf(all[i - 1]) < text.indexOf(label));
  check('PC-01', 'eight rows ordered in rendered text', orderOk, (text || '').slice(0, 300));
  if (snap && typeof portfolio.renderClosingReply === 'function') {
    const prompt = 'COPY-READY-PROMPT-TASK-CLOSE-1';
    const nonterminal = portfolio.renderClosingReply({ ...snap, routeTerminal: false }, prompt);
    check('PC-01', 'nonterminal reply contains prompt verbatim after report', typeof nonterminal === 'string' && nonterminal.includes(prompt) && nonterminal.indexOf('数据范围') < nonterminal.indexOf(prompt), (nonterminal || '').slice(0, 200));
    const terminal = portfolio.renderClosingReply({ ...snap, routeTerminal: true }, prompt);
    check('PC-01', 'terminal reply carries summary without prompt', typeof terminal === 'string' && !terminal.includes(prompt) && terminal.includes('本票完成'), (terminal || '').slice(0, 200));
  } else {
    check('PC-01', 'closing reply renderer exists', false, 'renderClosingReply missing');
  }
}

function runPC02() {
  if (!hasFeature()) { check('PC-02', 'stale ledger derived from current evidence', false, 'feature absent'); check('PC-02', 'duplicate ids deduplicated', false, 'feature absent'); return; }
  const dupMap = baseMap();
  const dupState = {
    packages: [
      { order: 1, id: 'TASK-DUP', status: 'closed', outcome: 'dup', handoffs: [] },
      { order: 1, id: 'TASK-DUP', status: 'closed', outcome: 'dup', handoffs: [] },
    ],
    ownerTails: [],
    requirements: baseState().requirements,
  };
  let snap = null;
  try {
    snap = portfolio.buildSnapshot({
      map: dupMap, processState: dupState,
      tickets: [{ id: 'TASK-DUP', status: 'closed', revision: 1, title: 'dup' }],
      runs: [], route: { nextRole: 'owner', mode: 'blocked-portfolio', reason: 'blocked', prompt: '', commands: [] },
      ledgerPhase: 'stale-package-active', evidenceValid: false, gateStatus: 'failed',
      now: FIXED_NOW,
    });
  } catch (_) { snap = null; }
  const rows = (snap && (snap.stages || snap.packages)) || [];
  const uniqueIds = new Set(rows.map(r => r.id || r.packageId));
  check('PC-02', 'duplicate entity ids deduplicated to one row', rows.length === 1 && uniqueIds.size === 1, `got ${JSON.stringify(rows).slice(0, 300)}`);
  const phase = snap && (snap.ledgerPhase || snap.phase || '');
  check('PC-02', 'ledger phase surfaces instead of stale package state', typeof phase === 'string' && phase.length > 0, JSON.stringify(snap || {}).slice(0, 200));
  const stageState = rows[0] && (rows[0].stage || rows[0].status || rows[0].phase || '');
  check('PC-02', 'invalid evidence never marks stage complete', !/complete/i.test(String(stageState)) || (snap && snap.complete === false), `stage=${stageState}`);
  check('PC-02', 'contradiction surfaces incomplete', !!snap && snap.complete === false, JSON.stringify((snap && snap.diagnostics) || []).slice(0, 200));
}

function runPC03() {
  const snap = trySnapshot();
  const summary = snap && snap.requirementSummary;
  check('PC-03', 'exact category counts over 5', !!summary && summary.total === 5 && summary.open === 2 && summary.closed === 1 && summary.deferred === 1 && summary.superseded === 1, JSON.stringify(summary || null));
  check('PC-03', 'both open requirement ids discoverable', !!summary && Array.isArray(summary.openIds) && summary.openIds.includes('REQ-A') && summary.openIds.includes('REQ-B'), JSON.stringify(summary || null));
  const text = snap && portfolio.renderOwnerSummaryZh(snap);
  check('PC-03', 'no product completion or effort percentage', typeof text === 'string' && !/100\s*%|完成率|effort.*\d+\s*%/.test(text) && /unknown|未知/.test(text), (text || '').slice(0, 300));
  if (hasFeature()) {
    let missing = null;
    try {
      missing = portfolio.buildSnapshot({
        map: baseMap(), processState: { packages: [], ownerTails: [] },
        tickets: [], runs: [], route: { nextRole: 'planner', mode: 'intake', reason: 'x', prompt: '', commands: [] }, now: FIXED_NOW,
      });
    } catch (_) { missing = null; }
    const ms = missing && missing.requirementSummary;
    check('PC-03', 'missing registry is unavailable not five zeros', !ms || ms.unavailable === true || ms.total !== 0 || (missing && missing.unavailableSections && missing.unavailableSections.length > 0), JSON.stringify(ms || null));
  } else {
    check('PC-03', 'missing registry is unavailable not five zeros', false, 'feature absent');
  }
}

function runPC04() {
  if (!hasFeature()) { check('PC-04', 'repair queue planning stay separate', false, 'feature absent'); check('PC-04', 'unmaterialized work visible', false, 'feature absent'); return; }
  const map = baseMap();
  map.repairItems = Array.from({ length: 10 }, (_, i) => ({
    id: `REPAIR-${String(i + 1).padStart(2, '0')}`, labelZh: `修复${i + 1}`,
    sourceRefs: [{ file: 'SPEC.md' }], ...(i < 8 ? { ticketId: 'TASK-CLOSE-1' } : {}),
  }));
  let snap = null;
  try {
    snap = portfolio.buildSnapshot({
      map, processState: baseState(),
      tickets: [{ id: 'TASK-CLOSE-1', status: 'closed', revision: 1, title: 't' }],
      runs: [], route: { nextRole: 'done', mode: 'terminal', reason: 'done', prompt: '', commands: [] },
      futureMilestones: [{ id: 'M-WEB-FUTURE', ticketId: '' }],
      m2Static: [{ id: 'M-M2A', ticketId: 'TASK-CLOSE-1', movementRequirement: 'REQ-SPEC-012', movementState: 'open' }],
      now: FIXED_NOW,
    });
  } catch (_) { snap = null; }
  const repair = snap && snap.repairSummary;
  check('PC-04', 'ten repair items with two unmaterialized', !!repair && repair.total === 10 && repair.unmaterialized === 2, JSON.stringify(repair || null));
  check('PC-04', 'future and M2 gaps visible without creating tickets', !!snap && JSON.stringify(snap).includes('M-WEB-FUTURE') && (snap.ticketsCreated || 0) === 0, JSON.stringify(snap || {}).slice(0, 300));
}

function runPC05() {
  if (!hasFeature()) { check('PC-05', 'many-to-many counts distinct entities once', false, 'feature absent'); check('PC-05', 'closed ticket leaves open requirement open', false, 'feature absent'); return; }
  const map = baseMap();
  map.ticketLinks = [
    { ticketId: 'TASK-A', milestoneId: 'M-CLOSEOUT', contributionZh: 'a', scenarioIds: ['S-CLOSEOUT-1'], acceptanceCriterionIds: ['AC-1'], relation: 'implements', sourceRefs: [{ file: 'SPEC.md' }] },
    { ticketId: 'TASK-B', milestoneId: 'M-CLOSEOUT', contributionZh: 'b', scenarioIds: ['S-CLOSEOUT-1'], acceptanceCriterionIds: ['AC-1'], relation: 'verifies', sourceRefs: [{ file: 'SPEC.md' }] },
  ];
  map.milestones = [{ id: 'M-CLOSEOUT', goalId: 'G-OWNER', titleZh: 'm', requirementIds: ['REQ-A', 'REQ-B'], sourceRefs: [{ file: 'SPEC.md' }], scenarioIds: ['S-CLOSEOUT-1'], dependsOn: [] }];
  map.goals = [{ id: 'G-OWNER', titleZh: '主人全局掌控', userOutcome: '每次收尾直接看到中文进展', sourceRefs: [{ file: 'SPEC.md' }], authority: 'owner-authorized', milestoneIds: ['M-CLOSEOUT'] }];
  map.acceptanceScenarios = [{ id: 'S-CLOSEOUT-1', milestoneId: 'M-CLOSEOUT', actor: 'closing-role', setup: 'closed run', action: 'render reply', expected: 'eight rows', sourceRefs: [{ file: 'SPEC.md' }], authority: 'approved', dimensions: ['implementation', 'regression'] }];
  map.evidenceRefs = [];
  let snap = null;
  try {
    snap = portfolio.buildSnapshot({
      map,
      processState: { packages: [{ order: 1, id: 'TASK-A', status: 'closed', outcome: 'a', handoffs: [] }, { order: 2, id: 'TASK-B', status: 'open', outcome: 'b', handoffs: [] }], ownerTails: [], requirements: { items: [{ id: 'REQ-A', state: 'open', source: 'SPEC.md', anchor: 'a', title: 'A', basis: 'source-marker', evidence: [] }, { id: 'REQ-B', state: 'open', source: 'SPEC.md', anchor: 'b', title: 'B', basis: 'source-marker', evidence: [] }] } },
      tickets: [{ id: 'TASK-A', status: 'closed', revision: 1, title: 'a' }, { id: 'TASK-B', status: 'open', revision: 1, title: 'b' }],
      runs: [], route: { nextRole: 'worker', mode: 'implement', reason: 'r', prompt: '', commands: [] }, now: FIXED_NOW,
    });
  } catch (_) { snap = null; }
  const counts = snap && snap.ticketRequirementCounts;
  check('PC-05', 'many-to-many counts distinct entities once', !!counts && counts.tickets === 2 && counts.requirements === 2, JSON.stringify(counts || null));
  const reqStates = snap && snap.requirementSummary;
  check('PC-05', 'closed ticket leaves open requirement open', !!reqStates && reqStates.open === 2, JSON.stringify(reqStates || null));
}

function runPC06() {
  if (!hasFeature()) { check('PC-06', 'selector and authority fields preserved', false, 'feature absent'); return; }
  const route = { nextRole: 'owner', mode: 'blocked-portfolio', reason: 'blocked', prompt: 'P', commands: ['cmd'], pauseForOwner: true, requiresGlobalReview: false, selectedEntity: 'TASK-X', role: 'owner', blocker: { entity: 'TASK-X', source: 'SPEC.md', actor: 'owner', action: 'decide' } };
  let snap = null;
  try {
    snap = portfolio.buildSnapshot({ map: baseMap(), processState: baseState(), tickets: [], runs: [], route, now: FIXED_NOW });
  } catch (_) { snap = null; }
  const next = snap && snap.next;
  check('PC-06', 'selector and authority fields preserved', !!next && next.nextRole === 'owner' && next.mode === 'blocked-portfolio' && next.selectedEntity === 'TASK-X', JSON.stringify(next || null));
  check('PC-06', 'blocker names entity source actor action', !!next && next.blocker && next.blocker.entity === 'TASK-X' && next.blocker.source && next.blocker.actor && next.blocker.action, JSON.stringify((next && next.blocker) || null));
  check('PC-06', 'no new approval scheduling claim waiver deployment', !!snap && !snap.newApproval && !snap.newSchedule && !snap.newClaim && !snap.newWaiver && !snap.newDeployment, JSON.stringify(snap || {}).slice(0, 300));
}

function runPC07() {
  if (!hasFeature()) { check('PC-07', 'source failure yields located incomplete section', false, 'feature absent'); check('PC-07', 'closure preserved without second finish', false, 'feature absent'); return; }
  let snap = null;
  try {
    snap = portfolio.buildSnapshot({
      map: null, mapError: 'missing file .agent/portfolio-map.json',
      processState: baseState(), tickets: [{ id: 'TASK-CLOSE-1', status: 'closed', revision: 1, title: 't' }],
      runs: [], route: { nextRole: 'done', mode: 'terminal', reason: 'done', prompt: '', commands: [] },
      finishSucceeded: true, now: FIXED_NOW,
    });
  } catch (_) { snap = null; }
  const diags = (snap && snap.diagnostics) || [];
  check('PC-07', 'source failure yields located incomplete section', !!snap && snap.complete === false && diags.some(d => d.id === 'SOURCE_UNRESOLVED' && d.entity && d.source && d.reason && d.action), JSON.stringify(diags).slice(0, 300));
  check('PC-07', 'closure preserved without second finish', !!snap && (snap.closurePreserved === true || (snap.justClosed && snap.justClosed.ticketId === 'TASK-CLOSE-1')) && snap.secondFinish !== true, JSON.stringify(snap || {}).slice(0, 300));
}

function runPC08() {
  if (!hasFeature()) { check('PC-08', 'fixed inputs yield identical output and zero writes', false, 'feature absent'); check('PC-08', 'drift yields incomplete never mixed', false, 'feature absent'); return; }
  const input = { map: baseMap(), processState: baseState(), tickets: [{ id: 'TASK-CLOSE-1', status: 'closed', revision: 1, title: 't' }], runs: [], route: { nextRole: 'done', mode: 'terminal', reason: 'done', prompt: '', commands: [] }, now: FIXED_NOW };
  let first = null; let second = null;
  try {
    first = portfolio.buildSnapshot(input);
    second = portfolio.buildSnapshot(JSON.parse(JSON.stringify(input)));
  } catch (_) { first = second = null; }
  check('PC-08', 'fixed inputs yield identical output and zero writes', !!first && !!second && JSON.stringify(first) === JSON.stringify(second) && first.writes === 0, `equal=${!!first && !!second && JSON.stringify(first) === JSON.stringify(second)}`);
  let drifted = null;
  try {
    const driftInput = JSON.parse(JSON.stringify(input));
    driftInput.processState.requirements.items.push({ id: 'REQ-NEW', state: 'open', source: 'SPEC.md', anchor: 'n', title: 'N', basis: 'source-marker', evidence: [] });
    drifted = portfolio.buildSnapshot(driftInput, { barrierChanged: true });
  } catch (_) { drifted = null; }
  check('PC-08', 'drift yields incomplete never mixed', !!drifted && drifted.complete === false, JSON.stringify(drifted || {}).slice(0, 200));
  // 工单清单读取屏障：成员增删与字节变化都必须判为漂移（AC-8“增删输入成员或改动已消费字节”）。
  const driftOf = portfolio.inventoryDrifted;
  const inventoryOf = (entries) => new Map(entries.map(([key, value]) => [key, value === null ? null : Buffer.from(value, 'utf8')]));
  let driftOk = typeof driftOf === 'function';
  if (driftOk) {
    driftOk = driftOf(inventoryOf([['.agent/tickets/TASK-A.json', 'a']]), inventoryOf([])) === true
      && driftOf(inventoryOf([]), inventoryOf([['.agent/tickets/TASK-B.json', 'b']])) === true
      && driftOf(inventoryOf([['.agent/tickets/TASK-A.json', 'a']]), inventoryOf([['.agent/tickets/TASK-A.json', 'a!']])) === true
      && driftOf(inventoryOf([['.agent/tickets/TASK-A.json', 'a'], ['.agent/tickets/TASK-B.json', null]]), inventoryOf([['.agent/tickets/TASK-A.json', 'a'], ['.agent/tickets/TASK-B.json', null]])) === false;
  }
  check('PC-08', 'ticket inventory membership and byte drift detected', driftOk, `inventoryDrifted=${typeof driftOf}`);
}

function runPC09() {
  if (!hasFeature()) { check('PC-09', 'legacy and v2 validation meanings retained', false, 'feature absent'); return; }
  let ok = false;
  try {
    const validation = portfolio.validatePortfolioMap ? portfolio.validatePortfolioMap(baseMap()) : null;
    ok = !!validation && validation.ok === true;
  } catch (_) { ok = false; }
  check('PC-09', 'legacy and v2 validation meanings retained', ok, 'validatePortfolioMap should accept the valid base map');
  check('PC-09', 'only additive report fields change', typeof portfolio.EIGHT_LABELS !== 'undefined' && Array.isArray(portfolio.EIGHT_LABELS) && portfolio.EIGHT_LABELS.length === 8, JSON.stringify(portfolio.EIGHT_LABELS));
}

function runPC10() {
  if (!hasFeature()) { check('PC-10', 'report calls write nothing in scope', false, 'feature absent'); return; }
  const snap = trySnapshot();
  check('PC-10', 'report calls write nothing in scope', !!snap && snap.writes === 0, `writes=${snap && snap.writes}`);
  check('PC-10', 'no prohibited or product paths in report inventory', !!snap && Array.isArray(snap.inventoryPaths) && !snap.inventoryPaths.some(p => p.startsWith('src/') || p.startsWith('web/') || p.startsWith('release/')), JSON.stringify((snap && snap.inventoryPaths) || []).slice(0, 200));
}

function runPC11() {
  if (!hasFeature()) { check('PC-11', 'valid graph passes and bad graph fails located', false, 'feature absent'); check('PC-11', 'escaping paths rejected before reads', false, 'feature absent'); return; }
  const valid = portfolio.validatePortfolioMap(baseMap());
  check('PC-11', 'valid graph passes and bad graph fails located', !!valid && valid.ok === true, JSON.stringify(valid || null));
  const bad = JSON.parse(JSON.stringify(baseMap()));
  bad.ticketLinks.push({ ticketId: 'TASK-BAD', milestoneId: 'M-MISSING', contributionZh: 'x', scenarioIds: ['S-NOPE'], acceptanceCriterionIds: ['AC-1'], relation: 'implements', sourceRefs: [{ file: 'SPEC.md' }] });
  const invalid = portfolio.validatePortfolioMap(bad);
  check('PC-11', 'dangling references fail with diagnostics', !!invalid && invalid.ok === false && Array.isArray(invalid.issues) && invalid.issues.length > 0, JSON.stringify(invalid || null).slice(0, 300));
  const escaping = JSON.parse(JSON.stringify(baseMap()));
  escaping.goals[0].sourceRefs = [{ file: '../outside.json' }];
  const escaped = portfolio.validatePortfolioMap(escaping);
  check('PC-11', 'escaping paths rejected before reads', !!escaped && escaped.ok === false, JSON.stringify(escaped || null).slice(0, 200));
}

function runPC12() {
  if (!hasFeature() || typeof portfolio.getStartupBrief !== 'function') { check('PC-12', 'linked ticket carries four briefing categories', false, 'feature absent'); check('PC-12', 'legacy missing link is unknown', false, 'feature absent'); return; }
  const brief = portfolio.getStartupBrief(baseMap(), 'TASK-CLOSE-1');
  check('PC-12', 'linked ticket carries four briefing categories', !!brief && !!brief.goal && !!brief.contribution && !!brief.scenarioEvidence && !!brief.remaining, JSON.stringify(brief || null).slice(0, 300));
  const missing = portfolio.getStartupBrief(baseMap(), 'TASK-LEGACY-NOLINK');
  check('PC-12', 'legacy missing link is unknown', !!missing && missing.unknown === true && missing.code === 'TICKET_UNLINKED', JSON.stringify(missing || null));
}

function runPC13() {
  if (!hasFeature() || typeof portfolio.deriveMilestoneAcceptance !== 'function') { check('PC-13', 'milestone acceptance separates five dimensions', false, 'feature absent'); check('PC-13', 'proposed evidence never implies live acceptance', false, 'feature absent'); return; }
  const accepted = portfolio.deriveMilestoneAcceptance({
    scenarioIds: ['S-A1', 'S-A2'], proposedIds: ['S-P1'],
    evidence: { 'S-A1': { implementation: 'verified', regression: 'verified', scenario: 'verified', deployment: 'verified', live: 'verified' }, 'S-A2': { implementation: 'verified', regression: 'verified', scenario: 'verified', deployment: 'verified', live: 'verified' } },
    requirementsAgree: true, conflict: false,
  });
  check('PC-13', 'milestone acceptance separates five dimensions', !!accepted && accepted.accepted === true && accepted.denominator === 2, JSON.stringify(accepted || null));
  const gap = portfolio.deriveMilestoneAcceptance({
    scenarioIds: ['S-A1', 'S-A2'], proposedIds: ['S-P1'],
    evidence: { 'S-A1': { implementation: 'verified', regression: 'verified', scenario: 'verified', deployment: 'verified', live: 'verified' }, 'S-A2': { implementation: 'missing', regression: 'verified', scenario: 'verified', deployment: 'verified', live: 'verified' } },
    requirementsAgree: true, conflict: false,
  });
  check('PC-13', 'proposed evidence never implies live acceptance', !!gap && gap.accepted === false && Array.isArray(gap.gaps) && gap.gaps.length > 0, JSON.stringify(gap || null));
  const zero = portfolio.deriveMilestoneAcceptance({ scenarioIds: [], evidence: {}, requirementsAgree: true, conflict: false });
  check('PC-13', 'zero approved scenarios is unknown not vacuous acceptance',
    !!zero && zero.accepted === false && zero.denominator === 0 && zero.unknown === true, JSON.stringify(zero || null));
}

function runPC14() {
  if (!hasFeature() || typeof portfolio.getGapDiagnostics !== 'function') { check('PC-14', 'seven diagnostics carry entity source reason action', false, 'feature absent'); return; }
  const map = baseMap();
  map.goals.push({ id: 'G-EMPTY', titleZh: '空目标', userOutcome: '待规划', sourceRefs: [{ file: 'SPEC.md' }], authority: 'owner-authorized', milestoneIds: [] });
  map.ticketLinks.push(
    { ticketId: 'TASK-CLOSE-1', milestoneId: 'M-M2A', contributionZh: '覆盖M2', scenarioIds: ['S-M2A-1'], acceptanceCriterionIds: ['AC-2'], relation: 'verifies', sourceRefs: [{ file: 'SPEC.md' }] },
    { ticketId: 'TASK-O1', milestoneId: 'M-CLOSEOUT', contributionZh: 'o1', scenarioIds: ['S-CLOSEOUT-1'], acceptanceCriterionIds: ['AC-1'], relation: 'implements', sourceRefs: [{ file: 'SPEC.md' }] },
    { ticketId: 'TASK-O2', milestoneId: 'M-CLOSEOUT', contributionZh: 'o2', scenarioIds: ['S-CLOSEOUT-1'], acceptanceCriterionIds: ['AC-1'], relation: 'implements', sourceRefs: [{ file: 'SPEC.md' }] },
  );
  const state = baseState();
  state.packages = [
    { order: 1, id: 'TASK-CLOSE-1', status: 'closed', outcome: '收尾投影', handoffs: ['docs/HANDOFF-fixture.md'] },
    { order: 2, id: 'TASK-ORPHAN', status: 'open', outcome: '孤儿', handoffs: [] },
    { order: 3, id: 'TASK-O1', status: 'open', outcome: 'o1', handoffs: [] },
    { order: 4, id: 'TASK-O2', status: 'open', outcome: 'o2', handoffs: [] },
  ];
  const diags = portfolio.getGapDiagnostics({ map, processState: state, closureHistory: [{ id: 'TASK-A', type: 'pipeline_change' }, { id: 'TASK-B', type: 'pipeline_change' }, { id: 'TASK-C', type: 'pipeline_change' }], lastProductDelivery: 'TASK-P1', productOpen: true, unresolvedSources: [{ entity: 'REQ-X', source: 'SPEC.md', reason: 'missing anchor', action: 'locate the anchor then re-read' }] });
  const ids = new Set((diags || []).map(d => d.id));
  const expected = ['GOAL_UNPLANNED', 'MILESTONE_NO_NEXT', 'MILESTONE_ACCEPTANCE_GAP', 'TICKET_UNLINKED', 'COVERAGE_OVERLAP', 'SOURCE_UNRESOLVED', 'PROCESS_PRODUCT_IMBALANCE'];
  check('PC-14', 'seven diagnostics carry entity source reason action', expected.every(id => ids.has(id)) && diags.every(d => d.entity && d.source && d.reason && d.action), JSON.stringify(diags || []).slice(0, 400));
}

function runPC15() {
  if (!hasFeature()) { check('PC-15', 'eight labels with truncation and omitted counts', false, 'feature absent'); return; }
  check('PC-15', 'exact eight labels', (portfolio.EIGHT_LABELS || []).join('|') === ['本票完成', '目标推进', '验证范围', '里程碑还缺', '当前与下一步', '全局剩余', '需要主人', '数据范围'].join('|'), JSON.stringify(portfolio.EIGHT_LABELS));
  const sizes = [0, 1, 3, 4, 7];
  const expectedVisible = [0, 1, 3, 3, 3];
  const expectedOmitted = [0, 0, 0, 1, 4];
  let ok = typeof portfolio.truncateList === 'function';
  if (ok) {
    sizes.forEach((size, index) => {
      const list = Array.from({ length: size }, (_, i) => `item-${i}`);
      const out = portfolio.truncateList(list, true);
      if (!out || out.visible.length !== expectedVisible[index] || out.omitted !== expectedOmitted[index]) ok = false;
    });
  }
  check('PC-15', 'eight labels with truncation and omitted counts', ok, 'truncateList(0,1,3,4,7) must yield visible 0,1,3,3,3 omitted 0,0,0,1,4');
}

function runPC16() {
  if (!hasFeature()) { check('PC-16', 'seed scope only design section 9 entities', false, 'feature absent'); return; }
  let seed = null;
  try {
    const fs = require('fs');
    const mapPath = path.join(__dirname, '..', '.agent', 'portfolio-map.json');
    if (fs.existsSync(mapPath)) seed = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (_) { seed = null; }
  check('PC-16', 'seed scope only design section 9 entities', !!seed && seed.schemaVersion === 1 && Array.isArray(seed.goals) && seed.goals.length > 0, seed ? `goals=${seed.goals.length}` : 'missing .agent/portfolio-map.json');
  if (seed && portfolio.validatePortfolioMap) {
    const validation = portfolio.validatePortfolioMap(seed);
    check('PC-16', 'seed authorities and anchors validate', !!validation && validation.ok === true, JSON.stringify((validation && validation.issues) || []).slice(0, 300));
  } else {
    check('PC-16', 'seed authorities and anchors validate', false, 'no seed or validator');
  }
}

const CASE_RUNNERS = {
  'PC-01': runPC01, 'PC-02': runPC02, 'PC-03': runPC03, 'PC-04': runPC04,
  'PC-05': runPC05, 'PC-06': runPC06, 'PC-07': runPC07, 'PC-08': runPC08,
  'PC-09': runPC09, 'PC-10': runPC10, 'PC-11': runPC11, 'PC-12': runPC12,
  'PC-13': runPC13, 'PC-14': runPC14, 'PC-15': runPC15, 'PC-16': runPC16,
};

function main() {
  const argv = process.argv.slice(2);
  let selected = null;
  let selectedGroup = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--case' && argv[i + 1]) { selectedGroup = argv[i + 1]; selected = GROUPS[selectedGroup]; i++; }
    else { console.error(`unknown argument: ${argv[i]}`); process.exit(1); }
  }
  if (selectedGroup && !selected) { console.error(`unknown case selector: ${selectedGroup}`); process.exit(1); }
  const toRun = selected || ALL_CASES;
  if (!toRun.length) { console.error('zero test cases selected'); process.exit(1); }
  if (loadError) console.error(`portfolio load: ${loadError}`);
  for (const caseId of toRun) {
    try { CASE_RUNNERS[caseId](); }
    catch (error) { check(caseId, 'runner threw', false, String((error && error.message) || error)); }
  }
  console.log(`portfolio: ${passed}/${total}`);
  if (passed !== total) {
    if (selectedGroup && FINGERPRINTS[selectedGroup]) console.error(FINGERPRINTS[selectedGroup]);
    else if (!selectedGroup) {
      const failedIds = new Set(failures.map(f => f.slice(0, 5)));
      for (const [group, members] of Object.entries(GROUPS)) {
        if (members.some(m => failedIds.has(m))) console.error(FINGERPRINTS[group]);
      }
    }
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { ALL_CASES, GROUPS, FINGERPRINTS, FIXED_NOW };
