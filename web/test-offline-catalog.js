// 离线目录生成器回归：导入 helper 不联网、不生成文件，技能基础值仅保留可信完整输入。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const source = process.env.CHOREO_OFFLINE_ASSETS_SOURCE || path.join(__dirname, '../scripts/make-offline-assets.js');
let network = 0, writes = 0, passed = 0, failed = 0;
const ctx = { require(name) { if (name === 'fs') return { ...fs, writeFileSync() { writes++; throw Error('test forbids file writes'); } }; return require(name); },
  module: { exports: {} }, __dirname: path.join(__dirname, '../scripts'), process, console,
  fetch() { network++; return new Promise(() => {}); } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(source, 'utf8'), ctx);
const slim = ctx.module.exports.slimAction || ctx.slimAction;
const metadata = { version: 1, actionId: 120, castMs: 1500, recastMs: 2500, requiredLevel: 2, maxCharges: 0, range: 25, effectRange: 0 };
const action = { id: 120, type: 'action', name: '治疗', jobName: '幻术师', duration: 1.5, staticMetadata: metadata };
const plain = value => JSON.parse(JSON.stringify(value));
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }
test('require only exposes helpers with zero network and zero writes', () => { assert.equal(network, 0); assert.equal(writes, 0); assert.equal(typeof ctx.module.exports.slimAction, 'function'); });
test('valid Action identity and complete static metadata survive slimming', () => { const got = slim(action); assert.equal(got.type, 'action'); assert.deepEqual(plain(got.staticMetadata), metadata); });
test('catalog target rules retain all supplied fields without defaults', () => { const targetRules = { version: 1, actionId: 120, self: true, party: false, opaque: { declared: 'source' } }; assert.deepEqual(plain(slim({ ...action, targetRules }).targetRules), targetRules); assert.equal(slim(action).targetRules, undefined); });
test('real zero cast remains zero, not confused with missing', () => { assert.equal(slim({ ...action, staticMetadata: { ...metadata, castMs: 0 } }).staticMetadata.castMs, 0); });
test('missing metadata never inferred from duration', () => { assert.equal(slim({ ...action, staticMetadata: undefined }).staticMetadata, undefined); });
test('partial metadata is not promoted to complete', () => { assert.equal(slim({ ...action, staticMetadata: { version: 1, actionId: 120, castMs: 0 } }).staticMetadata, undefined); });
test('foreign metadata identity is rejected', () => { assert.equal(slim({ ...action, staticMetadata: { ...metadata, actionId: 121 } }).staticMetadata, undefined); });
test('invalid numeric metadata is rejected without coercion', () => { for (const value of [-1, Infinity, NaN, '0', 86400001]) assert.equal(slim({ ...action, staticMetadata: { ...metadata, castMs: value } }).staticMetadata, undefined); });
test('missing/other type never fabricated as a real Action', () => { for (const type of [undefined, 'emote']) { const got = slim({ ...action, type }); assert.equal(got.type, type); assert.equal(got.staticMetadata, undefined); } });
console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
