import { useState } from 'react';
import type { AssistanceSnapshot } from '@autopets/contracts/types';
import type { AssistanceAction } from '../../bridge/actionTypes';

export function ConnectionDataPanel({ snapshot, disabled, hidden, run }: { snapshot: AssistanceSnapshot; disabled: boolean; hidden: boolean; run: AssistanceAction }) {
  const [confirmAll, setConfirmAll] = useState(false);
  return <section id="assistance-panel-connection" role="tabpanel" aria-labelledby="assistance-tab-connection" hidden={hidden}>
      <details className="assistance-card assistance-details"><summary>연결별 지원 상태</summary><div className="capability-grid">{(['codex', 'chatgpt'] as const).map(provider => { const cap = snapshot.capabilities[provider]; return <section key={provider}><h3>{provider === 'codex' ? 'Codex' : 'ChatGPT 웹'}</h3><p>지침 전달 · {cap.inputAssistance ? '준비됨' : '확인 못 함'}</p><p>모델 변경 · {cap.modelSwitch ? '준비됨' : '확인 못 함'}</p><p>채팅 기록 전달 · {cap.contextSync ? '준비됨' : '확인 못 함'}</p><p>사용량 · {cap.tokenUsage ? '준비됨' : '확인 못 함'}</p></section>; })}</div></details>
      <section className="assistance-card assistance-data"><h2>저장한 데이터</h2><p className="small-note">작업 메모와 계획만 초기화해요. 펫 연결·실행 기록과 Codex 채팅은 남아요.</p><button className="text-button danger-text" disabled={disabled || !snapshot.tasks.length} onClick={() => setConfirmAll(!confirmAll)}>작업 메모·계획 초기화</button>{confirmAll && <div className="delete-confirm"><p>작업 메모와 계획을 초기화할까요? 펫 연결과 실행 기록은 남아요.</p><button className="button secondary" disabled={disabled} onClick={() => setConfirmAll(false)}>취소</button><button className="button danger-button" disabled={disabled} onClick={async () => { if (await run('delete_all_contexts', {}, '작업 메모와 계획을 초기화했어요.')) setConfirmAll(false); }}>메모·계획 초기화 확인</button></div>}</section>
    </section>;
}
