// test-api.js — choreo-api.js 的 node 单测（ARCH-2：48794/48795 配对本地 API 客户端）
//
// 跑法：D:\nodejs\node.exe web\test-api.js
//
// 干嘛的：把「一个客户端边界」锁死成回归契约：
//   一、静态扫描：七个消费方文件里零 localhost:48794/48795 直连，基址只归 choreo-api.js；
//       客户端自身零 DOM/localStorage/IndexedDB 访问
//   二、请求生命周期（线上形状）：端口↔基址、路径拼接、方法/头/体原样透传
//   三、配对码头：provider 注入 X-Choreo-Token 只作用于高层 api/preview；裸请求保持匿名
//       （/capabilities 能力探测在拆分前就不带头，必须继续不带头）
//   四、超时：game.api 恒 4000ms；raw 按 timeoutMs 走、缺省不限时（录制长阻塞靠它保持原行为）
//   五、403 配对：配对回调触发 + 中文报错逐字一致
//   六、错误映射：非 2xx 读出 e.status/e.detail（message 优先于 error）；坏体不炸；2xx 坏 JSON 照抛
//   七、取消/竞态/并发：外部 signal 可取消；并发调用互不串话（客户端无可变共享态）
//   八、无未处理拒绝：成功/失败全路径跑一遍，进程级 unhandledRejection 计数为零
//   九、恢复：端口从挂到通不重载即可恢复（客户端不缓存失败状态）
//   十、preview 语义：POST JSON {command}、403 之外不判 ok 直接回 JSON（调用方按 status 提示）

'use strict';

global.window = global;
require('./choreo-api.js');
var ChoreoAPI = global.ChoreoAPI;
var fs = require('fs');
var path = require('path');

var passes = 0, fails = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; console.log('  \u2714 ' + name + (detail ? ('（' + detail + '）') : '')); }
  else { fails++; console.log('  \u2718 ' + name + (detail ? ('（' + detail + '）') : '')); }
}
function section(s) { console.log('== ' + s + ' =='); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

// ---------- 可编程 fetch 替身 ----------
var realFetch = global.fetch;
var calls = [];          // 每次 {url, init}
var handler = null;      // function(url, init) → Promise<Response>；null 时回 200 JSON
function jsonResponse(body, status) {
  status = status || 200;
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(JSON.parse(JSON.stringify(body))); },
  };
}
function rawResponse(status, jsonBehavior) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: jsonBehavior,
  };
}
// 挂起到被 abort 才拒绝的响应（测超时/取消）
function abortableResponse() {
  return function (url, init) {
    return new Promise(function (_resolve, reject) {
      var e = new Error('The operation was aborted');
      e.name = 'AbortError';
      if (init.signal && init.signal.aborted) return reject(e);
      if (init.signal) init.signal.addEventListener('abort', function () { reject(e); });
    });
  };
}
function installFetch(h) {
  handler = h;
  calls.length = 0;
  global.fetch = function (url, init) {
    calls.push({ url: url, init: init });
    return handler ? handler(url, init) : Promise.resolve(jsonResponse({}));
  };
}
var realSetTimeout = global.setTimeout;
// 把 setTimeout 换成「立即触发并记下时长」——验证超时数值不用真等 4 秒
var firedTimeoutMs = null;
function captureTimeout() {
  firedTimeoutMs = null;
  global.setTimeout = function (fn, ms) { firedTimeoutMs = ms; fn(); return 0; };
}
function restoreTimeout() { global.setTimeout = realSetTimeout; }

// ---------- 一、静态扫描 ----------
section('静态扫描：直连只剩 choreo-api.js 一处');
var consumers = ['choreo-app-auth.js', 'choreo-app-edit-tx.js', 'choreo-app-catalog.js', 'choreo-app.js', 'choreo-recording-ui.js', 'choreo-library.js', 'choreo-show-ui.js', 'choreo-check-ui.js', 'choreo-lyrics-ui.js', 'preview3d.js'];
consumers.forEach(function (name) {
  var src = fs.readFileSync(path.join(__dirname, name), 'utf8');
  var hits = src.match(/localhost:4879[45]/g) || [];
  ok(name + ' 零 localhost:48794/48795 直连', hits.length === 0, hits.join(', ') || '0 处');
});
var apiSrc = fs.readFileSync(path.join(__dirname, 'choreo-api.js'), 'utf8');
ok('choreo-api.js 持有 48794 基址', apiSrc.indexOf("GAME_BASE = 'http://localhost:48794'") >= 0);
ok('choreo-api.js 持有 48795 基址', apiSrc.indexOf("EXPORT_BASE = 'http://localhost:48795'") >= 0);
ok('48795 JSON 调用全部走高层 api（消费方零 export.raw 直呼，模型/二进制才走 raw/rawUrl）',
  consumers.every(function (name) {
    return !/ChoreoAPI\.export\.raw\(/.test(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  }));
ok('客户端自身零 DOM/localStorage/IndexedDB 访问',
  !/(localStorage\.(getItem|setItem|removeItem)|indexedDB\.(open|transaction)|document\.(getElementById|querySelector|createElement|body))/.test(apiSrc));

// ---------- 二、请求生命周期 ----------
section('请求生命周期：端口↔基址、路径、方法/头/体透传');
installFetch(function () { return Promise.resolve(jsonResponse({ clips: ['a'] })); });
var p2a = ChoreoAPI.export.raw('/export/list', { method: 'GET', headers: { 'X-Choreo-Token': 'TOKEN95' } }).then(function (r) { return r.json(); });
var p2b = ChoreoAPI.game.raw('/capabilities', { timeoutMs: 3000 });
var p2c = ChoreoAPI.export.raw('/export/clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"command":"/bow"}' });
Promise.all([p2a, p2b, p2c]).then(function () {
  ok('48795 裸请求拼对基址与路径', calls[0].url === 'http://localhost:48795/export/list', calls[0].url);
  ok('48794 裸请求拼对基址与路径', calls[1].url === 'http://localhost:48794/capabilities', calls[1].url);
  ok('方法/头/体原样透传', calls[2].url === 'http://localhost:48795/export/clip' && calls[2].init.method === 'POST'
    && calls[2].init.headers['Content-Type'] === 'application/json' && calls[2].init.body === '{"command":"/bow"}');

  // ---------- 三、配对码头 ----------
  section('配对码头：provider 只注入高层 api/preview，裸请求保持匿名');
  ChoreoAPI.setTokenProvider(function () { return { 'X-Choreo-Token': 'ABC123' }; });
  installFetch(function () { return Promise.resolve(jsonResponse({ ok: 1 })); });
  return Promise.all([
    ChoreoAPI.game.api('/health'),
    ChoreoAPI.game.preview('/beckon motion'),
    ChoreoAPI.game.raw('/capabilities', {}),
    ChoreoAPI.export.raw('/export/list', { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    ChoreoAPI.export.api('/export/list', { headers: { 'Content-Type': 'application/json' } }),
  ]).then(function () {
    ok('game.api 带上 X-Choreo-Token', calls[0].init.headers['X-Choreo-Token'] === 'ABC123');
    ok('game.api 保留调用方自己的头', calls[0].init.headers['Content-Type'] === undefined);
    ok('game.preview 带上 X-Choreo-Token', calls[1].init.headers['X-Choreo-Token'] === 'ABC123');
    ok('game.raw（能力探测）保持匿名', calls[2].init.headers['X-Choreo-Token'] === undefined, JSON.stringify(calls[2].init.headers));
    ok('export.raw 不注入 provider 码（调用方显式给才带）', calls[3].init.headers['X-Choreo-Token'] === undefined);
    ok('export.api 带上 X-Choreo-Token', calls[4].init.headers['X-Choreo-Token'] === 'ABC123');
    ok('export.api 保留调用方自己的头', calls[4].init.headers['Content-Type'] === 'application/json');
    ChoreoAPI.setTokenProvider(null);
    installFetch(function () { return Promise.resolve(jsonResponse({})); });
    return Promise.all([
      ChoreoAPI.game.api('/health'),
      ChoreoAPI.export.api('/export/list'),
    ]).then(function () {
      ok('无 provider 时不带头（老插件兼容模式，48794）', !calls[0].init.headers['X-Choreo-Token']);
      ok('无 provider 时不带头（老插件兼容模式，48795）', !calls[1].init.headers['X-Choreo-Token']);
    });
  });
}).then(function () {

  // ---------- 四、超时 ----------
  section('超时：api 恒 4000ms，raw 按次可配、缺省不限时');
  captureTimeout();
  installFetch(abortableResponse());
  var t4a = ChoreoAPI.game.api('/health').then(function () { return 'no-timeout'; }, function (e) { return e.name; });
  return t4a.then(function (r4a) {
    ok('game.api 默认 4000ms 超时并中止', r4a === 'AbortError' && firedTimeoutMs === 4000, 'fired=' + firedTimeoutMs);
    restoreTimeout();
    captureTimeout();
    var t4b = ChoreoAPI.export.raw('/export/clip', { method: 'POST', timeoutMs: 2500 }).then(function () { return 'no-timeout'; }, function (e) { return e.name; });
    return t4b.then(function (r4b) {
      ok('raw 按次 timeoutMs 生效', r4b === 'AbortError' && firedTimeoutMs === 2500, 'fired=' + firedTimeoutMs);
      restoreTimeout();
      installFetch(function () { return Promise.resolve(jsonResponse({ ok: 1 })); });
      return ChoreoAPI.export.raw('/export/clip', { method: 'POST', body: '{}' }).then(function () {
        ok('raw 缺省不限时（长阻塞录制不被掐）', true);
      });
    });
  });
}).then(function () {

  // ---------- 四b、超时×取消复合 ----------
  // 审查回归：初版 fetch 只观察「外部 signal || 超时 controller」其中之一，
  // 两者同时在场时超时掐不住请求（独立复现 HUNG_AFTER_TIMER）——这里钉死复合语义
  section('超时×取消复合：外部 signal 与按次超时任一方触发都中止请求');
  // 有界竞争：请求 2 秒不落定记 HUNG（坏回归表现为挂死，不能让整个套件跟着挂）
  function bounded(p) {
    return Promise.race([p, tick(2000).then(function () { return { r: 'HUNG', dt: 9999 }; })]);
  }
  function timed(p) {
    var t0 = Date.now();
    return p.then(function () { return { r: 'settled', dt: Date.now() - t0 }; },
                  function (e) { return { r: e.name, dt: Date.now() - t0 }; });
  }
  installFetch(abortableResponse());
  var neverCtrl = new AbortController();   // 全程不中止的外部 signal
  var extCtrl2 = new AbortController();
  realSetTimeout(function () { extCtrl2.abort(); }, 30);
  var preAborted = new AbortController(); preAborted.abort();
  return Promise.all([
    bounded(timed(ChoreoAPI.export.raw('/export/clip', { method: 'POST', timeoutMs: 30, signal: neverCtrl.signal }))),
    bounded(timed(ChoreoAPI.export.raw('/export/clip', { method: 'POST', timeoutMs: 60000, signal: extCtrl2.signal }))),
    bounded(timed(ChoreoAPI.export.raw('/export/clip', { method: 'POST', signal: preAborted.signal }))),
  ]).then(function (rs) {
    ok('超时掐得住带外部 signal 的请求（30ms 超时 vs 永不中止的 signal）',
      rs[0].r === 'AbortError' && rs[0].dt < 2000, rs[0].r + '@' + rs[0].dt + 'ms');
    ok('外部 signal 掐得住带超时的请求（30ms 外部中止 vs 60s 超时）',
      rs[1].r === 'AbortError' && rs[1].dt < 2000, rs[1].r + '@' + rs[1].dt + 'ms');
    ok('已中止的 signal 立即失败不挂起', rs[2].r === 'AbortError' && rs[2].dt < 2000, rs[2].r + '@' + rs[2].dt + 'ms');
    // game.api 恒 4000ms 路径同样吃复合：captureTimeout 让 4000ms 立刻到点（审查复现的原场景）
    return new Promise(function (resolveD) {
      var doneD = false;
      realSetTimeout(function () { if (!doneD) { doneD = true; resolveD({ r: 'HUNG', dt: 9999 }); } }, 2000);
      captureTimeout();
      var extD = new AbortController();
      var tD = Date.now();
      ChoreoAPI.game.api('/health', { signal: extD.signal }).then(
        function () { restoreTimeout(); if (!doneD) { doneD = true; resolveD({ r: 'settled', dt: Date.now() - tD }); } },
        function (e) { restoreTimeout(); if (!doneD) { doneD = true; resolveD({ r: e.name, dt: Date.now() - tD }); } });
    }).then(function (rD) {
      restoreTimeout();
      ok('game.api 恒 4000 超时对带外部 signal 的请求同样生效', rD.r === 'AbortError' && rD.dt < 2000, rD.r + '@' + rD.dt + 'ms');
    });
  });
}).then(function () {

  // ---------- 五、403 配对 ----------
  section('403 配对：48794 回调触发+中文逐字一致；48795 只分类成 e.pairing 不统一弹提示');
  var pairingToasts = 0;
  ChoreoAPI.setPairingHandler(function () { pairingToasts++; });
  ChoreoAPI.setTokenProvider(function () { return { 'X-Choreo-Token': 'BAD' }; });
  installFetch(function () { return Promise.resolve(jsonResponse({}, 403)); });
  return Promise.all([
    ChoreoAPI.game.api('/playback/stop', { method: 'POST' }).then(function () { return ''; }, function (e) { return e.message; }),
    ChoreoAPI.game.preview('/beckon motion').then(function () { return ''; }, function (e) { return e.message; }),
    ChoreoAPI.export.api('/export/list').then(function () { return null; }, function (e) { return e; }),
  ]).then(function (msgs) {
    ok('game.api 403 报错逐字一致', msgs[0] === '/playback/stop: 403 需要配对', msgs[0]);
    ok('game.preview 403 报错逐字一致', msgs[1] === '403 需要配对', msgs[1]);
    ok('403 触发配对提示回调两次（只有 48794 侧）', pairingToasts === 2, String(pairingToasts));
    ok('export.api 403 分类成 e.status=403 + e.pairing',
      msgs[2] && msgs[2].status === 403 && msgs[2].pairing === true && msgs[2].message === '/export/list: 403 需要配对',
      msgs[2] && (msgs[2].status + '/' + String(msgs[2].pairing) + '/' + msgs[2].message));
    ChoreoAPI.setTokenProvider(null);
    ChoreoAPI.setPairingHandler(null);
    installFetch(function () { return Promise.resolve(jsonResponse({}, 403)); });
    return ChoreoAPI.game.api('/health').then(function () { return ''; }, function (e) { return e.message; }).then(function (m) {
      ok('未注册回调时 403 照样抛错不炸', m === '/health: 403 需要配对', m);
    });
  });
}).then(function () {

  // ---------- 六、错误映射 ----------
  section('错误映射：e.status/e.detail 与拆分前一致，坏体不炸');
  installFetch(function (url) {
    if (url.indexOf('/actions') >= 0) return Promise.resolve(rawResponse(404, function () { return Promise.resolve({ message: '动作不存在' }); }));
    if (url.indexOf('/shows/load') >= 0) return Promise.resolve(rawResponse(409, function () { return Promise.resolve({ error: '有演出在跑' }); }));
    if (url.indexOf('/bad') >= 0) return Promise.resolve(rawResponse(500, function () { return Promise.reject(new SyntaxError('Unexpected token < in JSON')); }));
    return Promise.resolve(rawResponse(200, function () { return Promise.reject(new SyntaxError('bad json')); }));
  });
  return Promise.all([
    ChoreoAPI.game.api('/actions/emotes').then(function () { return null; }, function (e) { return e; }),
    ChoreoAPI.game.api('/shows/load', { method: 'POST', body: '{}' }).then(function () { return null; }, function (e) { return e; }),
    ChoreoAPI.game.api('/bad').then(function () { return null; }, function (e) { return e; }),
    ChoreoAPI.game.api('/ugc').then(function () { return 'parsed'; }, function (e) { return 'err:' + e.message; }),
  ]).then(function (rs) {
    ok('404 e.status=404 且 detail 取 message', rs[0] && rs[0].status === 404 && rs[0].detail === '动作不存在', rs[0] && rs[0].detail);
    ok('409 e.status=409 且 detail 回退到 error', rs[1] && rs[1].status === 409 && rs[1].detail === '有演出在跑', rs[1] && rs[1].detail);
    ok('非 JSON 错误体不炸、detail 保持未置（与拆分前一致）', rs[2] && rs[2].status === 500 && !rs[2].detail, rs[2] && String(rs[2].detail));
    ok('2xx 坏 JSON 照样向调用方抛（调用方自己兜）', rs[3] === 'err:bad json' || /bad json|Unexpected/.test(rs[3]), rs[3]);
    // 48795 高层 api 的状态/错误映射 + 401 两端口（审查补充）
    installFetch(function (url) {
      if (url.indexOf(':48794/') >= 0) return Promise.resolve(rawResponse(401, function () { return Promise.resolve({ message: '配对码无效' }); }));
      if (url.indexOf('/export/list') >= 0) return Promise.resolve(rawResponse(401, function () { return Promise.resolve({ message: '配对码无效' }); }));
      if (url.indexOf('/export/getclip') >= 0) return Promise.resolve(rawResponse(404, function () { return Promise.resolve({ error: 'not found' }); }));
      if (url.indexOf('/export/clip') >= 0) return Promise.resolve(rawResponse(413, function () { return Promise.resolve({ error: 'request body too large', message: '请求体超过上限（64KB）' }); }));
      if (url.indexOf('/export/verify') >= 0) return Promise.resolve(rawResponse(500, function () { return Promise.reject(new SyntaxError('Unexpected token < in JSON')); }));
      return Promise.resolve(jsonResponse({ clips: ['a'] }));
    });
    return Promise.all([
      ChoreoAPI.game.api('/playback/status').then(function () { return null; }, function (e) { return e; }),
      ChoreoAPI.export.api('/export/list').then(function () { return null; }, function (e) { return e; }),
      ChoreoAPI.export.api('/export/getclip?name=x').then(function () { return null; }, function (e) { return e; }),
      ChoreoAPI.export.api('/export/clip', { method: 'POST' }).then(function () { return null; }, function (e) { return e; }),
      ChoreoAPI.export.api('/export/verify', { method: 'POST' }).then(function () { return null; }, function (e) { return e; }),
      ChoreoAPI.export.api('/export/other').then(function (j) { return j; }, function (e) { return 'err:' + e.message; }),
    ]).then(function (rs) {
      ok('401 两端口同映射：e.status=401 且 detail 取 message',
        rs[0] && rs[0].status === 401 && rs[0].detail === '配对码无效' && rs[1] && rs[1].status === 401 && rs[1].detail === '配对码无效',
        rs[0] && rs[0].detail + ' / ' + (rs[1] && rs[1].detail));
      ok('48795 错误体原文在 e.body（调用方按插件「error」短码取词）',
        rs[2] && rs[2].status === 404 && rs[2].body && rs[2].body.error === 'not found' && rs[2].detail === 'not found',
        rs[2] && JSON.stringify(rs[2].body));
      ok('message 优先于 error（413 detail=中文 message，body 保留 error 短码）',
        rs[3] && rs[3].status === 413 && rs[3].detail === '请求体超过上限（64KB）' && rs[3].body && rs[3].body.error === 'request body too large',
        rs[3] && rs[3].detail);
      ok('500 非 JSON 体：e.status=500、detail/body 不置、不炸',
        rs[4] && rs[4].status === 500 && !rs[4].detail && rs[4].body === undefined,
        rs[4] && String(rs[4].detail));
      ok('48795 2xx 返回解析后的 JSON', rs[5] && rs[5].clips && rs[5].clips[0] === 'a', JSON.stringify(rs[5]));
    });
  });
}).then(function () {

  // ---------- 七、取消/竞态/并发 ----------
  section('取消/竞态/并发：外部 signal 可取消，并发互不串话');
  var extCtrl = new AbortController();
  installFetch(abortableResponse());
  var t7a = ChoreoAPI.export.raw('/export/clip', { method: 'POST', signal: extCtrl.signal }).then(function () { return 'ok'; }, function (e) { return e.name; });
  extCtrl.abort();
  return t7a.then(function (r7a) {
    ok('调用方 AbortController 可取消', r7a === 'AbortError', r7a);
    // 并发：两个不同请求各自的响应不错位（客户端无可变共享态）
    installFetch(function (url) {
      return Promise.resolve(jsonResponse(url.indexOf('/export/list') >= 0 ? { clips: ['a', 'b'] } : { count: 7 }));
    });
    return Promise.all([
      ChoreoAPI.export.raw('/export/list').then(function (r) { return r.json(); }),
      ChoreoAPI.game.raw('/playback/status').then(function (r) { return r.json(); }),
    ]).then(function (rs) {
      ok('并发响应不错位', rs[0].clips && rs[0].clips.length === 2 && rs[1].count === 7, JSON.stringify(rs));
      // 超替：新意图发出后旧请求才晚到——只有当前意图能改可观察状态（连接探测/录制轮询的守卫模式）；
      // 客户端把晚到的旧响应/失败交付成普通落定，守卫忽略即可，不炸不悬
      var deferreds = [];
      installFetch(function () {
        var res, rej;
        var p = new Promise(function (r, j) { res = r; rej = j; });
        deferreds.push({ res: res, rej: rej });
        return p;
      });
      var seq = 0, state = null, applied = [];
      function probeOnce() {
        var my = ++seq;
        return ChoreoAPI.export.api('/export/list').then(function (j) {
          if (my !== seq) { applied.push('stale-ignored'); return; }
          state = j.clips; applied.push('applied');
        }, function () {
          if (my !== seq) { applied.push('stale-ignored'); return; }
          state = null; applied.push('applied-err');
        });
      }
      var p1 = probeOnce();  // 旧意图，挂起
      var p2 = probeOnce();  // 新意图，超替
      deferreds[1].res(jsonResponse({ clips: ['new'] }));   // 新意图先回：落状态
      deferreds[0].res(jsonResponse({ clips: ['stale'] })); // 旧请求晚到：必须被忽略
      return Promise.all([p1, p2]).then(function () {
        ok('超替后晚到的旧响应不改状态、只有当前意图生效',
          !!state && state[0] === 'new' && applied.length === 2
          && applied.indexOf('applied') >= 0 && applied.indexOf('stale-ignored') >= 0,
          JSON.stringify({ state: state, applied: applied }));
        deferreds.length = 0; seq = 0; state = null; applied = [];
        var q1 = probeOnce();
        var q2 = probeOnce();
        deferreds[1].rej(new TypeError('Failed to fetch'));  // 新意图按失败落定
        deferreds[0].rej(new TypeError('Failed to fetch'));  // 旧意图晚到的失败同样只被忽略
        return Promise.all([q1, q2]).then(function () {
          ok('超替后晚到的旧失败也不改状态',
            state === null && applied.length === 2
            && applied.indexOf('applied-err') >= 0 && applied.indexOf('stale-ignored') >= 0,
            JSON.stringify({ state: state, applied: applied }));
        });
      });
    });
  });
}).then(function () {

  // ---------- 八、无未处理拒绝 ----------
  section('无未处理拒绝：全路径失败都有人接（含 48795 高层 api 与录制调用方同形生命周期）');
  var unhandled = [];
  var onUR = function (e) { unhandled.push(e); };
  process.on('unhandledRejection', onUR);
  // recRecordOne 同形映射：迁移后的录制调用方生命周期（api → 结果对象），覆盖其全部失败分支
  function recShaped(path, opts) {
    return ChoreoAPI.export.api(path, opts).then(function (j) {
      return j && j.error ? { ok: false, err: j.error } : { ok: true };
    }, function (e) {
      if (e && e.pairing) return { ok: false, pairing: true, err: '需要配对' };
      if (e && e.status && e.body && e.body.error) return { ok: false, err: e.body.error };
      return { ok: false, net: true, err: (e && e.message) || '网络失败' };
    });
  }
  installFetch(function (url) {
    if (url.indexOf('/export/clip') >= 0) return Promise.resolve(jsonResponse({ error: 'busy' }, 400));
    if (url.indexOf('/export/list') >= 0) return Promise.resolve(jsonResponse({}, 403));
    if (url.indexOf('/export/verify') >= 0) return Promise.resolve(rawResponse(409, function () { return Promise.resolve({ error: 'busy', message: '一个审核已在进行' }); }));
    return Promise.reject(new TypeError('Failed to fetch'));
  });
  var extU = new AbortController();
  realSetTimeout(function () { extU.abort(); }, 30);
  var eaten = [];
  eaten.push(ChoreoAPI.game.api('/health').catch(function (e) { return eaten.push(e.message); }));
  eaten.push(ChoreoAPI.game.preview('/x').catch(function (e) { return eaten.push(e.message); }));
  eaten.push(ChoreoAPI.export.raw('/export/list').catch(function (e) { return eaten.push(e.message); }));
  eaten.push(ChoreoAPI.game.raw('/capabilities', { timeoutMs: 10 }).catch(function (e) { return eaten.push(e.message); }));
  eaten.push(ChoreoAPI.export.api('/export/skeleton').catch(function (e) { return eaten.push(e.message); }));
  eaten.push(recShaped('/export/clip', { method: 'POST' }));            // 400 带错误体 → err:busy
  eaten.push(recShaped('/export/list', {}));                            // 403 → pairing
  eaten.push(recShaped('/export/getclip?name=x', {}));                  // 网络失败 → net
  eaten.push(recShaped('/export/verify', { method: 'POST' }).then(function (r) { return eaten.push(r.err); })); // 409 带中文体
  eaten.push(ChoreoAPI.export.api('/export/clip', { method: 'POST', timeoutMs: 100, signal: extU.signal })
    .catch(function (e) { return eaten.push(e.name); }));               // 超时+外部 signal 复合取消
  return Promise.all(eaten).then(function () { return tick(80); }).then(function () {
    ok('客户端路由的调用与调用方映射零未处理拒绝', unhandled.length === 0, unhandled.map(function (e) { return e && e.message; }).join(' | ') || '0 条');
    process.off('unhandledRejection', onUR);
  });
}).then(function () {

  // ---------- 九、恢复 ----------
  section('恢复：端口从挂到通，不重载即恢复');
  var up = false;
  installFetch(function () { return up ? Promise.resolve(jsonResponse({ clips: [] })) : Promise.reject(new TypeError('Failed to fetch')); });
  return ChoreoAPI.export.raw('/export/list').then(function () { return 'up'; }, function () { return 'down'; }).then(function (first) {
    up = true;
    return ChoreoAPI.export.raw('/export/list').then(function () { return 'up'; }, function () { return 'down'; }).then(function (second) {
      ok('失败后下一拍请求即恢复（无缓存失败态/无需重载）', first === 'down' && second === 'up', first + '→' + second);
    });
  });
}).then(function () {

  // ---------- 十、preview 语义 ----------
  section('preview 语义：POST JSON {command}，非 403 不判 ok 直接回 JSON');
  installFetch(function () { return Promise.resolve(jsonResponse({ status: 'ng', reason: '游戏没接' }, 500)); });
  return ChoreoAPI.game.preview('/beckon motion').then(function (j) {
    var c = calls[0].init;
    ok('preview 发 POST /preview + JSON 命令体', c.method === 'POST' && calls[0].url === 'http://localhost:48794/preview'
      && JSON.parse(c.body).command === '/beckon motion' && c.headers['Content-Type'] === 'application/json', c.body);
    ok('preview 非 403 状态不判 ok，JSON 原样回给调用方', j && j.status === 'ng', JSON.stringify(j));
  });
}).then(function () {
  installFetch(realFetch);
  console.log('\nApi: ' + passes + ' 通过 / ' + fails + ' 失败');
  if (fails) process.exitCode = 1;
}).catch(function (e) {
  installFetch(realFetch);
  console.error('  \u2718 测试链异常中断：' + (e && e.stack || e));
  process.exitCode = 1;
});
