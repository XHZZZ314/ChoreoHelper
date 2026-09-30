// 验证交接检查会拒绝丢失、过期、歧义和伪派发的交接资料；并回归真实 CLI 逐字渲染合同。
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { extract, validate, hash } = require('./check-workflow');
const prompt = '在 D:\\choreohelper 工作。基线保存。验证结果。禁止越界。';
const doc = '## Next\n\n```text\n' + prompt + '\n```\n';
const good = { task: '.agent/tasks/test.md', heading: 'Next', promptSha256: hash(prompt), stage: '待实施', next: '继续', model: 'test-model', reason: 'test', dispatch: '未派发', verified: '记录已核对', unverified: '行为未验收' };
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
function cliNext(rootDir) {
  const r = cp.spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'check-workflow.js'), '--next'], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout + r.stderr).replace(/\r\n/g, '\n') };
}
function fenced(out) { const m = out.match(/```text\n([\s\S]*?)\n```/); return m && m[1]; }
test('valid handoff', () => assert.deepEqual(validate(good, () => doc).errors, []));
test('CRLF stable', () => assert.equal(extract(doc.replace(/\n/g, '\r\n'), 'Next'), prompt));
test('missing fields', () => assert.ok(validate({}, () => doc).errors.length));
test('changed prompt', () => assert.ok(validate(good, () => doc.replace('工作', '删除')).errors.length));
test('missing task', () => assert.ok(validate(good, () => { throw Error('missing'); }).errors.length));
test('duplicate heading', () => assert.ok(validate(good, () => doc + doc).errors.length));
test('no prompt block', () => assert.ok(validate(good, () => '## Next\nempty').errors.length));
test('duplicate prompt', () => assert.ok(validate(good, () => doc + '```text\nextra\n```').errors.length));
test('fake dispatch', () => assert.ok(validate({ ...good, dispatch: '已派发' }, () => doc).errors.length));
test('path escape', () => assert.ok(validate({ ...good, task: '.agent/tasks/../secret' }, () => doc).errors.length));
test('unfilled placeholder', () => { const p = prompt + '【任务 ID】'; assert.ok(validate({ ...good, promptSha256: hash(p) }, () => doc.replace(prompt, p)).errors.length); });
test('missing verification', () => { const p = prompt.replace('验证', '记录'); assert.ok(validate({ ...good, promptSha256: hash(p) }, () => doc.replace(prompt, p)).errors.length); });
test('CLI renders the exact verified contract prompt', () => {
  const rootDir = path.join(__dirname, '..');
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, '.agent/NEXT-ACTION.json'), 'utf8'));
  const contract = extract(fs.readFileSync(path.join(rootDir, index.task), 'utf8'), index.heading);
  assert.equal(hash(contract), index.promptSha256);
  const r = cliNext(rootDir);
  assert.equal(r.status, 0);
  assert.equal(fenced(r.out), contract);
});
test('CLI keeps contract bytes intact inside the fence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-wf-'));
  try {
    for (const d of ['scripts', 'docs', path.join('.agent', 'tasks')]) fs.mkdirSync(path.join(tmp, d), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'check-workflow.js'), path.join(tmp, 'scripts/check-workflow.js'));
    for (const p of ['AGENTS.md', 'docs/README-AI.md', 'PROGRESS.md']) fs.writeFileSync(path.join(tmp, p), 'scripts/check-workflow.js\n');
    const modelPrompt = prompt + '\n建议模型：示例模型\n下一步仅复验。';
    fs.writeFileSync(path.join(tmp, '.agent/tasks/case.md'), '## Next\n\n```text\n' + modelPrompt + '\n```\n');
    fs.writeFileSync(path.join(tmp, '.agent/NEXT-ACTION.json'), JSON.stringify({ ...good, task: '.agent/tasks/case.md', heading: 'Next', promptSha256: hash(modelPrompt) }));
    const r = cliNext(tmp);
    assert.equal(r.status, 0);
    assert.equal(fenced(r.out), modelPrompt);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
console.log(`${count}/${count}`);
