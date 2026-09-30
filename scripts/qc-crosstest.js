'use strict';
/*
 * qc-crosstest.js —— FIX-C（AUD2-006）质检口径交叉测试（node 直跑）
 *
 * 背景：插件侧批量录制落盘前要用 C# 的 ClipQuality.MaxRotationOffset 自检静止坏片，
 * 网页 recAmp / 本脚本用 JS 实现。施工包 03 明确要求"必须有共享规则或交叉测试，
 * 不能长期维护两套漂移阈值"——本脚本与 src\tests\datalayertest\program.cs 的 FIX-C 段
 * 共用同一批向量，断言两边算出相同数值（C# 侧期望值写死同源）。
 *
 * 幅度口径（三处同源）：每根骨骼 q 关键帧 [t,x,y,z,w]，相对首帧 [x,y,z,w] 的
 * L1 距离取全体最大值；静止 ≈0，正常动作 ≥0.31，阈值 0.3。
 *
 * 运行：D:\nodejs\node.exe scripts\qc-crosstest.js
 */

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + ' ' + (detail || '')); }
}

// 与 batch-record.js amplitude() 逐字同口径
function amplitude(j) {
  let best = 0;
  for (const k in (j.bones || {})) {
    const q = j.bones[k].q; if (!q || q.length < 2) continue;
    const a = q[0].slice(1);
    for (const fr of q) {
      const m = Math.abs(fr[1] - a[0]) + Math.abs(fr[2] - a[1]) + Math.abs(fr[3] - a[2]) + Math.abs(fr[4] - a[3]);
      if (m > best) best = m;
    }
  }
  return best;
}
function clip(frames) { return { bones: { bone_0: { q: frames } } }; }
function approx(m, expect) { return Math.abs(m - expect) < 1e-6; }

// 与 datalayertest FIX-C 段共用的向量与期望值（改一处必须同步另一处）
const vectors = [
  ['静止 clip', clip([[0, 0, 0, 0, 1], [0.033, 0, 0, 0, 1]]), 0.0],
  ['bow 形向量', clip([[0, 0, 0, 0, 1], [1, 0.2, 0, 0, 1], [2, 0, 0.3, 0, 0.9]]), 0.4],
  ['负分量/符号翻转向量', clip([[0, 0.1, -0.2, 0.3, 0.9], [1, -0.4, 0.5, -0.6, -0.7]]), 3.7],
  ['最大值在中间帧', clip([[0, 0, 0, 0, 1], [1, 0.5, 0, 0, 1], [2, 0.1, 0, 0, 1]]), 0.5],
  ['0.31 在阈值上方', clip([[0, 0, 0, 0, 1], [1, 0.31, 0, 0, 1]]), 0.31],
];
for (const [name, c, expect] of vectors) {
  const m = amplitude(c);
  check('JS 幅度 ' + name + ' = ' + expect, approx(m, expect), 'got ' + m);
}
check('JS 阈值口径：0.31 在动 / 0 静止',
  amplitude(vectors[4][1]) >= 0.3 && amplitude(vectors[0][1]) < 0.3);
check('JS 单帧骨骼跳过、空 bones = 0',
  amplitude({ bones: { a: { q: [[0, 0, 0, 0, 1]] } } }) === 0 && amplitude({}) === 0);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
