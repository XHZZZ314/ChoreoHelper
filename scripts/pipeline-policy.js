// AI 管线 V2 的纯策略层：校验策略/工单/交接制品，判定路径冲突与修复熔断。
// 不读写仓库、不调用网络；CLI、测试和未来 CI 共享同一套确定性规则。
// 项目专用配置来自 .agent/PIPELINE-POLICY.json 与 .agent/MODULES.json。
'use strict';

const crypto = require('crypto');

const TICKET_STATUSES = new Set(['draft', 'accepted', 'active', 'blocked', 'closed', 'cancelled']);
const REVIEW_VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES', 'ESCALATE']);
const REVIEW_LANES = new Set(['module', 'global', 'owner']);
const RUN_STATUSES = new Set(['active', 'completed', 'blocked', 'cancelled']);
const RUN_PHASES = new Set(['worker-active', 'worker-complete', 'repair-active']);
const INTERRUPT_KINDS = new Set(['requirement', 'hotfix', 'portfolio-review']);
const INTERRUPT_IMPACTS = new Set(['clarification', 'within-ticket', 'expands-scope', 'unrelated', 'direction-only', 'unknown']);
const PORTFOLIO_DECISIONS = new Set(['continue', 'reprioritize-future', 'revise-active-ticket', 'supersede-active-ticket', 'cancel-active-ticket']);
// 交接提示词契约：恰好六个小节、固定顺序；字数护栏按角色分级（normal / Planner / Global Reviewer）。
const HANDOFF_SECTIONS = ['ROLE', 'TASK', 'READ', 'DO', 'DO NOT', 'FINISH'];
const HANDOFF_WORD_BANDS = { standard: { min: 150, max: 300 }, expanded: { min: 300, max: 500 } };
const HANDOFF_EXPANDED_PROMPTS = new Set(['planner-intake', 'planner-replan', 'planner-portfolio', 'reviewer-global']);
const HANDOFF_STRUCTURED_PROMPTS = [
  'planner-intake', 'planner-replan', 'planner-portfolio', 'qa-lead', 'worker',
  'deterministic-gate', 'reviewer-module', 'reviewer-global', 'context-sync',
];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(issues, code, at, message) {
  issues.push({ code, path: at, message });
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (isObject(value)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function normalizeRepoPath(value) {
  if (!nonEmpty(value)) throw new Error('path must be non-empty');
  let result = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (/^[A-Za-z]:\//.test(result) || result.startsWith('/') || result === '..' || result.startsWith('../') || result.includes('/../')) {
    throw new Error(`path must be repository-relative: ${value}`);
  }
  if (result.endsWith('/') && !result.endsWith('/**')) result = result.slice(0, -1);
  return result;
}

function globRegExp(rule) {
  rule = normalizeRepoPath(rule);
  let source = '^';
  for (let i = 0; i < rule.length; i++) {
    const c = rule[i];
    if (c === '*' && rule[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') source += '[^/]*';
    else if ('\\^$+?.()|{}[]'.includes(c)) source += '\\' + c;
    else source += c;
  }
  return new RegExp(source + '$');
}

function matchesRule(repoPath, rule) {
  return globRegExp(rule).test(normalizeRepoPath(repoPath));
}

function staticPrefix(rule) {
  rule = normalizeRepoPath(rule);
  const wildcard = rule.search(/[*?]/);
  const prefix = wildcard < 0 ? rule : rule.slice(0, wildcard);
  return prefix.replace(/\/$/, '');
}

function rulesOverlap(left, right) {
  left = normalizeRepoPath(left);
  right = normalizeRepoPath(right);
  const leftWild = /[*?]/.test(left);
  const rightWild = /[*?]/.test(right);
  if (!leftWild && !rightWild) return left === right;
  if (!leftWild) return matchesRule(left, right);
  if (!rightWild) return matchesRule(right, left);
  const a = staticPrefix(left);
  const b = staticPrefix(right);
  if (!a || !b) return true;
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

function ruleContainedBy(rule, container) {
  rule = normalizeRepoPath(rule);
  container = normalizeRepoPath(container);
  const ruleWild = /[*?]/.test(rule);
  const containerWild = /[*?]/.test(container);
  if (!ruleWild) return containerWild ? matchesRule(rule, container) : rule === container;
  if (!containerWild) return false;
  const rulePrefix = staticPrefix(rule);
  const containerPrefix = staticPrefix(container);
  if (!containerPrefix) return true;
  return rulePrefix === containerPrefix || rulePrefix.startsWith(containerPrefix + '/');
}

function validatePathList(value, at, issues, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    add(issues, 'shape', at, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    try {
      const normalized = normalizeRepoPath(item);
      if (seen.has(normalized)) add(issues, 'duplicate', `${at}[${index}]`, `duplicates ${normalized}`);
      seen.add(normalized);
    } catch (error) { add(issues, 'path', `${at}[${index}]`, error.message); }
  });
}

function validatePolicy(policy) {
  const issues = [];
  if (!isObject(policy)) return [{ code: 'shape', path: '$', message: 'must be an object' }];
  if (policy.schemaVersion !== 1) add(issues, 'version', 'schemaVersion', 'must equal 1');
  if (!nonEmpty(policy.policyVersion)) add(issues, 'required', 'policyVersion', 'is required');
  const risks = policy.riskLevels;
  if (!isObject(risks)) add(issues, 'shape', 'riskLevels', 'must be an object');
  else for (const risk of ['R0', 'R1', 'R2', 'R3', 'R4']) {
    const item = risks[risk];
    if (!isObject(item)) add(issues, 'required', `riskLevels.${risk}`, 'is required');
    else {
      if (!Array.isArray(item.requiredGates)) add(issues, 'shape', `riskLevels.${risk}.requiredGates`, 'must be an array');
      if (!Array.isArray(item.requiredReviews) || item.requiredReviews.some(x => !REVIEW_LANES.has(x))) {
        add(issues, 'review', `riskLevels.${risk}.requiredReviews`, 'contains unsupported lane');
      }
    }
  }
  const repair = policy.repairPolicy;
  if (!isObject(repair)) add(issues, 'shape', 'repairPolicy', 'must be an object');
  else for (const key of ['maxRepairAttempts', 'maxReviewCorrectionCycles', 'hotfixMaxRepairAttempts', 'repeatFingerprintLimit']) {
    if (!Number.isInteger(repair[key]) || repair[key] < 1) add(issues, 'budget', `repairPolicy.${key}`, 'must be a positive integer');
  }
  if (!isObject(policy.budgets) || !isObject(policy.budgets.roleContextBytes)) add(issues, 'shape', 'budgets', 'must define roleContextBytes');
  else {
    for (const key of ['defaultContextBytes', 'maxContextFiles', 'maxChangedFiles', 'maxChangedLines', 'maxRunMinutes']) {
      if (!Number.isInteger(policy.budgets[key]) || policy.budgets[key] < 1) add(issues, 'budget', `budgets.${key}`, 'must be positive');
    }
    for (const [role, bytes] of Object.entries(policy.budgets.roleContextBytes)) {
      if (!Number.isInteger(bytes) || bytes < 1) add(issues, 'budget', `budgets.roleContextBytes.${role}`, 'must be positive');
    }
  }
  if (!isObject(policy.artifacts)) add(issues, 'shape', 'artifacts', 'must be an object');
  else for (const key of ['tickets', 'activeRuns', 'runHistory', 'modules', 'roles', 'templates', 'evidence']) {
    try { normalizeRepoPath(policy.artifacts[key]); } catch (error) { add(issues, 'path', `artifacts.${key}`, error.message); }
  }
  if (!isObject(policy.roleFiles) || Object.keys(policy.roleFiles).length < 7) add(issues, 'shape', 'roleFiles', 'must define all roles');
  else for (const [role, file] of Object.entries(policy.roleFiles)) {
    try { normalizeRepoPath(file); } catch (error) { add(issues, 'path', `roleFiles.${role}`, error.message); }
    if (!Number.isInteger(policy.budgets && policy.budgets.roleContextBytes && policy.budgets.roleContextBytes[role])) {
      add(issues, 'budget', `budgets.roleContextBytes.${role}`, 'must define a budget for every role');
    }
  }
  if (!isObject(policy.classConstraints)) add(issues, 'shape', 'classConstraints', 'must be an object');
  else for (const [name, constraint] of Object.entries(policy.classConstraints)) {
    if (!isObject(constraint)) add(issues, 'shape', `classConstraints.${name}`, 'must be an object');
    else {
      validatePathList(constraint.allowedWriteScopes, `classConstraints.${name}.allowedWriteScopes`, issues);
      validatePathList(constraint.forbiddenWriteScopes, `classConstraints.${name}.forbiddenWriteScopes`, issues, true);
      if (constraint.budgetOverrides !== undefined) {
        if (!isObject(constraint.budgetOverrides)) add(issues, 'shape', `classConstraints.${name}.budgetOverrides`, 'must be an object');
        else for (const key of ['maxChangedFiles', 'maxChangedLines', 'maxRunMinutes']) {
          if (!Number.isInteger(constraint.budgetOverrides[key]) || constraint.budgetOverrides[key] < 1) add(issues, 'budget', `classConstraints.${name}.budgetOverrides.${key}`, 'must be positive');
        }
      }
    }
  }
  return issues;
}

function validateModules(registry) {
  const issues = [];
  if (!isObject(registry) || registry.schemaVersion !== 1 || !Array.isArray(registry.modules) || registry.modules.length === 0) {
    return [{ code: 'shape', path: '$', message: 'must be schemaVersion 1 with non-empty modules' }];
  }
  const ids = new Set();
  registry.modules.forEach((module, index) => {
    const at = `modules[${index}]`;
    if (!isObject(module)) return add(issues, 'shape', at, 'must be an object');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(module.id || '')) add(issues, 'id', `${at}.id`, 'must be kebab-case');
    else if (ids.has(module.id)) add(issues, 'duplicate', `${at}.id`, `duplicates ${module.id}`);
    else ids.add(module.id);
    if (!nonEmpty(module.description)) add(issues, 'required', `${at}.description`, 'is required');
    validatePathList(module.roots, `${at}.roots`, issues);
    for (const key of ['context', 'state']) {
      try { normalizeRepoPath(module[key]); } catch (error) { add(issues, 'path', `${at}.${key}`, error.message); }
    }
    if (!Array.isArray(module.dependsOn)) add(issues, 'shape', `${at}.dependsOn`, 'must be an array');
  });
  registry.modules.forEach((module, index) => (module.dependsOn || []).forEach(dep => {
    if (!ids.has(dep)) add(issues, 'dependency', `modules[${index}].dependsOn`, `unknown module ${dep}`);
    if (dep === module.id) add(issues, 'dependency', `modules[${index}].dependsOn`, 'self dependency');
  }));
  return issues;
}

function moduleIds(registry) {
  return new Set((registry.modules || []).map(module => module.id));
}

function requiredControls(ticket, policy) {
  const risk = policy.riskLevels[ticket.risk] || { requiredGates: [], requiredReviews: [] };
  const reviews = new Set(risk.requiredReviews);
  for (const tag of ticket.tags || []) {
    if ((policy.globalReviewTriggers || []).includes(tag)) reviews.add('global');
  }
  return { gates: [...new Set(risk.requiredGates)], reviews: [...reviews] };
}

function validateTicket(ticket, policy, registry) {
  const issues = [];
  if (!isObject(ticket)) return [{ code: 'shape', path: '$', message: 'must be an object' }];
  if (ticket.artifactType !== 'task-ticket') add(issues, 'type', 'artifactType', 'must equal task-ticket');
  if (ticket.schemaVersion !== 1) add(issues, 'version', 'schemaVersion', 'must equal 1');
  if (!/^TASK-[A-Z0-9][A-Z0-9-]*$/.test(ticket.id || '')) add(issues, 'id', 'id', 'must be an uppercase TASK-* ID');
  if (!Number.isInteger(ticket.revision) || ticket.revision < 1) add(issues, 'revision', 'revision', 'must be positive');
  if (!TICKET_STATUSES.has(ticket.status)) add(issues, 'status', 'status', 'is unsupported');
  for (const key of ['class', 'title', 'ownerIntent', 'goal', 'primaryModule', 'documentationImpact', 'rollout', 'rollback']) {
    if (!nonEmpty(ticket[key])) add(issues, 'required', key, 'is required');
  }
  if (!policy.riskLevels[ticket.risk]) add(issues, 'risk', 'risk', 'is unsupported');
  if (!Array.isArray(ticket.tags)) add(issues, 'shape', 'tags', 'must be an array');
  if (!Array.isArray(ticket.nonGoals) || ticket.nonGoals.length === 0) add(issues, 'shape', 'nonGoals', 'must be non-empty');
  const knownModules = moduleIds(registry);
  if (!knownModules.has(ticket.primaryModule)) add(issues, 'module', 'primaryModule', 'is unknown');
  if (!Array.isArray(ticket.impactedModules) || !ticket.impactedModules.includes(ticket.primaryModule)) {
    add(issues, 'module', 'impactedModules', 'must include primaryModule');
  } else ticket.impactedModules.forEach((id, index) => {
    if (!knownModules.has(id)) add(issues, 'module', `impactedModules[${index}]`, `unknown module ${id}`);
  });
  validatePathList(ticket.contextFiles, 'contextFiles', issues);
  if (ticket.roleContextFiles !== undefined) {
    if (!isObject(ticket.roleContextFiles)) add(issues, 'shape', 'roleContextFiles', 'must be an object');
    else for (const [role, files] of Object.entries(ticket.roleContextFiles)) {
      if (!policy.roleFiles[role]) add(issues, 'role', `roleContextFiles.${role}`, 'uses unsupported role');
      validatePathList(files, `roleContextFiles.${role}`, issues);
    }
  }
  validatePathList(ticket.readScope, 'readScope', issues);
  validatePathList(ticket.writeScope, 'writeScope', issues);
  if (ticket.lockScope !== undefined) {
    validatePathList(ticket.lockScope, 'lockScope', issues);
    for (const lock of ticket.lockScope || []) {
      if (!(ticket.writeScope || []).some(write => ruleContainedBy(lock, write))) add(issues, 'scope', 'lockScope', `${lock} is outside writeScope`);
    }
  }
  validatePathList(ticket.prohibitedPaths, 'prohibitedPaths', issues, true);
  // 声明缺省时保持既有二进制失败行为；出现时才做 PNG 预算校验。
  if (ticket.binaryEvidenceBudget !== undefined) {
    for (const issue of validateBinaryEvidenceBudget(ticket.binaryEvidenceBudget, ticket)) issues.push(issue);
  }
  // 声明缺省时保持 legacy-v1 路径且不宣称 v2 保证；出现时才做门证据契约校验。
  if (ticket.gateContract !== undefined) {
    for (const issue of validateGateContract(ticket.gateContract, ticket, policy)) issues.push(issue);
  }
  for (const write of ticket.writeScope || []) for (const prohibited of ticket.prohibitedPaths || []) {
    if (rulesOverlap(write, prohibited)) add(issues, 'scope', 'writeScope', `${write} overlaps prohibited ${prohibited}`);
  }
  const constraint = policy.classConstraints[ticket.class];
  if (constraint) {
    for (const write of ticket.writeScope || []) {
      if (!(constraint.allowedWriteScopes || []).some(allowed => ruleContainedBy(write, allowed))) {
        add(issues, 'scope', 'writeScope', `${write} is outside ${ticket.class} allowlist`);
      }
      for (const forbidden of constraint.forbiddenWriteScopes || []) {
        if (rulesOverlap(write, forbidden)) add(issues, 'scope', 'writeScope', `${write} overlaps class-forbidden ${forbidden}`);
      }
    }
  }
  if (!Array.isArray(ticket.acceptanceCriteria) || ticket.acceptanceCriteria.length === 0) add(issues, 'acceptance', 'acceptanceCriteria', 'must be non-empty');
  else {
    const ids = new Set();
    ticket.acceptanceCriteria.forEach((criterion, index) => {
      const at = `acceptanceCriteria[${index}]`;
      if (!isObject(criterion)) return add(issues, 'shape', at, 'must be an object');
      if (!nonEmpty(criterion.id) || ids.has(criterion.id)) add(issues, 'id', `${at}.id`, 'must be unique and non-empty');
      ids.add(criterion.id);
      for (const key of ['given', 'when', 'then']) if (!nonEmpty(criterion[key])) add(issues, 'bdd', `${at}.${key}`, 'is required');
      if (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0 || criterion.evidence.some(x => !nonEmpty(x))) {
        add(issues, 'evidence', `${at}.evidence`, 'must contain deterministic evidence');
      }
    });
  }
  if (!Array.isArray(ticket.testPlan) || ticket.testPlan.length === 0) add(issues, 'test', 'testPlan', 'must be non-empty');
  if (!isObject(ticket.budgets)) add(issues, 'budget', 'budgets', 'must be an object');
  else for (const key of ['maxChangedFiles', 'maxChangedLines', 'maxRunMinutes', 'maxRepairAttempts']) {
    if (!Number.isInteger(ticket.budgets[key]) || ticket.budgets[key] < 1) add(issues, 'budget', `budgets.${key}`, 'must be positive');
  }
  if (ticket.budgets) {
    const override = constraint && constraint.budgetOverrides ? constraint.budgetOverrides : {};
    for (const key of ['maxChangedFiles', 'maxChangedLines', 'maxRunMinutes']) {
      const limit = override[key] || policy.budgets[key];
      if (Number.isInteger(ticket.budgets[key]) && Number.isInteger(limit) && ticket.budgets[key] > limit) add(issues, 'budget', `budgets.${key}`, `cannot exceed ${limit}`);
    }
  }
  if (ticket.budgets && ticket.budgets.maxRepairAttempts > policy.repairPolicy.maxRepairAttempts) {
    add(issues, 'budget', 'budgets.maxRepairAttempts', 'cannot exceed policy');
  }
  if (!Array.isArray(ticket.reviewLanes) || ticket.reviewLanes.some(lane => !REVIEW_LANES.has(lane))) {
    add(issues, 'review', 'reviewLanes', 'contains unsupported lane');
  } else {
    const controls = requiredControls(ticket, policy);
    controls.reviews.forEach(lane => {
      if (!ticket.reviewLanes.includes(lane)) add(issues, 'review', 'reviewLanes', `missing required ${lane} review`);
    });
  }
  return issues;
}

// 可选 PNG 证据预算：仅接受 schemaVersion 1 的显式声明（无通配、无绝对路径、无大小写别名），
// 每个路径必须同时落在 writeScope 与有效度量域（lockScope 或 writeScope）内；上限为正安全整数。
const BINARY_EVIDENCE_BUDGET_KEYS = new Set(['schemaVersion', 'paths', 'maxFiles', 'maxFileBytes', 'maxTotalBytes']);

function validateBinaryEvidenceBudget(budget, ticket) {
  const issues = [];
  if (!isObject(budget)) return [{ code: 'shape', path: 'binaryEvidenceBudget', message: 'must be an object' }];
  for (const key of Object.keys(budget)) {
    if (!BINARY_EVIDENCE_BUDGET_KEYS.has(key)) add(issues, 'unknown', `binaryEvidenceBudget.${key}`, 'is not part of binaryEvidenceBudget schemaVersion 1');
  }
  if (budget.schemaVersion !== 1) add(issues, 'version', 'binaryEvidenceBudget.schemaVersion', 'must equal 1');
  const paths = budget.paths;
  if (!Array.isArray(paths) || paths.length === 0) add(issues, 'shape', 'binaryEvidenceBudget.paths', 'must be a non-empty array');
  else {
    const exact = new Set();
    const caseFolded = new Set();
    const writeScopes = Array.isArray(ticket.writeScope) ? ticket.writeScope : [];
    const effectiveScope = Array.isArray(ticket.lockScope) && ticket.lockScope.length ? ticket.lockScope : writeScopes;
    paths.forEach((item, index) => {
      const at = `binaryEvidenceBudget.paths[${index}]`;
      if (typeof item !== 'string' || !item.trim()) return add(issues, 'path', at, 'must be a non-empty string');
      let normalized;
      try { normalized = normalizeRepoPath(item); } catch (error) { return add(issues, 'path', at, error.message); }
      if (/[*?]/.test(normalized)) add(issues, 'path', at, 'must be an explicit file path without globs');
      if (!normalized.endsWith('.png')) add(issues, 'path', at, 'must name an explicit .png file');
      if (exact.has(normalized)) add(issues, 'duplicate', at, `duplicates ${normalized}`);
      exact.add(normalized);
      const folded = normalized.toLowerCase();
      if (caseFolded.has(folded)) add(issues, 'duplicate', at, `case-folds to an already declared path: ${normalized}`);
      caseFolded.add(folded);
      if (!writeScopes.some(rule => ruleContainedBy(normalized, rule))) add(issues, 'scope', at, `${normalized} is outside writeScope`);
      if (!effectiveScope.some(rule => ruleContainedBy(normalized, rule))) add(issues, 'scope', at, `${normalized} is outside the effective measurement scope`);
    });
  }
  for (const key of ['maxFiles', 'maxFileBytes', 'maxTotalBytes']) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 1) add(issues, 'budget', `binaryEvidenceBudget.${key}`, 'must be a positive safe integer');
  }
  if (Array.isArray(paths) && Number.isSafeInteger(budget.maxFiles) && paths.length > 0 && budget.maxFiles > paths.length) {
    add(issues, 'budget', 'binaryEvidenceBudget.maxFiles', 'cannot exceed the declared path count');
  }
  return issues;
}

// 门证据契约 v2（TASK-20260907-GATE-INTEGRITY）：工单声明、运行冻结身份、门/评审语义
// 全部在此共享，供校验、next 与 finish 使用；契约缺省时保持 legacy-v1 路径不变。
const GATE_CONTRACT_VERSION = 2;
const GATE_CATEGORIES = new Set(['artifact', 'scope', 'targeted', 'module', 'integration', 'compatibility', 'security', 'recovery']);
const GATE_CONTRACT_CHECK_KEYS = new Set(['id', 'category', 'command', 'required', 'successExitCodes']);
const GATE_CHECK_STATUSES_V2 = new Set(['passed', 'failed', 'not-run', 'timed-out']);
const REVIEW_SEVERITIES_V2 = new Set(['P0', 'P1', 'P2', 'P3']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

// AC-1：工单级声明校验。只允许 schemaVersion/checks 两个契约键；检查项只允许五个键；
// id/category/command/required/successExitCodes 全部精确判定；testPlan 命令一一映射；
// 工单风险要求的每个门类别至少有一个 required 检查。
function validateGateContract(contract, ticket, policy) {
  const issues = [];
  if (!isObject(contract)) return [{ code: 'shape', path: 'gateContract', message: 'must be an object' }];
  for (const key of Object.keys(contract)) {
    if (key !== 'schemaVersion' && key !== 'checks') add(issues, 'unknown', `gateContract.${key}`, 'is not part of gateContract schemaVersion 2');
  }
  if (contract.schemaVersion !== GATE_CONTRACT_VERSION) add(issues, 'version', 'gateContract.schemaVersion', `must equal ${GATE_CONTRACT_VERSION}`);
  if (!Array.isArray(contract.checks) || contract.checks.length === 0) {
    add(issues, 'shape', 'gateContract.checks', 'must be a non-empty array');
    return issues;
  }
  const ids = new Set();
  const commands = new Set();
  const requiredCategories = new Set();
  contract.checks.forEach((check, index) => {
    const at = `gateContract.checks[${index}]`;
    if (!isObject(check)) return add(issues, 'shape', at, 'must be an object');
    for (const key of Object.keys(check)) {
      if (!GATE_CONTRACT_CHECK_KEYS.has(key)) add(issues, 'unknown', `${at}.${key}`, 'is not part of gateContract schemaVersion 2');
    }
    if (!nonEmpty(check.id)) add(issues, 'required', `${at}.id`, 'is required');
    else if (ids.has(check.id)) add(issues, 'duplicate', `${at}.id`, `duplicates ${check.id}`);
    else ids.add(check.id);
    if (!GATE_CATEGORIES.has(check.category)) add(issues, 'category', `${at}.category`, 'is unsupported');
    if (!nonEmpty(check.command)) add(issues, 'required', `${at}.command`, 'is required');
    else if (commands.has(check.command)) add(issues, 'duplicate', `${at}.command`, `duplicates ${check.command}`);
    else commands.add(check.command);
    if (typeof check.required !== 'boolean') add(issues, 'shape', `${at}.required`, 'must be a boolean');
    else if (check.required && GATE_CATEGORIES.has(check.category)) requiredCategories.add(check.category);
    if (!Array.isArray(check.successExitCodes) || check.successExitCodes.length === 0) {
      add(issues, 'shape', `${at}.successExitCodes`, 'must be a non-empty array');
    } else {
      const seen = new Set();
      check.successExitCodes.forEach((code, codeIndex) => {
        if (!Number.isSafeInteger(code)) add(issues, 'shape', `${at}.successExitCodes[${codeIndex}]`, 'must be a safe integer');
        else if (seen.has(code)) add(issues, 'duplicate', `${at}.successExitCodes[${codeIndex}]`, `duplicates ${code}`);
        else seen.add(code);
      });
    }
  });
  for (const planCommand of (isObject(ticket) && Array.isArray(ticket.testPlan) ? ticket.testPlan : [])) {
    const mapped = contract.checks.filter(check => isObject(check) && check.command === planCommand).length;
    if (mapped !== 1) add(issues, 'mapping', 'gateContract.checks', `testPlan command maps ${mapped} times: ${planCommand}`);
  }
  const riskGates = isObject(policy) && isObject(ticket) && policy.riskLevels && policy.riskLevels[ticket.risk]
    ? policy.riskLevels[ticket.risk].requiredGates || [] : [];
  for (const category of riskGates) {
    if (!requiredCategories.has(category)) add(issues, 'coverage', 'gateContract.checks', `risk ${ticket.risk} requires at least one required ${category} check`);
  }
  return issues;
}

// AC-2：可冻结 v2 契约的运行判定与工单副本一致性（工单+运行相遇处由 CLI 调用）。
function runUsesGateContractV2(run) {
  return !!run && run.gateContract !== undefined;
}

function runGateContractIssues(run, ticket) {
  if (!runUsesGateContractV2(run)) return [];
  if (!isObject(ticket) || ticket.gateContract === undefined) {
    return [{ code: 'contract', path: 'gateContract', message: `run ${run.runId} froze a gate contract but the accepted ticket declares none` }];
  }
  if (stableStringify(run.gateContract) !== stableStringify(ticket.gateContract)) {
    return [{ code: 'contract', path: 'gateContract', message: `run ${run.runId} frozen gate contract no longer matches the accepted ticket declaration` }];
  }
  return [];
}

// AC-3：v2 门证据语义：身份（版本 + 运行冻结哈希）、与冻结清单按 id/category/command/required
// 一一对应、状态/退出码矩阵、时长与证据哈希，以及聚合状态当且仅当全部冻结 required 通过。
function validateGateResultV2(gate, run) {
  if (!isObject(gate) || gate.artifactType !== 'gate-result' || gate.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a gate-result schemaVersion 1 object' }];
  }
  const issues = [];
  if (!runUsesGateContractV2(run) || !isObject(run.gateContract)) {
    return [{ code: 'contract', path: '$', message: 'v2 gate validation requires a run with a frozen gate contract' }];
  }
  if (gate.gateContractVersion !== GATE_CONTRACT_VERSION) add(issues, 'version', 'gateContractVersion', `must equal ${GATE_CONTRACT_VERSION}`);
  if (!SHA256_PATTERN.test(gate.gateContractHash || '') || gate.gateContractHash !== run.gateContractHash) {
    add(issues, 'hash', 'gateContractHash', 'must equal the lowercase run-frozen contract hash');
  }
  if (gate.ticketId !== run.ticketId || gate.ticketRevision !== run.ticketRevision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch against the run');
  if (gate.runId !== run.runId) add(issues, 'ticket', 'runId', 'does not match the claimed run');
  for (const key of ['id', 'sourceRevision']) if (!nonEmpty(gate[key])) add(issues, 'required', key, 'is required');
  if (!['passed', 'failed'].includes(gate.status)) add(issues, 'status', 'status', 'must be passed or failed');
  if (!Array.isArray(gate.failureFingerprints)) add(issues, 'shape', 'failureFingerprints', 'must be an array');
  const inventory = new Map((Array.isArray(run.gateContract.checks) ? run.gateContract.checks : [])
    .filter(check => isObject(check) && nonEmpty(check.id))
    .map(check => [check.id, check]));
  const gateChecks = Array.isArray(gate.checks) ? gate.checks : [];
  if (!Array.isArray(gate.checks) || gate.checks.length === 0) add(issues, 'checks', 'checks', 'must be non-empty');
  const seen = new Set();
  let comparable = true;
  gateChecks.forEach((check, index) => {
    const at = `checks[${index}]`;
    if (!isObject(check)) { add(issues, 'shape', at, 'must be an object'); comparable = false; return; }
    const frozen = nonEmpty(check.id) ? inventory.get(check.id) : undefined;
    if (!frozen) { add(issues, 'unknown', `${at}.id`, nonEmpty(check.id) ? `unknown check id ${check.id}` : 'must include a non-empty id'); comparable = false; return; }
    if (seen.has(check.id)) { add(issues, 'duplicate', `${at}.id`, `duplicates ${check.id}`); comparable = false; }
    seen.add(check.id);
    if (check.category !== frozen.category) add(issues, 'metadata', `${at}.category`, 'does not match the frozen inventory');
    if (check.command !== frozen.command) add(issues, 'metadata', `${at}.command`, 'does not match the frozen inventory');
    if (check.required !== frozen.required) add(issues, 'metadata', `${at}.required`, 'does not match the frozen inventory');
    if (!GATE_CHECK_STATUSES_V2.has(check.status)) add(issues, 'status', `${at}.status`, 'is unsupported');
    if (check.status === 'passed') {
      if (!Array.isArray(frozen.successExitCodes) || !frozen.successExitCodes.includes(check.exitCode)) {
        add(issues, 'evidence', `${at}.exitCode`, 'must be one of the frozen successExitCodes when passed');
      }
    } else if (check.status === 'failed') {
      if (!Number.isInteger(check.exitCode) || (Array.isArray(frozen.successExitCodes) && frozen.successExitCodes.includes(check.exitCode))) {
        add(issues, 'evidence', `${at}.exitCode`, 'must be an integer outside the frozen successExitCodes when failed');
      }
    } else if (check.exitCode !== null) {
      add(issues, 'evidence', `${at}.exitCode`, 'must be null when not-run or timed-out');
    }
    if (!Number.isInteger(check.durationMs) || check.durationMs < 0) add(issues, 'evidence', `${at}.durationMs`, 'must be a non-negative integer');
    if (!SHA256_PATTERN.test(check.evidenceHash || '')) add(issues, 'hash', `${at}.evidenceHash`, 'must be SHA-256');
  });
  for (const id of inventory.keys()) {
    if (!seen.has(id)) { add(issues, 'missing', 'checks', `frozen check is absent from the gate: ${id}`); comparable = false; }
  }
  if (comparable && ['passed', 'failed'].includes(gate.status)) {
    const requiredIds = [...inventory.values()].filter(check => check.required === true).map(check => check.id);
    const allRequiredPassed = requiredIds.every(id => {
      const check = gateChecks.find(item => item.id === id);
      return !!check && check.status === 'passed';
    });
    if (gate.status === 'passed' && !allRequiredPassed) add(issues, 'status', 'status', 'cannot pass while a frozen required check is not passed');
    if (gate.status === 'failed' && allRequiredPassed) add(issues, 'status', 'status', 'contradicts a fully passed frozen required set');
  }
  return issues;
}

// 唯一门证据语义入口：v2 运行走冻结契约；legacy 运行保持 v1；带 v2 标记的证据出现在
// legacy 运行上显式失败（unsupported），绝不静默当作 legacy。
function validateGateEvidence(gate, ticket, run) {
  if (runUsesGateContractV2(run)) return validateGateResultV2(gate, run);
  if (isObject(gate) && gate.gateContractVersion !== undefined) {
    return [{ code: 'version', path: 'gateContractVersion', message: 'v2 gate evidence is unsupported on a run without a frozen v2 contract' }];
  }
  return validateGateResult(gate, ticket);
}

// AC-4：v2 评审语义：版本、精确 gateId 与完整门制品的规范哈希绑定、P0–P3 严重度矩阵；
// gate 传 null 时只做形状/身份阶段（next 在门选定前先过滤）。
function validateReviewV2(review, ticket, gate) {
  if (!isObject(review) || review.artifactType !== 'review' || review.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a review schemaVersion 1 object' }];
  }
  const issues = [];
  if (review.ticketId !== ticket.id || review.ticketRevision !== ticket.revision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch');
  for (const key of ['id', 'runId']) if (!nonEmpty(review[key])) add(issues, 'required', key, 'is required');
  if (!REVIEW_LANES.has(review.lane) || !ticket.reviewLanes.includes(review.lane)) add(issues, 'review', 'lane', 'is not required by ticket');
  if (!REVIEW_VERDICTS.has(review.verdict)) add(issues, 'review', 'verdict', 'is unsupported');
  if (review.gateContractVersion !== GATE_CONTRACT_VERSION) add(issues, 'version', 'gateContractVersion', `must equal ${GATE_CONTRACT_VERSION}`);
  if (!nonEmpty(review.gateId)) add(issues, 'required', 'gateId', 'is required for a v2 review');
  if (!SHA256_PATTERN.test(review.gateHash || '')) add(issues, 'hash', 'gateHash', 'must be SHA-256');
  if (!Array.isArray(review.findings)) add(issues, 'shape', 'findings', 'must be an array');
  else review.findings.forEach((finding, index) => {
    if (!isObject(finding)) return add(issues, 'shape', `findings[${index}]`, 'must be an object');
    for (const key of ['evidence', 'requirement', 'impact', 'correction']) {
      if (!nonEmpty(finding[key])) add(issues, 'finding', `findings[${index}].${key}`, 'is required');
    }
    if (!REVIEW_SEVERITIES_V2.has(finding.severity)) add(issues, 'severity', `findings[${index}].severity`, 'must be P0, P1, P2 or P3');
  });
  if (review.verdict === 'APPROVE' && Array.isArray(review.findings) && review.findings.some(finding => ['P0', 'P1'].includes(finding.severity))) {
    add(issues, 'review', 'verdict', 'cannot approve with P0/P1 findings');
  }
  if (!Array.isArray(review.evidence) || review.evidence.length === 0) add(issues, 'evidence', 'evidence', 'must be non-empty');
  if (isObject(gate)) {
    if (review.gateId !== gate.id) add(issues, 'binding', 'gateId', 'must exactly equal the reviewed gate id');
    if (review.gateHash !== sha256(stableStringify(gate))) add(issues, 'binding', 'gateHash', 'must equal SHA-256 of the complete gate artifact');
  }
  return issues;
}

// v2 评审与门的精确绑定：完整门制品的规范哈希，证据散文不参与身份。
function reviewBindsGateV2(review, gate) {
  return !!review && !!gate && review.gateContractVersion === GATE_CONTRACT_VERSION &&
    review.gateId === gate.id && review.gateHash === sha256(stableStringify(gate));
}

// 唯一评审语义入口：v2 运行或 v2 标记的评审走 v2 语义；其余保持 legacy v1 不变。
function validateReviewEvidence(review, ticket, run, gate) {
  if (runUsesGateContractV2(run) || (isObject(review) && review.gateContractVersion !== undefined)) {
    return validateReviewV2(review, ticket, gate);
  }
  return validateReview(review, ticket);
}

function validateContextManifest(manifest, ticket, policy) {
  const issues = [];
  if (!isObject(manifest) || manifest.artifactType !== 'context-manifest' || manifest.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a context-manifest schemaVersion 1 object' }];
  }
  if (manifest.ticketId !== ticket.id || manifest.ticketRevision !== ticket.revision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch');
  if (manifest.policyVersion !== policy.policyVersion) add(issues, 'policy', 'policyVersion', 'does not match active policy');
  if (!policy.roleFiles[manifest.role]) add(issues, 'role', 'role', 'is unsupported');
  for (const key of ['runId', 'sourceRevision', 'createdAt', 'contextHash']) if (!nonEmpty(manifest[key])) add(issues, 'required', key, 'is required');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) add(issues, 'files', 'files', 'must be non-empty');
  else manifest.files.forEach((file, index) => {
    if (!isObject(file)) return add(issues, 'shape', `files[${index}]`, 'must be an object');
    try { normalizeRepoPath(file.path); } catch (error) { add(issues, 'path', `files[${index}].path`, error.message); }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) add(issues, 'hash', `files[${index}].sha256`, 'must be SHA-256');
    if (!nonEmpty(file.reason)) add(issues, 'required', `files[${index}].reason`, 'is required');
  });
  validatePathList(manifest.writeScope, 'writeScope', issues);
  if (stableStringify(manifest.writeScope) !== stableStringify(ticket.writeScope)) add(issues, 'scope', 'writeScope', 'must match accepted ticket');
  const identity = {
    ticketId: manifest.ticketId,
    ticketRevision: manifest.ticketRevision,
    policyVersion: manifest.policyVersion,
    role: manifest.role,
    sourceRevision: manifest.sourceRevision,
    files: manifest.files,
  };
  if (manifest.contextHash !== sha256(stableStringify(identity))) add(issues, 'hash', 'contextHash', 'does not match context identity');
  const roleBudget = policy.budgets.roleContextBytes[manifest.role];
  if (!Number.isInteger(manifest.budgetBytes) || !roleBudget || manifest.budgetBytes > roleBudget) add(issues, 'budget', 'budgetBytes', 'exceeds role budget');
  return issues;
}

function validateModuleChange(change, ticket, registry) {
  const issues = [];
  if (!isObject(change) || change.artifactType !== 'module-change' || change.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a module-change schemaVersion 1 object' }];
  }
  if (change.ticketId !== ticket.id || change.ticketRevision !== ticket.revision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch');
  if (!ticket.impactedModules.includes(change.moduleId) || !moduleIds(registry).has(change.moduleId)) add(issues, 'module', 'moduleId', 'is not an impacted registered module');
  if (!nonEmpty(change.summary)) add(issues, 'required', 'summary', 'is required');
  if (!Array.isArray(change.nonChanges) || change.nonChanges.length === 0) add(issues, 'shape', 'nonChanges', 'must be non-empty');
  validatePathList(change.files, 'files', issues, true);
  for (const file of change.files || []) if (!(ticket.writeScope || []).some(rule => matchesRule(file, rule))) {
    add(issues, 'scope', 'files', `${file} is outside ticket write scope`);
  }
  if (!Array.isArray(change.tests)) add(issues, 'shape', 'tests', 'must be an array');
  else change.tests.forEach((test, index) => {
    if (!isObject(test) || !nonEmpty(test.id) || !['passed', 'failed', 'not-run'].includes(test.status) || !nonEmpty(test.evidence)) {
      add(issues, 'test', `tests[${index}]`, 'must include id, status and evidence');
    }
  });
  for (const key of ['rollback', 'documentationImpact']) if (!nonEmpty(change[key])) add(issues, 'required', key, 'is required');
  return issues;
}

function validateGateResult(gate, ticket) {
  const issues = [];
  if (!isObject(gate) || gate.artifactType !== 'gate-result' || gate.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a gate-result schemaVersion 1 object' }];
  }
  if (gate.ticketId !== ticket.id || gate.ticketRevision !== ticket.revision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch');
  for (const key of ['id', 'runId', 'sourceRevision']) if (!nonEmpty(gate[key])) add(issues, 'required', key, 'is required');
  if (!['passed', 'failed'].includes(gate.status)) add(issues, 'status', 'status', 'must be passed or failed');
  if (!Array.isArray(gate.checks) || gate.checks.length === 0) add(issues, 'checks', 'checks', 'must be non-empty');
  else gate.checks.forEach((check, index) => {
    const at = `checks[${index}]`;
    if (!isObject(check) || !nonEmpty(check.id)) add(issues, 'shape', at, 'must include id');
    if (!['passed', 'failed', 'not-run'].includes(check.status)) add(issues, 'status', `${at}.status`, 'is unsupported');
    if (!Number.isInteger(check.exitCode) || !Number.isInteger(check.durationMs) || check.durationMs < 0) add(issues, 'evidence', at, 'must include exitCode and durationMs');
    if (!/^[a-f0-9]{64}$/.test(check.evidenceHash || '')) add(issues, 'hash', `${at}.evidenceHash`, 'must be SHA-256');
  });
  if (gate.status === 'passed' && (gate.checks || []).some(check => check.required && check.status !== 'passed')) {
    add(issues, 'status', 'status', 'cannot pass while a required check is not passed');
  }
  if (!Array.isArray(gate.failureFingerprints)) add(issues, 'shape', 'failureFingerprints', 'must be an array');
  // 可归因运行的门证据可携带度量命令身份与基线哈希；缺失由 finish 按运行归因性上下文判定。
  if (gate.measureCommand !== undefined && !nonEmpty(gate.measureCommand)) add(issues, 'required', 'measureCommand', 'must be a non-empty command identity');
  if (gate.baselineHash !== undefined && !/^[a-f0-9]{64}$/.test(gate.baselineHash)) add(issues, 'hash', 'baselineHash', 'must be SHA-256');
  return issues;
}

function validateReview(review, ticket) {
  const issues = [];
  if (!isObject(review) || review.artifactType !== 'review' || review.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a review schemaVersion 1 object' }];
  }
  if (review.ticketId !== ticket.id || review.ticketRevision !== ticket.revision) add(issues, 'ticket', 'ticketId', 'ticket identity/revision mismatch');
  for (const key of ['id', 'runId']) if (!nonEmpty(review[key])) add(issues, 'required', key, 'is required');
  if (!REVIEW_LANES.has(review.lane) || !ticket.reviewLanes.includes(review.lane)) add(issues, 'review', 'lane', 'is not required by ticket');
  if (!REVIEW_VERDICTS.has(review.verdict)) add(issues, 'review', 'verdict', 'is unsupported');
  if (!Array.isArray(review.findings)) add(issues, 'shape', 'findings', 'must be an array');
  else review.findings.forEach((finding, index) => {
    if (!isObject(finding)) return add(issues, 'shape', `findings[${index}]`, 'must be an object');
    for (const key of ['severity', 'evidence', 'requirement', 'impact', 'correction']) {
      if (!nonEmpty(finding[key])) add(issues, 'finding', `findings[${index}].${key}`, 'is required');
    }
  });
  if (review.verdict === 'APPROVE' && Array.isArray(review.findings) && review.findings.some(finding => ['critical', 'high', 'blocking'].includes(finding.severity))) {
    add(issues, 'review', 'verdict', 'cannot approve with blocking findings');
  }
  if (!Array.isArray(review.evidence) || review.evidence.length === 0) add(issues, 'evidence', 'evidence', 'must be non-empty');
  return issues;
}

function validateRunManifest(run, policy) {
  const issues = [];
  if (!isObject(run) || run.artifactType !== 'run-manifest' || run.schemaVersion !== 1) {
    return [{ code: 'shape', path: '$', message: 'must be a run-manifest schemaVersion 1 object' }];
  }
  for (const key of ['runId', 'ticketId', 'sourceRevision', 'policyVersion', 'role', 'startedAt', 'contextHash']) {
    if (!nonEmpty(run[key])) add(issues, 'required', key, 'is required');
  }
  if (run.policyVersion !== policy.policyVersion) add(issues, 'policy', 'policyVersion', 'does not match active policy');
  if (!policy.roleFiles[run.role]) add(issues, 'role', 'role', 'is unsupported');
  if (!RUN_STATUSES.has(run.status)) add(issues, 'status', 'status', 'is unsupported');
  if (!Number.isInteger(run.ticketRevision) || run.ticketRevision < 1) add(issues, 'ticket', 'ticketRevision', 'must be positive');
  validatePathList(run.writeScope, 'writeScope', issues);
  if (run.lockScope !== undefined) {
    validatePathList(run.lockScope, 'lockScope', issues);
    for (const lock of run.lockScope || []) {
      if (!(run.writeScope || []).some(write => ruleContainedBy(lock, write))) add(issues, 'scope', 'lockScope', `${lock} is outside writeScope`);
    }
  }
  if (!Array.isArray(run.contextFiles) || run.contextFiles.length === 0) add(issues, 'context', 'contextFiles', 'must be non-empty');
  else run.contextFiles.forEach((file, index) => {
    if (!isObject(file)) return add(issues, 'shape', `contextFiles[${index}]`, 'must be an object');
    try { normalizeRepoPath(file.path); } catch (error) { add(issues, 'path', `contextFiles[${index}].path`, error.message); }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) add(issues, 'hash', `contextFiles[${index}].sha256`, 'must be SHA-256');
  });
  const identity = {
    ticketId: run.ticketId,
    ticketRevision: run.ticketRevision,
    policyVersion: run.policyVersion,
    role: run.role,
    sourceRevision: run.sourceRevision,
    files: run.contextFiles,
  };
  if (run.contextHash !== sha256(stableStringify(identity))) add(issues, 'hash', 'contextHash', 'does not match context identity');
  if (!Number.isInteger(run.contextBytes) || run.contextBytes < 1) add(issues, 'context', 'contextBytes', 'must be positive');
  if (!Number.isInteger(run.repairAttempts) || run.repairAttempts < 0) add(issues, 'attempt', 'repairAttempts', 'must be >= 0');
  if (run.phase !== undefined && !RUN_PHASES.has(run.phase)) add(issues, 'phase', 'phase', 'is unsupported');
  if (run.roleCheckpoints !== undefined) {
    if (!Array.isArray(run.roleCheckpoints)) add(issues, 'shape', 'roleCheckpoints', 'must be an array');
    else run.roleCheckpoints.forEach((checkpoint, index) => {
      if (!isObject(checkpoint) || !nonEmpty(checkpoint.role) || !nonEmpty(checkpoint.phase) || !nonEmpty(checkpoint.at)) {
        add(issues, 'checkpoint', `roleCheckpoints[${index}]`, 'must include role, phase and at');
      }
    });
  }
  // 可归因计时段与基线引用：新认领必带；缺失即 legacy-unattributed，仍可读。
  if (run.timing !== undefined) {
    if (!isObject(run.timing)) add(issues, 'shape', 'timing', 'must be an object');
    else {
      if (!['active', 'waiting', 'closed'].includes(run.timing.state)) add(issues, 'timing', 'timing.state', 'must be active, waiting or closed');
      if (!nonEmpty(run.timing.stateSince)) add(issues, 'required', 'timing.stateSince', 'is required');
      for (const key of ['activeMs', 'waitMs']) {
        if (!Number.isInteger(run.timing[key]) || run.timing[key] < 0) add(issues, 'timing', `timing.${key}`, 'must be an integer >= 0');
      }
    }
  }
  if (run.baseline !== undefined) {
    if (!isObject(run.baseline)) add(issues, 'shape', 'baseline', 'must be an object');
    else if (!/^[a-f0-9]{64}$/.test(run.baseline.manifestHash || '')) add(issues, 'baseline', 'baseline.manifestHash', 'must be SHA-256');
  }
  // 冻结的门证据契约（AC-2）：三字段同现；版本只认 2；哈希按运行身份重算，篡改/降级/缺字段失败关闭。
  if (run.gateContract !== undefined || run.gateContractVersion !== undefined || run.gateContractHash !== undefined) {
    if (run.gateContract === undefined || run.gateContractVersion === undefined || run.gateContractHash === undefined) {
      add(issues, 'required', 'gateContract', 'frozen gate contract requires gateContract, gateContractVersion and gateContractHash together');
    } else {
      if (run.gateContractVersion !== GATE_CONTRACT_VERSION) add(issues, 'version', 'gateContractVersion', `must equal ${GATE_CONTRACT_VERSION}`);
      const expected = sha256(stableStringify({
        ticketId: run.ticketId, ticketRevision: run.ticketRevision, runId: run.runId, gateContract: run.gateContract,
      }));
      if (!SHA256_PATTERN.test(run.gateContractHash || '') || run.gateContractHash !== expected) {
        add(issues, 'hash', 'gateContractHash', 'does not match the run-bound contract identity');
      }
    }
  }
  return issues;
}

function validateRouting(routing) {
  const issues = [];
  if (!isObject(routing) || routing.schemaVersion !== 1) return [{ code: 'shape', path: '$', message: 'must be routing schemaVersion 1' }];
  if (!nonEmpty(routing.routingVersion)) add(issues, 'required', 'routingVersion', 'is required');
  if (!isObject(routing.controller)) add(issues, 'shape', 'controller', 'must be an object');
  else {
    if (routing.controller.sessionModel !== 'one-role-per-conversation') add(issues, 'controller', 'controller.sessionModel', 'must require one role per conversation');
    if (routing.controller.requireNewConversationForRoleChange !== true || routing.controller.currentConversationStopsAfterHandoff !== true) add(issues, 'controller', 'controller', 'must enforce a fresh conversation and stop after handoff');
    if (routing.controller.autoOpenConversation !== false) add(issues, 'controller', 'controller.autoOpenConversation', 'must be false unless an owner-authorized task launcher exists');
    const handoffFields = routing.controller.handoffRequiredFields;
    for (const field of ['nextRole', 'reason', 'requiredFiles', 'prompt', 'globalReviewRequired']) {
      if (!Array.isArray(handoffFields) || !handoffFields.includes(field)) add(issues, 'controller', 'controller.handoffRequiredFields', `missing ${field}`);
    }
    if (!Array.isArray(routing.controller.pauseOnlyFor) || routing.controller.pauseOnlyFor.length === 0) add(issues, 'controller', 'controller.pauseOnlyFor', 'must be non-empty');
    if (!Array.isArray(routing.controller.promptSections) || routing.controller.promptSections.join('|') !== HANDOFF_SECTIONS.join('|')) {
      add(issues, 'controller', 'controller.promptSections', `must equal ${HANDOFF_SECTIONS.join(', ')}`);
    }
  }
  const requiredOrder = ['planner', 'qa-lead', 'worker', 'deterministic-gate', 'reviewer:module', 'context-sync'];
  if (!Array.isArray(routing.roleOrder)) add(issues, 'shape', 'roleOrder', 'must be an array');
  else requiredOrder.forEach(role => { if (!routing.roleOrder.includes(role)) add(issues, 'role', 'roleOrder', `missing ${role}`); });
  if (!isObject(routing.reviewRules) || !isObject(routing.reviewRules.global) || !Array.isArray(routing.reviewRules.global.tags)) add(issues, 'review', 'reviewRules', 'must define global review triggers');
  if (!Array.isArray(routing.wakeRules) || routing.wakeRules.length === 0) add(issues, 'routing', 'wakeRules', 'must be non-empty');
  else {
    const priorities = new Set();
    routing.wakeRules.forEach((rule, index) => {
      if (!isObject(rule) || !Number.isInteger(rule.priority) || !nonEmpty(rule.when) || !nonEmpty(rule.next)) add(issues, 'routing', `wakeRules[${index}]`, 'must include priority, when and next');
      else if (priorities.has(rule.priority)) add(issues, 'duplicate', `wakeRules[${index}].priority`, 'must be unique');
      else priorities.add(rule.priority);
    });
  }
  const requirementImpacts = routing.interruptRules && routing.interruptRules.requirement;
  for (const impact of ['clarification', 'within-ticket', 'expands-scope', 'unrelated', 'unknown']) {
    if (!isObject(requirementImpacts && requirementImpacts[impact])) add(issues, 'interrupt', `interruptRules.requirement.${impact}`, 'is required');
  }
  const prompts = routing.prompts;
  for (const key of HANDOFF_STRUCTURED_PROMPTS) {
    const template = isObject(prompts) ? prompts[key] : undefined;
    for (const issue of validateHandoffTemplate(template)) {
      add(issues, issue.code, `prompts.${key}.${issue.path}`, issue.message);
    }
    if (isObject(template)) {
      for (const issue of validateHandoffPrompt(buildHandoffPrompt(template), key)) {
        add(issues, issue.code, `prompts.${key}.${issue.path}`, issue.message);
      }
    }
  }
  for (const key of ['owner', 'pipeline-governor']) {
    if (!isObject(prompts) || !nonEmpty(prompts[key])) add(issues, 'required', `prompts.${key}`, 'is required');
  }
  return issues;
}

function validateChangeRequest(request) {
  const issues = [];
  if (!isObject(request) || request.artifactType !== 'change-request' || request.schemaVersion !== 1) return [{ code: 'shape', path: '$', message: 'must be change-request schemaVersion 1' }];
  if (!/^INT-[A-Z0-9][A-Z0-9-]*$/.test(request.id || '')) add(issues, 'id', 'id', 'must be uppercase INT-*');
  if (!INTERRUPT_KINDS.has(request.kind)) add(issues, 'kind', 'kind', 'is unsupported');
  if (!nonEmpty(request.summary)) add(issues, 'required', 'summary', 'is required');
  if (!INTERRUPT_IMPACTS.has(request.impact)) add(issues, 'impact', 'impact', 'is unsupported');
  if (typeof request.blocking !== 'boolean') add(issues, 'shape', 'blocking', 'must be boolean');
  if (!['open', 'resolved'].includes(request.status)) add(issues, 'status', 'status', 'must be open or resolved');
  if (!nonEmpty(request.createdAt)) add(issues, 'required', 'createdAt', 'is required');
  if (request.ticketId !== '' && !/^TASK-[A-Z0-9][A-Z0-9-]*$/.test(request.ticketId || '')) add(issues, 'ticket', 'ticketId', 'must be empty or TASK-*');
  if (request.status === 'resolved' && !nonEmpty(request.decision)) add(issues, 'decision', 'decision', 'is required when resolved');
  return issues;
}

function validatePortfolioReview(review) {
  const issues = [];
  if (!isObject(review) || review.artifactType !== 'portfolio-review' || review.schemaVersion !== 1) return [{ code: 'shape', path: '$', message: 'must be portfolio-review schemaVersion 1' }];
  for (const key of ['id', 'interruptId', 'sourceRevision', 'reviewedAt']) if (!nonEmpty(review[key])) add(issues, 'required', key, 'is required');
  for (const key of ['scope', 'verifiedFacts', 'drift', 'risks', 'recommendations', 'ticketImpacts']) if (!Array.isArray(review[key])) add(issues, 'shape', key, 'must be an array');
  if (!PORTFOLIO_DECISIONS.has(review.decision)) add(issues, 'decision', 'decision', 'is unsupported');
  if (typeof review.ownerDecisionRequired !== 'boolean') add(issues, 'shape', 'ownerDecisionRequired', 'must be boolean');
  return issues;
}

function handoffWordBand(promptKey) {
  return HANDOFF_EXPANDED_PROMPTS.has(promptKey) ? HANDOFF_WORD_BANDS.expanded : HANDOFF_WORD_BANDS.standard;
}

function validateHandoffTemplate(template) {
  const issues = [];
  if (!isObject(template)) return [{ code: 'shape', path: '$', message: 'must be a handoff template object' }];
  for (const key of ['role', 'task']) {
    if (!nonEmpty(template[key])) add(issues, 'required', key, 'is required');
  }
  for (const key of ['read', 'do', 'doNot', 'finish']) {
    if (!Array.isArray(template[key]) || template[key].length === 0 || template[key].some(item => !nonEmpty(item))) {
      add(issues, 'shape', key, 'must be a non-empty array of non-empty strings');
    }
  }
  return issues;
}

function buildHandoffPrompt(template, taskLines = []) {
  const sections = {
    ROLE: String(template.role).trim(),
    TASK: [String(template.task).trim(), ...taskLines.map(line => String(line).trim())].filter(Boolean).join('\n'),
    READ: template.read.map(item => '- ' + String(item).trim()).join('\n'),
    DO: template.do.map(item => '- ' + String(item).trim()).join('\n'),
    'DO NOT': template.doNot.map(item => '- ' + String(item).trim()).join('\n'),
    FINISH: template.finish.map(item => '- ' + String(item).trim()).join('\n'),
  };
  return HANDOFF_SECTIONS.map(section => `${section}\n${sections[section]}`).join('\n\n');
}

function validateHandoffPrompt(prompt, promptKey) {
  const issues = [];
  const text = String(prompt);
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const headerAt = new Map();
  lines.forEach((line, index) => {
    if (HANDOFF_SECTIONS.includes(line) && !headerAt.has(line)) headerAt.set(line, index);
  });
  let previous = -1;
  for (const section of HANDOFF_SECTIONS) {
    if (!headerAt.has(section)) { add(issues, 'section', section, 'missing required section'); continue; }
    if (headerAt.get(section) <= previous) add(issues, 'section', section, 'is out of order or duplicated');
    previous = headerAt.get(section);
  }
  const known = new Set(HANDOFF_SECTIONS);
  lines.forEach((line, index) => {
    if (line && !known.has(line) && /^[A-Z][A-Z ]{1,18}$/.test(line)) {
      add(issues, 'section', `line ${index + 1}`, `unexpected extra section ${line}`);
    }
  });
  const body = section => {
    const start = headerAt.get(section);
    if (start === undefined) return '';
    const next = HANDOFF_SECTIONS.map(item => headerAt.get(item)).filter(index => index !== undefined && index > start).sort((left, right) => left - right)[0];
    return lines.slice(start + 1, next === undefined ? lines.length : next).join('\n').trim();
  };
  if (!/fresh conversation/i.test(body('ROLE'))) add(issues, 'content', 'ROLE', 'must state the role starts in a fresh conversation');
  for (const section of ['READ', 'DO', 'DO NOT']) {
    if (!body(section)) add(issues, 'content', section, 'must not be empty');
  }
  const finish = body('FINISH');
  for (const required of ['pipeline-cli.js next', 'verbatim', 'stop']) {
    if (!finish.includes(required)) add(issues, 'content', 'FINISH', `must state to run next, return verbatim and stop (missing ${required})`);
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const band = handoffWordBand(promptKey);
  if (words < band.min || words > band.max) {
    add(issues, 'budget', 'words', `${words} words outside ${band.min}-${band.max} band; revise content, never drop safety-critical items`);
  }
  return issues;
}

function scopesOverlap(left, right) {
  return (left || []).some(a => (right || []).some(b => rulesOverlap(a, b)));
}

function circuitDecision(attempts, policy, ticketClass = 'feature') {
  const repairLimit = ticketClass === 'hotfix' ? policy.repairPolicy.hotfixMaxRepairAttempts : policy.repairPolicy.maxRepairAttempts;
  const repairs = attempts.filter(attempt => attempt.kind === 'repair');
  if (attempts.some(attempt => (attempt.scopeViolations || []).length)) return { stop: true, reason: 'scope-violation' };
  if (attempts.some(attempt => attempt.severeRegression)) return { stop: true, reason: 'severe-regression' };
  if (attempts.some(attempt => attempt.budgetBreached)) return { stop: true, reason: 'budget-breach' };
  if (repairs.length > repairLimit) return { stop: true, reason: 'repair-budget-exhausted' };
  const failures = attempts.filter(attempt => nonEmpty(attempt.failureFingerprint));
  const limit = policy.repairPolicy.repeatFingerprintLimit;
  if (failures.length >= limit) {
    const recent = failures.slice(-limit);
    if (recent.every(item => item.failureFingerprint === recent[0].failureFingerprint)) {
      return { stop: true, reason: 'repeated-failure-fingerprint' };
    }
  }
  return { stop: false, reason: '' };
}

module.exports = {
  GATE_CONTRACT_VERSION,
  GATE_CATEGORIES,
  REVIEW_LANES,
  REVIEW_VERDICTS,
  TICKET_STATUSES,
  RUN_STATUSES,
  RUN_PHASES,
  HANDOFF_SECTIONS,
  HANDOFF_WORD_BANDS,
  HANDOFF_STRUCTURED_PROMPTS,
  stableStringify,
  sha256,
  normalizeRepoPath,
  matchesRule,
  staticPrefix,
  rulesOverlap,
  ruleContainedBy,
  scopesOverlap,
  handoffWordBand,
  validateHandoffTemplate,
  buildHandoffPrompt,
  validateHandoffPrompt,
  validatePolicy,
  validateModules,
  validateTicket,
  validateBinaryEvidenceBudget,
  validateGateContract,
  runUsesGateContractV2,
  runGateContractIssues,
  validateGateResultV2,
  validateGateEvidence,
  validateReviewV2,
  reviewBindsGateV2,
  validateReviewEvidence,
  validateContextManifest,
  validateModuleChange,
  validateGateResult,
  validateReview,
  validateRunManifest,
  validateRouting,
  validateChangeRequest,
  validatePortfolioReview,
  requiredControls,
  circuitDecision,
};
