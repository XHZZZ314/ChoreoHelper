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

  // P3 多选精确平移就地编辑：会话状态由 app 注入 read/commit，逻辑复用 ChoreoGroupMove.session
  // （与旧对话框同一套校验/预览/单次提交）；旧浮动对话框仅在无工作台宿主时回落，能力不删。
  var gm = null; // {key, session, offset, error}
  function closeGroupMove() { if (gm && gm.session) gm.session.cancel(); gm = null; }
  function openGroupMove(opts) {
    if (!(window.ChoreoGroupMove && ChoreoGroupMove.session)) return false;
    closeGroupMove();
    gm = { key: (opts && opts.key) || '', session: ChoreoGroupMove.session(opts.read, opts.commit), offset: '+0.000', error: '' };
    if (typeof window.refreshWorkbenchBars === 'function') window.refreshWorkbenchBars();
    return true;
  }
  function groupMoveActive() { return !!gm; }

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
  // P1-A 上下文栏（并入第一步）：选中单个片段时的就地编辑。
  // 等待和时长为普通草稿，应用/取消共享边界；精确开始折叠，校验复用 ChoreoClipTime。
  // opts: { selection, neighbors(clip)->{prev,next}, totalDuration(), conflict(start,duration), commit(), onAction(act) }
  function fmtSec(t) { return Number(t).toFixed(1) + 's'; }
  function renderContextBar(opts) {
    var sel = opts.selection || [];
    if (sel.length !== 1) return null;
    var it = sel[0], clip = it.clip;
    var name = (clip.data && clip.data.name) || '选中片段';
    var bar = node('section', 'wb-ctx'); bar.id = 'wbCtx'; bar.setAttribute('aria-label', '片段就地编辑');
    // J2：编辑区点名「正在修改」的对象（舞者＋第几条＋名称），与上方「下一条添加到」互不回写
    var ord = opts.ordinal ? opts.ordinal(clip) : null;
    bar.appendChild(node('span', 'wb-ctx-name', '正在修改：' + (opts.dancerName || (it.di < 0 ? '全局歌词' : '舞者' + (it.di + 1))) + (ord ? (' · 第' + ord + '条「' + name + '」') : (' · 「' + name + '」'))));
    bar.appendChild(node('span', 'wb-ctx-field', '摘要 0.1 秒 · 编辑/预告 0.001 秒'));
    // P4-A（#34）：切换轨片段就地编辑套装编号/时间（＋未核验标注）；
    // 校验与提交走 opts.gearset（控制器注入旧套装窗同一套 makeSwitch/updateClip/撤销链），旧对话框保留为专家入口。
    // 套装栏保持紧凑（与动作条栏同量级）：选中瞬间不大幅推动时间轴，右键/拖动落点不漂移。
    var gear = opts.gearset || null;
    var gearCase = !!(gear && it.di >= 0 && it.track === 'switch');
    var startEl = node('span', 'wb-ctx-field', '开始 ' + fmtSec(clip.start)); startEl.id = 'wbCtxStart';
    if (!gearCase) bar.appendChild(startEl);
    if (gearCase) {
      var gearCmd = function () { return String((clip.data && clip.data.command) || ''); };
      var gearSlotOf = function () { var m = gearCmd().match(/\/(?:gs|gearset)\s+change\s+([1-9]\d?|100)\s*$/i); return m ? m[1] : ''; };
      var verified = !!(clip.data && clip.data.gearsetVerified);
      var mark = node('span', 'wb-ctx-field' + (verified ? '' : ' wb-ctx-warn'), verified
        ? '已核实：' + (clip.data.gearsetName || '套装') + (clip.data.jobName ? '（' + clip.data.jobName + '）' : '')
        : '编号未核验');
      mark.id = 'wbCtxGearMark';
      mark.title = verified ? '' : '编排与网页预览不会换装；未读取游戏套装清单，尚不能确认套装是否存在、名称或职业，实际播放前请在游戏装备套装列表核对编号';
      bar.appendChild(mark);
      var gearSnapshot = JSON.stringify(clip);
      var slotLab = node('label', 'wb-ctx-field', '套装编号');
      var gearSlot = node('input'); gearSlot.type = 'number'; gearSlot.min = '1'; gearSlot.max = '100'; gearSlot.step = '1';
      gearSlot.id = 'wbCtxGearSlot'; gearSlot.setAttribute('aria-label', '装备套装编号（1–100）');
      gearSlot.value = gearSlotOf();
      slotLab.appendChild(gearSlot); bar.appendChild(slotLab);
      var startLab = node('label', 'wb-ctx-field', '开始时间(秒)');
      var gearStart = node('input'); gearStart.type = 'number'; gearStart.min = '0'; gearStart.step = '0.001';
      gearStart.id = 'wbCtxGearStart'; gearStart.setAttribute('aria-label', '切换开始时间（秒）');
      gearStart.value = String(clip.start);
      startLab.appendChild(gearStart); bar.appendChild(startLab);
      var gApply = node('button', 'btn primary', '应用'); gApply.type = 'button'; gApply.id = 'wbCtxGearApply';
      gApply.title = '校验与旧套装窗一致（编号 1–100 / 开始 0–86400 秒）；应用立即保存、可 ↶ 撤销';
      var gExpert = node('button', 'btn', '旧套装窗…'); gExpert.type = 'button'; gExpert.id = 'wbCtxGearExpert';
      gExpert.title = '「修改套装编号 / 时间…」旧套装窗：可读取游戏套装清单逐套核对（专家/回落入口，与右键菜单同窗）';
      gExpert.onclick = function () { if (gear.onExpert) gear.onExpert(); };
      bar.appendChild(gApply); bar.appendChild(gExpert);
      var gDur = node('span', 'wb-ctx-field', '时长 ' + fmtSec(clip.duration)); gDur.id = 'wbCtxDur';
      bar.appendChild(gDur);
      var gearPreview = node('div', 'wb-ctx-preview'); gearPreview.id = 'wbCtxGearPreview'; gearPreview.setAttribute('role', 'status');
      var gearErr = node('p', 'prop-err'); gearErr.id = 'wbCtxGearErr'; gearErr.setAttribute('role', 'alert');
      function gearRefresh() {
        if (String(gearSlot.value).trim() === '') { gearPreview.textContent = ''; return; }
        var r = gear.preview(String(gearSlot.value));
        gearPreview.textContent = r && r.ok ? (r.command + (r.warning ? ' · ' + r.warning : '')) : (r && r.error) || '';
      }
      gearSlot.oninput = gearRefresh;
      async function gearApply() {
        gearErr.textContent = '';
        var v = window.ChoreoGearset ? window.ChoreoGearset.validateSlot(String(gearSlot.value)) : null;
        if (!v || !v.ok) { gearErr.textContent = '装备套装编号须为 1–100 的整数。'; return; }
        var st = num(gearStart.value);
        if (String(gearStart.value).trim() === '' || !Number.isFinite(st) || st < 0 || st > 86400) { gearErr.textContent = '开始时间须为 0–86400 秒。'; return; }
        if (JSON.stringify(clip) !== gearSnapshot) { gearErr.textContent = '片段已变化，请重新选择后再改。'; return; }
        if (gearCmd() === '/gs change ' + v.value && Math.abs(st - clip.start) < 1e-9) { gearErr.textContent = '编号与时间都没有变化。'; return; }
        var r = await gear.apply(v.value, Math.round(st * 1000) / 1000);
        if (!r || r.ok !== true) gearErr.textContent = (r && r.error) || '应用失败，未修改编排。';
      }
      gApply.onclick = gearApply;
      gearSlot.onkeydown = gearStart.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); gearApply(); }
        else if (e.key === 'Escape') { // 就地取消：恢复当前值，零改动
          e.preventDefault(); gearSlot.value = gearSlotOf(); gearStart.value = String(clip.start);
          gearRefresh(); gearErr.textContent = '';
        }
        e.stopPropagation();
      };
      gearRefresh();
      bar.appendChild(gearPreview); bar.appendChild(gearErr);
    }
    // 网页主流程：等待/时长/精确开始共享草稿；失焦零写，应用一次，取消零写。
    var nb = opts.neighbors ? opts.neighbors(clip) : { prev: null, next: null };
    var prevEnd = it.di >= 0 && it.track === 'action' && nb.prev ? nb.prev.start + nb.prev.duration : null;
    var snapshot = JSON.stringify(clip), waitInput = null, waitEdited = false;
    var timeFields = node('div', 'wb-time-fields');
    function timeField(label, id, value, host) {
      var l = node('label', 'wb-ctx-field', label), input = node('input');
      input.type = 'text'; input.inputMode = 'decimal'; input.id = id; input.value = String(value);
      input.setAttribute('aria-label', label); l.appendChild(input); host.appendChild(l); return input;
    }
    if (prevEnd != null) waitInput = timeField('这条开始前：与上一条结束相隔（秒）', 'wbCtxWait', Math.round((clip.start - prevEnd) * 1000) / 1000, timeFields);
    var inDur = timeField('时长（秒）', 'wbCtxDurEdit', clip.duration, timeFields);
    var exactFields = node('div', 'wb-ctx-expert-body');
    var inStart = timeField('精确开始（秒）', 'wbCtxStartEdit', clip.start, exactFields);
    var durEl = node('span', 'wb-ctx-field', '时长 ' + fmtSec(clip.duration)); durEl.id = 'wbCtxDur';
    if (!gearCase) bar.appendChild(durEl);
    var pv = node('div', 'wb-ctx-preview'); pv.id = 'wbChangePreview'; pv.setAttribute('role', 'status');
    var errEl = node('p', 'prop-err'); errEl.id = 'wbCtxTimeError'; errEl.setAttribute('role', 'alert');
    // J3：预告一句话同时给开始/编排时长/结束/相邻开始间隔；时长来源由控制器注入（五分类，只标可确认者）
    function previewTime() {
      errEl.textContent = '';
      var ns = num(inStart.value), nd = num(inDur.value);
      var valid = Number.isFinite(ns) && Number.isFinite(nd) && (!waitEdited || Number.isFinite(num(waitInput.value)));
      if (!valid) { pv.textContent = '待应用：请输入有效的非负时间；尚未修改编排。'; return; }
      var dirty = ns !== clip.start || nd !== clip.duration;
      var msg = (dirty ? '待应用：' : '已保存：') + '从 ' + ns.toFixed(3) + 's 开始，编排 ' + nd.toFixed(3) + 's，到 ' + (ns + nd).toFixed(3) + 's 结束';
      if (prevEnd != null) msg += '；上一条从 ' + nb.prev.start.toFixed(3) + 's 开始、' + prevEnd.toFixed(3) + 's 结束，与这条开始相隔 ' + (ns - nb.prev.start).toFixed(3) + 's';
      msg += '；只改这条，后面的片段不动';
      if (nb.next) {
        // R3：与下一条的关系按真实区间相交说明——「草稿结束−下一条开始」不是交集，
        // 草稿排在其后或相离时不得报重叠
        var nS = nb.next.start, nE = nS + nb.next.duration;
        var ov = Math.round((Math.min(ns + nd, nE) - Math.max(ns, nS)) * 1000) / 1000;
        var gap = Math.round((nS - ns - nd) * 1000) / 1000;
        msg += '；后面的「' + ((nb.next.data && nb.next.data.name) || '下一条') + '」仍从 ' + nS.toFixed(3) + 's 开始，'
          + (ov > 0 ? '与这条重叠 ' + ov.toFixed(3) + 's（应用会校验）' : ns >= nE ? '在这条之前结束，不重叠' : gap === 0 ? '正好衔接' : '与这条结束相隔 ' + gap.toFixed(3) + 's');
      }
      if (it.di >= 0 && it.track === 'action' && opts.durationSource) {
        var src = opts.durationSource(clip);
        if (src) msg += dirty ? ('；时长为草稿输入（当前保存的时长来源：' + src + '）') : ('；时长来源：' + src);
      }
      pv.textContent = msg;
    }
    if (waitInput) waitInput.oninput = function () {
      waitEdited = true;
      var v = num(waitInput.value);
      inStart.value = Number.isFinite(v) ? String(Math.round((prevEnd + v) * 1000) / 1000) : '';
      previewTime();
    };
    inStart.oninput = function () {
      waitEdited = false;
      if (waitInput) { var v = num(inStart.value); waitInput.value = Number.isFinite(v) ? String(Math.round((v - prevEnd) * 1000) / 1000) : ''; }
      previewTime();
    };
    inDur.oninput = previewTime;
    function cancelTime() {
      waitEdited = false;
      inStart.value = String(clip.start); inDur.value = String(clip.duration);
      if (waitInput) waitInput.value = String(Math.round((clip.start - prevEnd) * 1000) / 1000);
      snapshot = JSON.stringify(clip); previewTime();
    }
    function applyTime() {
      errEl.textContent = '';
      if (!bar.isConnected || JSON.stringify(clip) !== snapshot) { errEl.textContent = '片段已变化，请重新选择后再改。'; return; }
      if (waitEdited && !Number.isFinite(num(waitInput.value))) { errEl.textContent = '等待须为有效的非负秒数，未修改。'; return; }
      var r = window.ChoreoClipTime.plan(clip, inStart.value, inDur.value, opts.totalDuration(), opts.conflict);
      if (!r.ok) {
        // 首条旅程 §3：拒绝时说明与下一条的具体重叠（重叠量本地计算，不依赖校验来源）
        var ns2 = num(inStart.value), nd2 = num(inDur.value), detail = '';
        if (nb.next && Number.isFinite(ns2) && Number.isFinite(nd2)) {
          // R3：重叠量按真实区间相交计算；不相交（草稿排在其后/相离）不追加重叠说明
          var nS2 = nb.next.start, nE2 = nS2 + nb.next.duration;
          var ov = Math.round((Math.min(ns2 + nd2, nE2) - Math.max(ns2, nS2)) * 1000) / 1000;
          if (ov > 0) detail = '（与下一条「' + ((nb.next.data && nb.next.data.name) || '动作') + '」' + nS2.toFixed(3) + '–' + nE2.toFixed(3) + 's 重叠 ' + ov.toFixed(3) + 's）';
        }
        errEl.textContent = r.error + detail;
        return;
      }
      if (r.changed) { Object.assign(clip, r.patch); snapshot = JSON.stringify(clip); if (opts.commit) opts.commit(); }
      previewTime();
    }
    [waitInput, inDur, inStart].filter(Boolean).forEach(function (input) {
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyTime(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelTime(); }
        e.stopPropagation();
      };
    });
    var bApply = node('button', 'btn primary', '应用'), bCancel = node('button', 'btn', '取消');
    bApply.type = bCancel.type = 'button'; bApply.id = 'wbCtxTimeApply'; bCancel.id = 'wbCtxTimeCancel';
    bApply.onclick = applyTime; bCancel.onclick = cancelTime;
    timeFields.appendChild(bApply); timeFields.appendChild(bCancel);
    bar.appendChild(timeFields); bar.appendChild(pv); bar.appendChild(errEl); previewTime();
    var acts = node('div', 'wb-ctx-actions');
    // P1-C 同处走位入口：动作片段就地发起，舞台切俯视标签点目的地（时间轴上下文保留）
    if (it.di >= 0 && it.track === 'action') {
      var mv = node('button', 'btn', '走位…'); mv.type = 'button'; mv.id = 'wbCtxMove';
      mv.title = '在舞台俯视图里为这个动作点一个目的地，设到达时刻（默认=片段结束）与走/跑；应用后可撤销';
      mv.onclick = function () { if (opts.onAction) opts.onAction('move'); };
      acts.appendChild(mv);
      // P3 独立朝向：片段上下文栏「转向…」=独立朝向节点编辑（时刻/角度，一次撤销）
      var trn = node('button', 'btn', '转向…'); trn.type = 'button'; trn.id = 'wbCtxTurn';
      trn.title = '编辑这位舞者的独立朝向节点（到达时刻+角度）：可与走位不同时刻，也可原地转身；应用一次撤销，游戏执行须插件宣告 stageFacingV1 后另行接入';
      trn.onclick = function () { if (opts.onAction) opts.onAction('turn'); };
      acts.appendChild(trn);
    }
    // J4 循环试看：首点按钮即写明循环；范围与停止方式点击前可见（不只放 title），退出只承诺退出循环
    var reh = node('button', 'btn', '循环试看这一段'); reh.type = 'button'; reh.id = 'wbCtxRehearse';
    var rehActive = !!(opts.rehearsalActive && opts.rehearsalActive());
    var ra = Math.max(0, Math.round((clip.start - 0.5) * 10) / 10), rb = Math.round((clip.start + clip.duration + 0.5) * 10) / 10;
    if (rehActive) {
      reh.textContent = '退出循环试看';
      var rg = opts.rehearsalRange ? opts.rehearsalRange() : null;
      var badge = node('span', 'wb-ctx-loop', rg ? ('循环试看中 ' + Number(rg.a).toFixed(1) + '–' + Number(rg.b).toFixed(1) + 's（停止即退出）') : '循环试看中（停止即退出）');
      badge.id = 'wbCtxLoop'; badge.setAttribute('role', 'status');
      bar.appendChild(badge);
    } else {
      var rehHint = node('span', 'wb-ctx-field', '（网页循环 ' + ra.toFixed(1) + '–' + rb.toFixed(1) + 's，两边各留 0.5s；点顶部 ⏹ 停止或再点一次退出）');
      rehHint.id = 'wbCtxRehHint';
      bar.appendChild(rehHint);
    }
    reh.title = '网页循环试看 ' + ra.toFixed(1) + '–' + rb.toFixed(1) + 's（片段前后各留 0.5 秒）；点顶部 ⏹ 停止或再点一次退出循环。替身或缺素材时看到的是顺序与位置，不代表真实动作已预览';
    reh.onclick = function () { if (opts.onAction) opts.onAction('rehearse'); };
    acts.appendChild(reh);
    // P3：属性面板单选职责并入上下文栏——复制/对齐到播放头就地；开始与时长在「更多设置」，删除在右侧
    var bDup = node('button', 'btn', '复制'); bDup.type = 'button'; bDup.id = 'wbCtxDup';
    bDup.title = '复制这条（落在原条之后）';
    bDup.onclick = function () { if (opts.onAction) opts.onAction('dup'); };
    var bAli = node('button', 'btn', '对齐到播放头'); bAli.type = 'button'; bAli.id = 'wbCtxAlign';
    bAli.title = '本条起点=播放头（保持时长）';
    bAli.onclick = function () { if (opts.onAction) opts.onAction('align'); };
    acts.appendChild(bDup); acts.appendChild(bAli);
    var bTime = node('button', 'btn', '编辑时间…'); bTime.type = 'button';
    bTime.id = 'editClipTime';
    bTime.onclick = function () { fold.open = true; inStart.focus(); };
    var bDel = node('button', 'btn danger', '删除'); bDel.type = 'button';
    bDel.onclick = function () { if (opts.onAction) opts.onAction('del'); };
    acts.appendChild(bTime); acts.appendChild(bDel); bar.appendChild(acts);
    var fold = document.createElement('details'); fold.className = 'wb-ctx-expert';
    var sum = document.createElement('summary'); sum.textContent = '更多设置（专家参数）';
    fold.appendChild(sum);
    fold.appendChild(exactFields); bar.appendChild(fold);
    return bar;
  }
  // P2/P3 跨类型多选上下文栏（动作×技能同一「单击选中→上下文栏」规则）：批量对齐/精确平移/删除
  // 都在就地完成；技能片段不参与对齐/平移（仍只按选择集删除，一次撤销恢复全部）。
  // opts: { actionCount, skillCount, key, onDelete, onAlign, onGroupMove }
  function renderMultiContextBar(opts) {
    var bar = node('section', 'wb-ctx'); bar.id = 'wbCtx'; bar.setAttribute('aria-label', '多选就地编辑');
    var n = (opts.actionCount || 0) + (opts.skillCount || 0);
    bar.appendChild(node('span', 'wb-ctx-name', '已选 ' + n + ' 条' + (opts.skillCount ? ('（含技能 ' + opts.skillCount + '）') : '')));
    bar.appendChild(node('span', 'wb-ctx-field', '删除后可一次撤销恢复；技能片段只参与删除'));
    var acts = node('div', 'wb-ctx-actions');
    if ((opts.actionCount || 0) >= 1) {
      var ba = node('button', 'btn', '对齐到播放头'); ba.type = 'button'; ba.id = 'wbCtxAlignSel';
      ba.title = '所选动作条起点统一=播放头（保持各自时长；跨舞者齐奏用）';
      ba.onclick = function () { if (opts.onAlign) opts.onAlign(); };
      acts.appendChild(ba);
    }
    if ((opts.actionCount || 0) >= 2) {
      var bgm = node('button', 'btn', '平移…'); bgm.type = 'button'; bgm.id = 'wbCtxGroupMove';
      bgm.title = '整组按毫秒精确平移：公共偏移+改动预告，确认后一次撤销';
      bgm.onclick = function () { if (opts.onGroupMove) opts.onGroupMove(); };
      acts.appendChild(bgm);
    }
    var bd = node('button', 'btn danger', '删除所选'); bd.id = 'wbCtxDelSel'; bd.type = 'button';
    bd.onclick = function () { if (opts.onDelete) opts.onDelete(); };
    acts.appendChild(bd); bar.appendChild(acts);
    if (gm && gm.key === (opts.key || '')) bar.appendChild(renderGroupMoveForm());
    return bar;
  }
  // P3 精确平移就地表单：公共 delta + 改动预告；确认走 ChoreoGroupMove.session.submit（一次撤销）
  function renderGroupMoveForm() {
    var box = node('div', 'wb-gmove'); box.id = 'wbGroupMoveForm';
    box.appendChild(node('span', 'wb-ctx-field', '整组用同一偏移，保留相对间距；只有确认才生效'));
    var lab = node('label', 'wb-ctx-field', '偏移（秒，支持正负号与毫秒）');
    var inp = node('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.id = 'wbGroupMoveOffset';
    inp.setAttribute('aria-label', '整组偏移（秒）'); inp.value = gm.offset;
    lab.appendChild(inp); box.appendChild(lab);
    var summary = node('div', 'wb-ctx-preview'); summary.id = 'wbGroupMovePreview'; summary.setAttribute('role', 'status');
    var msg = node('p', 'prop-err'); msg.id = 'wbGroupMoveError'; msg.setAttribute('role', 'alert');
    box.appendChild(summary); box.appendChild(msg);
    function refresh() {
      var r = gm.session.preview(inp.value);
      msg.textContent = r.ok ? '' : r.error;
      summary.textContent = r.ok ? ('选中 ' + r.count + ' 条；请求偏移 ' + signed(r.requested) + '，实际可应用 ' + signed(r.applied) + (r.clamped ? '（已按整组公共边界钳制）' : '')
        + '；平移后整组范围 ' + r.start.toFixed(3) + ' → ' + r.end.toFixed(3) + ' 秒' + (!r.changed ? '；无可应用偏移，确认不会修改' : '')) : '';
    }
    function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(3); }
    inp.oninput = function () { gm.offset = inp.value; refresh(); };
    inp.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmMove(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelMove(); }
      e.stopPropagation();
    };
    var row = node('div', 'wb-ctx-actions');
    var ok = node('button', 'btn primary', '确认平移'); ok.type = 'button'; ok.id = 'wbGroupMoveConfirm';
    ok.onclick = confirmMove;
    var no = node('button', 'btn', '取消'); no.type = 'button'; no.id = 'wbGroupMoveCancel';
    no.onclick = cancelMove;
    row.appendChild(ok); row.appendChild(no); box.appendChild(row);
    function confirmMove() {
      if (!gm) return;
      var r = gm.session.submit(inp.value);
      if (!r.ok) { gm.error = r.error; refresh(); return; }
      gm = null;
      if (typeof window.refreshWorkbenchBars === 'function') window.refreshWorkbenchBars();
    }
    function cancelMove() {
      if (!gm) return;
      closeGroupMove();
      if (typeof window.refreshWorkbenchBars === 'function') window.refreshWorkbenchBars();
    }
    refresh();
    return box;
  }
  var api = { render: render, renderContextBar: renderContextBar, renderMultiContextBar: renderMultiContextBar, openGroupMove: openGroupMove, closeGroupMove: closeGroupMove, groupMoveActive: groupMoveActive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ChoreoPropsUI = api;
})();
