/* test-realmodel-local.js —— 本地真模型补充渲染检查驱动器（TASK-20260909-REALMODEL-LOCAL-TEST rev2）
这个文件是干嘛的：
  一次性证据驱动器：用主人本地真模型做 presence（在场像素）判定，绝不复制模型字节：
  - --manifest-only：env CHOREO_REALMODEL_1(必填，repo 外 .glb/.gltf 绝对路径) + CHOREO_REALMODEL_2(选填)
    只把 路径+大小+SHA-256(+配套 bin)+模型侧骨架指纹 写进 manifest.json（隐私：仅哈希绑定）；
    缺失/空文件/扩展名不符/standalone .bin/repo 内路径/零模型 → exit 2 并写 {code,fingerprint}
  - --matrix：无头 Chromium SwiftShader(1400x900) 渲染 S1 双舞者同屏(x=±1.0；单模型两位同用 slot1)
    + S2 换绑对照(仅双模型才有差异意义)；8x8 左上角背景、nonBg=RGB 欧氏距离>30、左右区
    [0.02,0.49]/[0.51,0.98] x [0.05,0.75]、每占用区 nonBg>=800px、S1-S2 meanAbsDiff>=1.5/255；
    只写数值 JSON（零 PNG、零模型字节落盘），产物 local-matrix.json（取消另存 .cancelled）
  - --forbidden-scan：整文件哈希口径证明模型字节未进 证据/repo/live 根，且证据目录零 PNG
  - --resilience：取消（真实 cancel 路径 exit 130 + 产物保留 + 哈希不变）/ 并发第二认领非零失败 /
    同输入重跑一致 三个探针 → resilience.json
  退出码：0 通过 / 1 FAIL / 2 清单或环境错误 / 130 取消。产品文件全部只读（preview 哈希记录）。
*/
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const TICKET = 'TASK-20260909-REALMODEL-LOCAL-TEST';
const ROOT = path.resolve(__dirname, '..');
const EV_DEFAULT = path.join(ROOT, '.agent', 'evidence', TICKET);
const PAGE = 'file:///' + path.join(ROOT, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const PREFIX = 'choreo-realmodel-';
const ZONES = { left: [0.02, 0.49, 0.05, 0.75], right: [0.51, 0.98, 0.05, 0.75] };
const TH = { nonBgPx: 800, nonBgDist: 30, meanAbsDiff: 1.5 };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function syncWait(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); return; } catch (e) {} const t0 = Date.now(); while (Date.now() - t0 < ms) {} }
function waitExit(proc, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms && proc.exitCode === null && proc.signalCode === null) syncWait(50); return proc.exitCode !== null || proc.signalCode !== null; }
function rmRetry(p, proc) { const exited = proc ? waitExit(proc, 2000) : true;
  for (let i = 0; i < 8; i++) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} if (!fs.existsSync(p)) return { exited, removed: true }; syncWait(60); }
  return { exited, removed: !fs.existsSync(p) }; }
function writeJson(file, obj) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj) + '\n'); fs.renameSync(tmp, file); }
const owned = { pids: [], paths: [] };
function cleanupOwned() { while (owned.pids.length) { const p = owned.pids.pop(), d = owned.paths.pop(); try { p.kill(); } catch (e) {} rmRetry(d, p); } }
function sweepStale() { const swept = [];
  try { for (const name of fs.readdirSync(os.tmpdir())) { if (name.indexOf(PREFIX) !== 0) continue;
    const full = path.join(os.tmpdir(), name);
    try { const st = fs.statSync(full); if (!st.isDirectory() || Date.now() - st.mtimeMs < 3600000) continue;
      if (rmRetry(full, null).removed) swept.push(full); } catch (e) {} } } catch (e) {} return swept; }
class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = new Map();
    this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.err(new Error(m.error.message)) : p.ok(m.result); }
      else if (this.handlers.has(m.method)) this.handlers.get(m.method)(m.params); };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; }); }
  on(m, h) { this.handlers.set(m, h); }
  send(method, params) { return this.ready.then(() => new Promise((ok, err) => { const id = ++this.id;
    const t = setTimeout(() => { if (this.pending.delete(id)) err(new Error('CDP 命令超时(15s): ' + method)); }, 15000);
    this.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, err: (e) => { clearTimeout(t); err(e); } });
    this.ws.send(JSON.stringify({ id, method, params: params || {} })); })); }
  async evaluate(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined; }
}
async function waitFor(cdp, what, expr, ms) { const t0 = Date.now();
  for (;;) { const v = await cdp.evaluate(expr).catch(() => null); if (v) return v;
    if (Date.now() - t0 > (ms || 60000)) throw new Error('等待超时: ' + what); await sleep(500); } }
const attempts = [];
async function guarded(label, fn) { const fps = [];
  for (let a = 1; a <= 2; a++) {
    try { const v = await fn(); attempts.push({ label, attempt: a, ok: true }); return v; }
    catch (e) { const fp = String((e && e.message) || e).slice(0, 160); fps.push(fp);
      attempts.push({ label, attempt: a, ok: false, fingerprint: fp });
      if (fps.length === 2 && fps[0] === fps[1]) throw new Error('INCONCLUSIVE[' + label + '] 两次同指纹中止: ' + fp);
      if (a === 2) throw e; } } }
function hashDist() { const d = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
  const files = fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).isFile()).sort();
  const rows = files.map((f) => ({ f, h: sha256(fs.readFileSync(path.join(d, f))) }));
  return { hash: sha256(Buffer.from(rows.map((r) => r.f + '=' + r.h).join('\n'), 'utf8')), files: rows.length }; }
function twins() { const a = fs.readFileSync(path.join(ROOT, 'web', 'preview3d.js')), b = fs.readFileSync(path.join(ROOT, 'web', 'dist', 'ChoreoHelper', 'preview3d.js'));
  return { identical: a.equals(b), sourceSha256: sha256(a), distSha256: sha256(b) }; }
async function launch() {
  if (!CHROME) throw new Error('INCONCLUSIVE 缺Chrome：两个 Program Files 位置均无 chrome.exe');
  const port = 21000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const proc = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  owned.pids.push(proc); owned.paths.push(profile);
  for (let i = 0; i < 60; i++) { await sleep(300);
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) { void await r.json(); break; } } catch (e) {}
    if (i === 59) throw new Error('Chrome 调试口起不来'); }
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const t = list.find((x) => x.type === 'page'); if (t) { wsUrl = t.webSocketDebuggerUrl; break; } await sleep(300); }
  if (!wsUrl) throw new Error('找不到页面 target');
  return { proc, profile, cdp: new Cdp(wsUrl),
    kill() { try { proc.kill(); } catch (e) {} rmRetry(profile, proc);
      owned.pids = owned.pids.filter((p) => p !== proc); owned.paths = owned.paths.filter((d) => d !== profile); } };
}
async function armIsolation(cdp) {
  const blocked = [];
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*/*', requestStage: 'Request' }, { urlPattern: 'https://*/*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', (p) => { blocked.push(p.request.url.slice(0, 120));
    cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
  return blocked;
}
// 纯 Node PNG 解码（PNG-8 真彩 + 反滤波），只出数值，绝不落盘
function pngDecode(buf) {
  let pos = 8; const idat = []; let w = 0, h = 0, ct = 0, bd = 0;
  while (pos + 8 <= buf.length) { const len = buf.readUInt32BE(pos); const typ = buf.toString('ascii', pos + 4, pos + 8);
    if (typ === 'IHDR') { w = buf.readUInt32BE(pos + 8); h = buf.readUInt32BE(pos + 12); bd = buf[pos + 16]; ct = buf[pos + 17]; }
    else if (typ === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    else if (typ === 'IEND') break; pos += 12 + len; }
  if (!(bd === 8 && (ct === 2 || ct === 6)) || !w || !h) throw new Error('unsupported-png ct=' + ct + ' bd=' + bd);
  const ch = ct === 6 ? 4 : 3, stride = w * ch, raw = zlib.inflateSync(Buffer.concat(idat));
  const img = Buffer.alloc(h * stride); let p = 0;
  for (let y = 0; y < h; y++) { const f = raw[p++]; const row = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= ch ? img[row + x - ch] : 0, b = y ? img[row - stride + x] : 0, c = (x >= ch && y) ? img[row - stride + x - ch] : 0;
      let v = raw[p++];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      img[row + x] = v; } }
  return { w, h, ch, img };
}
// 背景=左上 8x8 均值；nonBg=欧氏距离>TH.nonBgDist；_rgb 供 S1-S2 meanAbsDiff
function metrics(dec) {
  const { w, h, ch, img } = dec; const stride = w * ch;
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = y * stride + x * ch; br += img[o]; bg += img[o + 1]; bb += img[o + 2]; n++; }
  const bgc = [Math.round(br / n), Math.round(bg / n), Math.round(bb / n)];
  const rgb = new Uint8Array(w * h * 3);
  const zones = {};
  for (const zn of ['left', 'right']) {
    const z = ZONES[zn]; let cnt = 0;
    for (let y = Math.floor(h * z[2]); y < h * z[3]; y++) for (let x = Math.floor(w * z[0]); x < w * z[1]; x++) {
      const o = y * stride + x * ch, i3 = (y * w + x) * 3;
      const r = img[o], g = img[o + 1], b = img[o + 2];
      rgb[i3] = r; rgb[i3 + 1] = g; rgb[i3 + 2] = b;
      if (Math.hypot(r - bgc[0], g - bgc[1], b - bgc[2]) > TH.nonBgDist) cnt++; }
    zones[zn] = cnt; }
  return { w, h, background: bgc, nonBgLeft: zones.left, nonBgRight: zones.right, _rgb: rgb };
}
function meanAbsDiff(m1, m2) { if (!m1 || !m2 || m1.w !== m2.w || m1.h !== m2.h) return null;
  let s = 0; const n = m1._rgb.length;
  for (let i = 0; i < n; i++) s += Math.abs(m1._rgb[i] - m2._rgb[i]);
  return Math.round((s / n) * 1000) / 1000; }
function errFingerprint(code, detail) { return sha256(TICKET + '|' + code + '|' + String(detail).slice(0, 200)).slice(0, 16); }
function outsideRepo(abs) {
  if (path.parse(abs).root !== path.parse(ROOT).root) return true; // 跨盘必在 repo 外
  const rel = path.relative(ROOT, abs);
  return rel !== '' && rel.startsWith('..'); }
function readGltfDoc(bytes, name) {
  if (/\.glb$/i.test(name)) {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546C67) return { err: 'not-glb-magic' };
    const jsonLen = bytes.readUInt32LE(12); try { return { doc: JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) }; } catch (e) { return { err: 'glb-json-parse' }; } }
  try { return { doc: JSON.parse(bytes.toString('utf8')) }; } catch (e) { return { err: 'gltf-json-parse' }; } }
function modelFingerprint(doc) { // 模型侧骨架指纹（glTF skins 关节名序列）；产品档案骨架哈希是另一口径，如实各记各的
  if (!doc || !Array.isArray(doc.skins) || !doc.skins.length) return null;
  const names = doc.skins.map((sk) => (sk.joints || []).map((ji) => (doc.nodes && doc.nodes[ji] && doc.nodes[ji].name) || ('#' + ji)));
  return sha256(JSON.stringify(names)); }
function companionNames(doc) {
  const out = [];
  ((doc && doc.buffers) || []).forEach((b) => { const uri = (b && b.uri) || '';
    if (!uri || uri.indexOf('data:') === 0) return;
    const base = String(uri).split('/').pop().split('?')[0];
    if (base && !out.includes(base)) out.push(base); });
  return out; }

function manifestOnly(out) {
  fs.mkdirSync(out, { recursive: true });
  const env1 = (process.env.CHOREO_REALMODEL_1 || '').trim(), env2 = (process.env.CHOREO_REALMODEL_2 || '').trim();
  const fail = (code, detail) => { writeJson(path.join(out, 'manifest.json'), { artifact: 'realmodel-manifest', ticket: TICKET, revision: 2, createdAt: new Date().toISOString(), ok: false, error: { code, fingerprint: errFingerprint(code, detail), detail: String(detail).slice(0, 200) }, models: [], privacy: { modelBytesCopied: 0 } });
    console.error('[manifest] FAIL ' + code + ': ' + detail); process.exit(2); };
  const slots = env1 ? [[1, env1]] : [];
  if (env2) slots.push([2, env2]);
  if (!slots.length) fail('ZERO_MODELS', 'CHOREO_REALMODEL_1 未设置（零模型环境）');
  const models = [];
  for (const [slot, raw] of slots) {
    if (!path.isAbsolute(raw)) fail('MODEL_NOT_ABSOLUTE', 'slot' + slot + ' ' + raw);
    const abs = path.resolve(raw);
    let st; try { st = fs.statSync(abs); } catch (e) { fail('MODEL_UNREADABLE', 'slot' + slot + ' ' + abs); }
    if (!st.isFile()) fail('MODEL_UNREADABLE', 'slot' + slot + ' ' + abs);
    if (st.size < 1) fail('MODEL_ZERO_BYTE', 'slot' + slot + ' ' + abs);
    if (!/\.(glb|gltf)$/i.test(abs)) fail(abs.toLowerCase().endsWith('.bin') ? 'MODEL_BIN_STANDALONE' : 'MODEL_UNSUPPORTED_EXT', 'slot' + slot + ' ' + abs);
    if (!outsideRepo(abs)) fail('MODEL_INSIDE_REPO', 'slot' + slot + ' ' + abs);
    const bytes = fs.readFileSync(abs);
    const parsed = readGltfDoc(bytes, abs);
    if (parsed.err) fail('MODEL_UNPARSEABLE', 'slot' + slot + ' ' + parsed.err);
    const fp = modelFingerprint(parsed.doc);
    const entry = { slot: 'slot' + slot, absPath: abs, sizeBytes: st.size, sha256: sha256(bytes),
      skeletonFingerprint: fp, fingerprintStatus: fp ? 'computed' : 'unavailable', companions: [] };
    for (const uri of companionNames(parsed.doc)) {
      const dir = path.dirname(abs); let cpath = null;
      for (const cand of [uri, (() => { try { return decodeURIComponent(uri); } catch (e) { return uri; } })()]) {
        const p2 = path.join(dir, cand);
        try { const s2 = fs.statSync(p2); if (s2.isFile() && s2.size >= 1) { cpath = p2; break; } } catch (e) {} }
      if (!cpath) fail('MODEL_SET_INCOMPLETE', 'slot' + slot + ' 缺外部 buffer ' + uri);
      const cb = fs.readFileSync(cpath);
      entry.companions.push({ uriBasename: uri, absPath: cpath, sizeBytes: cb.length, sha256: sha256(cb) }); }
    models.push(entry); }
  const tw = twins(), dh = hashDist();
  writeJson(path.join(out, 'manifest.json'), { artifact: 'realmodel-manifest', ticket: TICKET, revision: 2, createdAt: new Date().toISOString(), ok: true,
    previewSourceSha256: tw.sourceSha256, previewDistSha256: tw.distSha256, twinsIdentical: tw.identical, distTreeSha256: dh.hash, distTreeFiles: dh.files,
    models, privacy: { modelBytesCopied: 0, policy: 'path+SHA-256 only, no model bytes anywhere' },
    thresholds: TH, zones: ZONES });
  console.log('[manifest] PASS models=' + models.length + ' ' + models.map((m) => m.slot + '=' + m.sha256.slice(0, 12)).join(' ') + (models.length === 1 ? '（单模型边界：S2 将 SKIP）' : ''));
}

let cancelled = false;
function armCancel(getState, out) {
  const cancel = (reason) => { if (cancelled) return; cancelled = true;
    try { const st = getState(); st.cancelled = true; st.cancelReason = reason; st.partial = true;
      st.manifestPreservedSha256 = sha256(fs.readFileSync(path.join(out, 'manifest.json')));
      writeJson(path.join(out, 'local-matrix.cancelled.json'), st); } catch (e) {}
    cleanupOwned(); process.exit(130); };
  process.on('SIGINT', () => cancel('SIGINT'));
  process.on('SIGBREAK', () => cancel('SIGBREAK'));
  const ms = Number(process.env.CHOREO_REALMODEL_CANCEL_AFTER_MS || 0);
  if (ms > 0) setTimeout(() => cancel('internal-cancel-hook(timer)'), ms); // 定时钩子（通用）
  return cancel; }

async function matrix(out) {
  const mfile = path.join(out, 'manifest.json');
  if (!fs.existsSync(mfile)) { console.error('[matrix] FAIL MATRIX_NO_MANIFEST'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  if (!manifest.ok) { console.error('[matrix] FAIL MANIFEST_INVALID'); process.exit(2); }
  for (const m of manifest.models) { // 哈希绑定复验（AC-2：绑定清单后才允许渲染）
    if (sha256(fs.readFileSync(m.absPath)) !== m.sha256) { console.error('[matrix] FAIL MANIFEST_DRIFT slot=' + m.slot); process.exit(2); }
    for (const c of m.companions) if (sha256(fs.readFileSync(c.absPath)) !== c.sha256) { console.error('[matrix] FAIL MANIFEST_DRIFT companion'); process.exit(2); } }
  const state = { artifact: 'local-matrix', ticket: TICKET, revision: 2, createdAt: new Date().toISOString(), partial: true, cancelled: false,
    complementaryOnly: true, closesTails: false,
    tailNote: '补充检查：不关闭 TAIL:REPAIR-MISSING-BODY，不代替确定性修正夹具矩阵与主人有头真 GPU 复验，不作为 REQ-SPEC-054/055 验收',
    models: manifest.models.map((m) => ({ slot: m.slot, sha256: m.sha256, companions: m.companions.map((c) => c.sha256) })),
    previewSourceSha256: manifest.previewSourceSha256, previewDistSha256: manifest.previewDistSha256,
    thresholds: TH, zones: ZONES, scenarios: {}, attempts: [] };
  const cancel = armCancel(() => state, out);
  const cancelAt = process.env.CHOREO_REALMODEL_CANCEL_AT || ''; // 'after-S1'：确定性中途取消里程碑
  const single = manifest.models.length === 1;
  const b = await launch();
  try {
    const blocked = await armIsolation(b.cdp);
    await guarded('mat:navigate', () => b.cdp.send('Page.navigate', { url: PAGE }));
    await guarded('mat:appReady', () => waitFor(b.cdp, '应用就绪', 'window.store&&store.appReady&&window.ChoreoLibrary&&ChoreoLibrary.available()&&window.ChoreoEdit&&window.__p3dDebug', 60000));
    const ids = [];
    for (const m of manifest.models) {
      const cr = await guarded('setup:profile:' + m.slot, () => b.cdp.evaluate('(async()=>{var S=window.__CHOREO_SKELETON_SNAPSHOT__;if(!S||!S.bones)return{error:"no-snapshot-skeleton"};var p=await ChoreoLibrary.createProfile({name:' + JSON.stringify('REALMODEL-' + m.slot) + ',skeleton:S});return{id:p.id,skeletonHash:p.skeletonHash||null,boneCount:p.boneCount||0};})()'));
      if (cr.error) throw new Error('INCONCLUSIVE 缺参考骨架: ' + cr.error);
      // 模型字节分块注入（base64 过 CDP，只在页面内存拼 Blob；配套 bin 用 uri 原样基名=产品配对口径）
      await b.cdp.evaluate('(function(){window.__rmParts=[];return 1;})()');
      const files = [[m.absPath.split(path.sep).pop(), fs.readFileSync(m.absPath)]]
        .concat(m.companions.map((c) => [c.uriBasename, fs.readFileSync(c.absPath)]));
      for (const [name, bytes] of files) {
        await b.cdp.evaluate('(function(){window.__rmParts.push(' + JSON.stringify({ n: name }) + ');return 1;})()');
        const b64 = bytes.toString('base64');
        for (let i = 0; i < b64.length; i += 400000)
          await b.cdp.evaluate('(function(){window.__rmParts.push(' + JSON.stringify(b64.substr(i, 400000)) + ');return 1;})()'); }
      const impExpr = '(async function(){try{var parts=window.__rmParts;window.__rmParts=null;var files=[],i=0;' +
        'while(i<parts.length){var n=parts[i++].n,s="";while(i<parts.length&&typeof parts[i]==="string")s+=parts[i++];' +
        'var bin=Uint8Array.from(atob(s),function(c){return c.charCodeAt(0);});files.push({name:n,blob:new Blob([bin])});}' +
        'var r=await ChoreoLibrary.importModelSet(' + JSON.stringify(cr.id) + ',files);' +
        'return{ok:true,files:(r.files||[]).map(function(f){return{name:f.name,hash:f.hash,size:f.size};})};}' +
        'catch(e){return{ok:false,error:String((e&&e.message)||e)};}})()';
      const imp = await guarded('setup:import:' + m.slot, () => b.cdp.evaluate(impExpr));
      if (!imp.ok) throw new Error('INCONCLUSIVE 真模型导入失败(slot=' + m.slot + '): ' + imp.error);
      const got = {}; imp.files.forEach((f) => { got[f.name] = f.hash; });
      const expected = {}; files.forEach(([nm, by]) => { expected[nm] = sha256(by); });
      if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error('INCONCLUSIVE 导入哈希与清单不符(slot=' + m.slot + ')');
      ids.push({ id: cr.id, slot: m.slot, skeletonHash: cr.skeletonHash }); }
    const known = ids.map((x) => x.id);
    async function bindScenario(map) {
      await guarded('bind', () => b.cdp.evaluate('(function(){setDancerCount(2);var k=' + JSON.stringify(known) + ';var m=' + JSON.stringify(map) + ';for(var i=0;i<2;i++)ChoreoEdit.pure.setDancerBinding(store.dancers,i,m[i],k);ChoreoEdit.pure.setDancerStart(store.dancers,0,-1.0,0,0);ChoreoEdit.pure.setDancerStart(store.dancers,1,1.0,0,0);try{saveHistory();}catch(e){}try{render();}catch(e){}try{if(window.__p3dBindingsChanged)__p3dBindingsChanged();}catch(e){}return 1;})()'));
      await guarded('bind:ready', () => waitFor(b.cdp, '3D就绪', '__p3dDebug()&&__p3dDebug().ready&&__p3dDebug().masters&&__p3dDebug().masters.perDancer.length===2', 90000));
      await guarded('view:reset', () => b.cdp.evaluate('(function(){var c=document.querySelector(".p3d-canvas");if(!c)return"no-canvas";var root=c.parentElement;while(root&&root!==document.body&&!Array.prototype.some.call(root.querySelectorAll("button"),function(x){return x.textContent.trim()==="复位"}))root=root.parentElement;var btns=Array.prototype.slice.call((root||document).querySelectorAll("button"));var btn=btns.find(function(x){return x.textContent.trim()==="复位"});if(!btn)return"no-btn";btn.click();return"clicked";})()'));
      await sleep(1500); }
    async function capture(name) {
      const rect = await guarded('shot:rect:' + name, () => b.cdp.evaluate('(function(){var c=document.querySelector(".p3d-canvas");if(!c)return null;var r=c.getBoundingClientRect();if(!(r.width>50&&r.height>50))return null;return{x:r.x,y:r.y,width:r.width,height:r.height};})()'));
      if (!rect) throw new Error('INCONCLUSIVE[' + name + '] 3D 画布不可见');
      const r = await guarded('screenshot:' + name, () => b.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } }));
      return metrics(pngDecode(Buffer.from(r.data, 'base64'))); }
    function obs() { return guarded('observe', () => b.cdp.evaluate('(function(){var d=__p3dDebug();return{ready:!!(window.__p3dDebug&&d.ready),rigs:d.rigs,masters:d.masters,placements:d.placements,offline:d.offline};})()')); }
    await bindScenario([ids[0].id, (ids[1] || ids[0]).id]);
    const m1 = await capture('S1'); const o1 = await obs();
    const standin1 = o1.masters.perDancer.some((d) => d.source !== 'profile');
    const s1Pass = m1.nonBgLeft >= TH.nonBgPx && m1.nonBgRight >= TH.nonBgPx && !standin1 && o1.rigs === 2;
    state.scenarios.S1 = { name: 'S1-simultaneous', nonBgLeft: m1.nonBgLeft, nonBgRight: m1.nonBgRight, meanAbsDiff: null,
      occupiedZones: ['left', 'right'], standinFallback: standin1, rigs: o1.rigs, background: m1.background,
      perDancer: o1.masters.perDancer, placements: o1.placements, status: s1Pass ? 'PASS' : 'FAIL',
      failReason: s1Pass ? null : 'nonBg>=800 且无替身回落 且 rigs=2 需同时满足（standin=' + standin1 + ', rigs=' + o1.rigs + ')' };
    state.blockedHttp = blocked.length; state.allowedHttp = 0;
    if (cancelAt === 'after-S1') cancel('internal-cancel-hook(after-S1)'); // 确定性中途取消点（S1 已入 state）
    writeJson(path.join(out, 'local-matrix.json'), state); // 渐进落盘：任何中断都保留已完成场景
    if (single) {
      state.scenarios.S2 = { name: 'S2-swap-bindings', nonBgLeft: null, nonBgRight: null, meanAbsDiff: null,
        status: 'SKIP', skipReason: 'single-model：slot1 同时供两位舞者，换绑为恒等变换（差异对照需两个模型）' };
    } else {
      await bindScenario([ids[1].id, ids[0].id]);
      const m2 = await capture('S2'); const o2 = await obs();
      const md = meanAbsDiff(m1, m2);
      const zonesOk = m2.nonBgLeft >= TH.nonBgPx && m2.nonBgRight >= TH.nonBgPx;
      const standin2 = o2.masters.perDancer.some((d) => d.source !== 'profile');
      const s2Pass = zonesOk && md !== null && md >= TH.meanAbsDiff && !standin2;
      state.scenarios.S2 = { name: 'S2-swap-bindings', nonBgLeft: m2.nonBgLeft, nonBgRight: m2.nonBgRight, meanAbsDiff: md,
        occupiedZones: ['left', 'right'], standinFallback: standin2, perDancer: o2.masters.perDancer,
        status: s2Pass ? 'PASS' : 'FAIL',
        failReason: s2Pass ? null : 'zones>=800 且 meanAbsDiff>=1.5 且无替身回落需同时满足（zonesOk=' + zonesOk + ', md=' + md + '）' };
    }
    state.attempts = attempts.slice(0, 40);
    const dh2 = hashDist(), tw2 = twins();
    state.isolation = { allowedHttp: 0, blockedHttp: blocked.length,
      disposableProfile: b.profile.indexOf(path.join(os.tmpdir(), PREFIX)) === 0,
      distBefore: manifest.distTreeSha256, distAfter: dh2.hash, distUnchanged: manifest.distTreeSha256 === dh2.hash,
      twinsIdentical: tw2.identical, note: '一次性 profile（含 IndexedDB）用后即删；产品/仓库/live 根零写入' };
    const s1 = state.scenarios.S1, s2 = state.scenarios.S2;
    state.overall = s1.status === 'PASS' && (s2.status === 'PASS' || s2.status === 'SKIP') && state.isolation.distUnchanged && state.isolation.twinsIdentical ? 'PASS' : 'FAIL';
    state.partial = false;
    writeJson(path.join(out, 'local-matrix.json'), state);
    console.log('[matrix] S1=' + s1.status + '(' + s1.nonBgLeft + '/' + s1.nonBgRight + 'px) S2=' + s2.status + (s2.meanAbsDiff != null ? '(md=' + s2.meanAbsDiff + ')' : '') + ' overall=' + state.overall);
  } finally { b.kill(); }
  process.exit(state.overall === 'PASS' ? 0 : 1);
}

function walkFiles(dir, acc) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of es) { if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else if (e.isFile()) acc.push(p); } }
function walkFilter(dir, acc, depth) { if (depth < 0 || acc.length) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of es) { const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'ChoreoHelper') { acc.push(p); return; } walkFilter(p, acc, depth - 1); } } }
function forbiddenScan(out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const runStart = Date.parse(manifest.createdAt);
  const hashes = new Map(); const sizes = new Set();
  manifest.models.forEach((m) => { hashes.set(m.sha256, m.slot + ':doc'); sizes.add(m.sizeBytes);
    m.companions.forEach((c) => { hashes.set(c.sha256, m.slot + ':companion'); sizes.add(c.sizeBytes); }); });
  const distDir = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
  const roots = [
    { label: 'evidence', path: out, mustExist: true },
    { label: 'repo-tree', path: ROOT, mustExist: true },
    { label: 'live-devplugins-dist', path: process.env.APPDATA ? path.join(process.env.APPDATA, 'XIVLauncherCN', 'devPlugins', 'ChoreoHelper', 'dist') : '(APPDATA 不可用)', mustExist: false }];
  const gameBase = 'D:\\ff14'; const found = [];
  if (fs.existsSync(gameBase)) walkFilter(gameBase, found, 6);
  if (found[0]) roots.push({ label: 'live-game-dist', path: found[0], mustExist: false });
  const tw = twins(); const dh = hashDist();
  const previewUnchanged = tw.sourceSha256 === manifest.previewSourceSha256 && tw.distSha256 === manifest.previewDistSha256 && dh.hash === manifest.distTreeSha256;
  const rootRows = []; let copies = 0, pngInEvidence = 0, nonJsonEvidence = 0;
  const allMatches = []; const preexisting = [];
  for (const r of roots) {
    const row = { label: r.label, path: r.path, status: fs.existsSync(r.path) ? 'scanned' : (r.mustExist ? 'missing' : 'not-present-on-device') };
    if (row.status === 'scanned') {
      const acc = []; walkFiles(r.path, acc); let hashed = 0; const matched = [];
      for (const f of acc) {
        if (r.label === 'evidence') { if (/\.png$/i.test(f)) pngInEvidence++; if (!/\.json$/i.test(f)) nonJsonEvidence++; }
        let st; try { st = fs.statSync(f); } catch (e) { continue; }
        if (!st.isFile() || st.size < 1 || !sizes.has(st.size)) continue; // 字节大小门控后整文件哈希比对
        hashed++; const h = sha256(fs.readFileSync(f));
        if (hashes.has(h)) {
          const insideDist = path.resolve(path.dirname(f)).startsWith(distDir);
          const mtimeBeforeRun = st.mtimeMs < runStart;
          const rec = { file: f, as: hashes.get(h), mtimeBeforeRun };
          matched.push(rec); allMatches.push(rec);
          // 本运行不可能写早于运行起点的文件；dist 树哈希未变再佐证出厂替身
          if (mtimeBeforeRun || (insideDist && previewUnchanged)) preexisting.push(rec);
          else copies++; } }
      row.files = acc.length; row.sizeGatedHashed = hashed; row.matched = matched; }
    rootRows.push(row); }
  const result = { artifact: 'forbidden-scan', ticket: TICKET, revision: 2, createdAt: new Date().toISOString(),
    rule: '整文件 SHA-256 等值（先按字节大小门控）判“模型字节副本”；仅本运行引入的匹配算违规（出厂 dist 树哈希未变且 mtime 早于运行起点=先在产品字节，如实另记）；证据目录仅允许 .json（零 PNG/零二进制）',
    modelHashes: [...hashes.keys()], roots: rootRows, copiesFound: copies,
    preexistingMatches: preexisting,
    preexistingNote: preexisting.length ? '出厂替身 model.bin 与主人本机导出的 .bin 字节相同（先于本运行、dist 树哈希未变）——非本运行复制，作为隐私观察上报主人，本票不改产品' : null,
    pngInEvidence, nonJsonEvidence,
    previewUnchanged, liveGameRootSearched: gameBase + (found[0] ? '' : '（未找到部署根，如实记 not-present）'),
    verdict: copies === 0 && pngInEvidence === 0 && nonJsonEvidence === 0 && previewUnchanged ? 'PASS' : 'FAIL' };
  writeJson(path.join(out, 'forbidden-scan.json'), result);
  console.log('[forbidden] ' + result.verdict + ' copies=' + copies + ' preexisting=' + preexisting.length + ' pngInEvidence=' + pngInEvidence + ' nonJsonEvidence=' + nonJsonEvidence + ' previewUnchanged=' + previewUnchanged);
  if (result.verdict !== 'PASS') process.exit(1);
}
function runChild(args, env, timeoutMs) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env: Object.assign({}, process.env, env || {}), encoding: 'utf8', timeout: timeoutMs || 300000, maxBuffer: 8 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdoutTail: String(r.stdout || '').slice(-400), stderrTail: String(r.stderr || '').slice(-400) }; }
function resilience(out) {
  const res = { artifact: 'resilience', ticket: TICKET, revision: 2, createdAt: new Date().toISOString(), sections: {} };
  const manifestPath = path.join(out, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestShaBefore = sha256(manifestBytes);
  const models = JSON.parse(manifestBytes.toString('utf8')).models;
  const matrixBytesBefore = sha256(fs.readFileSync(path.join(out, 'local-matrix.json')));
  const rehash = () => models.map((m) => { const a = [sha256(fs.readFileSync(m.absPath))];
    m.companions.forEach((c) => a.push(sha256(fs.readFileSync(c.absPath)))); return a; });
  const recorded = () => models.map((m) => [m.sha256].concat(m.companions.map((c) => c.sha256)));
  // 1) 取消：与 SIGINT 处理器同一条 cancel 路径（Windows 三种外部投递均硬终止，平台备注如实记录）
  const cancelRun = runChild([__filename, '--matrix', '--out', out], { CHOREO_REALMODEL_CANCEL_AT: 'after-S1', CHOREO_REALMODEL_CANCEL_AFTER_MS: '' });
  let partial = null; try { partial = JSON.parse(fs.readFileSync(path.join(out, 'local-matrix.cancelled.json'), 'utf8')); } catch (e) {}
  res.sections.cancel = { expectedExit: 130, observedExit: cancelRun.status, signal: cancelRun.signal,
    exitOk: cancelRun.status === 130, partialPreserved: !!(partial && partial.cancelled === true),
    partialScenarioKeys: partial ? Object.keys(partial.scenarios || {}) : null,
    manifestUnchanged: manifestShaBefore === sha256(fs.readFileSync(manifestPath)),
    completedMatrixUnchanged: matrixBytesBefore === sha256(fs.readFileSync(path.join(out, 'local-matrix.json'))),
    modelFilesOnDiskUnchanged: JSON.stringify(rehash()) === JSON.stringify(recorded()),
    distUnchanged: hashDist().hash === JSON.parse(fs.readFileSync(manifestPath, 'utf8')).distTreeSha256,
    pngAfter: (() => { const acc = []; walkFiles(out, acc); return acc.filter((f) => /\.png$/i.test(f)).length; })(),
    platformNote: 'Windows 实测：child.kill("SIGINT")/msys kill -INT/GenerateConsoleCtrlEvent 三路均硬终止、触达不到处理器；探针用内部钩子走与 SIGINT 处理器同一条 cancel() 路径（after-S1 里程碑），交互台真 Ctrl+C 仍走 SIGINT 处理器',
    stderrTail: cancelRun.stderrTail };
  // 2) 并发第二认领：重叠 lockScope 必须非零失败且零败者状态
  const rival = 'RUN-20260909-REALMODEL-LOCAL-TEST-RIVAL';
  const claimRun = runChild(['scripts/pipeline-cli.js', 'claim', '.agent/tickets/' + TICKET + '.json', '--run-id', rival, '--role', 'worker'], null, 60000);
  const rivalManifest = path.join(ROOT, '.agent', 'runs', 'active', rival + '.json');
  const rivalBaseline = path.join(ROOT, '.agent', 'runs', 'baselines', rival);
  res.sections.concurrency = { expectedExit: 'non-zero', observedExit: claimRun.status,
    failedClosed: claimRun.status !== 0 && !fs.existsSync(rivalManifest) && !fs.existsSync(rivalBaseline),
    loserBaselineMutated: fs.existsSync(rivalBaseline), stderrTail: claimRun.stderrTail };
  // 3) 恢复重跑：同输入 manifest-only → matrix（临时目录，repo 外），模型哈希与 PASS/FAIL 复现
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'recover-'));
  try {
    const m2 = runChild([__filename, '--manifest-only', '--out', tmp]);
    const x2 = runChild([__filename, '--matrix', '--out', tmp]);
    const man2 = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
    const mx2 = JSON.parse(fs.readFileSync(path.join(tmp, 'local-matrix.json'), 'utf8'));
    const mx1 = JSON.parse(fs.readFileSync(path.join(out, 'local-matrix.json'), 'utf8'));
    const st = (mx) => ({ S1: mx.scenarios.S1.status, S2: mx.scenarios.S2.status, overall: mx.overall });
    res.sections.recovery = { manifestExit: m2.status, matrixExit: x2.status,
      modelSha256Identical: JSON.stringify(man2.models.map((m) => [m.sha256].concat(m.companions.map((c) => c.sha256)))) === JSON.stringify(recorded()),
      statusIdenticalExcludingCreatedAt: JSON.stringify(st(mx1)) === JSON.stringify(st(mx2)), first: st(mx1), rerun: st(mx2),
      tmpDirOutsideRepo: !path.resolve(tmp).startsWith(ROOT), tmpRemovedLater: true };
  } finally { rmRetry(tmp, null); res.sections.recovery.tmpRemovedLater = !fs.existsSync(tmp); }
  res.sections.retryPolicy = { rule: 'guarded() 每步至多一次确定性重试，两次同指纹即停判 INCONCLUSIVE（SOP §8 同指纹两次熔断的运行层表现）；本运行 repairsUsed=0/1', attempts: attempts.slice(0, 20) };
  const s = res.sections;
  res.verdict = s.cancel.exitOk && s.cancel.partialPreserved && s.cancel.manifestUnchanged && s.cancel.completedMatrixUnchanged && s.cancel.modelFilesOnDiskUnchanged && s.cancel.distUnchanged && s.cancel.pngAfter === 0 &&
    s.concurrency.failedClosed && s.recovery.manifestExit === 0 && s.recovery.matrixExit === 0 && s.recovery.modelSha256Identical && s.recovery.statusIdenticalExcludingCreatedAt ? 'PASS' : 'FAIL';
  writeJson(path.join(out, 'resilience.json'), res);
  console.log('[resilience] ' + res.verdict + ' cancel=' + s.cancel.exitOk + '/' + s.cancel.partialPreserved + ' concurrency=' + s.concurrency.failedClosed + ' recovery=' + s.recovery.statusIdenticalExcludingCreatedAt);
  if (res.verdict !== 'PASS') process.exit(1);
}

process.on('exit', cleanupOwned);
sweepStale();
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : (process.env.CHOREO_REALMODEL_OUT ? path.resolve(process.env.CHOREO_REALMODEL_OUT) : EV_DEFAULT);
if (argv.includes('--manifest-only')) manifestOnly(out);
else if (argv.includes('--matrix')) matrix(out).catch((e) => { console.error('matrix 失败: ' + ((e && e.stack) || e)); process.exit(1); });
else if (argv.includes('--forbidden-scan')) forbiddenScan(out);
else if (argv.includes('--resilience')) resilience(out);
else { console.log('用法: node web/test-realmodel-local.js --manifest-only|--matrix|--forbidden-scan|--resilience [--out <dir>]（env: CHOREO_REALMODEL_1 必填 / CHOREO_REALMODEL_2 选填 / CHOREO_REALMODEL_OUT 选填 / CHOREO_REALMODEL_CANCEL_AT=after-S1 取消探针钩子）'); process.exit(2); }
