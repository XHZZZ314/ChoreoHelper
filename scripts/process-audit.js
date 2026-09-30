// 流程闭环审计器：对照机器状态检查派生文档、owner tails、事件阈值与上下文预算。
// --fix 只重建三个受控区块并补缺失 proposal；不会触碰 AGENTS、SPEC、handoff 或归档。
// 支持 --json 与 --root，便于自动化和隔离红绿测试。
'use strict';

const fs = require('fs');
const path = require('path');
const policy = require('./process-policy.js');

const STATE = '.agent/PROCESS-STATE.json';
const EVENTS = '.agent/process-events.jsonl';
const PROPOSALS = '.agent/process-proposals';
const BACKLOG = 'docs/AI-BACKLOG.md';
const CONTINUITY = '.agent/CONTINUITY.md';
const WORKFLOW = 'docs/AI-WORKFLOW.md';
const HARD_FIX_TARGETS = [
  'backlog-package-index',
  'continuity-process-snapshot',
  'continuity-owner-tails',
  'missing-process-proposals',
];

function normalize(text) {
  return String(text).replace(/\r\n/g, '\n').trim();
}

function bytes(root, files) {
  return files.reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: ok ? '' : String(detail || '') });
}

function readRequired(root, relative, checks) {
  const file = path.join(root, relative);
  const exists = fs.existsSync(file) && fs.statSync(file).isFile();
  addCheck(checks, `存在 ${relative}`, exists, 'missing');
  return exists ? fs.readFileSync(file, 'utf8') : null;
}

function auditWorkspace(root) {
  root = path.resolve(root);
  const checks = [];
  const warnings = [];
  const metrics = {};
  const stateText = readRequired(root, STATE, checks);
  const eventsText = readRequired(root, EVENTS, checks);
  const backlog = readRequired(root, BACKLOG, checks);
  const continuity = readRequired(root, CONTINUITY, checks);
  const workflow = readRequired(root, WORKFLOW, checks);
  for (const file of ['AGENTS.md', 'docs/README-AI.md']) readRequired(root, file, checks);
  const proposalDir = path.join(root, PROPOSALS);
  addCheck(checks, `存在 ${PROPOSALS}`, fs.existsSync(proposalDir) && fs.statSync(proposalDir).isDirectory(), 'missing directory');

  let state = null;
  if (stateText !== null) {
    try { state = JSON.parse(stateText); }
    catch (error) { addCheck(checks, 'PROCESS-STATE JSON 可解析', false, error.message); }
  }
  if (state) {
    const issues = policy.validateState(state);
    addCheck(checks, 'PROCESS-STATE schema 合法', issues.length === 0,
      issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));

    // 需求登记簿：schema 与覆盖都是阻塞检查；登记簿与源文件是权威，--fix 永不重建它们。
    const requirementIssues = state.requirements ? policy.validateRequirements(state) : [];
    addCheck(checks, '需求登记簿 schema 合法', requirementIssues.length === 0,
      requirementIssues.map(issue => `requirements.${issue.path}: ${issue.message}`).join('; '));
    if (requirementIssues.length === 0 && state.requirements) {
      const texts = {};
      for (const source of state.requirements.sources) {
        const sourceFile = path.join(root, source.file);
        texts[source.file] = fs.existsSync(sourceFile) && fs.statSync(sourceFile).isFile()
          ? fs.readFileSync(sourceFile, 'utf8') : undefined;
      }
      const coverage = policy.evaluateRequirementCoverage(state.requirements, texts);
      addCheck(checks, '登记簿覆盖全部源条目', coverage.length === 0,
        coverage.slice(0, 8).map(issue => `${issue.file}${issue.line ? ':' + issue.line : ''} ${issue.code}: ${issue.message}`).join('; ') +
        (coverage.length > 8 ? `; +${coverage.length - 8} more` : ''));
      const missingEvidence = new Set();
      for (const item of state.requirements.items) {
        for (const evidence of item.evidence || []) {
          const resolved = evidence.file.startsWith('HANDOFF-')
            ? path.join(root, 'docs', evidence.file) : path.join(root, evidence.file);
          if (!fs.existsSync(resolved)) missingEvidence.add(evidence.file);
        }
      }
      addCheck(checks, '登记簿证据引用存在', missingEvidence.size === 0, [...missingEvidence].join(', '));
    }
  }

  let eventResult = { records: [], issues: [] };
  if (eventsText !== null) {
    eventResult = policy.parseEvents(eventsText);
    addCheck(checks, 'process events JSONL 合法', eventResult.issues.length === 0,
      eventResult.issues.map(issue => issue.message).join('; '));
  }

  let candidates = [];
  let missingProposals = [];
  let invalidProposals = [];
  if (state && policy.validateState(state).length === 0) {
    const handoffs = new Set([state.latestProductHandoff, state.latestProcessHandoff]);
    state.packages.forEach(pkg => pkg.handoffs.forEach(item => handoffs.add(item.file)));
    state.ownerTails.forEach(tail => tail.evidence.forEach(item => handoffs.add(item.file)));
    (state.evolution.prerequisiteExceptions || []).forEach(exception =>
      (exception.evidence || []).forEach(item => handoffs.add(item.file)));
    const missingHandoffs = [...handoffs].filter(file => {
      const resolved = file.startsWith('HANDOFF-') ? path.join(root, 'docs', file) : path.join(root, file);
      return !fs.existsSync(resolved);
    });
    addCheck(checks, 'PROCESS-STATE handoff 证据存在', missingHandoffs.length === 0, missingHandoffs.join(', '));

    if (backlog !== null) {
      try {
        const actual = policy.extractManagedBlock(backlog, 'packages');
        const expected = policy.renderPackageTable(state);
        addCheck(checks, 'backlog package index 与机器状态一致', normalize(actual) === normalize(expected), 'run --fix');
      } catch (error) { addCheck(checks, 'backlog package index 受控标记合法', false, error.message); }
    }
    if (continuity !== null) {
      for (const [name, expected] of [
        ['snapshot', policy.renderProcessSnapshot(state)],
        ['tails', policy.renderOwnerTails(state)],
      ]) {
        try {
          const actual = policy.extractManagedBlock(continuity, name);
          addCheck(checks, `continuity ${name} 与机器状态一致`, normalize(actual) === normalize(expected), 'run --fix');
        } catch (error) { addCheck(checks, `continuity ${name} 受控标记合法`, false, error.message); }
      }
    }

    if (eventResult.issues.length === 0) {
      candidates = policy.proposalCandidates(eventResult.records, state.evolution.thresholds);
      missingProposals = candidates.filter(candidate =>
        !fs.existsSync(path.join(proposalDir, policy.proposalFileName(candidate.ruleKey))));
      addCheck(checks, '达到阈值的事件都有 proposal', missingProposals.length === 0,
        missingProposals.map(candidate => candidate.ruleKey).join(', '));
      invalidProposals = candidates.filter(candidate => {
        const file = path.join(proposalDir, policy.proposalFileName(candidate.ruleKey));
        if (!fs.existsSync(file)) return false;
        const text = fs.readFileSync(file, 'utf8');
        return !text.includes(`# Process proposal — ${candidate.ruleKey}`) ||
          !/^Status: (?:PROPOSED|PROMOTED|REJECTED)$/m.test(text) ||
          candidate.events.some(event => !text.includes(event.id));
      });
      addCheck(checks, 'proposal 保留身份、状态与触发证据', invalidProposals.length === 0,
        invalidProposals.map(candidate => candidate.ruleKey).join(', '));
    }

    if (workflow !== null) {
      addCheck(checks, 'workflow 定义受控自纠错与晋升门',
        /^## 9\. Self-correction and controlled evolution$/m.test(workflow) &&
        workflow.includes('process-audit.js --fix') && workflow.includes('process-event.js'),
        'missing canonical evolution section');
    }

    const requiredProtected = ['AGENTS.md', 'SPEC.md', 'docs/HANDOFF-*'];
    const protectedFiles = state.evolution.protectedFiles || [];
    addCheck(checks, '自动修复保护核心规则与历史',
      requiredProtected.every(item => protectedFiles.includes(item)), 'protectedFiles incomplete');
    const configuredTargets = [...(state.evolution.autoFixTargets || [])].sort();
    addCheck(checks, '自动修复目标与代码 allowlist 一致',
      JSON.stringify(configuredTargets) === JSON.stringify([...HARD_FIX_TARGETS].sort()),
      configuredTargets.join(', '));

    try {
      metrics.defaultContextBytes = bytes(root, ['AGENTS.md', 'docs/README-AI.md', CONTINUITY]);
      metrics.implementationContextBytes = metrics.defaultContextBytes + bytes(root, [WORKFLOW, BACKLOG]);
      addCheck(checks, '默认上下文预算内',
        metrics.defaultContextBytes <= state.budgets.defaultContextBytes,
        `${metrics.defaultContextBytes} > ${state.budgets.defaultContextBytes}`);
      addCheck(checks, '实施上下文预算内',
        metrics.implementationContextBytes <= state.budgets.implementationContextBytes,
        `${metrics.implementationContextBytes} > ${state.budgets.implementationContextBytes}`);
    } catch (error) { addCheck(checks, '上下文预算可计算', false, error.message); }

    metrics.openOwnerTails = state.ownerTails.length;
    metrics.maxOpenOwnerTails = state.budgets.maxOpenOwnerTails;
    addCheck(checks, 'owner tails 积压预算已评估', true);
    if (state.ownerTails.length > state.budgets.maxOpenOwnerTails) {
      warnings.push({
        name: 'owner tails 积压超过预算',
        detail: `${state.ownerTails.length} open tails > ${state.budgets.maxOpenOwnerTails}; resolve or merge owner-bound tails before queueing more`,
      });
    }
  }

  return {
    ok: checks.every(check => check.ok),
    root,
    checks,
    warnings,
    metrics,
    candidates: candidates.map(candidate => ({
      ruleKey: candidate.ruleKey,
      severity: candidate.severity,
      count: candidate.events.length,
      threshold: candidate.threshold,
      eventIds: candidate.events.map(event => event.id),
    })),
    missingProposals: missingProposals.map(candidate => candidate.ruleKey),
    invalidProposals: invalidProposals.map(candidate => candidate.ruleKey),
  };
}

function writeIfChanged(file, text, fixes, label) {
  const current = fs.readFileSync(file, 'utf8');
  if (current === text) return;
  fs.writeFileSync(file, text, 'utf8');
  fixes.push(label);
}

function applyFixes(root) {
  root = path.resolve(root);
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8'));
  const issues = policy.validateState(state);
  if (issues.length) throw new Error('refusing --fix with invalid PROCESS-STATE: ' + issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  const configuredTargets = [...(state.evolution.autoFixTargets || [])].sort();
  if (JSON.stringify(configuredTargets) !== JSON.stringify([...HARD_FIX_TARGETS].sort())) {
    throw new Error('refusing --fix because autoFixTargets differs from the hard allowlist');
  }
  const eventResult = policy.parseEvents(fs.readFileSync(path.join(root, EVENTS), 'utf8'));
  if (eventResult.issues.length) throw new Error('refusing --fix with invalid process events');
  const fixes = [];

  // Precompute every managed edit before the first write: any invalid marker aborts the whole fix.
  const backlogFile = path.join(root, BACKLOG);
  const backlogCurrent = fs.readFileSync(backlogFile, 'utf8');
  const backlogNext = policy.replaceManagedBlock(backlogCurrent, 'packages', policy.renderPackageTable(state));
  const continuityFile = path.join(root, CONTINUITY);
  const continuityCurrent = fs.readFileSync(continuityFile, 'utf8');
  let continuityNext = policy.replaceManagedBlock(continuityCurrent, 'snapshot', policy.renderProcessSnapshot(state));
  continuityNext = policy.replaceManagedBlock(continuityNext, 'tails', policy.renderOwnerTails(state));

  const proposalDir = path.join(root, PROPOSALS);
  const candidates = policy.proposalCandidates(eventResult.records, state.evolution.thresholds);
  const proposalWrites = [];
  for (const candidate of candidates) {
    const file = path.join(proposalDir, policy.proposalFileName(candidate.ruleKey));
    if (fs.existsSync(file)) continue;
    proposalWrites.push({ file, candidate, text: policy.renderProposal(candidate) });
  }

  writeIfChanged(backlogFile, backlogNext, fixes, 'backlog-package-index');
  writeIfChanged(continuityFile, continuityNext, fixes, 'continuity-derived-blocks');
  fs.mkdirSync(proposalDir, { recursive: true });
  for (const item of proposalWrites) {
    fs.writeFileSync(item.file, item.text, 'utf8');
    fixes.push(`proposal:${item.candidate.ruleKey}`);
  }
  return fixes;
}

function parseArgs(argv) {
  const args = { fix: false, json: false, root: path.resolve(__dirname, '..') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') continue;
    else if (argv[i] === '--fix') args.fix = true;
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function printHuman(result, fixes) {
  for (const check of result.checks) {
    const mark = check.ok ? '✓' : '✘';
    const detail = check.detail ? `: ${check.detail}` : '';
    (check.ok ? console.log : console.error)(`  ${mark} ${check.name}${detail}`);
  }
  for (const warning of result.warnings || []) console.warn(`  ⚠ ${warning.name}: ${warning.detail}`);
  if (fixes && fixes.length) console.log('  fixed: ' + fixes.join(', '));
  if (Object.keys(result.metrics).length) console.log('  metrics: ' + JSON.stringify(result.metrics));
  console.log(`Process audit: ${result.checks.filter(check => check.ok).length}/${result.checks.length}`);
}

function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  let fixes = [];
  try {
    if (args.fix) fixes = applyFixes(args.root);
    const result = auditWorkspace(args.root);
    if (args.json) console.log(JSON.stringify({ ...result, fixes }, null, 2));
    else printHuman(result, fixes);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    if (args.json) console.log(JSON.stringify({ ok: false, error: error.message, fixes }, null, 2));
    else console.error('Process audit failed: ' + error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { auditWorkspace, applyFixes, parseArgs };
