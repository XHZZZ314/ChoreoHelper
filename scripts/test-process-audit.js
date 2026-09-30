// PROCESS-LOOP 集成红绿：在隔离临时仓库制造派生区块漂移与缺 proposal。
// 证明 --fix 只修 allowlist、修后全绿且幂等，并在无效状态/缺 marker 时拒绝写入。
// 不触碰真实工作区；临时目录在 finally 中精确清理。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const audit = require('./process-audit.js');
const policy = require('./process-policy.js');

let pass = 0;
let total = 0;
function check(name, condition) {
  total++;
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else console.error('  ✘ ' + name);
}
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
function put(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-process-audit-'));
try {
  const state = {
    schemaVersion: 1,
    activePackage: null,
    packages: [{
      order: 1, id: 'PKG-1', status: 'closed', closedOn: '2026-08-31', outcome: 'done',
      handoffs: [{ label: 'handoff', file: 'HANDOFF-test.md' }],
    }],
    ownerTails: [{
      id: 'OWNER-1', status: 'owner-bound', title: 'tail', summary: 'why', nextAction: 'next',
      evidence: [{ label: 'handoff', file: 'HANDOFF-test.md' }],
    }],
    latestProductHandoff: 'HANDOFF-test.md',
    latestProcessHandoff: 'HANDOFF-process.md',
    budgets: { defaultContextBytes: 10000, implementationContextBytes: 20000, maxOpenOwnerTails: 1 },
    evolution: {
      thresholds: { critical: 1, high: 1, medium: 2, low: 2 },
      autoFixTargets: ['backlog-package-index', 'continuity-process-snapshot', 'continuity-owner-tails', 'missing-process-proposals'],
      protectedFiles: ['AGENTS.md', 'SPEC.md', 'docs/HANDOFF-*', 'docs/archive-*'],
    },
  };
  const e1 = { schemaVersion: 1, id: 'E1', date: '2026-08-31', kind: 'repeated-error', ruleKey: 'same-rule', severity: 'medium', summary: 'one', evidence: ['a'] };
  const e2 = { ...e1, id: 'E2', summary: 'two' };
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(state, null, 2) + '\n');
  put(root, '.agent/process-events.jsonl', `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`);
  put(root, '.agent/process-proposals/README.md', '# proposals\n');
  put(root, 'AGENTS.md', '# rules\n');
  put(root, 'SPEC.md', '# spec\n');
  put(root, 'docs/README-AI.md', '# router\n');
  put(root, 'docs/HANDOFF-test.md', '# product evidence\n');
  put(root, 'docs/HANDOFF-process.md', '# process evidence\n');
  put(root, 'docs/AI-WORKFLOW.md', [
    '# workflow', '## 9. Self-correction and controlled evolution',
    'process-audit.js --fix', 'process-event.js', '',
  ].join('\n'));
  put(root, 'docs/AI-BACKLOG.md', [
    '# backlog', '<!-- process-state:packages:start -->', 'stale',
    '<!-- process-state:packages:end -->', '',
  ].join('\n'));
  put(root, '.agent/CONTINUITY.md', [
    '# continuity', '<!-- process-state:snapshot:start -->', 'stale snapshot',
    '<!-- process-state:snapshot:end -->', '<!-- process-state:tails:start -->', 'stale tails',
    '<!-- process-state:tails:end -->', '',
  ].join('\n'));

  const protectedBefore = {
    agents: fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    spec: fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8'),
    handoff: fs.readFileSync(path.join(root, 'docs/HANDOFF-test.md'), 'utf8'),
  };
  const red = audit.auditWorkspace(root);
  check('drift fixture starts red', !red.ok);
  check('red names both drift and missing proposal',
    red.checks.some(x => !x.ok && x.name.includes('backlog package index')) &&
    red.checks.some(x => !x.ok && x.name.includes('continuity snapshot')) &&
    red.checks.some(x => !x.ok && x.name.includes('continuity tails')) &&
    red.missingProposals.includes('same-rule'));

  const fixes = audit.applyFixes(root);
  check('fixes stay on allowlist',
    fixes.includes('backlog-package-index') && fixes.includes('continuity-derived-blocks') &&
    fixes.includes('proposal:same-rule') && fixes.length === 3);
  const green = audit.auditWorkspace(root);
  check('allowlisted repair turns fixture green', green.ok);
  check('backlog equals canonical render',
    policy.extractManagedBlock(fs.readFileSync(path.join(root, 'docs/AI-BACKLOG.md'), 'utf8'), 'packages') === policy.renderPackageTable(state));
  const proposal = fs.readFileSync(path.join(root, '.agent/process-proposals/same-rule.md'), 'utf8');
  check('threshold generated a review-only proposal', proposal.includes('Status: PROPOSED') && proposal.includes('Promotion and rejection are manual'));
  check('protected files remain byte-identical',
    fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') === protectedBefore.agents &&
    fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8') === protectedBefore.spec &&
    fs.readFileSync(path.join(root, 'docs/HANDOFF-test.md'), 'utf8') === protectedBefore.handoff);
  check('second fix is idempotent', audit.applyFixes(root).length === 0);

  const stateFile = path.join(root, '.agent/PROCESS-STATE.json');
  const validStateText = fs.readFileSync(stateFile, 'utf8');
  // AC-4：登记簿覆盖红绿；--fix 永不重建登记簿或保护源。
  const registryState = JSON.parse(validStateText);
  registryState.packages.push(
    { order: 2, id: 'PKG-2', status: 'open', outcome: 'work', handoffs: [] },
    { order: 3, id: 'PKG-3', status: 'open', outcome: 'more', handoffs: [] },
  );
  registryState.requirements = {
    schemaVersion: 1,
    sources: [{ file: 'SPEC.md', trackedLine: '^- \\[[ x]\\] ' }],
    items: [{
      id: 'REQ-SPEC-001', source: 'SPEC.md', anchor: '- [x] shipped feature',
      title: 'shipped feature', state: 'closed', dependsOn: [], basis: 'source-marker', evidence: [],
    }],
  };
  put(root, 'SPEC.md', '# spec\n- [x] shipped feature with evidence\n');
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(registryState, null, 2) + '\n');
  audit.applyFixes(root);
  check('registry with full anchor coverage passes', audit.auditWorkspace(root).ok);
  const specWithUnmapped = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8') + '- [ ] newly added tracked line\n';
  put(root, 'SPEC.md', specWithUnmapped);
  const registryRed = audit.auditWorkspace(root);
  check('unmapped tracked line fails coverage deterministically',
    !registryRed.ok && registryRed.checks.some(x => !x.ok && x.name.includes('登记簿覆盖全部源条目')));
  check('coverage repair never edits the protected source',
    audit.applyFixes(root).every(fix => !fix.includes('SPEC')) &&
    fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8') === specWithUnmapped);
  check('audit stays red after fix because coverage is not auto-repairable', !audit.auditWorkspace(root).ok);
  put(root, 'SPEC.md', '# spec\n- [x] shipped feature with evidence\n- [ ] planned work\n');
  const evidenceState = JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8'));
  evidenceState.requirements.items.push({
    id: 'REQ-SPEC-002', source: 'SPEC.md', anchor: '- [ ] planned work', title: 'planned work',
    state: 'deferred', dependsOn: [], evidence: [{ label: 'handoff', file: 'HANDOFF-missing.md' }],
  });
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(evidenceState, null, 2) + '\n');
  const missingEvidenceAudit = audit.auditWorkspace(root);
  check('missing requirement evidence fails the audit',
    !missingEvidenceAudit.ok && missingEvidenceAudit.checks.some(x => !x.ok && x.name.includes('登记簿证据引用存在')));
  put(root, 'docs/HANDOFF-missing.md', '# now present\n');
  check('registering the evidence file restores green', audit.auditWorkspace(root).ok);

  // AC-2：多活动包的派生视图收敛。
  const multiActiveState = JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8'));
  multiActiveState.activePackages = ['PKG-2', 'PKG-3'];
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(multiActiveState, null, 2) + '\n');
  check('multi-active drift starts red', !audit.auditWorkspace(root).ok);
  audit.applyFixes(root);
  const continuityText = fs.readFileSync(path.join(root, '.agent/CONTINUITY.md'), 'utf8');
  check('snapshot regenerates with the plural active package line',
    policy.extractManagedBlock(continuityText, 'snapshot').includes('Active implementation packages: **PKG-2**, **PKG-3**.'));
  check('multi-active repair is idempotent', audit.applyFixes(root).length === 0);
  put(root, '.agent/PROCESS-STATE.json', validStateText);
  audit.applyFixes(root);

  const invalid = JSON.parse(validStateText);
  invalid.activePackage = 'PKG-1';
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(invalid, null, 2));
  const backlogBeforeInvalidFix = fs.readFileSync(path.join(root, 'docs/AI-BACKLOG.md'), 'utf8');
  check('invalid state refuses fix before writes', throws(() => audit.applyFixes(root)) &&
    fs.readFileSync(path.join(root, 'docs/AI-BACKLOG.md'), 'utf8') === backlogBeforeInvalidFix);
  put(root, '.agent/PROCESS-STATE.json', validStateText);

  const overCap = JSON.parse(validStateText);
  overCap.ownerTails.push({ id: 'OWNER-2', status: 'owner-bound', title: 'tail2', summary: 'why', nextAction: 'next', evidence: [] });
  put(root, '.agent/PROCESS-STATE.json', JSON.stringify(overCap, null, 2) + '\n');
  audit.applyFixes(root);
  const capped = audit.auditWorkspace(root);
  check('owner-tail backlog over budget is a non-fatal warning',
    capped.ok && capped.warnings.some(x => x.name.includes('owner tails')) && capped.metrics.openOwnerTails === 2);
  put(root, '.agent/PROCESS-STATE.json', validStateText);
  audit.applyFixes(root);

  const backlogFile = path.join(root, 'docs/AI-BACKLOG.md');
  const continuityFile = path.join(root, '.agent/CONTINUITY.md');
  const staleBacklog = fs.readFileSync(backlogFile, 'utf8').replace('| done |', '| stale |');
  put(root, 'docs/AI-BACKLOG.md', staleBacklog);
  put(root, '.agent/CONTINUITY.md', fs.readFileSync(continuityFile, 'utf8').replace('<!-- process-state:tails:end -->', ''));
  check('missing later marker refuses every write', throws(() => audit.applyFixes(root)) &&
    fs.readFileSync(backlogFile, 'utf8') === staleBacklog);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`process-audit: ${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
