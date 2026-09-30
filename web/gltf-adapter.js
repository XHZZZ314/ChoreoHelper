/**
 * gltf-adapter.js — ChoreoEngine ↔ glTF 模型适配器 v0.1
 *
 * 职责：加载 glTF 模型（Three.js GLTFLoader），把模型骨骼注册为引擎角色，
 * 使引擎的 AnimationClip（局部四元数/位移）直接驱动真实 3D 模型骨骼。
 *
 * 骨骼名映射策略（与 ENGINE.md 契约一致）：
 *   1. 按名字直配：动画骨骼名（sklb 原始名 / bone_N）== glTF node 名 → 直接匹配
 *   2. 映射表：skeleton.json 提供 { 动画名: gltfNode名 } → 加载时传入 map
 * 引擎只做名称透传，映射发生在适配层 —— 回家导出器产出什么，这里接什么。
 *
 * 用法：
 *   const { character, model, skinned } = await createGlTFCharacter(engine, {
 *     scene,              // THREE.Scene（模型会加进去）
 *     name: 'A',
 *     gltfUrl: 'role_xxx/model.gltf',
 *     idleClip,           // 引擎 clip
 *     boneMap: null,      // 可选：{ animName: gltfNodeName }
 *   });
 */
(function (global) {
  'use strict';

  /** 加载 glTF → 注册引擎角色。返回 Promise<{character, model, skinned, boneMap}>。 */
  function createGlTFCharacter(engine, opts) {
    return new Promise((resolve, reject) => {
      const { scene, name, gltfUrl, idleClip, boneMap } = opts;
      if (typeof THREE === 'undefined') { reject(new Error('THREE not loaded')); return; }
      if (!engine || !scene) { reject(new Error('engine/scene required')); return; }

      const loader = new THREE.GLTFLoader();
      loader.load(gltfUrl, (gltf) => {
        try {
          const model = gltf.scene;

          // 找蒙皮网格（取第一个）
          let skinned = null;
          model.traverse((o) => { if (!skinned && o.isSkinnedMesh) skinned = o; });
          if (!skinned) { reject(new Error('no skinned mesh in gltf')); return; }

          // 骨骼注册表：动画名 → THREE.Bone
          const registry = {};
          skinned.skeleton.bones.forEach((b) => registry[b.name] = b);
          if (boneMap) {
            // 显式映射优先（skeleton.json）
            for (const [animName, nodeName] of Object.entries(boneMap)) {
              if (registry[nodeName]) registry[animName] = registry[nodeName];
            }
          }

          const applyFn = (bn, pose) => {
            const b = registry[bn];
            if (!b) return;
            b.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
            if (pose.tx || pose.ty || pose.tz) {
              b.position.set(pose.tx, pose.ty, pose.tz);
            }
          };

          const character = engine.addCharacter({
            name,
            bones: registry,
            applyFn,
            idleClip: idleClip || null,
          });

          scene.add(model);

          // 返回附加句柄：调用方每帧（渲染前）调 updateSkin() 刷新蒙皮矩阵
          resolve({
            character,
            model,
            skinned,
            boneMap: registry,
            updateSkin: () => {
              // 骨骼矩阵 → 蒙皮矩阵（驱动顶点）
              if (skinned) {
                skinned.skeleton.update();
                skinned.updateMatrixWorld(true);
              }
            },
          });
        } catch (ex) { reject(ex); }
      }, undefined, (err) => reject(err));
    });
  }

  /** 便捷：从模型实际骨骼名生成可驱动该模型的程序化 clip（演示/无动画数据时用）。 */
  function generateDemoClip(boneMap, name, duration, type, opts) {
    const clip = { name, duration, type, bones: {} };
    const waveKey = (axis, ampDeg, freq, dur, fps = 30, phase = 0) => {
      const frames = [];
      const quat = new THREE.Quaternion();
      for (let t = 0; t <= dur + 1e-6; t += 1 / fps) {
        const ang = (ampDeg * Math.PI / 180) * Math.sin(2 * Math.PI * freq * t + phase);
        quat.setFromEuler(new THREE.Euler(axis === 'x' ? ang : 0, axis === 'y' ? ang : 0, axis === 'z' ? ang : 0));
        frames.push([+t.toFixed(3), quat.x, quat.y, quat.z, quat.w]);
      }
      return frames;
    };
    // 启发式选骨骼：包含关键词的优先，找不到取前 12 根；armR 排除 armL 已选中的
    const pick = (keys, exclude) => {
      for (const k of keys) {
        const hit = Object.keys(boneMap).find((n) => n.toLowerCase().includes(k) && n !== exclude);
        if (hit) return hit;
      }
      return null;
    };
    const all = Object.keys(boneMap);
    const spine = pick(['spine', 'Spine'], null) || all[1];
    const armL = pick(['arm', 'Arm', 'shoulder', 'Shoulder'], null) || all[2];
    const armR = pick(['arm', 'Arm', 'shoulder', 'Shoulder'], armL) || all[3] || armL;
    const dur = duration;
    if (armL && armR !== armL) clip.bones[armL] = { q: waveKey('z', 45, 1, dur) };
    if (armR) clip.bones[armR] = { q: waveKey('z', -45, 1, dur) };
    if (spine && opts && opts.twist) clip.bones[spine] = { q: waveKey('y', 25, 2, dur) };
    clip.meta = { spine, armL, armR };
    return clip;
  }

  global.ChoreoGLTF = { createGlTFCharacter, generateDemoClip };
})(typeof window !== 'undefined' ? window : globalThis);