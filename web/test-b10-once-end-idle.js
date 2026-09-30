// B10-ONCE-END-IDLE 单测（node 直接跑：node test-b10-once-end-idle.js）
// 覆盖：主页 3D 预览「一次性动作播完回待机」——scrubTo 新可选语义 onceToIdle：
// once 超过动画自身时长（intro+循环段）→ 回待机（BLEND 0.3s 末帧混合）；loop 片段
// 与 opts.loop 条目保持循环；默认（未传选项）保持「定格末帧」既有语义零变化。
// B10_SOURCE 指向 before 目录时可对旧引擎字节重放（红证复核用）。
'use strict';
const path = require('path');
const srcDir = process.env.B10_SOURCE || __dirname;
require(path.join(srcDir, 'choreo-engine.js'));
const { PreviewEngine } = globalThis.ChoreoEngine;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, detail != null ? JSON.stringify(detail) : ''); }
}
// 角度帮助：四元数 → 绕 z 旋转角（度）
function zDeg(q) { return 2 * Math.atan2(q.qz, q.qw) * 180 / Math.PI; }
const near = (a, b, eps) => Math.abs(a - b) < eps;

// 常量姿态：bow 全程 Rz(90°)（末帧＝全程）；idle 全程单位四元数
const RZ90 = [0, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
const IDENT = [0, 0, 0, 0, 1];

// ---- 场景一：bow 1.6s once @2s（属主复现场景）----
{
  const e = new PreviewEngine();
  const idle = { name: '__idle__', duration: 3, type: 'loop', bones: { arm: { q: [[0].concat(IDENT.slice(1)), [3].concat(IDENT.slice(1))] } } };
  const bow = { name: 'bow', duration: 1.6, type: 'once', bones: { arm: { q: [[0].concat(RZ90.slice(1)), [1.6].concat(RZ90.slice(1))] } } };
  e.registerClip(idle); e.registerClip(bow);
  const ch = e.addCharacter({ name: 'A', bones: { arm: {} }, applyFn: () => {}, idleClip: idle });
  e.setTimeline([{ char: 'A', clipName: 'bow', start: 2, opts: {} }]);

  // 1-2 默认语义零变化（未传选项＝定格末帧、不混合）
  e.scrubTo(9.9);
  assert('B10-1 默认：once 超时定格末帧（不回待机、不混合）',
    ch.currentClip === bow && near(ch.clipTime, 1.599, 1e-3) && ch.blendFrom === null,
    { clip: ch.currentClip && ch.currentClip.name, t: ch.clipTime });
  assert('B10-2 默认：采样＝末帧姿态（90°）', near(zDeg(ch.sample().arm), 90, 1), zDeg(ch.sample().arm));

  // 3 新语义：未播完不回待机
  e.scrubTo(3.0, { onceToIdle: true });
  assert('B10-3 新语义：播完前仍在动作中（clipTime 精确对位）',
    ch.currentClip === bow && near(ch.clipTime, 1.0, 1e-6) && ch.blendFrom === null && ch.state === 'playing',
    { clip: ch.currentClip && ch.currentClip.name, t: ch.clipTime, state: ch.state });

  // 4-5 新语义：播完进行中混合（over=0.1 < BLEND 0.3）
  e.scrubTo(3.7, { onceToIdle: true });
  assert('B10-4 新语义：播完回待机（末帧混合进行中）',
    ch.currentClip === idle && ch.blendFrom !== null && near(ch.blendT, 0.1, 1e-6) &&
    ch.state === 'blending' && ch.loop === true && near(ch.clipTime, 0.7, 1e-6),
    { clip: ch.currentClip && ch.currentClip.name, blendT: ch.blendT, state: ch.state, t: ch.clipTime });
  assert('B10-5 新语义：混合姿态数值（f=1/3 → 60°）', near(zDeg(ch.sample().arm), 60, 1.5), zDeg(ch.sample().arm));

  // 6 新语义：播完远超＝纯待机（混合已结束）
  e.scrubTo(6.0, { onceToIdle: true });
  assert('B10-6 新语义：远超结束点＝纯待机（无混合、姿态=idle）',
    ch.currentClip === idle && ch.blendFrom === null && ch.state === 'idle' && near(zDeg(ch.sample().arm), 0, 1),
    { clip: ch.currentClip && ch.currentClip.name, state: ch.state, deg: zDeg(ch.sample().arm) });

  // 7 跨越结束点不闪跳：over=0.03 → f=0.1 → 81°（连续，非硬跳到 idle）
  e.scrubTo(3.63, { onceToIdle: true });
  assert('B10-7 跨结束点无闪跳（over=0.03 → 81°±2）', near(zDeg(ch.sample().arm), 81, 2), zDeg(ch.sample().arm));

  // 8 拖回片段之前仍回待机（既有无活跃分支保持；state 可处 blending＝
  //   既有 stopToIdle/末帧混合类行为，判据＝currentClip 回到 idle）
  e.scrubTo(1.0, { onceToIdle: true });
  assert('B10-8 拖回片段之前＝回待机', ch.currentClip === idle && ch.loop === true,
    { clip: ch.currentClip && ch.currentClip.name });

  // 9 从待机拖回片段中恢复动作
  e.scrubTo(3.2, { onceToIdle: true });
  assert('B10-9 拖回片段中＝恢复动作且无残留混合',
    ch.currentClip === bow && near(ch.clipTime, 1.2, 1e-6) && ch.blendFrom === null,
    { clip: ch.currentClip && ch.currentClip.name, t: ch.clipTime });
}

// ---- 场景二：下一动作接管＋loop 保持＋双选项正交 ----
{
  const e2 = new PreviewEngine();
  const idle2 = { name: 'i2', duration: 3, type: 'loop', bones: {} };
  const bow2 = { name: 'bow2', duration: 1.6, type: 'once', bones: {} };
  const salute = { name: 'salute', duration: 1.9, type: 'once', bones: {} };
  const danceOnce = { name: 'danceO', duration: 2.4, type: 'once', bones: {} };
  const danceLoop = { name: 'danceL', duration: 2.4, type: 'loop', bones: {} };
  [idle2, bow2, salute, danceOnce, danceLoop].forEach(c => e2.registerClip(c));
  const chA = e2.addCharacter({ name: 'A', bones: {}, applyFn: () => {}, idleClip: idle2 });
  const chB = e2.addCharacter({ name: 'B', bones: {}, applyFn: () => {}, idleClip: idle2 });
  const chC = e2.addCharacter({ name: 'C', bones: {}, applyFn: () => {}, idleClip: idle2 });
  e2.setTimeline([
    { char: 'A', clipName: 'bow2', start: 2, opts: {} },
    { char: 'A', clipName: 'salute', start: 6, opts: {} },
    { char: 'B', clipName: 'danceO', start: 0, opts: { loop: true } },
    { char: 'C', clipName: 'danceL', start: 0, opts: {} },
  ]);

  // 10 下一动作到点正常接管
  e2.scrubTo(6.5, { onceToIdle: true });
  assert('B10-10 下一动作到点接管（salute@6 → clipTime 0.5）',
    chA.currentClip === salute && near(chA.clipTime, 0.5, 1e-6) && chA.state === 'playing',
    { clip: chA.currentClip && chA.currentClip.name, t: chA.clipTime });

  // 11-12 opts.loop 条目与 type loop 剪辑都保持循环（新语义开启也不回待机）
  e2.scrubTo(13, { onceToIdle: true });
  assert('B10-11 opts.loop 条目保持循环（13s → 相位 1.0s）',
    chB.currentClip === danceOnce && near(chB.clipTime, 1.0, 1e-6) && chB.loop === true && chB.blendFrom === null,
    { clip: chB.currentClip && chB.currentClip.name, t: chB.clipTime });
  assert('B10-12 type loop 剪辑保持循环（13s → 相位 1.0s）',
    chC.currentClip === danceLoop && near(chC.clipTime, 1.0, 1e-6) && chC.loop === true,
    { clip: chC.currentClip && chC.currentClip.name, t: chC.clipTime });

  // 13 blendLoopSeams 与 onceToIdle 正交（loop 第二周接缝混合仍工作）
  e2.scrubTo(12.05, { onceToIdle: true, blendLoopSeams: true });
  assert('B10-13 blendLoopSeams 与 onceToIdle 正交（接缝混合在场）',
    chC.blendFrom !== null && near(chC.blendT, 0.05, 1e-6),
    { blendT: chC.blendT });
}

// ---- 场景三：以动画自身时长（clip.duration）为「做完」判据 ----
// 引擎 validateScaleChannels 规定 intro 起始段只允许 loop 剪辑（once 不可能带 intro），
// 故 once 的动画自身时长＝clip.duration；条目/动作库声明时长不进 scrubTo 判定。
{
  const e3 = new PreviewEngine();
  const idle3 = { name: 'i3', duration: 3, type: 'loop', bones: {} };
  const bow3 = { name: 'bow3', duration: 1.6, type: 'once', bones: {} };
  const long3 = { name: 'long3', duration: 1.9, type: 'once', bones: {} };
  e3.registerClip(idle3); e3.registerClip(bow3); e3.registerClip(long3);
  const chS = e3.addCharacter({ name: 'S', bones: {}, applyFn: () => {}, idleClip: idle3 });
  const chL = e3.addCharacter({ name: 'L', bones: {}, applyFn: () => {}, idleClip: idle3 });
  e3.setTimeline([
    { char: 'S', clipName: 'bow3', start: 1, opts: {} },
    { char: 'L', clipName: 'long3', start: 1, opts: {} },
  ]);

  // 14 各按自身动画时长判定：1.6s 的已完回待机，1.9s 的仍在动作中
  e3.scrubTo(2.7, { onceToIdle: true });
  assert('B10-14 动画自身时长判据：bow(1.6s) 完→待机、long(1.9s) 未完→播放',
    chS.currentClip === idle3 && chS.state === 'blending' &&
    chL.currentClip === long3 && chL.state === 'playing',
    { s: chS.currentClip && chS.currentClip.name, l: chL.currentClip && chL.currentClip.name });

  // 15 精确边界：inClip＝duration 即视为做完（over=0 → 混合刚启动）
  e3.scrubTo(2.6, { onceToIdle: true });
  assert('B10-15 精确边界：t=start+duration 即回待机（blendT≈0）',
    chS.currentClip === idle3 && chS.blendFrom !== null && Math.abs(chS.blendT) < 1e-9 && chS.state === 'blending',
    { clip: chS.currentClip && chS.currentClip.name, blendT: chS.blendT });

  // 16 属主原场景：条目后面再无动作，拖到 30s 也不定格在动作里
  e3.scrubTo(30, { onceToIdle: true });
  assert('B10-16 播完很久后（30s）＝纯待机（不定格动作末帧）',
    chS.currentClip === idle3 && chS.blendFrom === null && chS.state === 'idle' &&
    chL.currentClip === idle3 && chL.state === 'idle',
    { s: chS.currentClip && chS.currentClip.name, l: chL.currentClip && chL.currentClip.name });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
