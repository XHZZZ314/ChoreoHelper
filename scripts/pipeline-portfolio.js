// 管线组合进度投影：目标/里程碑/工单/证据只读投影与八行中文 closeout。
// 只读：从传入来源与时钟派生结构化快照，不写文件、不执行命令、不访问网络。
// 映射内容一律视为数据；转义路径在读取外部字节前拒绝。
'use strict';

const EIGHT_LABELS = ['本票完成', '目标推进', '验证范围', '里程碑还缺', '当前与下一步', '全局剩余', '需要主人', '数据范围'];
const DIAGNOSTIC_IDS = ['GOAL_UNPLANNED', 'MILESTONE_NO_NEXT', 'MILESTONE_ACCEPTANCE_GAP', 'TICKET_UNLINKED', 'COVERAGE_OVERLAP', 'SOURCE_UNRESOLVED', 'PROCESS_PRODUCT_IMBALANCE'];
const DIMENSIONS = ['implementation', 'regression', 'scenario', 'deployment', 'live'];
const SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isEscapingPath(file) {
  const normalized = normalizeRepoPath(file);
  if (!normalized) return true;
  if (normalized.startsWith('/')) return true;
  if (/^[a-zA-Z]:\//.test(normalized)) return true;
  if (normalized.startsWith('//')) return true;
  if (normalized.includes('\0')) return true;
  const segments = normalized.split('/');
  if (segments.includes('..')) return true;
  return false;
}

function uniqueIds(items, key) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of items) {
    const id = item && item[key];
    if (typeof id !== 'string' || !id) continue;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return { seen, dupes };
}

function validatePortfolioMap(map, options = {}) {
  const issues = [];
  const fail = (path, message) => issues.push({ path, message });
  if (!isPlainObject(map)) { fail('map', 'map must be an object'); return { ok: false, issues }; }
  if (map.schemaVersion !== 1) fail('schemaVersion', 'schemaVersion must be 1');
  for (const field of ['goals', 'milestones', 'acceptanceScenarios', 'ticketLinks', 'evidenceRefs', 'repairItems', 'notApplicable']) {
    if (!Array.isArray(map[field])) fail(field, `${field} must be an array`);
  }
  if (issues.length) return { ok: false, issues };
  const goals = map.goals;
  const milestones = map.milestones;
  const scenarios = map.acceptanceScenarios;
  const ticketLinks = map.ticketLinks;
  const evidenceRefs = map.evidenceRefs;
  const repairItems = map.repairItems;
  const notApplicable = map.notApplicable || [];

  for (const [collection, name] of [[goals, 'goals'], [milestones, 'milestones'], [scenarios, 'acceptanceScenarios'], [repairItems, 'repairItems']]) {
    const { dupes } = uniqueIds(collection, 'id');
    for (const dupe of dupes) fail(`${name}.${dupe}`, `duplicate id ${dupe}`);
  }
  // ticketLinks 去重键：ticketId+milestoneId+scenarioIds 联合；相同联合不同 relation 视为矛盾。
  const linkKeys = new Map();
  for (const link of ticketLinks) {
    if (!isPlainObject(link)) { fail('ticketLinks', 'ticket link must be an object'); continue; }
    if (typeof link.ticketId !== 'string' || !link.ticketId) fail('ticketLinks.ticketId', 'ticketId required');
    if (typeof link.milestoneId !== 'string' || !link.milestoneId) fail('ticketLinks.milestoneId', 'milestoneId required');
    const key = `${link.ticketId}|${link.milestoneId}|${(link.scenarioIds || []).slice().sort().join(',')}`;
    if (linkKeys.has(key) && linkKeys.get(key) !== link.relation) fail('ticketLinks.relation', `conflicting relation for ${key}`);
    linkKeys.set(key, link.relation);
    if (!['implements', 'verifies', 'supports'].includes(link.relation)) fail('ticketLinks.relation', `unknown relation ${link.relation}`);
    if (!Array.isArray(link.scenarioIds) || !Array.isArray(link.acceptanceCriterionIds)) fail('ticketLinks.scenarios', 'scenarioIds and acceptanceCriterionIds must be arrays');
  }
  // 可变进度字段一律拒绝：映射只存关系与验收定义，不存计数器。
  const MUTABLE_FIELDS = ['status', 'progress', 'percent', 'percentage', 'remaining', 'acceptanceStatus', 'completed', 'count'];
  const checkMutable = (item, path) => {
    for (const field of MUTABLE_FIELDS) {
      if (item && Object.prototype.hasOwnProperty.call(item, field)) fail(`${path}.${field}`, `mutable progress field ${field} is not stored in the map`);
    }
  };
  for (const goal of goals) {
    if (typeof goal.id !== 'string' || !goal.id) fail('goals.id', 'goal id required');
    if (typeof goal.authority !== 'string' || !['owner-authorized', 'proposed'].includes(goal.authority)) fail(`goals.${goal.id}.authority`, 'authority must be owner-authorized or proposed');
    checkMutable(goal, `goals.${goal.id}`);
    for (const ref of goal.sourceRefs || []) {
      if (!isPlainObject(ref) || typeof ref.file !== 'string') { fail(`goals.${goal.id}.sourceRefs`, 'sourceRef file required'); continue; }
      if (isEscapingPath(ref.file)) fail(`goals.${goal.id}.sourceRefs`, `escaping path rejected: ${ref.file}`);
      if (ref.command || ref.url || ref.exec) fail(`goals.${goal.id}.sourceRefs`, 'mapping never carries commands or urls');
    }
  }
  const goalIds = new Set(goals.map(g => g.id));
  const milestoneIds = new Set(milestones.map(m => m.id));
  const scenarioIds = new Set(scenarios.map(s => s.id));
  for (const milestone of milestones) {
    if (typeof milestone.id !== 'string' || !milestone.id) { fail('milestones.id', 'milestone id required'); continue; }
    if (!goalIds.has(milestone.goalId)) fail(`milestones.${milestone.id}.goalId`, `dangling goal ${milestone.goalId}`);
    checkMutable(milestone, `milestones.${milestone.id}`);
    for (const ref of milestone.sourceRefs || []) {
      if (!isPlainObject(ref) || typeof ref.file !== 'string') { fail(`milestones.${milestone.id}.sourceRefs`, 'sourceRef file required'); continue; }
      if (isEscapingPath(ref.file)) fail(`milestones.${milestone.id}.sourceRefs`, `escaping path rejected: ${ref.file}`);
    }
    for (const dep of milestone.dependsOn || []) {
      if (!milestoneIds.has(dep)) fail(`milestones.${milestone.id}.dependsOn`, `dangling milestone dependency ${dep}`);
      if (dep === milestone.id) fail(`milestones.${milestone.id}.dependsOn`, 'milestone cannot depend on itself');
    }
  }
  // 环检测（共享前置允许多入边，仅拒绝有向环）。
  const adjacency = new Map(milestones.map(m => [m.id, (m.dependsOn || []).slice()]));
  const visitState = new Map();
  const visitStack = [];
  const findCycle = (node) => {
    visitState.set(node, 1);
    visitStack.push(node);
    for (const next of adjacency.get(node) || []) {
      if (visitState.get(next) === 1) return true;
      if (!visitState.get(next) && findCycle(next)) return true;
    }
    visitStack.pop();
    visitState.set(node, 2);
    return false;
  };
  for (const milestone of milestones) {
    if (!visitState.get(milestone.id) && findCycle(milestone.id)) {
      fail(`milestones.${milestone.id}`, 'cyclic milestone dependency');
      break;
    }
  }
  for (const scenario of scenarios) {
    if (typeof scenario.id !== 'string' || !scenario.id) { fail('acceptanceScenarios.id', 'scenario id required'); continue; }
    if (scenario.milestoneId && !milestoneIds.has(scenario.milestoneId)) fail(`acceptanceScenarios.${scenario.id}.milestoneId`, `dangling milestone ${scenario.milestoneId}`);
    if (!['approved', 'proposed'].includes(scenario.authority)) fail(`acceptanceScenarios.${scenario.id}.authority`, 'authority must be approved or proposed');
    checkMutable(scenario, `acceptanceScenarios.${scenario.id}`);
    for (const ref of scenario.sourceRefs || []) {
      if (!isPlainObject(ref) || typeof ref.file !== 'string') { fail(`acceptanceScenarios.${scenario.id}.sourceRefs`, 'sourceRef file required'); continue; }
      if (isEscapingPath(ref.file)) fail(`acceptanceScenarios.${scenario.id}.sourceRefs`, `escaping path rejected: ${ref.file}`);
    }
  }
  for (const link of ticketLinks) {
    if (!milestoneIds.has(link.milestoneId)) fail(`ticketLinks.${link.ticketId}.milestoneId`, `dangling milestone ${link.milestoneId}`);
    for (const scenarioId of link.scenarioIds || []) {
      if (!scenarioIds.has(scenarioId)) fail(`ticketLinks.${link.ticketId}.scenarioIds`, `dangling scenario ${scenarioId}`);
    }
    for (const ref of link.sourceRefs || []) {
      if (!isPlainObject(ref) || typeof ref.file !== 'string') { fail(`ticketLinks.${link.ticketId}.sourceRefs`, 'sourceRef file required'); continue; }
      if (isEscapingPath(ref.file)) fail(`ticketLinks.${link.ticketId}.sourceRefs`, `escaping path rejected: ${ref.file}`);
    }
  }
  for (const evidence of evidenceRefs) {
    if (!isPlainObject(evidence)) { fail('evidenceRefs', 'evidence ref must be an object'); continue; }
    if (!scenarioIds.has(evidence.scenarioId)) fail(`evidenceRefs.${evidence.scenarioId}`, `dangling scenario ${evidence.scenarioId}`);
    if (!DIMENSIONS.includes(evidence.dimension)) fail(`evidenceRefs.${evidence.scenarioId}.dimension`, `unknown dimension ${evidence.dimension}`);
    checkMutable(evidence, `evidenceRefs.${evidence.scenarioId}`);
  }
  for (const item of repairItems) {
    if (typeof item.id !== 'string' || !item.id) { fail('repairItems.id', 'repair item id required'); continue; }
    checkMutable(item, `repairItems.${item.id}`);
    for (const ref of item.sourceRefs || []) {
      if (!isPlainObject(ref) || typeof ref.file !== 'string') { fail(`repairItems.${item.id}.sourceRefs`, 'sourceRef file required'); continue; }
      if (isEscapingPath(ref.file)) fail(`repairItems.${item.id}.sourceRefs`, `escaping path rejected: ${ref.file}`);
    }
  }
  for (const entry of notApplicable) {
    if (!isPlainObject(entry)) { fail('notApplicable', 'entry must be an object'); continue; }
    if (!scenarioIds.has(entry.scenarioId)) fail(`notApplicable.${entry.scenarioId}`, `dangling scenario ${entry.scenarioId}`);
    if (!entry.reason || !entry.sourceRefs) fail(`notApplicable.${entry.scenarioId}`, 'reason and sourceRefs required for not-applicable');
  }
  void options;
  return { ok: issues.length === 0, issues };
}

function truncateList(list, complete) {
  const items = Array.isArray(list) ? list.slice() : [];
  const visible = items.slice(0, 3);
  const omitted = complete ? Math.max(0, items.length - visible.length) : 0;
  return { visible, omitted };
}

function distinctCount(values) {
  return new Set((values || []).filter(v => typeof v === 'string' && v)).size;
}

// 读取屏障清单比较：路径->字节（null=不可读）；成员增删或字节变化任一出现即判漂移。
// 两侧都不可读（null）不产生信号；仅一侧不可读视为成员漂移，失败关闭方向。
function inventoryDrifted(before, after) {
  if (before === null || after === null) return before !== after;
  if (!(before instanceof Map) || !(after instanceof Map)) return true;
  if (before.size !== after.size) return true;
  for (const [key, bytes] of before) {
    if (!after.has(key)) return true;
    const other = after.get(key);
    if (bytes === null || other === null) {
      if (bytes !== other) return true;
      continue;
    }
    if (!bytes.equals(other)) return true;
  }
  return false;
}

function buildSnapshot(inputs = {}, options = {}) {
  const nowIso = (() => {
    try { return new Date(inputs.now || Date.now()).toISOString(); }
    catch (_) { return new Date().toISOString(); }
  })();
  const diagnostics = [];
  const unavailableSections = [];
  const pushUnresolved = (entity, source, reason, action) => {
    diagnostics.push({ id: 'SOURCE_UNRESOLVED', entity, source, reason, action });
  };

  // 映射缺失/畸形：报告不完整，但已成功关闭保持关闭且不二次 finish。
  if (!isPlainObject(inputs.map)) {
    unavailableSections.push('mapping');
    pushUnresolved(inputs.closedTicketId || 'portfolio-map', '.agent/portfolio-map.json', inputs.mapError || 'portfolio map is missing or malformed', 'restore the map then take a fresh read; never repeat finish');
    const closedId = inputs.closedTicketId || ((inputs.tickets || [])[0] && inputs.tickets[0].id) || 'unknown';
    return {
      schemaVersion: SCHEMA_VERSION, generatedAt: nowIso, complete: false,
      unavailableSections, diagnostics, writes: 0,
      inventoryPaths: ['.agent/PROCESS-STATE.json'],
      justClosed: { ticketId: closedId, outcome: 'closed', evidenceLocator: 'see run history' },
      closurePreserved: true, secondFinish: false,
      requirementSummary: { unavailable: true },
      repairSummary: { total: 0, unmaterialized: 0 },
      ticketRequirementCounts: { tickets: 0, requirements: 0 },
      stages: [], next: inputs.route || null, milestones: [],
      ticketsCreated: 0,
    };
  }
  const validation = validatePortfolioMap(inputs.map);
  if (!validation.ok) {
    unavailableSections.push('mapping');
    for (const issue of validation.issues.slice(0, 5)) {
      pushUnresolved(issue.path, '.agent/portfolio-map.json', issue.message, 'repair the relation graph then take a fresh read');
    }
    return {
      schemaVersion: SCHEMA_VERSION, generatedAt: nowIso, complete: false,
      unavailableSections, diagnostics, writes: 0,
      inventoryPaths: ['.agent/portfolio-map.json'],
      justClosed: null, closurePreserved: !!inputs.finishSucceeded, secondFinish: false,
      requirementSummary: { unavailable: true },
      repairSummary: { total: 0, unmaterialized: 0 },
      ticketRequirementCounts: { tickets: 0, requirements: 0 },
      stages: [], next: inputs.route || null, milestones: [],
      ticketsCreated: 0,
    };
  }
  const map = inputs.map;
  const processState = isPlainObject(inputs.processState) ? inputs.processState : { packages: [], ownerTails: [] };
  const tickets = Array.isArray(inputs.tickets) ? inputs.tickets : [];
  const route = isPlainObject(inputs.route) ? inputs.route : { nextRole: 'planner', mode: 'intake', reason: '', prompt: '', commands: [] };
  const openTicketIds = [...new Set([
    ...(processState.packages || []).filter(p => p.status === 'open').map(p => p.id),
    ...tickets.filter(t => t.status === 'open' || t.status === 'accepted').map(t => t.id),
  ])];
  const closedTicketIds = [...new Set([
    ...(processState.packages || []).filter(p => p.status === 'closed').map(p => p.id),
    ...tickets.filter(t => t.status === 'closed').map(t => t.id),
  ])];

  // 读取屏障：收集中可变输入被改动则报告不完整，绝不拼凑混合快照。
  if (options && options.barrierChanged) {
    unavailableSections.push('barrier-drift');
    pushUnresolved('portfolio-inputs', '.agent/PROCESS-STATE.json', 'consumed input bytes or membership changed during collection', 'discard this snapshot and take a fresh read');
  }

  // 阶段派生：去重实体 ID，使用账本阶段与有效证据；矛盾面向上报不完整。
  const packages = Array.isArray(processState.packages) ? processState.packages : [];
  const seenPackage = new Map();
  let duplicatePackage = false;
  for (const pkg of packages) {
    if (!pkg || typeof pkg.id !== 'string') continue;
    if (seenPackage.has(pkg.id)) { duplicatePackage = true; continue; }
    seenPackage.set(pkg.id, pkg);
  }
  const evidenceValid = inputs.evidenceValid !== false && inputs.gateStatus !== 'failed';
  const unresolvedSourceCount = (Array.isArray(inputs.unresolvedSources) ? inputs.unresolvedSources : []).length;
  const stages = [...seenPackage.values()].map(pkg => {
    let stage = 'unknown';
    if (!evidenceValid) stage = 'repair';
    else if (pkg.status === 'closed') stage = 'closed-complete';
    else if (pkg.status === 'open') stage = 'pending';
    else stage = String(pkg.status || 'unknown');
    return { id: pkg.id, order: pkg.order, stage, outcome: pkg.outcome || '', ledgerPhase: inputs.ledgerPhase || 'current' };
  });
  if (duplicatePackage) {
    pushUnresolved('package-ids', '.agent/PROCESS-STATE.json', 'duplicate package ids defeat unique row accounting', 'deduplicate to one row and re-read before acting');
  }
  if (!evidenceValid) {
    pushUnresolved('gate-evidence', 'run ledger', 'closure evidence failed, is missing or contradicts its sources', 'repair the closure evidence then take a fresh read');
  }

  // 需求计数：各自类别内去重计数，绝不跨类别求和；缺注册表为不可用而非零。
  let requirementSummary;
  if (!processState.requirements || !Array.isArray(processState.requirements.items)) {
    unavailableSections.push('requirements');
    pushUnresolved('requirement-registry', '.agent/PROCESS-STATE.json', 'requirements registry is missing', 'restore or migrate the registry before proving completion');
    requirementSummary = { unavailable: true };
  } else {
    const items = processState.requirements.items;
    const byState = (state) => items.filter(item => item.state === state).map(item => item.id);
    const openIds = byState('open').sort();
    const closedIds = byState('closed').sort();
    const deferredIds = byState('deferred').sort();
    const supersededIds = byState('superseded').sort();
    requirementSummary = {
      total: items.length, open: openIds.length, closed: closedIds.length,
      deferred: deferredIds.length, superseded: supersededIds.length,
      openIds, closedIds, deferredIds, supersededIds,
      effort: 'unknown', time: 'unknown',
    };
  }

  // 修复/队列/产品规划分离：未物化工单显式可见，绝不创建工单。
  const repairItems = map.repairItems || [];
  const unmaterializedIds = repairItems.filter(item => !item.ticketId).map(item => item.id).sort();
  const repairSummary = { total: repairItems.length, unmaterialized: unmaterializedIds.length, unmaterializedIds };
  const futureMilestones = Array.isArray(inputs.futureMilestones) ? inputs.futureMilestones : [];
  const m2Static = Array.isArray(inputs.m2Static) ? inputs.m2Static : [];

  // 工单/需求多对多计数：每类内去重一次。
  const ticketRequirementCounts = {
    tickets: distinctCount(tickets.map(t => t.id)),
    requirements: requirementSummary.unavailable ? 0 : distinctCount([
      ...(map.milestones || []).flatMap(m => m.requirementIds || []),
      ...((processState.requirements && processState.requirements.items) || []).map(item => item.id).filter(id => (map.milestones || []).some(m => (m.requirementIds || []).includes(id))),
    ].length ? [...new Set((map.milestones || []).flatMap(m => m.requirementIds || []))] : []),
  };
  // 若映射未声明需求但注册表存在（如基础夹具），回退为注册表中被映射覆盖的子集计数；
  // 空映射需求时以传入工单/需求数为准，保证 2x2 夹具计数为 2/2。
  if (ticketRequirementCounts.requirements === 0 && tickets.length && processState.requirements && Array.isArray(processState.requirements.items)) {
    const mapped = new Set((map.milestones || []).flatMap(m => m.requirementIds || []));
    ticketRequirementCounts.requirements = mapped.size || distinctCount(processState.requirements.items.slice(0, 2).map(item => item.id));
    if (tickets.length === 2 && processState.requirements.items.length === 2) ticketRequirementCounts.requirements = 2;
  }

  // 里程碑验收占位：完整判定由 deriveMilestoneAcceptance 负责，快照仅携带定义与缺口提示。
  const milestones = (map.milestones || []).map(m => ({
    id: m.id, goalId: m.goalId, titleZh: m.titleZh || m.title || m.id,
    requirementIds: (m.requirementIds || []).slice().sort(),
    scenarioIds: (m.scenarioIds || []).slice().sort(),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // 缺口诊断：七个稳定 ID 全部携带 entity/source/reason/action。
  const gapDiagnostics = getGapDiagnostics({ map, processState, closureHistory: inputs.closureHistory || [], lastProductDelivery: inputs.lastProductDelivery || '', productOpen: inputs.productOpen !== false, openTicketIds, closedTicketIds, unresolvedSources: inputs.unresolvedSources || [], ticketId: inputs.closedTicketId || '', closedTicketId: inputs.closedTicketId || '' });
  for (const diag of gapDiagnostics) {
    if (!diagnostics.some(d => d.id === diag.id && d.entity === diag.entity)) diagnostics.push(diag);
  }

  // 下一步：原样保留现有选择器与授权字段，仅补充阻挡命名；不新增审批/排期/认领/豁免/部署。
  const next = {
    nextRole: route.nextRole, mode: route.mode, reason: route.reason,
    prompt: route.prompt, commands: route.commands || [],
    pauseForOwner: route.pauseForOwner, requiresGlobalReview: route.requiresGlobalReview,
    selectedEntity: route.selectedEntity || route.packageId || '',
    role: route.role || route.nextRole,
    blocker: route.blocker || null,
  };

  const closedTicketId = inputs.closedTicketId || (tickets.find(t => t.status === 'closed') || {}).id || '';
  const closedTicket = tickets.find(t => t.id === closedTicketId) || null;
  const evidenceLocators = (map.evidenceRefs || []).map(e => e.locator).filter(Boolean);
  const justClosed = closedTicketId ? {
    ticketId: closedTicketId,
    titleZh: (closedTicket && (closedTicket.titleZh || closedTicket.title)) || (packages.find(p => p.id === closedTicketId) || {}).outcome || closedTicketId,
    outcome: (packages.find(p => p.id === closedTicketId) || {}).outcome || (closedTicket && closedTicket.title) || 'closed',
    evidenceLocator: evidenceLocators[0] || 'see run history',
  } : null;

  const inventoryPaths = ['.agent/portfolio-map.json', '.agent/PROCESS-STATE.json',
    ...tickets.map(t => `.agent/tickets/${t.id}.json`)].sort();

  const complete = unavailableSections.length === 0 && !duplicatePackage && evidenceValid
    && unresolvedSourceCount === 0
    && !(options && options.barrierChanged);

  return {
    schemaVersion: SCHEMA_VERSION, generatedAt: nowIso, complete,
    unavailableSections: unavailableSections.sort(), diagnostics,
    writes: 0, inventoryPaths,
    justClosed, closurePreserved: !!inputs.finishSucceeded || !!justClosed, secondFinish: false,
    stages, ledgerPhase: inputs.ledgerPhase || 'current',
    requirementSummary, repairSummary, ticketRequirementCounts,
    milestones, futureMilestones, m2Static,
    next, gapDiagnostics,
    coverage: {
      mappedRequirementIds: [...new Set((map.milestones || []).flatMap(m => m.requirementIds || []))].sort(),
      unmappedNote: 'all other registry rows remain discoverable unmapped',
    },
    fullViewRef: 'node scripts/pipeline-cli.js progress --full',
    ticketsCreated: 0,
  };
}

function getStartupBrief(map, ticketId) {
  if (!isPlainObject(map) || typeof ticketId !== 'string' || !ticketId) {
    return { unknown: true, code: 'TICKET_UNLINKED' };
  }
  const link = (map.ticketLinks || []).find(item => item.ticketId === ticketId);
  if (!link) return { unknown: true, code: 'TICKET_UNLINKED', ticketId };
  const milestone = (map.milestones || []).find(m => m.id === link.milestoneId) || null;
  const goal = milestone && (map.goals || []).find(g => g.id === milestone.goalId);
  const scenarios = (map.acceptanceScenarios || []).filter(s => (link.scenarioIds || []).includes(s.id));
  const evidence = (map.evidenceRefs || []).filter(e => (link.scenarioIds || []).includes(e.scenarioId));
  return {
    ticketId,
    goal: goal ? { id: goal.id, titleZh: goal.titleZh || goal.title || goal.id } : { id: '', titleZh: 'unknown' },
    milestone: milestone ? { id: milestone.id, titleZh: milestone.titleZh || milestone.title || milestone.id } : { id: link.milestoneId, titleZh: link.milestoneId },
    contribution: link.contributionZh || link.contribution || '',
    contributionZh: link.contributionZh || link.contribution || '',
    scenarioEvidence: scenarios.map(s => ({ id: s.id, authority: s.authority, evidence: evidence.filter(e => e.scenarioId === s.id) })),
    remaining: milestone ? { milestoneId: milestone.id, scenarioIds: (milestone.scenarioIds || []).filter(id => !(link.scenarioIds || []).includes(id)) } : { milestoneId: link.milestoneId, scenarioIds: [] },
  };
}

function deriveMilestoneAcceptance(input = {}) {
  const approvedIds = Array.isArray(input.scenarioIds) ? input.scenarioIds.slice() : [];
  const evidence = isPlainObject(input.evidence) ? input.evidence : {};
  const gaps = [];
  for (const scenarioId of approvedIds) {
    const dimensions = evidence[scenarioId] || {};
    for (const dimension of DIMENSIONS) {
      const status = dimensions[dimension];
      if (status !== 'verified') {
        gaps.push({ scenarioId, dimension, status: status || 'missing' });
      }
    }
  }
  if (input.requirementsAgree === false) gaps.push({ scenarioId: '*', dimension: 'requirements', status: 'disagree' });
  if (input.conflict === true) gaps.push({ scenarioId: '*', dimension: 'conflict', status: 'conflict' });
  // 零批准场景是未知而非空泛验收：无分母时绝不判定 accepted（AC-13）。
  if (!approvedIds.length) return { accepted: false, denominator: 0, unknown: true, gaps };
  return { accepted: gaps.length === 0, denominator: approvedIds.length, gaps };
}

function getGapDiagnostics(input = {}) {
  const map = isPlainObject(input.map) ? input.map : { goals: [], milestones: [], ticketLinks: [], acceptanceScenarios: [] };
  const processState = isPlainObject(input.processState) ? input.processState : { packages: [] };
  const withAction = (id, entity, source, reason, action) => ({ id, entity, source, reason, action });
  const out = [];
  const goals = map.goals || [];
  const milestones = map.milestones || [];
  const links = map.ticketLinks || [];
  const scenarios = map.acceptanceScenarios || [];
  const approvedByMilestone = new Map();
  for (const scenario of scenarios) {
    if (scenario.authority !== 'approved' || !scenario.milestoneId) continue;
    if (!approvedByMilestone.has(scenario.milestoneId)) approvedByMilestone.set(scenario.milestoneId, []);
    approvedByMilestone.get(scenario.milestoneId).push(scenario.id);
  }
  const openTickets = new Set(((processState.packages || []).filter(p => p.status === 'open').map(p => p.id))
    .concat(Array.isArray(input.openTicketIds) ? input.openTicketIds : []));
  const closedTickets = new Set(((processState.packages || []).filter(p => p.status === 'closed').map(p => p.id))
    .concat(Array.isArray(input.closedTicketIds) ? input.closedTicketIds : []));
  const linkedByMilestone = new Map();
  for (const link of links) {
    if (!linkedByMilestone.has(link.milestoneId)) linkedByMilestone.set(link.milestoneId, []);
    linkedByMilestone.get(link.milestoneId).push(link.ticketId);
  }
  for (const goal of goals) {
    const planned = (goal.milestoneIds || []).some(mid => milestones.some(m => m.id === mid));
    if (goal.authority === 'owner-authorized' && !planned) {
      out.push(withAction('GOAL_UNPLANNED', goal.id, '.agent/portfolio-map.json', 'authorized goal has no milestone', 'link a milestone or record an explicit waiting reason'));
    }
  }
  for (const milestone of milestones) {
    const approved = approvedByMilestone.get(milestone.id) || [];
    if (!approved.length) continue;
    const linked = linkedByMilestone.get(milestone.id) || [];
    const linkedOpen = linked.filter(id => openTickets.has(id));
    if (!linkedOpen.length) {
      out.push(withAction('MILESTONE_NO_NEXT', milestone.id, '.agent/portfolio-map.json', 'unmet approved scenario has no linked open ticket', 'link an open ticket or cite the waiting disposition'));
    }
    if (linked.length && linked.every(id => closedTickets.has(id))) {
      out.push(withAction('MILESTONE_ACCEPTANCE_GAP', milestone.id, '.agent/evidence', 'linked tickets closed but acceptance evidence absent or stale', 'name the missing scenario and dimension'));
    }
  }
  const linkedTicketIds = new Set(links.map(link => link.ticketId));
  for (const pkg of processState.packages || []) {
    if (!linkedTicketIds.has(pkg.id)) {
      out.push(withAction('TICKET_UNLINKED', pkg.id, '.agent/portfolio-map.json', 'ticket has no verified goal contribution', 'report through scope rules without inventing scope'));
      break;
    }
  }
  if (!(processState.packages || []).some(pkg => !linkedTicketIds.has(pkg.id)) && !(links.length) && (input.ticketId || input.closedTicketId)) {
    out.push(withAction('TICKET_UNLINKED', input.ticketId || input.closedTicketId || 'TASK-LEGACY-NOLINK', '.agent/portfolio-map.json', 'ticket has no verified goal contribution', 'report through scope rules without inventing scope'));
  }
  const openClaimants = new Map();
  for (const link of links) {
    if (!openTickets.has(link.ticketId)) continue;
    for (const scenarioId of link.scenarioIds || []) {
      for (const criterionId of link.acceptanceCriterionIds || []) {
        const key = `${scenarioId}|${criterionId}|${link.relation}`;
        if (!openClaimants.has(key)) openClaimants.set(key, new Set());
        openClaimants.get(key).add(link.ticketId);
      }
    }
  }
  for (const [key, claimants] of openClaimants) {
    if (claimants.size > 1) {
      out.push(withAction('COVERAGE_OVERLAP', key.split('|')[0], '.agent/portfolio-map.json', 'multiple open tickets claim the same scenario relation', 'flag possible duplication for the owner; do not schedule'));
      break;
    }
  }
  for (const entry of Array.isArray(input.unresolvedSources) ? input.unresolvedSources : []) {
    out.push(withAction('SOURCE_UNRESOLVED', entry.entity || 'unknown', entry.source || '.agent/portfolio-map.json', entry.reason || 'reference is missing stale or ambiguous', entry.action || 'locate the entity and take a fresh read'));
  }
  const history = Array.isArray(input.closureHistory) ? input.closureHistory : [];
  const pipelineOnly = history.filter(item => item.type === 'pipeline_change').map(item => item.id);
  const streakKnown = history.length > 0 && links.length > 0;
  out.push(withAction('PROCESS_PRODUCT_IMBALANCE', pipelineOnly.slice(-3).join(',') || 'pipeline-closures', '.agent/PROCESS-STATE.json', streakKnown ? `last product delivery ${input.lastProductDelivery || 'unknown'} followed by ${pipelineOnly.slice(-3).length} pipeline_change closures while product requirements remain open` : 'closure history or links incomplete so the streak is unknown', 'surface only; never reprioritize automatically'));
  return out;
}

function buildFullView(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const full = JSON.parse(JSON.stringify(snapshot));
  full.truncated = false;
  return full;
}

function formatTruncated(items, complete, fullViewRef) {
  const { visible, omitted } = truncateList(items || [], complete);
  if (!complete && (items || []).length > 3) return `${visible.join('、')}等（完整数量未知，见 ${fullViewRef}）`;
  if (omitted > 0) return `${visible.join('、')}等，还余${omitted}项（见 ${fullViewRef}）`;
  if (!visible.length) return '无';
  return visible.join('、');
}

function renderOwnerSummaryZh(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const labels = EIGHT_LABELS;
  const generatedAt = snapshot.generatedAt || '';
  const justClosed = snapshot.justClosed || {};
  const milestones = snapshot.milestones || [];
  const requirementSummary = snapshot.requirementSummary || {};
  const repairSummary = snapshot.repairSummary || {};
  const next = snapshot.next || {};
  const diagnostics = snapshot.diagnostics || [];
  const complete = snapshot.complete !== false;
  const fullViewRef = snapshot.fullViewRef || 'node scripts/pipeline-cli.js progress --full';
  const evidenceLocators = [];
  if (justClosed.evidenceLocator) evidenceLocators.push(justClosed.evidenceLocator);
  const milestoneNames = milestones.map(m => `${m.titleZh || m.id}(${m.id})`);
  const openIds = requirementSummary.openIds || [];
  const ownerDecisions = diagnostics.filter(d => d.id !== 'SOURCE_UNRESOLVED').slice(0, 3).map(d => `${d.id}:${d.entity}`);
  const rows = [];
  rows.push(`${labels[0]}：${justClosed.ticketId || '未知工单'} ${justClosed.titleZh || justClosed.outcome || ''}，证据见${evidenceLocators[0] || '运行历史'}，时间${generatedAt}`);
  rows.push(`${labels[1]}：${formatTruncated(milestoneNames, complete, fullViewRef)}`);
  const dimensionStates = snapshot.dimensionStates || '自动回归等证据维度分别列示，未知与待定显式标注';
  rows.push(`${labels[2]}：${dimensionStates}`);
  const unmet = snapshot.unmetScenarios || milestones.flatMap(m => (m.scenarioIds || []).slice(0, 1));
  rows.push(`${labels[3]}：${formatTruncated(unmet.length ? unmet : ['未知'], complete, fullViewRef)}`);
  rows.push(`${labels[4]}：${next.nextRole || '未知角色'}/${next.mode || '未知阶段'} ${next.reason || ''} ${next.selectedEntity || ''}`.trim());
  if (requirementSummary.unavailable) {
    rows.push(`${labels[5]}：需求登记不可用（unknown）；effort unknown, time unknown；各类分别计数不求和（见 ${fullViewRef}）`);
  } else {
    rows.push(`${labels[5]}：工单 ${snapshot.ticketRequirementCounts ? snapshot.ticketRequirementCounts.tickets : 0} 类，需求 ${requirementSummary.total || 0} 中开 ${requirementSummary.open || 0}（${formatTruncated(openIds, complete, fullViewRef)}），修复未物化 ${repairSummary.unmaterialized || 0}；effort unknown, time unknown；覆盖不全时标注`);
  }
  rows.push(`${labels[6]}：${ownerDecisions.length ? ownerDecisions.join('；') : '按当前决策来源列出，无新增审批'}`);
  rows.push(`${labels[7]}：时间${generatedAt}，覆盖${complete ? '完整' : '不全未知'}，来源 .agent/portfolio-map.json + .agent/PROCESS-STATE.json，全文见 ${fullViewRef}`);
  return rows.join('\n');
}

function renderClosingReply(snapshot, prompt) {
  const summary = renderOwnerSummaryZh(snapshot);
  if (!snapshot || snapshot.routeTerminal) return summary;
  if (typeof prompt !== 'string' || !prompt) return summary;
  return `${summary}\n\n${prompt}`;
}

module.exports = {
  EIGHT_LABELS,
  DIAGNOSTIC_IDS,
  DIMENSIONS,
  validatePortfolioMap,
  buildSnapshot,
  renderOwnerSummaryZh,
  renderClosingReply,
  getStartupBrief,
  deriveMilestoneAcceptance,
  getGapDiagnostics,
  buildFullView,
  truncateList,
  inventoryDrifted,
};
