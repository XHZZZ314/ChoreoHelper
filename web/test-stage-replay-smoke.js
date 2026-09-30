// 演出复盘一次性浏览器冲烟：临时一次性资料（非固定验收资料），HTTP(S) 全阻断，不触碰真实工程/私人资产/游戏端点。
// 明确不是固定资料环境验收：固定 profile 当前在本任务文件系统视图不可见（见 CONTINUITY 阻断记录）。
// 注入的记录带 synthetic:true（自动化合成夹具，非真实演出）。
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const evidence=process.env.CHOREO_REPLAY_EVIDENCE;
assert.ok(evidence&&!fs.existsSync(evidence),'需要全新证据目录 CHOREO_REPLAY_EVIDENCE');fs.mkdirSync(evidence,{recursive:true});
const entry='D:/choreohelper/web/dist/ChoreoHelper/choreo-helper-app.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),json=(n,v)=>fs.writeFileSync(path.join(evidence,n+'.json'),JSON.stringify(v,null,2));
let chrome,ws,seq=0;const pending=new Map(),checks=[],errors=[],requests=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})};
