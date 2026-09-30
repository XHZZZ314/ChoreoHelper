// B8 层级/留白整理（REVIEW「应收敛成的日常流程」六步）：上下文栏/添加栏/舞台视图条的节奏统一；
// B6 批外登记「wb-top-viewbar 用内联样式」收编设计令牌 CSS（workbench 侧内联移除、样式逐字等价）。
// B8_SOURCE 指向保存的旧文件目录时可对拍红测。
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const dir = process.env.B8_SOURCE || __dirname;
const css = fs.readFileSync(path.join(dir, 'choreo-helper-app.css'), 'utf8');
const wb = fs.readFileSync(path.join(dir, 'choreo-workbench.js'), 'utf8');

let pass = 0, fail = 0;
function test(n, fn) { try { fn(); console.log('PASS ' + n); pass++; } catch (e) { fail++; console.log('FAIL ' + n + '\n' + e.stack); } }
const rule = (cls) => (css.match(new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\{[^}]*\\}')) || [''])[0];

test('HIE-1 B6 批外闭合：wb-top-viewbar 样式入 CSS 令牌类、workbench 内联 cssText 移除', () => {
  const r = rule('wb-top-viewbar');
  assert.ok(r, 'CSS 提供 .wb-top-viewbar 类');
  assert.ok(/display:flex/.test(r) && /gap:6px/.test(r) && /align-items:center/.test(r) && /padding-top:4px/.test(r) && /font-size:12px/.test(r), '样式与原内联逐字等价：' + r);
  assert.ok(!wb.includes("bar.style.cssText = 'display:flex;gap:6px"), 'workbench 不再内联该样式');
  assert.ok(wb.includes("'wb-top-viewbar'"), '元素仍挂同名 class');
});
test('HIE-2 添加栏留白节奏（六步流程「添加」面：可读分组）', () => {
  const r = rule('wb-addbar');
  assert.ok(/padding:6px 12px/.test(r) && /gap:10px/.test(r) && /min-height:34px/.test(r), '留白节奏统一：' + r);
});
test('HIE-3 上下文栏层级与占位同高（六步流程「编辑」主场；选中/空态同高性质不变）', () => {
  const r = rule('wb-ctx');
  assert.ok(/padding:7px 12px/.test(r) && /gap:12px/.test(r), '上下文栏留白：' + r);
  const ph = css.match(/\.wb-ctxhost \.wb-ctx\{[^}]*\}/) || [''];
  assert.ok(/min-height:36px/.test(ph[0]), '常态占位同高 36px（选中/取消不推动时间轴性质保持）：' + ph[0]);
  const act = rule('wb-ctx-actions');
  assert.ok(/gap:8px/.test(act), '动作组间距：' + act);
});
test('HIE-4 设计令牌合规：新规则字号均在阶梯 {12,13,14,16,20}、颜色走 var(--…)', () => {
  const rules = [rule('wb-top-viewbar'), rule('wb-addbar'), rule('wb-ctx'), (css.match(/\.wb-ctxhost \.wb-ctx\{[^}]*\}/) || [''])[0]];
  for (const r of rules) {
    for (const m of r.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      assert.ok([12, 13, 14, 16, 20].includes(parseFloat(m[1])), '字号越阶：' + r);
    }
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(r), '不得新增硬编码色：' + r);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
