// 这个脚本分析 /export/clip 录出来的原始 JSON（污染排查用）：
// ① 每根骨相对首帧的最大幅度（四元数符号归一后逐分量求和）
// ② 幅度最大的骨头做周期检测：pose(t) 与 pose(t+P) 的距离（P 取 2.33s，拉拉菲尔舞循环周期）
// 用法：node analyze-pollution.js <clip.json 路径> [周期秒数]
const fs = require('fs');
const path = process.argv[2];
const period = parseFloat(process.argv[3] || '2.33');
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const bones = raw.bones || raw.Bones || {};
const qdist = (a, b) => {           // 符号归一后的四元数距离
  let dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  const s = dot < 0 ? -1 : 1;
  return Math.abs(a[0]-s*b[0])+Math.abs(a[1]-s*b[1])+Math.abs(a[2]-s*b[2])+Math.abs(a[3]-s*b[3]);
};
const results = [];
for (const [name, ch] of Object.entries(bones)) {
  const qs = ch.q || ch.Q;
  if (!qs || qs.length < 2) continue;
  const ref = qs[0].slice(1);
  let maxAmp = 0;
  for (const fr of qs) maxAmp = Math.max(maxAmp, qdist(fr.slice(1), ref));
  results.push({ name, amp: maxAmp, n: qs.length });
}
results.sort((a, b) => b.amp - a.amp);
console.log(`duration=${raw.duration} type=${raw.type} 骨数=${results.length}`);
console.log('幅度 Top12（相对首帧最大四元数差）:');
for (const r of results.slice(0, 12)) console.log(`  ${r.name.padEnd(9)} amp=${r.amp.toFixed(3)}  frames=${r.n}`);

// 周期检测：找 t 和 t+P 最近的帧对，算距离；再拿 t+P/2 错开对照
const top = results[0];
if (top) {
  const qs = (bones[top.name].q || bones[top.name].Q).map(f => [f[0], f[1], f[2], f[3], f[4]]);
  const at = t => { let best = null, bd = 1e9; for (const f of qs) { const d = Math.abs(f[0]-t); if (d < bd) { bd = d; best = f; } } return best.slice(1); };
  const dists = [], ctrl = [];
  for (let t = 0.5; t + period + 1 < qs[qs.length-1][0]; t += 0.5) {
    dists.push(qdist(at(t), at(t + period)));
    ctrl.push(qdist(at(t), at(t + period / 2)));
  }
  const avg = a => (a.reduce((s, v) => s + v, 0) / a.length);
  console.log(`\n周期检测（${top.name}，P=${period}s）：`);
  console.log(`  pose(t)↔pose(t+P)   平均距离 = ${avg(dists).toFixed(4)}  ← 接近 0 = 周期循环`);
  console.log(`  pose(t)↔pose(t+P/2) 平均距离 = ${avg(ctrl).toFixed(4)}  （错半周期对照）`);
}
