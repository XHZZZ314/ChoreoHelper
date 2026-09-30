'use strict';
/* poll-seek.js —— 定格→同动作 seek 到更晚时刻的复测（一次性诊断脚本） */
const fs = require('fs');
const path = require('path');
const TOKEN = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json'), 'utf8'));
  return j.code || j.pairingCode || '';
})();
const H = { 'Content-Type': 'application/json', 'X-Choreo-Token': TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, body) { const r = await fetch('http://localhost:48794' + p, { method: 'POST', headers: H, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, j }; }
async function st() { const r = await fetch('http://localhost:48794/debug/animstate'); return r.json(); }
(async () => {
  await post('/playback/freeze', { command: '/bow motion', time: 2.0 });
  for (let i = 1; i <= 6; i++) { await sleep(1200); const s = await st(); console.log('freeze2.0 t+' + i + ' localTime=' + s.localTime + ' pending=' + s.pendingCommand + ' preview=' + s.previewMode); }
  const r = await post('/playback/seek', { time: 3.0, revision: 42 });
  console.log('seek3.0 →', r.status, JSON.stringify(r.j));
  for (let i = 1; i <= 6; i++) { await sleep(1200); const s = await st(); console.log('seek3.0  t+' + i + ' localTime=' + s.localTime + ' pending=' + s.pendingCommand + ' preview=' + s.previewMode); }
  await post('/playback/freeze', {});
})();
