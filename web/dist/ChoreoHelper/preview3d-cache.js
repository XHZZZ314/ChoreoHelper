/**
 * preview3d-cache.js — 3D 预览面板的「模型资源缓存层」（AUD2-012 会话级缓存＋身份/校验工具）
 *
 * 干嘛的：OVERHAUL 批 B 从 preview3d.js 拆出的第二块——模型缓存表 _modelCache 与围绕它的
 *        键/校验/兼容结论工具整体搬家，代码逐字保留（闭包读改 host 访问器读，行为不变）。
 * 怎么接：经典脚本、window 全局、file:// 兼容；必须在 preview3d.js 之前加载。
 *        preview3d.js 调 Preview3DCache.create(host) 拿唯一实例（host 提供 GLTFLoader/
 *        profile/skeleton 的实时读与 initGen() 代次读取）。
 * 缓存条目形状（与拆分前一致）：{gltf, note:''} | {note}（不兼容结论）| {compatOk:true, gltf, hash}
 *        | {compatOk:false, note}——键口径见各函数注释；缓存件从不入场景、不改骨骼。
 */
(function () {
  'use strict';

  function create(host) {
    function standinKey() {
      var s = window.__CHOREO_STANDIN_MODEL__;
      if (!s) return null;
      try { return JSON.stringify(s); } catch (e) { return null; }
    }

    // AUD2-012（OPT-F）：会话级模型缓存——档案切换/整体重置不再重复 下载→parse→hash→写库。
    // 身份口径：档案模型=档案id+内容hash（可信，库写入时盖的章）；部署位模型=文件名+字节数+
    // 当前骨架签名（部署位文件被替换字节数几乎必变，同字节数+同骨架视作同一份）。
    // 缓存的解析结果只被 SkeletonUtils.clone（克隆体共享的 geometry/材质在 reset 时 dispose，
    // three 下次使用会自动重新上传 GPU——AUD-020 已验证这条路），缓存件本身从不入场景、不改骨骼
    var _modelCache = {};
    function skeletonSig() {
      var profile = host.profile, skeleton = host.skeleton;
      if (profile && profile.skeletonHash) return profile.skeletonHash;
      var s = 0;
      ((skeleton && skeleton.bones) || []).forEach(function (b) {
        s = (s + Math.round(((b.t && b.t[0]) || 0) * 1000) + Math.round(((b.t && b.t[1]) || 0) * 1000) + String(b.n || '').length) | 0;
      });
      return ((skeleton && skeleton.count) || 0) + ':' + (s >>> 0).toString(36);
    }
    function cachePut(key, val) {
      _modelCache[key] = val;
      var ks = Object.keys(_modelCache);
      if (ks.length > 8) delete _modelCache[ks[0]]; // FIFO 兜底，防多档案大模型吃内存
    }
    function cacheGet(key) {
      return _modelCache[key]; // 条目形状：{gltf, note:''} | {note}（不兼容结论）
    }

    // 替身解析（AUD2-012 会话级缓存只 parse 一次；gen 过期返回 null 不写缓存）
    async function parseStandinCached(gen) {
      var standin = window.__CHOREO_STANDIN_MODEL__;
      if (!standin) return null;
      var skey = 'standin:' + ((standinKey() || '').length);
      var sc = _modelCache[skey];
      if (sc && sc.gltf) return sc.gltf;
      var gltf = await new Promise(function (ok, err) { new host.GLTFLoader().parse(standin, '', ok, err); });
      if (gen !== undefined && gen !== host.initGen()) return null;
      cachePut(skey, { gltf: gltf });
      return gltf;
    }

    // 模型↔骨架兼容性：骨名全对上 + 局部偏移中位数单位比接近 1（同源导出应≈1:1）
    function checkModelCompat(gltfScene, skel) {
      var byName = {}, byLower = {};
      gltfScene.traverse(function (o) {
        if (o.name) {
          byName[o.name] = o;
          if (!byLower[o.name.toLowerCase()]) byLower[o.name.toLowerCase()] = o;
        }
      });
      var matched = 0, rs = [];
      skel.bones.forEach(function (b) {
        var n = byName[b.n] || byLower[String(b.n).toLowerCase()] || null;
        if (!n) return;
        matched++;
        var a = n.position.length(), c = Math.hypot(b.t[0], b.t[1], b.t[2]);
        if (a > 1e-6 && c > 1e-6) rs.push(a / c);
      });
      rs.sort(function (x, y) { return x - y; });
      var ratio = rs.length ? rs[rs.length >> 1] : 0;
      return { matched: matched, ratio: ratio, ok: matched === skel.count && ratio >= 0.8 && ratio <= 1.25 };
    }

    // FIX-D/AUD2-009 三道闸用的内容摘要与校验（纯函数）
    async function sha256HexBuf(ab) {
      if (!(typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest)) return '';
      var d = await crypto.subtle.digest('SHA-256', ab);
      var b = new Uint8Array(d), s = '';
      for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s;
    }
    // hash 元数据缺失（老数据）时跳过校验（无法确认不算失败）；有 hash 对不上=文件坏了
    async function fileHashOk(ab, want) {
      if (!want) return true;
      var got = await sha256HexBuf(ab);
      return !got || got === want;
    }

    return {
      standinKey: standinKey,
      skeletonSig: skeletonSig,
      cacheGet: cacheGet,
      cachePut: cachePut,
      parseStandinCached: parseStandinCached,
      checkModelCompat: checkModelCompat,
      sha256HexBuf: sha256HexBuf,
      fileHashOk: fileHashOk
    };
  }

  window.Preview3DCache = { create: create };
})();
