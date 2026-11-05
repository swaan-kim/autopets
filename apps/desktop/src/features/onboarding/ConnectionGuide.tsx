import { useEffect, useRef, useState } from 'react';
import type { ConnectionHost, SetupState } from '@autopets/contracts/types';
import catalog from '../../../../../packages/contracts/data/connections.json';
import { command, isDesktop } from '../../bridge/command';
import { Pet } from '../pets/Pet';
import { AppUpdate } from './AppUpdate';
import './connection.css';

const stageLabel = { implementation: '연결 구현 · 실환경 미검증', compatibility: '호환성 확인 전', planned: '연결 준비 중', guidance: '안내만 제공' };

export function ConnectionGuide({ connectionPath, setup, defaultLabel = '균형 있게', onBack, onPreferences }: {
  connectionPath: string; setup?: SetupState | null; defaultLabel?: string; onBack: () => void; onPreferences: () => void;
}) {
  const [latest, setLatest] = useState(setup);
  const [hostId, setHostId] = useState(setup?.currentHostId || 'codex-windows-local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  useEffect(() => { setLatest(setup); }, [setup]);
  const hosts: ConnectionHost[] = latest?.hosts || catalog as ConnectionHost[];
  const host = hosts.find(item => item.id === hostId);
  const connection = latest?.connections?.find(item => item.hostId === hostId);
  const configured = connection?.configured === true;
  const observed = connection?.status === 'connected';
  const firstTask = connection?.firstTask;
  const run = async (name: 'connect_ai' | 'disconnect_ai') => {
    if (!isDesktop || !host?.connectAvailable || working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await command<SetupState>(name, { hostId });
      setLatest(result);
      setNotice([name === 'connect_ai' ? '연결 설정을 준비했어요. AI의 훅 검토와 첫 활동은 별도로 확인해요.' : 'AutoPets 연결 설정을 해제했어요.', ...(result.warnings || [])].join(' '));
    } catch (cause) { setError(String(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  return <div className="connection-guide">
    <div className="page-heading setup-heading"><div><span className="eyebrow">LET’S GET STARTED</span><h1>AI는 그대로,<br />펫과 함께 시작해요</h1><p>앱 준비 → AI 연결 → 첫 작업 확인</p></div><Pet small paused /></div>
    <ol className="setup-steps" aria-label="시작하기 세 단계">
      <li className="setup-step"><span className="step-number" aria-hidden="true">01</span><div><div className="setup-step-title"><h2>앱 준비</h2><span className="setup-status">{latest?.appReady ? '준비됨' : isDesktop ? '앱 상태 확인 중' : '브라우저 미리보기'}</span></div><p>펫과 설정 창을 이 PC에서 사용해요.</p><div className="setup-default"><span>희망 기본값 <strong>{defaultLabel}</strong></span><button className="text-button" onClick={onPreferences}>작업 방식 보기 →</button></div><p className="small-note">희망 설정과 AI의 실제 모델·추론 설정은 별도예요.</p></div></li>
      <li className="setup-step"><span className="step-number" aria-hidden="true">02</span><div><div className="setup-step-title"><h2>AI 연결</h2><span className="setup-status">{observed ? '활동 수신' : configured ? '첫 활동 대기' : '연결 전'}</span></div>
        <label className="field-label" htmlFor="setup-host">사용할 AI</label><select id="setup-host" className="text-input" value={hostId} disabled={busy} onChange={event => { setHostId(event.target.value); setError(''); setNotice(''); }}>{hosts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        {host && <p className="setup-host-stage">{stageLabel[host.stage]}</p>}
        {host?.connectAvailable ? <><p>{observed ? '활동을 받았어요. 아래에서 첫 작업과 도움 전달을 확인하세요.' : configured ? 'Codex에서 훅을 검토해주세요. 반영되지 않으면 Codex를 다시 연 뒤 평소처럼 요청하세요.' : '버튼을 누르면 이 PC의 AutoPets 연결 설정을 준비해요.'}</p><div className="setup-actions"><button className="button primary" disabled={!isDesktop || busy || configured} onClick={() => void run('connect_ai')}>{busy ? '처리 중…' : configured ? '연결 설정 준비됨' : '이 AI 연결하기'}</button>{configured && <details><summary>연결 관리</summary><button className="text-button" disabled={busy} onClick={() => void run('connect_ai')}>연결 복구</button><button className="text-button danger-text" disabled={busy} onClick={() => void run('disconnect_ai')}>이 AI 연결 해제</button></details>}</div><details className="setup-help"><summary>연결이 안 되나요?</summary><p>훅 허용은 AI의 검토 화면에서 직접 결정해주세요. 연결 설정과 허용은 서로 다른 단계예요.</p><code className="path-code">{connectionPath || '연결 파일 준비 전'}</code></details></> : <p className="setup-guidance">{host?.execution === 'cloud' ? '웹·클라우드 채팅은 이 PC와 자동 연결되지 않아요. 기존 채팅에서 요청 문구를 직접 사용해주세요.' : '이 환경의 연결은 아직 검증하지 않았어요. 기존 AI에서 요청 문구와 설정 안내를 사용할 수 있어요.'}<button className="text-button" onClick={onPreferences}>요청 문구·설정 안내 보기 →</button></p>}
        {!isDesktop && <p className="small-note">미리보기에서는 AI 연결 설정을 저장하지 않아요.</p>}
        {error && <p className="error" role="alert">{error}</p>}{notice && <p className="setup-notice" role="status">{notice}</p>}
      </div></li>
      <li className="setup-step"><span className="step-number" aria-hidden="true">03</span><div><div className="setup-step-title"><h2>첫 작업 확인</h2><span className="setup-status">{firstTask ? '활동 확인됨' : '확인 전'}</span></div><p>{firstTask ? '작업 활동을 받았어요. 나의 펫에서 표시할 작업을 선택하세요.' : '연결할 AI에서 평소처럼 요청하면 활동 수신 여부를 확인해요.'}</p><p className="setup-delivery">자동 도움 전달 · {connection?.guidanceDelivered ? '확인됨' : '미확인'}</p><details className="setup-help"><summary>실제 설정 확인</summary><p>모델 {connection?.settingsVerified.model ? '확인' : '미검증'} · 추론 {connection?.settingsVerified.reasoning ? '확인' : '미검증'} · 제출 보호 {connection?.settingsVerified.submission ? '확인' : '미검증'}</p><p>설치나 첫 활동 수신만으로 실제 설정 변경이 확인되지는 않아요.</p></details><button className="button secondary" onClick={onBack}>나의 펫 보기</button></div></li>
    </ol><p className="small-note setup-endnote">펫에는 선택한 작업만 표시해요. 도움 끄기·펫 숨기기·앱 종료는 언제든 사용할 수 있어요.</p><AppUpdate />
  </div>;
}
