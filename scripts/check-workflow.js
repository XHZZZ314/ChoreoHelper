// 当前交接检查与提示词输出；只读，不派发模型，不代表产品验收。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function extract(text, heading) {
  const sections = text.split(/^## /m).filter(s => s.startsWith(heading + '\n') || s.startsWith(heading + '\r\n'));
  if (sections.length !== 1) throw new Error('交接章节缺失或重名');
  const blocks = [...sections[0].matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) throw new Error('交接章节必须只有一个完整提示词');
  return blocks[0][1].replace(/\r\n/g, '\n');
}
function validate(data, read) {
  const errors = [];
  for (const k of ['task', 'heading', 'promptSha256', 'stage', 'next', 'model', 'reason', 'dispatch', 'verified', 'unverified']) {
    if (typeof data[k] !== 'string' || !data[k].trim()) errors.push('缺少字段：' + k);
  }
  if (data.dispatch !== '未派发') errors.push('本工具不能证明模型已派发');
  let prompt = '';
  try {
    if (!data.task || path.isAbsolute(data.task) || data.task.includes('..') || !data.task.startsWith('.agent/tasks/')) throw new Error('任务必须是仓库内任务文件');
    prompt = extract(read(data.task), data.heading);
    if (hash(prompt) !== data.promptSha256) errors.push('提示词已变化：先核对合同再更新指纹');
    for (const token of ['D:\\choreohelper', '验证', '禁止', '基线']) if (!prompt.includes(token)) errors.push('提示词缺少：' + token);
    if (/【[^】]+】|\bTODO\b/.test(prompt)) errors.push('提示词仍有占位符');
  } catch (e) { errors.push(e.message); }
  return { errors, prompt };
}
function run() {
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const data = JSON.parse(read('.agent/NEXT-ACTION.json'));
  const result = validate(data, read);
  for (const p of ['AGENTS.md', 'docs/README-AI.md', 'PROGRESS.md']) {
    if (!read(p).includes('scripts/check-workflow.js')) result.errors.push(p + ' 未接入当前交接检查');
  }
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; return; }
  console.log('当前交接检查通过（仅结构、入口和提示词指纹；不证明产品可用或独立验收通过）。');
  if (process.argv.includes('--next')) {
    console.log(`已完成：${data.verified}\n尚未证明：${data.unverified}\n下一步：${data.next}\n建议模型：${data.model}\n原因：${data.reason}\n派发状态：${data.dispatch}`);
    // 代码块内只输出经指纹校验的合同原文（含其中可能存在的「建议模型：」行）；说明文字一律放代码块外。
    console.log('\n```text\n' + result.prompt + '\n```');
    console.log('\n收尾遵守 D:\\choreohelper\\docs\\AI-WORKFLOW.md：用中文大白话说明做成了什么、还差什么、下一步；在代码块外给出模型、理由和派发状态，正文附完整可复制提示词。同步当前任务、PROGRESS 和下一步索引，运行交接检查；不把自测当独立验收。');
  }
}
module.exports = { extract, validate, hash };
if (require.main === module) { try { run(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
