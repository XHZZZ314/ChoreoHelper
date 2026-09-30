/**
 * make-restore-bundle.js — 把「一份骨架快照 + 模型文件」打包成角色档案恢复包（.choreolib）
 *
 * 干嘛的：角色档案功能（2026-08-30）上线前的老角色，其骨架只存在于部署位快照
 *        （skeleton-snapshot.js）、模型文件在部署位（model.gltf+model.bin）。
 *        本脚本把它们按 CHLB v1 备份格式打包成带 header.profiles 的恢复包，
 *        主人在网页「📦 资料库 → 📥 导入备份」选这个文件，老角色就变成一套正式档案
 *        （导入逻辑：同骨架指纹并入已有档案、异指纹自动建新档案——choreo-library.js）。
 *
 * 用法：D:\nodejs\node.exe scripts\make-restore-bundle.js <输出.choreolib> <档案名> \
 *         <skeleton-snapshot.js 路径> <model.gltf> [model.bin]
 *       model.bin 省略时按 model.gltf 同名 .bin 找。
 * 例：  D:\nodejs\node.exe scripts\make-restore-bundle.js
 *         "C:\Users\xhz\Desktop\老角色档案-巧克力歌剧院.choreolib" "巧克力歌剧院"
 *         web\dist\ChoreoHelper\skeleton-snapshot.js web\dist\ChoreoHelper\model.gltf
 *
 * 注意：骨架 hash 必须和网页 hashObject 口径一致（SHA-256 of JSON.stringify(解析后的对象)）；
 *      快照 js 里把对象 JSON.stringify 内嵌，本脚本解析回对象后再 stringify——键序与浏览器一致。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function main() {
  const [, , outArg, nameArg, snapArg, gltfArg, binArg] = process.argv;
  if (!outArg || !nameArg || !snapArg || !gltfArg) {
    console.error('参数不够：输出.choreolib 档案名 skeleton-snapshot.js model.gltf [model.bin]');
    process.exit(1);
  }
  const out = path.resolve(outArg);
  const profName = nameArg;
  const pid = 'restore' + Date.now().toString(36);

  // 1) 骨架：从快照 js 解出内嵌对象
  const snapSrc = fs.readFileSync(path.resolve(snapArg), 'utf8');
  const m = snapSrc.match(/window\.__CHOREO_SKELETON_SNAPSHOT__\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!m) { console.error('快照 js 里没找到 __CHOREO_SKELETON_SNAPSHOT__'); process.exit(1); }
  const skel = JSON.parse(m[1]);
  const skelBytes = Buffer.from(JSON.stringify(skel), 'utf8');
  const skelHash = sha256Hex(skelBytes); // 与网页 hashObject 同口径（canon JSON）

  // 2) 模型文件
  const gltfBuf = fs.readFileSync(path.resolve(gltfArg));
  const binPath = binArg ? path.resolve(binArg) : path.join(path.dirname(path.resolve(gltfArg)), 'model.bin');
  const files = [{ key: 'pfile:' + pid + ':model.gltf', buf: gltfBuf, mime: 'model/gltf+json' }];
  if (fs.existsSync(binPath)) files.push({ key: 'pfile:' + pid + ':model.bin', buf: fs.readFileSync(binPath), mime: 'application/octet-stream' });

  // 3) 布局：head(12) + header(对齐64) + skeleton + 各文件
  const parts = [];
  parts.push({ kind: 'pskel', blob: skelBytes });
  files.forEach(function (f) { parts.push({ kind: 'file', blob: f.buf }); });

  function buildHeader(headerLen) {
    var off = 12 + headerLen;
    var profSkel = null, fileEntries = [];
    parts.forEach(function (p) {
      var entry = { offset: off, len: p.blob.length };
      if (p.kind === 'pskel') profSkel = entry;
      else fileEntries.push(Object.assign({ name: parts.fileKeys[fileEntries.length] }, entry));
      off += p.blob.length;
    });
    return {
      formatVersion: 1, schemaVersion: 1, createdAt: Date.now(),
      clips: [], files: fileEntries,
      profiles: [{ id: pid, name: profName, skeletonHash: skelHash, boneCount: skel.count || 0, skeleton: { offset: profSkel.offset, len: profSkel.len } }]
    };
  }
  // 文件名要和 parts 对齐：先算一遍拿到序号再正式算（两轮定长，与 exportBundle 同套路）
  parts.fileKeys = files.map(function (f) { return f.key; });
  var headerLen = 64, header;
  for (var round = 0; round < 8; round++) {
    header = buildHeader(headerLen);
    var need = Buffer.byteLength(JSON.stringify(header), 'utf8');
    if (need <= headerLen) break;
    headerLen = Math.ceil((need + 1) / 64) * 64;
  }
  var headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  var pad = Buffer.alloc(headerLen - headerBytes.length, 0x20);
  var head = Buffer.concat([Buffer.from([0x43, 0x48, 0x4C, 0x42]), u32le(1), u32le(headerLen)]);

  fs.writeFileSync(out, Buffer.concat([head, headerBytes, pad].concat(parts.map(function (p) { return p.blob; }))));
  console.log('恢复包已生成：' + out);
  console.log('档案：' + profName + '（' + (skel.count || 0) + ' 骨，模型文件 ' + files.length + ' 个，共 ' +
    fs.statSync(out).size + ' 字节；骨架指纹 ' + skelHash.slice(0, 12) + '…）');
}
main().catch(function (e) { console.error('失败：' + e.message); process.exit(1); });
