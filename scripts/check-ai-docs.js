// AI 文档治理检查：锁定启动、路由、backlog、续页和交接的单一职责。
// 只读仓库文本，不访问网络、不修改文件；流程文档变更后运行。
// 断言锚定稳定语义标记（章节、枚举值、关键句），不硬编码任务 ID、日期、行号或
// 模型供应商版本号；规则本体见 docs/AI-WORKFLOW.md 的 review_level 与 closeout 章节。
// legacy 管线文件（PIPELINE-*/SOP/角色）仅要求存在，不再校验其内部规则。
'use strict';

const fs = require('fs');
const path = require('path');
const policy = require('./process-policy.js');

const root = path.resolve(__dirname, '..');
const rel = p => path.join(root, p);
const read = p => fs.readFileSync(rel(p), 'utf8');
let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  if (condition) {
    passed++;
    console.log('  ✓ ' + name);
    return;
  }
  console.error('  ✘ ' + name + (detail ? ': ' + detail : ''));
}

const required = [
  'AGENTS.md',
  'docs/README-AI.md',
  'docs/AI-WORKFLOW.md',
  'PROGRESS.md',
  'docs/AI-BACKLOG.md',
  'docs/AI-TEST-MATRIX.md',
  '.agent/CONTINUITY.md',
  '.agent/PROCESS-STATE.json',
  '.agent/PIPELINE-POLICY.json',
  '.agent/PIPELINE-ROUTING.json',
  '.agent/MODULES.json',
  '.agent/process-events.jsonl',
  '.agent/process-proposals/README.md',
  'scripts/process-policy.js',
  'scripts/process-audit.js',
  'scripts/process-event.js',
  'scripts/test-process-policy.js',
  'scripts/test-process-audit.js',
  'scripts/pipeline-policy.js',
  'scripts/pipeline-cli.js',
  'scripts/test-pipeline-policy.js',
  'scripts/test-pipeline-cli.js',
  'docs/AI-PIPELINE-SOP.md',
  'docs/AI-KNOWLEDGE.md',
];

for (const file of required) check('存在 ' + file, fs.existsSync(rel(file)));

if (passed !== total) {
  console.error(`AI docs check: ${passed}/${total}`);
  process.exitCode = 1;
} else {
  const agents = read('AGENTS.md');
  const readme = read('docs/README-AI.md');
  const workflow = read('docs/AI-WORKFLOW.md');
  const progress = read('PROGRESS.md');
  // 短语断言一律在空白归一化后的文本上匹配，避免换行拆断关键句。
  const flat = s => s.replace(/\s+/g, ' ');
  const wf = flat(workflow);
  const pg = flat(progress);
  const ag = flat(agents);
  const rm = flat(readme);
  const backlog = read('docs/AI-BACKLOG.md');
  const continuity = read('.agent/CONTINUITY.md');
  const state = JSON.parse(read('.agent/PROCESS-STATE.json'));

  check('AGENTS 保留唯一 Start protocol', (agents.match(/^## Start protocol$/gm) || []).length === 1);
  check('README 不复制启动长指令', !/Immediate start instruction|One-sentence start command/i.test(readme));
  check('README 不保存 Current product state', !/^## Current product state$/m.test(readme));
  check('README 路由到 canonical workflow', rm.includes('AI-WORKFLOW.md'));
  check('README 路由 pipeline SOP 与 knowledge policy', rm.includes('AI-PIPELINE-SOP.md') && rm.includes('AI-KNOWLEDGE.md'));
  check('README 路由机器状态但不展开它', rm.includes('.agent/PROCESS-STATE.json'));
  check('workflow 定义 owner 最终权威', wf.includes('The owner is the final authority for user outcomes'));
  check('AGENTS 同步 owner 最终权威', ag.includes('final authority'));
  check('AGENTS 拆分三套权威顺序', ag.includes('Current facts') && ag.includes('Intended behavior') && ag.includes('Safety and authorization'));
  check('workflow 定义唯一 review_level 四值', wf.includes('self | standard | technical | critical'));
  check('workflow 定义各级独立验收者', wf.includes('GLM-5.3-Flash, fresh session') && wf.includes('GLM-5.3, fresh session') && wf.includes('Codex final acceptance'));
  check('workflow 保留 closeout 章节', wf.includes('## 6. Closeout'));
  check('实施者不得验收自己的字节', wf.includes('never accepts its own changed bytes'));
  check('级别只升不降', wf.includes('may only be raised, never lowered'));
  check('两次同因失败触发升级', wf.includes('Two attempts without meaningful progress'));
  check('预期行为不能被当前 bug 替代', wf.includes('Intended contract behavior cannot be replaced by current bugs'));
  check('脏目标要求文件级基线', wf.includes('HEAD alone is not the baseline'));
  check('进度事件驱动且无时间驱动残留', wf.includes('event-driven') && !/every 10 minutes/i.test(wf) && !/每 ?10 ?分钟|every 10 minutes/i.test(pg));
  check('真实交接必须完整中文提示词', wf.includes('complete Chinese continuation prompt'));
  check('review_level 与大功能全局门正交', wf.includes('is orthogonal to this gate'));
  check('workflow 保留大功能全局审核门', wf.includes('major-feature completion gate') && fs.existsSync(rel('docs/PLAN-FEATURE-GLOBAL-REVIEW.md')));
  check('README 路由级别规则且不复制模型表', rm.includes('Review level') && !rm.includes('independent Codex acceptance'));
  // 语义状态检查（AC-7）：过期/歧义的当前状态结论按已接受证据报告，
  // 失败义务是建提案或后续工单；本检查绝不自动修改受保护文档。
  const semanticIssues = policy.evaluateSemanticStatus({
    spec: read('SPEC.md'),
    architecture: read('docs/AI-ARCHITECTURE.md'),
    design: read('docs/DESIGN-performance-script-v1.md'),
    roadmap: read('docs/PRODUCT-ROADMAP-20260829.md'),
    workplan: read('docs/WORKPLAN-20260829.md'),
    continuity,
  });
  check('语义状态无过期结论', semanticIssues.length === 0,
    semanticIssues.map(issue => `${issue.file} ${issue.rule}: ${issue.message} [evidence: ${issue.evidence}]；义务：建提案/后续工单，禁止自动改保护文档`).join('; '));

  const detailedClosed = [];
  for (const n of state.packages.filter(pkg => pkg.status === 'closed').map(pkg => pkg.order)) {
    if (new RegExp(`^## ${n}\\.`, 'm').test(backlog)) detailedClosed.push(n);
  }
  check('backlog 无 CLOSED 详细编号区块', detailedClosed.length === 0,
    detailedClosed.length ? '仍有 §' + detailedClosed.join(', §') : '');
  check('backlog 不复制启动命令', !/One-sentence start command|Immediate start instruction/i.test(backlog));
  check('backlog 保留 ARCH-2/HYGIENE 详情', /^## 11\. ARCH-2/m.test(backlog) && /^## 12\. HYGIENE/m.test(backlog));

  check('backlog package index 有受控标记',
    backlog.includes('<!-- process-state:packages:start -->') && backlog.includes('<!-- process-state:packages:end -->'));
  const closedOrders = new Set(state.packages.filter(pkg => pkg.status === 'closed').map(pkg => pkg.order));
  const closedRows = backlog.split(/\r?\n/).filter(line => {
    const match = line.match(/^\|\s*(\d+)\s*\|/);
    return match && closedOrders.has(Number(match[1]));
  });
  check('已关闭包各占一行', closedRows.length === closedOrders.size, `找到 ${closedRows.length}/${closedOrders.size} 行`);
  check('每个关闭包都有 handoff 指针', closedRows.every(line => /HANDOFF-[^)]+\.md/.test(line)));

  check('continuity 无历史验证区块', !/^## Verified state/m.test(continuity));
  check('continuity 无 changed-file 历史区块', !/^## Files intentionally changed/m.test(continuity));
  check('continuity 不依赖未提交的 Git 历史', !/continuity text in git history|续页.*git history/i.test(continuity));
  check('continuity 只有一个 owner-tail 归属区',
    (continuity.match(/^## .*owner tails.*$/gmi) || []).length === 1);
  check('continuity 派生状态有受控标记',
    ['snapshot', 'tails'].every(name => continuity.includes(`<!-- process-state:${name}:start -->`) && continuity.includes(`<!-- process-state:${name}:end -->`)));

  const refs = new Set();
  for (const text of [backlog, continuity]) {
    for (const match of text.matchAll(/HANDOFF-[A-Za-z0-9-]+\.md/g)) refs.add(match[0]);
  }
  const missing = [...refs].filter(file => !fs.existsSync(rel(path.join('docs', file))));
  check('backlog/continuity 的 handoff 指针存在', missing.length === 0, missing.join(', '));

  console.log(`AI docs check: ${passed}/${total}`);
  if (passed !== total) process.exitCode = 1;
}
