/**
 * batch-record.js — 全库动作批量录制的外部编排器（AI 用，node 脚本）
 *
 * 为什么不用插件内 /export/batch：那条路的打断指令和节奏写死在 DLL 里（换配置要重启游戏），
 * 这里在外面逐条驱动 48795 /export/clip，可以逐条质检、用实测有效的打断、随时调整策略。
 *
 * 规则：
 *  - 全部用 "xxx motion" 纯动作版触发（不吃目标、不刷聊天栏）
 *  - 姿态类动作（坐下/平坐/打盹/下跪/装死/摆造型）会改变后续基准姿势、打断指令停不掉，
 *    必须人配合站起来单独录——这里直接跳过，最后人工补
 *  - 已有同名文件的跳过（断点续录）
 *  - 每条录完立即质检（动作幅度 <0.3 = 静止坏数据），静止的重试一次，再不行记进失败清单
 *  - 时长 ≥19s = 持续/循环类，录完用 /beckon motion 打断（实测有效）+ 多等 4 秒
 *
 * 用法：D:/nodejs/node.exe scripts/batch-record.js [--dry] [--token=游戏里的配对码]
 *        (--dry 只列清单不录；v0.6.7 起插件写接口要配对码——游戏里 /choreo pair 查看，
 *         旧插件 ≤0.6.6 不用带 --token)
 */

'use strict';
const fs = require('fs');
const path = require('path');

const CLIPS = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'ChoreoExports', 'clips');
const EXPORT = 'http://localhost:48795/export/clip';
const PREVIEW = 'http://localhost:48794/preview';
// v0.6.7：写接口配对码（--token=XXXX 或环境变量 CHOREO_TOKEN）
const TOKEN = (process.argv.find(a => a.startsWith('--token=')) || '').slice(8) || process.env.CHOREO_TOKEN || '';
const H = TOKEN ? { 'Content-Type': 'application/json', 'X-Choreo-Token': TOKEN } : { 'Content-Type': 'application/json' };
// 姿态类：录完会让角色保持坐/躺/跪——录完调 /export/walkreset（插件注入 W+空格，角色自己跳+走）复位
// 2026-08-28 实测打盹污染了后续 15 条；坐下实际指令是 /lounge（不是 /sit）
const POSTURE = new Set(['sit', 'groundsit', 'doze', 'kneel', 'playdead', 'pose',
  'lounge', 'grovel', 'winded', 'situps', 'savortea']);
const WALKRESET = 'http://localhost:48795/export/walkreset';
const STOPPER = '/beckon motion';
const DRY = process.argv.includes('--dry');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function baseName(cmd) {           // "/beckon motion" → "beckon"（与插件 ClipName 规则一致）
  let n = cmd.trim().replace(/^\//, '').replace(/\//g, '_');
  for (const s of [' motion', ' loop', ' special']) if (n.endsWith(s)) { n = n.slice(0, -s.length); break; }
  return n.trim();
}
function amplitude(j) {            // 相对首帧的最大偏移
  // 帧结构 [t,x,y,z,w]：首帧去头得 [x0,y0,z0,w0]，与后续帧的 fr[1..4] 一一对应
  // （2026-08-28 修 bug：旧写法 a[1..4] 与 fr[1..4] 错位且 a[4] 越界 → NaN → 永远返回 0）
  let best = 0;
  for (const k in (j.bones || {})) {
    const q = j.bones[k].q; if (!q || q.length < 2) continue;
    const a = q[0].slice(1);
    for (const fr of q) {
      const m = Math.abs(fr[1] - a[0]) + Math.abs(fr[2] - a[1]) + Math.abs(fr[3] - a[2]) + Math.abs(fr[4] - a[3]);
      if (m > best) best = m;
    }
  }
  return best;
}

async function recordOne(cmd) {    // 返回 {ok, dur, amp, err, recId}
  const res = await fetch(EXPORT, {
    method: 'POST', headers: H,
    body: JSON.stringify({ command: cmd, save: true })
  });
  if (res.status === 403) return { ok: false, err: '需要配对码（游戏里 /choreo pair 查看，加 --token=参数）' };
  const j = await res.json();
  if (j.error) return { ok: false, err: j.error };
  // v0.7.1 FIX-C：新插件先暂存 pending，质检过才 commit 落盘；recId 为空 = 旧插件（已直接落盘）
  return { ok: true, dur: j.duration || 0, amp: amplitude(j), recId: j.recordingId || '', lowRate: !!j.lowSampleRate };
}
async function commitClip(recId, name) {  // v0.7.1 FIX-C：质检通过才让插件把暂存提交成正式文件
  if (!recId) return true;                // 旧插件没有两阶段，录制时已直接落盘
  try {
    const res = await fetch(EXPORT + '/commit', { method: 'POST', headers: H, body: JSON.stringify({ recordingId: recId, name }) });
    if (res.ok) return true;
    console.log('提交落盘失败（HTTP ' + res.status + '）：旧文件保留，动作只在这条记录里，稍后重录');
  } catch (e) { console.log('提交落盘网络失败：' + e.message + '（暂存 24 小时后自动清理）'); }
  return false;
}
async function cancelPending(recId) {     // v0.7.1 FIX-C：静止坏数据丢掉暂存，别覆盖旧的好文件
  if (!recId) return;
  try { await fetch(EXPORT + '/cancel', { method: 'POST', headers: H, body: JSON.stringify({ recordingId: recId }) }); } catch (e) {}
}
async function fireStopper() {     // 经 48794 预览通道发打断动作（清持续循环类）
  try {
    await fetch(PREVIEW, {
      method: 'POST', headers: H,
      body: JSON.stringify({ command: STOPPER })
    });
  } catch (e) { console.log('打断指令发送失败:', e.message); }
}
async function fireWalkReset() {   // 姿态复位：角色跳+走 1.2 秒（插件注入按键）
  try {
    await fetch(WALKRESET, { method: 'POST', headers: H, body: '{}' });
  } catch (e) { console.log('行走复位发送失败:', e.message); }
}

(async () => {
  const em = (await (await fetch('http://localhost:48794/actions/emotes')).json()).emotes || [];
  const all = em.map(e => e.command.trim()).filter(Boolean);
  // 表情分类只动脸不动身体，幅度质检会误报"静止"（2026-08-28 fume/huh 事件），豁免之
  const exprNames = new Set(em.filter(e => e.category === '表情').map(e => baseName(e.command)));
  const postureCmds = all.filter(c => POSTURE.has(baseName(c)));
  const todo = [];
  for (const c of all) {
    if (fs.existsSync(path.join(CLIPS, baseName(c) + '.json'))) continue;
    // 2026-08-28 主人定：表情类不录（编舞用不上，只有脸部动画身体骨架不动）
    if (exprNames.has(baseName(c))) continue;
    todo.push(c + ' motion');
  }
  console.log(`总动作 ${all.length} | 姿态类 ${postureCmds.length}（${postureCmds.map(c => baseName(c)).join(',')}，录完行走复位）| 表情类跳过不录 ${exprNames.size} 个 | 待录 ${todo.length}`);
  if (DRY) { console.log(todo.join('\n')); return; }

  const fails = [];
  for (let i = 0; i < todo.length; i++) {
    const cmd = todo[i], name = baseName(cmd);
    process.stdout.write(`[${i + 1}/${todo.length}] ${name} … `);
    let r = await recordOne(cmd);
    if (r.ok && r.amp < 0.3) {                     // 静止坏数据：重试一次（先丢掉这次暂存）
      console.log(`幅度 ${r.amp.toFixed(2)} 静止，重试`);
      await sleep(3500);
      await cancelPending(r.recId);
      r = await recordOne(cmd);
    }
    if (!r.ok) { console.log('失败：' + r.err); fails.push(name); await sleep(2500); continue; }
    const isExpr = exprNames.has(name);
    const verdict = r.amp < 0.3 ? (isExpr ? '◇表情类(身体静止正常)' : '✗仍静止') : '✓';
    const persistent = r.dur >= 19;
    const posture = POSTURE.has(name);
    if (posture) { console.log(`${r.dur.toFixed(1)}s 幅度${r.amp.toFixed(2)} ${verdict} [姿态类→行走复位]`); await fireWalkReset(); await sleep(4500); }
    else if (persistent) { console.log(`${r.dur.toFixed(1)}s 幅度${r.amp.toFixed(2)} ${verdict} [持续类→打断]`); await fireStopper(); await sleep(4000); }
    else { console.log(`${r.dur.toFixed(1)}s 幅度${r.amp.toFixed(2)} ${verdict}`); await sleep(2500); }
    if (r.amp < 0.3 && !isExpr) { await cancelPending(r.recId); fails.push(name); }
    else if (r.lowRate) console.log(`  ⚠ 采样率偏低（游戏卡顿或开机过久），动作可能不流畅，建议重启游戏后重录`);
    else await commitClip(r.recId, name);          // v0.7.1 FIX-C：质检过才提交插件落盘
  }
  console.log(`\n=== 完成：${todo.length - fails.length} 成功 / ${fails.length} 失败 ===`);
  if (fails.length) console.log('失败清单（下次跑会自动重试）：' + fails.join(', '));
})();
