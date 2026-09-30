// 技能基础表值：只解释明确 Action 的静态元数据，不当作实时冷却、读条或动作长度。
(function(root){
  'use strict';
  function read(skill){
    if(!skill||skill.type!=='action'||!Number.isSafeInteger(skill.id)||skill.id<=0)return null;
    var m=skill.staticMetadata;
    if(!m||m.version!==1||m.actionId!==skill.id)return null;
    if(!['castMs','recastMs','requiredLevel','maxCharges'].every(k=>Number.isSafeInteger(m[k])&&m[k]>=0))return null;
    if(m.castMs>86400000||m.recastMs>86400000||!['range','effectRange'].every(k=>Number.isFinite(m[k])))return null;
    return {version:1,actionId:skill.id,castMs:m.castMs,recastMs:m.recastMs,requiredLevel:m.requiredLevel,maxCharges:m.maxCharges,range:m.range,effectRange:m.effectRange};
  }
  function describe(skill){var m=read(skill);return m?'目录基础值：咏唱 '+m.castMs/1000+' 秒 · 复唱 '+m.recastMs/1000+' 秒 · 等级 '+m.requiredLevel+(m.maxCharges?' · 基础充能上限 '+m.maxCharges:'')+'。不代表当前冷却、实际读条或动画长度。':'目录未提供完整基础数据；不会用提示时长推算实际冷却。'}
  root.ChoreoSkillMetadata={read,describe};
})(typeof window!=='undefined'?window:globalThis);
