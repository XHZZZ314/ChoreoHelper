// 多人直连控制通道：手工交换邀请，仅 STUN/WebRTC DataChannel，不传媒体、素材或插件配对码。
(function (root) {
  'use strict';
  var VERSION = 1, LABEL = 'choreo-control-v1', PROTOCOL = 'choreo-ensemble-v1';
  var CODE_PREFIX = 'CHOREO-RTC1:', CODE_MAX = 131072, MESSAGE_MAX = 8192, SDP_MAX = 65536;
  var INVITE_TTL = 600000, ICE_TIMEOUT = 15000, CONNECT_TIMEOUT = 45000;
  var recentLinks = new Map();
  function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys, label) {
    if (!object(value) || Object.keys(value).length !== keys.length || !keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); }))
      fail('shape', label + '字段不完整或含未知内容');
  }
  function id(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value); }
  function actorId(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value); }
  function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
  function digest(value) { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value); }
  function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
  function clock(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  function bytes(text) { return new TextEncoder().encode(text); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) { if (object(value) || Array.isArray(value)) { Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value); } return value; }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function validateDescriptor(value) {
    exact(value, ['protocolVersion', 'sessionId', 'runId', 'hostPeerId', 'sourceDigest', 'participants'], '演出邀请');
    if (value.protocolVersion !== VERSION || !uuid(value.sessionId) || !uuid(value.runId) || !id(value.hostPeerId) || !digest(value.sourceDigest) || !Array.isArray(value.participants) || value.participants.length < 2 || value.participants.length > 8)
      fail('metadata', '演出邀请的身份或参与者清单无效');
    var peers = new Set(), actors = new Set();
    value.participants.forEach(function (participant) {
      exact(participant, ['peerId', 'actorId', 'digest'], '参与者');
      if (!id(participant.peerId) || !actorId(participant.actorId) || !digest(participant.digest) || peers.has(participant.peerId) || actors.has(participant.actorId))
        fail('metadata', '参与者或演员身份重复、缺失或无效');
      peers.add(participant.peerId); actors.add(participant.actorId);
    });
    if (!peers.has(value.hostPeerId)) fail('metadata', '发起者不在参与者清单中');
  }
  function validateMetadata(value) {
    exact(value, ['descriptor', 'senderPeerId', 'recipientPeerId'], '连接邀请');
    validateDescriptor(value.descriptor);
    var ids = value.descriptor.participants.map(function (participant) { return participant.peerId; });
    if (!id(value.senderPeerId) || !id(value.recipientPeerId) || value.senderPeerId === value.recipientPeerId || ids.indexOf(value.senderPeerId) < 0 || ids.indexOf(value.recipientPeerId) < 0)
      fail('metadata', '连接双方必须是邀请清单中的不同参与者');
    return value;
  }
  function validateIceServers(servers) {
    if (servers === undefined) servers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (!Array.isArray(servers) || servers.length > 4) fail('ice-server', '最多填写四个 STUN 服务');
    var total = 0;
    return servers.map(function (server) {
      exact(server, ['urls'], 'STUN 配置');
      var urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
      if (!Array.isArray(urls) || !urls.length || (total += urls.length) > 4) fail('ice-server', 'STUN 地址无效或数量过多');
      urls.forEach(function (url) {
        if (typeof url !== 'string' || url.length > 255) fail('ice-server', 'STUN 地址无效');
        var match = /^(stun|stuns):([a-z0-9.-]+|\[[0-9a-f:]+\])(?::([0-9]{1,5}))?$/i.exec(url);
        if (!match || match[3] && (+match[3] < 1 || +match[3] > 65535)) fail('ice-server', '只允许 stun: 或 stuns: 地址，不使用 TURN、中继或带凭据的服务');
      });
      return { urls: urls.slice() };
    });
  }
  function validateSdp(sdp, kind) {
    if (typeof sdp !== 'string' || !sdp || sdp.length > SDP_MAX || /[^\x20-\x7e\r\n]/.test(sdp)) fail('sdp', '连接说明无效或过大');
    var lines = sdp.split(/\r?\n/).filter(Boolean), media = 0, fingerprint = 0, setup = 0, ufrag = 0, pwd = 0, sctp = 0;
    if (lines.length > 512 || lines[0] !== 'v=0') fail('sdp', '连接说明格式无效');
    lines.forEach(function (line) {
      if (line.length > 2048 || line.indexOf('\r') >= 0) fail('sdp', '连接说明行格式无效');
      if (/^m=/.test(line)) {
        if (!/^m=application [1-9][0-9]* UDP\/DTLS\/SCTP webrtc-datachannel$/.test(line) || ++media !== 1) fail('media-forbidden', '邀请只能建立一个控制数据通道，不能包含音视频');
        return;
      }
      if (/^a=candidate:/.test(line)) {
        if (!/ typ (?:host|srflx|prflx)(?: |$)/.test(line) || / typ relay(?: |$)/.test(line)) fail('relay-forbidden', '邀请含中继候选地址，本次仅允许直连');
        return;
      }
      if (/^a=fingerprint:/.test(line)) {
        if (!/^a=fingerprint:sha-256 [0-9a-f]{2}(?::[0-9a-f]{2}){31}$/i.test(line) || ++fingerprint !== 1) fail('sdp', 'DTLS 指纹无效');
        return;
      }
      if (/^a=setup:/.test(line)) { if (!new RegExp('^a=setup:' + (kind === 'offer' ? 'actpass' : '(?:active|passive)') + '$').test(line) || ++setup !== 1) fail('sdp', 'DTLS 角色无效'); return; }
      if (/^a=ice-ufrag:/.test(line)) { if (!/^a=ice-ufrag:[A-Za-z0-9+/]{4,256}$/.test(line) || ++ufrag !== 1) fail('sdp', 'ICE 身份无效'); return; }
      if (/^a=ice-pwd:/.test(line)) { if (!/^a=ice-pwd:[A-Za-z0-9+/]{22,256}$/.test(line) || ++pwd !== 1) fail('sdp', 'ICE 身份无效'); return; }
      if (/^a=sctp-port:/.test(line)) { var port = +line.slice(12); if (!Number.isInteger(port) || port < 1 || port > 65535 || ++sctp !== 1) fail('sdp', 'SCTP 端口无效'); return; }
      if (!/^(?:v=0|o=.{1,256}|s=.{1,128}|t=0 0|c=IN IP[46] .{1,128}|a=group:BUNDLE [A-Za-z0-9_-]+|a=extmap-allow-mixed|a=msid-semantic: ?WMS|a=mid:[A-Za-z0-9_-]+|a=ice-options:(?:trickle|renomination)(?: (?:trickle|renomination))*|a=end-of-candidates|a=max-message-size:[0-9]+)$/.test(line))
        fail('sdp', '连接说明含不支持的媒体或扩展内容');
    });
    if (media !== 1 || fingerprint !== 1 || setup !== 1 || ufrag !== 1 || pwd !== 1 || sctp !== 1) fail('sdp', '连接说明缺少控制通道或安全握手信息');
    return sdp;
  }
  function validateEnvelope(value) {
    exact(value, ['protocolVersion', 'sessionId', 'runId', 'from', 'seq', 'type', 'payload'], '控制消息');
    if (value.protocolVersion !== VERSION || !uuid(value.sessionId) || !uuid(value.runId) || !id(value.from) || !Number.isSafeInteger(value.seq) || value.seq < 1) fail('message', '控制消息身份无效');
    var payload = value.payload;
    if (value.type === 'ready') { exact(payload, ['actorId', 'digest'], '准备状态'); if (!actorId(payload.actorId) || !digest(payload.digest)) fail('message', '演员准备状态无效'); }
    else if (value.type === 'not-ready') { exact(payload, ['reason'], '取消准备'); reason(payload.reason); }
    else if (value.type === 'start-proposal') { exact(payload, ['startId', 'sessionStartMs'], '开演提议'); if (!uuid(payload.startId) || !integer(payload.sessionStartMs)) fail('message', '开演提议无效'); }
    else if (value.type === 'status') { exact(payload, ['state', 'reason'], '演出状态'); if (['playing', 'stopped', 'faulted', 'completed'].indexOf(payload.state) < 0) fail('message', '演出状态无效'); reason(payload.reason); }
    else if (value.type === 'clock-ping') { exact(payload, ['sampleId', 't0'], '计时请求'); if (!uuid(payload.sampleId) || !clock(payload.t0)) fail('message', '计时请求无效'); }
    else if (value.type === 'clock-pong') { exact(payload, ['sampleId', 't0', 't1', 't2'], '计时回复'); if (!uuid(payload.sampleId) || ![payload.t0, payload.t1, payload.t2].every(clock) || payload.t2 < payload.t1) fail('message', '计时回复无效'); }
    else fail('message-type', '不支持的控制消息类型');
    return value;
  }
  function reason(value) { if (typeof value !== 'string' || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) fail('message', '状态说明无效'); }
  function encodeCode(value) {
    var raw = bytes(JSON.stringify(value)), binary = '';
    raw.forEach(function (byte) { binary += String.fromCharCode(byte); });
    var code = CODE_PREFIX + root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (code.length > CODE_MAX) fail('code-size', '邀请代码过大');
    return code;
  }
  function readCode(code) {
    if (typeof code !== 'string' || code.length > CODE_MAX || !code.trim().startsWith(CODE_PREFIX)) fail('code', '邀请代码格式错误或过大');
    var encoded = code.trim().slice(CODE_PREFIX.length), value;
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail('code', '邀请代码含无效字符');
    try {
      var binary = root.atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      var raw = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch (error) { fail('code', '邀请代码不完整或无法读取'); }
    exact(value, ['protocolVersion', 'kind', 'linkId', 'createdAt', 'expiresAt', 'metadata', 'sdp'], '邀请代码');
    if (value.protocolVersion !== VERSION || ['offer', 'answer'].indexOf(value.kind) < 0 || !uuid(value.linkId) || !integer(value.createdAt) || !integer(value.expiresAt) || value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > INVITE_TTL)
      fail('code', '邀请代码的版本、身份或有效期无效');
    if (Date.now() >= value.expiresAt || value.createdAt > Date.now() + 120000) fail('expired', '邀请已过期或双方系统时间差异过大，请重新建立连接');
    validateMetadata(value.metadata); validateSdp(value.sdp, value.kind);
    return value;
  }
  function parseCode(code) { var value = readCode(code); delete value.sdp; return freeze(value); }
  function freshId() { if (!root.crypto || typeof root.crypto.randomUUID !== 'function') fail('crypto-unavailable', '浏览器无法生成连接身份，请使用新版浏览器'); return root.crypto.randomUUID(); }
  function create(options) {
    options = options || {};
    var servers = validateIceServers(options.iceServers);
    if (typeof root.RTCPeerConnection !== 'function') fail('webrtc-unavailable', '当前浏览器不支持 WebRTC 直连');
    var pc = null, channel = null, metadata = null, linkId = null, invitation = null, phase = 'new', closed = false, timer = null, gatherCancel = null, opened = false;
    function snapshot() { return freeze({ state: phase, linkId: linkId, localPeerId: metadata && metadata.senderPeerId, remotePeerId: metadata && metadata.recipientPeerId }); }
    function notify(state, reasonText) { phase = state; if (typeof options.onState === 'function') { try { options.onState(Object.assign({}, snapshot(), { reason: reasonText || '' })); } catch (error) {} } }
    function shutdown(reasonText, failed) {
      if (closed) return;
      closed = true; clearTimeout(timer);
      if (gatherCancel) gatherCancel();
      try { if (channel) channel.close(); } catch (error) {}
      try { if (pc) pc.close(); } catch (error) {}
      notify(failed ? 'failed' : 'closed', reasonText || '连接已关闭，需要重新建立连接并准备');
    }
    function active() { if (closed) fail('closed', '连接已经关闭，请重新建立连接'); }
    function bound(envelope, outgoing) {
      if (!metadata || envelope.sessionId !== metadata.descriptor.sessionId || envelope.runId !== metadata.descriptor.runId || envelope.from !== (outgoing ? metadata.senderPeerId : metadata.recipientPeerId))
        fail('message-identity', '消息不属于已确认的连接、演出或参与者');
    }
    function attach(value) {
      if (closed || channel || value.label !== LABEL || value.protocol !== PROTOCOL || value.ordered !== true || value.maxRetransmits !== null || value.maxPacketLifeTime !== null) {
        try { value.close(); } catch (error) {}
        shutdown('收到额外或不符合约定的数据通道', true); return;
      }
      channel = value;
      channel.onopen = function () { if (closed) return; opened = true; clearTimeout(timer); notify('connected'); };
      channel.onclose = function () { shutdown('对方已断开，演出连接需要重新准备', false); };
      channel.onerror = function () { shutdown('控制通道发生错误，连接已关闭', true); };
      channel.onmessage = function (event) {
        if (closed || !opened) return;
        try {
          if (typeof event.data !== 'string') fail('binary-message', '控制通道不接受文件或二进制内容');
          if (event.data.length > MESSAGE_MAX || bytes(event.data).length > MESSAGE_MAX) fail('message-size', '控制消息超过大小限制');
          var envelope = validateEnvelope(JSON.parse(event.data)); bound(envelope, false);
          if (typeof options.onMessage === 'function') options.onMessage(freeze(envelope), metadata.recipientPeerId);
        } catch (error) { shutdown(error.message || '控制消息无效', true); }
      };
    }
    function begin() {
      active();
      if (pc || phase !== 'new') fail('state', '本连接已经使用，请重新建立连接');
      pc = new root.RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
      pc.ondatachannel = function (event) { attach(event.channel); };
      function stateChanged() { if (closed) return; if (['failed', 'disconnected', 'closed'].indexOf(pc.connectionState) >= 0 || ['failed', 'disconnected', 'closed'].indexOf(pc.iceConnectionState) >= 0) shutdown('直连中断；不会自动重连或继续演出', true); }
      pc.onconnectionstatechange = stateChanged; pc.oniceconnectionstatechange = stateChanged;
      notify('gathering');
    }
    function gather() {
      active();
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var timeout;
        function finish(error) { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', changed); gatherCancel = null; error ? reject(error) : resolve(); }
        function changed() { if (pc.iceGatheringState === 'complete') finish(); }
        gatherCancel = function () { var error = new Error('连接已关闭'); error.code = 'closed'; finish(error); };
        pc.addEventListener('icegatheringstatechange', changed);
        timeout = setTimeout(function () { var error = new Error('收集直连地址超时，请检查 STUN 服务后重新建立连接'); error.code = 'ice-timeout'; finish(error); }, ICE_TIMEOUT);
        changed();
      });
    }
    function connectionDeadline() { clearTimeout(timer); timer = setTimeout(function () { shutdown('未能建立直连；部分网络需要中继，本试验不使用中继', true); }, CONNECT_TIMEOUT); }
    async function offer(value) {
      active(); if (phase !== 'new') fail('state', '此连接已生成过邀请');
      metadata = clone(validateMetadata(value)); linkId = freshId();
      var now = Date.now(); invitation = { protocolVersion: VERSION, kind: 'offer', linkId: linkId, createdAt: now, expiresAt: now + INVITE_TTL, metadata: metadata, sdp: '' };
      try {
        begin(); attach(pc.createDataChannel(LABEL, { ordered: true, protocol: PROTOCOL }));
        var description = await pc.createOffer(); active(); await pc.setLocalDescription(description); active(); await gather(); active();
        if (Date.now() >= invitation.expiresAt) fail('expired', '邀请已过期，请重新建立连接');
        invitation.sdp = validateSdp(pc.localDescription.sdp, 'offer'); notify('awaiting-answer');
        timer = setTimeout(function () { shutdown('邀请已过期，请重新建立连接', true); }, Math.max(0, invitation.expiresAt - Date.now()));
        return encodeCode(invitation);
      } catch (error) { shutdown(error.message, true); throw error; }
    }
    async function answer(code, options) {
      active(); if (phase !== 'new') fail('state', '此连接已使用过邀请');
      var incoming = readCode(code);
      if (incoming.kind !== 'offer') fail('code-kind', '需要对方发来的邀请代码');
      if (options !== undefined) { exact(options, ['localDigest'], '本地演员选择'); if (!digest(options.localDigest)) fail('metadata', '本地演员内容指纹无效'); }
      recentLinks.forEach(function (expiry, key) { if (expiry < Date.now()) recentLinks.delete(key); });
      if (recentLinks.has(incoming.linkId)) fail('stale-link', '这个邀请已经使用过，请让对方生成新的邀请');
      if (recentLinks.size >= 256) fail('link-limit', '短时间内建立的连接过多，请稍后重试');
      recentLinks.set(incoming.linkId, incoming.expiresAt);
      linkId = incoming.linkId;
      metadata = { descriptor: clone(incoming.metadata.descriptor), senderPeerId: incoming.metadata.recipientPeerId, recipientPeerId: incoming.metadata.senderPeerId };
      if (options) metadata.descriptor.participants.find(function (participant) { return participant.peerId === metadata.senderPeerId; }).digest = options.localDigest;
      invitation = incoming;
      try {
        begin(); await pc.setRemoteDescription({ type: 'offer', sdp: incoming.sdp }); active();
        var description = await pc.createAnswer(); active(); await pc.setLocalDescription(description); active(); await gather(); active();
        if (Date.now() >= incoming.expiresAt) fail('expired', '生成回复时邀请已过期，请让对方重新建立连接');
        var outgoing = { protocolVersion: VERSION, kind: 'answer', linkId: linkId, createdAt: incoming.createdAt, expiresAt: incoming.expiresAt, metadata: metadata, sdp: validateSdp(pc.localDescription.sdp, 'answer') };
        notify('connecting'); connectionDeadline(); return encodeCode(outgoing);
      } catch (error) { shutdown(error.message, true); throw error; }
    }
    async function acceptAnswer(code) {
      active(); if (phase !== 'awaiting-answer') fail('duplicate-answer', '没有等待回复的邀请，或回复已经使用过');
      var incoming = readCode(code);
      // 回复者仅能确定自己演员的内容指纹；其余身份、映射和双方之外的选择必须逐字保持。
      var expected = clone(metadata.descriptor), remote = expected.participants.find(function (participant) { return participant.peerId === metadata.recipientPeerId; });
      var answered = incoming.metadata.descriptor.participants.find(function (participant) { return participant.peerId === metadata.recipientPeerId; });
      if (answered) remote.digest = answered.digest;
      if (incoming.kind !== 'answer' || incoming.linkId !== linkId || incoming.createdAt !== invitation.createdAt || incoming.expiresAt !== invitation.expiresAt || canonical(incoming.metadata.descriptor) !== canonical(expected) || incoming.metadata.senderPeerId !== metadata.recipientPeerId || incoming.metadata.recipientPeerId !== metadata.senderPeerId)
        fail('stale-link', '回复不属于本次已确认的连接邀请');
      metadata.descriptor = clone(incoming.metadata.descriptor);
      notify('connecting'); clearTimeout(timer); connectionDeadline();
      try { await pc.setRemoteDescription({ type: 'answer', sdp: incoming.sdp }); active(); }
      catch (error) { shutdown(error.message, true); throw error; }
    }
    function send(envelope) {
      active();
      if (!channel || channel.readyState !== 'open' || !opened) fail('not-connected', '直连通道尚未连接');
      var text;
      try { text = JSON.stringify(envelope); } catch (error) { fail('message', '控制消息无法序列化'); }
      if (typeof text !== 'string' || text.length > MESSAGE_MAX || bytes(text).length > MESSAGE_MAX) fail('message-size', '控制消息超过大小限制');
      var value = validateEnvelope(JSON.parse(text)); bound(value, true);
      if (channel.bufferedAmount + bytes(text).length > 65536) { shutdown('控制消息积压，已停止连接以免迟到指令被执行', true); fail('backpressure', '控制通道繁忙，请重新连接'); }
      try { channel.send(text); } catch (error) { shutdown('控制消息发送失败', true); throw error; }
    }
    return Object.freeze({ offer: offer, answer: answer, acceptAnswer: acceptAnswer, send: send, close: function () { shutdown('', false); }, getState: snapshot });
  }
  var api = { create: create, parseCode: parseCode, validateIceServers: validateIceServers, validateEnvelope: validateEnvelope, MAX_MESSAGE_BYTES: MESSAGE_MAX };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ChoreoEnsembleTransport = api;
})(typeof window === 'object' ? window : globalThis);
