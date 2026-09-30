// 将 Meddle 原始贴图与角色参数转换为可离线保存的基础 glTF 材质；保留原图，不冒充游戏着色器。
(function (root) {
  'use strict';
  var supported = ['character.shpk', 'characterlegacy.shpk', 'characterglass.shpk', 'skin.shpk', 'hair.shpk', 'iris.shpk', 'charactertattoo.shpk', 'characterocclusion.shpk'];
  function fail(message) { throw new Error(message); }
  function refs(doc) {
    var out = [];
    (doc.materials || []).forEach(function (m, index) {
      Object.keys(m.extras || {}).forEach(function (key) {
        if (!/_PngCachePath$/.test(key)) return;
        var value = m.extras[key];
        if (typeof value !== 'string' || !value || /^[\\/]|^[a-z][a-z0-9+.-]*:/i.test(value) || value.split(/[\\/]/).some(function (v) { return v === '..' || v === '.'; }))
          fail('Meddle 贴图引用必须位于所选 cache 内');
        out.push({ material: index, key: key, path: value.replace(/\\/g, '/') });
      });
    });
    return out;
  }
  function resolve(doc, rows, directory) {
    var references = refs(doc), roots = [], dir = directory, byPath = Object.create(null);
    rows.forEach(function (r) { byPath[r.path] = r; });
    while (true) {
      roots.push(dir + 'cache/');
      if (!dir) break;
      dir = dir.slice(0, -1); dir = dir.slice(0, dir.lastIndexOf('/') + 1);
    }
    var candidates = roots.map(function (prefix) {
      return { prefix: prefix, matches: references.map(function (r) { return byPath[prefix + r.path]; }) };
    }).filter(function (c) { return c.matches.some(Boolean); });
    if (candidates.length > 1) fail('找到多套 Meddle cache，请只选择一套人物和配套贴图');
    if (!candidates.length) return { references: references, rows: [], missingAll: true };
    var c = candidates[0], missing = c.matches.findIndex(function (r) { return !r; });
    if (missing >= 0) fail('缺少配套文件「' + references[missing].path + '」，请选择包含完整 cache 的文件夹');
    c.matches.forEach(function (r) { if (!r.blob.size) fail('配套贴图「' + r.name + '」是空的'); });
    return { references: references, rows: c.matches, missingAll: false };
  }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function srgb(x) { x = clamp(x); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }
  function linear(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
  function color(value) {
    var a = Array.isArray(value) ? value.slice(0, 3) : value && [value.X, value.Y, value.Z];
    if (!a || a.length !== 3 || !a.every(Number.isFinite)) fail('Meddle 材质缺少有效颜色参数');
    return a;
  }
  function sample(image, x, y, width, height) {
    if (!image) return [255, 255, 255, 255];
    var i = (Math.min(image.height - 1, Math.floor(y * image.height / height)) * image.width + Math.min(image.width - 1, Math.floor(x * image.width / width))) * 4;
    return image.data.subarray(i, i + 4);
  }
  // 通道依据：Penumbra MaterialExporter / Meddle 导出参数；基础色、透明度、法线，不复刻游戏特效。
  function pixels(shader, e, images) {
    var n = images.normal, d = images.diffuse, mask = images.mask, index = images.index;
    if (!n) fail('Meddle 材质缺少法线贴图');
    // MeddleTools 0.2.0 shaders.blend: 黑色 / IOR=1，SamplerNormal.Alpha → Alpha；无人物颜色或法线连接。
    if (shader === 'characterocclusion.shpk') {
      var shadow = new Uint8ClampedArray(n.width * n.height * 4);
      for (var a = 3; a < shadow.length; a += 4) shadow[a] = n.data[a];
      return { width: n.width, height: n.height, base: shadow, normal: null };
    }
    var cloth = /^(character|characterlegacy|characterglass)\.shpk$/.test(shader);
    var table = e.ColorTable && e.ColorTable.ColorTable && e.ColorTable.ColorTable.Rows;
    if (cloth && (!index || !Array.isArray(table) || table.length !== 32)) fail('服装材质缺少索引图或 32 行颜色表');
    if (/^(skin|iris)\.shpk$/.test(shader) && !d) fail('人物材质缺少颜色贴图');
    if (/^(hair|iris)\.shpk$/.test(shader) && !mask) fail('人物材质缺少遮罩贴图');
    var primary = cloth ? index : d || n, w = primary.width, h = primary.height;
    var base = new Uint8ClampedArray(w * h * 4), normal = new Uint8ClampedArray(w * h * 4);
    var main = shader === 'hair.shpk' ? color(e.MainColor) : null;
    var roughness = main ? new Uint8ClampedArray(w * h * 4) : null;
    var highlight = shader === 'hair.shpk' && e.Highlights ? color(e.MeshColor) : main;
    var skin = shader === 'skin.shpk' ? color(e.SkinColor) : null;
    var iris = shader === 'iris.shpk' ? color(e.LeftIrisColor) : null;
    if (iris && JSON.stringify(color(e.RightIrisColor)) !== JSON.stringify(iris)) fail('异色瞳材质需要按眼睛区分，当前基础适配尚不支持');
    var tattoo = shader === 'charactertattoo.shpk' ? color(e.OptionColor) : null;
    var colors = cloth ? table.map(function (r) { return color(r.Diffuse); }) : null;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var offset = (y * w + x) * 4, np = sample(n, x, y, w, h), dp = sample(d, x, y, w, h), mp = sample(mask, x, y, w, h);
      var rgb, alpha = 1;
      if (cloth) {
        var ip = sample(index, x, y, w, h), row = Math.min(15, Math.round(ip[0] / 17)) * 2, blend = 1 - ip[1] / 255;
        rgb = colors[row].map(function (v, k) { return (v * (1 - blend) + colors[row + 1][k] * blend) * linear(dp[k] / 255) * mp[2] / 255; });
        alpha = np[2] / 255 * dp[3] / 255;
      } else if (main) {
        rgb = main.map(function (v, k) { return (v * (1 - np[2] / 255) + highlight[k] * np[2] / 255) * mp[3] / 255; });
        alpha = np[3] / 255;
        // MeddleTools hair: Mask.R 是粗糙度，G 是反光强度；glTF 粗糙度必须放在线性的 G 通道。
        roughness.set([255, mp[0], 0, 255], offset);
      } else if (skin) {
        rgb = skin.map(function (v, k) { return linear(dp[k] / 255) * (1 - np[2] / 255 + v * np[2] / 255); });
        alpha = dp[3] / 255;
      } else if (iris) {
        rgb = iris.map(function (v, k) { return linear(dp[k] / 255) * (1 - mp[2] / 255 + v * mp[2] / 255); });
      } else if (tattoo) { rgb = tattoo; alpha = np[3] / 255; }
      else fail('尚未支持的 Meddle 材质');
      for (var k = 0; k < 3; k++) base[offset + k] = Math.round(srgb(rgb[k]) * 255);
      base[offset + 3] = Math.round(clamp(alpha) * 255);
      normal.set([np[0], np[1], 255, 255], offset);
    }
    return { width: w, height: h, base: base, normal: normal, roughness: roughness };
  }
  async function decode(blob) {
    var bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16777216) fail('贴图尺寸过大或无效');
      var canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      var ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
    } finally { bitmap.close(); }
  }
  async function encode(width, height, data) {
    var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
    return new Promise(function (ok, no) { canvas.toBlob(function (blob) { blob ? ok(blob) : no(new Error('贴图转换失败')); }, 'image/png'); });
  }
  function preserveVertexChannels(doc, adapted) {
    (doc.meshes || []).forEach(function (mesh) {
      (mesh.primitives || []).forEach(function (primitive) {
        if (adapted.indexOf(primitive.material) < 0) return;
        var attributes = primitive.attributes || {};
        // 游戏顶点通道参与专用着色，不能再让标准 glTF 把它直接乘到底色；保留原访问器和字节。
        if (attributes.COLOR_0 !== undefined) {
          attributes._CHOREO_MEDDLE_COLOR_0 = attributes.COLOR_0;
          delete attributes.COLOR_0;
        }
        var morphColors = [];
        (primitive.targets || []).forEach(function (target, index) {
          if (target.COLOR_0 === undefined) return;
          morphColors.push({ target: index, accessor: target.COLOR_0 });
          delete target.COLOR_0;
        });
        if (morphColors.length) primitive.extras = Object.assign({}, primitive.extras, { choreoMeddleMorphColors: morphColors });
      });
    });
  }
  async function adapt(doc, rows, directory) {
    if (doc.extras && doc.extras.choreoMeddlePreview) return false;
    var found = resolve(doc, rows, directory);
    if (!found.references.length || found.missingAll) return false;
    var cache = new Map(), adapted = [], unsupported = [], rawImages = [], usedPaths = new Set(rows.map(function (r) { return r.path; }));
    doc.images = doc.images || []; doc.textures = doc.textures || [];
    function image(uri, extras) { var id = doc.images.length; doc.images.push({ uri: uri, extras: extras }); return id; }
    function relative(path) {
      var from = directory.split('/').filter(Boolean), to = path.split('/');
      while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
      return '../'.repeat(from.length) + to.map(encodeURIComponent).join('/');
    }
    var rawIds = new Map();
    found.references.forEach(function (ref, i) {
      var row = found.rows[i];
      if (!rawIds.has(row.path)) rawIds.set(row.path, image(relative(row.path), { choreoRawMeddle: true }));
      rawImages.push({ material: ref.material, key: ref.key, image: rawIds.get(row.path) });
    });
    async function load(material, key) {
      var i = found.references.findIndex(function (r) { return r.material === material && r.key === key; });
      if (i < 0) return null;
      var row = found.rows[i];
      if (!cache.has(row.path)) cache.set(row.path, decode(row.blob));
      return cache.get(row.path);
    }
    async function texture(data, width, height, label) {
      var name = 'choreo-material-' + label + '.png', path = directory + name, count = 1;
      while (usedPaths.has(path)) { name = 'choreo-material-' + label + '-' + count++ + '.png'; path = directory + name; }
      usedPaths.add(path); rows.push({ name: name, path: path, blob: await encode(width, height, data) });
      var id = doc.textures.length; doc.textures.push({ source: image(name, { choreoDerivedMeddle: true }) }); return { index: id };
    }
    for (var i = 0; i < (doc.materials || []).length; i++) {
      var m = doc.materials[i], e = m.extras || {}, shader = e.ShaderPackage;
      if (!found.references.some(function (r) { return r.material === i; })) continue;
      if (supported.indexOf(shader) < 0) { unsupported.push(shader || m.name || String(i)); continue; }
      // 已有标准纹理的材质不覆盖；仅适配纯 RAW 导出。
      if (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture) continue;
      var input = {};
      for (var pair of [['normal', 'Normal'], ['diffuse', 'Diffuse'], ['mask', 'Mask'], ['index', 'Index']]) input[pair[0]] = await load(i, 'g_Sampler' + pair[1] + '_PngCachePath');
      var converted = pixels(shader, e, input);
      m.pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1,
        baseColorTexture: await texture(converted.base, converted.width, converted.height, i + '-base') };
      if (converted.normal) m.normalTexture = await texture(converted.normal, converted.width, converted.height, i + '-normal');
      else {
        // 无反光的黑色透明遮蔽用标准 unlit 保存，避免标准 PBR 给阴影片加上高光。
        delete m.normalTexture;
        m.extensions = Object.assign({}, m.extensions, { KHR_materials_unlit: {} });
        doc.extensionsUsed = doc.extensionsUsed || [];
        if (doc.extensionsUsed.indexOf('KHR_materials_unlit') < 0) doc.extensionsUsed.push('KHR_materials_unlit');
      }
      if (converted.roughness) m.pbrMetallicRoughness.metallicRoughnessTexture = await texture(converted.roughness, converted.width, converted.height, i + '-roughness');
      m.doubleSided = !!e.RenderBackfaces;
      m.alphaMode = /glass|tattoo|occlusion/.test(shader) ? 'BLEND' : shader === 'iris.shpk' || (shader === 'skin.shpk' && e.GetMaterialValue === 'GetMaterialValueBody') ? 'OPAQUE' : 'MASK';
      if (m.alphaMode === 'MASK') m.alphaCutoff = 0.5;
      else delete m.alphaCutoff;
      adapted.push(i);
    }
    preserveVertexChannels(doc, adapted);
    doc.extras = Object.assign({}, doc.extras, { choreoMeddlePreview: { version: 1, adapted: adapted, unsupported: unsupported, rawImages: rawImages } });
    return true;
  }
  root.ChoreoMeddleMaterial = { references: refs, resolve: resolve, pixels: pixels, adapt: adapt, preserveVertexChannels: preserveVertexChannels };
})(typeof window !== 'undefined' ? window : globalThis);
