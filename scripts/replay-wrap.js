// 离线完整重放 preview3d 的真实调用序列，量化 loop 回卷点是否"闪回站姿"。
// 复刻链路：normalizeClip（参考骨架补齐）→ 引擎注册/时间轴 → 每帧 scrubTo(t,{blendLoopSeams}) + update。
// 输出：每帧 t / 头高 / 离站姿距离(101 骨四元数分量差合计) / 混合状态；另跑一组关闭混合作对照。
// 用法：node replay-wrap.js <clip.json> [起点秒] [时长秒]
//   skeleton 从 %TEMP%\skel.json 读（48795 /export/skeleton 现场取）
const fs = require('fs');
require('D:/choreohelper/web/choreo-engine.js');
const { PreviewEngine } = globalThis.ChoreoEngine;

const skeleton = JSON.parse(fs.readFileSync(process.env.TEMP + '/skel.json', 'utf8')).bones;
const name2idx = {}; skeleton.forEach(b => name2idx[b.n] = b.i);

// —— 复刻 preview3d.js 的 normalizeClip（逐行同构）——
function normalizeClip(j, fallbackName) {
  var bones = {};
  skeleton.forEach(function (b) {
    var key = 'bone_' + b.i;
    var ch = (j.bones && j.bones[key]) || null;
    if (ch && ch.q && ch.q.length) {
      bones[key] = { q: ch.q, t: (ch.t && ch.t.length) ? ch.t : [[0, b.t[0], b.t[1], b.t[2]]] };
    } else {
      bones[key] = { q: [[0, b.q[0], b.q[1], b.q[2], b.q[3]]], t: [[0, b.t[0], b.t[1], b.t[2]]] };
    }
  });
  return { name: fallbackName || j.name || 'clip', duration: j.duration || 1, type: j.type || 'once', bones: bones };
}

// —— FK：从当帧 applied 姿势算某骨世界高度 ——
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
function worldHeight(applied, boneIdx) {
  let q = [0, 0, 0, 1], y = 0;
  const chain = [];
  for (let i = boneIdx; i >= 0; i = skeleton[i].p) chain.unshift(i);   // skel 按序存，i 即下标
  for (const i of chain) {
    const ref = skeleton[i];
    const p = applied['bone_' + i] || { qx: ref.q[0], qy: ref.q[1], qz: ref.q[2], qw: ref.q[3], tx: ref.t[0], ty: ref.t[1], tz: ref.t[2] };
    y += qrot(q, [p.tx, p.ty, p.tz])[1];
    q = qmul(q, [p.qx, p.qy, p.qz, p.qw]);
  }
  return y;
}
function distToStand(applied) {
  let s = 0;
  for (const b of skeleton) {
    const p = applied['bone_' + b.i];
    if (!p) continue;
    s += Math.abs(p.qx - b.q[0]) + Math.abs(p.qy - b.q[1]) + Math.abs(p.qz - b.q[2]) + Math.abs(p.qw - b.q[3]);
  }
  return s;
}

const clipFile = process.argv[2];
const t0 = Number(process.argv[3] || 100);
const span = Number(process.argv[4] || 19);
const raw = JSON.parse(fs.readFileSync(clipFile, 'utf8'));
const clip = normalizeClip(raw, 'target');
const idleClip = normalizeClip({ bones: null, duration: 2, type: 'loop' }, '__idle__');
console.log('== ' + clipFile + '  type=' + clip.type + ' dur=' + clip.duration.toFixed(3) + 's，播放区间 [' + t0 + ', ' + (t0 + span) + ']，回卷点每 ' + clip.duration.toFixed(2) + 's 一个');

function runOnce(blendOn) {
  const engine = new PreviewEngine();
  engine.registerClip(clip);
  const applied = {};
  engine.addCharacter({ name: 'dancer0', bones: { x: 1 }, applyFn: (bn, pose) => { applied[bn] = pose; }, idleClip });
  // 注：bones 注册表故意给假名 —— 会禁掉 sample() 的逐骨骼混合门（this.bones[bn]）！
  // preview3d 传的是全骨名表，这里必须照抄：
  return { engine, applied };
}
// 修正：先建注册表再建角色（上面的 runOnce 留作教训注释不删——bones 门控会静默吞掉混合！）
const bonesReg = {};
skeleton.forEach(b => bonesReg['bone_' + b.i] = 1);

function simulate(blendOn) {
  const engine = new PreviewEngine();
  engine.registerClip(clip);
  const applied = {};
  engine.addCharacter({ name: 'dancer0', bones: bonesReg, applyFn: (bn, pose) => { applied[bn] = pose; }, idleClip });
  engine.setTimeline([{ char: 'dancer0', clipName: 'target', start: t0, opts: {} }]);
  let now = 0;
  const dtMs = 1000 / 60;
  const rows = [];
  let prevHead = null, maxJump = 0, maxJumpT = 0;
  for (let t = t0; t <= t0 + span; t += 1 / 60) {
    engine.scrubTo(t, { blendLoopSeams: blendOn });
    engine.update(now);
    now += dtMs;
    const head = worldHeight(applied, name2idx['j_kao']);
    if (prevHead != null && Math.abs(head - prevHead) > maxJump) { maxJump = Math.abs(head - prevHead); maxJumpT = t; }
    prevHead = head;
    rows.push({ t: (t - t0), head, ds: distToStand(applied), blend: engine.characters[0].blendFrom != null });
  }
  return { rows, maxJump, maxJumpT };
}

const dur = clip.duration;
function analyze(label, sim) {
  console.log('\n---- ' + label + ' ----');
  console.log('帧间头高最大跳变: ' + sim.maxJump.toFixed(4) + 'm @ t=' + sim.maxJumpT.toFixed(3) + '（区间内）');
  // 回卷点附近 ±0.35s 窗口 vs 区间中段
  for (let k = 1; dur * k < span - 0.5; k++) {
    const w = sim.rows.filter(r => Math.abs(r.t - dur * k) < 0.35);
    const mid = sim.rows.filter(r => Math.abs((r.t % dur) - dur / 2) < 0.2 && r.t > dur * 0.5 && r.t < dur * k);
    if (!w.length || !mid.length) continue;
    const wDs = w.map(r => r.ds), midDs = mid.map(r => r.ds);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    console.log('回卷#' + k + ' @t=' + (dur * k).toFixed(2) + 's: 窗内离站姿距离 avg=' + avg(wDs).toFixed(2) + ' min=' + Math.min(...wDs).toFixed(2) + ' blend帧=' + w.filter(r => r.blend).length + '  |  区间中段离站姿距离 avg=' + avg(midDs).toFixed(2));
  }
  // 头高曲线压缩输出（每 0.25s 一格）
  let line = '';
  for (const r of sim.rows) if (Math.round(r.t * 4) !== Math.round((r.t - 1 / 60) * 4)) line += r.t.toFixed(2) + ':' + r.head.toFixed(3) + (r.blend ? '*' : ' ') + ' ';
  console.log('头高曲线(*=混合中): ' + line);
}

const on = simulate(true);
const off = simulate(false);
analyze('播放中（blendLoopSeams=true，当前线上行为）', on);
analyze('关闭混合（旧行为对照）', off);
