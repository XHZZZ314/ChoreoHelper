// 属性面板（P3 布局信息架构）：右侧栏集中查看/编辑选中片段的开始与时长。
// 校验复用 ChoreoClipTime.plan（与「编辑时间…」弹窗同一规则源），提交由控制器注入（commit）。
// 纯视图模块：不读写 store、不发请求、不碰 localStorage；render() 重建时由控制器重新传入最新选择。
(function () {
  'use strict';
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function trackLabel(track) {
    return track === 'action' ? '动作轨' : track === 'switch' ? '切换轨'
      : track === 'lyric' ? '台词轨' : track === 'global' ? '全局歌词轨' : String(track || '');
  }
  function num(text) { var s = String(text).trim(); return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN; }

  // opts: { selection:[{clip,di,track}], totalDuration(), conflict(start,duration), commit(), onAction(act), onToggle() }
  function render(opts) {
    var p = node('aside', 'prop-pnl'); p.id = 'propPanel';
    var head = node('div', 'prop-head');
    head.appendChild(node('span', 'prop-title', '属性'));
    var bx = node('button', 'btn icon', '✕'); bx.title = '收起属性面板（工具栏「▤ 属性」可再打开）';
    bx.onclick = function () { opts.onToggle(); };
    head.appendChild(bx); p.appendChild(head);
    var body = node('div', 'prop-body'); p.appendChild(body);
    var sel = opts.selection || [];
    if (!sel.length) {
      body.appendChild(node('p', 'prop-hint', '未选中动作条'));
      body.appendChild(node('p', 'prop-hint', '点击时间轴上的动作条查看和编辑属性；Ctrl+点击加选，空白处拖拽框选。'));
      return p;
    }
    if (sel.length > 1) {
      body.appendChild(node('p', 'prop-name', '已选 ' + sel.length + ' 条'));
      var brow = node('div', 'prop-row');
      [['align', '对齐到播放头', '选中条起点统一=播放头（保持各自时长；跨舞者齐奏用）'],
       ['groupMove', '精确平移…', '整组按毫秒精确平移'],
       ['del', '删除所选', '删除全部选中条（可 ↶ 撤销）']].forEach(function (a) {
        var b = node('button', 'btn' + (a[0] === 'del' ? ' danger' : ''), a[1]); b.title = a[2];
        b.onclick = function () { opts.onAction(a[0]); }; brow.appendChild(b);
      });
      body.appendChild(brow);
      return p;
    }
    var it = sel[0], clip = it.clip, snapshot = JSON.stringify(clip);
    body.appendChild(node('p', 'prop-name', (clip.data && clip.data.name) || '选中片段'));
    body.appendChild(node('p', 'prop-meta', (it.di < 0 ? '全局歌词' : '舞者' + (it.di + 1)) + ' · ' + trackLabel(it.track)));
    function field(label, id, value) {
      var l = node('label', 'prop-field', label); var input = node('input');
      input.id = id; input.type = 'text'; input.inputMode = 'decimal'; input.value = String(value);
      l.appendChild(input); body.appendChild(l); return input;
    }
    var inS = field('开始时间（秒）', 'propStart', clip.start);
    var inD = field('时长（秒）', 'propDuration', clip.duration);
    var end = node('p', 'prop-end'); end.id = 'propEnd';
    var msg = node('p', 'prop-err'); msg.id = 'propErr'; msg.setAttribute('role', 'alert');
    function preview() {
      var s = num(inS.value), d = num(inD.value);
      end.textContent = '结束时间：' + (Number.isFinite(s) && Number.isFinite(d) ? ((Math.round(s * 1000) + Math.round(d * 1000)) / 1000).toFixed(3) + ' 秒' : '—');
      msg.textContent = '';
    }
    inS.oninput = inD.oninput = preview; preview();
    body.appendChild(end); body.appendChild(msg);
    var apply = node('button', 'btn primary', '应用'); apply.id = 'propApply';
    apply.title = '校验规则与「编辑时间…」弹窗完全一致（毫秒精度 / 时长≥0.5 秒 / 不出轨道 / 不撞其他条）';
    function commitApply() {
      if (JSON.stringify(clip) !== snapshot) { msg.textContent = '片段已变化，请重新选择后再改。'; return; }
      var r = window.ChoreoClipTime.plan(clip, inS.value, inD.value, opts.totalDuration(), opts.conflict);
      if (!r.ok) { msg.textContent = r.error; return; }
      if (r.changed) { Object.assign(clip, r.patch); opts.commit(); }
    }
    apply.onclick = commitApply;
    inS.onkeydown = inD.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); commitApply(); } e.stopPropagation(); };
    var acts = node('div', 'prop-act'); acts.appendChild(apply); body.appendChild(acts);
    var row = node('div', 'prop-row');
    [['dup', '复制', '复制这条（落在原条之后）'],
     ['align', '对齐到播放头', '本条起点=播放头'],
     ['time', '编辑时间…', '打开精确时间弹窗（与右键菜单同一弹窗）'],
     ['del', '删除', '删除本条（可 ↶ 撤销）']].forEach(function (a) {
      var b = node('button', 'btn' + (a[0] === 'del' ? ' danger' : ''), a[1]); b.title = a[2];
      b.onclick = function () { opts.onAction(a[0]); }; row.appendChild(b);
    });
    body.appendChild(row);
    return p;
  }
  var api = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ChoreoPropsUI = api;
})();
