// test-music-editor.js —— 波形/预备拍/吸附/兼容/竞态/完整性断言线束（TASK-20260910-MUSIC-BEAT-EDITOR r3）
// 用法：node web/test-music-editor.js --case waveform|countin|snap|compat|project-races|integrity [--red]
// 失败 exit 1（指纹单行一次），环境错误 exit 2，通过 exit 0；缺失能力按断言失败（exit 1），永不算环境错误。
'use strict';
const fs = require('fs'), path = require('path');
const DIR = __dirname, ROOT = path.join(DIR, '..');
const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; }
const caseName = argVal('--case'), redMode = args.indexOf('--red') >= 0;
const FP = { waveform: 'MUSIC_EDITOR_WAVEFORM_ASSERTION', countin: 'MUSIC_EDITOR_COUNTIN_ASSERTION', snap: 'MUSIC_EDITOR_SNAP_ASSERTION', compat: 'MUSIC_EDITOR_COMPAT_ASSERTION', 'project-races': 'MUSIC_EDITOR_PROJECT_RACES_ASSERTION', integrity: 'MUSIC_EDITOR_INTEGRITY_ASSERTION' };
let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; if (!redMode) console.log('  ✔ ' + n + (d !== undefined ? '（' + d + '）' : '')); } else { fail++; console.log('  ✘ ' + n + (d !== undefined ? '（' + d + '）' : '')); } }
function infra(m) { console.error('INFRA: ' + m); process.exit(2); }
function zhErr(s) { return typeof s === 'string' && /[一-鿿]/.test(s); }
function eq(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }
let T = null, M = null;
try { delete require.cache[require.resolve('./choreo-music-timing.js')]; require('./choreo-music-timing.js'); T = globalThis.ChoreoMusicTiming; } catch (e) { T = null; }
try { delete require.cache[require.resolve('./choreo-music.js')]; require('./choreo-music.js'); M = globalThis.ChoreoMusic; } catch (e) { M = null; }
function needT() { ok('会话节拍纯模块已加载（缺失按断言失败）', !!T); return !!T; }
function fakeMedia(durMs) { return { _a: 0, _plays: 0, _playing: false, durationMs: function () { return durMs; }, currentMs: function () { return this._a; }, setCurrentMs: function (a) { this._a = a; }, setRate: function () {}, play: function () { const s = this; s._plays++; return new Promise(function (ok2) { s._playing = true; ok2(); }); }, pause: function () { this._playing = false; } }; }
function fakeNet() { return { starts: [], stops: 0, start: function (b) { this.starts.push(b); return Promise.resolve({ status: 'playing' }); }, stop: function () { this.stops++; return Promise.resolve({ status: 'stopped' }); }, status: function () { return Promise.resolve({ status: 'stopped' }); } }; }
function fakeTimer() { const q = { ids: 0, pending: [], set: function (fn, ms) { const id = ++q.ids; q.pending.push({ id: id, fn: fn, ms: ms }); return id; }, clear: function (id) { q.pending = q.pending.filter(function (t) { return t.id !== id; }); }, fire: function () { const ts = q.pending.slice().sort(function (a, b) { return a.ms - b.ms; }); q.pending = []; ts.forEach(function (t) { t.fn(); }); } }; return q; }
function mkCtl(durMs, timer) { const media = fakeMedia(durMs), net = fakeNet(), nowRef = { t: 0 }; const ctl = M.createController({ media: media, net: net, now: function () { return nowRef.t; }, timer: timer }); return { ctl: ctl, media: media, net: net, nowRef: nowRef }; }
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
async function caseWaveform() {
  console.log('== AC-1 本地波形（有界/对齐/代际） ==');
  if (!needT() || !M) { ok('r5 地基层可用', !!M); return; }
  ok('资源上限冻结（64MiB/15min/2ch/4096桶/2048绘制）', T.LIMITS.maxFileBytes === 67108864 && T.LIMITS.maxDurationMs === 900000 && T.LIMITS.maxChannels === 2 && T.LIMITS.maxPeakBuckets === 4096 && T.LIMITS.maxPaintTargets === 2048);
  ok('64MiB 整合法、64MiB+1 中文拒绝', T.validateAudioSelection({ sizeBytes: 67108864, mime: 'audio/wav' }).ok === true && (function () { const r = T.validateAudioSelection({ sizeBytes: 67108865, mime: 'audio/wav' }); return r.ok === false && zhErr(r.error); })());
  ok('15min 整合法、超长中文拒绝', T.validateAudioSelection({ sizeBytes: 100, durationMs: 900000, channels: 2, mime: 'audio/mpeg' }).ok === true && T.validateAudioSelection({ sizeBytes: 100, durationMs: 900001, channels: 2, mime: 'audio/mpeg' }).ok === false);
  ok('三声道/不支持格式/空文件中文拒绝', T.validateAudioSelection({ sizeBytes: 100, durationMs: 1000, channels: 3, mime: 'audio/wav' }).ok === false && T.validateAudioSelection({ sizeBytes: 100, mime: 'text/plain' }).ok === false && T.validateAudioSelection({ sizeBytes: 0, mime: 'audio/wav' }).ok === false);
  const sr = 1000, n = 4000, ch0 = new Array(n).fill(0); ch0[1750] = 1; ch0[1751] = -0.5;
  const pk = T.computePeaks([ch0], 40);
  ok('脉冲桶峰值 1 且其余桶为 0', pk.buckets === 40 && pk.peaks[17] === 1 && pk.peaks.every(function (v, i) { return i === 17 ? true : v === 0; }));
  ok('请求桶数封顶 4096', T.computePeaks([ch0], 99999).buckets === 4096);
  const px = T.audioToPixel(1750, 500, 4000, 300), px2 = T.timelineToPixel(1250, 4000, 300);
  ok('脉冲像素 T=A-O 对齐误差≤1px（93.75）', eq(px, 93.75, 1) && eq(px, px2, 1e-9), 'x=' + px);
  const st = T.createWaveformStore();
  ok('超限选择不推进代际（原引用保留）', (function () { const g0 = st.state().generation; const r = st.select({ sizeBytes: 67108865, mime: 'audio/wav' }); return r.ok === false && zhErr(r.error) && st.state().generation === g0; })());
  const s1 = st.select({ sizeBytes: 1000, mime: 'audio/wav' });
  ok('合法选择开启新代际', s1.ok === true && st.state().generation === s1.gen);
  ok('每代际至多一次解码（重复进入中文拒绝）', st.beginDecode(s1.gen).ok === true && (function () { const r = st.beginDecode(s1.gen); return r.ok === false && zhErr(r.error); })());
  const s2 = st.select({ sizeBytes: 2000, mime: 'audio/wav' });
  st.beginDecode(s2.gen);
  st.completeDecode(s2.gen, { durationMs: 2000, channels: 1, channelData: [new Array(2000).fill(0.1)] });
  const stale = st.completeDecode(s1.gen, { durationMs: 1000, channels: 1, channelData: [new Array(1000).fill(0.9)] });
  ok('逆序/替换完成被丢弃（旧代际 stale、峰值属新代际）', stale.stale === true && st.state().peaks.length > 0 && st.state().peaks.every(function (v) { return eq(v, 0.1, 1e-9); }));
  st.remove();
  ok('移除清空峰值并推进代际', st.state().peaks.length === 0);
  const extra = {};
  M.writeMusicKey(extra, { offsetMs: 0, bpm: null, anchorMs: 0 }, { fingerprint: 'fp' });
  ok('波形峰值/媒体字节永不落盘', JSON.stringify(extra).indexOf('peaks') < 0 && JSON.stringify(extra).indexOf('blob:') < 0);
}
async function caseCountin() {
  console.log('== AC-4 预备拍生命周期 ==');
  if (!needT() || !M) { ok('r5 地基层可用', !!M); return; }
  function ready() { const t = fakeTimer(), h = mkCtl(30000, t); h.timer = t; h.ctl.attach({ fingerprint: 'c', durationMs: 30000 }); h.ctl.setSettings({ offsetMs: 500, bpm: 120, anchorMs: 250 }); h.media._a = 1200; h.ctl.setSessionTiming({ tempoMap: [{ startMs: 250, bpm: 120 }], meterMap: [] }); h.ctl.setCountIn({ enabled: true, bars: 1 }); return h; }
  let h = ready();
  let p = h.ctl.play(null);
  ok('预备拍期间不启动媒体（恰 1 轮四击＋一次启动待发）', h.media._plays === 0 && h.ctl.state().mode === 'countin' && h.timer.pending.length === 5);
  h.timer.fire(); await p; await flush(0);
  ok('计数走完恰启动一次媒体（单一时钟）', h.media._plays === 1 && h.ctl.state().mode === 'web');
  h = ready();
  const p1 = h.ctl.play(null); const p2 = h.ctl.play(null);
  h.timer.fire(); await Promise.all([p1.catch(function () {}), p2]); await flush(0);
  ok('计数中重复播放只开新一轮（旧轮作废、总计一次媒体启动）', h.media._plays === 1);
  h = ready();
  const pc = h.ctl.play(null); h.ctl.stop(); h.timer.fire(); await pc.catch(function () {}); await flush(0);
  ok('中途取消后迟到回调永不启动媒体', h.media._plays === 0 && h.ctl.state().mode === 'idle');
  h = ready();
  const ps = h.ctl.play(null); h.ctl.onProjectSwitch(); h.timer.fire(); await ps.catch(function () {}); await flush(0);
  ok('切项目后迟到回调永不启动媒体', h.media._plays === 0);
  h = ready();
  h.ctl.setCountIn({ enabled: false }); await h.ctl.play(null); await flush(0);
  ok('关闭预备拍保持精确 r5 行为（立即启动）', h.media._plays === 1 && h.timer.pending.length === 0);
  h = ready();
  const g = await h.ctl.play({ clips: [{ id: 1 }], revision: 1 }); await flush(0);
  ok('游戏模式永不预备拍（立即单启动＋中文提示）', h.net.starts.length === 1 && h.timer.pending.length === 0 && zhErr(g.notice || ''));
  h = ready();
  const pr = h.ctl.play(null); await h.ctl.resume(null); h.timer.fire(); await pr.catch(function () {}); await flush(0);
  ok('继续/循环不重触发预备拍（立即启动、旧轮作废）', h.media._plays === 1);
  h = ready();
  const pl = h.ctl.play(null); h.timer.fire(); await pl; await flush(0);
  h.media._a = 1500; h.ctl.onTick(300000);
  ok('启动后媒体独自推进 T=A-O（无第二时钟）', h.ctl.state().displayMs === 1000);
  const t2 = fakeTimer(), h2 = mkCtl(30000, t2);
  h2.ctl.attach({ fingerprint: 'n', durationMs: 30000 }); h2.ctl.setSettings({ offsetMs: 0 });
  h2.ctl.setCountIn({ enabled: true, bars: 1 });
  const rb = await h2.ctl.play(null);
  ok('无速度目标时有保护地拒绝（中文、不启动）', rb.blocked === 'countin' && zhErr(rb.error) && h2.media._plays === 0);
}
async function caseSnap() {
  console.log('== AC-5 拍点吸附（会话内） ==');
  if (!needT()) return;
  const tg = [-250, 250, 750, 1250, 1750, 2750].map(function (v) { return v / 1000; });
  ok('0.30s 落到 0.25 拍点', (function () { const r = T.snapBeatEdge(0.30, tg); return r.snapped === true && eq(r.target, 0.25); })());
  ok('严格小于 0.3s：恰 0.30 距离不吸附', T.snapBeatEdge(1.3, [1.0, 2.0]).snapped === false);
  ok('等距取更早目标', (function () { const r = T.snapBeatEdge(1.5, [1.0, 2.0], 0.6); return r.snapped === true && r.target === 1.0; })());
  ok('无目标不断言移动', T.snapBeatEdge(1.0, []).snapped === false);
  const se = T.createTimingSession();
  ok('会话默认 time 吸附、空映射、无栈', se.snapshot().snapMode === 'time' && se.snapshot().tempoMap.length === 0 && se.canUndo() === false);
  ok('非法吸附模式原子拒绝（中文）', (function () { const r = se.setSnapMode('x'); return r.ok === false && zhErr(r.error) && se.snapshot().snapMode === 'time'; })());
  se.setSnapMode('beat');
  const clip = { id: 3, start: 10, duration: 2, data: { name: 'a' } }, clipJson = JSON.stringify(clip);
  se.setTempoMap([{ startMs: 250, bpm: 120 }]);
  ok('改速度 alone 永不搬移 clip', JSON.stringify(clip) === clipJson);
  se.setMeterMap([{ startBeat: 0, n: 4, d: 4 }]);
  se.undo();
  ok('撤销恢复拍号且不进项目历史（本地栈）', se.snapshot().meterMap.length === 0 && se.snapshot().tempoMap.length === 1 && se.canRedo() === true);
  se.undo();
  ok('再撤销恢复速度（吸附选择撤销仍在栈内）', se.snapshot().tempoMap.length === 0 && se.canUndo() === true);
  se.redo();
  ok('重做回到速度', se.snapshot().tempoMap.length === 1);
  se.reset();
  ok('重置清空会话（默认 time/空映射/关闭预备拍）', se.snapshot().snapMode === 'time' && se.snapshot().tempoMap.length === 0 && se.snapshot().countIn.enabled === false && se.canUndo() === false);
  const app = fs.readFileSync(path.join(DIR, 'choreo-app.js'), 'utf8');
  ok('控制器委托纯吸附（beat 分支＋严格阈值＋取早）', app.indexOf('ChoreoMusicTiming') >= 0 && app.indexOf('snapBeatEdge') >= 0 && app.indexOf('ChoreoBeatTargets') >= 0 && /i\s*<=\s*300/.test(app) && app.indexOf('snapThreshold') >= 0);
  const snapSource = app.match(/function snapTime\([^]*?\n}\s*(?=function fmtDur\()/);
  const threshold = app.match(/snapThreshold\s*:\s*([0-9.]+)/);
  const snapCtx = { store: { snapEnabled: true, snapThreshold: threshold ? Number(threshold[1]) : NaN, dancers: [], globalLyrics: [] }, window: {} };
  require('vm').runInNewContext(snapSource ? snapSource[0] : '', snapCtx);
  const snap = function (t) { return snapCtx.snapTime(t, { id: -1 }, -1); };
  ok('time 网格使用实际控制器且默认阈值为 0.3s', !!snapSource && snapCtx.store.snapThreshold === 0.3);
  ok('time 网格全段 0–300s 以 0.5s 步进吸附', Array.from({ length: 600 }, function (_, i) { const t = i / 2; return eq(snap(t + 0.1), t) && eq(snap(t + 0.4), t + 0.5); }).every(Boolean));
  ok('time 网格全段等距取更早目标', Array.from({ length: 600 }, function (_, i) { return eq(snap(i / 2 + 0.25), i / 2); }).every(Boolean));
  ok('time 网格严格小于 0.3s，边界外不延伸网格', eq(snap(-0.29), 0) && eq(snap(-0.3), -0.3) && eq(snap(300.29), 300) && eq(snap(300.3), 300.3) && eq(snap(300.6), 300.6));
  ok('拍点目标由纯函数导出（render 拍、秒域）', (function () { const tg2 = T.beatTargetsSec({ tempoMap: [{ startMs: 250, bpm: 120 }, { startMs: 2250, bpm: 60 }], bpm: 120, anchorMs: 250, offsetMs: 500, durMs: 10000, projMs: 300000 }); return tg2.length > 0 && tg2[0] === 0.25 && tg2.every(function (v, i, a) { return i === 0 || a[i - 1] <= v; }); })());
  ok('绘制上限独立于吸附（UI 切片 2048，吸附不限）', (function () { const s = fs.readFileSync(path.join(DIR, 'choreo-music-ui.js'), 'utf8'); return s.indexOf('maxPaintTargets') >= 0; })());
}
async function caseCompat() {
  console.log('== AC-6 兼容与会话隔离 ==');
  if (!needT() || !M) { ok('r5 地基层可用', !!M); return; }
  let CD = null, W = null;
  try { delete require.cache[require.resolve('./choreo-document.js')]; delete require.cache[require.resolve('./choreo-docwire.js')]; require('./choreo-document.js'); require('./choreo-docwire.js'); CD = globalThis.ChoreoDocument; W = globalThis.ChoreoDocWire; } catch (e) { CD = null; }
  ok('文档模块可载（只读复用）', !!CD && !!W);
  if (!CD) return;
  function content(bpmMap, meter) { return { dancers: [{ id: 0, name: '舞者 1', color: '#7eb3ff', switchClips: [], actionClips: [{ id: 7, start: 2.5, duration: 3, data: { name: '鞠躬', command: '/bow', category: 'usual' } }], lyricClips: [] }], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [{ id: 'm1', t: 1, name: '入场' }], timing: { bpmMap: bpmMap, timeSignatureMap: meter, mood: '未知键', custom: { x: 1 } }, music: { v: 1, settings: { offsetMs: -499, bpm: 137, anchorMs: 251 }, ref: { fingerprint: 'fp-137' } } }; }
  [['startMs 形', [{ startMs: 0, bpm: 120 }], [{ startBeat: 0, n: 4, d: 4 }]], ['tMs 形', [{ tMs: 0, bpm: 137 }], [{ tMs: 0, n: 4 }]]].forEach(function (v) {
    const src = JSON.stringify(content(v[1], v[2]));
    const loaded = W.loadProjection(JSON.parse(src));
    const doc = W.persistDoc(Object.assign({}, loaded.proj, W.unknownTopKeys(loaded.proj)), { id: 'p1', name: 't' }, loaded.rev);
    const back = W.loadProjection(doc);
    ok(v[0] + '与未知键深等往返（零激活）', JSON.stringify(back.proj.timing) === JSON.stringify(JSON.parse(src).timing) && JSON.stringify(back.proj.music) === JSON.stringify(JSON.parse(src).music));
    ok(v[0] + '六轨内容存活', back.proj.dancers[0].actionClips[0].start === 2.5 && back.proj.markers[0].t === 1);
  });
  const extra = {};
  M.writeMusicKey(extra, { offsetMs: 1, bpm: 2, anchorMs: 3 }, { fingerprint: 'x' });
  ok('无新序列化别名（music 键形状冻结）', JSON.stringify(Object.keys(extra).sort()) === JSON.stringify(['music']) && JSON.stringify(Object.keys(extra.music).sort()) === JSON.stringify(['ref', 'settings', 'v']) && JSON.stringify(Object.keys(extra.music.settings).sort()) === JSON.stringify(['anchorMs', 'bpm', 'offsetMs']));
  const stored = { timing: { bpmMap: [{ startMs: 0, bpm: 120 }], countInBars: 2 }, music: { v: 1, settings: { offsetMs: 0, bpm: 120, anchorMs: 0 } } }, storedJson = JSON.stringify(stored);
  const se = T.createTimingSession();
  se.setTempoMap([{ startMs: 250, bpm: 120 }]); se.setCountIn({ enabled: true, bars: 2 }); se.setSnapMode('beat'); se.reset();
  ok('会话重置不碰存储时序', JSON.stringify(stored) === storedJson);
  const tsrc = fs.readFileSync(path.join(DIR, 'choreo-music-timing.js'), 'utf8');
  ok('会话层零持久化引用（无 contentExtra/IndexedDB/localStorage）', tsrc.indexOf('contentExtra') < 0 && tsrc.indexOf('IndexedDB') < 0 && tsrc.indexOf('localStorage') < 0);
}
// —— project-races：仓库 dist 真实 file:// 页面 + 真实项目库切换 + 受控定时器/读文件/解码（qa-contract-r3 Real-dist 段） ——
const RACE_SHIM = "(function(){var S={mode:'pass',timers:[],reads:[],decodes:[],playWaiters:[],intervals:[],plays:0,osc:0,decodeCalls:0,fr:0,wav:null,pcm:null,rt:{},trace:[]};"
  + "function TR(t){if(S.trace.length<400)S.trace.push(t);}"
  + "var rT=setTimeout.bind(window),rI=setInterval.bind(window),rC=clearInterval.bind(window);S.rt.setTimeout=rT;window.__race=S;"
  + "S.setMode=function(m){S.mode=m;};S.freeze=function(){S.intervals.forEach(function(r){rC(r.real);});};"
  + "S.tick=function(){S.intervals.slice().forEach(function(r){try{r.fn();}catch(e){}});};"
  + "S.deliverTimers=function(from){S.timers.slice(from).forEach(function(t){try{t.fn();}catch(e){}});};"
  + "S.settlePlays=function(){var w2=S.playWaiters.slice();S.playWaiters.length=0;w2.forEach(function(f){f();});};"
  + "window.setTimeout=function(fn,ms){if(S.mode==='capture'){var t={fn:fn};S.timers.push(t);TR('T+'+S.timers.length);return t;}return rT(fn,ms);};"
  + "window.setInterval=function(fn,ms){var rec={fn:fn,real:rI(fn,ms)};S.intervals.push(rec);return rec.real;};"
  + "var RealFR=FileReader;window.FileReader=function(){var self=this;TR('FR-new');"
  + "self.readAsArrayBuffer=function(blob){if(S.mode!=='capture'){var r=new RealFR();r.onload=function(){self.result=r.result;if(self.onload)self.onload();};r.onerror=function(){if(self.onerror)self.onerror();};r.readAsArrayBuffer(blob);return;}TR('FR-cap#'+S.reads.length);S.reads.push({fr:self,blob:blob});};};"
  + "S.deliverRead=function(i,good){var rd=S.reads[i];if(!rd||rd.done)return false;rd.done=true;TR('FR-del'+i+(good===false?'!':''));if(good===false){S.fr++;if(rd.fr.onerror)rd.fr.onerror();return true;}"
  + "var r=new RealFR();r.onload=function(){rd.fr.result=r.result;S.fr++;try{if(rd.fr.onload)rd.fr.onload();else TR('FR-noonload'+i);}catch(e){TR('FR-throw'+i+':'+String(e&&e.message).slice(0,60));}};r.readAsArrayBuffer(rd.blob);return true;};"
  + "function patchCtx(C){if(!C||!C.prototype||!C.prototype.decodeAudioData)return;var orig=C.prototype.decodeAudioData;"
  + "C.prototype.decodeAudioData=function(buf){S.decodeCalls++;TR('DECODE'+S.decodeCalls);if(S.mode!=='capture')return orig.call(this,buf);return new Promise(function(res,rej){S.decodes.push({resolve:res,reject:rej});});};}"
  + "patchCtx(window.AudioContext);patchCtx(window.webkitAudioContext);"
  + "S.pcm=new Float32Array(22050);for(var i=0;i<S.pcm.length;i++)S.pcm[i]=0.5;"
  + "S.deliverDecode=function(i,good){var d=S.decodes[i];if(!d)return false;if(good===false)d.reject(new Error('malformed'));else d.resolve({numberOfChannels:1,duration:2,getChannelData:function(){return S.pcm;}});return true;};"
  + "var proto=HTMLMediaElement.prototype,origPlay=proto.play;proto.play=function(){S.plays++;if(S.mode!=='capture')return origPlay.call(this);return new Promise(function(res){S.playWaiters.push(res);});};"
  + "var origStart=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(){S.osc++;try{return origStart.apply(this,arguments);}catch(e){}};"
  + "S.errors=[];window.addEventListener('error',function(e){S.errors.push(String(e.message||e.type));});"
  + "window.addEventListener('unhandledrejection',function(e){S.errors.push('rej:'+String(e.reason&&e.reason.message||e.reason));});})();";
function toneWavBase64() {
  const sr = 8000, secs = 2, n = sr * secs, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
  return data.toString('base64');
}
function projectRacesScenario(toneB64) {
  return (async function (toneB64) {
    var passes = 0, fails = 0, log = [], phases = 0;
    function L(t) { log.push(t); }
    function ok2(n, c, d) { if (c) { passes++; L('  ✔ ' + n + (d ? '（' + d + '）' : '')); } else { fails++; L('  ✘ ' + n + (d ? '（' + d + '）' : '')); } }
    var w = window, doc = w.document, R = w.__race;
    function sleep(ms) { return new Promise(function (r) { R.rt.setTimeout(r, ms); }); }
    async function until(fn, tries) { var i = 0; while (i++ < (tries || 160)) { var v = fn(); if (v) return v; await sleep(50); } return fn(); }
    function click(id) { doc.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    function input(id, v) { var e = doc.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
    function check(id, v) { var e = doc.getElementById(id); e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
    function text(id) { var e = doc.getElementById(id); return e ? e.textContent : ''; }
    function selectFile(name) { var dt = new DataTransfer(); dt.items.add(new File([R.wav], name, { type: 'audio/wav' })); var inp = doc.getElementById('musicFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    function domSnap() { return { meta: text('musicWaveMeta'), err: text('musicErr'), status: text('musicStatus'), beats: text('musicBeats'), wave: doc.getElementById('musicWave').toDataURL() }; }
    function sameDom(a, b) { return a.meta === b.meta && a.err === b.err && a.status === b.status && a.beats === b.beats && a.wave === b.wave; }
    async function drainReads() { // 先投递一切已排入未投递的读，再等后果逐轮排空（fpOf 两段链式＋解码前读）
      function pending() { return R.reads.some(function (r) { return !r.done; }); }
      if (!pending() && !(await until(pending, 300))) return false;
      for (var k = 0; k < 12; k++) {
        var n = 0;
        for (var i = 0; i < R.reads.length; i++) if (!R.reads[i].done) { R.deliverRead(i, true); n++; }
        await sleep(60);
        if (n === 0 && !pending()) return true;
      }
      return false;
    }
    async function pick(name) { selectFile(name); return await drainReads(); }
    try {
      ok2('音乐面板/会话模块/项目库已加载', !!(w.ChoreoMusicUI && w.ChoreoMusicTiming && w.ChoreoProjects && w.switchProject));
      R.wav = Uint8Array.from(atob(toneB64), function (c) { return c.charCodeAt(0); });
      var projA = w.store.projectId;
      var recB = await w.ChoreoProjects.createProject('竞态B', { dancers: [], globalLyrics: [], dancerCount: 1, showLyricMacro: false, totalDuration: 300, markers: [] });
      ok2('项目 B 已在真实项目库创建（不切换）', !!(recB && recB.id) && w.store.projectId === projA);
      R.freeze(); R.tick(); await sleep(40); // 初始观察者冲刷：lastPid 初始化
      R.setMode('capture');
      var r0 = R.reads.length;
      selectFile('a.wav');
      ok2('A 选择已布防（指纹 FileReader 挂起）', await until(function () { return R.reads.length >= r0 + 1; }, 200), 'reads=' + (R.reads.length - r0));
      await until(function () { return R.reads.length >= r0 + 2; }, 200);
      await w.switchProject(recB.id); // 真实项目库转换，绝不直接调 onProjectSwitch
      ok2('store 已切到 B', w.store.projectId === recB.id);
      var domB0 = domSnap(), extraB0 = JSON.stringify(w.store.contentExtra && w.store.contentExtra.music || null);
      R.deliverRead(r0, true); // 预观察者窗口：成功投递首段，次段由链式回调排入后再投失败
      await until(function () { return R.reads.length >= r0 + 2; }, 200);
      R.deliverRead(r0 + 1, false);
      await sleep(50);
      ok2('陈旧选择在 B 静默作废（零发布零落盘零解码）', sameDom(domB0, domSnap()) && JSON.stringify(w.store.contentExtra.music || null) === extraB0 && R.decodeCalls === 0);
      await drainReads(); // 未修复产品会继续排入解码读：一并投递，解码保持挂起后投递观察
      if (R.decodes.length) { R.deliverDecode(R.decodes.length - 1, true); await sleep(50); }
      ok2('陈旧解码不向 B 发布峰值/错误', sameDom(domB0, domSnap()), 'dc=' + R.decodeCalls + ' meta=[' + text('musicWaveMeta') + '] status=[' + text('musicStatus') + '] reads=' + R.reads.length + ' trace=' + R.trace.slice(-14).join(','));
      R.tick(); await sleep(50); phases++;
      ok2('观察者把面板复位到 B（会话/输入/预备拍清空）', (function () { var s = w.ChoreoMusicTiming.session.snapshot(); return s.tempoMap.length === 0 && !s.countIn.enabled && s.snapMode === 'time' && !doc.getElementById('musicCountOn').checked && doc.getElementById('musicSnap').value === 'time' && doc.getElementById('musicTempo').value === ''; })());
      var pickedB = await pick('b.wav'), mediaB = w.ChoreoMusicUI.debug.snapshot();
      var refB = w.store.contentExtra && w.store.contentExtra.music && w.store.contentExtra.music.ref;
      var mirrorB = w.ChoreoProjects._readMirror(), persistedB = mirrorB && w.ChoreoDocWire.loadProjection(mirrorB.content).proj.music;
      var expectedFpB = 'sha256-' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', R.wav))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      ok2('B 显式选择成功附着（文件/媒体/项目镜像引用一致）', pickedB && text('musicMeta') === 'b.wav · 2.0 秒' && w.store.projectId === recB.id && mediaB.attached && mediaB.durationMs === 2000 && mediaB.fingerprint === expectedFpB && refB && refB.fingerprint === expectedFpB && refB.size === R.wav.length && refB.durationMs === 2000 && mediaB.savedRef && JSON.stringify(mediaB.savedRef) === JSON.stringify(refB) && mirrorB.projectId === recB.id && persistedB && JSON.stringify(persistedB.ref) === JSON.stringify(refB));
      var d1 = R.decodes.length - 1;
      R.deliverDecode(d1, false); await sleep(50); phases++;
      // 诊断辅助：attach 失败会写 musicErr（非 musicWaveMeta）
      ok2('当代际解码失败必须中文报错（抑制不扩大化）', /解码/.test(text('musicWaveMeta')), text('musicWaveMeta'));
      ok2('当代际解码成功画出波形', (await pick('b2.wav')) && (function () { R.deliverDecode(R.decodes.length - 1, true); return true; })() && await until(function () { return doc.getElementById('musicWave').toDataURL() !== domB0.wave; }, 60), 'dc=' + R.decodeCalls + ' decodes=' + R.decodes.length + ' meta=[' + text('musicWaveMeta') + '] err=[' + text('musicErr') + '] dur=' + (doc.querySelectorAll('audio')[0] && doc.querySelectorAll('audio')[0].duration) + ' reads=' + R.reads.length);
      input('musicBpm', '120'); input('musicAnchor', '250');
      var plays0 = R.plays;
      click('musicPlay'); await sleep(50);
      R.settlePlays(); await sleep(50); phases++;
      ok2('B 显式播放恰好启动一次并进入 web', R.plays - plays0 === 1 && w.ChoreoMusicUI.debug.snapshot().mode === 'web', 'plays=' + (R.plays - plays0));
      doc.querySelectorAll('audio')[0].currentTime = 1.75; R.tick(); await sleep(50);
      var st1 = w.ChoreoMusicUI.debug.snapshot();
      ok2('启动后时间轴仅由媒体推进（T=A-O）', st1.audioA === 1750 && st1.displayMs === 1750, 'A=' + st1.audioA + ' T=' + st1.displayMs);
      click('musicStop');
      await w.switchProject(projA); R.tick(); await sleep(50); // B→A：A 恢复为当前项目
      ok2('A 媒体重选附着（A 落盘正常）', await pick('a2.wav'));
      input('musicBpm', '120'); input('musicAnchor', '250'); input('musicOffset', '0');
      check('musicCountOn', true);
      var playsA = R.plays, oscA = R.osc, tIdx = R.timers.length;
      click('musicPlay'); await sleep(50); phases++;
      ok2('A 预备拍已布防（恰 4 击＋1 完成定时器挂起）', w.ChoreoMusicUI.debug.snapshot().mode === 'countin' && R.timers.length - tIdx === 5, 'timers=' + (R.timers.length - tIdx));
      var dA = R.decodes.length - 1; // a2 解码挂起（跨切换竞态用）
      await w.switchProject(recB.id); // A→B 真实转换
      var domB1 = domSnap();
      R.deliverTimers(tIdx); R.deliverDecode(dA, true); await sleep(50); phases++;
      ok2('预观察者窗口：陈旧预备拍/解码零启动零发布', R.plays === playsA && R.osc === oscA && sameDom(domB1, domSnap()) && w.ChoreoMusicUI.debug.snapshot().mode === 'idle', 'plays+' + (R.plays - playsA) + ' osc+' + (R.osc - oscA));
      R.tick(); await sleep(50); // 观察者处理切换后，再投递同一批陈旧工作
      R.deliverTimers(tIdx); R.deliverDecode(dA, true); await sleep(50); phases++;
      ok2('观察者之后：陈旧工作仍惰性（零启动零发布）', R.plays === playsA && R.osc === oscA);
      await w.switchProject(projA); R.tick(); await sleep(50); // B→A：A→B→A 转换后第三次投递
      R.deliverTimers(tIdx); await sleep(50); phases++;
      ok2('A→B→A 之后：陈旧工作第三次投递仍惰性', R.plays === playsA && R.osc === oscA && w.ChoreoMusicUI.debug.snapshot().mode === 'idle');
      var waveA = doc.getElementById('musicWave').toDataURL(), metaA = text('musicWaveMeta');
      var revOk = await pick('a5.wav'), dY = R.decodes.length - 1;
      revOk = revOk && await pick('a6.wav'); // 替换：代际推进，两路解码挂起
      R.deliverDecode(R.decodes.length - 1, true); R.deliverDecode(dY, false); // 逆序完成：新代际先到、旧代际失败后到
      ok2('A 重选后逆向解码：当代际发布、旧代际静默', revOk && await until(function () { return doc.getElementById('musicWave').toDataURL() !== waveA; }, 60));
      ok2('旧代际解码失败不发布中文错误', text('musicWaveMeta') === metaA, text('musicWaveMeta'));
      var rmOk = await pick('a7.wav'), dW = R.decodes.length - 1;
      click('musicDetach'); R.deliverDecode(dW, false); await sleep(50);
      ok2('移除后挂起解码惰性（零发布）', rmOk && text('musicWaveMeta') === '', text('musicWaveMeta')); phases++;
      var plays0b = R.plays, apiStarts = 0, origFetch = w.apiFetch;
      w.apiFetch = function (url, opts) { if (url.indexOf('/playback/start') >= 0) { apiStarts++; return new Promise(function (res) { R.rt.setTimeout(function () { res({ status: 'playing' }); }, 5000); }); } if (url.indexOf('/playback/stop') >= 0) return Promise.resolve({ status: 'stopped' }); return origFetch.apply(w, arguments); };
      ok2('A 重选后游戏模式布防（媒体先行、启动挂起）', (await pick('a8.wav')) && (function () { w.store.previewTarget = 'game'; if (w.store.dancers.length) w.store.dancers[0].actionClips.push({ id: 9001, start: 0, duration: 2, data: { name: '挥手', command: '/wave', category: 'usual' } }); click('musicPlay'); return true; })() && await until(function () { return R.playWaiters.length >= 1; }, 60));
      await w.switchProject(recB.id);
      R.settlePlays(); await sleep(60); phases++;
      ok2('切换后完成的媒体回调不发游戏启动（r5 游戏路径保持）', apiStarts === 0, 'starts=' + apiStarts);
      w.apiFetch = origFetch; w.store.previewTarget = 'web';
      ok2('project-races 全阶段完成（无跳段）', phases === 9, 'phases=' + phases);
      return { passes: passes, fails: fails, log: log };
    } catch (e) { fails++; log.push('  ✘ 场景异常：' + ((e && e.message) || String(e))); return { passes: passes, fails: fails, log: log }; }
  })(toneB64);
}
function projectRacesFreshCheck() {
  var w = window, doc = w.document;
  var s = w.ChoreoMusicTiming && w.ChoreoMusicTiming.session ? w.ChoreoMusicTiming.session.snapshot() : null;
  return { ready: !!(w.store && w.store.appReady && w.ChoreoMusicUI), countOn: !!(doc.getElementById('musicCountOn') && doc.getElementById('musicCountOn').checked), tempo: s ? s.tempoMap.length : -1, countIn: s ? s.countIn.enabled : null, snap: s ? s.snapMode : null };
}
async function caseProjectRaces() {
  console.log('== AC-1/4/6/7 真实 dist 项目竞态（受控定时器/读文件/解码/网络拦截） ==');
  const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(function (p) { return fs.existsSync(p); });
  if (!exe) infra('未找到 Chrome（project-races 要求真实浏览器，缺失不得 PASS）');
  const distHtml = path.join(DIR, 'dist', 'ChoreoHelper', 'choreo-helper-app.html');
  if (!fs.existsSync(distHtml)) infra('仓库 dist 主页缺失：' + distHtml);
  const cp = require('child_process'), os = require('os'), http = require('http');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'race-cdp-'));
  const port = 19420 + (process.pid % 1000);
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
    else reply(rid, 'Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); // 拦截即中止：零真实外联
  }
  function onMessage(ev) {
    let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.id && pending.has(d.id)) { const h = pending.get(d.id); pending.delete(d.id); clearTimeout(h.timer); if (d.error) h.no(new Error(d.error.message)); else h.ok(d.result); }
    else if (d.method === 'Fetch.requestPaused') onPaused(d.params);
  }
  function send(m, p, timeoutMs) {
    return new Promise(function (ok2, no) {
      const id = ++idRef.n;
      const timer = setTimeout(function () { if (pending.delete(id)) no(new Error('CDP 命令超时(' + Math.round((timeoutMs || 20000) / 1000) + 's): ' + m)); }, timeoutMs || 20000);
      pending.set(id, { ok: ok2, no: no, timer: timer });
      ws.send(JSON.stringify({ id: id, method: m, params: p || {} }));
    });
  }
  async function pageReady() {
    for (let i = 0; i < 240; i++) { try { const v = await send('Runtime.evaluate', { expression: '!!(window.store&&store.appReady&&document.getElementById("musicPanel"))', returnByValue: true }); if (v && v.result && v.result.value) return true; } catch (e) {} await flush(500); }
    return false;
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
    await send('Page.enable', {});
    const addScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: RACE_SHIM });
    if (!addScript || !addScript.identifier) infra('竞态控制 shim 未注入');
    await send('Page.navigate', { url: pageUrl });
    if (!(await pageReady())) infra('仓库 dist 主页 120s 未就绪');
    const r = await send('Runtime.evaluate', { expression: '(' + projectRacesScenario.toString() + ')(' + JSON.stringify(toneWavBase64()) + ')', returnByValue: true, awaitPromise: true }, 240000);
    if (r.exceptionDetails) infra('页面场景执行出错：' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails).slice(0, 300));
    const out = (r.result && r.result.value) || { passes: 0, fails: 1, log: ['无场景返回'] };
    (out.log || []).forEach(function (t) { console.log(t); });
    ok('竞态场景断言全过', out.fails === 0, out.passes + '通过/' + out.fails + '失败');
    await send('Page.navigate', { url: pageUrl }); // 页面重建：全新会话
    if (!(await pageReady())) infra('重建页面 120s 未就绪');
    const r2 = await send('Runtime.evaluate', { expression: '(' + projectRacesFreshCheck.toString() + ')()', returnByValue: true });
    const fr = (r2.result && r2.result.value) || {};
    ok('重建页面获得全新会话（无继承时序/预备拍/吸附）', fr.ready === true && fr.countOn === false && fr.tempo === 0 && fr.countIn === false && fr.snap === 'time', JSON.stringify(fr));
    const realNet = seenUrls.filter(function (u) { return /^https?:/.test(u) && u.indexOf('127.0.0.1') < 0 && u.indexOf('localhost') < 0; });
    ok('零真实外联（拦截即中止）', realNet.length === 0, seenUrls.length + '次拦截' + (realNet.length ? ' 外联=' + realNet.slice(0, 3).join(',') : ''));
    console.log('RACES-EVIDENCE ' + JSON.stringify({ passes: out.passes, fails: out.fails, intercepted: seenUrls.length, chrome: exe }));
  } catch (e) { ok('竞态场景执行', false, (e && e.message) || String(e)); }
  finally { try { if (ws) ws.close(); } catch (e) {} try { if (child) child.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
}
// —— integrity：r3 授权口径（qa-contract-r3 全范围预算段）：活跃 r3 run + 真实基线 + 双重 measureRun 夹具 ——
async function caseIntegrity() {
  console.log('== AC-7 双子/范围/预算完整性（r3 口径） ==');
  const crypto = require('crypto'), os = require('os');
  const policy = require(path.join(ROOT, 'scripts', 'pipeline-policy.js'));
  const cli = require(path.join(ROOT, 'scripts', 'pipeline-cli.js'));
  const shaF = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const pairs = ['choreo-music.js', 'choreo-music-ui.js', 'choreo-music-timing.js', 'choreo-app.js', 'choreo-helper-app.html', 'choreo-helper-app.css'];
  pairs.forEach(function (n) {
    let same = false;
    try { same = fs.readFileSync(path.join(DIR, n)).equals(fs.readFileSync(path.join(DIR, 'dist', 'ChoreoHelper', n))); } catch (e) { same = false; }
    ok('双子字节一致 ' + n, same);
  });
  const ticket = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'tickets', 'TASK-20260910-MUSIC-BEAT-EDITOR.json'), 'utf8'));
  function matchRule(p, r) { if (r.indexOf('*') < 0) return p === r; const es = r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*'); return new RegExp('^' + es + '$').test(p); }
  // 恰一个本票修订 3 的活跃 run + 真实基线（缺失/损坏/歧义都按断言失败，绝不回退 HEAD 或计零）
  const activeDir = path.join(ROOT, '.agent', 'runs', 'active');
  const runs = fs.readdirSync(activeDir).filter(n => n.endsWith('.json')).map(n => { try { return JSON.parse(fs.readFileSync(path.join(activeDir, n), 'utf8')); } catch (e) { return null; } });
  const mine = runs.filter(r => r && r.ticketId === ticket.id && r.ticketRevision === 3);
  ok('恰一个本票修订3活跃运行（无歧义）', mine.length === 1, mine.map(r => r.runId).join(',') || '无');
  const run = mine[0];
  let baselineOk = false, manifest = null;
  if (run && run.runId) {
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'runs', 'baselines', run.runId, 'manifest.json'), 'utf8'));
      const { baselineHash, ...identity } = manifest;
      baselineOk = manifest.artifactType === 'run-baseline' && manifest.runId === run.runId
        && policy.sha256(policy.stableStringify(identity)) === baselineHash
        && run.baseline && run.baseline.manifestHash === baselineHash
        && manifest.files.every(f => shaF(path.join(ROOT, '.agent', 'runs', 'baselines', run.runId, 'blobs', f.sha256)) === f.sha256);
    } catch (e) { baselineOk = false; }
  }
  ok('活跃 run 携带真实基线（清单身份与全部 blob 哈希核验）', baselineOk, run ? run.runId : '无');
  // 夹具构造：基线原样复制 + 当前全范围文件（含 git 忽略的证据文件，按盘枚举）→ 一次性内存度量，绝不改写活跃清单
  function walkScope(rules) {
    const out = new Set();
    for (const rule of rules) {
      const w = rule.search(/[*?]/);
      const pre = (w < 0 ? rule : rule.slice(0, w)).replace(/\/$/, '');
      const abs = path.resolve(ROOT, pre);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).isFile()) out.add(pre);
      else { const rec = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) rec(f); else if (e.isFile()) out.add(path.relative(ROOT, f).split(path.sep).join('/')); } }; rec(abs); }
    }
    return [...out];
  }
  function snapshotInputs(rules) { const o = {}; walkScope(rules).sort().forEach(rel => { try { o[rel] = shaF(path.join(ROOT, rel)); } catch (e) { o[rel] = 'missing'; } }); return o; }
  function buildFixture(runObj, baselineSrc, scopeRules) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'race-integrity-'));
    fs.cpSync(baselineSrc, path.join(tmp, '.agent', 'runs', 'baselines', runObj.runId), { recursive: true });
    const copiedRun = JSON.parse(JSON.stringify(runObj));
    copiedRun.writeScope = scopeRules; copiedRun.lockScope = scopeRules; // 复制件才允许改范围，内存度量
    for (const rel of walkScope(scopeRules)) { const dst = path.join(tmp, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), dst); }
    return { tmp, copiedRun };
  }
  let tmps = [];
  try {
    if (baselineOk && run) {
      const inputsBefore = snapshotInputs(ticket.writeScope);
      const fx = buildFixture(run, path.join(ROOT, '.agent', 'runs', 'baselines', run.runId), ticket.writeScope);
      tmps.push(fx.tmp);
      const m1 = cli.measureRun(fx.tmp, fx.copiedRun);
      ok('新 run 度量：精确归因/零诊断/零不可测', m1.attribution === 'exact' && (m1.diagnostics || []).length === 0 && (m1.unmeasurablePaths || []).length === 0, JSON.stringify((m1.diagnostics || []).slice(0, 2)));
      ok('新 run 改动文件在预算内（≤30）', m1.changedFiles <= 30, String(m1.changedFiles));
      ok('新 run 改动行数在预算内（≤3000）', (m1.addedLines || 0) + (m1.deletedLines || 0) <= 3000, (m1.addedLines || 0) + '+' + (m1.deletedLines || 0));
      const touched = (m1.changedFilePaths || []).concat(m1.newPaths || []);
      ok('新 run 全部改动落在写范围内', touched.every(p => (ticket.writeScope || []).some(r => matchRule(p, r))), touched.join(',') || '零改动');
      console.log('  · 新 run 明细 ' + m1.changedFiles + ' 文件 +' + m1.addedLines + '/-' + m1.deletedLines + '：' + (m1.changedFilePaths || []).sort().join(' | '));
      ok('度量前后写范围输入零漂移', JSON.stringify(inputsBefore) === JSON.stringify(snapshotInputs(ticket.writeScope)));
      // 累计口径：r2 保全基线 + 联合范围 + 原始基线身份 79c5fac…（老快照作复制件 run，绝不改档案）
      const preserved = path.join(ROOT, '.agent', 'evidence', 'TASK-20260910-MUSIC-BEAT-EDITOR', 'r2-preserved');
      const snap = JSON.parse(fs.readFileSync(path.join(preserved, 'active-run.snapshot.txt'), 'utf8'));
      const union = [...new Set([...snap.writeScope, ...ticket.writeScope])];
      ok('r2 保全快照基线身份保持 79c5fac…', snap.baseline && snap.baseline.manifestHash === '79c5face071ff4551e3e06387854be82fdd49abca40f187b5506d14550d7ad27');
      const fx2 = buildFixture(snap, path.join(preserved, 'baseline'), union);
      tmps.push(fx2.tmp);
      const m2 = cli.measureRun(fx2.tmp, fx2.copiedRun);
      ok('累计度量：精确归因/零诊断', m2.attribution === 'exact' && (m2.diagnostics || []).length === 0 && (m2.unmeasurablePaths || []).length === 0, JSON.stringify((m2.diagnostics || []).slice(0, 2)));
      ok('累计改动文件在预算内（≤30）', m2.changedFiles <= 30, String(m2.changedFiles));
      ok('累计改动行数在预算内（≤3000）', (m2.addedLines || 0) + (m2.deletedLines || 0) <= 3000, (m2.addedLines || 0) + '+' + (m2.deletedLines || 0));
      console.log('  · 累计明细 ' + m2.changedFiles + ' 文件 +' + m2.addedLines + '/-' + m2.deletedLines + '：' + (m2.changedFilePaths || []).sort().join(' | '));
      console.log('  · 历史披露：r2 期全范围观察为 2004 行（保全事实，非当期结论）');
    }
    // r2 保全清单与政策处置核验（档案不可再收费，但活性历史必须零漂移）
    const preserved = path.join(ROOT, '.agent', 'evidence', 'TASK-20260910-MUSIC-BEAT-EDITOR', 'r2-preserved');
    const inv = JSON.parse(fs.readFileSync(path.join(preserved, 'inventory.json'), 'utf8'));
    // 唯二授权漂移：票据修订3本身（认领时冻结进 run 清单）与政策预算处置（下方深等断言核验）。
    const authorized = ['.agent/tickets/TASK-20260910-MUSIC-BEAT-EDITOR.json', '.agent/PIPELINE-POLICY.json'];
    // 已按生命周期移除的活性件（收尾 run/被删除的旧模块记录/清理的基线）以 r2-preserved 快照映射核验。
    const snapMap = { '.agent/runs/active/RUN-20260910-MUSIC-BEAT-EDITOR.json': path.join(preserved, 'active-run.snapshot.txt'), '.agent/modules/web-product/changes/CHG-TASK-20260910-MUSIC-BEAT-EDITOR.json': path.join(preserved, 'module-change.snapshot.txt') };
    const BASE_PFX = '.agent/runs/baselines/RUN-20260910-MUSIC-BEAT-EDITOR/';
    function preservedOf(rel) { if (snapMap[rel]) return snapMap[rel]; if (rel.indexOf(BASE_PFX) === 0) return path.join(preserved, 'baseline', rel.slice(BASE_PFX.length)); return null; }
    let kept = true, n = 0;
    (inv.files || []).forEach(f => {
      if (authorized.indexOf(f.path) >= 0) return;
      n++;
      const live = path.join(ROOT, f.path);
      if (fs.existsSync(live)) { try { if (shaF(live) !== f.sha256) { kept = false; console.log('  ✘ 保全件漂移：' + f.path); } return; } catch (e) { kept = false; return; } }
      const snap = preservedOf(f.path);
      if (!snap || !fs.existsSync(snap) || shaF(snap) !== f.sha256) { kept = false; console.log('  ✘ 保全映射缺失：' + f.path); }
    });
    ok('r2 保全清单按活性/快照映射零漂移（授权处置除外）', kept, n + '件');
    const want = JSON.parse(fs.readFileSync(path.join(preserved, 'policy.snapshot.txt'), 'utf8'));
    want.budgets.maxChangedLines = 3000; want.budgets.roleContextBytes.reviewer = 60000; // 唯一授权处置
    const live = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'PIPELINE-POLICY.json'), 'utf8'));
    ok('政策处置恰为 1500→3000 与 reviewer 40000→60000（其余深等）', policy.stableStringify(live) === policy.stableStringify(want));
    let snap2 = null;
    try { snap2 = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent', 'evidence', 'TASK-20260910-MUSIC-BEAT-EDITOR', 'implementation', 'prohibited-baseline.json'), 'utf8')); } catch (e) { snap2 = null; }
    let keptP = !!snap2, checked = 0;
    if (snap2) Object.keys(snap2.files).forEach(function (f) {
      try { checked++; const cur = shaF(path.join(ROOT, f)); if (cur !== snap2.files[f]) { keptP = false; console.log('  ✘ 本轮触碰禁区：' + f); } } catch (e) { keptP = false; }
    });
    ok('禁区零漂移（r5 测试/票据/证据/历史不动）', keptP, checked + '件');
  } finally { tmps.forEach(t => { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) {} }); }
  ['choreo-music-timing.js', 'choreo-music-ui.js'].forEach(function (n) {
    const s = fs.readFileSync(path.join(DIR, n), 'utf8');
    const shared = n === 'choreo-music-timing.js' ? true : s.indexOf('apiFetch') >= 0;
    ok(n + ' 只走共享 api 客户端（无 fetch/XHR/WS）', shared && !/fetch\s*\(|XMLHttpRequest|WebSocket/.test(s));
  });
  const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  ok('REQ-SPEC-009 保持开放（音乐行未勾选）', spec.indexOf('- [ ] Local music & beats') >= 0 && spec.indexOf('- [x] Local music & beats') < 0);
}
async function main() {
  const cases = { waveform: caseWaveform, countin: caseCountin, snap: caseSnap, compat: caseCompat, 'project-races': caseProjectRaces, integrity: caseIntegrity };
  try {
    if (!caseName || !cases[caseName]) { console.error('用法：--case waveform|countin|snap|compat|project-races|integrity [--red]'); process.exit(2); }
    await cases[caseName]();
  } catch (e) { fail++; console.log('  ✘ 用例异常：' + ((e && e.stack) || e)); }
  if (fail > 0) { console.log(FP[caseName]); console.log('MUSIC_EDITOR ' + caseName + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(1); }
  console.log('MUSIC_EDITOR ' + caseName + (redMode ? ' --red' : '') + ': ' + pass + ' 通过 / 0 失败');
}
main();
