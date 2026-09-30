#!/usr/bin/env node
/**
 * calibrate-motion2.js —— AUD-016 阈值校准第二轮（一次性工具）
 *
 * 通道格式 [t,x,y,z,w]：四元数是下标 1..4（第一轮把 0..3 当四元数是错的，作废）。
 * 只取「原始 settled 收尾」的 clip（once 且时长 ≥4s），统计**最后一个窗口**
 * （末 12 帧录制时已静止 0.5s+）的最大骨骼旋转角 = 真实余波水平；老标量指标对照。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'clips');

// [t,x,y,z,w] → 旋转角（rad），q 与 -q 等价
function quatAngle(a, b) {
  const la = Math.hypot(a[1], a[2], a[3], a[4]) || 1;
  const lb = Math.hypot(b[1], b[2], b[3], b[4]) || 1;
  let d = (a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4]) / (la * lb);
  return 2 * Math.acos(Math.min(1, Math.abs(d)));
}
// 老指标：|x²+y²+z² 差|（下标 1..3）
function oldMetric(a, b) {
  return Math.abs((a[1] ** 2 + a[2] ** 2 + a[3] ** 2) - (b[1] ** 2 + b[2] ** 2 + b[3] ** 2));
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const rows = [];
for (const f of files) {
  let clip; try { clip = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (clip.type !== 'once' || clip.duration < 4) continue;
  const names = Object.keys(clip.bones); if (!names.length) continue;
  const q = names.map(n => clip.bones[n].q || null);
  const n0 = q[0].length;
  const i = n0 - 13; // 末窗口：帧 i 与 i+12（最后一帧）
  if (i < 0) continue;
  const dt = q[0][i + 12][0] - q[0][i][0];
  if (dt < 0.3 || dt > 1.2) continue;
  let angMax = 0, oldMax = 0;
  for (let b = 3; b < Math.min(80, q.length); b++) {
    const ch = q[b]; if (!ch) continue;
    const ang = quatAngle(ch[i], ch[i + 12]);
    if (ang > angMax) angMax = ang;
    const om = oldMetric(ch[i], ch[i + 12]);
    if (om > oldMax) oldMax = om;
  }
  rows.push({ f, dur: +clip.duration.toFixed(2), angMax, oldMax });
}
function quant(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
const angs = rows.map(r => r.angMax).sort((a, b) => a - b);
const olds = rows.map(r => r.oldMax).sort((a, b) => a - b);
console.log('原始 settled 样本数', rows.length);
console.log('末窗口最大旋转角(rad)：p50/p75/p90/p95/p99/p100 =',
  [0.5, 0.75, 0.9, 0.95, 0.99, 1].map(p => quant(angs, p).toFixed(4)).join(' / '));
console.log('末窗口老标量指标：p50/p90/p99/p100 =',
  [0.5, 0.9, 0.99, 1].map(p => quant(olds, p).toFixed(4)).join(' / '));
console.log('\n角度指标最高的 12 条（余波最大的；决定阈值下限）：');
rows.sort((a, b) => b.angMax - a.angMax).slice(0, 12)
  .forEach(r => console.log(`  ${r.f.padEnd(30)} dur=${r.dur} ang=${r.angMax.toFixed(4)} old=${r.oldMax.toFixed(4)}`));

// 同一窗口口径下的「真动作水平」：全 clip 中段最大角的最小值（决定阈值上限）
const bodyMins = [];
for (const f of files) {
  let clip; try { clip = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (clip.type !== 'once' || clip.duration < 4) continue;
  const names = Object.keys(clip.bones); if (!names.length) continue;
  const q = names.map(n => clip.bones[n].q || null);
  let bodyMax = 0;
  for (let i = 0; i + 12 < q[0].length; i += 2) {
    const dt = q[0][i + 12][0] - q[0][i][0];
    if (dt < 0.3 || dt > 1.2) continue;
    if (q[0][i + 12][0] > clip.duration - 1.0) continue; // 排除收尾段
    for (let b = 3; b < Math.min(80, q.length); b++) {
      const ch = q[b]; if (!ch) continue;
      const ang = quatAngle(ch[i], ch[i + 12]);
      if (ang > bodyMax) bodyMax = ang;
    }
  }
  bodyMins.push({ f, bodyMax });
}
bodyMins.sort((a, b) => a.bodyMax - b.bodyMax);
console.log('\n中段真动作最大角最低的 8 条（阈值必须低于它）：');
bodyMins.slice(0, 8).forEach(r => console.log(`  ${r.f.padEnd(30)} bodyMax=${r.bodyMax.toFixed(4)}`));
