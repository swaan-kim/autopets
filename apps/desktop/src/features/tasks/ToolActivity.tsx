import type { Session, ToolActivity as ObservedTools } from '@autopets/contracts/types';

const labels = { running: '사용 중', completed: '실행 완료', failed: '실행 실패', unknown: '결과 확인 필요' };
export function toolCalls(session: Session, disconnected = false, mcpOnly = false) {
  const activity = session.toolActivityV1;
  if (activity?.version !== 1) return [];
  return activity.calls.filter(call => !mcpOnly || /^mcp__[^_].*__.+$/.test(call.name)).map(call => ({
    ...call, state: call.state === 'running' && (disconnected || session.connection !== 'observed') ? 'unknown' as const : call.state,
  }));
}

export function toolSummary(calls: ObservedTools['calls']) {
  if (!calls.length) return '도구 활동을 관측했어요';
  const running = calls.filter(call => call.state === 'running');
  if (running.length) return `${running.length}개 도구 사용 중`;
  const latest = [...calls].sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id))[0];
  return `최근 도구 ${labels[latest.state]}`;
}

export function ToolActivity({ session, disconnected }: { session: Session; disconnected: boolean }) {
  const calls = toolCalls(session, disconnected);
  if (!calls.length) return null;
  return <section className="detail-block" aria-label="관측된 도구 실행">
    <h3>도구 실행</h3>
    <p className="small-note">연결 상태 · 사용 가능 여부는 미확인입니다. 아래는 전달받은 실행 기록이에요.</p>
    <ul>{[...calls].sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id)).slice(0, 8).map(call =>
      <li key={call.id}><span className="tool-chip">{call.name}</span> · {labels[call.state]}</li>)}</ul>
    {(calls.length > 8 || session.toolActivityV1?.truncated) && <p className="small-note">일부 실행만 표시하고 있어요.</p>}
  </section>;
}

export function McpProp({ session, disconnected }: { session: Session; disconnected: boolean }) {
  const calls = toolCalls(session, disconnected, true);
  if (!calls.length) return null;
  const label = `MCP · ${toolSummary(calls)}`;
  const state = calls.some(call => call.state === 'running') ? 'running'
    : [...calls].sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id))[0].state;
  const mark = { running: '…', completed: '✓', failed: '!', unknown: '?' }[state];
  return <span className="mcp-pet-prop" data-state={state} role="img" aria-label={label} title={label}>⌘<small>{mark}</small></span>;
}
