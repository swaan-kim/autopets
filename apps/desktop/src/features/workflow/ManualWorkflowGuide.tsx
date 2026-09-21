import { useState } from 'react';

export const PLANNING_PROMPT = '이 요청의 목표, 필요한 단계, 완료 기준을 짧게 정리해주세요. 중요한 불명확함만 질문하고, 제가 계획을 확인하기 전에는 실행하지 마세요.';
export function ManualWorkflowGuide({ prompt = PLANNING_PROMPT, provider, initial = false }: { prompt?: string; provider?: 'codex' | 'chatgpt'; initial?: boolean }) {
  const [notice, setNotice] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setNotice('복사했어요. 사용할 채팅에 붙여넣어 주세요.'); }
    catch { setNotice('복사하지 못했어요. 아래 문구를 직접 선택해 복사해주세요.'); }
  };
  return <details className="assistance-details workflow-manual"><summary>{initial ? '연결 없이 시작하기' : '채팅에서 직접 진행하기'}</summary><p className="small-note">{provider === 'chatgpt' ? 'ChatGPT 채팅에서 모델 설정과 계획 내용을 직접 확인하세요.' : '사용 중인 Codex가 제공하는 /plan · /model · /reasoning 메뉴에서 모드·모델·추론 수준을 직접 확인하세요.'}</p><p className="workflow-copy">{prompt}</p><button className="button secondary" type="button" onClick={() => void copy()}>요청 문구 복사</button>{notice && <p className="small-note" role="status">{notice}</p>}</details>;
}
