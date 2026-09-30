/**
 * trim-loop-clips.js — 批量录制后期处理工具（node 脚本，AI 用）
 *
 * 干嘛的：批量录制完成后对 %AppData%\XIVLauncherCN\ChoreoExports\clips 里的 json 做两件事：
 *  1. check  —— 质量检查：逐条算动作幅度，找出录成"静止姿势"的坏数据（要重录的清单）
 *  2. trim   —— 循环剪裁：20 秒上限掐断的持续/循环类动作（跳舞等），检测循环周期，
 *               剪成整数个周期并标记 type:"loop"，让 3D 预览循环衔接不跳帧、文件也变小。
 *               周期检测不可靠的（猛汉行进这类一次性长Routine）保持 once 不动。
 *
 * 用法：
 *   D:/nodejs/node.exe scripts/trim-loop-clips.js check
 *   D:/nodejs/node.exe scripts/trim-loop-clips.js trim [--apply]   （不加 --apply 只报告不写盘）
 */

'use strict';
const fs = require('fs');
const path = require('path');

const CLIPS_DIR = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'ChoreoExports', 'clips');
const MODE = process.argv[2] || 'check';
const APPLY = process.argv.includes('--apply');
// 时长 >= 这个秒数的视为"到 20s 上限被掐断"（播完静止收尾的一次性动作普遍 <8s）
// HYGIENE(AC-12)：旧版这里还解析过一个 --min → MIN_DUR，后续代码从未读过，已删（阈值固定 17s）
const LOOP_MIN_SEC = 17;

// ---------- 基础工具 ----------
function quatL1(a, b) { // 四元数分量差的绝对值和（幅度/距离的粗量）
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
}
function sampleAt(q, t) { // 通道关键帧按时间取样（最近帧，够用）
  if (!q || !q.length) return null;
  if (t <= q[0][0]) return q[0].slice(1);
  for (let i = 1; i < q.length; i++) {
    if (t <= q[i][0]) {
      const a = q[i - 1], b = q[i], f = (t - a[0]) / (b[0] - a[0] || 1e-6);
      // 符号规范化：q 与 -q 是同一旋转；录制数据偶发相邻帧反号（havok 输出特性），
      // 不先翻转 b 会插值穿过零四元数，污染周期得分（2026-08-28 修：dance 等真循环舞曾因此全部漏检）
      let b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4];
      if (a[1] * b1 + a[2] * b2 + a[3] * b3 + a[4] * b4 < 0) { b1 = -b1; b2 = -b2; b3 = -b3; b4 = -b4; }
      return [a[1] + (b1 - a[1]) * f, a[2] + (b2 - a[2]) * f, a[3] + (b3 - a[3]) * f, a[4] + (b4 - a[4]) * f];
    }
  }
  return q[q.length - 1].slice(1);
}
function clipAmplitude(j) { // 相对首帧的最大偏移（挑动得最多的骨）
  let best = { d: 0, bone: '' };
  for (const k in j.bones || {}) {
    const q = j.bones[k].q; if (!q || q.length < 2) continue;
    const a = q[0].slice(1);
    for (const fr of q) {
      const m = quatL1([fr[1], fr[2], fr[3], fr[4]], a);
      if (m > best.d) best = { d: m, bone: k };
    }
  }
  return best;
}

// ---------- check 模式 ----------
function check() {
  const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.json')).sort();
  const statics = [];
  let ok = 0;
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(CLIPS_DIR, f), 'utf8')); } catch { continue; }
    const best = clipAmplitude(j);
    // 阈值 0.3：实测好动作 ≥0.31（wave 0.31），静止坏数据 ≤0.09（beckon 失败版 0.086）
    if (best.d < 0.3) statics.push(f.replace('.json', '') + ' 幅度' + best.d.toFixed(3));
    else ok++;
  }
  console.log(`质量检查：${files.length} 条 | 正常 ${ok} | 可疑静止 ${statics.length}`);
  if (statics.length) console.log('需重录：\n  ' + statics.join('\n  '));
}

// ---------- trim 模式 ----------
function poseAt(j, times, t) { // 各骨骼在 t 时刻的四元数数组
  const pose = [];
  for (const k of times) pose.push(sampleAt(j.bones[k].q, t));
  return pose;
}
function poseDist(p1, p2) { // 两姿态平均每骨距离（比较前同样做符号规范化，同上）
  let s = 0, n = 0;
  for (let i = 0; i < p1.length; i++) {
    if (!p1[i] || !p2[i]) continue;
    let A = p1[i], B = p2[i];
    if (A[0] * B[0] + A[1] * B[1] + A[2] * B[2] + A[3] * B[3] < 0) B = [-B[0], -B[1], -B[2], -B[3]];
    s += quatL1(A, B); n++;
  }
  return n ? s / n : 1e9;
}
function trim() {
  const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.json')).sort();
  let loops = 0, onces = 0;
  for (const f of files) {
    const p = path.join(CLIPS_DIR, f);
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    // 只处理掐断的；已标 loop 的也重处理（2026-08-28 重剪：旧版带入舞过渡，接缝会跳）
    if (!(j.duration >= LOOP_MIN_SEC || j.type === 'loop')) continue;

    // 取动得最的前 30 根骨做周期信号（省计算，信号也足够）
    const bones = Object.keys(j.bones || {}).filter(k => {
      const q = j.bones[k].q; if (!q || q.length < 2) return false;
      const a = q[0].slice(1);
      for (const fr of q) if (quatL1([fr[1], fr[2], fr[3], fr[4]], a) > 0.1) return true;
      return false;
    }).slice(0, 30);
    if (bones.length < 3) { console.log(`${f}：几乎没动，跳过（交给 check 报告）`); continue; }

    // 周期检测：T 使 pose(t) ≈ pose(t+T) 对全程成立
    const dur = j.duration;
    let bestT = 0, bestScore = 1e9;
    for (let T = 0.8; T <= dur / 2; T += 1 / 30) {
      let s = 0, n = 0;
      for (let t = 1.0; t <= dur - T; t += 0.25) {
        s += poseDist(poseAt(j, bones, t), poseAt(j, bones, t + T)); n++;
      }
      const score = n ? s / n : 1e9;
      if (score < bestScore) { bestScore = score; bestT = T; }
    }

    if (bestScore < 0.02 && bestT > 0.5) {
      // 找循环体起点 t0：录制开头有 1~2 秒"站立→起舞"的入舞过渡，pose(t0)≈pose(t0+T)
      // 的最早时刻才是无缝循环的真正起点；从 t0 剪 N 个整周期并把时间戳归零（2026-08-28 修：
      // 旧版从 0 开剪，loop 回卷时舞蹈姿态→站姿跳变；二修：t0 只看周期吻合会选在过渡刚结束、
      // 动作速度最大的点，回卷缝隙=该点速度×帧间隔依然可见——改成周期吻合且局部速度最小的"顿点"）
      let t0 = 0, t0Best = 1e9, t0Found = false;
      const t0Max = Math.min(bestT, dur - bestT - 0.2);
      for (let t = 0.2; t <= t0Max; t += 1 / 30) {
        const d = poseDist(poseAt(j, bones, t), poseAt(j, bones, t + bestT));
        if (d >= 0.02) continue;                       // 周期先得吻合
        const v = poseDist(poseAt(j, bones, t - 0.1), poseAt(j, bones, t));  // 局部速度
        if (!t0Found || d + v < t0Best) { t0Best = d + v; t0 = t; t0Found = true; }
      }
      if (!t0Found) t0 = 0;   // 一个周期内找不到稳定起点：退回旧行为（从 0 剪）
      const N = Math.max(1, Math.floor((dur - t0 - 0.05) / bestT));
      const newDur = N * bestT;
      const cut = (q) => q
        .filter(fr => fr[0] >= t0 - 1e-3 && fr[0] <= t0 + newDur + 1e-3)
        .map(fr => [fr[0] - t0, fr[1], fr[2], fr[3], fr[4]]);
      const nb = {};
      for (const k in j.bones) {
        const ch = j.bones[k];
        nb[k] = { q: cut(ch.q || []), t: ch.t ? cut(ch.t) : undefined };
      }
      const out = { name: j.name, duration: newDur, type: 'loop', bones: nb };
      if (APPLY) { fs.writeFileSync(p, JSON.stringify(out)); }
      console.log(`${f}：循环 ✓ 周期 ${bestT.toFixed(2)}s × ${N} = ${newDur.toFixed(2)}s（原 ${dur.toFixed(1)}s，去入舞过渡 ${t0.toFixed(2)}s）${APPLY ? '已写盘' : '未写盘(--apply 生效)'}`);
      loops++;
    } else {
      // 周期不明显：一次性长动作，保持 once
      if (APPLY && j.type !== 'once') { j.type = 'once'; fs.writeFileSync(p, JSON.stringify(j)); }
      console.log(`${f}：无清晰周期（得分 ${bestScore.toFixed(4)}）→ 保持 once，长度 ${dur.toFixed(1)}s`);
      onces++;
    }
  }
  console.log(`\n剪裁汇总：循环 ${loops} 条 / 长一次性 ${onces} 条${APPLY ? '' : '（预览模式，未写盘）'}`);
}

if (MODE === 'check') check();
else if (MODE === 'trim') trim();
else console.log('用法：node trim-loop-clips.js check | trim [--apply]');
console.log('（目录：' + CLIPS_DIR + '）');
