/* test-check.js —— choreo-check.js（编舞体检规则引擎）的 node 单测（WP-4，v0.7；FIX-4 补嵌套重叠/指纹/能力/宏共享口径）
这个文件是干嘛的：
  直接 require web\choreo-check.js，对体检规则逐条断言（正常不报 / 触发报对 /
  边界不误报），node 直接跑：D:\nodejs\node.exe web\test-check.js。
  注意：宏检查（第 5/6 节及 FIX-4 新增的宏共享口径断言）依赖 ChoreoEdit.pure 的共享
  口径层，必须先 require choreo-edit.js——与产品页面 script 顺序一致。
  套路仿 test-edit.js：ok()/eqJson 断言、结尾报数、有失败 exit 1。
  本文件是开发诊断文件，不进产品发布包（make-release-staging.js 黑名单）。
*/
require('./choreo-edit.js');
require('./choreo-check.js');
const CC = globalThis.ChoreoCheck;
const pure = CC.pure;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? ' —— ' + detail : '')); }
}
function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// 找指定规则的问题（可再按 di 过滤）
function byRule(issues, rule, di) {
  return issues.filter(function (i) { return i.rule === rule && (di === undefined || i.di === di); });
}

// ---------- fixture ----------
let nextId = 1;
function mkClip(start, duration, cmd, name) {
  return { id: nextId++, start: start, duration: duration, autoDur: false, selected: false,
    data: cmd === undefined ? {} : { name: name || cmd, command: cmd } };
}
function mkContent() {
  nextId = 1;
  return {
    dancers: [
      { id: 0, name: '舞者1', switchClips: [], actionClips: [], lyricClips: [], solo: false, mute: false },
      { id: 1, name: '舞者2', switchClips: [], actionClips: [], lyricClips: [], solo: false, mute: false },
    ],
    globalLyrics: [], markers: []
  };
}
// 标准资料库索引：bow=once 3s、golddance=loop 8s、wave=once 5s
function mkLibCtx(extra) {
  const ctx = Object.assign({
    libraryIndex: [
      { name: 'bow', duration: 3, type: 'once' },
      { name: 'wave', duration: 5, type: 'once' },
      { name: 'golddance', duration: 8, type: 'loop' },
      { name: 'doze', duration: 20, type: 'once' },
    ],
    hasLibrary: true, hasSkeleton: true, skeletonHash: 'aaa', onlineSkeletonHash: null,
    measuredDur: {}, jobMap: {}, capsOk: true, pluginProbed: false,
    pluginCaps: null, protocolVersion: 1, totalDuration: 300,
  }, extra || {});
  return ctx;
}

// ================================================================
console.log('== 1. 动作缺录（missing-clip）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  const r = pure.check(c, mkLibCtx());
  ok('已录动作不报', byRule(r, 'missing-clip').length === 0, JSON.stringify(r));
  c.dancers[0].actionClips.push(mkClip(5, 3, '/unknown_emote'));
  const r2 = pure.check(c, mkLibCtx());
  ok('未录动作报黄', r2.some(i => i.rule === 'missing-clip' && i.level === 'yellow' && i.di === 0));
  ok('t 落在条目起点', byRule(r2, 'missing-clip')[0].t === 5);
  ok('消息带动作名', /unknown_emote/.test(byRule(r2, 'missing-clip')[0].message));
  c.dancers[0].actionClips.push(mkClip(8, 3, '/surprised', '惊讶'));
  const named = byRule(pure.check(c, mkLibCtx()), 'missing-clip').find(i => i.t === 8);
  ok('缺录文案显示动作名但不暴露原始命令ID', named && /惊讶/.test(named.message) && !/\/surprised/.test(named.message));
  // 资料库不可用时不误报
  const ctx2 = mkLibCtx(); ctx2.libraryIndex = null; ctx2.hasLibrary = false;
  ok('无索引时静默', byRule(pure.check(c, ctx2), 'missing-clip').length === 0);
  // 切职业条/歌词不算动作、不查
  const c3 = mkContent();
  c3.dancers[0].actionClips.push(mkClip(0, 1, '/whatever'));
  c3.dancers[0].switchClips.push(mkClip(0, 1, '/jobchange'));
  c3.globalLyrics.push(mkClip(0, 2, ''));
  ok('switch/歌词轨不查缺录', byRule(pure.check(c3, ctx2), 'missing-clip').length === 0);
}

console.log('== 2. 动作时长超出/循环不足（overrun / loop-too-short）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));           // once 3s，条 5s → 超 2s
  c.dancers[1].actionClips.push(mkClip(10, 6, '/golddance'));    // loop 8s，条 6s → 不足
  const r = pure.check(c, mkLibCtx());
  const ov = byRule(r, 'overrun');
  ok('once 超长报黄', ov.length === 1 && ov[0].level === 'yellow' && ov[0].di === 0);
  ok('overrun t=超出起点', ov[0].t === 3, String(ov[0].t));
  const ls = byRule(r, 'loop-too-short');
  ok('loop 不足一圈报黄', ls.length === 1 && ls[0].di === 1 && ls[0].t === 10);
  // 边界：容差内不报（0.1s 容差）
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 3.1, '/bow'));
  c2.dancers[1].actionClips.push(mkClip(0, 7.96, '/golddance'));
  const r2 = pure.check(c2, mkLibCtx());
  ok('容差内（+0.1s / -0.05s）不报', byRule(r2, 'overrun').length === 0 && byRule(r2, 'loop-too-short').length === 0, JSON.stringify(r2));
  // 恰好等长不报
  const c3 = mkContent();
  c3.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  ok('等长不报', byRule(pure.check(c3, mkLibCtx()), 'overrun').length === 0);
}

console.log('== 3. 姿态类未复位（posture-uncleared）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 20, '/doze'));
  c.dancers[1].actionClips.push(mkClip(40, 3, '/bow'));  // 整场在姿态条结束后还有内容
  const r = pure.check(c, mkLibCtx({ totalDuration: 300 }));
  ok('姿态类且后面还有长内容报提示', byRule(r, 'posture-uncleared', 0).length === 1
    && byRule(r, 'posture-uncleared', 0)[0].level === 'info');
  // 后面接了新动作 → 不报
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 20, '/doze'));
  c2.dancers[0].actionClips.push(mkClip(25, 3, '/bow'));
  ok('之后有新动作不报', byRule(pure.check(c2, mkLibCtx()), 'posture-uncleared').length === 0);
  // 整场在姿态条结束后 10s 内结束 → 不报
  const c3 = mkContent();
  c3.dancers[0].actionClips.push(mkClip(0, 20, '/doze'));
  c3.globalLyrics.push(mkClip(22, 3, ''));
  ok('收尾 10s 内不报', byRule(pure.check(c3, mkLibCtx()), 'posture-uncleared').length === 0, JSON.stringify(pure.check(c3, mkLibCtx())));
  // 非姿态类最后一条不报
  const c4 = mkContent();
  c4.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  ok('非姿态类不报', byRule(pure.check(c4, mkLibCtx()), 'posture-uncleared').length === 0);
  // 姿态类不排在最后（中间姿态+后续动作）不报
  const c5 = mkContent();
  c5.dancers[0].actionClips.push(mkClip(0, 20, '/doze'));
  c5.dancers[0].actionClips.push(mkClip(30, 3, '/bow'));
  ok('中间姿态类不报', byRule(pure.check(c5, mkLibCtx()), 'posture-uncleared').length === 0);
}

console.log('== 4. 同通道重叠（overlap）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c.dancers[0].actionClips.push(mkClip(3, 3, '/wave'));   // 同轨压住 → 红
  const r = pure.check(c, mkLibCtx());
  const ov = byRule(r, 'overlap', 0);
  ok('同轨重叠报红', ov.length === 1 && ov[0].level === 'red' && ov[0].t === 3);
  // 相接不报
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c2.dancers[0].actionClips.push(mkClip(5, 3, '/wave'));
  ok('首尾相接不报', byRule(pure.check(c2, mkLibCtx()), 'overlap').length === 0);
  // switch 与 action 跨轨压住 → 红（conflictEnd 既有语义）
  const c3 = mkContent();
  c3.dancers[0].switchClips.push(mkClip(0, 4, '/jobchange'));
  c3.dancers[0].actionClips.push(mkClip(2, 3, '/bow'));
  const r3 = pure.check(c3, mkLibCtx());
  ok('switch×action 跨轨报红', byRule(r3, 'overlap', 0).some(i => i.level === 'red'));
  // 歌词轨重叠只提示
  const c4 = mkContent();
  c4.dancers[0].lyricClips.push(mkClip(0, 4, ''));
  c4.dancers[0].lyricClips.push(mkClip(1, 4, ''));
  const r4 = pure.check(c4, mkLibCtx());
  ok('歌词轨重叠降为提示', byRule(r4, 'overlap', 0).length === 1 && byRule(r4, 'overlap', 0)[0].level === 'info');
  // 不同舞者互不干扰
  const c5 = mkContent();
  c5.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c5.dancers[1].actionClips.push(mkClip(0, 5, '/wave'));
  ok('跨舞者不算重叠', byRule(pure.check(c5, mkLibCtx()), 'overlap').length === 0);
}

console.log('== 5. 宏量化漂移（macro-gap-lost / macro-drift）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c.dancers[0].actionClips.push(mkClip(0.2, 3, '/wave'));  // 组间隔 0.2s < 0.5 → 吃掉
  const r = pure.check(c, mkLibCtx());
  ok('间隔<0.5s 报提示', byRule(r, 'macro-gap-lost', 0).length === 1
    && byRule(r, 'macro-gap-lost', 0)[0].level === 'info');
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c2.dancers[0].actionClips.push(mkClip(3.7, 3, '/wave'));  // 间隔 0.7 → 舍成 0.5/1.0
  ok('非 0.5 倍数报漂移', byRule(pure.check(c2, mkLibCtx()), 'macro-drift', 0).length === 1);
  const c3 = mkContent();
  c3.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c3.dancers[0].actionClips.push(mkClip(4, 3, '/wave'));    // 整 0.5 倍数
  c3.dancers[0].actionClips.push(mkClip(9.5, 3, '/clap'));  // 5.5 = 11×0.5
  ok('0.5 整数倍不报', byRule(pure.check(c3, mkLibCtx()), 'macro-drift').length === 0
    && byRule(pure.check(c3, mkLibCtx()), 'macro-gap-lost').length === 0);
  // 0.1s 分组：同刻三条（0/0.05/0.1）算一组，组间隔 5.0 不漂
  const c4 = mkContent();
  c4.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c4.dancers[0].actionClips.push(mkClip(0.05, 3, '/wave'));
  c4.dancers[0].actionClips.push(mkClip(0.1, 3, '/clap'));
  c4.dancers[0].actionClips.push(mkClip(5, 3, '/greet'));
  ok('同刻 0.1s 内归组', byRule(pure.check(c4, mkLibCtx()), 'macro-drift').length === 0
    && byRule(pure.check(c4, mkLibCtx()), 'macro-gap-lost').length === 0);
}

console.log('== 6. 宏行数分页（macro-pages）==');
{
  const c = mkContent();
  for (let i = 0; i < 15; i++) c.dancers[0].actionClips.push(mkClip(i * 4, 3, '/bow'));
  const r = pure.check(c, mkLibCtx());
  ok('15 行报提示且算页数', byRule(r, 'macro-pages', 0).length === 1
    && /2 页/.test(byRule(r, 'macro-pages', 0)[0].message));
  const c2 = mkContent();
  for (let i = 0; i < 14; i++) c2.dancers[0].actionClips.push(mkClip(i * 4, 3, '/bow'));
  ok('14 行内不报', byRule(pure.check(c2, mkLibCtx()), 'macro-pages').length === 0);
}

console.log('== 7. 骨架资料（no-skeleton / skeleton-mismatch）==');
{
  const c = mkContent();
  const r = pure.check(c, mkLibCtx({ hasSkeleton: false }));
  ok('无骨架报红', byRule(r, 'no-skeleton').length === 1 && byRule(r, 'no-skeleton')[0].level === 'red');
  ok('有骨架不报', byRule(pure.check(c, mkLibCtx()), 'no-skeleton').length === 0);
  const r2 = pure.check(c, mkLibCtx({ onlineSkeletonHash: 'bbb' }));
  ok('在线骨架指纹不一致报黄', byRule(r2, 'skeleton-mismatch').length === 1
    && byRule(r2, 'skeleton-mismatch')[0].level === 'yellow');
  ok('指纹一致不报', byRule(pure.check(c, mkLibCtx({ onlineSkeletonHash: 'aaa' })), 'skeleton-mismatch').length === 0);
  ok('没在线不比对', byRule(pure.check(c, mkLibCtx()), 'skeleton-mismatch').length === 0);
}

console.log('== 8. 网页/插件能力不匹配（caps-*）==');
{
  const c = mkContent();
  ok('没探测过插件不评', byRule(pure.check(c, mkLibCtx()), 'caps-old-plugin').length === 0
    && byRule(pure.check(c, mkLibCtx()), 'caps-new-plugin').length === 0);
  const r = pure.check(c, mkLibCtx({ pluginProbed: true, capsOk: false }));
  ok('旧插件报提示', byRule(r, 'caps-old-plugin').length === 1
    && byRule(r, 'caps-old-plugin')[0].level === 'info');
  const r2 = pure.check(c, mkLibCtx({ pluginProbed: true, pluginCaps: { protocolVersion: 2 } }));
  ok('插件协议更新报提示', byRule(r2, 'caps-new-plugin').length === 1);
  ok('协议一致不报', byRule(pure.check(c, mkLibCtx({ pluginProbed: true, pluginCaps: { protocolVersion: 1 } })), 'caps-new-plugin').length === 0);
}

console.log('== 9. 汇总口径（排序/纯度/列表结构）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(20, 3, '/unknown'));   // 缺录 t=20
  c.dancers[0].actionClips.push(mkClip(0, 10, '/bow'));       // overrun t=3
  c.dancers[1].actionClips.push(mkClip(5, 5, '/wave'));
  c.dancers[1].actionClips.push(mkClip(7, 3, '/clap'));       // 重叠 t=7
  const ctx = mkLibCtx();
  const snapshot = JSON.stringify(c);
  const r = pure.check(c, ctx);
  ok('不改 content（纯函数）', JSON.stringify(c) === snapshot);
  ok('列表按 t 升序', r.every((x, i) => i === 0 || r[i - 1].t <= x.t), JSON.stringify(r.map(x => x.t)));
  ok('问题项字段齐全', r.every(x => x.level && x.rule && typeof x.t === 'number' && x.message));
  ok('多种问题并存', r.length >= 3, JSON.stringify(r.map(x => x.rule)));
  // di=-1 表示全局项
  const g = pure.check(mkContent(), mkLibCtx({ hasSkeleton: false }));
  ok('全局项 di=-1', byRule(g, 'no-skeleton')[0].di === -1);
  // 空 content 不炸、零问题
  const empty = { dancers: [], globalLyrics: [], markers: [] };
  ok('空项目零问题', pure.check(empty, mkLibCtx()).length === 0);
  // ctx 全缺省不炸（normCtx 兜底）
  ok('ctx 缺省不炸', Array.isArray(pure.check(mkContent(), {})));
}

console.log('== 10. cmdToName 与 preview3d 同口径 ==');
{
  ok('去头斜杠', pure.cmdToName('/bow') === 'bow');
  ok('斜杠换下划线', pure.cmdToName('/a/b') === 'a_b');
  ok('空命令得空串', pure.cmdToName('') === '' && pure.cmdToName(null) === '');
  ok('POSTURE 名单 11 项', pure.POSTURE_NAMES.length === 11 && pure.POSTURE_NAMES.indexOf('lounge') >= 0);
}

// FIX-4 新增的 jobName 动作条（带职业信息，宏行数估算用）
function mkJobClip(start, duration, cmd, jobName, jobId) {
  const c = mkClip(start, duration, cmd);
  c.data.jobName = jobName; c.data.jobId = jobId;
  return c;
}

console.log('== 11. 嵌套重叠（AUD-009：长条包住多个短条不漏报）==');
{
  // 审计样例：[0,10] 包住 [1,2] 和 [3,4]，旧逻辑只比相邻 → [3,4] 漏报
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 10, '/bow'));
  c.dancers[0].actionClips.push(mkClip(1, 1, '/wave'));
  c.dancers[0].actionClips.push(mkClip(3, 1, '/clap'));
  const r = pure.check(c, mkLibCtx());
  const ovs = byRule(r, 'overlap', 0);
  ok('嵌套里两条短条都报', ovs.length === 2, JSON.stringify(ovs.map(x => x.t)));
  ok('冲突条至少一个问题且可跳转', ovs.every(x => x.clipId && x.t >= 0));
  // 多层嵌套：被包住的条各自报一次，最外层不报
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 20, '/bow'));
  c2.dancers[0].actionClips.push(mkClip(1, 18, '/wave'));
  c2.dancers[0].actionClips.push(mkClip(2, 16, '/clap'));
  const ovs2 = byRule(pure.check(c2, mkLibCtx()), 'overlap', 0);
  ok('多层嵌套报 2 条（最外层不报）', ovs2.length === 2, JSON.stringify(ovs2.map(x => x.t)));
  // 相同起点 / 完全相同区间
  const c3 = mkContent();
  c3.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c3.dancers[0].actionClips.push(mkClip(0, 3, '/wave'));
  c3.dancers[0].actionClips.push(mkClip(0, 5, '/clap'));
  const ovs3 = byRule(pure.check(c3, mkLibCtx()), 'overlap', 0);
  ok('相同起点全部互报', ovs3.length === 2, JSON.stringify(ovs3.map(x => x.t)));
  // 消息不爆炸：长条包 5 条短条 = 恰 5 条问题
  const c4 = mkContent();
  c4.dancers[0].actionClips.push(mkClip(0, 30, '/bow'));
  for (let i = 0; i < 5; i++) c4.dancers[0].actionClips.push(mkClip(1 + i * 2, 1, '/wave'));
  ok('每条冲突条目只报一次', byRule(pure.check(c4, mkLibCtx()), 'overlap', 0).length === 5);
  // 首尾相接/容差临界仍不误报（0.01 容差与旧口径一致）
  const c5 = mkContent();
  c5.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c5.dancers[0].actionClips.push(mkClip(5, 5, '/wave'));
  ok('首尾相接不报', byRule(pure.check(c5, mkLibCtx()), 'overlap').length === 0);
  const c5b = mkContent();
  c5b.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c5b.dancers[0].actionClips.push(mkClip(4.99, 5, '/clap'));  // 5-0.01 容差内，不算压住
  ok('容差临界不报', byRule(pure.check(c5b, mkLibCtx()), 'overlap').length === 0);
  const c6 = mkContent();
  c6.dancers[0].actionClips.push(mkClip(0, 5, '/bow'));
  c6.dancers[0].actionClips.push(mkClip(4.98, 5, '/clap'));  // 超出容差 → 报
  ok('容差外照报', byRule(pure.check(c6, mkLibCtx()), 'overlap', 0).length === 1);
  // 歌词轨嵌套仍是提示级
  const c7 = mkContent();
  c7.dancers[0].lyricClips.push(mkClip(0, 10, ''));
  c7.dancers[0].lyricClips.push(mkClip(1, 1, ''));
  c7.dancers[0].lyricClips.push(mkClip(3, 1, ''));
  const ovs7 = byRule(pure.check(c7, mkLibCtx()), 'overlap', 0);
  ok('歌词轨嵌套报提示', ovs7.length === 2 && ovs7.every(x => x.level === 'info'));
}

console.log('== 12. 动作↔骨架指纹（clip-skeleton-mismatch，FIX-4 新增）==');
{
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  // 资料库索引带录制时的骨架指纹：和当前骨架不同 → 黄
  const ctxOld = mkLibCtx({ libraryIndex: [{ name: 'bow', duration: 3, type: 'once', skeletonHash: 'old-hash' }] });
  const r = pure.check(c, ctxOld);
  ok('指纹不同报黄', byRule(r, 'clip-skeleton-mismatch').length === 1
    && byRule(r, 'clip-skeleton-mismatch')[0].level === 'yellow');
  // 指纹相同 → 不报
  const ctxSame = mkLibCtx({ libraryIndex: [{ name: 'bow', duration: 3, type: 'once', skeletonHash: 'aaa' }] });
  ok('指纹相同不报', byRule(pure.check(c, ctxSame), 'clip-skeleton-mismatch').length === 0);
  // 旧数据没盖过指纹（空串/null）→ 证据不足不报（无法确认）
  const ctxNoStamp = mkLibCtx({ libraryIndex: [{ name: 'bow', duration: 3, type: 'once' }] });
  ok('没盖过指纹不报（无法确认）', byRule(pure.check(c, ctxNoStamp), 'clip-skeleton-mismatch').length === 0);
  // ctx 没有当前骨架指纹 → 不报
  const ctxNoCur = mkLibCtx({ skeletonHash: null, libraryIndex: [{ name: 'bow', duration: 3, type: 'once', skeletonHash: 'old-hash' }] });
  ok('无当前骨架指纹不报', byRule(pure.check(c, ctxNoCur), 'clip-skeleton-mismatch').length === 0);
}

console.log('== 13. 能力握手扩展（caps-protocol-old / caps-missing，FIX-4 新增）==');
{
  const c = mkContent();
  const fullCaps = ['playback', 'seek', 'freeze', 'recording', 'walkreset', 'gpose', 'library-sync', 'capabilities'];
  // 网页协议比插件新 → 语义可能不兼容，黄（必须升级插件）
  const r = pure.check(c, mkLibCtx({ pluginProbed: true, protocolVersion: 2, pluginCaps: { protocolVersion: 1, capabilities: fullCaps } }));
  ok('插件协议比网页旧报黄', byRule(r, 'caps-protocol-old').length === 1 && byRule(r, 'caps-protocol-old')[0].level === 'yellow');
  // 缺能力 → 黄且点名列出
  const r2 = pure.check(c, mkLibCtx({ pluginProbed: true, pluginCaps: { protocolVersion: 1, capabilities: ['playback', 'seek'] } }));
  const miss = byRule(r2, 'caps-missing');
  ok('缺能力报黄', miss.length === 1 && miss[0].level === 'yellow');
  ok('消息点名列出缺的能力', /walkreset/.test(miss[0].message) && /recording/.test(miss[0].message));
  // 能力齐全 → 不报
  ok('能力齐全不报', byRule(pure.check(c, mkLibCtx({ pluginProbed: true, pluginCaps: { protocolVersion: 1, capabilities: fullCaps } })), 'caps-').length === 0);
  // 旧插件文案与行为一致：说兼容模式，不再说"写接口会被拒"
  const r3 = pure.check(c, mkLibCtx({ pluginProbed: true, capsOk: false }));
  const oldMsg = byRule(r3, 'caps-old-plugin')[0].message;
  ok('旧插件文案讲兼容模式', /兼容模式/.test(oldMsg) && !/会被拒/.test(oldMsg), oldMsg);
  // 没给 capabilities 字段（旧式响应）不误报缺能力
  ok('无 capabilities 字段不误报', byRule(pure.check(c, mkLibCtx({ pluginProbed: true, pluginCaps: { protocolVersion: 1 } })), 'caps-missing').length === 0);
}

console.log('== 14. 宏检查共享口径（全局歌词/切职业行，FIX-4 新增）==');
{
  // 开歌词宏时全局歌词进宏 → 全局歌词造成的窄间隔也要报
  const c = mkContent();
  c.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c.dancers[0].actionClips.push(mkClip(10, 3, '/wave'));
  c.globalLyrics.push(mkClip(9.7, 1, '/say 副歌'));
  ok('关歌词宏时不报', byRule(pure.check(c, mkLibCtx()), 'macro-gap-lost').length === 0);
  ok('开歌词宏后全局歌词的窄间隔报提示', byRule(pure.check(c, mkLibCtx({ showLyricMacro: true })), 'macro-gap-lost', 0).length === 1);
  // 全局歌词与舞者歌词同刻同名 → 去重，不因重复计入产生假间隔
  const c2 = mkContent();
  c2.dancers[0].actionClips.push(mkClip(0, 3, '/bow'));
  c2.dancers[0].actionClips.push(mkClip(10, 3, '/wave'));
  c2.dancers[0].lyricClips.push(mkClip(5, 1, '/say 一句'));
  c2.globalLyrics.push(mkClip(5, 1, '/say 一句'));
  ok('同刻同名全局歌词去重不报', byRule(pure.check(c2, mkLibCtx({ showLyricMacro: true })), 'macro-drift').length === 0
    && byRule(pure.check(c2, mkLibCtx({ showLyricMacro: true })), 'macro-gap-lost').length === 0);
  // 切职业行不再高估：同职业多条只插一行（generateMacro 只在职业真变化且 jobMap 有该职业时插）
  const c3 = mkContent();
  for (let i = 0; i < 15; i++) c3.dancers[0].actionClips.push(mkJobClip(i * 4, 3, '/bow', '舞者', 7));
  const r3 = pure.check(c3, mkLibCtx({ jobMap: { 7: { command: '/gs change 7' } } }));
  const pages3 = byRule(r3, 'macro-pages', 0);
  ok('15 条同职业加标题 = 16 行报分页', pages3.length === 1 && /约 16 行/.test(pages3[0].message), pages3[0] && pages3[0].message);
  // jobMap 里没有该职业 → 不插切职业行（generateMacro 逐字口径：15 条=15 行，而不是旧算法的 30 行）
  const r4 = pure.check(c3, mkLibCtx());
  const pages4 = byRule(r4, 'macro-pages', 0);
  ok('jobMap 缺职业不插行（按 16 行报而非 31）', pages4.length === 1 && /约 16 行/.test(pages4[0].message), pages4[0] && pages4[0].message);
  // 14 条不同职业逐条换（14+14=28 行）报多页；旧算法高估的正是这种场景的口径漂移
  const c5 = mkContent();
  for (let i = 0; i < 14; i++) c5.dancers[0].actionClips.push(mkJobClip(i * 4, 3, '/bow', i % 2 ? '甲' : '乙', i % 2 ? 1 : 2));
  const r5 = pure.check(c5, mkLibCtx({ jobMap: { 1: { command: '/gs change 1' }, 2: { command: '/gs change 2' } } }));
  const pages5 = byRule(r5, 'macro-pages', 0);
  ok('交替职业未放切换条时不虚报分页', pages5.length === 0, pages5.length);
  // 用户明确放入的切换/套装命令照常计行（隐含插行取消后，显式命令不受影响）
  const c7 = mkContent();
  for (let i = 0; i < 14; i++) c7.dancers[0].actionClips.push(mkJobClip(i * 4, 3, '/bow', i % 2 ? '乙' : '甲', i % 2 ? 2 : 1));
  c7.dancers[0].switchClips.push(mkJobClip(0, 1, '/gs change 1', '甲', 1));
  for (let i = 1; i < 14; i++) c7.dancers[0].switchClips.push(mkJobClip(i * 4 - 0.5, 1, i % 2 ? '/gs change 2' : '/gs change 1', i % 2 ? '乙' : '甲', i % 2 ? 2 : 1));
  const pages7 = byRule(pure.check(c7, mkLibCtx({ jobMap: { 1: { command: '/gs change 1' }, 2: { command: '/gs change 2' } } })), 'macro-pages', 0);
  ok('用户明确放入的套装命令仍计入分页', pages7.length === 1 && /约 29 行/.test(pages7[0].message), pages7[0] && pages7[0].message);
  // switch 条本身一行并更新当前职业：显式切职业条后跟同职业动作不再重复插行（1+13=14 行不报）
  const c6 = mkContent();
  c6.dancers[0].switchClips.push(mkJobClip(0, 1, '/gs change 7', '舞者', 7));
  c6.dancers[0].actionClips.push(mkJobClip(1, 3, '/bow', '舞者', 7));
  for (let i = 0; i < 12; i++) c6.dancers[0].actionClips.push(mkJobClip(4 + i * 4, 3, '/wave', '舞者', 7));
  ok('switch 条计入且同职业不重复插行', byRule(pure.check(c6, mkLibCtx({ jobMap: { 7: { command: '/gs change 7' } } })), 'macro-pages', 0).length === 0);

console.log('== 14b. 暂不支持事件点名（规则 10：movement/ability/facing 保留但插件拒绝执行，info） ==');
{
  // 三类未支持事件各点名一条 info；cue 可执行不报；停用不计数；t 取该类最早时刻
  const cu = mkContent();
  cu._doc = { extraTracks: [{ enabled: true, events: [
    { kind: 'movement', startMs: 5000, enabled: true },
    { kind: 'movement', startMs: 0, enabled: true },
    { kind: 'ability', startMs: 2000, enabled: true },
    { kind: 'facing', startMs: 3000, enabled: true },
    { kind: 'cue', startMs: 4000, enabled: true },
    { kind: 'ability', startMs: 6000, enabled: false },
  ] }] };
  const infos = pure.check(cu, mkLibCtx()).filter((x) => x.rule === 'unsupported-kind');
  const msgOf = (k) => infos.find((x) => x.message.includes('「' + k + '」'));
  ok('每类未支持事件各报一条 info', infos.length === 3 && infos.every((x) => x.level === 'info'), infos.map((x) => x.message));
  ok('点名 movement 且计数=2', !!msgOf('movement') && /共 2 条/.test(msgOf('movement').message), msgOf('movement') && msgOf('movement').message);
  ok('点名 ability 且计数=1', !!msgOf('ability') && /共 1 条/.test(msgOf('ability').message), msgOf('ability') && msgOf('ability').message);
  ok('点名 facing 且计数=1', !!msgOf('facing') && /共 1 条/.test(msgOf('facing').message), msgOf('facing') && msgOf('facing').message);
  ok('每条都说明「数据保留但插件会拒绝」语义', infos.every((x) => x.message.includes('完整保留') && x.message.includes('被插件拒绝')), infos[0] && infos[0].message);
  ok('t 取该类最早事件时刻（movement→0）', msgOf('movement').t === 0, msgOf('movement') && msgOf('movement').t);
  // 泳道 clip 上的 _doc.kind 载体同样点名
  const c8 = mkContent();
  const laneClip = mkJobClip(2, 3, '/bow', '舞者', 7); laneClip._doc = { kind: 'ability' };
  c8.dancers[0].actionClips.push(laneClip);
  const infos8 = pure.check(c8, mkLibCtx()).filter((x) => x.rule === 'unsupported-kind');
  ok('泳道 clip 的 ability 载体也被点名计数=1', infos8.length === 1 && /「ability」类事件共 1 条/.test(infos8[0].message), infos8[0] && infos8[0].message);
  ok('cue 事件是插件支持类型，不报', !msgOf('cue'), infos.map((x) => x.rule));
  ok('无 extraTracks 的旧项目不报', pure.check(mkContent(), mkLibCtx()).filter((x) => x.rule === 'unsupported-kind').length === 0, 0);
  const c9 = mkContent();
  c9._doc = { extraTracks: [{ enabled: true, events: [{ kind: 'ability', startMs: 0, enabled: false }] }] };
  ok('停用事件不计数', pure.check(c9, mkLibCtx()).filter((x) => x.rule === 'unsupported-kind').length === 0, 0);
}
}

console.log('== 15. missing-clip-ns 冻结文案（P6 / AC-3：满员命名空间缺录逐舞者点名+复制入口） ==');
// P4 规则 11 在 P6 满员（8 舞者、三套异骨架档案）下的冻结验收：缺录舞者拿黄条+精确中文
// 文案+显式复制入口字段；别的舞者（自己命名空间有这条）不报；悬空绑定不猜；老调用方
// （不带逐档案数据）整条静默。文案逐字冻结：任何措辞漂移都会被这条断言抓红。
{
  const CE = globalThis.ChoreoEdit;
  // 满员会话：0/1→profA、2/3→profB、4→profC（缺 duet 的受害者）、5→空壳档案、6→悬空、7→未绑
  const dancers = [];
  for (let i = 0; i < 8; i++) {
    const d = { id: i, name: '舞者' + (i + 1), switchClips: [], actionClips: [], lyricClips: [] };
    if (i <= 1) d.profileId = 'profA';
    else if (i <= 3) d.profileId = 'profB';
    else if (i === 4) d.profileId = 'profC';
    else if (i === 5) d.profileId = 'profShell';
    else if (i === 6) d.profileId = 'profGone';
    dancers.push(d);
  }
  const clipDuet = { id: 41, start: 6, duration: 3, autoDur: false, data: { name: '双人舞', command: 'duet' } };
  dancers.forEach((d, i) => { if (i !== 6) d.actionClips.push({ ...clipDuet, id: 40 + i, start: 5 + i }); });
  const content = { dancers, globalLyrics: [], markers: [] };
  // 绑定解析与产品页同源（resolveBindings）：悬空/未绑 → null（规则 11 不猜）
  const known = ['profA', 'profB', 'profC', 'profShell'];
  const bindings = CE.pure.resolveBindings(dancers, known, 'profA').map((e) => e.profileId);
  const nsCtx = {
    libraryIndex: [{ name: 'duet', duration: 3, type: 'once' }], hasLibrary: true,
    dancerBindings: bindings,
    profileClipIndex: {
      profA: { duet: { duration: 3, type: 'once', skeletonHash: 'FA' } },
      profB: { duet: { duration: 7, type: 'once', skeletonHash: 'FB' } },
    },
    profileMeta: {
      profA: { name: '档案A', skeletonHash: 'FA', boneCount: 84 },
      profB: { name: '档案B', skeletonHash: 'FB', boneCount: 101 },
      profC: { name: '档案C', skeletonHash: 'FC', boneCount: 90 },
    },
  };
  const issues = pure.check(content, nsCtx);
  const ns = byRule(issues, 'missing-clip-ns');
  // profC（di=4）与 profShell（di=5）两个命名空间都缺 duet：各一条黄条
  ok('满员下缺录命名空间的舞者各得一条黄条（di=4/5，其余不报）',
    ns.length === 2 && ns.every((i) => i.level === 'yellow') && ns.map((i) => i.di).join(',') === '4,5');
  const it4 = ns.find((i) => i.di === 4);
  const FROZEN_NS =
    '舞者5 的动作「双人舞」不在他绑定的档案「档案C」里（只在档案「档案A」里有），3D 预览里这位舞者会用替身显示，不会借用别的档案的动作';
  ok('冻结中文文案逐字一致（点名舞者/动作/目标档案/出处档案+不借用语义）', it4 && it4.message === FROZEN_NS, it4 ? it4.message : '未报');
  ok('复制入口字段齐（copyFrom/copyTo/clipName/双档案名）',
    it4 && it4.copyFrom === 'profA' && it4.copyTo === 'profC' && it4.clipName === 'duet' &&
    it4.copyFromName === '档案A' && it4.copyToName === '档案C');
  ok('定位字段正确（clipId/t 指向缺录条本身）', it4 && it4.clipId === 44 && it4.t === 9);
  // 自己命名空间有这条的舞者（A/B 两组）绝不报缺录或误借
  ok('自己命名空间有这条的舞者（0-3）零报告', ns.every((i) => i.di >= 4));
  // 规则 1 不重复报同一处（只在别的档案有 → 归规则 11）
  ok('同一条不再重复进规则 1（missing-clip 零条）', byRule(issues, 'missing-clip').length === 0);
  // 悬空（di=6，bindings=null）不猜档案；缺省（di=7→活动档案 A 有 duet）不报
  ok('悬空/缺省舞者不报规则 11（悬空不猜档案、缺省解析到有这条的活动档案）',
    !ns.some((i) => i.di === 6 || i.di === 7));
  // 出处档案不在 profileMeta 时名字回退「其他档案」（文案冻结的一部分）
  const nsCtxNoMeta = Object.assign({}, nsCtx, { profileMeta: { profC: { name: '档案C' } } });
  const it4b = byRule(pure.check(content, nsCtxNoMeta), 'missing-clip-ns').find((i) => i.di === 4);
  ok('出处档案缺名回退「其他档案」（不炸、仍点名动作与目标档案）',
    it4b && /只在档案「其他档案」里有/.test(it4b.message) && /档案「档案C」/.test(it4b.message));
  // 老调用方（不带逐档案数据）：规则 11 整条静默（不误报）
  ok('不带逐档案数据的老调用方零报告（规则 11 静默）',
    byRule(pure.check(content, mkLibCtx({ libraryIndex: [{ name: 'duet', duration: 3, type: 'once' }] })), 'missing-clip-ns').length === 0);
  // 哪都没有的动作不归规则 11（回规则 1 缺录口径）
  const cNs2 = mkContent();
  cNs2.dancers[0].profileId = 'profA';
  cNs2.dancers[0].actionClips.push({ id: 60, start: 2, duration: 2, autoDur: false, data: { name: '独有', command: 'nowhere' } });
  const ctxNs2 = Object.assign({}, nsCtx, { dancerBindings: ['profA', 'profA'] });
  const rNs2 = pure.check(cNs2, ctxNs2);
  ok('哪都没有的动作归规则 1（规则 11 不报、规则 1 报缺录）',
    byRule(rNs2, 'missing-clip-ns').length === 0 && byRule(rNs2, 'missing-clip', 0).length === 1);
}

console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败');
if (fail > 0) process.exit(1);
