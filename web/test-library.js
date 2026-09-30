/**
 * test-library.js — choreo-library.js 的 node 单测（AUD-004 数据完整性）
 *
 * 跑法：D:\nodejs\node.exe web\test-library.js
 *
 * 干嘛的：用 useBackend 注入口喂一个内存假 IndexedDB 事务后端（node 没有 indexedDB），
 *        验证动作库写入的原子性和备份导入的校验：
 *   一、putClip 原子性：元数据+数据同事务，任一侧失败整组回滚，不留幽灵动作
 *   二、putSkeleton 原子性：骨架记录和 profile 指纹一起进
 *   三、备份导出→导入往返：内容一致、hash 一致
 *   四、坏备份不覆盖：payload 被篡改（hash 不符）的条目拒绝导入，健康动作原样保留
 *   五、结构坏数据拒绝：解压后不是 JSON / 缺 bones 的条目不进库
 *   六、孤儿修复：只有元数据或只有数据的半条记录被清掉，健康动作不动
 *   七、clip↔骨架指纹盖章
 *   八、角色档案：旧单套数据自动迁移成「默认角色」
 *   九、角色档案：建档/切换/重命名/删除，模型文件按档案隔离
 *   十、putSkeleton 自动对号 + 多档案备份往返 + 异体备份导入建新档案（不再整体拒绝）
 *   十一、FIX-D/AUD2-008：同名动作按角色档案隔离（复合键，互不覆盖互不误读）
 *   十二、FIX-D/AUD2-008：旧全局动作迁移——指纹唯一匹配归档/没指纹进待归档/认领盖指纹/多套同指纹不猜
 *   十三、FIX-D/AUD2-009：CHLB v2 逐动作归属——两档案同名动作导出→清库→导入往返
 *   十四、FIX-D/AUD2-009：v2 坏包全包 preflight 拒绝（坏 clip/伪造骨架指纹）+ v1 多档案动作进待归档
 *   十五、FIX-I/LIB-1：瞬时读写失败不永久毒化迁移缓存（换好后端重试可恢复、迁移幂等）
 *   十六、FIX-I/LIB-2：旧迁移/老程序备份的空指纹档案按原文回填（round trip 不再误判篡改，防篡改不放松）
 *   十七、FIX-I/LIB-3：v2 catalog 段损坏 → preflight 整体拒绝、零写入、段级中文错误
 *   十八、CHARACTER-ASSETS-P2：页内 GLB 导入（原名整体替换 + 入库 SHA-256 指纹）
 *   十九、P2：glTF+配套导入（多配套基名规则 / data-URI 自包含单文件）
 *   二十、P2：拒绝矩阵（坏 JSON/缺配套/坏魔数/双模型/仅配套/零字节）逐例零写入
 *   二十一、P2：原名套装 CHLB v2 导出→新库导入往返（清单/指纹/入口不漂移、不改成固定名）
 *   二十二、P2：重复导入幂等 + 事务中止恢复（中止后旧套装原样保留）
 *   二十三、P2：并发导入同一档案（两套各整胜出，无混态、元数据不丢）
 *   二十四、P2：写入键白名单（只动目标档案的 pfile 行和 profile meta）
 *   二十五、P3 AC-9：备份重建被删档案沿用原 id（绑定免重绑）
 *   二十六、P4 AC-1：同名动作命名空间隔离（互不覆盖/互不误读/互不牵连删除）
 *   二十七、P4 AC-2：缺省=活动档案、未知 pid 空、空名/非字符串名拒绝零写入、pending 隔离
 *   二十八、P4 AC-3：显式跨档案复制（源行不动/目标重盖章/取消与拒绝零写入/重复幂等）
 *   二十九、P4 AC-4：模型字节内容寻址复用（同内容一份载荷、按内容不按名、零字节拒绝）
 *   三十、P4 AC-5：载荷按幸存引用保留与回收（删一侧另一侧可读、最后引用走即回收）
 *   三十一、P4 AC-6：写中止零残留 + 重试/重复幂等（动作与去重模型两条路）
 *   三十二、P4 AC-7：并发竞态（同键动作写/同字节双档案/删档 vs 读）
 *   三十三、P4 AC-8：CHLB v2 往返（命名空间动作 + 去重模型套装进新库、DB_VERSION 仍 2）
 *   三十四、P4 AC-10：写入键白名单（声明键族之外一个键不碰）
 *   三十五、P5 AC-1：.choreochar 导出（信封解析/清单白名单/排除项扫描/只读/拒绝/两连导出）
 *   三十六、P5 AC-2/AC-6：坏包拒绝矩阵（逐类独立中文原因+零写入）+ 跨类型互拒
 *   三十七、P5 AC-3：收养（新 id/撞名/指针不动/命名空间盖章/去重复用/逐字节读回）
 *   三十八、P5 AC-4：取消/写中止零残留 + 重试 + 重复导入容忍
 *   三十九、P5 AC-5：并发收养/删档/读（全成或全无、无交叉污染）
 *   四十、P5 AC-7：写入键白名单 + 信封常量互斥（无端点/无草稿行/DB_VERSION 仍 2）
 *   四十一、P6 AC-3：满员命名空间/复用（8 舞者×三套异骨架、同名两录、同字节两档、缺录不借）
 *   四十二、P6 AC-4：.choreochar 收养进在场会话（新指纹→新母版/同指纹→并母版/他人不动/坏包零写入）
 *   四十三、P6 AC-6：会话中删档/备份重导/重复重置等价 + 畸形绑定形状 + 写入键白名单复证
 *
 * 假后端只实现资料库实际用到的事务语义：put/get/delete/getAll/getAllKeys/clear、
 * oncomplete/onabort、abort()；可注入"指定 store 写入失败"来模拟配额/中断。
 * profileClips/profileClipData 是复合键仓（[profileId, name]），假后端用 '\u0000' 拼接成 Map 键。
 */

global.window = global;
require('./choreo-edit.js'); // P6：planRender/resolveBindings/setDancerBinding 与产品页同源（会话级断言用）
require('./choreo-library.js');
var ChoreoLibrary = global.ChoreoLibrary;
var CE6 = globalThis.ChoreoEdit;

var passes = 0, fails = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; console.log('  \u2714 ' + name + (detail ? ('\uFF08' + detail + '\uFF09') : '')); }
  else { fails++; console.log('  \u2718 ' + name + (detail ? ('\uFF08' + detail + '\uFF09') : '')); }
}
function section(s) { console.log('== ' + s + ' =='); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

// ---------- 假 IndexedDB 事务后端 ----------
function FakeIDB(opts) {
  this.stores = { meta: new Map(), clips: new Map(), clipdata: new Map(), files: new Map(), profileClips: new Map(), profileClipData: new Map() };
  this.failPut = (opts && opts.failPut) || null; // {store:'clipdata'} → 该 store 的 put 触发事务失败
}
// 各仓主键：meta=id、其余（旧 clips/clipdata/files）=name、档案动作仓=[profileId, name] 复合键
function storeKeyOf(sname, v) {
  if (sname === 'meta') return v.id;
  if (sname === 'profileClips' || sname === 'profileClipData') return v.profileId + '\u0000' + v.name;
  return v.name;
}
function normKey(k) { return Array.isArray(k) ? (k[0] + '\u0000' + k[1]) : k; }
FakeIDB.prototype.transaction = function (names, mode) {
  var self = this;
  names = Array.isArray(names) ? names : [names];
  mode = mode || 'readonly';
  var ops = [], aborted = false, failReq = null;
  function mkReq() { return { onsuccess: null, onerror: null, result: undefined }; }
  var t = {
    mode: mode, error: null,
    objectStore: function (sname) {
      if (names.indexOf(sname) < 0) throw new Error('NotFoundError: ' + sname + ' 不在事务范围');
      var st = self.stores[sname];
      return {
        put: function (v) { var r = mkReq(); ops.push({ req: r, store: sname, run: function () { st.set(storeKeyOf(sname, v), v); } }); return r; },
        delete: function (k) { var r = mkReq(); ops.push({ req: r, store: sname, run: function () { st.delete(normKey(k)); } }); return r; },
        get: function (k) { var r = mkReq(); ops.push({ req: r, store: sname, run: function () { var kk = normKey(k); r.result = st.has(kk) ? st.get(kk) : undefined; } }); return r; },
        getAll: function () { var r = mkReq(); ops.push({ req: r, store: sname, run: function () { r.result = Array.from(st.values()); } }); return r; },
        getAllKeys: function () { var r = mkReq(); ops.push({ req: r, store: sname, run: function () {
          // 真 IndexedDB 复合键仓的 getAllKeys 返回 [profileId, name] 数组；假后端存的是拼接串，这里拆回数组
          r.result = (sname === 'profileClips' || sname === 'profileClipData')
            ? Array.from(st.keys()).map(function (k) { return k.split('\u0000'); })
            : Array.from(st.keys());
        } }); return r; },
        clear: function () { var r = mkReq(); ops.push({ req: r, store: sname, run: function () { st.clear(); } }); return r; }
      };
    },
    abort: function () { aborted = true; }
  };
  setTimeout(function () {
    if (aborted) { t.error = t.error || new Error('AbortError'); if (t.onabort) t.onabort(); return; }
    var failed = false;
    if (mode === 'readwrite' && self.failPut) {
      for (var i = 0; i < ops.length; i++) {
        if (ops[i].store === self.failPut.store) { failed = true; failReq = ops[i]; break; }
      }
    }
    if (failed) {
      t.error = new Error('模拟写入失败（' + failReq.store + '）');
      if (failReq.req.onerror) failReq.req.onerror();
      if (t.onabort) t.onabort();
      return;
    }
    // 用下标循环（不是 forEach）：真 IndexedDB 允许在 onsuccess 回调里继续发请求
    // （如 putProfileFile 的同事务读改写），回调期间追加的请求也要执行
    for (var i = 0; !failed && i < ops.length; i++) {
      var op = ops[i];
      try { op.run(); if (op.req.onsuccess) op.req.onsuccess(); }
      catch (e) { t.error = e; if (op.req.onerror) op.req.onerror(); failed = true; }
    }
    if (failed) { if (t.onabort) t.onabort(); return; }
    if (t.oncomplete) t.oncomplete();
  }, 0);
  return t;
};

function makeClip(sec) {
  // 一条最小但结构合法的 clip（101 骨会太大，测试用 2 骨足够走通编解码路径）
  return { name: 'test', type: 'once', duration: sec || 2, bones: [
    { name: 'j_kosi', keys: [{ t: 0, q: [0, 0, 0, 1], p: [0, 0, 0] }, { t: sec || 2, q: [0, 0.1, 0, 1], p: [0, 0, 0.1] }] },
    { name: 'j_sebo', keys: [{ t: 0, q: [0, 0, 0, 1], p: [0, 0, 0] }] }
  ] };
}

async function run() {
  var fake = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake.transaction(stores, mode); });

  section('一、putClip 原子性');
  var meta = await ChoreoLibrary.putClip('bow', makeClip(2));
  ok('正常写入返回元数据', !!meta && meta.name === 'bow' && meta.enc === 'gzip', 'enc=' + (meta && meta.enc));
  var idx = await ChoreoLibrary.clipIndex();
  ok('索引里有一条，带 hash', idx.length === 1 && /^[0-9a-f]{64}$/.test(idx[0].hash));
  var back = await ChoreoLibrary.getClip('bow');
  ok('getClip 解出原文（gzip 往返无损）', !!back && back.bones.length === 2 && back.duration === 2);

  var fake2 = new FakeIDB({ failPut: { store: 'profileClipData' } });
  ChoreoLibrary.useBackend(function (stores, mode) { return fake2.transaction(stores, mode); });
  var threw = null;
  try { await ChoreoLibrary.putClip('ghost', makeClip(1)); } catch (e) { threw = e; }
  ok('数据侧写入失败 → 整条拒绝', !!threw, threw ? threw.message : '未抛错');
  var idx2 = await ChoreoLibrary.clipIndex();
  ok('失败后不留幽灵元数据（索引为空）', idx2.length === 0, '实际=' + idx2.length);

  var fake3 = new FakeIDB({ failPut: { store: 'profileClips' } });
  ChoreoLibrary.useBackend(function (stores, mode) { return fake3.transaction(stores, mode); });
  threw = null;
  try { await ChoreoLibrary.putClip('ghost', makeClip(1)); } catch (e) { threw = e; }
  ok('元数据侧写入失败 → 整条拒绝', !!threw);
  var dataKeys = Array.from(fake3.stores.profileClipData.keys());
  ok('失败后不留孤儿数据（clipdata 为空）', dataKeys.length === 0, '实际=' + dataKeys.length);

  section('二、putSkeleton 原子性');
  ChoreoLibrary.useBackend(function (stores, mode) { return fake.transaction(stores, mode); });
  await ChoreoLibrary.putSkeleton({ count: 2, bones: [{ name: 'j_kosi' }, { name: 'j_sebo' }] });
  var si = await ChoreoLibrary.getSkeletonInfo();
  ok('骨架指纹可读（hash+骨数）', !!si && si.boneCount === 2 && /^[0-9a-f]{64}$/.test(si.hash));
  var sk = await ChoreoLibrary.getSkeleton();
  ok('骨架原文可读', !!sk && sk.bones.length === 2);

  section('三、备份导出→导入往返');
  // FIX-D：动作按档案隔离后，导出条目带"所属档案"。先把第一节写进「无骨架默认档案」的
  // bow 清掉，再重写进当前活动档案（第二节已 putSkeleton，带骨架），保证备份里
  // "动作+所属档案"成套、导入后能对号
  var profsT = await ChoreoLibrary.listProfiles();
  for (var pt = 0; pt < profsT.length; pt++) {
    if (!profsT[pt].hasSkeleton) await ChoreoLibrary.deleteClip('bow', profsT[pt].id);
  }
  await ChoreoLibrary.putClip('bow', makeClip(2));
  var bundle = await ChoreoLibrary.exportBundle();
  ok('导出产出二进制', bundle && bundle.size > 0, bundle ? bundle.size + 'B' : '');
  var fakeB = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeB.transaction(stores, mode); });
  var rep = await ChoreoLibrary.importBundle(bundle);
  ok('导入 1 条成功 0 失败', rep.clips === 1 && rep.failed.length === 0, 'clips=' + rep.clips + ' 失败=' + rep.failed.length);
  var idxB = await ChoreoLibrary.clipIndex();
  ok('导入后 hash 与原库一致', idxB.length === 1 && idxB[0].hash === idx[0].hash);
  var backB = await ChoreoLibrary.getClip('bow');
  ok('导入后内容与原库逐字段一致', JSON.stringify(backB) === JSON.stringify(back));
  ok('骨架随备份恢复', !!(await ChoreoLibrary.getSkeleton()));

  section('四、坏备份不覆盖健康动作（v2 全包 preflight：一个坏条目=整体拒绝零写入）');
  var buf = new Uint8Array(await bundle.arrayBuffer());
  var dv = new DataView(buf.buffer);
  var headerLen = dv.getUint32(8, true);
  var header = JSON.parse(new TextDecoder().decode(buf.slice(12, 12 + headerLen)));
  var e0 = header.clips[0];
  buf[e0.offset + e0.len - 4] ^= 0xFF; // 篡改 payload 末尾字节（gzip 校验区，解压必失败或内容必变）
  var tampered = new Blob([buf]);
  var threw4 = null;
  try { await ChoreoLibrary.importBundle(tampered); } catch (e) { threw4 = e; }
  ok('篡改条目被拒（v2 preflight 整体拒绝）', !!threw4, threw4 ? threw4.message : '未拦截');
  ok('拒绝后现有资料库原样不动（一个字节都没写）', JSON.stringify(await ChoreoLibrary.getClip('bow')) === JSON.stringify(back));

  section('五、结构坏数据拒绝');
  // 手工拼一个最小 CHLB：一条解压后不是 JSON 的 clip + 一条缺 bones 的 clip
  function gzipSyncBlob(str) {
    var gz = require('zlib').gzipSync(Buffer.from(str, 'utf8'));
    return new Blob([gz]);
  }
  var badPayloads = [gzipSyncBlob('{{{not json'), gzipSyncBlob(JSON.stringify({ foo: 1 }))];
  var off = 0, entries = [];
  var parts = badPayloads.map(function (b) { return b; });
  // 先算 headerLen（两轮定长，与 exportBundle 同套路）
  var hLen = 64, hdr;
  for (var round = 0; round < 8; round++) {
    off = 12 + hLen;
    entries = parts.map(function (b, i) { var en = { name: 'bad' + i, offset: off, len: b.size, enc: 'gzip', hash: '', sizeRaw: 0 }; off += b.size; return en; });
    hdr = JSON.stringify({ formatVersion: 1, schemaVersion: 1, createdAt: Date.now(), clips: entries, files: [] });
    var need = new TextEncoder().encode(hdr).length;
    if (need <= hLen) break;
    hLen = Math.ceil((need + 1) / 64) * 64;
  }
  var headBytes = new TextEncoder().encode(hdr);
  var pad2 = new Uint8Array(hLen - headBytes.length).fill(0x20);
  var magic = new Uint8Array([0x43, 0x48, 0x4C, 0x42]);
  var ver = new Uint8Array([1, 0, 0, 0]);
  var hl = new Uint8Array([hLen & 255, (hLen >> 8) & 255, (hLen >> 16) & 255, (hLen >>> 24) & 255]);
  var headU8 = new Uint8Array(magic.length + ver.length + hl.length + headBytes.length + pad2.length);
  var pos = 0;
  [magic, ver, hl, headBytes, pad2].forEach(function (u) { headU8.set(u, pos); pos += u.length; });
  var badBundle = new Blob([headU8].concat(parts));
  var fakeC = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeC.transaction(stores, mode); });
  var rep3 = await ChoreoLibrary.importBundle(badBundle);
  ok('不是 JSON 的条目被拒', rep3.failed.length === 2 && /JSON/.test(rep3.failed[0].reason), rep3.failed[0] ? rep3.failed[0].reason : '未拦截');
  ok('缺 bones 的条目被拒', /bones/.test(rep3.failed[1].reason), rep3.failed[1] ? rep3.failed[1].reason : '');
  ok('坏条目一个字节都没进库', (await ChoreoLibrary.clipIndex()).length === 0);

  section('六、孤儿修复');
  var fakeD = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeD.transaction(stores, mode); });
  await ChoreoLibrary.putClip('keep', makeClip(1));
  fakeD.stores.clips.set('ghostmeta', { name: 'ghostmeta' });                       // 有元数据没数据
  fakeD.stores.clipdata.set('orphan', { name: 'orphan', data: new Blob(['x']) });   // 有数据没元数据
  ChoreoLibrary.repairOrphans(fakeD);
  await tick(50);
  ok('有元数据没数据的半条被清', !fakeD.stores.clips.has('ghostmeta'));
  ok('有数据没元数据的半条被清', !fakeD.stores.clipdata.has('orphan'));
  ok('健康动作不动', !!(await ChoreoLibrary.getClip('keep')));
  ok('真实 IDB 环境下 repairOrphans 挂到 open 后自动跑（代码路径存在）', typeof ChoreoLibrary.repairOrphans === 'function');

  section('七、clip↔骨架指纹盖章（FIX-4/AUD-013）');
  // 有骨架时写入 → 动作元数据盖上"当时的骨架指纹"，体检据此发现换角色后的错位动作
  ChoreoLibrary.useBackend(function (stores, mode) { return fake.transaction(stores, mode); });
  await ChoreoLibrary.putClip('wave', makeClip(3));
  var si7 = await ChoreoLibrary.getSkeletonInfo();
  var wave7 = (await ChoreoLibrary.clipIndex()).filter(function (r) { return r.name === 'wave'; })[0];
  ok('写入时盖上当前骨架指纹', !!wave7 && /^[0-9a-f]{64}$/.test(wave7.skeletonHash) && wave7.skeletonHash === si7.hash,
    wave7 ? String(wave7.skeletonHash).slice(0, 8) : '无记录');
  // 骨架更新后：旧动作的指纹 ≠ 当前骨架指纹（体检报不一致的依据）
  var oldHash = wave7.skeletonHash;
  await ChoreoLibrary.putSkeleton({ count: 3, bones: [{ name: 'j_kosi' }, { name: 'j_sebo' }, { name: 'j_ashi' }] });
  var curHash = (await ChoreoLibrary.getSkeletonInfo()).hash;
  ok('骨架更新后旧指纹≠当前指纹', !!oldHash && oldHash !== curHash);
  // 无骨架的空库写入 → 指纹留空（体检对没指纹的动作不报，不误报）
  var fake7 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake7.transaction(stores, mode); });
  await ChoreoLibrary.putClip('wave', makeClip(3));
  var idx7b = await ChoreoLibrary.clipIndex();
  ok('无骨架时指纹留空', idx7b.length === 1 && idx7b[0].skeletonHash === '');

  // ============ 角色档案（2026-08-30） ============
  var SKEL_A = { count: 2, bones: [{ i: 0, n: 'j_kosi', p: -1, t: [0, 0.4, 0], q: [0, 0, 0, 1] }, { i: 1, n: 'j_kao', p: 0, t: [0, 0.2, 0], q: [0, 0, 0, 1] }] };
  var SKEL_B = { count: 3, bones: [{ i: 0, n: 'n_root', p: -1, t: [0, 0.9, 0], q: [0, 0, 0, 1] }, { i: 1, n: 'n_hara', p: 0, t: [0, 0.5, 0], q: [0, 0, 0, 1] }, { i: 2, n: 'n_sippo_a', p: 0, t: [0, 0.1, 0], q: [0, 0, 0, 1] }] };
  // 最小合法 glTF（v2 导入会解析 .gltf 检查外部 bin 引用，假模型内容必须是真 glTF）
  var GLTF_A = '{"asset":{"version":"2.0"}}';

  section('八、角色档案：旧数据自动迁移');
  var fakeM = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeM.transaction(stores, mode); });
  // 先按"老版本"的样子灌一套单档案数据（meta.skeleton + 裸文件名模型）。
  // 文件 hash 用真实 SHA-256：CHLB v2 导入会真校验模型文件内容（FIX-D/AUD2-009）
  async function shaHex(str) {
    var d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(d)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  var oldHashM = await ChoreoLibrary.hashObject(SKEL_A);
  fakeM.stores.meta.set('skeleton', { id: 'skeleton', data: SKEL_A, hash: oldHashM, boneCount: 2 });
  fakeM.stores.files.set('model.gltf', { name: 'model.gltf', size: GLTF_A.length, data: new Blob([GLTF_A]), hash: await shaHex(GLTF_A) });
  fakeM.stores.files.set('model.bin', { name: 'model.bin', size: 20, data: new Blob(['binary-bin']), hash: await shaHex('binary-bin') });
  var profsM = await ChoreoLibrary.listProfiles();
  ok('旧单套数据迁移出一个档案', profsM.length === 1 && profsM[0].name === '默认角色' && profsM[0].isActive, profsM.length ? profsM[0].name : '无');
  ok('迁移后骨架指纹保持一致', profsM[0].skeletonHash === oldHashM);
  ok('迁移后模型文件归档案（裸键清掉）', profsM[0].modelNames.indexOf('model.gltf') >= 0 && !fakeM.stores.files.has('model.gltf') && !fakeM.stores.meta.has('skeleton'));
  ok('旧 API 读到的就是档案里的骨架/模型', JSON.stringify(await ChoreoLibrary.getSkeleton()) === JSON.stringify(SKEL_A) && !!(await ChoreoLibrary.getModelFile('model.bin')));
  var profsM2 = await ChoreoLibrary.listProfiles();
  ok('迁移只跑一次（第二次访问不重复建）', profsM2.length === 1);

  section('九、角色档案：建档/切换/重命名/删除');
  var pB = await ChoreoLibrary.createProfile({ name: '新角色', skeleton: SKEL_B });
  ok('建档返回档案（带骨架指纹）', !!pB && pB.name === '新角色' && pB.boneCount === 3 && /^[0-9a-f]{64}$/.test(pB.skeletonHash));
  var profs9 = await ChoreoLibrary.listProfiles();
  ok('建档不抢活动档案（旧指针不动）', profs9.length === 2 && profs9.filter(function (p) { return p.isActive; })[0].name === '默认角色');
  await ChoreoLibrary.putProfileFile(pB.id, 'model.gltf', new Blob(['newbody']));
  ok('档案各自的模型文件互不串', (await ChoreoLibrary.getModelFile('model.gltf')).size === GLTF_A.length && (await ChoreoLibrary.getProfileFile(pB.id, 'model.gltf')).size === 7);
  // gltf/bin 两文件并发回写（preview3d captureModelToProfile 的真实调用方式）不互相覆盖清单
  await Promise.all([
    ChoreoLibrary.putProfileFile(pB.id, 'model.gltf', new Blob(['aaaaaaa'])),
    ChoreoLibrary.putProfileFile(pB.id, 'model.bin', new Blob(['bbbbbbbbbbbb']))
  ]);
  var pBafter = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === pB.id; })[0];
  ok('并发回写两文件清单齐全（竞态回归）', pBafter.modelNames.indexOf('model.gltf') >= 0 && pBafter.modelNames.indexOf('model.bin') >= 0,
    JSON.stringify(pBafter.modelNames));
  await ChoreoLibrary.setActiveProfile(pB.id);
  ok('切档案后旧 API 跟着换人', (await ChoreoLibrary.getSkeletonInfo()).boneCount === 3 && (await ChoreoLibrary.getModelFile('model.gltf')).size === 7);
  await ChoreoLibrary.renameProfile(pB.id, '猫男娘');
  ok('重命名生效', (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === pB.id; })[0].name === '猫男娘');
  var threw9 = null;
  try { await ChoreoLibrary.setActiveProfile('p不存在'); } catch (e) { threw9 = e; }
  ok('切到不存在的档案被拒', !!threw9);
  await ChoreoLibrary.deleteProfile(pB.id);
  var profs9b = await ChoreoLibrary.listProfiles();
  ok('删档案后文件一起没了、指针挪到剩余档案', profs9b.length === 1 && profs9b[0].isActive && profs9b[0].name === '默认角色' &&
    !Array.from(fakeM.stores.files.keys()).some(function (k) { return String(k).indexOf('pfile:' + pB.id + ':') === 0; }));

  // CHARACTER-ASSETS-P3：getProfile(pid) 按 id 读整份档案（含骨架原文），只读
  if (typeof ChoreoLibrary.getProfile === 'function') {
    var gP = await ChoreoLibrary.getProfile(profs9b[0].id);
    ok('P3 getProfile：返回整份档案（含内联骨架原文与指纹）',
      !!gP && gP.id === profs9b[0].id && !!gP.skeleton && gP.skeletonHash === profs9b[0].skeletonHash);
    ok('P3 getProfile：查不到的 id 返回 null（不建档不抛）', (await ChoreoLibrary.getProfile('p不存在')) === null);
    ok('P3 getProfile：非字符串 id 返回 null 不抛', (await ChoreoLibrary.getProfile(null)) === null && (await ChoreoLibrary.getProfile(42)) === null);
  } else {
    ok('P3 getProfile 已导出（红基线：实现前缺失）', false);
  }

  section('十、putSkeleton 自动对号 + 多档案备份往返');
  var r10 = await ChoreoLibrary.putSkeleton(SKEL_B);
  ok('同骨架再入库=对上已有档案', r10.matched === false, '当前库无 SKEL_B（刚删）→ 应新建'); // 刚删掉，应新建
  var r10b = await ChoreoLibrary.putSkeleton(SKEL_B);
  ok('同骨架第二次入库=matched', r10b.matched === true && r10b.id === r10.id);
  // 库里现在两套档案（默认 SKEL_A + 新 SKEL_B），整库备份 → 空库导入 → 两套都回来
  var bundle10 = await ChoreoLibrary.exportBundle();
  var fake10 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake10.transaction(stores, mode); });
  var rep10 = await ChoreoLibrary.importBundle(bundle10);
  var profs10 = await ChoreoLibrary.listProfiles();
  ok('两套档案都恢复', profs10.length === 2, '实际=' + profs10.length);
  ok('恢复后两套骨架指纹齐全', profs10.filter(function (p) { return p.hasSkeleton; }).length === 2);
  ok('恢复后活动档案指向备份主档案', profs10.filter(function (p) { return p.isActive; })[0].skeletonHash === oldHashM,
    profs10.filter(function (p) { return p.isActive; })[0].name);
  ok('导入报告报出档案数', rep10.profiles === 2, 'profiles=' + rep10.profiles);
  // 异体备份导入不整体拒绝：往只有 SKEL_A 的库里导 SKEL_B 备份 → 建新档案，原库不动
  var fake11 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake11.transaction(stores, mode); });
  var local11 = await ChoreoLibrary.putSkeleton(SKEL_A);
  var rep11 = await ChoreoLibrary.importBundle(bundle10);
  var profs11 = await ChoreoLibrary.listProfiles();
  ok('异体备份导入保留本机和两份不同资产档案，不按骨架误合并', rep11.failed.length === 0 && profs11.length === 3
    && profs11.some(function (p) { return p.id === local11.id && p.skeletonHash === oldHashM && p.modelNames.length === 0; })
    && profs11.filter(function (p) { return p.skeletonHash === oldHashM && p.modelNames.length === 2; }).length === 1
    && profs11.filter(function (p) { return p.skeletonHash !== oldHashM; }).length === 1);
  ok('异体导入后活动档案还是原来的', profs11.filter(function (p) { return p.isActive; })[0].skeletonHash === oldHashM);

  // ============ FIX-D：动作按角色档案隔离 + CHLB v2（AUD2-008/009） ============

  section('十一、同名动作按档案隔离（复合键 profileId+name）');
  var fakeS = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeS.transaction(stores, mode); });
  var pSA = await ChoreoLibrary.createProfile({ name: '角色甲', skeleton: SKEL_A });
  var pSB = await ChoreoLibrary.createProfile({ name: '角色乙', skeleton: SKEL_B });
  await ChoreoLibrary.putClip('bow', makeClip(2), pSA.id);
  await ChoreoLibrary.putClip('bow', makeClip(4), pSB.id);
  var bowSA = await ChoreoLibrary.getClip('bow', pSA.id);
  var bowSB = await ChoreoLibrary.getClip('bow', pSB.id);
  ok('两个档案的同名动作各自取到（数据不同）', !!bowSA && !!bowSB && bowSA.duration === 2 && bowSB.duration === 4);
  var iSA = await ChoreoLibrary.clipIndex(pSA.id), iSB = await ChoreoLibrary.clipIndex(pSB.id);
  ok('索引互不串（同名但内容 hash 不同）', iSA.length === 1 && iSB.length === 1 && iSA[0].hash !== iSB[0].hash);
  await ChoreoLibrary.setActiveProfile(pSB.id);
  ok('缺省 API 解析到活动档案（乙的 bow）', (await ChoreoLibrary.getClip('bow')).duration === 4 && (await ChoreoLibrary.clipIndex())[0].duration === 4);
  ok('hasClips 按档案口径', (await ChoreoLibrary.hasClips(['bow'], pSA.id))[0] === true && (await ChoreoLibrary.hasClips(['nope'], pSB.id))[0] === false);
  await ChoreoLibrary.deleteClip('bow', pSA.id);
  ok('删甲的 bow 不影响乙的', (await ChoreoLibrary.getClip('bow', pSA.id)) === null && (await ChoreoLibrary.getClip('bow', pSB.id)).duration === 4);
  var stS = await ChoreoLibrary.stats();
  ok('stats 报出当前档案动作数（乙=1）', stS.clips === 1);

  section('十二、旧全局动作迁移：指纹对号 / 待归档 / 认领');
  var fakeL = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeL.transaction(stores, mode); });
  var pL = await ChoreoLibrary.createProfile({ name: '角色L', skeleton: SKEL_A });
  var hashL = await ChoreoLibrary.hashObject(SKEL_A);
  // 按"老版本"的样子往全局仓灌两条：一条带 SKEL_A 指纹、一条没指纹（都用真 gzip 走完整解压路径）
  function gzBlobOf(clip) { return new Blob([require('zlib').gzipSync(Buffer.from(JSON.stringify(clip), 'utf8'))]); }
  fakeL.stores.clips.set('withhash', { name: 'withhash', type: 'once', duration: 3, hash: '', skeletonHash: hashL, enc: 'gzip', sizeRaw: 0, sizeEnc: 0, updatedAt: 1 });
  fakeL.stores.clipdata.set('withhash', { name: 'withhash', data: gzBlobOf(makeClip(3)) });
  fakeL.stores.clips.set('unknown', { name: 'unknown', type: 'once', duration: 5, hash: '', skeletonHash: '', enc: 'gzip', sizeRaw: 0, sizeEnc: 0, updatedAt: 1 });
  fakeL.stores.clipdata.set('unknown', { name: 'unknown', data: gzBlobOf(makeClip(5)) });
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeL.transaction(stores, mode); }); // 模拟重新打开：迁移重跑
  var idxL = await ChoreoLibrary.clipIndex();
  ok('带指纹且唯一匹配的动作自动归入该档案', idxL.length === 1 && idxL[0].name === 'withhash' && idxL[0].skeletonHash === hashL);
  ok('迁移后取回内容无损', (await ChoreoLibrary.getClip('withhash')).duration === 3);
  ok('旧仓搬空（不双份占空间、幂等不重迁）', fakeL.stores.clips.size === 0 && fakeL.stores.clipdata.size === 0);
  var pendL = await ChoreoLibrary.pendingClipIndex();
  ok('没指纹的动作进待归档（不静默绑定活动档案）', pendL.length === 1 && pendL[0].name === 'unknown');
  var movedL = await ChoreoLibrary.assignPendingClips(['unknown'], pL.id);
  var idxL2 = await ChoreoLibrary.clipIndex(pL.id);
  ok('认领后进档案并盖上该档案骨架指纹', movedL.length === 1 && idxL2.length === 2 &&
    idxL2.filter(function (r) { return r.name === 'unknown'; })[0].skeletonHash === hashL);
  ok('认领后待归档清空', (await ChoreoLibrary.pendingClipIndex()).length === 0);
  // 多套同指纹 → 唯一匹配不成立 → 待归档（绝不猜）
  await ChoreoLibrary.createProfile({ name: '同骨架乙', skeleton: SKEL_A });
  fakeL.stores.clips.set('ambiguous', { name: 'ambiguous', type: 'once', duration: 6, hash: '', skeletonHash: hashL, enc: 'gzip', sizeRaw: 0, sizeEnc: 0, updatedAt: 1 });
  fakeL.stores.clipdata.set('ambiguous', { name: 'ambiguous', data: gzBlobOf(makeClip(6)) });
  ChoreoLibrary.useBackend(function (stores, mode) { return fakeL.transaction(stores, mode); }); // 再触发一次迁移
  var pendL2 = await ChoreoLibrary.pendingClipIndex();
  ok('两套档案同指纹时进待归档（不唯一不猜）', pendL2.some(function (r) { return r.name === 'ambiguous'; }));

  section('十三、CHLB v2：两档案同名动作 导出→清库→导入往返');
  var fake13 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake13.transaction(stores, mode); });
  var p13a = await ChoreoLibrary.createProfile({ name: '甲', skeleton: SKEL_A });
  var p13b = await ChoreoLibrary.createProfile({ name: '乙', skeleton: SKEL_B });
  await ChoreoLibrary.putClip('bow', makeClip(2), p13a.id);
  await ChoreoLibrary.putClip('bow', makeClip(4), p13b.id);
  var bundle13 = await ChoreoLibrary.exportBundle();
  var fake13b = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake13b.transaction(stores, mode); });
  var rep13 = await ChoreoLibrary.importBundle(bundle13);
  var lps13 = await ChoreoLibrary.listProfiles();
  var pid13a = null, pid13b = null;
  var hash13a = await ChoreoLibrary.hashObject(SKEL_A), hash13b = await ChoreoLibrary.hashObject(SKEL_B);
  var pid13a = null, pid13b = null;
  lps13.forEach(function (p) {
    if (p.skeletonHash === hash13a) pid13a = p.id;
    if (p.skeletonHash === hash13b) pid13b = p.id;
  });
  ok('两套档案都恢复、0 待归档（逐动作归属生效）', lps13.length === 2 && rep13.pending === 0 && rep13.clips === 2, 'pending=' + rep13.pending);
  ok('同名动作各回各家（甲=2s 乙=4s）', (await ChoreoLibrary.getClip('bow', pid13a)).duration === 2 &&
    (await ChoreoLibrary.getClip('bow', pid13b)).duration === 4);
  ok('两档案同名动作 hash 仍不同', (await ChoreoLibrary.clipIndex(pid13a))[0].hash !== (await ChoreoLibrary.clipIndex(pid13b))[0].hash);

  // 手工拼 v2 包的工具（和 exportBundle 同套路：头两轮定长）
  function makeBundle(headerObj, blobs) {
    var hLen = 64, hdr;
    for (var round = 0; round < 8; round++) {
      hdr = JSON.stringify(headerObj);
      var need = new TextEncoder().encode(hdr).length;
      if (need <= hLen) break;
      hLen = Math.ceil((need + 1) / 64) * 64;
    }
    // 头里写的 offset 是按"12+hLen"算的，两轮定长后重新校准一遍
    var off = 12 + hLen;
    (headerObj.clips || []).concat(headerObj.files || []).forEach(function (e) { e.offset = off; off += e.len; });
    hdr = JSON.stringify(headerObj);
    var headBytes = new TextEncoder().encode(hdr);
    var pad = new Uint8Array(hLen - headBytes.length).fill(0x20);
    var headU8 = new Uint8Array(12);
    headU8.set([0x43, 0x48, 0x4C, 0x42], 0);
    new DataView(headU8.buffer).setUint32(4, headerObj.__ver || 2, true);
    new DataView(headU8.buffer).setUint32(8, hLen, true);
    return new Blob([headU8, headBytes, pad].concat(blobs));
  }
  async function readHeader(bundle) {
    var buf = new Uint8Array(await bundle.arrayBuffer());
    var dv = new DataView(buf.buffer);
    var headerLen = dv.getUint32(8, true);
    return { buf: buf, header: JSON.parse(new TextDecoder().decode(buf.slice(12, 12 + headerLen))) };
  }

  section('十四、v2 坏包全包拒绝 / 伪造骨架指纹拒绝 / v1 多档案动作进待归档');
  // 就地改头的小工具：新头必须 ≤ 原头长（改 hash 是等长替换，天然满足），数据段偏移不变
  async function withPatchedHeader(bundle, patch) {
    var p = await readHeader(bundle);
    patch(p.header);
    var bytes = new TextEncoder().encode(JSON.stringify(p.header));
    var origLen = new DataView(p.buf.buffer).getUint32(8, true);
    if (bytes.length > origLen) throw new Error('测试包头部超长（不应发生）');
    p.buf.set(bytes, 12);
    for (var i = bytes.length; i < origLen; i++) p.buf[12 + i] = 0x20;
    return new Blob([p.buf]);
  }
  // ① 篡改 clip hash → preflight 整体拒绝，原库不变
  var fake14 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake14.transaction(stores, mode); });
  await ChoreoLibrary.putSkeleton(SKEL_A); // 先放点东西，验证坏包不会碰它
  var before14 = await ChoreoLibrary.clipIndex();
  var threw14 = null;
  try {
    await ChoreoLibrary.importBundle(await withPatchedHeader(bundle13, function (h) {
      h.clips[0].hash = new Array(65).join('0'); // 64 个 0 ≠ 真实 hash
    }));
  } catch (e) { threw14 = e; }
  ok('篡改 clip hash → v2 导入整体拒绝', !!threw14, threw14 ? threw14.message : '未拦截');
  ok('拒绝后原库动作一个不少', (await ChoreoLibrary.clipIndex()).length === before14.length);
  // ② 伪造档案骨架指纹（头里的 hash ≠ 骨架原文的 hash）→ 拒绝
  var threw14b = null;
  try {
    await ChoreoLibrary.importBundle(await withPatchedHeader(bundle13, function (h) {
      h.profiles[0].skeletonHash = h.profiles[0].skeletonHash.split('').reverse().join('');
    }));
  } catch (e) { threw14b = e; }
  ok('伪造 header skeletonHash 与骨架原文不符 → 拒绝', !!threw14b, threw14b ? threw14b.message : '未拦截');
  // ③ v1 多档案备份：动作无归属 → 全部进待归档（不统一盖任何一副骨架）
  var skelABytes = new TextEncoder().encode(JSON.stringify(SKEL_A));
  var skelBBytes = new TextEncoder().encode(JSON.stringify(SKEL_B));
  var clipA = gzBlobOf(makeClip(2)), clipB = gzBlobOf(makeClip(4));
  var hLen1 = 64, hdr1;
  for (var r = 0; r < 8; r++) {
    hdr1 = JSON.stringify({
      formatVersion: 1, schemaVersion: 1, createdAt: Date.now(),
      clips: [
        { name: 'bow', offset: 12 + hLen1, len: clipA.size, enc: 'gzip', hash: '', sizeRaw: 0 },
        { name: 'wave', offset: 12 + hLen1 + clipA.size, len: clipB.size, enc: 'gzip', hash: '', sizeRaw: 0 }
      ], files: [],
      profiles: [
        { id: 'bpA', name: '备份甲', skeletonHash: await ChoreoLibrary.hashObject(SKEL_A), boneCount: 2, skeleton: { offset: 12 + hLen1 + clipA.size + clipB.size, len: skelABytes.length } },
        { id: 'bpB', name: '备份乙', skeletonHash: await ChoreoLibrary.hashObject(SKEL_B), boneCount: 3, skeleton: { offset: 12 + hLen1 + clipA.size + clipB.size + skelABytes.length, len: skelBBytes.length } }
      ]
    });
    var need1 = new TextEncoder().encode(hdr1).length;
    if (need1 <= hLen1) break;
    hLen1 = Math.ceil((need1 + 1) / 64) * 64;
  }
  var v1Bundle = makeBundle(JSON.parse(hdr1), [clipA, clipB, new Blob([skelABytes]), new Blob([skelBBytes])]);
  // makeBundle 会按 v2 重写版本号——手工换成 v1 的头（v1 头里 offset 已按 12+hLen1 算好）
  var v1Buf = new Uint8Array(await v1Bundle.arrayBuffer());
  new DataView(v1Buf.buffer).setUint32(4, 1, true);
  var fake14c = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake14c.transaction(stores, mode); });
  var rep14c = await ChoreoLibrary.importBundle(new Blob([v1Buf]));
  ok('v1 多档案备份：动作全部进待归档', rep14c.failed.length === 0 && rep14c.pending === 2 && rep14c.clips === 2,
    'pending=' + rep14c.pending + ' clips=' + rep14c.clips);
  ok('待归档动作读得到（等主人认领）', (await ChoreoLibrary.pendingClipIndex()).length === 2);
  ok('v1 多档案的两套骨架档案都建了', (await ChoreoLibrary.listProfiles()).length === 2);
  // ④ v1 单档案备份：动作归入那套唯一档案（老备份正常升级路径）
  var hdr2Obj = {
    formatVersion: 1, schemaVersion: 1, createdAt: Date.now(),
    clips: [{ name: 'bow', offset: 0, len: clipA.size, enc: 'gzip', hash: '', sizeRaw: 0 }],
    files: [],
    profiles: [{ id: 'bpA', name: '备份甲', skeletonHash: await ChoreoLibrary.hashObject(SKEL_A), boneCount: 2, skeleton: { offset: 0, len: 0 } }]
  };
  var hLen2 = 64, hdr2;
  for (var r2 = 0; r2 < 8; r2++) {
    hdr2Obj.profiles[0].skeleton.offset = 12 + hLen2 + clipA.size;
    hdr2Obj.profiles[0].skeleton.len = skelABytes.length;
    hdr2Obj.clips[0].offset = 12 + hLen2;
    hdr2 = JSON.stringify(hdr2Obj);
    var need2 = new TextEncoder().encode(hdr2).length;
    if (need2 <= hLen2) break;
    hLen2 = Math.ceil((need2 + 1) / 64) * 64;
  }
  var fake14d = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake14d.transaction(stores, mode); });
  hdr2Obj.__ver = 1; // 手工 v1 包：版本号写 1（makeBundle 默认写 2）
  var rep14d = await ChoreoLibrary.importBundle(makeBundle(hdr2Obj, [clipA, new Blob([skelABytes])]));
  var profs14d = await ChoreoLibrary.listProfiles();
  ok('v1 单档案备份：动作归入那套唯一档案（0 待归档）', rep14d.failed.length === 0 && rep14d.pending === 0 && rep14d.clips === 1,
    'pending=' + rep14d.pending);
  var hash14d = await ChoreoLibrary.hashObject(SKEL_A);
  var pid14d = null;
  profs14d.forEach(function (p) { if (p.skeletonHash === hash14d) pid14d = p.id; });
  ok('v1 单档案动作可读、盖了档案指纹', (await ChoreoLibrary.getClip('bow', pid14d)).duration === 2 &&
    (await ChoreoLibrary.clipIndex(pid14d))[0].skeletonHash === await ChoreoLibrary.hashObject(SKEL_A));

  // ============ FIX-I：库鲁棒性（可重试迁移 / 空指纹回填 / catalog 进 preflight） ============

  section('十五、FIX-I/LIB-1：瞬时读写失败不永久毒化迁移缓存（同一会话内重试可恢复）');
  var fakeR = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fakeR.transaction(s, m); });
  var pR = await ChoreoLibrary.createProfile({ name: '重试角色', skeleton: SKEL_A });
  var hashR = await ChoreoLibrary.hashObject(SKEL_A);
  // 按旧版形态塞一条带该档案指纹的全局动作（下次访问触发迁移）
  fakeR.stores.clips.set('legacy', { name: 'legacy', type: 'once', duration: 3, hash: '', skeletonHash: hashR, enc: 'gzip', sizeRaw: 0, sizeEnc: 0, updatedAt: 1 });
  fakeR.stores.clipdata.set('legacy', { name: 'legacy', data: gzBlobOf(makeClip(3)) });
  // 瞬时故障开关：开着时所有请求都失败（模拟配额/连接中断），关掉后同一后端恢复。
  // 关键：恢复后不调 useDb/useBackend——页面场景里没有任何人会替你清迁移缓存
  var down15 = true;
  function downTx15() {
    return { mode: 'readonly', error: null, abort: function () {}, objectStore: function () {
      function badReq() { var r = { onsuccess: null, onerror: null, result: undefined }; setTimeout(function () { if (r.onerror) r.onerror(new Error('模拟瞬时读写失败')); }, 0); return r; }
      return { put: badReq, delete: badReq, get: badReq, getAll: badReq, getAllKeys: badReq, clear: badReq };
    } };
  }
  ChoreoLibrary.useBackend(function (s, m) { return down15 ? downTx15() : fakeR.transaction(s, m); });
  var threw15 = null;
  try { await ChoreoLibrary.clipIndex(); } catch (e) { threw15 = e; }
  ok('迁移期读取失败如实报错', !!threw15, threw15 ? threw15.message : '未抛错');
  down15 = false; // 故障恢复，直接重试（修复点：拒绝过的迁移 promise 不再被缓存到会话结束）
  var idx15 = null;
  try { idx15 = await ChoreoLibrary.clipIndex(); } catch (e) { idx15 = null; }
  ok('故障恢复后重试成功、迁移幂等完成', !!idx15 && idx15.length === 1 && idx15[0].name === 'legacy' && idx15[0].skeletonHash === hashR,
    idx15 ? (idx15.length ? idx15[0].name : '索引空') : '仍被缓存的拒绝挡住');
  ok('重试后旧仓搬空（迁移不重复执行）', fakeR.stores.clips.size === 0 && fakeR.stores.clipdata.size === 0,
    'clips=' + fakeR.stores.clips.size + ' clipdata=' + fakeR.stores.clipdata.size);
  // ensureProfiles 同理：档案迁移第一次失败 → 故障恢复后能重试迁出「默认角色」
  var fakeR2 = new FakeIDB();
  fakeR2.stores.meta.set('skeleton', { id: 'skeleton', data: SKEL_B, hash: await ChoreoLibrary.hashObject(SKEL_B), boneCount: 3 });
  var down15b = true;
  ChoreoLibrary.useBackend(function (s, m) { return down15b ? downTx15() : fakeR2.transaction(s, m); });
  var threw15b = null;
  try { await ChoreoLibrary.listProfiles(); } catch (e) { threw15b = e; }
  ok('档案迁移读失败如实报错', !!threw15b);
  down15b = false;
  var lps15 = null;
  try { lps15 = await ChoreoLibrary.listProfiles(); } catch (e) { lps15 = null; }
  ok('档案迁移缓存可重试（旧单套数据迁出「默认角色」）', !!lps15 && lps15.length === 1 && lps15[0].name === '默认角色' &&
    lps15[0].skeletonHash === await ChoreoLibrary.hashObject(SKEL_B), lps15 ? lps15.length + ' 套' : '仍被缓存的拒绝挡住');

  section('十六、FIX-I/LIB-2：旧迁移/老程序产生的空指纹档案（自导自 round trip 不再误判篡改）');
  var hashA16 = await ChoreoLibrary.hashObject(SKEL_A);
  // ① 按"老版本程序"的落库形态灌库：meta.skeleton 有原文但没有 hash 字段 → 迁移建档时就回填
  var fake16 = new FakeIDB();
  fake16.stores.meta.set('skeleton', { id: 'skeleton', data: SKEL_A, hash: '', boneCount: 2 });
  ChoreoLibrary.useBackend(function (s, m) { return fake16.transaction(s, m); });
  var lps16 = await ChoreoLibrary.listProfiles(); // 触发旧数据迁移
  ok('迁移建档时用骨架原文回填指纹', lps16.length === 1 && lps16[0].skeletonHash === hashA16,
    lps16.length ? String(lps16[0].skeletonHash).slice(0, 8) || '(空)' : '无档案');
  // ② 老代码已经落库的空指纹档案（存量脏数据）：读取时回填并落库
  var fake16b = new FakeIDB();
  fake16b.stores.meta.set('profile:pX1', { id: 'profile:pX1', data: { id: 'pX1', name: '老档案', createdAt: 1, updatedAt: 1, skeletonHash: '', boneCount: 2, skeleton: SKEL_A, modelNames: [] } });
  fake16b.stores.meta.set('activeProfile', { id: 'activeProfile', pid: 'pX1' });
  ChoreoLibrary.useBackend(function (s, m) { return fake16b.transaction(s, m); });
  var lps16b = await ChoreoLibrary.listProfiles();
  ok('存量空指纹档案读取时回填', lps16b.length === 1 && lps16b[0].skeletonHash === hashA16,
    lps16b.length ? String(lps16b[0].skeletonHash).slice(0, 8) || '(空)' : '无档案');
  ok('回填已落库（下次直读 meta 也是真指纹）', fake16b.stores.meta.get('profile:pX1').data.skeletonHash === hashA16);
  // ③ 老版本程序导出的备份：头里档案骨架指纹是空的 → 以前 preflight 会误判"备份可能被篡改"
  ChoreoLibrary.useBackend(function (s, m) { return fake16.transaction(s, m); });
  await ChoreoLibrary.putClip('bow', makeClip(2));
  var bundle16 = await ChoreoLibrary.exportBundle();
  var patched16 = await withPatchedHeader(bundle16, function (h) {
    (h.profiles || []).forEach(function (p) { p.skeletonHash = ''; });
    if (h.skeleton) h.skeleton.hash = '';
  });
  var fake16c = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake16c.transaction(s, m); });
  var threw16 = null, rep16 = null;
  try { rep16 = await ChoreoLibrary.importBundle(patched16); } catch (e) { threw16 = e; }
  ok('头里无指纹的档案骨架照常导入（不再误判篡改）', !threw16 && !!rep16 && rep16.profiles >= 1 && rep16.failed.length === 0,
    threw16 ? threw16.message : 'profiles=' + (rep16 && rep16.profiles));
  var lps16c = await ChoreoLibrary.listProfiles();
  ok('导入后档案指纹按骨架原文算出', lps16c.length === 1 && lps16c[0].skeletonHash === hashA16);
  // ④ 防篡改不放松：非空指纹与内容对不上仍然拒绝、零写入
  var fake16d = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake16d.transaction(s, m); });
  await ChoreoLibrary.putSkeleton(SKEL_B); // 先放点东西，验证拒绝时原库不动
  var n16d = (await ChoreoLibrary.listProfiles()).length;
  var threw16d = null;
  try {
    await ChoreoLibrary.importBundle(await withPatchedHeader(bundle16, function (h) {
      h.profiles[0].skeletonHash = h.profiles[0].skeletonHash.split('').reverse().join('');
    }));
  } catch (e) { threw16d = e; }
  ok('非空指纹与内容对不上仍然拒绝（诚实防篡改）', !!threw16d, threw16d ? threw16d.message : '未拦截');
  ok('拒绝后原库档案不变', (await ChoreoLibrary.listProfiles()).length === n16d);

  section('十七、FIX-I/LIB-3：v2 catalog 段损坏 → preflight 整体拒绝、零写入、段级中文错误');
  // 造一个带目录的健康包（档案骨架用 SKEL_B：与后面"原库"的 SKEL_A 不同，
  // 这样坏包若真写了库，档案数会变——零写入断言才抓得住"先写库后炸目录"）
  var fake17 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake17.transaction(s, m); });
  await ChoreoLibrary.putSkeleton(SKEL_B);
  await ChoreoLibrary.putCatalog({ emotes: [{ name: 'bow', text: '/bow', category: 'usual' }], normal: [], pvp: [] });
  await ChoreoLibrary.putClip('wave', makeClip(2));
  var bundle17 = await ChoreoLibrary.exportBundle();
  var p17 = await readHeader(bundle17);
  ok('导出包含 catalog 段', !!(p17.header.catalog && p17.header.catalog.len > 0));
  // ① catalog 段塞成不是 JSON 的垃圾（等长覆写）→ 整体拒绝、原库零写入
  var catOff = p17.header.catalog.offset, catLen = p17.header.catalog.len;
  var junk17 = new TextEncoder().encode('{{{not-catalog-json');
  for (var j17 = 0; j17 < junk17.length && j17 < catLen; j17++) p17.buf[catOff + j17] = junk17[j17];
  var fake17b = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake17b.transaction(s, m); });
  await ChoreoLibrary.putSkeleton(SKEL_A);
  await ChoreoLibrary.putClip('keep', makeClip(1));
  var before17 = await ChoreoLibrary.clipIndex();
  var threw17 = null;
  try { await ChoreoLibrary.importBundle(new Blob([p17.buf])); } catch (e) { threw17 = e; }
  ok('catalog 段损坏 → v2 导入整体拒绝', !!threw17, threw17 ? threw17.message : '未拦截');
  ok('错误指明是目录段（不会被误报成动作损坏）', !!threw17 && /目录/.test(threw17.message), threw17 ? threw17.message : '');
  ok('零写入：原库动作原样', JSON.stringify(await ChoreoLibrary.clipIndex()) === JSON.stringify(before17));
  ok('零写入：原库档案原样', (await ChoreoLibrary.listProfiles()).length === 1);
  // ② catalog 是合法 JSON 但结构不对（缺 emotes）→ 同样在写库前拒绝
  var p17b = await readHeader(bundle17);
  var shapeBad17 = new TextEncoder().encode(JSON.stringify({ foo: 1 }));
  for (var k17 = 0; k17 < shapeBad17.length; k17++) p17b.buf[p17b.header.catalog.offset + k17] = shapeBad17[k17];
  for (var k17b = shapeBad17.length; k17b < p17b.header.catalog.len; k17b++) p17b.buf[p17b.header.catalog.offset + k17b] = 0x20; // 尾随空格 JSON 合法
  var threw17b = null;
  try { await ChoreoLibrary.importBundle(new Blob([p17b.buf])); } catch (e) { threw17b = e; }
  ok('catalog 缺 emotes 清单 → 拒绝', !!threw17b, threw17b ? threw17b.message : '未拦截');
  // ③ 健康 catalog 照常导入（加严不误伤）
  var fake17c = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake17c.transaction(s, m); });
  var rep17 = await ChoreoLibrary.importBundle(bundle17);
  ok('健康包不受影响（1 档案 1 动作 0 失败）', rep17.profiles === 1 && rep17.clips === 1 && rep17.failed.length === 0,
    'profiles=' + rep17.profiles + ' clips=' + rep17.clips + ' 失败=' + rep17.failed.length);
  ok('目录照常导入', !!(await ChoreoLibrary.getCatalog()));

  // ============ CHARACTER-ASSETS-P2：页内直接导入模型套装（importModelSet） ============

  // 二进制内容的 SHA-256（八节的 shaHex 只管字符串；GLB 是真二进制）
  async function shaBytes(u8) {
    var d = await crypto.subtle.digest('SHA-256', u8);
    return Array.from(new Uint8Array(d)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  // 最小 GLB：魔数 "glTF" + 版本 2 + 长度头 + 一段填充字节（够验魔数即可，不需要真能解析）
  function glbBytes(n) {
    var u8 = new Uint8Array(12 + (n || 8));
    u8.set([0x67, 0x6C, 0x54, 0x46], 0);
    new DataView(u8.buffer).setUint32(4, 2, true);
    new DataView(u8.buffer).setUint32(8, u8.length, true);
    for (var i = 12; i < u8.length; i++) u8[i] = i & 0xFF;
    return u8;
  }
  // 全库快照（Blob 记成占位）：逐例"零写入"断言用
  function snapStore(fake) {
    var out = {};
    Object.keys(fake.stores).forEach(function (sn) {
      var m = {};
      fake.stores[sn].forEach(function (v, k) {
        var copy = {};
        Object.keys(v).forEach(function (f) {
          var val = v[f];
          copy[f] = (val && typeof val === 'object' && typeof val.arrayBuffer === 'function') ? ('Blob(' + val.size + ')') : val;
        });
        m[k] = copy;
      });
      out[sn] = m;
    });
    return JSON.stringify(out);
  }
  function sortNames(a) { return a.slice().sort(); }
  async function expectImportReject(fake, pid, files, label, nameInMsg) {
    var before = snapStore(fake);
    var e = null;
    try { await ChoreoLibrary.importModelSet(pid, files); } catch (err) { e = err; }
    ok(label + ' → 拒绝', !!e && !!e.message, e ? e.message : '未拦截');
    if (nameInMsg) ok(label + ' → 错误点名涉事文件', !!e && e.message.indexOf(nameInMsg) >= 0, e ? e.message : '');
    ok(label + ' → 零写入（库快照逐字节不变）', snapStore(fake) === before);
  }

  section('十八、P2：页内 GLB 导入（原名整体替换 + 入库指纹）');
  var fake18 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake18.transaction(s, m); });
  var p18 = await ChoreoLibrary.createProfile({ name: '导入目标', skeleton: SKEL_A });
  await ChoreoLibrary.putProfileFile(p18.id, 'model.gltf', new Blob(['old-model']));
  await ChoreoLibrary.putProfileFile(p18.id, 'model.bin', new Blob(['old-bin']));
  var GLB18 = glbBytes(16);
  var r18 = await ChoreoLibrary.importModelSet(p18.id, [{ name: '我的角色.glb', blob: new Blob([GLB18]) }]);
  ok('导入返回入口与清单（原始文件名）', !!r18 && r18.pid === p18.id && r18.entry === '我的角色.glb' &&
    sortNames(r18.names).join(',') === '我的角色.glb');
  var rec18 = fake18.stores.files.get('pfile:' + p18.id + ':我的角色.glb');
  ok('按原始文件名存成 pfile 行', !!rec18 && rec18.size === GLB18.length);
  ok('入库指纹 = 所选字节的 SHA-256', !!rec18 && rec18.hash === await shaBytes(GLB18),
    rec18 ? String(rec18.hash).slice(0, 8) : '无记录');
  ok('旧模型文件行同事务删除', !fake18.stores.files.has('pfile:' + p18.id + ':model.gltf') &&
    !fake18.stores.files.has('pfile:' + p18.id + ':model.bin'));
  var prof18 = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === p18.id; })[0];
  ok('modelNames 恰好等于导入清单', JSON.stringify(prof18.modelNames) === JSON.stringify(['我的角色.glb']),
    JSON.stringify(prof18.modelNames));
  ok('档案骨架原样保留（导入不碰骨架）', prof18.skeletonHash === await ChoreoLibrary.hashObject(SKEL_A));

  section('十九、P2：glTF+配套导入（多配套基名规则 / data-URI 自包含）');
  var fake19 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake19.transaction(s, m); });
  var p19 = await ChoreoLibrary.createProfile({ name: 'Meddle 角色', skeleton: SKEL_B });
  var BIN_X = 'xxxx-bin-x', BIN_T = 'tttt-bin-two';
  var GLTF_MID = JSON.stringify({
    asset: { version: '2.0' },
    buffers: [
      { uri: 'textures/x.bin?v=2' },                              // 带路径段+query → 基名 x.bin
      { uri: 'sub/dir/two.bin' },                                 // 带路径段 → 基名 two.bin
      { uri: 'data:application/octet-stream;base64,AAAA' }        // 内嵌 data: → 豁免
    ]
  });
  var r19 = await ChoreoLibrary.importModelSet(p19.id, [
    { name: 'mid.gltf', blob: new Blob([GLTF_MID]) },
    { name: 'x.bin', blob: new Blob([BIN_X]) },
    { name: 'two.bin', blob: new Blob([BIN_T]) }
  ]);
  ok('glTF+多配套整套装入（入口=所挑 .gltf）', !!r19 && r19.entry === 'mid.gltf' &&
    sortNames(r19.names).join(',') === sortNames(['mid.gltf', 'x.bin', 'two.bin']).join(','));
  var infoX = await ChoreoLibrary.getProfileFileInfo(p19.id, 'x.bin');
  var infoT = await ChoreoLibrary.getProfileFileInfo(p19.id, 'two.bin');
  ok('每个文件按原名入库且带指纹', !!(await ChoreoLibrary.getProfileFileInfo(p19.id, 'mid.gltf')) &&
    !!infoX && !!infoT && /^[0-9a-f]{64}$/.test(infoX.hash) && /^[0-9a-f]{64}$/.test(infoT.hash));
  ok('配套文件指纹逐字节正确', infoX.hash === await shaBytes(new TextEncoder().encode(BIN_X)) &&
    infoT.hash === await shaBytes(new TextEncoder().encode(BIN_T)));
  var prof19 = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === p19.id; })[0];
  ok('modelNames 恰好等于所挑集合', sortNames(prof19.modelNames).join(',') === sortNames(['mid.gltf', 'x.bin', 'two.bin']).join(','));
  // data-URI 自包含 .gltf：单文件就是一整套
  var GLTF_SELF = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] });
  var r19b = await ChoreoLibrary.importModelSet(p19.id, [{ name: 'self.gltf', blob: new Blob([GLTF_SELF]) }]);
  ok('自包含 .gltf（仅 data: 内嵌）单文件整套导入', !!r19b && r19b.entry === 'self.gltf' &&
    sortNames(r19b.names).join(',') === 'self.gltf');
  ok('替换后旧套装行清干净', !fake19.stores.files.has('pfile:' + p19.id + ':mid.gltf') &&
    !fake19.stores.files.has('pfile:' + p19.id + ':x.bin') && !fake19.stores.files.has('pfile:' + p19.id + ':two.bin'));

  section('二十、P2：拒绝矩阵（校验先于任何写入）');
  var fake20 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake20.transaction(s, m); });
  var p20 = await ChoreoLibrary.createProfile({ name: '拒绝矩阵', skeleton: SKEL_A });
  await ChoreoLibrary.putProfileFile(p20.id, 'model.gltf', new Blob(['prior-gltf']));
  await ChoreoLibrary.putProfileFile(p20.id, 'model.bin', new Blob(['prior-bin']));
  var GLTF20 = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin' }] });
  await expectImportReject(fake20, p20.id, [{ name: 'bad.gltf', blob: new Blob(['{{{not json']) }],
    '(a) .gltf 不是 JSON', 'bad.gltf');
  await expectImportReject(fake20, p20.id, [{ name: 'empty.gltf', blob: new Blob([]) }],
    '(a/f) 零字节 .gltf', 'empty.gltf');
  // (b) 缺配套——即使缺的配套档案里已经有同名文件（同一操作规则）：上面 profile 里已有 model.bin
  await expectImportReject(fake20, p20.id, [{ name: 'mid2.gltf', blob: new Blob([GLTF20]) }],
    '(b) 缺配套（库里已有同名文件也不算）', 'model.bin');
  var BAD_GLB = new Uint8Array([0x58, 0x58, 0x58, 0x58, 1, 2, 3, 4]);
  await expectImportReject(fake20, p20.id, [{ name: 'fake.glb', blob: new Blob([BAD_GLB]) }],
    '(c) .glb 文件头不是 glTF 魔数', 'fake.glb');
  await expectImportReject(fake20, p20.id, [{ name: 'zero.glb', blob: new Blob([]) }],
    '(c/f) 零字节 .glb', 'zero.glb');
  await expectImportReject(fake20, p20.id, [
    { name: 'a.glb', blob: new Blob([glbBytes(4)]) }, { name: 'b.gltf', blob: new Blob([GLTF_SELF]) }
  ], '(d) 一套里同时有 .glb 和 .gltf', null);
  await expectImportReject(fake20, p20.id, [{ name: 'only.bin', blob: new Blob(['lonely-bin']) }],
    '(e) 只有配套文件（没有模型文档）', null);
  await expectImportReject(fake20, p20.id, [
    { name: 'mid3.gltf', blob: new Blob([GLTF20]) }, { name: 'model.bin', blob: new Blob([]) }
  ], '(f) 配套文件是零字节', 'model.bin');
  await expectImportReject(fake20, p20.id, [
    { name: 'a.gltf', blob: new Blob([GLTF_SELF]) }, { name: 'b.gltf', blob: new Blob([GLTF_SELF]) }
  ], '(超集) 一套里两个 .gltf 模型文档', null);
  ok('全套拒绝之后档案模型原样（旧固定名套装还在）',
    !!(await ChoreoLibrary.getProfileFileInfo(p20.id, 'model.gltf')) &&
    !!(await ChoreoLibrary.getProfileFileInfo(p20.id, 'model.bin')));

  section('二十一、P2：原名套装 CHLB v2 导出→新库导入往返');
  var fake21 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake21.transaction(s, m); });
  var p21 = await ChoreoLibrary.createProfile({ name: '往返角色', skeleton: SKEL_A });
  var GLTF21 = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mid.bin' }] });
  await ChoreoLibrary.importModelSet(p21.id, [
    { name: 'mid.gltf', blob: new Blob([GLTF21]) }, { name: 'mid.bin', blob: new Blob(['roundtrip-bin']) }
  ]);
  var bundle21 = await ChoreoLibrary.exportBundle();
  var fake21b = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake21b.transaction(s, m); });
  var rep21 = await ChoreoLibrary.importBundle(bundle21);
  ok('往返导入 0 失败（glTF↔bin 配对经 preflight 基名规则复验）', rep21.failed.length === 0,
    'failed=' + rep21.failed.length);
  var hash21 = await ChoreoLibrary.hashObject(SKEL_A);
  var p21b = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.skeletonHash === hash21; })[0];
  ok('往返后档案模型清单逐名相等（不改成固定名）',
    !!p21b && sortNames(p21b.modelNames).join(',') === sortNames(['mid.gltf', 'mid.bin']).join(','),
    p21b ? JSON.stringify(p21b.modelNames) : '档案未恢复');
  var f21g = await ChoreoLibrary.getProfileFileInfo(p21b.id, 'mid.gltf');
  var f21b = await ChoreoLibrary.getProfileFileInfo(p21b.id, 'mid.bin');
  ok('往返后文件内容指纹与导出侧一致',
    !!f21g && f21g.hash === await shaBytes(new TextEncoder().encode(GLTF21)) &&
    !!f21b && f21b.hash === await shaBytes(new TextEncoder().encode('roundtrip-bin')));
  ok('往返后没有固定名改名（无 model.gltf/model.bin 行）',
    !fake21b.stores.files.has('pfile:' + p21b.id + ':model.gltf') && !fake21b.stores.files.has('pfile:' + p21b.id + ':model.bin'));

  section('二十二、P2：重复导入幂等 + 事务中止恢复');
  var fake22 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake22.transaction(s, m); });
  var p22 = await ChoreoLibrary.createProfile({ name: '幂等角色', skeleton: SKEL_B });
  await ChoreoLibrary.putProfileFile(p22.id, 'model.glb', new Blob(['prior-set']));
  var SET22 = [{ name: 'm.glb', blob: new Blob([glbBytes(12)]) }];
  var r22a = await ChoreoLibrary.importModelSet(p22.id, SET22);
  var rows22a = Array.from(fake22.stores.files.keys()).filter(function (k) { return String(k).indexOf('pfile:' + p22.id + ':') === 0; }).sort();
  var r22b = await ChoreoLibrary.importModelSet(p22.id, SET22);
  var rows22b = Array.from(fake22.stores.files.keys()).filter(function (k) { return String(k).indexOf('pfile:' + p22.id + ':') === 0; }).sort();
  ok('重复导入终态相等（行键不多不少）', JSON.stringify(rows22a) === JSON.stringify(rows22b) && rows22b.length === 1,
    rows22b.join(','));
  ok('重复导入指纹/入口不变（无重复无孤儿行）', r22a.entry === r22b.entry && r22a.files[0].hash === r22b.files[0].hash &&
    (await ChoreoLibrary.getProfileFileInfo(p22.id, 'm.glb')).hash === r22a.files[0].hash);
  // 事务中止注入：写入事务在 files 仓阶段被中止 → 整体拒绝、旧套装原样保留
  var fake22b = new FakeIDB({ failPut: { store: 'files' } });
  ChoreoLibrary.useBackend(function (s, m) { return fake22b.transaction(s, m); });
  var p22b = await ChoreoLibrary.createProfile({ name: '中止角色', skeleton: SKEL_A });
  ChoreoLibrary.useBackend(function (s, m) { return fake22b.transaction(s, m); });
  await ChoreoLibrary.putProfileFile(p22b.id, 'model.gltf', new Blob(['keep-me']));
  var snap22 = snapStore(fake22b);
  var e22 = null;
  try { await ChoreoLibrary.importModelSet(p22b.id, [{ name: 'n.glb', blob: new Blob([glbBytes(6)]) }]); } catch (e) { e22 = e; }
  ok('事务中止 → 导入如实报错', !!e22, e22 ? e22.message : '未抛错');
  ok('中止后旧套装原样（无混态：无孤儿/半套，重试无需清理）', snapStore(fake22b) === snap22 &&
    !!(await ChoreoLibrary.getProfileFileInfo(p22b.id, 'model.gltf')));

  section('二十三、P2：并发导入同一档案（无混态、元数据不丢）');
  var fake23 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake23.transaction(s, m); });
  var p23 = await ChoreoLibrary.createProfile({ name: '并发角色', skeleton: SKEL_A });
  await ChoreoLibrary.putProfileFile(p23.id, 'model.glb', new Blob(['prior']));
  var SET_A23 = [{ name: 'a.glb', blob: new Blob([glbBytes(10)]) }];
  var GLTF23 = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'b.bin' }] });
  var SET_B23 = [{ name: 'b.gltf', blob: new Blob([GLTF23]) }, { name: 'b.bin', blob: new Blob(['bbb-bin']) }];
  var wrap23 = function (p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); };
  var rs23 = await Promise.all([
    wrap23(ChoreoLibrary.importModelSet(p23.id, SET_A23)),
    wrap23(ChoreoLibrary.importModelSet(p23.id, SET_B23))
  ]);
  ok('两笔并发各自如实报告（都成功或失败有因）', rs23.every(function (x) { return x.ok; }),
    rs23.map(function (x) { return x.ok ? '成功' : ('失败:' + x.e.message); }).join(' / '));
  var rows23 = Array.from(fake23.stores.files.keys()).filter(function (k) { return String(k).indexOf('pfile:' + p23.id + ':') === 0; }).sort();
  var namesA23 = sortNames(SET_A23.map(function (f) { return f.name; })).map(function (n) { return 'pfile:' + p23.id + ':' + n; }).sort();
  var namesB23 = sortNames(SET_B23.map(function (f) { return f.name; })).map(function (n) { return 'pfile:' + p23.id + ':' + n; }).sort();
  var isA23 = JSON.stringify(rows23) === JSON.stringify(namesA23);
  var isB23 = JSON.stringify(rows23) === JSON.stringify(namesB23);
  ok('终态恰好是其中一套完整集合（无交错混态）', (isA23 || isB23) && rows23.indexOf('pfile:' + p23.id + ':model.glb') < 0,
    rows23.join(','));
  var prof23 = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === p23.id; })[0];
  var rows23names = rows23.map(function (k) { return String(k).slice(('pfile:' + p23.id + ':').length); }).sort();
  ok('modelNames 与实际行一致（元数据不丢不重）', JSON.stringify(sortNames(prof23.modelNames)) === JSON.stringify(rows23names),
    JSON.stringify(prof23.modelNames) + ' vs ' + rows23names.join(','));
  ok('档案 meta 行只有一条', Array.from(fake23.stores.meta.keys()).filter(function (k) { return k === 'profile:' + p23.id; }).length === 1);

  section('二十四、P2：写入键白名单（只动目标档案的 pfile 行和 profile meta）');
  var fake24 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake24.transaction(s, m); });
  var p24 = await ChoreoLibrary.createProfile({ name: '目标档案', skeleton: SKEL_A });
  var q24 = await ChoreoLibrary.createProfile({ name: '旁观档案', skeleton: SKEL_B });
  await ChoreoLibrary.putProfileFile(p24.id, 'model.gltf', new Blob(['target-old']));
  await ChoreoLibrary.putProfileFile(q24.id, 'model.glb', new Blob(['bystander-keep']));
  await ChoreoLibrary.putClip('keep24', makeClip(2), p24.id);
  await ChoreoLibrary.putCatalog({ emotes: [{ name: 'bow', text: '/bow', category: 'usual' }], normal: [], pvp: [] });
  var before24 = snapStore(fake24);
  await ChoreoLibrary.importModelSet(p24.id, [{ name: 'new.glb', blob: new Blob([glbBytes(20)]) }]);
  var after24 = JSON.parse(snapStore(fake24));
  var before24p = JSON.parse(before24);
  ok('clips/clipdata/profileClips/profileClipData 仓一个键没动',
    ['clips', 'clipdata', 'profileClips', 'profileClipData'].every(function (sn) {
      return JSON.stringify(after24[sn]) === JSON.stringify(before24p[sn]);
    }));
  var filesBefore24 = Object.keys(before24p.files).sort(), filesAfter24 = Object.keys(after24.files).sort();
  // P4 适配（AC-10 声明的 mblob 内容寻址后继键族落地）：files 仓拆两族断言——
  // 引用行（pfile:*）保持原断言口径不动；载荷行按「幸存引用」断言：新字节入库、
  // 旁观档案字节保留、被替换的 target-old 字节被回收（原断言的防护意图只增不减）
  var plainAfter24 = filesAfter24.filter(function (k) { return k.indexOf('mblob:') !== 0; });
  ok('files 仓引用行只动了目标档案的模型行（mblob 载荷族另断言）', JSON.stringify(plainAfter24) === JSON.stringify(
    filesBefore24.filter(function (k) { return k.indexOf('mblob:') !== 0 && k.indexOf('pfile:' + p24.id + ':') !== 0; }).concat(['pfile:' + p24.id + ':new.glb']).sort()),
    plainAfter24.join(','));
  var blobAfter24 = Array.from(fake24.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).sort();
  ok('载荷行按幸存引用实算（new.glb 入库、旁观档案字节保留、target-old 回收）',
    JSON.stringify(blobAfter24) === JSON.stringify(['mblob:' + await shaBytes(glbBytes(20)), 'mblob:' + await shaBytes(new TextEncoder().encode('bystander-keep'))].sort()),
    blobAfter24.join(','));
  void filesAfter24;
  var metaDiff24 = Object.keys(before24p.meta).filter(function (k) {
    return JSON.stringify(before24p.meta[k]) !== JSON.stringify(after24.meta[k]);
  });
  ok('meta 仓只有目标档案的 profile 行被改', metaDiff24.length === 1 && metaDiff24[0] === 'profile:' + p24.id,
    metaDiff24.join(','));
  ok('旁观档案与动作原样', (await ChoreoLibrary.getProfileFileInfo(q24.id, 'model.glb')).size === 'bystander-keep'.length &&
    !!(await ChoreoLibrary.getClip('keep24', p24.id)));

  // ============ CHARACTER-ASSETS-P5：.choreochar 角色分享包（DESIGN §3/§11） ============

  // 手工拼 .choreochar 的工具（与 makeBundle 同套路；头两轮定长后重排各段 offset，
  // 标了 __pinned 的条目保留手工 offset —— 越界用例用；__ver 覆盖格式版本号）
  function makeShare(headerObj, blobs) {
    var hLen = 64, hdr;
    function placeOffs() {
      var off = 12 + hLen;
      var sk = headerObj.profile && headerObj.profile.skeleton;
      if (sk && typeof sk.len === 'number') { if (!sk.__pinned) sk.offset = off; off += sk.len; }
      (headerObj.files || []).forEach(function (e) { if (!e.__pinned) e.offset = off; off += e.len || 0; });
      (headerObj.clips || []).forEach(function (e) { if (!e.__pinned) e.offset = off; off += e.len || 0; });
    }
    for (var round = 0; round < 8; round++) {
      placeOffs();
      hdr = JSON.stringify(headerObj);
      var need = new TextEncoder().encode(hdr).length;
      if (need <= hLen) break;
      hLen = Math.ceil((need + 1) / 64) * 64;
    }
    placeOffs(); // 终版 offset 再排一遍（长度已稳定）
    hdr = JSON.stringify(headerObj);
    var headBytes = new TextEncoder().encode(hdr);
    if (headBytes.length > hLen) throw new Error('测试包头部超长（不应发生）');
    var pad = new Uint8Array(hLen - headBytes.length).fill(0x20);
    var headU8 = new Uint8Array(12);
    headU8.set([0x43, 0x48, 0x52, 0x43], 0); // "CHRC"
    new DataView(headU8.buffer).setUint32(4, headerObj.__ver || 1, true);
    new DataView(headU8.buffer).setUint32(8, hLen, true);
    return new Blob([headU8, headBytes, pad].concat(blobs));
  }
  // 「既有键一个没动」断言：before=snapStore 字符串；只要求旧键逐字节不变（新键可以加）
  function snapUnchanged(fake, before) {
    var after = JSON.parse(snapStore(fake)), b = JSON.parse(before);
    return Object.keys(b).every(function (sn) {
      return Object.keys(b[sn]).every(function (k) {
        return JSON.stringify(after[sn][k]) === JSON.stringify(b[sn][k]);
      });
    });
  }
  function keysOf(o) { return Object.keys(o).sort().join(','); }
  function u8hex(u8) { return Array.from(u8).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }

  section('三十五、P5 AC-1：.choreochar 导出（信封/清单白名单/排除项/只读/拒绝/两连导出）');
  var fake35 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake35.transaction(s, m); });
  var p35a = await ChoreoLibrary.createProfile({ name: '分享甲', skeleton: SKEL_A });
  var p35b = await ChoreoLibrary.createProfile({ name: '别家乙', skeleton: SKEL_B });
  var p35c = await ChoreoLibrary.createProfile({ name: '无骨档案' }); // 没有骨架：导出拒绝用
  var GLTF35 = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'share-body.bin' }] });
  await ChoreoLibrary.importModelSet(p35a.id, [
    { name: 'share.gltf', blob: new Blob([GLTF35]) }, { name: 'share-body.bin', blob: new Blob(['share-bin-bytes']) }
  ]);
  await ChoreoLibrary.putClip('一起舞', makeClip(2), p35a.id);
  await ChoreoLibrary.putClip('独舞', makeClip(3), p35a.id);
  await ChoreoLibrary.putClip('一起舞', makeClip(5), p35b.id); // 同名但属于乙：构造上不进甲的包
  fake35.stores.profileClips.set('__pending__\u0000孤儿', { profileId: '__pending__', name: '孤儿', type: 'once', duration: 1, hash: '', skeletonHash: '', enc: 'gzip', sizeRaw: 0, sizeEnc: 0, updatedAt: 1 });
  fake35.stores.profileClipData.set('__pending__\u0000孤儿', { profileId: '__pending__', name: '孤儿', data: new Blob(['x']) });
  await ChoreoLibrary.putCatalog({ emotes: [{ name: '绝密表情', text: '/secret', category: 'usual' }], normal: [], pvp: [] });
  await tick(10); // 迁移/指针的 fire-and-forget 写入先落定，再定格快照
  var snap35 = snapStore(fake35);
  var idx35 = await ChoreoLibrary.clipIndex(p35a.id);                       // 发送方动作元数据（三十七读回比对用）
  var clipObj35 = await ChoreoLibrary.getClip('一起舞', p35a.id);            // 发送方动作原文
  var model35 = await ChoreoLibrary.getProfileFileInfo(p35a.id, 'share-body.bin'); // 发送方模型字节
  var pkg35 = await ChoreoLibrary.createSharePackage(p35a.id);
  ok('导出产出二进制（>12B）', !!pkg35 && pkg35.size > 12, pkg35 ? pkg35.size + 'B' : '无');
  ok('导出只读（库快照逐字节不变、无分享草稿行）', snapStore(fake35) === snap35);
  var q35 = await readHeader(pkg35);
  var hLen35 = new DataView(q35.buf.buffer).getUint32(8, true);
  var h35 = q35.header;
  ok('魔数 "CHRC"、格式版本 1（与 CHLB 备份互斥）',
    q35.buf[0] === 0x43 && q35.buf[1] === 0x48 && q35.buf[2] === 0x52 && q35.buf[3] === 0x43 &&
    new DataView(q35.buf.buffer).getUint32(4, true) === 1);
  ok('头部顶层键恰为白名单（formatVersion/createdAt/profile/files/clips）',
    keysOf(h35) === 'clips,createdAt,files,formatVersion,profile', keysOf(h35));
  ok('档案身份块恰含 名字/指纹/骨数/骨架段', keysOf(h35.profile) === 'boneCount,name,skeleton,skeletonHash' &&
    h35.profile.name === '分享甲' && h35.profile.skeletonHash === await ChoreoLibrary.hashObject(SKEL_A) &&
    h35.profile.boneCount === 2 && keysOf(h35.profile.skeleton) === 'len,offset');
  var skelSeg35 = await pkg35.slice(h35.profile.skeleton.offset, h35.profile.skeleton.offset + h35.profile.skeleton.len).text();
  ok('骨架段=档案骨架原文（JSON 逐字段一致）', JSON.parse(skelSeg35) && JSON.stringify(JSON.parse(skelSeg35)) === JSON.stringify(SKEL_A));
  ok('模型清单=该档案模型文件（裸名+逐件 SHA-256），键白名单精确',
    h35.files.length === 2 && keysOf(h35.files[0]) === 'hash,len,mime,name,offset' &&
    sortNames(h35.files.map(function (f) { return f.name; })).join(',') === sortNames(['share.gltf', 'share-body.bin']).join(',') &&
    h35.files.every(function (f) { return /^[0-9a-f]{64}$/.test(f.hash); }) &&
    h35.files.filter(function (f) { return f.name === 'share.gltf'; })[0].hash === await shaBytes(new TextEncoder().encode(GLTF35)));
  ok('动作清单=该档案动作元数据（无 profileId 键、hash/enc 与库内一致）',
    h35.clips.length === 2 && keysOf(h35.clips[0]) === 'duration,enc,hash,len,name,offset,sizeEnc,sizeRaw,type,updatedAt' &&
    sortNames(h35.clips.map(function (c) { return c.name; })).join(',') === sortNames(['一起舞', '独舞']).join(',') &&
    h35.clips.every(function (c) {
      var src = idx35.filter(function (x) { return x.name === c.name; })[0];
      return src && c.hash === src.hash && c.enc === src.enc && c.type === src.type && c.duration === src.duration;
    }));
  ok('信封自包含（头长+各段长度=文件总长，无尾随内容）',
    12 + hLen35 + h35.profile.skeleton.len + h35.files.reduce(function (s, f) { return s + f.len; }, 0) +
    h35.clips.reduce(function (s, c) { return s + c.len; }, 0) === pkg35.size);
  // 排除项扫描：解码后的头部 + 非二进制段（骨架/gltf）里不得出现任何排除类别
  var gltfEntry35 = h35.files.filter(function (f) { return f.name === 'share.gltf'; })[0];
  var scan35 = JSON.stringify(h35) + '\n' + skelSeg35 + '\n' +
    await pkg35.slice(gltfEntry35.offset, gltfEntry35.offset + gltfEntry35.len).text();
  ok('排除项扫描：他档案名/id、pending 动作、全局目录、活动指针、pfile/mblob 键、绝对路径、配对/凭据标记都不在包里',
    ['别家乙', p35b.id, '孤儿', '绝密表情', 'activeProfile', 'pfile:', 'mblob:', 'file://', ':\\\\', 'token', 'pairing', 'credential']
      .every(function (needle) { return scan35.indexOf(needle) < 0; }));
  ok('排除项扫描：他档案的模型文件一个字节都不在包里（段总数=骨架+甲的2件模型+2条动作）',
    h35.files.length === 2 && h35.clips.length === 2 && pkg35.size < 4096);
  var e35a = null, e35b = null, e35c = null;
  try { await ChoreoLibrary.createSharePackage('p不存在'); } catch (e) { e35a = e; }
  try { await ChoreoLibrary.createSharePackage('__pending__'); } catch (e) { e35b = e; }
  try { await ChoreoLibrary.createSharePackage(p35c.id); } catch (e) { e35c = e; }
  ok('未知 pid 拒绝（中文原因）', !!e35a && /不存在/.test(e35a.message), e35a ? e35a.message : '未拦截');
  ok('「待归档」虚拟档案拒绝（中文原因）', !!e35b && /待归档/.test(e35b.message), e35b ? e35b.message : '未拦截');
  ok('没有骨架的档案拒绝（中文原因）', !!e35c && /没有骨架/.test(e35c.message), e35c ? e35c.message : '未拦截');
  ok('三类拒绝全部零写入（快照仍逐字节不变）', snapStore(fake35) === snap35);
  var pkg35b = await ChoreoLibrary.createSharePackage(p35a.id);
  var q35b = await readHeader(pkg35b);
  var table35 = function (h) {
    return JSON.stringify({ profile: { name: h.profile.name, skeletonHash: h.profile.skeletonHash, boneCount: h.profile.boneCount, skeleton: h.profile.skeleton }, files: h.files, clips: h.clips });
  };
  ok('两连导出：清单表逐项相等（偏移/长度/hash/元数据全等）', table35(h35) === table35(q35b.header));
  async function segHexList(pkg, h) {
    var out = [u8hex(new Uint8Array(await pkg.slice(h.profile.skeleton.offset, h.profile.skeleton.offset + h.profile.skeleton.len).arrayBuffer()))];
    for (var i = 0; i < h.files.length; i++) out.push(u8hex(new Uint8Array(await pkg.slice(h.files[i].offset, h.files[i].offset + h.files[i].len).arrayBuffer())));
    for (var j = 0; j < h.clips.length; j++) out.push(u8hex(new Uint8Array(await pkg.slice(h.clips[j].offset, h.clips[j].offset + h.clips[j].len).arrayBuffer())));
    return out;
  }
  var segs35 = await segHexList(pkg35, h35), segs35b = await segHexList(pkg35b, q35b.header);
  ok('两连导出：各数据段逐字节相等（库没变，包内容不漂移）', JSON.stringify(segs35) === JSON.stringify(segs35b));

  section('三十六、P5 AC-2/AC-6：坏包拒绝矩阵 + 跨类型互拒（逐类独立中文原因、零写入）');
  var skelBytes36 = new TextEncoder().encode(JSON.stringify(SKEL_A));
  var hashSkel36 = await ChoreoLibrary.hashObject(SKEL_A);
  var GLTF36 = new TextEncoder().encode(GLTF_SELF); // 自包含 gltf（data: 内嵌）
  var hashGltf36 = await shaBytes(GLTF36);
  var clip36 = gzBlobOf(makeClip(2));
  var hashClip36 = await shaBytes(new TextEncoder().encode(JSON.stringify(makeClip(2))));
  var blobs36 = [new Blob([skelBytes36]), new Blob([GLTF36]), clip36];
  function baseShare36() {
    return {
      formatVersion: 1,
      profile: { name: '包裹角色', skeletonHash: hashSkel36, boneCount: 2, skeleton: { len: skelBytes36.length } },
      files: [{ name: 'body.gltf', mime: 'model/gltf+json', hash: hashGltf36, len: GLTF36.length }],
      clips: [{ name: '包裹舞', type: 'once', duration: 2, hash: hashClip36, enc: 'gzip', sizeRaw: 0, sizeEnc: clip36.size, len: clip36.size, updatedAt: 1 }]
    };
  }
  var fake36 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake36.transaction(s, m); });
  await ChoreoLibrary.putSkeleton(SKEL_B); // 接收方已有内容：每个拒绝都必须原样保留
  await ChoreoLibrary.putClip('keep36', makeClip(1));
  var snap36 = snapStore(fake36);
  async function expectShareReject(blob, label, re) {
    var e = null;
    try { await ChoreoLibrary.importSharePackage(blob); } catch (err) { e = err; }
    ok(label + ' → 拒绝（' + (e ? e.message : '未拦截') + '）', !!e && (!re || re.test(e.message)));
    ok(label + ' → 零写入（库快照逐字节不变）', snapStore(fake36) === snap36);
  }
  var valid36 = makeShare(baseShare36(), blobs36);
  await expectShareReject(new Blob([crypto.getRandomValues(new Uint8Array(64))]), '(a) 随机字节（魔数不符）', /不是角色分享包/);
  await expectShareReject(bundle13, '(b) CHLB v2 备份喂给角色包入口（点名期望类型）', /资料库备份.*角色分享包|这是资料库备份/);
  await expectShareReject(valid36.slice(0, valid36.size - 20), '(c) 截断的信封（尾段越界/头长对不上）', /不完整|越界/);
  var v236 = baseShare36(); v236.__ver = 2;
  await expectShareReject(makeShare(v236, blobs36), '(d) 格式版本高于 1', /格式版本不支持/);
  var oob36 = baseShare36();
  oob36.clips[0] = JSON.parse(JSON.stringify(oob36.clips[0])); oob36.clips[0].__pinned = true; oob36.clips[0].offset = 99999999;
  await expectShareReject(makeShare(oob36, blobs36), '(e) 数据段 offset 越界', /数据段越界/);
  var dupC36 = baseShare36();
  dupC36.clips = [dupC36.clips[0], JSON.parse(JSON.stringify(dupC36.clips[0]))];
  await expectShareReject(makeShare(dupC36, blobs36.concat([clip36])), '(f) 一个包里动作重名', /动作重名/);
  var dupF36 = baseShare36();
  dupF36.files = [dupF36.files[0], JSON.parse(JSON.stringify(dupF36.files[0]))];
  await expectShareReject(makeShare(dupF36, blobs36.concat([new Blob([GLTF36])])), '(g) 一个包里模型文件重名', /模型文件重名/);
  var noName36 = baseShare36();
  noName36.clips[0] = { type: 'once', duration: 2, hash: hashClip36, enc: 'gzip', sizeEnc: clip36.size, len: clip36.size };
  await expectShareReject(makeShare(noName36, blobs36), '(h) 动作缺名', /缺少名字/);
  var badName36 = baseShare36();
  badName36.clips[0] = JSON.parse(JSON.stringify(badName36.clips[0])); badName36.clips[0].name = 123;
  await expectShareReject(makeShare(badName36, blobs36), '(i) 动作名非字符串', /缺少名字或名字不是文本/);
  var noProf36 = baseShare36(); delete noProf36.profile;
  await expectShareReject(makeShare(noProf36, blobs36), '(j) 档案身份块缺失', /档案身份/);
  var badHash36 = baseShare36(); badHash36.files[0].hash = new Array(65).join('0');
  await expectShareReject(makeShare(badHash36, blobs36), '(k) 模型文件 hash 不符', /内容与角色包清单对不上/);
  var badSkel36 = baseShare36(); badSkel36.profile.skeletonHash = hashSkel36.split('').reverse().join('');
  await expectShareReject(makeShare(badSkel36, blobs36), '(l) 骨架指纹与内容不符', /骨架指纹与内容对不上/);
  var badClip36 = baseShare36(); badClip36.clips[0].hash = new Array(65).join('0');
  await expectShareReject(makeShare(badClip36, blobs36), '(m) 动作 hash 不符', /哈希校验不符/);
  var njBlob36 = gzipSyncBlob('{{{not json'); // 原样 gzip 垃圾文本（不走 JSON.stringify 的 gzBlobOf）
  var nj36 = baseShare36(); nj36.clips[0].len = njBlob36.size;
  await expectShareReject(makeShare(nj36, [new Blob([skelBytes36]), new Blob([GLTF36]), njBlob36]),
    '(n) 动作解压后不是 JSON', /不是有效 JSON/);
  var extGltf36 = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'missing.bin' }] }));
  var extH36 = baseShare36(); extH36.files[0].hash = await shaBytes(extGltf36); extH36.files[0].len = extGltf36.length;
  await expectShareReject(makeShare(extH36, [new Blob([skelBytes36]), new Blob([extGltf36]), clip36]),
    '(o) gltf 引用的外部 buffer 不在包里', /不在包里/);
  var z36 = baseShare36();
  z36.files[0] = { name: 'zero.bin', mime: 'application/octet-stream', hash: await shaBytes(new Uint8Array(0)), len: 0 };
  await expectShareReject(makeShare(z36, [new Blob([skelBytes36]), new Blob([]), clip36]), '(p) 零字节模型段', /空文件（0 字节）/);
  var e36q = null;
  try { await ChoreoLibrary.importBundle(valid36); } catch (e) { e36q = e; }
  ok('(q) .choreochar 喂给「导入备份」入口被拒（点名期望类型）', !!e36q && /不是编舞资料库备份文件/.test(e36q.message),
    e36q ? e36q.message : '未拦截');
  ok('(q) 跨类型拒绝零写入', snapStore(fake36) === snap36);
  var fake36b = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake36b.transaction(s, m); });
  var r36ok = await ChoreoLibrary.importSharePackage(valid36);
  ok('(对照) 手工拼的健康包正常收养（拒绝矩阵不是误伤）', !!r36ok && r36ok.clips === 1 && r36ok.files === 1 &&
    r36ok.name === '包裹角色', JSON.stringify(r36ok));

  // （恢复修复 2026-09-21，r2 实施会话）nsRowsOf/plainBlobVal/blobBytes 帮助函数在 2026-09-20
  // 仓库重建中丢失（37 节引用仍在，HEAD 即崩）；按 C:/choreohelper-recovery/_merge 中间产物原字节恢复。
  function plainBlobVal(v) { return (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') ? ('Blob(' + v.size + ')') : v; }
  function nsRowsOf(fake, pid) {
    var m = [], d = [];
    fake.stores.profileClips.forEach(function (v) { if (v.profileId === pid) m.push(JSON.stringify(v)); });
    fake.stores.profileClipData.forEach(function (v) {
      if (v.profileId !== pid) return;
      var copy = {}; Object.keys(v).forEach(function (f) { copy[f] = plainBlobVal(v[f]); });
      d.push(JSON.stringify(copy));
    });
    return JSON.stringify({ m: m.sort(), d: d.sort() });
  }
  async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }
  var wrapP = function (p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); };

  section('三十七、P5 AC-3：收养（新 id/撞名/指针不动/命名空间盖章/去重复用/逐字节读回）');
  var fake37 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake37.transaction(s, m); });
  var recv37 = await ChoreoLibrary.createProfile({ name: '分享甲', skeleton: SKEL_B });      // 与包撞名 + 活动档案
  var sameSkel37 = await ChoreoLibrary.createProfile({ name: '同骨架', skeleton: SKEL_A });  // 同指纹：绝不并档
  var clipOther37 = await ChoreoLibrary.createProfile({ name: '动作别家', skeleton: SKEL_B });
  var hashA37 = await ChoreoLibrary.hashObject(SKEL_A);
  await ChoreoLibrary.putClip('一起舞', makeClip(9), clipOther37.id); // 别家的同名动作
  await ChoreoLibrary.importModelSet(clipOther37.id, [                               // 与包字节相同的模型（去重路径）
    { name: 'share.gltf', blob: new Blob([GLTF35]) }, { name: 'share-body.bin', blob: new Blob(['share-bin-bytes']) }
  ]);
  var activeBefore37 = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.isActive; })[0].id;
  await tick(10);
  var snap37 = snapStore(fake37);
  var nsOther37 = nsRowsOf(fake37, clipOther37.id);
  var r37 = await ChoreoLibrary.importSharePackage(pkg35);
  ok('收养返回新档案（id 合语法、非 pending、动作/模型计数如实）',
    !!r37 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(r37.pid) && r37.pid !== '__pending__' &&
    r37.clips === 2 && r37.files === 2, JSON.stringify(r37));
  var lps37 = await ChoreoLibrary.listProfiles();
  ok('新 id 与现有所有档案互异（同指纹档案绝不并档）',
    [recv37.id, sameSkel37.id, clipOther37.id].indexOf(r37.pid) < 0 &&
    lps37.filter(function (p) { return p.id === r37.pid; }).length === 1 && lps37.length === 4);
  ok('撞名本地改名（「分享甲」→「分享甲（2）」），原同名档案不动',
    r37.name === '分享甲（2）' && lps37.some(function (p) { return p.name === '分享甲' && p.id === recv37.id; }));
  ok('收养后活动档案指针不动', lps37.filter(function (p) { return p.isActive; })[0].id === activeBefore37);
  var idx37 = await ChoreoLibrary.clipIndex(r37.pid);
  ok('动作全部落新档案命名空间并盖新档案指纹（=SKEL_A 指纹，与发送方一致）',
    idx37.length === 2 && sortNames(idx37.map(function (c) { return c.name; })).join(',') === '一起舞,独舞' &&
    idx37.every(function (c) { return c.skeletonHash === hashA37; }));
  ok('动作元数据与发送方逐字段一致（type/duration/hash/enc/sizeRaw/sizeEnc/updatedAt）',
    idx37.every(function (c) {
      var src = idx35.filter(function (x) { return x.name === c.name; })[0];
      return src && c.type === src.type && c.duration === src.duration && c.hash === src.hash &&
        c.enc === src.enc && c.sizeRaw === src.sizeRaw && c.sizeEnc === src.sizeEnc && c.updatedAt === src.updatedAt;
    }));
  var clip37 = await ChoreoLibrary.getClip('一起舞', r37.pid);
  ok('动作读回与发送方逐字段一致（gzip 往返无损）', JSON.stringify(clip37) === JSON.stringify(clipObj35));
  ok('接收方别家的同名动作原样（还是 9s、两仓行逐字节不变）',
    (await ChoreoLibrary.getClip('一起舞', clipOther37.id)).duration === 9 && nsRowsOf(fake37, clipOther37.id) === nsOther37);
  var blobKeys37 = Array.from(fake37.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).sort();
  ok('相同模型字节复用同一载荷（载荷数=去重 SHA 数=2，收养零新增载荷）',
    JSON.stringify(blobKeys37) === JSON.stringify([await shaBytes(new TextEncoder().encode(GLTF35)), await shaBytes(new TextEncoder().encode('share-bin-bytes'))].sort().map(function (h) { return 'mblob:' + h; })),
    blobKeys37.join(','));
  ok('收养加的是引用行（一套 pfile 引用 + 共享载荷）',
    fake37.stores.files.has('pfile:' + r37.pid + ':share.gltf') && fake37.stores.files.has('pfile:' + r37.pid + ':share-body.bin'));
  var f37 = await ChoreoLibrary.getProfileFile(r37.pid, 'share-body.bin');
  ok('模型字节读回逐字节一致', u8hex(await blobBytes(f37)) === u8hex(await blobBytes(model35.data)) && f37.size === model35.size);
  var prof37 = await ChoreoLibrary.getProfile(r37.pid);
  ok('档案读回：骨架原文/指纹/骨数/模型清单与发送方一致',
    JSON.stringify(prof37.skeleton) === JSON.stringify(SKEL_A) && prof37.skeletonHash === hashA37 &&
    prof37.boneCount === 2 && sortNames(prof37.modelNames).join(',') === sortNames(['share.gltf', 'share-body.bin']).join(','));
  await ChoreoLibrary.setActiveProfile(r37.pid);
  var mf37 = await ChoreoLibrary.getModelFiles();
  ok('getModelFiles 读回新档案模型清单（切到它时；hash 逐件有效）',
    sortNames(mf37.map(function (x) { return x.name; })).join(',') === sortNames(['share.gltf', 'share-body.bin']).join(',') &&
    mf37.length === 2 && mf37.every(function (x) { return /^[0-9a-f]{64}$/.test(x.hash); }));
  await ChoreoLibrary.setActiveProfile(activeBefore37); // 指针还原（不把测试副作用留给后续断言）
  ok('接收方既有内容零改动（旧键逐字节不变，只有新键加入）', snapUnchanged(fake37, snap37));

  section('三十八、P5 AC-4：取消/写中止零残留 + 重试 + 重复导入容忍');
  // 注：假后端在事务开场批次里检测 failPut——收养事务开场先 getAll meta/files，
  // 所以注入 store:'files'（开场读就命中→整事务中止，零执行零写入）
  var fake38 = new FakeIDB({ failPut: { store: 'files' } });
  ChoreoLibrary.useBackend(function (s, m) { return fake38.transaction(s, m); });
  var host38 = await ChoreoLibrary.createProfile({ name: '原住民', skeleton: SKEL_B });
  await tick(10);
  var snap38 = snapStore(fake38);
  var e38 = null;
  try { await ChoreoLibrary.importSharePackage(valid36); } catch (e) { e38 = e; }
  ok('写事务中止 → 收养如实报错', !!e38, e38 ? e38.message : '未抛错');
  ok('中止后零残留（无档案行/动作行/引用行/载荷行/modelNames 条目）——快照逐字节不变',
    snapStore(fake38) === snap38);
  fake38.failPut = null; // 故障恢复：同一后端直接重试（无需清理）
  var r38 = await ChoreoLibrary.importSharePackage(valid36);
  ok('重试成功（一套完整新档案）', !!r38 && r38.clips === 1 && r38.files === 1 && r38.name === '包裹角色');
  async function adoptionShape(fake, pid) {
    var prof = (await ChoreoLibrary.listProfiles()).filter(function (p) { return p.id === pid; })[0];
    var idx = await ChoreoLibrary.clipIndex(pid);
    return JSON.stringify({
      name: prof.name, skeletonHash: prof.skeletonHash, boneCount: prof.boneCount,
      modelNames: sortNames(prof.modelNames),
      clips: idx.map(function (c) { return [c.name, c.type, c.duration, c.hash, c.skeletonHash, c.enc, c.sizeRaw, c.sizeEnc, c.updatedAt]; }),
      pfiles: Array.from(fake.stores.files.keys()).filter(function (k) { return k.indexOf('pfile:' + pid + ':') === 0; })
        .map(function (k) { return k.slice(('pfile:' + pid + ':').length); }).sort(),
      blobs: Array.from(fake.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).sort()
    });
  }
  var shape38 = await adoptionShape(fake38, r38.pid);
  var fake38b = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake38b.transaction(s, m); });
  await ChoreoLibrary.createProfile({ name: '原住民', skeleton: SKEL_B });
  var r38b = await ChoreoLibrary.importSharePackage(valid36);
  var shape38b = await adoptionShape(fake38b, r38b.pid);
  ChoreoLibrary.useBackend(function (s, m) { return fake38.transaction(s, m); }); // 切回 fake38 继续本节
  ok('重试终态=干净单次导入终态（除随机 id/时间戳外逐项相等）', shape38 === shape38b);
  var snap38b = snapStore(fake38);
  var e38c = null;
  try { await ChoreoLibrary.importSharePackage(valid36, { shouldCancel: function () { return true; } }); } catch (e) { e38c = e; }
  ok('校验全过后取消 → 如实拒绝（中文原因）', !!e38c && /取消/.test(e38c.message), e38c ? e38c.message : '未抛错');
  ok('取消零写入（快照逐字节不变）', snapStore(fake38) === snap38b);
  var r38d = await ChoreoLibrary.importSharePackage(valid36); // 第二次完整导入同一个包
  ok('重复导入=再一套独立档案（撞名本地改名、id 互异）',
    !!r38d && r38d.pid !== r38.pid && r38d.name === '包裹角色（2）' && r38d.clips === 1 && r38d.files === 1,
    JSON.stringify(r38d));
  var refed38 = {};
  fake38.stores.files.forEach(function (r) { if (String(r.name).indexOf('pfile:') === 0 && r.ref) refed38[r.ref] = true; });
  var orphan38 = Array.from(fake38.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0 && !refed38[k.slice(6)]; });
  ok('两套档案各自完整且共享一份载荷（同字节不翻倍、零孤儿行）',
    Array.from(fake38.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).length === 1 &&
    orphan38.length === 0 && fake38.stores.files.has('pfile:' + r38.pid + ':body.gltf') &&
    fake38.stores.files.has('pfile:' + r38d.pid + ':body.gltf'), orphan38.join(','));

  section('三十九、P5 AC-5：并发收养/删档/读（全成或全无、无交叉污染）');
  var fake39 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake39.transaction(s, m); });
  var host39 = await ChoreoLibrary.createProfile({ name: '东道', skeleton: SKEL_B });
  var skelBytesB39 = new TextEncoder().encode(JSON.stringify(SKEL_B));
  var clipB39 = gzBlobOf(makeClip(1));
  var pkgB39 = makeShare({
    formatVersion: 1,
    profile: { name: '乙包角色', skeletonHash: await ChoreoLibrary.hashObject(SKEL_B), boneCount: 3, skeleton: { len: skelBytesB39.length } },
    files: [{ name: 'b.bin', mime: 'application/octet-stream', hash: await shaBytes(new TextEncoder().encode('bbbb39')), len: 6 }],
    clips: [{ name: '乙包舞', type: 'once', duration: 1, hash: await shaBytes(new TextEncoder().encode(JSON.stringify(makeClip(1)))), enc: 'gzip', sizeRaw: 0, sizeEnc: clipB39.size, len: clipB39.size, updatedAt: 1 }]
  }, [new Blob([skelBytesB39]), new Blob(['bbbb39']), clipB39]);
  async function fullyAdopted(fake, pid, nClips, nFiles) {
    var profOk = !!(await ChoreoLibrary.getProfile(pid));
    var m = 0, d = 0, f = 0;
    fake.stores.profileClips.forEach(function (r) { if (r.profileId === pid) m++; });
    fake.stores.profileClipData.forEach(function (r) { if (r.profileId === pid) d++; });
    fake.stores.files.forEach(function (r) { if (String(r.name).indexOf('pfile:' + pid + ':') === 0) f++; });
    return profOk && m === nClips && d === nClips && f === nFiles;
  }
  var rs39 = await Promise.all([
    wrapP(ChoreoLibrary.importSharePackage(valid36)),
    wrapP(ChoreoLibrary.importSharePackage(pkgB39))
  ]);
  ok('两个不同包并发收养：各自如实报告', rs39.every(function (x) { return x.ok; }),
    rs39.map(function (x) { return x.ok ? '成功' : ('失败:' + x.e.message); }).join(' / '));
  ok('每包要么全收养要么全无（无半套：档案行+动作成对+模型引用齐全）',
    rs39[0].ok && rs39[1].ok &&
    await fullyAdopted(fake39, rs39[0].v.pid, 1, 1) && await fullyAdopted(fake39, rs39[1].v.pid, 1, 1));
  var victim39 = await ChoreoLibrary.createProfile({ name: '无关甲', skeleton: SKEL_A });
  await ChoreoLibrary.importModelSet(victim39.id, [{ name: 'v.glb', blob: new Blob([glbBytes(8)]) }]);
  var victimHash39 = await shaBytes(glbBytes(8));
  var rs39b = await Promise.all([
    wrapP(ChoreoLibrary.importSharePackage(pkgB39)),
    wrapP(ChoreoLibrary.deleteProfile(victim39.id))
  ]);
  ok('收养 vs 删无关档案：两侧各自如实（无交叉污染）', rs39b.every(function (x) { return x.ok; }),
    rs39b.map(function (x) { return x.ok ? '成功' : ('失败:' + x.e.message); }).join(' / '));
  ok('无关档案删干净、收养完整、删档只回收自己的载荷',
    !(await ChoreoLibrary.getProfile(victim39.id)) &&
    Array.from(fake39.stores.files.keys()).indexOf('mblob:' + victimHash39) < 0 &&
    await fullyAdopted(fake39, rs39b[0].v.pid, 1, 1));
  var preIdx39 = await ChoreoLibrary.clipIndex(host39.id);
  var rs39c = await Promise.all([
    wrapP(ChoreoLibrary.importSharePackage(valid36)),
    wrapP(ChoreoLibrary.clipIndex(host39.id))
  ]);
  ok('收养 vs 档案作用域读并发：读侧完整（=东道既有清单，绝不混入半套）、写侧如实',
    rs39c[0].ok && rs39c[1].ok && JSON.stringify(rs39c[1].v) === JSON.stringify(preIdx39));

  section('四十、P5 AC-7：写入键白名单 + 信封常量互斥（无端点/无草稿行/DB_VERSION 仍 2）');
  var fake40 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake40.transaction(s, m); });
  var r40 = await ChoreoLibrary.importSharePackage(valid36);
  ok('对照：第四十节的收养成功', !!r40 && r40.clips === 1);
  var badKeys40 = [];
  fake40.stores.meta.forEach(function (v, k) {
    if (!/^(profile:|activeProfile$|clipMigration$)/.test(String(k))) badKeys40.push('meta:' + k);
  });
  fake40.stores.files.forEach(function (v, k) {
    if (!/^(pfile:|mblob:)/.test(String(k))) badKeys40.push('files:' + k);
  });
  ok('meta/files 只出现既有 v2 键族（profile:/activeProfile/pfile:/mblob:，无分享草稿行）',
    badKeys40.length === 0, badKeys40.join(','));
  var badPk40 = [];
  [fake40.stores.profileClips, fake40.stores.profileClipData].forEach(function (st) {
    st.forEach(function (v) {
      if (typeof v.profileId !== 'string' || !v.profileId || typeof v.name !== 'string' || !v.name) badPk40.push(String(v.profileId) + '/' + String(v.name));
    });
  });
  ok('动作仓只出现 (profileId, name) 复合键行（收养动作全盖新档案指纹）', badPk40.length === 0 &&
    (await ChoreoLibrary.clipIndex(r40.pid))[0].skeletonHash === hashSkel36, badPk40.join(','));
  ok('旧全局仓（clips/clipdata）一个键没动', fake40.stores.clips.size === 0 && fake40.stores.clipdata.size === 0);
  var src40 = require('fs').readFileSync(require('path').join(__dirname, 'choreo-library.js'), 'utf8');
  ok('信封常量互斥：SHARE_MAGIC="CHRC"/v1 vs BUNDLE_MAGIC="CHLB"/v2，DB_VERSION 仍 2',
    /SHARE_MAGIC\s*=\s*\[0x43,\s*0x48,\s*0x52,\s*0x43\]/.test(src40) &&
    /BUNDLE_MAGIC\s*=\s*\[0x43,\s*0x48,\s*0x4C,\s*0x42\]/.test(src40) &&
    /SHARE_VERSION\s*=\s*1\b/.test(src40) && /BUNDLE_VERSION\s*=\s*2\b/.test(src40) &&
    /DB_VERSION\s*=\s*2\b/.test(src40));
  ok('分享路径无网络出口（整个资料库模块不出现 fetch/XHR/upload）',
    !/fetch\(|XMLHttpRequest|\.upload\b/.test(src40));

  // ============ CHARACTER-ASSETS-P6：1-8 舞者验收（DESIGN §9/§10） ============

  section('四十一、P6 AC-3：满员命名空间/复用（8 舞者×三套异骨架、同名两录、同字节两档、缺录不借）');
  var SKEL_C41 = { count: 2, bones: [{ i: 0, n: 'c_root', p: -1, t: [0, 0.8, 0], q: [0, 0, 0, 1] }, { i: 1, n: 'c_kao', p: 0, t: [0, 0.25, 0], q: [0, 0, 0, 1] }] };
  var fake41 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake41.transaction(s, m); });
  var p41a = await ChoreoLibrary.createProfile({ name: '满员A', skeleton: SKEL_A });
  var p41b = await ChoreoLibrary.createProfile({ name: '满员B', skeleton: SKEL_B });
  var p41c = await ChoreoLibrary.createProfile({ name: '满员C', skeleton: SKEL_C41 });
  await ChoreoLibrary.putClip('duet', makeClip(3), p41a.id); // 同一动作名录进两套档案（内容不同）
  await ChoreoLibrary.putClip('duet', makeClip(7), p41b.id);
  var M41 = glbBytes(21);
  await ChoreoLibrary.importModelSet(p41a.id, [{ name: 'same.glb', blob: new Blob([M41]) }]);
  await ChoreoLibrary.importModelSet(p41c.id, [{ name: 'twin.glb', blob: new Blob([new Uint8Array(M41)]) }]); // 同字节两档
  // 满员绑定（AC-1 会话）：A×3、B×3、C×2 —— 每位解析到自己命名空间
  var bind41 = [p41a.id, p41a.id, p41a.id, p41b.id, p41b.id, p41b.id, p41c.id, p41c.id];
  var dancers41 = bind41.map(function (pid, i) {
    return { id: i, name: '舞者' + (i + 1), profileId: pid, switchClips: [], actionClips: [], lyricClips: [] };
  });
  var known41 = [p41a.id, p41b.id, p41c.id];
  var rb41 = CE6.pure.resolveBindings(dancers41, known41, p41a.id);
  ok('满员 8 位绑定逐位解析到自己命名空间（全 bound、无串档）',
    rb41.length === 8 && rb41.every(function (e) { return e.state === 'bound' && e.profileId === bind41[e.index]; }));
  ok('同名两录各归各：A=3s / B=7s / C 缺录=null（绝不隐式借别档）',
    (await ChoreoLibrary.getClip('duet', p41a.id)).duration === 3 &&
    (await ChoreoLibrary.getClip('duet', p41b.id)).duration === 7 &&
    (await ChoreoLibrary.getClip('duet', p41c.id)) === null &&
    (await ChoreoLibrary.hasClips(['duet'], p41c.id))[0] === false);
  var duetRows41 = [];
  fake41.stores.profileClips.forEach(function (v, k) { if (v.name === 'duet') duetRows41.push(k); });
  var duetHash41 = (await ChoreoLibrary.clipIndex(p41a.id)).filter(function (r) { return r.name === 'duet'; })[0].hash;
  var duetHash41b = (await ChoreoLibrary.clipIndex(p41b.id)).filter(function (r) { return r.name === 'duet'; })[0].hash;
  ok('共享动作名恰两条独立缓存条目（A/B 各一行复合键，hash 互不相同）',
    duetRows41.length === 2 && duetHash41 !== duetHash41b, duetRows41.join(' | '));
  var blobCount41 = Array.from(fake41.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).length;
  var refRows41 = Array.from(fake41.stores.files.keys()).filter(function (k) {
    return k === 'pfile:' + p41a.id + ':same.glb' || k === 'pfile:' + p41c.id + ':twin.glb';
  }).length;
  ok('同字节两档案：一份载荷 + 两条引用行（A/C 读回逐字节相同）',
    blobCount41 === 1 && refRows41 === 2 &&
    (await ChoreoLibrary.getProfileFileInfo(p41a.id, 'same.glb')).hash === (await ChoreoLibrary.getProfileFileInfo(p41c.id, 'twin.glb')).hash,
    'mblob=' + blobCount41 + ' refs=' + refRows41);
  ok('缺录舞者（C 组两位）走替身口径的数据侧：getClip null + hasClips false（预览侧由 nsMissing 回落）',
    bind41.filter(function (pid) { return pid === p41c.id; }).length === 2);

  section('四十二、P6 AC-4：.choreochar 收养进在场会话（新指纹→新母版 / 同指纹→并母版 / 他人不动 / 坏包零写入）');
  var SKEL_X42 = { count: 2, bones: [{ i: 0, n: 'x_root', p: -1, t: [0, 0.6, 0], q: [0, 0, 0, 1] }, { i: 1, n: 'x_te', p: 0, t: [0, 0.2, 0], q: [0, 0, 0, 1] }] };
  var fake42 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake42.transaction(s, m); });
  var p42a = await ChoreoLibrary.createProfile({ name: '会话A', skeleton: SKEL_A });
  var p42b = await ChoreoLibrary.createProfile({ name: '会话B', skeleton: SKEL_B });
  await ChoreoLibrary.putClip('duet', makeClip(3), p42a.id);
  await ChoreoLibrary.putClip('duet', makeClip(7), p42b.id);
  var M42 = glbBytes(22);
  await ChoreoLibrary.importModelSet(p42a.id, [{ name: 'body.glb', blob: new Blob([M42]) }]);
  var srcX42 = await ChoreoLibrary.createProfile({ name: '外来X', skeleton: SKEL_X42 }); // 新指纹 + 与会话同字节模型
  await ChoreoLibrary.importModelSet(srcX42.id, [{ name: 'body.glb', blob: new Blob([new Uint8Array(M42)]) }]);
  await ChoreoLibrary.putClip('duet', makeClip(5), srcX42.id);
  var srcA2_42 = await ChoreoLibrary.createProfile({ name: '同骨A', skeleton: SKEL_A });  // 与 p42a 同指纹
  await ChoreoLibrary.putClip('duet', makeClip(9), srcA2_42.id);
  var pkgX42 = await ChoreoLibrary.createSharePackage(srcX42.id);
  var pkgANoModel42 = await ChoreoLibrary.createSharePackage(srcA2_42.id);
  // 同骨架还必须同外观才允许共用母版；同时保留无模型包作为反例。
  await ChoreoLibrary.importModelSet(srcA2_42.id, [{ name: 'body.glb', blob: new Blob([new Uint8Array(M42)]) }]);
  var pkgA42 = await ChoreoLibrary.createSharePackage(srcA2_42.id);
  // 在场 8 舞者混合会话：A×3、B×3、悬空 1、未绑 1（悬空位后续经 P3 绑定入口改绑收养档案）
  var dancers42 = [];
  for (var i42 = 0; i42 < 8; i42++) {
    var d42 = { id: i42, name: '舞者' + (i42 + 1), switchClips: [], actionClips: [], lyricClips: [] };
    if (i42 <= 2) d42.profileId = p42a.id;
    else if (i42 <= 5) d42.profileId = p42b.id;
    else if (i42 === 6) d42.profileId = 'ghost42'; // 悬空
    dancers42.push(d42); // i42===7 未绑 → 缺省活动档案
  }
  var snap42dancers = JSON.stringify(dancers42);
  var recs42 = await ChoreoLibrary.listProfiles();
  var known42 = recs42.map(function (r) { return r.id; });
  var planT0 = CE6.pure.planRender(dancers42, known42, p42a.id, recs42, null);
  var blobCount42 = Array.from(fake42.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).length;
  // 收养 ①：新指纹包
  var adoptX = await ChoreoLibrary.importSharePackage(pkgX42);
  var recs42b = await ChoreoLibrary.listProfiles();
  var known42b = recs42b.map(function (r) { return r.id; });
  var planT1 = CE6.pure.planRender(dancers42, known42b, p42a.id, recs42b, null);
  ok('收养不重绑在场舞者（无人指向新档案前规划逐字节不变）', JSON.stringify(planT1) === JSON.stringify(planT0));
  ok('收养不改文档字节（dancers 原样，profileId 只经绑定入口变）', JSON.stringify(dancers42) === snap42dancers);
  ok('同字节模型经收养去重复用（mblob 载荷数不变）',
    Array.from(fake42.stores.files.keys()).filter(function (k) { return k.indexOf('mblob:') === 0; }).length === blobCount42);
  // 经 P3 绑定入口改绑 ①：舞者 0（原绑 p42a/F_A）→ 收养档案（新指纹 F_X → 恰新增一条母版）
  var hashX42 = await ChoreoLibrary.hashObject(SKEL_X42);
  var keyX42 = hashX42 + '|n:body.glb#' + M42.byteLength;
  var set0 = CE6.pure.setDancerBinding(dancers42, 0, adoptX.pid, known42b);
  var planT2 = CE6.pure.planRender(dancers42, known42b, p42a.id, recs42b, null);
  ok('改绑生效（setDancerBinding 写同名字符串，原绑位换成收养档案）',
    set0 === dancers42[0] && dancers42[0].profileId === adoptX.pid);
  ok('新指纹 → 恰新增一条母版（+1），舞者 0 落到新指纹母版',
    planT2.masterKeys.length === planT1.masterKeys.length + 1 &&
    planT2.entries[0].masterKey === keyX42 && planT2.entries[0].state === 'bound');
  ok('其他舞者的条目逐字节不变（这次改绑不牵连任何人）',
    JSON.stringify(planT2.entries.slice(1)) === JSON.stringify(planT1.entries.slice(1)));
  // 改绑 ②：悬空位（舞者 6，ghost42→替身）改绑到同一收养档案 → 与舞者 0 共享 F_X 母版，替身按需消失
  var set6 = CE6.pure.setDancerBinding(dancers42, 6, adoptX.pid, known42b);
  var planT2b = CE6.pure.planRender(dancers42, known42b, p42a.id, recs42b, null);
  ok('悬空位修复：舞者 6 与舞者 0 共享新指纹母版，替身母版按需消失（无人再需要）',
    set6 === dancers42[6] && planT2b.entries[6].masterKey === keyX42 &&
    planT2b.masters[keyX42].dancers.join(',') === '0,6' &&
    planT2b.masterKeys.indexOf(planT2b.standinKey) < 0 &&
    planT2b.masterKeys.length === planT2.masterKeys.length - 1);
  ok('别的舞者的动作行字节不变（收养只写新档案命名空间）', (function () {
    var rows = [];
    fake42.stores.profileClips.forEach(function (v) { if (v.name === 'duet' && v.profileId !== adoptX.pid && v.profileId !== srcX42.id && v.profileId !== srcA2_42.id) rows.push(JSON.stringify(v)); });
    return rows.length === 2; // p42a、p42b 各一行，无第三行
  })());
  // 收养 ②：同指纹包 → 不新增母版（dedupe reuse iff identical）
  var adoptA2 = await ChoreoLibrary.importSharePackage(pkgA42);
  var recs42c = await ChoreoLibrary.listProfiles();
  var known42c = recs42c.map(function (r) { return r.id; });
  var set7 = CE6.pure.setDancerBinding(dancers42, 7, adoptA2.pid, known42c); // 未绑位改绑同指纹收养档案
  var planT3 = CE6.pure.planRender(dancers42, known42c, p42a.id, recs42c, null);
  var hashA42 = await ChoreoLibrary.hashObject(SKEL_A);
  var keyA42 = hashA42 + '|n:body.glb#' + M42.byteLength;
  ok('同指纹 → 不新增母版（母版数不变，舞者 7 与 A 组共享同一母版）',
    set7 === dancers42[7] && planT3.masterKeys.length === planT2b.masterKeys.length &&
    planT3.entries[7].masterKey === keyA42 && planT3.entries[1].masterKey === keyA42);
  ok('同指纹母版 profileIds 双列（p42a 与收养档案并列，舞者归并）',
    planT3.masters[keyA42].profileIds.indexOf(p42a.id) >= 0 && planT3.masters[keyA42].profileIds.indexOf(adoptA2.pid) >= 0);
  // 同骨架但缺模型不可借用另一档案的外观母版；七位既有舞者完全不动。
  var adoptNoModel42 = await ChoreoLibrary.importSharePackage(pkgANoModel42);
  var recsNoModel42 = await ChoreoLibrary.listProfiles();
  var knownNoModel42 = recsNoModel42.map(function (r) { return r.id; });
  CE6.pure.setDancerBinding(dancers42, 7, adoptNoModel42.pid, knownNoModel42);
  var planNoModel42 = CE6.pure.planRender(dancers42, knownNoModel42, p42a.id, recsNoModel42, null);
  ok('同骨架异外观另建母版，保留原七位舞者与无模型原因',
    planNoModel42.masterKeys.length === planT3.masterKeys.length + 1
    && planNoModel42.entries[7].skeletonHash === hashA42
    && planNoModel42.entries[7].masterKey === hashA42 + '|n:#0'
    && planNoModel42.entries[7].reason === 'no-model'
    && JSON.stringify(planNoModel42.entries.slice(0, 7)) === JSON.stringify(planT3.entries.slice(0, 7)));
  // 坏包拒绝：截断包 → 中文原因 + 会话与库逐字节不变
  var snap42dancers2 = JSON.stringify(dancers42);
  var snap42store = snapStore(fake42);
  var e42 = null;
  try { await ChoreoLibrary.importSharePackage(pkgX42.slice(0, pkgX42.size - 8)); } catch (err) { e42 = err; }
  ok('坏包（截断）拒绝（中文原因）', !!e42 && /不完整|越界/.test(e42.message), e42 ? e42.message : '未拦截');
  ok('坏包拒绝零写入（库快照逐字节不变）', snapStore(fake42) === snap42store);
  ok('坏包拒绝不动会话文档（dancers 字节不变）', JSON.stringify(dancers42) === snap42dancers2);

  section('四十三、P6 AC-6：会话中删档/备份重导/重复重置等价 + 畸形绑定形状 + 写入键白名单复证');
  var fake43 = new FakeIDB();
  ChoreoLibrary.useBackend(function (s, m) { return fake43.transaction(s, m); });
  var p43a = await ChoreoLibrary.createProfile({ name: '删档A', skeleton: SKEL_A });
  var p43b = await ChoreoLibrary.createProfile({ name: '删档B', skeleton: SKEL_B });
  var p43c = await ChoreoLibrary.createProfile({ name: '删档C', skeleton: SKEL_C41 });
  await ChoreoLibrary.putClip('duet', makeClip(3), p43a.id);
  await ChoreoLibrary.putClip('duet', makeClip(7), p43b.id);
  await ChoreoLibrary.importModelSet(p43a.id, [{ name: 'body.glb', blob: new Blob([glbBytes(23)]) }]);
  var dancers43 = [];
  for (var i43 = 0; i43 < 8; i43++) {
    var d43 = { id: i43, name: '舞者' + (i43 + 1), switchClips: [], actionClips: [], lyricClips: [] };
    if (i43 <= 2) d43.profileId = p43a.id;
    else if (i43 <= 5) d43.profileId = p43b.id;
    else d43.profileId = p43c.id;
    dancers43.push(d43);
  }
  var snap43dancers = JSON.stringify(dancers43);
  var bundle43 = await ChoreoLibrary.exportBundle(); // 删档前先备份（重导入用）
  var recs43 = await ChoreoLibrary.listProfiles();
  var known43 = recs43.map(function (r) { return r.id; });
  var planR0 = CE6.pure.planRender(dancers43, known43, p43a.id, recs43, null);
  var hashA43 = await ChoreoLibrary.hashObject(SKEL_A);
  var keyA43 = hashA43 + '|n:body.glb#' + glbBytes(23).byteLength;
  // 会话中删档：A 组舞者 → 替身 + missing-profile；文档字节不动
  await ChoreoLibrary.deleteProfile(p43a.id);
  var recs43b = await ChoreoLibrary.listProfiles();
  var known43b = recs43b.map(function (r) { return r.id; });
  var rb43 = CE6.pure.resolveBindings(dancers43, known43b, p43b.id);
  ok('删档瞬间：A 组三位 → missing（不静默回落活动档案），其余照常',
    rb43.filter(function (e) { return e.state === 'missing'; }).length === 3 &&
    rb43.filter(function (e) { return e.state === 'bound'; }).length === 5);
  ok('删档不动会话文档（dancers 字节不变，恢复后免重绑）', JSON.stringify(dancers43) === snap43dancers);
  var planR1 = CE6.pure.planRender(dancers43, known43b, p43b.id, recs43b, null);
  ok('删档后规划：A 组回落替身+missing-profile，F_A 母版消失，其他条目不变',
    planR1.entries.slice(0, 3).every(function (e) { return e.masterKey === planR1.standinKey && e.reason === 'missing-profile'; }) &&
    planR0.masterKeys.indexOf(keyA43) >= 0 && planR1.masterKeys.indexOf(keyA43) < 0 &&
    JSON.stringify(planR1.entries.slice(3)) === JSON.stringify(planR0.entries.slice(3)));
  // 备份重导：沿用原 id（P3 AC-9）→ 免手动重绑；重复重置等价
  var rep43 = await ChoreoLibrary.importBundle(bundle43);
  var recs43c = await ChoreoLibrary.listProfiles();
  var known43c = recs43c.map(function (r) { return r.id; });
  ok('重导 0 失败且档案沿用原 id（known43c 含原 p43a.id）',
    rep43.failed.length === 0 && known43c.indexOf(p43a.id) >= 0,
    'failed=' + rep43.failed.length + ' ids=' + known43c.join(',').slice(0, 60));
  var rb43c = CE6.pure.resolveBindings(dancers43, known43c, p43a.id);
  ok('重导后免重绑：A 组三位自动回到 bound（文档一字未改）',
    rb43c.filter(function (e) { return e.state === 'bound' && e.profileId === p43a.id; }).length === 3 &&
    JSON.stringify(dancers43) === snap43dancers);
  var planR2 = CE6.pure.planRender(dancers43, known43c, p43a.id, recs43c, null);
  var planR3 = CE6.pure.planRender(dancers43, known43c, p43a.id, recs43c, null);
  ok('重复重置等价：重导后两次规划与删档前逐字节相等（母版键/指派重建一致）',
    JSON.stringify(planR2) === JSON.stringify(planR0) && JSON.stringify(planR3) === JSON.stringify(planR2));
  // 畸形绑定形状（数字/空串/数组）：解析与未绑缺省完全同形；写入入口拒绝非字符串
  var bad43 = { id: 0, name: '坏形状', switchClips: [], actionClips: [], lyricClips: [], profileId: 7 };
  var bad43b = { id: 1, name: '空串', switchClips: [], actionClips: [], lyricClips: [], profileId: '' };
  var bad43c = { id: 2, name: '数组', switchClips: [], actionClips: [], lyricClips: [], profileId: ['x'] };
  var ref43 = { id: 3, name: '未绑', switchClips: [], actionClips: [], lyricClips: [] };
  var rbBad43 = CE6.pure.resolveBindings([bad43, bad43b, bad43c, ref43], known43c, p43a.id);
  ok('畸形形状=未绑缺省（数字/空串/数组全按 default 解析活动档案，与未绑同形）',
    rbBad43.every(function (e) { return e.state === 'default' && e.profileId === p43a.id && e.binding === null; }));
  ok('写入入口拒绝畸形（数字/数组 null 零改动；空串=清除）',
    CE6.pure.setDancerBinding([bad43], 0, 7, known43c) === null && bad43.profileId === 7 &&
    CE6.pure.setDancerBinding([bad43c], 0, ['x'], known43c) === null &&
    CE6.pure.setDancerBinding([bad43b], 0, '', known43c) === bad43b && !('profileId' in bad43b));
  // 写入键白名单复证：整轮删档/重导/重置后，库里只出现既有 v2 键族
  var bad43keys = [];
  fake43.stores.meta.forEach(function (v, k) {
    if (!/^(profile:|activeProfile$|clipMigration$|skeleton$)/.test(String(k))) bad43keys.push('meta:' + k);
  });
  fake43.stores.files.forEach(function (v, k) {
    if (!/^(pfile:|mblob:)/.test(String(k))) bad43keys.push('files:' + k);
  });
  ok('meta/files 只出现既有 v2 键族（profile:/activeProfile/pfile:/mblob: 等）', bad43keys.length === 0, bad43keys.join(','));
  var bad43pk = [];
  [fake43.stores.profileClips, fake43.stores.profileClipData].forEach(function (st) {
    st.forEach(function (v) {
      if (typeof v.profileId !== 'string' || !v.profileId || typeof v.name !== 'string' || !v.name) bad43pk.push(String(v.profileId) + '/' + String(v.name));
    });
  });
  ok('动作仓只出现 (profileId, name) 复合键行', bad43pk.length === 0, bad43pk.join(','));
  ok('旧全局仓（clips/clipdata）零行（无新键族）', fake43.stores.clips.size === 0 && fake43.stores.clipdata.size === 0);

  // ============ r2（TASK-20260918-ANIM-PACK-UNIVERSAL）：putClip 守卫 opt-in 覆盖扩展 ============
  // 旧守卫在「同名不同内容」处硬性取消且无开关——通用动作包「显式覆盖同名」无法在旧语义
  // 下表达，故加 guard.allowOverwrite（向后兼容：不传=旧行为逐字节一致）。

  section('四十四、r2 守卫覆盖：allowOverwrite 语义（旧守卫行为不变 + 覆盖/快照/切换复核）');
  var fake44 = new FakeIDB();
  ChoreoLibrary.useBackend(function (stores, mode) { return fake44.transaction(stores, mode); });
  var p44 = await ChoreoLibrary.createProfile({ name: 'r2守卫档', skeleton: SKEL_A });
  var snap44 = JSON.stringify(await ChoreoLibrary.getProfile(p44.id));
  var cur44 = { on: true, current: function () { return cur44.on; } };
  await ChoreoLibrary.putClip('packAct', makeClip(2), p44.id); // 既有同名（不同内容）
  // 说明：FakeIDB 近似后端在 onsuccess 期间 abort 只保证"零写入"，不一定触发 onabort
  // （真实 IndexedDB 会 reject——该 reject 语义由浏览器测试钉住）。本节按数据状态断言。
  async function attempt44(clip, guard) { try { await ChoreoLibrary.putClip('packAct', clip, p44.id, guard); return false; } catch (e) { return true; } }
  await attempt44(makeClip(5), { profileText: snap44, current: cur44.current, activeProfileId: p44.id });
  ok('旧语义保持：不带 allowOverwrite 的守卫不覆盖同名不同内容（原时长 2 保留）',
    (await ChoreoLibrary.getClip('packAct', p44.id)).duration === 2);
  await ChoreoLibrary.putClip('packAct', makeClip(5), p44.id, { profileText: snap44, current: cur44.current, activeProfileId: p44.id, allowOverwrite: true });
  ok('allowOverwrite=true：同快照同会话下显式替换成功（时长 5）',
    (await ChoreoLibrary.getClip('packAct', p44.id)).duration === 5);
  ok('覆盖后仍是一条元数据（复合键唯一，无重复行）',
    (await ChoreoLibrary.clipIndex(p44.id)).filter(function (c) { return c.name === 'packAct'; }).length === 1);
  await attempt44(makeClip(5), { profileText: snap44, current: cur44.current, activeProfileId: p44.id, allowOverwrite: true });
  ok('同内容重复覆盖=幂等（不报错不产生第二行）',
    (await ChoreoLibrary.clipIndex(p44.id)).filter(function (c) { return c.name === 'packAct'; }).length === 1);
  await attempt44(makeClip(7), { profileText: JSON.stringify(Object.assign({}, JSON.parse(snap44), { name: '已改名' })), current: cur44.current, allowOverwrite: true });
  ok('快照不符（档案已变化）→ 覆盖也被事务内复核拒绝（时长仍 5）',
    (await ChoreoLibrary.getClip('packAct', p44.id)).duration === 5);
  cur44.on = false;
  await attempt44(makeClip(9), { profileText: snap44, current: cur44.current, activeProfileId: p44.id, allowOverwrite: true });
  ok('会话失效（current()=false）→ 拒绝写入（时长仍 5）',
    (await ChoreoLibrary.getClip('packAct', p44.id)).duration === 5);
  cur44.on = true;
  var p44b = await ChoreoLibrary.createProfile({ name: 'r2守卫档乙', skeleton: SKEL_B });
  await ChoreoLibrary.setActiveProfile(p44b.id); // 模拟导入期间用户切换档案
  await attempt44(makeClip(9), { profileText: snap44, current: cur44.current, activeProfileId: p44.id, allowOverwrite: true });
  ok('活动指针变化（切换档案）→ 守卫拒绝（时长仍 5；通用包导入把它当取消信号）',
    (await ChoreoLibrary.getClip('packAct', p44.id)).duration === 5);

  ChoreoLibrary.useBackend(null); // 恢复真实库路径（虽然 node 里没有 indexedDB）
  console.log('\n[完成] ' + passes + ' 项通过，' + fails + ' 项失败');
  if (fails) process.exit(1);
}

run().catch(function (e) { console.log('  \u2718 测试框架异常：' + (e && e.stack || e)); process.exit(1); });
