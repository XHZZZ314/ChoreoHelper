// 模型导入：自动找齐导出文件夹中的模型、骨骼缓冲和贴图，并为指定舞者新建独立档案。
(function (root) {
  'use strict';

  function failure(message) { throw new Error(message); }
  // 未附贴图只说明资产内容，不把有意使用纯色材质的模型判作损坏。
  function appearanceNote(doc) {
    if (!doc || !doc.asset) return '';
    var preview = doc.extras && doc.extras.choreoMeddlePreview;
    if (preview && preview.version === 1) return (preview.adapted.length ? '基础贴图预览（' + preview.adapted.length + ' 个材质）' : '原始贴图已保存，材质尚未适配') + (preview.unsupported.length ? '；尚有 ' + preview.unsupported.length + ' 个特殊材质未适配' : '') + '；染色细节、反光及游戏外观尚未验收';
    if (!(Array.isArray(doc.textures) && doc.textures.length) && root.ChoreoMeddleMaterial && ChoreoMeddleMaterial.references(doc).length) return 'Meddle 原始贴图未载入，当前仅预览网格；请选包含 cache 的完整文件夹';
    return Array.isArray(doc.textures) && doc.textures.length ? '' : '模型未附带贴图，按文件内材质预览；游戏外观尚未验收';
  }
  function base(path) { return String(path).split('/').pop(); }
  function cleanPath(path) {
    var out = [];
    String(path).replace(/\\/g, '/').split('/').forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') { if (!out.length) failure('配套文件超出了所选文件夹，请选择包含模型和贴图的上一级文件夹'); out.pop(); }
      else out.push(part);
    });
    return out.join('/');
  }
  function localUri(uri) {
    if (typeof uri !== 'string' || !uri) return null;
    if (/^data:/i.test(uri)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || /^[\\/]/.test(uri))
      failure('模型引用了外部地址，只能导入所选文件夹内的本地配套文件');
    try { return decodeURIComponent(uri.split(/[?#]/)[0]); }
    catch (e) { failure('模型里的配套文件地址编码不正确'); }
  }
  function parseGlb(bytes) {
    if (bytes.byteLength < 20) failure('GLB 文件不完整');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength)
      failure('GLB 文件头或文件长度不正确，请重新导出');
    var length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || length % 4 || length > bytes.byteLength - 20)
      failure('GLB 模型说明不完整');
    var cursor = 20 + length;
    while (cursor < bytes.byteLength) {
      if (bytes.byteLength - cursor < 8) failure('GLB 配套数据不完整');
      var size = view.getUint32(cursor, true);
      if (size % 4 || size > bytes.byteLength - cursor - 8) failure('GLB 配套数据不完整');
      cursor += 8 + size;
    }
    var doc;
    try { doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))); }
    catch (e) { failure('GLB 模型说明无法读取'); }
    return { doc: doc, tail: bytes.subarray(20 + length) };
  }
  function writeGlb(doc, tail) {
    var json = new TextEncoder().encode(JSON.stringify(doc));
    var padded = (json.length + 3) & ~3;
    var bytes = new Uint8Array(20 + padded + tail.length), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
    view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + padded); bytes.set(json, 20); bytes.set(tail, 20 + padded);
    return new Blob([bytes], { type: 'model/gltf-binary' });
  }
  async function prepare(files) {
    var inputs = Array.prototype.slice.call(files || []), rows = [], byPath = Object.create(null);
    inputs.forEach(function (file) {
      var blob = file && (file.blob || file), path = file && (file.webkitRelativePath || file.path || file.name);
      if (!blob || !path || typeof blob.arrayBuffer !== 'function') failure('所选模型文件无法读取');
      path = cleanPath(path);
      if (!path || byPath[path]) failure('所选文件存在重复路径，请只选择一套完整导出');
      var row = { path: path, name: base(path), blob: blob };
      rows.push(row); byPath[path] = row;
    });
    var entries = rows.filter(function (row) { return /\.(glb|gltf)$/i.test(row.name); });
    if (!entries.length) failure('没有找到 GLB 或 glTF 模型，请选择 Meddle 导出的角色文件夹');
    if (entries.length !== 1) failure('找到了 ' + entries.length + ' 个模型，请选择单个角色的导出文件夹：' + entries.slice(0, 4).map(function (row) { return row.name; }).join('、'));
    var entry = entries[0];
    if (!entry.blob.size) failure('模型文件是空的，请等待导出完成后重试');
    var bytes = new Uint8Array(await entry.blob.arrayBuffer()), doc, glb = null;
    if (/\.glb$/i.test(entry.name)) { glb = parseGlb(bytes); doc = glb.doc; }
    else {
      try { doc = JSON.parse(new TextDecoder().decode(bytes)); }
      catch (e) { failure('glTF 模型说明无法读取，请等待导出完成后重试'); }
    }
    if (!doc || typeof doc !== 'object' || !doc.asset || !/^2(?:\.|$)/.test(String(doc.asset.version || '')))
      failure('需要 glTF 2.0 模型文件');
    var selected = [entry], usedNames = Object.create(null), mapped = Object.create(null), changed = false;
    usedNames[entry.name] = true; mapped[entry.path] = entry.name;
    var directory = entry.path.slice(0, entry.path.length - entry.name.length);
    if (root.ChoreoMeddleMaterial && await ChoreoMeddleMaterial.adapt(doc, rows, directory)) {
      changed = true; rows.forEach(function (row) { byPath[row.path] = row; });
    }
    ['buffers', 'images'].forEach(function (kind) {
      if (doc[kind] !== undefined && !Array.isArray(doc[kind])) failure('模型配套文件清单格式不正确');
      (doc[kind] || []).forEach(function (item) {
        if (!item || typeof item !== 'object') failure('模型配套文件清单格式不正确');
        var uri = localUri(item.uri);
        if (uri === null) return;
        var path = cleanPath(directory + uri), row = byPath[path];
        // 普通多选器不提供目录；只有基名唯一时才允许配对，不猜同名贴图。
        if (!row && rows.every(function (r) { return r.path === r.name; })) {
          var matches = rows.filter(function (r) { return r.name === base(uri); });
          if (matches.length === 1) row = matches[0];
        }
        if (!row) failure('缺少配套文件「' + base(uri) + '」，请选择包含它的完整导出文件夹');
        if (!row.blob.size) failure('配套文件「' + row.name + '」是空的，请等待导出完成后重试');
        if (!mapped[row.path]) {
          var safeName = row.name.replace(/[?#%]/g, '_');
          var name = safeName, suffix = 1;
          while (usedNames[name]) name = 'asset-' + suffix++ + '-' + safeName;
          usedNames[name] = true; mapped[row.path] = name; selected.push(row);
        }
        // 保留文件名原文；资料库备份也按原名校验配套，加载器会处理 URL 转义。
        var targetUri = mapped[row.path];
        if (item.uri !== targetUri) { item.uri = targetUri; changed = true; }
      });
    });
    var entryBlob = changed ? (glb ? writeGlb(doc, glb.tail) : new Blob([JSON.stringify(doc)], { type: 'model/gltf+json' })) : entry.blob;
    return {
      entry: entry.name, label: entry.name.replace(/\.(glb|gltf)$/i, ''),
      appearanceNote: appearanceNote(doc),
      files: selected.map(function (row) { return { name: mapped[row.path], blob: row === entry ? entryBlob : row.blob }; }),
      ignoredCount: rows.length - selected.length
    };
  }
  // 名字相同仍可能属于不同骨架；局部姿势只能写到父子关系完全对应的蒙皮骨骼。
  function checkSkeletonHierarchy(scene, skeleton) {
    var bones = skeleton && skeleton.bones, nodes = Object.create(null), matched = [];
    if (!Array.isArray(bones) || skeleton.count !== bones.length || !bones.length)
      return { ok: false, reason: '角色档案的骨架清单不完整' };
    scene.traverse(function (node) {
      if (!node.isBone || !node.name) return;
      var name = String(node.name).toLowerCase();
      (nodes[name] || (nodes[name] = [])).push(node);
    });
    var names = Object.create(null);
    for (var i = 0; i < bones.length; i++) {
      var bone = bones[i], key = bone && String(bone.n || '').toLowerCase();
      if (!key || names[key] || bone.i !== i || !Number.isInteger(bone.p) || bone.p < -1 || bone.p >= bones.length || bone.p === i)
        return { ok: false, reason: '角色档案的骨架编号或父子关系不完整' };
      names[key] = true;
      if (!nodes[key] || nodes[key].length !== 1)
        return { ok: false, reason: '模型缺少唯一蒙皮骨骼「' + bone.n + '」' };
      matched.push(nodes[key][0]);
    }
    for (var j = 0; j < bones.length; j++) {
      var parent = matched[j].parent, expected = bones[j].p;
      if (expected >= 0 ? parent !== matched[expected] : parent && parent.isBone)
        return { ok: false, reason: '模型骨骼「' + bones[j].n + '」的父子关系与角色档案不同' };
    }
    return { ok: true, reason: '' };
  }
  async function importCharacter(options) {
    var target = options.target;
    if (!target || typeof target.isCurrent !== 'function' || typeof target.bind !== 'function' || !target.isCurrent())
      failure('请先选中要使用模型的舞者，再导入');
    var chosenSkeleton = options.skeleton, source = null;
    if (options.boundProfileId) {
      source = await options.library.getProfile(options.boundProfileId);
      if (!source || source.id !== options.boundProfileId || !source.skeleton)
        failure('绑定的角色档案缺失，请恢复档案或明确重新选择舞者模型后再导入');
      if (!/^[a-f0-9]{64}$/.test(source.skeletonHash || '') || await options.library.hashObject(source.skeleton) !== source.skeletonHash)
        failure('绑定角色的骨架内容校验不符，请恢复资料库备份后再导入');
      chosenSkeleton = source.skeleton;
    }
    if (!chosenSkeleton || !Array.isArray(chosenSkeleton.bones) || !chosenSkeleton.bones.length)
      failure('还没有当前角色的骨架，请先连接游戏并打开 3D 预览');
    var skeleton = JSON.parse(JSON.stringify(chosenSkeleton));
    var reuseSource = null, reuseNote = '';
    var sourceId = options.boundProfileId || options.sourceProfileId;
    if (sourceId) {
      if (!source) source = await options.library.getProfile(sourceId);
      var skeletonHash = await options.library.hashObject(skeleton);
      if (source && source.skeleton && /^[a-f0-9]{64}$/.test(skeletonHash) && source.skeletonHash === skeletonHash && await options.library.hashObject(source.skeleton) === skeletonHash)
        reuseSource = source.id;
      else reuseNote = '原角色的骨架不同，已有动作未复制';
    }
    var prepared = await prepare(options.files);
    if (typeof options.validate !== 'function') failure('模型检查尚未准备好，请稍后重试');
    await options.validate(prepared, skeleton);
    if (!target.isCurrent()) failure('导入期间切换了项目或舞者，本次没有保存，请重新选择目标后导入');
    // 所有解析和检查完成后，模型与骨架一起入库；已有档案始终保留。
    var profile = await options.library.createProfile({ name: prepared.label, skeleton: skeleton, files: prepared.files, copyClipsFrom: reuseSource });
    var bound = false, bindingError = '';
    try { bound = target.isCurrent() ? await target.bind(profile.id) : false; }
    catch (error) { bindingError = String(error && error.message || error); }
    return { profile: profile, prepared: prepared, bound: !!bound, bindingError: bindingError, copiedClipCount: profile.copiedClipCount || 0, reuseNote: reuseNote };
  }
  root.ChoreoModelImport = { prepare: prepare, importCharacter: importCharacter, checkSkeletonHierarchy: checkSkeletonHierarchy, appearanceNote: appearanceNote };
})(typeof window !== 'undefined' ? window : globalThis);
