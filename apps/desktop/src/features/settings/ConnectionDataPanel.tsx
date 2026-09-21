import { useState } from 'react';
import type { AssistanceSnapshot } from '@autopets/contracts/types';
import type { AssistanceAction } from '../../bridge/actionTypes';

export function ConnectionDataPanel({ snapshot, disabled, hidden, run }: { snapshot: AssistanceSnapshot; disabled: boolean; hidden: boolean; run: AssistanceAction }) {
  const [confirmAll, setConfirmAll] = useState(false);
  return <section id="assistance-panel-connection" role="tabpanel" aria-labelledby="assistance-tab-connection" hidden={hidden}>
      <details className="assistance-card assistance-details"><summary>연결별 지원 상태</summary><div className="capability-grid">{(['codex', 'chatgpt'] as const).map(provider => { const cap = snapshot.capabilities[provider]; return <section key={provider}><h3>{provider === 'codex' ? 'Codex' : 'ChatGPT 웹'}</h3><p>{cap.inputAssistance ? '입력 보조 연결 확인됨' : '자동 지침 전달 · 검증 필요'}</p><p>{cap.modelSwitch ? '실제 모델 변경 연결 확인됨' : '모델 자동 변경 · 미검증'}</p><p>{cap.contextSync ? '채팅 기록 전달 연결 확인됨' : '채팅 기록 전달 · 검증 필요'}</p><p>{cap.tokenUsage ? '작업별 사용량 연결 확인됨' : '토큰 사용량 · 측정 불가'}</p></section>; })}</div></details>
      <section className="assistance-card assistance-data"><h2>저장한 데이터</h2><p className="small-note">AI 서비스의 대화는 삭제하지 않아요.</p><button className="text-button danger-text" disabled={disabled || !snapshot.tasks.length} onClick={() => setConfirmAll(!confirmAll)}>모든 채팅 기록 삭제</button>{confirmAll && <div className="delete-confirm"><p>AutoPets에 저장한 모든 채팅 기록을 지울까요?</p><button className="button secondary" disabled={disabled} onClick={() => setConfirmAll(false)}>취소</button><button className="button danger-button" disabled={disabled} onClick={async () => { if (await run('delete_all_contexts', {}, '모든 채팅의 저장 기록을 삭제했어요.')) setConfirmAll(false); }}>모든 기록 삭제 확인</button></div>}</section>
    </section>;
}
