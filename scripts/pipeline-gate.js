// 确定性门执行器：将冻结门契约的声明绑定到真实子进程结果、真实日志与真实来源字节。
// 只写 .agent/evidence/<ticket>/runs/<runId>/ 下的锁/日志/门制品；不执行契约外命令，不触网、不部署。
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const policy = require('./pipeline-policy.js');

const BINDING_VERSION = 1;

function gateError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function resolveInside(root, relative) {
  const normalized = policy.normalizeRepoPath(relative);
  const absolute = path.resolve(root, normalized);
  const base = path.resolve(root) + path.sep;
  if (absolute !== path.resolve(root) && !absolute.startsWith(base)) {
    throw gateError('GATE_BINDING_LOG_PATH', `path escapes repository: ${relative}`);
  }
  return absolute;
}

function bindingContractHash(ticket) {
  return policy.bindingContractHash(ticket);
}

function snapshotInputs(root, inputPaths) {
  root = path.resolve(root);
  const normalized = inputPaths.map(item => policy.normalizeRepoPath(item)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const files = [];
  for (const relative of normalized) {
    const absolute = resolveInside(root, relative);
    let stats = null;
    try { stats = fs.lstatSync(absolute); } catch (_) {
      throw gateError('GATE_BINDING_INPUT_IDENTITY', `declared input is missing: ${relative}`);
    }
    if (stats.isSymbolicLink()) throw gateError('GATE_BINDING_INPUT_IDENTITY', `declared input is a symlink: ${relative}`);
    if (!stats.isFile()) throw gateError('GATE_BINDING_INPUT_IDENTITY', `declared input is not a regular file: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    files.push({ path: relative, sizeBytes: bytes.length, sha256: policy.sha256(bytes) });
  }
  return { identity: policy.inputSnapshotIdentity(files), files };
}

function countLines(text) {
  if (!text) return 0;
  const parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function truncateUtf8ToBytes(text, maxBytes) {
  // UTF-8-safe: never split a multibyte character; the re-encoded result is
  // always at most maxBytes (a boundary cut can land up to 3 bytes short).
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 0;
  let end = 0;
  for (const unit of text) {
    const unitBytes = Buffer.byteLength(unit, 'utf8');
    if (used + unitBytes > maxBytes) break;
    used += unitBytes;
    end += unit.length;
  }
  return text.slice(0, end);
}

function truncateText(text, maxBytes, maxLines) {
  let truncated = false;
  if (text !== '') {
    let logical = text.split('\n');
    if (text.endsWith('\n')) logical.pop();
    if (logical.length > maxLines) {
      logical = logical.slice(0, maxLines);
      text = logical.join('\n');
      truncated = true;
    }
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    text = truncateUtf8ToBytes(text, maxBytes);
    truncated = true;
  }
  if (countLines(text) > maxLines) {
    const all = text.split('\n');
    text = all.slice(0, maxLines).join('\n');
    truncated = true;
  }
  return { text, truncated };
}

// 注入式日志名：冻结清单序号 + 完整原始 id 的 SHA-256 前缀。有损清洗（标点折叠、
// 64 字符截断、Windows 大小写别名）会把不同 check id 映射到同一物理日志文件，
// 因此日志名只由 [0-9a-z.-] 组成且对 (id, 序号) 单射。
function logFileName(id, ordinal) {
  return `check-${String(ordinal).padStart(3, '0')}-${policy.sha256(String(id)).slice(0, 16)}.log`;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      try { childProcess.execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { child.kill('SIGTERM'); } catch (_) { /* best effort */ } }
    } else {
      // POSIX：检查命令以独立进程组运行（spawn detached），负 PID 信号覆盖 shell 与全部后代；
      // 宽限 1 秒后对整组升级 SIGKILL，保证取消/超时后没有后代进程继续存活或改写声明输入。
      let groupPid = 0;
      try { process.kill(-child.pid, 'SIGTERM'); groupPid = child.pid; } catch (_) { /* fall back to child-only signal */ }
      try { child.kill('SIGTERM'); } catch (_) { /* best effort */ }
      if (groupPid) {
        const escalate = setTimeout(() => {
          try { process.kill(-groupPid, 'SIGKILL'); } catch (_) { /* group already gone */ }
        }, 1000);
        if (typeof escalate.unref === 'function') escalate.unref();
      }
    }
  } catch (_) { /* best effort */ }
}

function execOne(command, cwd, timeoutMs, cancelState) {
  return new Promise(resolve => {
    const started = new Date();
    const startedAt = started.toISOString();
    const startMs = started.getTime();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child = null;
    try {
      // detached（仅 POSIX）让 shell 成为进程组组长，取消时可整组终止后代。
      child = childProcess.spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) {
      const ended = new Date();
      return resolve({ startedAt, endedAt: ended.toISOString(), durationMs: ended.getTime() - startMs, exitCode: 1, timedOut: false, output: String(error && error.message || error) });
    }
    cancelState.child = child;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    // Cross-platform cancellation: signals (POSIX) set cancelState.cancelled via handlers;
    // a `.cancel-requested` file (tooling/tests, Windows-safe) is polled here so abrupt
    // process termination is never required to reclaim partial state.
    const poller = setInterval(() => {
      if (cancelState.cancelled) { killTree(child); return; }
      if (cancelState.cancelFile && fs.existsSync(cancelState.cancelFile)) {
        cancelState.cancelled = true;
        killTree(child);
      }
    }, 100);
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      cancelState.child = null;
      resolve(result);
    };
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', () => {
      const ended = new Date();
      done({ startedAt, endedAt: ended.toISOString(), durationMs: ended.getTime() - startMs, exitCode: 1, timedOut: false, output: stdout + stderr });
    });
    child.on('close', code => {
      const ended = new Date();
      const endedAt = ended.toISOString();
      const durationMs = ended.getTime() - startMs;
      if (cancelState.cancelled) {
        done({ startedAt, endedAt, durationMs, exitCode: null, timedOut: false, cancelled: true, output: stdout + stderr });
      } else if (timedOut) {
        done({ startedAt, endedAt, durationMs, exitCode: null, timedOut: true, output: stdout + stderr });
      } else {
        done({ startedAt, endedAt, durationMs, exitCode: typeof code === 'number' ? code : 1, timedOut: false, output: stdout + stderr });
      }
    });
  });
}

function runDirFor(root, ticketId, runId) {
  return path.join(path.resolve(root), '.agent', 'evidence', ticketId, 'runs', runId);
}

function localBase(root) {
  const policyFile = path.join(root, '.agent', 'PIPELINE-POLICY.json');
  const modulesFile = path.join(root, '.agent', 'MODULES.json');
  return { activePolicy: JSON.parse(fs.readFileSync(policyFile, 'utf8')), registry: JSON.parse(fs.readFileSync(modulesFile, 'utf8')) };
}

function localFindJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...localFindJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

async function runGate(root, runId, options = {}) {
  root = path.resolve(root);
  const base = localBase(root);
  const activeFile = path.join(root, base.activePolicy.artifacts.activeRuns.replace(/\//g, path.sep), `${runId}.json`);
  if (!fs.existsSync(activeFile)) throw gateError('GATE_RUN_MISSING', `active run not found: ${runId}`);
  const run = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
  if (run.runId !== runId) throw gateError('GATE_BINDING_EXECUTION', 'run identity mismatch');
  if (run.status !== 'active') throw gateError('GATE_BINDING_EXECUTION', 'only an active run may execute a gate');
  const ticketFile = localFindJsonFiles(path.join(root, base.activePolicy.artifacts.tickets)).find(file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).id === run.ticketId; } catch (_) { return false; }
  });
  if (!ticketFile) throw gateError('GATE_BINDING_EXECUTION', `ticket not found: ${run.ticketId}`);
  const ticket = JSON.parse(fs.readFileSync(ticketFile, 'utf8'));
  if (ticket.revision !== run.ticketRevision) throw gateError('GATE_BINDING_EXECUTION', 'active run uses a stale ticket revision');
  if (!ticket.gateContract || !ticket.gateEvidenceBinding) throw gateError('GATE_BINDING_MISSING', 'accepted ticket declares no runnable binding');
  const declarationIssues = policy.validateGateEvidenceBindingDeclaration(ticket.gateEvidenceBinding, ticket, base.registry);
  if (declarationIssues.length) throw gateError('GATE_BINDING_DECLARATION', declarationIssues.map(i => `${i.path} ${i.message}`).join('; '));
  if (!run.gateContract || run.gateContractVersion !== 2 || !run.gateContractHash) {
    throw gateError('GATE_BINDING_EXECUTION', 'run carries no frozen gate contract');
  }
  for (const issue of policy.runGateContractIssues(run, ticket)) {
    throw gateError('GATE_BINDING_EXECUTION', issue.message);
  }
  const logPolicy = ticket.gateEvidenceBinding.logPolicy;
  const timeoutMs = ticket.gateEvidenceBinding.checkTimeoutMs;
  const contractHash = bindingContractHash(ticket);
  const inputBefore = snapshotInputs(root, ticket.gateEvidenceBinding.inputPaths);
  const dir = runDirFor(root, ticket.id, run.runId);
  const lockFile = path.join(dir, '.gate-run.lock');
  const logsDir = path.join(dir, 'logs');
  const gateFile = path.join(dir, 'gate.json');
  fs.mkdirSync(dir, { recursive: true });
  let lockHandle = null;
  try {
    lockHandle = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n', 'utf8');
  } catch (error) {
    if (error && error.code === 'EEXIST') throw gateError('GATE_RUN_IN_PROGRESS', `another gate runner holds the run lock: ${runId}`);
    throw error;
  }
  const cancelFile = path.join(dir, '.cancel-requested');
  try { if (fs.existsSync(cancelFile)) fs.unlinkSync(cancelFile); } catch (_) { /* best effort */ }
  const cancelState = { cancelled: false, child: null, cancelFile };
  const onCancel = () => {
    cancelState.cancelled = true;
    if (cancelState.child) killTree(cancelState.child);
  };
  process.once('SIGINT', onCancel);
  process.once('SIGTERM', onCancel);
  const cleanupPartial = () => {
    try { if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    try {
      const temp = gateFile + `.tmp-${process.pid}`;
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch (_) { /* best effort */ }
    try { if (fs.existsSync(cancelFile)) fs.unlinkSync(cancelFile); } catch (_) { /* best effort */ }
    try { if (lockHandle !== null) fs.closeSync(lockHandle); } catch (_) { /* best effort */ }
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) { /* best effort */ }
  };
  try {
    try { if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    fs.mkdirSync(logsDir, { recursive: true });
    const runnerStart = new Date();
    const executions = [];
    const checks = [];
    let totalBytes = 0;
    let totalLines = 0;
    for (const [index, frozen] of run.gateContract.checks.entries()) {
      if (cancelState.cancelled || fs.existsSync(cancelFile)) throw gateError('GATE_RUN_CANCELLED', 'gate runner was cancelled');
      const result = await execOne(frozen.command, root, timeoutMs, cancelState);
      if (cancelState.cancelled || result.cancelled || fs.existsSync(cancelFile)) throw gateError('GATE_RUN_CANCELLED', 'gate runner was cancelled');
      let status = 'failed';
      let exitCode = result.exitCode;
      if (result.timedOut) { status = 'timed-out'; exitCode = null; }
      else if (Array.isArray(frozen.successExitCodes) && frozen.successExitCodes.includes(exitCode)) status = 'passed';
      else status = 'failed';
      // Per-check truncation, then total-budget truncation (deterministic: earlier checks keep budget).
      const per = truncateText(result.output, logPolicy.maxBytesPerCheck, logPolicy.maxLinesPerCheck);
      let text = per.text;
      let truncated = per.truncated;
      const remainingBytes = Math.max(0, logPolicy.maxTotalBytes - totalBytes);
      const remainingLines = Math.max(0, logPolicy.maxTotalLines - totalLines);
      const currentBytes = Buffer.byteLength(text, 'utf8');
      const currentLines = countLines(text);
      if (currentBytes > remainingBytes || currentLines > remainingLines) {
        const fit = truncateText(text, remainingBytes, remainingLines);
        text = fit.text;
        truncated = true;
      }
      const sizeBytes = Buffer.byteLength(text, 'utf8');
      const lineCount = countLines(text);
      totalBytes += sizeBytes;
      totalLines += lineCount;
      const logName = logFileName(frozen.id, index);
      const logRelative = `.agent/evidence/${ticket.id}/runs/${run.runId}/logs/${logName}`;
      const logAbsolute = path.join(logsDir, logName);
      fs.writeFileSync(logAbsolute, text, 'utf8');
      const sha = policy.sha256(Buffer.from(text, 'utf8'));
      executions.push({
        id: frozen.id, command: frozen.command,
        startedAt: result.startedAt, endedAt: result.endedAt, durationMs: result.durationMs,
        log: { path: logRelative, sha256: sha, sizeBytes, lineCount, truncated },
      });
      checks.push({
        id: frozen.id, category: frozen.category, command: frozen.command, required: frozen.required,
        status, exitCode, durationMs: result.durationMs, evidenceHash: sha,
      });
    }
    const runnerEnd = new Date();
    const inputAfter = snapshotInputs(root, ticket.gateEvidenceBinding.inputPaths);
    const requiredIds = run.gateContract.checks.filter(c => c.required === true).map(c => c.id);
    const allRequiredPassed = requiredIds.every(id => {
      const found = checks.find(c => c.id === id);
      return found && found.status === 'passed';
    });
    const gate = {
      artifactType: 'gate-result', schemaVersion: 1, id: `GATE-${run.runId}`,
      ticketId: ticket.id, ticketRevision: ticket.revision, runId: run.runId,
      sourceRevision: run.sourceRevision, status: allRequiredPassed ? 'passed' : 'failed',
      startedAt: runnerStart.toISOString(), endedAt: runnerEnd.toISOString(),
      gateContractVersion: 2, gateContractHash: run.gateContractHash,
      checks, failureFingerprints: [],
      ...(run.baseline && run.baseline.manifestHash ? {
        measureCommand: `node scripts/pipeline-cli.js measure ${run.runId} --at ${runnerEnd.toISOString()}`,
        baselineHash: run.baseline.manifestHash,
      } : {}),
      evidenceBinding: {
        schemaVersion: BINDING_VERSION, bindingContractHash: contractHash,
        runner: {
          engine: 'node', engineVersion: process.version, cwd: root,
          startedAt: runnerStart.toISOString(), endedAt: runnerEnd.toISOString(),
        },
        inputBefore, inputAfter, executions,
      },
    };
    const issues = policy.validateGateEvidence(gate, ticket, run);
    const fatal = issues.filter(i => i.code !== 'GATE_INPUT_CHANGED_DURING_RUN');
    if (fatal.length) throw gateError(fatal[0].code, fatal[0].path + ' ' + fatal[0].message);
    const temp = gateFile + `.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(gate, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, gateFile);
    try { if (fs.existsSync(cancelFile)) fs.unlinkSync(cancelFile); } catch (_) { /* best effort */ }
    try { if (lockHandle !== null) fs.closeSync(lockHandle); } catch (_) { /* best effort */ }
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) { /* best effort */ }
    process.removeListener('SIGINT', onCancel);
    process.removeListener('SIGTERM', onCancel);
    return { gate, gateFile: path.relative(root, gateFile).replace(/\\/g, '/'), run, ticket };
  } catch (error) {
    process.removeListener('SIGINT', onCancel);
    process.removeListener('SIGTERM', onCancel);
    if (error && (error.code === 'GATE_RUN_CANCELLED' || cancelState.cancelled)) {
      cleanupPartial();
      throw gateError('GATE_RUN_CANCELLED', 'gate runner was cancelled');
    }
    if (error && error.code === 'GATE_RUN_IN_PROGRESS') {
      try { if (lockHandle !== null) fs.closeSync(lockHandle); } catch (_) { /* best effort */ }
      throw error;
    }
    // Infrastructure failures leave no reusable partial state; drift gates still publish above.
    if (error && String(error.code || '').startsWith('GATE_BINDING_')) {
      cleanupPartial();
    }
    try { if (lockHandle !== null) fs.closeSync(lockHandle); } catch (_) { /* best effort */ }
    try { if (fs.existsSync(lockFile) && error && String(error.code || '').startsWith('GATE_BINDING_')) fs.unlinkSync(lockFile); } catch (_) { /* best effort */ }
    throw error;
  }
}

function verifyGateOnDisk(root, gate, ticket) {
  root = path.resolve(root);
  const issues = [];
  const binding = gate && gate.evidenceBinding;
  if (!binding || !Array.isArray(binding.executions)) return issues;
  for (const execution of binding.executions) {
    const log = execution && execution.log;
    if (!log || !log.path) continue;
    const at = `evidenceBinding.executions.${execution.id}.log`;
    let absolute = null;
    try { absolute = resolveInside(root, log.path); } catch (error) {
      issues.push({ code: 'GATE_BINDING_LOG_PATH', path: at, message: error.message });
      continue;
    }
    let stats = null;
    try { stats = fs.lstatSync(absolute); } catch (_) {
      issues.push({ code: 'GATE_BINDING_LOG_MISSING', path: at, message: `log file is missing: ${log.path}` });
      continue;
    }
    if (stats.isSymbolicLink()) {
      issues.push({ code: 'GATE_BINDING_LOG_PATH', path: at, message: `log path is a symlink: ${log.path}` });
      continue;
    }
    if (!stats.isFile()) {
      issues.push({ code: 'GATE_BINDING_LOG_PATH', path: at, message: `log path is not a regular file: ${log.path}` });
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    const sha = policy.sha256(bytes);
    if (sha !== log.sha256) issues.push({ code: 'GATE_BINDING_LOG_HASH', path: at, message: `log hash mismatch: ${log.path}` });
    if (bytes.length !== log.sizeBytes) issues.push({ code: 'GATE_BINDING_LOG_HASH', path: at, message: `log size mismatch: ${log.path}` });
    const text = bytes.toString('utf8');
    if (countLines(text) !== log.lineCount) issues.push({ code: 'GATE_BINDING_LOG_HASH', path: at, message: `log line mismatch: ${log.path}` });
  }
  return issues;
}

function recomputeInputSnapshot(root, ticket) {
  return snapshotInputs(path.resolve(root), ticket.gateEvidenceBinding.inputPaths);
}

module.exports = {
  BINDING_VERSION,
  bindingContractHash,
  snapshotInputs,
  countLines,
  truncateUtf8ToBytes,
  truncateText,
  logFileName,
  runGate,
  verifyGateOnDisk,
  recomputeInputSnapshot,
};
