// AI 管线 V2 CLI：只读审计、工单预检、原子运行占用、证据化结束与熔断判定。
// 默认只操作 .agent 运行制品；不会改产品源码、提交、发布或访问网络。
// 业务测试仍由 docs/AI-TEST-MATRIX.md 路由，本 CLI 只负责流程契约。
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const policy = require('./pipeline-policy.js');

const POLICY_FILE = '.agent/PIPELINE-POLICY.json';
const MODULES_FILE = '.agent/MODULES.json';
const ROUTING_FILE = '.agent/PIPELINE-ROUTING.json';
const INTERRUPTS_OPEN = '.agent/interrupts/open';
const INTERRUPTS_HISTORY = '.agent/interrupts/history';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeFrom(root, file) {
  return policy.normalizeRepoPath(path.relative(root, file));
}

function resolveInside(root, relative) {
  const normalized = policy.normalizeRepoPath(relative);
  const absolute = path.resolve(root, normalized);
  const base = path.resolve(root) + path.sep;
  if (absolute !== path.resolve(root) && !absolute.startsWith(base)) throw new Error(`path escapes root: ${relative}`);
  return absolute;
}

function findJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

function loadBase(root) {
  const policyFile = resolveInside(root, POLICY_FILE);
  const modulesFile = resolveInside(root, MODULES_FILE);
  return {
    policyFile,
    modulesFile,
    activePolicy: readJson(policyFile),
    registry: readJson(modulesFile),
  };
}

function loadRouting(root) {
  return readJson(resolveInside(root, ROUTING_FILE));
}

function pushIssues(errors, source, issues) {
  for (const issue of issues) errors.push({ source, ...issue });
}

function ticketMap(root, activePolicy, registry, errors) {
  const directory = resolveInside(root, activePolicy.artifacts.tickets);
  const tickets = new Map();
  for (const file of findJsonFiles(directory)) {
    try {
      const ticket = readJson(file);
      pushIssues(errors, relativeFrom(root, file), policy.validateTicket(ticket, activePolicy, registry));
      if (tickets.has(ticket.id)) errors.push({ source: relativeFrom(root, file), code: 'duplicate', path: 'id', message: `duplicate ticket ${ticket.id}` });
      else tickets.set(ticket.id, { ticket, file });
    } catch (error) { errors.push({ source: relativeFrom(root, file), code: 'json', path: '$', message: error.message }); }
  }
  return tickets;
}

function loadActiveRuns(root, activePolicy, errors = []) {
  const directory = resolveInside(root, activePolicy.artifacts.activeRuns);
  const runs = [];
  for (const file of findJsonFiles(directory)) {
    try {
      const run = readJson(file);
      pushIssues(errors, relativeFrom(root, file), policy.validateRunManifest(run, activePolicy));
      runs.push({ run, file });
    } catch (error) { errors.push({ source: relativeFrom(root, file), code: 'json', path: '$', message: error.message }); }
  }
  return runs;
}

function workspaceAudit(root) {
  root = path.resolve(root);
  const errors = [];
  const metrics = {};
  let base;
  try { base = loadBase(root); }
  catch (error) {
    return { ok: false, root, errors: [{ source: '$', code: 'required', path: '$', message: error.message }], metrics };
  }
  pushIssues(errors, POLICY_FILE, policy.validatePolicy(base.activePolicy));
  pushIssues(errors, MODULES_FILE, policy.validateModules(base.registry));
  try { pushIssues(errors, ROUTING_FILE, policy.validateRouting(loadRouting(root))); }
  catch (error) { errors.push({ source: ROUTING_FILE, code: 'required', path: '$', message: error.message }); }

  for (const [role, file] of Object.entries(base.activePolicy.roleFiles || {})) {
    const absolute = resolveInside(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) errors.push({ source: POLICY_FILE, code: 'required', path: `roleFiles.${role}`, message: `missing ${file}` });
  }
  for (const module of base.registry.modules || []) {
    for (const key of ['context', 'state']) {
      const absolute = resolveInside(root, module[key]);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) errors.push({ source: MODULES_FILE, code: 'required', path: `${module.id}.${key}`, message: `missing ${module[key]}` });
    }
  }

  const tickets = ticketMap(root, base.activePolicy, base.registry, errors);
  const changesRoot = resolveInside(root, base.activePolicy.artifacts.modules);
  for (const file of findJsonFiles(changesRoot).filter(file => file.includes(`${path.sep}changes${path.sep}`))) {
    try {
      const change = readJson(file);
      const found = tickets.get(change.ticketId);
      if (!found) errors.push({ source: relativeFrom(root, file), code: 'ticket', path: 'ticketId', message: `unknown ticket ${change.ticketId}` });
      else pushIssues(errors, relativeFrom(root, file), policy.validateModuleChange(change, found.ticket, base.registry));
    } catch (error) { errors.push({ source: relativeFrom(root, file), code: 'json', path: '$', message: error.message }); }
  }

  const runs = loadActiveRuns(root, base.activePolicy, errors);
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    if (policy.scopesOverlap(runs[i].run.lockScope || runs[i].run.writeScope, runs[j].run.lockScope || runs[j].run.writeScope)) {
      errors.push({ source: 'active-runs', code: 'overlap', path: '$', message: `${runs[i].run.runId} overlaps ${runs[j].run.runId}` });
    }
  }
  const activeRunsByTicket = new Map();
  for (const { run, file } of runs) {
    if (activeRunsByTicket.has(run.ticketId)) {
      errors.push({ source: 'active-runs', code: 'ambiguous', path: 'ticketId', message: `multiple active runs for ${run.ticketId}: ${activeRunsByTicket.get(run.ticketId)} and ${run.runId}` });
    } else activeRunsByTicket.set(run.ticketId, run.runId);
  }
  for (const { run, file } of runs) {
    const found = tickets.get(run.ticketId);
    if (!found) errors.push({ source: relativeFrom(root, file), code: 'ticket', path: 'ticketId', message: `unknown ticket ${run.ticketId}` });
    else if (run.ticketRevision !== found.ticket.revision) errors.push({ source: relativeFrom(root, file), code: 'ticket', path: 'ticketRevision', message: 'active run uses stale ticket revision' });
    if (found) {
      const immutableInputs = new Set([
        POLICY_FILE,
        MODULES_FILE,
        relativeFrom(root, found.file),
        base.activePolicy.roleFiles[run.role],
      ].filter(Boolean));
      // 冻结门契约与工单声明一致性：工单声明被改而运行副本未动时在此失败关闭（AC-2/AC-6）。
      for (const issue of policy.runGateContractIssues(run, found.ticket)) {
        errors.push({ source: relativeFrom(root, file), code: issue.code, path: issue.path, message: issue.message });
      }
      for (const item of run.contextFiles || []) {
        if (!immutableInputs.has(item.path)) continue;
        const absolute = resolveInside(root, item.path);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
          errors.push({ source: relativeFrom(root, file), code: 'context', path: 'contextFiles', message: `immutable context is missing: ${item.path}` });
        } else if (policy.sha256(fs.readFileSync(absolute)) !== item.sha256) {
          errors.push({ source: relativeFrom(root, file), code: 'context', path: 'contextFiles', message: `immutable context changed after claim: ${item.path}` });
        }
      }
    }
  }

  const templatesRoot = resolveInside(root, base.activePolicy.artifacts.templates);
  for (const file of findJsonFiles(templatesRoot)) {
    try { readJson(file); } catch (error) { errors.push({ source: relativeFrom(root, file), code: 'json', path: '$', message: error.message }); }
  }

  let openInterruptCount = 0;
  for (const directory of [INTERRUPTS_OPEN, INTERRUPTS_HISTORY]) {
    for (const file of findJsonFiles(resolveInside(root, directory))) {
      try {
        const request = readJson(file);
        pushIssues(errors, relativeFrom(root, file), policy.validateChangeRequest(request));
        if (directory === INTERRUPTS_OPEN && request.status === 'open') openInterruptCount++;
      } catch (error) { errors.push({ source: relativeFrom(root, file), code: 'json', path: '$', message: error.message }); }
    }
  }

  const defaultFiles = ['AGENTS.md', 'docs/README-AI.md', '.agent/CONTINUITY.md'];
  metrics.defaultContextBytes = 0;
  for (const file of defaultFiles) {
    const absolute = resolveInside(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push({ source: '$', code: 'required', path: file, message: 'default context file is missing' });
    } else metrics.defaultContextBytes += fs.statSync(absolute).size;
  }
  if (metrics.defaultContextBytes > base.activePolicy.budgets.defaultContextBytes) {
    errors.push({ source: POLICY_FILE, code: 'budget', path: 'budgets.defaultContextBytes', message: `${metrics.defaultContextBytes} bytes exceeds policy` });
  }
  metrics.ticketCount = tickets.size;
  metrics.activeRunCount = runs.length;
  metrics.moduleCount = (base.registry.modules || []).length;
  metrics.openInterruptCount = openInterruptCount;

  // 前置倒置：新关闭必须有已关闭前置，否则审计失败；历史倒置需要已登记的审查例外，
  // 登记后降级为稳定定位的警告——绝不静默通过，也绝不改写不可变票据或交接。
  const warnings = [];
  const auditProcessState = readOptionalJson(root, PROCESS_STATE_FILE, null);
  const auditPackages = new Map(((auditProcessState && auditProcessState.packages) || []).map(item => [item.id, item]));
  const exceptions = new Map();
  for (const exception of (auditProcessState && auditProcessState.evolution && auditProcessState.evolution.prerequisiteExceptions) || []) {
    if (exception && exception.ticketId && exception.prerequisiteId) exceptions.set(`${exception.ticketId}->${exception.prerequisiteId}`, exception);
  }
  for (const { ticket, file } of tickets.values()) {
    if (ticket.status !== 'closed') continue;
    for (const prerequisite of ticket.prerequisites || []) {
      const located = `${relativeFrom(root, file)}: ${ticket.id} closed while prerequisite ${prerequisite} is not closed`;
      let inverted = false;
      if (!dependencyIsClosed(prerequisite, tickets, auditPackages)) inverted = true;
      else {
        // 时间性倒置：依赖包的 closedOn 晚于被依赖包（如 SIX-TRACK 09-01 vs ARCH2 09-02）。
        const closedOn = id => (auditPackages.get(id) || {}).closedOn || '';
        if (closedOn(ticket.id) && closedOn(prerequisite) && closedOn(prerequisite) > closedOn(ticket.id)) {
          inverted = true;
          const message = `${located.replace(' is not closed', ` closed later (${closedOn(prerequisite)} > ${closedOn(ticket.id)})`)}`;
          const exception = exceptions.get(`${ticket.id}->${prerequisite}`);
          if (exception) warnings.push({ code: 'PREREQUISITE_INVERSION_RECORDED', message, evidence: (exception.evidence || []).map(item => item.file) });
          else errors.push({ source: relativeFrom(root, file), code: 'prerequisite', path: 'prerequisites', message });
        }
        continue;
      }
      const exception = exceptions.get(`${ticket.id}->${prerequisite}`);
      if (exception) warnings.push({ code: 'PREREQUISITE_INVERSION_RECORDED', message: located, evidence: (exception.evidence || []).map(item => item.file) });
      else errors.push({ source: relativeFrom(root, file), code: 'prerequisite', path: 'prerequisites', message: located });
    }
  }
  return { ok: errors.length === 0, root, errors, warnings, metrics };
}

function getGitRevision(root) {
  const candidates = process.platform === 'win32'
    ? ['git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']
    : ['git'];
  for (const executable of candidates) {
    try {
      return childProcess.execFileSync(executable, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (_) { /* try next */ }
  }
  throw new Error('Git HEAD is unavailable; provide a source revision through the API');
}

function fileInsideScopes(file, scopes) {
  return scopes.some(rule => policy.matchesRule(file, rule));
}

function buildContextManifest(root, ticketFile, role, runId, options = {}) {
  root = path.resolve(root);
  const { activePolicy, registry } = loadBase(root);
  const ticketAbsolute = resolveInside(root, ticketFile);
  const ticket = readJson(ticketAbsolute);
  const issues = policy.validateTicket(ticket, activePolicy, registry);
  if (issues.length) throw new Error('invalid ticket: ' + issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  if (!activePolicy.roleFiles[role]) throw new Error(`unsupported role: ${role}`);
  const implicit = [POLICY_FILE, MODULES_FILE, relativeFrom(root, ticketAbsolute), activePolicy.roleFiles[role]];
  const roleContext = ticket.roleContextFiles && ticket.roleContextFiles[role]
    ? ticket.roleContextFiles[role]
    : ticket.contextFiles;
  const requested = [...implicit, ...roleContext];
  const unique = [...new Set(requested.map(policy.normalizeRepoPath))];
  if (unique.length > activePolicy.budgets.maxContextFiles) throw new Error(`context file count ${unique.length} exceeds policy`);
  const files = [];
  let totalBytes = 0;
  for (const file of unique) {
    if (!fileInsideScopes(file, [...ticket.readScope, ...ticket.writeScope])) throw new Error(`context file is outside ticket scope: ${file}`);
    const absolute = resolveInside(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`context file is missing: ${file}`);
    const content = fs.readFileSync(absolute);
    totalBytes += content.length;
    files.push({ path: file, sha256: policy.sha256(content), reason: implicit.includes(file) ? 'mandatory role/ticket policy' : 'accepted ticket context' });
  }
  const budgetBytes = activePolicy.budgets.roleContextBytes[role];
  if (totalBytes > budgetBytes) throw new Error(`context ${totalBytes} bytes exceeds ${role} budget ${budgetBytes}`);
  const sourceRevision = options.sourceRevision || getGitRevision(root);
  const createdAt = options.now ? options.now.toISOString() : new Date().toISOString();
  const identity = { ticketId: ticket.id, ticketRevision: ticket.revision, policyVersion: activePolicy.policyVersion, role, sourceRevision, files };
  const manifest = {
    artifactType: 'context-manifest', schemaVersion: 1, runId,
    ticketId: ticket.id, ticketRevision: ticket.revision, policyVersion: activePolicy.policyVersion,
    role, sourceRevision, createdAt, files, contextHash: policy.sha256(policy.stableStringify(identity)),
    writeScope: ticket.writeScope, budgetBytes,
  };
  const manifestIssues = policy.validateContextManifest(manifest, ticket, activePolicy);
  if (manifestIssues.length) throw new Error('invalid generated context: ' + manifestIssues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  return { ticket, manifest, totalBytes, activePolicy, registry };
}

function activeConflicts(root, activePolicy, lockScope, ignoreRunId = '') {
  const errors = [];
  const runs = loadActiveRuns(root, activePolicy, errors);
  if (errors.length) throw new Error('invalid active run state: ' + errors.map(error => `${error.source} ${error.message}`).join('; '));
  return runs.filter(({ run }) => run.runId !== ignoreRunId && policy.scopesOverlap(lockScope, run.lockScope || run.writeScope));
}

function writeJsonExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = fs.openSync(file, 'wx');
  try { fs.writeFileSync(handle, JSON.stringify(value, null, 2) + '\n', 'utf8'); }
  finally { fs.closeSync(handle); }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + `.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try { fs.renameSync(temporary, file); }
  catch (error) { try { fs.unlinkSync(temporary); } catch (_) { /* best effort */ } throw error; }
}

// 活动包集合的受控归约：claim/finish 在同一把全局锁内原子更新 PROCESS-STATE。
// 只校验它拥有的活动表示字段（而非整份状态）；活动表示损坏时按熔断规则拒绝写入。
// 未注册票据不产生任何状态行。
function syncActivePackages(root, ticketId, action) {
  const file = resolveInside(root, PROCESS_STATE_FILE);
  if (!fs.existsSync(file)) return null;
  const state = readJson(file);
  const processPolicy = require('./process-policy.js');
  const issues = [];
  processPolicy.validateActivePackages(state, issues);
  if (issues.length) throw new Error('cannot sync active packages: active representation is invalid: ' +
    issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  const current = processPolicy.resolveActivePackages(state);
  const registered = (state.packages || []).some(pkg => pkg.id === ticketId);
  let next = current;
  if (action === 'add' && registered && !current.includes(ticketId)) next = [...current, ticketId];
  if (action === 'remove') next = current.filter(id => id !== ticketId);
  if (next.length === current.length && next.every((id, index) => id === current[index])) return null;
  state.activePackages = next;
  state.activePackage = null;
  writeJsonAtomic(file, state);
  return next;
}

function withClaimLock(root, activePolicy, action) {
  const runsRoot = path.dirname(resolveInside(root, activePolicy.artifacts.activeRuns));
  fs.mkdirSync(runsRoot, { recursive: true });
  const lockFile = path.join(runsRoot, '.claim.lock');
  let handle;
  try { handle = fs.openSync(lockFile, 'wx'); }
  catch (error) {
    if (error && error.code === 'EEXIST') throw new Error(`pipeline claim lock exists: ${relativeFrom(root, lockFile)}; verify no claim is running before treating it as stale`);
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + '\n', 'utf8');
    return action();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lockFile);
  }
}

function claimRun(root, ticketFile, runId, role = 'worker', options = {}) {
  if (!/^RUN-[A-Za-z0-9-]+$/.test(runId || '')) throw new Error('runId must be RUN-* using letters, digits and hyphens');
  const built = buildContextManifest(root, ticketFile, role, runId, options);
  if (!['accepted', 'active'].includes(built.ticket.status)) throw new Error('ticket must be accepted or active');
  return withClaimLock(path.resolve(root), built.activePolicy, () => {
    const latest = loadBase(root).activePolicy;
    if (latest.policyVersion !== built.activePolicy.policyVersion) throw new Error('pipeline policy changed during claim; rebuild context');
    for (const item of built.manifest.files) {
      const absolute = resolveInside(root, item.path);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || policy.sha256(fs.readFileSync(absolute)) !== item.sha256) {
        throw new Error(`context changed during claim; rebuild context: ${item.path}`);
      }
    }
    const conflicts = activeConflicts(path.resolve(root), built.activePolicy, built.ticket.lockScope || built.ticket.writeScope);
    if (conflicts.length) throw new Error(`write scope overlaps active run(s): ${conflicts.map(item => item.run.runId).join(', ')}`);
    // 原子发布：先在锁内建好不可变基线，再发布活动清单；任一步失败两者都不留。
    const baseline = buildRunBaseline(path.resolve(root), built.ticket, runId, built.manifest);
    // 声明冻结：认领时刻的 PNG 预算副本 + 绑定运行身份的哈希；此后工单再改也不扩权。
    let frozenBudget = null;
    if (built.ticket.binaryEvidenceBudget !== undefined) {
      const declaration = JSON.parse(JSON.stringify(built.ticket.binaryEvidenceBudget));
      frozenBudget = {
        declaration,
        hash: policy.sha256(policy.stableStringify({
          runId, ticketId: built.ticket.id, ticketRevision: built.ticket.revision, declaration,
        })),
      };
    }
    // 门证据契约冻结：认领时刻的 v2 契约副本 + 版本 + 绑定运行身份的哈希（AC-2）。
    let frozenGateContract = null;
    if (built.ticket.gateContract !== undefined) {
      const contract = JSON.parse(JSON.stringify(built.ticket.gateContract));
      frozenGateContract = {
        contract,
        hash: policy.sha256(policy.stableStringify({
          runId, ticketId: built.ticket.id, ticketRevision: built.ticket.revision, gateContract: contract,
        })),
      };
    }
    const run = {
      artifactType: 'run-manifest', schemaVersion: 1, runId,
      ticketId: built.ticket.id, ticketRevision: built.ticket.revision,
      sourceRevision: built.manifest.sourceRevision, policyVersion: built.activePolicy.policyVersion,
      role, status: 'active', startedAt: built.manifest.createdAt,
      writeScope: built.ticket.writeScope, contextHash: built.manifest.contextHash,
      lockScope: built.ticket.lockScope || built.ticket.writeScope,
      contextFiles: built.manifest.files, contextBytes: built.totalBytes, repairAttempts: 0,
      phase: 'worker-active', roleCheckpoints: [],
      baseline: { manifestHash: baseline.manifest.baselineHash },
      timing: { schemaVersion: 1, state: 'active', stateSince: built.manifest.createdAt, activeMs: 0, waitMs: 0 },
      ...(frozenBudget ? { binaryEvidenceBudget: frozenBudget.declaration, binaryEvidenceBudgetHash: frozenBudget.hash } : {}),
      ...(frozenGateContract ? {
        gateContract: frozenGateContract.contract,
        gateContractVersion: policy.GATE_CONTRACT_VERSION,
        gateContractHash: frozenGateContract.hash,
      } : {}),
    };
    const issues = policy.validateRunManifest(run, built.activePolicy);
    if (issues.length) {
      removeRunBaseline(baseline);
      throw new Error('invalid run manifest: ' + issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
    }
    const file = resolveInside(root, `${built.activePolicy.artifacts.activeRuns}/${runId}.json`);
    try { writeJsonExclusive(file, run); }
    catch (error) { removeRunBaseline(baseline); throw error; }
    try { syncActivePackages(path.resolve(root), built.ticket.id, 'add'); }
    catch (error) { fs.unlinkSync(file); removeRunBaseline(baseline); throw error; }
    return { run, file, context: built.manifest, baseline: baseline.manifest };
  });
}

function finishRun(root, runId, status, evidence = {}, options = {}) {
  root = path.resolve(root);
  const { activePolicy, registry } = loadBase(root);
  if (!['completed', 'blocked', 'cancelled'].includes(status)) throw new Error('finish status must be completed, blocked or cancelled');
  const activeFile = resolveInside(root, `${activePolicy.artifacts.activeRuns}/${runId}.json`);
  if (!fs.existsSync(activeFile)) throw new Error(`active run not found: ${runId}`);
  const run = readJson(activeFile);
  const ticketFile = findJsonFiles(resolveInside(root, activePolicy.artifacts.tickets)).find(file => {
    try { return readJson(file).id === run.ticketId; } catch (_) { return false; }
  });
  if (!ticketFile) throw new Error(`ticket not found: ${run.ticketId}`);
  const ticket = readJson(ticketFile);
  const runIssues = policy.validateRunManifest(run, activePolicy);
  if (runIssues.length || run.ticketRevision !== ticket.revision) throw new Error('active run is stale or invalid; rebuild context and claim a new run');
  const immutableInputs = new Set([
    POLICY_FILE,
    MODULES_FILE,
    relativeFrom(root, ticketFile),
    activePolicy.roleFiles[run.role],
  ].filter(Boolean));
  for (const item of run.contextFiles || []) {
    if (!immutableInputs.has(item.path)) continue;
    const absolute = resolveInside(root, item.path);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || policy.sha256(fs.readFileSync(absolute)) !== item.sha256) {
      throw new Error(`active run immutable context is stale: ${item.path}`);
    }
  }
  // 可归因运行先通过唯一度量口径验证基线完整性（AC-4：finish 也失败关闭）。
  const endedAtMs = options.now ? options.now.getTime() : Date.now();
  let measurement = null;
  if (run.baseline && run.baseline.manifestHash) {
    measurement = measureRun(root, run, { now: new Date(endedAtMs) });
  }
  if (status === 'completed') {
    if (!evidence.gate) throw new Error('completed run requires --gate');
    const gate = readJson(resolveInside(root, evidence.gate));
    // 冻结契约副本与工单声明一致性（AC-2）：finish 前失败关闭，零状态变更。
    for (const issue of policy.runGateContractIssues(run, ticket)) {
      throw new Error(`run gate contract identity is invalid: ${issue.message}`);
    }
    const gateIssues = policy.validateGateEvidence(gate, ticket, run);
    if (gateIssues.length || gate.status !== 'passed' || gate.runId !== runId || gate.sourceRevision !== run.sourceRevision) throw new Error('completed run requires a valid passing gate result for the claimed source revision');
    if (run.baseline && run.baseline.manifestHash) {
      const command = String(gate.measureCommand || '');
      if (!command.includes('measure') || !command.includes(runId)) {
        throw new Error('completed attributable run requires gate evidence naming the measure command identity');
      }
      if (gate.baselineHash !== run.baseline.manifestHash) {
        throw new Error('completed attributable run requires the gate baseline hash to match the claimed baseline manifest');
      }
    }
    const reviews = (evidence.reviews || []).map(file => readJson(resolveInside(root, file)));
    for (const lane of ticket.reviewLanes) {
      const accepted = reviews.find(review => review.lane === lane && review.verdict === 'APPROVE' && review.runId === runId && policy.validateReview(review, ticket).length === 0);
      if (!accepted) throw new Error(`completed run requires approved ${lane} review`);
    }
    const changes = (evidence.changes || []).map(file => readJson(resolveInside(root, file)));
    for (const moduleId of ticket.impactedModules) {
      const accepted = changes.find(change => change.moduleId === moduleId && policy.validateModuleChange(change, ticket, registry).length === 0);
      if (!accepted) throw new Error(`completed run requires module change record for ${moduleId}`);
    }
  }
  const finished = {
    ...run, status, endedAt: options.now ? options.now.toISOString() : new Date().toISOString(),
    evidence: { gate: evidence.gate || '', reviews: evidence.reviews || [], changes: evidence.changes || [] },
  };
  const historyFile = resolveInside(root, `${activePolicy.artifacts.runHistory}/${runId}.json`);
  if (fs.existsSync(historyFile)) throw new Error(`history run already exists: ${runId}`);
  writeJsonAtomic(historyFile, finished);
  fs.unlinkSync(activeFile);
  return { run: finished, file: historyFile };
}

function findTicket(root, activePolicy, ticketRef) {
  if (!ticketRef) return null;
  const direct = resolveInside(root, ticketRef);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return { ticket: readJson(direct), file: direct };
  for (const file of findJsonFiles(resolveInside(root, activePolicy.artifacts.tickets))) {
    const ticket = readJson(file);
    if (ticket.id === ticketRef) return { ticket, file };
  }
  throw new Error(`ticket not found: ${ticketRef}`);
}

function artifactIndex(root, activePolicy) {
  const roots = [
    resolveInside(root, activePolicy.artifacts.evidence),
    path.dirname(resolveInside(root, activePolicy.artifacts.activeRuns)),
    resolveInside(root, activePolicy.artifacts.modules),
  ];
  const seen = new Set();
  const artifacts = [];
  for (const directory of roots) for (const file of findJsonFiles(directory)) {
    if (seen.has(file)) continue;
    seen.add(file);
    try { artifacts.push({ artifact: readJson(file), file }); } catch (_) { /* workspace audit reports malformed JSON */ }
  }
  return artifacts;
}

function requiredReviewLanes(ticket, activePolicy, routing) {
  const controls = policy.requiredControls(ticket, activePolicy);
  const lanes = new Set([...(ticket.reviewLanes || []), ...controls.reviews]);
  const global = routing.reviewRules.global;
  if ((ticket.impactedModules || []).length >= global.minimumImpactedModules || (ticket.tags || []).some(tag => global.tags.includes(tag))) lanes.add('global');
  const owner = routing.reviewRules.owner;
  if ((owner.risk || []).includes(ticket.risk)) lanes.add('owner');
  return [...lanes];
}

function promptFor(routing, key, context = []) {
  const lines = context.filter(Boolean);
  const template = routing.prompts[key];
  if (typeof template === 'string') return [template, ...lines].join('\n');
  const prompt = policy.buildHandoffPrompt(template, lines);
  // 字数护栏在模板/配置层判定；运行时动态行（工单/运行/打断引用）合法变化，只强制结构与必备内容。
  const issues = policy.validateHandoffPrompt(prompt, key).filter(issue => issue.code !== 'budget');
  if (issues.length) {
    throw new Error(`generated handoff prompt violates the six-section contract: ${issues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`);
  }
  return prompt;
}

function openInterruptions(root, ticketId = '') {
  const requests = [];
  for (const file of findJsonFiles(resolveInside(root, INTERRUPTS_OPEN))) {
    const request = readJson(file);
    if (policy.validateChangeRequest(request).length || request.status !== 'open') continue;
    if (request.ticketId && request.ticketId !== ticketId) continue;
    requests.push({ request, file });
  }
  return requests.sort((left, right) => Number(right.request.blocking) - Number(left.request.blocking) || String(left.request.createdAt).localeCompare(String(right.request.createdAt)));
}

function computeNextAction(root, ticketRef = '') {
  root = path.resolve(root);
  const { activePolicy, registry } = loadBase(root);
  const routing = loadRouting(root);
  const routingIssues = policy.validateRouting(routing);
  if (routingIssues.length) throw new Error('invalid routing: ' + routingIssues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  const found = ticketRef ? findTicket(root, activePolicy, ticketRef) : null;
  const ticket = found && found.ticket;
  const ticketFile = found ? relativeFrom(root, found.file) : '';
  if (ticket) {
    const ticketIssues = policy.validateTicket(ticket, activePolicy, registry);
    if (ticketIssues.length) throw new Error('invalid ticket: ' + ticketIssues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  }
  const reviewLanes = ticket ? requiredReviewLanes(ticket, activePolicy, routing) : [];
  const requiresGlobalReview = reviewLanes.includes('global');
  const interruptions = openInterruptions(root, ticket ? ticket.id : '');
  if (interruptions.length) {
    const item = interruptions[0];
    const request = item.request;
    let nextRole = 'planner';
    let key = 'planner-replan';
    let mode = 'requirement-triage';
    let ticketAction = '';
    if (request.kind === 'portfolio-review') {
      key = 'planner-portfolio'; mode = 'portfolio-review'; ticketAction = routing.interruptRules['portfolio-review'].any.ticketAction;
    } else if (request.kind === 'hotfix') {
      mode = 'hotfix-triage'; ticketAction = routing.interruptRules.hotfix.any.ticketAction;
    } else {
      const rule = routing.interruptRules.requirement[request.impact] || routing.interruptRules.requirement.unknown;
      nextRole = rule.next; key = nextRole === 'qa-lead' ? 'qa-lead' : 'planner-replan'; ticketAction = rule.ticketAction;
    }
    return {
      status: 'interrupted', nextRole, mode, lane: '', reason: `${request.kind}:${request.impact} requires ${ticketAction}`,
      autoContinue: true, pauseForOwner: false, requiresGlobalReview,
      interrupt: relativeFrom(root, item.file),
      prompt: promptFor(routing, key, [ticketFile ? `Ticket: ${ticketFile}` : '', `Interruption: ${request.id} — ${request.summary}`, `Required ticket action: ${ticketAction}`]),
      commands: [`node scripts/pipeline-cli.js resolve-interrupt ${request.id} --decision DECISION --note "RESULT"`],
    };
  }
  if (!ticket) return {
    status: 'routing', nextRole: 'planner', mode: 'intake', lane: '', reason: 'No ticket exists for the owner request.',
    autoContinue: true, pauseForOwner: false, requiresGlobalReview: false,
    prompt: promptFor(routing, 'planner-intake'), commands: ['Create one draft .agent/tickets/TASK-*.json, then run next with its path.'],
  };
  if (ticket.status === 'draft') return {
    status: 'routing', nextRole: 'qa-lead', mode: 'requirements', lane: '', reason: 'Draft ticket requires QA acceptance.',
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'qa-lead', [`Ticket: ${ticketFile}`, `Required review lanes: ${reviewLanes.join(', ') || 'none'}`]), commands: [],
  };
  if (['blocked', 'cancelled'].includes(ticket.status)) return {
    status: 'routing', nextRole: 'planner', mode: 'replan', lane: '', reason: `Ticket status is ${ticket.status}.`,
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'planner-replan', [`Ticket: ${ticketFile}`]), commands: [],
  };
  if (ticket.status === 'closed') return {
    status: 'done', nextRole: 'done', mode: 'terminal', lane: '', reason: 'Ticket is closed.',
    autoContinue: false, pauseForOwner: false, requiresGlobalReview, prompt: '', commands: [],
  };

  const activeRuns = loadActiveRuns(root, activePolicy).filter(item => item.run.ticketId === ticket.id && item.run.ticketRevision === ticket.revision);
  if (activeRuns.length > 1) throw new Error(`ticket has multiple active runs: ${activeRuns.map(item => item.run.runId).join(', ')}`);
  const histories = findJsonFiles(resolveInside(root, activePolicy.artifacts.runHistory)).map(file => ({ run: readJson(file), file })).filter(item => item.run.ticketId === ticket.id && item.run.ticketRevision === ticket.revision).sort((a, b) => String(b.run.endedAt || '').localeCompare(String(a.run.endedAt || '')));
  if (!activeRuns.length && histories[0] && histories[0].run.status === 'completed') return {
    status: 'routing', nextRole: 'context-sync', mode: 'close-ticket', lane: '', reason: 'Run completed but ticket is not closed.',
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'context-sync', [`Ticket: ${ticketFile}`, `Run: ${histories[0].run.runId}`]), commands: [],
  };
  if (!activeRuns.length) {
    const runId = `RUN-${ticket.id.slice(5)}`;
    return {
      status: 'routing', nextRole: 'worker', mode: 'implement', lane: '', reason: 'Accepted ticket has no active Worker run.',
      autoContinue: true, pauseForOwner: false, requiresGlobalReview,
      prompt: promptFor(routing, 'worker', [`Ticket: ${ticketFile}`, `Suggested run: ${runId}`]),
      commands: [`node scripts/pipeline-cli.js preflight ${ticketFile} --role worker --run-id ${runId}`, `node scripts/pipeline-cli.js claim ${ticketFile} --run-id ${runId} --role worker`],
    };
  }
  const run = activeRuns[0].run;
  if ((run.phase || 'worker-active') !== 'worker-complete') return {
    status: 'routing', nextRole: 'worker', mode: run.phase === 'repair-active' ? 'repair' : 'implement', lane: '', reason: `Active run phase is ${run.phase || 'worker-active'}.`,
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'worker', [`Ticket: ${ticketFile}`, `Run: ${run.runId}`]),
    commands: [`node scripts/pipeline-cli.js checkpoint ${run.runId} --phase worker-complete`],
  };

  const artifacts = artifactIndex(root, activePolicy);
  const ticketArtifacts = artifacts.filter(item => item.artifact.ticketId === ticket.id && item.artifact.ticketRevision === ticket.revision);
  const gates = ticketArtifacts.filter(item => item.artifact.artifactType === 'gate-result' && item.artifact.runId === run.runId).sort((a, b) => String(b.artifact.endedAt || b.artifact.id || '').localeCompare(String(a.artifact.endedAt || a.artifact.id || '')));
  const gate = gates[0];
  if (!gate || gate.artifact.status !== 'passed' || policy.validateGateResult(gate.artifact, ticket).length) {
    const exhausted = run.repairAttempts >= ticket.budgets.maxRepairAttempts;
    return {
      status: exhausted ? 'paused' : 'routing', nextRole: exhausted ? 'planner' : 'deterministic-gate', mode: exhausted ? 'circuit-breaker' : 'gate', lane: '',
      reason: exhausted ? 'Repair budget exhausted.' : (gate ? 'Latest gate is not a valid pass.' : 'Worker checkpoint requires deterministic gate evidence.'),
      autoContinue: !exhausted, pauseForOwner: exhausted, requiresGlobalReview,
      prompt: promptFor(routing, exhausted ? 'planner-replan' : 'deterministic-gate', [`Ticket: ${ticketFile}`, `Run: ${run.runId}`]), commands: [],
    };
  }
  const changes = ticketArtifacts.filter(item => item.artifact.artifactType === 'module-change' && policy.validateModuleChange(item.artifact, ticket, registry).length === 0);
  const missingModules = ticket.impactedModules.filter(moduleId => !changes.some(item => item.artifact.moduleId === moduleId));
  if (missingModules.length) return {
    status: 'routing', nextRole: 'worker', mode: 'complete-records', lane: '', reason: `Missing valid module records: ${missingModules.join(', ')}.`,
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'worker', [`Ticket: ${ticketFile}`, `Run: ${run.runId}`, `Create module records: ${missingModules.join(', ')}`]), commands: [],
  };
  const reviews = ticketArtifacts.filter(item => item.artifact.artifactType === 'review' && item.artifact.runId === run.runId && item.artifact.verdict === 'APPROVE' && policy.validateReview(item.artifact, ticket).length === 0);
  for (const lane of reviewLanes) if (!reviews.some(item => item.artifact.lane === lane)) {
    const owner = lane === 'owner';
    const role = owner ? 'owner' : 'reviewer';
    const key = owner ? 'owner' : lane === 'global' ? 'reviewer-global' : 'reviewer-module';
    return {
      status: owner ? 'paused' : 'routing', nextRole: role, mode: 'review', lane, reason: `Required ${lane} review is missing.`,
      autoContinue: !owner, pauseForOwner: owner, requiresGlobalReview,
      prompt: promptFor(routing, key, [`Ticket: ${ticketFile}`, `Run: ${run.runId}`, `Gate: ${relativeFrom(root, gate.file)}`]), commands: [],
    };
  }
  const reviewFiles = reviews.map(item => relativeFrom(root, item.file));
  const changeFiles = changes.map(item => relativeFrom(root, item.file));
  return {
    status: 'routing', nextRole: 'context-sync', mode: 'closeout', lane: '', reason: 'Gate, module records and required reviews are complete.',
    autoContinue: true, pauseForOwner: false, requiresGlobalReview,
    prompt: promptFor(routing, 'context-sync', [`Ticket: ${ticketFile}`, `Run: ${run.runId}`]),
    commands: [`node scripts/pipeline-cli.js finish ${run.runId} --status completed --gate ${relativeFrom(root, gate.file)} ${reviewFiles.map(file => `--review ${file}`).join(' ')} ${changeFiles.map(file => `--change ${file}`).join(' ')}`.replace(/\s+/g, ' ').trim()],
  };
}

// 组合路由选择器：关闭票据后决定整个资产组合的下一个安全角色。
// 优先级：继续活动运行 → 第一个依赖满足且已启用的包 → 已取消票据显式处置 → 缺失票据转 Planner intake
// → DEFERRED 转所有者启用决定 → 终局判定（需求登记簿 + owner tails + 打断 + 损坏状态全部收敛才允许 done）。
// 状态损坏或证据畸形时直接抛错失败关闭，绝不声称完成。
function buildPortfolioNext(root) {
  root = path.resolve(root);
  const { activePolicy } = loadBase(root);
  const routing = loadRouting(root);
  const routingIssues = policy.validateRouting(routing);
  if (routingIssues.length) throw new Error('invalid routing: ' + routingIssues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  const processPolicy = require('./process-policy.js');
  const queue = buildQueue(root);
  if (queue.errors.length) {
    throw new Error('portfolio routing fails closed on malformed state: ' +
      queue.errors.map(error => `${error.source} ${error.path}: ${error.message}`).join('; '));
  }
  for (const file of findJsonFiles(resolveInside(root, INTERRUPTS_OPEN))) {
    const request = readJson(file);
    // 可解析但 schema 无效的开放中断同样失败关闭：绝不能越过无效证据宣称组合完成（AC-6）。
    const requestIssues = policy.validateChangeRequest(request);
    if (requestIssues.length) {
      throw new Error('portfolio routing fails closed on invalid open interruption: ' +
        `${relativeFrom(root, file)} ${requestIssues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`);
    }
    if (request.status !== 'open') continue;
    const route = computeNextAction(root, request.ticketId || '');
    return { ...route, portfolio: { type: 'triage-interruption', packageId: request.ticketId || '', interrupt: request.id } };
  }
  const byStatus = status => queue.entries.filter(item => item.effectiveStatus === status);
  const ownerPause = (mode, reason, lines, portfolio) => ({
    status: 'paused', nextRole: 'owner', mode, lane: '', reason,
    autoContinue: false, pauseForOwner: true, requiresGlobalReview: false,
    prompt: promptFor(routing, 'owner', lines), commands: [], portfolio,
  });
  const active = byStatus('active');
  if (active.length) {
    const route = computeNextAction(root, active[0].id);
    return { ...route, portfolio: { type: 'continue-active', packageId: active[0].id, runId: active[0].runId } };
  }
  const ready = byStatus('ready');
  if (ready.length) {
    const route = computeNextAction(root, ready[0].id);
    return { ...route, portfolio: { type: 'start-ready', packageId: ready[0].id } };
  }
  const cancelled = byStatus('cancelled');
  if (cancelled.length) {
    const target = cancelled[0];
    return {
      status: 'routing', nextRole: 'planner', mode: 'replan', lane: '', reason: `Ticket ${target.id} is cancelled and still needs an explicit portfolio disposition.`,
      autoContinue: true, pauseForOwner: false, requiresGlobalReview: false,
      prompt: promptFor(routing, 'planner-replan', [`Ticket: ${target.id}`, `Queue: ${target.title || target.id} is cancelled`]),
      commands: [],
      portfolio: { type: 'plan-disposition', packageId: target.id },
    };
  }
  const missing = byStatus('missing-ticket');
  if (missing.length) {
    const target = missing[0];
    return {
      status: 'routing', nextRole: 'planner', mode: 'intake', lane: '', reason: `Package ${target.id} has no task ticket; routing to Planner intake instead of returning done.`,
      autoContinue: true, pauseForOwner: false, requiresGlobalReview: false,
      prompt: promptFor(routing, 'planner-intake', [`Package without ticket: ${target.id} — ${target.title || target.outcome || ''}`]),
      commands: ['Create one draft .agent/tickets/TASK-*.json, then run next with its path.'],
      portfolio: { type: 'plan-intake', packageId: target.id },
    };
  }
  const deferred = byStatus('deferred-ready');
  if (deferred.length) {
    const target = deferred[0];
    return ownerPause('owner-enable',
      `Deferred package ${target.id} can only start with an explicit owner enable decision.`,
      [`Decision requested: enable ${target.id} (${target.title || target.outcome || ''}) now, or record an explicit owner disposition keeping it deferred.`,
        `Evidence: ${target.blockers.join('；') || 'DEFERRED package'}; queue entry ${target.id}.`,
        'Consequence: until you decide, no work starts automatically and the portfolio cannot reach done.'],
      { type: 'owner-enable', packageId: target.id });
  }
  const blocked = byStatus('blocked');
  if (blocked.length) {
    const target = blocked[0];
    return ownerPause('blocked-portfolio',
      `Package ${target.id} is blocked and no safe automatic route remains.`,
      [`Decision requested: resolve the blocker for ${target.id} (${target.blockers.join('；')}).`,
        'Consequence: the pipeline cannot invent tickets or prerequisites; without your decision the item stays blocked.'],
      { type: 'blocked-portfolio', packageId: target.id });
  }

  const processState = readOptionalJson(root, PROCESS_STATE_FILE, null);
  if (processState) {
    const stateIssues = processPolicy.validateState(processState);
    if (stateIssues.length) {
      throw new Error('portfolio routing fails closed on malformed PROCESS-STATE: ' +
        stateIssues.map(issue => `${issue.path} ${issue.message}`).join('; '));
    }
  }
  const tails = (processState && processState.ownerTails) || [];
  if (tails.length) {
    const tail = tails[0];
    return ownerPause('owner-tail',
      `${tails.length} open owner tail(s) block portfolio completion; only the owner can perform or waive them.`,
      [`Decision requested: complete or explicitly disposition owner tail ${tail.id} (${tail.title}).`,
        `Evidence: ${(tail.evidence || []).map(item => item.file).join(', ') || 'no durable evidence attached'}; ${tails.length} tail(s) open.`,
        'Consequence: done is withheld until every tail is closed or explicitly dispositioned with durable evidence.'],
      { type: 'owner-tail', tailId: tail.id, openTailCount: tails.length });
  }
  const items = (processState && processState.requirements && processState.requirements.items) || [];
  const openRequirement = items.find(item => item.state === 'open');
  if (openRequirement) {
    return {
      status: 'routing', nextRole: 'planner', mode: 'intake', lane: '', reason: `Tracked requirement ${openRequirement.id} is open and undispositioned; routing to Planner intake.`,
      autoContinue: true, pauseForOwner: false, requiresGlobalReview: false,
      prompt: promptFor(routing, 'planner-intake', [`Open tracked requirement: ${openRequirement.id} — ${openRequirement.title} (${openRequirement.source} @ ${openRequirement.anchor.slice(0, 60)})`]),
      commands: ['Create one draft .agent/tickets/TASK-*.json, then run next with its path.'],
      portfolio: { type: 'plan-requirement', requirementId: openRequirement.id },
    };
  }
  return {
    status: 'done', nextRole: 'done', mode: 'terminal', lane: '',
    reason: 'Every tracked requirement is closed or explicitly dispositioned; no open run, interruption, owner tail or undispositioned requirement remains.',
    autoContinue: false, pauseForOwner: false, requiresGlobalReview: false, prompt: '', commands: [],
    portfolio: { type: 'complete' },
  };
}

function nextAction(root, ticketRef = '') {
  root = path.resolve(root);
  const result = computeNextAction(root, ticketRef);
  if (result.nextRole === 'done') return { ...buildPortfolioNext(root), newConversationRequired: false, handoff: null };
  root = path.resolve(root);
  const result = computeNextAction(root, ticketRef);
  if (result.nextRole === 'done') return { ...result, newConversationRequired: false, handoff: null };
  const { activePolicy } = loadBase(root);
  const found = ticketRef ? findTicket(root, activePolicy, ticketRef) : null;
  const roleKey = result.nextRole === 'owner' ? '' : (result.nextRole.startsWith('reviewer') ? 'reviewer' : result.nextRole);
  const requiredFiles = [
    'docs/README-AI.md',
    roleKey && activePolicy.roleFiles[roleKey],
    found && relativeFrom(root, found.file),
    result.interrupt || '',
  ].filter(Boolean);
  return {
    ...result,
    autoContinue: false,
    newConversationRequired: result.nextRole !== 'owner',
    handoff: {
      action: result.nextRole === 'owner' ? 'ask-owner-here' : 'open-new-conversation',
      nextRole: result.nextRole,
      reason: result.reason,
      requiredFiles,
      globalReviewRequired: result.requiresGlobalReview,
      prompt: result.prompt,
      instruction: result.nextRole === 'owner'
        ? 'Ask the owner only for the named decision.'
        : 'Return this handoff to the owner verbatim, then stop. Do not perform the next role in the current conversation.',
    },
  };
}

function checkpointRun(root, runId, phase, options = {}) {
  root = path.resolve(root);
  const { activePolicy } = loadBase(root);
  if (!policy.RUN_PHASES.has(phase)) throw new Error(`unsupported phase: ${phase}`);
  const file = resolveInside(root, `${activePolicy.artifacts.activeRuns}/${runId}.json`);
  if (!fs.existsSync(file)) throw new Error(`active run not found: ${runId}`);
  const run = readJson(file);
  if (run.phase === phase) return { run, file };
  const at = options.now ? options.now.toISOString() : new Date().toISOString();
  const checkpoints = Array.isArray(run.roleCheckpoints) ? [...run.roleCheckpoints] : [];
  checkpoints.push({ role: 'worker', phase, at });
  // worker-complete 开始等待，repair-active/worker-active 恢复活跃；legacy 无 timing 字段则不注入。
  const timing = transitionTiming(run.timing, phase === 'worker-complete' ? 'waiting' : 'active', Date.parse(at));
  const updated = { ...run, phase, roleCheckpoints: checkpoints, ...(timing ? { timing } : {}) };
  if (phase === 'repair-active' && run.phase !== 'repair-active') updated.repairAttempts = (run.repairAttempts || 0) + 1;
  const issues = policy.validateRunManifest(updated, activePolicy);
  if (issues.length) throw new Error('invalid checkpointed run: ' + issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  writeJsonAtomic(file, updated);
  return { run: updated, file };
}

function registerInterrupt(root, input, options = {}) {
  root = path.resolve(root);
  const request = {
    artifactType: 'change-request', schemaVersion: 1, id: input.id, kind: input.kind,
    ticketId: input.ticketId || '', summary: input.summary, impact: input.impact || 'unknown',
    blocking: input.blocking !== false, status: 'open',
    createdAt: options.now ? options.now.toISOString() : new Date().toISOString(), decision: '', note: '',
  };
  const issues = policy.validateChangeRequest(request);
  if (issues.length) throw new Error('invalid interruption: ' + issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  const file = resolveInside(root, `${INTERRUPTS_OPEN}/${request.id}.json`);
  writeJsonExclusive(file, request);
  return { request, file };
}

function resolveInterrupt(root, id, decision, note = '', options = {}) {
  root = path.resolve(root);
  const openFile = resolveInside(root, `${INTERRUPTS_OPEN}/${id}.json`);
  if (!fs.existsSync(openFile)) throw new Error(`open interruption not found: ${id}`);
  const request = readJson(openFile);
  const resolved = { ...request, status: 'resolved', decision, note, resolvedAt: options.now ? options.now.toISOString() : new Date().toISOString() };
  const issues = policy.validateChangeRequest(resolved);
  if (issues.length) throw new Error('invalid resolved interruption: ' + issues.map(issue => `${issue.path} ${issue.message}`).join('; '));
  const historyFile = resolveInside(root, `${INTERRUPTS_HISTORY}/${id}.json`);
  writeJsonExclusive(historyFile, resolved);
  fs.unlinkSync(openFile);
  return { request: resolved, file: historyFile };
}

function parseArgs(argv) {
  const result = { positional: [], root: path.resolve(__dirname, '..'), role: 'worker', reviews: [], changes: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--json') result.json = true;
    else if (value === '--root' && argv[i + 1]) result.root = path.resolve(argv[++i]);
    else if (value === '--role' && argv[i + 1]) result.role = argv[++i];
    else if (value === '--run-id' && argv[i + 1]) result.runId = argv[++i];
    else if (value === '--status' && argv[i + 1]) result.status = argv[++i];
    else if (value === '--at' && argv[i + 1]) result.at = argv[++i];
    else if (value === '--gate' && argv[i + 1]) result.gate = argv[++i];
    else if (value === '--review' && argv[i + 1]) result.reviews.push(argv[++i]);
    else if (value === '--change' && argv[i + 1]) result.changes.push(argv[++i]);
    else if (value === '--class' && argv[i + 1]) result.ticketClass = argv[++i];
    else if (value === '--phase' && argv[i + 1]) result.phase = argv[++i];
    else if (value === '--id' && argv[i + 1]) result.id = argv[++i];
    else if (value === '--kind' && argv[i + 1]) result.kind = argv[++i];
    else if (value === '--ticket-id' && argv[i + 1]) result.ticketId = argv[++i];
    else if (value === '--impact' && argv[i + 1]) result.impact = argv[++i];
    else if (value === '--summary' && argv[i + 1]) result.summary = argv[++i];
    else if (value === '--blocking' && argv[i + 1]) {
      const raw = argv[++i];
      if (!['true', 'false'].includes(raw)) throw new Error('--blocking must be true or false');
      result.blocking = raw === 'true';
    }
    else if (value === '--decision' && argv[i + 1]) result.decision = argv[++i];
    else if (value === '--note' && argv[i + 1]) result.note = argv[++i];
    else if (value.startsWith('--')) throw new Error(`unknown flag: ${value}`);
    else result.positional.push(value);
  }
  return result;
}

function printAudit(result, asJson) {
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  for (const error of result.errors) console.error(`  ✘ ${error.source} ${error.path}: ${error.message}`);
  for (const warning of result.warnings || []) console.warn(`  ⚠ ${warning.code}: ${warning.message}${warning.evidence && warning.evidence.length ? ` [evidence: ${warning.evidence.join(', ')}]` : ''}`);
  console.log(`Pipeline check: ${result.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result.metrics)}`);
}

function main(argv) {
  try {
    const args = parseArgs(argv);
    const command = args.positional.shift();
    if (command === 'check') {
      const result = workspaceAudit(args.root);
      printAudit(result, args.json);
      if (!result.ok) process.exitCode = 1;
    } else if (command === 'ticket') {
      const ticketFile = args.positional[0];
      if (!ticketFile) throw new Error('usage: pipeline-cli.js ticket <file>');
      const { activePolicy, registry } = loadBase(args.root);
      const issues = policy.validateTicket(readJson(resolveInside(args.root, ticketFile)), activePolicy, registry);
      if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
      console.log('Ticket check: PASS');
    } else if (command === 'preflight') {
      const ticketFile = args.positional[0];
      if (!ticketFile) throw new Error('usage: pipeline-cli.js preflight <ticket> [--role worker]');
      const runId = args.runId || 'RUN-PREFLIGHT';
      const built = buildContextManifest(args.root, ticketFile, args.role, runId);
      const conflicts = activeConflicts(args.root, built.activePolicy, built.ticket.lockScope || built.ticket.writeScope);
      const controls = policy.requiredControls(built.ticket, built.activePolicy);
      const result = { ok: conflicts.length === 0, ticketId: built.ticket.id, risk: built.ticket.risk, controls, contextBytes: built.totalBytes, contextHash: built.manifest.contextHash, conflicts: conflicts.map(item => item.run.runId) };
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } else if (command === 'claim') {
      const ticketFile = args.positional[0];
      if (!ticketFile || !args.runId) throw new Error('usage: pipeline-cli.js claim <ticket> --run-id RUN-* [--role worker]');
      const result = claimRun(args.root, ticketFile, args.runId, args.role);
      console.log(JSON.stringify({ run: relativeFrom(args.root, result.file), contextHash: result.context.contextHash }, null, 2));
    } else if (command === 'next') {
      const result = nextAction(args.root, args.positional[0] || '');
      console.log(JSON.stringify(result, null, 2));
      if (result.pauseForOwner) process.exitCode = 4;
    } else if (command === 'checkpoint') {
      const runId = args.positional[0] || args.runId;
      if (!runId || !args.phase) throw new Error('usage: pipeline-cli.js checkpoint RUN-* --phase worker-complete|repair-active');
      const result = checkpointRun(args.root, runId, args.phase);
      console.log(JSON.stringify({ run: relativeFrom(args.root, result.file), phase: result.run.phase, repairAttempts: result.run.repairAttempts }, null, 2));
    } else if (command === 'measure') {
      const runId = args.positional[0] || args.runId;
      if (!runId) throw new Error('usage: pipeline-cli.js measure RUN-* [--at ISO8601]');
      const { activePolicy } = loadBase(args.root);
      const activeFile = resolveInside(args.root, `${activePolicy.artifacts.activeRuns}/${runId}.json`);
      if (!fs.existsSync(activeFile)) throw new Error(`active run not found: ${runId}`);
      const now = args.at ? new Date(Date.parse(args.at)) : undefined;
      if (args.at && !Number.isFinite(now.getTime())) throw new Error('--at must be an ISO-8601 timestamp');
      const result = measureRun(args.root, readJson(activeFile), now ? { now } : {});
      console.log(JSON.stringify(result, null, 2));
      if (result.diagnostics && result.diagnostics.length) process.exitCode = 3;
    } else if (command === 'interrupt') {
      if (!args.id || !args.kind || !args.summary) throw new Error('usage: pipeline-cli.js interrupt --id INT-* --kind requirement|hotfix|portfolio-review --summary TEXT [--ticket-id TASK-*] [--impact ...]');
      const result = registerInterrupt(args.root, args);
      console.log(JSON.stringify({ interrupt: relativeFrom(args.root, result.file), status: result.request.status }, null, 2));
    } else if (command === 'resolve-interrupt') {
      const id = args.positional[0] || args.id;
      if (!id || !args.decision) throw new Error('usage: pipeline-cli.js resolve-interrupt INT-* --decision VALUE [--note TEXT]');
      const result = resolveInterrupt(args.root, id, args.decision, args.note || '');
      console.log(JSON.stringify({ interrupt: relativeFrom(args.root, result.file), status: result.request.status, decision: result.request.decision }, null, 2));
    } else if (command === 'finish') {
      const runId = args.positional[0] || args.runId;
      if (!runId || !args.status) throw new Error('usage: pipeline-cli.js finish RUN-* --status completed|blocked|cancelled [evidence flags]');
      const result = finishRun(args.root, runId, args.status, { gate: args.gate, reviews: args.reviews, changes: args.changes });
      console.log(JSON.stringify({ run: relativeFrom(args.root, result.file), status: result.run.status }, null, 2));
    } else if (command === 'circuit') {
      const attemptsFile = args.positional[0];
      if (!attemptsFile) throw new Error('usage: pipeline-cli.js circuit <attempts.json> [--class hotfix]');
      const { activePolicy } = loadBase(args.root);
      const attempts = readJson(resolveInside(args.root, attemptsFile));
      const result = policy.circuitDecision(attempts, activePolicy, args.ticketClass || 'feature');
      console.log(JSON.stringify(result, null, 2));
      if (result.stop) process.exitCode = 3;
    } else throw new Error('usage: pipeline-cli.js check|ticket|preflight|claim|next|checkpoint|interrupt|resolve-interrupt|finish|circuit');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  readJson,
  findJsonFiles,
  loadBase,
  loadRouting,
  workspaceAudit,
  buildContextManifest,
  activeConflicts,
  withClaimLock,
  claimRun,
  nextAction,
  buildPortfolioNext,
  checkpointRun,
  measureRun,
  registerInterrupt,
  resolveInterrupt,
  finishRun,
  parseArgs,
  getGitRevision,
};
