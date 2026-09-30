'use strict';
/* realtest-fixb.js —— FIX-B 真游戏五条实机验收 v2（主人明确授权 2026-08-30）
 * ① 切游戏模式不播放直接拖 = /playback/freeze 定格 → animstate LocalTime 精确（轮询等待）
 * ② 改后拖 = 推新 revision 快照后再 seek，旧 revision 必须 409
 * ③ 歌词语义（v0.5 口径）：拖动/seek 永不刷聊天栏；播放时歌词经 /y 上聊天栏是本来的语义；
 *    导入歌词（空命令歌词条）不再被策略 400 卡死（FIX-B 实机回归修正）；纯文本命令仍 400
 * ④ 空隙退定格 = seek 到空白区 → 预览停止
 * ⑤ 播放回归 = /playback/start 全链路 + 日志确认 Executed
 */
const fs = require('fs');
const path = require('path');
const LOG = path.join(process.env.APPDATA, 'XIVLauncherCN', 'dalamud.log');
const TOKEN = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json'), 'utf8'));
  return j.code || j.pairingCode || '';
})();
const API = 'http://localhost:48794';
const H = { 'Content-Type': 'application/json', 'X-Choreo-Token': TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (d || '')); } };
const logLines = () => fs.readFileSync(LOG, 'utf8').split('\n');
async function post(p, body) {
  const r = await fetch(API + p, { method: 'POST', headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}
async function get(p) { const r = await fetch(API + p); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, j }; }
async function animstate() { return (await get('/debug/animstate')).j; }
async function waitLocalTime(target, timeoutMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (timeoutMs || 5000)) {
    last = await animstate();
    const lt = last && (last.localTime ?? last.LocalTime);
    if (typeof lt === 'number' && Math.abs(lt - target) < 0.15 && (last.pendingCommand ?? last.PendingCommand ?? '') === '') return last;
    await sleep(300);
  }
  return last;
}

const bowClip = { id: 1, actorId: 0, start: 0, duration: 8, command: '/bow motion', type: 'action', name: 'bow' };
const yLyric = { id: 2, actorId: -1, start: 3, duration: 3, command: '/y 歌词上栏测试', type: 'lyric', name: '喊话歌词' };
const emptyLyric = { id: 3, actorId: -1, start: 5, duration: 3, command: '', type: 'lyric', name: '导入歌词行' };

(async () => {
  const base = logLines().length;
  console.log('== FIX-B 真游戏五条 v2 ==');

  // 推初始时间轴 revision=42（bow 0~8s）
  let r = await post('/playback/timeline', { clips: [bowClip], revision: 42 });
  check('推时间轴快照 revision=42 → 200', r.status === 200, JSON.stringify(r.j));

  // ① 不播放直接拖：定格在 bow 2.0s（轮询等快进到位）
  r = await post('/playback/freeze', { command: '/bow motion', time: 2.0 });
  check('① freeze 2.0s → 200', r.status === 200, JSON.stringify(r.j));
  let st = await waitLocalTime(2.0);
  check('① LocalTime 精确≈2.0（实际 ' + (st && st.localTime) + '）', st && Math.abs(st.localTime - 2.0) < 0.15, JSON.stringify(st).slice(0, 160));

  // ② 旧/错 revision seek 必须 409；正确 revision seek 3.0
  r = await post('/playback/seek', { time: 3.0, revision: 99 });
  check('② 旧/错 revision seek → 409', r.status === 409, String(r.status));
  r = await post('/playback/seek', { time: 3.0, revision: 42 });
  check('① 正确 revision seek → 200', r.status === 200, JSON.stringify(r.j));
  st = await waitLocalTime(3.0);
  check('① seek 后 LocalTime≈3.0（实际 ' + (st && st.localTime) + '）', st && Math.abs(st.localTime - 3.0) < 0.15, JSON.stringify(st).slice(0, 160));

  // ② 改后拖：推 revision=43（换成 wave 0~6s），旧 42 必须 409
  const waveClip = { id: 4, actorId: 0, start: 0, duration: 6, command: '/wave motion', type: 'action', name: 'wave' };
  r = await post('/playback/timeline', { clips: [waveClip], revision: 43 });
  check('② 推新快照 revision=43 → 200', r.status === 200, JSON.stringify(r.j));
  r = await post('/playback/seek', { time: 2.0, revision: 42 });
  check('② 旧 revision=42 seek → 409', r.status === 409, String(r.status));
  r = await post('/playback/seek', { time: 2.0, revision: 43 });
  check('② 新 revision=43 seek → 200', r.status === 200, JSON.stringify(r.j));
  st = await waitLocalTime(2.0);
  check('② LocalTime≈2.0 且定格 wave（pendingCommand=' + (st && st.pendingCommand) + '）',
    st && Math.abs(st.localTime - 2.0) < 0.15 && /wave/.test(st.pendingCommand || st.command || ''), JSON.stringify(st).slice(0, 160));

  // ③ 拖动/seek 不刷聊天栏：推含歌词条（/y）的时间轴，来回 seek 跨歌词覆盖点
  r = await post('/playback/timeline', { clips: [bowClip, yLyric], revision: 50 });
  check('③ 含 /y 歌词条快照推送 → 200', r.status === 200, JSON.stringify(r.j));
  const seekBase = logLines().length;
  for (const t of [1.0, 5.0, 2.0, 6.0, 0.5]) { // 5 次来回，多次跨过歌词起点 3s
    await post('/playback/seek', { time: t, revision: 50 });
    await sleep(400);
  }
  let delta = logLines().slice(seekBase).filter((l) => /Executed at/.test(l));
  check('③ 来回拖 5 次（多次跨歌词点）聊天栏零歌词（日志无 /y 执行）',
    delta.every((l) => !/\/y /.test(l)), delta.join(' | ').slice(0, 200));
  r = await post('/playback/freeze', {}); // 解冻，清定格
  check('③ 解冻恢复 → 200', r.status === 200, String(r.status));
  await sleep(500);

  // ③ 导入歌词（空命令歌词条）不再 400：这是真机测试抓到的 FIX-B 回归，已修
  r = await post('/playback/timeline', { clips: [bowClip, emptyLyric], revision: 51 });
  check('③ 导入歌词（空命令歌词条）时间轴推送 → 200（回归修正）', r.status === 200, JSON.stringify(r.j));
  r = await post('/playback/start', { clips: [bowClip, emptyLyric], fromTime: 0, speed: 1, revision: 51 });
  check('③ 含导入歌词的项目可以游戏播放（不再「命令为空」400）', r.status === 200, JSON.stringify(r.j));
  await sleep(1500);
  await post('/playback/stop'); await sleep(600);

  // ③ 纯文本歌词条命令（无斜杠）仍被策略闸 400
  const badLyric = { id: 5, actorId: -1, start: 1, duration: 3, command: '你好这是一句歌词', type: 'lyric', name: '坏歌词条' };
  r = await post('/playback/start', { clips: [bowClip, badLyric], fromTime: 0, speed: 1, revision: 52 });
  check('③ 纯文本歌词条命令 → 400（策略闸保住）', r.status === 400, JSON.stringify(r.j));

  // ③ 播放时歌词经 /y 上聊天栏 = v0.5 本来语义（日志确认 /y 真执行过一次）
  r = await post('/playback/timeline', { clips: [bowClip, yLyric], revision: 53 });
  r = await post('/playback/start', { clips: [bowClip, yLyric], fromTime: 0, speed: 1, revision: 53 });
  check('③ 含 /y 歌词条播放 → 200', r.status === 200, JSON.stringify(r.j));
  await sleep(5000); // 歌词在 3s 处
  await post('/playback/stop'); await sleep(600);
  let playDelta = logLines().slice(base).filter((l) => /Executed at/.test(l) && /\/y /.test(l));
  check('③ 播放（非拖动）时歌词经 /y 正常上聊天栏（语义对齐 v0.5）', playDelta.length >= 1, playDelta.join(' | ').slice(0, 200));

  // ④ 空隙退定格：wave 0~6s，seek 到 20（空白区）→ 定格停
  r = await post('/playback/timeline', { clips: [waveClip], revision: 54 });
  r = await post('/playback/freeze', { command: '/wave motion', time: 2.0 });
  await waitLocalTime(2.0);
  r = await post('/playback/seek', { time: 20.0, revision: 54 });
  check('④ 空白区 seek → 200', r.status === 200, JSON.stringify(r.j));
  await sleep(800);
  st = await animstate();
  check('④ 空隙后预览定格已退（previewMode=' + (st && st.previewMode) + '）',
    st && (st.previewMode === false || st.previewMode == null), JSON.stringify(st).slice(0, 160));

  // ⑤ 播放回归
  r = await post('/playback/start', { clips: [bowClip], fromTime: 0, speed: 1, revision: 55 });
  check('⑤ /playback/start → 200', r.status === 200, JSON.stringify(r.j));
  await sleep(1200);
  r = await get('/playback/status');
  const playing = r.j && (r.j.playing === true || r.j.isPlaying === true);
  check('⑤ GET /playback/status 确认播放中', playing, JSON.stringify(r.j));
  await sleep(8000);
  r = await post('/playback/stop');
  check('⑤ /playback/stop → 200', r.status === 200, String(r.status));
  const tail = logLines().slice(base);
  check('⑤ 日志确认 Executed /bow motion（真播到角色）', tail.some((l) => /Executed at 0s: \/bow motion/.test(l)));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e.message); process.exit(2); });
