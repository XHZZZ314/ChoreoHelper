/* test-showcompiler.js —— ShowCompiler（web\choreo-show-compiler.js）node 单测（EXEC-CORE 第一增量）
这个文件是干嘛的：
  用 node 直接跑（D:\nodejs\node.exe web\test-showcompiler.js），不依赖浏览器：
  - 契约冻结：演出包协议 v1、事件只含协议字段（迁移期 _extra/legacyLane/旧 data 块绝不进包）、
    整数毫秒、按 startMs+优先级稳定排序（与插件 EventScheduler.PriorityOf 同口径）。
  - 输入识别：规范文档 / WP-3 项目记录 / 旧草稿都经 ChoreoDocument.ensureDocument 自动迁移。
  - 确定性：同文档无论键序怎样、编译多少遍，projectHash 与整包字节一致（禁时钟/随机）。
  - 能力推导：movement/facing → movement-control，ability → ability-execution；缺 X1 输入拒绝，
    旧 /job 切换保留为诊断包但不可执行，普通动作仍可编译。
  - 结构错误：可执行事件缺演员/悬空演员 → ok:false + error issue。
  和 test-document.js 同一套路：✔/✘ 打点，结尾报通过/失败数，失败置退出码 1。
*/
'use strict';
require('./choreo-document.js');
require('./choreo-x1-inputs.js');
require('./choreo-show-compiler.js');
const CD = globalThis.ChoreoDocument;
const CSC = globalThis.ChoreoShowCompiler;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
}

// ---------- 固定样例：WP-3 schema2 项目（与 test-document.js 同源口径，含未知键与自定义字段） ----------
function sampleContent() {
  return {
    dancers: [
      { id: 0, name: '舞者 1', color: '#7eb3ff', solo: true, mute: false,
        switchClips: [{ id: 5, start: 0, duration: 2, data: { name: '切换:骑士', command: '/job 骑士', category: '切换', isJobSwitch: true, jobName: '骑士' } }],
        actionClips: [{ id: 7, start: 2.5, duration: 3, data: { name: '鞠躬', command: '/bow motion', category: 'usual' }, customField: 'keepme' }],
        lyricClips: [{ id: 9, start: 6, duration: 2, data: { name: '啦', command: '/y 啦', category: 'lyric', isLyric: true } }],
        currentJob: '骑士', collapsed: false, laneScale: 2 },
      { id: 1, name: '舞者 2', color: '#e07bf5', switchClips: [], actionClips: [
        { id: 8, start: 3.25, duration: 1.5, data: { name: '挥手', command: '/wave motion', category: 'usual' } }], lyricClips: [] },
    ],
    globalLyrics: [{ id: 11, start: 1, duration: 2, data: { name: '全', command: '/y 全', category: 'lyric', isLyric: true } }],
    dancerCount: 2, showLyricMacro: true, totalDuration: 420,
    markers: [{ id: 'mabc', t: 4, name: '副歌' }],
    timing: { futureThing: 1 },
  };
}
function sampleRecord() { return { id: 'pX', name: '测试项目', createdAt: 1, updatedAt: 2, schemaVersion: 2, content: sampleContent() }; }

(async function main() {
  console.log('== 1. 迁移输入编译：协议形状与字段冻结 ==');
  const r1 = CSC.compile(sampleRecord());
  ok('旧 /job 项目保留诊断包并明确拒绝执行', !r1.ok && r1.pkg && r1.issues.length === 1 && r1.issues[0].code === 'E_SWITCH_UNSUPPORTED', 'issues=' + r1.issues.length);
  const ordinary = sampleRecord();
  ordinary.content.dancers[0].switchClips = [];
  const ordinaryBefore = JSON.stringify(ordinary);
  const rOrdinary = CSC.compile(ordinary);
  ok('无切换的普通动作和歌词项目仍正常编译且输入不变', rOrdinary.ok && rOrdinary.pkg.events.length === 4 && rOrdinary.issues.length === 0 && JSON.stringify(ordinary) === ordinaryBefore);
  ok('docSource 记录为 project', r1.docSource === 'project');
  const pkg = r1.pkg;
  ok('协议版本 = 1', pkg.protocolVersion === CSC.PROTOCOL_VERSION && pkg.protocolVersion === 1);
  ok('projectId/name 承接项目身份', pkg.projectId === 'pX' && pkg.name === '测试项目');
  ok('编译器标识为确定性常量', pkg.compiler === CSC.MODULE_TAG);
  ok('事件数 = 切1+动1+词1+舞2动1+全局词1 = 5', pkg.events.length === 5, String(pkg.events.length));
  ok('时间全部整数毫秒', pkg.events.every(e => Number.isInteger(e.startMs) && Number.isInteger(e.durationMs)));
  ok('浮点秒正确换算（2.5s→2500ms, 3.25s→3250ms）',
    pkg.events.some(e => e.startMs === 2500) && pkg.events.some(e => e.startMs === 3250));
  ok('演员归属来自轨道 performerId（迁移 id actor-0/actor-1）',
    pkg.events.every(e => e.kind !== 'motion' || e.performerId === 'actor-0' || e.performerId === 'actor-1'));
  ok(' performers 清单输出', pkg.performers.length === 2 && pkg.performers[0].id === 'actor-0');

  const cmdOf = (id) => (pkg.events.find(e => e.id === id) || {}).command;
  ok('命令从旧 data.command 提升（/bow motion）', cmdOf('ev-7') === '/bow motion');
  ok('切职业命令保留（/job 骑士）', cmdOf('ev-5') === '/job 骑士');
  ok('歌词事件命令保留（/y 啦 /y 全）', cmdOf('ev-9') === '/y 啦' && pkg.events.some(e => e.command === '/y 全'));
  const ev7 = pkg.events.find(e => e.id === 'ev-7');
  ok('事件字段只含协议字段（迁移 _extra/legacyLane/data 不进包）',
    JSON.stringify(Object.keys(ev7).sort()) === JSON.stringify(['command', 'durationMs', 'id', 'kind', 'name', 'performerId', 'playMode', 'startMs']));
  ok('动作事件 playMode 默认 once', ev7.playMode === 'once');
  ok('歌词事件名保留（name 通道）', pkg.events.find(e => e.id === 'ev-9').name === '啦');

  console.log('== 2. 排序与时长 ==');
  ok('事件按 startMs 升序',
    pkg.events.every((e, i, a) => i === 0 || a[i - 1].startMs <= e.startMs));
  ok('同刻稳定（编译序保序）',
    (() => {
      const r = CSC.compile(sampleRecord());
      return JSON.stringify(r.pkg.events) === JSON.stringify(pkg.events);
    })());
  ok('声明时长兜底扩展到最晚事件结束（6+2=8s < 420s → 420000）', pkg.durationMs === 420000, String(pkg.durationMs));
  const rDur = CSC.compile({ dancers: [{ id: 0, name: 'A', actionClips: [{ id: 1, start: 100, duration: 5, data: { command: '/bow' } }] }], totalDuration: 10 });
  ok('最晚事件超出声明时长时扩展（105s）', rDur.pkg.durationMs === 105000, String(rDur.pkg.durationMs));

  console.log('== 3. 确定性：hash 与整包字节 ==');
  const h1 = pkg.projectHash;
  const r2 = CSC.compile(sampleRecord());
  ok('同输入两遍编译 hash 一致', r2.pkg.projectHash === h1 && /^[0-9a-f]{8}$/.test(h1), h1);
  ok('同输入两遍编译整包字节一致', JSON.stringify(r2.pkg) === JSON.stringify(pkg));
  // 键序打乱的规范文档 → 同一 hash（canonicalize 消化键序）
  function scramble(x) {
    if (Array.isArray(x)) return x.map(scramble);
    if (x && typeof x === 'object') {
      const out = {};
      Object.keys(x).sort().reverse().forEach(k => { out[k] = scramble(x[k]); });
      return out;
    }
    return x;
  }
  const doc1 = CD.ensureDocument(sampleRecord()).doc;
  const doc2 = scramble(JSON.parse(JSON.stringify(doc1)));
  const hDoc1 = CSC.compile(doc1).pkg.projectHash;
  const hDoc2 = CSC.compile(doc2).pkg.projectHash;
  ok('键序打乱的文档 hash 不变', hDoc1 === hDoc2);
  // 内容变化必须改 hash（防「恒等哈希」假阳性）
  const doc3 = JSON.parse(JSON.stringify(doc1));
  doc3.name = '别的名字';
  ok('内容变化 hash 变化', CSC.compile(doc3).pkg.projectHash !== hDoc1);

  console.log('== 4. 能力推导与未知类型 ==');
  const futureDoc = CD.ensureDocument({
    schemaVersion: 2, projectId: 'pF', name: '未来', durationMs: 60000,
    performers: [{ id: 'actor-0', name: '一人' }],
    tracks: [
      { id: 't1', type: 'movement', performerId: 'actor-0', enabled: true, events: [{ id: 'mv1', kind: 'movement', startMs: 0, durationMs: 1000 }] },
      { id: 't2', type: 'facing', performerId: 'actor-0', enabled: true, events: [{ id: 'fc1', kind: 'facing', startMs: 0, durationMs: 1000 }] },
      { id: 't3', type: 'ability', performerId: 'actor-0', enabled: true, events: [{ id: 'ab1', kind: 'ability', startMs: 500, durationMs: 500 }] },
    ], lyrics: [],
  }).doc;
  const rF = CSC.compile(futureDoc);
  ok('缺完整 X1 输入明确拒绝，三种事件仍保留在诊断包', !rF.ok && rF.pkg.events.length === 3 && rF.issues.some(i => i.code === 'E_X1_INPUT'));
  ok('能力推导：movement-control + ability-execution',
    rF.pkg.capabilities.some(c => c.name === 'movement-control') &&
    rF.pkg.capabilities.some(c => c.name === 'ability-execution'));
  ok('同刻优先级排序（facing 先于 movement）',
    rF.pkg.events.map(e => e.kind).slice(0, 2).join(',') === 'facing,movement');
  const unknownDoc = CD.ensureDocument({
    dancers: [{ id: 0, name: 'A', actionClips: [] }],
  }).doc;
  unknownDoc.tracks.push({ id: 'tx', type: 'holo', performerId: null, enabled: true, events: [{ id: 'x1', kind: 'holo', startMs: 0, durationMs: 1 }] });
  const rU = CSC.compile(unknownDoc);
  ok('未知轨道/事件类型不进包', rU.ok && !rU.pkg.events.some(e => e.kind === 'holo'));
  ok('停用事件不编译', (() => {
    const d = CD.ensureDocument({ dancers: [{ id: 0, name: 'A', actionClips: [{ id: 1, start: 0, duration: 1, data: { command: '/bow' } }] }] }).doc;
    d.tracks[0].events[0].enabled = false;
    return CSC.compile(d).pkg.events.length === 0;
  })());

  console.log('== 5. 结构错误：可执行事件必须归属演员 ==');
  const orphanDoc = CD.ensureDocument({ dancers: [{ id: 0, name: 'A', actionClips: [{ id: 1, start: 0, duration: 1, data: { command: '/bow' } }] }] }).doc;
  orphanDoc.tracks[0].performerId = 'actor-gone';
  const rO = CSC.compile(orphanDoc);
  ok('悬空演员 → ok:false + error', !rO.ok && rO.issues.some(i => i.code === 'E_ORPHAN_PERFORMER'));
  const noPerfDoc = {
    schemaVersion: 2, projectId: 'pN', name: 'N', durationMs: 1000,
    performers: [], tracks: [{ id: 't', type: 'motion', performerId: null, enabled: true, events: [{ id: 'm1', kind: 'motion', startMs: 0, durationMs: 1, command: '/bow' }] }], lyrics: [],
  };
  const rN = CSC.compile(noPerfDoc);
  ok('motion 缺演员 → ok:false', !rN.ok && rN.issues.some(i => i.code === 'E_NO_PERFORMER'));
  const emptyCmdDoc = CD.ensureDocument({ dancers: [{ id: 0, name: 'A', actionClips: [{ id: 1, start: 0, duration: 1, data: { name: '空', command: '' } }] }] }).doc;
  const rE = CSC.compile(emptyCmdDoc);
  ok('动作空命令 → warning（插件保留权威拒绝）',
    rE.ok && rE.issues.some(i => i.code === 'W_EMPTY_COMMAND'));

  console.log('== 6. 空项目与非法输入 ==');
  const emptyPkg = CSC.compile(CD.create({ performers: [{ name: '甲' }] }));
  ok('空项目可编译（0 事件）', emptyPkg.ok && emptyPkg.pkg.events.length === 0);
  const bad = CSC.compile('不是对象');
  ok('非法输入 → ok:false + E_INPUT', !bad.ok && bad.issues[0].code === 'E_INPUT');
  const bad2 = CSC.compile({ nothing: true });
  ok('无法识别结构 → ok:false', !bad2.ok && bad2.issues[0].code === 'E_INPUT');
  ok('非法输入不带 pkg', bad.pkg === null && bad2.pkg === null);

  console.log('== 7. 冻结：真实形状回归基线 ==');
  ok('样例项目整包字节基线（协议 v1 形状冻结）',
    JSON.stringify(pkg) === JSON.stringify({
      protocolVersion: 1, compiler: CSC.MODULE_TAG, projectId: 'pX', name: '测试项目',
      durationMs: 420000, timelineRevision: 1, projectHash: pkg.projectHash,
      performers: [{ id: 'actor-0', name: '舞者 1' }, { id: 'actor-1', name: '舞者 2' }],
      events: [
        { id: 'ev-5', performerId: 'actor-0', kind: 'motion', startMs: 0, durationMs: 2000, command: '/job 骑士', name: '切换:骑士', playMode: 'once' },
        { id: 'ev-11', performerId: '', kind: 'lyrics', startMs: 1000, durationMs: 2000, command: '/y 全', name: '全', playMode: '' },
        { id: 'ev-7', performerId: 'actor-0', kind: 'motion', startMs: 2500, durationMs: 3000, command: '/bow motion', name: '鞠躬', playMode: 'once' },
        { id: 'ev-8', performerId: 'actor-1', kind: 'motion', startMs: 3250, durationMs: 1500, command: '/wave motion', name: '挥手', playMode: 'once' },
        { id: 'ev-9', performerId: 'actor-0', kind: 'lyrics', startMs: 6000, durationMs: 2000, command: '/y 啦', name: '啦', playMode: '' },
      ],
      capabilities: [],
    }), '对比失败时把两侧 JSON 打出来人工比对');

  console.log('\nShowCompiler: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})().catch(function (e) {
  console.error('套件异常：', e);
  process.exitCode = 1;
});
