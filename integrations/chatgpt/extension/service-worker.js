import { HOST_NAME,CAPABILITIES,isChatGPTUrl } from './protocol.mjs';
const ORIGINS=['https://chatgpt.com/*'],CONTENT_ID='autopets-chatgpt-status';
const getSetting=async()=>!!(await chrome.storage.local.get('connectorEnabled')).connectorEnabled;
async function register(){const existing=await chrome.scripting.getRegisteredContentScripts({ids:[CONTENT_ID]});if(!existing.length)await chrome.scripting.registerContentScripts([{id:CONTENT_ID,matches:ORIGINS,js:['content.js'],runAt:'document_idle',allFrames:false,persistAcrossSessions:true}]);}
async function nativeStatus(){try{const reply=await chrome.runtime.sendNativeMessage(HOST_NAME,{version:1,id:crypto.randomUUID(),type:'status'});return{ok:reply?.ok===true,connected:reply?.connected===true,capabilities:CAPABILITIES,status:reply?.ok?'local-connected':'local-unavailable'};}catch{return{ok:false,connected:false,capabilities:CAPABILITIES,status:'native-unavailable'};}}
async function popupCommand(message){
 if(message.kind==='enable'){
  if(!await chrome.permissions.contains({origins:ORIGINS}))return{ok:false,status:'permission-required'};
  await chrome.storage.local.set({connectorEnabled:true});await register();
  const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.id&&isChatGPTUrl(tab.url))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  return{ok:true,status:'enabled',capabilities:CAPABILITIES};
 }
 if(message.kind==='disable'){await chrome.storage.local.set({connectorEnabled:false});await chrome.scripting.unregisterContentScripts({ids:[CONTENT_ID]}).catch(()=>{});await chrome.permissions.remove({origins:ORIGINS});return{ok:true,status:'disabled',capabilities:CAPABILITIES};}
 if(message.kind==='popup-status'){
  if(!await getSetting())return{ok:true,status:'disabled',capabilities:CAPABILITIES};
  const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!isChatGPTUrl(tab.url))return{ok:false,status:'open-chatgpt',capabilities:CAPABILITIES};
  try{return await chrome.tabs.sendMessage(tab.id,{kind:'autopets-read-status'});}catch{return{ok:false,status:'reload-chatgpt',capabilities:CAPABILITIES};}
 }return{ok:false,status:'invalid-message',capabilities:CAPABILITIES};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 const allowedPopup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
 const allowedDocument=sender.id===chrome.runtime.id&&sender.tab?.id!==undefined&&sender.frameId===0&&typeof sender.documentId==='string'&&isChatGPTUrl(sender.url);
 if(!message||Object.keys(message).some(k=>k!=='kind')||typeof message.kind!=='string'){reply({ok:false,status:'invalid-message'});return false;}
 (async()=>{
  if(allowedPopup)return popupCommand(message);
  if(!allowedDocument||message.kind!=='document-status'||!await getSetting()||!await chrome.permissions.contains({origins:ORIGINS}))return{ok:false,status:'disabled',capabilities:CAPABILITIES};
  return nativeStatus();
 })().then(reply,()=>reply({ok:false,status:'unavailable',capabilities:CAPABILITIES}));return true;
});
chrome.permissions.onRemoved.addListener(async removed=>{if(removed.origins?.includes(ORIGINS[0])){await chrome.storage.local.set({connectorEnabled:false});await chrome.scripting.unregisterContentScripts({ids:[CONTENT_ID]}).catch(()=>{});}});
chrome.runtime.onStartup.addListener(async()=>{if(await getSetting()&&await chrome.permissions.contains({origins:ORIGINS}))await register();});
