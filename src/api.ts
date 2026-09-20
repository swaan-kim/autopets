import { invoke } from '@tauri-apps/api/core';
import type { Snapshot } from './types';
import { EMPTY_ASSISTANCE } from './assistance-types';
export const isDesktop = '__TAURI_INTERNALS__' in window;
const empty:Snapshot = {sessions:[],slots:[0,1,2].map(index=>({index,sessionId:null})),connectionPath:'',capabilities:{tokenUsage:'unavailable',taskReturn:'manual'},now:Date.now()};
export async function command<T=void>(name:string,args?:Record<string,unknown>):Promise<T> {
  if(!isDesktop) { if(name==='get_snapshot')return empty as T; if(name==='get_assistance')return EMPTY_ASSISTANCE as T; throw new Error('Windows 데스크톱 앱에서 사용할 수 있습니다.'); }
  return invoke<T>(name,args);
}
