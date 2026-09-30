// choreo-api.js — ARCH-2（本地 API 客户端边界）：48794 演放/演出 与 48795 录制/导出
// 两个配对客户端的唯一 HTTP 出口。给每个本地请求统一配对码头、按次超时、取消与错误映射；
// 线上协议（端口/路径/方法/请求体/响应形状/中文报错）与拆分前逐字节一致。
// 客户端自身零 DOM/localStorage/IndexedDB 访问：配对码由主程序经 setTokenProvider 注入，
// 48794 侧 403 配对提示经 setPairingHandler 回调（toast 节流仍归主页控制器）；
// 48795 侧 403 只分类成 e.pairing 错误不统一弹提示——连接探测要静默降级，弹不弹归调用方。
// fetch 在请求时才取全局名字——诊断页/测试在请求前替换 window.fetch 仍能截获。
'use strict';
(function () {
  var GAME_BASE = 'http://localhost:48794';   // 演放/目录/歌词/演出（HttpServer.cs）
  var EXPORT_BASE = 'http://localhost:48795'; // 录制/骨架/模型/导出（ExportServer.cs）
  var DEFAULT_TIMEOUT_MS = 4000;              // apiFetch 拆分前的既有超时，保持不变

  var _writeControllers = new Set(), _outputBlocked = false, _writeGeneration = 0;
  function gameWrite(path, opts) {
    var endpoint; try { endpoint = new URL(String(path), GAME_BASE).pathname.toLowerCase(); } catch (e) { return false; }
    var write = endpoint === "/debug/poke" || String(opts && opts.method || "GET").toUpperCase() === "POST";
    return write && endpoint !== "/auth/session" && !/\/(?:stop|stop-owned|cancel|batchcancel)$/.test(endpoint) && !/^\/control\//.test(endpoint);
  }
  function currentWrite(promise, writing, generation) { return promise.then(function (value) { if (writing && generation !== _writeGeneration) { var error = new Error("本次操作已被立即停止取消"); error.cancelled = true; throw error; } return value; }); }
  function cancelGameWrites() { _writeGeneration++; _writeControllers.forEach(function (ctl) { ctl.abort(); }); _writeControllers.clear(); }
  var _tokenProvider = null;   // function() → 头对象（含 X-Choreo-Token 与否由主程序 capsOk 门槛决定）
  var _pairingHandler = null;  // function() → 403 配对提示（主页 handle403，15 秒节流在那一侧）

  function setTokenProvider(fn) { _tokenProvider = fn || null; }
  function setPairingHandler(fn) { _pairingHandler = fn || null; }

  // 只带可见 ASCII 的 token（normToken 已在主程序归一）；provider 只在调用方未显式给码时补齐——
  // Phase 1 会话写允许调用方显式带会话令牌（provider 仍给配对码），显式码优先，读路径不受影响
  function applyAuth(headers) {
    if (_tokenProvider) {
      var t = _tokenProvider();
      if (t && t['X-Choreo-Token'] !== undefined && headers['X-Choreo-Token'] === undefined) headers['X-Choreo-Token'] = t['X-Choreo-Token'];
    }
    return headers;
  }

  var SESSION_PATH = '/auth/session'; // Phase 1 会话签发（两端口同路径，POST-only，需配对码）
  // 会话能力判定纯函数：只认 capabilities.session.supported，寿命一律读 caps 不硬编码
  function sessionSupported(caps) { return !!(caps && caps.session && caps.session.supported === true); }
  // 会话签发：显式配对头换内存令牌（无游戏副作用）；调用方传配对码头，客户端自身零存储访问
  function mintSession(base, pairingHeaders, timeoutMs) {
    var h = {};
    if (pairingHeaders) { for (var k in pairingHeaders) { if (Object.prototype.hasOwnProperty.call(pairingHeaders, k)) h[k] = pairingHeaders[k]; } }
    var opts = { method: 'POST', headers: h };
    if (typeof timeoutMs === 'number') opts.timeoutMs = timeoutMs;
    else opts.timeoutMs = DEFAULT_TIMEOUT_MS;
    return rawFetch(base, SESSION_PATH, opts).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return null }).then(function (b) {
          var e = new Error(SESSION_PATH + ': ' + r.status);
          e.status = r.status;
          if (b) { e.detail = b.message || b.error || ''; }
          throw e;
        });
      }
      return r.json();
    });
  }

  // 裸请求：拼基址、按次超时（timeoutMs 缺省=不限时，录制等长阻塞请求靠它保持原行为）、
  // AbortController 取消；返回原始 Response，响应处理权完全留给调用方（保持各处既有语义）。
  // 调用方 signal 与按次超时复合成同一个有效信号：任一方触发都中止请求——初版
  // signal||ctl.signal 二选一，外部 signal 在场时超时掐不住请求（审查修复）
  function rawFetch(base, path, opts) {
    opts = opts || {};
    var writing = gameWrite(path, opts), generation = _writeGeneration;
    if (writing && _outputBlocked) return Promise.reject(new Error("请先重试停止，等待本机停止确认"));
    var ctl = new AbortController();
    if (writing) _writeControllers.add(ctl);
    var timer = null, onOuter = null;
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort();
      else {
        onOuter = function () { ctl.abort(); };
        opts.signal.addEventListener('abort', onOuter);
      }
    }
    if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
      timer = setTimeout(function () { ctl.abort(); }, opts.timeoutMs);
    }
    var init = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      signal: ctl.signal,
    };
    if (opts.body !== undefined) init.body = opts.body;
    var cleanup = function () {
      _writeControllers.delete(ctl);
      if (timer) { clearTimeout(timer); timer = null; }
      if (onOuter && opts.signal) opts.signal.removeEventListener('abort', onOuter);
    };
    return fetch(base + path, init).then(
      function (v) { cleanup(); if (writing && generation !== _writeGeneration) { var e = new Error('本次操作已被立即停止取消'); e.cancelled = true; throw e; } return v; },
      function (e) { cleanup(); throw e; }
    );
  }

  // 48794 客户端 —— 拆分前 choreo-app.js apiFetch 的原语义：
  // 统一带配对码头 → 4 秒超时 → 403 弹配对提示并抛错 → 非 2xx 读出中文 detail
  // （e.status=状态码、e.detail=响应体 message/error）→ 2xx 返回解析后的 JSON
  function gameApi(path, opts) {
    opts = opts || {};
    opts.headers = applyAuth(opts.headers || {});
    // 普通本地请求仍默认 4 秒；歌词等明确的慢出站调用可按次放宽，避免插件端尚在
    // 等待外网（10 秒上限）时，网页先在 4 秒处把一个本可成功的请求误判成失败。
    if (typeof opts.timeoutMs !== 'number') opts.timeoutMs = DEFAULT_TIMEOUT_MS;
    var generation = _writeGeneration;
    return currentWrite(rawFetch(GAME_BASE, path, opts).then(function (r) {
      if (r.status === 403) {
        if (_pairingHandler) _pairingHandler();
        throw new Error(path + ': 403 需要配对');
      }
      if (!r.ok) {
        return r.json().catch(function () { return null }).then(function (b) {
          var e = new Error(path + ': ' + r.status);
          e.status = r.status;
          if (b) { e.detail = b.message || b.error || '' }
          throw e;
        });
      }
      return r.json();
    }), gameWrite(path, opts), generation);
  }

  // 48794 /preview —— 拆分前 apiPreview 的原语义：POST JSON、403 弹配对提示、
  // 其余状态码不判 ok 直接回 JSON（调用方按 r.status 提示）
  function gamePreview(cmd) {
    var opts = {
      method: 'POST',
      headers: applyAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ command: cmd }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    var generation = _writeGeneration;
    return currentWrite(rawFetch(GAME_BASE, '/preview', opts).then(function (r) {
      if (r.status === 403) {
        if (_pairingHandler) _pairingHandler();
        throw new Error('403 需要配对');
      }
      return r.json();
    }), true, generation);
  }

  // 48795 客户端 —— 高层 api：统一配对码头（provider 注入，与拆分前 choreoTokenHeaders/
  // secHeaders 同源）→ JSON 解析 → 状态/错误映射。缺省不限时（录制 30s 长阻塞靠它保持
  // 原行为），timeoutMs 按次可配（探测 3000/4000 的照旧显式传）。
  // 403 只分类成 e.status=403 + e.pairing=true 的配对错误、不在客户端统一弹提示：
  // 连接探测（主页 15s、3D 面板 10s 轮询）没配对时必须静默降级成「未连接」，
  // 弹不弹提示由现场调用方决定（目前只有录制单条处弹，与拆分前一致）。
  // 非 2xx 抛 e.status、e.detail（body 的 message 优先于 error）和 e.body（原解析体——
  // 录制/审核调用方按插件「error」短码取词，与拆分前逐字一致）；坏体不炸、detail 不置。
  // 2xx 返回解析后的 JSON；坏体照抛 SyntaxError（与拆分前 r.json() 同）。
  function exportApi(path, opts) {
    opts = opts || {};
    opts.headers = applyAuth(opts.headers || {});
    var generation = _writeGeneration;
    return currentWrite(rawFetch(EXPORT_BASE, path, opts).then(function (r) {
      if (r.status === 403) {
        var pe = new Error(path + ': 403 需要配对');
        pe.status = 403;
        pe.pairing = true;
        throw pe;
      }
      if (!r.ok) {
        return r.json().catch(function () { return null }).then(function (b) {
          var e = new Error(path + ': ' + r.status);
          e.status = r.status;
          if (b) { e.detail = b.message || b.error || ''; e.body = b; }
          throw e;
        });
      }
      return r.json();
    }), gameWrite(path, opts), generation);
  }

  window.ChoreoAPI = {
    game: {
      base: GAME_BASE,
      api: gameApi,                       // 高层：apiFetch 原语义（配对/超时/错误映射齐全）
      preview: gamePreview,               // 高层：apiPreview 原语义
      raw: function (path, opts) { return rawFetch(GAME_BASE, path, opts); }, // 裸请求（能力探测保持匿名）
    },
    export: {
      base: EXPORT_BASE,
      api: exportApi,                     // 高层：配对码头 + JSON + 状态/错误映射（私有读写的默认出口）
      raw: function (path, opts) { return rawFetch(EXPORT_BASE, path, opts); },       // 裸请求：模型/二进制等原始 Response 场景
      rawUrl: function (url, opts) { return rawFetch('', url, opts); },               // 裸请求：整 URL（相对 ./ 也行）
    },
    session: {
      path: SESSION_PATH,                 // 会话签发路径（两端口同路径）
      supported: sessionSupported,        // 纯函数：caps.session.supported 才走会话写
      mint: mintSession,                  // 显式配对头换令牌（POST /auth/session，无游戏副作用）
    },
    cancelGameWrites: cancelGameWrites,
    setOutputBlocked: function (value) { _outputBlocked = !!value; },
    setTokenProvider: setTokenProvider,
    setPairingHandler: setPairingHandler,
  };
})();
