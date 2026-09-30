// 片段精确时间编辑：只提交明确改变的时间字段，保留原生身份与内容。
(function () {
  'use strict';
  var activeDialog = null;
  function number(text) {
    var s = String(text).trim();
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
  }
  function plan(clip, startText, durationText, totalDuration, conflict) {
    var start = number(startText), duration = number(durationText);
    if (!Number.isFinite(start) || !Number.isFinite(duration)) return { ok: false, error: '请输入有效的开始时间和时长（秒）。' };
    var moved = start !== clip.start, resized = duration !== clip.duration;
    if (!moved && !resized) return { ok: true, changed: false, patch: {} };
    function millis(n) { return Number.isSafeInteger(Math.round(n * 1000)) && Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001; }
    if ((moved && !millis(start)) || (resized && !millis(duration))) return { ok: false, error: '时间最多保留三位小数（毫秒）。' };
    if (resized && duration < 0.5) return { ok: false, error: '时长至少为 0.5 秒。' };
    // 起点移动沿用轨道末端边界；单独设置时长沿用原入口的自动加长轨道能力。
    if (moved && start + duration > totalDuration + 1e-9) return { ok: false, error: '片段结束超出轨道末端，请先加长时间轴。' };
    if (typeof conflict === 'function' && conflict(start, duration)) return { ok: false, error: '与动作或切换片段冲突，未修改。' };
    var patch = {};
    if (moved) patch.start = start;
    if (resized) { patch.duration = duration; patch.autoDur = false; }
    return { ok: true, changed: true, patch: patch };
  }
  function open(options) {
    var doc = document, clip = options.clip, original = JSON.stringify(clip);
    if (activeDialog) activeDialog.close();
    var invoker = doc.activeElement, closed = false;
    function node(tag, text, cls) { var n = doc.createElement(tag); n.textContent = text || ''; if (cls) n.className = cls; return n; }
    var bg = node('div', '', 'modal-bg'), box = node('form', '', 'modal');
    bg.id = 'clipTimeModal'; box.noValidate = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'clipTimeTitle');
    var title = node('h3', '编辑时间'); title.id = 'clipTimeTitle'; box.appendChild(title);
    box.appendChild(node('p', clip.data && clip.data.name || '选中片段'));
    box.appendChild(node('p', '单位：秒，最多三位小数。只有点击“确认”才生效。'));
    function field(label, id, value) {
      var l = node('label', label), input = node('input'); input.id = id; input.type = 'text'; input.inputMode = 'decimal';
      input.value = String(value); l.htmlFor = id; l.appendChild(input); box.appendChild(l); return input;
    }
    var start = field('开始时间（秒）', 'clipTimeStart', clip.start);
    var duration = field('时长（秒）', 'clipTimeDuration', clip.duration);
    var end = node('p'), message = node('p'); end.id = 'clipTimeEnd'; end.setAttribute('aria-live', 'polite'); message.id = 'clipTimeError'; message.setAttribute('role', 'alert');
    function preview() {
      var s = number(start.value), d = number(duration.value);
      end.textContent = '结束时间：' + (Number.isFinite(s) && Number.isFinite(d) ? ((Math.round(s * 1000) + Math.round(d * 1000)) / 1000).toFixed(3) + ' 秒' : '—');
      message.textContent = '';
    }
    start.oninput = duration.oninput = preview; preview(); box.appendChild(end); box.appendChild(message);
    function close() {
      if (closed) return; closed = true; doc.removeEventListener('keydown', onKey, true); bg.remove();
      if (activeDialog && activeDialog.element === bg) activeDialog = null;
      if (invoker && invoker.isConnected) invoker.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      // 弹层键盘不触发底层时间轴删除、播放或撤销；输入框自身快捷键仍由浏览器处理。
      e.stopPropagation();
      if (e.key === 'Tab') {
        var fields = [start, duration, confirm, cancel], i = fields.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); cancel.focus(); }
        else if (!e.shiftKey && (i === fields.length - 1 || i < 0)) { e.preventDefault(); start.focus(); }
      }
    }
    box.onsubmit = function (e) {
      e.preventDefault(); if (closed) return;
      if (!options.isCurrent() || JSON.stringify(clip) !== original) { message.textContent = '项目或片段已经改变，请取消并重新打开。'; return; }
      var result = plan(clip, start.value, duration.value, options.totalDuration(), options.conflict);
      if (!result.ok) { message.textContent = result.error; return; }
      if (result.changed) { Object.assign(clip, result.patch); options.commit(); }
      close();
    };
    var acts = node('div', '', 'modal-act'), confirm = node('button', '确认', 'btn primary'), cancel = node('button', '取消', 'btn');
    confirm.id = 'clipTimeConfirm'; confirm.type = 'submit'; cancel.id = 'clipTimeCancel'; cancel.type = 'button'; cancel.onclick = close;
    acts.appendChild(confirm); acts.appendChild(cancel); box.appendChild(acts); bg.appendChild(box); doc.body.appendChild(bg);
    bg.onmousedown = function (e) { if (e.target === bg) close(); };
    doc.addEventListener('keydown', onKey, true); (options.focusDuration ? duration : start).focus();
    activeDialog = { element: bg, close: close }; return activeDialog;
  }
  var api = { plan: plan, open: open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ChoreoClipTime = api;
})();
