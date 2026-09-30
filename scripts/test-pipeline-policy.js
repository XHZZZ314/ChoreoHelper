// AI 管线 V2 纯策略回归：风险、工单、路径权限、交接制品与两次修复熔断。
// 只读当前策略样本，不写仓库；所有负例均使用内存克隆。
// 上下文预算回归（TASK-20260905-CONTEXT-BUDGET-HEADROOM）额外读写 os.tmpdir() 隔离仓库。
// 失败即返回非零，供本地 closeout 与未来 CI 共用。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const p = require('./pipeline-policy.js');

const root = path.resolve(__dirname, '..');
const activePolicy = JSON.parse(fs.readFileSync(path.join(root, '.agent/PIPELINE-POLICY.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(root, '.agent/MODULES.json'), 'utf8'));
const ticket = JSON.parse(fs.readFileSync(path.join(root, '.agent/tickets/TASK-20260831-PIPELINE-V2.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

let passed = 0;
let total = 0;
function check(name, condition) {
  total++;
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else console.error('  ✘ ' + name);
}
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }

check('active policy accepted', p.validatePolicy(activePolicy).length === 0);
check('module registry accepted', p.validateModules(registry).length === 0);
check('PIPELINE-V2 ticket accepted', p.validateTicket(ticket, activePolicy, registry).length === 0);
const badRoleContext = clone(ticket);
badRoleContext.roleContextFiles.unknown = ['AGENTS.md'];
check('unknown role context rejected', p.validateTicket(badRoleContext, activePolicy, registry).some(issue => issue.code === 'role'));
check('repository paths normalize slashes', p.normalizeRepoPath('./.agent\\roles\\worker.md') === '.agent/roles/worker.md');
check('absolute path rejected', throws(() => p.normalizeRepoPath('D:\\secret')));
check('parent traversal rejected', throws(() => p.normalizeRepoPath('../secret')));
check('double-star matches nested path', p.matchesRule('.agent/roles/worker.md', '.agent/**'));
check('single-star stays within segment', p.matchesRule('docs/AI-WORKFLOW.md', 'docs/AI-*.md') && !p.matchesRule('docs/x/AI-WORKFLOW.md', 'docs/AI-*.md'));
check('overlap detects broad and narrow scope', p.rulesOverlap('src/**', 'src/HttpServer.cs'));
check('separate roots do not overlap', !p.rulesOverlap('src/**', 'web/**'));
check('narrow rule is contained by allowlist', p.ruleContainedBy('docs/AI-WORKFLOW.md', 'docs/AI-*.md'));

const duplicateModule = clone(registry);