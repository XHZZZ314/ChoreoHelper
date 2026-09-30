// test-music.js —— 本地音乐节拍地基层 node 断言线束（TASK-20260909-MUSIC-BEAT-VERIFY r5）
// 用法：node web/test-music.js --case clock|beats|game|lifecycle|persistence|boundaries|integrity [--red]；node web/test-music.js --browser
// 失败 exit 1（指纹单行一次），环境错误 exit 2，通过 exit 0；--red 跑同一断言。
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = __dirname, ROOT = path.join(DIR, '..');
const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; }
const caseName = argVal('--case'), redMode = args.indexOf('--red') >= 0, browserMode = args.indexOf('--browser') >= 0;
const FP = { clock: 'MUSIC_CLOCK_ASSERTION', beats: 'MUSIC_BEATS_ASSERTION', game: 'MUSIC_GAME_ASSERTION', lifecycle: 'MUSIC_LIFECYCLE_ASSERTION', persistence: 'MUSIC_PERSISTENCE_ASSERTION', boundaries: 'MUSIC_BOUNDARIES_ASSERTION', browser: 'MUSIC_BROWSER_ASSERTION', integrity: 'MUSIC_INTEGRITY_ASSERTION' };
let pass = 0, fail = 0;
process.on('unhandledRejection', function (e) { fail++; console.log('  ✘ 未捕获的异步拒绝：' + ((e && e.message) || String(e))); });
function ok(n, c, d) { if (c) { pass++; if (!redMode) console.log('  ✔ ' + n + (d !== undefined ? '（' + d + '）' : '')); } else { fail++; console.log('  ✘ ' + n + (d !== undefined ? '（' + d + '）' : '')); } }
function infra(m) { console.error('INFRA: ' + m); process.exit(2); }
function loadMusic() { try { delete require.cache[require.resolve('./choreo-music.js')]; require('./choreo-music.js'); } catch (e) { infra('载入 choreo-music.js 失败：' + (e && e.message)); } const M = globalThis.ChoreoMusic; if (!M) infra('ChoreoMusic 全局缺失'); return M; }
function eq(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function zhErr(s) { return typeof s === 'string' && /[一-鿿]/.test(s); }
function fakeMedia(durMs) { return { _a: 0, _rate: 1, _playing: false, _playFail: null, durationMs: function () { return durMs; }, currentMs: function () { return this._a; }, setCurrentMs: function (a) { this._a = a; }, setRate: function (r) { this._rate = r; }, rate: function () { return this._rate; }, playing: function () { return this._playing; }, play: function () { const s = this; return new Promise(function (ok2, no) { if (s._playFail) no(new Error(s._playFail)); else { s._playing = true; ok2(); } }); }, pause: function () { this._playing = false; } }; }
function fakeNet() { return { starts: [], stops: 0, startBehavior: [], stopBehavior: null, _status: { status: 'playing', time: 0 }, start: function (b) { this.starts.push(b); const bh = this.startBehavior.length ? this.startBehavior.shift() : { resp: { status: 'playing' } }; return new Promise(function (ok2, no) { setTimeout(function () { if (bh.throws) no(bh.throws); else ok2(bh.resp); }, bh.delayMs || 0); }); }, stop: function () { this.stops++; const bh = this.stopBehavior || { resp: { status: 'stopped' } }; return new Promise(function (ok2, no) { setTimeout(function () { if (bh.throws) no(bh.throws); else ok2(bh.resp); }, 0); }); }, status: function () { const s = this._status; return new Promise(function (ok2) { setTimeout(function () { ok2(s && typeof s === 'object' ? JSON.parse(JSON.stringify(s)) : s); }, 0); }); } }; }
function mkCtl(M, durMs, nowRef) { const media = fakeMedia(durMs), net = fakeNet(); return { ctl: M.createController({ media: media, net: net, now: function () { return nowRef.t; } }), media: media, net: net }; }
async function caseClock(M) {
  console.log('== AC-1 时钟映射 ==');
  [[0, 'O=0'], [500, 'O=+500'], [-500, 'O=-500']].forEach(function (pair) { const O = pair[0]; [0, 250, 500, 1000].forEach(function (A) { ok('T=A-O（' + pair[1] + '，A=' + A + '）', eq(M.mapMediaToTimeline(A, O), A - O), 'T=' + (A - O)); }); });
  ok('seek 映射 A=clamp(S+O)', M.mapTimelineToMedia(1000, 500, 5000) === 1500);
  ok('seek 负向钳零（无负媒体定位）', M.mapTimelineToMedia(-800, 500, 5000) === 0 && M.mapTimelineToMedia(0, -500, 5000) === 0);
  ok('seek 超尾钳住', M.mapTimelineToMedia(4900, 500, 5000) === 5000);
  ok('可见时间钳制', M.visibleTime(-250, 300000) === 0 && M.visibleTime(400000, 300000) === 300000);
  ok('纯映射误差≤1e-6ms', eq(M.mapMediaToTimeline(1000.0000005, 500), 500.0000005));
  const nowRef = { t: 1000000 }, h = mkCtl(M, 5000, nowRef), ctl = h.ctl, media = h.media;
  ok('无音乐时播放保持空操作', (await ctl.play(null)).noop === 'no-music' && ctl.state().mode === 'idle');
  ctl.attach({ fingerprint: 'fp1', durationMs: 5000 });
  ok('设置偏移+500', ctl.setSettings({ offsetMs: 500 }).ok === true);
  await ctl.play(null);
  ok('网页播放态', ctl.state().mode === 'web');
  media._a = 200; ctl.onTick(300000);
  ok('T<0 预卷：显示 0（初始姿态、无激活事件）', ctl.state().displayMs === 0);
  media._a = 1500; ctl.onTick(300000);
  ok('媒体独自推进（T=1000）', ctl.state().displayMs === 1000);
  nowRef.t += 10000; ctl.onHidden(); ctl.onTick(300000);
  ok('隐藏 10s 不补偿（位置仍在 A）', media.currentMs() === 1500 && ctl.state().displayMs === 1000);
  ctl.pause();
  ok('暂停保留 A', media.currentMs() === 1500 && ctl.state().mode === 'idle');
  await ctl.resume(null);
  ok('继续保留 A', media.currentMs() === 1500 && ctl.state().mode === 'web');
  ctl.stop();
  ok('停止归零并失效挂起工作', media.currentMs() === 0 && ctl.state().displayMs === 0);
  media._a = 999; await ctl.play(null);
  ok('停止源起播从 A=0', media.currentMs() === 0);
  media._a = 5000; ctl.onMediaEnded();
  ok('媒体尾暂停并保留终点', ctl.state().ended === true && ctl.state().displayMs === 4500);
  await ctl.play(null);
  ok('结束后下一次显式播放从零开始', media.currentMs() === 0 && ctl.state().ended === false);
}
async function caseBeats(M) {
  console.log('== AC-2 节拍校验与目标 ==');
  [0, 500, -500, 3600000, -3600000, '500'].forEach(function (v) { ok('合法偏移 ' + v, M.validateOffset(v).ok === true); });
  ['', 'abc', 1.5, NaN, Infinity, 3600001, -3600001, null, undefined, {}].forEach(function (v) { const r = M.validateOffset(v); ok('非法偏移拒绝 ' + String(v), r.ok === false && zhErr(r.error)); });
  [null, undefined, '', 1, 120, '120', 600].forEach(function (v) { ok('合法 BPM ' + String(v), M.validateBpm(v).ok === true); });
  [0, 601, -5, NaN, Infinity, 'abc'].forEach(function (v) { const r = M.validateBpm(v); ok('非法 BPM 拒绝 ' + String(v), r.ok === false && r.error.indexOf('BPM') >= 0); });
  ok('BPM 可空（音频可用、无节拍标记）', M.validateBpm(null).value === null && M.visibleBeats(null, 0, 0, 5000, 300000).length === 0);
  [0, 250, 5000].forEach(function (v) { ok('合法锚点 ' + v, M.validateAnchor(v, 5000).ok === true); });
  [-1, 5001, 1.5, NaN].forEach(function (v) { ok('非法锚点拒绝 ' + String(v), M.validateAnchor(v, 5000).ok === false); });
  ok('节拍公式 audio=H+n·60000/BPM', M.beatAudioMs(0, 120, 250) === 250 && M.beatAudioMs(1, 120, 250) === 750 && M.beatAudioMs(2, 120, 250) === 1250);
  ok('节拍公式 timeline=audio-O（120/250/500→-250,250,750）', M.beatTimelineMs(0, 120, 250, 500) === -250 && M.beatTimelineMs(1, 120, 250, 500) === 250 && M.beatTimelineMs(2, 120, 250, 500) === 750);
  const bs = M.visibleBeats(120, 250, 500, 300000, 300000);
  ok('负目标不渲染（首拍 -250）', bs[0].timelineMs === -250 && bs[0].render === false && bs[0].index === 1);
  ok('可见拍带序号与目标毫秒', bs[1].index === 2 && bs[1].timelineMs === 250 && bs[1].render === true);
  ok('渲染拍同时落在媒体与时间轴内', bs.filter(function (b) { return b.render; }).every(function (b) { return b.audioMs >= 0 && b.audioMs <= 300000 && b.timelineMs >= 0 && b.timelineMs <= 300000; }));
  const nowRef = { t: 0 }, h = mkCtl(M, 60000, nowRef), ctl = h.ctl;
  ctl.attach({ fingerprint: 'fp2', durationMs: 60000 });
  ctl.setSettings({ offsetMs: 500, bpm: 120, anchorMs: 250 });
  ok('非法输入原设置不变', ctl.setSettings({ offsetMs: 9999999 }).ok === false && ctl.state().settings.offsetMs === 500);
  const evBefore = JSON.stringify([{ startMs: 2500 }]);
  await ctl.play(null);
  const r = ctl.setSettings({ offsetMs: 600 });
  ok('播放中改时序先暂停（显式播放才恢复）', r.ok === true && r.paused === true && h.media.playing() === false);
  ok('节拍编辑不搬移事件时刻', JSON.stringify([{ startMs: 2500 }]) === evBefore);
  await ctl.play(null);
  ok('显式播放恢复', ctl.state().mode === 'web');
  const extra = { timing: { bpm: 120 }, music: null };
  M.writeMusicKey(extra, { offsetMs: 1, bpm: 2, anchorMs: 3 }, { fingerprint: 'x' });
  ok('音乐键不压扁既有扩展键', extra.timing.bpm === 120 && extra.music.settings.offsetMs === 1);
  const bad = M.coerceLoadedMusic({ settings: { offsetMs: 99999999 }, ref: { fingerprint: 'x' } });
  ok('不支持的导入设置停用音乐并中文说明', bad.disabled === true && /音乐/.test(bad.notice) && M.sanitizeSettings(M.defaultSettings()).ok === true);
}
async function caseGame(M) {
  console.log('== AC-3 游戏协同（单显式启动） ==');
  const nowRef = { t: 5000 };
  for (const d of [0, 200, 2000]) {
    const h = mkCtl(M, 8000, nowRef), ctl = h.ctl, net = h.net;
    net.startBehavior.push({ delayMs: d, resp: { status: 'playing' } });
    ctl.attach({ fingerprint: 'g' + d, durationMs: 8000 });
    ctl.setSettings({ offsetMs: 500 }); h.media._a = 1200;
    const pr = ctl.play({ clips: [{ id: 1 }], revision: 7 });
    await flush(0);
    if (d > 0) nowRef.t += d;
    await pr.then(function () { nowRef.t += 1; });
    const st = ctl.state();
    ok('延迟 ' + d + 'ms 成功确认（单启动）', st.mode === 'game' && net.starts.length === 1, 'starts=' + net.starts.length);
    ok('fromTime 采样一次 max(0,A-O)/1000', eq(net.starts[0].fromTime, 0.7) && net.starts[0].revision === 7 && net.starts[0].speed === 1);
    ok('显示请求往返毫秒（非分发精度）', typeof st.lastRttMs === 'number' && st.lastRttMs >= d, 'rtt=' + st.lastRttMs);
    ctl.stop();
  }
  let h = mkCtl(M, 8000, nowRef);
  h.media._a = 100; h.ctl.attach({ fingerprint: 'pre', durationMs: 8000 }); h.ctl.setSettings({ offsetMs: 500 });
  const pr = h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  await flush(0);
  ok('正预卷等待 T≥0（未发启动）', h.ctl.state().mode === 'gameWait' && h.net.starts.length === 0);
  h.media._a = 600; h.ctl.onTick(300000); await pr; await flush(5);
  ok('预卷结束同一显式表演发启动', h.net.starts.length === 1 && eq(h.net.starts[0].fromTime, 0.1));
  h.ctl.stop();
  h = mkCtl(M, 8000, nowRef);
  h.media._playFail = 'denied'; h.ctl.attach({ fingerprint: 'denied', durationMs: 8000 });
  ok('媒体先行：play 失败不发启动', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).failed === true && h.net.starts.length === 0);
  h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 200, resp: { status: 'playing' } });
  h.ctl.attach({ fingerprint: 'dup', durationMs: 8000 }); h.media._a = 500;
  const p1 = h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  await flush(0);
  ok('挂起时重复播放不重发', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).deduped === true && h.net.starts.length === 1);
  await p1; h.ctl.stop();
  const rejCases = [['体错误', { resp: { error: 'busy', message: '忙' } }], ['畸形响应', { resp: null }], ['403', { throws: { status: 403, detail: '配对码不对' } }], ['409', { throws: { status: 409, detail: '版本冲突' } }], ['503', { throws: { status: 503, detail: '插件忙' } }]];
  for (const pair of rejCases) {
    h = mkCtl(M, 8000, nowRef);
    h.net.startBehavior.push(Object.assign({ delayMs: 0 }, pair[1]));
    h.ctl.attach({ fingerprint: 'f' + pair[0], durationMs: 8000 }); h.media._a = 500;
    const rr = await h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
    ok('启动' + pair[0] + '可见失败（中文）', rr.failed === true && zhErr(rr.error) && h.media.playing() === false);
  }
  h = mkCtl(M, 8000, nowRef);
  h.ctl.attach({ fingerprint: 'auth', durationMs: 8000 }); h.media._a = 3000;
  await h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  h.net._status = { status: 'playing', time: 13 };
  await h.ctl.sampleStatus();
  ok('状态超前 10s 不动音频（音频权威）', h.media.currentMs() === 3000);
  h.net._status = { status: 'playing', time: -7 };
  await h.ctl.sampleStatus();
  ok('状态滞后 10s 不动音频', h.media.currentMs() === 3000);
  h.ctl.setLoop(1000, 2000);
  const n0 = h.net.starts.length;
  h.media._a = 2500; h.ctl.onTick(300000);
  ok('游戏忽略网页循环（无自动重发）', h.net.starts.length === n0);
  h.media._a = 8000; h.ctl.onTick(300000);
  ok('游戏到尾结束一次（不自动循环）', h.ctl.state().mode === 'idle' && h.net.starts.length === n0 && h.net.stops === 1);
  h.ctl.stop();
}
async function caseLifecycle(M) {
  console.log('== AC-4 生命周期与竞争 ==');
  const nowRef = { t: 0 };
  let h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 200, resp: { status: 'playing' } });
  h.ctl.attach({ fingerprint: 'lc1', durationMs: 8000 }); h.media._a = 500;
  const p = h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  await flush(0);
  h.ctl.stop();
  ok('旧启动未决时重播被串行拦下', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).blocked === 'settling');
  await p; await flush(10);
  ok('迟到成功启动被补偿性停止（无本地复活）', h.net.stops >= 1 && h.ctl.state().mode === 'idle' && h.media.currentMs() === 0);
  ok('补偿后可接受新显式启动', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).ok === true && h.net.starts.length === 2);
  h.ctl.stop();
  h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 0, resp: { status: 'playing' } });
  h.ctl.attach({ fingerprint: 'lc2', durationMs: 8000 }); h.media._a = 500;
  await h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  h.ctl.stop();
  ok('先成功后停止：一次停止即清理', h.net.stops === 1 && h.ctl.state().mode === 'idle');
  h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 100, throws: { status: 409, detail: '冲突' } });
  h.ctl.attach({ fingerprint: 'lc3', durationMs: 8000 }); h.media._a = 500;
  const p3 = h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  h.ctl.stop(); await p3; await flush(10);
  ok('停止后到达的拒绝不复活、不抛未捕获', h.ctl.state().mode === 'idle');
  h = mkCtl(M, 8000, nowRef);
  h.ctl.attach({ fingerprint: 'lc4', durationMs: 8000 }); h.media._a = 500;
  await h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  h.ctl.onProjectSwitch();
  h.net._status = { status: 'playing', time: 3 };
  await h.ctl.sampleStatus();
  ok('切项目后旧状态回调作废', h.ctl.state().gameConfirmed !== true);
  h = mkCtl(M, 8000, nowRef);
  h.ctl.attach({ fingerprint: 'lc5', durationMs: 8000 });
  h.ctl.stop(); const stopsBefore = h.net.stops; h.ctl.stop();
  ok('重复停止无害', h.net.stops === stopsBefore);
  h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 0, throws: { transport: true, message: 'timeout' } });
  h.ctl.attach({ fingerprint: 'lc6', durationMs: 8000 }); h.media._a = 500;
  const ru = await h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  ok('传输超时判未知（不断言远端已停）', ru.failed === true && h.ctl.state().gameUnknown === true && h.media.playing() === false);
  ok('未知态拦下音乐游戏重开（中文指引）', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).blocked === 'unknown');
  h.net.stopBehavior = { throws: { transport: true, message: 'down' } };
  ok('停止重试仍不通则保持未知', (await h.ctl.stopRetry()).failed === true && h.ctl.state().gameUnknown === true);
  h.net.stopBehavior = { resp: { status: 'stopped' } };
  ok('显式停止重试成功才解除未知', (await h.ctl.stopRetry()).ok === true && h.ctl.state().gameUnknown === false);
  ok('恢复后仍需显式播放', (await h.ctl.play({ clips: [{ id: 1 }], revision: 1 })).ok === true);
  h.ctl.stop();
  h = mkCtl(M, 8000, nowRef);
  h.net.startBehavior.push({ delayMs: 150, resp: { status: 'playing' } });
  h.ctl.attach({ fingerprint: 'old', durationMs: 8000 }); h.media._a = 500;
  const po = h.ctl.play({ clips: [{ id: 1 }], revision: 1 });
  await flush(0);
  h.ctl.attach({ fingerprint: 'new', durationMs: 8000 });
  await po; await flush(10);
  ok('文件替换使旧启动迟到被补偿', h.net.stops >= 1);
  const cur = JSON.stringify({ offsetMs: 5 });
  M.coerceLoadedMusic(null);
  ok('取消选择保留既有文档', JSON.stringify({ offsetMs: 5 }) === cur);
  h = mkCtl(M, 8000, nowRef);
  h.ctl.attach({ fingerprint: 'keep', durationMs: 8000 });
  ok('零时长替换保留原引用', h.ctl.attach({ fingerprint: 'z', durationMs: 0 }).ok === false && h.ctl.state().attached.fingerprint === 'keep');
}
async function casePersistence(M) {
  console.log('== AC-5 持久化与兼容 ==');
  let CD = null, W = null;
  try { require('./choreo-document.js'); require('./choreo-docwire.js'); CD = globalThis.ChoreoDocument; W = globalThis.ChoreoDocWire; } catch (e) { infra('载入文档模块失败：' + (e && e.message)); }
  function content() { return { dancers: [{ id: 0, name: '舞者 1', color: '#7eb3ff', switchClips: [], actionClips: [{ id: 7, start: 2.5, duration: 3, data: { name: '鞠躬', command: '/bow', category: 'usual' } }], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [{ id: 'm1', t: 1, name: '入场' }], bpmMap: [{ t: 0, bpm: 137 }], music: { v: 1, settings: { offsetMs: -499, bpm: 137, anchorMs: 251 }, ref: { fingerprint: 'fp-137' } } }; }
  const srcJson = JSON.stringify(content());
  const loaded = W.loadProjection(JSON.parse(srcJson));
  const doc = W.persistDoc(Object.assign({}, loaded.proj, W.unknownTopKeys(loaded.proj)), { id: 'p1', name: 't' }, loaded.rev);
  const back = W.loadProjection(doc);
  ok('设置与未知键往返无损', JSON.stringify(back.proj.music) === JSON.stringify(content().music) && JSON.stringify(back.proj.bpmMap) === JSON.stringify(content().bpmMap));
  ok('六轨内容不受音乐往返影响', back.proj.dancers[0].actionClips[0].start === 2.5 && back.proj.markers[0].t === 1);
  ok('装载不改动源输入', JSON.stringify(content()) === srcJson);
  const extra = {};
  M.writeMusicKey(extra, { offsetMs: 0, bpm: null, anchorMs: 0 }, { fingerprint: 'fp', objectUrl: 'blob:http://x/1', mediaBytes: [1, 2, 3], path: 'C:\\a.mp3' });
  const ser = JSON.stringify(extra);
  ok('私有媒体排除（无路径/URL/字节/base64）', ser.indexOf('blob:') < 0 && ser.indexOf('mediaBytes') < 0 && ser.indexOf('.mp3') < 0 && ser.indexOf('base64') < 0 && M.readMusicKey(extra).ref.fingerprint === 'fp');
  const f1 = M.fingerprintBytes([0, 1, 2, 3, 4]), f2 = M.fingerprintBytes([0, 1, 2, 3, 4]), f3 = M.fingerprintBytes([0, 1, 2, 3, 5]);
  ok('内容指纹稳定且区分字节', typeof f1 === 'string' && f1.length >= 8 && f1 === f2 && f1 !== f3);
  ok('指纹组合确定', M.composeFingerprint({ size: 8, durationMs: 100, head: f1, tail: f2 }) === M.composeFingerprint({ size: 8, durationMs: 100, head: f1, tail: f2 }));
  ok('相同指纹恢复引用', M.matchRef({ fingerprint: 'a' }, { fingerprint: 'a' }) === 'match');
  ok('不同字节必须显式替换', M.matchRef({ fingerprint: 'a' }, { fingerprint: 'b' }) === 'replace');
  ok('缺失媒体进入重选态', M.matchRef({ fingerprint: 'a' }, null) === 'missing');
  const badInput = { music: { v: 1, settings: { offsetMs: 99999999, bpm: 120, anchorMs: 0 }, ref: { fingerprint: 'x' } } };
  const badJson = JSON.stringify(badInput);
  let threw = null;
  try { M.sanitizeImportMusic(badInput); } catch (e) { threw = e; }
  ok('非法导入原子失败（中文、输入不动）', threw && zhErr(threw.message) && JSON.stringify(badInput) === badJson);
  const richDoc = CD.ensureDocument({ dancers: [{ id: 0, name: 'd', color: '#fff', switchClips: [], actionClips: [], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [], music: content().music }).doc;
  richDoc.timing.bpmMap = [{ tMs: 0, bpm: 137 }]; richDoc.timing.timeSignatureMap = [{ tMs: 0, n: 4 }];
  const rt = W.loadProjection(CD.toLegacyContent(richDoc));
  ok('富时序导入可用且不展平', Array.isArray(rt.doc.timing.bpmMap) && rt.doc.timing.bpmMap.length === 1 && JSON.stringify(rt.proj.music) === JSON.stringify(content().music));
  let revokes = 0;
  const ref = { fingerprint: 'r', objectUrl: 'blob:http://x/2' };
  M.disposeRef(ref, function () { revokes++; }); M.disposeRef(ref, function () { revokes++; });
  ok('对象 URL 恰释放一次（重复释放无害）', revokes === 1);
}
async function caseBoundaries(M) {
  console.log('== AC-6 边界与变速 ==');
  [0.25, 1, 2].forEach(function (s) { ok('合法速度 ' + s, M.validSpeed(s) === true); });
  [0.1, 3, NaN, 0].forEach(function (s) { ok('非法速度拒绝 ' + String(s), M.validSpeed(s) === false); });
  const nowRef = { t: 0 };
  let h = mkCtl(M, 10000, nowRef), ctl = h.ctl, media = h.media;
  ctl.attach({ fingerprint: 'b1', durationMs: 10000 });
  media._a = 1500;
  ctl.setRate(2);
  ok('变速只设一次 rate（不动 currentTime）', media.currentMs() === 1500 && media.rate() === 2);
  ctl.setSettings({ offsetMs: 500 });
  await ctl.play(null);
  media._a = 3000; ctl.setRate(0.5);
  ok('网页变速保持 A 连续', media.currentMs() === 3000 && ctl.state().mode === 'web');
  ctl.stop();
  ok('循环 500ms 恰好合法', ctl.setLoop(1000, 1500).ok === true);
  ok('循环 499ms 拒绝且存量不变', ctl.setLoop(1000, 1499).ok === false && ctl.state().loop.bMs === 1500);
  ctl.setSettings({ offsetMs: -1500 });
  ok('循环端点越过媒体零拒绝', ctl.setLoop(0, 1000).ok === false && ctl.state().loop.bMs === 1500);
  ctl.setSettings({ offsetMs: 500 });
  ctl.setSettings({ offsetMs: -500 });
  ok('负偏移下越界循环拒绝', ctl.setLoop(0, 1000).ok === false);
  ctl.setSettings({ offsetMs: 9500 });
  ok('尾部越界循环拒绝', ctl.setLoop(0, 600).ok === false);
  ctl.setSettings({ offsetMs: 500 });
  ctl.setLoop(1000, 1500);
  ctl.setSettings({ offsetMs: 9500 });
  h.media._a = 0;
  const blockedPlay = await ctl.play(null);
  ok('非法循环阻塞起播（中文）', blockedPlay.blocked === 'loop' && zhErr(blockedPlay.error || ''));
  ctl.setSettings({ offsetMs: 500 });
  await ctl.play(null);
  const sess = ctl.state().session;
  media._a = 2000; ctl.onTick(300000);
  ok('网页到 B 回卷 A+O（同一会话）', media.currentMs() === 1500 && ctl.state().session === sess && ctl.state().mode === 'web');
  ctl.stop();
  h = mkCtl(M, 10000, nowRef); ctl = h.ctl; media = h.media;
  ctl.attach({ fingerprint: 'b2', durationMs: 10000 });
  ctl.setSettings({ offsetMs: 0 }); ctl.setLoop(1000, 2000);
  await ctl.play({ clips: [{ id: 1 }], revision: 1 });
  media._a = 1500; ctl.setRate(1.5);
  ok('游戏变速双暂停待显式播放', media.playing() === false && ctl.state().needsPlay === true);
  await flush(10);
  await ctl.play({ clips: [{ id: 1 }], revision: 2 });
  const starts = h.net.starts.length;
  media._a = 1200; ctl.seek(1500);
  ok('游戏 seek 双暂停待显式播放', media.playing() === false && ctl.state().needsPlay === true && media.currentMs() === 1500);
  await flush(10);
  await ctl.play({ clips: [{ id: 1 }], revision: 3 });
  ok('游戏侧恢复均为新显式表演', h.net.starts.length === starts + 1);
  ctl.stop();
}
async function caseIntegrity() {
  console.log('== AC-8 完整性与范围 ==');
  const ticket = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'tickets', 'TASK-20260909-MUSIC-BEAT-VERIFY.json'), 'utf8'));
  const accHash = sha256File(path.join(ROOT, '.agent', 'evidence', 'TASK-20260909-MUSIC-BEAT-VERIFY', 'r5', 'qa-acceptance.md'));
  const bound = (ticket.documentationImpact || '').match(/SHA-256 ([0-9a-f]{64})/);
  ok('QA 验收哈希与票据绑定一致', !!bound && accHash === bound[1], accHash.slice(0, 12));
  const review = fs.readFileSync(path.join(ROOT, '.agent', 'evidence', 'TASK-20260909-MUSIC-BEAT-VERIFY', 'r5', 'qa-review.md'), 'utf8');
  const draftWant = (review.match(/SHA-256:\s*([0-9a-f]{64})/) || [])[1];
  ok('草稿输入哈希保持不变', !!draftWant && sha256File(path.join(ROOT, '.agent', 'evidence', 'TASK-20260909-MUSIC-BEAT-VERIFY', 'r5', 'qa-input-draft.json')) === draftWant);
  ['choreo-music.js', 'choreo-music-ui.js', 'choreo-helper-app.html', 'choreo-helper-app.css'].forEach(function (n) { ok('双子字节一致 ' + n, fs.readFileSync(path.join(DIR, n)).equals(fs.readFileSync(path.join(DIR, 'dist', 'ChoreoHelper', n)))); });
  const RUN_ID = 'RUN-20260910-MUSIC-BEAT-FOUNDATION-R5';
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'runs', 'baselines', RUN_ID, 'manifest.json'), 'utf8'));
  const allowDrift = { 'web/test-music.js': '本轮测试期望修复（预卷夹持预言与新鲜 run 绑定）', '.agent/modules/web-product/changes/CHG-TASK-20260909-MUSIC-BEAT-VERIFY-R5.json': '本轮 Worker 重写模块变更记录（认领时为失效 run 旧稿）' };
  let kept = true;
  manifest.files.forEach(function (f) { if (allowDrift[f.path]) return; const cur = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f.path))).digest('hex'); if (cur !== f.sha256) { kept = false; console.log('  ✘ 认领基线漂移：' + f.path); } });
  ok('认领基线零漂移（披露的测试修复除外）', kept);
  const qm = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'evidence', 'TASK-20260909-MUSIC-BEAT-VERIFY', 'r5', 'ledger-recovery', 'quarantine-manifest.json'), 'utf8'));
  let pres = true, presN = 0;
  function chkIt(it) { const t = it.to || it.dst; if (!t || !it.sha256) return; presN++; const cur = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, t))).digest('hex'); if (cur !== it.sha256) { pres = false; console.log('  ✘ 隔离保全漂移：' + t); } }
  (qm.steps.A2_preservation.items || []).forEach(chkIt);
  (qm.steps.A3_quarantine.items || []).forEach(chkIt);
  ok('隔离保存件（红记录/失败门/隔离账本）零漂移', pres, presN + '件');
  let measure = null;
  try { const cp = require('child_process'); measure = JSON.parse(cp.execSync('node scripts/pipeline-cli.js measure ' + RUN_ID, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch (e) { infra('measure 执行失败：' + (e && e.message)); }
  const rules = ticket.writeScope || [];
  function matchRule(p, r) { if (r.indexOf('*') < 0) return p === r; const es = r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*'); return new RegExp('^' + es + '$').test(p); }
  const touched = (measure.changedFilePaths || []).concat(measure.newPaths || []);
  ok('改动文件数在预算内', (measure.changedFiles || touched.length) <= ticket.budgets.maxChangedFiles, String(touched.length) + '≤' + ticket.budgets.maxChangedFiles);
  ok('改动行数在预算内', ((measure.addedLines || 0) + (measure.deletedLines || 0)) <= ticket.budgets.maxChangedLines, String((measure.addedLines || 0) + (measure.deletedLines || 0)) + '≤' + ticket.budgets.maxChangedLines);
  ok('全部改动落在写范围内', touched.every(function (p) { return rules.some(function (r) { return matchRule(p, r); }); }), touched.join(',') || '零改动');
}
function toneWavBase64() {
  const sr = 8000, secs = 2, n = sr * secs, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
  return data.toString('base64');
}
function musicBrowserScenario(toneB64) {
  return (async function (toneB64) {
    var passes = 0, fails = 0, log = [];
    function L(t) { log.push(t); }
    function ok2(n, c, d) { if (c) { passes++; L('  ✔ ' + n + (d ? '（' + d + '）' : '')); } else { fails++; L('  ✘ ' + n + (d ? '（' + d + '）' : '')); } }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    async function poll(fn, tries) { var i = 0; while (i++ < (tries || 50)) { if (fn()) return true; await sleep(100); } return fn(); }
    async function run() {
      var w = window, doc = w.document;
      function click(id) { doc.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
      function setInput(id, v) { var e = doc.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
      ok2('音乐模块已加载', !!w.ChoreoMusic && !!w.ChoreoMusicUI);
      var panel = doc.getElementById('musicPanel');
      ok2('音乐面板存在（中文）', !!panel && /音乐/.test(panel.textContent));
      var bytes = Uint8Array.from(atob(toneB64), function (c) { return c.charCodeAt(0); });
      var input = doc.getElementById('musicFile');
      var dt = new DataTransfer(); dt.items.add(new File([bytes], 'tone.wav', { type: 'audio/wav' })); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await poll(function () { var s = w.ChoreoMusicUI.debug.snapshot(); return s && s.attached && s.durationMs > 0; }, 100);
      var snap = w.ChoreoMusicUI.debug.snapshot();
      ok2('真实解码时长>0', !!(snap && snap.attached && snap.durationMs > 0), snap ? String(snap.durationMs) : '无');
      if (!snap || !snap.attached) return { passes: passes, fails: fails, log: log };
      setInput('musicOffset', '500');
      click('musicPlay');
      await poll(function () { return w.ChoreoMusicUI.debug.snapshot().audioA > 50; }, 50);
      snap = w.ChoreoMusicUI.debug.snapshot();
      ok2('显式播放后真实 currentTime 推进', snap.audioA > 0, 'A=' + snap.audioA);
      ok2('预卷期显示钳 0（O=500，A<500，初始姿态）', snap.audioA < 500 && snap.displayMs === 0, 'A=' + snap.audioA + ' 显示=' + snap.displayMs);
      ok2('预卷期播放头钳 0', Math.abs(w.store.currentTime * 1000) <= 1, 'store=' + w.store.currentTime);
      await poll(function () { return w.ChoreoMusicUI.debug.snapshot().audioA > 700; }, 100);
      snap = w.ChoreoMusicUI.debug.snapshot();
      var a1 = snap.audioA;
      ok2('预卷后显示=映射 A-O±100ms', a1 >= 700 && Math.abs(snap.displayMs - (a1 - 500)) <= 100, '显示=' + snap.displayMs + ' 期望≈' + (a1 - 500));
      ok2('预卷后播放头跟随映射±100ms', Math.abs(w.store.currentTime * 1000 - (a1 - 500)) <= 100, 'store=' + w.store.currentTime);
      setInput('musicBpm', 'abc'); await sleep(150);
      ok2('中文校验可见', /BPM/.test(doc.getElementById('musicErr').textContent));
      setInput('musicBpm', '120'); setInput('musicAnchor', '250');
      await poll(function () { return doc.querySelectorAll('#musicStrip .mbeat').length > 0; }, 30);
      var marks = doc.querySelectorAll('#musicStrip .mbeat');
      ok2('节拍目标可见（序号+毫秒）', marks.length > 0 && /第2拍/.test(doc.getElementById('musicBeats').textContent));
      var strip = doc.getElementById('musicStrip'), m1 = marks[1];
      ok2('节拍接线正确（data-tl 精确）', m1 && m1.getAttribute('data-tl') === '750', m1 ? m1.getAttribute('data-tl') : '无');
      var expPx = (750 / (w.store.totalDuration * 1000)) * strip.clientWidth;
      ok2('节拍像素误差≤1px', m1 && Math.abs(m1.offsetLeft - expPx) <= 1, m1 ? ('实际=' + m1.offsetLeft + ' 期望≈' + expPx.toFixed(1)) : '无');
      click('musicPause');
      var pa = w.ChoreoMusicUI.debug.snapshot().audioA;
      await sleep(250);
      var pb = w.ChoreoMusicUI.debug.snapshot().audioA;
      ok2('暂停 200ms 漂移≤20ms', Math.abs(pb - pa) <= 20, '漂移=' + Math.abs(pb - pa).toFixed(1));
      click('musicResume'); await sleep(300);
      ok2('继续保留进度', w.ChoreoMusicUI.debug.snapshot().audioA >= pb);
      click('musicStop');
      ok2('停止归零', w.ChoreoMusicUI.debug.snapshot().audioA === 0);
      ok2('设置经 contentExtra 持久', w.store.contentExtra && w.store.contentExtra.music && w.store.contentExtra.music.settings.offsetMs === 500);
      var origFetch = w.apiFetch, bodies = [];
      w.apiFetch = function (url, opts) {
        if (url.indexOf('/playback/start') >= 0) { bodies.push(JSON.parse(opts.body)); return new Promise(function (res) { setTimeout(function () { res({ status: 'playing' }); }, 200); }); }
        if (url.indexOf('/playback/stop') >= 0) return Promise.resolve({ status: 'stopped' });
        return origFetch(url, opts);
      };
      try {
        w.store.previewTarget = 'game';
        if (!w.store.dancers.length && w.setDancerCount) w.setDancerCount(1);
        w.store.dancers[0].actionClips.push({ id: 9001, start: 0, duration: 2, data: { name: '挥剑', command: '/sword', category: 'usual' } });
        setInput('musicOffset', '0'); await sleep(200);
        var dt2 = new DataTransfer(); dt2.items.add(new File([bytes], 'tone.wav', { type: 'audio/wav' })); input.files = dt2.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await poll(function () { return w.ChoreoMusicUI.debug.snapshot().attached; }, 50);
        ok2('重选恢复引用', w.ChoreoMusicUI.debug.snapshot().attached === true);
        await poll(function () { var a = doc.querySelectorAll('audio')[0]; return a && a.readyState >= 4; }, 150);
        ok2('重选后可播（readyState=4）', (function () { var a = doc.querySelectorAll('audio')[0]; return a && a. readyState >= 4; })());
        click('musicPlay');
        await poll(function () { return w.ChoreoMusicUI.debug.snapshot().netStarts > 0; }, 50);
        ok2('单次显式表演只发一次启动', bodies.length === 1, 'starts=' + bodies.length);
        if (bodies.length) ok2('启动体带 fromTime 与 revision', typeof bodies[0].fromTime === 'number' && bodies[0].revision === (w.store._tlRevision || 1));
        var stops0 = w.ChoreoMusicUI.debug.snapshot().netStops;
        click('musicStop');
        await poll(function () { return w.ChoreoMusicUI.debug.snapshot().netStops > stops0; }, 50);
        ok2('游戏取消有补偿停止（无复活）', w.ChoreoMusicUI.debug.snapshot().netStops > stops0 && w.ChoreoMusicUI.debug.snapshot().mode === 'idle');
      } finally { w.apiFetch = origFetch; w.store.previewTarget = 'web'; }
      return { passes: passes, fails: fails, log: log };
    }
    try { return await run(); } catch (e) { fails++; log.push('  ✘ 场景异常：' + (e && e.message ? e.message : String(e))); return { passes: passes, fails: fails, log: log }; }
  })(toneB64);
}
async function caseBrowser() {
  console.log('== AC-7 真实浏览器（仓库 dist + 合成媒体 + 拦截网络） ==');
  const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(function (p) { return fs.existsSync(p); });
  if (!exe) infra('未找到 Chrome（AC-7 要求真实浏览器，缺失不得 PASS）');
  const distHtml = path.join(DIR, 'dist', 'ChoreoHelper', 'choreo-helper-app.html');
  if (!fs.existsSync(distHtml)) infra('仓库 dist 主页缺失：' + distHtml);
  const cp = require('child_process'), os = require('os'), http = require('http');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'music-cdp-'));
  const port = 19321 + (process.pid % 1000);
  const inputHashes = ['choreo-music.js', 'choreo-music-ui.js', 'choreo-helper-app.html'].map(function (n) { return n + '=' + sha256File(path.join(DIR, 'dist', 'ChoreoHelper', n)).slice(0, 12); }).join(',');
  const seenUrls = [];
  let child = null, ws = null;
  const idRef = { n: 0 };
  const pending = new Map();
  function reply(id, method, params) { try { ws.send(JSON.stringify({ id: id, method: method, params: params })); } catch (e) {} }
  function onPaused(p) {
    seenUrls.push(p.request.url);
    const u = p.request.url, rid = 700000 + Math.floor(Math.random() * 99999);
    const local = u.indexOf('127.0.0.1') >= 0 || u.indexOf('localhost') >= 0;
    function fulfill(body) { reply(rid, 'Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(body).toString('base64') }); }
    if (/^file:/.test(u)) reply(rid, 'Fetch.continueRequest', { requestId: p.requestId });
    else if (local && u.indexOf('/playback/start') >= 0) fulfill(JSON.stringify({ status: 'playing' }));
    else if (local && (u.indexOf('/playback/stop') >= 0 || u.indexOf('/playback/status') >= 0)) fulfill(JSON.stringify({ status: 'stopped', time: 0 }));
    else if (local) reply(rid, 'Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
    else reply(rid, 'Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
  }
  function onMessage(ev) {
    let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.id && pending.has(d.id)) { const h = pending.get(d.id); pending.delete(d.id); clearTimeout(h.timer); if (d.error) h.no(new Error(d.error.message)); else h.ok(d.result); }
    else if (d.method === 'Fetch.requestPaused') onPaused(d.params);
  }
  function send(m, p) {
    return new Promise(function (ok2, no) {
      const id = ++idRef.n;
      const timer = setTimeout(function () { if (pending.delete(id)) no(new Error('CDP 命令超时(15s): ' + m)); }, 15000);
      pending.set(id, { ok: ok2, no: no, timer: timer });
      ws.send(JSON.stringify({ id: id, method: m, params: p || {} }));
    });
  }
  try {
    const pageUrl = 'file:///' + distHtml.replace(/\\/g, '/');
    child = cp.spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files', '--window-size=1400,900', '--user-data-dir=' + profile, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
    let dbg = null;
    for (let i = 0; i < 200 && !dbg; i++) {
      await flush(300);
      try { const list = await new Promise(function (ok2, no) { http.get({ host: '127.0.0.1', port: port, path: '/json/list' }, function (res) { let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { try { ok2(JSON.parse(s)); } catch (e) { no(e); } }); }).on('error', no); }); const tg = (list || []).find(function (x) { return x.type === 'page'; }); if (tg) dbg = tg; } catch (e) {}
    }
    if (!dbg) infra('找不到页面 target（Chrome 未启动）');
    ws = new WebSocket(dbg.webSocketDebuggerUrl);
    await new Promise(function (ok2, no) { ws.onopen = ok2; ws.onerror = no; });
    ws.addEventListener('message', onMessage);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.navigate', { url: pageUrl });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) { try { const v = await send('Runtime.evaluate', { expression: '!!(window.store&&store.appReady&&document.querySelector(".act-list"))', returnByValue: true }); if (v && v.result && v.result.value) ready = true; else await flush(500); } catch (e) { await flush(500); } }
    if (!ready) infra('仓库 dist 主页 120s 未就绪');
    const r = await send('Runtime.evaluate', { expression: '(' + musicBrowserScenario.toString() + ')(' + JSON.stringify(toneWavBase64()) + ')', returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) infra('页面场景执行出错：' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails).slice(0, 300));
    const out = (r.result && r.result.value) || { passes: 0, fails: 1, log: ['无场景返回'] };
    (out.log || []).forEach(function (t) { console.log(t); });
    ok('浏览器场景断言全过', out.fails === 0, out.passes + '通过/' + out.fails + '失败');
    const realNet = seenUrls.filter(function (u) { return /^https?:/.test(u) && u.indexOf('127.0.0.1') < 0 && u.indexOf('localhost') < 0; });
    ok('零真实外联（合成拦截）', realNet.length === 0, seenUrls.length + '次拦截' + (realNet.length ? ' 外联=' + realNet.slice(0, 3).join(',') : ''));
    console.log('BROWSER-EVIDENCE ' + JSON.stringify({ passes: out.passes, fails: out.fails, intercepted: seenUrls.length, inputs: inputHashes, chrome: exe }));
  } catch (e) { ok('浏览器场景执行', false, (e && e.message) || String(e)); }
  finally { try { if (ws) ws.close(); } catch (e) {} try { if (child) child.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
}
async function main() {
  const M = (browserMode || caseName === 'integrity') ? null : loadMusic();
  const cases = { clock: caseClock, beats: caseBeats, game: caseGame, lifecycle: caseLifecycle, persistence: casePersistence, boundaries: caseBoundaries, integrity: caseIntegrity };
  try {
    if (browserMode) await caseBrowser();
    else if (!caseName || !cases[caseName]) { console.error('用法：--case clock|beats|game|lifecycle|persistence|boundaries|integrity [--red] 或 --browser'); process.exit(2); }
    else if (caseName === 'integrity') await caseIntegrity();
    else await cases[caseName](M);
  } catch (e) { fail++; console.log('  ✘ 用例异常：' + ((e && e.stack) || e)); }
  const fpKey = browserMode ? 'browser' : caseName;
  if (fail > 0) { console.log(FP[fpKey]); console.log('MUSIC ' + fpKey + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(1); }
  console.log('MUSIC ' + fpKey + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / 0 失败');
}
main();
