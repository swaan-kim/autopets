import type { TaskContext } from '@autopets/contracts/types';
import { splitLines } from '../../app/shared/text';

export const cleanContext = (context: TaskContext): TaskContext => ({ ...context, constraints: splitLines(context.constraints.join('\n')), decisions: splitLines(context.decisions.join('\n')), remaining: splitLines(context.remaining.join('\n')) });
export function contextError(context: TaskContext) {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (bytes(context.goal) > 1024) return '목표가 너무 길어요. 핵심만 남겨주세요.';
  if (bytes(context.outputFormat) > 512) return '결과 형식을 조금 더 짧게 적어주세요.';
  for (const [field, label] of [['constraints', '중요한 조건'], ['decisions', '확정한 결정'], ['remaining', '남은 일']] as const) {
    if (context[field].length > 12) return `${label}은 12개까지 저장할 수 있어요.`;
    if (context[field].some(item => bytes(item) > 512)) return `${label}의 한 항목이 너무 길어요. 짧게 나눠주세요.`;
  }
  if (bytes(JSON.stringify(context)) > 3072) return '저장할 기록이 너무 많아요. 현재 작업에 필요한 내용만 남겨주세요.';
  return '';
}
