#!/usr/bin/env node
/**
 * calibrate-motion.js —— AUD-016 静止阈值校准（一次性工具，跑完留档）
 *
 * 用真实 264 条录制数据回答：把录制收尾判据从「四元数压成 x²+y²+z² 标量差」
 * 换成「真实旋转角（弧度）」后，静止阈值定多少，能让
 *   ① 收尾余波（播完后头发/脊柱 0.01~0.03 起伏）被判静止 → once 类正常 settled；
 *   ② 真动作（哪怕慢动作）被判在动 → 不会提前掐断。
 *
 * 口径与录制端一致：帧 i 与 i+12（约 0.4~0.9s）比较，骨骼取下标 3..79，
 * 角度 = 2*acos(clamp(|dot(q1,q2)|))（q 与 -q 等价，先归一化）。
 * 统计每条 clip：
 *   tailMax  —— 最后一秒内所有窗口的最大角（收尾余波水平，应低于阈值）
 *   bodyMax  —— 中段所有窗口的最大角（真动作水平，应远高于阈值）
 * 输出两个分布的分位数，人工选阈值。
 *
 * 用法：D:\nodejs\node.exe scripts\calibrate-motion.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'clips')
  : 'C:/Users/xhz/AppData/Roaming/XIVLauncherCN/ChoreoExports/clips';

function quatAngle(a, b) {
  // a/b = [x,y,z,w]
  const la = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  const lb = Math.hypot(b[0], b[1], b[2], b[3]) || 1;
  let d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (la * lb);
  d = Math.min(1, Math.abs(d));
  return 2 * Math.acos(d);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const rows = [];
for (const f of files) {
  let clip;
  try { clip = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { console.error('解析失败', f, e.message); continue; }
  const names = Object.keys(clip.bones);
  if (!names.length) continue;
  const q = names.map(n => clip.bones[n].q || null);
  const dur = clip.duration;
  let tailMax = 0, bodyMax = 0;
  const GAP = 12;
  const n0 = q[0].length;
  for (let i = 0; i + GAP < n0; i += 2) {
    const t1 = q[0][i + GAP][0], t0 = q[0][i][0];
    if (t1 - t0 < 0.3 || t1 - t0 > 1.2) continue;
    let wMax = 0;
    for (let b = 3; b < Math.min(80, q.length); b++) {
      const ch = q[b]; if (!ch) continue;
      const a = ch[i], c = ch[i + GAP];
      if (!a || !c) continue;
      const ang = quatAngle(a, c);
      if (ang > wMax) wMax = ang;
    }
    if (t1 > dur - 1.0) { if (wMax > tailMax) tailMax = wMax; }
    else { if (wMax > bodyMax) bodyMax = wMax; }
  }
  rows.push({ f, type: clip.type, dur: +dur.toFixed(2), tailMax, bodyMax });
}

function quant(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
const tails = rows.map(r => r.tailMax).sort((a, b) => a - b);
const bodys = rows.map(r => r.bodyMax).sort((a, b) => a - b);
const fmt = v => v.toFixed(4);
console.log('条数', rows.length);
console.log('收尾余波 tailMax 分位数(rad)：');
for (const p of [0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 1]) console.log(`  p${p * 100}`, fmt(quant(tails, p)));
console.log('中段动作 bodyMax 分位数(rad)：');
for (const p of [0, 0.01, 0.02, 0.05, 0.5]) console.log(`  p${p * 100}`, fmt(quant(bodys, p)));
// 高危名单：tailMax 高的 once 条（如果收尾判据换角度，这些会超时）与 bodyMax 低的条（可能被误判静止）
console.log('\ntailMax 最高的 15 条（once=收尾后仍抖，timeout 型持续动作属正常）：');
rows.slice().sort((a, b) => b.tailMax - a.tailMax).slice(0, 15)
  .forEach(r => console.log(`  ${r.f.padEnd(30)} ${r.type.padEnd(5)} dur=${r.dur} tailMax=${fmt(r.tailMax)}`));
console.log('\nbodyMax 最低的 10 条（真动作最小水平，阈值必须低于它）：');
rows.slice().sort((a, b) => a.bodyMax - b.bodyMax).slice(0, 10)
  .forEach(r => console.log(`  ${r.f.padEnd(30)} ${r.type.padEnd(5)} dur=${r.dur} bodyMax=${fmt(r.bodyMax)}`));
// 对照：老标量指标在同一窗口的分布（验证可比性）
function oldMetric(a, b) {
  const va = a[1] * a[1] + a[2] * a[2] + a[3] * a[3];
  const vb = b[1] * b[1] + b[2] * b[2] + b[3] * b[3];
  return Math.abs(va - vb);
}
const oldTails = [];
for (const f of files.slice(0, 60)) {
  let clip; try { clip = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  const names = Object.keys(clip.bones); if (!names.length) continue;
  const q = names.map(n => clip.bones[n].q || null);
  const dur = clip.duration; let tailMax = 0;
  for (let i = 0; i + 12 < q[0].length; i += 2) {
    const t1 = q[0][i + 12][0], t0 = q[0][i][0];
    if (t1 - t0 < 0.3 || t1 - t0 > 1.2) continue;
    let wMax = 0;
    for (let b = 3; b < Math.min(80, q.length); b++) {
      const ch = q[b]; if (!ch) continue;
      const m = oldMetric(ch[i], ch[i + 12]); if (m > wMax) wMax = m;
    }
    if (t1 > dur - 1.0 && wMax > tailMax) tailMax = wMax;
  }
  oldTails.push(tailMax);
}
oldTails.sort((a, b) => a - b);
console.log('\n对照——老标量指标 tailMax（前 60 条）：p50/p90/p99 =',
  fmt(quant(oldTails, 0.5)), fmt(quant(oldTails, 0.9)), fmt(quant(oldTails, 0.99)));
