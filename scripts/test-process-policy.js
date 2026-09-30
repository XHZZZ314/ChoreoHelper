// PROCESS-LOOP 纯策略回归：状态 schema、派生区块、事件阈值、resolution 与提案生成。
// 也冻结事件 CLI 的确定性构造和仅追加/拒绝重复 ID 契约。
// 纯 Node；临时目录只建在 os.tmpdir() 并在 finally 清理。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const policy = require('./process-policy.js');
const eventCli = require('./process-event.js');

let pass = 0;
let total = 0;
function check(name, condition) {
  total++;
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else console.error('  ✘ ' + name);
}
function throws(fn) {
  try { fn(); return false; } catch (_) { return true; }
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const validState = {
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
  budgets: { defaultContextBytes: 100, implementationContextBytes: 200, maxOpenOwnerTails: 2 },
  evolution: {
    thresholds: { critical: 1, high: 1, medium: 2, low: 2 },
    autoFixTargets: [], protectedFiles: ['AGENTS.md', 'SPEC.md', 'docs/HANDOFF-*'],
  },
};

check('valid state accepted', policy.validateState(validState).length === 0);
const duplicateOrder = clone(validState);
duplicateOrder.packages.push({ ...clone(duplicateOrder.packages[0]), id: 'PKG-2' });
check('duplicate package order rejected', policy.validateState(duplicateOrder).some(x => x.code === 'duplicate' && x.path.endsWith('.order')));
const badActive = clone(validState);
badActive.activePackage = 'PKG-1';
check('active package must be OPEN', policy.validateState(badActive).some(x => x.code === 'active'));

// AC-2：活动包集合表示、legacy 迁移与损坏输入失败关闭。
const legacyActive = clone(validState);
legacyActive.packages.push({ order: 2, id: 'PKG-2', status: 'open', outcome: 'work', handoffs: [] });
legacyActive.activePackage = 'PKG-2';
check('legacy single-slot active package stays valid', policy.validateState(legacyActive).length === 0);
check('legacy active slot resolves through the shared resolver',
  JSON.stringify(policy.resolveActivePackages(legacyActive)) === JSON.stringify(['PKG-2']));
const setActive = clone(legacyActive);
setActive.activePackage = null;
setActive.activePackages = ['PKG-2'];
check('active package set accepted', policy.validateState(setActive).length === 0);
check('activePackages set resolves through the shared resolver',
  JSON.stringify(policy.resolveActivePackages(setActive)) === JSON.stringify(['PKG-2']));
const mixedSet = clone(setActive);
mixedSet.activePackage = 'PKG-2';
check('activePackages set must not mix with a non-null legacy slot',
  policy.validateState(mixedSet).some(x => x.path === 'activePackage' && x.code === 'active'));
const dupSet = clone(setActive);
dupSet.activePackages = ['PKG-2', 'PKG-2'];
check('duplicate active package IDs rejected', policy.validateState(dupSet).some(x => x.path.startsWith('activePackages') && x.code === 'duplicate'));
const closedSet = clone(setActive);
closedSet.activePackages = ['PKG-1'];
check('activePackages must not reference CLOSED packages', policy.validateState(closedSet).some(x => x.path === 'activePackages' && x.code === 'active'));
const unknownSet = clone(setActive);
unknownSet.activePackages = ['PKG-X'];
check('activePackages must reference existing packages', policy.validateState(unknownSet).some(x => x.path === 'activePackages' && x.code === 'active'));
const multiOpen = clone(setActive);
multiOpen.packages.push({ order: 3, id: 'PKG-3', status: 'open', outcome: 'more work', handoffs: [] });
multiOpen.activePackages = ['PKG-2', 'PKG-3'];
check('multi active package set accepted', policy.validateState(multiOpen).length === 0);
const missingHandoff = clone(validState);
missingHandoff.packages[0].handoffs = [];
check('closed package requires handoff', policy.validateState(missingHandoff).some(x => x.code === 'handoff'));
const duplicateTail = clone(validState);
duplicateTail.ownerTails.push(clone(duplicateTail.ownerTails[0]));
check('duplicate owner-tail ID rejected', policy.validateState(duplicateTail).some(x => x.path.endsWith('.id') && x.code === 'duplicate'));
const noTailCap = clone(validState);
delete noTailCap.budgets.maxOpenOwnerTails;
check('missing owner-tail backlog cap rejected', policy.validateState(noTailCap).some(x => x.path === 'budgets.maxOpenOwnerTails'));

const table = policy.renderPackageTable(validState);
check('package table freezes CLOSED date', table.includes('| 1 | PKG-1 | CLOSED 2026-08-31 |'));
check('package table renders handoff link', table.includes('[handoff](HANDOFF-test.md)'));
check('order ranges compact contiguous values', policy.formatOrderRanges([1, 2, 3, 5, 7, 8]) === '1–3, 5, 7–8');
check('snapshot names latest evidence', policy.renderProcessSnapshot(validState).includes('HANDOFF-process.md'));
check('snapshot renders one active package in the legacy form',
  policy.renderProcessSnapshot(legacyActive).includes('Active implementation package: **PKG-2**.'));
check('snapshot renders several active packages without a false single slot',
  policy.renderProcessSnapshot(multiOpen).includes('Active implementation packages: **PKG-2**, **PKG-3**.'));
check('owner tails carry stable ID and .agent-relative evidence',
  policy.renderOwnerTails(validState).includes('[TAIL:OWNER-1]') &&
  policy.renderOwnerTails(validState).includes('(../docs/HANDOFF-test.md)'));

// AC-3：前置倒置迁移例外的 schema。
const exceptionState = clone(validState);
exceptionState.evolution.prerequisiteExceptions = [{
  ticketId: 'TASK-A', prerequisiteId: 'TASK-B', note: 'recorded inversion',
  evidence: [{ label: 'resolution', file: '.agent/interrupts/history/INT-X.json' }],
}];
check('prerequisite exception accepts interruption-history evidence', policy.validateState(exceptionState).length === 0);
const brokenException = clone(exceptionState);
brokenException.evolution.prerequisiteExceptions[0].note = '';
check('prerequisite exception requires ticket, prerequisite and note', policy.validateState(brokenException).some(x => x.path.includes('prerequisiteExceptions')));

// AC-4：需求登记簿 schema、覆盖与语义状态纯策略。
const registryState = clone(validState);
registryState.requirements = {
  schemaVersion: 1,
  sources: [{ file: 'SPEC.md', trackedLine: '^- \\[[ x]\\] ' }],
  items: [{
    id: 'REQ-SPEC-001', source: 'SPEC.md', anchor: '- [x] done thing', title: 'done thing',
    state: 'closed', dependsOn: [], basis: 'source-marker', evidence: [],
  }],
};
check('valid minimal requirement registry accepted', policy.validateState(registryState).length === 0);
const badRequirement = mutation => {
  const state = clone(registryState);
  mutation(state.requirements.items[0], state.requirements);
  return policy.validateState(state).some(x => x.path.startsWith('requirements.'));
};
const duplicatedIdState = clone(registryState);
duplicatedIdState.requirements.items.push({ ...duplicatedIdState.requirements.items[0], anchor: '- [x] other thing' });
check('duplicate requirement ID rejected', policy.validateState(duplicatedIdState).some(x => x.path.startsWith('requirements.items') && x.code === 'duplicate'));
check('unknown requirement source rejected', badRequirement(item => { item.source = 'docs/other.md'; }));
const duplicatedAnchorState = clone(registryState);
duplicatedAnchorState.requirements.items.push({ ...duplicatedAnchorState.requirements.items[0], id: 'REQ-SPEC-002' });
check('duplicate anchor rejected', policy.validateState(duplicatedAnchorState).some(x => x.path.startsWith('requirements.items') && x.code === 'duplicate'));
check('missing anchor rejected', badRequirement(item => { item.anchor = ''; }));
check('unsupported requirement state rejected', badRequirement(item => { item.state = 'maybe'; }));
check('closed requirement requires evidence or source-marker basis', badRequirement(item => { delete item.basis; }));
check('deferred requirement requires durable evidence', badRequirement(item => { item.state = 'deferred'; item.basis = 'evidence-file'; }));
check('unknown dependsOn rejected', badRequirement(item => { item.dependsOn = ['REQ-MISSING']; }));
check('invalid trackedLine pattern rejected', badRequirement((item, req) => { req.sources[0].trackedLine = '^['; }));
const cyclic = clone(registryState);
cyclic.requirements.items.push({ ...cyclic.requirements.items[0], id: 'REQ-SPEC-002', title: 'second', dependsOn: ['REQ-SPEC-001'] });
cyclic.requirements.items[0].dependsOn = ['REQ-SPEC-002'];
check('cyclic prerequisite chain rejected', policy.validateState(cyclic).some(x => x.code === 'cycle'));

const coverageTexts = {
  'SPEC.md': '# spec\n- [x] done thing with more words\n- [ ] open thing\n',
};
const cleanRequirements = {
  schemaVersion: 1,
  sources: [{ file: 'SPEC.md', trackedLine: '^- \\[[ x]\\] ' }],
  items: [
    { id: 'REQ-SPEC-001', source: 'SPEC.md', anchor: '- [x] done thing', title: 'done', state: 'closed', dependsOn: [], basis: 'source-marker', evidence: [] },
    { id: 'REQ-SPEC-002', source: 'SPEC.md', anchor: '- [ ] open thing', title: 'open', state: 'open', dependsOn: [], evidence: [] },
  ],
};
check('clean registry coverage reports nothing', policy.evaluateRequirementCoverage(cleanRequirements, coverageTexts).length === 0);
const staleCoverage = clone(cleanRequirements);
staleCoverage.items[0].anchor = '- [x] removed thing';
check('stale anchor reported when the source line disappears',
  policy.evaluateRequirementCoverage(staleCoverage, coverageTexts).some(x => x.code === 'stale-anchor'));
const unmappedCoverage = clone(cleanRequirements);
unmappedCoverage.items = [unmappedCoverage.items[0]];
check('unmapped tracked source line reported deterministically',
  policy.evaluateRequirementCoverage(unmappedCoverage, coverageTexts).some(x => x.code === 'unmapped-item'));
const dupCoverage = clone(cleanRequirements);
dupCoverage.items[1] = { ...dupCoverage.items[0], id: 'REQ-SPEC-003', anchor: '- [x] done' };
check('two anchors covering one tracked line reported',
  policy.evaluateRequirementCoverage(dupCoverage, coverageTexts).some(x => x.code === 'duplicate-coverage'));

// AC-7：语义状态检查只报告并给出义务，从不改写保护文档。
const semanticDocs = {
  spec: [
    '- [x] Performance-script foundation: handles six event kinds with lossless round-trip.',
    '- [x] Game-execution foundation: the plugin rejects ability, movement and facing packages before start.',
  ].join('\n'),
  workplan: '',
  architecture: '',
};
check('clean current-status wording passes the semantic check', policy.evaluateSemanticStatus(semanticDocs).length === 0);
check('stale six-track gap claim is reported with evidence',
  policy.evaluateSemanticStatus({ ...semanticDocs, workplan: 'the editor does not natively round-trip all six kinds.' })
    .some(x => x.rule === 'stale-six-track-gap' && x.evidence.includes('HANDOFF-20260901-six-track-roundtrip.md')));
check('1–3 dancers claim without the 1–12 import range is reported',
  policy.evaluateSemanticStatus({ ...semanticDocs, architecture: 'the editor offers 1–3 dancers.' })
    .some(x => x.rule === 'performer-range-wording'));
check('1–3 dancers beside the 1–12 range passes',
  policy.evaluateSemanticStatus({ ...semanticDocs, architecture: 'the editor offers 1–3 dancers while import validates 1–12.' }).length === 0);
check('six-track row must distinguish lossless preservation from editing',
  policy.evaluateSemanticStatus({ ...semanticDocs, spec: '- [x] Performance-script foundation: handles six event kinds.\n' + semanticDocs.spec.split('\n')[1] })
    .some(x => x.rule === 'six-track-distinction'));
check('execution row must preserve the plugin rejection wording',
  policy.evaluateSemanticStatus({ ...semanticDocs, spec: semanticDocs.spec.split('\n')[0] + '\n- [x] Game-execution foundation: executes everything now.' })
    .some(x => x.rule === 'execution-gap-wording'));
check('semantic check never mutates the scanned documents', JSON.stringify(semanticDocs) === JSON.stringify({
  spec: [
    '- [x] Performance-script foundation: handles six event kinds with lossless round-trip.',
    '- [x] Game-execution foundation: the plugin rejects ability, movement and facing packages before start.',
  ].join('\n'),
  workplan: '',
  architecture: '',
}));

const blockText = 'before\n<!-- process-state:x:start -->\nold\n<!-- process-state:x:end -->\nafter\n';
const replaced = policy.replaceManagedBlock(blockText, 'x', 'new\nvalue');
check('managed block replacement is exact', policy.extractManagedBlock(replaced, 'x') === 'new\nvalue');
check('managed block replacement is idempotent', policy.replaceManagedBlock(replaced, 'x', 'new\nvalue') === replaced);
check('missing managed marker is rejected', throws(() => policy.replaceManagedBlock('plain', 'x', 'new')));

const e1 = { schemaVersion: 1, id: 'E1', date: '2026-08-31', kind: 'repeated-error', ruleKey: 'same-rule', severity: 'medium', summary: 'one', evidence: ['a'] };
const e2 = { ...e1, id: 'E2', summary: 'two' };
const high = { ...e1, id: 'E3', ruleKey: 'high-rule', severity: 'high' };
const parsed = policy.parseEvents([e1, e2, high].map(JSON.stringify).join('\n'));
check('valid JSONL events accepted', parsed.issues.length === 0 && parsed.records.length === 3);
const candidates = policy.proposalCandidates(parsed.records, validState.evolution.thresholds);
check('two medium events reach threshold', candidates.some(x => x.ruleKey === 'same-rule' && x.events.length === 2));
check('one high event reaches threshold', candidates.some(x => x.ruleKey === 'high-rule' && x.events.length === 1));
const resolution = { schemaVersion: 1, id: 'R1', date: '2026-08-31', kind: 'resolution', resolves: ['E1'], summary: 'fixed', evidence: ['handoff'] };
const afterResolution = policy.proposalCandidates([...parsed.records, resolution], validState.evolution.thresholds);
check('resolution removes event from threshold count', !afterResolution.some(x => x.ruleKey === 'same-rule'));
check('malformed JSONL is rejected', policy.parseEvents('{bad').issues.some(x => x.code === 'json'));
check('duplicate event ID is rejected', policy.parseEvents(`${JSON.stringify(e1)}\n${JSON.stringify(e1)}`).issues.some(x => x.code === 'duplicate'));
check('resolution cannot name a missing/prior-resolution ID',
  policy.parseEvents(JSON.stringify(resolution)).issues.some(x => x.code === 'resolution-ref'));
check('events require evidence',
  policy.parseEvents(JSON.stringify({ ...e1, evidence: [] })).issues.some(x => x.code === 'evidence'));
check('proposal filename is sanitized', policy.proposalFileName('same-rule') === 'same-rule.md');
check('proposal includes event evidence', policy.renderProposal(candidates.find(x => x.ruleKey === 'same-rule')).includes('E2'));
check('proposal carries a bounded next-ticket-action section',
  policy.renderProposal(candidates.find(x => x.ruleKey === 'same-rule')).includes('## Bounded next ticket action'));

const fixedNow = new Date(2026, 7, 31, 12, 0, 0);
const built = eventCli.buildEvent({
  command: 'record', kind: 'state-drift', ruleKey: 'doc-drift', severity: 'high',
  summary: 'drift', evidence: ['file:1'], id: 'EVT-FIXED',
}, fixedNow);
check('event builder preserves injected identity/date', built.id === 'EVT-FIXED' && built.date === '2026-08-31');
const resolved = eventCli.buildEvent({
  command: 'resolve', eventIds: ['EVT-FIXED'], summary: 'done', evidence: ['handoff'], id: 'RES-FIXED',
}, fixedNow);
check('resolution builder names source event', resolved.kind === 'resolution' && resolved.resolves[0] === 'EVT-FIXED');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-process-policy-'));
try {
  fs.mkdirSync(path.join(temp, '.agent'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.agent', 'process-events.jsonl'), '', 'utf8');
  eventCli.appendEvent(temp, built);
  const stored = policy.parseEvents(fs.readFileSync(path.join(temp, '.agent', 'process-events.jsonl'), 'utf8'));
  check('appendEvent writes one valid record', stored.issues.length === 0 && stored.records.length === 1);
  check('appendEvent rejects duplicate ID', throws(() => eventCli.appendEvent(temp, built)));
  check('appendEvent rejects resolution of unknown event', throws(() => eventCli.appendEvent(temp, {
    schemaVersion: 1, id: 'RES-MISSING', date: '2026-08-31', kind: 'resolution',
    resolves: ['EVT-MISSING'], summary: 'bad', evidence: ['none'],
  })));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`process-policy: ${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
