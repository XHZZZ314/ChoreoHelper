/* test-projects.js —— 项目存储层（web\choreo-projects.js）node 单测（WP-3 第一增量）
这个文件是干嘛的：
  用 node 直接跑（D:\nodejs\node.exe web\test-projects.js），不依赖浏览器：
  - 纯逻辑函数：旧草稿迁移、clip id 扫描、崩溃恢复取新、版本封顶、最近打开排序
  - 存储层集成：经 useBackend 注入内存假库 + _useLocalStorage 注入内存 storage，
    跑通 init 迁移 / CRUD / 版本封顶 / 崩溃恢复 / 降级 等异步链路
  和 test-engine.js 同一套路：✔/✘ 打点，结尾报通过/失败数，失败置退出码 1。
*/
'use strict';
require('./choreo-projects.js');
const CP = globalThis.ChoreoProjects;
const pure = CP.pure;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
}
function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- 内存假库 / 内存 storage ----------
function memBackend() {
  const projects = new Map(), versions = new Map();
  return {
    getAllProjects: async () => [...projects.values()],
    getProject: async (id) => projects.get(id) || null,
    putProject: async (p) => { projects.set(p.id, p); },
    deleteProject: async (id) => { projects.delete(id); },
    getVersionsOf: async (pid) => [...versions.values()].filter((v) => v.projectId === pid),
    getVersion: async (pid, savedAt) => versions.get(pid + '|' + savedAt) || null,
    putVersion: async (v) => { versions.set(v.projectId + '|' + v.savedAt, v); },
    deleteVersion: async (pid, savedAt) => { versions.delete(pid + '|' + savedAt); },
    deleteVersionsOf: async (pid) => {
      [...versions.keys()].forEach((k) => { if (k.startsWith(pid + '|')) versions.delete(k); });
    },
    _counts: {
      get projects() { return projects.size; },
      get versions() { return versions.size; },
    },
  };
}
function memLs() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function freshStorage() {
  const ls = memLs();
  CP._useLocalStorage(ls);
  return ls;
}

(async function main() {
  console.log('== 1. 旧草稿迁移纯函数 ==');
  const draft = {
    dancers: [{ id: 0, name: '舞者 1', actionClips: [{ id: 7, start: 0, duration: 3, data: { name: '鞠躬', command: '/bow', category: 'usual' } }], switchClips: [], lyricClips: [] }],
    globalLyrics: [{ id: 9, start: 1, duration: 2, data: { name: '啦啦啦', command: '/y 啦啦啦', category: 'lyric', isLyric: true } }],
    dancerCount: 1, showLyricMacro: true, totalDuration: 420,
  };
  const rec = pure.legacyToProject(draft, 1000);
  // WP-3b：schema 升到 2（content 新增可选 markers、舞者 solo/mute，旧数据装载时补默认值）
  ok('迁移生成记录：schemaVersion=2', rec.schemaVersion === 2);
  ok('迁移生成记录：名字是「我的编舞」', rec.name === '我的编舞');
  ok('迁移保留 dancers（内容逐项一致）', eqJson(rec.content.dancers, draft.dancers));
  ok('迁移保留 globalLyrics', eqJson(rec.content.globalLyrics, draft.globalLyrics));
  ok('迁移保留 showLyricMacro=true', rec.content.showLyricMacro === true);
  ok('迁移保留 totalDuration=420', rec.content.totalDuration === 420);
  ok('迁移保留 dancerCount', rec.content.dancerCount === 1);
  ok('空/坏草稿返回 null（调用方走默认项目）', pure.legacyToProject(null) === null && pure.legacyToProject({ dancers: [] }) === null);
  const rec2 = pure.legacyToProject({ dancers: [{ id: 0, actionClips: [], switchClips: [], lyricClips: [] }] }, 1000);
  ok('缺字段兜底：globalLyrics=[]、showLyricMacro=false、totalDuration=300',
    eqJson(rec2.content.globalLyrics, []) && rec2.content.showLyricMacro === false && rec2.content.totalDuration === 300);
  ok('defaultRecord：1 舞者空项目、totalDuration=300',
    pure.defaultRecord(5).content.dancerCount === 1 && pure.defaultRecord(5).content.totalDuration === 300 && pure.defaultRecord(5).createdAt === 5);

  console.log('== 1b. schema 2 迁移（normalizeContent） ==');
  const old5 = { dancers: [{ id: 0, actionClips: [], switchClips: [], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 };
  normalizeAssert(old5);
  function normalizeAssert(ct) {
    const before = JSON.parse(JSON.stringify(ct));
    pure.normalizeContent(ct);
    ok('补 markers=[]（旧内容没有该字段）', Array.isArray(ct.markers) && ct.markers.length === 0);
    ok('舞者补 solo/mute=false', ct.dancers[0].solo === false && ct.dancers[0].mute === false);
    ok('原有 5 字段无损（dancers 长度/id 不变，其余四字段原值）',
      ct.dancers.length === before.dancers.length && ct.dancers[0].id === before.dancers[0].id &&
      eqJson({ g: ct.globalLyrics, c: ct.dancerCount, s: ct.showLyricMacro, t: ct.totalDuration },
        { g: before.globalLyrics, c: before.dancerCount, s: before.showLyricMacro, t: before.totalDuration }));
    const before2 = JSON.stringify(ct);
    pure.normalizeContent(ct);
    ok('幂等：再过一遍不变化', JSON.stringify(ct) === before2);
  }
  ok('坏入参不炸（null/非对象原样返回）', pure.normalizeContent(null) === null && pure.normalizeContent('x') === 'x');
  const half = { dancers: [{ id: 0, actionClips: [], switchClips: [], lyricClips: [], solo: true }], markers: [{ id: 'm1', t: 3, name: '段落1' }] };
  pure.normalizeContent(half);
  ok('已带新字段的内容不覆盖（solo=true 保留、markers 原样）', half.dancers[0].solo === true && half.markers.length === 1 && half.dancers[0].mute === false);

  console.log('== 2. contentMaxClipId / newerSource / capVersions / sortIndex ==');
  const draft2 = {
    dancers: [
      { id: 0, actionClips: [{ id: 3 }, { id: 41 }], switchClips: [{ id: 2 }], lyricClips: [] },
      { id: 1, actionClips: [], switchClips: [], lyricClips: [{ id: 17 }] },
    ],
    globalLyrics: [{ id: 23 }],
  };
  ok('扫三轨+全局歌词取最大 clip id（41）', pure.contentMaxClipId(draft2) === 41);
  ok('空内容返回 0', pure.contentMaxClipId({}) === 0);
  const r0 = { id: 'pA', updatedAt: 100 };
  ok('镜像更新 → mirror', pure.newerSource({ projectId: 'pA', savedAt: 200, content: {} }, r0) === 'mirror');
  ok('镜像更旧 → idb', pure.newerSource({ projectId: 'pA', savedAt: 50, content: {} }, r0) === 'idb');
  ok('镜像相等 → idb（以库为准）', pure.newerSource({ projectId: 'pA', savedAt: 100, content: {} }, r0) === 'idb');
  ok('镜像是别的项目 → none', pure.newerSource({ projectId: 'pB', savedAt: 999, content: {} }, r0) === 'none');
  ok('镜像缺内容 → none', pure.newerSource({ projectId: 'pA', savedAt: 999 }, r0) === 'none');
  ok('镜像/记录缺失 → none', pure.newerSource(null, r0) === 'none' && pure.newerSource({ projectId: 'pA', savedAt: 9, content: {} }, null) === 'none');
  const vs = [];
  for (let i = 1; i <= 25; i++) vs.push({ savedAt: i * 10 });
  ok('封顶：25 个留 20，删的是最旧 5 个（待删列表按新→旧排）', eqJson(pure.capVersions(vs, 20).map((v) => v.savedAt), [50, 40, 30, 20, 10]));
  ok('封顶：不足上限一个不删', pure.capVersions(vs.slice(0, 3), 20).length === 0);
  ok('排序：updatedAt 新的在前', eqJson(pure.sortIndex([{ id: 1, updatedAt: 5 }, { id: 2, updatedAt: 9 }, { id: 3, updatedAt: 1 }]).map((x) => x.id), [2, 1, 3]));

  console.log('== 3. 存储层集成：首次初始化（无旧草稿 → 默认项目） ==');
  {
    freshStorage();
    const mb = memBackend();
    CP.useBackend(mb);
    const out = await CP.init();
    ok('init 返回未迁移、未降级', out.migrated === false && out.degraded === false);
    const list = await CP.listProjects();
    ok('自动建了 1 个默认项目', list.length === 1, JSON.stringify(list.map((p) => p.name)));
    ok('迁移版本快照没有（空库走默认项目不该有「迁移自旧草稿」）', (await CP.listVersions(list[0].id)).length === 0);
    const opened = await CP.openProject(null);
    ok('无 activeId 也能打开最近项目', !!opened.record && opened.recovered === false);
    ok('activeId 已指向它', CP.getActiveId() === opened.record.id);
  }

  console.log('== 4. 存储层集成：旧草稿迁移 + 备份 + 不重复迁移 ==');
  {
    const ls = freshStorage();
    const rawDraft = JSON.stringify(draft);
    ls.setItem('choreo_draft', rawDraft);
    const mb = memBackend();
    CP.useBackend(mb);
    const out = await CP.init();
    ok('迁移发生了', out.migrated === true && out.name === '我的编舞');
    ok('旧草稿原文备份逐字节一致', ls.getItem('choreo_draft_backup_20260829') === rawDraft);
    ok('原 choreo_draft 键没动', ls.getItem('choreo_draft') === rawDraft);
    const list = await CP.listProjects();
    ok('就迁了 1 个项目', list.length === 1, String(list.length));
    const opened = await CP.openProject(null);
    ok('迁移后项目内容与旧草稿一致',
      eqJson(opened.record.content.dancers, draft.dancers) && eqJson(opened.record.content.globalLyrics, draft.globalLyrics));
    ok('迁移时有「迁移自旧草稿」版本', (await CP.listVersions(opened.record.id)).some((v) => v.label === '迁移自旧草稿'));
    const out2 = await CP.init();
    ok('第二次 init 不重复迁移', out2.migrated === false);
    ok('第二个 init 后仍只有 1 个项目', (await CP.listProjects()).length === 1);
    // 迁移标志丢了但库里已有项目：不能再迁出第二份
    ls.removeItem('choreo_migrated_v1');
    await CP.init();
    ok('标志丢失+库里有项目 → 不重复迁移', (await CP.listProjects()).length === 1);
  }

  console.log('== 5. CRUD：新建/改名/复制/删除/最近打开 ==');
  {
    freshStorage();
    const mb = memBackend();
    CP.useBackend(mb);
    await CP.init();
    const first = await CP.openProject(null);
    const created = await CP.createProject('测试乙', { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 });
    ok('新建项目出现在清单', (await CP.listProjects()).some((p) => p.id === created.id));
    CP.setActiveId(created.id);
    const renamed = await CP.renameProject(created.id, '改名后的项目');
    ok('改名生效', (await CP.listProjects()).find((p) => p.id === created.id).name === '改名后的项目');
    // 最近打开排序：改名动了 updatedAt → 改名的项目排最前（此刻它就是最新编辑的）
    let order = (await CP.listProjects()).map((p) => p.id);
    ok('最近编辑的排最前', order[0] === created.id, JSON.stringify(order));
    await new Promise((r) => setTimeout(r, 5));
    const copy = await CP.duplicateProject(first.record.id);
    ok('副本名字带「副本」', copy.name === '我的编舞 副本');
    ok('副本内容与源一致', eqJson(copy.content, first.record.content));
    ok('副本是新 id', copy.id !== first.record.id);
    // 副本创建时间更新 → 副本排最前
    order = (await CP.listProjects()).map((p) => p.id);
    ok('刚复制的副本排最前', order[0] === copy.id, JSON.stringify(order));
    await CP.deleteProject(copy.id);
    ok('删除后清单减一', (await CP.listProjects()).length === 2);
    ok('删除连带清版本', (await CP.listVersions(copy.id)).length === 0);
    // 找不存在的 id：回落到最近编辑的项目而不是报错
    const fb = await CP.openProject('不存在');
    ok('openProject 传不存在 id 回落到最近项目', fb.record && fb.record.id === created.id);
    // 库被清空后再 open：自动造默认项目
    await CP.deleteProject(created.id);
    await CP.deleteProject(first.record.id);
    const again = await CP.openProject(null);
    ok('空库 openProject 自动造默认项目', (await CP.listProjects()).length === 1 && !!again.record);
  }

  console.log('== 6. 保存 + 崩溃恢复（镜像比库新 → 按镜像恢复） ==');
  {
    const ls = freshStorage();
    const mb = memBackend();
    CP.useBackend(mb);
    await CP.init();
    const op = await CP.openProject(null);
    const recA = op.record;
    recA.content.dancers = [{ id: 0, name: '库里版本', actionClips: [], switchClips: [], lyricClips: [] }];
    await CP.saveActive(recA);
    const m1 = CP._readMirror();
    ok('saveActive 同步写了镜像', !!m1 && m1.projectId === recA.id);
    ok('镜像 savedAt = 记录 updatedAt', m1.savedAt === recA.updatedAt);
    // 模拟崩溃：IDB 停在旧内容，镜像被同步写了更新的内容（正常流程里镜像总是最新）
    recA.updatedAt = Date.now() - 9999; // 把库里的记录人为拨旧
    mb.putProject(JSON.parse(JSON.stringify(recA)));
    const m2 = CP._readMirror();
    m2.savedAt = Date.now();
    m2.content = { dancers: [{ id: 0, name: '崩溃前最后一刻', actionClips: [], switchClips: [], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 };
    ls.setItem('choreo_autosave', JSON.stringify(m2));
    const rec = await CP.openProject(recA.id);
    ok('镜像更新 → 判定 recovered', rec.recovered === true);
    ok('恢复出的内容来自镜像', rec.record.content.dancers[0].name === '崩溃前最后一刻');
    const vs = await CP.listVersions(recA.id);
    ok('恢复时自动存「异常关闭自动恢复」版本', vs.some((v) => v.label === '异常关闭自动恢复'), JSON.stringify(vs.map((v) => v.label)));
    // 反向：镜像比库旧 → 不恢复，按库来
    const m3 = CP._readMirror();
    m3.savedAt = 1; m3.content.dancers[0].name = '陈旧镜像';
    ls.setItem('choreo_autosave', JSON.stringify(m3));
    const rec4 = await CP.openProject(recA.id);
    ok('镜像陈旧 → 不恢复', rec4.recovered === false && rec4.record.content.dancers[0].name === '崩溃前最后一刻');
    // 镜像是别的项目的陈旧垃圾 → 清掉
    const m5 = CP._readMirror(); m5.projectId = 'p别的'; ls.setItem('choreo_autosave', JSON.stringify(m5));
    const rec5 = await CP.openProject(recA.id);
    ok('别项目的陈旧镜像被清掉', CP._readMirror() === null && rec5.recovered === false);
  }

  console.log('== 7. 版本快照：手动/恢复前存档/封顶 ==');
  {
    freshStorage();
    CP.useBackend(memBackend());
    await CP.init();
    const op = await CP.openProject(null);
    const pid = op.record.id;
    for (let i = 1; i <= 25; i++) await CP.addVersion(pid, 'v' + i, { n: i }, true);
    let vs = await CP.listVersions(pid);
    ok('超过 20 个自动删最旧', vs.length === 20, String(vs.length));
    ok('留下的是最新的 20 个（v6~v25）', vs[0].label === 'v25' && vs[19].label === 'v6', vs.map((v) => v.label).join(','));
    const got = await CP.getVersion(pid, vs[19].savedAt);
    ok('按 savedAt 取回版本内容', got && got.content && got.content.n === 6);
    ok('清单带 auto/size 字段', typeof vs[0].auto === 'boolean' && typeof vs[0].size === 'number');
  }

  console.log('== 8. 降级模式（IndexedDB 打不开 → 单项目镜像） ==');
  {
    freshStorage();
    CP.useBackend({
      getAllProjects: () => Promise.reject(new Error('boom')),
      getProject: () => Promise.reject(new Error('boom')), putProject: () => Promise.reject(new Error('boom')),
      deleteProject: () => Promise.reject(new Error('boom')), getVersionsOf: () => Promise.reject(new Error('boom')),
      getVersion: () => Promise.reject(new Error('boom')), putVersion: () => Promise.reject(new Error('boom')),
      deleteVersion: () => Promise.reject(new Error('boom')), deleteVersionsOf: () => Promise.reject(new Error('boom')),
    });
    const out = await CP.init();
    ok('init 判定降级', out.degraded === true && CP.isDegraded() === true);
    const op = await CP.openProject(null);
    ok('降级下仍给出可编辑的项目', !!op.record && !!op.record.content);
    const r = { id: op.record.id, name: '降级项目', content: { dancers: [1], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 } };
    await CP.saveActive(r);
    ok('降级保存落在镜像里', CP._readMirror() && CP._readMirror().name === '降级项目');
    ok('降级清单只有这一个', (await CP.listProjects()).length === 1);
    let threw = false;
    try { await CP.createProject('不该成功'); } catch (e) { threw = true; }
    ok('降级下新建项目明确拒绝', threw);
    ok('降级下版本快照空转不炸', (await CP.addVersion(r.id, 'x', {}, true)) === false && (await CP.listVersions(r.id)).length === 0);
  }

  console.log('== 9. saveActive 时 IDB 写失败 → 镜像兜底、下次打开恢复 ==');
  {
    freshStorage();
    let broken = false;
    const mb = memBackend();
    const flaky = Object.assign({}, mb, {
      putProject: async (p) => { if (broken) throw new Error('quota'); return mb.putProject(p); },
    });
    CP.useBackend(flaky);
    await CP.init();
    const op = await CP.openProject(null);
    op.record.content.dancers = [{ id: 0, name: '镜像独存', actionClips: [], switchClips: [], lyricClips: [] }];
    broken = true;
    await CP.saveActive(op.record); // IDB 挂了，镜像应该照写
    broken = false;
    // 把库里的记录拨回“旧内容 + 旧时间”——下次打开时只有镜像上有最新内容
    op.record.content = { dancers: [{ id: 0, name: '库里旧版', actionClips: [], switchClips: [], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 };
    op.record.updatedAt = Date.now() - 5000;
    await mb.putProject(JSON.parse(JSON.stringify(op.record)));
    const rec = await CP.openProject(op.record.id);
    ok('IDB 写失败后镜像兜底恢复', rec.recovered === true && rec.record.content.dancers[0].name === '镜像独存',
      'recovered=' + rec.recovered + ' 内容=' + (rec.record.content.dancers[0] || {}).name);
  }

  console.log('== 11. 删除当前项目防复活（AUD-006） ==');
  {
    freshStorage();
    const mb = memBackend();
    CP.useBackend(mb);
    await CP.init();
    const p1 = (await CP.listProjects())[0];
    const p2 = await CP.createProject('乙项目');
    await CP.openProject(p1.id);
    CP.setActiveId(p1.id);
    await CP.deleteProject(p1.id);
    ok('删除后列表里没有它', !(await CP.listProjects()).some((p) => p.id === p1.id));
    ok('镜像被清（不再指向被删项目）', CP._readMirror() === null);
    ok('活动指针被清', CP.getActiveId() === null);
    // 审计复现样例：主页自动保存仍拿着被删项目的记录调 saveActive → 不许复活
    const stale = { id: p1.id, name: p1.name, createdAt: p1.createdAt, updatedAt: 0, schemaVersion: 2,
      content: { dancers: [{ id: 0, name: '复活条', actionClips: [], switchClips: [], lyricClips: [] }],
        globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 } };
    await CP.saveActive(JSON.parse(JSON.stringify(stale)));
    ok('被删项目不能被 saveActive 复活', !(await CP.listProjects()).some((p) => p.id === p1.id));
    ok('被拒的 saveActive 不写镜像', CP._readMirror() === null);
    await CP.deleteProject(p2.id);
    ok('非当前项目照常可删', (await CP.listProjects()).length === 0);
    // 新会话（init）重置 tombstone——同 id 场景在真实产品里不存在（id 不复用），只验证不误伤新保存
    await CP.init();
    const p3 = await CP.createProject('新会话项目');
    await CP.saveActive({ id: p3.id, name: p3.name, createdAt: p3.createdAt, updatedAt: 0, schemaVersion: 2,
      content: { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 } });
    ok('init 重置后新项目保存照常', (await CP.listProjects()).some((p) => p.id === p3.id) && CP._readMirror() && CP._readMirror().projectId === p3.id);
  }

  await optFTests(); // OPT-F（AUD2-011）追加节在 process.exit 前跑完

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (e) {
  console.error('测试执行出错：', e);
  process.exit(1);
});

// ---- 以下由 OPT-F（AUD2-011）追加 ----
// 假 IndexedDB：模型「request 成功 ≠ 事务提交」语义——变更先 staged，事务提交才落库；
// abort 则全部丢弃（等价真 IDB 回滚）。写事务在请求排空后（游标步进完）才提交/回滚；
// 只读事务只答请求、不提交不消费故障注入；错误经 t.error 带出（真 IDB 同名属性）
function fakeIdb() {
  const stores = { projects: new Map(), versions: new Map() };
  let mode = 'ok'; // 'ok' | 'abort' | 'error'
  const db = {
    _stores: stores,
    _failNext(m) { mode = m; },
    transaction(names, txMode) {
      const staged = [];
      const t = { oncomplete: null, onabort: null, onerror: null, _pending: 0 };
      const applyOrDrop = () => {
        if (mode === 'abort') { mode = 'ok'; const e = new Error('QuotaError（模拟 abort）'); t.error = e; t.onabort && t.onabort(e); return; }
        if (mode === 'error') { mode = 'ok'; const e = new Error('IOError（模拟 error）'); t.error = e; t.onerror && t.onerror(e); return; }
        staged.forEach((f) => f());
        t.oncomplete && t.oncomplete();
      };
      // 真 IDB 语义：①事务要等请求全部完成才提交（游标在步进就等它）；②故障注入只让写事务吃掉
      const tryFinish = () => { if (t._pending > 0) { setTimeout(tryFinish, 0); return; } applyOrDrop(); };
      if (txMode === 'readwrite') setTimeout(tryFinish, 0); // 只读事务从不提交/回滚，只答请求
      t.objectStore = (name) => ({
        put: (rec) => { const k = name === 'projects' ? rec.id : rec.projectId + '|' + rec.savedAt; staged.push(() => stores[name].set(k, JSON.parse(JSON.stringify(rec)))); },
        delete: (k) => { staged.push(() => stores[name].delete(k)); },
        // 真 IDB 的结果挂在 request.result 属性上（不是 onsuccess 事件参数），且是结构化克隆
        //（假件深拷贝代劳——活引用会让「abort 回滚」假测试失效）
        get: (k) => { const v = stores[name].get(k); const rq = { result: v && JSON.parse(JSON.stringify(v)) }; setTimeout(() => { rq.onsuccess && rq.onsuccess({ target: { result: rq.result } }); }, 0); return rq; },
        getAll: () => { const rq = { result: [...stores[name].values()].map((v) => JSON.parse(JSON.stringify(v))) }; setTimeout(() => { rq.onsuccess && rq.onsuccess({ target: { result: rq.result } }); }, 0); return rq; },
        index: () => ({
          getAll: (pid) => { const rq = { result: [...stores.versions.values()].filter((v) => v.projectId === pid).map((v) => JSON.parse(JSON.stringify(v))) }; setTimeout(() => { rq.onsuccess && rq.onsuccess({ target: { result: rq.result } }); }, 0); return rq; },
          openCursor: (range) => {
            const rq = {};
            t._pending++; // 游标请求在途：同步登记，事务提交要等它排空
            setTimeout(() => {
              const matches = [...stores.versions.values()].filter((v) => v.projectId === range.__only);
              let i = 0;
              const step = () => {
                t._pending--;
                if (i < matches.length) {
                  const v = matches[i++];
                  const c = { delete: () => staged.push(() => stores.versions.delete(v.projectId + '|' + v.savedAt)), continue: () => { t._pending++; setTimeout(step, 0); } };
                  rq.onsuccess && rq.onsuccess({ target: { result: c } });
                } else { rq.onsuccess && rq.onsuccess({ target: { result: null } }); }
              };
              step();
            }, 0);
            return rq;
          },
        }),
      });
      return t;
    },
  };
  return db;
}

async function optFTests() {
  if (typeof globalThis.IDBKeyRange === 'undefined') globalThis.IDBKeyRange = { only: (v) => ({ __only: v }) };
  const drain = () => new Promise((r) => setTimeout(r, 30)); // 等假 IDB 的 cursor 步进+提交走完
  const projCount = (db) => db._stores.projects.size;
  const verCount = (db, pid) => [...db._stores.versions.values()].filter((v) => v.projectId === pid).length;

  console.log('== 12. 事务提交语义（AUD2-011：request 成功 ≠ 事务提交） ==');
  {
    freshStorage();
    const db = fakeIdb();
    CP.useBackend(CP._makeIdbBackend(db));
    await CP.init(); await drain();
    const baseCnt = projCount(db); // init 自建的默认项目
    const rec = await CP.createProject('事务提交项目', { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 });
    await drain();
    ok('正常提交：项目落库', projCount(db) === baseCnt + 1 && [...db._stores.projects.values()].some((p) => p.id === rec.id));
  }
  {
    freshStorage();
    const db = fakeIdb();
    CP.useBackend(CP._makeIdbBackend(db));
    await CP.init(); await drain();
    let threw = '';
    db._failNext('abort');
    try { await CP.createProject('该失败'); } catch (e) { threw = e.message; }
    await drain();
    ok('事务 abort → createProject 明确 reject（不误报成功）', threw.indexOf('QuotaError') >= 0, threw);
    ok('abort 回滚：库里没有半条记录', projCount(db) === 1, '库内=' + projCount(db));

    // 各写 API 都以事务提交为成功标准
    const rec = await CP.createProject('甲'); await drain();
    db._failNext('abort');
    let putRejected = false;
    try { await CP.renameProject(rec.id, '不该生效'); } catch (e) { putRejected = true; }
    await drain();
    ok('事务 abort → renameProject（putProject）reject', putRejected);
    ok('abort 后改名未生效', [...db._stores.projects.values()].find((p) => p.id === rec.id).name === '甲');

    db._failNext('error');
    const verOk = await CP.addVersion(rec.id, 'v', { n: 1 }, false);
    await drain();
    ok('事务 error → addVersion 如实返回 false（不把失败当成功）', verOk === false);
    ok('error 后版本未落库', verCount(db, rec.id) === 0);

    db._failNext('abort');
    const verOk2 = await CP.addVersion(rec.id, 'v2', { n: 2 }, false);
    await drain();
    ok('封顶删除（deleteVersion）随事务 abort 也不报成功', verOk2 === false);
  }

  console.log('== 13. 删除原子性（AUD2-011：项目+版本同一事务） ==');
  {
    freshStorage();
    const db = fakeIdb();
    CP.useBackend(CP._makeIdbBackend(db));
    await CP.init(); await drain();
    const rec = await CP.createProject('带版本的项目'); await drain();
    for (let i = 1; i <= 3; i++) { await CP.addVersion(rec.id, 'v' + i, { n: i }, false); await drain(); }
    ok('前置：项目在、3 版本', [...db._stores.projects.values()].some((p) => p.id === rec.id) && verCount(db, rec.id) === 3);

    // 中途失败（abort）：两处都不能动
    db._failNext('abort');
    let threw = false;
    try { await CP.deleteProject(rec.id); } catch (e) { threw = true; }
    await drain();
    ok('删除 abort → reject', threw);
    ok('abort 回滚：项目和版本原样都在（无半删）',
      [...db._stores.projects.values()].some((p) => p.id === rec.id) && verCount(db, rec.id) === 3);
    ok('失败的删除不登记 tombstone、不清镜像', (await CP.listProjects()).some((p) => p.id === rec.id));
    // tombstone 登记只发生在确认提交之后——删除没成，saveActive 同 id 应仍允许
    await CP.saveActive(rec);
    ok('删除失败的项目仍可正常保存', (await CP.listProjects()).some((p) => p.id === rec.id));

    // 正常提交：项目+版本一起消失
    await CP.deleteProject(rec.id); await drain();
    ok('正常删除：项目和版本一起没了', ![...db._stores.projects.values()].some((p) => p.id === rec.id) && verCount(db, rec.id) === 0);
  }

  console.log('== 14. tombstone 持久化（AUD2-011：清镜像失败也不复活） ==');
  {
    const ls = freshStorage();
    const db = fakeIdb();
    CP.useBackend(CP._makeIdbBackend(db));
    await CP.init(); await drain();
    const rec = await CP.createProject('要删的项目'); await drain();
    await CP.deleteProject(rec.id); await drain();
    ok('删除后 tombstone 进了 localStorage', JSON.parse(ls.getItem('choreo_deleted_projects')).indexOf(rec.id) >= 0);
    // 模拟「删除后清镜像失败」：镜像又指向被删项目
    ls.setItem('choreo_autosave', JSON.stringify({ projectId: rec.id, name: rec.name, savedAt: Date.now(), content: rec.content }));
    await CP.init(); await drain();
    ok('下次 init 补清被删项目的镜像', ls.getItem('choreo_autosave') === null);
    const stale = JSON.parse(JSON.stringify(rec)); stale.updatedAt = Date.now() + 999;
    await CP.saveActive(stale);
    ok('持久 tombstone 继续拦 saveActive 复活', !(await CP.listProjects()).some((p) => p.id === rec.id));
    ok('复活拦截不写镜像', ls.getItem('choreo_autosave') === null);
    // tombstone 上限 200：预填 200 条再删一条，rememberTombstone 裁最旧
    const big = []; for (let i = 0; i < 200; i++) big.push('旧' + i);
    ls.setItem('choreo_deleted_projects', JSON.stringify(big));
    const oneMore = await CP.createProject('再删一个'); await drain();
    await CP.deleteProject(oneMore.id); await drain();
    const afterList = JSON.parse(ls.getItem('choreo_deleted_projects'));
    ok('tombstone 封顶 200 条且新登记在内', afterList.length === 200 && afterList.indexOf(oneMore.id) >= 0);
  }
}
