// 离线正运动学：clip + skeleton 算头部（j_kao）世界高度曲线，重点看 loop 回卷两端 vs 站姿。
// 用途：判别"回卷点闪回站姿"是录制数据特性（循环点本来就近似站姿）还是引擎 bug。
// 用法：node fk-head-curve.js <clip.json> [clip2.json ...]   （skeleton 从 48795 取，存 %TEMP%\skel.json）
const fs = require('fs');
const skel = JSON.parse(fs.readFileSync(process.env.TEMP + '/skel.json', 'utf8')).bones;
const byIdx = {}; for (const b of skel) byIdx[b.i] = b;
const name2idx = {}; for (const b of skel) name2idx[b.n] = b.i;

const qmul = (a, b) => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qrot = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const t = [w*vx + y*vz - z*vy, w*vy + z*vx - x*vz, w*vz + x*vy - y*vx];
  return [t[0]*w + t[1]*(-z) - t[2]*(-y), t[1]*w + t[2]*(-x) - t[0]*(-z), t[2]*w + t[0]*(-y) - t[1]*(-x)];
};

function worldPos(clip, boneIdx, time) {
  let q = [0, 0, 0, 1], p = [0, 0, 0];
  const chain = [];
  for (let i = boneIdx; i >= 0; i = byIdx[i].p) chain.unshift(i);
  for (const i of chain) {
    const ref = byIdx[i];
    let lq = ref.q, lt = ref.t;
    const ch = clip ? clip.bones['bone_' + i] : null;
    if (ch) {
      lq = sample(ch.q, time) || lq;
      lt = ch.t ? (sample(ch.t, time, 4) || lt) : lt;
    }
    p = [p[0] + qrot(q, lt)[0], p[1] + qrot(q, lt)[1], p[2] + qrot(q, lt)[2]];
    q = qmul(q, lq);
  }
  return p;
}
function sample(frames, time, comps) {
  const n = comps || 5;
  if (time <= frames[0][0]) return frames[0].slice(1);
  const last = frames[frames.length - 1];
  if (time >= last[0]) return last.slice(1);
  for (let i = 1; i < frames.length; i++) {
    if (time <= frames[i][0]) {
      const a = frames[i - 1], b = frames[i], f = (time - a[0]) / (b[0] - a[0] || 1e-6), out = [];
      for (let k = 0; k < n - 1; k++) out.push(a[k + 1] + (b[k + 1] - a[k + 1]) * f);
      return out;
    }
  }
  return last.slice(1);
}

const headIdx = name2idx['j_kao'];
const standHead = worldPos(null, headIdx, 0)[1];   // 参考姿势（=站立）头高

for (const f of process.argv.slice(2)) {
  const clip = JSON.parse(fs.readFileSync(f, 'utf8'));
  const dur = clip.duration;
  let minH = 1e9, maxH = -1e9, minT = 0, maxT = 0;
  const pts = [];
  for (let t = 0; t < dur; t += dur / 200) {
    const h = worldPos(clip, headIdx, t)[1];
    pts.push(h);
    if (h < minH) { minH = h; minT = t; }
    if (h > maxH) { maxH = h; maxT = t; }
  }
  const h0 = worldPos(clip, headIdx, 0)[1];
  const hEnd = worldPos(clip, headIdx, dur - 0.001)[1];
  console.log(`== ${clip.name}  type=${clip.type}  dur=${dur.toFixed(2)}s  站姿头高=${standHead.toFixed(3)}m`);
  console.log(`   回卷两端: 头(0)=${h0.toFixed(3)}m  头(末)=${hEnd.toFixed(3)}m  两端差=${Math.abs(h0 - hEnd).toFixed(3)}m`);
  console.log(`   全片头高: 最低=${minH.toFixed(3)}m(@${minT.toFixed(2)}s)  最高=${maxH.toFixed(3)}m(@${maxT.toFixed(2)}s)`);
  console.log(`   循环点离站姿: |头(0)-站姿|=${Math.abs(h0 - standHead).toFixed(3)}m  (小于0.05m≈近似站姿)`);
  // 找出曲线上所有接近站姿的时段（占比高=这舞本来常回中位）
  let nearStand = 0;
  for (const h of pts) if (Math.abs(h - standHead) < 0.05) nearStand++;
  console.log(`   全片近似站姿占比: ${(nearStand / pts.length * 100).toFixed(0)}%（头高±5cm内）`);
}
