// 双人直连试验界面：本人确认就绪、校时后预约、串行访问本机插件，素材始终留在各自电脑。
(function (root) {
  'use strict';
  var MAX_ERROR_MS = 100, MIN_LEAD_MS = 500, START_LEAD_MS = 5000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, ID = /^[0-9a-f]{32}$/;
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function must(v, message) { if (!v) throw new Error(message); }
  function result(v) { must(v && v.ok, v && v.error || '本次操作未完成。'); return v; }
  function stateName(value) { return String(value || '').toLowerCase(); }
  function create(options) {
    options = options || {};
    var P = root.ChoreoEnsemblePackage, S = root.ChoreoEnsembleSession, T = root.ChoreoEnsembleTransport, C = root.ChoreoEnsembleClock;
    must(P && S && T && C, '双人直连模块尚未载入。');
    must(typeof options.getCompiledProject === 'function' && options.api, '缺少本机编排或插件适配器。');
    must(Array.isArray(options.iceServers), '请明确选择 STUN 服务，或选择空列表仅尝试本地直连。');
    var iceServers = T.validateIceServers(options.iceServers), api = options.api, music = options.music;
    var audioPrepared = null, audioTouched = false;
    ['load', 'arm', 'clock', 'schedule', 'stop'].forEach(function (name) { must(typeof api[name] === 'function', '缺少插件接口：' + name); });
    var doc = root.document, element = null, nodes = {}, session = null, transport = null, descriptor = null, envelope = null;
    var localId = '', remoteId = '', host = false, incoming = null, linkEpoch = 0, netState = 'new';
    var locked = false, busy = false, disposed = false, messageText = '', binding = null, loadGeneration = 0, mutationPending = false;
    var writeTail = Promise.resolve(), messageTail = Promise.resolve(), pendingWire = [], sendSeq = 0, receiveSeq = 0, samples = [], pendingPings = new Map(), receivedPings = new Set();
    var pingTimer = null, pollTimer = null, pollBusy = false, stopEffect = null, operationEpoch = 0;
    function now() { return root.performance.now(); }
    function uuid() { return root.crypto.randomUUID(); }
    function snapshot() {
      return { connected: netState === 'connected', netState: netState, host: host, locked: locked, busy: busy,
        session: session && session.snapshot(), descriptor: descriptor && copy(descriptor), message: messageText, hidden: !!element && element.hidden };
    }
    function setLock(value) { if (locked === value) return; locked = value; if (options.onLockChange) options.onLockChange(value); render(); }
    function notify(text) { messageText = String(text || ''); render(); }
    function currentPhase() { return session ? session.snapshot().phase : 'unjoined'; }
    function terminal() { return ['unjoined', 'joined', 'stopped', 'faulted', 'completed'].indexOf(currentPhase()) >= 0; }
    function stopTimers() { root.clearInterval(pingTimer); root.clearInterval(pollTimer); pingTimer = pollTimer = null; }
    function enqueue(work) { var job = writeTail.then(work, work); writeTail = job.catch(function () {}); return job; }
    function ownRun(expected) { return session === expected && !disposed; }
    function send(m) {
      if (!transport || netState !== 'connected') return;
      var wire = Object.assign({}, m, { seq: ++sendSeq });
      try { transport.send(wire); } catch (error) { notify(error.message); connectionLost(); }
    }
    function wire(type, payload) {
      if (!descriptor) return;
      send({ protocolVersion: 1, sessionId: descriptor.sessionId, runId: descriptor.runId, from: localId, seq: 1, type: type, payload: payload });
    }
    function apply(value, expected, cleanup) {
      if (!value || !value.ok || !ownRun(expected)) return Promise.resolve(value);
      value.outbound.forEach(send);
      var jobs = value.effects.map(function (effect) {
        if (effect.type === 'start-proposed') {
          return scheduleProposal(effect.proposal, expected).catch(function (error) { cancelForError(error, expected); });
        }
        return enqueue(function () { return consumeEffect(effect, expected, cleanup); });
      });
      render(); return Promise.all(jobs);
    }
    function cancelForError(error, expected) {
      if (!ownRun(expected)) return;
      notify(error.message || '本机准备失败。');
      var stopped = expected.faultLocal(messageText);
      if (!mutationPending && !audioTouched) {
        stopped.outbound.forEach(send);
        if (currentPhase() === 'stopping') apply(expected.confirmStopped(expected.snapshot().generation), expected);
        stopEffect = null; setLock(false); return;
      }
      apply(stopped, expected);
      if (!stopped.effects.length && terminal() && locked) stop().catch(function (failure) { notify(failure.message); });
    }
    function clockValue(value) {
      must(value && Number.isSafeInteger(value.serverMonoMs) && value.serverMonoMs >= 0 && typeof value.packageId === 'string' && typeof value.armId === 'string' && typeof value.state === 'string', '插件未返回完整的单调时钟与演出身份。');
      return value;
    }
    function matching(value, includeStart) {
      return binding && value.packageId === binding.packageId && value.armId === binding.armId && (!includeStart || value.startId === binding.startId);
    }
    async function cancelOwned(reason, cleanup) {
      // 音频与游戏分别清理；任一失败都不允许解除本场控制锁。
      var audioError = null;
      if (audioTouched) {
        audioPrepared = null;
        // 全局按钮已同步尝试过本机音频；本轮只复用结果，失败不能排队后自动再试。
        try {
          var audioResult = cleanup && Object.prototype.hasOwnProperty.call(cleanup, 'audioStopResult')
            ? cleanup.audioStopResult : music.stop();
          result(audioResult); audioTouched = false;
        } catch (error) { audioError = error; }
      }
      // 没有调用装载，或适配器已证明前置拒绝时，本页没有需要清扫的游戏写入。
      if (mutationPending) {
        var stopped = await api.stop(Object.assign({}, binding || {}, { reason: reason }));
        must(stopped && stopped.state === 'stopped' && stopped.safe === true && typeof stopped.matchedCurrent === 'boolean' &&
          typeof stopped.clientLoadId === 'string' && UUID.test(stopped.clientLoadId) && (!binding || stopped.clientLoadId === binding.clientLoadId),
          '插件尚未确认本次装载已安全取消，请再次点击本机停止。');
        mutationPending = false; binding = null;
      }
      if (audioError) throw audioError;
    }
    function checkAudio(allowEnded) {
      // 原生时钟回包可能采自开演前；音源自然结束是独立状态，不能被旧 countdown 当成故障。
      if (audioTouched && allowEnded && music.state && music.state().phase === 'completed') return;
      if (audioTouched) must(audioPrepared && music.isCurrent(audioPrepared), '本机音乐、项目或音频状态已变化，请重新准备。');
    }
    async function consumeEffect(effect, expected, cleanup) {
      if (!ownRun(expected) || !expected.isCurrent(effect)) return;
      try {
        if (effect.type === 'load-local') {
          mutationPending = true;
          var loaded = await api.load(effect.package);
          must(loaded && loaded.state === 'loaded' && typeof loaded.packageId === 'string' && ID.test(loaded.packageId) &&
            typeof loaded.clientLoadId === 'string' && UUID.test(loaded.clientLoadId), '插件没有确认装载身份。');
          binding = { clientLoadId: loaded.clientLoadId, packageId: loaded.packageId, armId: '', startId: '' }; loadGeneration = effect.generation;
          if (!ownRun(expected) || !expected.isCurrent(effect)) return;
          result(expected.confirmLoaded(effect.digest, effect.generation));
        } else if (effect.type === 'schedule-local') {
          must(binding && binding.armId, '本机插件尚未就绪。');
          checkAudio();
          var sampled = await pluginClock(expected, effect.generation);
          if (!ownRun(expected) || !expected.isCurrent(effect)) return;
          var peer = peerClock(); must(peer.ok && peer.uncertaintyMs + sampled.uncertaintyMs <= MAX_ERROR_MS, '最新计时误差过大，请重新准备。');
          must(effect.localDeadlineMs - now() >= MIN_LEAD_MS + sampled.uncertaintyMs, '开演时间已太近，请重新准备。');
          checkAudio();
          binding.startId = effect.startId;
          var scheduled = await api.schedule({ protocolVersion: 1, packageId: binding.packageId, armId: binding.armId, startId: effect.startId,
            deadlineMonoMs: Math.round(effect.localDeadlineMs + sampled.offsetMs) });
          must(scheduled && matching(scheduled, true) && stateName(scheduled.state) === 'countdown', '插件未确认本次预约开演。');
          if (!ownRun(expected) || !expected.isCurrent(effect)) return;
          if (audioTouched) { checkAudio(); result(music.schedule(effect.localDeadlineMs, audioPrepared)); }
          result(expected.confirmScheduled(effect.startId, effect.generation)); notify('本机已确认预约开演；到时由本机插件开始。');
        } else if (effect.type === 'stop-local') {
          stopEffect = effect;
          await cancelOwned(effect.reason, cleanup);
          if (!ownRun(expected) || !expected.isCurrent(effect)) return;
          await apply(expected.confirmStopped(effect.generation), expected); stopEffect = null; binding = null; setLock(false);
          notify('本机已停止。要再次开演，请生成新的邀请。');
        }
      } catch (error) {
        if (!ownRun(expected)) return;
        if (effect.type === 'load-local' && error.noMutation === true && !binding) {
          // 适配器明确证明尚未调用装载 POST（例如旧演出仍在运行），不可误停那场演出。
          mutationPending = false;
          cancelForError(error, expected);
        } else if (effect.type === 'stop-local') { notify('停止尚未确认：' + error.message + ' 请再次点击“本机停止”重试，或在游戏内停止。'); }
        else if (expected.isCurrent(effect)) cancelForError(error, expected);
      }
      render();
    }
    async function pluginClock(expected, generation) {
      var reads = [];
      for (var i = 0; i < 3; i++) {
        var t0 = now(), response = clockValue(await api.clock()), t3 = now();
        must(ownRun(expected) && expected.snapshot().generation === generation, '本场准备已经取消。');
        must(matching(response, false) && stateName(response.state) === 'armed', '插件的演出或就绪状态已改变。');
        reads.push(C.sample(t0, response.serverMonoMs, response.serverMonoMs, t3));
      }
      var estimated = C.estimate(reads, now(), { minSamples: 3, maxAgeMs: 5000, maxUncertaintyMs: MAX_ERROR_MS });
      must(estimated.ok, estimated.message || '本机插件计时误差过大。'); return estimated;
    }
    function peerClock() { return C.estimate(samples, now(), { minSamples: 3, maxAgeMs: 5000, maxUncertaintyMs: MAX_ERROR_MS }); }
    function ping() {
      if (!descriptor || netState !== 'connected' || !session) return;
      var t0 = now(); pendingPings.forEach(function (time, key) { if (t0 - time > 5000) pendingPings.delete(key); });
      if (pendingPings.size >= 16) return;
      var sampleId = uuid(); pendingPings.set(sampleId, t0); wire('clock-ping', { sampleId: sampleId, t0: t0 }); render();
    }
    async function reconcileStarted(expected) {
      if (!ownRun(expected) || currentPhase() !== 'countdown') return;
      var generation = expected.snapshot().generation;
      try {
        var value = clockValue(await api.clock());
        if (ownRun(expected) && expected.snapshot().generation === generation && currentPhase() === 'countdown' && matching(value, true) && stateName(value.state) === 'playing')
          await apply(result(expected.markStarted(binding.startId, generation)), expected);
      } catch (error) { /* 读不到本机开始确认时，仍按尚未开始处理取消。 */ }
    }
    function queueMessage(value, peerId, epoch) {
      messageTail = messageTail.then(function () { return handleMessage(value, peerId, epoch); }).catch(function (error) { notify(error.message); });
    }
    async function handleMessage(value, peerId, epoch) {
      if (epoch !== linkEpoch || disposed) return;
      if (!session || !descriptor) { if (pendingWire.length < 32) pendingWire.push([value, peerId]); return; }
      if (netState !== 'connected' || peerId !== remoteId || value.from !== remoteId || value.sessionId !== descriptor.sessionId || value.runId !== descriptor.runId || value.seq <= receiveSeq) return;
      try { T.validateEnvelope(value); } catch (error) { notify(error.message); return; }
      if (value.type === 'clock-ping') {
        if (receivedPings.has(value.payload.sampleId)) return;
        receiveSeq = value.seq; receivedPings.add(value.payload.sampleId);
        if (receivedPings.size > 32) receivedPings.delete(receivedPings.values().next().value);
        var t1 = now(); wire('clock-pong', { sampleId: value.payload.sampleId, t0: value.payload.t0, t1: t1, t2: now() });
      } else if (value.type === 'clock-pong') {
        var saved = pendingPings.get(value.payload.sampleId);
        if (saved === undefined || saved !== value.payload.t0 || now() - saved > 5000) return;
        pendingPings.delete(value.payload.sampleId);
        try { samples.push(C.sample(saved, value.payload.t1, value.payload.t2, now())); if (samples.length > 12) samples.shift(); receiveSeq = value.seq; }
        catch (error) { notify('计时样本无效，等待重新采样。'); }
      } else {
        var expected = session;
        if (value.type === 'not-ready' || value.type === 'status' && value.payload.state !== 'playing') await reconcileStarted(expected);
        if (!ownRun(expected) || epoch !== linkEpoch) return;
        var received = session.receive(peerId, value);
        if (received.ok) { receiveSeq = value.seq; apply(received, session); if (value.type === 'status' || value.type === 'not-ready') notify(session.snapshot().notice); }
      }
      render();
    }
    async function connectionLost() {
      netState = 'closed'; root.clearInterval(pingTimer); pingTimer = null;
      if (session) { var expected = session; await reconcileStarted(expected); if (!ownRun(expected)) return;
        var disconnected = expected.setConnected(false); apply(disconnected, expected);
        if (currentPhase() === 'playing') notify('同伴连接已断开，本机继续演出。要停止请点“本机停止”。');
        else if (!disconnected.effects.length && locked && terminal()) await stop(); }
      render();
    }
    function newTransport() {
      var epoch = ++linkEpoch;
      transport = T.create({ iceServers: iceServers, onState: function (value) {
        if (epoch !== linkEpoch || disposed) return;
        netState = value.state;
        if (value.state === 'connected' && session) connected();
        if (value.state === 'closed' || value.state === 'failed') { notify(value.reason); connectionLost(); }
        render();
      }, onMessage: function (value, peerId) { queueMessage(value, peerId, epoch); } });
      return transport;
    }
    function connected() {
      result(session.setConnected(true));
      root.clearInterval(pingTimer); pingTimer = root.setInterval(ping, 700); ping();
      var buffered = pendingWire; pendingWire = []; buffered.forEach(function (pair) { queueMessage(pair[0], pair[1], linkEpoch); });
      notify('已建立直连。双方需各自在本机点击准备，才允许本次开演。');
    }
    function join(finalDescriptor) {
      descriptor = copy(finalDescriptor); session = S.create({ localPeerId: localId }); result(session.join(descriptor));
      if (netState === 'connected') connected();
      root.clearInterval(pollTimer); pollTimer = root.setInterval(poll, 250); render();
    }
    async function compiled() { var value = await options.getCompiledProject(); must(value && Array.isArray(value.performers), '当前编排无法编译，请先处理编排错误。'); return value; }
    function choice() { return { includeGlobalLyrics: nodes.lyrics.checked, includeGlobalCues: nodes.cues.checked }; }
    async function build(source, actorId, flags) { return result(await P.create(source, Object.assign({ actorId: actorId }, flags))); }
    async function sourceUnchanged() {
      var verified = await build(await compiled(), envelope.actorId, { includeGlobalLyrics: envelope.includeGlobalLyrics, includeGlobalCues: envelope.includeGlobalCues });
      must(verified.digest === envelope.digest, '编排已修改，请停止本场并重新交换邀请；不会用旧版继续开演。');
    }
    async function action(work) {
      if (busy || disposed) return;
      busy = true; var epoch = ++operationEpoch; render();
      try { await work(epoch); } catch (error) { notify(error.message || '操作未完成。'); }
      finally { if (epoch === operationEpoch) busy = false; render(); }
    }
    async function refresh() {
      var source = await compiled();
      [nodes.actor, nodes.partner].forEach(function (select) { var previous = select.value; select.replaceChildren(); source.performers.forEach(function (p) {
        var option = doc.createElement('option'); option.value = p.id; option.textContent = p.name || p.id; select.appendChild(option);
      }); if (source.performers.some(function (p) { return p.id === previous; })) select.value = previous; });
      if (nodes.actor.value === nodes.partner.value && nodes.partner.options.length > 1) nodes.partner.selectedIndex = 1;
      nodes.cueRow.hidden = !source.events.some(function (event) { return !event.performerId && event.kind === 'cue'; });
      must(source.performers.length >= 2, '请先在编排中建立至少两名演员。'); render();
    }
    function canReplace() { must(!locked && terminal(), '请先等待本机停止确认，再更换连接。'); }
    function resetLink() {
      linkEpoch++; if (transport) transport.close(); stopTimers(); transport = null; session = null; descriptor = null; envelope = null;
      incoming = null; binding = null; netState = 'new'; pendingWire = []; samples = []; pendingPings.clear(); receivedPings.clear(); sendSeq = receiveSeq = 0;
    }
    async function makeOffer() {
      must(!transport && nodes.actor.value && nodes.partner.value && nodes.actor.value !== nodes.partner.value, '请选择不同演员，或先结束旧连接。');
      var source = await compiled(), flags = choice(), own = await build(source, nodes.actor.value, flags), remote = await build(source, nodes.partner.value, { includeGlobalLyrics: false, includeGlobalCues: false });
      localId = uuid(); remoteId = uuid(); host = true; envelope = own.envelope;
      var provisional = { protocolVersion: 1, sessionId: uuid(), runId: uuid(), hostPeerId: localId, sourceDigest: own.envelope.source.compiledDigest,
        participants: [{ peerId: localId, actorId: own.envelope.actorId, digest: own.digest }, { peerId: remoteId, actorId: remote.envelope.actorId, digest: remote.digest }] };
      var code = await newTransport().offer({ descriptor: provisional, senderPeerId: localId, recipientPeerId: remoteId });
      nodes.output.value = code; notify('把邀请文字发给同伴；对方选择自己的歌词发送方式后，会返回答复文字。');
    }
    function inspect() {
      must(!transport, '请先结束旧连接。');
      var parsed = T.parseCode(nodes.input.value);
      must(parsed.kind === 'offer' && parsed.metadata.descriptor.participants.length === 2, '此界面只接受双人邀请。');
      var meta = parsed.metadata; must(meta.senderPeerId === meta.descriptor.hostPeerId, '邀请必须由本场发起者发送。');
      incoming = { code: nodes.input.value, parsed: parsed };
      var actor = meta.descriptor.participants.find(function (p) { return p.peerId === meta.recipientPeerId; });
      notify('邀请将你分配为演员“' + actor.actorId + '”。请选择本人是否发送原歌词，再点“接受邀请并生成答复”。'); render();
    }
    async function answer() {
      must(incoming && incoming.code === nodes.input.value && !transport, '请先读取当前邀请内容。');
      var meta = incoming.parsed.metadata, part = meta.descriptor.participants.find(function (p) { return p.peerId === meta.recipientPeerId; });
      var own = await build(await compiled(), part.actorId, choice());
      must(own.envelope.source.compiledDigest === meta.descriptor.sourceDigest, '双方编排版本不同，请先在各自电脑载入同一份演出。');
      localId = meta.recipientPeerId; remoteId = meta.senderPeerId; host = false; envelope = own.envelope;
      var code = await newTransport().answer(incoming.code, { localDigest: own.digest });
      join(T.parseCode(code).metadata.descriptor); nodes.output.value = code;
      notify('把答复文字发回发起者。连接建立后，再由本人点击准备。');
    }
    async function acceptAnswer() {
      must(host && transport && !session, '当前没有等待答复的邀请。');
      var parsed = T.parseCode(nodes.input.value); must(parsed.kind === 'answer', '请粘贴对方的答复文字。');
      await transport.acceptAnswer(nodes.input.value); join(parsed.metadata.descriptor);
    }
    async function prepare() {
      var expected = session;
      must(expected && netState === 'connected' && ['joined', 'loaded'].indexOf(currentPhase()) >= 0, '请先完成双方邀请并建立直连。');
      must(!options.getBusy || !options.getBusy(), '本机已有其他游戏播放，请先停止。');
      var generation = expected.snapshot().generation;
      setLock(true);
      try {
        // Ready 点击调用栈内直接 prepare，保证浏览器音频授权不会被首个 await 丢失。
        if (nodes.music.checked) {
          must(music && typeof music.prepare === 'function', '本地音乐模块尚未载入。');
          audioTouched = true;
          var preparedAudio = await music.prepare();
          if (!ownRun(expected) || expected.snapshot().generation !== generation) return;
          audioPrepared = preparedAudio; checkAudio();
        }
        await sourceUnchanged();
        if (!ownRun(expected) || expected.snapshot().generation !== generation) return;
        var preparing = expected.prepare(envelope); generation = expected.snapshot().generation;
        var prepared = result(await preparing); await apply(prepared, expected);
        if (!ownRun(expected) || currentPhase() !== 'loaded' || generation !== loadGeneration) return;
        await enqueue(async function () {
          if (!ownRun(expected) || currentPhase() !== 'loaded' || expected.snapshot().generation !== generation) return;
          var armed = await api.arm({ protocolVersion: 1, packageId: binding.packageId });
          must(armed && binding && armed.state === 'armed' && armed.clientLoadId === binding.clientLoadId &&
            armed.packageId === binding.packageId && typeof armed.armId === 'string' && ID.test(armed.armId), '插件没有确认本次就绪身份。');
          binding.armId = armed.armId;
          if (!ownRun(expected) || currentPhase() !== 'loaded' || expected.snapshot().generation !== generation) return;
          var verified = clockValue(await api.clock()); must(matching(verified, false) && stateName(verified.state) === 'armed', '插件未处于本人确认的就绪状态。');
          if (!ownRun(expected) || currentPhase() !== 'loaded' || expected.snapshot().generation !== generation) return;
          checkAudio();
          await apply(result(expected.ready({ digest: envelope.digest, armed: true, generation: generation })), expected);
          notify('本人已允许本次开演。发起者点击开演后，本机会在校时通过时自动预约；可随时点本机停止。');
        });
      } catch (error) { if (ownRun(expected) && expected.snapshot().generation === generation) cancelForError(error, expected); }
    }
    async function scheduleProposal(proposal, expected) {
      var generation = expected.snapshot().generation;
      await sourceUnchanged(); must(ownRun(expected) && currentPhase() === 'ready' && expected.snapshot().generation === generation, '本机已取消就绪。');
      checkAudio();
      var peer = peerClock(); must(peer.ok, peer.message || '同伴时钟尚未确认。');
      var converted = host ? { ok: true, deadlineMs: proposal.sessionStartMs, uncertaintyMs: peer.uncertaintyMs } : C.localDeadline(proposal.sessionStartMs, peer, now(), { minLeadMs: MIN_LEAD_MS, maxLeadMs: 30000 });
      must(converted.ok, '开演提议已过期或校时不足，请重新准备。');
      var plugin = await pluginClock(expected, generation), uncertainty = converted.uncertaintyMs + plugin.uncertaintyMs;
      must(uncertainty <= MAX_ERROR_MS, '双方与本机插件的累计计时误差过大，请重新准备。');
      await apply(result(expected.acceptStart(proposal.startId, { nowMonoMs: now(), localDeadlineMs: Math.round(converted.deadlineMs), uncertaintyMs: uncertainty,
        maxUncertaintyMs: MAX_ERROR_MS, minLeadMs: MIN_LEAD_MS })), expected);
    }
    async function start() {
      var expected = session; must(expected && host && expected.snapshot().allReady, '请等待双方在各自电脑确认准备。');
      try {
        var clock = peerClock(); must(clock.ok, clock.message || '请等待计时确认。');
        await sourceUnchanged(); var proposal = { startId: uuid(), sessionStartMs: Math.round(now() + START_LEAD_MS) };
        await apply(result(expected.proposeStart(proposal)), expected); await scheduleProposal(proposal, expected);
      } catch (error) { cancelForError(error, expected); }
    }
    async function stop(cleanup) {
      if (options.onCancelLocal) options.onCancelLocal();
      if (cleanup && Object.prototype.hasOwnProperty.call(cleanup, 'audioStopResult')) {
        var audioResult = cleanup.audioStopResult;
        cleanup = { audioStopResult: { ok: !!audioResult && audioResult.ok === true,
          error: audioResult && audioResult.error || '本轮本地音频停止尚未确认，请明确重试。' } };
      }
      if (!session) return;
      var expected = session;
      if (stopEffect && expected.isCurrent(stopEffect)) { var retry = stopEffect; return enqueue(function () { return consumeEffect(retry, expected, cleanup); }); }
      var stopping = expected.stopLocal('本人停止演出。'); await apply(stopping, expected, cleanup);
      // 装载已确认到 Arm 回包之间，状态机尚未 Ready；仍须排在旧写请求后清扫，不能提前解锁。
      if (!stopping.effects.length && locked && terminal()) {
        var generation = expected.snapshot().generation;
        await enqueue(async function () {
          if (!ownRun(expected) || expected.snapshot().generation !== generation || !locked) return;
          try {
            await cancelOwned('本人取消本机准备。', cleanup);
            if (!ownRun(expected) || expected.snapshot().generation !== generation) return;
            binding = null; setLock(false); notify(currentPhase() === 'completed' ? '本机演出已完成。要再次开演，请生成新的邀请。' : '本机已停止。要再次开演，请生成新的邀请。');
          } catch (error) { notify('停止尚未确认：' + error.message + ' 请再次点击“本机停止”。'); }
        });
      }
    }
    async function poll() {
      if (pollBusy || !locked || !binding || !session || disposed) return;
      var expected = session, generation = expected.snapshot().generation, phase = currentPhase();
      if (['ready', 'countdown', 'playing'].indexOf(phase) < 0) return;
      pollBusy = true;
      try {
        var value = clockValue(await api.clock());
        if (!ownRun(expected) || expected.snapshot().generation !== generation || currentPhase() !== phase) return;
        var name = stateName(value.state);
        // 开演前失去音频必须取消预约；游戏已经开演后，音频自然结束不等于演出故障。
        if (phase === 'ready' || phase === 'countdown' && name === 'countdown') checkAudio(phase === 'countdown');
        if (name === 'faulted') { cancelForError(new Error('本机插件异常，尚不能确认已清扫停止。请重试本机停止，必要时在游戏输入 /choreo stop。'), expected); }
        else if (name === 'playing' && phase === 'countdown' && matching(value, true)) await apply(result(expected.markStarted(binding.startId, generation)), expected);
        else if (name === 'completed' && (phase === 'playing' || phase === 'countdown') &&
            value.packageId === binding.packageId && value.clientLoadId === binding.clientLoadId) {
          // 自然完成会清空时钟的 arm/start；用仍保留的装载身份确认归属，取消时仍带本页原始 arm。
          if (phase === 'countdown') await apply(result(expected.markStarted(binding.startId, generation)), expected);
          await apply(result(expected.completeLocal()), expected); await stop();
        }
        else if (!matching(value, phase === 'countdown' || phase === 'playing') || ['idle', 'loaded', 'completed', 'stopped'].indexOf(name) >= 0) {
          // 当前状态不是旧 nonce 的安全证明；定向取消即使未匹配当前演出也必须得到 ACK。
          cancelForError(new Error('本机演出已停止或被更换，正在取消本页的装载。'), expected);
        }
      } catch (error) { cancelForError(new Error('无法确认本机执行状态：' + error.message), expected); }
      finally { pollBusy = false; render(); }
    }
    function render() {
      if (!element) return;
      var snap = session && session.snapshot(), phase = snap ? snap.phase : 'unjoined';
      var names = { unjoined: '尚未加入', joined: '已确认邀请', preparing: '正在校验', prepared: '正在装载', loaded: '已装载', ready: '本人已就绪', scheduling: '正在预约', countdown: '已预约开演', playing: '本机演出中', stopping: '等待本机停止确认', stopped: '本场已停止', faulted: '本场已结束', completed: '本场已完成' };
      nodes.status.textContent = (netState === 'connected' ? '已直连' : netState === 'new' ? '未连接' : ['closed', 'failed'].indexOf(netState) >= 0 ? '连接已断开' : '正在交换连接信息') + ' · ' + names[phase];
      if (locked && ['stopped', 'faulted', 'completed'].indexOf(phase) >= 0) nodes.status.textContent += ' · 等待本机清理确认';
      nodes.message.textContent = messageText || snap && snap.notice || '';
      var estimate = peerClock(); nodes.clock.textContent = estimate.ok ? '计时已确认，网络估计误差 ±' + Math.ceil(estimate.uncertaintyMs) + ' 毫秒' : '计时尚未确认；建立连接后自动测量';
      nodes.peer.textContent = snap ? '同伴：' + (snap.peers[remoteId] && (snap.peers[remoteId].ready ? '已就绪' : snap.peers[remoteId].status === 'playing' ? '演出中' : snap.peers[remoteId].status === 'disconnected' ? '已断开' : '未就绪')) : '同伴尚未确认邀请';
      ['actor', 'partner', 'lyrics', 'cues'].forEach(function (key) { nodes[key].disabled = busy || !!transport; });
      nodes.music.disabled = busy || locked || !music;
      nodes.offer.disabled = busy || !!transport; nodes.inspect.disabled = busy || !!transport;
      nodes.answer.disabled = busy || !incoming || !!transport;
      nodes.accept.disabled = busy || !host || !transport || !!session;
      nodes.refresh.disabled = busy || !!transport;
      nodes.ready.disabled = busy || netState !== 'connected' || ['joined', 'loaded'].indexOf(phase) < 0;
      nodes.start.disabled = busy || !host || !snap || !snap.allReady || !estimate.ok;
      nodes.stop.disabled = !session || ['unjoined', 'joined', 'stopped', 'faulted', 'completed'].indexOf(phase) >= 0 && !locked;
      nodes.reset.disabled = busy || locked || !terminal();
    }
    function mount(container) {
      must(doc && container, '缺少界面容器。'); if (element) return element;
      element = doc.createElement('section'); element.className = 'choreo-ensemble-panel'; element.setAttribute('aria-label', '双人直连试验');
      element.style.cssText = 'position:relative;max-width:720px;padding:20px;background:#18202d;color:#edf2f7;border:1px solid #566179;border-radius:12px;font:14px/1.6 sans-serif;box-shadow:0 10px 36px #0006';
      function el(tag, text, parent) { var n = doc.createElement(tag); if (text) n.textContent = text; (parent || element).appendChild(n); return n; }
      function button(key, text, fn, parent) { var n = el('button', text, parent); n.type = 'button'; n.dataset.action = key; n.style.cssText = 'margin:4px;padding:8px 12px;cursor:pointer'; n.addEventListener('click', function () { action(fn); }); nodes[key] = n; return n; }
      el('strong', '双人直连试验'); var hideButton = el('button', '收起（演出继续）'); hideButton.type = 'button'; hideButton.dataset.action = 'hide'; hideButton.addEventListener('click', hide);
      el('p', '双方各自在电脑载入同一份演出，再手动交换下面的文字。只传邀请、准备状态和计时信息。当前只支持两人；部分网络无法直连，本试验不使用中继。');
      el('p', iceServers.length ? '已配置 STUN 辅助发现直连地址；素材不会发送给 STUN 服务或同伴。' : '未使用 STUN 服务，仅尝试直接可达的网络。');
      var actors = el('div');
      function select(key, label) { var wrap = el('label', label + ' ', actors); nodes[key] = el('select', '', wrap); nodes[key].dataset.field = key; }
      select('actor', '本人演员'); select('partner', '同伴演员'); button('refresh', '读取当前演员', refresh, actors);
      function checkbox(key, label) { var wrap = el('label'); wrap.style.display = 'block'; var n = el('input', '', wrap); n.type = 'checkbox'; n.dataset.field = key; wrap.appendChild(doc.createTextNode(' ' + label)); nodes[key] = n; return wrap; }
      checkbox('lyrics', '本人发送歌曲原歌词（勾选会把本场原歌词发到游戏；不影响手写台词）');
      nodes.cueRow = checkbox('cues', '本人执行公共提示命令（未勾选就跳过；每人的演员内命令仍保留）');
      checkbox('music', '本机同步播放已选音乐（先在音乐面板选文件；音频不外传）');
      var incomingLabel = el('label', '粘贴同伴的邀请或答复文字'); nodes.input = el('textarea', '', incomingLabel); nodes.input.dataset.field = 'incoming'; nodes.input.maxLength = 131072; nodes.input.rows = 3; nodes.input.style.cssText = 'display:block;width:100%;box-sizing:border-box';
      nodes.input.addEventListener('input', function () { incoming = null; render(); });
      var exchange = el('div'); button('offer', '生成双人邀请', makeOffer, exchange); button('inspect', '读取邀请内容', inspect, exchange); button('answer', '接受邀请并生成答复', answer, exchange); button('accept', '确认同伴答复', acceptAnswer, exchange);
      var outgoingLabel = el('label', '复制这段文字发给同伴'); nodes.output = el('textarea', '', outgoingLabel); nodes.output.dataset.field = 'outgoing'; nodes.output.readOnly = true; nodes.output.rows = 3; nodes.output.style.cssText = 'display:block;width:100%;box-sizing:border-box';
      button('selectOutput', '选中待发送文字', function () { nodes.output.focus(); nodes.output.select(); });
      nodes.status = el('p'); nodes.status.dataset.field = 'status'; nodes.peer = el('p'); nodes.clock = el('p');
      el('p', '“准备”表示本人允许这一次演出：双方就绪后，发起者选择开演，本机会在校时通过时自动开始。开演后同伴停止或断线，本机仍继续。收起面板也会继续。');
      var controls = el('div'); button('ready', '准备并允许本次开演', prepare, controls); button('start', '双方就绪，5 秒后开演', start, controls);
      // 停止必须在其他异步操作进行时仍可点击，不能经过 busy 闸。
      nodes.stop = el('button', '本机停止', controls); nodes.stop.type = 'button'; nodes.stop.dataset.action = 'stop'; nodes.stop.style.cssText = 'margin:4px;padding:10px;background:#a62d39;color:white;font-weight:bold'; nodes.stop.addEventListener('click', function () { stop().catch(function (error) { notify(error.message); }); });
      button('reset', '结束连接，准备新一场', function () { canReplace(); resetLink(); nodes.output.value = ''; notify('连接已结束。'); }, controls);
      nodes.message = el('p'); nodes.message.setAttribute('role', 'status'); nodes.message.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; nodes.message.dataset.field = 'message';
      container.appendChild(element); render(); action(refresh); return element;
    }
    function open() {
      if (!element) {
        mount(doc.body); element.style.position = 'fixed'; element.style.right = '16px'; element.style.top = '70px';
        element.style.zIndex = '10020'; element.style.maxHeight = 'calc(100vh - 100px)'; element.style.overflow = 'auto'; element.style.width = 'min(720px, calc(100vw - 72px))';
      }
      element.hidden = false; render();
    }
    function hide() { if (element) element.hidden = true; }
    async function dispose() { await stop(); await writeTail; must(!locked, '本机停止尚未确认，不能关闭执行控制器。'); disposed = true; operationEpoch++; resetLink(); if (element) element.remove(); }
    return { mount: mount, open: open, hide: hide, dispose: dispose, getState: snapshot, stop: stop };
  }
  root.ChoreoEnsembleUI = { create: create };
})(typeof window === 'object' ? window : globalThis);
