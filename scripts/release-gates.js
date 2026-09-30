// release-gates.js — FIX-K 发布完整性与隐私门的纯判定逻辑
//
// 干嘛的：把 make-release-staging.js 的验收规则收敛成无副作用、可单测的纯函数，
//        打包脚本和 scripts\test-release-gates.js 回归套件共用同一条代码路径：
//          • 隐私扫描：任意进包文件（含 DLL 等二进制）按 latin1 字节扫描；
//            模式大小写不敏感、正反斜杠（\ / \\）等价；额外覆盖仓库检出根路径。
//          • README 豁免：README.txt 里明确写出的安装说明术语（%AppData%\XIVLauncherCN\devPlugins
//            等）按文档化术语豁免——只豁免 README，且豁免后剩余内容仍走全量扫描。
//          • 禁文件名单按小写比较（老实现区分大小写，TEST-ENGINE.JS 能溜进去）。
//          • libs 目录显式清单：inventoryDiff 发现清单外文件/缺文件，拒绝"整目录盲拷"。
//          • diffTreeFiles：zip 解包内容与 staged 目录逐文件 sha256 核对（zip 是压缩流，
//            直接扫 zip 字节不可靠，必须解包验）。
// 无 Dalamud/游戏/网络依赖，node 直接可测。
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 基础隐私模式：命中任何进包文件即失败。localhost:48794/48795 是产品自身 API 契约，不算泄漏。
// D:\choreo = 属主私人盘工具/模型根（TASK-20260925-PROJECT-REMEDIATION §7 P0：旧版动作包 v1 清单
// 真实嵌入过 D:/choreo/... 绝对路径；它是检出根 D:\choreohelper 的前缀，属 fail-closed 方向，可接受）。
const BASE_PATTERNS = ['C:\\Users', 'AppData', 'XIVLauncherCN', 'ChoreoExports', 'Administrator', 'D:\\choreo'];

// README.txt 安装说明里明确允许的文档化术语（只豁免 README.txt；其余文件出现即命中——
// 它们本身就是 AppData/XIVLauncherCN 的子串，走基础模式天然被拦）。
const README_ALLOWED_TERMS = ['%AppData%\\XIVLauncherCN\\devPlugins', 'XIVLauncherCN'];

// 进包禁文件（按小写文件名比较）：诊断页与测试套件绝不随包发布。
// TASK-20260925-PROJECT-REMEDIATION §7 P0 增补：部署根现存的 cur-* 重复件、两个浏览器测试件
// 与 model.glb（代码偏好名）——白名单本就不放行，这里补第二道断言。
const FORBIDDEN = [
  'model.bin', 'model.glb', 'mode-check.html', 'clip-check.html', 'library-check.html',
  'jscheck.html', 'p3d-check.html', 'p3d-trace.html',
  'test-engine.js', 'test-projects.js', 'test-edit.js', 'test-check.js',
  'test-shell.js',
  'cur-document.js', 'cur-engine.js', 'cur-preview3d.js',
  'test-content-faces-browser.js', 'test-tools-center-browser.js',
];

// XAT 随包携带（TASK-20260917-SIMPLE-CHOREO-XAT-BUNDLE）：公开门禁的"分发授权开关"与钉死字节判定。
// 开关 = web/dist/ChoreoHelper/tools/xat/distribution-authorization.json 的 status 字段（单一数据文件，
// 属主取得授权证据后翻转，不需要改打包/调用代码）；status 不为 'authorized'（含文件缺失/损坏）
// 一律按未授权处理——缺证永不放行。钉死哈希 = 合同 r1 锁定的本地固定副本字节。
const XAT_PINNED_SHA256 = 'f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2';
const XAT_TOOLS_PREFIX = 'tools/';

function readXatAuthorization(distRoot) {
  // 返回 { present, status, malformed }：合法 JSON 且 status==='authorized' 才是 authorized，
  // 其余（含 ENOENT/解析失败）一律 unauthorized（fail-safe）。
  try {
    const raw = fs.readFileSync(path.join(distRoot, 'tools', 'xat', 'distribution-authorization.json'), 'utf8');
    const doc = JSON.parse(raw);
    const status = doc && doc.status === 'authorized' ? 'authorized' : 'unauthorized';
    return { present: true, status: status, malformed: false };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false, status: 'unauthorized', malformed: false };
    return { present: true, status: 'unauthorized', malformed: true };
  }
}

function xatToolsHits(relList) {
  // staged 树中任何 tools/ 子目录条目；授权开关未翻转时出现即拒绝进入公开包。
  return relList.filter(function (rel) { return rel.indexOf(XAT_TOOLS_PREFIX) === 0; });
}

function xatByteHits(filesBySha) {
  // { 相对路径: sha256 } 中出现钉死 XAT 字节即命中——防白名单外字节改名混入公开包的第二道断言。
  const hits = [];
  for (const rel of Object.keys(filesBySha)) {
    if (filesBySha[rel] === XAT_PINNED_SHA256) hits.push(rel);
  }
  return hits;
}

function fail(msg) { console.error('✘ ' + msg); process.exit(1); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function walk(dir, base) {
  base = base || dir;
  let out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

// 模式 → 匹配变体：小写 + 反斜杠/正斜杠/双反斜杠互转（JSON 转义与 URL 形式都拦）。
function patternVariants(pat) {
  const forms = new Set([pat, pat.replace(/\\/g, '/'), pat.replace(/\\/g, '\\\\'), pat.replace(/\//g, '\\')]);
  return Array.from(forms).map(function (f) { return f.toLowerCase(); });
}

// 扫描模式集 = 基础模式 + 仓库检出根（动态：任何检出位置的构建路径都算本机路径）。
function buildPatterns(repoRoot) {
  const pats = BASE_PATTERNS.slice();
  if (repoRoot) pats.push(repoRoot);
  const out = [];
  for (const p of pats) { for (const v of patternVariants(p)) if (out.indexOf(v) < 0) out.push(v); }
  return out;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isReadme(relName) { return path.posix.basename(relName).toLowerCase() === 'readme.txt'; }

// 单文件内容扫描：latin1 字符串进，命中列表出。README 先按文档化术语豁免再全量扫。
function scanText(relName, content, patterns) {
  const lower = content.toLowerCase();
  const residue = isReadme(relName)
    ? README_ALLOWED_TERMS.reduce(function (acc, term) {
      return acc.replace(new RegExp(escapeRegExp(term.toLowerCase()), 'gi'), '');
    }, lower)
    : lower;
  const hits = [];
  for (const pat of patterns) {
    if (residue.indexOf(pat) >= 0) hits.push({ file: relName, pattern: pat });
  }
  return hits;
}

// 整目录扫描：所有文件一律按二进制（latin1）读，文本/二进制同标准。
function scanTree(dir, patterns) {
  const hits = [];
  const rels = walk(dir);
  for (const rel of rels) {
    const buf = fs.readFileSync(path.join(dir, rel));
    for (const h of scanText(rel, buf.toString('latin1'), patterns)) hits.push(h);
  }
  return { scanned: rels.length, hits: hits };
}

// 禁文件检查：小写比较，返回违规相对路径。
function forbiddenFileHits(relList) {
  const lower = FORBIDDEN.map(function (f) { return f.toLowerCase(); });
  return relList.filter(function (rel) {
    return lower.indexOf(path.posix.basename(rel).toLowerCase()) >= 0;
  });
}

// 显式清单核对：actual（walk 出的相对路径集合）vs expected（清单，正斜杠相对路径）。
function inventoryDiff(actualRels, expectedRels) {
  const actual = new Set(actualRels);
  const expected = new Set(expectedRels);
  const missing = expectedRels.filter(function (r) { return !actual.has(r); }).sort();
  const unexpected = actualRels.filter(function (r) { return !expected.has(r); }).sort();
  return { missing: missing, unexpected: unexpected };
}

// 两棵目录树逐文件核对（sha256），用于 zip 解包内容 == staged 目录 的证明。
function diffTreeFiles(dirA, dirB) {
  const a = walk(dirA), b = walk(dirB);
  const setA = new Set(a), setB = new Set(b);
  const missing = a.filter(function (r) { return !setB.has(r); });
  const unexpected = b.filter(function (r) { return !setA.has(r); });
  const changed = [];
  for (const rel of a) {
    if (!setB.has(rel)) continue;
    if (sha256(path.join(dirA, rel)) !== sha256(path.join(dirB, rel))) changed.push(rel);
  }
  return { missing: missing, unexpected: unexpected, changed: changed.sort() };
}

module.exports = {
  BASE_PATTERNS: BASE_PATTERNS,
  README_ALLOWED_TERMS: README_ALLOWED_TERMS,
  FORBIDDEN: FORBIDDEN,
  XAT_PINNED_SHA256: XAT_PINNED_SHA256,
  readXatAuthorization: readXatAuthorization,
  xatToolsHits: xatToolsHits,
  xatByteHits: xatByteHits,
  sha256: sha256,
  sha256Text: sha256Text,
  walk: walk,
  patternVariants: patternVariants,
  buildPatterns: buildPatterns,
  scanText: scanText,
  scanTree: scanTree,
  forbiddenFileHits: forbiddenFileHits,
  inventoryDiff: inventoryDiff,
  diffTreeFiles: diffTreeFiles,
  fail: fail,
};
