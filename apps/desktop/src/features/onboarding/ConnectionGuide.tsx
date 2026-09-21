import type { SetupState } from '@autopets/contracts/types';

export function ConnectionGuide({ connectionPath, setup, onBack }: { connectionPath: string; setup?: SetupState | null; onBack: () => void }) {
  const started = setup && setup.phase !== 'not-started';
  return <>
    <div className="page-heading"><span className="eyebrow">GET STARTED</span><h1>한 번 연결하고,<br />평소처럼 요청하세요</h1><p>다음부터는 “AutoPets 켜줘”.</p></div>
    <section className="setup-card"><span className="step-number">01</span><div><h3>{setup?.appReady ? '앱 준비 완료' : '설치 확인'}</h3><p>균형 있게 시작해요. 작업 방식은 펫에서 바꿀 수 있어요.</p></div></section>
    <section className="setup-card"><span className="step-number">02</span><div><h3>{setup?.chatConnected ? '채팅 연결 확인' : '채팅 연결 대기'}</h3><p>{setup?.chatConnected ? '현재 작업의 활동을 받았어요.' : started ? 'Codex에서 AutoPets 훅을 허용한 뒤 평소처럼 요청하세요.' : '설치 안내의 시작 도구를 실행해주세요.'}</p>{!setup?.chatConnected && <details><summary>연결이 안 되나요?</summary><p>Codex의 훅 검토 화면에서 허용 여부를 확인하세요. 반영되지 않으면 Codex를 다시 열고 AutoPets를 불러주세요.</p><code className="path-code">{connectionPath || '앱 연결 대기'}</code></details>}</div></section>
    <section className="setup-card"><span className="step-number">03</span><div><h3>{setup?.guidanceDelivered ? '자동 도움 전달 확인' : '자동 도움 전달 미확인'}</h3><p>{setup?.guidanceDelivered ? '현재 채팅에서 전달을 확인했어요.' : '설치만으로 AI 설정이 바뀌지는 않아요.'}</p><details><summary>적용 범위 보기</summary><p>모델 {setup?.protection.model ? '확인' : '미검증'} · 추론 {setup?.protection.reasoning ? '확인' : '미검증'} · 제출 보호 {setup?.protection.submission ? '확인' : '미검증'}</p><p>펫 메뉴에서 도움 끄기·숨기기·종료를 선택할 수 있어요.</p></details><button className="button secondary" onClick={onBack}>나의 펫 보기</button></div></section>
    <p className="small-note">현재는 검토용 설치 패키지예요. 한 줄 설치의 실환경 검증은 진행 전이에요.</p>
  </>;
}
