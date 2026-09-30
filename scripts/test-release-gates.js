// test-release-gates.js — release-gates.js（FIX-K 发布完整性与隐私门）的回归套件
//
// 干嘛的：锁死打包验收规则的行为——大小写/斜杠变体命中、二进制 DLL 扫描、README 文档化
//        豁免只对 README 生效、禁文件小写比较、libs 显式清单核对、zip 解包与 staged 目录
//        逐字节核对。纯 node，无游戏/网络依赖。跑法：D:\nodejs\node.exe scripts\test-release-gates.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const g = require('./release-gates.js');

let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else console.log('  ✘ ' + name);
}
function tmpdir(name) {
  const d = path.join(os.tmpdir(), 'choreo-test-releasegates-' + name + '-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
// 仓库根用样例值：模式集必须参数化，不硬编码任何真实检出路径
const PATS = g.buildPatterns('D:\\sample\\reporoot');

console.log('— patternVariants / buildPatterns —');
check('反斜杠模式展开出小写正斜杠变体', g.patternVariants('C:\\Users').indexOf('c:/users') >= 0);
check('反斜杠模式展开出双反斜杠变体（JSON 转义形态）', g.patternVariants('C:\\Users').indexOf('c:\\\\users') >= 0);
check('模式集含基础模式与仓库根的小写形态', PATS.indexOf('appdata') >= 0 && PATS.indexOf('d:/sample/reporoot') >= 0);

console.log('— scanText：变体命中 —');
check('正斜杠 c:/users 命中', g.scanText('a.js', 'fetch("C:/Users/xhz/photo")', PATS).length === 1);
check('大写 C:\\USERS 命中', g.scanText('a.js', 'path = "C:\\\\USERS\\\\me"', PATS).length === 1);
check('双反斜杠 C:\\\\Users（JSON 转义）命中', g.scanText('a.json', '{"p":"C:\\\\Users\\\\me"}', PATS).length === 1);
check('appdata 大写命中', g.scanText('a.js', 'const P = "%APPDATA%\\\\x"', PATS).length === 1);
check('xivlaunchercn 小写命中', g.scanText('a.js', '// see xivlaunchercn', PATS).length === 1);
check('仓库根路径（构建机检出位置）命中', g.scanText('x.pdb', 'D:\\\\SAMPLE\\\\REPOROOT\\\\src\\\\obj\\\\a.pdb', PATS).length === 1);
check('命中项带文件名与模式', (function () {
  const h = g.scanText('lib/app.js', 'C:/Users/x', PATS)[0];
  return h && h.file === 'lib/app.js' && h.pattern === 'c:/users';
})());

console.log('— scanText：不误伤产品契约 —');
check('localhost:48794/48795 是产品 API 契约，不算泄漏', g.scanText('a.js', 'http://localhost:48794 and http://localhost:48795/export/list', PATS).length === 0);
check('产品名 ChoreoHelper 自身不算泄漏', g.scanText('a.js', 'ChoreoHelper v0.7.1', PATS).length === 0);

console.log('— scanText：README 豁免语义 —');
const readmeBody = '安装：把 ChoreoHelper 文件夹放进 %AppData%\\XIVLauncherCN\\devPlugins\\，'
  + '前提：橙月启动器（XIVLauncherCN）+ 已装 Dalamud。';
check('README 的文档化安装术语不命中', g.scanText('README.txt', readmeBody, PATS).length === 0);
check('README 豁免之外的残留泄漏仍命中', g.scanText('README.txt', readmeBody + ' 反馈给 C:/Users/admin', PATS).length === 1);
check('同样的 AppData 术语出现在非 README 文件即命中', (function () {
  const hits = g.scanText('app.js', '%AppData%\\XIVLauncherCN\\devPlugins', PATS);
  return hits.length === 2 && hits.some(function (h) { return h.pattern === 'appdata'; }) && hits.some(function (h) { return h.pattern === 'xivlaunchercn'; });
})());

console.log('— forbiddenFileHits：小写比较 —');
check('大写 CLIP-CHECK.HTML 被拦', g.forbiddenFileHits(['CLIP-CHECK.HTML']).length === 1);
check('子目录里的 test-engine.js 被拦', g.forbiddenFileHits(['sub/dir/test-engine.js']).length === 1);
check('正常产品文件不拦', g.forbiddenFileHits(['choreo-app.js', 'libs/three.module.js', 'model.gltf']).length === 0);

console.log('— inventoryDiff：libs 显式清单 —');
const INV = ['libs/three.module.js', 'libs/loaders/GLTFLoader.js', 'libs-classic/three.classic.js'];
check('清单外文件（误投放）报 unexpected', (function () {
  const d = g.inventoryDiff(['libs/three.module.js', 'libs/loaders/GLTFLoader.js', 'libs-classic/three.classic.js', 'libs/stray.txt'], INV);
  return d.unexpected.length === 1 && d.unexpected[0] === 'libs/stray.txt' && d.missing.length === 0;
})());
check('缺文件报 missing', (function () {
  const d = g.inventoryDiff(['libs/three.module.js'], INV);
  return d.missing.length === 2 && d.unexpected.length === 0;
})());
check('完全一致时两者皆空', (function () {
  const d = g.inventoryDiff(INV.slice(), INV);
  return d.missing.length === 0 && d.unexpected.length === 0;
})());

console.log('— scanTree：二进制文件同标准 —');
const t1 = tmpdir('scan');
put(t1, 'clean.js', 'window.__X__ = 1;');
// 造一个"DLL"：非 UTF8 字节 + 内嵌 PDB 构建路径（模拟 CodeView 调试条目）
const fakeDll = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0xfe, 0xff]), Buffer.from('RSDS\0\0\0\0D:\\sample\\reporoot\\src\\obj\\x64\\Release\\ChoreoHelper.pdb', 'latin1')]);
fs.writeFileSync(path.join(t1, 'fake.dll'), fakeDll);
(function () {
  const r = g.scanTree(t1, PATS);
  check('内嵌构建路径的 DLL 被扫出（二进制 latin1）', r.scanned === 2 && r.hits.length === 1 && r.hits[0].file === 'fake.dll');
})();
(function () {
  const t2 = tmpdir('cleantree');
  put(t2, 'a.js', 'ok'); put(t2, 'sub/b.css', 'body{}');
  const r = g.scanTree(t2, PATS);
  check('干净树 0 命中且计数正确', r.scanned === 2 && r.hits.length === 0);
  fs.rmSync(t2, { recursive: true, force: true });
})();
fs.rmSync(t1, { recursive: true, force: true });

console.log('— diffTreeFiles：zip 解包核对 —');
(function () {
  const A = tmpdir('treeA'), B = tmpdir('treeB');
  put(A, 'a.js', 'v1'); put(A, 'sub/b.js', 'bb'); put(A, 'README.txt', readmeBody);
  put(B, 'a.js', 'v1'); put(B, 'sub/b.js', 'bb'); put(B, 'README.txt', readmeBody);
  check('内容一致的树零差异', (function () {
    const d = g.diffTreeFiles(A, B);
    return d.missing.length === 0 && d.unexpected.length === 0 && d.changed.length === 0;
  })());
  fs.writeFileSync(path.join(B, 'a.js'), 'v2');
  fs.rmSync(path.join(B, 'sub/b.js'));
  put(B, 'extra.txt', 'x');
  const d = g.diffTreeFiles(A, B);
  check('字节不同报 changed', d.changed.length === 1 && d.changed[0] === 'a.js');
  check('少文件报 missing', d.missing.length === 1 && d.missing[0] === 'sub/b.js');
  check('多文件报 unexpected', d.unexpected.length === 1 && d.unexpected[0] === 'extra.txt');
  fs.rmSync(A, { recursive: true, force: true }); fs.rmSync(B, { recursive: true, force: true });
})();

console.log('— sha256 —');
check('sha256 已知向量 abc', g.sha256Text('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

console.log('— XAT 分发授权开关（TASK-20260917-SIMPLE-CHOREO-XAT-BUNDLE）：未授权拒绝、授权携带、fail-safe —');
(function () {
  const A = tmpdir('xat-unauth');
  put(A, 'choreo-app.js', 'ok');
  put(A, 'tools/xat/distribution-authorization.json', '{"status":"unauthorized"}');
  const s = g.readXatAuthorization(A);
  check('unauthorized 开关读出 unauthorized', s.present && s.status === 'unauthorized' && !s.malformed);
  const hits = g.xatToolsHits(g.walk(A));
  check('tools/ 子目录条目被 xatToolsHits 找出', hits.length === 1 && hits[0] === 'tools/xat/distribution-authorization.json');
  check('非 tools 路径不误报', g.xatToolsHits(['choreo-app.js', 'libs/three.module.js']).length === 0);
  fs.rmSync(A, { recursive: true, force: true });
})();
(function () {
  const A = tmpdir('xat-auth');
  put(A, 'tools/xat/distribution-authorization.json', '{"status":"authorized"}');
  check('authorized 开关读出 authorized', g.readXatAuthorization(A).status === 'authorized');
  fs.rmSync(A, { recursive: true, force: true });
})();
(function () {
  const A = tmpdir('xat-missing');
  put(A, 'choreo-app.js', 'ok');
  const s = g.readXatAuthorization(A);
  check('开关缺失按 unauthorized（fail-safe，缺证不放行）', !s.present && s.status === 'unauthorized');
  fs.rmSync(A, { recursive: true, force: true });
  const B = tmpdir('xat-broken');
  put(B, 'tools/xat/distribution-authorization.json', 'not-json{');
  const s2 = g.readXatAuthorization(B);
  check('开关损坏按 unauthorized（fail-safe）', s2.present && s2.malformed && s2.status === 'unauthorized');
  fs.rmSync(B, { recursive: true, force: true });
  const C = tmpdir('xat-wrongfield');
  put(C, 'tools/xat/distribution-authorization.json', '{"status":"Authorized"}');
  check('status 大小写不符按 unauthorized（只认精确 authorized）', g.readXatAuthorization(C).status === 'unauthorized');
  fs.rmSync(C, { recursive: true, force: true });
})();
check('钉死 XAT 字节按 sha256 命中（防改名混入）', (function () {
  const h = g.xatByteHits({ 'stray/tool.exe': g.XAT_PINNED_SHA256, 'choreo-app.js': '00' });
  return h.length === 1 && h[0] === 'stray/tool.exe';
})());
check('普通文件不触发钉死哈希命中', g.xatByteHits({ 'choreo-app.js': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }).length === 0);
check('钉死哈希常量与合同 r1 一致', g.XAT_PINNED_SHA256 === 'f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2');
check('真实 dist 开关当前为 unauthorized（公开包拒绝 tools/）', g.readXatAuthorization(path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper')).status === 'unauthorized');

console.log(pass + '/' + total);
if (pass !== total) process.exit(1);
