import { useEffect, useRef, useState } from 'react';
import type { ConnectionHost, SetupState, PetLink } from '@autopets/contracts/types';
import catalog from '../../../../../packages/contracts/data/connections.json';
import { command, isDesktop } from '../../bridge/command';
import { AppUpdate } from './AppUpdate';
import './connection.css';

const stageLabel = { implementation: '연결 구현 · 실환경 검증 범위 확인', compatibility: '호환성 확인 전', planned: '연결 준비 중', guidance: '안내만 제공' };
export function ConnectionGuide({ connectionPath, setup, petLinks = [], defaultLabel = '균형 있게', onBack, onPreferences }: {
  connectionPath: string; setup?: SetupState | null; petLinks?: PetLink[]; defaultLabel?: string; onBack: () => void; onPreferences: () => void;
}) {
  const [latest, setLatest] = useState(setup);
  const [hostId, setHostId] = useState('codex-windows-local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  useEffect(() => { setLatest(setup); }, [setup]);
  const hosts: ConnectionHost[] = latest?.hosts || catalog as ConnectionHost[];
  const host = hosts.find(item => item.id === hostId);
  const connection = latest?.connections?.find(item => item.hostId === hostId);
  const configured = connection?.configured === true;
  const petConnected = petLinks.some(link => link.target.sourceId === hostId && link.connected);
  const run = async (name: 'connect_ai' | 'disconnect_ai') => {
    if (!isDesktop || !host?.connectAvailable || working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await command<SetupState>(name, { hostId });
      setLatest(result);
      setNotice([name === 'connect_ai' ? '펫 호출 스킬을 준비했어요. 나의 펫에서 시작 요청을 복사해 Codex 채팅에 보내주세요.' : 'AutoPets 연결 설정을 해제했어요.', ...(result.warnings || [])].join(' '));
    } catch { setError('연결 설정을 바꾸지 못했어요. 앱과 Codex 상태를 확인한 뒤 다시 시도해 주세요.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <div className="connection-guide">
    <div className="page-heading setup-heading"><div><h1>연결 설정</h1><p>펫을 부르는 연결을 확인하고 관리해요.</p></div><button className="button secondary" onClick={onBack}>나의 펫 보기</button></div>
    <section className="connection-manage-card" aria-label="AI 연결 관리">
      <div className="setup-step-title"><h2>{host?.label ?? 'Codex · Windows'}</h2><span className="setup-status">{petConnected ? '펫 연결됨' : configured ? '호출 준비됨' : '연결 전'}</span></div>
      {host?.connectAvailable ? <>
        <p>{petConnected ? '연결된 펫의 작업과 설정은 나의 펫에서 확인하세요.' : configured ? '준비한 스킬을 Codex 채팅에서 부르면 펫이 연결돼요.' : '이 PC에 펫 호출 스킬을 준비하면 기존 Codex 채팅에서 사용할 수 있어요.'}</p>
        <div className="setup-actions">{configured ? <><button className="button secondary" disabled={!isDesktop || busy} onClick={() => void run('connect_ai')}>연결 복구</button><details><summary>연결 해제</summary><p>이 PC의 AutoPets 호출 설정을 해제해요. 기존 Codex 작업은 계속돼요.</p><button className="text-button danger-text" disabled={!isDesktop || busy} onClick={() => void run('disconnect_ai')}>이 AI 연결 해제</button></details></> : <button className="button primary" disabled={!isDesktop || busy} onClick={() => void run('connect_ai')}>{busy ? '준비하는 중…' : '이 AI 연결하기'}</button>}</div>
        <details className="setup-help"><summary>펫이 연결되지 않나요?</summary><p>Codex의 스킬 목록에서 AutoPets를 선택하고 “제작 펫 연결”을 보내세요. 새 스킬이 보이지 않으면 작업을 마친 뒤 Codex를 다시 열어주세요.</p><small>펫 호출에는 새 훅 허용이 필요하지 않아요. 기존 훅 설정은 변경하지 않아요.</small></details>
      </> : <p className="setup-guidance">{host?.execution === 'cloud' ? '이 웹·클라우드 환경은 아직 펫과 연결되지 않아요.' : '이 환경의 실제 펫 연결은 아직 검증하지 않았어요.'} <button className="text-button" onClick={onPreferences}>요청 문구·설정 안내 보기 →</button></p>}
      {!isDesktop && <p className="small-note">브라우저 미리보기에서는 연결을 바꾸지 않아요.</p>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="setup-notice" role="status">{notice}</p>}
    </section>
    <details className="connection-advanced"><summary>다른 환경과 연결 상세</summary>
      <label className="field-label" htmlFor="setup-host">사용할 AI</label><select id="setup-host" className="text-input" value={hostId} disabled={busy} onChange={event => { setHostId(event.target.value); setError(''); setNotice(''); }}>{hosts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      {host && <p className="setup-host-stage">{stageLabel[host.stage]}</p>}
      <p>현재 첫 체험은 Windows의 Codex를 지원해요. 다른 환경의 안내와 실제 연결은 별개예요.</p>
      <dl className="connection-detail-list"><div><dt>앱</dt><dd>{latest?.appReady ? '준비됨' : isDesktop ? '상태 확인 중' : '브라우저 미리보기'}</dd></div><div><dt>활동 알림</dt><dd>{connection?.status === 'connected' ? '수신 확인' : '미확인'}</dd></div><div><dt>자동 도움 전달</dt><dd>{connection?.guidanceDelivered ? '확인됨' : '미확인'}</dd></div></dl>
      <details className="setup-help"><summary>실제 설정 확인</summary><p>모델 {connection?.settingsVerified.model ? '확인' : '미검증'} · 추론 {connection?.settingsVerified.reasoning ? '확인' : '미검증'} · 제출 보호 {connection?.settingsVerified.submission ? '확인' : '미검증'}</p><p>부모 채팅의 설정과 펫 하위 작업은 구분해요. 펫 작업의 확인값은 해당 펫 카드에서 볼 수 있어요.</p></details>
      <div className="setup-default"><span>기존 자동 도움 기본값 <strong>{defaultLabel}</strong></span><button className="text-button" onClick={onPreferences}>작업 방식 보기 →</button></div>
      <details className="setup-help"><summary>연결 파일 위치</summary><code className="path-code">{connectionPath || '연결 파일 준비 전'}</code></details>
    </details>
    <AppUpdate />
  </div>;
}
