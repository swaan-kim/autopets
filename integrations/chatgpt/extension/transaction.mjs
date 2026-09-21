// Fixture-tested adapter only. The live content script does not import or invoke this module.
const clone=v=>structuredClone(v);
const bytes=s=>new TextEncoder().encode(s).byteLength;
const same=(a,b)=>a.accountId===b.accountId&&a.chatId===b.chatId&&a.modelId===b.modelId&&a.revision===b.revision&&a.text===b.text&&JSON.stringify(a.attachments)===JSON.stringify(b.attachments)&&!b.composing&&!b.editing;
function assertSnapshot(s){if(!s||typeof s.text!=='string'||!Number.isSafeInteger(s.revision)||!Array.isArray(s.attachments)||s.attachments.some(a=>typeof a!=='string')||!s.accountId||!s.chatId||!s.modelId)throw Error('invalid-snapshot');}
export function prepareTransaction({snapshot,guidance,nonce,enabled=false,verification={}}){
 assertSnapshot(snapshot);
 if(!enabled||!verification.account||!verification.model||!verification.submission||!verification.inputAssistance) return {ok:false,reason:'unverified'};
 if(snapshot.composing)return{ok:false,reason:'ime-active'};
 if(snapshot.editing)return{ok:false,reason:'editing-message'};
 if(typeof guidance!=='string'||!guidance.trim()||bytes(guidance)>3072||typeof nonce!=='string'||!nonce)return{ok:false,reason:'invalid-guidance'};
 return{ok:true,state:'prepared',nonce,original:clone(snapshot),proposedText:snapshot.text+'\n\n[AutoPets 작업 안내 · 현재 요청이 우선]\n'+guidance,appliedRevision:null,submissionId:null};
}
export async function applyTransaction(tx,port){
 if(!tx?.ok||tx.state!=='prepared')return{ok:false,reason:'invalid-state'};
 const current=await port.read();if(!same(tx.original,current)){tx.state='aborted';return{ok:false,reason:'input-changed'};}
 // write is a compare-and-swap port, never a send action.
 const written=await port.compareAndSwap({expected:clone(current),text:tx.proposedText});
 if(!written?.ok){tx.state='aborted';return{ok:false,reason:'write-rejected'};}
 tx.appliedRevision=written.revision;tx.state='applied';
 const after=await port.read();if(after.text!==tx.proposedText||after.revision!==tx.appliedRevision||after.chatId!==tx.original.chatId||after.accountId!==tx.original.accountId||after.modelId!==tx.original.modelId||after.composing||after.editing||JSON.stringify(after.attachments)!==JSON.stringify(tx.original.attachments)){await rollbackTransaction(tx,port);return{ok:false,reason:'write-unverified'};}
 return{ok:true,state:'applied'};
}
export async function rollbackTransaction(tx,port){
 if(!tx?.ok||tx.state!=='applied')return{ok:false,reason:'invalid-state'};
 const current=await port.read(),expected={...tx.original,text:tx.proposedText,revision:tx.appliedRevision};
 if(!same(expected,current)){tx.state='aborted';return{ok:false,reason:'user-change-preserved'};}
 const result=await port.compareAndSwap({expected:clone(current),text:tx.original.text});
 tx.state='aborted';return result?.ok?{ok:true,state:'rolled-back'}:{ok:false,reason:'rollback-conflict'};
}
export function observeDelivered(tx,evidence){
 if(!tx?.ok||tx.state!=='applied')return{ok:false,reason:'invalid-state'};
 if(!evidence?.verified||evidence.nonce!==tx.nonce||evidence.text!==tx.proposedText||evidence.accountId!==tx.original.accountId||evidence.chatId!==tx.original.chatId||evidence.modelId!==tx.original.modelId||typeof evidence.submissionId!=='string'||!evidence.submissionId)return{ok:false,reason:'submission-unverified'};
 tx.state='delivered';tx.submissionId=evidence.submissionId;return{ok:true,nonce:tx.nonce,evidence:'sent'};
}
