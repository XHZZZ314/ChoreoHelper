// test-music-timing.js —— 会话内分段速度/拍号/预备拍纯逻辑断言线束（TASK-20260910-MUSIC-BEAT-EDITOR）
// 用法：node web/test-music-timing.js --case segments|meter|countin [--red]
// 失败 exit 1（指纹单行一次），环境错误 exit 2，通过 exit 0；缺失模块按断言失败（exit 1），永不算环境错误。
'use strict';
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; }
const caseName = argVal('--case'), redMode = args.indexOf('--red') >= 0;
const FP = { segments: 'MUSIC_TIMING_SEGMENTS_ASSERTION', meter: 'MUSIC_TIMING_METER_ASSERTION', countin: 'MUSIC_TIMING_COUNTIN_ASSERTION' };
let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; if (!redMode) console.log('  ✔ ' + n + (d !== undefined ? '（' + d + '）' : '')); } else { fail++; console.log('  ✘ ' + n + (d !== undefined ? '（' + d + '）' : '')); } }
function infra(m) { console.error('INFRA: ' + m); process.exit(2); }
function zhErr(s) { return typeof s === 'string' && /[一-鿿]/.test(s); }
function eq(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }
let T = null;
try { delete require.cache[require.resolve('./choreo-music-timing.js')]; require('./choreo-music-timing.js'); T = globalThis.ChoreoMusicTiming; } catch (e) { T = null; }
function needT() { ok('会话节拍纯模块已加载（缺失按断言失败）', !!T && typeof T.evaluateTempoBeats === 'function'); return !!T; }
async function caseSegments() {
  console.log('== AC-2 分段速度（连续相位） ==');
  if (!needT()) return;
  const M1 = [{ startMs: 250, bpm: 120 }, { startMs: 2250, bpm: 60 }];
  const beats = T.evaluateTempoBeats(M1, 250, 500, 10000, 300000);
  ok('冻结Oracle音频拍 250/750/1250/1750/2250/3250', beats && [250, 750, 1250, 1750, 2250, 3250].every(function (v, i) { return eq(beats[i].audioMs, v); }), beats ? beats.slice(0, 6).map(function (b) { return b.audioMs; }).join(',') : '无');
  ok('冻结Oracle时间轴拍 -250/250/750/1250/1750/2750', beats && [-250, 250, 750, 1250, 1750, 2750].every(function (v, i) { return eq(beats[i].timelineMs, v); }));
  ok('偏移恰好应用一次（timeline=audio-O）', beats && beats.slice(0, 8).every(function (b) { return eq(b.timelineMs, b.audioMs - 500); }));
  const b137 = T.evaluateTempoBeats([{ startMs: 251, bpm: 137 }], 251, 0, 100000, 100000);
  ok('H=251/BPM=137 非整数周期首拍精确', b137 && b137[0].audioMs === 251);
  ok('H=251/BPM=137 相位步长 60000/137（1e-6）', b137 && eq(b137[1].audioMs - b137[0].audioMs, 60000 / 137) && eq(b137[2].audioMs - b137[1].audioMs, 60000 / 137));
  const mid = T.evaluateTempoBeats([{ startMs: 0, bpm: 120 }, { startMs: 750, bpm: 60 }], 0, 0, 100000, 100000);
  ok('拍中变速不断拍：0/500 后下一拍 1250（相位 0.5 延续）', mid && eq(mid[0].audioMs, 0) && eq(mid[1].audioMs, 500) && eq(mid[2].audioMs, 1250) && eq(mid[3].audioMs, 2250), mid ? mid.slice(0, 4).map(function (b) { return b.audioMs; }).join(',') : '无');
  const end = T.evaluateTempoBeats([{ startMs: 0, bpm: 120 }, { startMs: 1000, bpm: 60 }], 0, 0, 100000, 100000);
  ok('恰落拍点的边界即是一拍（1000）', end && [0, 500, 1000, 2000].every(function (v, i) { return eq(end[i].audioMs, v); }));
  const evKeep = [{ startMs: 2500 }];
  T.evaluateTempoBeats(M1, 250, 500, 10000, 300000);
  ok('求拍不搬移既有事件时刻', JSON.stringify(evKeep) === JSON.stringify([{ startMs: 2500 }]));
  const bads = [[{ startMs: 0, bpm: 120 }, { startMs: 0, bpm: 60 }], [{ startMs: 0, bpm: 0 }], [{ startMs: 0, bpm: 601 }], [{ startMs: 0, bpm: NaN }], [{ startMs: -1, bpm: 120 }], [{ startMs: 0.5, bpm: 120 }], [{ startMs: 0 }], [{ bpm: 120 }], 'x', null, [{ startMs: 200, bpm: 120 }, { startMs: 100, bpm: 60 }], new Array(129).fill(0).map(function (_, i) { return { startMs: i * 10, bpm: 120 }; })];
  bads.forEach(function (m, i) {
    const before = JSON.stringify(m), r = T.validateTempoMap(m);
    ok('非法速度映射原子拒绝 ' + i + '（中文、输入不动）', r && r.ok === false && zhErr(r.error) && JSON.stringify(m) === before);
  });
  ok('空瞬态映射回退 r5 标量（evaluate 返回 null）', T.isEmptyTempoMap([]) === true && T.isEmptyTempoMap(null) === true && T.evaluateTempoBeats([], 250, 500, 300000, 300000) === null);
  let M = null;
  try { delete require.cache[require.resolve('./choreo-music.js')]; require('./choreo-music.js'); M = globalThis.ChoreoMusic; } catch (e) { M = null; }
  const sc = T.scalarBeats(120, 250, 500, 300000, 300000), r5 = M ? M.visibleBeats(120, 250, 500, 300000, 300000) : null;
  ok('标量回退与 r5 公式逐拍一致', !!r5 && sc.length === r5.length && sc.slice(0, 5).every(function (b, i) { return b.audioMs === r5[i].audioMs && b.timelineMs === r5[i].timelineMs; }));
}
async function caseMeter() {
  console.log('== AC-3 可变拍号（小节标签） ==');
  if (!needT()) return;
  const beats = [250, 750, 1250, 1750, 2250, 3250, 4250, 5250, 6250];
  const r = T.validateMeterMap([{ startBeat: 0, n: 4, d: 4 }, { startBeat: 4, n: 3, d: 4 }]);
  ok('合法拍号映射接受', r.ok === true);
  const bars = T.computeBars(beats, r.map);
  ok('冻结Oracle：4/4→3/4 于 A=2250 起第 2 小节', bars.bars[1] && bars.bars[1].bar === 2 && bars.bars[1].startBeat === 4 && bars.bars[1].startAudioMs === 2250, JSON.stringify(bars.bars));
  ok('冻结Oracle：下一小节开于 A=5250', bars.bars[2] && bars.bars[2].startBeat === 7 && bars.bars[2].startAudioMs === 5250);
  ok('拍标签：第 5 拍是第 2 小节第 1 拍', bars.labels[4] && bars.labels[4].bar === 2 && bars.labels[4].beat === 1);
  ok('拍标签：第 7 拍是第 2 小节第 3 拍', bars.labels[6] && bars.labels[6].bar === 2 && bars.labels[6].beat === 3);
  const b8 = T.computeBars([0, 500, 1000, 1500, 2000, 2500, 3000], T.validateMeterMap([{ startBeat: 0, n: 6, d: 8 }]).map);
  ok('分母 8 被计数（6/8 每小节 3 个四分拍）', b8.bars[1] && b8.bars[1].startBeat === 3 && b8.bars[2].startBeat === 6);
  ok('小节线判定：第 5 拍非边界、第 8 拍是边界', T.isBarBoundary(5, bars.bars) === false && T.isBarBoundary(7, bars.bars) === true && T.isBarBoundary(0, bars.bars) === true);
  ok('标签引用同一拍点（无第二时钟/第二偏移）', bars.bars.every(function (b) { return b.startAudioMs === beats[b.startBeat]; }));
  const badM = [[{ startBeat: 1, n: 4, d: 4 }], [{ startBeat: 0, n: 0, d: 4 }], [{ startBeat: 0, n: 13, d: 4 }], [{ startBeat: 0, n: 4, d: 3 }], [{ startBeat: 0, n: 4, d: 6 }], [{ startBeat: 0, n: 2.5, d: 4 }], [{ startBeat: 0, n: 4, d: 4 }, { startBeat: 4, n: 3, d: 4 }, { startBeat: 4, n: 2, d: 4 }], 'x', new Array(129).fill(0).map(function (_, i) { return { startBeat: i, n: 4, d: 4 }; })];
  badM.forEach(function (m, i) {
    const before = JSON.stringify(m), rr = T.validateMeterMap(m);
    ok('非法拍号映射原子拒绝 ' + i + '（中文、输入不动）', rr && rr.ok === false && zhErr(rr.error) && JSON.stringify(m) === before);
  });
}
async function caseCountin() {
  console.log('== AC-4 预备拍纯调度 ==');
  if (!needT()) return;
  ok('默认关闭合法', (function () { const r = T.validateCountIn({ enabled: false }); return r.ok && r.sel.enabled === false; })());
  ok('1～4 小节合法', [1, 2, 3, 4].every(function (b) { return T.validateCountIn({ enabled: true, bars: b }).ok === true; }) && T.validateCountIn({ enabled: true, bars: '2' }).sel.bars === 2);
  [{ enabled: true, bars: 0 }, { enabled: true, bars: 5 }, { enabled: true, bars: 1.5 }, { enabled: true, bars: NaN }, { enabled: true }].forEach(function (s, i) {
    const rr = T.validateCountIn(s);
    ok('非法预备拍拒绝 ' + i + '（中文）', rr && rr.ok === false && zhErr(rr.error));
  });
  const s1 = T.computeCountInSchedule({ bars: 1, bpm: 120, n: 4, d: 4 });
  ok('冻结Oracle：120/4-4 一小节四击 0/500/1000/1500，媒体起于 2000', s1.ok && s1.totalMs === 2000 && s1.clicks.length === 4 && [0, 500, 1000, 1500].every(function (v, i) { return s1.clicks[i].offsetMs === v; }) && s1.clicks[0].label === '第1小节第1拍' && s1.clicks[3].label === '第1小节第4拍');
  const s2 = T.computeCountInSchedule({ bars: 2, bpm: 60, n: 3, d: 4 });
  ok('60/3-4 两小节六击、间距 1000、总量 6000', s2.ok && s2.totalMs === 6000 && s2.clicks.length === 6 && s2.clicks[5].offsetMs === 5000 && s2.clicks[3].label === '第2小节第1拍');
  const s8 = T.computeCountInSchedule({ bars: 1, bpm: 120, n: 6, d: 8 });
  ok('6/8 按八分音符计数（间距 250、六击、总量 1500）', s8.ok && s8.clicks.length === 6 && s8.clicks[1].offsetMs === 250 && s8.totalMs === 1500);
  ok('无速度则不可调度（中文、不编造节拍）', (function () { const q = T.computeCountInSchedule({ bars: 1, bpm: null, n: 4, d: 4 }); return q.ok === false && zhErr(q.error); })());
}
async function main() {
  const cases = { segments: caseSegments, meter: caseMeter, countin: caseCountin };
  try {
    if (!caseName || !cases[caseName]) { console.error('用法：--case segments|meter|countin [--red]'); process.exit(2); }
    await cases[caseName]();
  } catch (e) { fail++; console.log('  ✘ 用例异常：' + ((e && e.stack) || e)); }
  if (fail > 0) { console.log(FP[caseName]); console.log('MUSIC_TIMING ' + caseName + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(1); }
  console.log('MUSIC_TIMING ' + caseName + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / 0 失败');
}
main();
