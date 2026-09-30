/* test-docwire.js —— 文档接线层（web\choreo-docwire.js）node 单测（WP-5-WIRE 第二增量）
这个文件是干嘛的：
  用 node 直接跑（D:\nodejs\node.exe web\test-docwire.js），不依赖浏览器。
  锁住 2026-08-31 红基线复现的三类丢失的修复契约（复现脚本当时对真实 choreo-app.js 实测：
  timing/stage 一轮消失、clip id 7→1 重编号、导出丢 group/currentJob）：
  - 装载投影：文档/旧内容自动识别，未知顶层键经 _extra→投影→contentExtra 闭环不丢；
  - 保存文档：投影→文档字节幂等，timelineRevision 随 _docRev 携带、装载播种不推进；
  - 导入：新旧形态统一入口，clip 数值 id 保号（不再按数组位置重编号），AUD-002 校验对投影统一生效。
  和 test-document.js 同一套路：✔/✘ 打点，结尾报通过/失败数，失败置退出码 1。
*/
'use strict';
require('./choreo-document.js');
require('./choreo-docwire.js');
const CD = globalThis.ChoreoDocument;
const W = globalThis.ChoreoDocWire;
const can = CD._internal.canonicalize;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
}
function eqJson(a, b) { return JSON.stringify(can(a)) === JSON.stringify(can(b)); }
function throws(fn, want) {
  try { fn(); return false; } catch (e) { return want ? (e.message || '').indexOf(want) >= 0 : true; }
}

// 红基线同款样例：WP-3 content + 未来未知键 + 舞者/clip 扩展键
function sampleContent() {
  return {
    dancers: [
      { id: 0, name: '舞者 1', color: '#7eb3ff', solo: true, mute: false, currentJob: '骑士', collapsed: false, laneScale: 1.5, group: 'lead',
        switchClips: [{ id: 5, start: 0, duration: 2, data: { name: '切换:骑士', command: '/job 骑士', category: '切换', isJobSwitch: true, jobName: '骑士', jobId: 1234 } }],
        actionClips: [{ id: 7, start: 2.5, duration: 3, autoDur: true, data: { name: '鞠躬', command: '/bow motion', category: 'usual' } }],
        lyricClips: [{ id: 9, start: 6, duration: 2, data: { name: '啦', command: '/y 啦', category: 'lyric', isLyric: true } }] },
      { id: 1, name: '舞者 2', color: '#e07bf5', switchClips: [], actionClips: [], lyricClips: [] },
    ],
    globalLyrics: [{ id: 11, start: 1, duration: 2, data: { name: '全', command: '/y 全', category: 'lyric', isLyric: true } }],
    dancerCount: 2, showLyricMacro: true, totalDuration: 420,
    markers: [{ id: 'm1', t: 10, name: '副歌' }, { t: 0, name: '开头' }],
    timing: { bpm: 120 }, stage: { yaw: 30 },
  };
}
// 测试替身：choreo-app.js 的 AUD-002 校验（这里仿它的舞者数上限与开始时刻数值检查，
// 真实函数由浏览器套件覆盖）
function fakeSanitize(proj) {
  if (!proj || !Array.isArray(proj.dancers)) throw new Error('缺少 dancers 数组');
  if (proj.dancers.length < 1 || proj.dancers.length > 12) throw new Error('舞者数量须在 1～12 之间');
  (proj.dancers[0].actionClips || []).forEach(function (c) { if (c && typeof c.start !== 'number') throw new Error('开始时刻 必须是数字'); });
}

(async function main() {
  console.log('== 1. 装载投影：自动识别与未知键带回 ==');
  const legacy = sampleContent();
  const before = JSON.stringify(legacy);
  const w1 = W.loadProjection(JSON.parse(JSON.stringify(legacy)));
  ok('旧 content 识别为 project 来源', w1.source === 'project', 'source=' + w1.source);
  ok('装载不改动输入', JSON.stringify(sampleContent()) === before);
  ok('投影舞者数与标记数一致', w1.proj.dancers.length === 2 && w1.proj.markers.length === 2);
  ok('content 顶层未知键摊回投影（红基线 S1 修复）', eqJson(w1.proj.timing, { bpm: 120 }) && eqJson(w1.proj.stage, { yaw: 30 }));
  ok('装载播种修订号=文档 timelineRevision', w1.rev === w1.doc.timelineRevision && w1.rev >= 1, 'rev=' + w1.rev);
  const wdoc = W.loadProjection(w1.doc);
  ok('文档输入识别为 document 来源', wdoc.source === 'document');

  console.log('== 2. 装载容错：空壳/坏记录不挡启动 ==');
  const wEmpty = W.loadProjection({});
  ok('空壳按空项目开（静默，source=empty）', wEmpty.proj.dancers.length === 0 && wEmpty.proj.dancerCount === 1 && wEmpty.source === 'empty' && !wEmpty.warning);
  const wNull = W.loadProjection(null);
  ok('null/undefined 不炸', wNull.proj.dancers.length === 0);
  const wBad = W.loadProjection({ foo: 1 });
  ok('无法识别的坏记录给 warning 与空投影', wBad.warning && wBad.proj.dancers.length === 0 && typeof wBad.warning === 'string');
  const wBroken = W.loadProjection({ dancers: '不是数组' });
  ok('dancers 坏了也兜底空项目', wBroken.warning && wBroken.proj.dancers.length === 0);

  console.log('== 3. 保存文档：投影→文档，未知键进 _extra ==');
  const meta = { id: 'pX', name: '测试项目' };
  const extra = W.unknownTopKeys(w1.proj);
  ok('unknownTopKeys 只收未知键', Object.keys(extra).sort().join(',') === 'stage,timing', Object.keys(extra).sort().join(','));
  ok('unknownTopKeys 是深拷贝（后续改动不串）', (function () { extra.timing.bpm = 999; return w1.proj.timing.bpm === 120; })());
  const projForSave = Object.assign({ dancers: w1.proj.dancers, globalLyrics: w1.proj.globalLyrics, dancerCount: w1.proj.dancerCount, showLyricMacro: w1.proj.showLyricMacro, totalDuration: w1.proj.totalDuration, markers: w1.proj.markers }, W.unknownTopKeys(w1.proj));
  const doc1 = W.persistDoc(projForSave, meta, w1.rev);
  ok('文档 schemaVersion=2 且带 projectId/name', doc1.schemaVersion === 2 && doc1.projectId === 'pX' && doc1.name === '测试项目');
  ok('未知顶层键进文档 _extra（红基线 S1 修复）', eqJson(doc1._extra, { timing: { bpm: 120 }, stage: { yaw: 30 } }));
  ok('携带修订号写进文档', doc1.timelineRevision === w1.rev, 'rev=' + doc1.timelineRevision);
  ok('修订号非法收 1', W.persistDoc(projForSave, meta, 0).timelineRevision === 1 && W.persistDoc(projForSave, meta, undefined).timelineRevision === 1);

  console.log('== 4. 往返闭环：装载→保存→装载 字节幂等 ==');
  const w2 = W.loadProjection(doc1);
  const proj2 = Object.assign({ dancers: w2.proj.dancers, globalLyrics: w2.proj.globalLyrics, dancerCount: w2.proj.dancerCount, showLyricMacro: w2.proj.showLyricMacro, totalDuration: w2.proj.totalDuration, markers: w2.proj.markers }, W.unknownTopKeys(w2.proj));
  const doc2 = W.persistDoc(proj2, meta, w2.rev);
  ok('二轮保存字节一致（幂等）', CD.serialize(doc1) === CD.serialize(doc2));
  ok('二轮装载投影与一轮一致', JSON.stringify(can(w1.proj)) === JSON.stringify(can(w2.proj)));
  ok('修订号在往返中稳定', w2.rev === doc1.timelineRevision && doc2.timelineRevision === doc1.timelineRevision);
  const bumped = W.persistDoc(proj2, meta, w2.rev + 1);
  ok('编辑后修订号单调递增且装载播种', bumped.timelineRevision === doc1.timelineRevision + 1 && W.loadProjection(bumped).rev === bumped.timelineRevision);

  console.log('== 5. clip 身份与数据保真（红基线 S2/S3 根因） ==');
  const d0 = w1.proj.dancers[0];
  ok('clip 数值 id 保号（不重编号）', d0.actionClips[0].id === 7 && d0.switchClips[0].id === 5 && d0.lyricClips[0].id === 9 && w1.proj.globalLyrics[0].id === 11);
  ok('clip 扩展键 autoDur 回来', d0.actionClips[0].autoDur === true);
  ok('舞者扩展键 group 回来', d0.group === 'lead');
  ok('舞者 currentJob 回来', d0.currentJob === '骑士');
  ok('切换 clip data 完整（isJobSwitch/jobName/jobId）', eqJson(d0.switchClips[0].data, sampleContent().dancers[0].switchClips[0].data));
  ok('视图状态回来（solo/laneScale/showLyricMacro）', d0.solo === true && d0.laneScale === 1.5 && w1.proj.showLyricMacro === true);
  ok('标记 id 保号（字符串 id 原样）', w1.proj.markers.some(function (m) { return m.id === 'm1' && m.name === '副歌'; }));
  ok('重复 clip id 投影后数值唯一', (function () {
    const dup = { dancers: [{ id: 0, actionClips: [{ id: 7, start: 0, duration: 1, data: {} }, { id: 7, start: 2, duration: 1, data: {} }] }, { id: 1, actionClips: [{ id: 7, start: 4, duration: 1, data: {} }] }] };
    const p = W.loadProjection(dup).proj;
    const ids = p.dancers[0].actionClips.map((c) => c.id).concat(p.dancers[1].actionClips.map((c) => c.id));
    return new Set(ids).size === 3 && ids.indexOf(7) >= 0;
  })());

  console.log('== 6. 导入入口：新旧形态统一，校验与保号 ==');
  const v5 = { version: '5.0', dancers: [{ name: 'A', color: '#7eb3ff', solo: true, mute: false, currentJob: 'PLD', group: 'lead',
    switchClips: [], actionClips: [{ id: 7, start: 2, duration: 3, autoDur: true, data: { name: 'w', command: '/wave motion' } }],
    lyricClips: [{ id: 4, start: 0, duration: 1, data: { name: '词', command: '/lyrics add', isLyric: true } }] }],
    globalLyrics: [], showLyricMacro: false, totalDuration: 300, markers: [] };
  let sanitizeGot = null;
  const imp1 = W.importProjection(v5, function (p) { sanitizeGot = p; fakeSanitize(p); });
  ok('旧 v5.0 文件走投影导入', imp1.source === 'project' && imp1.proj.dancers.length === 1);
  ok('AUD-002 校验收到的是投影（统一防线）', sanitizeGot && Array.isArray(sanitizeGot.dancers) && sanitizeGot.dancers[0].actionClips.length === 1);
  ok('导入保号：动作 id 7 / 歌词 id 4（红基线 S2 修复）', imp1.proj.dancers[0].actionClips[0].id === 7 && imp1.proj.dancers[0].lyricClips[0].id === 4);
  ok('导入保舞者扩展键与职业（红基线 S2 修复）', imp1.proj.dancers[0].group === 'lead' && imp1.proj.dancers[0].currentJob === 'PLD');
  ok('导入的未知顶层键摊回投影', (function () { const f = Object.assign({}, v5, { timing: { bpm: 99 } }); return eqJson(W.importProjection(f, fakeSanitize).proj.timing, { bpm: 99 }); })());
  ok('文档导出文件也能导入', (function () { const w = W.importProjection(doc1, fakeSanitize); return w.source === 'document' && w.proj.dancers.length === 2; })());
  ok('13 个舞者被 AUD-002 上限拒绝', throws(function () {
    const many = { dancers: [], globalLyrics: [] };
    for (let i = 0; i < 13; i++) many.dancers.push({ id: i, name: 'd' + i, actionClips: [], lyricClips: [], switchClips: [] });
    W.importProjection(many, fakeSanitize);
  }, '舞者数量'));
  ok('文档里重号事件 id 拒绝导入（中文报错）', throws(function () {
    const bad = { schemaVersion: 2, projectId: 'pDup', name: '重号', durationMs: 300000,
      performers: [{ id: 'actor-0', name: '甲', view: {} }],
      tracks: [{ id: 't0', type: 'motion', performerId: 'actor-0', events: [{ id: 'e1', kind: 'motion', startMs: 0, durationMs: 1 }, { id: 'e1', kind: 'motion', startMs: 2, durationMs: 1 }] }] };
    W.importProjection(bad, fakeSanitize);
  }, '重复'));
  ok('非法数值在迁移收 0 之前就被旧口径拒绝（clip-check §20 契约）', throws(function () {
    W.importProjection({ dancers: [{ id: 0, actionClips: [{ start: 'x', duration: 5, data: { name: '正常' } }] }], globalLyrics: [] }, fakeSanitize);
  }, '数字'));
  ok('垃圾输入抛中文错误', throws(function () { W.importProjection('不是对象'); }, 'JSON 对象') && throws(function () { W.importProjection({}, fakeSanitize); }, 'dancers'));

  console.log('== 7. 确定性与真实形状冻结（过整条接线） ==');
  const shuffled = JSON.parse('{"markers":[{"id":"m1","t":10,"name":"副歌"},{"t":0,"name":"开头"}],"timing":{"bpm":120},"showLyricMacro":true,"dancerCount":2,"globalLyrics":' + JSON.stringify(legacy.globalLyrics) + ',"dancers":' + JSON.stringify(legacy.dancers) + ',"totalDuration":420,"stage":{"yaw":30}}');
  const wShuf = W.loadProjection(shuffled);
  const saveShuf = W.persistDoc(Object.assign({ dancers: wShuf.proj.dancers, globalLyrics: wShuf.proj.globalLyrics, dancerCount: wShuf.proj.dancerCount, showLyricMacro: wShuf.proj.showLyricMacro, totalDuration: wShuf.proj.totalDuration, markers: wShuf.proj.markers }, W.unknownTopKeys(wShuf.proj)), meta, wShuf.rev);
  ok('键序被搅过的输入保存字节一致', CD.serialize(saveShuf) === CD.serialize(doc1));
  const realContent = {
    dancers: [{
      id: 0, name: '舞者 1', color: '#7eb3ff', solo: false, mute: false,
      switchClips: [{ id: 20, start: 0, duration: 2, data: { name: '切换: 骑士', command: '/job 骑士', category: '切换', isJobSwitch: true, jobName: '骑士', jobId: 1234 } }],
      actionClips: [{ id: 21, start: 2, duration: 5, autoDur: true, data: { id: 221, name: '音疾', command: '/gaction 音疾', category: 'skill', jobName: '骑士', jobId: 1234, jobAbbr: 'KN' } }],
      lyricClips: [{ id: 22, start: 8, duration: 3, data: { name: '啦啦啦', command: '/y 啦啦啦', category: 'lyric', isLyric: true } }],
    }],
    globalLyrics: [{ id: 23, start: 1, duration: 2, data: { name: '全场', command: '/y 全场', category: 'lyric', isLyric: true } }],
    dancerCount: 1, showLyricMacro: false, totalDuration: 300,
  };
  const rw = W.loadProjection(realContent);
  const rs1 = W.persistDoc(Object.assign({ dancers: rw.proj.dancers, globalLyrics: rw.proj.globalLyrics, dancerCount: rw.proj.dancerCount, showLyricMacro: rw.proj.showLyricMacro, totalDuration: rw.proj.totalDuration, markers: rw.proj.markers }, W.unknownTopKeys(rw.proj)), { id: 'pReal', name: '真实形状' }, rw.rev);
  const rw2 = W.loadProjection(rs1);
  ok('真实形状（换职/录制/歌词）投影逐键还原', (function () {
    const a = rw.proj.dancers[0], b = rw2.proj.dancers[0];
    return eqJson(a.switchClips, b.switchClips) && eqJson(a.actionClips, b.actionClips) && eqJson(a.lyricClips, b.lyricClips) && eqJson(rw.proj.globalLyrics, rw2.proj.globalLyrics);
  })());
  ok('真实形状保存字节幂等', (function () {
    const rs2 = W.persistDoc(Object.assign({ dancers: rw2.proj.dancers, globalLyrics: rw2.proj.globalLyrics, dancerCount: rw2.proj.dancerCount, showLyricMacro: rw2.proj.showLyricMacro, totalDuration: rw2.proj.totalDuration, markers: rw2.proj.markers }, W.unknownTopKeys(rw2.proj)), { id: 'pReal', name: '真实形状' }, rw2.rev);
    return CD.serialize(rs1) === CD.serialize(rs2);
  })());
  ok('录制 data.id 数值在投影中不变', rw2.proj.dancers[0].actionClips[0].data.id === 221);

  console.log('== 8. API 面 ==');
  ok('关键导出齐全', ['loadProjection', 'persistDoc', 'unknownTopKeys', 'importProjection', 'KNOWN_CONTENT_KEYS'].every((k) => k in W));
  ok('KNOWN_CONTENT_KEYS 与迁移已知清单一致', W.KNOWN_CONTENT_KEYS.join(',') === 'dancers,globalLyrics,dancerCount,showLyricMacro,totalDuration,markers');
  ok('loadProjection 投影必带三类泳道数组', (function () { const p = W.loadProjection({ dancers: [{ id: 0 }] }).proj.dancers[0]; return Array.isArray(p.switchClips) && Array.isArray(p.actionClips) && Array.isArray(p.lyricClips); })());

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exit(1);
})().catch(function (e) { console.log('✘ 套件异常：' + (e && e.stack || e)); process.exit(1); });
