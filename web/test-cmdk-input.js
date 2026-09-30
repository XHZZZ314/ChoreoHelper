// 命令面板快捷键回归：文本输入时仅 Ctrl+K 能打开面板，其余编辑键留给输入框。
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let handler, opened=0, copied=0, played=0;
const doc={addEventListener(type,cb){if(type==='keydown')handler=cb}};
const workbench={initStage(){}};
const ctx={document:doc,window:{ChoreoWorkbench:workbench},ChoreoWorkbench:workbench,store:{selectedClip:null},init(){},openCmdkPalette(){opened++},copySelection(){copied++},togglePlay(){played++}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'choreo-bootstrap.js'),'utf8'),ctx,{filename:'choreo-bootstrap.js'});
function event(target,key,code,ctrlKey=false){let prevented=false;handler({target,key,code,ctrlKey,metaKey:false,altKey:false,shiftKey:false,preventDefault(){prevented=true}});return prevented}
const input={tagName:'INPUT',isContentEditable:false},body={tagName:'BODY',isContentEditable:false};
assert.equal(event(input,'k','KeyK',true),true,'Ctrl+K in input should prevent browser shortcut');
assert.equal(opened,1,'Ctrl+K in input should open command panel');
assert.equal(event(input,'c','KeyC',true),false,'Ctrl+C in input stays native');
assert.equal(copied,0,'Ctrl+C in input must not copy timeline selection');
assert.equal(event(input,'k','KeyK',false),false,'plain K in input stays native');
assert.equal(played,0,'plain K in input must not play');
assert.equal(event(body,'k','KeyK',true),true,'Ctrl+K on page should still open command panel');
assert.equal(opened,2);
console.log('8/8 cmdk focus checks passed');
