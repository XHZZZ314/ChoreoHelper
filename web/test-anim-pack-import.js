// test-anim-pack-import.js — TASK-20260918-ANIM-PACK-UNIVERSAL r2：v2 导入编排单测（node 假库）。
//
// 跑法：D:\nodejs\node.exe web\test-anim-pack-import.js
//
// 覆盖（合同 AC3/AC4/AC6/AC7 编排面）：冻结计划（目标/参考/快照/覆盖）、逐档案各自换算
// 各自计数、同名默认跳过与显式覆盖、切换/取消作废其后写入且已提交保留、存储失败停该档案
// 其余档案继续、坏条目不进库、activeProfile 绝不被改、计数合计=计划数。真 IndexedDB 守卫
// 行为由 web/test-library.js（受守卫覆盖扩展）与浏览器测试覆盖。
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;
require(path.join(__dirname, 'choreo-anim-pack-retarget.js'));
require(path.join(__dirname, 'choreo-anim-pack-import.js'));
const R = global.ChoreoAnimPackRetarget;
const I = global.ChoreoAnimPackImport;

// 真 shipped 族包（c0101 基准 + c1201/c0301 目标）
eval.call(global, fs.readFileSync(path.join(__dirname, 'dist', 'ChoreoHelper', 'skeleton-pack.js'), 'utf8'));
const SP = global.__CHOREO_SKELETON_PACK__;
const C0101 = SP.tribes.filter((t) => t.code === 'c0101')[0].skeleton;
const C1201 = SP.tribes.filter((t) => t.code === 'c1201')[0].skeleton;
const C0301 = SP.tribes.filter((t) => t.code === 'c0301')[0].skeleton;

function hipOf(skel) { return skel.bones.filter((b) => b.n === 'j_kosi')[0]; }
function mkPack() { // 2 条目 v2 包（c0101 基准，j_kosi 一骨动画，数值可预测）
  const hip = hipOf(C0101);
  const bones = {};
  bones['bone_' + hip.i] = {
    q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
    t: [[0, 1, 1, 1], [1, 1, 1, 1]],
    s: [[0, 1, 1, 1], [1, 1, 1, 1]],
  };
  const clip = { name: 'k', duration: 1, type: 'loop', bones, offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: 'c0101', productionImportApproved: false } };
  return { formatVersion: 2, gameVersion: 't', code: 'c0101', baseSkeletonCode: 'c0101', baseSkeleton: C0101,
    counts: {}, clips: [{ key: 'k', clip }], entries: [{ name: 'nod', label: '点头', kind: 'emote', clipIndex: 0 }, { name: 'bow', label: '鞠躬', kind: 'emote', clipIndex: 0 }] };
}

// 假库：镜像真库守卫语义（快照复核/活动指针/allowOverwrite/同名默认拒绝覆盖）
function FakeLib(opts) {
  const self = this;
  this.opts = opts || {};
  this.profiles = opts.profiles || [];       // [{id,name,sourceSkeletonCode,skeleton}]
  this.activePid = opts.activePid || (this.profiles[0] && this.profiles[0].id) || null;
  this.clips = {};                            // pid -> {name: {hash, clip}}
  this.setActiveCalls = 0;
  this.listProfiles = async () => this.profiles.map((p) => ({ id: p.id, name: p.name, sourceSkeletonCode: p.sourceSkeletonCode || '', hasSkeleton: !!p.skeleton, isActive: p.id === this.activePid }));
  this.getProfile = async (pid) => this.profiles.filter((p) => p.id === pid)[0] || null;
  this.clipIndex = async (pid) => Object.keys(this.clips[pid] || {}).map((name) => ({ name }));
  this.putClip = async (name, clip, pid, guard) => {
    if (opts.beforeWrite) opts.beforeWrite(name, pid, self); // 注入延迟/切换/删除钩子（AC4）
    if (opts.writeBehavior) { const b = opts.writeBehavior(name, pid, self); if (b === 'skip') return { name }; }
    const prof = this.profiles.filter((p) => p.id === pid)[0];
    if (guard) {
      if (!guard.current()) throw new Error('项目、舞者或角色档案已变化，技能动作未保存');
      if (JSON.stringify(prof) !== guard.profileText) throw new Error('项目、舞者或角色档案已变化，技能动作未保存');
      if (guard.activeProfileId && this.activePid !== guard.activeProfileId) throw new Error('活动角色档案已变化，技能动作未保存');
      const ex = (this.clips[pid] || {})[name];
      if (ex && ex.hash !== 'same' && !guard.allowOverwrite) throw new Error('此档案已有不同的同名技能动作，保留原资源');
    }
    this.clips[pid] = this.clips[pid] || {};
    this.clips[pid][name] = { hash: 'h' + name, clip };
    return { name };
  };
}

let n = 0, fails = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('  ✔ ' + name); }, (e) => { fails++; console.log('  ✘ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }); }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function runChecks() {
  const skelProfiles = [
    { id: 'pA', name: 'A(c1201)', sourceSkeletonCode: 'c1201', skeleton: C1201 },
    { id: 'pB', name: 'B(c0301 无码)', sourceSkeletonCode: '', skeleton: C0301 },
    { id: 'pC', name: 'C(空)', sourceSkeletonCode: '', skeleton: null },
  ];

  console.log('— 冻结计划 buildPlan —');
  await check('全档案计划：2 可用目标 + 空档案单独列出不写入；v1/坏包整体拒绝', async () => {
    const lib = new FakeLib({ profiles: skelProfiles, activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    assert.ok(b.ok, b.reason);
    assert.strictEqual(b.plan.targets.length, 2);
    assert.strictEqual(b.plan.targets[0].pid, 'pA');
    assert.strictEqual(b.plan.targets[0].refSource, 'bundled:c1201');
    assert.strictEqual(b.plan.targets[1].refSource, 'profile(无码)');
    assert.strictEqual(b.plan.rejected.length, 1);
    assert.ok(/先建档/.test(b.plan.rejected[0].reason));
    const bad = await I.buildPlan({ lib, pack: { formatVersion: 1 }, allProfiles: false, activePid: 'pA', skeletonPack: SP });
    assert.ok(!bad.ok && /版本不是 2/.test(bad.reason));
    const none = await I.buildPlan({ lib, pack: mkPack(), allProfiles: true, activePid: 'pX', skeletonPack: SP });
    assert.ok(!none.ok && /活动档案/.test(none.reason));
  });
  await check('默认（不勾全部档案）：只冻结当前档案一个目标', async () => {
    const lib = new FakeLib({ profiles: skelProfiles, activePid: 'pB' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pB', overwrite: false, skeletonPack: SP });
    assert.ok(b.ok && b.plan.targets.length === 1 && b.plan.targets[0].pid === 'pB');
  });

  console.log('— runPlan 计数与换算 —');
  await check('两档案各自换算入库：键=各自族索引、数值按各自参考；activeProfile 不被改；被拒档案计入 planned（AP-R2-02）', async () => {
    const lib = new FakeLib({ profiles: skelProfiles, activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    const res = await I.runPlan(b.plan, b.plan.pack || mkPack(), { lib, current: () => true, putClip: (nm, c, pid, g) => lib.putClip(nm, c, pid, g), clipIndex: (pid) => lib.clipIndex(pid) });
    assert.strictEqual(res.status, 'partial', '被拒空档案在场时不得报 completed');
    assert.strictEqual(res.aggregate.imported, 4);
    assert.strictEqual(res.aggregate.planned, 6, 'planned=全部选中档案×条目（3 档案×2 条目）');
    assert.strictEqual(res.aggregate.failed, 2, '被拒档案的 2 条计入 failed');
    assert.strictEqual(res.rejected[0].counts.failed, 2, '被拒档案自带逐项计数');
    const a = res.aggregate;
    assert.strictEqual(a.imported + a.skipped + a.failed + a.notStarted, a.planned, '合计=计划数');
    assert.strictEqual(lib.activePid, 'pA', 'activeProfile 绝不被导入改写');
    const hipA = hipOf(C1201), hipB = hipOf(C0301), hip0 = hipOf(C0101);
    const ca = lib.clips.pA.nod.clip.bones['bone_' + hipA.i];
    const cb = lib.clips.pB.nod.clip.bones['bone_' + hipB.i];
    assert.ok(ca && cb, '两档案各落到各自 j_kosi 索引');
    const qz = (v) => Math.round(v * 1e4) / 1e4;
    for (let c = 0; c < 3; c++) {
      const expectA = Math.abs(hip0.t[c]) > 1e-4 ? qz(1 * (hipA.t[c] / hip0.t[c])) : qz(1 + (hipA.t[c] - hip0.t[c]));
      assert.strictEqual(ca.t[0][c + 1], expectA, 'A 分量 ' + c);
      const expectB = Math.abs(hip0.t[c]) > 1e-4 ? qz(1 * (hipB.t[c] / hip0.t[c])) : qz(1 + (hipB.t[c] - hip0.t[c]));
      assert.strictEqual(cb.t[0][c + 1], expectB, 'B 分量 ' + c);
    }
  });
  await check('同名默认跳过、显式覆盖只换冻结目标；计数合计=计划数（AC6）', async () => {
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 }], activePid: 'pA' });
    lib.clips.pA = { nod: { hash: 'old', clip: { bones: {} } } }; // 已在库同名
    let b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pA', overwrite: false, skeletonPack: SP });
    let res = await I.runPlan(b.plan, mkPack(), { lib, current: () => true, putClip: (nm, c, pid, g) => lib.putClip(nm, c, pid, g), clipIndex: (pid) => lib.clipIndex(pid) });
    assert.strictEqual(res.aggregate.skipped, 1);
    assert.strictEqual(res.aggregate.imported, 1);
    assert.strictEqual(lib.clips.pA.nod.hash, 'old', '默认不覆盖已有同名');
    b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pA', overwrite: true, skeletonPack: SP });
    res = await I.runPlan(b.plan, mkPack(), { lib, current: () => true, putClip: (nm, c, pid, g) => lib.putClip(nm, c, pid, g), clipIndex: (pid) => lib.clipIndex(pid) });
    assert.strictEqual(res.aggregate.imported, 2); // 覆盖 1 + 新 1
    assert.strictEqual(lib.clips.pA.nod.hash, 'hnod', '显式覆盖替换同名');
    const a = res.aggregate;
    assert.strictEqual(a.imported + a.skipped + a.failed + a.notStarted, a.planned);
  });

  console.log('— 取消/切换/存储失败（AC4/AC6）—');
  await check('中途取消：其后条目 notStarted、已提交保留、状态 cancelled', async () => {
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 }], activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pA', overwrite: false, skeletonPack: SP });
    const plan = b.plan;
    const res = await I.runPlan(plan, mkPack(), {
      lib, current: () => true,
      putClip: async (nm, c, pid, g) => { const r = await lib.putClip(nm, c, pid, g); if (nm === 'nod') plan.cancelled = true; return r; },
      clipIndex: (pid) => lib.clipIndex(pid),
    });
    assert.strictEqual(res.status, 'cancelled');
    assert.ok(lib.clips.pA.nod && !lib.clips.pA.bow, '首条已提交保留，第二条未开始');
    assert.strictEqual(res.aggregate.imported, 1);
    assert.strictEqual(res.aggregate.notStarted, 1);
  });
  await check('导入中切换活动档案：守卫拒绝→其后全部作废（含其他目标），已提交保留', async () => {
    const lib = new FakeLib({ profiles: [
      { id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 },
      { id: 'pB', name: 'B', sourceSkeletonCode: 'c0301', skeleton: C0301 },
    ], activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    const plan = b.plan;
    const res = await I.runPlan(plan, mkPack(), {
      lib, current: () => true,
      putClip: async (nm, c, pid, g) => {
        if (nm === 'nod' && pid === 'pA') lib.activePid = 'pB'; // 第一条提交前切换
        return lib.putClip(nm, c, pid, g);
      },
      clipIndex: (pid) => lib.clipIndex(pid),
    });
    assert.strictEqual(res.status, 'cancelled');
    assert.ok(!lib.clips.pA && !lib.clips.pB, '切换后零提交');
    assert.strictEqual(res.aggregate.notStarted, 4);
  });
  await check('导入中目标档案被删/骨架变化：快照不符→该操作作废', async () => {
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 }], activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pA', overwrite: false, skeletonPack: SP });
    const res = await I.runPlan(b.plan, mkPack(), {
      lib, current: () => true,
      putClip: async (nm, c, pid, g) => {
        lib.profiles[0].skeleton = C0301; // 写入前目标骨架被换
        return lib.putClip(nm, c, pid, g);
      },
      clipIndex: (pid) => lib.clipIndex(pid),
    });
    assert.strictEqual(res.status, 'cancelled');
    assert.ok(!lib.clips.pA, '快照不符零写入');
  });
  await check('存储失败停该档案（部分进度），其余有效档案继续；状态 partial', async () => {
    const lib = new FakeLib({ profiles: [
      { id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 },
      { id: 'pB', name: 'B', sourceSkeletonCode: 'c0301', skeleton: C0301 },
    ], activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    const res = await I.runPlan(b.plan, mkPack(), {
      lib, current: () => true,
      putClip: (nm, c, pid, g) => {
        if (pid === 'pA') return Promise.reject(new Error('QuotaExceededError: 存储空间不足'));
        return lib.putClip(nm, c, pid, g);
      },
      clipIndex: (pid) => lib.clipIndex(pid),
    });
    assert.strictEqual(res.status, 'partial');
    assert.ok(lib.clips.pB && lib.clips.pB.nod && lib.clips.pB.bow, 'B 档案照常完成');
    const tA = res.targets.filter((t) => t.pid === 'pA')[0];
    assert.strictEqual(tA.counts.failed, 1);
    assert.strictEqual(tA.counts.notStarted, 1, '存储失败后该档案剩余不再写');
  });

  await check('ALG-03：非配额存储失败停当前档案，保留已提交前缀并继续下一档案', async () => {
    for (const error of [new DOMException('disk failure', 'UnknownError'), new DOMException('transaction failed', 'AbortError'), new Error('backend write failed')]) {
      const lib = new FakeLib({ profiles: skelProfiles.slice(0, 2), activePid: 'pA' });
      const pack = mkPack(); pack.entries.push({ name: 'third', clipIndex: 0 });
      const b = await I.buildPlan({ lib, pack, allProfiles: true, activePid: 'pA', skeletonPack: SP });
      assert.ok(b.ok, b.reason);
      const attempts = [];
      const res = await I.runPlan(b.plan, pack, { lib, current: () => true, putClip: async (nm, c, pid, g) => {
        attempts.push(pid + ':' + nm);
        if (pid === 'pA' && nm === 'bow') throw error;
        return lib.putClip(nm, c, pid, g);
      } });
      assert.deepStrictEqual(attempts, ['pA:nod', 'pA:bow', 'pB:nod', 'pB:bow', 'pB:third'], error.name);
      assert.deepStrictEqual(res.targets[0].counts, { imported: 1, skipped: 0, failed: 1, notStarted: 1 });
      assert.deepStrictEqual(res.aggregate, { imported: 4, skipped: 0, failed: 1, notStarted: 1, planned: 6 });
      assert.strictEqual(res.status, 'partial');
      assert.ok(lib.clips.pA.nod && !lib.clips.pA.bow && !lib.clips.pA.third, '成功前缀保留，失败后零写入');
    }
  });
  await check('ALG-01：带族码的重编号档案导入映射到该档案骨名，参考数值仍取族包', async () => {
    const skel = JSON.parse(JSON.stringify(C1201));
    skel.bones.forEach((bone) => { bone.i = skel.count - 1 - bone.i; if (bone.p !== -1) bone.p = skel.count - 1 - bone.p; bone.t = [99, 98, 97]; });
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: skel }], activePid: 'pA' });
    const pack = mkPack(), before = JSON.stringify({ pack, skel, C1201 });
    const b = await I.buildPlan({ lib, pack, allProfiles: false, activePid: 'pA', skeletonPack: SP });
    assert.ok(b.ok, b.reason);
    const res = await I.runPlan(b.plan, pack, { lib, current: () => true, putClip: lib.putClip });
    assert.strictEqual(res.status, 'completed');
    const output = lib.clips.pA.nod.clip.bones, targetHip = hipOf(skel);
    assert.deepStrictEqual(Object.keys(output), ['bone_' + targetHip.i]);
    const expected = R.convertClip(pack.clips[0].clip, pack, C1201);
    assert.deepStrictEqual(output['bone_' + targetHip.i], expected.clip.bones['bone_' + hipOf(C1201).i]);
    assert.strictEqual(JSON.stringify({ pack, skel, C1201 }), before);
  });
  await check('ALG-04：进度回调异常不重复记账、不停后续条目/档案，真实存储失败仍隔离', async () => {
    const lib = new FakeLib({ profiles: skelProfiles.slice(0, 2), activePid: 'pA' });
    const pack = mkPack(); pack.entries.push({ name: 'third', clipIndex: 0 });
    const b = await I.buildPlan({ lib, pack, allProfiles: true, activePid: 'pA', skeletonPack: SP });
    assert.ok(b.ok, b.reason);
    const attempts = [], notifications = [];
    const res = await I.runPlan(b.plan, pack, { lib, current: () => true,
      putClip: async (nm, c, pid, g) => {
        attempts.push(pid + ':' + nm);
        if (pid === 'pB' && nm === 'bow') throw new DOMException('disk failure', 'UnknownError');
        return lib.putClip(nm, c, pid, g);
      },
      onProgress: (stage, detail) => { notifications.push(detail.target.pid + ':' + detail.entry.name); throw new Error('progress view failed'); },
    });
    assert.deepStrictEqual(attempts, ['pA:nod', 'pA:bow', 'pA:third', 'pB:nod', 'pB:bow']);
    assert.deepStrictEqual(notifications, ['pA:nod', 'pA:bow', 'pA:third', 'pB:nod']);
    assert.deepStrictEqual(res.aggregate, { imported: 4, skipped: 0, failed: 1, notStarted: 1, planned: 6 });
    assert.deepStrictEqual(res.targets[0].counts, { imported: 3, skipped: 0, failed: 0, notStarted: 0 });
    assert.deepStrictEqual(res.targets[1].counts, { imported: 1, skipped: 0, failed: 1, notStarted: 1 });
    assert.ok(res.targets[0].failures.every(f => /已保存.*进度通知失败.*progress view failed/.test(f)), '通知错误须如实报告，不能冒充保存失败');
    assert.strictEqual(res.targets[0].failures.length, 3);
    assert.ok(res.targets[1].failures.some(f => /disk failure/.test(f)), '真实写入错误不能被通知异常掩盖');
    assert.strictEqual(res.status, 'partial');
    assert.ok(lib.clips.pA.third && lib.clips.pB.nod && !lib.clips.pB.bow && !lib.clips.pB.third);
  });

  console.log('— 坏数据不进库（AC5 编排面；AP-R2-01 全包写前预检）—');
  await check('ALG-02：晚到的零/负缩放或负缩放时间整包写前拒绝，所有档案零写入', async () => {
    for (const mutate of [rows => { rows[1][1] = 0; }, rows => { rows[1][3] = -1; }, rows => { rows[0][0] = -1; }]) {
      const lib = new FakeLib({ profiles: skelProfiles.slice(0, 2), activePid: 'pA' });
      const pack = mkPack(), late = JSON.parse(JSON.stringify(pack.clips[0]));
      mutate(late.clip.bones['bone_' + hipOf(C0101).i].s);
      pack.clips.push(late); pack.entries[1].clipIndex = 1;
      let writes = 0;
      const b = await I.buildPlan({ lib, pack, allProfiles: true, activePid: 'pA', skeletonPack: SP });
      if (b.ok) await I.runPlan(b.plan, pack, { lib, current: () => true, putClip: async () => { writes++; } });
      assert.strictEqual(writes, 0, '先完成整包预检，不得先写首条');
      assert.ok(!b.ok && /第 1 条剪辑不合格/.test(b.reason), b.reason);
      assert.deepStrictEqual(lib.clips, {});
    }
  });
  await check('含 NaN 平移的剪辑：buildPlan 整包写前拒绝（不再逐条入库后失败）、零写入', async () => {
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 }], activePid: 'pA' });
    const pack = mkPack();
    pack.clips[0].clip.bones['bone_' + hipOf(C0101).i].t[1][2] = NaN;
    const b = await I.buildPlan({ lib, pack, allProfiles: false, activePid: 'pA', overwrite: false, skeletonPack: SP });
    assert.ok(!b.ok && /校验失败/.test(b.reason) && /非有限/.test(b.reason), '实际：' + b.reason);
    assert.ok(!lib.clips.pA, '零写入');
  });
  await check('AP-R2-01 红回归：第二条坏四元数（norm=4）→ 第一条也不得入库，整包写前拒绝', async () => {
    const lib = new FakeLib({ profiles: [
      { id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 },
      { id: 'pB', name: 'B', sourceSkeletonCode: 'c0301', skeleton: C0301 },
    ], activePid: 'pA' });
    const pack = mkPack();
    const c2 = JSON.parse(JSON.stringify(pack.clips[0]));
    c2.clip = JSON.parse(JSON.stringify(c2.clip));
    c2.clip.bones['bone_' + hipOf(C0101).i].q[1] = [1, 2, 0, 0, 0]; // norm=4（评审 bad-late-quaternion 口径）
    pack.clips.push(c2);
    pack.entries[1].clipIndex = 1; // bow → 第二条坏剪辑
    const b = await I.buildPlan({ lib, pack, allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    assert.ok(!b.ok && /第 1 条剪辑不合格/.test(b.reason) && /未归一/.test(b.reason), '实际：' + b.reason);
    assert.ok(!lib.clips.pA && !lib.clips.pB, '两档案零写入（旧行为：第一条已入库）');
  });
  await check('AP-R2-01B 红回归：未声明基准索引 bone_999 / 非法骨键 → buildPlan 写前拒绝、写入 spy 零调用（首条不得先入库）', async () => {
    const lib = new FakeLib({ profiles: [
      { id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 },
      { id: 'pB', name: 'B', sourceSkeletonCode: 'c0301', skeleton: C0301 },
    ], activePid: 'pA' });
    const origPut = lib.putClip.bind(lib); let writes = 0; // 写入 spy：任何 putClip 调用都计数
    lib.putClip = function () { writes++; return origPut.apply(null, arguments); };
    const mkBad = (mutate) => { // 两条目：首条合法；第二条克隆首条后按评审口径改坏骨键
      const pack = mkPack();
      const hipKey = 'bone_' + hipOf(C0101).i;
      const c2 = JSON.parse(JSON.stringify(pack.clips[0]));
      c2.clip = JSON.parse(JSON.stringify(c2.clip));
      mutate(c2.clip.bones, hipKey);
      pack.clips.push(c2);
      pack.entries[1].clipIndex = 1;
      return pack;
    };
    const b1 = await I.buildPlan({ lib, pack: mkBad((bones, hipKey) => { const mv = bones[hipKey]; delete bones[hipKey]; bones.bone_999 = mv; }),
      allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    assert.ok(!b1.ok && /未声明的基准骨索引：bone_999/.test(b1.reason), '实际：' + b1.reason);
    const b2 = await I.buildPlan({ lib, pack: mkBad((bones, hipKey) => { const mv = bones[hipKey]; delete bones[hipKey]; bones['j_kosi'] = mv; }),
      allProfiles: true, activePid: 'pA', overwrite: false, skeletonPack: SP });
    assert.ok(!b2.ok && /骨骼键非法/.test(b2.reason), '实际：' + b2.reason);
    assert.strictEqual(writes, 0, '写入 spy：putClip 零调用');
    assert.ok(!lib.clips.pA && !lib.clips.pB, '内存镜像零入库（旧行为：第一条已入库）');
  });
  await check('异常比例骨（平移保持原样）：status 仍 completed 但 anomalyEntries>0（不得冒充全换算）', async () => {
    // 106 骨合成基准（名 b0..b105），b1 参考平移大分量 → 目标同骨比例 20>8 → 整骨保持并上报
    const base = { count: 106, bones: [] };
    for (let i = 0; i < 106; i++) base.bones.push({ i, n: 'b' + i, p: i - 1, t: i === 1 ? [2, 2, 2] : [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    const target = { count: 106, bones: base.bones.map((b) => ({ i: b.i, n: b.n, p: b.p, t: b.i === 1 ? [40, 2, 2] : [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] })) };
    const pack = { formatVersion: 2, gameVersion: 't', code: 'c0101', baseSkeletonCode: 'c0101', baseSkeleton: base, counts: {},
      clips: [{ clip: { duration: 1, type: 'loop', bones: { bone_1: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]], t: [[0, 1, 1, 1], [1, 1, 1, 1]], s: [[0, 1, 1, 1], [1, 1, 1, 1]] } } } }],
      entries: [{ name: 'x', clipIndex: 0 }] };
    const lib = new FakeLib({ profiles: [{ id: 'pT', name: 'T', sourceSkeletonCode: '', skeleton: target }], activePid: 'pT' });
    const b = await I.buildPlan({ lib, pack, allProfiles: false, activePid: 'pT', overwrite: false, skeletonPack: SP });
    assert.ok(b.ok, b.reason);
    const res = await I.runPlan(b.plan, pack, { lib, current: () => true, putClip: (nm, c, pid, g) => lib.putClip(nm, c, pid, g), clipIndex: (pid) => lib.clipIndex(pid) });
    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.anomalyEntries, 1, '异常骨条目单独计数');
    assert.deepStrictEqual(res.targets[0].preservedBones.x, ['b1']);
    assert.deepStrictEqual(lib.clips.pT.x.clip.bones.bone_1.t, [[0, 1, 1, 1], [1, 1, 1, 1]], '异常骨平移原样保持');
  });
  await check('UI 失效（dead）：不发起后续写入', async () => {
    const lib = new FakeLib({ profiles: [{ id: 'pA', name: 'A', sourceSkeletonCode: 'c1201', skeleton: C1201 }], activePid: 'pA' });
    const b = await I.buildPlan({ lib, pack: mkPack(), allProfiles: false, activePid: 'pA', overwrite: false, skeletonPack: SP });
    let alive = true;
    const res = await I.runPlan(b.plan, mkPack(), {
      lib, current: () => alive,
      putClip: async (nm, c, pid, g) => { const r = await lib.putClip(nm, c, pid, g); alive = false; return r; },
      clipIndex: (pid) => lib.clipIndex(pid),
    });
    assert.ok(lib.clips.pA.nod && !lib.clips.pA.bow);
    assert.strictEqual(res.aggregate.notStarted, 1);
  });
}
runChecks().then(() => console.log('结果：' + n + ' 通过 / ' + fails + ' 失败'));
