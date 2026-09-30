// 离线正运动学：clip + skeleton 算指定骨头的世界坐标高度曲线（不依赖浏览器）。
// 用途：判别一条 wave 录制里右手有没有真的举起来（真招手：手高明显上升后回落）。
// 用法：node fk-hand-height.js <clip1.json> [clip2.json ...]   （skeleton 从 48795 现场取，存 %TEMP%\skel.json）
const fs = require('fs');
const skel = JSON.parse(fs.readFileSync(process.env.TEMP + '/skel.json', 'utf8')).bones;
const byIdx = {}; for (const b of skel) byIdx[b.i] = b;
const name2idx = {}; for (const b of skel) name2idx[b.n] = b.i;

const qmul = (a, b) => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qrot = (q, v) => { // v' = q v q*
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const t = [w*vx + y*vz - z*vy, w*vy + z*vx - x*vz, w*vz + x*vy - y*vx];
  return [t[0]*w + t[1]*(-z) - t[2]*(-y), t[1]*w + t[2]*(-x) - t[0]*(-z), t[2]*w + t[0]*(-y) - t[1]*(-x)];
};

// 某时刻某骨的世界变换（clip 的 q/t 通道按时间插值取值，缺通道用参考姿势）
function worldPos(clip, boneIdx, time) {
  let q = [0, 0, 0, 1], p = [0, 0, 0];
  const chain = [];
  for (let i = boneIdx; i >= 0; i = byIdx[i].p) chain.unshift(i);
  for (const i of chain) {
    const ref = byIdx[i];
    let lq = ref.q, lt = ref.t;
    const ch = clip.bones['bone_' + i];
    if (ch) {
      lq = sample(ch.q, time) || lq;
      lt = ch.t ? (sample(ch.t, time, 4) || lt) : lt;
    }
    p = [p[0] + qrot(q, lt)[0], p[1] + qrot(q, lt)[1], p[2] + qrot(q, lt)[2]];
    q = qmul(q, lq);
  }
  return p;
}
function sample(frames, time, comps) { // 线性插值取某时刻通道值
  const n = comps || 5;
  if (time <= frames[0][0]) return frames[0].slice(1);
  for (let i = 1; i < frames.length; i++) {
    if (frames[i][0] >= time) {
      const a = frames[i-1], b = frames[i], f = (time - a[0]) / (b[0] - a[0] || 1);
      return a.slice(1).map((v, k) => v + (b[k+1] - v) * f);
    }
  }
  return frames[frames.length-1].slice(1);
}

const handIdx = name2idx['j_te_r'], headIdx = name2idx['j_kubi'] ?? name2idx['j_head'];
for (const path of process.argv.slice(2)) {
  const clip = JSON.parse(fs.readFileSync(path, 'utf8'));
  const dur = clip.duration;
  const m = path.match(/[^\\/]+$/)[0];
  let hMin = 1e9, hMax = -1e9, headMin = 1e9, headMax = -1e9;
  const steps = Math.min(Math.floor(dur / 0.25), 40);
  const curve = [];
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(dur * s / steps, dur - 0.01);
    const hp = worldPos(clip, handIdx, t);
    const ep = worldPos(clip, headIdx, t);
    hMin = Math.min(hMin, hp[1]); hMax = Math.max(hMax, hp[1]);
    headMin = Math.min(headMin, ep[1]); headMax = Math.max(headMax, ep[1]);
    if (s % 2 === 0) curve.push(`${t.toFixed(1)}s:${hp[1].toFixed(2)}`);
  }
  console.log(`\n=== ${m}  dur=${dur}s`);
  console.log(`  右手高度 ${hMin.toFixed(2)} → ${hMax.toFixed(2)}（Δ=${(hMax-hMin).toFixed(2)}，真招手应 ≥0.3）`);
  console.log(`  头部高度 ${headMin.toFixed(2)} → ${headMax.toFixed(2)}（Δ=${(headMax-headMin).toFixed(2)}）`);
  console.log(`  右手曲线: ${curve.join(' ')}`);
}
