// AI 管线 V2 CLI 集成回归：上下文哈希、并发写域锁、证据化结束和工作区审计。
// 所有文件只写入 os.tmpdir() 的隔离仓库，finally 精确清理，不触碰产品工作区。
// 使用固定 revision/时间保证结果可重复。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('./pipeline-cli.js');
const policyLib = require('./pipeline-policy.js');

let passed = 0;
let total = 0;
function check(name, condition) {
  total++;
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else console.error('  ✘ ' + name);
}
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
function put(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', 'utf8');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-pipeline-v2-'));
try {
  const activePolicy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.agent/PIPELINE-POLICY.json'), 'utf8'));
  activePolicy.budgets.defaultContextBytes = 100000;
  activePolicy.budgets.roleContextBytes.worker = 100000;
  activePolicy.classConstraints = {};
  const registry = {
    schemaVersion: 1,
    modules: [{ id: 'test-module', description: 'test', roots: ['work/**'], context: '.agent/modules/test-module/CONTEXT.md', state: '.agent/modules/test-module/STATE.md', dependsOn: [] }],
  };
  const makeTicket = (id, writeScope) => ({
    artifactType: 'task-ticket', schemaVersion: 1, id, revision: 1, status: 'accepted',
    class: 'feature', title: 'test', risk: 'R1', tags: [], ownerIntent: 'test pipeline', goal: 'one result',
    nonGoals: ['other behavior'], primaryModule: 'test-module', impactedModules: ['test-module'],
    contextFiles: ['work/context.txt'], readScope: ['.agent/**', 'work/context.txt'],
    writeScope: [...writeScope, '.agent/runs/**'], lockScope: writeScope,
    prohibitedPaths: ['protected/**'],
    acceptanceCriteria: [{ id: 'AC-1', given: 'state', when: 'action', then: 'result', evidence: ['test'] }],
    testPlan: ['test'], budgets: { maxChangedFiles: 2, maxChangedLines: 20, maxRunMinutes: 5, maxRepairAttempts: 2 },
    reviewLanes: ['module'], documentationImpact: 'none', rollout: 'test', rollback: 'delete fixture',
  });
  const ticketA = makeTicket('TASK-TEST-A', ['work/a/**']);
  const ticketB = makeTicket('TASK-TEST-B', ['work/b/**']);
  ticketB.tags = ['pipeline-policy'];
  ticketB.reviewLanes = ['module', 'global'];
  put(root, '.agent/PIPELINE-POLICY.json', activePolicy);
  put(root, '.agent/MODULES.json', registry);
  put(root, '.agent/PIPELINE-ROUTING.json', JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.agent/PIPELINE-ROUTING.json'), 'utf8')));
  for (const file of Object.values(activePolicy.roleFiles)) put(root, file, '# role\n');
  put(root, '.agent/modules/test-module/CONTEXT.md', '# context\n');
  put(root, '.agent/modules/test-module/STATE.md', '# state\n');
  put(root, '.agent/tickets/TASK-TEST-A.json', ticketA);
  put(root, '.agent/tickets/TASK-TEST-B.json', ticketB);
  put(root, '.agent/runs/active/README.md', '# active\n');
  put(root, '.agent/runs/history/README.md', '# history\n');
  put(root, '.agent/templates/example.json', { ok: true });
  put(root, 'AGENTS.md', '# agents\n');
  put(root, 'docs/README-AI.md', '# router\n');
  put(root, '.agent/CONTINUITY.md', '# continuity\n');
  put(root, 'work/context.txt', 'stable context\n');

  const initial = cli.workspaceAudit(root);
  check('fixture workspace starts green', initial.ok && initial.metrics.ticketCount === 2);
  put(root, '.agent/PROCESS-STATE.json', {
    schemaVersion: 1, activePackage: null, activePackages: [],
    packages: [
      { order: 1, id: ticketA.id, status: 'open', outcome: 'fixture package A', handoffs: [] },
      { order: 2, id: ticketB.id, status: 'open', outcome: 'fixture package B', handoffs: [] },
    ],
    ownerTails: [],
    latestProductHandoff: '', latestProcessHandoff: '',
    budgets: { defaultContextBytes: 10000, implementationContextBytes: 20000, maxOpenOwnerTails: 5 },
    evolution: { thresholds: { critical: 1, high: 1, medium: 2, low: 2 }, autoFixTargets: [], protectedFiles: [] },
  });
  const processPolicyLib = require('./process-policy.js');
  const fixtureRouting = JSON.parse(fs.readFileSync(path.join(root, '.agent/PIPELINE-ROUTING.json'), 'utf8'));
  check('every structured routing template is copy-ready inside the fixture', policyLib.HANDOFF_STRUCTURED_PROMPTS.every(key =>
    policyLib.validateHandoffPrompt(policyLib.buildHandoffPrompt(fixtureRouting.prompts[key]), key).length === 0));
  const promptSections = prompt => policyLib.HANDOFF_SECTIONS.filter(section => new RegExp(`^${section}$`, 'm').test(prompt));
  const copyReady = (prompt, key) => policyLib.validateHandoffPrompt(prompt, key).filter(issue => issue.code !== 'budget').length === 0
    && promptSections(prompt).length === 6;
  const intakeRoute = cli.nextAction(root);
  check('no ticket routes to fresh Planner conversation', intakeRoute.nextRole === 'planner' && intakeRoute.newConversationRequired && intakeRoute.handoff.action === 'open-new-conversation');
  check('intake handoff prompt is copy-ready', copyReady(intakeRoute.handoff.prompt, 'planner-intake'));
  const workerRoute = cli.nextAction(root, ticketA.id);
  check('accepted ticket routes to fresh Worker conversation', workerRoute.nextRole === 'worker' && workerRoute.autoContinue === false && workerRoute.handoff.prompt === workerRoute.prompt);
  check('worker handoff prompt is one copy-ready six-section prompt', copyReady(workerRoute.handoff.prompt, 'worker')
    && workerRoute.handoff.prompt.indexOf('ROLE\n') < workerRoute.handoff.prompt.indexOf('TASK\n'));
  check('worker prompt references ticket and stop conditions by content', workerRoute.handoff.prompt.includes(ticketA.id)
    && workerRoute.handoff.prompt.includes('pipeline-cli.js next') && workerRoute.handoff.prompt.includes('verbatim') && workerRoute.handoff.prompt.includes('stop'));
  const globalRoute = cli.nextAction(root, ticketB.id);
  check('global review requirement is declared before implementation', globalRoute.requiresGlobalReview && globalRoute.handoff.globalReviewRequired);
  check('global reviewer prompt is copy-ready', copyReady(globalRoute.handoff.prompt, 'reviewer-global'));
  const fixedOptions = { sourceRevision: 'abc123', now: new Date('2026-08-31T00:00:00.000Z') };
  const firstContext = cli.buildContextManifest(root, '.agent/tickets/TASK-TEST-A.json', 'worker', 'RUN-CONTEXT', fixedOptions);
  const secondContext = cli.buildContextManifest(root, '.agent/tickets/TASK-TEST-A.json', 'worker', 'RUN-CONTEXT', fixedOptions);
  check('context hash is deterministic', firstContext.manifest.contextHash === secondContext.manifest.contextHash);
  check('context includes policy, module, ticket and role', firstContext.manifest.files.length >= 5);

  put(root, '.agent/runs/.claim.lock', 'stale test lock\n');
  check('existing global claim lock fails closed', throws(() => cli.claimRun(root, '.agent/tickets/TASK-TEST-A.json', 'RUN-LOCKED', 'worker', fixedOptions)));
  fs.unlinkSync(path.join(root, '.agent/runs/.claim.lock'));
  const claimA = cli.claimRun(root, '.agent/tickets/TASK-TEST-A.json', 'RUN-A', 'worker', fixedOptions);
  check('claim creates active run atomically', fs.existsSync(claimA.file) && claimA.run.status === 'active');
  check('claim syncs the registered package into the active set',
    JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8')).activePackages.join(',') === ticketA.id);
  const brokenStatePath = path.join(root, '.agent/PROCESS-STATE.json');
  const validStateText = fs.readFileSync(brokenStatePath, 'utf8');
  put(root, '.agent/PROCESS-STATE.json', { ...JSON.parse(validStateText), activePackages: [ticketA.id, ticketA.id] });
  check('claim fails closed on malformed process state and leaves no run file or baseline',
    throws(() => cli.claimRun(root, '.agent/tickets/TASK-TEST-A.json', 'RUN-A2', 'worker', fixedOptions))
    && !fs.existsSync(path.join(root, '.agent/runs/active/RUN-A2.json'))
    && !fs.existsSync(path.join(root, '.agent/runs/baselines/RUN-A2')));
  put(root, '.agent/PROCESS-STATE.json', validStateText);
  check('overlapping second claim is rejected', throws(() => cli.claimRun(root, '.agent/tickets/TASK-TEST-A.json', 'RUN-A2', 'worker', fixedOptions)));
  const claimB = cli.claimRun(root, '.agent/tickets/TASK-TEST-B.json', 'RUN-B', 'worker', fixedOptions);
  check('independent lock scope may run concurrently despite shared evidence scope', fs.existsSync(claimB.file));
  check('both active runs are represented without false single-slot mismatch',
    JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8')).activePackages.join(',') === `${ticketA.id},${ticketB.id}`);
  const activeAudit = cli.workspaceAudit(root);
  check('workspace audit accepts non-overlapping active runs', activeAudit.ok && activeAudit.metrics.activeRunCount === 2);
  put(root, '.agent/runs/.claim.lock', 'concurrent claim in progress\n');
  check('finish cannot interleave with a concurrent claim and mutates no state',
    throws(() => cli.finishRun(root, 'RUN-B', 'blocked', {}, { now: new Date('2026-08-31T00:09:30.000Z') }))
    && fs.existsSync(claimB.file)
    && JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8')).activePackages.join(',') === `${ticketA.id},${ticketB.id}`
    && !fs.existsSync(path.join(root, '.agent/runs/history/RUN-B.json')));
  fs.unlinkSync(path.join(root, '.agent/runs/.claim.lock'));
  put(root, activePolicy.roleFiles.worker, '# changed role\n');
  check('workspace audit rejects immutable context changed after claim', cli.workspaceAudit(root).errors.some(error => error.code === 'context' && error.message.includes(activePolicy.roleFiles.worker)));
  check('stale immutable context cannot finish a run', throws(() => cli.finishRun(root, 'RUN-B', 'blocked')));
  put(root, activePolicy.roleFiles.worker, '# role\n');
  check('restoring immutable context restores active run validity', cli.workspaceAudit(root).ok);

  const checkpoint = cli.checkpointRun(root, 'RUN-A', 'worker-complete', { now: new Date('2026-08-31T00:05:00.000Z') });
  check('Worker checkpoint is persisted', checkpoint.run.phase === 'worker-complete' && checkpoint.run.roleCheckpoints.length === 1);
  check('repeated phase checkpoint is idempotent', cli.checkpointRun(root, 'RUN-A', 'worker-complete', { now: new Date('2026-08-31T00:05:01.000Z') }).run.roleCheckpoints.length === 1);
  const gateRoute = cli.nextAction(root, ticketA.id);
  check('Worker hands off to Gate without switching roles in place', gateRoute.nextRole === 'deterministic-gate' && gateRoute.newConversationRequired && gateRoute.handoff.instruction.includes('Do not perform the next role'));
  check('gate handoff prompt is copy-ready', copyReady(gateRoute.handoff.prompt, 'deterministic-gate'));

  cli.registerInterrupt(root, { id: 'INT-CLAR-A', kind: 'requirement', ticketId: ticketA.id, summary: 'clarify wording only', impact: 'clarification', blocking: true }, { now: new Date('2026-08-31T00:06:30.000Z') });
  const clarificationRoute = cli.nextAction(root, ticketA.id);
  check('clarification routes to QA without revision', clarificationRoute.nextRole === 'qa-lead' && clarificationRoute.reason.includes('clarify-without-revision-if-contract-unchanged'));
  cli.resolveInterrupt(root, 'INT-CLAR-A', 'clarified', 'no contract change', { now: new Date('2026-08-31T00:06:40.000Z') });

  cli.registerInterrupt(root, { id: 'INT-REQ-A', kind: 'requirement', ticketId: ticketA.id, summary: 'refine active acceptance', impact: 'within-ticket', blocking: true }, { now: new Date('2026-08-31T00:06:00.000Z') });
  const requirementRoute = cli.nextAction(root, ticketA.id);
  check('midstream in-ticket requirement routes to fresh QA conversation', requirementRoute.status === 'interrupted' && requirementRoute.nextRole === 'qa-lead' && requirementRoute.newConversationRequired);
  check('requirement handoff prompt is copy-ready', copyReady(requirementRoute.handoff.prompt, 'qa-lead'));
  cli.resolveInterrupt(root, 'INT-REQ-A', 'revise-ticket', 'revision required', { now: new Date('2026-08-31T00:07:00.000Z') });

  cli.registerInterrupt(root, { id: 'INT-UNREL-A', kind: 'requirement', ticketId: ticketA.id, summary: 'separate new feature', impact: 'unrelated', blocking: true }, { now: new Date('2026-08-31T00:07:30.000Z') });
  const unrelatedRoute = cli.nextAction(root, ticketA.id);
  check('unrelated requirement queues a ticket and resumes current run', unrelatedRoute.nextRole === 'planner' && unrelatedRoute.reason.includes('create-queued-ticket-and-resume-current'));
  cli.resolveInterrupt(root, 'INT-UNREL-A', 'queued', 'follow-up ticket planned', { now: new Date('2026-08-31T00:07:40.000Z') });

  const requirementImpacts = ['clarification', 'within-ticket', 'expands-scope', 'unrelated', 'unknown'];
  const requirementActions = requirementImpacts.map(impact => fixtureRouting.interruptRules.requirement[impact].ticketAction);
  check('requirement impacts take distinct safe routes', new Set(requirementActions).size === requirementActions.length
    && fixtureRouting.interruptRules.hotfix.any.ticketAction !== fixtureRouting.interruptRules.requirement.unknown.ticketAction);

  cli.registerInterrupt(root, { id: 'INT-PORTFOLIO-A', kind: 'portfolio-review', ticketId: ticketA.id, summary: 'review whole product direction', impact: 'direction-only', blocking: true }, { now: new Date('2026-08-31T00:08:00.000Z') });
  const portfolioRoute = cli.nextAction(root, ticketA.id);
  check('whole-project review routes to read-only Planner conversation', portfolioRoute.mode === 'portfolio-review' && portfolioRoute.nextRole === 'planner' && portfolioRoute.prompt.includes('read-only'));
  check('portfolio prompt is copy-ready with the five decisions', copyReady(portfolioRoute.handoff.prompt, 'planner-portfolio')
    && ['continue', 'reprioritize-future', 'revise-active-ticket', 'supersede-active-ticket', 'cancel-active-ticket'].every(decision => portfolioRoute.handoff.prompt.includes(decision)));
  cli.resolveInterrupt(root, 'INT-PORTFOLIO-A', 'continue', 'direction remains valid', { now: new Date('2026-08-31T00:09:00.000Z') });

  const blocked = cli.finishRun(root, 'RUN-B', 'blocked', {}, { now: new Date('2026-08-31T00:10:00.000Z') });
  check('blocked finish moves run to local history', fs.existsSync(blocked.file) && !fs.existsSync(claimB.file));
  check('finish removes the package from the active representation',
    JSON.parse(fs.readFileSync(path.join(root, '.agent/PROCESS-STATE.json'), 'utf8')).activePackages.join(',') === ticketA.id);

  const hash = 'a'.repeat(64);
  put(root, '.agent/evidence/gate.json', {
    artifactType: 'gate-result', schemaVersion: 1, id: 'GATE-A', ticketId: ticketA.id, ticketRevision: 1,
    runId: 'RUN-A', sourceRevision: 'abc123', status: 'passed',
    measureCommand: 'node scripts/pipeline-cli.js measure RUN-A --at 2026-08-31T00:12:00.000Z',
    baselineHash: claimA.run.baseline.manifestHash,
    checks: [{ id: 'test', required: true, status: 'passed', exitCode: 0, durationMs: 1, evidenceHash: hash }], failureFingerprints: [],
  });
  check('passing gate routes back for missing module records', cli.nextAction(root, ticketA.id).mode === 'complete-records');
  put(root, '.agent/evidence/review.json', {
    artifactType: 'review', schemaVersion: 1, id: 'REVIEW-A', ticketId: ticketA.id, ticketRevision: 1,
    runId: 'RUN-A', lane: 'module', verdict: 'APPROVE', findings: [], globalReviewRequired: false, evidence: ['GATE-A'],
  });
  put(root, '.agent/modules/test-module/changes/CHG-TASK-TEST-A.json', {
    artifactType: 'module-change', schemaVersion: 1, ticketId: ticketA.id, ticketRevision: 1,
    moduleId: 'test-module', summary: 'done', nonChanges: ['other'], files: ['work/a/result.txt'], contracts: [],
    tests: [{ id: 'test', status: 'passed', evidence: 'GATE-A' }], knownRisks: [], rollback: 'remove', documentationImpact: 'none',
  });
  const closeoutRoute = cli.nextAction(root, ticketA.id);
  check('complete evidence routes to fresh Context Sync conversation', closeoutRoute.nextRole === 'context-sync' && closeoutRoute.newConversationRequired && closeoutRoute.commands[0].includes('finish RUN-A'));
  check('closeout handoff prompt is copy-ready', copyReady(closeoutRoute.handoff.prompt, 'context-sync'));
  const completed = cli.finishRun(root, 'RUN-A', 'completed', {
    gate: '.agent/evidence/gate.json', reviews: ['.agent/evidence/review.json'],
    changes: ['.agent/modules/test-module/changes/CHG-TASK-TEST-A.json'],
  }, { now: new Date('2026-08-31T00:20:00.000Z') });
  check('completed run requires and records gate/review/change evidence', completed.run.status === 'completed' && completed.run.evidence.reviews.length === 1);
  check('completed active lock is removed', !fs.existsSync(claimA.file));

  const finalAudit = cli.workspaceAudit(root);
  check('final fixture workspace returns green', finalAudit.ok && finalAudit.metrics.activeRunCount === 0);
  put(root, '.agent/runs/active/RUN-X.json', { ...claimA.run, runId: 'RUN-X', writeScope: ['same/**'], lockScope: ['same/**'] });
  put(root, '.agent/runs/active/RUN-Y.json', { ...claimA.run, runId: 'RUN-Y', writeScope: ['same/file'], lockScope: ['same/file'] });
  check('workspace audit rejects overlapping persisted locks', cli.workspaceAudit(root).errors.some(error => error.code === 'overlap'));
  check('policy overlap primitive agrees with CLI lock', policyLib.scopesOverlap(['same/**'], ['same/file']));
  const brokenRouting = JSON.parse(fs.readFileSync(path.join(root, '.agent/PIPELINE-ROUTING.json'), 'utf8'));
  brokenRouting.prompts.worker.doNot = [];
  put(root, '.agent/PIPELINE-ROUTING.json', brokenRouting);
  check('routing with hollow prohibitions fails closed', throws(() => cli.nextAction(root, ticketB.id)));
  put(root, '.agent/PIPELINE-ROUTING.json', JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.agent/PIPELINE-ROUTING.json'), 'utf8')));
  ticketB.status = 'accepted';
  put(root, '.agent/tickets/TASK-TEST-B.json', ticketB);
  check('restored routing emits prompts again', cli.nextAction(root, ticketB.id).nextRole === 'worker');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`pipeline-cli: ${passed}/${total}`);
if (passed !== total) process.exitCode = 1;
