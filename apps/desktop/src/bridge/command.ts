import { invoke } from '@tauri-apps/api/core';
import type { Snapshot } from '@autopets/contracts/types';
import { EMPTY_ASSISTANCE } from './defaults';
import { EMPTY_WORKFLOW } from '../features/workflow/defaults';
import { EMPTY_ARTIFACTS } from '../features/intro/defaults';
import roleTemplates from '../../../../packages/contracts/data/roles.json';
export const isDesktop = '__TAURI_INTERNALS__' in window;
const empty:Snapshot = {sessions:[],slots:[0,1,2].map(index=>({index,sessionId:null})),connectionPath:'',capabilities:{tokenUsage:'unavailable',taskReturn:'manual'},now:Date.now()};
export async function command<T=void>(name:string,args?:Record<string,unknown>):Promise<T> {
  if (!isDesktop && name === 'roles_snapshot') return { templates: roleTemplates, pets: [], bindings: [] } as T;
  if(!isDesktop) { if(name==='get_snapshot')return empty as T; if(name==='get_assistance')return EMPTY_ASSISTANCE as T; if(name==='workflow_snapshot')return EMPTY_WORKFLOW as T; if(name==='artifact_snapshot')return EMPTY_ARTIFACTS as T; throw new Error('Windows 데스크톱 앱에서 사용할 수 있습니다.'); }
  return invoke<T>(name,args);
}
