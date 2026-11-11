import { useRef, useState } from 'react';
import type { SavedPet } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';

type Action = 'install' | 'use';

// Claude's own install window and a prefilled new chat replace the manual file
// and copy-paste steps. Claude still asks the user to confirm the install and to
// send the message; AutoPets never claims either happened.
export function PetPreferencesConnector({ compact = false, pet = null }: { compact?: boolean; pet?: SavedPet | null }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const act = async (action: Action) => {
    if (pending.current) return;
    pending.current = true; setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'install') {
        const name = await command<string>('install_pet_preferences_in_claude');
        if (typeof name !== 'string' || !/^AutoPets-pet-preferences-[0-9a-f-]{36}\.mcpb$/.test(name)) throw Error('unconfirmed-export');
        setNotice('Claude 설치 창에서 설치를 눌러 주세요. 이미 설치했다면 닫아도 돼요.');
      } else if (pet) {
        await command('open_pet_in_claude', { petId: pet.id, expectedRevision: pet.revision });
        setNotice('Claude 새 대화에 요청을 넣었어요. 모델을 고르고 보내기만 누르세요.');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      setError(/[가-힣]/.test(message) ? message : action === 'install' ? 'Claude 설치 창을 열지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.' : 'Claude 앱을 열지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.');
    } finally { pending.current = false; setBusy(null); }
  };
  const install = isDesktop
    ? <button className="button secondary" disabled={busy !== null} onClick={() => void act('install')}>{busy === 'install' ? '여는 중…' : 'Claude에 설치'}</button>
    : <a className="button secondary" href="/assets/connectors/AutoPets-pet-preferences.mcpb" download="AutoPets-pet-preferences.mcpb">Claude 연결 파일<span aria-hidden="true">↓</span></a>;
  const use = isDesktop && pet
    ? <button className="button secondary" disabled={busy !== null} onClick={() => void act('use')}>{busy === 'use' ? '여는 중…' : 'Claude에서 쓰기'}<span aria-hidden="true">↗</span></button>
    : null;
  const status = <>
    {notice && <p className="setup-notice" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
  if (compact) return <div className="composer-claude-connector">{use}{install}{status}</div>;
  return <details className="connection-preset-share"><summary>다른 AI에서도 펫 설정 쓰기</summary>
    <h2>저장한 작업 방식을 Claude에서도 써요.</h2>
    <ol><li><strong>Claude에 설치</strong>를 누르고 Claude 창에서 설치를 확인해요. 한 번만 하면 돼요.</li><li>펫 화면에서 <strong>Claude에서 쓰기</strong>를 누르면 그 펫을 부르는 요청이 담긴 새 대화가 열려요.</li></ol>
    {install}
    {status}
    <p className="small-note">펫 설정 읽기만 연결해요. 대화 공유·스킬 실행·모델 변경은 하지 않아요.</p>
    {isDesktop && <ClaudeCodeConnector />}
  </details>;
}

// Claude Code's own plugin CLI installs the local AutoPets plugin, so the pet
// follows Claude Code work. Only work status is sent, never conversation text.
function ClaudeCodeConnector() {
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const act = async (action: 'connect' | 'disconnect') => {
    if (pending.current) return;
    pending.current = true; setBusy(action); setNotice(''); setError('');
    try {
      await command(action === 'connect' ? 'connect_claude_code' : 'disconnect_claude_code');
      setNotice(action === 'connect' ? '연결했어요. 새로 여는 Claude Code 세션부터 펫이 움직여요.' : '연결을 해제했어요.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      setError(/[가-힣]/.test(message) ? message : 'Claude Code 연결을 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(null); }
  };
  return <section className="claude-code-connector" aria-label="Claude Code 연결">
    <h3>Claude Code에서도 펫이 움직이게</h3>
    <p>작업 시작·도구 사용·권한 요청·완료 상태만 펫에 전해요. 대화 내용과 파일 내용은 보내지 않아요.</p>
    <div className="claude-code-actions">
      <button className="button secondary" disabled={busy !== null} onClick={() => void act('connect')}>{busy === 'connect' ? '연결 중…' : 'Claude Code에 연결'}</button>
      <button className="text-button" disabled={busy !== null} onClick={() => void act('disconnect')}>{busy === 'disconnect' ? '해제 중…' : 'Claude Code 연결 해제'}</button>
    </div>
    {notice && <p className="setup-notice" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
