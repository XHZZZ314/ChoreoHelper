/* choreo-gearset.js —— 只读显示游戏装备套装，帮助用户手工插入 /gs change；不自动匹配职业。 */
(function () {
  'use strict';
  var MAX_SLOT = 100;
  var activeDialog = null;
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function object(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function error(code, message) { return { ok: false, code: code, error: message }; }
  function integer(value, max) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^[1-9]\d*$/.test(value.trim())) return null;
    var n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && n <= max ? n : null;
  }
  function validateSlot(value) {
    var n = integer(value, MAX_SLOT);
    return n === null ? error('invalid-slot', '装备套装编号须为 1–100 的整数。') : { ok: true, value: n };
  }
  function command(slot) {
    var result = validateSlot(slot);
    return result.ok ? '/gs change ' + result.value : null;
  }
  function normalizeSnapshot(raw) {
    if (!object(raw) || raw.schemaVersion !== 1 || raw.available !== true)
      return error('unavailable', '尚未读取到当前角色的装备套装；也可以直接填写游戏中的套装编号。');
    if (typeof raw.characterKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.characterKey) ||
        !Array.isArray(raw.gearsets) || raw.gearsets.length > MAX_SLOT)
      return error('invalid-snapshot', '游戏返回的装备套装列表无效，请重新读取。');
    var seen = {}, sets = [];
    for (var i = 0; i < raw.gearsets.length; i++) {
      var g = raw.gearsets[i], slot = object(g) ? integer(g.slot, MAX_SLOT) : null;
      var jobId = object(g) ? integer(g.jobId, 255) : null;
      if (slot === null || jobId === null || own(seen, slot) || typeof g.name !== 'string' ||
          g.name.length > 192 || /[\x00-\x1f\x7f]/.test(g.name) || typeof g.mainHandMissing !== 'boolean')
        return error('invalid-snapshot', '装备套装列表含无效或重复项目，请重新读取。');
      seen[slot] = true;
      sets.push({ slot: slot, jobId: jobId, name: g.name, mainHandMissing: g.mainHandMissing });
    }
    sets.sort(function (a, b) { return a.slot - b.slot; });
    var current = raw.currentSlot == null ? null : integer(raw.currentSlot, MAX_SLOT);
    if (raw.currentSlot != null && (current === null || !own(seen, current)))
      return error('invalid-snapshot', '游戏返回的当前装备套装无效，请重新读取。');
    return { ok: true, snapshot: { schemaVersion: 1, available: true, characterKey: raw.characterKey,
      currentSlot: current, gearsets: sets } };
  }
  function makeSwitch(slot, snapshot, classJobs) {
    var check = validateSlot(slot);
    if (!check.ok) return check;
    var snap = normalizeSnapshot(snapshot), set = snap.ok ? snap.snapshot.gearsets.find(function (g) { return g.slot === check.value; }) : null;
    var job = set ? (classJobs || []).find(function (j) { return object(j) && Number(j.id) === set.jobId; }) : null;
    var data = { id: 'gs' + check.value, name: '套装 ' + check.value + (set && set.name ? ' · ' + set.name : ''),
      command: command(check.value), gearsetVerified: !!set, category: 'switch', duration: 0.5, isJobSwitch: true, gearsetSlot: check.value };
    if (!set) data.name += '（未核实）';
    if (set) { data.gearsetName = set.name; data.jobId = set.jobId; data.jobName = job && job.name || ''; }
    return { ok: true, data: data, warning: set && set.mainHandMissing ? '这套装备缺少主手武器，请先在游戏里修好再播放。' :
      !set ? (snap.ok ? '当前角色的列表中没有这套装备。' : '') + '编号未核实：尚不能确认套装是否存在、名称或职业，请在游戏装备套装列表中核对。' : '' };
  }
  function switchItems(snapshot, classJobs) {
    var snap = normalizeSnapshot(snapshot);
    return snap.ok ? snap.snapshot.gearsets.map(function (g) { var item = makeSwitch(g.slot, snap.snapshot, classJobs); item.data.warning = item.warning; return item.data; }) : [];
  }
  // 不重写旧工程，也不根据职业 ID 猜套装编号。调用方在输出/播放前显示这个明确提示。
  function resolveSwitch(data) {
    var raw = data && typeof data.command === 'string' ? data.command : '';
    if (/^\s*\/job(?:\s|$)/i.test(raw))
      return error('legacy-job', '旧的 /job 命令不能切换装备套装，请在宏框中手工改为 /gs change 套装编号。');
    if (!/^\s*\/(?:gs|gearset)\s+change\s+(?:[1-9]\d?|100|"[^"\r\n]+")(?:\s+[1-9]\d*)?\s*$/i.test(raw))
      return error('invalid-command', '切换命令无效：请填写 /gs change 装备套装编号（1–100）；旧数据仍保留。');
    return { ok: true, command: raw };
  }
  var PREVIEW_NOTICE = '编排和拖动不会换装。游戏播放支持明确确认开场套装（0秒、0.5秒、1倍速），再接2秒后的宫廷舞、招手或鞠躬 motion，最多3条、总长10秒；2秒未确认真实职业即停止。其他混合演出和show仍未开放，网页模型不显示游戏装备。';
  function label(data) {
    var result = resolveSwitch(data);
    return (data && data.command || '空切换命令') + (result.ok ? ' · 未核实 / 未执行' : ' · 待修正');
  }
  // 只替换目标条目的命令身份字段，扩展字段和规范事件身份继续保留。
  function updateClip(clip, data, start) {
    var next = JSON.parse(JSON.stringify(clip)), merged = next.data || {};
    ['id','name','command','category','jobName','jobId','jobAbbr','gearsetSlot','gearsetName','gearsetVerified','isJobSwitch','warning'].forEach(function(k){delete merged[k];});
    next.data = Object.assign(merged, data);
    next.start = start;
    if (next._doc && typeof next._doc === 'object') {
      next._doc.command = data.command; next._doc.kind = 'motion'; next._doc.legacyLane = 'switch';
    }
    return next;
  }
  // 单条沿用版本1；版本2只接通开场换装及少量明确普通动作。
  function startChoice(clips, fromTime, speed, snapshot) {
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > 4 || fromTime !== 0 || speed !== 1)
      throw new Error('套装开始仅支持开场一次换装及最多3条普通动作、从0秒开始、1倍速。');
    var c = clips[0], match = /^\/gs change ([1-9]\d?|100)$/.exec(c.command);
    if (c.type !== 'switch' || c.start !== 0 || c.duration !== 0.5 || !match || match[0] !== c.command)
      throw new Error('请明确填写套装编号；单条切换须在0秒开始、时长0.5秒。旧 /job 不会自动转换。');
    var snap = normalizeSnapshot(snapshot);
    if (!snap.ok) throw new Error('当前角色套装清单不可用，请重新连接游戏。');
    var g = snap.snapshot.gearsets.find(function (x) { return x.slot === Number(match[1]); });
    if (!g || g.mainHandMissing) throw new Error('该套装不存在或缺少主手武器，请先在游戏中检查。');
    if (clips.length > 1) {
      var ids = new Set();
      clips.forEach(function (item, i) {
        if (!Number.isInteger(item.id) || ids.has(item.id) || !Number.isInteger(c.actorId) || c.actorId < 0 || item.actorId !== c.actorId)
          throw new Error('条目身份重复或演员不一致。');
        ids.add(item.id);
        if (i && (item.type !== 'action' || ['/balldance motion','/wave motion','/bow motion'].indexOf(item.command) < 0 ||
            !Number.isFinite(item.start) || !Number.isFinite(item.duration) || item.start < 2 || item.start - clips[i-1].start < 0.5 ||
            item.duration < 0.5 || item.start + item.duration > 10))
          throw new Error('仅支持2秒后的宫廷舞、招手、鞠躬 motion；间隔至少0.5秒，总长不超过10秒。聊天、歌词、cue及其他组合不支持。');
      });
      if (!Number.isInteger(snapshot.actualJobId) || snapshot.actualJobId <= 0 || snapshot.actualJobId === g.jobId)
        throw new Error('本次须选择不同于当前实际职业的套装，才能确认职业切换。');
    }
    return { schemaVersion: clips.length > 1 ? 2 : 1, characterKey: snap.snapshot.characterKey, slot: g.slot, jobId: g.jobId, name: g.name };
  }
  async function confirmStart(options) {
    var snapshot = await options.readSnapshot();
    if (!options.isCurrent()) return null;
    var choice = startChoice(options.clips, options.fromTime, options.speed, snapshot);
    var range = choice.schemaVersion === 2 ? '\n2秒内确认真实职业，否则停止且不发送后续动作。\n' +
      options.clips.slice(1).map(function(c){return c.start+'秒：'+c.command+'（'+c.duration+'秒）';}).join('\n') +
      '\n本次总长 '+Math.max.apply(null,options.clips.map(function(c){return c.start+c.duration;}))+'秒，不延后、不补发。' : '';
    if (!options.confirm('本次游戏播放'+(choice.schemaVersion===1?'仅':'开场')+'切换套装 ' + choice.slot + '「' + choice.name + '」。'+range+'\n停止取消未执行动作，不会换回原装备或撤销已发生动作。确认开始这一次？')) return null;
    if (!options.isCurrent()) return null;
    var fresh = await options.readSnapshot();
    if (!options.isCurrent()) return null;
    if (JSON.stringify(choice) !== JSON.stringify(startChoice(options.clips, options.fromTime, options.speed, fresh)))
      throw new Error('角色或套装已改变，本次未开始，请重新选择。');
    return choice;
  }
  // DOM 仅收集用户指定的编号；不保存默认映射、不执行游戏命令。
  function openDialog(options) {
    options = options || {};
    var doc = options.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    if (activeDialog) activeDialog.close();
    var snap = normalizeSnapshot(options.snapshot), bg = doc.createElement('div'), box = doc.createElement('div');
    var invoker = doc.activeElement, closed = false;
    bg.className = 'modal-bg'; bg.id = 'gearsetModal'; box.className = 'modal';
    box.style.maxWidth = '640px'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'gearsetModalTitle');
    function node(tag, text, className) { var n = doc.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; }
    function close() {
      if (closed) return; closed = true;
      doc.removeEventListener('keydown', onKey, true); if (bg.parentNode) bg.parentNode.removeChild(bg);
      if (activeDialog && activeDialog.element === bg) activeDialog = null;
      try { if (invoker && invoker.isConnected) invoker.focus(); } catch (e) {}
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
    var title = node('h3', options.editing ? '修改装备套装切换' : '插入装备套装切换'); title.id = 'gearsetModalTitle'; box.appendChild(title);
    box.appendChild(node('p', '填写你在游戏中保存的套装编号，不按职业推测。此处只编辑，不执行换装；实际开始须点顶部游戏播放，再核对实时目标与动作范围并确认。网页静态模型不会显示游戏装备。'));
    var form = node('label', '装备套装编号：'), input = node('input');
    input.type = 'number'; input.min = '1'; input.max = String(MAX_SLOT); input.step = '1'; input.placeholder = '例如 3';
    input.setAttribute('aria-label', '装备套装编号'); form.appendChild(input); box.appendChild(form);
    if (options.slot != null) input.value = String(options.slot);
    var timeInput = null;
    if (options.start != null) {
      var timeLabel = node('label', ' 开始时间（秒）：'); timeInput = node('input');
      timeInput.type = 'number'; timeInput.min = '0'; timeInput.step = '0.001'; timeInput.value = String(options.start);
      timeInput.setAttribute('aria-label', '切换开始时间'); timeLabel.appendChild(timeInput); box.appendChild(timeLabel);
    }
    var preview = node('pre'); preview.textContent = '/gs change …'; box.appendChild(preview);
    var message = node('p', snap.ok ? '' : snap.error); message.setAttribute('role', 'status');
    function update() {
      preview.textContent = command(input.value) || '/gs change …';
      var r = makeSwitch(input.value, snap.ok ? snap.snapshot : null, options.classJobs);
      message.textContent = input.value === '' ? '' : r.ok ? r.warning : r.error;
    }
    input.addEventListener('input', update);
    if (snap.ok) {
      var list = node('div'); list.style.maxHeight = '42vh'; list.style.overflowY = 'auto';
      switchItems(snap.snapshot, options.classJobs).forEach(function (item) {
        var b = node('button', item.name + (item.jobName ? '（' + item.jobName + '）' : '') + (item.warning ? ' · 缺少主手武器' : ''), 'btn');
        b.type = 'button'; b.style.display = 'block'; b.style.margin = '6px 0';
        b.onclick = function () { input.value = String(item.gearsetSlot); update(); input.focus(); };
        list.appendChild(b);
      });
      if (!snap.snapshot.gearsets.length) list.appendChild(node('p', '当前角色没有已保存的装备套装。'));
      box.appendChild(list);
    }
    box.appendChild(message);
    var acts = node('div', '', 'modal-act');
    function button(label, fn, primary) { var b = node('button', label, 'btn' + (primary ? ' primary' : '')); b.type = 'button'; b.onclick = fn; acts.appendChild(b); return b; }
    if (typeof options.onRefresh === 'function') button('重新读取游戏套装', function () { close(); options.onRefresh(); });
    var insert = button(options.editing ? '应用条目修改' : '插入宏', function () {
      if (closed) return;
      if (typeof options.isPlaying === 'function' && options.isPlaying()) { message.textContent = '请先停止播放，再插入套装切换。'; return; }
      if (snap.ok && typeof options.getCharacterKey === 'function' && options.getCharacterKey() !== snap.snapshot.characterKey) { message.textContent = '游戏角色已改变，请重新读取当前角色的套装。'; return; }
      var r = makeSwitch(input.value, snap.ok ? snap.snapshot : null, options.classJobs);
      if (!r.ok) { message.textContent = r.error; return; }
      if (typeof options.onInsert !== 'function') { message.textContent = '插入入口不可用，未修改编排。'; return; }
      var accepted;
      var start = timeInput ? Number(timeInput.value) : options.start;
      if (timeInput && (timeInput.value.trim() === '' || !Number.isFinite(start) || start < 0 || start > 86400)) { message.textContent = '开始时间须为 0–86400 秒。'; return; }
      try { accepted = options.onInsert(r.data, start); }
      catch (e) { message.textContent = '插入失败，未修改编排。'; return; }
      if (!accepted || accepted.ok !== true) { message.textContent = accepted && accepted.error || '插入失败，未修改编排。'; return; }
      close();
    }, true);
    insert.disabled = typeof options.isPlaying === 'function' && options.isPlaying();
    button('取消', close); box.appendChild(acts); bg.appendChild(box); doc.body.appendChild(bg);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    doc.addEventListener('keydown', onKey, true); if (input.value) update(); input.focus();
    activeDialog = { close: close, element: bg };
    return activeDialog;
  }
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoGearset = { MAX_SLOT: MAX_SLOT, validateSlot: validateSlot, command: command,
    normalizeSnapshot: normalizeSnapshot, makeSwitch: makeSwitch, switchItems: switchItems,
    startChoice: startChoice, confirmStart: confirmStart,
    resolveSwitch: resolveSwitch, label: label, updateClip: updateClip, PREVIEW_NOTICE: PREVIEW_NOTICE, openDialog: openDialog };
})();
