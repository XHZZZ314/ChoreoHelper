// test-anim-pack-retarget.js — TASK-20260918-ANIM-PACK-UNIVERSAL r2：换算模块纯函数单测。
//
// 跑法：D:\nodejs\node.exe web\test-anim-pack-retarget.js
//
// 覆盖（合同 AC2）：按骨名映射（乱序/重排目标索引）、比例换算（正/负/≈0 加性/|r|>8 整骨
// 保持并上报）、q/s/时间原样、基准多余骨丢弃、目标骨架校验拒绝（重复索引/重复名/父索引
// 非法/父链成环）、v2 包结构校验拒绝分支、换算后 §4 契约校验拒绝分支、参考姿态解析
// （族包码一致/拓扑不一致拒绝/无码用档案/只有码拒绝）；
// 以及真 shipped 族包（skeleton-pack.js）18 族骨名覆盖与 c0101→c0301/c1201 真数值换算。
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 经典脚本挂全局（与页面同形）
require(path.join(__dirname, 'choreo-anim-pack-retarget.js'));
const R = global.ChoreoAnimPackRetarget;

let n = 0, fails = 0;
function check(name, fn) {
  try { fn(); n++; console.log('  ✔ ' + name); }
  catch (e) { fails++; console.log('  ✘ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

function bone(i, n_, p, t, q, s) { return { i, n: n_, p, t: t || [0, 0, 0], q: q || [0, 0, 0, 1], s: s || [1, 1, 1] }; }
function mkBase() { // 6 骨基准骨架（i 乱序给满 0..5，名字唯一）
  return { count: 6, bones: [
    bone(0, 'root', -1, [0, 0, 0]), bone(1, 'hip', 0, [2, 4, 6]), bone(2, 'arm', 1, [0.00001, 4, 6]),
    bone(3, 'leg', 1, [-2, 4, 6]), bone(4, 'hand', 2, [1, 1, 1]), bone(5, 'anomaly', 1, [1, 1, 1]),
  ] };
}
function clipRow(t, v) { return [t, v, v, v]; }
function mkPackBase(base) {
  return { formatVersion: 2, gameVersion: 'test', code: 'c0101', baseSkeletonCode: 'c0101', baseSkeleton: base,
    counts: {}, clips: [], entries: [] };
}
function mkClipBones() {
  return {
    bone_1: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 2, 4, 6], [1, 4, 8, 12]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] },
    bone_2: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 1, 2, 3], [1, 1, 2, 3]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] },
    bone_3: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, -2, -4, -6], [1, -2, -4, -6]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] },
    bone_5: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 3, 3, 3], [1, 3, 3, 3]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] },
  };
}

console.log('— r2 换算纯函数（合成数值例）—');
check('按骨名映射并重排目标索引：输出键=目标 bone_i（绝不下标对位）', () => {
  const pack = mkPackBase(mkBase());
  // 目标骨架 i 与基准故意错开：hip(基准1)→目标 i=4，leg(基准3)→目标 i=0
  const target = { count: 4, bones: [bone(0, 'leg', -1, [-1, 2, 3]), bone(1, 'x1', 0), bone(2, 'x2', 1), bone(3, 'x3', 2), bone(4, 'hip', 0, [1, 2, 3]), bone(5, 'x4', 4)] };
  assert.strictEqual(target.bones.length, 6); target.count = 6;
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: mkClipBones() }, pack, target);
  assert.ok(r.ok, r.reason);
  assert.ok(r.clip.bones.bone_4, 'hip 应落在目标 bone_4');
  assert.ok(r.clip.bones.bone_0, 'leg 应落在目标 bone_0');
  assert.ok(!r.clip.bones.bone_1 && !r.clip.bones.bone_3, '不得按基准下标输出');
});
check('比例换算：显著源分量乘 目标/源 比例（0.5），量化 1e-4', () => {
  const pack = mkPackBase(mkBase());
  const target = { count: 6, bones: [bone(0, 'root', -1), bone(1, 'hip', 0, [1, 2, 3]), bone(2, 'arm', 1), bone(3, 'leg', 1), bone(4, 'hand', 2), bone(5, 'anomaly', 1)] };
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: { bone_1: mkClipBones().bone_1 } }, pack, target);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.clip.bones.bone_1.t[1], [1, 2, 4, 6]); // [4,8,12]×0.5
});
check('负比例=镜像轴合法：[-2,-4,-6] × [0.5,-0.5,-0.5]', () => {
  const pack = mkPackBase(mkBase());
  const target = { count: 6, bones: [bone(0, 'root', -1), bone(1, 'hip', 0), bone(2, 'arm', 1), bone(3, 'leg', 1, [-1, -2, -3]), bone(4, 'hand', 2), bone(5, 'anomaly', 1)] };
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: { bone_3: mkClipBones().bone_3 } }, pack, target);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.clip.bones.bone_3.t[0], [0, -1, 2, 3]); // 分量 c0×0.5、c1×-0.5、c2×-0.5
});
check('≈0 源分量走加性偏移（+目标-源），显著分量仍走比例，量化 1e-4', () => {
  const pack = mkPackBase(mkBase());
  const target = { count: 6, bones: [bone(0, 'root', -1), bone(1, 'hip', 0), bone(2, 'arm', 1, [0.5, 2, 3]), bone(3, 'leg', 1), bone(4, 'hand', 2), bone(5, 'anomaly', 1)] };
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: { bone_2: mkClipBones().bone_2 } }, pack, target);
  assert.ok(r.ok);
  // c0 加性：1+(0.5-0.00001)=1.49999→qz=1.5；c1 比例 2/4=0.5→1；c2 比例 3/6=0.5→1.5
  assert.deepStrictEqual(r.clip.bones.bone_2.t[0], [0, 1.5, 1, 1.5]);
});
check('|r|>8：整骨平移保持原样并上报（不得报成全换算干净）；q/s/时间原样', () => {
  const pack = mkPackBase(mkBase());
  const target = { count: 6, bones: [bone(0, 'root', -1), bone(1, 'hip', 0), bone(2, 'arm', 1), bone(3, 'leg', 1), bone(4, 'hand', 2), bone(5, 'anomaly', 1, [20, 20, 20])] };
  const src = mkClipBones();
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: { bone_5: src.bone_5 } }, pack, target);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.clip.bones.bone_5.t, src.bone_5.t); // 原样
  assert.strictEqual(r.clip.bones.bone_5.q, src.bone_5.q);     // 引用原样（零改动）
  assert.deepStrictEqual(r.preserved, ['anomaly']);
});
check('基准多余骨丢弃（目标没有该骨名 → 丢该骨动画并列入 dropped）', () => {
  const pack = mkPackBase(mkBase());
  const target = { count: 2, bones: [bone(0, 'root', -1), bone(1, 'hip', 0, [1, 2, 3])] };
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: mkClipBones() }, pack, target);
  assert.ok(r.ok);
  assert.deepStrictEqual(Object.keys(r.clip.bones), ['bone_1']); // 剪辑里只有 hip 映射得上
  assert.ok(r.dropped.indexOf('arm') >= 0 && r.dropped.indexOf('anomaly') >= 0);
});
check('剪辑使用未声明的基准骨索引 → 显式拒绝', () => {
  const pack = mkPackBase(mkBase());
  const r = R.convertClip({ name: 'c', duration: 1, type: 'loop', bones: { bone_9: mkClipBones().bone_1 } }, pack, mkBase());
  assert.ok(!r.ok && /未声明/.test(r.reason));
});

console.log('— 目标/包校验拒绝分支 —');
check('目标骨架校验：重复索引/重复名/父越界/父指自身/父链成环逐例拒绝', () => {
  const bad1 = { count: 2, bones: [bone(0, 'a', -1), bone(0, 'b', 0)] };
  assert.ok(!R.validateRefSkeleton(bad1).ok && /索引重复/.test(R.validateRefSkeleton(bad1).reason));
  const bad2 = { count: 2, bones: [bone(0, 'a', -1), bone(1, 'a', 0)] };
  assert.ok(!R.validateRefSkeleton(bad2).ok && /名重复/.test(R.validateRefSkeleton(bad2).reason));
  const bad3 = { count: 2, bones: [bone(0, 'a', -1), bone(1, 'b', 5)] };
  assert.ok(!R.validateRefSkeleton(bad3).ok && /父索引非法/.test(R.validateRefSkeleton(bad3).reason));
  const bad4 = { count: 2, bones: [bone(0, 'a', 1), bone(1, 'b', 0)] };
  assert.ok(!R.validateRefSkeleton(bad4).ok && /成环/.test(R.validateRefSkeleton(bad4).reason));
  assert.ok(R.validateRefSkeleton(mkBase()).ok, '合法基准应通过');
});
check('v2 包校验：版本/基准码/骨数/坏引用/重名条目/clips 缺失逐例拒绝', () => {
  // 106 骨合法基准（父链顺次），让字段分支按序到达
  const base106 = { count: 106, bones: [] };
  for (let i = 0; i < 106; i++) base106.bones.push(bone(i, 'b' + i, i - 1));
  const okPack = mkPackBase(base106);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let p = clone(okPack); p.formatVersion = 1;
  assert.ok(/版本不是 2/.test(R.validatePackV2(p).reason));
  p = clone(okPack); p.baseSkeletonCode = 'c1201';
  assert.ok(/基准骨架码/.test(R.validatePackV2(p).reason));
  p = clone(okPack); p.baseSkeleton.count = 105; // 骨数与 count 不符 → 先撞参考骨架校验
  assert.ok(!R.validatePackV2(p).ok && /count\/bones 不匹配/.test(R.validatePackV2(p).reason));
  p = mkPackBase(mkBase()); // 合法但只有 6 骨 → 冻结口径要求 c0101 全 106 骨
  p.clips = [{ clip: { duration: 1, bones: {} } }]; p.entries = [{ name: 'a', clipIndex: 0 }];
  assert.ok(!R.validatePackV2(p).ok && /106/.test(R.validatePackV2(p).reason));
  p = clone(okPack); p.clips = [{ clip: { duration: 1, bones: {} } }];
  p.entries = [{ name: 'a', clipIndex: 0 }, { name: 'b', clipIndex: 99 }];
  assert.ok(/引用不存在/.test(R.validatePackV2(p).reason));
  p.entries = [{ name: 'a', clipIndex: 0 }, { name: 'a', clipIndex: 0 }];
  assert.ok(/条目重名/.test(R.validatePackV2(p).reason));
  p = clone(okPack); p.clips = [];
  assert.ok(/clips 空/.test(R.validatePackV2(p).reason));
  const goodRows = { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 0, 0, 0], [1, 0, 0, 0]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] };
  p = clone(okPack); p.clips = [{ clip: { duration: 1, bones: { bone_0: JSON.parse(JSON.stringify(goodRows)) } } }]; p.entries = [{ name: 'a', clipIndex: 0 }];
  assert.ok(R.validatePackV2(p).ok, '合法 v2 应整体通过');
});
check('换算后 §4 契约校验：非有限/时间不增/四元数未归一/时长非法逐例拒绝', () => {
  const good = { duration: 1, bones: { bone_0: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 0, 0, 0], [1, 0, 0, 0]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] } } };
  assert.ok(R.validateConvertedClip(good).ok);
  const c1 = JSON.parse(JSON.stringify(good)); c1.bones.bone_0.t[1][2] = NaN;
  assert.ok(/非有限/.test(R.validateConvertedClip(c1).reason));
  const c2 = JSON.parse(JSON.stringify(good)); c2.bones.bone_0.q[1][0] = 0; // 第二行时间回到 0 → 不再严格递增
  assert.ok(/时间不严格递增/.test(R.validateConvertedClip(c2).reason));
  const c3 = JSON.parse(JSON.stringify(good)); c3.bones.bone_0.q[1][4] = 0.5;
  assert.ok(/归一/.test(R.validateConvertedClip(c3).reason));
  const c4 = JSON.parse(JSON.stringify(good)); c4.duration = 0;
  assert.ok(/时长/.test(R.validateConvertedClip(c4).reason));
});

console.log('— r2 返工 AP-R2-01/03（独立验收退回单）—');
check('AP-R2-03：合法乱序骨架（数组打乱、i/p 不变）必须通过——绝不用数组下标当骨索引', () => {
  const shuffled = JSON.parse(JSON.stringify(mkBase()));
  shuffled.bones.reverse();
  const r = R.validateRefSkeleton(shuffled);
  assert.ok(r.ok, '打乱后误判：' + r.reason);
});
check('AP-R2-01：短四元数行（4 列）显式拒绝；NaN 范数落拒绝侧（评审 numeric 复现例）', () => {
  const malformed = { duration: 1, bones: { bone_0: { q: [[0, 0, 0, 0], [2, 0, 0, 0]], t: [[0, 0, 0, 0], [2, 0, 0, 0]], s: [[0, -1, -1, -1], [2, -1, -1, -1]] } } };
  const r = R.validateConvertedClip(malformed);
  assert.ok(!r.ok && /宽度非法/.test(r.reason), '实际：' + JSON.stringify(r));
  const shortT = { duration: 1, bones: { bone_0: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 1, 1, 1], [1, 1, 1]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] } } };
  assert.ok(/宽度非法/.test(R.validateConvertedClip(shortT).reason), 't/s 短行同样显式拒绝');
});
check('AP-R2-01：包内任一剪辑坏（晚到坏四元数）→ validatePackV2 整包拒绝（先于任何写入）', () => {
  const base106 = { count: 106, bones: [] };
  for (let i = 0; i < 106; i++) base106.bones.push(bone(i, 'b' + i, i - 1));
  const goodRows = () => ({ q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 1, 1, 1], [1, 1, 1, 1]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] });
  const p = mkPackBase(base106);
  p.clips = [
    { clip: { duration: 1, bones: { bone_0: goodRows() } } },
    { clip: { duration: 1, bones: { bone_0: goodRows() } } },
  ];
  p.clips[1].clip.bones.bone_0.q[1] = [1, 2, 0, 0, 0]; // norm=4（评审 bad-late-quaternion 口径）
  p.entries = [{ name: 'a', clipIndex: 0 }, { name: 'b', clipIndex: 1 }];
  const r = R.validatePackV2(p);
  assert.ok(!r.ok && /第 1 条剪辑不合格/.test(r.reason) && /未归一/.test(r.reason), '实际：' + JSON.stringify(r));
});
check('AP-R2-01B：第二条剪辑未声明基准索引 bone_999 / 非法骨键 → validatePackV2 整包写前拒绝', () => {
  const base106 = { count: 106, bones: [] };
  for (let i = 0; i < 106; i++) base106.bones.push(bone(i, 'b' + i, i - 1));
  const goodRows = () => ({ q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 1, 1, 1], [1, 1, 1, 1]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] });
  const mkTwo = () => { // 两条目包：首条合法，第二条克隆首条（clipIndex=1）
    const p = mkPackBase(base106);
    p.clips = [
      { clip: { duration: 1, bones: { bone_0: goodRows() } } },
      { clip: { duration: 1, bones: { bone_0: goodRows() } } },
    ];
    p.entries = [{ name: 'a', clipIndex: 0 }, { name: 'b', clipIndex: 1 }];
    return p;
  };
  // 未声明基准索引：把第二条的 bone_0 数据挪到 bone_999（106 骨声明之外，行值全有限合法）
  const p1 = mkTwo();
  const moved = p1.clips[1].clip.bones.bone_0;
  delete p1.clips[1].clip.bones.bone_0;
  p1.clips[1].clip.bones.bone_999 = moved;
  const r1 = R.validatePackV2(p1);
  assert.ok(!r1.ok && /第 1 条剪辑/.test(r1.reason) && /未声明的基准骨索引：bone_999/.test(r1.reason), '实际：' + JSON.stringify(r1));
  // 非法骨键格式（非 bone_N 数字形态）
  const p2 = mkTwo();
  p2.clips[1].clip.bones['b0'] = goodRows();
  const r2 = R.validatePackV2(p2);
  assert.ok(!r2.ok && /骨骼键非法/.test(r2.reason), '实际：' + JSON.stringify(r2));
  // 合法对照：两条全合法仍整包通过（骨键校验不得误伤）
  const r3 = R.validatePackV2(mkTwo());
  assert.ok(r3.ok, '实际：' + JSON.stringify(r3));
});

console.log('— 参考姿态解析（冻结口径）—');
check('码已知+族包同名拓扑一致 → 用族包参考；拓扑不一致 → 拒绝', () => {
  const tribe = { code: 'c1201', skeleton: mkBase() };
  const pack = { tribes: [tribe] };
  const prof = { sourceSkeletonCode: 'c1201', skeleton: mkBase() };
  const r1 = R.resolveTargetRefs(prof, pack);
  assert.ok(r1.ok && r1.refSource === 'bundled:c1201');
  const other = JSON.parse(JSON.stringify(mkBase())); other.bones[1].n = 'renamed';
  const r2 = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: other }, pack);
  assert.ok(!r2.ok && /不一致/.test(r2.reason));
});
check('无码但档案骨架有效 → 用档案自身；只有码无骨架 → 拒绝', () => {
  const r1 = R.resolveTargetRefs({ sourceSkeletonCode: '', skeleton: mkBase() }, { tribes: [] });
  assert.ok(r1.ok && r1.refSource === 'profile(无码)');
  const r2 = R.resolveTargetRefs({ sourceSkeletonCode: 'c9999', skeleton: null }, { tribes: [] });
  assert.ok(!r2.ok && /不能只凭码/.test(r2.reason));
  const r3 = R.resolveTargetRefs({ sourceSkeletonCode: '', skeleton: null }, { tribes: [] });
  assert.ok(!r3.ok && /先建档/.test(r3.reason));
});

console.log('— 真 shipped 族包（skeleton-pack.js）覆盖 —');
const PACK_SRC = fs.readFileSync(path.join(__dirname, 'dist', 'ChoreoHelper', 'skeleton-pack.js'), 'utf8');
eval.call(global, PACK_SRC); // 经典脚本：window.__CHOREO_SKELETON_PACK__（window=global）
const SP = global.__CHOREO_SKELETON_PACK__;
check('18 族齐全，c0101=106 骨，各族骨名全部 ⊆ c0101 骨名（映射可用性）', () => {
  assert.ok(SP && Array.isArray(SP.tribes) && SP.tribes.length === 18, 'tribes=' + (SP && SP.tribes.length));
  const c0101 = SP.tribes.filter((t) => t.code === 'c0101')[0];
  assert.strictEqual(c0101.skeleton.count, 106);
  assert.ok(R.validateRefSkeleton(c0101.skeleton).ok, 'c0101 参考骨架应过校验');
  const names = new Set(c0101.skeleton.bones.map((b) => b.n));
  SP.tribes.forEach((t) => {
    t.skeleton.bones.forEach((b) => assert.ok(names.has(b.n), t.code + ' 缺骨名 ' + b.n));
  });
});
check('真数值换算 c0101→c0301 / c0101→c1201：公式值逐分量吻合，输出键=目标族索引', () => {
  const c0101 = SP.tribes.filter((t) => t.code === 'c0101')[0];
  ['c0301', 'c1201'].forEach((code) => {
    const tribe = SP.tribes.filter((t) => t.code === code)[0];
    const hip = c0101.skeleton.bones.filter((b) => b.n === 'j_kosi')[0];
    assert.ok(hip, 'c0101 应有 j_kosi');
    const pack = { formatVersion: 2, baseSkeletonCode: 'c0101', baseSkeleton: c0101.skeleton };
    const tVal = 1.23456;
    const r = R.convertClip({ name: 'x', duration: 1, type: 'loop', bones: {
      ['bone_' + hip.i]: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, tVal, tVal, tVal], [1, tVal, tVal, tVal]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] },
    } }, pack, tribe.skeleton);
    assert.ok(r.ok, code + ': ' + (r.reason || ''));
    const tgt = tribe.skeleton.bones.filter((b) => b.n === 'j_kosi')[0];
    assert.ok(r.clip.bones['bone_' + tgt.i], code + ' 应落在目标 j_kosi 索引');
    const row = r.clip.bones['bone_' + tgt.i].t[0];
    for (let c = 0; c < 3; c++) {
      const expect = Math.abs(hip.t[c]) > 1e-4
        ? Math.round(tVal * (tgt.t[c] / hip.t[c]) * 1e4) / 1e4
        : Math.round((tVal + (tgt.t[c] - hip.t[c])) * 1e4) / 1e4;
      assert.strictEqual(row[c + 1], expect, code + ' 分量 ' + c);
    }
  });
});
check('真族包档案解析：码+拓扑一致走族包参考（离线建档常见形态）', () => {
  const c1201 = SP.tribes.filter((t) => t.code === 'c1201')[0];
  const r = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: c1201.skeleton }, SP);
  assert.ok(r.ok && r.refSource === 'bundled:c1201');
});
check('AP-R2-03：真 c0101 打乱骨序必须通过；真 c1201 同名改父必须拒绝（评审 numeric 复现例）', () => {
  const c0101rev = JSON.parse(JSON.stringify(SP.tribes.filter((t) => t.code === 'c0101')[0].skeleton));
  c0101rev.bones.reverse();
  assert.ok(R.validateRefSkeleton(c0101rev).ok, '合法乱序被误判');
  const c1201 = SP.tribes.filter((t) => t.code === 'c1201')[0];
  const prof = JSON.parse(JSON.stringify(c1201.skeleton));
  prof.bones.filter((b) => b.n === 'n_throw')[0].p = -1; // 同名改父（骨名集不变）
  const r = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: prof }, SP);
  assert.ok(!r.ok && /拓扑不一致/.test(r.reason), '实际：' + JSON.stringify(r));
});
check('AP-R2-03：码+无骨架 → 显式拒绝；码+异常档案骨架 → 拒绝且不借族包参考', () => {
  const r1 = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: null }, SP);
  assert.ok(!r1.ok && /不能只凭码|无法核对拓扑/.test(r1.reason), '实际：' + JSON.stringify(r1));
  const c1201 = SP.tribes.filter((t) => t.code === 'c1201')[0];
  const bad = JSON.parse(JSON.stringify(c1201.skeleton));
  bad.bones[3].p = 3; // 父指自身 → 档案骨架结构异常
  const r2 = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: bad }, SP);
  assert.ok(!r2.ok && /档案骨架异常/.test(r2.reason), '实际：' + JSON.stringify(r2));
});
check('ALG-01：族包提供参考姿态，合法重编号档案提供输出 i/p（两者均不改写）', () => {
  const bundled = SP.tribes.find((t) => t.code === 'c1201').skeleton;
  const skel = JSON.parse(JSON.stringify(bundled));
  skel.bones.reverse();
  skel.bones.forEach((b) => { b.i = skel.count - 1 - b.i; if (b.p !== -1) b.p = skel.count - 1 - b.p; b.t = [99, 98, 97]; });
  const before = JSON.stringify({ skel, bundled });
  assert.ok(R.validateRefSkeleton(skel).ok && R.sameNameTopology(skel, bundled));
  const r = R.resolveTargetRefs({ sourceSkeletonCode: 'c1201', skeleton: skel }, SP);
  assert.ok(r.ok && R.validateRefSkeleton(r.refSkeleton).ok, r.reason);
  skel.bones.forEach((b) => {
    const actual = r.refSkeleton.bones.find((x) => x.n === b.n);
    const ref = bundled.bones.find((x) => x.n === b.n);
    assert.strictEqual(actual.i, b.i, b.n + ' 输出索引取档案');
    assert.strictEqual(actual.p, b.p, b.n + ' 父索引取档案');
    for (const key of ['t', 'q', 's']) assert.deepStrictEqual(actual[key], ref[key], b.n + ' 参考姿态取族包');
  });
  assert.strictEqual(JSON.stringify({ skel, bundled }), before);
});
check('ALG-02：缩放零值/负值/负时间与真实引擎同向拒绝，正缩放照常可播放', () => {
  require(path.join(__dirname, 'choreo-engine.js'));
  const make = () => ({ name: 'scale-check', type: 'once', duration: 1, bones: { bone_1: JSON.parse(JSON.stringify(mkClipBones().bone_1)) } });
  for (const mutate of [c => { c.bones.bone_1.s[1][1] = 0; }, c => { c.bones.bone_1.s[1][2] = -1; }, c => { c.bones.bone_1.s[0][0] = -1; }]) {
    const clip = make(); mutate(clip);
    assert.throws(() => new global.ChoreoEngine.PreviewEngine().registerClip(clip), /缩放关键帧无效/);
    const checked = R.validateConvertedClip(clip);
    assert.ok(!checked.ok, '不得接收引擎拒绝的缩放：' + JSON.stringify(clip.bones.bone_1.s));
  }
  const good = make(); good.bones.bone_1.s[1] = [1, 0.25, 2, 3];
  assert.ok(R.validateConvertedClip(good).ok);
  assert.doesNotThrow(() => new global.ChoreoEngine.PreviewEngine().registerClip(good));
});
console.log('结果：' + n + ' 通过 / ' + fails + ' 失败');
