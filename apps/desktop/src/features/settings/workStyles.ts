import type { UserPreferences } from '@autopets/contracts/types';

export const WORK_STYLES: [UserPreferences['workStyle'], string, string][] = [['auto', '자동', '필요한 만큼 준비·확인'], ['fast', '빠르게', '핵심 결과부터'], ['thorough', '꼼꼼하게', '근거와 누락 점검']];
