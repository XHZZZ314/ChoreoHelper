/* choreo-ensemble-session.js —— 多人演出的本机授权状态机；消息只提供提议，游戏操作由调用方消费 effect。 */
(function () {
  'use strict';
  var MAX_MESSAGE_BYTES = 8192, MAX_PARTICIPANTS = 8;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HASH = /^sha256:[a-f0-9]{64}$/;
  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function exact(o, keys) { return obj(o) && Object.keys(o).length === keys.length && keys.every(function (k) { return own(o, k); }); }
  function id(v) { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v); }
  function actor(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v); }
  function digest(v) { return typeof v === 'string' && HASH.test(v); }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
  function integer(v) { return Number.isSafeInteger(v) && v >= 0; }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function fail(code, error) { return { ok: false, code: code, error: error, effects: [], outbound: [] }; }
  function ok(effects, outbound) { return { ok: true, effects: effects || [], outbound: outbound || [] }; }
  function reason(v) { return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256) : ''; }
  function validReason(v) { return typeof v === 'string' && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v); }
  function invitationValid(i, localPeerId) {
    if (!exact(i, ['protocolVersion', 'sessionId', 'runId', 'hostPeerId', 'sourceDigest', 'participants']) || i.protocolVersion !== 1 ||
        !UUID.test(i.sessionId) || !UUID.test(i.runId) || !id(i.hostPeerId) || !digest(i.sourceDigest) ||
        !Array.isArray(i.participants) || i.participants.length < 2 || i.participants.length > MAX_PARTICIPANTS) return false;
    var peers = Object.create(null), actors = Object.create(null);
    for (var n = 0; n < i.participants.length; n++) {
      var p = i.participants[n];
      if (!exact(p, ['peerId', 'actorId', 'digest']) || !id(p.peerId) || !actor(p.actorId) || !digest(p.digest) || peers[p.peerId] || actors[p.actorId]) return false;
      peers[p.peerId] = true; actors[p.actorId] = true;
    }
    return !!peers[localPeerId] && !!peers[i.hostPeerId];
  }
  function validPayload(m) {
    var p = m.payload;
    if (m.type === 'ready') return exact(p, ['actorId', 'digest']) && actor(p.actorId) && digest(p.digest);
    if (m.type === 'not-ready') return exact(p, ['reason']) && validReason(p.reason);
    if (m.type === 'start-proposal') return exact(p, ['startId', 'sessionStartMs']) && UUID.test(p.startId) && integer(p.sessionStartMs);
    if (m.type === 'status') return exact(p, ['state', 'reason']) && ['playing', 'stopped', 'faulted', 'completed'].indexOf(p.state) >= 0 && validReason(p.reason);
    return false;
  }
  function create(options) {
    var localId = options && options.localPeerId;
    if (!id(localId)) throw new Error('本机参与者 ID 无效。');
    var run = null, local = null, peers = Object.create(null), usedRuns = Object.create(null), seenStarts = Object.create(null);
    var phase = 'unjoined', connected = false, generation = 0, sequence = 0, prepared = null, proposal = null, notice = '', pendingStopTarget = null;
    function inFlight() { return ['scheduling', 'countdown', 'playing'].indexOf(phase) >= 0; }
    function effect(type, extra) { return Object.assign({ type: type, sessionId: run.sessionId, runId: run.runId, generation: generation }, extra || {}); }
    function message(type, payload) {
      return { protocolVersion: 1, sessionId: run.sessionId, runId: run.runId, from: localId, seq: ++sequence, type: type, payload: payload };
    }
    function allReady() { return !!run && connected && phase === 'ready' && Object.keys(peers).every(function (k) { return peers[k].ready; }); }
    function abort(reasonText, finalPhase) {
      if (!run || ['stopping', 'stopped', 'faulted', 'completed', 'unjoined'].indexOf(phase) >= 0) return ok();
      var needsStop = phase === 'prepared' || phase === 'ready' || inFlight(), target = finalPhase || 'loaded';
      generation++; proposal = null; pendingStopTarget = needsStop ? target : null; phase = needsStop ? 'stopping' : target; notice = reason(reasonText);
      var effects = needsStop ? [effect('stop-local', { reason: notice })] : [];
      // 停止请求在途时只广播取消就绪；实际 stopped/faulted 状态必须等本机插件确认。
      var outbound = connected ? [needsStop || target === 'loaded' ? message('not-ready', { reason: notice }) :
        message('status', { state: target === 'faulted' ? 'faulted' : 'stopped', reason: notice })] : [];
      return ok(effects, outbound);
    }
    function join(invitation) {
      if (inFlight() || ['ready', 'prepared', 'stopping'].indexOf(phase) >= 0) return fail('active', '请先在本机停止当前演出，并等待插件确认，再接受新邀请。');
      var i;
      try { i = copy(invitation); } catch (e) { return fail('invitation', '邀请格式无效。'); }
      if (!invitationValid(i, localId)) return fail('invitation', '邀请身份、演员分配或演出版本不完整。');
      if (usedRuns[i.sessionId + '/' + i.runId]) return fail('old-run', '这次演出已使用过，请重新准备一次新的演出。');
      usedRuns[i.sessionId + '/' + i.runId] = true;
      run = i; local = i.participants.find(function (p) { return p.peerId === localId; });
      peers = Object.create(null); i.participants.forEach(function (p) { if (p.peerId !== localId) peers[p.peerId] = { actorId: p.actorId, digest: p.digest, ready: false, status: 'joined', lastSeq: 0 }; });
      generation++; sequence = 0; prepared = null; proposal = null; pendingStopTarget = null; seenStarts = Object.create(null); connected = false; phase = 'joined'; notice = '';
      return ok();
    }
    function setConnected(value) {
      if (typeof value !== 'boolean' || !run) return fail('connection', '尚未接受演出邀请。');
      if (connected === value) return ok();
      connected = value;
      if (value) { notice = phase === 'stopped' ? '连接已恢复；请重新准备新的演出，不会自动继续。' : ''; return ok(); }
      Object.keys(peers).forEach(function (k) { peers[k].ready = false; peers[k].status = 'disconnected'; });
      if (phase === 'playing') { notice = '联机连接已断开，本机演出继续；不会自动重连开演。'; return ok(); }
      return abort('连接已断开，取消本次尚未开始的演出。', 'stopped');
    }
    async function prepare(envelope) {
      if (!run || ['joined', 'preparing', 'loaded'].indexOf(phase) < 0) return fail('state', '请先接受邀请，且等待上一项插件操作完成后再准备内容。');
      var root = typeof window !== 'undefined' ? window : globalThis, packages = root.ChoreoEnsemblePackage;
      if (!packages || typeof packages.verify !== 'function') return fail('package-module', '多人演出校验模块不可用。');
      generation++; var captured = generation; phase = 'preparing'; prepared = null; proposal = null;
      var checked = await packages.verify(envelope, { actorId: local.actorId, digest: local.digest, sourceDigest: run.sourceDigest });
      if (generation !== captured) return fail('stale', '准备期间演出或连接已改变，本次结果已丢弃。');
      if (!checked.ok) { phase = 'joined'; return fail(checked.code, checked.error); }
      prepared = checked; phase = 'prepared';
      return ok([effect('load-local', { digest: prepared.digest, package: prepared.package })]);
    }
    function confirmLoaded(value, expectedGeneration) {
      if (phase !== 'prepared' || !prepared || value !== prepared.digest || generation !== expectedGeneration) return fail('load', '插件装载结果与当前已校验的演出不一致。');
      phase = 'loaded'; return ok();
    }
    function ready(confirmation) {
      if (!connected || phase !== 'loaded' || !prepared || !exact(confirmation, ['digest', 'armed', 'generation']) || confirmation.digest !== prepared.digest || confirmation.armed !== true || confirmation.generation !== generation)
        return fail('not-armed', '请先连接同伴，并由本机插件确认这份演出已装载、已就绪。');
      phase = 'ready'; notice = '';
      return ok([], [message('ready', { actorId: local.actorId, digest: prepared.digest })]);
    }
    function unready(text) {
      if (phase === 'playing') return fail('playing', '演出已经开始；要退出请在本机停止。');
      if (phase !== 'ready' && phase !== 'scheduling' && phase !== 'countdown') return ok();
      return abort(text || '本人取消就绪。', 'loaded');
    }
    function proposeStart(p) {
      if (!run || localId !== run.hostPeerId || !allReady()) return fail('not-all-ready', '只有大家都明确就绪后，发起者才可以提出开演时间。');
      if (proposal) return fail('proposal-pending', '已有开演提议，请先取消就绪后再提出新的时间。');
      if (!validPayload({ type: 'start-proposal', payload: p }) || seenStarts[p.startId]) return fail('proposal', '开演提议无效或已使用。');
      proposal = copy(p); seenStarts[p.startId] = true;
      return ok([], [message('start-proposal', copy(p))]);
    }
    function receive(peerId, raw) {
      if (!run || !connected || !own(peers, peerId)) return fail('peer', '消息不属于本机已确认的联机成员。');
      if (peers[peerId].status === 'disconnected') return fail('peer-disconnected', '该成员已断开，本场不自动重新加入。');
      var m;
      try {
        var text = JSON.stringify(raw);
        if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) return fail('message-size', '联机消息超过上限。');
        m = JSON.parse(text);
      } catch (e) { return fail('message', '联机消息无法读取。'); }
      if (!exact(m, ['protocolVersion', 'sessionId', 'runId', 'from', 'seq', 'type', 'payload']) || m.protocolVersion !== 1 ||
          m.sessionId !== run.sessionId || m.runId !== run.runId || m.from !== peerId || !Number.isSafeInteger(m.seq) || m.seq < 1 || !validPayload(m))
        return fail('message', '联机消息身份、版本、演出轮次或内容不匹配。');
      var peer = peers[peerId];
      if (m.seq <= peer.lastSeq) return fail('replay', '旧的或重复的联机消息已忽略。');
      if (m.type === 'ready' && (m.payload.actorId !== peer.actorId || m.payload.digest !== peer.digest)) return fail('peer-package', '同伴就绪的演员或演出内容与邀请不一致。');
      if (m.type === 'start-proposal' && (peerId !== run.hostPeerId || phase !== 'ready' || !prepared || proposal || seenStarts[m.payload.startId]))
        return fail('not-ready', '本机尚未就绪、提议来源不正确，或这次开演提议已使用。');
      peer.lastSeq = m.seq;
      if (m.type === 'ready') { peer.ready = true; peer.status = 'ready'; return ok(); }
      if (m.type === 'start-proposal') {
        proposal = copy(m.payload); seenStarts[proposal.startId] = true;
        return ok([effect('start-proposed', { proposal: copy(proposal) })]);
      }
      if (m.type === 'not-ready') { peer.ready = false; peer.status = 'not-ready'; }
      else { peer.ready = false; peer.status = m.payload.state; }
      notice = peerId + '：' + (m.payload.reason || peer.status);
      // 开演后其他玩家停止/掉线只提醒；每台已经开始的演出各自继续。
      if ((phase === 'scheduling' || phase === 'countdown') && (m.type === 'not-ready' || m.payload.state !== 'playing'))
        return abort('同伴尚未开演便取消就绪或停止，已取消本机倒计时。', 'loaded');
      return ok();
    }
    function acceptStart(startId, clock) {
      if (!connected || phase !== 'ready' || !proposal || proposal.startId !== startId || !prepared) return fail('not-ready', '本机没有可接受的开演提议，或本人已取消就绪。');
      if (!exact(clock, ['nowMonoMs', 'localDeadlineMs', 'uncertaintyMs', 'maxUncertaintyMs', 'minLeadMs']) || !finite(clock.nowMonoMs) || !integer(clock.localDeadlineMs) ||
          !finite(clock.uncertaintyMs) || !finite(clock.maxUncertaintyMs) || !finite(clock.minLeadMs) || clock.minLeadMs <= 0 ||
          clock.uncertaintyMs > clock.maxUncertaintyMs || clock.localDeadlineMs - clock.nowMonoMs < clock.minLeadMs)
        return fail('clock', '开演时间已太近或时钟误差过大，本机未预约开演。');
      phase = 'scheduling';
      return ok([effect('schedule-local', { startId: startId, digest: prepared.digest, localDeadlineMs: clock.localDeadlineMs })]);
    }
    function confirmScheduled(startId, expectedGeneration) {
      if (phase !== 'scheduling' || !proposal || proposal.startId !== startId || generation !== expectedGeneration) return fail('stale', '插件预约结果已过期，本机不会确认开演。');
      phase = 'countdown'; return ok();
    }
    function markStarted(startId, expectedGeneration) {
      if (phase !== 'countdown' || !proposal || proposal.startId !== startId || generation !== expectedGeneration) return fail('state', '本机尚未确认这次预约开演。');
      phase = 'playing'; return ok([], connected ? [message('status', { state: 'playing', reason: '' })] : []);
    }
    function peerDisconnected(peerId) {
      if (!own(peers, peerId)) return fail('peer', '未知的联机成员。');
      peers[peerId].ready = false; peers[peerId].status = 'disconnected'; notice = peerId + ' 已断开连接。';
      if (phase === 'scheduling' || phase === 'countdown') return abort('同伴在开演前断开，已取消本机倒计时。', 'loaded');
      return ok();
    }
    function stopLocal(text) { return abort(text || '本人停止演出。', 'stopped'); }
    function faultLocal(text) { return abort(text || '本机执行器已停止。', 'faulted'); }
    function confirmStopped(expectedGeneration) {
      if (phase !== 'stopping' || generation !== expectedGeneration) return fail('stale', '本机停止确认已过期。');
      phase = pendingStopTarget || 'stopped'; pendingStopTarget = null;
      return ok([], connected && phase !== 'loaded' ? [message('status', { state: phase === 'faulted' ? 'faulted' : 'stopped', reason: notice })] : []);
    }
    function completeLocal() {
      if (phase !== 'playing') return fail('state', '本机尚未开始这次演出。');
      generation++; phase = 'completed'; proposal = null;
      return ok([], connected ? [message('status', { state: 'completed', reason: '' })] : []);
    }
    function isCurrent(e) {
      if (!obj(e) || !run || e.sessionId !== run.sessionId || e.runId !== run.runId || e.generation !== generation) return false;
      if (e.type === 'load-local') return phase === 'prepared' && prepared && e.digest === prepared.digest;
      if (e.type === 'schedule-local') return phase === 'scheduling' && proposal && e.startId === proposal.startId;
      if (e.type === 'start-proposed') return phase === 'ready' && proposal && e.proposal && e.proposal.startId === proposal.startId;
      return e.type === 'stop-local' && phase === 'stopping';
    }
    function state() {
      return copy({ phase: phase, connected: connected, sessionId: run && run.sessionId, runId: run && run.runId,
        localPeerId: localId, actorId: local && local.actorId, digest: prepared && prepared.digest,
        ready: phase === 'ready', allReady: allReady(), generation: generation, peers: peers, proposal: proposal, notice: notice });
    }
    return { join: join, setConnected: setConnected, peerDisconnected: peerDisconnected, prepare: prepare, confirmLoaded: confirmLoaded,
      ready: ready, unready: unready, proposeStart: proposeStart, receive: receive, acceptStart: acceptStart,
      confirmScheduled: confirmScheduled, markStarted: markStarted, stopLocal: stopLocal, faultLocal: faultLocal, confirmStopped: confirmStopped,
      completeLocal: completeLocal, snapshot: state, isCurrent: isCurrent };
  }
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.ChoreoEnsembleSession = { VERSION: 1, MAX_MESSAGE_BYTES: MAX_MESSAGE_BYTES, MAX_PARTICIPANTS: MAX_PARTICIPANTS, create: create };
})();
