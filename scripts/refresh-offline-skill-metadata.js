// 用本机只读 Action 表导出补全离线技能基础值；严格对齐后写新快照，不覆盖输入或触碰游戏。
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
require('../web/choreo-skill-metadata.js');
const readMetadata=globalThis.ChoreoSkillMetadata.read;
function must(ok,message){if(!ok)throw Error(message)}
function namedIdentity(a){return a&&typeof a.name==='string'&&a.name.trim().length>0&&typeof a.jobName==='string'&&a.jobName.trim().length>0&&Number.isSafeInteger(a.jobId)&&a.jobId>=0;}
function mergeCatalog(catalog,exported,installedVersion){
  must(typeof installedVersion==='string'&&/^\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4}$/.test(installedVersion),'需要当前安装的完整游戏版本');
  must(exported&&exported.schemaVersion===1&&exported.source==='local-game-action-sheet'&&exported.language==='ChineseSimplified','只接受本机国服 Action 表导出');
  must(exported.gameVersion===installedVersion,'导出与当前安装的完整版本不一致');
  must(catalog&&catalog.gameVersion===installedVersion,'快照完整版本不匹配，不能按旧目录补值');
  must(Array.isArray(catalog.actions)&&catalog.actions.length>0&&Array.isArray(exported.actions)&&exported.actions.length===catalog.actions.length,'Action 条目数量不一致');
  must(typeof exported.generatedAt==='string'&&Number.isFinite(Date.parse(exported.generatedAt)),'导出时间无效');
  must(['luminaSha256','excelSha256'].every(k=>/^[a-f0-9]{64}$/.test(exported[k]||'')),'缺少读取程序集指纹');
  const byId=new Map();
  for(const row of exported.actions){
    must(namedIdentity(row)&&row.type==='action'&&Number.isSafeInteger(row.id)&&row.id>0&&!byId.has(row.id),'导出 Action 身份缺失或重复');
    must(readMetadata(row),'导出技能基础数据无效：'+row.id);byId.set(row.id,row);
  }
  const result=JSON.parse(JSON.stringify(catalog)),seen=new Set();
  for(const row of result.actions){
    must(namedIdentity(row)&&row.type==='action'&&Number.isSafeInteger(row.id)&&row.id>0&&!seen.has(row.id),'快照 Action 身份缺失或重复');seen.add(row.id);
    const actual=byId.get(row.id);
    must(actual&&['id','name','jobId','jobName'].every(k=>row[k]===actual[k]),'Action 编号、名称或职业不一致：'+row.id);
    const values=readMetadata(actual);
    if(row.staticMetadata!==undefined){
      const old=readMetadata(row);
      must(old&&JSON.stringify(old)===JSON.stringify(values),'已有技能基础值不同，拒绝覆盖：'+row.id);
    }else row.staticMetadata=values;
  }
  result.gameVersion=installedVersion;result.savedAt=exported.generatedAt.slice(0,10);
  return result;
}
function parseSnapshot(text){
  const m=text.match(/window\.__CHOREO_CATALOG__\s*=\s*([\s\S]*);\s*$/);
  must(m,'不支持的目录快照格式');return JSON.parse(m[1]);
}
function serialize(catalog){return '// 本机国服 Action 表基础值补全的离线目录（scripts/refresh-offline-skill-metadata.js 生成，勿手改）\nwindow.__CHOREO_CATALOG__ = '+JSON.stringify(catalog)+';\n'}
function main(args){
  must(args.length===4,'用法：node scripts/refresh-offline-skill-metadata.js <原catalog-snapshot.js> <Action导出JSON> <ffxivgame.ver> <新输出.js>');
  const [source,metadata,versionFile,out]=args.map(p=>path.resolve(p));
  must(!fs.existsSync(out),'输出已存在，请使用新文件保留旧证据');
  const input=fs.readFileSync(source),data=fs.readFileSync(metadata),version=fs.readFileSync(versionFile,'utf8').trim();
  const catalog=mergeCatalog(parseSnapshot(input.toString('utf8')),JSON.parse(data.toString('utf8')),version);
  must(fs.readFileSync(versionFile,'utf8').trim()===version,'合并期间游戏版本变化，未写入输出');
  const output=serialize(catalog);fs.writeFileSync(out,output,{flag:'wx'});
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  console.log(JSON.stringify({actions:catalog.actions.length,metadata:catalog.actions.filter(a=>readMetadata(a)).length,gameVersion:version,inputSha256:hash(input),metadataSha256:hash(data),outputSha256:hash(output),output:out}));
}
module.exports={mergeCatalog,parseSnapshot,serialize,main};
if(require.main===module){try{main(process.argv.slice(2))}catch(e){console.error(e.message);process.exitCode=1}}
