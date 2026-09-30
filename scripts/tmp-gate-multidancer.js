/* tmp-gate-multidancer.js — 一次性门禁打包脚本（run 结束后删除）：
   依次执行 R2 风险路由的检查命令，诚实记录 exit/时长/输出哈希，产出 gate-result 工件 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NODE = 'D:\\nodejs\\node.exe';
const ROOT = path.resolve(__dirname, '..');
const RUN_ID = 'RUN-20260831-MULTI-DANCER-EDIT-R2';

const CHECKS = [
  { id: 'targeted:test-edit', cmd: [NODE, 'web/test-edit.js'], required: true },
  { id: 'targeted:test-document', cmd: [NODE, 'web/test-document.js'], required: true },
  { id: 'targeted:test-docwire', cmd: [NODE, 'web/test-docwire.js'], required: true },
  { id: 'targeted:test-showcompiler', cmd: [NODE, 'web/test-showcompiler.js'], required: true },
  { id: 'targeted:test-shell', cmd: [NODE, 'web/test-shell.js'], required: true },
  { id: 'targeted:clipcheck-scenario-multidancer', cmd: [NODE, 'scripts/clipcheck-run.js', '--scenario', 'multidancer'], required: true },
  { id: 'module:clipcheck-default-game-root', cmd: [NODE, 'scripts/clipcheck-run.js'], required: true },
  { id: 'scope:pipeline-cli-ticket', cmd: [NODE, 'scripts/pipeline-cli.js', 'ticket', '.agent/tickets/TASK-20260831-MULTI-DANCER-EDIT.json'], required: true },
  { id: 'artifact+module:pipeline-cli-check', cmd: [NODE, 'scripts/pipeline-cli.js', 'check'], required: true },
];

const checks = [];
for (const c of CHECKS) {
  const t0 = Date.now();
  const r = spawnSync(c.cmd[0], c.cmd.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const lines = out.split(/\r?\n/);
  const digest = crypto.createHash('sha256').update(out).digest('hex');
  const passed = r.status === 0;
  checks.push({
    id: c.id,
    required: c.required,
    status: passed ? 'passed' : 'failed',
    exitCode: r.status === null ? -1 : r.status,
    durationMs: Date.now() - t0,
    evidenceHash: digest,
    command: c.cmd.map((a) => a.replace(/^D:\\nodejs\\node.exe$/, 'node')).join(' '),
    evidenceSlice: lines.filter((l) => /结果|通过|passed|failed|败|PASS|FAIL|过 \//.test(l)).slice(-3).join(' | ').slice(0, 300),
  });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${c.id} (${checks[checks.length - 1].durationMs}ms) ${checks[checks.length - 1].evidenceSlice}`);
  if (!passed && c.required) break; // 首个必需失败即停（不粉饰）
}

const gate = {
  artifactType: 'gate-result',
  schemaVersion: 1,
  id: 'GATE-' + RUN_ID,
  ticketId: 'TASK-20260831-MULTI-DANCER-EDIT',
  ticketRevision: 2,
  runId: RUN_ID,
  sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
  status: checks.every((c) => !c.required || c.status === 'passed') ? 'passed' : 'failed',
  checks,
  failureFingerprints: checks.filter((c) => c.status === 'failed').map((c) => c.id + ':' + c.evidenceHash.slice(0, 12)),
};
const outFile = path.join(ROOT, '.agent', 'runs', 'GATE-' + RUN_ID + '.json');
fs.writeFileSync(outFile, JSON.stringify(gate, null, 2) + '\n');
console.log('gate: ' + gate.status + ' -> ' + path.relative(ROOT, outFile));
process.exitCode = gate.status === 'passed' ? 0 : 1;
