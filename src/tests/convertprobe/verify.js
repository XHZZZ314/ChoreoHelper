// 资源转换探针校验器：records/oracle/scope 三门独立重算，不信任 probe 内 verdict。
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const EVID = path.join(ROOT, '.agent', 'evidence', 'TASK-20260909-RESOURCE-CONVERT-PROBE');
const PROBE = path.join(EVID, 'probe.json'), BASE = path.join(EVID, 'scope-baseline.json');
const METRICS = ['resourceLocation', 'duration', 'skeletonBinding', 'rootMotion', 'loop', 'quality', 'time', 'size'];
const STAGES = ['lookup', 'container', 'decode', 'binding', 'measurement', 'complete'];
const STATS = ['measured', 'failed', 'unknown', 'unavailable'];
function ss(v) { if (Array.isArray(v)) return '[' + v.map(ss).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + ss(v[k])).join(',') + '}'; return JSON.stringify(v); }
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const shaStr = s => sha(Buffer.from(s, 'utf8'));
function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
// 绝对路径探针：构造时拆串，避免自身被检出；文本提及 .pap 不算泄漏。
function leakOfText(t) {
  if (/[A-Za-z]:(?:\\|\/){1,2}/.test(t)) return 'drive-path';
  if (/\\{2,}[A-Za-z0-9]/.test(t)) return 'unc-path';
  const h1 = '/ho' + 'me/', h2 = '/Use' + 'rs/', h3 = '/tm' + 'p/', h4 = '/va' + 'r/';
  if (t.includes(h1) || t.includes(h2) || t.includes(h3) || t.includes(h4)) return 'posix-path';
  return null;
}
function leakOfObj(o) {
  let hit = null;
  (function walk(v) {
    if (hit) return;
    if (typeof v === 'string') { const l = leakOfText(v); if (l) hit = l + ':' + v.slice(0, 24); return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  })(o);
  return hit;
}
function verdictFor(a, b) {
  if (a.status === 'failed') return 'routeA-failed';
  if (b.status === 'unavailable') return 'routeB-unavailable';
  if (a.status !== 'measured' || b.status !== 'measured') return 'unknown';
  if (a.unit !== b.unit || a.method !== b.method) return 'unknown';
  return ss(a.value) === ss(b.value) ? 'match' : 'mismatch';
}
function checkMetric(m, loc) {
  const e = [];
  if (!m || typeof m !== 'object') return [loc + ':not-object'];
  if (!STATS.includes(m.status)) e.push(loc + ':bad-status');
  if (m.status !== 'measured' && m.value !== null) e.push(loc + ':value-must-be-null');
  if (typeof m.unit !== 'string' || !m.unit) e.push(loc + ':bad-unit');
  if (typeof m.method !== 'string' || !m.method) e.push(loc + ':bad-method');
  if (typeof m.methodVersion !== 'string' || !m.methodVersion) e.push(loc + ':bad-methodVersion');
  if (!('inputHash' in m) && !('inputUnavailableReason' in m)) e.push(loc + ':no-input-bind');
  if (typeof m.stage !== 'string' || !m.stage) e.push(loc + ':bad-stage');
  if (typeof m.reason !== 'string' || !m.reason) e.push(loc + ':bad-reason');
  if (typeof m.value === 'number' && (!Number.isFinite(m.value) || m.value < 0)) e.push(loc + ':bad-number');
  return e;
}
function validateProbe(p, expectN) {
  const e = [];
  if (!p || p.schemaVersion !== 1) e.push('schema');
  if (p.ticketId !== 'TASK-20260909-RESOURCE-CONVERT-PROBE' || p.ticketRevision !== 2) e.push('ticket');
  const lk = leakOfObj(p);
  if (lk) e.push('leak:' + lk);
  const samples = p.samples || [];
  if (samples.length !== expectN) e.push('samples-count:' + samples.length);
  const ids = samples.map(s => s.id);
  if (new Set(ids).size !== ids.length) e.push('samples-dup');
  const cls = samples.map(s => s.class).sort().join(',');
  if (expectN === 5 && cls !== 'loop,once,posture,skill-phase,weapon-held') e.push('samples-class:' + cls);
  if (new Set(samples.map(s => s.skeleton && s.skeleton.identity)).size < 2) e.push('samples-skeleton');
  for (const s of samples) {
    if (!s.catalogId || !s.kind || !s.name) e.push('sample-fields:' + s.id);
    if (s.class === 'skill-phase' && !s.phase) e.push('sample-phase:' + s.id);
    if (s.command == null && !s.nonCommandReason) e.push('sample-command:' + s.id);
    if (s.command != null && s.nonCommandReason != null) e.push('sample-command-both:' + s.id);
    if (!s.skeleton || !s.skeleton.identity || !s.skeleton.class) e.push('sample-skel:' + s.id);
    if (!s.library || !s.library.availability || !s.library.evidence) e.push('sample-lib:' + s.id);
    if (!s.provenance) e.push('sample-prov:' + s.id);
    if (s.synthetic === true && expectN === 5) e.push('sample-synthetic-in-real:' + s.id);
  }
  let h = '';
  try { h = shaStr(ss(samples)); } catch { e.push('samples-hash'); }
  if (h && p.sampleSetHash !== h) e.push('sampleSetHash');
  for (const [key, arr] of [['routeA', p.routeA], ['routeB', p.routeB]]) {
    if (!Array.isArray(arr) || arr.length !== expectN) { e.push(key + '-count'); continue; }
    const aids = arr.map(r => r.sampleId);
    if (new Set(aids).size !== aids.length) e.push(key + '-dup');
    for (const s of samples) if (!aids.includes(s.id)) e.push(key + '-missing:' + s.id);
    for (const r of arr) {
      if (!ids.includes(r.sampleId) && expectN === 5) e.push(key + '-foreign:' + r.sampleId);
      if (r.sampleSetHash !== p.sampleSetHash) e.push(key + '-stale-hash:' + r.sampleId);
      if (!r.attemptId) e.push(key + '-attempt:' + r.sampleId);
      for (const m of METRICS) e.push(...checkMetric(r.metrics && r.metrics[m], key + '.' + r.sampleId + '.' + m));
    }
  }
  if (Array.isArray(p.routeA)) for (const r of p.routeA) {
    if (!STAGES.includes(r.terminalStage)) e.push('routeA-stage:' + r.sampleId);
    if (!r.gameVersion || !r.converter || !r.converter.id || !r.converter.version) e.push('routeA-prov:' + r.sampleId);
    if ((r.terminalStage === 'lookup' || r.terminalStage === 'container') && r.metrics) {
      for (const m of ['duration', 'skeletonBinding', 'rootMotion', 'loop', 'quality']) {
        const q = r.metrics[m];
        if (q && q.status === 'measured') e.push('routeA-header-quality:' + r.sampleId + '.' + m);
      }
    }
  }
  if (Array.isArray(p.routeB)) for (const r of p.routeB) {
    if (!['reused', 'new', 'unavailable'].includes(r.mode)) e.push('routeB-mode:' + r.sampleId);
    const s = samples.find(x => x.id === r.sampleId);
    if (s && r.skeletonIdentity && r.skeletonIdentity !== s.skeleton.identity) e.push('routeB-skel-mismatch:' + r.sampleId);
    if (r.mode === 'reused') {
      if (!r.clipHash) e.push('routeB-clip:' + r.sampleId);
      if (s && r.skeletonIdentity !== s.skeleton.identity) e.push('routeB-skel-mismatch:' + r.sampleId);
      if (s && (r.phase || null) !== (s.phase || null)) e.push('routeB-phase-mismatch:' + r.sampleId);
    }
    if (r.mode === 'new' && !r.ownerReportRef) e.push('routeB-report:' + r.sampleId);
    if (r.mode === 'unavailable') {
      if (!r.followUp) e.push('routeB-followup:' + r.sampleId);
      for (const m of METRICS) { const q = r.metrics && r.metrics[m]; if (q && q.status === 'measured') e.push('routeB-fabricated:' + r.sampleId + '.' + m); }
    }
  }
  const comp = p.comparison || [];
  if (!Array.isArray(comp) || comp.length !== expectN * 8) e.push('comparison-count:' + comp.length);
  else {
    const keys = comp.map(c => c.sampleId + '|' + c.metric);
    if (new Set(keys).size !== keys.length) e.push('comparison-dup');
    for (const s of samples) for (const m of METRICS) if (!keys.includes(s.id + '|' + m)) e.push('comparison-missing:' + s.id + '|' + m);
    const am = Object.fromEntries((p.routeA || []).map(r => [r.sampleId, r]));
    const bm = Object.fromEntries((p.routeB || []).map(r => [r.sampleId, r]));
    for (const c of comp) {
      const a = am[c.sampleId] && am[c.sampleId].metrics[c.metric], b = bm[c.sampleId] && bm[c.sampleId].metrics[c.metric];
      if (!a || !b) { e.push('comparison-orphan:' + c.sampleId + '|' + c.metric); continue; }
      const want = verdictFor(a, b);
      if (c.verdict !== want) e.push('comparison-verdict:' + c.sampleId + '|' + c.metric + ':want-' + want);
      const bothNum = typeof a.value === 'number' && typeof b.value === 'number';
      const exp = (want === 'match' || want === 'mismatch') ? (bothNum ? Math.abs(b.value - a.value) : 0) : null;
      if (c.delta !== exp) e.push('comparison-delta:' + c.sampleId + '|' + c.metric);
      if ((want === 'routeA-failed' || want === 'routeB-unavailable' || want === 'unknown') && (c.verdict === 'match')) e.push('comparison-missing-as-match:' + c.sampleId);
    }
  }
  const cf = p.cacheIdentityProposal && p.cacheIdentityProposal.fields;
  if (!p.cacheIdentityProposal || p.cacheIdentityProposal.schemaOnly !== true || !Array.isArray(cf)) e.push('cache-shape');
  else {
    const names = cf.map(f => f.name);
    if (new Set(names).size !== names.length) e.push('cache-dup');
    const needNames = ['sourceIdentity', 'contentHash', 'skeletonIdentity', 'bindingMapVersion', 'converterVersion', 'gameResourceVersion', 'qualityCheckVersion', 'qualityResult'];
    for (const n of needNames) if (!names.includes(n)) e.push('cache-cover:' + n);
    for (const f of cf) if (!f.name || !f.purpose) e.push('cache-field:' + (f.name || '?'));
  }
  if (p.winner != null || /route [ab] (wins|won|selected)/i.test(JSON.stringify(p.notes || ''))) e.push('winner-declared');
  return e;
}
function records(input) {
  const p = load(input || PROBE);
  const errs = validateProbe(p, 5);
  const groups = { 'CP-SAMPLES': errs.filter(x => /sample|Hash/i.test(x)), 'CP-A': errs.filter(x => /^routeA/i.test(x)), 'CP-B': errs.filter(x => /^routeB/i.test(x)), 'CP-MATRIX': errs.filter(x => /comparison|cache|winner|delta/i.test(x)) };
  for (const [k, v] of Object.entries(groups)) console.log((v.length ? 'FAIL ' : 'OK ') + k + (v.length ? ' ' + v.slice(0, 3).join(';') : ''));
  const other = errs.filter(x => !Object.values(groups).flat().includes(x));
  if (other.length) console.log('FAIL CP-RECORDS-OTHER ' + other.slice(0, 3).join(';'));
  console.log(errs.length ? `records: ${errs.length} errors` : 'records: 5/5 samples 40/40 cells hash-bound');
  return errs.length ? 1 : 0;
}
function makeFixture() {
  const samples = [
    { id: 'F-001', class: 'once', catalogId: 'catalog:t/f-01', kind: 'emote', name: 'F1', phase: null, command: '/a', nonCommandReason: null, skeleton: { identity: 'skel:A', class: 'A' }, library: { availability: 'missing', evidence: 'idx:miss' }, provenance: 'test' },
    { id: 'F-002', class: 'loop', catalogId: 'catalog:t/f-02', kind: 'dance', name: 'F2', phase: null, command: null, nonCommandReason: 'no-cmd', skeleton: { identity: 'skel:B', class: 'B' }, library: { availability: 'missing', evidence: 'idx:miss' }, provenance: 'test' }
  ];
  const M = (status, value, unit, method) => ({ status, value, unit, method, methodVersion: '1', inputUnavailableReason: 'test', stage: 'decode', reason: 'test' });
  const routeA = [
    { sampleId: 'F-001', sampleSetHash: '', attemptId: 'A1', terminalStage: 'complete', gameVersion: 'g', converter: { id: 'h', version: '1', options: 'o' }, inputUnavailableReason: 'test', metrics: { resourceLocation: M('measured', 'loc', 'none', 'm1'), duration: M('measured', 100, 'ms', 'm1'), skeletonBinding: M('measured', 3, 'count', 'm1'), rootMotion: M('measured', 1.5, 'm', 'm1'), loop: M('measured', 'no', 'none', 'm1'), quality: M('measured', 0.5, 'none', 'm1'), time: M('measured', 2, 'ms', 'm1'), size: M('measured', 10, 'bytes', 'm1') } },
    { sampleId: 'F-002', sampleSetHash: '', attemptId: 'A2', terminalStage: 'decode', gameVersion: 'g', converter: { id: 'h', version: '1', options: 'o' }, inputUnavailableReason: 'test', metrics: { resourceLocation: M('failed', null, 'none', 'm1'), duration: M('failed', null, 'ms', 'm1'), skeletonBinding: M('failed', null, 'count', 'm1'), rootMotion: M('measured', 1, 'm', 'm1'), loop: M('measured', 'x', 'none', 'm1'), quality: M('failed', null, 'none', 'm1'), time: M('measured', 2, 'ms', 'm1'), size: M('failed', null, 'bytes', 'm1') } }
  ];
  const routeB = [
    { sampleId: 'F-001', sampleSetHash: '', attemptId: 'B1', mode: 'reused', clipHash: 'ab12', gameVersion: 'g', skeletonIdentity: 'skel:A', phase: null, ownerReportRef: null, followUp: null, metrics: { resourceLocation: M('measured', 'loc', 'none', 'm1'), duration: M('measured', 100, 'ms', 'm1'), skeletonBinding: M('measured', 3, 'count', 'm1'), rootMotion: M('measured', 1.5, 'm', 'm2'), loop: M('measured', 'no', 'none', 'm2'), quality: M('measured', 0.5, 'none', 'm1'), time: M('measured', 9, 'ms', 'm1'), size: M('measured', 10, 'bytes', 'm1') } },
    { sampleId: 'F-002', sampleSetHash: '', attemptId: 'B2', mode: 'unavailable', clipHash: null, gameVersion: null, skeletonIdentity: 'skel:B', phase: null, ownerReportRef: null, followUp: 'owner:pending', metrics: { resourceLocation: M('unavailable', null, 'none', 'm1'), duration: M('unavailable', null, 'ms', 'm1'), skeletonBinding: M('unavailable', null, 'count', 'm1'), rootMotion: M('unavailable', null, 'm', 'm1'), loop: M('unavailable', null, 'none', 'm1'), quality: M('unavailable', null, 'none', 'm1'), time: M('unavailable', null, 'ms', 'm1'), size: M('unavailable', null, 'bytes', 'm1') } }
  ];
  const h = shaStr(ss(samples));
  routeA.forEach(r => r.sampleSetHash = h); routeB.forEach(r => r.sampleSetHash = h);
  const mm = Object.fromEntries(routeA.map(r => [r.sampleId, r]));
  const nn = Object.fromEntries(routeB.map(r => [r.sampleId, r]));
  const comparison = [];
  for (const s of samples) for (const m of METRICS) {
    const a = mm[s.id].metrics[m], b = nn[s.id].metrics[m];
    const v = verdictFor(a, b);
    const bothNum = typeof a.value === 'number' && typeof b.value === 'number';
    comparison.push({ sampleId: s.id, metric: m, routeAStatus: a.status, routeBStatus: b.status, routeAValue: a.value, routeBValue: b.value, routeAMethod: a.method, routeBMethod: b.method, unit: a.unit, delta: (v === 'match' || v === 'mismatch') ? (bothNum ? Math.abs(b.value - a.value) : 0) : null, verdict: v });
  }
  return { schemaVersion: 1, ticketId: 'TASK-20260909-RESOURCE-CONVERT-PROBE', ticketRevision: 2, sampleSetHash: h, samples, routeA, routeB, comparison, cacheIdentityProposal: load(PROBE).cacheIdentityProposal, attempts: [], notes: 'fixture' };
}
function selftest() {
  let pass = 0, fail = 0;
  const ok = (id, cond, d) => { if (cond) { pass++; console.log('  OK  ' + id); } else { fail++; console.log('  FAIL ' + id + ' ' + (d || '')); } };
  const base = makeFixture();
  ok('oracle:positive-valid', validateProbe(base, 2).length === 0, validateProbe(base, 2).slice(0, 2).join(';'));
  const mut = (id, fn, want) => { const c = JSON.parse(ss(base)); fn(c); const errs = validateProbe(c, 2); ok(id, errs.some(x => x.includes(want)), errs.slice(0, 2).join(';')); };
  mut('oracle:dup-row-same-count', c => { c.comparison[0].sampleId = c.comparison[1].sampleId; c.comparison[0].metric = c.comparison[1].metric; }, 'comparison-dup');
  mut('oracle:absent-b', c => { delete c.routeB; }, 'routeB-count');
  mut('oracle:foreign-id', c => { c.routeA[0].sampleId = 'F-X'; }, 'routeA');
  mut('oracle:missing-id', c => { c.routeA = c.routeA.slice(1); }, 'routeA-count');
  mut('oracle:wrong-skel-reuse', c => { c.routeB[0].skeletonIdentity = 'skel:B'; }, 'routeB-skel');
  mut('oracle:stale-hash', c => { c.routeA[0].sampleSetHash = '00'; }, 'stale-hash');
  mut('oracle:fabricated-zero', c => { c.routeB[1].metrics.time = { status: 'unavailable', value: 0, unit: 'ms', method: 'library-reuse', methodVersion: '1', inputUnavailableReason: 'x', stage: 'lookup', reason: 'x' }; }, 'value-must-be-null');
  mut('oracle:nonfinite', c => { c.routeA[0].metrics.duration.value = Infinity; }, 'bad-number');
  mut('oracle:path-leak', c => { c.samples[0].provenance = String.fromCharCode(67) + ':' + String.fromCharCode(92) + 'secret'; }, 'leak');
  mut('oracle:unknown-to-match', c => { const r = c.comparison.find(x => x.verdict === 'unknown'); r.verdict = 'match'; }, 'comparison-verdict');
  mut('oracle:inverted-verdict', c => { const r = c.comparison.find(x => x.verdict === 'match'); r.verdict = 'mismatch'; }, 'comparison-verdict');
  mut('oracle:partial-report', c => { c.comparison = c.comparison.slice(0, 8); }, 'comparison-count');
  mut('oracle:missing-cache', c => { c.cacheIdentityProposal.fields = c.cacheIdentityProposal.fields.slice(1); }, 'cache-cover');
  const real = validateProbe(load(PROBE), 5);
  ok('oracle:real-probe-passes', real.length === 0, real.slice(0, 2).join(';'));
  console.log(`oracle: ${pass} passed / ${fail} failed`);
  return fail ? 1 : 0;
}
function scope() {
  const errs = [];
  const say = (id, bad, d) => { console.log((bad ? 'FAIL ' : 'OK ') + id + (bad && d ? ' ' + String(d).slice(0, 120) : '')); if (bad) errs.push(id); };
  let snap = null;
  try { snap = load(BASE); } catch (e) { say('CP-SCOPE-baseline', true, 'unreadable'); return 1; }
  let listed = [];
  try { listed = cp.execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch { say('CP-SCOPE-list', true, 'git-failed'); return 1; }
  const isEx = p => (snap.exclusions || []).some(x => p === x || p.startsWith(x));
  const cur = {};
  for (const p of listed.sort()) {
    if (isEx(p)) continue;
    const abs = path.join(ROOT, p);
    try { if (!fs.statSync(abs).isFile()) continue; cur[p] = sha(fs.readFileSync(abs)); } catch {}
  }
  const old = snap.files || {};
  const added = Object.keys(cur).filter(k => !(k in old)), removed = Object.keys(old).filter(k => !(k in cur));
  const changed = Object.keys(cur).filter(k => (k in old) && old[k] !== cur[k]);
  const allow = p => p.startsWith('src/tests/convertprobe/') || p.startsWith('.agent/evidence/TASK-20260909-RESOURCE-CONVERT-PROBE/') || p.startsWith('.agent/modules/plugin-product/changes/') || p.startsWith('.agent/runs/');
  say('CP-SCOPE-no-delete', removed.length > 0, removed.slice(0, 3).join(','));
  say('CP-SCOPE-new-in-scope', !added.every(allow), added.filter(p => !allow(p)).slice(0, 3).join(','));
  say('CP-SCOPE-changed-in-scope', !changed.every(allow), changed.filter(p => !allow(p)).slice(0, 3).join(','));
  const lock = p => p.startsWith('src/tests/convertprobe/') || p.startsWith('.agent/evidence/TASK-20260909-RESOURCE-CONVERT-PROBE/');
  const lockFiles = [...added, ...changed].filter(lock);
  say('CP-SCOPE-budget-files', lockFiles.length > 12, lockFiles.length);
  let lines = 0;
  for (const p of lockFiles) { try { const t = fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n'); lines += t[t.length - 1] === '' ? t.length - 1 : t.length; } catch {} }
  say('CP-SCOPE-budget-lines', lines > 900, lines);
  let csj = '';
  try { csj = fs.readFileSync(path.join(ROOT, '.agent', 'runs', 'active', 'RUN-20260909-RESOURCE-CONVERT-PROBE.json'), 'utf8'); } catch {}
  let want = '';
  try { want = JSON.parse(csj).contextFiles.find(f => f.path === 'src/ChoreoHelper.csproj').sha256; } catch {}
  let got = '';
  try { got = sha(fs.readFileSync(path.join(ROOT, 'src', 'ChoreoHelper.csproj'))); } catch {}
  say('CP-SCOPE-csproj-hash', !want || got !== want, got.slice(0, 12));
  let plugin = '';
  try { plugin = fs.readFileSync(path.join(ROOT, 'src', 'ChoreoHelper.csproj'), 'utf8'); } catch {}
  say('CP-SCOPE-csproj-excludes-tests', !/Compile Remove=.tests/.test(plugin));
  let cpj = '';
  try { cpj = fs.readFileSync(path.join(ROOT, 'src', 'tests', 'convertprobe', 'convertprobe.csproj'), 'utf8'); } catch {}
  say('CP-SCOPE-probe-isolated', /ChoreoHelper|Dalamud|Exporter|papparser/i.test(cpj), 'ref-leak');
  const allowExt = ['.cs', '.csproj', '.js', '.json', '.md'];
  const badExt = lockFiles.filter(p => !allowExt.includes(path.extname(p).toLowerCase()));
  say('CP-SCOPE-allowlist-ext', badExt.length > 0, badExt.slice(0, 3).join(','));
  let leak = null, payload = null;
  for (const p of lockFiles) {
    if (p === '.agent/evidence/TASK-20260909-RESOURCE-CONVERT-PROBE/scope-baseline.json') continue;
    let raw = '';
    try { raw = fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { continue; }
    if (raw.includes('\0')) { leak = p + ':binary'; break; }
    const l = leakOfText(raw);
    if (l) { leak = p + ':' + l; break; }
    if (p.endsWith('.json') && /"(keyframes|transforms|clipBytes|payload|boneMatrices)"\s*:/.test(raw)) { payload = p; break; }
  }
  say('CP-SCOPE-no-abs-path', !!leak, leak);
  say('CP-SCOPE-no-payload', !!payload, payload);
  console.log(`scope: baseline=${Object.keys(old).length} current=${Object.keys(cur).length} lockFiles=${lockFiles.length} lines=${lines}`);
  console.log(`scope: baseline-sha=${sha(fs.readFileSync(BASE)).slice(0, 12)} probe-sha=${(() => { try { return sha(fs.readFileSync(PROBE)).slice(0, 12); } catch { return 'missing'; } })()}`);
  return errs.length ? 1 : 0;
}
const a = process.argv.slice(2);
if (a.includes('--records')) { const i = a.indexOf('--input'); process.exit(records(i >= 0 ? a[i + 1] : null)); }
if (a.includes('--self-test')) process.exit(selftest());
if (a.includes('--scope')) process.exit(scope());
if (a.includes('--write-baseline')) {
  const excl = ['.git/', 'src/tests/convertprobe/bin/', 'src/tests/convertprobe/obj/', 'src/tests/datalayertest/bin/', 'src/tests/datalayertest/obj/', 'src/tests/pluginlifecycletest/bin/', 'src/tests/pluginlifecycletest/obj/', 'node_modules/', '.agent/runs/baselines/', '.agent/runs/active/', '.agent/runs/history/', '.agent/evidence/TASK-20260909-RESOURCE-CONVERT-PROBE/logs/'];
  const listed = cp.execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = {};
  for (const p of listed.sort()) { if (excl.some(x => p === x || p.startsWith(x))) continue; const abs = path.join(ROOT, p); try { if (!fs.statSync(abs).isFile()) continue; files[p] = sha(fs.readFileSync(abs)); } catch {} }
  fs.writeFileSync(BASE, JSON.stringify({ schemaVersion: 1, ticketId: 'TASK-20260909-RESOURCE-CONVERT-PROBE', ticketRevision: 2, createdAt: new Date().toISOString(), exclusions: excl, files }));
  console.log('baseline files:' + Object.keys(files).length);
  process.exit(0);
}
console.log('usage: verify.js --records [--input f] | --self-test | --scope');
process.exit(2);
