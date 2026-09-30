// choreo-anim-pack-retarget.js — TASK-20260918-ANIM-PACK-UNIVERSAL r2：v2 通用动作包按档案
// 骨架换算（纯函数，导入与测试共用；file:// 经典脚本挂 window，node 测试挂 globalThis）。
//
// 干嘛的：v2 包全部剪辑统一 c0101 基准（包内 baseSkeleton 声明 106 骨参考）。导入时按
//        目标档案骨架「按骨名」换算：目标 bone_i 索引由骨名查目标骨架得出（绝不按下标
//        对位）；基准多余骨（目标没有的骨名）丢弃该骨动画；平移逐分量——源参考分量
//        |>1e-4 乘 目标参考/源参考 比例（负比例=镜像轴合法），≈0 加 目标-源 偏移，
//        量化 1e-4；比例非有限或 |r|>8 → 该骨平移整体保持原样并上报（不冒充全换算干净）；
//        时间戳/时长/四元数/缩放原样不动。与生成器 retargetTranslations 同数学（t-retarget
//        实证口径），换算后再过 §4 契约校验（时长>0/有限/时间严格递增/四元数归一）。
// 参考姿态来源（合同冻结口径）：档案有已知种族码且族包与档案骨架同名同父子拓扑一致 → 用族包该族参考
//        （在线抓取的档案骨架带即时姿态，参考平移不可靠）；无码但档案骨架本身是有效
//        参考骨架 → 用档案自身；码已知但拓扑不一致/档案骨架异常 → 该档案判不兼容；只有码没有可用
//        骨架 → 拒绝（空/未知骨架不能只凭码写入）。AP-R2-03：父子关系一律按显式 i 映射解析、
//        按骨名核对（合法乱序数组必须通过，同名改父必须拒绝）。
(function (root) {
  'use strict';
  function qz(v) { return Math.round(v * 1e4) / 1e4; }
  function finiteArr(a, n) {
    if (!Array.isArray(a) || a.length !== n) return false;
    for (var i = 0; i < n; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return false;
    return true;
  }

  // 参考骨架有效性：count/bones 匹配、i 唯一且在界、n 非空且唯一、t[3]/q[4]/s[3] 有限、
  // 父索引合法（-1 或界内且非自身，沿父链走不得成环）。
  // 父子解析一律走显式 i→骨 映射（bones 数组允许任意合法乱序，绝不用数组下标当骨索引）
  function validateRefSkeleton(skel) {
    if (!skel || typeof skel !== 'object') return { ok: false, reason: '骨架缺失' };
    if (typeof skel.count !== 'number' || !Number.isInteger(skel.count) || skel.count <= 0 || !Array.isArray(skel.bones) || skel.bones.length !== skel.count)
      return { ok: false, reason: '骨架 count/bones 不匹配' };
    var seenI = {}, seenN = {}, byIndex = {};
    for (var k = 0; k < skel.bones.length; k++) {
      var b = skel.bones[k];
      if (!b || typeof b !== 'object') return { ok: false, reason: '骨骼记录缺失（第 ' + k + ' 骨）' };
      if (typeof b.i !== 'number' || !Number.isInteger(b.i) || b.i < 0 || b.i >= skel.count) return { ok: false, reason: '骨骼索引越界（第 ' + k + ' 骨）' };
      if (seenI[b.i]) return { ok: false, reason: '骨骼索引重复：bone_' + b.i };
      seenI[b.i] = 1; byIndex[b.i] = b;
      if (typeof b.n !== 'string' || !b.n) return { ok: false, reason: '骨骼名缺失（bone_' + b.i + '）' };
      if (seenN[b.n]) return { ok: false, reason: '骨骼名重复：' + b.n };
      seenN[b.n] = 1;
      if (!finiteArr(b.t, 3) || !finiteArr(b.q, 4) || !finiteArr(b.s, 3)) return { ok: false, reason: '骨骼参考 t/q/s 缺失或非有限：' + b.n };
      if (typeof b.p !== 'number' || !Number.isInteger(b.p) || (b.p !== -1 && (b.p < 0 || b.p >= skel.count || b.p === b.i)))
        return { ok: false, reason: '骨骼父索引非法：' + b.n };
    }
    for (var k2 = 0; k2 < skel.bones.length; k2++) { // 父链成环检测（上限 count 步；按 i 映射走，不按数组下标）
      var cur = skel.bones[k2], steps = 0;
      while (cur && cur.p !== -1) { cur = byIndex[cur.p]; if (++steps > skel.count) return { ok: false, reason: '骨骼父链成环：' + skel.bones[k2].n }; }
    }
    return { ok: true };
  }

  // 骨架的 骨名→父骨名 映射（父按各自骨架的 i 映射解析；根骨父名记 ''）
  function parentNameMap(skel) {
    var byI = {}, par = {};
    for (var i = 0; i < skel.bones.length; i++) byI[skel.bones[i].i] = skel.bones[i];
    for (var j = 0; j < skel.bones.length; j++) {
      var bn = skel.bones[j];
      par[bn.n] = bn.p === -1 ? '' : (byI[bn.p] ? byI[bn.p].n : null);
    }
    return par;
  }

  // 同名拓扑判定（族包参考 vs 档案骨架）：骨名集合一致且每根骨的父骨名一致才算「拓扑一致」
  //（只比名字不比父子会漏掉改父攻击：同名改父必须拒绝）
  function sameNameTopology(a, b) {
    if (!a || !b || !Array.isArray(a.bones) || !Array.isArray(b.bones) || a.bones.length !== b.bones.length) return false;
    var pa = parentNameMap(a), pb = parentNameMap(b);
    for (var n in pa) { if (!(n in pb) || pa[n] !== pb[n]) return false; }
    for (var n2 in pb) if (!(n2 in pa)) return false;
    return true;
  }

  // v2 包结构校验（写入前整体拒绝；不碰库）。AP-R2-01：任何目标写入之前，包内
  // 全部剪辑的结构/通道/关键帧（§4 同口径同阈值）与全部条目引用必须整体校验通过——
  // 晚到的坏剪辑不得造成「前面的条目已入库」的部分写入。合法定长行（q=5 列、t/s=4 列）
  // 与 NaN 落拒绝侧由 validateConvertedClip 保证。
  function validatePackV2(pack) {
    if (!pack || typeof pack !== 'object') return { ok: false, reason: '动作包不是对象' };
    if (pack.formatVersion !== 2) return { ok: false, reason: '动作包格式版本不是 2（需要通用包 --universal）' };
    if (pack.baseSkeletonCode !== 'c0101') return { ok: false, reason: 'v2 包基准骨架码应为 c0101' };
    var bs = validateRefSkeleton(pack.baseSkeleton);
    if (!bs.ok) return { ok: false, reason: '基准骨架不合法：' + bs.reason };
    if (pack.baseSkeleton.count !== 106) return { ok: false, reason: '基准骨架应为 c0101 全 106 骨，实际 ' + pack.baseSkeleton.count };
    if (!Array.isArray(pack.clips) || !pack.clips.length) return { ok: false, reason: '包缺剪辑数据（clips 空）' };
    if (!Array.isArray(pack.entries) || !pack.entries.length) return { ok: false, reason: '包缺条目表（entries 空）' };
    for (var i = 0; i < pack.clips.length; i++) {
      var c = pack.clips[i];
      if (!c || typeof c !== 'object' || !c.clip || typeof c.clip !== 'object' || !c.clip.bones || typeof c.clip.bones !== 'object')
        return { ok: false, reason: '第 ' + i + ' 条剪辑缺 clip/bones 数据' };
      if (typeof c.clip.duration !== 'number' || !Number.isFinite(c.clip.duration) || c.clip.duration <= 0)
        return { ok: false, reason: '第 ' + i + ' 条剪辑时长非法' };
    }
    var seen = {};
    for (var e = 0; e < pack.entries.length; e++) {
      var en = pack.entries[e];
      if (!en || typeof en.name !== 'string' || !en.name) return { ok: false, reason: '第 ' + e + ' 条目名缺失' };
      if (seen[en.name]) return { ok: false, reason: '条目重名：' + en.name };
      seen[en.name] = 1;
      if (typeof en.clipIndex !== 'number' || !Number.isInteger(en.clipIndex) || en.clipIndex < 0 || en.clipIndex >= pack.clips.length)
        return { ok: false, reason: '条目引用不存在的剪辑：' + en.name };
    }
    var declaredIdx = {}; // 基准骨索引显式声明集（key=骨 i，与 bones 数组顺序无关）
    for (var bi = 0; bi < pack.baseSkeleton.bones.length; bi++) declaredIdx[pack.baseSkeleton.bones[bi].i] = 1;
    for (var d = 0; d < pack.clips.length; d++) { // 深度逐剪辑校验（写入前全包完成，任何一条坏 → 整包拒绝）
      var cc = pack.clips[d].clip;
      if (!Object.keys(cc.bones).length) return { ok: false, reason: '第 ' + d + ' 条剪辑无骨骼数据' };
      for (var bk2 in cc.bones) { // AP-R2-01B：骨键语法与基准骨索引声明也在整包预检完成——晚到的坏骨键
        // 不得等 convertClip 换算时才发现（那时前面的条目已入库）。索引按基准骨架显式 i 映射核对，
        // 与 bones 数组顺序无关（合法乱序基准照常通过）。
        var mk = /^bone_(\d+)$/.exec(bk2);
        if (!mk) return { ok: false, reason: '第 ' + d + ' 条剪辑骨骼键非法：' + bk2 };
        if (!declaredIdx[Number(mk[1])]) return { ok: false, reason: '第 ' + d + ' 条剪辑使用未声明的基准骨索引：' + bk2 };
      }
      var dv = validateConvertedClip(cc);
      if (!dv.ok) return { ok: false, reason: '第 ' + d + ' 条剪辑不合格：' + dv.reason };
    }
    return { ok: true, counts: { clips: pack.clips.length, entries: pack.entries.length } };
  }

  // §4 契约校验（与生成器 validateClip 同口径同阈值）：时长>0 有限、行值有限、
  // 行宽精确（q=时间+4 元、t/s=时间+3 元——短行显式拒绝，不得靠 undefined 参与
  // 数值比较蒙混）、时间严格递增、四元数范数 |1|<1e-6（NaN 比较为假，必须显式
  // 用「不满足容差即拒绝」的方向写，NaN 落到拒绝侧）
  function validateConvertedClip(clip) {
    if (!clip || typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0)
      return { ok: false, reason: '时长非法' };
    for (var bk in clip.bones) {
      var bone = clip.bones[bk];
      for (var ci = 0; ci < 3; ci++) {
        var ch = ['q', 't', 's'][ci], rows = bone[ch], width = ch === 'q' ? 5 : 4;
        if (!Array.isArray(rows) || rows.length < 2) return { ok: false, reason: bk + '.' + ch + ' 关键帧行不足' };
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (!Array.isArray(row) || row.length !== width) return { ok: false, reason: bk + '.' + ch + ' 第 ' + r + ' 行宽度非法（应为 ' + width + ' 列，实际 ' + (Array.isArray(row) ? row.length : '非数组') + '）' };
          for (var v = 0; v < row.length; v++) if (typeof row[v] !== 'number' || !Number.isFinite(row[v])) return { ok: false, reason: bk + '.' + ch + ' 含非有限值' };
          if (r > 0 && !(row[0] > rows[r - 1][0])) return { ok: false, reason: bk + '.' + ch + ' 时间不严格递增' };
          // ALG-02：缩放按真实预览引擎的入场契约校验，禁止已报导入成功的素材在播放时才拒绝。
          if (ch === 's' && (row[0] < 0 || row[1] <= 0 || row[2] <= 0 || row[3] <= 0))
            return { ok: false, reason: bk + '.s 缩放关键帧无效（时间须非负，缩放分量须大于零）' };
        }
        if (ch === 'q') for (var r2 = 0; r2 < rows.length; r2++) {
          var norm = rows[r2][1] * rows[r2][1] + rows[r2][2] * rows[r2][2] + rows[r2][3] * rows[r2][3] + rows[r2][4] * rows[r2][4];
          if (!(Math.abs(norm - 1) < 1e-6)) return { ok: false, reason: bk + '.q 四元数未归一（norm=' + norm + '）' }; // NaN 也落拒绝侧
        }
      }
    }
    return { ok: true };
  }

  // 单剪辑换算（核心）：clip 为包内 c0101 基准剪辑，targetSkeleton 为已验证的目标参考骨架。
  // 返回 {ok, clip, dropped:[被丢基准骨名], preserved:[平移保持原样的骨名]}；结构错返回 ok:false。
  function convertClip(clip, pack, targetSkeleton) {
    var baseBones = pack.baseSkeleton.bones;
    var baseByIndex = {};
    for (var i = 0; i < baseBones.length; i++) baseByIndex[baseBones[i].i] = baseBones[i];
    var target = {};
    for (var j = 0; j < targetSkeleton.bones.length; j++) target[targetSkeleton.bones[j].n] = targetSkeleton.bones[j];
    var outBones = {}, dropped = [], preserved = [];
    for (var bk in clip.bones) {
      var m = /^bone_(\d+)$/.exec(bk);
      if (!m) return { ok: false, reason: '剪辑骨骼键非法：' + bk };
      var base = baseByIndex[Number(m[1])];
      if (!base) return { ok: false, reason: '剪辑使用未声明的基准骨索引：' + bk };
      var tb = target[base.n];
      if (!tb) { dropped.push(base.n); continue; } // 基准多余骨：目标没有该骨名 → 丢弃该骨动画
      var src = clip.bones[bk];
      if (!src || !Array.isArray(src.q) || !Array.isArray(src.t) || !Array.isArray(src.s))
        return { ok: false, reason: '剪辑骨骼通道缺失：' + base.n };
      var ratios = [null, null, null], anomaly = false;
      for (var c = 0; c < 3; c++) {
        if (Math.abs(base.t[c]) > 1e-4) {
          var r = tb.t[c] / base.t[c];
          ratios[c] = r;
          if (!Number.isFinite(r) || Math.abs(r) > 8) anomaly = true; // 异常比例：整骨平移保持原样并上报
        }
      }
      var bone = { q: src.q, s: src.s }; // 旋转/缩放/时间原样（只读复用，不再改动）
      if (anomaly) { bone.t = src.t; preserved.push(base.n); }
      else bone.t = src.t.map(function (row) {
        var out = [row[0]]; // 时间戳原样
        for (var c2 = 0; c2 < 3; c2++)
          out.push(ratios[c2] === null ? qz(row[c2 + 1] + (tb.t[c2] - base.t[c2])) : qz(row[c2 + 1] * ratios[c2]));
        return out;
      });
      outBones['bone_' + tb.i] = bone; // 目标 bone_i 由骨名查得，绝不下标对位
    }
    if (!Object.keys(outBones).length) return { ok: false, reason: '目标骨架没有任何可映射骨骼' };
    var out = { name: clip.name, duration: clip.duration, type: clip.type || 'loop', bones: outBones };
    if (clip.offlinePrototype) out.offlinePrototype = clip.offlinePrototype; // 源身份保留
    return { ok: true, clip: out, dropped: dropped, preserved: preserved };
  }

  // 目标参考姿态解析（合同冻结口径，见文件头）：profileRow 为库内档案记录（含 skeleton），
  // skeletonPack 为 window.__CHOREO_SKELETON_PACK__ 或等价结构 {tribes:[{code,skeleton}]}。
  // 返回 {ok, refSkeleton, refSource, code} 或 {ok:false, reason}（该档案跳过，不写）。
  function resolveTargetRefs(profileRow, skeletonPack) {
    var code = profileRow && typeof profileRow.sourceSkeletonCode === 'string' && /^c\d{4}$/.test(profileRow.sourceSkeletonCode) ? profileRow.sourceSkeletonCode : '';
    var skel = profileRow && profileRow.skeleton ? profileRow.skeleton : null;
    var tribes = skeletonPack && Array.isArray(skeletonPack.tribes) ? skeletonPack.tribes : [];
    var tribe = code ? tribes.filter(function (t) { return t.code === code; })[0] : null;
    if (tribe) {
      var tv = validateRefSkeleton(tribe.skeleton);
      if (!tv.ok) return { ok: false, reason: '族包 ' + code + ' 参考骨架不合法：' + tv.reason };
      if (!skel)
        return { ok: false, reason: '档案种族码 ' + code + ' 有族包参考但档案无骨架，无法核对拓扑一致——不能只凭码写入空/未知骨架' };
      var pv = validateRefSkeleton(skel); // 先验档案骨架结构，再谈替换族包参考（异常骨架不得静默借族包参考写入）
      if (!pv.ok) return { ok: false, reason: '档案骨架异常（' + pv.reason + '），判不兼容' };
      if (!sameNameTopology(tribe.skeleton, skel))
        return { ok: false, reason: '档案种族码 ' + code + ' 与档案骨架骨名/父子拓扑不一致，判不兼容' };
      // ALG-01：族包只提供参考姿态；输出索引/父索引必须属于档案（同名拓扑可合法重编号）。
      var refsByName = Object.create(null);
      tribe.skeleton.bones.forEach(function (b) { refsByName[b.n] = b; });
      var targetRefs = Object.assign({}, tribe.skeleton, { bones: skel.bones.map(function (b) {
        return Object.assign({}, refsByName[b.n], { i: b.i, p: b.p });
      }) });
      return { ok: true, refSkeleton: targetRefs, refSource: 'bundled:' + code, code: code };
    }
    if (code && !tribe && !skel)
      return { ok: false, reason: '档案只有种族码 ' + code + ' 而无骨架，且族包无此码——不能只凭码写入空/未知骨架' };
    if (skel) {
      var pv2 = validateRefSkeleton(skel);
      if (!pv2.ok) return { ok: false, reason: '档案骨架不是有效参考骨架：' + pv2.reason };
      return { ok: true, refSkeleton: skel, refSource: code ? 'profile' : 'profile(无码)', code: code };
    }
    return { ok: false, reason: '档案无骨架无种族码，先建档（族包选择器或游戏在线）' };
  }

  root.ChoreoAnimPackRetarget = {
    validateRefSkeleton: validateRefSkeleton,
    sameNameTopology: sameNameTopology,
    validatePackV2: validatePackV2,
    validateConvertedClip: validateConvertedClip,
    convertClip: convertClip,
    resolveTargetRefs: resolveTargetRefs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
