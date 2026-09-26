import { readFile, stat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { auditTurnSelection } from './turn-audit.mjs';
const uuid=v=>typeof v==='string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(v);
const normalized=p=>path.resolve(p).replace(/^\\\\\?\\/u,'').replaceAll('\\','/').toLowerCase();

// Version-scoped local index adapter. Read only the exact returned agent path under this parent.
// It is not a public host control API; schema/identity ambiguity fails closed.
export async function resolveDelegatedRecord({codexHome,parentId,agentPath,cwd,startedAfter}) {
  if(!path.isAbsolute(codexHome) || !uuid(parentId) || !/^\/root(?:\/[a-z0-9_]+)+$/u.test(agentPath??'') || !Number.isSafeInteger(startedAfter)) throw Error('invalid-child-selector');
  const database=path.join(codexHome,'state_5.sqlite');
  const db=new DatabaseSync(database,{readOnly:true});
  let candidates;
  try {
    const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
    if(!['id','rollout_path','source','agent_path','created_at_ms'].every(c=>columns.has(c))) throw Error('unsupported-runtime-index');
    candidates=db.prepare('SELECT id,rollout_path,source FROM threads WHERE agent_path=? AND created_at_ms>=? AND source LIKE ? LIMIT 3')
      .all(agentPath,startedAfter-2000,`%${parentId}%`).filter(row=>{
        try{return JSON.parse(row.source)?.subagent?.thread_spawn?.parent_thread_id===parentId;}catch{return false;}
      });
  } finally { db.close(); }
  if(candidates.length!==1 || !uuid(candidates[0].id)) throw Error('child-record-not-unique');
  const selected=candidates[0], file=await realpath(selected.rollout_path);
  const sessions=await realpath(path.join(codexHome,'sessions'));
  if(!normalized(file).startsWith(normalized(sessions)+'/') || !path.basename(file).endsWith(`-${selected.id}.jsonl`)) throw Error('child-record-location-mismatch');
  if((await stat(file)).size>32*1024*1024) throw Error('child-record-limit');
  const rows=(await readFile(file,'utf8')).split(/\r?\n/u).filter(l=>l.trim()).map(JSON.parse);
  const turns=rows.filter(r=>r.type==='event_msg' && r.payload?.type==='task_started' && Date.parse(r.timestamp)>=startedAfter-2000);
  if(turns.length!==1) throw Error('child-turn-not-unique');
  const turnId=turns[0].payload.turn_id;
  // Validate relation/settings now; callers never receive an unbound guessed record.
  await auditDelegatedTurn({file,parentId,childId:selected.id,turnId,cwd,startedAfter});
  return {file,childId:selected.id,turnId};
}
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
  const result=await auditTurnSelection(file,childId,parentId), turn=result.turns.find(t=>t.turnId===turnId);
  if(!turn || !turn.reasoning) throw Error('child-settings-unavailable');
  return {parentId,childId,turnId,model:turn.model,effort:turn.reasoning,completed:turn.completed};
}
