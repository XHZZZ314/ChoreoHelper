/* choreo-projects.js —— 项目存储层（WP-3 第一增量，v0.7）
这个文件是干嘛的：
  把编舞从「浏览器里只有一份自动草稿（choreo_draft）」升级成多项目管理：
  - 多项目存 IndexedDB（库名 choreo3dproj，和 3D 资料库 choreo3dlib 是两个库——
    清空资料库不会动到编舞项目）。每个项目一条记录：
    { id, name, createdAt, updatedAt, schemaVersion, content }
  - content 是旧草稿的 5 个字段（dancers/globalLyrics/dancerCount/showLyricMacro/
    totalDuration）+ schema 2 起的可选扩展（markers 段落标记、舞者 solo/mute 独奏静音）；
    旧内容装载时经 pure.normalizeContent 就地补默认值，无损升级；统一演出脚本 schema 是 WP-5 的事
  - 双写保险：每次编辑主页会调 saveActive——先【同步】写 localStorage 镜像 choreo_autosave
    （和旧草稿同样的同步写法，浏览器崩溃/强杀也在），再异步写 IndexedDB；下次打开时
    若镜像比库里新（上次 IDB 没写完就关了），按镜像恢复并自动存一个「异常关闭自动恢复」版本
  - 旧草稿迁移：首次打开且还没有任何项目时，自动把 choreo_draft 变成项目「我的编舞」；
    原文逐字节备份到 choreo_draft_backup_20260829（原键不删不覆写，双保险）；
    choreo_migrated_v1 标志防重复迁移
  - 历史版本：versions 仓按项目存快照，每项目最多 MAX_VERSIONS 个，超出自动删最旧
  - AUD2-011（2026-08-30）事务语义收口：写操作以 transaction.oncomplete 为成功标准
    （request 成功但事务 abort 不再被误报成功）；删项目连它的历史版本同一事务删，
    不再有「项目删了版本还在」的半删状态；删除登记 tombstone 持久化进 localStorage——
    就算删除后清镜像失败，下次 init 也会补清镜像并继续拦 saveActive 复活
  - 降级：IndexedDB 打不开（个别浏览器隐私模式等）→ 单项目模式：只靠镜像记住当前
    这一份，多项目窗口会提示不可用；编辑和自动保存完全不受影响
无依赖，经典脚本（file:// 双击可用）。主页经 window.ChoreoProjects 调用；
纯逻辑函数在 ChoreoProjects.pure，node 单测（web\test-projects.js）经 useBackend 注入内存假库。
*/
(function () {
  'use strict';

  var DB_NAME = 'choreo3dproj', DB_VERSION = 1;
  var K_MIRROR = 'choreo_autosave';            // 当前项目最新内容的同步镜像（崩溃恢复依据）
  var K_ACTIVE = 'choreo_activeProject';       // 上次打开的项目 id
  var K_MIGRATED = 'choreo_migrated_v1';       // 旧草稿迁移完成标志
  var K_LEGACY = 'choreo_draft';               // 旧版单一草稿（迁移源，迁完保留不删）
  var K_LEGACY_BACKUP = 'choreo_draft_backup_20260829'; // 旧草稿逐字节备份
  var K_TOMB = 'choreo_deleted_projects';      // AUD2-011：已删项目 id 持久登记（localStorage 清理失败也不复活）
  // schema 2（WP-3 第二增量）：content 新增可选 markers（段落标记），舞者新增可选 solo/mute；
  // 旧内容经 pure.normalizeContent 就地补默认值（无损），主页保存时自然写成 schemaVersion 2
  var SCHEMA_VERSION = 2;
  var MAX_VERSIONS = 20;                       // 每项目保留的历史版本上限

  var _db = null;            // IDB 连接（降级时为 null）
  var _ls = null;            // 测试可注入的 localStorage；null=用真 localStorage
  var degraded = false;      // IndexedDB 打不开 → 单项目模式
  var backend = null;        // 存储后端（默认 IDB 实现；测试可换内存假库）

  // ---------- localStorage 安全封装（隐私模式等会抛异常，一律吞掉） ----------
  function lsObj() { return _ls || (typeof localStorage !== 'undefined' ? localStorage : null); }
  function lsGet(k) { try { var s = lsObj(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { var s = lsObj(); if (s) s.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { var s = lsObj(); if (s) s.removeItem(k); } catch (e) { } }
  function parseJSON(txt) { try { return JSON.parse(txt || 'null'); } catch (e) { return null; } }

  // ---------- 纯逻辑函数（node 单测直接用，不碰任何存储） ----------
  function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function defaultRecord(now) {
    now = now || Date.now();
    return { id: newId(), name: '我的编舞', createdAt: now, updatedAt: now, schemaVersion: SCHEMA_VERSION,
      content: { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 } };
  }
  // 旧草稿 → 项目记录（没有可用内容时返回 null，由调用方决定造默认项目）
  function legacyToProject(draft, now) {
    if (!draft || !draft.dancers || !draft.dancers.length) return null;
    now = now || Date.now();
    return { id: newId(), name: '我的编舞', createdAt: now, updatedAt: now, schemaVersion: SCHEMA_VERSION,
      content: { dancers: draft.dancers, globalLyrics: draft.globalLyrics || [],
        dancerCount: draft.dancerCount || draft.dancers.length, showLyricMacro: !!draft.showLyricMacro,
        totalDuration: draft.totalDuration || 300 } };
  }
  function contentMaxClipId(content) {
    var max = 0;
    ((content && content.dancers) || []).forEach(function (d) {
      ['switchClips', 'actionClips', 'lyricClips'].forEach(function (k) {
        ((d && d[k]) || []).forEach(function (c) { if (c && c.id > max) max = c.id; });
      });
    });
    ((content && content.globalLyrics) || []).forEach(function (c) { if (c && c.id > max) max = c.id; });
    return max;
  }
  // 崩溃恢复取新：镜像和记录谁新返回谁；镜像不是这个项目的 → 'none'（陈旧垃圾，可清）
  function newerSource(mirror, rec) {
    if (!mirror || !mirror.projectId || !mirror.content || !rec || mirror.projectId !== rec.id) return 'none';
    if ((mirror.savedAt || 0) > (rec.updatedAt || 0)) return 'mirror';
    return 'idb';
  }
  // 版本封顶：按 savedAt 新→旧排，返回【要删掉的】超出部分
  function capVersions(versions, max) {
    var vs = (versions || []).slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    return vs.slice(max || MAX_VERSIONS);
  }
  // 项目列表排序：updatedAt 新的在前（=「最近打开/编辑」）
  function sortIndex(list) {
    return (list || []).slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }
  // schema 2 迁移（就地，幂等）：旧 content 补 markers 数组、舞者补 solo/mute 布尔默认值；
  // 任何旧/新/缺字段的内容都能安全过一遍，数据无损。主页 applyProjectContent 每次装载都调用
  function normalizeContent(ct) {
    if (!ct || typeof ct !== 'object') return ct;
    if (!Array.isArray(ct.markers)) ct.markers = [];
    (ct.dancers || []).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      if (typeof d.solo !== 'boolean') d.solo = !!d.solo;
      if (typeof d.mute !== 'boolean') d.mute = !!d.mute;
    });
    return ct;
  }

  // ---------- 镜像（同步崩溃保险） ----------
  function readMirror() { return parseJSON(lsGet(K_MIRROR)); }
  function writeMirror(m) { lsSet(K_MIRROR, JSON.stringify(m)); }
  function clearMirror() { lsDel(K_MIRROR); }

  // ---------- 删除登记（AUD2-011：持久 tombstone） ----------
  // 会话内存 _tombstones 拦本会话复活；这里再存一份 localStorage——
  // 删除后若清镜像/指针失败（写满等），下次 init 补清镜像并继续拦 saveActive 复活。
  // 上限 200 条防无限增长；id 用时间戳+随机数生成，同 id 复用实际上不存在
  function readTombstones() {
    var a = parseJSON(lsGet(K_TOMB));
    return Array.isArray(a) ? a : [];
  }
  function rememberTombstone(id) {
    var list = readTombstones().filter(function (x) { return x !== id; });
    list.push(id);
    if (list.length > 200) list = list.slice(-200);
    lsSet(K_TOMB, JSON.stringify(list));
  }

  // ---------- 默认后端：IndexedDB ----------
  function idbReq(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB 请求失败')); };
    });
  }
  // AUD2-011：单个 request 成功 ≠ 事务提交成功（事务仍可能 abort）。
  // 所有写操作必须等 transaction.oncomplete 才算成功，onabort/onerror 一律 reject
  function txDone(t) {
    return new Promise(function (res, rej) {
      t.oncomplete = function () { res(); };
      t.onabort = function () { rej(t.error || new Error('IndexedDB 事务被中止')); };
      t.onerror = function () { rej(t.error || new Error('IndexedDB 事务失败')); };
    });
  }
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === 'undefined') { rej(new Error('此环境没有 IndexedDB')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('versions')) {
          var vs = db.createObjectStore('versions', { keyPath: ['projectId', 'savedAt'] });
          vs.createIndex('byProject', 'projectId', { unique: false });
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('IndexedDB 打不开')); };
      rq.onblocked = function () { rej(new Error('IndexedDB 被占用（别的标签页开着？）')); };
    });
  }
  function makeIdbBackend(db) {
    function os(name, mode) { return db.transaction(name, mode || 'readonly').objectStore(name); }
    // 写操作：单个 request 的 onsuccess 只代表进了队列，这里统一等事务提交（AUD2-011）
    function txWrite(name, fn) {
      var t = db.transaction(name, 'readwrite');
      fn(t.objectStore(name));
      return txDone(t);
    }
    return {
      getAllProjects: function () { return idbReq(os('projects').getAll()); },
      getProject: function (id) { return idbReq(os('projects').get(id)); },
      putProject: function (p) { return txWrite('projects', function (s) { s.put(p); }); },
      addProject: function (p) { return txWrite('projects', function (s) { s.add(p); }); },
      deleteProject: function (id) { return txWrite('projects', function (s) { s.delete(id); }); },
      getVersionsOf: function (pid) { return idbReq(os('versions').index('byProject').getAll(pid)); },
      getVersion: function (pid, savedAt) { return idbReq(os('versions').get([pid, savedAt])); },
      putVersion: function (v) { return txWrite('versions', function (s) { s.put(v); }); },
      deleteVersion: function (pid, savedAt) { return txWrite('versions', function (s) { s.delete([pid, savedAt]); }); },
      deleteVersionsOf: function (pid) {
        var t = db.transaction('versions', 'readwrite');
        var rq = t.objectStore('versions').index('byProject').openCursor(IDBKeyRange.only(pid));
        rq.onsuccess = function (e) { var c = e.target.result; if (c) { c.delete(); c.continue(); } };
        return txDone(t);
      },
      // AUD2-011：项目和它的历史版本在同一个库里——一个 readwrite 事务删两处，
      // 中途失败整笔回滚，不会出现「项目没了版本还在」或反过来
      deleteProjectWithVersions: function (id) {
        var t = db.transaction(['projects', 'versions'], 'readwrite');
        t.objectStore('projects').delete(id);
        var rq = t.objectStore('versions').index('byProject').openCursor(IDBKeyRange.only(id));
        rq.onsuccess = function (e) { var c = e.target.result; if (c) { c.delete(); c.continue(); } };
        return txDone(t);
      },
    };
  }
  function useBackend(b) { backend = b; } // 测试注入点
  function isDegraded() { return degraded; }

  // ---------- 迁移（首次打开自动，保留备份） ----------
  function ensureLegacyBackup() {
    var raw = lsGet(K_LEGACY);
    if (raw && !lsGet(K_LEGACY_BACKUP)) lsSet(K_LEGACY_BACKUP, raw);
  }
  function degradedInit(markMigrated) {
    // 降级也把旧草稿接过来当镜像内容（单项目模式），别让主人看着空编辑器
    ensureLegacyBackup();
    if (!readMirror()) {
      var rec = legacyToProject(parseJSON(lsGet(K_LEGACY)));
      if (rec) writeMirror({ projectId: rec.id, name: rec.name, savedAt: rec.updatedAt, content: rec.content });
    }
    // markMigrated=false：写库中途失败（init 的事务被 abort 等）——迁移并没有真正完成，
    // 不能置「已迁移」标志，否则下次 init 打开正常库时会跳过迁移、老草稿永远迁不进来（AC-2）
    if (markMigrated !== false) lsSet(K_MIGRATED, '1');
    return { degraded: true, migrated: false };
  }
  function init() {
    degraded = false; // 重算降级——测试里同一个模块实例会多次 init，不能沿用上一轮的判定
    _tombstones = {}; // AUD-006：新会话重置删除登记（id 本来就不会跨会话复用，重开浏览器没有"复活"风险）
    // AUD2-011：把持久删除登记接回来（上次会话 localStorage 清理失败时，这里补清镜像+继续拦复活）
    readTombstones().forEach(function (id) { _tombstones[id] = true; });
    var staleM = readMirror();
    if (staleM && _tombstones[staleM.projectId]) clearMirror();
    // 测试/特殊环境可能已注入后端（useBackend）——那就不再探测真 IndexedDB
    var opening = backend
      ? Promise.resolve()
      : idbOpen().then(function (db) { _db = db; backend = makeIdbBackend(db); })
        .catch(function () { degraded = true; _db = null; });
    return opening.then(function () {
        if (degraded) return degradedInit();
        return backend.getAllProjects()
          .then(function (list) {
          var out = { degraded: false, migrated: false, name: '' };
          ensureLegacyBackup();
          if (!lsGet(K_MIGRATED)) {
            if (!list.length) {
              // 有旧草稿=真迁移（有版本快照+报 migrated）；没有=只是首次建默认项目
              var legacy = legacyToProject(parseJSON(lsGet(K_LEGACY)));
              var rec = legacy || defaultRecord();
              return backend.putProject(rec)
                .then(function () { return legacy ? addVersion(rec.id, '迁移自旧草稿', rec.content, false) : null; })
                .then(function () {
                  if (legacy) { out.migrated = true; out.name = rec.name; }
                  lsSet(K_ACTIVE, JSON.stringify({ id: rec.id }));
                  return out;
                });
            }
            lsSet(K_MIGRATED, '1');
          }
          return out;
        }).then(function (out) { lsSet(K_MIGRATED, '1'); return out; })
          .catch(function () { degraded = true; return degradedInit(false); }); // 写库中途失败：不消费迁移（AC-2 重试语义）
      });
  }

  // ---------- 项目 CRUD ----------
  var _lastTouchAt = 0; // updatedAt 单调递增：同一毫秒内的连续编辑也要能分出“谁更新”（内存操作快过 1ms）
  function touchNow() { var n = Date.now(); if (n <= _lastTouchAt) n = _lastTouchAt + 1; _lastTouchAt = n; return n; }
  function getActiveId() { var m = parseJSON(lsGet(K_ACTIVE)); return m && m.id ? m.id : null; }
  function setActiveId(id) { lsSet(K_ACTIVE, JSON.stringify({ id: id })); }
  function listProjects() {
    if (degraded) {
      var m = readMirror();
      return Promise.resolve(m ? [{ id: m.projectId, name: m.name || '我的编舞', createdAt: m.savedAt, updatedAt: m.savedAt,
        size: JSON.stringify(m.content || {}).length }] : []);
    }
    return backend.getAllProjects().then(function (list) {
      return sortIndex(list).map(function (p) {
        return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, size: JSON.stringify(p.content || {}).length };
      });
    });
  }
  function openProject(id) {
    if (degraded) {
      var m = readMirror();
      if (m) return Promise.resolve({ record: { id: m.projectId, name: m.name || '我的编舞', createdAt: m.savedAt,
        updatedAt: m.savedAt, schemaVersion: SCHEMA_VERSION, content: m.content }, recovered: false });
      return Promise.resolve({ record: defaultRecord(), recovered: false });
    }
    return backend.getAllProjects().then(function (list) {
      var target = null;
      if (id) for (var i = 0; i < list.length; i++) if (list[i].id === id) target = list[i];
      if (!target && list.length) target = sortIndex(list)[0]; // 找不到就开最近编辑的
      if (!target) { // 一个项目都没有（清过库等）：造默认项目
        target = defaultRecord();
        return backend.putProject(target).then(function () { return finishOpen(target); });
      }
      return finishOpen(target);
    });
  }
  function finishOpen(rec) {
    var m = readMirror();
    var src = newerSource(m, rec);
    if (src === 'mirror') {
      // 上次 IDB 没写完就关了——镜像才是最新内容，按它恢复并存档一个版本
      rec.content = m.content;
      if (m.name) rec.name = m.name;
      rec.updatedAt = m.savedAt || Date.now();
      return backend.putProject(rec)
        .then(function () { return addVersion(rec.id, '异常关闭自动恢复', rec.content, false); })
        .then(function () { return { record: rec, recovered: true }; })
        .catch(function () { return { record: rec, recovered: true }; });
    }
    if (src === 'none' && m && m.projectId && m.projectId !== rec.id && m.projectId !== getActiveId()) clearMirror(); // 不清除后来打开的活动项目的恢复镜像。
    return Promise.resolve({ record: rec, recovered: false });
  }
  function createProject(name, content) {
    if (degraded) return Promise.reject(new Error('浏览器的本地项目库打不开，暂时只能用当前这一份'));
    var now = touchNow();
    var rec = { id: newId(), name: (name && String(name).trim()) || ('新项目 ' + now), createdAt: now, updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
      content: content || { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300 } };
    return backend.putProject(rec).then(function () { return rec; });
  }
  // 文件副本一次事务保存，提交前完成项目身份分配；不碰活动指针/恢复镜像。
  function createImportedProject(doc) {
    if (degraded || !backend) return Promise.reject(new Error('本地项目库不可用，无法保存导入副本'));
    var now = touchNow(), id = newId(), content = JSON.parse(JSON.stringify(doc));
    var name = (content.name || '导入项目') + ' 副本';
    content.projectId = id; content.name = name;
    var rec = { id:id, name:name, createdAt:now, updatedAt:now, schemaVersion:SCHEMA_VERSION, content:content };
    return (backend.addProject ? backend.addProject(rec) : backend.putProject(rec)).then(function () { return rec; });
  }
  function renameProject(id, name) {
    if (degraded) {
      var m0 = readMirror();
      if (m0 && m0.projectId === id) { m0.name = name; writeMirror(m0); }
      return Promise.resolve({ id: id, name: name });
    }
    return backend.getProject(id).then(function (rec) {
      if (!rec) throw new Error('项目不存在');
      rec.name = name; rec.updatedAt = touchNow();
      return backend.putProject(rec).then(function () {
        var m = readMirror();
        if (m && m.projectId === id) { m.name = name; writeMirror(m); }
        return rec;
      });
    });
  }
  function duplicateProject(id) {
    if (degraded) return Promise.reject(new Error('浏览器的本地项目库打不开，暂时不能复制项目'));
    return backend.getProject(id).then(function (rec) {
      if (!rec) throw new Error('项目不存在');
      var now = touchNow();
      var copy = { id: newId(), name: (rec.name || '未命名') + ' 副本', createdAt: now, updatedAt: now,
        schemaVersion: SCHEMA_VERSION, content: JSON.parse(JSON.stringify(rec.content || {})) };
      return backend.putProject(copy).then(function () { return copy; });
    });
  }
  function deleteProject(id) {
    if (degraded) return Promise.reject(new Error('浏览器的本地项目库打不开，暂时不能删项目'));
    // AUD2-011：项目+版本同一事务删（旧注入后端没有该方法时退回两步）；事务失败 reject，
    // 上层弹「删除失败」——绝不出现「库已删、提示成功」的半删状态
    var doDelete = backend.deleteProjectWithVersions
      ? backend.deleteProjectWithVersions(id)
      : backend.deleteProject(id).then(function () { return backend.deleteVersionsOf(id); });
    return doDelete.then(function (out) {
      // AUD-006：删除登记 tombstone + 清掉指向它的镜像/活动指针——防止主页下一次自动保存
      // 用同一个 id 把项目 put 回来（"删除复活"）。会话内存 _tombstones init 时重置；
      // AUD2-011 再持久化一份（localStorage）——就算此刻清理镜像失败，下次 init 也会补清+继续拦
      _tombstones[id] = true;
      rememberTombstone(id);
      var m = readMirror();
      if (m && m.projectId === id) clearMirror();
      if (getActiveId() === id) setActiveId(null);
      return out;
    });
  }

  // ---------- 保存（镜像同步先行，IDB 随后） ----------
  var _tombstones = {}; // AUD-006：本会话已删除的项目 id → saveActive 拒绝复活
  function saveActive(rec) {
    if (_tombstones[rec.id]) return Promise.resolve(false); // 已删除的项目不许被自动保存复活
    rec.updatedAt = touchNow();
    writeMirror({ projectId: rec.id, name: rec.name, savedAt: rec.updatedAt, content: rec.content }); // 同步，先落
    if (degraded || !backend) return Promise.resolve(false);
    return backend.putProject(rec).catch(function () { return false; }); // IDB 失败不挡编辑——镜像兜底，下次打开自动恢复
  }

  // ---------- 历史版本快照 ----------
  var _lastVersionAt = 0; // 同毫秒连存会被复合键互相覆盖——savedAt 强制单调递增
  function addVersion(id, label, content, auto) {
    if (degraded || !backend || !id) return Promise.resolve(false);
    var now = Date.now();
    if (now <= _lastVersionAt) now = _lastVersionAt + 1;
    _lastVersionAt = now;
    var v = { projectId: id, savedAt: now, label: label || '', auto: !!auto, content: content };
    return backend.putVersion(v)
      .then(function () { return backend.getVersionsOf(id); })
      .then(function (vs) {
        var drop = capVersions(vs, MAX_VERSIONS);
        return drop.reduce(function (p, v2) { return p.then(function () { return backend.deleteVersion(id, v2.savedAt); }); }, Promise.resolve());
      })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  function listVersions(id) {
    if (degraded || !backend || !id) return Promise.resolve([]);
    return backend.getVersionsOf(id).then(function (vs) {
      // 版本按 savedAt 新→旧排（sortIndex 是给项目记录按 updatedAt 用的，版本没有那个字段）
      return vs.slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })
        .map(function (v) {
          return { savedAt: v.savedAt, label: v.label, auto: v.auto, size: JSON.stringify(v.content || {}).length };
        });
    });
  }
  function getVersion(id, savedAt) {
    if (degraded || !backend || !id) return Promise.resolve(null);
    return backend.getVersion(id, savedAt);
  }

  var API = {
    init: init, isDegraded: isDegraded, useBackend: useBackend,
    getActiveId: getActiveId, setActiveId: setActiveId,
    listProjects: listProjects, openProject: openProject,
    createProject: createProject, createImportedProject: createImportedProject, renameProject: renameProject,
    duplicateProject: duplicateProject, deleteProject: deleteProject,
    saveActive: saveActive, addVersion: addVersion, listVersions: listVersions, getVersion: getVersion,
    // 测试注入口：node 里没有 localStorage，塞一个内存实现进来
    _useLocalStorage: function (obj) { _ls = obj; },
    _clearMirror: clearMirror, _readMirror: readMirror,
    // 测试注入口：拿真后端工厂（node 单测用假 IDB 对象验证事务提交/回滚语义）
    _makeIdbBackend: makeIdbBackend,
    pure: {
      newId: newId, defaultRecord: defaultRecord, legacyToProject: legacyToProject,
      contentMaxClipId: contentMaxClipId, newerSource: newerSource,
      capVersions: capVersions, sortIndex: sortIndex, normalizeContent: normalizeContent,
      KEYS: { MIRROR: K_MIRROR, ACTIVE: K_ACTIVE, MIGRATED: K_MIGRATED, LEGACY: K_LEGACY, LEGACY_BACKUP: K_LEGACY_BACKUP, TOMB: K_TOMB },
      MAX_VERSIONS: MAX_VERSIONS, SCHEMA_VERSION: SCHEMA_VERSION,
    },
  };
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoProjects = API;
})();
