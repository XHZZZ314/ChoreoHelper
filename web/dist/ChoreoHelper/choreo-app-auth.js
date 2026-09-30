// 编舞助手配对与会话凭据薄壳（OVERHAUL 批 C 从 choreo-app.js 拆出）：
// v0.6.7 配对码（localStorage 一个浏览器只粘一次）＋Phase 1 会话令牌（sessionStorage 关页即忘）＋
// apiFetch/apiPreview 薄壳与 403 配对提示节流；HTTP 出口仍归 choreo-api.js（ARCH-2）。
// 同全局名文件级搬家，行为逐字不变；须在 choreo-app.js 之前加载——文件尾立即向 ChoreoAPI 注入
// tokenProvider/pairingHandler，只依赖先加载的 choreo-api.js。
'use strict';
// v0.6.7 配对帮手：新版插件（capsOk）的写请求统一带 X-Choreo-Token；配对码存 localStorage 一个浏览器只粘一次
// normToken：全角→半角、去空白、转大写——主人实测中文输入法全角状态粘码会校验必挂，
// 且非 ASCII 值进 HTTP 头会让 fetch 直接抛 TypeError（请求根本发不出去），所以存之前就归一
function normToken(t){
  return String(t||'').replace(/\u3000/g,' ')
    .replace(/[\uFF01-\uFF5E]/g,function(ch){return String.fromCharCode(ch.charCodeAt(0)-0xFEE0)})
    .replace(/\s+/g,'').toUpperCase();
}
function choreoTokenHeaders(extra){
  var h=extra||{};
  // 只带可见 ASCII 的 token（双保险：normalize 后仍异常的值不发，避免 fetch 抛错）
  if(store.capsOk&&store.pairToken&&/^[\x21-\x7E]+$/.test(store.pairToken))h['X-Choreo-Token']=store.pairToken;
  return h;
}
function savePairToken(t){
  store.pairToken=normToken(t);
  try{
    if(store.pairToken)localStorage.setItem('choreo_pairToken',store.pairToken);
    else localStorage.removeItem('choreo_pairToken');
  }catch(e){}
  // Phase 1：配对码一换全部会话失效（绑定签发码），换码即清本页会话令牌，下次写自动重签
  clearStoredSession();
  // SEC-1：/export/list 是私有读——没配对时导出连接指示如实显示未连接；
  // 主人粘贴/更换配对码后立即重探一次，指示不用等 15 秒的连接监视器
  if(store.appReady)probeExport();
}
// Phase 1 会话令牌：只存 sessionStorage key choreo_sessionToken（关页即忘），
// 永不进 localStorage/URL/响应体/toast/诊断；配对码存储不变（localStorage choreo_pairToken）。
// OVERHAUL 批 C 接线：会话令牌种子的两行（store.sessionToken=…/store._sessionMintAt=0）留在
// choreo-app.js 的 store 字面量之后执行——本文件先于 store 定义加载，此处不能碰 store。
var SESSION_KEY='choreo_sessionToken';
function getStoredSession(){return store.sessionToken||''}
function setStoredSession(tok){
  store.sessionToken=tok||'';
  if(tok)store._sessionMintAt=Date.now();else store._sessionMintAt=0;
  try{
    if(tok)sessionStorage.setItem(SESSION_KEY,tok);
    else sessionStorage.removeItem(SESSION_KEY);
  }catch(e){}
}
function clearStoredSession(){setStoredSession('')}
// 会话能力只认 capabilities.session.supported；寿命一律读 caps 不硬编码
function sessionAdvertised(){
  return !!(store.pluginCaps&&store.pluginCaps.session&&store.pluginCaps.session.supported===true);
}
function sessionLifetimes(){
  var s=(store.pluginCaps&&store.pluginCaps.session)||{};
  return {absoluteMinutes:(+s.absoluteMinutes||0),idleMinutes:(+s.idleMinutes||0)};
}
// 会话签发：显式配对头换内存令牌（POST /auth/session，无游戏副作用）；失败抛错由调用方按 403 链处理
function mintSessionToken(){
  var pairing=choreoTokenHeaders();
  return ChoreoAPI.session.mint(ChoreoAPI.game.base,pairing,4000).then(function(j){
    var tok=(j&&(j.token||j.sessionToken))||'';
    if(!tok||tok.length<32)throw new Error('bad session token');
    setStoredSession(tok);
    return tok;
  });
}
function sessionNeedsRefresh(){
  if(!store.sessionToken||!store._sessionMintAt)return false;
  var lt=sessionLifetimes();
  var idleMs=(lt.idleMinutes>0?lt.idleMinutes*60*1000:30*60*1000);
  var absMs=(lt.absoluteMinutes>0?lt.absoluteMinutes*60*1000:720*60*1000);
  var age=Date.now()-store._sessionMintAt;
  // 空闲/绝对到期前 60s 静默重签（同页内；跨重载无 mint 时刻则走 403 后的一次重试）
  return age>Math.min(idleMs,absMs)-60000;
}
// 403 = 插件说"要配对"：指路 toast（15 秒节流，别让循环调用刷屏）
function handle403(){
  if(store._pairToastAt&&Date.now()-store._pairToastAt<15000)return;
  store._pairToastAt=Date.now();
  showToast('需要配对：游戏里输入 /choreo pair 查看配对码，到顶栏「🧰 工具」→「高级工具」的「🔗 网页配对」粘贴一次');
}
// ARCH-2：apiFetch/apiPreview 语义整体搬进 choreo-api.js（game 客户端）——统一配对码头、
// 4 秒超时、403 配对提示、非 2xx 中文 detail（e.status/e.detail）与 2xx JSON 解析都在那一侧；
// 这里保留全局薄壳，全部既有调用方（含 clip-check 在 apiFetch 层的拦截桩）不用改
// Phase 1：POST 写在会话广播时优先会话令牌（显式头覆盖 provider 配对码），读（GET/HEAD）
// 永远走配对码；403 走一次签发重试 + 一次能力重探后 toast 停，不循环、不降级为匿名。
function apiFetch(path,opts){
  opts=opts||{};
  var method=(opts.method||'GET').toUpperCase();
  if(method!=='POST'||!sessionAdvertised()||!store.pairToken)return ChoreoAPI.game.api(path,opts);
  return sessionWrite(path,opts,false);
}
function sessionWrite(path,opts,retried){
  var stopEpoch=_controlStopEpoch;
  var stopRequest=/[/](?:stop|stop-owned|cancel|batchcancel)$/.test(path)||path.indexOf('/control/')===0;
  function assertCurrent(){
    if(!stopRequest&&stopEpoch!==_controlStopEpoch){var e=new Error('此请求已被立即停止取消');e.cancelled=true;throw e;}
  }
  var headers={};
  if(opts.headers){for(var k in opts.headers){if(Object.prototype.hasOwnProperty.call(opts.headers,k))headers[k]=opts.headers[k];}}
  function sendWith(tok){
    assertCurrent();
    var h2={};
    for(var k2 in headers){if(Object.prototype.hasOwnProperty.call(headers,k2))h2[k2]=headers[k2];}
    if(tok)h2['X-Choreo-Token']=tok;
    var o2={method:'POST',headers:h2,body:opts.body,timeoutMs:opts.timeoutMs,signal:opts.signal};
    return ChoreoAPI.game.api(path,o2);
  }
  function freshMint(){assertCurrent();clearStoredSession();return mintSessionToken();}
  var ready;
  if(getStoredSession()&&!sessionNeedsRefresh())ready=Promise.resolve(getStoredSession());
  else ready=mintSessionToken().catch(function(){return '';});
  return ready.then(function(tok){
    assertCurrent();
    if(!tok)return ChoreoAPI.game.api(path,opts);
    return sendWith(tok).catch(function(e){
      if(!e||e.status!==403||retried)return Promise.reject(e);
      return freshMint().then(function(ntok){
        if(!ntok)throw e;
        return sendWith(ntok);
      }).catch(function(e2){
        if(!e2||e2.status!==403)throw e2;
        return probeCaps().then(function(){throw e2;},function(){throw e2;});
      });
    });
  });
}
function apiPreview(cmd){if(/^\s*\/(?:gs|gearset|job)(?:\s|$)/i.test(cmd)){showToast(ChoreoGearset.PREVIEW_NOTICE);return Promise.resolve({status:'blocked'})}return ChoreoAPI.game.preview(cmd)}
// 配对码与 403 提示仍归主页状态（store/localStorage/toast），经注入进入客户端——
// 客户端自身零 DOM/localStorage 访问
ChoreoAPI.setTokenProvider(function(){return choreoTokenHeaders()});
ChoreoAPI.setPairingHandler(handle403);
