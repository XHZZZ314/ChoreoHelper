// 流程自纠错的纯策略层：校验机器状态、渲染派生区块、分析事件阈值并生成提案。
// 不读写仓库、不访问网络；CLI 与回归套件共用同一套判定。
// 受控边界详见 docs/AI-WORKFLOW.md 的 Self-correction 章节。
'use strict';

const PACKAGE_STATUSES = new Set(['open', 'blocked', 'deferred', 'closed']);
const TAIL_STATUSES = new Set(['owner-bound', 'blocked', 'pending-authorization']);
const REQUIREMENT_STATES = new Set(['open', 'closed', 'deferred', 'superseded']);
const REQUIREMENT_EVIDENCE_FILE = /^(HANDOFF-[A-Za-z0-9-]+\.md|\.agent\/tickets\/TASK-[A-Za-z0-9-]+\.json|\.agent\/interrupts\/history\/INT-[A-Za-z0-9-]+\.json)$/;
const EVENT_KINDS = new Set([
  'user-correction', 'repeated-error', 'test-flake', 'live-mismatch',
  'manual-repeat', 'state-drift', 'context-budget', 'resolution',
]);
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((v, i) => [v, i]));

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(issues, code, path, message) {
  issues.push({ code, path, message });
}

function validateEvidence(items, path, issues) {
  if (!Array.isArray(items)) {
    add(issues, 'shape', path, 'must be an array');
    return;
  }
  items.forEach((item, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(item)) return add(issues, 'shape', at, 'must be an object');
    if (!nonEmpty(item.label)) add(issues, 'required', `${at}.label`, 'is required');
    if (!/^HANDOFF-[A-Za-z0-9-]+\.md$/.test(item.file || '')) {
      add(issues, 'handoff', `${at}.file`, 'must be a HANDOFF-*.md filename');
    }
  });
}

function resolveActivePackages(state) {
  if (Array.isArray(state.activePackages)) return state.activePackages.filter(id => typeof id === 'string' && id);
  return state.activePackage ? [state.activePackage] : [];
}

function validateActivePackages(state, issues) {
  if (state.activePackages === undefined) return;
  if (!Array.isArray(state.activePackages)) {
    add(issues, 'shape', 'activePackages', 'must be an array');
    return;
  }
  const ids = new Set();
  state.activePackages.forEach((id, index) => {
    const at = `activePackages[${index}]`;
    if (!/^[A-Z0-9][A-Z0-9-]*$/.test(id || '')) add(issues, 'id', at, 'must be an uppercase stable ID');
    else if (ids.has(id)) add(issues, 'duplicate', at, `duplicate id ${id}`);
    else ids.add(id);
  });
  if (state.activePackage != null) {
    add(issues, 'active', 'activePackage', 'legacy single slot must be null when activePackages is present');
  }
  if (!Array.isArray(state.packages)) return;
  for (const id of ids) {
    const active = state.packages.find(pkg => pkg.id === id);
    if (!active) add(issues, 'active', 'activePackages', `${id} must reference a package`);
    else if (active.status === 'closed') add(issues, 'active', 'activePackages', `${id} must not reference a CLOSED package`);
  }
}

function validatePrerequisiteExceptions(state, issues) {
  const exceptions = state.evolution && state.evolution.prerequisiteExceptions;
  if (exceptions === undefined) return;
  if (!Array.isArray(exceptions)) {
    add(issues, 'shape', 'evolution.prerequisiteExceptions', 'must be an array');
    return;
  }
  exceptions.forEach((exception, index) => {
    const at = `evolution.prerequisiteExceptions[${index}]`;
    if (!isObject(exception)) return add(issues, 'shape', at, 'must be an object');
    for (const key of ['ticketId', 'prerequisiteId', 'note']) {
      if (!nonEmpty(exception[key])) add(issues, 'required', `${at}.${key}`, 'is required');
    }
    validateRequirementEvidence(exception.evidence, `${at}.evidence`, issues);
  });
}

function validateRequirementEvidence(items, issuePath, issues) {
  if (!Array.isArray(items)) {
    add(issues, 'shape', issuePath, 'must be an array');
    return;
  }
  items.forEach((item, index) => {
    const at = `${issuePath}[${index}]`;
    if (!isObject(item)) return add(issues, 'shape', at, 'must be an object');
    if (!nonEmpty(item.label)) add(issues, 'required', `${at}.label`, 'is required');
    if (!REQUIREMENT_EVIDENCE_FILE.test(item.file || '')) {
      add(issues, 'file', `${at}.file`, 'must be a HANDOFF, ticket or interruption-history reference');
    }
  });
}

function validateRequirements(state, issues = []) {
  const requirements = state.requirements;
  if (requirements === undefined) return issues;
  if (!isObject(requirements)) {
    add(issues, 'shape', 'requirements', 'must be an object');
    return;
  }
  if (requirements.schemaVersion !== 1) add(issues, 'version', 'requirements.schemaVersion', 'must equal 1');
  const sources = new Set();
  if (!Array.isArray(requirements.sources) || requirements.sources.length === 0) {
    add(issues, 'shape', 'requirements.sources', 'must be a non-empty array');
  } else {
    requirements.sources.forEach((source, index) => {
      const at = `requirements.sources[${index}]`;
      if (!isObject(source)) return add(issues, 'shape', at, 'must be an object');
      if (!nonEmpty(source.file)) add(issues, 'required', `${at}.file`, 'is required');
      else if (sources.has(source.file)) add(issues, 'duplicate', `${at}.file`, `duplicate source ${source.file}`);
      else sources.add(source.file);
      if (!nonEmpty(source.trackedLine)) add(issues, 'required', `${at}.trackedLine`, 'is required');
      else {
        try { new RegExp(source.trackedLine); }
        catch (error) { add(issues, 'pattern', `${at}.trackedLine`, error.message); }
      }
    });
  }
  if (!Array.isArray(requirements.items) || requirements.items.length === 0) {
    add(issues, 'shape', 'requirements.items', 'must be a non-empty array');
    return;
  }
  const ids = new Set();
  const anchors = new Set();
  requirements.items.forEach((item, index) => {
    const at = `requirements.items[${index}]`;
    if (!isObject(item)) return add(issues, 'shape', at, 'must be an object');
    if (!/^REQ-[A-Z0-9-]+$/.test(item.id || '')) add(issues, 'id', `${at}.id`, 'must be an uppercase REQ-* ID');
    else if (ids.has(item.id)) add(issues, 'duplicate', `${at}.id`, `duplicate id ${item.id}`);
    else ids.add(item.id);
    if (!sources.has(item.source)) add(issues, 'source', `${at}.source`, 'must be a declared registry source');
    if (!nonEmpty(item.anchor)) add(issues, 'required', `${at}.anchor`, 'is required');
    else {
      const anchorKey = `${item.source}::${item.anchor}`;
      if (anchors.has(anchorKey)) add(issues, 'duplicate', `${at}.anchor`, 'duplicate anchor');
      else anchors.add(anchorKey);
    }
    if (!nonEmpty(item.title)) add(issues, 'required', `${at}.title`, 'is required');
    if (!REQUIREMENT_STATES.has(item.state)) add(issues, 'state', `${at}.state`, 'is unsupported');
    if (item.basis !== undefined && !['source-marker', 'evidence-file'].includes(item.basis)) {
      add(issues, 'basis', `${at}.basis`, 'is unsupported');
    }
    if (!Array.isArray(item.dependsOn)) add(issues, 'shape', `${at}.dependsOn`, 'must be an array');
    const hasEvidence = Array.isArray(item.evidence) && item.evidence.length > 0;
    if (['deferred', 'superseded'].includes(item.state) && !hasEvidence) {
      add(issues, 'evidence', `${at}.evidence`, 'deferred/superseded require durable evidence');
    }
    if (item.state === 'closed' && !hasEvidence && item.basis !== 'source-marker') {
      add(issues, 'evidence', `${at}.evidence`, 'closed requires evidence or the source-marker basis');
    }
    validateRequirementEvidence(item.evidence || [], `${at}.evidence`, issues);
  });
  for (const item of requirements.items) {
    for (const dependency of item.dependsOn || []) {
      if (!ids.has(dependency)) add(issues, 'dependsOn', `requirements.items[${requirements.items.indexOf(item)}].dependsOn`, `${dependency} is not a registry item`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(requirements.items.filter(item => item.id).map(item => [item.id, item]));
  const visit = id => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      add(issues, 'cycle', 'requirements.items', `prerequisite chain is cyclic at ${id}`);
      return;
    }
    visiting.add(id);
    for (const dependency of (byId.get(id) || {}).dependsOn || []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return issues;
}

function validateState(state) {
  const issues = [];
  if (!isObject(state)) {
    add(issues, 'shape', '$', 'must be an object');
    return issues;
  }
  if (state.schemaVersion !== 1) add(issues, 'version', 'schemaVersion', 'must equal 1');
  if (!Array.isArray(state.packages) || state.packages.length === 0) {
    add(issues, 'shape', 'packages', 'must be a non-empty array');
  } else {
    const orders = new Set();
    const ids = new Set();
    state.packages.forEach((pkg, index) => {
      const at = `packages[${index}]`;
      if (!isObject(pkg)) return add(issues, 'shape', at, 'must be an object');
      if (!Number.isInteger(pkg.order) || pkg.order < 1) add(issues, 'order', `${at}.order`, 'must be a positive integer');
      else if (orders.has(pkg.order)) add(issues, 'duplicate', `${at}.order`, `duplicate order ${pkg.order}`);
      else orders.add(pkg.order);
      if (!/^[A-Z0-9][A-Z0-9-]*$/.test(pkg.id || '')) add(issues, 'id', `${at}.id`, 'must be an uppercase stable ID');
      else if (ids.has(pkg.id)) add(issues, 'duplicate', `${at}.id`, `duplicate id ${pkg.id}`);
      else ids.add(pkg.id);
      if (!PACKAGE_STATUSES.has(pkg.status)) add(issues, 'status', `${at}.status`, 'is unsupported');
      if (!nonEmpty(pkg.outcome)) add(issues, 'required', `${at}.outcome`, 'is required');
      validateEvidence(pkg.handoffs, `${at}.handoffs`, issues);
      if (pkg.status === 'closed') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pkg.closedOn || '')) add(issues, 'date', `${at}.closedOn`, 'is required for CLOSED');
        if (!Array.isArray(pkg.handoffs) || pkg.handoffs.length === 0) add(issues, 'handoff', `${at}.handoffs`, 'CLOSED requires evidence');
      }
    });
    if (state.activePackages !== undefined) validateActivePackages(state, issues);
    else if (state.activePackage !== null) {
      const active = state.packages.find(pkg => pkg.id === state.activePackage);
      if (!active) add(issues, 'active', 'activePackage', 'must reference a package');
      else if (active.status !== 'open') add(issues, 'active', 'activePackage', 'must reference an OPEN package');
    }
  }
  if (!Array.isArray(state.ownerTails)) {
    add(issues, 'shape', 'ownerTails', 'must be an array');
  } else {
    const ids = new Set();
    state.ownerTails.forEach((tail, index) => {
      const at = `ownerTails[${index}]`;
      if (!isObject(tail)) return add(issues, 'shape', at, 'must be an object');
      if (!/^[A-Z0-9][A-Z0-9-]*$/.test(tail.id || '')) add(issues, 'id', `${at}.id`, 'must be an uppercase stable ID');
      else if (ids.has(tail.id)) add(issues, 'duplicate', `${at}.id`, `duplicate id ${tail.id}`);
      else ids.add(tail.id);
      if (!TAIL_STATUSES.has(tail.status)) add(issues, 'status', `${at}.status`, 'is unsupported');
      for (const key of ['title', 'summary', 'nextAction']) {
        if (!nonEmpty(tail[key])) add(issues, 'required', `${at}.${key}`, 'is required');
      }
      validateEvidence(tail.evidence, `${at}.evidence`, issues);
    });
  }
  for (const key of ['latestProductHandoff', 'latestProcessHandoff']) {
    if (!/^HANDOFF-[A-Za-z0-9-]+\.md$/.test(state[key] || '')) add(issues, 'handoff', key, 'must be a HANDOFF filename');
  }
  if (!isObject(state.budgets)) add(issues, 'shape', 'budgets', 'must be an object');
  else {
    for (const key of ['defaultContextBytes', 'implementationContextBytes']) {
      if (!Number.isInteger(state.budgets[key]) || state.budgets[key] <= 0) add(issues, 'budget', `budgets.${key}`, 'must be positive');
    }
    if (!Number.isInteger(state.budgets.maxOpenOwnerTails) || state.budgets.maxOpenOwnerTails < 1) {
      add(issues, 'budget', 'budgets.maxOpenOwnerTails', 'must be a positive integer');
    }
  }
  if (!isObject(state.evolution) || !isObject(state.evolution.thresholds)) {
    add(issues, 'shape', 'evolution.thresholds', 'must be an object');
  } else {
    for (const severity of SEVERITIES) {
      const value = state.evolution.thresholds[severity];
      if (!Number.isInteger(value) || value < 1) add(issues, 'threshold', `evolution.thresholds.${severity}`, 'must be >= 1');
    }
  }
  validatePrerequisiteExceptions(state, issues);
  validateRequirements(state, issues);
  return issues;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderEvidence(items, prefix = '') {
  if (!items || items.length === 0) return '—';
  return items.map(item => `[${escapeCell(item.label)}](${prefix}${item.file})`).join(', ');
}

function renderPackageTable(state) {
  const lines = [
    '| Order | Package | Status | Durable outcome / purpose | Evidence |',
    '|---:|---|---|---|---|',
  ];
  for (const pkg of [...state.packages].sort((a, b) => a.order - b.order)) {
    const status = pkg.status === 'closed' ? `CLOSED ${pkg.closedOn}` : pkg.status.toUpperCase();
    lines.push(`| ${pkg.order} | ${escapeCell(pkg.id)} | ${status} | ${escapeCell(pkg.outcome)} | ${renderEvidence(pkg.handoffs)} |`);
  }
  return lines.join('\n');
}

function formatOrderRanges(values) {
  const nums = [...new Set(values)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    const start = nums[i];
    let end = start;
    while (i + 1 < nums.length && nums[i + 1] === end + 1) end = nums[++i];
    parts.push(start === end ? String(start) : `${start}–${end}`);
  }
  return parts.join(', ');
}

function renderProcessSnapshot(state) {
  const lines = [];
  const active = resolveActivePackages(state);
  if (active.length === 0) lines.push('No implementation package is active.');
  else if (active.length === 1) lines.push(`Active implementation package: **${active[0]}**.`);
  else lines.push(`Active implementation packages: **${active.join('**, **')}**.`);
  const closed = state.packages.filter(pkg => pkg.status === 'closed').map(pkg => pkg.order);
  const deferred = state.packages.filter(pkg => pkg.status === 'deferred').map(pkg => pkg.order);
  const open = state.packages.filter(pkg => pkg.status === 'open').map(pkg => pkg.order);
  const blocked = state.packages.filter(pkg => pkg.status === 'blocked').map(pkg => pkg.order);
  const parts = [];
  if (closed.length) parts.push(`CLOSED: ${formatOrderRanges(closed)}`);
  if (open.length) parts.push(`OPEN: ${formatOrderRanges(open)}`);
  if (blocked.length) parts.push(`BLOCKED: ${formatOrderRanges(blocked)}`);
  if (deferred.length) parts.push(`DEFERRED: ${formatOrderRanges(deferred)}`);
  lines.push(`Package state — ${parts.join('; ')}.`);
  lines.push(`Latest product evidence: [${state.latestProductHandoff}](../docs/${state.latestProductHandoff}).`);
  lines.push(`Latest process evidence: [${state.latestProcessHandoff}](../docs/${state.latestProcessHandoff}).`);
  return lines.join('\n');
}

function renderOwnerTails(state) {
  return state.ownerTails.map((tail, index) => {
    const evidence = tail.evidence.length ? ` Evidence: ${renderEvidence(tail.evidence, '../docs/')}.` : '';
    return `${index + 1}. **[TAIL:${tail.id}] ${tail.title}:** ${tail.summary}\n` +
      `   Next: ${tail.nextAction}${evidence}`;
  }).join('\n');
}

function marker(name, side) {
  return `<!-- process-state:${name}:${side} -->`;
}

function extractManagedBlock(text, name) {
  const start = marker(name, 'start');
  const end = marker(name, 'end');
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);
  if (startAt < 0 || endAt < 0 || endAt < startAt || text.indexOf(start, startAt + 1) >= 0 || text.indexOf(end, endAt + 1) >= 0) {
    throw new Error(`managed block ${name} must have exactly one ordered marker pair`);
  }
  return text.slice(startAt + start.length, endAt).replace(/^\r?\n|\r?\n$/g, '').replace(/\r\n/g, '\n');
}

function replaceManagedBlock(text, name, content) {
  const start = marker(name, 'start');
  const end = marker(name, 'end');
  extractManagedBlock(text, name);
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = String(content).replace(/\r?\n/g, eol);
  return text.slice(0, startAt + start.length) + eol + body + eol + text.slice(endAt);
}

function parseEvents(text) {
  const records = [];
  const issues = [];
  const ids = new Set();
  const seenBaseEvents = new Set();
  String(text).split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); }
    catch (error) {
      issues.push({ code: 'json', line: index + 1, message: error.message });
      return;
    }
    const at = `line ${index + 1}`;
    if (!isObject(event) || event.schemaVersion !== 1) issues.push({ code: 'version', line: index + 1, message: `${at}: schemaVersion must equal 1` });
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(event.id || '')) issues.push({ code: 'id', line: index + 1, message: `${at}: id must use letters, digits and hyphens` });
    else if (ids.has(event.id)) issues.push({ code: 'duplicate', line: index + 1, message: `${at}: duplicate id ${event.id}` });
    else ids.add(event.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date || '')) issues.push({ code: 'date', line: index + 1, message: `${at}: date must be YYYY-MM-DD` });
    if (!EVENT_KINDS.has(event.kind)) issues.push({ code: 'kind', line: index + 1, message: `${at}: unsupported kind` });
    if (!nonEmpty(event.summary)) issues.push({ code: 'required', line: index + 1, message: `${at}: summary is required` });
    if (!Array.isArray(event.evidence) || event.evidence.length === 0 || event.evidence.some(item => !nonEmpty(item))) issues.push({ code: 'evidence', line: index + 1, message: `${at}: evidence must contain non-empty strings` });
    if (event.kind === 'resolution') {
      if (!Array.isArray(event.resolves) || event.resolves.length === 0 || event.resolves.some(item => !nonEmpty(item))) {
        issues.push({ code: 'resolution', line: index + 1, message: `${at}: resolves must name event IDs` });
      } else {
        for (const id of event.resolves) {
          if (!seenBaseEvents.has(id)) issues.push({ code: 'resolution-ref', line: index + 1, message: `${at}: ${id} is not a prior base event` });
        }
      }
    } else {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(event.ruleKey || '')) issues.push({ code: 'ruleKey', line: index + 1, message: `${at}: ruleKey must be kebab-case` });
      if (!SEVERITIES.includes(event.severity)) issues.push({ code: 'severity', line: index + 1, message: `${at}: unsupported severity` });
      if (nonEmpty(event.id)) seenBaseEvents.add(event.id);
    }
    records.push(event);
  });
  return { records, issues };
}

function unresolvedEvents(records) {
  const resolved = new Set();
  records.filter(event => event.kind === 'resolution').forEach(event => {
    (event.resolves || []).forEach(id => resolved.add(id));
  });
  return records.filter(event => event.kind !== 'resolution' && !resolved.has(event.id));
}

function proposalCandidates(records, thresholds) {
  const groups = new Map();
  for (const event of unresolvedEvents(records)) {
    if (!groups.has(event.ruleKey)) groups.set(event.ruleKey, []);
    groups.get(event.ruleKey).push(event);
  }
  const candidates = [];
  for (const [ruleKey, events] of groups) {
    const severity = events.reduce((max, event) =>
      SEVERITY_RANK[event.severity] > SEVERITY_RANK[max] ? event.severity : max, 'low');
    const threshold = thresholds[severity];
    if (events.length >= threshold) candidates.push({ ruleKey, severity, threshold, events });
  }
  return candidates.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

// 纯函数：对照登记源文本核查需求登记簿的锚点覆盖。
// 覆盖失败是阻塞检查，永远不由 --fix 自动修复（源文件是受保护权威）。
function evaluateRequirementCoverage(requirements, texts) {
  const issues = [];
  if (!isObject(requirements) || !Array.isArray(requirements.sources) || !Array.isArray(requirements.items)) {
    issues.push({ code: 'shape', file: '$', message: 'requirements registry is not loadable' });
    return issues;
  }
  for (const source of requirements.sources) {
    const text = texts[source.file];
    if (typeof text !== 'string') {
      issues.push({ code: 'missing-source', file: source.file, message: 'registered source text is unavailable' });
      continue;
    }
    let trackedRegex;
    try { trackedRegex = new RegExp(source.trackedLine); }
    catch (_) { continue; }
    const lines = String(text).split(/\r?\n/);
    const tracked = [];
    lines.forEach((line, index) => { if (trackedRegex.test(line)) tracked.push({ line, number: index + 1 }); });
    const items = requirements.items.filter(item => item.source === source.file);
    for (const item of items) {
      const covering = tracked.find(trackedLine => trackedLine.line.startsWith(item.anchor));
      if (!covering) issues.push({ code: 'stale-anchor', file: source.file, id: item.id, message: `anchor not found on any tracked line: ${item.anchor.slice(0, 60)}` });
    }
    for (const trackedLine of tracked) {
      const covering = items.filter(item => trackedLine.line.startsWith(item.anchor));
      if (covering.length > 1) issues.push({ code: 'duplicate-coverage', file: source.file, line: trackedLine.number, message: covering.map(item => item.id).join(', ') });
      if (covering.length === 0) issues.push({ code: 'unmapped-item', file: source.file, line: trackedLine.number, message: trackedLine.line.slice(0, 60) });
    }
  }
  return issues;
}

// 纯函数：对照已接受证据检查当前状态措辞的语义漂移。
// 只报告并指出提案/后续工单义务；从不自动修改受保护文档。
function evaluateSemanticStatus(docs) {
  const issues = [];
  const push = (rule, file, message, evidence) => issues.push({ rule, file, message, evidence });
  const linesOf = key => String(docs[key] || '').split(/\r?\n/);
  const scanned = Object.keys(docs);
  for (const key of ['spec', 'workplan', 'architecture']) {
    if (docs[key] === undefined) continue;
    for (const line of linesOf(key)) {
      if (/does not (yet )?natively round-trip all six kinds/i.test(line)) {
        push('stale-six-track-gap', key, `still claims the six-track round-trip gap that SIX-TRACK closed 2026-09-01: ${line.trim().slice(0, 80)}`,
          'HANDOFF-20260901-six-track-roundtrip.md');
      }
    }
  }
  for (const key of scanned) {
    for (const line of linesOf(key)) {
      if (/1[–-]3\s*dancers/i.test(line) && !/1[–-]12/.test(line)) {
        push('performer-range-wording', key, `claims 1–3 dancers without the source-validated 1–12 import range: ${line.trim().slice(0, 80)}`,
          'web project import validates 1–12 performers (SIX-TRACK evidence)');
      }
    }
  }
  if (docs.spec !== undefined) {
    const foundation = linesOf('spec').find(line => line.startsWith('- [x] Performance-script foundation:'));
    if (foundation && !/lossless/i.test(foundation)) {
      push('six-track-distinction', 'spec', 'the six-track foundation row must distinguish lossless round-trip from rich native editing', foundation.trim().slice(0, 80));
    }
    const execution = linesOf('spec').find(line => line.startsWith('- [x] Game-execution foundation:'));
    if (execution && !/rejects ability, movement and facing/i.test(execution)) {
      push('execution-gap-wording', 'spec', 'the execution foundation row must preserve that ability/movement/facing stay plugin-rejected before start', execution.trim().slice(0, 80));
    }
  }
  return issues;
}

function proposalFileName(ruleKey) {
  const safe = String(ruleKey).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('ruleKey cannot produce a safe proposal filename');
  return safe + '.md';
}

function renderProposal(candidate) {
  const lines = [
    `# Process proposal — ${candidate.ruleKey}`,
    '',
    'Status: PROPOSED',
    `Severity: ${candidate.severity}`,
    `Threshold: ${candidate.events.length}/${candidate.threshold}`,
    '',
    '## Trigger evidence',
    '',
  ];
  for (const event of candidate.events) {
    lines.push(`- ${event.id} (${event.date}, ${event.kind}): ${event.summary}`);
    for (const evidence of event.evidence) lines.push(`  - Evidence: ${evidence}`);
  }
  lines.push(
    '',
    '## Required review',
    '',
    '- Confirm the common root cause and reject coincidental grouping.',
    '- Change one canonical rule/check only; do not add another source of truth.',
    '- Assess product, security, compatibility and context-budget impact.',
    '- Add regression coverage and a rollback path.',
    '- Obtain owner approval if a protected rule or external action is affected.',
    '',
    '## Bounded next ticket action',
    '',
    'One follow-up ticket may only re-verify or canonically change the rule named above; unrelated scope is rejected and this proposal is never auto-promoted.',
    '',
    '## Decision',
    '',
    'Pending. Promotion and rejection are manual; append a resolution event after the decision.',
    '',
  );
  return lines.join('\n');
}

module.exports = {
  EVENT_KINDS,
  SEVERITIES,
  REQUIREMENT_STATES,
  validateState,
  resolveActivePackages,
  validateActivePackages,
  validateRequirements,
  evaluateRequirementCoverage,
  evaluateSemanticStatus,
  renderPackageTable,
  formatOrderRanges,
  renderProcessSnapshot,
  renderOwnerTails,
  extractManagedBlock,
  replaceManagedBlock,
  parseEvents,
  unresolvedEvents,
  proposalCandidates,
  proposalFileName,
  renderProposal,
};
