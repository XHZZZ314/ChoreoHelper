// 主页演出执行界面（EXEC-CORE）：「🎬 演出执行」面板——编译当前项目为演出包，一次性装载给
// 插件演出执行器（ShowRunner），由玩家显式开始（倒计时）并可用紧急停止随时安全停。
// 与「游戏预览」（网页逐帧驱动的 /playback/* 链路）是两条独立通道：本面板只说 /shows/* 协议。
// 能力握手：仅当插件 /capabilities 带 shows 段（协议 v1 + motion/cue/lyrics 执行器）时可用；
// X1 以显式身份准备整包并走定向就绪/预约/停止；准备成功不代表物理校准与游戏执行已验收。
'use strict';

var _showPanelUi = null;   // {box, line, log} 面板元素引用（关闭后判空）
var _showPollTimer = null;
var _showOwned = null, _showOwnedMode = false;

function showExecOwned() {
  if (!_showOwned) {
    if (!window.ChoreoShowOwned || !window.ChoreoX1Inputs) throw new Error('缺少正式演出输入模块，请完整更新网页。');
    _showOwned = ChoreoShowOwned.create({ api: function (path, options) { return apiFetch(path, options); },
      randomUUID: function () { return window.crypto.randomUUID(); }, now: function () { return performance.now(); } });
  }
  return _showOwned;
}

function showExecCancelLocal() { if (_showOwned) _showOwned.cancelLocal(); }
function showExecConfirmGlobalStop() { if (_showOwned) _showOwned.confirmGlobalStop(); _showOwnedMode=false; showExecRefresh(); }

function showExecSupported() {
  var caps = store.pluginCaps;
  return !!(store.capsOk && caps && caps.shows && caps.shows.protocol >= 1 &&
    Array.isArray(caps.shows.executors) && caps.shows.executors.indexOf('motion') >= 0);
}

function showExecStateText(st) {
  var map = {
    idle: '空闲（没有装载演出）', loaded: '已装载（可就绪）', armed: '已就绪（可开始）',
    countdown: '倒计时中…', playing: '执行中', stopping: '正在安全停止…',
    completed: '已完成', faulted: '已安全停止（故障）',
  };
  return map[st] || (st || '未知');
}

async function showExecPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

// 编译当前项目 → /shows/load。返回 true=装载成功
async function showExecLoad() {
  if (!showExecSupported()) {
    showToast('当前插件不支持演出执行器（需要新版插件并在游戏内重载后再试）');
    return false;
  }
  var compiled;
  try {
    compiled = ChoreoShowCompiler.compile(projectRecord());
  } catch (e) {
    showToast('编译失败：' + ((e && e.message) || e));
    return false;
  }
  if (!compiled.ok) {
    var first = compiled.issues.filter(function (i) { return i.level === 'error'; })[0];
    showToast('编译不通过：' + (first ? first.message : '未知原因'));
    return false;
  }
  try {
    if (_showOwned && _showOwned.active()) throw new Error('本页上次 X1 演出尚未安全停止，请先重试停止。');
    var r;
    if (compiled.pkg.x1 !== undefined) { _showOwnedMode = true; r = await showExecOwned().load(compiled.pkg); }
    else { r = await showExecPost('/shows/load', { package: compiled.pkg }); _showOwnedMode = false; }
    showToast('已装载「' + (compiled.pkg.name || '演出') + '」：' + compiled.pkg.events.length + ' 条事件，共 ' +
      Math.round(compiled.pkg.durationMs / 1000) + ' 秒。下一步：就绪 → 开始');
    showExecRefresh();
    return true;
  } catch (e) {
    showToast('插件拒绝装载：' + ((e && e.detail) || (e && e.message) || '未知原因'));
    return false;
  }
}

async function showExecAction(path, body, doneMsg) {
  if (!showExecSupported()) { showToast('当前插件不支持演出执行器'); return; }
  try {
    if (_showOwnedMode) {
      var owned = showExecOwned();
      if (path === '/shows/arm') await owned.arm();
      else if (path === '/shows/start') await owned.start(body.countdownMs);
      else if (path === '/shows/stop') await owned.stop();
      else throw new Error('正式演出操作无效。');
    } else await showExecPost(path, body);
    if (doneMsg) showToast(doneMsg);
    showExecRefresh();
  } catch (e) {
    showToast('插件拒绝：' + ((e && e.detail) || (e && e.message) || '未知原因'));
  }
}

async function showExecRefresh() {
  if (!_showPanelUi || !document.body.contains(_showPanelUi.box)) return;
  var panel = _showPanelUi, line = panel.line, log = panel.log;
  var ownedStamp = _showOwnedMode && _showOwned ? JSON.stringify(_showOwned.state()) : '';
  if (!store.gameConnected) {
    line.textContent = '游戏未连接——演出执行需要开着游戏（插件 48794）';
    log.textContent = '';
    return;
  }
  try {
    var st = await apiFetch('/shows/status');
    if (_showPanelUi !== panel || (ownedStamp !== (_showOwnedMode && _showOwned ? JSON.stringify(_showOwned.state()) : ''))) return;
    var prog = st.total ? (' 进度 ' + st.dispatched + '/' + st.total + ' · ' + Math.round(st.showTimeMs / 1000) + 's/' + Math.round(st.durationMs / 1000) + 's') : '';
    line.textContent = '状态：' + showExecStateText(st.state) + prog +
      (st.stopReason ? (' · 上次停止原因：' + st.stopReason) : '');
    log.textContent = st.logText || '（还没有执行记录）';
    // 按钮可用性按真实状态收敛（开始只接受 armed；停止总是可用）
    var b = _showPanelUi.btns;
    b.arm.disabled = !(st.state === 'loaded' || st.state === 'completed' || st.state === 'faulted');
    b.start.disabled = st.state !== 'armed';
    b.stop.disabled = false;
    if (_showOwnedMode && _showOwned) {
      var own = _showOwned.state();
      b.arm.disabled = b.arm.disabled || !own.packageId || own.loading || own.cancelling || !!own.armId;
      b.start.disabled = b.start.disabled || !own.armId || own.cancelling;
    }
  } catch (e) {
    if (_showPanelUi !== panel) return;
    line.textContent = '状态读取失败：' + ((e && e.message) || e);
  }
}

function showExecPanel() {
  if (!store.gameConnected) { showToast('游戏没连上——演出执行需要开着游戏'); return; }
  if (!showExecSupported()) {
    showToast('当前插件不支持演出执行：游戏内插件需要更新到带 shows 能力的版本');
    return;
  }
  var bd = el('div', 'modal-bg');
  var m = el('div', 'modal');
  m.style.minWidth = '520px'; m.style.maxWidth = '620px';
  m.innerHTML = '<h3>🎬 演出执行（实验）</h3>';
  var box = el('div', '');
  m.appendChild(box);
  bd.onclick = function (e) {
    if (e.target === bd) { showExecClosePanel(); document.body.removeChild(bd); }
  };
  bd.appendChild(m);
  document.body.appendChild(bd);

  var info = el('div', '');
  info.style.cssText = 'font-size:12px;line-height:1.7;color:#aab6c8;border:1px solid #252e3c;border-radius:6px;padding:8px 10px;margin-bottom:8px';
  info.textContent = '流程：编译并装载 → 就绪 → 开始（3 秒倒计时后插件用本地时钟自主执行，网页关掉不影响）。' +
    '演出执行的是当前编辑的项目快照；战斗/过场/换图/角色消失会立即安全停止。' +
    '随时可点「紧急停止」。技能、路径与朝向需要完整输入和明确演员/舞台绑定；' +
    '准备通过后仍须满足实际输入校准与游戏状态检查。X1 停止后请重新装载再就绪；清理失败时请重试停止。';
  box.appendChild(info);

  var line = el('div', '');
  line.style.cssText = 'font-size:13px;color:#e8c57a;margin-bottom:8px;white-space:pre-line';
  line.textContent = '状态：读取中…';
  box.appendChild(line);

  var row = el('div', '');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
  var bLoad = el('button', 'btn primary', '⤴ 编译并装载');
  bLoad.title = '把当前项目编译成演出包，一次性装载给插件（插件会做二次校验）';
  bLoad.onclick = function () { showExecLoad(); };
  var bArm = el('button', 'btn', '✓ 就绪');
  bArm.title = '校验通过、进入待开始状态（开始只接受已就绪的演出）';
  bArm.onclick = function () { showExecAction('/shows/arm', {}, '演出已就绪：点「开始」进入倒计时'); };
  var bStart = el('button', 'btn primary', '▶ 开始');
  bStart.title = '玩家显式开始：3 秒倒计时后插件按本地时钟执行（可倒计时中取消）';
  bStart.onclick = function () {
    if (!confirm('开始演出？倒计时 3 秒后角色将由插件本地时钟接管执行。\n（战斗/过场/换图/紧急停止都会立即安全停）')) return;
    showExecAction('/shows/start', { countdownMs: 3000 }, '倒计时开始，演出交给插件执行');
  };
  var bStop = el('button', 'btn danger', '⏹ 紧急停止');
  bStop.title = '任何状态下立即安全停止：停移动、清未执行事件、退定格（幂等，可重复按）';
  bStop.onclick = function () { if (window.ChoreoStop) ChoreoStop.stop(); else showExecAction('/shows/stop', {}, '已请求安全停止'); };
  row.appendChild(bLoad); row.appendChild(bArm); row.appendChild(bStart); row.appendChild(bStop);
  box.appendChild(row);

  var logTitle = el('div', '');
  logTitle.style.cssText = 'font-size:11px;color:#7a8597;margin-bottom:4px';
  logTitle.textContent = '执行日志（最近 10 条，计划时刻=发送时刻演出时间）';
  box.appendChild(logTitle);
  var log = el('div', '');
  log.style.cssText = 'font-size:11px;color:#c7d2e2;background:#131a26;border:1px solid #20293a;border-radius:6px;padding:8px;max-height:180px;overflow-y:auto;white-space:pre-line';
  log.textContent = '（还没有执行记录）';
  box.appendChild(log);

  _showPanelUi = { box: box, line: line, log: log, btns: { arm: bArm, start: bStart, stop: bStop } };
  showExecRefresh();
  if (_showPollTimer) clearInterval(_showPollTimer);
  _showPollTimer = setInterval(function () {
    if (!_showPanelUi || !document.body.contains(_showPanelUi.box)) { showExecClosePanel(); return; }
    showExecRefresh();
  }, 1500);
}

function showExecClosePanel() {
  if (_showPollTimer) { clearInterval(_showPollTimer); _showPollTimer = null; }
  _showPanelUi = null;
}

// 无头验收/诊断钩子：编译当前项目（不发包）
window.__showDebug = function () {
  var compiled = ChoreoShowCompiler.compile(projectRecord());
  return { supported: showExecSupported(), compiled: compiled };
};
