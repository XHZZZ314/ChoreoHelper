// engine 单测（node 直接跑：node test-engine.js）
// 覆盖：采样端点/插值中点/状态机 once→idle/链式/seek 边界
'use strict';
require('./choreo-engine.js');
const { sampleClip, PreviewEngine } = globalThis.ChoreoEngine;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, detail != null ? JSON.stringify(detail) : ''); }
}

// ---- 1. 采样端点 ----
const clip = {
  name: 'test', duration: 2, type: 'once',
  bones: { arm: { q: [[0, 0, 0, 0, 1], [1, 0, 0, 0.38268, 0.92388], [2, 0, 0, 0.7071, 0.7071]] } }
};
let p = sampleClip(clip, 0);
assert('端点 t=0 取首帧', p.arm.qx === 0 && p.arm.qw === 1, p.arm);
p = sampleClip(clip, 2);
assert('端点 t=duration 取末帧', Math.abs(p.arm.qz - 0.7071) < 0.001, p.arm);
p = sampleClip(clip, 5);
assert('越界 clamp 到末帧（不崩溃）', Math.abs(p.arm.qz - 0.7071) < 0.001, p.arm);
p = sampleClip(clip, -1);
assert('负时间 clamp 到首帧', p.arm.qw === 1, p.arm);

// ---- 2. slerp 插值正确性：0° ↔ 90°(绕z) 中点应≈45° ----
const c2 = { name:'t', duration:1, type:'once', bones:{ arm:{ q:[[0,0,0,0,1],[1,0,0,0.7071,0.7071]] } } };
p = sampleClip(c2, 0.5);
const angle = 2 * Math.acos(Math.min(1, Math.max(-1, p.arm.qw)));
assert('slerp 中点 ≈ 45°', Math.abs(angle - Math.PI/4) < 0.01, { angle, q: p.arm });
// ---- 2b. slerp 鲁棒性：近角 nlerp 归一化 / 负点积最短路径 / 阈值两侧（保持单位长度与正确转向） ----
{
  const tiny = 0.03; // 全角 ~1.7°，落在 cos>0.9995 的 nlerp 近似分支
  const c3 = { name:'t3', duration:1, type:'once', bones:{ arm:{ q:[[0,0,0,0,1],[1,0,0,Math.sin(tiny/2),Math.cos(tiny/2)]] } } };
  const s = sampleClip(c3, 0.5).arm;
  const len = Math.hypot(s.qx, s.qy, s.qz, s.qw);
  const half = Math.atan2(s.qz, s.qw);
  assert('接近旋转 nlerp 保持单位长度和正确转向', Math.abs(len - 1) < 1e-6 && half > 0, { len, half });
}
{
  // q 与 -q 同旋转：点积为负必须翻转取最短路径，中点仍 ≈45° 且单位长度
  const c4 = { name:'t4', duration:1, type:'once', bones:{ arm:{ q:[[0,0,0,0,1],[1,0,0,-0.7071,-0.7071]] } } };
  const s = sampleClip(c4, 0.5).arm;
  const len = Math.hypot(s.qx, s.qy, s.qz, s.qw);
  const ang = 2 * Math.acos(Math.min(1, Math.abs(s.qw)));
  assert('负点积等价四元数最短路径 保持单位长度和正确转向', Math.abs(ang - Math.PI/4) < 0.01 && Math.abs(len - 1) < 1e-4, { ang, len });
}
{
  const mkDeg = (deg) => { const h = deg * Math.PI / 360; return { name:'g'+deg, duration:1, type:'once', bones:{ arm:{ q:[[0,0,0,0,1],[1,0,0,Math.sin(h),Math.cos(h)]] } } }; };
  const near = sampleClip(mkDeg(1.4), 0.5).arm; // cos(0.7°)≈0.99993 > 0.9995 → nlerp 分支
  const far  = sampleClip(mkDeg(4),   0.5).arm; // cos(2°)≈0.99939 < 0.9995 → 一般 slerp 分支
  const lenN = Math.hypot(near.qx, near.qy, near.qz, near.qw), lenF = Math.hypot(far.qx, far.qy, far.qz, far.qw);
  const angN = 2 * Math.atan2(near.qz, near.qw), angF = 2 * Math.atan2(far.qz, far.qw);
  assert('一般 slerp 及近角度阈值 保持单位长度和正确转向',
    Math.abs(lenN - 1) < 1e-6 && Math.abs(angN - 0.7 * Math.PI / 180) < 0.01 &&
    Math.abs(lenF - 1) < 1e-4 && Math.abs(angF - 2 * Math.PI / 180) < 0.005, { lenN, angN, lenF, angF });
}

// ---- 3. 状态机：once 播完 → 回 idle ----
const eng = new PreviewEngine();
const idle = { name:'idle', duration:3, type:'loop', bones:{} };
const bow = { name:'bow', duration:1, type:'once', bones:{}};
eng.registerClip(idle); eng.registerClip(bow);
const applied = [];
eng.addCharacter({ name:'A', bones:{}, applyFn: (bn, pose)=>applied.push(bn), idleClip: idle });
const ch = eng.characters[0];
ch.playClip(bow, { loop:false });
// 推进 2 秒（每秒调 update，speed=1）
eng.playing = true; eng.lastTick = performance.now();
// 手动模拟推进：调用 ch.update
for (let i = 0; i < 120; i++) ch.update(1/60, 1, eng.events);
assert('once 播完后状态机回到 idle', ch.currentClip === idle && ch.loop === true, ch.currentClip?.name);
ch.stopToIdle();
assert('stopToIdle 幂等', ch.currentClip === idle);

// ---- 4. 链式：chainAt 到点产生事件 ----
const gA = { name:'gA', duration:1, type:'chain', chainNext:'gB', chainAt:0.8, bones:{} };
const gB = { name:'gB', duration:1, type:'once', bones:{} };
eng.registerClip(gA); eng.registerClip(gB);
const ch2 = eng.addCharacter({ name:'B', bones:{}, applyFn:()=>{}, idleClip: idle });
ch2.playClip(gA, {});
for (let i=0;i<60;i++) ch2.update(1/60, 1, eng.events);
assert('chainAt 触发事件（0.8s 后）', eng.events.some(e => e.kind==='chain' && e.to==='gB'), eng.events);

// ---- 5. 共享播放头 + 时间轴触发 ----
const eng2 = new PreviewEngine();
eng2.registerClip(idle); eng2.registerClip(bow);
eng2.addCharacter({ name:'A', bones:{}, applyFn:()=>{}, idleClip: idle });
eng2.setTimeline([{ char:'A', clipName:'bow', start:0, opts:{} }]);
let fired = [];
eng2.onEvent = e => fired.push(e);
eng2.playing = true; eng2.lastTick = performance.now() - 100;
eng2.update(performance.now()); // 推进 ~100ms → 应触发 start=0 的 clip
assert('时间轴 start=0 触发 clip', fired.some(e => e.kind==='clip' && e.clip==='bow'), fired);

// ---- 7. 拖动 seek 时间轴倒推（v0.2 核心） ----
{
  const e7 = new PreviewEngine();
  const idle7 = { name:'idle', duration:3, type:'loop', bones:{} };
  const dance7 = { name:'dance', duration:2.4, type:'loop', bones:{}};
  const bow7 = { name:'bow', duration:1.6, type:'once', bones:{} };
  const sal7 = { name:'salute', duration:1.9, type:'once', bones:{} };
  [idle7, dance7, bow7, sal7].forEach(c => e7.registerClip(c));
  const chA = e7.addCharacter({ name:'A', bones:{}, applyFn:()=>{}, idleClip: idle7 });
  const chB = e7.addCharacter({ name:'B', bones:{}, applyFn:()=>{}, idleClip: idle7 });
  e7.setTimeline([
    { char:'A', clipName:'dance', start:0, opts:{ loop:true } },
    { char:'B', clipName:'salute', start:2, opts:{} },
    { char:'A', clipName:'bow', start:4, opts:{} },
  ]);
  e7.scrubTo(5);
  assert('scrub(5s)：A 切到 bow（start=4）并定位 1.0s', chA.currentClip === bow7 && Math.abs(chA.clipTime - 1.0) < 1e-3, { clip: chA.currentClip?.name, t: chA.clipTime });
  assert('scrub(5s)：B 的 salute 超时定格末帧', chB.currentClip === sal7 && Math.abs(chB.clipTime - 1.899) < 1e-3, { clip: chB.currentClip?.name, t: chB.clipTime });
  e7.scrubTo(1);
  assert('scrub(1s)：A 回 dance 并定位 1.0s（循环取模）', chA.currentClip === dance7 && Math.abs(chA.clipTime - 1.0) < 1e-3);
  assert('scrub(1s)：B 无动作 → 回待机', chB.currentClip === idle7);
  e7.scrubTo(0.5);
  assert('scrub(0.5s)：A dance 定位 0.5s', Math.abs(chA.clipTime - 0.5) < 1e-3);
  e7.scrubTo(6.2);
  assert('scrub(6.2s)：A 的 bow 已超时 → 定格末帧（不回待机）', chA.currentClip === bow7 && Math.abs(chA.clipTime - 1.599) < 1e-3);
}

// ---- 8. 暂停（scrub）时采样仍应用（v0.2.1 回归修复） ----
{
  const e8 = new PreviewEngine();
  const idle8 = { name:'idle', duration:3, type:'loop', bones:{ arm:{ q:[[0,0,0,0,1],[1,0,0,0.7071,0.7071]] } } };
  e8.registerClip(idle8);
  let applied = 0; let lastQ = null;
  const ch8 = e8.addCharacter({ name:'A', bones:{ arm:{} }, applyFn:(bn, pose)=>{ applied++; lastQ = pose.qw; }, idleClip: idle8 });
  // scrubTo 无 timeline 时只设播放头；角色采样由 currentClip 驱动（下面直接对位）
  e8.scrubTo(0.5);
  ch8.clipTime = 0.5;
  e8.update(performance.now());
  assert('暂停时 update 仍采样应用骨骼', applied > 0, { applied });
  assert('采样值正确（idle 0.5s 插值）', lastQ != null && Math.abs(lastQ - Math.cos(0.3927)) < 0.05, { lastQ });
  ch8.clipTime = 1.5;
  e8.update(performance.now());
  assert('新位置后应用最新姿势', lastQ != null && lastQ < 0.95, { lastQ });
}

// ---- 9. 循环回卷混合（2026-08-28：接缝两端姿态有差时回卷要平滑，不硬跳） ----
{
  const e9 = new PreviewEngine();
  const idle9 = { name:'i9', duration:3, type:'loop', bones:{} };
  // 一条 1s 的 loop： qx 从 0 转到 0.9 —— 接缝两端姿态差很大（模拟剪裁残留接缝）
  const loop9 = { name:'L9', duration:1, type:'loop', bones:{ arm:{ q:[[0,0,0,0,1],[1,0.9,0,0,0.43589]], t:null } } };
  e9.registerClip(loop9);
  const ch9 = e9.addCharacter({ name:'A', bones:{ arm:{} }, applyFn:()=>{}, idleClip: idle9 });
  ch9.playClip(loop9, { loop:true });
  for (let i=0;i<66;i++) ch9.update(1/60, 1, []);          // 推进 1.1s → 越过回卷点
  assert('回卷后 clipTime 取模回绕', ch9.clipTime < 0.2 && ch9.currentClip === loop9, { t: ch9.clipTime });
  assert('回卷捕获混合起点（末端姿态）', ch9.blendFrom != null && Math.abs(ch9.blendFrom.arm.qx - 0.9) < 0.01, ch9.blendFrom && ch9.blendFrom.arm);
  const p0 = ch9.sample();
  // v0.6.6 语义修正：blendT 跟真实 dt 走（不再靠 sample() 调用次数推进）——
  // 66 帧里回卷发生在第 60 帧，此后已过 0.1s（f≈1/3），混合中姿态应明显贴近
  // 末端(≈0.9)而不是硬跳到新一周真实值(≈0.11)
  assert('接缝后无硬跳（回卷后 0.1s 仍贴近末端姿态）', p0.arm && p0.arm.qx > 0.55 && p0.arm.qx < 0.9, p0.arm);
  for (let i=0;i<40;i++) { ch9.update(1/60, 1, []); ch9.sample(); }  // 走完 0.3s 混合窗
  // clipTime≈0.767 时 clip 的 slerp 姿态 qx≈0.757；混合结束后必须回到真实姿态而不是停在接缝姿态
  const p1 = ch9.sample();
  assert('混合结束后回到真实姿态', p1.arm && p1.arm.qx < 0.82, p1.arm);
}

// ---- 6. 变速 ----
const eng3 = new PreviewEngine();
eng3.setSpeed(2);
assert('setSpeed clamp 上限', eng3.speed === 2);
eng3.setSpeed(99);
assert('setSpeed 超界 clamp', eng3.speed === 4);
eng3.setSpeed(0.01);
assert('setSpeed 下限 clamp', eng3.speed === 0.1);

// ---- 10. scrubTo 主页真实路径的 loop 接缝混合（v0.6.6）----
// 背景：主页 preview3d.js 每帧 store.currentTime → scrubTo()，不走 Character.update()
// 的内部回卷；修复前 scrubTo 对 loop 直接取模并清 blendFrom，接缝是硬跳（离线复现
// qx 跳变 ~0.898）。本节盯四件事：接缝混合建立、默认拖动语义不变、帧率无关、单位四元数。
{
  const e10 = new PreviewEngine();
  const idle10 = { name:'i10', duration:3, type:'loop', bones:{} };
  // 1s loop：qx 0→0.9，接缝两端姿态差大（数据形状同第 9 节；slerp 下 qx(t)=sin(ωt)，ω≈1.1198）
  const loop10 = { name:'L10', duration:1, type:'loop', bones:{ arm:{ q:[[0,0,0,0,1],[1,0.9,0,0,0.43589]] } } };
  e10.registerClip(idle10); e10.registerClip(loop10);
  let lastPose = null;
  const ch10 = e10.addCharacter({ name:'A', bones:{ arm:{} }, applyFn:(bn,pose)=>{ lastPose=pose; }, idleClip: idle10 });
  e10.setTimeline([{ char:'A', clipName:'L10', start:0, opts:{ loop:true } }]);

  // (1) 默认参数（拖动语义）：跨接缝仍精确取模、不建混合
  e10.scrubTo(0.999);
  const before = ch10.sample().arm.qx;                    // 第一周末端 ≈0.899
  e10.scrubTo(1.001);
  const after = ch10.sample().arm.qx;                     // 精确取模 → 新一周起点 ≈0.001
  assert('scrubTo 默认：精确取模不建混合（拖动语义未偷改）',
    ch10.blendFrom == null && Math.abs(ch10.clipTime - 0.001) < 1e-6 && Math.abs(after - 0.0012) < 0.01 && (before - after) > 0.8,
    { t: ch10.clipTime, blend: ch10.blendFrom != null, before, after });

  // (2) blendLoopSeams：0.999 → 1.001 接缝建立混合、首帧无硬跳
  e10.scrubTo(0.999, { blendLoopSeams: true });
  const s0 = ch10.sample().arm.qx;                        // 第一周（inClip<dur）不混合 ≈0.899
  e10.scrubTo(1.001, { blendLoopSeams: true });
  assert('接缝后建立混合（blendFrom=末帧，blendT=phase）',
    ch10.blendFrom != null && Math.abs(ch10.blendFrom.arm.qx - 0.9) < 0.01 && Math.abs(ch10.blendT - 0.001) < 1e-6,
    { blendT: ch10.blendT });
  const s1 = ch10.sample().arm.qx;                        // f≈0.003 → 仍停在末端姿态附近
  assert('接缝后首帧无硬跳（不再是 0.898 级跳变）', Math.abs(s1 - 0.9) < 0.05 && Math.abs(s1 - s0) < 0.05, { s0, s1 });

  // (3) 混合中点：phase=0.15 → 姿态介于末端(≈0.899)与新一周同刻(≈0.167)之间
  e10.scrubTo(1.15, { blendLoopSeams: true });
  const mid = ch10.sample().arm.qx;
  assert('混合中点姿态介于接缝两端之间', mid > 0.4 && mid < 0.85, { mid });

  // (4) 混合窗（0.3s）过后清除，回到新一周真实姿态
  e10.scrubTo(1.4, { blendLoopSeams: true });
  const real = ch10.sample().arm.qx;                      // 0.4s 处 qx=sin(ω·0.4)≈0.433
  assert('混合窗过后清除并回到真实姿态', ch10.blendFrom == null && Math.abs(real - 0.433) < 0.01, { real });

  // (5) 混合输出四元数模长 ≈ 1（slerp+归一化，防骨骼隐性缩放/扭曲）
  e10.scrubTo(1.05, { blendLoopSeams: true });
  const pq = ch10.sample().arm;
  const nq = Math.hypot(pq.qx, pq.qy, pq.qz, pq.qw);
  assert('混合四元数保持单位长度', Math.abs(nq - 1) < 1e-9, { nq });

  // (6) sample() 纯度：同一状态连调 144 次结果不变（回归旧 bug：blendT 曾在 sample 里 +=1/60）
  const first = ch10.sample().arm.qx;
  const t0 = ch10.blendT;
  let stable = true;
  for (let i = 0; i < 144; i++) {
    const v = ch10.sample().arm.qx;
    if (Math.abs(v - first) > 1e-12 || ch10.blendT !== t0) { stable = false; break; }
  }
  assert('sample() 纯函数：重复调用结果与状态都不变', stable, { first, blendT: ch10.blendT });

  // (7) 内部路径混合推进帧率无关：手工播种回卷混合态，同一总时长用 30/60/144 步推进结果一致
  function blendMidQx(nSteps) {
    const e = new PreviewEngine();
    e.registerClip(idle10); e.registerClip(loop10);
    const c = e.addCharacter({ name:'A', bones:{ arm:{} }, applyFn:()=>{}, idleClip: idle10 });
    c.playClip(loop10, { loop:true });
    c.clipTime = 0;                                       // 摆出“回卷刚发生”的状态
    c.blendFrom = sampleClip(loop10, loop10.duration - 1e-3);
    c.blendT = 0;
    const dt = 0.15 / nSteps;                             // 总推进 0.15s = 混合中点
    for (let i = 0; i < nSteps; i++) c.update(dt, 1, []);
    return c.sample().arm.qx;
  }
  const q30 = blendMidQx(30), q60 = blendMidQx(60), q144 = blendMidQx(144);
  assert('混合推进帧率无关（30/60/144 步一致）',
    Math.abs(q30 - q60) < 1e-9 && Math.abs(q60 - q144) < 1e-9, { q30, q60, q144 });
  assert('dt 累计混合与 scrubTo 确定性混合殊途同归（同为 f=0.5）', Math.abs(q30 - mid) < 1e-9, { q30, mid });

  // (8) 主页真实调用链：scrubTo(带混合) → engine.update(暂停路径) 也能采样应用
  e10.scrubTo(1.05, { blendLoopSeams: true });
  e10.lastTick = performance.now() - 16;
  e10.update(performance.now());                          // !playing：advanceBlend(dt)+sample+applyFn
  const appliedQ = lastPose && lastPose.qx;
  assert('scrubTo+update 集成链路把混合姿态写到骨骼', appliedQ != null && appliedQ > 0.7 && appliedQ < 0.85, { appliedQ });
}

// ---- 11. AUD-018：按角色索引 + scrubTo 二分查找（OPT-2） ----
// 语义必须与旧的全表线性扫描逐字等价；复杂度从 O(D·N) 降到 O(D·logN)
(function () {
  const idleE = { name: 'idle', duration: 2, type: 'loop', bones: {} };
  function mkClip(n) { return { name: n, duration: 1, type: 'once', bones: {} }; }
  function buildEngine(nPer, nChars, opts) {
    const e = new PreviewEngine();
    e.registerClip(idleE);
    const names = [];
    for (let k = 0; k < nPer; k++) { const n = 'c' + k; names.push(n); e.registerClip(mkClip(n)); }
    const entries = [];
    for (let ci = 0; ci < nChars; ci++) {
      for (let k = 0; k < nPer; k++) {
        const start = Math.round((k + ((opts && opts.jitter) ? ((k * 7919) % 13) / 20 : 0)) * 10) / 10;
        entries.push({ char: 'd' + ci, clipName: names[k], start, opts: {} });
      }
    }
    for (let ci = 0; ci < nChars; ci++) {
      e.addCharacter({ name: 'd' + ci, bones: {}, applyFn: () => {}, idleClip: idleE });
    }
    e.timeline = entries;   // 走访问器（preview3d 同款路径）
    return { e, entries };
  }
  // 旧实现的暴力参考：每个角色线性扫全表取"start<=t 的最后一条"
  function refState(entries, charName, t, lib, idle) {
    let active = null;
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      if (en.char !== charName || en.start > t) continue;
      active = en;
    }
    if (!active) return { idle: true, clipTime: t % Math.max(idle.duration, 1e-3) };
    const clip = lib[active.clipName];
    const inClip = t - active.start;
    return {
      idle: false, clipName: active.clipName,
      clipTime: Math.min(inClip, Math.max(clip.duration - 1e-3, 0)),
    };
  }

  // (1) 随机时刻 scrubTo 与暴力参考逐字等价（3 角色 × 300 条，含同 start 并列）
  {
    const { e, entries } = buildEngine(300, 3, { jitter: true });
    let same = true, bad = null;
    for (let i = 0; i < 200; i++) {
      const t = Math.round((i * 137.501 % 320) * 10) / 10;
      e.scrubTo(t);
      for (const c of e.characters) {
        const ref = refState(entries, c.name, t, e.clipLibrary, idleE);
        const gotIdle = c.currentClip === c.idleClip;
        if (ref.idle !== gotIdle ||
            (!ref.idle && (c.currentClip.name !== ref.clipName ||
              Math.abs(c.clipTime - ref.clipTime) > 1e-9))) { same = false; bad = { t, char: c.name, ref, got: c.currentClip && c.currentClip.name, clipTime: c.clipTime }; break; }
      }
      if (!same) break;
    }
    assert('scrubTo 二分与旧线性扫描逐字等价（200 个随机时刻 × 3 角色）', same, bad);
  }

  // (2) 复杂度：3 角色 × 1000 条，单次 scrubTo 二分比较次数 ≤ D·⌈log2(N+1)⌉（≈30，线性是 3000）
  {
    const { e } = buildEngine(1000, 3);
    e.scrubTo(137.5);
    const cap = 3 * Math.ceil(Math.log2(1001));
    assert('scrubTo 二分探测次数 ≤ D·⌈log2(N+1)⌉', e._scrubProbes > 0 && e._scrubProbes <= cap,
      { probes: e._scrubProbes, cap });
    // 同一角色并列 start：取排序靠后那条（与旧实现"一直覆盖"一致）
    const eT = new PreviewEngine();
    const i1 = { name: 'a', duration: 5, type: 'once', bones: {} };
    const i2 = { name: 'b', duration: 5, type: 'once', bones: {} };
    eT.registerClip(i1); eT.registerClip(i2);
    eT.addCharacter({ name: 'd', bones: {}, applyFn: () => {}, idleClip: i1 });
    eT.timeline = [{ char: 'd', clipName: 'a', start: 1, opts: {} },
                   { char: 'd', clipName: 'b', start: 1, opts: {} }];
    eT.scrubTo(2);
    assert('同角色同 start 并列条目取排序靠后者', eT.characters[0].currentClip === i2,
      eT.characters[0].currentClip && eT.characters[0].currentClip.name);
  }

  // (3) 基准：3 舞者 × 1000 事件，600 帧连续 scrubTo（宽上限防退化，主要留耗时数字）
  {
    const { e } = buildEngine(1000, 3);
    const t0 = Date.now();
    for (let f = 0; f < 600; f++) e.scrubTo((f * 0.5) % 900);
    const ms = Date.now() - t0;
    assert('基准：600 帧 × 3000 条 scrubTo < 500ms', ms < 500, { ms });
    console.log('  （基准耗时：600 帧 scrubTo =', ms, 'ms）');
  }

  // (4) 播放中替换 timeline：timelineIdx 对齐播放头，旧条目不重放（onEvent 不补发）
  {
    const e = new PreviewEngine();
    const idleX = { name: 'idle', duration: 3, type: 'loop', bones: {} };
    const aX = { name: 'a', duration: 2, type: 'once', bones: {} };
    const bX = { name: 'b', duration: 2, type: 'once', bones: {} };
    e.registerClip(idleX); e.registerClip(aX); e.registerClip(bX);
    e.addCharacter({ name: 'd', bones: {}, applyFn: () => {}, idleClip: idleX });
    const evs = [];
    e.onEvent = (ev) => { if (ev.kind === 'clip') evs.push(ev.clip); };
    e.setTimeline([{ char: 'd', clipName: 'a', start: 0, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} }]);
    e.play();
    e.update(16);                       // t≈0.016 → 触发 a
    e.update(1000);                     // 推到 t≈1.016（远未到 3）
    evs.length = 0;
    e.timeline = [{ char: 'd', clipName: 'a', start: 0, opts: {} },   // 重排（preview3d 同款赋值）
                  { char: 'd', clipName: 'b', start: 3, opts: {} }];
    e.update(16);                       // 只推进 16ms，不该重放 a 或提前触发 b
    assert('播放中替换 timeline 不重放旧条目、不提前触发后续', evs.length === 0 &&
      e.characters[0].currentClip === aX, { evs, cur: e.characters[0].currentClip.name });
  }
})();

// ---- 12. ENGINE-CURSOR：timelineIdx 游标不变量 ----
// 不变量：timelineIdx 恒为"当前引擎时刻第一条尚未触发的条目"下标——
// start < t 的已随播放头过去，start == t 的仍待触发（与 update 的 time >= start 触发条件一致）。
// 任何改播放头的路径（scrubTo/seek/setTimeline/timeline 替换）都必须按正确顺序重新对齐。
(function () {
  const idleM = { name: 'idle', duration: 3, type: 'loop', bones: {} };
  function mkLong(n) { return { name: n, duration: 10, type: 'once', bones: {} }; }
  function newEngine() {
    const e = new PreviewEngine();
    e.registerClip(idleM);
    return e;
  }
  function addDancer(e) { return e.addCharacter({ name: 'd', bones: {}, applyFn: () => {}, idleClip: idleM }); }
  // 每步恒定推进 0.1s（先播种 lastTick，再 update）
  function step(e, n) {
    for (let i = 0; i < n; i++) { e.lastTick = performance.now() - 100; e.update(performance.now()); }
  }
  // 测试侧参考实现：线性找第一条 start >= t（= -1 视为末尾）
  function refIdx(list, t) {
    const i = list.findIndex(en => en.start >= t);
    return i === -1 ? list.length : i;
  }

  // (1) ENGINE-1 前向 scrub→play：已过条目不重放、clipTime 不被归零
  {
    const e = newEngine();
    const aC = mkLong('a'); const bC = mkLong('b');
    e.registerClip(aC); e.registerClip(bC);
    const chD = addDancer(e);
    const evs = [];
    e.onEvent = (ev) => { if (ev.kind === 'clip') evs.push(ev.clip); };
    e.setTimeline([{ char: 'd', clipName: 'a', start: 1, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} }]);
    e.scrubTo(2);                       // a(start=1) 已过、b(start=3) 未到
    e.play();
    step(e, 3);                         // t≈2.3
    assert('ENGINE-1 scrub→play：已过条目不重放（无事件、clipTime 接续不归零）',
      evs.length === 0 && Math.abs(chD.clipTime - 1.3) < 0.05,
      { evs, t: e.time, clipTime: chD.clipTime });
  }

  // (2) ENGINE-1 回拖 scrub→play：回拖后跨过 start 的条目要重新触发（恰一次）
  {
    const e = newEngine();
    const aC = mkLong('a'); const bC = mkLong('b');
    e.registerClip(aC); e.registerClip(bC);
    addDancer(e);
    const evs = [];
    e.onEvent = (ev) => { if (ev.kind === 'clip') evs.push(ev.clip); };
    e.setTimeline([{ char: 'd', clipName: 'a', start: 1, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} }]);
    e.play();
    step(e, 32);                        // t≈3.2：a、b 都已触发，idx=2
    e.scrubTo(0.5);                     // 回拖到 a 之前
    assert('回拖后游标对齐不变量（idx=0）', e.timelineIdx === 0, { idx: e.timelineIdx, t: e.time });
    evs.length = 0;
    step(e, 8);                         // t≈1.3：跨过 start=1，a 应恰好触发一次
    assert('ENGINE-1 回拖→play：跨过 start 后 a 恰好触发一次',
      JSON.stringify(evs) === JSON.stringify(['a']), { evs, t: e.time });
  }

  // (3) ENGINE-2 setTimeline：先清播放头再对齐（复现交接观察到的 time=0 而 idx=2）
  {
    const e = newEngine();
    const aC = mkLong('a'); const bC = mkLong('b');
    e.registerClip(aC); e.registerClip(bC);
    addDancer(e);
    e.setTimeline([{ char: 'd', clipName: 'a', start: 0, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} }]);
    e.play();
    step(e, 3);
    e.pause();
    e.time = 2;                         // 播放头停在 2s（旧时刻，任何 ≥2 的值都复现）
    e.setTimeline([{ char: 'd', clipName: 'a', start: 0, opts: {} },
                   { char: 'd', clipName: 'b', start: 1, opts: {} },
                   { char: 'd', clipName: 'a', start: 2, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} }]);
    assert('ENGINE-2 setTimeline 后 time=0 且游标归零（旧实现留下 idx=2）',
      e.time === 0 && e.timelineIdx === 0, { time: e.time, idx: e.timelineIdx });
  }

  // (4) 混合序列 scrub → setTimeline → play/update：新轴从头按序各触发一次
  {
    const e = newEngine();
    const xC = mkLong('x'); const yC = mkLong('y');
    e.registerClip(xC); e.registerClip(yC);
    addDancer(e);
    const evs = [];
    e.onEvent = (ev) => { if (ev.kind === 'clip') evs.push(ev.clip); };
    e.setTimeline([{ char: 'd', clipName: 'x', start: 1, opts: {} },
                   { char: 'd', clipName: 'x', start: 3, opts: {} },
                   { char: 'd', clipName: 'y', start: 5, opts: {} },
                   { char: 'd', clipName: 'x', start: 7, opts: {} }]);
    e.scrubTo(5);                       // 游标应停在 y@5（待触发）
    assert('scrub 后游标对齐（idx=2，y@5 待触发）', e.timelineIdx === 2, { idx: e.timelineIdx });
    e.setTimeline([{ char: 'd', clipName: 'x', start: 0, opts: {} },
                   { char: 'd', clipName: 'y', start: 2, opts: {} }]);
    e.play();
    step(e, 25);                        // t≈2.5：x@0、y@2 各触发一次
    assert('混合 scrub→setTimeline→play：新轴从头按序各触发一次',
      JSON.stringify(evs) === JSON.stringify(['x', 'y']), { evs, idx: e.timelineIdx, t: e.time });
  }

  // (5) 不变量属性检查：scrubTo/seek 任意时刻（含并列 start、越界）游标恒对齐
  {
    const e = newEngine();
    const aC = mkLong('a'); const bC = mkLong('b'); const cC = mkLong('c');
    e.registerClip(aC); e.registerClip(bC); e.registerClip(cC);
    addDancer(e);
    e.setTimeline([{ char: 'd', clipName: 'a', start: 1, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} },
                   { char: 'd', clipName: 'b', start: 3, opts: {} },
                   { char: 'd', clipName: 'c', start: 5, opts: {} }]);
    let bad = null;
    for (const t of [0, 0.5, 1, 1.5, 3, 3.5, 4.999, 5, 5.001, 7, 100]) {
      e.scrubTo(t);
      if (e.timelineIdx !== refIdx(e.timeline, e.time)) { bad = { via: 'scrubTo', t, idx: e.timelineIdx, want: refIdx(e.timeline, e.time) }; break; }
      e.seek(t + 0.25);                 // seek 是同一条不变量
      if (e.timelineIdx !== refIdx(e.timeline, e.time)) { bad = { via: 'seek', t, idx: e.timelineIdx, want: refIdx(e.timeline, e.time) }; break; }
    }
    assert('不变量：scrub/seek 后 timelineIdx 恒为第一条未触发条目（含并列 start/越界）', !bad, bad);
  }
})();

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);