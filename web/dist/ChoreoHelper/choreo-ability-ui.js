// 技能编排界面：应用式编辑与本机目标类别只读提示，沿用保存/撤销；不输出技能。
// P2（TASK-20260919-UI-OVERHAUL）：编辑面从独立浮窗迁入时间轴下方统一上下文栏——
// 单击技能条=选中（名称/触发时刻/目标默认可见），双击=选中并展开「更多设置（专家参数）」
// （咏唱只读/表现提示/目标类型与补充字段/目标规则只读诊断/本舞者技能动作/实际执行时序）；
// 应用=立即保存+一次撤销，取消=零改动。选择仍是纯 UI 态（selIds 不入库、不新增数据格式），
// Ctrl+点击可跨动作×技能多选；技能事件仍存 extraTracks。
// 添加锚点与动作统一：默认=该舞者技能轨末尾+等待值、「插在这里」消费所选时刻；
// quickAdd/quickAddAll 内部缺省去播放头、回落=对应技能轨末尾；缺目录基础时间仍明示并回落就地编排。
(function (root) {
  'use strict';
  var P = root.ChoreoAbilityPlan;
  var selIds = [];        // 当前选中的技能事件 id 集（首项=主选中）；Ctrl 多选也只在这里
  var session = null;     // 就地编排会话：{mode:'create'|'edit',projectId,skill,di,start,row}
  var bar = null;         // 上下文栏缓存：{key,node,destroy}；避免每次重绘重建表单丢草稿
  var fallbackNode = null; // 无工作台宿主（无头/极早调用）时的独立挂载，正式工作台不走这里
  var expandNext = false; // 双击/「更多设置」后的展开请求
  // B7b 待替换＝未提交的粘贴预览项（表 C）：非法/未映射技能副本只在界面预览，永不写入正式技能轨；
  // 纯内存态——项目文件/备份不含未提交项（磁盘上不存在待解决数据）。pendingEditIdx＝正在「启用…」的项。
  var pendingItems = [];
  var pendingEditIdx = null;
  function pendingRefresh() { refresh(); if (root.render) { try { root.render(); } catch (e) {} } } // lane 不随 refresh 重建，需整帧重绘
  function setPending(list) { pendingItems = (list || []).map(function (p) { return Object.assign({}, p); }); pendingEditIdx = null; refresh(); }
  function clearPending() { pendingItems = []; pendingEditIdx = null; refresh(); }
  function pendingList() { return pendingItems.slice(); }
  function removePendingAt(i) { pendingItems.splice(i, 1); if (pendingEditIdx === i) pendingEditIdx = null; pendingRefresh(); }

  function node(tag, text, parent) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (parent) parent.appendChild(n); return n; }
  function button(text, parent, fn) { var b = node('button', text, parent); b.type = 'button'; b.className = 'btn'; b.onclick = fn; return b; }
  function install(all) { var s = root.store; s.contentExtra = s.contentExtra || {}; s.contentExtra._doc = s.contentExtra._doc || {}; s.contentExtra._doc.extraTracks = all; root.updateTotalDuration(); root.saveHistory(); root.render(); }
  function rowsNow() { return root.store ? P.rows(root.store) : []; }
  function rowById(id) { var rs = rowsNow(); for (var i = 0; i < rs.length; i++) if (rs[i].event.id === id) return rs[i]; return null; }
  function diOfSource(source) { if (!root.store) return -1; var ps = P.performers(root.store); for (var i = 0; i < ps.length; i++) if (ps[i].id === source) return i; return -1; }
  function isSel(id) { return selIds.indexOf(id) >= 0; }
  function existingIds() { var rs = rowsNow(), out = []; selIds.forEach(function (id) { if (rs.some(function (r) { return r.event.id === id })) out.push(id) }); return out; }
  function paintSel() {
    if (!document.querySelectorAll) return;
    Array.prototype.forEach.call(document.querySelectorAll('.ability-clip'), function (n) { n.classList.toggle('selected', isSel(n.dataset.eventId)); });
  }
  function clearTimelineSel() { // 与常规条选中互斥：对齐 app.js selectClipOnly+refreshSelection 的清理面
    var s = root.store; if (!s) return;
    (s.dancers || []).forEach(function (d) { ['switchClips', 'actionClips', 'lyricClips'].forEach(function (k) { (d[k] || []).forEach(function (x) { x.selected = false }) }) });
    (s.globalLyrics || []).forEach(function (x) { x.selected = false });
    s.selectedClip = null;
    if (document.querySelectorAll) Array.prototype.forEach.call(document.querySelectorAll('.clip.selected'), function (n) { if (n.__clip && !n.__clip.selected) n.classList.remove('selected') });
  }
  function refresh() {
    if (root.refreshWorkbenchBars) {
      root.refreshWorkbenchBars();
      if (typeof document.getElementById === 'function' && document.getElementById('wbCtxHost')) { removeFallback(); return; }
    }
    mountFallback();
  }
  function selection() { return existingIds(); }
  function clearSelection() { selIds = []; session = null; destroyBar(); paintSel(); removeFallback(); }
  function destroyBar() { if (bar && bar.destroy) bar.destroy(); bar = null; }
  function endSession() { session = null; destroyBar(); removeFallback(); }
  function setSel(id) {
    if (id != null && root.ChoreoStageMotionUI) root.ChoreoStageMotionUI.clearSelection();
    selIds = id == null ? [] : [id]; session = null; destroyBar(); removeFallback(); paintSel();
    if (id !== null) clearTimelineSel();
    refresh();
  }
  function toggleSel(id) { // Ctrl+点击：跨动作×技能加选/去选，不动常规条选中
    if (isSel(id)) { selIds = selIds.filter(function (x) { return x !== id; }); if (session && session.mode === 'edit' && session.row && session.row.event.id === id) endSession(); }
    else selIds.push(id);
    paintSel(); refresh();
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', function (ev) { // 点技能条/上下文栏以外任意处即清除技能选中
    var t = ev.target;
    if (t && t.closest && (t.closest('#wbTopHost') || t.closest('.stage-motion-lane') || t.closest('.d-hdr'))) return;
    // 侧栏/添加条是「添加内容」入口，点它们不清选中、不收起正在编辑的表单（回落编辑面无独立浮窗后必须有此豁免）
    if (t && t.closest && (t.closest('.ability-clip') || t.closest('.wb-ctx') || t.closest('.wb-ctxhost') || t.closest('.ability-editor') || t.closest('.prop-pnl') || t.closest('.sidebar') || t.closest('.wb-addbar') || t.closest('.wb-addhost'))) return;
    if (ev.ctrlKey || ev.metaKey) return; // Ctrl+点击动作条=跨类型加选，不清技能选集
    if (!selIds.length && !session) return;
    selIds = []; endSession(); paintSel();
    if (root.refreshWorkbenchBars) root.refreshWorkbenchBars();
  });

  function fmtSec(t) { return (Math.round(Number(t) * 1000) / 1000).toFixed(3); }

  // ---------- B7b：已入库 disabled 事件的显式「启用」控件（不得借用任何既有路径自动启用） ----------
  // 经真实 upsert（内部 validate）写入；轨级与事件级 disabled 一并显式置回启用；一次 saveHistory。
  function enableEvent(id) {
    var s = root.store, r = rowById(id); if (!s || !r) return;
    if (r.track.enabled !== false && r.event.enabled !== false) { root.showToast('该技能片段已是启用状态'); return; }
    try {
      var e2 = JSON.parse(JSON.stringify(r.event));
      if (e2.enabled === false) e2.enabled = true;
      var all = P.upsert(P.tracks(s), r.source, e2, 'ability-track-' + crypto.randomUUID(), P.performers(s));
      if (r.track.enabled === false) all = all.map(function (t) {
        if (t && t.id === r.track.id && t.enabled === false) { var c = JSON.parse(JSON.stringify(t)); c.enabled = true; return c; }
        return t;
      });
      install(all); root.showToast('已启用（经真实 validate，↶ 可撤销）');
    } catch (e) { root.showToast('启用失败：' + e.message); }
  }

  // ---------- B7b：待替换项的「启用…」编辑面（改目标后经真实 validate 入库；显式控件，不自动写入） ----------
  function buildPendingEditor(p, parent) {
    var s = root.store; if (!s) return;
    var ev = p.event, plan = P.plan(ev); if (!plan) { root.showToast('待替换项数据不完整'); return; }
    var di = (p.di != null && p.di >= 0 && s.dancers[p.di]) ? p.di : 0;
    var source = P.pid(s, di), people = P.performers(s);
    var skill = { id: Number(plan.actionId), type: 'action', name: plan.name };
    var box = node('div', undefined, parent); box.className = 'ability-pending-edit';
    box.style.cssText = 'border:1px dashed #71c4df;border-radius:6px;padding:8px;margin:4px 0;background:#14202e';
    node('p', '启用「' + plan.name + '」（所属：' + (people.find(function (x) { return x.id === source; }) || { name: '?' }).name + '）：选择目标后点「启用（验证并保存）」，经真实 validate 入库；取消＝零改动。', box);
    var t = plan.target || {};
    var inputs = {};
    function sel(key, label, options, value) {
      var l = node('label', label + ' ', box); var n = node('select', undefined, l); n.setAttribute('aria-label', label);
      options.forEach(function (o) { var v = node('option', o[1], n); v.value = o[0] }); n.value = value; inputs[key] = n; return n;
    }
    function fld(key, label, value) {
      var l = node('label', label + ' ', box); var n = node('input', undefined, l); n.type = 'text'; n.value = value; n.setAttribute('aria-label', label); inputs[key] = n; return n;
    }
    sel('targetKind', '排练目标类型', [['self', '自身（明确指定）'], ['party', '指定队友舞者（队伍成员）'], ['ally', '指定普通友方舞者'], ['enemyMarker', '明确敌人排练标记'], ['defaultSelf', '未指定对象时使用自身'], ['alliance', '指定团队成员舞者'], ['ownPet', '自己的宠物标记'], ['partyPet', '指定队友的宠物标记'], ['ground', '舞台地面坐标']], t.kind || 'defaultSelf');
    sel('targetPerformer', '目标舞者', [['', '请选择另一位舞者']].concat(people.filter(function (x) { return x.id !== source; }).map(function (x) { return [x.id, x.name]; })), t.performerId || '');
    fld('targetLabel', '目标标记名称', t.label || '');
    ['X', 'Y', 'Z'].forEach(function (k) { fld('target' + k, '地面坐标 ' + k + '（米）', String(t.position ? t.position[k.toLowerCase()] : 0)); });
    var btns = node('div', undefined, box);
    var ok = button('启用（验证并保存）', btns, function () {
      try {
        var values = {}; Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
        values.start = String(ev.startMs / 1000);
        values.cast = String(plan.castMs / 1000);
        values.presentation = String(plan.presentationMs / 1000);
        var e = P.make(skill, values, ev.id, ev); // 真实 make：保留 timing/notes 等未知字段
        var all = P.upsert(P.tracks(root.store), source, e, 'ability-track-' + crypto.randomUUID(), P.performers(root.store));
        pendingItems = pendingItems.filter(function (x) { return x !== p; });
        pendingEditIdx = null;
        install(all); root.showToast('已启用并入库（经真实 validate，↶ 可撤销）');
      } catch (e) { root.showToast('未启用：' + e.message); }
    }); ok.className = 'btn primary';
    button('取消', btns, function () { pendingEditIdx = null; pendingRefresh(); });
  }

  // ---------- 选中摘要（单击技能条）：名称/触发时刻/目标默认可见 ----------
  function buildSummary(id) {
    var s = root.store, r = rowById(id); if (!s || !r) return null;
    var p = P.plan(r.event); if (!p) return null;
    var people = P.performers(s);
    var box = node('section'); box.className = 'wb-ctx ability-summary'; box.id = 'wbCtx'; // 与动作条共用一个上下文栏 id（同一时刻只有一个）
    box.setAttribute('aria-label', '技能片段就地编辑');
    var h = node('h3', '技能 · ' + p.name + ' #' + p.actionId, box); h.className = 'wb-ctx-name';
    var sTrigger = node('span', '触发 ' + fmtSec(r.event.startMs / 1000) + 's', box); sTrigger.className = 'wb-ctx-field';
    var sTiming = node('span', '咏唱 ' + fmtSec(p.castMs / 1000) + 's · 表现提示 ' + fmtSec(p.presentationMs / 1000) + 's', box); sTiming.className = 'wb-ctx-field';
    var sTarget = node('span', '目标：' + P.targetLabel(p, people, r.source), box); sTarget.className = 'wb-ctx-field';
    var bMore = button('更多设置', box, function () { startEdit(id, true); }); bMore.id = 'wbSkillMore';
    var bDel = button('删除技能片段', box, function () {
      if (root.store !== s) { root.showToast('项目或舞者已重新装载，未删除'); return; }
      try {
        var all = P.remove(P.tracks(s), id);
        selIds = []; destroyBar(); install(all);
        root.showToast('技能片段已删除（↶ 可撤销）');
      } catch (e) { root.showToast('删除失败：' + e.message); }
    }); bDel.className = 'btn danger'; bDel.id = 'wbSkillDel';
    if (r.track.enabled === false || r.event.enabled === false) { // B7b：显式启用控件（已入库 disabled 事件；不借既有路径自动启用）
      var bEn = button('启用', box, function () { if (root.store !== s) { root.showToast('项目或舞者已重新装载，未启用'); return; } enableEvent(id); });
      bEn.id = 'wbSkillEnable'; bEn.title = '显式启用此已停用的技能片段（经真实 validate，一次撤销）';
    }
    return { node: box, destroy: function () {} };
  }

  function startEdit(id, expand) {
    var r = rowById(id); if (!r) return;
    var p = P.plan(r.event), di = diOfSource(r.source);
    if (di < 0) { root.showToast('所属舞者已不存在，不能编辑'); return; }
    session = { mode: 'edit', projectId: root.store.projectId, skill: { id: Number(p.actionId), type: 'action', name: p.name }, di: di, start: 0, row: r };
    expandNext = !!expand; refresh();
  }

  // ---------- 就地编排面（create=缺基础值/显式编排；edit=技能条双击） ----------
  function buildSession(se, expand) {
    var s = root.store;
    if (!s || se.projectId !== s.projectId) return null;
    var people = P.performers(s), source = P.pid(s, se.di);
    if (!P.isSkill(se.skill) || !source) { root.showToast('缺少真实 Action 身份或舞者，不能按名称编排技能'); return null; }
    var skill = Object.assign({}, (s.actions || []).find(a => a.type === 'action' && a.id === se.skill.id) || {}, se.skill);
    var row = se.row;
    if (row && (row.track.locked || row.event.locked)) { root.showToast('技能片段已锁定'); return null; }
    if (row && (!P.plan(row.event) || !P.plan(row.event).target)) { root.showToast('技能编排数据不完整，已保留原数据'); return null; }
    var dancers = s.dancers, extra = s.contentExtra, project = s.projectId, oldText = row ? JSON.stringify(row.event) : null, closed = false, model, timer;
    var box = node('section'); box.className = 'wb-ctx ability-editor'; box.id = 'wbSkillEditor';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '编排技能');
    var h = node('h3', (row ? '编辑技能' : '编排技能') + ' · ' + skill.name + ' #' + skill.id, box); h.className = 'wb-ctx-name';
    node('p', '网页排练专用，不释放技能。目标默认「未指定对象时使用自身」；咏唱、目标舞者、坐标等在「更多设置（专家参数）」。', box);
    var p = row ? P.plan(row.event) : null, inputs = {};
    function field(key, label, value, parent) { var l = node('label', label + ' ', parent || box); l.className = 'wb-ctx-field'; var n = node('input', undefined, l); n.type = 'text'; n.value = value; n.setAttribute('aria-label', label); inputs[key] = n; return n; }
    function select(key, label, options, value, parent) { var l = node('label', label + ' ', parent || box); l.className = 'wb-ctx-field'; var n = node('select', undefined, l); n.setAttribute('aria-label', label); options.forEach(o => { var v = node('option', o[1], n); v.value = o[0] }); n.value = value; inputs[key] = n; return n; }
    field('start', '触发时刻（秒）', String(row ? row.event.startMs / 1000 : Math.round(Math.max(0, se.start === undefined ? s.currentTime : se.start) * 1000) / 1000));
    var targetLine = node('span', '目标：应用前请在「更多设置」选择目标类型', box); targetLine.className = 'wb-ctx-field';
    var bApply = button('应用技能编排', box, apply); bApply.className = 'btn primary';
    if (row && (row.track.enabled === false || row.event.enabled === false)) { // B7b：显式启用控件（编辑面内；编辑本身保持 disabled）
      var bEnS = button('启用', box, function () { current(); enableEvent(row.event.id); }); bEnS.id = 'wbSkillEnable';
      bEnS.title = '显式启用此已停用的技能片段（经真实 validate，一次撤销）；编辑并应用不会自动启用';
    }
    if (row) { var bDel = button('删除技能片段', box, doDelete); bDel.className = 'btn danger'; }
    button('取消', box, cancel);
    var error = node('p', '', box); error.setAttribute('role', 'status'); error.style.color = '#ffc785';
    var adv = document.createElement('details'); adv.className = 'wb-ctx-expert ability-advanced'; if (expand) adv.open = true;
    adv.appendChild(node('summary', '更多设置（专家参数）'));
    var advBody = node('div', undefined, adv); advBody.className = 'wb-ctx-expert-body';
    box.appendChild(adv);
    var metadata = root.ChoreoSkillMetadata && root.ChoreoSkillMetadata.read(skill);
    var fixedCastMs = p ? p.castMs : metadata ? metadata.castMs : null, adoptedTiming = p && p.timing || null, executionTiming = p && p.executionTiming || null, profileBinding = s.dancers[se.di].profileId || '';
    node('p', '所属：' + people.find(x => x.id === source).name + '。网页排练专用，不释放技能。', advBody);
    node('p', '目标是编舞声明，不使用游戏手选目标。表现提示时长不是动画长度；技能动作按本舞者资源预览，特效在游戏中查看。', advBody);
    if (root.ChoreoSkillMetadata) node('p', root.ChoreoSkillMetadata.describe(skill), advBody);
    field('cast', '咏唱提示时长（秒）', fixedCastMs === null ? '' : String(fixedCastMs / 1000), advBody).readOnly = true;
    node('p', '咏唱时间不允许自行修改。目录仅提供基础值，实际时间须按角色和游戏状态核验；旧存档数值保留，但不因此视为可实演。请通过调整触发时刻编排。', advBody);
    field('presentation', '触发表现提示时长（秒）', String(p ? p.presentationMs / 1000 : 1), advBody);
    select('targetKind', '排练目标类型', [['', '请选择'], ['self', '自身（明确指定）'], ['party', '指定队友舞者（队伍成员）'], ['ally', '指定普通友方舞者'], ['enemyMarker', '明确敌人排练标记'], ['defaultSelf', '未指定对象时使用自身'], ['alliance', '指定团队成员舞者'], ['ownPet', '自己的宠物标记'], ['partyPet', '指定队友的宠物标记'], ['ground', '舞台地面坐标']], p ? p.target.kind : 'defaultSelf', advBody);
    select('targetPerformer', '目标舞者', [['', '请选择另一位舞者']].concat(people.filter(x => x.id !== source).map(x => [x.id, x.name])), p ? p.target.performerId || '' : '', advBody);
    field('targetLabel', '敌人标记名称', p ? p.target.label || '' : '', advBody);
    ['X', 'Y', 'Z'].forEach(k => field('target' + k, '地面坐标 ' + k + '（米，精确设置）', String(p && p.target.position ? p.target.position[k.toLowerCase()] : 0), advBody));
    function updateTargetLine() {
      var kind = inputs.targetKind.value;
      if (!kind) { targetLine.textContent = '目标：应用前请在「更多设置」选择目标类型'; return; }
      if (P.PERSON_TARGETS.includes(kind)) {
        var who = people.find(x => x.id === inputs.targetPerformer.value);
        targetLine.textContent = '目标：' + ({ party: '队友：', alliance: '团队成员：', ally: '友方：', partyPet: '队友宠物所属：' }[kind] || '目标：') + (who ? who.name : '请选择另一位舞者');
      } else if (['enemyMarker', 'ownPet', 'partyPet'].includes(kind)) {
        targetLine.textContent = '目标：' + ({ enemyMarker: '敌人标记：', ownPet: '自己的宠物标记：', partyPet: '队友宠物所属：' }[kind]) + (inputs.targetLabel.value || '请填写标记名称');
      } else if (kind === 'ground') {
        targetLine.textContent = '目标：舞台地面坐标（' + inputs.targetX.value + ', ' + inputs.targetY.value + ', ' + inputs.targetZ.value + ' 米）';
      } else {
        targetLine.textContent = '目标：' + ({ self: '自身', defaultSelf: '未指定对象 → 自身（排练规则）' }[kind] || kind);
      }
    }
    function targetFields() {
      var kind = inputs.targetKind.value;
      var needExtra = P.PERSON_TARGETS.includes(kind) || ['enemyMarker', 'ownPet', 'partyPet', 'ground'].includes(kind);
      if (needExtra && !adv.open) adv.open = true; // 选中需补充字段的目标类型时自动展开高级区，保一步可达
      inputs.targetPerformer.parentNode.style.display = P.PERSON_TARGETS.includes(kind) ? 'block' : 'none';
      inputs.targetLabel.parentNode.style.display = ['enemyMarker', 'ownPet', 'partyPet', 'ground'].includes(kind) ? 'block' : 'none';
      var targetTitle = kind === 'enemyMarker' ? '敌人标记名称' : '目标标记名称';
      inputs.targetLabel.setAttribute('aria-label', targetTitle);
      if (inputs.targetLabel.parentNode.firstChild) inputs.targetLabel.parentNode.firstChild.textContent = targetTitle + ' ';
      ['X', 'Y', 'Z'].forEach(k => inputs['target' + k].parentNode.style.display = kind === 'ground' ? 'block' : 'none');
      updateTargetLine();
    }
    inputs.targetKind.onchange = function () { targetFields(); rulesView() }; targetFields();
    inputs.targetPerformer.onchange = updateTargetLine; inputs.targetLabel.oninput = updateTargetLine;
    ['targetX', 'targetY', 'targetZ'].forEach(function (k) { inputs[k].oninput = updateTargetLine; });
    var rulesLine = node('p', '未核验：尚未读取本机规则', advBody); rulesLine.className = 'ability-target-rules';
    var matchLine = node('p', '', advBody); matchLine.className = 'ability-target-match';
    var draft = node('label', '', advBody), draftCheck = node('input', undefined, draft); draftCheck.type = 'checkbox';
    draftCheck.setAttribute('aria-label', '明确保存未核验排练草稿'); node('span', ' 我确认仅保存未核验排练草稿，不表示目标有效或技能能释放', draft);
    function current() { if (root.store !== s || s.projectId !== project || root.store.dancers !== dancers || root.store.contentExtra !== extra || (s.dancers[se.di].profileId || '') !== profileBinding) throw Error('项目或舞者已重新装载，请关闭后重新打开'); if (row && JSON.stringify(row.event) !== oldText) throw Error('技能片段已变化，请重新打开') }
    function isCurrent() { try { current(); return !closed } catch (e) { return false } }
    function rulesView() {
      if (!model) return; var v = model.view(), T = root.ChoreoAbilityPlanTargets, a = T.assess(v.rules, inputs.targetKind.value);
      rulesLine.textContent = T.describe(v.rules) + ' ' + v.reason; matchLine.textContent = '网页仅预览动作；目标规则供参考，不限制保存。游戏按时尝试，失败跳过。';
      Array.from(inputs.targetKind.children).forEach(o => { o.disabled = false });
      draft.style.display = 'none';
    }
    function destroy() { closed = true; if (model) model.close(); clearInterval(timer); }
    function cancel() { session = null; destroyBar(); removeFallback(); refresh(); }
    function apply() {
      try {
        current(); var values = {}; Object.keys(inputs).forEach(k => values[k] = inputs[k].value);
        root.ChoreoAbilityPlanTargets.assess(model.view().rules, values.targetKind); rulesView();
        if (fixedCastMs === null) throw Error('未核验：缺少技能基础时间，不能自定义咏唱时长');
        values.cast = String(fixedCastMs / 1000);
        var e = P.make(skill, values, row ? row.event.id : 'ability-' + crypto.randomUUID(), row && row.event);
        if (adoptedTiming) e.data.rehearsalAbility.timing = JSON.parse(JSON.stringify(adoptedTiming));
        if (executionTiming) e.data.rehearsalAbility.executionTiming = JSON.parse(JSON.stringify(executionTiming));
        var all = P.upsert(P.tracks(s), source, e, 'ability-track-' + crypto.randomUUID(), P.performers(s));
        if (row && JSON.stringify(e) === oldText) { session = null; destroyBar(); removeFallback(); refresh(); return; }
        session = null; destroyBar(); removeFallback(); selIds = [e.id];
        install(all); root.showToast('技能编排已保存；3D 按本舞者资源预览，缺失会明确提示');
      } catch (e) { error.textContent = e.message }
    }
    function doDelete() {
      try {
        current(); var all = P.remove(P.tracks(s), row.event.id);
        session = null; destroyBar(); removeFallback(); selIds = [];
        install(all); root.showToast('技能片段已删除（↶ 可撤销）');
      } catch (e) { error.textContent = e.message }
    }
    button('刷新目标规则（只读）', advBody, function () { draftCheck.checked = false; model.refresh() });
    if (root.ChoreoSkillMotionUI) {
      node('h4', '本舞者技能动作', advBody);
      root.ChoreoSkillMotionUI.attach(advBody, skill, se.di, isCurrent, function (t) {
        current(); fixedCastMs = t.castMs; inputs.cast.value = String(t.castMs / 1000);
        adoptedTiming = { version: 1, observationHash: t.observationHash, profileId: t.profileId, skeletonHash: t.skeletonHash, actionId: t.actionId, actorId: t.actorId, jobId: t.jobId, castMs: t.castMs, endMs: Math.ceil(t.end * 1000) };
        error.textContent = '已选本档案实测咏唱 ' + t.castMs / 1000 + ' 秒；点击应用后保存。只对应这次角色状态，实际演出前仍须复核。';
      }, p && p.timing);
    }
    if (root.ChoreoSkillTimingUI) {
      node('h4', '实际执行时序', advBody);
      root.ChoreoSkillTimingUI.attach(advBody, skill, se.di, isCurrent, t => { current(); executionTiming = t }, p && p.executionTiming, () => adoptedTiming);
    }
    model = root.ChoreoAbilityPlanTargets.create({
      id: skill.id, current: isCurrent, connected: () => !!s.gameConnected, catalogRules: metadata ? skill.targetRules : null,
      read: path => root.apiFetch(path), changed: rulesView
    });
    rulesView(); model.refresh(); // 节点由上下文栏宿主（或回落挂载）插入，控制器不自行 append
    timer = setInterval(function () { model.tick(); rulesView() }, 250);
    return { node: box, destroy: destroy };
  }

  // ---------- 上下文栏渲染与宿主 ----------
  function currentContext() {
    var s = root.store; if (!s) return null;
    if (session) {
      if (session.projectId !== s.projectId) { endSession(); return null; }
      if (session.mode === 'edit' && session.row && !rowById(session.row.event.id)) { endSession(); return null; }
      return { kind: 'session', key: session.mode + ':' + (session.mode === 'edit' ? session.row.event.id : session.skill.id + ':' + session.di + ':' + session.start) };
    }
    var ids = existingIds();
    if (ids.length === 1 && !s.selectedClip && !(root.edSel && root.edSel().length)) return { kind: 'summary', key: 'sum:' + ids[0], id: ids[0] };
    return null;
  }
  function renderContext() {
    if (root.ChoreoStageMotionUI && root.ChoreoStageMotionUI.sessionActive()) return null;
    var ctx = currentContext();
    if (!ctx) { destroyBar(); removeFallback(); return null; }
    if (bar && bar.key === ctx.key) return bar.node;
    destroyBar();
    var built = ctx.kind === 'session' ? buildSession(session, expandNext) : buildSummary(ctx.id);
    expandNext = false;
    if (!built) { session = null; return null; }
    bar = { key: ctx.key, node: built.node, destroy: built.destroy };
    return bar.node;
  }
  function removeFallback() {
    if (!fallbackNode) return;
    if (fallbackNode.__destroy) { try { fallbackNode.__destroy(); } catch (e) {} }
    if (fallbackNode.remove) fallbackNode.remove();
    fallbackNode = null;
  }
  function mountFallback() { // 无工作台宿主（node 测试/极早调用）：沿用旧独立编辑面形态，保证回落可取消、零写入
    var ctx = currentContext();
    if (fallbackNode && fallbackNode.__ctxKey && ctx && fallbackNode.__ctxKey === ctx.key) return;
    removeFallback();
    if (!ctx) return;
    var built = ctx.kind === 'session' ? buildSession(session, expandNext) : buildSummary(ctx.id);
    expandNext = false;
    if (!built) { session = null; return; }
    built.node.style.cssText = 'position:fixed;z-index:10000;right:24px;top:50px;width:min(490px,90vw);max-height:88vh;overflow:auto;background:#172131;color:#e6edf7;padding:14px;border:1px solid #729fb4;border-radius:10px;box-shadow:0 12px 48px #0009';
    fallbackNode = built.node; fallbackNode.__ctxKey = ctx.key; fallbackNode.__destroy = built.destroy;
    document.body.appendChild(fallbackNode);
  }

  // ---------- 打开/默认落条 ----------
  function open(skill, di, start, row) {
    if (row) {
      session = { mode: 'edit', projectId: root.store.projectId, skill: skill, di: di, start: start, row: row };
      selIds = [row.event.id]; paintSel(); expandNext = true; refresh(); return;
    }
    session = { mode: 'create', projectId: root.store.projectId, skill: skill, di: di, start: start, row: null };
    selIds = []; paintSel(); expandNext = false; refresh();
  }
  // 技能轨末尾（秒）：单舞者=该舞者技能轨最大结束；di==null=所有舞者技能轨最大结束
  function skillLaneEnd(di) {
    var s = root.store; if (!s) return 0;
    var end = 0;
    if (di == null) { P.rows(s).forEach(function (r) { end = Math.max(end, r.event.startMs + r.event.durationMs) }); return end / 1000; }
    var who = P.pid(s, di); if (!who) return 0;
    P.rows(s).forEach(function (r) { if (r.source === who) end = Math.max(end, r.event.startMs + r.event.durationMs) });
    return end / 1000;
  }
  // TASK-20260918-PLAYER-UX-SIMPLIFY B1：侧栏点/拖技能不再先弹窗——按默认值直接落条
  // （目标=未指定对象时使用自身、咏唱=目录基础值、表现提示=1秒）；缺目录基础时间等不可默认时
  // 明示 toast 并回落就地编排面，不静默。P2：内部缺省=技能轨末尾（不再是播放头）。
  function quickAdd(skill, di, start) {
    var s = root.store, source = P.pid(s, di);
    if (!P.isSkill(skill) || !source) { root.showToast('缺少真实 Action 身份或舞者，不能按名称编排技能'); return { ok: false, missing: 'identity' } }
    skill = Object.assign({}, (s.actions || []).find(a => a.type === 'action' && a.id === skill.id) || {}, skill);
    var values = P.quickDefaults(skill, root.ChoreoSkillMetadata && root.ChoreoSkillMetadata.read(skill));
    if (!values) { root.showToast('无法按默认落条：目录缺少该技能的基础咏唱时间。请连接游戏插件同步完整目录，或在编辑窗采用已有实测时间；不能自行填写咏唱时长'); open(skill, di, start); return { ok: false, missing: 'cast' } }
    if (start == null) start = skillLaneEnd(di); // P2：缺省不再用播放头，回落=该舞者技能轨末尾
    values.start = String(Math.round(Math.max(0, start) * 1000) / 1000);
    try {
      var e = P.make(skill, values, 'ability-' + crypto.randomUUID());
      var all = P.upsert(P.tracks(s), source, e, 'ability-track-' + crypto.randomUUID(), P.performers(s));
      install(all);
      root.showToast('已按默认落条（Ctrl+Z 撤销）：目标=未指定对象时使用自身 · 咏唱=目录基础值 · 表现提示=1秒；双击技能条可改');
      return { ok: true, eventId: e.id };
    } catch (err) { root.showToast('默认落条未写入：' + err.message); return { ok: false, missing: 'error' } }
  }
  // 「添加到全部舞者」+技能：同一默认值逐位落条，整批一次 install=一次撤销；
  // 任一位不可默认（目录基础时间缺失/身份问题）则整批不动并回落编辑面。
  function quickAddAll(skill, start) {
    var s = root.store;
    skill = Object.assign({}, (s.actions || []).find(a => a.type === 'action' && a.id === skill.id) || {}, skill);
    var values = P.quickDefaults(skill, root.ChoreoSkillMetadata && root.ChoreoSkillMetadata.read(skill));
    if (!values) { root.showToast('无法按默认落条：目录缺少该技能的基础咏唱时间。请连接游戏插件同步完整目录，或在编辑窗采用已有实测时间；不能自行填写咏唱时长'); if (s.dancers[s.selectedDancer]) open(skill, s.selectedDancer, start); return { ok: false, missing: 'cast' } }
    if (start == null) start = skillLaneEnd(null); // P2：缺省=所有舞者技能轨最大结束（同一落点整批）
    values.start = String(Math.round(Math.max(0, start) * 1000) / 1000);
    var all = P.tracks(s), added = 0;
    try {
      P.performers(s).forEach(function (who) {
        var e = P.make(skill, values, 'ability-' + crypto.randomUUID());
        all = P.upsert(all, who.id, e, 'ability-track-' + crypto.randomUUID(), P.performers(s)); added++;
      });
    } catch (err) { root.showToast('默认落条未写入：' + err.message); return { ok: false, missing: 'error' } }
    if (!added) { root.showToast('没有可落条的舞者'); return { ok: false, missing: 'dancer' } }
    install(all);
    root.showToast('已给全部 ' + added + ' 位舞者按默认落条（一次撤销整批；目标=未指定对象时使用自身 · 咏唱=目录基础值 · 表现提示=1秒）');
    return { ok: true, count: added };
  }
  function laneClick(id, ev) {
    if (ev.ctrlKey || ev.metaKey) { toggleSel(id); return; }
    if (session && session.mode === 'edit' && session.row && session.row.event.id === id) return; // 编排中再点本条不收起表单
    if (selIds.length === 1 && selIds[0] === id) { setSel(null); return; } // 再点取消选中
    setSel(id);
  }
  function lane(di) {
    var s = root.store, who = P.pid(s, di), items = P.rows(s).filter(r => r.source === who), lane = node('div'); lane.className = 'lane ability-lane';
    var alive = P.rows(s).map(r => r.event.id);
    selIds = selIds.filter(function (id) { return alive.indexOf(id) >= 0 }); // 被删/撤销的条目不再保留悬挂选中
    if (session && session.mode === 'edit' && session.row && alive.indexOf(session.row.event.id) < 0) endSession();
    var label = node('div', undefined, lane); label.className = 'lane-label'; node('span', '✦', label); node('span', '技能', label);
    var body = node('div', undefined, lane); body.className = 'lane-body'; body.style.position = 'relative';
    var slots = [];
    items.sort((a, b) => a.event.startMs - b.event.startMs).forEach(function (r) {
      var p = P.plan(r.event); if (!p) return; var e = r.event, index = slots.findIndex(x => x <= e.startMs); if (index < 0) index = slots.length; slots[index] = e.startMs + e.durationMs;
      var b = button(p.name + ' · ' + P.targetLabel(p, P.performers(s), who), body, null);
      b.className = 'ability-clip'; b.dataset.eventId = e.id; b.style.cssText = 'position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;background:#204153;color:#d2f5ff;border:1px solid #71c4df;border-radius:4px;height:25px;padding:2px 5px;cursor:pointer';
      b.style.left = (e.startMs / 1000 * s.pps) + 'px'; b.style.width = Math.max(30, e.durationMs / 1000 * s.pps) + 'px'; b.style.top = (index * 28 + 3) + 'px';
      b.title = p.name + ' #' + p.actionId + ' · ' + (e.startMs / 1000) + 's · 咏唱 ' + p.castMs / 1000 + 's / 表现提示 ' + p.presentationMs / 1000 + 's · ' + P.targetLabel(p, P.performers(s), who) + ' · 动画按本舞者档案读取 · 单击选中并在下方就地编辑，双击直接展开更多设置';
      if (r.track.enabled === false || e.enabled === false) b.style.opacity = '0.4';
      if (isSel(e.id)) b.classList.add('selected');
      b.onmousedown = function (ev) { ev.stopPropagation() };
      b.onclick = function (ev) { ev.stopPropagation(); laneClick(e.id, ev) };
      b.ondblclick = function (ev) { ev.stopPropagation(); open({ id: Number(p.actionId), type: 'action', name: p.name }, di, 0, r) };
    });
    lane.style.height = Math.max(34, slots.length * 28 + 6) + 'px';
    // ---------- B7b 待替换预览项（lane-body 内绝对定位幽灵条＋「待替换」徽标＋启用/移除；纯界面预览，不写入项目） ----------
    // 幽灵条与技能条同坐标系（left=startMs×pps、按行下移）：随时间轴横向滚动，不占 flex 行（.lane 是
    // 横向 flex，普通块会被排到超宽 lane-body 右侧出视野——绝对定位是唯一稳法）。
    var mine = [];
    pendingItems.forEach(function (p, pi) { if (p.di == null || p.di < 0 || p.di === di) mine.push([p, pi]); });
    if (mine.length) {
      var top0 = Math.max(slots.length, 1) * 28 + 6;
      mine.forEach(function (pair, idx) {
        var p = pair[0], pi = pair[1];
        var st = (p.event && Number.isFinite(p.event.startMs)) ? p.event.startMs : 0;
        var ghost = node('div', undefined, body); ghost.className = 'ability-pending-bar';
        ghost.style.cssText = 'position:absolute;left:' + Math.max(2, st / 1000 * s.pps) + 'px;top:' + (top0 + idx * 34) + 'px;'
          + 'display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px dashed #ff9d9d;border-radius:6px;background:#241419;color:#ffd9d9;white-space:nowrap;z-index:5';
        node('span', '「待替换」徽标 · ' + p.name + ' —— ' + p.reason + '（未提交的粘贴预览项，不写入项目文件——磁盘上不存在待解决数据）', ghost);
        button('启用…', ghost, function () { pendingEditIdx = pi; pendingRefresh(); });
        button('移除', ghost, function () { removePendingAt(pi); });
        if (pendingEditIdx === pi) {
          var panel = node('div', undefined, body); panel.className = 'ability-pending-edit';
          panel.style.cssText = 'position:absolute;left:' + Math.max(2, st / 1000 * s.pps) + 'px;top:' + (top0 + mine.length * 34 + 8) + 'px;width:min(360px,80vw);z-index:6';
          buildPendingEditor(p, panel);
        }
      });
      lane.style.height = (parseFloat(lane.style.height) || 40) + mine.length * 34 + (pendingEditIdx != null ? 190 : 8) + 'px';
    }
    if (!items.length) { var hint = node('span', '从技能列表点击或拖入直接按默认落条；单击技能条在下方就地编辑，双击展开更多设置', body); hint.style.cssText = 'font-size:11px;color:#8fa6b5;line-height:32px;pointer-events:none' }
    body.ondragover = function (e) { e.preventDefault() }; body.ondrop = function (e) { e.preventDefault(); e.stopPropagation(); try { var x = JSON.parse(e.dataTransfer.getData('text/plain')); if (!x.fromSidebar || !P.isSkill(x.data)) throw Error('技能轨只接受真实 Action 技能'); quickAdd(x.data, di, Math.max(0, (e.clientX - body.getBoundingClientRect().left) / s.pps)) } catch (err) { root.showToast(err.message) } };
    return lane;
  }
  function suspendEditor() {
    if (session) { root.showToast('请先应用或取消技能编辑，再编辑走位或朝向'); return false; }
    destroyBar(); removeFallback(); return true;
  }
  root.ChoreoAbilityUI = { open, quickAdd, quickAddAll, lane, renderContext, selection, clearSelection, setSel, toggleSel, skillLaneEnd, suspendEditor, setPending, clearPending, pendingList, enableEvent };
})(window);
