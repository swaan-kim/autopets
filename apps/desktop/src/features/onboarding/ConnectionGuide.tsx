import { useEffect, useRef, useState } from 'react';
import type { ConnectionHost, SetupState, PetLink } from '@autopets/contracts/types';
import catalog from '../../../../../packages/contracts/data/connections.json';
import { command, isDesktop } from '../../bridge/command';
import { AppUpdate } from './AppUpdate';
import { PetPreferencesConnector } from './PetPreferencesConnector';
import './connection.css';

const stageLabel = { implementation: '연결 기능 있음 · 실제 환경은 확인 중', compatibility: '아직 확인 못 함', planned: '준비 중', guidance: '안내만 제공' };
const PREVIEW_NOTE = '미리보기 화면이에요. 저장과 연결은 Windows 앱에서만 돼요.';
export function ConnectionGuide({ connectionPath, setup, petLinks = [], defaultLabel = '균형 있게', backLabel = '돌아가기', onBack, onPreferences }: {
  connectionPath: string; setup?: SetupState | null; petLinks?: PetLink[]; defaultLabel?: string; backLabel?: string; onBack: () => void; onPreferences: () => void;
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
      setNotice([name === 'connect_ai' ? 'Codex 준비를 마쳤어요. 이제 펫을 고르고 시작을 눌러 보세요.' : 'Codex와 AutoPets의 연결을 해제했어요.', ...(result.warnings || [])].join(' '));
    } catch { setError('AI 연결을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { working.current = false; setBusy(false); }
  };
  const previewNote = !isDesktop && <p className="small-note">{PREVIEW_NOTE}</p>;
  return <div className="connection-guide">
    <div className="page-heading setup-heading"><div><h1>AI 연결</h1><p>AI 채팅과 AutoPets를 이어 주는 준비예요. 한 번만 하면 돼요.</p></div><button className="button secondary" onClick={onBack}>{backLabel}</button></div>
    <section className="connection-manage-card" aria-label="AI 연결 관리">
      <div className="setup-step-title"><h2>{host?.label ?? 'Codex · Windows'}</h2><span className="setup-status">{petConnected ? '사용 중' : configured ? '준비됨' : '준비 전'}</span></div>
      {host?.connectAvailable ? <>
        <ol className="setup-progress" aria-label="연결 순서">
          {[
            { label: '앱 준비', done: isDesktop && latest?.appReady === true },
            { label: 'Codex 준비', done: configured },
            { label: '첫 작업 시작', done: petConnected },
          ].map((step, index) => <li key={step.label} data-done={step.done}>
            <span className="setup-step-number" aria-hidden="true">{step.done ? '✓' : index + 1}</span>
            <span>{step.label}<small>{step.done ? '완료' : '아직'}</small></span>
          </li>)}
        </ol>
        <p>{petConnected ? '펫이 맡은 일은 ‘내 작업’에서 확인하세요.' : configured ? '준비됐어요. 펫을 고르고 시작을 누르면 Codex 채팅이 열려요.' : '한 번 준비해 두면, 펫의 시작 버튼이 Codex 채팅을 열 수 있어요.'}</p>
        {configured && !petConnected && <div className="setup-next-step">
          <strong>이제 펫을 골라 시작해 보세요.</strong>
          <p>시작을 누르면 요청이 적힌 Codex 채팅이 열려요. 거기서 보내기만 눌러 주세요.</p>
        </div>}
        <div className="setup-actions">{configured ? <><button className="button secondary" disabled={!isDesktop || busy} onClick={() => void run('connect_ai')}>연결 복구</button><details><summary>연결 해제</summary><p>이 PC에서 Codex와 AutoPets의 연결을 끊어요. 하던 Codex 작업은 그대로 이어져요.</p><button className="text-button danger-text" disabled={!isDesktop || busy} onClick={() => void run('disconnect_ai')}>이 AI 연결 해제</button></details></> : <button className="button primary" disabled={!isDesktop || busy} onClick={() => void run('connect_ai')}>{busy ? '준비하는 중…' : '이 AI 연결하기'}</button>}</div>
        {previewNote}
        <details className="setup-help"><summary>펫이 연결되지 않나요?</summary><p>하던 작업을 마친 뒤 Codex를 닫았다가 다시 열고, 펫의 시작 버튼을 다시 눌러 주세요.{configured && ' 그래도 안 되면 위의 ‘연결 복구’를 눌러 주세요.'}</p><p>Codex 채팅의 스킬 목록에서 AutoPets를 고르고 “제작 펫 연결”이라고 보내도 연결돼요.</p><small>Codex에 이미 있던 설정은 그대로 둬요.</small></details>
      </> : <><p className="setup-guidance">이 환경에서는 펫 연결을 아직 확인하지 못했어요. <button className="text-button" onClick={onPreferences}>요청 문구·설정 안내 보기 →</button></p>{previewNote}</>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="setup-notice" role="status">{notice}</p>}
    </section>
    <PetPreferencesConnector />
    <details className="connection-advanced"><summary>문제 해결용 상세 정보</summary>
      <label className="field-label" htmlFor="setup-host">사용할 AI</label><select id="setup-host" className="text-input" value={hostId} disabled={busy} onChange={event => { setHostId(event.target.value); setError(''); setNotice(''); }}>{hosts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      {host && <p className="setup-host-stage">{stageLabel[host.stage]}</p>}
      <p>지금은 Windows의 Codex 연결을 지원해요. 다른 환경은 안내만 볼 수 있어요.</p>
      <dl className="connection-detail-list"><div><dt>앱</dt><dd>{latest?.appReady ? '준비됨' : isDesktop ? '확인 중' : '미리보기'}</dd></div><div><dt>활동 알림</dt><dd>{connection?.status === 'connected' ? '받는 중' : '확인 못 함'}</dd></div><div><dt>자동 도움 전달</dt><dd>{connection?.guidanceDelivered ? '전달됨' : '확인 못 함'}</dd></div></dl>
      <details className="setup-help"><summary>실제 설정 확인</summary><p>모델 {connection?.settingsVerified.model ? '확인됨' : '확인 못 함'} · 추론 {connection?.settingsVerified.reasoning ? '확인됨' : '확인 못 함'} · 전송 보호 {connection?.settingsVerified.submission ? '확인됨' : '확인 못 함'}</p><p>채팅의 설정과 펫이 맡은 작업의 설정은 따로 확인해요. 펫 작업의 값은 그 펫 카드에서 볼 수 있어요.</p></details>
      <div className="setup-default"><span>자동 도움 기본값 <strong>{defaultLabel}</strong></span><button className="text-button" onClick={onPreferences}>작업 방식 보기 →</button></div>
      <details className="setup-help"><summary>연결 파일 위치</summary><code className="path-code">{connectionPath || '연결 파일이 아직 없어요'}</code></details>
    </details>
    <AppUpdate />
  </div>;
}
