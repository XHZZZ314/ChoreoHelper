/* _probe-audit.js —— 临时探针（用后即删）：在 dist 主页上实测 clip-check 三败的真实 DOM/状态 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const url = 'file:///' + path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'clip-check.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async function main() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-audit-'));
  const proc = spawn(exe, ['--headless=new', '--no-first-run', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, url], { stdio: 'ignore', windowsHide: true });
  const kill = () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  try {
    for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {} }
    let wsUrl = null;
    for (let i = 0; i < 40; i++) { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page' && decodeURIComponent(x.url).replace(/\/$/, '') === decodeURIComponent(url));
      if (t) { wsUrl = t.webSocketDebuggerUrl; break; } await sleep(300); }
    if (!wsUrl) throw new Error('找不到页面 target');
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
    let idc = 0;
    const evaluate = async (expr) => {
      const r = await new Promise((ok, err) => {
        const id = ++idc;
        const timer = setTimeout(() => err(new Error('CDP 超时: ' + expr.slice(0, 60))), 30000);
        const onmsg = (ev) => { const m = JSON.parse(ev.data.toString());
          if (m.id === id) { clearTimeout(timer); ws.removeEventListener('message', onmsg); m.error ? err(new Error(m.error.message)) : ok(m.result); } };
        ws.addEventListener('message', onmsg);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
      });
      if (r.exceptionDetails) throw new Error('页面执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result ? r.result.value : undefined;
    };
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) { ready = await evaluate('!!(document.getElementById("f") && document.getElementById("f").contentWindow && document.getElementById("f").contentWindow.store && document.getElementById("f").contentWindow.store.appReady)').catch(() => false); if (!ready) await sleep(500); }
    console.log('appReady(iframe):', ready);
    // ① 窄条把手
    const h = await evaluate(`(function(){
      var w=window,s=w.store;
      s.dancers=[w.makeDancer(0)];s.dancerCount=1;s.selectedClip=null;s.globalLyrics=[];s.markers=[];
      var mk=function(name,start,dur){var c={id:s.nextClipId++,start:start,duration:dur,data:{name:name,command:'/'+name,category:'usual'}};s.dancers[0].actionClips.push(c);return c;};
      mk('甲',0,5);mk('乙',5,5);mk('短',20,0.5);
      s.pps=60;w.render();
      var cds=w.document.querySelectorAll('#lanes .action-lane .lane-body .clip');
      var out=[];
      cds.forEach(function(c){out.push({txt:c.textContent.slice(0,6),w:c.style.width,l:!!c.querySelector('.c-rz-l'),r:!!c.querySelector('.c-rz-r'),cls:c.className})});
      return {n:cds.length,out:out};
    })()`);
    console.log('①窄条把手:', JSON.stringify(h, null, 1));
    // ② 黄描边 + 库可用性
    const y = await evaluate(`(async function(){
      var w=window,s=w.store;
      var avail = w.ChoreoLibrary && ChoreoLibrary.available();
      var idx = null, idxType='n/a';
      try { idx = await ChoreoLibrary.clipIndex(); idxType = Object.prototype.toString.call(idx) + ' len=' + (idx && idx.length); } catch(e){ idxType = 'ERR ' + e.message; }
      var profs = []; try { profs = await ChoreoLibrary.listProfiles(); } catch(e){}
      s.dancers=[w.makeDancer(0)];s.dancerCount=1;s.globalLyrics=[];s.markers=[];s.selectedClip=null;
      s.dancers[0].actionClips.push({id:s.nextClipId++,start:0,duration:3,data:{name:'没录过',command:'/definitely_not_recorded_xyz',category:'usual'}});
      await w.__checkRun();
      var issues=(s.checkIssues||[]).map(function(it){return it.level+':'+it.rule});
      return {avail:avail, idxType:idxType, profN:profs.length,
        yellow:w.document.querySelectorAll('.clip.issue-yellow').length,
        checkLevel:JSON.stringify(s.checkLevel), issues:issues};
    })()`);
    console.log('②黄描边:', JSON.stringify(y, null, 1));
    // ③ 宏面板
    const m = await evaluate(`(function(){
      var w=window,s=w.store;
      s.dancers=[w.makeDancer(0),w.makeDancer(1)];s.dancerCount=2;s.selectedClip=null;s.activeMacroTab=0;
      w.render();
      var before={collapsed:s.macroCollapsed, tx:w.document.querySelectorAll('.macro-tx').length,
        openBtn:!!w.document.querySelector('.macro-pnl [data-action], .macro-pnl .macro-open, .macro-pnl button')};
      var pnl=w.document.querySelector('.macro-pnl');
      var btns=pnl?pnl.querySelectorAll('button'):[];
      var btnInfo=[];btns.forEach(function(b){btnInfo.push(b.textContent.trim())});
      s.macroCollapsed=false;w.render();
      var after={collapsed:s.macroCollapsed, tx:w.document.querySelectorAll('.macro-tx').length};
      return {before:before, btnInfo:btnInfo, after:after};
    })()`);
    console.log('③宏面板:', JSON.stringify(m, null, 1));
    // ④ 视口剔除边界
    const v = await evaluate(`(function(){
      var w=window,s=w.store;
      var tw=w.document.getElementById('timelineWrap');
      var p={vp:tw?tw.clientWidth:null,sl:tw?tw.scrollLeft:null,LABEL_W:w.LABEL_W,pps:s.pps};
      s.dancers=[w.makeDancer(0)];s.dancerCount=1;s.selectedClip=null;s.globalLyrics=[];s.markers=[];
      [['甲',0,5],['乙',5,5],['短',12,0.5],['远',20,0.5]].forEach(function(x){
        s.dancers[0].actionClips.push({id:s.nextClipId++,start:x[1],duration:x[2],data:{name:x[0],command:'/'+x[0],category:'usual'}})});
      s.pps=60;w.render();
      var vis=[];
      w.document.querySelectorAll('#lanes .action-lane .lane-body .clip').forEach(function(c){vis.push(c.textContent.slice(0,2))});
      var shortClips=s.dancers[0].actionClips.filter(function(c){return c.duration===0.5});
      var last=w.document.querySelectorAll('#lanes .action-lane .lane-body .clip');
      var narrow=last.length?last[last.length-1]:null;
      return {p:p, vis:vis, narrowTxt:narrow?narrow.textContent.slice(0,2):null,
        narrowL:narrow?!!narrow.querySelector('.c-rz-l'):null, narrowR:narrow?!!narrow.querySelector('.c-rz-r'):null,
        narrowW:narrow?narrow.style.width:null};
    })()`);
    console.log('④视口剔除:', JSON.stringify(v, null, 1));
    // ⑤ clip-check 页 iframe 内的时间轴视口（等 5s 让页面跑起来再量）
    await sleep(5000);
    const fw = await evaluate(`(function(){
      var f=document.getElementById('f');
      var w=f.contentWindow;
      var tw=w.document.getElementById('timelineWrap');
      var s=w.store;
      return {iframeW:f.clientWidth, tlW:tw?tw.clientWidth:null, tlScroll:tw?tw.scrollLeft:null, pps:s?s.pps:null};
    })()`);
    console.log('⑤iframe视口:', JSON.stringify(fw));
  } finally { kill(); }
})().catch((e) => { console.error('[probe] ' + e.message); process.exitCode = 1; });
