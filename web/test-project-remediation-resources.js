// 资源整改回归：检查导航的非定位项零副作用、资料库错误解释及离线动作包唯一入口。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
let passed = 0, failed = 0;
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this._text = ''; this.isConnected = true; this.listeners = {}; }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); this.children.splice(this.children.indexOf(ref), 0, n); n.parentNode = this; return n; }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; n.isConnected = false; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this[k] = v; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  querySelector(q) { return all(this).find(n => q[0] === '.' ? n.className === q.slice(1) : n.tagName === q) || null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set innerHTML(value) { this._text = ''; this.children = []; }
}
function all(n) { return n.children.flatMap(c => [c, ...all(c)]); }
function setup(issues = []) {
  const body = new Node('body'), badge = new Node('button'), side = { stop: 0, seek: 0, render: 0, library: 0 };
  badge.id = 'btnCheck'; body.appendChild(badge);
  const selected = { id: 'kept' }, clip = { id: 'clip-a' };
  const store = { projectId: 'p', contentExtra: {}, _docRev: 1, previewTarget: 'game', isPlaying: true, currentTime: 12, selectedClip: selected,
    dancers: [{ actionClips: [clip], switchClips: [], lyricClips: [] }], globalLyrics: [], checkIssues: issues, pps: 60 };
  const ctx = { store, _projectOperation: 0, LABEL_W: 80, document: { body, createElement: tag => new Node(tag), createTextNode: text => { const n = new Node('#text'); n.textContent = text; return n; }, getElementById: id => all(body).find(n => n.id === id) },
    currentProjectOperation: () => true, ChoreoCheck: { pure: { check: () => issues } },
    el(tag, cls, text) { const n = new Node(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; },
    stopPlay() { side.stop++; }, sendSeek() { side.seek++; }, render() { side.render++; }, updatePlayhead() {}, updateTimeDisplay() {},
    selectClipOnly(c) { store.selectedClip = c; }, showLibraryModal() { side.library++; }, showToast() {}, setTimeout, clearTimeout };
  ctx.window = ctx; vm.createContext(ctx);
  function load(file) { vm.runInContext(fs.readFileSync(path.join(process.env.CHOREO_RESOURCES_SOURCE || __dirname, file), 'utf8'), ctx); }
  return { ctx, body, badge, side, selected, clip, store, load };
}
async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }
(async () => {
  await test('global no-skeleton issue has guidance and cannot stop, seek or clear selection', async () => {
    const s = setup([{ level: 'red', rule: 'no-skeleton', di: -1, t: 0, message: '资料库里没有参考骨架' }]); s.load('choreo-check-ui.js'); s.ctx.showCheckModal(); await tick();
    const row = all(s.body).find(n => n.title && n.textContent.includes('资料库里没有参考骨架'));
    assert.ok(row); if (row.onclick) row.onclick();
    assert.deepEqual(s.side, { stop: 0, seek: 0, render: 0, library: 0 }); assert.equal(s.store.currentTime, 12); assert.equal(s.store.selectedClip, s.selected);
    assert.match(row.textContent, /不影响.*离线编排/); const nav = all(row).find(n => n.tagName === 'button' && /资料库/.test(n.textContent)); assert.ok(nav); nav.onclick({ stopPropagation() {} }); assert.equal(s.side.library, 1);
  });
  await test('other global item stays static; actual global timestamp still jumps', async () => {
    for (const [rule, t, jumps] of [['caps-old-plugin', 0, false], ['unsupported-kind', 0, true], ['unsupported-kind', 2, true]]) { const s = setup([{ level: 'info', rule, di: -1, t, message: '全局事项' }]); s.load('choreo-check-ui.js'); s.ctx.showCheckModal(); await tick(); const row = all(s.body).find(n => n.title && n.textContent.includes('全局事项')); assert.ok(row); if (row.onclick) row.onclick(); assert.equal(s.side.seek, jumps ? 1 : 0); assert.equal(s.store.currentTime, jumps ? t : 12); }
  });
  await test('dancer clip at zero still selects/jumps; dancer name displayed once', async () => {
    const s = setup([{ level: 'yellow', rule: 'missing-clip', di: 0, clipId: 'clip-a', t: 0, message: '舞者1 的动作尚未录制' }]); s.load('choreo-check-ui.js'); s.ctx.showCheckModal(); await tick(); const row = all(s.body).find(n => n.title === '点击跳到这个位置'); assert.ok(row); assert.equal((row.textContent.match(/舞者1/g) || []).length, 1); row.onclick(); assert.equal(s.side.seek, 1); assert.equal(s.store.selectedClip, s.clip);
  });
  await test('badge separates button text while keeping severity counts', () => { const s = setup([{ level: 'red' }, { level: 'yellow' }]); s.load('choreo-check-ui.js'); s.ctx.updateCheckBadge(); assert.match(s.badge.textContent, /^ · 红1 黄1$/); });
  await test('adaptive sizes preserve nonzero small files', () => { const s = setup(); s.load('choreo-library-ui.js'); assert.equal(s.ctx.fmtMB(0), '0 B'); assert.equal(s.ctx.fmtMB(42), '42 B'); assert.equal(s.ctx.fmtMB(2048), '2.0 KB'); assert.equal(s.ctx.fmtMB(1048576), '1.0 MB'); });
  await test('network failures explained without claiming proven offline; unrelated errors retained', () => { const s = setup(); s.load('choreo-library-ui.js'); const f = s.ctx.libraryImportError; assert.equal(typeof f, 'function'); for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) { const got = f(new TypeError(message)); assert.match(got, /无法连接.*插件/); assert.match(got, /可能/); assert.doesNotMatch(got, /Failed to fetch/); } assert.match(f(new Error('HTTP 403：配对码无效')), /HTTP 403：配对码无效/); assert.match(f(new TypeError('Cannot read properties of undefined')), /Cannot read properties/); });
  await test('real library panel has one independent pack input; XAT stays separate', () => { const s = setup(); s.load('choreo-xat-convert-ui.js'); s.load('choreo-library-ui.js'); const panel = s.ctx.buildLibraryPanel(); const packs = all(panel).filter(n => n.className === 'lib-offline-pack'); assert.equal(packs.length, 1); assert.equal(packs[0].parentNode, panel); assert.equal(all(panel).filter(n => n.accept === '.gz,.json').length, 1); assert.equal(packs[0].tagName, 'section'); assert.doesNotMatch(panel.textContent, /\bentry\b/); });
  console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
})();
