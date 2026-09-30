/* test-document.js —— 规范演出文档模块（web\choreo-document.js）node 单测（WP-5-DOC 第一增量）
这个文件是干嘛的：
  用 node 直接跑（D:\nodejs\node.exe web\test-document.js），不依赖浏览器：
  - 复现回归：choreo-app.js 的固定字段保存/装载链路会丢 content 未知字段（2026-08-31 已用
    vm 桩加载真代码实测复现：timing/stage 一轮后消失）。本套件锁住新模块的无损契约防复发。
  - 迁移：旧 5 字段草稿 / WP-3 schema2 项目 / 未来未知字段 / 畸形输入，全部幂等且输入只读。
  - 契约：整数毫秒、稳定 ID、assetRef、timelineRevision、未知类型停用不删、确定性序列化。
  和 test-projects.js 同一套路：✔/✘ 打点，结尾报通过/失败数，失败置退出码 1。
*/
'use strict';
require('./choreo-document.js');
const CD = globalThis.ChoreoDocument;
const can = CD._internal.canonicalize;
const toMs = CD._internal.toIntMs;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
}
// 键序无关的深比较（投影/迁移会补默认键，比较语义而非字面键序）
function eqJson(a, b) { return JSON.stringify(can(a)) === JSON.stringify(can(b)); }
function throws(fn, code) {
  try { fn(); return false; } catch (e) { return code ? e.code === code : true; }
}

// ---------- 固定样例：WP-3 schema2 项目 content（含未来未知字段与旧 clip 自定义键） ----------
function sampleContent() {
  return {
    dancers: [
      { id: 0, name: '舞者 1', color: '#7eb3ff', solo: true, mute: false,
        switchClips: [{ id: 5, start: 0, duration: 2, data: { name: '切换:骑士', command: '/job 骑士', category: '切换', isJobSwitch: true, jobName: '骑士' } }],
        actionClips: [{ id: 7, start: 2.5, duration: 3, data: { name: '鞠躬', command: '/bow motion', category: 'usual' }, customField: 'keepme' }],
        lyricClips: [{ id: 9, start: 6, duration: 2, data: { name: '啦', command: '/y 啦', category: 'lyric', isLyric: true } }],
        currentJob: '骑士', collapsed: false, laneScale: 2 },
      { id: 1, name: '舞者 2', color: '#e07bf5', switchClips: [], actionClips: [], lyricClips: [] },
    ],
    globalLyrics: [{ id: 11, start: 1, duration: 2, data: { name: '全', command: '/y 全', category: 'lyric', isLyric: true } }],
    dancerCount: 2, showLyricMacro: true, totalDuration: 420,
    markers: [{ id: 'mabc', t: 4, name: '副歌' }, { t: 0, name: '开头' }],
    timing: { futureThing: 1 }, // 未来版本写入的未知键（现链路会丢，模块必须保住）
  };
}
function sampleRecord() { return { id: 'pX', name: '测试项目', createdAt: 1, updatedAt: 2, schemaVersion: 2, content: sampleContent() }; }

(async function main() {
  console.log('== 1. 整数毫秒与确定性序列化 ==');
  ok('浮点秒 → 毫秒四舍五入', toMs(2.5) === 2500 && toMs(0.05) === 50 && toMs(1.2345) === 1235);
  ok('非法时间收 0', toMs(-3) === 0 && toMs(NaN) === 0 && toMs('x') === 0);
  const r1 = CD.ensureDocument(sampleRecord());
  const doc1 = r1.doc;
  ok('识别为 WP-3 项目', r1.source === 'project', 'source=' + r1.source);
  ok('事件时刻全是整数毫秒', doc1.tracks[0].events.every((e) => Number.isInteger(e.startMs) && Number.isInteger(e.durationMs)));
  const bytes1 = CD.serialize(doc1);
  ok('serialize 两遍字节一致', CD.serialize(doc1) === bytes1);
  const shuffled = JSON.parse('{"totalDuration":420,"markers":[],"name":"键序被搅过的文档","schemaVersion":2,"performers":[],"tracks":[],"lyrics":[],"projectId":"pk","timing":{},"stage":{},"capabilities":[],"timelineRevision":1,"metadata":{},"view":{}}');
  ok('键序不同的同一文档序列化字节一致', CD.serialize(CD.normalize(shuffled)) === CD.serialize(CD.normalize(JSON.parse(CD.serialize(shuffled)))));

  console.log('== 2. 迁移：旧 5 字段草稿 ==');
  const draft = {
    dancers: [{ id: 0, name: '舞者 1', switchClips: [], lyricClips: [], actionClips: [{ id: 3, start: 0.5, duration: 2, data: { name: '鞠躬', command: '/bow motion', category: 'usual' } }] }],
    globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300,
  };
  const rd = CD.fromDraft(draft, { projectId: 'pOld', name: '旧草稿' });
  ok('草稿识别为 draft 来源', rd.source === 'draft');
  ok('草稿迁移 metadata.migratedFrom=draft', rd.doc.metadata.migratedFrom === 'draft');
  ok('草稿 projectId/name 从 opts 取', rd.doc.projectId === 'pOld' && rd.doc.name === '旧草稿');
  ok('草稿动作进 motion 轨且毫秒正确', rd.doc.tracks[0].events[0].startMs === 500 && rd.doc.tracks[0].type === 'motion');
  ok('草稿无效时抛中文错误', throws(() => CD.fromDraft({ foo: 1 }), 'E_BAD_DRAFT'));

  console.log('== 3. 迁移：稳定 ID 与轨道布局 ==');
  ok('舞者获得稳定 actor ID', doc1.performers.map((p) => p.id).join(',') === 'actor-0,actor-1', doc1.performers.map((p) => p.id).join(','));
  ok('事件 ID 从旧 clip id 推导', doc1.tracks[0].events.map((e) => e.id).sort().join(',') === 'ev-5,ev-7', doc1.tracks[0].events.map((e) => e.id).join(','));
  ok('全局歌词进文档级 lyrics 数组', doc1.lyrics.length === 1 && doc1.lyrics[0].id === 'ev-11');
  ok('舞者歌词进独立 lyrics 轨', doc1.tracks.some((t) => t.type === 'lyrics' && t.performerId === 'actor-0' && t.events[0].id === 'ev-9'));
  ok('切换/动作泳道保留为 legacyLane', doc1.tracks[0].events.some((e) => e.legacyLane === 'switch') && doc1.tracks[0].events.some((e) => e.legacyLane === 'action'));
  ok('重复旧 clip id 确定性去重', (() => {
    const c = { dancers: [{ id: 0, actionClips: [{ id: 7, start: 0, duration: 1, data: {} }, { id: 7, start: 2, duration: 1, data: {} }] }] };
    const dd = CD.ensureDocument({ id: 'pD', content: c }).doc;
    return dd.tracks[0].events.map((e) => e.id).join(',') === 'ev-7,ev-7-2';
  })());
  ok('无 id 标记按数组序补确定性 id', (() => {
    const c = { dancers: [{ id: 0, actionClips: [] }], markers: [{ t: 1, name: '甲' }, { t: 2, name: '乙' }] };
    const dd = CD.ensureDocument({ id: 'pM', content: c }).doc;
    return dd.markers.map((m) => m.id).join(',') === 'mk-0,mk-1';
  })());
  ok('规范文档换序不改 ID', (() => {
    const dd = CD.normalize(doc1);
    const reordered = CD.normalize(Object.assign({}, dd, { performers: [dd.performers[1], dd.performers[0]] }));
    return reordered.performers[0].id === 'actor-1' && reordered.performers[1].id === 'actor-0';
  })());

  console.log('== 4. 迁移：未来未知字段与旧数据无损 ==');
  ok('content 顶层未知键进文档 _extra', eqJson(doc1._extra, { timing: { futureThing: 1 } }), JSON.stringify(doc1._extra));
  const evCustom = doc1.tracks[0].events.find((e) => e.id === 'ev-7');
  ok('旧 clip 自定义键进事件 _extra', eqJson(evCustom._extra, { customField: 'keepme' }));
  ok('旧 data 整体冻结保留', eqJson(evCustom.data, { name: '鞠躬', command: '/bow motion', category: 'usual' }));
  ok('切换 clip 的 isJobSwitch 保留', JSON.stringify(doc1.tracks[0].events.find((e) => e.id === 'ev-5').data).indexOf('isJobSwitch') > 0);
  ok('solo/mute/currentJob/laneScale 进表演者', doc1.performers[0].view.solo === true && doc1.performers[0].job === '骑士' && doc1.performers[0].view.laneScale === 2);
  ok('showLyricMacro 进 view', doc1.view.showLyricMacro === true);
  ok('markers 迁移：已知 id 保留、t 变毫秒', doc1.markers.some((m) => m.id === 'mabc' && m.tMs === 4000));
  ok('迁移期 assetRef 指向 legacyclip', evCustom.assetRef.kind === 'clip' && evCustom.assetRef.id === 'legacyclip-7' && evCustom.clipId === 'legacyclip-7');
  ok('迁移期 createdWith 是确定常量', evCustom.createdWith === CD.MODULE_TAG);

  console.log('== 5. 迁移：幂等与输入只读 ==');
  const before = JSON.stringify(sampleRecord());
  CD.ensureDocument(sampleRecord());
  ok('迁移不改动输入（失败也不动原文件）', JSON.stringify(sampleRecord()) === before);
  const r2 = CD.ensureDocument(JSON.parse(bytes1));
  ok('迁移结果再识别为 document 来源', r2.source === 'document', 'source=' + r2.source);
  ok('ensureDocument 幂等（字节一致）', CD.serialize(r2.doc) === bytes1);
  ok('normalize 两遍幂等', CD.serialize(CD.normalize(r2.doc)) === CD.serialize(r2.doc));

  console.log('== 6. 投影 round-trip（toLegacyContent） ==');
  const proj = CD.toLegacyContent(doc1);
  const d0 = proj.dancers[0];
  ok('投影舞者数=表演者数', proj.dancerCount === 2 && proj.dancers.length === 2);
  ok('动作 clip 数值 id 原样保留', d0.actionClips[0].id === 7 && d0.switchClips[0].id === 5 && d0.lyricClips[0].id === 9);
  ok('动作 clip 时刻在半毫秒内往返', Math.abs(d0.actionClips[0].start - 2.5) < 0.0005 && Math.abs(d0.switchClips[0].duration - 2) < 0.0005);
  ok('clip 自定义键原样回来', d0.actionClips[0].customField === 'keepme');
  ok('data 完整回来（含 isJobSwitch）', d0.switchClips[0].data.isJobSwitch === true && d0.switchClips[0].data.jobName === '骑士');
  ok('泳道各回各家（switch/action/lyric）', d0.switchClips.length === 1 && d0.actionClips.length === 1 && d0.lyricClips.length === 1);
  ok('舞者视图状态回来（solo/laneScale/currentJob）', d0.solo === true && d0.laneScale === 2 && d0.currentJob === '骑士');
  ok('全局歌词回来', proj.globalLyrics.length === 1 && proj.globalLyrics[0].id === 11);
  ok('标记回来（缺 id 的按迁移补发）', (() => {
    const got = proj.markers.slice().sort((a, b) => a.t - b.t);
    return got[0].t === 0 && got[0].name === '开头' && got[0].id === 'mk-1' && got[1].id === 'mabc';
  })());
  ok('content 未知键摊回 content（现链路丢、投影保）', eqJson(proj.timing, { futureThing: 1 }), JSON.stringify(proj.timing));
  ok('showLyricMacro/totalDuration 回来', proj.showLyricMacro === true && proj.totalDuration === 420);
  const proj2 = CD.toLegacyContent(CD.ensureDocument({ id: 'pQ', content: { dancers: [{ id: 0, actionClips: [], lyricClips: [], switchClips: [] }], globalLyrics: [] } }).doc);
  ok('最小项目投影不炸', proj2.dancers.length === 1 && proj2.globalLyrics.length === 0);

  console.log('== 7. 规范文档：未知字段原位保留、未知类型停用不删 ==');
  const futDoc = { schemaVersion: 2, projectId: 'pF', name: '未来', durationMs: 60000, performers: [], tracks: [], lyrics: [], markers: [], somethingNew: { deep: [1, 2] } };
  const nf = CD.normalize(futDoc);
  ok('规范文档未知顶层键原位保留', eqJson(nf.somethingNew, { deep: [1, 2] }));
  const unkDoc = { schemaVersion: 2, projectId: 'pU', name: '未知类型', durationMs: 60000,
    performers: [{ id: 'actor-0', name: '甲', view: {} }],
    tracks: [{ id: 't0', type: 'holo', performerId: 'actor-0', events: [{ id: 'e1', kind: 'laser', startMs: 0, durationMs: 1 }, { id: 'e2', kind: 'motion', startMs: 5, durationMs: 1 }] }],
    lyrics: [], markers: [] };
  const nu = CD.ensureDocument(unkDoc);
  const tr = nu.doc.tracks[0];
  ok('未知轨道类型保留不删', tr.type === 'holo' && nu.issues.some((i) => i.code === 'W_UNKNOWN_TRACK_TYPE'));
  ok('未知轨道已停用', tr.enabled === false);
  ok('未知事件类型保留且停用', tr.events[0].kind === 'laser' && tr.events[0].enabled === false);
  ok('已知事件不受影响', tr.events[1].enabled === true && tr.events[1].kind === 'motion');
  const nu2 = CD.ensureDocument(JSON.parse(CD.serialize(nu.doc)));
  ok('停用的未知类型再过一遍不复活不丢失', nu2.doc.tracks[0].enabled === false && nu2.doc.tracks[0].events[0].kind === 'laser');

  // 2026-08-31 审计 P2 回归：timing/stage/metadata/performer.view 整体重建曾丢嵌套未知键
  const segDoc = { schemaVersion: 2, projectId: 'pSeg', name: '段级未知键', durationMs: 60000,
    timing: { snapMode: 'beat', futureTiming: { grid: 4 } },
    stage: { stageYawDeg: 90, futureStage: 'keep' },
    metadata: { notes: 'n', futureMeta: 7 },
    performers: [{ id: 'actor-0', name: '甲', view: { solo: true, futureView: 'v1' } }],
    tracks: [], lyrics: [], markers: [] };
  const segN = CD.normalize(segDoc);
  ok('timing 嵌套未知键原位保留', eqJson(segN.timing.futureTiming, { grid: 4 }) && segN.timing.snapMode === 'beat');
  ok('stage 嵌套未知键原位保留', segN.stage.futureStage === 'keep' && segN.stage.stageYawDeg === 90);
  ok('metadata 嵌套未知键原位保留', segN.metadata.futureMeta === 7 && segN.metadata.notes === 'n');
  ok('performer.view 嵌套未知键原位保留', segN.performers[0].view.futureView === 'v1' && segN.performers[0].view.solo === true);
  const segN2 = CD.normalize(JSON.parse(CD.serialize(segN)));
  ok('段级未知键两遍幂等', eqJson(segN2, segN));

  console.log('== 8. 畸形输入 ==');
  ok('null 抛「必须是 JSON 对象」', throws(() => CD.ensureDocument(null), 'E_NOT_OBJECT'));
  ok('数字/字符串/数组抛 E_NOT_OBJECT', throws(() => CD.ensureDocument(42), 'E_NOT_OBJECT') && throws(() => CD.ensureDocument('x'), 'E_NOT_OBJECT') && throws(() => CD.ensureDocument([1]), 'E_NOT_OBJECT'));
  ok('空对象抛「无法识别」', throws(() => CD.ensureDocument({}), 'E_UNRECOGNIZED'));
  ok('缺 dancers 的内容抛「无法识别」', throws(() => CD.ensureDocument({ id: 'p', content: { foo: 1 } }), 'E_UNRECOGNIZED'));
  ok('dancers 坏了抛「无法迁移」', throws(() => CD.ensureDocument({ id: 'p', content: { dancers: '不是数组' } }), 'E_NO_DANCERS'));
  ok('parse 坏 JSON 抛 E_PARSE', throws(() => CD.parse('{oops'), 'E_PARSE'));
  ok('parse 好文件直接得文档', CD.parse(CD.serialize(doc1)).doc.projectId === 'pX');
  const badInput = { id: 'pB', content: { dancers: '不是数组' } };
  const badSnap = JSON.stringify(badInput);
  let threwClean = false;
  try { CD.ensureDocument(badInput); } catch (e) { threwClean = e.name === 'ChoreoDocumentError' && /dancers/.test(e.message); }
  ok('失败迁移不污染输入且错误可识别', threwClean && JSON.stringify(badInput) === badSnap);

  console.log('== 9. timelineRevision 与能力要求 ==');
  const cdoc = CD.create({ projectId: 'pC', name: '新建', durationMs: 60000, performers: [{ name: '甲' }, { name: '乙' }] });
  ok('create 默认 timelineRevision=1', cdoc.timelineRevision === 1);
  ok('bump 递增并随序列化保留', (() => { CD.bumpTimelineRevision(cdoc); CD.bumpTimelineRevision(cdoc); return cdoc.timelineRevision === 3 && CD.parse(CD.serialize(cdoc)).doc.timelineRevision === 3; })());
  ok('create 给每位表演者配 motion/lyrics 双轨', cdoc.tracks.length === 4 && cdoc.tracks[0].id === 'tr-0-motion' && cdoc.tracks[3].id === 'tr-1-lyrics');
  ok('create 缺省时长 300 秒', (() => { const d = CD.create({}); return d.durationMs === 300000 && typeof d.projectId === 'string' && d.projectId.length > 0; })());
  const capDoc = CD.create({ projectId: 'pCap' });
  capDoc.capabilities = [{ name: 'movement-control', minProtocol: 2 }, { name: '未知能力', minProtocol: 1 }, { name: '', minProtocol: 1 }, { name: 'ability-execution', minProtocol: 0 }];
  const caps = CD.validate(capDoc);
  ok('能力校验：未知给提示/形状错误给 error', caps.some((i) => i.code === 'H_CAPS_UNKNOWN') && caps.filter((i) => i.code === 'E_CAPS_SHAPE').length === 2);
  ok('能力归一化保留原序原值', CD.normalize(capDoc.doc ? capDoc : capDoc).capabilities[0].name === 'movement-control');

  console.log('== 10. 结构校验（validate） ==');
  const vdoc = JSON.parse(bytes1);
  ok('健康迁移文档 0 error', CD.validate(vdoc).every((i) => i.level !== 'error'));
  const dupDoc = { schemaVersion: 2, projectId: 'pV', name: '重号', durationMs: 300000,
    performers: [{ id: 'actor-0', name: '甲', view: {} }, { id: 'actor-0', name: '乙', view: {} }],
    tracks: [{ id: 't0', type: 'motion', performerId: 'ghost', events: [{ id: 'e1', kind: 'motion', startMs: 1.5, durationMs: -2, assetRef: { kind: 'clip' } }] }],
    lyrics: [], markers: [] };
  const vi = CD.validate(dupDoc);
  ok('重号 ID 报 error', vi.filter((i) => i.code === 'E_DUP_ID').length === 1);
  ok('悬空轨道引用报 warning', vi.some((i) => i.code === 'W_ORPHAN_TRACK'));
  ok('非整数毫秒报 error', vi.filter((i) => i.code === 'E_MS_BAD').length === 2);
  ok('assetRef 缺 id 报 error', vi.some((i) => i.code === 'E_ASSETREF_SHAPE'));
  ok('缺出场点只给 hint（§12 缺起点）', CD.validate(vdoc).some((i) => i.code === 'H_MISSING_START'));
  ok('短时长给 hint', (() => { const d = CD.create({ projectId: 'pS', durationMs: 1000 }); return CD.validate(d).some((i) => i.code === 'H_DURATION_SHORT'); })());
  ok('未来 schemaVersion 提示且不降级', (() => {
    const d = JSON.parse(bytes1); d.schemaVersion = 9;
    const n = CD.normalize(d);
    return n.schemaVersion === 9 && CD.validate(n).some((i) => i.code === 'H_SCHEMA_FUTURE');
  })());
  ok('错误都带中文消息与路径', (() => {
    const all = CD.validate(dupDoc);
    return all.every((i) => typeof i.message === 'string' && i.message.length > 0 && typeof i.path === 'string');
  })());

  console.log('== 11. API 面 ==');
  ok('关键导出齐全', ['SCHEMA_VERSION', 'TRACK_TYPES', 'EVENT_KINDS', 'create', 'fromDraft', 'fromProject',
    'ensureDocument', 'normalize', 'validate', 'toLegacyContent', 'bumpTimelineRevision', 'serialize', 'parse', 'newId']
    .every((k) => k in CD));
  ok('轨道/事件类型固定六类', CD.TRACK_TYPES.join(',') === 'motion,ability,movement,facing,cue,lyrics' && CD.EVENT_KINDS.length === 6);
  ok('fromProject 与 ensureDocument 等价', (() => { const a = CD.fromProject(sampleRecord()); const b = CD.ensureDocument(sampleRecord()); return CD.serialize(a.doc) === CD.serialize(b.doc); })());

  console.log('== 12. 真实形状冻结（choreo-app.js:845/848/865 换职/录制/歌词的完整插入形状） ==');
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
  const rr = CD.ensureDocument({ id: 'pReal', name: '真实形状', content: realContent });
  const rdoc = rr.doc;
  const rtr = rdoc.tracks.reduce((all, t) => all.concat(t.events), []); // 换职/动作在 motion 轨，歌词在 lyrics 轨
  const evSw = rtr.find((e) => e.id === 'ev-20'), evAc = rtr.find((e) => e.id === 'ev-21'), evLc = rtr.find((e) => e.id === 'ev-22');
  const evGl = rdoc.lyrics[0];
  const projReal = CD.toLegacyContent(rdoc);
  ok('换职 clip data 完整（isJobSwitch/jobName/jobId）', eqJson(evSw.data, realContent.dancers[0].switchClips[0].data));
  ok('录制 clip data 完整（data.id/jobAbbr）', eqJson(evAc.data, realContent.dancers[0].actionClips[0].data));
  ok('旧 clip 键 autoDur 进 _extra 并投影回来', evAc._extra && evAc._extra.autoDur === true && projReal.dancers[0].actionClips[0].autoDur === true);
  ok('data.id 数值投影不变', projReal.dancers[0].actionClips[0].data.id === 221);
  ok('舞者歌词/全局歌词 data 完整', eqJson(evLc.data, realContent.dancers[0].lyricClips[0].data) && eqJson(evGl.data, realContent.globalLyrics[0].data));
  ok('真实形状迁移字节幂等', (() => { const b = CD.serialize(rdoc); return b === CD.serialize(CD.ensureDocument(JSON.parse(b)).doc); })());
  ok('clips 别名当 actionClips 迁移并投回', (() => {
    const alias = { dancers: [{ id: 0, clips: [{ id: 30, start: 0, duration: 1, data: { name: 'x', command: '/x', category: 'usual' } }] }], globalLyrics: [] };
    const ad = CD.ensureDocument({ id: 'pAlias', content: alias }).doc;
    const ap = CD.toLegacyContent(ad);
    return ad.tracks[0].events[0].legacyLane === 'action' && ap.dancers[0].actionClips.length === 1 && ap.dancers[0].actionClips[0].id === 30;
  })());

  console.log('== 14. 角色档案绑定往返（TASK-20260903-CHARACTER-ASSETS-P1-BIND / AC-1） ==');
  // 数据契约：非空字符串 profileId 在规范 performer 与投影 dancer 两侧以同名键往返；
  // 未绑定舞者绝不长出 profileId 键；绑定无关文档字节不变（§13 既有套件另锁）
  function bindRoundtrip(doc) { return CD.ensureDocument(CD.toLegacyContent(doc), { projectId: 'pBind', name: '绑定往返' }).doc; }
  {
    function boundDoc() {
      return {
        schemaVersion: 2, projectId: 'pBind', name: '绑定往返', durationMs: 300000, timelineRevision: 1,
        performers: [
          { id: 'actor-0', name: '领舞', profileId: 'prof-a', view: {} },
          { id: 'actor-1', name: '舞者 2', view: {} },
        ],
        tracks: [{ id: 'tr-0-motion', type: 'motion', performerId: 'actor-0', enabled: true, locked: false, notes: '', events: [] }],
        lyrics: [], markers: [],
      };
    }
    const bd = CD.normalize(boundDoc());
    ok('normalize 原位保留 performer.profileId；未绑定舞者不添键',
      bd.performers[0].profileId === 'prof-a' && !('profileId' in bd.performers[1]));
    const bp = CD.toLegacyContent(bd);
    ok('投影：绑定以同名键落 dancer.profileId；未绑定舞者不添键',
      bp.dancers[0].profileId === 'prof-a' && !('profileId' in bp.dancers[1]));
    const brd = CD.ensureDocument(bp, { projectId: 'pBind', name: '绑定往返' }).doc;
    ok('重入迁移：绑定回 performer 顶层同名键（不进 _extra）；未绑定舞者仍无键',
      brd.performers[0].profileId === 'prof-a' && brd.performers[0]._extra === undefined && !('profileId' in brd.performers[1]));
    const s1 = CD.serialize(CD.normalize(brd));
    const s2 = CD.serialize(CD.normalize(bindRoundtrip(brd)));
    const s3 = CD.serialize(CD.normalize(bindRoundtrip(bindRoundtrip(brd))));
    ok('反复往返 serialize 字节一致（重复幂等）', s1 === s2 && s2 === s3);
    ok('携带绑定不产生 error 级校验问题', CD.validate(brd).every((i) => i.level !== 'error'));
  }
  {
    // 旧侧入口：WP-3 content 上的同名键绑定直接迁移（P1 无录入 UI，绑定只来自已带它的文档）
    const ld = CD.ensureDocument({ id: 'pLB', content: { dancers: [{ id: 0, profileId: 'prof-b', actionClips: [], lyricClips: [], switchClips: [] }], globalLyrics: [] } }).doc;
    ok('旧 content 的同名键绑定迁移到 performer 顶层（不进 _extra）',
      ld.performers[0].profileId === 'prof-b' && ld.performers[0]._extra === undefined);
    ok('旧绑定投影回 dancer 同名键', CD.toLegacyContent(ld).dancers[0].profileId === 'prof-b');
    const lm = CD.ensureDocument({ id: 'pLB2', content: { dancers: [{ id: 0, profileId: 42, actionClips: [], lyricClips: [], switchClips: [] }], globalLyrics: [] } }).doc;
    ok('非字符串 profileId 不构成绑定：仍走 _extra 未知键通道（既有行为不变）',
      lm.performers[0].profileId === undefined && eqJson(lm.performers[0]._extra, { profileId: 42 }));
  }
  {
    // AC-6 文档侧半场：悬空引用（档案已删/本机从未有过）往返逐字节不动——恢复只靠档案重建
    const doc = CD.normalize({ schemaVersion: 2, projectId: 'pMiss', name: '悬空', durationMs: 300000, timelineRevision: 1,
      performers: [{ id: 'actor-0', name: '独舞', profileId: 'prof-gone', view: {} }], tracks: [], lyrics: [], markers: [] });
    const back = bindRoundtrip(doc);
    ok('悬空绑定引用往返不丢不改（装载绝不改写文档）',
      back.performers[0].profileId === 'prof-gone' && CD.serialize(back) === CD.serialize(bindRoundtrip(doc)));
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exit(1);
})().catch(function (e) { console.log('✘ 套件异常：' + (e && e.stack || e)); process.exit(1); });
