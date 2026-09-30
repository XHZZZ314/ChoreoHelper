// make-offline-assets.js — 生成网页离线启动要用的三份内置快照（阶段 2）
//
// 干嘛的：游戏/插件全关时双击打开网页（file://），侧栏动作目录和 3D 面板也要能立起来。
//        本脚本趁游戏开着，把 48794 的动作目录、48795 的参考骨架、替身模型打包成
//        三个经典脚本（挂 window 全局——file:// 下 fetch 本地文件被浏览器禁，只能走 <script>）：
//          catalog-snapshot.js   → window.__CHOREO_CATALOG__（目录快照，带 gameVersion/savedAt）
//          skeleton-snapshot.js  → window.__CHOREO_SKELETON_SNAPSHOT__（101 骨参考骨架）
//          standin-model.js      → window.__CHOREO_STANDIN_MODEL__（替身模型 glTF，buffer 内嵌 base64）
// 怎么跑：游戏开着的时候跑  D:\nodejs\node.exe scripts\make-offline-assets.js
//        （游戏没开就拉不到目录/骨架，会报错退出；替身模型部分不受影响）
// 何时重跑：游戏大版本更新、动作目录变了，或想刷新骨架——重跑覆盖即可。
//        产物是生成物，直接写进部署位 web\dist\ChoreoHelper\，不进 git 也不手改。

'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper');
const GAME_API = 'http://localhost:48794';
const EXPORT_API = 'http://localhost:48795';

// SEC-1 之后 48795 的 /export/* 一律要配对码（与网页配对同语义）。读本机插件的
// pairing.json——首次 /choreo pair 后永久不变，只在本机用，不进日志/文档/公开包。
function readPairingCode() {
  try {
    const p = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).code || '';
  } catch (e) { return ''; }
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  if (!r.ok) throw new Error(url + ' 返回 ' + r.status);
  return r.json();
}

// 只保留网页真用到的字段（见 choreo-helper-app.html 的目录消费点），瘦身体积
function slimEmote(e) { return { id: e.id, name: e.name, command: e.command, category: e.category, timelineKeys: e.timelineKeys, isLoop: e.isLoop }; }
function slimAction(a) {
  const out = { id: a.id, type: a.type, name: a.name, command: a.command, category: a.category, duration: a.duration, jobName: a.jobName, jobId: a.jobId, jobAbbr: a.jobAbbr, targetRules: a.targetRules };
  const m = a.staticMetadata;
  // 与网页 ChoreoSkillMetadata.read 的完整性门禁一致；duration 不是咏唱来源，缺值不补零。
  if (a.type === 'action' && Number.isSafeInteger(a.id) && a.id > 0 && m && m.version === 1 && m.actionId === a.id
    && ['castMs', 'recastMs', 'requiredLevel', 'maxCharges'].every(k => Number.isSafeInteger(m[k]) && m[k] >= 0)
    && m.castMs <= 86400000 && m.recastMs <= 86400000 && ['range', 'effectRange'].every(k => Number.isFinite(m[k])))
    out.staticMetadata = { ...m };
  return out;
}
function slimRace(r) { return { id: r.id, masculine: r.masculine, feminine: r.feminine }; }
function slimJob(j) { return { id: j.id, name: j.name, abbreviation: j.abbreviation, parent: j.parent, role: j.role, jobIndex: j.jobIndex }; }

async function main() {
  // 1) 目录（48794）。actions/classJobs 在生成端就套用网页同款过滤（jobName/name 非空），网页端过滤保持幂等
  const [ed, rd, ad, cd] = await Promise.all([
    getJson(GAME_API + '/actions/emotes'),
    getJson(GAME_API + '/actions/races'),
    getJson(GAME_API + '/actions'),
    getJson(GAME_API + '/classjobs').catch(function () { return { classJobs: [] }; }),
  ]);
  const catalog = {
    gameVersion: ad.gameVersion || '',
    savedAt: new Date().toISOString().slice(0, 10),
    emotes: (ed.emotes || []).map(slimEmote),
    races: (rd.races || []).filter(function (r) { return r.id > 0; }).map(slimRace),
    actions: (ad.actions || []).filter(function (a) { return a.jobName && a.jobName.length > 0; }).map(slimAction),
    classJobs: (cd.classJobs || []).filter(function (j) { return j.name && j.name.length > 0; }).map(slimJob),
  };

  // 2) 参考骨架（48795，SEC-1 私有读：必须带配对码）
  const pairCode = readPairingCode();
  if (!pairCode) throw new Error('读本机 pairing.json 失败（%APPDATA%\\XIVLauncherCN\\pluginConfigs\\ChoreoHelper）'
    + '——SEC-1 后骨架快照要配对码，先在游戏里 /choreo pair 配对一次');
  const sk = await getJson(EXPORT_API + '/export/skeleton', { 'X-Choreo-Token': pairCode });
  if (!sk || !sk.bones || !sk.count) throw new Error('骨架数据无效（要游戏开着、角色在场才有）');

  // 3) 替身模型（web\model-standin.gltf，buffer 内嵌 base64、无外部文件）
  const standinRaw = fs.readFileSync(path.join(__dirname, '..', 'web', 'model-standin.gltf'), 'utf8');
  const standin = JSON.parse(standinRaw.replace(/^\uFEFF/, ''));

  const head = function (what) {
    return '// ' + what + '（scripts\\make-offline-assets.js 生成，勿手改；重跑刷新）\n' +
      '// 游戏大版本更新或动作目录变化后，开着游戏重跑生成脚本即可\n';
  };
  fs.writeFileSync(path.join(DIST, 'catalog-snapshot.js'),
    head('内置动作目录快照：游戏没开时侧栏动作面板的数据源') +
    'window.__CHOREO_CATALOG__ = ' + JSON.stringify(catalog) + ';\n', 'utf8');
  fs.writeFileSync(path.join(DIST, 'skeleton-snapshot.js'),
    head('内置参考骨架快照：3D 面板离线时的骨骼参考') +
    'window.__CHOREO_SKELETON_SNAPSHOT__ = ' + JSON.stringify(sk) + ';\n', 'utf8');
  fs.writeFileSync(path.join(DIST, 'standin-model.js'),
    head('内置替身模型（101 同名骨骼 + 腰部方块蒙皮）：3D 面板离线兜底显示') +
    'window.__CHOREO_STANDIN_MODEL__ = ' + JSON.stringify(standin) + ';\n', 'utf8');

  const size = function (f) { return fs.statSync(path.join(DIST, f)).size; };
  console.log('目录快照 catalog-snapshot.js: ' + size('catalog-snapshot.js') + ' 字节' +
    '（表情 ' + catalog.emotes.length + ' / 种族 ' + catalog.races.length +
    ' / 技能 ' + catalog.actions.length + ' / 职业 ' + catalog.classJobs.length + '，游戏版本 ' + catalog.gameVersion + '）');
  console.log('骨架快照 skeleton-snapshot.js: ' + size('skeleton-snapshot.js') + ' 字节（' + sk.count + ' 骨）');
  console.log('替身模型 standin-model.js: ' + size('standin-model.js') + ' 字节');
  console.log('完成。');
}
module.exports = { slimAction, slimEmote, slimRace, slimJob };
if (require.main === module) main().catch(function (e) { console.error('生成失败：' + (e && e.message ? e.message : e)); process.exit(1); });
