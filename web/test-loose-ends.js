// TASK-20260924-LOOSE-ENDS node 单测（node web/test-loose-ends.js）：
// L1＝旧数字标记 id 归一位置无关化（choreo-document.js normalize/buildDocFromContent 两处：
// 数值 id → 'mk-<原数字>'，缺 id 仍按数组序 mk-<i>，字符串 id/去重顺序/round-trip 零改动）；
// L3＝scrubTo once 分支「动画自身时长」统一 animDur=intro.duration(若有)+clip.duration
// （onceToIdle 判据/over/末帧采样/定格 clamp；现网 once+intro 经 registerClip 不可达，
// 测试用直接写 engine.clipLibrary 的注入方式＝防御性钉住）。loop 分支、无 intro once 行为、
// validateScaleChannels（once+intro 注册即拒）、Character.update（intro 回卷 loop-only）逐项钉住不动。
// LOOSE_ENDS_SOURCE=<before 目录> 时对 document/engine 旧字节红回放（红证复核用）。
'use strict';
const path = require('path');
const srcDir = process.env.LOOSE_ENDS_SOURCE || __dirname;
require(path.join(srcDir, 'choreo-document.js'));
require(path.join(srcDir, 'choreo-engine.js'));
const CD = globalThis.ChoreoDocument;
const { PreviewEngine, validateScaleChannels } = globalThis.ChoreoEngine;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, detail != null ? JSON.stringify(detail) : ''); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
const near = (a, b, eps) => Math.abs(a - b) < eps;
function zDeg(q) { return 2 * Math.atan2(q.qz, q.qw) * 180 / Math.PI; } // 四元数 → 绕 z 角（度）

// ---------- L1：旧数字标记 id 归一位置无关化 ----------
{
  console.log('== L1 旧数字标记 id 归一（choreo-document.js 两处） ==');

  // L1-1 数字 id 21 在位置 0 → mk-21（O-5 登记项：改前=mk-0 位置相关）
  assert('L1-1 normalize：数字 id 21 在位置 0 → mk-21',
    CD.normalize({ markers: [{ id: 21, tMs: 11000, name: '老' }] }, []).markers[0].id === 'mk-21');

  // L1-2 位置无关：21 在位置 1（前面垫一条缺 id 的）仍是 mk-21；缺 id 仍按数组序 mk-0
  const m2 = CD.normalize({ markers: [{ tMs: 1000, name: '甲' }, { id: 21, tMs: 11000, name: '老' }] }, []).markers;
  assert('L1-2 normalize：数字 21 在位置 1 仍 mk-21；缺 id 位置 0 仍 mk-0',
    m2[0].id === 'mk-0' && m2[1].id === 'mk-21', m2.map(m => m.id));

  // L1-3 任意删改序后同一旧数字仍派生同一 id（B7b 复制/粘贴场景的稳定锚）
  const a3 = CD.normalize({ markers: [{ id: 7, tMs: 1, name: 'x' }, { id: 21, tMs: 2, name: 'y' }, { id: 99, tMs: 3, name: 'z' }] }, []).markers;
  const b3 = CD.normalize({ markers: [{ id: 99, tMs: 3, name: 'z' }, { id: 21, tMs: 2, name: 'y' }] }, []).markers;
  assert('L1-3 位置无关：删去首条后 21/99 派生不变',
    a3.map(m => m.id).join(',') === 'mk-7,mk-21,mk-99' && b3.map(m => m.id).join(',') === 'mk-99,mk-21',
    { a: a3.map(m => m.id), b: b3.map(m => m.id) });

  // L1-4 混合（数字/字符串/缺 id/小数数字）确定性；小数按 String() 原样
  const m4 = CD.normalize({ markers: [{ id: 21, tMs: 1, name: 'a' }, { id: 'mabc', tMs: 2, name: 'b' }, { tMs: 3, name: 'c' }, { id: 2.5, tMs: 4, name: 'd' }] }, []).markers;
  assert('L1-4 混合确定性：数字→mk-21 / 字符串保号 / 缺 id→mk-2 / 小数→mk-2.5',
    m4.map(m => m.id).join(',') === 'mk-21,mabc,mk-2,mk-2.5', m4.map(m => m.id));

  // L1-5 重号数字仍经 uniqueId 确定性去重（mk-21、mk-21-2）
  const m5 = CD.normalize({ markers: [{ id: 21, tMs: 1, name: 'a' }, { id: 21, tMs: 2, name: 'b' }] }, []).markers;
  assert('L1-5 重号数字 → mk-21,mk-21-2（去重顺序不变）',
    m5.map(m => m.id).join(',') === 'mk-21,mk-21-2', m5.map(m => m.id));

  // L1-6 幂等：归一两遍 serialize 字节一致（数字已变字符串，第二遍走字符串分支）
  const d6 = { markers: [{ id: 21, tMs: 1, name: 'a' }] };
  assert('L1-6 归一两遍幂等（serialize 字节一致）',
    CD.serialize(CD.normalize(d6, [])) === CD.serialize(CD.normalize(CD.normalize(d6, []), [])));

  // L1-7 buildDocFromContent（旧项目 content 迁移路径）同口径：数字 21 → mk-21
  const r7 = CD.ensureDocument({
    id: 'pNum', name: '数字标记', schemaVersion: 2,
    content: { dancers: [{ id: 0, switchClips: [], actionClips: [], lyricClips: [] }], globalLyrics: [], markers: [{ id: 21, t: 11, name: '老' }] },
  });
  assert('L1-7 buildDocFromContent：content 数字 id 21 → mk-21', r7.doc.markers[0].id === 'mk-21', r7.doc.markers[0].id);

  // L1-8 round-trip 无损不变量：投影回 content 后 id 已是字符串，再迁移保号
  const proj8 = CD.toLegacyContent(r7.doc);
  assert('L1-8 round-trip：投影保 mk-21 字符串、再迁移保号',
    proj8.markers[0].id === 'mk-21' && CD.ensureDocument({ id: 'pNum2', name: 'x', schemaVersion: 2, content: proj8 }).doc.markers[0].id === 'mk-21',
    proj8.markers[0].id);

  // L1-9 既有行为钉住：字符串 id 保号、缺 id 按数组序（test-document 基线口径不改）
  const m9 = CD.normalize({ markers: [{ id: 'mabc', tMs: 1, name: 'a' }, { tMs: 2, name: 'b' }] }, []).markers;
  assert('L1-9 既有钉住：字符串 mabc 保号、缺 id→mk-1', m9.map(m => m.id).join(',') === 'mabc,mk-1', m9.map(m => m.id));
}

// ---------- L3：scrubTo once 分支 animDur=intro+clip（注入式防御钉住） ----------
{
  console.log('== L3 once+intro 夹取（choreo-engine.js scrubTo，注入 clipLibrary） ==');

  // Rz 四元数帮助：主段 0→90° 线性（1.5s）；intro 段恒 30°（0.5s）→ animDur=2.0（二进制精确）
  // rz 返回 [占位,qx,qy,qz,qw]（绕 z 角 deg）；行＝[t].concat(rz(deg).slice(1))＝5 元关键帧
  const rz = (deg) => [0, 0, 0, Math.sin(deg * Math.PI / 360), Math.cos(deg * Math.PI / 360)];
  const idle = { name: '__idle__', duration: 3, type: 'loop', bones: { arm: { q: [[0, 0, 0, 0, 1], [3, 0, 0, 0, 1]] } } };
  const mainRamp = () => ({ arm: { q: [[0].concat(rz(0).slice(1)), [1.5].concat(rz(90).slice(1))] } });
  const introClip = () => Object.assign({ version: 1, duration: 0.5, type: 'once', bones: { arm: { q: [[0].concat(rz(30).slice(1)), [0.5].concat(rz(30).slice(1))] } } });
  const onceIntro = { name: 'oi', duration: 1.5, type: 'once', bones: mainRamp(), intro: introClip() };
  const plainOnce = { name: 'po', duration: 1.6, type: 'once', bones: { arm: { q: [[0].concat(rz(0).slice(1)), [1.6].concat(rz(90).slice(1))] } } };
  const loopIntro = { name: 'li', duration: 1.5, type: 'loop', bones: mainRamp(), intro: introClip() };

  // L3-1 校验未削弱：registerClip / validateScaleChannels 对 once+intro 仍拒绝
  {
    const e = new PreviewEngine();
    assert('L3-1 registerClip 仍拒 once+intro（validateScaleChannels 未削弱）',
      throws(() => e.registerClip(onceIntro)) && throws(() => validateScaleChannels(onceIntro)));
  }

  // 注入引擎（现网不可达，防御性）：A=once+intro@1s（animDur=2.0）、P=无 intro once@1s。
  // playClip 也会经 validateScaleChannels 拒 once+intro，故除直写 clipLibrary 外，
  // 还须直设「已活跃」状态（ch.currentClip）模拟未来校验放宽后的稳态——scrubTo 对
  // currentClip===clip 的角色不再走 playClip，once 分支的 animDur 数学即为本测试的防御对象。
  const e = new PreviewEngine();
  e.registerClip(idle);
  e.clipLibrary['oi'] = onceIntro;                       // 直接写库绕过注册校验
  e.clipLibrary['po'] = plainOnce;
  e.registerClip(loopIntro);
  const ch = e.addCharacter({ name: 'A', bones: { arm: {} }, applyFn: () => {}, idleClip: idle });
  const chP = e.addCharacter({ name: 'P', bones: { arm: {} }, applyFn: () => {}, idleClip: idle });
  e.setTimeline([
    { char: 'A', clipName: 'oi', start: 1, opts: {} },
    { char: 'P', clipName: 'po', start: 1, opts: {} },
  ]);
  const seedActive = () => { ch.currentClip = onceIntro; ch.state = 'playing'; ch.blendFrom = null; };

  // L3-2/3 默认定格 clamp 含 intro：t=start+3.0（超 animDur）→ clipTime=animDur-1e-3=1.999、末帧≈90°
  seedActive();
  e.scrubTo(4.0);
  assert('L3-2 默认定格：clipTime 夹到 animDur-1e-3（1.999，非 1.499）',
    near(ch.clipTime, 1.999, 1e-6), { t: ch.clipTime });
  assert('L3-3 默认定格末帧＝主段末帧（≈90°）', near(zDeg(ch.sample().arm), 90, 0.5), zDeg(ch.sample().arm));

  // L3-4 onceToIdle 判据含 intro：t=start+1.9（<2.0）仍在动作中
  seedActive();
  e.scrubTo(2.9, { onceToIdle: true });
  assert('L3-4 onceToIdle：intro+主段未播完（1.9<2.0）不回待机',
    ch.currentClip === onceIntro && ch.state === 'playing' && near(ch.clipTime, 1.9, 1e-6),
    { clip: ch.currentClip && ch.currentClip.name, state: ch.state, t: ch.clipTime });

  // L3-5 精确边界：t=start+animDur 即回待机（over=0 → 混合刚启动）
  seedActive();
  e.scrubTo(3.0, { onceToIdle: true });
  assert('L3-5 精确边界：t=start+animDur(2.0) 即回待机（blendT≈0）',
    ch.currentClip === idle && ch.blendFrom !== null && Math.abs(ch.blendT) < 1e-9 && ch.state === 'blending',
    { clip: ch.currentClip && ch.currentClip.name, blendT: ch.blendT, state: ch.state });

  // L3-6 末帧混合采样含 intro：t=start+2.1（over=0.1）→ 末帧 90° 混到 1/3 ≈ 60°
  seedActive();
  e.scrubTo(3.1, { onceToIdle: true });
  assert('L3-6 末帧混合：over=0.1 → blendT=0.1、姿态 90°×2/3≈60°',
    near(ch.blendT, 0.1, 1e-6) && near(zDeg(ch.sample().arm), 60, 1.5),
    { blendT: ch.blendT, deg: zDeg(ch.sample().arm) });

  // L3-7 远超 animDur＝纯待机（混合已结束；既有远端语义两版一致）
  seedActive();
  e.scrubTo(3.5, { onceToIdle: true });
  assert('L3-7 远超（over=0.5≥BLEND）＝纯待机',
    ch.currentClip === idle && ch.blendFrom === null && ch.state === 'idle' && near(zDeg(ch.sample().arm), 0, 1),
    { state: ch.state, deg: zDeg(ch.sample().arm) });

  // L3-8/9 无 intro 剪辑行为逐字节不变（animDur===clip.duration，B10 语义钉住）
  seedActive();
  e.scrubTo(6.0);
  assert('L3-8 无 intro 默认定格＝clip.duration-1e-3（1.599）',
    near(chP.clipTime, 1.599, 1e-6) && chP.currentClip === plainOnce, { t: chP.clipTime });
  e.scrubTo(2.6, { onceToIdle: true });
  assert('L3-9 无 intro onceToIdle 边界＝t=start+duration 即回待机（blendT≈0）',
    chP.currentClip === idle && chP.blendFrom !== null && Math.abs(chP.blendT) < 1e-9,
    { clip: chP.currentClip && chP.currentClip.name, blendT: chP.blendT });

  // L3-10/11 loop 分支零改动：intro 循环相位回卷口径不变（scrubTo 直读相位）
  const chL = e.addCharacter({ name: 'L', bones: { arm: {} }, applyFn: () => {}, idleClip: idle });
  e.setTimeline([{ char: 'L', clipName: 'li', start: 1, opts: {} }]);
  e.scrubTo(2.6, { onceToIdle: true });
  assert('L3-10 loop+intro 相位回卷不变（inClip=1.6 → clipTime=0.5+(1.6-0.5)%1.5=1.6）',
    near(chL.clipTime, 1.6, 1e-9), { t: chL.clipTime });
  assert('L3-11 loop 主段按相位采样（local=1.1s → 66°±0.5）',
    near(zDeg(chL.sample().arm), 66, 0.5), zDeg(chL.sample().arm));

  // L3-12 Character.update 的 intro 回卷＝loop-only 语义钉住（playClip 合法注册路径）
  {
    const e2 = new PreviewEngine();
    e2.registerClip(idle); e2.registerClip(loopIntro);
    const c = e2.addCharacter({ name: 'U', bones: { arm: {} }, applyFn: () => {}, idleClip: idle });
    c.playClip(loopIntro, { loop: true });
    c.update(2.1, 1, []);
    assert('L3-12 Character.update intro 回卷不变（+2.1s → clipTime=0.5+0.1）', near(c.clipTime, 0.6, 1e-9), { t: c.clipTime });
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
