export const HOST_NAME = 'com.autopets.bridge';
export const MAX_FRAME = 64 * 1024;
export const CAPABILITIES = Object.freeze({inputAssistance:false,modelSwitch:false,reasoningSwitch:false,contextSync:false,tokenUsage:false,additionalRepair:false,verification:'unverified'});
export class ProtocolError extends Error { constructor(code){super(code);this.code=code;} }
const fail=()=>{throw new ProtocolError('invalid-message');};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed,required=allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail();};
const bytes=v=>new TextEncoder().encode(v).length;
const contentControls=/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u,allControls=/[\u0000-\u001f\u007f-\u009f]/u;
const bounded=(v,max,empty=false)=>typeof v==='string'&&(empty||!!v.trim())&&bytes(v)<=max&&!contentControls.test(v)&&!/[\ud800-\udfff]/u.test(v);
const str=(v,max=128)=>bounded(v,max)&&!allControls.test(v);
const id=v=>str(v)&&/^[A-Za-z0-9_.:-]+$/u.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0;
export function validateIdentity(v){keys(v,['provider','accountId','chatId']);if(v.provider!=='chatgpt'||!str(v.accountId,200)||!str(v.chatId,512))fail();return v;}
export function validateContext(v){keys(v,['goal','outputFormat','constraints','decisions','remaining']);if(!bounded(v.goal,1024,true)||!bounded(v.outputFormat,512,true))fail();for(const key of ['constraints','decisions','remaining'])if(!Array.isArray(v[key])||v[key].length>12||v[key].some(x=>!bounded(x,512)))fail();if(bytes(JSON.stringify(v))>3072)fail();return v;}
export function validatePreferences(v){keys(v,['enabled','workStyle','routingMode','fixedModel','allowedModels','allowEscalation','revision']);if(typeof v.enabled!=='boolean'||!['auto','fast','thorough'].includes(v.workStyle)||!['auto','fixed'].includes(v.routingMode)||typeof v.allowEscalation!=='boolean'||!revision(v.revision)||!(v.fixedModel===null||bounded(v.fixedModel,128))||(v.routingMode==='fixed'&&v.fixedModel===null)||!Array.isArray(v.allowedModels)||v.allowedModels.length>32||v.allowedModels.some(x=>!bounded(x,128)))fail();return v;}
export function chatFromUrl(value){try{const u=new URL(value);if(u.origin!=='https://chatgpt.com')return null;const m=u.pathname.match(/^\/c\/([a-f0-9-]{16,64})\/?$/i);return m?m[1]:null;}catch{return null;}}
export function isChatGPTUrl(value){try{return new URL(value).origin==='https://chatgpt.com';}catch{return false;}}
export function validateAssistance(v){
 keys(v,['operation','identity','expectedRevision','preferencesRevision','recipeId','requestedModel','reason','injectionBytes','guidanceHash','nonce','evidence','context','quality'],['operation','identity']);validateIdentity(v.identity);
 const fields={read:[],prepare:['expectedRevision','preferencesRevision','recipeId','requestedModel','reason','injectionBytes','guidanceHash'],delivered:['nonce','evidence'],context:['nonce','expectedRevision','context'],quality:['nonce','quality']};
 if(!Object.hasOwn(fields,v.operation))fail();keys(v,['operation','identity',...fields[v.operation]]);
 if(v.operation==='prepare'){if(!revision(v.expectedRevision)||!revision(v.preferencesRevision)||!id(v.recipeId)||!(v.requestedModel===null||bounded(v.requestedModel,128))||!str(v.reason,240)||!Number.isInteger(v.injectionBytes)||v.injectionBytes<0||v.injectionBytes>3072||typeof v.guidanceHash!=='string'||!/^[a-f0-9]{64}$/u.test(v.guidanceHash))fail();}
 if(['delivered','context','quality'].includes(v.operation)&&!id(v.nonce))fail();
 if(v.operation==='delivered'&&v.evidence!=='sent')fail();
 if(v.operation==='context'){if(!revision(v.expectedRevision))fail();validateContext(v.context);}
 if(v.operation==='quality'){keys(v.quality,['status','findings','repairCount']);const q=v.quality;if(!['unchecked','passed','needs-review'].includes(q.status)||!Array.isArray(q.findings)||q.findings.length>12||q.findings.some(x=>!str(x,256))||!Number.isInteger(q.repairCount)||q.repairCount<0||q.repairCount>1||(q.status==='passed'&&q.findings.length))fail();}
 return v;
}
export function validateMessage(v){
 keys(v,['version','id','type','payload'],['version','id','type']);if(v.version!==1||!str(v.id,64)||!/^[A-Za-z0-9_-]+$/u.test(v.id))fail();
 if(v.type==='handshake'){keys(v,['version','id','type']);return v;}
 if(v.type==='status'){keys(v,['version','id','type']);return v;}
 if(v.type==='assistance'){keys(v,['version','id','type','payload']);validateAssistance(v.payload);return v;}fail();
}
