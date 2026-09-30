// test-anim-pack.js — TASK-20260917-SKILL-ANIM-CHANNEL 阶段二：make-anim-pack.js 纯函数单测。
// 覆盖：cmdToName 命名契约、常值轨道去重（无损性）、量化误差上界（四元数归一 <1e-6）、
// clip 契约校验的拒绝分支、跨族平移重标（比例/加性/异常比例拒绝）、D2 入场段拼接
// （时间平移/边界重合丢 loop 首行/首末行保留/骨架不匹配拒绝/缺 _start 逐类计数口径）、
// r2 v2 通用包决策（取库顺序 v1/v2、manifest 确定性字段口径）。
// 不触游戏文件与转换器。用法：node scripts/test-anim-pack.js
'use strict';
const path = require('path');
const assert = require('assert');
const gen = require(path.join(__dirname, 'make-anim-pack.js'));

let n = 0;
function check(name, fn) { fn(); n++; console.log('  ✔ ' + name); }

function mkClip(dur, q, t, s) {
  return { duration: dur, bones: { bone_0: { q, t, s } } };
}

console.log('— make-anim-pack 纯函数 —');
check('cmdToName 与 ExportServer/preview3d 同规则（去头斜杠、斜杠换下划线）', () => {
  assert.strictEqual(gen.cmdToName('/iceheart'), 'iceheart');
  assert.strictEqual(gen.cmdToName('/ac "烈焰弹"'), 'ac "烈焰弹"');
  assert.strictEqual(gen.cmdToName('/a/b'), 'a_b');
  assert.strictEqual(gen.cmdToName('  /trim '), 'trim');
  assert.strictEqual(gen.cmdToName(''), '');
});
check('关键帧简化：常值与线性段收敛、平台边界保留（三点共线无损判据）', () => {
  const constant = [[0, 1, 1, 1], [0.03, 1, 1, 1], [0.06, 1, 1, 1], [0.1, 1, 1, 1]];
  const rc = gen.dedupRows(constant);
  assert.strictEqual(rc.rows.length, 2);
  assert.strictEqual(rc.dropped, 2);
  assert.deepStrictEqual(rc.rows[0], constant[0]);
  assert.deepStrictEqual(rc.rows[rc.rows.length - 1], constant[constant.length - 1]);
  const ramp = [[0, 0, 0, 0], [1, 1, 0, 0], [2, 2, 0, 0], [3, 3, 0, 0]]; // 匀速线性段
  const rr = gen.dedupRows(ramp);
  assert.strictEqual(rr.rows.length, 2);
  assert.strictEqual(rr.dropped, 2);
  const step = [[0, 0, 0, 0], [1, 5, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0]]; // 平台边界：删中段会改时序
  const rs = gen.dedupRows(step);
  assert.strictEqual(rs.rows.length, 4);
  assert.strictEqual(rs.dropped, 0);
});
check('量化后四元数范数误差 <1e-6（契约界）', () => {
  let worst = 0;
  for (let d1 = -170; d1 <= 170; d1 += 37) for (let d2 = -160; d2 <= 160; d2 += 41) for (let d3 = -150; d3 <= 150; d3 += 43) {
    const q = gen.eulerXyzStatic([d1, d2, d3]).map(gen.qzQuat);
    const norm = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    worst = Math.max(worst, Math.abs(norm - 1));
  }
  assert.ok(worst < 1e-6, 'worst=' + worst);
});
check('validateClip 拒绝非归一/时间不增/非有限/时长非法', () => {
  const ok = { bone_0: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 0, 0, 0], [1, 0, 0, 0]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] } };
  gen.validateClip(ok, 1);
  assert.throws(() => gen.validateClip({ bone_0: { q: [[0, 0, 0, 0, 0.5], [1, 0, 0, 0, 0.5]], t: ok.bone_0.t, s: ok.bone_0.s } }, 1), /not normalized/);
  assert.throws(() => gen.validateClip({ bone_0: { q: [[1, 0, 0, 0, 1], [0.5, 0, 0, 0, 1]], t: ok.bone_0.t, s: ok.bone_0.s } }, 1), /not increasing/);
  assert.throws(() => gen.validateClip({ bone_0: { q: [[0, NaN, 0, 0, 1], [1, 0, 0, 0, 1]], t: ok.bone_0.t, s: ok.bone_0.s } }, 1), /non-finite/);
  assert.throws(() => gen.validateClip(ok, 0), /invalid clip duration/);
});
check('重标：比例分量按 ref 比例缩放、零源分量加性偏移、异常比例整骨跳过', () => {
  // 目标骨架：bone 0（src 有值 → 比例）；bone 1（src≈0 → 加性）；bone 2（比例 20 → 拒绝）
  const bones = {
    bone_0: { q: [], t: [[0, 2, 4, 6], [1, 2, 4, 6]], s: [] },
    bone_1: { q: [], t: [[0, 1, 2, 3], [1, 1, 2, 3]], s: [] },
    bone_2: { q: [], t: [[0, 1, 1, 1], [1, 1, 1, 1]], s: [] },
  };
  const targetBones = [
    { i: 0, n: 'a', t: [1, 2, 3] },
    { i: 1, n: 'b', t: [0.5, 0.5, 0.5] },
    { i: 2, n: 'c', t: [20, 20, 20] },
  ];
  const srcRefs = new Map([['a', [2, 4, 6]], ['b', [0, 0, 0]], ['c', [1, 1, 1]]]);
  const ret = gen.retargetTranslations(bones, targetBones, srcRefs);
  assert.deepStrictEqual(bones.bone_0.t[0], [0, 1, 2, 3]); // 0.5 比例
  assert.strictEqual(bones.bone_0.t[1][3], 3);
  assert.deepStrictEqual(bones.bone_1.t[0], [0, 1.5, 2.5, 3.5]); // 加性 +0.5
  assert.deepStrictEqual(bones.bone_2.t[0], [0, 1, 1, 1]); // 比例 20 被拒，不动
  assert.strictEqual(ret.missing, 1);
});
check('拼接：loop 段按 start 时长平移、时长=start+loop、边界重合丢 loop 首行、首末行保留', () => {
  const start = mkClip(0.5,
    [[0, 0, 0, 0, 1], [0.5, 0, 0, 0, 1]],
    [[0, 0, 0, 0], [0.5, 0, 1, 0]],
    [[0, 1, 1, 1], [0.5, 1, 1, 1]]);
  const loop = mkClip(0.75, // loop 首行 t=0 → 平移后 0.5 与 start 末行重合 → 丢 loop 首行
    [[0, 0, 0, 0, 1], [0.375, 0, 1, 0, 0], [0.75, 0, 0, 0, 1]],
    [[0, 0, 1, 0], [0.375, 0, 2, 0], [0.75, 0, 1, 0]],
    [[0, 1, 1, 1], [0.375, 1, 1, 1], [0.75, 1, 1, 1]]);
  const sp = gen.spliceSegments(start, loop);
  assert.strictEqual(sp.duration, 1.25); // 0.5 + 0.75
  const t = sp.bones.bone_0.t;
  assert.strictEqual(t.length, 4); // start 2 行 + loop 3 行 - 重合首行 1 行
  assert.deepStrictEqual(t[0], [0, 0, 0, 0]); // start 首行保留（整体首行）
  assert.deepStrictEqual(t[1], [0.5, 0, 1, 0]); // start 末行=到达姿态，在边界处保留
  assert.deepStrictEqual(t[2], [0.875, 0, 2, 0]); // loop 次行平移 0.5
  assert.deepStrictEqual(t[3], [0.75 + 0.5, 0, 1, 0]); // loop 末行保留（整体末行），值分量不动
  const q = sp.bones.bone_0.q;
  assert.deepStrictEqual(q.map((r) => r[0]), [0, 0.5, 0.875, 1.25]);
  assert.deepStrictEqual(q[2].slice(1), [0, 1, 0, 0]); // loop 行四元数值原样
  for (let i = 1; i < t.length; i++) assert.ok(t[i][0] > t[i - 1][0]); // 边界严格递增
});
check('拼接：loop 首行不在 0 → 无重合，全部行保留', () => {
  const start = mkClip(0.5,
    [[0, 0, 0, 0, 1], [0.5, 0, 0, 0, 1]],
    [[0, 0, 0, 0], [0.5, 0, 1, 0]],
    [[0, 1, 1, 1], [0.5, 1, 1, 1]]);
  const loop = mkClip(0.75,
    [[0.25, 0, 0, 0, 1], [0.75, 0, 0, 0, 1]],
    [[0.25, 0, 1, 0], [0.75, 0, 1, 0]],
    [[0.25, 1, 1, 1], [0.75, 1, 1, 1]]);
  const sp = gen.spliceSegments(start, loop);
  assert.strictEqual(sp.duration, 1.25);
  const t = sp.bones.bone_0.t;
  assert.strictEqual(t.length, 4); // 2 + 2，一行不丢
  assert.deepStrictEqual(t[2], [0.75, 0, 1, 0]); // loop 首行平移后保留
});
check('拼接：骨架不匹配显式拒绝（不静默丢骨）', () => {
  const start = { duration: 0.5, bones: { bone_0: { q: [], t: [], s: [] }, bone_1: { q: [], t: [], s: [] } } };
  const loop = { duration: 0.5, bones: { bone_0: { q: [], t: [], s: [] } } };
  assert.throws(() => gen.spliceSegments(start, loop), /skeleton mismatch/);
});
check('缺 _start 逐类计数口径：classifyMiss 与条目 miss 分类同规则', () => {
  assert.strictEqual(gen.classifyMiss('no-store'), 'no-store');
  assert.strictEqual(gen.classifyMiss('zero-entry'), 'zero-entry');
  assert.strictEqual(gen.classifyMiss('multi-entry(2)'), 'multi-entry');
  assert.strictEqual(gen.classifyMiss('convert: Invalid PAP header'), 'convert');
});
check('r2 取库顺序：v1=[自族,c0101]、v2=[c0101,自族]、基准族去重', () => {
  assert.deepStrictEqual(gen.storeOrderFor('c1201', false), ['c1201', 'c0101']);
  assert.deepStrictEqual(gen.storeOrderFor('c1201', true), ['c0101', 'c1201']);
  assert.deepStrictEqual(gen.storeOrderFor('c0101', false), ['c0101']); // v1 自族=基准 → 不重复取库
  assert.deepStrictEqual(gen.storeOrderFor('c0101', true), ['c0101']); // v2 无自族兜底 → 只取基准
  assert.deepStrictEqual(gen.storeOrderFor('c0303', true), ['c0101', 'c0303']);
});
check('r2 manifest 口径：v2 无 generatedAt/out（重跑字节一致），v1 字段原样', () => {
  const f1 = { generatedAt: '2026-09-21T00:00:00.000Z', exeSha256: 'a'.repeat(64), code: 'c1201',
    sqpackExtract: 'x', refsSource: 'y', catalogSource: 'z', out: 'D:/p/out.gz', outSha256: 'b'.repeat(64), outBytes: 1,
    counts: { emotes: 1 }, entryStates: [{ name: 'nod' }] };
  const m2 = gen.manifestFor(true, f1);
  const m1 = gen.manifestFor(false, f1);
  assert.strictEqual(m2.mode, 'universal');
  assert.strictEqual(m2.formatVersion, 2);
  assert.strictEqual(m2.baseSkeletonCode, 'c0101');
  assert.ok(!('generatedAt' in m2) && !('out' in m2), 'v2 manifest 不得含时间戳/输出路径');
  const f1b = JSON.parse(JSON.stringify(f1)); f1b.generatedAt = '2099-01-01T00:00:00.000Z'; f1b.out = 'D:/other/out2.gz';
  assert.strictEqual(JSON.stringify(gen.manifestFor(true, f1b)), JSON.stringify(m2), '同输入（仅时刻/路径不同）v2 manifest 字节一致');
  assert.strictEqual(m1.generatedAt, f1.generatedAt);
  assert.strictEqual(m1.out, f1.out);
  assert.ok(!('mode' in m1) && !('formatVersion' in m1), 'v1 manifest 字段保持原样');
});
console.log('结果：' + n + ' 通过 / 0 失败');
