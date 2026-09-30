// 多选片段精确平移：公共边界预览、过期保护和单次明确提交。
(function () {
  'use strict';
  var active = null;
  function plan(clips, text, totalDuration) {
    var s = String(text).trim(), requested = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
    if (!Number.isFinite(requested) || !Number.isSafeInteger(Math.round(requested * 1000))) return { ok: false, error: '请输入有效的正负偏移秒数，例如 +0.137 或 -1.025。' };
    if (Math.abs(requested * 1000 - Math.round(requested * 1000)) > 0.00001) return { ok: false, error: '偏移最多保留三位小数（毫秒）。' };
    if (clips.length < 2) return { ok: false, error: '请至少选中两个片段。' };
    var copies = clips.map(function (c) { return { start: c.start, duration: c.duration }; });
    // 与拖动共用唯一的整组移动规则；预览只移动临时对象，不增加冲突拒绝或腾位。
    var applied = ChoreoEdit.pure.moveGroup(copies, requested, totalDuration);
    if (Math.abs(applied) < 1e-9) { applied = 0; copies = clips; }
    return { ok: true, requested: requested, applied: applied, changed: applied !== 0,
      clamped: Math.abs(applied - requested) > 1e-9, count: clips.length,
      start: Math.min.apply(null, copies.map(function (c) { return c.start; })),
      end: Math.max.apply(null, copies.map(function (c) { return c.start + c.duration; })),
      starts: copies.map(function (c) { return c.start; }) };
  }
  function session(read, commit) {
    var origin = read(), entries = origin.items.slice(), contents = entries.map(function (e) { return JSON.stringify(e.clip); }), stale = false, done = false;
    function valid() {
      var now = read();
      if (now.projectId !== origin.projectId || now.owner !== origin.owner || now.totalDuration !== origin.totalDuration || now.items.length !== entries.length) stale = true;
      entries.forEach(function (e, i) {
        if (!now.items.some(function (n) { return n.clip === e.clip && n.owner === e.owner && n.track === e.track; }) || JSON.stringify(e.clip) !== contents[i]) stale = true;
      });
      return !stale && !done;
    }
    function preview(text) {
      if (!valid()) return { ok: false, error: '项目、选择或片段已经改变，请取消并重新打开。' };
      return plan(entries.map(function (e) { return e.clip; }), text, origin.totalDuration);
    }
    return { preview: preview, valid: valid, cancel: function () { done = true; }, submit: function (text) {
      var result = preview(text); if (!result.ok) return result;
      done = true;
      if (result.changed) { entries.forEach(function (e, i) { e.clip.start = result.starts[i]; }); commit(); }
      return result;
    } };
  }
  function open(read, commit) {
    if (active) active.close();
    var edit = session(read, commit), doc = document, invoker = doc.activeElement, closed = false;
    function node(tag, text, cls) { var n = doc.createElement(tag); n.textContent = text || ''; if (cls) n.className = cls; return n; }
    var bg = node('div', '', 'modal-bg'), box = node('form', '', 'modal'); bg.id = 'groupMoveModal'; box.noValidate = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'groupMoveTitle');
    var title = node('h3', '精确平移'); title.id = 'groupMoveTitle'; box.appendChild(title);
    box.appendChild(node('p', '整组选中片段使用同一偏移，保留相对间距。只有确认才生效。'));
    var label = node('label', '偏移（秒，支持正负号与毫秒）'), input = node('input'); input.type = 'text'; input.inputMode = 'decimal'; input.value = '+0.000'; input.id = 'groupMoveOffset'; label.htmlFor = input.id; label.appendChild(input); box.appendChild(label);
    var summary = node('p'), message = node('p'); summary.id = 'groupMovePreview'; summary.style.whiteSpace = 'pre-line'; summary.setAttribute('aria-live', 'polite'); message.id = 'groupMoveError'; message.setAttribute('role', 'alert'); box.appendChild(summary); box.appendChild(message);
    function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(3); }
    function refresh() {
      var r = edit.preview(input.value); message.textContent = r.ok ? '' : r.error;
      summary.textContent = r.ok ? '选中：' + r.count + ' 条\n请求偏移：' + signed(r.requested) + ' 秒\n实际可应用：' + signed(r.applied) + ' 秒' + (r.clamped ? '（已按整组公共边界钳制）' : '') + '\n平移后整组范围：' + r.start.toFixed(3) + ' → ' + r.end.toFixed(3) + ' 秒' + (!r.changed ? '\n无可应用偏移，确认不会修改或新增撤销步骤。' : '') : '';
    }
    function close() { if (closed) return; closed = true; edit.cancel(); doc.removeEventListener('keydown', onKey, true); bg.remove(); if (active && active.element === bg) active = null; if (invoker && invoker.isConnected) invoker.focus(); }
    function onKey(e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        var fields = [input, confirm, cancel], i = fields.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); cancel.focus(); }
        else if (!e.shiftKey && (i < 0 || i === fields.length - 1)) { e.preventDefault(); input.focus(); }
      }
    }
    box.onsubmit = function (e) { e.preventDefault(); if (closed) return; var r = edit.submit(input.value); if (!r.ok) { refresh(); return; } close(); };
    var acts = node('div', '', 'modal-act'), confirm = node('button', '确认平移', 'btn primary'), cancel = node('button', '取消', 'btn');
    confirm.id = 'groupMoveConfirm'; confirm.type = 'submit'; cancel.id = 'groupMoveCancel'; cancel.type = 'button'; cancel.onclick = close;
    acts.appendChild(confirm); acts.appendChild(cancel); box.appendChild(acts); bg.appendChild(box); doc.body.appendChild(bg);
    input.oninput = refresh; bg.onmousedown = function (e) { if (e.target === bg) close(); }; doc.addEventListener('keydown', onKey, true);
    active = { element: bg, close: close, refresh: refresh }; refresh(); input.focus(); input.select(); return active;
  }
  var api = { plan: plan, session: session, open: open, refresh: function () { if (active) active.refresh(); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else globalThis.ChoreoGroupMove = api;
})();
