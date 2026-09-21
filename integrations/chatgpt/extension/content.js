// Isolated-world status adapter. No composer reads, account scraping, clicks, or writes.
(()=>{
 if(globalThis.__autopetsStatusInstalled)return;
 globalThis.__autopetsStatusInstalled=true;
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||message?.kind!=='autopets-read-status')return false;
  chrome.runtime.sendMessage({kind:'document-status'}).then(reply,()=>reply({ok:false,status:'unavailable'}));return true;
 });
})();
