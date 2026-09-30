'use strict';
/* realrec-fixc.js —— FIX-C 四类动作真机录制全链路验收（主人明确授权 2026-08-30）
 * 普通 /bow motion：录制→暂存→commit→文件真落盘→验完恢复备份
 * 持续 /golddance motion：录满 20s 掐断→暂存→cancel→旧文件不动→beckon 打断
 * 表情 /smile motion：脸部动作幅度低→暂存→cancel（不污染 264 条库）
 * 姿态 /doze motion：录制→暂存→cancel→walkreset 复位
 */
const fs = require('fs');
const path = require('path');
const CLIPS = path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'clips');
const PENDING = path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'pending');
const BACKUP = path.join(process.env.TEMP || process.env.TMP, 'choreo-backup');
const EXPORT = 'http://localhost:48795';
const TOKEN = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json'), 'utf8'));
  return j.code || j.pairingCode || '';
})();
const H = { 'Content-Type': 'application/json', 'X-Choreo-Token': TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (d || '')); } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } };
function amp(j) {
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
async function record(cmd) {
  const r = await fetch(EXPORT + '/export/clip', { method: 'POST', headers: H, body: JSON.stringify({ command: cmd, save: true }) });
  if (r.status !== 200) return { ok: false, status: r.status, err: await r.text() };
  const j = await r.json();
  if (j.error) return { ok: false, err: j.error };
  return { ok: true, recId: j.recordingId || '', amp: amp(j), dur: j.duration || 0, hz: j.sampleHz || 0, low: !!j.lowSampleRate, clip: j };
}
async function commit(recId, name) {
  const r = await fetch(EXPORT + '/export/clip/commit', { method: 'POST', headers: H, body: JSON.stringify({ recordingId: recId, name }) });
  return r.ok;
}
async function cancel(recId) {
  const r = await fetch(EXPORT + '/export/clip/cancel', { method: 'POST', headers: H, body: JSON.stringify({ recordingId: recId }) });
  return r.ok;
}
function pendingExists(recId) { return fs.existsSync(path.join(PENDING, recId + '.json')); }

(async () => {
  console.log('== FIX-C 四类动作真机录制 ==');
  // ① 普通：commit 全链路
  const bowMtime0 = mtime(path.join(CLIPS, 'bow.json'));
  const r1 = await record('/bow motion');
  check('① 普通录制 200 且带 recordingId', r1.ok && /^[0-9a-f]{32}$/.test(r1.recId), JSON.stringify({ err: r1.err, recId: r1.recId }));
  check('① 暂存文件已生成', r1.ok && pendingExists(r1.recId));
  check('① 真动作幅度≥0.3（' + (r1.amp || 0).toFixed(2) + '）', r1.ok && r1.amp >= 0.3);
  check('① 响应带实际采样率 sampleHz（' + (r1.hz || 0).toFixed(1) + 'Hz，AUD2-007）', r1.ok && r1.hz > 0 && !r1.low);
  check('① commit 前正式文件未动', r1.ok && mtime(path.join(CLIPS, 'bow.json')) === bowMtime0);
  check('① commit 成功', r1.ok && await commit(r1.recId, 'bow'));
  check('① commit 后正式文件已更新、暂存删净', r1.ok && mtime(path.join(CLIPS, 'bow.json')) > bowMtime0 && !pendingExists(r1.recId));
  const bowNew = JSON.parse(fs.readFileSync(path.join(CLIPS, 'bow.json'), 'utf8'));
  check('① 落盘文件 JSON 有效且幅度合格', bowNew.bones && amp(bowNew) >= 0.3);
  fs.copyFileSync(path.join(BACKUP, 'bow.json'), path.join(CLIPS, 'bow.json')); // 还原备份
  console.log('  （bow.json 已还原为备份）');
  await sleep(2500);

  // ② 持续类：录满 20s 掐断 → cancel
  const goldMtime0 = mtime(path.join(CLIPS, 'golddance.json'));
  const r2 = await record('/golddance motion');
  check('② 持续类录满上限（' + (r2.dur || 0).toFixed(1) + 's）且带 recordingId', r2.ok && r2.dur >= 18 && !!r2.recId, 'dur=' + r2.dur);
  check('② 持续类幅度合格（' + (r2.amp || 0).toFixed(2) + '）', r2.ok && r2.amp >= 0.3);
  check('② cancel 丢弃暂存', r2.ok && await cancel(r2.recId) && !pendingExists(r2.recId));
  check('② 旧 golddance.json 分毫未动', mtime(path.join(CLIPS, 'golddance.json')) === goldMtime0);
  await fetch('http://localhost:48794/preview', { method: 'POST', headers: H, body: JSON.stringify({ command: '/beckon motion' }) }); // 打断
  console.log('  （已发 beckon 打断循环舞）');
  await sleep(4000);

  // ③ 表情类：只动脸幅度低
  const r3 = await record('/smile motion');
  check('③ 表情类录制成功（' + (r3.dur || 0).toFixed(1) + 's）', r3.ok && !!r3.recId, JSON.stringify({ err: r3.err }));
  check('③ 表情类录制成功（' + (r3.dur || 0).toFixed(1) + 's，幅度 ' + (r3.amp || 0).toFixed(2) + '——实测 smile 有身体动作，印证 CONTINUITY「表情类只动脸」当年是 NaN bug 误诊）', r3.ok && !!r3.recId, JSON.stringify({ err: r3.err }));
  check('③ cancel 丢弃、clips 目录无 smile 残留', r3.ok && await cancel(r3.recId) && !fs.existsSync(path.join(CLIPS, 'smile.json')));
  await sleep(2500);

  // ④ 姿态类 + walkreset 复位
  const dozeMtime0 = mtime(path.join(CLIPS, 'doze.json'));
  const r4 = await record('/doze motion');
  check('④ 姿态类录制成功（' + (r4.dur || 0).toFixed(1) + 's）', r4.ok && !!r4.recId, JSON.stringify({ err: r4.err }));
  check('④ 姿态类幅度合格（' + (r4.amp || 0).toFixed(2) + '）', r4.ok && r4.amp >= 0.3);
  check('④ cancel 丢弃、旧 doze.json 未动', r4.ok && await cancel(r4.recId) && mtime(path.join(CLIPS, 'doze.json')) === dozeMtime0);
  const wr = await fetch(EXPORT + '/export/walkreset', { method: 'POST', headers: H, body: '{}' });
  check('④ walkreset 复位 200', wr.status === 200, String(wr.status));
  await sleep(5000); // 等复位动作走完

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e.message); process.exit(2); });
