// 这个脚本量化 loop 类 clip 的"接缝可见性"：用离线正运动学算回卷点两端
// （最后一帧 pose(T) vs 第一帧 pose(0)）全部骨骼的世界坐标差，取最大关节位移（厘米）。
// 判断标尺：<1cm 基本不可见；1~3cm 细看能察觉；>3cm 明显跳变。
// 用法：node seam-visibility.js（读 %TEMP%\skel.json 和 clips 目录，skeleton 需先从 48795 取）
const fs = require('fs');
const skel = JSON.parse(fs.readFileSync(process.env.TEMP + '/skel.json', 'utf8')).bones;
const byIdx = {}; for (const b of skel) byIdx[b.i] = b;
const dir = process.env.APPDATA + '/XIVLauncherCN/ChoreoExports/clips/';
const loops = fs.readFileSync(process.env.TEMP + '/loops.txt', 'utf8').trim().split(/\s+/);

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
function worldAll(clip, time) {
  const out = {};
  for (const target of skel.map(b => b.i)) {
    let q = [0, 0, 0, 1], p = [0, 0, 0];
    const chain = [];
    for (let i = target; i >= 0; i = byIdx[i].p) chain.unshift(i);
    for (const i of chain) {
      const ref = byIdx[i];
      let lq = ref.q, lt = ref.t;
      const ch = clip.bones['bone_' + i];
      if (ch) { lq = sample(ch.q, time) || lq; lt = ch.t ? (sample(ch.t, time, 4) || lt) : lt; }
      const r = qrot(q, lt);
      p = [p[0]+r[0], p[1]+r[1], p[2]+r[2]];
      q = qmul(q, lq);
    }
    out[target] = p;
  }
  return out;
}
function sample(frames, time, comps) {
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

console.log('clip            时长    接缝最大关节位移（cm）   最痛的骨');
const rows = [];
for (const name of loops) {
  const clip = JSON.parse(fs.readFileSync(dir + name + '.json', 'utf8'));
  const T = clip.duration;
  const a = worldAll(clip, 0), b = worldAll(clip, T - 0.001);
  let worst = 0, wi = -1;
  for (const i of Object.keys(a)) {
    const d = Math.hypot(a[i][0]-b[i][0], a[i][1]-b[i][1], a[i][2]-b[i][2]);
    if (d > worst) { worst = d; wi = i; }
  }
  rows.push({ name, T, worst: worst*100, bone: byIdx[wi] ? byIdx[wi].n : '?'+wi });
}
rows.sort((x, y) => y.worst - x.worst);
for (const r of rows)
  console.log(r.name.padEnd(15) + r.T.toFixed(2).padStart(5) + 's   ' + r.worst.toFixed(2).padStart(6) + ' cm            ' + r.bone);
