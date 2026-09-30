// make-anim-pack.js — TASK-20260917-SKILL-ANIM-CHANNEL 阶段二（方案 A）：离线动作包生成。
//
// 干嘛的：游戏不开，用 sqpack 只读提取 + 随包钉死 XAT 转换器，把「表情（目录全量）+
//        职业技能出招动画（ability 族键）」转成网页剪辑契约的 clip JSON，聚合成一个
//        gzip 动作包（默认 release/anim-pack/anim-pack.json.gz，release/ 不进 git/公开包）。
//        网页「资料库→游戏动作转换→导入离线动作包」读包入库后，时间轴放表情/技能即预览。
// 取数策略：自族优先（--code，默认 c1201=属主种族码），缺则 c0101 全量库兜底——各族
//        骨名/父子同构（KEY-REPAIR 结构指纹实证），clip 按骨索引通用；平移通道带源族比例。
// 转换链：与 scripts/make-skeleton-pack.js、src/XatClipConverter.cs 同口径
//        （unwrap→addSkeleton→toFbxAnimation→FBX 窄解析→clip 契约校验）；
//        FBX→clip 的动画抽取为 src/XatFbxClipReader.cs 已用子集的 Node 等价移植
//        （无枢轴/预后旋转/非默认欧拉序/缺通道一律显式拒绝，绝不猜测补全）。
// 单 entry 口径：多 entry PAP 与 0 entry PAP 明确跳过并计数（与一键准备同规则，不拆分）。
// 拼接口径（D2 修复，2026-09-18）：目录多键表情（_start+_loop）= 游戏的「入场→循环」两段。
//        两段均可转换且同库时按时间平移拼成一条（start 在前 loop 在后，loop 整段平移 start
//        时长；边界时间重合处丢 loop 首行以保持严格递增），拼接后整体再过契约校验；
//        重标/量化/共线简化三段口径与顺序不变。_start 离线不可得的表情保持循环段并逐类计数。
// 通用包（r2，2026-09-21 TASK-20260918-ANIM-PACK-UNIVERSAL）：--universal 输出 formatVersion=2——
//        全部剪辑统一 c0101 基准（一律按 c0101 SKLB 转换；PAP 取库顺序 [c0101, 自族]，
//        自族兜底源平移重标到 c0101 参考姿态），包加 baseSkeletonCode/baseSkeleton
//        （c0101 全 106 骨参考：唯一 i/n、父索引、有限参考 t/q/s）。v2 manifest 不含
//        generatedAt/out 绝对路径——同输入重跑 gzip 与 manifest 字节一致（AC-1 口径）；
//        v1 默认与 --code 行为不变（manifest 仍记生成时刻与 out 路径）。
//        2026-09-20 仓库重建时 D2 拼接函数体丢失（main 引用仍在）；本 r2 按
//        C:/choreohelper-recovery/_merge 中间产物（哈希见任务证据）恢复 keyState/planEmote/
//        convertFirstKey/spliceStats，行为与 D2 交付口径一致。
// 幂等：包内容只由游戏数据决定（无时间戳），重跑字节一致；manifest 记生成时刻与逐条状态。
// 怎么跑：node scripts/make-anim-pack.js [--code c1201] [--universal] [--exe <转换器路径>]
//        [--sample N（只实测不写包）]；--exe 用于钉死哈希转换器不在默认 dist 位置时显式指路
//        （哈希校验不变，见 EXE_SHA256）。
// 何时重跑：游戏大版本更新后；技能键清单变了先重跑 dump-action-refs（见 scripts/anim-pack/）。
'use strict';
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist', 'ChoreoHelper');
const OUT_DEFAULT = path.join(ROOT, 'release', 'anim-pack', 'anim-pack.json.gz');
const MANIFEST_DEFAULT = path.join(ROOT, 'release', 'anim-pack', 'anim-pack-manifest.json');
const REFS_DEFAULT = path.join(__dirname, 'anim-pack', 'action-refs.tsv');
const CATALOG_DEFAULT = path.join(DIST, 'catalog-snapshot.js');
const TOOLS = path.join(DIST, 'tools', 'xat');
let EXE_PATH = path.join(TOOLS, 'XATHavokInterop.exe'); // --exe 可显式指路（哈希校验不变）
const EXE_SHA256 = 'f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2'; // 与产品钉死值一致（XatClipConverter.PinnedExeSha256）
const PER_CALL_TIMEOUT_MS = 45000;
const FALLBACK_CODE = 'c0101'; // 全量兜底库（P0/P1 调研：技能与特别表情 PAP 集中于此）
const FBX_TIME_PER_SECOND = 46186158000.0;

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function fail(msg) { console.error('生成失败：' + msg); process.exit(1); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// ---- 容器剥离（src/XatHavokUnwrap.cs 等价移植，与 make-skeleton-pack 同口径） ----
function readPapHeader(b) {
  if (b.length < 26 || b.toString('latin1', 0, 4) !== 'pap ') throw new Error('Invalid PAP header');
  return { count: b.readInt16LE(8), skeleton: b.readInt32LE(10), info: b.readInt32LE(14), start: b.readInt32LE(18), end: b.readInt32LE(22) };
}
function unwrapPap(b) {
  const h = readPapHeader(b);
  if (h.count !== 1 || !(26 <= h.info && h.info < h.start && h.start < h.end && h.end <= b.length)) throw new Error('Unsupported PAP container');
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

// ---- XAT 固定轴欧拉（角度制）→ 四元数（与 XatFbxClipReader.EulerXyzStatic 逐式一致） ----
function eulerXyzStatic(deg) {
  const x = deg[0] * Math.PI / 360, y = deg[1] * Math.PI / 360, z = deg[2] * Math.PI / 360;
  const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

// ---- 转换器调用（钉死哈希先验；cwd=临时目录，与产品 RealIO 同形） ----
function invokeExe(args, workDir) {
  const r = spawnSync(EXE_PATH, args, { cwd: workDir, timeout: PER_CALL_TIMEOUT_MS, windowsHide: true,
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

// ---- FBX Binary 窄解析（版本 7100–7499；完整属性值，动画曲线抽取需要数组属性） ----
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
function readFbx(data) {
  if (data.length < 27 || data.toString('latin1', 0, 23) !== 'Kaydara FBX Binary  \x00\x1a\x00') throw new Error('Invalid FBX header');
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

// ---- FBX → clip JSON（src/XatFbxClipReader.Convert 已用子集的 Node 等价移植） ----
function idOf(v) {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  throw new Error('FBX object id expected');
}
function child(n, name) {
  for (const c of n.children) if (c.name === name) return c;
  throw new Error('missing FBX node ' + name);
}
function num(v) {
  if (typeof v === 'number') return v;
  throw new Error('FBX scalar expected');
}
function vec(values) { return [num(values[0]), num(values[1]), num(values[2])]; }

function fbxToClip(fbxBytes, clipName, skeletonName) {
  const tree = readFbx(fbxBytes);
  let objects = null, connections = null;
  for (const n of tree) {
    if (n.name === 'Objects') objects = n;
    else if (n.name === 'Connections') connections = n;
  }
  if (!objects || !connections) throw new Error('FBX missing Objects/Connections');
  const objs = objects.children, conns = connections.children;
  const byId = new Map();
  for (const o of objs) byId.set(idOf(o.values[0]), o);
  const parents = new Map();
  for (const c of conns) {
    if (c.values[0] !== 'OO') continue;
    const childId = idOf(c.values[1]);
    const target = byId.get(childId);
    if (target && target.name === 'Model') parents.set(childId, idOf(c.values[2]));
  }
  const skeleton = [];
  const clips = {};
  const idToIndex = new Map();
  let frames = 0;
  for (const model of objs) {
    if (model.name !== 'Model') continue;
    const mid = idOf(model.values[0]);
    const boneName = String(model.values[1]).split('\0')[0];
    const props = new Map();
    for (const p of child(model, 'Properties70').children) props.set(p.values[0], p.values.slice(4));
    for (const key of ['PreRotation', 'PostRotation', 'RotationOffset', 'RotationPivot', 'ScalingOffset', 'ScalingPivot'])
      if (props.has(key) && props.get(key).some((v) => num(v) !== 0)) throw new Error('unsupported ' + key);
    if (props.has('RotationOrder') && num(props.get('RotationOrder')[0]) !== 0) throw new Error('unsupported RotationOrder');
    const index = skeleton.length;
    idToIndex.set(mid, index);
    const translation = props.has('Lcl Translation') ? vec(props.get('Lcl Translation')) : [0, 0, 0];
    const rotation = props.has('Lcl Rotation') ? vec(props.get('Lcl Rotation')) : [0, 0, 0];
    const scale = props.has('Lcl Scaling') ? vec(props.get('Lcl Scaling')) : [1, 1, 1];
    if (scale.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('invalid reference scale ' + boneName);
    skeleton.push({ index, boneName, parentId: parents.has(mid) ? parents.get(mid) : 0, t: translation, q: eulerXyzStatic(rotation), s: scale });

    const channels = {};
    for (const conn of conns) {
      if (conn.values.length < 4 || conn.values[0] !== 'OP' || idOf(conn.values[2]) !== mid) continue;
      const nodeId = idOf(conn.values[1]);
      const curveNodeParent = byId.get(nodeId);
      if (!curveNodeParent || curveNodeParent.name !== 'AnimationCurveNode') continue;
      const prop = conn.values[3];
      const axes = new Map();
      for (const c of conns) {
        if (c.values.length < 4 || c.values[0] !== 'OP' || idOf(c.values[2]) !== nodeId) continue;
        const curve = byId.get(idOf(c.values[1]));
        if (!curve || curve.name !== 'AnimationCurve') throw new Error('FBX animation channel is not an AnimationCurve');
        const times = child(curve, 'KeyTime').values[0];
        const keyValues = child(curve, 'KeyValueFloat').values[0];
        if (times.length !== keyValues.length || times.length < 2) throw new Error('incomplete keyframes ' + boneName);
        axes.set(String(c.values[3]).slice(-1), { times, keyValues });
      }
      if (!(axes.size === 3 && axes.has('X') && axes.has('Y') && axes.has('Z'))) throw new Error('incomplete channel ' + boneName + ' ' + prop);
      const ts = axes.get('X').times;
      if (!arrEq(ts, axes.get('Y').times) || !arrEq(ts, axes.get('Z').times)) throw new Error('channel key times differ ' + boneName);
      for (let k = 1; k < ts.length; k++) if (Number(ts[k]) <= Number(ts[k - 1])) throw new Error('key times not increasing ' + boneName);
      const key = prop === 'Lcl Rotation' ? 'q' : prop === 'Lcl Translation' ? 't' : prop === 'Lcl Scaling' ? 's' : null;
      if (!key) throw new Error('unsupported property ' + prop);
      const rows = [];
      for (let j = 0; j < ts.length; j++) {
        const v = [axes.get('X').keyValues[j], axes.get('Y').keyValues[j], axes.get('Z').keyValues[j]];
        const time = qzTime(Number(ts[j]) / FBX_TIME_PER_SECOND);
        if (key === 'q') {
          const q = eulerXyzStatic(v);
          rows.push([time, qzQuat(q[0]), qzQuat(q[1]), qzQuat(q[2]), qzQuat(q[3])]);
        } else {
          rows.push([time, qzVec(v[0]), qzVec(v[1]), qzVec(v[2])]);
        }
      }
      channels[key] = rows;
      frames = Math.max(frames, ts.length);
    }
    if (!(Object.keys(channels).length === 3 && channels.q && channels.t && channels.s)) throw new Error('incomplete bone ' + boneName);
    const bone = {};
    for (const key of ['q', 't', 's']) bone[key] = channels[key];
    clips['bone_' + index] = bone;
  }
  const skeletonOut = skeleton.map((b) => ({
    i: b.index, n: b.boneName,
    p: idToIndex.has(b.parentId) ? idToIndex.get(b.parentId) : -1,
    t: b.t, q: b.q, s: b.s,
  }));
  let duration = 0;
  for (const bn in clips) for (const ch of ['q', 't', 's']) {
    const rows = clips[bn][ch];
    if (rows.length) duration = Math.max(duration, rows[rows.length - 1][0]);
  }
  validateClip(clips, duration);
  const clip = {
    name: clipName, duration, type: 'loop', bones: clips,
    offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: skeletonName, productionImportApproved: false },
  };
  return { clip, skeleton: { count: skeletonOut.length, bones: skeletonOut }, bones: skeletonOut.length, frames, duration };
}
function arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function validateClip(clips, duration) {
  if (!(duration > 0 && Number.isFinite(duration))) throw new Error('invalid clip duration');
  for (const boneKey in clips) {
    const bone = clips[boneKey];
    for (const ch of ['q', 't', 's']) {
      for (const row of bone[ch]) for (const v of row)
        if (!Number.isFinite(v)) throw new Error('non-finite keyframe value');
      for (let k = 1; k < bone[ch].length; k++)
        if (!(bone[ch][k][0] > bone[ch][k - 1][0])) throw new Error('key times not increasing ' + boneKey + '.' + ch);
    }
    for (const row of bone.q) {
      let norm = 0;
      for (let i = 1; i < row.length; i++) norm += row[i] * row[i];
      if (Math.abs(norm - 1) >= 1e-6) throw new Error('rotation quaternion not normalized: bone=' + boneKey + ' norm=' + norm);
    }
  }
}

// 关键帧无损简化（三点共线判据）：行 i 可删 iff 其值恰在保留段 (last, next) 的线性插值上
//（容差 1e-6，量化噪声级）——常值通道全收为首末两行（精确无损）、线性缓动段同样收敛；
// 平台边界与真实变化点保留（删了会改插值时序）。首行与末行恒保留（契约 ≥2 行+时长）。
function dedupRows(rows) {
  if (rows.length <= 2) return { rows, dropped: 0 };
  function collinear(a, m, b) {
    const span = b[0] - a[0];
    if (!(span > 0)) return false;
    const alpha = (m[0] - a[0]) / span;
    for (let j = 1; j < m.length; j++) {
      const expect = a[j] + (b[j] - a[j]) * alpha;
      if (Math.abs(m[j] - expect) > 1e-6) return false;
    }
    return true;
  }
  const out = [rows[0]];
  let dropped = 0;
  for (let i = 1; i < rows.length - 1; i++) {
    if (collinear(out[out.length - 1], rows[i], rows[i + 1])) dropped++;
    else out.push(rows[i]);
  }
  out.push(rows[rows.length - 1]);
  return { rows: out, dropped };
}
function dedupeClip(bones) {
  let dropped = 0, kept = 0;
  for (const bk in bones) for (const ch of ['q', 't', 's']) {
    const r = dedupRows(bones[bk][ch]);
    bones[bk][ch] = r.rows;
    dropped += r.dropped;
    kept += r.rows.length;
  }
  return { dropped, kept };
}

// D2 拼接（纯函数）：把 loop 段整体平移 start 段时长后接在 start 段之后（同库同骨架，两段
// 已各自过重标/量化/共线简化三段，三段口径与顺序不变）。边界时间重合（loop 首行=0 且该通道
// start 末行=段时长）时丢 loop 首行——start 到达姿态即 loop 起始姿态，保严格递增且不丢入场
// 细节；时间平移后再走一次 1e-6 时间量化；拼接后整体再过契约校验。
function spliceSegments(startClip, loopClip) {
  const shift = startClip.duration;
  const bones = {};
  for (const bk in startClip.bones) {
    const bs = startClip.bones[bk], bl = loopClip.bones[bk];
    if (!bl) throw new Error('splice skeleton mismatch ' + bk);
    const bone = {};
    for (const ch of ['q', 't', 's']) {
      const rowsS = bs[ch];
      const rowsL = bl[ch].map((r) => { const out = [qzTime(r[0] + shift)]; for (let j = 1; j < r.length; j++) out.push(r[j]); return out; });
      bone[ch] = (rowsL.length && rowsS.length && rowsL[0][0] <= rowsS[rowsS.length - 1][0])
        ? rowsS.concat(rowsL.slice(1)) : rowsS.concat(rowsL);
    }
    bones[bk] = bone;
  }
  let duration = 0;
  for (const bk in bones) for (const ch of ['q', 't', 's']) {
    const rows = bones[bk][ch];
    if (rows.length) duration = Math.max(duration, rows[rows.length - 1][0]);
  }
  validateClip(bones, duration);
  return { bones, duration };
}

// 缺键逐类计数（与条目 miss 分类同口径）：no-store / zero-entry / multi-entry / convert
function classifyMiss(reason) {
  if (/no-store/.test(reason)) return 'no-store';
  if (/zero-entry/.test(reason)) return 'zero-entry';
  if (/multi-entry/.test(reason)) return 'multi-entry';
  return 'convert';
}

// 跨族平移重标（阶段二正确性，t-retarget 实验依据）：目标骨 i（名 n）逐分量——
// 源参考分量显著→乘比例（负比例=镜像轴，合法）；源分量≈0→加性偏移（refT_tgt-refT_src）；
// 比例非有限或 |r|>8（异常放大）→ 该骨不动并计数；源骨架缺该骨→不动（计数）。
// 重标后再走一次 1e-4 量化。旋转不动（比例无关）。
function retargetTranslations(bones, targetBones, srcRefs) {
  let rescaled = 0, offset = 0, missing = 0;
  targetBones.forEach((tb) => {
    const anim = bones['bone_' + tb.i];
    const srcT = srcRefs ? srcRefs.get(tb.n) : null;
    if (!anim) return;
    if (!srcT) { missing++; return; }
    const ratios = [0, 1, 2].map((j) => (Math.abs(srcT[j]) > 1e-4 ? (tb.t[j] / srcT[j]) : null));
    if (ratios.some((r) => r !== null && (!Number.isFinite(r) || Math.abs(r) > 8))) { missing++; return; }
    anim.t = anim.t.map((row) => [row[0],
      ratios[0] === null ? qzVec(row[1] + (tb.t[0] - srcT[0])) : qzVec(row[1] * ratios[0]),
      ratios[1] === null ? qzVec(row[2] + (tb.t[1] - srcT[1])) : qzVec(row[2] * ratios[1]),
      ratios[2] === null ? qzVec(row[3] + (tb.t[2] - srcT[2])) : qzVec(row[3] * ratios[2])]);
    if (ratios.some((r) => r !== null && Math.abs(r - 1) > 1e-3)) rescaled++;
    else offset++;
  });
  return { rescaled, offset, missing };
}

// 与 ExportServer.cs / preview3d.cmdToName 同规则：去头斜杠、斜杠换下划线
function cmdToName(cmd) {
  let s = String(cmd || '').trim();
  s = s.replace(/^\//, '').replace(/\//g, '_');
  return s;
}

// ---- v2 通用包（r2）纯决策函数（供单测；main 内同口径使用） ----
// 取库顺序：v1=[自族, c0101]（自族优先，兜底重标到 --code）；v2=[c0101, 自族]（基准优先，
// 自族兜底重标到 c0101——重标最少、基准最正）。去重保证 code==FALLBACK 时只有一个。
function storeOrderFor(code, universal) {
  if (universal) return code === FALLBACK_CODE ? [FALLBACK_CODE] : [FALLBACK_CODE, code];
  return [code, FALLBACK_CODE].filter((c, i, a) => a.indexOf(c) === i);
}
// manifest 组装：v2 不含 generatedAt/out 绝对路径（同输入重跑 manifest 字节一致，AC-1）；
// v1 保持原字段原顺序（generatedAt + out 路径照记）。
function manifestFor(universal, fields) {
  return universal ? {
    schema: 1, mode: 'universal', formatVersion: 2, baseSkeletonCode: FALLBACK_CODE,
    exeSha256: fields.exeSha256, code: fields.code,
    sqpackExtract: fields.sqpackExtract, refsSource: fields.refsSource, catalogSource: fields.catalogSource,
    outSha256: fields.outSha256, outBytes: fields.outBytes,
    counts: fields.counts, entryStates: fields.entryStates,
  } : {
    schema: 1, generatedAt: fields.generatedAt, exeSha256: fields.exeSha256, code: fields.code,
    sqpackExtract: fields.sqpackExtract, refsSource: fields.refsPath || fields.refsSource, catalogSource: fields.catalogSource,
    out: fields.out, outSha256: fields.outSha256, outBytes: fields.outBytes,
    counts: fields.counts, entryStates: fields.entryStates,
  };
}

// 无损量化（阶段二体量控制）：时间 1e-6s、四元数分量 1e-7、平移/缩放 1e-4。
// 误差上界：|Δnorm(q)| ≤ ~1e-7 < 契约 1e-6（四元数四分量各 ≤0.5e-7）；
// 去重在量化之后做，同值关键帧量化后仍严格相等，去重判定不受影响。
function qzTime(v) { return Math.round(v * 1e6) / 1e6; }
function qzQuat(v) { return Math.round(v * 1e7) / 1e7; }
function qzVec(v) { return Math.round(v * 1e4) / 1e4; }

// ---- main（require 作模块用时不自跑，纯函数经 module.exports 供测试/探针复用） ----
function main() {
  const code = arg('--code', 'c1201');
  const outPath = arg('--out', OUT_DEFAULT);
  const manifestPath = arg('--manifest', MANIFEST_DEFAULT);
  const refsPath = arg('--refs', REFS_DEFAULT);
  const catalogPath = arg('--catalog', CATALOG_DEFAULT);
  const sqpackPath = arg('--sqpack-extract', process.env.CHOREO_SQPACK_EXTRACT || 'D:/choreo/p0-scan-20260916/sqpack-extract.js');
  const sampleN = parseInt(arg('--sample', ''), 10);
  const limitN = parseInt(arg('--limit', ''), 10); // --limit N：只取前 N 表情+N 技能，但照常写包（测试用小包）
  const universal = process.argv.indexOf('--universal') >= 0; // r2：v2 通用包（c0101 基准）
  const exeArg = arg('--exe', ''); // --exe：钉死哈希转换器不在默认 dist 位置时显式指路
  if (exeArg) EXE_PATH = exeArg;
  if (!/^c\d{4}$/.test(code)) fail('--code 应为 c#### 形态（种族码）');
  if (!fs.existsSync(sqpackPath)) fail('sqpack-extract 工具不可用：' + sqpackPath);
  if (!fs.existsSync(REFS_DEFAULT)) fail('技能键清单不可用：' + REFS_DEFAULT + '（先按 scripts/anim-pack/dump-action-refs 重跑导出）');
  if (!fs.existsSync(catalogPath)) fail('目录快照不可用：' + catalogPath);
  if (!fs.existsSync(EXE_PATH)) fail('随包转换器缺失：' + EXE_PATH);
  const exeHash = sha256(fs.readFileSync(EXE_PATH));
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

  // 目录快照：表情（中文名+command+timelineKeys）
  const catSrc = fs.readFileSync(catalogPath, 'utf8');
  const catalog = JSON.parse(catSrc.slice(catSrc.indexOf('{'), catSrc.lastIndexOf('}') + 1));
  // 技能键清单：rowId \t name \t jobName \t jobId \t endKey \t startKey（dump-action-refs 导出）
  const refRows = fs.readFileSync(refsPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const catActionsById = new Map();
  catalog.actions.forEach((a) => catActionsById.set(a.id, a));

  // ---- 候选选择（方案 A：表情全量 + 技能出招 ability 族；同名条目只留首条——
  // putClip 按名入库，后到的同名只会覆盖先到的，进包纯属浪费体量，如实计数） ----
  const candidates = [];
  const seenNames = new Set();
  let emoteNoCmd = 0, emoteNoKeys = 0, dupName = 0;
  for (const e of catalog.emotes) {
    const keys = (e.timelineKeys || []).filter(Boolean);
    if (!keys.length) { emoteNoKeys++; continue; }
    if (!e.command || e.command.indexOf(' ') >= 0) { emoteNoCmd++; continue; } // 面板可下时间轴的表情须有单词 command
    const nm = cmdToName(e.command);
    if (seenNames.has(nm)) { dupName++; continue; }
    seenNames.add(nm);
    candidates.push({ kind: 'emote', label: e.name, category: e.category || '', jobName: '', name: nm, keys });
  }
  let skillNoRef = 0, skillNameMismatch = 0;
  for (const cols of refRows) {
    if (cols.length < 6) continue;
    const [idS, name, jobName, jobIdS, endKey, startKey] = cols;
    const id = parseInt(idS, 10);
    const key = (endKey && endKey.startsWith('ability/')) ? endKey : (startKey && startKey.startsWith('ability/')) ? startKey : '';
    if (!key) { skillNoRef++; continue; }
    const cat = catActionsById.get(id);
    if (!cat || cat.name !== name || cat.jobName !== jobName) { skillNameMismatch++; continue; } // 与面板目录对不上即不进包（诚实计数）
    const nm = cmdToName(cat.command);
    if (seenNames.has(nm)) { dupName++; continue; }
    seenNames.add(nm);
    candidates.push({ kind: 'skill', label: name, category: cat.category || '', jobName, name: nm, keys: [key] });
  }
  console.log('候选：表情 ' + candidates.filter((c) => c.kind === 'emote').length + '（无 command ' + emoteNoCmd + ' · 无键 ' + emoteNoKeys + '）+ 技能 ' + candidates.filter((c) => c.kind === 'skill').length + '（无 ability 引用 ' + skillNoRef + ' · 与目录不匹配 ' + skillNameMismatch + '）· 同名去重 ' + dupName);

  // ---- 逐候选：单 entry → 转换（同键只转一次，缓存供拼接/多候选复用） ----
  // v1（默认）：PAP 自族优先→c0101 兜底；一律按目标族（--code）SKLB 转换，兜底源平移按骨名
  //        参考姿态比例重标（t-retarget 实验口径）。v2（--universal）：基准=c0101，取库顺序
  //        [c0101, 自族]，一律按 c0101 SKLB 转换，自族兜底源重标到 c0101 参考姿态。
  const basis = universal ? FALLBACK_CODE : code;
  const storeOrder = storeOrderFor(code, universal);
  const sklbCache = new Map(); // code → bytes
  function sklbOf(code2) {
    if (!sklbCache.has(code2)) sklbCache.set(code2, extractOrNull(`chara/human/${code2}/skeleton/base/b0001/skl_${code2}b0001.sklb`));
    return sklbCache.get(code2);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-anim-pack-'));
  const convCache = new Map(); // key → {ok,clip,...} 或 {ok:false,reason}（同键候选共用）
  const sourceRefs = new Map(); // 源族 code → Map(骨名→参考 t[3])（一次性对照转换收获）
  const entryStates = [];
  const packClips = []; const clipIndexByKey = new Map();
  let baseSkeleton = null; // v2：c0101 参考骨架（首个成功转换的 r.skeleton；同库恒同）
  function resolveStore(key) {
    for (const code2 of storeOrder) {
      const buf = extractOrNull(`chara/human/${code2}/animation/a0001/bt_common/${key}.pap`);
      if (buf) return { code: code2, buf };
    }
    return null;
  }
  function convertKey(storeCode, papBuf, displayKey) {
    const sklb = sklbOf(storeCode);
    if (!sklb) throw new Error(storeCode + ' 基础 SKLB 不可提取');
    const animationPath = path.join(workDir, 'animation.hkt');
    const skeletonPath = path.join(workDir, 'skeleton.hkt');
    const combinedPath = path.join(workDir, 'combined.hkt');
    const fbxPath = path.join(workDir, 'animation.fbx');
    fs.writeFileSync(animationPath, unwrapPap(papBuf));
    fs.writeFileSync(skeletonPath, unwrapSklb(sklb));
    invokeExe(['addSkeleton', animationPath, skeletonPath, '0', combinedPath], workDir);
    invokeExe(['toFbxAnimation', combinedPath, '0', '0', fbxPath], workDir);
    return fbxToClip(fs.readFileSync(fbxPath), displayKey, storeCode);
  }
  function harvestSourceRefs(storeCode, papBuf) { // 源族参考姿态（骨名→t[3]）：源族 SKLB 对照转换
    const r = convertKey(storeCode, papBuf, 'ref-harvest');
    const m = new Map();
    r.skeleton.bones.forEach((b) => m.set(b.n, b.t));
    return m;
  }
  function keyState(key) { // 单键转换状态（缓存；失败记 reason 供逐类计数与 _start 缺类标注）
    if (!convCache.has(key)) {
      const hit = resolveStore(key);
      if (!hit) convCache.set(key, { ok: false, reason: 'no-store' });
      else {
        const hdr = readPapHeader(hit.buf);
        if (hdr.count === 0) convCache.set(key, { ok: false, reason: 'zero-entry' });
        else if (hdr.count > 1) convCache.set(key, { ok: false, reason: 'multi-entry(' + hdr.count + ')' });
        else {
          try {
            const r = convertKey(basis, hit.buf, key); // 一律基准族骨架（v1=--code，v2=c0101）
            let ret = { rescaled: 0, offset: 0, missing: 0 };
            if (hit.code !== basis) { // 兜底源：平移重标（先收获源参考姿态）
              if (!sourceRefs.has(hit.code)) sourceRefs.set(hit.code, harvestSourceRefs(hit.code, hit.buf));
              ret = retargetTranslations(r.clip.bones, r.skeleton.bones, sourceRefs.get(hit.code));
            }
            const dedup = dedupeClip(r.clip.bones);
            validateClip(r.clip.bones, r.duration); // 重标+去重后再验契约（时间递增/归一/s>0）
            if (universal && !baseSkeleton) baseSkeleton = r.skeleton;
            const clipObj = { name: key, duration: r.duration, type: 'loop', bones: r.clip.bones,
              offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: basis, productionImportApproved: false } };
            convCache.set(key, { ok: true, clip: clipObj, duration: r.duration, frames: r.frames, bones: r.bones, store: hit.code, key,
              retarget: ret, keyframesKept: dedup.kept, keyframesDropped: dedup.dropped });
          } catch (e) {
            convCache.set(key, { ok: false, reason: 'convert: ' + e.message });
          }
        }
      }
    }
    return convCache.get(key);
  }
  function convertFirstKey(c) { // 键序首个可转换键胜出（技能与无 _start+_loop 对的表情）
    for (const key of c.keys) { const st = keyState(key); if (st.ok) return st; }
    return null;
  }
  const spliceStats = { spliced: 0, mixedStore: 0, spliceFail: 0, startMiss: { 'no-store': 0, 'zero-entry': 0, 'multi-entry': 0, convert: 0 } };
  function planEmote(c) { // D2：_start+_loop 双键表情拼接优先；_start 不可得保持循环段并逐类计数
    const keys = [...new Set(c.keys.map(String))];
    const startKey = keys.find((k) => k.endsWith('_start'));
    if (!startKey) return { st: convertFirstKey(c), startMiss: null };
    const base = startKey.slice(0, -'_start'.length);
    const loopKey = keys.find((k) => k.endsWith('_loop') && k.slice(0, -'_loop'.length) === base) || keys.find((k) => k.endsWith('_loop'));
    if (!loopKey) return { st: convertFirstKey(c), startMiss: null };
    const stS = keyState(startKey), stL = keyState(loopKey);
    if (stS.ok && stL.ok) {
      if (stS.store !== stL.store) { spliceStats.mixedStore++; return { st: convertFirstKey(c), startMiss: null }; } // 不同库不拼（拍板=同库口径）
      try { // 同库同骨架 → 时间平移拼成一条，拼接后整体再过校验
        const sp = spliceSegments(stS.clip, stL.clip);
        spliceStats.spliced++;
        return { st: { ok: true,
          clip: { name: stS.key + '+' + stL.key, duration: sp.duration, type: 'loop', bones: sp.bones,
            offlinePrototype: { requiredChannels: ['q', 't', 's'], sourceSkeleton: basis, productionImportApproved: false } },
          duration: sp.duration, frames: stS.frames + stL.frames, bones: stS.bones, store: stS.store, key: stS.key + '+' + stL.key,
          spliced: { start: stS.key, loop: stL.key },
          retarget: { rescaled: stS.retarget.rescaled + stL.retarget.rescaled, offset: stS.retarget.offset + stL.retarget.offset, missing: stS.retarget.missing + stL.retarget.missing },
          keyframesKept: stS.keyframesKept + stL.keyframesKept, keyframesDropped: stS.keyframesDropped + stL.keyframesDropped }, startMiss: null };
      } catch (e) { spliceStats.spliceFail++; return { st: convertFirstKey(c), startMiss: null }; } // 拼接异常如实计数，保持旧口径
    }
    if (stL.ok) { // _start 离线不可得：保持循环段，逐类计数如实标注
      const cls = classifyMiss(stS.reason);
      spliceStats.startMiss[cls]++;
      return { st: stL, startMiss: cls };
    }
    return { st: convertFirstKey(c), startMiss: null }; // loop 也不可用 → 旧口径（首个可转换键胜出）
  }

  let list = candidates;
  if (Number.isFinite(sampleN) && sampleN > 0)
    list = candidates.filter((c) => c.kind === 'emote').slice(0, sampleN).concat(candidates.filter((c) => c.kind === 'skill').slice(0, sampleN));
  else if (Number.isFinite(limitN) && limitN > 0)
    list = candidates.filter((c) => c.kind === 'emote').slice(0, limitN).concat(candidates.filter((c) => c.kind === 'skill').slice(0, limitN));
  console.log('待处理候选 ' + list.length + ' 个' + (Number.isFinite(sampleN) ? '（--sample 实测模式，不写包）' : ''));

  let okE = 0, okS = 0, missNoStore = 0, missZero = 0, missMulti = 0, missConvert = 0;
  const t0 = Date.now();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const plan = c.kind === 'emote' ? planEmote(c) : { st: convertFirstKey(c), startMiss: null };
    const st = plan.st;
    if (!st) {
      const reason = c.keys.map((k) => { const s = convCache.get(k); return k + '=' + (s ? s.reason : '?'); }).join(' | ');
      const cls = classifyMiss(reason);
      if (cls === 'no-store') missNoStore++; else if (cls === 'zero-entry') missZero++; else if (cls === 'multi-entry') missMulti++; else missConvert++;
      entryStates.push({ name: c.name, label: c.label, kind: c.kind, status: 'miss', reason, cls });
    } else {
      if (!clipIndexByKey.has(st.key + '@' + st.store)) {
        clipIndexByKey.set(st.key + '@' + st.store, packClips.length);
        packClips.push({ key: st.key, store: st.store, duration: st.duration, frames: st.frames, bones: st.bones, clip: st.clip });
      }
      entryStates.push({ name: c.name, label: c.label, kind: c.kind, status: 'ok', key: st.key, store: st.store,
        spliced: st.spliced, startMiss: plan.startMiss || undefined,
        retarget: st.retarget && (st.retarget.rescaled || st.retarget.offset || st.retarget.missing) ? st.retarget : undefined,
        clipIndex: clipIndexByKey.get(st.key + '@' + st.store) });
      if (c.kind === 'emote') okE++; else okS++;
    }
    if ((i + 1) % 100 === 0) console.log('  进度 ' + (i + 1) + '/' + list.length + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
  }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}

  const entries = entryStates.filter((s) => s.status === 'ok')
    .map((s) => ({ name: s.name, label: s.label, kind: s.kind, category: s.category || undefined, jobName: s.jobName || undefined, clipIndex: s.clipIndex }));
  if (universal && !baseSkeleton) fail('c0101 基准骨架未收获（无成功转换），不写 v2 包');
  const pack = {
    formatVersion: universal ? 2 : 1, gameVersion: catalog.gameVersion, code: basis,
    ...(universal ? { baseSkeletonCode: FALLBACK_CODE, baseSkeleton: { count: baseSkeleton.count, bones: baseSkeleton.bones } } : {}),
    counts: { emotes: okE, skills: okS, missNoStore, missZeroEntry: missZero, missMultiEntry: missMulti, missConvert, duplicateName: dupName,
      emoteSpliced: spliceStats.spliced, emoteStartMiss: spliceStats.startMiss, emoteStartMixedStore: spliceStats.mixedStore, emoteSpliceFail: spliceStats.spliceFail },
    clips: packClips, entries,
  };
  const packJson = JSON.stringify(pack);
  const gz = zlib.gzipSync(Buffer.from(packJson, 'utf8'), { level: 9 });
  const sm = spliceStats.startMiss;
  const smTotal = sm['no-store'] + sm['zero-entry'] + sm['multi-entry'] + sm.convert;
  console.log('模式：' + (universal ? 'universal v2（基准 c0101，取库顺序 ' + storeOrder.join('→') + '）' : 'v1 单族（--code ' + code + '）'));
  console.log('结果：表情 ' + okE + ' · 技能 ' + okS + ' · 缺库 ' + missNoStore + ' · 0-entry ' + missZero + ' · 多 entry ' + missMulti + ' · 转换失败 ' + missConvert + ' · 同名去重 ' + dupName);
  console.log('拼接：入场+循环 ' + spliceStats.spliced + ' 条 · 缺 _start 保持循环段 ' + smTotal + '（no-store ' + sm['no-store'] + ' · 0-entry ' + sm['zero-entry'] + ' · 多 entry ' + sm['multi-entry'] + ' · 转换失败 ' + sm.convert + '）· 混库不拼 ' + spliceStats.mixedStore + ' · 拼接失败 ' + spliceStats.spliceFail);
  console.log('体量：原始 JSON ' + (packJson.length / 1048576).toFixed(1) + ' MB · gzip ' + (gz.length / 1048576).toFixed(1) + ' MB · 去重剪辑 ' + packClips.length + ' 个 · 用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');

  if (Number.isFinite(sampleN)) { console.log('（--sample 模式：不写包）'); return; }
  if (!entries.length) fail('没有任何成功条目，不写包');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, gz);
  // v2 manifest 无 generatedAt/out（同输入重跑字节一致，AC-1）；v1 字段原样保留
  fs.writeFileSync(manifestPath, JSON.stringify(manifestFor(universal, {
    generatedAt: new Date().toISOString(), exeSha256: exeHash, code,
    sqpackExtract: sqpackPath, refsSource: refsPath, catalogSource: catalogPath,
    out: outPath, outSha256: sha256(gz), outBytes: gz.length,
    counts: pack.counts, entryStates,
  }), null, 1));
  console.log('已写入 ' + outPath);
}

if (require.main === module) main();
module.exports = {
  main, cmdToName, readPapHeader, unwrapPap: unwrapPap, unwrapSklb, eulerXyzStatic,
  fbxToClip, validateClip, dedupRows, dedupeClip, spliceSegments, classifyMiss, qzTime, qzQuat, qzVec, retargetTranslations,
  storeOrderFor, manifestFor,
  _unwrapPap: unwrapPap, _unwrapSklb: unwrapSklb, _fbxToClip: fbxToClip, _main: main,
};
