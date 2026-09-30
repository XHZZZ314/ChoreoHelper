// make-skeleton-pack.js — DANCER-AUTOADAPT（AC-7/AC-8）：离线 18 族基础骨架包生成
//
// 干嘛的：游戏不开，用 sqpack 只读提取 + 产品同款转换链，把 18 个奇数主代码
//        （c0101–c1801，b0001）的基础骨架做成一个 dist 生成资产 skeleton-pack.js
//        （挂 window.__CHOREO_SKELETON_PACK__），网页离线时按种族码建任意族档案。
// 链路（与插件内 XatClipConverter 完全同口径，Node 复刻）：
//   sqpack-extract 只读提取 SKLB+单 entry bt_common PAP → 容器剥离（XatHavokUnwrap 等价移植）
//   → XATHavokInterop.exe addSkeleton + toFbxAnimation（钉死哈希先验，45s/调用超时）
//   → FBX 窄解析取骨架（XatFbxClipReader 骨架子集等价移植）
// 内置断言（AC-7）：同一族用两个不同 PAP 各跑一遍链路，骨架 JSON 必须逐字段一致
//   （证实"骨架 JSON 与所用动画无关"假设）；失败即停报，不降级不静默。
// 逐族状态显式登记：成功/失败+原因全部写 manifest（含每族来源路径与 sha256），
//   失败不静默省略；全部成功才写 dist 资产，任一失败退出码非零。
// 幂等：产物内容只由游戏数据决定（无时间戳），重跑字节一致。
// 怎么跑：D:\nodejs\node.exe scripts\make-skeleton-pack.js
//   [--sqpack-extract <sqpack-extract.js 路径>]（默认 D:/choreo/p0-scan-20260916/sqpack-extract.js）
//   [--keys <actiontimeline.tsv 路径>]（默认与 sqpack-extract 同目录）
// 何时重跑：游戏大版本更新后。产物是生成物，直接写进 web\dist\ChoreoHelper\，不手改。
'use strict';
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
const OUT_DEFAULT = path.join(DIST, 'skeleton-pack.js');
const MANIFEST_DEFAULT = path.join(ROOT, '.agent', 'evidence', 'TASK-20260917-DANCER-AUTOADAPT', 'skeleton-pack-manifest.json');
const TOOLS = path.join(DIST, 'tools', 'xat');
const EXE = path.join(TOOLS, 'XATHavokInterop.exe');
const EXE_SHA256 = 'f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2'; // 与产品钉死值一致（XatClipConverter.PinnedExeSha256）
const PER_CALL_TIMEOUT_MS = 45000;
// a2 全 18 矩阵里有 bt_common 命中的奇数主代码（TASK 合同前置事实 6/8）
const TRIBE_CODES = ['c0101', 'c0201', 'c0301', 'c0401', 'c0501', 'c0601', 'c0701', 'c0801', 'c0901',
  'c1001', 'c1101', 'c1201', 'c1301', 'c1401', 'c1501', 'c1601', 'c1701', 'c1801'];
const PAPS_PER_TRIBE = 2; // 一份进包 + 一份做一致性断言

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function fail(msg) { console.error('生成失败：' + msg); process.exit(1); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// ---- 容器剥离（src/XatHavokUnwrap.cs 等价移植：口径一致，不支持即显式抛错） ----
function readPapHeader(b) {
  if (b.length < 26 || b.toString('latin1', 0, 4) !== 'pap ') throw new Error('Invalid PAP header');
  return { count: b.readInt16LE(8), skeleton: b.readInt32LE(10), info: b.readInt32LE(14), start: b.readInt32LE(18), end: b.readInt32LE(22) };
}
function unwrapPap(b) {
  const h = readPapHeader(b);
  if (h.count !== 1 || !(26 <= h.info && h.info < h.start && h.start < h.end && h.end <= b.length))
    throw new Error('Unsupported PAP container');
  return b.subarray(h.start, h.end);
}
function unwrapSklb(b) {
  if (b.length < 16 || b.toString('latin1', 0, 4) !== 'blks') throw new Error('Invalid SKLB header');
  const v = b.readUInt16LE(6);
  if (v !== 0x3132 && v !== 0x3133) throw new Error('Unsupported SKLB version');
  const start = v === 0x3132 ? b.readUInt16LE(10) : b.readInt32LE(12);
  if (!(12 <= start && start < b.length)) throw new Error('Unsupported SKLB payload offsets');
  return b.subarray(start);
}

// ---- XAT 固定轴欧拉（角度制）→ 四元数（src/XatFbxClipReader.EulerXyzStatic 等价移植） ----
function eulerXyzStatic(deg) {
  const x = deg[0] * Math.PI / 360, y = deg[1] * Math.PI / 360, z = deg[2] * Math.PI / 360;
  const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

// ---- FBX Binary 窄解析（版本 7100–7499；只取骨架，动作轨道不解析） ----
function readFbx(data) {
  if (data.length < 27 || data.toString('latin1', 0, 23) !== 'Kaydara FBX Binary  \x00\x1a\x00')
    throw new Error('Invalid FBX header');
  const version = data.readUInt32LE(23);
  if (version < 7100 || version >= 7500) throw new Error('unsupported FBX version ' + version);
  const nodes = [];
  let offset = 27;
  for (;;) {
    const r = parseNode(data, offset);
    if (!r.node) break;
    nodes.push(r.node);
    offset = r.next;
  }
  return nodes;
}
function parseNode(data, offset) {
  if (offset + 13 > data.length) throw new Error('truncated FBX node header');
  const end = data.readUInt32LE(offset), count = data.readUInt32LE(offset + 4), propsize = data.readUInt32LE(offset + 8), nlen = data[offset + 12];
  if (end === 0) return { node: null, next: offset + 13 };
  if (!(offset < end && end <= data.length && count < 10000)) throw new Error('invalid FBX node bounds');
  offset += 13;
  if (offset + nlen > data.length) throw new Error('truncated FBX node name');
  const name = data.toString('utf8', offset, offset + nlen);
  offset += nlen;
  const values = [];
  const propEnd = offset + propsize;
  if (propEnd > data.length) throw new Error('invalid FBX property block size');
  for (let i = 0; i < count; i++) {
    if (offset >= data.length) throw new Error('truncated FBX property');
    const kind = String.fromCharCode(data[offset]); offset += 1;
    if ('fdlibc'.indexOf(kind) >= 0) {
      if (offset + 12 > data.length) throw new Error('truncated FBX array header');
      const size = data.readUInt32LE(offset), encoding = data.readUInt32LE(offset + 4), nbytes = data.readUInt32LE(offset + 8);
      offset += 12;
      if (size > 10000000 || (encoding !== 0 && encoding !== 1) || offset + nbytes > data.length)
        throw new Error('invalid FBX array property');
      let buf = data.subarray(offset, offset + nbytes);
      offset += nbytes;
      if (encoding === 1) buf = zlib.inflateSync(buf);
      const elemSize = (kind === 'f' || kind === 'i') ? 4 : (kind === 'd' || kind === 'l') ? 8 : 1;
      if (buf.length !== size * elemSize) throw new Error('FBX array payload length mismatch');
      const arr = new Array(size);
      for (let j = 0; j < size; j++) {
        if (kind === 'f') arr[j] = buf.readFloatLE(j * 4);
        else if (kind === 'd') arr[j] = buf.readDoubleLE(j * 8);
        else if (kind === 'l') arr[j] = buf.readBigInt64LE(j * 8);
        else if (kind === 'i') arr[j] = buf.readInt32LE(j * 4);
        else if (kind === 'b') arr[j] = buf[j] !== 0;
        else arr[j] = buf[j];
      }
      values.push(arr);
    } else if (kind === 'Y') { values.push(data.readInt16LE(offset)); offset += 2; }
    else if (kind === 'C') { values.push(data[offset] !== 0); offset += 1; }
    else if (kind === 'I') { values.push(data.readInt32LE(offset)); offset += 4; }
    else if (kind === 'F') { values.push(data.readFloatLE(offset)); offset += 4; }
    else if (kind === 'D') { values.push(data.readDoubleLE(offset)); offset += 8; }
    else if (kind === 'L') { values.push(data.readBigInt64LE(offset)); offset += 8; }
    else if (kind === 'S' || kind === 'R') {
      const size = data.readUInt32LE(offset); offset += 4;
      if (offset + size > data.length) throw new Error('truncated FBX string/raw property');
      const raw = data.subarray(offset, offset + size); offset += size;
      values.push(kind === 'S' ? raw.toString('utf8') : Buffer.from(raw));
    } else throw new Error('unsupported FBX property ' + kind);
  }
  if (offset !== propEnd) throw new Error('FBX property block overrun');
  const children = [];
  while (offset < end) {
    const r = parseNode(data, offset);
    if (r.node) children.push(r.node);
    offset = r.next;
  }
  if (offset !== end) throw new Error('FBX node bounds mismatch');
  return { node: { name, values, children }, next: offset };
}
function child(n, name) {
  for (const c of n.children) if (c.name === name) return c;
  throw new Error('missing FBX node ' + name);
}
function idOf(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  throw new Error('FBX object id expected');
}
function num(v) {
  if (typeof v === 'number') return v;
  throw new Error('FBX scalar expected');
}
// FBX → 骨架 JSON（{count,bones:[{i,n,p,t,q,s}]}，与产品 XatFbxClipReader 同形）
function fbxToSkeleton(fbx) {
  let objects = null, connections = null;
  for (const n of fbx) {
    if (n.name === 'Objects') objects = n;
    else if (n.name === 'Connections') connections = n;
  }
  if (!objects || !connections) throw new Error('FBX missing Objects/Connections');
  const objs = objects.children, conns = connections.children;
  const byId = new Map();
  for (const o of objs) byId.set(String(idOf(o.values[0])), o);
  const parents = new Map();
  for (const c of conns) {
    if (c.values[0] !== 'OO') continue;
    const childId = String(idOf(c.values[1]));
    const target = byId.get(childId);
    if (target && target.name === 'Model') parents.set(childId, String(idOf(c.values[2])));
  }
  const skeleton = [], idToIndex = new Map();
  for (const model of objs) {
    if (model.name !== 'Model') continue;
    const mid = String(idOf(model.values[0]));
    const boneName = String(model.values[1]).split('\0')[0];
    const props = new Map();
    for (const p of child(model, 'Properties70').children)
      props.set(String(p.values[0]), p.values.slice(4));
    // XAT 输出无枢轴/预后旋转；出现即超出已证缝，显式拒绝（与产品口径一致）
    for (const key of ['PreRotation', 'PostRotation', 'RotationOffset', 'RotationPivot', 'ScalingOffset', 'ScalingPivot']) {
      const pivot = props.get(key);
      if (pivot && pivot.some((v) => num(v) !== 0)) throw new Error('unsupported ' + key);
    }
    const order = props.get('RotationOrder');
    if (order && num(order[0]) !== 0) throw new Error('unsupported RotationOrder');
    const index = skeleton.length;
    idToIndex.set(mid, index);
    const vec = (xs) => [num(xs[0]), num(xs[1]), num(xs[2])];
    const t = props.has('Lcl Translation') ? vec(props.get('Lcl Translation')) : [0, 0, 0];
    const r = props.has('Lcl Rotation') ? vec(props.get('Lcl Rotation')) : [0, 0, 0];
    let s = props.has('Lcl Scaling') ? vec(props.get('Lcl Scaling')) : [1, 1, 1];
    if (s.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('invalid reference scale ' + boneName);
    const pid = parents.get(mid);
    skeleton.push({ i: index, n: boneName, p: (pid && idToIndex.has(pid)) ? idToIndex.get(pid) : -1, t, q: eulerXyzStatic(r), s });
  }
  if (!skeleton.length) throw new Error('FBX has no Model nodes');
  return { count: skeleton.length, bones: skeleton };
}

// ---- 转换器调用（钉死哈希先验；cwd=临时目录，与产品 RealIO 同形） ----
function invokeExe(args, workDir) {
  const r = spawnSync(EXE, args, { cwd: workDir, timeout: PER_CALL_TIMEOUT_MS, windowsHide: true,
    encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') throw new Error('转换器单次调用超过 45s（超时）');
    throw new Error('转换器启动失败：' + r.error.message);
  }
  if (r.status === 0xc0000135 || r.status === 0xc0000139 || (r.status !== null && r.status < 0 && (r.status & 0xffffffff) === 0xc0000135))
    throw new Error('VC++ 2012 x86 运行库缺失（退出码 0x' + (r.status >>> 0).toString(16) + '）');
  if (r.status !== 0) {
    const txt = ((r.stdout || Buffer.alloc(0)).toString('utf8') + ' ' + (r.stderr || Buffer.alloc(0)).toString('utf8')).trim();
    throw new Error('转换器失败（退出码 ' + r.status + '）：' + (txt.length > 200 ? txt.slice(0, 200) + '…' : txt));
  }
}
// SKLB+PAP → 骨架 JSON（两步子进程缝；workDir 里写 animation.hkt/skeleton.hkt）
function convertToSkeleton(sklbBytes, papBytes, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const animationPath = path.join(workDir, 'animation.hkt');
  const skeletonPath = path.join(workDir, 'skeleton.hkt');
  const combinedPath = path.join(workDir, 'combined.hkt');
  const fbxPath = path.join(workDir, 'animation.fbx');
  fs.writeFileSync(animationPath, unwrapPap(papBytes));
  fs.writeFileSync(skeletonPath, unwrapSklb(sklbBytes));
  invokeExe(['addSkeleton', animationPath, skeletonPath, '0', combinedPath], workDir);
  invokeExe(['toFbxAnimation', combinedPath, '0', '0', fbxPath], workDir);
  return fbxToSkeleton(readFbx(fs.readFileSync(fbxPath)));
}

// ---- main ----
(function main() {
  const sqpackPath = arg('--sqpack-extract', process.env.CHOREO_SQPACK_EXTRACT || 'D:/choreo/p0-scan-20260916/sqpack-extract.js');
  const keysPath = arg('--keys', path.join(path.dirname(sqpackPath), 'actiontimeline.tsv'));
  const outPath = arg('--out', OUT_DEFAULT);
  const manifestPath = arg('--manifest', MANIFEST_DEFAULT);
  if (!fs.existsSync(sqpackPath)) fail('sqpack-extract 工具不可用：' + sqpackPath + '（合同停止条件：工具/路径不可用=记阻塞，不改在线获取）');
  if (!fs.existsSync(keysPath)) fail('键清单不可用：' + keysPath);
  if (!fs.existsSync(EXE)) fail('随包转换器缺失：' + EXE);
  const exeHash = sha256(fs.readFileSync(EXE));
  if (exeHash !== EXE_SHA256) fail('转换器哈希与钉死值不符（' + exeHash.slice(0, 12) + '…），拒绝执行未知二进制');

  const sq = require(sqpackPath);
  if (!sq.SQPACK_ROOT || !fs.existsSync(sq.SQPACK_ROOT)) fail('本机游戏 sqpack 根不可用：' + sq.SQPACK_ROOT);
  console.log('加载 sqpack 索引（只读）：' + sq.SQPACK_ROOT);
  sq.loadAll();
  function extractOrNull(gamePath) {
    const { hits } = sq.findByPath(gamePath);
    if (!hits.length) return null;
    try { return sq.extract(hits[0].chunk, hits[0].entry); } catch (e) { throw new Error('提取失败 ' + gamePath + '：' + e.message); }
  }

  const keys = fs.readFileSync(keysPath, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((l) => (l.split('\t')[1] || '').trim()).filter((k) => k.length > 0);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-skeleton-pack-'));
  const manifest = {
    schema: 1, generatedAt: new Date().toISOString(), exeSha256: exeHash,
    sqpackExtract: sqpackPath, keysSource: keysPath, keyCount: keys.length,
    assertion: '同族两个不同单 entry PAP → 骨架 JSON 逐字段一致（AC-7）',
    papsPerTribe: PAPS_PER_TRIBE, tribes: [], allOk: false,
  };
  const tribes = [];
  let failures = 0;
  try {
    for (const code of TRIBE_CODES) {
      const rec = { code, status: 'pending' };
      manifest.tribes.push(rec);
      try {
        const sklbPath = 'chara/human/' + code + '/skeleton/base/b0001/skl_' + code + 'b0001.sklb';
        const sklb = extractOrNull(sklbPath);
        if (!sklb) throw new Error('SKLB 未命中：' + sklbPath);
        rec.sklb = { path: sklbPath, bytes: sklb.length, sha256: sha256(sklb) };
        // 候选单 entry PAP：按键清单顺序命中即取（与 a2 矩阵同口径），直到凑够 PAPS_PER_TRIBE 个
        const paps = [];
        for (const key of keys) {
          if (paps.length >= PAPS_PER_TRIBE) break;
          const papPath = 'chara/human/' + code + '/animation/a0001/bt_common/' + key + '.pap';
          const { hits } = sq.findByPath(papPath);
          if (!hits.length) continue;
          let pap;
          try { pap = sq.extract(hits[0].chunk, hits[0].entry); } catch (e) { continue; /* 该键提取失败不算族失败：继续下一键 */ }
          const header = readPapHeader(pap);
          if (header.count !== 1) continue; // 多 entry：不猜切分，换下一键
          paps.push({ key, path: papPath, bytes: pap.length, sha256: sha256(pap), buf: pap });
        }
        if (paps.length < PAPS_PER_TRIBE)
          throw new Error('单 entry bt_common PAP 候选不足（找到 ' + paps.length + '/' + PAPS_PER_TRIBE + '），无法做一致性断言');
        rec.paps = paps.map((p) => ({ key: p.key, path: p.path, bytes: p.bytes, sha256: p.sha256 }));
        // 转换链 ×N：第一个进包，其余只做一致性断言
        const skeletons = paps.map((p, i) =>
          convertToSkeleton(sklb, p.buf, path.join(tempRoot, code + '-' + i)));
        const canonical = JSON.stringify(skeletons[0]);
        const mismatch = skeletons.findIndex((s, i) => i > 0 && JSON.stringify(s) !== canonical);
        if (mismatch >= 0)
          fail('AC-7 一致性断言失败：' + code + ' 用「' + paps[0].key + '」与「' + paps[mismatch].key + '」两个不同 PAP 产出骨架 JSON 不一致'
            + '——"骨架 JSON 与动画无关"假设被证伪，按合同停报属主定生成口径（本族之后的族未继续）');
        rec.assertConsistent = true;
        rec.count = skeletons[0].count;
        rec.skeletonSha256 = sha256Text(canonical);
        rec.status = 'ok';
        tribes.push({ code: code, label: code + ' 基础身形', count: skeletons[0].count, skeleton: skeletons[0] });
        console.log('  ✓ ' + code + '：' + rec.count + ' 骨（断言 PAP：' + paps.map((p) => p.key).join(' / ') + '）');
      } catch (e) {
        failures++;
        rec.status = 'failed';
        rec.reason = e.message;
        console.error('  ✗ ' + code + '：' + e.message);
      }
    }
    manifest.allOk = failures === 0;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1), 'utf8');
    if (failures) fail(failures + ' 个族生成失败（逐族原因已写 ' + path.relative(ROOT, manifestPath) + '；dist 资产未写，不静默出部分包）');
    const payload = '// 离线 18 族基础骨架包（scripts\\make-skeleton-pack.js 生成，勿手改；重跑刷新）\n'
      + '// 生成链=游戏文件只读提取→产品同款转换链；每族经"两个不同 PAP 骨架一致"断言\n'
      + 'window.__CHOREO_SKELETON_PACK__ = ' + JSON.stringify({ schema: 1, tribes: tribes }) + ';\n';
    fs.writeFileSync(outPath, payload, 'utf8');
    console.log('完成：' + tribes.length + ' 族 → ' + path.relative(ROOT, outPath) + '（' + fs.statSync(outPath).size + ' 字节）');
    console.log('生成清单：' + path.relative(ROOT, manifestPath));
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (e) { /* 临时目录清理失败不影响产物 */ }
  }
})();

function sha256Text(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
