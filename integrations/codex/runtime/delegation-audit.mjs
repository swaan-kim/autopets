import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { auditTurnSelection } from './turn-audit.mjs';
const uuid=v=>typeof v==='string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(v);
// Exact selected child only. Never discover transcripts, print content, or trust model self-report.
export async function auditDelegatedTurn({file,parentId,childId,turnId,cwd,startedAfter}) {
  if(![parentId,childId,turnId].every(uuid) || parentId===childId || !path.isAbsolute(file) || !path.isAbsolute(cwd) || !Number.isSafeInteger(startedAfter)) throw Error('invalid-child-audit');
  if((await stat(file)).size>32*1024*1024) throw Error('child-record-limit');
  const rows=(await readFile(file,'utf8')).split(/\r?\n/u).filter(l=>l.trim()).map(JSON.parse);
  const meta=rows.filter(r=>r.type==='session_meta');
  if(meta.length!==1) throw Error('child-identity-unavailable');
  const p=meta[0].payload;
  const parent=p?.source?.subagent?.thread_spawn?.parent_thread_id??p?.source?.subAgent?.thread_spawn?.parent_thread_id??p?.parent_thread_id;
  if(p?.id!==childId || parent!==parentId || path.resolve(p.cwd??'').toLowerCase()!==path.resolve(cwd).toLowerCase()) throw Error('child-parent-mismatch');
  const starts=rows.filter(r=>r.type==='event_msg' && r.payload?.type==='task_started' && r.payload.turn_id===turnId);
  if(starts.length!==1 || !Number.isFinite(Date.parse(starts[0].timestamp)) || Date.parse(starts[0].timestamp)<startedAfter-2000) throw Error('stale-child-turn');
  const result=await auditTurnSelection(file,childId), turn=result.turns.find(t=>t.turnId===turnId);
  if(!turn || !turn.reasoning) throw Error('child-settings-unavailable');
  return {parentId,childId,turnId,model:turn.model,effort:turn.reasoning,completed:turn.completed};
}
